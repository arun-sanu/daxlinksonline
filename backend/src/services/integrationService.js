// Purge all credentials for an integration (except the currently active one if desired)
export async function purgeIntegrationCredentials(workspaceId, integrationId) {
  // Find the integration and its credential
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credential: true }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  // Delete the credential if it exists
  if (integration.credential) {
    await prisma.$transaction([
      prisma.integrationCredential.delete({ where: { id: integration.credential.id } }),
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
          eventType: 'integration.credential.purged',
          detail: 'All credentials purged by user'
        }
      })
    ]);
  }
  return { success: true };
}
import { prisma } from '../utils/prisma.js';
import { maskCredential, createCredentialReference } from './workspaceService.js';
import { createExchange } from '../sdk/index.js';
import { encrypt, decrypt } from '../lib/kms.js';

function normalizeSecret(value, label) {
  const trimmed = typeof value === 'string' ? value.trim() : String(value || '').trim();
  if (!trimmed) {
    throw Object.assign(new Error(`${label} is empty after trimming`), { status: 400 });
  }
  return trimmed;
}

function normalizeOptionalSecret(value) {
  if (value === undefined || value === null) return null;
  const trimmed = typeof value === 'string' ? value.trim() : String(value || '').trim();
  return trimmed || null;
}

function logCredentialSnapshot({ exchange, environment, integrationId, apiKey, apiSecret, passphrase }) {
  try {
    const parts = [
      `[integration:test] exchange=${exchange}`,
      `env=${environment || 'live'}`,
      `integration=${integrationId}`,
      `key=${maskCredential(apiKey)}`,
      `secret=${maskCredential(apiSecret)}`
    ];
    if (passphrase) {
      parts.push(`pass=${maskCredential(passphrase)}`);
    }
    console.log(parts.join(' '));
  } catch {
    // Logging must never break execution
  }
}

export async function listIntegrations(workspaceId) {
  return prisma.integration.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' }
  });
}

export async function createIntegration(workspaceId, payload) {
  const apiKey = normalizeSecret(payload.apiKey, 'API key');
  const apiSecret = normalizeSecret(payload.apiSecret, 'API secret');
  const passphrase = normalizeOptionalSecret(payload.passphrase);
  const credentialRef = createCredentialReference(apiSecret);
  const passphraseMasked = passphrase ? maskCredential(passphrase) : null;

  return prisma.$transaction(async (tx) => {
    const integration = await tx.integration.create({
      data: {
        workspaceId,
        label: payload.label || null,
        description: payload.description || null,
        exchange: payload.exchange,
        environment: payload.environment,
        apiKeyMasked: maskCredential(apiKey),
        passphraseMasked,
        credentialRef,
        rateLimit: payload.rateLimit ?? 5,
        bandwidth: payload.bandwidth ?? '1.0 Mbps',
        status: 'pending'
      }
    });

    // Encrypt credentials at rest
    const encKey = encrypt(apiKey);
    const encSecret = encrypt(apiSecret);
    const encPass = passphrase ? encrypt(passphrase) : null;

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
    const apiKey = normalizeSecret(decrypt(integration.credential.apiKey), 'Decrypted API key');
    const apiSecret = normalizeSecret(decrypt(integration.credential.apiSecret), 'Decrypted API secret');
    const passphrase = integration.credential.passphrase ? normalizeOptionalSecret(decrypt(integration.credential.passphrase)) : undefined;

    logCredentialSnapshot({
      exchange: integration.exchange,
      environment: integration.environment,
      integrationId,
      apiKey,
      apiSecret,
      passphrase
    });

    const exchange = createExchange({
      exchange: integration.exchange,
      environment: integration.environment,
      apiKey,
      apiSecret,
      passphrase
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

export async function purgeIntegrationCredentials(workspaceId, integrationId) {
  const existing = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credential: true }
  });

  if (!existing) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (existing.credential) {
      await tx.integrationCredential.delete({ where: { id: existing.credential.id } });
    }
    await tx.integration.update({
      where: { id: integrationId },
      data: {
        status: 'pending',
        apiKeyMasked: null,
        passphraseMasked: null,
        lastTestedAt: null,
        credentialRef: null
      }
    });
    await tx.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.credential.purged',
        detail: 'All credentials removed'
      }
    });
  });

  return { status: 'pending' };
}
