// Stage definitions: each stage supplies its own elevation profile, road
// bends, scenery style, roadside landmarks and signs.

import { fbm, smoothstep } from './world/noise';

export interface LandmarkKind {
  file: string;
  every: number; // metres between repeats
  first: number; // distance of the first one
  side: -1 | 0 | 1; // -1 left, 1 right, 0 on the road itself
  /** For side 0: 'across' spans the road like an arch; 'along' is ridden through lengthwise (a bridge). */
  span?: 'across' | 'along';
  offset: number; // metres from the road centre
  size: number; // target height in metres; width for side-0 kinds
  yaw?: number; // extra turn in radians after facing the road
  clearance: number; // keep trees this far away
}

export interface Scenery {
  /** Ground height far from the road. */
  wildHeight(x: number, z: number): number;
  bumpAmp: number; // small-scale ground roughness, metres
  rockLine: number; // heights (same datum as the road) where rock, snow and the tree line start
  snowLine: number;
  treeLine: number;
  coniferBias: number; // 0 = mostly broadleaf, 1 = all conifers
  forestCover: number; // 0 = farmland with woods, higher = more forest
  fields: boolean; // patches of farmland
  mountainScale: number; // height of the distant mountain ring
}

export interface StageSign {
  d: number;
  label: string;
  style: 'hairpin';
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
  /** Set for routes the rider uploaded (GPX). */
  uploaded?: boolean;
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
// A climb is built from published figures: per-kilometre gradients, total
// gain, and where its numbered hairpins sit. Hairpins are 180° bends of 12 m
// radius joined by straights that angle up the mountainside; the bends
// themselves are flatter than the straights, so the straights are steepened to
// keep each kilometre's average.

interface ClimbSpec {
  id: string;
  name: string;
  tagline: string;
  kmGrades: number[]; // % per kilometre; the last entry may cover a part-kilometre
  length: number; // metres
  gain: number; // metres
  hairpins: number;
  firstHairpin: number; // metres
  lastHairpin: number; // metres
  /** >1 bunches the hairpins towards the top (shorter straights higher up). */
  bunching: number;
  approachBends: number; // radians of gentle valley bends before the first hairpin
  finalBend: number; // radians of sweeping bend after the last hairpin
  hairpinWord: string;
  baseAltitude: number;
  scenery: Omit<Scenery, 'wildHeight'>;
}

const HAIRPIN_R = 12; // metres, centreline radius
const LEG_ALPHA = 0.12; // straights angle up the mountainside (rad)
const TURN = Math.PI - 2 * LEG_ALPHA;
const ARC = HAIRPIN_R * TURN;
const CLIMB_STEP = 1;

function buildClimb(spec: ClimbSpec): Stage {
  const { length, hairpins } = spec;

  // Hairpin start positions, with uneven straights that shorten towards the top.
  const legs = Array.from({ length: hairpins - 1 }, (_, i) => {
    const jitter = 0.75 + 0.5 * ((((Math.sin((i + 1) * 12.9898) * 43758.5453) % 1) + 1) % 1);
    return jitter * Math.pow(1 - (i / hairpins) * 0.85, spec.bunching);
  });
  const legTotal = spec.lastHairpin - spec.firstHairpin - (hairpins - 1) * ARC;
  const legSum = legs.reduce((a, b) => a + b, 0);
  const pins: number[] = [spec.firstHairpin];
  for (let i = 0; i < hairpins - 1; i++) pins.push(pins[i] + ARC + (legs[i] / legSum) * legTotal);

  /** Zero-ended meander so straights aren't ruler-straight; longer stretches get more waves. */
  const meander = (d: number, a: number, b: number, amp: number) => {
    const waves = Math.max(1, Math.round((b - a) / 1500));
    return amp * Math.sin((2 * Math.PI * waves * (d - a)) / (b - a));
  };

  const headingAt = (d: number): number => {
    if (d <= 0) return LEG_ALPHA;
    if (d < pins[0]) return LEG_ALPHA + meander(d, 0, pins[0], Math.max(0.08, spec.approachBends));
    for (let i = 0; i < hairpins; i++) {
      const start = i % 2 === 0 ? LEG_ALPHA : Math.PI - LEG_ALPHA;
      const turn = i % 2 === 0 ? TURN : -TURN;
      const arcEnd = pins[i] + ARC;
      if (d < arcEnd) return start + turn * ((d - pins[i]) / ARC);
      const next = i + 1 < hairpins ? pins[i + 1] : Infinity;
      if (d < next) {
        const h = start + turn;
        if (next === Infinity) {
          const span = Math.max(1, length - arcEnd);
          return h + spec.finalBend * smoothstep(arcEnd + span * 0.15, arcEnd + span * 0.7, d) + meander(Math.min(d, length), arcEnd, Math.max(length, arcEnd + 1), 0.05);
        }
        return h + meander(d, arcEnd, next, 0.05);
      }
    }
    return LEG_ALPHA;
  };

  // Raw gradient: interpolated between kilometre midpoints, halved in bends.
  const inBend = (d: number) => pins.some((p) => d >= p && d < p + ARC);
  const grades = spec.kmGrades;
  const kmGrade = (d: number) => {
    const f = Math.min(Math.max(d / 1000 - 0.5, 0), grades.length - 1);
    const i = Math.floor(f);
    const t = f - i;
    return (grades[i] + (grades[Math.min(i + 1, grades.length - 1)] - grades[i]) * t) / 100;
  };
  const n = Math.round(length / CLIMB_STEP);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) * CLIMB_STEP;
    raw[i] = kmGrade(d) * (inBend(d) ? 0.5 : 1);
  }
  // Rescale each kilometre to its published average, then the whole climb to the published gain.
  for (let k = 0; k < grades.length; k++) {
    const a = Math.floor((k * 1000) / CLIMB_STEP);
    const b = Math.min(n, Math.floor(((k + 1) * 1000) / CLIMB_STEP));
    if (b <= a) continue;
    let sum = 0;
    for (let i = a; i < b; i++) sum += raw[i];
    const target = (grades[k] / 100) * (b - a);
    for (let i = a; i < b; i++) raw[i] *= target / sum;
  }
  const elev = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) elev[i + 1] = elev[i] + raw[i] * CLIMB_STEP;
  const scale = spec.gain / elev[n];
  for (let i = 0; i <= n; i++) elev[i] *= scale;

  const elevationAt = (d: number): number => {
    if (d <= 0) return 0;
    if (d >= length) return elev[n] + Math.min(d - length, 60) * 0.01; // level run-out at the top
    const f = d / CLIMB_STEP;
    const i = Math.floor(f);
    return elev[i] + (elev[i + 1] - elev[i]) * (f - i);
  };

  // Fit a plane to the road's rise across the mountainside, so the land far
  // from the road climbs with it instead of the road sitting on a pillar.
  let x = 0, z = 0;
  const pts: [number, number, number][] = [];
  for (let d = 0; d < length; d += CLIMB_STEP * 2) {
    const h = headingAt(d + CLIMB_STEP);
    x += Math.cos(h) * CLIMB_STEP * 2;
    z += Math.sin(h) * CLIMB_STEP * 2;
    if (d % 50 === 0) pts.push([x, z, elevationAt(d)]);
  }
  const plane = fitPlane(pts);

  const wildHeight = (wx: number, wz: number) => {
    const base = Math.max(-40, Math.min(spec.gain + 150, plane(wx, wz)));
    const massif = fbm(wx / 1300, wz / 1300, 4) * 260;
    const ridges = (1 - Math.abs(fbm(wx / 420 + 7, wz / 420 - 3, 3))) * 170;
    return base + 60 + massif + ridges;
  };

  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    finish: length,
    elevationAt,
    headingAt,
    scenery: { ...spec.scenery, wildHeight },
    landmarks: [startArch, finishArch(length)],
    signs: pins.map((p, i) => ({ d: p - 12, label: String(hairpins - i), style: 'hairpin' as const })),
    hairpinWord: spec.hairpinWord,
    baseAltitude: spec.baseAltitude,
  };
}

