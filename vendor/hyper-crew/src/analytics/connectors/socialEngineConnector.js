function createSocialEngineAnalyticsConnector({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = String(env.SOCIAL_ANALYTICS_BASE_URL || "").replace(/\/+$/, "");
  const token = String(env.SOCIAL_ANALYTICS_TOKEN || "");

  return {
    id: "social-engine",
    enabled: () => Boolean(baseUrl && token),
    async sync({ analytics, days = 30 } = {}) {
      if (!baseUrl || !token) return { status: "skipped", reason: "NOT_CONFIGURED" };
      const response = await fetchImpl(`${baseUrl}/internal/analytics/export?days=${encodeURIComponent(days)}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`SOCIAL_ANALYTICS_HTTP_${response.status}: ${body?.error || body?.message || "request failed"}`);
      const result = await analytics.ingestBatch({
        metrics: Array.isArray(body?.metrics) ? body.metrics : [],
        costs: Array.isArray(body?.costs) ? body.costs : [],
        bindings: Array.isArray(body?.bindings) ? body.bindings : [],
      });
      return {
        status: "ok",
        metadata: {
          importedMetrics: result.metrics,
          importedCosts: result.costs,
          importedBindings: result.bindings,
          sourceAccounts: Number(body?.accounts || 0),
        },
      };
    },
  };
}

module.exports = { createSocialEngineAnalyticsConnector };
