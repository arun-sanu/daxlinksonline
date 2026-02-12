import { withApiBase } from './client';

export type SizingAuditRow = {
  id: string;
  receivedAt: string | null;
  symbol: string | null;
  side: string | null;
  status: string | null;
  errorMessage: string | null;
  computedPrice: number | null;
  freeQuote: number | null;
  freeBase: number | null;
  qtyRaw: number | null;
  qtyRounded: number | null;
  mexcOrderId: string | null;
  rejectedReason: string | null;
  quoteSpendComputed: number | null;
  notionalAfterRounding: number | null;
  sizingDebug: any;
};

export type SizingRecentResponse = {
  ok: boolean;
  generatedAt: string;
  total: number;
  items: SizingAuditRow[];
};

export type SizingSummaryGroup = {
  symbol: string;
  side: string;
  count_total: number;
  count_sent: number;
  count_filled: number;
  count_rejected: number;
  count_error: number;
  most_common_rejectedReason: string | null;
  avg_qtyRounded: number | null;
  avg_notionalAfterRounding: number | null;
  avg_quoteSpendComputed: number | null;
  min_qtyRounded: number | null;
  max_qtyRounded: number | null;
};

export type SizingSummaryResponse = {
  ok: boolean;
  generatedAt: string;
  range: string;
  start: string;
  end: string;
  total: number;
  summary: {
    total: number;
    sent: number;
    filled: number;
    rejected: number;
    error: number;
    topRejectedReason: string | null;
  };
  groups: SizingSummaryGroup[];
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

async function fetchWithAuth<T>(path: string): Promise<T> {
  const res = await fetch(withApiBase(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || payload?.message || `Request failed (${res.status})`);
  }
  return payload as T;
}

export async function fetchSizingRecent(params: {
  limit?: number;
  symbol?: string;
  side?: string;
  status?: string;
  since?: string;
  until?: string;
}): Promise<SizingRecentResponse> {
  const query = new URLSearchParams();
  const workspaceId = getWorkspaceId();
  if (workspaceId) query.set('workspaceId', workspaceId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.symbol) query.set('symbol', params.symbol.trim().toUpperCase());
  if (params.side) query.set('side', params.side.toUpperCase());
  if (params.status) query.set('status', params.status.toUpperCase());
  if (params.since) query.set('since', params.since);
  if (params.until) query.set('until', params.until);
  return fetchWithAuth<SizingRecentResponse>(`/api/sizing/recent?${query.toString()}`);
}

export async function fetchSizingSummary(params: {
  range?: string;
  since?: string;
  until?: string;
}): Promise<SizingSummaryResponse> {
  const query = new URLSearchParams();
  const workspaceId = getWorkspaceId();
  if (workspaceId) query.set('workspaceId', workspaceId);
  if (params.range) query.set('range', params.range);
  if (params.since) query.set('since', params.since);
  if (params.until) query.set('until', params.until);
  return fetchWithAuth<SizingSummaryResponse>(`/api/sizing/reports/summary?${query.toString()}`);
}

export async function fetchSizingAudit(id: string): Promise<{ ok: boolean; audit: SizingAuditRow }> {
  return fetchWithAuth<{ ok: boolean; audit: SizingAuditRow }>(`/api/sizing/audit/${encodeURIComponent(id)}`);
}
