// The race engine: a field of computer-ridden riders on a stage, as individual
// riders that travel in groups. Groups ride at a pace set by their strongest
// riders; riders attack on climbs, break away early in long stages, crack and
// drop back, and the groups chase, merge and sprint for the line. No DOM, no
// Three.js: the live race (peloton.ts) and the "simulate this stage" shortcut
// of the tour (tour.ts) both run this same engine.
//
// It is seeded and deterministic for a given sequence of steps, and cheap:
// a few dozen riders, in a few groups, each moved with the same power-to-speed
// physics as the player.

import { DEFAULT_PARAMS, stepSpeed } from './physics';
import { rng } from './world/noise';
import type { RacePoints } from './stages';
import { draftShift, SHIFT_MAX } from './world/wind';

export const PRO_KG = 68;
const MASS = PRO_KG + 7.5; // rider + bike
const ROW = 1.9; // metres between rows in a group
const LANES: Record<number, number[]> = { 1: [2.2], 2: [1.5, 2.7], 3: [1.0, 2.2, 3.4], 4: [0.8, 1.8, 2.8, 3.8] };

/** A rider in the field. Strengths are relative: the field is scaled to the player's own watts per kilo. */
export interface RosterEntry {
  id: string;
  name: string;
  team: number; // index into TEAMS
  ability: number; // 0..1, overall strength
  climb: number; // multiplier on power when the road goes up
  sprint: number; // peak sprint power as a multiple of sustained power
  leader: boolean; // a team's captain: gets a name tag and attacks more
  /** Fixed sustained watts and mass, for a rider the sim stands in for (the player's "simulate this stage"). */
  capW?: number;
  massKg?: number;
}

export type LineKind = 'sprint' | 'summit' | 'finish';
export interface RaceLine {
  kind: LineKind;
  d: number;
  name: string;
  cat?: 0 | 1 | 2 | 3 | 4; // summits: 0 = hors catégorie
  crossings: { id: string; t: number }[];
}

export interface RaceCourse {
  finish: number;
  grade(d: number): number;
  lines: RaceLine[];
}

export const SPRINT_POINTS = [8, 5, 3, 2, 1];
export const FINISH_POINTS = [20, 15, 12, 10, 8, 6, 4, 3, 2, 1];
export const KOM_POINTS: Record<number, number[]> = {
  0: [20, 15, 12, 10, 8, 6, 4, 2],
  1: [10, 8, 6, 4, 2, 1],
  2: [6, 4, 2, 1],
  3: [3, 2, 1],
  4: [1],
};

// ------------------------------------------------------------- course ----

/**
 * Climbs found from the elevation profile: a zig-zag over the profile that
 * ignores dips under 25 m, keeping rises of at least 45 m at 2.5% or more.
 */
export function detectSummits(elevationAt: (d: number) => number, finish: number): { d: number; name: string; cat: 0 | 1 | 2 | 3 | 4 }[] {
  const HYST = 25;
  const out: { d: number; gain: number }[] = [];
  let lo = { e: elevationAt(0), d: 0 };
  let hi = { e: lo.e, d: 0 };
  let up = false;
  const record = () => {
    const gain = hi.e - lo.e;
    if (gain >= 45 && gain / Math.max(1, hi.d - lo.d) >= 0.025) out.push({ d: hi.d, gain });
  };
  for (let d = 20; d <= finish; d += 20) {
    const e = elevationAt(d);
    if (up) {
      if (e > hi.e) hi = { e, d };
      else if (hi.e - e >= HYST) { record(); up = false; lo = { e, d }; }
    } else if (e < lo.e) lo = { e, d };
    else if (e - lo.e >= HYST) { up = true; hi = { e, d }; }
  }
  if (up) record();
  return out.map((c, i) => ({
    d: c.d,
    name: Math.abs(c.d - finish) < 150 ? 'Summit finish' : `Climb ${i + 1}`,
    cat: (c.gain >= 800 ? 0 : c.gain >= 450 ? 1 : c.gain >= 220 ? 2 : c.gain >= 100 ? 3 : 4) as 0 | 1 | 2 | 3 | 4,
  }));
}

