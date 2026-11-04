import { useEffect, useState } from 'react';

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  'aria-label': string;
  /** Rejects values above this while typing (e.g. 100 for percentages). */
  max?: number;
  width?: number;
}

const parse = (text: string): number | null => {
  const t = text.trim();
  if (t === '' || t === '.') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/**
 * Dense numeric grid cell. Keeps the raw text while typing (so "0." and "1.50" are not rewritten
 * under the cursor) and reports a number — or null for blank — on every keystroke for live recalculation.
 */
export function NumberField({ value, onChange, disabled, max, width = 84, ...rest }: Props) {
  const [text, setText] = useState(value == null ? '' : String(value));

  // Adopt outside changes (server reload, reset) unless they are just our own text parsed.
  useEffect(() => {
    setText((current) => (parse(current) === value ? current : value == null ? '' : String(value)));
  }, [value]);

  return (
    <input
      {...rest}
      className="cell-input"
      style={{ width }}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const next = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d{0,4}$/.test(next)) return; // non-negative, up to 4 dp
        const parsed = parse(next);
        if (max !== undefined && parsed !== null && parsed > max) return;
        setText(next);
        onChange(parsed);
      }}
    />
  );
}
