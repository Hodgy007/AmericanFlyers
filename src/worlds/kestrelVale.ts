// Kestrel Vale: a fictional limestone valley in the north of England, a cousin of the Harrogate stage, as one closed loop.
// Its routes (an endless free ride, one lap, three laps, and two that start partway round) are windows on that loop (see worlds/types.ts and
// docs/developer-guide/kestrel-vale-plan.md). Hollins Cross, the village, is the start and finish; the road runs down to
// Kestrel Water, over Mill Bridge, across the farmland of Foss Bottom, up the Raven Scar climb with its five hairpins to the
// rock cutting and tunnel of Raven Gap, down through Highfold Woods, along Beck Lane and back into the
// village. It turns left all the way round, so the lake lies inside the loop.
//
// ROUTE IDS AND THE LAP ARE FROZEN once shipped: leaderboards, ghosts and segment times key on them. The lap length is
// pinned in tests/unit/worlds.test.ts; a change to the geometry means a new route id or a deliberate leaderboard reset.
//
// Only types are imported from ../stages (it imports this file); helpers come from ../stageKit and the leaf modules.

import { fbm, smoothstep } from '../world/noise';
import { riseRel, shapeAt } from '../world/canyon';
import { pondDistance, type PondBody } from '../world/waterTypes';
import { TUNNEL_HALF_WIDTH, TUNNEL_HILL, TUNNEL_PORTAL_DEPTH, vaultHeight, type TunnelSpan } from '../world/tunnelSpan';
import { monumentAt, pchip, roadElevationField, roadTrace, terraceRow } from '../stageKit';
import { closeLoop, routeStage, type LoopPiece, type World, type WorldRoute } from './types';
import type { LandmarkKind, Stage } from '../stages';

// ------------------------------------------------------------------ the loop ----

/**
 * The road as pieces, in lap order: lengths in metres, turns in degrees to the left (they add up to 360, so the loop
 * closes on its own heading). Two straights, 'water-road' and 'foss-straight', have their lengths solved so the end lands
 * exactly on the start (their lengths here are only first guesses). The last piece runs on the start's own heading, so the
 * straight road that course.ts draws behind the start lies on the real one.
 */
const PIECES: LoopPiece[] = [
  { name: 'high-street', len: 600, turnDeg: 0 }, // Hollins Cross: start and finish in the square
  { name: 'church-bend', len: 300, turnDeg: 60 },
  { name: 'water-road', len: 400, turnDeg: 0 }, // solved: down to the water
  { name: 'lake-1', len: 495, turnDeg: 10.5 }, // Kestrel Water: gentle S-bends, the lake on the left
  { name: 'lake-2', len: 495, turnDeg: -18.5 },
  { name: 'lake-3', len: 495, turnDeg: 21 },
  { name: 'lake-4', len: 495, turnDeg: -2.5 },
  { name: 'lake-5', len: 495, turnDeg: 21.5 },
  { name: 'mill-approach', len: 250, turnDeg: 36 },
  { name: 'mill-bridge', len: 250, turnDeg: 0 }, // straight, over the lake's outflow
  { name: 'foss-bend', len: 787, turnDeg: 22 }, // Foss Bottom: farmland
  { name: 'foss-straight', len: 960, turnDeg: 0 }, // solved
  { name: 'climb-foot', len: 375, turnDeg: 0 }, // Raven Scar starts here
  { name: 'hairpin-1', len: 130, turnDeg: 168 },
  { name: 'scar-1', len: 640, turnDeg: 5 },
  { name: 'hairpin-2', len: 130, turnDeg: -168 },
  { name: 'scar-2', len: 620, turnDeg: 0 },
  { name: 'hairpin-3', len: 130, turnDeg: 168 },
  { name: 'scar-3', len: 640, turnDeg: -5 },
  { name: 'hairpin-4', len: 130, turnDeg: -168 },
  { name: 'scar-4', len: 705, turnDeg: 0 },
  { name: 'hairpin-5', len: 130, turnDeg: 168 },
  { name: 'scar-5', len: 635, turnDeg: -108 },
  { name: 'raven-gap', len: 350, turnDeg: 0 }, // the cutting; the KOM summit is its first metre
  { name: 'highfold-1', len: 553, turnDeg: 35 }, // Highfold Woods: sweeping bends down
  { name: 'highfold-2', len: 557, turnDeg: -10.5 },
  { name: 'highfold-3', len: 557, turnDeg: 35.5 },
  { name: 'highfold-4', len: 557, turnDeg: -22.5 },
  { name: 'highfold-5', len: 555, turnDeg: 41.5 },
  { name: 'highfold-6', len: 552, turnDeg: 52 },
  { name: 'beck-1', len: 495, turnDeg: 3 }, // Beck Lane, by the stream
  { name: 'beck-2', len: 490, turnDeg: 16 },
  { name: 'run-in', len: 450, turnDeg: 0 }, // straight into the village, on the heading of km 0
];
const idx = (name: string) => {
  const i = PIECES.findIndex((p) => p.name === name);
  if (i < 0) throw new Error(`kestrelVale: no piece ${name}`);
  return i;
};
const LOOP = closeLoop(PIECES, idx('water-road'), idx('foss-straight'));
export const KV_LAP = LOOP.lap;
/** Where a piece starts / ends, in lap metres. */
const from = (name: string) => LOOP.starts[idx(name)];
const to = (name: string) => LOOP.starts[idx(name)] + LOOP.pieces[idx(name)].len;

