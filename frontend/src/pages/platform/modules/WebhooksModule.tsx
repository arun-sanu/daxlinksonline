import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { createWebhook, listWebhooks, toggleWebhook, webhookAuthHeaders } from '../../../api/webhooks';
import type { Webhook, WebhookMethod } from '../../../api/types';

type WebhookForm = {
  name: string;
  url: string;
  method: WebhookMethod | string;
  signingSecret: string;
  event: string;
  notes: string;
  storePayload: boolean;
};

const webhookEvents = ['signal.triggered', 'signal.cleared', 'order.filled', 'order.failed'];

const fallbackConfig = {
  subdomain: 'ops-9ad734',
  baseDomain: 'daxlinksonline.link',
  secret: 'c8f14d88b0f9d7aa16f90b8f23bd2a54'
};

const mockLogs = [
  { level: 'info', message: 'Forward job queued for NSE:INFY', ts: '08:41:12' },
  { level: 'warning', message: 'Guardrail delayed webhook due to rate limit hit (retry scheduled)', ts: '08:39:04' },
  { level: 'error', message: 'TradingView secret mismatch rejected alert', ts: '08:20:31' }
];

function formatTimestamp(input?: string | null) {
  if (!input) return 'Pending';
  try {
    return new Date(input).toLocaleString();
  } catch {
    return 'Pending';
  }
}

function formatCountdown(target: Date) {
  const now = Date.now();
  const diff = Math.max(0, target.getTime() - now);
  const days = Math.floor(diff / (24 * 3600e3));
  const hours = Math.floor((diff % (24 * 3600e3)) / 3600e3);
  return `${days}d ${hours}h`;
}

function normalizeWebhook(hook: Webhook): Webhook {
  return {
    ...hook,
    url: hook.url || `https://${fallbackConfig.subdomain}.${fallbackConfig.baseDomain}/webhook`,
    method: hook.method || 'POST',
    events: hook.events && hook.events.length ? hook.events : ['signal.triggered'],
    active: hook.active ?? true
  };
}

