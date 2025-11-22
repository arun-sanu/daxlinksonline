export type DatabaseInstance = {
  id: string;
  name: string;
  status: string;
  provider: string | null;
  engine: string | null;
  version: string | null;
  region: string | null;
  sizeTier: string | null;
  storageGb: number | null;
  computeClass: string | null;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  passwordMasked?: string | null;
  sslRequired?: boolean | null;
  createdAt: string;
  updatedAt?: string | null;
  usedGb?: number | null;
  tradesCount?: number | null;
};

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) {
    const message = (await res.json().catch(() => ({})))?.error || res.statusText;
    throw new Error(message || 'Request failed');
  }
  return (await res.json()) as T;
}

export async function listDatabases(): Promise<DatabaseInstance[]> {
  return request<DatabaseInstance[]>('/api/v1/admin/databases');
}

export async function createDatabase(payload: Partial<DatabaseInstance> & { name: string; storageGb?: number; region?: string }) {
  return request<DatabaseInstance>('/api/v1/admin/databases', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function rotateDatabase(dbId: string) {
  return request<DatabaseInstance>(`/api/v1/admin/databases/${encodeURIComponent(dbId)}/rotate`, { method: 'POST' });
}

export async function deleteDatabase(dbId: string) {
  return request<{ success: boolean }>(`/api/v1/admin/databases/${encodeURIComponent(dbId)}`, { method: 'DELETE' });
}
