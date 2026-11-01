import type { Page } from '@playwright/test';

// Neon Auth and the Data API are unreachable (and not wanted) in tests: answer them locally.
// `signedIn: false` is a guest (no session, empty tables). `signedIn: true` is a rider with rides,
// an FTP history, a plan, a garage wallet and this week's challenges, so the hub has things to show.

/** Neon Auth sends cookies, so the browser wants the page's own origin (not *) and credentials allowed. */
const cors = (origin: string | undefined) => ({
  'access-control-allow-origin': origin ?? '*',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': origin ? 'content-type, authorization, prefer, accept-profile, content-profile, x-neon-auth-token' : '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
});

const DAY = 86400000;

/** Rides spread over the last weeks, newest first. */
export function sampleRides(now = Date.now()) {
  const ride = (n: number, daysAgo: number, over: Record<string, unknown> = {}) => ({
    id: `ride-${n}`,
    started_at: new Date(now - daysAgo * DAY - 3600000).toISOString(),
    title: 'Heartland Rollers',
    stage_id: 'heartland',
    stage_name: 'Heartland Rollers',
    finished: false,
    workout_name: null,
    duration_s: 3000,
    distance_m: 24000,
    climbed_m: 180,
    avg_power: 190,
    np: 205,
    max_power: 640,
    avg_hr: 142,
    max_hr: 171,
    avg_cadence: 88,
    kj: 570,
    tss: 52,
    ftp: 245,
    best_power: { '5': 700, '60': 380, '300': 290, '1200': 245 },
    hr_zones: null,
    power_zones: null,
    max_hr_setting: 185,
    finish_s: null,
    race_place: null,
    race_size: null,
    pro_m: null,
    ...over,
  });
  return [
    ride(1, 0.2, { title: 'Sweet Spot 3×10 · Heartland Rollers', workout_name: 'Sweet Spot 3×10', duration_s: 3900, distance_m: 31000, tss: 78 }),
    ride(2, 2, { title: "Alpe d'Huez", stage_id: 'alpe-dhuez', stage_name: "Alpe d'Huez", finished: true, finish_s: 3300, duration_s: 3300, distance_m: 14000, climbed_m: 1118, avg_power: 262, tss: 96 }),
    ride(3, 4, { title: 'Route 66 Flats', stage_id: 'route66', stage_name: 'Route 66 Flats', finished: true, finish_s: 2210, duration_s: 2210, distance_m: 25000, climbed_m: 140, avg_power: 248, tss: 61 }),
    ride(4, 8),
    ride(5, 11, { title: 'Endurance 45 · Heartland Rollers', workout_name: 'Endurance 45', duration_s: 2700, distance_m: 21000 }),
    ride(6, 15),
    ride(7, 19, { title: 'Ramp FTP Test · Heartland Rollers', workout_name: 'Ramp FTP Test', duration_s: 1700, distance_m: 14000 }),
    ride(8, 27),
    ride(9, 40),
    ride(10, 60),
  ];
}

export async function mockNeon(page: Page, opts: { signedIn?: boolean } = {}) {
  const signedIn = !!opts.signedIn;
  const now = Date.now();
  const startsAt = (hours: number) => new Date(now + hours * 3600000).toISOString();

  await page.route(/neonauth|apirest/, (route) => {
    const req = route.request();
    const CORS: Record<string, string> = cors(req.headers()['origin']);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*' } });
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const path = new URL(req.url()).pathname;

    if (/neonauth/.test(req.url())) {
      if (/\/get-session$/.test(path) && signedIn) {
        // The Data API wants a JWT: Neon Auth hands it over in this header. This one is unsigned and only has to look right.
        const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const jwt = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u-test', exp: Math.floor((now + 7 * DAY) / 1000) })}.test`;
        CORS['access-control-expose-headers'] = 'set-auth-jwt';
        return route.fulfill({ status: 200, headers: { ...CORS, 'set-auth-jwt': jwt, 'content-type': 'application/json' }, body: JSON.stringify({
          session: { id: 's1', userId: 'u-test', expiresAt: new Date(now + 7 * DAY).toISOString() },
          user: { id: 'u-test', name: 'Sam Rider', email: 'sam@example.com', emailVerified: true, image: null },
        }) });
      }
      return json(null);
    }

    if (!signedIn) return json([]);
    const table = path.split('/rest/v1/')[1] ?? '';
    if (req.method() !== 'GET' && !table.startsWith('rpc/')) return json([]);
    switch (table) {
      case 'profiles':
        return json({ settings: { ftp: 245, riderKg: 72, units: 'metric', plan: { id: 'ftp-builder', started: '2026-10-20', done: [0, 1, 2, 3] } } });
      case 'activities':
        return json(sampleRides(now));
      case 'ftp_history':
        return json([
          { ftp: 215, source: 'signup', recorded_at: new Date(now - 90 * DAY).toISOString() },
          { ftp: 230, source: 'ramp_test', recorded_at: new Date(now - 45 * DAY).toISOString() },
          { ftp: 245, source: 'ramp_test', recorded_at: new Date(now - 19 * DAY).toISOString() },
        ]);
      case 'rpc/my_wallet':
        return json({ level: 7, xp: 2400, xp_this: 2000, xp_next: 3000, credits_earned: 1500, credits_spent: 260, balance: 1240, km: 412, climbed_m: 8420, rides: 23, challenges_done: 2, owned: ['frame-classic', 'wheels-alloy35', 'tyres-standard', 'helmet-standard', 'jersey-plain', 'socks-white'] });
      case 'rpc/my_challenges':
        return json({
          week: '2026-W44',
          ends_at: startsAt(80),
          challenges: [
            { id: 'climb-1000', title: 'Climb 1,000 m', metric: 'climbed_m', target: 1000, reward: 80, progress: 1180, claimed: false },
            { id: 'ride-50', title: 'Ride 50 km', metric: 'km', target: 50, reward: 80, progress: 31, claimed: false },
            { id: 'stages-1', title: 'Finish a stage', metric: 'stages', target: 1, reward: 50, progress: 1, claimed: true },
            { id: 'days-4', title: 'Ride on 4 different days', metric: 'days', target: 4, reward: 100, progress: 2, claimed: false },
          ],
        });
      case 'rpc/server_now':
        return json(new Date().toISOString());
      case 'rpc/upcoming_events':
        return json([
          { id: 'ev-race', kind: 'race', stage_id: 'alpe-dhuez', title: "Evening race: Alpe d'Huez", starts_at: startsAt(3), seed: 11, pace_wkg: null, duration_min: 150, waiting: 4, results: 0, my_finish_s: null },
          { id: 'ev-ride', kind: 'group_ride', stage_id: 'heartland', title: 'Group ride: Heartland Rollers, 2.6 W/kg', starts_at: startsAt(20), seed: 12, pace_wkg: 2.6, duration_min: 90, waiting: 0, results: 0, my_finish_s: null },
        ]);
      case 'rpc/is_admin':
        return json(false);
      default:
        return json(table.startsWith('rpc/') ? null : []);
    }
  });
}
