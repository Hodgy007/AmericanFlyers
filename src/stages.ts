// Stage definitions: each stage supplies its own elevation profile, road
// bends, scenery style, roadside landmarks and signs.

import type { MonumentId, MonumentOptions } from './world/monumentTypes';
import type { CultureId } from './world/cultureTypes';
import type { WaterBody } from './world/waterTypes';
import type { TunnelSpan } from './world/tunnelSpan';
import { fbm, smoothstep } from './world/noise.js';
import type { TreeMix } from './world/trees.js';
import type { HorizonChoice } from './world/horizon';
import type { Dressing } from './world/dressingTypes';
import { lazy, type Lazy } from './lazy';
import { CATALOGUE, WORLD_PROFILES, type CatalogueEntry, type StageInfo } from './stageCatalogue';
import { GANTRY, finishArch, monumentAt, namedPlaces, pchip, roadLocator, roadTrace, startArch } from './stageKit';

// The helpers live in stageKit.ts (a world file imports them from there, not from here: see that file's header).
export { GANTRY, finishArch, monumentAt, namedPlaces, pchip, roadLocator, roadTrace, startArch };

export interface LandmarkBase {
  every: number; // metres between repeats
  first: number; // distance of the first one
  side: -1 | 0 | 1; // -1 left, 1 right, 0 on the road itself
  /** For side 0: 'across' spans the road like an arch; 'along' is ridden through lengthwise (a bridge). */
  span?: 'across' | 'along';
  offset: number; // metres from the road centre
  size: number; // target height in metres; width for side-0 kinds
  yaw?: number; // extra turn in radians after facing the road
  clearance: number; // keep trees this far away
  /** Metres of course either side within which it is placed (default: 250 behind, 1,500 ahead). For huge, distant things. */
  reach?: number;
  /** Course distance after which it is no longer repeated (default: all the way). For a row of houses along one stretch of a circuit. */
  until?: number;
  /** Metres added to its height after it is placed (negative: a bridge whose deck is its origin, standing on the gorge floor). */
  lift?: number;
  /**
   * Placed in the world instead of along the road, for something whose real position is known (the Flatirons):
   * metres east (x) and south (z) of the course start, `y` above the start's datum, and `yaw` about the vertical
   * (three.js `rotation.y`: the model's +z faces (sin yaw, cos yaw)). `side` and `offset` are then ignored;
   * `first` and `reach` still say when it is in range, by course distance.
   */
  world?: { x: number; z: number; y: number; yaw: number };
  /**
   * Only placed while the rider is within this many metres of it (straight line): for a `world` landmark that stands well away from the road and is built
   * on terrain that only exists near the rider (the terrain is 1,150 m deep), so it is never seen hanging over nothing.
   */
  within?: number;
}

/**
 * A roadside landmark: either a GLB model in public/models/ (`file`) or a monument built in code
 * (`model`, see world/monuments.ts), never both. `options` gives a monument its words and looks.
 */
export type LandmarkKind = LandmarkBase &
  ({ file: string; model?: never; options?: never } | { model: MonumentId; options?: MonumentOptions; file?: never });

