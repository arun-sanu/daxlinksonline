import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAvailableExchanges, listIntegrations } from '../../../api/integrations';

type Integration = Awaited<ReturnType<typeof listIntegrations>>[number];
type ExchangeMeta = Awaited<ReturnType<typeof listAvailableExchanges>>[number];
const READY_EXCHANGES = new Set(['binance', 'mexc', 'zerodha']);
const EXCHANGE_ICON_MAP: Record<string, string> = {
  binance: '/icons/exchanges/binance.svg',
  mexc: '/icons/exchanges/mexc.svg',
  zerodha: '/icons/exchanges/zerodha.svg'
};
const FALLBACK_EXCHANGES: ExchangeMeta[] = [
  { id: 'binance', name: 'Binance', tagline: 'Spot · Futures · Options', regions: ['Global'], iconUrl: EXCHANGE_ICON_MAP.binance },
  { id: 'mexc', name: 'MEXC', tagline: 'Spot · Futures', regions: ['Global'], iconUrl: EXCHANGE_ICON_MAP.mexc },
  { id: 'zerodha', name: 'Zerodha', tagline: 'Kite Equities · F&O', regions: ['India'], iconUrl: EXCHANGE_ICON_MAP.zerodha }
];

export default function IntegrationsModule() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeMeta[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [loadingExchanges, setLoadingExchanges] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await listIntegrations();
        if (mounted) setIntegrations(data || []);
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Unable to load integrations');
      } finally {
        if (mounted) setLoadingIntegrations(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await listAvailableExchanges();
        if (!mounted) return;
        if (data && data.length > 0) {
          setExchanges(data);
        } else {
          setExchanges(FALLBACK_EXCHANGES);
        }
      } catch {
        if (mounted) setExchanges(FALLBACK_EXCHANGES);
      } finally {
        if (mounted) setLoadingExchanges(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(() => {
    const total = integrations.length;
    const connected = integrations.filter((i) => (i.status || '').toLowerCase() === 'connected').length;
    const degraded = integrations.filter((i) => (i.status || '').toLowerCase() === 'error').length;
    return { total, connected, degraded };
  }, [integrations]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Integrations</p>
        <h2 className="text-3xl font-semibold text-main">Exchange connectivity</h2>
        <p className="text-sm muted-text">
          Live adapters pulled from your workspace. Connect a venue to store encrypted API credentials and monitor status.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Linked exchanges" value={stats.total} highlight />
        <StatCard label="Healthy" value={stats.connected} />
        <StatCard label="Attention" value={stats.degraded} tone="amber" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Link speed" value="1.2 Gbps" trend="+4% QoQ" />
        <VpnCard />
        <MetricCard label="Bandwidth" value="420 GB / mo" trend="Capped at 1 TB" />
        <MetricCard label="Uptime" value="99.95%" trend="Past 30d" />
      </div>

      <section className="rounded-2xl border border-white/10 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Connected adapters</p>
            <p className="text-sm text-gray-400">Credentials and health pulled from the control plane.</p>
          </div>
        </div>

        {error && <p className="text-sm text-amber-300">{error}</p>}
        {loadingIntegrations && <p className="text-sm text-gray-400">Loading integrations…</p>}
        {!loadingIntegrations && integrations.length === 0 && !error && (
          <p className="text-sm text-gray-300">
            No exchanges linked yet. Start by connecting Binance, OKX, Bybit, or any available venue below.
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((i) => (
            <Link
              key={i.id}
              to={`/platform/integrations/${i.exchange}/bots`}
              className="rounded-2xl border border-white/10 p-4 transition hover:border-primary-300/50"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-main">{i.label || i.exchange}</p>
                  <p className="text-xs text-gray-400 capitalize">{i.environment || 'live'}</p>
                </div>
                <StatusIndicator status={i.status || 'unknown'} />
              </div>
              {i.apiKeyMasked && <p className="mt-2 text-sm text-gray-300">Key: {i.apiKeyMasked}</p>}
              <p className="mt-2 text-xs text-gray-400">
                {i.lastTestedAt ? `Last tested ${formatDate(i.lastTestedAt)}` : 'Not tested yet'}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="section-label">Exchange catalog</p>
            <h3 className="text-lg font-semibold text-main">Prebuilt venues</h3>
          </div>
          {!loadingExchanges && <span className="text-xs uppercase tracking-[0.28em] text-gray-400">{exchanges.length} venues</span>}
        </div>

        {loadingExchanges && <p className="text-sm text-gray-400">Loading venues…</p>}
        {!loadingExchanges && exchanges.length === 0 && <p className="text-sm text-gray-300">No venues to display.</p>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {exchanges.map((ex) => {
            const isReady = READY_EXCHANGES.has(ex.id || '');
            return (
              <Link
                key={ex.id}
                to={isReady ? `/platform/integrations/${ex.id}/bots` : `/platform/integrations/${ex.id}`}
                className="rounded-xl border border-white/10 p-3 transition hover:border-primary-300/50 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ExchangeIcon id={ex.id || ''} name={ex.name} iconUrl={ex.iconUrl || ex.icon} />
                    <div className="font-semibold text-main text-base">{ex.name}</div>
                  </div>
                  <StatusIndicator status={isReady ? 'available' : 'processing'} />
                </div>
                {ex.regions && ex.regions.length > 0 && <p className="mt-1 text-[11px] text-gray-400">{ex.regions.join(' · ')}</p>}
                {ex.tagline && <p className="mt-2 text-[13px] text-gray-200">{ex.tagline}</p>}
                {!ex.tagline && !isReady && <p className="mt-2 text-[13px] text-gray-200">Prebuilt adapter arriving soon.</p>}
                {ex.latency && <p className="mt-2 text-[11px] text-gray-400">Latency: {ex.latency}</p>}
                <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-primary-200">
                  {isReady ? 'Open bots →' : 'Preview details →'}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color =
    normalized === 'connected' || normalized === 'ready' || normalized === 'available'
      ? 'bg-emerald-400'
      : normalized === 'processing' || normalized === 'pending' || normalized === 'testing'
        ? 'bg-amber-300'
        : normalized === 'alert' || normalized === 'error' || normalized === 'degraded'
          ? 'bg-orange-400'
          : normalized === 'offline' || normalized === 'failed' || normalized === 'not working'
            ? 'bg-red-500'
            : 'bg-gray-400';
  const label =
    normalized === 'connected' || normalized === 'ready' || normalized === 'available'
      ? 'Available'
      : normalized === 'processing' || normalized === 'pending' || normalized === 'testing'
        ? 'Processing'
        : normalized === 'alert' || normalized === 'error' || normalized === 'degraded'
          ? 'Alert'
          : normalized === 'offline' || normalized === 'failed' || normalized === 'not working'
            ? 'Not working'
            : status;
  return (
    <div className="flex items-center gap-2 text-xs text-gray-200" aria-label={label}>
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <span className={`absolute h-3 w-3 rounded-full ${color} animate-blink-onoff`}></span>
        <span className={`relative h-2.5 w-2.5 rounded-full ${color}`}></span>
      </span>
    </div>
  );
}

function ExchangeIcon({ id, name, iconUrl }: { id: string; name: string; iconUrl?: string | null }) {
  const source = iconUrl || EXCHANGE_ICON_MAP[id];
  if (source) {
    return <img src={source} alt="" className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 p-1" loading="lazy" />;
  }
  const letter = name?.[0]?.toUpperCase() || '?';
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-main">
      {letter}
    </div>
  );
}

function StatCard({ label, value, highlight, tone }: { label: string; value: number; highlight?: boolean; tone?: 'amber' }) {
  const border = highlight ? 'border-primary-300/50' : tone === 'amber' ? 'border-amber-400/50' : 'border-white/10';
  return (
    <div className={`rounded-2xl border ${border} bg-white/5 p-4 flex flex-col`}>
      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-gray-500">
        {label}
        <LiveTag />
      </p>
      <div className="mt-auto text-right">
        <p className="text-2xl font-semibold text-main">{value}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-gray-500">
        {label}
        <LiveTag />
      </p>
      <div className="mt-auto flex flex-col items-end text-right">
        <p className="text-xl font-semibold text-main">{value}</p>
        {trend && <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mt-1">{trend}</p>}
      </div>
    </div>
  );
}

function VpnCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-gray-500">
        VPN
        <LiveTag />
      </p>
      <div className="mt-auto flex flex-col items-end text-right gap-1">
        <BlinkDot color="bg-red-500" stateColor="bg-gray-400" label="WireGuard" />
        <BlinkDot color="bg-orange-400" stateColor="bg-gray-400" label="Cloudflare" />
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mt-1">Status: Inactive</p>
      </div>
    </div>
  );
}

function BlinkDot({ color, stateColor = 'bg-emerald-400', label }: { color: string; stateColor?: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <span className={`absolute h-3 w-3 rounded-full ${color} animate-blink-onoff`}></span>
        <span className={`relative h-2.5 w-2.5 rounded-full ${color}`}></span>
      </span>
      <span className="relative inline-flex h-4 w-4 items-center justify-center animate-pulse">
        <span className={`absolute h-3 w-3 rounded-full ${stateColor}`}></span>
        <span className={`relative h-2.5 w-2.5 rounded-full ${stateColor}`}></span>
      </span>
      <span className="text-sm text-main">{label}</span>
    </div>
  );
}

function LiveTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-red-500/12 px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.16em] text-red-200">
      <span className="h-1.5 w-1.5 rounded-sm bg-red-400 animate-blink-onoff"></span>
      Live
    </span>
  );
}

function formatDate(input: string | number | Date) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
