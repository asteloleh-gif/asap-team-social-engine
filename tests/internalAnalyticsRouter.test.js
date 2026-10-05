const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createInternalAnalyticsRouter, clampDays, safeEqual } = require("../app/analytics/internalAnalyticsRouter");

function fakeStore() {
  return {
    isReady: () => true,
    async query(sql) {
      if (sql.includes("FROM analytics_snapshots")) {
        return { rows: [{
          account_key: "astel-us:threads",
          brand_key: "astel-us",
          platform: "threads",
          entity_type: "post",
          entity_id: "p1",
          metrics: { views: 100, likes: 7, shares: 0 },
          metadata: { permalink: "https://example.test/p1", checkpoint: { hours: 24, status: "CAPTURED" } },
          durable_post_id: "44",
          published_at: new Date("2026-09-22T12:00:00Z"),
          post_metadata: { contentId: "content-1", contentHash: "hash-1", publishJobId: "job-1" },
          publish_job_id: "job-1",
          draft_id: "draft-1",
          draft_metadata: {},
          captured_at: new Date("2026-09-23T12:00:00Z"),
        }] };
      }
      if (sql.includes("FROM social_accounts") && sql.includes("enabled = TRUE")) {
        return { rows: [{ account_key: "astel-us:threads", brand_key: "astel-us", platform: "threads", username: "astel.us" }] };
      }
      if (sql.includes("FROM comments")) return { rows: [{ account_key: "astel-us:threads", platform: "threads", count: "4" }] };
      if (sql.includes("FROM replies")) return { rows: [{ account_key: "astel-us:threads", platform: "threads", total: "3", published: "3" }] };
      if (sql.includes("FROM posts")) return { rows: [{ account_key: "astel-us:threads", platform: "threads", count: "2" }] };
      if (sql.includes("FROM agent_runs")) {
        return { rows: [{
          run_id: "run-1",
          account_key: "astel-us:threads",
          workflow_id: "wf-1",
          node: "copywriter",
          model: "gpt-5.4-mini",
          status: "COMPLETED",
          input_tokens: "1000",
          output_tokens: "200",
          cached_input_tokens: "100",
          cost_microusd: "1500",
          latency_ms: "500",
          metadata: {},
          created_at: new Date("2026-09-23T12:00:00Z"),
        }] };
      }
      if (sql.includes("FROM analytics_checkpoints")) {
        return { rows: [{
          checkpoint_id: "72",
          account_key: "astel-us:threads",
          brand_key: "astel-us",
          platform: "threads",
          platform_post_id: "p1",
          checkpoint_hours: 72,
          tolerance_hours: 6,
          published_at: new Date("2026-09-22T12:00:00Z"),
          opens_at: new Date("2026-09-25T06:00:00Z"),
          due_at: new Date("2026-09-25T12:00:00Z"),
          closes_at: new Date("2026-09-25T18:00:00Z"),
          status: "UNSUPPORTED",
          window_status: "DUE",
          attempt_count: 1,
          observed_at: null,
          last_error: "INSIGHTS_UNSUPPORTED",
          durable_post_id: "44",
          post_metadata: { contentId: "content-1", contentHash: "hash-1" },
          publish_job_id: "job-1",
          draft_id: "draft-1",
          draft_metadata: {},
        }] };
      }
      throw new Error("unexpected SQL");
    },
  };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    const address = server.address();
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("analytics export is bearer protected and returns normalized Edie payload", async () => {
  const app = express();
  app.use("/internal/analytics", createInternalAnalyticsRouter({ store: fakeStore(), token: "test-secret" }));

  await withServer(app, async base => {
    const denied = await fetch(`${base}/internal/analytics/export?days=7`);
    assert.equal(denied.status, 401);

    const response = await fetch(`${base}/internal/analytics/export?days=7`, {
      headers: { authorization: "Bearer test-secret" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.days, 7);
    assert.equal(body.accounts, 1);
    assert.equal(body.metrics.length, 2);
    assert.equal(body.metrics[0].source, "threads");
    assert.equal(body.metrics[0].brand, "astel-us");
    assert.equal(body.metrics[0].metrics.shares, 0);
    assert.equal(body.metrics[0].mapping.contentId, "content-1");
    assert.equal(body.metrics[0].publishedAt, "2026-09-22T12:00:00.000Z");
    assert.equal(body.metrics[0].availability, "MEASURED");
    assert.equal(body.metrics[1].metrics.comments_received, 4);
    assert.equal(body.metrics[1].metrics.replies_published, 3);
    assert.equal(body.costs.length, 1);
    assert.equal(body.costs[0].amountMicrousd, 1500);
    assert.equal(body.checkpoints[0].availability, "UNSUPPORTED");
    assert.equal(body.checkpoints[0].collectionStatus, "UNSUPPORTED");
    assert.equal(body.checkpoints[0].windowStatus, "DUE");
    assert.equal(body.checkpoints[0].reason, "INSIGHTS_UNSUPPORTED");
    assert.equal(body.checkpoints[0].idempotencyKey, "social:checkpoint:72");
  });
});

test("analytics export helpers clamp windows and compare secrets safely", () => {
  assert.equal(clampDays(9999), 365);
  assert.equal(clampDays("nope"), 30);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("", ""), false);
});

test("analytics export keeps ordinary, 24h and 72h identities distinct and preserves collection versus window state", async () => {
  const base = fakeStore();
  const capturedAt = new Date("2026-10-04T18:00:00.000Z");
  const snapshots = [
    { id: "ordinary", metadata: {} },
    { id: "24", metadata: { checkpoint: { id: "101", hours: 24, status: "CAPTURED" } } },
    { id: "72", metadata: { checkpoint: { id: "102", hours: 72, status: "LATE" } } },
  ].map(item => ({
    account_key: "astel-us:threads", brand_key: "astel-us", platform: "threads",
    entity_type: "post", entity_id: "p1", metrics: { views: 0 }, metadata: item.metadata,
    durable_post_id: "44", published_at: new Date("2026-10-01T12:00:00Z"),
    post_metadata: { contentId: "content-1", publishedAtProvenance: { source: "platform_discovery", verified: true } },
    publish_job_id: "job-1", draft_id: "draft-1", draft_metadata: {}, captured_at: capturedAt,
  }));
  const states = [
    ["1", "PENDING", "PENDING", null],
    ["2", "IN_PROGRESS", "DUE", null],
    ["3", "FAILED", "DUE", "RATE_LIMITED"],
    ["4", "UNSUPPORTED", "DUE", "INSIGHTS_UNSUPPORTED"],
    ["5", "MISSED", "MISSED", "WINDOW_MISSED"],
    ["6", "LATE", "LATE", null],
    ["7", "CAPTURED", "IN_WINDOW", null],
  ].map(([id, status, windowStatus, reason]) => ({
    checkpoint_id: id, account_key: "astel-us:threads", brand_key: "astel-us", platform: "threads",
    platform_post_id: "p1", checkpoint_hours: id === "7" ? 72 : 24, tolerance_hours: 2,
    published_at: new Date("2026-10-01T12:00:00Z"), opens_at: new Date("2026-10-02T10:00:00Z"),
    due_at: new Date("2026-10-02T12:00:00Z"), closes_at: new Date("2026-10-02T14:00:00Z"),
    status, window_status: windowStatus, attempt_count: 1,
    observed_at: ["LATE", "CAPTURED"].includes(status) ? capturedAt : null, last_error: reason,
    durable_post_id: "44", post_metadata: { contentId: "content-1" }, publish_job_id: "job-1", draft_id: "draft-1", draft_metadata: {},
  }));
  const store = {
    ...base,
    async query(sql, params) {
      if (sql.includes("FROM analytics_snapshots")) return { rows: snapshots };
      if (sql.includes("FROM analytics_checkpoints")) return { rows: states };
      return base.query(sql, params);
    },
  };
  const app = express();
  app.use("/internal/analytics", createInternalAnalyticsRouter({ store, token: "test-secret" }));
  await withServer(app, async url => {
    async function read() {
      const response = await fetch(`${url}/internal/analytics/export?days=30`, { headers: { authorization: "Bearer test-secret" } });
      assert.equal(response.status, 200);
      return response.json();
    }
    const first = await read();
    const second = await read();
    const identities = first.metrics.filter(item => item.entityType === "post").map(item => item.idempotencyKey);
    assert.equal(new Set(identities).size, 3);
    assert.deepEqual(identities, [
      "social:snapshot:astel-us:threads:post:p1:2026-10-04T18:00:00.000Z",
      "social:checkpoint-snapshot:101",
      "social:checkpoint-snapshot:102",
    ]);
    assert.deepEqual(second.metrics.filter(item => item.entityType === "post").map(item => item.idempotencyKey), identities);
    const byStatus = new Map(first.checkpoints.map(item => [item.collectionStatus, item]));
    assert.equal(byStatus.get("PENDING").windowStatus, "PENDING");
    assert.equal(byStatus.get("IN_PROGRESS").windowStatus, "DUE");
    assert.equal(byStatus.get("FAILED").availability, "FAILED");
    assert.equal(byStatus.get("FAILED").reason, "RATE_LIMITED");
    assert.equal(byStatus.get("UNSUPPORTED").availability, "UNSUPPORTED");
    assert.equal(byStatus.get("MISSED").availability, "NOT_COLLECTED");
    assert.equal(byStatus.get("LATE").availability, "MEASURED");
    assert.equal(byStatus.get("CAPTURED").availability, "MEASURED");
    assert.equal(first.metrics.find(item => item.idempotencyKey === "social:checkpoint-snapshot:101").metrics.views, 0);
  });
});
