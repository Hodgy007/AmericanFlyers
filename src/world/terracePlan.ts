import { hash2 } from './noise';

// The layout of one row of Kestrel Vale's village terraces (`terrace` with `options.village`, built by monumentVale.ts), kept apart from the builder so that
// stageKit.ts can size each row without three.js and the unit tests can read the layout back. A row is a handful of houses, each with its own storeys,
// door side, frame and door colours, now and then a shopfront, a low cottage at one end or a ginnel (a narrow gap) between two houses; neighbours of the
// same height share a roof, so the ridge steps where the storeys change. Everything is a pure function of the seed. Metres, standing on y = 0, front towards +z.

export const VILLAGE_FLOOR = 3.1; // one storey
export const VILLAGE_BASE = 0.5; // the stone plinth under the ground floor
export const VILLAGE_DEPTH = 9; // front to back (the fronts are at +4.5, 16.5 m from the road's centreline)
/** The widest a row may be: the inn's end (46 m) is clear of the first left-hand row (66 m, so at most 16.2 m either side of it) and no row reaches the next (44 m pitch). */
export const VILLAGE_MAX_WIDTH = 32.4;
const GINNEL = 2.2;
const CHIMNEY = 1.6; // a stack stands this far above the ridge

export interface VillageHouse {
  /** Left edge (x) and width, m. */
  x0: number;
  w: number;
  /** 3 and 2: storeys of a house; 1: a low cottage (one storey and an attic under the roof, with a dormer). */
  storeys: 1 | 2 | 3;
  /** The ground floor is a shop: a big window, a painted fascia and an awning. */
  shop: boolean;
  /** The door is at the left end of the front (else the right). */
  doorLeft: boolean;
  /** Indices into the builder's palettes (stone, door, frame, shop). */
  stone: number;
  door: number;
  frame: number;
  /** A wash of render instead of bare stone. */
  render: boolean;
}

export interface VillageRun {
  /** Houses [i0, i1] of the row under one roof. */
  i0: number;
  i1: number;
  x0: number;
  x1: number;
  /** Height of the eaves above y = 0, and of the ridge above them. */
  eave: number;
  rise: number;
  /** Which of the builder's roof colours. */
  slate: number;
}

export interface VillageChimney {
  x: number;
  /** The top of the stack. */
  top: number;
  /** The ridge it stands on. */
  ridge: number;
}

export interface VillageTerrace {
  houses: VillageHouse[];
  runs: VillageRun[];
  chimneys: VillageChimney[];
  /** The ginnels, as [x0, x1]. */
  ginnels: [number, number][];
  /** The row's extent along x. */
  x0: number;
  x1: number;
  /** Height of the tallest chimney: the monument's natural height. */
  height: number;
}

const rnd = (seed: number, i: number) => hash2(seed * 7919 + 13, i * 104729 + 7);

/** Eaves height of a house of `storeys` (a cottage's walls are a storey and a bit). */
export const eaveOf = (storeys: 1 | 2 | 3) => VILLAGE_BASE + (storeys === 1 ? VILLAGE_FLOOR + 0.9 : VILLAGE_FLOOR * storeys);