/** Sprint banners, summits and the finish of a stage, in order along the road. */
export function makeCourse(stage: { finish: number; elevationAt(d: number): number; race?: RacePoints }): RaceCourse {
  const finish = stage.finish;
  const lines: RaceLine[] = [];
  const sprints = stage.race?.sprints ?? [{ d: Math.round(finish * 0.5), name: 'Intermediate sprint' }];
  for (const s of sprints) if (s.d < finish - 600) lines.push({ kind: 'sprint', d: s.d, name: s.name, crossings: [] });
  const summits = stage.race?.summits ?? detectSummits(stage.elevationAt, finish);
  for (const s of summits) lines.push({ kind: 'summit', d: s.d, name: s.name, cat: s.cat, crossings: [] });
  lines.push({ kind: 'finish', d: finish, name: 'Finish', crossings: [] });
  lines.sort((a, b) => a.d - b.d || (a.kind === 'finish' ? 1 : 0) - (b.kind === 'finish' ? 1 : 0));
  return { finish, grade: (d) => (stage.elevationAt(d + 2) - stage.elevationAt(d - 2)) / 4, lines };
}

// ------------------------------------------------------------ the sim ----

interface RR {
  def: RosterEntry;
  id: string;
  cap: number; // sustained watts
  mass: number;
  group: RGroup;
  off: number; // metres behind the group's front wheel
  lane: number;
  slotKey: number; // for ordering within a group
  pos: number;
  prev: number;
  power: number;
  strain: number; // seconds spent over what they can hold
  noRejoinUntil: number;
  tiredUntil: number;
  noAttackUntil: number;
  phase: number;
  sprintAtDist: number; // metres from a line where this rider opens their sprint
  sprintElapsed: number;
  sprintLine: number; // the line d it applies to
  done: boolean;
  finishT: number | null;
  gone: boolean;
}

interface RGroup {
  id: number;
  riders: RR[];
  front: number;
  speed: number;
  breakaway: boolean;
  dropped: boolean;
  attackUntil: number;
  attackMul: number;
  nextAttack: number;
  sortAt: number;
  draft: number; // drag multiplier from sitting behind another group (solo riders)
}

export interface RaceEvent {
  t: number;
  kind: 'attack' | 'break' | 'caught' | 'drop' | 'sprint';
  text: string;
  /** Rider ids involved, so the UI can tell if it's about a rider the player is following. */
  ids: string[];
}

export interface RiderState {
  id: string;
  name: string;
  team: number;
  leader: boolean;
  pos: number;
  speed: number;
  power: number;
  lane: number;
  groupSize: number;
  done: boolean;
  gone: boolean;
}

export interface SimOptions {
  refWkg: number; // the player's watts per kilo; the field is scaled to it
  seed: number;
  /** Front wheel of the starting bunch (a little behind the line). */
  startFront?: number;
  /** Is the player one of the riders in the roster (a simulated stage), or ridden live? */
  playerInRoster?: string;
  /**
   * Wind at a distance along the course (m/s: headwind into the face, crosswind towards the right).
   * Left out: still air, as in the "simulate this stage" shortcut. A live race passes the road's wind
   * so the field feels what you feel and forms echelons in a crosswind.
   */
  wind?: (d: number) => { head: number; cross: number };
}

export class RaceSim {
  t = 0;
  readonly course: RaceCourse;
  readonly rr: RR[] = [];
  groups: RGroup[] = [];
  events: RaceEvent[] = [];
  private readonly rand: () => number;
  private readonly windAt: SimOptions['wind'];
  private nextGroupId = 1;
  private breakAt: number;
  private breakDone = false;
  private announced = new Set<number>();
  private meState: { id: string; prev: number; pos: number; speed: number } | null = null;

