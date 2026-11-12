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

export const WORKOUT_LIMITS = {
  duration: 24 * 3600,
  repeats: 1000,
  blocks: 10000,
  steps: 10000,
  power: 10,
  cadence: 300,
} as const;

function boundedNumber(value: number, label: string, max: number) {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a finite number between 0 and ${max}.`);
  }
}

function validateBlocks(blocks: Block[]) {
  if (!Array.isArray(blocks) || blocks.length > WORKOUT_LIMITS.blocks) {
    throw new Error(`A workout can contain at most ${WORKOUT_LIMITS.blocks} blocks.`);
  }
  let duration = 0, steps = 0;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') throw new Error('Invalid workout block.');
    if ('cadence' in b && b.cadence !== undefined) boundedNumber(b.cadence, 'Cadence', WORKOUT_LIMITS.cadence);
    switch (b.kind) {
      case 'steady':
        boundedNumber(b.power, 'Power (fraction of FTP)', WORKOUT_LIMITS.power);
        boundedNumber(b.duration, 'Block duration (seconds)', WORKOUT_LIMITS.duration);
        duration += b.duration;
        steps++;
        break;
      case 'ramp':
        boundedNumber(b.from, 'Ramp start power', WORKOUT_LIMITS.power);
        boundedNumber(b.to, 'Ramp end power', WORKOUT_LIMITS.power);
        boundedNumber(b.duration, 'Block duration (seconds)', WORKOUT_LIMITS.duration);
        duration += b.duration;
        steps++;
        break;
      case 'intervals':
        if (!Number.isInteger(b.repeats) || b.repeats < 1 || b.repeats > WORKOUT_LIMITS.repeats) {
          throw new Error(`Interval repeats must be a whole number between 1 and ${WORKOUT_LIMITS.repeats}.`);
        }
        boundedNumber(b.onDuration, 'On duration (seconds)', WORKOUT_LIMITS.duration);
        boundedNumber(b.offDuration, 'Off duration (seconds)', WORKOUT_LIMITS.duration);
        boundedNumber(b.onPower, 'On power', WORKOUT_LIMITS.power);
        boundedNumber(b.offPower, 'Off power', WORKOUT_LIMITS.power);
        duration += b.repeats * (b.onDuration + b.offDuration);
        steps += 2 * b.repeats;
        break;
      case 'free':
        boundedNumber(b.duration, 'Block duration (seconds)', WORKOUT_LIMITS.duration);
        duration += b.duration;
        steps++;
        break;
      default:
        throw new Error('Unknown workout block type.');
    }
    if (duration > WORKOUT_LIMITS.duration) throw new Error('A workout cannot last longer than 24 hours.');
    if (steps > WORKOUT_LIMITS.steps) throw new Error(`A workout can expand to at most ${WORKOUT_LIMITS.steps} steps.`);
  }
  return duration;
}

/** Validates imports, saved data and creator drafts without expanding intervals. */
export function validateWorkout(w: Workout): void {
  if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id.trim() || w.id.length > 200 ||
      typeof w.name !== 'string' || !w.name.trim() || w.name.length > 500 ||
      typeof w.description !== 'string' || w.description.length > 10000 ||
      !['builtin', 'uploaded', 'custom'].includes(w.source)) {
    throw new Error('Invalid workout id, name, description or source.');
  }
  if (!validateBlocks(w.blocks)) throw new Error('A workout needs at least one timed step.');
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
  validateBlocks(blocks);
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
  if (!Array.isArray(steps) || steps.length > WORKOUT_LIMITS.steps) {
    throw new Error(`A workout can contain at most ${WORKOUT_LIMITS.steps} steps.`);
  }
  let T = 0;
  for (const s of steps) {
    if (!s || typeof s !== 'object') throw new Error('Invalid workout step.');
    boundedNumber(s.at, 'Step start time', WORKOUT_LIMITS.duration);
    boundedNumber(s.duration, 'Step duration (seconds)', WORKOUT_LIMITS.duration);
    boundedNumber(s.start, 'Step start power', WORKOUT_LIMITS.power);
    boundedNumber(s.end, 'Step end power', WORKOUT_LIMITS.power);
    if (s.at !== T || s.duration === 0 || typeof s.free !== 'boolean') throw new Error('Workout steps must be contiguous and have positive durations.');
    T += s.duration;
    if (T > WORKOUT_LIMITS.duration) throw new Error('A workout cannot last longer than 24 hours.');
  }
  if (!T) return 0;
  let p4 = 0, i = 0;
  for (let t = 0; t < T; t++) {
    while (i < steps.length - 1 && t >= steps[i].at + steps[i].duration) i++;
    const s = steps[i];
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
  {
    id: 'builtin-recovery-30',
    name: 'Recovery Spin 30',
    description: 'Easy spinning to recover: 30 minutes around 50 % FTP.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(5), from: 0.4, to: 0.5 },
      { kind: 'steady', duration: min(22), power: 0.52, cadence: 95 },
      { kind: 'ramp', duration: min(3), from: 0.5, to: 0.4 },
    ],
  },
  {
    id: 'builtin-tempo-2x20',
    name: 'Tempo 2×20',
    description: 'Two 20-minute tempo blocks at 80 % FTP: the engine for long climbs.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.5, to: 0.75 },
      { kind: 'intervals', repeats: 2, onDuration: min(20), onPower: 0.8, offDuration: min(5), offPower: 0.55 },
      { kind: 'ramp', duration: min(5), from: 0.6, to: 0.4 },
    ],
  },
  {
    id: 'builtin-threshold-2x15',
    name: 'Threshold 2×15',
    description: 'Two 15-minute efforts at 97 % FTP. Hard, steady, and the best way to lift your FTP.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.5, to: 0.8 },
      { kind: 'intervals', repeats: 3, onDuration: 30, onPower: 1.1, offDuration: 60, offPower: 0.55 },
      { kind: 'intervals', repeats: 2, onDuration: min(15), onPower: 0.97, offDuration: min(6), offPower: 0.5 },
      { kind: 'ramp', duration: min(6), from: 0.55, to: 0.4 },
    ],
  },
  {
    id: 'builtin-endurance-75',
    name: 'Endurance 75',
    description: 'A long zone-2 ride with three short tempo lifts to keep it lively.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.45, to: 0.65 },
      { kind: 'steady', duration: min(15), power: 0.68 },
      { kind: 'steady', duration: min(5), power: 0.8 },
      { kind: 'steady', duration: min(12), power: 0.68 },
      { kind: 'steady', duration: min(5), power: 0.8 },
      { kind: 'steady', duration: min(12), power: 0.68 },
      { kind: 'steady', duration: min(5), power: 0.8 },
      { kind: 'ramp', duration: min(11), from: 0.65, to: 0.4 },
    ],
  },
  {
    id: 'builtin-openers-30',
    name: 'Openers 30',
    description: 'Short and sharp, the day before a big ride: a few hard bursts to wake the legs.',
    source: 'builtin',
    blocks: [
      { kind: 'ramp', duration: min(10), from: 0.45, to: 0.7 },
      { kind: 'intervals', repeats: 3, onDuration: min(1), onPower: 1.05, offDuration: min(2), offPower: 0.55 },
      { kind: 'intervals', repeats: 3, onDuration: 15, onPower: 1.5, offDuration: 105, offPower: 0.5 },
      { kind: 'ramp', duration: min(5), from: 0.55, to: 0.4 },
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
