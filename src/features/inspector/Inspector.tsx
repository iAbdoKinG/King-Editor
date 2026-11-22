/**
 * Context-aware inspector: its content is derived entirely from the current
 * selection (video / image / audio / text clip, or project settings).
 */
import { useState } from 'react';
import type { AnimProp, Clip, Direction, Easing, MediaAsset, MediaClip, ProjectSettings, TextClip, Transform, Transition, TransitionType } from '../../types/project';
import { engine } from '../../engine/playback/engine';
import {
  ANIM_PROPS,
  KF_EPS,
  clearAnimation,
  hasKeyframes,
  keyframeIndexAt,
  keyframeTimes,
  resolveTransform,
  setAnimatedValue,
  setEasingAt,
  toggleKeyframe,
} from '../../engine/timeline/animation';
import { TRANSITION_TYPES, maxTransitionDuration, prevAdjacent } from '../../engine/timeline/transitions';
import { usePlayheadTime } from '../../hooks/usePlayheadTime';
import { addTransition, removeTransition } from '../timeline/actions';
import { Icon } from '../../components/Icon';
import { canvasFilterSupported } from '../../engine/rendering/compositor';
import { defaultAudio, defaultEffects, defaultTransform, frameSize } from '../../engine/timeline/model';
import { setClipSpeed, updateClip } from '../../engine/timeline/ops';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore, type PreviewQuality } from '../../stores/uiStore';
import { formatTimecode } from '../../utils/time';
import { Row, Section, Segmented, SliderField, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}`;
const fromPct = (s: string) => parseFloat(s) / 100;

function usePatch(clipId: string) {
  return (fn: (c: Clip) => Clip, commit = true) =>
    useProjectStore.getState().apply((p) => updateClip(p, clipId, fn), { commit });
}

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="mr-2 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-elevated hover:text-text" onClick={onClick} aria-label={label}>
      Reset
    </button>
  );
}

function useClipTime(clip: Clip) {
  const t = usePlayheadTime();
  const inside = t >= clip.start && t < clip.start + clip.duration;
  const lt = Math.min(Math.max(0, t - clip.start), clip.duration);
  return { t, lt, inside };
}

function TransformSection({ clip }: { clip: Clip }) {
  const patch = usePatch(clip.id);
  const base = clip.transform;
  const { lt, inside } = useClipTime(clip);
  const tr = resolveTransform(clip, lt);
  const set = (p: Partial<Transform>, commit: boolean) => patch((c) => ({ ...c, transform: { ...c.transform, ...p } }) as Clip, commit);
  const anim = (prop: AnimProp, v: number, commit: boolean) => patch((c) => setAnimatedValue(c, prop, lt, v), commit);
  const kf = (prop: AnimProp) => ({
    on: keyframeIndexAt(clip.keyframes?.[prop], lt) >= 0,
    animated: hasKeyframes(clip, prop),
    disabled: !inside,
    onToggle: () => patch((c) => toggleKeyframe(c, prop, lt)),
  });
  const scaleAnimated = hasKeyframes(clip, 'scale');
  const [uniformPref, setUniform] = useState(() => Math.abs(base.scaleX - base.scaleY) < 1e-6);
  const uniform = uniformPref || scaleAnimated;
  const settings = useProjectStore((s) => s.project.settings);
  const { width: W, height: H } = frameSize(settings);
  return (
    <Section
      title="Transform"
      action={
        <ResetButton
          label="Reset transform"
          onClick={() => patch((c) => ({ ...c, keyframes: undefined, transform: { ...defaultTransform(), crop: c.transform.crop } }) as Clip)}
        />
      }
    >
      <SliderField label="Position X" value={tr.x} min={-W} max={W} step={1} keyframe={kf('x')} onChange={(v, c) => anim('x', v, c)} />
      <SliderField label="Position Y" value={tr.y} min={-H} max={H} step={1} keyframe={kf('y')} onChange={(v, c) => anim('y', v, c)} />
      {uniform ? (
        <SliderField
          label="Scale %"
          value={tr.scaleX}
          min={0.05}
          max={4}
          step={0.01}
          display={pct}
          parse={fromPct}
          keyframe={kf('scale')}
          onChange={(v, c) => anim('scale', v, c)}
        />
      ) : (
        <>
          <SliderField label="Scale X %" value={base.scaleX} min={0.05} max={4} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ scaleX: v }, c)} />
          <SliderField label="Scale Y %" value={base.scaleY} min={0.05} max={4} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ scaleY: v }, c)} />
        </>
      )}
      {!scaleAnimated && (
        <Row label="Uniform">
          <Toggle
            label="Uniform scale"
            checked={uniform}
            onChange={(on) => {
              setUniform(on);
              if (on && base.scaleX !== base.scaleY) set({ scaleY: base.scaleX }, true);
            }}
          />
        </Row>
      )}
      <SliderField label="Rotation °" value={tr.rotation} min={-180} max={180} step={0.5} keyframe={kf('rotation')} onChange={(v, c) => anim('rotation', v, c)} />
      <SliderField label="Opacity %" value={tr.opacity} min={0} max={1} step={0.01} display={pct} parse={fromPct} keyframe={kf('opacity')} onChange={(v, c) => anim('opacity', v, c)} />
      <SliderField label="Anchor X %" value={base.anchorX} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ anchorX: v }, c)} />
      <SliderField label="Anchor Y %" value={base.anchorY} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ anchorY: v }, c)} />
      {!inside && <p className="text-[11px] leading-snug text-muted">Move the playhead over this clip to add keyframes.</p>}
    </Section>
  );
}

const EASINGS: Array<{ value: Easing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In/Out' },
];

function AnimationSection({ clip }: { clip: Clip }) {
  const patch = usePatch(clip.id);
  const { lt } = useClipTime(clip);
  const times = keyframeTimes(clip);
  if (!times.length)
    return (
      <Section title="Animation">
        <p className="text-[11px] leading-snug text-muted">
          Tap ◆ next to Position, Scale, Rotation or Opacity to add a keyframe at the playhead. Change the value at
          another time to animate.
        </p>
      </Section>
    );
  const atKf = times.find((t) => Math.abs(t - lt) < KF_EPS);
  const prev = [...times].reverse().find((t) => t < lt - KF_EPS);
  const next = times.find((t) => t > lt + KF_EPS);
  const easingAt =
    atKf !== undefined
      ? ANIM_PROPS.map((p) => clip.keyframes?.[p]?.find((k) => Math.abs(k.t - atKf) < KF_EPS)?.ease).find(Boolean) ?? 'linear'
      : null;
  const seekLocal = (t: number) => engine.seek(clip.start + Math.min(Math.max(0, t), clip.duration - 1e-3));
  return (
    <Section title={`Animation · ${times.length} keyframe${times.length === 1 ? '' : 's'}`}>
      <div className="flex gap-2">
        <button className="field flex-1 text-[12px] disabled:opacity-40" disabled={prev === undefined} onClick={() => seekLocal(prev!)}>
          ◂ Previous
        </button>
        <button className="field flex-1 text-[12px] disabled:opacity-40" disabled={next === undefined} onClick={() => seekLocal(next!)}>
          Next ▸
        </button>
      </div>
      <Row label="Easing">
        <select
          className="field w-full"
          aria-label="Keyframe easing"
          disabled={atKf === undefined}
          value={easingAt ?? 'linear'}
          onChange={(e) => patch((c) => setEasingAt(c, atKf!, e.target.value as Easing))}
        >
          {EASINGS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </Row>
      {atKf === undefined && <p className="text-[11px] text-muted">Easing applies from the keyframe at the playhead.</p>}
      <button className="mt-1 text-[12px] text-danger" onClick={() => patch((c) => clearAnimation(c))}>
        Remove all keyframes
      </button>
    </Section>
  );
}

function TransitionInSection({ clip }: { clip: Clip }) {
  const project = useProjectStore((s) => s.project);
  const prev = prevAdjacent(project, clip);
  const track = project.tracks.find((t) => t.id === clip.trackId);
  if (!prev || !track || track.kind === 'audio') return null;
  return (
    <Section title="Transition in">
      <button className="field w-full text-[12px]" onClick={() => addTransition(clip.id)}>
        {clip.transitionIn ? 'Edit transition from previous clip' : 'Add transition from previous clip'}
      </button>
    </Section>
  );
}

function TransitionInspector({ clipId }: { clipId: string }) {
  const project = useProjectStore((s) => s.project);
  const clip = project.clips[clipId];
  const patch = usePatch(clipId);
  const tr = clip?.transitionIn;
  const prev = clip ? prevAdjacent(project, clip) : null;
  if (!clip || !tr) return null;
  const max = prev ? maxTransitionDuration(prev, clip) : tr.duration;
  const set = (p: Partial<Transition>, commit = true) =>
    patch((c) => ({ ...c, transitionIn: { ...(c.transitionIn as Transition), ...p } }), commit);
  return (
    <>
      <div className="border-b border-line/70 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Transition</div>
        <div className="text-[13px] font-medium">{TRANSITION_TYPES.find((x) => x.value === tr.type)?.label}</div>
        {!prev && <div className="text-[11px] text-danger">Inactive: the clips no longer touch.</div>}
      </div>
      <Section title="Settings">
        <Row label="Type">
          <select className="field w-full" aria-label="Transition type" value={tr.type} onChange={(e) => set({ type: e.target.value as TransitionType })}>
            {TRANSITION_TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Row>
        <SliderField
          label="Duration s"
          value={Math.min(tr.duration, max)}
          min={0.1}
          max={Math.max(0.1, Math.min(4, max))}
          step={0.05}
          onChange={(v, c) => set({ duration: v }, c)}
        />
        {tr.type === 'slide' && (
          <Row label="Direction">
            <Segmented<Direction>
              label="Direction"
              value={tr.direction}
              options={[
                { value: 'left', label: '←' },
                { value: 'right', label: '→' },
                { value: 'up', label: '↑' },
                { value: 'down', label: '↓' },
              ]}
              onChange={(v) => set({ direction: v })}
            />
          </Row>
        )}
        <Row label="Easing">
          <select className="field w-full" aria-label="Transition easing" value={tr.easing} onChange={(e) => set({ easing: e.target.value as Easing })}>
            {EASINGS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </Row>
        <button className="mt-1 text-[12px] text-danger" onClick={() => removeTransition(clipId)}>
          Remove transition (cut)
        </button>
      </Section>
    </>
  );
}

function CropSection({ clip }: { clip: MediaClip }) {
  const patch = usePatch(clip.id);
  const cr = clip.transform.crop;
  const set = (p: Partial<Transform['crop']>, commit: boolean) =>
    patch((c) => ({ ...c, transform: { ...c.transform, crop: { ...c.transform.crop, ...p } } }) as Clip, commit);
  const side = (k: keyof Transform['crop'], label: string, other: keyof Transform['crop']) => (
    <SliderField
      label={label}
      value={cr[k]}
      min={0}
      max={0.95 - cr[other]}
      step={0.005}
      display={pct}
      parse={fromPct}
      onChange={(v, c) => set({ [k]: v }, c)}
    />
  );
  return (
    <Section title="Crop" action={<ResetButton label="Reset crop" onClick={() => set({ top: 0, right: 0, bottom: 0, left: 0 }, true)} />}>
      {side('left', 'Left %', 'right')}
      {side('right', 'Right %', 'left')}
      {side('top', 'Top %', 'bottom')}
      {side('bottom', 'Bottom %', 'top')}
    </Section>
  );
}

function EffectsSection({ clip }: { clip: Clip }) {
  const patch = usePatch(clip.id);
  const e = clip.effects;
  const set = (p: Partial<Clip['effects']>, commit: boolean) => patch((c) => ({ ...c, effects: { ...c.effects, ...p } }) as Clip, commit);
  const off = !canvasFilterSupported;
  return (
    <Section title="Color & Effects" action={<ResetButton label="Reset effects" onClick={() => set(defaultEffects(), true)} />}>
      {off && (
        <p className="pb-1 text-[11px] leading-snug text-muted">
          This browser does not support canvas filters, so color effects are unavailable here.
        </p>
      )}
      <SliderField disabled={off} label="Brightness" value={e.brightness} min={0} max={200} onChange={(v, c) => set({ brightness: v }, c)} />
      <SliderField disabled={off} label="Contrast" value={e.contrast} min={0} max={200} onChange={(v, c) => set({ contrast: v }, c)} />
      <SliderField disabled={off} label="Saturation" value={e.saturation} min={0} max={200} onChange={(v, c) => set({ saturation: v }, c)} />
      <SliderField disabled={off} label="Blur px" value={e.blur} min={0} max={40} step={0.5} onChange={(v, c) => set({ blur: v }, c)} />
    </Section>
  );
}

function AudioSection({ clip }: { clip: MediaClip }) {
  const patch = usePatch(clip.id);
  const a = clip.audio;
  const set = (p: Partial<MediaClip['audio']>, commit: boolean) =>
    patch((c) => ({ ...(c as MediaClip), audio: { ...(c as MediaClip).audio, ...p } }), commit);
  const maxFade = Math.max(0, clip.duration / 2);
  return (
    <Section title="Audio" action={<ResetButton label="Reset audio" onClick={() => set(defaultAudio(), true)} />}>
      <SliderField label="Volume %" value={a.volume} min={0} max={2} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ volume: v }, c)} />
      <SliderField
        label="Pan"
        value={a.pan}
        min={-1}
        max={1}
        step={0.05}
        display={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        parse={(s) => {
          const m = s.trim().toUpperCase();
          if (m === 'C') return 0;
          const n = parseFloat(m.replace(/^[LR]/, '')) / 100;
          return m.startsWith('L') ? -n : n;
        }}
        onChange={(v, c) => set({ pan: v }, c)}
      />
      <SliderField label="Fade in s" value={a.fadeIn} min={0} max={maxFade} step={0.05} onChange={(v, c) => set({ fadeIn: v }, c)} />
      <SliderField label="Fade out s" value={a.fadeOut} min={0} max={maxFade} step={0.05} onChange={(v, c) => set({ fadeOut: v }, c)} />
    </Section>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function SpeedSection({ clip }: { clip: MediaClip }) {
  return (
    <Section title="Speed">
      <Row label="Speed">
        <select
          className="field w-full"
          aria-label="Playback speed"
          value={clip.speed}
          onChange={(e) => {
            const speed = parseFloat(e.target.value);
            useProjectStore.getState().apply((p) => setClipSpeed(p, useMediaStore.getState().assets, clip.id, speed));
          }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </Row>
      <p className="text-[11px] leading-snug text-muted">Audio pitch is preserved where the browser supports it.</p>
    </Section>
  );
}

const FONTS = [
  { value: 'Inter Variable', label: 'Inter' },
  { value: 'Georgia', label: 'Georgia (serif)' },
  { value: 'Helvetica Neue', label: 'Helvetica' },
  { value: 'Avenir Next', label: 'Avenir Next' },
  { value: 'Menlo', label: 'Menlo (mono)' },
  { value: 'Courier New', label: 'Courier' },
];

function TextSection({ clip }: { clip: TextClip }) {
  const patch = usePatch(clip.id);
  const s = clip.style;
  const set = (p: Partial<TextClip['style']>, commit = true) =>
    patch((c) => ({ ...(c as TextClip), style: { ...(c as TextClip).style, ...p } }), commit);
  return (
    <Section title="Text">
      <textarea
        className="field !h-auto min-h-[64px] w-full resize-y py-1.5 text-[13px]"
        value={clip.text}
        aria-label="Text content"
        onFocus={() => useProjectStore.getState().begin()}
        onBlur={() => useProjectStore.getState().end()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const text = e.target.value;
          patch((c) => ({ ...(c as TextClip), text }), false);
        }}
      />
      <Row label="Font">
        <select className="field w-full" value={s.fontFamily} aria-label="Font" onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Row>
      <SliderField label="Size px" value={s.fontSize} min={12} max={400} onChange={(v, c) => set({ fontSize: v }, c)} />
      <Row label="Weight">
        <Segmented
          label="Font weight"
          value={s.fontWeight}
          options={[
            { value: 400, label: 'Regular' },
            { value: 600, label: 'Semi' },
            { value: 800, label: 'Bold' },
          ]}
          onChange={(v) => set({ fontWeight: v })}
        />
      </Row>
      <Row label="Align">
        <Segmented
          label="Alignment"
          value={s.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => set({ align: v })}
        />
      </Row>
      <Row label="Color">
        <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" value={s.color} aria-label="Text color" onChange={(e) => set({ color: e.target.value })} />
        <span className="tnum text-[12px] text-muted">{s.color.toUpperCase()}</span>
      </Row>
      <Row label="Shadow">
        <Toggle label="Text shadow" checked={s.shadow} onChange={(v) => set({ shadow: v })} />
      </Row>
      <Row label="Background">
        <Toggle label="Text background" checked={!!s.background} onChange={(v) => set({ background: v ? '#15191DCC' : null })} />
        {s.background && (
          <input
            type="color"
            className="h-8 w-12 rounded border border-line bg-transparent"
            value={s.background.slice(0, 7)}
            aria-label="Background color"
            onChange={(e) => set({ background: `${e.target.value}CC` })}
          />
        )}
      </Row>
    </Section>
  );
}

function ClipHeader({ clip, asset }: { clip: Clip; asset?: MediaAsset }) {
  const fps = useProjectStore((s) => s.project.settings.fps);
  const kind = clip.type === 'text' ? 'Text' : asset?.kind === 'audio' ? 'Audio' : asset?.kind === 'image' ? 'Image' : 'Video';
  return (
    <div className="border-b border-line/70 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">{kind} clip</div>
      <div className="truncate text-[13px] font-medium" title={asset?.name}>
        {clip.type === 'text' ? clip.text.split('\n')[0] || 'Text' : asset?.name ?? 'Missing media'}
      </div>
      <div className="tnum mt-0.5 text-[11px] text-muted">
        Start {formatTimecode(clip.start, fps)} · Duration {formatTimecode(clip.duration, fps)}
        {clip.type === 'media' && asset && asset.kind !== 'image' ? ` · In ${formatTimecode(clip.in, fps)}` : ''}
      </div>
    </div>
  );
}

function ProjectInspector() {
  const settings = useProjectStore((s) => s.project.settings);
  const apply = useProjectStore((s) => s.apply);
  const quality = useUIStore((s) => s.quality);
  const showStats = useUIStore((s) => s.showStats);
  const setUI = useUIStore((s) => s.set);
  const set = (p: Partial<ProjectSettings>) => apply((pr) => ({ ...pr, settings: { ...pr.settings, ...p } }));
  const { width, height } = frameSize(settings);
  return (
    <>
      <div className="border-b border-line/70 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">Project</div>
        <div className="text-[12px] text-muted">Select a clip to edit its properties.</div>
      </div>
      <Section title="Format">
        <Row label="Aspect">
          <select className="field w-full" aria-label="Aspect ratio" value={settings.aspect} onChange={(e) => set({ aspect: e.target.value as ProjectSettings['aspect'] })}>
            {['16:9', '9:16', '1:1', '4:5', '4:3'].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Row>
        <Row label="Resolution">
          <Segmented
            label="Resolution"
            value={settings.resolution}
            options={[
              { value: 720, label: '720p' },
              { value: 1080, label: '1080p' },
            ]}
            onChange={(v) => set({ resolution: v })}
          />
        </Row>
        <Row label="Frame rate">
          <Segmented
            label="Frame rate"
            value={settings.fps}
            options={[24, 25, 30, 60].map((f) => ({ value: f as ProjectSettings['fps'], label: `${f}` }))}
            onChange={(v) => set({ fps: v })}
          />
        </Row>
        <Row label="Frame">
          <span className="tnum text-[12px] text-text/80">
            {width} × {height}
          </span>
        </Row>
        <Row label="Background">
          <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" aria-label="Background color" value={settings.background} onChange={(e) => set({ background: e.target.value })} />
        </Row>
      </Section>
      <Section title="Preview">
        <Row label="Quality">
          <Segmented<PreviewQuality>
            label="Preview quality"
            value={quality}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'half', label: 'Half' },
              { value: 'quarter', label: 'Quarter' },
            ]}
            onChange={(v) => setUI({ quality: v })}
          />
        </Row>
        <Row label="Perf stats">
          <Toggle label="Show performance stats" checked={showStats} onChange={(v) => setUI({ showStats: v })} />
        </Row>
        <p className="text-[11px] leading-snug text-muted">Lower preview quality reduces GPU and memory load on older devices.</p>
      </Section>
    </>
  );
}

export function Inspector({ onClose }: { onClose?: () => void }) {
  const clip = useProjectStore((s) => (s.selectedClipId ? s.project.clips[s.selectedClipId] : null));
  const transitionId = useProjectStore((s) => s.selectedTransitionId);
  const asset = useMediaStore((s) => (clip?.type === 'media' ? s.assets[clip.assetId] : undefined));

  let body;
  if (transitionId) body = <TransitionInspector clipId={transitionId} />;
  else if (!clip) body = <ProjectInspector />;
  else if (clip.type === 'text')
    body = (
      <>
        <TextSection clip={clip} />
        <TransformSection key={clip.id} clip={clip} />
        <AnimationSection clip={clip} />
        <TransitionInSection clip={clip} />
        <EffectsSection clip={clip} />
      </>
    );
  else if (!asset) body = <p className="p-3 text-[12px] text-muted">The media for this clip was removed.</p>;
  else if (asset.kind === 'audio')
    body = (
      <>
        <AudioSection clip={clip} />
        <SpeedSection clip={clip} />
      </>
    );
  else
    body = (
      <>
        <TransformSection key={clip.id} clip={clip} />
        <AnimationSection clip={clip} />
        <TransitionInSection clip={clip} />
        <CropSection clip={clip} />
        {asset.kind === 'video' && <SpeedSection clip={clip} />}
        <EffectsSection clip={clip} />
        {asset.kind === 'video' && <AudioSection clip={clip} />}
      </>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Inspector</h2>
        {onClose && (
          <button className="icon-btn !h-8 !min-w-8" aria-label="Close inspector" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {clip && <ClipHeader clip={clip} asset={asset} />}
        {body}
      </div>
    </div>
  );
}
