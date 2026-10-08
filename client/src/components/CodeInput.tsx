import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export default function CodeInput({ value, length, onChange }: { value: string; length: number; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => (value[i] ?? '').trim());

  function fillFrom(i: number, text: string) {
    const next = chars.map((c) => c || ' ');
    if (!text) next[i] = ' ';
    for (let k = 0; k < text.length && i + k < length; k++) next[i + k] = text[k];
    onChange(next.join('').trimEnd());
    return Math.min(i + text.length, length - 1);
  }

  function onInput(i: number, raw: string) {
    const text = clean(raw).slice(-(length - i));
    const nextFocus = fillFrom(i, text);
    if (text) refs.current[nextFocus]?.focus();
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      e.preventDefault();
      fillFrom(i - 1, '');
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < length - 1) {
      refs.current[i + 1]?.focus();
    }
  }

  function onPaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    refs.current[fillFrom(i, clean(e.clipboardData.getData('text')))]?.focus();
  }

  return (
    <div className="code-boxes" role="group" aria-label="Room code">
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="code-box"
          value={ch}
          autoCapitalize="characters"
          autoComplete="off"
          aria-label={`Room code character ${i + 1}`}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
