import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';

const MIN_PREFIX_LENGTH = 3;
const MAX_PREFIX_LENGTH = 63;
const DEFAULT_HMAC_BYTES = 32;

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function normalizePrefix(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_PREFIX_LENGTH);
}

async function prefixExists(prefix, excludeUserId) {
  if (!prefix) return false;
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ subdomainPrefix: prefix }, { webhookSubdomain: prefix }],
      NOT: excludeUserId ? { id: excludeUserId } : undefined
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function generateUniquePrefix(seed, excludeUserId) {
  let base = normalizePrefix(seed);
  if (!base || base.length < MIN_PREFIX_LENGTH) {
    base = `tv-${crypto.randomBytes(2).toString('hex')}`;
  }
  let candidate = base;
  let attempts = 0;
  while (await prefixExists(candidate, excludeUserId)) {
    attempts += 1;
    const suffix = crypto.randomBytes(2).toString('hex');
    candidate = `${base}-${suffix}`.slice(0, MAX_PREFIX_LENGTH);
    if (attempts > 8) {
      base = crypto.randomBytes(4).toString('hex');
      candidate = base;
    }
  }
  return candidate;
}

export function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateHmacKey(bytes = DEFAULT_HMAC_BYTES) {
  return crypto.randomBytes(bytes).toString('hex');
}

export async function assignUserWebhook({
  userId,
  preferredPrefix,
  rotateSecret = false,
  regeneratePrefix = false,
  rotateHmacKey = false,
  enforceHmac
}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      subdomainPrefix: true,
      webhookSubdomain: true,
      webhookSecret: true,
      webhookHmacKey: true,
      isActive: true
    }
  });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.isActive === false) {
    throw Object.assign(new Error('Account inactive'), { status: 403 });
  }
  let prefix = user.subdomainPrefix || user.webhookSubdomain || null;
  const sanitizedPreferred = preferredPrefix ? normalizePrefix(preferredPrefix) : null;
  if (regeneratePrefix || !prefix) {
    const seed = sanitizedPreferred || user.name || user.email || user.id;
    prefix = await generateUniquePrefix(seed, user.id);
  } else if (sanitizedPreferred && sanitizedPreferred !== prefix) {
    if (await prefixExists(sanitizedPreferred, user.id)) {
      const err = new Error('Requested prefix already in use');
      err.status = 409;
      throw err;
    }
    prefix = sanitizedPreferred;
  }

  let secret = user.webhookSecret || null;
  if (rotateSecret || !secret) {
    secret = generateSecret();
  }

  let hmacKey = user.webhookHmacKey || null;
  if (rotateHmacKey || rotateSecret || !hmacKey) {
    hmacKey = generateHmacKey();
  }

  const update = {
    subdomainPrefix: prefix,
    webhookSubdomain: prefix,
    webhookSecret: secret,
    webhookHmacKey: hmacKey
  };
  if (typeof enforceHmac === 'boolean') {
    update.enforceHmac = enforceHmac;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: update
  });
}

export async function ensureTrialWebhook(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.subdomainPrefix && user.webhookSecret && user.webhookHmacKey && user.trialEndsAt) return user;

  const needsPrefix = !user.subdomainPrefix && !user.webhookSubdomain;
  const needsSecret = !user.webhookSecret;
  const needsHmac = !user.webhookHmacKey;
  let updated = user;

  if (needsPrefix || needsSecret || needsHmac) {
    updated = await assignUserWebhook({
      userId,
      regeneratePrefix: needsPrefix,
      rotateSecret: needsSecret,
      rotateHmacKey: needsHmac,
      enforceHmac: false
    });
  }

  if (!updated.trialEndsAt) {
    const trialEndsAt = nowPlusDays(28);
    updated = await prisma.user.update({
      where: { id: userId },
      data: { trialEndsAt }
    });
  }

  return updated;
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
