import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma.js';

function mask(value) {
  if (!value) return null;
  const v = String(value);
  return v.length <= 4 ? '****' : `${v.slice(0, 4)}****`;
}

export async function listDatabases() {
  const rows = await prisma.databaseInstance.findMany({ orderBy: { createdAt: 'desc' } });
  return rows;
}

export async function getDatabase(dbId) {
  const row = await prisma.databaseInstance.findUnique({ where: { id: dbId } });
  if (!row) {
    const err = new Error('Database not found');
    err.status = 404;
    throw err;
  }
  return row;
}

export async function createDatabase({
  name,
  provider = 'self_hosted',
  engine = 'postgres',
  version = '16',
  region = 'us-east',
  sizeTier = 'free',
  storageGb = 10,
  computeClass = 'standard',
  workspaceId = null,
  createdByUserId
}) {
  // Simulated provision: generate connection details and mark ready.
  const database = `db_${randomUUID().slice(0, 8)}`;
  const username = `u_${randomUUID().slice(0, 6)}`;
  const password = randomUUID().replace(/-/g, '').slice(0, 24);
  const host = `${database}.internal.daxlinks`; // placeholder
  const port = 5432;

  const row = await prisma.databaseInstance.create({
    data: {
      name,
      provider,
      engine,
      version,
      region,
      sizeTier,
      storageGb,
      computeClass,
      status: 'ready',
      host,
      port,
      database,
      username,
      passwordMasked: mask(password),
      sslRequired: true,
      providerId: null,
      workspaceId,
      createdByUserId
    }
  });
  return row;
}

export async function rotateDatabaseCredentials(dbId) {
  const row = await getDatabase(dbId);
  const newPassword = randomUUID().replace(/-/g, '').slice(0, 24);
  const updated = await prisma.databaseInstance.update({
    where: { id: dbId },
    data: {
      passwordMasked: mask(newPassword),
      updatedAt: new Date()
    }
  });
  return updated;
}

export async function deleteDatabase(dbId) {
  await getDatabase(dbId);
  await prisma.databaseInstance.delete({ where: { id: dbId } });
  return { success: true };
}

