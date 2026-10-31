// A race you are riding: the countdown, the field racing with you (peloton.ts,
// raceSim.ts), the live panel's numbers and the results at the finish. No DOM:
// raceUi.ts draws it and main.ts feeds it the player's distance each frame.

import { TEAMS, makeRoster, type RaceField } from './peloton';
import { awardPoints, makeCourse, stageResults, type RaceCourse, type RosterEntry } from './raceSim';
import type { Stage } from './stages';

export const ME = 'me';

export interface Totals { time: number; sprint: number; kom: number }

export interface ResultRow {
  id: string;
  name: string; // "Hugo (Emigrates)", or "You"
  team: number; // index into TEAMS, -1 for you
  time: number;
  sprint: number;
  kom: number;
  you: boolean;
}

export interface PanelData {
  place: number;
  total: number;
  gapSec: number; // behind the rider in front of the race
  leader: string;
  groups: { label: string; size: number; gapSec: number; you: boolean }[];
  next: { text: string; toGo: number } | null;
  jerseys: { yellow: string | null; green: string | null; polka: string | null };
  message: string | null;
  raceTime: number;
}

const short = (t: number) => TEAMS[t]?.short ?? '';

export class LiveRace {
  phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  readonly course: RaceCourse;
  readonly roster: RosterEntry[];
  private countdown = 3; // seconds until GO (3, 2, 1, GO!)
  private shown = 4;
  private message: { text: string; until: number } | null = null;
  private done: ResultRow[] | null = null;
  /** Called on each countdown beep (`true` for the long one as the race starts). */
  onBeep: (last: boolean) => void = () => {};
  /** Called with notable moments (attacks, the break, sprints) as they happen. */
  onEvent: (text: string, kind: string) => void = () => {};

  constructor(
    readonly stage: Stage,
    readonly field: RaceField,
    /** Totals from earlier stages of a tour (empty for a single race). */
    readonly prior: Map<string, Totals>,
    /** Which tour stage this is (1–3), if racing a tour. */
    readonly tourStage: number | null = null,
  ) {
    this.roster = field.roster;
    this.course = field.sim.course;
  }

  /** True while the field waits on the line and you must not move. */
  get holding() {
    return this.phase === 'countdown';
  }

  /** Seconds since the start. */
  get time() {
    return this.field.sim.t;
  }

  get countText(): string | null {
    if (this.phase !== 'countdown') return this.phase === 'racing' && this.time < 1.2 ? 'GO!' : null;
    return String(Math.max(1, Math.ceil(this.countdown)));
  }

