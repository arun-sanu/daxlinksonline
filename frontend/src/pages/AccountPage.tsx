const profile = {
  name: 'Mira Venkman',
  email: 'ops@daxlinks.online',
  role: 'Super Admin',
  location: 'Singapore · SG1',
  workspaceId: 'WRK-39A7',
  phone: '+65 8123 9987',
  lastLogin: '08 Jan 2025 · 08:21 UTC',
  lastDevice: 'Mac Studio · Edge Network',
  status: 'Active session'
};

const subscription = {
  plan: 'Professional',
  status: 'Active',
  renewal: '14 Feb 2025',
  exchanges: 11,
  endpoints: '32',
  seats: '8 / 12 operators',
  throughput: '250k alerts / min'
};

const securityChecks = [
  { label: 'Multi-factor auth', detail: 'Enforced for every operator login', status: 'green' },
  { label: 'Hardware keys', detail: 'FIDO2 + biometric fallback registered', status: 'green' },
  { label: 'Recovery codes', detail: '8 recovery tokens issued · stored in vault', status: 'amber' },
  { label: 'Session hygiene', detail: 'Idle timeout 10 min · re-auth every 12h', status: 'green' }
];

const accessControls = [
  { label: 'Workspace scope', value: 'Global operations · SG + NY desks' },
  { label: 'Guardrails', value: 'Webhooks, signals, and credentials inherit default policies' },
  { label: 'Privileges', value: 'Admin · Deploy · Credential rotation' },
  { label: 'Delegations', value: '2 pending invites (quant + compliance)' }
];

const activity = [
  { label: 'Last login', value: profile.lastLogin },
  { label: 'Session location', value: profile.location },
  { label: 'Device posture', value: profile.lastDevice },
  { label: 'Session status', value: profile.status }
];

export default function AccountPage() {
  return (
    <div className="layout-container section-pad space-y-10">
      <header className="space-y-3">
        <p className="section-label">Account</p>
        <h1 className="headline text-4xl">Workspace access</h1>
        <p className="muted-text max-w-3xl text-sm">
          Review operator identity, subscription posture, and control-plane privileges. This view mirrors the legacy console so
          migrations stay familiar while we finish the remaining modules inside the React portal.
        </p>
      </header>

      <div className="grid gap-10 xl:grid-cols-[1.35fr_0.9fr]">
        <section className="space-y-6">
          <div className="card-shell space-y-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="section-label">Primary operator</p>
                <h2 className="text-3xl font-semibold text-main">{profile.name}</h2>
                <p className="text-sm text-gray-400">{profile.email}</p>
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Workspace · {profile.workspaceId}</p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-white/90">{profile.role}</span>
                <span className="rounded-full border border-white/10 px-3 py-1 tracking-[0.28em] text-primary-200">Privileged</span>
                <span className="rounded-full border border-white/10 px-3 py-1 tracking-[0.28em] text-gray-300">2FA</span>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Contact</p>
                <p className="mt-2 text-sm text-main">{profile.phone}</p>
                <p className="text-sm text-gray-400">{profile.location}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Workspace policies</p>
                <p className="mt-2 text-sm text-main">SOC2 · ISO 27001 inherit</p>
                <p className="text-sm text-gray-400">All alerts audited · Credential rotation every 24h</p>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Activity</p>
                <ul className="mt-4 space-y-3 text-sm text-gray-400">
                  {activity.map((item) => (
                    <li key={item.label} className="flex items-center justify-between gap-4">
                      <span>{item.label}</span>
                      <span className="text-main">{item.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Session controls</p>
                <p className="mt-3 text-sm text-gray-400">Last re-auth · 2h ago</p>
                <p className="text-sm text-gray-400">Idle timeout · 10 min</p>
                <div className="mt-6 flex flex-wrap gap-3 text-xs">
                  <button type="button" className="btn btn-secondary btn-small px-4">Rotate API key</button>
                  <button type="button" className="btn btn-small btn-white-animated px-4">Sign out others</button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card-shell space-y-4">
              <p className="section-label">Security posture</p>
              <ul className="space-y-4 text-sm text-gray-300">
                {securityChecks.map((check) => (
                  <li key={check.label} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-main">{check.label}</p>
                      <p className="text-xs text-gray-500">{check.detail}</p>
                    </div>
                    <span
                      className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                        check.status === 'green'
                          ? 'border-emerald-400/60 text-emerald-300'
                          : 'border-amber-300/60 text-amber-200'
                      }`}
                    >
                      {check.status === 'green' ? '✓' : '!'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card-shell space-y-4">
              <p className="section-label">Access</p>
              <ul className="space-y-3 text-sm text-gray-300">
                {accessControls.map((item) => (
                  <li key={item.label} className="rounded-2xl border border-white/5 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{item.label}</p>
                    <p className="mt-2 text-main">{item.value}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card-shell flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="section-label">Admin portal</p>
              <h3 className="text-xl font-semibold text-main">Open administrative console</h3>
              <p className="mt-2 text-sm text-gray-400">
                Manage users, queue drain, incidents, and pending guardrail requests from the classic admin shell.
              </p>
            </div>
            <button type="button" className="btn btn-secondary">Launch admin</button>
          </div>
        </section>

        <aside className="glass-subscription mx-auto h-full w-full max-w-lg space-y-6 rounded-2xl p-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Admin console</p>
            <p className="mt-2 text-sm text-gray-300">
              Privileged access for live queue toggles, credential rotation, and SOC reporting remains available.
            </p>
            <button type="button" className="mt-4 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs tracking-[0.2em] text-white/90">
              Open console
            </button>
          </div>

          <header className="flex items-center justify-between">
            <div>
              <p className="section-label">Subscription</p>
              <h2 className="text-3xl font-semibold text-main">{subscription.plan}</h2>
            </div>
            <span className="text-xs uppercase tracking-[0.28em] text-gray-400">{subscription.status}</span>
          </header>

          <dl className="space-y-3 text-sm text-gray-300">
            <div className="flex items-center justify-between">
              <dt className="text-gray-400">Next renewal</dt>
              <dd className="text-main">{subscription.renewal}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-400">Exchanges linked</dt>
              <dd className="text-main">{subscription.exchanges}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-400">API endpoints</dt>
              <dd className="text-main">{subscription.endpoints}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-400">Seats</dt>
              <dd className="text-main">{subscription.seats}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-400">Signal throughput</dt>
              <dd className="text-main">{subscription.throughput}</dd>
            </div>
          </dl>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.28em] text-gray-400">Billing actions</p>
            <p className="mt-2 text-sm text-gray-300">Upgrade seats, download invoices, or update payment sources without leaving the console.</p>
            <button type="button" className="mt-4 btn btn-white-animated btn-small">Manage billing</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

