import { describe, expect, it } from 'vitest';
import { isRtl } from './text';

describe('isRtl', () => {
  it('detects by first strong character', () => {
    expect(isRtl('مرحبا')).toBe(true);
    expect(isRtl('123 مرحبا hello')).toBe(true);
    expect(isRtl('hello مرحبا')).toBe(false);
    expect(isRtl('123')).toBe(false);
  });
});
