import { useEffect, useMemo, useState } from 'react';
import SizingLayout from './SizingLayout';
import { fetchSizingSummary, type SizingSummaryGroup, type SizingSummaryResponse } from '../../../api/sizing';

const RANGE_OPTIONS = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' }
];

function formatNumber(value: any, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function downloadCsv(groups: SizingSummaryGroup[]) {
  const headers = [
    'symbol',
    'side',
    'count_total',
    'count_sent',
    'count_filled',
    'count_rejected',
    'most_common_rejectedReason',
    'avg_qtyRounded',
    'avg_quoteSpendComputed',
    'avg_notionalAfterRounding',
    'min_qtyRounded',
    'max_qtyRounded'
  ];
  const lines = [headers.join(',')];
  groups.forEach((row) => {
    lines.push([
      row.symbol,
      row.side,
      row.count_total,
      row.count_sent,
      row.count_filled,
      row.count_rejected,
      row.most_common_rejectedReason || '',
      row.avg_qtyRounded ?? '',
      row.avg_quoteSpendComputed ?? '',
      row.avg_notionalAfterRounding ?? '',
      row.min_qtyRounded ?? '',
      row.max_qtyRounded ?? ''
    ].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sizing-report-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function SizingReportsPage() {
  const [range, setRange] = useState('7d');
  const [groups, setGroups] = useState<SizingSummaryGroup[]>([]);
  const [summary, setSummary] = useState<SizingSummaryResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => b.count_total - a.count_total),
    [groups]
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    fetchSizingSummary({ range })
      .then((payload) => {
        if (!mounted) return;
        setGroups(payload.groups || []);
        setSummary(payload.summary || null);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err?.message || 'Failed to load sizing report.');
        setGroups([]);
        setSummary(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [range]);

  const topRejected = summary?.topRejectedReason || '—';
  const totals = useMemo(() => summary || { total: 0, rejected: 0, sent: 0, filled: 0, error: 0, topRejectedReason: null }, [summary]);

  return (
    <SizingLayout
      title="Sizing reports"
      subtitle="Aggregate sizing outcomes by symbol and side to spot rounding failures and rejection trends."
    >
      <section className="card-shell space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-gray-400">
            <span>Range</span>
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
          </div>
          <button
            type="button"
            className="rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-sky-200"
            onClick={() => downloadCsv(sortedGroups)}
            disabled={!sortedGroups.length}
          >
            Export CSV
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
            <p className="uppercase tracking-[0.18em] text-gray-400">Total signals</p>
            <p className="mt-1 text-2xl font-semibold text-white">{totals.total}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
            <p className="uppercase tracking-[0.18em] text-gray-400">Rejected</p>
            <p className="mt-1 text-2xl font-semibold text-white">{totals.rejected}</p>
            <p className="mt-1 text-[11px] text-rose-200">Top: {topRejected}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
            <p className="uppercase tracking-[0.18em] text-gray-400">Sent</p>
            <p className="mt-1 text-2xl font-semibold text-white">{totals.sent}</p>
          </div>
        </div>
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5">
        <div className="border-b border-white/10 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400">By symbol + side</p>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#151a2f]">
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-gray-400">
                <th className="px-3 py-2">Symbol</th>
                <th className="px-3 py-2">Side</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Rejected</th>
                <th className="px-3 py-2">Top reason</th>
                <th className="px-3 py-2">Avg qty</th>
                <th className="px-3 py-2">Avg spend</th>
                <th className="px-3 py-2">Avg notional</th>
                <th className="px-3 py-2">Min qty</th>
                <th className="px-3 py-2">Max qty</th>
              </tr>
            </thead>
            <tbody className="text-gray-200">
              {loading && (
                <tr>
                  <td className="px-3 py-3 text-gray-400" colSpan={10}>
                    Loading report…
                  </td>
                </tr>
              )}
              {!loading && sortedGroups.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-gray-500" colSpan={10}>
                    No sizing data in this range.
                  </td>
                </tr>
              )}
              {!loading &&
                sortedGroups.map((row) => (
                  <tr key={`${row.symbol}-${row.side}`} className="border-t border-white/5">
                    <td className="px-3 py-2 font-semibold">{row.symbol}</td>
                    <td className="px-3 py-2 uppercase">{row.side}</td>
                    <td className="px-3 py-2">{row.count_total}</td>
                    <td className="px-3 py-2 text-rose-200">{row.count_rejected}</td>
                    <td className="px-3 py-2 text-xs text-rose-200">{row.most_common_rejectedReason || '—'}</td>
                    <td className="px-3 py-2">{formatNumber(row.avg_qtyRounded, 8)}</td>
                    <td className="px-3 py-2">{formatNumber(row.avg_quoteSpendComputed, 4)}</td>
                    <td className="px-3 py-2">{formatNumber(row.avg_notionalAfterRounding, 4)}</td>
                    <td className="px-3 py-2">{formatNumber(row.min_qtyRounded, 8)}</td>
                    <td className="px-3 py-2">{formatNumber(row.max_qtyRounded, 8)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </SizingLayout>
  );
}
