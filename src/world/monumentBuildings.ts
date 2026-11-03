import * as THREE from 'three';
import { Kit, boardMaterial, finish, fitText, mix, rnd, type Col } from './monumentKit';
import type { MonumentOptions } from './monumentTypes';

// The buildings among the procedural monuments (monuments.ts has the registry): a
// summit observatory, a chalet, a village church, ski apartments, hotels on a pass,
// a log lodge, and the summit buildings of the American climbs. Low-poly boxes and
// roofs; windows, balconies and a few big shapes carry the look.

const GLASS = '#26303c';
const TIMBER = '#7b5233';
const TIMBER_DARK = '#4f3622';

/**
 * A row of windows on one wall. The wall's centre is (x, z) and it faces `ry` (0: +z, π/2: +x,
 * π: -z, -π/2: -x); `cols` windows `pitch` apart, `rows` floors `floorH` apart, the lowest with its sill at `y`.
 */
function windows(k: Kit, x: number, z: number, ry: number, cols: number, pitch: number, rows: number, y: number, floorH: number, w: number, h: number, color: Col = GLASS, shutter?: Col) {
  k.within([x, 0, z], [0, ry, 0], () => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = (c - (cols - 1) / 2) * pitch;
        k.box(w, h, 0.16, wx, y + r * floorH, 0, color, 0, 1);
        if (shutter) {
          k.box(w * 0.38, h, 0.12, wx - w * 0.69, y + r * floorH, 0, shutter, 0, 1);
          k.box(w * 0.38, h, 0.12, wx + w * 0.69, y + r * floorH, 0, shutter, 0, 1);
        }
      }
    }
  });
}

/** A balcony across `w` of a wall at (x, z) facing +z: a slab and a solid timber parapet. */
function balcony(k: Kit, x: number, y: number, z: number, w: number, depth = 1.3, color = TIMBER_DARK) {
  k.box(w, 0.16, depth, x, y, z + depth / 2, color, 0, 1);
  k.box(w, 0.85, 0.07, x, y + 0.16, z + depth - 0.04, mix(color, '#a07850', 0.35), 0, 0.9);
}

/** A gabled roof over a `w` × `d` building (x by z), eaves overhanging by `over`; the ridge runs along x or, with `alongX` false, along z. */
function roofOver(k: Kit, w: number, d: number, rise: number, over: number, x: number, y: number, z: number, color: Col, end: Col, alongX = true) {
  if (alongX) k.gable(w + 0.4, d + 2 * over, rise, x, y, z, color, end);
  else k.gable(d + 0.4, w + 2 * over, rise, x, y, z, color, end, Math.PI / 2);
}

// ----------------------------------------------------- Ventoux observatory ----

/** The weather station on the summit of Mont Ventoux: a pale concrete building and the red-and-white banded mast (about 50 m). */
export function buildObservatory(): THREE.Group {
  const k = new Kit();
  const PALE = '#dcd6c7';
  k.box(40, 3, 15, -6, -3, 0, '#77726a'); // foundation, so it stands on a slope
  k.box(21, 7, 11, -11, 0, 0, PALE); // the main hall
  k.box(21.8, 0.5, 11.8, -11, 7, 0, '#5d5a55', 0, 1); // flat roof
  k.box(10, 5, 8, -27, 0, 0.5, mix(PALE, '#c9bfa5', 0.4)); // the low wing
  k.box(10.8, 0.4, 8.8, -27, 5, 0.5, '#5d5a55', 0, 1);
  k.box(8, 9, 8, 6, 0, -1, PALE); // the mast's base block
  k.box(8.8, 0.5, 8.8, 6, 9, -1, '#5d5a55', 0, 1);
  k.box(5, 2.4, 4, -14, 7.5, -1, mix(PALE, '#bdb7a8', 0.4)); // rooftop plant room
  k.cyl(2.0, 0.6, 1.6, -7, 7.5, 1, '#e9e6de', 10); // a radome
  windows(k, -11, 5.5, 0, 8, 2.4, 2, 1.0, 3.0, 1.4, 1.5);
  windows(k, -27, 4.5, 0, 3, 2.8, 1, 1.5, 3, 1.4, 1.5);
  windows(k, 6, 3.0, 0, 2, 3.2, 2, 2.6, 3.2, 1.3, 1.5);
  k.box(2.4, 2.8, 0.2, -11, 0, 5.55, '#3a3a40', 0, 1); // the door
  // The mast: seven bands of red and white, tapering, with a platform and an aerial on top.
  const base = 9.5, top = 44, bands = 7;
  const radius = (y: number) => 1.9 - (1.9 - 0.85) * ((y - base) / (top - base));
  for (let i = 0; i < bands; i++) {
    const y0 = base + ((top - base) * i) / bands;
    const y1 = base + ((top - base) * (i + 1)) / bands;
    k.cyl(radius(y0), radius(y1), y1 - y0, 6, y0, -1, i % 2 === 0 ? '#c8281c' : '#f2efe8', 10, 0.95);
  }
  k.cyl(1.7, 1.7, 0.4, 6, top, -1, '#9a9a9a', 10, 1); // platform
  k.box(2.2, 1.7, 2.2, 6, top + 0.4, -1, '#e8e5de'); // equipment cabin
  k.cyl(0.14, 0.05, 5.6, 6, top + 2.1, -1, '#c8281c', 5, 1); // aerial
  k.bar([4.4, top + 5, -1], [7.6, top + 5, -1], 0.1, '#8a8a8a');
  for (const [gx, gz] of [[16, -9], [-4, -9], [16, 7], [-4, 7]] as const) {
    k.bar([6, 38, -1], [gx, 0, gz], 0.08, '#6c6f74', 1); // guy wires
  }
  return finish(k.build());
}

