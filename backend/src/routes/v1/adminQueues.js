import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../../middleware/auth.js';
import { getQueueStats, listJobs, retryJob, removeJob, clean } from '../../services/queueService.js';

export const router = Router();

router.get('/stats', requireAdmin, async (_req, res, next) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (e) {
    next(e);
  }
});

router.get('/jobs', requireAdmin, async (req, res, next) => {
  try {
    const { state, start, end } = z
      .object({ state: z.string().optional(), start: z.coerce.number().optional(), end: z.coerce.number().optional() })
      .parse(req.query);
    const result = await listJobs({ state: state || 'failed', start: start ?? 0, end: end ?? 20 });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/jobs/:id/retry', requireAdmin, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const result = await retryJob(id);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.delete('/jobs/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const result = await removeJob(id);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/clean', requireAdmin, async (req, res, next) => {
  try {
    const { state, graceMs, limit } = z
      .object({ state: z.string().optional(), graceMs: z.coerce.number().optional(), limit: z.coerce.number().optional() })
      .parse(req.body || {});
    const result = await clean({ state: state || 'completed', graceMs: graceMs ?? 3600000, limit: limit ?? 1000 });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

