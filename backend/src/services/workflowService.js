import { prisma } from '../utils/prisma.js';

export const SUPPORTED_WORKFLOW_CONTROL_ACTIONS = Object.freeze(['pause', 'resume', 'restart', 'delete']);

function normalizeWorkflowStatus(value = null) {
  const normalized = String(value || 'active')
    .trim()
    .toLowerCase();
  if (['paused', 'disabled', 'stop', 'stopped'].includes(normalized)) return 'paused';
  return 'active';
}

function normalizeWorkflowControlAction(value = null) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!SUPPORTED_WORKFLOW_CONTROL_ACTIONS.includes(normalized)) {
    throw Object.assign(
      new Error(
        `Unsupported workflow action "${value}". Supported actions: ${SUPPORTED_WORKFLOW_CONTROL_ACTIONS.join(', ')}`
      ),
      { status: 400 }
    );
  }
  return normalized;
}

function parseEdgeKey(edgeKey) {
  if (!edgeKey) return null;
  if (edgeKey.startsWith('src:webhook:') && edgeKey.endsWith('->server')) {
    const parts = edgeKey.split(':');
    const webhookId = parts[2]?.split('->')?.[0];
    return { kind: 'source', webhookId };
  }
  if (edgeKey.startsWith('server->dst:integration:')) {
    const parts = edgeKey.split(':');
    const integrationId = parts[2];
    return { kind: 'destination', integrationId };
  }
  return null;
}

function resolveMappedSize(mapping) {
  const positionSizeType = String(mapping?.positionSizeType || 'absolute').toLowerCase();
  const rawValue = mapping?.positionSizeValue;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  if (positionSizeType === 'percent') {
    return `${numeric}%`;
  }
  return numeric;
}

function mapForwardedSignalEvent(row, integration) {
  const status = (row.status || '').toLowerCase();
  const ok = ['succeeded', 'success', 'executed_success'].includes(status);
  const failed = ['failed', 'error', 'executed_error'].includes(status);
  const retrying = status === 'retrying';
  const skipped = status === 'skipped_no_rule';
  const severity = ok ? 'success' : failed ? 'error' : retrying ? 'warning' : skipped ? 'info' : 'info';
  const statusColor = ok ? 'green' : failed ? 'red' : retrying ? 'orange' : skipped ? 'grey' : 'blue';
  const exchange = integration?.exchange || 'exchange';
  const symbol = row.symbol || null;
  const side = row.side ? row.side.toUpperCase() : '';
  const type = row.type ? row.type.toUpperCase() : '';
  const amount = row.amount != null ? row.amount : null;
  const price = row.price != null ? row.price : null;
   const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
   const processedAt = row.executedAt instanceof Date ? row.executedAt : row.executedAt ? new Date(row.executedAt) : null;
   const latencyMs = processedAt && createdAt ? Math.max(0, processedAt.getTime() - createdAt.getTime()) : null;
  const summaryParts = [
    ok ? 'Order routed' : failed ? 'Order failed' : 'Order queued',
    exchange ? `to ${exchange.toUpperCase()}` : '',
    side,
    symbol,
    type,
    amount ? `qty ${amount}` : '',
    price ? `@ ${price}` : ''
  ].filter(Boolean);

  return {
    id: row.id,
    timestamp: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    edgeKey: `server->dst:integration:${row.integrationId || 'unknown'}`,
    kind: 'order',
    severity,
    statusColor,
    symbol,
    summary: summaryParts.join(' ').trim(),
    meta: {
      integrationId: row.integrationId,
      idempotencyKey: row.idempotencyKey,
      side: row.side,
      type: row.type,
      amount: row.amount,
      price: row.price,
      status: row.status,
      error: row.error,
      errorType: row.error ? String(row.error).slice(0, 64) : null,
      exchangeName: exchange,
      createdAt: createdAt?.toISOString?.(),
      processedAt: processedAt?.toISOString?.(),
      latencyMs,
      ruleId: row.payload?.raw?.ruleId || row.payload?.ruleId || null,
      sourceIntegrationId: row.payload?.raw?.sourceIntegrationId || null,
      destinationIntegrationId: row.integrationId || null,
      status: row.status,
      transactionId: row.payload?.executionResult?.orderId || null,
      attempts: row.attempts || 0,
      lastError: row.error || null,
      mappedOrder: row.payload?.raw?.mappedOrder || row.payload?.mappedOrder || null
    },
    processedAt: processedAt?.toISOString?.(),
    latencyMs
  };
}

