const test=require('node:test'); const assert=require('node:assert/strict');
const {createMetaPostProvider}=require('../app/asap/metaPostProvider');
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const account=platform=>({key:`asap_gta6:${platform}`,platform,userId:'123',username:'asapgta6',accessToken:'fixture-token',enabled:true,dryRun:false});
test('wrong API identity prevents every external mutation',async()=>{
 let mutations=0;const provider=createMetaPostProvider({account:account('threads'),fetchImpl:async(_u,o)=>{if(o.method==='POST')mutations++;return response({id:'999',username:'someoneelse'});}});
 assert.equal((await provider.publishPost({type:'text',text:'Hello'})).reason,'ACCOUNT_IDENTITY_UNVERIFIED');assert.equal(mutations,0);
});
test('Threads reuses two-step publisher and verifies returned permalink/owner',async()=>{
 const calls=[];const provider=createMetaPostProvider({account:account('threads'),fetchImpl:async(u,o)=>{calls.push({u,o});if(u.includes('/me?'))return response({id:'123',username:'asapgta6'});if(u.includes('/me/threads?'))return response({id:'container'});if(u.includes('threads_publish'))return response({id:'post'});return response({id:'post',owner:{id:'123'},username:'asapgta6',permalink:'https://www.threads.com/@asapgta6/post/test'});}});
 const r=await provider.publishPost({type:'text',text:'Hello'});assert.equal(r.status,'published');assert.equal(r.readback.verified,true);assert.equal(calls.filter(c=>c.o.method==='POST').length,2);assert.ok(calls.every(c=>!c.u.includes('fixture-token')));
});
test('Facebook posts use Page feed API; uncertain final mutation is never retried',async()=>{
 let writes=0;const provider=createMetaPostProvider({account:account('facebook'),fetchImpl:async(u,o)=>{if(o.method==='GET')return response({id:'123',name:'ASAP'});writes++;throw new Error('timeout');}});
 assert.equal((await provider.publishPost({type:'text',text:'Hello'})).status,'ambiguous');assert.equal(writes,1);
});
test('Instagram image checks quota, media status, publishes and reads back',async()=>{
 const paths=[];const provider=createMetaPostProvider({account:account('instagram'),sleep:async()=>{},fetchImpl:async(u,o)=>{paths.push(u);if(u.includes('content_publishing_limit'))return response({data:[{quota_usage:1,config:{quota_total:100}}]});if(u.endsWith('/123/media'))return response({id:'container'});if(u.includes('container?'))return response({status_code:'FINISHED'});if(u.endsWith('/123/media_publish'))return response({id:'ig-post'});if(u.includes('/ig-post?'))return response({id:'ig-post',username:'asapgta6',permalink:'https://www.instagram.com/p/test/'});return response({id:'123',username:'asapgta6'});}});
 const r=await provider.publishPost({type:'image',text:'Hello',mediaUrl:'https://example.com/owned.jpg'});assert.equal(r.status,'published');assert.equal(r.readback.verified,true);assert.equal(paths.filter(p=>p.endsWith('/media_publish')).length,1);
});
test('readback failure retains known published ID and cannot duplicate publication',async()=>{
 let writes=0; const p=createMetaPostProvider({account:account('facebook'),fetchImpl:async(u,o)=>{if(o.method==='POST'){writes++;return response({id:'123_post'});}if(u.includes('/me?'))return response({id:'123'});return response({error:{code:10}},403);}});
 const r=await p.publishPost({type:'text',text:'Hello'});assert.equal(r.status,'published');assert.equal(r.id,'123_post');assert.equal(r.readback.verified,false);assert.equal(writes,1);
});
