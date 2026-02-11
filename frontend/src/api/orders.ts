import { withApiBase } from './client';

export type OrderCheckSnapshot = {
  ok: boolean;
  checkedAt: string;
  exchange: string;
  integration: {
    id: string;
    label: string;
    status: string;
  };
  query: {
    symbol: string | null;
    orderId: string | null;
    origClientOrderId: string | null;
  };
  didTradeHappen: {
    answer: boolean;
    source: {
      order: { ok: boolean; data?: any; error?: string };
      myTrades: { ok: boolean; data?: any; error?: string };
    };
  };
  isStillOpen: {
    answer: boolean | null;
    source: { ok: boolean; data?: any; error?: string };
  };
  currentBalance: {
    source: { ok: boolean; data?: any; error?: string };
  };
  openPosition: {
    source: { ok: boolean; data?: any; error?: string };
  };
};

export type OrderCheckQuery = {
  symbol?: string;
  orderId?: string;
  origClientOrderId?: string;
  integrationId?: string;
};

export type OrderReportQuery = {
  symbol?: string;
  integrationId?: string;
  limit?: number;
};

export type OrderReportRow = {
  key: string;
  matchType: 'alert_id' | 'heuristic' | 'unmatched' | string;
  signal: {
    id: string;
    sourceId: string | null;
    timestamp: string | null;
    symbol: string | null;
    side: string | null;
  };
  exchange: {
    integrationId: string | null;
    integrationLabel: string | null;
    exchange: string | null;
    tradeStatus: string;
    executionTimestamp: string | null;
    side: string | null;
    type: string | null;
    amount: number | null;
    quantity: number | null;
    orderId: string | null;
    errorMessage: string | null;
  };
};

export type OrderReportResponse = {
  ok: boolean;
  generatedAt: string;
  total: number;
  items: OrderReportRow[];
};

function getWorkspaceId() {
  try {
    return localStorage.getItem('workspaceId') || '';
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

async function fetchFromOrderPaths<T>({
  endpoint,
  params
}: {
  endpoint: 'spot' | 'reports';
  params: URLSearchParams;
}): Promise<T> {
  const workspaceId = getWorkspaceId();
  const query = params.toString();
  const requestPaths = workspaceId
    ? [
        `/api/v1/orders/${encodeURIComponent(workspaceId)}/${endpoint}?${query}`,
        `/api/v1/orders/${endpoint}?${query}`
      ]
    : [`/api/v1/orders/${endpoint}?${query}`];

  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  let lastErrorMessage = `Failed to fetch ${endpoint}`;
  for (const path of requestPaths) {
    const res = await fetch(withApiBase(path), {
      credentials: 'include',
      headers
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) return payload as T;
    lastErrorMessage = payload?.error || payload?.message || `Failed to fetch ${endpoint} (${res.status})`;
    if (res.status !== 404) {
      throw new Error(lastErrorMessage);
    }
  }
  throw new Error(lastErrorMessage);
}

export async function fetchMexcSpotSnapshot(query: OrderCheckQuery): Promise<OrderCheckSnapshot> {
  const params = new URLSearchParams();
  if (query.symbol) params.set('symbol', query.symbol.trim().toUpperCase());
  if (query.orderId) params.set('orderId', query.orderId.trim());
  if (query.origClientOrderId) params.set('origClientOrderId', query.origClientOrderId.trim());
  if (query.integrationId) params.set('integrationId', query.integrationId.trim());
  return fetchFromOrderPaths<OrderCheckSnapshot>({
    endpoint: 'spot',
    params
  });
}

export async function fetchOrderReport(query: OrderReportQuery): Promise<OrderReportResponse> {
  const params = new URLSearchParams();
  if (query.symbol) params.set('symbol', query.symbol.trim().toUpperCase());
  if (query.integrationId) params.set('integrationId', query.integrationId.trim());
  if (query.limit && Number.isFinite(Number(query.limit))) {
    params.set('limit', String(query.limit));
  }
  return fetchFromOrderPaths<OrderReportResponse>({
    endpoint: 'reports',
    params
  });
}
