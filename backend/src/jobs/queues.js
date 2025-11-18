import { Queue } from 'bullmq';
import { connection } from '../lib/redis.js';

export const queues = {
  signals: new Queue('signals', { connection }),
  orders: new Queue('orders', { connection }),
  build: new Queue('build', { connection }),
  bots: new Queue('bots', { connection })
};
