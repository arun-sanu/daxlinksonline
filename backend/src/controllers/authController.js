import { z } from 'zod';

import {
  registerUser,
  loginUser,
  getUserProfile,
  requestPasswordReset,
  resetPassword
} from '../services/authService.js';

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const forgotSchema = z.object({
  email: z.string().email()
});

const resetSchema = z.object({
  token: z.string().uuid().or(z.string().length(36, 'Invalid reset token format')),
  password: z.string().min(8)
});

// Public registration disabled in favor of superadmin-created accounts via portal
export async function handleRegisterDisabled(_req, res, _next) {
  return res.status(403).json({ error: 'Public registration is disabled' });
}

export async function handleLogin(req, res, next) {
  try {
    const payload = loginSchema.parse(req.body);
    const result = await loginUser(payload);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function handleCurrentUser(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const profile = await getUserProfile(req.user.id);
    res.json(profile);
  } catch (error) {
    next(error);
  }
}

export async function handleForgotPassword(req, res, next) {
  try {
    const payload = forgotSchema.parse(req.body);
    const result = await requestPasswordReset(payload.email);
    res.status(202).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function handleResetPassword(req, res, next) {
  try {
    const payload = resetSchema.parse(req.body);
    const result = await resetPassword(payload.token, payload.password);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}
