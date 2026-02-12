import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

let queue = null;
let queueEvents = null;
let worker = null;
let memoryHandlers = [];
let forwarderMemoryHandler = null;
let executeOrdersMemoryHandler = null;
export let executeOrdersQueue = null;
export let executeOrdersWorker = null;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
}

export function initQueue({ queueName = 'pendax-forwarder', processor } = {}) {
  const redis = getRedis();
  if (redis) {
    queue = new Queue(queueName, { connection: redis });
    queueEvents = new QueueEvents(queueName, { connection: redis });
    if (processor) {
      worker = new Worker(queueName, processor, { connection: redis, concurrency: 5 });
    }
    return { mode: 'redis', queue, worker, queueEvents };
  }
  // In-memory fallback
  if (typeof processor === 'function') {
    forwarderMemoryHandler = processor;
    if (!memoryHandlers.includes(processor)) {
      memoryHandlers.push(processor);
    }
  }
  return { mode: 'memory' };
}

export async function enqueue(name, data, opts) {
  if (queue) {
    return queue.add(name, data, opts);
  }
  // In-memory: run soon, but async
  const processor = forwarderMemoryHandler || memoryHandlers.find((handler) => typeof handler === 'function');
  if (processor) setTimeout(() => processor({ data }), 0);
  return { id: `mem_${Date.now()}` };
}

export function initExecuteOrdersQueue({ processor } = {}) {
  const redis = getRedis();
  if (redis) {
    executeOrdersQueue = new Queue('execute_orders', { connection: redis });
    if (processor) {
      executeOrdersWorker = new Worker('execute_orders', processor, { connection: redis, concurrency: 3 });
    }
    return { mode: 'redis', queue: executeOrdersQueue, worker: executeOrdersWorker };
  }
  // In-memory fallback
  const runner = processor ? (job) => processor(job) : null;
  if (runner) {
    executeOrdersMemoryHandler = runner;
    if (!memoryHandlers.includes(runner)) {
      memoryHandlers.push(runner);
    }
  }
  executeOrdersQueue = {
    async add(name, data) {
      const handler =
        executeOrdersMemoryHandler ||
        runner ||
        [...memoryHandlers].reverse().find((registered) => typeof registered === 'function');
      if (handler) {
        setTimeout(() => handler({ name, data }), 0);
      }
      return { id: `mem_${Date.now()}` };
    }
  };
  executeOrdersWorker = runner || null;
  return { mode: 'memory', queue: executeOrdersQueue, worker: executeOrdersWorker };
}
