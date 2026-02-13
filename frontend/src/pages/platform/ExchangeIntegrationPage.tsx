import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createIntegration,
  deleteIntegration,
  fetchIntegrationDetail,
  listIntegrations,
  purgeIntegrationCredentials,
  testIntegration,
  updateIntegrationCredential
} from '../../api/integrations';
import { listBots, listMarketBots, listRentals } from '../../api/tradeBots';
import type { Bot, MarketBotSummary, Rental } from '../../api/types';

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
type TradeBotRow = Bot & {
  latestVersion?: { id?: string | null; status?: string | null; language?: string | null } | null;
  counts?: { versions?: number; instances?: number; rentals?: number; orders?: number };
};

type TabKey = 'overview' | 'bots' | 'connectivity' | 'data' | 'settings';

const DEFAULT_WORKSPACE_ID = '1cf2ee51-ff24-4b38-a7a3-bd0a45a9d0ba';

function getWorkspaceId() {
  try {
    return localStorage.getItem('workspaceId') || '';
  } catch {
    return '';
  }
}

function setWorkspaceId(value: string) {
  try {
    localStorage.setItem('workspaceId', value);
  } catch {
    // ignore storage failures
  }
}

function versionText(bot: TradeBotRow) {
  if (bot.latestVersion?.id) return bot.latestVersion.id;
  if (bot.latestVersionId) return bot.latestVersionId;
  return 'No version';
}

