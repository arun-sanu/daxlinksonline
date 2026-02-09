import { prisma } from '../utils/prisma.js';
import { createCredentialReference } from './workspaceService.js';

export async function listWebhooks(workspaceId) {
  const hooks = await prisma.webhook.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' }
  });
  if (!hooks.length) return [];
  const latestDeliveries = await prisma.webhookDelivery.findMany({
    where: { webhookId: { in: hooks.map((h) => h.id) } },
    orderBy: [{ webhookId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['webhookId']
  });
  const latestByWebhook = new Map(latestDeliveries.map((d) => [d.webhookId, d]));
  return hooks.map((hook) => {
    const latest = latestByWebhook.get(hook.id);
    return {
      ...hook,
      lastResponseCode: latest?.responseCode ?? null,
      lastError: latest?.lastError ?? null
    };
  });
}

export async function createWebhook(workspaceId, payload) {
  const secretRef = createCredentialReference(payload.signingSecret || '');
  return prisma.webhook.create({
    data: {
      workspaceId,
      name: payload.name,
      url: payload.url,
      method: payload.method || 'POST',
      signingSecretRef: secretRef ?? '',
      events: payload.events && payload.events.length ? payload.events : [payload.event].filter(Boolean),
      active: payload.active ?? true
    }
  });
}

export async function toggleWebhook(workspaceId, webhookId, active) {
  // Ensure the webhook belongs to the workspace before updating
  const existing = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!existing || existing.workspaceId !== workspaceId) {
    const err = new Error('Webhook not found');
    err.status = 404;
    throw err;
  }
  return prisma.webhook.update({ where: { id: webhookId }, data: { active } });
}

export async function toggleWebhooks(workspaceId, webhookIds, active) {
  if (!Array.isArray(webhookIds) || webhookIds.length === 0) {
    return { updated: 0 };
  }
  const result = await prisma.webhook.updateMany({
    where: { workspaceId, id: { in: webhookIds } },
    data: { active }
  });
  return { updated: result.count };
}
