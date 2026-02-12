import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchMexcSpotSnapshot, fetchOrderReport, type OrderCheckSnapshot, type OrderReportRow } from '../../../api/orders';
import { listIntegrations } from '../../../api/integrations';

type Integration = Awaited<ReturnType<typeof listIntegrations>>[number];

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

function formatNullableDecimal(value: unknown, digits = 8) {
  if (value === null || value === undefined || value === '') return '—';
  return formatDecimal(value, digits);
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

function tradeStatusClass(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'executed') return 'text-emerald-200';
  if (normalized === 'rejected') return 'text-rose-200';
  if (normalized === 'retried') return 'text-amber-200';
  if (normalized === 'pending') return 'text-sky-200';
  return 'text-slate-200';
}

function tradeStatusBadge(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'executed') return 'border-emerald-300/40 bg-emerald-500/20 text-emerald-100';
  if (normalized === 'rejected') return 'border-rose-300/40 bg-rose-500/20 text-rose-100';
  if (normalized === 'retried') return 'border-amber-300/40 bg-amber-500/20 text-amber-100';
  if (normalized === 'pending') return 'border-sky-300/40 bg-sky-500/20 text-sky-100';
  return 'border-slate-300/30 bg-slate-500/20 text-slate-100';
}

export default function OrdersModule() {
  const [symbol, setSymbol] = useState('BTCUSDC');
  const [orderId, setOrderId] = useState('');
  const [origClientOrderId, setOrigClientOrderId] = useState('');
  const [integrationId, setIntegrationId] = useState('');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsError, setIntegrationsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<OrderCheckSnapshot | null>(null);
  const [reportRows, setReportRows] = useState<OrderReportRow[]>([]);
  const [reportSummary, setReportSummary] = useState({
    executed: 0,
    rejected: 0,
    pending: 0,
    retried: 0,
    unmatched: 0
  });
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [reportUpdatedAt, setReportUpdatedAt] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    if (!symbol.trim()) {
      setError('Please enter a symbol like BTCUSDC.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchMexcSpotSnapshot({
        symbol,
        orderId: orderId || undefined,
        origClientOrderId: origClientOrderId || undefined,
        integrationId: integrationId || undefined
      });
      setSnapshot(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch MEXC order diagnostics.');
    } finally {
      setLoading(false);
    }
  }, [integrationId, orderId, origClientOrderId, symbol]);

  const refreshReport = useCallback(async () => {
    setReportLoading(true);
    setReportError('');
    try {
      const data = await fetchOrderReport({
        symbol,
        integrationId: integrationId || undefined,
        limit: 20
      });
      setReportRows(Array.isArray(data?.items) ? data.items : []);
      setReportSummary({
        executed: Number(data?.summary?.executed || 0),
        rejected: Number(data?.summary?.rejected || 0),
        pending: Number(data?.summary?.pending || 0),
        retried: Number(data?.summary?.retried || 0),
        unmatched: Number(data?.summary?.unmatched || 0)
      });
      setReportUpdatedAt(data?.generatedAt || new Date().toISOString());
    } catch (err: any) {
      setReportError(err?.message || 'Failed to load signal/exchange report.');
      setReportRows([]);
      setReportSummary({ executed: 0, rejected: 0, pending: 0, retried: 0, unmatched: 0 });
    } finally {
      setReportLoading(false);
    }
  }, [integrationId, symbol]);

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

  useEffect(() => {
    refreshSnapshot();
    refreshReport();
    // Load once with default symbol; subsequent checks are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!integrationId) return;
    refreshReport();
  }, [integrationId, refreshReport]);

  const handleRefreshAll = useCallback(() => {
    refreshSnapshot();
    refreshReport();
  }, [refreshSnapshot, refreshReport]);

  const orderData = snapshot?.didTradeHappen?.source?.order?.data || {};
  const tradesData = snapshot?.didTradeHappen?.source?.myTrades?.data || {};
  const openData = snapshot?.isStillOpen?.source?.data || {};
  const balanceData = snapshot?.currentBalance?.source?.data || {};
  const exposureData = snapshot?.openPosition?.source?.data || {};

  const topBalances = useMemo(
    () => (Array.isArray(balanceData?.topAssets) ? balanceData.topAssets : []),
    [balanceData]
  );
  const holdings = useMemo(
    () => (Array.isArray(exposureData?.holdings) ? exposureData.holdings : []),
    [exposureData]
  );
  const selectedIntegration = useMemo(
    () => integrations.find((integration) => integration.id === integrationId) || null,
    [integrationId, integrations]
  );
  const reportCards = useMemo(
    () => [
      {
        key: 'executed',
        label: 'Executed',
        value: reportSummary.executed,
        chip: 'border-emerald-300/40 bg-emerald-500/20 text-emerald-100'
      },
      {
        key: 'rejected',
        label: 'Rejected',
        value: reportSummary.rejected,
        chip: 'border-rose-300/40 bg-rose-500/20 text-rose-100'
      },
      {
        key: 'pending',
        label: 'Pending',
        value: reportSummary.pending,
        chip: 'border-sky-300/40 bg-sky-500/20 text-sky-100'
      },
      {
        key: 'retried',
        label: 'Retried',
        value: reportSummary.retried,
        chip: 'border-amber-300/40 bg-amber-500/20 text-amber-100'
      },
      {
        key: 'unmatched',
        label: 'Unmatched',
        value: reportSummary.unmatched,
        chip: 'border-slate-300/30 bg-slate-500/20 text-slate-100'
      }
    ],
    [reportSummary]
  );

  return (
    <div className="orders-page space-y-6">
      <header className="space-y-2">
        <p className="section-label">Orders</p>
        <h2 className="text-3xl font-semibold text-main">MEXC spot order status</h2>
        <p className="text-sm muted-text">
          Understand if a spot trade executed, whether it is still open, and what your current holdings look like.
        </p>
      </header>

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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs uppercase tracking-[0.14em] text-gray-400">
            Symbol
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              placeholder="BTCUSDC"
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
            onClick={handleRefreshAll}
            disabled={loading || reportLoading}
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
          Uses MEXC Spot endpoints: <code className="text-sky-200">GET /api/v3/order</code>,{' '}
          <code className="text-sky-200">GET /api/v3/myTrades</code>,{' '}
          <code className="text-sky-200">GET /api/v3/openOrders</code>,{' '}
          <code className="text-sky-200">GET /api/v3/account</code>.
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </article>

      <article className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-gray-500">Signal vs exchange report</p>
            <p className="text-sm text-gray-300">
              1:1 execution audit ledger. Left rows are TradingView signals. Right rows are exchange outcomes for the same signal.
            </p>
          </div>
          <p className="text-xs text-gray-500">Updated: {formatDate(reportUpdatedAt)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {reportCards.map((card) => (
            <div key={card.key} className={`rounded-2xl border px-3 py-2 text-xs ${card.chip}`}>
              <p className="uppercase tracking-[0.18em]">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{card.value}</p>
            </div>
          ))}
        </div>
        {reportError && <p className="text-sm text-rose-300">{reportError}</p>}
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">TradingView signals</p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#151a2f]">
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-400">
                    <th className="px-3 py-2">Alert ID</th>
                    <th className="px-3 py-2">Signal</th>
                    <th className="px-3 py-2">Timestamp</th>
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Sent</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {reportLoading && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={6}>
                        Loading report…
                      </td>
                    </tr>
                  )}
                  {!reportLoading && reportRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={6}>
                        No signal rows yet.
                      </td>
                    </tr>
                  )}
                  {!reportLoading &&
                    reportRows.map((row) => (
                      <tr key={`signal-${row.key}`} className="border-t border-white/5">
                        <td className="px-3 py-2 font-mono text-xs text-sky-200">{row.signal.id || '—'}</td>
                        <td className="px-3 py-2 uppercase">{row.audit?.signal || row.signal.side || '—'}</td>
                        <td className="px-3 py-2 text-xs">{formatDate(row.signal.timestamp)}</td>
                        <td className="px-3 py-2 font-semibold">{row.signal.symbol || '—'}</td>
                        <td className="px-3 py-2 uppercase">{row.signal.side || '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={`inline-flex rounded-md border px-2 py-1 uppercase tracking-[0.14em] ${
                              row.audit?.sentToExchange
                                ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
                                : 'border-slate-300/30 bg-slate-500/20 text-slate-200'
                            }`}
                          >
                            {row.audit?.sentToExchange ? 'Yes' : 'No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-gray-400">Exchange report</p>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#151a2f]">
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-400">
                    <th className="px-3 py-2">Trade status</th>
                    <th className="px-3 py-2">Execution time</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Quantity</th>
                    <th className="px-3 py-2">Order ID</th>
                    <th className="px-3 py-2">Position after</th>
                    <th className="px-3 py-2">Error reason</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {reportLoading && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={9}>
                        Loading report…
                      </td>
                    </tr>
                  )}
                  {!reportLoading && reportRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={9}>
                        No exchange rows yet.
                      </td>
                    </tr>
                  )}
                  {!reportLoading &&
                    reportRows.map((row) => (
                      <tr key={`exchange-${row.key}`} className="border-t border-white/5">
                        <td className="px-3 py-2 uppercase">
                          <span className={`inline-flex rounded-md border px-2 py-1 ${tradeStatusBadge(row.exchange.tradeStatus)} ${tradeStatusClass(row.exchange.tradeStatus)}`}>
                            {row.exchange.tradeStatus || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{formatDate(row.exchange.executionTimestamp)}</td>
                        <td className="px-3 py-2 uppercase">{row.exchange.side || '—'}</td>
                        <td className="px-3 py-2 uppercase">{row.exchange.type || '—'}</td>
                        <td className="px-3 py-2">{formatNullableDecimal(row.exchange.amount, 4)}</td>
                        <td className="px-3 py-2">{formatNullableDecimal(row.exchange.quantity, 4)}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{row.exchange.orderId || '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          {row.exchange.positionAfter?.state || 'UNKNOWN'}
                          {row.exchange.positionAfter?.estimatedBaseQty !== null &&
                            row.exchange.positionAfter?.estimatedBaseQty !== undefined &&
                            ` (${formatNullableDecimal(row.exchange.positionAfter?.estimatedBaseQty, 6)})`}
                        </td>
                        <td className="max-w-[260px] px-3 py-2 text-xs text-rose-200" title={row.exchange.errorMessage || ''}>
                          {row.exchange.errorMessage || '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
    </div>
  );
}
