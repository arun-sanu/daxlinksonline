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

function toCredentialView(integration, credential) {
  const safeMask = (value) => {
    try {
      return maskCredential(decrypt(value));
    } catch {
      return '****';
    }
  };

  return {
    id: credential.id,
    label: integration.label || 'Primary',
    apiKeyMasked: integration.apiKeyMasked || safeMask(credential.apiKey),
    apiSecretMasked: safeMask(credential.apiSecret),
    passphraseMasked: integration.passphraseMasked || (credential.passphrase ? safeMask(credential.passphrase) : null),
    subAccount: null,
    description: integration.description || null,
    environment: integration.environment,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt
  };
}

export async function getIntegrationDetail(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: {
      credential: true,
      credentialEvents: { orderBy: { createdAt: 'desc' }, take: 50 }
    }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  const credentials = integration.credential ? [toCredentialView(integration, integration.credential)] : [];
  const logs = (integration.credentialEvents || []).map((evt) => ({
    id: evt.id,
    status: evt.eventType?.includes('failed') ? 'error' : 'info',
    message: evt.detail || evt.eventType || 'event',
    createdAt: evt.createdAt
  }));

  const { credential, credentialEvents, ...rest } = integration;
  return { ...rest, credentials, logs };
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

export async function updateIntegrationCredential(workspaceId, integrationId, credentialId, patch) {
  const existing = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credential: true }
  });
  if (!existing || !existing.credential || existing.credential.id !== credentialId) {
    throw Object.assign(new Error('Integration credential not found'), { status: 404 });
  }

  const update = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'label')) update.label = patch.label || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) update.description = patch.description || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'environment')) update.environment = patch.environment || existing.environment;

  const updated = Object.keys(update).length
    ? await prisma.integration.update({ where: { id: integrationId }, data: update })
    : existing;

  return toCredentialView(updated, existing.credential);
}

export async function deleteIntegrationCredential(workspaceId, integrationId, credentialId) {
  const existing = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credential: true }
  });
  if (!existing || !existing.credential || existing.credential.id !== credentialId) {
    throw Object.assign(new Error('Integration credential not found'), { status: 404 });
  }

  await prisma.$transaction([
    prisma.integrationCredential.delete({ where: { id: credentialId } }),
    prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: 'pending',
        apiKeyMasked: '****',
        passphraseMasked: null,
        lastTestedAt: null
      }
    }),
    prisma.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.credential.deleted',
        detail: 'Credential removed by user'
      }
    })
  ]);

  return { success: true };
}