export interface Scenery {
  /** Ground height far from the road. */
  wildHeight(x: number, z: number): number;
  bumpAmp: number; // small-scale ground roughness, metres
  rockLine: number; // heights (same datum as the road) where rock, snow and the tree line start
  snowLine: number;
  treeLine: number;
  /** Where bare pale limestone scree starts (same datum), above which there are no trees either: Mont Ventoux's summit. Omitted: none. */
  screeLine?: number;
  coniferBias: number; // 0 = mostly broadleaf, 1 = all conifers
  forestCover: number; // 0 = farmland with woods, higher = more forest
  /** Relative weights of the tree species the stage grows (trees.ts). Left out: derived from `coniferBias`, as for an uploaded route. */
  trees?: TreeMix;
  fields: boolean; // patches of farmland
  mountainScale: number; // height of the distant mountain ring
  /** Which panorama stands on the horizon (world/horizon.ts): the Alps, Pyrenees, Rockies, red-rock desert or rolling hills, or none for the procedural ring alone. Omitted: found from `mountainScale`. */
  horizon?: HorizonChoice;
  /** 'desert': red and orange rock, sparse junipers instead of forest (Colorado's red-rock country). */
  palette?: 'desert';
  /** How the road looks: its paint and surface (see world/roadStyle.ts). Left out: 'us-highway'. */
  road?: RoadStyle;
  /** 0 to 1: how much of the grass has dried to straw (Mount Diablo's golden summer hills). Omitted: none beyond the usual dry patches. */
  dryGrass?: number;
  /** What stands at the roadside on hairpins and drops: W-beam guardrails (default), low dry-stone parapets, or nothing (the Mount Washington Auto Road is unguarded over most of its length). */
  barrier?: 'rail' | 'stone' | 'none';
  /**
   * Shapes the ground beside the road (canyons, cuttings). Given a point at course distance `d`
   * and signed lateral offset from the centreline (+ right), and `plain`, the height relative
   * to the road the terrain would give there, it returns the height relative to the road, or
   * null for no opinion. It runs for every terrain vertex within REACH (900 m) of the road, so
   * keep it cheap, and key it off `d` and `lateral` only.
   */
  roadside?(d: number, lateral: number, plain: number): number | null;
  /** Field walls and bunting beside and across the road (world/dressingTypes.ts, drawn per road chunk by roadExtras.ts). Only Kestrel Vale has any. */
  dressing?: Dressing;
  /** How much clearer than the usual the air is: the haze distance is multiplied by this (default 1). Dry Colorado air lets a canyon's far wall and floor read. */
  clearAir?: number;
  /** On High and Ultra (the post chain) blend the haze as Low does, in display colour with Low's thickness, so the distance is not paler there. Off by default: other stages keep the post chain's own look. */
  directHaze?: boolean;
  /** Scales the sky's ambient and reflected light (the environment map, High and Ultra only; default 1). Lower on a stage where it pales sunlit rock. */
  skyLight?: number;
  /** Water: the sea, lakes and rivers, flat sheets that the ground sinks below (world/waterTypes.ts, drawn by world/water.ts). */
  water?: WaterBody[];
  /** Where dry-stone walls line both sides of the road (fields on a country lane): true for a course distance. */
  walls?(d: number): boolean;
  /** Where no trees grow beside the road (a park lawn, The Stray): true for a course distance. */
  clearing?(d: number): boolean;
  /**
   * Where the road runs through a tunnel, in course metres (sorted, not overlapping). The stage's own `roadside` hook must raise the ground over the
   * road along each span (the hill closes over it); the tube, its lamps and the portals are built per road chunk (world/tunnel.ts), and no trees,
   * ground cover, crowds or guardrails are placed there (world/tunnelSpan.ts). Left out: no tunnels.
   */
  tunnels?: TunnelSpan[];
}

/** The road's look: 'us-highway' (double yellow dashed, white edge lines, gravel shoulders), 'alpine' (white dashed centre, thin edge lines), 'lane' (no markings), 'park' (solid double yellow, red chip seal) or 'city-park' (granite kerbs, white edge and lane lines). */
export type RoadStyle = 'us-highway' | 'alpine' | 'lane' | 'park' | 'city-park';

export interface StageSign {
  d: number;
  /** The hairpin's number as signed on the road ("7"); empty for a bend that has no number sign. */
  label: string;
  style: 'hairpin';
  /** False for a bend the real road does not number (guardrails and crowds still gather there) or a named place. Default true. */
  numbered?: boolean;
  /** A place the HUD announces ("Saint-Estève") in place of a hairpin number. */
  name?: string;
}

/** Where a race awards points on a stage: intermediate sprints and climbs. */
export interface RacePoints {
  sprints?: { d: number; name: string }[]; // intermediate sprint banners (the finish line is always a sprint)
  /** Climb summits, category 0 = hors catégorie, then 1 (hardest) to 4. Left out: found from the elevation profile. */
  summits?: { d: number; name: string; cat: 0 | 1 | 2 | 3 | 4 }[];
}