// -------------------------------------------------------------- the chalet ----

/** A wooden mountain chalet-restaurant on a stone ground floor (Chalet Reynard on Ventoux; fits an alpine village). `lines[0]` is the name on the balcony. */
export function buildChalet(o: MonumentOptions = {}): THREE.Group {
  const name = (o.lines ?? ['CHALET'])[0];
  const k = new Kit();
  k.box(15, 2, 10, 0, -2, 0, '#8b8578'); // foundation
  k.box(14, 3.0, 9, 0, 0, 0, '#cbbfa5'); // stone ground floor
  k.box(13.4, 2.8, 8.4, 0, 3.0, 0, '#9a6a40'); // timber upper floor
  roofOver(k, 15, 9, 3.7, 1.1, 0, 5.8, 0, '#5a4338', '#9a6a40');
  k.box(1.0, 4.4, 1.1, 4.2, 5.8, -1.2, '#8d8272'); // chimney
  balcony(k, 0, 3.0, 4.5, 14.6, 1.5, '#6f4a2c');
  windows(k, 0, 4.5, 0, 4, 3.1, 1, 0.9, 0, 1.3, 1.5);
  k.box(1.6, 2.4, 0.2, 0, 0, 4.55, TIMBER_DARK, 0, 1); // door
  windows(k, 0, 4.2, 0, 5, 2.6, 1, 3.9, 0, 1.0, 1.3, GLASS, '#efe9dc');
  windows(k, 7.0, 0, Math.PI / 2, 2, 3, 1, 1.2, 0, 1.1, 1.4);
  windows(k, 6.7, 0, Math.PI / 2, 2, 3, 1, 3.9, 0, 1.0, 1.3, GLASS, '#efe9dc');
  k.panel(6.4, 0.75, 0, 3.58, 6.03, boardMaterial(`chalet|${name}`, 512, 60, (g, w, h) => {
    g.fillStyle = '#7a2a22';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4ecd8';
    fitText(g, name, w / 2, h / 2, w - 30, 44);
  }, '#7a2a22'));
  return finish(k.build());
}

// -------------------------------------------------------------- the church ----

