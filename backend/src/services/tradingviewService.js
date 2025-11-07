import { prisma } from '../utils/prisma.js';

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export function generateWebhookSubdomain(userId) {
  const short = userId.replace(/-/g, '').slice(0, 8);
  const rand = [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${short}-${rand}`;
}

export function generateSecret() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ensureTrialWebhook(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.webhookSubdomain && user.webhookSecret && user.trialEndsAt) return user;

  const subdomain = generateWebhookSubdomain(userId);
  const secret = generateSecret();
  const trialEndsAt = nowPlusDays(28);
  return prisma.user.update({
    where: { id: userId },
    data: { webhookSubdomain: subdomain, webhookSecret: secret, trialEndsAt }
  });
}

import { initQueue, enqueue } from '../jobs/queue.js';
import { processForwardJob } from '../jobs/forwarder.js';

let queueReady = false;

function ensureQueue() {
  if (queueReady) return;
  initQueue({ queueName: 'pendax-forwarder', processor: processForwardJob });
  queueReady = true;
}

function sanitize(obj) {
  try {
    const copy = typeof obj === 'object' && obj !== null ? JSON.parse(JSON.stringify(obj)) : obj;
    if (copy && typeof copy === 'object') {
      if (Object.prototype.hasOwnProperty.call(copy, 'secret')) {
        copy.secret = '[redacted]';
      }
    }
    return copy;
  } catch {
    return {};
  }
}

export async function forward(userId, payload) {
  ensureQueue();
  // Enqueue job for fire-and-forget processing
  await enqueue('forward-alert', { userId, payload: sanitize(payload) }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  // Record receipt
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'webhook.received',
      entityType: 'TradingView',
      summary: 'Inbound alert received',
      detail: sanitize(payload) || {}
    }
  });
}
