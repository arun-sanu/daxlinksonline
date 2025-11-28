import { prisma } from '../utils/prisma.js';

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
    return { version: 1, rules: [] };
  }
  const cfg = ws.workflowConfig || {};
  return {
    version: typeof cfg.version === 'number' ? cfg.version : 1,
    rules: Array.isArray(cfg.rules) ? cfg.rules : []
  };
}

export async function saveWorkspaceWorkflowConfig(workspaceId, config) {
  const nextVersion = (config?.version || 1) + 1;
  const payload = { ...config, version: nextVersion };
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { workflowConfig: payload }
  });
  return payload;
}

export async function simulateRules({ workspaceId, rules, source, signal }) {
  const matchedRules = [];
  const skippedRules = [];
  const symbol = (signal?.symbol || '').toUpperCase();
  const side = (signal?.side || '').toLowerCase();
  const notional = Number(signal?.notional || signal?.amount || 0);
  const ruleList = Array.isArray(rules) ? rules : [];

  for (const rule of ruleList) {
    if (!rule?.enabled) {
      skippedRules.push({ ruleId: rule.id || 'unknown', reason: 'disabled' });
      continue;
    }
    if (!rule?.source || rule.source.id !== source.id) {
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
    const size = (() => {
      if (mapping.positionSizeType === 'percent') {
        return `${mapping.positionSizeValue || 0}%`;
      }
      return mapping.positionSizeValue || 0;
    })();
    matchedRules.push({
      ruleId: rule.id || 'unknown',
      destinationIntegrationId: rule.destination.id,
      mappedOrder: {
        orderType: mapping.orderType || 'market',
        size,
        leverage: mapping.maxLeverage || 1
      }
    });
  }

  return { matchedRules, skippedRules };
}
