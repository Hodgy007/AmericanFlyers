// Stage definitions: each stage supplies its own elevation profile, road
// bends, scenery style, roadside landmarks and signs.

import type { MonumentId, MonumentOptions } from './world/monumentTypes';
import type { CultureId } from './world/crowdCulture';
import type { WaterBody } from './world/waterTypes';
import { fbm, smoothstep } from './world/noise.js';
import type { TreeMix } from './world/trees.js';
import { RIM_ROCK_SECTIONS, makeRoadside } from './world/canyon.js';
import { basinHeight, summitCone, type Basin, type SummitCone } from './world/summitCone';
import { eastSouth, flatironsPlacement, type LonLat } from './world/flatironsPlacement';
import type { RealRouteData } from './routes/realRoute';
import { detectHairpins, elevationFrom, mapRoute } from './routes/realStage';
import alpeRoute from './routes/real/alpe-dhuez';
import stelvioRoute from './routes/real/stelvio';
import ventouxRoute from './routes/real/ventoux';
import tourmaletRoute from './routes/real/tourmalet';
import zoncolanRoute from './routes/real/zoncolan';
import washingtonRoute from './routes/real/mt-washington';
import blueSkyRoute from './routes/real/mt-blue-sky';
import diabloRoute from './routes/real/mt-diablo';
import flagstaffRoute from './routes/real/flagstaff';
import echoLakeRoute from './routes/real/hell-of-the-west';
import morgulRoute from './routes/real/hotw-morgul-bismark';
import moonRoute from './routes/real/hotw-tour-of-the-moon';
import richmondRoute from './routes/real/richmond-worlds';
import centralParkRoute from './routes/real/central-park';
import harrogateRoute from './routes/real/harrogate-worlds';
import pacificRoute from './routes/real/pacific-coast';
import { sinkInto } from './world/waterTypes';
import { skylineHeight, skylineTowers } from './world/skyline';

interface LandmarkBase {
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
}

/** The road's look: 'us-highway' (double yellow dashed, white edge lines, gravel shoulders), 'alpine' (white dashed centre, thin edge lines), 'lane' (no markings) or 'park' (solid double yellow, red chip seal). */
export type RoadStyle = 'us-highway' | 'alpine' | 'lane' | 'park';

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

/** A code-built landmark standing once at course distance `d` (see world/monuments.ts). `size` is its height in metres. */
export const monumentAt = (model: MonumentId, d: number, side: -1 | 1, offset: number, size: number, extra: Partial<LandmarkBase> & { options?: MonumentOptions } = {}): LandmarkKind =>
  ({ model, first: d, every: 1e9, side, offset, size, clearance: 8, ...extra });

/** A code-built landmark at a fixed place in the world (see `LandmarkBase.world`), in range the whole stage: `size` is its height in metres. */
const monumentInWorld = (model: MonumentId, world: NonNullable<LandmarkBase['world']>, size: number, extra: Partial<LandmarkBase> & { options?: MonumentOptions } = {}): LandmarkKind =>
  ({ model, first: 0, every: 1e9, side: 0, offset: 0, size, clearance: 1, reach: 20000, world, ...extra });

/** The summit board at the top of a European climb, just before the finish line, on the right. */
const colSign = (finish: number, options: MonumentOptions): LandmarkKind => monumentAt('col-sign', finish - 55, 1, 8.5, 2.6, { yaw: -0.35, clearance: 6, options });

export const GANTRY: LandmarkKind = { file: 'gantry.glb', every: 5000, first: 30, side: 0, span: 'across', offset: 0, size: 13, clearance: 12 };
export const startArch: LandmarkKind = { ...GANTRY, every: 1e9 };
export const finishArch = (at: number): LandmarkKind => ({ ...GANTRY, first: at, every: 1e9 });

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

// -------------------------------------------------------- mountain climbs ----
//
// A climb follows its real road: heading and elevation come from OpenStreetMap and SRTM data baked by
// scripts/bake-routes.mjs (src/routes/real/), mapped onto the stage's published length and rescaled to
// its published gain. Its hairpins are found in that heading (routes/realStage.ts) and numbered
// when the road numbers them (Alpe d'Huez, Stelvio).

interface ClimbSpec {
  id: string;
  name: string;
  tagline: string;
  route: RealRouteData;
  length: number; // metres
  gain: number; // metres
  /** The steepest gradient as a fraction, near the published maximum (SRTM's ramps are flattened to it). Default 0.25. */
  maxGrade?: number;
  /** % per kilometre as published: each kilometre of the real profile is rescaled to it (left out: the real profile's own). */
  kmGrades?: number[];
  /** The official number of numbered hairpins. Left out: the road's hairpins are not numbered. */
  hairpins?: number;
  /** Named places that get a "next:" announcement (a function is given the sites, to place them by altitude). */
  places?: { d: number; name: string }[] | ((at: ClimbSites) => { d: number; name: string }[]);
  hairpinWord: string;
  baseAltitude: number;
  timeOfDay?: Stage['timeOfDay'];
  weather?: Stage['weather'];
  scenery: Omit<Scenery, 'wildHeight'>;
  /** A bare cone at the summit that the ground falls away from, so buildings there stand clear of the land (world/summitCone.ts). */
  summit?: SummitCone;
  /** A basin the wild ground sinks into, so a distant landmark can be seen across it (world/summitCone.ts). */
  basin?: Basin;
  /**
   * Landmarks beyond the start and finish arches. A function is given where things on the road are
   * (see ClimbSites), for those that belong at a particular bend or altitude.
   */
  landmarks?: LandmarkKind[] | ((at: ClimbSites) => LandmarkKind[]);
}

/** Where things on a climb can be anchored. */
interface ClimbSites {
  /** A numbered hairpin's apex and which side of the road is the outside of its turn. */
  hairpin(label: string): { d: number; outside: -1 | 1 };
  /** Course distance where the road first reaches this altitude above sea level. */
  altitude(metres: number): number;
}

const SIGN_LEAD = 12; // metres before a hairpin that its number sign stands
const PLANE_STEP = 2; // metres between samples when fitting the land to the road

/**
 * A plane through the road's rise across the land beside it, so the ground far from the road climbs
 * with it instead of the road sitting on a pillar.
 */
function landPlane(headingAt: (d: number) => number, elevationAt: (d: number) => number, length: number) {
  let x = 0, z = 0;
  const pts: [number, number, number][] = [];
  for (let d = 0; d < length; d += PLANE_STEP) {
    const h = headingAt(d + PLANE_STEP / 2);
    x += Math.cos(h) * PLANE_STEP;
    z += Math.sin(h) * PLANE_STEP;
    if (d % 50 === 0) pts.push([x, z, elevationAt(d)]);
  }
  return fitPlane(pts);
}

function buildClimb(spec: ClimbSpec): Stage {
  const { length } = spec;
  const geo = mapRoute(spec.route, length);
  const { headingAt } = geo;
  const elevationAt = elevationFrom(geo, length, { gain: spec.gain, maxGrade: spec.maxGrade, climbOnly: true }, spec.kmGrades);

  const found = detectHairpins(headingAt, length, spec.hairpins);
  const numbered = spec.hairpins !== undefined;
  const at: ClimbSites = {
    hairpin: (label) => {
      const i = found.findIndex((_, k) => String(found.length - k) === label);
      if (!numbered || i < 0) throw new Error(`${spec.id} has no hairpin ${label}`);
      // A right turn (heading rising) has its outside on the left.
      return { d: found[i].apex, outside: found[i].turn > 0 ? -1 : 1 };
    },
    altitude: (metres) => {
      for (let d = 0; d < length; d += 5) if (spec.baseAltitude + elevationAt(d) >= metres) return d;
      return length;
    },
  };
  const signs: StageSign[] = found.map((h, i) => ({
    d: Math.max(0, h.start - SIGN_LEAD),
    label: numbered ? String(found.length - i) : '',
    style: 'hairpin',
    numbered,
  }));
  const places = typeof spec.places === 'function' ? spec.places(at) : spec.places ?? [];
  for (const p of places) signs.push({ d: p.d, label: '', name: p.name, style: 'hairpin', numbered: false });
  signs.sort((a, b) => a.d - b.d);

  const plane = landPlane(headingAt, elevationAt, length);

  const cone = spec.summit ? summitCone(spec.summit, headingAt, elevationAt) : null;
  const basin = spec.basin ? basinHeight(spec.basin) : null;
  const wildHeight = (wx: number, wz: number) => {
    const base = Math.max(-40, Math.min(spec.gain + 150, plane(wx, wz)));
    const massif = fbm(wx / 1300, wz / 1300, 4) * 260;
    const ridges = (1 - Math.abs(fbm(wx / 420 + 7, wz / 420 - 3, 3))) * 170;
    const wild = base + 60 + massif + ridges;
    return basin ? basin(wx, wz, cone ? cone(wx, wz, wild) : wild) : cone ? cone(wx, wz, wild) : wild;
  };

  const extra = typeof spec.landmarks === 'function' ? spec.landmarks(at) : spec.landmarks ?? [];

  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    finish: length,
    elevationAt,
    headingAt,
    scenery: { ...spec.scenery, wildHeight },
    landmarks: [startArch, finishArch(length), ...extra],
    signs,
    hairpinWord: spec.hairpinWord,
    baseAltitude: spec.baseAltitude,
    timeOfDay: spec.timeOfDay,
    weather: spec.weather,
  };
}

