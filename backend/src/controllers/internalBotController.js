import crypto from 'crypto';
import { z } from 'zod';
import { writeBotOrderResult } from '../services/botSizingReportsService.js';
import { resolveInternalBotRuntime } from '../services/internalBotService.js';

const payloadSchema = z.object({
  signalId: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
  botId: z.string().optional(),
  botInstanceId: z.string().optional(),
  symbol: z.string().optional(),
  side: z.string().optional(),
  normalizedSignal: z.record(z.any()).optional(),
  signal: z.record(z.any()).optional(),
  entryOrder: z.record(z.any()).optional(),
  protection: z.record(z.any()).optional(),
  sizing: z.record(z.any()).optional(),
  executionResult: z.record(z.any()).optional(),
  errors: z.array(z.string()).optional(),
  rawPayload: z.any().optional(),
  meta: z.record(z.any()).optional()
});

const runtimeParamSchema = z.object({
  botInstanceId: z.string().min(8)
});

function timingSafeTokenMatch(expected, incoming) {
  if (!expected || !incoming) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(incoming));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function assertInternalToken(req) {
  const expected = process.env.INTERNAL_BOT_TOKEN || '';
  if (!expected) {
    throw Object.assign(new Error('INTERNAL_BOT_TOKEN is not configured'), { status: 503 });
  }
  const provided =
    req.headers['x-internal-token'] ||
    req.headers['x-bot-token'] ||
    req.headers.authorization?.toString().replace(/^Bearer\s+/i, '') ||
    '';
  if (!timingSafeTokenMatch(expected, String(provided || ''))) {
    throw Object.assign(new Error('Invalid internal bot token'), { status: 401 });
  }
}

export async function handleInternalBotOrderResult(req, res, next) {
  try {
    assertInternalToken(req);
    const payload = payloadSchema.parse(req.body || {});
    const result = await writeBotOrderResult(payload);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid bot order result payload';
    }
    next(error);
  }
}

export async function handleGetInternalBotRuntime(req, res, next) {
  try {
    assertInternalToken(req);
    const { botInstanceId } = runtimeParamSchema.parse(req.params || {});
    const payload = await resolveInternalBotRuntime({ botInstanceId });
    res.json(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid bot runtime request';
    }
    next(error);
  }
}
