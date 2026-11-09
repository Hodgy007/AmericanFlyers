// Stage definitions: each stage supplies its own elevation profile, road
// bends, scenery style, roadside landmarks and signs.

import type { MonumentId, MonumentOptions } from './world/monumentTypes';
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
  summit: { d: 12225, side: 1, offset: 32, rise: 3, flat: 60, slope: 0.5, fadeFrom: 380, fadeTo: 1200 },
  landmarks: [
    monumentAt('washington-summit', 12225, 1, 32, 57, { yaw: -0.12, clearance: 40 }), // inside the last bend, just past the finish: the road wraps round it, so it is ahead on the right from 500 m out and again in the last 100 m
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

export const STAGES: Stage[] = [heartland, route66, morgulBismark, tourOfTheMoon, hellOfTheWest, alpe, stelvio, ventoux, tourmalet, zoncolan, mtWashington, mtBlueSky, mtDiablo, flagstaff];

export function stageById(id: string | null): Stage {
  return STAGES.find((s) => s.id === id) ?? heartland;
}