const GAP_FROM = from('raven-gap');
const GAP_TO = to('raven-gap');
/** The hairpins' centres, in lap metres: numbered from the bottom, left, right, left, right, left. */
const HAIRPINS = [1, 2, 3, 4, 5].map((n) => from(`hairpin-${n}`) + LOOP.pieces[idx(`hairpin-${n}`)].len / 2);

// ------------------------------------------------------------------ elevation ----

const mod = (d: number) => ((d % KV_LAP) + KV_LAP) % KV_LAP;

/** Raven Scar: the climb's grade by piece (%, relative: scaled so the climb gains exactly CLIMB_GAIN). Hairpins are the steep bits. */
const SCAR_PIECES = ['climb-foot', 'hairpin-1', 'scar-1', 'hairpin-2', 'scar-2', 'hairpin-3', 'scar-3', 'hairpin-4', 'scar-4', 'hairpin-5', 'scar-5'];
const SCAR_GRADES = [5.0, 9.0, 5.8, 9.5, 5.6, 10.6, 9.4, 9.0, 4.6, 9.4, 5.2];
const CLIMB_FOOT = 25; // m above the village at the climb's foot
const CLIMB_TOP = 300; // m above the village at Raven Gap
/** Highfold Woods: the descent's grade by piece (%, relative), steepest in the middle, scaled to drop from the top to the Beck Lane level. */
const HIGHFOLD_PIECES = ['highfold-1', 'highfold-2', 'highfold-3', 'highfold-4', 'highfold-5', 'highfold-6'];
const HIGHFOLD_GRADES = [8.4, 8.8, 9.0, 8.4, 9.0, 8.6];
const BECK_TOP = 10; // m above the village where Beck Lane starts

