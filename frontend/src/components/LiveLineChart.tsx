import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

type ChartPoint = { ts: string; value: number };

type LiveLineChartProps = {
  title: string;
  data: ChartPoint[];
  color?: string;
  unit?: string;
};

function formatTimeLabel(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

export default function LiveLineChart({ title, data, color = '#8b8bff', unit }: LiveLineChartProps) {
  const gradientId = `fill-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.3em] text-gray-500">{title}</p>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="ts"
              tickFormatter={formatTimeLabel}
              stroke="rgba(148,163,184,0.6)"
              tick={{ fontSize: 10 }}
              minTickGap={16}
            />
            <YAxis
              stroke="rgba(148,163,184,0.6)"
              tick={{ fontSize: 10 }}
              width={32}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(148,163,184,0.2)', strokeWidth: 1 }}
              contentStyle={{
                background: '#0b1022',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12
              }}
              labelFormatter={formatTimeLabel}
              formatter={(val: any) => [val, unit || '']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              fill={`url(#${gradientId})`}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