// From Le Bourg-d'Oisans (723 m) to the top (1841 m). The road is the real one;
// per-kilometre gradients from swi-cycling.com. Its 21 hairpins are found in the road.
const alpe = buildClimb({
  id: 'alpe-dhuez',
  route: alpeRoute,
  name: "Alpe d'Huez",
  tagline: "14 km at 8% from Le Bourg-d'Oisans, up all 21 hairpins. Real gradients.",
  kmGrades: [9.3, 10.2, 8.6, 8.2, 8.6, 8.0, 8.6, 8.9, 7.3, 8.4, 8.8, 8.7, 5.8, 2.4],
  length: 14000,
  gain: 1118,
  maxGrade: 0.135,
  hairpins: 21,
  hairpinWord: 'Virage',
  baseAltitude: 723,
  scenery: {
    bumpAmp: 10,
    rockLine: 1250,
    snowLine: 1650,
    treeLine: 760,
    coniferBias: 0.9,
    forestCover: 0.3,
    trees: { spruce: 0.5, larch: 0.25, beech: 0.25 },
    fields: false,
    mountainScale: 2.6,
    road: 'alpine',
  },
  landmarks: (at) => {
    const seven = at.hairpin('7'); // Huez village: its church stands on the outside of hairpin 7
    return [
      monumentAt('alpine-church', seven.d, seven.outside, 30, 26.6, { yaw: seven.outside * -0.3, clearance: 16 }),
      monumentAt('ski-apartments', 13450, -1, 38, 14, { options: { seed: 1 }, yaw: 0.3, clearance: 30 }),
      monumentAt('ski-apartments', 13700, 1, 42, 17, { options: { seed: 2 }, yaw: -0.3, clearance: 30 }),
      colSign(14000, { style: 'fr', lines: ["ALPE D'HUEZ", '1850 m'] }),
    ];
  },
});

// From Prato allo Stelvio (~915 m) to the pass (2758 m): 24.5 km, 1843 m,
// 7.5% average (mycols.app, climbfinder.com). The road is the real one: an
// easier valley start past Gomagoi and Trafoi, then the 48 hairpins, which
// bunch into the famous wall below the summit.
const stelvio = buildClimb({
  id: 'stelvio',
  route: stelvioRoute,
  name: 'Stelvio Pass',
  tagline: '24.5 km at 7.5% from Prato to 2758 m, through 48 numbered hairpins.',
  kmGrades: [4.5, 5.0, 5.5, 6.0, 6.0, 6.5, 6.5, 7.0, 7.5, 8.0, 8.0, 8.5, 8.5, 8.0, 8.5, 8.5, 9.0, 8.5, 8.5, 8.0, 8.5, 8.5, 8.0, 8.0, 7.5],
  length: 24500,
  gain: 1843, // 915 m + 1843 m = 2758 m at the pass
  maxGrade: 0.13,
  hairpins: 48,
  hairpinWord: 'Tornante',
  baseAltitude: 915,
  scenery: {
    bumpAmp: 12,
    rockLine: 1150,
    snowLine: 1760,
    treeLine: 1050,
    coniferBias: 0.95,
    forestCover: 0.35,
    trees: { spruce: 0.45, larch: 0.3, pine: 0.25 },
    fields: false,
    mountainScale: 3.4,
    road: 'alpine',
    barrier: 'stone',
  },
  landmarks: [
    monumentAt('pass-buildings', 24400, 1, 30, 22.5, { options: { style: 'it' }, yaw: -0.25, clearance: 28 }),
    monumentAt('pass-buildings', 24470, -1, 36, 22.5, { options: { seed: 5 }, yaw: 0.25, clearance: 28 }),
    colSign(24500, { style: 'it', lines: ['PASSO DELLO STELVIO', '2758 m'] }),
  ],
});

// "Hell of the West", the final stage in American Flyers (1985): filmed on
// Colorado 103 from Idaho Springs (2,293 m) up Chicago Creek to the sprint at
// Echo Lake (3,235 m), below Mount Evans (fast-rewind.com filming notes).
// 20.8 km, 942 m: about 3.5% for the first 11 km, 5.8% for the next 9, then
// the short flat at the lake (pjammcycling.com, summitbiking.org); the real
// road's profile and its two wide switchbacks, in the steeper upper half.
const hellOfTheWestClimb = buildClimb({
  id: 'hell-of-the-west', // keep this id: leaderboards and plans use it
  route: echoLakeRoute,
  name: 'Hell of the West · Stage 3: Echo Lake',
  tagline: 'The Hell of the West’s final stage: 20.8 km from Idaho Springs up Chicago Creek to the sprint at Echo Lake, 3,235 m.',
  kmGrades: [3.0, 3.2, 3.6, 3.8, 3.4, 3.0, 3.8, 4.0, 3.6, 3.4, 3.9, 5.2, 5.8, 6.2, 6.0, 5.8, 6.4, 6.0, 5.6, 5.9, 1.2],
  length: 20800,
  gain: 942,
  maxGrade: 0.1,
  hairpinWord: 'Switchback',
  baseAltitude: 2293,
  timeOfDay: 'dusk',
  scenery: {
    bumpAmp: 12,
    rockLine: 1100,
    snowLine: 1500, // the 4,000 m peaks around Mount Evans keep snow; the road stays below it
    treeLine: 1220, // Colorado's treeline is near 3,500 m, above Echo Lake
    coniferBias: 1,
    forestCover: 0.45,
    trees: { pine: 0.5, spruce: 0.35, aspen: 0.15 },
    fields: false,
    mountainScale: 3.2,
  },
  landmarks: [monumentAt('log-lodge', 20720, 1, 30, 8.1, { yaw: -0.4, clearance: 22 })],
});

const hellOfTheWest: Stage = {
  ...hellOfTheWestClimb,
  tourStage: 3,
  // Echo Lake is a summit finish. The mountain prime is where the road leaves
  // the creek and starts to climb in earnest (approximate: no published prime).
  race: { summits: [{ d: 12500, name: 'Chicago Creek prime', cat: 3 }, { d: 20800, name: 'Echo Lake', cat: 1 }], sprints: [{ d: 10400, name: 'Mid-stage sprint' }] },
};

// Mont Ventoux from Bédoin (300 m) to the summit (1,910 m): 21.4 km, 1,610 m,
// 7.5%. Gentle vineyards to Saint-Estève, then 9–10% through the forest to
// Chalet Reynard, then the bare white limestone to the top. The road and its
// profile are the real ones. The white scree is the ground's scree layer (`screeLine`).
const ventoux = buildClimb({
  id: 'ventoux',
  route: ventouxRoute,
  name: 'Mont Ventoux',
  tagline: '21.4 km at 7.5% from Bédoin: the forest at 9–10%, then the bare white moonscape to 1,910 m.',
  kmGrades: [4.3, 4.8, 3.4, 5.2, 4.4, 7.6, 10.7, 9.4, 9.2, 9.4, 9.7, 9.0, 8.4, 8.9, 9.1, 6.4, 7.4, 7.8, 6.5, 8.1, 9.0, 9.0],
  length: 21400,
  gain: 1610,
  maxGrade: 0.13,
  hairpinWord: 'Virage',
  baseAltitude: 300,
  scenery: {
    bumpAmp: 9,
    rockLine: 1060,
    snowLine: 1e9, // it is summer: the white summit is limestone, not snow
    screeLine: 1150, // the bald white summit above Chalet Reynard (about 1,450 m up the mountain)
    treeLine: 1100,
    coniferBias: 0.7,
    forestCover: 0.35,
    trees: { oak: 0.3, pine: 0.4, beech: 0.3 },
    fields: false,
    mountainScale: 1.6,
    road: 'alpine',
    barrier: 'stone',
  },
  // Chalet Reynard is at 1,440 m on the real road; the Simpson memorial stands 1.3 km below the top.
  places: (at) => [{ d: 5500, name: 'Saint-Estève' }, { d: at.altitude(1440) - 90, name: 'Chalet Reynard' }],
  landmarks: (at) => [
    monumentAt('chalet', at.altitude(1440), 1, 24, 10.2, { options: { lines: ['CHALET REYNARD'] }, yaw: -0.4, clearance: 20 }),
    monumentAt('simpson-memorial', 20100, 1, 8, 2.9, { yaw: -0.5, clearance: 6 }),
    monumentAt('ventoux-observatory', 21330, -1, 46, 52, { yaw: 0.2, clearance: 34 }),
    colSign(21400, { style: 'fr', lines: ['MONT VENTOUX', '1910 m'] }),
  ],
});

