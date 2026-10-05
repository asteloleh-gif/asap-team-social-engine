const fetch = require('node-fetch');
const { createThreadsPostPublisher } = require('../../adapters/threadsPostPublisher');
const { createThreadsInsightsAdapter } = require('../../adapters/threadsInsightsAdapter');

function createMetaPostProvider({ account, fetchImpl = fetch, apiVersion = 'v26.0', sleep = ms => new Promise(r => setTimeout(r, ms)), beforePublish = async () => true, beforeFinalMutation = async () => true } = {}) {
  const base = account.platform === 'threads' ? 'https://graph.threads.net/v1.0' : `https://graph.facebook.com/${apiVersion}`;
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const threads = account.platform === 'threads' ? createThreadsPostPublisher({ fallbackAccessToken: account.accessToken, fetchImpl, sleep }) : null;
  const insights = account.platform === 'threads' ? createThreadsInsightsAdapter({ fallbackAccessToken: account.accessToken, fetchImpl }) : null;
  let identity = { verified: false };

  async function request(path, { method = 'GET', params = {}, finalMutation = false } = {}) {
    const query = new URLSearchParams(params);
    const url = `${base}/${path}${method === 'GET' && query.size ? `?${query}` : ''}`;
    try {
      const response = await fetchImpl(url, { method, headers, ...(method === 'POST' ? { body: query } : {}), timeout: 20_000 });
      const data = await response.json().catch(() => null);
      if (response.ok && data && !data.error) return { ok: true, data };
      return { ok: false, ambiguous: finalMutation && (response.status === 429 || response.status >= 500 || response.ok), reason: data?.error?.code ? `META_${data.error.code}` : `HTTP_${response.status}` };
    } catch (_) { return { ok: false, ambiguous: finalMutation, reason: 'NETWORK_OUTCOME_UNKNOWN' }; }
  }

  async function verifyIdentity() {
    const platform = account.platform;
    const r = await request(platform === 'instagram' ? account.userId : 'me', { params: { fields: platform === 'facebook' ? 'id,name' : 'id,username' } });
    const match = r.ok && String(r.data.id) === account.userId && (platform === 'facebook' || String(r.data.username || '').toLowerCase() === account.username.toLowerCase());
    identity = { verified: Boolean(match), checkedAt: new Date().toISOString(), reason: match ? null : (r.reason || 'IDENTITY_MISMATCH') };
    return identity;
  }

  async function readback(id) {
    const platform = account.platform;
    const fields = platform === 'facebook' ? 'id,permalink_url,from,message,created_time' : platform === 'threads' ? 'id,permalink,owner,username,text,timestamp' : 'id,permalink,username,caption,timestamp';
    const r = await request(String(id), { params: { fields } });
    if (!r.ok || String(r.data.id) !== String(id)) return { verified: false, reason: r.reason || 'READBACK_ID_MISMATCH' };
    const ownerId = r.data.owner?.id || r.data.from?.id;
    if (ownerId && String(ownerId) !== account.userId) return { verified: false, reason: 'READBACK_OWNER_MISMATCH' };
    if (r.data.username && String(r.data.username).toLowerCase() !== account.username.toLowerCase()) return { verified: false, reason: 'READBACK_USERNAME_MISMATCH' };
    if ((platform === 'facebook' && !ownerId) || (platform !== 'facebook' && !r.data.username && !ownerId)) return { verified: false, reason: 'READBACK_OWNER_UNAVAILABLE' };
    const permalink = r.data.permalink || r.data.permalink_url || null;
    return { verified: Boolean(permalink), permalink, id: String(id), contentText: r.data.text ?? r.data.message ?? r.data.caption ?? null, publishedAt: r.data.timestamp || r.data.created_time || null, checkedAt: new Date().toISOString(), reason: permalink ? null : 'PERMALINK_UNAVAILABLE' };
  }

  async function publishPost(content, context = {}) {
    if (!(await verifyIdentity()).verified) return { status: 'failed', reason: 'ACCOUNT_IDENTITY_UNVERIFIED' };
    if (!(await beforePublish(account, { ...context, content }))) return { status: 'failed', reason: 'ASAP_PAUSED_OR_RATE_LIMITED' };
    let result;
    if (account.platform === 'threads') {
      if (content.type !== 'text') return { status: 'failed', reason: 'UNSUPPORTED_CONTENT_TYPE' };
      const container = await threads.createTextContainer(content.text);
      if (container.status !== 'created') return container;
      if (!(await beforeFinalMutation(account, { ...context, content }))) return { status: 'failed', reason: 'ASAP_FINAL_MUTATION_BLOCKED', containerId: container.id };
      result = { ...(await threads.publishContainer(container.id)), containerId: container.id };
    } else if (account.platform === 'facebook') {
      if (content.type !== 'text') return { status: 'failed', reason: 'UNSUPPORTED_CONTENT_TYPE' };
      if (!(await beforeFinalMutation(account, { ...context, content }))) return { status: 'failed', reason: 'ASAP_FINAL_MUTATION_BLOCKED' };
      const r = await request(`${account.userId}/feed`, { method: 'POST', params: { message: content.text }, finalMutation: true });
      result = r.ok && r.data.id ? { status: 'published', id: String(r.data.id) } : { status: r.ambiguous || r.ok ? 'ambiguous' : 'failed', reason: r.reason || 'PUBLISH_ID_MISSING' };
    } else {
      if (content.type !== 'image' || !String(content.mediaUrl).startsWith('https://')) return { status: 'failed', reason: 'UNSUPPORTED_CONTENT_TYPE' };
      const limit = await request(`${account.userId}/content_publishing_limit`, { params: { fields: 'config,quota_usage' } });
      if (!limit.ok) return { status: 'failed', reason: 'INSTAGRAM_QUOTA_UNVERIFIED' };
      const quota = limit.data.data?.[0];
      if (quota && Number(quota.quota_usage) >= Number(quota.config?.quota_total || 100)) return { status: 'failed', reason: 'INSTAGRAM_RATE_LIMIT' };
      const created = await request(`${account.userId}/media`, { method: 'POST', params: { image_url: content.mediaUrl, caption: content.text } });
      if (!created.ok || !created.data.id) return { status: 'failed', reason: created.reason || 'CONTAINER_ID_MISSING' };
      const containerId = String(created.data.id);
      let ready = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = await request(containerId, { params: { fields: 'status_code' } });
        if (!state.ok) return { status: 'failed', reason: state.reason, containerId };
        if (state.data.status_code === 'FINISHED') { ready = true; break; }
        if (['ERROR', 'EXPIRED', 'PUBLISHED'].includes(state.data.status_code)) return { status: 'failed', reason: `CONTAINER_${state.data.status_code}`, containerId };
        await sleep(1000);
      }
      if (!ready) return { status: 'failed', reason: 'MEDIA_PROCESSING_PENDING', containerId };
      if (!(await beforeFinalMutation(account, { ...context, content }))) return { status: 'failed', reason: 'ASAP_FINAL_MUTATION_BLOCKED', containerId };
      const published = await request(`${account.userId}/media_publish`, { method: 'POST', params: { creation_id: containerId }, finalMutation: true });
      result = published.ok && published.data.id ? { status: 'published', id: String(published.data.id), containerId } : { status: published.ambiguous || published.ok ? 'ambiguous' : 'failed', reason: published.reason || 'PUBLISH_ID_MISSING', containerId };
    }
    if (result.status === 'published') {
      // A failed readback never triggers another publish. Preserve the confirmed ID.
      const verification = await readback(result.id);
      return { ...result, permalink: verification.permalink || null, readback: verification };
    }
    return result;
  }

  return { platform: account.platform, accountKey: account.key, account, capabilities: { publishPosts: true, publishReplies: false, insights: Boolean(insights), images: account.platform === 'instagram', video: false, carousel: false }, parseWebhook: () => [], publishReply: async () => ({ status: 'failed', reason: 'REPLIES_OUT_OF_CURRENT_SCOPE' }), publishPost, verifyIdentity, readback, ...(insights ? { getAccountInsights: insights.getAccountInsights, getPostInsights: insights.getPostInsights, listRecentPosts: insights.listRecentPosts } : {}), health: () => ({ configured: Boolean(account.userId && account.accessToken), identity, platform: account.platform, accountKey: account.key, insights: insights ? 'available-with-grant' : 'unavailable' }) };
}

module.exports = { createMetaPostProvider };
