// Helpers shared by the stage definitions (stages.ts) and the worlds built on top of them (worlds/): the
// road's trace and locator, the monotone-cubic elevation fit, and the landmark builders. Kept apart from
// stages.ts so a world in its own file can use them without importing stages.ts at run time (that would be an
// import cycle: stages.ts imports the worlds' routes). Only types come from stages.ts here.

import type { MonumentId, MonumentOptions } from './world/monumentTypes';
import type { LandmarkBase, LandmarkKind, StageSign } from './stages';

/** Monotone cubic interpolation (Fritsch–Carlson) through (x, y) knots: no overshoot, no flat spots. */
export function pchip(knots: [number, number][]) {
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

/** The road's (x, z) every `step` metres from the course start (x east, z south), by integrating its heading. */
export function roadTrace(headingAt: (d: number) => number, length: number, step = 20): [number, number][] {
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
export function roadLocator(trace: readonly [number, number][], step: number) {
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

/** A code-built landmark standing once at course distance `d` (see world/monuments.ts). `size` is its height in metres. */
export const monumentAt = (model: MonumentId, d: number, side: -1 | 1, offset: number, size: number, extra: Partial<LandmarkBase> & { options?: MonumentOptions } = {}): LandmarkKind =>
  ({ model, first: d, every: 1e9, side, offset, size, clearance: 8, ...extra });

export const GANTRY: LandmarkKind = { file: 'gantry.glb', every: 5000, first: 30, side: 0, span: 'across', offset: 0, size: 13, clearance: 12 };
export const startArch: LandmarkKind = { ...GANTRY, every: 1e9 };
export const finishArch = (at: number): LandmarkKind => ({ ...GANTRY, first: at, every: 1e9 });

/** Spreads landmark kinds over every lap of a circuit: `first` and `until` are course distances within the lap. */
export const perLap = (kinds: LandmarkKind[], lap: number, laps: number): LandmarkKind[] =>
  kinds.flatMap((k) => Array.from({ length: laps }, (_, i) => ({ ...k, first: k.first + i * lap, until: (k.until ?? lap) + i * lap })));

/** A street of terraced houses along one side of the road from lap metre `from` to `to`: `seeds` alternate along it, so it is not one house repeated. */
export function terraceRow(from: number, to: number, side: -1 | 1, material: 'brick' | 'stone', seeds: number[], spacing = 44): LandmarkKind[] {
  return seeds.map((seed, i) => ({
    ...monumentAt('terrace', from + i * spacing, side, 21, TERRACE_HEIGHT, { options: { seed, material }, clearance: 16 }),
    every: spacing * seeds.length,
    until: to,
  }));
}
/** A terrace's height as built (monumentCity.ts), so it is not stretched: about 14 m, chimneys included. */
export const TERRACE_HEIGHT = 14;

/** Named places (announced as "next: ...", not drawn), for a circuit's every lap. */
export const namedPlaces = (places: [number, string][], lap: number, laps: number): StageSign[] =>
  Array.from({ length: laps }, (_, i) => places.map(([d, name]) => ({ d: d + i * lap, label: '', name, style: 'hairpin' as const, numbered: false }))).flat();

/**
 * Ground level that follows a closed or open road across country: the road's own elevation averaged over the points of its
 * trace by inverse distance (to the power `power`, so the nearest bit of road wins close to it and a hillside between two
 * stacked legs slopes between them), sampled on a raster of `cell` metres and read back bilinearly. A stage whose road
 * climbs hundreds of metres uses it as the base of `wildHeight`, so the land rises with the road and stays continuous
 * where two legs at different heights meet (a nearest-road lookup would show a cliff along the line between them).
 * Built on first use. `trace` is `roadTrace`'s output, `step` its spacing; `elevationAt` takes a distance along the trace.
 */
export function roadElevationField(
  trace: readonly [number, number][], step: number, elevationAt: (d: number) => number,
  opts: { cell?: number; margin?: number; spacing?: number; power?: number } = {},
): (x: number, z: number) => number {
  const cell = opts.cell ?? 50;
  const margin = opts.margin ?? 2500;
  const spacing = Math.max(step, opts.spacing ?? 50);
  const power = opts.power ?? 3;
  let grid: Float32Array | null = null;
  let x0 = 0, z0 = 0, nx = 0, nz = 0;
  const build = () => {
    const stride = Math.max(1, Math.round(spacing / step));
    const px: number[] = [], pz: number[] = [], py: number[] = [];
    for (let i = 0; i < trace.length; i += stride) { px.push(trace[i][0]); pz.push(trace[i][1]); py.push(elevationAt(i * step)); }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < px.length; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]); }
    x0 = minX - margin; z0 = minZ - margin;
    nx = Math.ceil((maxX - minX + 2 * margin) / cell) + 1;
    nz = Math.ceil((maxZ - minZ + 2 * margin) / cell) + 1;
    const g = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
        let sw = 0, sv = 0;
        for (let k = 0; k < px.length; k++) {
          const d = Math.max(30, Math.hypot(px[k] - x, pz[k] - z));
          const w = 1 / d ** power;
          sw += w;
          sv += w * py[k];
        }
        g[j * nx + i] = sv / sw;
      }
    }
    grid = g;
  };
  return (x, z) => {
    if (!grid) build();
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cell));
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const g = grid!;
    const a = g[j * nx + i] * (1 - tx) + g[j * nx + i + 1] * tx;
    const b = g[(j + 1) * nx + i] * (1 - tx) + g[(j + 1) * nx + i + 1] * tx;
    return a * (1 - tz) + b * tz;
  };
}
