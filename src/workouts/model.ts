// Structured workouts. Power is stored as a fraction of FTP (0.75 = 75 %),
// so a workout scales to whoever rides it.

export type Block =
  | { kind: 'steady'; duration: number; power: number; cadence?: number }
  | { kind: 'ramp'; duration: number; from: number; to: number; cadence?: number }
  | { kind: 'intervals'; repeats: number; onDuration: number; onPower: number; offDuration: number; offPower: number; cadence?: number }
  | { kind: 'free'; duration: number };

export interface Workout {
  id: string;
  name: string;
  description: string;
  blocks: Block[];
  source: 'builtin' | 'uploaded' | 'custom';
}

/** One flat segment of a workout: power ramps linearly from `start` to `end`. */
export interface Step {
  at: number; // seconds from the start
  duration: number;
  start: number; // fraction of FTP
  end: number;
  free: boolean; // free ride: no target
  label: string; // e.g. "Interval 2/5"
  cadence?: number;
}

export function expand(blocks: Block[]): Step[] {
  const steps: Step[] = [];
  let at = 0;
  const push = (s: Omit<Step, 'at'>) => {
    if (s.duration <= 0) return;
    steps.push({ ...s, at });
    at += s.duration;
  };
  for (const b of blocks) {
    switch (b.kind) {
      case 'steady':
        push({ duration: b.duration, start: b.power, end: b.power, free: false, label: 'Steady', cadence: b.cadence });
        break;
      case 'ramp':
        push({ duration: b.duration, start: b.from, end: b.to, free: false, label: b.to >= b.from ? 'Ramp up' : 'Ramp down', cadence: b.cadence });
        break;
      case 'intervals':
        for (let r = 1; r <= b.repeats; r++) {
          push({ duration: b.onDuration, start: b.onPower, end: b.onPower, free: false, label: `Interval ${r}/${b.repeats}`, cadence: b.cadence });
          const offLabel = b.offPower > b.onPower ? 'Surge' : 'Recovery';
          push({ duration: b.offDuration, start: b.offPower, end: b.offPower, free: false, label: `${offLabel} ${r}/${b.repeats}` });
        }
        break;
      case 'free':
        push({ duration: b.duration, start: 0.5, end: 0.5, free: true, label: 'Free ride' });
        break;
    }
  }
  return steps;
}

export function totalDuration(steps: Step[]) {
  const last = steps[steps.length - 1];
  return last ? last.at + last.duration : 0;
}

/** Target as a fraction of FTP at time `t` (null in free-ride sections or after the end). */
export function targetAt(steps: Step[], t: number): number | null {
  const s = stepAt(steps, t);
  if (!s || s.free) return null;
  return s.start + (s.end - s.start) * ((t - s.at) / s.duration);
}

export function stepAt(steps: Step[], t: number): Step | undefined {
  // Steps are short lists; a linear scan is fine.
  return steps.find((s) => t >= s.at && t < s.at + s.duration);
}

/** Training Stress Score estimate from the targets (free ride counted at 50 %). */
export function estimateTss(steps: Step[]) {
  const T = totalDuration(steps);
  if (!T) return 0;
  let p4 = 0;
  for (let t = 0; t < T; t++) {
    const s = stepAt(steps, t)!;
    const p = s.free ? 0.5 : s.start + (s.end - s.start) * ((t - s.at) / s.duration);
    p4 += p ** 4;
  }
  const intensity = (p4 / T) ** 0.25;
  return Math.round((T / 3600) * intensity * intensity * 100);
}

// --------------------------------------------------------------- built-in ----

const min = (m: number) => Math.round(m * 60);

export const BUILTIN_WORKOUTS: Workout[] = [
  {
    id: 'builtin-endurance-45',
    name: 'Endurance 45',
    description: 'Steady aerobic base: 45 minutes, mostly zone 2.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(8), from: 0.45, to: 0.65 },
      { kind: 'steady', duration: min(32), power: 0.68 },
      { kind: 'ramp', duration: min(5), from: 0.6, to: 0.4 },
    ],
  },
  {
    id: 'builtin-sweet-spot-3x10',
    name: 'Sweet Spot 3×10',
    description: 'Three 10-minute efforts at 90 % FTP with 5-minute recoveries.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.5, to: 0.75 },
      { kind: 'intervals', repeats: 3, onDuration: min(10), onPower: 0.9, offDuration: min(5), offPower: 0.55 },
      { kind: 'ramp', duration: min(5), from: 0.6, to: 0.4 },
    ],
  },
  {
    id: 'builtin-vo2-5x3',
    name: 'VO2 Max 5×3',
    description: 'Five hard 3-minute efforts at 115 % FTP with equal recovery.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.45, to: 0.75 },
      { kind: 'intervals', repeats: 2, onDuration: 30, onPower: 1.1, offDuration: 90, offPower: 0.55 },
      { kind: 'intervals', repeats: 5, onDuration: min(3), onPower: 1.15, offDuration: min(3), offPower: 0.5 },
      { kind: 'ramp', duration: min(6), from: 0.55, to: 0.4 },
    ],
  },
  {
    id: 'builtin-over-unders',
    name: 'Over-Unders 3×9',
    description: 'Threshold surges: 2 min just under FTP, 1 min just over, ×3, three sets.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.5, to: 0.75 },
      { kind: 'intervals', repeats: 3, onDuration: min(2), onPower: 0.95, offDuration: min(1), offPower: 1.05 },
      { kind: 'steady', duration: min(4), power: 0.55 },
      { kind: 'intervals', repeats: 3, onDuration: min(2), onPower: 0.95, offDuration: min(1), offPower: 1.05 },
      { kind: 'steady', duration: min(4), power: 0.55 },
      { kind: 'intervals', repeats: 3, onDuration: min(2), onPower: 0.95, offDuration: min(1), offPower: 1.05 },
      { kind: 'ramp', duration: min(6), from: 0.55, to: 0.4 },
    ],
  },
  {
    id: 'builtin-ramp-test',
    name: 'Ramp FTP Test',
    description: 'Power climbs 6 % of FTP every minute until you can’t hold it. Estimated FTP = 75 % of your best minute.',
    source: 'builtin',
    blocks: [
      { kind: 'steady', duration: min(5), power: 0.45 },
      ...Array.from({ length: 22 }, (_, i): Block => ({ kind: 'steady', duration: 60, power: 0.5 + i * 0.06 })),
    ],
  },
];

export const RAMP_TEST_ID = 'builtin-ramp-test';

/** Colour for a fraction of FTP, matching the power-zone colours in the HUD. */
export function zoneColor(ratio: number) {
  if (ratio < 0.55) return '#9aa5b1';
  if (ratio < 0.75) return '#3e8ed0';
  if (ratio < 0.9) return '#48c774';
  if (ratio < 1.05) return '#f2c14e';
  if (ratio < 1.2) return '#f08a4b';
  return '#e5383b';
}
