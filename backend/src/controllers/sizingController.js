import { z } from 'zod';
import { prisma } from '../utils/prisma.js';

const recentQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{4,20}$/)
    .optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  status: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional()
});

const summaryQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  range: z.enum(['7d', '30d', '24h', 'custom']).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional()
});

const auditParamsSchema = z.object({
  id: z.string().uuid()
});

async function resolveWorkspaceForUser(userId, workspaceId) {
  if (!workspaceId) return null;
  const row = await prisma.workspace.findFirst({
    where: {
      ownerId: userId,
      id: workspaceId
    },
    select: { id: true }
  });
  if (!row) {
    throw Object.assign(new Error('Workspace not found for current user'), { status: 404 });
  }
  return row.id;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapAuditRow(row) {
  const sizingDebug = row?.sizingDebug || null;
  const qtyRaw = row.qtyRaw ?? sizingDebug?.qtyRaw ?? null;
  const qtyRounded = row.qtyRounded ?? sizingDebug?.qtyAfterStepRounding ?? null;
  const computedPrice = row.computedPrice ?? sizingDebug?.priceUsed ?? null;
  const freeQuote = row.freeQuote ?? sizingDebug?.freeQuote ?? null;
  return {
    id: row.id,
    receivedAt: toIso(row.receivedAt),
    symbol: row.symbol || null,
    side: row.side || null,
    status: row.status || null,
    errorMessage: row.errorMessage || null,
    computedPrice,
    freeQuote,
    freeBase: sizingDebug?.freeBase ?? null,
    qtyRaw,
    qtyRounded,
    mexcOrderId: row.mexcOrderId ?? null,
    sizingDebug,
    rejectedReason: sizingDebug?.rejectedReason ?? null,
    quoteSpendComputed: sizingDebug?.quoteSpendComputed ?? null,
    notionalAfterRounding: sizingDebug?.notionalAfterRounding ?? null
  };
}

function computeRange(range, since, until) {
  const now = new Date();
  if (range === 'custom') {
    if (!since || !until) {
      throw Object.assign(new Error('Custom range requires since and until parameters.'), { status: 400 });
    }
    const start = new Date(since);
    const end = new Date(until);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw Object.assign(new Error('Invalid custom range dates.'), { status: 400 });
    }
    return { start, end, range: 'custom' };
  }

  const normalized = range || '7d';
  if (normalized === '24h') {
    return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now, range: '24h' };
  }
  if (normalized === '30d') {
    return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now, range: '30d' };
  }
  return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now, range: '7d' };
}

export async function handleGetSizingRecent(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const parsed = recentQuerySchema.parse(req.query || {});
    const resolvedWorkspaceId = await resolveWorkspaceForUser(req.user.id, parsed.workspaceId);
    const where = {
      userId: req.user.id,
      ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
      ...(parsed.symbol ? { symbol: parsed.symbol } : {}),
      ...(parsed.side ? { side: parsed.side } : {})
    };
    if (parsed.status) {
      where.status = String(parsed.status).toUpperCase();
    }
    if (parsed.since || parsed.until) {
      where.receivedAt = {};
      if (parsed.since) where.receivedAt.gte = new Date(parsed.since);
      if (parsed.until) where.receivedAt.lte = new Date(parsed.until);
    }

    const rows = await prisma.executionAudit.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: parsed.limit || 50,
      select: {
        id: true,
        receivedAt: true,
        symbol: true,
        side: true,
        status: true,
        errorMessage: true,
        computedPrice: true,
        freeQuote: true,
        qtyRaw: true,
        qtyRounded: true,
        mexcOrderId: true,
        sizingDebug: true
      }
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      total: rows.length,
      items: rows.map(mapAuditRow)
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid query parameters';
    }
    next(error);
  }
}

export async function handleGetSizingAudit(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { id } = auditParamsSchema.parse(req.params || {});
    const row = await prisma.executionAudit.findFirst({
      where: { id, userId: req.user.id },
      select: {
        id: true,
        receivedAt: true,
        symbol: true,
        side: true,
        status: true,
        errorMessage: true,
        computedPrice: true,
        freeQuote: true,
        qtyRaw: true,
        qtyRounded: true,
        mexcOrderId: true,
        sizingDebug: true
      }
    });
    if (!row) return res.status(404).json({ error: 'Execution audit not found' });
    res.json({ ok: true, audit: mapAuditRow(row) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid audit request';
    }
    next(error);
  }
}

