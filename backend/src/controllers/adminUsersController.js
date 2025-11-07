import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { recordAudit } from '../services/auditService.js';

export async function handleListUsers(_req, res, next) {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isSuperAdmin: true, createdAt: true }
    });
    res.json(users);
  } catch (err) { next(err); }
}

const updateSchema = z.object({
  role: z.string().min(3).max(32).optional(),
  isSuperAdmin: z.boolean().optional()
});

export async function handleUpdateUser(req, res, next) {
  try {
    const { userId } = req.params;
    const body = updateSchema.parse(req.body || {});
    const updated = await prisma.user.update({ where: { id: userId }, data: body });
    await recordAudit({ userId: req.user.id, action: 'user.update', entityType: 'User', entityId: userId, summary: `role=${updated.role} super=${updated.isSuperAdmin}` });
    res.json({ id: updated.id, role: updated.role, isSuperAdmin: updated.isSuperAdmin });
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}

