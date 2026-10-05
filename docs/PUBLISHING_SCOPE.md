# ASAP publishing authorization and operating scope

The owner authorized this isolated project to publish its own ASAP GTA6 and ASAP Katy content to Threads, Instagram and Facebook. The implementation records this as a standing owner instruction, not per-post manual review.

- Project: asap-team
- Brands: asap_gta6 and asap_katy
- Only exact API-verified account identities entered into the isolated runtime are eligible.
- Before enabling Facebook for both brands, compare their approved Page IDs and prove they are distinct intended destinations. The per-instance ID pin does not enforce cross-instance uniqueness or infer a Page's brand from its display name. Keep unverified routes disabled; this check needs the actual granted identities, not placeholder values.
- Every draft has a stable content ID, version and canonical SHA-256 hash; review PASS must refer to that exact hash.
- The authorization record binds brand, account key, platform user ID and exact content version/hash.
- No authorization extends to Astel production, other accounts, other platforms, purchases, account/security changes or additional paid services.
- Quality review, source/rights checks, daily publication limits and duplicate protection remain mandatory.

## Supported formats in this milestone

- Threads: text
- Facebook Page: text
- Instagram: one JPEG image with caption, HTTPS source media and owned-or-authorized rights declaration
- Reels/video/carousels: not implemented in the new ASAP publisher; disabled

## Pause/resume

Authenticated POST /internal/asap/pause persists pause in the isolated Redis namespace. POST /internal/asap/resume re-verifies all configured account identities before allowing the scheduler to process due work. Both require an Idempotency-Key. New state defaults to paused; restart preserves the existing setting. Terminating the worker stops execution without discarding queued jobs. Expired in-flight leases go to AMBIGUOUS_HOLD and are not blindly retried.

Start with one reviewed canary in one connected route. Require a post ID, exact account readback and permalink, then retry the same schedule request and require no second post. Only then schedule the ready experimental batch. A failing platform does not authorize disabling safety or stopping an independently verified platform.

## Duplicate retention and pre-live upgrade

The ASAP entrypoint uses non-expiring Redis draft dedupe keys; legacy entrypoints retain their previous 30-day default. A replay also checks the PostgreSQL draft's saved job and exact brand/account/identity/version/hash authorization. If that job is missing from hot storage, the response returns its original ID with `jobStatus: UNKNOWN` and `recoveryRequired: true`; it never creates a replacement post. A new content ID or explicitly reviewed new version creates a distinct draft.

Replaying an unexpired older dedupe key through the persistent mode removes its TTL. An already-expired key can still be protected by its durable draft-to-job binding. This is not a bulk migration or full Redis disaster-recovery implementation. If an older deployment has lost both that binding and its dedupe key, keep it paused and reconcile historical publish runs before enabling it; do not assume an absent hot row means unpublished content. The isolated ASAP runtime had no live publication at this checkpoint.
