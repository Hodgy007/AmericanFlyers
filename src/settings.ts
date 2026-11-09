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
  virtualShifting: boolean; // choose your gear; the trainer's resistance follows it
  plan: PlanProgress | null; // the training plan being followed
  hudPosition: 'left' | 'center' | 'right'; // where the data blocks sit
  proTeams: boolean; // the ride mode "With pro teams": computer-ridden pro teams on the road (off = Solo; Race is chosen per ride, never stored)
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
  virtualShifting: false,
  plan: null,
  hudPosition: 'center',
  proTeams: false, // Solo is the default: routes are rides, not races
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
      const saved = JSON.parse(raw) as Partial<Settings>;
      const migrated = migrateSettings(saved);
      const settings = { ...DEFAULT_SETTINGS, ...migrated };
      if (migrated !== saved) saveSettings(settings); // so the one-off change happens once
      return settings;
    }
  } catch {
    // Storage unavailable (private mode etc.): fall back to defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not persisted; settings still apply for this session.
  }
}
