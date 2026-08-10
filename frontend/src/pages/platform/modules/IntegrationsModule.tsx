const linkedAdapters = [
  { name: 'Zerodha Kite', status: 'Healthy', guardrail: 'Session refresh + LTP watchdog' },
  { name: 'Binance Futures', status: 'Degraded', guardrail: 'Order cap at 5/min' },
  { name: 'Bitget', status: 'Healthy', guardrail: 'Webhook checksum verified' }
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
        <article className="card-shell space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Linked adapters</p>
          <ul className="space-y-4 text-sm">
            {linkedAdapters.map((adapter) => (
              <li key={adapter.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-main">
                  <span className="font-semibold">{adapter.name}</span>
                  <span className="text-xs uppercase tracking-[0.3em] text-emerald-300">{adapter.status}</span>
                </div>
                <p className="mt-2 text-xs text-gray-400">{adapter.guardrail}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="card-shell space-y-4">
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

      <div className="card-shell grid gap-4 md:grid-cols-2">
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
    </div>
  );
}
