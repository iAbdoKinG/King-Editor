/**
 * Context-aware inspector: its content is derived entirely from the current
 * selection (video / image / audio / text clip, or project settings).
 */
import { useState } from 'react';
import { t as T } from '../../i18n';
import type { AnimProp, AspectPreset, AudioFx, Clip, Direction, Easing, MediaAsset, MediaClip, ProjectSettings, TextClip, Transform, Transition, TransitionType } from '../../types/project';
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
import { LOOKS, lookEffects } from './looks';
import { savePreset } from '../presets/PresetsDialog';
import { BLEND_MODES } from '../presets/presets';
import { filterString } from '../../engine/rendering/filters';
import { MotionSection } from './MotionSection';
import { AUDIO_PRESETS, MAX_VOLUME, applyAudioPreset, defaultAudioFx, fxActive, gainToDb } from '../../engine/audio/audioFx';
import { boxCorners, clipBox } from '../../engine/rendering/geometry';
import { FONTS, ensureFont } from '../fonts/fonts';
import { addTransition, extractAudio, removeTransition } from '../timeline/actions';

function isOnAudioTrack(clip: Clip): boolean {
  return useProjectStore.getState().project.tracks.find((t) => t.id === clip.trackId)?.kind === 'audio';
}
import { Icon } from '../../components/Icon';
import { canvasFilterSupported } from '../../engine/rendering/compositor';
import { MAX_EDGE, MIN_EDGE, clampDimension, defaultAudio, defaultEffects, defaultTransform, frameSize, withAspect } from '../../engine/timeline/model';
import { setClipSpeed, updateClip } from '../../engine/timeline/ops';
import { useMediaStore } from '../../stores/mediaStore';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore, type PreviewQuality, type PreviewRenderer } from '../../stores/uiStore';
import { formatTimecode } from '../../utils/time';
import { Row, Section, Segmented, SliderField, Toggle } from './controls';

const pct = (v: number) => `${Math.round(v * 100)}`;
const fromPct = (s: string) => parseFloat(s) / 100;

function usePatch(clipId: string) {
  return (fn: (c: Clip) => Clip, commit = true) =>
    useProjectStore.getState().apply((p) => updateClip(p, clipId, fn), { commit });
}

function SaveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="mr-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-elevated hover:text-text" onClick={onClick} aria-label={label} title={label}>
      <Icon name="bookmark" size={12} /> {T('Save')}
    </button>
  );
}

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="mr-2 rounded-md px-2 py-1 text-[11px] text-muted hover:bg-elevated hover:text-text" onClick={onClick} aria-label={label}>
      {T('Reset')}
    </button>
  );
}

function useIsPro(): boolean {
  return useUIStore((s) => s.mode) === 'pro';
}

const BLEND_LABELS: Record<string, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Color dodge',
  'color-burn': 'Color burn',
  'hard-light': 'Hard light',
  'soft-light': 'Soft light',
  difference: 'Difference',
  exclusion: 'Exclusion',
};

/** Pro-only effects: blend modes, drop shadow, rounded corners, invert. */
function ProEffectsSection({ clip }: { clip: Clip }) {
  const patch = usePatch(clip.id);
  const e = { ...defaultEffects(), ...clip.effects };
  const set = (p: Partial<Clip['effects']>, commit: boolean) => patch((c) => ({ ...c, effects: { ...defaultEffects(), ...c.effects, ...p } }) as Clip, commit);
  const off = !canvasFilterSupported;
  return (
    <Section title={T('Pro effects')}>
      <Row label={T('Blend')}>
        <select className="field w-full" aria-label={T('Blend mode')} value={e.blend} onChange={(ev) => set({ blend: ev.target.value as Clip['effects']['blend'] }, true)}>
          {BLEND_MODES.map((b) => (
            <option key={b} value={b}>
              {T(BLEND_LABELS[b])}
            </option>
          ))}
        </select>
      </Row>
      <SliderField label={T('Corners px')} value={e.radius ?? 0} min={0} max={400} step={1} onChange={(v, c) => set({ radius: v }, c)} />
      <SliderField disabled={off} label={T('Invert')} value={e.invert ?? 0} min={0} max={100} onChange={(v, c) => set({ invert: v }, c)} />
      <Row label={T('Shadow')}>
        <Toggle label={T('Drop shadow')} checked={(e.shadow ?? 0) > 0} onChange={(on) => set({ shadow: on ? 60 : 0 }, true)} />
        {(e.shadow ?? 0) > 0 && (
          <input
            type="color"
            className="h-8 w-12 rounded border border-line bg-transparent"
            aria-label={T('Shadow color')}
            value={e.shadowColor ?? '#000000'}
            onChange={(ev) => set({ shadowColor: ev.target.value }, true)}
          />
        )}
      </Row>
      {(e.shadow ?? 0) > 0 && (
        <>
          <SliderField disabled={off} label={T('Shadow %')} value={e.shadow ?? 0} min={1} max={100} onChange={(v, c) => set({ shadow: v }, c)} />
          <SliderField disabled={off} label={T('Offset X')} value={e.shadowX ?? 0} min={-200} max={200} onChange={(v, c) => set({ shadowX: v }, c)} />
          <SliderField disabled={off} label={T('Offset Y')} value={e.shadowY ?? 0} min={-200} max={200} onChange={(v, c) => set({ shadowY: v }, c)} />
          <SliderField disabled={off} label={T('Softness')} value={e.shadowBlur ?? 0} min={0} max={150} onChange={(v, c) => set({ shadowBlur: v }, c)} />
        </>
      )}
    </Section>
  );
}

