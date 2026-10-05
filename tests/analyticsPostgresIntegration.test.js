const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createPostgresStore } = require("../app/db/postgresStore");
const { createDurableRepository } = require("../app/db/durableRepository");
const { createAnalyticsRepository } = require("../app/analytics/analyticsRepository");
const { createInternalAnalyticsRouter } = require("../app/analytics/internalAnalyticsRouter");

const connectionString = process.env.TEST_DATABASE_URL || "";

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

test("real PostgreSQL fences checkpoint workers, commits atomically, migrates provenance, and filters mixed brands", {
  skip: !connectionString && "TEST_DATABASE_URL is not configured",
}, async () => {
  const store = createPostgresStore({ connectionString, required: true, migrate: true, max: 8 });
  await store.init();
  try {
    const version = await store.query("SHOW server_version");
    console.log(`PostgreSQL integration version ${version.rows[0].server_version}`);
    const migrations = await store.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.equal(migrations.rows.some(row => row.version === "003_analytics_checkpoint_fencing.sql"), true);
    const columns = await store.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'analytics_checkpoints'`,
    );
    const columnNames = new Set(columns.rows.map(row => row.column_name));
    for (const name of ["checkpoint_id", "claim_token", "captured_snapshot_id"]) assert.equal(columnNames.has(name), true);

    await store.query(`TRUNCATE TABLE brands CASCADE`);
    await store.query(
      `INSERT INTO brands(brand_key, name) VALUES ('asap_gta6','ASAP GTA6'),('asap_katy','ASAP Katy')`,
    );
    await store.query(
      `INSERT INTO social_accounts(account_key, brand_key, platform, username, enabled, dry_run)
       VALUES ('asap_gta6:threads','asap_gta6','threads','asapgta6',TRUE,TRUE),
              ('asap_katy:threads','asap_katy','threads','asapkaty',TRUE,TRUE)`,
    );

    const durable = createDurableRepository({ store });
    const repository = createAnalyticsRepository({ store, durable });
    const publishedAt = "2026-10-04T11:00:00.000Z";

    await durable.upsertPost({
      accountKey: "asap_gta6:threads",
      platformPostId: "post-provenance",
      publishedAt,
      metadata: { publishJobId: "job-local-only" },
    });
    let post = (await store.query(
      `SELECT published_at, metadata FROM posts WHERE account_key = $1 AND platform_post_id = $2`,
      ["asap_gta6:threads", "post-provenance"],
    )).rows[0];
    assert.equal(post.published_at, null);
    assert.equal(post.metadata.publishedAtProvenance.verified, false);
    assert.equal((await repository.ensureCheckpoints()).created, 0);

    await repository.upsertDiscoveredPost({
      accountKey: "asap_gta6:threads",
      post: { id: "post-provenance", publishedAt, text: "verified", permalink: "https://example.test/post-provenance" },
    });
    post = (await store.query(
      `SELECT published_at, metadata FROM posts WHERE account_key = $1 AND platform_post_id = $2`,
      ["asap_gta6:threads", "post-provenance"],
    )).rows[0];
    assert.equal(post.published_at.toISOString(), publishedAt);
    assert.deepEqual(post.metadata.publishedAtProvenance, { source: "platform_discovery", verified: true });

    await durable.upsertPost({
      accountKey: "asap_gta6:threads",
      platformPostId: "post-provenance",
      publishedAt: "2026-10-04T11:30:00.000Z",
      metadata: { publishedAtProvenance: { source: "local_completion", verified: false } },
    });
    post = (await store.query(
      `SELECT published_at, metadata FROM posts WHERE account_key = $1 AND platform_post_id = $2`,
      ["asap_gta6:threads", "post-provenance"],
    )).rows[0];
    assert.equal(post.published_at.toISOString(), publishedAt);
    assert.equal(post.metadata.publishedAtProvenance.verified, true);

    const correctedAt = "2026-10-04T11:00:03.000Z";
    await repository.upsertDiscoveredPost({
      accountKey: "asap_gta6:threads",
      post: { id: "post-provenance", publishedAt: correctedAt, text: "verified correction" },
    });
    post = (await store.query(
      `SELECT published_at, metadata FROM posts WHERE account_key = $1 AND platform_post_id = $2`,
      ["asap_gta6:threads", "post-provenance"],
    )).rows[0];
    assert.equal(post.published_at.toISOString(), correctedAt);
    assert.equal(post.metadata.publishedAtProvenance.source, "platform_discovery");

    await repository.ensureCheckpoints();
    const claimAt = new Date("2026-10-05T12:00:00.000Z");
    const competingRepository = createAnalyticsRepository({ store, durable });
    const [claimsA, claimsB] = await Promise.all([
      repository.claimDueCheckpoints({ accountKey: "asap_gta6:threads", now: claimAt, limit: 1, leaseMs: 60_000 }),
      competingRepository.claimDueCheckpoints({ accountKey: "asap_gta6:threads", now: claimAt, limit: 1, leaseMs: 60_000 }),
    ]);
    assert.equal(claimsA.length + claimsB.length, 1);
    const firstClaim = claimsA[0] || claimsB[0];
    const replacement = (await competingRepository.claimDueCheckpoints({
      accountKey: "asap_gta6:threads",
      now: new Date(claimAt.getTime() + 61_000),
      limit: 1,
      leaseMs: 60_000,
    }))[0];
    assert.ok(replacement);
    assert.notEqual(replacement.claimToken, firstClaim.claimToken);
    assert.equal((await repository.completeCheckpoint({ checkpoint: firstClaim, metrics: { views: 1 }, observedAt: claimAt })).status, "STALE_CLAIM");
    assert.equal((await repository.failCheckpoint({ checkpoint: firstClaim, reason: "STALE_FAILURE", now: claimAt })).status, "STALE_CLAIM");
    const completion = await competingRepository.completeCheckpoint({
      checkpoint: replacement,
      metrics: { views: 0, likes: 0 },
      platform: "threads",
      observedAt: new Date(claimAt.getTime() + 62_000),
    });
    assert.equal(completion.status, "CAPTURED");
    assert.equal((await competingRepository.completeCheckpoint({ checkpoint: replacement, metrics: { views: 99 }, observedAt: new Date(claimAt.getTime() + 63_000) })).status, "STALE_CLAIM");
    const captured = await store.query(
      `SELECT c.status, c.observed_at, c.captured_snapshot_id, s.metrics
       FROM analytics_checkpoints c
       JOIN analytics_snapshots s ON s.id = c.captured_snapshot_id
       WHERE c.checkpoint_id = $1`,
      [replacement.checkpointId],
    );
    assert.equal(captured.rows[0].status, "CAPTURED");
    assert.equal(captured.rows[0].metrics.views, 0);
    assert.equal((await store.query(`SELECT COUNT(*)::int AS count FROM analytics_snapshots WHERE idempotency_key = $1`, [`checkpoint:${replacement.accountKey}:${replacement.platformPostId}:${replacement.checkpointHours}`])).rows[0].count, 1);

    await repository.upsertDiscoveredPost({
      accountKey: "asap_gta6:threads",
      post: { id: "post-atomic", publishedAt, text: "atomic" },
    });
    await repository.ensureCheckpoints();
    const atomicClaim = (await repository.claimDueCheckpoints({ accountKey: "asap_gta6:threads", now: claimAt, limit: 1, leaseMs: 60_000 }))[0];
    assert.equal(atomicClaim.platformPostId, "post-atomic");
    await store.query(
      `CREATE OR REPLACE FUNCTION reject_checkpoint_capture() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.status = 'CAPTURED' THEN RAISE EXCEPTION 'synthetic checkpoint update failure'; END IF;
         RETURN NEW;
       END $$`,
    );
    await store.query(
      `CREATE TRIGGER reject_checkpoint_capture_trigger BEFORE UPDATE ON analytics_checkpoints
       FOR EACH ROW EXECUTE FUNCTION reject_checkpoint_capture()`,
    );
    await assert.rejects(
      repository.completeCheckpoint({ checkpoint: atomicClaim, metrics: { views: 5 }, observedAt: claimAt }),
      /synthetic checkpoint update failure/,
    );
    assert.equal((await store.query(`SELECT COUNT(*)::int AS count FROM analytics_snapshots WHERE idempotency_key = $1`, [`checkpoint:${atomicClaim.accountKey}:${atomicClaim.platformPostId}:${atomicClaim.checkpointHours}`])).rows[0].count, 0);
    assert.equal((await store.query(`SELECT status FROM analytics_checkpoints WHERE checkpoint_id = $1`, [atomicClaim.checkpointId])).rows[0].status, "IN_PROGRESS");
    await store.query(`DROP TRIGGER reject_checkpoint_capture_trigger ON analytics_checkpoints`);
    await store.query(`DROP FUNCTION reject_checkpoint_capture()`);

    const restartedRepository = createAnalyticsRepository({ store, durable });
    const recoveredClaim = (await restartedRepository.claimDueCheckpoints({
      accountKey: "asap_gta6:threads",
      now: new Date(claimAt.getTime() + 61_000),
      limit: 1,
      leaseMs: 60_000,
    }))[0];
    assert.equal(recoveredClaim.checkpointId, atomicClaim.checkpointId);
    assert.equal((await restartedRepository.completeCheckpoint({ checkpoint: recoveredClaim, metrics: { views: 5 }, observedAt: new Date(claimAt.getTime() + 62_000) })).status, "CAPTURED");

    await repository.upsertDiscoveredPost({
      accountKey: "asap_katy:threads",
      post: { id: "katy-post", publishedAt, text: "katy" },
    });
    await repository.ensureCheckpoints();
    await durable.recordAnalyticsSnapshot({
      accountKey: "asap_gta6:threads", entityType: "post", entityId: "post-provenance",
      metrics: { views: 1 }, capturedAt: claimAt, metadata: {}, idempotencyKey: "ordinary-gta",
    });
    await durable.recordAnalyticsSnapshot({
      accountKey: "asap_katy:threads", entityType: "post", entityId: "katy-post",
      metrics: { views: 999 }, capturedAt: claimAt, metadata: {}, idempotencyKey: "ordinary-katy",
    });
    const app = express();
    app.use("/internal/analytics", createInternalAnalyticsRouter({
      store,
      token: "postgres-test-token",
      projectId: "asap-team",
      brand: "asap_gta6",
    }));
    await withServer(app, async base => {
      const response = await fetch(`${base}/internal/analytics/export?days=30`, {
        headers: { authorization: "Bearer postgres-test-token" },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.brand, "asap_gta6");
      assert.equal(body.accounts, 1);
      assert.equal(body.metrics.some(item => item.accountKey === "asap_katy:threads"), false);
      assert.equal(body.checkpoints.some(item => item.accountKey === "asap_katy:threads"), false);
      assert.equal(body.metrics.some(item => item.metrics.views === 999), false);
      assert.equal(body.metrics.some(item => item.metrics.views === 0 && item.availability === "MEASURED"), true);
      assert.equal(body.checkpoints.every(item => item.brand === "asap_gta6"), true);
    });
  } finally {
    try { await store.query(`DROP TRIGGER IF EXISTS reject_checkpoint_capture_trigger ON analytics_checkpoints`); } catch (_) {}
    try { await store.query(`DROP FUNCTION IF EXISTS reject_checkpoint_capture()`); } catch (_) {}
    await store.close();
  }
});
