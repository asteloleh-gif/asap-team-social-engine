ALTER TABLE analytics_checkpoints
  ADD COLUMN IF NOT EXISTS timing_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS timing_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS published_at_provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE posts
SET metadata = jsonb_set(
  metadata,
  '{publishedAtProvenance}',
  '{"source":"legacy_existing","verified":false}'::jsonb,
  TRUE
)
WHERE published_at IS NOT NULL
  AND metadata -> 'publishedAtProvenance' IS NULL;

UPDATE analytics_checkpoints c
SET published_at_provenance = COALESCE(p.metadata -> 'publishedAtProvenance', '{}'::jsonb)
FROM posts p
WHERE p.account_key = c.account_key
  AND p.platform_post_id = c.platform_post_id
  AND c.published_at_provenance = '{}'::jsonb;

CREATE OR REPLACE FUNCTION reconcile_analytics_checkpoint_timing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.published_at IS DISTINCT FROM OLD.published_at
     AND NEW.published_at IS NOT NULL
     AND COALESCE((NEW.metadata #>> '{publishedAtProvenance,verified}')::boolean, FALSE) = TRUE THEN
    UPDATE analytics_checkpoints c
    SET timing_history = c.timing_history || jsonb_build_array(jsonb_build_object(
          'revision', c.timing_revision,
          'publishedAt', c.published_at,
          'publishedAtProvenance', c.published_at_provenance,
          'opensAt', c.opens_at,
          'dueAt', c.due_at,
          'closesAt', c.closes_at,
          'status', c.status,
          'lastError', c.last_error,
          'observedAt', c.observed_at,
          'correctedAt', NOW()
        )),
        timing_revision = c.timing_revision + 1,
        published_at = NEW.published_at,
        published_at_provenance = COALESCE(NEW.metadata -> 'publishedAtProvenance', '{}'::jsonb),
        opens_at = NEW.published_at + (c.checkpoint_hours - c.tolerance_hours) * INTERVAL '1 hour',
        due_at = NEW.published_at + c.checkpoint_hours * INTERVAL '1 hour',
        closes_at = NEW.published_at + (c.checkpoint_hours + c.tolerance_hours) * INTERVAL '1 hour',
        status = CASE
          WHEN c.observed_at IS NOT NULL
               AND c.observed_at > NEW.published_at + (c.checkpoint_hours + c.tolerance_hours) * INTERVAL '1 hour'
            THEN 'LATE'
          WHEN c.observed_at IS NOT NULL THEN 'CAPTURED'
          WHEN c.status = 'IN_PROGRESS' THEN 'PENDING'
          WHEN c.status = 'MISSED'
               AND c.observed_at IS NULL
               AND NEW.published_at + (c.checkpoint_hours + c.tolerance_hours) * INTERVAL '1 hour' >= NOW()
            THEN 'PENDING'
          ELSE c.status
        END,
        claim_token = CASE
          WHEN c.status = 'IN_PROGRESS'
            OR (c.status = 'MISSED'
                AND c.observed_at IS NULL
                AND NEW.published_at + (c.checkpoint_hours + c.tolerance_hours) * INTERVAL '1 hour' >= NOW()) THEN NULL
          ELSE c.claim_token
        END,
        lease_until = CASE
          WHEN c.status = 'IN_PROGRESS'
            OR (c.status = 'MISSED'
                AND c.observed_at IS NULL
                AND NEW.published_at + (c.checkpoint_hours + c.tolerance_hours) * INTERVAL '1 hour' >= NOW()) THEN NULL
          ELSE c.lease_until
        END,
        last_error = CASE
          WHEN c.status = 'IN_PROGRESS'
            OR (c.status = 'MISSED'
                AND c.observed_at IS NULL
                AND NEW.published_at + (c.checkpoint_hours + c.tolerance_hours) * INTERVAL '1 hour' >= NOW())
            THEN 'PUBLICATION_TIME_CORRECTED'
          ELSE c.last_error
        END,
        updated_at = NOW()
    WHERE c.account_key = NEW.account_key
      AND c.platform_post_id = NEW.platform_post_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reconcile_analytics_checkpoint_timing_trigger ON posts;
CREATE TRIGGER reconcile_analytics_checkpoint_timing_trigger
AFTER UPDATE OF published_at, metadata ON posts
FOR EACH ROW
EXECUTE FUNCTION reconcile_analytics_checkpoint_timing();
