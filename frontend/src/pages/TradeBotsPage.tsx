import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listIntegrations, type Integration } from '../api/integrations';
import type { Bot, BotInstance, BotRun, ExchangeAccount, Order } from '../api/types';
import {
  getInstanceOrders,
  getInstanceRuns,
  getTradeBotRuntimeConfig,
  listBots,
  listExchangeAccounts,
  listInstances,
  type TradeBotRuntimeConfig
} from '../api/tradeBots';
import BotInstanceControlsPanel from '../components/BotInstanceControlsPanel';

type BotRow = Bot & {
  latestVersion?: {
    id?: string | null;
    status?: string | null;
    language?: string | null;
  } | null;
  counts?: {
    versions?: number;
    instances?: number;
    rentals?: number;
    orders?: number;
    runs?: number;
    guardrailEvents?: number;
  };
};

type PopupTab = 'algo' | 'connectivity' | 'integrations' | 'pine-script' | 'trade-history';

type TradeHistoryRow = {
  id: string;
  timestamp: string | null;
  source: 'order' | 'run';
  symbol: string;
  side: string;
  qty: string;
  price: string;
  status: string;
  reference: string;
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatNumber(value: unknown, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function normalizeVersionStatus(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeInstanceStatus(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function versionStatusLabel(bot: BotRow) {
  const status = normalizeVersionStatus(bot.latestVersion?.status);
  if (status) return status;
  return bot.latestVersionId ? 'versioned' : 'unversioned';
}

function versionStatusClass(bot: BotRow) {
  const status = normalizeVersionStatus(bot.latestVersion?.status);
  if (['published', 'approved', 'running', 'active'].includes(status)) {
    return 'border-emerald-300/45 bg-emerald-500/15 text-emerald-100';
  }
  if (['rejected', 'failed', 'error', 'disabled'].includes(status)) {
    return 'border-rose-300/45 bg-rose-500/15 text-rose-100';
  }
  if (['draft', 'building', 'scanning', 'pending'].includes(status)) {
    return 'border-amber-300/45 bg-amber-500/15 text-amber-100';
  }
  return 'border-white/20 bg-white/10 text-gray-200';
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapOrderToTradeRow(order: Order, instance: BotInstance): TradeHistoryRow {
  return {
    id: `order:${order.id}`,
    timestamp: order.updatedAt || order.createdAt || null,
    source: 'order',
    symbol: String(order.symbol || instance.symbol || '—').toUpperCase(),
    side: String(order.side || '—').toUpperCase(),
    qty: formatNumber(order.qty, 8),
    price: formatNumber(order.price, 8),
    status: String(order.status || 'unknown').toUpperCase(),
    reference: order.venueOrderId || order.id || '—'
  };
}

function mapRunToTradeRow(run: BotRun, instance: BotInstance): TradeHistoryRow {
  return {
    id: `run:${run.id}`,
    timestamp: run.finishedAt || run.startedAt || null,
    source: 'run',
    symbol: String(instance.symbol || '—').toUpperCase(),
    side: '—',
    qty: '—',
    price: '—',
    status: String(run.status || 'unknown').toUpperCase(),
    reference: run.id || '—'
  };
}

function WidgetCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{helper}</p>
    </article>
  );
}

function StatItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className={`mt-1 text-xs text-gray-200 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function PopupInfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-black/35 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-100">{value}</p>
    </div>
  );
}

export default function TradeBotsPage() {
  const [items, setItems] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedBot, setSelectedBot] = useState<BotRow | null>(null);

  const [activePopupTab, setActivePopupTab] = useState<PopupTab>('connectivity');
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupError, setPopupError] = useState<string | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<TradeBotRuntimeConfig | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [exchangeAccounts, setExchangeAccounts] = useState<ExchangeAccount[]>([]);
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);

  const [tradeRows, setTradeRows] = useState<TradeHistoryRow[]>([]);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const totalInstances = useMemo(
    () => items.reduce((sum, bot) => sum + toNumber(bot.counts?.instances), 0),
    [items]
  );
  const botsWithInstances = useMemo(
    () => items.filter((bot) => toNumber(bot.counts?.instances) > 0).length,
    [items]
  );
  const publishedOrActiveBots = useMemo(
    () =>
      items.filter((bot) => {
        const status = normalizeVersionStatus(bot.latestVersion?.status);
        return ['published', 'approved', 'running', 'active'].includes(status);
      }).length,
    [items]
  );
  const guardrailAlertBots = useMemo(
    () =>
      items.filter((bot) => Boolean(bot.guardrailAlert) || toNumber(bot.counts?.guardrailEvents) > 0).length,
    [items]
  );
  const recentlyUpdatedBots = useMemo(() => {
    const windowMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    return items.filter((bot) => {
      const ts = new Date(bot.updatedAt).getTime();
      return Number.isFinite(ts) && now - ts <= windowMs;
    }).length;
  }, [items]);
  const avgInstancesPerBot = useMemo(() => {
    if (items.length === 0) return '0.0';
    return (totalInstances / items.length).toFixed(1);
  }, [items.length, totalInstances]);

  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return items;
    return items.filter((bot) => {
      const haystack = [
        bot.name,
        bot.kind,
        bot.description || '',
        bot.latestVersionId || '',
        bot.latestVersion?.status || '',
        bot.latestVersion?.language || ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [items, query]);

  const popupTabs: Array<{ key: PopupTab; label: string }> = useMemo(
    () => [
      { key: 'algo', label: 'Algo' },
      { key: 'connectivity', label: 'Connectivity' },
      { key: 'integrations', label: 'Integrations' },
      { key: 'pine-script', label: 'Pine Script' },
      { key: 'trade-history', label: 'Trade History' }
    ],
    []
  );

  const runtimeRules = useMemo(() => {
    const source = runtimeConfig?.rules;
    if (!source || typeof source !== 'object') return {} as Record<string, unknown>;
    return source as Record<string, unknown>;
  }, [runtimeConfig?.rules]);

  const linkedIntegration = useMemo(() => {
    const integrationId = runtimeConfig?.links?.integrationId;
    if (!integrationId) return null;
    return integrations.find((integration) => integration.id === integrationId) || null;
  }, [integrations, runtimeConfig?.links?.integrationId]);

  const linkedExchangeAccount = useMemo(() => {
    const accountId = runtimeConfig?.links?.exchangeAccountId;
    if (!accountId) return null;
    return exchangeAccounts.find((account) => account.id === accountId) || null;
  }, [exchangeAccounts, runtimeConfig?.links?.exchangeAccountId]);

  const runningInstances = useMemo(
    () => botInstances.filter((instance) => ['running', 'active'].includes(normalizeInstanceStatus(instance.status))).length,
    [botInstances]
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listBots();
      const nextItems = ((response.items || []) as BotRow[]).slice().sort((a, b) => {
        const aTs = new Date(a.updatedAt).getTime();
        const bTs = new Date(b.updatedAt).getTime();
        return bTs - aTs;
      });
      setItems(nextItems);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trade bots.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTradeHistory = useCallback(async () => {
    if (!selectedBot?.id) return;
    if (botInstances.length === 0) {
      setTradeRows([]);
      setTradeError(null);
      return;
    }

    setTradeLoading(true);
    setTradeError(null);
    try {
      const scopedInstances = botInstances.slice(0, 4);
      const allRows: TradeHistoryRow[] = [];

      await Promise.all(
        scopedInstances.map(async (instance) => {
          const [ordersRes, runsRes] = await Promise.all([getInstanceOrders(instance.id), getInstanceRuns(instance.id)]);
          (ordersRes.items || []).forEach((order) => allRows.push(mapOrderToTradeRow(order, instance)));
          (runsRes.items || []).forEach((run) => allRows.push(mapRunToTradeRow(run, instance)));
        })
      );

      allRows.sort((a, b) => {
        const aTs = new Date(a.timestamp || '').getTime();
        const bTs = new Date(b.timestamp || '').getTime();
        return bTs - aTs;
      });

      setTradeRows(allRows.slice(0, 80));
    } catch (err: any) {
      setTradeRows([]);
      setTradeError(err?.message || 'Failed to load trade history.');
    } finally {
      setTradeLoading(false);
    }
  }, [botInstances, selectedBot?.id]);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedBot?.id) return;

    let cancelled = false;
    const loadPopupContext = async () => {
      setPopupLoading(true);
      setPopupError(null);
      setTradeRows([]);
      setTradeError(null);
      try {
        const [runtime, integrationsRes, exchangeAccountsRes, instancesRes] = await Promise.all([
          getTradeBotRuntimeConfig(selectedBot.id),
          listIntegrations().catch(() => []),
          listExchangeAccounts().then((result) => result.items || []).catch(() => []),
          listInstances(selectedBot.id).then((result) => result.items || []).catch(() => [])
        ]);

        if (cancelled) return;

        setRuntimeConfig(runtime);
        setIntegrations(integrationsRes || []);
        setExchangeAccounts(exchangeAccountsRes || []);
        setBotInstances(instancesRes || []);
      } catch (err: any) {
        if (cancelled) return;
        setRuntimeConfig(null);
        setIntegrations([]);
        setExchangeAccounts([]);
        setBotInstances([]);
        setPopupError(err?.message || 'Failed to load popup details.');
      } finally {
        if (!cancelled) {
          setPopupLoading(false);
        }
      }
    };

    loadPopupContext();

    return () => {
      cancelled = true;
    };
  }, [selectedBot?.id]);

  useEffect(() => {
    if (!selectedBot?.id) return;
    if (activePopupTab !== 'trade-history') return;
    void loadTradeHistory();
  }, [activePopupTab, loadTradeHistory, selectedBot?.id]);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold text-main">Trade Bots</h1>
        <p className="text-sm text-gray-300">
          Card-based bot catalog with restored multi-section popup controls.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <WidgetCard label="Bots" value={String(items.length)} helper="Workspace catalog size" />
        <WidgetCard label="Instances" value={String(totalInstances)} helper="Total deployed instances" />
        <WidgetCard label="Bots With Instances" value={String(botsWithInstances)} helper="Ready for runtime control" />
        <WidgetCard label="Published/Active" value={String(publishedOrActiveBots)} helper="Live or approved statuses" />
        <WidgetCard label="Guardrail Alerts" value={String(guardrailAlertBots)} helper="Needs risk attention" />
        <WidgetCard label="Updated (24h)" value={String(recentlyUpdatedBots)} helper={`Avg instances/bot: ${avgInstancesPerBot}`} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            className="w-64 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-gray-100 outline-none focus:border-primary-300/60"
            placeholder="Search bot name, status, kind"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 transition hover:border-primary-300/45 hover:bg-primary-500/10"
            onClick={load}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/market" className="btn btn-white-animated btn-small">
            Open Marketplace
          </Link>
          <Link to="/market/rentals" className="btn btn-secondary btn-small">
            My Rentals
          </Link>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading bots…</p>}
      {error && <p className="rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{error}</p>}
      {!loading && !error && filteredItems.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">No bots found for this filter.</p>
      )}

      {!loading && filteredItems.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((bot) => (
            <article key={bot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-primary-300/40 hover:bg-primary-500/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{bot.name}</h3>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-gray-400">
                    {bot.kind} {bot.latestVersion?.language ? `· ${bot.latestVersion.language}` : ''}
                  </p>
                </div>
                <span className={`rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${versionStatusClass(bot)}`}>
                  {versionStatusLabel(bot)}
                </span>
              </div>

              <p className="mt-3 min-h-12 text-sm text-gray-300">{bot.description || 'No description available.'}</p>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <StatItem label="Instances" value={String(toNumber(bot.counts?.instances))} />
                <StatItem label="Orders" value={String(toNumber(bot.counts?.orders))} />
                <StatItem label="Version" value={bot.latestVersion?.id || bot.latestVersionId || '—'} mono />
                <StatItem label="Updated" value={formatDate(bot.updatedAt)} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/platform/trade-bots/overview?legacyPopupBotId=${encodeURIComponent(bot.id)}&legacyPopupSection=integrations`}
                  className="rounded-lg border border-primary-300/45 bg-primary-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-primary-100"
                >
                  Open Bot Popup
                </Link>
                <Link to={`/trade-bots/${bot.id}`} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-gray-100">
                  Detail
                </Link>
                <Link to={`/trade-bots/${bot.id}/instances`} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-gray-100">
                  Instances
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}

      {selectedBot && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-6 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedBot(null)}
        >
          <div
            className="mx-auto w-full max-w-6xl rounded-3xl border border-white/15 bg-black/90 shadow-[0_32px_120px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/15 px-6 py-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Bot Popup</p>
                <h3 className="text-3xl font-semibold text-main">{selectedBot.name}</h3>
                <p className="mt-1 text-sm text-gray-300">Legacy popup sections restored: Algo, Connectivity, Integrations, Pine Script, Trade History.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setSelectedBot(null)}>
                Close
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <WidgetCard label="Kind" value={selectedBot.kind.toUpperCase()} helper="Execution mode" />
                <WidgetCard label="Instances" value={String(toNumber(selectedBot.counts?.instances))} helper="Deployed runtime count" />
                <WidgetCard label="Orders" value={String(toNumber(selectedBot.counts?.orders))} helper="Orders mapped in summary" />
                <WidgetCard label="Updated" value={formatDate(selectedBot.updatedAt)} helper="Last bot update timestamp" />
              </div>

              {popupError && <p className="rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{popupError}</p>}
              {popupLoading && <p className="text-xs text-gray-400">Loading popup details…</p>}

              <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-black/45 p-2 text-xs uppercase tracking-[0.2em]">
                {popupTabs.map((tab) => {
                  const isActive = activePopupTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActivePopupTab(tab.key)}
                      className={`rounded-xl px-3 py-2 transition ${
                        isActive ? 'bg-primary-500/20 text-primary-100' : 'text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </nav>

              {activePopupTab === 'algo' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">Algo</p>
                      <p className="text-xs text-gray-400">Runtime rule profile and execution settings for this bot.</p>
                    </div>
                    <Link to={`/trade-bots/${selectedBot.id}`} className="btn btn-secondary btn-small">
                      Open Detail Page
                    </Link>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <PopupInfoCard label="Symbol" value={String(runtimeRules.symbol || '—').toUpperCase()} />
                    <PopupInfoCard label="Function" value={String(runtimeRules.executionFunction || runtimeRules.function || '—')} />
                    <PopupInfoCard label="Allocation" value={String(runtimeRules.allocationValue ?? runtimeRules.allocationPct ?? '—')} />
                    <PopupInfoCard label="Leverage" value={String(runtimeRules.leverage ?? '—')} />
                    <PopupInfoCard label="Take Profit %" value={String(runtimeRules.takeProfitPct ?? runtimeRules.tpPercent ?? '—')} />
                    <PopupInfoCard label="SL ATR" value={String(runtimeRules.slAtrMult ?? runtimeRules.stopLossAtr ?? '—')} />
                    <PopupInfoCard label="Sizing Mode" value={String(runtimeRules.sizingMode || '—')} />
                    <PopupInfoCard label="Risk/Trade" value={String(runtimeRules.riskPerTradePct ?? '—')} />
                  </div>

                  <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Algo Runtime JSON</p>
                    <pre className="mt-2 max-h-72 overflow-auto rounded border border-white/10 bg-black/45 p-3 text-[11px] text-gray-200">
                      {JSON.stringify(runtimeRules, null, 2)}
                    </pre>
                  </div>
                </section>
              )}

              {activePopupTab === 'connectivity' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Connectivity</p>
                    <p className="text-xs text-gray-400">Webhook, integration links, account wiring, and live instance controls.</p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <PopupInfoCard
                      label="Webhook Link"
                      value={runtimeConfig?.links?.webhookUrl ? 'Linked' : 'Not linked'}
                    />
                    <PopupInfoCard
                      label="Integration"
                      value={linkedIntegration ? `${linkedIntegration.label || linkedIntegration.exchange} (${linkedIntegration.status})` : 'Not linked'}
                    />
                    <PopupInfoCard
                      label="Exchange Account"
                      value={linkedExchangeAccount ? `${linkedExchangeAccount.name} (${linkedExchangeAccount.venue})` : 'Not linked'}
                    />
                    <PopupInfoCard label="Running Instances" value={`${runningInstances}/${botInstances.length}`} />
                  </div>

                  <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">TradingView Webhook URL</p>
                    <p className="mt-1 break-all font-mono text-xs text-gray-200">{runtimeConfig?.links?.webhookUrl || 'Not configured'}</p>
                  </div>

                  <BotInstanceControlsPanel
                    botId={selectedBot.id}
                    showHeader
                    title="Runtime Controls"
                    subtitle="Start, pause, restart, and stop this bot's instances from popup."
                  />
                </section>
              )}

              {activePopupTab === 'integrations' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">Integrations</p>
                      <p className="text-xs text-gray-400">Connected exchange integrations and linked account context for this bot.</p>
                    </div>
                    <Link to="/platform/integrations" className="btn btn-secondary btn-small">
                      Open Integrations Page
                    </Link>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <PopupInfoCard label="Linked Integration" value={linkedIntegration ? linkedIntegration.label || linkedIntegration.exchange : 'None'} />
                    <PopupInfoCard label="Integration Status" value={linkedIntegration?.status || 'Unknown'} />
                    <PopupInfoCard label="Linked Account" value={linkedExchangeAccount?.name || 'None'} />
                    <PopupInfoCard label="Total Integrations" value={String(integrations.length)} />
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Exchange Integrations</p>
                      <div className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
                        {integrations.length === 0 && <p className="text-xs text-gray-400">No integrations found.</p>}
                        {integrations.map((integration) => {
                          const isLinked = runtimeConfig?.links?.integrationId === integration.id;
                          return (
                            <div key={integration.id} className="rounded-lg border border-white/10 bg-black/40 p-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-gray-100">{integration.label || integration.exchange}</p>
                                  <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                                    {integration.exchange} · {integration.environment}
                                  </p>
                                </div>
                                <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${isLinked ? 'bg-emerald-500/20 text-emerald-100' : 'bg-white/10 text-gray-300'}`}>
                                  {isLinked ? 'Linked' : integration.status || 'Unknown'}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-gray-400">Last tested: {formatDate(integration.lastTestedAt || null)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Exchange Accounts</p>
                      <div className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
                        {exchangeAccounts.length === 0 && <p className="text-xs text-gray-400">No exchange accounts found.</p>}
                        {exchangeAccounts.map((account) => {
                          const isLinked = runtimeConfig?.links?.exchangeAccountId === account.id;
                          return (
                            <div key={account.id} className="rounded-lg border border-white/10 bg-black/40 p-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-gray-100">{account.name}</p>
                                  <p className="text-[11px] uppercase tracking-[0.14em] text-gray-400">
                                    {account.venue} {account.isSandbox ? '· sandbox' : '· live'}
                                  </p>
                                </div>
                                <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${isLinked ? 'bg-emerald-500/20 text-emerald-100' : 'bg-white/10 text-gray-300'}`}>
                                  {isLinked ? 'Linked' : 'Available'}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-gray-400">Updated: {formatDate(account.updatedAt)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {activePopupTab === 'pine-script' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Pine Script</p>
                    <p className="text-xs text-gray-400">Detected PineScript parameters and analysis connected to runtime config.</p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <PopupInfoCard label="Parameter Source" value={String(runtimeConfig?.parameters?.source || 'none')} />
                    <PopupInfoCard label="Schema Count" value={String(runtimeConfig?.parameters?.schema?.length || 0)} />
                    <PopupInfoCard label="Value Count" value={String(Object.keys(runtimeConfig?.parameters?.values || {}).length)} />
                    <PopupInfoCard label="Updated" value={formatDate(runtimeConfig?.parameters?.updatedAt || runtimeConfig?.updatedAt || null)} />
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Source Code</p>
                      <pre className="mt-2 max-h-80 overflow-auto rounded border border-white/10 bg-black/45 p-3 text-[11px] text-gray-200">
                        {runtimeConfig?.parameters?.sourceCode || 'No source code available in runtime config.'}
                      </pre>
                    </div>

                    <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Parameters</p>
                      <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
                        {(runtimeConfig?.parameters?.schema || []).length === 0 && (
                          <p className="text-xs text-gray-400">No code-driven parameters found.</p>
                        )}
                        {(runtimeConfig?.parameters?.schema || []).map((param) => {
                          const value = Object.prototype.hasOwnProperty.call(runtimeConfig?.parameters?.values || {}, param.key)
                            ? runtimeConfig?.parameters?.values?.[param.key]
                            : param.defaultValue;
                          return (
                            <div key={param.key} className="rounded-lg border border-white/10 bg-black/40 p-2">
                              <p className="text-sm font-semibold text-gray-100">{param.label}</p>
                              <p className="text-[11px] font-mono text-gray-400">{param.key}</p>
                              <p className="mt-1 text-xs text-gray-300">Type: {param.type}</p>
                              <p className="text-xs text-gray-300">Value: {value === null ? 'null' : String(value)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/15 bg-black/35 p-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Pine Analysis JSON</p>
                    <pre className="mt-2 max-h-64 overflow-auto rounded border border-white/10 bg-black/45 p-3 text-[11px] text-gray-200">
                      {JSON.stringify(runtimeRules.pineAnalysis || null, null, 2)}
                    </pre>
                  </div>
                </section>
              )}

              {activePopupTab === 'trade-history' && (
                <section className="space-y-3 rounded-2xl border border-white/15 bg-black/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">Trade History</p>
                      <p className="text-xs text-gray-400">Recent orders and run lifecycle events from bot instances.</p>
                    </div>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => void loadTradeHistory()} disabled={tradeLoading}>
                      {tradeLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>

                  {tradeError && <p className="rounded-xl border border-rose-400/35 bg-rose-500/12 p-3 text-sm text-rose-100">{tradeError}</p>}

                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <PopupInfoCard label="Rows" value={String(tradeRows.length)} />
                    <PopupInfoCard label="Orders" value={String(tradeRows.filter((row) => row.source === 'order').length)} />
                    <PopupInfoCard label="Runs" value={String(tradeRows.filter((row) => row.source === 'run').length)} />
                    <PopupInfoCard label="Latest" value={formatDate(tradeRows[0]?.timestamp || null)} />
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-white/15 bg-black/35">
                    <table className="min-w-full text-xs text-gray-200">
                      <thead className="text-left text-[10px] uppercase tracking-[0.14em] text-gray-500">
                        <tr>
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Symbol</th>
                          <th className="px-3 py-2">Side</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Price</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Reference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tradeRows.length === 0 && !tradeLoading && (
                          <tr className="border-t border-white/10">
                            <td className="px-3 py-3 text-gray-400" colSpan={8}>
                              No trade history rows available for this bot yet.
                            </td>
                          </tr>
                        )}
                        {tradeRows.map((row) => (
                          <tr key={row.id} className="border-t border-white/10">
                            <td className="px-3 py-2">{formatDate(row.timestamp)}</td>
                            <td className="px-3 py-2 uppercase">{row.source}</td>
                            <td className="px-3 py-2 font-mono">{row.symbol}</td>
                            <td className="px-3 py-2 uppercase">{row.side}</td>
                            <td className="px-3 py-2">{row.qty}</td>
                            <td className="px-3 py-2">{row.price}</td>
                            <td className="px-3 py-2 uppercase">{row.status}</td>
                            <td className="px-3 py-2 font-mono">{row.reference}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
