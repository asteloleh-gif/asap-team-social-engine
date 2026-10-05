ALTER TABLE analytics_snapshots
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_snapshots_idempotency_uq
  ON analytics_snapshots(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS analytics_checkpoints (
  account_key TEXT NOT NULL REFERENCES social_accounts(account_key) ON DELETE CASCADE,
  platform_post_id TEXT NOT NULL,
  checkpoint_hours INTEGER NOT NULL CHECK (checkpoint_hours IN (24, 72)),
  tolerance_hours INTEGER NOT NULL CHECK (tolerance_hours >= 0),
  published_at TIMESTAMPTZ NOT NULL,
  opens_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','IN_PROGRESS','CAPTURED','LATE','MISSED','FAILED','UNSUPPORTED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ,
  observed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_key, platform_post_id, checkpoint_hours)
);

CREATE INDEX IF NOT EXISTS analytics_checkpoints_due_idx
  ON analytics_checkpoints(account_key, opens_at, closes_at)
  WHERE observed_at IS NULL AND status IN ('PENDING','FAILED','IN_PROGRESS');
