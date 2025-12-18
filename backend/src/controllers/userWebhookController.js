import { z } from 'zod';

import { assignUserWebhook, forward } from '../services/tradingviewService.js';
import { buildTradingviewWebhookUrl, getWebhookBaseDomain } from '../lib/webhookDomains.js';
import { prisma } from '../utils/prisma.js';

const assignSchema = z
  .object({
    preferredPrefix: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9-]+$/i, 'Prefix can only include letters, numbers, and hyphens')
      .optional(),
    rotateSecret: z.boolean().optional(),
    regeneratePrefix: z.boolean().optional(),
    rotateHmacKey: z.boolean().optional()
  })
  .optional();

const testWebhookSchema = z
  .object({
    payload: z.record(z.any()).optional()
  })
  .optional();

function formatWebhookResponse(user) {
  if (!user) return null;
  const prefix = user.subdomainPrefix || user.webhookSubdomain || null;
  const secret = user.webhookSecret || null;
  const url = prefix && secret ? buildTradingviewWebhookUrl(prefix, secret) : null;
  return {
    prefix,
    url,
    webhookUrl: url,
    secret,
    hmacKey: user.webhookHmacKey || null,
    enforceHmac: Boolean(user.enforceHmac),
    baseDomain: getWebhookBaseDomain()
  };
}

export async function handleAssignWebhook(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = assignSchema.parse(req.body || {}) || {};
    const updated = await assignUserWebhook({
      userId: req.user.id,
      preferredPrefix: payload.preferredPrefix,
      rotateSecret: payload.rotateSecret ?? false,
      regeneratePrefix: payload.regeneratePrefix ?? false,
      rotateHmacKey: payload.rotateHmacKey ?? false,
      enforceHmac: true
    });
    res.json(formatWebhookResponse(updated));
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function handleGetWebhook(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        subdomainPrefix: true,
        webhookSubdomain: true,
        webhookSecret: true,
        webhookHmacKey: true,
        enforceHmac: true
      }
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(formatWebhookResponse(user));
  } catch (error) {
    next(error);
  }
}

export async function handleTestWebhook(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const body = testWebhookSchema.parse(req.body || {}) || {};
    const samplePayload =
      body.payload && typeof body.payload === 'object'
        ? body.payload
        : {
            message: 'Pendax test alert',
            symbol: 'NIFTY',
            side: 'BUY',
            timestamp: new Date().toISOString(),
            source: 'user.test'
          };
    await forward(req.user.id, { ...samplePayload, test: true, source: 'user.test' });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}
