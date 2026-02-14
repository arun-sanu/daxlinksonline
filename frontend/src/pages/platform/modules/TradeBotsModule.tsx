import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBots, listExchangeAccounts, listRentals } from '../../../api/tradeBots';
import { assignWebhook, getMyWebhook, type MyWebhookResponse } from '../../../api/webhooks';
import { listIntegrations, testIntegration, type Integration } from '../../../api/integrations';
import type { Bot, ExchangeAccount, Rental } from '../../../api/types';

type TradeBotRow = Bot & {
  latestVersion?: { id?: string | null; status?: string | null; language?: string | null } | null;
  counts?: { versions?: number; instances?: number; rentals?: number; orders?: number };
};

type TabKey = 'overview' | 'bots' | 'marketplace' | 'rentals' | 'logs-reports';

const DEFAULT_WORKSPACE_ID = '1cf2ee51-ff24-4b38-a7a3-bd0a45a9d0ba';
const BOT_LINKS_STORAGE_KEY = 'dax_trade_bot_links_v1';
const BOT_CANONICAL_NAME = 'moneyplantbot1-robot';

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

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function versionText(bot: TradeBotRow) {
  if (bot.latestVersion?.id) return bot.latestVersion.id;
  if (bot.latestVersionId) return bot.latestVersionId;
  return 'No version';
}

type BotConnectivityLink = {
  webhookUrl?: string | null;
  integrationId?: string | null;
  exchangeAccountId?: string | null;
  updatedAt?: string | null;
};

