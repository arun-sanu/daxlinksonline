import { prisma } from '../utils/prisma.js';
import { maskCredential, createCredentialReference } from './workspaceService.js';
import { createExchange } from '../sdk/index.js';
import { encrypt, decrypt } from '../lib/kms.js';
import { getWorkspaceWorkflowConfig, saveWorkspaceWorkflowConfig } from './workflowService.js';

const EMPTY_API_KEY_MASK = '****';
export const SUPPORTED_INTEGRATION_CONTROL_ACTIONS = Object.freeze(['pause', 'resume', 'restart', 'delete', 'unlink']);

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

function isUnsupportedConnectivityError(error) {
  if (!error) return false;
  const message = typeof error === 'string' ? error : error.message || '';
  return /api not supported for exchange/i.test(message);
}

function sortCredentials(credentials = []) {
  return [...credentials].sort((a, b) => {
    const aUpdated = new Date(a?.updatedAt || 0).getTime();
    const bUpdated = new Date(b?.updatedAt || 0).getTime();
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;
    const aCreated = new Date(a?.createdAt || 0).getTime();
    const bCreated = new Date(b?.createdAt || 0).getTime();
    return bCreated - aCreated;
  });
}

function resolvePrimaryCredential(integration) {
  const ordered = sortCredentials(integration?.credentials || []);
  return ordered.length ? ordered[0] : null;
}

function summarizeCredentialSecrets({ apiKey, apiSecret, passphrase }) {
  return {
    apiKeyMasked: maskCredential(apiKey),
    passphraseMasked: passphrase ? maskCredential(passphrase) : null,
    credentialRef: createCredentialReference(apiSecret) || `cred_${Date.now()}`
  };
}

function decodeCredentialSecrets(credential) {
  const apiKey = normalizeSecret(decrypt(credential.apiKey), 'Decrypted API key');
  const apiSecret = normalizeSecret(decrypt(credential.apiSecret), 'Decrypted API secret');
  const passphrase = credential.passphrase ? normalizeOptionalSecret(decrypt(credential.passphrase)) : null;
  return {
    apiKey,
    apiSecret,
    passphrase,
    ...summarizeCredentialSecrets({ apiKey, apiSecret, passphrase })
  };
}

function buildIntegrationResetData() {
  return {
    status: 'pending',
    apiKeyMasked: EMPTY_API_KEY_MASK,
    passphraseMasked: null,
    lastTestedAt: null,
    credentialRef: createCredentialReference(`empty-${Date.now()}`) || `cred_empty_${Date.now()}`
  };
}

function buildEncryptedCredential(payload) {
  const apiKey = normalizeSecret(payload.apiKey, 'API key');
  const apiSecret = normalizeSecret(payload.apiSecret, 'API secret');
  const passphrase = normalizeOptionalSecret(payload.passphrase);

  const encKey = encrypt(apiKey);
  const encSecret = encrypt(apiSecret);
  const encPass = passphrase ? encrypt(passphrase) : null;

  return {
    apiKey,
    apiSecret,
    passphrase,
    encKey,
    encSecret,
    encPass,
    summary: summarizeCredentialSecrets({ apiKey, apiSecret, passphrase })
  };
}

function toCredentialView(integration, credential, { index = 0, primaryCredentialId = null } = {}) {
  const safeMask = (value) => {
    try {
      return maskCredential(decrypt(value));
    } catch {
      return '****';
    }
  };

  const isPrimary = primaryCredentialId ? credential.id === primaryCredentialId : index === 0;

  return {
    id: credential.id,
    label: isPrimary ? integration.label || 'Primary' : `Credential ${index + 1}`,
    apiKeyMasked: isPrimary ? integration.apiKeyMasked || safeMask(credential.apiKey) : safeMask(credential.apiKey),
    apiSecretMasked: safeMask(credential.apiSecret),
    passphraseMasked: isPrimary
      ? integration.passphraseMasked || (credential.passphrase ? safeMask(credential.passphrase) : null)
      : credential.passphrase
        ? safeMask(credential.passphrase)
        : null,
    subAccount: null,
    description: isPrimary ? integration.description || null : null,
    environment: integration.environment,
    isPrimary,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt
  };
}

