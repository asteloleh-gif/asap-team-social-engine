const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDurablePublishRepository } = require('../app/publishing/durablePublishRepository');
const { createPublishEngine } = require('../app/publishing/publishEngine');

function fixture(status = 'PENDING') {
  const job = { id: 'job-1', accountKey: 'asap_gta6:threads', status,
    content: { type: 'text', text: 'Fixture' }, metadata: {},
    updatedAt: new Date().toISOString(), result: {} };
  const pending = new Set();
  const states = [];
  const posts = [];
  let unavailable = false;
  let postUnavailable = false;
  let publications = 0;
  const terminal = (nextStatus, result = {}) => {
    job.status = nextStatus;
    job.result = result;
    job.durableStatus = 'pending';
    pending.add(job.id);
  };
  const hot = {
    isReady: () => true,
    health: () => ({ connected: true }),
    get: async () => ({ ...job }),
    due: async () => job.status === 'PENDING' ? [job.id] : [],
    claim: async () => {
      if (job.status !== 'PENDING') return false;
      job.status = 'PROCESSING';
      return true;
    },
    finish: async (_id, _claim, nextStatus, options) => { terminal(nextStatus, options.result); return true; },
    reconcilePublished: async (_id, result) => { terminal('PUBLISHED', result); return true; },
    cancel: async () => { terminal('CANCELLED'); return true; },
    recoverExpired: async () => {
      if (job.status !== 'PROCESSING') return [];
      terminal('AMBIGUOUS_HOLD');
      job.errorCode = 'WORKER_LEASE_EXPIRED';
      return [job.id];
    },
    markDurableProjection: async (id, confirmed) => {
      job.durableStatus = confirmed ? 'confirmed' : 'pending';
      if (confirmed) pending.delete(id); else pending.add(id);
    },
    pendingProjections: async () => [...pending],
  };
  const durable = {
    isReady: () => true,
    health: () => ({ connected: !unavailable }),
    recordPublishState: async value => {
      if (unavailable) throw new Error('FIXTURE_POSTGRES_UNAVAILABLE');
      states.push(value);
    },
    upsertPost: async value => {
      if (postUnavailable) throw new Error('FIXTURE_POST_WRITE_UNAVAILABLE');
      posts.push(value);
    },
  };
  const repository = createDurablePublishRepository({ hotRepository: hot, durable });
  const provider = { accountKey: job.accountKey, platform: 'threads', account: { enabled: true },
    capabilities: { publishPosts: true }, health: () => ({ configured: true }),
    publishPost: async () => { publications++; return { status: 'published', id: 'post-1' }; } };
  const engine = createPublishEngine({ providerRegistry: { findForAccount: () => provider }, repository, enabled: true, dryRun: false });
  return { job, hot, pending, states, posts, repository, engine,
    setUnavailable: value => { unavailable = value; },
    setPostUnavailable: value => { postUnavailable = value; },
    publications: () => publications };
}

test('finish outage leaves a pending projection; recovery never republishes', async () => {
  const f = fixture();
  f.setUnavailable(true);
  assert.equal((await f.engine.processJob(f.job.id)).status, 'ambiguous');
  assert.equal(f.job.status, 'PUBLISHED');
  assert.equal(f.job.durableStatus, 'pending');
  f.setUnavailable(false);
  await f.engine.tick();
  assert.equal(f.publications(), 1);
  assert.equal(f.job.durableStatus, 'confirmed');
  assert.equal(f.posts.length, 1);
  assert.equal(f.states.at(-1).status, 'PUBLISHED');
});

test('reconcile outage is retried as a projection without provider mutation', async () => {
  const f = fixture('AMBIGUOUS_HOLD');
  f.setUnavailable(true);
  assert.equal(await f.repository.reconcilePublished(f.job.id, { id: 'post-1', readback: { verified: true } }), false);
  assert.equal(f.job.durableStatus, 'pending');
  f.setUnavailable(false);
  assert.deepEqual(await f.repository.retryPendingProjections(), { attempted: 1, confirmed: 1 });
  assert.equal(f.publications(), 0);
  assert.equal(f.posts[0].platformPostId, 'post-1');
  assert.equal(f.job.durableStatus, 'confirmed');
});

test('expired-lease failed hold projection is marked for retry', async () => {
  const f = fixture('PROCESSING');
  // Also prove compatibility with a hot repository that only transitions the
  // hold: the wrapper must explicitly retain a failed projection for retry.
  f.hot.recoverExpired = async () => {
    f.job.status = 'AMBIGUOUS_HOLD';
    f.job.errorCode = 'WORKER_LEASE_EXPIRED';
    return [f.job.id];
  };
  f.setUnavailable(true);
  assert.equal(await f.repository.recoverExpired(), 1);
  assert.equal(f.pending.has(f.job.id), true);
  f.setUnavailable(false);
  assert.deepEqual(await f.repository.retryPendingProjections(), { attempted: 1, confirmed: 1 });
  assert.equal(f.states.at(-1).status, 'AMBIGUOUS_HOLD');
  assert.equal(f.publications(), 0);
});

