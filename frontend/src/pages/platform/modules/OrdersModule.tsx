import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { fetchMexcSpotSnapshot, type OrderCheckSnapshot } from '../../../api/orders';
import { listIntegrations } from '../../../api/integrations';
import { listBots, listInstances } from '../../../api/tradeBots';
import LiveLineChart from '../../../components/LiveLineChart';
import {
  listDatabases,
  listTradeTransactions,
  listTradeTransactionsForDatabase,
  type DatabaseInstance,
  type TradeTransactionLedgerItem,
  type TradeTransactionLedgerResponse
} from '../../../api/databases';

type Integration = Awaited<ReturnType<typeof listIntegrations>>[number];
type PairTabItem = {
  pair: string;
  lastSeenAt: string | null;
};

const ACTIVE_INSTANCE_STATUSES = new Set(['running', 'active']);
const RECENT_PAIRS_STORAGE_KEY = 'orders.recentPairs.v1';
const MAX_RECENT_PAIRS = 20;

function normalizePair(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function readRecentPairs(): PairTabItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PAIRS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ pair?: string; lastSeenAt?: string | null }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        pair: normalizePair(item?.pair),
        lastSeenAt: item?.lastSeenAt || null
      }))
      .filter((item) => Boolean(item.pair))
      .slice(0, MAX_RECENT_PAIRS);
  } catch {
    return [];
  }
}

function writeRecentPairs(rows: PairTabItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_PAIRS_STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_RECENT_PAIRS)));
  } catch {
    // ignore storage errors
  }
}

function statusPill(answer: boolean | null | undefined) {
  if (answer === true) {
    return 'inline-flex rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200';
  }
  if (answer === false) {
    return 'inline-flex rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-rose-100';
  }
  return 'inline-flex rounded-lg border border-slate-300/25 bg-slate-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200';
}

