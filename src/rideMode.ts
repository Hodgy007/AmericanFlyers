// The ride mode: who rides with you. Routes are rides, not races, so the hub asks.
//   solo  - just you, plus friends on the same route live and your ghost (the default)
//   pro   - the computer-ridden pro teams ride along too (settings.proTeams)
//   race  - race the pro teams to the finish: only on a route with a finish, chosen per ride, never stored

import type { Settings } from './settings';

export type RideMode = 'solo' | 'pro' | 'race';

export const RIDE_MODES: readonly RideMode[] = ['solo', 'pro', 'race'];

export const MODE_LABEL: Record<RideMode, string> = { solo: 'Solo', pro: 'With pro teams', race: 'Race' };

/** One line under the control: what the chosen mode means. */
export const MODE_HELP: Record<RideMode, string> = {
  solo: 'Just you on the road, plus friends riding it live and your ghost.',
  pro: 'Computer-ridden pro teams roll along the road with you. Not a race.',
  race: 'Roll up to the line with the pro teams and race to the finish.',
};

/** Why Race can't be picked, when it can't. */
export const RACE_UNAVAILABLE = 'Racing needs a route with a finish line. A workout, or an endless road, rides as Solo or with pro teams.';

/** A route can be raced when it has a finish and no workout is on top of it. */
export function canRace(stage: { finish: number | null }, workoutId: string | null): boolean {
  return stage.finish !== null && !workoutId;
}

/** The stored half of the choice (Race is never stored). */
export function storedMode(s: Pick<Settings, 'proTeams'>): Exclude<RideMode, 'race'> {
  return s.proTeams ? 'pro' : 'solo';
}

/** The mode that applies: a wish for Race only holds where Race is possible; otherwise the stored mode. */
export function effectiveMode(s: Pick<Settings, 'proTeams'>, raceWanted: boolean, raceable: boolean): RideMode {
  return raceWanted && raceable ? 'race' : storedMode(s);
}

/** Whether the computer-ridden teams are on the road in this mode (a race brings its own field). */
export function proTeamsOnRoad(mode: RideMode): boolean {
  return mode === 'pro';
}
