// Run only against a newly created throwaway local Postgres/Redis instance.
const assert=require('node:assert/strict');const{once}=require('node:events');const{start}=require('../server-asap');const{hash}=require('../app/asap/scope');const{checkLocal}=require('./asap-storage-integration');
async function main(){
 if(process.env.ASAP_TEST_STORAGE_IS_THROWAWAY!=='true')throw Error('EXPLICIT_THROWAWAY_STORAGE_GUARD_REQUIRED');
 checkLocal(process.env.ASAP_TEST_DATABASE_URL,['postgres:','postgresql:'],5432);checkLocal(process.env.ASAP_TEST_REDIS_URL,['redis:','rediss:'],6379);
 const token='local-fixture-only-not-a-real-credential-xxxxxxxx';let publicationCalls=0,runtime=null;
 const env={ASAP_BRAND:'asap_gta6',SOCIAL_BRAND:'asap_gta6',ASAP_STATE_NAMESPACE:'asap:asap_gta6:v1',DATABASE_URL:process.env.ASAP_TEST_DATABASE_URL,REDIS_URL:process.env.ASAP_TEST_REDIS_URL,ASAP_CONTROL_TOKEN:token,ASAP_LIVE_ENABLED:'false',THREADS_ENABLED:'true',THREADS_USER_ID:'123',THREADS_USERNAME:'asapgta6',THREADS_ACCESS_TOKEN:'unused-fixture',HOST:'127.0.0.1',PORT:'0'};
 const dependencies={noSignals:true,providerFactory:({account})=>({account,accountKey:account.key,platform:'threads',capabilities:{publishPosts:true},health:()=>({configured:true}),parseWebhook:()=>[],publishReply:async()=>assert.fail('no reply calls'),publishPost:async()=>{publicationCalls++;assert.fail('no post calls');},verifyIdentity:async()=>({verified:true,fixture:true})})};
 async function open(){runtime=await start(env,dependencies);if(!runtime.server.listening)await once(runtime.server,'listening');return`http://127.0.0.1:${runtime.server.address().port}/internal/asap`;}
 let base=await open();
 async function request(path,body,key,authorized=true){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(authorized?{authorization:`Bearer ${token}`}:{authorization:'Bearer invalid-fixture'}),'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
 try{
  assert.equal((await request('/status',undefined,null,false)).status,401);assert.equal((await request('/status')).body.paused,true);
  const content={type:'text',text:'Local integration fixture only'};const input={accountKey:'asap_gta6:threads',envelope:{id:'local-http-fixture',source:'fixture',tags:[],hashtags:[]},content,review:{decision:'PASS',reviewer:'local fixture',contentHash:hash(content)}};
  assert.equal((await request('/drafts',input,null)).status,400);
  const draft=await request('/drafts',input,'local-draft');assert.equal(draft.status,200);assert.equal((await request('/drafts',input,'local-draft')).body.draftId,draft.body.draftId);
  const schedule={draftId:draft.body.draftId,contentHash:draft.body.contentHash,scheduledAt:new Date().toISOString()};
  assert.equal((await request('/schedule',{...schedule,contentHash:'wrong'},'wrong-hash')).status,400);
  const scheduled=await request('/schedule',schedule,'local-schedule');assert.equal(scheduled.status,200);assert.equal(scheduled.body.grant.perItemHumanReview,false);
  assert.equal((await request('/schedule',schedule,'local-schedule')).body.jobId,scheduled.body.jobId);
  await request('/resume',{},'local-resume');await runtime.publishEngine.tick();assert.equal((await request(`/jobs/${scheduled.body.jobId}`)).body.status,'SIMULATED');
  await request('/pause',{},'local-pause');await runtime.close();runtime=null;base=await open();assert.equal((await request('/status')).body.paused,true);assert.equal((await request(`/jobs/${scheduled.body.jobId}`)).body.status,'SIMULATED');assert.equal(publicationCalls,0);
  console.log(JSON.stringify({status:'PASS',checks:['HTTP bearer authentication','missing idempotency rejected','exact-hash prepared draft persisted','schedule replay retains job ID','standing approval does not claim per-item human review','real queue dry-run','pause and job survive complete app recreation'],externalPublicationCalls:publicationCalls,identityChecks:'injected fixture; no real platform identity claim'},null,2));
 }finally{if(runtime)await runtime.close();}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAIL',reason:/^[A-Z_]+$/.test(e.message)?e.message:'HTTP_STORAGE_INTEGRATION_ASSERTION_FAILED'}));process.exitCode=1;});
