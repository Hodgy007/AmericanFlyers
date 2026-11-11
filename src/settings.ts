import type { PlanProgress } from './plans';
import type { Kit } from './kit';
import type { TourProgress } from './tour';
import type { Loadout } from './garage/catalogue';

export type Units = 'metric' | 'imperial';
export type TimeOfDay = 'auto' | 'dawn' | 'day' | 'dusk' | 'night';
export type Weather = 'auto' | 'clear' | 'cloudy' | 'rain';

/** Bumped when a saved setting needs a one-off fix (see `migrateSettings`). */
export const SETTINGS_VERSION = 2;

export interface Settings {
  settingsVersion: number; // which migrations this copy has had; a copy without it predates the ride-mode choice (version 2)
  riderKg: number;
  bikeKg: number;
  ftp: number;
  maxHr: number; // beats per minute, for heart-rate zones
  units: Units;
  difficulty: number; // 0–100, percentage of road grade sent to the trainer
  dataFields: string[]; // data blocks shown across the top, in order
  rideTogether: boolean; // see, and be seen by, other riders on the same stage
  ghost: boolean; // race the ghost of your best ride on the stage
  sound: boolean; // wind, crowds, beeps
  music: boolean; // the theme tune and the riding score (src/music.ts); also needs sound on
  virtualShifting: boolean; // choose your gear; the trainer's resistance follows it
  plan: PlanProgress | null; // the training plan being followed
  hudPosition: 'left' | 'center' | 'right'; // where the data blocks sit
  proTeams: boolean; // the ride mode "With pro teams": computer-ridden pro teams on the road (off = Solo; Race is chosen per ride, never stored)
  powerMatch: boolean; // ERG with a separate power meter: nudge the trainer's target so the meter's watts sit on it (ble/powerMatch.ts)
  autoSteer: boolean; // ease into the draft of a rider just ahead when you haven't steered
  timeOfDay: TimeOfDay; // 'auto' starts at the stage's usual time and slowly moves on
  weather: Weather; // 'auto' uses the stage's weather, changing now and then
  kit: Kit | null; // your jersey and bike colours (null = the default stars and stripes)
  tour: TourProgress | null; // the Hell of the West tour in progress
  wind: boolean; // wind on the road: headwinds slow you, crosswinds make echelons (world/wind.ts)
  miniMap: boolean; // the route mini-map and climb preview (miniMap.ts, climbUi.ts)
  komPanel: boolean; // the KOM segment panel: leaderboard and live gap on big climbs (segmentUi.ts)
  commentary: boolean; // the race commentator's voice lines (commentary.ts); also needs sound on
  loadout: Partial<Loadout> | null; // what you ride and wear from the garage (src/garage); null = the starter kit
  // ---- AI coach and rivals (src/ai/): opt-in; the database holds the real consent (ai_consent), these mirror it ----
  aiCoach: boolean; // Coach Marty: ride tips and a debrief after each ride
  aiRivals: boolean; // AI rivals write fresh lines and remember your rides together
  coachVoice: boolean; // speak the coach's and rivals' lines aloud
}

const KEY = 'americanflyers.settings';

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: SETTINGS_VERSION,
  riderKg: 75,
  bikeKg: 8,
  ftp: 200,
  maxHr: 185,
  units: 'metric',
  difficulty: 50,
  dataFields: ['power', 'cadence', 'speed', 'hr', 'distance', 'time', 'grade', 'climbed'],
  rideTogether: true,
  ghost: true,
  sound: true,
  music: true,
  virtualShifting: false,
  plan: null,
  hudPosition: 'center',
  proTeams: false, // Solo is the default: routes are rides, not races
  powerMatch: true,
  autoSteer: true,
  timeOfDay: 'auto',
  weather: 'auto',
  kit: null,
  tour: null,
  wind: true,
  miniMap: true,
  komPanel: true,
  commentary: true,
  loadout: null,
  aiCoach: false,
  aiRivals: false,
  coachVoice: false,
};

/**
 * One-off fixes to a saved copy of the settings (this browser's, or the account's), by `settingsVersion`:
 * - 2: pro teams used to be on for everyone and was rarely a deliberate choice, so every rider moves to Solo once.
 *   After that their choice is kept. Fields it doesn't change are left out, so it can be spread over defaults or a live copy.
 */
