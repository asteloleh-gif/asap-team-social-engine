const crypto = require('node:crypto');

const BRANDS = Object.freeze({ asap_gta6: 'asapgta6', asap_katy: 'asapkaty' });
const PLATFORMS = Object.freeze(['threads', 'instagram', 'facebook']);
const FORBIDDEN_NAMES = new Set(['astel.us', 'astel.u', 'leoakastel', 'leo astel', 'олег акастелов']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function loadScope(env = process.env) {
  const brand = String(env.ASAP_BRAND || '').toLowerCase();
  if (!Object.hasOwn(BRANDS, brand)) throw new Error('ASAP_BRAND_REQUIRED');
  const projectId = 'asap-team';
  if (env.SOCIAL_BRAND !== brand) throw new Error('ASAP_SOCIAL_BRAND_MISMATCH');
  const namespace = `asap:${brand}:v1`;
  if (env.ASAP_STATE_NAMESPACE !== namespace) throw new Error('ASAP_STATE_NAMESPACE_REQUIRED');
  if (!env.DATABASE_URL || !env.REDIS_URL) throw new Error('ASAP_ISOLATED_STATE_REQUIRED');
  const db = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || decodeURIComponent(db.pathname.slice(1)) !== brand) throw new Error('ASAP_DEDICATED_DATABASE_REQUIRED');
  if (!['redis:', 'rediss:'].includes(new URL(env.REDIS_URL).protocol)) throw new Error('ASAP_REDIS_URL_INVALID');
  const accounts = [];
  const forbiddenIds = new Set(String(env.ASAP_FORBIDDEN_ACCOUNT_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
  for (const platform of PLATFORMS) {
    const p = platform.toUpperCase();
    if (env[`${p}_ENABLED`] !== 'true') continue;
    const id = String(env[`${p}_USER_ID`] || '');
    const username = String(env[`${p}_USERNAME`] || '').replace(/^@/, '').trim();
    const authMode = platform === 'instagram' ? env.INSTAGRAM_AUTH_MODE : null;
    if (platform === 'instagram' && !['instagram_login', 'facebook_login'].includes(authMode)) throw new Error('ASAP_INSTAGRAM_AUTH_MODE_REQUIRED');
    const apiHost = platform === 'threads' ? 'https://graph.threads.net' : authMode === 'instagram_login' ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
    const apiVersion = platform === 'threads' ? 'v1.0' : env.META_API_VERSION || 'v26.0';
    if (!/^v\d+\.\d+$/.test(apiVersion) || (authMode === 'instagram_login' && apiVersion !== 'v26.0')) throw new Error('ASAP_API_VERSION_INCOMPATIBLE');
    if (env[`${p}_BRAND`] && env[`${p}_BRAND`] !== brand) throw new Error('ASAP_ACCOUNT_BRAND_MISMATCH');
    const token = platform === 'instagram' ? (authMode === 'instagram_login' ? env.INSTAGRAM_ACCESS_TOKEN : (env.INSTAGRAM_FACEBOOK_PAGE_ACCESS_TOKEN || env.FACEBOOK_ACCESS_TOKEN)) : env[`${p}_ACCESS_TOKEN`];
    if (!/^\d+$/.test(id) || (authMode === 'instagram_login' && !/^[1-9]\d*$/.test(id)) || !username || !token) throw new Error(`ASAP_${p}_BINDING_REQUIRED`);
    if (forbiddenIds.has(id) || FORBIDDEN_NAMES.has(username.toLowerCase())) throw new Error('ASTEL_ACCOUNT_FORBIDDEN');
    if (platform !== 'facebook' && username.toLowerCase() !== BRANDS[brand]) throw new Error('ASAP_USERNAME_MISMATCH');
    if (platform === 'facebook' && env.ASAP_FACEBOOK_PAGE_ID !== id) throw new Error('ASAP_FACEBOOK_PAGE_PIN_REQUIRED');
    accounts.push(Object.freeze({ key: `${brand}:${platform}`, brand, platform, userId: id, username, accessToken: token, authMode, apiHost, apiVersion, enabled: true, dryRun: env.ASAP_LIVE_ENABLED !== 'true', language: 'en' }));
  }
  return Object.freeze({ projectId, brand, namespace, accounts: Object.freeze(accounts), live: env.ASAP_LIVE_ENABLED === 'true', maxPostsPerDay: Math.max(1, Math.min(3, Number(env.ASAP_MAX_POSTS_PER_PLATFORM_DAY) || 2)) });
}

function assertAccount(scope, accountKey) {
  const account = scope.accounts.find(a => a.key === accountKey);
  if (!account) throw new Error('ASAP_ACCOUNT_OUT_OF_SCOPE');
  return account;
}

function preflight(env = process.env) {
  const required = ['ASAP_BRAND', 'SOCIAL_BRAND', 'ASAP_STATE_NAMESPACE', 'DATABASE_URL', 'REDIS_URL', 'ASAP_CONTROL_TOKEN'];
  const missing = required.filter(k => !env[k]);
  let reason = null;
  try {
    const scope = loadScope(env);
    if (Buffer.byteLength(env.ASAP_CONTROL_TOKEN || '') < 32) reason = 'ASAP_CONTROL_TOKEN_REQUIRED';
    else if (env.ASAP_ANALYTICS_TOKEN && Buffer.byteLength(env.ASAP_ANALYTICS_TOKEN) < 32) reason = 'ASAP_ANALYTICS_TOKEN_TOO_SHORT';
    else if (!scope.accounts.length) reason = 'ASAP_PLATFORM_BINDING_REQUIRED';
  } catch (e) { reason = e.message; }
  return { ready: !missing.length && !reason && Buffer.byteLength(env.ASAP_CONTROL_TOKEN || '') >= 32, missing, reason, liveRequested: env.ASAP_LIVE_ENABLED === 'true', secretsIncluded: false };
}

module.exports = { BRANDS, PLATFORMS, hash, loadScope, assertAccount, preflight };
