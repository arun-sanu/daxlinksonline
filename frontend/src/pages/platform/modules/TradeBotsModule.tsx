import { Link } from 'react-router-dom';

const bots = [
  { name: 'Atlas Macro', status: 'Live', version: 'v12', guardrail: 'PnL floor 3%' },
  { name: 'Momentum Hive', status: 'Live', version: 'v7', guardrail: 'Max 5 fills/min' },
  { name: 'Sandbox', status: 'Paused', version: 'v2', guardrail: 'Manual testing mode' }
];

export default function TradeBotsModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Trade Bots</p>
        <h2 className="text-3xl font-semibold text-main">Execution fleet</h2>
        <p className="text-sm muted-text">Deploy, pause, or inspect bots without leaving the module. Guardrails inherit workspace policies.</p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Strategies</p>
        <ul className="space-y-3 text-sm text-gray-300">
          {bots.map((bot) => (
            <li key={bot.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between text-main">
                <span className="font-semibold">{bot.name}</span>
                <span className={bot.status === 'Live' ? 'text-emerald-300 text-xs uppercase tracking-[0.3em]' : 'text-amber-300 text-xs uppercase tracking-[0.3em]'}>
                  {bot.status}
                </span>
              </div>
              <p className="text-xs text-gray-400">Version {bot.version}</p>
              <p className="text-xs text-gray-400">Guardrail · {bot.guardrail}</p>
            </li>
          ))}
        </ul>
      </article>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-shell space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Latency</p>
          <p className="text-3xl font-light text-main">48 ms avg</p>
          <p className="text-xs text-gray-400">Across all active connectors</p>
        </article>
        <article className="card-shell space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Throughput</p>
          <p className="text-3xl font-light text-main">2.4k fills / min</p>
          <p className="text-xs text-gray-400">Burst tested from alerts + API</p>
        </article>
      </div>

      <section className="card-shell space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="section-label">Runbook shortcuts</p>
            <p className="text-sm text-gray-300">Jump into the dedicated Trade Bots UIs without leaving Platform.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <ShortcutCard title="Bots table" description="Create, publish, and manage versions." to="/trade-bots" />
          <ShortcutCard title="Marketplace" description="Rent published bots & plans." to="/market" />
          <ShortcutCard title="Exchange accounts" description="Attach broker API keys with guardrails." to="/exchange-accounts" />
          <ShortcutCard title="Pine → Python" description="Convert Pine strategies into bot ZIPs." to="/pine-convert" />
          <ShortcutCard title="Rentals" description="Manage marketplace instances and billing." to="/market/rentals" />
        </div>
      </section>
    </div>
  );
}

function ShortcutCard({ title, description, to }: { title: string; description: string; to: string }) {
  return (
    <Link
      to={to}
      className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-300/50 hover:bg-primary-500/10"
    >
      <div className="text-sm font-semibold text-main">{title}</div>
      <p className="mt-1 text-xs text-gray-400">{description}</p>
      <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-primary-200">Open →</p>
    </Link>
  );
}