  constructor(course: RaceCourse, roster: RosterEntry[], opts: SimOptions) {
    this.course = course;
    this.rand = rng(opts.seed);
    this.windAt = opts.wind;
    this.breakAt = 90 + this.rand() * 110;
    const start = opts.startFront ?? 0;
    const g: RGroup = this.newGroup(start, 0);
    roster.forEach((e) => {
      const cap = e.capW ?? opts.refWkg * (0.88 + 0.3 * e.ability) * PRO_KG;
      const r: RR = {
        def: e, id: e.id, cap, mass: e.massKg ?? MASS, group: g, off: 0, lane: 2.2, slotKey: 0, pos: start, prev: start, power: 0,
        strain: 0, noRejoinUntil: 0, tiredUntil: 0, noAttackUntil: 0, phase: this.rand() * 10,
        sprintAtDist: 300, sprintElapsed: 0, sprintLine: -1, done: false, finishT: null, gone: false,
      };
      this.rr.push(r);
      g.riders.push(r);
    });
    this.layout(g, 0, true);
    for (const r of this.rr) r.pos = r.prev = this.posOf(r);
  }

  private newGroup(front: number, speed: number): RGroup {
    const g: RGroup = {
      id: this.nextGroupId++, riders: [], front, speed, breakaway: false, dropped: false,
      attackUntil: 0, attackMul: 1, nextAttack: 70 + this.rand() * 80, sortAt: 0, draft: 1,
    };
    this.groups.push(g);
    return g;
  }

  // ----------------------------------------------------- the player ----

  /** Reports the live player's distance (and speed) so they appear in the lines' crossing orders. */
  reportPlayer(id: string, distance: number, speed: number) {
    const m = this.meState ?? (this.meState = { id, prev: distance, pos: distance, speed });
    m.prev = m.pos;
    m.pos = distance;
    m.speed = speed;
    this.crossLines(id, m.prev, m.pos, this.t, 0);
  }

  get playerFinishT(): number | null {
    if (!this.meState) return null;
    return this.course.lines[this.course.lines.length - 1].crossings.find((c) => c.id === this.meState!.id)?.t ?? null;
  }

  // ---------------------------------------------------- group tools ----

  private rowLen(g: RGroup) {
    return Math.max(0, Math.ceil(g.riders.length / this.widthFor(g.riders.length)) - 1) * ROW;
  }

  private widthFor(n: number) {
    return n >= 10 ? 4 : n >= 5 ? 3 : n >= 2 ? 2 : 1;
  }

  /** Targets for every rider's place in the group (row and lane), easing to them unless `snap`. */
  private layout(g: RGroup, dt: number, snap = false) {
    const n = g.riders.length;
    const w = this.widthFor(n);
    const lanes = LANES[w];
    const k = snap ? 1 : 1 - Math.exp(-dt / 1.4);
    // In a crosswind the bunch fans out into diagonal echelons: each row sits a little further downwind
    // than the one ahead (a big bunch wraps into several echelons, four rows each).
    const shift = this.windAt ? draftShift(this.windAt(g.front).cross) : 0;
    const squeeze = 1 - 0.45 * Math.min(1, Math.abs(shift) / SHIFT_MAX);
    g.riders.forEach((r, i) => {
      const row = Math.floor(i / w);
      const targetOff = row * ROW + (i % w) * 0.25;
      r.off += (targetOff - r.off) * k;
      let lane = lanes[i % w];
      if (shift !== 0) {
        lane = 2.3 + (lane - 2.3) * squeeze + ((row % 4) - 1.5) * shift;
        lane = Math.min(4.0, Math.max(0.6, lane));
      }
      r.lane += (lane - r.lane) * k;
    });
  }

  private posOf(r: RR) {
    return r.group.front - r.off;
  }

