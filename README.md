# ASAP Team Social Engine

Isolated ASAP GTA6/Katy publishing runtime, based on the approved Astel Engine + Hyper Crew + Lazy Distribution sources. Exact public source provenance is in docs/SOURCE_PROVENANCE.json.

The new runtime uses prepared, reviewed content without automatic LLM calls. It has scoped standing-owner authorization, exact content hashes, a persisted queue/pause gate, idempotency and fail-closed publication. Threads text, Facebook Page text and Instagram single-image API adapters are implemented and fixture-tested.

This is an implementation checkpoint, not a claim of live publication. Account grants, runtime cost fit, deployed storage recovery, real canaries and Kevin's live API access still require verification.

## Local checks

- npm ci --ignore-scripts --no-audit --no-fund
- npm test
- npm run preflight
- npm start (requires isolated configuration; new scheduler state defaults paused)

Start with docs/SECURE_ONBOARDING.md, docs/KEVIN_INTEGRATION_PLAN.md and docs/PUBLISHING_SCOPE.md. Never supply production Astel credentials or state to this runtime. Private operational IDs and access/billing audits are deliberately kept outside the public repository.
