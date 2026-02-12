import { initQueue } from './queue.js';
import { processForwardJob } from './forwarder.js';

initQueue({
  queueName: 'pendax-forwarder',
  processor: async (job) => processForwardJob(job)
});