// Col du Tourmalet from Luz-Saint-Sauveur (711 m) to the col (2,115 m):
// 19 km, 1,404 m, 7.4%; steadier below Barèges, then 8.5–10% through the
// hairpins of Super-Barèges. The road and its profile are the real ones.
const tourmalet = buildClimb({
  id: 'tourmalet',
  route: tourmaletRoute,
  weather: 'cloudy',
  name: 'Col du Tourmalet',
  tagline: '19 km at 7.4% from Luz-Saint-Sauveur, through Barèges and the hairpins to 2,115 m.',
  kmGrades: [5.2, 6.4, 7.0, 7.2, 7.0, 7.4, 6.2, 6.8, 7.2, 7.6, 7.8, 7.0, 8.6, 8.8, 9.2, 8.4, 9.0, 9.6, 9.8],
  length: 19000,
  gain: 1404,
  maxGrade: 0.12,
  hairpinWord: 'Virage',
  baseAltitude: 711,
  scenery: {
    bumpAmp: 12,
    rockLine: 1150,
    snowLine: 1650,
    treeLine: 900,
    coniferBias: 0.6,
    forestCover: 0.3,
    trees: { beech: 0.45, pine: 0.3, shrub: 0.25 },
    fields: false,
    mountainScale: 3.0,
    road: 'alpine',
    barrier: 'stone',
  },
  // Barèges is at 1,230 m; La Mongie's apartment blocks stand about 4 km below the col.
  places: (at) => [{ d: at.altitude(1230), name: 'Barèges' }, { d: 14800, name: 'La Mongie' }],
  landmarks: [
    monumentAt('ski-apartments', 15000, -1, 38, 17, { options: { seed: 3 }, yaw: 0.3, clearance: 30 }),
    monumentAt('ski-apartments', 15180, 1, 44, 17, { options: { seed: 4 }, yaw: -0.3, clearance: 30 }),
    monumentAt('geant-tourmalet', 18940, 1, 20, 7.4, { yaw: -0.35, clearance: 12 }),
    colSign(19000, { style: 'fr', lines: ['COL DU TOURMALET', 'ALT. 2115 m'] }),
  ],
});

// Monte Zoncolan from Ovaro (525 m) to the top (1,735 m): 10.1 km, 1,210 m,
// 11.9%, with long stretches at 13–15% and ramps over 20%. The road and its
// profile are the real ones (the steepest ramps flattened to 22%).
const zoncolan = buildClimb({
  id: 'zoncolan',
  route: zoncolanRoute,
  name: 'Monte Zoncolan',
  tagline: '10.1 km at 11.9% from Ovaro, with ramps over 20%. The hardest climb in Italy.',
  kmGrades: [6.5, 8.8, 12.4, 14.2, 15.0, 14.5, 13.8, 15.4, 13.6, 8.0, 6.0],
  length: 10100,
  gain: 1210,
  maxGrade: 0.22,
  hairpinWord: 'Tornante',
  baseAltitude: 525,
  scenery: {
    bumpAmp: 11,
    rockLine: 1150,
    snowLine: 1500,
    treeLine: 1000,
    coniferBias: 0.8,
    forestCover: 0.4,
    trees: { beech: 0.55, spruce: 0.45 },
    fields: false,
    mountainScale: 2.8,
    road: 'lane',
  },
  landmarks: [colSign(10100, { style: 'it', lines: ['MONTE ZONCOLAN', '1750 m'] })],
});

// ------------------------------------------------------ American climbs ----
//
// Four famous US hill climbs on their real roads (OpenStreetMap, SRTM). Their summit boards are the
// brown park signs (`summit-sign-us`), and each ends at the building or ruin that stands there.

/** The wooden park sign at the top of an American climb, just before the finish, on the right. */
const summitSign = (finish: number, ...lines: string[]): LandmarkKind =>
  monumentAt('summit-sign-us', finish - 55, 1, 8, 2.8, { yaw: -0.35, clearance: 6, options: { lines } });

// Mount Washington Auto Road, New Hampshire: from the toll house on NH-16 (about 1,640 ft) to the summit
// parking at 6,288 ft (1,917 m). 7.6 miles (12.2 km) climbing 4,650 ft (1,417 m) at 12% on average, with
// stretches of 18% and the last 50 yards at 22% (the Mount Washington Hillclimb: wikipedia.org, mwarbh.org).
// Northern hardwoods, then spruce and fir, then krummholz at the tree line (about 4,400 ft) and bare grey rock
// above; usually in cloud and always windy. The road is tagged bicycle=no, so it is baked with the car profile.
const mtWashington = buildClimb({
  id: 'mt-washington',
  route: washingtonRoute,
  name: 'Mount Washington Auto Road',
  tagline: '7.6 miles at 12% from the Glen House to the summit of New England, with the last pitch at 22%. Cloud, wind and bare rock above the tree line.',
  length: 12200,
  gain: 1417,
  maxGrade: 0.22,
  hairpinWord: 'Switchback',
  baseAltitude: 499,
  weather: 'cloudy',
  places: (at) => [{ d: at.altitude(1170), name: 'Halfway House' }],
  scenery: {
    bumpAmp: 12,
    rockLine: 700, // bare rock from about 1,200 m
    snowLine: 1700, // it is summer: no snow on the road
    treeLine: 850, // krummholz at about 1,350 m
    coniferBias: 0.7,
    forestCover: 0.5,
    trees: { beech: 0.3, spruce: 0.5, aspen: 0.12, shrub: 0.08 },
    fields: false,
    mountainScale: 3.0,
    road: 'lane',
    barrier: 'none', // the Auto Road is unguarded over most of its length: steep drops, no rails
  },
  // The ground falls away from a bare cone at the summit, so the buildings stand against the sky and are in view from
  // the last 500 m (the generic wild ground climbs hundreds of metres within a kilometre of the road and hid them).
  summit: { d: 12225, side: 1, offset: 40, rise: 3, flat: 60, slope: 0.5, fadeFrom: 380, fadeTo: 1200 },
  landmarks: [
    monumentAt('washington-summit', 12225, 1, 40, 38.5, { yaw: -0.12, clearance: 40 }), // the buildings: inside the last bend, just past the finish, so they are ahead on the right from 500 m out, off the right edge at 200 m (the camera swings 100 degrees by 50 m out), and ahead again in the last 100 m
    monumentAt('washington-tower', 12200, -1, 60, 57, { clearance: 20 }), // the broadcast tower, apart from them on the outside of the bend, straight ahead of the last straight: it is what the camera sees at 200 m
    summitSign(12200, 'MOUNT WASHINGTON', 'ELEV. 6,288 FT'),
  ],
});

// Mount Blue Sky (formerly Mount Evans), Colorado: Colorado 5 from Echo Lake Lodge (10,600 ft) to the summit
// parking at 14,130 ft, the highest paved road in North America. 14.5 miles (23.3 km), 3,543 ft (1,080 m) of
// climbing at 4.6% (pjammcycling.com, codot.gov). Spruce and bristlecone pines below the tree line (about 3,500 m),
// then tundra, rock and lingering snow; Summit Lake is at 12,830 ft. It carries on from the Hell of the West's Echo Lake stage.
const mtBlueSky = buildClimb({
  id: 'mt-blue-sky',
  route: blueSkyRoute,
  name: 'Mount Blue Sky',
  tagline: '14.5 miles from Echo Lake Lodge, where the Hell of the West stops, up the highest paved road in North America to 14,130 ft.',
  length: 23300,
  gain: 1080,
  maxGrade: 0.09,
  hairpinWord: 'Switchback',
  baseAltitude: 3231,
  places: [{ d: 14630, name: 'Summit Lake' }],
  scenery: {
    bumpAmp: 12,
    rockLine: 350,
    snowLine: 1100, // lingering snow patches near the top
    treeLine: 270, // about 3,500 m
    coniferBias: 1,
    forestCover: 0.35,
    trees: { spruce: 0.55, pine: 0.45 },
    fields: false,
    mountainScale: 3.6,
    road: 'park',
  },
  landmarks: [
    monumentAt('log-lodge', 70, 1, 20, 8.1, { options: { lines: ['ECHO LAKE LODGE'] }, yaw: -0.4, clearance: 22 }),
    monumentAt('crest-house-ruins', 23180, 1, 42, 5.6, { yaw: -0.3, clearance: 24 }),
    summitSign(23300, 'MOUNT BLUE SKY', '14,130 FT'),
  ],
});

