# ASAP Instagram Login compatibility (Task008 v2)

Implementation only. GTA is the sole launch target; Katy's code and placeholder
schema remain dormant. No deployment, grant, schedule or publication is authorized
by this patch. Single image publishing only; no Reels, carousel, replies or new
insights. Legacy Astel adapters and Threads behavior are unchanged.

## Validated configuration

Set `ASAP_BRAND=asap_gta6`, `SOCIAL_BRAND=asap_gta6`,
`ASAP_STATE_NAMESPACE=asap:asap_gta6:v1`, with a dedicated `asap_gta6` PostgreSQL
database and isolated Redis state. Do not reuse Astel or Katy credentials/state.
The existing examples retain all platform flags, `ASAP_LIVE_ENABLED` and
`ASAP_ANALYTICS_ENABLED` false and the pilot cap one post/platform/day. A later
approved runtime must still start paused and pass separate grants/resource gates.

| Configuration | Instagram Login | Facebook Login |
| --- | --- | --- |
| `INSTAGRAM_AUTH_MODE` (required if enabled) | `instagram_login` | `facebook_login` |
| Token | Only `INSTAGRAM_ACCESS_TOKEN` | `INSTAGRAM_FACEBOOK_PAGE_ACCESS_TOKEN`, then existing `FACEBOOK_ACCESS_TOKEN` fallback |
| Host | `https://graph.instagram.com` | `https://graph.facebook.com` |
| Version | Pinned `v26.0`; incompatible `META_API_VERSION` rejected | Existing validated `META_API_VERSION`, default `v26.0` |
| `INSTAGRAM_USER_ID` | Professional publishing account `/me.user_id` | Facebook-linked professional account ID |
| `INSTAGRAM_USERNAME` | Expected `asapgta6` | Expected `asapgta6` |
| Identity proof | Token-owned `/me?fields=user_id,username` | Existing configured-account `id,username` probe with Page token |

`INSTAGRAM_USER_ID` is never an app ID or the app-scoped `/me.id`. Optional
`INSTAGRAM_BRAND` must equal `ASAP_BRAND`. Katy's matching schema uses
`asap_katy`, `asapkaty`, its own database/namespace, and remains disabled.
There is no Instagram Login fallback to Facebook, another account or another
brand. Scope freezes mode, owner, username, brand, token, host and version;
server-asap passes this validated version instead of rereading a mutable env.
Provider construction snapshots the binding and rejects incompatible overrides.
Preflight is local configuration validation, not proof of actual live grants.

## API contract and conservative policies

The owner-supplied Task008 v2 evidence was directly fetched from official Meta
documentation on 2026-10-06. This execution's documentation fetch tool could not
independently open those pages; implementation uses that supplied contract and
synthetic tests, and does not claim new live API/document retrieval evidence.

- `/me` requires `user_id` and username. A different app-scoped `id` is normal;
  it is retained separately and never used for ownership. A single-entry `data`
  envelope follows the supplied Get Started example. Accepting a flat object is
  our defensive compatibility policy. Empty/multiple/malformed envelopes and
  contradictory flat/wrapped candidates fail before any mutation.
- Quota requests `config,quota_usage`; requires nonnegative integer usage and
  positive integer `config.quota_total` and `config.quota_duration`. Missing,
  malformed or exhausted quotas block container creation. No numerical default
  or `rate_limit_settings` alias is inferred from conflicting docs.
- All Instagram Login identity/quota/container/status/publish/readback operations
  use the bound host/version and bearer headers. Container and published-media
  IDs are distinct. IN_PROGRESS is bounded; FINISHED alone permits publication.
  ERROR/EXPIRED/unknown states block it. PUBLISHED enters ambiguous hold, never
  another publish. Pause is rechecked before container creation and final publish.
- Readback requests only `id,media_type,owner,permalink,username,timestamp` for
  Instagram Login; caption and media_product_type are not requested or required.
  `owner.id == /me.user_id` is a fail-closed engineering inference from the
  documented identifier meanings, **not an explicit Meta equality guarantee**.
  Missing/mismatched owner or media ID/type remains unverified. An app-scoped ID
  is never a substitute. Facebook Login retains existing caption readback.
- A confirmed publication ID stays terminal even when readback fails. Sanitized
  successful-publication warnings are retained with the durable publish result;
  no warning/unknown final response permits automatic republication. Internal
  original caption/hash provenance remains in the draft/job/post records.
- Instagram Login readback cannot prove an arbitrary caption's equality. Existing
  exact-content reconciliation consequently keeps an ambiguous job held. Do not
  weaken it using local provenance as proof of remote content. Manual review or
  future separately reviewed reconciliation evidence is needed for that case.

Official sources supplied by the verified owner:

1. [Get Started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started), [Me](https://developers.facebook.com/documentation/instagram-platform/reference/me)
2. [Migration guide](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide)
3. [Content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing), [Media creation](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media)
4. [Content publishing limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)
5. [Container](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container)
6. [Instagram Media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media)
7. [Media Publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish)

## Verification

`node --test tests/asapInstagramLogin.test.js tests/asapMetaProvider.test.js tests/asapFinalMutationFence.test.js tests/asapScope.test.js`
uses synthetic tokens/fetch responses and dependency doubles around the actual
server-asap composition root; no real Meta, Redis or database access. Full
`npm test` includes existing pause/dedupe/claim/reconciliation and analytics
regressions. Existing CI supplies disposable PostgreSQL 16.4 and the Docker build,
using Node 24.20.0/npm 11.19.0. Checkout and Docker image tag select the literal PR
head SHA, including stacked PRs targeting the recovered-engine branch. Green CI
requires parent review; live readiness remains separate.
