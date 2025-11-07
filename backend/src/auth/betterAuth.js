import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins/two-factor';

import { prisma } from '../utils/prisma.js';
import { sendMail } from '../lib/mailer.js';
import { renderEmailVerificationTemplate } from '../emails/emailVerificationTemplate.js';

const APP_NAME = process.env.APP_NAME || 'Pendax Console';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:4000';
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const TWO_FACTOR_ISSUER = process.env.TWO_FACTOR_ISSUER || APP_NAME;
const EMAIL_VERIFICATION_MINUTES = Number(process.env.EMAIL_VERIFICATION_MINUTES || 30);
const EMAIL_TIMEZONE = process.env.APP_TIMEZONE || 'UTC';
const DEFAULT_TIME_REMAINING_LABEL = '15 minutes';

const socialProviders = {
  google: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
    ? {
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        scope: ['openid', 'email', 'profile']
      }
    : undefined
};

function formatTimeRemaining(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_TIME_REMAINING_LABEL;
  }
  if (minutes < 60) {
    return `${Math.round(minutes)} minutes`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded} hours`;
  }
  const days = hours / 24;
  const roundedDays = Math.round(days * 10) / 10;
  return `${roundedDays % 1 === 0 ? roundedDays.toFixed(0) : roundedDays} days`;
}

function formatAccountCreation(value) {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const formatter = new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'long',
      timeStyle: 'medium',
      timeZone: EMAIL_TIMEZONE
    });
    return formatter.format(date);
  } catch {
    return '';
  }
}

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL: APP_BASE_URL,
  basePath: '/api/auth',
  secret: BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8
  },
  socialProviders,
  emailVerification: {
    expiresIn: `${EMAIL_VERIFICATION_MINUTES}m`,
    async sendVerificationEmail({ user, url }) {
      if (!user?.email) {
        throw new Error('Cannot send verification email without a recipient address');
      }

      const accountCreatedAt = formatAccountCreation(user.createdAt);
      const timeRemaining = formatTimeRemaining(EMAIL_VERIFICATION_MINUTES);
      const html = renderEmailVerificationTemplate({
        userName: user.name,
        userEmail: user.email,
        accountCreatedAt,
        timeRemaining,
        verificationLink: url,
        isExpired: false
      });

      const text = [
        `Hi ${user.name || 'Operator'},`,
        '',
        'Verify your email for daxlinks.online:',
        url,
        '',
        `This link expires in ${timeRemaining.toLowerCase()}.`,
        '',
        'If you did not request this, please ignore this email.'
      ].join('\n');

      try {
        await sendMail({
          to: user.email,
          subject: 'Verify your email for daxlinks.online',
          html,
          text
        });
      } catch (error) {
        console.error('[Auth] Unable to send verification email', error);
        throw error;
      }
    }
  },
  plugins: [
    twoFactor({
      issuer: TWO_FACTOR_ISSUER,
      totpOptions: {
        digits: 6,
        period: 30
      },
      backupCodeOptions: {
        amount: 8,
        length: 10,
        storeBackupCodes: 'encrypted'
      }
    })
  ]
});

const SKIPPED_PROXY_HEADERS = new Set(['content-length']);

function convertHeadersMap(entries) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(entries)) {
    if (SKIPPED_PROXY_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined) headers.append(key, entry);
      });
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

export function createAuthHeaders(source) {
  if (source instanceof Headers) {
    return source;
  }
  return convertHeadersMap(source);
}

function buildHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined) headers.append(key, entry);
      });
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

export function serializeBody(body, headers) {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    return body;
  }
  if (typeof body === 'object') {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return JSON.stringify(body);
  }
  return undefined;
}

function resolveBody(req, headers) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  if (req.body === undefined || req.body === null) {
    return undefined;
  }
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
    return req.body;
  }
  if (typeof req.body === 'object') {
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return JSON.stringify(req.body);
  }
  return undefined;
}

export async function betterAuthHandler(req, res, next) {
  try {
    const origin = req.protocol && req.get('host') ? `${req.protocol}://${req.get('host')}` : APP_BASE_URL;
    const url = new URL(req.originalUrl || req.url, origin);
    const headers = buildHeaders(req);
    const body = resolveBody(req, headers);
    const request = new Request(url, {
      method: req.method,
      headers,
      body
    });
    const response = await auth.handler(request);
    await sendFetchResponse(res, response, req.method);
  } catch (error) {
    next(error);
  }
}

function extractSetCookies(headers) {
  if (!headers) {
    return [];
  }
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  if (typeof headers.raw === 'function') {
    return headers.raw()['set-cookie'] || [];
  }
  const single = headers.get?.('set-cookie');
  return single ? [single] : [];
}

export async function sendFetchResponse(res, response, method = 'GET') {
  res.status(response.status);

  const cookies = extractSetCookies(response.headers);
  if (cookies.length > 0) {
    res.setHeader('Set-Cookie', cookies);
  }

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      return;
    }
    res.setHeader(key, value);
  });

  if (response.status === 204 || method === 'HEAD') {
    res.end();
    return;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    res.end();
    return;
  }
  res.send(Buffer.from(arrayBuffer));
}

export function buildAuthRequest({ url, method, headers, body }) {
  return new Request(url, {
    method,
    headers,
    body
  });
}
