const crypto = require('node:crypto');
const { hash, BRANDS } = require('./scope');

function prepareVariant({ wave, variantId, binding, reviewedBy, sourceRecheckedAt, media = null }) {
  const item = wave?.items?.find(x => x.variants?.some(v => v.variant_id === variantId));
  const variant = item?.variants.find(v => v.variant_id === variantId);
  if (!item || !variant) throw new Error('ASAP_VARIANT_NOT_FOUND');
  const brand = String(item.brand_id).toLowerCase();
  if (!Object.hasOwn(BRANDS, brand) || binding?.brandId !== brand || binding?.platform !== variant.platform || binding?.accountKey !== `${brand}:${variant.platform}` || !binding?.apiVerified || !binding?.platformUserId) throw new Error('ASAP_VERIFIED_BINDING_REQUIRED');
  const lastChecked = Date.parse(binding.verifiedAt);
  if (!Number.isFinite(lastChecked) || Date.now() - lastChecked > 24 * 3600 * 1000 || lastChecked > Date.now() + 60000) throw new Error('ASAP_BINDING_RECHECK_REQUIRED');
  const sourceChecked = Date.parse(sourceRecheckedAt);
  if (!reviewedBy || !Number.isFinite(sourceChecked) || sourceChecked > Date.now() + 60000 || Date.now() - sourceChecked > 24 * 3600 * 1000) throw new Error('ASAP_EDITORIAL_PREFLIGHT_REQUIRED');
  if (crypto.createHash('sha256').update(variant.text).digest('hex') !== variant.text_sha256) throw new Error('ASAP_MARKETING_TEXT_HASH_MISMATCH');
  const content = { type: variant.platform === 'instagram' ? 'image' : 'text', text: variant.text };
  if (content.type === 'image') {
    if (!media || media.assetSha256 !== item.asset?.sha256 || media.rights !== 'owned-or-authorized' || !String(media.publicUrl || '').startsWith('https://')) throw new Error('ASAP_MEDIA_STAGING_AND_RIGHTS_REQUIRED');
    content.mediaUrl = media.publicUrl;
  }
  return { accountKey: binding.accountKey, envelope: { source: item.claim_class, id: variant.variant_id, version: item.content_version, url: item.source_urls?.[0] || '', title: item.content_id, description: variant.text, tags: [], hashtags: [], thumbnailUrl: media?.publicUrl || '', mediaRights: media?.rights, topicFamilyId: item.topic_family_id, sourceRecheckedAt }, content, review: { decision: 'PASS', reviewer: reviewedBy, contentHash: hash(content) } };
}
module.exports = { prepareVariant };