export default function WebhooksModule() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [activeTab, setActiveTab] = useState<'setup' | 'logs'>('setup');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState('');
  const [authBlocked, setAuthBlocked] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [copyState, setCopyState] = useState({ url: false, secret: false });
  const [trialEndsAt] = useState<Date>(() => new Date(Date.now() + 27 * 24 * 3600e3));
  const [tvDetails, setTvDetails] = useState(() => ({
    subdomain: fallbackConfig.subdomain,
    domain: fallbackConfig.baseDomain,
    secret: fallbackConfig.secret
  }));

  const [form, setForm] = useState<WebhookForm>(() => ({
    name: 'TradingView Alerts',
    url: `https://${fallbackConfig.subdomain}.${fallbackConfig.baseDomain}/webhook`,
    method: 'POST',
    signingSecret: fallbackConfig.secret,
    event: webhookEvents[0],
    notes: '',
    storePayload: false
  }));

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await listWebhooks();
        if (!mounted) return;
        const normalized = rows.map(normalizeWebhook);
        setWebhooks(normalized);
        if (normalized[0]?.url) {
          const first = normalized[0];
          setForm((prev) => ({ ...prev, url: prev.url || first.url }));
          try {
            const parsed = new URL(first.url);
            const hostParts = parsed.host.split('.');
            if (hostParts.length >= 3) {
              setTvDetails((prev) => ({
                ...prev,
                subdomain: hostParts[0],
                domain: hostParts.slice(1).join('.')
              }));
            }
          } catch {
            // ignore malformed URL
          }
        }
        if (normalized[0]?.signingSecretRef) {
          setTvDetails((prev) => ({ ...prev, secret: normalized[0].signingSecretRef || prev.secret }));
        }
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load webhooks');
        if (/401|403/i.test(String(e?.message))) setAuthBlocked(true);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const primaryWebhook = useMemo(() => (webhooks.length ? webhooks[0] : null), [webhooks]);
  const derivedUrl =
    tvDetails.subdomain && tvDetails.domain ? `https://${tvDetails.subdomain}.${tvDetails.domain}/webhook` : form.url;
  const webhookUrl = primaryWebhook?.url || derivedUrl || `https://${fallbackConfig.subdomain}.${fallbackConfig.baseDomain}/webhook`;
  const heroSecret = primaryWebhook?.signingSecretRef || tvDetails.secret || form.signingSecret || fallbackConfig.secret;
  const countdown = formatCountdown(trialEndsAt);
  const expiringSoon = useMemo(() => trialEndsAt.getTime() - Date.now() <= 3 * 24 * 3600e3, [trialEndsAt]);
  const tradingViewPayload = useMemo(
    () =>
      `{
  "symbol": "NSE:INFY",
  "side": "buy",
  "amount": 25,
  "price": 1563.50,
  "secret": "${heroSecret}"
}`,
    [heroSecret]
  );

  async function handleCopy(text: string, key: 'url' | 'secret') {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopyState((prev) => ({ ...prev, [key]: false })), 1200);
    } catch {
      // ignore clipboard errors
    }
  }

  async function handleCreate() {
    if (!form.name || !form.url) {
      setError('Name and URL are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await createWebhook({
        name: form.name.trim(),
        url: form.url.trim(),
        method: form.method,
        signingSecret: form.signingSecret.trim() || undefined,
        events: [form.event],
        event: form.event,
        active: true
      });
      const normalized = normalizeWebhook(created);
      setWebhooks((prev) => [normalized, ...prev]);
      setForm((prev) => ({
        ...prev,
        name: 'TradingView Alerts',
        notes: '',
        storePayload: false
      }));
    } catch (e: any) {
      setError(e?.message || 'Unable to create webhook');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(hook: Webhook) {
    const next = !hook.active;
    setTogglingId(hook.id);
    setWebhooks((prev) => prev.map((w) => (w.id === hook.id ? { ...w, active: next } : w)));
    try {
      const updated = await toggleWebhook(hook.id, next);
      if (updated) {
        setWebhooks((prev) => prev.map((w) => (w.id === hook.id ? normalizeWebhook(updated) : w)));
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to update webhook');
      setWebhooks((prev) => prev.map((w) => (w.id === hook.id ? { ...w, active: !next } : w)));
    } finally {
      setTogglingId('');
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg('');
    try {
      const res = await fetch('/api/v1/webhook/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...webhookAuthHeaders() },
        body: JSON.stringify({ symbol: 'BTCUSDT', side: 'buy', secret: heroSecret })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTestMsg('✅ Test alert queued');
    } catch (e: any) {
      setTestMsg(`⚠️ ${e?.message || 'Test failed'}`);
    } finally {
      setTesting(false);
      setTimeout(() => setTestMsg(''), 3000);
    }
  }

  const channelRoot = useMemo(() => {
    try {
      const parsed = new URL(webhookUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return webhookUrl.replace(/\/webhook.*/, '');
    }
  }, [webhookUrl]);

  const channels = useMemo(
    () => [
      { label: 'Default TradingView', slug: 'webhook', status: 'Active', description: 'Primary NSE/BSE alerts' },
      { label: 'Options Desk', slug: 'options', status: 'Paused', description: 'Custom BankNifty Pine strategy' }
    ],
    []
  );

  function updateFromTvDetails(next: { subdomain?: string; domain?: string; secret?: string }) {
    setTvDetails((prev) => {
      const merged = { ...prev, ...next };
      setForm((formPrev) => ({
        ...formPrev,
        url:
          merged.subdomain && merged.domain
            ? `https://${merged.subdomain}.${merged.domain}/webhook`
            : formPrev.url || webhookUrl,
        signingSecret: merged.secret || formPrev.signingSecret
      }));
      return merged;
    });
  }

  function generateSecret() {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    updateFromTvDetails({ secret: token });
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="section-label">Webhooks</p>
        <h2 className="text-3xl font-semibold text-main">TradingView → Pendax bridge</h2>
        <p className="text-sm muted-text">
          Point TradingView (or any alert emitter) to your DaxLinks subdomain. The backend validates secrets, enforces IP allowlists,
          drops the alert onto BullMQ, then forwards it through the Pendax forwarder job.
        </p>
      </header>

      <section className="card-shell space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">TradingView ingress</p>
            <p className="text-sm text-gray-400">Set the subdomain and secret used by your Pine alerts.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-xs" onClick={generateSecret}>
            Generate secret
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-3 text-sm muted-text">
          <label className="flex flex-col gap-2">
            Subdomain
            <input
              value={tvDetails.subdomain}
              onChange={(e) => updateFromTvDetails({ subdomain: e.target.value.trim() })}
              className="field"
              placeholder="ops-9ad734"
            />
          </label>
          <label className="flex flex-col gap-2">
            Base domain
            <input
              value={tvDetails.domain}
              onChange={(e) => updateFromTvDetails({ domain: e.target.value.trim() })}
              className="field"
              placeholder="daxlinksonline.link"
            />
          </label>
          <label className="flex flex-col gap-2">
            Shared secret
            <input
              value={tvDetails.secret}
              onChange={(e) => updateFromTvDetails({ secret: e.target.value })}
              className="field"
              placeholder="Auto-generate"
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">The create form below uses these values when saving a webhook.</p>
      </section>

      {loading && <div className="card-shell text-sm text-gray-400">Loading webhooks…</div>}
      {!loading && error && <div className="card-shell text-sm text-amber-300">{error}</div>}
      {authBlocked && <p className="text-xs text-amber-300">Sign in as an admin/developer to manage live webhooks. Showing mock data.</p>}

      {webhookUrl && (
        <section className="card-shell p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl" style={{ background: 'linear-gradient(135deg,#00D4AA,#2EE6C9)' }}></div>
              <div>
                <p className="text-sm font-semibold text-main">Your webhook ingress is live</p>
                <p className="text-xs muted-text">
                  Expires in <span style={{ color: expiringSoon ? '#F59E0B' : '#00D4AA' }}>{countdown}</span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.3em] muted-text">Passphrase</p>
              <p className="text-sm font-mono text-main">{heroSecret || '—'}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="hero-input flex-1">
              <input value={webhookUrl} readOnly />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary text-xs" onClick={() => handleCopy(webhookUrl, 'url')}>
                {copyState.url ? 'Copied!' : 'Copy URL'}
              </button>
              <button className="btn btn-secondary text-xs" onClick={() => handleCopy(heroSecret, 'secret')}>
                {copyState.secret ? 'Copied!' : 'Copy Secret'}
              </button>
              <button className="btn btn-primary text-xs" onClick={handleTest} disabled={testing}>
                {testing ? 'Testing…' : 'Test Alert'}
              </button>
            </div>
          </div>
          {testMsg && <p className="text-xs" style={{ color: testMsg.startsWith('✅') ? '#00D4AA' : '#F59E0B' }}>{testMsg}</p>}
        </section>
      )}

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Bridge animation</p>
        <div className="iso-bridge">
          <div className="iso-node iso-node--tv">
            <span>TradingView</span>
          </div>
          <div className="iso-link" aria-hidden="true"></div>
          <div className="iso-node iso-node--dax">
            <span>Pendax</span>
          </div>
          <div className="iso-packets" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        <p className="text-xs text-gray-400">Alerts stream from TradingView into DaxLinks, traverse BullMQ, then fan out to exchanges.</p>
      </article>

      <article className="card-shell space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Connection details</p>
            <p className="text-sm text-gray-400">Configure TradingView to hit the DaxLinks ingress endpoint.</p>
          </div>
          <div className="flex gap-2 text-xs uppercase tracking-[0.3em]">
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${activeTab === 'setup' ? 'border-primary-400/60 text-primary-100' : 'border-white/10 text-gray-400'}`}
              onClick={() => setActiveTab('setup')}
            >
              Setup
            </button>
            <button
              type="button"
              className={`rounded-full border px-3 py-1 ${activeTab === 'logs' ? 'border-primary-400/60 text-primary-100' : 'border-white/10 text-gray-400'}`}
              onClick={() => setActiveTab('logs')}
            >
              Logs
            </button>
          </div>
        </div>

        {activeTab === 'setup' ? (
          <div className="grid gap-4 md:grid-cols-2 text-sm text-gray-300">
            <div>
              <p className="text-gray-400">Webhook URL</p>
              <p className="font-semibold text-main break-all">{webhookUrl}</p>
            </div>
            <div>
              <p className="text-gray-400">Shared secret</p>
              <p className="font-semibold text-main">{heroSecret}</p>
            </div>
            <div>
              <p className="text-gray-400">Rate limit</p>
              <p className="font-semibold text-main">20 alerts / sec per subdomain</p>
              <p className="text-xs text-gray-500">Handled by ingress middleware in backend/src/routes/v1/ingress.js</p>
            </div>
            <div>
              <p className="text-gray-400">Whitelisting</p>
              <p className="font-semibold text-main">TradingView IPs + optional secret</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-3 text-xs">
            {mockLogs.map((log, idx) => (
              <div key={idx} className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                <div>
                  <p className={`font-semibold ${log.level === 'error' ? 'text-red-300' : log.level === 'warning' ? 'text-amber-300' : 'text-primary-200'}`}>
                    [{log.level.toUpperCase()}]
                  </p>
                  <p className="text-gray-300">{log.message}</p>
                </div>
                <span className="text-gray-500">{log.ts}</span>
              </div>
            ))}
            <p className="text-[10px] text-gray-500">Latest events reflect backend/public/logs/webhook feed.</p>
          </div>
        )}
      </article>

      <section className="card-shell p-6 space-y-6">
        <h3 className="text-lg font-semibold text-main">TradingView Setup (3 steps)</h3>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-main">1) Alert → Webhook URL</p>
            <p className="text-xs muted-text">Create an alert and paste this URL:</p>
            <div className="hero-input">
              <input value={webhookUrl} readOnly />
            </div>
            <button className="btn btn-secondary btn-xs" onClick={() => handleCopy(webhookUrl, 'url')}>
              Copy URL
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-main">2) Message → JSON</p>
            <p className="text-xs muted-text">Use this payload in the alert message:</p>
            <pre className="text-xs p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
              <code>{tradingViewPayload}</code>
            </pre>
            <button className="btn btn-secondary btn-xs" onClick={() => handleCopy(tradingViewPayload, 'secret')}>
              Copy JSON
            </button>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-main">3) Enable → Test</p>
            <p className="text-xs muted-text">Turn on the alert and send a test. You should see a confirmation in your dashboard.</p>
            <ul className="text-xs muted-text list-disc pl-4">
              <li>Passphrase is dynamic (e.g., close price)</li>
              <li>We retry on transient errors</li>
              <li>Check queue stats in Admin → Queues</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="grid gap-12 section-pad xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-main">Webhook Router &amp; Event Dispatch</h2>
              <p className="mt-2 text-sm muted-text">
                Define inbound TradingView alerts and outbound notification targets. Monitor signatures, retries, and delivery health.
              </p>
            </div>
            <button className="btn btn-secondary" type="button" onClick={() => window.alert('Import is coming soon')}>
              Import from JSON
            </button>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {webhooks.map((hook) => {
              const lastDelivery = formatTimestamp(hook.lastDeliveryAt);
              const retries = (hook as any).retries ?? 0;
              return (
                <article key={hook.id} className="card-shell flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] muted-text">{hook.method}</p>
                      <p className="mt-1 text-lg font-semibold text-main">{hook.name}</p>
                    </div>
                    <button
                      onClick={() => handleToggle(hook)}
                      className="rounded-full px-3 py-1 text-xs font-semibold transition"
                      style={
                        hook.active
                          ? { background: 'rgba(52,211,153,0.18)', color: '#34D399' }
                          : { background: 'rgba(250,204,21,0.18)', color: '#FACC15' }
                      }
                      disabled={togglingId === hook.id}
                    >
                      {hook.active ? 'Active' : 'Paused'}
                    </button>
                  </div>
                  <p className="break-words text-xs muted-text">{hook.url}</p>
                  <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] muted-text">
                    {(hook.events && hook.events.length ? hook.events : webhookEvents).map((event) => (
                      <span
                        key={event}
                        className="rounded-full px-3 py-1"
                        style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)' }}
                      >
                        {event}
                      </span>
                    ))}
                  </div>
                  <div className="card-shell p-4 text-xs muted-text">
                    <div className="flex items-center justify-between">
                      <span>Last Delivery</span>
                      <span style={{ color: 'var(--primary)' }}>{lastDelivery}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span>Signing Secret</span>
                      <span>{hook.signingSecretRef || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs muted-text">
                    <span>Retries: {retries}</span>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary" style={{ padding: '0.6rem 1.1rem' }}>
                        Deliver Test
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.6rem 1.1rem', borderColor: 'rgba(255,0,0,0.25)', color: 'rgba(255,255,255,0.65)' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {webhooks.length === 0 && <div className="card-shell text-sm text-gray-400">No webhooks yet.</div>}
          </div>
        </div>

        <form
          className="card-shell space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-main">Create Webhook</h3>
            <span className="section-label" style={{ color: 'var(--primary)' }}>
              Step 2 · Routing
            </span>
          </div>
          <label className="flex flex-col gap-2 text-sm muted-text">
            Name
            <input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              type="text"
              placeholder="TradingView Alerts"
              className="field"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm muted-text">
            URL
            <input
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              type="url"
              placeholder="https://daxlinks.online/api/webhooks/tradingview"
              className="field"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm muted-text">
              HTTP Method
              <select
                value={form.method}
                onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value as WebhookMethod }))}
                className="field"
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm muted-text">
              Signing Secret
              <input
                value={form.signingSecret}
                onChange={(e) => setForm((prev) => ({ ...prev, signingSecret: e.target.value }))}
                type="text"
                placeholder="Auto-generate"
                className="field"
              />
            </label>
          </div>
          <label className="flex flex-col gap-2 text-sm muted-text">
            Event Triggers
            <select
              value={form.event}
              onChange={(e) => setForm((prev) => ({ ...prev, event: e.target.value }))}
              className="field"
            >
              {webhookEvents.map((evt) => (
                <option key={evt} value={evt}>
                  {evt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm muted-text">
            Delivery Notes
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              placeholder="Throttle alerts to 30/min, append exchange symbol as query param..."
              className="field"
            ></textarea>
          </label>
          <label className="flex items-center gap-3 text-xs muted-text">
            <input
              type="checkbox"
              checked={form.storePayload}
              onChange={(e) => setForm((prev) => ({ ...prev, storePayload: e.target.checked }))}
              className="h-4 w-4"
              style={{ border: '1px solid var(--border)', background: 'transparent', accentColor: 'var(--primary)', borderRadius: '6px' }}
            />
            Retain payload samples for troubleshooting (encrypted at rest).
          </label>
          <div className="flex flex-wrap items-center gap-3 text-xs muted-text">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Webhook'}
            </button>
            <span>Optional: attach to Discord, Slack, or PagerDuty follow-up webhooks.</span>
          </div>
        </form>
      </section>

      <article className="card-shell space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">TradingView message template</p>
        <p className="text-sm text-gray-400">
          Paste the JSON below into your TradingView alert body. Guardrails inside backend/src/routes/v1/ingress.js verify the secret before
          enqueuing forward jobs.
        </p>
        <pre className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-primary-100 overflow-auto">
{tradingViewPayload}
        </pre>
      </article>

      <article className="card-shell space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">What happens next?</p>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>• ingress router logs <code>/webhook</code> receipts and sanitizes payloads.</li>
          <li>• <code>tradingviewService.forward</code> pushes the alert to BullMQ, then Pendax forwarder fans it to active exchanges.</li>
          <li>• Audit logs capture every inbound alert along with sanitized payloads.</li>
        </ul>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link
            to="/docs/webhooks"
            className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-gray-300 hover:border-primary-400/40 hover:text-primary-100"
          >
            Docs
          </Link>
          <a
            href="https://api.daxlinks.online/api/v1/ingress/webhook/test"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/15 px-3 py-1 tracking-[0.28em] text-gray-300 hover:border-primary-400/40 hover:text-primary-100"
          >
            Test endpoint
          </a>
        </div>
      </article>

      <article className="card-shell space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Webhook channels</p>
            <p className="text-sm text-gray-400">Stage different subpaths for desks or sandboxes.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-small">
            New channel
          </button>
        </div>
        <div className="space-y-3 text-sm text-gray-300">
          {channels.map((channel) => (
            <div key={channel.slug} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-main">{channel.label}</p>
                  <p className="text-xs text-gray-500">/{channel.slug}</p>
                </div>
                <span className={channel.status === 'Active' ? 'text-emerald-300 text-xs uppercase tracking-[0.3em]' : 'text-amber-300 text-xs uppercase tracking-[0.3em]'}>
                  {channel.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-400">{channel.description}</p>
              <p className="text-[11px] text-gray-500 break-all">
                {channelRoot}/{channel.slug}
              </p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}
