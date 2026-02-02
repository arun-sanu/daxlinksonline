import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { correlationId } from './middleware/correlation.js';

import { router as apiRouter } from './routes/index.js';
import { attachUser } from './middleware/auth.js';
import { betterAuthHandler } from './auth/betterAuth.js';
import { attachSubdomain } from './middleware/subdomain.js';
import { tradingviewIngressRouter } from './routes/tradingviewIngress.js';
import { getWebhookBaseDomain } from './lib/webhookDomains.js';

export async function createServer() {
  const app = express();
  app.set('trust proxy', 1);

  const monitoringLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      if (req.method !== 'GET') return true;
      const path = req.path || '';
      return !(
        path.startsWith('/v1/metrics/monitoring') ||
        path.startsWith('/v1/users/webhook-alerts') ||
        path.startsWith('/v1/dns/mine') ||
        path.startsWith('/v1/webhooks/')
      );
    }
  });

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      if (req.method !== 'GET') return false;
      const path = req.path || '';
      return (
        path.startsWith('/v1/metrics/monitoring') ||
        path.startsWith('/v1/users/webhook-alerts') ||
        path.startsWith('/v1/dns/mine') ||
        path.startsWith('/v1/webhooks/')
      );
    }
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          // ESM modules (vue, vue-router) + Tailwind CDN
          "script-src": ["'self'", 'https://unpkg.com', 'https://cdn.tailwindcss.com'],
          // Inline styles used in UI + Google Fonts
          "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          // Google Fonts
          "font-src": ["'self'", 'https://fonts.gstatic.com', 'data:'],
          // Images and icons
          "img-src": ["'self'", 'data:', 'https:'],
          // Frontend connects to API and CDNs from browsers
          "connect-src": [
            "'self'",
            'http://localhost:4000',
            'http://127.0.0.1:4000',
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'https://unpkg.com'
          ],
          "frame-ancestors": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "upgrade-insecure-requests": []
        }
      }
    })
  );

  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const configuredBaseDomain = (process.env.WEBHOOK_BASE_DOMAIN || '').trim();
  const derivedOrigins = [];
  let derivedBaseHost = null;
  if (configuredBaseDomain) {
    const normalized = getWebhookBaseDomain();
    if (normalized) {
      derivedOrigins.push(`https://${normalized}`);
      derivedBaseHost = normalized;
    }
  }
  const allowedOrigins = Array.from(new Set([...corsOrigins, ...derivedOrigins].filter(Boolean)));
  const allowAllOrigins = allowedOrigins.length === 0;

  function originAllowed(origin) {
    if (allowAllOrigins || !origin) {
      return true;
    }
    if (allowedOrigins.includes(origin)) {
      return true;
    }
    if (!derivedBaseHost) {
      return false;
    }
    try {
      const { hostname, protocol } = new URL(origin);
      if (!/^https?:$/.test(protocol)) {
        return false;
      }
      const normalizedHost = hostname.toLowerCase();
      return normalizedHost === derivedBaseHost || normalizedHost.endsWith(`.${derivedBaseHost}`);
    } catch {
      return false;
    }
  }

  app.use(
    cors({
      origin(origin, callback) {
        if (originAllowed(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true
    })
  );

  app.use(attachSubdomain());
  app.use(correlationId());
  app.use(tradingviewIngressRouter);
  app.use(monitoringLimiter);
  app.use(globalLimiter);
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      }
    })
  );
  app.use(express.urlencoded({ extended: false }));

  morgan.token('cid', (req) => req.correlationId || '-');
  app.use(
    morgan((tokens, req, res) =>
      JSON.stringify({
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        status: Number(tokens.status(req, res) || 0),
        length: tokens.res(req, res, 'content-length'),
        responseTime: Number(tokens['response-time'](req, res) || 0),
        correlationId: tokens.cid(req, res)
      })
    )
  );
  app.use('/api/auth', betterAuthHandler);
  app.use(attachUser);
  app.use('/api', apiRouter);

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error'
    });
  });

  return app;
}
