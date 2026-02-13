import { withApiBase } from './client';

export type AdminSizingReportItem = {
  id: string;
  orderId: string;
  createdAt: string;
  symbol: string | null;
  side: string | null;
  strategy: string | null;
  status: string | null;
  sizingRejectReason: string | null;
  quoteSpend: number | null;
  qtyRaw: number | null;
  qtyFinal: number | null;
  refPrice: number | null;
  minNotional: number | null;
  stepSize: number | null;
  riskMode: string | null;
  riskValue: number | null;
  slPrice: number | null;
  tpPrice: number | null;
  freeQuote: number | null;
  freeBase: number | null;
  exchangeMinNotional: number | null;
  effectiveMinNotional: number | null;
  precisionAmount: number | null;
  reportStepSize: number | null;
  roundingMethod: string | null;
  workspaceId: string | null;
  botId: string | null;
  botName: string | null;
  botInstanceId: string | null;
};

export type AdminSizingReportsResponse = {
  items: AdminSizingReportItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminSizingReportDetail = {
  summary: AdminSizingReportItem;
  rawPayload: any;
  normalizedSignal: any;
  executionResult: any;
};

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

function parseRange(range?: string) {
  const now = new Date();
  if (range === '24h') {
    return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
  }
  if (range === '30d') {
    return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now };
  }
  return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now };
}

function toAuditRow(item: AdminSizingReportItem): SizingAuditRow {
  const notional =
    item.qtyFinal !== null && item.qtyFinal !== undefined && item.refPrice !== null && item.refPrice !== undefined
      ? item.qtyFinal * item.refPrice
      : null;
  return {
    id: item.id,
    receivedAt: item.createdAt,
    symbol: item.symbol,
    side: item.side,
    status: item.status,
    errorMessage: item.sizingRejectReason || null,
    computedPrice: item.refPrice,
    freeQuote: item.freeQuote,
    freeBase: item.freeBase,
    qtyRaw: item.qtyRaw,
    qtyRounded: item.qtyFinal,
    mexcOrderId: item.orderId,
    rejectedReason: item.sizingRejectReason || null,
    quoteSpendComputed: item.quoteSpend,
    notionalAfterRounding: notional,
    sizingDebug: {
      freeQuote: item.freeQuote,
      freeBase: item.freeBase,
      qtyRaw: item.qtyRaw,
      qtyAfterStepRounding: item.qtyFinal,
      quoteSpendComputed: item.quoteSpend,
      priceUsed: item.refPrice,
      notionalAfterRounding: notional,
      minNotional: item.minNotional,
      stepSize: item.stepSize,
      riskMode: item.riskMode,
      riskValue: item.riskValue,
      slPrice: item.slPrice,
      tpPrice: item.tpPrice,
      rejectedReason: item.sizingRejectReason,
      sizingStatus: item.status
    }
  };
}

export async function fetchAdminSizingReports(params: {
  symbol?: string;
  status?: string;
  strategy?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  workspaceId?: string;
}): Promise<AdminSizingReportsResponse> {
  const query = new URLSearchParams();
  const workspaceId = params.workspaceId || getWorkspaceId();
  if (workspaceId) query.set('workspaceId', workspaceId);
  if (params.symbol) query.set('symbol', params.symbol.trim().toUpperCase());
  if (params.status) query.set('status', params.status.trim().toLowerCase());
  if (params.strategy) query.set('strategy', params.strategy.trim());
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  return fetchWithAuth<AdminSizingReportsResponse>(`/api/v1/admin/sizing-reports?${query.toString()}`);
}

export async function fetchAdminSizingReport(id: string): Promise<AdminSizingReportDetail> {
  return fetchWithAuth<AdminSizingReportDetail>(`/api/v1/admin/sizing-reports/${encodeURIComponent(id)}`);
}

