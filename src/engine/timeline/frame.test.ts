import { describe, expect, it } from 'vitest';
import { clampDimension, defaultSettings, exportSize, frameSize, withAspect } from './model';

describe('frame size', () => {
  it('presets keep their ratio, including 2K', () => {
    expect(frameSize({ aspect: '16:9', resolution: 1080 })).toEqual({ width: 1920, height: 1080 });
    expect(frameSize({ aspect: '9:16', resolution: 1440 })).toEqual({ width: 1440, height: 2560 });
  });
  it('custom size uses width and height independently', () => {
    expect(frameSize({ aspect: 'custom', resolution: 1080, customWidth: 1080, customHeight: 1350 })).toEqual({ width: 1080, height: 1350 });
    expect(frameSize({ aspect: 'custom', resolution: 1080, customWidth: 777, customHeight: 300 })).toEqual({ width: 778, height: 300 });
  });
  it('custom dimensions are clamped to 128..2560 and even', () => {
    expect(clampDimension(5000)).toBe(2560);
    expect(clampDimension(10)).toBe(128);
    expect(clampDimension(1001)).toBe(1002);
    expect(clampDimension(NaN)).toBe(1080);
  });
  it('switching to custom starts from the current frame', () => {
    const s = withAspect({ ...defaultSettings(), aspect: '4:5', resolution: 1080 }, 'custom');
    expect(s.customWidth).toBe(1080);
    expect(s.customHeight).toBe(1350);
  });
  it('exports never exceed 2K', () => {
    expect(exportSize({ aspect: '16:9', resolution: 1080 }, 1440)).toEqual({ width: 2560, height: 1440 });
    expect(exportSize({ aspect: '16:9', resolution: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
    // very wide custom frame: long edge capped at 2560
    expect(exportSize({ aspect: 'custom', resolution: 1080, customWidth: 2560, customHeight: 640 }, 1440)).toEqual({ width: 2560, height: 640 });
    // tall custom frame scaled to a 1080 short edge
    expect(exportSize({ aspect: 'custom', resolution: 1080, customWidth: 1000, customHeight: 2000 }, 1080)).toEqual({ width: 1080, height: 2160 });
  });
});
