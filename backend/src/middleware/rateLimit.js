import rateLimit from 'express-rate-limit';
import RateLimitRedis from 'rate-limit-redis';
import { connection } from '../lib/redis.js';
import { logRateLimitEvent } from '../lib/tradeGuards.js';

const RedisStore = typeof RateLimitRedis === 'function' ? RateLimitRedis : RateLimitRedis?.RedisStore;
const DEFAULT_WEBHOOK_DOMAIN = (process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link').toLowerCase();

function buildStore() {
  if (!connection) return undefined;
  if (!RedisStore) return undefined;
  return new RedisStore({
    sendCommand: (...args) => connection.call(...args)
  });
}

function extractSubdomain(host) {
  if (!host) return null;
  const cleanHost = String(host).toLowerCase().split(':')[0];
  const base = DEFAULT_WEBHOOK_DOMAIN;
  if (!cleanHost.endsWith(base)) return null;
  const parts = cleanHost.split('.');
  const baseParts = base.split('.');
  if (parts.length <= baseParts.length) return null;
  return parts.slice(0, parts.length - baseParts.length).join('.');
}

export function createWorkspaceRateLimiter({
  limit = 60,
  windowMs = 60 * 1000,
  keyExtractor,
  instanceExtractor
} = {}) {
  const store = buildStore();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req) => keyExtractor?.(req) || req.ip || 'anonymous',
    handler: (req, res) => {
      const instanceId = instanceExtractor?.(req);
      if (instanceId) {
        logRateLimitEvent(instanceId, `Exceeded ${limit} req/${windowMs / 1000}s`).catch((err) => {
          console.warn('[guardrail] failed to log rate limit', err);
        });
      }
      res.status(429).json({ error: 'Rate limit exceeded' });
    }
  });
}

export function perSubdomainRateLimit({ maxPerSecond = 20, windowMs = 1000 } = {}) {
  const store = buildStore();
  const limit = Math.max(1, Number(maxPerSecond) || 1);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req) => {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const subdomain = extractSubdomain(host);
      if (subdomain) return `subdomain:${subdomain}`;
      const ip = req.ip || req.headers['x-forwarded-for'] || 'anonymous';
      return `ip:${ip}`;
    },
    handler: (_req, res) => {
      res.status(429).json({ error: 'Rate limit exceeded' });
    }
  });
}
