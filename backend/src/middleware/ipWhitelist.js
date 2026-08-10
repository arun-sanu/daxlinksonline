// IP whitelist middleware for webhook ingress
// Sources:
// - Env TRADINGVIEW_IPS (comma-separated)
// - Optional file via TRADINGVIEW_IPS_FILE (JSON array) managed by cron

import { isAllowedIp } from '../lib/tradingviewIps.js';

function extractClientIp(req) {
  // Trust first X-Forwarded-For (client) when behind proxies like Cloudflare/Workers
  const firstXff = (() => {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const head = xff.split(',')[0];
      return head && head.trim();
    }
    return null;
  })();
  return firstXff || req.ip || req.connection?.remoteAddress || '';
}

export function tradingViewIpWhitelist() {
  const allowAllInDev = process.env.NODE_ENV !== 'production' && !process.env.TRADINGVIEW_IPS && !process.env.TRADINGVIEW_IPS_FILE;
  return (req, res, next) => {
    if (allowAllInDev) return next();
    const ip = extractClientIp(req);
    if (isAllowedIp(ip)) return next();
    return res.status(403).json({ error: 'Forbidden: IP not allowed' });
  };
}
