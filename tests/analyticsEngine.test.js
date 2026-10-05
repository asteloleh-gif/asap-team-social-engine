const test = require("node:test");
const assert = require("node:assert/strict");

const { createThreadsInsightsAdapter, normalizeInsightData } = require("../adapters/threadsInsightsAdapter");
const { normalizeMetrics, computeMetricDeltas } = require("../app/analytics/metrics");
const { createAnalyticsEngine } = require("../app/analytics/analyticsEngine");
const { checkpointWindowState, checkpointBounds } = require("../app/analytics/checkpointPolicy");

test("Threads insights normalizer supports total_value and lifetime values", () => {
  const result = normalizeInsightData([
    { name: "views", period: "lifetime", values: [{ value: 12 }] },
    { name: "followers_count", period: "day", total_value: { value: 99 } },
    { name: "invalid", values: [{ value: "nope" }] },
  ]);
  assert.deepEqual(result.metrics, { views: 12, followers_count: 99 });
  assert.deepEqual(result.periods, { views: "lifetime", followers_count: "day" });
});

test("Threads insights adapter reads post/account metrics and recent posts without leaking token into URL", async () => {
  const calls = [];
  const token = "secret-token";
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/me/threads_insights")) {
      return { ok: true, status: 200, async json() { return { data: [{ name: "followers_count", period: "day", total_value: { value: 41 } }] }; } };
    }
    if (String(url).includes("/me/threads?")) {
      return { ok: true, status: 200, async json() { return { data: [{ id: "p1", media_type: "TEXT_POST", text: "hello", permalink: "https://example.test/p1", timestamp: "2026-09-13T10:00:00+0000" }] }; } };
    }
    return { ok: true, status: 200, async json() { return { data: [{ name: "views", period: "lifetime", values: [{ value: 100 }] }, { name: "likes", period: "lifetime", values: [{ value: 7 }] }] }; } };
  };
  const adapter = createThreadsInsightsAdapter({ fallbackAccessToken: token, fetchImpl });
  const account = await adapter.getAccountInsights();
  const posts = await adapter.listRecentPosts({ limit: 5 });
  const post = await adapter.getPostInsights("p1");

  assert.equal(account.metrics.followers_count, 41);
  assert.equal(posts.posts[0].id, "p1");
  assert.equal(post.metrics.views, 100);
  assert.equal(post.metrics.likes, 7);
  assert.equal(calls.every(call => !call.url.includes(token)), true);
  assert.equal(calls.every(call => call.options.headers.Authorization === `Bearer ${token}`), true);
});

test("normalized metrics derive interactions and stable deltas", () => {
  const current = normalizeMetrics({ views: 200, likes: 10, replies: 4, junk: "x" });
  assert.equal(current.interactions, 14);
  assert.equal(current.engagement_rate, 0.07);
  const comparison = computeMetricDeltas(current, { views: 150, likes: 8, replies: 2, interactions: 10, engagement_rate: 0.066 });
  assert.equal(comparison.deltas.views, 50);
  assert.equal(comparison.deltas.interactions, 4);
  assert.equal(Math.round(comparison.rates.views * 1000) / 1000, 0.333);
});

