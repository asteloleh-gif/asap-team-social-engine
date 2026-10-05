# Source reuse map

Exact public source commits and links: SOURCE_PROVENANCE.json.

- threads-bot: full source snapshot; ASAP composition reuses publishEngine, Redis queue/claims/ambiguous holds, PostgreSQL migrations/repositories, Threads publisher/insights and analytics export. New code adds explicit brand isolation, reviewed prepared-content intake, standing authorization and missing FB/IG post publication.
- astel-hyper-crew: selected analytics connector and registry source retained under vendor/hyper-crew. ASAP wrapper forbids mixed project/account metrics and binding mutations. Existing production binding untouched.
- asteloleh-gif-astel-lazy-distribution: ContentEnvelope/DistributionDraft types and packaging source retained under vendor/lazy-distribution. app/asap/distributionAdapter.js adapts to authorized Meta destinations without AI/network side effects in preview.

The historical operational documents containing service/account identifiers are retained privately and linked from public stubs. No new source license is asserted where the upstream tree has none. Credentials, local state and package caches are excluded by .gitignore.
