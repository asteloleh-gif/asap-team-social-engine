# ASAP Team Mission 02: implementation checkpoint

## What works

- The three approved source repositories are accessible and their public source commits are pinned.
- Isolated native source copy and a separate ASAP entrypoint exist.
- 290 engineering tests passed in the refreshed sanitized source. Marketing QA passed 22 checks, with the 10-item/30-variant first wave and 10 JPEG assets independently rechecked. Live deployment/publication acceptance remains gated.
- Real local Redis/PostgreSQL durability and authenticated HTTP draft/queue/restart flows passed without external publication calls.
- Scoped draft intake, exact-content standing authorization, idempotency, paused scheduler composition, per-platform limits and explicit ambiguous holds are implemented.
- Threads text, Facebook text and Instagram single-image API routes are implemented and fixture-tested with identity/readback guards.

## What failed or remains blocked

- No ASAP publication or live scheduler has been claimed or started. Exact account grants, isolated runtime credentials, paid headroom and real deployed persistence still require verification.
- Public repository contains public source provenance only at the last verified branch read. Bulk source export was blocked/interrupted; no full code push is claimed.
- Real local Postgres/Redis verification passed in throwaway cloud fixtures. Deployed runtime storage still requires its own verification.
- Instagram/Facebook insights, Reels/video/carousels and unknown-ID automatic reconciliation remain unavailable.

## What was recovered

The original working Meta route and its historical failures: Facebook Login linked Page-token fallback for Instagram, exact Graph identity, owned media, polling/reply/self-guard separation, and owner/tester Threads access. New-post publishing is explicitly distinguished from comment replies.

## What was built

Separate two-brand configuration schemas, prepared-content pipeline without automatic LLM calls, pure Distribution preview, scoped Hyper Crew analytics adapter, canonical JSONB-safe hashes, readback-based reconciliation that never republishes, null-metric preservation, first-wave bridge and guarded local storage harness. A sanitized source archive preserves source attribution while excluding credentials/private runtime metadata/history.

## Marketing findings and experiments ready

60 concepts, 10 first-wave core items with 30 platform variants, a 42-cell week matrix (30 proposed publish cells and 12 observation cells), source/asset register and metric contract. The content is prepared, not queued or published. Text-only Threads/Facebook canaries need no new media generation. Instagram has explicit rights, staging and capability gates.

## Global blockers for the owner

Exact secure account grants and runtime credential installation; any unresolved login/security challenge; confirmation that selected runtime usage fits existing paid resources. Private account/billing details are intentionally not repeated in this public-capable report.

## Next three actions

1. Resolve the code-export/deployment gates while preserving the validated local source and storage results.
2. Finish secure identity/grant/runtime preflight, then run one real Threads canary with exact readback and duplicate replay proof.
3. Enable only proven independent routes, connect scoped metrics, and collect the defined comparable windows before changing strategy.

## Extra opportunities

Top three: exact evidence/asset gate (NOW), one master to scoped platform payloads (NOW), and age-matched metrics/learning (NEXT). See docs/EXTRA_ROADMAP.md.

## Source recovery and projection regression checks: 2026-10-05

The refreshed source includes final visible-mutation pause fences for Threads, Instagram and Facebook, stricter brand-key checks, and pending durable-projection retries. Three mutation-fence tests brought the earlier regression count to 269/269. Projection and permanent-dedupe regression tests now bring this sanitized source to 290/290: failed terminal-state/upsert projections retry without provider replay; expired-lease and cancellation projections remain pending until confirmed; Redis scan pagination progresses; terminal Redis transitions atomically retain pending projection work. A fresh Redis 8.0.2 check independently passed atomic transition/recreation recovery, all 600 pending IDs with COUNT=1, persistent ASAP dedupe and upgrade of unexpired legacy bindings. It made zero provider calls. The ASAP runtime retains draft-to-job replay guards; historical loss of both binding and dedupe requires pause and manual reconciliation before live use.

Previously verified Redis/PostgreSQL and authenticated HTTP tests apply to the earlier 266-test checkpoint. They prove isolated local storage behavior with fixture identities and zero external publication calls. They do not prove current deployed storage, account grants, budget headroom or live publication. Exact pinned CI toolchain verification remains outstanding.

Final source-release review: GO for the sanitized implementation artifact after 290/290 regression tests; live deployment remains gated. Preflight now matches startup checks for disabled routes and analytics-token validation. Facebook destinations require explicit granted Page-ID verification and cross-brand uniqueness; Page names alone are not treated as identity proof.
