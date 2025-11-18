import { Worker } from 'bullmq';
import { prisma } from '../../utils/prisma.js';
import { connection } from '../../lib/redis.js';
import { placeSandboxOrder } from '../../lib/pendax.js';
import { logGuardrailViolation } from '../../lib/tradeGuards.js';

function toDecimalString(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

export async function handleOrderJob(job) {
  const { botInstanceId, venue, symbol, side, type, price, qty } = job.data || {};
  if (!botInstanceId) return;
  const inst = await prisma.botInstance.findUnique({ where: { id: botInstanceId } });
  if (!inst) return;

  // Pre-flight checks (simplified sandbox):
  // - minNotional
  const notional = (price ? Number(price) : 0) * Number(qty || 0);
  if (inst.minNotional && notional && notional < inst.minNotional) {
    // Record rejected order
    await prisma.order.create({
      data: {
        botInstanceId,
        venue,
        symbol,
        side,
        type,
        price: toDecimalString(price),
        qty: toDecimalString(qty),
        status: 'REJECTED',
        error: `Min notional ${inst.minNotional}`
      }
    });
    await logGuardrailViolation(botInstanceId, 'Below minNotional (worker)');
    return;
  }

  // Place order via sandbox pendax stub
  const resp = await placeSandboxOrder({ venue, symbol, side, type, price, qty });

  await prisma.order.create({
    data: {
      botInstanceId,
      venue,
      symbol,
      side,
      type,
      price: toDecimalString(price),
      qty: toDecimalString(qty),
      status: 'NEW',
      venueOrderId: resp?.id || null
    }
  });
}

export function startOrdersWorker() {
  if (!connection) return null;
  const worker = new Worker('orders', handleOrderJob, { connection, concurrency: 5 });
  worker.on('error', (err) => console.error('[orders.worker] error', err));
  return worker;
}
