import type {
  Bot,
  BotInstance,
  BotRun,
  ExchangeAccount,
  Order,
  Position,
  BotVersion,
  InstanceLogEntry,
  InstanceMetrics,
  InstanceSecurity,
  MarketBotSummary,
  Rental,
  Plan
} from './types';

type ListResponse<T> = { items: T[] };

export type VersionScanResult = {
  status: string;
  imageRef?: string | null;
  signedDigest?: string | null;
  sbomRef?: string | null;
  scan?: { summary?: string; findings?: any[]; tool?: string } | null;
  sbom?: any;
};

export type TradeBotRuntimeConfig = {
  workspaceId: string;
  botId: string;
  links: {
    webhookUrl?: string | null;
    integrationId?: string | null;
    exchangeAccountId?: string | null;
    updatedAt?: string | null;
  };
  rules: Record<string, any> | null;
  updatedAt?: string | null;
};

function getWorkspaceId() {
  return localStorage.getItem('workspaceId') || '00000000-0000-0000-0000-000000000000';
}

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit, errorMessage?: string): Promise<T> {
  const url = withApiBase(input as any);

  const res = await fetch(url, {
    credentials: 'include',
    headers: { ...authHeaders(), ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) {
    let detail = '';
    try {
      const payload = await res.json();
      detail = payload?.error || payload?.message || '';
    } catch {
      // ignore response parsing failures
    }
    const base = errorMessage || `Request failed (${res.status})`;
    throw new Error(detail ? `${base}: ${detail}` : base);
  }
  return (await res.json()) as T;
}

export async function listBots(): Promise<ListResponse<Bot>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots`;
  return fetchJson<ListResponse<Bot>>(url, undefined, 'Failed to load trade bots');
}

export async function createBot(payload: Pick<Bot, 'name' | 'kind'> & { description?: string | null }): Promise<Bot> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots`;
  return fetchJson<Bot>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    },
    'Failed to create bot'
  );
}

export async function getBot(id: string): Promise<Bot | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${id}`;
  try {
    return await fetchJson<Bot>(url);
  } catch {
    return null;
  }
}

export async function updateBot(id: string, patch: Partial<Bot>): Promise<Bot | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${id}`;
  return fetchJson<Bot>(
    url,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch)
    },
    'Failed to update bot'
  ).catch(() => null);
}

export async function listVersions(botId: string): Promise<ListResponse<BotVersion>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions`;
  try {
    return await fetchJson<ListResponse<BotVersion>>(url);
  } catch {
    return { items: [] };
  }
}

export async function createVersion(botId: string, payload: Partial<BotVersion>): Promise<BotVersion | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions`;
  return fetchJson<BotVersion>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    },
    'Failed to create version'
  ).catch(() => null);
}

export async function publishBot(botId: string, versionId?: string): Promise<{ ok: true; latestVersionId: string } | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/publish`;
  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  const body = JSON.stringify(versionId ? { versionId } : {});
  return fetchJson<{ ok: true; latestVersionId: string }>(
    url,
    {
      method: 'POST',
      headers,
      body
    },
    'Failed to publish bot'
  ).catch(() => null);
}

export async function uploadVersion(botId: string, versionId: string, file: File): Promise<boolean> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions/${versionId}/upload`;
  const form = new FormData();
  form.append('file', file);
  await fetchJson<{ ok: true }>(
    url,
    {
      method: 'POST',
      headers: { ...authHeaders() },
      body: form
    },
    'Failed to upload version'
  );
  return true;
}

export async function startBuildVersion(botId: string, versionId: string): Promise<boolean> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions/${versionId}/build`;
  await fetchJson<{ ok: true }>(url, { method: 'POST', headers: { ...authHeaders() } }, 'Failed to start build');
  return true;
}

export async function getScanVersion(botId: string, versionId: string): Promise<VersionScanResult | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions/${versionId}/scan`;
  try {
    return await fetchJson<VersionScanResult>(url, { headers: { ...authHeaders() } });
  } catch {
    return null;
  }
}

export async function listInstances(botId: string): Promise<ListResponse<BotInstance>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/instances`;
  try {
    return await fetchJson<ListResponse<BotInstance>>(url);
  } catch {
    return { items: [] };
  }
}

export async function createInstance(botId: string, payload: Partial<BotInstance>): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/instances`;
  return fetchJson<BotInstance>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    },
    'Failed to create instance'
  ).catch(() => null);
}

export async function getInstance(id: string): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}`;
  try {
    return await fetchJson<BotInstance>(url);
  } catch {
    return null;
  }
}

export async function updateInstance(id: string, patch: Partial<BotInstance>): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}`;
  return fetchJson<BotInstance>(
    url,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch)
    },
    'Failed to update instance'
  ).catch(() => null);
}

