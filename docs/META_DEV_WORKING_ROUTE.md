# Recovered Meta route and ASAP adaptation

## Evidence and boundary

The source code is copied from the public commit recorded in SOURCE_PROVENANCE.json. Historical operating references are linked, not republished with account/service identifiers. Current private access and deployment verification remains outside this public repository.

- [Instagram working route](https://github.com/asteloleh-gif/threads-bot/blob/81338658909d8dc2ada8bea7b999c8348d504c6f/docs/instagram-astel-us-live-runbook.md)
- [Three-platform onboarding](https://github.com/asteloleh-gif/threads-bot/blob/81338658909d8dc2ada8bea7b999c8348d504c6f/docs/meta-3-platform-account-onboarding-runbook.md)
- [Threads tester route](https://github.com/asteloleh-gif/threads-bot/blob/81338658909d8dc2ada8bea7b999c8348d504c6f/docs/CODEX_CONNECT_ASTEL_US_THREADS.md)

## What was recovered

The historical working Instagram implementation used Facebook Login, an exact Professional Instagram identity linked to the intended Facebook Page, and a Page access-token fallback. Official polling found comments and official reply endpoints published replies; self/deduplication guards stopped loops. Collaborator-owned media was a misleading test fixture. Incorrect Graph IDs, incomplete user grants, an expired primary token, and a mismatched webhook secret were separate failure causes. Dashboard webhook tests did not establish eligibility for real events.

Threads supports the owner/tester path with an official user token. Do not equate app-review status with the scopes actually granted to an owned account. A current profile read and exact identity match is required for each ASAP account.

Facebook requires a token for the exact Page. A generic User access token is not the final Page publisher credential. Page discovery returning an empty list can result from declined permissions rather than a code defect.

## Missing capability addressed in this copy

Upstream Instagram/Facebook providers supported replies, but not new posts. ASAP's separate provider implements Facebook text feed publication and Instagram single-image container/status/publish. Threads text retains the existing two-step publisher. Every live attempt first validates account identity, reserves the bounded daily budget, then performs the mutation once. Uncertain visible mutations go to hold. A known post ID with failed readback is retained and never republished automatically.

The new adapters are tested against injected API fixtures. Live identity, consent scopes, media accessibility and publication canaries are separate runtime acceptance gates; unit tests do not establish them.

## Current official references

- [Threads publishing and owned/tester access](https://developers.facebook.com/documentation/threads/create-posts)
- [Threads post readback fields](https://developers.facebook.com/docs/threads/retrieve-and-discover-posts/retrieve-posts/)
- [Instagram content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Facebook Pages API](https://developers.facebook.com/docs/pages-api/)

Use only the scopes required for the selected formats. Do not add webhooks, broad business access or new app review as a speculative prerequisite. Owner login, security challenges, new persistent grants and secure credential installation are completed explicitly outside source control.
