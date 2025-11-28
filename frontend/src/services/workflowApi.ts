const defaultHeaders = { 'Content-Type': 'application/json' };

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
    return localStorage.getItem('workspaceId') || fallback || '00000000-0000-0000-0000-000000000000';
  } catch {
    return fallback || '00000000-0000-0000-0000-000000000000';
  }
}

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function safeFetch<T>(input: RequestInfo, init?: RequestInit, fallback: T | null = null): Promise<T | null> {
  try {
    const res = await fetch(input, {
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
    orderType: rule?.orderType,
    sizeValue: mapping.positionSizeValue ?? rule?.sizeValue,
    leverage: mapping.leverage ?? rule?.leverage,
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
    id: rule.id || rule.ruleId || rule._id || crypto.randomUUID(),
    source: { type: 'webhook', id: rule.sourceWebhookId },
    destination: { type: 'integration', id: rule.destinationIntegrationId },
    orderType: rule.orderType || 'market',
    positionSizeValue,
    minNotional,
    symbols,
    allowedSides,
    enabled: rule.enabled !== false,
    conditions: {
      symbols,
      allowedSides,
      minNotional
    },
    mapping: {
      positionSizeValue,
      positionSizeType: typeof rule.sizeValue === 'string' && String(rule.sizeValue).includes('%') ? 'percent' : 'absolute',
      leverage: rule.leverage
    }
  };
}

export async function fetchWorkflowNodes(workspaceId?: string) {
  const ws = workspaceId || getWorkspaceId();
  const [webhooks, integrations] = await Promise.all([
    safeFetch<any>(`/api/v1/webhooks/${encodeURIComponent(ws)}`, undefined, []),
    safeFetch<any>(`/api/v1/integrations/${encodeURIComponent(ws)}`, undefined, [])
  ]);
  const webhooksList = Array.isArray(webhooks?.items) ? webhooks.items : Array.isArray(webhooks) ? webhooks : [];
  const integrationsList = Array.isArray(integrations?.items) ? integrations.items : Array.isArray(integrations) ? integrations : [];
  return { webhooks: webhooksList, bots: [], integrations: integrationsList, mocked: false };
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
  const res = await fetch('/api/v1/workflow/apply', {
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
  // Endpoint not implemented server-side yet; keep a stub to avoid UI crashes.
  return safeFetch<any>('/api/v1/workflow/nodes', { method: 'POST', body: JSON.stringify({ workspaceId, ...payload }) }, null);
}

export async function simulateRouting(workspaceId: string, sourceId: string, destinationId: string) {
  const ws = workspaceId || getWorkspaceId();
  const res = await fetch('/api/v1/workflow/simulate', {
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
