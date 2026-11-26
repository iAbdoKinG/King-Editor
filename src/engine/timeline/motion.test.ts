import { describe, expect, it } from 'vitest';
import { cleanMotion, motionAt, setMotion, slotDurations, splitMotion } from './motion';
import { layerTransform, type ClipBox } from '../rendering/geometry';
import type { Clip } from '../../types/project';

const clip = (duration: number, motion?: Clip['motion']) => ({ duration, motion });
const W = 1920;
const H = 1080;

describe('motion', () => {
  it('In, Out and Combo coexist and never overwrite each other', () => {
    let c = { id: 'c', duration: 4 } as unknown as Clip;
    c = setMotion(c, 'in', { id: 'fade', duration: 0.5 });
    c = setMotion(c, 'out', { id: 'pop', duration: 0.5 });
    c = setMotion(c, 'combo', { id: 'kenBurnsIn', duration: 4 });
    expect(c.motion?.in?.id).toBe('fade');
    expect(c.motion?.out?.id).toBe('pop');
    expect(c.motion?.combo?.id).toBe('kenBurnsIn');
    expect(motionAt(c, 0, W, H).alpha).toBeCloseTo(0);
    expect(motionAt(c, 2, W, H).alpha).toBeCloseTo(1);
    expect(motionAt(c, 4, W, H).alpha).toBeLessThan(0.05);
    c = setMotion(c, 'in', null);
    expect(c.motion?.in).toBeUndefined();
    expect(c.motion?.out?.id).toBe('pop');
  });

  it('settles to identity between In and Out (plus Combo only)', () => {
    const s = motionAt(clip(3, { in: { id: 'slideLeft', duration: 0.5 }, out: { id: 'slideRight', duration: 0.5 } }), 1.5, W, H);
    expect(s.components).toHaveLength(0);
    expect(s.alpha).toBe(1);
  });

  it('In is anchored to the clip start and Out to the clip end, whatever the duration', () => {
    for (const d of [1, 5, 30]) {
      const m = { in: { id: 'slideLeft', duration: 0.5 }, out: { id: 'fade', duration: 0.5 } };
      expect(motionAt(clip(d, m), 0, W, H).components[0].dx).toBeCloseTo(W);
      expect(motionAt(clip(d, m), d, W, H).alpha).toBeCloseTo(0);
      expect(motionAt(clip(d, m), d - 0.6, W, H).alpha).toBe(1);
    }
  });

  it('shrinks In/Out proportionally on short clips', () => {
    const d = slotDurations(clip(1, { in: { id: 'fade', duration: 1 }, out: { id: 'fade', duration: 1 } }));
    expect(d.din + d.dout).toBeCloseTo(1);
    expect(d.din).toBeCloseTo(0.5);
  });

  it('splits In to the left half and Out to the right, Combo to both', () => {
    const [l, r] = splitMotion({ in: { id: 'fade', duration: 1 }, out: { id: 'pop', duration: 1 }, combo: { id: 'pulse', duration: 1 } });
    expect(l?.in && !l.out && l.combo).toBeTruthy();
    expect(r?.out && !r.in && r.combo).toBeTruthy();
  });

  it('combo zoom keeps the focus point fixed on screen', () => {
    const box: ClipBox = { cx: 960, cy: 540, w: 1920, h: 1080, ax: 0.5, ay: 0.5, sx: 1, sy: 1, rot: 0 };
    const s = motionAt(clip(2, { combo: { id: 'kenBurnsIn', duration: 2, focusX: 0.25, focusY: 0.25 } }), 2, W, H);
    const m = layerTransform(1, W, H, { dx: 0, dy: 0, rotate: 0, scale: 1 }, s.components, box, true);
    // Box-local point at the focus (25%, 25%) maps to itself.
    const fx = 0.25 * 1920;
    const fy = 0.25 * 1080;
    expect(m[0] * fx + m[2] * fy + m[4]).toBeCloseTo(fx, 3);
    expect(m[1] * fx + m[3] * fy + m[5]).toBeCloseTo(fy, 3);
    expect(m[0]).toBeGreaterThan(1.1);
  });

  it('matches the previous transition/clip matrix when there is no motion', () => {
    const box: ClipBox = { cx: 700, cy: 300, w: 400, h: 200, ax: 0.5, ay: 0.5, sx: 1.5, sy: 1.5, rot: 0.3 };
    const mix = { dx: 50, dy: -20, rotate: 10, scale: 0.8 };
    const m = layerTransform(0.5, W, H, mix, [], box, true);
    const d = new (class {
      // Reference: same steps as the old DOMMatrix code, done by hand on a point.
      apply(x: number, y: number) {
        x -= box.w * box.ax;
        y -= box.h * box.ay;
        x *= box.sx;
        y *= box.sy;
        [x, y] = [x * Math.cos(box.rot) - y * Math.sin(box.rot), x * Math.sin(box.rot) + y * Math.cos(box.rot)];
        x += -W / 2 + box.cx;
        y += -H / 2 + box.cy;
        x *= mix.scale;
        y *= mix.scale;
        const r = (mix.rotate * Math.PI) / 180;
        [x, y] = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
        return [(x + W / 2 + mix.dx) * 0.5, (y + H / 2 + mix.dy) * 0.5];
      }
    })();
    for (const [x, y] of [[0, 0], [400, 0], [123, 177]]) {
      const [ex, ey] = d.apply(x, y);
      expect(m[0] * x + m[2] * y + m[4]).toBeCloseTo(ex, 6);
      expect(m[1] * x + m[3] * y + m[5]).toBeCloseTo(ey, 6);
    }
  });

  it('cleans untrusted motion data', () => {
    expect(cleanMotion({ in: { id: 'nope', duration: 1 } })).toBeUndefined();
    expect(cleanMotion({ in: { id: 'fade', duration: -5 } })?.in?.duration).toBe(0.1);
    expect(cleanMotion({ combo: { id: 'pulse', duration: 1, focusX: 9 } })?.combo?.focusX).toBe(1);
    expect(cleanMotion('x')).toBeUndefined();
  });
});
