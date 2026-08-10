import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { perSubdomainRateLimit } from '../../middleware/rateLimit.js';
import { tradingViewIpWhitelist } from '../../middleware/ipWhitelist.js';
import { forward } from '../../services/tradingviewService.js';
import { requireAuth } from '../../middleware/auth.js';

export const router = Router();

function extractSubdomain(host) {
  const base = (process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link').toLowerCase();
  const clean = String(host || '').toLowerCase().split(':')[0];
  if (!clean.endsWith(base)) return null;
  const parts = clean.split('.');
  const baseParts = base.split('.');
  if (parts.length <= baseParts.length) return null;
  return parts.slice(0, parts.length - baseParts.length).join('.');
}

const payloadSchema = z.object({
  secret: z.string().optional()
}).passthrough();

router.post(
  '/webhook',
  tradingViewIpWhitelist(),
  perSubdomainRateLimit({ maxPerSecond: 20 }),
  async (req, res, next) => {
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const sub = extractSubdomain(host);
      if (!sub) return res.status(400).json({ error: 'Invalid host header' });

      const user = await prisma.user.findFirst({ where: { webhookSubdomain: sub } });
      if (!user) return res.status(404).json({ error: 'Not found' });
      if (user.isActive === false) return res.status(410).json({ error: 'Account inactive' });
      if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
        return res.status(410).json({ error: 'Trial expired' });
      }

      const payload = payloadSchema.parse(req.body || {});
      if (user.webhookSecret && payload.secret && payload.secret !== user.webhookSecret) {
        return res.status(401).json({ error: 'Invalid secret' });
      }

      // Fire-and-forget
      forward(user.id, payload).catch(() => {});
      return res.status(200).json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) error.status = 400;
      next(error);
    }
  }
);

// Authenticated test endpoint to simulate a webhook without DNS/subdomain
router.post('/webhook/test', requireAuth, async (req, res, next) => {
  try {
    const payload = payloadSchema.parse(req.body || {});
    await forward(req.user.id, { ...payload, test: true, source: 'ui' });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
});
