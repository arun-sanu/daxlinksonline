import { withApiBase } from './client';

export type DatabaseTableMeta = {
  key: string;
  name: string;
  purpose?: string | null;
  records?: number | null;
  lastExecutedAt?: string | null;
  lastUpdatedAt?: string | null;
  queryPath?: string | null;
};

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
  tables?: DatabaseTableMeta[] | null;
};

export type TradeTransactionLedgerQuery = {
  workspaceId?: string;
  symbol?: string;
  botId?: string;
  botInstanceId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type TradeTransactionLedgerSummary = {
  trades: number;
  buyTrades: number;
  sellTrades: number;
  totalValue: number;
  buyValue: number;
  sellValue: number;
  totalQuantity: number;
  totalFees: number;
  realizedPnl: number;
};

export type TradeTransactionLedgerItem = {
  id: string;
  workspaceId: string;
  symbol: string | null;
  side: string | null;
  status: string | null;
  orderType: string | null;
  amount: number | null;
  quantity: number | null;
  value: number | null;
  marketPrice: number | null;
  executionPrice: number | null;
  buyPrice: number | null;
  sellPrice: number | null;
  buyValue: number | null;
  sellValue: number | null;
  realizedPnl: number | null;
  accountBalanceBefore: number | null;
  accountBalanceAfter: number | null;
  executedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  decisionContext?: unknown;
  sizingContext?: unknown;
  metadata?: unknown;
};

export type TradeTransactionLedgerResponse = {
  database: {
    id: string;
    name: string;
  };
  table: {
    key: string;
    name: string;
  };
  filters: {
    workspaceScope: string | string[] | null;
    symbol: string | null;
    botId: string | null;
    botInstanceId: string | null;
    status: string | null;
    from: string | null;
    to: string | null;
    limit: number;
  };
  total: number;
  returned: number;
  summary: TradeTransactionLedgerSummary;
  items: TradeTransactionLedgerItem[];
};

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = withApiBase(path) as string;
  const res = await fetch(url, {
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

export async function listTradeTransactionsForDatabase(
  dbId: string,
  query: TradeTransactionLedgerQuery = {}
): Promise<TradeTransactionLedgerResponse> {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspaceId', query.workspaceId.trim());
  if (query.symbol) params.set('symbol', query.symbol.trim().toUpperCase());
  if (query.botId) params.set('botId', query.botId.trim());
  if (query.botInstanceId) params.set('botInstanceId', query.botInstanceId.trim());
  if (query.status) params.set('status', query.status.trim().toLowerCase());
  if (query.from) params.set('from', query.from.trim());
  if (query.to) params.set('to', query.to.trim());
  if (query.limit && Number.isFinite(Number(query.limit))) {
    params.set('limit', String(Math.max(1, Math.floor(Number(query.limit)))));
  }
  const suffix = params.toString();
  const path = `/api/v1/admin/databases/${encodeURIComponent(dbId)}/tables/trade-transactions${suffix ? `?${suffix}` : ''}`;
  return request<TradeTransactionLedgerResponse>(path);
}
