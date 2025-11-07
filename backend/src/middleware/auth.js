import jwt from 'jsonwebtoken';

import { auth } from '../auth/betterAuth.js';
import { prisma } from '../utils/prisma.js';

const TOKEN_HEADER = 'authorization';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT secret is not configured');
  }
  return secret;
}

function extractBearerToken(req) {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token;
}

async function resolveUser(userId) {
  if (!userId) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      emailVerified: true,
      twoFactorEnabled: true,
      role: true,
      isSuperAdmin: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

export async function attachUser(req, _res, next) {
  const token = extractBearerToken(req);
  const secret = process.env.JWT_SECRET;
  if (token && secret) {
    try {
      const payload = jwt.verify(token, secret);
      const user = await resolveUser(payload.userId);
      if (user) {
        req.user = user;
        return next();
      }
    } catch {
      // ignore and fall through to Better Auth session lookup
    }
  }

  try {
    const session = await auth.api.getSession({
      headers: req.headers
    });
    if (session?.user) {
      const { user, session: activeSession } = session;
      // Fetch role/superadmin flags from our DB for proper authorization
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, isSuperAdmin: true }
      });
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        role: dbUser?.role,
        isSuperAdmin: dbUser?.isSuperAdmin || false,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
        updatedAt: user.updatedAt ? new Date(user.updatedAt) : undefined
      };
      req.authSession = activeSession;
      return next();
    }
  } catch {
    // ignore session resolution errors so downstream handlers can decide
  }

  req.user = null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ error: 'Forbidden: super admin access required' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!(req.user.isSuperAdmin || req.user.role === 'admin')) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

export function signAuthToken(userId) {
  const secret = getJwtSecret();
  return jwt.sign({ userId }, secret, { expiresIn: '7d' });
}
