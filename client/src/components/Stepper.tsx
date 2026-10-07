type Props = { label: string; value: number; min: number; max: number; inline?: boolean; onChange: (v: number) => void };

export default function Stepper({ label, value, min, max, inline, onChange }: Props) {
  return (
    <div className={inline ? 'field inline' : 'field'}>
      <span>{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output>{value}</output>
        <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}