export interface Stage {
  id: string;
  name: string;
  tagline: string;
  finish: number | null; // metres; null = endless
  elevationAt(d: number): number;
  headingAt(d: number): number;
  scenery: Scenery;
  landmarks: LandmarkKind[];
  signs: StageSign[];
  hairpinWord?: string; // local word for a numbered hairpin, e.g. "Virage" or "Tornante"
  baseAltitude?: number; // metres above sea level at the start, for the elevation readout
  /** What the light and weather are like here when the rider leaves them on Auto (default: day, clear). */
  timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
  weather?: 'clear' | 'cloudy' | 'rain';
  /** Set for routes the rider uploaded (GPX). */
  uploaded?: boolean;
  /** Circuits: the length of one lap in metres (the finish is a whole number of laps). */
  lapLength?: number;
  /** Intermediate sprints and named summits for races on this stage. */
  race?: RacePoints;
  /** Part of the Hell of the West tour, with its stage number. */
  tourStage?: number;
  /** Prevailing wind here (see world/wind.ts). Left out: the built-in table, or a mild wind picked from the id. */
  wind?: import('./world/wind').StageWind;
  /** Whose flags and shirts the crowd wears (world/crowdCulture.ts). Left out: from the hairpin word, as before. */
  culture?: CultureId;
  /** Course distances where spectators gather as they do at a hairpin: the cobbled climbs of a circuit. */
  crowdSpots?: number[];
  /** False for a stage with named places but no climb to speak of (a circuit, a coast road): no painted words, campers or hairpin rails. */
  climb?: false;
  /**
   * Set for a route inside a world (worlds/types.ts): the world's id, this route's id and where it starts round the world's lap (m), the lap's length and the canonical lap route.
   * Segment ids and limits are scoped to the world (`<world id>:<slug>`), so a climb ridden on two routes is one leaderboard.
   */
  world?: {
    id: string; route: string; start: number;
    /** The world's name and one-line description (the hub's world card). */
    name: string;
    tagline: string;
    /** The world's lap, m. */
    lap: number;
    /** The day (YYYY-MM-DD) the route was added to the world, left out for the routes it launched with: the "every route" badge (cloud/achievements.ts) only asks riders for the routes that existed when they finished the last of them. */
    since?: string;
    /** The world's canonical one-lap route from the lap line: segments.ts finds the world's segments on it, once, and maps them into each route. */
    lapStage(): Stage;
  };
}

// --------------------------------------------------------------- helpers ----

type Wave = { amp: number; length: number; phase: number };

function waves(list: Wave[], d: number) {
  let v = 0;
  for (const w of list) v += w.amp * Math.sin((2 * Math.PI * d) / w.length + w.phase);
  return v;
}

/** Eases a course in from flat and straight over the first `m` metres. */
function startRamp(d: number, m = 400) {
  return smoothstep(0, m, d);
}

/** Roadside farm landmarks, for lowland stages and routes. */
export const FARM_LANDMARKS: LandmarkKind[] = [
  { file: 'windmill.glb', every: 1900, first: 600, side: -1, offset: 26, size: 15, yaw: 0.4, clearance: 24 },
  { file: 'barn.glb', every: 2300, first: 950, side: 1, offset: 34, size: 10, yaw: -0.6, clearance: 26 },
  { file: 'farmhouse.glb', every: 2300, first: 1200, side: -1, offset: 32, size: 9, yaw: 0.6, clearance: 26 },
  { file: 'diner.glb', every: 3700, first: 1900, side: -1, offset: 24, size: 6.5, yaw: 0.5, clearance: 24 },
  { file: 'water-tower.glb', every: 4100, first: 2700, side: 1, offset: 46, size: 26, clearance: 18 },
  { file: 'gas-station.glb', every: 4300, first: 1550, side: 1, offset: 23, size: 6.5, yaw: -0.5, clearance: 24 },
  { file: 'silos.glb', every: 3100, first: 2150, side: 1, offset: 40, size: 18, yaw: -0.3, clearance: 26 },
];

const lowlandHills = (x: number, z: number) =>
  6 + fbm(x / 850, z / 850, 4) * 105 + (1 - Math.abs(fbm(x / 320 + 41, z / 320 - 7, 3))) * 28;

/** A code-built landmark at a fixed place in the world (see `LandmarkBase.world`), in range the whole stage: `size` is its height in metres. */
export const monumentInWorld = (model: MonumentId, world: NonNullable<LandmarkBase['world']>, size: number, extra: Partial<LandmarkBase> & { options?: MonumentOptions } = {}): LandmarkKind =>
  ({ model, first: 0, every: 1e9, side: 0, offset: 0, size, clearance: 1, reach: 20000, world, ...extra });


// ------------------------------------------------------------- Heartland ----

const H_ELEV: Wave[] = [
  { amp: 34, length: 5200, phase: 0.0 },
  { amp: 9, length: 1300, phase: 1.7 },
  { amp: 2.2, length: 340, phase: 4.1 },
  { amp: 0.25, length: 90, phase: 2.3 },
];
const H_HEAD: Wave[] = [
  { amp: 0.55, length: 2800, phase: 0.5 },
  { amp: 0.3, length: 1100, phase: 2.0 },
  { amp: 0.1, length: 430, phase: 1.0 },
];

