import * as THREE from 'three';
import { Kit, finish, farMaterial, mix, rnd } from './monumentKit';
import type { MonumentOptions } from './monumentTypes';
import { DEFAULT_LOOP, skylineTowers } from './skyline';

// Landmarks of the circuits and the coast road, built in code like the summit buildings (monuments.ts
// registers them): the Manhattan skyline round Central Park, the Virginia State Capitol, a row of houses
// (Richmond's brick, Harrogate's stone) and Bixby Creek Bridge on the Big Sur coast.

// --------------------------------------------------------------- skyline ----

const FACADES = ['#8d8f93', '#a79f92', '#b3a48a', '#7e8794', '#9aa7b3', '#6f7a86', '#c0b4a0', '#8a8378'];
const SKYLINE_SINK = 12; // the towers' feet go this far below the ground, so none floats

/**
 * Towers round a park: `options.loop` is the park's road (x east, z south, from the course start); the towers
 * stand in a band outside it (skyline.ts), tall to the south. Drawn in the far material (hazy, not fogged out), no shadows.
 */
export function buildSkyline(o: MonumentOptions = {}): THREE.Group {
  const k = new Kit();
  for (const t of skylineTowers(o.loop ?? DEFAULT_LOOP, o.seed ?? 1)) {
    const col = FACADES[Math.min(FACADES.length - 1, Math.floor(t.tone * FACADES.length))];
    k.box(t.w, t.h + SKYLINE_SINK, t.d, t.x, -SKYLINE_SINK, t.z, col, t.ry, 0.8);
    if (t.crown) k.box(t.w * 0.6, t.h * 0.22, t.d * 0.6, t.x, t.h, t.z, mix(col, '#ffffff', 0.18), t.ry, 1);
  }
  return finish(k.build(farMaterial), false);
}

// --------------------------------------------------------------- capitol ----

/**
 * The Virginia State Capitol in Richmond: Jefferson's temple front (six columns and a pediment) on a stone base, a
 * wing either side, and a low dome on the roof. Cream stucco, a copper-green roof. About 56 m wide; its front faces +z.
 */
export function buildCapitol(): THREE.Group {
  const k = new Kit();
  const STONE = '#bdb8ac';
  const CREAM = '#e8e0cc';
  const ROOF = '#6f8a7a';
  k.box(66, 1.4, 38, 0, 0, 0, STONE, 0, 1); // the terrace it stands on
  k.box(50, 0.9, 30, 0, 1.4, 0, '#cbc6ba', 0, 1);
  k.box(32, 15, 22, 0, 2.3, -2, CREAM, 0, 0.9); // the main block
  for (const sx of [-1, 1]) {
    k.box(17, 10.5, 19, sx * 24, 2.3, -2, CREAM, 0, 0.9); // the wings (1906)
    k.pyramid(18, 20, 3.2, sx * 24, 12.8, -2, ROOF);
    for (let i = 0; i < 3; i++) for (let r = 0; r < 2; r++) k.box(1.5, 2.4, 0.2, sx * 24 - 5 + i * 5, 4.4 + r * 4.2, 7.55, '#4b5c69', 0, 1); // windows
  }
  // The portico: six Ionic columns, the entablature and the pediment.
  const FRONT = 11 + 4.4;
  for (let i = 0; i < 6; i++) k.cyl(0.75, 0.62, 11.2, -8.5 + i * 3.4, 2.3, FRONT, '#f2ecda', 10, 0.92);
  k.box(21, 1.7, 7.2, 0, 13.5, FRONT - 3, '#ece4d0', 0, 0.95); // entablature
  k.gable(7.2, 21, 3.8, 0, 15.2, FRONT - 3, '#e6dec9', '#efe8d6', Math.PI / 2); // the pediment: triangle to the front
  k.box(14, 0.5, 4.8, 0, 0.9, FRONT + 0.6, '#cbc6ba', 0, 1); // the steps
  k.box(14, 0.5, 4, 0, 1.4, FRONT + 0.4, '#d1ccc0', 0, 1);
  k.box(4, 7, 0.3, 0, 2.3, 9.2, '#5a4a3a', 0, 1); // the door
  // The roof and the dome.
  k.pyramid(34, 24, 4, 0, 17.3, -2, ROOF);
  k.cyl(5.3, 5.3, 4.4, 0, 20.6, -2, '#efe8d6', 14, 0.9); // drum
  k.ball(5.6, 0, 24.6, -2, '#7e9a8b', 1, 0.85, 1, 0.95); // dome
  k.cyl(0.9, 0.5, 3, 0, 28.8, -2, '#e8e0cc', 8, 1); // lantern
  k.cyl(0.35, 0.05, 3.2, 0, 31.2, -2, '#c9a24a', 6, 1); // finial
  return finish(k.build());
}

// -------------------------------------------------------------- terrace ----

const BRICK = ['#9b4a3a', '#a5533f', '#8a3f33', '#b0654d', '#7d3b30', '#94503f'];
const STONE_HOUSES = ['#a39b8a', '#b3ab98', '#9a9484', '#bdb6a3', '#8f8a7c', '#aaa38f'];
const DOORS = ['#2f4a3a', '#5a2a2a', '#1f2f4a', '#3a3a3a', '#6a4a2a'];

/**
 * A short terrace of attached town houses, three storeys under one slate roof, with chimneys: red-brick Italianate rowhouses
 * for Richmond's Church Hill (`material: 'brick'`, the default), grey stone Victorian terraces for Harrogate (`'stone'`). `seed` varies the colours and the number of houses (four to six). Front towards +z.
 */
