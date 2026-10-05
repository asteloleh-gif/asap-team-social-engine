# ASAP launch-readiness engineering review

Date: 2026-10-05. Scope: the isolated ASAP implementation and fixture tests. No production Astel changes, live provider calls, credential inspection, deployment or external publication were performed by this review.

## Verified implementation

- The separate entrypoint scopes one brand to its database and Redis namespace, excludes disabled routes, and checks the exact API account before external publication. Current formats are Threads text, Facebook Page text and Instagram single image.
- Exact reviewed content hash/version and standing authorization are checked before scheduling. Pause and required storage are checked again immediately before the final visible mutation. Ambiguous provider outcomes enter a hold without automatic republishing.
- Terminal Redis transitions now atomically retain pending PostgreSQL projection work. Finished, reconciled, expired-lease and cancelled jobs recover from projection failures. Paginated scans retain empty-page cursors and COUNT overflow rather than starving later pending jobs.
- The ASAP entrypoint uses permanent Redis dedupe. A durable draft-to-job binding also blocks replay when the hot row is missing, reporting UNKNOWN/recoveryRequired rather than enqueueing again. Legacy entrypoint retention remains unchanged; the older-state caveat is documented in PUBLISHING_SCOPE.md.
- Preflight now rejects all-disabled platform configurations and short analytics tokens consistently with startup.
- Lazy Distribution integration is a pure prepared-content adapter. Hyper Crew integration is a scoped analytics pull connector. Neither means a live upstream workflow or authenticated sync has been connected.

## Evidence

- Engineering suite: 290/290 passing, including 21 new regression tests relative to the 269-test source checkpoint.
- Marketing QA: 22/22 passing.
- Fresh loopback Redis 8.0.2: terminal hot commit retained across client recreation and projected without a publication call; expired hold, reconciliation and cancellation atomically marked for recovery; all 600 unchanged pending IDs reached with COUNT=1; permanent ASAP dedupe blocked an accelerated old-expiry replay; an unexpired older key became persistent on replay.
- Earlier real PostgreSQL/Redis and HTTP fixture evidence remains documented in INTEGRATION_TEST_LOG.md. The additional fault-injection tests simulate PostgreSQL outages; the new real-storage run used real Redis with a fixture projection sink, not a fresh real PostgreSQL outage test.
- Toolchain for this review: Node 24.19.0 / npm 11.9.0. Exact package-pinned Node 24.20.0 / npm 11.19.0 verification remains separate.

## Required before live enablement

1. Securely install only the intended ASAP grants and secrets. Verify actual app identity, granted scopes, expiry, Threads eligibility, Facebook Page token and linked Professional Instagram identity. OAuth URL/state preparation does not perform consent, exchange or installation.
2. Prove the intended GTA6 and Katy destinations independently. In particular compare approved Facebook Page IDs across both instances; per-instance configuration alone permits the same numeric Page ID in both.
3. Confirm the selected isolated runtime fits existing paid resources and prove deployed Redis persistence, PostgreSQL access, restart recovery and retained pause. A local fixture is not deployed durability.
4. From Kevin's actual environment, prove authenticated status/draft/schedule/job/pause/resume access. Start paused, enable only a proven route, and complete a real canary with known post ID, correct-account/content readback and permalink, then replay the schedule with no second post.
5. Require rights and staging evidence before an Instagram image canary. Video, Reels and carousels remain disabled. Unknown-ID reconciliation and missing-hot-row recovery require investigation; neither authorizes a replacement publish.
6. Run the real scoped Hyper Crew pull and collect comparable measurement windows. Threads insights require the real grant; Instagram/Facebook insights remain unavailable in this milestone. Do not report missing measurements as zero or a disconnected adapter as connected.

Overall: locally verified implementation checkpoint; live launch remains blocked on the listed real-access, deployment and canary evidence.
