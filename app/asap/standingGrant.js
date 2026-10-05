const { assertAccount, hash } = require('./scope');

function applyStandingGrant({ scope, draft }) {
  const account = assertAccount(scope, draft.accountKey);
  if (draft.contentHash !== hash(draft.content) || draft.review?.contentHash !== draft.contentHash || draft.review?.decision !== 'PASS') throw new Error('ASAP_CONTENT_VERSION_NOT_REVIEWED');
  return Object.freeze({ policyId: 'asap-team-mission-02-owner-grant', projectId: scope.projectId, brandId: scope.brand, accountKey: account.key, platformUserId: account.userId, contentHash: draft.contentHash, contentVersion: draft.version, authorizationSource: 'standing-owner-instruction', perItemHumanReview: false, decision: 'APPROVED', grantedScope: ['threads', 'instagram', 'facebook'] });
}

module.exports = { applyStandingGrant };
