/**
 * Clip motion: In / Out / Combo animations.
 *
 * Unlike keyframes, motions are stored as a recipe on the clip and evaluated
 * on top of its transform, so:
 *  - each clip has its own, independent animations;
 *  - In, Out and Combo never overwrite each other;
 *  - moving, scaling, trimming, splitting or changing speed never breaks them
 *    (In is anchored to the clip start, Out to its end, Combo spans the clip);
 *  - they compose with manual keyframes.
 *
 * A motion produces frame-space components (offset, scale and rotation around
 * an origin point inside the clip, opacity, blur) that the GPU preview and the
 * canvas/export compositor apply identically.
 */
import type { Clip, Motion, MotionSlot } from '../../types/project';

export type MotionKind = 'in' | 'out' | 'combo';

export interface MotionDef {
  id: string;
  name: string;
  kind: MotionKind;
  /** Uses the focus point (zoom/pan origin). */
  focus?: boolean;
}

export const MOTIONS: MotionDef[] = [
  { id: 'fade', name: 'Fade', kind: 'in' },
  { id: 'pop', name: 'Pop', kind: 'in' },
  { id: 'zoomIn', name: 'Zoom in', kind: 'in' },
  { id: 'zoomOut', name: 'Zoom out', kind: 'in' },
  { id: 'slideLeft', name: 'Slide ←', kind: 'in' },
  { id: 'slideRight', name: 'Slide →', kind: 'in' },
  { id: 'slideUp', name: 'Slide ↑', kind: 'in' },
  { id: 'slideDown', name: 'Slide ↓', kind: 'in' },
  { id: 'rise', name: 'Rise', kind: 'in' },
  { id: 'spin', name: 'Spin', kind: 'in' },
  { id: 'swing', name: 'Swing', kind: 'in' },
  { id: 'blur', name: 'Blur', kind: 'in' },
  { id: 'bounce', name: 'Bounce', kind: 'in' },

  { id: 'fade', name: 'Fade', kind: 'out' },
  { id: 'pop', name: 'Pop', kind: 'out' },
  { id: 'zoomIn', name: 'Zoom in', kind: 'out' },
  { id: 'zoomOut', name: 'Zoom out', kind: 'out' },
  { id: 'slideLeft', name: 'Slide ←', kind: 'out' },
  { id: 'slideRight', name: 'Slide →', kind: 'out' },
  { id: 'slideUp', name: 'Slide ↑', kind: 'out' },
  { id: 'slideDown', name: 'Slide ↓', kind: 'out' },
  { id: 'sink', name: 'Sink', kind: 'out' },
  { id: 'spin', name: 'Spin', kind: 'out' },
  { id: 'swing', name: 'Swing', kind: 'out' },
  { id: 'blur', name: 'Blur', kind: 'out' },

  { id: 'kenBurnsIn', name: 'Slow zoom in', kind: 'combo', focus: true },
  { id: 'kenBurnsOut', name: 'Slow zoom out', kind: 'combo', focus: true },
  { id: 'panLeft', name: 'Pan left', kind: 'combo', focus: true },
  { id: 'panRight', name: 'Pan right', kind: 'combo', focus: true },
  { id: 'panUp', name: 'Pan up', kind: 'combo', focus: true },
  { id: 'panDown', name: 'Pan down', kind: 'combo', focus: true },
  { id: 'punch', name: 'Zoom punch', kind: 'combo', focus: true },
  { id: 'pulse', name: 'Pulse', kind: 'combo', focus: true },
  { id: 'sway', name: 'Sway', kind: 'combo' },
  { id: 'shake', name: 'Shake', kind: 'combo' },
  { id: 'float', name: 'Float', kind: 'combo' },
];

export function motionDef(kind: MotionKind, id: string | undefined): MotionDef | undefined {
  return id ? MOTIONS.find((m) => m.kind === kind && m.id === id) : undefined;
}

export const DEFAULT_MOTION_DURATION = 0.5;
export const MIN_MOTION_DURATION = 0.1;

/** One frame-space transform step. Origin is a point in the clip box (0..1, 0..1). */
export interface MotionComponent {
  dx: number;
  dy: number;
  scale: number;
  /** Degrees. */
  rotate: number;
  ox: number;
  oy: number;
}

export interface MotionState {
  components: MotionComponent[];
  alpha: number;
  /** Extra blur in project pixels. */
  blur: number;
}

