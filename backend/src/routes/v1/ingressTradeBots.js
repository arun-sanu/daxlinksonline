import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { isAllowedIp } from '../../lib/tradingviewIps.js';
import { queues } from '../../jobs/queues.js';
import { handleSignalJob } from '../../jobs/workers/signals.worker.js';
import { createWorkspaceRateLimiter } from '../../middleware/rateLimit.js';
import { verifyRequestSignature } from '../../lib/signature.js';
import { logSignatureEvent } from '../../lib/tradeGuards.js';

export const router = Router();

// Helpers
function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

const ingressParams = z.object({ instanceId: z.string(), token: z.string() });
const payloadSchema = z.object({ externalId: z.string().optional() }).passthrough();

async function loadIngressInstance(req, res, next) {
  try {
    const { instanceId, token } = ingressParams.parse(req.params);
    const inst = await prisma.botInstance.findUnique({ where: { id: instanceId } });
    if (!inst) return res.status(404).json({ error: 'Instance not found' });
    if (inst.webhookToken !== token) return res.status(401).json({ error: 'Invalid token' });
    req.botInstance = inst;
    req.workspaceId = inst.workspaceId;
    next();
  } catch (err) {
    if (err instanceof z.ZodError) err.status = 400;
    next(err);
  }
}

const ingressRateLimiter = createWorkspaceRateLimiter({
  limit: Number(process.env.INGRESS_RATE_LIMIT || 120),
  windowMs: 60 * 1000,
  keyExtractor: (req) => req.botInstance?.workspaceId,
  instanceExtractor: (req) => req.botInstance?.id
});

// TradingView-like ingress with bot instance scope
router.post('/ingress/bot/:instanceId/:token', loadIngressInstance, ingressRateLimiter, async (req, res, next) => {
  try {
    const inst = req.botInstance;
    const instanceId = inst.id;
    if (inst.status !== 'running') return res.status(409).json({ error: 'Instance not running' });

    // Guard: Allow if from TradingView IPs OR valid HMAC using token
    const ip = extractClientIp(req);
    const allowedByIp = isAllowedIp(ip);
    const signature = verifyRequestSignature(req, inst.webhookToken);
    if (signature.provided) {
      if (!signature.valid) {
        await logSignatureEvent(instanceId, false, `invalid signature from ${ip}`);
        return res.status(403).json({ error: 'Invalid signature' });
      }
      await logSignatureEvent(instanceId, true, `verified from ${ip}`);
    }
    if (!allowedByIp && !signature.valid && signature.provided && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!allowedByIp && !signature.provided && process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const payload = payloadSchema.parse(req.body || {});

    let signal;
    if (payload.externalId) {
      // Upsert on (botInstanceId, externalId)
      signal = await prisma.signal.upsert({
        where: { botInstanceId_externalId: { botInstanceId: instanceId, externalId: payload.externalId } },
        create: { botInstanceId: instanceId, source: 'webhook', externalId: payload.externalId, payload },
        update: { payload, processed: false, processedAt: null }
      });
    } else {
      signal = await prisma.signal.create({ data: { botInstanceId: instanceId, source: 'webhook', payload } });
    }

    // Enqueue signal for processing
    const correlationId = req.correlationId;
    const useDirect = !process.env.REDIS_URL;
    if (useDirect) {
      await handleSignalJob({ data: { signalId: signal.id, correlationId } });
    } else {
      await queues.signals.add('signal', { signalId: signal.id, correlationId }, {
        removeOnComplete: true,
        removeOnFail: 100,
        jobId: correlationId ? `${signal.id}:${correlationId}` : undefined
      });
    }

    res.status(202).json({ ok: true, id: signal.id });
  } catch (err) {
    if (err instanceof z.ZodError) err.status = 400;
    next(err);
  }
});
