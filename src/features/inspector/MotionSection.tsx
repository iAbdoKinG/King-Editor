/**
 * In / Out / Combo animations for the selected clip. Each clip keeps its own
 * independent set; choosing one never touches the clip's other animations,
 * its position/scale, or other clips.
 */
import { useRef, useState } from 'react';
import { t as T } from '../../i18n';
import type { Clip, MotionSlot } from '../../types/project';
import { engine } from '../../engine/playback/engine';
import { DEFAULT_MOTION_DURATION, MIN_MOTION_DURATION, MOTIONS, motionDef, setMotion, slotDurations, type MotionKind } from '../../engine/timeline/motion';
import { updateClip } from '../../engine/timeline/ops';
import { useProjectStore } from '../../stores/projectStore';
import { Section, SliderField } from './controls';
import { Icon } from '../../components/Icon';

const KINDS: Array<{ value: MotionKind; label: string }> = [
  { value: 'in', label: 'In' },
  { value: 'out', label: 'Out' },
  { value: 'combo', label: 'Combo' },
];

let stopPreview: (() => void) | null = null;

/** Play just the part of the clip where this animation happens. */
export function previewMotion(clip: Clip, kind: MotionKind): void {
  stopPreview?.();
  const end = clip.start + clip.duration;
  const { din, dout } = slotDurations(clip);
  const from = kind === 'in' ? clip.start : kind === 'out' ? Math.max(clip.start, end - dout - 0.4) : clip.start;
  const to = kind === 'in' ? Math.min(end, clip.start + din + 0.4) : kind === 'out' ? end - 1e-3 : Math.min(end - 1e-3, clip.start + 3);
  engine.gesture();
  engine.seek(from);
  engine.clock.play();
  let last = from;
  const off = engine.onTime((t) => {
    // The user took over (paused, or jumped elsewhere): stop quietly, leave the playhead alone.
    if (!engine.clock.playing || t < last - 0.05 || t > last + 0.5) return stop(false);
    last = t;
    if (t >= to) stop(true);
  });
  const stop = (finished: boolean) => {
    off();
    if (stopPreview === cancel) stopPreview = null;
    if (engine.clock.playing) engine.clock.pause();
    if (finished) engine.seek(kind === 'out' ? to : Math.min(to, from + (kind === 'in' ? din : 0)));
  };
  const cancel = () => stop(false);
  stopPreview = cancel;
}

/** Tiny looping glyph that hints what each animation does. */
function Glyph({ kind, id }: { kind: MotionKind; id: string }) {
  return <span className={`motion-glyph mg-${kind} mg-${id}`} aria-hidden />;
}

