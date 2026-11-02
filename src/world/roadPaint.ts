import * as THREE from 'three';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { ROAD_HALF_WIDTH, bendsOf, hash01, isClimb, seedOf } from './roadside';

// Words and symbols painted on the road on the big climbs, as the fans do on the
// Tour's mountains: ALLEZ, VAS!, GO GO GO, stars, arrows, and the rider's own
// first name ("ALLEZ SAM"). A few per kilometre over the last stretch of the
// climb and on the straight before some hairpins, the same places every time
// (they're picked from the stage id). Each is a flat strip draped along the
// road, stretched lengthwise so it reads from a rider's low eye height.

export type PaintWord = 'allez' | 'vas' | 'gogogo' | 'star' | 'arrow' | 'name';
export const WORDS: readonly PaintWord[] = ['allez', 'vas', 'gogogo', 'star', 'arrow', 'name'];

export interface PaintSpot {
  d: number; // course distance of the near edge of the paint
  word: PaintWord;
  len: number; // metres along the road
}

const LAST_KM = 3400; // paint spans the last stretch of the climb
const SPACING = 380;
const NAME_AT = [190, 1350, 2800]; // metres from the finish: where the rider's own name goes

/** A first name made safe to paint: letters only, upper case, at most 9. Empty if nothing usable is left. */
export function paintName(raw: string | null | undefined): string {
  const first = (raw ?? '').trim().split(/\s+/)[0] ?? '';
  const clean = first.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
  return clean.slice(0, 9);
}

/** Where paint goes on a stage. `name` is the rider's painted first name (or ''), which decides whether "ALLEZ <NAME>" can appear. */
export function planPaint(stage: Stage, name: string): PaintSpot[] {
  if (!isClimb(stage)) return [];
  const finish = stage.finish!;
  const seed = seedOf(stage.id);
  const bends = bendsOf(stage);
  const spots: PaintSpot[] = [];
  const clear = (d: number, len: number) => !bends.some((b) => d < b.end + 6 && d + len > b.start - 14);
  const lenOf = (w: PaintWord) => (w === 'star' || w === 'arrow' ? 4.2 : 5.6);
  const add = (d: number, word: PaintWord) => {
    const len = lenOf(word);
    if (d > 20 && clear(d, len)) spots.push({ d, word, len });
  };

  // The last stretch: every SPACING m a word, in an order that depends on the stage.
  const cycle: PaintWord[] = ['arrow', 'gogogo', 'star', 'vas', 'allez', 'arrow', 'vas', 'star'];
  const lead = Math.floor(hash01(seed, 1) * cycle.length);
  for (let k = 0; finish - 70 - k * SPACING > finish - LAST_KM; k++) add(finish - 70 - k * SPACING, cycle[(k + lead) % cycle.length]);
  // The rider's name, a few times.
  if (name) for (const m of NAME_AT) add(finish - m - 30 + Math.round((hash01(seed, m) - 0.5) * 40), 'name');
  // The straight before some hairpins (not every one: Stelvio has 48).
  bends.forEach((b, i) => {
    if (hash01(seed, 7, i) < 0.36) add(b.start - 52, WORDS[Math.floor(hash01(seed, 9, i) * 3)]);
  });
  return spots.sort((a, b) => a.d - b.d);
}

// ----------------------------------------------------------------- atlas ----

const ROW_W = 1024;
const ROW_H = 256;

/** One canvas holding every word, one per row, in the order of WORDS. Paint is white with a little wear. */
export function drawAtlas(name: string, rowW = ROW_W): HTMLCanvasElement {
  const k = rowW / ROW_W;
  const c = document.createElement('canvas');
  c.width = rowW;
  c.height = ROW_H * k * WORDS.length;
  const g = c.getContext('2d')!;
  g.scale(k, k);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = (row: number, s: string, color = '#f6f4ec') => {
    g.save();
    g.translate(0, row * ROW_H);
    g.fillStyle = color;
    let size = 210;
    do g.font = `900 ${size}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
    while (g.measureText(s).width > ROW_W - 70 && (size -= 6) > 40);
    g.fillText(s, ROW_W / 2, ROW_H / 2 + 8);
    g.restore();
  };
  text(0, 'ALLEZ');
  text(1, 'VAS!');
  text(2, 'GO GO GO');
  // Stars: three five-pointed stars.
  g.fillStyle = '#ffe27a';
  for (let i = 0; i < 3; i++) star(g, 256 + i * 256, ROW_H * 3 + ROW_H / 2, 100, 42);
  // Arrows: three chevrons pointing up the road (up the canvas).
  g.strokeStyle = '#f6f4ec';
  g.lineWidth = 34;
  g.lineJoin = 'miter';
  for (let i = 0; i < 3; i++) {
    const cx = 256 + i * 256;
    const cy = ROW_H * 4 + ROW_H / 2;
    g.beginPath();
    g.moveTo(cx - 80, cy + 60);
    g.lineTo(cx, cy - 60);
    g.lineTo(cx + 80, cy + 60);
    g.stroke();
  }
  text(5, name ? `ALLEZ ${name}` : 'ALLEZ');
  // Wear: tyre scuffs and chips nibble the paint away.
  g.globalCompositeOperation = 'destination-out';
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.6})`;
    const r = 1 + rnd() * 3.5;
    g.beginPath();
    g.ellipse(rnd() * ROW_W, rnd() * ROW_H * WORDS.length, r * 1.6, r, rnd() * 3, 0, 6.3);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}

// -------------------------------------------------------------- geometry ----

const SEG = 1; // metres per row of the strip

/** One mesh of every spot that starts in [d0, d1), positioned relative to `origin`; null if there are none. */
export function buildPaint(spots: PaintSpot[], d0: number, d1: number, origin: { x: number; z: number }): THREE.BufferGeometry | null {
  const here = spots.filter((s) => s.d >= d0 && s.d < d1);
  if (!here.length) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const half = ROAD_HALF_WIDTH * 0.68; // 6.3 m of the 9.2 m road: inside the edge lines
  for (const s of here) {
    const row = WORDS.indexOf(s.word);
    const n = Math.max(1, Math.round(s.len / SEG));
    const base = pos.length / 3;
    for (let r = 0; r <= n; r++) {
      const d = s.d + (r / n) * s.len;
      const p = roadPoint(d);
      const rx = -Math.sin(p.heading);
      const rz = Math.cos(p.heading);
      const y = p.y + 0.045;
      const v = 1 - (row + 1 - r / n) / WORDS.length; // flipY: the canvas top is v = 1; the strip's near edge (r = 0) is the row's bottom, so lettering reads up the road
      for (const [u, lat] of [[0, -half], [1, half]] as const) {
        pos.push(p.x + rx * lat - origin.x, y, p.z + rz * lat - origin.z);
        uv.push(u, v);
      }
      if (r > 0) {
        const a = base + (r - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
