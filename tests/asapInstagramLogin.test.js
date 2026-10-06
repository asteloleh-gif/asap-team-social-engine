const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadScope, preflight } = require('../app/asap/scope');
const { createMetaPostProvider } = require('../app/asap/metaPostProvider');
const { createPublishEngine } = require('../app/publishing/publishEngine');
const { reconcileJob } = require('../app/asap/reconcile');
const env = patch => ({ ASAP_BRAND:'asap_gta6', SOCIAL_BRAND:'asap_gta6', ASAP_STATE_NAMESPACE:'asap:asap_gta6:v1', DATABASE_URL:'postgresql://fixture:fixture@localhost/asap_gta6', REDIS_URL:'redis://localhost:6379', ASAP_CONTROL_TOKEN:'synthetic-control-'.repeat(3), INSTAGRAM_ENABLED:'true', INSTAGRAM_AUTH_MODE:'instagram_login', INSTAGRAM_USER_ID:'123', INSTAGRAM_USERNAME:'asapgta6', INSTAGRAM_ACCESS_TOKEN:'synthetic-instagram-token', INSTAGRAM_FACEBOOK_PAGE_ACCESS_TOKEN:'synthetic-page-token', FACEBOOK_ACCESS_TOKEN:'synthetic-facebook-token', ...patch });
const content = {type:'image',text:'Synthetic original caption',mediaUrl:'https://example.test/owned.jpg'};
const response = (data,status=200) => ({ok:status>=200&&status<300,status,json:async()=>data});
function fixture({mode='instagram_login',identity={id:'987',user_id:'123',username:'asapgta6'},quota={data:[{quota_usage:0,config:{quota_total:25,quota_duration:86400}}]},statuses=['FINISHED'],published={id:'media-456'},readback={id:'media-456',media_type:'IMAGE',owner:{id:'123'},username:'asapgta6',permalink:'https://www.instagram.com/p/synthetic/',timestamp:'2026-10-06T12:00:00Z'},beforePublish,beforeFinalMutation}={}) {
 const calls=[];let polls=0;
 const account=loadScope(env({INSTAGRAM_AUTH_MODE:mode,ASAP_LIVE_ENABLED:'true'})).accounts[0];
 const provider=createMetaPostProvider({account,sleep:async()=>{},beforePublish,beforeFinalMutation,fetchImpl:async(url,options)=>{
  calls.push({url,options});const u=new URL(url);const leaf=u.pathname.split('/').pop();
  if(leaf==='me'||leaf==='123')return response(identity);
  if(leaf==='content_publishing_limit')return response(quota);
  if(leaf==='media')return response({id:'container-789'});
  if(leaf==='container-789')return response({id:'container-789',status_code:statuses[Math.min(polls++,statuses.length-1)]});
  if(leaf==='media_publish'){if(published instanceof Error)throw published;return response(published);}
  if(leaf==='media-456')return response(readback);
  assert.fail(`Unexpected synthetic route ${url}`);
 }});
 return {account,provider,calls,writes:()=>calls.filter(c=>c.options.method==='POST'),finalWrites:()=>calls.filter(c=>c.url.endsWith('/media_publish'))};
}

test('validated modes select exclusive tokens and immutable host/version/account binding',()=>{
 const ig=loadScope(env()).accounts[0];assert.equal(ig.accessToken,'synthetic-instagram-token');assert.equal(ig.authMode,'instagram_login');assert.equal(ig.apiHost,'https://graph.instagram.com');assert.equal(ig.apiVersion,'v26.0');assert.equal(Object.isFrozen(ig),true);
 const fb=loadScope(env({INSTAGRAM_AUTH_MODE:'facebook_login'})).accounts[0];assert.equal(fb.accessToken,'synthetic-page-token');assert.equal(fb.apiHost,'https://graph.facebook.com');
 assert.equal(loadScope(env({INSTAGRAM_AUTH_MODE:'facebook_login',INSTAGRAM_FACEBOOK_PAGE_ACCESS_TOKEN:''})).accounts[0].accessToken,'synthetic-facebook-token');
 assert.equal(preflight(env()).ready,true);
});
for(const [label,patch] of Object.entries({no_instagram_token:{INSTAGRAM_ACCESS_TOKEN:''},missing_mode:{INSTAGRAM_AUTH_MODE:''},unsupported_mode:{INSTAGRAM_AUTH_MODE:'other'},old_version:{META_API_VERSION:'v25.0'},bad_version:{META_API_VERSION:'v26.0/else'},brand:{INSTAGRAM_BRAND:'asap_katy'},username:{INSTAGRAM_USERNAME:'asapkaty'},wrong_brand:{ASAP_BRAND:'asap_katy'},bad_id:{INSTAGRAM_USER_ID:'app-id'}}))test(`preflight fails closed for ${label} with no Facebook fallback`,async()=>{
 const input=env(patch);assert.equal(preflight(input).ready,false);await assert.rejects(require('../server-asap').start(input,{noSignals:true}));
});

