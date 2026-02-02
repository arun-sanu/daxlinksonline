import { useCallback, useEffect, useMemo, useState } from 'react';
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
import DigitalGauge from '../../../components/DigitalGauge';

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

const POLL_MS = 5000;
const DNS_POLL_MS = 30000;
const WEBHOOK_POLL_MS = 15000;
const METRICS_POLL_MS = 5000;

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken');
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

export default function MonitoringModule() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsError, setDnsError] = useState('');
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState('');
  const [metrics, setMetrics] = useState<MonitoringMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(withApiBase('/api/v1/users/webhook-alerts?limit=50'), {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() }
      });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status})`);
      }
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      setAlerts(items);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to load alerts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const handle = setInterval(fetchAlerts, POLL_MS);
    return () => clearInterval(handle);
  }, [fetchAlerts]);

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
    } catch (err: any) {
      setMetricsError(err?.message || 'Failed to load metrics.');
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const handle = setInterval(fetchMetrics, METRICS_POLL_MS);
    return () => clearInterval(handle);
  }, [fetchMetrics]);

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
            <p className="text-sm muted-text">Auto-refreshing every {POLL_MS / 1000}s.</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>Last update: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</span>
            <button className="btn btn-secondary btn-small" type="button" onClick={fetchAlerts} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Strategy</th>
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Side</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Qty</th>
                <th className="px-3 py-2 text-left">TP</th>
                <th className="px-3 py-2 text-left">SL</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr
                  key={alert.id}
                  className={`border-t border-white/5 ${alert.payload ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  onClick={() => alert.payload && setSelected(alert)}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-300">{formatTime(alert.receivedAt)}</td>
                  <td className="px-3 py-2 text-xs text-main">{renderValue(alert.strategyName)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.symbol)}</td>
                  <td className="px-3 py-2 text-xs uppercase text-gray-200">{renderValue(alert.side)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.orderType)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.quantity)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.takeProfit)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.stopLoss)}</td>
                  <td className="px-3 py-2 text-xs text-gray-200">{renderValue(alert.status || 'received')}</td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-400">
                    Loading alerts…
                  </td>
                </tr>
              )}
              {!loading && alerts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-400">
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
            <button className="btn btn-secondary btn-small" type="button" onClick={fetchWebhooks} disabled={webhooksLoading}>
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
            <button className="btn btn-secondary btn-small" type="button" onClick={fetchDnsRecords} disabled={dnsLoading}>
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
                <button className="btn btn-secondary btn-small" type="button" onClick={fetchMetrics} disabled={metricsLoading}>
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
              <DigitalGauge
                label="Alerts / min"
                value={metrics ? String(metrics.throughputPerMin).padStart(3, '0') : '---'}
                unit="/min"
                hint="7-seg throughput"
              />
              <DigitalGauge
                label="Queue depth"
                value={metrics ? String(metrics.queueDepth).padStart(3, '0') : '---'}
                unit="jobs"
                hint="Pending deliveries"
              />
              <DigitalGauge
                label="Latency"
                value={metrics?.latencyMs != null ? String(metrics.latencyMs).padStart(3, '0') : '---'}
                unit="ms"
                hint="Avg response time"
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
              <button className="btn btn-secondary btn-small" type="button" onClick={() => setSelected(null)}>
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
