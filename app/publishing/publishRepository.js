const crypto = require("crypto");
const { createClient } = require("redis");
const { PUBLISH_STATUS } = require("./publishState");

const ENQUEUE_LUA = `
local idemKey = KEYS[3]
if idemKey ~= '' then
  local existing = redis.call('GET', idemKey)
  if existing then
    if tonumber(ARGV[11]) == 0 then redis.call('PERSIST', idemKey) end
    return 'DUPLICATE:' .. existing
  end
  if tonumber(ARGV[11]) == 0 then
    redis.call('SET', idemKey, ARGV[1])
  else
    redis.call('SET', idemKey, ARGV[1], 'EX', ARGV[11])
  end
end
redis.call('HSET', KEYS[1],
  'id', ARGV[1],
  'account_key', ARGV[2],
  'status', ARGV[3],
  'content_json', ARGV[4],
  'scheduled_at', ARGV[5],
  'scheduled_ms', ARGV[6],
  'dedupe_key', ARGV[7],
  'metadata_json', ARGV[8],
  'created_at', ARGV[9],
  'updated_at', ARGV[10])
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[1])
return 'CREATED:' .. ARGV[1]
`;

const CLAIM_LUA = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'PENDING' then return 0 end
redis.call('HSET', KEYS[1],
  'status', 'PROCESSING',
  'claim_token', ARGV[2],
  'updated_at', ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
return 1
`;

const FINISH_LUA = `
local status = redis.call('HGET', KEYS[1], 'status')
local token = redis.call('HGET', KEYS[1], 'claim_token')
if status ~= 'PROCESSING' or token ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1],
  'status', ARGV[3],
  'result_json', ARGV[4],
  'error_code', ARGV[5],
  'updated_at', ARGV[6],
  'durable_status', 'pending',
  'claim_token', '')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[1])
return 1
`;

const RECOVER_LUA = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'PROCESSING' then
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 0
end
redis.call('HSET', KEYS[1],
  'status', 'AMBIGUOUS_HOLD',
  'error_code', 'WORKER_LEASE_EXPIRED',
  'updated_at', ARGV[2],
  'durable_status', 'pending',
  'claim_token', '')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[1])
return 1
`;

const CANCEL_LUA = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'PENDING' then return 0 end
redis.call('HSET', KEYS[1], 'status', 'CANCELLED', 'updated_at', ARGV[2], 'durable_status', 'pending')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[1])
return 1
`;

const RECONCILE_LUA = `
local status = redis.call('HGET', KEYS[1], 'status')
if status ~= 'AMBIGUOUS_HOLD' and status ~= 'PUBLISHED' then return 0 end
local existing = redis.call('HGET', KEYS[1], 'result_json')
if existing then
  local ok, parsed = pcall(cjson.decode, existing)
  if ok and parsed.id and tostring(parsed.id) ~= ARGV[1] then return 0 end