/** A small Alpine village church: whitewashed nave, a square tower with a clock and belfry, and a slender slate spire with a gold cross. */
export function buildChurch(): THREE.Group {
  const k = new Kit();
  const WALL = '#ece5d3';
  k.box(8, 2, 13, 0, -2, -1, '#8f8a7d');
  k.box(7, 6.2, 11, 0, 0, -1, WALL); // nave
  roofOver(k, 7, 11, 3.4, 0.7, 0, 6.2, -1, '#6b4a3c', WALL, false);
  k.box(4, 4.6, 3.2, 0, 0, -8.2, WALL); // apse
  k.pyramid(5, 4.2, 2.4, 0, 4.6, -8.2, '#6b4a3c');
  k.box(4.4, 13, 4.4, 0, 0, 5.2, mix(WALL, '#d6cdb4', 0.35)); // tower
  k.box(5, 0.5, 5, 0, 13, 5.2, '#a89f8a', 0, 1);
  k.cyl(2.9, 0.1, 11.5, 0, 13.5, 5.2, '#4a5058', 8, 0.8); // spire
  k.box(0.14, 1.7, 0.14, 0, 24.9, 5.2, '#d8b24a', 0, 1); // cross
  k.box(0.9, 0.14, 0.14, 0, 25.9, 5.2, '#d8b24a', 0, 1);
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    k.within([0, 0, 5.2], [0, ry, 0], () => {
      k.box(1.2, 1.9, 0.2, 0, 10.6, 2.25, GLASS, 0, 1); // belfry opening
    });
  }
  k.box(1.7, 1.7, 0.14, 0, 8.4, 7.45, '#f5f2ea', 0, 1); // clock face
  k.box(0.1, 0.62, 0.1, 0, 9.2, 7.53, '#222', 0, 1);
  k.box(0.5, 0.1, 0.1, 0.2, 9.2, 7.53, '#222', 0, 1);
  k.box(1.8, 2.9, 0.2, 0, 0, 7.4, '#4b3322', 0, 1); // door
  k.pyramid(2.2, 0.3, 1.0, 0, 2.9, 7.45, '#4b3322');
  windows(k, 3.55, -1, Math.PI / 2, 3, 3.4, 1, 1.9, 0, 0.9, 2.2);
  windows(k, -3.55, -1, -Math.PI / 2, 3, 3.4, 1, 1.9, 0, 0.9, 2.2);
  return finish(k.build());
}

// ------------------------------------------------------ ski-resort blocks ----

const RENDER = ['#e2d6bd', '#d0bb98', '#c9a98a', '#e8e0d2', '#bdb5a4'];
const ROOFS = ['#7a4b3a', '#4a4f55', '#5d4a3f'];

/** A cluster of 3 to 5 ski-resort apartment blocks, 3 to 5 storeys, with balconies and pitched roofs. `seed` varies the cluster. */
export function buildApartments(o: MonumentOptions = {}): THREE.Group {
  const seed = o.seed ?? 1;
  const k = new Kit();
  const count = 3 + Math.floor(rnd(seed, 0) * 3);
  const FLOOR = 2.9;
  // Blocks stand side by side with their fronts staggered, so the row is not a ruler line.
  const widths = Array.from({ length: count }, (_, i) => 10 + Math.floor(rnd(seed, 10 + i) * 6));
  const total = widths.reduce((a, b) => a + b, 0) + (count - 1) * 1.5;
  let x = -total / 2;
  for (let i = 0; i < count; i++) {
    const w = widths[i];
    const floors = 3 + Math.floor(rnd(seed, 20 + i) * 3);
    const d = 9 + Math.floor(rnd(seed, 30 + i) * 4);
    const z = (rnd(seed, 40 + i) - 0.5) * 6;
    const cx = x + w / 2;
    const body = RENDER[Math.floor(rnd(seed, 50 + i) * RENDER.length)];
    const roof = ROOFS[Math.floor(rnd(seed, 60 + i) * ROOFS.length)];
    const h = floors * FLOOR;
    k.box(w + 0.6, 4, d + 0.6, cx, -4, z, '#7c776d'); // footing
    k.box(w, h, d, cx, 0, z, body);
    k.box(w + 0.1, 1.2, d + 0.1, cx, 0, z, '#8f8576'); // stone base storey
    roofOver(k, w, d, 1.8 + rnd(seed, 70 + i), 0.6, cx, h, z, roof, body, rnd(seed, 80 + i) < 0.5);
    const cols = Math.max(2, Math.round(w / 3.2));
    windows(k, cx, z + d / 2, 0, cols, w / cols, floors, 1.5, FLOOR, 1.0, 1.4);
    windows(k, cx - w / 2, z, -Math.PI / 2, 2, 4, floors, 1.5, FLOOR, 1.0, 1.4);
    for (let f = 1; f < floors; f++) balcony(k, cx, f * FLOOR - 0.1, z + d / 2, w * 0.74, 1.2, TIMBER_DARK);
    x += w + 1.5;
  }
  return finish(k.build());
}

// ------------------------------------------------------------- the passes ----

const ROW_WALLS = ['#d8c9a8', '#c98b6a', '#e9e2d0', '#b8b09a', '#d3b98e'];
const ROW_ROOFS = ['#575b60', '#6a4a3a', '#4c4f55', '#6e4638'];

