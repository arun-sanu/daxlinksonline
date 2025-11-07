import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getAllowedIps } from '../../lib/tradingviewIps.js';

export const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/ips', (_req, res) => {
  const items = getAllowedIps();
  res.json({ items, count: items.length, source: {
    env: Boolean(process.env.TRADINGVIEW_IPS),
    file: process.env.TRADINGVIEW_IPS_FILE || null,
    url: process.env.TRADINGVIEW_IPS_URL || null
  }});
});