end
redis.call('HSET', KEYS[1], 'status', 'PUBLISHED', 'result_json', ARGV[2], 'error_code', '', 'updated_at', ARGV[3], 'claim_token', '', 'durable_status', 'pending')
redis.call('SADD', KEYS[2], ARGV[4])
return 1
`;

function createPublishRepository({
  redisUrl = process.env.REDIS_URL,
  namespace = "astel:publish:v1",
  dedupeTtlSeconds = 30 * 24 * 60 * 60,
} = {}) {
  let client = null;
  let ready = false;
  let lastError = null;
  let projectionScanCursor = 0;
  let projectionScanBuffer = [];

  const dueKey = `${namespace}:due`;
  const processingKey = `${namespace}:processing`;
  const projectionKey = `${namespace}:durable-projection-pending`;
  const jobKey = id => `${namespace}:job:${String(id)}`;
  const idemKey = value => value
    ? `${namespace}:idem:${crypto.createHash("sha256").update(String(value)).digest("hex")}`
    : "";

  async function init() {
    if (!redisUrl) throw new Error("REDIS_URL missing for publish repository");
    client = createClient({ url: redisUrl });
    client.on("error", error => { ready = false; lastError = error?.message || String(error); });
    client.on("ready", () => { ready = true; lastError = null; });
    client.on("end", () => { ready = false; });
    await client.connect();
    await client.ping();
    ready = true;
    console.log("Publish repository connected", JSON.stringify({ namespace }));
    return true;
  }

  function assertReady() {
    if (!client || !ready) throw new Error(`Publish repository unavailable${lastError ? `: ${lastError}` : ""}`);
  }

  async function enqueue(job) {
    assertReady();
    const result = await client.eval(ENQUEUE_LUA, {
      keys: [jobKey(job.id), dueKey, idemKey(job.dedupeKey)],
      arguments: [
        String(job.id),
        String(job.accountKey),
        PUBLISH_STATUS.PENDING,
        JSON.stringify(job.content),
        String(job.scheduledAt),
        String(new Date(job.scheduledAt).getTime()),
        job.dedupeKey || "",
        JSON.stringify(job.metadata || {}),
        String(job.createdAt),
        String(job.updatedAt),
        String(dedupeTtlSeconds),
      ],
    });
    const [kind, id] = String(result || "").split(":", 2);
    return { created: kind === "CREATED", duplicate: kind === "DUPLICATE", id: id || job.id };
  }

  async function due(now = new Date(), limit = 10) {
    assertReady();
    const max = new Date(now).getTime();
    return client.zRangeByScore(dueKey, 0, max, { LIMIT: { offset: 0, count: Math.max(1, Number(limit) || 10) } });
  }

  async function claim(id, claimToken, { now = new Date(), leaseMs = 60_000 } = {}) {
    assertReady();
    const nowDate = new Date(now);
    const result = await client.eval(CLAIM_LUA, {
      keys: [jobKey(id), dueKey, processingKey],
      arguments: [String(id), String(claimToken), nowDate.toISOString(), String(nowDate.getTime() + Math.max(1_000, Number(leaseMs) || 60_000))],
    });
    return Number(result) === 1;
  }

  async function finish(id, claimToken, status, { result = null, errorCode = null, now = new Date() } = {}) {
    assertReady();
    if (![PUBLISH_STATUS.SIMULATED, PUBLISH_STATUS.PUBLISHED, PUBLISH_STATUS.FAILED, PUBLISH_STATUS.AMBIGUOUS_HOLD].includes(status)) {
      throw new Error(`Invalid terminal publish status: ${status}`);
    }
    const updatedAt = new Date(now).toISOString();
    const changed = await client.eval(FINISH_LUA, {
      keys: [jobKey(id), processingKey, projectionKey],
      arguments: [String(id), String(claimToken), status, JSON.stringify(result || {}), errorCode || "", updatedAt],
    });
    return Number(changed) === 1;
  }

  async function recoverExpired(now = new Date(), limit = 100, { includeIds = false } = {}) {
    assertReady();
    const nowDate = new Date(now);
    const ids = await client.zRangeByScore(processingKey, 0, nowDate.getTime(), { LIMIT: { offset: 0, count: Math.max(1, Number(limit) || 100) } });
    let held = 0;
    const heldIds = [];
    for (const id of ids) {
      const changed = await client.eval(RECOVER_LUA, {
        keys: [jobKey(id), processingKey, projectionKey],
        arguments: [String(id), nowDate.toISOString()],
      });
      if (Number(changed) === 1) { held += 1; heldIds.push(id); }
    }
    return includeIds ? heldIds : held;
  }

  async function cancel(id, now = new Date()) {
    assertReady();
    const changed = await client.eval(CANCEL_LUA, {
      keys: [jobKey(id), dueKey, projectionKey],
      arguments: [String(id), new Date(now).toISOString()],
    });
    return Number(changed) === 1;
  }

  async function get(id) {
    assertReady();
    const row = await client.hGetAll(jobKey(id));
    if (!row?.id) return null;
    let content = {};
    let metadata = {};
    let result = {};
    try { content = JSON.parse(row.content_json || "{}"); } catch (_) {}
    try { metadata = JSON.parse(row.metadata_json || "{}"); } catch (_) {}
    try { result = JSON.parse(row.result_json || "{}"); } catch (_) {}
    return {
      id: row.id,
      accountKey: row.account_key,
      status: row.status,
      content,
      scheduledAt: row.scheduled_at,
      dedupeKey: row.dedupe_key || null,
      metadata,
      result,
      errorCode: row.error_code || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      durableStatus: row.durable_status || 'unknown',
    };
  }

  async function quit() {
    if (client?.isOpen) await client.quit();
    ready = false;
  }

  async function reconcilePublished(id, result, now = new Date()) {
    assertReady();
    if (!result?.id || result?.readback?.verified !== true) throw new Error('VERIFIED_READBACK_REQUIRED');
    return Number(await client.eval(RECONCILE_LUA, { keys: [jobKey(id), projectionKey], arguments: [String(result.id), JSON.stringify(result), new Date(now).toISOString(), String(id)] })) === 1;
  }

  async function markDurableProjection(id, confirmed) {
    assertReady();
    await client.multi().hSet(jobKey(id), 'durable_status', confirmed ? 'confirmed' : 'pending')[confirmed ? 'sRem' : 'sAdd'](projectionKey, String(id)).exec();
  }

  async function pendingProjections(limit = 10) {
    assertReady();
    const count = Math.max(1, Number(limit) || 10);
    if (!projectionScanBuffer.length) {
      const result = await client.sScan(projectionKey, projectionScanCursor, { COUNT: count });
      // Empty pages can have a nonzero cursor, and COUNT is only a hint. Keep
      // both the cursor and overflow members so none are stranded by a tick.
      projectionScanCursor = result.cursor;
      projectionScanBuffer = result.members;
    }
    return projectionScanBuffer.splice(0, count);
  }

  return {
    init,
    quit,
    enqueue,
    due,
    claim,
    finish,
    recoverExpired,
    cancel,
    get,
    reconcilePublished,
    markDurableProjection,
    pendingProjections,
    isReady: () => ready,
    health: () => ({ connected: ready, namespace, lastError, dedupeTtlSeconds }),
  };
}

module.exports = { createPublishRepository };
