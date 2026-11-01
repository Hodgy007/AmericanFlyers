// Builds the numbers the coach is sent after a ride, from plain values (so it
// can be tested without a ride). Rounds and caps everything: the function
// checks the same limits and rejects anything outside them. Pure.

import type { DebriefPayload } from './types';

export interface RideSummaryInput {
  title: string;
  mode: DebriefPayload['mode'];
  durationS: number;
  distanceM: number;
  climbedM: number;
  avgW: number;
  npW: number;
  powerZoneS: number[];
  hrZoneS: number[];
  avgHr: number;
  maxHr: number;
  avgCadence: number;
  tss: number;
  workout?: { name: string; onTargetS: number; totalS: number } | null;
  race?: { place: number; of: number } | null;
  plan?: { name: string; done: number; total: number } | null;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const orNull = (v: number, hi: number) => (v > 0 ? Math.round(clamp(v, 0, hi)) : null);
const zones = (z: number[], n: number) => Array.from({ length: n }, (_, i) => Math.round(clamp(z[i] ?? 0, 0, 200000)));

export function buildDebrief(i: RideSummaryInput): DebriefPayload {
  return {
    title: i.title.slice(0, 80),
    mode: i.mode,
    durationS: Math.round(clamp(i.durationS, 0, 200000)),
    distanceKm: Math.round(clamp(i.distanceM / 1000, 0, 3000) * 10) / 10,
    climbedM: Math.round(clamp(i.climbedM, 0, 20000)),
    avgW: Math.round(clamp(i.avgW, 0, 3000)),
    npW: Math.round(clamp(i.npW, 0, 3000)),
    powerZoneS: zones(i.powerZoneS, 6),
    hrZoneS: zones(i.hrZoneS, 5),
    avgHr: orNull(i.avgHr, 250),
    maxHr: orNull(i.maxHr, 250),
    avgCadence: orNull(i.avgCadence, 250),
    tss: i.tss > 0 ? Math.round(clamp(i.tss, 0, 2000)) : null,
    workout: i.workout ? { name: i.workout.name.slice(0, 60), compliancePct: i.workout.totalS > 30 ? Math.round(clamp((i.workout.onTargetS / i.workout.totalS) * 100, 0, 300)) : null } : null,
    race: i.race ? { place: Math.round(clamp(i.race.place, 1, 500)), of: Math.round(clamp(i.race.of, 1, 500)) } : null,
    plan: i.plan ? { name: i.plan.name.slice(0, 60), done: i.plan.done, total: i.plan.total } : null,
  };
}
