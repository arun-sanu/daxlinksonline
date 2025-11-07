import { randomUUID, createHash } from 'crypto';
import { prisma } from '../utils/prisma.js';

const MASK_PREFIX_LENGTH = 4;

async function ensureUniqueSlug(baseSlug) {
  const normalized = baseSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  let slug = normalized || `workspace-${randomUUID().slice(0, 8)}`;
  let counter = 1;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    slug = `${normalized}-${counter}`;
    counter += 1;
  }
  return slug;
}

export async function createWorkspace(payload, ownerId) {
  const slug = payload.slug ? await ensureUniqueSlug(payload.slug) : await ensureUniqueSlug(payload.name);
  const workspace = await prisma.workspace.create({
    data: {
      name: payload.name,
      slug,
      planTier: payload.planTier,
      teamSize: payload.teamSize,
      primaryUseCase: payload.primaryUseCase,
      region: payload.region,
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
