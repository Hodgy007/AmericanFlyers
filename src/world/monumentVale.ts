import * as THREE from 'three';
import { Kit, boardMaterial, finish, fitText, mix, rnd } from './monumentKit';
import { VALE_ARCH, VIADUCT } from './monumentTypes';
import type { MonumentOptions } from './monumentTypes';
import { VILLAGE_BASE, VILLAGE_DEPTH, VILLAGE_FLOOR, eaveOf, planVillageTerrace } from './terracePlan';

// The code-built dressing of Kestrel Vale (worlds/kestrelVale.ts): the market cross in the Hollins Cross square, the stone viaduct across a gill in Foss
// Bottom (seen from the Raven Scar climb) and the jetty on Kestrel Water with its moored boats. Low-poly, flat-shaded and vertex-coloured like the other
// monuments (monumentKit.ts); each builder stands on y = 0 and faces +z, and the stage scales it to the kind's `size`, its natural height.
// Also here: the village's start/finish arch and the varied terrace rows of the high street.

const LIME = '#8e8878';
const LIME_DARK = '#6a6558';
const LIME_LIGHT = '#aaa593';

// ----------------------------------------------------------- market cross ----

/** A village market cross: a stepped base, a tapering stone shaft and a small cross head. About 330 triangles. */
export function buildMarketCross(): THREE.Group {
  const k = new Kit();
  const steps: [number, number][] = [[5.2, 0.3], [4.2, 0.3], [3.2, 0.3]];
  let y = 0;
  steps.forEach(([w, h], i) => { k.box(w, h, w, 0, y - (i === 0 ? 0.2 : 0), 0, i % 2 ? LIME : LIME_DARK, 0, 0.92); y += h; });
  k.box(1.7, 0.95, 1.7, 0, y, 0, LIME_DARK, 0, 0.88); // the plinth
  y += 0.95;
  k.box(1.25, 0.18, 1.25, 0, y, 0, LIME_LIGHT, 0, 1); // its cap
  y += 0.18;
  k.cyl(0.46, 0.28, 3.7, 0, y, 0, LIME, 8, 0.86); // the shaft
  y += 3.7;
  k.box(0.95, 0.3, 0.95, 0, y, 0, LIME_LIGHT, 0, 1); // the capital
  y += 0.3;
  k.box(0.46, 2.1, 0.46, 0, y, 0, LIME, 0, 1); // the cross: its upright
  k.box(2.2, 0.48, 0.46, 0, y + 1.1, 0, LIME, 0, 1); // its arms, a third of the way down
  k.box(0.7, 0.2, 0.7, 0, y + 1.02, 0, LIME_LIGHT, 0, 1); // a boss where they cross
  k.pyramid(0.46, 0.46, 0.3, 0, y + 2.1, 0, LIME_LIGHT);
  return finish(k.build());
}

// -------------------------------------------------------------- viaduct ----

const R = VIADUCT.span / 2; // each arch's radius
const WALL_TOP = VIADUCT.deck - 1.0; // under the deck slab
const SPRING = WALL_TOP - R - 2.5; // the springing line: the arches' feet, the piers' tops
const DECK_W = 6.2;

/** A semicircular arch opening cut in a wall `module` wide, as one outline standing on the springing line (a notch in the foot, the arch drawn as 12 straight edges). */
function bayOutline(): THREE.Shape {
  const half = VIADUCT.module / 2;
  const s = new THREE.Shape();
  s.moveTo(-half, 0);
  s.lineTo(-R, 0);
  for (let i = 1; i <= 11; i++) {
    const a = Math.PI - (Math.PI * i) / 12;
    s.lineTo(Math.cos(a) * R, Math.sin(a) * R);
  }
  s.lineTo(R, 0);
  s.lineTo(half, 0);
  s.lineTo(half, WALL_TOP - SPRING);
  s.lineTo(-half, WALL_TOP - SPRING);
  s.closePath();
  return s;
}