  private effCap(r: RR, climbing: boolean) {
    return r.cap * (climbing ? r.def.climb : 1) * (r.tiredUntil > this.t ? 0.95 : 1);
  }

  /** Takes riders out of their group into a new one at their own positions. */
  private split(riders: RR[], mut: (g: RGroup) => void): RGroup {
    const from = riders[0].group;
    const front = Math.max(...riders.map((r) => this.posOf(r)));
    const g = this.newGroup(front, from.speed);
    for (const r of riders) {
      const i = from.riders.indexOf(r);
      if (i >= 0) from.riders.splice(i, 1);
      r.off = front - this.posOf(r);
      r.group = g;
      g.riders.push(r);
    }
    mut(g);
    if (!from.riders.length) this.groups.splice(this.groups.indexOf(from), 1);
    return g;
  }

  /** Is a sprint, or the finish, close enough ahead that the group opens up into a sprint? */
  private lineAhead(pos: number, within: number): RaceLine | null {
    for (const l of this.course.lines) {
      if (l.kind === 'summit') continue;
      const to = l.d - pos;
      if (to > -120 && to < within) return l;
    }
    return null;
  }

  // -------------------------------------------------------- events ----

  private emit(kind: RaceEvent['kind'], text: string, ids: string[]) {
    this.events.push({ t: this.t, kind, text, ids });
    if (this.events.length > 40) this.events.shift();
  }

  private label(r: RR) {
    return r.def.name;
  }

  private schedule() {
    const finish = this.course.finish;

    // The early breakaway: 2–4 riders from different teams, in a long stage.
    if (!this.breakDone && this.t >= this.breakAt) {
      const main = this.groups.reduce((a, b) => (b.riders.length > a.riders.length ? b : a), this.groups[0]);
      if (finish < 15000 || !main || main.riders.length < 10 || main.front > finish * 0.25) this.breakDone = true;
      else if (!this.lineAhead(main.front, 900)) {
        this.breakDone = true;
        const want = 2 + Math.floor(this.rand() * 3);
        const pool = main.riders.filter((r) => !r.done).sort((a, b) => b.def.ability + this.rand() * 0.6 - (a.def.ability + this.rand() * 0.6));
        const chosen: RR[] = [];
        const teams = new Set<number>();
        for (const r of pool) {
          if (chosen.length >= want) break;
          if (teams.has(r.def.team)) continue;
          teams.add(r.def.team);
          chosen.push(r);
        }
        if (chosen.length >= 2) {
          this.split(chosen, (g) => { g.breakaway = true; g.attackUntil = this.t + 45; g.attackMul = 1.3; });
          for (const r of chosen) r.noAttackUntil = this.t + 600;
          this.emit('break', `Breakaway! ${chosen.map((r) => this.label(r)).join(', ')} go clear.`, chosen.map((r) => r.id));
        }
      }
    }

    for (const g of [...this.groups]) {
      // Open up into a sprint as the line approaches.
      if (g.riders.length > 1) {
        const l = this.lineAhead(g.front, 460);
        if (l && l.d - g.front > 0) { this.dissolve(g, l); continue; }
      }
      // Attacks from the bunch, on the climbs.
      if (g.riders.length >= 5 && this.t >= g.nextAttack) {
        // A sustained climb (the next 500 m averages 3.5% or more), not a roll in the road.
        const grade = (this.course.grade(g.front + 250) + this.course.grade(g.front + 500) + this.course.grade(g.front)) / 3;
        const toGo = finish - g.front;
        if (this.t > 120 && grade >= 0.035 && toGo > 1200 && !this.lineAhead(g.front, 700)) this.attack(g, toGo / finish);
        else g.nextAttack = this.t + 12;
      }
    }
  }

