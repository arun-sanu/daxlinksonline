import { prisma } from '../utils/prisma.js';

export async function recordAudit({ userId, action, entityType = null, entityId = null, summary = null, detail = null }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entityType, entityId, summary, detail }
    });
  } catch (err) {
    console.warn('[Audit] Failed to record audit log', err?.message || err);
  }
}

export async function listAudit({ limit = 50, page = 1, action, userId, q, since, until } = {}) {
  const take = Math.max(1, Math.min(limit, 200));
  const skip = Math.max(0, (Number(page) - 1) * take);
  const where = {};
  if (userId) where.userId = String(userId);
  if (action) where.action = { contains: String(action), mode: 'insensitive' };
  if (q) {
    where.OR = [
      { action: { contains: String(q), mode: 'insensitive' } },
      { summary: { contains: String(q), mode: 'insensitive' } }
    ];
  }
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = since;
    if (until) where.createdAt.lte = until;
  }
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.auditLog.count({ where })
  ]);
  return { rows, total, page, pageSize: take };
}
