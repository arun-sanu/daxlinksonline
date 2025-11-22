import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type StepId = 'identity' | 'workspace' | 'security' | 'guardrails' | 'review';

const steps: { id: StepId; title: string; description: string }[] = [
  { id: 'identity', title: 'Identity', description: 'Tell us who is joining and how to reach you.' },
  { id: 'workspace', title: 'Workspace', description: 'Name your workspace and pick a region.' },
  { id: 'security', title: 'Security', description: 'Lock in MFA and a master passphrase.' },
  { id: 'guardrails', title: 'Guardrails', description: 'Define alert + credential guardrails.' },
  { id: 'review', title: 'Review', description: 'Confirm settings before activation.' }
];

export default function AccountRegistrationPage() {
  const [active, setActive] = useState<StepId>('identity');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    workspace: '',
    region: 'ap-sg',
    mfa: 'totp',
    backupEmail: '',
    passphrase: '',
    guardrailLevel: 'standard',
    alertChannel: 'email'
  });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const activeIndex = useMemo(() => steps.findIndex((s) => s.id === active), [active]);
  const progress = ((activeIndex + 1) / steps.length) * 100;

  const canProceed = useMemo(() => {
    if (active === 'identity') return form.fullName.trim() && form.email.trim() && form.password.trim();
    if (active === 'workspace') return form.workspace.trim();
    if (active === 'security') return form.passphrase.trim();
    if (active === 'guardrails') return !!form.guardrailLevel;
    return true;
  }, [active, form]);

  function next() {
    setError(null);
    if (!canProceed) {
      setError('Please complete the required fields.');
      return;
    }
    if (active === 'review') {
      setDone(true);
      return;
    }
    const nextStep = steps[activeIndex + 1];
    if (nextStep) setActive(nextStep.id);
  }

  function back() {
    setError(null);
    const prev = steps[activeIndex - 1];
    if (prev) setActive(prev.id);
  }

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="layout-container section-pad space-y-8">
      <header className="space-y-2">
        <p className="section-label">Registration</p>
        <h1 className="headline text-4xl">Ready to step in?</h1>
        <p className="muted-text max-w-3xl text-sm">
          Experimental onboarding canvas—five checkpoints that harden identity, workspace, security, guardrails, and final review.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_auto]">
        <aside className="space-y-5 rounded-2xl border border-white/10 p-4">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-gray-400">
            <span>Checkpoints</span>
            <span className="rounded-full border border-primary-200/40 px-3 py-1 text-primary-200">5-step</span>
          </div>
          <div className="space-y-3">
            {steps.map((step, idx) => {
              const isActive = step.id === active;
              const isDone = idx < activeIndex || done;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActive(step.id)}
                  className={`w-full rounded-2xl border border-white/10 p-3 text-left transition ${
                    isActive
                      ? 'border-primary-300 bg-primary-500/10 shadow-[0_0_32px_rgba(107,107,247,0.22)]'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold ${
                        isDone
                          ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                          : isActive
                            ? 'bg-primary-500/20 text-primary-200 border border-primary-200/40'
                            : 'text-gray-400'
                      }`}
                    >
                      {isDone ? '✓' : idx + 1}
                    </span>
                    <div>
                      <p className="text-sm text-main">{step.title}</p>
                      <p className="text-[11px] text-gray-500">{step.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-primary-500/15 to-emerald-500/10 p-4 text-xs text-gray-200">
            <p className="text-sm font-semibold text-main">Live signal</p>
            <p className="mt-1">Step {activeIndex + 1} / {steps.length} · {progress.toFixed(0)}% charged</p>
            <div className="mt-2 h-1.5 rounded-full bg-white/10">
              <div className="h-1.5 rounded-full" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #6B6BF7, #34D399)' }}></div>
            </div>
          </div>
        </aside>

        <div className="space-y-6 rounded-2xl border border-white/10 p-5">
          <section className="space-y-4">
            {active === 'identity' && (
              <>
                <h3 className="text-lg font-semibold text-main">Operator identity</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Full name" required>
                    <input
                      value={form.fullName}
                      onChange={(e) => update('fullName', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="Ada Lovelace"
                    />
                  </Field>
                  <Field label="Email" required>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="ops@daxlinks.online"
                    />
                  </Field>
                  <Field label="Password" required>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => update('password', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="••••••••"
                    />
                  </Field>
                  <Field label="Backup email (optional)">
                    <input
                      type="email"
                      value={form.backupEmail}
                      onChange={(e) => update('backupEmail', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="security@daxlinks.online"
                    />
                  </Field>
                </div>
              </>
            )}

            {active === 'workspace' && (
              <>
                <h3 className="text-lg font-semibold text-main">Workspace details</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Workspace name" required>
                    <input
                      value={form.workspace}
                      onChange={(e) => update('workspace', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="Ops · APAC"
                    />
                  </Field>
                  <Field label="Region">
                    <select
                      value={form.region}
                      onChange={(e) => update('region', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="ap-sg">ap-sg (Singapore)</option>
                      <option value="us-east">us-east (Virginia)</option>
                      <option value="eu-west">eu-west (Frankfurt)</option>
                    </select>
                  </Field>
                </div>
                <p className="text-xs text-gray-500">Region locks telemetry residency and guardrail routing.</p>
              </>
            )}

            {active === 'security' && (
              <>
                <h3 className="text-lg font-semibold text-main">Security & MFA</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="MFA method">
                    <select
                      value={form.mfa}
                      onChange={(e) => update('mfa', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="totp">TOTP (Authenticator)</option>
                      <option value="webauthn">Hardware key (WebAuthn)</option>
                      <option value="sms">SMS fallback</option>
                    </select>
                  </Field>
                  <Field label="Master passphrase" required>
                    <input
                      type="password"
                      value={form.passphrase}
                      onChange={(e) => update('passphrase', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="High-entropy phrase"
                    />
                  </Field>
                  <Field label="Backup email">
                    <input
                      type="email"
                      value={form.backupEmail}
                      onChange={(e) => update('backupEmail', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                      placeholder="security@daxlinks.online"
                    />
                  </Field>
                </div>
                <p className="text-xs text-gray-500">MFA and passphrase secure API keys, credentials, and alert rail settings.</p>
              </>
            )}

            {active === 'guardrails' && (
              <>
                <h3 className="text-lg font-semibold text-main">Guardrails</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Guardrail profile">
                    <select
                      value={form.guardrailLevel}
                      onChange={(e) => update('guardrailLevel', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="standard">Standard · SOC defaults</option>
                      <option value="strict">Strict · approval required</option>
                      <option value="custom">Custom · configure later</option>
                    </select>
                  </Field>
                  <Field label="Alert channel">
                    <select
                      value={form.alertChannel}
                      onChange={(e) => update('alertChannel', e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="email">Email</option>
                      <option value="telegram">Telegram</option>
                      <option value="slack">Slack</option>
                    </select>
                  </Field>
                </div>
                <p className="text-xs text-gray-500">
                  Guardrails apply to webhooks, trade bots, and credentials; they inherit to all operators.
                </p>
              </>
            )}

            {active === 'review' && (
              <>
                <h3 className="text-lg font-semibold text-main">Review & confirm</h3>
                <div className="grid gap-3 md:grid-cols-2 text-sm text-gray-200">
                  <Summary label="Full name" value={form.fullName || '—'} />
                  <Summary label="Email" value={form.email || '—'} />
                  <Summary label="Workspace" value={form.workspace || '—'} />
                  <Summary label="Region" value={form.region} />
                  <Summary label="MFA" value={form.mfa} />
                  <Summary label="Guardrails" value={form.guardrailLevel} />
                  <Summary label="Alert channel" value={form.alertChannel} />
                </div>
                {done && <p className="text-sm text-emerald-300">Registration submitted. We’ll email activation details shortly.</p>}
              </>
            )}
          </section>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="flex flex-wrap items-center gap-3">
            {activeIndex > 0 && (
              <button type="button" className="btn btn-secondary btn-small px-5" onClick={back}>
                Back
              </button>
            )}
            <button
              type="button"
              className="btn btn-white-animated btn-small px-6"
              onClick={next}
            >
              {active === 'review' ? 'Submit registration' : 'Next step'}
            </button>
            <Link to="/account" className="text-xs uppercase tracking-[0.24em] text-gray-400">Cancel</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-gray-300">
      <span className="text-xs uppercase tracking-[0.24em] text-gray-500">
        {label} {required ? '*' : ''}
      </span>
      {children}
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs uppercase tracking-[0.24em] text-gray-500">{label}</p>
      <p className="mt-1 text-main">{value}</p>
    </div>
  );
}
