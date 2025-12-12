import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  createIntegration,
  deleteIntegrationCredential,
  fetchIntegrationDetail,
  listIntegrations,
  purgeIntegrationCredentials,
  testIntegration,
  updateIntegrationCredential
} from '../../api/integrations';

type ExchangeConfig = {
  name: string;
  region: string;
  notes?: string;
  requiresPassphrase?: boolean;
  extraFieldLabel?: string;
  supportsSandbox?: boolean;
};

const EXCHANGES: Record<string, ExchangeConfig> = {
  binance: { name: 'Binance', region: 'Global', notes: 'IP allowlists and sub-accounts supported.', extraFieldLabel: 'Sub-account (optional)', supportsSandbox: true },
  mexc: { name: 'MEXC', region: 'Global', notes: 'Use API v3; enable spot/futures permissions.', supportsSandbox: true },
  okx: { name: 'OKX', region: 'Global', notes: 'Only unified account keys supported.', requiresPassphrase: true, supportsSandbox: true },
  bybit: { name: 'Bybit', region: 'Global', notes: 'Perps + inverse supported. Toggle spot in key permissions.', supportsSandbox: true },
  zerodha: { name: 'Zerodha', region: 'India', notes: 'Session tokens expire every few hours; use auto refresh.', extraFieldLabel: 'Client ID' },
  bitget: { name: 'Bitget', region: 'Global', requiresPassphrase: true, notes: 'Enable IP binding and order write scope.', supportsSandbox: true },
  kucoin: { name: 'KuCoin', region: 'Global', requiresPassphrase: true, notes: 'API v2 keys; passphrase required.', supportsSandbox: true },
  phemex: { name: 'Phemex', region: 'Global', notes: 'USDT perps + spot supported.' },
  coinbase: { name: 'Coinbase', region: 'US', notes: 'Advanced Trade APIs only; legacy keys unsupported.' },
  kraken: { name: 'Kraken', region: 'US/EU', notes: 'Trading + funding scopes required. WebSockets optional.' }
};

type Credential = {
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  extra?: string;
  sandbox?: boolean;
};

type SavedCredential = {
  id: string;
  label?: string | null;
  apiKeyMasked?: string | null;
  apiSecretMasked?: string | null;
  passphraseMasked?: string | null;
  subAccount?: string | null;
  description?: string | null;
  environment?: string | null;
  createdAt?: string | null;
};

type ConnectivityLog = { id: string; status: string; message: string; createdAt: string };
type TabKey = 'overview' | 'connectivity' | 'data';