export function buildTerrace(o: MonumentOptions = {}): THREE.Group {
  const stone = o.material === 'stone';
  const seed = o.seed ?? 1;
  const palette = stone ? STONE_HOUSES : BRICK;
  const k = new Kit();
  const n = 4 + Math.floor(rnd(seed, 0) * 3);
  const W = 5.4, D = 9, FLOOR = 3.1, STOREYS = 3;
  const x0 = (-n * W) / 2;
  const base = stone ? 0.5 : 0.9;
  for (let i = 0; i < n; i++) {
    const x = x0 + W * (i + 0.5);
    const col = palette[Math.floor(rnd(seed, i + 1) * palette.length)];
    k.box(W, base + FLOOR * STOREYS, D, x, 0, 0, col, 0, 0.84);
    // Stone steps and a front door on the left of each house; a bay of two windows on each storey.
    k.box(1.6, 0.4, 1.3, x - 1.5, 0, D / 2 + 0.55, '#a9a49a', 0, 1);
    k.box(1.2, 2.4, 0.12, x - 1.5, base, D / 2 + 0.02, DOORS[Math.floor(rnd(seed, i + 20) * DOORS.length)], 0, 1);
    for (let s = 0; s < STOREYS; s++) {
      const y = base + s * FLOOR + 0.7;
      for (const wx of s === 0 ? [1.15] : [-1.5, 1.15]) k.box(1.1, 1.7, 0.12, x + wx, y, D / 2 + 0.02, '#364451', 0, 1);
      k.box(1.3, 0.2, 0.2, x + (s === 0 ? 1.15 : 1.15), y + 1.7, D / 2 + 0.04, mix(col, '#ffffff', 0.4), 0, 1); // a stone lintel
    }
    if (i % 2 === 0) k.box(0.9, 2.2, 0.9, x + 0.9, base + FLOOR * STOREYS + 1.6, -1.2, mix(col, '#000000', 0.2), 0, 1); // a chimney stack
  }
  k.gable(n * W + 0.4, D + 0.6, 2.6, 0, base + FLOOR * STOREYS, 0, '#4b4f57', mix(col0(palette, seed), '#000000', 0.1));
  k.box(n * W + 0.8, 0.25, D + 0.9, 0, base + FLOOR * STOREYS - 0.1, 0, '#d6d1c4', 0, 1); // the cornice
  return finish(k.build());
}

const col0 = (palette: string[], seed: number) => palette[Math.floor(rnd(seed, 1) * palette.length)];

// ----------------------------------------------------------- Bixby bridge ----

/** The deck of Bixby Creek Bridge stands this high above the canyon floor (the model's origin). */
export const BIXBY_DECK = 79.2;
/** Its length, m (714 ft). */
export const BIXBY_LENGTH = 218;

/**
 * Bixby Creek Bridge on California Highway 1: a concrete open-spandrel arch, 218 m long, its deck 79 m above the creek. The deck runs along
 * x and stands on y = 79.2 (so landmark `lift` -79.2 sets the deck at the road); the arch springs from the canyon walls at y = 4 and
 * crowns at 70. Its length lies along +x, the way the road goes; the model is 80 m tall, deck and parapets included.
 */
export function buildBixbyBridge(): THREE.Group {
  const k = new Kit();
  const CONCRETE = '#d8d3c4';
  const SHADE = '#bdb7a6';
  const half = BIXBY_LENGTH / 2;
  const top = BIXBY_DECK;
  const SLAB = 1.6;
  k.box(BIXBY_LENGTH, SLAB, 9.6, 0, top - SLAB - 0.2, 0, CONCRETE, 0, 0.95); // the deck
  for (const z of [-4.6, 4.6]) k.box(BIXBY_LENGTH, 0.95, 0.4, 0, top - 0.2, z, '#ddd8ca', 0, 1); // parapets
  // The main arch: two ribs, a parabola of straight bars from x = -50 to 50.
  const SPAN = 50;
  const arch = (x: number) => 4 + 66 * (1 - (x / SPAN) * (x / SPAN));
  const RIBS = 16;
  for (const z of [-3, 3]) {
    for (let i = 0; i < RIBS; i++) {
      const a = -SPAN + (2 * SPAN * i) / RIBS;
      const b = -SPAN + (2 * SPAN * (i + 1)) / RIBS;
      k.bar([a, arch(a), z], [b, arch(b), z], 2.6, CONCRETE, 0.85);
    }
  }
  // Spandrel columns from the arch to the deck, a cross-beam over each pair.
  const deckBottom = top - SLAB - 0.2;
  for (let x = -45; x <= 45; x += 9) {
    for (const z of [-3, 3]) k.box(1.4, deckBottom - arch(x) + 0.2, 1.4, x, arch(x) - 0.2, z, SHADE, 0, 0.9);
    k.box(1.2, 0.9, 6.4, x, deckBottom - 1.2, 0, CONCRETE, 0, 1);
  }
  // Approach spans: piers every 16 m from the arch's springing out to each end, standing in the canyon walls.
  for (const s of [-1, 1]) {
    for (let x = SPAN + 8; x <= half - 4; x += 16) {
      const bottom = 2;
      for (const z of [-3, 3]) k.box(1.8, deckBottom - bottom, 1.8, s * x, bottom, z, SHADE, 0, 0.88);
      k.box(1.4, 1, 7.4, s * x, deckBottom - 1.4, 0, CONCRETE, 0, 1);
    }
    // The abutment where the arch meets the walls.
    k.box(6, 14, 8, s * (SPAN + 1), 0, 0, SHADE, 0, 0.8);
  }
  return finish(k.build());
}
