const test=require('node:test');const assert=require('node:assert/strict');const {reconcileJob}=require('../app/asap/reconcile');
const now=new Date().toISOString();const scope={accounts:[{key:'asap_gta6:threads',platform:'threads'}]};
function fixture(){let commits=0;return{scope,job:{id:'job1',accountKey:'asap_gta6:threads',status:'AMBIGUOUS_HOLD',content:{text:'Exact copy'},createdAt:now,result:{}},platformPostId:'post1',provider:{accountKey:'asap_gta6:threads',verifyIdentity:async()=>({verified:true}),readback:async()=>({verified:true,contentText:'Exact copy',publishedAt:now,permalink:'https://www.threads.com/@asapgta6/post/test'}),publishPost:()=>assert.fail('reconcile must never publish')},repository:{reconcilePublished:async()=>{commits++;return true;}},commits:()=>commits};}
test('known platform ID can reconcile held job via exact owner/content/time readback with zero publish calls',async()=>{const f=fixture();const r=await reconcileJob(f);assert.equal(r.status,'PUBLISHED');assert.equal(r.publicationCalls,0);assert.equal(f.commits(),1);});
test('wrong ID, missing timestamp, wrong content or identity never releases hold',async()=>{
 const f=fixture();await assert.rejects(()=>reconcileJob({...f,job:{...f.job,result:{id:'confirmed-different'}}}),/CONFIRMED_ID_MISMATCH/);
 await assert.rejects(()=>reconcileJob({...f,provider:{...f.provider,verifyIdentity:async()=>({verified:false})}}),/IDENTITY_UNVERIFIED/);
 await assert.rejects(()=>reconcileJob({...f,provider:{...f.provider,readback:async()=>({verified:true,contentText:'Wrong copy',publishedAt:now})}}),/CONTENT_UNVERIFIED/);
 await assert.rejects(()=>reconcileJob({...f,provider:{...f.provider,readback:async()=>({verified:true,contentText:'Exact copy'})}}),/TIME_UNVERIFIED/);
 assert.equal(f.commits(),0);
});