function formatDecimal(value: unknown, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatMaybeDecimal(value: unknown, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

const EXCHANGE_ICON_MAP: Record<string, string> = {
  binance: '/icons/exchanges/binance.svg',
  mexc: '/icons/exchanges/mexc.svg',
  zerodha: '/icons/exchanges/zerodha.svg'
};

function integrationStatusMeta(status?: string | null) {
  const normalized = String(status || 'unknown').toLowerCase();
  if (['connected', 'active', 'ready', 'available', 'success'].includes(normalized)) {
    return {
      label: 'Healthy',
      dotClass: 'bg-emerald-400',
      chipClass: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
    };
  }
  if (['pending', 'processing', 'testing'].includes(normalized)) {
    return {
      label: 'Processing',
      dotClass: 'bg-amber-300',
      chipClass: 'border-amber-300/40 bg-amber-500/20 text-amber-100'
    };
  }
  if (['failed', 'error', 'offline', 'degraded'].includes(normalized)) {
    return {
      label: 'Error',
      dotClass: 'bg-rose-400',
      chipClass: 'border-rose-400/40 bg-rose-500/20 text-rose-100'
    };
  }
  return {
    label: 'Unknown',
    dotClass: 'bg-slate-300',
    chipClass: 'border-slate-300/30 bg-slate-500/20 text-slate-100'
  };
}

function formatDate(input?: string | null) {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatExchangeTime(input: unknown) {
  const raw = String(input ?? '').trim();
  if (!raw) return '—';
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber).toLocaleString();
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

type ExchangeOpenOrderRow = {
  symbol?: string | null;
  orderId?: string | number;
  clientOrderId?: string | null;
  origClientOrderId?: string | null;
  side?: string | null;
  type?: string | null;
  status?: string | null;
  price?: string | number | null;
  origQty?: string | number | null;
  executedQty?: string | number | null;
  cummulativeQuoteQty?: string | number | null;
  time?: string | number | null;
  updateTime?: string | number | null;
};

type ExchangeTradeFillRow = {
  id?: string | number;
  symbol?: string | null;
  orderId?: string | number;
  clientOrderId?: string | null;
  side?: string | null;
  isBuyer?: boolean;
  price?: string | number | null;
  qty?: string | number | null;
  quoteQty?: string | number | null;
  commission?: string | number | null;
  commissionAsset?: string | null;
  time?: string | number | null;
};

type LedgerFillState = 'unfilled' | 'partial' | 'filled';

const FILLED_LEDGER_STATUSES = new Set([
  'filled',
  'executed',
  'executed_success',
  'success',
  'succeeded',
  'closed',
  'done'
]);
const PARTIAL_LEDGER_STATUSES = new Set(['partially_filled', 'partial_fill']);
const PENDING_LEDGER_STATUSES = new Set([
  'new',
  'open',
  'pending',
  'sent',
  'submitted',
  'received',
  'queued',
  'ready_for_execution'
]);

function classifyLedgerFillState(row: TradeTransactionLedgerItem): LedgerFillState {
  const normalizedStatus = String(row.status || '')
    .trim()
    .toLowerCase();
  const quantity = Number(row.quantity);

  if (FILLED_LEDGER_STATUSES.has(normalizedStatus)) {
    return 'filled';
  }
  if (PARTIAL_LEDGER_STATUSES.has(normalizedStatus)) {
    return 'partial';
  }
  if (PENDING_LEDGER_STATUSES.has(normalizedStatus)) {
    return Number.isFinite(quantity) && quantity > 0 ? 'partial' : 'unfilled';
  }

  if (Number.isFinite(quantity) && quantity > 0) {
    return 'partial';
  }
  return 'unfilled';
}

function ledgerStatusBadgeClass(status?: string | null) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  if (FILLED_LEDGER_STATUSES.has(normalized)) {
    return 'border-emerald-400/30 bg-emerald-500/20 text-emerald-100';
  }
  if (PARTIAL_LEDGER_STATUSES.has(normalized)) {
    return 'border-amber-300/30 bg-amber-500/20 text-amber-100';
  }
  if (PENDING_LEDGER_STATUSES.has(normalized)) {
    return 'border-sky-300/30 bg-sky-500/20 text-sky-100';
  }
  return 'border-slate-300/20 bg-slate-500/20 text-slate-200';
}

function pnlValueClass(value: number) {
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-rose-300';
  return 'text-gray-300';
}

type LedgerSectionTableProps = {
  title: string;
  subtitle: string;
  badgeClassName: string;
  rows: TradeTransactionLedgerItem[];
  loading: boolean;
  emptyState: string;
};

function LedgerSectionTable({ title, subtitle, badgeClassName, rows, loading, emptyState }: LedgerSectionTableProps) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{title}</p>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        <span className={`inline-flex rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${badgeClassName}`}>
          {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/5">
        <table className="min-w-[1200px] w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
              <th className="px-3 py-2">Executed</th>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Mkt Price</th>
              <th className="px-3 py-2">Exec Price</th>
              <th className="px-3 py-2">Buy Value</th>
              <th className="px-3 py-2">Sell Value</th>
              <th className="px-3 py-2">Realized PnL</th>
              <th className="px-3 py-2">Bal Before</th>
              <th className="px-3 py-2">Bal After</th>
            </tr>
          </thead>
          <tbody className="text-gray-200">
            {loading && (
              <tr>
                <td className="px-3 py-4 text-gray-500" colSpan={14}>
                  Loading trade transactions...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-gray-500" colSpan={14}>
                  {emptyState}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="px-3 py-2 text-xs text-gray-400">{row.executedAt ? new Date(row.executedAt).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2 font-semibold text-white">{row.symbol || '—'}</td>
                  <td className="px-3 py-2">{row.side || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${ledgerStatusBadgeClass(row.status)}`}>
                      {row.status || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.amount, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.quantity, 8)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.value, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.marketPrice, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.executionPrice, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.buyValue, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.sellValue, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.realizedPnl, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.accountBalanceBefore, 6)}</td>
                  <td className="px-3 py-2">{formatMaybeDecimal(row.accountBalanceAfter, 6)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function OrdersModule() {
  const [symbol, setSymbol] = useState('ETHUSDC');
  const [orderId, setOrderId] = useState('');
  const [origClientOrderId, setOrigClientOrderId] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsError, setIntegrationsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<OrderCheckSnapshot | null>(null);
  const [ledgerDatabases, setLedgerDatabases] = useState<DatabaseInstance[]>([]);
  const [ledgerDbId, setLedgerDbId] = useState('');
  const [ledgerDbLoading, setLedgerDbLoading] = useState(true);
  const [ledgerDbError, setLedgerDbError] = useState('');
  const [ledgerSymbol, setLedgerSymbol] = useState('');
  const [ledgerLimit, setLedgerLimit] = useState(25);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [ledger, setLedger] = useState<TradeTransactionLedgerResponse | null>(null);
  const [activePairTabs, setActivePairTabs] = useState<PairTabItem[]>([]);
  const [previousPairTabsFromPlatform, setPreviousPairTabsFromPlatform] = useState<PairTabItem[]>([]);
  const [recentPairTabs, setRecentPairTabs] = useState<PairTabItem[]>([]);
  const [pairTabsLoading, setPairTabsLoading] = useState(false);
  const [pairTabsError, setPairTabsError] = useState('');
  const [activePairSnapshots, setActivePairSnapshots] = useState<Record<string, OrderCheckSnapshot>>({});
  const [activePairSnapshotsLoading, setActivePairSnapshotsLoading] = useState(false);

  const loadSnapshot = useCallback(
    async ({
      symbolValue,
      orderIdValue,
      origClientOrderIdValue,
      integrationIdValue
    }: {
      symbolValue: string;
      orderIdValue?: string;
      origClientOrderIdValue?: string;
      integrationIdValue?: string;
    }) => {
      const normalizedSymbol = String(symbolValue || '')
        .trim()
        .toUpperCase();
      if (!normalizedSymbol) {
        setError('Please enter a symbol like BTCUSDC.');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await fetchMexcSpotSnapshot({
          symbol: normalizedSymbol,
          orderId: orderIdValue || undefined,
          origClientOrderId: origClientOrderIdValue || undefined,
          integrationId: integrationIdValue || undefined
        });
        setSnapshot(data);
      } catch (err: any) {
        setError(err?.message || 'Failed to fetch MEXC order diagnostics.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refreshSnapshot = useCallback(() => {
    return loadSnapshot({
      symbolValue: symbol,
      orderIdValue: orderId,
      origClientOrderIdValue: origClientOrderId,
      integrationIdValue: integrationId
    });
  }, [integrationId, loadSnapshot, orderId, origClientOrderId, symbol]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setIntegrationsLoading(true);
      setIntegrationsError('');
      try {
        const rows = await listIntegrations();
        if (!mounted) return;
        setIntegrations(rows || []);
      } catch (err: any) {
        if (!mounted) return;
        setIntegrationsError(err?.message || 'Failed to load connected integrations.');
      } finally {
        if (mounted) setIntegrationsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!integrations.length) return;
    if (integrationId && integrations.some((integration) => integration.id === integrationId)) return;
    const preferred =
      integrations.find((integration) => ['active', 'connected'].includes(String(integration.status || '').toLowerCase())) ||
      integrations[0];
    if (preferred?.id) {
      setIntegrationId(preferred.id);
    }
  }, [integrationId, integrations]);

  const loadPlatformPairs = useCallback(async () => {
    setPairTabsLoading(true);
    setPairTabsError('');
    try {
      const botsResult = await listBots();
      const botItems = Array.isArray(botsResult?.items) ? botsResult.items : [];
      const instanceResults = await Promise.all(botItems.map((bot) => listInstances(bot.id)));
      const pairSummary = new Map<
        string,
        {
          activeTs: number;
          previousTs: number;
          activeIso: string | null;
          previousIso: string | null;
        }
      >();

      for (const response of instanceResults) {
        const instances = Array.isArray(response?.items) ? response.items : [];
        for (const instance of instances as Array<any>) {
          const pair = normalizePair(instance?.symbol);
          if (!pair) continue;
          const status = String(instance?.status || '').toLowerCase();
          const seenAt =
            instance?.startedAt ||
            instance?.updatedAt ||
            instance?.createdAt ||
            instance?.stoppedAt ||
            null;
          const seenTs = toTimestamp(seenAt);
          const summary = pairSummary.get(pair) || {
            activeTs: 0,
            previousTs: 0,
            activeIso: null,
            previousIso: null
          };
          if (ACTIVE_INSTANCE_STATUSES.has(status)) {
            if (seenTs >= summary.activeTs) {
              summary.activeTs = seenTs;
              summary.activeIso = seenAt;
            }
          } else if (seenTs >= summary.previousTs) {
            summary.previousTs = seenTs;
            summary.previousIso = seenAt;
          }
          pairSummary.set(pair, summary);
        }
      }

      const activeRows: PairTabItem[] = [];
      const previousRows: PairTabItem[] = [];
      for (const [pair, summary] of pairSummary.entries()) {
        if (summary.activeTs > 0) {
          activeRows.push({ pair, lastSeenAt: summary.activeIso });
        } else {
          previousRows.push({ pair, lastSeenAt: summary.previousIso });
        }
      }

      activeRows.sort((left, right) => {
        const tsDelta = toTimestamp(right.lastSeenAt) - toTimestamp(left.lastSeenAt);
        return tsDelta !== 0 ? tsDelta : left.pair.localeCompare(right.pair);
      });
      previousRows.sort((left, right) => {
        const tsDelta = toTimestamp(right.lastSeenAt) - toTimestamp(left.lastSeenAt);
        return tsDelta !== 0 ? tsDelta : left.pair.localeCompare(right.pair);
      });

      setActivePairTabs(activeRows);
      setPreviousPairTabsFromPlatform(previousRows);
    } catch (err: any) {
      setPairTabsError(err?.message || 'Failed to load active trading pairs.');
      setActivePairTabs([]);
      setPreviousPairTabsFromPlatform([]);
    } finally {
      setPairTabsLoading(false);
    }
  }, []);

  useEffect(() => {
    setRecentPairTabs(readRecentPairs());
  }, []);

  useEffect(() => {
    void loadPlatformPairs();
  }, [loadPlatformPairs]);

  const loadLedger = useCallback(
    async ({
      dbId,
      symbolFilter,
      limit
    }: {
      dbId: string;
      symbolFilter: string;
      limit: number;
    }) => {
      setLedgerLoading(true);
      setLedgerError('');
      try {
        const payload = dbId
          ? await listTradeTransactionsForDatabase(dbId, {
              symbol: symbolFilter || undefined,
              limit: Number.isFinite(limit) ? limit : 25
            })
          : await listTradeTransactions({
              symbol: symbolFilter || undefined,
              limit: Number.isFinite(limit) ? limit : 25
            });
        setLedger(payload);
      } catch (err: any) {
        setLedgerError(err?.message || 'Failed to load trade transaction table.');
        setLedger(null);
      } finally {
        setLedgerLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLedgerDbLoading(true);
      setLedgerDbError('');
      try {
        const rows = await listDatabases();
        if (!mounted) return;
        setLedgerDatabases(rows || []);
        setLedgerDbId((current) => {
          if (current && rows.some((db) => db.id === current)) return current;
          return rows[0]?.id || '';
        });
      } catch (err: any) {
        if (!mounted) return;
        setLedgerDbError(err?.message || 'Failed to load workspace databases.');
        setLedgerDatabases([]);
        setLedgerDbId('');
      } finally {
        if (mounted) setLedgerDbLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    loadLedger({
      dbId: ledgerDbId,
      symbolFilter: ledgerSymbol,
      limit: ledgerLimit
    });
    // Initial ledger load when database changes; symbol/limit refresh is user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerDbId, loadLedger]);

  useEffect(() => {
    if (!symbol.trim()) return;
    const timeoutId = window.setTimeout(() => {
      void loadSnapshot({
        symbolValue: symbol,
        orderIdValue: orderId,
        origClientOrderIdValue: origClientOrderId,
        integrationIdValue: integrationId
      });
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [integrationId, loadSnapshot, orderId, origClientOrderId, symbol]);

  useEffect(() => {
    let cancelled = false;
    const activePairs = activePairTabs
      .map((item) => normalizePair(item.pair))
      .filter((pair) => Boolean(pair));
    if (!integrationId || activePairs.length === 0) {
      setActivePairSnapshots({});
      setActivePairSnapshotsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      setActivePairSnapshotsLoading(true);
      const results = await Promise.all(
        activePairs.map(async (pair) => {
          try {
            const data = await fetchMexcSpotSnapshot({
              symbol: pair,
              integrationId
            });
            return { pair, data };
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const mapped: Record<string, OrderCheckSnapshot> = {};
      for (const result of results) {
        if (!result) continue;
        mapped[result.pair] = result.data;
      }
      setActivePairSnapshots(mapped);
      setActivePairSnapshotsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [activePairTabs, integrationId]);

  useEffect(() => {
    const pair = normalizePair(symbol);
    const checkedAt = snapshot?.checkedAt || null;
    if (!pair || !checkedAt) return;
    setRecentPairTabs((previous) => {
      const merged = new Map<string, PairTabItem>();
      for (const row of previous) {
        if (!row.pair) continue;
        merged.set(row.pair, row);
      }
      const existing = merged.get(pair);
      if (!existing || toTimestamp(checkedAt) >= toTimestamp(existing.lastSeenAt)) {
        merged.set(pair, { pair, lastSeenAt: checkedAt });
      }
      const next = Array.from(merged.values())
        .sort((left, right) => {
          const tsDelta = toTimestamp(right.lastSeenAt) - toTimestamp(left.lastSeenAt);
          return tsDelta !== 0 ? tsDelta : left.pair.localeCompare(right.pair);
        })
        .slice(0, MAX_RECENT_PAIRS);
      writeRecentPairs(next);
      return next;
    });
  }, [snapshot?.checkedAt, symbol]);

  const handleRefreshSnapshot = useCallback(() => {
    refreshSnapshot();
  }, [refreshSnapshot]);

  const handleRefreshLedger = useCallback(() => {
    if (!ledgerDbId) return;
    loadLedger({
      dbId: ledgerDbId,
      symbolFilter: ledgerSymbol,
      limit: ledgerLimit
    });
  }, [ledgerDbId, ledgerSymbol, ledgerLimit, loadLedger]);
  const handleSelectPairTab = useCallback((pair: string) => {
    const normalized = normalizePair(pair);
    if (!normalized) return;
    setSymbol(normalized);
    setOrderId('');
    setOrigClientOrderId('');
  }, []);
  const handleRefreshPairTabs = useCallback(() => {
    void loadPlatformPairs();
  }, [loadPlatformPairs]);

  const requestedPair = useMemo(() => normalizePair(symbol), [symbol]);
  const orderData = snapshot?.didTradeHappen?.source?.order?.data || {};
  const tradesData = snapshot?.didTradeHappen?.source?.myTrades?.data || {};
  const openData = snapshot?.isStillOpen?.source?.data || {};
  const balanceData = snapshot?.currentBalance?.source?.data || {};
  const exposureData = snapshot?.openPosition?.source?.data || {};
  const selectedExecutedFills = useMemo(
    () => (Array.isArray(tradesData?.items) ? (tradesData.items as ExchangeTradeFillRow[]) : []),
    [tradesData]
  );
  const topBalances = useMemo(
    () => (Array.isArray(balanceData?.topAssets) ? balanceData.topAssets : []),
    [balanceData]
  );
  const openOrdersItems = useMemo(
    () => (Array.isArray(openData?.items) ? (openData.items as ExchangeOpenOrderRow[]) : []),
    [openData]
  );
  const matchingOpenOrders = useMemo(
    () => (Array.isArray(openData?.matchingOrders) ? (openData.matchingOrders as ExchangeOpenOrderRow[]) : []),
    [openData]
  );
  const hasOpenOrderFilter = Boolean(orderId.trim() || origClientOrderId.trim());
  const filteredOpenOrders = hasOpenOrderFilter ? matchingOpenOrders : openOrdersItems;
  const usingOpenOrderFilterFallback = hasOpenOrderFilter && filteredOpenOrders.length === 0 && openOrdersItems.length > 0;
  const visibleOpenOrders = usingOpenOrderFilterFallback ? openOrdersItems : filteredOpenOrders;
  const openOrdersSourceOk = snapshot?.isStillOpen?.source?.ok !== false;
  const openOrdersSourceError = snapshot?.isStillOpen?.source?.error || null;
  const activePairs = useMemo(
    () => activePairTabs.map((item) => normalizePair(item.pair)).filter((pair) => Boolean(pair)),
    [activePairTabs]
  );
  const activePairSet = useMemo(() => new Set(activePairs), [activePairs]);
  const previousPairTabs = useMemo(() => {
    const merged = new Map<string, PairTabItem>();
    for (const row of previousPairTabsFromPlatform) {
      const pair = normalizePair(row.pair);
      if (!pair || activePairSet.has(pair)) continue;
      merged.set(pair, {
        pair,
        lastSeenAt: row.lastSeenAt || null
      });
    }
    for (const row of recentPairTabs) {
      const pair = normalizePair(row.pair);
      if (!pair || activePairSet.has(pair)) continue;
      const existing = merged.get(pair);
      if (!existing || toTimestamp(row.lastSeenAt) >= toTimestamp(existing.lastSeenAt)) {
        merged.set(pair, {
          pair,
          lastSeenAt: row.lastSeenAt || null
        });
      }
    }
    return Array.from(merged.values())
      .sort((left, right) => {
        const tsDelta = toTimestamp(right.lastSeenAt) - toTimestamp(left.lastSeenAt);
        return tsDelta !== 0 ? tsDelta : left.pair.localeCompare(right.pair);
      })
      .slice(0, MAX_RECENT_PAIRS);
  }, [activePairSet, previousPairTabsFromPlatform, recentPairTabs]);
  const visiblePairs = useMemo(() => {
    const pairs = new Set<string>(activePairs);
    if (requestedPair) {
      pairs.add(requestedPair);
    }
    if (pairs.size === 0 && requestedPair) {
      pairs.add(requestedPair);
    }
    return Array.from(pairs).sort((leftPair, rightPair) => leftPair.localeCompare(rightPair));
  }, [activePairs, requestedPair]);
  const visiblePairSet = useMemo(() => new Set(visiblePairs), [visiblePairs]);
  const emptyOpenOrdersMessage = hasOpenOrderFilter
    ? 'No matching open orders for the supplied order filters.'
    : 'No open orders found for this pair.';
  const activeSnapshotOpenOrders = useMemo(() => {
    const rows: ExchangeOpenOrderRow[] = [];
    for (const [pair, pairSnapshot] of Object.entries(activePairSnapshots)) {
      const payload = pairSnapshot?.isStillOpen?.source?.data || {};
      const items = Array.isArray(payload?.items) ? (payload.items as ExchangeOpenOrderRow[]) : [];
      for (const row of items) {
        rows.push({
          ...row,
          symbol: normalizePair(row.symbol || pair)
        });
      }
    }
    return rows;
  }, [activePairSnapshots]);
  const activeSnapshotExecutedFills = useMemo(() => {
    const rows: ExchangeTradeFillRow[] = [];
    for (const [pair, pairSnapshot] of Object.entries(activePairSnapshots)) {
      const payload = pairSnapshot?.didTradeHappen?.source?.myTrades?.data || {};
      const items = Array.isArray(payload?.items) ? (payload.items as ExchangeTradeFillRow[]) : [];
      for (const row of items) {
        rows.push({
          ...row,
          symbol: normalizePair(row.symbol || pair)
        });
      }
    }
    return rows;
  }, [activePairSnapshots]);
  const mergedOpenOrderRows = useMemo(() => {
    const deduped = new Map<string, ExchangeOpenOrderRow>();
    const pushRows = (rows: ExchangeOpenOrderRow[]) => {
      for (const row of rows) {
        const pair = normalizePair(row.symbol || requestedPair);
        if (!pair || !visiblePairSet.has(pair)) continue;
        const key = [
          pair,
          String(row.orderId || ''),
          String(row.clientOrderId || row.origClientOrderId || ''),
          String(row.updateTime || row.time || '')
        ].join('|');
        deduped.set(key, {
          ...row,
          symbol: pair
        });
      }
    };
    if (!hasOpenOrderFilter) {
      pushRows(activeSnapshotOpenOrders);
    }
    pushRows(
      visibleOpenOrders.map((row) => ({
        ...row,
        symbol: normalizePair(row.symbol || requestedPair)
      }))
    );
    return Array.from(deduped.values());
  }, [activeSnapshotOpenOrders, hasOpenOrderFilter, requestedPair, visibleOpenOrders, visiblePairSet]);
  const mergedExecutedFills = useMemo(() => {
    const deduped = new Map<string, ExchangeTradeFillRow>();
    const pushRows = (rows: ExchangeTradeFillRow[]) => {
      for (const row of rows) {
        const pair = normalizePair(row.symbol || requestedPair);
        if (!pair || !visiblePairSet.has(pair)) continue;
        const key = [
          pair,
          String(row.id || ''),
          String(row.orderId || ''),
          String(row.clientOrderId || ''),
          String(row.time || ''),
          String(row.price || ''),
          String(row.qty || '')
        ].join('|');
        deduped.set(key, {
          ...row,
          symbol: pair
        });
      }
    };
    pushRows(activeSnapshotExecutedFills);
    pushRows(
      selectedExecutedFills.map((row) => ({
        ...row,
        symbol: normalizePair(row.symbol || requestedPair)
      }))
    );
    return Array.from(deduped.values());
  }, [activeSnapshotExecutedFills, requestedPair, selectedExecutedFills, visiblePairSet]);
  const openOrdersByPair = useMemo(() => {
    const groups = new Map<string, ExchangeOpenOrderRow[]>();
    for (const pair of visiblePairs) {
      groups.set(pair, []);
    }
    for (const row of mergedOpenOrderRows) {
      const pair = normalizePair(row.symbol || requestedPair || 'UNKNOWN');
      if (!visiblePairSet.has(pair)) continue;
      const existing = groups.get(pair) || [];
      existing.push(row);
      groups.set(pair, existing);
    }
    return visiblePairs.map((pair) => ({ pair, rows: groups.get(pair) || [] }));
  }, [mergedOpenOrderRows, requestedPair, visiblePairSet, visiblePairs]);
  const executedFillsByPair = useMemo(() => {
    const groups = new Map<string, ExchangeTradeFillRow[]>();
    for (const pair of visiblePairs) {
      groups.set(pair, []);
    }
    for (const row of mergedExecutedFills) {
      const pair = normalizePair(row.symbol || requestedPair || 'UNKNOWN');
      if (!visiblePairSet.has(pair)) continue;
      const existing = groups.get(pair) || [];
      existing.push(row);
      groups.set(pair, existing);
    }
    return visiblePairs.map((pair) => ({ pair, rows: groups.get(pair) || [] }));
  }, [mergedExecutedFills, requestedPair, visiblePairSet, visiblePairs]);
  const totalOpenRowsShown = useMemo(
    () => openOrdersByPair.reduce((total, group) => total + group.rows.length, 0),
    [openOrdersByPair]
  );
  const holdings = useMemo(
    () => (Array.isArray(exposureData?.holdings) ? exposureData.holdings : []),
    [exposureData]
  );
  const selectedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === integrationId) || null,
    [integrationId, integrations]
  );
  const selectedLedgerDatabase = useMemo(
    () => ledgerDatabases.find((database) => database.id === ledgerDbId) || null,
    [ledgerDatabases, ledgerDbId]
  );
  const openOrderFilterSummary = useMemo(() => {
    const parts = [
      `symbol=${String(symbol || '').trim().toUpperCase() || '—'}`,
      `integration=${selectedIntegration?.label || selectedIntegration?.exchange || (integrationId ? integrationId : 'auto')}`
    ];
    if (orderId.trim()) {
      parts.push(`orderId=${orderId.trim()}`);
    }
    if (origClientOrderId.trim()) {
      parts.push(`clientOrderId=${origClientOrderId.trim()}`);
    }
    return parts.join(' · ');
  }, [integrationId, orderId, origClientOrderId, selectedIntegration, symbol]);
  const pairVerification = useMemo(() => {
    const filtersPayload = snapshot?.market?.filters as { ok?: boolean; data?: any; error?: string } | undefined;
    const filtersOk = Boolean(filtersPayload?.ok);
    const filtersData = filtersOk && filtersPayload?.data ? filtersPayload.data : null;
    const exchangePair = String(filtersData?.symbol || '')
      .trim()
      .toUpperCase();
    const verified = Boolean(requestedPair && exchangePair && requestedPair === exchangePair);
    return {
      requestedPair,
      verified,
      exchangePair: exchangePair || null,
      baseAsset: filtersData?.baseAsset || null,
      quoteAsset: filtersData?.quoteAsset || null,
      minNotional: filtersData?.minNotional ?? null,
      minQty: filtersData?.minQty ?? null,
      stepSize: filtersData?.stepSize ?? null,
      error: filtersPayload?.error || null
    };
  }, [requestedPair, snapshot]);
  const pnlTimeline = useMemo(() => {
    const rows = [...(ledger?.items || [])].sort((a, b) => {
      const aTs = new Date(a.executedAt || a.createdAt || 0).getTime();
      const bTs = new Date(b.executedAt || b.createdAt || 0).getTime();
      return aTs - bTs;
    });

    let cumulative = 0;
    const timeline = rows.map((row) => {
      const realizedRaw = Number(row.realizedPnl);
      const realized = Number.isFinite(realizedRaw) ? realizedRaw : 0;
      cumulative += realized;
      const ts = row.executedAt || row.createdAt || new Date().toISOString();
      return {
        id: row.id,
        ts,
        symbol: row.symbol || '—',
        side: row.side || '—',
        status: row.status || '—',
        realizedPnl: realized,
        cumulativePnl: cumulative
      };
    });

    return timeline;
  }, [ledger]);
  const pnlChartData = useMemo(
    () =>
      pnlTimeline.map((point) => ({
        ts: point.ts,
        value: Number(point.cumulativePnl.toFixed(8))
      })),
    [pnlTimeline]
  );
  const pnlByPair = useMemo(() => {
    const groups = new Map<string, typeof pnlTimeline>();
    const pairCumulative = new Map<string, number>();
    for (const pair of visiblePairs) {
      groups.set(pair, []);
      pairCumulative.set(pair, 0);
    }
    for (const row of pnlTimeline) {
      const key = String(row.symbol || requestedPair || 'UNKNOWN')
        .trim()
        .toUpperCase();
      if (!visiblePairSet.has(key)) continue;
      const previousCumulative = pairCumulative.get(key) || 0;
      const nextCumulative = previousCumulative + row.realizedPnl;
      pairCumulative.set(key, nextCumulative);
      const existing = groups.get(key) || [];
      existing.push({
        ...row,
        cumulativePnl: nextCumulative
      });
      groups.set(key, existing);
    }
    return visiblePairs.map((pair) => ({ pair, rows: [...(groups.get(pair) || [])].reverse() }));
  }, [pnlTimeline, requestedPair, visiblePairSet, visiblePairs]);
  const availablePairs = useMemo(() => {
    const pairs = new Set<string>(visiblePairs);
    for (const row of previousPairTabs) {
      if (row.pair) pairs.add(row.pair);
    }
    return Array.from(pairs).sort((leftPair, rightPair) => leftPair.localeCompare(rightPair));
  }, [previousPairTabs, visiblePairs]);
  const ledgerSections = useMemo(() => {
    const grouped: Record<LedgerFillState, TradeTransactionLedgerItem[]> = {
      unfilled: [],
      partial: [],
      filled: []
    };

    for (const row of ledger?.items || []) {
      grouped[classifyLedgerFillState(row)].push(row);
    }

    return [
      {
        key: 'unfilled',
        title: 'Unfilled / Pending',
        subtitle: 'Not filled yet (NEW, SENT, PENDING, or zero executed quantity).',
        badgeClassName: 'border-sky-300/40 bg-sky-500/20 text-sky-100',
        emptyState: 'No unfilled or pending rows found.',
        rows: grouped.unfilled
      },
      {
        key: 'partial',
        title: 'Partially Filled',
        subtitle: 'Partially executed quantity with open remainder.',
        badgeClassName: 'border-amber-300/40 bg-amber-500/20 text-amber-100',
        emptyState: 'No partially filled rows found.',
        rows: grouped.partial
      },
      {
        key: 'filled',
        title: 'Fully Filled / Executed',
        subtitle: 'Completed fills from exchange execution.',
        badgeClassName: 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100',
        emptyState: 'No fully filled rows found.',
        rows: grouped.filled
      }
    ] as const;
  }, [ledger]);

  return (
    <div className="orders-page space-y-6">
      <header className="space-y-2">
        <p className="section-label">Orders</p>
        <h2 className="text-3xl font-semibold text-main">MEXC spot order status</h2>
        <p className="text-sm muted-text">
          Understand if a spot trade executed, whether it is still open, and what your current holdings look like.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 text-xs uppercase tracking-[0.2em]">
        {[
          { label: 'Order Status', to: '/platform/orders' },
          { label: 'Sizing', to: '/platform/orders/sizing/details' },
          { label: 'Reports', to: '/platform/orders/reports' }
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `rounded-xl px-3 py-2 transition ${
                isActive ? 'bg-sky-500/20 text-sky-100' : 'text-gray-300 hover:bg-white/10'
              }`
            }
            end={item.to === '/platform/orders'}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <article className="card-shell space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Connected exchanges</p>
          <p className="text-sm text-gray-300">Pulled from Integrations so you can verify venue, credentials, and live status.</p>
        </div>
        {integrationsError && <p className="text-sm text-amber-300">{integrationsError}</p>}
        {integrationsLoading && <p className="text-sm text-gray-400">Loading connected exchanges…</p>}
        {!integrationsLoading && integrations.length === 0 && (
          <p className="text-sm text-gray-400">No connected exchange found. Connect MEXC in Integrations first.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {integrations.map((integration) => {
            const status = integrationStatusMeta(integration.status);
            const exchangeId = String(integration.exchange || '').toLowerCase();
            const iconSrc = EXCHANGE_ICON_MAP[exchangeId];
            const active = integration.id === integrationId;
            return (
              <button
                key={integration.id}
                type="button"
                onClick={() => setIntegrationId(integration.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  active ? 'border-primary-300/60 bg-primary-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className="h-8 w-8 rounded-lg border border-white/10 bg-white/5 p-1" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-white/80">
                        {String(integration.exchange || '?').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <p className="font-semibold text-white">{integration.label || integration.exchange}</p>
                      <p className="text-xs uppercase tracking-[0.12em] text-gray-400">{integration.environment || 'live'}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${status.chipClass}`}>
                    <span className={`h-2 w-2 rounded-full ${status.dotClass}`}></span>
                    {status.label}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-gray-300">
                  {integration.apiKeyMasked && <p>Key: {integration.apiKeyMasked}</p>}
                  <p>Integration ID: {integration.id}</p>
                  <p>Last tested: {formatDate(integration.lastTestedAt || null)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </article>

      <article className="card-shell space-y-4">
        <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Trading pair tabs</p>
              <p className="text-xs text-gray-400">Active pairs stay visible as separate tables. Click any previous pair to inspect it.</p>
            </div>
            <button
              type="button"
              onClick={handleRefreshPairTabs}
              disabled={pairTabsLoading}
              className="btn btn-secondary btn-small btn-rect disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pairTabsLoading ? 'Refreshing pairs...' : 'Refresh pairs'}
            </button>
          </div>
          {pairTabsError && <p className="mt-2 text-xs text-amber-200">{pairTabsError}</p>}
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-200">Active pairs</p>
              <div className="flex flex-wrap gap-2">
                {activePairs.length === 0 && <p className="text-xs text-gray-500">No active trading pairs found.</p>}
                {activePairTabs.map((item) => {
                  const active = requestedPair === item.pair;
                  return (
                    <button
                      key={`active-tab-${item.pair}`}
                      type="button"
                      onClick={() => handleSelectPairTab(item.pair)}
                      className={`rounded-lg border px-2.5 py-1 text-left text-[11px] leading-tight transition ${
                        active
                          ? 'border-emerald-300/60 bg-emerald-500/25 text-emerald-50'
                          : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                      }`}
                    >
                      <span className="block font-semibold">{item.pair}</span>
                      <span className="block text-[10px] text-emerald-100/80">{formatExchangeTime(item.lastSeenAt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-gray-300">Previous pairs</p>
              <div className="flex flex-wrap gap-2">
                {previousPairTabs.length === 0 && <p className="text-xs text-gray-500">No previous pairs recorded.</p>}
                {previousPairTabs.map((item) => {
                  const active = requestedPair === item.pair;
                  return (
                    <button
                      key={`previous-tab-${item.pair}`}
                      type="button"
                      onClick={() => handleSelectPairTab(item.pair)}
                      className={`rounded-lg border px-2.5 py-1 text-left text-[11px] leading-tight transition ${
                        active
                          ? 'border-sky-300/60 bg-sky-500/25 text-sky-50'
                          : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
                      }`}
                    >
                      <span className="block font-semibold">{item.pair}</span>
                      <span className="block text-[10px] text-gray-400">{formatExchangeTime(item.lastSeenAt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Selected pair
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="ETHUSDC"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
            />
          </label>
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Order ID
            <input
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
            />
          </label>
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Client Order ID
            <input
              value={origClientOrderId}
              onChange={(event) => setOrigClientOrderId(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
            />
          </label>
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Connected exchange
            <select
              value={integrationId}
              onChange={(event) => setIntegrationId(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
            >
              <option value="">Auto select</option>
              {integrations.map((integration) => (
                <option key={integration.id} value={integration.id}>
                  {(integration.label || integration.exchange).toString()} · {String(integration.status || 'unknown')}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleRefreshSnapshot}
            disabled={loading}
            className="btn btn-secondary btn-small btn-rect disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Checking...' : 'Refresh status'}
          </button>
          <p className="text-xs text-gray-400">
            {snapshot?.checkedAt ? `Last checked: ${new Date(snapshot.checkedAt).toLocaleString()}` : 'No data loaded yet.'}
          </p>
          <p className="text-xs text-gray-500">
            Integration: {selectedIntegration?.label || snapshot?.integration?.label || 'MEXC'} (
            {selectedIntegration?.status || snapshot?.integration?.status || 'unknown'})
          </p>
          {activePairSnapshotsLoading && <p className="text-xs text-emerald-200">Refreshing active pair tables...</p>}
        </div>
        {selectedIntegration && (
          <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs text-gray-300">
            <p>
              Selected venue: <span className="font-semibold text-white">{selectedIntegration.exchange.toUpperCase()}</span> ·{' '}
              {selectedIntegration.environment || 'live'} · ID {selectedIntegration.id}
            </p>
            {selectedIntegration.apiKeyMasked && <p className="mt-1">API key: {selectedIntegration.apiKeyMasked}</p>}
            <p className="mt-1">Last tested: {formatDate(selectedIntegration.lastTestedAt || null)}</p>
          </div>
        )}
        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs text-gray-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              Pair verification: requested <span className="font-semibold text-white">{pairVerification.requestedPair || '—'}</span>
            </p>
            <span
              className={`inline-flex rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                pairVerification.verified
                  ? 'border-emerald-400/35 bg-emerald-500/20 text-emerald-100'
                  : 'border-rose-400/35 bg-rose-500/20 text-rose-100'
              }`}
            >
              {pairVerification.verified ? 'Verified on exchange' : 'Not verified'}
            </span>
          </div>
          <p className="mt-1">
            Exchange pair: <span className="font-semibold text-white">{pairVerification.exchangePair || '—'}</span>
            {pairVerification.baseAsset && pairVerification.quoteAsset
              ? ` · ${pairVerification.baseAsset}/${pairVerification.quoteAsset}`
              : ''}
          </p>
          <p className="mt-1">
            Min notional: {formatMaybeDecimal(pairVerification.minNotional, 6)} · Min qty:{' '}
            {formatMaybeDecimal(pairVerification.minQty, 8)} · Step size: {formatMaybeDecimal(pairVerification.stepSize, 8)}
          </p>
          <p className="mt-1">
            Pair tabs (active + previous):{' '}
            <span className="font-semibold text-white">{availablePairs.length ? availablePairs.join(', ') : '—'}</span>
          </p>
          {!pairVerification.verified && pairVerification.error && (
            <p className="mt-1 text-rose-300">Verification error: {pairVerification.error}</p>
          )}
        </div>
        <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs text-gray-300">
          Uses MEXC Spot endpoints: <code className="text-sky-200">GET /api/v3/order</code>,{' '}
          <code className="text-sky-200">GET /api/v3/myTrades</code>,{' '}
          <code className="text-sky-200">GET /api/v3/openOrders</code>,{' '}
          <code className="text-sky-200">GET /api/v3/account</code>.
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </article>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Did the trade happen?</p>
          <div className={statusPill(snapshot?.didTradeHappen?.answer)}>
            {snapshot ? (snapshot.didTradeHappen.answer ? 'Executed' : 'Not executed yet') : 'Unknown'}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-gray-300">
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Order status</p>
              <p className="mt-1 font-semibold text-white">{orderData?.status || '—'}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Executed qty</p>
              <p className="mt-1 font-semibold text-white">{formatDecimal(orderData?.executedQty)}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Fill count</p>
              <p className="mt-1 font-semibold text-white">{tradesData?.count ?? 0}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Filled quote</p>
              <p className="mt-1 font-semibold text-white">{formatDecimal(tradesData?.totalQuoteQty, 4)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Rule: if <code>executedQty &gt; 0</code> or <code>myTrades</code> has fills, then the trade happened.
          </p>
        </article>

        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Is it still open?</p>
          <div className={statusPill(snapshot?.isStillOpen?.answer)}>
            {snapshot ? (snapshot.isStillOpen.answer ? 'Still open' : 'Not open') : 'Unknown'}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-gray-300">
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Open orders for symbol</p>
              <p className="mt-1 font-semibold text-white">{openData?.countForSymbol ?? 0}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Matching open orders</p>
              <p className="mt-1 font-semibold text-white">{openData?.matchingCount ?? 0}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Rule: if order appears in <code>openOrders</code>, it is still open.
          </p>
        </article>

        <article className="card-shell space-y-3 xl:col-span-2">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Open orders table</p>
            <p className="text-sm text-gray-300">
              Live open orders from <code>GET /api/v3/openOrders</code> grouped by active pair (plus selected previous pair).
            </p>
            {hasOpenOrderFilter && !usingOpenOrderFilterFallback && (
              <p className="text-xs text-gray-500">
                Showing matching orders for the supplied order filters.
              </p>
            )}
            {usingOpenOrderFilterFallback && (
              <p className="text-xs text-amber-200">
                No exact order-id match found. Showing all open orders for the selected symbol.
              </p>
            )}
            <p className="text-xs text-gray-500">Active filters: {openOrderFilterSummary}</p>
            <p className="text-xs text-gray-500">
              Rows shown: {totalOpenRowsShown} · selected-pair matching: {matchingOpenOrders.length} · selected-pair total open:{' '}
              {openOrdersItems.length}
            </p>
            {!openOrdersSourceOk && (
              <p className="text-xs text-rose-300">Open orders source error: {openOrdersSourceError || 'Request failed'}</p>
            )}
          </div>
          {loading && (
            <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/5">
              <table className="min-w-[1100px] w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">Order ID</th>
                    <th className="px-3 py-2">Client ID</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Orig Qty</th>
                    <th className="px-3 py-2">Exec Qty</th>
                    <th className="px-3 py-2">Quote Filled</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  <tr>
                    <td className="px-3 py-4 text-gray-500" colSpan={10}>
                      Loading open orders...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!loading &&
            openOrdersByPair.map(({ pair, rows }) => (
              <section key={`open-orders-${pair}`} className="space-y-2 rounded-2xl border border-white/8 bg-white/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{pair}</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                        activePairSet.has(pair)
                          ? 'border-emerald-400/35 bg-emerald-500/20 text-emerald-100'
                          : 'border-slate-300/30 bg-slate-500/20 text-slate-100'
                      }`}
                    >
                      {activePairSet.has(pair) ? 'Active pair' : 'Selected previous'}
                    </span>
                    <span className="inline-flex rounded-lg border border-sky-300/35 bg-sky-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-sky-100">
                      {rows.length} open
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/8 bg-black/20">
                  <table className="min-w-[1100px] w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        <th className="px-3 py-2">Updated</th>
                        <th className="px-3 py-2">Order ID</th>
                        <th className="px-3 py-2">Client ID</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Price</th>
                        <th className="px-3 py-2">Orig Qty</th>
                        <th className="px-3 py-2">Exec Qty</th>
                        <th className="px-3 py-2">Quote Filled</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-200">
                      {rows.length === 0 && (
                        <tr>
                          <td className="px-3 py-4 text-gray-500" colSpan={10}>
                            {emptyOpenOrdersMessage}
                          </td>
                        </tr>
                      )}
                      {rows.map((row, index) => (
                        <tr key={String(row.orderId || row.clientOrderId || `${pair}-${index}`)} className="border-t border-white/5">
                          <td className="px-3 py-2 text-xs text-gray-400">{formatExchangeTime(row.updateTime || row.time)}</td>
                          <td className="px-3 py-2 font-semibold text-white">{row.orderId ? String(row.orderId) : '—'}</td>
                          <td className="px-3 py-2 text-xs text-gray-300">{row.clientOrderId || row.origClientOrderId || '—'}</td>
                          <td className="px-3 py-2">{row.side || '—'}</td>
                          <td className="px-3 py-2">{row.type || '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${ledgerStatusBadgeClass(row.status)}`}>
                              {row.status || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2">{formatMaybeDecimal(row.price, 6)}</td>
                          <td className="px-3 py-2">{formatMaybeDecimal(row.origQty, 8)}</td>
                          <td className="px-3 py-2">{formatMaybeDecimal(row.executedQty, 8)}</td>
                          <td className="px-3 py-2">{formatMaybeDecimal(row.cummulativeQuoteQty, 6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
        </article>

        <article className="card-shell space-y-3 xl:col-span-2">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Executed fills (exchange)</p>
            <p className="text-sm text-gray-300">
              Direct fills from <code>GET /api/v3/myTrades</code> grouped by active pair (plus selected previous pair).
            </p>
          </div>
          {loading && (
            <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/5">
              <table className="min-w-[1000px] w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    <th className="px-3 py-2">Trade Time</th>
                    <th className="px-3 py-2">Order ID</th>
                    <th className="px-3 py-2">Client ID</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Quote Qty</th>
                    <th className="px-3 py-2">Fee</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  <tr>
                    <td className="px-3 py-4 text-gray-500" colSpan={8}>
                      Loading executed fills...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!loading &&
            executedFillsByPair.map(({ pair, rows }) => (
              <section key={`executed-fills-${pair}`} className="space-y-2 rounded-2xl border border-white/8 bg-white/5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{pair}</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                        activePairSet.has(pair)
                          ? 'border-emerald-400/35 bg-emerald-500/20 text-emerald-100'
                          : 'border-slate-300/30 bg-slate-500/20 text-slate-100'
                      }`}
                    >
                      {activePairSet.has(pair) ? 'Active pair' : 'Selected previous'}
                    </span>
                    <span className="inline-flex rounded-lg border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-100">
                      {rows.length} fills
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/8 bg-black/20">
                  <table className="min-w-[1000px] w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        <th className="px-3 py-2">Trade Time</th>
                        <th className="px-3 py-2">Order ID</th>
                        <th className="px-3 py-2">Client ID</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2">Price</th>
                        <th className="px-3 py-2">Qty</th>
                        <th className="px-3 py-2">Quote Qty</th>
                        <th className="px-3 py-2">Fee</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-200">
                      {rows.length === 0 && (
                        <tr>
                          <td className="px-3 py-4 text-gray-500" colSpan={8}>
                            No executed fills returned by exchange for this pair.
                          </td>
                        </tr>
                      )}
                      {rows.map((fill, index) => {
                        const side = fill.side || (fill.isBuyer === true ? 'BUY' : fill.isBuyer === false ? 'SELL' : '—');
                        return (
                          <tr key={String(fill.id || fill.orderId || fill.clientOrderId || `${pair}-${index}`)} className="border-t border-white/5">
                            <td className="px-3 py-2 text-xs text-gray-400">{formatExchangeTime(fill.time)}</td>
                            <td className="px-3 py-2 font-semibold text-white">{fill.orderId ? String(fill.orderId) : '—'}</td>
                            <td className="px-3 py-2 text-xs text-gray-300">{fill.clientOrderId || '—'}</td>
                            <td className="px-3 py-2">{side}</td>
                            <td className="px-3 py-2">{formatMaybeDecimal(fill.price, 6)}</td>
                            <td className="px-3 py-2">{formatMaybeDecimal(fill.qty, 8)}</td>
                            <td className="px-3 py-2">{formatMaybeDecimal(fill.quoteQty, 6)}</td>
                            <td className="px-3 py-2">
                              {formatMaybeDecimal(fill.commission, 8)} {fill.commissionAsset || ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
        </article>

        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Current balance</p>
          <p className="text-sm text-gray-300">
            From <code>GET /api/v3/account</code> (free + locked).
          </p>
          <div className="overflow-x-auto rounded-2xl border border-white/8 bg-white/5">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Free</th>
                  <th className="px-3 py-2">Locked</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {topBalances.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-gray-500" colSpan={4}>
                      No funded assets found.
                    </td>
                  </tr>
                )}
                {topBalances.map((asset: any) => (
                  <tr key={asset.asset} className="border-t border-white/5">
                    <td className="px-3 py-2 font-semibold">{asset.asset}</td>
                    <td className="px-3 py-2">{formatDecimal(asset.free)}</td>
                    <td className="px-3 py-2">{formatDecimal(asset.locked)}</td>
                    <td className="px-3 py-2">{formatDecimal(asset.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">Assets with funds: {balanceData?.assetsWithFunds ?? 0}</p>
        </article>

        <article className="card-shell space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Open position (spot inference)</p>
          <div className="rounded-xl border border-white/8 bg-white/5 p-3 text-sm text-gray-300">
            Spot does not provide a separate “positions” object. Exposure is inferred from balances and open orders.
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-gray-300">
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Holdings tracked</p>
              <p className="mt-1 font-semibold text-white">{holdings.length}</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Open orders count</p>
              <p className="mt-1 font-semibold text-white">{exposureData?.openOrdersCount ?? 0}</p>
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto rounded-xl border border-white/8 bg-black/20 p-3 text-xs text-gray-300">
            {holdings.length === 0 && <p className="text-gray-500">No spot exposure detected.</p>}
            {holdings.map((item: any) => (
              <p key={item.asset} className="py-1">
                <span className="font-semibold text-white">{item.asset}</span> total {formatDecimal(item.total)}
              </p>
            ))}
          </div>
        </article>
      </section>

      <article className="card-shell space-y-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Trade transaction table</p>
          <p className="text-sm text-gray-300">
            Ledger rows used by bots for amount, quantity, buy/sell pricing, market pricing, PnL, and account balance math.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Database
            <select
              value={ledgerDbId}
              onChange={(event) => setLedgerDbId(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
              disabled={ledgerDbLoading}
            >
              <option value="">Select database</option>
              {ledgerDatabases.map((db) => (
                <option key={db.id} value={db.id}>
                  {db.name} · {db.region || 'n/a'}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Symbol filter
            <input
              value={ledgerSymbol}
              onChange={(event) => setLedgerSymbol(event.target.value.toUpperCase())}
              placeholder="All symbols"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
            />
          </label>

          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Rows
            <select
              value={ledgerLimit}
              onChange={(event) => setLedgerLimit(Math.max(1, Number(event.target.value) || 25))}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-primary-300/60"
            >
              {[25, 50, 100, 200, 500].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleRefreshLedger}
              disabled={ledgerLoading}
              className="btn btn-secondary btn-small btn-rect w-full disabled:cursor-not-allowed disabled:opacity-60"
            >
              {ledgerLoading ? 'Refreshing...' : 'Refresh ledger'}
            </button>
          </div>
        </div>

        {ledgerDbError && <p className="text-sm text-amber-300">{ledgerDbError}</p>}
        {ledgerError && <p className="text-sm text-rose-300">{ledgerError}</p>}
        {!ledgerDbLoading && ledgerDatabases.length === 0 && (
          <p className="text-sm text-sky-200">
            No database instance is configured for this workspace. Showing direct workspace trade ledger.
          </p>
        )}

        {(selectedLedgerDatabase || ledger) && (
          <div className="grid gap-3 rounded-2xl border border-white/8 bg-white/5 p-4 text-xs text-gray-300 md:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Database</p>
              <p className="mt-1 font-semibold text-white">{selectedLedgerDatabase?.name || ledger?.database?.name || 'Workspace trade ledger'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Records</p>
              <p className="mt-1 font-semibold text-white">{(ledger?.total || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Realized PnL</p>
              <p className="mt-1 font-semibold text-white">{formatMaybeDecimal(ledger?.summary?.realizedPnl, 4)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Total Value</p>
              <p className="mt-1 font-semibold text-white">{formatMaybeDecimal(ledger?.summary?.totalValue, 4)}</p>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          Executed ledger rows can appear empty when orders are inserted as <code>NEW</code> and not yet reconciled back into the
          trade ledger. Use the <strong>Executed fills (exchange)</strong> table above for exchange-truth fills.
        </div>

        <article className="space-y-3 rounded-2xl border border-white/8 bg-white/5 p-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Profit &amp; loss</p>
            <p className="text-sm text-gray-300">
              Realized PnL timeline from trade ledger rows and cumulative curve.
            </p>
          </div>
          <LiveLineChart title="Cumulative Realized PnL" data={pnlChartData} unit="quote" color="#34d399" />
          {ledgerLoading && (
            <div className="overflow-x-auto rounded-2xl border border-white/8 bg-black/20">
              <table className="min-w-[760px] w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                    <th className="px-3 py-2">Executed</th>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Realized PnL</th>
                    <th className="px-3 py-2">Cumulative PnL</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  <tr>
                    <td className="px-3 py-4 text-gray-500" colSpan={6}>
                      Loading PnL rows...
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!ledgerLoading &&
            pnlByPair.map(({ pair, rows }) => (
              <section key={`pnl-pair-${pair}`} className="space-y-2 rounded-2xl border border-white/8 bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500">{pair}</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-lg border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                        activePairSet.has(pair)
                          ? 'border-emerald-400/35 bg-emerald-500/20 text-emerald-100'
                          : 'border-slate-300/30 bg-slate-500/20 text-slate-100'
                      }`}
                    >
                      {activePairSet.has(pair) ? 'Active pair' : 'Selected previous'}
                    </span>
                    <span className="inline-flex rounded-lg border border-emerald-400/35 bg-emerald-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-100">
                      {rows.length} rows
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/8 bg-black/30">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        <th className="px-3 py-2">Executed</th>
                        <th className="px-3 py-2">Symbol</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Realized PnL</th>
                        <th className="px-3 py-2">Cumulative PnL</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-200">
                      {rows.length === 0 && (
                        <tr>
                          <td className="px-3 py-4 text-gray-500" colSpan={6}>
                            No PnL rows available for this pair.
                          </td>
                        </tr>
                      )}
                      {rows.slice(0, 100).map((row, index) => (
                        <tr key={`pnl-${pair}-${row.id || index}`} className="border-t border-white/5">
                          <td className="px-3 py-2 text-xs text-gray-400">{formatExchangeTime(row.ts)}</td>
                          <td className="px-3 py-2 font-semibold text-white">{row.symbol}</td>
                          <td className="px-3 py-2">{row.side}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${ledgerStatusBadgeClass(row.status)}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className={`px-3 py-2 font-semibold ${pnlValueClass(row.realizedPnl)}`}>
                            {formatMaybeDecimal(row.realizedPnl, 6)}
                          </td>
                          <td className={`px-3 py-2 font-semibold ${pnlValueClass(row.cumulativePnl)}`}>
                            {formatMaybeDecimal(row.cumulativePnl, 6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
        </article>

        <div className="space-y-5">
          {ledgerSections.map((section) => (
            <LedgerSectionTable
              key={section.key}
              title={section.title}
              subtitle={section.subtitle}
              badgeClassName={section.badgeClassName}
              rows={section.rows}
              loading={ledgerLoading}
              emptyState={section.emptyState}
            />
          ))}
        </div>
      </article>

    </div>
  );
}
