const fetch = require('node-fetch');
const { createThreadsPostPublisher } = require('../../adapters/threadsPostPublisher');
const { createThreadsInsightsAdapter } = require('../../adapters/threadsInsightsAdapter');
const { BRANDS } = require('./scope');

const professionalId = value => (typeof value === 'string' && /^[1-9]\d*$/.test(value)) || (Number.isSafeInteger(value) && value > 0);
function instagramIdentity(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const valid = value => value && professionalId(value.user_id) && typeof value.username === 'string' && value.username.trim();
  if (!Object.hasOwn(data, 'data')) return valid(data) ? data : null;
  if (!Array.isArray(data.data) || data.data.length !== 1 || !valid(data.data[0])) return null;
  const candidate = data.data[0];
  if (['user_id', 'username', 'id'].some(key => Object.hasOwn(data, key))) {
    if (!valid(data) || ['user_id', 'username', 'id'].some(key => Object.hasOwn(data, key) && String(data[key]) !== String(candidate[key]))) return null;
  }
  return candidate;
}

function publicationWarnings(data) {
  if (!data.warnings && !data.error) return [];
  const input = [...(Array.isArray(data.warnings) ? data.warnings : data.warnings ? [data.warnings] : []), ...(data.error ? [data.error] : [])];
  return [...new Set(input.map(item => {
    const code = typeof item === 'string' ? item : item?.code || item?.type;
    return ['CAPTION_NOT_ATTACHED', 'USER_TAGGING_FAILURE'].includes(code) ? code : 'PUBLISH_WARNING_REQUIRES_RECONCILIATION';
  }))];
}

