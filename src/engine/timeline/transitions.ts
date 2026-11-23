/**
 * Transitions and layer evaluation. A transition belongs to the incoming clip
 * and is centred on the cut with the previous adjacent clip on the same
 * track. During the transition window both clips are active; this module
 * says how each one is mixed (alpha, offset, scale, audio level).
 *
 * The compositor, the media pool (audio crossfades) and the exporter all use
 * these functions, so preview and export always match.
 */
import type { Clip, Direction, Project, Transition, TransitionType } from '../../types/project';
import { ease } from './animation';
import { clipEnd, clipsOnTrack } from './model';

const EPS = 1e-4;

export const TRANSITION_TYPES: Array<{ value: TransitionType; label: string; directional?: boolean }> = [
  { value: 'dissolve', label: 'Cross Dissolve' },
  { value: 'fade', label: 'Fade through color' },
  { value: 'flash', label: 'Flash' },
  { value: 'blur', label: 'Blur Dissolve' },
  { value: 'slide', label: 'Push', directional: true },
  { value: 'cover', label: 'Cover', directional: true },
  { value: 'wipe', label: 'Wipe', directional: true },
  { value: 'iris', label: 'Iris' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'spin', label: 'Spin' },
];

export function defaultTransition(): Transition {
  return { type: 'dissolve', duration: 0.5, direction: 'left', easing: 'easeInOut' };
}

/** Clip region in frame space: inset fractions, or a centred circle (radius as fraction of the half-diagonal). */
export type MixClip = { kind: 'inset'; top: number; right: number; bottom: number; left: number } | { kind: 'circle'; r: number };

export interface Mix {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  /** Rotation in degrees around the frame centre. */
  rotate: number;
  /** Extra blur in project pixels. */
  blur: number;
  /** Brightness multiplier (1 = unchanged). */
  brightness: number;
  clip: MixClip | null;
  audio: number;
}

export const IDENTITY_MIX: Mix = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, brightness: 1, clip: null, audio: 1 };

export function prevAdjacent(project: Project, clip: Clip): Clip | null {
  for (const c of clipsOnTrack(project, clip.trackId, clip.id)) if (Math.abs(clipEnd(c) - clip.start) < EPS) return c;
  return null;
}

export function nextAdjacent(project: Project, clip: Clip): Clip | null {
  const end = clipEnd(clip);
  for (const c of clipsOnTrack(project, clip.trackId, clip.id)) if (Math.abs(c.start - end) < EPS) return c;
  return null;
}

/** Longest transition allowed between two clips (half on each side of the cut). */
export function maxTransitionDuration(prev: Clip, clip: Clip): number {
  return Math.max(0, 2 * Math.min(prev.duration, clip.duration) - 1e-3);
}

/** The transition into `clip` if it is currently effective (clip abuts a previous one), with clamped duration. */
export function effectiveTransition(project: Project, clip: Clip): { tr: Transition; prev: Clip; d: number } | null {
  const tr = clip.transitionIn;
  if (!tr || tr.duration <= 0) return null;
  const track = project.tracks.find((t) => t.id === clip.trackId);
  if (!track || track.kind === 'audio') return null;
  const prev = prevAdjacent(project, clip);
  if (!prev) return null;
  const d = Math.min(tr.duration, maxTransitionDuration(prev, clip));
  return d > 0 ? { tr, prev, d } : null;
}

/** Timeline range during which the clip produces output, including transition overlaps. */
export function clipRange(project: Project, clip: Clip): [number, number] {
  let s = clip.start;
  let e = clipEnd(clip);
  const tin = effectiveTransition(project, clip);
  if (tin) s -= tin.d / 2;
  const next = nextAdjacent(project, clip);
  if (next) {
    const tout = effectiveTransition(project, next);
    if (tout) e += tout.d / 2;
  }
  return [s, e];
}

function dirVec(d: Direction): [number, number] {
  return d === 'left' ? [-1, 0] : d === 'right' ? [1, 0] : d === 'up' ? [0, -1] : [0, 1];
}

