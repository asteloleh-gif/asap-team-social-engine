const { createSocialEngineAnalyticsConnector } = require('../../vendor/hyper-crew/src/analytics/connectors/socialEngineConnector');
const { BRANDS } = require('./scope');

function createAsapAnalyticsConnector({ brand, baseUrl, token, fetchImpl = globalThis.fetch }) {
  if (!Object.hasOwn(BRANDS, brand)) throw new Error('ASAP_BRAND_REQUIRED');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ASAP_ANALYTICS_HTTPS_REQUIRED');
  const connector = createSocialEngineAnalyticsConnector({ env: { SOCIAL_ANALYTICS_BASE_URL: baseUrl, SOCIAL_ANALYTICS_TOKEN: token }, fetchImpl });
  return { ...connector, id: `asap-social-engine:${brand}`, async sync({ analytics, days = 30 }) {
    return connector.sync({ days, analytics: { async ingestBatch(batch) {
      for (const row of [...batch.metrics, ...batch.costs]) {
        const accountKey = row.accountKey || row.metadata?.accountKey;
        if (row.projectId !== 'asap-team' || !String(accountKey || '').startsWith(`${brand}:`)) throw new Error('ASAP_ANALYTICS_SCOPE_MISMATCH');
      }
      if (batch.bindings.length) throw new Error('ASAP_BINDING_MUTATION_NOT_ALLOWED');
      return analytics.ingestBatch(batch);
    } } });
  } };
}
module.exports = { createAsapAnalyticsConnector };