export const NO_MOTION: MotionState = { components: [], alpha: 1, blur: 0 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeIn = (x: number) => x * x * x;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Overshoot then settle. */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
const easeOutBounce = (x: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

/** Durations of In and Out, shrunk proportionally if together they exceed the clip. */
export function slotDurations(clip: Pick<Clip, 'duration' | 'motion'>): { din: number; dout: number } {
  const m = clip.motion;
  let din = m?.in ? Math.max(MIN_MOTION_DURATION, m.in.duration) : 0;
  let dout = m?.out ? Math.max(MIN_MOTION_DURATION, m.out.duration) : 0;
  const total = din + dout;
  if (total > clip.duration && total > 0) {
    const k = clip.duration / total;
    din *= k;
    dout *= k;
  }
  return { din, dout };
}

interface Partial1 {
  dx?: number;
  dy?: number;
  scale?: number;
  rotate?: number;
  alpha?: number;
  blur?: number;
}

/**
 * State of an entrance animation `id` at "hidden-ness" h (1 = fully before
 * the animation, 0 = settled). Out animations use the same table with h
 * running 0 → 1, so In and Out are exact mirrors.
 */
function enterExit(id: string, h: number, W: number, H: number, entering: boolean): Partial1 {
  const v = 1 - h; // visibility 0..1
  switch (id) {
    case 'fade':
      return { alpha: v };
    case 'pop': {
      // Entering overshoots; leaving shrinks smoothly.
      const s = entering ? 0.5 + 0.5 * easeOutBack(v) : 0.5 + 0.5 * v;
      return { scale: s, alpha: clamp01(v * 2) };
    }
    case 'zoomIn':
      return { scale: entering ? 0.3 + 0.7 * v : 1 + 0.7 * h, alpha: v };
    case 'zoomOut':
      return { scale: entering ? 1 + 0.7 * h : 0.3 + 0.7 * v, alpha: v };
    case 'slideLeft':
      // In: enters moving left (from the right). Out: leaves moving left.
      return { dx: (entering ? 1 : -1) * W * h };
    case 'slideRight':
      return { dx: (entering ? -1 : 1) * W * h };
    case 'slideUp':
      return { dy: (entering ? 1 : -1) * H * h };
    case 'slideDown':
      return { dy: (entering ? -1 : 1) * H * h };
    case 'rise':
      return { dy: H * 0.18 * h, alpha: v };
    case 'sink':
      return { dy: H * 0.18 * h, alpha: v };
    case 'spin':
      return { rotate: (entering ? -1 : 1) * 180 * h, scale: 0.3 + 0.7 * v, alpha: clamp01(v * 1.5) };
    case 'swing':
      return { rotate: (entering ? -1 : 1) * 25 * h, dx: (entering ? -1 : 1) * W * 0.08 * h, alpha: v };
    case 'blur':
      return { blur: 40 * h, alpha: clamp01(v * 1.4), scale: 1 + 0.08 * h };
    case 'bounce':
      return { dy: -H * 0.6 * h };
    default:
      return {};
  }
}

function comboAt(id: string, p: number, lt: number, W: number, H: number, amount: number): Partial1 {
  const a = amount;
  switch (id) {
    case 'kenBurnsIn':
      return { scale: 1 + 0.18 * a * easeInOut(p) };
    case 'kenBurnsOut':
      return { scale: 1 + 0.18 * a * (1 - easeInOut(p)) };
    case 'panLeft':
      return { scale: 1 + 0.15 * a, dx: W * 0.06 * a * (1 - 2 * easeInOut(p)) };
    case 'panRight':
      return { scale: 1 + 0.15 * a, dx: -W * 0.06 * a * (1 - 2 * easeInOut(p)) };
    case 'panUp':
      return { scale: 1 + 0.15 * a, dy: H * 0.06 * a * (1 - 2 * easeInOut(p)) };
    case 'panDown':
      return { scale: 1 + 0.15 * a, dy: -H * 0.06 * a * (1 - 2 * easeInOut(p)) };
    case 'punch': {
      // Quick zoom on the focus point at the start, then hold.
      const q = clamp01(p / 0.25);
      return { scale: 1 + 0.35 * a * easeOutBack(q) };
    }
    case 'pulse':
      return { scale: 1 + 0.05 * a * (0.5 - 0.5 * Math.cos(lt * Math.PI * 2 * 1.2)) };
    case 'sway':
      return { rotate: 3 * a * Math.sin(lt * Math.PI * 0.9), scale: 1 + 0.08 * a };
    case 'shake': {
      // Deterministic pseudo-random shake (same in preview and export).
      const f = lt * 24;
      const nx = Math.sin(f * 1.7) * 0.6 + Math.sin(f * 3.1 + 1.3) * 0.4;
      const ny = Math.sin(f * 2.3 + 0.7) * 0.6 + Math.sin(f * 4.3 + 2.1) * 0.4;
      return { dx: nx * W * 0.008 * a, dy: ny * H * 0.008 * a, scale: 1 + 0.03 * a, rotate: Math.sin(f * 1.1) * 0.6 * a };
    }
    case 'float':
      return { dy: Math.sin(lt * Math.PI * 0.8) * H * 0.015 * a, rotate: Math.sin(lt * Math.PI * 0.5) * 1.2 * a };
    default:
      return {};
  }
}

function push(state: MotionState, part: Partial1, ox: number, oy: number): void {
  const dx = part.dx ?? 0;
  const dy = part.dy ?? 0;
  const scale = part.scale ?? 1;
  const rotate = part.rotate ?? 0;
  if (dx || dy || scale !== 1 || rotate) state.components.push({ dx, dy, scale, rotate, ox, oy });
  if (part.alpha !== undefined) state.alpha *= clamp01(part.alpha);
  if (part.blur) state.blur += part.blur;
}

/** Motion state of `clip` at clip-local time `lt` in a W×H frame. */
export function motionAt(clip: Pick<Clip, 'duration' | 'motion'>, lt: number, W: number, H: number): MotionState {
  const m = clip.motion;
  if (!m || (!m.in && !m.out && !m.combo)) return NO_MOTION;
  const state: MotionState = { components: [], alpha: 1, blur: 0 };
  const t = Math.min(Math.max(lt, 0), clip.duration);
  if (m.combo) {
    const p = clip.duration > 0 ? t / clip.duration : 0;
    push(state, comboAt(m.combo.id, p, t, W, H, m.combo.amount ?? 1), m.combo.focusX ?? 0.5, m.combo.focusY ?? 0.5);
  }
  const { din, dout } = slotDurations(clip);
  if (m.in && din > 0 && t < din) {
    const x = t / din;
    const e = m.in.id === 'bounce' ? easeOutBounce(x) : m.in.id === 'pop' ? x : easeOut(x);
    push(state, enterExit(m.in.id, 1 - e, W, H, true), 0.5, 0.5);
  }
  if (m.out && dout > 0 && t > clip.duration - dout) {
    const x = (t - (clip.duration - dout)) / dout;
    push(state, enterExit(m.out.id, easeIn(x), W, H, false), 0.5, 0.5);
  }
  return state;
}

export function hasMotion(clip: Pick<Clip, 'motion'>): boolean {
  const m = clip.motion;
  return !!(m && (m.in || m.out || m.combo));
}

/** Set or clear one motion slot. */
export function setMotion<C extends Clip>(clip: C, kind: MotionKind, slot: MotionSlot | null): C {
  const motion: Motion = { ...(clip.motion ?? {}) };
  if (slot) motion[kind] = slot;
  else delete motion[kind];
  return { ...clip, motion: motion.in || motion.out || motion.combo ? motion : undefined };
}

/** Split motion between the two halves of a split clip. */
export function splitMotion(m: Motion | undefined): [Motion | undefined, Motion | undefined] {
  if (!m) return [m, m];
  const left: Motion = {};
  const right: Motion = {};
  if (m.in) left.in = m.in;
  if (m.out) right.out = m.out;
  if (m.combo) {
    left.combo = m.combo;
    right.combo = m.combo;
  }
  return [left.in || left.combo ? left : undefined, right.out || right.combo ? right : undefined];
}

/** Validate untrusted motion data (project files, presets). */
export function cleanMotion(v: unknown): Motion | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: Motion = {};
  for (const kind of ['in', 'out', 'combo'] as const) {
    const s = o[kind] as Record<string, unknown> | undefined;
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !motionDef(kind, s.id)) continue;
    const num = (x: unknown, d: number, lo: number, hi: number) => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
    const slot: MotionSlot = { id: s.id, duration: num(s.duration, DEFAULT_MOTION_DURATION, MIN_MOTION_DURATION, 30) };
    if (s.amount !== undefined) slot.amount = num(s.amount, 1, 0, 3);
    if (s.focusX !== undefined) slot.focusX = num(s.focusX, 0.5, 0, 1);
    if (s.focusY !== undefined) slot.focusY = num(s.focusY, 0.5, 0, 1);
    out[kind] = slot;
  }
  return out.in || out.out || out.combo ? out : undefined;
}