function useClipTime(clip: Clip) {
  const t = usePlayheadTime();
  const inside = t >= clip.start && t < clip.start + clip.duration;
  const lt = Math.min(Math.max(0, t - clip.start), clip.duration);
  return { t, lt, inside };
}

function TransformSection({ clip }: { clip: Clip }) {
  const pro = useIsPro();
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
      title={T("Transform")}
      action={
        <ResetButton
          label={T("Reset transform")}
          onClick={() => patch((c) => ({ ...c, keyframes: undefined, transform: { ...defaultTransform(), crop: c.transform.crop } }) as Clip)}
        />
      }
    >
      <TransformTools clip={clip} lt={lt} />
      <SliderField label={T("Position X")} value={tr.x} min={-W} max={W} step={1} keyframe={pro ? kf('x') : undefined} onChange={(v, c) => anim('x', v, c)} />
      <SliderField label={T("Position Y")} value={tr.y} min={-H} max={H} step={1} keyframe={pro ? kf('y') : undefined} onChange={(v, c) => anim('y', v, c)} />
      {uniform ? (
        <SliderField
          label={T("Scale %")}
          value={tr.scaleX}
          min={0.05}
          max={4}
          step={0.01}
          display={pct}
          parse={fromPct}
          keyframe={pro ? kf('scale') : undefined}
          onChange={(v, c) => anim('scale', v, c)}
        />
      ) : (
        <>
          <SliderField label={T("Width %")} value={base.scaleX} min={0.05} max={4} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ scaleX: v }, c)} />
          <SliderField label={T("Height %")} value={base.scaleY} min={0.05} max={4} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ scaleY: v }, c)} />
        </>
      )}
      {!scaleAnimated && (
        <Row label={T("Link")}>
          <Toggle
            label={T("Link width & height")}
            checked={uniform}
            onChange={(on) => {
              setUniform(on);
              if (on && base.scaleX !== base.scaleY) set({ scaleY: base.scaleX }, true);
            }}
          />
        </Row>
      )}
      <SliderField label={T("Rotation °")} value={tr.rotation} min={-180} max={180} step={0.5} keyframe={pro ? kf('rotation') : undefined} onChange={(v, c) => anim('rotation', v, c)} />
      <SliderField label={T("Opacity %")} value={tr.opacity} min={0} max={1} step={0.01} display={pct} parse={fromPct} keyframe={pro ? kf('opacity') : undefined} onChange={(v, c) => anim('opacity', v, c)} />
      {pro && <SliderField label={T("Anchor X %")} value={base.anchorX} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ anchorX: v }, c)} />}
      {pro && <SliderField label={T("Anchor Y %")} value={base.anchorY} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ anchorY: v }, c)} />}
      {!inside && <p className="text-[11px] leading-snug text-muted">{T("Move the playhead over this clip to add keyframes.")}</p>}
    </Section>
  );
}

