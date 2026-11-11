// Worlds and routes: a world is one closed loop with everything that is defined in lap metres and world
// coordinates (its road, scenery, landmarks, places, race points); a route is a window on that loop, compiled
// by `routeStage()` into an ordinary Stage with its own permanent id. Leaderboards, ghosts, saved rides, presence and
// the limit tables are all keyed by stage id, so they work on a route unchanged. See
// docs/developer-guide/stages-and-gpx.md ("Worlds and routes") and kestrel-vale-plan.md.
//
// This file and the worlds that use it import only *types* from ../stages (stages.ts imports the routes at run time:
// a value import back would be a cycle). Run-time helpers come from ../stageKit and the leaf modules in ../world/.

import { finishArch, GANTRY, namedPlaces, startArch } from '../stageKit';
import type { CultureId } from '../world/cultureTypes';
import type { LandmarkKind, RacePoints, Scenery, Stage } from '../stages';

// --------------------------------------------------------------- the loop ----

/** One piece of a hand-built loop: `len` metres of road that turn `turnDeg` degrees to the LEFT overall (negative: right), spread evenly over its length. */
export interface LoopPiece {
  len: number;
  turnDeg: number;
  /** What the piece is, for the code that reads the solved loop back. */
  name?: string;
}

export interface ClosedLoop {
  /** The pieces with the two straights' lengths solved. */
  pieces: LoopPiece[];
  /** Where each piece starts, in lap metres. */
  starts: number[];
  /** The lap's length, m. */
  lap: number;
  /** How much the heading changes over one lap, radians: -2π for a loop that turns left once (heading grows clockwise on the map, so a left turn lowers it). */
  turn: number;
  /** The direction of travel at lap metre `u`, plus one lap's turn for every whole lap, as `Stage.headingAt` wants it (the first piece starts along +x). */
  headingAt(d: number): number;
  /** Where the loop ends relative to where it starts (a metre or so at most, after the solve: it is ~1e-9 m). */
  gap: number;
}

/**
 * Closes a loop built from pieces: it solves a 2x2 linear system for the lengths of two straights (`slackA`, `slackB`:
 * their indices in `pieces`, whose lengths in the input are only first guesses) so that the end lands on the start.
 * The straights must run in different directions (else there is no solution). Everything but those two is taken as given,
 * so the lap's length is whatever the solve gives, which a test pins. The loop must also turn a whole number of times,
 * which the caller makes true by choosing the `turnDeg`s.
 */
export function closeLoop(input: readonly LoopPiece[], slackA: number, slackB: number): ClosedLoop {
  const pieces = input.map((p) => ({ ...p }));
  const turns = pieces.map((p) => (p.turnDeg * Math.PI) / 180);
  // Heading at the start of each piece (left turns lower it), and the displacement of every piece except the two slack straights.
  const h0: number[] = [];
  let h = 0;
  let sx = 0;
  let sz = 0;
  pieces.forEach((p, i) => {
    h0.push(h);
    if (i !== slackA && i !== slackB) {
      const t = -turns[i];
      if (Math.abs(t) < 1e-12) { sx += p.len * Math.cos(h); sz += p.len * Math.sin(h); }
      else { sx += (p.len / t) * (Math.sin(h + t) - Math.sin(h)); sz += (p.len / t) * (Math.cos(h) - Math.cos(h + t)); }
    } else if (Math.abs(turns[i]) > 1e-12) {
      throw new Error('closeLoop: the two slack pieces must be straights');
    }
    h += -turns[i];
  });
  // lenA * (cos hA, sin hA) + lenB * (cos hB, sin hB) = -(sx, sz)
  const ax = Math.cos(h0[slackA]), az = Math.sin(h0[slackA]);
  const bx = Math.cos(h0[slackB]), bz = Math.sin(h0[slackB]);
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-6) throw new Error('closeLoop: the two slack straights run in the same direction');
  const lenA = (-sx * bz + sz * bx) / det;
  const lenB = (-ax * sz + az * sx) / det;
  if (!(lenA > 0 && lenB > 0)) throw new Error(`closeLoop: no positive solution (${lenA.toFixed(1)}, ${lenB.toFixed(1)}): adjust the other pieces`);
  pieces[slackA].len = lenA;
  pieces[slackB].len = lenB;
  const starts: number[] = [];
  let lap = 0;
  for (const p of pieces) { starts.push(lap); lap += p.len; }
  const turn = h; // -(sum of turns)
  const headingBase = (u: number) => {
    let i = 0;
    while (i + 1 < pieces.length && starts[i + 1] <= u) i++;
    const p = pieces[i];
    return h0[i] - (turns[i] * Math.min(p.len, u - starts[i])) / p.len;
  };
  const headingAt = (d: number) => {
    if (d <= 0) return 0;
    const laps = Math.floor(d / lap);
    return headingBase(d - laps * lap) + laps * turn;
  };
  // How far the integrated end is from the start (exact for the pieces: arcs and straights).
  const gap = Math.hypot(sx + lenA * ax + lenB * bx, sz + lenA * az + lenB * bz);
  return { pieces, starts, lap, turn, headingAt, gap };
}

