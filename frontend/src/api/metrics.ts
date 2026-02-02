import { withApiBase } from './client';

function authHeaders() {
  try {
    const token = localStorage.getItem('authToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(input: string): Promise<T> {
  const url = withApiBase(input);
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error((json as any)?.error || (json as any)?.message || `Request failed (${res.status})`) as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  return json as T;
}

export type MetricsPoint = { ts: string; value: number };

export type MonitoringMetrics = {
  now: string;
  windowMinutes: number;
  throughputPerMin: number;
  queueDepth: number;
  errorRate: number;
  latencyMs: number | null;
  series: {
    throughput: MetricsPoint[];
    errors: MetricsPoint[];
    latency: MetricsPoint[];
  };
};

function normalizeSeries(series: any) {
  const throughput = Array.isArray(series?.throughput) ? series.throughput : [];
  const errors = Array.isArray(series?.errors) ? series.errors : [];
  const latency = Array.isArray(series?.latency) ? series.latency : [];
  return { throughput, errors, latency };
}

function normalizeMonitoringMetrics(payload: any): MonitoringMetrics {
  const summary = payload?.summary ?? payload ?? {};
  const series = payload?.arrays ?? payload?.series ?? {};
  return {
    now: summary.now || new Date().toISOString(),
    windowMinutes: Number(summary.windowMinutes ?? 0),
    throughputPerMin: Number(summary.throughputPerMin ?? summary.throughput ?? 0),
    queueDepth: Number(summary.queueDepth ?? summary.queue ?? 0),
    errorRate: Number(summary.errorRate ?? 0),
    latencyMs:
      summary.latencyMs === null || summary.latencyMs === undefined
        ? summary.latency == null
          ? null
          : Number(summary.latency)
        : Number(summary.latencyMs),
    series: normalizeSeries(series)
  };
}

export async function fetchMonitoringMetrics() {
  const payload = await request<MonitoringMetrics | { summary?: any; arrays?: any; series?: any }>(
    '/api/v1/metrics/monitoring'
  );
  return normalizeMonitoringMetrics(payload);
}