test('cancelled job projection recovers after Postgres outage', async () => {
  const f = fixture();
  f.setUnavailable(true);
  assert.equal(await f.repository.cancel(f.job.id), true);
  assert.equal(f.job.durableStatus, 'pending');
  f.setUnavailable(false);
  await f.engine.tick();
  assert.equal(f.job.durableStatus, 'confirmed');
  assert.equal(f.states.at(-1).status, 'CANCELLED');
  assert.equal(f.publications(), 0);
});

test('partial Postgres projection retries both terminal state and post upsert', async () => {
  const f = fixture();
  f.setPostUnavailable(true);
  await f.engine.processJob(f.job.id);
  assert.equal(f.pending.has(f.job.id), true);
  assert.equal(f.posts.length, 0);
  f.setPostUnavailable(false);
  await f.engine.tick();
  assert.equal(f.posts.length, 1);
  assert.equal(f.publications(), 1);
  assert.equal(f.job.durableStatus, 'confirmed');
});

function isolatedHotRepository(client, options = {}) {
  const filename = path.join(__dirname, '../app/publishing/publishRepository.js');
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console: { log() {} }, process: { env: {} },
    require: id => id === 'redis' ? { createClient: () => client } :
      id === './publishState' ? require('../app/publishing/publishState') : require(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return module.exports.createPublishRepository({ redisUrl: 'redis://fixture.invalid:12345', namespace: 'asap:test', ...options });
}

test('ASAP can request persistent dedupe while legacy default remains 30 days', async () => {
  const calls = [];
  const client = { on() {}, connect: async () => {}, ping: async () => {},
    eval: async (script, options) => { calls.push({ script, options }); return 'CREATED:job-1'; } };
  for (const options of [{}, { dedupeTtlSeconds: 0 }]) {
    const hot = isolatedHotRepository(client, options);
    await hot.init();
    await hot.enqueue({ id: 'job-1', accountKey: 'asap_gta6:threads', content: { type: 'text', text: 'Fixture' }, scheduledAt: new Date().toISOString(), dedupeKey: 'draft-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  assert.equal(calls[0].options.arguments[10], String(30 * 86400));
  assert.equal(calls[1].options.arguments[10], '0');
  assert.match(calls[1].script, /tonumber\(ARGV\[11\]\) == 0/);
  assert.match(calls[1].script, /redis\.call\('PERSIST', idemKey\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../server-asap.js'), 'utf8'), /createPublishRepository\(\{[^\n]+dedupeTtlSeconds: 0/);
});

test('projection scan advances through an empty SSCAN page and wraps', async () => {
  const cursors = [];
  const client = { on() {}, connect: async () => {}, ping: async () => {},
    sScan: async (_key, cursor) => {
      cursors.push(cursor);
      return cursor === 0 ? { cursor: 17, members: [] } : { cursor: 0, members: ['later-job'] };
    } };
  const hot = isolatedHotRepository(client);
  await hot.init();
  assert.equal((await hot.pendingProjections(1)).length, 0);
  assert.equal((await hot.pendingProjections(1))[0], 'later-job');
  await hot.pendingProjections(1);
  assert.deepEqual(cursors, [0, 17, 0]);
});

test('projection scan retains overflow when SSCAN returns more than COUNT', async () => {
  let scans = 0;
  const client = { on() {}, connect: async () => {}, ping: async () => {},
    sScan: async () => { scans++; return { cursor: 0, members: ['first', 'second', 'third'] }; } };
  const hot = isolatedHotRepository(client);
  await hot.init();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(...await hot.pendingProjections(1));
  assert.deepEqual(ids, ['first', 'second', 'third']);
  assert.equal(scans, 1);
});

for (const operation of ['finish', 'recoverExpired', 'reconcilePublished', 'cancel']) {
  test(`${operation} atomically records projection work with the Redis transition`, async () => {
    const calls = [];
    const client = { on() {}, connect: async () => {}, ping: async () => {},
      zRangeByScore: async () => ['job-1'],
      eval: async (script, options) => { calls.push({ script, options }); return 1; } };
    const hot = isolatedHotRepository(client);
    await hot.init();
    if (operation === 'finish') await hot.finish('job-1', 'claim', 'PUBLISHED', { result: { id: 'post-1' } });
    if (operation === 'recoverExpired') await hot.recoverExpired();
    if (operation === 'reconcilePublished') await hot.reconcilePublished('job-1', { id: 'post-1', readback: { verified: true } });
    if (operation === 'cancel') await hot.cancel('job-1');
    assert.equal(calls.length, 1);
    assert.match(calls[0].script, /'durable_status', 'pending'/);
    assert.match(calls[0].script, /redis\.call\('SADD', KEYS\[/);
    assert.equal(calls[0].options.keys.includes('asap:test:durable-projection-pending'), true);
    assert.equal(calls[0].options.arguments.includes('job-1'), true);
  });
}
