const { normalizeMetrics, computeMetricDeltas } = require("./metrics");
const { CHECKPOINT_WINDOWS, checkpointBounds, checkpointWindowState, postAgeHours } = require("./checkpointPolicy");

function createAnalyticsRepository({ store, durable } = {}) {
  if (!store) throw new Error("Analytics repository requires Postgres store");
  if (!durable) throw new Error("Analytics repository requires durable repository");

  async function latestSnapshot({ accountKey, entityType, entityId } = {}) {
    if (!accountKey || !entityType || !entityId || !store.isReady()) return null;
    const result = await store.query(
      `SELECT metrics, captured_at, metadata
       FROM analytics_snapshots
       WHERE account_key = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY captured_at DESC
       LIMIT 1`,
      [String(accountKey), String(entityType), String(entityId)],
    );
    return result?.rows?.[0] || null;
  }

  async function recordSnapshot({ accountKey, entityType, entityId, metrics, capturedAt = new Date(), metadata = {}, idempotencyKey = null } = {}) {
    const normalized = normalizeMetrics(metrics);
    const previous = await latestSnapshot({ accountKey, entityType, entityId });
    const comparison = computeMetricDeltas(normalized, previous?.metrics || {});
    const write = await durable.recordAnalyticsSnapshot({
      accountKey,
      entityType,
      entityId,
      metrics: normalized,
      capturedAt,
      idempotencyKey,
      metadata: {
        ...metadata,
        previousCapturedAt: previous?.captured_at || null,
        deltas: comparison.deltas,
        rates: comparison.rates,
      },
    });
    return { metrics: normalized, ...comparison, previousCapturedAt: previous?.captured_at || null, write };
  }

  async function upsertDiscoveredPost({ accountKey, post } = {}) {
    if (!accountKey || !post?.id) throw new Error("Discovered post requires accountKey and id");
    await durable.upsertPost({
      accountKey,
      platformPostId: String(post.id),
      contentType: post.contentType || "unknown",
      text: post.text ?? null,
      status: "PUBLISHED",
      permalink: post.permalink || null,
      publishedAt: post.publishedAt || null,
      metadata: post.metadata || {},
    });
    return { stored: true };
  }

  async function listSnapshots({ accountKey, entityType, entityId = null, limit = 50 } = {}) {
    if (!accountKey || !entityType || !store.isReady()) return [];
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    const params = [String(accountKey), String(entityType)];
    let where = "account_key = $1 AND entity_type = $2";
    if (entityId) {
      params.push(String(entityId));
      where += ` AND entity_id = $${params.length}`;
    }
    params.push(safeLimit);
    const result = await store.query(
      `SELECT entity_id, metrics, captured_at, metadata
       FROM analytics_snapshots
       WHERE ${where}
       ORDER BY captured_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return result?.rows || [];
  }

  async function ensureCheckpoints() {
    const values = [];
    const params = [];
    for (const window of CHECKPOINT_WINDOWS) {
      params.push(window.hours, window.toleranceHours);
      values.push(`($${params.length - 1}::integer, $${params.length}::integer)`);
    }
    const result = await store.query(
      `INSERT INTO analytics_checkpoints(
         account_key, platform_post_id, checkpoint_hours, tolerance_hours,
         published_at, opens_at, due_at, closes_at
       )
       SELECT p.account_key, p.platform_post_id, w.hours, w.tolerance,
              p.published_at,
              p.published_at + (w.hours - w.tolerance) * INTERVAL '1 hour',
              p.published_at + w.hours * INTERVAL '1 hour',
              p.published_at + (w.hours + w.tolerance) * INTERVAL '1 hour'
       FROM posts p
       CROSS JOIN (VALUES ${values.join(",")}) AS w(hours, tolerance)
       WHERE p.platform_post_id IS NOT NULL
         AND p.published_at IS NOT NULL
         AND p.status = 'PUBLISHED'
       ON CONFLICT (account_key, platform_post_id, checkpoint_hours) DO NOTHING`,
      params,
    );
    return { created: result?.rowCount || 0 };
  }

  async function claimDueCheckpoints({ accountKey, now = new Date(), limit = 100, leaseMs = 300_000 } = {}) {
    if (!accountKey) throw new Error("Checkpoint claim requires accountKey");
    const observedAt = new Date(now);
    const leaseUntil = new Date(observedAt.getTime() + Math.max(60_000, Number(leaseMs) || 300_000));
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return store.transaction(async client => {
      const selected = await client.query(
        `SELECT account_key, platform_post_id, checkpoint_hours, tolerance_hours,
                published_at, opens_at, due_at, closes_at, status, attempt_count
         FROM analytics_checkpoints
         WHERE account_key = $1
           AND observed_at IS NULL
           AND opens_at <= $2
           AND status IN ('PENDING','FAILED','IN_PROGRESS')
           AND (status <> 'IN_PROGRESS' OR lease_until IS NULL OR lease_until <= $2)
         ORDER BY due_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $3`,
        [String(accountKey), observedAt.toISOString(), safeLimit],
      );
      const rows = selected?.rows || [];
      for (const row of rows) {
        await client.query(
          `UPDATE analytics_checkpoints
           SET status = 'IN_PROGRESS', attempt_count = attempt_count + 1,
               lease_until = $4, updated_at = $3
           WHERE account_key = $1 AND platform_post_id = $2 AND checkpoint_hours = $5`,
          [String(accountKey), String(row.platform_post_id), observedAt.toISOString(), leaseUntil.toISOString(), Number(row.checkpoint_hours)],
        );
      }
      return rows.map(row => ({
        accountKey: row.account_key,
        platformPostId: String(row.platform_post_id),
        checkpointHours: Number(row.checkpoint_hours),
        toleranceHours: Number(row.tolerance_hours),
        publishedAt: row.published_at,
        opensAt: row.opens_at,
        dueAt: row.due_at,
        closesAt: row.closes_at,
        previousStatus: row.status,
        attemptCount: Number(row.attempt_count || 0) + 1,
      }));
    });
  }

  async function completeCheckpoint({ checkpoint, metrics, periods = {}, platform = null, permalink = null, observedAt = new Date() } = {}) {
    if (!checkpoint) throw new Error("Checkpoint completion requires checkpoint");
    const window = checkpointWindowState({
      publishedAt: checkpoint.publishedAt,
      hours: checkpoint.checkpointHours,
      toleranceHours: checkpoint.toleranceHours,
      now: observedAt,
    });
    const status = window.state === "LATE" ? "LATE" : "CAPTURED";
    const idempotencyKey = `checkpoint:${checkpoint.accountKey}:${checkpoint.platformPostId}:${checkpoint.checkpointHours}`;
    const snapshot = await recordSnapshot({
      accountKey: checkpoint.accountKey,
      entityType: "post",
      entityId: checkpoint.platformPostId,
      metrics,
      capturedAt: observedAt,
      idempotencyKey,
      metadata: {
        platform,
        periods,
        permalink,
        checkpoint: {
          hours: checkpoint.checkpointHours,
          toleranceHours: checkpoint.toleranceHours,
          status,
          dueAt: new Date(checkpoint.dueAt).toISOString(),
          opensAt: new Date(checkpoint.opensAt).toISOString(),
          closesAt: new Date(checkpoint.closesAt).toISOString(),
          publishedAt: new Date(checkpoint.publishedAt).toISOString(),
          observedAt: new Date(observedAt).toISOString(),
          postAgeHours: postAgeHours({ publishedAt: checkpoint.publishedAt, observedAt }),
        },
      },
    });
    await store.query(
      `UPDATE analytics_checkpoints
       SET status = $4, observed_at = $5, lease_until = NULL, last_error = NULL, updated_at = $5
       WHERE account_key = $1 AND platform_post_id = $2 AND checkpoint_hours = $3`,
      [String(checkpoint.accountKey), String(checkpoint.platformPostId), Number(checkpoint.checkpointHours), status, new Date(observedAt).toISOString()],
    );
    return { status, snapshot };
  }

  async function failCheckpoint({ checkpoint, reason, unsupported = false, now = new Date() } = {}) {
    if (!checkpoint) throw new Error("Checkpoint failure requires checkpoint");
    const window = checkpointWindowState({
      publishedAt: checkpoint.publishedAt,
      hours: checkpoint.checkpointHours,
      toleranceHours: checkpoint.toleranceHours,
      now,
    });
    const status = unsupported ? "UNSUPPORTED" : window.state === "LATE" ? "MISSED" : "FAILED";
    await store.query(
      `UPDATE analytics_checkpoints
       SET status = $4, lease_until = NULL, last_error = $5, updated_at = $6
       WHERE account_key = $1 AND platform_post_id = $2 AND checkpoint_hours = $3`,
      [String(checkpoint.accountKey), String(checkpoint.platformPostId), Number(checkpoint.checkpointHours), status, String(reason || "INSIGHTS_FAILED"), new Date(now).toISOString()],
    );
    return { status };
  }

  return {
    latestSnapshot,
    recordSnapshot,
    upsertDiscoveredPost,
    listSnapshots,
    ensureCheckpoints,
    claimDueCheckpoints,
    completeCheckpoint,
    failCheckpoint,
    isReady: () => store.isReady() && durable.isReady(),
    health: () => ({ connected: store.isReady() && durable.isReady() }),
  };
}

module.exports = { createAnalyticsRepository };
