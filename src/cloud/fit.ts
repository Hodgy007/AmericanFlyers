// A small, dependency-free encoder for Garmin FIT activity files, so a saved
// ride can be loaded into Garmin Connect, TrainingPeaks, intervals.icu or
// Strava's manual upload. Write-only: nothing is sent anywhere.

import type { Samples } from './sync';

export interface FitRide {
  title?: string;
  started_at: string;
  duration_s: number;
  distance_m: number;
  climbed_m?: number | null;
  avg_power?: number | null;
  np?: number | null;
  max_power?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  avg_cadence?: number | null;
  kj?: number | null;
  tss?: number | null;
  ftp?: number | null;
}

// Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z).
const FIT_EPOCH_OFFSET = 631065600;

// Base types: [type byte, size, invalid value].
const ENUM = [0x00, 1, 0xff] as const;
const U8 = [0x02, 1, 0xff] as const;
const U16 = [0x84, 2, 0xffff] as const;
const U32 = [0x86, 4, 0xffffffff] as const;
const U32Z = [0x8c, 4, 0] as const;
type BaseType = typeof ENUM | typeof U8 | typeof U16 | typeof U32 | typeof U32Z;

type Field = readonly [num: number, type: BaseType];
type Value = number | null | undefined;

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** The FIT CRC-16 (nibble table algorithm from the FIT SDK). */
export function fitCrc(bytes: ArrayLike<number>, start = 0, end = bytes.length, crc = 0) {
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

class Writer {
  readonly bytes: number[] = [];
  private defined = new Map<number, string>();
  private slots = new Map<number, number>();

  /** Writes a message, emitting a definition first when its layout is new. Values follow field order. */
  message(globalNum: number, fields: readonly Field[], values: readonly Value[]) {
    const sig = fields.map((f) => `${f[0]}:${f[1][0]}`).join(',');
    let slot = this.slots.get(globalNum);
    if (slot === undefined) {
      slot = this.slots.size;
      this.slots.set(globalNum, slot);
    }
    if (this.defined.get(globalNum) !== sig) {
      this.defined.set(globalNum, sig);
      this.bytes.push(0x40 | slot, 0, 0, globalNum & 0xff, globalNum >> 8, fields.length);
      for (const [num, t] of fields) this.bytes.push(num, t[1], t[0]);
    }
    this.bytes.push(slot);
    fields.forEach(([, t], i) => {
      const raw = values[i];
      // Missing or out-of-range values become the type's invalid marker.
      const max = 2 ** (8 * t[1]) - 1;
      let v = raw == null || !Number.isFinite(raw) ? t[2] : Math.round(raw);
      if (v < 0 || v > max) v = t[2];
      for (let b = 0; b < t[1]; b++) this.bytes.push(Math.floor(v / 2 ** (8 * b)) & 0xff);
    });
  }
}

const TIMESTAMP: Field = [253, U32];

const mean = (xs: number[]) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);

