# Isolated ASAP deployment

Deploy the reviewed launch branch into a separate ASAP environment/project after confirming the resource budget. Do not accept staged changes in an existing Astel production environment. Two brand instances use the same image but distinct credentials and state.

## Build and runtime

The Dockerfile pins Node 24.20.0 and explicitly installs npm 11.19.0. It runs the engineering suite during build, uses the unprivileged node user, and starts only server-asap.js. Railway runs preflight before deployment and checks /health. A failed start gets at most three retries.

Container build has not yet been exercised in the preparation workspace (Docker is unavailable). Railway build and runtime evidence remain required. The original DELIVERY_MANIFEST.json describes the recovered snapshot, not files added in subsequent deployment commits.

## Required private configuration

Use config/asap_gta6.env.example and config/asap_katy.env.example as schemas. Keep ASAP_LIVE_ENABLED=false and ASAP_ANALYTICS_ENABLED=false initially. Set ASAP_MAX_POSTS_PER_PLATFORM_DAY=1 for the first pilot.

- Separate databases named asap_gta6 and asap_katy with dedicated users. Do not use the Astel database or grant access to its tables.
- Authorized Redis storage with AOF and a persistent volume. Use each brand's exact ASAP_STATE_NAMESPACE.
- New control tokens of at least 32 bytes, separate from analytics tokens.
- At least one real platform binding for each deployed brand: approved numeric account ID, username, and its scoped token. Never insert dummy credentials to pass preflight. Current startup intentionally rejects an all-disabled platform configuration.

Credentials go directly into approved secret storage. Do not put credentials in source, images, build arguments, reports or Drive. Do not copy Astel production grants.

## Acceptance

Check /health, unauthenticated rejection, authenticated status with live=false and paused=true, then Kevin draft/schedule/job/pause/resume access. Verify retained pause and queue state after restart. Only after exact-account grant checks and readback/dedupe canaries may an individual route enter the authorized pilot.

Engineering fixtures do not prove external publishing. Marketing QA needs the omitted source images and correct local asset mappings; LOCAL_ASSET_REFERENCE cannot be treated as a real image.

Railway references: https://docs.railway.com/config-as-code/reference and https://docs.railway.com/guides/dockerfiles
