// The built-in stages that follow a real, named road, and the facts the Climb guide
// may put in a question. The server looks the stage up here by id, so nothing in a
// request body ever reaches the prompt. Pure data: no DOM, no Three.js, no SDK. A unit
// test (tests/unit/climbGuide.test.ts) keeps the length and climbing in step with
// src/stages.ts, which this file deliberately doesn't import (it is heavy, and the
// Vercel function shares this file).

export const CLIMB_TOPICS = ['history', 'records', 'conditions', 'visit'] as const;
export type ClimbTopic = (typeof CLIMB_TOPICS)[number];

export const CLIMB_TOPIC_LABELS: Record<ClimbTopic, { label: string; hint: string }> = {
  history: { label: 'History', hint: 'History and famous race moments' },
  records: { label: 'Records', hint: 'Fastest ascents and notable times' },
  conditions: { label: 'Conditions now', hint: 'Open or closed, closures, roadworks, weather' },
  visit: { label: 'Riding it', hint: 'Practical tips for riding it for real' },
};

export interface Climb {
  /** The stage id in src/stages.ts. */
  id: string;
  /** The real road's usual name, as it goes in the question. */
  place: string;
  region: string;
  /** Where our stage starts. */
  start: string;
  lengthM: number;
  gainM: number;
}

export const CLIMBS: readonly Climb[] = [
  { id: 'alpe-dhuez', place: 'Alpe d’Huez', region: 'Isère, French Alps, France', start: 'Le Bourg-d’Oisans', lengthM: 14000, gainM: 1118 },
  { id: 'stelvio', place: 'Stelvio Pass', region: 'South Tyrol and Lombardy, Italy', start: 'Prato allo Stelvio', lengthM: 24500, gainM: 1843 },
  { id: 'ventoux', place: 'Mont Ventoux', region: 'Provence, France', start: 'Bédoin', lengthM: 21400, gainM: 1610 },
  { id: 'tourmalet', place: 'Col du Tourmalet', region: 'Hautes-Pyrénées, French Pyrenees, France', start: 'Luz-Saint-Sauveur', lengthM: 19000, gainM: 1404 },
  { id: 'zoncolan', place: 'Monte Zoncolan', region: 'Friuli, Italy', start: 'Ovaro', lengthM: 10100, gainM: 1210 },
  { id: 'mt-washington', place: 'Mount Washington Auto Road', region: 'New Hampshire, USA', start: 'the Auto Road gate at Pinkham Notch', lengthM: 12200, gainM: 1417 },
  { id: 'mt-blue-sky', place: 'Mount Blue Sky (formerly Mount Evans) Scenic Byway', region: 'Colorado, USA', start: 'Echo Lake Lodge', lengthM: 23300, gainM: 1080 },
  { id: 'mt-diablo', place: 'Mount Diablo summit road', region: 'California, USA', start: 'Danville', lengthM: 18000, gainM: 990 },
  { id: 'flagstaff', place: 'Flagstaff Mountain road', region: 'Boulder, Colorado, USA', start: 'Boulder', lengthM: 7400, gainM: 602 },
  { id: 'hotw-tour-of-the-moon', place: 'Tour of the Moon (Rim Rock Drive, Colorado National Monument)', region: 'Grand Junction and Fruita, Colorado, USA', start: 'the Colorado National Monument entrance', lengthM: 37000, gainM: 755 },
  { id: 'hell-of-the-west', place: 'Echo Lake road (Chicago Creek Road)', region: 'Idaho Springs, Colorado, USA', start: 'Idaho Springs', lengthM: 20800, gainM: 942 },
];

export const CLIMB_IDS = CLIMBS.map((c) => c.id) as [string, ...string[]];

export const climbById = (id: unknown): Climb | undefined => CLIMBS.find((c) => c.id === id);

/** Average grade over the whole stage, in percent (one decimal). */
export const climbAvgPct = (c: Pick<Climb, 'lengthM' | 'gainM'>) => Math.round((c.gainM / c.lengthM) * 1000) / 10;