function layout(seed: number, attempt: number): VillageTerrace {
  const r = (i: number) => rnd(seed + attempt * 977, i);
  let n = 4 + Math.floor(r(0) * 3); // four to six houses
  const ginnelAt = r(1) < 0.3 ? 1 + Math.floor(r(2) * (n - 2)) : -1; // before house `ginnelAt`
  const cottageAt = r(3) < 0.4 ? (r(4) < 0.5 ? 0 : n - 1) : -1;
  const shopAt = r(5) < 0.3 ? 1 + Math.floor(r(6) * (n - 2)) : -1;
  // Widths, trimmed until the row (ginnel included) fits.
  const widths: number[] = [];
  const total = () => widths.reduce((a, b) => a + b, 0) + (ginnelAt >= 0 && ginnelAt < widths.length ? GINNEL : 0);
  for (let i = 0; i < n; i++) widths.push(4.7 + r(10 + i) * 1.5);
  while (total() > VILLAGE_MAX_WIDTH && n > 4) { widths.pop(); n--; }
  const W = total();
  // The row's left edge: centred, then pushed a little to one side so the gaps between rows differ; the middle (where the bunting hangs) always stays over the row.
  const shift = (r(7) - 0.5) * 5;
  const reach = VILLAGE_MAX_WIDTH / 2 + 0.6; // no further than this from the middle, so the row's ends stay clear of the inn (left rows) and of the next row
  const rowX0 = Math.min(Math.min(-6, reach - W), Math.max(Math.max(-reach, 6 - W), -W / 2 + shift));
  const houses: VillageHouse[] = [];
  const ginnels: [number, number][] = [];
  let x = rowX0;
  for (let i = 0; i < widths.length; i++) {
    if (i === ginnelAt) { ginnels.push([x, x + GINNEL]); x += GINNEL; }
    const cottage = i === cottageAt;
    const storeys: 1 | 2 | 3 = cottage ? 1 : r(30 + i) < 0.38 ? 2 : 3;
    houses.push({
      x0: x, w: widths[i], storeys,
      shop: i === shopAt && !cottage,
      doorLeft: r(40 + i) < 0.5,
      stone: Math.floor(r(50 + i) * 6),
      door: Math.floor(r(60 + i) * 9),
      frame: Math.floor(r(70 + i) * 6),
      render: r(80 + i) < 0.16,
    });
    x += widths[i];
  }
  // Roofs: neighbours of the same height (and no ginnel between) share one.
  const runs: VillageRun[] = [];
  for (let i = 0; i < houses.length; i++) {
    const h = houses[i];
    const last = runs[runs.length - 1];
    const gap = last && houses[i].x0 - last.x1 > 0.01;
    if (last && !gap && houses[last.i1].storeys === h.storeys) { last.i1 = i; last.x1 = h.x0 + h.w; continue; }
    const rise = (h.storeys === 3 ? 2.5 : h.storeys === 2 ? 2.3 : 2.0) + r(90 + i) * 0.5;
    runs.push({ i0: i, i1: i, x0: h.x0, x1: h.x0 + h.w, eave: eaveOf(h.storeys), rise, slate: Math.floor(r(100 + i) * 3) });
  }
  // Chimneys: on the ridge at the run's ends and over party walls, one to three a run.
  const chimneys: VillageChimney[] = [];
  runs.forEach((run, ri) => {
    const ridge = run.eave + run.rise;
    const spots: number[] = [run.x0 + 0.7, run.x1 - 0.7];
    for (let i = run.i0 + 1; i <= run.i1; i++) spots.push(houses[i].x0);
    const count = 1 + Math.floor(r(110 + ri) * Math.min(3, spots.length));
    const taken = new Set<number>();
    for (let c = 0; c < count; c++) {
      let k = Math.floor(r(120 + ri * 5 + c) * spots.length);
      while (taken.has(k)) k = (k + 1) % spots.length;
      taken.add(k);
      chimneys.push({ x: spots[k], ridge, top: ridge + CHIMNEY });
    }
  });
  const height = Math.max(...chimneys.map((c) => c.top), ...runs.map((rn) => rn.eave + rn.rise));
  return { houses, runs, chimneys, ginnels, x0: rowX0, x1: x, height };
}

/** True if the middle of the row (x = 0, under the bunting's string) is on a full house at least a metre from its ends: not a cottage, a ginnel or a party wall. */
function middleOk(t: VillageTerrace): boolean {
  const h = t.houses.find((o) => o.x0 <= 0 && o.x0 + o.w >= 0);
  return !!h && h.storeys > 1 && h.x0 < -1 && h.x0 + h.w > 1;
}

/** The layout of the row built for `seed` (the first of a few attempts that keeps its middle on a house). */
export function planVillageTerrace(seed: number): VillageTerrace {
  let t = layout(seed, 0);
  for (let a = 1; a < 40 && !middleOk(t); a++) t = layout(seed, a);
  return t;
}

/** A row's natural height as built, m: what `size` must be so it is not stretched. */
export const villageTerraceHeight = (seed: number) => planVillageTerrace(seed).height;