test('provider snapshots configuration and rejects host/version/brand overrides',async()=>{
 const source={...loadScope(env()).accounts[0]};const calls=[];const p=createMetaPostProvider({account:source,fetchImpl:async(u,o)=>{calls.push({u,o});return response({user_id:'123',username:'asapgta6'});}});
 source.userId='999';source.accessToken='changed-token';source.authMode='facebook_login';source.apiHost='https://evil.test';
 assert.equal((await p.verifyIdentity()).verified,true);assert.equal(p.account.userId,'123');assert.equal(calls[0].o.headers.Authorization,'Bearer synthetic-instagram-token');assert.equal(new URL(calls[0].u).origin,'https://graph.instagram.com');
 for(const patch of [{apiHost:'https://graph.facebook.com'},{apiVersion:'v25.0'},{brand:'asap_katy'},{key:'asap_katy:instagram'},{username:'asapkaty'}])assert.throws(()=>createMetaPostProvider({account:{...p.account,...patch}}));
 assert.throws(()=>createMetaPostProvider({account:p.account,apiVersion:'v25.0'}));
});
for(const [label,identity] of Object.entries({flat:{id:'987',user_id:'123',username:'asapgta6'},wrapped:{data:[{id:'987',user_id:'123',username:'asapgta6'}]},matching_both:{id:'987',user_id:'123',username:'asapgta6',data:[{id:'987',user_id:'123',username:'asapgta6'}]}}))test(`token-owned /me ${label} normalizes user_id and keeps unequal app-scoped ID separate`,async()=>{
 const f=fixture({identity});const r=await f.provider.verifyIdentity();assert.equal(r.verified,true);assert.equal(r.publishingUserId,'123');assert.equal(r.appScopedId,'987');assert.equal(f.calls[0].url,'https://graph.instagram.com/v26.0/me?fields=user_id%2Cusername');
});
for(const [label,identity] of Object.entries({app_id_only:{id:'123',username:'asapgta6'},missing_username:{user_id:'123'},bad_user_id:{user_id:'app',username:'asapgta6'},zero_id:{user_id:0,username:'asapgta6'},unsafe_number:{user_id:9007199254740992,username:'asapgta6'},wrong_account:{user_id:'999',username:'asapgta6'},wrong_username:{user_id:'123',username:'asapkaty'},empty:{data:[]},multiple:{data:[{user_id:'123',username:'asapgta6'},{user_id:'123',username:'asapgta6'}]},bad_data:{data:{user_id:'123',username:'asapgta6'}},conflicting:{user_id:'999',username:'asapgta6',data:[{user_id:'123',username:'asapgta6'}]},partial_conflict:{id:'999',data:[{id:'987',user_id:'123',username:'asapgta6'}]}}))test(`unsafe ${label} identity blocks every mutation`,async()=>{
 const f=fixture({identity});const r=await f.provider.publishPost(content);assert.equal(r.reason,'ACCOUNT_IDENTITY_UNVERIFIED');assert.equal(f.writes().length,0);
});

test('Instagram Login uses bearer auth and v26.0 throughout all six routes, with distinct IDs and supported readback fields',async()=>{
 const f=fixture({statuses:['IN_PROGRESS','FINISHED']});const r=await f.provider.publishPost(content);assert.equal(r.status,'published');assert.equal(r.containerId,'container-789');assert.equal(r.id,'media-456');assert.equal(r.readback.verified,true);assert.equal(r.readback.contentText,null);
 for(const c of f.calls){const u=new URL(c.url);assert.equal(u.origin,'https://graph.instagram.com');assert.ok(u.pathname.startsWith('/v26.0/'));assert.equal(c.options.headers.Authorization,'Bearer synthetic-instagram-token');assert.doesNotMatch(c.url,/token|access_token/);assert.doesNotMatch(String(c.options.body||''),/synthetic-instagram-token/);}
 const quota=f.calls.find(c=>c.url.includes('/content_publishing_limit'));assert.equal(new URL(quota.url).searchParams.get('fields'),'config,quota_usage');
 const create=f.calls.find(c=>c.url.endsWith('/123/media'));assert.equal(create.options.body.get('image_url'),content.mediaUrl);assert.equal(create.options.body.get('caption'),content.text);
 const status=f.calls.find(c=>c.url.includes('/container-789?'));assert.equal(new URL(status.url).searchParams.get('fields'),'id,status_code,status');
 const publish=f.finalWrites()[0];assert.equal(publish.options.body.get('creation_id'),'container-789');
 const rb=f.calls.find(c=>c.url.includes('/media-456?'));assert.equal(new URL(rb.url).searchParams.get('fields'),'id,media_type,owner,permalink,username,timestamp');assert.equal(f.finalWrites().length,1);
});

