import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { recordTradeTransaction } from './tradeTransactionsService.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const REJECTED_STATES = new Set(['rejected', 'failed', 'error', 'canceled', 'cancelled', 'skipped']);

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asDecimal(value) {
  const n = asNumber(value);
  if (n === null) return null;
  return new Prisma.Decimal(n);
}

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function compactSymbol(value) {
  return normalizeSymbol(value).replace(/[^A-Z0-9]/g, '');
}

function toPlainNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractStrategy(payload) {
  return (
    payload?.meta?.strategy ||
    payload?.strategy ||
    payload?.strategyName ||
    payload?.strategy_name ||
    null
  );
}

function normalizeStatus(value, fallback = 'unknown') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function normalizeOrderStatus(input = {}) {
  const raw = normalizeStatus(input.status, 'submitted');
  if (['filled', 'success', 'executed', 'closed'].includes(raw)) return 'filled';
  if (['rejected', 'failed', 'error', 'canceled', 'cancelled'].includes(raw)) return 'rejected';
  if (['open', 'new', 'partially_filled', 'submitted'].includes(raw)) return 'open';
  return raw;
}

async function resolveBotInstance({
  workspaceId,
  botInstanceId,
  botId,
  symbol
}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const compactedSymbol = compactSymbol(symbol);

  if (botInstanceId) {
    const instance = await prisma.botInstance.findFirst({
      where: {
        id: botInstanceId,
        ...(workspaceId ? { workspaceId } : {})
      },
      include: {
        bot: {
          select: { id: true, name: true, workspaceId: true }
        },
        exchange: {
          select: { id: true, venue: true }
        }
      }
    });
    if (!instance) {
      throw Object.assign(new Error('Bot instance not found'), { status: 404 });
    }
    return instance;
  }

  if (!workspaceId) {
    throw Object.assign(new Error('workspaceId is required when botInstanceId is missing'), { status: 400 });
  }

  const instance = await prisma.botInstance.findFirst({
    where: {
      workspaceId,
      ...(botId ? { botId } : {}),
      ...(normalizedSymbol
        ? {
            OR: [{ symbol: normalizedSymbol }, { symbol: compactedSymbol }]
          }
        : {}),
      status: { in: ['running', 'paused', 'stopped', 'error'] }
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      bot: {
        select: { id: true, name: true, workspaceId: true }
      },
      exchange: {
        select: { id: true, venue: true }
      }
    }
  });
  if (!instance) {
    throw Object.assign(new Error('No bot instance matched workspace/symbol'), { status: 404 });
  }
  return instance;
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
}

function presentSizingReport(report) {
  const signal = report.normalizedSignal || {};
  return {
    id: report.id,
    orderId: report.orderId,
    createdAt: report.createdAt,
    symbol: report.order?.symbol || null,
    side: report.order?.side || null,
    strategy: extractStrategy(signal),
    status: report.order?.sizingStatus || report.order?.status || null,
    sizingRejectReason: report.order?.sizingRejectReason || null,
    quoteSpend: toPlainNumber(report.order?.quoteSpend),
    qtyRaw: toPlainNumber(report.order?.qtyRaw),
    qtyFinal: toPlainNumber(report.order?.qtyFinal),
    refPrice: toPlainNumber(report.order?.refPrice),
    minNotional: toPlainNumber(report.order?.minNotional),
    stepSize: toPlainNumber(report.order?.stepSize),
    riskMode: report.order?.riskMode || null,
    riskValue: toPlainNumber(report.order?.riskValue),
    slPrice: toPlainNumber(report.order?.slPrice),
    tpPrice: toPlainNumber(report.order?.tpPrice),
    freeQuote: toPlainNumber(report.freeQuote),
    freeBase: toPlainNumber(report.freeBase),
    exchangeMinNotional: toPlainNumber(report.exchangeMinNotional),
    effectiveMinNotional: toPlainNumber(report.effectiveMinNotional),
    precisionAmount: toPlainNumber(report.precisionAmount),
    reportStepSize: toPlainNumber(report.stepSize),
    roundingMethod: report.roundingMethod || null,
    workspaceId: report.order?.botInstance?.workspaceId || null,
    botId: report.order?.botInstance?.botId || null,
    botName: report.order?.botInstance?.bot?.name || null,
    botInstanceId: report.order?.botInstanceId || null
  };
}

