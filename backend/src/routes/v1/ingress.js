import { Router } from 'express';
import { z } from 'zod';
import { perSubdomainRateLimit } from '../../middleware/rateLimit.js';
import { tradingViewIpWhitelist } from '../../middleware/ipWhitelist.js';
import { forward } from '../../services/tradingviewService.js';
import { requireAuth } from '../../middleware/auth.js';
import { createTradingviewWebhookHandler } from '../../controllers/tradingviewWebhookController.js';
import { tradingviewBodyMiddleware } from '../../middleware/tradingviewBody.js';

export const router = Router();

const testPayloadSchema = z.object({
  secret: z.string().optional()
}).passthrough();

const legacyWebhookHandler = createTradingviewWebhookHandler({
  requireQuerySecret: false,
  allowBodySecret: true
});

router.post(
  '/webhook',
  ...tradingviewBodyMiddleware,
  tradingViewIpWhitelist(),
  perSubdomainRateLimit({ maxPerSecond: 20 }),
  legacyWebhookHandler
);

// Authenticated test endpoint to simulate a webhook without DNS/subdomain
router.post('/webhook/test', requireAuth, async (req, res, next) => {
  try {
    const payload = testPayloadSchema.parse(req.body || {});
    await forward(req.user.id, { ...payload, test: true, source: 'ui' });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
});