const heartland: Stage = {
  id: 'heartland',
  name: 'Heartland Rollers',
  tagline: 'Endless rolling farmland. Free ride, no finish line.',
  finish: null,
  elevationAt: (d) => (waves(H_ELEV, d) - waves(H_ELEV, 0)) * startRamp(d),
  headingAt: (d) => (waves(H_HEAD, d) - waves(H_HEAD, 0)) * startRamp(d),
  scenery: {
    wildHeight: lowlandHills,
    bumpAmp: 6,
    rockLine: 78,
    snowLine: 108,
    treeLine: 82,
    coniferBias: 0.4,
    forestCover: 0,
    trees: { oak: 0.4, beech: 0.3, cottonwood: 0.15, shrub: 0.15 },
    fields: true,
    mountainScale: 1,
    horizon: 'hills',
  },
  landmarks: [
    GANTRY,
    { file: 'covered-bridge.glb', every: 6000, first: 4000, side: 0, span: 'along', offset: 0, size: 12.5, clearance: 22 },
    { file: 'windmill.glb', every: 1900, first: 600, side: -1, offset: 26, size: 15, yaw: 0.4, clearance: 24 },
    { file: 'barn.glb', every: 2300, first: 950, side: 1, offset: 34, size: 10, yaw: -0.6, clearance: 26 },
    { file: 'farmhouse.glb', every: 2300, first: 1200, side: -1, offset: 32, size: 9, yaw: 0.6, clearance: 26 },
    { file: 'diner.glb', every: 3700, first: 1900, side: -1, offset: 24, size: 6.5, yaw: 0.5, clearance: 24 },
    { file: 'water-tower.glb', every: 4100, first: 2700, side: 1, offset: 46, size: 26, clearance: 18 },
    { file: 'gas-station.glb', every: 4300, first: 1550, side: 1, offset: 23, size: 6.5, yaw: -0.5, clearance: 24 },
    { file: 'silos.glb', every: 3100, first: 2150, side: 1, offset: 40, size: 18, yaw: -0.3, clearance: 26 },
  ],
  signs: [],
};

// ------------------------------------------------------------- Route 66 ----

const R_ELEV: Wave[] = [
  { amp: 6, length: 7000, phase: 0.3 },
  { amp: 1.5, length: 1600, phase: 2.2 },
];
const R_HEAD: Wave[] = [
  { amp: 0.35, length: 6000, phase: 0.2 },
  { amp: 0.08, length: 1500, phase: 1.3 },
];
const R66_FINISH = 25000;

const route66: Stage = {
  id: 'route66',
  timeOfDay: 'dusk',
  name: 'Route 66 Flats',
  tagline: '25 km of fast, flat highway past diners and gas stations. A time-trial.',
  finish: R66_FINISH,
  elevationAt: (d) => (waves(R_ELEV, d) - waves(R_ELEV, 0)) * startRamp(d, 800),
  headingAt: (d) => (waves(R_HEAD, d) - waves(R_HEAD, 0)) * startRamp(d, 800),
  scenery: {
    wildHeight: (x, z) => 2 + fbm(x / 1400, z / 1400, 3) * 40 + Math.max(0, fbm(x / 500 + 3, z / 500, 3)) * 30,
    bumpAmp: 2.5,
    rockLine: 45,
    snowLine: 1e9,
    treeLine: 30,
    coniferBias: 0.15,
    forestCover: -0.15,
    trees: { oak: 0.3, cottonwood: 0.3, beech: 0.2, shrub: 0.2 },
    fields: true,
    mountainScale: 0.8,
    horizon: 'hills',
  },
  landmarks: [
    startArch,
    finishArch(R66_FINISH),
    { file: 'gas-station.glb', every: 3000, first: 800, side: 1, offset: 23, size: 6.5, yaw: -0.5, clearance: 24 },
    { file: 'diner.glb', every: 3500, first: 1700, side: -1, offset: 24, size: 6.5, yaw: 0.5, clearance: 24 },
    { file: 'water-tower.glb', every: 5000, first: 2600, side: 1, offset: 46, size: 26, clearance: 18 },
    { file: 'windmill.glb', every: 2200, first: 1200, side: -1, offset: 26, size: 15, yaw: 0.4, clearance: 24 },
    { file: 'silos.glb', every: 4100, first: 3300, side: 1, offset: 40, size: 18, yaw: -0.3, clearance: 26 },
  ],
  signs: [],
};

