import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type {
  BotInstance,
  BotRun,
  InstanceLogEntry,
  InstanceMetrics,
  InstanceSecurity,
  MetricPoint,
  Order,
  Position
} from '../../api/types';
import {
  getBrokerHealth,
  getInstance,
  getInstanceLogs,
  getInstanceMetrics,
  getInstanceOrders,
  getInstancePositions,
  getInstanceRuns,
  getInstanceSecurity,
  getInstanceSignals,
  startInstance,
  stopInstance
} from '../../api/tradeBots';

type Tab = 'overview' | 'logs' | 'metrics';
type MetricsWindow = '1m' | '5m' | '15m';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Live Logs' },
  { id: 'metrics', label: 'Metrics' }
];

const metricWindows: MetricsWindow[] = ['1m', '5m', '15m'];

export default function InstanceDetail() {
  const { instanceId } = useParams();
  const [inst, setInst] = useState<BotInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [runs, setRuns] = useState<BotRun[]>([]);
  const [logs, setLogs] = useState<InstanceLogEntry[]>([]);
  const [signalsCount, setSignalsCount] = useState(0);
  const [brokerOk, setBrokerOk] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<InstanceMetrics>({ cpu: [], memMiB: [] });
  const [security, setSecurity] = useState<InstanceSecurity | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>('5m');

  const refreshOverview = useCallback(async (withSpinner = false) => {
    if (!instanceId) return;
    if (withSpinner) setLoading(true);
    try {
      const [instance, ordersResp, positionsResp, runsResp, signalsResp] = await Promise.all([
        getInstance(instanceId),
        getInstanceOrders(instanceId),
        getInstancePositions(instanceId),
        getInstanceRuns(instanceId),
        getInstanceSignals(instanceId)
      ]);
      setInst(instance);
      if (!instance) {
        setOrders([]);
        setPositions([]);
        setRuns([]);
        setSignalsCount(0);
        return;
      }
      setOrders(ordersResp.items);
      setPositions(positionsResp.items);
      setRuns(runsResp.items);
      setSignalsCount(signalsResp.items.length);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  const refreshLogs = useCallback(async () => {
    if (!instanceId) return;
    const res = await getInstanceLogs(instanceId, 200);
    setLogs(res.items);
  }, [instanceId]);

  const refreshMetrics = useCallback(async () => {
    if (!instanceId) return;
    const res = await getInstanceMetrics(instanceId, metricsWindow);
    setMetrics(res);
  }, [instanceId, metricsWindow]);

  const refreshSecurity = useCallback(async () => {
    if (!instanceId) return;
    try {
      const sec = await getInstanceSecurity(instanceId);
      setSecurity(sec);
    } catch {
      setSecurity(null);
    }
  }, [instanceId]);

  const refreshBrokerHealth = useCallback(async () => {
    try {
      const ok = await getBrokerHealth();
      setBrokerOk(ok);
    } catch {
      setBrokerOk(false);
    }
  }, []);

  useEffect(() => {
    refreshOverview(true);
    const interval = setInterval(() => { refreshOverview(); }, 5000);
    return () => clearInterval(interval);
  }, [refreshOverview]);

  useEffect(() => {
    refreshBrokerHealth();
    const interval = setInterval(() => { refreshBrokerHealth(); }, 15000);
    return () => clearInterval(interval);
  }, [refreshBrokerHealth]);

  useEffect(() => {
    if (activeTab !== 'logs') return;
    refreshLogs();
    const interval = setInterval(() => { refreshLogs(); }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, refreshLogs]);

  useEffect(() => {
    if (activeTab !== 'metrics') return;
    refreshMetrics();
    const interval = setInterval(() => { refreshMetrics(); }, 5000);
    return () => clearInterval(interval);
  }, [activeTab, refreshMetrics]);

  useEffect(() => {
    refreshSecurity();
    const interval = setInterval(() => { refreshSecurity(); }, 10000);
    return () => clearInterval(interval);
  }, [refreshSecurity]);

  useEffect(() => {
    setLogs([]);
    setMetrics({ cpu: [], memMiB: [] });
    setSecurity(null);
  }, [instanceId]);

  async function onStart() {
    if (!instanceId || inst?.status === 'running') return;
    if (!confirm('Start this instance?')) return;
    setActionBusy(true);
    try {
      await startInstance(instanceId);
      await refreshOverview();
    } finally {
      setActionBusy(false);
    }
  }

  async function onStop() {
    if (!instanceId || inst?.status !== 'running') return;
    if (!confirm('Stop this instance?')) return;
    setActionBusy(true);
    try {
      await stopInstance(instanceId);
      await refreshOverview();
    } finally {
      setActionBusy(false);
    }
  }

  if (loading && !inst) return <div className="text-gray-500">Loading…</div>;
  if (!inst) return <div className="text-red-600">Instance not found.</div>;

  const statusBadge = (
    <span className={`px-2 py-1 rounded text-xs capitalize ${statusClass(inst.status)}`}>
      {inst.status}
    </span>
  );

  const brokerBadge = brokerOk === null
    ? null
    : (
        <span className={`px-2 py-1 rounded text-xs ${brokerOk ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
          Broker {brokerOk ? 'OK' : 'Down'}
        </span>
      );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Bot Instance</div>
          <div className="text-2xl font-bold">{inst.symbol} • {inst.exchangeAccountId}</div>
          <div className="text-sm text-gray-500">ID {inst.id}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {statusBadge}
          {brokerBadge}
          <button
            onClick={onStart}
            disabled={inst.status === 'running' || actionBusy}
            className={`px-3 py-2 rounded text-white ${inst.status === 'running' || actionBusy ? 'bg-green-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
          >
            Start
          </button>
          <button
            onClick={onStop}
            disabled={inst.status !== 'running' || actionBusy}
            className={`px-3 py-2 rounded text-white ${inst.status !== 'running' || actionBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-800'}`}
          >
            Stop
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Runtime</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Started</dt><dd>{formatDate(inst.startedAt)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Stopped</dt><dd>{formatDate(inst.stoppedAt)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Direction</dt><dd className="capitalize">{inst.direction}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Webhook Token</dt><dd className="font-mono text-xs">{inst.webhookToken.slice(0, 8)}…</dd></div>
          </dl>
          {inst.lastError && <p className="mt-3 text-xs text-red-600">Last error: {inst.lastError}</p>}
        </div>
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Risk & Limits</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Leverage</dt><dd>{inst.leverage}×</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Max Daily Loss</dt><dd>{inst.maxDailyLossPct}%</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Take Profit</dt><dd>{inst.takeProfitPct}%</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">ATR Stop</dt><dd>{inst.slAtrMult}×</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Min Notional</dt><dd>${inst.minNotional}</dd></div>
          </dl>
        </div>
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Signals</h3>
          <div className="text-4xl font-bold">{signalsCount}</div>
          <div className="text-sm text-gray-500">Signals processed (last poll)</div>
          <p className="mt-3 text-xs text-gray-500">Limit entries: {inst.useLimitEntries ? 'Enabled' : 'Disabled'}</p>
        </div>
        <div className="border rounded p-4 md:col-span-3 lg:col-span-1">
          <h3 className="font-semibold mb-2">Security</h3>
          <SecuritySummary security={security} />
        </div>
      </div>

      <div>
        <div className="border-b border-gray-200 dark:border-gray-800 flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm border-b-2 ${activeTab === tab.id ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <OverviewCard title="Orders">
              {orders.length === 0 ? <p className="text-sm text-gray-500">No orders</p> : (
                <ul className="text-sm space-y-1">
                  {orders.map((o) => (
                    <li key={o.id} className="flex justify-between">
                      <span>{o.side} {o.qty} {o.symbol}</span>
                      <span className="text-gray-500">{o.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </OverviewCard>
            <OverviewCard title="Positions">
              {positions.length === 0 ? <p className="text-sm text-gray-500">No positions</p> : (
                <ul className="text-sm space-y-1">
                  {positions.map((p) => (
                    <li key={p.id} className="flex justify-between">
                      <span>{p.side} {p.qty} {p.symbol}</span>
                      <span className="text-gray-500">PnL {p.pnl}</span>
                    </li>
                  ))}
                </ul>
              )}
            </OverviewCard>
            <OverviewCard title="Runs">
              {runs.length === 0 ? <p className="text-sm text-gray-500">No runs</p> : (
                <ul className="text-sm space-y-1">
                  {runs.map((r) => (
                    <li key={r.id} className="flex justify-between">
                      <span className="capitalize">{r.status}</span>
                      <span className="text-gray-500">{formatDate(r.startedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </OverviewCard>
            <OverviewCard title="Signals (latest 50)">
              <p className="text-sm text-gray-500">Use the Signals tab in the API to inspect payloads.</p>
            </OverviewCard>
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="mt-4 space-y-2">
            <div className="text-sm text-gray-500">Tailing last {logs.length} lines (auto-refreshing)</div>
            <div className="border rounded h-96 overflow-y-auto bg-black text-green-100 font-mono text-xs p-3">
              {logs.length === 0 ? (
                <div className="text-gray-400">No logs yet.</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={`${log.ts}-${idx}`}>
                    <span className="text-gray-400">{new Date(log.ts).toLocaleTimeString()} </span>
                    <span className="uppercase text-blue-300">{log.level}</span>
                    <span className="text-gray-100"> — {log.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Window:</span>
              {metricWindows.map((option) => (
                <button
                  key={option}
                  onClick={() => setMetricsWindow(option)}
                  className={`px-2 py-1 rounded ${metricsWindow === option ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Sparkline label="CPU Usage" data={metrics.cpu} suffix="%" color="#0f766e" />
              <Sparkline label="Memory" data={metrics.memMiB} suffix=" MiB" color="#2563eb" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function statusClass(status: string) {
  if (status === 'running') return 'bg-green-100 text-green-800';
  if (status === 'error') return 'bg-red-100 text-red-800';
  if (status === 'paused') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-800';
}

function formatDate(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

function OverviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}

function SecuritySummary({ security }: { security: InstanceSecurity | null }) {
  if (!security) {
    return <p className="text-sm text-gray-500">No security telemetry yet.</p>;
  }
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-gray-500">Rate Limit</dt>
        <dd className={security.rateLimit.lastTriggeredAt ? 'text-yellow-600' : 'text-emerald-600'}>
          {security.rateLimit.lastTriggeredAt
            ? `Triggered ${new Date(security.rateLimit.lastTriggeredAt).toLocaleString()}`
            : 'Healthy'}
        </dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-gray-500">Signature</dt>
        <dd className="text-gray-800 dark:text-gray-200">
          {security.signature.lastCheckAt
            ? `Last OK ${new Date(security.signature.lastCheckAt).toLocaleString()}`
            : 'No HMAC yet'}
        </dd>
      </div>
      {security.signature.lastFailureAt && (
        <div className="flex justify-between">
          <dt className="text-gray-500">Last Failure</dt>
          <dd className="text-red-600">{new Date(security.signature.lastFailureAt).toLocaleString()}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-gray-500">Guardrails</dt>
        <dd className={security.guardrail.lastTriggeredAt ? 'text-red-600' : 'text-emerald-600'}>
          {security.guardrail.lastTriggeredAt
            ? `Triggered ${new Date(security.guardrail.lastTriggeredAt).toLocaleString()}`
            : 'No violations'}
        </dd>
      </div>
    </dl>
  );
}

function Sparkline({ data, label, suffix, color }: { data: MetricPoint[]; label: string; suffix: string; color: string }) {
  if (!data.length) {
    return (
      <div className="border rounded p-4">
        <h3 className="font-semibold mb-2">{label}</h3>
        <div className="text-sm text-gray-500">No samples yet.</div>
      </div>
    );
  }
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const latest = data[data.length - 1]?.value ?? 0;
  const points = data
    .map((point, idx) => {
      const x = data.length === 1 ? 0 : (idx / (data.length - 1)) * 100;
      const range = max - min;
      const normalized = range === 0 ? 50 : 100 - ((point.value - min) / range) * 100;
      return `${x},${normalized}`;
    })
    .join(' ');
  return (
    <div className="border rounded p-4">
      <h3 className="font-semibold mb-2">{label}</h3>
      <div className="text-3xl font-bold">{latest}{suffix}</div>
      <svg viewBox="0 0 100 100" className="w-full h-24 mt-2">
        <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={points} />
      </svg>
      <div className="text-xs text-gray-500">Last sample {formatDate(data[data.length - 1]?.ts)}</div>
    </div>
  );
}
