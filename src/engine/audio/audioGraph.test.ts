import { describe, expect, it } from 'vitest';
import { fadeEnvelope } from './audioGraph';

describe('fadeEnvelope', () => {
  it('ramps in and out linearly', () => {
    expect(fadeEnvelope(0, 10, 2, 2)).toBe(0);
    expect(fadeEnvelope(1, 10, 2, 2)).toBeCloseTo(0.5);
    expect(fadeEnvelope(5, 10, 2, 2)).toBe(1);
    expect(fadeEnvelope(9, 10, 2, 2)).toBeCloseTo(0.5);
    expect(fadeEnvelope(5, 10, 0, 0)).toBe(1);
  });
});
