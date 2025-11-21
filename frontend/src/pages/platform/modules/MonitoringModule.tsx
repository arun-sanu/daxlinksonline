const metrics = [
  { label: 'Queue depth', value: '34 jobs', detail: 'BullMQ forwarder · Healthy' },
  { label: 'Webhook throughput', value: '18.2k/min', detail: '99.1th percentile 640 ms' },
  { label: 'Guardrail events', value: '12 in 24h', detail: 'Auto-paused 1 bot' }
];

export default function MonitoringModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Monitoring</p>
        <h2 className="text-3xl font-semibold text-main">Telemetry + incident feed</h2>
        <p className="text-sm muted-text">
          Dashboards aggregate platform vitals so you can drill into queues, retries, and guardrail incidents without leaving the
          console.
        </p>
      </header>

      <article className="card-shell grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{metric.label}</p>
            <p className="mt-3 text-2xl font-semibold text-main">{metric.value}</p>
            <p className="text-xs text-gray-400">{metric.detail}</p>
          </div>
        ))}
      </article>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Upcoming</p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>• PagerDuty + Slack on-call hooks.</li>
          <li>• Replay heatmaps per integration.</li>
          <li>• Historical alert segmentation for compliance.</li>
        </ul>
        <span className="inline-flex rounded-full border border-primary-200/40 px-3 py-1 text-xs uppercase tracking-[0.3em] text-primary-200">
          Coming soon
        </span>
      </article>
    </div>
  );
}
