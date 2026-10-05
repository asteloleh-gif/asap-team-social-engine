// Pure preparation only: this module never opens login, requests a grant,
// exchanges a code, creates a token, or installs a credential.
const crypto = require('node:crypto');
const { BRANDS } = require('./scope');
const THREADS_SCOPES = Object.freeze(['threads_basic','threads_content_publish','threads_manage_insights']);

function prepareThreadsAuthorization({ brand, confirmedThreadsAppId, confirmedRedirectUri, registeredRedirectUris, state }) {
  if (!Object.hasOwn(BRANDS, brand)) throw new Error('ASAP_BRAND_REQUIRED');
  if (!/^\d+$/.test(String(confirmedThreadsAppId || ''))) throw new Error('CONFIRMED_THREADS_APP_ID_REQUIRED');
  if (!Array.isArray(registeredRedirectUris) || !registeredRedirectUris.includes(confirmedRedirectUri)) throw new Error('EXACT_REGISTERED_REDIRECT_REQUIRED');
  const redirect = new URL(confirmedRedirectUri);
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash) throw new Error('SECURE_ASAP_REDIRECT_REQUIRED');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(state || ''))) throw new Error('CSRF_STATE_REQUIRED');
  const url = new URL('https://threads.net/oauth/authorize');
  url.search = new URLSearchParams({ client_id:String(confirmedThreadsAppId), redirect_uri:confirmedRedirectUri, scope:THREADS_SCOPES.join(','), response_type:'code', state }).toString();
  return { brand, expectedUsername:BRANDS[brand], authorizationUrl:url.toString(), scopes:[...THREADS_SCOPES], ownerConsentRequired:true, credentialInstallRequiresSecureHandoff:true, mutatesExternalState:false };
}

function verifyReturnedState(expected, returned) {
  const a=Buffer.from(String(expected || '')),b=Buffer.from(String(returned || ''));
  return a.length >=32 && a.length===b.length && crypto.timingSafeEqual(a,b);
}
module.exports={THREADS_SCOPES,prepareThreadsAuthorization,verifyReturnedState};
