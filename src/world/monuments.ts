import * as THREE from 'three';
import { buildApartments, buildChalet, buildChurch, buildCrestHouseRuins, buildDiabloSummit, buildLogLodge, buildObservatory, buildPassBuildings, buildWashingtonSummit } from './monumentBuildings';
import { buildFlatirons } from './flatirons';
import { Kit, boardMaterial, finish, fitText } from './monumentKit';
import type { MonumentId, MonumentOptions } from './monumentTypes';

export type { MonumentId, MonumentOptions } from './monumentTypes';

// Landmarks built in code from primitives instead of loaded from GLB models (see
// landmarks.ts, which imports this file lazily the first time a stage needs one).
// Low-poly, flat-shaded and vertex-coloured like the trees: the silhouette and
// the colours matter at riding speed, the detail does not. Each builder returns a
// group standing on y = 0 with its front towards +z; landmarks.ts scales it to the
// kind's `size` (its height) and turns it to face the road.

// ------------------------------------------------------------------ signs ----

interface BoardLook { ground: string; ink: string; edge: string; wood: string }
const LOOKS: Record<NonNullable<MonumentOptions['style']>, BoardLook> = {
  fr: { ground: '#7b5232', ink: '#ffffff', edge: '#ffffff', wood: '#4a3322' }, // the brown tourist sign of a French col
  it: { ground: '#2c6a42', ink: '#ffffff', edge: '#ffffff', wood: '#4b4f55' }, // the green board of an Italian pass
  us: { ground: '#7d5230', ink: '#f2e3b3', edge: '#e0c98a', wood: '#5a3b20' }, // a routed wooden park sign
};

/** The face of a summit board: the words in two lines (the name, then the altitude), with a border. */
function boardFace(look: BoardLook, lines: string[], w: number, h: number) {
  return boardMaterial(`${look.ground}|${lines.join('|')}`, w, h, (g, pw, ph) => {
    g.fillStyle = look.ground;
    g.fillRect(0, 0, pw, ph);
    g.strokeStyle = look.edge;
    g.lineWidth = 8;
    g.strokeRect(14, 14, pw - 28, ph - 28);
    g.fillStyle = look.ink;
    if (lines.length === 1) fitText(g, lines[0], pw / 2, ph / 2, pw - 80, 80);
    else {
      fitText(g, lines[0], pw / 2, ph * 0.36, pw - 80, 68);
      fitText(g, lines.slice(1).join('  '), pw / 2, ph * 0.7, pw - 80, 78);
    }
  }, look.ground);
}

/** The summit board at the top of a European climb: a plank sign on two posts. */
export function buildColSign(o: MonumentOptions = {}): THREE.Group {
  const look = LOOKS[o.style ?? 'fr'];
  const lines = o.lines ?? ['COL', 'ALT.'];
  const k = new Kit();
  const W = 2.5, H = 1.1, y0 = 1.35;
  for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) k.box(0.14, y0 + H + 0.1, 0.14, x, 0, -0.06, look.wood);
  k.box(W, H, 0.08, 0, y0, 0, look.wood, 0, 1); // the board's edge and back
  k.panel(W - 0.04, H - 0.04, 0, y0 + H / 2, 0.045, boardFace(look, lines, 512, 224));
  return finish(k.build());
}

/** A brown wooden park sign (US Forest Service or National Park Service style): chunky timbers, routed cream letters. */
export function buildSummitSignUs(o: MonumentOptions = {}): THREE.Group {
  const look = LOOKS.us;
  const lines = o.lines ?? ['SUMMIT', 'ELEVATION'];
  const k = new Kit();
  const W = 3.0, H = 1.35, y0 = 1.0;
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) {
    k.cyl(0.14, 0.13, y0 + H + 0.45, x, 0, -0.1, look.wood, 7); // log posts
  }
  k.box(W + 0.3, 0.14, 0.34, 0, y0 + H, -0.08, look.wood, 0, 1); // the cap rail
  k.box(W, H, 0.12, 0, y0, 0, '#7d5330', 0, 0.95); // the plank
  k.box(W + 0.12, 0.1, 0.16, 0, y0 - 0.05, 0, look.wood, 0, 1); // lower rail
  k.panel(W - 0.1, H - 0.1, 0, y0 + H / 2, 0.065, boardFace(look, lines, 512, 240));
  return finish(k.build());
}

