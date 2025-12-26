import type { Webhook, WebhookDelivery, WebhookMethod, WebhookProfile } from './types';
import { withApiBase } from './client';

type CreateWebhookPayload = {
  name: string;
  url: string;
  method?: WebhookMethod | string;
  signingSecret?: string;
  events?: string[];
  event?: string;
  active?: boolean;
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
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function tryFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T | null> {
  const url = withApiBase(input as any);
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listWebhooks(): Promise<Webhook[]> {
  const ws = getWorkspaceId();
  const primary = await tryFetch<Webhook[]>(`/api/v1/webhooks/${encodeURIComponent(ws)}`);
  if (Array.isArray(primary)) return primary;
  return [];
}

export async function createWebhook(payload: CreateWebhookPayload): Promise<Webhook> {
  const ws = getWorkspaceId();
  const body = {
    name: payload.name,
    url: payload.url,
    method: payload.method || 'POST',
    signingSecret: payload.signingSecret || undefined,
    events: payload.events && payload.events.length ? payload.events : undefined,
    event: payload.event || undefined,
    active: payload.active ?? true
  };

  const created = await tryFetch<Webhook>(`/api/v1/webhooks/${encodeURIComponent(ws)}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return created;
}

export async function toggleWebhook(webhookId: string, active: boolean): Promise<Webhook | null> {
  const ws = getWorkspaceId();
  const updated = await tryFetch<Webhook>(`/api/v1/webhooks/${encodeURIComponent(ws)}/${encodeURIComponent(webhookId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active })
  });
  return updated;
}

export { authHeaders as webhookAuthHeaders };

export async function fetchWebhookProfile(): Promise<WebhookProfile | null> {
  const profile = await tryFetch<{ webhook?: WebhookProfile }>('/api/v1/auth/profile', { method: 'GET' });
  if (profile && profile.webhook) return profile.webhook;
  return null;
}

export async function fetchWebhookDeliveries(limit = 10): Promise<WebhookDelivery[]> {
  const ws = getWorkspaceId();
  const deliveries = await tryFetch<{ items?: WebhookDelivery[] } | WebhookDelivery[]>(
    `/api/v1/admin/webhooks/deliveries?workspaceId=${encodeURIComponent(ws)}&limit=${limit}`
  );
  if (Array.isArray(deliveries)) return deliveries;
  return deliveries.items || [];
}

type MyWebhookResponse = {
  url?: string | null;
  secret?: string | null;
  hmacKey?: string | null;
  enforceHmac?: boolean;
  baseDomain?: string | null;
  dnsRecords?: { subdomain: string; host: string; url: string }[];
};

export async function getMyWebhook(): Promise<MyWebhookResponse> {
  const res = await tryFetch<MyWebhookResponse>('/api/v1/users/my-webhook', { method: 'GET' });
  if (!res) {
    throw new Error('Failed to fetch webhook details');
  }
  return res;
}

export async function assignWebhook(): Promise<MyWebhookResponse> {
  const res = await tryFetch<MyWebhookResponse>('/api/v1/users/assign-webhook', { method: 'POST' });
  if (!res) {
    throw new Error('Failed to assign webhook');
  }
  return res;
}

export async function testWebhook(testData: Record<string, unknown>) {
  const res = await tryFetch<any>('/api/v1/users/test-webhook', {
    method: 'POST',
    body: JSON.stringify(testData)
  });
  if (!res) {
    throw new Error('Test webhook failed');
  }
  return res;
}
