import { prisma } from '../utils/prisma.js';
import { createCredentialReference } from './workspaceService.js';

export async function listWebhooks(workspaceId) {
  return prisma.webhook.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' }
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