// ----------------------------------------------------------- memorials ----

const STONE = '#8f8c85';
const STONE_LIGHT = '#a7a39a';

/** Tom Simpson's memorial on Mont Ventoux: a grey granite stele on a stepped stone base, with a plaque and a cairn of stones left by riders. */
export function buildSimpsonMemorial(o: MonumentOptions = {}): THREE.Group {
  const lines = o.lines ?? ['TOM SIMPSON', '1937 – 1967'];
  const k = new Kit();
  k.box(2.6, 0.3, 1.5, 0, 0, 0, '#79766f'); // the foot
  k.box(2.0, 0.3, 1.1, 0, 0.3, 0, STONE);
  k.box(1.1, 2.0, 0.42, 0, 0.6, 0, STONE_LIGHT, 0, 0.82); // the stele
  k.pyramid(1.1, 0.42, 0.28, 0, 2.6, 0, STONE_LIGHT); // its cap
  k.box(0.78, 0.5, 0.03, 0, 1.15, 0.215, '#2e2a24', 0, 1); // the plaque's mount
  k.panel(0.72, 0.44, 0, 1.4, 0.235, boardMaterial(`simpson|${lines.join('|')}`, 256, 156, (g, w, h) => {
    g.fillStyle = '#3a3226';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b8a063';
    g.lineWidth = 4;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#e2cf93';
    fitText(g, lines[0], w / 2, h * 0.38, w - 40, 36);
    fitText(g, lines.slice(1).join(' '), w / 2, h * 0.68, w - 40, 30, 700);
  }, '#3a3226'));
  // The cairn at the foot: stones and bottles riders have left, a few small blocks of different grey.
  const cairn: [number, number, number, number, string][] = [
    [0.34, 0.2, -0.78, 0.82, '#b3afa5'], [0.27, 0.16, -0.5, 0.9, '#8a867d'], [0.3, 0.22, 0.62, 0.84, '#a09c92'],
    [0.22, 0.15, 0.92, 0.78, '#c1bdb2'], [0.2, 0.14, -0.2, 0.96, '#948f85'], [0.26, 0.18, 0.2, 0.92, '#b7b2a6'],
  ];
  for (const [w, h, x, z, c] of cairn) k.box(w, h, w * 0.8, x, 0, z, c, x * 2);
  return finish(k.build());
}

// ---------------------------------------------------------------- Le Géant ----