function viewForCredential(integration, credentials, credentialId) {
  const ordered = sortCredentials(credentials);
  const primary = ordered[0] || null;
  const index = ordered.findIndex((credential) => credential.id === credentialId);
  if (index < 0) return null;
  return toCredentialView(integration, ordered[index], {
    index,
    primaryCredentialId: primary ? primary.id : null
  });
}

function normalizeIntegrationControlAction(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!SUPPORTED_INTEGRATION_CONTROL_ACTIONS.includes(normalized)) {
    throw Object.assign(
      new Error(
        `Unsupported integration action "${value}". Supported actions: ${SUPPORTED_INTEGRATION_CONTROL_ACTIONS.join(', ')}`
      ),
      { status: 400 }
    );
  }
  return normalized;
}

async function assertIntegrationInWorkspace(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: {
      id: integrationId,
      workspaceId
    }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }
  return integration;
}

async function cleanupWorkflowReferencesForIntegration(workspaceId, integrationId) {
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const currentRules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const runtimeConfigsRaw = cfg?.tradeBots?.runtimeConfigs;
  const runtimeConfigs =
    runtimeConfigsRaw && typeof runtimeConfigsRaw === 'object' && !Array.isArray(runtimeConfigsRaw)
      ? runtimeConfigsRaw
      : {};

  const nextRules = currentRules.filter(
    (rule) => !(rule?.destination?.type === 'integration' && rule?.destination?.id === integrationId)
  );
  const removedRules = currentRules.length - nextRules.length;
  let runtimeChanged = false;
  let clearedRuntimeLinks = 0;
  const nextRuntimeConfigs = {};
  for (const [botId, entry] of Object.entries(runtimeConfigs)) {
    const safeEntry = entry && typeof entry === 'object' ? { ...entry } : {};
    const safeLinks = safeEntry.links && typeof safeEntry.links === 'object' ? { ...safeEntry.links } : {};
    if (safeLinks.integrationId === integrationId) {
      safeLinks.integrationId = null;
      safeLinks.updatedAt = new Date().toISOString();
      runtimeChanged = true;
      clearedRuntimeLinks += 1;
    }
    nextRuntimeConfigs[botId] = { ...safeEntry, links: safeLinks };
  }

  const rulesChanged = nextRules.length !== currentRules.length;
  if (!rulesChanged && !runtimeChanged) {
    return { changed: false, removedRules: 0, clearedRuntimeLinks: 0 };
  }

  const nextConfig = {
    ...cfg,
    rules: nextRules,
    tradeBots: {
      ...(cfg.tradeBots && typeof cfg.tradeBots === 'object' ? cfg.tradeBots : {}),
      runtimeConfigs: nextRuntimeConfigs
    }
  };

  await saveWorkspaceWorkflowConfig(workspaceId, nextConfig);
  return {
    changed: true,
    removedRules,
    clearedRuntimeLinks
  };
}

export async function listIntegrations(workspaceId) {
  return prisma.integration.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' }
  });
}

export async function createIntegration(workspaceId, payload) {
  const encrypted = buildEncryptedCredential(payload);

  return prisma.$transaction(async (tx) => {
    const integration = await tx.integration.create({
      data: {
        workspaceId,
        label: payload.label || null,
        description: payload.description || null,
        exchange: payload.exchange,
        environment: payload.environment,
        apiKeyMasked: encrypted.summary.apiKeyMasked,
        passphraseMasked: encrypted.summary.passphraseMasked,
        credentialRef: encrypted.summary.credentialRef,
        rateLimit: payload.rateLimit ?? 5,
        bandwidth: payload.bandwidth ?? '1.0 Mbps',
        status: 'pending'
      }
    });

    await tx.integrationCredential.create({
      data: {
        integrationId: integration.id,
        apiKey: encrypted.encKey.data,
        apiSecret: encrypted.encSecret.data,
        passphrase: encrypted.encPass ? encrypted.encPass.data : null,
        iv: encrypted.encKey.iv
      }
    });

    return integration;
  });
}