test("analytics engine snapshots account and recent posts while isolating per-post failures", async () => {
  const snapshots = [];
  const discovered = [];
  const provider = {
    platform: "threads",
    accountKey: "astel:threads",
    account: { enabled: true, userId: "u1" },
    capabilities: { insights: true },
    async getAccountInsights() { return { status: "ok", metrics: { followers_count: 100 }, periods: { followers_count: "day" } }; },
    async listRecentPosts() { return { status: "ok", posts: [{ id: "p1", text: "one" }, { id: "p2", text: "two" }] }; },
    async getPostInsights(id) {
      if (id === "p2") return { status: "failed", reason: "META_REJECTED", code: 10 };
      return { status: "ok", metrics: { views: 50, likes: 5 }, periods: { views: "lifetime" } };
    },
  };
  const repository = {
    isReady: () => true,
    health: () => ({ connected: true }),
    async recordSnapshot(value) { snapshots.push(value); return { metrics: value.metrics, deltas: {}, rates: {} }; },
    async upsertDiscoveredPost(value) { discovered.push(value); return { stored: true }; },
  };
  const engine = createAnalyticsEngine({
    providerRegistry: { list: () => [provider] },
    repository,
    enabled: true,
    maxPostsPerAccount: 10,
    lookbackDays: 30,
  });
  const result = await engine.runOnce();
  assert.equal(result.status, "ok");
  assert.equal(result.accountSnapshots, 1);
  assert.equal(result.postsDiscovered, 2);
  assert.equal(result.postSnapshots, 1);
  assert.equal(result.failures, 1);
  assert.equal(discovered.length, 2);
  assert.deepEqual(snapshots.map(item => item.entityType), ["account", "post"]);
});

test("analytics engine is read-only disabled by default gate", async () => {
  let called = false;
  const engine = createAnalyticsEngine({
    providerRegistry: { list: () => [{ capabilities: { insights: true }, account: { enabled: true }, getAccountInsights: async () => { called = true; } }] },
    repository: { isReady: () => true, health: () => ({ connected: true }) },
    enabled: false,
  });
  assert.deepEqual(await engine.runOnce(), { status: "skipped", reason: "ANALYTICS_DISABLED" });
  assert.equal(called, false);
});

test("checkpoint windows use actual published_at with inclusive 24h and 72h boundaries", () => {
  const publishedAt = "2026-10-01T12:00:00.000Z";
  const day = checkpointBounds({ publishedAt, hours: 24, toleranceHours: 2 });
  assert.equal(day.opensAt.toISOString(), "2026-10-02T10:00:00.000Z");
  assert.equal(day.closesAt.toISOString(), "2026-10-02T14:00:00.000Z");
  assert.equal(checkpointWindowState({ publishedAt, hours: 24, toleranceHours: 2, now: day.opensAt }).state, "DUE");
  assert.equal(checkpointWindowState({ publishedAt, hours: 24, toleranceHours: 2, now: day.closesAt }).state, "DUE");
  assert.equal(checkpointWindowState({ publishedAt, hours: 24, toleranceHours: 2, now: new Date(day.closesAt.getTime() + 1) }).state, "LATE");
  const threeDays = checkpointBounds({ publishedAt, hours: 72, toleranceHours: 6 });
  assert.equal(threeDays.opensAt.toISOString(), "2026-10-04T06:00:00.000Z");
  assert.equal(threeDays.closesAt.toISOString(), "2026-10-04T18:00:00.000Z");
});

test("durable checkpoint survives a failed run and restart without rediscovery or duplicate capture", async () => {
  const checkpoint = {
    accountKey: "asap_gta6:threads",
    platformPostId: "post-old-not-in-discovery",
    checkpointHours: 24,
    toleranceHours: 2,
    publishedAt: "2026-10-04T12:00:00.000Z",
    opensAt: "2026-10-05T10:00:00.000Z",
    dueAt: "2026-10-05T12:00:00.000Z",
    closesAt: "2026-10-05T14:00:00.000Z",
  };
  let state = "PENDING";
  let insightAttempts = 0;
  let captures = 0;
  const repository = {
    isReady: () => true,
    health: () => ({ connected: true }),
    async recordSnapshot() {},
    async upsertDiscoveredPost() {},
    async ensureCheckpoints() { return { created: 0 }; },
    async claimDueCheckpoints() { return ["PENDING", "FAILED"].includes(state) ? [checkpoint] : []; },
    async failCheckpoint() { state = "FAILED"; return { status: "FAILED" }; },
    async completeCheckpoint() { state = "CAPTURED"; captures += 1; return { status: "CAPTURED" }; },
  };
  const provider = {
    platform: "threads",
    accountKey: "asap_gta6:threads",
    account: { enabled: true, userId: "u1" },
    capabilities: { insights: true },
    async getAccountInsights() { return { status: "ok", metrics: {} }; },
    async listRecentPosts() { return { status: "ok", posts: [] }; },
    async getPostInsights() {
      insightAttempts += 1;
      if (insightAttempts === 1) throw new Error("TRANSIENT");
      return { status: "ok", metrics: { views: 0 }, periods: { views: "lifetime" } };
    },
  };
  const options = { providerRegistry: { list: () => [provider] }, repository, enabled: true, now: () => new Date("2026-10-05T12:00:00.000Z") };
  const firstProcess = createAnalyticsEngine(options);
  assert.equal((await firstProcess.runOnce()).checkpoints.failed, 1);
  const restartedProcess = createAnalyticsEngine(options);
  assert.equal((await restartedProcess.runOnce()).checkpoints.captured, 1);
  assert.equal((await restartedProcess.runOnce()).checkpoints.claimed, 0);
  assert.equal(captures, 1);
  assert.equal(insightAttempts, 2);
});

