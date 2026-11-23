import { useLayoutEffect, useRef, useState } from 'react';
import { t as T } from '../i18n';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

/** Lightweight anchored menu used for context menus and track options. */
export function Menu({
  x,
  y,
  items,
  title,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = 8;
    setPos({
      left: Math.max(m, Math.min(x, window.innerWidth - r.width - m)),
      top: Math.max(m, Math.min(y, window.innerHeight - r.height - m)),
    });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label={title ? T(title) : undefined}
        className="sheet-in absolute min-w-[200px] overflow-hidden rounded-xl border border-line bg-elevated py-1 shadow-2xl shadow-black/50"
        style={pos}
      >
        {title && <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{T(title)}</div>}
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            disabled={it.disabled}
            className={`flex min-h-[40px] w-full items-center justify-between gap-6 px-3 text-left text-[13px] hover:bg-white/5 focus:bg-white/5 focus:outline-none pointer-coarse:min-h-[44px] ${
              it.danger ? 'text-danger' : 'text-text'
            }`}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            <span>{T(it.label)}</span>
            {it.hint && <span className="text-[11px] text-muted">{it.hint}</span>}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
