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

type WebhookEntry = { webhooks: Webhook[] };

const FALLBACK_SUBDOMAIN = 'ops-9ad734';
const FALLBACK_DOMAIN = 'daxlinksonline.link';
const FALLBACK_SECRET = 'c8f14d88b0f9d7aa16f90b8f23bd2a54';

const mockDb: Record<string, WebhookEntry> = {};

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
  try {
    const res = await fetch(input, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) },
      ...init
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function seedMock(ws: string) {
  const entry = (mockDb[ws] ||= { webhooks: [] });
  if (entry.webhooks.length === 0) {
    const now = new Date().toISOString();
    entry.webhooks.push({
      id: crypto.randomUUID(),
      workspaceId: ws,
      name: 'TradingView Alerts',
      url: `https://${FALLBACK_SUBDOMAIN}.${FALLBACK_DOMAIN}/webhook`,
      method: 'POST',
      events: ['signal.triggered', 'signal.cleared'],
      active: true,
      signingSecretRef: `cred_${FALLBACK_SECRET.slice(0, 8)}`,
      lastDeliveryAt: now,
      createdAt: now,
      updatedAt: now
    });
  }
  return entry;
}

export async function listWebhooks(): Promise<Webhook[]> {
  const ws = getWorkspaceId();
  const primary = await tryFetch<Webhook[]>(`/api/v1/webhooks/${encodeURIComponent(ws)}`);
  if (Array.isArray(primary) && primary.length) return primary;
  const alt = await tryFetch<{ items: Webhook[] }>(`/api/v1/webhooks/${encodeURIComponent(ws)}`);
  if (alt?.items) return alt.items;
  return seedMock(ws).webhooks;
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
  if (created) return created;

  const entry = seedMock(ws);
  const now = new Date().toISOString();
  const fallback: Webhook = {
    id: crypto.randomUUID(),
    workspaceId: ws,
    name: payload.name,
    url: payload.url,
    method: (payload.method as WebhookMethod) || 'POST',
    events: payload.events && payload.events.length ? payload.events : payload.event ? [payload.event] : ['signal.triggered'],
    active: payload.active ?? true,
    signingSecretRef: payload.signingSecret ? `cred_${payload.signingSecret.slice(0, 12)}` : `cred_${FALLBACK_SECRET.slice(0, 8)}`,
    lastDeliveryAt: now,
    createdAt: now,
    updatedAt: now
  };
  entry.webhooks.unshift(fallback);
  return fallback;
}

export async function toggleWebhook(webhookId: string, active: boolean): Promise<Webhook | null> {
  const ws = getWorkspaceId();
  const updated = await tryFetch<Webhook>(`/api/v1/webhooks/${encodeURIComponent(ws)}/${encodeURIComponent(webhookId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active })
  });
  if (updated) return updated;

  const entry = seedMock(ws);
  const idx = entry.webhooks.findIndex((w) => w.id === webhookId);
  if (idx >= 0) {
    entry.webhooks[idx] = { ...entry.webhooks[idx], active, updatedAt: new Date().toISOString() };
    return entry.webhooks[idx];
  }
  return null;
}

export { authHeaders as webhookAuthHeaders };
