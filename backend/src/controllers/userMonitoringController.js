import { z } from 'zod';
import { deleteAudit, listAudit } from '../services/auditService.js';
import { deleteTradingviewAlerts } from '../services/tradingviewAlertsService.js';
import { deleteExecutionAuditsForUser, listExecutionAuditsForUser } from '../services/executionAuditService.js';

const querySchema = z.object({
  page: z.preprocess((val) => Number(val || 1), z.number().int().positive()).optional(),
  pageSize: z.preprocess((val) => Number(val || 50), z.number().int().positive().max(200)).optional(),
  limit: z.preprocess((val) => Number(val || 50), z.number().int().positive().max(200)).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  q: z.string().optional()
});

function normalizePayload(detail) {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.parse(JSON.stringify(detail));
  } catch {
    return String(detail);
  }
}

function toLegacyAlertRow(row) {
  const payload = normalizePayload(row.detail);
  return {
    id: row.id,
    receivedAt: row.createdAt,
    status: 'received',
    strategyName: payload?.strategy || payload?.strategyName || payload?.ruleName || '',
    symbol: payload?.symbol || payload?.ticker || '',
    side: payload?.side || payload?.direction || '',
    orderType: payload?.orderType || payload?.type || '',
    quantity: payload?.quantity ?? payload?.qty ?? '',
    takeProfit: payload?.takeProfit ?? payload?.tp ?? '',
    stopLoss: payload?.stopLoss ?? payload?.sl ?? '',
    errorMessage: '',
    userId: row.userId || '',
    webhookSubdomain: payload?.webhookSubdomain || payload?.subdomain || '',
    clientIp: payload?.clientIp || payload?.ip || '',
    payload
  };
}

function toExecutionAlertRow(row) {
  const payload = normalizePayload(row.parsedPayload) || {};
  const symbol = row.symbol || payload.symbol || payload.ticker || null;
  const side = row.side || payload.side || payload.action || null;
  const statusUpper = String(row.status || 'RECEIVED').toUpperCase();
  const tvTsNumber = row.tvTs !== null && row.tvTs !== undefined ? Number(row.tvTs) : null;
  const parsedTs = Number.isFinite(tvTsNumber) ? new Date(tvTsNumber).toISOString() : null;
  const parseFailed = statusUpper === 'RECEIVED' && (!symbol || !side);
  const status = parseFailed ? 'parse_failed' : statusUpper.toLowerCase();
  const errorMessage = row.errorMessage || (parseFailed ? 'PARSE_FAILED' : '');
  const type = String(payload.type || payload.orderType || 'MARKET').toUpperCase();

  return {
    id: row.id,
    receivedAt: parsedTs || row.receivedAt,
    ts: Number.isFinite(tvTsNumber) ? tvTsNumber : null,
    status,
    strategyName: row.strategyName || payload.strategy || payload.strategyName || payload.strategy_name || null,
    symbol,
    side,
    type,
    orderType: type,
    quantity: row.qtyRounded ?? '',
    takeProfit: payload.tp ?? payload.takeProfit ?? payload.take_profit ?? '',
    stopLoss: payload.sl ?? payload.stopLoss ?? payload.stop_loss ?? '',
    errorMessage,
    parseFailed,
    userId: row.userId || '',
    webhookSubdomain: payload.webhookSubdomain || payload.subdomain || '',
    clientIp: payload.clientIp || payload.ip || '',
    payload: payload && Object.keys(payload).length ? payload : row.rawBody || null
  };
}

export async function handleListWebhookAlerts(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const parsed = querySchema.parse(req.query || {});
    const executionResult = await listExecutionAuditsForUser({
      userId: req.user.id,
      limit: parsed.limit || parsed.pageSize || 50,
      page: parsed.page || 1,
      since: parsed.since ? new Date(parsed.since) : undefined,
      until: parsed.until ? new Date(parsed.until) : undefined,
      q: parsed.q
    });
    if (executionResult.rows.length > 0) {
      const items = executionResult.rows.map(toExecutionAlertRow);
      return res.json({
        items,
        total: executionResult.total,
        page: executionResult.page,
        pageSize: executionResult.pageSize
      });
    }

    // Backward compatibility for older records before execution audit ledger.
    const legacyResult = await listAudit({
      userId: req.user.id,
      action: 'webhook.received',
      limit: parsed.limit || parsed.pageSize || 50,
      page: parsed.page || 1,
      since: parsed.since ? new Date(parsed.since) : undefined,
      until: parsed.until ? new Date(parsed.until) : undefined,
      q: parsed.q
    });
    const items = legacyResult.rows.map(toLegacyAlertRow);
    return res.json({ items, total: legacyResult.total, page: legacyResult.page, pageSize: legacyResult.pageSize });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleDeleteWebhookAlerts(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const [auditResult, tradingviewResult, executionResult] = await Promise.all([
      deleteAudit({ userId: req.user.id, action: 'webhook.received' }),
      deleteTradingviewAlerts({ userId: req.user.id }),
      deleteExecutionAuditsForUser(req.user.id)
    ]);
    res.json({
      deleted: auditResult?.count || 0,
      tradingviewDeleted: tradingviewResult?.count || 0,
      executionDeleted: executionResult?.count || 0
    });
  } catch (error) {
    next(error);
  }
}