// Mount Diablo, California: from Diablo Road in Danville up Mount Diablo Scenic Boulevard, South Gate Road and
// Summit Road to the summit (3,849 ft, 1,173 m). The Mount Diablo Challenge's 11.2 miles (18 km) climb 3,249 ft
// (990 m) from the Athenian School's road (mountdiablochallenge.itsyourrace.com). Golden summer grass, blue and
// live oaks, grey pines and chaparral. (It stays on daytime light: at dusk the straw goes brown.)
const mtDiablo = buildClimb({
  id: 'mt-diablo',
  route: diabloRoute,
  name: 'Mount Diablo',
  tagline: '11.2 miles from Danville through South Gate to the stone summit tower, over golden grass and oaks.',
  length: 18000,
  gain: 990,
  maxGrade: 0.16,
  hairpinWord: 'Switchback',
  baseAltitude: 183,
  places: [{ d: 5900, name: 'South Gate' }],
  scenery: {
    bumpAmp: 9,
    rockLine: 750,
    snowLine: 1900,
    treeLine: 1500,
    dryGrass: 1,
    coniferBias: 0.3,
    forestCover: 0.1, // oak savanna: groves among the grass
    trees: { oak: 0.5, pine: 0.2, shrub: 0.3 },
    fields: false,
    mountainScale: 1.8,
    road: 'park',
  },
  landmarks: [
    monumentAt('diablo-summit', 18035, 1, 26, 19, { yaw: -0.2, clearance: 24 }),
    summitSign(18000, 'MOUNT DIABLO', 'SUMMIT 3,849 FT'),
  ],
});

// Flagstaff Mountain, Boulder, Colorado: Flagstaff Road from Baseline Road (5,730 ft) round Panorama Point and up
// the switchbacks to the crest at 7,705 ft. 4.6 miles, 1,975 ft (602 m), 8.1% (pjammcycling.com; the Super Flag
// climb the locals race). Ponderosa pine and open meadow, sandstone outcrops, and the Flatirons across the valley.
const FLAGSTAFF_START: LonLat = [-105.2877748, 40.0000659]; // Baseline Road and Flagstaff Road: the point the road is baked from
const FLAGSTAFF_FLATIRONS_SIZE = 270; // m tall: about 10 degrees of sky from the start, so they read from the road
const FIRST_FLATIRON: LonLat = [-105.29467, 39.99047];
const FIFTH_FLATIRON: LonLat = [-105.29281, 39.982];
const flatirons = flatironsPlacement(FLAGSTAFF_START, FIRST_FLATIRON, FIFTH_FLATIRON, [-105.2, 39.99], FLAGSTAFF_FLATIRONS_SIZE);
const flatironsMid = { x: (eastSouth(FLAGSTAFF_START, FIRST_FLATIRON).x + eastSouth(FLAGSTAFF_START, FIFTH_FLATIRON).x) / 2, z: (eastSouth(FLAGSTAFF_START, FIRST_FLATIRON).z + eastSouth(FLAGSTAFF_START, FIFTH_FLATIRON).z) / 2 };
const FLAGSTAFF_FLATIRONS = monumentInWorld('flatirons', { x: flatirons.x, z: flatirons.z, y: 10, yaw: flatirons.yaw }, FLAGSTAFF_FLATIRONS_SIZE);

const flagstaff = buildClimb({
  id: 'flagstaff',
  route: flagstaffRoute,
  name: 'Flagstaff Mountain',
  tagline: '4.6 miles at 8% up Boulder’s own climb: Flagstaff Road from Baseline, with the Flatirons beside the first switchbacks.',
  length: 7400,
  gain: 602,
  maxGrade: 0.13,
  hairpinWord: 'Switchback',
  baseAltitude: 1746,
  places: [{ d: 1125, name: 'Panorama Point' }],
  scenery: {
    bumpAmp: 9,
    rockLine: 500,
    snowLine: 1100,
    treeLine: 900,
    coniferBias: 0.9,
    forestCover: 0.15,
    trees: { pine: 0.75, spruce: 0.1, shrub: 0.15 },
    fields: false,
    mountainScale: 2.4,
    road: 'us-highway',
  },
  // Boulder lies in a basin below the road and the Flatirons rise from its edge: sink the wild ground towards them so the road
  // looks across to them instead of into the hillside beside it.
  basin: { ...flatironsMid, radius: 900, fade: 1500, floor: 0 },
  landmarks: [
    // The Flatirons stand where they really do: their slabs run north to south about 1.1 to 2 km south-west of the start
    // (the First Flatiron at 39°59'25.7"N 105°17'40.8"W, the Fifth at 39°58'55.2"N 105°17'34.1"W, uncovercolorado.com)
    // and face east, over Boulder. So they are on the left of the lower road and of the first switchbacks, and the road
    // swings round until they are behind it. See world/flatironsPlacement.ts.
    FLAGSTAFF_FLATIRONS,
    summitSign(7400, 'FLAGSTAFF MOUNTAIN'),
  ],
});

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
  const col = (k: number) => det(m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v))));
  const a = col(0) / D, b = col(1) / D, c = col(2) / D;
  return (x: number, z: number) => a + b * x + c * z;
}

// ------------------------------------------------ Hell of the West tour ----
//
// American Flyers (1985) has three stages: the Morgul-Bismark circuit near
// Boulder, the "Tour of the Moon" through Colorado National Monument, and the
// final climb to Echo Lake (the existing Hell of the West stage). Stage 1's
// loop and stage 2's road are the real ones (see routes/real/); stage 1's
// elevation is shaped from published figures.