test('Facebook Login retains Page token, facebook host, configured-account probe and caption readback',async()=>{
 const f=fixture({mode:'facebook_login',identity:{id:'123',username:'asapgta6'},readback:{id:'media-456',username:'asapgta6',caption:content.text,permalink:'https://www.instagram.com/p/synthetic/'}});const r=await f.provider.publishPost(content);
 assert.equal(r.readback.verified,true);assert.equal(r.readback.contentText,content.text);assert.ok(f.calls.every(c=>new URL(c.url).origin==='https://graph.facebook.com'));assert.ok(f.calls.every(c=>c.options.headers.Authorization==='Bearer synthetic-page-token'));assert.match(f.calls[0].url,/\/123\?fields=id%2Cusername/);assert.match(f.calls.at(-1).url,/caption/);
});
for(const [label,quota] of Object.entries({empty:{data:[]},multiple:{data:[{},{}]},no_config:{data:[{quota_usage:0}]},no_duration:{data:[{quota_usage:0,config:{quota_total:50}}]},alias_only:{data:[{quota_usage:0,rate_limit_settings:{quota_total:50,quota_duration:86400}}]},negative:{data:[{quota_usage:-1,config:{quota_total:25,quota_duration:86400}}]},string:{data:[{quota_usage:'0',config:{quota_total:25,quota_duration:86400}}]},zero_total:{data:[{quota_usage:0,config:{quota_total:0,quota_duration:86400}}]},bad_duration:{data:[{quota_usage:0,config:{quota_total:25,quota_duration:-1}}]},exhausted:{data:[{quota_usage:25,config:{quota_total:25,quota_duration:86400}}]}}))test(`quota ${label} fails before container creation`,async()=>{
 const f=fixture({quota});const r=await f.provider.publishPost(content);assert.equal(r.status,'failed');assert.equal(f.writes().length,0);
});
for(const [label,statuses,expected] of [['error',['ERROR'],'failed'],['expired',['EXPIRED'],'failed'],['published',['PUBLISHED'],'ambiguous'],['unknown',['NOT_DOCUMENTED'],'failed'],['pending',['IN_PROGRESS'],'failed']])test(`container ${label} never invokes publication`,async()=>{
 const f=fixture({statuses});assert.equal((await f.provider.publishPost(content)).status,expected);assert.equal(f.finalWrites().length,0);
});
for(const [label,patch] of Object.entries({missing_owner:{owner:undefined},app_scoped_owner:{owner:{id:'987'}},wrong_owner:{owner:{id:'999'}},wrong_username:{username:'asapkaty'},wrong_id:{id:'different'},wrong_type:{media_type:'VIDEO'}}))test(`readback ${label} preserves receipt without a second publication`,async()=>{
 const base={id:'media-456',media_type:'IMAGE',owner:{id:'123'},username:'asapgta6',permalink:'https://www.instagram.com/p/synthetic/'};const g=fixture({readback:{...base,...patch}});const r=await g.provider.publishPost(content);assert.equal(r.status,'published');assert.equal(r.id,'media-456');assert.equal(r.readback.verified,false);assert.equal(g.finalWrites().length,1);
});

