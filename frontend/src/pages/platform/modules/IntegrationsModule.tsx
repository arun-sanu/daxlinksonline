import { Link } from 'react-router-dom';

const linkedAdapters = [
  { name: 'Zerodha Kite', status: 'Healthy', guardrail: 'Session refresh + LTP watchdog' },
  { name: 'Binance Futures', status: 'Degraded', guardrail: 'Order cap at 5/min' },
  { name: 'Bitget', status: 'Healthy', guardrail: 'Webhook checksum verified' }
];

const availableExchanges = [
  { slug: 'binance', name: 'Binance', region: 'Global', lanes: 'Spot · Futures · Options', status: 'ready' },
  { slug: 'mexc', name: 'MEXC', region: 'Global', lanes: 'Spot · Futures', status: 'ready' },
  { slug: 'okx', name: 'OKX', region: 'Global', lanes: 'Unified account', status: 'ready' },
  { slug: 'bybit', name: 'Bybit', region: 'Global', lanes: 'USDT Perps · Linear', status: 'ready' },
  { slug: 'zerodha', name: 'Zerodha', region: 'India', lanes: 'Kite equities · F&O', status: 'ready' },
  { slug: 'bitget', name: 'Bitget', region: 'Global', lanes: 'Spot · Futures', status: 'ready' },
  { slug: 'kucoin', name: 'KuCoin', region: 'Global', lanes: 'Spot · Futures', status: 'ready' },
  { slug: 'phemex', name: 'Phemex', region: 'Global', lanes: 'Perps · Spot', status: 'beta' },
  { slug: 'coinbase', name: 'Coinbase', region: 'US', lanes: 'Spot', status: 'beta' },
  { slug: 'kraken', name: 'Kraken', region: 'US/EU', lanes: 'Spot', status: 'roadmap' }
];

const rotationEvents = [
  { label: 'Last rotation', value: '08 Jan 2025 · 06:12 UTC' },
  { label: 'Pending approvals', value: '2 (compliance + desk lead)' },
  { label: 'Failures in 30d', value: '0' }
];

export default function IntegrationsModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Integrations</p>
        <h2 className="text-3xl font-semibold text-main">Exchange connectivity</h2>
        <p className="text-sm muted-text">
          Unified adapters keep guardrails, rate limits, and credentials aligned with the control plane. Rotate tokens or pause
          execution from here.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-white/10 p-4 space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Linked adapters</p>
          <ul className="space-y-3 text-sm">
            {linkedAdapters.map((adapter) => (
              <li key={adapter.name} className="rounded-2xl border border-white/10 p-3">
                <div className="flex items-center justify-between text-main">
                  <span className="font-semibold">{adapter.name}</span>
                  <span className="text-xs uppercase tracking-[0.3em] text-emerald-300">{adapter.status}</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">{adapter.guardrail}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-white/10 p-4 space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Credential rotation</p>
          <dl className="space-y-3 text-sm text-gray-300">
            {rotationEvents.map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <dt className="text-gray-400">{item.label}</dt>
                <dd className="text-main">{item.value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="btn btn-secondary btn-small">Rotate tokens</button>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2 rounded-2xl border border-white/10 p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Guardrail policies</p>
          <ul className="mt-3 space-y-2 text-sm text-gray-300">
            <li>• Session watchdog auto-refreshes Kite + Binance every 45 minutes.</li>
            <li>• IP allowlists pushed to all brokers daily.</li>
            <li>• Secrets encrypted with workspace KMS keys.</li>
          </ul>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Quick actions</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <button type="button" className="btn btn-white-animated btn-small px-4">Add exchange</button>
            <button type="button" className="btn btn-secondary btn-small px-4">Pause fills</button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="section-label">Available exchanges</p>
            <h3 className="text-lg font-semibold text-main">Prebuilt adapters ready to attach</h3>
          </div>
          <span className="text-xs uppercase tracking-[0.28em] text-gray-400">{availableExchanges.length} venues</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {availableExchanges.map((ex) => (
            <Link
              key={ex.name}
              to={`/platform/integrations/${ex.slug}`}
              className="rounded-2xl border border-white/10 p-4 transition hover:border-primary-300/50"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-main">{ex.name}</div>
                <StatusPill status={ex.status} />
              </div>
              <p className="mt-1 text-xs text-gray-400">{ex.region}</p>
              <p className="mt-2 text-sm text-gray-200">{ex.lanes}</p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-primary-200">Manage keys →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label =
    status === 'ready' ? 'Available' : status === 'beta' ? 'Beta' : status === 'roadmap' ? 'Planned' : status;
  const tone =
    status === 'ready'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'beta'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-gray-200 text-gray-800';
  return <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${tone}`}>{label}</span>;
}
