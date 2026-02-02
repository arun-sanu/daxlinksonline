import SevenSegmentDisplay from './SevenSegmentDisplay';

type DigitalGaugeProps = {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
};

export default function DigitalGauge({ label, value, unit, hint }: DigitalGaugeProps) {
  return (
    <div className="digital-gauge">
      <div className="digital-gauge__label">
        <span>{label}</span>
        {unit && <span className="digital-gauge__unit">{unit}</span>}
      </div>
      <div className="digital-gauge__value">
        <SevenSegmentDisplay value={value} />
      </div>
      {hint && <p className="digital-gauge__hint">{hint}</p>}
    </div>
  );
}