function readBotLinks(): Record<string, BotConnectivityLink> {
  try {
    const raw = localStorage.getItem(BOT_LINKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeBotLinks(next: Record<string, BotConnectivityLink>) {
  try {
    localStorage.setItem(BOT_LINKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

function normalizeBotName(name: string) {
  if (String(name || '').trim().toLowerCase() === 'trade-exec-bot') {
    return BOT_CANONICAL_NAME;
  }
  return name;
}

function collectWebhookUrls(profile: MyWebhookResponse | null): string[] {
  if (!profile) return [];
  const values = new Set<string>();
  if (profile.url) values.add(String(profile.url));
  for (const record of profile.dnsRecords || []) {
    if (record?.url) values.add(String(record.url));
  }
  return Array.from(values);
}

function normalizeConnectionText(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function integrationIsHealthy(status?: string | null) {
  const text = normalizeConnectionText(status);
  if (!text) return false;
  if (['failed', 'error', 'disabled', 'disconnected', 'revoked', 'invalid'].some((token) => text.includes(token))) {
    return false;
  }
  return ['ok', 'connected', 'active', 'enabled', 'healthy', 'ready', 'success'].some((token) => text.includes(token));
}

function connectivityBadgeClass(connected: boolean) {
  return connected ? 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100' : 'border-amber-300/30 bg-amber-500/15 text-amber-100';
}

function estimatedBandwidthKbps(bot: TradeBotRow | null, connectedEndpoints: number) {
  if (!bot || connectedEndpoints <= 0) return '0.0 kbps';
  const instances = Number(bot.counts?.instances || 0);
  const orders = Number(bot.counts?.orders || 0);
  const estimate = 8 + instances * 5.5 + Math.min(orders, 1000) * 0.08 + connectedEndpoints * 2.3;
  return `${estimate.toFixed(1)} kbps`;
}

export default function TradeBotsModule() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [bots, setBots] = useState<TradeBotRow[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [botsError, setBotsError] = useState('');
  const [rentalsError, setRentalsError] = useState('');
  const [query, setQuery] = useState('');
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [selectedBot, setSelectedBot] = useState<TradeBotRow | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [webhookProfile, setWebhookProfile] = useState<MyWebhookResponse | null>(null);
  const [exchangeAccounts, setExchangeAccounts] = useState<ExchangeAccount[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [testingIntegrationId, setTestingIntegrationId] = useState<string | null>(null);
  const [botLinks, setBotLinks] = useState<Record<string, BotConnectivityLink>>(() => readBotLinks());

  const selectedBotLink = useMemo<BotConnectivityLink>(() => {
    if (!selectedBot) return {};
    return botLinks[selectedBot.id] || {};
  }, [botLinks, selectedBot]);

  const webhookUrls = useMemo(() => collectWebhookUrls(webhookProfile), [webhookProfile]);

  const linkedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === selectedBotLink.integrationId) || null,
    [integrations, selectedBotLink.integrationId]
  );

  const linkedExchangeAccount = useMemo(
    () => exchangeAccounts.find((account) => account.id === selectedBotLink.exchangeAccountId) || null,
    [exchangeAccounts, selectedBotLink.exchangeAccountId]
  );

  const tradingViewConnected = useMemo(() => {
    if (!selectedBotLink.webhookUrl) return false;
    return webhookUrls.includes(selectedBotLink.webhookUrl);
  }, [selectedBotLink.webhookUrl, webhookUrls]);

  const exchangeConnected = useMemo(() => integrationIsHealthy(linkedIntegration?.status), [linkedIntegration?.status]);

  const connectedEndpoints = Number(tradingViewConnected) + Number(exchangeConnected);
  const connectivityBandwidth = estimatedBandwidthKbps(selectedBot, connectedEndpoints);
  const overallConnectivityStatus = connectedEndpoints === 2 ? 'connected' : connectedEndpoints === 1 ? 'partial' : 'disconnected';

  const filteredBots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter((bot) => {
      const text = [bot.name, bot.kind, bot.description || '', bot.latestVersion?.status || '', bot.latestVersion?.language || '']
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  }, [bots, query]);

  const totalInstances = useMemo(
    () => bots.reduce((sum, bot) => sum + Number(bot.counts?.instances || 0), 0),
    [bots]
  );

  const activeRentals = useMemo(
    () =>
      rentals.filter((rental) => {
        const status = (rental.status || '').toLowerCase();
        return status === 'active' || status === 'running';
      }),
    [rentals]
  );

  const load = async () => {
    const ws = getWorkspaceId().trim() || DEFAULT_WORKSPACE_ID;
    setWorkspaceId(ws);
    setLoading(true);
    setBotsError('');
    setRentalsError('');
    const [botsResult, rentalsResult] = await Promise.allSettled([listBots(), listRentals()]);

    if (botsResult.status === 'fulfilled') {
      const nextBots = (botsResult.value.items || []).map((bot) => ({
        ...bot,
        name: normalizeBotName(bot.name)
      })) as TradeBotRow[];
      setBots(nextBots);
    } else {
      setBots([]);
      setBotsError(botsResult.reason?.message || 'Failed to load workspace bots.');
    }

    if (rentalsResult.status === 'fulfilled') {
      setRentals(rentalsResult.value.items || []);
    } else {
      setRentals([]);
      setRentalsError(rentalsResult.reason?.message || 'Failed to load rentals.');
    }

    setLastLoadedAt(new Date().toISOString());
    setLoading(false);
  };

  useEffect(() => {
    const existing = getWorkspaceId();
    const ws = existing || DEFAULT_WORKSPACE_ID;
    if (!existing) {
      setWorkspaceId(ws);
    }
    load();
  }, []);

  const upsertBotLink = (botId: string, patch: BotConnectivityLink) => {
    setBotLinks((prev) => {
      const next = {
        ...prev,
        [botId]: {
          ...(prev[botId] || {}),
          ...patch,
          updatedAt: new Date().toISOString()
        }
      };
      writeBotLinks(next);
      return next;
    });
  };

  const openBotPopup = (bot: TradeBotRow) => {
    setSelectedBot(bot);
    setModalError('');
    setModalMessage('');
  };

  const closeBotPopup = () => {
    setSelectedBot(null);
    setModalError('');
    setModalMessage('');
    setWebhookProfile(null);
    setExchangeAccounts([]);
    setIntegrations([]);
    setTestingIntegrationId(null);
  };

  const loadConnectivityContext = async (botId?: string) => {
    if (!botId) return;
    setModalLoading(true);
    setModalError('');
    const [webhookRes, accountsRes, integrationsRes] = await Promise.allSettled([
      getMyWebhook(),
      listExchangeAccounts(),
      listIntegrations()
    ]);

    if (webhookRes.status === 'fulfilled') {
      setWebhookProfile(webhookRes.value || null);
    } else {
      setWebhookProfile(null);
    }

    if (accountsRes.status === 'fulfilled') {
      setExchangeAccounts((accountsRes.value.items || []) as ExchangeAccount[]);
    } else {
      setExchangeAccounts([]);
    }

    if (integrationsRes.status === 'fulfilled') {
      setIntegrations((integrationsRes.value || []) as Integration[]);
    } else {
      setIntegrations([]);
    }

    if (
      webhookRes.status === 'rejected' &&
      accountsRes.status === 'rejected' &&
      integrationsRes.status === 'rejected'
    ) {
      setModalError('Failed to load connectivity data.');
    }

    setModalLoading(false);
  };

  useEffect(() => {
    if (!selectedBot) return;
    loadConnectivityContext(selectedBot.id);
  }, [selectedBot?.id]);

  useEffect(() => {
    if (activeTab !== 'bots') {
      setSelectedBot(null);
      setModalError('');
      setModalMessage('');
      setWebhookProfile(null);
      setExchangeAccounts([]);
      setIntegrations([]);
      setTestingIntegrationId(null);
    }
  }, [activeTab]);

  const handleRefreshConnectivity = async () => {
    if (!selectedBot) return;
    await loadConnectivityContext(selectedBot.id);
  };

  const handleAssignIngress = async () => {
    if (!selectedBot) return;
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const assigned = await assignWebhook();
      setWebhookProfile(assigned);
      const urls = collectWebhookUrls(assigned);
      if (urls.length > 0) {
        upsertBotLink(selectedBot.id, { webhookUrl: urls[0] });
      }
      setModalMessage(urls.length > 0 ? 'TradingView ingress assigned and linked.' : 'TradingView ingress assigned.');
    } catch (error: any) {
      setModalError(error?.message || 'Failed to assign TradingView ingress.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleVerifyIngress = async () => {
    if (!selectedBot) return;
    setModalLoading(true);
    setModalError('');
    setModalMessage('');
    try {
      const profile = await getMyWebhook();
      const urls = collectWebhookUrls(profile);
      setWebhookProfile(profile);
      if (selectedBotLink.webhookUrl && urls.includes(selectedBotLink.webhookUrl)) {
        setModalMessage('TradingView ingress link is valid.');
      } else {
        setModalError('Linked TradingView ingress URL is not currently assigned.');
      }
    } catch (error: any) {
      setModalError(error?.message || 'Failed to verify TradingView ingress.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleLinkWebhook = (url: string) => {
    if (!selectedBot) return;
    upsertBotLink(selectedBot.id, { webhookUrl: url });
    setModalError('');
    setModalMessage('TradingView ingress linked.');
  };

  const handleLinkIntegration = (integrationId: string) => {
    if (!selectedBot) return;
    upsertBotLink(selectedBot.id, { integrationId });
    setModalError('');
    setModalMessage('Exchange integration linked.');
  };

  const handleLinkExchangeAccount = (exchangeAccountId: string) => {
    if (!selectedBot) return;
    upsertBotLink(selectedBot.id, { exchangeAccountId });
    setModalError('');
    setModalMessage('Exchange account linked.');
  };

  const handleTestIntegration = async (integrationId: string) => {
    if (!selectedBot) return;
    setTestingIntegrationId(integrationId);
    setModalError('');
    setModalMessage('');
    try {
      const result = await testIntegration(integrationId);
      upsertBotLink(selectedBot.id, { integrationId });
      setIntegrations((prev) =>
        prev.map((integration) =>
          integration.id === integrationId
            ? {
                ...integration,
                status: result.status || integration.status,
                lastTestedAt: result.rotatedAt || new Date().toISOString()
              }
            : integration
        )
      );
      setModalMessage(`Connectivity check finished with status: ${result.status}.`);
      const refreshed = await listIntegrations();
      setIntegrations((refreshed || []) as Integration[]);
    } catch (error: any) {
      setModalError(error?.message || 'Exchange connectivity check failed.');
    } finally {
      setTestingIntegrationId(null);
    }
  };

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '/icons/hub.svg' },
    { key: 'bots', label: 'Bots', icon: '/icons/smart-toy.svg' },
    { key: 'marketplace', label: 'Marketplace', icon: '/icons/account-balance.svg' },
    { key: 'rentals', label: 'Rentals', icon: '/icons/route.svg' },
    { key: 'logs-reports', label: 'Logs + Reports', icon: '/icons/hub.svg' }
  ];

  return (
    <div className="trade-bots-page space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="section-label">Trade Bots · Global</p>
            <p className="text-sm text-gray-300 max-w-3xl">
              Workspace bots, marketplace listings, and rentals in the same visual language as exchange integration pages.
            </p>
          </div>
          <Link to="/platform" className="text-xs uppercase tracking-[0.3em] text-primary-200">
            ← Back
          </Link>
        </div>

        <div className="mt-3 inline-flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`group relative flex aspect-square w-40 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-5 py-5 text-center text-base font-semibold transition ${
                  isActive
                    ? 'border-primary-200/80 bg-primary-400/10 text-white'
                    : 'border-white/10 bg-transparent text-white/80 hover:border-primary-400/40 hover:bg-primary-500/10'
                }`}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-bl from-white/40 to-white/0 opacity-10 z-0"></span>
                <span className={`relative z-10 flex h-10 w-10 items-center justify-center ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                  <img src={tab.icon} alt="" className="h-6 w-6" style={{ filter: 'invert(1) brightness(0.85)' }} />
                </span>
                <span className={`relative z-10 leading-snug text-base ${isActive ? 'text-white' : 'text-white/70'}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {botsError && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{botsError}</div>}
      {rentalsError && <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-200">{rentalsError}</div>}

      {activeTab === 'overview' && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Bots" value={String(bots.length)} helper="Loaded bots" />
            <MetricCard label="Instances" value={String(totalInstances)} helper="Across versions" />
            <MetricCard label="Rentals" value={String(rentals.length)} helper="Active + historical" />
            <StatusToggleCard label="Automation Status" enabled={automationEnabled} onToggle={() => setAutomationEnabled((v) => !v)} />
          </div>
          <ConnectivityMindmap bots={bots} />
        </section>
      )}

      {activeTab === 'bots' && (
        <section className="card-shell space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-label">Control Plane</p>
                <h3 className="text-xl font-semibold text-main">Trade bot operations summary</h3>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={load}>
                Refresh
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <StatCard label="Active rentals" value={String(activeRentals.length)} />
              <StatCard label="Last loaded" value={formatDate(lastLoadedAt)} />
              <StatCard label="Automation" value={automationEnabled ? 'enabled' : 'disabled'} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Bots</p>
              <p className="text-sm text-gray-300">Monitor versions, instances, and execution readiness. Click any bot to configure connectivity.</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100"
                placeholder="Search bot name/status"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" className="btn btn-secondary btn-small" onClick={load}>
                Refresh
              </button>
            </div>
          </div>

          {loading && <p className="text-sm text-gray-400">Loading trade bot data...</p>}
          {!loading && filteredBots.length === 0 && !botsError && <p className="text-sm text-gray-400">No bots found.</p>}
          {!loading && filteredBots.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {filteredBots.map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => openBotPopup(bot)}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-300/40 hover:bg-primary-500/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-left text-lg font-semibold text-white">{bot.name}</h3>
                      <p className="text-xs uppercase tracking-[0.16em] text-gray-400">{bot.kind}</p>
                    </div>
                    <span className="rounded-lg border border-primary-300/35 bg-primary-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-primary-100">
                      {bot.latestVersion?.status || 'unknown'}
                    </span>
                  </div>
                  <p className="mt-2 text-left text-sm text-gray-300">{bot.description || 'No description'}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                    <InfoTile label="Version" value={versionText(bot)} mono />
                    <InfoTile label="Updated" value={formatDate(bot.updatedAt)} />
                    <InfoTile label="Instances" value={String(bot.counts?.instances || 0)} />
                    <InfoTile label="Orders" value={String(bot.counts?.orders || 0)} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'marketplace' && (
        <section className="card-shell space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Marketplace</p>
              <p className="text-sm text-gray-300">Marketplace is managed on its dedicated page.</p>
            </div>
            <Link to="/market" className="btn btn-white-animated btn-small">
              Open Marketplace
            </Link>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            Open <span className="text-primary-200">Market</span> to browse and rent published bots.
          </div>
        </section>
      )}

      {activeTab === 'rentals' && (
        <section className="card-shell space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Rental Status</p>
              <p className="text-sm text-gray-300">Active and historical workspace rentals.</p>
            </div>
            <Link to="/market/rentals" className="btn btn-white-animated btn-small">
              Open Rentals
            </Link>
          </div>
          {loading && <p className="text-sm text-gray-400">Loading rentals...</p>}
          {!loading && rentals.length === 0 && <p className="text-sm text-gray-400">No rentals found.</p>}
          {!loading && rentals.length > 0 && (
            <div className="space-y-2">
              {rentals.slice(0, 10).map((rental) => (
                <div key={rental.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-white">{normalizeBotName(rental.bot?.name || rental.botId)}</p>
                    <span className="text-xs uppercase tracking-[0.14em] text-gray-300">{rental.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Plan {rental.plan?.name || rental.planId} • Expires {formatDate(rental.expiresAt)}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">Instance {rental.botInstanceId || 'provisioning'}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'logs-reports' && (
        <section className="card-shell space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Logs And Reports</p>
              <p className="text-sm text-gray-300">Open execution telemetry and sizing reports for diagnostics.</p>
            </div>
            <button type="button" className="btn btn-secondary btn-small" onClick={load}>
              Refresh
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Link to="/platform/orders/reports" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 hover:border-primary-300/40">
              Signal/Exchange Reports
            </Link>
            <Link to="/platform/orders/sizing/details" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 hover:border-primary-300/40">
              Sizing Details
            </Link>
            <Link to="/platform/orders/sizing/reports" className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-200 hover:border-primary-300/40">
              Sizing Reports
            </Link>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
            Last sync: {formatDate(lastLoadedAt)} {botsError || rentalsError ? '• check alert banners for fetch errors.' : '• no load errors detected.'}
          </div>
        </section>
      )}

      {selectedBot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-5 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={closeBotPopup}>
          <div
            className="w-full max-w-6xl overflow-hidden rounded-3xl border border-white/20 bg-white/[0.07] shadow-[0_40px_100px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <p className="section-label">Bot Connectivity</p>
                <h3 className="text-2xl font-semibold text-main">{selectedBot.name}</h3>
                <p className="mt-1 text-xs text-gray-300">Link TradingView ingress and exchange connections, then run connectivity checks.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={closeBotPopup}>
                Close
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              {modalError && <div className="rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{modalError}</div>}
              {modalMessage && <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{modalMessage}</div>}

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Connectivity status</p>
                  <p className="mt-2 text-lg font-semibold text-white">{overallConnectivityStatus}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Connectivity bandwidth</p>
                  <p className="mt-2 text-lg font-semibold text-white">{connectivityBandwidth}</p>
                  <p className="text-[11px] text-gray-400">estimated telemetry</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">TradingView</p>
                  <span className={`mt-2 inline-flex rounded-lg border px-2 py-1 text-xs uppercase tracking-[0.14em] ${connectivityBadgeClass(tradingViewConnected)}`}>
                    {tradingViewConnected ? 'connected' : 'not linked'}
                  </span>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Exchange</p>
                  <span className={`mt-2 inline-flex rounded-lg border px-2 py-1 text-xs uppercase tracking-[0.14em] ${connectivityBadgeClass(exchangeConnected)}`}>
                    {exchangeConnected ? linkedIntegration?.exchange || 'connected' : 'not linked'}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-3">
                <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">TradingView ingress</p>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleAssignIngress} disabled={modalLoading}>
                      Assign
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Available webhook URLs for TradingView alerts.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
                    {webhookUrls.length === 0 && <p className="text-xs text-gray-400">No ingress URLs assigned yet.</p>}
                    {webhookUrls.map((url) => {
                      const linked = selectedBotLink.webhookUrl === url;
                      return (
                        <div key={url} className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <p className="break-all font-mono text-[11px] text-gray-200">{url}</p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${connectivityBadgeClass(linked)}`}>
                              {linked ? 'linked' : 'available'}
                            </span>
                            <button
                              type="button"
                              className="rounded-lg border border-primary-300/40 bg-primary-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-primary-100"
                              onClick={() => handleLinkWebhook(url)}
                            >
                              Link
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="mt-3 btn btn-secondary btn-small" onClick={handleVerifyIngress} disabled={modalLoading}>
                    Check Connectivity
                  </button>
                </section>

                <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">Exchange integrations</p>
                    <button type="button" className="btn btn-secondary btn-small" onClick={handleRefreshConnectivity} disabled={modalLoading}>
                      Refresh
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Link any exchange integration and run a connection test.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
                    {integrations.length === 0 && <p className="text-xs text-gray-400">No exchange integrations found.</p>}
                    {integrations.map((integration) => {
                      const linked = selectedBotLink.integrationId === integration.id;
                      const healthy = integrationIsHealthy(integration.status);
                      return (
                        <div key={integration.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-gray-100">{integration.label || integration.exchange}</p>
                              <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                                {integration.exchange} · {integration.environment}
                              </p>
                            </div>
                            <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${connectivityBadgeClass(healthy)}`}>
                              {integration.status || 'unknown'}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-gray-400">Last tested {formatDate(integration.lastTestedAt || null)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-primary-300/40 bg-primary-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-primary-100"
                              onClick={() => handleLinkIntegration(integration.id)}
                            >
                              {linked ? 'Linked' : 'Link'}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => handleTestIntegration(integration.id)}
                              disabled={testingIntegrationId === integration.id}
                            >
                              {testingIntegrationId === integration.id ? 'Testing...' : 'Check Connectivity'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-semibold text-white">Exchange accounts</p>
                  <p className="mt-1 text-xs text-gray-400">Optional account link used by bot runtime in this workspace.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-auto pr-1">
                    {exchangeAccounts.length === 0 && <p className="text-xs text-gray-400">No exchange accounts configured.</p>}
                    {exchangeAccounts.map((account) => {
                      const linked = selectedBotLink.exchangeAccountId === account.id;
                      return (
                        <div key={account.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
                          <p className="text-sm font-semibold text-gray-100">{account.name}</p>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                            {account.venue} {account.isSandbox ? '· sandbox' : '· live'}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-[11px] text-gray-400">Updated {formatDate(account.updatedAt)}</p>
                            <button
                              type="button"
                              className="rounded-lg border border-primary-300/40 bg-primary-500/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-primary-100"
                              onClick={() => handleLinkExchangeAccount(account.id)}
                            >
                              {linked ? 'Linked' : 'Link'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2 text-[11px] text-gray-300">
                    Linked account: {linkedExchangeAccount ? `${linkedExchangeAccount.name} (${linkedExchangeAccount.venue})` : 'none'}
                  </div>
                </section>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-gray-300">
                <p>Linked TradingView URL: {selectedBotLink.webhookUrl || 'none'}</p>
                <p>Linked exchange integration: {linkedIntegration?.label || linkedIntegration?.exchange || 'none'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

type BotConnectivityStatus = 'online' | 'idle' | 'issue';

function botConnectivityStatus(bot: TradeBotRow): BotConnectivityStatus {
  const status = String(bot.latestVersion?.status || '').toLowerCase();
  const instances = Number(bot.counts?.instances || 0);
  if (['error', 'failed', 'rejected', 'disabled'].includes(status)) return 'issue';
  if (instances > 0 || ['published', 'approved', 'running', 'active', 'connected'].includes(status)) return 'online';
  return 'idle';
}

function statusPill(status: BotConnectivityStatus) {
  if (status === 'online') return 'bg-emerald-400';
  if (status === 'issue') return 'bg-rose-400';
  return 'bg-amber-300';
}

function statusLabel(status: BotConnectivityStatus) {
  if (status === 'online') return 'connected';
  if (status === 'issue') return 'issue';
  return 'idle';
}

function ConnectivityMindmap({ bots }: { bots: TradeBotRow[] }) {
  const nodes = bots.slice(0, 6).map((bot) => ({
    id: bot.id,
    name: bot.name,
    status: botConnectivityStatus(bot)
  }));

  return (
    <div className="card-shell space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="section-label">Connectivity Map</p>
          <p className="text-sm text-gray-300">Quick topology view for bot connectivity and readiness.</p>
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex justify-center">
          <div className="rounded-xl border border-primary-300/40 bg-primary-500/15 px-4 py-2 text-sm font-semibold text-primary-100">
            Trade Bot Hub
          </div>
        </div>
        {nodes.length === 0 && <p className="mt-4 text-center text-sm text-gray-400">No bots loaded to draw connectivity.</p>}
        {nodes.length > 0 && (
          <div className="relative mt-5">
            <span className="pointer-events-none absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-primary-300/50"></span>
            <span className="pointer-events-none absolute left-[8%] right-[8%] top-4 h-px bg-primary-300/35"></span>
            <div className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-3">
              {nodes.map((node) => (
                <div key={node.id} className="relative rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <span className="pointer-events-none absolute -top-5 left-1/2 h-5 w-px -translate-x-1/2 bg-primary-300/35"></span>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${statusPill(node.status)}`}></span>
                    <p className="truncate text-sm font-semibold text-gray-100">{node.name}</p>
                  </div>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-gray-400">{statusLabel(node.status)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 flex flex-col">
      <p className="text-xs uppercase tracking-[0.28em] text-gray-500">{label}</p>
      <div className="mt-auto text-right">
        <p className="text-2xl font-semibold text-main">{value}</p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 mt-1">{helper}</p>
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

function StatCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-2 text-sm font-mono text-gray-100 break-all' : 'mt-2 text-xl font-semibold text-white'}>{value}</p>
    </div>
  );
}

function InfoTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1">
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={mono ? 'mt-1 font-mono text-[11px] text-gray-100' : 'mt-1 text-[11px] text-gray-100'}>{value}</p>
    </div>
  );
}
