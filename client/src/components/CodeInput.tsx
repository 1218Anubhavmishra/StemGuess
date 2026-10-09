import type { CSSProperties } from 'react';

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function CodeInput({ value, length, onChange }: { value: string; length: number; onChange: (v: string) => void }) {
  return (
    <span className="slot-wrap">
      <input
        className="slots code-input"
        style={{ '--n': length } as CSSProperties}
        value={value}
        maxLength={length}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-label="Room code"
        onChange={(e) => onChange(clean(e.target.value).slice(0, length))}
      />
    </span>
  );
}