  private attack(g: RGroup, togoFrac: number) {
    const cand = g.riders
      .filter((r) => !r.done && r.noAttackUntil <= this.t && r.tiredUntil <= this.t)
      .sort((a, b) => this.effCap(b, true) - this.effCap(a, true))
      .slice(0, 7);
    if (cand.length < 2) { g.nextAttack = this.t + 20; return; }
    const weights = cand.map((r, i) => (7 - i) * (r.def.leader ? 1.6 : 1) * (togoFrac < 0.3 && r.def.leader ? 1.5 : 1));
    let x = this.rand() * weights.reduce((a, b) => a + b, 0);
    let pick = cand[0];
    for (let i = 0; i < cand.length; i++) { x -= weights[i]; if (x <= 0) { pick = cand[i]; break; } }
    const chosen = [pick];
    if (this.rand() < 0.35) {
      const mate = cand.find((r) => r !== pick && r.def.team !== pick.def.team);
      if (mate) chosen.push(mate);
    }
    const mul = 1.2 + this.rand() * 0.3;
    const dur = 30 + this.rand() * 60;
    this.split(chosen, (n) => { n.breakaway = true; n.attackUntil = this.t + dur; n.attackMul = mul; });
    for (const r of chosen) { r.noAttackUntil = this.t + 240; r.tiredUntil = this.t + 90 + dur; }
    g.nextAttack = this.t + 100 + this.rand() * 120;
    this.emit('attack', `${chosen.map((r) => this.label(r)).join(' and ')} attack${chosen.length > 1 ? '' : 's'}!`, chosen.map((r) => r.id));
  }

  /** Every rider of a group becomes their own sprinter. */
  private dissolve(g: RGroup, line: RaceLine) {
    const riders = [...g.riders];
    for (const r of riders) {
      const solo = this.split([r], () => {});
      solo.speed = g.speed;
      r.sprintLine = line.d;
      r.sprintElapsed = 0;
      r.sprintAtDist = (line.kind === 'finish' ? 230 : 200) + this.rand() * (line.kind === 'finish' ? 150 : 130);
    }
    if (this.announced.has(line.d)) return;
    this.announced.add(line.d);
    this.emit('sprint', line.kind === 'finish' ? 'The sprint for the line is on!' : `Sprint! ${line.name}.`, []);
  }

  // ------------------------------------------------------------ pace ----

  /** How hard the bunch rides: a steady tempo, more when a group up the road is getting away. */
  private tempo(g: RGroup) {
    let gapSec = 0;
    let ahead: RGroup | null = null;
    for (const o of this.groups) {
      if (o.front > g.front && o.riders.length <= g.riders.length / 2 && (!ahead || o.front < ahead.front)) ahead = o;
    }
    if (ahead) gapSec = (ahead.front - this.rowLen(ahead) - g.front) / Math.max(3, g.speed);
    let e = 0.78 + 0.19 * Math.min(1, Math.max(0, (gapSec - 15) / 90));
    if (g.front > this.course.finish * 0.85) e = Math.max(e, 0.86); // the teams wind it up for the finish
    return e;
  }

  private soloPower(r: RR, g: RGroup, grade: number): number {
    const climbing = grade > 0.03;
    const eff = this.effCap(r, climbing);
    if (r.done) return 0.3 * r.cap;
    if (g.attackUntil > this.t) return eff * g.attackMul;
    const l = r.sprintLine >= 0 ? this.course.lines.find((x) => x.d === r.sprintLine && x.kind !== 'summit') : undefined;
    if (l) {
      const to = l.d - r.pos;
      if (to <= 0 && l.kind === 'sprint') return 0.7 * r.cap; // past the banner: ease off
      if (to > 0) return 1.0 * eff; // the lead-out, before the sprint opens (see moveGroup)
    }
    return eff * (g.breakaway ? 0.93 : g.dropped ? 0.88 : 0.93);
  }

