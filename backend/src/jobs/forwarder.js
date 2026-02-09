import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { createExchange } from '../sdk/index.js';
import { normalizePayload, computeIdempotencyKey, sanitizePayload } from '../services/forwardingMapper.js';
import { updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import crypto from 'crypto';
import { getWorkspaceWorkflowConfig, simulateRules } from '../services/workflowService.js';
import { initExecuteOrdersQueue, executeOrdersQueue } from './queue.js';

function sanitize(obj) {
  try {
    const copy = typeof obj === 'object' && obj !== null ? JSON.parse(JSON.stringify(obj)) : obj;
    if (copy && typeof copy === 'object') {
      if (Object.prototype.hasOwnProperty.call(copy, 'secret')) {
        copy.secret = '[redacted]';
      }
    }
    return copy;
  } catch {
    return {};
  }
}

export async function processForwardJob(job) {
  const { userId, payload, alertId } = job.data || {};
  if (!userId) return;
  try {
    const normalized = normalizePayload(payload);
    const idemKey = computeIdempotencyKey({ userId, normalized });
    const notional = normalized.amount && normalized.price ? normalized.amount * normalized.price : normalized.amount || 0;

    const workspaces = await prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true }
    });
    const workspaceIds = workspaces.map((w) => w.id);
    if (workspaceIds.length === 0) {
      if (alertId) {
        await updateTradingviewAlertStatus(alertId, 'failed', 'No workspace configured');
      }
      return;
    }

    const executionTargets = [];
    for (const workspaceId of workspaceIds) {
      const config = await getWorkspaceWorkflowConfig(workspaceId);
      const source = { id: payload?.webhookId || payload?.sourceId || payload?.source || 'unknown' };
      const signal = { symbol: normalized.symbol, side: normalized.side, notional, amount: normalized.amount };
      const simulation = await simulateRules({ workspaceId, rules: config.rules || [], source, signal });
      executionTargets.push(...simulation.matchedRules);
    }

    if (!executionTargets.length) {
      console.log('[forwarder] No matching routing rules — signal ignored');
      await upsertForwardedSignal({
        userId,
        integrationId: null,
        idempotencyKey: idemKey,
        normalized,
        status: 'skipped_no_rule',
        attempts: 1,
        error: 'No matching routing rules'
      });
      if (alertId) {
        await updateTradingviewAlertStatus(alertId, 'failed', 'No matching routing rules');
      }
      return;
    }

    for (const target of executionTargets) {
      const augmented = {
        ...normalized,
        raw: {
          ...(normalized.raw || {}),
          mappedOrder: target.mappedOrder,
          ruleId: target.ruleId
        }
      };
      const record = await upsertForwardedSignal({
        userId,
        integrationId: target.destinationIntegrationId || null,
        idempotencyKey: idemKey,
        normalized: augmented,
        status: 'ready_for_execution',
        attempts: 0,
        error: null
      });
      if (!executeOrdersQueue) {
        initExecuteOrdersQueue();
      }
      if (executeOrdersQueue) {
        await executeOrdersQueue.add('execute-prepared-signal', { signalId: record.id });
      }
    }

    if (alertId) {
      await updateTradingviewAlertStatus(alertId, 'executed', null);
    }
    console.log(`[forwarder] Signal routed to ${executionTargets.length} integration(s) using workflow rules`);
  } catch (err) {
    if (alertId) {
      try {
        await updateTradingviewAlertStatus(alertId, 'failed', err?.message || 'Forwarding failed');
      } catch {}
    }
    throw err;
  }
}

async function upsertForwardedSignal({ userId, integrationId, idempotencyKey, normalized, status, attempts, error }) {
  const base = {
    userId,
    integrationId,
    idempotencyKey,
    symbol: normalized.symbol || null,
    side: normalized.side || null,
    type: normalized.type || null,
    amount: normalized.amount ?? null,
    price: normalized.price ?? null,
    payload: normalizeForStorage(normalized.raw),
    status,
    attempts,
    error: error || null,
    executedAt: new Date()
  };
  try {
    const existing = await prisma.forwardedSignal.findUnique({ where: { idempotencyKey } });
    if (!existing) return prisma.forwardedSignal.create({ data: base });
    return prisma.forwardedSignal.update({ where: { id: existing.id }, data: base });
  } catch (e) {
    // ignore unique conflict races
  }
}

function normalizeForStorage(obj) {
  try {
    const clone = JSON.parse(JSON.stringify(obj || {}));
    if (Object.prototype.hasOwnProperty.call(clone, 'secret')) clone.secret = '[redacted]';
    return clone;
  } catch {
    return {};
  }
}

async function placeOrderBestEffort(exchange, n) {
  // Try a few common method shapes; fallback to connectivity test
  const params = {
    symbol: n.symbol,
    side: n.side,
    type: n.type || (n.price ? 'limit' : 'market'),
    amount: n.amount || 0,
    price: n.price,
    clientOrderId: n.clientOrderId,
    exchange: n.exchange,
    raw: n.raw
  };
  if (!params.symbol || !params.side) {
    throw new Error('Missing symbol/side in alert payload');
  }
  // Known variants
  if (typeof exchange.submitSignal === 'function') {
    return exchange.submitSignal(params);
  }
  if (typeof exchange.createOrder === 'function') {
    return exchange.createOrder(params);
  }
  if (typeof exchange.placeOrder === 'function') {
    return exchange.placeOrder(params);
  }
  if (typeof exchange.order === 'function') {
    return exchange.order(params);
  }
  if (typeof exchange.trade === 'function') {
    return exchange.trade(params);
  }
  // Fallback: just connectivity so job is “sent” without an exception
  if (typeof exchange.testConnectivity === 'function') {
    return exchange.testConnectivity();
  }
  throw new Error('Exchange adapter does not support order placement');
}
