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

type MockEntry = {
  bots: Bot[];
  versions: Record<string, BotVersion[]>;
  instances: BotInstance[];
  exchangeAccounts: ExchangeAccount[];
  marketBots: MarketBotSummary[];
  rentals: Rental[];
  plans: Plan[];
};

const mockDB: Record<string, MockEntry> = {};

export type VersionScanResult = {
  status: string;
  imageRef?: string | null;
  signedDigest?: string | null;
  sbomRef?: string | null;
  scan?: { summary?: string; findings?: any[]; tool?: string } | null;
  sbom?: any;
};

function ensureEntry(ws: string) {
  return (mockDB[ws] ||= { bots: [], versions: {}, instances: [], exchangeAccounts: [], marketBots: [], rentals: [], plans: [] });
}

function getWorkspaceId() {
  return localStorage.getItem('workspaceId') || '00000000-0000-0000-0000-000000000000';
}

function authHeaders() {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function tryFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function listBots(): Promise<ListResponse<Bot>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots`;
  const data = await tryFetch<ListResponse<Bot>>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  return { items: entry.bots.map((bot) => ({ ...bot, guardrailAlert: bot.guardrailAlert ?? false })) };
}

export async function createBot(payload: Pick<Bot, 'name' | 'kind'> & { description?: string | null }): Promise<Bot> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots`;
  const data = await tryFetch<Bot>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (data) return data;
  // mock fallback
  const entry = ensureEntry(ws);
  const bot: Bot = {
    id: crypto.randomUUID(),
    workspaceId: ws,
    name: payload.name,
    kind: payload.kind,
    description: payload.description ?? null,
    latestVersionId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    guardrailAlert: false
  };
  entry.bots.unshift(bot);
  return bot;
}

export async function getBot(id: string): Promise<Bot | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${id}`;
  const data = await tryFetch<Bot>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  return entry.bots.find((b) => b.id === id) || null;
}

export async function updateBot(id: string, patch: Partial<Bot>): Promise<Bot | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${id}`;
  const data = await tryFetch<Bot>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch)
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const idx = entry.bots.findIndex((b) => b.id === id);
  if (idx >= 0) entry.bots[idx] = { ...entry.bots[idx], ...patch } as Bot;
  return entry.bots[idx] || null;
}

export async function listVersions(botId: string): Promise<ListResponse<BotVersion>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions`;
  const data = await tryFetch<ListResponse<BotVersion>>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  return { items: entry.versions[botId] || [] };
}

export async function createVersion(botId: string, payload: Partial<BotVersion>): Promise<BotVersion | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions`;
  const data = await tryFetch<BotVersion>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const v: BotVersion = {
    id: crypto.randomUUID(),
    botId,
    imageRef: (payload as any)?.imageRef ?? null,
    signedDigest: null,
    sbomRef: null,
    sdkVersion: null,
    status: 'draft',
    notes: (payload as any)?.notes ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  entry.versions[botId] ||= [];
  entry.versions[botId].unshift(v);
  return v;
}

export async function publishBot(botId: string, versionId?: string): Promise<{ ok: true; latestVersionId: string } | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/publish`;
  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  const body = JSON.stringify(versionId ? { versionId } : {});
  const data = await tryFetch<{ ok: true; latestVersionId: string }>(url, {
    method: 'POST',
    headers,
    body
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const versions = entry.versions[botId] || [];
  const target = versionId
    ? versions.find((v) => v.id === versionId && ['approved', 'published'].includes(v.status))
    : versions.find((v) => v.status === 'approved') || versions[0];
  if (!target) return null;
  versions.forEach((v) => {
    if (v.id === target.id) {
      v.status = 'published';
    } else if (v.status === 'published') {
      v.status = 'approved';
    }
  });
  const bot = entry.bots.find((b) => b.id === botId);
  if (bot) bot.latestVersionId = target.id;
  return { ok: true, latestVersionId: target.id };
}

export async function uploadVersion(botId: string, versionId: string, file: File): Promise<boolean> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions/${versionId}/upload`;
  const form = new FormData();
  form.append('file', file);
  const data = await tryFetch<{ ok: true }>(url, {
    method: 'POST',
    headers: { ...authHeaders() },
    body: form
  });
  if (data?.ok) return true;
  const entry = ensureEntry(ws);
  const versions = (entry.versions[botId] ||= []);
  const idx = versions.findIndex((v) => v.id === versionId);
  if (idx >= 0) {
    versions[idx] = { ...versions[idx], status: 'draft', updatedAt: new Date().toISOString() } as BotVersion;
  }
  return true;
}