export async function startInstance(id: string): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/start`;
  return fetchJson<BotInstance>(url, { method: 'POST', headers: { ...authHeaders() } }, 'Failed to start instance').catch(() => null);
}

export async function stopInstance(id: string): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/stop`;
  return fetchJson<BotInstance>(url, { method: 'POST', headers: { ...authHeaders() } }, 'Failed to stop instance').catch(() => null);
}

export async function getInstanceOrders(id: string): Promise<ListResponse<Order>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/orders`;
  try {
    return await fetchJson<ListResponse<Order>>(url);
  } catch {
    return { items: [] };
  }
}

export async function getInstancePositions(id: string): Promise<ListResponse<Position>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/positions`;
  try {
    return await fetchJson<ListResponse<Position>>(url);
  } catch {
    return { items: [] };
  }
}

export async function getInstanceRuns(id: string): Promise<ListResponse<BotRun>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/runs`;
  try {
    return await fetchJson<ListResponse<BotRun>>(url);
  } catch {
    return { items: [] };
  }
}

export async function getInstanceLogs(id: string, tail = 200): Promise<ListResponse<InstanceLogEntry>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/logs?tail=${encodeURIComponent(String(tail))}`;
  try {
    return await fetchJson<ListResponse<InstanceLogEntry>>(url);
  } catch {
    return { items: [] };
  }
}

export async function getInstanceSignals(id: string): Promise<ListResponse<any>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/signals`;
  try {
    return await fetchJson<ListResponse<any>>(url);
  } catch {
    return { items: [] };
  }
}

export async function getInstanceMetrics(id: string, windowParam = '5m'): Promise<InstanceMetrics> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/metrics?window=${encodeURIComponent(windowParam)}`;
  try {
    return await fetchJson<InstanceMetrics>(url);
  } catch {
    return { cpu: [], memMiB: [] };
  }
}

export async function getInstanceSecurity(id: string): Promise<InstanceSecurity | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/security`;
  return fetchJson<InstanceSecurity>(url, { headers: { ...authHeaders() } }).catch(() => null);
}

export async function getBrokerHealth(): Promise<boolean> {
  const data = await fetchJson<{ status: string }>(`/api/v1/broker/health`, { headers: { ...authHeaders() } }).catch(() => null);
  return !!data && data.status === 'ok';
}

export async function listExchangeAccounts(params?: { venue?: string }): Promise<ListResponse<ExchangeAccount>> {
  const ws = getWorkspaceId();
  const search = params?.venue ? `?venue=${encodeURIComponent(params.venue)}` : '';
  const url = `/api/v1/trade-bots/${ws}/exchange-accounts${search}`;
  try {
    return await fetchJson<ListResponse<ExchangeAccount>>(url);
  } catch {
    return { items: [] };
  }
}

export async function createExchangeAccount(payload: {
  name: string;
  venue: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
  isSandbox?: boolean;
}): Promise<ExchangeAccount | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/exchange-accounts`;
  return fetchJson<ExchangeAccount>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    },
    'Failed to create exchange account'
  ).catch(() => null);
}

export async function deleteExchangeAccount(id: string): Promise<boolean> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/exchange-accounts/${id}`;
  await fetchJson<{ ok: boolean }>(url, { method: 'DELETE', headers: { ...authHeaders() } }, 'Failed to delete exchange account');
  return true;
}

export async function listMarketBots(): Promise<ListResponse<MarketBotSummary>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/market`;
  return fetchJson<ListResponse<MarketBotSummary>>(url, undefined, 'Failed to load marketplace bots');
}

export async function rentBot(
  botId: string,
  payload: { planId: string; exchangeAccountId: string; symbol?: string }
): Promise<{ rentalId: string; instanceId: string | null } | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/rent`;
  return fetchJson<{ rentalId: string; instanceId: string | null }>(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    },
    'Failed to rent bot'
  ).catch(() => null);
}

export async function listRentals(): Promise<ListResponse<Rental>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/rentals`;
  try {
    return await fetchJson<ListResponse<Rental>>(url);
  } catch {
    return { items: [] };
  }
}

export async function getTradeBotRuntimeConfig(botId: string): Promise<TradeBotRuntimeConfig | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/runtime-config`;
  return fetchJson<TradeBotRuntimeConfig>(url, undefined, 'Failed to load bot runtime config').catch(() => null);
}

export async function saveTradeBotRuntimeConfig(
  botId: string,
  payload: Partial<Pick<TradeBotRuntimeConfig, 'links' | 'rules'>>
): Promise<TradeBotRuntimeConfig | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/runtime-config`;
  return fetchJson<TradeBotRuntimeConfig>(
    url,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload || {})
    },
    'Failed to save bot runtime config'
  ).catch(() => null);
}
import { withApiBase } from './client';
