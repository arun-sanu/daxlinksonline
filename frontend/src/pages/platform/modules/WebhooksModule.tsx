import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { Webhook, WebhookDelivery, WebhookProfile } from '../../../api/types';
import {
  assignWebhook,
  fetchWebhookDeliveries,
  fetchWebhookProfile,
  getMyWebhook,
  listWebhooks,
  testWebhook,
  toggleWebhook
} from '../../../api/webhooks';

type Toast = { message: string; tone: 'success' | 'error' };

function EyeIcon({ slashed }: { slashed?: boolean }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5c-5 0-9 7-9 7s4 7 9 7 9-7 9-7-4-7-9-7Z" />
      <circle cx="12" cy="12" r="3" />
      {slashed && <path d="M5 5l14 14" />}
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

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
  type MyWebhook = Awaited<ReturnType<typeof getMyWebhook>>;

  const [myWebhook, setMyWebhook] = useState<MyWebhook | null>(null);
  const [profile, setProfile] = useState<WebhookProfile | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingWebhooks, setLoadingWebhooks] = useState(true);
  const [loadingDeliveries, setLoadingDeliveries] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [error, setError] = useState('');
  const [secretVisible, setSecretVisible] = useState(false);
  const [hmacVisible, setHmacVisible] = useState(false);
  const [showRevealConfirm, setShowRevealConfirm] = useState(false);
  const [revealTarget, setRevealTarget] = useState<'secret' | 'hmac' | null>(null);
  const [testForm, setTestForm] = useState({
    symbol: 'TEST',
    side: 'buy',
    amount: 100,
    timestamp: Date.now(),
    hmac: ''
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [selectedDnsUrl, setSelectedDnsUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingProfile(true);
      setError('');
      let hasMyWebhook = false;
      try {
        const payload = await getMyWebhook();
        if (mounted) {
          setMyWebhook(payload);
          hasMyWebhook = true;
        }
      } catch (e: any) {
        if (mounted) setMyWebhook(null);
      }
      try {
        const p = await fetchWebhookProfile();
        if (mounted) setProfile(p);
      } catch (e: any) {
        if (mounted && !hasMyWebhook) {
          setError(e?.message || 'Failed to load webhook profile');
        }
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

  const dnsRecords = myWebhook?.dnsRecords || [];
  const selectedDnsUrlValid = dnsRecords.some((rec) => rec.url === selectedDnsUrl) ? selectedDnsUrl : null;
  const activeDnsUrl = selectedDnsUrlValid || null;

  useEffect(() => {
    if (!selectedDnsUrlValid && selectedDnsUrl) {
      setSelectedDnsUrl(null);
    }
  }, [selectedDnsUrlValid, selectedDnsUrl]);

  const secretValue = myWebhook?.secret || profile?.secret || webhooks[0]?.signingSecretRef || '';
  const ingressUrl = useMemo(() => {
    if (activeDnsUrl) {
      const base = activeDnsUrl.replace(/\/+$/, '');
      const secretSuffix = secretValue ? `?secret=${encodeURIComponent(secretValue)}` : '';
      return `${base}/webhook/tradingview${secretSuffix}`;
    }
    if (myWebhook?.url) return myWebhook.url;
    if (profile?.url) return profile.url;
    if (webhooks[0]?.url) return webhooks[0].url;
    return 'https://<sub>.daxlinksonline.link/webhook/tradingview';
  }, [activeDnsUrl, myWebhook, profile, webhooks, secretValue]);
  const hmacValue = myWebhook?.hmacKey || '';
  const enforceHmac = myWebhook?.enforceHmac || false;
  const baseDomain = myWebhook?.baseDomain || 'daxlinksonline.link';
  const hasAssignedWebhook = Boolean(myWebhook?.url || profile?.url);
  const maskedSecret = secretVisible ? secretValue || '—' : '••••••••••••';
  const maskedHmac = hmacVisible ? hmacValue || '—' : '••••••••••••';

  const tradingViewPayload = useMemo(
    () =>
      `{
  "symbol": "NSE:INFY",
  "side": "buy",
  "amount": 25,
  "timestamp": ${Date.now()},
  "secret": "${secretValue || '<set-your-secret>'}",
  "hmac": "${hmacValue ? '<computed-hmac>' : '<optional-hmac>'}"
}`,
    [secretValue, hmacValue]
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
    setRevealTarget('secret');
    setShowRevealConfirm(true);
  }

  function handleRevealHmac() {
    if (hmacVisible) {
      setHmacVisible(false);
      return;
    }
    setRevealTarget('hmac');
    setShowRevealConfirm(true);
  }

  async function refreshIngress() {
    setLoadingProfile(true);
    setError('');
    try {
      const payload = await getMyWebhook();
      setMyWebhook(payload);
    } catch (e: any) {
      setMyWebhook(null);
      if (e?.message) setError(e.message);
    } finally {
      try {
        const p = await fetchWebhookProfile();
        setProfile(p);
      } catch {
        // ignore; older profile may not exist
      } finally {
        setLoadingProfile(false);
      }
    }
  }

  async function handleAssignWebhook() {
    if (hasAssignedWebhook) {
      const confirmed = window.confirm(
        'Rotate webhook? This will generate a new secret and HMAC key. Old TradingView URLs will stop working.'
      );
      if (!confirmed) return;
    }
    setAssigning(true);
    setError('');
    setSecretVisible(false);
    setHmacVisible(false);
    try {
      await assignWebhook(hasAssignedWebhook ? { rotateSecret: true, rotateHmacKey: true } : undefined);
      await refreshIngress();
      setToast({ message: hasAssignedWebhook ? 'Webhook rotated' : 'Webhook assigned', tone: 'success' });
    } catch (e: any) {
      setToast({ message: e?.message || 'Assign failed', tone: 'error' });
    } finally {
      setAssigning(false);
    }
  }

  async function handleTestWebhook() {
    setTesting(true);
    setTestResult(null);
    setError('');
    const payload = {
      symbol: testForm.symbol,
      side: testForm.side,
      amount: Number(testForm.amount),
      timestamp: Number(testForm.timestamp),
      ...(testForm.hmac ? { hmac: testForm.hmac } : {})
    };
    try {
      const res = await testWebhook(payload);
      setTestResult(JSON.stringify(res, null, 2));
      setToast({ message: 'Test sent', tone: 'success' });
    } catch (e: any) {
      setTestResult(e?.message || 'Test failed');
      setToast({ message: e?.message || 'Test failed', tone: 'error' });
    } finally {
      setTesting(false);
    }
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
            <p className="text-sm text-gray-400">Authenticated users get a unique subdomain under {baseDomain}.</p>
          </div>
          <button className="btn btn-primary btn-xs" onClick={handleAssignWebhook} disabled={assigning}>
            {assigning ? 'Updating…' : hasAssignedWebhook ? 'Rotate Webhook' : 'Assign Webhook'}
          </button>
        </div>
        {loadingProfile ? (
          <p className="text-sm muted-text">Loading webhook profile…</p>
        ) : hasAssignedWebhook ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.24em] text-gray-400">Saved DNS records</p>
                  <span className="text-[11px] text-gray-500">
                    {activeDnsUrl ? 'Click to switch URL' : 'Select a DNS record to use its URL'}
                  </span>
                </div>
                {dnsRecords.length > 0 ? (
                  <ul className="space-y-2">
                    {dnsRecords.map((rec) => {
                      const isActive = activeDnsUrl === rec.url;
                      return (
                        <li key={rec.url}>
                          <button
                            type="button"
                            onClick={() => setSelectedDnsUrl(rec.url)}
                            className={`flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left text-sm ${
                              isActive
                                ? 'border-primary-300 bg-primary-500/10 text-main'
                                : 'border-white/10 bg-black/20 text-gray-200 hover:border-primary-200/40'
                            }`}
                          >
                            <span className="font-semibold text-main">
                              {rec.subdomain} <span className="text-gray-400">→ {rec.host}</span>
                            </span>
                            <span className="text-[11px] text-gray-500 break-all">{rec.url}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400">No DNS records saved yet.</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
                  <div className="space-y-2">
                    <div className="hero-input">
                      <input value={ingressUrl} readOnly aria-label="Webhook URL" />
                    </div>
                    <button
                      className="btn btn-secondary btn-xs px-2 py-1 text-[11px]"
                      onClick={() => handleCopy(ingressUrl, 'URL')}
                      disabled={!ingressUrl}
                    >
                      Copy URL
                    </button>
                  </div>
                  <div className="space-y-2">
                    <div className="hero-input">
                      <input value={maskedSecret} readOnly aria-label="Webhook secret" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                    className="btn btn-secondary btn-xs flex flex-col items-center px-2 py-1 text-[9px]"
                    aria-label={secretVisible ? 'Hide secret' : 'Reveal secret'}
                    onClick={handleRevealSecret}
                    disabled={!secretValue}
                  >
                    <EyeIcon slashed={!secretVisible} />
                  </button>
                  <button
                    className="btn btn-secondary btn-xs flex flex-col items-center px-2 py-1 text-[9px]"
                    onClick={() => handleCopy(secretValue, 'Secret')}
                    aria-label="Copy secret"
                    disabled={!secretValue}
                  >
                    <CopyIcon />
                  </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="hero-input">
                      <input value={maskedHmac} readOnly aria-label="Webhook HMAC key" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                    className="btn btn-secondary btn-xs flex flex-col items-center px-2 py-1 text-[9px]"
                    onClick={handleRevealHmac}
                    aria-label={hmacVisible ? 'Hide HMAC' : 'Reveal HMAC'}
                    disabled={!hmacValue}
                  >
                    <EyeIcon slashed={!hmacVisible} />
                  </button>
                  <button
                    className="btn btn-secondary btn-xs flex flex-col items-center px-2 py-1 text-[9px]"
                    onClick={() => handleCopy(hmacValue, 'HMAC key')}
                    aria-label="Copy HMAC"
                    disabled={!hmacValue}
                  >
                    <CopyIcon />
                  </button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                  <span>Enforce HMAC: {enforceHmac ? 'Enabled' : 'Optional'}</span>
                  <span>Base domain: {baseDomain}</span>
                </div>
                <p className="text-xs text-gray-500">
                  POST alerts to this URL and include the secret in the payload for validation{enforceHmac ? ' plus an HMAC signature.' : '.'}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p>No webhook is provisioned yet.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={handleAssignWebhook}
                disabled={assigning}
              >
                {assigning ? 'Assigning…' : 'Assign webhook'}
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
              <li>Paste the JSON payload below (includes your secret and timestamp).</li>
              <li>{enforceHmac ? 'Compute and include' : 'Optionally include'} the HMAC signature.</li>
              <li>Send a test alert and watch delivery status in real time.</li>
            </ol>
          </div>
          <pre className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-primary-100 overflow-auto" aria-label="TradingView JSON payload">
{tradingViewPayload}
          </pre>
        </div>
        <p className="text-xs text-gray-500">
          HMAC tip: compute SHA-256 over the JSON payload without the <span className="font-mono text-main">hmac</span> field, using your HMAC key.
        </p>
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] muted-text">Webhook test</p>
            <p className="text-sm text-gray-400">Send a sample payload to your ingress endpoint.</p>
          </div>
          <button
            className="btn btn-secondary btn-xs"
            type="button"
            onClick={() => setTestForm((prev) => ({ ...prev, timestamp: Date.now() }))}
          >
            Use current time
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs uppercase tracking-[0.2em] text-gray-400">
            Symbol
            <input
              value={testForm.symbol}
              onChange={(e) => setTestForm((prev) => ({ ...prev, symbol: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-[0.2em] text-gray-400">
            Side
            <input
              value={testForm.side}
              onChange={(e) => setTestForm((prev) => ({ ...prev, side: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-[0.2em] text-gray-400">
            Amount
            <input
              type="number"
              value={testForm.amount}
              onChange={(e) => setTestForm((prev) => ({ ...prev, amount: Number(e.target.value) }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-[0.2em] text-gray-400">
            Timestamp (ms)
            <input
              type="number"
              value={testForm.timestamp}
              onChange={(e) => setTestForm((prev) => ({ ...prev, timestamp: Number(e.target.value) }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-[0.2em] text-gray-400 md:col-span-2">
            HMAC (optional)
            <input
              value={testForm.hmac}
              onChange={(e) => setTestForm((prev) => ({ ...prev, hmac: e.target.value }))}
              className="mt-2 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
              placeholder={enforceHmac ? 'Required when HMAC enforcement is enabled' : 'Optional'}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary btn-xs" type="button" onClick={handleTestWebhook} disabled={testing}>
            {testing ? 'Sending…' : 'Send test webhook'}
          </button>
          <button className="btn btn-secondary btn-xs" type="button" onClick={() => handleCopy(JSON.stringify(testForm, null, 2), 'Test payload')}>
            Copy test payload
          </button>
        </div>
        {testResult && (
          <pre className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-primary-100 overflow-auto" aria-label="Test webhook result">
{testResult}
          </pre>
        )}
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
            <p className="text-lg font-semibold text-main">
              Reveal {revealTarget === 'hmac' ? 'HMAC key' : 'webhook secret'}?
            </p>
            <p className="text-sm muted-text">
              Only reveal in a private setting. Anyone with this value can send alerts that pass validation.
            </p>
            <div className="flex justify-end gap-3 text-sm">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowRevealConfirm(false);
                  setRevealTarget(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (revealTarget === 'hmac') {
                    setHmacVisible(true);
                  } else {
                    setSecretVisible(true);
                  }
                  setShowRevealConfirm(false);
                  setRevealTarget(null);
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
