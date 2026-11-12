// Worlds and routes: a world is one closed loop with everything that is defined in lap metres and world
// coordinates (its road, scenery, landmarks, places, race points); a route is a window on that loop, compiled
// by `routeStage()` into an ordinary Stage with its own permanent id. Leaderboards, ghosts, saved rides, presence and
// the limit tables are all keyed by stage id, so they work on a route unchanged. See
// docs/developer-guide/stages-and-gpx.md ("Worlds and routes") and kestrel-vale-plan.md.
//
// This file and the worlds that use it import only *types* from ../stages (stages.ts imports the routes at run time:
// a value import back would be a cycle). Run-time helpers come from ../stageKit and the leaf modules in ../world/.

import { finishArch, GANTRY, namedPlaces, roadTrace, startArch } from '../stageKit';
import type { CultureId } from '../world/cultureTypes';
import type { WaterBody } from '../world/waterTypes';
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
  /** One line on the world, for the hub's world card. */
  tagline: string;
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
  /** Whole laps: how many (from the start); null = an endless free ride. Leave out for a partial route (`length`). */
  laps?: number | null;
  /** A partial route's length, m (a route has exactly one of `laps` or `length`). It may run across the lap line. */
  length?: number;
  /** Lap metres where the route starts (default 0). Pick a point on a straight: the road behind the start is the real road (course.ts). */
  start?: number;
}

/** Laps of signs a free ride is given (it is endless, the list is not): about 185 km. */
const ENDLESS_LAPS = 12;

/** The road's (x east, z south) at lap metre `u`, as the world's own trace (every 10 m, midpoint rule) has it, interpolated. */
function tracePoint(headingAt: (d: number) => number, u: number): [number, number] {
  if (u <= 0) return [0, 0];
  const step = 10;
  const t = roadTrace(headingAt, u, step);
  const f = u / step;
  const i = Math.min(t.length - 2, Math.floor(f));
  const k = f - i;
  return [t[i][0] + (t[i + 1][0] - t[i][0]) * k, t[i][1] + (t[i + 1][1] - t[i][1]) * k];
}

