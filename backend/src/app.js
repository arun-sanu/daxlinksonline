import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { correlationId } from './middleware/correlation.js';

import { router as apiRouter } from './routes/index.js';
import { attachUser } from './middleware/auth.js';
import { betterAuthHandler } from './auth/betterAuth.js';

export async function createServer() {
  const app = express();

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

  const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const allowAllOrigins = corsOrigins.length === 0;
  app.use(cors({
    origin: allowAllOrigins ? true : corsOrigins,
    credentials: true
  }));

  app.use(correlationId());
  app.use(express.json({ limit: '1mb' }));
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
