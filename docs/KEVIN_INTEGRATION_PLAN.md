# Integration sequence and API contract

1. Preserve source provenance; complete isolated code/tests.
2. Resolve owner login and exact ASAP account grants. Put credentials only into isolated secret storage.
3. Verify existing paid runtime headroom before deployment. Use two dedicated brand instances/state partitions; never commit a production environment's unrelated staged patch.
4. Start paused. Call the authenticated status API from Kevin's actual environment.
5. Import one prepared, exact-hash-reviewed Threads text draft. Schedule, resume, require post ID + account/permalink readback, replay schedule without duplication, then pause.
6. Restart worker with pending fixture jobs and prove queue/pause/lease safety. Expand only verified routes.
7. Run real Instagram image and Facebook text canaries when credentials and assets are ready.
8. Connect isolated analytics exports to Hyper Crew, collect comparable 24/72-hour windows, retain unavailable/unknown values explicitly.

## HTTP operations

All /internal/asap routes require Authorization: Bearer using ASAP_CONTROL_TOKEN. Use HTTPS outside local testing. Every mutation also requires Idempotency-Key; repeated requests must retain the same body. API timeout should exceed 60 seconds for an image's bounded processing/readback sequence; job status is the recovery source.

- GET /internal/asap/status: account scope, persisted pause, queue/scheduler and provider state; read-only
- POST /internal/asap/distribution/preview: ContentEnvelope + explicit content + exact-hash PASS review → deterministic scoped package; no AI/publication effects
- POST /internal/asap/drafts: same input → stable durable draft ID/hash/version
- GET /internal/asap/drafts/:id: exact scoped draft
- POST /internal/asap/schedule: draftId, contentHash, scheduledAt → durable job ID and standing authorization record
- GET /internal/asap/jobs/:id: persisted publication status/result
- POST /internal/asap/reconcile: jobId and known platformPostId → exact account/content/time readback; persist verified result without any publication call. Unknown IDs remain held for investigation.
- POST /internal/asap/pause or /resume: persisted scheduler gate; resume verifies API identities
- GET /internal/analytics/export?days=30: separate ASAP_ANALYTICS_TOKEN, isolated export for Edie

Never call upstream Distribution preview/publish/sandbox-smoke routes for read-only checks: their side effects are not adopted by this runtime. Never configure this runtime with Astel credentials or shared production database state.
