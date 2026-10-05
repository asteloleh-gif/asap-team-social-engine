// Separate composition root. Never imports server.js or starts Astel reply bots.
const express = require('express');
const { loadScope, hash, assertAccount } = require('./app/asap/scope');
const { createMetaPostProvider } = require('./app/asap/metaPostProvider');
const { createAsapControl } = require('./app/asap/control');
const { createAsapState } = require('./app/asap/state');
const { createProviderRegistry } = require('./app/providers/providerRegistry');
const { createPostgresStore } = require('./app/db/postgresStore');
const { createDurableRepository } = require('./app/db/durableRepository');
const { createPublishRepository } = require('./app/publishing/publishRepository');
const { createDurablePublishRepository } = require('./app/publishing/durablePublishRepository');
const { createPublishEngine } = require('./app/publishing/publishEngine');
const { createContentRepository } = require('./app/content/contentRepository');
const { createContentControlStore } = require('./app/content/contentControlStore');
const { createInternalAnalyticsRouter } = require('./app/analytics/internalAnalyticsRouter');
const { createAnalyticsRepository } = require('./app/analytics/analyticsRepository');
const { createAnalyticsEngine } = require('./app/analytics/analyticsEngine');

async function start(env = process.env, testDependencies = {}) {
  const scope = loadScope(env);
  if (Buffer.byteLength(env.ASAP_CONTROL_TOKEN || '') < 32) throw new Error('ASAP_CONTROL_TOKEN_REQUIRED');
  if (env.ASAP_ANALYTICS_TOKEN && Buffer.byteLength(env.ASAP_ANALYTICS_TOKEN) < 32) throw new Error('ASAP_ANALYTICS_TOKEN_TOO_SHORT');
  if (!scope.accounts.length) throw new Error('ASAP_PLATFORM_BINDING_REQUIRED');
  const postgres = createPostgresStore({ connectionString: env.DATABASE_URL, required: true });
  await postgres.init();
  const durable = createDurableRepository({ store: postgres });
  await durable.syncAccounts(scope.accounts);
  const state = createAsapState({ redisUrl: env.REDIS_URL, namespace: scope.namespace, maxPostsPerDay: scope.maxPostsPerDay });
  await state.init();
  const providerFactory = testDependencies.providerFactory || createMetaPostProvider;
  async function publicationFence(account, context) {
    assertAccount(scope, account.key);
    const grant = context.metadata?.grant;
    if (!scope.live || !grant || grant.authorizationSource !== 'standing-owner-instruction' || grant.accountKey !== account.key || grant.platformUserId !== account.userId || grant.contentHash !== hash(context.content)) return false;
    // Recheck required durable storage immediately before the external mutation.
    await postgres.query('SELECT 1');
    return !(await state.isPaused());
  }
  const providers = createProviderRegistry(scope.accounts.map(account => providerFactory({ account, apiVersion: env.META_API_VERSION || 'v26.0', beforePublish: async (account, context) => {
    return (await publicationFence(account, context)) && state.reserve(account);
  }, beforeFinalMutation: publicationFence })));
  const hot = createPublishRepository({ redisUrl: env.REDIS_URL, namespace: `${scope.namespace}:publish`, dedupeTtlSeconds: 0 });
  await hot.init();
  const repository = createDurablePublishRepository({ hotRepository: hot, durable });
  const guardedRepository = { ...repository, due: async (...args) => await state.isPaused() ? [] : repository.due(...args) };
  const publishEngine = createPublishEngine({ providerRegistry: providers, repository: guardedRepository, enabled: true, dryRun: !scope.live, batchSize: 1, pollIntervalMs: 5000, leaseMs: 120000 });
  const analyticsEngine = createAnalyticsEngine({ providerRegistry: providers, repository: createAnalyticsRepository({ store: postgres, durable }), enabled: env.ASAP_ANALYTICS_ENABLED === 'true', intervalMs: Number(env.ASAP_ANALYTICS_INTERVAL_MS || 60 * 60 * 1000) });
  const operationStore = createContentControlStore({ redisUrl: env.REDIS_URL, namespace: `${scope.namespace}:control`, ttlSeconds: 30 * 86400 });
  await operationStore.init();
  const control = createAsapControl({ scope, token: env.ASAP_CONTROL_TOKEN, contentRepository: createContentRepository({ store: postgres }), publishEngine, operationStore, state, providers, publishRepository: repository });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.get('/health', (_req, res) => res.json({ ok: postgres.isReady() && hot.isReady(), service: 'asap-social-engine', brandId: scope.brand }));
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control','no-store'); if (!control.authenticate(req.get('authorization'))) return res.status(401).json({ error: 'UNAUTHORIZED' }); next(); });
  const handle = fn => async (req, res) => { try { const result = await fn(req); if (result == null) return res.status(404).json({ error: 'NOT_FOUND' }); res.json(result); } catch (e) { res.status(400).json({ error: /^[A-Z_]+$/.test(e.message) ? e.message : 'OPERATION_FAILED' }); } };
  router.get('/status', handle(() => control.status()));
  router.get('/drafts/:id', handle(req => control.getDraft(req.params.id)));
  router.get('/jobs/:id', handle(req => control.getJob(req.params.id)));
  router.post('/distribution/preview', handle(req => control.preview(req.body)));
  router.post('/drafts', handle(req => control.run('draft', req.get('idempotency-key'), req.body)));
  router.post('/schedule', handle(req => control.run('schedule', req.get('idempotency-key'), req.body)));
  router.post('/reconcile', handle(req => control.run('reconcile', req.get('idempotency-key'), req.body)));
  router.post('/pause', handle(req => control.run('pause', req.get('idempotency-key'), {})));
  router.post('/resume', handle(req => control.run('resume', req.get('idempotency-key'), {})));
  app.use('/internal/asap', router);
  if (env.ASAP_ANALYTICS_TOKEN) app.use('/internal/analytics', createInternalAnalyticsRouter({ store: postgres, token: env.ASAP_ANALYTICS_TOKEN, projectId: scope.projectId, brand: scope.brand }));
  await publishEngine.start();
  await analyticsEngine.start();
  const server = app.listen(Number(env.PORT || 3000), env.HOST === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0');
  const close = async () => { await publishEngine.stop(); await analyticsEngine.stop(); await new Promise(r => server.close(r)); await operationStore.close(); await repository.quit(); await state.close(); await postgres.close(); };
  if (!testDependencies.noSignals) {
    process.once('SIGTERM', () => close().then(() => process.exit(0)));
    process.once('SIGINT', () => close().then(() => process.exit(0)));
  }
  console.log(JSON.stringify({ service: 'asap-social-engine', brand: scope.brand, live: scope.live, paused: await state.isPaused() }));
  return { app, server, scope, control, publishEngine, close };
}
if (require.main === module) start().catch(e => { console.error(/^[A-Z_]+$/.test(e.message) ? e.message : 'ASAP_STARTUP_FAILED'); process.exit(1); });
module.exports = { start };
