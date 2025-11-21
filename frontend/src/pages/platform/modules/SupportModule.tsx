export default function SupportModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Support</p>
        <h2 className="text-3xl font-semibold text-main">Ops concierge</h2>
        <p className="text-sm muted-text">Escalate incidents, request audits, and review SLAs directly inside the control plane.</p>
      </header>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Channels</p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>• Slack connect: #daxlinks-ops</li>
          <li>• PagerDuty: DaxLinks Control Plane</li>
          <li>• Email: ops@daxlinks.online</li>
        </ul>
      </article>

      <article className="card-shell space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">SLA</p>
        <p className="text-3xl font-light text-main">15 min</p>
        <p className="text-xs text-gray-400">Critical incidents response target</p>
      </article>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Support packages</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-gray-300">Standard</span>
          <span className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-emerald-300">Premium</span>
          <span className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-gray-300">Enterprise</span>
        </div>
      </article>
    </div>
  );
}
