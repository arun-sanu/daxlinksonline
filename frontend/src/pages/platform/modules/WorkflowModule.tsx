const stages = [
  'Webhook ingestion + schema validation',
  'Guardrail evaluation and enrichment',
  'Fan-out to bots, integrations, or compliance sinks',
  'Post-trade reconciliation + notifications'
];

export default function WorkflowModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Workflow</p>
        <h2 className="text-3xl font-semibold text-main">Orchestration builder</h2>
        <p className="text-sm muted-text">
          Visual tooling to connect alerts, guardrails, and downstream automations is rolling out. Early adopters can preview the
          pipeline below.
        </p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-primary-200">Preview</p>
        <ol className="space-y-3 text-sm text-gray-300">
          {stages.map((stage, index) => (
            <li key={stage} className="flex gap-3">
              <span className="text-primary-200">0{index + 1}.</span>
              <span>{stage}</span>
            </li>
          ))}
        </ol>
        <span className="inline-flex w-fit rounded-full border border-primary-200/40 px-3 py-1 text-xs uppercase tracking-[0.3em] text-primary-100">
          Coming soon
        </span>
      </article>

      <article className="card-shell space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Early access</p>
        <p className="text-sm text-gray-300">Request enablement to experiment with workflow graphs inside your sandbox workspace.</p>
        <button type="button" className="btn btn-secondary btn-small">Join waitlist</button>
      </article>
    </div>
  );
}
