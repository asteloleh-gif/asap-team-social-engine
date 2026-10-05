// ContentEnvelope compatibility from the selected Lazy Distribution source.
// Deliberately pure: preview has no AI, network, credential or publish effects.
const { assertAccount, hash } = require('./scope');

function packageEnvelope({ envelope, accountKey, content, review }, scope) {
  const account = assertAccount(scope, accountKey);
  if (!envelope || !String(envelope.id || '').trim() || !String(envelope.source || '').trim()) throw new Error('CONTENT_ENVELOPE_REQUIRED');
  if (!Array.isArray(envelope.tags) || !Array.isArray(envelope.hashtags)) throw new Error('CONTENT_ENVELOPE_ARRAYS_REQUIRED');
  const clean = { type: String(content?.type || 'text'), text: String(content?.text || '').trim() };
  if (clean.type === 'image') clean.mediaUrl = String(content?.mediaUrl || '');
  if (!clean.text || (account.platform === 'threads' && clean.text.length > 500)) throw new Error('ASAP_CONTENT_TEXT_INVALID');
  if (account.platform === 'instagram' && clean.type !== 'image') throw new Error('ASAP_INSTAGRAM_IMAGE_REQUIRED');
  if (account.platform !== 'instagram' && clean.type !== 'text') throw new Error('ASAP_FORMAT_NOT_IMPLEMENTED');
  if (clean.type === 'image') {
    const url = new URL(clean.mediaUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ASAP_PUBLIC_HTTPS_MEDIA_REQUIRED');
    if (envelope.mediaRights !== 'owned-or-authorized') throw new Error('ASAP_MEDIA_RIGHTS_REQUIRED');
  }
  const contentHash = hash(clean);
  if (review?.decision !== 'PASS' || review?.contentHash !== contentHash || !review?.reviewer) throw new Error('ASAP_EXACT_VERSION_REVIEW_REQUIRED');
  return { projectId: scope.projectId, brandId: scope.brand, accountKey, contentId: String(envelope.id), version: Number(envelope.version || 1), content: clean, contentHash, envelope: { source: envelope.source, id: envelope.id, url: envelope.url || '', title: envelope.title || '', description: envelope.description || '', tags: envelope.tags, hashtags: envelope.hashtags, thumbnailUrl: envelope.thumbnailUrl || '', topicFamilyId: envelope.topicFamilyId || null, sourceRecheckedAt: envelope.sourceRecheckedAt || null }, review: { decision: 'PASS', reviewer: String(review.reviewer), contentHash }, cost: { aiCalls: 0, apiCost: 'unknown', workerCost: 'unknown' } };
}

module.exports = { packageEnvelope };
