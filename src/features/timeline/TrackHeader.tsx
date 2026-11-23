import { memo, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Track } from '../../types/project';
import { Icon, type IconName } from '../../components/Icon';
import { moveTrack, removeTrack, updateTrack } from '../../engine/timeline/ops';
import { useProjectStore } from '../../stores/projectStore';
import { SliderField, Toggle } from '../inspector/controls';

const KIND_ICON: Record<Track['kind'], IconName> = { video: 'film', audio: 'music', text: 'text' };

interface Props {
  track: Track;
  height: number;
  compact: boolean;
  index: number;
  count: number;
  clipCount: number;
}

/** Track options: volume, mute, solo, hide, reorder, delete. */
function TrackPopover({ track, x, y, index, count, clipCount, onClose }: Omit<Props, 'height' | 'compact'> & { x: number; y: number; onClose: () => void }) {
  const apply = useProjectStore((s) => s.apply);
  const live = useProjectStore((s) => s.project.tracks.find((t) => t.id === track.id)) ?? track;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [x, y]);
  const set = (patch: Partial<Track>, commit = true) => apply((p) => updateTrack(p, track.id, patch), { commit });
  const hasAudio = live.kind !== 'text';
  const visual = live.kind !== 'audio';
  const rowBtn = 'flex h-10 w-full items-center justify-between rounded-lg px-2 text-left text-[13px] hover:bg-white/5 disabled:opacity-35';
  return createPortal(
    <div className="fixed inset-0 z-[100]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet-in absolute w-[260px] rounded-xl border border-line bg-elevated p-2 shadow-2xl" style={pos} role="dialog" aria-label={`${live.name} options`}>
        <input
          className="field mb-2 w-full"
          value={live.name}
          aria-label="Track name"
          onChange={(e) => set({ name: e.target.value.slice(0, 40) }, false)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {hasAudio && (
          <div className="px-1 pb-1">
            <SliderField
              label="Volume %"
              value={live.volume ?? 1}
              min={0}
              max={2}
              step={0.01}
              display={(v) => `${Math.round(v * 100)}`}
              parse={(s) => parseFloat(s) / 100}
              onChange={(v, c) => set({ volume: v }, c)}
            />
          </div>
        )}
        {hasAudio && (
          <div className={rowBtn}>
            Mute
            <Toggle label="Mute track" checked={live.muted} onChange={(v) => set({ muted: v })} />
          </div>
        )}
        {hasAudio && (
          <div className={rowBtn}>
            Solo
            <Toggle label="Solo track" checked={!!live.solo} onChange={(v) => set({ solo: v })} />
          </div>
        )}
        {visual && (
          <div className={rowBtn}>
            Hide
            <Toggle label="Hide track" checked={live.hidden} onChange={(v) => set({ hidden: v })} />
          </div>
        )}
        <div className="my-1 h-px bg-line" />
        <button className={rowBtn} disabled={index === 0} onClick={() => apply((p) => moveTrack(p, track.id, -1))}>
          Move up <Icon name="up" size={15} />
        </button>
        <button className={rowBtn} disabled={index === count - 1} onClick={() => apply((p) => moveTrack(p, track.id, 1))}>
          Move down <Icon name="down" size={15} />
        </button>
        <button
          className={`${rowBtn} text-danger`}
          onClick={() => {
            if (clipCount > 0 && !window.confirm(`Delete “${live.name}” and its ${clipCount} clip(s)? You can undo this.`)) return;
            apply((p) => removeTrack(p, track.id));
            onClose();
          }}
        >
          Delete track <Icon name="trash" size={15} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export const TrackHeader = memo(function TrackHeader({ track, height, compact, index, count, clipCount }: Props) {
  const apply = useProjectStore((s) => s.apply);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const visual = track.kind !== 'audio';
  const toggle = () => apply((p) => updateTrack(p, track.id, visual ? { hidden: !track.hidden } : { muted: !track.muted }));
  const off = visual ? track.hidden : track.muted;

  return (
    <div className="flex items-center gap-0.5 border-b border-line/60 px-1.5 text-muted" style={{ height }} data-testid={`track-header-${track.kind}`}>
      {compact ? (
        <button className="flex h-full w-full flex-col items-center justify-center gap-0.5" aria-label={`${track.name} options`} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
          <Icon name={off ? (visual ? 'eyeOff' : 'mute') : KIND_ICON[track.kind]} size={18} />
          {track.solo && <span className="text-[9px] font-bold text-accent">S</span>}
        </button>
      ) : (
        <>
          <Icon name={KIND_ICON[track.kind]} size={15} className="shrink-0" />
          <button className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-text/85" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
            {track.name}
          </button>
          {track.kind !== 'text' && (
            <button
              className={`flex h-8 w-6 items-center justify-center rounded-md text-[11px] font-bold hover:bg-elevated ${track.solo ? 'text-accent' : 'text-muted'}`}
              aria-label={track.solo ? 'Unsolo track' : 'Solo track'}
              aria-pressed={!!track.solo}
              onClick={() => apply((p) => updateTrack(p, track.id, { solo: !track.solo }))}
            >
              S
            </button>
          )}
          <button
            className="flex h-8 w-7 items-center justify-center rounded-md hover:bg-elevated hover:text-text"
            aria-label={visual ? (track.hidden ? 'Show track' : 'Hide track') : track.muted ? 'Unmute track' : 'Mute track'}
            aria-pressed={off}
            onClick={toggle}
          >
            <Icon name={visual ? (track.hidden ? 'eyeOff' : 'eye') : track.muted ? 'mute' : 'volume'} size={15} />
          </button>
          <button className="flex h-8 w-5 items-center justify-center rounded-md hover:bg-elevated hover:text-text" aria-label={`${track.name} options`} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
            <Icon name="more" size={15} />
          </button>
        </>
      )}
      {menu && <TrackPopover track={track} x={menu.x} y={menu.y} index={index} count={count} clipCount={clipCount} onClose={() => setMenu(null)} />}
    </div>
  );
});