/** The row of tall stone-and-timber hotels and shops at the top of a pass (the Stelvio), with steep roofs and, with `style: 'it'`, flags. */
export function buildPassBuildings(o: MonumentOptions = {}): THREE.Group {
  const seed = o.seed ?? 3;
  const k = new Kit();
  const FLOOR = 3.2;
  const widths = [11, 9, 13, 10];
  const floors = [4, 3, 5, 3];
  const total = widths.reduce((a, b) => a + b, 0);
  let x = -total / 2;
  widths.forEach((w, i) => {
    const d = 11;
    const h = floors[i] * FLOOR;
    const cx = x + w / 2;
    const wall = ROW_WALLS[(i + Math.floor(rnd(seed, i) * 5)) % ROW_WALLS.length];
    const roof = ROW_ROOFS[(i + Math.floor(rnd(seed, 9 + i) * 4)) % ROW_ROOFS.length];
    k.box(w + 0.4, 4, d + 0.4, cx, -4, 0, '#7c776d');
    k.box(w, FLOOR, d, cx, 0, 0, '#9a9183'); // stone ground floor
    k.box(w, h - FLOOR, d, cx, FLOOR, 0, wall);
    roofOver(k, w, d, 3.6 + w * 0.22, 0.7, cx, h, 0, roof, wall, i % 2 === 1); // gable ends to the road on alternate buildings
    windows(k, cx, d / 2, 0, Math.max(2, Math.round(w / 3)), w / Math.max(2, Math.round(w / 3)), floors[i] - 1, FLOOR + 0.9, FLOOR, 1.1, 1.5, GLASS, '#efe6d2');
    windows(k, cx, d / 2, 0, Math.max(2, Math.round(w / 3.4)), w / Math.max(2, Math.round(w / 3.4)), 1, 0.9, 0, 1.3, 1.5);
    for (let f = 1; f < floors[i]; f += 2) balcony(k, cx, f * FLOOR + 0.1, d / 2, w * 0.7, 1.2, TIMBER);
    x += w;
  });
  if (o.style === 'it') {
    // Three flagpoles in front: each a tricolour, green, white and red from the pole.
    for (const fx of [-total / 2 + 3, 0.5, total / 2 - 3]) {
      k.cyl(0.08, 0.06, 9, fx, 0, 9, '#c9ccd0', 5, 1);
      ['#1f8f4d', '#f2f2f2', '#d0222d'].forEach((c, j) => k.box(0.45, 1.0, 0.06, fx + 0.3 + j * 0.45, 7.8, 9, c, 0, 1));
    }
  }
  return finish(k.build());
}

/** A rustic log lodge with a green metal roof, a covered porch, a stone chimney and a name board (`lines[0]`). */
export function buildLogLodge(o: MonumentOptions = {}): THREE.Group {
  const name = (o.lines ?? ['ECHO LAKE LODGE'])[0];
  const k = new Kit();
  const W = 16, D = 9, COURSES = 8, LOG = 0.5;
  k.box(W + 1, 1.5, D + 1, 0, -1.5, 0, '#7c776d'); // stone footing
  for (let c = 0; c < COURSES; c++) {
    const tone = mix('#8a5a34', '#6b4326', rnd(7, c));
    k.box(W + 0.7, LOG - 0.04, 0.55, 0, c * LOG, D / 2 - 0.25, tone, 0, 1); // front log (ends overshoot the corners)
    k.box(W + 0.7, LOG - 0.04, 0.55, 0, c * LOG, -D / 2 + 0.25, mix(tone, '#5a371f', 0.2), 0, 1);
    k.box(0.55, LOG - 0.04, D - 0.4, W / 2 - 0.25, c * LOG, 0, mix(tone, '#5a371f', 0.1), 0, 1);
    k.box(0.55, LOG - 0.04, D - 0.4, -W / 2 + 0.25, c * LOG, 0, tone, 0, 1);
  }
  const wallTop = COURSES * LOG;
  k.gable(W + 0.4, D + 2.6, 3.4, 0, wallTop, 0, '#3f6b4c', '#7b5233');
  k.box(1.8, 8.2, 2.4, -W / 2 - 0.9, -0.5, 0, '#857d70'); // stone chimney
  k.box(2.1, 0.4, 2.7, -W / 2 - 0.9, 7.7, 0, '#6e675c', 0, 1);
  windows(k, 0, D / 2 + 0.01, 0, 4, 3.4, 1, 1.2, 0, 1.4, 1.5, GLASS, '#d9c9a2');
  k.box(1.7, 2.5, 0.2, 0, 0, D / 2 + 0.02, TIMBER_DARK, 0, 1);
  windows(k, W / 2 + 0.01, 0, Math.PI / 2, 2, 3.4, 1, 1.2, 0, 1.3, 1.5);
  // Porch: a low roof on log posts.
  k.gable(W - 2, 3.4, 0.9, 0, 3.0, D / 2 + 1.4, '#3f6b4c');
  for (const px of [-W / 2 + 1.2, -W / 4, 0, W / 4, W / 2 - 1.2]) k.cyl(0.17, 0.15, 3.1, px, 0, D / 2 + 2.6, '#74492a', 6, 1);
  k.box(W - 2, 0.2, 3, 0, 0, D / 2 + 1.1, '#5d4531', 0, 1); // porch deck
  k.panel(4.2, 0.6, 0, 2.6, D / 2 + 2.72, boardMaterial(`lodge|${name}`, 512, 74, (g, w, h) => {
    g.fillStyle = '#4a2f1c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#efe0b4';
    fitText(g, name, w / 2, h / 2, w - 30, 46, 800, 'Georgia, serif');
  }, '#4a2f1c'));
  return finish(k.build());
}

