type Integration = {
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

function getWorkspaceId() {
  try {
    return localStorage.getItem('workspaceId') || '00000000-0000-0000-0000-000000000000';
  } catch {
    return '00000000-0000-0000-0000-000000000000';
  }
}

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken') || localStorage.getItem('dax_portal_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit, message?: string): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) {
    const msg = message || `Request failed (${res.status})`;
    throw new Error(msg);
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
  const ws = getWorkspaceId();
  try {
    return await fetchJson<Integration[]>(`/api/v1/integrations/${encodeURIComponent(ws)}`);
  } catch {
    return [];
  }
}

export async function createIntegration(payload: CreateIntegrationPayload): Promise<Integration> {
  const ws = getWorkspaceId();
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
  const ws = getWorkspaceId();
  return fetchJson<{ status: string; rotatedAt?: string; error?: string }>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/test`,
    { method: 'POST' },
    'Failed to test integration'
  );
}

export async function fetchIntegrationDetail(integrationId: string): Promise<IntegrationDetail | null> {
  const ws = getWorkspaceId();
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
  const ws = getWorkspaceId();
  return fetchJson<IntegrationCredential>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: 'PUT', body: JSON.stringify(body) },
    'Failed to update credential'
  );
}

export async function deleteIntegrationCredential(integrationId: string, credentialId: string): Promise<void> {
  const ws = getWorkspaceId();
  await fetchJson<void>(
    `/api/v1/integrations/${encodeURIComponent(ws)}/${encodeURIComponent(integrationId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: 'DELETE' },
    'Failed to delete credential'
  );
}