export function migrateSettings(saved: Partial<Settings>): Partial<Settings> {
  const from = typeof saved.settingsVersion === 'number' ? saved.settingsVersion : 1;
  if (from >= SETTINGS_VERSION) return saved;
  return { ...saved, proTeams: false, settingsVersion: SETTINGS_VERSION };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as unknown;
      const migrated = migrateSettings(isObject(saved) ? saved as Partial<Settings> : {});
      const settings = normalizeSettings(migrated);
      if (migrated !== saved) saveSettings(settings); // so the one-off change happens once
      return settings;
    }
  } catch {
    // Storage unavailable (private mode etc.): fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A saved copy (this browser's, or the account's) as settings we can trust. Anything missing or malformed
 * keeps the default; unknown keys are dropped, and nested records only survive if they have the right shape,
 * so a hand-edited or older copy can't put `NaN` grades or a broken plan into the ride.
 */
export function normalizeSettings(value: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const s = isObject(value) ? value : {};
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  const fields = Array.isArray(s.dataFields)
    ? [...new Set(s.dataFields.filter((f): f is string => typeof f === 'string' && HUD_FIELD_IDS.has(f)))].slice(0, MAX_FIELDS)
    : [...defaults.dataFields];

  return {
    settingsVersion: SETTINGS_VERSION,
    riderKg: num(s.riderKg, defaults.riderKg, 30, 200),
    bikeKg: num(s.bikeKg, defaults.bikeKg, 5, 30),
    ftp: num(s.ftp, defaults.ftp, 50, 600),
    maxHr: num(s.maxHr, defaults.maxHr, 120, 230),
    units: oneOf(s.units, ['metric', 'imperial'] as const, defaults.units),
    difficulty: num(s.difficulty, defaults.difficulty, 0, 100),
    dataFields: fields,
    rideTogether: bool(s.rideTogether, defaults.rideTogether),
    powerMatch: bool(s.powerMatch, defaults.powerMatch),
    ghost: bool(s.ghost, defaults.ghost),
    sound: bool(s.sound, defaults.sound),
    music: bool(s.music, defaults.music),
    virtualShifting: bool(s.virtualShifting, defaults.virtualShifting),
    plan: validPlan(s.plan) ?? defaults.plan,
    hudPosition: oneOf(s.hudPosition, ['left', 'center', 'right'] as const, defaults.hudPosition),
    proTeams: bool(s.proTeams, defaults.proTeams),
    autoSteer: bool(s.autoSteer, defaults.autoSteer),
    timeOfDay: oneOf(s.timeOfDay, ['auto', 'dawn', 'day', 'dusk', 'night'] as const, defaults.timeOfDay),
    weather: oneOf(s.weather, ['auto', 'clear', 'cloudy', 'rain'] as const, defaults.weather),
    kit: validKit(s.kit) ?? defaults.kit,
    tour: validTour(s.tour) ?? defaults.tour,
    wind: bool(s.wind, defaults.wind),
    miniMap: bool(s.miniMap, defaults.miniMap),
    komPanel: bool(s.komPanel, defaults.komPanel),
    commentary: bool(s.commentary, defaults.commentary),
    loadout: validLoadout(s.loadout) ?? defaults.loadout,
    aiCoach: bool(s.aiCoach, defaults.aiCoach),
    aiRivals: bool(s.aiRivals, defaults.aiRivals),
    coachVoice: bool(s.coachVoice, defaults.coachVoice),
  };
}

const HUD_FIELD_IDS = new Set([
  'power', 'power1s', 'wkg', 'avgPower', 'np', 'maxPower', 'target', 'intervalLeft', 'workoutLeft',
  'cadence', 'avgCadence', 'speed', 'avgSpeed', 'hr', 'avgHr', 'maxHr', 'distance', 'toGo', 'time',
  'grade', 'climbed', 'elevation', 'kj', 'tss',
]); // the ids in src/hud.ts FIELDS (kept here to avoid a settings → hud dependency)
const MAX_FIELDS = 12;

function validPlan(v: unknown): PlanProgress | null {
  if (!isObject(v) || typeof v.id !== 'string' || !v.id || typeof v.started !== 'string' || !Array.isArray(v.done)) return null;
  const done = v.done.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 10_000);
  return { id: v.id, started: v.started, done: [...new Set(done)] };
}

function validKit(v: unknown): Kit | null {
  if (!isObject(v)) return null;
  const colour = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);
  const jersey = colour(v.jersey), accent = colour(v.accent), frame = colour(v.frame);
  return jersey && accent && frame ? { jersey, accent, frame } : null;
}

function validTour(v: unknown): TourProgress | null {
  if (!isObject(v) || typeof v.id !== 'string' || !v.id || !Number.isInteger(v.seed) || typeof v.stage !== 'number' ||
      !Number.isInteger(v.stage) || v.stage < 0 || v.stage > 8 || !Array.isArray(v.results)) return null;
  return v as unknown as TourProgress;
}

function validLoadout(v: unknown): Partial<Loadout> | null {
  if (!isObject(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, item] of Object.entries(v)) if (typeof item === 'string' && item.length <= 100) out[k] = item;
  return Object.keys(out).length ? out : null;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not persisted; settings still apply for this session.
  }
}
