import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { encrypt } from '../lib/kms.js';

function present(account) {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    name: account.name,
    venue: account.venue,
    isSandbox: account.isSandbox,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function encryptToBase64(secret) {
  const enc = encrypt(secret);
  return enc.data.toString('base64');
}

export async function listExchangeAccounts(workspaceId, filters = {}) {
  const where = { workspaceId };
  if (filters.venue) {
    where.venue = filters.venue;
  }
  const accounts = await prisma.exchangeAccount.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
  return accounts.map(present);
}

export async function createExchangeAccount(workspaceId, payload) {
  const created = await prisma.exchangeAccount.create({
    data: {
      workspaceId,
      name: payload.name,
      venue: payload.venue,
      apiKeyEnc: encryptToBase64(payload.apiKey),
      apiSecretEnc: encryptToBase64(payload.apiSecret),
      passphraseEnc: payload.passphrase ? encryptToBase64(payload.passphrase) : null,
      isSandbox: Boolean(payload.isSandbox)
    }
  });
  return present(created);
}

export async function deleteExchangeAccount(workspaceId, exchangeAccountId) {
  const existing = await prisma.exchangeAccount.findFirst({
    where: { id: exchangeAccountId, workspaceId }
  });
  if (!existing) {
    throw Object.assign(new Error('Exchange account not found'), { status: 404 });
  }

  try {
    await prisma.exchangeAccount.delete({ where: { id: exchangeAccountId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw Object.assign(new Error('Exchange account is in use and cannot be deleted'), { status: 400 });
    }
    throw err;
  }
  return present(existing);
}
