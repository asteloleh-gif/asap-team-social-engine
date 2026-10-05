# ASAP Social Engine architecture

## Composition

server-asap.js is a separate composition root. It does not import the legacy server, start reply bots, call a full crew graph, or use production account defaults. npm start runs this entrypoint. Historical source entrypoints are retained for attribution/reference, not deployment.

One instance serves one brand with up to one account per platform. Use separate database names asap_gta6 / asap_katy and separate Redis namespaces asap:<brand>:v1. Production database names and Astel namespaces are rejected. No credentials are bundled.

The implementation reuses upstream provider contracts, Threads text publishing, Publish Engine, Redis queue and leases, durable PostgreSQL event/post storage, draft repository, control idempotency store, authenticated analytics export and Threads insights. The source scheduler runs at five-second intervals, one job per batch. A persisted pause gate controls due-job selection.

Lazy Distribution supplies the ContentEnvelope contract and packaging pattern. The ASAP adapter is deterministic and side-effect-free for previews; it never calls the upstream mutation routes or AI on preview. Meta publishing has exactly one owner: Publish Engine.

Hyper Crew's analytics connector is vendored with attribution and wrapped with strict ASAP project/account checks. It is instantiated with new isolated bindings, never by replacing existing Astel environment variables. Automatic full-agent execution remains off.

## Integrity and recovery

- Canonical content hashing survives JSONB key ordering.
- All writes use caller authentication and an operation idempotency key.
- Reusing a completed operation key with changed input is rejected.
- Scheduling uses a stable draft/content hash dedupe key and returns the existing job ID on duplicates.
- Final Meta mutations are not retried after ambiguous responses.
- Worker crash with an expired processing lease moves work to a hold.
- Readback failure preserves a known published ID instead of creating another post.
- Required database liveness is checked immediately before publication.
- Runtime storage must be a dedicated database plus durable Redis (AOF/persistent volume). Redis persistence and cold recovery must be proven in the deployed environment.

## Costs and limits

Prepared-content draft/preview/schedule/status calls use zero LLM requests. Publication attempts have a per-platform daily ceiling (default 2, maximum 3). Runtime/API/storage cost is unknown until measured. No new paid resource is provisioned by these files.

## Known unfinished acceptance gates

Live per-account grants, isolated runtime provisioning within confirmed existing capacity, restart test with real storage, real publication/readback, end-to-end Kevin API access, Hyper Crew live sync and 24/72-hour measurement remain deployment checks. Instagram/Facebook analytics and video publishing are explicitly unavailable in this milestone. The local tests use injected boundaries and are not a production claim.