// ------------------------------------------------- American summit buildings ----

/** Mount Washington's summit: the low grey Sherman Adams building and the weather observatory tower with its guyed instrument mast, rimed with ice. */
export function buildWashingtonSummit(): THREE.Group {
  const k = new Kit();
  const STONE = '#9b968c';
  const RIME = '#f1f5f7';
  k.box(34, 2, 14, -2, -2, 0, '#6f6b64');
  k.box(24, 6, 11, -8, 0, 0, STONE); // Sherman Adams building
  k.box(25, 0.6, 12, -8, 6, 0, '#7d7a73', 0, 1);
  k.box(25.2, 0.3, 4, -8, 6.6, 3.6, RIME, 0, 1); // rime on the roof edge
  k.box(14, 3.2, 8, -13, 6.6, 0, mix(STONE, '#8a867d', 0.5));
  windows(k, -8, 5.5, 0, 9, 2.5, 1, 1.4, 0, 1.3, 1.6);
  windows(k, -13, 4, 0, 5, 2.6, 1, 7.8, 0, 1.2, 1.4);
  k.box(6.4, 12, 6.4, 7, 0, 0, mix(STONE, '#a3a095', 0.4)); // the observatory tower
  k.box(7.4, 3.2, 7.4, 7, 12, 0, mix(STONE, '#8c887f', 0.3)); // its instrument deck
  k.box(7.8, 0.4, 7.8, 7, 15.2, 0, '#7d7a73', 0, 1);
  windows(k, 7, 3.3, 0, 2, 2.6, 2, 3.0, 4.0, 1.1, 1.5);
  windows(k, 7, 3.7, 0, 3, 2.2, 1, 12.9, 0, 1.2, 1.4);
  k.bar([7, 15.4, 0], [7, 27, 0], 0.4, '#82868c', 1); // the mast
  k.bar([4.6, 22, 0], [9.4, 22, 0], 0.2, '#82868c', 1); // cross arms
  k.bar([7, 25, -2.2], [7, 25, 2.2], 0.2, '#82868c', 1);
  k.bar([4.6, 22.2, 0], [4.6, 23.2, 0], 0.5, RIME, 1); // rime on the arms
  k.bar([9.4, 22.2, 0], [9.4, 23.2, 0], 0.5, RIME, 1);
  k.box(0.9, 0.5, 0.9, 7, 27, 0, '#d8d8d8', 0, 1); // anemometer
  for (const [gx, gz] of [[16, 8], [-2, 8], [16, -8], [-2, -8]] as const) k.bar([7, 19, 0], [gx, 0, gz], 0.1, '#6c6f74', 1);
  return finish(k.build());
}