export async function startBuildVersion(botId: string, versionId: string): Promise<boolean> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions/${versionId}/build`;
  const data = await tryFetch<{ ok: true }>(url, { method: 'POST', headers: { ...authHeaders() } });
  if (data?.ok) return true;
  const entry = ensureEntry(ws);
  const versions = (entry.versions[botId] ||= []);
  const idx = versions.findIndex((v) => v.id === versionId);
  if (idx >= 0) {
    versions[idx] = {
      ...versions[idx],
      status: 'approved',
      imageRef: `mock/${botId}:${versionId}`,
      signedDigest: `sha256:${versionId}`,
      sbomRef: `mock-sbom://${versionId}`
    } as BotVersion;
  }
  return true;
}

export async function getScanVersion(botId: string, versionId: string): Promise<VersionScanResult | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/versions/${versionId}/scan`;
  const data = await tryFetch<VersionScanResult>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  const version = (entry.versions[botId] || []).find((v) => v.id === versionId);
  if (!version) return null;
  return {
    status: version.status,
    imageRef: version.imageRef,
    signedDigest: version.signedDigest,
    sbomRef: version.sbomRef,
    sbom: { artifacts: [] },
    scan: { tool: 'mock', summary: 'offline mode', findings: [] }
  };
}

export async function listInstances(botId: string): Promise<ListResponse<BotInstance>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/instances`;
  const data = await tryFetch<ListResponse<BotInstance>>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  return { items: entry.instances.filter((i) => i.botId === botId) };
}

export async function createInstance(botId: string, payload: Partial<BotInstance>): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/instances`;
  const data = await tryFetch<BotInstance>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const inst: BotInstance = {
    id: crypto.randomUUID(),
    botId,
    botVersionId: (payload as any)?.botVersionId || 'v1',
    workspaceId: ws,
    exchangeAccountId: (payload as any)?.exchangeAccountId || 'acc1',
    symbol: (payload as any)?.symbol || 'BTCUSDT',
    direction: (payload as any)?.direction || 'both',
    leverage: (payload as any)?.leverage || 1,
    maxDailyLossPct: (payload as any)?.maxDailyLossPct || 5,
    takeProfitPct: (payload as any)?.takeProfitPct || 1,
    slAtrMult: (payload as any)?.slAtrMult || 1.5,
    useLimitEntries: (payload as any)?.useLimitEntries ?? true,
    minNotional: (payload as any)?.minNotional || 1,
    status: 'stopped',
    webhookToken: crypto.randomUUID(),
    lastError: null,
    startedAt: null,
    stoppedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  entry.instances.unshift(inst);
  return inst;
}

export async function getInstance(id: string): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}`;
  const data = await tryFetch<BotInstance>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  return entry.instances.find((i) => i.id === id) || null;
}

export async function updateInstance(id: string, patch: Partial<BotInstance>): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}`;
  const data = await tryFetch<BotInstance>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch)
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const idx = entry.instances.findIndex((i) => i.id === id);
  if (idx >= 0) entry.instances[idx] = { ...entry.instances[idx], ...patch } as BotInstance;
  return entry.instances[idx] || null;
}

export async function startInstance(id: string): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/start`;
  const data = await tryFetch<BotInstance>(url, { method: 'POST', headers: { ...authHeaders() } });
  if (data) return data;
  return updateInstance(id, { status: 'running', startedAt: new Date().toISOString(), stoppedAt: null });
}

export async function stopInstance(id: string): Promise<BotInstance | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/stop`;
  const data = await tryFetch<BotInstance>(url, { method: 'POST', headers: { ...authHeaders() } });
  if (data) return data;
  return updateInstance(id, { status: 'stopped', stoppedAt: new Date().toISOString() });
}

export async function getInstanceOrders(id: string): Promise<ListResponse<Order>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/orders`;
  const data = await tryFetch<ListResponse<Order>>(url, { headers: { ...authHeaders() } });
  return data || { items: [] };
}

export async function getInstancePositions(id: string): Promise<ListResponse<Position>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/positions`;
  const data = await tryFetch<ListResponse<Position>>(url, { headers: { ...authHeaders() } });
  return data || { items: [] };
}

export async function getInstanceRuns(id: string): Promise<ListResponse<BotRun>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/runs`;
  const data = await tryFetch<ListResponse<BotRun>>(url, { headers: { ...authHeaders() } });
  return data || { items: [] };
}

export async function getInstanceLogs(id: string, tail = 200): Promise<ListResponse<InstanceLogEntry>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/logs?tail=${encodeURIComponent(String(tail))}`;
  const data = await tryFetch<ListResponse<InstanceLogEntry>>(url, { headers: { ...authHeaders() } });
  return data || { items: [] };
}

export async function getInstanceSignals(id: string): Promise<ListResponse<any>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/signals`;
  const data = await tryFetch<ListResponse<any>>(url, { headers: { ...authHeaders() } });
  return data || { items: [] };
}

