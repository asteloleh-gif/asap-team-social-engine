const crypto = require("node:crypto");
const { normalizeMetrics, computeMetricDeltas } = require("./metrics");
const { CHECKPOINT_WINDOWS, checkpointWindowState, postAgeHours } = require("./checkpointPolicy");

function checkpointKey(checkpoint) {
  return `checkpoint:${checkpoint.accountKey}:${checkpoint.platformPostId}:${checkpoint.checkpointHours}`;
}

function checkpointFromRow(row, overrides = {}) {
  return {
    checkpointId: String(row.checkpoint_id),
    accountKey: row.account_key,
    platformPostId: String(row.platform_post_id),
    checkpointHours: Number(row.checkpoint_hours),
    toleranceHours: Number(row.tolerance_hours),
    publishedAt: row.published_at,
    opensAt: row.opens_at,
    dueAt: row.due_at,
    closesAt: row.closes_at,
    ...overrides,
  };
}

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
    const verifiedPublishedAt = post.publishedAt || null;
    await durable.upsertPost({
      accountKey,
      platformPostId: String(post.id),
      contentType: post.contentType || "unknown",
      text: post.text ?? null,
      status: "PUBLISHED",
      permalink: post.permalink || null,
      publishedAt: verifiedPublishedAt,
      metadata: {
        ...(post.metadata || {}),
        publishedAtProvenance: {
          source: verifiedPublishedAt ? "platform_discovery" : "unknown",
          verified: Boolean(verifiedPublishedAt),
        },
      },
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
         AND COALESCE((p.metadata #>> '{publishedAtProvenance,verified}')::boolean, FALSE) = TRUE
       ON CONFLICT (account_key, platform_post_id, checkpoint_hours) DO NOTHING`,
      params,
    );
    return { created: result?.rowCount || 0 };
  }

  async function claimDueCheckpoints({ accountKey, now = new Date(), limit = 100, leaseMs = 300_000 } = {}) {
    if (!accountKey) throw new Error("Checkpoint claim requires accountKey");
    const claimedAt = new Date(now);
    const leaseUntil = new Date(claimedAt.getTime() + Math.max(60_000, Number(leaseMs) || 300_000));
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return store.transaction(async client => {
      const selected = await client.query(
        `SELECT checkpoint_id, account_key, platform_post_id, checkpoint_hours, tolerance_hours,
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
        [String(accountKey), claimedAt.toISOString(), safeLimit],
      );
      const claimed = [];
      for (const row of selected?.rows || []) {
        const claimToken = crypto.randomUUID();
        const updated = await client.query(
          `UPDATE analytics_checkpoints
           SET status = 'IN_PROGRESS', attempt_count = attempt_count + 1,
               claim_token = $4, lease_until = $5, updated_at = $3
           WHERE checkpoint_id = $1 AND account_key = $2
           RETURNING attempt_count`,
          [row.checkpoint_id, String(accountKey), claimedAt.toISOString(), claimToken, leaseUntil.toISOString()],
        );
        if ((updated?.rowCount || 0) !== 1) continue;
        claimed.push(checkpointFromRow(row, {
          claimToken,
          claimedAt: claimedAt.toISOString(),
          leaseUntil: leaseUntil.toISOString(),
          previousStatus: row.status,
          attemptCount: Number(updated.rows[0].attempt_count),
        }));
      }
      return claimed;
    });
  }

  async function completeCheckpoint({ checkpoint, metrics, periods = {}, platform = null, permalink = null, observedAt = new Date() } = {}) {
    if (!checkpoint?.claimToken) throw new Error("Checkpoint completion requires a fenced claim");
    const capturedAt = new Date(observedAt);
    return store.transaction(async client => {
      const locked = await client.query(
        `SELECT checkpoint_id, account_key, platform_post_id, checkpoint_hours, tolerance_hours,
                published_at, opens_at, due_at, closes_at, status, claim_token
         FROM analytics_checkpoints
         WHERE checkpoint_id = $1
         FOR UPDATE`,
        [checkpoint.checkpointId],
      );
      const row = locked?.rows?.[0];
      if (!row || row.status !== "IN_PROGRESS" || row.claim_token !== checkpoint.claimToken) {
        return { status: "STALE_CLAIM", stale: true };
      }

      const current = checkpointFromRow(row, { claimToken: checkpoint.claimToken });
      const window = checkpointWindowState({
        publishedAt: current.publishedAt,
        hours: current.checkpointHours,
        toleranceHours: current.toleranceHours,
        now: capturedAt,
      });
      const status = window.state === "LATE" ? "LATE" : "CAPTURED";
      const normalized = normalizeMetrics(metrics);
      const previousResult = await client.query(
        `SELECT metrics, captured_at
         FROM analytics_snapshots
         WHERE account_key = $1 AND entity_type = 'post' AND entity_id = $2
         ORDER BY captured_at DESC
         LIMIT 1`,
        [current.accountKey, current.platformPostId],
      );
      const previous = previousResult?.rows?.[0] || null;
      const comparison = computeMetricDeltas(normalized, previous?.metrics || {});
      const idempotencyKey = checkpointKey(current);
      const snapshotMetadata = {
        platform,
        periods,
        permalink,
        previousCapturedAt: previous?.captured_at || null,
        deltas: comparison.deltas,
        rates: comparison.rates,
        checkpoint: {
          id: current.checkpointId,
          hours: current.checkpointHours,
          toleranceHours: current.toleranceHours,
          status,
          dueAt: new Date(current.dueAt).toISOString(),
          opensAt: new Date(current.opensAt).toISOString(),
          closesAt: new Date(current.closesAt).toISOString(),
          publishedAt: new Date(current.publishedAt).toISOString(),
          observedAt: capturedAt.toISOString(),
          postAgeHours: postAgeHours({ publishedAt: current.publishedAt, observedAt: capturedAt }),
        },
      };
      const inserted = await client.query(
        `INSERT INTO analytics_snapshots(account_key, entity_type, entity_id, metrics, captured_at, metadata, idempotency_key)
         VALUES ($1,'post',$2,$3::jsonb,$4,$5::jsonb,$6)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id, metrics, captured_at, metadata`,
        [current.accountKey, current.platformPostId, JSON.stringify(normalized), capturedAt.toISOString(), JSON.stringify(snapshotMetadata), idempotencyKey],
      );

      let snapshot = inserted?.rows?.[0] || null;
      let recovered = false;
      if (!snapshot) {
        const existing = await client.query(
          `SELECT id, account_key, entity_type, entity_id, metrics, captured_at, metadata
           FROM analytics_snapshots
           WHERE idempotency_key = $1
           FOR SHARE`,
          [idempotencyKey],
        );
        snapshot = existing?.rows?.[0] || null;
        if (!snapshot || snapshot.account_key !== current.accountKey || snapshot.entity_type !== "post" || String(snapshot.entity_id) !== current.platformPostId) {
          throw new Error("CHECKPOINT_SNAPSHOT_IDENTITY_MISMATCH");
        }
        recovered = true;
      }

      const persistedStatus = recovered ? String(snapshot.metadata?.checkpoint?.status || "") : status;
      if (!["CAPTURED", "LATE"].includes(persistedStatus)) throw new Error("CHECKPOINT_SNAPSHOT_STATE_INVALID");
      const persistedObservedAt = new Date(snapshot.captured_at);
      const updated = await client.query(
        `UPDATE analytics_checkpoints
         SET status = $2, observed_at = $3, captured_snapshot_id = $4,
             claim_token = NULL, lease_until = NULL, last_error = NULL, updated_at = $3
         WHERE checkpoint_id = $1 AND status = 'IN_PROGRESS' AND claim_token = $5`,
        [current.checkpointId, persistedStatus, persistedObservedAt.toISOString(), snapshot.id, checkpoint.claimToken],
      );
      if ((updated?.rowCount || 0) !== 1) throw new Error("CHECKPOINT_CLAIM_LOST_DURING_COMMIT");
      return {
        status: persistedStatus,
        recovered,
        snapshot: {
          metrics: snapshot.metrics || normalized,
          capturedAt: persistedObservedAt,
          snapshotId: snapshot.id,
          duplicate: recovered,
        },
      };
    });
  }

  async function failCheckpoint({ checkpoint, reason, unsupported = false, now = new Date() } = {}) {
    if (!checkpoint?.claimToken) throw new Error("Checkpoint failure requires a fenced claim");
    const failedAt = new Date(now);
    return store.transaction(async client => {
      const locked = await client.query(
        `SELECT checkpoint_id, account_key, platform_post_id, checkpoint_hours, tolerance_hours,
                published_at, opens_at, due_at, closes_at, status, claim_token
         FROM analytics_checkpoints
         WHERE checkpoint_id = $1
         FOR UPDATE`,
        [checkpoint.checkpointId],
      );
      const row = locked?.rows?.[0];
      if (!row || row.status !== "IN_PROGRESS" || row.claim_token !== checkpoint.claimToken) {
        return { status: "STALE_CLAIM", stale: true };
      }
      const current = checkpointFromRow(row);
      const window = checkpointWindowState({
        publishedAt: current.publishedAt,
        hours: current.checkpointHours,
        toleranceHours: current.toleranceHours,
        now: failedAt,
      });
      const status = unsupported ? "UNSUPPORTED" : window.state === "LATE" ? "MISSED" : "FAILED";
      const updated = await client.query(
        `UPDATE analytics_checkpoints
         SET status = $2, claim_token = NULL, lease_until = NULL, last_error = $3, updated_at = $4
         WHERE checkpoint_id = $1 AND status = 'IN_PROGRESS' AND claim_token = $5`,
        [current.checkpointId, status, String(reason || "INSIGHTS_FAILED"), failedAt.toISOString(), checkpoint.claimToken],
      );
      if ((updated?.rowCount || 0) !== 1) return { status: "STALE_CLAIM", stale: true };
      return { status };
    });
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