/**
 * A stone railway-style viaduct: `options.bays` (default 13) round arches of 12 m on tapering piers, a deck 6 m wide with a parapet and pilasters, 195 m
 * long, its deck 19 m above the origin. Its length lies along x and it faces +z. `options.ground` gives the ground's height (m, relative to the origin) at
 * each of the bays + 1 pier positions, so a pier is built down to the land (3 m below it) and none where the land is above the springing line.
 * Without it the ground is a bowl, 0 under the middle and rising to the deck's height at the ends. About 1,500 triangles.
 */
export function buildViaduct(o: MonumentOptions = {}): THREE.Group {
  const bays = o.bays ?? VIADUCT.bays;
  const length = bays * VIADUCT.module;
  const x0 = -length / 2;
  const ground = (i: number) => o.ground?.[i] ?? VIADUCT.deck * Math.pow(Math.abs((i - bays / 2) / (bays / 2)), 2.2);
  const k = new Kit();
  const outline = bayOutline();
  for (let b = 0; b < bays; b++) {
    const cx = x0 + (b + 0.5) * VIADUCT.module;
    k.slab(outline, DECK_W - 0.4, cx, SPRING, mix(LIME, LIME_DARK, 0.12 * rnd(3, b)), 0.8);
  }
  for (let i = 0; i <= bays; i++) {
    const px = x0 + i * VIADUCT.module;
    const g = ground(i);
    if (g < SPRING - 0.5) {
      // A pier: tapering, built from three metres under the land to the springing line.
      const base = g - 3;
      k.taper(VIADUCT.module - VIADUCT.span + 0.8, DECK_W - 0.6, SPRING - base, 0.86, px, base, 0, mix(LIME_DARK, LIME, 0.2 * rnd(5, i)), 0.8);
    }
  }
  // The cornice under the deck, the deck, the parapets with their coping and a pilaster over each pier.
  k.box(length + 0.4, 0.4, DECK_W + 0.5, 0, WALL_TOP - 0.4, 0, LIME_LIGHT, 0, 1);
  k.box(length + 0.2, 0.6, DECK_W, 0, WALL_TOP, 0, LIME_DARK, 0, 1);
  for (const z of [-1, 1]) {
    k.box(length + 0.2, 0.95, 0.5, 0, VIADUCT.deck, z * (DECK_W / 2 - 0.25), LIME, 0, 1);
    k.box(length + 0.4, 0.14, 0.7, 0, VIADUCT.deck + 0.95, z * (DECK_W / 2 - 0.25), LIME_LIGHT, 0, 1);
    for (let i = 0; i <= bays; i++) k.box(0.9, SPRING < WALL_TOP ? WALL_TOP - SPRING + 0.3 : 1, 0.5, x0 + i * VIADUCT.module, SPRING, z * (DECK_W / 2 + 0.1), LIME_DARK, 0, 0.9);
  }
  return finish(k.build());
}

// ----------------------------------------------------------------- jetty ----

const JETTY_LENGTH = 24;
const WOOD = '#7a6246';
const WOOD_DARK = '#4f3f2c';
const WOOD_LIGHT = '#9a8260';

/**
 * A row boat's or dinghy's hull lying along x (bow at +x), `length` long and `beam` wide, its keel at y = 0 and its gunwale `depth` above: lofted from
 * nine stations, an outside painted `paint`, an inside of bare wood and a rim, built open so it reads as a boat from above. About 150 triangles.
 */