export async function getInstanceMetrics(id: string, windowParam = '5m'): Promise<InstanceMetrics> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/metrics?window=${encodeURIComponent(windowParam)}`;
  const data = await tryFetch<InstanceMetrics>(url, { headers: { ...authHeaders() } });
  return data || { cpu: [], memMiB: [] };
}

export async function getInstanceSecurity(id: string): Promise<InstanceSecurity | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/instances/${id}/security`;
  const data = await tryFetch<InstanceSecurity>(url, { headers: { ...authHeaders() } });
  return data;
}

export async function getBrokerHealth(): Promise<boolean> {
  const data = await tryFetch<{ status: string }>(`/api/v1/broker/health`, { headers: { ...authHeaders() } });
  return !!data && data.status === 'ok';
}

export async function listExchangeAccounts(params?: { venue?: string }): Promise<ListResponse<ExchangeAccount>> {
  const ws = getWorkspaceId();
  const search = params?.venue ? `?venue=${encodeURIComponent(params.venue)}` : '';
  const url = `/api/v1/trade-bots/${ws}/exchange-accounts${search}`;
  const data = await tryFetch<ListResponse<ExchangeAccount>>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  const filtered = params?.venue ? entry.exchangeAccounts.filter((acc) => acc.venue === params.venue) : entry.exchangeAccounts;
  return { items: filtered };
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
  const data = await tryFetch<ExchangeAccount>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const acc: ExchangeAccount = {
    id: crypto.randomUUID(),
    workspaceId: ws,
    name: payload.name,
    venue: payload.venue,
    isSandbox: !!payload.isSandbox,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  entry.exchangeAccounts.unshift(acc);
  return acc;
}

export async function deleteExchangeAccount(id: string): Promise<boolean> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/exchange-accounts/${id}`;
  const data = await tryFetch<{ ok: boolean }>(url, { method: 'DELETE', headers: { ...authHeaders() } });
  if (data?.ok) return true;
  const entry = ensureEntry(ws);
  const idx = entry.exchangeAccounts.findIndex((acc) => acc.id === id);
  if (idx >= 0) entry.exchangeAccounts.splice(idx, 1);
  return true;
}

export async function listMarketBots(): Promise<ListResponse<MarketBotSummary>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/market`;
  const data = await tryFetch<ListResponse<MarketBotSummary>>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  if (!entry.marketBots.length) {
    const plan: Plan = {
      id: crypto.randomUUID(),
      workspaceId: 'mock-author',
      name: 'Starter 250m',
      cpuMilli: 250,
      memMiB: 256,
      priceMonthly: 99,
      active: true
    };
    entry.plans.push(plan);
    entry.marketBots.push({
      id: crypto.randomUUID(),
      name: 'Momentum Alpha',
      description: 'Breakout scalper tuned for BTC perpetuals.',
      workspace: { id: 'mock-author', name: 'Mock Quant Team' },
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versionId: crypto.randomUUID(),
      plans: [plan]
    });
  }
  return { items: entry.marketBots };
}

export async function rentBot(
  botId: string,
  payload: { planId: string; exchangeAccountId: string; symbol?: string }
): Promise<{ rentalId: string; instanceId: string | null } | null> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/bots/${botId}/rent`;
  const data = await tryFetch<{ rentalId: string; instanceId: string | null }>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (data) return data;
  const entry = ensureEntry(ws);
  const plan = entry.plans.find((p) => p.id === payload.planId) || entry.marketBots.flatMap((b) => b.plans).find((p) => p.id === payload.planId);
  const exchange = entry.exchangeAccounts.find((acc) => acc.id === payload.exchangeAccountId);
  if (!plan || !exchange) return null;
  const instance: BotInstance = {
    id: crypto.randomUUID(),
    botId,
    botVersionId: crypto.randomUUID(),
    workspaceId: ws,
    exchangeAccountId: exchange.id,
    symbol: payload.symbol || 'BTCUSDT',
    direction: 'both',
    leverage: 1,
    maxDailyLossPct: 5,
    takeProfitPct: 1,
    slAtrMult: 1.5,
    useLimitEntries: true,
    minNotional: 1,
    status: 'stopped',
    webhookToken: crypto.randomUUID(),
    lastError: null,
    startedAt: null,
    stoppedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  entry.instances.unshift(instance);
  const rental: Rental = {
    id: crypto.randomUUID(),
    botId,
    renterWorkspaceId: ws,
    planId: plan.id,
    exchangeAccountId: exchange.id,
    botInstanceId: instance.id,
    status: 'active',
    revenueShareBps: 7000,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    bot: entry.bots.find((b) => b.id === botId),
    plan,
    exchangeAccount: exchange,
    instance
  };
  entry.rentals.unshift(rental);
  return { rentalId: rental.id, instanceId: instance.id };
}

export async function listRentals(): Promise<ListResponse<Rental>> {
  const ws = getWorkspaceId();
  const url = `/api/v1/trade-bots/${ws}/rentals`;
  const data = await tryFetch<ListResponse<Rental>>(url, { headers: { ...authHeaders() } });
  if (data) return data;
  const entry = ensureEntry(ws);
  return { items: entry.rentals };
}
