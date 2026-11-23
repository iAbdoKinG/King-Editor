import { useLayoutEffect, useRef, useState } from 'react';
import { t as T } from '../../i18n';
import { createPortal } from 'react-dom';
import { MARKER_COLORS, removeMarker, updateMarker } from '../../engine/timeline/ops';
import { useProjectStore } from '../../stores/projectStore';
import { formatTimecode } from '../../utils/time';

/** Edit a marker: name, colour, delete. */
export function MarkerPopover({ id, x, y, onClose }: { id: string; x: number; y: number; onClose: () => void }) {
  const marker = useProjectStore((s) => s.project.markers?.find((m) => m.id === id));
  const fps = useProjectStore((s) => s.project.settings.fps);
  const apply = useProjectStore((s) => s.apply);
  const [label, setLabel] = useState(marker?.label ?? '');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: Math.max(8, Math.min(x - r.width / 2, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  if (!marker) return null;
  const commit = () => {
    if (label !== marker.label) apply((p) => updateMarker(p, id, { label }));
  };
  return createPortal(
    <div className="fixed inset-0 z-[100]" onPointerDown={(e) => e.target === e.currentTarget && (commit(), onClose())}>
      <div ref={ref} className="sheet-in absolute w-[240px] rounded-xl border border-line bg-elevated p-3 shadow-2xl" style={pos} role="dialog" aria-label={T("Marker")}>
        <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
          <span className="font-semibold uppercase tracking-wider">{T("Marker")}</span>
          <span className="tnum">{formatTimecode(marker.t, fps)}</span>
        </div>
        <input
          autoFocus
          className="field mb-2 w-full"
          placeholder={T("Name (optional)")}
          value={label}
          aria-label={T("Marker name")}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              commit();
              onClose();
            }
          }}
        />
        <div className="mb-3 flex gap-2">
          {MARKER_COLORS.map((c) => (
            <button
              key={c}
              aria-label={T('Color {c}', { c })}
              aria-pressed={c === marker.color}
              className={`h-7 w-7 rounded-full ${c === marker.color ? 'ring-2 ring-text ring-offset-2 ring-offset-elevated' : ''}`}
              style={{ background: c }}
              onClick={() => apply((p) => updateMarker(p, id, { color: c }))}
            />
          ))}
        </div>
        <div className="flex justify-between">
          <button className="text-[12px] text-danger" onClick={() => (apply((p) => removeMarker(p, id)), onClose())}>
            {T('Delete')}
          </button>
          <button className="text-[12px] font-semibold text-accent" onClick={() => (commit(), onClose())}>
            {T('Done')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
