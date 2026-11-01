// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { hint } from '../../src/home';

// The signed-in hint is what lets a signed-in rider skip the home page. With no guest mode, a hint
// that turns out to be stale is cleared (home.sessionSettled) and the home page shows instead.
describe('the signed-in hint', () => {
  beforeEach(() => localStorage.clear());

  it('is off until set, and turns on and off', () => {
    expect(hint()).toBe(false);
    hint(true);
    expect(hint()).toBe(true);
    expect(localStorage.getItem('americanflyers.signedIn')).toBe('1');
    hint(false);
    expect(hint()).toBe(false);
    expect(localStorage.getItem('americanflyers.signedIn')).toBeNull();
  });
});
