import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { isSubdomainAvailable, registerCustomDns, listMyDns, deleteDnsForUser } from '../../services/dnsService.js';

export const router = Router();

router.get('/available/:name', async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const ok = await isSubdomainAvailable(name);
    res.json({ name, available: ok });
  } catch (error) {
    next(error);
  }
});

router.post('/register', requireAuth, async (req, res, next) => {
  try {
    const { subdomain, ip } = z.object({
      subdomain: z.string(),
      ip: z.string()
    }).parse(req.body || {});
    const result = await registerCustomDns({ userId: req.user.id, subdomain, ip });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const records = await listMyDns({ userId: req.user.id });
    res.json({ items: records });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const result = await deleteDnsForUser({ id, userId: req.user.id });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
