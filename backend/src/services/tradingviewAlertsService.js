import { prisma } from '../utils/prisma.js';
import { normalizePayload, sanitizePayload } from './forwardingMapper.js';
import { extractStrategyName as extractStrategyFromSignal, normalizeTradingviewSignal } from './tradingviewSignalService.js';

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function extractTakeProfit(payload) {
  const p = payload || {};
  return (
    parseNumber(p.tp) ??
    parseNumber(p.takeProfit) ??
    parseNumber(p.take_profit) ??
    parseNumber(p.target) ??
    parseNumber(p.targetPrice) ??
    null
  );
}

function extractStopLoss(payload) {
  const p = payload || {};
  return (
    parseNumber(p.sl) ??
    parseNumber(p.stopLoss) ??
    parseNumber(p.stop_loss) ??
    parseNumber(p.stop) ??
    null
  );
}

export async function createTradingviewAlert({
  userId,
  payload,
  status = 'received',
  errorMessage = null,
  webhookSubdomain = null,
  clientIp = null
}) {
  const signal = normalizeTradingviewSignal(payload || {});
  const mergedPayload = signal.normalizedPayload || payload || {};
  const normalized = normalizePayload(mergedPayload);
  const normalizedSide = signal?.signal?.side ? signal.signal.side.toLowerCase() : normalized.side || null;
  const data = {
    userId,
    source: 'tradingview',
    strategyName: extractStrategyFromSignal(mergedPayload),
    symbol: signal?.signal?.symbol || normalized.symbol || null,
    side: normalizedSide,
    orderType: (normalized.type || 'market').toLowerCase(),
    quantity: normalized.amount ?? null,
    takeProfit: extractTakeProfit(mergedPayload),
    stopLoss: extractStopLoss(mergedPayload),
    webhookSubdomain: webhookSubdomain || null,
    clientIp: clientIp || null,
    payload: sanitizePayload(mergedPayload),
    status,
    errorMessage
  };
  return prisma.tradingviewAlert.create({ data });
}

export async function updateTradingviewAlertStatus(alertId, status, errorMessage = null) {
  if (!alertId) return null;
  return prisma.tradingviewAlert.update({
    where: { id: alertId },
    data: { status, errorMessage }
  });
}

export async function listTradingviewAlerts({ page = 1, limit = 50, userId, status, q } = {}) {
  const take = Math.max(1, Math.min(Number(limit) || 50, 200));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = {};
  if (userId) where.userId = String(userId);
  if (status) where.status = String(status);
  if (q) {
    const query = String(q);
    where.OR = [
      { strategyName: { contains: query, mode: 'insensitive' } },
      { symbol: { contains: query, mode: 'insensitive' } },
      { side: { contains: query, mode: 'insensitive' } },
      { errorMessage: { contains: query, mode: 'insensitive' } }
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.tradingviewAlert.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take,
      skip
    }),
    prisma.tradingviewAlert.count({ where })
  ]);
  return { rows, total, page: Math.max(1, Number(page) || 1), pageSize: take };
}

export async function deleteTradingviewAlerts({ userId } = {}) {
  const where = {};
  if (userId) where.userId = String(userId);
  return prisma.tradingviewAlert.deleteMany({ where });
}