/** Flip, fit/fill/stretch and a 3×3 alignment grid (rotation-aware). */
function TransformTools({ clip, lt }: { clip: Clip; lt: number }) {
  const patch = usePatch(clip.id);
  const assets = useMediaStore((s) => s.assets);
  const settings = useProjectStore((s) => s.project.settings);
  const { width: W, height: H } = frameSize(settings);
  const tr = resolveTransform(clip, lt);
  const base = clipBox(clip, assets, W, H, { ...tr, scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0, flipH: false, flipV: false });
  const align = (hx: -1 | 0 | 1, vy: -1 | 0 | 1) => {
    const box = clipBox(clip, assets, W, H, tr);
    if (!box) return;
    const pts = boxCorners(box);
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const dx = hx < 0 ? -minX : hx > 0 ? W - maxX : W / 2 - (minX + maxX) / 2;
    const dy = vy < 0 ? -minY : vy > 0 ? H - maxY : H / 2 - (minY + maxY) / 2;
    patch((c) => setAnimatedValue(setAnimatedValue(c, 'x', lt, Math.round(tr.x + dx)), 'y', lt, Math.round(tr.y + dy)));
  };
  const fit = (mode: 'fit' | 'fill' | 'stretch') => {
    if (!base) return;
    const fill = Math.max(W / base.w, H / base.h);
    patch((c) => {
      let n = setAnimatedValue(setAnimatedValue(c, 'x', lt, 0), 'y', lt, 0);
      if (mode === 'stretch') n = { ...n, keyframes: n.keyframes ? { ...n.keyframes, scale: undefined } : undefined, transform: { ...n.transform, scaleX: W / base.w, scaleY: H / base.h } } as Clip;
      else {
        n = { ...n, transform: { ...n.transform, scaleY: n.transform.scaleX } } as Clip;
        n = setAnimatedValue(n, 'scale', lt, mode === 'fit' ? 1 : fill);
      }
      return n;
    });
  };
  const btn = 'field flex h-9 flex-1 items-center justify-center gap-1 text-[11.5px] hover:border-accent';
  return (
    <div className="mb-2 space-y-2">
      <div className="flex gap-1.5">
        <button className={btn} aria-pressed={!!clip.transform.flipH} onClick={() => patch((c) => ({ ...c, transform: { ...c.transform, flipH: !c.transform.flipH } }) as Clip)}>
          <Icon name="flipH" size={15} /> {T('Flip')}
        </button>
        <button className={btn} aria-pressed={!!clip.transform.flipV} onClick={() => patch((c) => ({ ...c, transform: { ...c.transform, flipV: !c.transform.flipV } }) as Clip)}>
          <Icon name="flipV" size={15} /> {T('Flip')}
        </button>
        <button className={btn} onClick={() => fit('fit')}>{T("Fit")}</button>
        <button className={btn} onClick={() => fit('fill')}>{T("Fill")}</button>
        <button className={btn} onClick={() => fit('stretch')}>{T("Stretch")}</button>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-[64px] text-[12px] text-muted">{T("Align")}</span>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label={T("Align in frame")}>
          {([-1, 0, 1] as const).flatMap((vy) =>
            ([-1, 0, 1] as const).map((hx) => (
              <button
                key={`${hx}${vy}`}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-line hover:border-accent"
                aria-label={T('Align {v} {h}', { v: T(vy < 0 ? 'top' : vy > 0 ? 'bottom' : 'middle'), h: T(hx < 0 ? 'left' : hx > 0 ? 'right' : 'center') })}
                onClick={() => align(hx, vy)}
              >
                <span className="block h-1.5 w-1.5 rounded-full bg-muted" style={{ transform: `translate(${hx * 7}px, ${vy * 7}px)` }} />
              </button>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

const EASINGS: Array<{ value: Easing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeIn', label: 'Ease In' },
  { value: 'easeOut', label: 'Ease Out' },
  { value: 'easeInOut', label: 'Ease In/Out' },
];

function AnimationSection({ clip }: { clip: Clip }) {
  const pro = useIsPro();
  const patch = usePatch(clip.id);
  const { lt } = useClipTime(clip);
  const times = keyframeTimes(clip);
  if (!times.length || !pro)
    return pro || times.length ? (
      <Section title={T('Keyframes')}>
        {pro ? (
          <p className="text-[11px] leading-snug text-muted">
            {T('Tap ◆ next to Position, Scale, Rotation or Opacity to add a keyframe at the playhead. Change the value at another time to animate.')}
          </p>
        ) : (
          <>
            <p className="text-[11px] leading-snug text-muted">{T('This clip has keyframes from an earlier version. Moving it at another time can change its motion.')}</p>
            <button className="text-[12px] text-danger" onClick={() => patch((c) => clearAnimation(c))}>
              {T('Remove all keyframes')}
            </button>
          </>
        )}
      </Section>
    ) : null;
  const atKf = times.find((t) => Math.abs(t - lt) < KF_EPS);
  const prev = [...times].reverse().find((t) => t < lt - KF_EPS);
  const next = times.find((t) => t > lt + KF_EPS);
  const easingAt =
    atKf !== undefined
      ? ANIM_PROPS.map((p) => clip.keyframes?.[p]?.find((k) => Math.abs(k.t - atKf) < KF_EPS)?.ease).find(Boolean) ?? 'linear'
      : null;
  const seekLocal = (t: number) => engine.seek(clip.start + Math.min(Math.max(0, t), clip.duration - 1e-3));
  return (
    <Section
      title={T('Keyframes · {n}', { n: times.length })}
      action={<SaveButton label={T("Save animation as preset")} onClick={() => savePreset('animation', { ...(clip.keyframes ?? {}), motion: clip.motion }, T('My animation'))} />}
    >
      <div className="flex gap-2">
        <button className="field flex-1 text-[12px] disabled:opacity-40" disabled={prev === undefined} onClick={() => seekLocal(prev!)}>
          {T('◂ Previous')}
        </button>
        <button className="field flex-1 text-[12px] disabled:opacity-40" disabled={next === undefined} onClick={() => seekLocal(next!)}>
          {T('Next ▸')}
        </button>
      </div>
      <Row label={T("Easing")}>
        <select
          className="field w-full"
          aria-label={T("Keyframe easing")}
          disabled={atKf === undefined}
          value={easingAt ?? 'linear'}
          onChange={(e) => patch((c) => setEasingAt(c, atKf!, e.target.value as Easing))}
        >
          {EASINGS.map((e) => (
            <option key={e.value} value={e.value}>
              {T(e.label)}
            </option>
          ))}
        </select>
      </Row>
      {atKf === undefined && <p className="text-[11px] text-muted">{T("Easing applies from the keyframe at the playhead.")}</p>}
      <button className="mt-1 text-[12px] text-danger" onClick={() => patch((c) => clearAnimation(c))}>
        {T('Remove all keyframes')}
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
    <Section title={T("Transition in")}>
      <button className="field w-full text-[12px]" onClick={() => addTransition(clip.id)}>
        {T(clip.transitionIn ? 'Edit transition from previous clip' : 'Add transition from previous clip')}
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
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">{T("Transition")}</div>
        <div className="text-[13px] font-medium">{T(TRANSITION_TYPES.find((x) => x.value === tr.type)?.label ?? '')}</div>
        {!prev && <div className="text-[11px] text-danger">{T("Inactive: the clips no longer touch.")}</div>}
      </div>
      <Section title={T("Settings")} action={<SaveButton label={T("Save transition as preset")} onClick={() => savePreset('transition', tr, T(TRANSITION_TYPES.find((x) => x.value === tr.type)?.label ?? 'Transition'))} />}>
        <Row label={T("Type")}>
          <select className="field w-full" aria-label={T("Transition type")} value={tr.type} onChange={(e) => set({ type: e.target.value as TransitionType })}>
            {TRANSITION_TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {T(x.label)}
              </option>
            ))}
          </select>
        </Row>
        <SliderField
          label={T("Duration s")}
          value={Math.min(tr.duration, max)}
          min={0.1}
          max={Math.max(0.1, Math.min(4, max))}
          step={0.05}
          onChange={(v, c) => set({ duration: v }, c)}
        />
        {TRANSITION_TYPES.find((x) => x.value === tr.type)?.directional && (
          <Row label={T("Direction")}>
            <Segmented<Direction>
              label={T("Direction")}
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
        {useIsPro() && <Row label={T("Easing")}>
          <select className="field w-full" aria-label={T("Transition easing")} value={tr.easing} onChange={(e) => set({ easing: e.target.value as Easing })}>
            {EASINGS.map((e) => (
              <option key={e.value} value={e.value}>
                {T(e.label)}
              </option>
            ))}
          </select>
        </Row>}
        <button className="mt-1 text-[12px] text-danger" onClick={() => removeTransition(clipId)}>
          {T('Remove transition (cut)')}
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
    <Section title={T("Crop")} action={<ResetButton label={T("Reset crop")} onClick={() => set({ top: 0, right: 0, bottom: 0, left: 0 }, true)} />}>
      {side('left', T('Left %'), 'right')}
      {side('right', T('Right %'), 'left')}
      {side('top', T('Top %'), 'bottom')}
      {side('bottom', T('Bottom %'), 'top')}
    </Section>
  );
}

function EffectsSection({ clip, asset }: { clip: Clip; asset?: MediaAsset }) {
  const pro = useIsPro();
  const patch = usePatch(clip.id);
  const e = { ...defaultEffects(), ...clip.effects };
  const set = (p: Partial<Clip['effects']>, commit: boolean) => patch((c) => ({ ...c, effects: { ...defaultEffects(), ...c.effects, ...p } }) as Clip, commit);
  const off = !canvasFilterSupported;
  const thumb = asset?.thumbUrl;
  return (
    <Section
      title={T("Color & Effects")}
      action={
        <div className="flex">
          <SaveButton label={T("Save effects as preset")} onClick={() => savePreset('effects', e, T('My look'))} />
          <ResetButton label={T("Reset effects")} onClick={() => set(defaultEffects(), true)} />
        </div>
      }
    >
      {off && (
        <p className="pb-1 text-[11px] leading-snug text-muted">
          {T('This browser does not support canvas filters, so color effects are unavailable here.')}
        </p>
      )}
      {!off && (
        <div className="no-scrollbar -mx-3 mb-1 flex gap-2 overflow-x-auto px-3 pb-1" role="listbox" aria-label={T("Looks")}>
          {LOOKS.map((l) => {
            const fx = lookEffects(l.id);
            return (
              <button
                key={l.id}
                className="flex w-[64px] shrink-0 flex-col items-center gap-1 text-[10.5px] text-muted hover:text-text"
                onClick={() => set(fx, true)}
                aria-label={T('Look {name}', { name: T(l.name) })}
              >
                <span
                  className="block h-11 w-16 overflow-hidden rounded-md border border-line bg-elevated"
                  style={{
                    backgroundImage: thumb ? `url(${thumb})` : 'linear-gradient(135deg,#d98c5f,#5f8fd9 55%,#6fcf97)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: filterString(fx, null, 0.2),
                  }}
                />
                {T(l.name)}
              </button>
            );
          })}
        </div>
      )}
      <SliderField disabled={off} label={T("Brightness")} value={e.brightness} min={0} max={200} onChange={(v, c) => set({ brightness: v }, c)} />
      <SliderField disabled={off} label={T("Contrast")} value={e.contrast} min={0} max={200} onChange={(v, c) => set({ contrast: v }, c)} />
      <SliderField disabled={off} label={T("Saturation")} value={e.saturation} min={0} max={200} onChange={(v, c) => set({ saturation: v }, c)} />
      {pro && <SliderField disabled={off} label={T("Hue °")} value={e.hue} min={-180} max={180} onChange={(v, c) => set({ hue: v }, c)} />}
      {pro && <SliderField disabled={off} label={T("Warmth")} value={e.sepia} min={0} max={100} onChange={(v, c) => set({ sepia: v }, c)} />}
      {pro && <SliderField disabled={off} label={T("Grayscale")} value={e.grayscale} min={0} max={100} onChange={(v, c) => set({ grayscale: v }, c)} />}
      {pro && <SliderField disabled={off} label={T("Vignette")} value={e.vignette} min={0} max={100} onChange={(v, c) => set({ vignette: v }, c)} />}
      {pro && <SliderField disabled={off} label={T("Blur px")} value={e.blur} min={0} max={40} step={0.5} onChange={(v, c) => set({ blur: v }, c)} />}
    </Section>
  );
}

function AudioSection({ clip }: { clip: MediaClip }) {
  const pro = useIsPro();
  const patch = usePatch(clip.id);
  const a = clip.audio;
  const set = (p: Partial<MediaClip['audio']>, commit: boolean) =>
    patch((c) => ({ ...(c as MediaClip), audio: { ...(c as MediaClip).audio, ...p } }), commit);
  const maxFade = Math.max(0, clip.duration / 2);
  return (
    <Section title={T("Audio")} action={<ResetButton label={T("Reset audio")} onClick={() => set(defaultAudio(), true)} />}>
      <SliderField label={T('Volume %')} value={a.volume} min={0} max={MAX_VOLUME} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ volume: v }, c)} />
      <div className="flex items-center gap-1.5 pb-1">
        <bdi dir="ltr" className="tnum w-[58px] shrink-0 text-[11px] text-muted" data-testid="volume-db">
          {gainToDb(a.volume)}
        </bdi>
        {[0, 0.5, 1, 2, 4].map((v) => (
          <button key={v} className={`h-7 flex-1 rounded-md border text-[11px] ${Math.abs(a.volume - v) < 0.005 ? 'border-accent text-text' : 'border-line text-muted hover:text-text'}`} onClick={() => set({ volume: v }, true)}>
            {v === 0 ? T('Mute') : `${v * 100}%`}
          </button>
        ))}
      </div>
      {pro && <SliderField
        label={T("Pan")}
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
      />}
      {clip.type === 'media' && useMediaStore.getState().assets[clip.assetId]?.kind === 'video' && !isOnAudioTrack(clip) && (
        <button className="field mb-1 w-full text-[12px]" onClick={() => extractAudio(clip.id)}>
          {T('Extract audio to its own track')}
        </button>
      )}
      <SliderField label={T("Fade in s")} value={a.fadeIn} min={0} max={maxFade} step={0.05} onChange={(v, c) => set({ fadeIn: v }, c)} />
      <SliderField label={T("Fade out s")} value={a.fadeOut} min={0} max={maxFade} step={0.05} onChange={(v, c) => set({ fadeOut: v }, c)} />
    </Section>
  );
}

function AudioFxSection({ clip }: { clip: MediaClip }) {
  const pro = useIsPro();
  const patch = usePatch(clip.id);
  const fx = clip.audio.fx ?? defaultAudioFx();
  const setFx = (next: AudioFx | undefined, commit: boolean) =>
    patch((c) => {
      const m = c as MediaClip;
      const audio = { ...m.audio };
      if (next && fxActive(next)) audio.fx = next;
      else delete audio.fx;
      return { ...m, audio };
    }, commit);
  const set = (p: Partial<AudioFx>, commit: boolean) => setFx({ ...fx, ...p, preset: undefined }, commit);
  const db = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`;
  const hz = (v: number) => (v <= 0 ? T('Off') : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
  return (
    <Section title={T('Sound effects')} action={<ResetButton label={T('Reset sound effects')} onClick={() => setFx(undefined, true)} />}>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1.5" role="listbox" aria-label={T('Sound presets')}>
        {AUDIO_PRESETS.map((p) => {
          const on = p.id === 'none' ? !clip.audio.fx : fx.preset === p.id;
          return (
            <button
              key={p.id}
              role="option"
              aria-selected={on}
              data-testid={`audio-preset-${p.id}`}
              className={`h-8 shrink-0 rounded-full border px-3 text-[11.5px] ${on ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:text-text'}`}
              onClick={() => setFx(p.id === 'none' ? undefined : applyAudioPreset(p.id), true)}
            >
              {T(p.name)}
            </button>
          );
        })}
      </div>
      <SliderField label={T('Bass dB')} value={fx.low} min={-15} max={15} step={0.5} display={db} onChange={(v, c) => set({ low: v }, c)} />
      <SliderField label={T('Mids dB')} value={fx.mid} min={-15} max={15} step={0.5} display={db} onChange={(v, c) => set({ mid: v }, c)} />
      <SliderField label={T('Treble dB')} value={fx.high} min={-15} max={15} step={0.5} display={db} onChange={(v, c) => set({ high: v }, c)} />
      <SliderField label={T('Echo %')} value={fx.echo} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ echo: v }, c)} />
      <SliderField label={T('Reverb %')} value={fx.reverb} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ reverb: v }, c)} />
      {pro && (
        <>
          <SliderField label={T('Low cut Hz')} value={fx.highpass} min={0} max={1000} step={5} display={hz} onChange={(v, c) => set({ highpass: v < 20 ? 0 : v }, c)} />
          <SliderField label={T('High cut Hz')} value={fx.lowpass || 20000} min={300} max={20000} step={50} display={(v) => (v >= 20000 ? T('Off') : hz(v))} onChange={(v, c) => set({ lowpass: v >= 20000 ? 0 : v }, c)} />
          <SliderField label={T('Compressor %')} value={fx.compressor} min={0} max={1} step={0.01} display={pct} parse={fromPct} onChange={(v, c) => set({ compressor: v }, c)} />
          <SliderField label={T('Echo delay s')} value={fx.echoTime} min={0.05} max={1.2} step={0.01} onChange={(v, c) => set({ echoTime: v }, c)} />
        </>
      )}
    </Section>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function SpeedSection({ clip }: { clip: MediaClip }) {
  return (
    <Section title={T("Speed")}>
      <Row label={T("Speed")}>
        <select
          className="field w-full"
          aria-label={T("Playback speed")}
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
      <p className="text-[11px] leading-snug text-muted">{T("Audio pitch is preserved where the browser supports it.")}</p>
    </Section>
  );
}