function createMetaPostProvider({ account, fetchImpl = fetch, apiVersion, sleep = ms => new Promise(r => setTimeout(r, ms)), beforePublish = async () => true, beforeFinalMutation = async () => true } = {}) {
  // Snapshot scope values; caller mutations must never switch token, owner or route.
  account = Object.freeze({ ...account });
  const instagramLogin = account.platform === 'instagram' && account.authMode === 'instagram_login';
  const host = account.platform === 'threads' ? 'https://graph.threads.net' : instagramLogin ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
  const version = account.platform === 'threads' ? 'v1.0' : account.apiVersion || apiVersion || 'v26.0';
  if (!/^v\d+\.\d+$/.test(version) || (account.apiHost && account.apiHost !== host) || (account.apiVersion && apiVersion && account.apiVersion !== apiVersion)) throw new Error('ASAP_PROVIDER_ROUTE_MISMATCH');
  if (account.platform === 'instagram' && account.authMode && !['facebook_login', 'instagram_login'].includes(account.authMode)) throw new Error('ASAP_INSTAGRAM_AUTH_MODE_REQUIRED');
  if (instagramLogin && (version !== 'v26.0' || !professionalId(account.userId) || !account.accessToken || !BRANDS[account.brand] || account.key !== `${account.brand}:instagram` || account.username?.toLowerCase() !== BRANDS[account.brand])) throw new Error('ASAP_INSTAGRAM_BINDING_INVALID');
  const base = `${host}/${version}`;
  const headers = Object.freeze({ Authorization: `Bearer ${account.accessToken}` });
  const threads = account.platform === 'threads' ? createThreadsPostPublisher({ fallbackAccessToken: account.accessToken, fetchImpl, sleep }) : null;
  const insights = account.platform === 'threads' ? createThreadsInsightsAdapter({ fallbackAccessToken: account.accessToken, fetchImpl }) : null;
  let identity = { verified: false };

  async function request(path, { method = 'GET', params = {}, finalMutation = false } = {}) {
    const query = new URLSearchParams(params);
    const url = `${base}/${path}${method === 'GET' && query.size ? `?${query}` : ''}`;
    try {
      const response = await fetchImpl(url, { method, headers, ...(method === 'POST' ? { body: query } : {}), timeout: 20_000 });
      const data = await response.json().catch(() => null);
      if (response.ok && data && (!data.error || (finalMutation && data.id))) return { ok: true, data };
      const code = Number.isSafeInteger(data?.error?.code) ? `META_${data.error.code}` : `HTTP_${Number.isInteger(response.status) ? response.status : 'UNKNOWN'}`;
      return { ok: false, ambiguous: finalMutation && (response.status === 429 || response.status >= 500 || response.ok), reason: code };
    } catch (_) { return { ok: false, ambiguous: finalMutation, reason: 'NETWORK_OUTCOME_UNKNOWN' }; }
  }

  async function verifyIdentity() {
    const platform = account.platform;
    const r = await request(platform === 'instagram' && !instagramLogin ? account.userId : 'me', { params: { fields: instagramLogin ? 'user_id,username' : platform === 'facebook' ? 'id,name' : 'id,username' } });
    const candidate = instagramLogin ? instagramIdentity(r.data) : r.data;
    const match = r.ok && candidate && String(instagramLogin ? candidate.user_id : candidate.id) === String(account.userId) && (platform === 'facebook' || String(candidate.username || '').toLowerCase() === account.username.toLowerCase());
    identity = { verified: Boolean(match), checkedAt: new Date().toISOString(), reason: match ? null : (r.reason || 'IDENTITY_MISMATCH') };
    if (match && instagramLogin) identity = { ...identity, publishingUserId: String(candidate.user_id), appScopedId: candidate.id == null ? null : String(candidate.id) };
    return identity;
  }

  async function readback(id) {
    const platform = account.platform;
    if (!/^[A-Za-z0-9_.-]+$/.test(String(id))) return { verified: false, reason: 'READBACK_ID_INVALID' };
    if (instagramLogin && !(await verifyIdentity()).verified) return { verified: false, reason: 'ACCOUNT_IDENTITY_UNVERIFIED' };
    const fields = platform === 'facebook' ? 'id,permalink_url,from,message,created_time' : platform === 'threads' ? 'id,permalink,owner,username,text,timestamp' : instagramLogin ? 'id,media_type,owner,permalink,username,timestamp' : 'id,permalink,username,caption,timestamp';
    const r = await request(String(id), { params: { fields } });
    if (!r.ok || String(r.data.id) !== String(id)) return { verified: false, reason: r.reason || 'READBACK_ID_MISMATCH' };
    const ownerId = instagramLogin ? r.data.owner?.id : (r.data.owner?.id || r.data.from?.id);
    if (instagramLogin && (!professionalId(ownerId) || String(ownerId) !== account.userId)) return { verified: false, reason: ownerId ? 'READBACK_OWNER_MISMATCH' : 'READBACK_OWNER_UNAVAILABLE' };
    if (instagramLogin && r.data.media_type !== 'IMAGE') return { verified: false, reason: 'READBACK_MEDIA_TYPE_MISMATCH' };
    if (ownerId && String(ownerId) !== account.userId) return { verified: false, reason: 'READBACK_OWNER_MISMATCH' };
    if (r.data.username && String(r.data.username).toLowerCase() !== account.username.toLowerCase()) return { verified: false, reason: 'READBACK_USERNAME_MISMATCH' };
    if ((platform === 'facebook' && !ownerId) || (platform !== 'facebook' && !r.data.username && !ownerId)) return { verified: false, reason: 'READBACK_OWNER_UNAVAILABLE' };
    const permalink = r.data.permalink || r.data.permalink_url || null;
    return { verified: Boolean(permalink), permalink, id: String(id), contentText: instagramLogin ? null : r.data.text ?? r.data.message ?? r.data.caption ?? null, publishedAt: r.data.timestamp || r.data.created_time || null, checkedAt: new Date().toISOString(), reason: permalink ? null : 'PERMALINK_UNAVAILABLE' };
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
      const quota = Array.isArray(limit.data.data) && limit.data.data.length === 1 ? limit.data.data[0] : null;
      if (!quota || !Number.isSafeInteger(quota.quota_usage) || quota.quota_usage < 0 || !Number.isSafeInteger(quota.config?.quota_total) || quota.config.quota_total <= 0 || !Number.isSafeInteger(quota.config?.quota_duration) || quota.config.quota_duration <= 0) return { status: 'failed', reason: 'INSTAGRAM_QUOTA_UNVERIFIED' };
      if (quota.quota_usage >= quota.config.quota_total) return { status: 'failed', reason: 'INSTAGRAM_RATE_LIMIT' };
      if (!(await beforeFinalMutation(account, { ...context, content }))) return { status: 'failed', reason: 'ASAP_FINAL_MUTATION_BLOCKED' };
      const created = await request(`${account.userId}/media`, { method: 'POST', params: { image_url: content.mediaUrl, caption: content.text } });
      if (!created.ok || !/^[A-Za-z0-9_.-]+$/.test(String(created.data?.id || ''))) return { status: 'failed', reason: created.reason || 'CONTAINER_ID_MISSING' };
      const containerId = String(created.data.id);
      let ready = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = await request(containerId, { params: { fields: instagramLogin ? 'id,status_code,status' : 'status_code' } });
        if (!state.ok) return { status: 'failed', reason: state.reason, containerId };
        if (instagramLogin && String(state.data.id) !== containerId) return { status: 'failed', reason: 'CONTAINER_ID_MISMATCH', containerId };
        if (state.data.status_code === 'FINISHED') { ready = true; break; }
        if (state.data.status_code === 'PUBLISHED') return { status: 'ambiguous', reason: 'CONTAINER_PUBLISHED', containerId };
        if (['ERROR', 'EXPIRED'].includes(state.data.status_code)) return { status: 'failed', reason: `CONTAINER_${state.data.status_code}`, containerId };
        if (state.data.status_code !== 'IN_PROGRESS') return { status: 'failed', reason: 'CONTAINER_STATUS_UNKNOWN', containerId };
        await sleep(1000);
      }
      if (!ready) return { status: 'failed', reason: 'MEDIA_PROCESSING_PENDING', containerId };
      if (!(await beforeFinalMutation(account, { ...context, content }))) return { status: 'failed', reason: 'ASAP_FINAL_MUTATION_BLOCKED', containerId };
      const published = await request(`${account.userId}/media_publish`, { method: 'POST', params: { creation_id: containerId }, finalMutation: true });
      const mediaId = String(published.data?.id || '');
      result = published.ok && /^[A-Za-z0-9_.-]+$/.test(mediaId) && mediaId !== containerId ? { status: 'published', id: mediaId, containerId, warnings: publicationWarnings(published.data) } : { status: published.ambiguous || published.ok ? 'ambiguous' : 'failed', reason: published.reason || (mediaId === containerId ? 'PUBLISH_ID_IS_CONTAINER' : 'PUBLISH_ID_MISSING'), containerId };
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
