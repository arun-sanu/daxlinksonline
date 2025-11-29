import { randomUUID, createHash, randomBytes } from 'crypto';
import { prisma } from '../utils/prisma.js';

const MASK_PREFIX_LENGTH = 4;

function sanitizeSlugBase(baseSlug) {
  return baseSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function ensureUniqueSlug(baseSlug) {
  const normalized = sanitizeSlugBase(baseSlug);
  const fallback = `workspace-${randomUUID().slice(0, 8)}`;
  let slug = normalized || fallback;
  let attempt = 0;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    const suffix = randomBytes(2).toString('hex'); // 4 hex chars
    slug = `${normalized || 'workspace'}-${suffix}`;
    attempt += 1;
    if (attempt > 5) {
      slug = `${fallback}-${randomBytes(2).toString('hex')}`;
    }
  }
  return slug;
}

function generateShortCode(length = 6) {
  return randomBytes(length).toString('hex').slice(0, length);
}

async function ensureUniqueWorkspaceShortCode(preferred) {
  let code = preferred || generateShortCode(6);
  let tries = 0;
  while (await prisma.workspace.findFirst({ where: { shortCode: code } })) {
    code = generateShortCode(6);
    tries += 1;
    if (tries > 5) {
      code = generateShortCode(8);
    }
  }
  return code;
}

export async function createWorkspace(payload, ownerId) {
  const slug = payload.slug ? await ensureUniqueSlug(payload.slug) : await ensureUniqueSlug(payload.name);
  const shortCode = await ensureUniqueWorkspaceShortCode(payload.shortCode);
  const workspace = await prisma.workspace.create({
    data: {
      name: payload.name,
      slug,
      shortCode,
      planTier: payload.planTier || 'Starter',
      teamSize: payload.teamSize || '1-5',
      primaryUseCase: payload.primaryUseCase || 'signals',
      region: payload.region || 'amer',
      ownerId: ownerId || null
    }
  });

  await prisma.adminSession.create({
    data: {
      workspaceId: workspace.id,
      location: payload.adminLocation || 'Unknown',
      device: payload.adminDevice || 'Dashboard',
      ip: payload.adminIp || '127.0.0.1'
    }
  });

  return workspace;
}

export async function provisionDefaultWorkspaceForUser(user) {
  if (!user) return null;
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'asc' }
  });
  if (existing) return existing;

  const baseName = user.name || user.email?.split('@')[0] || 'Workspace';
  const name = `${baseName}'s workspace`;
  const slug = await ensureUniqueSlug(baseName);
  const shortCode = await ensureUniqueWorkspaceShortCode();

  return createWorkspace(
    {
      name,
      slug,
      shortCode,
      planTier: 'Starter',
      teamSize: '1-5',
      primaryUseCase: 'signals',
      region: 'amer'
    },
    user.id
  );
}

export function maskCredential(value) {
  if (!value) return '****';
  const prefix = value.slice(0, MASK_PREFIX_LENGTH);
  return `${prefix}****`;
}

export function createCredentialReference(value) {
  if (!value) return null;
  const digest = createHash('sha256').update(value).update(randomUUID()).digest('hex');
  return `cred_${digest.slice(0, 24)}`;
}