/** Least-squares plane e = a + b·x + c·z through the points. */
export function fitPlane(pts: [number, number, number][]) {
  let n = 0, sx = 0, sz = 0, se = 0, sxx = 0, szz = 0, sxz = 0, sxe = 0, sze = 0;
  for (const [x, z, e] of pts) {
    n++; sx += x; sz += z; se += e; sxx += x * x; szz += z * z; sxz += x * z; sxe += x * e; sze += z * e;
  }
  // Solve the 3×3 normal equations by Cramer's rule.
  const m = [
    [n, sx, sz],
    [sx, sxx, sxz],
    [sz, sxz, szz],
  ];
  const r = [se, sxe, sze];
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det(m);
  // Collinear samples (a due north–south or east–west route is exactly this) make the system singular, and
  // dividing by it used to fill the whole terrain with NaN. Fall back to a level plane at the mean height.
  const mean = n ? se / n : 0;
  const t0 = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]);
  const t1 = -m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]);
  const t2 = m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const scale = Math.abs(t0) + Math.abs(t1) + Math.abs(t2);
  if (!Number.isFinite(D) || !Number.isFinite(scale) || scale === 0 || Math.abs(D) < 1e-9 * scale) {
    return () => mean;
  }
  const col = (k: number) => det(m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v))));
  const a = col(0) / D, b = col(1) / D, c = col(2) / D;
  if (![a, b, c].every(Number.isFinite)) return () => mean;
  return (x: number, z: number) => {
    const e = a + b * x + c * z;
    return Number.isFinite(e) ? e : mean;
  };
}

// ----------------------------------------------------------- the catalogue ----
//
// A built-in stage's road (its elevation, bends, scenery, landmarks and signs) is the bulk of the app's first download and a rider
// uses one stage at a time, so every stage but the two flat ones above is a *shell*: a Stage with the light fields filled in from
// stageCatalogue.ts (name, length, tagline, laps ...), whose road fields throw until `loadStage()` has fetched them. Its module is in
// stageDefs/ (or, for Kestrel Vale, worlds/kestrelVale.ts) with the baked road beside it. The shell object itself is the stage
// (its identity is what caches and `stage === currentStage()` compare), and loading fills it in place. See docs/developer-guide/stages-and-gpx.md.

/** The Stage fields that arrive with a stage's road. */
export const HEAVY_STAGE_FIELDS = ['elevationAt', 'headingAt', 'scenery', 'landmarks', 'signs', 'race', 'crowdSpots'] as const;

/** Thrown by reading a stage's road before `loadStage()` finished: the caller forgot to wait. */
export class StageNotLoadedError extends Error {
  constructor(stageId: string, field: string) {
    super(`The road of "${stageId}" has not been loaded yet (reading ${field}): await loadStage() first.`);
    this.name = 'StageNotLoadedError';
  }
}

const loaders = new WeakMap<Stage, Lazy<Stage>>();
const sources = new WeakMap<Stage, () => Promise<Stage>>();

function shell(id: string, build: () => Promise<Stage>): Stage {
  // (Under vitest a missing entry gives a bare shell, so tests/unit/stageCatalogue.test.ts can regenerate the file from the stages.)
  const entry = CATALOGUE[id] ?? (import.meta.env.MODE === 'test' ? { info: { id, name: id, tagline: '', finish: null } as StageInfo } : undefined);
  if (!entry) throw new Error(`stageCatalogue.ts has no entry for "${id}": regenerate it (see its header)`);
  const s = { ...entry.info } as Stage;
  if (entry.info.world) s.world = { ...entry.info.world, lapStage: () => { throw new StageNotLoadedError(id, 'world.lapStage'); } };
  for (const k of HEAVY_STAGE_FIELDS) Object.defineProperty(s, k, { configurable: true, get() { throw new StageNotLoadedError(id, k); } });
  sources.set(s, build);
  loaders.set(s, lazy(() => build().then((built) => {
    for (const k of HEAVY_STAGE_FIELDS) Object.defineProperty(s, k, { value: built[k], writable: true, enumerable: true, configurable: true });
    if (s.world && built.world) s.world.lapStage = built.world.lapStage;
    return s;
  })));
  return s;
}

/** A stage module under stageDefs/ (its default export is the built Stage). */
const fromDef = (id: string, load: () => Promise<{ default: Stage }>) => shell(id, () => load().then((m) => m.default));
/** One of Kestrel Vale's routes: the world module builds all of them. */
const fromVale = (id: string) => shell(id, () => import('./worlds/kestrelVale').then((m) => {
  const built = m.KESTREL_ROUTES.find((r) => r.id === id);
  if (!built) throw new Error(`worlds/kestrelVale.ts has no route "${id}"`);
  return built;
}));

