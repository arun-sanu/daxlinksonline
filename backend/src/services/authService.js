import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

import { prisma } from '../utils/prisma.js';
import { ensureTrialWebhook } from './tradingviewService.js';
import { signAuthToken } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image ?? null,
    emailVerified: user.emailVerified ?? false,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    role: user.role,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function buildWebhookSummary(user) {
  if (!user) return null;
  const baseDomain = process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link';
  const sub = user.webhookSubdomain || null;
  const url = sub ? `https://${sub}.${baseDomain}/api/v1/webhook` : null;
  return {
    url,
    secret: user.webhookSecret || null,
    trialEndsAt: user.trialEndsAt || null,
    isActive: user.isActive !== false
  };
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const error = new Error('An account with this email already exists');
    error.status = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name,
      email: normalizedEmail,
      passwordHash,
      role: 'operator',
      isSuperAdmin: false
    }
  });

  // Provision platform webhook subdomain + secret for 28-day trial
  const provisioned = await ensureTrialWebhook(user.id);
  const baseDomain = process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link';
  const webhookUrl = provisioned.webhookSubdomain
    ? `https://${provisioned.webhookSubdomain}.${baseDomain}/api/v1/webhook`
    : null;

  const token = signAuthToken(user.id);
  return {
    token,
    user: serializeUser(user),
    webhook: webhookUrl ? { url: webhookUrl, secret: provisioned.webhookSecret, trialEndsAt: provisioned.trialEndsAt } : null
  };
}

export async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    const error = new Error('Invalid credentials');
    error.status = 401;
    throw error;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const error = new Error('Invalid credentials');
    error.status = 401;
    throw error;
  }

  const token = signAuthToken(user.id);
  return {
    token,
    user: serializeUser(user)
  };
}

export async function getUserProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const profile = serializeUser(user);
  const webhook = buildWebhookSummary(user);
  return { ...profile, webhook };
}

export async function requestPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { success: true };
  }

  await prisma.passwordResetToken.updateMany({
    where: {
      userId: user.id,
      usedAt: null
    },
    data: {
      usedAt: new Date()
    }
  });

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const resetUrl = buildResetUrl(token);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      expiresAt
    }
  });

  await dispatchResetEmail({
    email: user.email,
    name: user.name,
    resetUrl,
    expiresAt
  });

  const response = { success: true };
  if (process.env.NODE_ENV !== 'production') {
    response.previewToken = token;
    response.previewUrl = resetUrl;
  }
  return response;
}

export async function resetPassword(token, password) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true }
  });
  if (!record || !record.user) {
    const error = new Error('Reset token is invalid or has expired');
    error.status = 400;
    throw error;
  }

  if (record.usedAt) {
    const error = new Error('Reset token has already been used');
    error.status = 400;
    throw error;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    const error = new Error('Reset token has expired');
    error.status = 400;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    })
  ]);

  await prisma.passwordResetToken.updateMany({
    where: {
      userId: record.userId,
      usedAt: null,
      id: { not: record.id }
    },
    data: { usedAt: new Date() }
  });

  const updatedUser = await prisma.user.findUnique({ where: { id: record.userId } });
  const authToken = signAuthToken(record.userId);
  return {
    token: authToken,
    user: serializeUser(updatedUser)
  };
}

function buildResetUrl(token) {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:4000';
  const resetPath = process.env.APP_RESET_PATH || '/#/reset';
  const base = baseUrl.replace(/\/$/, '');
  const path = resetPath.startsWith('/') ? resetPath : `/${resetPath}`;
  const separator = path.includes('?') ? '&' : '?';
  return `${base}${path}${separator}token=${encodeURIComponent(token)}`;
}

async function dispatchResetEmail({ email, name, resetUrl, expiresAt }) {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000));
  const subject = 'Reset your DaxLinks console password';
  const text = [
    `Hi ${name || 'Operator'},`,
    '',
    'We received a request to reset your password for the DaxLinks console.',
    `Reset link: ${resetUrl}`,
    '',
    `For security, the link expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    '',
    'If you did not request this, please ignore this email or contact security@daxlinks.online.'
  ].join('\n');
  const html = `
    <p>Hi ${name || 'Operator'},</p>
    <p>We received a request to reset your password for the DaxLinks console.</p>
    <p><a href="${resetUrl}" style="color:#1298e6;">Click here to reset your password</a></p>
    <p>This link expires in ${minutes} minute${minutes === 1 ? '' : 's'}.</p>
    <p>If you didn't request this, please ignore the email or contact <a href="mailto:security@daxlinks.online">security@daxlinks.online</a>.</p>
  `;

  try {
    await sendMail({ to: email, subject, text, html });
  } catch (error) {
    console.warn('[Auth] Unable to send reset email, falling back to log');
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Auth] Reset link:', resetUrl);
    }
  }
}