test("delayed checkpoint collection is marked late, while failed post-window collection is missed", async () => {
  const baseCheckpoint = {
    accountKey: "asap_katy:threads",
    platformPostId: "p1",
    checkpointHours: 24,
    toleranceHours: 2,
    publishedAt: "2026-10-01T12:00:00.000Z",
    opensAt: "2026-10-02T10:00:00.000Z",
    dueAt: "2026-10-02T12:00:00.000Z",
    closesAt: "2026-10-02T14:00:00.000Z",
  };
  async function run(result) {
    let claimed = true;
    const repository = {
      isReady: () => true, health: () => ({ connected: true }),
      async recordSnapshot() {}, async upsertDiscoveredPost() {}, async ensureCheckpoints() {},
      async claimDueCheckpoints() { if (!claimed) return []; claimed = false; return [baseCheckpoint]; },
      async completeCheckpoint() { return { status: "LATE" }; },
      async failCheckpoint() { return { status: "MISSED" }; },
    };
    const provider = {
      platform: "threads", accountKey: "asap_katy:threads", account: { enabled: true }, capabilities: { insights: true },
      async getAccountInsights() { return { status: "ok", metrics: {} }; },
      async listRecentPosts() { return { status: "ok", posts: [] }; },
      async getPostInsights() { return result; },
    };
    return createAnalyticsEngine({ providerRegistry: { list: () => [provider] }, repository, enabled: true, now: () => new Date("2026-10-03T00:00:00.000Z") }).runOnce();
  }
  assert.equal((await run({ status: "ok", metrics: { views: 1 } })).checkpoints.late, 1);
  assert.equal((await run({ status: "failed", reason: "RATE_LIMITED" })).checkpoints.missed, 1);
});

test("unsupported analytics stays distinct from measured zero", async () => {
  const checkpoint = { accountKey: "asap_gta6:instagram", platformPostId: "p1", checkpointHours: 24, toleranceHours: 2, publishedAt: "2026-10-01T00:00:00Z" };
  let failure = null;
  const repository = {
    isReady: () => true, health: () => ({ connected: true }), async ensureCheckpoints() {},
    async claimDueCheckpoints() { return failure ? [] : [checkpoint]; },
    async failCheckpoint(value) { failure = value; return { status: "UNSUPPORTED" }; },
  };
  const provider = { accountKey: "asap_gta6:instagram", platform: "instagram", account: { enabled: true }, capabilities: { insights: false } };
  const result = await createAnalyticsEngine({ providerRegistry: { list: () => [provider] }, repository, enabled: true, now: () => new Date("2026-10-02T00:00:00Z") }).runOnce();
  assert.equal(result.checkpoints.unsupported, 1);
  assert.equal(failure.unsupported, true);
  assert.equal(failure.reason, "INSIGHTS_UNSUPPORTED");
});
