import * as THREE from 'three';
import { buildApartments, buildChalet, buildChurch, buildCrestHouseRuins, buildDiabloSummit, buildLogLodge, buildObservatory, buildPassBuildings, buildWashingtonSummit, buildWashingtonTower } from './monumentBuildings';
import { buildFlatirons } from './flatirons';
import { buildBixbyBridge, buildCapitol, buildSkyline, buildTerrace } from './monumentCity';
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

/** Polished steel: metallic enough to catch the sun, matt enough not to need an environment map. */
const castMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.38, metalness: 0.3 });

/**
 * Le Géant du Tourmalet: a steel cyclist hauling a steel bike up the col, out of the saddle with
 * one pedal down and one knee up, on a stepped stone plinth with a plaque. He rides towards -x,
 * so he climbs in the direction of travel when he stands on the right of the road. About 1.6k triangles.
 */
export function buildGeant(): THREE.Group {
  const k = new Kit();
  const S = 3.2; // the statue is this many times life size
  // The plinth: two steps, a cap and a few blocks heaped at the foot, with a plaque on the road side.
  k.box(5.8, 0.55, 3.0, 0, 0, 0, '#77746d');
  k.box(4.8, 0.75, 2.2, 0, 0.55, 0, '#96928a');
  k.box(4.1, 0.2, 1.7, 0, 1.3, 0, '#aaa59b', 0, 0.95);
  const PLINTH = 1.5;
  for (const [w, h, x, z, c, ry] of [[0.7, 0.35, -2.2, 1.25, '#8a867d', 0.3], [0.5, 0.26, -1.7, 1.5, '#a39e94', -0.4], [0.6, 0.3, 2.3, 1.3, '#7f7b73', 0.2], [0.45, 0.22, 1.8, 1.55, '#9d988e', 0.7]] as const) k.box(w, h, w * 0.8, x, 0, z, c, ry);
  const plaque = ['LE GÉANT', 'DU TOURMALET'];
  k.box(2.0, 0.5, 0.06, 0, 0.78, 1.11, '#2c2a26', 0, 1);
  k.panel(1.94, 0.44, 0, 1.03, 1.145, boardMaterial(`geant|${plaque.join('|')}`, 384, 84, (g, w, h) => {
    g.fillStyle = '#3a3226';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2cf93';
    fitText(g, plaque[0], w / 2, h * 0.3, w - 30, 34);
    fitText(g, plaque[1], w / 2, h * 0.72, w - 30, 34);
  }, '#3a3226'));

  const stone = k.build();
  const cast = new Kit();
  const STEEL = '#b9c0c8'; // the rider: brushed steel, a little darker than chrome so the sky doesn't swallow him
  const STEEL_LIGHT = '#d0d6dc';
  const HELMET = '#6d7680';
  const SILVER = '#8c949d'; // the bike, a shade darker so it reads against the rider
  const TYRE = '#26292d';
  // (u, v, z) in the statue's own frame: u forward, v up, z across, in life-size metres; mapped to x = -u so he rides towards -x.
  const P = (u: number, v: number, z = 0): [number, number, number] => [-u * S, v * S, z * S];
  cast.within([0, PLINTH - 0.02, 0], [0, 0, 0], () => {
    // Wheels: a tyre, a rim, a hub and spokes.
    for (const u of [-0.55, 0.55]) {
      const [x, y] = P(u, 0.34);
      cast.ring(0.34 * S, 0.026 * S, x, y, 0, TYRE, 20);
      cast.ring(0.3 * S, 0.01 * S, x, y, 0, SILVER, 20);
      cast.ball(0.03 * S, x, y, 0, SILVER);
      for (const a of [0.2, 1.2, 2.2]) cast.bar([x + Math.cos(a) * 0.3 * S, y + Math.sin(a) * 0.3 * S, 0], [x - Math.cos(a) * 0.3 * S, y - Math.sin(a) * 0.3 * S, 0], 0.006 * S, SILVER);
    }
    // The frame: a diamond of tubes, with the stays and fork doubled either side of the wheels.
    const t = 0.026 * S;
    const bb = P(0, 0.3), seatTop = P(-0.14, 0.98), headTop = P(0.4, 0.86), headBot = P(0.37, 0.66);
    cast.bar(bb, seatTop, t, SILVER);
    cast.bar(bb, headBot, t * 1.4, SILVER);
    cast.bar(seatTop, headTop, t, SILVER);
    cast.bar(headBot, headTop, t * 1.5, SILVER);
    for (const side of [1, -1]) {
      const r = P(-0.55, 0.34, side * 0.05), f = P(0.55, 0.34, side * 0.05);
      cast.bar(P(-0.14, 0.9), r, t * 0.7, SILVER); // seat stay
      cast.bar(bb, r, t * 0.8, SILVER); // chain stay
      cast.bar(headBot, f, t * 0.8, SILVER); // fork leg
    }
    cast.ring(0.09 * S, 0.01 * S, bb[0], bb[1], 0.05 * S, SILVER, 10); // chainring
    cast.bar(seatTop, P(-0.16, 1.05), t * 0.8, SILVER); // seat post
    cast.bar(P(-0.24, 1.07), P(-0.04, 1.05), t * 1.7, HELMET); // saddle
    cast.bar(headTop, P(0.46, 0.95), t * 1.1, SILVER); // stem
    cast.bar(P(0.46, 0.95, -0.2), P(0.46, 0.95, 0.2), t * 0.9, SILVER); // the bars...
    for (const side of [1, -1]) {
      cast.bar(P(0.46, 0.95, side * 0.2), P(0.57, 0.93, side * 0.2), t * 0.8, SILVER); // ...and their drops
      cast.bar(P(0.57, 0.93, side * 0.2), P(0.55, 0.84, side * 0.2), t * 0.8, SILVER);
    }
    // The rider, a 1.75 m man out of the saddle: hips over the bottom bracket, a thick back about 40 degrees off horizontal, shoulders over the bars, arms reaching down to the hoods.
    const hip = P(-0.02, 1.05), shoulder = P(0.44, 1.42), chest = P(0.34, 1.33);
    const head = P(0.56, 1.55);
    cast.rod(hip, shoulder, 0.115 * S, 0.145 * S, STEEL, 8); // torso, narrow at the waist and broad at the chest
    cast.ball(0.12 * S, hip[0], hip[1], 0, STEEL, 1.1, 0.9, 1.5); // pelvis
    cast.ball(0.15 * S, chest[0], chest[1], 0, STEEL_LIGHT, 1.1, 0.95, 1.2); // chest
    cast.rod(P(0.44, 1.42, -0.2), P(0.44, 1.42, 0.2), 0.065 * S, 0.065 * S, STEEL, 6); // shoulders
    cast.rod(shoulder, P(0.52, 1.5), 0.06 * S, 0.05 * S, STEEL, 6); // neck
    cast.ball(0.1 * S, head[0], head[1], 0, STEEL_LIGHT, 1.15, 1.15, 0.95); // head
    cast.ball(0.115 * S, head[0] - 0.03 * S, head[1] + 0.035 * S, 0, HELMET, 1.3, 0.75, 1.05); // helmet
    for (const side of [1, -1]) {
      const sh = P(0.44, 1.42, side * 0.2), elbow = P(0.54, 1.17, side * 0.22), hand = P(0.56, 0.97, side * 0.2);
      cast.rod(sh, elbow, 0.055 * S, 0.042 * S, STEEL, 6); // upper arm
      cast.ball(0.05 * S, elbow[0], elbow[1], elbow[2], STEEL_LIGHT);
      cast.rod(elbow, hand, 0.045 * S, 0.034 * S, STEEL, 6); // forearm
      cast.ball(0.05 * S, hand[0], hand[1], hand[2], STEEL_LIGHT); // hand
    }
    // Legs: the near one (z +) pushing the pedal down and nearly straight, the far one coming up with the knee high.
    const legs: [number, [number, number], [number, number]][] = [[1, [0.1, 0.6], [0.04, 0.14]], [-1, [0.3, 0.8], [-0.04, 0.46]]];
    for (const [side, knee, foot] of legs) {
      const h = P(-0.02, 1.03, side * 0.1), kn = P(knee[0], knee[1], side * 0.11), ft = P(foot[0], foot[1] + 0.03, side * 0.11);
      cast.rod(h, kn, 0.1 * S, 0.062 * S, STEEL, 7); // thigh
      cast.ball(0.068 * S, kn[0], kn[1], kn[2], STEEL_LIGHT);
      cast.rod(kn, ft, 0.065 * S, 0.04 * S, STEEL, 7); // calf
      cast.bar(P(foot[0] - 0.05, foot[1] + 0.02, side * 0.11), P(foot[0] + 0.15, foot[1] + 0.03, side * 0.11), 0.06 * S, STEEL_LIGHT); // shoe
      cast.bar(bb, P(foot[0], foot[1], side * 0.09), t * 0.7, SILVER); // crank
    }
  });
  stone.add(...cast.build(castMaterial).children);
  return finish(stone);
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
  'washington-tower': buildWashingtonTower,
  'diablo-summit': buildDiabloSummit,
  'crest-house-ruins': buildCrestHouseRuins,
  'summit-sign-us': buildSummitSignUs,
  'manhattan-skyline': buildSkyline,
  'virginia-capitol': buildCapitol,
  terrace: buildTerrace,
  'bixby-bridge': buildBixbyBridge,
};

export const MONUMENT_IDS = Object.keys(BUILDERS) as MonumentId[];

/** Builds a monument. Its height is its natural size in metres; landmarks.ts scales it to the kind's `size`. */
export function buildMonument(id: MonumentId, options: MonumentOptions = {}): THREE.Group {
  return BUILDERS[id](options);
}
