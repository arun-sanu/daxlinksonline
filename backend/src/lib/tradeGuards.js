import { prisma } from '../utils/prisma.js';

export class GuardrailError extends Error {
  constructor(message, code = 'guardrail', status = 400) {
    super(message);
    this.name = 'GuardrailError';
    this.guardrailCode = code;
    this.status = status;
  }
}

export async function recordGuardrailEvent(botInstanceId, type, detail = null) {
  if (!botInstanceId) return;
  try {
    await prisma.guardrailEvent.create({ data: { botInstanceId, type, detail } });
  } catch (err) {
    console.warn('[guardrail] failed to record event', err);
  }
}

export function roundPriceQty(meta = {}, price, qty) {
  const tick = Number(meta?.priceTick) > 0 ? Number(meta.priceTick) : 0.01;
  const step = Number(meta?.qtyStep) > 0 ? Number(meta.qtyStep) : 0.001;
  const round = (value, unit) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return value;
    return Math.round(value / unit) * unit;
  };
  return {
    price: round(price, tick),
    qty: round(qty, step)
  };
}

export function assertVenueFilters(meta = {}, minNotional = 0, price, qty) {
  const min = Number(meta?.minNotional ?? minNotional ?? 0) || 0;
  const notional = (Number(price) || 0) * (Number(qty) || 0);
  if (min > 0 && notional > 0 && notional < min) {
    throw new GuardrailError(`Below minNotional (${min})`, 'min_notional', 400);
  }
  const maxQty = Number(meta?.maxOrderQty) || 0;
  if (maxQty > 0 && Number(qty) > maxQty) {
    throw new GuardrailError(`Qty exceeds venue max (${maxQty})`, 'max_qty', 400);
  }
  return true;
}

export async function assertDailyLossCap(botInstanceId) {
  if (!botInstanceId) return;
  const inst = await prisma.botInstance.findUnique({ where: { id: botInstanceId }, select: { id: true, maxDailyLossPct: true } });
  if (!inst) return;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const lossBlock = await prisma.guardrailEvent.findFirst({
    where: { botInstanceId, type: 'loss_cap', createdAt: { gte: today } }
  });
  if (lossBlock) {
    throw new GuardrailError('Daily loss cap reached; trading paused', 'loss_cap', 403);
  }
}

export async function logSignatureEvent(botInstanceId, ok, detail = null) {
  await recordGuardrailEvent(botInstanceId, ok ? 'signature_ok' : 'signature_fail', detail);
}

export async function logRateLimitEvent(botInstanceId, detail) {
  await recordGuardrailEvent(botInstanceId, 'rate_limit', detail);
}

export async function logGuardrailViolation(botInstanceId, detail) {
  await recordGuardrailEvent(botInstanceId, 'guardrail_violation', detail);
}
