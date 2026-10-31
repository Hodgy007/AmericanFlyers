import type { PlanProgress } from './plans';
import type { TourProgress } from './tour';

export type Units = 'metric' | 'imperial';

export interface Settings {
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
  proTeams: boolean; // computer-ridden pro teams on the road
  tour: TourProgress | null; // the Hell of the West tour in progress
}

const KEY = 'americanflyers.settings';

export const DEFAULT_SETTINGS: Settings = {
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
  proTeams: true,
  tour: null,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
