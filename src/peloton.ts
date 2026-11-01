// Pro teams on the road: computer-ridden groups that ride the stage at their
// own steady watts per kilo, in a two-by-two paceline, slowing on the climbs
// and flying down the descents like you do. The team names are (lovingly)
// comedic near-misses of real ones; the riders are made up.

import { gradeAt, headingAt, currentStage } from './course';
import { DEFAULT_PARAMS, stepSpeed } from './physics';
import type { OtherRider } from './world/others';
import { RaceSim, type RaceCourse, type RosterEntry } from './raceSim';
import { rng } from './world/noise';
import { draftShift, echelonLane, wind } from './world/wind';

/** The road's wind at a distance along the course, for the race field. */
export const windAtDistance = (d: number) => wind.at(headingAt(d));

export interface Team {
  name: string;
  short: string; // on name tags
  color: string; // jersey and frame
  frame: string;
}

export const TEAMS: Team[] = [
  { name: 'UAE Team Emigrates', short: 'Emigrates', color: '#f4f4f4', frame: '#c8102e' },
  { name: 'Plasma | Lease-a-Trike', short: 'Plasma', color: '#ffd200', frame: '#111111' },
  { name: 'INEPTOS Grenadines', short: 'Ineptos', color: '#1b2a4a', frame: '#c8102e' },
  { name: 'Scandal Quick-Slip', short: 'Quick-Slip', color: '#1e64c8', frame: '#ffffff' },
  { name: 'Little-Trek', short: 'Little-Trek', color: '#c8102e', frame: '#0a1a3a' },
  { name: 'EZ Procrastination–EasyToast', short: 'EZ', color: '#ff4fa3', frame: '#1c2b5a' },
  { name: 'Red Mule–BORE–hanggrohe', short: 'Red Mule', color: '#1a2340', frame: '#d4002a' },
  { name: 'Moviestar', short: 'Moviestar', color: '#0a3d91', frame: '#7ac143' },
  { name: 'Groupie–FDJ', short: 'Groupie', color: '#2a6ee0', frame: '#e02a2a' },
  { name: 'Coffeedis', short: 'Coffeedis', color: '#d6001c', frame: '#ffffff' },
  { name: 'Alpaca–Deceuncle', short: 'Alpaca', color: '#1f8fb8', frame: '#0f1d2e' },
  { name: 'Bahrain Vicarious', short: 'Vicarious', color: '#b8001f', frame: '#c9a227' },
];

const FIRST_NAMES = ['Hugo', 'Luca', 'Jan', 'Matteo', 'Sven', 'Diego', 'Tom', 'Kasper', 'Nils', 'Rui', 'Marco', 'Felix',
  'Oscar', 'Theo', 'Arne', 'Bruno', 'Pierre', 'Lars', 'Enzo', 'Joris', 'Milan', 'Emil', 'Paco', 'Bram', 'Gus', 'Otto'];

/** Watts per kilo for each group, from a steady club pace to pros on a training ride. */
const PACES = [2.0, 2.6, 3.1, 3.6, 4.2];
const RIDER_KG = 68;
const BIKE_KG = 7.5;
const PACK_CDA = DEFAULT_PARAMS.cda * 0.72; // most of the bunch sits in the draft
const ROW = 2.1; // metres between rows of the paceline

export interface Group {
  id: string;
  team: Team;
  wkg: number;
  distance: number; // the front of the group
  speed: number;
  riders: { id: string; name: string; row: number; side: number }[];
  phase: number; // for small surges
}

