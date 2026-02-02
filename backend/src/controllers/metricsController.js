import { prisma } from '../utils/prisma.js';

const WINDOW_MINUTES = 30;

function createBuckets(now, minutes) {
  const start = new Date(now.getTime() - minutes * 60 * 1000);
  const buckets = [];
  for (let i = 0; i < minutes; i += 1) {
    buckets.push({ ts: new Date(start.getTime() + i * 60 * 1000).toISOString(), value: 0, count: 0 });
  }
  return { start, buckets };
}

function bucketIndex(start, date) {
  const diffMs = date.getTime() - start.getTime();
  if (diffMs < 0) return -1;
  const idx = Math.floor(diffMs / (60 * 1000));
  return idx;
}

export async function handleMonitoringMetrics(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const now = new Date();
    const { start, buckets: throughputBuckets } = createBuckets(now, WINDOW_MINUTES);
    const { buckets: errorBuckets } = createBuckets(now, WINDOW_MINUTES);
    const { buckets: latencyBuckets } = createBuckets(now, WINDOW_MINUTES);

    const workspaces = await prisma.workspace.findMany({
      where: { ownerId: req.user.id },
      select: { id: true }
    });
    const workspaceIds = workspaces.map((w) => w.id);

    const [alerts, deliveries, queuedCount] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          userId: req.user.id,
          action: 'webhook.received',
          createdAt: { gte: start }
        },
        select: { createdAt: true }
      }),
      prisma.webhookDelivery.findMany({
        where: {
          workspaceId: workspaceIds.length ? { in: workspaceIds } : undefined,
          createdAt: { gte: start }
        },
        select: { createdAt: true, status: true, responseTimeMs: true }
      }),
      prisma.webhookDelivery.count({
        where: {
          workspaceId: workspaceIds.length ? { in: workspaceIds } : undefined,
          status: 'queued'
        }
      })
    ]);

    for (const row of alerts) {
      const idx = bucketIndex(start, row.createdAt);
      if (idx >= 0 && idx < throughputBuckets.length) throughputBuckets[idx].value += 1;
    }

    for (const row of deliveries) {
      const idx = bucketIndex(start, row.createdAt);
      if (idx < 0 || idx >= errorBuckets.length) continue;
      if (row.status === 'failed') errorBuckets[idx].value += 1;
      if (Number.isFinite(row.responseTimeMs)) {
        latencyBuckets[idx].value += row.responseTimeMs || 0;
        latencyBuckets[idx].count += 1;
      }
    }

    const latencySeries = latencyBuckets.map((b) => ({
      ts: b.ts,
      value: b.count ? Math.round(b.value / b.count) : 0
    }));

    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
    const recentAlerts = alerts.filter((a) => a.createdAt >= oneMinuteAgo).length;
    const recentDeliveries = deliveries.filter((d) => d.createdAt >= oneMinuteAgo);
    const recentFailures = recentDeliveries.filter((d) => d.status === 'failed').length;
    const recentLatency = recentDeliveries
      .filter((d) => Number.isFinite(d.responseTimeMs))
      .map((d) => d.responseTimeMs || 0);
    const latencyMs = recentLatency.length
      ? Math.round(recentLatency.reduce((sum, val) => sum + val, 0) / recentLatency.length)
      : null;
    const errorRate = recentDeliveries.length ? recentFailures / recentDeliveries.length : 0;

    res.json({
      now: now.toISOString(),
      windowMinutes: WINDOW_MINUTES,
      throughputPerMin: recentAlerts,
      queueDepth: queuedCount,
      errorRate,
      latencyMs,
      series: {
        throughput: throughputBuckets.map((b) => ({ ts: b.ts, value: b.value })),
        errors: errorBuckets.map((b) => ({ ts: b.ts, value: b.value })),
        latency: latencySeries
      }
    });
  } catch (err) {
    next(err);
  }
}