// --------------------------------------------------------------- the world ----

export interface World {
  id: string;
  name: string;
  /** The lap's length, m. */
  lap: number;
  /** The heading change over one lap, radians (see ClosedLoop). */
  turn: number;
  /** Heading as `Stage.headingAt`: absolute distance in, laps adding their turn. */
  headingAt(d: number): number;
  /** Elevation in lap metres, periodic (0 at lap metre 0). */
  elevationAt(u: number): number;
  scenery: Scenery;
  /** Landmarks in lap metres: every `every` divides the lap (a one-off repeats each lap with `every` = lap), so every lap looks the same. A kind with an `until` (a street of houses) is copied to each lap. */
  landmarks: LandmarkKind[];
  /** Named places (announced, not drawn), in lap metres. */
  places: [number, string][];
  /** Sprints and summits in the first lap's metres; they repeat every lap. */
  race: RacePoints;
  /** Where spectators gather as at a hairpin, in the first lap's metres (repeated each lap by `Stage.lapLength`). */
  crowdSpots?: number[];
  baseAltitude: number;
  culture: CultureId;
  weather?: Stage['weather'];
  timeOfDay?: Stage['timeOfDay'];
  wind?: Stage['wind'];
}

/** A route: a window on a world's loop, with its own permanent stage id. */
export interface WorldRoute {
  /** The stage id: permanent once shipped (leaderboards, ghosts and saved rides key on it). */
  id: string;
  /** "World · Route", so `shortStageName()` gives the route's own name. */
  name: string;
  tagline: string;
  /** How many laps it is; null = an endless free ride. */
  laps: number | null;
  /**
   * Lap metres where the route starts. Always 0 for now: a route that starts part way round needs the road behind the
   * start drawn on the real road (course.ts draws it straight), and the elevation, landmarks and places shifted by it.
   * TODO(milestone 2): support `start` in `routeStage` (elevation s + d minus that at s, landmarks and places moved by -s).
   */
  start?: 0;
}

/** Laps of signs a free ride is given (it is endless, the list is not): about 185 km. */
const ENDLESS_LAPS = 12;

/** Compiles a route into an ordinary Stage. */
export function routeStage(world: World, route: WorldRoute): Stage {
  const lap = world.lap;
  const laps = route.laps;
  const finish = laps === null ? null : lap * laps;
  const signLaps = laps ?? ENDLESS_LAPS;
  const per = <T>(f: (offset: number) => T[]): T[] => Array.from({ length: signLaps }, (_, i) => f(i * lap)).flat();
  const mod = (d: number) => ((d % lap) + lap) % lap;
  // The start arch, a banner over every sprint, and the line: a finite route's line is each lap's end, an endless one's the gantry every lap.
  const sprintArches = per((o) => (world.race.sprints ?? []).map((sp) => finishArch(sp.d + o)));
  const line: LandmarkKind[] = laps === null ? [{ ...GANTRY, first: lap, every: lap }] : Array.from({ length: laps }, (_, i) => finishArch(lap * (i + 1)));
  // A stretch of houses along one side has an `until` in lap metres: it is copied to every lap (the rest repeat on their own).
  const world_ = world.landmarks.flatMap((k) => (k.until === undefined ? [k] : Array.from({ length: signLaps }, (_, i) => ({ ...k, first: k.first + i * lap, until: k.until! + i * lap }))));
  const landmarks: LandmarkKind[] = [startArch, ...line, ...sprintArches, ...world_];
  return {
    id: route.id,
    name: route.name,
    tagline: route.tagline,
    finish,
    lapLength: lap,
    elevationAt: (d) => world.elevationAt(mod(d)) - world.elevationAt(0),
    headingAt: world.headingAt,
    scenery: world.scenery,
    landmarks,
    signs: namedPlaces(world.places, lap, signLaps),
    baseAltitude: world.baseAltitude,
    timeOfDay: world.timeOfDay,
    weather: world.weather,
    wind: world.wind,
    culture: world.culture,
    crowdSpots: world.crowdSpots,
    climb: false,
    race: {
      sprints: per((o) => (world.race.sprints ?? []).map((s) => ({ ...s, d: s.d + o }))),
      summits: per((o) => (world.race.summits ?? []).map((s) => ({ ...s, d: s.d + o }))),
    },
    world: { id: world.id, route: route.id, start: 0 },
  };
}
