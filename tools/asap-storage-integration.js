// Operator-only local verification. Never accepts remote/prod endpoints.
// Requires already-created throwaway storage; it does not create/delete databases.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPostgresStore } = require('../app/db/postgresStore');
const { createDurableRepository } = require('../app/db/durableRepository');
const { createPublishRepository } = require('../app/publishing/publishRepository');
const { createDurablePublishRepository } = require('../app/publishing/durablePublishRepository');
const { createPublishEngine } = require('../app/publishing/publishEngine');
const { createPublishJob } = require('../app/publishing/publishState');
const { createAsapState } = require('../app/asap/state');

function checkLocal(value, protocol, forbiddenPort) {
  const url = new URL(value || 'invalid:');
  if (!protocol.includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !url.port || Number(url.port) === forbiddenPort) throw new Error('THROWAWAY_LOOPBACK_STORAGE_REQUIRED');
  return url;
}

async function main() {
  if (process.env.ASAP_TEST_STORAGE_IS_THROWAWAY !== 'true') throw new Error('EXPLICIT_THROWAWAY_STORAGE_GUARD_REQUIRED');
  const databaseUrl = process.env.ASAP_TEST_DATABASE_URL;
  const redisUrl = process.env.ASAP_TEST_REDIS_URL;
  const dbUrl = checkLocal(databaseUrl, ['postgres:','postgresql:'], 5432);
  checkLocal(redisUrl, ['redis:','rediss:'], 6379);
  if (!decodeURIComponent(dbUrl.pathname).startsWith('/asap_test_')) throw new Error('ASAP_TEST_DATABASE_NAME_REQUIRED');
  const suffix = crypto.randomUUID().replace(/-/g,'');
  const namespace = `asap:integration:${suffix}`;
  const account = { key: `asap_test_${suffix}:threads`, brand:`asap_test_${suffix}`, platform:'threads', userId:'fixture-owner', username:'fixture', enabled:true, dryRun:true, language:'en' };
  const store = createPostgresStore({ connectionString:databaseUrl, required:true });
  let hot = null;
  const states = [];
  const checks = [];
  try {
    await store.init(); const durable = createDurableRepository({store}); await durable.syncAccounts([account]);
    hot = createPublishRepository({redisUrl,namespace}); await hot.init();
    let repository = createDurablePublishRepository({hotRepository:hot,durable});
    const job = createPublishJob({id:`job-${suffix}`,accountKey:account.key,content:{type:'text',text:'Isolated fixture; never sent to Meta'},dedupeKey:`fixture-${suffix}`,scheduledAt:new Date()});
    assert.equal((await repository.enqueue(job)).created,true);
    const duplicate = await repository.enqueue(createPublishJob({...job,id:`second-${suffix}`}));
    assert.equal(duplicate.duplicate,true); assert.equal(duplicate.id,job.id); checks.push('real Redis atomic enqueue/dedupe');
    await hot.quit(); hot = createPublishRepository({redisUrl,namespace}); await hot.init(); repository = createDurablePublishRepository({hotRepository:hot,durable});
    assert.equal((await repository.get(job.id)).content.text,job.content.text); checks.push('queue survives client/worker recreation');
    const provider={accountKey:account.key,platform:'threads',account,capabilities:{publishPosts:true},health:()=>({configured:true}),publishPost:async()=>assert.fail('must never publish fixture')};
    const engine=createPublishEngine({providerRegistry:{findForAccount:key=>key===account.key?provider:null},repository,enabled:true,dryRun:true});
    assert.equal((await engine.tick()).results[0].status,'simulated');assert.equal((await repository.get(job.id)).status,'SIMULATED');checks.push('source Publish Engine + real durable storage dry-run');
    const persisted = await store.query('SELECT status FROM publish_runs WHERE job_id=$1',[job.id]);assert.equal(persisted.rows[0].status,'SIMULATED');checks.push('Postgres durable projection');
    const crashJob=createPublishJob({...job,id:`crash-${suffix}`,dedupeKey:`crash-${suffix}`});await repository.enqueue(crashJob);
    assert.equal(await repository.claim(crashJob.id,'crashed-worker',{now:new Date(Date.now()-10000),leaseMs:1000}),true);
    assert.equal(await repository.recoverExpired(new Date()),1);assert.equal((await repository.get(crashJob.id)).status,'AMBIGUOUS_HOLD');
    assert.equal((await store.query('SELECT status FROM publish_runs WHERE job_id=$1',[crashJob.id])).rows[0].status,'AMBIGUOUS_HOLD');
    assert.deepEqual(await repository.due(new Date()),[]);checks.push('expired worker lease is held, not replayed');
    const stateOptions={redisUrl,namespace:`${namespace}:state`,maxPostsPerDay:2};const state=createAsapState(stateOptions);states.push(state);await state.init();assert.equal(await state.isPaused(),true);await state.setPaused(false);assert.equal(await state.reserve(account),true);await state.close();
    const resumed=createAsapState(stateOptions);states.push(resumed);await resumed.init();assert.equal(await resumed.isPaused(),false);assert.equal(await resumed.reserve(account),true);assert.equal(await resumed.reserve(account),false);await resumed.setPaused(true);await resumed.close();checks.push('persisted pause/resume and bounded limit');
    console.log(JSON.stringify({status:'PASS',checks,externalPublicationCalls:0,credentialsPrinted:false},null,2));
  } finally { for (const state of states) await state.close().catch(()=>{});if(hot)await hot.quit().catch(()=>{});await store.close().catch(()=>{}); }
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'FAIL',reason:/^[A-Z_]+$/.test(e.message)?e.message:'STORAGE_INTEGRATION_ASSERTION_FAILED'}));process.exitCode=1;});
module.exports={checkLocal};
