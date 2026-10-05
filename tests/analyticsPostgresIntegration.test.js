const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

const { createPostgresStore } = require("../app/db/postgresStore");
const { createDurableRepository } = require("../app/db/durableRepository");
const { createAnalyticsRepository } = require("../app/analytics/analyticsRepository");
const { createInternalAnalyticsRouter } = require("../app/analytics/internalAnalyticsRouter");

const connectionString = process.env.TEST_DATABASE_URL || "";
const migrationsDirectory = path.join(__dirname, "../db/migrations");

function poolStore(pool) {
  return {
    isReady: () => true,
    query: (sql, params = []) => pool.query(sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function migratePool(pool, files = null) {
  const selected = files || (await fs.readdir(migrationsDirectory)).filter(name => /^\d+.*\.sql$/i.test(name)).sort();
  for (const file of selected) await pool.query(await fs.readFile(path.join(migrationsDirectory, file), "utf8"));
}

async function schemaPool(adminStore, schema) {
  await adminStore.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminStore.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  await pool.query("SELECT 1");
  return pool;
}

async function exportAnalytics({ store, brand, now }) {
  const app = express();
  app.use("/internal/analytics", createInternalAnalyticsRouter({
    store,
    token: "postgres-test-token",
    projectId: "asap-team",
    brand,
    now: () => new Date(now),
  }));
  return withServer(app, async base => {
    const response = await fetch(`${base}/internal/analytics/export?days=30`, {
      headers: { authorization: "Bearer postgres-test-token" },
    });
    assert.equal(response.status, 200);
    return response.json();
  });
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

test("real PostgreSQL fences and reconciles checkpoints, preserves legacy history, and exports globally stable identities", {
  skip: !connectionString && "TEST_DATABASE_URL is not configured",
}, async () => {
  const store = createPostgresStore({ connectionString, required: true, migrate: true, max: 8 });
  const isolatedPools = [];
  const isolatedSchemas = ["analytics_id_gta", "analytics_id_katy", "analytics_legacy"];
  await store.init();
  try {
    const version = await store.query("SHOW server_version");
    console.log(`PostgreSQL integration version ${version.rows[0].server_version}`);
    const migrations = await store.query("SELECT version FROM schema_migrations ORDER BY version");
    assert.equal(migrations.rows.some(row => row.version === "003_analytics_checkpoint_fencing.sql"), true);
    assert.equal(migrations.rows.some(row => row.version === "004_analytics_publication_timing.sql"), true);
    const columns = await store.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'analytics_checkpoints'`,
    );
    const columnNames = new Set(columns.rows.map(row => row.column_name));
    for (const name of ["checkpoint_id", "claim_token", "captured_snapshot_id", "timing_revision", "timing_history", "published_at_provenance"]) {
      assert.equal(columnNames.has(name), true);
    }

    await store.query(`TRUNCATE TABLE brands CASCADE`);
    await store.query(
      `INSERT INTO brands(brand_key, name) VALUES ('asap_gta6','ASAP GTA6'),('asap_katy','ASAP Katy')`,
    );
    await store.query(
      `INSERT INTO social_accounts(account_key, brand_key, platform, username, enabled, dry_run)
       VALUES ('asap_gta6:threads','asap_gta6','threads','asapgta6',TRUE,TRUE),
              ('asap_gta6:corrections','asap_gta6','threads','asapgta6-corrections',TRUE,TRUE),
              ('asap_katy:threads','asap_katy','threads','asapkaty',TRUE,TRUE)`,
    );

    const durable = createDurableRepository({ store });
    const repository = createAnalyticsRepository({ store, durable });
    const publishedAt = "2042-01-31T11:00:00.000Z";

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
      publishedAt: "2042-01-31T11:30:00.000Z",
      metadata: { publishedAtProvenance: { source: "local_completion", verified: false } },
    });
    post = (await store.query(
      `SELECT published_at, metadata FROM posts WHERE account_key = $1 AND platform_post_id = $2`,
      ["asap_gta6:threads", "post-provenance"],
    )).rows[0];
    assert.equal(post.published_at.toISOString(), publishedAt);
    assert.equal(post.metadata.publishedAtProvenance.verified, true);

    const correctedAt = "2042-01-31T11:00:03.000Z";
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
    const claimAt = new Date("2042-02-01T12:00:00.000Z");
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

    const correctionAccount = "asap_gta6:corrections";
    const correctedPublication = "2042-01-31T10:00:00.000Z";

    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-before-claim", publishedAt, text: "pending correction" },
    });
    await repository.ensureCheckpoints();
    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-before-claim", publishedAt: correctedPublication, text: "pending corrected" },
    });
    let correctedCheckpoint = (await store.query(
      `SELECT * FROM analytics_checkpoints
       WHERE account_key = $1 AND platform_post_id = $2 AND checkpoint_hours = 24`,
      [correctionAccount, "correct-before-claim"],
    )).rows[0];
    assert.equal(correctedCheckpoint.published_at.toISOString(), correctedPublication);
    assert.equal(correctedCheckpoint.timing_revision, 2);
    assert.equal(correctedCheckpoint.timing_history.length, 1);
    assert.equal(new Date(correctedCheckpoint.timing_history[0].publishedAt).toISOString(), publishedAt);
    assert.equal(correctedCheckpoint.status, "PENDING");
    await store.query(`UPDATE analytics_checkpoints SET status = 'UNSUPPORTED' WHERE checkpoint_id = $1`, [correctedCheckpoint.checkpoint_id]);

    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-during-claim", publishedAt, text: "claimed correction" },
    });
    await repository.ensureCheckpoints();
    const duringClaim = (await repository.claimDueCheckpoints({ accountKey: correctionAccount, now: claimAt, limit: 10, leaseMs: 60_000 }))
      .find(item => item.platformPostId === "correct-during-claim");
    assert.ok(duringClaim);
    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-during-claim", publishedAt: correctedPublication, text: "claimed corrected" },
    });
    correctedCheckpoint = (await store.query(
      `SELECT * FROM analytics_checkpoints WHERE checkpoint_id = $1`,
      [duringClaim.checkpointId],
    )).rows[0];
    assert.equal(correctedCheckpoint.status, "PENDING");
    assert.equal(correctedCheckpoint.claim_token, null);
    assert.equal(correctedCheckpoint.lease_until, null);
    assert.equal(correctedCheckpoint.last_error, "PUBLICATION_TIME_CORRECTED");
    assert.equal(correctedCheckpoint.timing_revision, 2);
    assert.equal((await repository.completeCheckpoint({ checkpoint: duringClaim, metrics: { views: 1 }, observedAt: claimAt })).status, "STALE_CLAIM");
    assert.equal((await repository.failCheckpoint({ checkpoint: duringClaim, reason: "STALE_AFTER_CORRECTION", now: claimAt })).status, "STALE_CLAIM");
    const correctedClaim = (await repository.claimDueCheckpoints({
      accountKey: correctionAccount,
      now: new Date("2042-02-01T12:30:00.000Z"),
      limit: 10,
      leaseMs: 60_000,
    })).find(item => item.platformPostId === "correct-during-claim");
    assert.ok(correctedClaim);
    assert.equal((await repository.completeCheckpoint({
      checkpoint: correctedClaim,
      metrics: { views: 2 },
      observedAt: new Date("2042-02-01T12:30:00.000Z"),
    })).status, "LATE");

    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-after-capture", publishedAt, text: "captured correction" },
    });
    await repository.ensureCheckpoints();
    const captureClaim = (await repository.claimDueCheckpoints({ accountKey: correctionAccount, now: claimAt, limit: 10, leaseMs: 60_000 }))
      .find(item => item.platformPostId === "correct-after-capture");
    assert.ok(captureClaim);
    assert.equal((await repository.completeCheckpoint({
      checkpoint: captureClaim,
      metrics: { views: 3 },
      observedAt: new Date("2042-02-01T12:30:00.000Z"),
    })).status, "CAPTURED");
    const capturedBeforeCorrection = (await store.query(
      `SELECT captured_snapshot_id, observed_at FROM analytics_checkpoints WHERE checkpoint_id = $1`,
      [captureClaim.checkpointId],
    )).rows[0];
    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-after-capture", publishedAt: correctedPublication, text: "captured corrected" },
    });
    const capturedAfterCorrection = (await store.query(
      `SELECT c.*, s.metadata AS snapshot_metadata
       FROM analytics_checkpoints c
       JOIN analytics_snapshots s ON s.id = c.captured_snapshot_id
       WHERE c.checkpoint_id = $1`,
      [captureClaim.checkpointId],
    )).rows[0];
    assert.equal(capturedAfterCorrection.status, "LATE");
    assert.equal(capturedAfterCorrection.published_at.toISOString(), correctedPublication);
    assert.equal(capturedAfterCorrection.observed_at.toISOString(), capturedBeforeCorrection.observed_at.toISOString());
    assert.equal(String(capturedAfterCorrection.captured_snapshot_id), String(capturedBeforeCorrection.captured_snapshot_id));
    assert.equal(capturedAfterCorrection.timing_revision, 2);
    assert.equal(capturedAfterCorrection.timing_history.length, 1);
    assert.equal(capturedAfterCorrection.snapshot_metadata.checkpoint.publishedAt, publishedAt);
    assert.deepEqual(capturedAfterCorrection.snapshot_metadata.checkpoint.publishedAtProvenance, { source: "platform_discovery", verified: true });

    const missedOriginalPublication = "2042-01-31T11:00:00.000Z";
    const missedCorrectedPublication = "2042-02-01T12:00:00.000Z";
    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-after-missed", publishedAt: missedOriginalPublication, text: "missed correction" },
    });
    await repository.ensureCheckpoints();
    const missedClaim = (await repository.claimDueCheckpoints({
      accountKey: correctionAccount,
      now: new Date("2042-02-01T12:00:00.000Z"),
      limit: 10,
      leaseMs: 60_000,
    })).find(item => item.platformPostId === "correct-after-missed" && item.checkpointHours === 24);
    assert.ok(missedClaim);
    assert.equal((await repository.failCheckpoint({
      checkpoint: missedClaim,
      reason: "OLD_WINDOW_ELAPSED",
      now: new Date("2042-02-01T14:01:00.000Z"),
    })).status, "MISSED");
    await repository.upsertDiscoveredPost({
      accountKey: correctionAccount,
      post: { id: "correct-after-missed", publishedAt: missedCorrectedPublication, text: "missed corrected" },
    });
    const reconsidered = (await store.query(
      `SELECT * FROM analytics_checkpoints WHERE checkpoint_id = $1`,
      [missedClaim.checkpointId],
    )).rows[0];
    assert.equal(reconsidered.status, "PENDING");
    assert.equal(reconsidered.observed_at, null);
    assert.equal(reconsidered.claim_token, null);
    assert.equal(reconsidered.lease_until, null);
    assert.equal(reconsidered.last_error, "PUBLICATION_TIME_CORRECTED");
    assert.equal(reconsidered.timing_history.length, 1);
    assert.equal(reconsidered.timing_history[0].status, "MISSED");
    assert.equal(reconsidered.timing_history[0].lastError, "OLD_WINDOW_ELAPSED");
    const reclaimed = (await repository.claimDueCheckpoints({
      accountKey: correctionAccount,
      now: new Date("2042-02-02T12:00:00.000Z"),
      limit: 10,
      leaseMs: 60_000,
    })).find(item => item.platformPostId === "correct-after-missed" && item.checkpointHours === 24);
    assert.ok(reclaimed);
    assert.equal((await repository.completeCheckpoint({
      checkpoint: reclaimed,
      metrics: { views: 4 },
      observedAt: new Date("2042-02-02T12:00:00.000Z"),
    })).status, "CAPTURED");

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
    const body = await exportAnalytics({ store, brand: "asap_gta6", now: "2042-02-02T12:00:00.000Z" });
    assert.equal(body.brand, "asap_gta6");
    assert.equal(body.accounts, 2);
    assert.equal(body.metrics.some(item => item.accountKey === "asap_katy:threads"), false);
    assert.equal(body.checkpoints.some(item => item.accountKey === "asap_katy:threads"), false);
    assert.equal(body.metrics.some(item => item.metrics.views === 999), false);
    assert.equal(body.metrics.some(item => item.metrics.views === 0 && item.availability === "MEASURED"), true);
    assert.equal(body.checkpoints.every(item => item.brand === "asap_gta6"), true);
    const correctedExport = body.checkpoints.find(item => item.platformPostId === "correct-after-capture" && item.checkpointHours === 24);
    assert.equal(correctedExport.collectionStatus, "LATE");
    assert.equal(correctedExport.windowStatus, "LATE");
    assert.equal(correctedExport.comparable, false);
    assert.equal(correctedExport.timingRevision, 2);
    assert.equal(correctedExport.timingHistory.length, 1);
    const correctedMetric = body.metrics.find(item => item.entityId === "correct-after-capture" && item.dimensions.checkpointHours === 24);
    assert.ok(correctedMetric);
    assert.equal(correctedMetric.dimensions.postAgeHours, 26.5);
    assert.equal(correctedMetric.dimensions.checkpointStatus, correctedExport.collectionStatus);
    assert.equal(correctedMetric.dimensions.checkpointWindowStatus, correctedExport.windowStatus);
    assert.equal(correctedMetric.dimensions.checkpointComparable, correctedExport.comparable);
    assert.equal(correctedMetric.collectionStatus, correctedExport.collectionStatus);
    assert.equal(correctedMetric.windowStatus, correctedExport.windowStatus);
    assert.equal(correctedMetric.comparable, correctedExport.comparable);
    assert.equal(correctedMetric.dimensions.originalCheckpointStatus, "CAPTURED");
    assert.equal(correctedMetric.metadata.originalCheckpoint.status, "CAPTURED");
    assert.equal(correctedMetric.metadata.originalCheckpoint.publishedAt, publishedAt);

    async function independentExport(schema, brandKey, accountKey, username) {
      const pool = await schemaPool(store, schema);
      isolatedPools.push(pool);
      await migratePool(pool);
      const scopedStore = poolStore(pool);
      await scopedStore.query(`INSERT INTO brands(brand_key, name) VALUES ($1,$2)`, [brandKey, brandKey]);
      await scopedStore.query(
        `INSERT INTO social_accounts(account_key, brand_key, platform, username, enabled, dry_run)
         VALUES ($1,$2,'threads',$3,TRUE,TRUE)`,
        [accountKey, brandKey, username],
      );
      const scopedDurable = createDurableRepository({ store: scopedStore });
      const scopedRepository = createAnalyticsRepository({ store: scopedStore, durable: scopedDurable });
      await scopedRepository.upsertDiscoveredPost({
        accountKey,
        post: { id: "overlapping-post", publishedAt: "2042-01-31T11:00:00.000Z", text: brandKey },
      });
      await scopedRepository.ensureCheckpoints();
      const checkpoint = (await scopedStore.query(
        `SELECT checkpoint_id FROM analytics_checkpoints
         WHERE account_key = $1 AND platform_post_id = 'overlapping-post' AND checkpoint_hours = 24`,
        [accountKey],
      )).rows[0];
      await scopedDurable.recordAnalyticsSnapshot({
        accountKey,
        entityType: "post",
        entityId: "overlapping-post",
        metrics: { views: 0 },
        capturedAt: "2042-02-01T12:00:00.000Z",
        metadata: { checkpoint: { id: String(checkpoint.checkpoint_id), hours: 24, status: "CAPTURED" } },
        idempotencyKey: `fixture:${brandKey}`,
      });
      const first = await exportAnalytics({ store: scopedStore, brand: brandKey, now: "2042-02-02T12:00:00.000Z" });
      const second = await exportAnalytics({ store: scopedStore, brand: brandKey, now: "2042-02-02T12:00:00.000Z" });
      return { localId: String(checkpoint.checkpoint_id), first, second };
    }

    const independentGta = await independentExport("analytics_id_gta", "asap_gta6", "asap_gta6:threads", "asapgta6");
    const independentKaty = await independentExport("analytics_id_katy", "asap_katy", "asap_katy:threads", "asapkaty");
    assert.equal(independentGta.localId, independentKaty.localId);
    const gtaCheckpointKey = independentGta.first.checkpoints.find(item => item.checkpointHours === 24).idempotencyKey;
    const katyCheckpointKey = independentKaty.first.checkpoints.find(item => item.checkpointHours === 24).idempotencyKey;
    const gtaSnapshotKey = independentGta.first.metrics.find(item => item.idempotencyKey.startsWith("social:checkpoint-snapshot:")).idempotencyKey;
    const katySnapshotKey = independentKaty.first.metrics.find(item => item.idempotencyKey.startsWith("social:checkpoint-snapshot:")).idempotencyKey;
    assert.notEqual(gtaCheckpointKey, katyCheckpointKey);
    assert.notEqual(gtaSnapshotKey, katySnapshotKey);
    assert.notEqual(gtaCheckpointKey.replace("social:checkpoint:", ""), gtaSnapshotKey);
    assert.deepEqual(independentGta.second.checkpoints.map(item => item.idempotencyKey), independentGta.first.checkpoints.map(item => item.idempotencyKey));
    assert.deepEqual(independentKaty.second.metrics.map(item => item.idempotencyKey), independentKaty.first.metrics.map(item => item.idempotencyKey));

    const legacyPool = await schemaPool(store, "analytics_legacy");
    isolatedPools.push(legacyPool);
    await migratePool(legacyPool, ["001_core.sql"]);
    await legacyPool.query(`INSERT INTO brands(brand_key, name) VALUES ('asap_gta6','ASAP GTA6')`);
    await legacyPool.query(
      `INSERT INTO social_accounts(account_key, brand_key, platform, username, enabled, dry_run)
       VALUES ('asap_gta6:threads','asap_gta6','threads','asapgta6',TRUE,TRUE)`,
    );
    const legacyPublishedAt = "2039-07-01T08:00:00.000Z";
    await legacyPool.query(
      `INSERT INTO posts(account_key, platform_post_id, content_type, text, status, published_at, metadata)
       VALUES ('asap_gta6:threads','legacy-post','text','legacy text','PUBLISHED',$1,'{"legacyMarker":"kept"}'::jsonb)`,
      [legacyPublishedAt],
    );
    await migratePool(legacyPool, [
      "002_analytics_checkpoints.sql",
      "003_analytics_checkpoint_fencing.sql",
      "004_analytics_publication_timing.sql",
    ]);
    const legacyStore = poolStore(legacyPool);
    let legacy = (await legacyStore.query(
      `SELECT published_at, metadata FROM posts WHERE platform_post_id = 'legacy-post'`,
    )).rows[0];
    assert.equal(legacy.published_at.toISOString(), legacyPublishedAt);
    assert.deepEqual(legacy.metadata.publishedAtProvenance, { source: "legacy_existing", verified: false });
    assert.equal(legacy.metadata.legacyMarker, "kept");
    const legacyDurable = createDurableRepository({ store: legacyStore });
    const legacyRepository = createAnalyticsRepository({ store: legacyStore, durable: legacyDurable });
    await legacyDurable.upsertPost({
      accountKey: "asap_gta6:threads",
      platformPostId: "legacy-post",
      text: "unverified refresh",
      publishedAt: "2042-01-01T00:00:00.000Z",
      metadata: { refreshed: true, publishedAtProvenance: { source: "local_completion", verified: false } },
    });
    legacy = (await legacyStore.query(
      `SELECT published_at, metadata FROM posts WHERE platform_post_id = 'legacy-post'`,
    )).rows[0];
    assert.equal(legacy.published_at.toISOString(), legacyPublishedAt);
    assert.deepEqual(legacy.metadata.publishedAtProvenance, { source: "legacy_existing", verified: false });
    assert.equal(legacy.metadata.legacyMarker, "kept");
    assert.equal(legacy.metadata.refreshed, true);
    assert.equal((await legacyRepository.ensureCheckpoints()).created, 0);
    assert.equal((await legacyStore.query(`SELECT COUNT(*)::int AS count FROM analytics_checkpoints`)).rows[0].count, 0);
    await legacyRepository.upsertDiscoveredPost({
      accountKey: "asap_gta6:threads",
      post: { id: "legacy-post", publishedAt: legacyPublishedAt, text: "verified readback" },
    });
    assert.equal((await legacyRepository.ensureCheckpoints()).created, 2);
    assert.equal((await legacyStore.query(`SELECT COUNT(*)::int AS count FROM analytics_checkpoints`)).rows[0].count, 2);
  } finally {
    try { await store.query(`DROP TRIGGER IF EXISTS reject_checkpoint_capture_trigger ON analytics_checkpoints`); } catch (_) {}
    try { await store.query(`DROP FUNCTION IF EXISTS reject_checkpoint_capture()`); } catch (_) {}
    for (const pool of isolatedPools) {
      try { await pool.end(); } catch (_) {}
    }
    for (const schema of isolatedSchemas) {
      try { await store.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } catch (_) {}
    }
    await store.close();
  }
});
