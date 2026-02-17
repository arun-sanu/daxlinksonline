import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asUpperText(value) {
  const text = String(value || '')
    .trim()
    .toUpperCase();
  return text || null;
}

function asLowerText(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return text || null;
}

function toJsonSafe(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function resolveExecutionPrice({ executionPrice, value, quantity }) {
  const explicit = asNumber(executionPrice);
  if (explicit !== null && explicit > 0) return explicit;

  const quoteValue = asNumber(value);
  const qty = asNumber(quantity);
  if (quoteValue === null || qty === null || qty <= 0) return null;
  return quoteValue / qty;
}

function resolveAccountBalanceAfter({ accountBalanceAfter, accountBalanceBefore, side, value }) {
  const explicit = asNumber(accountBalanceAfter);
  if (explicit !== null) return explicit;

  const before = asNumber(accountBalanceBefore);
  const quoteValue = asNumber(value);
  if (before === null || quoteValue === null) return null;

  const normalizedSide = asUpperText(side);
  if (normalizedSide === 'BUY' || normalizedSide === 'LONG') return before - quoteValue;
  if (normalizedSide === 'SELL' || normalizedSide === 'SHORT') return before + quoteValue;

  return null;
}

function resolvePositionQty({ input, side, quantity }) {
  const sizingContext = input?.sizingContext && typeof input.sizingContext === 'object' ? input.sizingContext : {};
  const sizingDebug = sizingContext?.sizingDebug && typeof sizingContext.sizingDebug === 'object' ? sizingContext.sizingDebug : {};
  const normalizedSide = asUpperText(side);
  const absQty = Math.abs(asNumber(quantity) || 0);

  let before = asNumber(
    input.positionQtyBefore ??
      input.position?.beforeQty ??
      input.freeBaseBefore ??
      input.baseBalanceBefore ??
      sizingContext.freeBase ??
      sizingContext.baseBalanceBefore ??
      sizingDebug.freeBase
  );
  let after = asNumber(
    input.positionQtyAfter ??
      input.position?.afterQty ??
      input.freeBaseAfter ??
      input.baseBalanceAfter ??
      sizingContext.baseBalanceAfter ??
      sizingDebug.freeBaseAfter
  );

  if (before !== null && after === null && absQty > 0) {
    if (normalizedSide === 'BUY' || normalizedSide === 'LONG') after = before + absQty;
    if (normalizedSide === 'SELL' || normalizedSide === 'SHORT') after = before - absQty;
  }

  if (after !== null && before === null && absQty > 0) {
    if (normalizedSide === 'BUY' || normalizedSide === 'LONG') before = after - absQty;
    if (normalizedSide === 'SELL' || normalizedSide === 'SHORT') before = after + absQty;
  }

  return { before, after };
}

export async function recordTradeTransaction(input = {}, options = {}) {
  const db = options.db || prisma;

  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) {
    throw Object.assign(new Error('workspaceId is required for trade transaction recording'), { status: 400 });
  }

  const symbol = asUpperText(input.symbol);
  if (!symbol) {
    throw Object.assign(new Error('symbol is required for trade transaction recording'), { status: 400 });
  }

  const side = asUpperText(input.side);
  const quantity = asNumber(input.quantity ?? input.qty ?? input.amount);
  const amount = asNumber(input.amount);
  const value = asNumber(input.value ?? input.quoteValue ?? input.quoteSpend ?? input.cummulativeQuoteQty);
  const accountBalanceBefore = asNumber(input.accountBalanceBefore ?? input.freeQuoteBefore);
  const accountBalanceAfter = resolveAccountBalanceAfter({
    accountBalanceAfter: input.accountBalanceAfter,
    accountBalanceBefore,
    side,
    value
  });
  const positionQty = resolvePositionQty({
    input,
    side,
    quantity
  });

  const data = {
    workspaceId,
    botId: input.botId ? String(input.botId) : null,
    botInstanceId: input.botInstanceId ? String(input.botInstanceId) : null,
    orderId: input.orderId ? String(input.orderId) : null,
    executionAuditId: input.executionAuditId ? String(input.executionAuditId) : null,
    forwardedSignalId: input.forwardedSignalId ? String(input.forwardedSignalId) : null,
    integrationId: input.integrationId ? String(input.integrationId) : null,
    exchangeAccountId: input.exchangeAccountId ? String(input.exchangeAccountId) : null,
    venue: asLowerText(input.venue),
    symbol,
    side: side || 'UNKNOWN',
    orderType: asUpperText(input.orderType),
    status: asLowerText(input.status) || 'executed',
    amount: asDecimal(amount),
    quantity: asDecimal(quantity),
    value: asDecimal(value),
    marketPrice: asDecimal(input.marketPrice ?? input.refPrice ?? input.computedPrice),
    executionPrice: asDecimal(
      resolveExecutionPrice({
        executionPrice: input.executionPrice ?? input.price,
        value,
        quantity
      })
    ),
    feeAmount: asDecimal(input.feeAmount ?? input.fee),
    feeAsset: asUpperText(input.feeAsset),
    realizedPnl: asDecimal(input.realizedPnl),
    unrealizedPnl: asDecimal(input.unrealizedPnl),
    accountBalanceBefore: asDecimal(accountBalanceBefore),
    accountBalanceAfter: asDecimal(accountBalanceAfter),
    accountEquityBefore: asDecimal(input.accountEquityBefore),
    accountEquityAfter: asDecimal(input.accountEquityAfter),
    balanceAsset: asUpperText(input.balanceAsset),
    positionQtyBefore: asDecimal(positionQty.before),
    positionQtyAfter: asDecimal(positionQty.after),
    decisionContext: toJsonSafe(input.decisionContext),
    sizingContext: toJsonSafe(input.sizingContext),
    exchangePayload: toJsonSafe(input.exchangePayload),
    metadata: toJsonSafe(input.metadata),
    executedAt: asDate(input.executedAt) || new Date()
  };

  return db.tradeTransaction.create({ data });
}
