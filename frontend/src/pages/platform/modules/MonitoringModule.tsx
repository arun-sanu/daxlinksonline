import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { withApiBase } from '../../../api/client';
import { listMyDnsRecords } from '../../../api/dns';
import type { DnsRecord } from '../../../api/types';
import { listWebhooks } from '../../../api/webhooks';
import type { Webhook } from '../../../api/types';
import { fetchMonitoringMetrics } from '../../../api/metrics';
import type { MonitoringMetrics } from '../../../api/metrics';
import LiveGauge from '../../../components/LiveGauge';
import LiveLineChart from '../../../components/LiveLineChart';
import MetricTile from '../../../components/MetricTile';

type AlertRow = {
  id: string;
  receivedAt?: string | Date | null;
  status?: string;
  strategyName?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  quantity?: string | number | null;
  takeProfit?: string | number | null;
  stopLoss?: string | number | null;
  errorMessage?: string | null;
  userId?: string | null;
  webhookSubdomain?: string | null;
  clientIp?: string | null;
  payload?: any;
};

type ConnectivityNode = {
  id: string;
  label?: string;
  type?: string;
  status?: string;
};

type ConnectivityLink = {
  id?: string;
  from: string;
  to: string;
  status?: string;
  alertsLastWindow?: number;
};

type ConnectivityPayload = {
  ok: boolean;
  windowMinutes: number;
  nodes: ConnectivityNode[];
  links: ConnectivityLink[];
};

