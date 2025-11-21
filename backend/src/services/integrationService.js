import { prisma } from '../utils/prisma.js';
import { maskCredential, createCredentialReference } from './workspaceService.js';
import { createExchange } from '../sdk/index.js';
import { encrypt, decrypt } from '../lib/kms.js';

export async function listIntegrations(workspaceId) {
  return prisma.integration.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' }
  });
}

export async function createIntegration(workspaceId, payload) {
  const credentialRef = createCredentialReference(payload.apiSecret);
  const passphraseMasked = payload.passphrase ? maskCredential(payload.passphrase) : null;

  return prisma.$transaction(async (tx) => {
    const integration = await tx.integration.create({
      data: {
        workspaceId,
        label: payload.label || null,
        description: payload.description || null,
        exchange: payload.exchange,
        environment: payload.environment,
        apiKeyMasked: maskCredential(payload.apiKey),
        passphraseMasked,
        credentialRef,
        rateLimit: payload.rateLimit ?? 5,
        bandwidth: payload.bandwidth ?? '1.0 Mbps',
        status: 'pending'
      }
    });

    // Encrypt credentials at rest
    const encKey = encrypt(payload.apiKey);
    const encSecret = encrypt(payload.apiSecret);
    const encPass = payload.passphrase ? encrypt(payload.passphrase) : null;

    await tx.integrationCredential.create({
      data: {
        integrationId: integration.id,
        apiKey: encKey.data,
        apiSecret: encSecret.data,
        passphrase: encPass ? encPass.data : null,
        iv: encKey.iv
      }
    });

    return integration;
  });
}

export async function testIntegration(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credential: true }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  if (!integration.credential) {
    throw Object.assign(new Error('Integration credentials missing'), { status: 400 });
  }

  const now = new Date();
  try {
    const exchange = createExchange({
      exchange: integration.exchange,
      environment: integration.environment,
      apiKey: decrypt(integration.credential.apiKey),
      apiSecret: decrypt(integration.credential.apiSecret),
      passphrase: integration.credential.passphrase ? decrypt(integration.credential.passphrase) : undefined
    });


    if (typeof exchange.testConnectivity === 'function') {
      await exchange.testConnectivity();
    }

    if (typeof exchange.exportCredentialState === 'function') {
      const exported = await exchange.exportCredentialState();
      if (exported?.passphrase) {
        const encPass = encrypt(exported.passphrase);
        await prisma.integrationCredential.update({
          where: { integrationId },
          data: { passphrase: encPass.data }
        });
        await prisma.integration.update({
          where: { id: integrationId },
          data: { passphraseMasked: maskCredential(exported.passphrase) }
        });
      }
    }

    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: 'active',
        lastTestedAt: now
      }
    });

    await prisma.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.test.succeeded',
        detail: 'Credential test succeeded'
      }
    });

    return {
      status: 'connected',
      rotatedAt: now.toISOString()
    };
  } catch (error) {
    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: 'error',
        lastTestedAt: now
      }
    });

    await prisma.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.test.failed',
        detail: error?.message || 'Credential test failed'
      }
    });

    return {
      status: 'error',
      error: error?.message || 'Credential test failed'
    };
  }
}

export async function renameIntegration(workspaceId, integrationId, patch) {
  const existing = await prisma.integration.findFirst({ where: { id: integrationId, workspaceId } });
  if (!existing) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }
  const data = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'label')) data.label = patch.label || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) data.description = patch.description || null;
  return prisma.integration.update({ where: { id: integrationId }, data });
}
