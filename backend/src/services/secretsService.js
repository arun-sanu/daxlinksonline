import { prisma } from '../utils/prisma.js';

function mask(value) {
  if (!value) return '';
  const v = String(value);
  return v.length <= 4 ? '****' : `${v.slice(0, 2)}****${v.slice(-2)}`;
}

export async function listSecrets({ workspaceId } = {}) {
  const where = {};
  if (workspaceId) where.workspaceId = workspaceId;
  const rows = await prisma.secret.findMany({ where, orderBy: { updatedAt: 'desc' } });
  return rows.map((s) => ({ id: s.id, workspaceId: s.workspaceId, key: s.key, valueMasked: s.valueMasked, updatedAt: s.updatedAt }));
}

export async function createSecret({ workspaceId, key, value, createdBy }) {
  const valueMasked = mask(value);
  const blob = Buffer.from(String(value), 'utf8');
  const row = await prisma.secret.create({ data: { workspaceId, key, valueMasked, valueBlob: blob, createdBy } });
  return { id: row.id, workspaceId: row.workspaceId, key: row.key, valueMasked: row.valueMasked, updatedAt: row.updatedAt };
}

export async function deleteSecret(id) {
  await prisma.secret.delete({ where: { id } });
  return { success: true };
}

export async function rotateSecret(id, { newValue }) {
  const valueMasked = mask(newValue);
  const blob = Buffer.from(String(newValue), 'utf8');
  const row = await prisma.secret.update({ where: { id }, data: { valueMasked, valueBlob: blob } });
  return { id: row.id, valueMasked: row.valueMasked, updatedAt: row.updatedAt };
}

