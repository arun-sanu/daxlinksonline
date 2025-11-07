import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { getFlags, setFlag, evaluateFlag } from '../services/flagsService.js';
import { listDatabases, rotateDatabaseCredentials } from '../services/databaseService.js';
import { toggleWebhook } from '../services/webhookService.js';
import { recordAudit, listAudit } from '../services/auditService.js';
import { dispatchToWebhook, dispatchWorkspaceEvent } from '../services/webhookDispatcher.js';

export async function handleQueuesSummary(_req, res) {
  // Basic metrics using WebhookDelivery failures as DLQ approximation
  const failed = await prisma.webhookDelivery.count({ where: { status: 'failed' } });
  const queued = await prisma.webhookDelivery.count({ where: { status: 'queued' } });
  res.json({
    workers: 3,
    dlq: failed,
    queues: [
      { name: 'emails', depth: 0, retries: 0 },
      { name: 'webhooks', depth: queued, retries: failed },
      { name: 'integrations', depth: 0, retries: 0 }
    ]
  });
}

export async function handleListFlags(_req, res, next) {
  try {
    const rows = await getFlags();
    res.json(rows);
  } catch (err) { next(err); }
}

const updateFlagSchema = z.object({
  enabled: z.boolean().optional(),
  description: z.string().optional(),
  audience: z.any().optional(),
  rolloutPercent: z.number().min(0).max(100).optional(),
  rules: z.any().optional()
});

export async function handleUpdateFlag(req, res, next) {
  try {
    const { key } = req.params;
    const body = updateFlagSchema.parse(req.body || {});
    const row = await setFlag(key, body);
    await recordAudit({ userId: req.user.id, action: 'flag.update', entityType: 'FeatureFlag', entityId: key, summary: `Set ${key}=${row.enabled}` });
    res.json(row);
  } catch (err) {
    if (err instanceof z.ZodError) err.status = 400;
    next(err);
  }
}

export async function handleListAudit(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || Number(req.query.pageSize) || 50, 200));
    const action = req.query.action || undefined;
    const userId = req.query.userId || undefined;
    const q = req.query.q || undefined;
    const since = req.query.from ? new Date(String(req.query.from)) : undefined;
    const until = req.query.to ? new Date(String(req.query.to)) : undefined;
    const result = await listAudit({ page, limit, action, userId, q, since, until });
    res.json(result);
  } catch (err) { next(err); }
}

const replayParams = z.object({ workspaceId: z.string().uuid(), webhookId: z.string().uuid() });

export async function handleReplayWebhook(req, res, next) {
  try {
    const { workspaceId, webhookId } = replayParams.parse(req.params);
    const webhook = await prisma.webhook.findFirst({ where: { id: webhookId, workspaceId } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    const payload = { id: `test_${Date.now()}`, event: 'admin.replay.test', data: { note: 'Manual replay from admin console' } };
    const { status, responseCode, lastError, responseBody, responseHeaders } = await dispatchToWebhook({ workspaceId, webhook, payload, timeoutMs: 8000 });
    await recordAudit({ userId: req.user.id, action: 'webhook.replay', entityType: 'Webhook', entityId: webhookId, summary: `${status} ${responseCode || ''} -> ${webhook.url}` });
    res.json({ status, responseCode, lastError, responseBody, responseHeaders });
  } catch (err) { next(err); }
}

export async function handleBulkRotateDatabases(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const dbs = await listDatabases();
    const results = [];
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : '';
    for (const db of dbs) {
      const updated = await rotateDatabaseCredentials(db.id);
      results.push({ id: db.id, name: db.name, rotated: true });
      try { await recordAudit({ userId: req.user.id, action: 'db.rotate', entityType: 'DatabaseInstance', entityId: db.id, summary: reason ? `${db.name} — ${reason}` : db.name }); } catch {}
    }
    res.json({ count: results.length, results });
  } catch (err) { next(err); }
}

export async function handleBulkToggleWebhooks(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const action = String(req.query.action || '').toLowerCase();
    const active = action === 'enable' ? true : action === 'disable' ? false : null;
    if (active === null) return res.status(400).json({ error: 'Query param action must be enable|disable' });
    const hooks = await prisma.webhook.findMany({ where: { workspaceId } });
    const reason = (req.body && req.body.reason) ? String(req.body.reason) : '';
    let count = 0;
    for (const h of hooks) {
      if (h.active !== active) {
        await toggleWebhook(workspaceId, h.id, active);
        count++;
        try { await recordAudit({ userId: req.user.id, action: 'webhook.toggle', entityType: 'Webhook', entityId: h.id, summary: reason ? `${active ? 'enabled' : 'disabled'} — ${reason}` : (active ? 'enabled' : 'disabled') }); } catch {}
      }
    }
    res.json({ updated: count });
  } catch (err) { next(err); }
}