export async function writeBotOrderResult(payload = {}) {
  const signal = payload?.normalizedSignal || payload?.signal || {};
  const entryOrder = payload?.entryOrder || {};
  const sizing = payload?.sizing || {};
  const protection = payload?.protection || {};
  const executionResult = payload?.executionResult || {};
  const rawPayload = payload?.rawPayload || payload;

  const symbol = normalizeSymbol(
    signal?.symbol ||
      entryOrder?.symbol ||
      payload?.symbol ||
      ''
  );
  const side = String(
    signal?.side ||
      entryOrder?.side ||
      payload?.side ||
      ''
  )
    .trim()
    .toUpperCase();
  const type = String(
    signal?.order?.type ||
      entryOrder?.type ||
      payload?.type ||
      'MARKET'
  )
    .trim()
    .toUpperCase();

  if (!symbol || !side) {
    throw Object.assign(new Error('normalizedSignal symbol/side are required'), { status: 400 });
  }

  const botInstance = await resolveBotInstance({
    workspaceId: payload.workspaceId || payload?.meta?.workspaceId || signal?.meta?.workspaceId || null,
    botInstanceId: payload.botInstanceId || payload?.meta?.botInstanceId || signal?.meta?.botInstanceId || null,
    botId: payload.botId || payload?.meta?.botId || signal?.meta?.botId || null,
    symbol
  });

  const sizingStatus = normalizeStatus(sizing?.status || sizing?.sizingStatus || entryOrder?.status || 'submitted');
  const isRejected = REJECTED_STATES.has(sizingStatus);
  const orderStatus = isRejected ? 'rejected' : normalizeOrderStatus(entryOrder);
  const resolvedQty =
    asDecimal(entryOrder?.qty ?? sizing?.qtyFinal ?? sizing?.qtyRaw ?? sizing?.qty_raw ?? signal?.quantity ?? signal?.qty ?? 0) ||
    new Prisma.Decimal(0);

  const orderData = {
    botInstanceId: botInstance.id,
    venue: String(entryOrder?.venue || botInstance.exchange?.venue || payload?.exchange || 'mexc').toLowerCase(),
    symbol,
    side,
    type,
    price: asDecimal(entryOrder?.price ?? sizing?.refPrice ?? signal?.signal_price ?? null),
    qty: resolvedQty,
    quoteSpend: asDecimal(sizing?.quoteSpend ?? sizing?.quote_spend),
    qtyRaw: asDecimal(sizing?.qtyRaw ?? sizing?.qty_raw),
    qtyFinal: asDecimal(sizing?.qtyFinal ?? sizing?.qty_final),
    refPrice: asDecimal(sizing?.refPrice ?? sizing?.ref_price),
    minNotional: asDecimal(sizing?.effectiveMinNotional ?? sizing?.effective_min_notional ?? sizing?.minNotional),
    stepSize: asDecimal(sizing?.stepSize ?? sizing?.step_size),
    riskMode: sizing?.riskMode || sizing?.risk_mode || signal?.risk?.mode || null,
    riskValue: asDecimal(sizing?.riskValue ?? sizing?.risk_value ?? signal?.risk?.value),
    slPrice: asDecimal(sizing?.slPrice ?? sizing?.sl_price ?? protection?.sl?.price),
    tpPrice: asDecimal(sizing?.tpPrice ?? sizing?.tp_price ?? protection?.tp?.price),
    sizingStatus,
    sizingRejectReason:
      sizing?.rejectReason ||
      sizing?.reject_reason ||
      sizing?.sizingRejectReason ||
      payload?.errors?.[0] ||
      null,
    status: orderStatus,
    venueOrderId:
      entryOrder?.venueOrderId ||
      entryOrder?.orderId ||
      executionResult?.orderId ||
      executionResult?.id ||
      null,
    error:
      entryOrder?.error ||
      payload?.errors?.join?.('; ') ||
      payload?.errors?.[0] ||
      null
  };

  if (orderData.qty.lte(0) && !isRejected) {
    throw Object.assign(new Error('entryOrder.qty or sizing.qtyFinal must be > 0'), { status: 400 });
  }

  const executedAt =
    asDate(entryOrder?.executedAt || executionResult?.executedAt || executionResult?.updateTime || payload?.executedAt) ||
    new Date();

  const [created, report] = await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.order.create({
      data: orderData
    });

    const createdReport = await tx.orderSizingReport.create({
      data: {
        orderId: createdOrder.id,
        freeQuote: asDecimal(sizing?.freeQuote ?? sizing?.free_quote),
        freeBase: asDecimal(sizing?.freeBase ?? sizing?.free_base),
        exchangeMinNotional: asDecimal(sizing?.exchangeMinNotional ?? sizing?.exchange_min_notional),
        effectiveMinNotional: asDecimal(sizing?.effectiveMinNotional ?? sizing?.effective_min_notional),
        precisionAmount: asDecimal(sizing?.precisionAmount ?? sizing?.precision_amount),
        stepSize: asDecimal(sizing?.stepSize ?? sizing?.step_size),
        roundingMethod: sizing?.roundingMethod || sizing?.rounding_method || null,
        rawPayload: toJsonSafe(rawPayload),
        normalizedSignal: toJsonSafe(signal),
        executionResult: toJsonSafe({
          entryOrder,
          protection,
          executionResult,
          errors: payload?.errors || []
        })
      },
      include: {
        order: {
          include: {
            botInstance: {
              include: {
                bot: {
                  select: { id: true, name: true }
                }
              }
            }
          }
        }
      }
    });

    await recordTradeTransaction(
      {
        workspaceId: botInstance.workspaceId,
        botId: botInstance.botId,
        botInstanceId: botInstance.id,
        orderId: createdOrder.id,
        executionAuditId: payload?.executionAuditId || payload?.meta?.executionAuditId || null,
        forwardedSignalId: payload?.signalId || signal?.id || null,
        integrationId: payload?.integrationId || payload?.meta?.integrationId || signal?.meta?.integrationId || null,
        exchangeAccountId: botInstance.exchangeAccountId || null,
        venue: orderData.venue,
        symbol,
        side,
        orderType: type,
        status: orderStatus,
        amount: toPlainNumber(orderData.qtyRaw ?? orderData.qty),
        quantity: toPlainNumber(orderData.qtyFinal ?? orderData.qty),
        value: toPlainNumber(orderData.quoteSpend),
        marketPrice: toPlainNumber(orderData.refPrice),
        executionPrice: toPlainNumber(orderData.price),
        feeAmount: toPlainNumber(
          executionResult?.feeAmount ??
            executionResult?.fee_amount ??
            executionResult?.commission ??
            entryOrder?.feeAmount ??
            entryOrder?.commission
        ),
        feeAsset: executionResult?.feeAsset || executionResult?.commissionAsset || entryOrder?.feeAsset || null,
        realizedPnl: toPlainNumber(
          executionResult?.realizedPnl ??
            executionResult?.realized_pnl ??
            payload?.realizedPnl
        ),
        unrealizedPnl: toPlainNumber(
          executionResult?.unrealizedPnl ??
            executionResult?.unrealized_pnl ??
            payload?.unrealizedPnl
        ),
        accountBalanceBefore: toPlainNumber(sizing?.freeQuote ?? sizing?.free_quote),
        accountBalanceAfter: toPlainNumber(
          executionResult?.freeQuoteAfter ??
            executionResult?.free_quote_after ??
            payload?.accountBalanceAfter
        ),
        accountEquityBefore: toPlainNumber(
          payload?.accountEquityBefore ??
            sizing?.equityBefore ??
            sizing?.equity_before
        ),
        accountEquityAfter: toPlainNumber(
          payload?.accountEquityAfter ??
            executionResult?.equityAfter ??
            executionResult?.equity_after
        ),
        balanceAsset: sizing?.quoteAsset || payload?.quoteAsset || null,
        positionQtyBefore: toPlainNumber(
          payload?.positionQtyBefore ??
            signal?.positionQtyBefore ??
            signal?.position?.beforeQty
        ),
        positionQtyAfter: toPlainNumber(
          payload?.positionQtyAfter ??
            signal?.positionQtyAfter ??
            signal?.position?.afterQty
        ),
        decisionContext: toJsonSafe({
          strategy: extractStrategy(payload),
          signal,
          risk: signal?.risk || null
        }),
        sizingContext: toJsonSafe(sizing),
        exchangePayload: toJsonSafe({
          entryOrder,
          protection,
          executionResult
        }),
        metadata: toJsonSafe({
          rawPayload,
          reportSource: 'internalBotOrderResult'
        }),
        executedAt
      },
      { db: tx }
    );

    return [createdOrder, createdReport];
  });

  return {
    ok: true,
    signalId: payload.signalId || signal?.id || null,
    orderId: created.id,
    botInstanceId: botInstance.id,
    sizingReportId: report.id
  };
}