/** Knots of the lap's elevation profile (lap metres, m above the village), joined by a monotone cubic. */
function elevationKnots(): [number, number][] {
  const k: [number, number][] = [[0, 0], [from('water-road'), 0], [to('water-road'), -6]];
  // Kestrel Water: the road rolls 3 to 7 m above the lake.
  [-7.5, -5, -8, -5.5, -4].forEach((e, i) => k.push([to(`lake-${i + 1}`), e]));
  k.push([to('mill-approach'), -4], [to('mill-bridge'), -4]);
  // Foss Bottom: a gentle false flat.
  k.push([to('foss-bend'), 6], [to('foss-straight'), CLIMB_FOOT]);
  // Raven Scar.
  let scale = 0;
  SCAR_PIECES.forEach((n, i) => { scale += (SCAR_GRADES[i] / 100) * LOOP.pieces[idx(n)].len; });
  scale = (CLIMB_TOP - CLIMB_FOOT) / scale;
  let e = CLIMB_FOOT;
  SCAR_PIECES.forEach((n, i) => { e += (SCAR_GRADES[i] / 100) * LOOP.pieces[idx(n)].len * scale; k.push([to(n), e]); });
  k[k.length - 1][1] = CLIMB_TOP;
  k.push([GAP_TO, CLIMB_TOP]);
  // Highfold Woods.
  let drop = 0;
  HIGHFOLD_PIECES.forEach((n, i) => { drop += (HIGHFOLD_GRADES[i] / 100) * LOOP.pieces[idx(n)].len; });
  drop = (CLIMB_TOP - BECK_TOP) / drop;
  e = CLIMB_TOP;
  HIGHFOLD_PIECES.forEach((n, i) => { e -= (HIGHFOLD_GRADES[i] / 100) * LOOP.pieces[idx(n)].len * drop; k.push([to(n), e]); });
  k[k.length - 1][1] = BECK_TOP;
  // Beck Lane, then the run-in with a small kick to the line.
  k.push([to('beck-1'), 1], [to('beck-2'), -6]);
  k.push([KV_LAP - 250, -5.2], [KV_LAP - 90, -2.2], [KV_LAP - 20, -0.15], [KV_LAP, 0]);
  return k;
}
const lapElevation = pchip(elevationKnots());
const elevation = (u: number) => lapElevation(mod(u));

// ---------------------------------------------------------------------- terrain ----

const TRACE_STEP = 10;
/** The road's (x east, z south) every TRACE_STEP metres from the start, a few metres past the lap's end. */
const TRACE = roadTrace(LOOP.headingAt, KV_LAP, TRACE_STEP);
/** The road's point and unit tangent at lap metre `u`. */
function roadPoint(u: number): { x: number; z: number; tx: number; tz: number } {
  const f = mod(u) / TRACE_STEP;
  const i = Math.min(TRACE.length - 2, Math.floor(f));
  const t = f - i;
  const a = TRACE[i], b = TRACE[i + 1];
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const len = Math.hypot(vx, vz) || 1;
  return { x: a[0] + vx * t, z: a[1] + vz * t, tx: vx / len, tz: vz / len };
}
/** Ground level that rises and falls with the road, across country. */
const roadLevel = roadElevationField(TRACE, TRACE_STEP, elevation);

// The lake, inside the loop beside the lakeshore road: placed from the road's own trace (its chord from the foot of the
// shore to Mill Bridge), as far from the road as keeps the nearest road point LAKE_CLEARANCE metres from the water's edge.
const LAKE_LEVEL = -11;
const LAKE_CLEARANCE = 42;
const LAKE_BANK = 40; // metres over which the ground rises from the shore to the land
function buildLake(): PondBody {
  const a = roadPoint(from('lake-1')), b = roadPoint(to('lake-5'));
  const heading = Math.atan2(b.z - a.z, b.x - a.x);
  const rx = 1180, rz = 430;
  const left = [Math.sin(heading), -Math.cos(heading)]; // to the road's left
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  let body: PondBody = { kind: 'pond', x: mx, z: mz, rx, rz, rot: -heading, level: LAKE_LEVEL };
  // Push the centre out to the left until the road clears the water by LAKE_CLEARANCE everywhere.
  for (let off = 0; off < rz + 600; off += 2) {
    body = { ...body, x: mx + left[0] * off, z: mz + left[1] * off };
    let near = Infinity;
    for (const [x, z] of TRACE) near = Math.min(near, pondDistance(body, x, z));
    if (near >= LAKE_CLEARANCE) break;
  }
  return body;
}
export const KV_LAKE = buildLake();

