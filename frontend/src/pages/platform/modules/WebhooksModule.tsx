import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { Webhook, WebhookDelivery, WebhookProfile } from '../../../api/types';
import { fetchWebhookDeliveries, fetchWebhookProfile, listWebhooks, toggleWebhook } from '../../../api/webhooks';

type Toast = { message: string; tone: 'success' | 'error' };

function formatTs(input?: string | null) {
  if (!input) return '—';
  try {
    return new Date(input).toLocaleString();
  } catch {
    return input;
  }
}

function formatDeliveryRow(delivery: WebhookDelivery) {
  return {
    status: delivery.status || 'pending',
    event: delivery.event || 'signal',
    code: delivery.responseCode ?? null,
    error: delivery.lastError || '',
    ts: formatTs(delivery.createdAt)
  };
}

export default function WebhooksModule() {
  const [profile, setProfile] = useState<WebhookProfile | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingWebhooks, setLoadingWebhooks] = useState(true);
  const [loadingDeliveries, setLoadingDeliveries] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState('');
  const [showRevealConfirm, setShowRevealConfirm] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const p = await fetchWebhookProfile();
        if (mounted) setProfile(p);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load webhook profile');
      } finally {
        if (mounted) setLoadingProfile(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingWebhooks(true);
      try {
        const rows = await listWebhooks();
        if (mounted) setWebhooks(rows || []);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load webhooks');
      } finally {
        if (mounted) setLoadingWebhooks(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoadingDeliveries(true);
      try {
        const rows = await fetchWebhookDeliveries(10);
        if (mounted) setDeliveries(rows || []);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load deliveries');
      } finally {
        if (mounted) setLoadingDeliveries(false);
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const ingressUrl = useMemo(() => {
    if (profile?.url) return profile.url;
    if (webhooks[0]?.url) return webhooks[0].url;
    return 'https://<sub>.daxlinksonline.link/webhook';
  }, [profile, webhooks]);

  const secretValue = profile?.secret || webhooks[0]?.signingSecretRef || '';
  const maskedSecret = secretVisible ? secretValue || '—' : '••••••••••••';

  const tradingViewPayload = useMemo(
    () =>
      `{
  "symbol": "NSE:INFY",
  "side": "buy",
  "amount": 25,
  "secret": "${secretValue || '<set-your-secret>'}"
}`,
    [secretValue]
  );

  async function handleToggle(hook: Webhook) {
    const next = !hook.active;
    setToggling(hook.id);
    setWebhooks((prev) => prev.map((w) => (w.id === hook.id ? { ...w, active: next } : w)));
    try {
      const updated = await toggleWebhook(hook.id, next);
      if (updated) {
        setWebhooks((prev) => prev.map((w) => (w.id === hook.id ? { ...w, ...updated } : w)));
      }
      setToast({ message: `${next ? 'Enabled' : 'Paused'} ${hook.name}`, tone: 'success' });
    } catch (e: any) {
      setWebhooks((prev) => prev.map((w) => (w.id === hook.id ? { ...w, active: !next } : w)));
      setToast({ message: e?.message || 'Toggle failed', tone: 'error' });
    } finally {
      setToggling(null);
    }
  }

  async function handleCopy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: `${label} copied`, tone: 'success' });
    } catch {
      setToast({ message: 'Copy failed', tone: 'error' });
    }
  }

  function handleRevealSecret() {
    if (secretVisible) {
      setSecretVisible(false);
      return;
    }
    setShowRevealConfirm(true);
  }

  return (
    <div className="space-y-8">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-40 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            toast.tone === 'success' ? 'bg-emerald-600/80 border-emerald-300/60 text-emerald-50' : 'bg-red-600/80 border-red-300/60 text-red-50'
          }`}
        >
          {toast.message}
        </div>
      )}

      <header className="space-y-2">
        <p className="section-label">Webhooks</p>
        <h2 className="text-3xl font-semibold text-main">TradingView → DaxLinks ingress</h2>
        <p className="text-sm muted-text">
          Wire your TradingView alerts into your dedicated webhook URL, then route outbound notifications to your configured endpoints.
        </p>
      </header>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] muted-text">Ingress URL</p>
            <p className="text-sm text-gray-400">Authenticated users get a unique subdomain under daxlinksonline.link.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-xs" onClick={() => handleCopy(ingressUrl, 'URL')}>
              Copy URL
            </button>
            <button className="btn btn-secondary btn-xs" onClick={handleRevealSecret} disabled={!secretValue}>
              {secretVisible ? 'Hide secret' : 'Reveal secret'}
            </button>
          </div>
        </div>
        {loadingProfile ? (
          <p className="text-sm muted-text">Loading webhook profile…</p>
        ) : profile ? (
          <>
            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <div className="hero-input">
                <input value={ingressUrl} readOnly aria-label="Webhook URL" />
              </div>
              <div className="hero-input">
                <input value={maskedSecret} readOnly aria-label="Webhook secret" />
              </div>
            </div>
            <p className="text-xs text-gray-500">POST alerts to this URL and include the secret in the payload for validation.</p>
          </>
        ) : (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p>No webhook is provisioned yet.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() => setToast({ message: 'Contact support to provision your ingress.', tone: 'success' })}
              >
                Request provisioning
              </button>
              <Link to="/support" className="btn btn-secondary btn-xs">
                Open support
              </Link>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-amber-300">{error}</p>}
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] muted-text">TradingView wiring</p>
            <p className="text-sm text-gray-400">Copy the JSON payload into your TradingView alert message.</p>
          </div>
          <button className="btn btn-secondary btn-xs" onClick={() => handleCopy(tradingViewPayload, 'Payload')}>
            Copy JSON
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm muted-text">
            <p className="font-semibold text-main">Steps</p>
            <ol className="space-y-1 pl-4 list-decimal">
              <li>Set Webhook URL to <span className="font-mono text-main break-all">{ingressUrl}</span></li>
              <li>Paste the JSON payload below (includes your secret).</li>
              <li>Send a test alert and watch delivery status in real time.</li>
            </ol>
          </div>
          <pre className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-primary-100 overflow-auto" aria-label="TradingView JSON payload">
{tradingViewPayload}
          </pre>
        </div>
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-main">Outbound webhook configs</h3>
            <p className="text-xs muted-text">Toggle endpoints and view the last delivery code.</p>
          </div>
          <button
            className="btn btn-secondary btn-xs"
            type="button"
            onClick={() => {
              setLoadingWebhooks(true);
              listWebhooks()
                .then((rows) => setWebhooks(rows || []))
                .catch((e: any) => setToast({ message: e?.message || 'Refresh failed', tone: 'error' }))
                .finally(() => setLoadingWebhooks(false));
            }}
          >
            Refresh
          </button>
        </div>
        {loadingWebhooks && <p className="text-sm muted-text">Loading webhooks…</p>}
        {!loadingWebhooks && webhooks.length === 0 && <p className="text-sm muted-text">No outbound webhooks configured yet.</p>}
        {!loadingWebhooks && webhooks.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {webhooks.map((hook) => (
              <article key={hook.id} className="card-shell border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] muted-text">{hook.method}</p>
                    <p className="text-lg font-semibold text-main">{hook.name}</p>
                    <p className="text-xs text-gray-500 break-all">{hook.url}</p>
                  </div>
                  <button
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={
                      hook.active
                        ? { background: 'rgba(52,211,153,0.18)', color: '#34D399' }
                        : { background: 'rgba(250,204,21,0.18)', color: '#FACC15' }
                    }
                    onClick={() => handleToggle(hook)}
                    disabled={toggling === hook.id}
                  >
                    {hook.active ? 'Active' : 'Paused'}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 text-xs muted-text">
                  <div className="flex items-center justify-between">
                    <span>Last delivery</span>
                    <span className="text-main">{formatTs(hook.lastDeliveryAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Response code</span>
                    <span className="text-main">{hook.lastResponseCode ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Signing secret</span>
                    <span className="text-gray-400">{hook.signingSecretRef || '—'}</span>
                  </div>
                  {hook.lastError && <p className="text-[11px] text-amber-300">Last error: {hook.lastError}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-main">Recent deliveries</h3>
            <p className="text-xs muted-text">Last 10 attempts from the admin metrics endpoint.</p>
          </div>
          <button
            className="btn btn-secondary btn-xs"
            type="button"
            onClick={() => {
              setLoadingDeliveries(true);
              fetchWebhookDeliveries(10)
                .then((rows) => setDeliveries(rows || []))
                .catch((e: any) => setToast({ message: e?.message || 'Refresh failed', tone: 'error' }))
                .finally(() => setLoadingDeliveries(false));
            }}
          >
            Refresh
          </button>
        </div>
        {loadingDeliveries && <p className="text-sm muted-text">Loading deliveries…</p>}
        {!loadingDeliveries && deliveries.length === 0 && <p className="text-sm muted-text">No deliveries yet.</p>}
        {!loadingDeliveries && deliveries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs text-gray-300">
              <thead className="text-left text-[11px] uppercase tracking-[0.2em] muted-text">
                <tr>
                  <th className="pb-2">Event</th>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Response</th>
                  <th className="pb-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const row = formatDeliveryRow(d);
                  const tone =
                    row.status === 'delivered' || row.status === 'success'
                      ? 'text-emerald-300'
                      : row.status === 'failed'
                      ? 'text-red-300'
                      : 'text-amber-300';
                  return (
                    <tr key={d.id} className="border-t border-white/5 align-middle">
                      <td className="py-3">{row.event}</td>
                      <td className="py-3">{row.ts}</td>
                      <td className={`py-3 ${tone}`}>{row.status}</td>
                      <td className="py-3">{row.code ?? '—'}</td>
                      <td className="py-3 text-amber-200">{row.error || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showRevealConfirm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0b0c10] p-5 shadow-xl">
            <p className="text-lg font-semibold text-main">Reveal webhook secret?</p>
            <p className="text-sm muted-text">
              Only reveal in a private setting. Anyone with this secret can send alerts that pass validation.
            </p>
            <div className="flex justify-end gap-3 text-sm">
              <button type="button" className="btn btn-secondary" onClick={() => setShowRevealConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setSecretVisible(true);
                  setShowRevealConfirm(false);
                }}
              >
                Reveal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
