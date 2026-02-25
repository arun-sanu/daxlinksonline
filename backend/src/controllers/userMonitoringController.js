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

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeOrderTypeToken(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  if (normalized === 'LIMIT') return 'LIMIT';
  if (normalized === 'LIMIT_MAKER' || normalized === 'POST_ONLY' || normalized === 'POSTONLY' || normalized === 'MAKER') {
    return 'LIMIT_MAKER';
  }
  if (normalized === 'MARKET') return 'MARKET';
  return null;
}

function hasLimitOrderHints(payload = {}) {
  if (!payload || typeof payload !== 'object') return false;
  const keys = ['limitPrice', 'limit_price', 'limitStyle', 'limit_style', 'slippageBps', 'slippage_bps'];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const value = payload[key];
    if (value !== null && value !== undefined && value !== '') return true;
  }
  return false;
}

function resolveAlertOrderType(payload = {}, sizingDebug = null) {
  const typeCandidates = [
    payload?.type,
    payload?.orderType,
    payload?.order_type,
    sizingDebug?.orderTypeResolved,
    sizingDebug?.runtimeOrderType
  ];
  for (const candidate of typeCandidates) {
    const normalized = normalizeOrderTypeToken(candidate);
    if (normalized) return normalized;
  }
  if (hasLimitOrderHints(payload)) return 'LIMIT';
  return 'MARKET';
}

function toLegacyAlertRow(row) {
  const payload = normalizePayload(row.detail);
  const orderType = resolveAlertOrderType(payload);
  return {
    id: row.id,
    receivedAt: row.createdAt,
    status: 'received',
    strategyName: payload?.strategy || payload?.strategyName || payload?.ruleName || '',
    symbol: payload?.symbol || payload?.ticker || '',
    side: payload?.side || payload?.direction || '',
    orderType,
    type: orderType,
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
  const sizingDebug = row?.sizingDebug && typeof row.sizingDebug === 'object' ? row.sizingDebug : null;
  const statusUpper = String(row.status || 'RECEIVED').toUpperCase();
  const tvTsNumber = row.tvTs !== null && row.tvTs !== undefined ? Number(row.tvTs) : null;
  const parsedTs = Number.isFinite(tvTsNumber) ? new Date(tvTsNumber).toISOString() : null;
  const parseFailed = statusUpper === 'RECEIVED' && (!symbol || !side);
  const status = parseFailed ? 'parse_failed' : statusUpper.toLowerCase();
  const errorMessage = row.errorMessage || (parseFailed ? 'PARSE_FAILED' : '');
  const type = resolveAlertOrderType(payload, sizingDebug);
  const computedQty = toFiniteNumber(
    row.qtyRounded ??
      row.qtyRaw ??
      sizingDebug?.qtyAfterStepRounding ??
      sizingDebug?.qtyRounded ??
      sizingDebug?.qtyRaw
  );
  const requestedQty = toFiniteNumber(
    payload.quantity ??
      payload.qty ??
      payload.amount ??
      payload.orderQty ??
      payload.order_qty ??
      payload.size
  );
  const shouldPreferRequestedQty =
    (status === 'rejected' || status === 'failed' || status === 'error') &&
    (computedQty === null || computedQty <= 0) &&
    requestedQty !== null &&
    requestedQty > 0;
  const quantity = shouldPreferRequestedQty ? requestedQty : (computedQty ?? requestedQty ?? '');

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
    quantity,
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
