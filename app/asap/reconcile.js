const { assertAccount } = require('./scope');
async function reconcileJob({ scope, job, platformPostId, provider, repository }) {
  if (!job || !['AMBIGUOUS_HOLD','PUBLISHED'].includes(job.status)) throw new Error('ASAP_JOB_NOT_RECONCILABLE');
  const account = assertAccount(scope, job.accountKey);
  if (!provider || provider.accountKey !== account.key || !(await provider.verifyIdentity()).verified) throw new Error('ACCOUNT_IDENTITY_UNVERIFIED');
  const knownId = job.result?.id;
  const id = String(platformPostId || knownId || '');
  if (!id) throw new Error('ASAP_PLATFORM_ID_REQUIRED_FOR_RECONCILE');
  if (knownId && id !== String(knownId)) throw new Error('ASAP_CONFIRMED_ID_MISMATCH');
  const verification = await provider.readback(id);
  if (!verification.verified || verification.contentText !== job.content.text) throw new Error('ASAP_RECONCILE_CONTENT_UNVERIFIED');
  const published = Date.parse(verification.publishedAt);
  if (!Number.isFinite(published) || published < Date.parse(job.createdAt) - 60000 || published > Date.now() + 60000) throw new Error('ASAP_RECONCILE_TIME_UNVERIFIED');
  const result = { id, platform: account.platform, permalink: verification.permalink, readback: verification, reconciledAt: new Date().toISOString() };
  if (!(await repository.reconcilePublished(job.id, result))) throw new Error('ASAP_RECONCILE_COMMIT_UNVERIFIED');
  return { jobId: job.id, status: 'PUBLISHED', result, publicationCalls: 0 };
}
module.exports = { reconcileJob };