function pick<T>(list: T[], n: number, seed: number) {
  const out: T[] = [];
  let s = seed;
  while (out.length < n) {
    s = (s * 9301 + 49297) % 233280;
    const item = list[Math.floor((s / 233280) * list.length)];
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export class Peloton {
  groups: Group[] = [];
  /** Set while a race is on: the whole field races (race mode) instead of the steady groups. */
  race: RaceField | null = null;
  private time = 0;
  /** Set during a scheduled group ride (events.ts): one pace group that holds its W/kg on the server's clock. */
  private ride: { clock: () => number; t: number } | null = null;

  get racing() {
    return this.race !== null;
  }

  /** Lines everyone up for a race. The sim itself is stepped by the race controller (race.ts). */
  startRace(course: RaceCourse, roster: RosterEntry[], refWkg: number, seed: number): RaceField {
    this.race = new RaceField(course, roster, refWkg, seed);
    this.groups = [];
    return this.race;
  }

  /**
   * A scheduled group ride: a single bunch of 12 rolling at a steady `wkg` from the start line,
   * stepped in fixed slices up to `secondsSinceStart()` so everyone riding sees it in the same place.
   * It waits on the line (just ahead of the riders) until the clock reaches zero.
   */
  startGroupRide(wkg: number, seed: number, secondsSinceStart: () => number) {
    const names = pick(FIRST_NAMES, 12, seed);
    const team = TEAMS[Math.abs(seed) % TEAMS.length];
    this.race = null;
    this.ride = { clock: secondsSinceStart, t: 0 };
    this.groups = [{
      id: 'ride-group', team, wkg, distance: 14, speed: 0,
      riders: names.map((name, i) => ({ id: `ride-${i}`, name, row: Math.floor(i / 2), side: i % 2 ? 1 : -1 })),
      phase: 0,
    }];
  }

  /** The pace group, if a group ride is on. */
  get groupRide(): Group | null {
    return this.ride ? this.groups[0] ?? null : null;
  }

  endGroupRide(around = 0) {
    if (!this.ride) return;
    this.ride = null;
    this.reset(around);
  }

  private stepGroupRide(ride: { clock: () => number; t: number }) {
    const g = this.groups[0];
    const target = ride.clock();
    for (let i = 0; i < 800 && ride.t + 0.25 <= target; i++) {
      ride.t += 0.25;
      const grade = gradeAt(g.distance);
      const power = g.wkg * RIDER_KG * (grade < -0.04 ? 0.35 : 1);
      g.speed = stepSpeed(g.speed, power, grade, 0.25, { massKg: RIDER_KG + BIKE_KG, cda: PACK_CDA, crr: DEFAULT_PARAMS.crr }, windAtDistance(g.distance).head);
      g.distance += g.speed * 0.25;
    }
  }

  /** Back to the free-ride groups. */
  endRace(around = 0) {
    if (!this.race) return;
    this.race = null;
    this.reset(around);
  }

  /** New groups spread around the rider, as when a stage is chosen. */
  reset(around: number) {
    this.ride = null; // choosing another stage ends a group ride
    const seed = Math.floor(Math.random() * 100000);
    const teams = pick(TEAMS, PACES.length, seed);
    const offsets = [-140, 70, 260, 620, 1150].sort(() => Math.random() - 0.5);
    const finish = currentStage().finish;
    this.groups = PACES.map((wkg, g) => {
      const size = 4 + ((seed + g) % 3); // 4–6 riders
      const names = pick(FIRST_NAMES, size, seed + g * 17);
      let d = Math.max(20, around + offsets[g]);
      if (finish !== null) d = Math.min(d, Math.max(20, finish - 300));
      return {
        id: `team-${g}`,
        team: teams[g],
        wkg,
        distance: d,
        speed: 5 + wkg * 1.5,
        riders: names.map((name, i) => ({ id: `team-${g}-${i}`, name, row: Math.floor(i / 2), side: i % 2 ? 1 : -1 })),
        phase: Math.random() * 10,
      };
    });
  }

  update(dt: number) {
    if (this.race) return;
    if (this.ride) { if (this.groups[0]) this.stepGroupRide(this.ride); return; }
    this.time += dt;
    const finish = currentStage().finish;
    for (const g of this.groups) {
      const grade = gradeAt(g.distance);
      // Steady effort with gentle surges; they soft-pedal steep descents.
      const surge = 1 + 0.05 * Math.sin(this.time / 23 + g.phase) + 0.03 * Math.sin(this.time / 7 + g.phase * 2);
      const power = g.wkg * RIDER_KG * surge * (grade < -0.04 ? 0.35 : 1);
      g.speed = stepSpeed(g.speed, power, grade, dt, { massKg: RIDER_KG + BIKE_KG, cda: PACK_CDA, crr: DEFAULT_PARAMS.crr }, windAtDistance(g.distance).head);
      g.distance += g.speed * dt;
      // Over the line: they roll out and start the stage again.
      if (finish !== null && g.distance > finish + 120) {
        g.distance = 20;
        g.speed = 4;
      }
    }
  }

  /** Every pro rider as an "other rider" for the world, drafting and the riders list. */
  riders(): OtherRider[] {
    if (this.race) return this.raceRiders(this.race);
    const out: OtherRider[] = [];
    for (const g of this.groups) {
      const power = Math.round(g.wkg * RIDER_KG);
      // In a crosswind the teams ride a diagonal echelon, each row tucked on the downwind side of the one ahead.
      const shift = draftShift(windAtDistance(g.distance).cross);
      for (const r of g.riders) {
        out.push({
          id: r.id,
          name: `${r.name} (${g.team.short})`,
          tag: r.row === 0 && r.side < 0 ? `${g.team.short} · ${g.wkg.toFixed(1)} W/kg` : '',
          distance: g.distance - r.row * ROW,
          speedMs: g.speed,
          power,
          cadence: 88 + (r.row % 3) * 3,
          team: g.team.name,
          jersey: g.team.color,
          frame: g.team.frame,
          lane: echelonLane(r.row, r.side, shift), // two by two, just right of centre (a diagonal in a crosswind)
        });
      }
    }
    return out;
  }

  /** The racers, as other riders for the world and the draft. */
  private raceRiders(race: RaceField): OtherRider[] {
    const out: OtherRider[] = [];
    for (const s of race.sim.states()) {
      if (s.gone) continue;
      const team = TEAMS[s.team];
      out.push({
        id: s.id,
        name: `${s.name} (${team.short})`,
        tag: s.leader ? `${s.name} · ${team.short}` : '',
        distance: s.pos,
        speedMs: s.speed,
        power: Math.round(s.power),
        cadence: 84 + (s.team * 3 + s.id.length) % 9,
        team: team.name,
        jersey: team.color,
        frame: team.frame,
        lane: s.lane,
      });
    }
    return out;
  }

  /** The back of a group, for "Join". */
  back(g: Group) {
    return g.distance - (Math.ceil(g.riders.length / 2) - 1) * ROW;
  }
}

// ------------------------------------------------------------------ racing ----

const RACE_NAMES = ['Aksel', 'Dario', 'Elias', 'Finn', 'Gael', 'Ivo', 'Jonas', 'Kai', 'Leo', 'Mads', 'Nico', 'Remy', 'Stan', 'Timo', 'Yann', 'Zeno'];

/**
 * The field for a race: every team fields three riders, a climbing captain, an
 * all-rounder and a sprinter, each with their own strengths. Seeded, so the same
 * seed is the same field (the tour keeps its seed so the same riders race every stage).
 */
export function makeRoster(seed: number): RosterEntry[] {
  const r = rng(seed ^ 0x5eed);
  const out: RosterEntry[] = [];
  // 36 different first names, shuffled by the seed.
  const allNames = [...FIRST_NAMES, ...RACE_NAMES].map((n) => ({ n, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.n);
  TEAMS.forEach((_team, t) => {
    const strength = 0.8 + 0.2 * r();
    for (let i = 0; i < 3; i++) {
      const u = r();
      const ability = Math.min(1, (i === 0 ? 0.62 + 0.38 * u : i === 1 ? 0.3 + 0.45 * u : 0.2 + 0.5 * u) * strength);
      out.push({
        id: `p${t}-${i}`,
        name: allNames[t * 3 + i],
        team: t,
        ability,
        climb: i === 0 ? 1.02 + 0.05 * r() : i === 1 ? 0.98 + 0.05 * r() : 0.92 + 0.05 * r(),
        sprint: i === 0 ? 1.7 + 0.25 * r() : i === 1 ? 2.0 + 0.2 * r() : 2.2 + 0.3 * r(),
        leader: i === 0,
      });
    }
  });
  return out;
}

/** A race on the road: the sim, with the whole field lined up just behind the start line. */
export class RaceField {
  readonly sim: RaceSim;
  readonly roster: RosterEntry[];
  constructor(course: RaceCourse, roster: RosterEntry[], refWkg: number, seed: number) {
    this.roster = roster;
    this.sim = new RaceSim(course, roster, { refWkg, seed, startFront: -2.2, wind: windAtDistance });
  }
}