export async function handleListDeliveries(req, res, next) {
  try {
    const ws = req.query.workspaceId;
    const webhookId = req.query.webhookId;
    const status = req.query.status || undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || Number(req.query.pageSize) || 50, 200));
    const skip = (page - 1) * limit;
    const sortKey = (req.query.sortKey || 'createdAt').toString();
    const sortDir = (req.query.sortDir || 'desc').toString().toLowerCase() === 'asc' ? 'asc' : 'desc';
    const allowedSort = new Set(['createdAt','status','responseCode','responseTimeMs','attempts']);
    const where = {};
    if (ws) where.workspaceId = String(ws);
    if (webhookId) where.webhookId = String(webhookId);
    if (status) where.status = String(status);
    // Optional time window
    const windowHours = req.query.windowHours ? Math.max(1, Math.min(Number(req.query.windowHours) || 0, 168)) : null;
    if (windowHours) {
      const since = new Date(Date.now() - windowHours * 3600 * 1000);
      where.createdAt = { gte: since };
    }
    // Optional numeric filters
    const rcMin = req.query.responseCodeMin ? Number(req.query.responseCodeMin) : null;
    const rcMax = req.query.responseCodeMax ? Number(req.query.responseCodeMax) : null;
    const rtMin = req.query.responseTimeMin ? Number(req.query.responseTimeMin) : null;
    const rtMax = req.query.responseTimeMax ? Number(req.query.responseTimeMax) : null;
    if (rcMin != null || rcMax != null) {
      where.responseCode = {};
      if (rcMin != null) where.responseCode.gte = rcMin;
      if (rcMax != null) where.responseCode.lte = rcMax;
    }
    if (rtMin != null || rtMax != null) {
      where.responseTimeMs = {};
      if (rtMin != null) where.responseTimeMs.gte = rtMin;
      if (rtMax != null) where.responseTimeMs.lte = rtMax;
    }
    // Optional text search
    const q = req.query.q ? String(req.query.q) : null;
    if (q) {
      where.OR = [
        { lastError: { contains: q, mode: 'insensitive' } },
        { responseBody: { contains: q, mode: 'insensitive' } }
      ];
    }
    const orderBy = allowedSort.has(sortKey) ? { [sortKey]: sortDir } : { createdAt: 'desc' };
    const [rows, total] = await Promise.all([
      prisma.webhookDelivery.findMany({ where, orderBy, take: limit, skip }),
      prisma.webhookDelivery.count({ where })
    ]);
    res.json({ rows, total, page, pageSize: limit });
  } catch (err) { next(err); }
}

export async function handleDeliveryStats(req, res, next) {
  try {
    const ws = req.query.workspaceId ? String(req.query.workspaceId) : undefined;
    const webhookId = req.query.webhookId ? String(req.query.webhookId) : undefined;
    const hours = Math.max(1, Math.min(Number(req.query.windowHours) || 24, 168));
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const where = { createdAt: { gte: since } };
    if (ws) where.workspaceId = ws;
    if (webhookId) where.webhookId = webhookId;
    // cap to 1000 for perf
    const rows = await prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, take: 2000 });
    const total = rows.length;
    const failed = rows.filter(r => r.status === 'failed').length;
    const times = rows.map(r => r.responseTimeMs || 0).filter(n => typeof n === 'number');
    times.sort((a,b) => a-b);
    const p = (p) => {
      if (!times.length) return null;
      const idx = Math.min(times.length - 1, Math.floor((p/100) * times.length));
      return times[idx];
    };
    const p50 = p(50);
    const p95 = p(95);
    // Build hourly series
    const seriesMap = new Map();
    for (let i = 0; i < hours; i++) {
      const t = new Date(since.getTime() + i * 3600 * 1000);
      const key = t.toISOString().slice(0, 13) + ':00:00Z';
      seriesMap.set(key, []);
    }
    for (const r of rows) {
      const t = new Date(r.createdAt);
      const hour = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours(), 0, 0)).toISOString();
      if (!seriesMap.has(hour)) seriesMap.set(hour, []);
      seriesMap.get(hour).push(r);
    }
    const timestamps = Array.from(seriesMap.keys()).sort();
    const series = timestamps.map((ts) => {
      const arr = seriesMap.get(ts) || [];
      const timesArr = arr.map(r => r.responseTimeMs || 0).sort((a,b)=>a-b);
      const q = (p) => {
        if (!timesArr.length) return null;
        const idx = Math.min(timesArr.length - 1, Math.floor((p/100) * timesArr.length));
        return timesArr[idx];
      };
      const ok = arr.filter(r => r.status === 'sent' && (r.responseCode == null || (r.responseCode >= 200 && r.responseCode < 400))).length;
      const cnt = arr.length;
      const rate = cnt ? ok / cnt : null;
      return { t: ts, p50: q(50), p95: q(95), count: cnt, ok, rate };
    });
    const histogram = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
    for (const r of rows) {
      const c = r.responseCode;
      if (typeof c !== 'number') { histogram.other++; continue; }
      if (c >= 200 && c < 300) histogram['2xx']++;
      else if (c >= 300 && c < 400) histogram['3xx']++;
      else if (c >= 400 && c < 500) histogram['4xx']++;
      else if (c >= 500 && c < 600) histogram['5xx']++;
      else histogram.other++;
    }
    res.json({ count: total, failed, windowHours: hours, p50, p95, series, histogram });
  } catch (err) { next(err); }
}

