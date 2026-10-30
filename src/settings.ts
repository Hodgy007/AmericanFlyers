export type Units = 'metric' | 'imperial';

export interface Settings {
  riderKg: number;
  bikeKg: number;
  ftp: number;
  units: Units;
  difficulty: number; // 0–100, percentage of road grade sent to the trainer
}

const KEY = 'americanflyers.settings';

export const DEFAULT_SETTINGS: Settings = {
  riderKg: 75,
  bikeKg: 8,
  ftp: 200,
  units: 'metric',
  difficulty: 50,
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
