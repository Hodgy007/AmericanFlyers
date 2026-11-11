// A ride is saved as one or more activities that never overlap in time: a workout is a clean boundary (the ride so
// far is saved, the workout is its own activity, and what is ridden afterwards is a new one). The trip itself keeps
// going up the road, so each activity needs "since this one started" baselines rather than the trip's totals.
// This file holds those baselines, the rules for when a window is worth saving, and the row that gets saved.

import type { RideStats } from './stats';
import type { Activity, Samples } from './cloud/sync';

/** The trip's running totals (the `ride` object in main.ts). */
export interface TripTotals {
  distance: number;
  startDistance: number;
  climbed: number;
  proM: number;
}

/** What the trip had covered when an activity window began. */
export interface Baseline {
  /** Metres since the trip's start (distance - startDistance). */
  dist: number;
  climbed: number;
  proM: number;
}

export const baselineAt = (t: TripTotals): Baseline => ({ dist: t.distance - t.startDistance, climbed: t.climbed, proM: t.proM });

/** Metres ridden since the window began (never negative, never from before it). */
export const distanceSince = (t: TripTotals, b: Baseline) => Math.max(0, t.distance - t.startDistance - b.dist);
export const climbedSince = (t: TripTotals, b: Baseline) => Math.max(0, t.climbed - b.climbed);
export const proSince = (t: TripTotals, b: Baseline) => Math.max(0, t.proM - b.proM);

/** Is a window worth saving (long enough) and not already saved up to now? */
export function worthSaving(seconds: number, savedSeconds: number, minSeconds: number): boolean {
  return seconds >= minSeconds && seconds > savedSeconds;
}

/** What to put in a saved row's title: a workout's activity is named after it, a ride's after the stage. */
export function activityTitle(workout: string | null, stageName: string): string {
  return workout ? `${workout} · ${stageName}` : stageName;
}

export interface ActivityInput {
  id: string;
  startedAt: Date | null;
  samples: Samples;
  stats: RideStats;
  stage: { id: string; name: string };
  /** The workout this window is (its name), if it is a workout's activity. */
  workout: string | null;
  /** Set only once the workout ran to its end: the achievements count these. */
  workoutCompleted: string | null;
  finished: boolean;
  distanceM: number;
  climbedM: number;
  finishS: number | null;
  demo: boolean;
  racePlace: number | null;
  raceSize: number | null;
  proM: number;
  ftp: number;
  maxHr: number;
}

/** The row saved for an activity window. Pure: everything it needs is passed in. */
export function buildActivityRow(i: ActivityInput): Activity {
  const st = i.stats;
  const round = (v: number) => (v > 0 ? Math.round(v) : null);
  const zones = (z: number[]) => (z.some((v) => v > 0) ? z.map((v) => Math.round(v)) : null);
  const best = Object.fromEntries(Object.entries(st.best).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]));
  return {
    id: i.id,
    started_at: (i.startedAt ?? new Date()).toISOString(),
    title: activityTitle(i.workout, i.stage.name),
    stage_id: i.stage.id,
    stage_name: i.stage.name,
    finished: i.finished,
    workout_name: i.workoutCompleted,
    duration_s: Math.round(st.seconds),
    distance_m: Math.round(i.distanceM),
    climbed_m: Math.round(i.climbedM),
    avg_power: round(st.avgPower),
    np: round(st.np),
    max_power: round(st.maxPower),
    avg_hr: round(st.avgHr),
    max_hr: round(st.maxHr),
    avg_cadence: round(st.avgCadence),
    kj: round(st.work / 1000),
    tss: st.seconds ? Math.round(st.tss(i.ftp) * 10) / 10 : null,
    ftp: i.ftp,
    best_power: Object.keys(best).length ? best : null,
    hr_zones: zones(st.hrZones),
    power_zones: zones(st.powerZones),
    max_hr_setting: i.maxHr,
    finish_s: i.finishS !== null && i.finishS > 0 ? Math.round(i.finishS) : null,
    demo: i.demo,
    race_place: i.racePlace && i.racePlace > 0 ? i.racePlace : null,
    race_size: i.raceSize && i.raceSize > 0 ? i.raceSize : null,
    pro_m: i.proM > 0 ? Math.round(i.proM) : null,
    samples: i.samples,
  };
}