/** The land around the water: the shore a shade above the level and the bed falling away inside, rising to `ground` across LAKE_BANK metres. */
export function lakeGround(x: number, z: number, ground: number): number {
  const wd = pondDistance(KV_LAKE, x, z);
  if (wd >= LAKE_BANK) return ground;
  const shore = LAKE_LEVEL + 0.35;
  if (wd <= 0) return Math.min(ground, shore - 3.8 * smoothstep(0, 16, -wd));
  return Math.min(ground, shore + (ground - shore) * smoothstep(0, LAKE_BANK, wd));
}
/** Trace points (indices) whose road has the lake within reach of the roadside hook's bank. */
const LAKE_NEAR = TRACE.map(([x, z]) => pondDistance(KV_LAKE, x, z) < 330);

// Raven Gap: the ridge the road crosses at a saddle, with crags either side, placed from the trace's point at the cutting.
const GAP_MID = (GAP_FROM + GAP_TO) / 2;
const GAP = roadPoint(GAP_MID);
const crestAt = (x: number, z: number) => {
  const dx = x - GAP.x, dz = z - GAP.z;
  const a = dx * GAP.tx + dz * GAP.tz; // along the road
  const b = dx * -GAP.tz + dz * GAP.tx; // across it, to the right
  const ab = Math.abs(b);
  const envelope = Math.exp(-((a / 460) ** 2));
  // The ridge: low at the saddle where the road crosses, climbing to high ground either side; broken crags on top.
  const crest = 175 * smoothstep(30, 300, ab) * (1 - smoothstep(1000, 2100, ab));
  const crags = 55 * Math.max(0, fbm(a / 130 + 4, b / 130, 3) + 0.15) * smoothstep(150, 420, ab);
  const peaks = [-1, 1].reduce((m, s) => m + 70 * Math.exp(-(((a + 30) / 150) ** 2 + ((b - s * 360) / 170) ** 2)), 0);
  return (crest + crags + peaks) * envelope;
};

/** The wild ground: low rolling country that follows the road, a little above it, the ridge at Raven Gap, and the lake's basin. */
const base = (x: number, z: number) => roadLevel(x, z) + 6 + fbm(x / 700 + 9, z / 700, 3) * 14 + fbm(x / 170, z / 170, 2) * 2.5 + crestAt(x, z);
const wildHeight = (x: number, z: number) => lakeGround(x, z, base(x, z));

// The cutting: steep rock walls either side of the road over Raven Gap, from the shapes in canyon.ts (stepped faces and benches).
const CUT_FADE = 150;
const cutWeight = (u: number) => smoothstep(GAP_FROM - CUT_FADE, GAP_FROM + 40, u) * (1 - smoothstep(GAP_TO - 40, GAP_TO + CUT_FADE, u));

// The tunnel: the last stretch of the cutting runs under the ridge. The span is where the tube (world/tunnel.ts) and the two stone portals are; the
// road's elevation and heading are untouched (the lap, the segments and the limits do not change).
//
// A heightfield cannot close over a road: where the ground climbs from the road's level to a hill's, its slope would stand inside the portal. So over
// the span the TERRAIN is dug out below the road (a slot, |lateral| < 8 m, climbing steeply to the hill's own height by 12 m) and the tube builds the hill's
// surface over the slot (`TunnelSpan.roof`, the same height the terrain has from 12 m out). Outside the span the cutting stays open, so each portal stands
// in a rock face at the head of the open approach, with the hill rising behind its wall.
const TUNNEL_MARGIN = 14; // m from the ends of the old cutting to the portals
export const KV_TUNNEL_FROM = GAP_FROM + TUNNEL_MARGIN;
export const KV_TUNNEL_TO = GAP_TO - TUNNEL_MARGIN;
const TUNNEL_HUMP = 20; // m of ground over the road at the centreline, inside the tunnel
const TUNNEL_DIG_IN = 2; // m behind a portal's face over which the terrain is dug out; the hill starts to climb after it
const TUNNEL_RAMP = 6; // m over which the hill then climbs to its full height
const TUNNEL_REACH = 45; // lateral reach of the hump (it fades to the cutting's own walls)
const TUNNEL_DUG = -5; // m: the terrain's floor in the slot, below the road (hidden under the road and the tube)
const SLOT = 8; // half width of the slot, m (the tube's walls are at 5.6; the 4 m terrain grid needs the rest)
/** 0..1: how far under the hill the road is at lap metre `u`. */
export const tunnelRoof = (u: number) => smoothstep(KV_TUNNEL_FROM + TUNNEL_DIG_IN, KV_TUNNEL_FROM + TUNNEL_DIG_IN + TUNNEL_RAMP, u) * (1 - smoothstep(KV_TUNNEL_TO - TUNNEL_DIG_IN - TUNNEL_RAMP, KV_TUNNEL_TO - TUNNEL_DIG_IN, u));
/** 0..1: how far the terrain has been dug out at lap metre `u`: from the portal's face to full depth TUNNEL_DIG_IN m in, before the hill starts to climb (so the ground is never above the road inside the tube's walls). */
const tunnelDig = (u: number) => smoothstep(KV_TUNNEL_FROM, KV_TUNNEL_FROM + TUNNEL_DIG_IN, u) * (1 - smoothstep(KV_TUNNEL_TO - TUNNEL_DIG_IN, KV_TUNNEL_TO, u));

