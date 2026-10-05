const { createClient } = require('redis');
const RESERVE = `local paused=redis.call('GET',KEYS[1]); if paused ~= 'false' then return 0 end; local n=tonumber(redis.call('GET',KEYS[2]) or '0'); if n>=tonumber(ARGV[1]) then return 0 end; redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],172800); return 1`;
function createAsapState({ redisUrl, namespace, maxPostsPerDay, clientFactory = createClient }) {
  const client = clientFactory({ url: redisUrl });
  let ready = false;
  client.on?.('error', () => { ready = false; });
  client.on?.('ready', () => { ready = true; });
  const pauseKey = `${namespace}:control:paused`;
  return {
    async init() { await client.connect(); await client.ping(); await client.set(pauseKey, 'true', { NX: true }); ready = true; },
    async isPaused() { if (!ready) return true; return (await client.get(pauseKey)) !== 'false'; },
    async setPaused(value) { if (!ready) throw new Error('ASAP_STATE_UNAVAILABLE'); await client.set(pauseKey, String(Boolean(value))); },
    async reserve(account) {
      if (!ready) return false;
      const date = new Date().toISOString().slice(0,10);
      return Number(await client.eval(RESERVE, { keys: [pauseKey, `${namespace}:limit:${account.platform}:${date}`], arguments: [String(maxPostsPerDay)] })) === 1;
    },
    async close() { ready = false; if (client.isOpen) await client.quit(); }
  };
}
module.exports = { createAsapState };
