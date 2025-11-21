const resources = [
  { label: 'Onboarding playbook', href: 'https://daxlinks.online/docs' },
  { label: 'Webhook recipe pack', href: 'https://daxlinks.online/docs/webhooks' },
  { label: 'Compliance attestations', href: 'https://daxlinks.online/security' },
  { label: 'API reference', href: 'https://daxlinks.online/api' }
];

export default function ResourcesModule() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="section-label">Resources</p>
        <h2 className="text-3xl font-semibold text-main">Knowledge center</h2>
        <p className="text-sm muted-text">Docs, templates, and policy references curated for operators and quants.</p>
      </header>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Featured</p>
        <div className="grid gap-4 md:grid-cols-2">
          {resources.map((resource) => (
            <a
              key={resource.label}
              href={resource.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-400/40 hover:text-white"
            >
              <p className="text-sm font-semibold text-main">{resource.label}</p>
              <p className="text-xs text-gray-400">Open in new tab →</p>
            </a>
          ))}
        </div>
      </article>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Need more?</p>
        <p className="text-sm text-gray-300">Reach out for solution reviews, architecture sessions, or internal training decks.</p>
        <button type="button" className="btn btn-secondary btn-small">Book a session</button>
      </article>
    </div>
  );
}