/**
 * The stage's loader, for `use()` (a busy state, then a toast if it fails, and the next try starts afresh): `use(stageLoader(stage), () => ...)`.
 * A stage whose road is already here (Heartland, Route 66, an uploaded route, or a built-in one that has arrived) gives a ready one.
 */
export function stageLoader(stage: Stage): Lazy<Stage> {
  const l = loaders.get(stage);
  if (l) return l;
  return { get: () => Promise.resolve(stage), peek: () => stage, prefetch() {} };
}

/** True once the stage's road can be read (always, for Heartland, Route 66 and an uploaded route). */
export function isStageLoaded(stage: Stage): boolean {
  return stageLoader(stage).peek() !== null;
}

/** Fetches the stage's road (once; every caller shares the load) and resolves with the same, now complete, stage. A failed load can be tried again. */
export function loadStage(stage: Stage): Promise<Stage> {
  return stageLoader(stage).get();
}

/** Builds the stage again from its module, without filling the shell: for the catalogue test, which checks the shell's light fields against it. */
export function stageSource(stage: Stage): Promise<Stage> {
  const build = sources.get(stage);
  return build ? build() : Promise.resolve(stage);
}

const elevationAtSamples = (samples: number[], span: number) => (d: number) => {
  const t = Math.max(0, Math.min(1, d / span)) * (samples.length - 1);
  const i = Math.min(samples.length - 2, Math.floor(t));
  return samples[i] + (samples[i + 1] - samples[i]) * (t - i);
};

/**
 * An elevation function for drawing the stage's profile over [0, finish] (20 km if endless): the stage's own once its road has arrived,
 * until then the catalogue's stored profile, so the hub's cards draw at once without fetching every stage.
 */
export function stageProfile(stage: Stage): (d: number) => number {
  const entry = isStageLoaded(stage) || stage.uploaded ? undefined : CATALOGUE[stage.id];
  return entry ? elevationAtSamples(entry.profile, stage.finish ?? 20000) : (d) => stage.elevationAt(d);
}

/** The catalogue's entry for a built-in stage (also once its road has loaded); undefined for Heartland, Route 66 and uploaded routes. */
export function stageCatalogue(stage: Pick<Stage, 'id' | 'uploaded'>): CatalogueEntry | undefined {
  return stage.uploaded ? undefined : CATALOGUE[stage.id];
}

/** A world's lap as an elevation function over [0, lap], for its hub card. */
export function worldLapProfile(world: { id: string; lap: number }): ((d: number) => number) | null {
  const p = WORLD_PROFILES[world.id];
  return p ? elevationAtSamples(p, world.lap) : null;
}

export { PROFILE_SAMPLES } from './stageCatalogue';

export const STAGES: Stage[] = [
  heartland, route66,
  fromDef('hotw-morgul-bismark', () => import('./stageDefs/morgulBismark')),
  fromDef('hotw-tour-of-the-moon', () => import('./stageDefs/tourOfTheMoon')),
  fromDef('hell-of-the-west', () => import('./stageDefs/hellOfTheWest')),
  fromDef('alpe-dhuez', () => import('./stageDefs/alpe')),
  fromDef('stelvio', () => import('./stageDefs/stelvio')),
  fromDef('ventoux', () => import('./stageDefs/ventoux')),
  fromDef('tourmalet', () => import('./stageDefs/tourmalet')),
  fromDef('zoncolan', () => import('./stageDefs/zoncolan')),
  fromDef('mt-washington', () => import('./stageDefs/mtWashington')),
  fromDef('mt-blue-sky', () => import('./stageDefs/mtBlueSky')),
  fromDef('mt-diablo', () => import('./stageDefs/mtDiablo')),
  fromDef('flagstaff', () => import('./stageDefs/flagstaff')),
  fromDef('richmond-worlds', () => import('./stageDefs/richmondWorlds')),
  fromDef('central-park', () => import('./stageDefs/centralPark')),
  fromDef('harrogate-worlds', () => import('./stageDefs/harrogateWorlds')),
  fromDef('pacific-coast', () => import('./stageDefs/pacificCoast')),
  fromVale('kestrel-vale'), fromVale('kestrel-vale-loop'), fromVale('kestrel-vale-grand'), fromVale('kestrel-vale-raven-scar'), fromVale('kestrel-vale-lakeside'),
];

export function stageById(id: string | null): Stage {
  return STAGES.find((s) => s.id === id) ?? heartland;
}
