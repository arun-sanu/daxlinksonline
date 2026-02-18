// Removed duplicate handlePurgeIntegrationCredentials declaration
import { z } from 'zod';
import {
  listIntegrations,
  createIntegration,
  createIntegrationCredential,
  testIntegration,
  renameIntegration,
  getIntegrationDetail,
  updateIntegrationCredential,
  deleteIntegrationCredential,
  deleteIntegration,
  purgeIntegrationCredentials
} from '../services/integrationService.js';
import { recordAudit } from '../services/auditService.js';
import { AVAILABLE_EXCHANGES } from '../data/exchanges.js';
import { openIntegrationsStream, publishIntegrationsEvent } from '../services/integrationRealtimeService.js';

const workspaceParamSchema = z.object({ workspaceId: z.string().uuid() });

const integrationParamSchema = z.object({
  workspaceId: z.string().uuid(),
  integrationId: z.string().uuid()
});

const credentialParamSchema = z.object({
  workspaceId: z.string().uuid(),
  integrationId: z.string().uuid(),
  credentialId: z.string().uuid()
});

const createIntegrationSchema = z.object({
  exchange: z.string().min(2),
  environment: z.string().default('paper'),
  apiKey: z.string().min(4),
  apiSecret: z.string().min(4),
  passphrase: z.string().optional(),
  label: z.string().min(1).max(64).optional(),
  description: z.string().max(512).optional(),
  rateLimit: z.number().int().positive().optional(),
  bandwidth: z.string().optional()
});

const updateCredentialSchema = z
  .object({
    label: z.string().min(1).max(128).optional(),
    description: z.string().max(512).optional(),
    environment: z.string().max(32).optional()
  })
  .refine((o) => Object.keys(o).length > 0, 'At least one field must be provided');

const createCredentialSchema = z.object({
  apiKey: z.string().min(4),
  apiSecret: z.string().min(4),
  passphrase: z.string().optional()
});

function broadcastSnapshot(workspaceId, reason, details = {}) {
  void (async () => {
    try {
      const integrations = await listIntegrations(workspaceId);
      publishIntegrationsEvent(workspaceId, 'integrations.snapshot', {
        reason,
        details,
        generatedAt: new Date().toISOString(),
        integrations
      });
    } catch (error) {
      console.warn('[integrations:realtime] failed to publish snapshot', error?.message || error);
    }
  })();
}

export async function handleListIntegrations(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const integrations = await listIntegrations(workspaceId);
    res.json(integrations);
  } catch (error) {
    next(error);
  }
}

export async function handleCreateIntegration(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const payload = createIntegrationSchema.parse(req.body);
    const integration = await createIntegration(workspaceId, payload);
    res.status(201).json(integration);
    broadcastSnapshot(workspaceId, 'integration.created', { integrationId: integration.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function handleTestIntegration(req, res, next) {
  try {
    const { workspaceId, integrationId } = {
      workspaceId: z.string().uuid().parse(req.params.workspaceId),
      integrationId: z.string().uuid().parse(req.params.integrationId)
    };
    try {
      await recordAudit({
        userId: req.user.id,
        action: 'DECRYPT_EXCHANGE_KEY',
        entityType: 'Workspace',
        entityId: workspaceId,
        summary: `integration=${integrationId}`
      });
    } catch {}
    const result = await testIntegration(workspaceId, integrationId);
    res.json(result);
    broadcastSnapshot(workspaceId, 'integration.tested', { integrationId, status: result?.status || null });
  } catch (error) {
    next(error);
  }
}

export async function handleRenameIntegration(req, res, next) {
  try {
    const workspaceId = z.string().uuid().parse(req.params.workspaceId);
    const integrationId = z.string().uuid().parse(req.params.integrationId);
    const patch = z
      .object({
        label: z.string().min(1).max(64).optional(),
        description: z.string().max(512).optional()
      })
      .refine((o) => o.label || o.description, 'At least one field must be provided')
      .parse(req.body || {});
    const updated = await renameIntegration(workspaceId, integrationId, patch);
    res.json(updated);
    broadcastSnapshot(workspaceId, 'integration.updated', { integrationId });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleListAvailableExchanges(_req, res, next) {
  try {
    res.json(AVAILABLE_EXCHANGES);
  } catch (error) {
    next(error);
  }
}

export async function handleGetIntegrationDetail(req, res, next) {
  try {
    const { workspaceId, integrationId } = integrationParamSchema.parse(req.params);
    const detail = await getIntegrationDetail(workspaceId, integrationId);
    res.json(detail);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleIntegrationsStream(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const connection = openIntegrationsStream(workspaceId, res);
    const dispose = () => connection.close();
    req.on('close', dispose);
    req.on('aborted', dispose);

    const integrations = await listIntegrations(workspaceId);
    connection.send('integrations.snapshot', {
      reason: 'initial',
      generatedAt: new Date().toISOString(),
      integrations
    });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    if (res.headersSent) {
      try {
        res.end();
      } catch {}
      return;
    }
    next(error);
  }
}

export async function handleCreateIntegrationCredential(req, res, next) {
  try {
    const { workspaceId, integrationId } = integrationParamSchema.parse(req.params);
    const payload = createCredentialSchema.parse(req.body);
    const created = await createIntegrationCredential(workspaceId, integrationId, payload);
    res.status(201).json(created);
    broadcastSnapshot(workspaceId, 'integration.credential.created', { integrationId, credentialId: created.id });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleUpdateIntegrationCredential(req, res, next) {
  try {
    const { workspaceId, integrationId, credentialId } = credentialParamSchema.parse(req.params);
    const patch = updateCredentialSchema.parse(req.body || {});
    const updated = await updateIntegrationCredential(workspaceId, integrationId, credentialId, patch);
    res.json(updated);
    broadcastSnapshot(workspaceId, 'integration.credential.updated', { integrationId, credentialId });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleDeleteIntegrationCredential(req, res, next) {
  try {
    const { workspaceId, integrationId, credentialId } = credentialParamSchema.parse(req.params);
    const result = await deleteIntegrationCredential(workspaceId, integrationId, credentialId);
    res.json(result);
    broadcastSnapshot(workspaceId, 'integration.credential.deleted', { integrationId, credentialId });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleDeleteIntegration(req, res, next) {
  try {
    const { workspaceId, integrationId } = integrationParamSchema.parse(req.params);
    const result = await deleteIntegration(workspaceId, integrationId);
    res.json(result);
    broadcastSnapshot(workspaceId, 'integration.deleted', { integrationId });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handlePurgeIntegrationCredentials(req, res, next) {
  try {
    const { workspaceId, integrationId } = integrationParamSchema.parse(req.params);
    const result = await purgeIntegrationCredentials(workspaceId, integrationId);
    res.json(result);
    broadcastSnapshot(workspaceId, 'integration.credentials.purged', { integrationId });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}