function hull(length: number, beam: number, depth: number, paint: string, inside: string, rim: string): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const N = 8;
  const c = (hex: string) => new THREE.Color(hex);
  const stations = Array.from({ length: N + 1 }, (_, i) => {
    const u = -1 + (2 * i) / N; // -1 at the stern, +1 at the bow
    const w = 0.5 * beam * Math.max(0.1, Math.pow(1 - u * u, 0.55)) * (u < -0.95 ? 0.9 : 1) + (u < -0.9 ? 0.18 * beam : 0);
    const half = Math.min(0.5 * beam, w);
    return { x: (u * length) / 2, half, gun: depth * (1 + 0.28 * u * u), keel: 0.1 * depth * u * u };
  });
  const quad = (a: number[], b: number[], cc: number[], d: number[], color: THREE.Color, shade: number) => {
    for (const t of [a, b, cc, a, cc, d]) { pos.push(...t); col.push(color.r * shade, color.g * shade, color.b * shade); }
  };
  const paintC = c(paint), inC = c(inside), rimC = c(rim);
  for (let i = 0; i < N; i++) {
    const s = stations[i], t = stations[i + 1];
    for (const side of [1, -1]) {
      // Outside: keel -> chine -> gunwale (winding so the normals face out), inside: gunwale -> floor, then the rim across the top.
      const P = (st: typeof s, h: number, f: number): number[] => [st.x, h, side * st.half * f];
      const chineY = (st: typeof s) => st.keel + 0.3 * depth;
      const outer = [
        [P(s, s.keel, 0), P(t, t.keel, 0), P(t, chineY(t), 0.7), P(s, chineY(s), 0.7)],
        [P(s, chineY(s), 0.7), P(t, chineY(t), 0.7), P(t, t.gun, 1), P(s, s.gun, 1)],
      ];
      for (const q of outer) {
        if (side > 0) quad(q[3], q[2], q[1], q[0], paintC, 1);
        else quad(q[0], q[1], q[2], q[3], paintC, 0.92);
      }
      const inner = [P(s, s.gun - 0.02, 0.9), P(t, t.gun - 0.02, 0.9), P(t, s.keel + 0.26 * depth, 0.35), P(s, s.keel + 0.26 * depth, 0.35)];
      if (side > 0) quad(inner[0], inner[1], inner[2], inner[3], inC, 0.95);
      else quad(inner[3], inner[2], inner[1], inner[0], inC, 0.85);
      const top = [P(s, s.gun, 1), P(t, t.gun, 1), P(t, t.gun - 0.02, 0.9), P(s, s.gun - 0.02, 0.9)];
      if (side > 0) quad(top[3], top[2], top[1], top[0], rimC, 1);
      else quad(top[0], top[1], top[2], top[3], rimC, 1);
    }
    // The floor, between the two inner lines.
    quad([s.x, s.keel + 0.26 * depth, -0.35 * s.half], [t.x, t.keel + 0.26 * depth, -0.35 * t.half], [t.x, t.keel + 0.26 * depth, 0.35 * t.half], [s.x, s.keel + 0.26 * depth, 0.35 * s.half], inC, 0.8);
  }
  // The transom: close the stern.
  const s0 = stations[0];
  quad([s0.x, s0.keel, -s0.half * 0.1], [s0.x, s0.keel, s0.half * 0.1], [s0.x, s0.gun, s0.half], [s0.x, s0.gun, -s0.half], paintC, 0.85);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A double-sided triangle (a sail), as a geometry with its own colours. */
function sail(a: [number, number, number], b: [number, number, number], c: [number, number, number], color: string): THREE.BufferGeometry {
  const col = new THREE.Color(color);
  const pos = [...a, ...b, ...c, ...a, ...c, ...b];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 6 }, () => [col.r, col.g, col.b]).flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A wooden jetty on piles, 24 m long, running out from the shore along +z with its deck 0.75 m above the water (the origin, y = 0, is the water's
 * surface; the piles go 3.5 m down), with two rowing boats moored along its east side and a dinghy with a cream sail at its end. About 1,700 triangles.
 */
