import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { fetchOrderReport, type OrderReportRow } from '../../../api/orders';
import { listIntegrations } from '../../../api/integrations';
import SizingDebugCard from '../../../components/SizingDebugCard';

type Integration = Awaited<ReturnType<typeof listIntegrations>>[number];

function formatDate(input?: string | null) {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
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

export default function SignalExchangeReportsPage() {
  const [symbol, setSymbol] = useState('BTCUSDC');
  const [integrationId, setIntegrationId] = useState('');
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsError, setIntegrationsError] = useState('');
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
  const [selectedSizingRow, setSelectedSizingRow] = useState<OrderReportRow | null>(null);

  const refreshReport = useCallback(async () => {
    if (!symbol.trim()) {
      setReportError('Please enter a symbol like BTCUSDC.');
      return;
    }

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
    refreshReport();
    // Load once with default symbol; subsequent checks are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!integrationId) return;
    refreshReport();
  }, [integrationId, refreshReport]);

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
    <div className="layout-container pt-16 pb-24 space-y-6">
      <header className="space-y-2">
        <p className="section-label">Platform · Orders · Reports</p>
        <h1 className="headline text-3xl">Signal vs Exchange reports</h1>
        <p className="muted-text max-w-3xl text-sm">
          1:1 execution audit ledger. Left rows are TradingView signals. Right rows are exchange outcomes for the same signal.
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
        <div className="grid gap-3 md:grid-cols-3">
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
          <div className="flex items-end">
            <button
              type="button"
              onClick={refreshReport}
              disabled={reportLoading}
              className="btn btn-secondary btn-small btn-rect disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reportLoading ? 'Refreshing...' : 'Refresh report'}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <p>Updated: {formatDate(reportUpdatedAt)}</p>
          {integrationsLoading && <p className="text-gray-400">Loading connected exchanges…</p>}
          {!integrationsLoading && integrations.length === 0 && (
            <p className="text-gray-400">No connected exchange found. Connect MEXC in Integrations first.</p>
          )}
          {integrationsError && <p className="text-amber-300">{integrationsError}</p>}
        </div>
      </article>

      <article className="card-shell space-y-4">
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
                    <th className="px-3 py-2">Qty (Rounded)</th>
                    <th className="px-3 py-2">Price Used</th>
                    <th className="px-3 py-2">Spend (BUY)</th>
                    <th className="px-3 py-2">Rejection Reason</th>
                    <th className="px-3 py-2">Order ID</th>
                    <th className="px-3 py-2">Position after</th>
                    <th className="px-3 py-2">Error reason</th>
                    <th className="px-3 py-2">Sizing</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {reportLoading && (
                    <tr>
                      <td className="px-3 py-3 text-gray-400" colSpan={14}>
                        Loading report…
                      </td>
                    </tr>
                  )}
                  {!reportLoading && reportRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={14}>
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
                        <td className="px-3 py-2">{formatNullableDecimal(row.sizing?.qtyRounded ?? null, 6)}</td>
                        <td className="px-3 py-2">{formatNullableDecimal(row.sizing?.computedPrice ?? null, 4)}</td>
                        <td className="px-3 py-2">
                          {row.exchange.side === 'BUY'
                            ? formatNullableDecimal(row.sizing?.quoteSpendComputed ?? null, 4)
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-rose-200">
                          {row.sizing?.rejectedReason || '—'}
                        </td>
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
                        <td className="px-3 py-2">
                          {row.sizing?.sizingDebug ? (
                            <button
                              type="button"
                              className="rounded-md border border-sky-400/40 bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-sky-200"
                              onClick={() => setSelectedSizingRow(row)}
                            >
                              View
                            </button>
                          ) : (
                            <span className="text-xs text-gray-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </article>

      {selectedSizingRow?.sizing?.sizingDebug && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl">
            <SizingDebugCard
              sizingDebug={selectedSizingRow.sizing.sizingDebug}
              title="Sizing details"
              subtitle={`${selectedSizingRow.signal?.symbol || '—'} · ${selectedSizingRow.exchange?.side || '—'} · ${selectedSizingRow.exchange?.tradeStatus || '—'}`}
              extra={(
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-rect"
                  onClick={() => setSelectedSizingRow(null)}
                >
                  Close
                </button>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}