/** Compiles a route into an ordinary Stage. */
export function routeStage(world: World, route: WorldRoute): Stage {
  const lap = world.lap;
  const start = route.start ?? 0;
  if (!(start >= 0 && start < lap)) throw new Error(`routeStage ${route.id}: start ${start} is outside the lap`);
  const partial = route.length !== undefined;
  if (partial === (route.laps !== undefined)) throw new Error(`routeStage ${route.id}: give exactly one of laps and length`);
  const laps = partial ? undefined : route.laps!;
  const finish = partial ? route.length! : laps === null ? null : lap * laps!;
  // A route that does not start on the lap line (or is not whole laps) is "shifted": everything positional is moved.
  const shifted = start !== 0 || partial;
  const mod = (d: number) => ((d % lap) + lap) % lap;
  const limit = finish ?? ENDLESS_LAPS * lap;
  const kMax = Math.ceil((limit + start) / lap) + 1;
  /** The route distances of lap metre `d`, on every lap the route covers (inside [0, finish], or the endless route's signs). */
  const at = (d: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k <= kMax; k++) {
      const p = d - start + k * lap;
      if (p >= 0 && (finish === null ? p < limit : p <= finish)) out.push(p);
    }
    return out;
  };
  const E0 = world.elevationAt(mod(start));
  const P = tracePoint(world.headingAt, start);
  // The start arch, a banner over every sprint, and the line: a finite route's line is each lap's end (the end of a partial route), an endless one's the gantry every lap.
  const sprintArches = (world.race.sprints ?? []).flatMap((sp) => at(sp.d).map((p) => finishArch(p)));
  const lineAt = mod(-start) || lap;
  const line: LandmarkKind[] = finish === null ? [{ ...GANTRY, first: lineAt, every: lap }] : partial ? [finishArch(finish)] : Array.from({ length: laps! }, (_, i) => finishArch(lap * (i + 1)));
  const landmarks: LandmarkKind[] = [startArch, ...line, ...sprintArches.sort((a, b) => a.first - b.first), ...(shifted ? shiftLandmarks(world.landmarks) : copyUntils(world.landmarks))];
  // A stretch of houses along one side has an `until` in lap metres: it is copied to every lap (the rest repeat on their own).
  function copyUntils(kinds: LandmarkKind[]): LandmarkKind[] {
    const signLaps = laps ?? ENDLESS_LAPS;
    return kinds.flatMap((k) => (k.until === undefined ? [k] : Array.from({ length: signLaps }, (_, i) => ({ ...k, first: k.first + i * lap, until: k.until! + i * lap }))));
  }
  // The same for a route that starts part way round: each kind is re-phased by -start and cut to the route.
  function shiftLandmarks(kinds: LandmarkKind[]): LandmarkKind[] {
    const out: LandmarkKind[] = [];
    for (const k of kinds) {
      const every = Math.min(k.every, lap);
      const moved: LandmarkKind = k.world ? { ...k, world: { ...k.world, x: k.world.x - P[0], z: k.world.z - P[1], y: k.world.y - E0 } } : k;
      if (k.until !== undefined) {
        for (let m = -1; m <= kMax; m++) {
          let first = k.first + m * lap - start;
          const until = Math.min(k.until + m * lap - start, limit);
          if (first < 0) first += Math.ceil(-first / every) * every;
          if (first <= until) out.push({ ...moved, first, until });
        }
      } else {
        const first = (((k.first - start) % every) + every) % every;
        if (first <= limit) out.push({ ...moved, first, every, until: finish ?? undefined });
      }
    }
    return out;
  }
  const places: [number, string][] = world.places.flatMap(([d, name]) => at(d).map((p): [number, string] => [p, name])).sort((a, b) => a[0] - b[0]);
  const raceOf = <T extends { d: number }>(list: T[] | undefined): T[] => (list ?? []).flatMap((x) => at(x.d).map((p) => ({ ...x, d: p }))).sort((a, b) => a.d - b.d);
  // Where the world's elevation, heading and ground are, seen from the route: a point at world (x, z) is at (x - P.x, z - P.z); heights are lowered by E0.
  const wrap = (d: number) => mod(d + start);
  const sc = world.scenery;
  const shiftBody = (b: WaterBody): WaterBody => b.kind === 'sea' ? { ...b, level: b.level - E0 }
    : b.kind === 'pond' ? { ...b, x: b.x - P[0], z: b.z - P[1], level: b.level - E0 }
    : { ...b, pts: b.pts.map(([x, z]) => [x - P[0], z - P[1]] as [number, number]), level: b.level - E0 };
  const scenery: Scenery = start === 0 ? sc : {
    ...sc,
    wildHeight: (x, z) => sc.wildHeight(x + P[0], z + P[1]) - E0,
    rockLine: sc.rockLine - E0,
    snowLine: sc.snowLine - E0,
    treeLine: sc.treeLine - E0,
    screeLine: sc.screeLine === undefined ? undefined : sc.screeLine - E0,
    // `plain` and the result are heights relative to the road, which the move does not change; only the distance is the world's.
    roadside: sc.roadside ? (d, lateral, plain) => sc.roadside!(wrap(d), lateral, plain) : undefined,
    walls: sc.walls ? (d) => sc.walls!(wrap(d)) : undefined,
    clearing: sc.clearing ? (d) => sc.clearing!(wrap(d)) : undefined,
    water: sc.water?.map(shiftBody),
  };
  const spots = world.crowdSpots;
  // Whole laps from the start keep `lapLength` (the lap counter, the segments' passes, the crowds' modular spots); a route that does not
  // start on the line or is not whole laps has no laps to count, so its spots are listed out for its own length.
  const lapLength = shifted && finish !== null ? undefined : lap;
  const crowdSpots = !spots ? undefined : start === 0 && !partial ? spots : lapLength !== undefined ? spots.map(mod2(start, lap)) : spots.flatMap(at);
  return {
    id: route.id,
    name: route.name,
    tagline: route.tagline,
    finish,
    lapLength,
    elevationAt: (d) => world.elevationAt(mod(d + start)) - E0,
    headingAt: (d) => {
      const u = start + d;
      if (u >= 0) return world.headingAt(u);
      // Behind the start line, round the lap's far end: the same heading `world.turn` further on, so the road behind a route that starts at the line is the loop's own last stretch.
      const k = Math.ceil(-u / lap);
      return world.headingAt(u + k * lap) - k * world.turn;
    },
    scenery,
    landmarks,
    signs: namedPlaces(places, lap, 1),
    baseAltitude: world.baseAltitude + E0,
    timeOfDay: world.timeOfDay,
    weather: world.weather,
    wind: world.wind,
    culture: world.culture,
    crowdSpots,
    climb: false,
    race: { sprints: raceOf(world.race.sprints), summits: raceOf(world.race.summits) },
    world: {
      id: world.id, route: route.id, start, name: world.name, tagline: world.tagline, lap,
      // The canonical one-lap route from the lap line, which segments.ts finds the world's segments on (once per world).
      lapStage: () => routeStage(world, { id: `${world.id}-lap`, name: world.name, tagline: '', laps: 1 }),
    },
  };
}

function mod2(start: number, lap: number) {
  return (d: number) => (((d - start) % lap) + lap) % lap;
}
