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
    return localStorage.getItem('workspaceId') || '00000000-0000-0000-0000-000000000000';
  } catch {
    return '00000000-0000-0000-0000-000000000000';
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

  const res = await fetch(
    withApiBase(`/api/v1/orders/${encodeURIComponent(workspaceId)}/spot?${params.toString()}`),
    {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() }
    }
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || `Failed to fetch order status (${res.status})`);
  }
  return payload as OrderCheckSnapshot;
}
