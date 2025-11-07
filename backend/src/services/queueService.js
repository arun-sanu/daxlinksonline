import { initQueue } from '../jobs/queue.js';

let initialized = false;
let mode = 'memory';
let queue = null;

function ensureQueue() {
  if (initialized) return { mode, queue };
  const res = initQueue({ queueName: 'pendax-forwarder' });
  mode = res.mode;
  queue = res.queue || null;
  initialized = true;
  return { mode, queue };
}

export async function getQueueStats() {
  const { mode, queue } = ensureQueue();
  if (mode !== 'redis' || !queue) {
    return { mode, counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0 } };
  }
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
  return { mode, counts };
}

export async function listJobs({ state = 'failed', start = 0, end = 20 } = {}) {
  const { mode, queue } = ensureQueue();
  if (mode !== 'redis' || !queue) return { mode, items: [] };
  const jobs = await queue.getJobs([state], start, end);
  const items = jobs.map((j) => ({
    id: j.id,
    name: j.name,
    state,
    attemptsMade: j.attemptsMade,
    failedReason: j.failedReason || null,
    timestamp: j.timestamp,
    processedOn: j.processedOn || null,
    finishedOn: j.finishedOn || null,
    data: j.data
  }));
  return { mode, items };
}

export async function retryJob(id) {
  const { mode, queue } = ensureQueue();
  if (mode !== 'redis' || !queue) return { mode, retried: false };
  const job = await queue.getJob(id);
  if (!job) return { mode, retried: false };
  await job.retry();
  return { mode, retried: true };
}

export async function removeJob(id) {
  const { mode, queue } = ensureQueue();
  if (mode !== 'redis' || !queue) return { mode, removed: false };
  const job = await queue.getJob(id);
  if (!job) return { mode, removed: false };
  await job.remove();
  return { mode, removed: true };
}

export async function clean({ state = 'completed', graceMs = 3600000, limit = 1000 } = {}) {
  const { mode, queue } = ensureQueue();
  if (mode !== 'redis' || !queue) return { mode, cleaned: 0 };
  const cleaned = await queue.clean(graceMs, state, limit);
  return { mode, cleaned: cleaned?.length || 0 };
}

