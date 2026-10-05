# ASAP analytics checkpoint readiness

This runbook prepares implementation readiness only. It does not authorize deployment, account grants, live collection, publication, or a pilot.

## Invariants

- `ASAP_PROJECT_ID` is ignored for compatibility. The runtime project scope is hardcoded to `asap-team`.
- `SOCIAL_BRAND` must exactly equal `ASAP_BRAND`.
- Each brand uses its own PostgreSQL database, Redis namespace, accounts, and tokens.
- `ASAP_ANALYTICS_ENABLED=false` until exact-account identity, permissions, resource budget, and owner approval are verified.
- Publication pause and analytics enablement are independent. Pausing publication does not erase checkpoints or resume publishing. Analytics continuation requires its own explicit enabled setting.
- A successful `/health` or preflight proves local configuration/storage only, never Meta identity or permission scope.

## Checkpoint contract

- Create checkpoint state only for durable `PUBLISHED` posts with an actual successful `published_at`.
- 24-hour comparison window: target 24h, tolerance ±2h.
- 72-hour comparison window: target 72h, tolerance ±6h.
- Before the window: `PENDING`; inside it: `DUE`; captured after it: `LATE`; a failed/no observation after it: `MISSED`.
- `FAILED`, `UNSUPPORTED`, `NOT_COLLECTED`, and measured zero are distinct. Missing values remain `null`; no absent provider metric is converted to zero.
- Checkpoint state is durable and uniquely keyed by account, platform post, and checkpoint hour. Discovery lookback/limit does not select due checkpoints. Expiring leases allow retry after restart without duplicate checkpoint snapshots.

## Setup checklist

1. Fill one brand's non-secret schema from `config/asap_gta6.env.example` or `config/asap_katy.env.example` in approved secret storage. Do not commit values.
2. Keep `ASAP_LIVE_ENABLED=false` and `ASAP_ANALYTICS_ENABLED=false`.
3. Verify dedicated PostgreSQL/Redis storage and migrations, including `002_analytics_checkpoints.sql`.
4. Verify exact account identity and analytics permission readback separately; preflight is not proof.
5. Verify the export rejects missing/incorrect bearer auth and is scoped to the configured brand/project.
6. Enable analytics only in the separately authorized runtime stage. The default prepared cadence is one hour, which can enter both comparison windows when the runtime is healthy.
7. Record every observation using `config/analytics_checkpoint_evidence.example.json`. Do not put secrets or private account/budget identifiers in public artifacts.

## Pilot close

D7 stops new pilot publications. It does not delete services/data, stop compute, extend the pilot, or fabricate final metrics. The final observation deadline is the last actual successful post's `published_at + 72h`, with the ±6h quality window shown in UTC and America/Chicago. Complete the handoff only after that observation is measured or explicitly marked missing with a reason.
