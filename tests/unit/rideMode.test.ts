import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canRace, effectiveMode, proTeamsOnRoad, storedMode } from '../../src/rideMode';
import { DEFAULT_SETTINGS, loadSettings, migrateSettings, SETTINGS_VERSION } from '../../src/settings';

/** A tiny in-memory localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    data,
  };
}
const KEY = 'americanflyers.settings';

describe('settings migration to Solo', () => {
  it('makes Solo the default for a new rider', () => {
    expect(DEFAULT_SETTINGS.proTeams).toBe(false);
    expect(DEFAULT_SETTINGS.settingsVersion).toBe(SETTINGS_VERSION);
  });

  it('moves a saved copy without the flag to Solo, once', () => {
    const m = migrateSettings({ proTeams: true, ftp: 250 });
    expect(m.proTeams).toBe(false);
    expect(m.settingsVersion).toBe(SETTINGS_VERSION);
    expect(m.ftp).toBe(250); // everything else is untouched
  });

  it('also moves an old copy that has pro teams off, to the same place', () => {
    expect(migrateSettings({ proTeams: false }).proTeams).toBe(false);
  });

  it('keeps the choice of a copy that has been migrated', () => {
    const saved = { proTeams: true, settingsVersion: SETTINGS_VERSION };
    expect(migrateSettings(saved)).toBe(saved);
    expect(migrateSettings(saved).proTeams).toBe(true);
  });

  it('does not touch a copy from a newer version', () => {
    const saved = { proTeams: true, settingsVersion: SETTINGS_VERSION + 1 };
    expect(migrateSettings(saved).proTeams).toBe(true);
  });

  describe('loadSettings', () => {
    beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('gives defaults (Solo) when nothing is saved', () => {
      expect(loadSettings().proTeams).toBe(false);
    });

    it('switches an existing rider to Solo and saves that, so it happens once', () => {
      const store = fakeStorage({ [KEY]: JSON.stringify({ ftp: 260, proTeams: true }) });
      vi.stubGlobal('localStorage', store);
      const first = loadSettings();
      expect(first.proTeams).toBe(false);
      expect(first.ftp).toBe(260);
      expect(JSON.parse(store.data.get(KEY)!).settingsVersion).toBe(SETTINGS_VERSION);
      // They now choose "With pro teams": a later load remembers it.
      store.setItem(KEY, JSON.stringify({ ...first, proTeams: true }));
      expect(loadSettings().proTeams).toBe(true);
    });
  });
});

describe('ride modes', () => {
  const finishing = { finish: 12000 };
  const endless = { finish: null };

  it('only a route with a finish and no workout can be raced', () => {
    expect(canRace(finishing, null)).toBe(true);
    expect(canRace(endless, null)).toBe(false);
    expect(canRace(finishing, 'w1')).toBe(false);
  });

  it('the stored half is Solo or With pro teams', () => {
    expect(storedMode({ proTeams: false })).toBe('solo');
    expect(storedMode({ proTeams: true })).toBe('pro');
  });

  it('Race holds only where it can; otherwise the stored mode applies', () => {
    expect(effectiveMode({ proTeams: false }, true, true)).toBe('race');
    expect(effectiveMode({ proTeams: true }, true, true)).toBe('race');
    expect(effectiveMode({ proTeams: false }, true, false)).toBe('solo');
    expect(effectiveMode({ proTeams: true }, true, false)).toBe('pro');
    expect(effectiveMode({ proTeams: true }, false, true)).toBe('pro');
  });

  it('only With pro teams puts the free-ride teams on the road', () => {
    expect(proTeamsOnRoad('solo')).toBe(false);
    expect(proTeamsOnRoad('pro')).toBe(true);
    expect(proTeamsOnRoad('race')).toBe(false);
  });
});
