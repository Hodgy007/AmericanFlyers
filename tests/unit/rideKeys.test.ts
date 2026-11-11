import { describe, expect, it } from 'vitest';
import { ignoreRideKey } from '../../src/rideKeys';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, closest: () => null, ...extra });

describe('ignoreRideKey', () => {
  it('lets ride keys through on the ride screen', () => {
    expect(ignoreRideKey({ target: el('BODY') }, false)).toBe(false);
    expect(ignoreRideKey({ target: el('BUTTON') }, false)).toBe(false);
  });
  it('ignores typing in fields, selects and editable content', () => {
    expect(ignoreRideKey({ target: el('INPUT') }, false)).toBe(true);
    expect(ignoreRideKey({ target: el('textarea') }, false)).toBe(true);
    expect(ignoreRideKey({ target: el('SELECT') }, false)).toBe(true);
    expect(ignoreRideKey({ target: el('DIV', { isContentEditable: true }) }, false)).toBe(true);
  });
  it('ignores keys inside a dialog', () => {
    expect(ignoreRideKey({ target: { tagName: 'BUTTON', closest: (s: string) => (s === 'dialog' ? {} : null) } }, false)).toBe(true);
  });
  it('ignores everything while the home page shows', () => {
    expect(ignoreRideKey({ target: el('BODY') }, true)).toBe(true);
  });
  it('ignores Ctrl, Cmd and Alt combinations', () => {
    expect(ignoreRideKey({ target: el('BODY'), ctrlKey: true }, false)).toBe(true);
    expect(ignoreRideKey({ target: el('BODY'), metaKey: true }, false)).toBe(true);
    expect(ignoreRideKey({ target: el('BODY'), altKey: true }, false)).toBe(true);
  });
  it('always lets a steering key be released outside fields', () => {
    expect(ignoreRideKey({ target: el('BODY'), ctrlKey: true }, true, true)).toBe(false);
    expect(ignoreRideKey({ target: el('INPUT') }, false, true)).toBe(true);
  });
});