// From Le Bourg-d'Oisans (723 m) to the top (1841 m). Per-kilometre gradients
// from swi-cycling.com; hairpin positions approximated.
const alpe = buildClimb({
  id: 'alpe-dhuez',
  name: "Alpe d'Huez",
  tagline: "14 km at 8% from Le Bourg-d'Oisans, up all 21 hairpins. Real gradients.",
  kmGrades: [9.3, 10.2, 8.6, 8.2, 8.6, 8.0, 8.6, 8.9, 7.3, 8.4, 8.8, 8.7, 5.8, 2.4],
  length: 14000,
  gain: 1118,
  hairpins: 21,
  firstHairpin: 1150,
  lastHairpin: 12100,
  bunching: 0,
  approachBends: 0.08,
  finalBend: 0.6,
  hairpinWord: 'Virage',
  baseAltitude: 723,
  scenery: {
    bumpAmp: 10,
    rockLine: 1250,
    snowLine: 1650,
    treeLine: 760,
    coniferBias: 0.9,
    forestCover: 0.3,
    fields: false,
    mountainScale: 2.6,
  },
});

// From Prato allo Stelvio (~915 m) to the pass (2758 m): 24.5 km, 1843 m,
// 7.5% average, max ~9.5% (mycols.app, climbfinder.com). No per-kilometre
// source was found, so the shape is approximated: an easier valley start past
// Gomagoi and Trafoi, then a steady 8–9% up the 48 numbered hairpins, which
// bunch into the famous wall below the summit.
const stelvio = buildClimb({
  id: 'stelvio',
  name: 'Stelvio Pass',
  tagline: '24.5 km at 7.5% from Prato to 2758 m, through 48 numbered hairpins.',
  kmGrades: [4.5, 5.0, 5.5, 6.0, 6.0, 6.5, 6.5, 7.0, 7.5, 8.0, 8.0, 8.5, 8.5, 8.0, 8.5, 8.5, 9.0, 8.5, 8.5, 8.0, 8.5, 8.5, 8.0, 8.0, 7.5],
  length: 24500,
  gain: 1843, // 915 m + 1843 m = 2758 m at the pass
  hairpins: 48,
  firstHairpin: 8600,
  lastHairpin: 24150,
  bunching: 1.6,
  approachBends: 0.3,
  finalBend: 0.2,
  hairpinWord: 'Tornante',
  baseAltitude: 915,
  scenery: {
    bumpAmp: 12,
    rockLine: 1150,
    snowLine: 1760,
    treeLine: 1050,
    coniferBias: 0.95,
    forestCover: 0.35,
    fields: false,
    mountainScale: 3.4,
  },
});