export function MotionSection({ clip }: { clip: Clip }) {
  const [kind, setKind] = useState<MotionKind>(() => (clip.motion?.in || !clip.motion ? 'in' : clip.motion.out ? 'out' : 'combo'));
  const patch = (fn: (c: Clip) => Clip, commit = true) => useProjectStore.getState().apply((p) => updateClip(p, clip.id, fn), { commit });
  const slot = clip.motion?.[kind];
  const def = motionDef(kind, slot?.id);
  const maxDur = Math.max(MIN_MOTION_DURATION, Math.min(5, clip.duration));
  const list = MOTIONS.filter((m) => m.kind === kind);
  const choose = (id: string | null) => {
    if (!id) return patch((c) => setMotion(c, kind, null));
    const next: MotionSlot =
      kind === 'combo'
        ? { id, duration: clip.duration, amount: slot?.amount ?? 1, focusX: slot?.focusX ?? 0.5, focusY: slot?.focusY ?? 0.5 }
        : { id, duration: Math.min(slot?.duration ?? DEFAULT_MOTION_DURATION, maxDur) };
    patch((c) => setMotion(c, kind, next));
    const updated = useProjectStore.getState().project.clips[clip.id];
    if (updated) previewMotion(updated, kind);
  };
  const setSlot = (p: Partial<MotionSlot>, commit: boolean) =>
    patch((c) => (c.motion?.[kind] ? setMotion(c, kind, { ...c.motion[kind]!, ...p }) : c), commit);

  return (
    <Section
      title={T('Animation')}
      action={
        clip.motion ? (
          <button className="mr-1 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-elevated hover:text-text" onClick={() => patch((c) => ({ ...c, motion: undefined }))}>
            {T('Clear')}
          </button>
        ) : undefined
      }
    >
      <div role="tablist" aria-label={T('Animation type')} className="flex h-8 w-full overflow-hidden rounded-lg border border-line">
        {KINDS.map((k) => (
          <button
            key={k.value}
            role="tab"
            aria-selected={k.value === kind}
            className={`relative flex-1 text-[12px] ${k.value === kind ? 'bg-elevated text-text' : 'text-muted hover:text-text'}`}
            onClick={() => setKind(k.value)}
            data-testid={`motion-tab-${k.value}`}
          >
            {T(k.label)}
            {clip.motion?.[k.value] && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5 pt-1.5" role="listbox" aria-label={T('Animations')}>
        <MotionTile label={T('None')} selected={!slot} onClick={() => choose(null)}>
          <Icon name="close" size={16} />
        </MotionTile>
        {list.map((m) => (
          <MotionTile key={m.id} label={T(m.name)} selected={slot?.id === m.id} onClick={() => choose(m.id)} testId={`motion-${kind}-${m.id}`}>
            <Glyph kind={kind} id={m.id} />
          </MotionTile>
        ))}
      </div>
      {slot && kind !== 'combo' && (
        <SliderField
          label={T('Duration s')}
          value={Math.min(slot.duration, maxDur)}
          min={MIN_MOTION_DURATION}
          max={maxDur}
          step={0.05}
          onChange={(v, c) => setSlot({ duration: v }, c)}
        />
      )}
      {slot && kind === 'combo' && (
        <SliderField label={T('Strength %')} value={slot.amount ?? 1} min={0.1} max={3} step={0.05} display={(v) => `${Math.round(v * 100)}`} parse={(s) => parseFloat(s) / 100} onChange={(v, c) => setSlot({ amount: v }, c)} />
      )}
      {slot && def?.focus && <FocusPad x={slot.focusX ?? 0.5} y={slot.focusY ?? 0.5} onChange={(x, y, c) => setSlot({ focusX: x, focusY: y }, c)} />}
      {slot && (
        <button className="field mt-1 flex w-full items-center justify-center gap-1.5 text-[12px]" onClick={() => previewMotion(useProjectStore.getState().project.clips[clip.id] ?? clip, kind)}>
          <Icon name="play" size={14} /> {T('Preview animation')}
        </button>
      )}
    </Section>
  );
}

function MotionTile({ label, selected, onClick, children, testId }: { label: string; selected: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      role="option"
      aria-selected={selected}
      onClick={onClick}
      data-testid={testId}
      className={`flex h-[62px] flex-col items-center justify-center gap-1 rounded-lg border px-1 text-[10.5px] leading-tight transition-colors ${
        selected ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:border-accent/60 hover:text-text'
      }`}
    >
      <span className="flex h-6 w-8 items-center justify-center">{children}</span>
      <span className="line-clamp-2 text-center">{label}</span>
    </button>
  );
}

/** Drag the point the zoom/pan moves around (also draggable directly on the preview). */
function FocusPad({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number, commit: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const begun = useRef(false);
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as const;
  };
  return (
    <div className="pt-1">
      <div className="mb-1 flex items-center justify-between text-[12px] text-muted">
        <span>{T('Focus point')}</span>
        <button className="text-[11px] hover:text-text" onClick={() => onChange(0.5, 0.5, true)}>
          {T('Center')}
        </button>
      </div>
      <div
        ref={ref}
        dir="ltr"
        data-testid="focus-pad"
        className="relative h-[84px] w-full touch-none rounded-lg border border-line bg-elevated/60"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px)', backgroundSize: '33.33% 33.33%' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          useProjectStore.getState().begin();
          begun.current = true;
          const [px, py] = at(e);
          onChange(px, py, false);
        }}
        onPointerMove={(e) => {
          if (!begun.current) return;
          const [px, py] = at(e);
          onChange(px, py, false);
        }}
        onPointerUp={() => {
          if (!begun.current) return;
          begun.current = false;
          useProjectStore.getState().end();
        }}
        onPointerCancel={() => {
          begun.current = false;
          useProjectStore.getState().end();
        }}
      >
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/30 shadow"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      </div>
    </div>
  );
}
