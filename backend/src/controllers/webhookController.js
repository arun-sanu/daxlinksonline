import { z } from 'zod';
import { listWebhooks, createWebhook, toggleWebhook } from '../services/webhookService.js';
import { recordAudit } from '../services/auditService.js';

function requireDev(req, res) {
  const role = String(req?.user?.role || '').toLowerCase();
  if (!['admin', 'developer'].includes(role)) {
    res.status(403).json({ error: 'Dev-only' });
    return false;
  }
  return true;
}

const workspaceIdParam = z.object({ workspaceId: z.string().uuid() });
const webhookIdParam = z.object({ workspaceId: z.string().uuid(), webhookId: z.string().uuid() });

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
    if (!requireDev(req, res)) return;
    const { workspaceId } = workspaceIdParam.parse(req.params);
    const webhooks = await listWebhooks(workspaceId);
    res.json(webhooks);
  } catch (error) {
    next(error);
  }
}

export async function handleCreateWebhook(req, res, next) {
  try {
    if (!requireDev(req, res)) return;
    const { workspaceId } = workspaceIdParam.parse(req.params);
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
    if (!requireDev(req, res)) return;
    const { workspaceId, webhookId } = webhookIdParam.parse(req.params);
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
