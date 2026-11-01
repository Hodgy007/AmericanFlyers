import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, stepSpeed } from '../../src/physics';
import {
  cleanLoadout, DEFAULT_LOADOUT, equipmentEffects, EVEREST_M, ITEMS, itemById, NO_EFFECTS, SLOTS, STARTER_IDS, styleOf,
} from '../../src/garage/catalogue';
import { describeItem, effectNumbers, paramsFor, powerToHold, stageSeconds } from '../../src/garage/effects';
import { levelForXp, levelFraction, levelTitle, levelXp, MAX_LEVEL, parseWallet, rideRewards } from '../../src/garage/progression';
import { claimable, equip, fitsLoadout, itemState } from '../../src/garage/store';
import { cleanStyle, DEFAULT_STYLE, isDefaultStyle, parseStyleSuffix, styleSuffix } from '../../src/garage/style';
import { kitString, parseKitString, parseKitStyle, type PlayerLook } from '../../src/kit';
import { stageById } from '../../src/stages';

const CTX = { riderKg: 75, bikeKg: 8, ftp: 250 };
const wallet = (over: Record<string, unknown> = {}) => parseWallet({
  level: 5, xp: 1000, xp_this: 900, xp_next: 1300, credits_earned: 900, credits_spent: 100, balance: 800,
  km: 120, climbed_m: 2000, rides: 9, challenges_done: 1, owned: [...STARTER_IDS], ...over,
})!;

describe('level curve', () => {
  it('starts at level 1 with 0 XP and grows steadily', () => {
    expect(levelXp(1)).toBe(0);
    expect(levelXp(2)).toBe(100);
    for (let n = 2; n <= MAX_LEVEL; n++) expect(levelXp(n)).toBeGreaterThan(levelXp(n - 1));
  });

  it('is gentle: each level asks for more, but not wildly more', () => {
    const step = (n: number) => levelXp(n + 1) - levelXp(n);
    expect(step(40)).toBeGreaterThan(step(5));
    expect(step(40) / step(5)).toBeLessThan(15);
  });

  it('works out the level from XP, capped at 50', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(levelXp(17) - 1)).toBe(16);
    expect(levelForXp(levelXp(17))).toBe(17);
    expect(levelForXp(10_000_000)).toBe(MAX_LEVEL);
  });

  it('matches the server: 5 400 XP (180 km and 9 000 m climbed) is level 13', () => {
    // The worked example from the database test: floor(180 * 5 + 9000 * 0.5) = 5400.
    expect(rideRewards(180, 9000).xp).toBe(5400);
    expect(levelForXp(5400)).toBe(13);
  });

  it('rewards 1 credit per km and per 10 m climbed, 5 XP per km and 0.5 XP per metre', () => {
    expect(rideRewards(40, 500)).toEqual({ credits: 90, xp: 450 });
    expect(rideRewards(-5, -5)).toEqual({ credits: 0, xp: 0 });
  });

  it('shows how far through a level you are', () => {
    expect(levelFraction({ xp: 1100, xpThis: 900, xpNext: 1300 })).toBeCloseTo(0.5);
    expect(levelFraction({ xp: 50, xpThis: 0, xpNext: null })).toBe(1);
    expect(levelFraction({ xp: 2000, xpThis: 900, xpNext: 1300 })).toBe(1);
  });

  it('gives a title that changes every five levels', () => {
    expect(levelTitle(1)).toBe(levelTitle(5));
    expect(levelTitle(6)).not.toBe(levelTitle(5));
    expect(levelTitle(500)).toBeTruthy();
  });

  it('reads the server wallet, and rejects anything else', () => {
    const w = wallet();
    expect(w).toMatchObject({ level: 5, balance: 800, climbedM: 2000, xpNext: 1300 });
    expect(parseWallet({ level: 13, balance: '12', km: '4.5', xp_next: null })).toMatchObject({ balance: 12, km: 4.5, xpNext: null });
    expect(parseWallet(null)).toBeNull();
    expect(parseWallet({ nonsense: true })).toBeNull();
  });
});

