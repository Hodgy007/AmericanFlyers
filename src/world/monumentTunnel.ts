import * as THREE from 'three';
import { Kit, boardMaterial, finish, fitText } from './monumentKit';
import type { MonumentOptions } from './monumentTypes';
import { TUNNEL_CROWN, TUNNEL_HALF_WIDTH, TUNNEL_PORTAL_DEPTH, tunnelProfile } from './tunnelSpan';

// The stone arch at each mouth of a road tunnel (`Scenery.tunnels`, tunnel.ts builds the tube): a wall of dressed limestone across the cutting with the
// tunnel's own profile cut in it, a lighter ring of arch stones round the opening with a keystone, courses, a cornice and a plaque with the tunnel's name.
// It is the same on both faces (the entrance seen from the approach and the exit seen from the far side), so one monument serves both ends: the
// entrance stands with its front face on the span's start, the exit with its back face on the span's end (landmarks place a side-0 monument facing the oncoming rider).

const BASE = 0.4; // landmarks.ts sinks a side-0 monument 0.4 m, so the opening's floor is this high in the model
const WIDTH = 24; // wide enough to bed into the rock either side of the cutting's floor
const HEIGHT = 11;
const RING = 0.95; // the arch stones' width round the opening
const INSET = 0.06; // the opening is a hair smaller than the tube, so the two never share a surface

const STONE = '#9a968a';
const STONE_DARK = '#7c786d';
const RING_STONE = '#b9b4a6';
const CORNICE = '#6f6b61';

/** The tunnel's cross-section as a closed outline at height `lift`, each point pushed `grow` metres out from the arch's centre (negative: in). */
function outline(grow: number, lift: number): THREE.Vector2[] {
  const w = TUNNEL_HALF_WIDTH;
  const prof = tunnelProfile();
  // The arc's centre sits at the springing line's circle: find it from the crown and a wall top (the same numbers as tunnelProfile).
  const rise = prof[Math.floor(prof.length / 2)][1] - prof[2][1];
  const radius = (w * w + rise * rise) / (2 * rise);
  const cy = prof[Math.floor(prof.length / 2)][1] - radius;
  return prof.map(([x, y]) => {
    if (y <= prof[2][1] + 1e-6) return new THREE.Vector2(x + Math.sign(x) * grow, y + lift); // the walls: straight out sideways
    const dx = x, dy = y - cy;
    const l = Math.hypot(dx, dy);
    return new THREE.Vector2(dx + (dx / l) * grow, cy + dy + (dy / l) * grow + lift);
  });
}

/** The face wall: the outer rectangle with the opening cut out. */
function wall(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-WIDTH / 2, 0);
  s.lineTo(WIDTH / 2, 0);
  s.lineTo(WIDTH / 2, HEIGHT);
  s.lineTo(-WIDTH / 2, HEIGHT);
  s.closePath();
  const hole = new THREE.Path();
  const pts = tunnelProfile().map(([x, y]) => new THREE.Vector2(x * (1 - INSET / TUNNEL_HALF_WIDTH), BASE + y * (1 - INSET / TUNNEL_CROWN)));
  hole.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) hole.lineTo(p.x, p.y);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

/** The ring of arch stones: the opening's outline grown by RING, with the opening cut out again. */
function ring(): THREE.Shape {
  const s = new THREE.Shape(outline(RING, BASE));
  s.holes.push(new THREE.Path(outline(0, BASE)));
  return s;
}

/** The plaque on one face: the tunnel's name over (optionally) a second line. */
function plaque(lines: string[]) {
  return boardMaterial(`tunnel|${lines.join('|')}`, 512, 96, (g, w, h) => {
    g.fillStyle = '#2f2c27';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9b98b';
    g.lineWidth = 5;
    g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = '#e6d6a3';
    if (lines.length > 1) {
      fitText(g, lines[0], w / 2, h * 0.36, w - 44, 40);
      fitText(g, lines.slice(1).join('  '), w / 2, h * 0.74, w - 44, 28, 700);
    } else fitText(g, lines[0], w / 2, h / 2, w - 44, 44);
  }, '#2f2c27');
}

/** A tunnel portal: a limestone arch wall, the same on both faces, front towards +z. About 11.6 m tall and 24 m wide, 2.4 m thick. */
export function buildTunnelPortal(o: MonumentOptions = {}): THREE.Group {
  const lines = o.lines ?? ['TUNNEL'];
  const k = new Kit();
  const depth = TUNNEL_PORTAL_DEPTH;
  k.slab(wall(), depth, 0, 0, STONE, 0.8);
  // Courses: shallow bands that stand a few centimetres proud, so the face reads as dressed stone.
  for (const [y, c] of [[2.6, STONE_DARK], [4.9, STONE_DARK], [7.1, STONE_DARK], [9.3, STONE_DARK]] as const) {
    for (const side of [-1, 1]) {
      const w = WIDTH / 2 - 7.2;
      k.box(w, 0.14, depth + 0.1, side * (7.2 + w / 2), y, 0, c, 0, 1);
    }
  }
  k.slab(ring(), depth + 0.5, 0, 0, RING_STONE, 0.85); // the arch stones, proud of both faces
  k.box(1.3, 1.6, depth + 0.7, 0, BASE + TUNNEL_CROWN + 0.15, 0, '#cfcabb', 0, 0.95); // the keystone
  k.box(WIDTH + 0.8, 0.55, depth + 0.9, 0, HEIGHT, 0, CORNICE, 0, 0.9); // the cornice
  const foot = WIDTH / 2 - TUNNEL_HALF_WIDTH - RING; // the plinth, either side of the opening
  for (const side of [-1, 1]) k.box(foot + 0.1, 0.9, depth + 0.3, side * (TUNNEL_HALF_WIDTH + RING + foot / 2), 0, 0, STONE_DARK, 0, 0.8);
  // The plaque over the arch, on each face.
  const mat = plaque(lines);
  const y = BASE + TUNNEL_CROWN + RING + 1.4;
  k.panel(8.4, 1.5, 0, y, depth / 2 + 0.03, mat);
  k.panel(8.4, 1.5, 0, y, -depth / 2 - 0.03, mat, Math.PI);
  return finish(k.build());
}