  private moveGroup(g: RGroup, dt: number) {
    const n = g.riders.length;
    if (!n) return;
    const grade = this.course.grade(g.front);
    const climbing = grade > 0.03;
    let P: number;
    if (n === 1) {
      const r = g.riders[0];
      r.pos = this.posOf(r);
      const l = r.sprintLine >= 0 ? this.course.lines.find((x) => x.d === r.sprintLine && x.kind !== 'summit') : undefined;
      if (!r.done && l && l.d - r.pos > 0 && l.d - r.pos < r.sprintAtDist && g.attackUntil <= this.t) {
        r.sprintElapsed += dt;
        P = r.cap * r.def.sprint * (r.sprintElapsed < 20 ? 1 : 0.7) * (r.tiredUntil > this.t ? 0.97 : 1);
      } else P = this.soloPower(r, g, grade);
      r.power = P;
    } else {
      if (this.t >= g.sortAt) {
        g.sortAt = this.t + 2;
        g.riders.sort((a, b) => this.slotScore(b, climbing) - this.slotScore(a, climbing));
      }
      // The pace is set between the strongest and the typical rider: most of the group can sit on it.
      const caps = g.riders.map((r) => this.effCap(r, climbing)).sort((a, b) => b - a);
      const top = caps.slice(0, 3).reduce((a, c) => a + c, 0) / Math.min(3, caps.length);
      const capRef = 0.4 * top + 0.6 * caps[Math.floor(caps.length * 0.4)];
      let effort: number;
      if (g.attackUntil > this.t) effort = g.attackMul;
      else if (g.breakaway) effort = 0.93;
      else if (n >= 6) effort = this.tempo(g);
      else if (g.dropped) effort = 0.82;
      else effort = 0.9;
      P = effort * capRef;
      g.riders.forEach((r, i) => { r.power = i < 3 ? P : P * 0.78; });
    }
    if (grade < -0.045) P *= 0.4; // soft-pedal the steep descents
    if (g.front > this.course.finish + 20) P *= 0.35; // rolling out after the line

    const cda = DEFAULT_PARAMS.cda * (n === 1 ? g.draft : n >= 10 ? 0.9 : n >= 5 ? 0.93 : 0.95);
    const mass = g.riders.reduce((a, r) => a + r.mass, 0) / n;
    g.speed = stepSpeed(g.speed, P, grade, dt, { massKg: mass, cda, crr: DEFAULT_PARAMS.crr }, this.windAt?.(g.front).head ?? 0);
    g.speed = Math.max(g.speed, 1.3); // even the steepest ramp is climbed, if only by weaving
    g.front += g.speed * dt;

    // Who is cracking? Followers sit in the draft; on a climb there's little shelter.
    if (n > 1) {
      // What the pace asks of a follower is judged at the speed that power sustains
      // (not today's speed, which may be momentum from the last descent).
      const theta = Math.atan(grade);
      const a = mass * 9.81 * (Math.sin(theta) + DEFAULT_PARAMS.crr * Math.cos(theta));
      const b = 0.5 * 1.225 * cda;
      let v = Math.max(1, g.speed);
      for (let k = 0; k < 5; k++) v = Math.min(30, Math.max(1, v - (a * v + b * v * v * v - P * 0.976) / (a + 3 * b * v * v)));
      v = Math.min(v, g.speed + 0.5);
      const base = (a * v) / 0.976;
      const drag = (0.5 * 1.225 * DEFAULT_PARAMS.cda * v * v * v) / 0.976;
      const shelter = n >= 10 ? 0.7 : n >= 5 ? 0.78 : 0.86;
      const cracked: RR[] = [];
      g.riders.forEach((r, i) => {
        const need = base + drag * (i < 3 ? 0.95 : shelter);
        if (need > this.effCap(r, climbing) * 1.06 && grade > -0.03) r.strain += dt;
        else r.strain = Math.max(0, r.strain - dt * 0.5);
        if (r.strain > 6 && i >= 3 && g.attackUntil <= this.t) cracked.push(r);
      });
      if (cracked.length && n - cracked.length >= 1) {
        const at = this.t;
        this.split(cracked, (d) => { d.dropped = true; });
        for (const r of cracked) { r.strain = 0; r.noRejoinUntil = at + 25; }
        const big = cracked.find((r) => r.def.leader);
        if (big) this.emit('drop', `${this.label(big)} is dropped.`, [big.id]);
      }
    }
  }