export async function fetchSizingRecent(params: {
  limit?: number;
  symbol?: string;
  side?: string;
  status?: string;
  since?: string;
  until?: string;
}): Promise<SizingRecentResponse> {
  const payload = await fetchAdminSizingReports({
    symbol: params.symbol,
    status: params.status,
    from: params.since,
    to: params.until,
    limit: params.limit || 50,
    page: 1
  });

  let items = payload.items || [];
  if (params.side && params.side !== 'ALL') {
    const side = params.side.toUpperCase();
    items = items.filter((item) => String(item.side || '').toUpperCase() === side);
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    total: items.length,
    items: items.map(toAuditRow)
  };
}

export async function fetchSizingSummary(params: {
  range?: string;
  since?: string;
  until?: string;
}): Promise<SizingSummaryResponse> {
  const range = params.range || '7d';
  const window = params.since && params.until
    ? { start: new Date(params.since), end: new Date(params.until) }
    : parseRange(range);

  const payload = await fetchAdminSizingReports({
    from: window.start.toISOString(),
    to: window.end.toISOString(),
    limit: 500,
    page: 1
  });
  const audits = (payload.items || []).map(toAuditRow);

  const groupsMap = new Map<string, any>();
  const overallRejected: Record<string, number> = {};
  let sent = 0;
  let filled = 0;
  let rejected = 0;
  let error = 0;

  audits.forEach((row) => {
    const symbol = row.symbol || 'UNKNOWN';
    const side = row.side || 'UNKNOWN';
    const key = `${symbol}::${side}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        symbol,
        side,
        count_total: 0,
        count_sent: 0,
        count_filled: 0,
        count_rejected: 0,
        count_error: 0,
        rejectedReasons: {} as Record<string, number>,
        qty: [] as number[],
        notional: [] as number[],
        quote: [] as number[]
      });
    }
    const group = groupsMap.get(key);
    group.count_total += 1;

    const status = String(row.status || '').toLowerCase();
    if (['open', 'submitted', 'sent'].includes(status)) {
      sent += 1;
      group.count_sent += 1;
    } else if (['filled', 'success', 'executed'].includes(status)) {
      filled += 1;
      group.count_filled += 1;
    } else if (['rejected', 'failed'].includes(status)) {
      rejected += 1;
      group.count_rejected += 1;
    } else if (status.includes('error')) {
      error += 1;
      group.count_error += 1;
    }

    if (row.rejectedReason) {
      group.rejectedReasons[row.rejectedReason] = (group.rejectedReasons[row.rejectedReason] || 0) + 1;
      overallRejected[row.rejectedReason] = (overallRejected[row.rejectedReason] || 0) + 1;
    }
    if (typeof row.qtyRounded === 'number') group.qty.push(row.qtyRounded);
    if (typeof row.notionalAfterRounding === 'number') group.notional.push(row.notionalAfterRounding);
    if (typeof row.quoteSpendComputed === 'number') group.quote.push(row.quoteSpendComputed);
  });

  const groups: SizingSummaryGroup[] = Array.from(groupsMap.values()).map((group) => {
    const topRejected = Object.entries(group.rejectedReasons).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const avg = (items: number[]) => (items.length ? items.reduce((sum, item) => sum + item, 0) / items.length : null);
    return {
      symbol: group.symbol,
      side: group.side,
      count_total: group.count_total,
      count_sent: group.count_sent,
      count_filled: group.count_filled,
      count_rejected: group.count_rejected,
      count_error: group.count_error,
      most_common_rejectedReason: topRejected,
      avg_qtyRounded: avg(group.qty),
      avg_notionalAfterRounding: avg(group.notional),
      avg_quoteSpendComputed: avg(group.quote),
      min_qtyRounded: group.qty.length ? Math.min(...group.qty) : null,
      max_qtyRounded: group.qty.length ? Math.max(...group.qty) : null
    };
  });

  const topRejectedReason = Object.entries(overallRejected).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    range,
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    total: audits.length,
    summary: {
      total: audits.length,
      sent,
      filled,
      rejected,
      error,
      topRejectedReason
    },
    groups
  };
}

export async function fetchSizingAudit(id: string): Promise<{ ok: boolean; audit: SizingAuditRow }> {
  const detail = await fetchAdminSizingReport(id);
  return {
    ok: true,
    audit: toAuditRow(detail.summary)
  };
}
