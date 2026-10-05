const test=require('node:test');const assert=require('node:assert/strict');
const {createAsapControl}=require('../app/asap/control');const {hash}=require('../app/asap/scope');
const {createAsapAnalyticsConnector}=require('../app/asap/hyperCrewAdapter');

test('draft/schedule replay is idempotent and authorization never claims per-post human review',async()=>{
 const drafts=new Map(),operations=new Map(),jobs=new Map();let enqueues=0;
 const scope={projectId:'asap-team',brand:'asap_gta6',accounts:[{key:'asap_gta6:threads',userId:'123'}]};
 const operationStore={begin:async(o,k)=>{const v=operations.get(o+k);if(v)return{claimed:false,existing:v};operations.set(o+k,{status:'PROCESSING'});return{claimed:true};},complete:async(o,k,result)=>{operations.set(o+k,{status:'COMPLETED',result});return true;},fail:async(o,k)=>operations.set(o+k,{status:'FAILED'})};
 const contentRepository={getDraft:async id=>drafts.get(id),saveDraft:async d=>drafts.set(d.draftId,{draft_id:d.draftId,account_key:d.accountKey,content:d.content,metadata:d.metadata,status:'DRAFT'}),setDraftStatus:async d=>{const v=drafts.get(d.draftId);v.status=d.status;}};
 const publishEngine={enqueue:async j=>{enqueues++;const id=jobs.get(j.dedupeKey)||'j1';const duplicate=jobs.has(j.dedupeKey);jobs.set(j.dedupeKey,id);return{id,duplicate,job:{id:duplicate?'discarded-new-id':id}};}};
 const control=createAsapControl({scope,token:'x'.repeat(32),contentRepository,publishEngine,operationStore,state:{},providers:{}});
 const content={type:'text',text:'Beach or city?'};const input={accountKey:'asap_gta6:threads',envelope:{id:'e1',source:'original',tags:[],hashtags:[]},content,review:{decision:'PASS',reviewer:'Kevin',contentHash:hash(content)}};
 const draft=await control.run('draft','d1',input);assert.equal((await control.run('draft','d1',input)).idempotentReplay,true);assert.equal(drafts.size,1);
 const schedule={draftId:draft.draftId,contentHash:draft.contentHash,scheduledAt:'2026-10-06T12:00:00Z'};
 const result=await control.run('schedule','s1',schedule);assert.equal(result.grant.perItemHumanReview,false);assert.equal((await control.run('schedule','s1',schedule)).idempotentReplay,true);assert.equal(enqueues,1);
 const duplicate=await control.run('schedule','s2',schedule);assert.equal(duplicate.jobId,'j1');assert.equal(duplicate.duplicate,true);
 await assert.rejects(()=>control.run('schedule','s1',{...schedule,contentHash:'changed'}),/PAYLOAD_MISMATCH/);
 assert.equal(control.authenticate('Bearer '+ 'x'.repeat(32)),true);assert.equal(control.authenticate('Bearer wrong'),false);
});

test('Hyper Crew adapter rejects mixed Astel/ASAP data before ingest',async()=>{
 let ingested=0;const connector=createAsapAnalyticsConnector({brand:'asap_gta6',baseUrl:'https://asap.example',token:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({metrics:[{projectId:'astel-business',accountKey:'astel.us:threads'}]})})});
 await assert.rejects(()=>connector.sync({analytics:{ingestBatch:async()=>{ingested++;}}}),/SCOPE_MISMATCH/);assert.equal(ingested,0);
});