const POLL_MS = 20000;
const DNS_POLL_MS = 30000;
const WEBHOOK_POLL_MS = 15000;
const METRICS_POLL_MS = 45000;
const CONNECTIVITY_POLL_MS = 15000;

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken') || localStorage.getItem('daxlinksToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function formatTime(ts?: string | Date | null) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function renderValue(value: any) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function toDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export default function MonitoringModule() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [clearedAt, setClearedAt] = useState<Date | null>(null);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState('');
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState('');
  const [metrics, setMetrics] = useState<MonitoringMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');
  const [metricsUnavailable, setMetricsUnavailable] = useState(false);
  const [connectivity, setConnectivity] = useState<ConnectivityPayload | null>(null);
  const [connectivityLoading, setConnectivityLoading] = useState(false);
  const [connectivityError, setConnectivityError] = useState('');
  const [connectivityUpdatedAt, setConnectivityUpdatedAt] = useState<Date | null>(null);
  const navigate = useNavigate();
  const isTodaySelected = selectedDate === toDateInputValue(new Date());

  const fetchAlertsPayload = useCallback(
    async (
      params: Record<string, string>,
      options?: { dateValue?: string; includeCleared?: boolean }
    ) => {
      const query = new URLSearchParams(params);
      const dateValue = options?.dateValue ?? selectedDate;
      const includeCleared = options?.includeCleared !== false;
      const baseDate = parseDateInput(dateValue);
      if (baseDate) {
        const start = new Date(baseDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(baseDate);
        end.setHours(23, 59, 59, 999);
        const todayKey = toDateInputValue(new Date());
        let sinceValue = start;
        if (includeCleared && dateValue === todayKey && clearedAt && clearedAt > start) {
          sinceValue = clearedAt;
        }
        query.set('since', sinceValue.toISOString());
        query.set('until', end.toISOString());
      }
      const queryString = query.toString();
      const fetchAlertsFrom = async (path: string) => {
        const res = await fetch(withApiBase(path), {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...authHeaders() }
        });
        if (res.status === 401) {
          navigate('/login');
          throw new Error('Unauthorized');
        }
        if (!res.ok) {
          const error = new Error(`Request failed (${res.status})`) as Error & { status?: number };
          error.status = res.status;
          throw error;
        }
        return res.json();
      };

      let data: any;
      try {
        data = await fetchAlertsFrom(`/api/v1/users/alerts?${queryString}`);
      } catch (err: any) {
        if (err?.status === 404) {
          data = await fetchAlertsFrom(`/api/v1/users/webhook-alerts?${queryString}`);
        } else {
          throw err;
        }
      }
      return data;
    },
    [clearedAt, navigate, selectedDate]
  );

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAlertsPayload({ page: '1', pageSize: '200', limit: '200' });
      const items = Array.isArray(data?.items) ? data.items : [];
      setAlerts(items);
      setSelectedIds((prev) => {
        if (!prev.size) return prev;
        const next = new Set<string>();
        items.forEach((item: AlertRow) => {
          if (prev.has(item.id)) next.add(item.id);
        });
        return next;
      });
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to load alerts.');
    } finally {
      setLoading(false);
    }
  }, [fetchAlertsPayload]);

  useEffect(() => {
    fetchAlerts();
    if (!isTodaySelected) return undefined;
    const handle = setInterval(fetchAlerts, POLL_MS);
    return () => clearInterval(handle);
  }, [fetchAlerts, isTodaySelected]);

  const handleClearAlerts = useCallback(() => {
    const now = new Date();
    if (isTodaySelected) {
      setClearedAt(now);
    } else {
      setClearedAt(null);
    }
    setAlerts([]);
    setSelected(null);
    setSelectedIds(new Set());
    setLastUpdated(now);
    setError('');
  }, [isTodaySelected]);

  const handleDownloadAlerts = useCallback(async () => {
    setDownloadLoading(true);
    setError('');
    try {
      const pageSize = 200;
      let page = 1;
      let all: AlertRow[] = [];
      let total: number | null = null;
      while (true) {
        const data = await fetchAlertsPayload(
          { page: String(page), pageSize: String(pageSize) },
          { includeCleared: false }
        );
        const items = Array.isArray(data?.items) ? data.items : [];
        all = all.concat(items);
        if (Number.isFinite(data?.total)) {
          total = Number(data.total);
        }
        if (items.length < pageSize) break;
        if (total !== null && all.length >= total) break;
        page += 1;
      }
      const payload = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          total: all.length,
          items: all
        },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `incoming-alerts-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Failed to download alerts.');
    } finally {
      setDownloadLoading(false);
    }
  }, [fetchAlertsPayload]);

  const handleDeleteAlerts = useCallback(async () => {
    const confirmed = window.confirm('Delete all incoming alerts? This action cannot be undone.');
    if (!confirmed) return;
    setDeleteLoading(true);
    setError('');
    try {
      const deleteFrom = async (path: string) => {
        const res = await fetch(withApiBase(path), {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...authHeaders() }
        });
        if (res.status === 401) {
          navigate('/login');
          throw new Error('Unauthorized');
        }
        if (!res.ok) {
          const error = new Error(`Request failed (${res.status})`) as Error & { status?: number };
          error.status = res.status;
          throw error;
        }
      };
      try {
        await deleteFrom('/api/v1/users/alerts');
      } catch (err: any) {
        if (err?.status === 404) {
          await deleteFrom('/api/v1/users/webhook-alerts');
        } else {
          throw err;
        }
      }
      setAlerts([]);
      setSelected(null);
      setSelectedIds(new Set());
      setClearedAt(null);
      await fetchAlerts();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete alerts.');
    } finally {
      setDeleteLoading(false);
    }
  }, [fetchAlerts, navigate]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (alerts.length === 0) return prev;
      const allSelected = alerts.every((alert) => prev.has(alert.id));
      if (allSelected) return new Set();
      return new Set(alerts.map((alert) => alert.id));
    });
  }, [alerts]);

  const allSelected = alerts.length > 0 && alerts.every((alert) => selectedIds.has(alert.id));

  const fetchDnsRecords = useCallback(async () => {
    setDnsLoading(true);
    setDnsError('');
    try {
      const rows = await listMyDnsRecords();
      setDnsRecords(rows);
    } catch (err: any) {
      setDnsError(err?.message || 'Failed to load DNS records.');
    } finally {
      setDnsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDnsRecords();
    const handle = setInterval(fetchDnsRecords, DNS_POLL_MS);
    return () => clearInterval(handle);
  }, [fetchDnsRecords]);

  const fetchWebhooks = useCallback(async () => {
    setWebhooksLoading(true);
    setWebhooksError('');
    try {
      const rows = await listWebhooks();
      setWebhooks(rows);
    } catch (err: any) {
      setWebhooksError(err?.message || 'Failed to load webhooks.');
    } finally {
      setWebhooksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
    const handle = setInterval(fetchWebhooks, WEBHOOK_POLL_MS);
    return () => clearInterval(handle);
  }, [fetchWebhooks]);

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError('');
    try {
      const data = await fetchMonitoringMetrics();
      setMetrics(data);
      setMetricsUnavailable(false);
    } catch (err: any) {
      if (err?.status === 401) {
        navigate('/login');
        return;
      }
      if (err?.status === 404) {
        setMetricsUnavailable(true);
        setMetricsError('Monitoring data unavailable.');
        return;
      }
      setMetricsError(err?.message || 'Failed to load metrics.');
    } finally {
      setMetricsLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (metricsUnavailable) return;
    fetchMetrics();
    const handle = setInterval(fetchMetrics, METRICS_POLL_MS);
    return () => clearInterval(handle);
  }, [fetchMetrics, metricsUnavailable]);

  const fetchConnectivity = useCallback(async () => {
    setConnectivityLoading(true);
    setConnectivityError('');
    try {
      const res = await fetch(withApiBase('/api/v1/metrics/connectivity?windowMinutes=15'), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() }
      });
      if (res.status === 401) {
        navigate('/login');
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const data = await res.json();
      if (!data?.ok) throw new Error('Connectivity unavailable');
      setConnectivity(data);
      setConnectivityUpdatedAt(new Date());
    } catch (err: any) {
      setConnectivityError(err?.message || 'Connectivity unavailable.');
      setConnectivity(null);
    } finally {
      setConnectivityLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    fetchConnectivity();
    const handle = setInterval(fetchConnectivity, CONNECTIVITY_POLL_MS);
    return () => clearInterval(handle);
  }, [fetchConnectivity]);

  const selectedPayload = useMemo(() => {
    if (!selected?.payload) return 'No payload available.';
    if (typeof selected.payload === 'string') return selected.payload;
    try {
      return JSON.stringify(selected.payload, null, 2);
    } catch {
      return String(selected.payload);
    }
  }, [selected]);

  const statusTone = useCallback((status?: string | null) => {
    const key = String(status || '').toLowerCase();
    if (key === 'active' || key === 'healthy') {
      return { label: 'Active', className: 'inline-flex rounded-full bg-emerald-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200' };
    }
    if (key === 'pending') {
      return { label: 'Pending', className: 'inline-flex rounded-full bg-amber-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200' };
    }
    if (key === 'error' || key === 'failed') {
      return { label: 'Error', className: 'inline-flex rounded-full bg-rose-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-rose-200' };
    }
    return { label: status || 'Unknown', className: 'inline-flex rounded-full bg-gray-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-gray-300' };
  }, []);

  const connectivityTone = useCallback((status?: string | null) => {
    const key = String(status || 'unknown').toLowerCase();
    if (key === 'ok') return '#34d399';
    if (key === 'degraded') return '#fbbf24';
    if (key === 'down') return '#f87171';
    if (key === 'idle') return 'rgba(52, 211, 153, 0.45)';
    return '#9ca3af';
  }, []);

  const aggregateStatus = useCallback((nodes: ConnectivityNode[] = []) => {
    const states = nodes.map((node) => String(node.status || 'unknown').toLowerCase());
    if (states.includes('down')) return 'down';
    if (states.includes('degraded')) return 'degraded';
    if (states.includes('ok')) return 'ok';
    if (states.includes('idle')) return 'idle';
    return 'unknown';
  }, []);

  const treeLayout = useMemo(() => {
    const nodes = connectivity?.nodes || [];
    const ingress = nodes.find((node) => node.type === 'source' || node.id === 'ingress');
    const webhooksGroup = nodes.filter((node) => node.type === 'webhook');
    const integrationsGroup = nodes.filter((node) => node.type === 'integration');
    const dnsGroup = nodes.filter((node) => node.type === 'dns' || node.type === 'dnsRecord');

    const rootLabel = 'DAX Links Server';
    const rootLabelLines = ['DAX', 'Links', 'Server'];
    const rootStatus = aggregateStatus(nodes);
    const rootWidth = 90;
    const rootHeight = 90;
    const root = {
      id: 'root',
      label: rootLabel,
      labelLines: rootLabelLines,
      status: rootStatus,
      x: 60,
      y: 260,
      width: rootWidth,
      height: rootHeight,
      anchorX: 60 + rootWidth,
      anchorY: 260
    };

    const groups = [
      {
        id: 'group:tradingview',
        label: ingress?.label || 'TradingView',
        status: ingress?.status || 'ok',
        items: []
      },
      {
        id: 'group:webhooks',
        label: 'Webhooks',
        status: aggregateStatus(webhooksGroup),
        items: webhooksGroup
      },
      {
        id: 'group:integrations',
        label: integrationsGroup.length ? 'Banking' : 'Integrations',
        status: aggregateStatus(integrationsGroup),
        items: integrationsGroup
      },
      {
        id: 'group:dns',
        label: 'DNS Addresses',
        status: aggregateStatus(dnsGroup),
        items: dnsGroup
      }
    ].filter((group) => group.items.length > 0 || group.id === 'group:tradingview');

    const startY = 100;
    const endY = 420;
    const gapY = groups.length > 1 ? (endY - startY) / (groups.length - 1) : 0;
    const groupX = 320;
    const bracketX = 520;
    const itemX = 545;
    const itemGap = 26;

    const branches = [];
    const stems = [];
    const brackets = [];
    const items = [];
    const groupLabels = [];

    groups.forEach((group, idx) => {
      const y = startY + idx * gapY;
      const labelWidth = Math.max(80, group.label.length * 7);
      const label = {
        ...group,
        x: groupX,
        y,
        width: labelWidth,
        tone: connectivityTone(group.status)
      };
      groupLabels.push(label);

      const branchStart = { x: root.anchorX, y: root.anchorY };
      const branchEndX = groupX - 16;
      const branchPath = `M ${root.anchorX} ${root.anchorY} L ${branchEndX} ${y}`;
      branches.push({
        id: `${root.id}-${group.id}`,
        path: branchPath,
        tone: label.tone,
        start: branchStart,
        end: { x: branchEndX, y }
      });

      if (group.items.length) {
        const maxListHeight = 180;
        const spacing = group.items.length > 1
          ? Math.min(itemGap, maxListHeight / (group.items.length - 1))
          : 0;
        const listTop = y - ((group.items.length - 1) * spacing) / 2;
        const listItems = group.items.map((item, itemIdx) => ({
          id: item.id,
          label: `[${item.label || item.id}]`,
          x: itemX,
          y: listTop + itemIdx * spacing,
          tone: connectivityTone(item.status)
        }));
        items.push(...listItems);

        const bracketTop = listItems[0].y - 10;
        const bracketBottom = listItems[listItems.length - 1].y + 10;
        const bracketPath = `M ${bracketX + 10} ${bracketTop} L ${bracketX} ${bracketTop} L ${bracketX} ${bracketBottom} L ${bracketX + 10} ${bracketBottom}`;
        brackets.push({ id: `${group.id}-bracket`, path: bracketPath, tone: label.tone });

        const stemStartX = groupX + labelWidth + 14;
        const midY = (bracketTop + bracketBottom) / 2;
        const stemPath = `M ${stemStartX} ${y} L ${bracketX} ${midY}`;
        stems.push({
          id: `${group.id}-stem`,
          path: stemPath,
          tone: label.tone,
          start: { x: stemStartX, y },
          end: { x: bracketX, y: midY }
        });
      }
    });

    return {
      root,
      groupLabels,
      branches,
      stems,
      brackets,
      items
    };
  }, [connectivity, connectivityTone, aggregateStatus]);

  const linkLayout = useMemo(() => {
    const links = connectivity?.links || [];
    const nodes = connectivity?.nodes || [];
    const map = new Map(nodes.map((node) => [node.id, node]));
    return links
      .map((link) => {
        const from = map.get(link.from);
        const to = map.get(link.to);
        return {
          ...link,
          from,
          to,
          tone: connectivityTone(link.status)
        };
      })
      .filter(Boolean) as Array<ConnectivityLink & { from: ConnectivityNode | undefined; to: ConnectivityNode | undefined; tone: string }>;
  }, [connectivity, connectivityTone]);

  return (
    <div className="monitoring-page space-y-6">
      <header className="space-y-2">
        <p className="section-label">Monitoring</p>
        <h2 className="text-3xl font-semibold text-main">TradingView alert feed</h2>
        <p className="text-sm muted-text">
          Live TradingView webhook alerts appear here with timestamps and full payload details.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)] items-start">
        <div className="space-y-6">
          <article className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Incoming alerts</p>
            <p className="text-sm muted-text">
              {isTodaySelected ? `Auto-refreshing every ${POLL_MS / 1000}s.` : 'Viewing alerts for the selected date.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                  <line x1="16" y1="2.5" x2="16" y2="6"></line>
                  <line x1="8" y1="2.5" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </span>
              <input
                type="date"
                className="rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-gray-200 focus:border-primary-300 focus:outline-none"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </div>
            <span>Last update: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</span>
            <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={fetchAlerts} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={handleClearAlerts} disabled={loading || alerts.length === 0}>
              Clear
            </button>
            <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={handleDownloadAlerts} disabled={downloadLoading}>
              {downloadLoading ? 'Downloading…' : 'Download'}
            </button>
            <button className="btn btn-danger btn-small btn-rect" type="button" onClick={handleDeleteAlerts} disabled={deleteLoading}>
              {deleteLoading ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <div className={`rounded-xl border border-white/10 overflow-x-auto ${isTodaySelected ? 'max-h-[420px] overflow-y-auto' : ''}`}>
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-400"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all alerts"
                  />
                </th>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Strategy</th>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Side</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Qty</th>
                <th className="px-3 py-2 text-left">TP</th>
                <th className="px-3 py-2 text-left">SL</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={`border-t border-white/5 ${alert.payload ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  onClick={() => alert.payload && setSelected(alert)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-400"
                      checked={selectedIds.has(alert.id)}
                      onChange={() => toggleSelect(alert.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select alert ${alert.id}`}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-300">{formatTime(alert.receivedAt)}</td>
                  <td className="px-3 py-2 text-xs text-main">{renderValue(alert.strategyName)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.symbol)}</td>
                  <td className="px-3 py-2 text-xs uppercase text-gray-200">{renderValue(alert.side)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.orderType)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.quantity)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.takeProfit)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.stopLoss)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.status || 'received')}</td>
                  <td className="px-3 py-2 text-xs text-rose-200">{renderValue(alert.errorMessage)}</td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-sm text-gray-400">
                    Loading alerts…
                  </td>
                </tr>
              )}
              {!loading && alerts.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-sm text-gray-400">
                    No alerts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">Click a row to view the full payload.</p>
      </article>

          <article className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Webhooks</p>
            <p className="text-sm muted-text">Configured webhooks with live status.</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>Auto-refresh every {WEBHOOK_POLL_MS / 1000}s</span>
            <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={fetchWebhooks} disabled={webhooksLoading}>
              {webhooksLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {webhooksError && <p className="text-sm text-rose-400">{webhooksError}</p>}

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Webhook</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Method</th>
                <th className="px-3 py-2 text-left">Last Code</th>
                <th className="px-3 py-2 text-left">Last Delivery</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((wh) => {
                const tone = statusTone(wh.active ? 'active' : 'error');
                return (
                  <tr key={wh.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      <p className="text-xs text-main">{wh.name || 'Webhook'}</p>
                      <p className="text-[11px] text-gray-400 break-all">{wh.url}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={tone.className}>{wh.active ? 'Active' : 'Paused'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-200">{wh.method || 'POST'}</td>
                    <td className="px-3 py-2 text-xs text-gray-200">{wh.lastResponseCode ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-300">{formatTime(wh.lastDeliveryAt)}</td>
                  </tr>
                );
              })}
              {webhooksLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                    Loading webhooks…
                  </td>
                </tr>
              )}
              {!webhooksLoading && webhooks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                    No webhooks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

          <article className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">DNS records</p>
            <p className="text-sm muted-text">Webhook subdomains and their current status.</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>Auto-refresh every {DNS_POLL_MS / 1000}s</span>
            <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={fetchDnsRecords} disabled={dnsLoading}>
              {dnsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {dnsError && <p className="text-sm text-rose-400">{dnsError}</p>}

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Subdomain</th>
                <th className="px-3 py-2 text-left">Target IP</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {dnsRecords.map((rec) => {
                const tone = statusTone(rec.status);
                return (
                  <tr key={rec.id} className="border-t border-white/5">
                    <td className="px-3 py-2 text-xs text-main">{rec.name}</td>
                    <td className="px-3 py-2 text-xs text-gray-200">{rec.ip || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={tone.className}>{tone.label}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300">{formatTime(rec.createdAt)}</td>
                  </tr>
                );
              })}
              {dnsLoading && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">
                    Loading DNS records…
                  </td>
                </tr>
              )}
              {!dnsLoading && dnsRecords.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">
                    No DNS records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </article>

          <article className="card-shell space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Connectivity Map</p>
                <p className="text-sm muted-text">Live metro view of signal flow and link health.</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>Auto-refresh every {CONNECTIVITY_POLL_MS / 1000}s</span>
                <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={fetchConnectivity} disabled={connectivityLoading}>
                  {connectivityLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {connectivityError && <p className="text-sm text-rose-400">{connectivityError}</p>}
            {!connectivity && !connectivityLoading && (
              <p className="text-sm text-gray-400">Connectivity unavailable.</p>
            )}

            {connectivity && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
                <div className="connectivity-shell">
                  <svg className="connectivity-svg connectivity-tree" viewBox="0 0 900 520" aria-label="Connectivity diagram">
                    <g className="connectivity-branches">
                      {treeLayout.branches.map((branch) => (
                        <g key={branch.id}>
                          <path
                            className="connectivity-branch"
                            d={branch.path}
                            stroke={branch.tone}
                            strokeWidth={3}
                            fill="none"
                          />
                          <circle className="connectivity-endpoint" cx={branch.start.x} cy={branch.start.y} r={4} fill={branch.tone} />
                          <circle className="connectivity-endpoint" cx={branch.end.x} cy={branch.end.y} r={4} fill={branch.tone} />
                        </g>
                      ))}
                    </g>
                    <g className="connectivity-stems">
                      {treeLayout.stems.map((stem) => (
                        <g key={stem.id}>
                          <path
                            className="connectivity-stem"
                            d={stem.path}
                            stroke={stem.tone}
                            strokeWidth={2}
                            fill="none"
                          />
                          <circle className="connectivity-endpoint" cx={stem.start.x} cy={stem.start.y} r={3} fill={stem.tone} />
                          <circle className="connectivity-endpoint" cx={stem.end.x} cy={stem.end.y} r={3} fill={stem.tone} />
                        </g>
                      ))}
                    </g>
                    <g className="connectivity-brackets">
                      {treeLayout.brackets.map((bracket) => (
                        <path
                          key={bracket.id}
                          className="connectivity-bracket"
                          d={bracket.path}
                          stroke={bracket.tone}
                          strokeWidth={2}
                          fill="none"
                        />
                      ))}
                    </g>
                    <g className="connectivity-root">
                      <rect
                        className="connectivity-root-box"
                        x={treeLayout.root.x}
                        y={treeLayout.root.y - treeLayout.root.height / 2}
                        width={treeLayout.root.width}
                        height={treeLayout.root.height}
                        rx={10}
                      />
                      <rect
                        className="connectivity-root-tab"
                        x={treeLayout.root.x}
                        y={treeLayout.root.y + treeLayout.root.height / 2 + 6}
                        width={treeLayout.root.width}
                        height={24}
                        rx={8}
                      />
                      <circle
                        className="connectivity-led"
                        cx={treeLayout.root.x + 12}
                        cy={treeLayout.root.y - treeLayout.root.height / 2 + 12}
                        r={4}
                        fill={connectivityTone(treeLayout.root.status)}
                      />
                      <text
                        className="connectivity-root-label"
                        x={treeLayout.root.x + treeLayout.root.width / 2}
                        y={treeLayout.root.y - 8}
                        textAnchor="middle"
                      >
                        {(treeLayout.root.labelLines || [treeLayout.root.label]).map((line: string, idx: number) => (
                          <tspan key={line} x={treeLayout.root.x + treeLayout.root.width / 2} dy={idx === 0 ? 0 : 14}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                      <g
                        className="connectivity-root-icons"
                        transform={`translate(${treeLayout.root.x + treeLayout.root.width - 32}, ${treeLayout.root.y + treeLayout.root.height / 2 + 10})`}
                      >
                        <g transform="scale(0.42)">
                          <path
                            d="M12 2l7 3v6c0 5-3.5 9-7 11-3.5-2-7-6-7-11V5l7-3z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinejoin="round"
                          />
                        </g>
                        <g transform="translate(12, 0) scale(0.42)">
                          <path
                            d="M7 11V8a5 5 0 0110 0v3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                          <rect
                            x="6"
                            y="11"
                            width="12"
                            height="9"
                            rx="2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                        </g>
                      </g>
                    </g>
                    <g className="connectivity-groups">
                      {treeLayout.groupLabels.map((group) => (
                        <g key={group.id}>
                          <circle
                            className="connectivity-dot"
                            cx={group.x - 10}
                            cy={group.y}
                            r={4}
                            fill={group.tone}
                          />
                          <text
                            className="connectivity-group-label"
                            x={group.x}
                            y={group.y + 4}
                            fill={group.tone}
                          >
                            {group.label}
                          </text>
                        </g>
                      ))}
                    </g>
                    <g className="connectivity-items">
                      {treeLayout.items.map((item) => (
                        <g key={item.id}>
                          <circle
                            className="connectivity-dot"
                            cx={item.x - 10}
                            cy={item.y}
                            r={3}
                            fill={item.tone}
                          />
                          <text
                            className="connectivity-item-label"
                            x={item.x}
                            y={item.y + 4}
                            fill={item.tone}
                          >
                            {item.label}
                          </text>
                        </g>
                      ))}
                    </g>
                  </svg>
                </div>
                <aside className="connectivity-panel">
                  <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Link details</p>
                  <p className="text-xs text-gray-400">Last update: {connectivityUpdatedAt ? connectivityUpdatedAt.toLocaleTimeString() : '—'}</p>
                  <div className="mt-3 space-y-3">
                    {linkLayout.map((link, idx) => (
                      <div key={`panel-${link.id || idx}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200">
                        <div className="flex items-center justify-between gap-2">
                          <span>{link.from?.label || link.from?.id} → {link.to?.label || link.to?.id}</span>
                          <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em]" style={{ color: link.tone }}>
                            <span className="h-2 w-2 rounded-full" style={{ background: link.tone }}></span>
                            {link.status || 'unknown'}
                          </span>
                        </div>
                        {link.alertsLastWindow != null && (
                          <p className="text-xs text-gray-400">Alerts (window): {link.alertsLastWindow}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            )}
          </article>

        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <article className="card-shell space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Realtime metrics</p>
                <p className="text-sm muted-text">Live meters and throughput charts for webhook activity.</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>Auto-refresh every {METRICS_POLL_MS / 1000}s</span>
                <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={fetchMetrics} disabled={metricsLoading}>
                  {metricsLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>

            {metricsError && <p className="text-sm text-rose-400">{metricsError}</p>}

            <div className="grid gap-4">
              <MetricTile
                label="Alerts / min"
                value={metrics ? `${metrics.throughputPerMin}` : '—'}
                detail="Recent TradingView webhook alerts"
              />
              <MetricTile
                label="Queue depth"
                value={metrics ? `${metrics.queueDepth}` : '—'}
                detail="Pending deliveries"
              />
              <MetricTile
                label="Latency (ms)"
                value={metrics?.latencyMs != null ? `${metrics.latencyMs}` : '—'}
                detail="Avg response time (last minute)"
              />
            </div>

            <div className="grid gap-4">
              <LiveGauge
                label="Error rate"
                value={metrics ? metrics.errorRate * 100 : 0}
                max={100}
                unit="%"
                hint="Failed deliveries in the last minute"
              />
              <LiveGauge
                label="Throughput"
                value={metrics ? metrics.throughputPerMin : 0}
                max={Math.max(10, metrics?.throughputPerMin || 0)}
                unit="/min"
                hint="Alerts per minute"
              />
              <LiveGauge
                label="Latency"
                value={metrics?.latencyMs || 0}
                max={Math.max(1000, metrics?.latencyMs || 0)}
                unit="ms"
                hint="Average response time"
              />
            </div>

            <div className="grid gap-4">
              <LiveLineChart title="Throughput" data={metrics?.series.throughput || []} unit="/min" color="#7c8cff" />
              <LiveLineChart title="Errors" data={metrics?.series.errors || []} unit="count" color="#fb7185" />
              <LiveLineChart title="Latency" data={metrics?.series.latency || []} unit="ms" color="#34d399" />
            </div>
          </article>
        </aside>
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0b1022] p-4 shadow-xl">
            <header className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-gray-500">Payload</p>
                <p className="text-sm text-main">TradingView alert</p>
              </div>
              <button className="btn btn-secondary btn-small btn-rect" type="button" onClick={() => setSelected(null)}>
                Close
              </button>
            </header>
            <div className="mt-3 rounded-xl bg-black/40 p-3 text-left text-xs text-gray-100 overflow-auto max-h-[60vh]">
              <pre className="whitespace-pre-wrap leading-relaxed">{selectedPayload}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
