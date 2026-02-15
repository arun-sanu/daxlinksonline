import { withApiBase } from './client';

export type Integration = {
  id: string;
  workspaceId: string;
  exchange: string;
  environment: string;
  status: string;
  label?: string | null;
  description?: string | null;
  apiKeyMasked?: string | null;
  passphraseMasked?: string | null;
  apiSecretMasked?: string | null;
  lastTestedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type IntegrationCredential = {
  id: string;
  label?: string | null;
  apiKeyMasked?: string | null;
  apiSecretMasked?: string | null;
  passphraseMasked?: string | null;
  subAccount?: string | null;
  description?: string | null;
  environment?: string | null;
  createdAt?: string | null;
};

type IntegrationLog = {
  id: string;
  status: string;
  message: string;
  createdAt: string;
};

type IntegrationDetail = Integration & {
  credentials?: IntegrationCredential[];
  logs?: IntegrationLog[];
};

type AvailableExchange = {
  id: string;
  name: string;
  tagline?: string;
  icon?: string;
  iconUrl?: string;
  regions?: string[];
  latency?: string;
  requiresPassphrase?: boolean;
};

type CreateIntegrationPayload = {
  exchange: string;
  environment: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  label?: string;
  description?: string;
};

const EMPTY_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

function isUuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getWorkspaceId() {
  try {
    const workspaceId = localStorage.getItem('workspaceId');
    if (!workspaceId || workspaceId === EMPTY_WORKSPACE_ID || !isUuid(workspaceId)) return '';
    return workspaceId;
  } catch {
    return '';
  }
}

function authHeaders() {
  try {
    const token =
      localStorage.getItem('authToken') ||
      localStorage.getItem('daxlinksToken') ||
      localStorage.getItem('dax_portal_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function resolveWorkspaceId() {
  const stored = getWorkspaceId();
  if (stored) return stored;

  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  const profilePaths = ['/api/v1/auth/me', '/api/v1/users/me'];
  for (const path of profilePaths) {
    try {
      const res = await fetch(withApiBase(path), {
        method: 'GET',
        credentials: 'include',
        headers
      });
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      const workspaceId = body?.workspace?.id || body?.workspaceId || null;
      if (!isUuid(workspaceId)) continue;
      try {
        localStorage.setItem('workspaceId', workspaceId);
      } catch {
        // ignore localStorage errors
      }
      return workspaceId;
    } catch {
      // try next profile path
    }
  }

  return '';
}

async function requireWorkspaceId() {
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) {
    throw new Error('Workspace not found. Please sign in again.');
  }
  return workspaceId;
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit, message?: string): Promise<T> {
  const url = withApiBase(input as any);

  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) {
    let detail = '';
    try {
      const payload = await res.json();
      detail = payload?.error || payload?.message || '';
    } catch {
      // ignore parse issues
    }
    const fallback = message || `Request failed (${res.status})`;
    throw new Error(detail ? `${fallback}: ${detail}` : fallback);
  }
  return (await res.json()) as T;
}

export async function listAvailableExchanges(): Promise<AvailableExchange[]> {
  try {
    return await fetchJson<AvailableExchange[]>('/api/v1/integrations/meta/exchanges');
  } catch {
    return [];
  }
}

export async function listIntegrations(): Promise<Integration[]> {
  const ws = await requireWorkspaceId();
  return fetchJson<Integration[]>(
    `/api/v1/integrations/${encodeURIComponent(ws)}`,
    { method: 'GET' },
    'Failed to load integrations'
  );
}

export async function createIntegration(payload: CreateIntegrationPayload): Promise<Integration> {
  const ws = await requireWorkspaceId();
  return fetchJson<Integration>(
    `/api/v1/integrations/${encodeURIComponent(ws)}`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    'Failed to create integration'
  );
}

export async function testIntegration(integrationId: string): Promise<{ status: string; rotatedAt?: string; error?: string }> {
  const ws = await requireWorkspaceId();
  return fetchJson<{ status: string; rotatedAt?: string; error?: string }>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/test`,
    { method: 'POST' },
    'Failed to test integration'
  );
}

export async function fetchIntegrationDetail(integrationId: string): Promise<IntegrationDetail | null> {
  const ws = await requireWorkspaceId();
  try {
    return await fetchJson<IntegrationDetail>(
      `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}`,
      { method: 'GET' }
    );
  } catch {
    return null;
  }
}

export async function updateIntegrationCredential(
  integrationId: string,
  credentialId: string,
  body: Partial<IntegrationCredential>
): Promise<IntegrationCredential> {
  const ws = await requireWorkspaceId();
  return fetchJson<IntegrationCredential>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: 'PUT', body: JSON.stringify(body) },
    'Failed to update credential'
  );
}

export async function deleteIntegrationCredential(integrationId: string, credentialId: string): Promise<void> {
  const ws = await requireWorkspaceId();
  await fetchJson<void>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: 'DELETE' },
    'Failed to delete credential'
  );
}

export async function deleteIntegration(integrationId: string): Promise<void> {
  const ws = await requireWorkspaceId();
  await fetchJson<void>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}`,
    { method: 'DELETE' },
    'Failed to delete integration'
  );
}

export async function purgeIntegrationCredentials(
  integrationId: string
): Promise<{ status?: string }> {
  const ws = await requireWorkspaceId();
  return fetchJson<{ status?: string }>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/credentials`,
    { method: 'DELETE' },
    'Failed to purge credentials'
  );
}