  private slotScore(r: RR, climbing: boolean) {
    return this.effCap(r, climbing) * (1 + 0.07 * Math.sin(this.t / 37 + r.phase));
  }

  // -------------------------------------------------------- stepping ----

  private contest(g: RGroup) {
    return !!this.lineAhead(g.front, 480) || this.course.lines.some((l) => l.kind !== 'summit' && g.front - l.d >= 0 && g.front - l.d < 120);
  }

  private merge() {
    this.groups.sort((a, b) => b.front - a.front);
    for (let i = 0; i < this.groups.length - 1; i++) {
      const b = this.groups[i];
      const a = this.groups[i + 1];
      const rear = b.front - this.rowLen(b);
      const ok = a.front >= rear - 2 && a.speed >= b.speed - 0.5 && b.attackUntil <= this.t && a.attackUntil <= this.t
        && a.riders.every((r) => r.noRejoinUntil <= this.t) && !this.contest(b) && !this.contest(a);
      if (!ok) continue;
      const n = a.riders.length + b.riders.length;
      b.speed = (a.speed * a.riders.length + b.speed * b.riders.length) / n;
      for (const r of a.riders) { r.off = b.front - this.posOf(r); r.group = b; r.strain = 0; }
      const bigCatch = a.riders.length >= 8 && b.breakaway;
      const caughtIds = b.riders.map((r) => r.id);
      b.riders.push(...a.riders);
      b.riders.sort((x, y) => this.posOf(y) - this.posOf(x));
      if (bigCatch) this.emit('caught', `The break is caught${caughtIds.length > 1 ? ` (${caughtIds.length} riders)` : ''}.`, caughtIds);
      if (n >= 8) { b.breakaway = false; b.dropped = false; }
      else if (b.breakaway && a.riders.length >= b.riders.length - a.riders.length) b.breakaway = false;
      this.groups.splice(i + 1, 1);
      i--;
    }
  }

  private crossLines(id: string, prev: number, pos: number, t: number, dt: number) {
    for (const l of this.course.lines) {
      if (prev < l.d && pos >= l.d) {
        const f = pos > prev ? (pos - l.d) / (pos - prev) : 0;
        l.crossings.push({ id, t: t - dt * f });
      }
    }
  }

