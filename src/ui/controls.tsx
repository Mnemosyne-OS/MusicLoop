/**
 * controls.tsx — the three controls every card is made of: a slider with its
 * value, a row of tiles, a toggle. One look, one behaviour, everywhere.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Bound } from '../audio/settings';

/** A setting on a line: its name, its value in words, a range. A double click puts it back to `reset`. */
export function Slider({ label, value, bound, text, onChange, reset, resetTitle, disabled }: {
  label: string;
  value: number;
  bound: Bound;
  /** The value as the person reads it: "+3 dB", "250 ms", "Off". */
  text: string;
  onChange: (value: number) => void;
  reset: number;
  resetTitle: string;
  disabled?: boolean;
}) {
  return (
    <label className={value !== reset ? 'ml-slider moved' : 'ml-slider'}>
      <span className="name">{label}</span>
      <input
        type="range"
        min={bound.min}
        max={bound.max}
        step={bound.step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={text}
        title={resetTitle}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(reset)}
      />
      <output>{text}</output>
    </label>
  );
}

/** A handful of choices as tiles; the chosen one carries the accent and a tick (style-cartouche §2, §6). */
export function Tiles<V extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: V; text: string; title?: string }[];
  value: V | null;
  onChange: (value: V) => void;
}) {
  return (
    <div className="ml-tiles" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={value === o.value ? 'chip-tile chosen' : 'chip-tile'}
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** An icon that is on or off; the word it stands for is its title and its label. */
export function IconToggle({ label, on, onChange, children, disabled }: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={on ? 'icon-btn chosen' : 'icon-btn'}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      {children}
    </button>
  );
}

/** A plain icon button. */
export function IconButton({ label, onClick, children, disabled, primary }: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button type="button" className={primary ? 'icon-btn primary' : 'icon-btn'} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * A number the person can TYPE. The text is theirs while they type: "1", then
 * "12", then "128" are all on the way to 128, and a field that checks every
 * keystroke against its bounds refuses the first digit (the tempo field did,
 * found on a cold read on 2026-11-19). The value is committed when they leave
 * the field or press Enter, held inside the bounds; an empty or unreadable
 * text puts the last value back. The arrows of the field commit at once.
 */
export function NumberField({ label, value, min, max, step, onCommit, digits = 0 }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
  /** Decimals shown when the field is not being typed in. */
  digits?: number;
}) {
  const shown = String(Number(value.toFixed(digits)));
  const [text, setText] = useState(shown);
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setText(shown); }, [shown, typing]);

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'));
    if (raw.trim() !== '' && Number.isFinite(parsed)) {
      const held = Math.min(max, Math.max(min, parsed));
      setText(String(Number(held.toFixed(Math.max(digits, 2)))));
      if (held !== value) onCommit(held);
    } else {
      setText(shown);
    }
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      aria-label={label}
      onFocus={() => setTyping(true)}
      onChange={(e) => {
        setText(e.target.value);
        // A click on the field's arrows (or ↑ ↓) is a whole value, not a keystroke on the way to one.
        const kind = (e.nativeEvent as InputEvent).inputType;
        if (kind === undefined || kind === '') commit(e.target.value);
      }}
      onBlur={(e) => { setTyping(false); commit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
    />
  );
}
