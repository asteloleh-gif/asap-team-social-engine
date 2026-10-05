function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function createAnalyticsEngine({
  providerRegistry,
  repository,
  enabled = bool(process.env.ANALYTICS_ENGINE_ENABLED, false),
  intervalMs = Number(process.env.ANALYTICS_INTERVAL_MS || 21_600_000),
  maxPostsPerAccount = Number(process.env.ANALYTICS_MAX_POSTS_PER_ACCOUNT || 25),
  lookbackDays = Number(process.env.ANALYTICS_LOOKBACK_DAYS || 30),
  checkpointBatchSize = Number(process.env.ANALYTICS_CHECKPOINT_BATCH_SIZE || 100),
  now = () => new Date(),
} = {}) {
  if (!providerRegistry) throw new Error("Analytics engine requires provider registry");
  if (!repository) throw new Error("Analytics engine requires analytics repository");

  let timer = null;
  let running = false;
  let lastRunAt = null;
  let lastCompletedAt = null;
  let lastSummary = null;

  function providerSupportsAnalytics(provider) {
    return Boolean(
      provider &&
      provider.account?.enabled !== false &&
      provider.capabilities?.insights &&
      typeof provider.getAccountInsights === "function"
    );
  }

  function clock() {
    const value = new Date(now());
    if (Number.isNaN(value.getTime())) throw new Error("Analytics clock returned invalid date");
    return value;
  }

  async function runProvider(provider, runAt) {
    const summary = {
      accountKey: provider.accountKey,
      platform: provider.platform,
      accountSnapshot: false,
      postsDiscovered: 0,
      postSnapshots: 0,
      failures: [],
    };

    try {
      const accountResult = await provider.getAccountInsights();
      if (accountResult?.status === "ok") {
        await repository.recordSnapshot({
          accountKey: provider.accountKey,
          entityType: "account",
          entityId: provider.account?.userId || provider.accountKey,
          metrics: accountResult.metrics || {},
          capturedAt: runAt,
          metadata: { platform: provider.platform, periods: accountResult.periods || {} },
        });
        summary.accountSnapshot = true;
      } else {
        summary.failures.push({ scope: "account", reason: accountResult?.reason || "INSIGHTS_FAILED", code: accountResult?.code || null });
      }
    } catch (error) {
      summary.failures.push({ scope: "account", reason: "EXCEPTION", error: error?.message || String(error) });
    }

    if (typeof provider.listRecentPosts !== "function" || typeof provider.getPostInsights !== "function") return summary;

    let postsResult;
    try {
      const since = Math.floor((runAt.getTime() - Math.max(1, lookbackDays) * 86_400_000) / 1000);
      postsResult = await provider.listRecentPosts({ limit: maxPostsPerAccount, since });
    } catch (error) {
      summary.failures.push({ scope: "posts", reason: "DISCOVERY_EXCEPTION", error: error?.message || String(error) });
      return summary;
    }

    if (postsResult?.status !== "ok") {
      summary.failures.push({ scope: "posts", reason: postsResult?.reason || "DISCOVERY_FAILED", code: postsResult?.code || null });
      return summary;
    }

    const posts = Array.isArray(postsResult.posts) ? postsResult.posts.slice(0, Math.max(1, maxPostsPerAccount)) : [];
    summary.postsDiscovered = posts.length;

    for (const post of posts) {
      try {
        await repository.upsertDiscoveredPost({ accountKey: provider.accountKey, post });
        const result = await provider.getPostInsights(post.id);
        if (result?.status !== "ok") {
          summary.failures.push({ scope: "post", entityId: String(post.id), reason: result?.reason || "INSIGHTS_FAILED", code: result?.code || null });
          continue;
        }
        await repository.recordSnapshot({
          accountKey: provider.accountKey,
          entityType: "post",
          entityId: String(post.id),
          metrics: result.metrics || {},
          capturedAt: runAt,
          metadata: { platform: provider.platform, periods: result.periods || {}, permalink: post.permalink || null },
        });
        summary.postSnapshots += 1;
      } catch (error) {
        summary.failures.push({ scope: "post", entityId: String(post?.id || "unknown"), reason: "EXCEPTION", error: error?.message || String(error) });
      }
    }

    return summary;
  }

  async function runCheckpoints(provider, runAt) {
    const summary = { claimed: 0, captured: 0, late: 0, missed: 0, failed: 0, unsupported: 0 };
    if (typeof repository.claimDueCheckpoints !== "function") return summary;
    const checkpoints = await repository.claimDueCheckpoints({
      accountKey: provider.accountKey,
      now: runAt,
      limit: Math.max(1, checkpointBatchSize || 100),
    });
    summary.claimed = checkpoints.length;
    const supported = provider.capabilities?.insights && typeof provider.getPostInsights === "function";
    for (const checkpoint of checkpoints) {
      if (!supported) {
        await repository.failCheckpoint({ checkpoint, reason: "INSIGHTS_UNSUPPORTED", unsupported: true, now: runAt });
        summary.unsupported += 1;
        continue;
      }
      try {
        const result = await provider.getPostInsights(checkpoint.platformPostId);
        if (result?.status !== "ok") {
          const failed = await repository.failCheckpoint({
            checkpoint,
            reason: result?.reason || "INSIGHTS_FAILED",
            unsupported: result?.reason === "INSIGHTS_UNSUPPORTED" || result?.reason === "UNSUPPORTED",
            now: runAt,
          });
          summary[failed.status === "MISSED" ? "missed" : failed.status === "UNSUPPORTED" ? "unsupported" : "failed"] += 1;
          continue;
        }
        const completed = await repository.completeCheckpoint({
          checkpoint,
          metrics: result.metrics || {},
          periods: result.periods || {},
          platform: provider.platform,
          observedAt: runAt,
        });
        summary[completed.status === "LATE" ? "late" : "captured"] += 1;
      } catch (error) {
        const failed = await repository.failCheckpoint({ checkpoint, reason: error?.message || "INSIGHTS_EXCEPTION", now: runAt });
        summary[failed.status === "MISSED" ? "missed" : "failed"] += 1;
      }
    }
    return summary;
  }

  async function runOnce() {
    if (!enabled) return { status: "skipped", reason: "ANALYTICS_DISABLED" };
    if (!repository.isReady()) return { status: "skipped", reason: "ANALYTICS_REPOSITORY_UNAVAILABLE" };
    if (running) return { status: "skipped", reason: "ANALYTICS_RUN_IN_PROGRESS" };

    running = true;
    const runAt = clock();
    lastRunAt = runAt.toISOString();
    const allProviders = providerRegistry.list();
    const providers = allProviders.filter(providerSupportsAnalytics);
    const results = [];
    try {
      for (const provider of providers) results.push(await runProvider(provider, runAt));
      if (typeof repository.ensureCheckpoints === "function") await repository.ensureCheckpoints();
      const checkpointResults = [];
      for (const provider of allProviders) checkpointResults.push({ accountKey: provider.accountKey, ...(await runCheckpoints(provider, runAt)) });
      lastCompletedAt = clock().toISOString();
      lastSummary = {
        status: "ok",
        providers: results.length,
        accountSnapshots: results.filter(item => item.accountSnapshot).length,
        postsDiscovered: results.reduce((sum, item) => sum + item.postsDiscovered, 0),
        postSnapshots: results.reduce((sum, item) => sum + item.postSnapshots, 0),
        failures: results.reduce((sum, item) => sum + item.failures.length, 0),
        accounts: results,
        checkpoints: {
          claimed: checkpointResults.reduce((sum, item) => sum + item.claimed, 0),
          captured: checkpointResults.reduce((sum, item) => sum + item.captured, 0),
          late: checkpointResults.reduce((sum, item) => sum + item.late, 0),
          missed: checkpointResults.reduce((sum, item) => sum + item.missed, 0),
          failed: checkpointResults.reduce((sum, item) => sum + item.failed, 0),
          unsupported: checkpointResults.reduce((sum, item) => sum + item.unsupported, 0),
          accounts: checkpointResults,
        },
      };
      return lastSummary;
    } finally {
      running = false;
    }
  }

  async function start() {
    if (!enabled) return { status: "skipped", reason: "ANALYTICS_DISABLED" };
    if (timer) return { status: "ok", reason: "ALREADY_STARTED" };
    const first = await runOnce();
    timer = setInterval(() => {
      runOnce().catch(error => {
        lastSummary = { status: "error", reason: "UNHANDLED_ANALYTICS_ERROR", error: error?.message || String(error) };
        console.error("Analytics engine error", JSON.stringify(lastSummary));
      });
    }, Math.max(60_000, intervalMs || 21_600_000));
    timer.unref?.();
    return { status: "ok", reason: "STARTED", firstRun: first };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function health() {
    const capableProviders = providerRegistry.list().filter(providerSupportsAnalytics).map(provider => provider.accountKey);
    return {
      enabled: Boolean(enabled),
      running,
      intervalMs: Math.max(60_000, intervalMs || 21_600_000),
      maxPostsPerAccount: Math.max(1, maxPostsPerAccount || 25),
      lookbackDays: Math.max(1, lookbackDays || 30),
      checkpointBatchSize: Math.max(1, checkpointBatchSize || 100),
      repository: repository.health(),
      capableProviders,
      lastRunAt,
      lastCompletedAt,
      lastSummary,
    };
  }

  return { start, stop, runOnce, health };
}

module.exports = { createAnalyticsEngine };
