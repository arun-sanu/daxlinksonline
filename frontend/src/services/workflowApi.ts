import { withApiBase } from '../api/client';

const defaultHeaders = { 'Content-Type': 'application/json' };

function generateRuleId() {
  try {
    // Browser crypto
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function getWorkspaceId(fallback?: string) {
  try {
    return localStorage.getItem('workspaceId') || fallback || '';
  } catch {
    return fallback || '';
  }
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function extractErrorMessage(res: Response, fallbackMessage: string) {
  const text = await res.text().catch(() => '');
  try {
    const parsed = text ? JSON.parse(text) : null;
    const msg = parsed?.error || parsed?.message;
    if (msg) return msg;
  } catch {}
  return text || `${fallbackMessage} (${res.status})`;
}

async function safeFetch<T>(input: RequestInfo, init?: RequestInit, fallback: T | null = null): Promise<T | null> {
  try {
    const target = typeof input === 'string' || input instanceof URL ? withApiBase(input) : input;
    const res = await fetch(target, {
      credentials: 'include',
      headers: { ...defaultHeaders, ...authHeaders(), ...(init?.headers || {}) },
      ...init
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

function normalizeRuleFromServer(rule: any) {
  const conditions = rule?.conditions || {};
  const mapping = rule?.mapping || {};
  return {
    id: rule?.id || rule?.ruleId || rule?._id || '',
    sourceWebhookId: rule?.source?.id || rule?.sourceWebhookId || '',
    destinationIntegrationId: rule?.destination?.id || rule?.destinationIntegrationId || '',
    orderType: mapping.orderType || rule?.orderType,
    sizeValue: mapping.positionSizeValue ?? rule?.sizeValue ?? rule?.positionSizeValue,
    leverage: mapping.leverage ?? mapping.maxLeverage ?? rule?.leverage,
    symbols: conditions.symbols || rule?.symbols,
    allowedSides: conditions.allowedSides || rule?.allowedSides,
    minNotional: conditions.minNotional ?? rule?.minNotional,
    enabled: rule?.enabled !== false
  };
}

function mapRuleToServer(rule: any) {
  const positionSizeValue = rule.sizeValue ? Number(rule.sizeValue) : undefined;
  const minNotional = rule.minNotional != null ? Number(rule.minNotional) : undefined;
  const symbols = Array.isArray(rule.symbols) ? rule.symbols : undefined;
  const allowedSides = Array.isArray(rule.allowedSides) ? rule.allowedSides : undefined;
  return {
    id: rule.id || rule.ruleId || rule._id || generateRuleId(),
    source: { type: 'webhook', id: rule.sourceWebhookId },
    destination: { type: 'integration', id: rule.destinationIntegrationId },
    conditions: {
      symbols,
      allowedSides,
      minNotional
    },
    mapping: {
      positionSizeValue,
      positionSizeType: typeof rule.sizeValue === 'string' && String(rule.sizeValue).includes('%') ? 'percent' : 'absolute',
      orderType: rule.orderType || 'market',
      leverage: rule.leverage
    },
    enabled: rule.enabled !== false,
    riskFlags: rule.riskFlags || []
  };
}

export async function fetchWorkflowNodes(workspaceId?: string) {
  const ws = workspaceId || getWorkspaceId();
  if (!ws) {
    throw new Error('Workspace ID is required to load workflow nodes.');
  }

  const res = await fetch(withApiBase(`/api/v1/workflow/nodes?workspaceId=${encodeURIComponent(ws)}`), {
    credentials: 'include',
    headers: { ...defaultHeaders, ...authHeaders() }
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, 'Failed to fetch workflow nodes'));
  }
  const nodes = await res.json();
  return {
    webhooks: Array.isArray(nodes.webhooks) ? nodes.webhooks : [],
    bots: Array.isArray(nodes.bots) ? nodes.bots : [],
    integrations: Array.isArray(nodes.integrations) ? nodes.integrations : []
  };
}

export async function fetchRoutingRules(workspaceId: string) {
  const ws = workspaceId || getWorkspaceId();
  const data = await safeFetch<any>(`/api/v1/workflow/config?workspaceId=${encodeURIComponent(ws)}`, undefined, { workflowConfig: { rules: [] } });
  const rules = data?.workflowConfig?.rules || data?.rules || [];
  const normalized = Array.isArray(rules) ? rules.map(normalizeRuleFromServer) : [];
  return normalized;
}

export async function fetchWorkflowEvents(workspaceId: string) {
  const ws = workspaceId || getWorkspaceId();
  const data = await safeFetch<any>(`/api/v1/workflow/events?workspaceId=${encodeURIComponent(ws)}`, undefined, { events: [] });
  return data?.events || [];
}

export async function fetchExecutionHistory(workspaceId: string) {
  const ws = workspaceId || getWorkspaceId();
  const data = await safeFetch<any>(`/api/v1/workflow/executions?workspaceId=${encodeURIComponent(ws)}`, undefined, { executions: [] });
  return data?.executions || data || [];
}

export async function applyRoutingConfig(workspaceId: string, rules: any[]) {
  const ws = workspaceId || getWorkspaceId();
  const payload = { workspaceId: ws, rules: rules.map(mapRuleToServer) };
  const res = await fetch(withApiBase('/api/v1/workflow/apply'), {
    method: 'POST',
    headers: { ...defaultHeaders, ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  return handleJson<any>(res);
}

export async function fetchExecutionTimeline(workspaceId: string) {
  const ws = workspaceId || getWorkspaceId();
  const data = await safeFetch<any>(`/api/v1/workflow/executions/timeline?workspaceId=${encodeURIComponent(ws)}`, undefined, { executions: [] });
  return data?.executions || data || [];
}

export async function createNode(workspaceId: string, payload: { label: string; nodeType: string; description?: string; side: 'source' | 'destination' }) {
  const ws = workspaceId || getWorkspaceId();
  if (!ws) {
    throw new Error('Workspace ID is required to create a node.');
  }
  const res = await fetch(withApiBase('/api/v1/workflow/nodes'), {
    method: 'POST',
    credentials: 'include',
    headers: { ...defaultHeaders, ...authHeaders() },
    body: JSON.stringify({ workspaceId: ws, ...payload })
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, 'Failed to create node'));
  }
  return handleJson<any>(res);
}

export async function simulateRouting(workspaceId: string, sourceId: string, destinationId: string) {
  const ws = workspaceId || getWorkspaceId();
  const res = await fetch(withApiBase('/api/v1/workflow/simulate'), {
    method: 'POST',
    credentials: 'include',
    headers: { ...defaultHeaders, ...authHeaders() },
    body: JSON.stringify({
      workspaceId: ws,
      source: { id: sourceId, type: 'webhook' },
      destination: { id: destinationId, type: 'integration' },
      signal: { symbol: '*', side: 'buy', amount: 1 }
    })
  });
  return handleJson<any>(res);
}
