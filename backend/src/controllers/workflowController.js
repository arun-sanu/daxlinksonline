import { z } from 'zod';
import { listWorkflowEvents, getWorkspaceWorkflowConfig, saveWorkspaceWorkflowConfig, simulateRules } from '../services/workflowService.js';
import { prisma } from '../utils/prisma.js';

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  edgeKey: z.string().optional(),
  since: z.string().datetime().optional(),
  limit: z
    .preprocess((val) => Number(val || 20), z.number().int().positive().max(100))
    .optional()
});

export async function handleListWorkflowEvents(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const parsed = querySchema.parse(req.query || {});
    await assertWorkspaceAccess(parsed.workspaceId, req.user.id);
    const events = await listWorkflowEvents({
      workspaceId: parsed.workspaceId,
      edgeKey: parsed.edgeKey,
      since: parsed.since,
      limit: parsed.limit || 20
    });
    res.json({ events, nextCursor: null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

const ruleSchema = z.object({
  source: z.object({
    type: z.literal('webhook'),
    id: z.string().uuid()
  }),
  destination: z.object({
    type: z.literal('integration'),
    id: z.string().uuid()
  }),
  symbols: z.array(z.string()).optional(),
  allowedSides: z.array(z.string()).optional(),
  orderType: z.string().optional(),
  positionSizeValue: z.number().optional(),
  minNotional: z.number().optional(),
  riskFlags: z.array(z.string()).optional(),
  enabled: z.boolean().optional()
  });

const applySchema = z.object({
  workspaceId: z.string().uuid(),
  rules: z.array(ruleSchema)
});

const configQuerySchema = z.object({
  workspaceId: z.string().uuid()
});

async function assertWorkspaceAccess(workspaceId, userId) {
  const ws = await prisma.workspace.findFirst({ where: { id: workspaceId } });
  if (!ws) {
    const err = new Error('Workspace not found');
    err.status = 404;
    throw err;
  }
  if (ws.ownerId && ws.ownerId !== userId) {
    const err = new Error('Not your workspace');
    err.status = 403;
    throw err;
  }
  return ws;
}

export async function handleGetWorkflowConfig(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { workspaceId } = configQuerySchema.parse(req.query || {});
    await assertWorkspaceAccess(workspaceId, req.user.id);
    const workflowConfig = await getWorkspaceWorkflowConfig(workspaceId);
    res.json({ workflowConfig });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function applyWorkflow(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = applySchema.parse(req.body || {});
    await assertWorkspaceAccess(payload.workspaceId, req.user.id);

    const errors = [];

    // Preload webhooks/integrations to validate existence
    const [webhooks, integrations] = await Promise.all([
      prisma.webhook.findMany({ where: { workspaceId: payload.workspaceId }, select: { id: true } }),
      prisma.integration.findMany({ where: { workspaceId: payload.workspaceId }, select: { id: true } })
    ]);
    const webhookIds = new Set(webhooks.map((w) => w.id));
    const integrationIds = new Set(integrations.map((i) => i.id));

    payload.rules.forEach((rule, idx) => {
      if (rule.source.type !== 'webhook') {
        errors.push(`Rule ${idx}: source.type must be webhook`);
      }
      if (rule.destination.type !== 'integration') {
        errors.push(`Rule ${idx}: destination.type must be integration`);
      }
      if (!webhookIds.has(rule.source.id)) {
        errors.push(`Rule ${idx}: webhook not found in workspace`);
      }
      if (!integrationIds.has(rule.destination.id)) {
        errors.push(`Rule ${idx}: integration not found in workspace`);
      }
      if (rule.positionSizeValue != null && !(Number(rule.positionSizeValue) > 0)) {
        errors.push(`Rule ${idx}: positionSizeValue must be > 0`);
      }
      if (rule.minNotional != null && !(Number(rule.minNotional) >= 0)) {
        errors.push(`Rule ${idx}: minNotional must be >= 0`);
      }
      if (rule.symbols && !Array.isArray(rule.symbols)) {
        errors.push(`Rule ${idx}: symbols must be array`);
      }
      if (rule.allowedSides && !Array.isArray(rule.allowedSides)) {
        errors.push(`Rule ${idx}: allowedSides must be array`);
      }
    });

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const currentCfg = await getWorkspaceWorkflowConfig(payload.workspaceId);
    const nextCfg = {
      ...currentCfg,
      rules: payload.rules
    };
    const saved = await saveWorkspaceWorkflowConfig(payload.workspaceId, nextCfg);
    res.json({ workflowConfig: saved });
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}

export async function simulateRouting(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { workspaceId, source, signal } = req.body || {};
    if (!workspaceId || !source || !signal) {
      return res.status(400).json({ error: 'workspaceId, source, and signal are required' });
    }
    await assertWorkspaceAccess(workspaceId, req.user.id);
    const cfg = await getWorkspaceWorkflowConfig(workspaceId);
    const { matchedRules, skippedRules } = await simulateRules({ workspaceId, rules: cfg.rules || [], source, signal });
    res.json({ matchedRules, skippedRules });
  } catch (error) {
    next(error);
  }
}

export async function listExecutions(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { workspaceId, integrationId, sourceWebhookId, startTime, endTime, limit } = req.query || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    await assertWorkspaceAccess(workspaceId, req.user.id);

    const where = {
      integration: { workspaceId }
    };
    if (integrationId) where.integrationId = integrationId;
    if (sourceWebhookId) {
      where.payload = { path: ['raw', 'source', 'id'], equals: sourceWebhookId };
    }

    if (startTime) {
      const start = new Date(String(startTime));
      if (!Number.isNaN(start.getTime())) {
        where.createdAt = { ...(where.createdAt || {}), gte: start };
      }
    }
    if (endTime) {
      const end = new Date(String(endTime));
      if (!Number.isNaN(end.getTime())) {
        where.createdAt = { ...(where.createdAt || {}), lte: end };
      }
    }

    const rows = await prisma.forwardedSignal.findMany({
      where,
      orderBy: req.path.includes('timeline') ? { createdAt: 'asc' } : { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200)
    });

    const executions = rows.map((row) => {
      const payload = row.payload || {};
      const mappedOrder = payload.raw?.mappedOrder || payload.mappedOrder || null;
      return {
        id: row.id,
        timestamp: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
        ruleId: payload.raw?.ruleId || payload.ruleId || null,
        status: row.status,
        sourceWebhookId: payload.raw?.source?.id || null,
        destinationIntegrationId: row.integrationId,
        transactionId: payload.executionResult?.orderId || payload.transactionId || null,
        mappedOrder,
        attempts: row.attempts || 0,
        lastError: row.error || null,
        responsePayload: payload.executionResult || null,
        symbol: mappedOrder?.symbol || row.symbol || null,
        size: mappedOrder?.size
      };
    });

    res.json(executions);
  } catch (error) {
    next(error);
  }
}
