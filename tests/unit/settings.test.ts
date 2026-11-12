// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../../src/settings';

const KEY = 'americanflyers.settings';

beforeEach(() => localStorage.clear());

describe('normalizeSettings', () => {
  it('keeps a good copy, including false switches and an empty field list', () => {
    const s = normalizeSettings({
      ...DEFAULT_SETTINGS,
      sound: false,
      music: false,
      difficulty: 0,
      dataFields: [],
      units: 'imperial',
    });
    expect(s.sound).toBe(false);
    expect(s.music).toBe(false);
    expect(s.difficulty).toBe(0);
    expect(s.dataFields).toEqual([]); // "no data blocks" is a real choice
    expect(s.units).toBe('imperial');
  });

  it('replaces malformed values with defaults instead of passing them on', () => {
    const s = normalizeSettings({
      riderKg: Number.NaN,
      ftp: 'lots',
      maxHr: 10_000,
      difficulty: -5,
      units: 'furlongs',
      timeOfDay: 'midnight',
      dataFields: ['power', 'power', 'bogus', 42],
      plan: { id: 3 },
      kit: { jersey: 'red' },
    });
    expect(s.riderKg).toBe(DEFAULT_SETTINGS.riderKg);
    expect(s.ftp).toBe(DEFAULT_SETTINGS.ftp);
    expect(s.maxHr).toBe(DEFAULT_SETTINGS.maxHr);
    expect(s.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(s.units).toBe('metric');
    expect(s.timeOfDay).toBe('auto');
    expect(s.dataFields).toEqual(['power']); // known ids only, no duplicates
    expect(s.plan).toBeNull();
    expect(s.kit).toBeNull();
  });

  it('never shares the default field array with the caller', () => {
    const s = normalizeSettings({});
    expect(s.dataFields).not.toBe(DEFAULT_SETTINGS.dataFields);
    expect(s.dataFields).toEqual(DEFAULT_SETTINGS.dataFields);
    s.dataFields.push('tss');
    expect(DEFAULT_SETTINGS.dataFields).toHaveLength(8);
  });

  it('accepts a valid plan, kit, tour and loadout', () => {
    const plan = { id: 'ftp-builder', started: '2026-10-20', done: [0, 1, 1] };
    const kit = { jersey: '#ff0000', accent: '#ffffff', frame: '#123456' };
    const tour = { id: 'hotw-1x', seed: 42, stage: 1, results: [] };
    const s = normalizeSettings({ plan, kit, tour, loadout: { frame: 'tron', wheels: 'deep' } });
    expect(s.plan).toEqual({ ...plan, done: [0, 1] });
    expect(s.kit).toEqual(kit);
    expect(s.tour).toMatchObject({ id: 'hotw-1x', seed: 42, stage: 1 });
    expect(s.loadout).toEqual({ frame: 'tron', wheels: 'deep' });
  });

  it('treats null, arrays and primitives as an empty copy', () => {
    for (const v of [null, [], 'settings', 7]) expect(normalizeSettings(v)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('loadSettings', () => {
  it('reads rubbish storage back as defaults rather than crashing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates an old copy to Solo once and saves the result', () => {
    localStorage.setItem(KEY, JSON.stringify({ riderKg: 66, proTeams: true }));
    const s = loadSettings();
    expect(s.riderKg).toBe(66);
    expect(s.proTeams).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!).settingsVersion).toBeGreaterThanOrEqual(2);
  });

  it('round-trips what saveSettings writes', () => {
    saveSettings({ ...DEFAULT_SETTINGS, ftp: 267, hudPosition: 'left' });
    const s = loadSettings();
    expect(s.ftp).toBe(267);
    expect(s.hudPosition).toBe('left');
  });
});
