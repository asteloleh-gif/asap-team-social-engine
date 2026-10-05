const test=require('node:test');const assert=require('node:assert/strict');const{createDurablePublishRepository}=require('../app/publishing/durablePublishRepository');
test('expired Redis claims are projected as Postgres ambiguous holds',async()=>{
 const states=[];const hot={recoverExpired:async(_now,_limit,options)=>{assert.equal(options.includeIds,true);return['job1','job2'];}};
 const repository=createDurablePublishRepository({hotRepository:hot,durable:{isReady:()=>true,recordPublishState:async s=>states.push(s)}});
 assert.equal(await repository.recoverExpired(new Date()),2);assert.equal(states.length,2);assert.ok(states.every(s=>s.status==='AMBIGUOUS_HOLD'&&s.errorCode==='WORKER_LEASE_EXPIRED'));
});
