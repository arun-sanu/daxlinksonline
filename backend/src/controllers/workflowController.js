import { z } from 'zod';
import { listWorkflowEvents, getWorkspaceWorkflowConfig, saveWorkspaceWorkflowConfig, simulateRules } from '../services/workflowService.js';
import { prisma } from '../utils/prisma.js';
import crypto from 'crypto';
import { buildWebhookHostname } from '../lib/webhookDomains.js';

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
  id: z.string().min(1).optional(),
  source: z.object({
    type: z.literal('webhook'),
    id: z.string().min(1)
  }),
  destination: z.object({
    type: z.literal('integration'),
    id: z.string().uuid()
  }),
  enabled: z.boolean().optional(),
  conditions: z
    .object({
      symbols: z.array(z.string()).optional(),
      allowedSides: z.array(z.string()).optional(),
      minNotional: z.number().optional()
    })
    .partial()
    .optional(),
  mapping: z
    .object({
      orderType: z.string().optional(),
      positionSizeValue: z.number().optional(),
      positionSizeType: z.string().optional(),
      leverage: z.number().optional(),
      maxLeverage: z.number().optional()
    })
    .partial()
    .optional(),
  // Legacy fallbacks the UI may still send at top-level
  symbols: z.array(z.string()).optional(),
  allowedSides: z.array(z.string()).optional(),
  orderType: z.string().optional(),
  positionSizeValue: z.number().optional(),
  minNotional: z.number().optional(),
  riskFlags: z.array(z.string()).optional()
});

const applySchema = z.object({
  workspaceId: z.string().uuid(),
  rules: z.array(ruleSchema)
});

const configQuerySchema = z.object({
  workspaceId: z.string().uuid()
});

const nodeCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  label: z.string().min(1),
  nodeType: z.string().min(1),
  description: z.string().optional(),
  side: z.enum(['source', 'destination'])
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

