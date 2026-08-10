import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { signAuthToken } from '../middleware/auth.js';

const allowedPortalRoles = new Set(['superadmin', 'admin', 'developer', 'engineer', 'designer']);

const loginSchema = z.object({
  username: z.string().min(3), // email used as username for now
  password: z.string().min(1)
});

export async function handlePortalLogin(req, res, next) {
  try {
    const { username, password } = loginSchema.parse(req.body || {});
    const email = String(username).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const err = new Error('Invalid credentials');
      err.status = 401;
      throw err;
    }
    const normalizedRole = String(user.role || '').toLowerCase();
    if (!(user.isSuperAdmin || allowedPortalRoles.has(normalizedRole))) {
      const err = new Error('Forbidden: role not permitted for portal');
      err.status = 403;
      throw err;
    }
    if (user.isActive === false) {
      const err = new Error('Account inactive');
      err.status = 403;
      throw err;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const err = new Error('Invalid credentials');
      err.status = 401;
      throw err;
    }
    const token = signAuthToken(user.id);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSuperAdmin: Boolean(user.isSuperAdmin),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['superadmin', 'admin', 'developer', 'engineer', 'designer', 'operator']).default('operator')
});

export async function handlePortalCreateUser(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const payload = createUserSchema.parse(req.body || {});
    const existing = await prisma.user.findUnique({ where: { email: payload.email.toLowerCase() } });
    if (existing) {
      const err = new Error('User already exists');
      err.status = 409;
      throw err;
    }
    const passwordHash = await bcrypt.hash(payload.password, 12);
    const user = await prisma.user.create({
      data: {
        name: payload.name,
        email: payload.email.toLowerCase(),
        passwordHash,
        role: payload.role,
        isSuperAdmin: payload.role === 'superadmin'
      },
      select: { id: true, email: true, name: true, role: true, isSuperAdmin: true, createdAt: true }
    });
    res.status(201).json(user);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

const assignRoleSchema = z.object({
  role: z.enum(['superadmin', 'admin', 'developer', 'engineer', 'designer', 'operator'])
});

export async function handlePortalAssignRole(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const { userId } = req.params;
    const { role } = assignRoleSchema.parse(req.body || {});
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role, isSuperAdmin: role === 'superadmin' },
      select: { id: true, email: true, name: true, role: true, isSuperAdmin: true }
    });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

const setPasswordSchema = z.object({
  password: z.string().min(8)
});

export async function handlePortalSetPassword(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const { userId } = req.params;
    const { password } = setPasswordSchema.parse(req.body || {});
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    res.status(204).end();
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}