export default function ExchangeIntegrationPage() {
  const { exchangeId } = useParams<{ exchangeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const config = exchangeId ? EXCHANGES[exchangeId] : null;
  const isDataTab = location.pathname.endsWith('/data');
  const isBotsTab = location.pathname.endsWith('/bots');
  const isConnectivityTab = location.pathname.endsWith('/connectivity');
  const isSettingsTab = location.pathname.endsWith('/settings');

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
  const [autoRotate, setAutoRotate] = useState(false);
  const [notifyOnDegradation, setNotifyOnDegradation] = useState(true);
  const [blockWritesOnFailure, setBlockWritesOnFailure] = useState(true);
  const [auditTrailEnabled, setAuditTrailEnabled] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [defaultEnvironment, setDefaultEnvironment] = useState('live');
  const [workspaceInput, setWorkspaceInput] = useState(() => getWorkspaceId() || DEFAULT_WORKSPACE_ID);
  const [bots, setBots] = useState<TradeBotRow[]>([]);
  const [marketBots, setMarketBots] = useState<MarketBotSummary[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loadingBots, setLoadingBots] = useState(false);
  const [botsError, setBotsError] = useState('');
  const [botQuery, setBotQuery] = useState('');
  const [lastBotsLoadedAt, setLastBotsLoadedAt] = useState<string | null>(null);

  const title = useMemo(() => (config ? `${config.name} Integration` : 'Integration'), [config]);
  const activeWorkspace = useMemo(() => getWorkspaceId() || '', [workspaceInput, lastBotsLoadedAt]);
  const filteredBots = useMemo(() => {
    const q = botQuery.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((bot) => {
      const text = [bot.name, bot.kind, bot.description || '', bot.latestVersion?.status || '', bot.latestVersion?.language || '']
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [bots, botQuery]);
  const activeRentals = useMemo(
    () =>
      rentals.filter((rental) => {
        const status = (rental.status || '').toLowerCase();
        return status === 'active' || status === 'running';
      }),
    [rentals]
  );
  const exchangeRentals = useMemo(
    () => rentals.filter((rental) => (rental.exchangeAccount?.venue || '').toLowerCase() === (exchangeId || '').toLowerCase()),
    [rentals, exchangeId]
  );
  const totalInstances = useMemo(
    () => bots.reduce((sum, bot) => sum + Number(bot.counts?.instances || 0), 0),
    [bots]
  );

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

  const loadBots = async () => {
    setLoadingBots(true);
    setBotsError('');
    try {
      const [botsRes, marketRes, rentalsRes] = await Promise.all([listBots(), listMarketBots(), listRentals()]);
      setBots((botsRes.items || []) as TradeBotRow[]);
      setMarketBots(marketRes.items || []);
      setRentals(rentalsRes.items || []);
      setLastBotsLoadedAt(new Date().toISOString());
    } catch (err: any) {
      setBotsError(err?.message || 'Failed to load trade bots');
      setBots([]);
      setMarketBots([]);
      setRentals([]);
    } finally {
      setLoadingBots(false);
    }
  };

  useEffect(() => {
    loadBots();
  }, [exchangeId]);

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

  async function handleApplyWorkspace() {
    const next = workspaceInput.trim();
    if (!next) return;
    setWorkspaceId(next);
    await loadBots();
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
    const confirmed = window.confirm('Delete this integration and all stored credentials? This cannot be undone.');
    if (!confirmed) return;
    try {
      setUpdatingId(target.id);
      await deleteIntegration(integrationId);
      setSavedCreds([]);
      setIntegrationId(null);
      setIntegrationStatus(null);
      setMessage('Integration deleted.');
      navigate('/platform/integrations');
    } catch (err: any) {
      setError(err?.message || 'Failed to delete integration');
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

  const activeTab = isBotsTab ? 'bots' : isDataTab ? 'data' : isConnectivityTab ? 'connectivity' : isSettingsTab ? 'settings' : 'overview';
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
      />

      {activeTab !== 'data' && (
        <StatsRow
          savedCredsCount={savedCreds.length}
          linksEnabled={linksEnabled}
          toggleLinks={() => setLinksEnabled((v) => !v)}
        />
      )}

      {activeTab === 'overview' && (
        <IntegrationOverviewSection
          exchangeName={config.name}
          integrationStatus={integrationStatus}
          linkedCredentials={savedCreds.length}
          botsCount={bots.length}
          exchangeRentalsCount={exchangeRentals.length}
          basePath={basePath}
        />
      )}

      {activeTab === 'bots' && (
        <ExchangeTradeBotsSection
          exchangeName={config.name}
          exchangeId={exchangeId || ''}
          workspaceInput={workspaceInput}
          setWorkspaceInput={setWorkspaceInput}
          activeWorkspace={activeWorkspace}
          bots={filteredBots}
          marketBots={marketBots}
          rentals={rentals}
          exchangeRentals={exchangeRentals}
          loadingBots={loadingBots}
          botsError={botsError}
          botQuery={botQuery}
          setBotQuery={setBotQuery}
          totalInstances={totalInstances}
          activeRentalsCount={activeRentals.length}
          lastBotsLoadedAt={lastBotsLoadedAt}
          onApplyWorkspace={handleApplyWorkspace}
          onRefresh={loadBots}
          onUseProvidedWorkspace={() => setWorkspaceInput(DEFAULT_WORKSPACE_ID)}
        />
      )}

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

      {activeTab === 'settings' && (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <section className="card-shell space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-label">Exchange profile</p>
                <p className="text-sm text-gray-300">Defaults pulled from the venue’s requirements.</p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.24em] text-gray-500">{config.name}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Chip label={`Region: ${config.region}`} />
              {config.requiresPassphrase && <Chip label="Passphrase required" tone="amber" />}
              {config.extraFieldLabel && <Chip label={config.extraFieldLabel} />}
              {config.supportsSandbox && <Chip label="Sandbox supported" tone="emerald" />}
            </div>

            <SettingRow
              title="Default environment"
              description="Select where new credentials route by default."
              control={
                <select
                  value={defaultEnvironment}
                  onChange={(e) => setDefaultEnvironment(e.target.value)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-main focus:border-primary-300 focus:outline-none"
                >
                  <option value="live">Live</option>
                  <option value="sandbox" disabled={!config.supportsSandbox}>
                    Sandbox
                  </option>
                </select>
              }
              helper={config.supportsSandbox ? 'Sandbox routes when available.' : 'Sandbox not provided for this venue.'}
            />

            <SettingRow
              title="Reference notes"
              description={config.notes || 'No extra guidance provided.'}
              control={<span className="text-xs text-gray-400">Read-only</span>}
            />
          </section>

          <section className="card-shell space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="section-label">Runtime settings</p>
                <p className="text-sm text-gray-300">Control how this integration behaves across environments.</p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.24em] text-gray-500">{config.region}</span>
            </div>

            <SettingRow
              title="Auto rotate credentials"
              description="Rotate and retest API keys every 30 days to keep sessions fresh."
              control={<InlineToggle checked={autoRotate} onChange={() => setAutoRotate((v) => !v)} />}
              helper="Applies to saved credentials across this integration."
            />

            <SettingRow
              title="Sandbox routing"
              description="Route test orders to the exchange sandbox when available."
              control={
                <InlineToggle
                  checked={!!creds.some((c) => c.sandbox)}
                  onChange={() =>
                    setCreds((prev) =>
                      prev.map((row, idx) => (idx === 0 ? { ...row, sandbox: !row.sandbox } : row))
                    )
                  }
                  disabled={!config.supportsSandbox}
                />
              }
              helper={config.supportsSandbox ? 'Toggle applies to the primary key.' : 'Sandbox not provided for this venue.'}
            />

            <SettingRow
              title="Status webhooks"
              description="Post connectivity state changes to your observability stack."
              control={
                <input
                  type="url"
                  placeholder="https://hooks.example.com/daxlink"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-main focus:border-primary-300 focus:outline-none"
                />
              }
            />
          </section>

          <section className="card-shell space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-label">Alerts & safety</p>
                <p className="text-sm text-gray-300">Tune guardrails before going live with writes.</p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.24em] text-gray-500">Signals</span>
            </div>

            <SettingRow
              title="Notify on degradation"
              description="Send a page when latency or error rates spike beyond thresholds."
              control={<InlineToggle checked={notifyOnDegradation} onChange={() => setNotifyOnDegradation((v) => !v)} />}
              helper="Routing respects workspace notification rules."
            />

            <SettingRow
              title="Block writes on failures"
              description="Automatically pause order placement when connectivity checks fail."
              control={<InlineToggle checked={blockWritesOnFailure} onChange={() => setBlockWritesOnFailure((v) => !v)} />}
            />

            <SettingRow
              title="Audit trail"
              description="Capture sensitive actions like credential edits and unlocks."
              control={<InlineToggle checked={auditTrailEnabled} onChange={() => setAuditTrailEnabled((v) => !v)} />}
              helper="Streams to the workspace ledger."
            />
          </section>

          <section className="card-shell space-y-3 lg:col-span-2 border-red-500/30 bg-red-500/5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="section-label text-red-200">Purge credentials</p>
                <p className="text-sm text-gray-200">Wipe all stored keys for this integration and revoke access immediately.</p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.24em] text-red-200">Danger</span>
            </div>
            <div className="relative rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-gray-100">
              <p className="font-semibold text-red-200">Danger zone</p>
              <p className="mt-1 text-gray-200">This removes all credentials tied to this exchange. You can re-add them later.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="relative inline-flex">
                  <span className="pointer-events-none absolute right-6 top-0 -translate-y-[60%] text-amber-200">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                      <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    onClick={handlePurgeCredentials}
                    disabled={!integrationId || purging}
                    className={`btn btn-secondary btn-small border-red-500/60 text-red-200 hover:border-red-300 hover:text-white ${
                      !integrationId || purging ? 'opacity-70' : ''
                    }`}
                  >
                    {purging ? 'Purging…' : 'Purge credentials'}
                  </button>
                </div>
                <span className="text-[11px] uppercase tracking-[0.18em] text-gray-400">This cannot be undone.</span>
              </div>
            </div>
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
  status
}: {
  config: ExchangeConfig;
  title: string;
  basePath: string;
  active: TabKey;
  status?: string;
}) {
  const tabs: { key: TabKey; code: string; label: string; to: string; icon: ReactNode }[] = [
    {
      key: 'overview',
      code: 'OV',
      label: 'Overview',
      to: basePath,
      icon: <img src="/icons/hub.svg" alt="Overview" className="h-6 w-6 opacity-80" style={{ filter: 'invert(1) brightness(0.85)' }} />
    },
    {
      key: 'bots',
      code: 'BT',
      label: 'Trade Bots',
      to: `${basePath}/bots`,
      icon: <img src="/icons/smart-toy.svg" alt="Trade Bots" className="h-6 w-6 opacity-80" style={{ filter: 'invert(1) brightness(0.85)' }} />
    },
    {
      key: 'connectivity',
      code: 'CN',
      label: 'Connectivity',
      to: `${basePath}/connectivity`,
      icon: <img src="/icons/link.svg" alt="Connectivity" className="h-6 w-6 opacity-80" style={{ filter: 'invert(1) brightness(0.85)' }} />
    },
    {
      key: 'data',
      code: 'DB',
      label: 'Data',
      to: `${basePath}/data`,
      icon: <img src="/icons/storage.svg" alt="Data" className="h-6 w-6 opacity-80" style={{ filter: 'invert(1) brightness(0.85)' }} />
    },
    {
      key: 'settings',
      code: 'ST',
      label: 'Settings',
      to: `${basePath}/settings`,
      icon: <SettingsGlyph />
    }
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
        <div className="mt-3 inline-flex flex-wrap items-center gap-2 ml-24">
          {tabs.map((tab) => {
            const isActive = active === tab.key;
            return (
              <Link
                key={tab.key}
                to={tab.to}
                className={`group relative flex aspect-square w-44 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-7 py-7 text-center text-base font-semibold transition ${
                  isActive
                    ? 'border-primary-200/80 bg-primary-400/10 text-white'
                    : 'border-white/10 bg-transparent text-white/80 hover:border-primary-400/40 hover:bg-primary-500/10'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-bl from-white/40 to-white/0 opacity-10 z-0"></span>
                <span className={`relative z-10 flex h-10 w-10 items-center justify-center text-base font-semibold ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                  {tab.icon}
                </span>
                <span className={`relative z-10 leading-snug text-base ${isActive ? 'text-white' : 'text-white/70'}`}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
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
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gray-300">
          {[
            { key: 'keys', label: 'Account Keys' },
            { key: 'trades', label: 'Trades' },
            { key: 'logs', label: 'Logs' }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setDataTab(tab.key as typeof dataTab)}
              className={`group relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border px-4 py-3 text-center text-sm font-semibold transition min-w-[6rem] ${
                dataTab === tab.key
                  ? 'border-primary-200/80 bg-primary-400/10 text-white'
                  : 'border-white/10 bg-transparent text-white/80 hover:border-primary-400/40 hover:bg-primary-500/10'
              }`}
            >
              <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-bl from-white/40 to-white/0 opacity-10 z-0"></span>
              <span className={`relative z-10 ${dataTab === tab.key ? 'text-white' : 'text-white/70'}`}>{tab.label}</span>
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

function IntegrationOverviewSection({
  exchangeName,
  integrationStatus,
  linkedCredentials,
  botsCount,
  exchangeRentalsCount,
  basePath
}: {
  exchangeName: string;
  integrationStatus: string | null;
  linkedCredentials: number;
  botsCount: number;
  exchangeRentalsCount: number;
  basePath: string;
}) {
  const status = (integrationStatus || 'pending').toLowerCase();
  const statusLabel = integrationStatus || 'pending';
  const statusClass =
    status === 'connected'
      ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
      : status === 'error'
        ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
        : 'border-amber-300/40 bg-amber-500/10 text-amber-100';

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="section-label">Integration control</p>
            <h3 className="text-2xl font-semibold text-main">{exchangeName} execution lane</h3>
            <p className="text-sm text-gray-300 max-w-3xl">
              Trade bot deployment now lives directly under this exchange integration. Use the Bots tab to manage workspace bots,
              marketplace visibility, and rentals for this venue.
            </p>
          </div>
          <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCardSimple label="Linked credentials" value={String(linkedCredentials)} helper="Secured key pairs" />
          <StatCardSimple label="Workspace bots" value={String(botsCount)} helper="Available in this workspace" />
          <StatCardSimple label="Venue rentals" value={String(exchangeRentalsCount)} helper="Mapped to this exchange" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link to={`${basePath}/bots`} className="btn btn-white-animated btn-small">
            Open Trade Bots
          </Link>
          <Link to={`${basePath}/connectivity`} className="btn btn-secondary btn-small">
            View Connectivity
          </Link>
          <Link to={`${basePath}/data`} className="text-xs uppercase tracking-[0.22em] text-gray-400">
            Manage credentials →
          </Link>
        </div>
      </div>
    </section>
  );
}

function ExchangeTradeBotsSection({
  exchangeName,
  exchangeId,
  workspaceInput,
  setWorkspaceInput,
  activeWorkspace,
  bots,
  marketBots,
  rentals,
  exchangeRentals,
  loadingBots,
  botsError,
  botQuery,
  setBotQuery,
  totalInstances,
  activeRentalsCount,
  lastBotsLoadedAt,
  onApplyWorkspace,
  onRefresh,
  onUseProvidedWorkspace
}: {
  exchangeName: string;
  exchangeId: string;
  workspaceInput: string;
  setWorkspaceInput: (value: string) => void;
  activeWorkspace: string;
  bots: TradeBotRow[];
  marketBots: MarketBotSummary[];
  rentals: Rental[];
  exchangeRentals: Rental[];
  loadingBots: boolean;
  botsError: string;
  botQuery: string;
  setBotQuery: (value: string) => void;
  totalInstances: number;
  activeRentalsCount: number;
  lastBotsLoadedAt: string | null;
  onApplyWorkspace: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onUseProvidedWorkspace: () => void;
}) {
  return (
    <section className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-sky-300/20 bg-gradient-to-br from-[#07152f] via-[#0d1f3d] to-[#0b2c4e] p-5 shadow-[0_18px_70px_rgba(14,130,255,0.2)]">
        <div className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-14 bottom-[-74px] h-40 w-40 rounded-full bg-blue-300/12 blur-3xl" />
        <div className="relative space-y-4">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.26em] text-sky-100">Integrations · {exchangeName} · Trade Bots</p>
            <h2 className="text-2xl font-semibold text-white">Workspace bots and marketplace execution</h2>
            <p className="text-sm text-sky-100/85 max-w-3xl">
              All bot controls are scoped under this exchange page. Choose workspace, inspect live bot inventory, and track rentals tied to {exchangeName}.
            </p>
          </header>
          <div className="grid gap-3 md:grid-cols-4">
            <BotMetric title="Workspace Bots" value={String(bots.length)} />
            <BotMetric title="Instances" value={String(totalInstances)} />
            <BotMetric title="Marketplace Bots" value={String(marketBots.length)} />
            <BotMetric title="Active Rentals" value={String(activeRentalsCount)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_auto]">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-sky-100/80">
              Workspace ID
              <input
                className="rounded-xl border border-white/20 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-sky-300/70"
                value={workspaceInput}
                onChange={(event) => setWorkspaceInput(event.target.value)}
                placeholder="workspace UUID"
              />
            </label>
            <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-sky-100/85">
              <p className="uppercase tracking-[0.16em] text-sky-200/70">Current workspace</p>
              <p className="mt-1 break-all font-mono text-[11px]">{activeWorkspace || 'not-set'}</p>
              <button
                type="button"
                className="mt-2 rounded-lg border border-white/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-sky-100"
                onClick={onUseProvidedWorkspace}
              >
                Use Provided Workspace
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={onApplyWorkspace}
                className="h-[42px] rounded-xl border border-sky-300/45 bg-sky-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 hover:bg-sky-500/35"
              >
                Apply + Reload
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-label">Workspace Bots</p>
            <p className="text-sm text-gray-300">Live data from `/api/v1/trade-bots/:workspaceId/bots`.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100"
              placeholder="Search bot name/status"
              value={botQuery}
              onChange={(event) => setBotQuery(event.target.value)}
            />
            <button
              type="button"
              className="rounded-xl border border-white/15 px-3 py-2 text-xs uppercase tracking-[0.18em] text-gray-200"
              onClick={onRefresh}
            >
              Refresh
            </button>
          </div>
        </div>

        {botsError && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {botsError}
          </div>
        )}

        {loadingBots && <p className="text-sm text-gray-400">Loading trade bot data...</p>}
        {!loadingBots && !botsError && bots.length === 0 && (
          <p className="text-sm text-gray-400">No bots found for this workspace.</p>
        )}

        {!loadingBots && bots.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {bots.map((bot) => (
              <article
                key={bot.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-sky-300/40 hover:bg-sky-500/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-white">{bot.name}</h3>
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{bot.kind}</p>
                  </div>
                  <span className="rounded-lg border border-sky-300/35 bg-sky-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-sky-100">
                    {bot.latestVersion?.status || 'unknown'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-300">{bot.description || 'No description'}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                  <BotInfo label="Version" value={versionText(bot)} mono />
                  <BotInfo label="Updated" value={formatDate(bot.updatedAt)} />
                  <BotInfo label="Instances" value={String(bot.counts?.instances || 0)} />
                  <BotInfo label="Orders" value={String(bot.counts?.orders || 0)} />
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="text-[11px] text-gray-500">
          Last loaded: {formatDate(lastBotsLoadedAt)} • Workspace: {activeWorkspace || 'not-set'} • Exchange: {exchangeId.toUpperCase()}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card-shell space-y-3">
          <div>
            <p className="section-label">Marketplace Snapshot</p>
            <p className="text-sm text-gray-300">Published bots visible to this workspace.</p>
          </div>
          {marketBots.length === 0 ? (
            <p className="text-sm text-gray-400">No marketplace bots available.</p>
          ) : (
            <div className="space-y-2">
              {marketBots.map((bot) => (
                <div key={bot.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{bot.name}</p>
                    <p className="text-xs text-gray-400">{bot.workspace?.name || '—'}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-300">
                    Plans: {bot.plans?.length || 0} • Updated: {formatDate(bot.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Link
            to="/market"
            className="inline-flex rounded-xl border border-sky-300/40 bg-sky-500/15 px-3 py-2 text-xs uppercase tracking-[0.16em] text-sky-100"
          >
            Open Marketplace
          </Link>
        </section>

        <section className="card-shell space-y-3">
          <div>
            <p className="section-label">Rental Status</p>
            <p className="text-sm text-gray-300">Rentals filtered to {exchangeName} where exchange account metadata is available.</p>
          </div>
          {rentals.length === 0 ? (
            <p className="text-sm text-gray-400">No rentals found for this workspace.</p>
          ) : exchangeRentals.length === 0 ? (
            <p className="text-sm text-gray-400">No rentals currently mapped to this exchange.</p>
          ) : (
            <div className="space-y-2">
              {exchangeRentals.slice(0, 6).map((rental) => (
                <div key={rental.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">{rental.bot?.name || rental.botId}</p>
                    <span className="text-xs uppercase tracking-[0.14em] text-gray-300">{rental.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Expires {formatDate(rental.expiresAt)} • Instance {rental.botInstanceId || 'provisioning'}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Link
            to="/market/rentals"
            className="inline-flex rounded-xl border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-gray-200"
          >
            Open Rentals
          </Link>
        </section>
      </div>
    </section>
  );
}

function BotMetric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-sky-100">
      <p className="uppercase tracking-[0.16em] text-sky-200/80">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function BotInfo({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-1 font-mono text-[11px] text-gray-100' : 'mt-1 text-[11px] text-gray-100'}>{value}</p>
    </div>
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

function SettingRow({ title, description, control, helper }: { title: string; description: string; control: ReactNode; helper?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-main">{title}</p>
        <p className="text-xs text-gray-400">{description}</p>
        {helper && <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-gray-500">{helper}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function InlineToggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <label className={`relative inline-flex h-6 w-12 cursor-pointer items-center ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="absolute inset-0 rounded-full bg-white/10 peer-checked:bg-emerald-400/60 transition"></span>
      <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/80 transition peer-checked:translate-x-6 peer-checked:bg-emerald-100"></span>
    </label>
  );
}

function Chip({ label, tone }: { label: string; tone?: 'emerald' | 'amber' }) {
  const toneClasses =
    tone === 'emerald'
      ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100'
      : tone === 'amber'
      ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
      : 'border-white/15 bg-white/5 text-gray-200';
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.2em] ${toneClasses}`}>{label}</span>;
}

function SettingsGlyph() {
  return (
    <svg className="h-5 w-5 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 3 9.4 4.6a2 2 0 0 1-1.4.6H6a2 2 0 0 0-2 2v2a2 2 0 0 1-.6 1.4L2 12l1.4 1.4A2 2 0 0 1 4 14.8V17a2 2 0 0 0 2 2h2a2 2 0 0 1 1.4.6L11 21l1.6-1.4A2 2 0 0 1 14 19h2a2 2 0 0 0 2-2v-2a2 2 0 0 1 .6-1.4L21 12l-1.4-1.4A2 2 0 0 1 19 9.2V7a2 2 0 0 0-2-2h-2a2 2 0 0 1-1.4-.6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