describe('catalogue', () => {
  it('has unique ids, one starter per slot, and defaults that are those starters', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const slot of SLOTS) {
      expect(ITEMS.filter((i) => i.slot === slot && i.starter), slot).toHaveLength(1);
      expect(itemById(DEFAULT_LOADOUT[slot])?.starter).toBe(true);
    }
    for (const i of ITEMS) {
      expect(i.price).toBeGreaterThanOrEqual(0);
      expect(i.level).toBeGreaterThanOrEqual(1);
      if (i.starter) expect(i.price).toBe(0);
    }
  });

  it('keeps every effect modest and realistic', () => {
    for (const i of ITEMS) {
      const e = i.effects ?? {};
      expect(Math.abs(e.cda ?? 0), i.id).toBeLessThanOrEqual(0.05);
      expect(Math.abs(e.mass ?? 0), i.id).toBeLessThanOrEqual(0.8);
      expect(Math.abs(e.crr ?? 0), i.id).toBeLessThanOrEqual(0.001);
    }
  });

  it('matches the planned numbers', () => {
    expect(itemById('frame-aero')?.effects?.cda).toBe(-0.025);
    expect(itemById('frame-climber')?.effects?.mass).toBe(-0.8);
    expect(itemById('frame-tt')?.effects).toEqual({ cda: -0.05, mass: 0.4 });
    expect(itemById('wheels-carbon50')?.effects?.cda).toBe(-0.015);
    expect(itemById('wheels-deep80')?.effects).toEqual({ cda: -0.025, mass: 0.25 });
    expect(itemById('wheels-climb')?.effects?.mass).toBe(-0.45);
    expect(itemById('wheels-disc')?.effects?.cda).toBe(-0.035);
    expect(itemById('wheels-disc')?.needsFrame).toBe('tt');
    expect(itemById('tyres-race')?.effects?.crr).toBe(-0.0005);
    expect(itemById('helmet-aero')?.effects?.cda).toBe(-0.015);
    expect(itemById('jersey-skinsuit')?.effects?.cda).toBe(-0.02);
  });

  it('unlocks the Tron bike with the height of Everest in total climbing', () => {
    const tron = itemById('frame-tron')!;
    expect(tron.unlock).toEqual({ climbed_m: EVEREST_M });
    expect(EVEREST_M).toBe(8848);
    expect(tron.price).toBe(0);
  });
});

describe('loadout validation', () => {
  it('falls back to the starters for anything unknown, unowned or in the wrong slot', () => {
    const owned = new Set([...STARTER_IDS, 'frame-aero']);
    const l = cleanLoadout({ frame: 'frame-aero', wheels: 'frame-aero', tyres: 'tyres-race', helmet: 'nope', jersey: 7, socks: null }, owned);
    expect(l.frame).toBe('frame-aero'); // owned
    expect(l.wheels).toBe('wheels-alloy35'); // an item from the wrong slot
    expect(l.tyres).toBe('tyres-standard'); // not owned
    expect(l.helmet).toBe('helmet-standard'); // doesn't exist
    expect(l.jersey).toBe('jersey-plain');
    expect(l.socks).toBe('socks-white');
  });

  it('trusts the saved choice while ownership is not known yet', () => {
    expect(cleanLoadout({ frame: 'frame-tron' }, null).frame).toBe('frame-tron');
    expect(cleanLoadout({ frame: 'frame-tron' }, STARTER_IDS).frame).toBe('frame-classic');
  });

  it('copes with garbage', () => {
    for (const bad of [undefined, null, 'x', 42, [], { frame: {} }]) expect(cleanLoadout(bad, null)).toEqual(DEFAULT_LOADOUT);
  });

  it('keeps disc wheels for the time-trial bike only', () => {
    const owned = new Set([...STARTER_IDS, 'frame-tt', 'wheels-disc']);
    expect(cleanLoadout({ frame: 'frame-tt', wheels: 'wheels-disc' }, owned).wheels).toBe('wheels-disc');
    expect(cleanLoadout({ frame: 'frame-classic', wheels: 'wheels-disc' }, owned).wheels).toBe('wheels-alloy35');
    const disc = itemById('wheels-disc')!;
    expect(fitsLoadout(disc, { ...DEFAULT_LOADOUT, frame: 'frame-tt' })).toBe(true);
    expect(fitsLoadout(disc, DEFAULT_LOADOUT)).toBe(false);
  });

  it('puts the starter wheels back when you leave the time-trial bike', () => {
    const l = { ...DEFAULT_LOADOUT, frame: 'frame-tt', wheels: 'wheels-disc' };
    expect(equip(l, itemById('frame-aero')!, 'wheels-alloy35')).toMatchObject({ frame: 'frame-aero', wheels: 'wheels-alloy35' });
    expect(equip(l, itemById('helmet-aero')!, 'wheels-alloy35')).toMatchObject({ frame: 'frame-tt', wheels: 'wheels-disc', helmet: 'helmet-aero' });
  });

  it('turns a loadout into the 3D model style', () => {
    expect(styleOf(DEFAULT_LOADOUT)).toEqual(DEFAULT_STYLE);
    expect(styleOf({ ...DEFAULT_LOADOUT, frame: 'frame-tron', jersey: 'jersey-stars' })).toMatchObject({ frame: 'tron', pattern: 'stars', wheels: 'alloy35' });
  });
});

