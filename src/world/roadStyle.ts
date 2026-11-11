import type { RoadStyle, Stage } from '../stages';
import { hash2 } from './noise';

// What the road is painted like on each stage. One description per style, read by
// the colour map (roadMap.ts draws it) and by the asphalt normal/roughness maps
// (roadSurface.ts keeps the same rectangles flat), so the two can't drift apart.
//
// Everything is in texels of the road texture: 512 across the full 9.2 m width
// (55.7 px per metre), `height` along the road, which covers `repeatM` metres.
// The US styles repeat every road width (512 px = 9.2 m) as they always did. The
// alpine centre line needs a longer repeat: a 3 m dash and a 10.8 m gap are 13.8 m,
// so its texture is 768 px tall (3 × the 256 px asphalt tile, so the photo still
// tiles cleanly). That beats separate dash strips: the dashes stay in the one
// texture, take the wet look and the flat normals like every other mark, and cost
// no extra draw calls or geometry on Low.

export const ROAD_TEX_WIDTH = 512;
export const PX_PER_M = ROAD_TEX_WIDTH / 9.2;

/** A painted rectangle in texels; `color` is a CSS colour with its alpha. */
export interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** A band along each outer edge of the road, from `from` to `to` texels in from the edge. */
export interface EdgeBand {
  from: number;
  to: number;
  color: string;
}

export interface RoadPaintLayout {
  style: RoadStyle;
  height: number; // texels along the road
  repeatM: number; // metres along the road per repeat of the texture
  fallback: string; // flat colour until the asphalt photo loads
  tint: string | null; // laid over the asphalt photo
  /** Repairs and seams under the paint (subtle, so a repeat isn't obvious). */
  surface: Mark[];
  /** Shoulders or a dirty edge. `flat`: gravel or dust, so the normal map leaves it flat. */
  edge: { bands: EdgeBand[]; flat: boolean } | null;
  /** Ragged dark edges of a narrow lane: width in texels is `base ± amp`, from `raggedEdge()`. */
  ragged: { base: number; amp: number; color: string } | null;
  /** The painted lines: kept flat in the normal map. */
  paint: Mark[];
  /** Worn bits of paint, drawn over it in the asphalt colour. */
  wear: Mark[];
}

const W = ROAD_TEX_WIDTH;
const CENTRE = W / 2;

const SQUARE = 512; // texture height of the styles that repeat once per road width

/** Mirrors a mark about the middle of the road. */
const mirror = (m: Mark): Mark => ({ ...m, x: W - m.x - m.w });

function usHighway(): RoadPaintLayout {
  const edge = (x: number): Mark => ({ x, y: 0, w: 9, h: SQUARE, color: 'rgba(238, 240, 242, 0.9)' });
  const centre = (x: number): Mark => ({ x, y: 0, w: 7, h: 200, color: 'rgba(242, 193, 78, 0.9)' });
  return {
    style: 'us-highway',
    height: SQUARE,
    repeatM: 9.2,
    fallback: '#3d4048',
    tint: null,
    surface: [],
    edge: { bands: [{ from: 0, to: 44, color: 'rgba(125, 116, 98, 0.85)' }], flat: true },
    ragged: null,
    paint: [edge(58), edge(445), centre(247), centre(258)],
    wear: [],
  };
}

/** Repair patches and tar seams, placed by a hash so they're the same every ride and don't line up from one repeat to the next. */
function asphaltRepairs(height: number, salt: number): Mark[] {
  const out: Mark[] = [];
  const rnd = (i: number, j: number) => hash2(i * 31 + salt, j);
  // Patches of newer or older asphalt: a darker one is fresh tar, a lighter one a worn skim.
  for (let i = 0; i < 6; i++) {
    const w = Math.round(60 + rnd(i, 1) * 110);
    const h = Math.round(80 + rnd(i, 2) * 150);
    out.push({
      x: Math.round(70 + rnd(i, 3) * (W - 140 - w)),
      y: Math.round(rnd(i, 4) * (height - h)),
      w,
      h,
      color: rnd(i, 5) < 0.6 ? 'rgba(10, 12, 16, 0.2)' : 'rgba(140, 144, 150, 0.1)',
    });
  }
  // Transverse tar seams (a thin dark line across part of the road) and a couple of long ones.
  for (let i = 0; i < 5; i++) {
    const x = Math.round(60 + rnd(i, 6) * 120);
    out.push({ x, y: Math.round(rnd(i, 7) * (height - 3)), w: Math.round(160 + rnd(i, 8) * (W - 120 - x - 160)), h: 2, color: 'rgba(8, 9, 12, 0.38)' });
  }
  for (let i = 0; i < 2; i++) {
    const h = Math.round(240 + rnd(i, 9) * 200);
    out.push({ x: Math.round(100 + rnd(i, 10) * 300), y: Math.round(rnd(i, 11) * (height - h)), w: 2, h, color: 'rgba(8, 9, 12, 0.3)' });
  }
  return out;
}

