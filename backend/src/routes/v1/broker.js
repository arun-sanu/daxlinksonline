import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma } from '../../utils/prisma.js';
import { getPendaxClient } from '../../lib/pendaxClient.js';
import { placeSandboxOrder } from '../../lib/pendax.js';
import { createWorkspaceRateLimiter } from '../../middleware/rateLimit.js';
import { verifyRequestSignature } from '../../lib/signature.js';
import {
  roundPriceQty,
  assertVenueFilters,
  assertDailyLossCap,
  GuardrailError,
  logGuardrailViolation,
  logSignatureEvent
} from '../../lib/tradeGuards.js';

const orderSchema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['MARKET', 'LIMIT', 'STOP']),
    price: z.number().positive().optional(),
    qty: z.number().positive(),
    idempotencyKey: z.string().min(8)
  })
  .superRefine((value, ctx) => {
    if (value.type !== 'MARKET' && typeof value.price !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Price required for non-market orders',
        path: ['price']
      });
    }
  });

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT secret missing');
  return secret;
}

export function ensureInstanceScope(instance, workspaceId) {
  if (!instance || !workspaceId) {
    const err = new Error('Malformed token');
    err.status = 401;
    throw err;
  }
  if (instance.workspaceId !== workspaceId) {
    const err = new Error('Cross-workspace token rejected');
    err.status = 403;
    throw err;
  }
}

async function verifyBotTokenAndGetInstance(req) {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') {
    const err = new Error('Missing bot token');
    err.status = 401;
    throw err;
  }
  const [, token] = header.split(' ');
  if (!token) {
    const err = new Error('Invalid auth header');
    err.status = 401;
    throw err;
  }
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (e) {
    const err = new Error('Invalid token');
    err.status = 401;
    throw err;
  }
  const botInstanceId = payload?.botInstanceId;
  const workspaceId = payload?.workspaceId;
  if (!botInstanceId || !workspaceId) {
    const err = new Error('Malformed token');
    err.status = 401;
    throw err;
  }
  const inst = await prisma.botInstance.findUnique({ where: { id: botInstanceId } });
  if (!inst) {
    const err = new Error('Instance not found');
    err.status = 404;
    throw err;
  }
  ensureInstanceScope(inst, workspaceId);
  return inst;
}

function ensureVenuePolicy(instance, exchangeAccount) {
  if (!exchangeAccount) {
    const err = new Error('Exchange account missing');
    err.status = 404;
    throw err;
  }
  if (exchangeAccount.workspaceId !== instance.workspaceId) {
    const err = new Error('Exchange scope violation');
    err.status = 403;
    throw err;
  }
  return exchangeAccount;
}

export function preflightValidateOrder(inst, body) {
  if (inst.status !== 'running') {
    const err = new Error('Instance not running');
    err.status = 409;
    throw err;
  }
  if (body.symbol !== inst.symbol) {
    const err = new Error('Symbol not allowed');
    err.status = 400;
    throw err;
  }
}

export const router = Router();

async function attachBotInstance(req, res, next) {
  try {
    const inst = await verifyBotTokenAndGetInstance(req);
    req.botInstance = inst;
    req.workspaceId = inst.workspaceId;
    next();
  } catch (err) {
    next(err);
  }
}

const brokerRateLimiter = createWorkspaceRateLimiter({
  limit: Number(process.env.BROKER_RATE_LIMIT || 90),
  windowMs: 60 * 1000,
  keyExtractor: (req) => req.botInstance?.workspaceId,
  instanceExtractor: (req) => req.botInstance?.id
});

// Internal broker endpoints (JWT for bot instances)
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', component: 'broker' });
});

router.post('/order', attachBotInstance, brokerRateLimiter, async (req, res, next) => {
  try {
    const body = orderSchema.parse(req.body || {});
    const inst = req.botInstance;
    preflightValidateOrder(inst, body);

    const signature = verifyRequestSignature(req, inst.webhookToken);
    if (signature.provided) {
      if (!signature.valid) {
        await logSignatureEvent(inst.id, false, 'broker signature invalid');
        const err = new Error('Invalid signature');
        err.status = 403;
        throw err;
      }
      await logSignatureEvent(inst.id, true, 'broker signature ok');
    }

    // Load exchange account and prepare client
    const exchangeRecord = await prisma.exchangeAccount.findUnique({ where: { id: inst.exchangeAccountId } });
    const exchange = ensureVenuePolicy(inst, exchangeRecord);
    const venue = exchange?.venue || 'sandbox';
    const venueMeta = {
      priceTick: Number(process.env.DEFAULT_PRICE_TICK || 0.01),
      qtyStep: Number(process.env.DEFAULT_QTY_STEP || 0.001),
      minNotional: inst.minNotional || 0
    };
    const rounded = roundPriceQty(venueMeta, body.price, body.qty);
    body.price = rounded.price;
    body.qty = rounded.qty;

    try {
      assertVenueFilters(venueMeta, inst.minNotional, body.price, body.qty);
      await assertDailyLossCap(inst.id);
    } catch (guardErr) {
      if (guardErr instanceof GuardrailError) {
        await logGuardrailViolation(inst.id, guardErr.message);
      }
      throw guardErr;
    }

    let client = null;
    try {
      client = await getPendaxClient(exchange);
    } catch (err) {
      console.warn('[broker] pendax client unavailable, falling back to sandbox', err);
      client = null;
    }

    // Place order
    let resp;
    if (client && client.placeOrder) {
      resp = await client.placeOrder({ symbol: body.symbol, side: body.side, type: body.type, price: body.price, qty: body.qty, idempotencyKey: body.idempotencyKey });
    } else {
      resp = await placeSandboxOrder({ venue, symbol: body.symbol, side: body.side, type: body.type, price: body.price, qty: body.qty, idempotencyKey: body.idempotencyKey });
    }

    // Persist order
    await prisma.order.create({
      data: {
        botInstanceId: inst.id,
        venue,
        symbol: body.symbol,
        side: body.side,
        type: body.type,
        price: body.price ?? null,
        qty: String(body.qty),
        status: 'NEW',
        venueOrderId: resp?.id || null
      }
    });

    res.json({
      id: resp?.id || null,
      status: resp?.status || 'NEW',
      venue,
      symbol: body.symbol,
      side: body.side,
      type: body.type
    });
  } catch (err) {
    if (err instanceof GuardrailError) {
      err.status = err.status || 400;
    } else if (err instanceof z.ZodError) err.status = 400;
    next(err);
  }
});
