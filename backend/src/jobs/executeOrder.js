import { prisma } from '../utils/prisma.js';

const MAX_RETRY = 3;
const isDryRun = process.env.WORKFLOW_EXECUTION_MODE === 'dryrun';

// Minimal stub for exchange client; replace with real Pendax client wiring
function getExchangeClient(_venue, _creds) {
  return {
    async placeOrder(order) {
      // Simulate success
      return {
        orderId: `sim_${Date.now()}`,
        status: 'NEW',
        ...order
      };
    }
  };
}

export async function executePreparedSignal(signalId) {
  if (!signalId) return null;
  const signal = await prisma.forwardedSignal.findUnique({ where: { id: signalId } });
  if (!signal) throw new Error('Signal not found');
  if (!['ready_for_execution', 'retrying'].includes(signal.status)) {
    return { skipped: true, reason: 'status_not_ready' };
  }

  if (!signal.integrationId) {
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: { status: 'executed_error', error: 'missing_integration', attempts: { increment: 1 } }
    });
    return { skipped: true, reason: 'missing_integration' };
  }

  const integration = await prisma.integration.findUnique({
    where: { id: signal.integrationId },
    include: { credential: true }
  });
  if (!integration || !integration.credential) {
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: { status: 'executed_error', error: 'integration_credentials_missing', attempts: { increment: 1 } }
    });
    return { skipped: true, reason: 'integration_credentials_missing' };
  }

  const mappedOrder = signal.payload?.mappedOrder || signal.payload?.raw?.mappedOrder || {};
  const { symbol, size, orderType, leverage } = mappedOrder;
  if (!symbol || size === undefined || size === null) {
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: { status: 'executed_error', error: 'mapped_order_incomplete', attempts: { increment: 1 } }
    });
    return { skipped: true, reason: 'mapped_order_incomplete' };
  }

  try {
    if (isDryRun) {
      await prisma.forwardedSignal.update({
        where: { id: signalId },
        data: {
          status: 'executed_success',
          payload: { ...(signal.payload || {}), executionResult: { dryRun: true } },
          executedAt: new Date()
        }
      });
      return { ok: true, dryRun: true };
    }

    const client = getExchangeClient(integration.exchange, integration.credential);
    const result = await client.placeOrder({
      symbol,
      size,
      orderType: orderType || 'market',
      leverage: leverage || 1
    });
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: {
        status: 'executed_success',
        payload: { ...(signal.payload || {}), executionResult: result },
        executedAt: new Date()
      }
    });
    return { ok: true, result };
  } catch (err) {
    const attempts = (signal.attempts || 0) + 1;
    const canRetry = attempts < MAX_RETRY;
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: {
        status: canRetry ? 'retrying' : 'executed_error',
        error: err?.message || String(err),
        attempts
      }
    });
    return { ok: false, error: err?.message || String(err), retry: canRetry };
  }
}