export function buildJetty(): THREE.Group {
  const k = new Kit();
  const L = JETTY_LENGTH;
  const DECK = 0.75;
  // Piles: two rows, every 3 m, a few standing proud of the deck as mooring posts.
  for (let i = 0; i <= 8; i++) {
    for (const sx of [-1, 1]) {
      const proud = i % 4 === 0 ? 0.6 : 0.1;
      k.cyl(0.15, 0.13, 3.5 + DECK + proud, sx * 1.0, -3.5, 0.5 + i * 3, i % 2 ? WOOD_DARK : WOOD, 6, 0.8);
    }
  }
  for (const sx of [-1, 1]) k.box(0.2, 0.28, L, sx * 0.95, DECK - 0.5, L / 2, WOOD_DARK, 0, 0.95); // the stringers
  // The decking: boards across, a gap between each.
  for (let i = 0; i < 22; i++) k.box(2.5, 0.09, 0.92, 0, DECK - 0.1, 0.55 + i * 1.09, i % 3 === 0 ? WOOD_LIGHT : WOOD, 0, 1);
  // The end: a rail with posts, and a ladder down into the water on the west side.
  for (const sx of [-1, 1]) k.box(0.1, 0.9, 0.1, sx * 1.1, DECK, L - 0.4, WOOD_DARK, 0, 1);
  k.box(2.4, 0.08, 0.1, 0, DECK + 0.85, L - 0.4, WOOD_DARK, 0, 1);
  k.bar([-1.28, DECK, 6], [-1.28, -1.2, 6.1], 0.07, '#9aa0a6');
  // Two row boats alongside, east of the jetty, their bows towards the shore... (a boat lies along x: turned a quarter, its bow to -z).
  const boats: [number, number, number, string][] = [[2.55, 8.6, 0.06, '#2f6f8f'], [2.6, 15.2, -0.05, '#b5472f']];
  for (const [bx, bz, yaw, paint] of boats) {
    k.within([bx, -0.3, bz], [0, Math.PI / 2 + yaw, 0], () => {
      k.raw(hull(3.7, 1.35, 0.62, paint, WOOD_LIGHT, WOOD_DARK));
      for (const tx of [-0.6, 0.55]) k.box(0.28, 0.07, 1.2, tx, 0.28, 0, WOOD, 0, 1); // thwarts
      for (const side of [1, -1]) k.bar([0.1, 0.5, side * 0.55], [-0.2, 0.2, side * 1.75], 0.05, WOOD_LIGHT); // oars, shipped
    });
    k.bar([0.95, DECK + 0.3, bz - 1.5], [bx - 0.1, 0.1, bz - 1.7], 0.03, '#d2c6a8'); // a painter from the mooring post to the bow
  }
  // The dinghy at the end, west side, mast up and a cream sail.
  k.within([-2.7, -0.32, 21], [0, Math.PI / 2 - 0.1, 0], () => {
    k.raw(hull(4.2, 1.5, 0.68, '#e8e4d6', WOOD_LIGHT, WOOD));
    k.cyl(0.07, 0.04, 5.2, 0.5, 0.2, 0, WOOD_LIGHT, 6, 1); // the mast
    k.bar([0.5, 0.95, 0], [-1.6, 0.95, 0], 0.07, WOOD_LIGHT); // the boom
    k.raw(sail([0.45, 1.05, 0], [0.45, 5.1, 0], [-1.55, 1.05, 0], '#efe8d2'));
    k.box(0.5, 0.07, 1.3, 0.2, 0.3, 0, WOOD, 0, 1);
  });
  k.bar([-1.1, DECK + 0.3, 20.0], [-2.1, 0.05, 20.2], 0.03, '#d2c6a8');
  return finish(k.build());
}

// ------------------------------------------------------------------ arch ----

const OAK = '#5a4026';
const OAK_LIGHT = '#7a5a38';
const ARCH_BOARD = '#24402f'; // bottle green, like a village hall's paintwork
const ARCH_TRIM = '#e9dfbd';
const FLAGS = ['#d8432f', '#f3efe2', '#2f5fa8', '#e8b93a', '#3b8f4f'];

/** The painted board of the arch: the place (small, above) and the word (large), cream on bottle green with a gold rule. */
function archFace(lines: string[], w: number, h: number) {
  return boardMaterial(`vale-arch|${lines.join('|')}`, 1536, Math.round(1536 * h / w), (g, pw, ph) => {
    g.fillStyle = ARCH_BOARD;
    g.fillRect(0, 0, pw, ph);
    g.strokeStyle = '#c9a24a';
    g.lineWidth = 6;
    g.strokeRect(12, 8, pw - 24, ph - 16);
    g.fillStyle = ARCH_TRIM;
    if (lines.length < 2) fitText(g, lines[0] ?? '', pw / 2, ph / 2, pw - 160, ph * 0.62, 800, 'Georgia, serif');
    else {
      fitText(g, lines[0], pw / 2, ph * 0.27, pw - 200, ph * 0.3, 700, 'Georgia, serif');
      fitText(g, lines.slice(1).join('  '), pw / 2, ph * 0.66, pw - 200, ph * 0.5, 800, 'Georgia, serif');
    }
  }, ARCH_BOARD);
}