export async function listSizingReports({
  symbol,
  strategy,
  status,
  from,
  to,
  workspaceId,
  page = 1,
  limit = DEFAULT_LIMIT
} = {}) {
  const take = asLimit(limit);
  const pageNum = Math.max(1, Number(page) || 1);
  const skip = (pageNum - 1) * take;
  const normalizedStrategy = strategy ? String(strategy).trim().toLowerCase() : null;

  const where = {
    ...(from || to
      ? {
          createdAt: {
            ...(asDate(from) ? { gte: asDate(from) } : {}),
            ...(asDate(to) ? { lte: asDate(to) } : {})
          }
        }
      : {}),
    order: {
      ...(symbol ? { symbol: String(symbol).toUpperCase() } : {}),
      ...(status
        ? {
            OR: [
              { sizingStatus: normalizeStatus(status) },
              { status: normalizeStatus(status) }
            ]
          }
        : {}),
      ...(workspaceId ? { botInstance: { workspaceId } } : {})
    }
  };

  const include = {
    order: {
      include: {
        botInstance: {
          include: {
            bot: {
              select: { id: true, name: true }
            }
          }
        }
      }
    }
  };

  if (normalizedStrategy) {
    const rows = await prisma.orderSizingReport.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' }
    });
    const filtered = rows
      .map((row) => presentSizingReport(row))
      .filter((item) => String(item.strategy || '').toLowerCase() === normalizedStrategy);
    return {
      items: filtered.slice(skip, skip + take),
      total: filtered.length,
      page: pageNum,
      pageSize: take
    };
  }

  const [rows, total] = await Promise.all([
    prisma.orderSizingReport.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      take,
      skip
    }),
    prisma.orderSizingReport.count({ where })
  ]);

  const items = rows.map((row) => presentSizingReport(row));

  return {
    items,
    total,
    page: pageNum,
    pageSize: take
  };
}

export async function getSizingReportById(id) {
  const row = await prisma.orderSizingReport.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          botInstance: {
            include: {
              bot: {
                select: { id: true, name: true }
              }
            }
          }
        }
      }
    }
  });
  if (!row) {
    throw Object.assign(new Error('Sizing report not found'), { status: 404 });
  }
  return {
    summary: presentSizingReport(row),
    rawPayload: row.rawPayload,
    normalizedSignal: row.normalizedSignal,
    executionResult: row.executionResult
  };
}
