const test = require('node:test');
const assert = require('node:assert/strict');
const { createAsapControl } = require('../app/asap/control');
const { applyStandingGrant } = require('../app/asap/standingGrant');
const { hash } = require('../app/asap/scope');

function fixture(status = 'PUBLISHED') {
  const content = { type: 'text', text: 'Exact reviewed fixture' };
  const scope = { projectId: 'asap-team', brand: 'asap_gta6', accounts: [{ key: 'asap_gta6:threads', userId: '123' }] };
  const metadata = { accountKey: 'asap_gta6:threads', contentId: 'item', version: 1, contentHash: hash(content), content,
    review: { decision: 'PASS', contentHash: hash(content) } };
  metadata.authorization = applyStandingGrant({ scope, draft: metadata });
  metadata.publishJobId = 'original-job';
  const draft = { draft_id: 'draft-1', account_key: metadata.accountKey, content, metadata, status: 'SCHEDULED' };
  let hotJob = status == null ? null : { id: 'original-job', accountKey: draft.account_key, content, status, metadata: { draftId: draft.draft_id } };
  let enqueues = 0;
  const operations = new Map();
  const operationStore = {
    begin: async (_op, key) => operations.has(key) ? { claimed: false, existing: operations.get(key) } : { claimed: true },
    complete: async (_op, key, result) => { operations.set(key, { status: 'COMPLETED', result }); return true; },
    fail: async () => {},
  };
  const control = createAsapControl({ scope, token: 'fixture'.repeat(8), operationStore,
    contentRepository: { getDraft: async () => draft, setDraftStatus: async () => { throw Error('DUPLICATE_MUST_NOT_RESCHEDULE'); } },
    publishEngine: { getJob: async () => hotJob, enqueue: async () => { enqueues++; throw Error('DUPLICATE_ENQUEUE'); } } });
  const input = { draftId: draft.draft_id, contentHash: hash(content), scheduledAt: '2026-10-06T12:00:00Z' };
  return { control, draft, input, enqueues: () => enqueues, setHotJob: value => { hotJob = value; } };
}

for (const status of ['PUBLISHED', 'AMBIGUOUS_HOLD']) {
  test(`durable ${status} draft binding blocks a new schedule operation forever`, async () => {
    const f = fixture(status);
    const result = await f.control.run('schedule', 'new-key', f.input);
    assert.equal(result.jobId, 'original-job');
    assert.equal(result.duplicate, true);
    assert.equal(result.jobStatus, status);
    assert.equal(result.recoveryRequired, false);
    assert.equal(f.enqueues(), 0);
    assert.equal((await f.control.run('schedule', 'new-key', f.input)).idempotentReplay, true);
    await assert.rejects(() => f.control.run('schedule', 'new-key', { ...f.input, scheduledAt: '2026-10-07T12:00:00Z' }), /IDEMPOTENCY_PAYLOAD_MISMATCH/);
  });
}

test('cold hot store returns original job as unknown with recovery required, never requeues', async () => {
  const f = fixture(null);
  const result = await f.control.run('schedule', 'cold-key', f.input);
  assert.equal(result.jobId, 'original-job');
  assert.equal(result.jobStatus, 'UNKNOWN');
  assert.equal(result.recoveryRequired, true);
  assert.equal(f.enqueues(), 0);
});

test('durable replay binding rejects mismatched brand, account, identity, version or content hash', async () => {
  for (const patch of [{ brandId: 'asap_katy' }, { accountKey: 'asap_katy:threads' }, { platformUserId: '999' }, { contentHash: 'different' }, { contentVersion: 2 }]) {
    const f = fixture();
    f.draft.metadata.authorization = { ...f.draft.metadata.authorization, ...patch };
    await assert.rejects(() => f.control.run('schedule', 'bad-binding', f.input), /ASAP_STORED_JOB_BINDING_UNVERIFIED/);
    assert.equal(f.enqueues(), 0);
  }
});

test('hot row for another account, draft or content cannot validate a durable replay', async () => {
  for (const patch of [{ accountKey: 'asap_katy:threads' }, { metadata: { draftId: 'another-draft' } }, { content: { type: 'text', text: 'changed' } }]) {
    const f = fixture();
    f.setHotJob({ id: 'original-job', accountKey: f.draft.account_key, content: f.draft.content, status: 'PUBLISHED', metadata: { draftId: f.draft.draft_id }, ...patch });
    await assert.rejects(() => f.control.run('schedule', 'bad-hot-binding', f.input), /ASAP_STORED_JOB_BINDING_UNVERIFIED/);
    assert.equal(f.enqueues(), 0);
  }
});

test('changed draft content hash is rejected before durable duplicate lookup', async () => {
  const f = fixture(null);
  await assert.rejects(() => f.control.run('schedule', 'changed-content', { ...f.input, contentHash: 'different' }), /ASAP_CONTENT_HASH_MISMATCH/);
  assert.equal(f.enqueues(), 0);
});