describe('equipment effects', () => {
  it('does nothing for the starter kit', () => {
    expect(equipmentEffects(DEFAULT_LOADOUT)).toEqual(NO_EFFECTS);
  });

  it('adds weights, multiplies drag changes and adds rolling resistance', () => {
    const e = equipmentEffects({ ...DEFAULT_LOADOUT, frame: 'frame-aero', wheels: 'wheels-deep80', tyres: 'tyres-race', helmet: 'helmet-aero', jersey: 'jersey-skinsuit' });
    expect(e.massKg).toBeCloseTo(0.25);
    expect(e.cdaFactor).toBeCloseTo(0.975 * 0.975 * 0.985 * 0.98, 6);
    expect(e.crrDelta).toBeCloseTo(-0.0005);
    expect(e.cdaFactor).toBeGreaterThan(0.9); // all that kit is still under 10% less drag
  });

  it('builds physics parameters from rider, bike and equipment', () => {
    const p = paramsFor(CTX, { massKg: -0.8, cdaFactor: 0.9, crrDelta: -0.0005 });
    expect(p.massKg).toBeCloseTo(82.2);
    expect(p.cda).toBeCloseTo(DEFAULT_PARAMS.cda * 0.9);
    expect(p.crr).toBeCloseTo(DEFAULT_PARAMS.crr - 0.0005);
  });

  it('powerToHold agrees with the speed stepSpeed settles at', () => {
    const p = paramsFor(CTX, NO_EFFECTS);
    for (const grade of [0, 0.04, 0.08]) {
      const watts = 250;
      let v = 3;
      for (let i = 0; i < 6000; i++) v = stepSpeed(v, watts, grade, 0.1, p);
      expect(powerToHold(v, grade, p)).toBeCloseTo(watts, -0.5); // within a couple of watts
    }
  });

  it('an aero frame saves a few watts at 40 km/h and barely helps up a mountain', () => {
    const a = effectNumbers({ massKg: 0, cdaFactor: 0.975, crrDelta: 0 }, CTX);
    expect(a.wattsAt40).toBeGreaterThan(4);
    expect(a.wattsAt40).toBeLessThan(10);
    expect(Math.abs(a.alpeSeconds)).toBeLessThan(10);
  });

  it('a lighter bike wins time on a climb; a heavier, more aero one loses it', () => {
    const light = effectNumbers({ massKg: -0.8, cdaFactor: 1, crrDelta: 0 }, CTX);
    expect(light.alpeSeconds).toBeGreaterThan(20);
    expect(light.alpeSeconds).toBeLessThan(90);
    expect(Math.abs(light.wattsAt40)).toBeLessThan(2);
    const tt = effectNumbers(equipmentEffects({ ...DEFAULT_LOADOUT, frame: 'frame-tt' }), CTX);
    expect(tt.wattsAt40).toBeGreaterThan(10);
    expect(tt.alpeSeconds).toBeLessThan(0);
  });

  it('lower rolling resistance saves watts everywhere', () => {
    const n = effectNumbers({ massKg: 0, cdaFactor: 1, crrDelta: -0.0005 }, CTX);
    expect(n.wattsAt40).toBeGreaterThan(0.5);
    expect(n.alpeSeconds).toBeGreaterThan(0);
  });

  it('describes items in plain words, and says nothing for cosmetic ones', () => {
    const aero = describeItem(itemById('frame-aero')!, CTX);
    expect(aero[0]).toMatch(/^Saves ≈ \d+ W at 40 km\/h$/);
    expect(describeItem(itemById('frame-climber')!, CTX).join(' ')).toMatch(/s faster up Alpe d’Huez/);
    expect(describeItem(itemById('frame-tt')!, CTX).join(' ')).toMatch(/s slower up Alpe d’Huez/);
    expect(describeItem(itemById('jersey-stars')!, CTX)).toEqual([]);
    expect(describeItem(itemById('socks-neon')!, CTX)).toEqual([]);
  });

  it('times a climb with the same physics as the ride', () => {
    const alpe = stageById('alpe-dhuez');
    const t = stageSeconds(alpe, 250, paramsFor(CTX, NO_EFFECTS));
    expect(t).toBeGreaterThan(55 * 60); // a 14 km, 8% climb at 250 W takes a bit over an hour
    expect(t).toBeLessThan(90 * 60);
    expect(stageSeconds(alpe, 300, paramsFor(CTX, NO_EFFECTS))).toBeLessThan(t);
  });
});