/** Mount Diablo's summit: a sandstone building with a crenellated parapet, a round tower and a glass lantern with the beacon on top. */
export function buildDiabloSummit(): THREE.Group {
  const k = new Kit();
  const STONE = '#b69c74';
  k.box(20, 2, 12, 0, -2, 0, '#7d6f58');
  k.box(16, 6.5, 9, 0, 0, 0, STONE);
  k.box(16.6, 0.5, 9.6, 0, 6.5, 0, '#8d7a5c', 0, 1);
  // Merlons around the roof edge.
  for (let i = 0; i < 9; i++) for (const z of [-4.5, 4.5]) k.box(1.0, 0.9, 0.7, -7.2 + i * 1.8, 7.0, z, STONE, 0, 0.9);
  for (let i = 0; i < 5; i++) for (const x of [-7.7, 7.7]) k.box(0.7, 0.9, 1.0, x, 7.0, -3.6 + i * 1.8, STONE, 0, 0.9);
  k.cyl(3.7, 3.3, 7.2, -3, 7.0, 0, mix(STONE, '#a88f68', 0.4), 12); // the round tower
  k.cyl(4.0, 4.0, 0.7, -3, 14.2, 0, '#8d7a5c', 12, 1);
  k.box(2.2, 2.2, 2.2, -3, 14.9, 0, '#dbe9ee', 0, 1); // glass lantern
  k.pyramid(3.0, 3.0, 1.4, -3, 17.1, 0, '#4a3a30');
  k.box(0.6, 0.5, 0.9, -3, 15.7, 0, '#fff0a8', 0, 1); // the beacon lamps
  k.cyl(0.08, 0.04, 3.2, -3, 18.5, 0, '#6c6f74', 5, 1); // lightning rod
  windows(k, 0, 4.5, 0, 5, 2.8, 1, 2.2, 0, 1.0, 2.2);
  windows(k, 7.9, 0, Math.PI / 2, 3, 2.6, 1, 2.2, 0, 1.0, 2.2);
  k.box(2.0, 3.0, 0.3, 0, 0, 4.5, TIMBER_DARK, 0, 1);
  for (let i = 0; i < 4; i++) k.box(4 - i * 0.2, 0.25, 1.2, 0, i * 0.25, 5.4 + (3 - i) * 0.4, '#9a8e78', 0, 1); // steps
  return finish(k.build());
}

/** The stone ruins of a mountain-top summit house (Mount Blue Sky): broken walls of uneven height, a chimney stump, a doorway and steps, rubble. */
export function buildCrestHouseRuins(o: MonumentOptions = {}): THREE.Group {
  const seed = o.seed ?? 5;
  const k = new Kit();
  const W = 16, D = 10;
  k.box(W + 2, 0.4, D + 2, 0, 0, 0, '#6f6b64'); // the platform
  const tone = (i: number) => mix('#868075', '#a49e90', rnd(seed, 100 + i));
  let n = 0;
  // Perimeter walls in 2 m pieces, each a different height; some gone altogether.
  const piece = (x: number, z: number, along: 'x' | 'z') => {
    const r = rnd(seed, n++);
    if (r < 0.3) return;
    const h = 0.4 + (r - 0.3) * 2.6;
    k.box(along === 'x' ? 2.0 : 0.8, h, along === 'x' ? 0.8 : 2.0, x, 0.4, z, tone(n), (rnd(seed, 200 + n) - 0.5) * 0.06);
  };
  for (let x = -W / 2 + 1; x < W / 2; x += 2) { piece(x, -D / 2, 'x'); if (Math.abs(x) > 2) piece(x, D / 2, 'x'); }
  for (let z = -D / 2 + 3; z < D / 2 - 1; z += 2) { piece(-W / 2, z, 'z'); piece(W / 2, z, 'z'); }
  // The doorway at the front: two jambs and a lintel.
  k.box(0.9, 2.8, 0.9, -1.6, 0.4, D / 2, '#8c867a');
  k.box(0.9, 2.8, 0.9, 1.6, 0.4, D / 2, '#8c867a');
  k.box(4.2, 0.6, 1.0, 0, 3.2, D / 2, '#7f796d', 0.02);
  for (let i = 0; i < 4; i++) k.box(4.4 - i * 0.2, 0.18, 1.0, 0, 0.4 + i * 0.16, D / 2 + 3.6 - i * 0.9, '#7a766d', 0, 1); // steps
  k.box(2.4, 4.8, 2.0, 5.6, 0.4, -2.4, '#8f8a7e'); // chimney stump
  k.box(2.0, 0.9, 1.6, 5.6, 5.2, -2.4, '#7d786c', 0.05);
  // Rubble inside and around.
  for (let i = 0; i < 26; i++) {
    const s = 0.3 + rnd(seed, 300 + i) * 0.7;
    k.box(s, s * 0.6, s * 0.8, (rnd(seed, 400 + i) - 0.5) * (W + 4), 0.4, (rnd(seed, 500 + i) - 0.5) * (D + 4), tone(50 + i), rnd(seed, 600 + i) * 3);
  }
  return finish(k.build(), true);
}
