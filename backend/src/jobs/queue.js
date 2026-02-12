import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

let queue = null;
let queueEvents = null;
let worker = null;
let forwarderProcessor = null;
let executeOrdersProcessor = null;
let redisConnection = null;
let inMemoryForwardPending = 0;
let inMemoryExecutePending = 0;
export let executeOrdersQueue = null;
export let executeOrdersWorker = null;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redisConnection) {
    redisConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    });
  }
  return redisConnection;
}

export function initQueue({ queueName = 'pendax-forwarder', processor } = {}) {
  if (typeof processor === 'function') {
    forwarderProcessor = processor;
  }
  const redis = getRedis();
  if (redis) {
    if (!queue) {
      queue = new Queue(queueName, { connection: redis });
    }
    if (!queueEvents) {
      queueEvents = new QueueEvents(queueName, { connection: redis });
    }
    if (!worker && forwarderProcessor) {
      worker = new Worker(queueName, forwarderProcessor, { connection: redis, concurrency: 5 });
    }
    return { mode: 'redis', queue, worker, queueEvents };
  }
  return { mode: 'memory' };
}

export async function enqueue(name, data, opts) {
  if (queue) {
    try {
      return await queue.add(name, data, opts);
    } catch (error) {
      console.warn('[queue] redis enqueue failed, falling back to memory', error?.message || error);
    }
  }
  inMemoryForwardPending += 1;
  if (forwarderProcessor) {
    setTimeout(async () => {
      try {
        await forwarderProcessor({ data, name, opts });
      } catch (error) {
        console.warn('[queue] in-memory forwarder failed', error?.message || error);
      } finally {
        inMemoryForwardPending = Math.max(0, inMemoryForwardPending - 1);
      }
    }, 0);
  } else {
    inMemoryForwardPending = Math.max(0, inMemoryForwardPending - 1);
  }
  return { id: `mem_${Date.now()}` };
}

export function initExecuteOrdersQueue({ processor } = {}) {
  if (typeof processor === 'function') {
    executeOrdersProcessor = processor;
  }
  const redis = getRedis();
  if (redis) {
    if (!executeOrdersQueue) {
      executeOrdersQueue = new Queue('execute_orders', { connection: redis });
    }
    if (!executeOrdersWorker && executeOrdersProcessor) {
      executeOrdersWorker = new Worker('execute_orders', executeOrdersProcessor, { connection: redis, concurrency: 3 });
    }
    return { mode: 'redis', queue: executeOrdersQueue, worker: executeOrdersWorker };
  }

  executeOrdersQueue = {
    async add(name, data) {
      inMemoryExecutePending += 1;
      if (executeOrdersProcessor) {
        setTimeout(async () => {
          try {
            await executeOrdersProcessor({ name, data });
          } catch (error) {
            console.warn('[queue] in-memory execute worker failed', error?.message || error);
          } finally {
            inMemoryExecutePending = Math.max(0, inMemoryExecutePending - 1);
          }
        }, 0);
      } else {
        inMemoryExecutePending = Math.max(0, inMemoryExecutePending - 1);
      }
      return { id: `mem_${Date.now()}` };
    }
  };
  executeOrdersWorker = executeOrdersProcessor || null;
  return { mode: 'memory', queue: executeOrdersQueue, worker: executeOrdersWorker };
}

async function getRedisPendingJobs(targetQueue) {
  if (!targetQueue || typeof targetQueue.getJobCounts !== 'function') return 0;
  try {
    const counts = await targetQueue.getJobCounts('waiting', 'delayed', 'active');
    return Number(counts.waiting || 0) + Number(counts.delayed || 0) + Number(counts.active || 0);
  } catch {
    return 0;
  }
}

export async function getQueueDebugSnapshot() {
  const forwardMode = queue ? 'redis' : 'memory';
  const executeMode = executeOrdersQueue && typeof executeOrdersQueue.getJobCounts === 'function' ? 'redis' : 'memory';
  const forwardPending = queue ? await getRedisPendingJobs(queue) : inMemoryForwardPending;
  const executePending =
    executeOrdersQueue && typeof executeOrdersQueue.getJobCounts === 'function'
      ? await getRedisPendingJobs(executeOrdersQueue)
      : inMemoryExecutePending;

  return {
    mode: forwardMode,
    queueMode: forwardMode,
    activeProcessors: [
      ...(forwarderProcessor ? ['forwarder'] : []),
      ...(executeOrdersProcessor ? ['executeOrders'] : [])
    ],
    pendingJobCount: forwardPending + executePending,
    queues: {
      forwarder: {
        mode: forwardMode,
        workerActive: Boolean(worker || (forwardMode === 'memory' && forwarderProcessor)),
        pendingJobs: forwardPending
      },
      executeOrders: {
        mode: executeMode,
        workerActive: Boolean(executeOrdersWorker || (executeMode === 'memory' && executeOrdersProcessor)),
        pendingJobs: executePending
      }
    }
  };
}