describe('store rules', () => {
  const tron = itemById('frame-tron')!;
  const aero = itemById('frame-aero')!;

  it('starters are always owned, even signed out', () => {
    expect(itemState(itemById('frame-classic')!, null)).toEqual({ kind: 'owned' });
    expect(itemState(aero, null).kind).toBe('locked');
  });

  it('locks by level first, then credits', () => {
    expect(itemState(aero, wallet({ level: 3 }))).toMatchObject({ kind: 'locked', reason: expect.stringContaining('level 4') });
    expect(itemState(aero, wallet({ level: 4, balance: 100 }))).toEqual({ kind: 'poor', short: 600 });
    expect(itemState(aero, wallet({ level: 4, balance: 700 }))).toEqual({ kind: 'buy' });
    expect(itemState(aero, wallet({ owned: [...STARTER_IDS, 'frame-aero'] }))).toEqual({ kind: 'owned' });
  });

  it('the Tron bike stays locked until the climbing is done, then is claimed for free', () => {
    const s = itemState(tron, wallet({ climbed_m: 8000 }));
    expect(s).toMatchObject({ kind: 'locked' });
    expect((s as { reason: string }).reason).toContain('8,848 m');
    expect(itemState(tron, wallet({ climbed_m: 8847 })).kind).toBe('locked');
    expect(itemState(tron, wallet({ climbed_m: 8848 }))).toEqual({ kind: 'claim' });
    expect(claimable(ITEMS, wallet({ climbed_m: 9000 })).map((i) => i.id)).toEqual(['frame-tron']);
    expect(claimable(ITEMS, wallet({ climbed_m: 9000, owned: [...STARTER_IDS, 'frame-tron'] }))).toEqual([]);
    expect(claimable(ITEMS, wallet({ climbed_m: 100 }))).toEqual([]);
  });
});

describe('what other riders see', () => {
  const look = (style: Partial<typeof DEFAULT_STYLE>, kit: PlayerLook['kit'] = ['#1c2b5a', '#ff8a00']): PlayerLook => ({ kit, jersey: '#ff8a00', frame: '#fff3d6', style: cleanStyle(style) });
  // The check ride_presence() applies on the server (db/schema.sql).
  const SERVER = /^#[0-9a-fA-F]{6},#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}(;[a-z]{1,2}=[a-z0-9]{1,12}){0,8}$/;

  it('a plain bike sends the colours only, as before', () => {
    expect(kitString(look({}))).toBe('#ff8a00,#1c2b5a,#fff3d6');
    expect(kitString({ kit: null, jersey: '#d62839', frame: '#1f3c88', style: DEFAULT_STYLE })).toBeNull();
  });

  it('adds the bike and clothes after the colours', () => {
    const s = kitString(look({ frame: 'tron', wheels: 'deep80', pattern: 'stars' }))!;
    expect(s).toBe('#ff8a00,#1c2b5a,#fff3d6;f=tron;w=deep80;p=stars');
    expect(parseKitString(s)).toEqual({ jersey: '#ff8a00', accent: '#1c2b5a', frame: '#fff3d6' });
    expect(parseKitStyle(s)).toMatchObject({ frame: 'tron', wheels: 'deep80', pattern: 'stars', tyres: 'standard' });
  });

  it('spells out the default colours when the default kit is worn on another bike', () => {
    const s = kitString({ kit: null, jersey: '#d62839', frame: '#1f3c88', style: cleanStyle({ frame: 'tt' }) })!;
    expect(s).toBe('#d62839,#14213d,#1f3c88;f=tt');
    expect(SERVER.test(s)).toBe(true);
  });

  it('every style the garage can send passes the server check', () => {
    for (const it of ITEMS) {
      const s = kitString(look(styleOf({ ...DEFAULT_LOADOUT, [it.slot]: it.id })))!;
      expect(SERVER.test(s), s).toBe(true);
    }
    const everything = kitString(look({ frame: 'tron', wheels: 'disc', tyres: 'race', helmet: 'aerodark', pattern: 'skinsuit', socks: 'neon' }))!;
    expect(SERVER.test(everything), everything).toBe(true);
  });

  it('ignores anything it does not understand', () => {
    expect(parseKitStyle('#ff8a00,#1c2b5a,#fff3d6;f=banana;w=deep80;zz=1')).toMatchObject({ frame: 'classic', wheels: 'deep80' });
    expect(parseKitStyle('#ff8a00,#1c2b5a,#fff3d6')).toBeNull();
    expect(parseKitStyle('#ff8a00,#1c2b5a,#fff3d6;f=classic')).toBeNull();
    expect(parseKitStyle(42)).toBeNull();
    expect(parseKitString('#ff8a00,#1c2b5a,#fff3d6;f=tron')).not.toBeNull();
  });

  it('style codes round-trip', () => {
    const s = cleanStyle({ frame: 'climber', wheels: 'climb', tyres: 'race', helmet: 'black', pattern: 'dots', socks: 'red' });
    expect(parseStyleSuffix(styleSuffix(s).split(';').slice(1))).toEqual(s);
    expect(styleSuffix(DEFAULT_STYLE)).toBe('');
    expect(isDefaultStyle(DEFAULT_STYLE)).toBe(true);
    expect(cleanStyle({ frame: 'nope', wheels: 3 })).toEqual(DEFAULT_STYLE);
  });
});