  /** Advances the race by one frame. `distance` and `speed` are the player's. */
  update(dt: number, distance: number, speed: number) {
    const sim = this.field.sim;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.max(0, Math.ceil(this.countdown));
      if (n < this.shown) {
        this.shown = n;
        this.onBeep(n === 0);
      }
      if (this.countdown <= 0) this.phase = 'racing';
      return;
    }
    if (this.phase === 'finished') return;
    sim.step(dt);
    sim.reportPlayer(ME, distance, speed);
    for (const e of sim.events.splice(0)) {
      this.message = { text: e.text, until: performance.now() + 12000 };
      this.onEvent(e.text, e.kind);
    }
    if (sim.playerFinishT !== null) this.phase = 'finished';
  }

  get playerFinished() {
    return this.phase === 'finished';
  }

  nameOf(id: string): string {
    if (id === ME) return 'You';
    const e = this.roster.find((r) => r.id === id);
    return e ? `${e.name} (${short(e.team)})` : id;
  }

  /** Lets the rest of the field finish (fast), then returns everyone's stage result, best first. */
  results(): ResultRow[] {
    if (this.done) return this.done;
    this.field.sim.runToEnd();
    const rows: ResultRow[] = [];
    for (const r of stageResults(this.course.lines)) {
      if (r.time === null) continue;
      const e = this.roster.find((x) => x.id === r.id);
      rows.push({ id: r.id, name: this.nameOf(r.id), team: e ? e.team : -1, time: r.time, sprint: r.sprint, kom: r.kom, you: r.id === ME });
    }
    this.done = rows;
    return rows;
  }

  /** The live panel's numbers, for a player at `distance`. */
  panel(distance: number): PanelData {
    const sim = this.field.sim;
    const states = sim.states();
    let ahead = 0;
    let lead = distance;
    let leadSpeed = 6;
    let leadId = ME;
    for (const s of states) {
      if (s.pos > distance + 0.5) ahead++;
      if (s.pos > lead) { lead = s.pos; leadSpeed = s.speed; leadId = s.id; }
    }
    const gapSec = Math.max(0, (lead - distance) / Math.max(3, leadSpeed));

    const gs = sim.groupSummary();
    const groups: PanelData['groups'] = gs.slice(0, 5).map((g, i) => ({
      label: i === 0 ? (g.breakaway ? 'Break' : g.size >= 10 ? 'Bunch' : 'Leaders') : g.size >= 10 ? 'Bunch' : g.breakaway && g.gapSec < 240 ? 'Chasers' : 'Group',
      size: g.size,
      gapSec: g.gapSec,
      you: distance >= g.rear - 12 && distance <= g.front + 6,
    }));
    if (!groups.some((g) => g.you)) {
      // Alone on the road: slot "you" in where you are, ahead of or between the groups.
      const at = gs.slice(0, 5).findIndex((g) => g.front < distance);
      groups.splice(at < 0 ? groups.length : at, 0, { label: 'You', size: 1, gapSec, you: true });
      if (groups.length > 5) groups.pop();
    }

    const nextLine = sim.nextLine(distance);
    const fin = this.course.finish;
    let next: PanelData['next'] = null;
    if (nextLine && nextLine.d - distance < 4000) {
      next = { toGo: nextLine.d - distance, text: nextLine.kind === 'sprint' ? nextLine.name : `${nextLine.name}${nextLine.cat === 0 ? ' (HC)' : ` (cat ${nextLine.cat})`}` };
    } else if (fin - distance < 4000) next = { toGo: fin - distance, text: 'Finish' };

    return {
      place: ahead + 1,
      total: states.length + 1,
      gapSec,
      leader: leadId === ME ? 'You' : this.nameOf(leadId),
      groups,
      next,
      jerseys: this.jerseys(states, lead, leadSpeed, distance),
      message: this.message && this.message.until > performance.now() ? this.message.text : null,
      raceTime: sim.t,
    };
  }

  /** Who would wear each jersey right now: earlier stages plus what has happened today. */
  private jerseys(states: ReturnType<RaceField['sim']['states']>, lead: number, leadSpeed: number, myDist: number): PanelData['jerseys'] {
    const pts = awardPoints(this.course.lines);
    const ids = [ME, ...states.map((s) => s.id)];
    let yellow: string | null = null, green: string | null = null, polka: string | null = null;
    let bestT = Infinity, bestS = 0, bestK = 0;
    for (const id of ids) {
      const pos = id === ME ? myDist : states.find((s) => s.id === id)!.pos;
      const prior = this.prior.get(id);
      const t = (prior?.time ?? 0) + Math.max(0, (lead - pos) / Math.max(3, leadSpeed));
      if (t < bestT) { bestT = t; yellow = id; }
      const p = pts.get(id);
      const sprint = (prior?.sprint ?? 0) + (p?.sprint ?? 0);
      const kom = (prior?.kom ?? 0) + (p?.kom ?? 0);
      if (sprint > bestS) { bestS = sprint; green = id; }
      if (kom > bestK) { bestK = kom; polka = id; }
    }
    const n = (id: string | null) => (id ? this.nameOf(id) : null);
    return { yellow: n(yellow), green: n(green), polka: n(polka) };
  }
}

/** The seeded field for a race, and the sim course for a stage. */
export function raceSetup(stage: Stage, seed: number) {
  return {
    roster: makeRoster(seed),
    course: makeCourse({ finish: stage.finish!, elevationAt: stage.elevationAt, race: stage.race }),
  };
}
