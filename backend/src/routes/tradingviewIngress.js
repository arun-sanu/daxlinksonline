import { Router } from 'express';
import { perSubdomainRateLimit } from '../middleware/rateLimit.js';
import { tradingViewIpWhitelist } from '../middleware/ipWhitelist.js';
import { createTradingviewWebhookHandler } from '../controllers/tradingviewWebhookController.js';
import { tradingviewBodyMiddleware } from '../middleware/tradingviewBody.js';

export const tradingviewIngressRouter = Router();

const tradingviewHandler = createTradingviewWebhookHandler({
  requireQuerySecret: true,
  allowBodySecret: false
});

tradingviewIngressRouter.post(
  '/webhook/tradingview',
  ...tradingviewBodyMiddleware,
  tradingViewIpWhitelist(),
  perSubdomainRateLimit({ maxPerSecond: 20 }),
  tradingviewHandler
);
