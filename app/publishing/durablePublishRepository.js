function createDurablePublishRepository({ hotRepository, durable } = {}) {
  if (!hotRepository) throw new Error("Hot publish repository is required");
  if (!durable) throw new Error("Durable repository is required");

  let lastDurableError = null;

  async function persist(fn) {
    if (!durable.isReady?.()) return false;
    try {
      await fn();
      lastDurableError = null;
      return true;
    } catch (error) {
      lastDurableError = error?.message || String(error);
      console.error("Durable publish persistence error", JSON.stringify({ error: lastDurableError }));
      return false;
    }
  }

  async function enqueue(job) {
    if (durable.isReady?.()) {
      await durable.recordPublishEnqueued(job);
    }
    try {
      const result = await hotRepository.enqueue(job);
      if (result?.duplicate && durable.isReady?.()) {
        await persist(() => durable.recordPublishState({
          jobId: job.id,
          status: "CANCELLED",
          errorCode: "HOT_QUEUE_DUPLICATE",
          finishedAt: new Date(),
          result,
        }));
      }
      return result;
    } catch (error) {
      await persist(() => durable.recordPublishState({
        jobId: job.id,
        status: "FAILED",
        errorCode: "HOT_QUEUE_ENQUEUE_FAILED",
        finishedAt: new Date(),
        result: { message: error?.message || String(error) },
      }));
      throw error;
    }
  }

  async function claim(id, claimToken, options = {}) {
    const changed = await hotRepository.claim(id, claimToken, options);
    if (changed) {
      await persist(() => durable.recordPublishState({
        jobId: id,
        status: "PROCESSING",
        startedAt: options.now || new Date(),
      }));
    }
    return changed;
  }

  async function finish(id, claimToken, status, options = {}) {
    const changed = await hotRepository.finish(id, claimToken, status, options);
    if (!changed) return false;
    const job = await hotRepository.get(id);
    const projected = await persist(async () => {
      await durable.recordPublishState({
        jobId: id,
        status,
        result: options.result || {},
        errorCode: options.errorCode || null,
        finishedAt: options.now || new Date(),
      });
      if (status === "PUBLISHED" && (options.result?.id || job?.result?.id)) {
        const platformPostId = options.result?.id || job.result.id;
        await durable.upsertPost({
          accountKey: job.accountKey,
          platformPostId,
          contentType: job.content?.type || "text",
          text: job.content?.text || null,
          permalink: options.result?.permalink || null,
          status: "PUBLISHED",
          publishedAt: options.now || new Date(),
          metadata: { publishJobId: id, ...(job.metadata || {}) },
        });
      }
    });
    await hotRepository.markDurableProjection?.(id, projected);
    return projected;
  }

  async function recoverExpired(now = new Date(), limit = 100) {
    const held = await hotRepository.recoverExpired(now, limit, { includeIds: true });
    if (!Array.isArray(held)) return held;
    for (const jobId of held) {
      const projected = await persist(() => durable.recordPublishState({
        jobId, status: 'AMBIGUOUS_HOLD', errorCode: 'WORKER_LEASE_EXPIRED', finishedAt: now,
      }));
      await hotRepository.markDurableProjection?.(jobId, projected);
    }
    return held.length;
  }

  async function cancel(id, now = new Date()) {
    const changed = await hotRepository.cancel(id, now);
    if (changed) {
      const projected = await persist(() => durable.recordPublishState({
        jobId: id,
        status: "CANCELLED",
        finishedAt: now,
      }));
      await hotRepository.markDurableProjection?.(id, projected);
    }
    return changed;
  }

  function health() {
    return {
      ...(hotRepository.health?.() || {}),
      durable: durable.health?.() || null,
      lastDurableError,
    };
  }

  async function reconcilePublished(id, result, now = new Date()) {
    const job = await hotRepository.get(id);
    if (!job) return false;
    const changed = await hotRepository.reconcilePublished(id, result, now);
    if (!changed) return false;
    const projected = await persist(async () => {
      await durable.recordPublishState({ jobId: id, status: 'PUBLISHED', result, errorCode: null, finishedAt: now });
      await durable.upsertPost({ accountKey: job.accountKey, platformPostId: result.id, contentType: job.content?.type || 'text', text: job.content?.text || null, status: 'PUBLISHED', permalink: result.permalink || null, publishedAt: result.readback?.publishedAt || now, metadata: { publishJobId: id, ...(job.metadata || {}), reconciled: true } });
    });
    await hotRepository.markDurableProjection?.(id, projected);
    return projected;
  }

  async function retryPendingProjections(limit = 5) {
    const ids = await hotRepository.pendingProjections?.(limit) || [];
    let confirmed = 0;
    for (const id of ids) {
      const job = await hotRepository.get(id);
      if (!job) continue;
      const projected = await persist(async () => {
        await durable.recordPublishState({ jobId: id, status: job.status, result: job.result || {}, errorCode: job.errorCode, finishedAt: job.updatedAt });
        if (job.status === 'PUBLISHED' && job.result?.id) await durable.upsertPost({ accountKey: job.accountKey, platformPostId: job.result.id, contentType: job.content?.type || 'text', text: job.content?.text || null, status: 'PUBLISHED', permalink: job.result.permalink || null, publishedAt: job.result.readback?.publishedAt || job.updatedAt, metadata: { publishJobId: id, ...(job.metadata || {}), durableProjectionRetried: true } });
      });
      await hotRepository.markDurableProjection?.(id, projected);
      if (projected) confirmed++;
    }
    return { attempted: ids.length, confirmed };
  }

  return {
    init: () => hotRepository.init(),
    quit: () => hotRepository.quit(),
    enqueue,
    due: (...args) => hotRepository.due(...args),
    claim,
    finish,
    recoverExpired,
    cancel,
    get: (...args) => hotRepository.get(...args),
    isReady: () => hotRepository.isReady(),
    health,
    reconcilePublished,
    retryPendingProjections,
  };
}

module.exports = { createDurablePublishRepository };
