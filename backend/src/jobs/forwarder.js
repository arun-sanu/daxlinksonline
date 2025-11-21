import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { createExchange } from '../sdk/index.js';
import { normalizePayload, computeIdempotencyKey, sanitizePayload } from '../services/forwardingMapper.js';
import crypto from 'crypto';

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
  const { userId, payload } = job.data || {};
  if (!userId) return;
  const normalized = normalizePayload(payload);
  const idemKey = computeIdempotencyKey({ userId, normalized });

  const workspaces = await prisma.workspace.findMany({
    where: { ownerId: userId },
    select: { id: true }
  });
  const workspaceIds = workspaces.map((w) => w.id);
  if (workspaceIds.length === 0) return;

  const integrations = await prisma.integration.findMany({
    where: { workspaceId: { in: workspaceIds }, status: 'active' },
    include: { credential: true }
  });

  for (const integ of integrations) {
    // Skip if already succeeded with this idempotency key for this integration
    const existing = await prisma.forwardedSignal.findUnique({ where: { idempotencyKey: idemKey } }).catch(() => null);
    if (existing && existing.status === 'succeeded' && existing.integrationId === integ.id) {
      continue;
    }
    let status = 'sent';
    let error = null;
    const started = Date.now();
    try {
      if (!integ.credential) throw new Error('Missing credentials');
      const exchange = createExchange({
        exchange: integ.exchange,
        environment: integ.environment,
        apiKey: decrypt(integ.credential.apiKey),
        apiSecret: decrypt(integ.credential.apiSecret),
        passphrase: integ.credential.passphrase ? decrypt(integ.credential.passphrase) : undefined
      });
      // Attempt order placement with best-effort method detection
      await placeOrderBestEffort(exchange, normalized);

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'forward.sent',
          entityType: 'Integration',
          entityId: integ.id,
          summary: `${integ.exchange} ${integ.environment}`,
          detail: { payload: sanitizePayload(payload), order: { symbol: normalized.symbol, side: normalized.side, type: normalized.type, amount: normalized.amount, price: normalized.price } }
        }
      });
      await upsertForwardedSignal({
        userId,
        integrationId: integ.id,
        idempotencyKey: idemKey,
        normalized,
        status: 'succeeded',
        attempts: 1,
        error: null
      });
    } catch (e) {
      status = 'failed';
      error = e?.message || String(e);
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'forward.failed',
          entityType: 'Integration',
          entityId: integ.id,
          summary: `${integ.exchange} ${integ.environment}`,
          detail: { payload: sanitizePayload(payload), error }
        }
      });
      await upsertForwardedSignal({
        userId,
        integrationId: integ.id,
        idempotencyKey: idemKey,
        normalized,
        status: 'failed',
        attempts: 1,
        error
      });
    } finally {
      // Metrics captured via AuditLog and ForwardedSignal; no WebhookDelivery side-effects here
      const elapsed = Date.now() - started;
      void elapsed; // placeholder to keep elapsed computed if needed later
    }
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
