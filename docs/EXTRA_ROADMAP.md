# EXTRA opportunities

No growth outcome is guaranteed. These priorities reflect implemented code and verified local tests, not real publication performance.

## Top 3

### NOW: evidence and exact-asset gate

Problem: a generated cover, old claim, or wrong asset can be mistaken for evidence. Reuse app/asap/marketingBridge.js, the claim register and exact text/asset hashes. Implemented: text checksum, account binding freshness, image hash and rights/staging checks, source recheck metadata. Missing: live asset staging and final source recheck at actual publication. Measure false holds, prevented errors and review time. First experiment: prepare G01 text; reject an unbound account and an image with a changed asset hash. These local tests pass. Effort remaining: roughly half to one engineering day depending on storage access. New AI/API provider not needed; hosting/storage cost unknown.

### NOW: one master to three scoped payloads

Problem: manual repackaging loses evidence and creates duplicate publishers. Reuse Lazy Distribution ContentEnvelope, exact first-wave platform variants and the ASAP adapter. Implemented: deterministic preview with zero AI/network calls, exact hash review and one Publish Engine. Missing: live API binding/canary per platform and authenticated Kevin operation. Measure packaging time, content consistency and duplicate attempts prevented. First experiment: G01 text variants plus image variant with verified staged asset; replay schedule returns original job ID. Local idempotency tests pass. Effort remaining: around half a day after credentials/runtime. External running costs remain unknown; no paid LLM calls are required.

### NEXT: age-matched metrics and learning

Problem: mixed lifetime counters and unavailable metrics produce misleading winners. Reuse Threads insights, analytics export, Hyper Crew's scoped connector and the marketing metric contract. Implemented: unknown/null is not zero, ASAP-only ingest wrapper, provenance/age fields in prepared experiments. Missing: actual 24/72-hour snapshots, IG/FB insights and sufficient comparable repetitions. First experiment: one verified post collected at comparable ages, null-follows fixture remains unavailable, duplicate data sources do not double-count. Measure metric coverage and wrong-brand/unavailable errors. Effort: one to two days after live routes; API/runtime cost unknown. Do not select a global winner from one post.

## Next and later

- NEXT: expiry/readiness checks and ambiguity reconciliation. Known-ID reconciliation is now implemented and fixture-tested; unknown-outcome discovery and secure token expiry monitoring remain to be verified. Prevent duplicate posts without weakening hold behavior.
- NEXT: topics from deidentified comments on owned ASAP accounts once actual conversations exist. Reuse owned-account polling only after the required scopes/format boundaries are verified; no unsolicited reply engine is enabled by this task.
- LATER: read-only Kevin status dashboard over the same source of queue/metric truth. Build only when it saves operator time; no duplicate state store.
- LATER: YouTube/Pinterest packaging readiness from the selected Distribution source. Their publication is outside the current authorization.

Full marketing rationale is retained in EXTRA_MARKETING_INPUT.md. No video factory, Telegram integration, full crew graph for status calls, new paid services, or speculative monetization automation is added.
