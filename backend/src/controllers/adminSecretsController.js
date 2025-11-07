import { z } from 'zod';
import { listSecrets, createSecret, deleteSecret, rotateSecret } from '../services/secretsService.js';
import { recordAudit } from '../services/auditService.js';

export async function handleListSecrets(req, res, next) {
  try {
    const workspaceId = req.query.workspaceId || undefined;
    const rows = await listSecrets({ workspaceId });
    res.json(rows);
  } catch (err) { next(err); }
}

const createSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  key: z.string().min(2),
  value: z.string().min(1)
});

export async function handleCreateSecret(req, res, next) {
  try {
    const { workspaceId, key, value } = createSchema.parse(req.body || {});
    const row = await createSecret({ workspaceId: workspaceId || null, key, value, createdBy: req.user.id });
    await recordAudit({ userId: req.user.id, action: 'secret.create', entityType: 'Secret', entityId: row.id, summary: key });
    res.status(201).json(row);
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}

export async function handleDeleteSecret(req, res, next) {
  try {
    const { secretId } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    await deleteSecret(secretId);
    await recordAudit({ userId: req.user.id, action: 'secret.delete', entityType: 'Secret', entityId: secretId, summary: reason ? `reason: ${reason}` : undefined });
    res.json({ success: true });
  } catch (err) { next(err); }
}

const rotateSchema = z.object({ newValue: z.string().min(1) });

export async function handleRotateSecret(req, res, next) {
  try {
    const { secretId } = req.params;
    const parsed = rotateSchema.parse(req.body || {});
    const { newValue } = parsed;
    const row = await rotateSecret(secretId, { newValue });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    await recordAudit({ userId: req.user.id, action: 'secret.rotate', entityType: 'Secret', entityId: secretId, summary: reason ? `reason: ${reason}` : undefined });
    res.json(row);
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}

const revealSchema = z.object({ reason: z.string().min(3) });

export async function handleRevealSecret(req, res, next) {
  try {
    const { secretId } = req.params;
    const { reason } = revealSchema.parse(req.body || {});
    const row = await req.app.get('prisma')?.secret?.findUnique?.({ where: { id: secretId }, select: { valueBlob: true } })
      || await (await import('../utils/prisma.js')).prisma.secret.findUnique({ where: { id: secretId }, select: { valueBlob: true } });
    if (!row) {
      const e = new Error('Secret not found');
      e.status = 404;
      throw e;
    }
    const value = row.valueBlob ? Buffer.from(row.valueBlob).toString('utf8') : '';
    await recordAudit({ userId: req.user.id, action: 'secret.reveal', entityType: 'Secret', entityId: secretId, summary: `reason: ${reason}` });
    res.json({ value });
  } catch (err) { if (err instanceof z.ZodError) err.status = 400; next(err); }
}
