// Training plans: a few weeks of sessions, each a built-in workout or a
// stage to ride. Progress (which plan, which sessions are done) lives in the
// rider's settings, so it follows a signed-in rider between devices.

export interface Session {
  title: string;
  workout?: string; // built-in workout id
  stage?: string; // stage id: ride it to the finish
  note: string;
}

export interface Plan {
  id: string;
  name: string;
  level: string;
  description: string;
  weeks: Session[][];
}

export interface PlanProgress {
  id: string;
  started: string; // ISO date
  done: number[]; // indexes into the flattened list of sessions
}

const W = {
  endurance: 'builtin-endurance-45',
  endurance75: 'builtin-endurance-75',
  sweetSpot: 'builtin-sweet-spot-3x10',
  vo2: 'builtin-vo2-5x3',
  overUnders: 'builtin-over-unders',
  ramp: 'builtin-ramp-test',
  recovery: 'builtin-recovery-30',
  tempo: 'builtin-tempo-2x20',
  threshold: 'builtin-threshold-2x15',
  openers: 'builtin-openers-30',
};

const s = (title: string, note: string, target: { workout?: string; stage?: string }): Session => ({ title, note, ...target });

export const PLANS: Plan[] = [
  {
    id: 'get-started',
    name: 'Get Started',
    level: 'Beginner · 3 weeks · 3 rides a week',
    description: 'New to indoor riding? Easy rides to learn the bike, the app and your numbers, finishing with your first real climb.',
    weeks: [
      [
        s('Ramp FTP Test', 'Find your FTP so every workout is set at the right effort.', { workout: W.ramp }),
        s('Heartland free ride', 'Ride 30 minutes on the rollers at a pace you could chat at.', { stage: 'heartland' }),
        s('Endurance 45', 'Steady zone 2. Smooth pedalling, relaxed shoulders.', { workout: W.endurance }),
      ],
      [
        s('Recovery Spin 30', 'Easy legs. This is training too.', { workout: W.recovery }),
        s('Sweet Spot 3×10', 'Your first intervals: comfortably hard, not all-out.', { workout: W.sweetSpot }),
        s('Route 66 Flats', '25 km time trial. Find a pace you can hold to the end.', { stage: 'route66' }),
      ],
      [
        s('Endurance 45', 'Aerobic base. Keep it steady.', { workout: W.endurance }),
        s('Tempo 2×20', 'Long, steady efforts: what climbing feels like.', { workout: W.tempo }),
        s("Alpe d'Huez", 'Your first mountain: 21 hairpins. Pace the first 5 km gently.', { stage: 'alpe-dhuez' }),
      ],
    ],
  },
  {
    id: 'ftp-builder',
    name: 'FTP Builder',
    level: 'Intermediate · 6 weeks · 3–4 rides a week',
    description: 'Lift your threshold power: sweet spot and threshold work building week by week, an easy week to absorb it, and a retest at the end.',
    weeks: [
      [
        s('Ramp FTP Test', 'Your starting point.', { workout: W.ramp }),
        s('Sweet Spot 3×10', '90 % FTP. Settle in.', { workout: W.sweetSpot }),
        s('Endurance 45', 'Zone 2.', { workout: W.endurance }),
      ],
      [
        s('Sweet Spot 3×10', 'Same again, a little smoother.', { workout: W.sweetSpot }),
        s('Tempo 2×20', 'Time at tempo builds the engine.', { workout: W.tempo }),
        s('Endurance 75', 'Long and steady.', { workout: W.endurance75 }),
      ],
      [
        s('Over-Unders 3×9', 'Teach your legs to clear lactate.', { workout: W.overUnders }),
        s('Sweet Spot 3×10', 'Keep the cadence up.', { workout: W.sweetSpot }),
        s('Threshold 2×15', 'Right at FTP. Hard but steady.', { workout: W.threshold }),
        s('Endurance 75', 'Easy miles.', { workout: W.endurance75 }),
      ],
      [
        s('Recovery Spin 30', 'Easy week: let the work sink in.', { workout: W.recovery }),
        s('Endurance 45', 'Zone 2 only.', { workout: W.endurance }),
        s('Openers 30', 'A few sharp efforts to stay fresh.', { workout: W.openers }),
      ],
      [
        s('Threshold 2×15', 'Back to work.', { workout: W.threshold }),
        s('VO2 Max 5×3', 'Raise the ceiling.', { workout: W.vo2 }),
        s('Over-Unders 3×9', 'Threshold surges.', { workout: W.overUnders }),
        s('Stelvio Pass', 'Put it together on a 24 km climb.', { stage: 'stelvio' }),
      ],
      [
        s('Recovery Spin 30', 'Freshen up before the test.', { workout: W.recovery }),
        s('Openers 30', 'Wake the legs.', { workout: W.openers }),
        s('Ramp FTP Test', 'See how far you’ve come, and set your new FTP.', { workout: W.ramp }),
      ],
    ],
  },
  {
    id: 'hell-of-the-west',
    name: 'Hell of the West',
    level: 'All levels · 4 weeks · 3–4 rides a week',
    description: 'Train like the film: long tempo, climbing and race efforts, building to the final stage from Idaho Springs to Echo Lake.',
    weeks: [
      [
        s('Ramp FTP Test', 'Know your numbers before the race.', { workout: W.ramp }),
        s('Tempo 2×20', 'The pace of a long mountain stage.', { workout: W.tempo }),
        s('Heartland free ride', 'An hour of steady rolling miles.', { stage: 'heartland' }),
      ],
      [
        s('Sweet Spot 3×10', 'Climbing power.', { workout: W.sweetSpot }),
        s('Over-Unders 3×9', 'Practise surging on a climb, then settling back in.', { workout: W.overUnders }),
        s('Col du Tourmalet', '19 km of steady climbing.', { stage: 'tourmalet' }),
      ],
      [
        s('Threshold 2×15', 'Race pace.', { workout: W.threshold }),
        s('VO2 Max 5×3', 'For the attacks.', { workout: W.vo2 }),
        s('Endurance 75', 'Long and steady.', { workout: W.endurance75 }),
        s('Mont Ventoux', 'The Giant of Provence: practise pacing a long, hard climb.', { stage: 'ventoux' }),
      ],
      [
        s('Recovery Spin 30', 'Race week: rest is training.', { workout: W.recovery }),
        s('Openers 30', 'The day before. Short and sharp.', { workout: W.openers }),
        s('Hell of the West', 'The final stage. Steady up Chicago Creek, then everything you have left in the sprint at Echo Lake.', { stage: 'hell-of-the-west' }),
      ],
    ],
  },
];

export function planById(id: string | undefined | null) {
  return PLANS.find((p) => p.id === id) ?? null;
}

/** Every session in order, with its week number. */
export function sessions(plan: Plan) {
  return plan.weeks.flatMap((week, w) => week.map((session) => ({ ...session, week: w + 1 })));
}

/** The first session not yet done (null when the plan is complete). */
export function nextSession(plan: Plan, progress: PlanProgress) {
  const all = sessions(plan);
  const i = all.findIndex((_, k) => !progress.done.includes(k));
  return i < 0 ? null : { ...all[i], index: i };
}

/**
 * Marks the next matching session done after a workout or stage finish.
 * Returns the updated progress, or null if nothing in the plan matched.
 */
export function complete(plan: Plan, progress: PlanProgress, what: { workout?: string; stage?: string }): PlanProgress | null {
  const all = sessions(plan);
  const i = all.findIndex((x, k) => !progress.done.includes(k) && ((what.workout && x.workout === what.workout) || (what.stage && x.stage === what.stage)));
  if (i < 0) return null;
  return { ...progress, done: [...progress.done, i].sort((a, b) => a - b) };
}
