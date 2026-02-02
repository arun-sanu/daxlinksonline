type LiveGaugeProps = {
  label: string;
  value: number;
  max: number;
  unit?: string;
  hint?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export default function LiveGauge({ label, value, max, unit, hint }: LiveGaugeProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = clamp((value / safeMax) * 100, 0, 100);
  const display = Number.isFinite(value) ? value.toFixed(value < 10 ? 2 : 0) : '0';
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-gray-500">
        <span>{label}</span>
        <span className="text-primary-200">{display}{unit ? ` ${unit}` : ''}</span>
      </div>
      <div className="mt-4 h-2 rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary-200/60 via-primary-200 to-cyan-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {hint && <p className="mt-3 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
