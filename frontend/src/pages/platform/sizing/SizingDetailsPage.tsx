import { useEffect, useMemo, useState } from 'react';
import SizingLayout from './SizingLayout';
import { fetchSizingRecent, type SizingAuditRow } from '../../../api/sizing';
import SizingDebugCard from '../../../components/SizingDebugCard';

const RANGE_OPTIONS = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' }
];

const STATUS_OPTIONS = ['ALL', 'RECEIVED', 'SENT', 'FILLED', 'REJECTED', 'ERROR'];
const SIDE_OPTIONS = ['ALL', 'BUY', 'SELL'];

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatNumber(value: any, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function SizingDetailsPage() {
  const [range, setRange] = useState('7d');
  const [symbol, setSymbol] = useState('ALL');
  const [side, setSide] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<SizingAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<SizingAuditRow | null>(null);

  const symbolOptions = useMemo(() => {
    const set = new Set(rows.map((row) => row.symbol).filter(Boolean) as string[]);
    return ['ALL', ...Array.from(set).sort()];
  }, [rows]);

  useEffect(() => {
    let mounted = true;
    const now = new Date();
    const since = new Date(
      range === '24h'
        ? now.getTime() - 24 * 60 * 60 * 1000
        : range === '30d'
          ? now.getTime() - 30 * 24 * 60 * 60 * 1000
          : now.getTime() - 7 * 24 * 60 * 60 * 1000
    );

    setLoading(true);
    setError('');
    fetchSizingRecent({
      limit: 120,
      symbol: symbol === 'ALL' ? undefined : symbol,
      side: side === 'ALL' ? undefined : side,
      status: status === 'ALL' ? undefined : status,
      since: since.toISOString(),
      until: now.toISOString()
    })
      .then((payload) => {
        if (!mounted) return;
        setRows(payload.items || []);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err?.message || 'Failed to load sizing diagnostics.');
        setRows([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [range, symbol, side, status]);

  return (
    <SizingLayout
      title="Sizing details"
      subtitle="Review recent order sizing decisions, including floors, rounding, and rejection reasons."
    >
      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-gray-400">
          <span>Filters</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Range
            <select
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Symbol
            <select
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            >
              {symbolOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Side
            <select
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
              value={side}
              onChange={(e) => setSide(e.target.value)}
            >
              {SIDE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs text-gray-400">
            Status
            <select
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-gray-200"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-white/10 bg-white/5">
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Recent audits</p>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#151a2f]">
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-400">
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Qty (Rounded)</th>
                  <th className="px-3 py-2">Price Used</th>
                  <th className="px-3 py-2">Spend</th>
                  <th className="px-3 py-2">Rejected</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {loading && (
                  <tr>
                    <td className="px-3 py-3 text-gray-400" colSpan={8}>
                      Loading sizing diagnostics…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-gray-500" colSpan={8}>
                      No sizing audits in this range.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-white/5 hover:bg-white/5 cursor-pointer"
                      onClick={() => setSelected(row)}
                    >
                      <td className="px-3 py-2 text-xs">{formatDate(row.receivedAt)}</td>
                      <td className="px-3 py-2 font-semibold">{row.symbol || '—'}</td>
                      <td className="px-3 py-2 uppercase">{row.side || '—'}</td>
                      <td className="px-3 py-2 uppercase">{row.status || '—'}</td>
                      <td className="px-3 py-2">{formatNumber(row.qtyRounded, 8)}</td>
                      <td className="px-3 py-2">{formatNumber(row.computedPrice, 4)}</td>
                      <td className="px-3 py-2">{formatNumber(row.quoteSpendComputed, 4)}</td>
                      <td className="px-3 py-2 text-rose-200">{row.rejectedReason || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-3">
          {selected ? (
            <SizingDebugCard
              sizingDebug={selected.sizingDebug}
              title="Sizing breakdown"
              subtitle={`${selected.symbol || '—'} · ${selected.side || '—'} · ${selected.status || '—'}`}
              extra={(
                <button
                  type="button"
                  className="btn btn-secondary btn-small btn-rect"
                  onClick={() => setSelected(null)}
                >
                  Clear
                </button>
              )}
            />
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-400">
              Select a row to view sizing diagnostics.
            </div>
          )}
        </aside>
      </div>
    </SizingLayout>
  );
}
