/**
 * Keyframe animation. Keyframe times are clip-local, so animations move with
 * their clip. A property with keyframes ignores its static value.
 */
import type { AnimProp, Clip, Easing, Keyframe, Keyframes, Transform } from '../../types/project';

export const ANIM_PROPS: AnimProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
/** Two keyframes closer than this (seconds) are considered the same. */
export const KF_EPS = 1 / 240;

export function ease(e: Easing, p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p;
  switch (e) {
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - (1 - x) ** 3;
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    default:
      return x;
  }
}

export function evalKeyframes(kfs: Keyframe[], t: number): number {
  if (kfs.length === 0) return 0;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const p = span > 0 ? ease(a.ease, (t - a.t) / span) : 1;
      return a.v + (b.v - a.v) * p;
    }
  }
  return last.v;
}

export function baseValue(tr: Transform, prop: AnimProp): number {
  return prop === 'scale' ? tr.scaleX : tr[prop];
}

function applyValue(tr: Transform, prop: AnimProp, v: number): Transform {
  if (prop === 'scale') {
    const ratio = tr.scaleX !== 0 ? tr.scaleY / tr.scaleX : 1;
    return { ...tr, scaleX: v, scaleY: v * ratio };
  }
  return { ...tr, [prop]: v };
}

export function hasKeyframes(clip: Clip, prop?: AnimProp): boolean {
  const k = clip.keyframes;
  if (!k) return false;
  if (prop) return (k[prop]?.length ?? 0) > 0;
  return ANIM_PROPS.some((p) => (k[p]?.length ?? 0) > 0);
}

/** The clip's transform at clip-local time `lt`, with keyframes applied. */
export function resolveTransform(clip: Clip, lt: number): Transform {
  let tr = clip.transform;
  const k = clip.keyframes;
  if (!k) return tr;
  for (const p of ANIM_PROPS) {
    const list = k[p];
    if (list && list.length) tr = applyValue(tr, p, evalKeyframes(list, lt));
  }
  return tr;
}

export function valueAt(clip: Clip, prop: AnimProp, lt: number): number {
  const list = clip.keyframes?.[prop];
  return list && list.length ? evalKeyframes(list, lt) : baseValue(clip.transform, prop);
}

export function keyframeIndexAt(list: Keyframe[] | undefined, t: number): number {
  if (!list) return -1;
  return list.findIndex((k) => Math.abs(k.t - t) < KF_EPS);
}

function withKeyframes<C extends Clip>(clip: C, prop: AnimProp, list: Keyframe[]): C {
  const keyframes: Keyframes = { ...(clip.keyframes ?? {}) };
  if (list.length) keyframes[prop] = list;
  else delete keyframes[prop];
  return { ...clip, keyframes } as C;
}

/** Insert or replace a keyframe at clip-local time `t`. */
export function upsertKeyframe<C extends Clip>(clip: C, prop: AnimProp, t: number, v: number, easing?: Easing): C {
  const list = [...(clip.keyframes?.[prop] ?? [])];
  const i = keyframeIndexAt(list, t);
  if (i >= 0) list[i] = { ...list[i], v, ease: easing ?? list[i].ease };
  else {
    list.push({ t, v, ease: easing ?? 'linear' });
    list.sort((a, b) => a.t - b.t);
  }
  return withKeyframes(clip, prop, list);
}

export function removeKeyframe<C extends Clip>(clip: C, prop: AnimProp, t: number): C {
  const list = clip.keyframes?.[prop];
  if (!list) return clip;
  const next = list.filter((k) => Math.abs(k.t - t) >= KF_EPS);
  // Removing the last keyframe keeps the property at its current value.
  if (!next.length) return { ...withKeyframes(clip, prop, []), transform: applyValue(clip.transform, prop, list[0].v) } as C;
  return withKeyframes(clip, prop, next);
}

/** Toggle a keyframe at `t` holding the property's current animated value. */
export function toggleKeyframe<C extends Clip>(clip: C, prop: AnimProp, t: number): C {
  if (keyframeIndexAt(clip.keyframes?.[prop], t) >= 0) return removeKeyframe(clip, prop, t);
  return upsertKeyframe(clip, prop, t, valueAt(clip, prop, t));
}

