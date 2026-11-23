import { describe, expect, it } from 'vitest';
import { parseBundle, sanitizePreset, toBundle } from './presets';

describe('preset sanitizing', () => {
  it('clamps values and drops unknown fields', () => {
    const p = sanitizePreset({ kind: 'effects', name: 'x', data: { brightness: 9999, contrast: 'evil', hue: -500, extra: '<script>' } })!;
    expect(p.data).toEqual({ brightness: 200, contrast: 100, saturation: 100, blur: 0, hue: -180, sepia: 0, grayscale: 0, vignette: 0 });
  });
  it('rejects unknown kinds and malformed bundles', () => {
    expect(sanitizePreset({ kind: 'code', data: {} })).toBeNull();
    expect(() => parseBundle('{"app":"other"}')).toThrow();
    expect(() => parseBundle('not json')).toThrow();
  });
  it('round-trips a bundle', () => {
    const p = sanitizePreset({ kind: 'transition', name: 'Quick wipe', data: { type: 'wipe', duration: 0.3, direction: 'up', easing: 'easeOut' } })!;
    const back = parseBundle(JSON.stringify(toBundle([p])));
    expect(back[0].name).toBe('Quick wipe');
    expect(back[0].data).toEqual(p.data);
  });
  it('sanitizes font family and colors in text styles', () => {
    const p = sanitizePreset({ kind: 'textStyle', name: 't', data: { fontFamily: 'Cairo"; x', color: 'red', fontWeight: 900 } })!;
    expect((p.data as { fontFamily: string }).fontFamily).toBe('Cairo x');
    expect((p.data as { color: string }).color).toBe('#F2F4F5');
    expect((p.data as { fontWeight: number }).fontWeight).toBe(800);
  });
});