test('pause fence checks before container and final publication without another quota reservation',async()=>{
 let paused=false,reserves=0,checks=0;const f=fixture({beforePublish:async()=>{reserves++;return true;},beforeFinalMutation:async()=>{checks++;if(checks===2)paused=true;return !paused;}});
 const r=await f.provider.publishPost(content);assert.equal(r.reason,'ASAP_FINAL_MUTATION_BLOCKED');assert.equal(f.finalWrites().length,0);assert.equal(reserves,1);assert.equal(checks,2);
 const g=fixture({beforeFinalMutation:async()=>false});assert.equal((await g.provider.publishPost(content)).reason,'ASAP_FINAL_MUTATION_BLOCKED');assert.equal(g.writes().length,0);
});
for(const [label,published] of [['network',new Error('synthetic-instagram-token')],['missing_id',{}],['container_id',{id:'container-789'}]])test(`ambiguous ${label} never retries final publication or leaks transport errors`,async()=>{
 const f=fixture({published});const r=await f.provider.publishPost(content);assert.equal(r.status,'ambiguous');assert.equal(f.finalWrites().length,1);assert.doesNotMatch(JSON.stringify(r),/synthetic-instagram-token/);
});

test('successful-publication warnings are sanitized, durably retained and never retried by the engine',async()=>{
 const f=fixture({published:{id:'media-456',warnings:[{code:'CAPTION_NOT_ATTACHED',message:'synthetic-instagram-token'},{message:'synthetic-instagram-token'}]}});
 let job={id:'job-1',accountKey:f.account.key,status:'PENDING',content,metadata:{},result:{}};
 const repository={isReady:()=>true,claim:async()=>{if(job.status!=='PENDING')return false;job.status='PROCESSING';return true;},get:async()=>job,finish:async(_id,_claim,status,o)=>{job={...job,status,result:o.result};return true;}};
 const engine=createPublishEngine({providerRegistry:{findForAccount:()=>f.provider},repository,enabled:true,dryRun:false});
 assert.equal((await engine.processJob(job.id)).status,'published');assert.deepEqual(job.result.warnings,['CAPTION_NOT_ATTACHED','PUBLISH_WARNING_REQUIRES_RECONCILIATION']);assert.equal((await engine.processJob(job.id)).reason,'CLAIM_REJECTED');assert.equal(f.finalWrites().length,1);assert.doesNotMatch(JSON.stringify(job.result),/synthetic-instagram-token/);
});

test('Instagram Login reconciliation stays held when supported API has no caption proof',async()=>{
 const f=fixture();let commits=0;await assert.rejects(reconcileJob({scope:loadScope(env()),job:{id:'held',accountKey:f.account.key,status:'AMBIGUOUS_HOLD',content,createdAt:'2026-10-06T11:59:00Z',result:{}},platformPostId:'media-456',provider:f.provider,repository:{reconcilePublished:async()=>{commits++;return true;}}}),/CONTENT_UNVERIFIED/);assert.equal(commits,0);assert.equal(f.writes().length,0);
});

// Exercise the real composition root with disposable dependency doubles, never a
// real DB, Redis, credential or Meta endpoint. The scoped provider is the real one.
function runtimeHarness() {
 const module={exports:{}};const captured=[];let initialized=0;
 const ready={init:async()=>{initialized++;},isReady:()=>true,query:async()=>({rows:[]}),close:async()=>{},quit:async()=>{}};
 const dummyEngine={start:async()=>{},stop:async()=>{},health:()=>({})};
 const replacements={
  './app/db/postgresStore':{createPostgresStore:()=>ready},
  './app/db/durableRepository':{createDurableRepository:()=>({...ready,syncAccounts:async()=>{}})},
  './app/asap/state':{createAsapState:()=>({...ready,isPaused:async()=>true,reserve:async()=>true})},
  './app/publishing/publishRepository':{createPublishRepository:()=>ready},
  './app/publishing/durablePublishRepository':{createDurablePublishRepository:()=>ready},
  './app/publishing/publishEngine':{createPublishEngine:()=>dummyEngine},
  './app/content/contentControlStore':{createContentControlStore:()=>ready},
  './app/content/contentRepository':{createContentRepository:()=>({})},
  './app/analytics/analyticsRepository':{createAnalyticsRepository:()=>({})},
  './app/analytics/analyticsEngine':{createAnalyticsEngine:()=>dummyEngine},
  './app/asap/metaPostProvider':{createMetaPostProvider:options=>{const p=createMetaPostProvider({...options,fetchImpl:async()=>response({user_id:'123',id:'987',username:options.account.username})});captured.push(p);return p;}}
 };
 const filename=path.join(__dirname,'../server-asap.js');const runtimeRequire=require('node:module').createRequire(filename);vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>replacements[id]||runtimeRequire(id),Buffer,process:{env:{}},console:{log(){}},setTimeout},{filename});
 return {start:module.exports.start,captured,initialized:()=>initialized};
}
for(const mode of ['instagram_login','facebook_login'])test(`server-asap actual ${mode} composition forwards validated immutable binding`,async()=>{
 const h=runtimeHarness();const runtime=await h.start(env({INSTAGRAM_AUTH_MODE:mode,PORT:'0',HOST:'127.0.0.1'}),{noSignals:true});try {assert.equal(h.captured.length,1);const p=h.captured[0];assert.equal(p.account.authMode,mode);assert.equal(p.account.apiHost,mode==='instagram_login'?'https://graph.instagram.com':'https://graph.facebook.com');assert.equal(p.account.accessToken,mode==='instagram_login'?'synthetic-instagram-token':'synthetic-page-token');assert.equal(runtime.scope.live,false);assert.equal(Object.isFrozen(runtime.scope.accounts[0]),true);}finally{await runtime.close();}
});
test('runtime rejects bad auth config before storage init, provider composition or mutation',async()=>{
 const h=runtimeHarness();await assert.rejects(h.start(env({INSTAGRAM_ACCESS_TOKEN:''}),{noSignals:true}),/BINDING_REQUIRED/);assert.equal(h.initialized(),0);assert.equal(h.captured.length,0);
});

