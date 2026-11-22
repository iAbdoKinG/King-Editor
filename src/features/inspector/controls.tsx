import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { useProjectStore } from '../../stores/projectStore';

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-line/70">
      <div className="flex items-center">
        <button
          className="flex h-10 flex-1 items-center gap-1.5 px-3 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted hover:text-text"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'down' : 'up'} size={13} />
          {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-1 px-3 pb-3">{children}</div>}
    </section>
  );
}

/**
 * Slider + numeric field. Dragging records a single undo step; keyboard and
 * typed changes commit immediately.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  display = (v: number) => (Math.round(v * 100) / 100).toString(),
  parse = (s: string) => parseFloat(s),
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  display?: (v: number) => string;
  parse?: (s: string) => number;
  onChange: (v: number, commit: boolean) => void;
  disabled?: boolean;
}) {
  const dragging = useRef(false);
  const [text, setText] = useState(display(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display(value));
  }, [value, editing, display]);

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    useProjectStore.getState().end();
  };

  const commitText = () => {
    setEditing(false);
    const v = parse(text);
    if (isFinite(v)) onChange(Math.min(max, Math.max(min, v)), true);
    else setText(display(value));
  };

  return (
    <div className={`grid grid-cols-[76px_1fr_64px] items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <label className="truncate text-[12px] text-muted">{label}</label>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        disabled={disabled}
        aria-label={label}
        onPointerDown={() => {
          dragging.current = true;
          useProjectStore.getState().begin();
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onChange={(e) => onChange(parseFloat(e.target.value), !dragging.current)}
      />
      <div className="relative">
        <input
          className="field tnum w-full !h-8 !px-1.5 text-right text-[12px]"
          value={text}
          disabled={disabled}
          inputMode="decimal"
          aria-label={`${label} value`}
          onFocus={(e) => {
            setEditing(true);
            e.target.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(display(value));
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
            e.stopPropagation();
          }}
        />
        {unit && <span className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 text-[10px] text-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-2">
      <span className="truncate text-[12px] text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-8 w-full overflow-hidden rounded-lg border border-line">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={`flex-1 text-[12px] ${o.value === value ? 'bg-elevated text-text' : 'text-muted hover:text-text'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-text transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  );
}
