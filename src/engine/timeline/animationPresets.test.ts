import { describe, expect, it } from 'vitest';
import type { MediaAsset } from '../../types/project';
import { ANIM_PRESETS, applyAnimPreset } from './animationPresets';
import { valueAt } from './animation';
import { createMediaClip } from './model';

const a: MediaAsset = { id: 'a', kind: 'video', name: 'v', size: 1, mime: '', url: '', duration: 10, width: 1920, height: 1080, status: 'ready' };

describe('animation presets', () => {
  it('every preset produces keyframes inside the clip', () => {
    for (const p of ANIM_PRESETS) {
      const c = applyAnimPreset(createMediaClip(a, 't', 0), p.id, 1920, 1080);
      const all = Object.values(c.keyframes ?? {}).flat();
      expect(all.length, p.id).toBeGreaterThan(0);
      for (const k of all) {
        expect(k!.t).toBeGreaterThanOrEqual(0);
        expect(k!.t).toBeLessThanOrEqual(c.duration + 1e-9);
      }
    }
  });
  it('fade in ends at the clip opacity and keeps the rest static', () => {
    const c = applyAnimPreset(createMediaClip(a, 't', 0), 'fadeIn', 1920, 1080);
    expect(valueAt(c, 'opacity', 0)).toBe(0);
    expect(valueAt(c, 'opacity', 5)).toBe(1);
    expect(c.keyframes?.x).toBeUndefined();
  });
});