// "Hell of the West", the final stage in American Flyers (1985): filmed on
// Colorado 103 from Idaho Springs (2,293 m) up Chicago Creek to the sprint at
// Echo Lake (3,235 m), below Mount Evans (fast-rewind.com filming notes).
// 20.8 km, 942 m: about 3.5% for the first 11 km, 5.8% for the next 9, then
// the short flat at the lake (pjammcycling.com, summitbiking.org). The
// switchbacks sit in the steeper upper half.
const hellOfTheWest = buildClimb({
  id: 'hell-of-the-west',
  name: 'Hell of the West',
  tagline: 'The final stage from American Flyers: 20.8 km from Idaho Springs up Chicago Creek to the sprint at Echo Lake, 3,235 m.',
  kmGrades: [3.0, 3.2, 3.6, 3.8, 3.4, 3.0, 3.8, 4.0, 3.6, 3.4, 3.9, 5.2, 5.8, 6.2, 6.0, 5.8, 6.4, 6.0, 5.6, 5.9, 1.2],
  length: 20800,
  gain: 942,
  hairpins: 5,
  firstHairpin: 12400,
  lastHairpin: 18900,
  bunching: 0.5,
  approachBends: 0.45,
  finalBend: 0.5,
  hairpinWord: 'Switchback',
  baseAltitude: 2293,
  scenery: {
    bumpAmp: 12,
    rockLine: 1100,
    snowLine: 1500, // the 4,000 m peaks around Mount Evans keep snow; the road stays below it
    treeLine: 1220, // Colorado's treeline is near 3,500 m, above Echo Lake
    coniferBias: 1,
    forestCover: 0.45,
    fields: false,
    mountainScale: 3.2,
  },
});

