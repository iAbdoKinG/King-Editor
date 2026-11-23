/**
 * Quick animation presets. Each produces keyframes relative to the clip so
 * the result remains fully editable afterwards.
 */
import type { AnimProp, Clip, Easing, Keyframe } from '../../types/project';

export interface AnimPreset {
  id: string;
  name: string;
  group: 'in' | 'out' | 'whole';
}

export const ANIM_PRESETS: AnimPreset[] = [
  { id: 'fadeIn', name: 'Fade in', group: 'in' },
  { id: 'popIn', name: 'Pop in', group: 'in' },
  { id: 'slideInLeft', name: 'Slide in ←', group: 'in' },
  { id: 'slideInUp', name: 'Rise in ↑', group: 'in' },
  { id: 'spinIn', name: 'Spin in', group: 'in' },
  { id: 'fadeOut', name: 'Fade out', group: 'out' },
  { id: 'popOut', name: 'Pop out', group: 'out' },
  { id: 'slideOutRight', name: 'Slide out →', group: 'out' },
  { id: 'kenBurnsIn', name: 'Slow zoom in', group: 'whole' },
  { id: 'kenBurnsOut', name: 'Slow zoom out', group: 'whole' },
  { id: 'panLeft', name: 'Pan left', group: 'whole' },
  { id: 'panRight', name: 'Pan right', group: 'whole' },
];

const kf = (t: number, v: number, ease: Easing = 'linear'): Keyframe => ({ t, v, ease });

/** Apply a preset to a clip in a frame of width W/height H. Replaces keyframes of the props it animates. */
export function applyAnimPreset<C extends Clip>(clip: C, id: string, W: number, H: number): C {
  const d = clip.duration;
  const tr = clip.transform;
  const inD = Math.min(0.6, d / 2);
  const end = d;
  const s = tr.scaleX;
  const set: Partial<Record<AnimProp, Keyframe[]>> = {};
  const op = tr.opacity;
  switch (id) {
    case 'fadeIn':
      set.opacity = [kf(0, 0, 'easeOut'), kf(inD, op)];
      break;
    case 'fadeOut':
      set.opacity = [kf(end - inD, op, 'easeIn'), kf(end, 0)];
      break;
    case 'popIn':
      set.scale = [kf(0, s * 0.6, 'easeOut'), kf(inD * 0.7, s * 1.06, 'easeInOut'), kf(inD, s)];
      set.opacity = [kf(0, 0, 'easeOut'), kf(inD * 0.5, op)];
      break;
    case 'popOut':
      set.scale = [kf(end - inD, s, 'easeIn'), kf(end, s * 0.6)];
      set.opacity = [kf(end - inD * 0.5, op, 'easeIn'), kf(end, 0)];
      break;
    case 'slideInLeft':
      set.x = [kf(0, tr.x - W, 'easeOut'), kf(inD, tr.x)];
      break;
    case 'slideInUp':
      set.y = [kf(0, tr.y + H * 0.25, 'easeOut'), kf(inD, tr.y)];
      set.opacity = [kf(0, 0, 'easeOut'), kf(inD, op)];
      break;
    case 'slideOutRight':
      set.x = [kf(end - inD, tr.x, 'easeIn'), kf(end, tr.x + W)];
      break;
    case 'spinIn':
      set.rotation = [kf(0, tr.rotation - 120, 'easeOut'), kf(inD, tr.rotation)];
      set.scale = [kf(0, s * 0.3, 'easeOut'), kf(inD, s)];
      break;
    case 'kenBurnsIn':
      set.scale = [kf(0, s, 'easeInOut'), kf(end, s * 1.15)];
      break;
    case 'kenBurnsOut':
      set.scale = [kf(0, s * 1.15, 'easeInOut'), kf(end, s)];
      break;
    case 'panLeft':
      set.scale = [kf(0, s * 1.12), kf(end, s * 1.12)];
      set.x = [kf(0, tr.x + W * 0.05, 'easeInOut'), kf(end, tr.x - W * 0.05)];
      break;
    case 'panRight':
      set.scale = [kf(0, s * 1.12), kf(end, s * 1.12)];
      set.x = [kf(0, tr.x - W * 0.05, 'easeInOut'), kf(end, tr.x + W * 0.05)];
      break;
    default:
      return clip;
  }
  return { ...clip, keyframes: { ...(clip.keyframes ?? {}), ...set } };
}
