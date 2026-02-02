type MetricTileProps = {
  label: string;
  value: string;
  detail?: string;
};

export default function MetricTile({ label, value, detail }: MetricTileProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-main">{value}</p>
      {detail && <p className="text-xs text-gray-400">{detail}</p>}
    </div>
  );
}
