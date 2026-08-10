const zones = [
  { name: 'daxlinks.online', status: 'Authoritative', records: 34 },
  { name: 'hooks.daxlinks.online', status: 'Edge proxied', records: 12 },
  { name: 'api.daxlinks.online', status: 'Failover ready', records: 9 }
];

export default function DNSModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">DNS</p>
        <h2 className="text-3xl font-semibold text-main">Edge routing + failover</h2>
        <p className="text-sm muted-text">
          Manage callback domains, whitelabel links, and active-active failover from a single pane.
        </p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Zones</p>
        <ul className="space-y-3 text-sm text-gray-300">
          {zones.map((zone) => (
            <li key={zone.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between text-main">
                <span className="font-semibold">{zone.name}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-emerald-300">{zone.status}</span>
              </div>
              <p className="text-xs text-gray-400">Records managed · {zone.records}</p>
            </li>
          ))}
        </ul>
      </article>

      <article className="card-shell space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Automation</p>
        <p className="text-sm text-gray-300">Failover policies trigger when webhook availability drops below thresholds. SSL certs auto-renew every 60 days.</p>
      </article>
    </div>
  );
}
