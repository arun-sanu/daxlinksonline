import { useEffect, useMemo, useState } from 'react';
import SizingLayout from './SizingLayout';
import {
  fetchAdminSizingReport,
  fetchAdminSizingReports,
  type AdminSizingReportDetail,
  type AdminSizingReportItem
} from '../../../api/sizing';

const STATUS_OPTIONS = ['ALL', 'filled', 'open', 'rejected', 'error', 'submitted'];

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatNumber(value: unknown, digits = 8) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function toDateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function downloadCsv(rows: AdminSizingReportItem[]) {
  const headers = [
    'created_at',
    'symbol',
    'side',
    'strategy',
    'status',
    'quote_spend',
    'qty_raw',
    'qty_final',
    'ref_price',
    'risk_mode',
    'risk_value',
    'sl_price',
    'tp_price',
    'reject_reason',
    'bot_name'
  ];
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push([
      row.createdAt || '',
      row.symbol || '',
      row.side || '',
      row.strategy || '',
      row.status || '',
      row.quoteSpend ?? '',
      row.qtyRaw ?? '',
      row.qtyFinal ?? '',
      row.refPrice ?? '',
      row.riskMode || '',
      row.riskValue ?? '',
      row.slPrice ?? '',
      row.tpPrice ?? '',
      row.sizingRejectReason || '',
      row.botName || ''
    ].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sizing-details-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function SizingReportsPage() {
  const [symbol, setSymbol] = useState('');
  const [strategy, setStrategy] = useState('');
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState(() => toDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateInputValue(new Date()));
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminSizingReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AdminSizingReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!mounted) return;
      setLoading(true);
      setError('');
      const fromIso = from ? new Date(`${from}T00:00:00.000Z`).toISOString() : undefined;
      const toIso = to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined;
      try {
        const payload = await fetchAdminSizingReports({
          symbol: symbol || undefined,
          strategy: strategy || undefined,
          status: status === 'ALL' ? undefined : status,
          from: fromIso,
          to: toIso,
          page,
          limit: 50
        });
        if (!mounted) return;
        setItems(payload.items || []);
        setTotal(payload.total || 0);
        setPageSize(payload.pageSize || 50);
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || 'Failed to load sizing reports.');
        setItems([]);
        setTotal(0);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();

    return () => {
      mounted = false;
    };
  }, [symbol, strategy, status, from, to, page]);

  useEffect(() => {
    if (!selectedId) {
      Promise.resolve().then(() => setSelectedDetail(null));
      return;
    }
    let mounted = true;
    setDetailLoading(true);
    fetchAdminSizingReport(selectedId)
      .then((detail) => {
        if (!mounted) return;
        setSelectedDetail(detail);
      })
      .catch(() => {
        if (!mounted) return;
        setSelectedDetail(null);
      })
      .finally(() => {
        if (mounted) setDetailLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / Math.max(1, pageSize))), [total, pageSize]);

  return (
    <SizingLayout
      title="Sizing Details & Reports"
      subtitle="Filter sizing telemetry, inspect exact calculations, and export report rows for audits."
    >
      <section className="card-shell space-y-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Symbol
            <input
              value={symbol}
              onChange={(event) => {
                setPage(1);
                setSymbol(event.target.value.toUpperCase());
              }}
              placeholder="BTC/USDC"
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Strategy
            <input
              value={strategy}
              onChange={(event) => {
                setPage(1);
                setStrategy(event.target.value);
              }}
              placeholder="ARN"
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Status
            <select
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value);
              }}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setPage(1);
                setFrom(event.target.value);
              }}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => {
                setPage(1);
                setTo(event.target.value);
              }}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-sky-200"
              disabled={!items.length}
              onClick={() => downloadCsv(items)}
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <p>Total rows: {total}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-2 py-1 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Prev
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-2 py-1 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-white/10 bg-white/5">
          <div className="max-h-[620px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#151a2f]">
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-400">
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Quote Spend</th>
                  <th className="px-3 py-2">Qty Final</th>
                  <th className="px-3 py-2">Ref Price</th>
                  <th className="px-3 py-2">SL/TP</th>
                  <th className="px-3 py-2">Reject Reason</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {loading && (
                  <tr>
                    <td className="px-3 py-3 text-gray-400" colSpan={10}>
                      Loading sizing reports…
                    </td>
                  </tr>
                )}
                {!loading && items.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-gray-500" colSpan={10}>
                      No sizing reports matched the filters.
                    </td>
                  </tr>
                )}
                {!loading &&
                  items.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${selectedId === row.id ? 'bg-white/10' : ''}`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-3 py-2 text-xs">{formatDate(row.createdAt)}</td>
                      <td className="px-3 py-2 font-semibold">{row.symbol || '—'}</td>
                      <td className="px-3 py-2 uppercase">{row.side || '—'}</td>
                      <td className="px-3 py-2">{row.strategy || '—'}</td>
                      <td className="px-3 py-2 uppercase">{row.status || '—'}</td>
                      <td className="px-3 py-2">{formatNumber(row.quoteSpend, 4)}</td>
                      <td className="px-3 py-2">{formatNumber(row.qtyFinal, 8)}</td>
                      <td className="px-3 py-2">{formatNumber(row.refPrice, 4)}</td>
                      <td className="px-3 py-2 text-xs">
                        {formatNumber(row.slPrice, 4)} / {formatNumber(row.tpPrice, 4)}
                      </td>
                      <td className="px-3 py-2 text-xs text-rose-200">{row.sizingRejectReason || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-2xl border border-white/10 bg-white/5 p-4">
          {!selectedId && <p className="text-sm text-gray-400">Select a report row to view full sizing breakdown.</p>}
          {selectedId && detailLoading && <p className="text-sm text-gray-400">Loading report detail…</p>}
          {selectedDetail && !detailLoading && (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Sizing Summary</p>
                <p className="text-sm text-gray-200">
                  {selectedDetail.summary.symbol || '—'} · {(selectedDetail.summary.side || '—').toUpperCase()} · {(selectedDetail.summary.status || '—').toUpperCase()}
                </p>
                <p className="text-xs text-gray-400">Bot: {selectedDetail.summary.botName || selectedDetail.summary.botId || '—'}</p>
              </div>
              <div className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-gray-200">
                <p>Quote spend: {formatNumber(selectedDetail.summary.quoteSpend, 6)}</p>
                <p>Qty raw/final: {formatNumber(selectedDetail.summary.qtyRaw, 8)} / {formatNumber(selectedDetail.summary.qtyFinal, 8)}</p>
                <p>Ref price: {formatNumber(selectedDetail.summary.refPrice, 6)}</p>
                <p>Min notional: {formatNumber(selectedDetail.summary.minNotional, 6)}</p>
                <p>Step size: {formatNumber(selectedDetail.summary.stepSize, 10)}</p>
                <p>Free quote/base: {formatNumber(selectedDetail.summary.freeQuote, 6)} / {formatNumber(selectedDetail.summary.freeBase, 8)}</p>
                <p>SL/TP: {formatNumber(selectedDetail.summary.slPrice, 6)} / {formatNumber(selectedDetail.summary.tpPrice, 6)}</p>
                <p>Reject reason: {selectedDetail.summary.sizingRejectReason || '—'}</p>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Raw Payload JSON</p>
                <pre className="max-h-[220px] overflow-auto rounded-xl border border-white/10 bg-[#0d1120] p-3 text-[11px] text-gray-300">
                  {JSON.stringify(selectedDetail.rawPayload, null, 2)}
                </pre>
              </div>
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Execution Result JSON</p>
                <pre className="max-h-[220px] overflow-auto rounded-xl border border-white/10 bg-[#0d1120] p-3 text-[11px] text-gray-300">
                  {JSON.stringify(selectedDetail.executionResult, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </aside>
      </div>
    </SizingLayout>
  );
}
