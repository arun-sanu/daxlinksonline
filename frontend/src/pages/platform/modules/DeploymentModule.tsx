const pipelines = [
  { name: 'Control plane', status: 'Ready', window: 'Daily 04:00 UTC' },
  { name: 'Bots + adapters', status: 'Running', window: 'On demand' },
  { name: 'Worker queue', status: 'Paused', window: 'Waiting on approvals' }
];

export default function DeploymentModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Deployment</p>
        <h2 className="text-3xl font-semibold text-main">Pipelines + cutovers</h2>
        <p className="text-sm muted-text">Preview upcoming release windows, approvals, and instant rollbacks.</p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Pipelines</p>
        <ul className="space-y-3 text-sm text-gray-300">
          {pipelines.map((pipeline) => (
            <li key={pipeline.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between text-main">
                <span className="font-semibold">{pipeline.name}</span>
                <span className={pipeline.status === 'Running' ? 'text-emerald-300 text-xs uppercase tracking-[0.3em]' : pipeline.status === 'Paused' ? 'text-amber-300 text-xs uppercase tracking-[0.3em]' : 'text-gray-300 text-xs uppercase tracking-[0.3em]'}>
                  {pipeline.status}
                </span>
              </div>
              <p className="text-xs text-gray-400">Window · {pipeline.window}</p>
            </li>
          ))}
        </ul>
      </article>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Controls</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <button type="button" className="btn btn-secondary btn-small">Schedule deploy</button>
          <button type="button" className="btn btn-white-animated btn-small">Trigger rollback</button>
        </div>
      </article>
    </div>
  );
}
