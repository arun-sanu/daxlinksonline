import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { listWebhooks, createWebhook, toggleWebhook, toggleWebhooks } from '../services/webhookService.js';
import { recordAudit } from '../services/auditService.js';

async function requireWorkspaceAccess(req, res, workspaceId) {
  if (!req.user?.id) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  const role = String(req.user.role || '').toLowerCase();
  if (req.user.isSuperAdmin || ['admin', 'developer', 'engineer', 'designer'].includes(role)) {
    return true;
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true }
  });
  if (workspace?.ownerId && workspace.ownerId === req.user.id) {
    return true;
  }
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

const workspaceIdParam = z.object({ workspaceId: z.string().uuid() });
const webhookIdParam = z.object({ workspaceId: z.string().uuid(), webhookId: z.string().uuid() });
const toggleManySchema = z.object({
  webhookIds: z.array(z.string().uuid()).min(1),
  active: z.boolean()
});

const createWebhookSchema = z.object({
  name: z.string().min(2),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('POST'),
  signingSecret: z.string().optional(),
  events: z.array(z.string()).optional(),
  event: z.string().optional(),
  active: z.boolean().optional()
});

export async function handleListWebhooks(req, res, next) {
  try {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    if (!(await requireWorkspaceAccess(req, res, workspaceId))) return;
    const webhooks = await listWebhooks(workspaceId);
    res.json(webhooks);
  } catch (error) {
    next(error);
  }
}

export async function handleCreateWebhook(req, res, next) {
  try {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    if (!(await requireWorkspaceAccess(req, res, workspaceId))) return;
    const payload = createWebhookSchema.parse(req.body);
    const webhook = await createWebhook(workspaceId, payload);
    try {
      await recordAudit({ userId: req.user.id, action: 'webhook.create', entityType: 'Webhook', entityId: webhook.id, summary: webhook.name });
    } catch {}
    res.status(201).json(webhook);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function handleToggleWebhook(req, res, next) {
  try {
    const { workspaceId, webhookId } = webhookIdParam.parse(req.params);
    if (!(await requireWorkspaceAccess(req, res, workspaceId))) return;
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const webhook = await toggleWebhook(workspaceId, webhookId, active);
    try {
      await recordAudit({ userId: req.user.id, action: 'webhook.toggle', entityType: 'Webhook', entityId: webhookId, summary: active ? 'enabled' : 'disabled' });
    } catch {}
    res.json(webhook);
  } catch (error) {
    next(error);
  }
}

export async function handleToggleWebhooks(req, res, next) {
  try {
    const { workspaceId } = workspaceIdParam.parse(req.params);
    if (!(await requireWorkspaceAccess(req, res, workspaceId))) return;
    const { webhookIds, active } = toggleManySchema.parse(req.body);
    const result = await toggleWebhooks(workspaceId, webhookIds, active);
    try {
      await recordAudit({
        userId: req.user.id,
        action: 'webhook.toggle.batch',
        entityType: 'Webhook',
        entityId: workspaceId,
        summary: `${active ? 'enabled' : 'disabled'} ${result.updated} webhook(s)`
      });
    } catch {}
    res.json({ updated: result.updated });
  } catch (error) {
    next(error);
  }
}
