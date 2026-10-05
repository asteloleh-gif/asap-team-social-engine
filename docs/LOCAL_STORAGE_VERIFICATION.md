# Bounded local storage verification

Purpose: prove the source queue's real Redis atomic operations, Postgres projection and restart/lease/pause behavior. No Meta token is required, and no provider mutation is allowed by the harness.

Inspect the selected executor for already-installed Node/npm and Redis/PostgreSQL or Docker. If absent, report the exact missing binary; do not install new system software for this bounded check. Never read or change existing Astel configuration, containers, volumes, database state or queues.

## Isolated test resources

- Work in a newly created task workspace, not an existing production checkout.
- Create a unique suffix. New container/process names: asap-storage-test-pg-<suffix> and asap-storage-test-redis-<suffix>.
- Bind only to 127.0.0.1 on automatically allocated unused ports. Do not use existing/default 5432 or 6379 ports.
- Database name: asap_test_<suffix>. It must be created in the new throwaway Postgres instance, not an existing DB service.
- Use a new temporary data directory/volume only. Do not reuse external volumes. Redis should run appendonly yes for any server restart check.
- Use a disposable local-only fixture password if needed; never copy real service credentials.

## Commands in extracted source

1. npm ci --ignore-scripts --no-audit --no-fund --cache <new-task-cache>
2. npm test
3. Set ASAP_TEST_STORAGE_IS_THROWAWAY=true, ASAP_TEST_DATABASE_URL to the newly created loopback Postgres fixture, and ASAP_TEST_REDIS_URL to the newly created loopback Redis fixture.
4. node tools/asap-storage-integration.js

The script refuses remote hosts, default ports, non-test database names and missing explicit throwaway-state acknowledgment. It creates namespaced fixture records in only those test resources, never calls Meta, and closes clients. It does not create/delete databases or remove containers.

Expected PASS checks: Redis enqueue/dedupe, queue survives client/worker recreation, Publish Engine dry-run, Postgres durable projection, expired lease → AMBIGUOUS_HOLD without replay, persisted pause/resume and daily ceiling. Return concise PASS/FAIL evidence and exact toolchain versions without credential strings.

## Cleanup

Stop only the containers/processes newly created and recorded by this task. Keep their names/IDs in local task scope. Removing their disposable data or volumes is optional and requires the executor's applicable confirmation rules; leaving stopped throwaway resources for owner review is safe. Never run global prune, broad rm, stop-all or cleanup against preexisting resources.

A client recreation test is not a server/storage durability test. If Redis/Postgres server restart is also tested, record it separately with persistence settings and results. No local test establishes deployed cloud readiness or public publication.
