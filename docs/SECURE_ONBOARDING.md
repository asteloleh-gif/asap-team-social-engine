# Secure per-brand onboarding

The environment examples are schemas, not configured accounts. Never put a token, password, app secret, OAuth code or private callback credential in this repository, a report or a chat message.

## Owner steps

1. Complete the required login, 2FA/security challenges and explicit bounded OAuth consent for the exact brand identities.
2. For Threads, confirm the Threads-specific app ID (not the parent Meta app ID), a pre-registered ASAP callback URI, and tester/owned-account eligibility. Grant threads_basic, threads_content_publish and threads_manage_insights for the selected format/measurements.
3. For Facebook Login, confirm the exact Page and linked Professional Instagram account, then only the required publishing/read scopes. Additional insights, Business Manager or PPA requirements must be established by the actual flow rather than guessed.
4. Install new persistent credentials only through the explicitly approved secure credential flow. Tokens go directly to the isolated runtime's secret storage. Do not copy existing Astel tokens by default.
5. Confirm the existing paid resource limit before creating any metered runtime/database/volume.

## Safe deterministic setup after consent

- Fill one of config/asap_gta6.env.example or config/asap_katy.env.example in private secret storage; retain false live gates initially.
- DATABASE_URL must point to a dedicated database named for that exact brand. REDIS_URL must point to separately authorized durable storage. The code additionally namespaces all ASAP state and never uses the historical Astel queue/token namespace.
- Use a secret of at least 32 bytes for ASAP_CONTROL_TOKEN and a separate analytics credential. This repository does not generate/install persistent credentials automatically.
- Provision Redis with persistence (AOF and persistent volume); prove recovery in the actual selected runtime.
- Do not reuse a production environment's pending deployment patch.
- Run npm run preflight. It emits missing variable names and safe readiness codes only.
- Start with npm start. The scheduler begins paused on first state initialization.
- Verify exact API identity, owned media access if applicable, required scopes and grant expiry. Browser UI login is not this proof.
- Enable only verified platforms. A blocked platform must not prevent independent work on another verified route.

## OAuth URL preparation limits

The app ID and registered redirect URI must be read from the actual selected app configuration. Do not synthesize an authorization URL using a parent-app ID as a Threads app ID, invent a callback, or reuse the production callback. Once confirmed, prepare the official flow with state/CSRF protection and minimal scopes, then owner consent. No authorization codes or tokens belong in public logs.

app/asap/oauthPlan.js provides a pure, tested authorization-URL builder. It requires a confirmed Threads-specific app ID, exact redirect from the verified registered URI list and a strong CSRF state value; it does not initiate login, exchange codes or install credentials. Reference: https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/
