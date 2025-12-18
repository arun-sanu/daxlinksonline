import crypto from 'crypto';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { forward } from '../services/tradingviewService.js';
import { extractSubdomain } from '../lib/webhookDomains.js';
import { webhookConfig } from '../config/webhook.js';

const payloadSchema = z.object({
  secret: z.string().optional()
}).passthrough();

const HMAC_FIELDS = new Set(['hmac', 'signature', 'sign']);

async function findUserByPrefix(prefix) {
  if (!prefix) return null;
  return prisma.user.findFirst({
    where: {
      OR: [{ subdomainPrefix: prefix }, { webhookSubdomain: prefix }]
    }
  });
}

function validateUserStatus(user) {
  if (user.isActive === false) {
    const err = new Error('Account inactive');
    err.status = 410;
    throw err;
  }
  if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    const err = new Error('Trial expired');
    err.status = 410;
    throw err;
  }
}

function resolveSecret(req, { requireQuerySecret, allowBodySecret }) {
  const querySecret = typeof req.query?.secret === 'string' ? req.query.secret : null;
  const bodySecret = allowBodySecret && typeof req.body?.secret === 'string' ? req.body.secret : null;
  const supplied = querySecret || bodySecret || null;
  if (!supplied && requireQuerySecret) {
    const err = new Error('secret query param required');
    err.status = 401;
    throw err;
  }
  return supplied;
}

function extractTimestamp(req) {
  const candidates = [
    req.headers['x-tv-timestamp'],
    req.query?.timestamp,
    req.body?.timestamp
  ].filter(Boolean);
  if (!candidates.length) return null;
  const raw = candidates[0];
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) {
      return num < 1e12 ? num * 1000 : num;
    }
  }
  return NaN;
}

function verifyTimestamp(ts) {
  if (!ts) return { ok: true };
  if (Number.isNaN(ts)) {
    return { ok: false, message: 'Invalid timestamp' };
  }
  const skew = Math.abs(Date.now() - ts);
  const maxSkewMs = webhookConfig.maxSkewMs;
  if (skew > maxSkewMs) {
    return { ok: false, message: 'Replay detected: timestamp outside allowed window' };
  }
  return { ok: true };
}

function deepStripHmacFields(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepStripHmacFields(entry));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((key) => !HMAC_FIELDS.has(key))
      .sort()
      .reduce((acc, key) => {
        acc[key] = deepStripHmacFields(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function resolveHmacSource(req, payload) {
  const primary = ['message', 'text', 'signal', 'body'].find(
    (key) => typeof payload?.[key] === 'string' && payload[key].length > 0
  );
  if (primary) {
    return Buffer.from(String(payload[primary]), 'utf8');
  }
  const canonical = deepStripHmacFields(payload || {});
  const json = JSON.stringify(canonical);
  if (json && json !== '{}') {
    return Buffer.from(json, 'utf8');
  }
  if (req.rawBody && req.rawBody.length > 0) return req.rawBody;
  return Buffer.from('');
}

function verifyHmac({ provided, key, payloadBuffer }) {
  if (!provided || !key) return { ok: false, message: 'Missing signature' };
  try {
    const computedHex = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(payloadBuffer).digest('hex');
    const expectedBuf = Buffer.from(computedHex, 'hex');
    const incoming = String(provided).trim();
    const providedBuf = Buffer.from(incoming, 'hex');
    if (expectedBuf.length !== providedBuf.length) {
      return { ok: false, message: 'Invalid signature' };
    }
    const matches = crypto.timingSafeEqual(expectedBuf, providedBuf);
    return matches ? { ok: true } : { ok: false, message: 'Invalid signature' };
  } catch (error) {
    return { ok: false, message: error.message || 'HMAC verification failed' };
  }
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.length > 0) return cfIp;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const head = xff.split(',')[0];
    if (head) return head.trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

function logReject(reason, context = {}) {
  console.warn(
    JSON.stringify({
      event: 'tradingview_webhook_reject',
      at: new Date().toISOString(),
      reason,
      ...context
    })
  );
}

export function createTradingviewWebhookHandler(
  { requireQuerySecret = false, allowBodySecret = true } = {},
  deps = {}
) {
  const { findUser = findUserByPrefix, forwarder = forward } = deps;
  return async function tradingviewWebhookHandler(req, res, next) {
    try {
      let prefix = req.subdomainPrefix;
      if (!prefix) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        prefix = extractSubdomain(host);
      }
      if (!prefix) {
        logReject('invalid_host', { ip: getClientIp(req) });
        return res.status(400).json({ error: 'Invalid host header' });
      }

      const user = await findUser(prefix);
      if (!user) {
        logReject('user_not_found', { prefix, ip: getClientIp(req) });
        return res.status(404).json({ error: 'Not found' });
      }
      try {
        validateUserStatus(user);
      } catch (statusErr) {
        logReject(statusErr.message || 'user_inactive', {
          prefix,
          userId: user.id,
          ip: getClientIp(req)
        });
        return res.status(statusErr.status || 500).json({ error: statusErr.message });
      }

      const expectedSecret = user.webhookSecret;
      if (expectedSecret) {
        try {
          const providedSecret = resolveSecret(req, { requireQuerySecret, allowBodySecret });
          if (!providedSecret) {
            logReject('secret_missing', { prefix, userId: user.id, ip: getClientIp(req) });
            return res.status(401).json({ error: 'Secret required' });
          }
          if (providedSecret !== expectedSecret) {
            logReject('secret_invalid', { prefix, userId: user.id, ip: getClientIp(req) });
            return res.status(401).json({ error: 'Invalid secret' });
          }
        } catch (secretErr) {
          logReject(secretErr.message || 'secret_error', { prefix, userId: user.id, ip: getClientIp(req) });
          return res.status(secretErr.status || 401).json({ error: secretErr.message });
        }
      }

      const timestamp = extractTimestamp(req);
      const tsStatus = verifyTimestamp(timestamp);
      if (!tsStatus.ok) {
        logReject('timestamp_invalid', { prefix, userId: user.id, ip: getClientIp(req), skewMs: webhookConfig.maxSkewMs });
        return res.status(403).json({ error: tsStatus.message });
      }

      const candidatePayload = (req.body && typeof req.body === 'object' ? req.body : {}) || {};
      const expectedHmacKey = user.webhookHmacKey;
      const providedHmac = candidatePayload.hmac || candidatePayload.signature || candidatePayload.sign;
      const hmacEnforced = webhookConfig.enforceHmacGlobally || user.enforceHmac;
      if (expectedHmacKey && providedHmac) {
        const payloadBuffer = resolveHmacSource(req, candidatePayload);
        const result = verifyHmac({ provided: String(providedHmac), key: expectedHmacKey, payloadBuffer });
        if (!result.ok) {
          logReject('hmac_invalid', { prefix, userId: user.id, ip: getClientIp(req) });
          return res.status(401).json({ error: result.message });
        }
      } else if (expectedHmacKey && hmacEnforced) {
        logReject('hmac_missing', { prefix, userId: user.id, ip: getClientIp(req) });
        return res.status(401).json({ error: 'Missing HMAC signature' });
      }

      const payload = payloadSchema.parse(candidatePayload || {});
      forwarder(user.id, payload).catch((err) => {
        console.warn('[tradingview] forward failed', err);
      });
      return res.status(200).json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.status = 400;
      }
      next(error);
    }
  };
}
