import { Link } from 'react-router-dom';

const metrics = {
  exchanges: 11,
  endpoints: '32+',
  throughput: '250k/min'
};

const webcastChannels = [
  { id: 'okx', exchange: 'OKX', channel: 'orderbook.delta', updates: 128 },
  { id: 'bybit', exchange: 'Bybit', channel: 'order.fills', updates: 96 },
  { id: 'zerodha', exchange: 'Zerodha', channel: 'kite.positions', updates: 44 }
];

const resources = [
  {
    icon: '📚',
    title: 'Implementation Guides',
    description: 'Tailored runbooks for wiring TradingView alerts, Kite Connect credentials, and Pendax adapters.',
    href: 'https://daxlinks.online/docs',
    linkLabel: 'Browse docs'
  },
  {
    icon: '🧭',
    title: 'Solution Reviews',
    description: 'Concierge sessions to pressure-test your execution strategy and resilience patterns.',
    href: 'https://daxlinks.online/support',
    linkLabel: 'Book a review'
  },
  {
    icon: '🪝',
    title: 'Webhook Playbooks',
    description: 'JSON templates, guardrail policies, and post-trade automations for the alert forwarder.',
    href: 'https://daxlinks.online/docs/webhooks',
    linkLabel: 'Use templates'
  },
  {
    icon: '🛡️',
    title: 'Credential Hardening',
    description: 'Rotation, masking, and audit blueprints that mirror the legacy console defaults.',
    href: 'https://daxlinks.online/security',
    linkLabel: 'Review controls'
  }
];

const roadmap = [
  {
    quarter: 'Q2',
    items: ['Workspace RBAC + approvals', 'Webhook transformations', 'Expanded broker marketplace']
  },
  {
    quarter: 'Q3',
    items: ['Compliance attestations', 'Adaptive guardrails', 'Private infra deploy option']
  }
];

export default function HomePage() {
  return (
    <div className="space-y-16 pb-24">
      <section id="hero" className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 12% 14%, rgba(107,107,247,0.32), transparent 60%)' }}></div>
        <div className="layout-container hero-grid relative">
          <div className="fade-up" style={{ animationDelay: '80ms' }}>
            <span className="hero-callout">Automation Stack</span>
            <h1 className="headline mt-5">
              Build <span className="headline-accent">Trade Infrastructure</span> that never sleeps
            </h1>
            <p className="mt-5 max-w-xl text-base muted-text">
              Ship AI-driven execution, webhook orchestration, and compliance ready workflows from a single console. Guardrails,
              credentials, and telemetry are wired in from the start.
            </p>
            <div className="hero-cta-stack mt-10">
              <a href="https://daxlinks.online/docs" target="_blank" rel="noreferrer" className="btn btn-primary btn-white-animated">
                Get Started
              </a>
              <Link to="/trade-bots" className="btn btn-secondary">
                Launch Trade Bots
              </Link>
            </div>
            <dl className="hero-stats">
              <div className="stat-tile">
                <dt>Supported Exchanges</dt>
                <dd>{metrics.exchanges}+</dd>
              </div>
              <div className="stat-tile">
                <dt>Unified Endpoints</dt>
                <dd>{metrics.endpoints}</dd>
              </div>
              <div className="stat-tile">
                <dt>Signal Throughput</dt>
                <dd>{metrics.throughput}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="layout-container section-pad grid gap-10 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        <div className="card-shell">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-main">Resource Hub</h2>
            <a href="https://daxlinks.online/docs" className="text-sm font-semibold" style={{ color: 'var(--primary)' }} target="_blank" rel="noreferrer">
              Browse Docs →
            </a>
          </div>
          <p className="mt-3 text-sm muted-text">
            A curated set of guides, templates, and support channels to accelerate development for your team.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {resources.map((resource) => (
              <article key={resource.title} className="card-shell flex flex-col">
                <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'rgba(107,107,247,0.22)', color: 'var(--primary)' }}>
                  <span className="text-xl" aria-hidden="true">{resource.icon}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-main">
                  {resource.title}
                </h3>
                <p className="mt-2 flex-1 text-sm muted-text">{resource.description}</p>
                <a href={resource.href} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center text-sm font-semibold" style={{ color: 'var(--primary)' }}>
                  {resource.linkLabel}
                  <svg xmlns="http://www.w3.org/2000/svg" className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </article>
            ))}
          </div>
        </div>
        <div className="card-shell">
          <h3 className="text-lg font-semibold text-main">Roadmap Highlights</h3>
          <p className="mt-3 text-sm muted-text">
            Upcoming milestones informed by community feedback. Vote on priorities in our Discord or email the team.
          </p>
          <div className="mt-6 space-y-5">
            {roadmap.map((item) => (
              <div key={item.quarter} className="card-shell">
                <p className="text-xs uppercase tracking-[0.3em]" style={{ color: 'var(--primary)' }}>
                  {item.quarter}
                </p>
                <ul className="mt-3 space-y-2 text-sm muted-text">
                  {item.items.map((plan) => (
                    <li key={plan} className="flex gap-3">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--primary)' }}></span>
                      <span>{plan}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="layout-container">
        <div className="card-shell">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="section-label">Portal quick actions</p>
              <h3 className="mt-2 text-2xl font-semibold text-main">Jump into the control center</h3>
            </div>
            <Link to="/trade-bots" className="btn btn-secondary btn-small">
              Trade Bots
            </Link>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Link to="/account" className="card-shell">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Account & Access</p>
              <h4 className="mt-3 text-lg font-semibold text-main">Workspace policies + invitations</h4>
              <p className="mt-2 text-sm muted-text">Provision users, rotate credentials, and enforce guardrails inherited from the classic UI.</p>
            </Link>
            <Link to="/platform" className="card-shell">
              <p className="text-xs uppercase tracking-[0.3em] text-gray-400">Platform status</p>
              <h4 className="mt-3 text-lg font-semibold text-main">Pipelines, queues, and guardrails</h4>
              <p className="mt-2 text-sm muted-text">Inspect webhook throughput, alert failures, and cluster metrics before triggering deploys.</p>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
