import type { Webhook, WebhookMethod } from './types';

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
import { withApiBase } from './client';
