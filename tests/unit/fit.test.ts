import { describe, expect, it } from 'vitest';
import { fitCrc, toFit } from '../../src/cloud/fit';
import type { Samples } from '../../src/cloud/sync';

const FIT_EPOCH = 631065600;
const BASE_SIZE: Record<number, number> = { 0x00: 1, 0x02: 1, 0x84: 2, 0x86: 4, 0x8c: 4 };

interface Msg { global: number; fields: Map<number, number> }

/** Minimal FIT decoder: walks definition + data messages, returns raw (unscaled) field values. */
function decode(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headerSize = b[0];
  const dataSize = dv.getUint32(4, true);
  const defs = new Map<number, { global: number; fields: { num: number; size: number; type: number }[] }>();
  const msgs: Msg[] = [];
  let p = headerSize;
  const end = headerSize + dataSize;
  while (p < end) {
    const h = b[p++];
    if (h & 0x40) {
      p += 2; // reserved + architecture (little endian)
      const global = dv.getUint16(p, true);
      p += 2;
      const nf = b[p++];
      const fields = [];
      for (let i = 0; i < nf; i++) { fields.push({ num: b[p], size: b[p + 1], type: b[p + 2] }); p += 3; }
      defs.set(h & 0x0f, { global, fields });
    } else {
      const d = defs.get(h & 0x0f)!;
      const fields = new Map<number, number>();
      for (const f of d.fields) {
        expect(f.size).toBe(BASE_SIZE[f.type]);
        let v = 0;
        for (let i = 0; i < f.size; i++) v += b[p + i] * 2 ** (8 * i);
        fields.set(f.num, v);
        p += f.size;
      }
      msgs.push({ global: d.global, fields });
    }
  }
  return { headerSize, dataSize, msgs, end };
}

const ride = { title: 'Test', started_at: '2025-03-01T10:00:00Z', duration_s: 3, distance_m: 30, climbed_m: 5, avg_power: 200, np: 205, max_power: 250, avg_hr: 140, max_hr: 150, avg_cadence: 90, kj: 0.6, tss: 0.1, ftp: 250 };
const samples: Samples = {
  power: [150, 200, 250],
  cadence: [80, 90, 100],
  hr: [130, 0, 150],
  speed: [100, 105, 110], // m/s x10
  distance: [10, 20, 30],
  elevation: [12345, 12355, 12365], // m x10
};
const t0 = Date.parse(ride.started_at) / 1000 - FIT_EPOCH;

describe('toFit', () => {
  const bytes = toFit(ride, samples);
  const d = decode(bytes);

  it('writes a valid header and CRCs', () => {
    expect(d.headerSize).toBe(14);
    expect(bytes[1]).toBe(0x20);
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
    expect(d.end + 2).toBe(bytes.length);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint16(12, true)).toBe(fitCrc(bytes, 0, 12));
    expect(dv.getUint16(bytes.length - 2, true)).toBe(fitCrc(bytes, 0, bytes.length - 2));
    expect(fitCrc(bytes)).toBe(0); // CRC over data plus its own CRC is zero
  });

  it('orders messages for an activity file', () => {
    expect(d.msgs.map((m) => m.global)).toEqual([0, 23, 21, 20, 20, 20, 21, 19, 18, 34]);
    const id = d.msgs[0].fields;
    expect(id.get(0)).toBe(4);
    expect(id.get(1)).toBe(255);
    expect(id.get(4)).toBe(t0);
  });

  it('round-trips records with scales and offsets', () => {
    const recs = d.msgs.filter((m) => m.global === 20);
    expect(recs).toHaveLength(3);
    recs.forEach((r, i) => {
      const f = r.fields;
      expect(f.get(253)).toBe(t0 + i);
      expect(f.get(7)).toBe(samples.power[i]);
      expect(f.get(4)).toBe(samples.cadence[i]);
      expect(f.get(5)! / 100).toBe(samples.distance[i]);
      expect(f.get(73)! / 1000).toBeCloseTo(samples.speed[i] / 10, 6);
      expect(f.get(6)).toBe(f.get(73));
      expect(Math.abs(f.get(78)! / 5 - 500 - samples.elevation[i] / 10)).toBeLessThanOrEqual(0.1 + 1e-9); // 0.2 m resolution
    });
    expect(recs[0].fields.get(3)).toBe(130);
    expect(recs[2].fields.get(3)).toBe(150);
  });

  it('encodes a sample with no heart rate as invalid', () => {
    expect(d.msgs.filter((m) => m.global === 20)[1].fields.get(3)).toBe(0xff);
  });

  it('writes session totals', () => {
    const s = d.msgs.find((m) => m.global === 18)!.fields;
    expect(s.get(5)).toBe(2); // cycling
    expect(s.get(6)).toBe(58); // virtual activity
    expect(s.get(2)).toBe(t0);
    expect(s.get(7)).toBe(3000);
    expect(s.get(8)).toBe(3000);
    expect(s.get(9)).toBe(3000);
    expect(s.get(22)).toBe(5);
    expect(s.get(20)).toBe(200);
    expect(s.get(21)).toBe(250);
    expect(s.get(34)).toBe(205);
    expect(s.get(16)).toBe(140);
    expect(s.get(17)).toBe(150);
    expect(s.get(18)).toBe(90);
    expect(s.get(35)).toBe(1);
    expect(s.get(45)).toBe(250);
    expect(s.get(48)).toBe(600);
    expect(d.msgs.find((m) => m.global === 34)!.fields.get(1)).toBe(1);
  });

  it('still produces a valid file for a ride with no samples', () => {
    const empty = toFit({ ...ride, duration_s: 0, distance_m: 0 }, { power: [], cadence: [], hr: [], speed: [], distance: [], elevation: [] });
    const e = decode(empty);
    expect(e.msgs.some((m) => m.global === 20)).toBe(false);
    expect(fitCrc(empty)).toBe(0);
  });
});