export async function handleGetSizingSummary(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const parsed = summaryQuerySchema.parse(req.query || {});
    const resolvedWorkspaceId = await resolveWorkspaceForUser(req.user.id, parsed.workspaceId);
    const { start, end, range } = computeRange(parsed.range, parsed.since, parsed.until);

    const rows = await prisma.executionAudit.findMany({
      where: {
        userId: req.user.id,
        ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
        receivedAt: {
          gte: start,
          lte: end
        }
      },
      select: {
        symbol: true,
        side: true,
        status: true,
        qtyRounded: true,
        sizingDebug: true
      }
    });

    const groups = new Map();
    const overallRejectedReasons = {};
    let total = 0;
    let sent = 0;
    let filled = 0;
    let rejected = 0;
    let errored = 0;

    rows.forEach((row) => {
      const symbol = row.symbol || 'UNKNOWN';
      const side = row.side || 'UNKNOWN';
      const key = `${symbol}::${side}`;
      if (!groups.has(key)) {
        groups.set(key, {
          symbol,
          side,
          count_total: 0,
          count_sent: 0,
          count_filled: 0,
          count_rejected: 0,
          count_error: 0,
          rejectedReasons: {},
          sum_qtyRounded: 0,
          count_qtyRounded: 0,
          min_qtyRounded: null,
          max_qtyRounded: null,
          sum_notional: 0,
          count_notional: 0,
          sum_quoteSpend: 0,
          count_quoteSpend: 0
        });
      }

      const group = groups.get(key);
      const status = String(row.status || '').toUpperCase();
      total += 1;
      group.count_total += 1;
      if (status === 'SENT') {
        sent += 1;
        group.count_sent += 1;
      } else if (status === 'FILLED') {
        filled += 1;
        group.count_filled += 1;
      } else if (status === 'REJECTED') {
        rejected += 1;
        group.count_rejected += 1;
      } else if (status === 'ERROR') {
        errored += 1;
        group.count_error += 1;
      }

      const debug = row.sizingDebug || {};
      const rejectedReason = debug.rejectedReason;
      if (rejectedReason) {
        group.rejectedReasons[rejectedReason] = (group.rejectedReasons[rejectedReason] || 0) + 1;
        overallRejectedReasons[rejectedReason] = (overallRejectedReasons[rejectedReason] || 0) + 1;
      }

      const qtyRounded = asNumber(row.qtyRounded ?? debug.qtyAfterStepRounding);
      if (qtyRounded && qtyRounded > 0) {
        group.sum_qtyRounded += qtyRounded;
        group.count_qtyRounded += 1;
        group.min_qtyRounded = group.min_qtyRounded === null ? qtyRounded : Math.min(group.min_qtyRounded, qtyRounded);
        group.max_qtyRounded = group.max_qtyRounded === null ? qtyRounded : Math.max(group.max_qtyRounded, qtyRounded);
      }

      const notional = asNumber(debug.notionalAfterRounding);
      if (notional && notional > 0) {
        group.sum_notional += notional;
        group.count_notional += 1;
      }

      const quoteSpend = asNumber(debug.quoteSpendComputed);
      if (quoteSpend && quoteSpend > 0) {
        group.sum_quoteSpend += quoteSpend;
        group.count_quoteSpend += 1;
      }
    });

    const summarized = Array.from(groups.values()).map((group) => {
      const rejectedReasons = group.rejectedReasons || {};
      let mostCommon = null;
      let mostCount = 0;
      Object.entries(rejectedReasons).forEach(([reason, count]) => {
        if (count > mostCount) {
          mostCommon = reason;
          mostCount = count;
        }
      });

      return {
        symbol: group.symbol,
        side: group.side,
        count_total: group.count_total,
        count_sent: group.count_sent,
        count_filled: group.count_filled,
        count_rejected: group.count_rejected,
        count_error: group.count_error,
        most_common_rejectedReason: mostCommon,
        avg_qtyRounded: group.count_qtyRounded ? group.sum_qtyRounded / group.count_qtyRounded : null,
        avg_notionalAfterRounding: group.count_notional ? group.sum_notional / group.count_notional : null,
        avg_quoteSpendComputed: group.count_quoteSpend ? group.sum_quoteSpend / group.count_quoteSpend : null,
        min_qtyRounded: group.min_qtyRounded,
        max_qtyRounded: group.max_qtyRounded
      };
    });

    let topRejectedReason = null;
    let topRejectedCount = 0;
    Object.entries(overallRejectedReasons).forEach(([reason, count]) => {
      if (count > topRejectedCount) {
        topRejectedReason = reason;
        topRejectedCount = count;
      }
    });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      range,
      start: start.toISOString(),
      end: end.toISOString(),
      total,
      summary: {
        total,
        sent,
        filled,
        rejected,
        error: errored,
        topRejectedReason
      },
      groups: summarized
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid query parameters';
    }
    next(error);
  }
}
