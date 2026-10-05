# Integration test log

## Local milestone: 2026-10-05

- Copied source: 140 files. All original Git blob hashes were verified byte-for-byte before adaptations.
- Original baseline: 246 tests passed, 0 failed.
- Adapted local suite: 258 tests passed, 0 failed at this checkpoint.
- Toolchain used locally: Node 24.19.0 / npm 11.9.0. Upstream pins Node 24.20.0 / npm 11.19.0; local npm emitted an engine warning. Exact pinned CI verification is separate.
- npm ci used the locked dependency tree, ignore-scripts and a writable local cache. No dependency upgrade or audit fix was performed.
- New tests cover cross-brand/production rejection, JSONB-safe hashes, exact-version review/standing grant, identity-before-mutation, Threads and IG API stages, Facebook ambiguous timeout, preservation of published IDs after failed readback, idempotency mismatch and duplicate job ID handling, Hyper Crew mixed-project rejection, and persisted pause/limit behavior across injected Redis client recreation.
- API tests use fixtures. No publication, OAuth grant or production mutation was performed by local verification.

## Still required in deployed isolated runtime

- Real Postgres/Redis connectivity and persistence, restart/lease recovery, persisted pause/resume
- Actual Kevin authenticated operation calls, per-account identity and permission/expiry proofs
- One real publication + permalink/account readback per enabled format, duplicate replay test
- Real analytics sync and comparable 24/72-hour metric windows
- Confirmed actual runtime location/state and pause/resume operation

Do not label the overall Autopilot live/complete on the basis of this local test log.

## Later local checkpoint

264/264 engineering tests and 22/22 marketing QA checks passed. Added exact first-wave-to-ContentEnvelope mapping, withheld unverified account binding, exact-asset rights/staging gate, null/empty metrics preservation, no-publish reconciliation with owner/content/time checks, and a guarded real-storage verification harness. The sanitized delivery ZIP independently passed the same 264-test suite using the already-installed dependency tree. Real storage checks remain pending on an appropriate executor.

## Access and executor verification update

The bounded Mac check found no installed Redis/Postgres/Docker, so real storage tests were NOT RUN. The Mac check made no installation or storage changes. New pure OAuth-plan validation is covered locally, bringing the current suite to 265 tests. Railway browser authentication and runtime cost headroom remain unverified. The remote repository was re-read after an interrupted bulk-tree operation; its branch still contained public provenance only, and the expected bulk tree was absent. No blind write retry was made.

## Real isolated cloud storage and HTTP verification

The local storage gap was subsequently resolved without using the Mac or provisioning paid resources. Official signed Debian snapshot packages for Redis 8.0.2 and PostgreSQL 17.11 were extracted into temporary directories without system installation, root privileges or post-install scripts. New fixture servers bound only to loopback on nondefault ports, used no production state and were stopped after testing. The container does not support Unix sockets, so the new fixture Postgres server used loopback TCP only.

PASS: real Redis atomic enqueue/dedupe; queue survives worker/client recreation; Publish Engine dry-run; PostgreSQL durable projection; expired lease becomes AMBIGUOUS_HOLD; persisted pause/resume and daily ceiling. Redis AOF and Postgres records also survived abrupt process recreation and an explicit clean server stop/start.

This test exposed an upstream gap: Redis lease recovery did not project the hold into PostgreSQL. The ASAP copy now projects AMBIGUOUS_HOLD with WORKER_LEASE_EXPIRED, and the strengthened real-storage check passed after the fix.

PASS: authenticated HTTP prepared-draft/schedule flow over real storage, unauthorized/missing-idempotency rejection, exact content hash, duplicate schedule replay, zero-provider-call dry-run, and retained pause/job after full app recreation. Platform identity in this HTTP fixture was injected; it is not evidence of live Meta access. Total external publication calls: zero.

Current engineering suite: 266/266. Marketing QA: 22/22. Deployed runtime, real OAuth grants, publication/readback and live metrics remain separate unmet acceptance gates.

## Provisional recovered source checkpoint: 2026-10-05

Working-source regression log: 269/269 passed after adding three final visible-mutation fence tests and stricter brand-key checks. The refreshed export also carries pending durable-projection retry changes. Release is held for dedicated failure/retry tests and correction of expired-lease projection tracking and Redis scan pagination. The earlier real Redis/PostgreSQL server restart and authenticated HTTP checks remain valid historical evidence for the 266-test checkpoint only. No deployed runtime or external publication is verified.

## Sanitized source regression verification: 2026-10-05

290/290 tests passed from the refreshed sanitized tree after integrating final-mutation fences and projection-recovery fixes. Eighteen targeted tests cover terminal-state/upsert outages, reconciliation, expired-lease and cancellation projection recovery, cursor advancement/overflow, atomic Redis transition/marker contracts and persistent draft dedupe. A fresh isolated Redis 8.0.2 check passed all 600 pending IDs at COUNT=1, worker recreation and permanent dedupe behavior with zero provider calls. This is additional current Redis evidence, not a new deployed-runtime or full PostgreSQL restart check. These local results do not establish deployed storage, account authorization, budget or live publication readiness.

Three additional preflight-parity checks passed for all-disabled routes and analytics-token validation, bringing the final sanitized source to 290/290. See LAUNCH_READINESS_REVIEW.md for explicit source-release approval and unresolved live gates.