function TextSection({ clip }: { clip: TextClip }) {
  const patch = usePatch(clip.id);
  const s = clip.style;
  const set = (p: Partial<TextClip['style']>, commit = true) =>
    patch((c) => ({ ...(c as TextClip), style: { ...(c as TextClip).style, ...p } }), commit);
  return (
    <Section title={T("Text")} action={<SaveButton label={T("Save text style as preset")} onClick={() => savePreset('textStyle', s, T('My text style'))} />}>
      <textarea
        className="field !h-auto min-h-[64px] w-full resize-y py-1.5 text-[13px]"
        dir="auto"
        value={clip.text}
        aria-label={T("Text content")}
        onFocus={() => useProjectStore.getState().begin()}
        onBlur={() => useProjectStore.getState().end()}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const text = e.target.value;
          patch((c) => ({ ...(c as TextClip), text }), false);
        }}
      />
      <Row label={T("Font")}>
        <select
          className="field w-full"
          value={s.fontFamily}
          aria-label={T("Font")}
          onChange={(e) => {
            const fontFamily = e.target.value;
            void ensureFont(fontFamily);
            set({ fontFamily });
          }}
        >
          {(['arabic', 'latin', 'system'] as const).map((g) => (
            <optgroup key={g} label={g === 'arabic' ? 'عربي · Arabic' : T(g === 'latin' ? 'Latin' : 'System')}>
              {FONTS.filter((f) => f.script === g).map((f) => (
                <option key={f.family} value={f.family}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      <SliderField label={T("Size px")} value={s.fontSize} min={12} max={400} onChange={(v, c) => set({ fontSize: v }, c)} />
      <Row label={T("Weight")}>
        <Segmented
          label={T("Font weight")}
          value={s.fontWeight}
          options={[
            { value: 400, label: 'Regular' },
            { value: 600, label: 'Semi' },
            { value: 800, label: 'Bold' },
          ]}
          onChange={(v) => set({ fontWeight: v })}
        />
      </Row>
      <Row label={T("Align")}>
        <Segmented
          label={T("Alignment")}
          value={s.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => set({ align: v })}
        />
      </Row>
      <Row label={T("Color")}>
        <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" value={s.color} aria-label={T("Text color")} onChange={(e) => set({ color: e.target.value })} />
        <span className="tnum text-[12px] text-muted">{s.color.toUpperCase()}</span>
      </Row>
      <Row label={T("Shadow")}>
        <Toggle label={T("Text shadow")} checked={s.shadow} onChange={(v) => set({ shadow: v })} />
      </Row>
      <Row label={T("Background")}>
        <Toggle label={T("Text background")} checked={!!s.background} onChange={(v) => set({ background: v ? '#15191DCC' : null })} />
        {s.background && (
          <input
            type="color"
            className="h-8 w-12 rounded border border-line bg-transparent"
            value={s.background.slice(0, 7)}
            aria-label={T("Background color")}
            onChange={(e) => set({ background: `${e.target.value}CC` })}
          />
        )}
      </Row>
    </Section>
  );
}

function ClipHeader({ clip, asset }: { clip: Clip; asset?: MediaAsset }) {
  const fps = useProjectStore((s) => s.project.settings.fps);
  const kind = T(clip.type === 'text' ? 'Text' : asset?.kind === 'audio' ? 'Audio' : asset?.kind === 'image' ? 'Image' : 'Video');
  return (
    <div className="border-b border-line/70 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">{T('{kind} clip', { kind })}</div>
      <div className="truncate text-[13px] font-medium" title={asset?.name}>
        {clip.type === 'text' ? clip.text.split('\n')[0] || T('Text') : asset?.name ?? T('Missing media')}
      </div>
      <div className="tnum mt-0.5 text-[11px] text-muted">
        {T('Start {start} · Duration {dur}', { start: formatTimecode(clip.start, fps), dur: formatTimecode(clip.duration, fps) })}
        {clip.type === 'media' && asset && asset.kind !== 'image' ? T(' · In {t}', { t: formatTimecode(clip.in, fps) }) : ''}
      </div>
    </div>
  );
}

/** Numeric pixel field that commits on Enter/blur (clamped to the allowed range, even numbers). */
function DimensionField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : String(value);
  const commit = () => {
    setEditing(false);
    const v = clampDimension(parseFloat(text));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[10px] text-muted">{label}</span>
      <input
        className="field tnum w-full text-center text-[13px]"
        dir="ltr"
        inputMode="numeric"
        aria-label={label}
        value={shown}
        onFocus={(e) => {
          setEditing(true);
          setText(String(value));
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function ProjectInspector() {
  const settings = useProjectStore((s) => s.project.settings);
  const apply = useProjectStore((s) => s.apply);
  const quality = useUIStore((s) => s.quality);
  const showStats = useUIStore((s) => s.showStats);
  const renderer = useUIStore((s) => s.renderer);
  const setUI = useUIStore((s) => s.set);
  const set = (p: Partial<ProjectSettings>) => apply((pr) => ({ ...pr, settings: { ...pr.settings, ...p } }));
  const { width, height } = frameSize(settings);
  return (
    <>
      <div className="border-b border-line/70 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">{T("Project")}</div>
        <div className="text-[12px] text-muted">{T("Select a clip to edit its properties.")}</div>
      </div>
      <Section title={T("Format")}>
        <Row label={T("Aspect")}>
          <select
            className="field w-full"
            aria-label={T("Aspect ratio")}
            value={settings.aspect}
            onChange={(e) => apply((pr) => ({ ...pr, settings: withAspect(pr.settings, e.target.value as AspectPreset) }))}
          >
            {(['16:9', '9:16', '1:1', '4:5', '4:3'] as const).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            <option value="custom">{T('Custom size')}</option>
          </select>
        </Row>
        {settings.aspect === 'custom' ? (
          <Row label={T('Size')}>
            <DimensionField label={T('Width')} value={width} onCommit={(v) => set({ customWidth: v })} />
            <span className="text-muted">×</span>
            <DimensionField label={T('Height')} value={height} onCommit={(v) => set({ customHeight: v })} />
            <button
              className="icon-btn !h-8 !min-w-8 shrink-0"
              aria-label={T('Swap width and height')}
              title={T('Swap width and height')}
              onClick={() => set({ customWidth: height, customHeight: width })}
            >
              ⇄
            </button>
          </Row>
        ) : (
          <Row label={T("Resolution")}>
            <Segmented
              label={T("Resolution")}
              value={settings.resolution}
              options={[
                { value: 720, label: '720p' },
                { value: 1080, label: '1080p' },
                { value: 1440, label: '2K' },
              ]}
              onChange={(v) => set({ resolution: v })}
            />
          </Row>
        )}
        {settings.aspect === 'custom' && (
          <p className="text-[11px] leading-snug text-muted">{T('Each side from {min} to {max} pixels (2K maximum).', { min: MIN_EDGE, max: MAX_EDGE })}</p>
        )}
        <Row label={T("Frame rate")}>
          <Segmented
            label={T("Frame rate")}
            value={settings.fps}
            options={[24, 25, 30, 60].map((f) => ({ value: f as ProjectSettings['fps'], label: `${f}` }))}
            onChange={(v) => set({ fps: v })}
          />
        </Row>
        <Row label={T("Frame")}>
          <span className="tnum text-[12px] text-text/80">
            <bdi dir="ltr">{width} × {height}</bdi>
          </span>
        </Row>
        <Row label={T("Background")}>
          <input type="color" className="h-8 w-12 rounded border border-line bg-transparent" aria-label={T("Background color")} value={settings.background} onChange={(e) => set({ background: e.target.value })} />
        </Row>
      </Section>
      <Section title={T("Preview")}>
        <Row label={T("Quality")}>
          <Segmented<PreviewQuality>
            label={T("Preview quality")}
            value={quality}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'half', label: 'Half' },
              { value: 'quarter', label: 'Quarter' },
            ]}
            onChange={(v) => setUI({ quality: v })}
          />
        </Row>
        {useIsPro() && (<>
        <Row label={T("Renderer")}>
          <Segmented<PreviewRenderer>
            label={T("Preview renderer")}
            value={renderer}
            options={[
              { value: 'gpu', label: 'GPU (smooth)' },
              { value: 'canvas', label: 'Canvas' },
            ]}
            onChange={(v) => setUI({ renderer: v })}
          />
        </Row>
        <Row label={T("Perf stats")}>
          <Toggle label={T("Show performance stats")} checked={showStats} onChange={(v) => setUI({ showStats: v })} />
        </Row>
        </>)}
        <p className="text-[11px] leading-snug text-muted">{T('GPU shows video directly through the browser compositor (smoothest). Quality applies to the Canvas renderer.')}</p>
      </Section>
    </>
  );
}

export function Inspector({ onClose }: { onClose?: () => void }) {
  const clip = useProjectStore((s) => (s.selectedClipId ? s.project.clips[s.selectedClipId] : null));
  const transitionId = useProjectStore((s) => s.selectedTransitionId);
  const pro = useIsPro();
  const onAudioTrack = useProjectStore((s) => (clip ? s.project.tracks.find((t) => t.id === clip.trackId)?.kind === 'audio' : false));
  const asset = useMediaStore((s) => (clip?.type === 'media' ? s.assets[clip.assetId] : undefined));

  let body;
  if (transitionId) body = <TransitionInspector clipId={transitionId} />;
  else if (!clip) body = <ProjectInspector />;
  else if (clip.type === 'text')
    body = (
      <>
        <TextSection clip={clip} />
        <TransformSection key={clip.id} clip={clip} />
        <MotionSection key={`m${clip.id}`} clip={clip} />
        <AnimationSection clip={clip} />
        <TransitionInSection clip={clip} />
        <EffectsSection clip={clip} asset={asset} />
        {pro && <ProEffectsSection clip={clip} />}
      </>
    );
  else if (!asset) body = <p className="p-3 text-[12px] text-muted">{T("The media for this clip was removed.")}</p>;
  else if (asset.kind === 'audio' || onAudioTrack)
    body = (
      <>
        <AudioSection clip={clip} />
        <AudioFxSection clip={clip} />
        <SpeedSection clip={clip} />
      </>
    );
  else
    body = (
      <>
        <TransformSection key={clip.id} clip={clip} />
        <MotionSection key={`m${clip.id}`} clip={clip} />
        <AnimationSection clip={clip} />
        <TransitionInSection clip={clip} />
        {pro && <CropSection clip={clip} />}
        {asset.kind === 'video' && <SpeedSection clip={clip} />}
        <EffectsSection clip={clip} asset={asset} />
        {pro && <ProEffectsSection clip={clip} />}
        {asset.kind === 'video' && <AudioSection clip={clip} />}
        {asset.kind === 'video' && <AudioFxSection clip={clip} />}
      </>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inspector">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{T("Inspector")}</h2>
        {onClose && (
          <button className="icon-btn !h-8 !min-w-8" aria-label={T("Close inspector")} onClick={onClose}>
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