/** A double-sided triangle with its own colour (a pennant or a bunting flag). */
function flag(a: [number, number, number], b: [number, number, number], c: [number, number, number], color: string): THREE.BufferGeometry {
  const col = new THREE.Color(color);
  const pos = [...a, ...b, ...c, ...a, ...c, ...b];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 6 }, () => [col.r, col.g, col.b]).flat(), 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The village race arch: two stout limestone piers on plinths either side of the road (their outer faces just inside where the spectators stand), an oak beam between them
 * with a painted board in front (`options.lines`: the place, then the word: START, FINISH or the sprint's name) edged top and bottom with chequered trim, braces under the beam, a pole
 * on each pier and a string of bunting between the poles. The board is on both faces. The clear opening is 9.9 m wide and 4.7 m high under the board. About 1,300 triangles.
 * Spans the road along x (centred), faces +z; its natural height (VALE_ARCH.height, the pole tops) is the landmark's `size`.
 */
export function buildValeArch(o: MonumentOptions = {}): THREE.Group {
  const lines = o.lines ?? ['HOLLINS CROSS', 'START'];
  const k = new Kit();
  const { pier, bottom, boardH } = VALE_ARCH;
  const inner = pier - 0.5; // the pier's inner face at the shaft's foot
  const boardW = 2 * inner - 0.1;
  const top = bottom + boardH;
  for (const s of [-1, 1]) {
    const x = s * pier;
    k.box(1.15, 0.85, 1.15, x, -0.3, 0, LIME_DARK, 0, 0.8); // the plinth, set a little into the ground
    k.taper(1.0, 1.0, top + 0.1 - 0.55, 0.86, x, 0.55, 0, LIME, 0.82); // the shaft, tapering
    for (const y of [1.9, 3.5]) k.box(1.0, 0.14, 1.0, x, y, 0, LIME_LIGHT, 0, 1); // two string courses
    k.box(1.15, 0.26, 1.15, x, top + 0.1, 0, LIME_LIGHT, 0, 1); // the cap
    k.pyramid(1.1, 1.1, 0.6, x, top + 0.36, 0, LIME);
    k.cyl(0.07, 0.045, VALE_ARCH.height - (top + 0.9), x, top + 0.9, 0, OAK_LIGHT, 6, 1); // the pole
    k.ball(0.09, x, VALE_ARCH.height - 0.09, 0, '#c9a24a', 1, 1, 1, 1); // its finial
    // A pennant streaming outwards from the pole's top.
    k.raw(flag([x, VALE_ARCH.height - 0.15, 0], [x, VALE_ARCH.height - 0.65, 0], [x + s * 1.0, VALE_ARCH.height - 0.4, 0.05], s < 0 ? '#d8432f' : '#2f5fa8'));
  }
  // The beam, behind the board, and the braces under it.
  k.box(2 * pier, 0.55, 0.55, 0, bottom, -0.1, OAK, 0, 0.9);
  for (const s of [-1, 1]) {
    k.bar([s * (inner + 0.1), bottom - 1.1, 0.05], [s * (inner - 1.4), bottom, 0.05], 0.26, OAK_LIGHT);
    k.bar([s * (inner + 0.1), bottom - 1.1, -0.25], [s * (inner - 1.4), bottom, -0.25], 0.26, OAK_LIGHT);
  }
  // The board and its chequered trim, on both faces.
  k.box(boardW, boardH, 0.22, 0, bottom, 0.25, ARCH_BOARD, 0, 0.95);
  const SQ = 0.45, COLS = Math.round(boardW / SQ);
  const sq = boardW / COLS;
  for (const face of [1, -1]) {
    const z = face > 0 ? 0.36 + 0.05 : 0.14 - 0.05;
    for (const y of [bottom, top - 0.4]) {
      k.box(boardW, 0.4, 0.1, 0, y, z, '#f4f1e6', 0, 1);
      for (let c = 0; c < COLS; c++) {
        if ((c + (y === bottom ? 0 : 1)) % 2 === 0) k.box(sq, 0.4, 0.12, -boardW / 2 + sq * (c + 0.5), y, z, '#1b1b1b', 0, 1);
      }
    }
  }
  const faceH = boardH - 0.8; // between the two strips
  k.panel(boardW - 0.1, faceH, 0, bottom + 0.4 + faceH / 2, 0.365 + 0.02, archFace(lines, boardW - 0.1, faceH));
  k.panel(boardW - 0.1, faceH, 0, bottom + 0.4 + faceH / 2, 0.135 - 0.02, archFace(lines, boardW - 0.1, faceH), Math.PI);
  // Bunting between the poles: a cord sagging 0.9 m with a flag hung from each of its pieces.
  const y0 = VALE_ARCH.height - 0.2, SAG = 0.9, N = 16;
  const at = (t: number): [number, number, number] => [-pier + 2 * pier * t, y0 - SAG * (1 - (2 * t - 1) ** 2), 0];
  for (let i = 0; i < N; i++) {
    const a = at(i / N), b = at((i + 1) / N);
    k.bar(a, b, 0.04, '#4a4338');
    const m = at((i + 0.5) / N);
    k.raw(flag([m[0] - 0.22, m[1] - 0.02, 0.02], [m[0] + 0.22, m[1] - 0.02, 0.02], [m[0], m[1] - 0.58, 0.02], FLAGS[i % FLAGS.length]));
  }
  return finish(k.build());
}

// ------------------------------------------------------------- terraces ----

const STONES = ['#a39b8a', '#b3ab98', '#9a9484', '#bdb6a3', '#8f8a7c', '#aaa38f'];
const RENDER = '#e6dfca';
const DOOR_COLOURS = ['#2f4a3a', '#5a2a2a', '#1f2f4a', '#3a3a3a', '#6a4a2a', '#a8452f', '#b08a2e', '#2f5f5a', '#e8e4da'];
const FRAME_COLOURS = ['#e8e4da', '#d6cfb8', '#2f4a3a', '#3b4f6a', '#6b2f2f', '#c9b98a'];
const SLATES = ['#4b4f57', '#5b5750', '#3f444c'];
const GLASS = '#364451';

/**
 * One row of the village's stone terraces, laid out by `planVillageTerrace(options.seed)` (terracePlan.ts): four to six houses of two or three storeys, an
 * occasional low cottage with a dormer at one end, a ginnel between two houses, or a shopfront with an awning, each with its own door side, door colour and window frames,
 * neighbours of the same height under one roof so the ridge steps, and chimneys at the ends and over the party walls. About 1,400 triangles. Its natural height varies
 * with the row (`villageTerraceHeight`), so the kind's `size` is set from it.
 */
export function buildVillageTerrace(o: MonumentOptions = {}): THREE.Group {
  const plan = planVillageTerrace(o.seed ?? 1);
  const D = VILLAGE_DEPTH, F = VILLAGE_FLOOR, B = VILLAGE_BASE;
  const k = new Kit();
  const colourOf = (h: (typeof plan.houses)[number]) => (h.render ? mix(STONES[h.stone], RENDER, 0.7) : STONES[h.stone]);
  for (const h of plan.houses) {
    const col = colourOf(h);
    const cx = h.x0 + h.w / 2;
    const eave = eaveOf(h.storeys);
    k.box(h.w, eave, D, cx, 0, 0, col, 0, 0.84);
    const doorX = h.doorLeft ? h.x0 + 1.15 : h.x0 + h.w - 1.15;
    const otherX = h.doorLeft ? h.x0 + h.w - 1.5 : h.x0 + 1.5;
    const frame = FRAME_COLOURS[h.frame];
    const doorCol = DOOR_COLOURS[h.door];
    k.box(1.6, 0.4, 1.3, doorX, 0, D / 2 + 0.55, '#a9a49a', 0, 1); // the step
    k.box(1.2, 2.4, 0.12, doorX, B, D / 2 + 0.02, doorCol, 0, 1); // the door
    k.box(1.5, 0.18, 0.2, doorX, B + 2.4, D / 2 + 0.04, mix(col, '#ffffff', 0.4), 0, 1); // its lintel
    const window = (x: number, y: number) => {
      k.box(1.35, 1.95, 0.1, x, y - 0.12, D / 2 + 0.01, frame, 0, 1);
      k.box(1.0, 1.6, 0.14, x, y + 0.05, D / 2 + 0.02, GLASS, 0, 1);
      k.box(1.5, 0.2, 0.2, x, y + 1.83, D / 2 + 0.04, mix(col, '#ffffff', 0.4), 0, 1); // a stone lintel
    };
    if (h.shop) {
      const ww = h.w - 2.7;
      const wx = h.doorLeft ? h.x0 + 2.3 + ww / 2 : h.x0 + 0.4 + ww / 2;
      k.box(ww + 0.3, 2.3, 0.1, wx, B, D / 2 + 0.01, frame, 0, 1); // the shop window's surround
      k.box(ww, 2.0, 0.14, wx, B + 0.15, D / 2 + 0.03, '#2c3b46', 0, 1);
      k.box(h.w - 0.3, 0.5, 0.26, cx, B + 2.55, D / 2 + 0.06, DOOR_COLOURS[(h.door + 3) % DOOR_COLOURS.length], 0, 1); // the fascia
      // The awning: cloth stripes in two colours, sloping out and down over the window.
      const stripes = Math.max(3, Math.round(ww / 0.8));
      const sw = (ww + 0.3) / stripes;
      for (let i = 0; i < stripes; i++) {
        k.within([wx - (ww + 0.3) / 2 + sw * (i + 0.5), B + 2.5, D / 2 + 0.1], [-0.5, 0, 0], () => k.box(sw, 0.05, 1.15, 0, 0, 0.55, i % 2 ? '#f1ecda' : DOOR_COLOURS[(h.door + 3) % DOOR_COLOURS.length], 0, 1));
      }
    } else {
      window(otherX, B + 0.7);
    }
    for (let s = 1; s < Math.min(h.storeys, 3); s++) {
      const y = B + s * F + 0.7;
      window(doorX, y);
      window(otherX, y);
    }
    if (h.storeys === 1) {
      // A dormer in the roof over the middle of the front, with its own little gable.
      const dx = cx;
      k.box(1.4, 1.3, 1.4, dx, eave - 0.1, D / 2 - 1.6, col, 0, 0.9);
      k.gable(1.6, 1.8, 0.7, dx, eave + 1.2, D / 2 - 1.6, SLATES[1], mix(col, '#000000', 0.1), Math.PI / 2);
      k.box(0.8, 0.8, 0.1, dx, eave + 0.1, D / 2 - 0.88, GLASS, 0, 1);
    }
  }
  for (const run of plan.runs) {
    const len = run.x1 - run.x0;
    const cx = (run.x0 + run.x1) / 2;
    k.box(len + 0.6, 0.25, D + 0.9, cx, run.eave - 0.1, 0, '#d6d1c4', 0, 1); // the cornice
    k.gable(len + 0.4, D + 0.6, run.rise, cx, run.eave, 0, SLATES[run.slate], mix(colourOf(plan.houses[run.i0]), '#000000', 0.1));
  }
  for (const c of plan.chimneys) {
    const col = colourOf(plan.houses[0]);
    k.box(0.9, c.top - c.ridge + 0.3 - 0.15, 0.9, c.x, c.ridge - 0.3, -0.4, mix(col, '#000000', 0.2), 0, 1);
    k.box(1.1, 0.15, 1.1, c.x, c.top - 0.15, -0.4, '#8a847a', 0, 1); // the cap
  }
  return finish(k.build());
}
