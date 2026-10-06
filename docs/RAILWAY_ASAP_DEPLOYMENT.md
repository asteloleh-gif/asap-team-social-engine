# Isolated ASAP deployment

Deploy the reviewed launch branch into a separate ASAP environment/project after confirming the resource budget. Do not accept staged changes in an existing Astel production environment. Two brand instances use the same image but distinct credentials and state.

## Build and runtime

The Dockerfile pins Node 24.20.0 and explicitly installs npm 11.19.0. It runs the engineering suite during build, uses the unprivileged node user, and starts only server-asap.js. Railway runs preflight before deployment and checks /health. A failed start gets at most three retries.

GitHub Actions has exercised the container build successfully. The latest reviewed engineering head is `53e0c48318b2bebb4971e77481eb82400bbec6b8`; [CI run 37354400688](https://github.com/asteloleh-gif/asap-team-social-engine/actions/runs/37354400688) passed the host tests and isolated runtime image build. The accepted v4 evidence records 300 host tests passed (0 failed, 0 skipped), and 299 container tests passed with the PostgreSQL integration test skipped because its database was not injected into the build. These are CI results, not Railway runtime evidence. The original DELIVERY_MANIFEST.json describes the recovered snapshot, not files added in subsequent deployment commits.

## Required private configuration

Use config/asap_gta6.env.example and config/asap_katy.env.example as schemas. Keep ASAP_LIVE_ENABLED=false and ASAP_ANALYTICS_ENABLED=false initially. Set ASAP_MAX_POSTS_PER_PLATFORM_DAY=1 for the first pilot.

- `ASAP_PROJECT_ID` is an ignored compatibility label. Runtime scope remains hardcoded to `asap-team`; changing this environment value does not change authorization or project isolation.
- `SOCIAL_BRAND` is mandatory and must exactly match `ASAP_BRAND` (`asap_gta6` or `asap_katy`).
- `ASAP_ANALYTICS_INTERVAL_MS=3600000` is the prepared cadence for checkpoint discovery. Analytics remains disabled by default and requires a separate token and explicit enablement after grants are verified.

- Separate databases named asap_gta6 and asap_katy with dedicated users. Do not use the Astel database or grant access to its tables.
- Authorized Redis storage with AOF and a persistent volume. Use each brand's exact ASAP_STATE_NAMESPACE.
- New control tokens of at least 32 bytes, separate from analytics tokens.
- At least one real platform binding for each deployed brand: approved numeric account ID, username, and its scoped token. Never insert dummy credentials to pass preflight. Current startup intentionally rejects an all-disabled platform configuration.

Credentials go directly into approved secret storage. Do not put credentials in source, images, build arguments, reports or Drive. Do not copy Astel production grants.

## Acceptance

Check /health, unauthenticated rejection, authenticated status with live=false and paused=true, then Kevin draft/schedule/job/pause/resume access. Verify retained pause and queue state after restart. Only after exact-account grant checks and readback/dedupe canaries may an individual route enter the authorized pilot.

Engineering fixtures do not prove external publishing. Fresh marketing QA already passed 22/22 checks against privately supplied source images, including 10/10 exact JPEG hashes (see `qa/MARKETING_QA_FRESH.json`). Images were intentionally not committed. A deployed route still needs approved accessible assets and usage rights; LOCAL_ASSET_REFERENCE cannot be treated as a real image.

`/health` and `npm run preflight` prove only local configuration and storage connectivity. They do not prove a Meta account identity, token ownership, permission scope, API capability, or successful live collection. Those require exact-account provider readback after the separate grant stage.

See `docs/ANALYTICS_CHECKPOINT_RUNBOOK.md` and `config/analytics_checkpoint_evidence.example.json` for the disabled-by-default analytics checklist and evidence schema.

Railway references: https://docs.railway.com/config-as-code/reference and https://docs.railway.com/guides/dockerfiles


## Verified readiness — 2026-10-06

This is a read-only infrastructure snapshot and an execution checklist, not deployment authorization.

| Area | Verified state | Remaining evidence |
| --- | --- | --- |
| Engineering | Latest reviewed head above; CI tests and Docker build passed; analytics checkpoint v4 accepted | Re-run applicable checks only if code changes |
| Integration | PR #1 remains open and draft | Review and merge decision |
| Railway project | Dedicated ASAP project and four service records exist | Existing budget/headroom and account/resource approval |
| App services | `asap-gta6-engine` and `asap-katy-engine`: no source and no latest deployment | Approved source, private configuration and successful runtime |
| Storage services | `asap-postgres` and `asap-redis`: no source, deployment or volume mounts | Real isolated PostgreSQL and persistent Redis configuration |
| Railway environment | No staged changes in the dedicated production environment; no volumes | Re-read immediately before any approved mutation |
| Provider access | Working Meta route is documented in `docs/META_DEV_WORKING_ROUTE.md` | Exact ASAP account identity, scoped grants and private credentials |
| Canary / analytics | Implementation and fixtures are ready; runtime results are not established | Deployment, restart/pause/dedupe evidence, then separately authorized provider checks |

Railway's service record state `live` does not establish that an application or database is running. All four records had `source: null` and `latestDeployment: null` during this audit. An empty service scaffold must not be reported as a deployed engine.

### Next execution order

1. Owner/operator verifies available budget and resource limits in Railway Usage, and supplies approved ASAP-only account bindings and secrets directly in the approved private secret store. Historical cost estimates and zero usage metrics are not proof of budget headroom.
2. Once deployment and resource use are explicitly authorized, re-read the dedicated environment and reject any unexpected staged changes. Configure approved isolated PostgreSQL/Redis persistence and the two app sources; do not use old Astel production.
3. Deploy with publishing and analytics disabled. Startup still requires at least one real approved platform binding per brand; do not bypass preflight with dummy credentials.
4. Record health, unauthenticated rejection, authenticated paused status, and pause/queue persistence across restart. Record actual deployment and image identifiers as evidence.
5. Perform provider identity/readback and publishing canaries only within separate exact-account authorization. Enable analytics only after its separate grants and runtime checks pass.

The next blocker is verified resources and account access, followed by authorized deployment. Repeating completed task versions or marketing fixture checks does not satisfy these gates.