/** Mixes for the outgoing and incoming clip at eased progress `p`. */
export function transitionMix(tr: Transition, rawP: number, W: number, H: number): { out: Mix; in: Mix } {
  const p = ease(tr.easing, rawP);
  switch (tr.type) {
    case 'fade':
      return {
        out: { ...IDENTITY_MIX, alpha: Math.max(0, 1 - 2 * p), audio: 1 - p },
        in: { ...IDENTITY_MIX, alpha: Math.max(0, 2 * p - 1), audio: p },
      };
    case 'slide': {
      // Push: the incoming clip slides in along `direction`, pushing the outgoing one out.
      const [vx, vy] = dirVec(tr.direction);
      return {
        out: { ...IDENTITY_MIX, dx: vx * p * W, dy: vy * p * H, audio: 1 - p },
        in: { ...IDENTITY_MIX, dx: -vx * (1 - p) * W, dy: -vy * (1 - p) * H, audio: p },
      };
    }
    case 'cover': {
      const [vx, vy] = dirVec(tr.direction);
      return {
        out: { ...IDENTITY_MIX, audio: 1 - p },
        in: { ...IDENTITY_MIX, dx: -vx * (1 - p) * W, dy: -vy * (1 - p) * H, audio: p },
      };
    }
    case 'wipe': {
      const q = 1 - p;
      const c = tr.direction;
      return {
        out: { ...IDENTITY_MIX, audio: 1 - p },
        in: {
          ...IDENTITY_MIX,
          audio: p,
          clip: { kind: 'inset', left: c === 'left' ? q : 0, right: c === 'right' ? q : 0, top: c === 'up' ? q : 0, bottom: c === 'down' ? q : 0 },
        },
      };
    }
    case 'iris':
      return { out: { ...IDENTITY_MIX, audio: 1 - p }, in: { ...IDENTITY_MIX, audio: p, clip: { kind: 'circle', r: p } } };
    case 'flash': {
      const first = p < 0.5;
      return {
        out: { ...IDENTITY_MIX, alpha: first ? 1 : 0, brightness: first ? 1 + 5 * (2 * p) : 1, audio: 1 - p },
        in: { ...IDENTITY_MIX, alpha: first ? 0 : 1, brightness: first ? 1 : 1 + 5 * (2 - 2 * p), audio: p },
      };
    }
    case 'blur':
      return {
        out: { ...IDENTITY_MIX, blur: 28 * p, audio: 1 - p },
        in: { ...IDENTITY_MIX, alpha: p, blur: 28 * (1 - p), audio: p },
      };
    case 'spin':
      return {
        out: { ...IDENTITY_MIX, rotate: 180 * p, scale: 1 - 0.6 * p, alpha: 1 - p, audio: 1 - p },
        in: { ...IDENTITY_MIX, rotate: -180 * (1 - p), scale: 0.4 + 0.6 * p, alpha: p, audio: p },
      };
    case 'zoom':
      return {
        out: { ...IDENTITY_MIX, scale: 1 + 0.3 * p, alpha: 1, audio: 1 - p },
        in: { ...IDENTITY_MIX, scale: 1.3 - 0.3 * p, alpha: p, audio: p },
      };
    case 'dissolve':
    default:
      return { out: { ...IDENTITY_MIX, audio: 1 - p }, in: { ...IDENTITY_MIX, alpha: p, audio: p } };
  }
}

export interface Layer {
  clip: Clip;
  mix: Mix;
}

/** Layers produced by one track at time `t` (bottom first). */
export function trackLayersAt(project: Project, trackId: string, t: number, W: number, H: number): Layer[] {
  const clips = clipsOnTrack(project, trackId);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const tin = effectiveTransition(project, c);
    if (tin) {
      const w0 = c.start - tin.d / 2;
      if (t >= w0 && t < c.start + tin.d / 2) {
        const m = transitionMix(tin.tr, (t - w0) / tin.d, W, H);
        return [
          { clip: tin.prev, mix: m.out },
          { clip: c, mix: m.in },
        ];
      }
    }
  }
  for (const c of clips) if (t >= c.start && t < clipEnd(c)) return [{ clip: c, mix: IDENTITY_MIX }];
  return [];
}

/** Mix for every clip that is audible/visible at `t`, keyed by clip id. */
export function allMixesAt(project: Project, t: number, W: number, H: number): Map<string, Mix> {
  const out = new Map<string, Mix>();
  for (const tr of project.tracks) for (const l of trackLayersAt(project, tr.id, t, W, H)) out.set(l.clip.id, l.mix);
  return out;
}