  step(dt: number) {
    this.t += dt;
    this.schedule();
    for (const g of [...this.groups]) this.moveGroup(g, dt);
    this.merge();
    // Shelter for solo riders behind another group.
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      g.draft = 1;
      const ahead = this.groups[i - 1];
      if (g.riders.length === 1 && ahead) {
        const gap = ahead.front - this.rowLen(ahead) - g.front;
        g.draft = gap < 2.5 ? 0.78 : gap < 6 ? 0.85 : gap < 12 ? 0.93 : 1;
      }
    }
    for (const g of this.groups) {
      this.layout(g, dt);
      for (const r of g.riders) {
        r.prev = r.pos;
        r.pos = this.posOf(r);
        if (!r.done) {
          const before = this.course.lines.length ? this.course.lines[this.course.lines.length - 1].crossings.length : 0;
          this.crossLines(r.id, r.prev, r.pos, this.t, dt);
          if (this.course.lines[this.course.lines.length - 1].crossings.length > before) {
            r.done = true;
            r.finishT = this.course.lines[this.course.lines.length - 1].crossings[before].t;
          }
        } else if (r.pos > this.course.finish + 300) r.gone = true;
      }
    }
    // Groups with nobody left to show are dropped.
    this.groups = this.groups.filter((g) => g.riders.some((r) => !r.gone));
  }

  /** Has every computer rider crossed the line? */
  get allFinished() {
    return this.rr.every((r) => r.done);
  }

  /** Runs on in big steps until everyone has finished (for results and "simulate this stage"). */
  runToEnd(maxSeconds = 4 * 3600) {
    while (!this.allFinished && this.t < maxSeconds) this.step(0.5);
  }

  // --------------------------------------------------------- readouts ----

  states(): RiderState[] {
    return this.rr.map((r) => ({
      id: r.id, name: r.def.name, team: r.def.team, leader: r.def.leader,
      pos: r.pos, speed: r.group.speed, power: r.power, lane: r.lane, groupSize: r.group.riders.length,
      done: r.done, gone: r.gone,
    }));
  }

  /** Groups on the road, front first, with their gap to the leaders in seconds. */
  groupSummary(): { size: number; front: number; rear: number; gapSec: number; breakaway: boolean; ids: string[] }[] {
    const gs = [...this.groups].filter((g) => g.riders.some((r) => !r.gone)).sort((a, b) => b.front - a.front);
    const lead = gs[0];
    return gs.map((g) => ({
      size: g.riders.length,
      front: g.front,
      rear: g.front - this.rowLen(g),
      gapSec: lead ? Math.max(0, (lead.front - g.front) / Math.max(3, lead.speed)) : 0,
      breakaway: g.breakaway,
      ids: g.riders.map((r) => r.id),
    }));
  }

  /** The next sprint banner or summit ahead of `pos`, if any. */
  nextLine(pos: number): RaceLine | null {
    for (const l of this.course.lines) if (l.d > pos && l.kind !== 'finish') return l;
    return null;
  }
}

// ------------------------------------------------------ classifications ----

export interface RiderResult {
  id: string;
  time: number | null; // stage time, seconds
  sprint: number; // points from sprints and the finish
  kom: number; // points from summits
}

/** Points for every rider from the order they crossed each line. */
export function awardPoints(lines: RaceLine[]): Map<string, { sprint: number; kom: number }> {
  const out = new Map<string, { sprint: number; kom: number }>();
  const add = (id: string, key: 'sprint' | 'kom', pts: number) => {
    const e = out.get(id) ?? { sprint: 0, kom: 0 };
    e[key] += pts;
    out.set(id, e);
  };
  for (const l of lines) {
    const order = [...l.crossings].sort((a, b) => a.t - b.t);
    const table = l.kind === 'sprint' ? SPRINT_POINTS : l.kind === 'finish' ? FINISH_POINTS : KOM_POINTS[l.cat ?? 4];
    order.forEach((c, i) => { if (i < table.length) add(c.id, l.kind === 'summit' ? 'kom' : 'sprint', table[i]); });
  }
  return out;
}

/** Stage times with the bunch rule: finishing within a second of the rider ahead gives the same time. */
export function stageTimes(lines: RaceLine[]): Map<string, number> {
  const finish = lines[lines.length - 1].crossings.slice().sort((a, b) => a.t - b.t);
  const out = new Map<string, number>();
  let last = -Infinity;
  let held = 0;
  for (const c of finish) {
    if (c.t - last < 1) { out.set(c.id, held); last = c.t; continue; }
    held = c.t;
    last = c.t;
    out.set(c.id, c.t);
  }
  return out;
}

/** Everyone's stage result, sorted by time. */
export function stageResults(lines: RaceLine[]): RiderResult[] {
  const times = stageTimes(lines);
  const pts = awardPoints(lines);
  const ids = new Set<string>([...times.keys(), ...pts.keys()]);
  const out: RiderResult[] = [];
  for (const id of ids) out.push({ id, time: times.get(id) ?? null, sprint: pts.get(id)?.sprint ?? 0, kom: pts.get(id)?.kom ?? 0 });
  return out.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
}
