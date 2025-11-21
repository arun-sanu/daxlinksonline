const clusters = [
  { name: 'Signals', region: 'ap-sg', status: 'Hot', replicaLag: '38 ms' },
  { name: 'Guardrails', region: 'us-east', status: 'Hot', replicaLag: '42 ms' },
  { name: 'Replay buffer', region: 'eu-central', status: 'Warm', replicaLag: '51 ms' }
];

export default function DatabasesModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Databases</p>
        <h2 className="text-3xl font-semibold text-main">Managed telemetry stores</h2>
        <p className="text-sm muted-text">
          Control plane data lives in hardened document clusters with automated retention, replica promotion, and SOC reporting.
        </p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Active clusters</p>
        <div className="grid gap-4 md:grid-cols-2">
          {clusters.map((cluster) => (
            <div key={cluster.name} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
              <div className="flex items-center justify-between text-main">
                <span className="font-semibold">{cluster.name}</span>
                <span className="text-xs uppercase tracking-[0.3em] text-emerald-300">{cluster.status}</span>
              </div>
              <p className="mt-2 text-xs text-gray-400">Region · {cluster.region}</p>
              <p className="text-xs text-gray-400">Replica lag · {cluster.replicaLag}</p>
            </div>
          ))}
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Backups</p>
          <p className="text-3xl font-light text-main">8 snapshots / day</p>
          <p className="text-sm text-gray-400">Snapshots ship to cold storage + customer vaults via signed manifests.</p>
        </article>
        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Retention</p>
          <p className="text-3xl font-light text-main">35 days</p>
          <p className="text-sm text-gray-400">Signal payloads and guardrail events auto-expire per compliance policies.</p>
        </article>
      </div>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Observers</p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>• Replica health alerts pipe into Ops Slack with context-rich diffs.</li>
          <li>• Query budget enforcement throttles heavy scans before they impact order routing.</li>
          <li>• Compliance dashboards pull audit trails every hour.</li>
        </ul>
      </article>
    </div>
  );
}
