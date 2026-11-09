// A city skyline round a park, as data: where the towers stand and how tall they are. Pure (no three.js),
// so a stage can size its landmark from it and a test can check it stays clear of the park's own road.
// Used by the Manhattan skyline round Central Park (monuments.ts builds the boxes).

import { hash2 } from './noise';

export interface Tower {
  x: number;
  z: number;
  /** Footprint, m, along the tower's own x and z. */
  w: number;
  d: number;
  /** Height above the ground, m. */
  h: number;
  /** Turn about the vertical, rad: the street grid. */
  ry: number;
  /** 0..1 picks the facade colour. */
  tone: number;
  /** A setback crown (a narrower block on top) for the tall ones. */
  crown: boolean;
}

/** How near a tower may stand to the park's road, m: the park's own edge and the avenue beyond it. */
export const SKYLINE_NEAR = 215;
/** How far out the towers go, m. */
export const SKYLINE_FAR = 560;
const SPACING = 128;

/** Distance from (x, z) to the nearest point of the sampled polyline. */
function nearest(loop: readonly [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (const [px, pz] of loop) {
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** The loop sampled every ~`step` metres from its own vertices (they may be sparse), so a nearest-point test is within step/2. */
function resample(loop: readonly [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < loop.length; i++) {
    const [ax, az] = loop[i];
    const [bx, bz] = loop[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(loop[loop.length - 1]);
  return out;
}

/**
 * Towers on a jittered grid in the band between SKYLINE_NEAR and SKYLINE_FAR from the loop (`x` east, `z` south, as in the
 * course frame), taller towards the south end (Midtown) than the north (Harlem), and a little taller further out.
 * The same loop always gives the same towers.
 */
export function skylineTowers(loop: readonly [number, number][], seed = 1): Tower[] {
  const pts = resample(loop, 20);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const out: Tower[] = [];
  const r = (a: number, b: number) => hash2(seed * 131 + a * 7919, b * 104729 + seed * 17);
  for (let gz = Math.floor((minZ - SKYLINE_FAR) / SPACING); gz <= Math.ceil((maxZ + SKYLINE_FAR) / SPACING); gz++) {
    for (let gx = Math.floor((minX - SKYLINE_FAR) / SPACING); gx <= Math.ceil((maxX + SKYLINE_FAR) / SPACING); gx++) {
      const x = (gx + 0.5 + (r(gx, gz) - 0.5) * 0.7) * SPACING;
      const z = (gz + 0.5 + (r(gz + 17, gx) - 0.5) * 0.7) * SPACING;
      const dist = nearest(pts, x, z);
      if (dist < SKYLINE_NEAR || dist > SKYLINE_FAR) continue;
      if (r(gx + 91, gz + 7) < 0.1) continue; // a gap: a street, a plaza, a church
      const south = Math.max(0, Math.min(1, (z - minZ) / Math.max(1, maxZ - minZ)));
      const reach = (dist - SKYLINE_NEAR) / (SKYLINE_FAR - SKYLINE_NEAR);
      // Prewar apartment blocks along the park (50 to 95 m), Midtown's glass towers at the south end, low brick to the north.
      const base = 38 + 52 * Math.pow(south, 1.3);
      const spike = Math.pow(Math.max(0, (south - 0.62) / 0.38), 1.2); // 0 until the lower fifth, then up
      const h = (base + r(gx + 3, gz + 5) * 36) * (1 + 0.4 * reach) + spike * (60 + 210 * r(gx + 11, gz + 13));
      const w = 30 + r(gx + 23, gz + 29) * 34;
      const d = 30 + r(gx + 31, gz + 37) * 30;
      out.push({ x, z, w, d, h, ry: -0.507 + (r(gx + 41, gz + 43) - 0.5) * 0.04, tone: r(gx + 47, gz + 53), crown: h > 110 });
    }
  }
  return out;
}

/** The tallest tower's top, m (the landmark's `size`: a monument is scaled so its height is its size). */
export function skylineHeight(towers: readonly Tower[]): number {
  let top = 1;
  for (const t of towers) top = Math.max(top, t.h + (t.crown ? t.h * 0.22 : 0));
  return top;
}

/** A default loop for a skyline built without one (the monument tests): a 700 m by 3,000 m rounded park. */
export const DEFAULT_LOOP: [number, number][] = Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * Math.PI * 2;
  return [Math.cos(a) * 350, Math.sin(a) * 1500] as [number, number];
}).concat([[350, 0]]);
