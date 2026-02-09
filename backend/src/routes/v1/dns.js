import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { isSubdomainAvailable, registerCustomDns, listMyDns, deleteDnsForUser } from '../../services/dnsService.js';

export const router = Router();

const registerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/available/:name', async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const result = await isSubdomainAvailable(name);
    res.json({ name: result.name || name, available: result.available, reason: result.reason || null });
  } catch (error) {
    next(error);
  }
});

router.post('/register', requireAuth, registerLimiter, async (req, res, next) => {
  try {
    const { name, subdomain, ip } = z
      .object({
        name: z.string().min(1).optional(),
        subdomain: z.string().min(1).optional(),
        ip: z.string()
      })
      .superRefine((data, ctx) => {
        if (!data.name && !data.subdomain) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Subdomain required',
            path: ['subdomain']
          });
        }
      })
      .parse(req.body || {});
    const requested = name || subdomain;
    const result = await registerCustomDns({ userId: req.user.id, subdomain: requested, ip });
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
