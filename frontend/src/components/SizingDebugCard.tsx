import type { ReactNode } from 'react';

type SizingDebugCardProps = {
  sizingDebug: any;
  title?: string;
  subtitle?: string;
  extra?: ReactNode;
};

function formatNumber(value: any, digits = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatValue(value: any, digits = 8) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return formatNumber(value, digits);
  return String(value);
}

function sectionItem(label: string, value: any, digits = 8) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs" key={label}>
      <span className="text-gray-400">{label}</span>
      <span className="font-mono text-gray-100">{formatValue(value, digits)}</span>
    </div>
  );
}

export default function SizingDebugCard({ sizingDebug, title = 'Sizing debug', subtitle, extra }: SizingDebugCardProps) {
  const debug = sizingDebug || {};
  const rejectedReason = debug.rejectedReason;

  const balances = [
    sectionItem('Free quote', debug.freeQuote, 6),
    sectionItem('Free base', debug.freeBase, 10)
  ];

  const config = [
    sectionItem('Sizing mode', debug.sizingMode),
    sectionItem('Fixed base qty', debug.fixedBaseQty, 10),
    sectionItem('Risk % of free quote', debug.riskPctOfFreeQuote, 6),
    sectionItem('Min quote spend', debug.minQuoteSpend, 6),
    sectionItem('Sell mode', debug.sellMode),
    sectionItem('Sell fixed base qty', debug.sellFixedBaseQty, 10),
    sectionItem('Sell % of free base', debug.sellPctOfFreeBase, 6)
  ];

  const sizing = [
    sectionItem('Quote spend computed', debug.quoteSpendComputed, 6),
    sectionItem('Qty raw', debug.qtyRaw, 10),
    sectionItem('Qty rounded', debug.qtyAfterStepRounding, 10),
    sectionItem('Price used', debug.priceUsed, 4),
    sectionItem('Notional after rounding', debug.notionalAfterRounding, 6)
  ];

  const constraints = [
    sectionItem('Step size', debug.stepSize, 10),
    sectionItem('Min qty', debug.minQty, 10),
    sectionItem('Min notional', debug.minNotional, 6)
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1022] p-4 shadow-xl">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{title}</p>
          {subtitle && <p className="text-sm text-gray-200">{subtitle}</p>}
        </div>
        {extra}
      </header>

      {rejectedReason && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          Rejected: <span className="font-semibold">{rejectedReason}</span>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-white/5 bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Balances</p>
          <div className="mt-2 space-y-2">{balances}</div>
        </section>
        <section className="rounded-xl border border-white/5 bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Config</p>
          <div className="mt-2 space-y-2">{config}</div>
        </section>
        <section className="rounded-xl border border-white/5 bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Sizing</p>
          <div className="mt-2 space-y-2">{sizing}</div>
        </section>
        <section className="rounded-xl border border-white/5 bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400">Constraints</p>
          <div className="mt-2 space-y-2">{constraints}</div>
        </section>
      </div>

      <div className="mt-4 rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-gray-300">
        <span className="uppercase tracking-[0.2em] text-gray-400">Raw vs rounded:</span>{' '}
        <span className="font-mono">{formatValue(debug.qtyRaw, 10)}</span> →{' '}
        <span className="font-mono">{formatValue(debug.qtyAfterStepRounding, 10)}</span>
        {debug.stepSize ? (
          <span className="text-gray-500"> (step {formatValue(debug.stepSize, 10)})</span>
        ) : null}
      </div>
    </div>
  );
}