test('transport failures and provider error text are sanitized without credential logging',async()=>{
 const account=loadScope(env()).accounts[0];const logs=[];
 const original=console.error;console.error=(...args)=>logs.push(args.join(' '));
 try {
  for(const fetchImpl of [async()=>{throw new Error('synthetic-instagram-token');},async()=>response({error:{code:'synthetic-instagram-token',message:'synthetic-instagram-token'}},403),async()=>({ok:true,status:200,json:async()=>{throw new Error('synthetic-instagram-token');}})]) {
   const p=createMetaPostProvider({account,fetchImpl});const r=await p.publishPost(content);assert.equal(r.status,'failed');assert.doesNotMatch(JSON.stringify(r),/synthetic-instagram-token/);assert.doesNotMatch(JSON.stringify(p.health()),/synthetic-instagram-token/);
  }
  assert.deepEqual(logs,[]);
 } finally {console.error=original;}
});

test('invalid container identity and malformed creation receipt cannot reach final publish',async()=>{
 for(const badCreation of [false,true]) {
  const calls=[];const p=createMetaPostProvider({account:loadScope(env()).accounts[0],sleep:async()=>{},fetchImpl:async(u,o)=>{calls.push({u,o});if(u.includes('/me?'))return response({user_id:'123',username:'asapgta6'});if(u.includes('content_publishing_limit'))return response({data:[{quota_usage:0,config:{quota_total:25,quota_duration:86400}}]});if(u.endsWith('/media'))return response({id:badCreation?'../bad':'container'});if(u.includes('/container?'))return response({id:'different',status_code:'FINISHED'});assert.fail('unsafe container reached publication');}});
  assert.equal((await p.publishPost(content)).status,'failed');assert.equal(calls.some(c=>c.u.endsWith('/media_publish')),false);
 }
});

test('HTTP 429 and 5xx final outcomes become a hold; received successful error-warning keeps its media ID',async()=>{
 for(const status of [429,500]) {
  let writes=0;const p=createMetaPostProvider({account:loadScope(env()).accounts[0],sleep:async()=>{},fetchImpl:async(u,o)=>{if(u.includes('/me?'))return response({user_id:'123',username:'asapgta6'});if(u.includes('content_publishing_limit'))return response({data:[{quota_usage:0,config:{quota_total:25,quota_duration:86400}}]});if(u.endsWith('/media'))return response({id:'container'});if(u.includes('/container?'))return response({id:'container',status_code:'FINISHED'});if(u.endsWith('/media_publish')){writes++;return response({error:{code:1,message:'synthetic-instagram-token'}},status);}assert.fail('no readback for ambiguous outcome');}});
  const r=await p.publishPost(content);assert.equal(r.status,'ambiguous');assert.equal(writes,1);assert.doesNotMatch(JSON.stringify(r),/synthetic-instagram-token/);
 }
 const f=fixture({published:{id:'media-456',error:{code:'USER_TAGGING_FAILURE',message:'synthetic-instagram-token'}}});const r=await f.provider.publishPost(content);assert.equal(r.status,'published');assert.deepEqual(r.warnings,['USER_TAGGING_FAILURE']);assert.equal(f.finalWrites().length,1);
});