export async function handleListNodes(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const { workspaceId } = configQuerySchema.parse(req.query || {});
    await assertWorkspaceAccess(workspaceId, req.user.id);
    const [webhooks, integrations, workflowConfig, userProfile, dnsRecords] = await Promise.all([
      prisma.webhook.findMany({ where: { workspaceId } }),
      prisma.integration.findMany({ where: { workspaceId } }),
      getWorkspaceWorkflowConfig(workspaceId),
      prisma.user.findUnique({
        where: { id: req.user.id },
        select: { webhookSubdomain: true, subdomainPrefix: true }
      }),
      prisma.dnsRecord.findMany({
        where: { userId: req.user.id, status: 'active' },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    const ingressRecords = (dnsRecords || []).map((record) => ({
      id: record.id,
      subdomain: record.subdomain,
      status: record.status,
      url: `https://${buildWebhookHostname(record.subdomain)}/webhook/tradingview`
    }));
    const prefix = userProfile?.subdomainPrefix || userProfile?.webhookSubdomain || ingressRecords[0]?.subdomain || null;
    const fallbackIngressUrl = prefix ? `https://${buildWebhookHostname(prefix)}/webhook/tradingview` : null;
    const ingressNodes = ingressRecords.map((record) => ({
      id: `tv:${record.subdomain}`,
      name: `TradingView (${record.subdomain})`,
      type: 'webhook',
      description: `Ingress: ${record.url}`,
      url: record.url,
      subdomain: record.subdomain,
      dnsRecords: [record]
    }));
    if (!ingressNodes.length && fallbackIngressUrl && prefix) {
      ingressNodes.push({
        id: `tv:${prefix}`,
        name: `TradingView (${prefix})`,
        type: 'webhook',
        description: `Ingress: ${fallbackIngressUrl}`,
        url: fallbackIngressUrl,
        subdomain: prefix,
        dnsRecords: [{ subdomain: prefix, url: fallbackIngressUrl }]
      });
    }
    const tradingviewIngress = {
      id: 'tradingview',
      name: 'TradingView (All)',
      type: 'webhook',
      description: fallbackIngressUrl ? `Ingress: ${fallbackIngressUrl}` : 'Inbound TradingView alerts',
      url: fallbackIngressUrl,
      subdomain: prefix,
      dnsRecords: ingressRecords
    };
    const webhookNodes = [tradingviewIngress, ...ingressNodes, ...webhooks];
    const normalizedIntegrations = (integrations || []).map((integration) => {
      const exchange = integration.exchange ? String(integration.exchange).toUpperCase() : 'EXCHANGE';
      const label = integration.label || exchange;
      const apiLabel = integration.apiKeyMasked ? `API ${integration.apiKeyMasked}` : '';
      return {
        ...integration,
        name: label,
        type: integration.exchange || 'exchange',
        exchange: integration.exchange || null,
        apiKeyMasked: integration.apiKeyMasked || null,
        description: apiLabel || integration.description || integration.environment || ''
      };
    });
    const customNodes = workflowConfig.customNodes || [];
    const bots = customNodes.filter((n) => n.side === 'source').map((n) => ({ id: n.id, name: n.label, type: n.nodeType, description: n.description }));
    const extraIntegrations = customNodes
      .filter((n) => n.side === 'destination')
      .map((n) => ({ id: n.id, name: n.label, type: n.nodeType, description: n.description }));
    res.json({ webhooks: webhookNodes, integrations: [...normalizedIntegrations, ...extraIntegrations], bots });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleCreateNode(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = nodeCreateSchema.parse(req.body || {});
    await assertWorkspaceAccess(payload.workspaceId, req.user.id);
    const id = payload.id || payload.nodeId || crypto.randomUUID();

    const currentCfg = await getWorkspaceWorkflowConfig(payload.workspaceId);
    const customNodes = Array.isArray(currentCfg.customNodes) ? currentCfg.customNodes : [];
    const nextNodes = [...customNodes.filter((n) => n.id !== id), { id, label: payload.label, nodeType: payload.nodeType, side: payload.side, description: payload.description }];
    await saveWorkspaceWorkflowConfig(payload.workspaceId, { ...currentCfg, customNodes: nextNodes });

    res.status(201).json({ id, label: payload.label, nodeType: payload.nodeType, side: payload.side, description: payload.description });
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

    const workflowCfg = await getWorkspaceWorkflowConfig(payload.workspaceId);
    const customNodes = Array.isArray(workflowCfg.customNodes) ? workflowCfg.customNodes : [];
    const customDestinationIds = customNodes.filter((n) => n.side === 'destination').map((n) => n.id);
    const customSourceIds = new Set(customNodes.filter((n) => n.side === 'source').map((n) => n.id));
    customDestinationIds.forEach((id) => integrationIds.add(id));
    const dnsSourceIds = new Set();
    if (req.user?.id) {
      const dns = await prisma.dnsRecord.findMany({ where: { userId: req.user.id, status: 'active' } });
      dns.forEach((row) => dnsSourceIds.add(`tv:${row.subdomain}`));
    }

    const sanitizedRules = payload.rules.map((rule, idx) => {
      const ruleId = rule.id || rule.ruleId || rule._id || undefined;
      const conditions = rule.conditions || {
        symbols: rule.symbols,
        allowedSides: rule.allowedSides,
        minNotional: rule.minNotional
      };
      const mapping = rule.mapping || {
        orderType: rule.orderType,
        positionSizeValue: rule.positionSizeValue,
        positionSizeType: rule.positionSizeType,
        leverage: rule.leverage,
        maxLeverage: rule.maxLeverage
      };

      if (rule.source.type !== 'webhook') {
        errors.push(`Rule ${idx}: source.type must be webhook`);
      }
      if (rule.destination.type !== 'integration') {
        errors.push(`Rule ${idx}: destination.type must be integration`);
      }
      if (!webhookIds.has(rule.source.id) && rule.source.id !== 'tradingview' && !customSourceIds.has(rule.source.id) && !dnsSourceIds.has(rule.source.id)) {
        errors.push(`Rule ${idx}: webhook not found in workspace`);
      }
      if (!integrationIds.has(rule.destination.id)) {
        errors.push(`Rule ${idx}: integration not found in workspace`);
      }
      if (mapping.positionSizeValue != null && !(Number(mapping.positionSizeValue) > 0)) {
        errors.push(`Rule ${idx}: positionSizeValue must be > 0`);
      }
      if (conditions.minNotional != null && !(Number(conditions.minNotional) >= 0)) {
        errors.push(`Rule ${idx}: minNotional must be >= 0`);
      }
      if (conditions.symbols && !Array.isArray(conditions.symbols)) {
        errors.push(`Rule ${idx}: symbols must be array`);
      }
      if (conditions.allowedSides && !Array.isArray(conditions.allowedSides)) {
        errors.push(`Rule ${idx}: allowedSides must be array`);
      }
      return {
        id: ruleId,
        source: rule.source,
        destination: rule.destination,
        enabled: rule.enabled !== false,
        conditions: {
          symbols: conditions.symbols,
          allowedSides: conditions.allowedSides,
          minNotional: conditions.minNotional
        },
        mapping: {
          orderType: mapping.orderType,
          positionSizeValue: mapping.positionSizeValue,
          positionSizeType: mapping.positionSizeType,
          leverage: mapping.leverage ?? mapping.maxLeverage
        },
        riskFlags: rule.riskFlags || []
      };
    });

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const currentCfg = await getWorkspaceWorkflowConfig(payload.workspaceId);
    const nextCfg = {
      ...currentCfg,
      rules: sanitizedRules
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
