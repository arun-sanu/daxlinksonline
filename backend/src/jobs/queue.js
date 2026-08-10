import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

let queue = null;
let queueEvents = null;
let worker = null;
let memoryHandlers = [];

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
  memoryHandlers.push(processor);
  return { mode: 'memory' };
}

export async function enqueue(name, data, opts) {
  if (queue) {
    return queue.add(name, data, opts);
  }
  // In-memory: run soon, but async
  const processor = memoryHandlers[0];
  if (processor) setTimeout(() => processor({ data }), 0);
  return { id: `mem_${Date.now()}` };
}
