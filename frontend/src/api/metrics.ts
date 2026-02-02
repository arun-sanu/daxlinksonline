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
    throw new Error((json as any)?.error || (json as any)?.message || `Request failed (${res.status})`);
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

export function fetchMonitoringMetrics() {
  return request<MonitoringMetrics>('/api/v1/metrics/monitoring');
}