// Mont Ventoux from Bédoin (300 m) to the summit (1,910 m): 21.4 km, 1,610 m,
// 7.5%. Gentle vineyards to Saint-Estève, then 9–10% through the forest to
// Chalet Reynard, then the bare white limestone to the top. Per-kilometre
// figures approximated from published profiles (climbbybike.com,
// cyclingcols.com). The white scree is drawn with the snow shading.
const ventoux = buildClimb({
  id: 'ventoux',
  name: 'Mont Ventoux',
  tagline: '21.4 km at 7.5% from Bédoin: the forest at 9–10%, then the bare white moonscape to 1,910 m.',
  kmGrades: [4.3, 4.8, 3.4, 5.2, 4.4, 7.6, 10.7, 9.4, 9.2, 9.4, 9.7, 9.0, 8.4, 8.9, 9.1, 6.4, 7.4, 7.8, 6.5, 8.1, 9.0, 9.0],
  length: 21400,
  gain: 1610,
  hairpins: 3,
  firstHairpin: 5900,
  lastHairpin: 21000,
  bunching: 0,
  approachBends: 0.4,
  finalBend: 0.4,
  hairpinWord: 'Virage',
  baseAltitude: 300,
  scenery: {
    bumpAmp: 9,
    rockLine: 1060,
    snowLine: 1150, // the bald white summit above Chalet Reynard
    treeLine: 1100,
    coniferBias: 0.7,
    forestCover: 0.35,
    fields: false,
    mountainScale: 1.6,
  },
});

// Col du Tourmalet from Luz-Saint-Sauveur (711 m) to the col (2,115 m):
// 19 km, 1,404 m, 7.4%; steadier below Barèges, then 8.5–10% through the
// hairpins of Super-Barèges. Shape approximated from published profiles.
const tourmalet = buildClimb({
  id: 'tourmalet',
  name: 'Col du Tourmalet',
  tagline: '19 km at 7.4% from Luz-Saint-Sauveur, through Barèges and the hairpins to 2,115 m.',
  kmGrades: [5.2, 6.4, 7.0, 7.2, 7.0, 7.4, 6.2, 6.8, 7.2, 7.6, 7.8, 7.0, 8.6, 8.8, 9.2, 8.4, 9.0, 9.6, 9.8],
  length: 19000,
  gain: 1404,
  hairpins: 8,
  firstHairpin: 13300,
  lastHairpin: 18400,
  bunching: 0.6,
  approachBends: 0.35,
  finalBend: 0.3,
  hairpinWord: 'Virage',
  baseAltitude: 711,
  scenery: {
    bumpAmp: 12,
    rockLine: 1150,
    snowLine: 1650,
    treeLine: 900,
    coniferBias: 0.6,
    forestCover: 0.3,
    fields: false,
    mountainScale: 3.0,
  },
});

// Monte Zoncolan from Ovaro (525 m) to the top (1,735 m): 10.1 km, 1,210 m,
// 11.9%, with long stretches at 13–15% and ramps over 20%. Per-kilometre
// figures approximated from published profiles (salite.ch, climbbybike.com).
const zoncolan = buildClimb({
  id: 'zoncolan',
  name: 'Monte Zoncolan',
  tagline: '10.1 km at 11.9% from Ovaro, with ramps over 20%. The hardest climb in Italy.',
  kmGrades: [6.5, 8.8, 12.4, 14.2, 15.0, 14.5, 13.8, 15.4, 13.6, 8.0, 6.0],
  length: 10100,
  gain: 1210,
  hairpins: 9,
  firstHairpin: 4300,
  lastHairpin: 9500,
  bunching: 0.8,
  approachBends: 0.3,
  finalBend: 0.25,
  hairpinWord: 'Tornante',
  baseAltitude: 525,
  scenery: {
    bumpAmp: 11,
    rockLine: 1150,
    snowLine: 1500,
    treeLine: 1000,
    coniferBias: 0.8,
    forestCover: 0.4,
    fields: false,
    mountainScale: 2.8,
  },
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

export const STAGES: Stage[] = [heartland, route66, hellOfTheWest, alpe, stelvio, ventoux, tourmalet, zoncolan];

export function stageById(id: string | null): Stage {
  return STAGES.find((s) => s.id === id) ?? heartland;
}