export async function listWorkflowEvents({ workspaceId, edgeKey, since, limit = 20 }) {
  const parsed = parseEdgeKey(edgeKey);

  let integrationIds = [];
  if (parsed?.kind === 'destination' && parsed.integrationId) {
    const integ = await prisma.integration.findFirst({ where: { id: parsed.integrationId, workspaceId } });
    if (!integ) return [];
    integrationIds = [parsed.integrationId];
  } else if (!parsed || parsed.kind === 'destination') {
    const all = await prisma.integration.findMany({ where: { workspaceId }, select: { id: true } });
    integrationIds = all.map((i) => i.id);
  } else if (parsed?.kind === 'source') {
    // No webhook linkage stored yet
    return [];
  }

  if (!integrationIds.length) return [];

  const where = {
    integrationId: { in: integrationIds }
  };

  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      where.createdAt = { gte: sinceDate };
    }
  }

  const rows = await prisma.forwardedSignal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100)
  });

  const integMap = {};
  if (rows.length) {
    const ids = Array.from(new Set(rows.map((r) => r.integrationId).filter(Boolean)));
    if (ids.length) {
      const integRows = await prisma.integration.findMany({ where: { id: { in: ids }, workspaceId } });
      integRows.forEach((i) => {
        integMap[i.id] = i;
      });
    }
  }

  return rows.map((row) => mapForwardedSignalEvent(row, integMap[row.integrationId]));
}

export async function getWorkspaceWorkflowConfig(workspaceId) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws || !ws.workflowConfig) {
    return { version: 1, status: 'active', rules: [], customNodes: [] };
  }
  const cfg = ws.workflowConfig || {};
  return {
    ...cfg,
    version: typeof cfg.version === 'number' ? cfg.version : 1,
    status: normalizeWorkflowStatus(cfg.status),
    rules: Array.isArray(cfg.rules) ? cfg.rules : [],
    customNodes: Array.isArray(cfg.customNodes) ? cfg.customNodes : []
  };
}

export async function saveWorkspaceWorkflowConfig(workspaceId, config) {
  const nextVersion = (config?.version || 1) + 1;
  const payload = { ...config, version: nextVersion, status: normalizeWorkflowStatus(config?.status) };
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { workflowConfig: payload }
  });
  return payload;
}

export async function deleteWorkflowConfig(workspaceId) {
  const current = await getWorkspaceWorkflowConfig(workspaceId);
  const next = {
    ...current,
    status: 'active',
    rules: [],
    customNodes: [],
    deletedAt: new Date().toISOString()
  };
  return saveWorkspaceWorkflowConfig(workspaceId, next);
}

export async function controlWorkflow(workspaceId, action) {
  const normalizedAction = normalizeWorkflowControlAction(action);
  if (normalizedAction === 'delete') {
    return deleteWorkflowConfig(workspaceId);
  }

  const current = await getWorkspaceWorkflowConfig(workspaceId);
  const nowIso = new Date().toISOString();
  let next = {
    ...current
  };

  if (normalizedAction === 'pause') {
    next = {
      ...next,
      status: 'paused',
      pausedAt: nowIso
    };
  } else if (normalizedAction === 'resume') {
    next = {
      ...next,
      status: 'active',
      resumedAt: nowIso
    };
  } else {
    next = {
      ...next,
      status: 'active',
      restartedAt: nowIso
    };
  }

  return saveWorkspaceWorkflowConfig(workspaceId, next);
}

