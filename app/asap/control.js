const { hash, assertAccount } = require('./scope');
const { packageEnvelope } = require('./distributionAdapter');
const { applyStandingGrant } = require('./standingGrant');
const { normalizeIdempotencyKey, secureTokenMatch } = require('../content/contentControl');
const { reconcileJob } = require('./reconcile');

function createAsapControl({ scope, token, contentRepository, publishEngine, operationStore, state, providers, publishRepository }) {
  function authenticate(header) { return secureTokenMatch(token, header); }
  async function scopedDraft(id) {
    const d = await contentRepository.getDraft(id);
    if (!d) throw new Error('ASAP_DRAFT_NOT_FOUND');
    assertAccount(scope, d.account_key);
    return d;
  }
  async function createDraft(input) {
    const draft = packageEnvelope(input, scope);
    const draftId = `asap-${hash({ accountKey: draft.accountKey, contentId: draft.contentId, version: draft.version, contentHash: draft.contentHash }).slice(0,40)}`;
    const existing = await contentRepository.getDraft(draftId);
    if (!existing) await contentRepository.saveDraft({ draftId, accountKey: draft.accountKey, content: draft.content, source: 'lazy-distribution-adapter', metadata: draft });
    return { draftId, contentHash: draft.contentHash, version: draft.version, status: existing?.status || 'DRAFT' };
  }
  async function schedule(input) {
    const d = await scopedDraft(input.draftId);
    if (input.contentHash !== hash(d.content)) throw new Error('ASAP_CONTENT_HASH_MISMATCH');
    const grant = applyStandingGrant({ scope, draft: { ...d.metadata, accountKey: d.account_key, content: d.content } });
    // The durable draft-to-job binding outlives hot idempotency keys. Never
    // enqueue this version again merely because Redis no longer has its row.
    if (d.metadata.publishJobId) {
      const prior = d.metadata.authorization;
      if (!prior || prior.brandId !== scope.brand || prior.accountKey !== d.account_key || prior.platformUserId !== grant.platformUserId || prior.contentHash !== grant.contentHash || prior.contentVersion !== grant.contentVersion) throw new Error('ASAP_STORED_JOB_BINDING_UNVERIFIED');
      let existing = null;
      try { existing = await publishEngine.getJob(d.metadata.publishJobId); } catch (_) {}
      if (existing && (existing.accountKey !== d.account_key || existing.metadata?.draftId !== input.draftId || hash(existing.content) !== grant.contentHash)) throw new Error('ASAP_STORED_JOB_BINDING_UNVERIFIED');
      return { draftId: input.draftId, jobId: d.metadata.publishJobId, duplicate: true, grant: prior, jobStatus: existing?.status || 'UNKNOWN', recoveryRequired: !existing };
    }
    const result = await publishEngine.enqueue({ accountKey: d.account_key, content: d.content, scheduledAt: input.scheduledAt, dedupeKey: `asap:${scope.brand}:draft:${input.draftId}:${grant.contentHash}`, metadata: { draftId: input.draftId, projectId: scope.projectId, brandId: scope.brand, contentId: d.metadata.contentId, contentHash: grant.contentHash, contentVersion: grant.contentVersion, topicFamilyId: d.metadata.envelope?.topicFamilyId || null, sourceRecheckedAt: d.metadata.envelope?.sourceRecheckedAt || null, grant } });
    // The original repository's duplicate result points at the existing job.
    const jobId = result.id;
    await contentRepository.setDraftStatus({ draftId: input.draftId, status: 'SCHEDULED', scheduledAt: input.scheduledAt, metadata: { publishJobId: jobId, authorization: grant } });
    return { draftId: input.draftId, jobId, duplicate: result.duplicate, grant };
  }
  async function run(operation, idempotencyKey, input = {}) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (!key) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const fingerprint = hash({ operation, input });
    const claim = await operationStore.begin(operation, key);
    if (!claim.claimed) {
      if (claim.existing?.status === 'COMPLETED') {
        if (claim.existing.result.requestHash !== fingerprint) throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        return { ...claim.existing.result.value, idempotentReplay: true };
      }
      throw new Error('OPERATION_PENDING_OR_HELD');
    }
    try {
      let value;
      if (operation === 'draft') value = await createDraft(input);
      else if (operation === 'schedule') value = await schedule(input);
      else if (operation === 'pause') { await state.setPaused(true); value = { paused: true }; }
      else if (operation === 'reconcile') {
        const job = await getJob(input.jobId);
        value = await reconcileJob({ scope, job, platformPostId: input.platformPostId, provider: providers.findForAccount(job?.accountKey), repository: publishRepository });
      }
      else if (operation === 'resume') {
        const identityChecks = [];
        for (const provider of providers.list()) identityChecks.push({ accountKey: provider.accountKey, ...(await provider.verifyIdentity()) });
        if (!identityChecks.some(result => result.verified)) throw new Error('ACCOUNT_IDENTITY_UNVERIFIED');
        await state.setPaused(false); value = { paused: false, identityChecks };
      } else throw new Error('UNKNOWN_OPERATION');
      if (!(await operationStore.complete(operation, key, { requestHash: fingerprint, value }))) throw new Error('OPERATION_COMMIT_UNKNOWN');
      return value;
    } catch (e) { await operationStore.fail(operation, key, /^[A-Z_]+$/.test(e.message) ? e.message : 'OPERATION_FAILED'); throw e; }
  }
  async function getJob(id) {
    const job = await publishEngine.getJob(id);
    if (job) assertAccount(scope, job.accountKey);
    return job;
  }
  async function status() { return { projectId: scope.projectId, brandId: scope.brand, paused: await state.isPaused(), live: scope.live, publishing: publishEngine.health(), accounts: providers.list().map(p => p.health()), cost: { automaticAiCalls: 0, api: 'unknown', runtime: 'unknown' } }; }
  return { authenticate, run, getDraft: scopedDraft, getJob, status, preview: input => packageEnvelope(input, scope) };
}
module.exports = { createAsapControl };