export async function createIntegrationCredential(workspaceId, integrationId, payload) {
  const existing = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId }
  });
  if (!existing) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  const encrypted = buildEncryptedCredential(payload);

  const { credential, updatedIntegration } = await prisma.$transaction(async (tx) => {
    const createdCredential = await tx.integrationCredential.create({
      data: {
        integrationId,
        apiKey: encrypted.encKey.data,
        apiSecret: encrypted.encSecret.data,
        passphrase: encrypted.encPass ? encrypted.encPass.data : null,
        iv: encrypted.encKey.iv
      }
    });

    const integration = await tx.integration.update({
      where: { id: integrationId },
      data: {
        status: 'pending',
        lastTestedAt: null,
        apiKeyMasked: encrypted.summary.apiKeyMasked,
        passphraseMasked: encrypted.summary.passphraseMasked,
        credentialRef: encrypted.summary.credentialRef
      }
    });

    await tx.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.credential.created',
        detail: 'Credential added by user'
      }
    });

    return {
      credential: createdCredential,
      updatedIntegration: integration
    };
  });

  return toCredentialView(updatedIntegration, credential, {
    index: 0,
    primaryCredentialId: credential.id
  });
}

export async function getIntegrationDetail(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: {
      credentials: { orderBy: { updatedAt: 'desc' } },
      credentialEvents: { orderBy: { createdAt: 'desc' }, take: 50 }
    }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  const orderedCredentials = sortCredentials(integration.credentials || []);
  const primaryCredentialId = orderedCredentials.length ? orderedCredentials[0].id : null;
  const credentials = orderedCredentials.map((credential, index) =>
    toCredentialView(integration, credential, { index, primaryCredentialId })
  );

  const logs = (integration.credentialEvents || []).map((evt) => ({
    id: evt.id,
    status: evt.eventType?.includes('failed') ? 'error' : 'info',
    message: evt.detail || evt.eventType || 'event',
    createdAt: evt.createdAt
  }));

  const { credentials: _omitCredentials, credentialEvents: _omitEvents, ...rest } = integration;
  return { ...rest, credentials, logs };
}

export async function testIntegration(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credentials: true }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  const primaryCredential = resolvePrimaryCredential(integration);
  if (!primaryCredential) {
    throw Object.assign(new Error('Integration credentials missing'), { status: 400 });
  }

  const now = new Date();
  try {
    const decoded = decodeCredentialSecrets(primaryCredential);
    let effectivePassphraseMasked = decoded.passphraseMasked;

    logCredentialSnapshot({
      exchange: integration.exchange,
      environment: integration.environment,
      integrationId,
      apiKey: decoded.apiKey,
      apiSecret: decoded.apiSecret,
      passphrase: decoded.passphrase
    });

    const exchange = createExchange({
      exchange: integration.exchange,
      environment: integration.environment,
      apiKey: decoded.apiKey,
      apiSecret: decoded.apiSecret,
      passphrase: decoded.passphrase || undefined
    });

    if (typeof exchange.testConnectivity === 'function') {
      try {
        await exchange.testConnectivity();
      } catch (err) {
        if (isUnsupportedConnectivityError(err)) {
          console.warn(`[integration:test] skipping testConnectivity for ${integration.exchange}: ${err.message}`);
        } else {
          throw err;
        }
      }
    }

    if (typeof exchange.exportCredentialState === 'function') {
      const exported = await exchange.exportCredentialState();
      if (exported?.passphrase) {
        const encPass = encrypt(exported.passphrase);
        effectivePassphraseMasked = maskCredential(exported.passphrase);
        await prisma.integrationCredential.update({
          where: { id: primaryCredential.id },
          data: { passphrase: encPass.data }
        });
      }
    }

    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: 'active',
        lastTestedAt: now,
        apiKeyMasked: decoded.apiKeyMasked,
        passphraseMasked: effectivePassphraseMasked,
        credentialRef: decoded.credentialRef
      }
    });

    await prisma.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.test.succeeded',
        detail: `Credential test succeeded (${primaryCredential.id})`
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

