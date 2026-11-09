import { describe, expect, it } from 'vitest';
import { CrankCadence, parseCyclingPower, parseIndoorBikeData } from '../../src/ble/trainer';

/** A DataView over the given little-endian bytes (as Bluetooth notifications arrive). */
function view(bytes: number[]): DataView {
  const u = new Uint8Array(bytes);
  return new DataView(u.buffer, u.byteOffset, u.byteLength);
}

/** Appends a uint16 in the order Bluetooth's little-endian notifications carry it (low byte first). */
function u16(bytes: number[], v: number) {
  bytes.push(v & 0xff, (v >> 8) & 0xff);
  return bytes;
}

/** FTMS flags, low byte only (they all fit in it), then the rest of the notification. */
const ftms = (flags: number, ...rest: number[]) => view([flags & 0xff, (flags >> 8) & 0xff, ...rest]);

describe('parseIndoorBikeData', () => {
  it('reads instantaneous speed with no other flags set (0x0000)', () => {
    // Bit 0 clear: instantaneous speed is present, 0.01 km/h units. 2550 → 25.50 km/h.
    expect(parseIndoorBikeData(ftms(0x0000, ...u16([], 2550)))).toEqual({ speedKmh: 25.5 });
  });

  it('treats bit 0 (More Data) as the speed field being absent', () => {
    // More Data set (no instantaneous speed) + instantaneous cadence (bit 2): 0.5 rpm units.
    const flags = 0x0005;
    expect(parseIndoorBikeData(ftms(flags, ...u16([], 170)))).toEqual({ cadence: 85 });
  });

  it('reads power with the power bit (0x0040) set', () => {
    const bytes = u16([], 2000); // speed 20.00 km/h
    bytes.push(120, 0); // power 120 W, int16
    expect(parseIndoorBikeData(ftms(0x0040, ...bytes))).toEqual({ speedKmh: 20, power: 120 });
  });

  it('reads power and cadence together (power bit 0x0040, cadence bit 0x0004)', () => {
    // speed | cadence | power
    const bytes = u16([], 3000);
    u16(bytes, 180); // cadence 90 rpm
    bytes.push(0x2c, 0x01); // power 300 W
    expect(parseIndoorBikeData(ftms(0x0004 | 0x0040, ...bytes))).toEqual({ speedKmh: 30, cadence: 90, power: 300 });
  });

  it('reads power, cadence and heart rate together, skipping the fields in between', () => {
    // speed | cadence | power | heart rate
    const bytes = u16([], 3000);
    u16(bytes, 180); // cadence 90 rpm
    bytes.push(0x2c, 0x01); // power 300 W
    bytes.push(142); // HR
    expect(parseIndoorBikeData(ftms(0x0004 | 0x0040 | 0x0200, ...bytes))).toEqual({
      speedKmh: 30,
      cadence: 90,
      power: 300,
      heartRate: 142,
    });
  });

  it('skips the optional fields before power, so the offsets stay right', () => {
    const bytes = u16([], 1000); // speed 10 km/h
    u16(bytes, 2500); // average speed
    u16(bytes, 160); // cadence 80
    u16(bytes, 170); // average cadence
    bytes.push(1, 2, 3); // total distance (3 bytes)
    u16(bytes, 5); // resistance level
    bytes.push(0xf4, 0x00); // power 244 W
    expect(parseIndoorBikeData(ftms(0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0020 | 0x0040, ...bytes))).toEqual({
      speedKmh: 10,
      cadence: 80,
      power: 244,
    });
  });
});

describe('parseCyclingPower', () => {
  const cps = (flags: number, ...rest: number[]) => view([flags & 0xff, (flags >> 8) & 0xff, ...rest]);

  it('reads instantaneous power', () => {
    expect(parseCyclingPower(cps(0x0000, 0x2c, 0x01), new CrankCadence())).toEqual({ power: 300 });
  });

  it('skips wheel revolution data before crank data', () => {
    // flags: wheel revolution data (0x0010) + crank revolution data (0x0020)
    const bytes: number[] = [0x2c, 0x01]; // power 300
    bytes.push(1, 0, 0, 0, 0, 0); // wheel revs + wheel event time
    u16(bytes, 10); // cumulative crank revs
    u16(bytes, 0); // crank event time (first event: no cadence yet)
    expect(parseCyclingPower(cps(0x0030, ...bytes), new CrankCadence())).toEqual({ power: 300, cadence: 0 });
  });
});

describe('CrankCadence', () => {
  it('turns crank revolutions over time into rpm', () => {
    const cadence = new CrankCadence();
    cadence.update(10, 0, 0);
    // 2 revolutions in 1024 ticks (1 s) = 120 rpm.
    expect(cadence.update(12, 1024, 1000)).toBe(120);
  });

  it('still computes cadence when the cumulative revolution counter wraps 65535 → 0', () => {
    const cadence = new CrankCadence();
    cadence.update(65534, 0, 0);
    // One revolution to 65535, then two more to 1: 3 revolutions across the wrap, in 1.5 s (1536 ticks).
    expect(cadence.update(1, 1536, 1500)).toBe(120);
  });

  it('parses a wrapping CPS notification end to end', () => {
    const cadence = new CrankCadence();
    const cps = (revs: number, time: number) => {
      const bytes: number[] = [0x2c, 0x01]; // power 300
      u16(bytes, revs);
      u16(bytes, time);
      return view([0x20, 0x00, ...bytes]); // crank revolution data only
    };
    parseCyclingPower(cps(65534, 0xfc00), cadence); // time 64512
    // +2 revs, + 512 ticks (0.5 s) across the wrap → 240 rpm
    expect(parseCyclingPower(cps(0, 0xfe00), cadence).cadence).toBe(240);
  });

  it('reports 0 once pedalling stops and the counter stands still', () => {
    const cadence = new CrankCadence();
    cadence.update(10, 0, 0);
    expect(cadence.update(11, 1024, 1000)).toBe(60);
    // No new revolution for more than 2.5 s: stopped pedalling.
    expect(cadence.update(11, 1024, 4000)).toBe(0);
  });
});
