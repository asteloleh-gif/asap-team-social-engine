const express = require("express");
const crypto = require("node:crypto");

function clampDays(value, fallback = 30) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(365, Math.floor(n))) : fallback;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function checkpointExportIdentity({ brand, accountKey, platform, platformPostId, checkpointHours }) {
  return [brand || "unscoped", accountKey, platform || "social", platformPostId, Number(checkpointHours)]
    .map(value => encodeURIComponent(String(value)))
    .join(":");
}

function createInternalAnalyticsRouter({
  store,
  token = process.env.ANALYTICS_API_TOKEN || "",
  projectId = process.env.ANALYTICS_EXPORT_PROJECT_ID || "astel-business",
  brand = null,
  now = () => new Date(),
} = {}) {
  if (!store) throw new Error("Internal analytics router requires Postgres store");
  const router = express.Router();

  router.use((req, res, next) => {
    if (!token) return res.status(503).json({ error: "ANALYTICS_API_TOKEN_NOT_CONFIGURED" });
    const auth = String(req.get("authorization") || "");
    const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!safeEqual(supplied, token)) return res.status(401).json({ error: "UNAUTHORIZED" });
    next();
  });

  router.get("/export", async (req, res, next) => {
    try {
      if (!store.isReady()) return res.status(503).json({ error: "DATABASE_UNAVAILABLE" });
      const days = clampDays(req.query.days, 30);
      const capturedAt = new Date(now());
      if (Number.isNaN(capturedAt.getTime())) throw new Error("Analytics export clock returned invalid date");
      const cutoff = new Date(capturedAt.getTime() - days * 86_400_000);

      const scopedBrand = brand ? String(brand) : null;
      const [snapshotsResult, accountsResult, commentsResult, repliesResult, postsResult, agentRunsResult, checkpointsResult] = await Promise.all([
        store.query(
          `SELECT s.account_key, a.brand_key, a.platform, s.entity_type, s.entity_id, s.metrics, s.metadata, s.captured_at,
                  p.id AS durable_post_id, p.published_at, p.content_type, p.metadata AS post_metadata,
                  pr.job_id AS publish_job_id, pr.draft_id, d.metadata AS draft_metadata
           FROM analytics_snapshots s
           JOIN social_accounts a ON a.account_key = s.account_key
           LEFT JOIN posts p ON s.entity_type = 'post' AND p.account_key = s.account_key AND p.platform_post_id = s.entity_id
           LEFT JOIN LATERAL (
             SELECT job_id, draft_id FROM publish_runs
             WHERE account_key = p.account_key AND platform_post_id = p.platform_post_id
             ORDER BY updated_at DESC LIMIT 1
           ) pr ON TRUE
           LEFT JOIN drafts d ON d.draft_id = pr.draft_id
           WHERE s.captured_at >= $1 AND ($2::text IS NULL OR a.brand_key = $2)
           ORDER BY s.captured_at ASC`,
          [cutoff, scopedBrand],
        ),
        store.query(
          `SELECT account_key, brand_key, platform, username
           FROM social_accounts
           WHERE enabled = TRUE AND ($1::text IS NULL OR brand_key = $1)
           ORDER BY account_key`,
          [scopedBrand],
        ),
        store.query(
          `SELECT c.account_key, a.platform, COUNT(*)::bigint AS count
           FROM comments c
           JOIN social_accounts a ON a.account_key = c.account_key
           WHERE COALESCE(c.occurred_at, c.created_at) >= $1 AND ($2::text IS NULL OR a.brand_key = $2)
           GROUP BY c.account_key, a.platform`,
          [cutoff, scopedBrand],
        ),
        store.query(
          `SELECT r.account_key, a.platform,
                  COUNT(*)::bigint AS total,
                  COUNT(*) FILTER (WHERE r.platform_reply_id IS NOT NULL OR r.status ILIKE 'PUBLISHED%')::bigint AS published
           FROM replies r
           JOIN social_accounts a ON a.account_key = r.account_key
           WHERE COALESCE(r.published_at, r.created_at) >= $1 AND ($2::text IS NULL OR a.brand_key = $2)
           GROUP BY r.account_key, a.platform`,
          [cutoff, scopedBrand],
        ),
        store.query(
          `SELECT p.account_key, a.platform, COUNT(*)::bigint AS count
           FROM posts p
           JOIN social_accounts a ON a.account_key = p.account_key
           WHERE COALESCE(p.published_at, p.created_at) >= $1 AND ($2::text IS NULL OR a.brand_key = $2)
           GROUP BY p.account_key, a.platform`,
          [cutoff, scopedBrand],
        ),
        store.query(
          `SELECT ar.run_id, ar.account_key, ar.workflow_id, ar.node, ar.model, ar.status,
                  input_tokens, output_tokens, cached_input_tokens, cost_microusd,
                  latency_ms, ar.metadata, ar.created_at
           FROM agent_runs ar
           LEFT JOIN social_accounts a ON a.account_key = ar.account_key
           WHERE ar.created_at >= $1 AND ($2::text IS NULL OR a.brand_key = $2)
           ORDER BY ar.created_at ASC`,
          [cutoff, scopedBrand],
        ),
        store.query(
          `SELECT c.checkpoint_id, c.account_key, a.brand_key, a.platform, c.platform_post_id,
                  c.checkpoint_hours, c.tolerance_hours, c.published_at,
                  c.opens_at, c.due_at, c.closes_at, c.status, c.attempt_count,
                  c.observed_at, c.last_error, c.captured_snapshot_id,
                  c.timing_revision, c.timing_history, c.published_at_provenance,
                  CASE
                    WHEN c.observed_at IS NOT NULL AND c.observed_at < c.opens_at THEN 'EARLY'
                    WHEN c.observed_at IS NOT NULL AND c.observed_at <= c.closes_at THEN 'IN_WINDOW'
                    WHEN c.observed_at IS NOT NULL THEN 'LATE'
                    WHEN c.closes_at < $3 THEN 'MISSED'
                    WHEN c.opens_at <= $3 THEN 'DUE'
                    ELSE 'PENDING'
                  END AS window_status,
                  p.id AS durable_post_id, p.metadata AS post_metadata,
                  pr.job_id AS publish_job_id, pr.draft_id, d.metadata AS draft_metadata
           FROM analytics_checkpoints c
           JOIN social_accounts a ON a.account_key = c.account_key
           LEFT JOIN posts p ON p.account_key = c.account_key AND p.platform_post_id = c.platform_post_id
           LEFT JOIN LATERAL (
             SELECT job_id, draft_id FROM publish_runs
             WHERE account_key = c.account_key AND platform_post_id = c.platform_post_id
             ORDER BY updated_at DESC LIMIT 1
           ) pr ON TRUE
           LEFT JOIN drafts d ON d.draft_id = pr.draft_id
           WHERE c.published_at >= $1 AND ($2::text IS NULL OR a.brand_key = $2)
           ORDER BY c.published_at ASC, c.checkpoint_hours ASC`,
          [cutoff, scopedBrand, capturedAt],
        ),
      ]);

      const metricRows = (snapshotsResult.rows || []).map(row => ({
        source: row.platform || "social",
        projectId,
        accountKey: row.account_key,
        brand: row.brand_key || null,
        platform: row.platform || null,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metrics: row.metrics || {},
        dimensions: {
          postAgeHours: row.published_at ? Math.max(0, (new Date(row.captured_at).getTime() - new Date(row.published_at).getTime()) / 3_600_000) : null,
          checkpointHours: row.metadata?.checkpoint?.hours ?? null,
          checkpointStatus: row.metadata?.checkpoint?.status ?? null,
        },
        mapping: row.entity_type === "post" ? {
          durablePostId: row.durable_post_id == null ? null : String(row.durable_post_id),
          platformPostId: row.entity_id || null,
          publishJobId: row.publish_job_id || row.post_metadata?.publishJobId || null,
          draftId: row.draft_id || row.post_metadata?.draftId || null,
          contentId: row.post_metadata?.contentId || row.draft_metadata?.contentId || null,
          contentHash: row.post_metadata?.contentHash || row.draft_metadata?.contentHash || null,
        } : null,
        publishedAt: row.published_at || null,
        publishedAtProvenance: row.post_metadata?.publishedAtProvenance || null,
        observedAt: row.captured_at,
        availability: "MEASURED",
        metadata: { ...(row.metadata || {}), origin: "social-engine" },
        capturedAt: row.captured_at,
        idempotencyKey: row.metadata?.checkpoint?.hours != null
          ? `social:checkpoint-snapshot:${checkpointExportIdentity({
            brand: row.brand_key,
            accountKey: row.account_key,
            platform: row.platform,
            platformPostId: row.entity_id,
            checkpointHours: row.metadata.checkpoint.hours,
          })}`
          : `social:snapshot:${row.account_key}:${row.entity_type}:${row.entity_id}:${new Date(row.captured_at).toISOString()}`,
      }));

      const commentMap = new Map((commentsResult.rows || []).map(row => [row.account_key, Number(row.count || 0)]));
      const replyMap = new Map((repliesResult.rows || []).map(row => [row.account_key, {
        total: Number(row.total || 0),
        published: Number(row.published || 0),
      }]));
      const postMap = new Map((postsResult.rows || []).map(row => [row.account_key, Number(row.count || 0)]));

      for (const account of accountsResult.rows || []) {
        const comments = commentMap.get(account.account_key) || 0;
        const replies = replyMap.get(account.account_key) || { total: 0, published: 0 };
        metricRows.push({
          source: account.platform,
          projectId,
          accountKey: account.account_key,
          brand: account.brand_key || null,
          entityType: "community",
          entityId: account.account_key,
          metrics: {
            comments_received: comments,
            replies_recorded: replies.total,
            replies_published: replies.published,
            published_posts: postMap.get(account.account_key) || 0,
            reply_rate: comments > 0 ? replies.published / comments : 0,
          },
          dimensions: { windowDays: days },
          metadata: { username: account.username, origin: "social-engine" },
          capturedAt,
          idempotencyKey: `social:community:${account.account_key}:${capturedAt.toISOString().slice(0, 13)}`,
        });
      }

      const costs = (agentRunsResult.rows || []).map(row => ({
        runId: row.run_id,
        projectId,
        source: "social-engine",
        service: "astel-social-engine",
        agentId: row.node,
        provider: "openai",
        model: row.model,
        inputTokens: Number(row.input_tokens || 0),
        cachedInputTokens: Number(row.cached_input_tokens || 0),
        outputTokens: Number(row.output_tokens || 0),
        requests: 1,
        amountMicrousd: row.cost_microusd == null ? null : Number(row.cost_microusd),
        metadata: {
          accountKey: row.account_key,
          workflowId: row.workflow_id,
          status: row.status,
          latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
          ...(row.metadata || {}),
        },
        occurredAt: row.created_at,
        idempotencyKey: `social-agent-run:${row.run_id}`,
      }));

      const checkpoints = (checkpointsResult.rows || []).map(row => ({
        checkpointId: checkpointExportIdentity({
          brand: row.brand_key,
          accountKey: row.account_key,
          platform: row.platform,
          platformPostId: row.platform_post_id,
          checkpointHours: row.checkpoint_hours,
        }),
        localCheckpointId: String(row.checkpoint_id),
        projectId,
        accountKey: row.account_key,
        brand: row.brand_key || null,
        platform: row.platform || null,
        platformPostId: row.platform_post_id,
        durablePostId: row.durable_post_id == null ? null : String(row.durable_post_id),
        mapping: {
          publishJobId: row.publish_job_id || row.post_metadata?.publishJobId || null,
          draftId: row.draft_id || row.post_metadata?.draftId || null,
          contentId: row.post_metadata?.contentId || row.draft_metadata?.contentId || null,
          contentHash: row.post_metadata?.contentHash || row.draft_metadata?.contentHash || null,
        },
        publishedAt: row.published_at,
        publishedAtProvenance: row.published_at_provenance || row.post_metadata?.publishedAtProvenance || null,
        observedAt: row.observed_at || null,
        checkpointHours: Number(row.checkpoint_hours),
        toleranceHours: Number(row.tolerance_hours),
        opensAt: row.opens_at,
        dueAt: row.due_at,
        closesAt: row.closes_at,
        status: row.status,
        collectionStatus: row.status,
        windowStatus: row.window_status,
        attempts: Number(row.attempt_count || 0),
        availability: row.status === "CAPTURED" || row.status === "LATE"
          ? "MEASURED"
          : row.status === "UNSUPPORTED" ? "UNSUPPORTED"
          : row.status === "MISSED" ? "NOT_COLLECTED"
          : row.status === "FAILED" ? "FAILED" : "PENDING",
        reason: row.last_error || null,
        comparable: row.observed_at != null && row.window_status === "IN_WINDOW",
        timingRevision: Number(row.timing_revision || 1),
        timingHistory: row.timing_history || [],
        idempotencyKey: `social:checkpoint:${checkpointExportIdentity({
          brand: row.brand_key,
          accountKey: row.account_key,
          platform: row.platform,
          platformPostId: row.platform_post_id,
          checkpointHours: row.checkpoint_hours,
        })}`,
      }));

      return res.json({
        days,
        projectId,
        brand: scopedBrand,
        accounts: (accountsResult.rows || []).length,
        metrics: metricRows,
        checkpoints,
        costs,
        bindings: [],
        generatedAt: capturedAt.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createInternalAnalyticsRouter, clampDays, safeEqual, checkpointExportIdentity };
