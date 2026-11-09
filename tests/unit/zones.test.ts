// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RideStats } from '../../src/stats';
import { HR_ZONES, POWER_ZONES, addZones, zoneBars, zoneIndex, zoneRange } from '../../src/zones';

describe('zoneIndex', () => {
  it('a value below the first step is zone 1', () => {
    expect(zoneIndex(POWER_ZONES, 0)).toBe(0);
    expect(zoneIndex(POWER_ZONES, 0.54)).toBe(0);
    expect(zoneIndex(HR_ZONES, 0.59)).toBe(0);
  });

  it('a value exactly on a boundary lands in the higher zone', () => {
    for (const zones of [POWER_ZONES, HR_ZONES]) {
      zones.slice(1).forEach((z, i) => {
        expect(zoneIndex(zones, z.from), `${z.label} at ${z.from}`).toBe(i + 1);
        expect(zoneIndex(zones, z.from - 0.001)).toBe(i);
      });
    }
  });

  it('a value above the top zone stays in the top zone', () => {
    expect(zoneIndex(POWER_ZONES, 2.5)).toBe(POWER_ZONES.length - 1);
    expect(zoneIndex(HR_ZONES, 1.2)).toBe(HR_ZONES.length - 1);
  });

  it('the power zones are the 6 the HUD shows, in order', () => {
    expect(POWER_ZONES.map((z) => z.from)).toEqual([0, 0.55, 0.75, 0.9, 1.05, 1.2]);
    expect(HR_ZONES.map((z) => z.from)).toEqual([0, 0.6, 0.7, 0.8, 0.9]);
  });
});

describe('RideStats zone time', () => {
  it('puts each second in the power zone for its ratio of FTP', () => {
    const stats = new RideStats(() => ({ ftp: 200, maxHr: 185 }));
    stats.add(60, 200, 90, 0, true); // 1.00 FTP → Z4 (threshold)
    stats.add(30, 100, 90, 0, true); // 0.50 FTP → Z1
    stats.add(10, 220, 90, 0, true); // 1.10 FTP → Z5
    expect(stats.powerZones[3]).toBe(60);
    expect(stats.powerZones[0]).toBe(30);
    expect(stats.powerZones[4]).toBe(10);
    expect(stats.powerZones.reduce((a, b) => a + b, 0)).toBe(stats.seconds);
  });

  it('a power exactly on a zone boundary is counted in the higher zone', () => {
    const stats = new RideStats(() => ({ ftp: 200, maxHr: 185 }));
    stats.add(10, 200 * POWER_ZONES[2].from, 90, 0, true); // exactly 0.75 FTP
    expect(stats.powerZones[2]).toBe(10);
    expect(stats.powerZones[1]).toBe(0);
  });

  it('puts heart-rate seconds in the zone for their share of max HR, and the times add up', () => {
    const stats = new RideStats(() => ({ ftp: 200, maxHr: 185 }));
    stats.add(20, 100, 90, 0.85 * 185, true); // Z4 (threshold)
    stats.add(40, 100, 90, 0.65 * 185, true); // Z2
    stats.add(5, 100, 90, 0, true); // no strap: no zone time
    expect(stats.hrZones[3]).toBe(20);
    expect(stats.hrZones[1]).toBe(40);
    expect(stats.hrZones.reduce((a, b) => a + b, 0)).toBe(60);
    expect(stats.hrZones.reduce((a, b) => a + b, 0)).toBeLessThan(stats.seconds); // the strap-less 5 s
  });

  it('an HR exactly on a boundary is counted in the higher zone', () => {
    const stats = new RideStats(() => ({ ftp: 200, maxHr: 185 }));
    stats.add(12, 100, 90, HR_ZONES[3].from * 185, true); // exactly 0.8 max HR → Z4
    expect(stats.hrZones[3]).toBe(12);
    expect(stats.hrZones[2]).toBe(0);
  });

  it('keeps no zone time when FTP or max HR is unknown', () => {
    const stats = new RideStats(() => ({ ftp: 0, maxHr: 0 }));
    stats.add(30, 200, 90, 150, true);
    expect(stats.powerZones.every((s) => s === 0)).toBe(true);
    expect(stats.hrZones.every((s) => s === 0)).toBe(true);
    expect(stats.seconds).toBe(30);
  });
});

describe('zone helpers', () => {
  it('addZones sums by index and treats missing data as zero', () => {
    expect(addZones([1, 2, 3], [10, 20, 30], 3)).toEqual([11, 22, 33]);
    expect(addZones(null, [10, 20], 2)).toEqual([10, 20]);
    expect(addZones(undefined, undefined, 2)).toEqual([0, 0]);
    expect(addZones([1], [20, 30], 2)).toEqual([21, 30]);
  });

  it('zoneRange gives the watts for a power zone and hides the top zone\'s upper end', () => {
    expect(zoneRange(POWER_ZONES, 1, 200, 'W')).toBe('110–149 W'); // 0.55–0.75 FTP
    expect(zoneRange(POWER_ZONES, POWER_ZONES.length - 1, 200, 'W')).toBe('240+ W');
    expect(zoneRange(HR_ZONES, 0, 180, 'bpm')).toBe('0–107 bpm');
  });

  it('zoneBars renders one labelled row per zone with its share of the time', () => {
    const el = zoneBars('Power', POWER_ZONES, [30, 30, 0, 0, 0, 0]);
    const rows = [...el.querySelectorAll('.zone-row')];
    expect(rows).toHaveLength(POWER_ZONES.length);
    expect((rows[0] as HTMLElement).title).toContain('Z1');
    expect(rows[0].querySelector('.zone-time')!.textContent).toBe('0:30 · 50%');
    expect(rows[1].querySelector('.zone-fill')).toBeTruthy();
  });

  it('zoneBars says so when there is nothing to show', () => {
    const el = zoneBars('Heart rate', HR_ZONES, null);
    expect(el.querySelectorAll('.zone-row')).toHaveLength(0);
    expect(el.textContent).toContain('No heart-rate data');
  });
});
