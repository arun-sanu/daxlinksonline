import { z } from 'zod';
import { listIntegrations, createIntegration, testIntegration, renameIntegration } from '../services/integrationService.js';
import { recordAudit } from '../services/auditService.js';
import { AVAILABLE_EXCHANGES } from '../data/exchanges.js';

function requireDev(req, res) {
  const role = String(req?.user?.role || '').toLowerCase();
  if (!['admin', 'developer'].includes(role)) {
    res.status(403).json({ error: 'Dev-only' });
    return false;
  }
  return true;
}

const workspaceParamSchema = z.object({
  workspaceId: z.string().uuid()
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

export async function handleListIntegrations(req, res, next) {
  try {
    if (!requireDev(req, res)) return;
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const integrations = await listIntegrations(workspaceId);
    res.json(integrations);
  } catch (error) {
    next(error);
  }
}

export async function handleCreateIntegration(req, res, next) {
  try {
    if (!requireDev(req, res)) return;
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const payload = createIntegrationSchema.parse(req.body);
    const integration = await createIntegration(workspaceId, payload);
    res.status(201).json(integration);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function handleTestIntegration(req, res, next) {
  try {
    if (!requireDev(req, res)) return;
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
  } catch (error) {
    next(error);
  }
}

export async function handleRenameIntegration(req, res, next) {
  try {
    if (!requireDev(req, res)) return;
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