export async function handleSendTestEvent(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const event = (req.body && req.body.event) ? String(req.body.event) : 'admin.test';
    const note = (req.body && req.body.note) ? String(req.body.note) : 'Manual test dispatch';
    const result = await dispatchWorkspaceEvent({ workspaceId, event, data: { note } });
    await recordAudit({ userId: req.user.id, action: 'webhook.test_event', entityType: 'Workspace', entityId: workspaceId, summary: `${event} to ${result.count} webhooks` });
    res.json(result);
  } catch (err) { next(err); }
}

export async function handleEvaluateFlag(req, res, next) {
  try {
    const { key } = req.params;
    const userId = req.query.userId ? String(req.query.userId) : undefined;
    const workspaceId = req.query.workspaceId ? String(req.query.workspaceId) : undefined;
    const result = await evaluateFlag(key, { userId, workspaceId });
    res.json(result);
  } catch (err) { next(err); }
}

export async function handleRetryDelivery(req, res, next) {
  try {
    const { deliveryId } = req.params;
    const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    const webhook = await prisma.webhook.findFirst({ where: { id: delivery.webhookId, workspaceId: delivery.workspaceId } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    const { status, responseCode, lastError, responseBody } = await dispatchToWebhook({ workspaceId: delivery.workspaceId, webhook, payload: delivery.payload, timeoutMs: 8000 });
    await recordAudit({ userId: req.user.id, action: 'webhook.retry_delivery', entityType: 'WebhookDelivery', entityId: deliveryId, summary: `${status} ${responseCode || ''}` });
    res.json({ status, responseCode, lastError, responseBody });
  } catch (err) { next(err); }
}

export async function handleRetryFailedForWebhook(req, res, next) {
  try {
    const { workspaceId, webhookId } = req.params;
    const webhook = await prisma.webhook.findFirst({ where: { id: webhookId, workspaceId } });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
    const failed = await prisma.webhookDelivery.findMany({ where: { workspaceId, webhookId, status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 50 });
    let count = 0;
    for (const d of failed) {
      await dispatchToWebhook({ workspaceId, webhook, payload: d.payload, timeoutMs: 8000 });
      count++;
    }
    await recordAudit({ userId: req.user.id, action: 'webhook.retry_failed', entityType: 'Webhook', entityId: webhookId, summary: `Retried ${count}` });
    res.json({ retried: count });
  } catch (err) { next(err); }
}

export async function handleRetryFailedForWorkspace(req, res, next) {
  try {
    const { workspaceId } = req.params;
    const hooks = await prisma.webhook.findMany({ where: { workspaceId } });
    let count = 0;
    for (const h of hooks) {
      const failed = await prisma.webhookDelivery.findMany({ where: { workspaceId, webhookId: h.id, status: 'failed' }, orderBy: { createdAt: 'desc' }, take: 100 });
      for (const d of failed) {
        await dispatchToWebhook({ workspaceId, webhook: h, payload: d.payload, timeoutMs: 8000 });
        count++;
      }
    }
    await recordAudit({ userId: req.user.id, action: 'webhook.retry_failed_workspace', entityType: 'Workspace', entityId: workspaceId, summary: `Retried ${count}` });
    res.json({ retried: count });
  } catch (err) { next(err); }
}
