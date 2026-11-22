import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '../../types/project';
import {
  ease,
  evalKeyframes,
  keyframeTimes,
  removeKeyframe,
  resolveTransform,
  setAnimatedValue,
  splitKeyframes,
  toggleKeyframe,
  upsertKeyframe,
  valueAt,
} from './animation';
import { createMediaClip, createProject } from './model';
import { insertClip, splitClip, trimClip } from './ops';
import { clipRange, defaultTransition, trackLayersAt } from './transitions';

const video: MediaAsset = {
  id: 'a1', kind: 'video', name: 'v', size: 1, mime: 'video/mp4', url: 'blob:x',
  duration: 20, width: 1920, height: 1080, status: 'ready',
};

describe('easing', () => {
  it('maps endpoints and is monotonic', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(e, 0)).toBe(0);
      expect(ease(e, 1)).toBe(1);
      expect(ease(e, 0.6)).toBeGreaterThan(ease(e, 0.4));
    }
    expect(ease('easeIn', 0.5)).toBeLessThan(0.5);
    expect(ease('easeOut', 0.5)).toBeGreaterThan(0.5);
  });
});

describe('keyframes', () => {
  const base = createMediaClip(video, 't', 0);

  it('interpolates and holds outside range', () => {
    const kfs = [
      { t: 1, v: 0, ease: 'linear' as const },
      { t: 3, v: 100, ease: 'linear' as const },
    ];
    expect(evalKeyframes(kfs, 0)).toBe(0);
    expect(evalKeyframes(kfs, 2)).toBe(50);
    expect(evalKeyframes(kfs, 9)).toBe(100);
  });

  it('auto-keys animated props and edits static ones', () => {
    let c = setAnimatedValue(base, 'x', 1, 50);
    expect(c.transform.x).toBe(50);
    expect(c.keyframes?.x).toBeUndefined();
    c = toggleKeyframe(c, 'x', 0); // keyframe at 0 holding 50
    c = setAnimatedValue(c, 'x', 2, 250); // auto-key
    expect(c.keyframes?.x?.length).toBe(2);
    expect(valueAt(c, 'x', 1)).toBeCloseTo(150);
    expect(resolveTransform(c, 1).x).toBeCloseTo(150);
    c = removeKeyframe(c, 'x', 2);
    c = removeKeyframe(c, 'x', 0);
    expect(c.keyframes?.x).toBeUndefined();
    expect(c.transform.x).toBe(50);
  });

  it('scale keyframes preserve the X/Y ratio', () => {
    let c = { ...base, transform: { ...base.transform, scaleX: 1, scaleY: 2 } };
    c = upsertKeyframe(c, 'scale', 0, 2);
    const tr = resolveTransform(c, 0);
    expect(tr.scaleX).toBe(2);
    expect(tr.scaleY).toBe(4);
  });

  it('splitting preserves motion on both halves', () => {
    const k = { x: [{ t: 0, v: 0, ease: 'linear' as const }, { t: 4, v: 400, ease: 'linear' as const }] };
    const [l, r] = splitKeyframes(k, 1);
    expect(evalKeyframes(l!.x!, 1)).toBeCloseTo(100);
    expect(evalKeyframes(r!.x!, 0)).toBeCloseTo(100);
    expect(evalKeyframes(r!.x!, 3)).toBeCloseTo(400);
  });

  it('splitClip and trim keep keyframes anchored to content', () => {
    let p = createProject();
    const tid = p.tracks[0].id;
    let c = createMediaClip(video, tid, 0);
    c = upsertKeyframe(upsertKeyframe(c, 'opacity', 0, 0), 'opacity', 4, 1);
    p = insertClip(p, c);
    const [p2, rid] = splitClip(p, c.id, 2);
    expect(valueAt(p2.clips[rid!], 'opacity', 0)).toBeCloseTo(0.5);
    const p3 = trimClip(p, { a1: video }, c.id, 'start', 1);
    expect(valueAt(p3.clips[c.id], 'opacity', 0)).toBeCloseTo(0.25);
    expect(keyframeTimes(p3.clips[c.id])).toEqual([-1, 3]);
  });
});

describe('transitions', () => {
  it('overlaps adjacent clips around the cut', () => {
    let p = createProject();
    const tid = p.tracks[0].id;
    const a = { ...createMediaClip(video, tid, 0), duration: 4 };
    const b = { ...createMediaClip(video, tid, 4), duration: 4, transitionIn: { ...defaultTransition(), duration: 1, easing: 'linear' as const } };
    p = insertClip(insertClip(p, a), b);
    expect(clipRange(p, p.clips[a.id])).toEqual([0, 4.5]);
    expect(clipRange(p, p.clips[b.id])).toEqual([3.5, 8]);
    const mid = trackLayersAt(p, tid, 4, 1920, 1080);
    expect(mid.map((l) => l.clip.id)).toEqual([a.id, b.id]);
    expect(mid[1].mix.alpha).toBeCloseTo(0.5);
    expect(trackLayersAt(p, tid, 3, 1920, 1080).length).toBe(1);
    // Not adjacent → no transition
    const moved = { ...p, clips: { ...p.clips, [b.id]: { ...p.clips[b.id], start: 5 } } };
    expect(trackLayersAt(moved, tid, 4.9, 1920, 1080).length).toBe(0);
  });
});