/** The height of the ground above the road at the cutting's walls and the hill over the tunnel (the terrain's own height outside the slot; the tube's roof inside it). */
function hillRel(u: number, lateral: number, plain: number): number {
  const side = lateral < 0 ? -1 : 1;
  let rel = plain;
  const w = cutWeight(u);
  if (w > 0) {
    const wall = riseRel({ ...shapeAt(u, side), rise: shapeAt(u, side).rise * 1.5 }, 1, Math.abs(lateral), plain);
    rel += smoothstep(0, 0.35, w) * (wall - rel);
  }
  const roof = tunnelRoof(u);
  return roof > 0 ? rel + TUNNEL_HUMP * roof * (1 - smoothstep(0, TUNNEL_REACH, Math.abs(lateral))) : rel;
}
/** The tube's roof: the hill's height, and never lower than a hand over the vault, so no slope of it shows through a portal. */
function tunnelHill(d: number, lateral: number): number {
  const u = mod(d);
  const a = Math.abs(lateral);
  return Math.max(hillRel(u, lateral, 0), (vaultHeight(Math.min(a, TUNNEL_HALF_WIDTH)) + 0.6) * (1 - smoothstep(TUNNEL_HALF_WIDTH + 1, SLOT + 1, a)));
}
export const KV_TUNNEL: TunnelSpan = { from: KV_TUNNEL_FROM, to: KV_TUNNEL_TO, roof: tunnelHill };

/** `Scenery.roadside`: the cutting's walls, the hill over the tunnel and the lake's graded bank, both measured against the road. */
function roadside(d: number, lateral: number, plain: number): number | null {
  const u = mod(d);
  let rel = plain;
  let touched = false;
  if (cutWeight(u) > 0) {
    rel = hillRel(u, lateral, plain);
    touched = true;
    // Over the tunnel the terrain is dug out below the road, steeply, between 8 and 12 m from the centreline (the tube's roof is the hill over it).
    const dig = tunnelDig(u);
    if (dig > 0) rel += dig * (1 - smoothstep(SLOT, TUNNEL_HILL, Math.abs(lateral))) * (TUNNEL_DUG - rel);
  }
  const i = Math.round(u / TRACE_STEP);
  if (LAKE_NEAR[i]) {
    // Which way the lateral offset points on the ground, from the trace's own tangent.
    const r = roadPoint(u);
    const x = r.x - r.tz * lateral, z = r.z + r.tx * lateral;
    const road = elevation(u) - 0.15;
    const keep = smoothstep(10, 30, Math.abs(lateral)); // the road itself and its verge are never lowered
    const sunk = lakeGround(x, z, road + rel) - road;
    rel += keep * (sunk - rel);
    touched = true;
  }
  return touched ? rel : null;
}

// ----------------------------------------------------------------- the lap ----