export async function controlIntegration(workspaceId, integrationId, action) {
  const normalizedAction = normalizeIntegrationControlAction(action);
  await assertIntegrationInWorkspace(workspaceId, integrationId);

  if (normalizedAction === 'delete') {
    return deleteIntegration(workspaceId, integrationId);
  }

  if (normalizedAction === 'restart') {
    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: 'pending',
        lastTestedAt: null
      }
    });
    await prisma.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.restarted',
        detail: 'Integration restart requested'
      }
    });
    const testResult = await testIntegration(workspaceId, integrationId);
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId }
    });
    return {
      action: normalizedAction,
      integration,
      testResult
    };
  }

  if (normalizedAction === 'unlink') {
    const unlinkResult = await cleanupWorkflowReferencesForIntegration(workspaceId, integrationId);
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId }
    });
    await prisma.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.unlinked',
        detail: unlinkResult?.changed
          ? `Integration unlinked from workflow references (rules=${unlinkResult.removedRules}, runtimeLinks=${unlinkResult.clearedRuntimeLinks})`
          : 'Integration unlink requested but no workflow references were linked'
      }
    });
    return {
      action: normalizedAction,
      integration,
      unlinkResult: unlinkResult || { changed: false, removedRules: 0, clearedRuntimeLinks: 0 }
    };
  }

  const status = normalizedAction === 'pause' ? 'paused' : 'active';
  const integration = await prisma.integration.update({
    where: { id: integrationId },
    data: {
      status
    }
  });
  await prisma.credentialEvent.create({
    data: {
      workspaceId,
      integrationId,
      eventType: normalizedAction === 'pause' ? 'integration.paused' : 'integration.resumed',
      detail: normalizedAction === 'pause' ? 'Integration paused by user' : 'Integration resumed by user'
    }
  });
  return {
    action: normalizedAction,
    integration
  };
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
    include: { credentials: true }
  });
  if (!existing) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  const credential = (existing.credentials || []).find((item) => item.id === credentialId);
  if (!credential) {
    throw Object.assign(new Error('Integration credential not found'), { status: 404 });
  }

  const update = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'label')) update.label = patch.label || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) update.description = patch.description || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'environment')) update.environment = patch.environment || existing.environment;

  const updatedIntegration = Object.keys(update).length
    ? await prisma.integration.update({ where: { id: integrationId }, data: update })
    : existing;

  const view = viewForCredential(updatedIntegration, existing.credentials || [], credentialId);
  if (!view) {
    throw Object.assign(new Error('Integration credential not found'), { status: 404 });
  }
  return view;
}

export async function deleteIntegrationCredential(workspaceId, integrationId, credentialId) {
  const existing = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    include: { credentials: true }
  });
  if (!existing) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  const credentials = existing.credentials || [];
  const target = credentials.find((credential) => credential.id === credentialId);
  if (!target) {
    throw Object.assign(new Error('Integration credential not found'), { status: 404 });
  }

  const remaining = sortCredentials(credentials.filter((credential) => credential.id !== credentialId));

  await prisma.$transaction(async (tx) => {
    await tx.integrationCredential.delete({ where: { id: credentialId } });

    if (remaining.length > 0) {
      const nextPrimary = decodeCredentialSecrets(remaining[0]);
      await tx.integration.update({
        where: { id: integrationId },
        data: {
          status: 'pending',
          lastTestedAt: null,
          apiKeyMasked: nextPrimary.apiKeyMasked,
          passphraseMasked: nextPrimary.passphraseMasked,
          credentialRef: nextPrimary.credentialRef
        }
      });
    } else {
      await tx.integration.update({
        where: { id: integrationId },
        data: buildIntegrationResetData()
      });
    }

    await tx.credentialEvent.create({
      data: {
        workspaceId,
        integrationId,
        eventType: 'integration.credential.deleted',
        detail: 'Credential removed by user'
      }
    });
  });

  return { success: true, remainingCredentials: remaining.length };
}

export async function purgeIntegrationCredentials(workspaceId, integrationId) {
  const existing = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    select: { id: true }
  });

  if (!existing) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.integrationCredential.deleteMany({ where: { integrationId } });
    await tx.integration.update({
      where: { id: integrationId },
      data: buildIntegrationResetData()
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

// Delete an entire integration and its credentials
export async function deleteIntegration(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, workspaceId },
    select: { id: true }
  });
  if (!integration) {
    throw Object.assign(new Error('Integration not found'), { status: 404 });
  }

  await prisma.integration.delete({ where: { id: integrationId } });
  await cleanupWorkflowReferencesForIntegration(workspaceId, integrationId);

  return { success: true };
}
