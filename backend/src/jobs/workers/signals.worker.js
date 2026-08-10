import { Worker } from 'bullmq';
import { prisma } from '../../utils/prisma.js';
import { connection } from '../../lib/redis.js';
import { queues } from '../queues.js';

export async function handleSignalJob(job) {
  const { signalId, correlationId } = job.data || {};
  if (!signalId) return;
  const signal = await prisma.signal.findUnique({ where: { id: signalId } });
  if (!signal) return;
  const instance = await prisma.botInstance.findUnique({ where: { id: signal.botInstanceId } });
  if (!instance) return;
  const exchange = await prisma.exchangeAccount.findUnique({ where: { id: instance.exchangeAccountId } });

  // Normalize simple payload
  const payload = signal.payload || {};
  const side = String(payload.side || payload.SIDE || 'BUY').toUpperCase();
  const symbol = payload.symbol || instance.symbol;
  const qty = payload.qty || payload.quantity || 1;
  const price = payload.price || null;
  const type = payload.type || 'MARKET';

  // Enqueue order job
  const data = {
    botInstanceId: instance.id,
    venue: exchange?.venue || 'sandbox',
    symbol,
    side,
    type,
    price,
    qty,
    correlationId
  };
  if (!process.env.REDIS_URL) {
    const mod = await import('./orders.worker.js');
    await mod.handleOrderJob({ data });
  } else {
    await queues.orders.add('order', data, {
      removeOnComplete: true,
      removeOnFail: 100,
      jobId: correlationId ? `${instance.id}:${correlationId}` : undefined
    });
  }
  await prisma.signal.update({ where: { id: signalId }, data: { processed: true, processedAt: new Date() } });
}

export function startSignalsWorker() {
  if (!connection) return null;
  const worker = new Worker('signals', handleSignalJob, { connection, concurrency: 5 });
  worker.on('error', (err) => console.error('[signals.worker] error', err));
  return worker;
}
