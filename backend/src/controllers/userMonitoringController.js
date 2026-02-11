import { z } from 'zod';
import { deleteAudit, listAudit } from '../services/auditService.js';
import { deleteTradingviewAlerts } from '../services/tradingviewAlertsService.js';

const querySchema = z.object({
  page: z.preprocess((val) => Number(val || 1), z.number().int().positive()).optional(),
  pageSize: z.preprocess((val) => Number(val || 50), z.number().int().positive().max(200)).optional(),
  limit: z.preprocess((val) => Number(val || 50), z.number().int().positive().max(200)).optional(),
  since: z.string().datetime().optional(),
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

function toAlertRow(row) {
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

export async function handleListWebhookAlerts(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const parsed = querySchema.parse(req.query || {});
    const result = await listAudit({
      userId: req.user.id,
      action: 'webhook.received',
      limit: parsed.limit || parsed.pageSize || 50,
      page: parsed.page || 1,
      since: parsed.since ? new Date(parsed.since) : undefined,
      q: parsed.q
    });
    const items = result.rows.map(toAlertRow);
    res.json({ items, total: result.total, page: result.page, pageSize: result.pageSize });
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
    const [auditResult, tradingviewResult] = await Promise.all([
      deleteAudit({ userId: req.user.id, action: 'webhook.received' }),
      deleteTradingviewAlerts({ userId: req.user.id })
    ]);
    res.json({
      deleted: auditResult?.count || 0,
      tradingviewDeleted: tradingviewResult?.count || 0
    });
  } catch (error) {
    next(error);
  }
}
