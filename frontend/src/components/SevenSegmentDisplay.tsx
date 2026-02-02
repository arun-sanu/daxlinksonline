type SevenSegmentDisplayProps = {
  value: string;
  digitWidth?: number;
  digitHeight?: number;
  gap?: number;
  color?: string;
  dimColor?: string;
};

const SEGMENTS: Record<string, boolean[]> = {
  '0': [true, true, true, true, true, true, false],
  '1': [false, true, true, false, false, false, false],
  '2': [true, true, false, true, true, false, true],
  '3': [true, true, true, true, false, false, true],
  '4': [false, true, true, false, false, true, true],
  '5': [true, false, true, true, false, true, true],
  '6': [true, false, true, true, true, true, true],
  '7': [true, true, true, false, false, false, false],
  '8': [true, true, true, true, true, true, true],
  '9': [true, true, true, true, false, true, true],
  '-': [false, false, false, false, false, false, true],
  ' ': [false, false, false, false, false, false, false]
};

function renderDigit(
  digit: string,
  x: number,
  digitWidth: number,
  digitHeight: number,
  thickness: number,
  color: string,
  dimColor: string
) {
  const w = digitWidth;
  const h = digitHeight;
  const t = thickness;
  const v = SEGMENTS[digit] || SEGMENTS[' '];
  const segColor = (on: boolean) => (on ? color : dimColor);
  const midY = Math.round(h / 2);
  const rightX = x + w - t;
  return (
    <g key={`${digit}-${x}`}>
      <rect x={x + t} y={0} width={w - 2 * t} height={t} rx={t / 2} fill={segColor(v[0])} />
      <rect x={rightX} y={t} width={t} height={midY - t * 1.5} rx={t / 2} fill={segColor(v[1])} />
      <rect x={rightX} y={midY + t * 0.5} width={t} height={midY - t * 1.5} rx={t / 2} fill={segColor(v[2])} />
      <rect x={x + t} y={h - t} width={w - 2 * t} height={t} rx={t / 2} fill={segColor(v[3])} />
      <rect x={x} y={midY + t * 0.5} width={t} height={midY - t * 1.5} rx={t / 2} fill={segColor(v[4])} />
      <rect x={x} y={t} width={t} height={midY - t * 1.5} rx={t / 2} fill={segColor(v[5])} />
      <rect x={x + t} y={midY - t / 2} width={w - 2 * t} height={t} rx={t / 2} fill={segColor(v[6])} />
    </g>
  );
}

export default function SevenSegmentDisplay({
  value,
  digitWidth = 28,
  digitHeight = 50,
  gap = 6,
  color = '#9ae6ff',
  dimColor = 'rgba(148, 163, 184, 0.18)'
}: SevenSegmentDisplayProps) {
  const chars = value.split('');
  const t = Math.max(4, Math.round(digitWidth * 0.18));
  const width = chars.length * digitWidth + Math.max(0, chars.length - 1) * gap;
  const height = digitHeight;
  let x = 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label={value}>
      {chars.map((ch) => {
        if (ch === '.') {
          const cx = x + digitWidth / 2;
          const cy = height - t;
          x += digitWidth + gap;
          return <circle key={`${ch}-${x}`} cx={cx} cy={cy} r={t / 2} fill={color} />;
        }
        const node = renderDigit(ch, x, digitWidth, digitHeight, t, color, dimColor);
        x += digitWidth + gap;
        return node;
      })}
    </svg>
  );
}
