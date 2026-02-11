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

export async function fetchMexcSpotSnapshot(query: OrderCheckQuery): Promise<OrderCheckSnapshot> {
  const workspaceId = getWorkspaceId();
  const params = new URLSearchParams();
  if (query.symbol) params.set('symbol', query.symbol.trim().toUpperCase());
  if (query.orderId) params.set('orderId', query.orderId.trim());
  if (query.origClientOrderId) params.set('origClientOrderId', query.origClientOrderId.trim());
  if (query.integrationId) params.set('integrationId', query.integrationId.trim());

  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  const requestPaths = workspaceId
    ? [
        `/api/v1/orders/${encodeURIComponent(workspaceId)}/spot?${params.toString()}`,
        `/api/v1/orders/spot?${params.toString()}`
      ]
    : [`/api/v1/orders/spot?${params.toString()}`];

  let lastErrorMessage = 'Failed to fetch order status';
  for (const path of requestPaths) {
    const res = await fetch(withApiBase(path), {
      credentials: 'include',
      headers
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      return payload as OrderCheckSnapshot;
    }
    lastErrorMessage = payload?.error || payload?.message || `Failed to fetch order status (${res.status})`;
    if (res.status !== 404) {
      throw new Error(lastErrorMessage);
    }
  }

  throw new Error(lastErrorMessage);
}
