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

function toDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateInput(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function isSameCalendarDate(input: string | null | undefined, target: Date | null) {
  if (!input || !target) return false;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function summarizeRows(rows: OrderReportRow[]) {
  return rows.reduce(
    (acc, row) => {
      const status = String(row.exchange?.tradeStatus || '').toLowerCase();
      if (status === 'executed') acc.executed += 1;
      else if (status === 'rejected') acc.rejected += 1;
      else if (status === 'pending') acc.pending += 1;
      else if (status === 'retried') acc.retried += 1;
      if (status === 'unmatched' || String(row.matchType || '').toLowerCase() === 'unmatched') acc.unmatched += 1;
      return acc;
    },
    { executed: 0, rejected: 0, pending: 0, retried: 0, unmatched: 0 }
  );
}

export default function SignalExchangeReportsPage() {
  const [symbol, setSymbol] = useState('BTCUSDC');
  const [integrationId, setIntegrationId] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
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
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  const visibleDate = useMemo(() => parseDateInput(selectedDate), [selectedDate]);
  const filteredRows = useMemo(() => {
    if (!visibleDate) return reportRows;
    return reportRows.filter((row) => {
      const signalTime = row.signal?.timestamp || null;
      const executionTime = row.exchange?.executionTimestamp || null;
      return isSameCalendarDate(signalTime, visibleDate) || isSameCalendarDate(executionTime, visibleDate);
    });
  }, [reportRows, visibleDate]);

  const filteredSummary = useMemo(() => summarizeRows(filteredRows), [filteredRows]);

  const activeSummary = useMemo(
    () => (visibleDate ? filteredSummary : reportSummary),
    [filteredSummary, reportSummary, visibleDate]
  );

  const handleDeleteVisibleRows = useCallback(() => {
    const confirmed = window.confirm('Delete current visible rows from this view?');
    if (!confirmed) return;
    setDeleteLoading(true);
    const nextRows = reportRows.filter((row) => {
      if (!visibleDate) return false;
      const signalTime = row.signal?.timestamp || null;
      const executionTime = row.exchange?.executionTimestamp || null;
      return !(isSameCalendarDate(signalTime, visibleDate) || isSameCalendarDate(executionTime, visibleDate));
    });
    setReportRows(nextRows);
    setReportSummary(summarizeRows(nextRows));
    setSelectedSizingRow(null);
    setDeleteLoading(false);
  }, [reportRows, visibleDate]);

  const reportCards = useMemo(
    () => [
      {
        key: 'executed',
        label: 'Executed',
        value: activeSummary.executed,
        chip: 'border-emerald-300/40 bg-emerald-500/20 text-emerald-100'
      },
      {
        key: 'rejected',
        label: 'Rejected',
        value: activeSummary.rejected,
        chip: 'border-rose-300/40 bg-rose-500/20 text-rose-100'
      },
      {
        key: 'pending',
        label: 'Pending',
        value: activeSummary.pending,
        chip: 'border-sky-300/40 bg-sky-500/20 text-sky-100'
      },
      {
        key: 'retried',
        label: 'Retried',
        value: activeSummary.retried,
        chip: 'border-amber-300/40 bg-amber-500/20 text-amber-100'
      },
      {
        key: 'unmatched',
        label: 'Unmatched',
        value: activeSummary.unmatched,
        chip: 'border-slate-300/30 bg-slate-500/20 text-slate-100'
      }
    ],
    [activeSummary]
  );

  return (
    <div className="layout-container orders-page reports-page pt-16 pb-24 space-y-6">
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
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                <line x1="16" y1="2.5" x2="16" y2="6"></line>
                <line x1="8" y1="2.5" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </span>
            <input
              type="date"
              className="rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-gray-200 focus:border-primary-300 focus:outline-none"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={refreshReport}
            disabled={reportLoading}
            className="btn btn-secondary btn-small btn-rect disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reportLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={handleDeleteVisibleRows}
            disabled={deleteLoading || filteredRows.length === 0}
            className="btn btn-danger btn-small btn-rect disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleteLoading ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(toDateInputValue(new Date()))}
            className="btn btn-secondary btn-small btn-rect"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate('')}
            className="btn btn-secondary btn-small btn-rect"
          >
            All Dates
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <p>Updated: {formatDate(reportUpdatedAt)}</p>
          <p>Rows: {filteredRows.length}</p>
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
        <div className="space-y-4">
          <div className="rounded-xl bg-white/[0.03]">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">TradingView signals</p>
            </div>
            <div className="max-h-[440px] overflow-auto rounded-b-xl">
              <table className="min-w-[980px] w-full table-fixed text-[13px] leading-5">
                <colgroup>
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-white/5">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                    <th className="px-3 py-2.5">Alert ID</th>
                    <th className="px-3 py-2.5">Signal</th>
                    <th className="px-3 py-2.5">Timestamp</th>
                    <th className="px-3 py-2.5">Symbol</th>
                    <th className="px-3 py-2.5">Side</th>
                    <th className="px-3 py-2.5">Sent</th>
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
                  {!reportLoading && filteredRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={6}>
                        No signal rows for this date.
                      </td>
                    </tr>
                  )}
                  {!reportLoading &&
                    filteredRows.map((row) => (
                      <tr key={`signal-${row.key}`} className="border-t border-white/5">
                        <td className="px-3 py-2.5 font-mono text-[12px] text-sky-200">{row.signal.id || '—'}</td>
                        <td className="px-3 py-2.5 uppercase">{row.audit?.signal || row.signal.side || '—'}</td>
                        <td className="px-3 py-2.5 text-[12px]">{formatDate(row.signal.timestamp)}</td>
                        <td className="px-3 py-2.5 font-semibold">{row.signal.symbol || '—'}</td>
                        <td className="px-3 py-2.5 uppercase">{row.signal.side || '—'}</td>
                        <td className="px-3 py-2.5 text-[12px]">
                          <span
                            className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
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

          <div className="rounded-xl bg-white/[0.03]">
            <div className="border-b border-white/10 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Exchange report</p>
            </div>
            <div className="max-h-[440px] overflow-auto rounded-b-xl">
              <table className="min-w-[1760px] w-full table-fixed text-[13px] leading-5">
                <colgroup>
                  <col style={{ width: '110px' }} />
                  <col style={{ width: '170px' }} />
                  <col style={{ width: '78px' }} />
                  <col style={{ width: '84px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '96px' }} />
                  <col style={{ width: '118px' }} />
                  <col style={{ width: '104px' }} />
                  <col style={{ width: '112px' }} />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '220px' }} />
                  <col style={{ width: '74px' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-white/5">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                    <th className="px-3 py-2.5">Trade status</th>
                    <th className="px-3 py-2.5">Execution time</th>
                    <th className="px-3 py-2.5">Side</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Amount</th>
                    <th className="px-3 py-2.5">Quantity</th>
                    <th className="px-3 py-2.5">Qty (Rounded)</th>
                    <th className="px-3 py-2.5">Price Used</th>
                    <th className="px-3 py-2.5">Spend (BUY)</th>
                    <th className="px-3 py-2.5">Rejection Reason</th>
                    <th className="px-3 py-2.5">Order ID</th>
                    <th className="px-3 py-2.5">Position after</th>
                    <th className="px-3 py-2.5">Error reason</th>
                    <th className="px-3 py-2.5">Sizing</th>
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
                  {!reportLoading && filteredRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-gray-500" colSpan={14}>
                        No exchange rows for this date.
                      </td>
                    </tr>
                  )}
                  {!reportLoading &&
                    filteredRows.map((row) => (
                      <tr key={`exchange-${row.key}`} className="border-t border-white/5">
                        <td className="px-3 py-2.5 uppercase">
                          <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-[0.06em] ${tradeStatusBadge(row.exchange.tradeStatus)} ${tradeStatusClass(row.exchange.tradeStatus)}`}>
                            {row.exchange.tradeStatus || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[12px]">{formatDate(row.exchange.executionTimestamp)}</td>
                        <td className="px-3 py-2.5 uppercase">{row.exchange.side || '—'}</td>
                        <td className="px-3 py-2.5 uppercase">{row.exchange.type || '—'}</td>
                        <td className="px-3 py-2.5">{formatNullableDecimal(row.exchange.amount, 4)}</td>
                        <td className="px-3 py-2.5">{formatNullableDecimal(row.exchange.quantity, 4)}</td>
                        <td className="px-3 py-2.5">{formatNullableDecimal(row.sizing?.qtyRounded ?? null, 6)}</td>
                        <td className="px-3 py-2.5">{formatNullableDecimal(row.sizing?.computedPrice ?? null, 4)}</td>
                        <td className="px-3 py-2.5">
                          {row.exchange.side === 'BUY'
                            ? formatNullableDecimal(row.sizing?.quoteSpendComputed ?? null, 4)
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-rose-200">
                          {row.sizing?.rejectedReason || '—'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">{row.exchange.orderId || '—'}</td>
                        <td className="px-3 py-2.5 text-[12px]">
                          {row.exchange.positionAfter?.state || 'UNKNOWN'}
                          {row.exchange.positionAfter?.estimatedBaseQty !== null &&
                            row.exchange.positionAfter?.estimatedBaseQty !== undefined &&
                            ` (${formatNullableDecimal(row.exchange.positionAfter?.estimatedBaseQty, 6)})`}
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2.5 text-[12px] text-rose-200" title={row.exchange.errorMessage || ''}>
                          {row.exchange.errorMessage || '—'}
                        </td>
                        <td className="px-3 py-2.5">
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
      )}
    </div>
  );
}
