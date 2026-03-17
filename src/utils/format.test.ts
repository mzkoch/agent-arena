import { describe, expect, it } from 'vitest';
import { formatElapsed } from './format';

describe('formatElapsed', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatElapsed(9_000)).toBe('9s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(3_780_000)).toBe('1h 03m');
  });
});