/** Le Géant du Tourmalet: a dark steel cyclist, out of the saddle and straining up the col, on a stone plinth. He rides towards -x, so he climbs in the direction of travel when he stands on the right of the road. */
export function buildGeant(): THREE.Group {
  const k = new Kit();
  const S = 3.5; // the statue is this many times life size
  const PLINTH = 1.4;
  k.box(5.6, 0.6, 2.8, 0, 0, 0, '#7f7c75');
  k.box(4.6, 0.8, 2.1, 0, 0.6, 0, '#9a968d');
  const STEEL = '#2c3036';
  const STEEL_LIGHT = '#3f454d';
  const P = (u: number, v: number, z = 0): [number, number, number] => [-u * S, v * S, z * S];
  k.within([0, PLINTH + 0.14, 0], [0, 0, -0.07], () => {
    // The bike: two wheels and the frame between them.
    for (const u of [-0.5, 0.5]) {
      const [x, y] = P(u, 0.34);
      k.ring(0.34 * S, 0.03 * S, x, y, 0, STEEL, 18);
      k.cyl(0.05 * S, 0.05 * S, 0.1 * S, x, y - 0.05 * S, 0, STEEL_LIGHT, 6);
    }
    const t = 0.035 * S;
    const bb = P(0, 0.27), seat = P(-0.12, 0.95), headTop = P(0.37, 0.9), headBot = P(0.43, 0.65);
    k.bar(bb, seat, t, STEEL);
    k.bar(bb, headBot, t * 1.3, STEEL);
    k.bar(seat, headTop, t, STEEL);
    k.bar(P(-0.5, 0.34), seat, t * 0.7, STEEL);
    k.bar(P(-0.5, 0.34), bb, t * 0.7, STEEL);
    k.bar(headBot, P(0.5, 0.34), t * 0.8, STEEL);
    k.bar(headTop, P(0.42, 1.0), t, STEEL);
    k.bar(P(0.4, 1.0, -0.2), P(0.4, 1.0, 0.2), t, STEEL); // the bars
    k.bar(P(0.4, 1.0, 0.2), P(0.6, 0.9, 0.17), t * 0.8, STEEL);
    k.bar(P(0.4, 1.0, -0.2), P(0.6, 0.9, -0.17), t * 0.8, STEEL);
    k.bar(P(-0.2, 0.98), P(-0.04, 0.98), t * 1.4, STEEL_LIGHT); // saddle
    // The rider, standing on the pedals and hauling on the bars.
    const hip = P(-0.12, 1.1), shoulder = P(0.27, 1.42), head = P(0.37, 1.52);
    k.bar(hip, shoulder, 0.14 * S, STEEL_LIGHT);
    k.bar(shoulder, head, 0.08 * S, STEEL_LIGHT); // neck
    k.cyl(0.095 * S, 0.085 * S, 0.19 * S, head[0], head[1] - 0.06 * S, 0, STEEL_LIGHT, 7); // head and helmet
    for (const side of [1, -1]) {
      k.bar(shoulder, P(0.46, 1.17, side * 0.2), 0.07 * S, STEEL_LIGHT); // upper arm
      k.bar(P(0.46, 1.17, side * 0.2), P(0.6, 0.9, side * 0.17), 0.06 * S, STEEL_LIGHT); // forearm
    }
    // Legs: one pedal down, one up. Cranks, thighs, shins.
    k.bar(bb, P(0, 0.09, 0.14), t * 0.8, STEEL);
    k.bar(bb, P(0, 0.45, -0.14), t * 0.8, STEEL);
    k.bar(hip, P(0.11, 0.68, 0.1), 0.1 * S, STEEL_LIGHT);
    k.bar(P(0.11, 0.68, 0.1), P(0.01, 0.13, 0.12), 0.08 * S, STEEL_LIGHT);
    k.bar(hip, P(0.24, 0.98, -0.1), 0.1 * S, STEEL_LIGHT);
    k.bar(P(0.24, 0.98, -0.1), P(0.08, 0.5, -0.12), 0.08 * S, STEEL_LIGHT);
  });
  return finish(k.build());
}

// --------------------------------------------------------------- registry ----

const BUILDERS: Record<MonumentId, (o: MonumentOptions) => THREE.Group> = {
  'ventoux-observatory': buildObservatory,
  'simpson-memorial': buildSimpsonMemorial,
  chalet: buildChalet,
  'alpine-church': buildChurch,
  'ski-apartments': buildApartments,
  'geant-tourmalet': buildGeant,
  'pass-buildings': buildPassBuildings,
  'col-sign': buildColSign,
  'log-lodge': buildLogLodge,
  flatirons: (o) => buildFlatirons(o),
  'washington-summit': buildWashingtonSummit,
  'diablo-summit': buildDiabloSummit,
  'crest-house-ruins': buildCrestHouseRuins,
  'summit-sign-us': buildSummitSignUs,
};

export const MONUMENT_IDS = Object.keys(BUILDERS) as MonumentId[];

/** Builds a monument. Its height is its natural size in metres; landmarks.ts scales it to the kind's `size`. */
export function buildMonument(id: MonumentId, options: MonumentOptions = {}): THREE.Group {
  return BUILDERS[id](options);
}