/** Encodes a saved ride as a FIT activity file. Samples are one per second of moving time, with no gaps. */
export function toFit(a: FitRide, s: Samples): Uint8Array<ArrayBuffer> {
  const n = s.power.length;
  const startMs = new Date(a.started_at).getTime();
  const t0 = Math.floor(startMs / 1000) - FIT_EPOCH_OFFSET;
  const elapsed = n || a.duration_s || 0;
  const end = t0 + elapsed;
  const w = new Writer();

  const hrs = s.hr.filter((v) => v > 0);
  const avgPower = a.avg_power ?? mean(s.power);
  const maxPower = a.max_power ?? (n ? Math.max(...s.power) : null);
  const avgHr = a.avg_hr ?? mean(hrs);
  const maxHr = a.max_hr ?? (hrs.length ? Math.max(...hrs) : null);
  const avgCad = a.avg_cadence ?? mean(s.cadence.filter((v) => v > 0));
  const dist = a.distance_m || s.distance[n - 1] || 0;
  const ascent = a.climbed_m ?? 0;
  const avgSpeed = elapsed ? dist / elapsed : null;
  const maxSpeed = n ? Math.max(...s.speed) / 10 : null;
  const kj = a.kj ?? (avgPower != null ? (avgPower * elapsed) / 1000 : null);

  w.message(0, [[0, ENUM], [1, U16], [2, U16], [3, U32Z], [4, U32]], [4, 255, 0, (startMs / 1000) >>> 0 || 1, t0]);
  w.message(23, [TIMESTAMP, [0, U8], [2, U16], [4, U16]], [t0, 0, 255, 0]);
  w.message(21, [TIMESTAMP, [0, ENUM], [1, ENUM], [4, U8]], [t0, 0, 0, 0]); // timer start

  const REC: Field[] = [TIMESTAMP, [5, U32], [6, U16], [7, U16], [4, U8], [3, U8], [2, U16], [73, U32], [78, U32]];
  for (let i = 0; i < n; i++) {
    const speed = s.speed[i] / 10; // m/s
    const alt = s.elevation[i] / 10; // m
    const altScaled = (alt + 500) * 5;
    w.message(20, REC, [
      t0 + i,
      s.distance[i] * 100,
      speed * 1000,
      s.power[i],
      Math.min(254, s.cadence[i]),
      s.hr[i] > 0 ? Math.min(254, s.hr[i]) : null, // 0 means "no sensor": write the invalid value
      altScaled,
      speed * 1000,
      altScaled,
    ]);
  }

  w.message(21, [TIMESTAMP, [0, ENUM], [1, ENUM], [4, U8]], [end, 0, 4, 0]); // timer stop (all)

  const totals = [elapsed * 1000, elapsed * 1000, dist * 100];
  w.message(19, [TIMESTAMP, [0, ENUM], [1, ENUM], [2, U32], [7, U32], [8, U32], [9, U32], [25, ENUM], [13, U16], [14, U16], [15, U8], [16, U8], [17, U8], [19, U16], [20, U16], [21, U16]],
    [end, 9, 1, t0, ...totals, 2, avgSpeed != null ? avgSpeed * 1000 : null, maxSpeed != null ? maxSpeed * 1000 : null, avgHr, maxHr, avgCad, avgPower, maxPower, ascent]);

  w.message(18, [TIMESTAMP, [254, U16], [0, ENUM], [1, ENUM], [2, U32], [5, ENUM], [6, ENUM], [7, U32], [8, U32], [9, U32], [11, U16], [14, U16], [15, U16], [16, U8], [17, U8], [18, U8], [20, U16], [21, U16], [22, U16], [25, U16], [26, U16], [34, U16], [35, U16], [45, U16], [48, U32]],
    [end, 0, 8, 1, t0, 2, 58, ...totals, kj != null ? kj * 0.239 : null, avgSpeed != null ? avgSpeed * 1000 : null, maxSpeed != null ? maxSpeed * 1000 : null,
      avgHr, maxHr, avgCad, avgPower, maxPower, ascent, 0, 1, a.np, a.tss != null ? a.tss * 10 : null, a.ftp, kj != null ? kj * 1000 : null]);

  w.message(34, [TIMESTAMP, [0, U32], [1, U16], [2, ENUM], [3, ENUM], [4, ENUM]], [end, elapsed * 1000, 1, 0, 26, 1]);

  const data = w.bytes;
  const out = new Uint8Array(new ArrayBuffer(14 + data.length + 2));
  const dv = new DataView(out.buffer);
  out[0] = 14;
  out[1] = 0x20; // protocol 2.0
  dv.setUint16(2, 2100, true); // profile version 21.00
  dv.setUint32(4, data.length, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
  dv.setUint16(12, fitCrc(out, 0, 12), true);
  out.set(data, 14);
  dv.setUint16(14 + data.length, fitCrc(out, 0, 14 + data.length), true);
  return out;
}
