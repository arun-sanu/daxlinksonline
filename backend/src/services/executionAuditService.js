import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { extractStrategyName } from './tradingviewSignalService.js';

export const EXECUTION_AUDIT_STATUS = Object.freeze({
  RECEIVED: 'RECEIVED',
  REJECTED: 'REJECTED',
  SENT: 'SENT',
  FILLED: 'FILLED',
  ERROR: 'ERROR'
});

const DEDUPE_TTL_MS = Number(process.env.TRADINGVIEW_DEDUPE_TTL_MS || 120000);

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSafeBigInt(value) {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(Math.trunc(Number(value)));
  } catch {
    return null;
  }
}

function toJsonSafe(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function buildExecutionDedupeKey({ symbol, side, tvTs, botId }) {
  if (!symbol || !side || !tvTs || !botId) return null;
  const minuteBucket = Math.floor(Number(tvTs) / 60000);
  const input = `${String(symbol).toUpperCase()}|${String(side).toUpperCase()}|${minuteBucket}|${String(botId)}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function createExecutionAudit({
  userId,
  workspaceId = null,
  botId = null,
  integrationId = null,
  tradingviewAlertId = null,
  forwardedSignalId = null,
  tvTs = null,
  dedupeKey = null,
  symbol = null,
  side = null,
  rawBody = null,
  parsedPayload = null,
  strategyName = null,
  status = EXECUTION_AUDIT_STATUS.RECEIVED,
  errorMessage = null
}) {
  return prisma.executionAudit.create({
    data: {
      userId,
      workspaceId,
      botId,
      integrationId,
      tradingviewAlertId,
      forwardedSignalId,
      tvTs: toSafeBigInt(tvTs),
      dedupeKey,
      symbol: symbol ? String(symbol).toUpperCase() : null,
      side: side ? String(side).toUpperCase() : null,
      strategyName: strategyName || extractStrategyName(parsedPayload || {}),
      rawBody: rawBody != null ? String(rawBody) : null,
      parsedPayload: toJsonSafe(parsedPayload),
      status,
      errorMessage: errorMessage || null
    }
  });
}

export async function updateExecutionAudit(auditId, patch = {}) {
  if (!auditId) return null;
  const data = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'workspaceId')) data.workspaceId = patch.workspaceId || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'botId')) data.botId = patch.botId || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'integrationId')) data.integrationId = patch.integrationId || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'forwardedSignalId')) data.forwardedSignalId = patch.forwardedSignalId || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'tvTs')) data.tvTs = toSafeBigInt(patch.tvTs);
  if (Object.prototype.hasOwnProperty.call(patch, 'dedupeKey')) data.dedupeKey = patch.dedupeKey || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'symbol')) data.symbol = patch.symbol ? String(patch.symbol).toUpperCase() : null;
  if (Object.prototype.hasOwnProperty.call(patch, 'side')) data.side = patch.side ? String(patch.side).toUpperCase() : null;
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) data.status = String(patch.status || EXECUTION_AUDIT_STATUS.ERROR).toUpperCase();
  if (Object.prototype.hasOwnProperty.call(patch, 'errorMessage')) data.errorMessage = patch.errorMessage || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'computedPrice')) data.computedPrice = toFiniteNumber(patch.computedPrice);
  if (Object.prototype.hasOwnProperty.call(patch, 'freeQuote')) data.freeQuote = toFiniteNumber(patch.freeQuote);
  if (Object.prototype.hasOwnProperty.call(patch, 'qtyRaw')) data.qtyRaw = toFiniteNumber(patch.qtyRaw);
  if (Object.prototype.hasOwnProperty.call(patch, 'qtyRounded')) data.qtyRounded = toFiniteNumber(patch.qtyRounded);
  if (Object.prototype.hasOwnProperty.call(patch, 'mexcOrderId')) data.mexcOrderId = patch.mexcOrderId ? String(patch.mexcOrderId) : null;
  if (Object.prototype.hasOwnProperty.call(patch, 'mexcStatus')) data.mexcStatus = patch.mexcStatus ? String(patch.mexcStatus) : null;
  if (Object.prototype.hasOwnProperty.call(patch, 'mexcRawResponse')) data.mexcRawResponse = toJsonSafe(patch.mexcRawResponse);
  if (Object.prototype.hasOwnProperty.call(patch, 'parsedPayload')) data.parsedPayload = toJsonSafe(patch.parsedPayload);
  if (Object.prototype.hasOwnProperty.call(patch, 'rawBody')) data.rawBody = patch.rawBody != null ? String(patch.rawBody) : null;
  if (Object.prototype.hasOwnProperty.call(patch, 'strategyName')) data.strategyName = patch.strategyName || null;
  if (Object.keys(data).length === 0) return null;
  return prisma.executionAudit.update({
    where: { id: auditId },
    data
  });
}

export async function findDuplicateExecutionAudit({
  botId,
  dedupeKey,
  excludeId = null,
  ttlMs = DEDUPE_TTL_MS
}) {
  if (!botId || !dedupeKey) return null;
  const since = new Date(Date.now() - Math.max(1000, ttlMs));
  return prisma.executionAudit.findFirst({
    where: {
      botId,
      dedupeKey,
      receivedAt: { gte: since },
      status: { in: [EXECUTION_AUDIT_STATUS.RECEIVED, EXECUTION_AUDIT_STATUS.SENT] },
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    orderBy: { receivedAt: 'desc' }
  });
}

export async function listExecutionAuditsForUser({
  userId,
  page = 1,
  limit = 50,
  since,
  until,
  q
}) {
  const take = Math.max(1, Math.min(Number(limit) || 50, 200));
  const skip = (Math.max(1, Number(page) || 1) - 1) * take;
  const where = { userId: String(userId) };
  if (since || until) {
    where.receivedAt = {};
    if (since) where.receivedAt.gte = since;
    if (until) where.receivedAt.lte = until;
  }
  if (q) {
    where.OR = [
      { symbol: { contains: String(q), mode: 'insensitive' } },
      { side: { contains: String(q), mode: 'insensitive' } },
      { status: { contains: String(q), mode: 'insensitive' } },
      { errorMessage: { contains: String(q), mode: 'insensitive' } },
      { strategyName: { contains: String(q), mode: 'insensitive' } }
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.executionAudit.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take,
      skip
    }),
    prisma.executionAudit.count({ where })
  ]);

  return {
    rows,
    total,
    page: Math.max(1, Number(page) || 1),
    pageSize: take
  };
}

export async function deleteExecutionAuditsForUser(userId) {
  return prisma.executionAudit.deleteMany({
    where: { userId: String(userId) }
  });
}