/** Monotone cubic interpolation (Fritsch–Carlson) through (x, y) knots: no overshoot, no flat spots. */
function pchip(knots: [number, number][]) {
  const n = knots.length;
  const h: number[] = [];
  const dl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(knots[i + 1][0] - knots[i][0]);
    dl.push((knots[i + 1][1] - knots[i][1]) / h[i]);
  }
  const m: number[] = new Array(n);
  m[0] = dl[0];
  m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (dl[i - 1] * dl[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]);
    }
  }
  return (x: number) => {
    if (x <= knots[0][0]) return knots[0][1];
    if (x >= knots[n - 1][0]) return knots[n - 1][1];
    let i = 0;
    while (knots[i + 1][0] < x) i++;
    const t = (x - knots[i][0]) / h[i];
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * knots[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * knots[i + 1][1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---- Stage 1: Morgul-Bismark ----
//
// The Morgul-Bismark loop around Superior, south of Boulder, used by the Red Zinger and Coors
// Classics and for the first race in the film: 13.1 miles (21.1 km), starting
// where Highway 128 meets McCaslin Boulevard, west on 128 to Highway 93, north
// on 93, east on 170 and back down McCaslin, with "The Wall" at the south end
// of McCaslin: a mile-long incline that kicks up to 18% (wikipedia.org
// Morgul-Bismark; coloradohometownweekly.com 2011-05-25 gives 13.3 mi). The
// Coors Classic riders did eight laps and sprinted to the top of the Wall.
// Here the lap is ridden the way the Coors Classic finished it, in that
// direction: out along 128, round, and up the Wall to the line, two laps
// (42 km). The shape of the loop is the real road's (OpenStreetMap, baked
// into routes/real/hotw-morgul-bismark.ts, which is a little longer than
// the stage's lap and is scaled to it, and closes exactly so laps meet). The elevation is
// approximated (about 90 m up the Wall, a rolling 128, a gentle rise to
// Highway 93); the Wall is the lap's last 1,600 m.
const MB_WALL = 1600; // "one mile"
// The lap's length, which leaderboards and races are timed against, kept to the metre it had as a
// rounded rectangle: 3,240 m of McCaslin above the Wall, two 5,600 m east-west roads, 4,840 m of
// Highway 93 (to the Wall's foot) and four 40 m corners, in lap order.
const MB_ARC = (Math.PI / 2) * 40;
const MB_PIECES = [3240, MB_ARC, 5600, MB_ARC, 4840, MB_ARC, 5600, MB_ARC, MB_WALL];
const MB_LAP = MB_PIECES.reduce((a, v) => a + v, 0);
// Where Highway 93 begins and where the second east-west road does, which the elevation knots below sit at.
const MB_HWY93 = MB_PIECES.slice(0, 4).reduce((a, v) => a + v, 0);
const MB_SOUTH = MB_PIECES.slice(0, 6).reduce((a, v) => a + v, 0);
const MB_LAPS = 2;
const MB_FINISH = MB_LAP * MB_LAPS;
const mbRoute = mapRoute(morgulRoute, MB_LAP);
/** Half way up the Highway 93 leg of the lap (found from the baked road): the sprint, and the Flatirons stand opposite. */
const MB_SPRINT = 6900;
// The real loop turns a whole number of times (once, clockwise); each lap adds that again.
const MB_TURN = mbRoute.headingAt(MB_LAP) - mbRoute.headingAt(0);
function mbHeading(d: number) {
  if (d <= 0) return mbRoute.headingAt(0);
  const lap = Math.floor(d / MB_LAP);
  return mbRoute.headingAt(d - lap * MB_LAP) + lap * MB_TURN;
}

// Elevation above the line at the top of the Wall, around one lap.
const MB_WALL_START = MB_LAP - MB_WALL;
// The Wall: gradient per 80 m, building to 18% and easing again just before the line.
const MB_WALL_GRADES = [1, 1, 1.5, 1.5, 2, 2, 2.5, 2.5, 3.5, 3.5, 4.5, 4.5, 6, 7, 9, 12, 16, 18, 12, 6];
const MB_WALL_STEP = MB_WALL / MB_WALL_GRADES.length;
const MB_WALL_RISE = MB_WALL_GRADES.reduce((a, g) => a + (g / 100) * MB_WALL_STEP, 0); // ≈ 90 m
const mbWall = (m: number) => {
  let e = -MB_WALL_RISE;
  for (let i = 0; i < MB_WALL_GRADES.length; i++) {
    const seg = Math.min(MB_WALL_STEP, Math.max(0, m - i * MB_WALL_STEP));
    e += (MB_WALL_GRADES[i] / 100) * seg;
  }
  return e;
};
const mbBase = pchip([
  [0, 0], [3240, 12], [5900, 30], [MB_HWY93, 36], [11400, 41], [MB_SOUTH, 24], [16700, -32], [MB_WALL_START, -MB_WALL_RISE],
]);
const MB_KNOT_U = [0, 3240, 5900, MB_HWY93, 11400, MB_SOUTH, 16700, MB_WALL_START];
function mbLapElevation(u: number) {
  if (u >= MB_WALL_START) return mbWall(u - MB_WALL_START);
  // Rolling swells between the knots, fading to nothing at each knot.
  let i = 0;
  while (i < MB_KNOT_U.length - 2 && MB_KNOT_U[i + 1] < u) i++;
  const f = (u - MB_KNOT_U[i]) / (MB_KNOT_U[i + 1] - MB_KNOT_U[i]);
  const env = Math.sin(Math.PI * f);
  return mbBase(u) + env * (4.2 * Math.sin((2 * Math.PI * u) / 1050 + 0.8) + 1.8 * Math.sin((2 * Math.PI * u) / 410 + 2.3));
}
const mbElevation = (d: number) => mbLapElevation(((d % MB_LAP) + MB_LAP) % MB_LAP);

/** Farm landmarks whose spacing divides the lap, so the second lap shows the same scenery. */
const lapFarm = FARM_LANDMARKS.map((k) => ({ ...k, every: MB_LAP / Math.round(MB_LAP / k.every) }));

const morgulBismark: Stage = {
  id: 'hotw-morgul-bismark',
  name: 'Hell of the West · Stage 1: Morgul-Bismark',
  tagline: 'Two 21 km laps of the Boulder circuit, finishing up The Wall (18%) each time.',
  finish: MB_FINISH,
  lapLength: MB_LAP,
  elevationAt: mbElevation,
  headingAt: mbHeading,
  scenery: {
    wildHeight: (x, z) => -18 + fbm(x / 1100, z / 1100, 3) * 30 + Math.max(0, fbm(x / 450 + 3, z / 450, 3)) * 18,
    bumpAmp: 3,
    rockLine: 400,
    snowLine: 1e9,
    treeLine: 400,
    coniferBias: 0.1,
    forestCover: -0.45, // open foothills grassland: lone trees and the odd clump (the forest noise only reaches 0.5 in a few patches)
    trees: { cottonwood: 0.3, pine: 0.35, shrub: 0.35 },
    fields: true,
    mountainScale: 1.7, // the Front Range and the Flatirons to the west
  },
  landmarks: [
    startArch, finishArch(MB_LAP), finishArch(MB_FINISH), finishArch(MB_SPRINT), finishArch(MB_LAP + MB_SPRINT), ...lapFarm,
    // The Flatirons, 2.5 km west of Highway 93 (the west side of the circuit: the left-hand side riding north), once a lap.
    // Visible from 7 km away along the road, hazy rather than fogged out (monuments.ts).
    { ...monumentAt('flatirons', MB_SPRINT, -1, 2500, 500, { clearance: 1 }), every: MB_LAP, reach: 7000 },
  ],
  signs: [],
  baseAltitude: 1680, // Superior, Colorado: about 5,500 ft
  tourStage: 1,
  race: {
    sprints: [
      { d: MB_SPRINT, name: 'Highway 93 sprint' },
      { d: MB_LAP + MB_SPRINT, name: 'Highway 93 sprint' },
    ],
    summits: [
      { d: MB_LAP, name: 'The Wall', cat: 3 },
      { d: MB_FINISH, name: 'The Wall', cat: 2 },
    ],
  },
};

// ---- Stage 2: the Tour of the Moon ----
//
// Rim Rock Drive through Colorado National Monument, the stage the Coors
// Classic called the Tour of the Moon (1980–88, mtntownmagazine.com
// "Classic Rides: the Colorado National Monument's Tour of the Moon"). The
// road is 23 miles (37 km) from the Grand Junction entrance to the Fruita
// entrance, tops out at 6,640 ft (2,024 m), and has about 2,300 ft (700 m) of
// climbing in all, most of it on the steep grades just inside either entrance
// (nps.gov "Road Biking on Rim Rock Drive"). From the Grand Junction side the
// road switchbacks up about four miles, through a dark tunnel, to the
// plateau at Cold Shivers; five or six more miles of rolling uphill reach the
// high point, then a descent with one more rise at Black Ridge, the visitor
// center, and a rapid drop through two short tunnels to Fruita
// (mtntownmagazine.com). The road line and profile are the real ones
// (OpenStreetMap and SRTM, baked into routes/real/hotw-tour-of-the-moon.ts),
// scaled so the high point is the published 2,024 m.
const TM_FINISH = 37000;
const TM_START_ALTITUDE = 1460; // where the baked road starts, on Monument Road just below the park entrance
const tm = mapRoute(moonRoute, TM_FINISH);
const tmElevation = elevationFrom(tm, TM_FINISH, { peak: 2024 - TM_START_ALTITUDE, maxGrade: 0.1 });
const tmHeading = tm.headingAt;
// Fit a plane to the road, as the climbs do, so the land follows the road's overall rise.
const TM_VISITOR_CENTER = 29080;
const tmPlane = landPlane(tmHeading, tmElevation, TM_FINISH);
/** Flat shelves joined by cliffs: the stepped mesas and layered sandstone of the Colorado Plateau. */
const terrace = (v: number, step: number) => {
  const f = v / step;
  const i = Math.floor(f);
  return (i + smoothstep(0.55, 1, f - i)) * step;
};

const tourOfTheMoon: Stage = {
  id: 'hotw-tour-of-the-moon',
  name: 'Hell of the West · Stage 2: Tour of the Moon',
  tagline: 'Rim Rock Drive through Colorado National Monument: 37 km of switchbacks, tunnels and red rock canyons, topping out at 2,024 m.',
  finish: TM_FINISH,
  elevationAt: tmElevation,
  headingAt: tmHeading,
  scenery: {
    wildHeight: (x, z) => {
      const base = Math.max(-60, Math.min(700, tmPlane(x, z)));
      const mesa = fbm(x / 1500 + 4, z / 1500, 3) * 120;
      const ridge = (1 - Math.abs(fbm(x / 420 + 7, z / 420 - 3, 3))) * 170;
      return terrace(base + 10 + mesa * 0.6 + ridge * 0.55, 26);
    },
    bumpAmp: 5,
    rockLine: 1e9,
    snowLine: 1e9,
    treeLine: 1e9,
    coniferBias: 1,
    forestCover: -0.3,
    trees: { juniper: 0.75, shrub: 0.25 },
    fields: false,
    mountainScale: 1.3, // the Book Cliffs
    palette: 'desert',
    road: 'park',
    barrier: 'stone',
    roadside: makeRoadside(RIM_ROCK_SECTIONS), // the rims of Monument Canyon and its neighbours
    clearAir: 3.2, // dry plateau air: the canyon floors and the monoliths stay readable
    directHaze: true, // and the same on Medium and up as on Low
    skyLight: 0.3, // High and Ultra's sky ambient would pale the red rock
  },
  landmarks: [startArch, finishArch(TM_FINISH), finishArch(TM_VISITOR_CENTER)],
  signs: [],
  baseAltitude: TM_START_ALTITUDE, // just below the Grand Junction entrance (4,700 ft)
  tourStage: 2,
  race: {
    // Places on the real road: Cold Shivers Point, the high point (2,024 m), the rise at Black Ridge and the Saddlehorn visitor center.
    sprints: [{ d: TM_VISITOR_CENTER, name: 'Visitor center sprint' }],
    summits: [
      { d: 6950, name: 'Cold Shivers', cat: 1 },
      { d: 13000, name: 'The high point', cat: 2 },
      { d: 20000, name: 'Black Ridge', cat: 4 },
    ],
  },
};

// --------------------------------------- real-road circuits and the coast ----
//
// Three race circuits and a coast road, on their real roads (OpenStreetMap, SRTM: routes/real/*.ts, baked by
// scripts/bake-routes.mjs) with the real elevation as it is baked, not rescaled to a published gain. A circuit's
// baked loop closes exactly (heading included), is mapped onto the published lap length, and its elevation is
// periodic (`d mod lap`), so lap 2 lies on lap 1; each lap adds the loop's own whole turn to the heading
// (Morgul-Bismark's way, see `MB_TURN`). The scenery that needs the road's shape (a skyline round a park, the sea
// beside a cliff road) is worked out from the stage's own heading, so it follows the stage's scale.

interface CircuitGeometry {
  lap: number;
  laps: number;
  finish: number;
  headingAt(d: number): number;
  elevationAt(d: number): number;
  /** Real metres per stage metre. */
  scale: number;
  /** The mean elevation round one lap, m above the start. */
  mean: number;
}

function circuitGeometry(route: RealRouteData, lap: number, laps: number, maxGrade: number): CircuitGeometry {
  const geo = mapRoute(route, lap);
  let high = 0;
  for (const v of geo.rise) if (v > high) high = v;
  const rise = elevationFrom(geo, lap, { peak: high, maxGrade });
  // The baked road ends a metre or two off the altitude it started at: spread that over the lap, so the lap is periodic.
  const closing = rise(lap);
  const lapElevation = (u: number) => rise(u) - (closing * u) / lap;
  // The loop turns a whole number of times, once, either way; each lap adds that again.
  const turn = geo.headingAt(lap) - geo.headingAt(0);
  let mean = 0;
  let n = 0;
  for (let u = 0; u < lap; u += 10) { mean += lapElevation(u); n++; }
  return {
    lap, laps, finish: lap * laps, scale: geo.scale, mean: mean / n,
    headingAt: (d) => (d <= 0 ? geo.headingAt(0) : geo.headingAt(d - Math.floor(d / lap) * lap) + Math.floor(d / lap) * turn),
    elevationAt: (d) => lapElevation(((d % lap) + lap) % lap),
  };
}

/** The road's (x, z) every `step` metres from the course start (x east, z south), by integrating its heading. */
function roadTrace(headingAt: (d: number) => number, length: number, step = 20): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  let x = 0, z = 0;
  for (let d = 0; d < length; d += step) {
    const h = headingAt(d + step / 2);
    x += Math.cos(h) * step;
    z += Math.sin(h) * step;
    out.push([x, z]);
  }
  return out;
}

/** The course distance and lateral offset (+ right, as terrain.ts measures it) of the nearest road point to (x, z): for ground beyond `Scenery.roadside`'s reach. */
function roadLocator(trace: readonly [number, number][], step: number) {
  const CELL = 300;
  const grid = new Map<string, number[]>();
  trace.forEach(([x, z], i) => {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    const cell = grid.get(key);
    if (cell) cell.push(i); else grid.set(key, [i]);
  });
  return (x: number, z: number): { d: number; lateral: number } => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = -1, bestD2 = Infinity;
    for (let ring = 0; ring < 14 && best < 0; ring++) {
      for (let i = cx - ring; i <= cx + ring; i++) {
        for (let j = cz - ring; j <= cz + ring; j++) {
          if (ring && Math.abs(i - cx) < ring && Math.abs(j - cz) < ring) continue;
          for (const k of grid.get(`${i},${j}`) ?? []) {
            const d2 = (trace[k][0] - x) ** 2 + (trace[k][1] - z) ** 2;
            if (d2 < bestD2) { bestD2 = d2; best = k; }
          }
        }
      }
    }
    if (best < 0) return { d: 0, lateral: 0 };
    const a = trace[Math.max(0, best - 1)], b = trace[Math.min(trace.length - 1, best + 1)];
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const len = Math.hypot(vx, vz) || 1;
    return { d: best * step, lateral: ((trace[best][0] - x) * vz - (trace[best][1] - z) * vx) / len };
  };
}

/** Spreads landmark kinds over every lap of a circuit: `first` and `until` are course distances within the lap. */
const perLap = (kinds: LandmarkKind[], lap: number, laps: number): LandmarkKind[] =>
  kinds.flatMap((k) => Array.from({ length: laps }, (_, i) => ({ ...k, first: k.first + i * lap, until: (k.until ?? lap) + i * lap })));

/** A street of terraced houses along one side of the road from lap metre `from` to `to`: `seeds` alternate along it, so it is not one house repeated. */
function terraceRow(from: number, to: number, side: -1 | 1, material: 'brick' | 'stone', seeds: number[], spacing = 44): LandmarkKind[] {
  return seeds.map((seed, i) => ({
    ...monumentAt('terrace', from + i * spacing, side, 17, TERRACE_HEIGHT, { options: { seed, material }, clearance: 16 }),
    every: spacing * seeds.length,
    until: to,
  }));
}
/** A terrace's height as built (monumentCity.ts), so it is not stretched: about 14 m, chimneys included. */
const TERRACE_HEIGHT = 14;

/** Named places (announced as "next: ...", not drawn), for a circuit's every lap. */
const namedPlaces = (places: [number, string][], lap: number, laps: number): StageSign[] =>
  Array.from({ length: laps }, (_, i) => places.map(([d, name]) => ({ d: d + i * lap, label: '', name, style: 'hairpin' as const, numbered: false }))).flat();

// ---- Richmond: the 2015 Worlds road-race circuit ----
//
// The UCI Road World Championships road-race circuit, Richmond, Virginia (2015; the elite men rode it 16 times):
// 16.2 km from the Greater Richmond Convention Center on Broad Street west to Monument Avenue and round the Jefferson Davis
// monument, back through Virginia Commonwealth University and Shockoe Slip, east along the canal to Great Shiplock Park and up
// the cobbled Libby Hill from Rocketts Landing (a 250 m climb up Church Hill, the view that gave the city its name), a quick
// descent and the 110 m climb of 23rd Street (cobbles, up to 20%), down through Shockoe Bottom and up the 300 m of Governor
// Street beside the Capitol, then the 680 m of Broad Street to the line (richmond2015.com course notes quoted by
// cyclingmagazine.ca 2015-09-25 and capovelo.com 2014-02-25; WWBT NBC12's race guide 2015-09-24). The road is the real one,
// baked to 15.0 km and stretched to the published lap; its elevation is SRTM's, which smooths the cobbled ramps (the real
// 23rd Street is steeper than the 7% the 100 m grid shows). The stage is two laps.
/** The Capitol's height as built (monumentCity.ts), metres. */
const CAPITOL_HEIGHT = 34.4;
const RW_LAP = 16200;
const RW_LAPS = 2;
const rw = circuitGeometry(richmondRoute, RW_LAP, RW_LAPS, 0.2);
const RW_START: LonLat = [-77.43638, 37.54238]; // the baked road's first point: the finish line
const RW_ALTITUDE = 64; // m above sea level at the line
const RW_GROUND = rw.mean + 4; // the wild ground: the plateau the city stands on, a little above the road's mean
/** A real place in the stage's frame: metres east and south of the line, stretched like the road. */
const rwAt = (p: LonLat): [number, number] => { const e = eastSouth(RW_START, p); return [e.x / rw.scale, e.z / rw.scale]; };
// The James River below the canal, Libby Hill and Great Shiplock Park: its middle, from OpenStreetMap, west to east.
const RW_WATER: WaterBody[] = [{
  kind: 'river', width: 230, level: -RW_ALTITUDE + 1.5,
  pts: ([[-77.4600, 37.5310], [-77.4500, 37.5300], [-77.4420, 37.5268], [-77.4337, 37.5253], [-77.4280, 37.5236], [-77.4235, 37.5215], [-77.4180, 37.5196], [-77.4120, 37.5170], [-77.4040, 37.5140]] as LonLat[]).map(rwAt),
}];
const RW_HILLS = (x: number, z: number) => RW_GROUND + fbm(x / 600 + 11, z / 600, 3) * 10 + fbm(x / 160, z / 160, 2) * 2.5;
// KOMs and places, in lap metres (the baked profile's tops: Libby Hill 12,240; 23rd Street 13,440).
const RW_LIBBY = 12240;
const RW_23RD = 13440;
const RW_PLACES: [number, string][] = [[3400, 'Monument Avenue'], [8100, 'Shockoe Slip'], [10300, 'Great Shiplock Park'], [11000, 'Libby Hill'], [12950, '23rd Street'], [14100, 'Governor Street']];

const richmondWorlds: Stage = {
  id: 'richmond-worlds',
  name: 'Richmond Worlds Circuit',
  tagline: 'Two laps of the 2015 World Championships circuit: Monument Avenue, the cobbles of Libby Hill and 23rd Street, and the drag up Governor Street to the Capitol.',
  finish: rw.finish,
  lapLength: rw.lap,
  elevationAt: rw.elevationAt,
  headingAt: rw.headingAt,
  baseAltitude: RW_ALTITUDE,
  climb: false,
  weather: 'clear',
  scenery: {
    wildHeight: (x, z) => sinkInto(RW_WATER, x, z, RW_HILLS(x, z), 22, 140),
    bumpAmp: 2,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 900,
    coniferBias: 0.15,
    forestCover: 0.12,
    trees: { oak: 0.35, beech: 0.2, cottonwood: 0.2, pine: 0.1, shrub: 0.15 },
    fields: false,
    mountainScale: 0.6,
    road: 'us-highway',
    water: RW_WATER,
    clearing: (d) => { const u = d % rw.lap; return u > rw.lap - 520 && u < rw.lap - 120; }, // Capitol Square
  },
  landmarks: [
    startArch, finishArch(rw.lap), finishArch(rw.finish),
    ...perLap([
      // The Capitol, on the left of Broad Street just before the line (the real one stands a few blocks east, by Governor Street).
      monumentAt('virginia-capitol', rw.lap - 330, -1, 78, CAPITOL_HEIGHT, { yaw: 0, clearance: 50 }),
      // Church Hill's brick rowhouses and the streets round Monument Avenue and VCU, where the road has no other leg within a block.
      ...[[400, 3000], [4700, 6500], [11800, 12800], [14700, 15500]].flatMap(([a, b]) => [...terraceRow(a, b, -1, 'brick', [1, 2, 3]), ...terraceRow(a + 20, b, 1, 'brick', [4, 5, 6])]),
      ...terraceRow(15500, 16100, 1, 'brick', [7, 8]),
    ], rw.lap, rw.laps),
  ],
  signs: namedPlaces(RW_PLACES, rw.lap, rw.laps),
  crowdSpots: [RW_LIBBY - 150, RW_23RD - 90, 14600].flatMap((d) => [d, d + rw.lap]),
  race: {
    sprints: [{ d: rw.lap, name: 'Broad Street sprint' }],
    summits: [RW_LIBBY, RW_23RD, rw.lap + RW_LIBBY, rw.lap + RW_23RD].map((d, i) => ({ d, name: i % 2 ? '23rd Street' : 'Libby Hill', cat: 3 as const })),
  },
};

// ---- Central Park: the Park Drive loop ----
//
// Park Drive, Central Park, New York: the 6.1-mile loop of East, Center and West Drives (nycgovparks.org; the drives are
// closed to cars, which is why OpenStreetMap maps them as pedestrian ways and the baked route needed waypoints on them),
// ridden counter-clockwise, the way the cyclists go: north up the east side past the Met and the Reservoir, with Cat Hill on
// East Drive, round Harlem Meer, up Harlem Hill (about 28 m in 700 m, the park's steepest) and south down West Drive.
// The road is the real one (baked to 10.3 km, scaled to 9.8 km: 6.1 miles); three laps. The towers round the park are
// procedural (world/skyline.ts): a band outside the drive, taller to the south.
const CP_LAP = 9800;
const CP_LAPS = 3;
const cp = circuitGeometry(centralParkRoute, CP_LAP, CP_LAPS, 0.2);
const CP_START: LonLat = [-73.97293, 40.76885];
const CP_ALTITUDE = 28;
const cpAt = (p: LonLat): { x: number; z: number } => { const e = eastSouth(CP_START, p); return { x: e.x / cp.scale, z: e.z / cp.scale }; };
const CP_LOOP = roadTrace(cp.headingAt, CP_LAP, 20);
const CP_TOWERS = skylineTowers(CP_LOOP);
const CP_GROUND = cp.mean; // the park's own ground, in the road's datum
// The Reservoir (the Jacqueline Kennedy Onassis Reservoir, 106 acres), inside the loop between 86th and 96th Streets, its long side along the avenues.
const CP_RESERVOIR_AT = cpAt([-73.9626, 40.78545]);
const CP_WATER: WaterBody[] = [{ kind: 'pond', ...CP_RESERVOIR_AT, rx: 230, rz: 400, rot: -0.507, level: CP_GROUND + 4 }];
const CP_KOM_CAT = 1520; // the top of Cat Hill on East Drive
const CP_KOM_HARLEM = 4760; // the top of Harlem Hill
const CP_PLACES: [number, string][] = [[700, 'Cat Hill'], [2200, 'The Reservoir'], [3900, 'Harlem Meer'], [4000, 'Harlem Hill'], [7300, 'West Drive']];

const centralPark: Stage = {
  id: 'central-park',
  name: 'Central Park Loop',
  tagline: 'Three counter-clockwise laps of Park Drive: Cat Hill, the Reservoir, Harlem Hill, with Manhattan standing round the park.',
  finish: cp.finish,
  lapLength: cp.lap,
  elevationAt: cp.elevationAt,
  headingAt: cp.headingAt,
  baseAltitude: CP_ALTITUDE,
  climb: false,
  scenery: {
    wildHeight: (x, z) => sinkInto(CP_WATER, x, z, CP_GROUND + fbm(x / 420 + 5, z / 420, 3) * 5 + fbm(x / 110, z / 110, 2), 6, 60),
    bumpAmp: 1.6,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 900,
    coniferBias: 0.2,
    forestCover: 0.25,
    trees: { oak: 0.35, beech: 0.2, cottonwood: 0.2, pine: 0.1, aspen: 0.05, shrub: 0.1 },
    fields: false,
    mountainScale: 0.4,
    road: 'lane',
    water: CP_WATER,
  },
  landmarks: [
    startArch, finishArch(cp.lap), finishArch(2 * cp.lap), finishArch(cp.finish),
    // Manhattan, round the whole loop: one landmark at the world's origin, in range the whole stage (the tower positions are in the course frame).
    monumentInWorld('manhattan-skyline', { x: 0, z: 0, y: CP_GROUND - 3, yaw: 0 }, skylineHeight(CP_TOWERS), { options: { loop: CP_LOOP } }),
  ],
  signs: namedPlaces(CP_PLACES, cp.lap, cp.laps),
  crowdSpots: [CP_KOM_CAT - 120, CP_KOM_HARLEM - 120].flatMap((d) => Array.from({ length: cp.laps }, (_, i) => d + i * cp.lap)),
  race: {
    sprints: [{ d: cp.lap, name: 'Park Drive sprint' }, { d: 2 * cp.lap, name: 'Park Drive sprint' }],
    summits: Array.from({ length: cp.laps }, (_, i) => [
      { d: i * cp.lap + CP_KOM_CAT, name: 'Cat Hill', cat: 4 as const },
      { d: i * cp.lap + CP_KOM_HARLEM, name: 'Harlem Hill', cat: 3 as const },
    ]).flat(),
  },
};

// ---- Harrogate: the 2019 Worlds finishing circuit ----
//
// The finishing circuit of the 2019 UCI Road World Championships, Harrogate, North Yorkshire: 13.9 km (Strava's "Harrogate
// Worlds Lap", VeloViewer; 14 km in the UCI's words), ridden in the race direction from the line on Parliament Street, south
// down West Park beside The Stray, then right on to Otley Road, the long straight out of town (Zwift Insider's notes for the
// route), north through the farmland of the Oak Beck valley to Penny Pot Lane, the sharp descent to the stone bridge over the beck
// and the climb out of the valley (the Yorkshire KOM), east along Cornwall Road in the Duchy Estate and the Royal Pump Room, and
// up the drag of Parliament Street past Betty's to the line, where Cavendish crashed in 2014. The sources do not name every
// road, so the loop between Otley Road and Cornwall Road is reconstructed; the baked road is 12.1 km and the game stretches it to
// the published lap. Two laps.
const HW_LAP = 13900;
const HW_LAPS = 2;
const hw = circuitGeometry(harrogateRoute, HW_LAP, HW_LAPS, 0.2);
const HW_ALTITUDE = 120;
const HW_KOM = 10600; // the top of the Oak Beck climb
const HW_PLACES: [number, string][] = [[1500, 'Otley Road'], [9650, 'Oak Beck'], [10900, 'Cornwall Road'], [12500, 'Royal Pump Room'], [13300, 'Parliament Street']];
/** The open country between Otley Road's last houses and the Duchy Estate: dry-stone walls line the lane. */
const hwRural = (d: number) => { const u = d % hw.lap; return u > 1900 && u < 10250; };
/** The Stray, the open common beside West Park at the line, where no trees grow. */
const hwStray = (d: number) => { const u = d % hw.lap; return u < 900 || u > hw.lap - 500; };

const harrogateWorlds: Stage = {
  id: 'harrogate-worlds',
  name: 'Harrogate Worlds Circuit',
  tagline: 'Two laps of the 2019 World Championships finishing circuit: Otley Road, the Oak Beck valley between its dry-stone walls, and the drag up Parliament Street.',
  finish: hw.finish,
  lapLength: hw.lap,
  elevationAt: hw.elevationAt,
  headingAt: hw.headingAt,
  baseAltitude: HW_ALTITUDE,
  climb: false,
  culture: 'gb',
  weather: 'cloudy',
  scenery: {
    wildHeight: (x, z) => hw.mean + 8 + fbm(x / 800 + 21, z / 800, 4) * 40 + fbm(x / 240, z / 240, 3) * 7,
    bumpAmp: 3,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 900,
    coniferBias: 0.1,
    forestCover: -0.1, // fields and hedgerows: a tree here, a copse there
    trees: { oak: 0.4, beech: 0.3, pine: 0.05, shrub: 0.25 },
    fields: false,
    mountainScale: 1.4, // the Pennines
    road: 'alpine', // white dashed centre, thin edge lines
    barrier: 'stone',
    walls: hwRural,
    clearing: hwStray,
  },
  landmarks: [
    startArch, finishArch(hw.lap), finishArch(hw.finish),
    // Stone terraces in the town stretches: West Park, the Duchy Estate's Cornwall Road and the finish straight.
    ...perLap([
      ...terraceRow(150, 800, 1, 'stone', [1, 2, 3]),
      ...terraceRow(10500, 13500, 1, 'stone', [4, 5, 6]),
      ...terraceRow(11700, 13500, -1, 'stone', [7, 8, 9]),
    ], hw.lap, hw.laps),
  ],
  signs: namedPlaces(HW_PLACES, hw.lap, hw.laps),
  crowdSpots: Array.from({ length: hw.laps }, (_, i) => i * hw.lap + HW_KOM - 80),
  race: {
    sprints: [{ d: hw.lap, name: 'Parliament Street sprint' }],
    summits: Array.from({ length: hw.laps }, (_, i) => ({ d: i * hw.lap + HW_KOM, name: 'Oak Beck climb', cat: 4 as const })),
  },
};

// ---- Pacific Coast Highway through Big Sur ----
//
// California Highway 1 southbound from the Carmel River past Carmel Highlands and Garrapata, over Bixby Creek Bridge, up Hurricane
// Point and past Point Sur to Big Sur village: 39 km, the ocean on the right all the way. The road and its profile are the real
// ones (OpenStreetMap, SRTM; baked with the car profile, which stays on the highway where the bicycle profile prefers the Old
// Coast Road over the hills). Bixby Creek Bridge (1932, 218 m of concrete open-spandrel arch, 79 m above the creek: nps.gov, the
// Monterey County site) is at 21.9 km; Hurricane Point (the highway climbs to about 180 m) peaks at 23.5 km; the Point Sur
// lighthouse stands on its rock 1.4 km offshore at 29.8 km. The ground falls away to the Pacific on the right (the `roadside`
// hook shapes the cliff, sea level is a plane) and climbs in golden hills on the left.
const PC_LENGTH = 39100;
const pcGeo = mapRoute(pacificRoute, PC_LENGTH);
const PC_ALTITUDE = 6; // m above sea level at the start (the Carmel River bridge)
const PC_FLOOR = -1.5; // the lowest the road runs, in the datum: the baked profile dips to the sea's level at the river mouth, the highway does not
const pcElevation = (() => {
  let high = 0;
  for (const v of pcGeo.rise) if (v > high) high = v;
  const f = elevationFrom(pcGeo, PC_LENGTH, { peak: high, maxGrade: 0.12 });
  return (d: number) => Math.max(PC_FLOOR, f(d));
})();
const PC_BIXBY = 21850;
const PC_HURRICANE = 23470;
const PC_TRACE = roadTrace(pcGeo.headingAt, PC_LENGTH, 20);
const pcLocate = roadLocator(PC_TRACE, 20);
const PC_LIP = 6.5;
const PC_SEA = -PC_ALTITUDE; // sea level in the road's datum
/** 1 where the ocean is beside the road (on the right), fading in after the river and out at the Big Sur valley. */
const pcSea = (d: number) => smoothstep(2800, 3700, d) * (1 - smoothstep(33200, 35500, d));
/** Ground height relative to the road, `lateral` m to its right. */
function pcRel(d: number, lateral: number): number {
  const dd = Math.max(0, Math.min(PC_LENGTH, d));
  const road = pcElevation(dd);
  const above = Math.max(3, PC_ALTITUDE + road); // m above the sea
  const s = Math.abs(lateral);
  // Bixby Creek's gorge cuts across the road at the bridge; its floor stays above the sea.
  const gorge = -Math.max(0, Math.min(78, above - 6)) * (1 - smoothstep(24, 100, Math.abs(dd - PC_BIXBY))) * (1 - smoothstep(520, 880, s));
  if (s <= PC_LIP) return gorge;
  const out = s - PC_LIP;
  // Inland (and where the sea is not near): golden hills that rise from the verge.
  const hills = 200 * (1 - Math.exp(-out / 170)) + fbm(dd / 700 + 3, s / 350, 3) * 55 * smoothstep(30, 300, s);
  let rel = hills;
  if (lateral > 0) {
    const w = pcSea(dd);
    if (w > 0) {
      // The cliff: steep at the lip and easing into the surf, down to a little below the sea.
      const run = Math.max(28, above * 1.5);
      const t = Math.min(1, out / run);
      const cliff = -(above + 8) * (1 - Math.pow(1 - t, 1.7)) + fbm(dd / 80, s / 40, 2) * 2.2 * Math.sin(Math.PI * Math.min(1, t));
      rel = hills * (1 - w) + cliff * w;
    }
  }
  return Math.min(rel, gorge);
}
const PC_PLACES: StageSign[] = ([[4300, 'Carmel Highlands'], [21550, 'Bixby Creek Bridge'], [23300, 'Hurricane Point'], [29500, 'Point Sur'], [35400, 'Andrew Molera']] as [number, string][])
  .map(([d, name]) => ({ d, label: '', name, style: 'hairpin' as const, numbered: false }));

const pacificCoast: Stage = {
  id: 'pacific-coast',
  name: 'Pacific Coast Highway',
  tagline: '39 km of California Highway 1 through Big Sur: the cliffs above the Pacific, Bixby Creek Bridge, Hurricane Point and the road to Big Sur village.',
  finish: PC_LENGTH,
  elevationAt: pcElevation,
  headingAt: pcGeo.headingAt,
  baseAltitude: PC_ALTITUDE,
  climb: false,
  weather: 'cloudy', // the morning marine layer
  scenery: {
    wildHeight: (x, z) => {
      const { d, lateral } = pcLocate(x, z);
      return pcElevation(Math.max(0, Math.min(PC_LENGTH, d))) + pcRel(d, lateral);
    },
    roadside: pcRel,
    bumpAmp: 2.5,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 330,
    dryGrass: 0.7,
    coniferBias: 0.3,
    forestCover: -0.4, // coastal scrub: shrubs, with the odd oak and Monterey pine
    trees: { shrub: 0.55, oak: 0.2, pine: 0.25 },
    fields: false,
    mountainScale: 2.4, // the Santa Lucia range
    road: 'us-highway',
    barrier: 'rail',
    water: [{ kind: 'sea', level: PC_SEA }],
  },
  landmarks: [
    startArch, finishArch(PC_LENGTH),
    // Bixby Creek Bridge carries the road: its deck is the model's top (BIXBY_DECK above its origin), 218 m along the road.
    { model: 'bixby-bridge', first: PC_BIXBY, every: 1e9, side: 0, span: 'along', offset: 0, size: 80, clearance: 40, lift: -79.2 },
  ],
  signs: PC_PLACES,
  race: {
    sprints: [{ d: PC_BIXBY, name: 'Bixby Bridge sprint' }],
    summits: [{ d: PC_HURRICANE, name: 'Hurricane Point', cat: 4 }],
  },
};

export const STAGES: Stage[] = [heartland, route66, morgulBismark, tourOfTheMoon, hellOfTheWest, alpe, stelvio, ventoux, tourmalet, zoncolan, mtWashington, mtBlueSky, mtDiablo, flagstaff, richmondWorlds, centralPark, harrogateWorlds, pacificCoast];

export function stageById(id: string | null): Stage {
  return STAGES.find((s) => s.id === id) ?? heartland;
}
