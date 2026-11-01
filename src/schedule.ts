// The daily event schedule, as a pure function. The database does the real
// scheduling (upcoming_events() in db/schema.sql creates the same events on its
// own), but this mirror lets the Events dialog show what is on before you sign
// in, and gives the rotation a unit test. Keep the pool, the hours and the
// rotation rule in step with the SQL.

export interface PoolStage { id: string; name: string; lengthM: number }

/** The stages the evening race rotates through, in order (event_stage_pool in the database). */
export const EVENT_STAGE_POOL: PoolStage[] = [
  { id: 'hotw-morgul-bismark', name: 'Morgul-Bismark', lengthM: 42263 },
  { id: 'alpe-dhuez', name: 'Alpe d\'Huez', lengthM: 14000 },
  { id: 'hotw-tour-of-the-moon', name: 'Tour of the Moon', lengthM: 37000 },
  { id: 'stelvio', name: 'Stelvio Pass', lengthM: 24500 },
  { id: 'route66', name: 'Route 66 Flats', lengthM: 25000 },
  { id: 'ventoux', name: 'Mont Ventoux', lengthM: 21400 },
  { id: 'hell-of-the-west', name: 'Echo Lake', lengthM: 20800 },
  { id: 'tourmalet', name: 'Col du Tourmalet', lengthM: 19000 },
  { id: 'zoncolan', name: 'Monte Zoncolan', lengthM: 10100 },
];

export const RACE_HOUR_UTC = 19.5; // 19:30 UTC every day
export const RIDE_HOUR_UTC = 12.5; // 12:30 UTC every day
export const GROUP_RIDE_STAGE = 'heartland';
export const GROUP_RIDE_WKG = 2.6;
export const RACE_MINUTES = 150; // how long a race stays open for results
export const RIDE_MINUTES = 90;

export type EventKind = 'race' | 'group_ride';

export interface ScheduledEvent {
  kind: EventKind;
  stageId: string;
  title: string;
  startsAt: number; // ms since the epoch
  paceWkg: number | null;
}

const DAY = 86400000;

/** The stage the evening race uses on the UTC day that starts at `dayStartMs`. */
export function raceStageForDay(dayStartMs: number): PoolStage {
  const idx = Math.floor(dayStartMs / DAY);
  const n = EVENT_STAGE_POOL.length;
  return EVENT_STAGE_POOL[((idx % n) + n) % n];
}

/** Events starting from 3 hours ago to `hours` ahead of `nowMs`, in order. */
export function dailySchedule(nowMs: number, hours = 48): ScheduledEvent[] {
  const day0 = Math.floor(nowMs / DAY) * DAY;
  const from = nowMs - 12 * 3600000; // the dialog shows the last 12 hours too
  const to = nowMs + hours * 3600000;
  const out: ScheduledEvent[] = [];
  for (let i = -1; i <= Math.floor(hours / 24) + 1; i++) {
    const d = day0 + i * DAY;
    const stage = raceStageForDay(d);
    const race = d + RACE_HOUR_UTC * 3600000;
    const ride = d + RIDE_HOUR_UTC * 3600000;
    if (race > from && race < to) out.push({ kind: 'race', stageId: stage.id, title: `Evening race: ${stage.name}`, startsAt: race, paceWkg: null });
    if (ride > from && ride < to) {
      out.push({ kind: 'group_ride', stageId: GROUP_RIDE_STAGE, title: `Group ride: Heartland Rollers, ${GROUP_RIDE_WKG} W/kg`, startsAt: ride, paceWkg: GROUP_RIDE_WKG });
    }
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

/** "starts in 4:32", "starts in 2 h 10 min", "started 3 min ago". `ms` is start minus now. */
export function countdownLabel(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  if (ms <= 0) {
    if (s < 60) return 'starting now';
    return `started ${s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`} ago`;
  }
  if (s < 3600) return `starts in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s < 86400) return `starts in ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `starts in ${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

/** The presence stage key riders in an event share: only they see each other. */
export function eventStageKey(stageId: string, eventId: string): string {
  return `${stageId}#event-${eventId}`.slice(0, 80);
}

/** Can you still join? From an hour before the start until the race is 5 minutes old (rides: until 20 minutes in). */
export function joinState(kind: EventKind, startsAtMs: number, nowMs: number): 'early' | 'open' | 'late' {
  const until = nowMs - startsAtMs; // seconds since start, in ms
  if (until < -3600000) return 'early';
  if (until > (kind === 'race' ? 5 : 20) * 60000) return 'late';
  return 'open';
}