const WALLED: [number, number][] = [[to('mill-bridge'), from('hairpin-2')], [from('beck-1') - 100, to('beck-2')]];
const OPEN: [number, number][] = [[KV_LAP - 520, KV_LAP], [0, 760], [to('mill-bridge'), from('climb-foot')], [GAP_FROM - 150, GAP_TO + 150]];
const within = (ranges: [number, number][], d: number) => { const u = mod(d); return ranges.some(([a, b]) => u >= a && u <= b); };

/** Stone terraces along the high street and the run-in, both sides (rows repeat every lap through `until`). */
const VILLAGE: LandmarkKind[] = [
  ...terraceRow(66, 572, -1, 'stone', [1, 2]),
  ...terraceRow(66, 572, 1, 'stone', [3, 4]),
  ...terraceRow(KV_LAP - 440, KV_LAP - 30, -1, 'stone', [5, 6]),
  ...terraceRow(KV_LAP - 440, KV_LAP - 30, 1, 'stone', [7, 1]),
];
/** One-offs that stand once a lap: `every` is the lap itself. */
const once = (k: LandmarkKind): LandmarkKind => ({ ...k, every: KV_LAP });
const LANDMARKS: LandmarkKind[] = [
  ...VILLAGE,
  once(monumentAt('alpine-church', from('church-bend') + 150, 1, 36, 26.6, { yaw: -0.3, clearance: 16 })),
  // Mill Bridge: the covered bridge carries the road over the lake's outflow.
  once({ file: 'covered-bridge.glb', first: from('mill-bridge') + 125, every: 1e9, side: 0, span: 'along', offset: 0, size: 12.5, clearance: 22 }),
  // Foss Bottom's farms (one of each a lap: the spacing is the lap, which divides it).
  once({ file: 'barn.glb', first: from('foss-bend') + 250, every: 1e9, side: 1, offset: 34, size: 10, yaw: -0.6, clearance: 26 }),
  once({ file: 'farmhouse.glb', first: from('foss-bend') + 520, every: 1e9, side: -1, offset: 32, size: 9, yaw: 0.6, clearance: 26 }),
  once({ file: 'silos.glb', first: from('foss-straight') + 300, every: 1e9, side: 1, offset: 40, size: 18, yaw: -0.3, clearance: 26 }),
  once({ file: 'barn.glb', first: from('beck-2') + 180, every: 1e9, side: -1, offset: 32, size: 10, yaw: 0.5, clearance: 26 }),
];

// Raven Gap's two portals: a stone arch across each mouth of the tunnel (the same monument, decorated on both faces). The entrance's front face is on the
// span's start; the exit's back face is on its end. 11.6 m is its height as built.
const PORTALS: LandmarkKind[] = [KV_TUNNEL_FROM + TUNNEL_PORTAL_DEPTH / 2, KV_TUNNEL_TO - TUNNEL_PORTAL_DEPTH / 2].map((d): LandmarkKind =>
  once({ model: 'tunnel-portal', first: d, every: 1e9, side: 0, span: 'across', offset: 0, size: 11.6, clearance: 30, options: { lines: ['RAVEN GAP TUNNEL', 'ALT. 300 m'] } }));
LANDMARKS.push(...PORTALS);

const SPRINT = 2600; // on the lakeshore
const SUMMIT = Math.round(GAP_FROM);

