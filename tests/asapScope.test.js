const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScope, hash, preflight } = require('../app/asap/scope');
const { packageEnvelope } = require('../app/asap/distributionAdapter');
const { applyStandingGrant } = require('../app/asap/standingGrant');

const base = () => ({ ASAP_PROJECT_ID:'asap-team',ASAP_BRAND:'asap_gta6',SOCIAL_BRAND:'asap_gta6',ASAP_STATE_NAMESPACE:'asap:asap_gta6:v1',DATABASE_URL:'postgresql://test:fixture@localhost/asap_gta6',REDIS_URL:'redis://localhost:6379',THREADS_ENABLED:'true',THREADS_USERNAME:'asapgta6',THREADS_USER_ID:'123',THREADS_ACCESS_TOKEN:'fixture-not-a-real-secret' });
test('ASAP rejects production brand, DB, namespaces and account identities', () => {
 const env=base(); assert.equal(loadScope(env).accounts[0].key,'asap_gta6:threads');
 for (const patch of [{ASAP_BRAND:'astel.us'},{DATABASE_URL:'postgresql://localhost/railway'},{ASAP_STATE_NAMESPACE:'astel:publish:v1'},{THREADS_USERNAME:'astel.us'}]) assert.throws(()=>loadScope({...env,...patch}));
 assert.equal(preflight({}).secretsIncluded,false);
 assert.throws(()=>loadScope({...env,ASAP_FORBIDDEN_ACCOUNT_IDS:'123'}),/ASTEL_ACCOUNT_FORBIDDEN/);
 assert.equal(loadScope({...env,ASAP_PROJECT_ID:'ignored-project'}).projectId,'asap-team');
 assert.throws(()=>loadScope({...env,SOCIAL_BRAND:''}),/ASAP_SOCIAL_BRAND_MISMATCH/);
});
test('content hashes survive PostgreSQL JSONB key order normalization', () => { assert.equal(hash({type:'text',text:'Hello'}),hash({text:'Hello',type:'text'})); });
test('Distribution preview is scoped, exact-version reviewed and has zero AI calls', () => {
 const scope=loadScope(base()); const content={type:'text',text:'Pick one: beach race or city chase?'};
 const input={accountKey:'asap_gta6:threads',envelope:{id:'idea-1',source:'original-opinion',tags:[],hashtags:[]},content,review:{decision:'PASS',reviewer:'Kevin',contentHash:hash(content)}};
 const preview=packageEnvelope(input,scope); assert.equal(preview.cost.aiCalls,0);
 const grant=applyStandingGrant({scope,draft:preview}); assert.equal(grant.perItemHumanReview,false); assert.equal(grant.authorizationSource,'standing-owner-instruction');
 assert.throws(()=>packageEnvelope({...input,accountKey:'astel.us:threads'},scope),/OUT_OF_SCOPE/);
 assert.throws(()=>packageEnvelope({...input,content:{type:'text',text:'Changed'}},scope),/EXACT_VERSION/);
 assert.throws(()=>applyStandingGrant({scope,draft:{...preview,content:{type:'text',text:'Tampered'}}}),/NOT_REVIEWED/);
});
test('both brands require distinct state namespace and dedicated database',()=>{
 const scope=loadScope({...base(),ASAP_BRAND:'asap_katy',SOCIAL_BRAND:'asap_katy',ASAP_STATE_NAMESPACE:'asap:asap_katy:v1',DATABASE_URL:'postgresql://localhost/asap_katy',THREADS_USERNAME:'asapkaty'});
 assert.equal(scope.accounts[0].key,'asap_katy:threads');
});

test('ASAP_PROJECT_ID is an ignored compatibility label and never changes scope',()=>{
 assert.equal(loadScope({...base(),ASAP_PROJECT_ID:''}).projectId,'asap-team');
 assert.equal(loadScope({...base(),ASAP_PROJECT_ID:'untrusted-label'}).projectId,'asap-team');
 assert.equal(preflight({...base(),ASAP_PROJECT_ID:'',ASAP_CONTROL_TOKEN:'control-fixture-'.repeat(3)}).missing.includes('ASAP_PROJECT_ID'),false);
});

test('preflight rejects all-disabled routes with the same readiness reason as startup', async () => {
 const env={...base(),ASAP_CONTROL_TOKEN:'fixture-'.repeat(5),THREADS_ENABLED:'false'};
 assert.equal(preflight(env).ready,false);
 assert.equal(preflight(env).reason,'ASAP_PLATFORM_BINDING_REQUIRED');
 await assert.rejects(()=>require('../server-asap').start(env,{noSignals:true}),/ASAP_PLATFORM_BINDING_REQUIRED/);
});

test('preflight rejects short analytics token with the same reason as startup', async () => {
 const env={...base(),ASAP_CONTROL_TOKEN:'fixture-'.repeat(5),ASAP_ANALYTICS_TOKEN:'short'};
 assert.equal(preflight(env).ready,false);
 assert.equal(preflight(env).reason,'ASAP_ANALYTICS_TOKEN_TOO_SHORT');
 await assert.rejects(()=>require('../server-asap').start(env,{noSignals:true}),/ASAP_ANALYTICS_TOKEN_TOO_SHORT/);
});

test('preflight accepts a bound fixture with valid separate control and analytics tokens',()=>{
 const env={...base(),ASAP_CONTROL_TOKEN:'control-fixture-'.repeat(3),ASAP_ANALYTICS_TOKEN:'analytics-fixture-'.repeat(3)};
 assert.equal(preflight(env).ready,true);
 assert.equal(preflight(env).reason,null);
});
