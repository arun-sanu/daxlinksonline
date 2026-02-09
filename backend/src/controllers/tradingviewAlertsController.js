import { listTradingviewAlerts } from '../services/tradingviewAlertsService.js';

export async function handleListMyTradingviewAlerts(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || Number(req.query.pageSize) || 50;
    const status = req.query.status || undefined;
    const q = req.query.q || undefined;
    const result = await listTradingviewAlerts({ page, limit, userId: req.user.id, status, q });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function handleListTradingviewAlerts(req, res, next) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || Number(req.query.pageSize) || 50;
    const status = req.query.status || undefined;
    const q = req.query.q || undefined;
    const userId = req.query.userId || undefined;
    const result = await listTradingviewAlerts({ page, limit, userId, status, q });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
