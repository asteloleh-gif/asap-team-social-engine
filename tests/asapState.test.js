const test=require('node:test');const assert=require('node:assert/strict');
const {createAsapState}=require('../app/asap/state');
test('pause survives client recreation, first state fails closed, brand limits are isolated',async()=>{
 const data=new Map();
 const factory=()=>({isOpen:true,on(){},connect:async()=>{},ping:async()=>{},get:async k=>data.get(k),set:async(k,v,o)=>{if(o?.NX&&data.has(k))return null;data.set(k,v);return 'OK';},eval:async(_s,{keys,arguments:a})=>{if(data.get(keys[0])!=='false')return 0;const n=Number(data.get(keys[1])||0);if(n>=Number(a[0]))return 0;data.set(keys[1],String(n+1));return 1;},quit:async()=>{}});
 const input={redisUrl:'redis://test.invalid',namespace:'asap:asap_gta6:v1',maxPostsPerDay:2,clientFactory:factory};
 const first=createAsapState(input);assert.equal(await first.isPaused(),true);await first.init();assert.equal(await first.reserve({platform:'threads'}),false);await first.setPaused(false);assert.equal(await first.reserve({platform:'threads'}),true);await first.close();
 const restarted=createAsapState(input);await restarted.init();assert.equal(await restarted.isPaused(),false);assert.equal(await restarted.reserve({platform:'threads'}),true);assert.equal(await restarted.reserve({platform:'threads'}),false);await restarted.setPaused(true);await restarted.close();
 const again=createAsapState(input);await again.init();assert.equal(await again.isPaused(),true);
 const katy=createAsapState({...input,namespace:'asap:asap_katy:v1'});await katy.init();assert.equal(await katy.isPaused(),true);await katy.setPaused(false);assert.equal(await katy.reserve({platform:'threads'}),true);
});
