import { prisma } from '../utils/prisma.js';
import { normalizePayload, sanitizePayload } from './forwardingMapper.js';

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function trimString(value, max = 160) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.length > max ? str.slice(0, max) : str;
}

function extractStrategyName(payload) {
  const p = payload || {};
  return (
    trimString(p.strategy) ||
    trimString(p.strategyName) ||
    trimString(p.strategy_name) ||
    trimString(p.name) ||
    null
  );
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
  const normalized = normalizePayload(payload || {});
  const data = {
    userId,
    source: 'tradingview',
    strategyName: extractStrategyName(payload),
    symbol: normalized.symbol || null,
    side: normalized.side || null,
    orderType: normalized.type || null,
    quantity: normalized.amount ?? null,
    takeProfit: extractTakeProfit(payload),
    stopLoss: extractStopLoss(payload),
    webhookSubdomain: webhookSubdomain || null,
    clientIp: clientIp || null,
    payload: sanitizePayload(payload || {}),
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
