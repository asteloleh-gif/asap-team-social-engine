const test=require('node:test');const assert=require('node:assert/strict');const {createMetaPostProvider}=require('../app/asap/metaPostProvider');
const response=data=>({ok:true,status:200,json:async()=>data});
const account=platform=>({key:`asap_gta6:${platform}`,platform,userId:'123',username:'asapgta6',accessToken:'fixture'});
for(const platform of ['threads','instagram'])test(`${platform} pause after container creation blocks final visible mutation without double-reserving quota`,async()=>{
 let paused=false,reservations=0,visible=0,checks=0;
 const provider=createMetaPostProvider({account:account(platform),sleep:async()=>{},beforePublish:async()=>{reservations++;return true;},beforeFinalMutation:async()=>{checks++;return !paused;},fetchImpl:async(url,options)=>{
  if(url.includes('threads_publish')||url.endsWith('/media_publish')){visible++;return response({id:'should-never-publish'});}
  if((platform==='threads'&&url.includes('/me/threads?'))||url.endsWith('/123/media')){paused=true;return response({id:'container'});}
  if(url.includes('/container?'))return response({status_code:'FINISHED'});
  if(url.includes('content_publishing_limit'))return response({data:[{quota_usage:0,config:{quota_total:100}}]});
  return response({id:'123',username:'asapgta6'});
 }});
 const content={type:platform==='threads'?'text':'image',text:'Fixture',mediaUrl:'https://example.com/fixture.jpg'};
 const r=await provider.publishPost(content);assert.equal(r.reason,'ASAP_FINAL_MUTATION_BLOCKED');assert.equal(r.containerId,'container');assert.equal(visible,0);assert.equal(reservations,1);assert.equal(checks,1);
});
test('Facebook final fence can stop a post after the one quota reservation',async()=>{
 let writes=0,reservations=0;const provider=createMetaPostProvider({account:account('facebook'),beforePublish:async()=>{reservations++;return true;},beforeFinalMutation:async()=>false,fetchImpl:async(_url,options)=>{if(options.method==='POST')writes++;return response({id:'123'});}});
 assert.equal((await provider.publishPost({type:'text',text:'Fixture'})).reason,'ASAP_FINAL_MUTATION_BLOCKED');assert.equal(writes,0);assert.equal(reservations,1);
});