export async function controlWorkflowRule(workspaceId, ruleId, action) {
  const normalizedAction = normalizeWorkflowControlAction(action);
  const normalizedRuleId = String(ruleId || '').trim();
  if (!normalizedRuleId) {
    throw Object.assign(new Error('Rule id is required'), { status: 400 });
  }

  const current = await getWorkspaceWorkflowConfig(workspaceId);
  const rules = Array.isArray(current.rules) ? [...current.rules] : [];
  const ruleIndex = rules.findIndex((rule) => String(rule?.id || '').trim() === normalizedRuleId);
  if (ruleIndex < 0) {
    throw Object.assign(new Error('Workflow rule not found'), { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const previousRule = rules[ruleIndex];
  let nextRule = previousRule;

  if (normalizedAction === 'delete') {
    rules.splice(ruleIndex, 1);
  } else {
    const safeRule =
      previousRule && typeof previousRule === 'object' && !Array.isArray(previousRule) ? { ...previousRule } : {};
    if (normalizedAction === 'pause') {
      safeRule.enabled = false;
    } else {
      safeRule.enabled = true;
      if (normalizedAction === 'restart') {
        safeRule.restartedAt = nowIso;
      }
    }
    safeRule.updatedAt = nowIso;
    rules[ruleIndex] = safeRule;
    nextRule = safeRule;
  }

  const saved = await saveWorkspaceWorkflowConfig(workspaceId, {
    ...current,
    rules
  });

  return {
    action: normalizedAction,
    ruleId: normalizedRuleId,
    rule: normalizedAction === 'delete' ? previousRule : nextRule,
    workflowConfig: saved
  };
}

export async function simulateRules({ workspaceId: _workspaceId, rules, source, signal, workflowStatus = 'active' }) {
  const matchedRules = [];
  const skippedRules = [];
  const status = normalizeWorkflowStatus(workflowStatus);
  if (status === 'paused') {
    return {
      matchedRules,
      skippedRules: [{ ruleId: 'workflow', reason: 'workflow paused' }]
    };
  }
  const symbol = (signal?.symbol || '').toUpperCase();
  const side = (signal?.side || '').toLowerCase();
  const notional = Number(signal?.notional || signal?.amount || 0);
  const ruleList = Array.isArray(rules) ? rules : [];

  for (const rule of ruleList) {
    if (!rule?.enabled) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'disabled' });
      continue;
    }
    if (!rule?.source) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'source mismatch' });
      continue;
    }
    const sourceId = String(source?.id || '');
    const ruleSourceId = String(rule.source.id || '');
    const isTradingviewWildcard = ruleSourceId === 'tradingview' && sourceId.startsWith('tv:');
    if (ruleSourceId !== sourceId && !isTradingviewWildcard) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'source mismatch' });
      continue;
    }
    if (!rule?.destination || rule.destination.type !== 'integration') {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'destination invalid' });
      continue;
    }

    const conditions = rule.conditions || {};
    const symbols = conditions.symbols && Array.isArray(conditions.symbols) ? conditions.symbols.map((s) => String(s).toUpperCase()) : ['*'];
    if (!(symbols.includes('*') || symbols.includes(symbol))) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'symbol not allowed' });
      continue;
    }
    const allowedSides = conditions.allowedSides && Array.isArray(conditions.allowedSides) ? conditions.allowedSides.map((s) => String(s).toLowerCase()) : null;
    if (allowedSides && allowedSides.length && side && !allowedSides.includes(side) && !(allowedSides.includes('both'))) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'side not allowed' });
      continue;
    }
    const minNotional = conditions.minNotional != null ? Number(conditions.minNotional) : null;
    if (minNotional != null && notional < minNotional) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'below minNotional' });
      continue;
    }

    const mapping = rule.mapping || {};
    const size = resolveMappedSize(mapping);
    matchedRules.push({
      ruleId: rule.id || 'unknown',
      destinationIntegrationId: rule.destination.id,
      mappedOrder: {
        orderType: mapping.orderType || 'market',
        size,
        leverage: mapping.maxLeverage || mapping.leverage || 1
      }
    });
  }

  return { matchedRules, skippedRules };
}
