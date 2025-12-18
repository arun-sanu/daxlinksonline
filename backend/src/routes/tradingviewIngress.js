import express, { Router } from 'express';
import { perSubdomainRateLimit } from '../middleware/rateLimit.js';
import { tradingViewIpWhitelist } from '../middleware/ipWhitelist.js';
import { createTradingviewWebhookHandler } from '../controllers/tradingviewWebhookController.js';

export const tradingviewIngressRouter = Router();

const rawParser = express.raw({ type: '*/*', limit: '1mb' });

function decodeTradingviewPayload(req, _res, next) {
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  req.rawBody = buffer;
  if (!buffer.length) {
    req.body = {};
    return next();
  }
  const text = buffer.toString('utf8');
  const trimmed = text.trim();
  if (!trimmed) {
    req.body = {};
    return next();
  }
  try {
    req.body = JSON.parse(trimmed);
  } catch {
    req.body = { message: text };
  }
  next();
}

const tradingviewHandler = createTradingviewWebhookHandler({
  requireQuerySecret: true,
  allowBodySecret: false
});

tradingviewIngressRouter.post(
  '/webhook/tradingview',
  rawParser,
  decodeTradingviewPayload,
  tradingViewIpWhitelist(),
  perSubdomainRateLimit({ maxPerSecond: 20 }),
  tradingviewHandler
);