export const KESTREL_VALE: World = {
  id: 'kestrel-vale',
  name: 'Kestrel Vale',
  tagline: 'A limestone valley in the north: a village, a lake, a 4.3 km climb with five hairpins and a rock cutting, ridden as endless laps, a loop, a grand tour or just the best bits.',
  lap: KV_LAP,
  turn: LOOP.turn,
  headingAt: LOOP.headingAt,
  elevationAt: elevation,
  scenery: {
    wildHeight,
    roadside,
    bumpAmp: 3,
    rockLine: 260,
    snowLine: 1e9,
    treeLine: 430,
    coniferBias: 0.45,
    forestCover: 0.35, // the dark pine plantation on the descent; the village and the farmland are cleared (`clearing`)
    trees: { oak: 0.17, beech: 0.18, pine: 0.2, spruce: 0.18, larch: 0.12, shrub: 0.15 },
    fields: true,
    dryGrass: 0.3,
    mountainScale: 1.6, // the Pennines
    horizon: 'hills',
    road: 'alpine',
    barrier: 'stone',
    water: [KV_LAKE],
    walls: (d) => within(WALLED, d),
    clearing: (d) => within(OPEN, d),
    tunnels: [KV_TUNNEL],
  },
  landmarks: LANDMARKS,
  places: [
    [60, 'Hollins Cross'], [from('lake-1'), 'Kestrel Water'], [from('mill-bridge'), 'Mill Bridge'], [from('foss-bend') + 200, 'Foss Bottom'],
    [from('climb-foot'), 'Raven Scar'], [GAP_FROM, 'Raven Gap'], [from('highfold-1') + 40, 'Highfold Woods'], [from('beck-1'), 'Beck Lane'],
  ],
  race: {
    sprints: [{ d: SPRINT, name: 'Kestrel Water sprint' }],
    summits: [{ d: SUMMIT, name: 'Raven Scar', cat: 2 }],
  },
  // The hairpins; the summit, just short of the tunnel's mouth (nobody stands inside it); and the Hollins Cross square either side of the lap line.
  crowdSpots: [...HAIRPINS, GAP_FROM - 30, 70, KV_LAP - 70],
  baseAltitude: 190,
  culture: 'gb',
  weather: 'cloudy',
  timeOfDay: 'day',
  wind: { ms: 4.5, angle: 20 }, // the westerly: a tailwind off the start, swinging round the loop
};

// ---------------------------------------------------------------------- routes ----

const BLURB = 'Kestrel Vale, a limestone valley in the north: ';
export const KESTREL_ROUTE_DEFS: WorldRoute[] = [
  { id: 'kestrel-vale', name: 'Kestrel Vale · Free Ride', tagline: `${BLURB}an endless ride round the whole valley, village, lake, climb and cutting, lap after lap.`, laps: null },
  { id: 'kestrel-vale-loop', name: 'Kestrel Vale · Vale Loop', tagline: `${BLURB}one lap from Hollins Cross: the lakeshore, Foss Bottom, the Raven Scar climb and the cutting, then Highfold Woods back to the village.`, laps: 1 },
  { id: 'kestrel-vale-grand', name: 'Kestrel Vale · Grand Vale', tagline: `${BLURB}three laps of the valley circuit, over Raven Scar each time.`, laps: 3 },
  // Partway round the lap. Starts and finishes are on straight road: 5,900 is on the Foss Bottom straight (the climb starts at 6,018),
  // 10,700 is just past the cutting (Raven Gap ends at 10,633; the first Highfold bend is a long, gentle one). 14,000 is Beck Lane's first
  // straight; 4,300 (lap metres, next lap) is just past the covered bridge, which ends at 4,260.
  { id: 'kestrel-vale-raven-scar', name: 'Kestrel Vale · Raven Scar', tagline: `${BLURB}the climb alone: from the Foss Bottom straight up Raven Scar's five hairpins to the cutting at Raven Gap. 4.8 km, 277 m up.`, start: 5900, length: 4800 },
  { id: 'kestrel-vale-lakeside', name: 'Kestrel Vale · Lakeside Sprint', tagline: `${BLURB}a flat dash from Beck Lane through the village, across the line and along Kestrel Water to Mill Bridge. 5.7 km, no climbs.`, start: 14000, length: 5700 },
];
export const KESTREL_ROUTES: Stage[] = KESTREL_ROUTE_DEFS.map((r) => routeStage(KESTREL_VALE, r));

/** Pieces and marks the tests read back. */
export const KV = { loop: LOOP, from, to, roadPoint, trace: TRACE, hairpins: HAIRPINS, gap: [GAP_FROM, GAP_TO] as const, tunnel: KV_TUNNEL, tunnelRoof, summit: SUMMIT, sprint: SPRINT, crestAt, lakeGround, roadside };