function alpine(): RoadPaintLayout {
  const height = 768;
  const line = (x: number): Mark => ({ x, y: 0, w: 6, h: height, color: 'rgba(236, 238, 240, 0.86)' });
  const paint: Mark[] = [
    line(34),
    mirror(line(34)),
    { x: CENTRE - 3, y: 0, w: 7, h: Math.round(3 * PX_PER_M), color: 'rgba(240, 242, 244, 0.92)' }, // one 3 m dash, then 10.8 m of gap
  ];
  // The edge lines are worn in places: specks of asphalt over them.
  const wear: Mark[] = [];
  for (let i = 0; i < 26; i++) {
    const left = i % 2 === 0;
    const h = 6 + Math.round(hash2(i, 78) * 30);
    const m: Mark = { x: 34, y: Math.round(hash2(i, 77) * (height - h)), w: 6, h, color: 'rgba(44, 46, 52, 0.6)' };
    wear.push(left ? m : mirror(m));
  }
  return {
    style: 'alpine',
    height,
    repeatM: height / PX_PER_M,
    fallback: '#34373e',
    tint: 'rgba(12, 14, 20, 0.2)',
    surface: asphaltRepairs(height, 5),
    edge: { bands: [{ from: 0, to: 22, color: 'rgba(20, 20, 22, 0.5)' }, { from: 22, to: 31, color: 'rgba(20, 20, 22, 0.2)' }], flat: false },
    ragged: null,
    paint,
    wear,
  };
}

function lane(): RoadPaintLayout {
  return {
    style: 'lane',
    height: SQUARE,
    repeatM: 9.2,
    fallback: '#383b40',
    tint: 'rgba(14, 16, 18, 0.18)',
    surface: [],
    edge: null,
    ragged: { base: 52, amp: 30, color: 'rgba(30, 33, 28, 0.82)' },
    paint: [],
    wear: [],
  };
}

function park(): RoadPaintLayout {
  const centre = (x: number): Mark => ({ x, y: 0, w: 7, h: SQUARE, color: 'rgba(232, 184, 60, 0.92)' });
  return {
    style: 'park',
    height: SQUARE,
    repeatM: 9.2,
    fallback: '#4a4240',
    tint: 'rgba(150, 70, 44, 0.2)',
    surface: [],
    edge: { bands: [{ from: 0, to: 26, color: 'rgba(158, 92, 64, 0.88)' }, { from: 26, to: 36, color: 'rgba(158, 92, 64, 0.35)' }], flat: true },
    ragged: null,
    paint: [centre(247), centre(258)],
    wear: [],
  };
}

/** A city park's drive (Central Park): a granite kerb each side, white edge lines, and white lines splitting it into its walking, cycling and service lanes. */
function cityPark(): RoadPaintLayout {
  const line = (x: number, w = 6): Mark => ({ x, y: 0, w, h: SQUARE, color: 'rgba(234, 236, 238, 0.88)' });
  // The cycling lane's line is dashed: 3 m on, 6.2 m off (one per repeat).
  const dash: Mark = { x: 338, y: 0, w: 6, h: Math.round(3 * PX_PER_M), color: 'rgba(234, 236, 238, 0.88)' };
  const wear: Mark[] = [];
  for (let i = 0; i < 18; i++) {
    const h = Math.round(5 + hash2(i, 81) * 14);
    const m: Mark = { x: 30, y: Math.round(hash2(i, 82) * (SQUARE - h)), w: 6, h, color: 'rgba(52, 54, 58, 0.6)' };
    wear.push(i % 2 === 0 ? m : mirror(m));
  }
  return {
    style: 'city-park',
    height: SQUARE,
    repeatM: 9.2,
    fallback: '#3b3d42',
    tint: 'rgba(14, 16, 20, 0.14)',
    surface: asphaltRepairs(SQUARE, 9),
    edge: { bands: [{ from: 0, to: 16, color: 'rgba(168, 166, 160, 0.95)' }, { from: 16, to: 20, color: 'rgba(40, 40, 42, 0.6)' }], flat: true },
    ragged: null,
    paint: [line(30), mirror(line(30)), line(168), dash],
    wear,
  };
}

const LAYOUTS: Record<RoadStyle, () => RoadPaintLayout> = { 'us-highway': usHighway, alpine, lane, park, 'city-park': cityPark };
const cache = new Map<RoadStyle, RoadPaintLayout>();

/** The paint layout of a road style (cached: it never changes). */
export function roadPaintLayout(style: RoadStyle): RoadPaintLayout {
  let l = cache.get(style);
  if (!l) cache.set(style, (l = LAYOUTS[style]()));
  return l;
}

/** The style a stage's road has. */
export function roadStyleOf(stage: Pick<Stage, 'scenery'>): RoadStyle {
  return stage.scenery.road ?? 'us-highway';
}

// ---------------------------------------------------------- ragged lane ----

export const RAGGED_ROW = 4; // texels per row of a ragged edge
const RAGGED_CELL = 16; // texels between the noise's lattice points

/** Width in texels of a lane's dark edge at each `RAGGED_ROW` of the texture. Periodic (both octaves wrap at the texture's end), so it tiles along the road; `side` (0 left, 1 right) picks another pattern. */
export function raggedEdge(layout: RoadPaintLayout, side: 0 | 1): number[] {
  if (!layout.ragged) return [];
  const { base, amp } = layout.ragged;
  const cells = layout.height / RAGGED_CELL;
  const noise = (t: number, period: number, octave: number) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    const at = (k: number) => hash2((((k % period) + period) % period) + octave * 1000, side * 17 + 3);
    return at(i) * (1 - u) + at(i + 1) * u;
  };
  const rows: number[] = [];
  for (let r = 0; r < layout.height / RAGGED_ROW; r++) {
    const t = (r * RAGGED_ROW) / RAGGED_CELL;
    const n = 0.65 * noise(t, cells, 0) + 0.35 * noise(t * 3, cells * 3, 1); // 0 … 1
    rows.push(base + (n * 2 - 1) * amp);
  }
  return rows;
}