/**
 * Set a property value at local time `t`: animated properties get a keyframe
 * (auto-key), static ones change their base value.
 */
export function setAnimatedValue<C extends Clip>(clip: C, prop: AnimProp, t: number, v: number): C {
  if (hasKeyframes(clip, prop)) return upsertKeyframe(clip, prop, t, v);
  return { ...clip, transform: applyValue(clip.transform, prop, v) } as C;
}

export function setEasingAt<C extends Clip>(clip: C, t: number, easing: Easing): C {
  let c = clip;
  for (const p of ANIM_PROPS) {
    const list = c.keyframes?.[p];
    const i = keyframeIndexAt(list, t);
    if (list && i >= 0) {
      const next = [...list];
      next[i] = { ...next[i], ease: easing };
      c = withKeyframes(c, p, next);
    }
  }
  return c;
}

/** Sorted unique keyframe times across all properties. */
export function keyframeTimes(clip: Clip): number[] {
  const out: number[] = [];
  for (const p of ANIM_PROPS) for (const k of clip.keyframes?.[p] ?? []) if (!out.some((t) => Math.abs(t - k.t) < KF_EPS)) out.push(k.t);
  return out.sort((a, b) => a - b);
}

export function clearAnimation<C extends Clip>(clip: C): C {
  // Freeze each animated property at its value at t=0 of the clip.
  let tr = clip.transform;
  for (const p of ANIM_PROPS) {
    const list = clip.keyframes?.[p];
    if (list?.length) tr = applyValue(tr, p, list[0].v);
  }
  return { ...clip, transform: tr, keyframes: undefined } as C;
}

/** Shift all keyframes by `delta` seconds (used when trimming the clip start). */
export function shiftKeyframes(k: Keyframes | undefined, delta: number): Keyframes | undefined {
  if (!k) return k;
  const out: Keyframes = {};
  for (const p of ANIM_PROPS) {
    const list = k[p];
    if (list) out[p] = list.map((kf) => ({ ...kf, t: kf.t + delta }));
  }
  return out;
}

/** Split keyframes at local time `at`, inserting boundary keyframes so motion is preserved. */
export function splitKeyframes(k: Keyframes | undefined, at: number): [Keyframes | undefined, Keyframes | undefined] {
  if (!k) return [k, k];
  const left: Keyframes = {};
  const right: Keyframes = {};
  for (const p of ANIM_PROPS) {
    const list = k[p];
    if (!list?.length) continue;
    const v = evalKeyframes(list, at);
    const segEase = [...list].reverse().find((kf) => kf.t <= at)?.ease ?? 'linear';
    left[p] = [...list.filter((kf) => kf.t < at - KF_EPS), { t: at, v, ease: segEase }];
    right[p] = [{ t: 0, v, ease: segEase }, ...list.filter((kf) => kf.t > at + KF_EPS).map((kf) => ({ ...kf, t: kf.t - at }))];
  }
  return [left, right];
}

/** Move every keyframe at local time `from` to `to` (all properties together). A keyframe already at `to` is replaced. */
export function moveKeyframeTime<C extends Clip>(clip: C, from: number, to: number): C {
  if (Math.abs(from - to) < KF_EPS / 2) return clip;
  let c = clip;
  for (const p of ANIM_PROPS) {
    const list = c.keyframes?.[p];
    const i = keyframeIndexAt(list, from);
    if (!list || i < 0) continue;
    const moved = { ...list[i], t: to };
    const next = list.filter((k, j) => j !== i && Math.abs(k.t - to) >= KF_EPS);
    next.push(moved);
    next.sort((a, b) => a.t - b.t);
    c = withKeyframes(c, p, next);
  }
  return c;
}

/** Delete every keyframe at local time `t`. */
export function removeKeyframesAt<C extends Clip>(clip: C, t: number): C {
  let c = clip;
  for (const p of ANIM_PROPS) if (keyframeIndexAt(c.keyframes?.[p], t) >= 0) c = removeKeyframe(c, p, t);
  return c;
}
