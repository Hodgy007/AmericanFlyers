import { describe, expect, it } from 'vitest';
import { hz, THEME_BARS, THEME_FORM } from '../../src/music';

describe('the theme tune', () => {
  it('runs 28 bars, in four-bar sections from the intro to the close', () => {
    expect(THEME_BARS).toBe(28);
    expect(THEME_FORM.map((s) => s.bar)).toEqual([0, 4, 12, 20, 24]);
    expect(THEME_FORM.map((s) => s.section)).toEqual(['intro', 'verse', 'chorus', 'turnaround', 'close']);
    for (const { bar } of THEME_FORM) expect(bar % 4).toBe(0);
  });

  it('tunes A4 and transposes around it', () => {
    expect(hz(69)).toBeCloseTo(440, 6);
    expect(hz(57)).toBeCloseTo(220, 6);
    expect(hz(81)).toBeCloseTo(880, 6);
  });
});