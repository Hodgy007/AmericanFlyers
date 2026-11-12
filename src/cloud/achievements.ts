// Achievements, worked out from a rider's saved activities and FTP history.

import type { EffortLogRow } from './segmentApi';
import type { Activity, FtpEntry } from './sync';

export interface Achievement {
  icon: string;
  name: string;
  description: string;
  done: boolean;
  progress: number; // 0–1
  detail: string; // "340 / 500 km" or the date it was earned
}

const RAMP_TEST_NAME = 'Ramp FTP Test';

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Longest run of consecutive calendar days with a ride. */
function longestDayStreak(acts: Activity[]) {
  const days = [...new Set(acts.map((a) => dayKey(new Date(a.started_at))))]
    .map((k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m, d).getTime(); })
    .sort((a, b) => a - b);
  let best = 0, run = 0, prev = -Infinity;
  for (const t of days) {
    run = Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

/** Longest run of consecutive ISO weeks with at least one ride. */
function longestWeekStreak(acts: Activity[]) {
  const weeks = [...new Set(acts.map((a) => weekIndex(new Date(a.started_at))))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = -Infinity;
  for (const w of weeks) {
    run = w - prev === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = w;
  }
  return best;
}

/** Weeks since 1970 (weeks start on Monday). */
export function weekIndex(d: Date) {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.floor((day / 86400000 + 3) / 7); // 1970-01-01 was a Thursday
}

export function achievements(acts: Activity[], ftp: FtpEntry[], riderKg: number, efforts: EffortLogRow[] = []): Achievement[] {
  const chrono = [...acts].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const list: Achievement[] = [];
  const date = (a: Activity | undefined) => (a ? `Earned ${new Date(a.started_at).toLocaleDateString()}` : '');

  /** An achievement earned by the first activity that passes `test`. */
  const first = (icon: string, name: string, description: string, test: (a: Activity) => boolean) => {
    const a = chrono.find(test);
    list.push({ icon, name, description, done: !!a, progress: a ? 1 : 0, detail: a ? date(a) : 'Not yet' });
  };

  /** A running total that has to reach `goal`; earned by the ride that crossed it. */
  const total = (icon: string, name: string, description: string, goal: number, value: (a: Activity) => number, unit: string, scale = 1) => {
    let sum = 0;
    let when: Activity | undefined;
    for (const a of chrono) {
      sum += value(a);
      if (!when && sum >= goal) when = a;
    }
    const shown = (v: number) => Math.floor(v / scale).toLocaleString();
    list.push({ icon, name, description, done: !!when, progress: Math.min(1, sum / goal), detail: when ? date(when) : `${shown(sum)} / ${shown(goal)} ${unit}` });
  };

  const counted = (icon: string, name: string, description: string, goal: number, n: number, unit: string) => {
    list.push({ icon, name, description, done: n >= goal, progress: Math.min(1, n / goal), detail: n >= goal ? 'Earned' : `${n} / ${goal} ${unit}` });
  };

  first('🚴', 'First pedal strokes', 'Save your first ride.', () => true);
  first('⏱', 'Hour of power', 'Ride for an hour in one go.', (a) => a.duration_s >= 3600);
  first('🏁', 'Route 66 time-trial', 'Finish the Route 66 Flats stage.', (a) => a.finished && a.stage_id === 'route66');
  first('⛰', "Alpe d'Huez", "Conquer all 21 hairpins of Alpe d'Huez.", (a) => a.finished && a.stage_id === 'alpe-dhuez');
  first('🏔', 'Stelvio', 'Reach the top of the Passo dello Stelvio.', (a) => a.finished && a.stage_id === 'stelvio');
  first('🌫', 'Mount Washington', 'Reach the summit of New England up the Auto Road.', (a) => a.finished && a.stage_id === 'mt-washington');
  first('🦅', 'Mount Blue Sky', 'Ride to 14,130 feet on the highest paved road in North America.', (a) => a.finished && a.stage_id === 'mt-blue-sky');
  first('🌅', 'Mount Diablo', 'Climb Mount Diablo from Danville to the summit tower.', (a) => a.finished && a.stage_id === 'mt-diablo');
  first('🌲', 'Flagstaff', 'Climb Flagstaff Road above Boulder.', (a) => a.finished && a.stage_id === 'flagstaff');
  first('🧱', 'Richmond Worlds', 'Finish the 2015 World Championships circuit in Richmond: both laps over the cobbles of Libby Hill and 23rd Street.', (a) => a.finished && a.stage_id === 'richmond-worlds');
  first('🗽', 'Central Park', 'Ride three laps of Central Park’s Park Drive, up Harlem Hill each time.', (a) => a.finished && a.stage_id === 'central-park');
  first('🫖', 'Harrogate Worlds', 'Finish the 2019 World Championships circuit in Harrogate, over the Oak Beck climb and up Parliament Street.', (a) => a.finished && a.stage_id === 'harrogate-worlds');
  first('🌊', 'Pacific Coast', 'Ride California Highway 1 through Big Sur, over Bixby Creek Bridge, to Big Sur village.', (a) => a.finished && a.stage_id === 'pacific-coast');
  first('🪨', 'Vale Loop', 'Ride a full lap of Kestrel Vale: the lake, Raven Scar and the cutting at Raven Gap.', (a) => a.finished && a.stage_id === 'kestrel-vale-loop');
  first('🧗', 'Raven Scar', 'Ride the Raven Scar route: up the five hairpins to the cutting at Raven Gap.', (a) => a.finished && a.stage_id === 'kestrel-vale-raven-scar');
  first('🚤', 'Lakeside Sprint', 'Finish the Lakeside Sprint: Beck Lane, the village and Kestrel Water to Mill Bridge.', (a) => a.finished && a.stage_id === 'kestrel-vale-lakeside');
  first('🏞', 'Grand Vale', 'Finish three laps of Kestrel Vale, over Raven Scar each time.', (a) => a.finished && a.stage_id === 'kestrel-vale-grand');
  first('🧪', 'Tested', 'Complete a ramp FTP test.', (a) => a.workout_name === RAMP_TEST_NAME);
  first('⚡', 'Sprinter', 'Hold 800 W for 5 seconds.', (a) => (a.best_power?.['5'] ?? 0) >= 800);
  first('🔥', 'Four watts', `Hold 4 W/kg for 20 minutes (${Math.round(riderKg * 4)} W at ${riderKg} kg).`, (a) => (a.best_power?.['1200'] ?? 0) >= riderKg * 4);
  first('💯', 'Century', 'Ride 100 km in one go.', (a) => a.distance_m >= 100000);

  total('🛣', 'Coast to coast', 'Ride 500 km in total.', 500000, (a) => a.distance_m, 'km', 1000);
  total('🌎', 'Round the block', 'Ride 2,000 km in total.', 2000000, (a) => a.distance_m, 'km', 1000);
  total('🧗', 'Everesting', 'Climb 8,849 m in total, the height of Everest.', 8849, (a) => a.climbed_m, 'm');
  total('🕰', 'Saddle time', 'Ride for 24 hours in total.', 86400, (a) => a.duration_s, 'h', 3600);

  const workouts = acts.filter((a) => a.workout_name).length;
  counted('🏋', 'Workout regular', 'Complete 10 workouts.', 10, workouts, 'workouts');
  counted('📆', 'Three in a row', 'Ride on 3 days in a row.', 3, longestDayStreak(acts), 'days');
  counted('🗓', 'Consistency', 'Ride every week for 4 weeks.', 4, longestWeekStreak(acts), 'weeks');

  // KOM segments (src/segments.ts): every whole climb you have been timed up.
  const timed = [...efforts].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const earned = (e: EffortLogRow | undefined) => (e ? `Earned ${new Date(e.created_at).toLocaleDateString()}` : '');
  const firstEffort = timed[0];
  list.push({ icon: '⛰', name: 'Hill climber', description: 'Ride all of a KOM segment, a big climb timed from its start to its top.', done: !!firstEffort, progress: firstEffort ? 1 : 0, detail: firstEffort ? earned(firstEffort) : 'Not yet' });
  const bestSoFar = new Map<string, number>();
  let pb: EffortLogRow | undefined;
  for (const e of timed) {
    const before = bestSoFar.get(e.segment_id);
    if (before !== undefined && e.elapsed_s < before && !pb) pb = e;
    if (before === undefined || e.elapsed_s < before) bestSoFar.set(e.segment_id, e.elapsed_s);
  }
  list.push({ icon: '📈', name: 'Beat yourself', description: 'Set a personal best on a KOM segment you have ridden before.', done: !!pb, progress: pb ? 1 : 0, detail: pb ? earned(pb) : 'Not yet' });
  counted('🗻', 'Segment collector', 'Ride 5 different KOM segments.', 5, bestSoFar.size, 'segments');

  const gain = ftp.length ? ftp[ftp.length - 1].ftp - ftp[0].ftp : 0;
  counted('📈', 'Getting stronger', 'Raise your FTP by 10 W from your first recorded value.', 10, Math.max(0, gain), 'W');

  return list;
}