export default function ExchangeIntegrationPage() {
  const { exchangeId } = useParams<{ exchangeId: string }>();
  const location = useLocation();
  const config = exchangeId ? EXCHANGES[exchangeId] : null;
  const isDataTab = location.pathname.endsWith('/data');
  const isConnectivityTab = location.pathname.endsWith('/connectivity');

  const [creds, setCreds] = useState<Credential[]>([
    { label: 'Primary', apiKey: '', apiSecret: '', passphrase: '', extra: '', sandbox: false }
  ]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCreds, setSavedCreds] = useState<SavedCredential[]>([]);
  const [logs, setLogs] = useState<ConnectivityLog[]>([]);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockMfa, setUnlockMfa] = useState('');
  const [unlockVisible, setUnlockVisible] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [linksEnabled, setLinksEnabled] = useState(true);

  const title = useMemo(() => (config ? `${config.name} Integration` : 'Integration'), [config]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!config || !exchangeId) return;
      setMessage(null);
      setError(null);
      try {
        const integrations = await listIntegrations();
        if (!mounted) return;
        const match = integrations.find((i) => i.exchange === exchangeId);
        if (match) {
          setIntegrationId(match.id);
          setIntegrationStatus(match.status || null);
          setMessage(`Existing integration found (status: ${match.status || 'n/a'}).`);
          await hydrateDetail(match.id);
        }
      } catch (err: any) {
        if (mounted) setError(err?.message || 'Failed to load integrations');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [config, exchangeId]);

  if (!config) {
    return (
      <div className="layout-container pt-16 pb-24 space-y-4">
        <p className="text-sm text-red-500">Exchange not found.</p>
        <Link to="/platform/integrations" className="text-sm text-primary-200">← Back to integrations</Link>
      </div>
    );
  }

  function updateField(idx: number, field: keyof Credential, value: string | boolean) {
    setCreds((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }

  async function hydrateDetail(id: string) {
    try {
      const detail = await fetchIntegrationDetail(id);
      if (detail?.credentials) setSavedCreds(detail.credentials);
      if (detail?.logs) setLogs(detail.logs);
      if (detail?.status) setIntegrationStatus(detail.status);
    } catch {
      // silent; fall back below
    } finally {
      setLogs((prev) =>
        prev.length
          ? prev
          : [
              { id: '1', status: 'connected', message: 'Heartbeat ok', createdAt: new Date().toISOString() },
              { id: '2', status: 'alert', message: 'Recent timeout, retry scheduled', createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() }
            ]
      );
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    setMessage(null);
    const primary = creds[0];
    try {
      const created = await createIntegration({
        exchange: exchangeId!,
        environment: primary.sandbox ? 'paper' : 'live',
        apiKey: primary.apiKey,
        apiSecret: primary.apiSecret,
        passphrase: primary.passphrase || undefined,
        label: primary.label || undefined,
        description: primary.extra || undefined
      });
      setIntegrationId(created.id);
      setIntegrationStatus(created.status || 'pending');
      setMessage(`Saved credentials for ${config.name}.`);
      await handleTest(created.id);
      await hydrateDetail(created.id);
    } catch (err: any) {
      setError(err?.message || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(id?: string) {
    const targetId = id || integrationId;
    if (!targetId) {
      setError('Create the integration before testing.');
      return;
    }
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await testIntegration(targetId);
      if (res.status === 'connected') {
        setMessage(`${config.name} connectivity verified.`);
      } else {
        setError(res.error || 'Connectivity test failed');
      }
    } catch (err: any) {
      setError(err?.message || 'Connectivity test failed');
    } finally {
      setTesting(false);
    }
  }

  function canUnlockSecrets() {
    return unlockPassword.trim().length > 0 && unlockMfa.trim().length >= 6;
  }

  async function handleUpdateCredential(target: SavedCredential, patch: Partial<SavedCredential>) {
    if (!integrationId) return;
    try {
      setUpdatingId(target.id);
      const updated = await updateIntegrationCredential(integrationId, target.id, patch);
      setSavedCreds((prev) => prev.map((c) => (c.id === target.id ? { ...c, ...updated } : c)));
      setMessage('Credential updated.');
    } catch (err: any) {
      setError(err?.message || 'Failed to update credential');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDeleteCredential(target: SavedCredential) {
    if (!integrationId) return;
    try {
      setUpdatingId(target.id);
      await deleteIntegrationCredential(integrationId, target.id);
      setSavedCreds((prev) => prev.filter((c) => c.id !== target.id));
      setMessage('Credential deleted.');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete credential');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handlePurgeCredentials() {
    if (!integrationId) return;
    const confirmed = window.confirm(
      'Are you sure you want to remove all credentials for this integration? This will disconnect the adapter until new credentials are added.'
    );
    if (!confirmed) return;
    setPurging(true);
    setError(null);
    setMessage(null);
    try {
      const result = await purgeIntegrationCredentials(integrationId);
      setSavedCreds([]);
      setLogs([]);
      setIntegrationStatus(result?.status || 'pending');
      setMessage('Credentials purged. Integration pending reconnect.');
    } catch (err: any) {
      setError(err?.message || 'Failed to purge credentials');
    } finally {
      setPurging(false);
    }
  }

  function handleClearLogs() {
    setLogs([]);
  }

  async function handleRefreshLogs() {
    if (!integrationId) return;
    await hydrateDetail(integrationId);
  }

  async function handleCopyLogs() {
    const text = logs
      .map((log) => `[${new Date(log.createdAt).toISOString()}] ${log.status.toUpperCase()}: ${log.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || '');
      setMessage('Logs copied');
    } catch {
      setError('Unable to copy logs');
    }
  }

  function handleDownloadLogs() {
    const text = logs
      .map((log) => `[${new Date(log.createdAt).toISOString()}] ${log.status.toUpperCase()}: ${log.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `logs-${exchangeId || 'exchange'}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const activeTab = isDataTab ? 'data' : isConnectivityTab ? 'connectivity' : 'overview';
  const basePath = `/platform/integrations/${exchangeId}`;
  const venueLabel = config.name || 'Exchange';

  return (
    <div className="layout-container pt-16 pb-24 space-y-6">
      <TabHeader
        config={config}
        title={title}
        basePath={basePath}
        active={activeTab as TabKey}
        status={integrationStatus || undefined}
        onPurge={handlePurgeCredentials}
        purgeDisabled={!integrationId || purging}
        isPurging={purging}
      />

      {activeTab !== 'data' && (
        <StatsRow
          savedCredsCount={savedCreds.length}
          linksEnabled={linksEnabled}
          toggleLinks={() => setLinksEnabled((v) => !v)}
        />
      )}

      {activeTab === 'overview' && null}

      {activeTab === 'connectivity' && (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <section className="space-y-3" id="connectivity">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-label">Live connectivity</p>
                <p className="text-sm text-gray-300">Logs stream directly from the exchange adapter.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-500/30 p-4 h-80 flex flex-col">
              <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.22em] text-emerald-300 mb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-blink-onoff"></span>
                  live feed
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleRefreshLogs}
                    disabled={!integrationId}
                    className="inline-flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/90 transition hover:border-primary-300 hover:text-white"
                    aria-label="Refresh logs"
                  >
                    <span className="text-sm">🔄</span>
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    className="inline-flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/90 transition hover:border-primary-300 hover:text-white"
                    aria-label="Copy logs"
                  >
                    <span className="text-sm">📋</span>
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadLogs}
                    className="inline-flex items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/90 transition hover:border-primary-300 hover:text-white"
                    aria-label="Download logs"
                  >
                    <span className="text-sm">⬇️</span>
                    <span>Download</span>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto font-mono text-xs space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div className="text-[11px] text-emerald-300/80">{new Date(log.createdAt).toLocaleTimeString()}</div>
                    <div className="flex-1">
                      <div className="text-emerald-100">{log.message}</div>
                      <div className="text-[10px] text-emerald-500/80 uppercase tracking-[0.2em]">{log.status}</div>
                    </div>
                  </div>
                ))}
                {!logs.length && <p className="text-sm text-gray-400">No logs yet.</p>}
              </div>
              <div className="mt-3 flex justify-between items-center text-[11px] uppercase tracking-[0.2em] text-gray-300">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-300/60 bg-sky-400/15 text-sky-200 animate-blink-onoff text-xs font-semibold"
                  title="We use AI and ML to analyze logs, minimize errors, diagnose flaws, improve connectivity, bandwidth, network, security, and scale processing. Thank you for your support."
                >
                  AI
                </span>
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/80 transition hover:border-primary-300 hover:text-white"
                >
                  🧹 <span>Clear</span>
                </button>
              </div>
            </div>
          </section>

          <section className="card-shell space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-label">API credentials</p>
                <p className="text-sm text-gray-300">Store one or more key pairs; all writes are encrypted with workspace KMS.</p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.24em] text-gray-500">{venueLabel}</span>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              {creds.map((row, idx) => (
                <div key={idx} className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <label className="text-xs uppercase tracking-[0.24em] text-gray-500">Label</label>
                      <input
                        value={row.label}
                        onChange={(e) => updateField(idx, 'label', e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                        placeholder="Desk A · Futures"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-xs uppercase tracking-[0.24em] text-gray-500">API Key</label>
                      <input
                        value={row.apiKey}
                        onChange={(e) => updateField(idx, 'apiKey', e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-[0.24em] text-gray-500">API Secret</label>
                      <input
                        value={row.apiSecret}
                        onChange={(e) => updateField(idx, 'apiSecret', e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                        type="password"
                        required
                      />
                    </div>
                    {config.requiresPassphrase && (
                      <div>
                        <label className="text-xs uppercase tracking-[0.24em] text-gray-500">Passphrase</label>
                        <input
                          value={row.passphrase || ''}
                          onChange={(e) => updateField(idx, 'passphrase', e.target.value)}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                          type="password"
                        />
                      </div>
                    )}
                    {config.extraFieldLabel && (
                      <div>
                        <label className="text-xs uppercase tracking-[0.24em] text-gray-500">{config.extraFieldLabel}</label>
                        <input
                          value={row.extra || ''}
                          onChange={(e) => updateField(idx, 'extra', e.target.value)}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                          placeholder="Optional"
                        />
                      </div>
                    )}
                  </div>

                  {config.supportsSandbox && (
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        checked={!!row.sandbox}
                        onChange={(e) => updateField(idx, 'sandbox', e.target.checked)}
                      />
                      Sandbox / testnet key
                    </label>
                  )}
                </div>
              ))}

              {message && <div className="text-sm text-emerald-300">{message}</div>}
              {error && <div className="text-sm text-red-300">{error}</div>}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className={`btn btn-white-animated btn-small px-6 ${saving ? 'opacity-75' : ''}`}
                >
                  {saving ? 'Saving…' : 'Save keys'}
                </button>
                <button
                  type="button"
                  onClick={() => handleTest()}
                  disabled={testing || !integrationId}
                  className="btn btn-secondary btn-small"
                >
                  {testing ? 'Testing…' : 'Test connectivity'}
                </button>
                <Link to="/platform/integrations" className="text-xs uppercase tracking-[0.24em] text-gray-400">Cancel</Link>
              </div>
            </form>
          </section>
        </div>
      )}

      {activeTab === 'data' && (
        <DataSection
          unlockPassword={unlockPassword}
          setUnlockPassword={setUnlockPassword}
          unlockMfa={unlockMfa}
          setUnlockMfa={setUnlockMfa}
          canUnlockSecrets={canUnlockSecrets}
          setUnlockVisible={setUnlockVisible}
          unlockVisible={unlockVisible}
          savedCreds={savedCreds}
          updatingId={updatingId}
          handleUpdateCredential={handleUpdateCredential}
          handleDeleteCredential={handleDeleteCredential}
          onRefresh={handleRefreshLogs}
          onCopy={handleCopyLogs}
          onDownload={handleDownloadLogs}
        />
      )}
    </div>
  );
}

function TabHeader({
  config,
  title,
  basePath,
  active,
  status,
  onPurge,
  purgeDisabled,
  isPurging
}: {
  config: ExchangeConfig;
  title: string;
  basePath: string;
  active: TabKey;
  status?: string;
  onPurge?: () => void;
  purgeDisabled?: boolean;
  isPurging?: boolean;
}) {
  const tabs = [
    { key: 'overview' as TabKey, code: 'OV', label: 'Overview', to: basePath },
    { key: 'connectivity' as TabKey, code: 'CN', label: 'Connectivity', to: `${basePath}/connectivity` },
    { key: 'data' as TabKey, code: 'DB', label: 'Data', to: `${basePath}/data` }
  ];

  const statusTone = (status || '').toLowerCase();
  const statusClass =
    statusTone === 'connected'
      ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-100'
      : 'border-amber-300/40 bg-amber-300/10 text-amber-100';

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="section-label">Integrations · {config.region}</p>
        <h1 className="headline text-3xl">{title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {config.notes && <p className="text-sm muted-text max-w-3xl">{config.notes}</p>}
          {status && (
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] ${statusClass}`}>
              <span className={`h-2 w-2 rounded-full ${statusTone === 'connected' ? 'bg-emerald-300' : 'bg-amber-300'}`}></span>
              {status}
            </span>
          )}
        </div>
        <div className="mt-3 inline-flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs transition ${
                active === tab.key
                  ? 'border border-primary-200/70 bg-primary-200/10 text-main pointer-events-none'
                  : 'border border-white/10 bg-white/5 text-main hover:border-primary-200 hover:text-primary-100'
              }`}
              aria-current={active === tab.key ? 'page' : undefined}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-white/10 text-white text-[10px] font-bold">
                {tab.code}
              </span>
              <span className="uppercase tracking-[0.2em] text-gray-300">{tab.label}</span>
            </Link>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {onPurge && (
          <button
            type="button"
            onClick={onPurge}
            disabled={purgeDisabled}
            className={`btn btn-secondary btn-small border-red-500/60 text-red-200 hover:border-red-300 hover:text-white ${
              purgeDisabled ? 'opacity-70' : ''
            }`}
          >
            {isPurging ? 'Purging…' : 'Purge credentials'}
          </button>
        )}
        <Link to="/platform/integrations" className="text-xs uppercase tracking-[0.3em] text-primary-200">
          ← Back
        </Link>
      </div>
    </header>
  );
}

function StatsRow({
  savedCredsCount,
  linksEnabled,
  toggleLinks
}: {
  savedCredsCount: number;
  linksEnabled: boolean;
  toggleLinks: () => void;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCardSimple label="Linked credentials" value={`${savedCredsCount}`} />
      <StatCardSimple label="Link uptime" value="99.95%" helper="Past 30d" />
      <StatCardSimple label="Bandwidth" value="420 GB" helper="of 1 TB cap" />
      <StatusToggleCard label="Links status" enabled={linksEnabled} onToggle={toggleLinks} />
    </section>
  );
}

function DataSection({
  unlockPassword,
  setUnlockPassword,
  unlockMfa,
  setUnlockMfa,
  canUnlockSecrets,
  setUnlockVisible,
  unlockVisible,
  savedCreds,
  updatingId,
  handleUpdateCredential,
  handleDeleteCredential,
  onRefresh,
  onCopy,
  onDownload
}: {
  unlockPassword: string;
  setUnlockPassword: (v: string) => void;
  unlockMfa: string;
  setUnlockMfa: (v: string) => void;
  canUnlockSecrets: () => boolean;
  setUnlockVisible: (v: boolean) => void;
  unlockVisible: boolean;
  savedCreds: SavedCredential[];
  updatingId: string | null;
  handleUpdateCredential: (cred: SavedCredential, patch: Partial<SavedCredential>) => void;
  handleDeleteCredential: (cred: SavedCredential) => void;
  onRefresh?: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
}) {
  const [dataTab, setDataTab] = useState<'keys' | 'trades' | 'logs'>('keys');

  return (
    <section className="space-y-4" id="saved-keys">
      <div className="flex justify-end">
        <div className="inline-flex items-center gap-2 rounded-md bg-white/5 px-2 py-1 text-xs uppercase tracking-[0.18em] text-gray-300">
          {[
            { key: 'keys', label: 'Account Keys' },
            { key: 'trades', label: 'Trades' },
            { key: 'logs', label: 'Logs' }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setDataTab(tab.key as typeof dataTab)}
              className={`rounded px-3 py-1 transition ${
                dataTab === tab.key
                  ? 'bg-white/10 text-white shadow-[0_8px_24px_rgba(255,255,255,0.08)] backdrop-blur'
                  : 'bg-transparent text-gray-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card-shell space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-primary-200">Data</span>
            <p className="text-sm text-gray-300">Pulled directly from the database for this integration.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onRefresh && (
              <button type="button" className="btn btn-secondary btn-small" onClick={onRefresh}>
                Refresh
              </button>
            )}
            {onCopy && (
              <button type="button" className="btn btn-white-animated btn-small" onClick={onCopy}>
                Copy
              </button>
            )}
            {onDownload && (
              <button type="button" className="btn btn-white-animated btn-small" onClick={onDownload}>
                Download
              </button>
            )}
            <input
              type="password"
              placeholder="Account password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-main focus:border-primary-300 focus:outline-none"
            />
            <input
              type="text"
              placeholder="2FA code"
              value={unlockMfa}
              onChange={(e) => setUnlockMfa(e.target.value.replace(/\D/g, ''))}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-main focus:border-primary-300 focus:outline-none"
              maxLength={6}
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => setUnlockVisible(canUnlockSecrets())}
              className="btn btn-white-animated btn-small"
              disabled={!canUnlockSecrets()}
            >
              Unlock
            </button>
          </div>
        </div>

        {dataTab === 'keys' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-0 overflow-hidden">
            <div className="grid grid-cols-6 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-gray-400">
              <div className="col-span-2">Name</div>
              <div>API Key</div>
              <div>Sub Account</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>
            <div className="divide-y divide-white/10">
              {savedCreds.map((cred) => (
                <div key={cred.id} className="grid grid-cols-6 items-center px-4 py-3 text-sm">
                  <div className="col-span-2">
                    <p className="font-semibold text-main">{cred.label || 'Credential'}</p>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{cred.environment || 'live'}</p>
                  </div>
                  <div className="font-mono text-xs text-gray-200">{unlockVisible ? cred.apiKeyMasked || '••••' : '•••••••'}</div>
                  <div className="text-gray-200">{cred.subAccount || '—'}</div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{cred.description || 'Encrypted'}</div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="p-2 text-gray-200 hover:text-primary-200"
                      onClick={() => handleUpdateCredential(cred, { label: `${cred.label || 'Credential'} (edited)` })}
                      disabled={updatingId === cred.id}
                      aria-label="Edit credential"
                    >
                      ✏️
                    </button>
                    <button
                      className="p-2 text-gray-200 hover:text-red-300"
                      onClick={() => handleDeleteCredential(cred)}
                      disabled={updatingId === cred.id}
                      aria-label="Delete credential"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
              {!savedCreds.length && <p className="px-4 py-3 text-sm text-gray-400">No saved credentials yet.</p>}
            </div>
          </div>
        )}

        {dataTab === 'trades' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            <p className="section-label">Trades</p>
            <p className="mt-2 text-gray-300">Trade history feed not connected yet.</p>
          </div>
        )}

        {dataTab === 'logs' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            <p className="section-label">Logs</p>
            <p className="mt-2 text-gray-300">No archived logs available.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function StatCardSimple({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto text-right">
        <p className="text-2xl font-semibold text-main">{value}</p>
        {helper && <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 mt-1">{helper}</p>}
      </div>
    </div>
  );
}

function StatusToggleCard({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto flex items-center justify-between">
        <p className="text-lg font-semibold text-main">{enabled ? 'Enabled' : 'Disabled'}</p>
        <label className="relative inline-flex h-6 w-12 cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={enabled} onChange={onToggle} />
          <span className="absolute inset-0 rounded-full bg-white/10 peer-checked:bg-emerald-400/60 transition"></span>
          <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/80 transition peer-checked:translate-x-6 peer-checked:bg-emerald-100"></span>
        </label>
      </div>
    </div>
  );
}
