import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Stage } from '../stages';

// Distance signs by country. On the American stages it is the green board on a
// pole (road.ts). On the French and Italian climbs it is the cyclists' milestone
// every real col has: a short white post with a coloured top and a face giving
// the climb, the distance to the summit and the average gradient of the next
// kilometre. Yellow top in France, red in Italy.

export type SignStyle = 'fr' | 'it' | 'us';

/** France for the stages whose hairpins are "Virage", Italy for "Tornante", the US sign for everything else. */
export function signStyleOf(stage: Pick<Stage, 'hairpinWord' | 'finish'>): SignStyle {
  if (stage.finish === null) return 'us';
  return stage.hairpinWord === 'Virage' ? 'fr' : stage.hairpinWord === 'Tornante' ? 'it' : 'us';
}

export interface MilestoneText {
  name: string; // the climb, upper case
  distance: string; // "Sommet 7 km"
  grade: string; // "Pente moy. 8.1 %"
}

/** The words on a milestone. `left` is the exact distance to the top in `unit`s (shown with a decimal unless it is whole, e.g. "Sommet 4.5 km"); `gradePct` the average gradient of the next stretch. */
export function milestoneText(style: 'fr' | 'it', stageName: string, left: number, unit: string, gradePct: number): MilestoneText {
  const g = Math.abs(gradePct) < 0.05 ? 0 : gradePct;
  const word = style === 'fr' ? ['Sommet', 'Pente moy.'] : ['Cima', 'Pendenza media'];
  const tenths = Math.round(left * 10) / 10;
  const dist = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
  return { name: stageName.toUpperCase(), distance: `${word[0]} ${dist} ${unit}`, grade: `${word[1]} ${g.toFixed(1)} %` };
}

/** Average gradient in percent from `d` to `d + span`, from the stage's own elevation. */
export function averageGrade(elevationAt: (d: number) => number, d: number, span: number): number {
  return span > 0 ? ((elevationAt(d + span) - elevationAt(d)) / span) * 100 : 0;
}

const TOP = { fr: '#f2c200', it: '#c8102e' } as const;
const FACE_W = 256;
const FACE_H = 384;

/** Draws a milestone's face (white, with the coloured band at the top carrying the climb's name). */
export function drawMilestoneFace(canvas: HTMLCanvasElement, style: 'fr' | 'it', t: MilestoneText) {
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f4f4ef';
  g.fillRect(0, 0, FACE_W, FACE_H);
  g.fillStyle = TOP[style];
  g.fillRect(0, 0, FACE_W, 150);
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // The climb's name on up to two lines, each shrunk to fit.
  const lines = measure(g, t.name, 44) > FACE_W - 28 ? balancedLines(t.name) : [t.name];
  g.fillStyle = style === 'fr' ? '#1b1d22' : '#ffffff';
  fitLines(g, lines, FACE_W / 2, 75, 44, FACE_W - 28, 800);

  g.fillStyle = '#1b1d22';
  fitLines(g, [t.distance], FACE_W / 2, 215, 40, FACE_W - 24, 800);
  g.fillStyle = TOP[style];
  g.fillRect(28, 258, FACE_W - 56, 5);
  g.fillStyle = '#1b1d22';
  fitLines(g, [t.grade], FACE_W / 2, 310, 34, FACE_W - 24, 700);
}

/** Splits a name in two at the space that leaves the halves closest in length ("COL DU / TOURMALET"). */
function balancedLines(name: string): string[] {
  const words = name.split(' ');
  let best = 1;
  let gap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < gap) { gap = d; best = i; }
  }
  return words.length > 1 ? [words.slice(0, best).join(' '), words.slice(best).join(' ')] : [name];
}

function measure(g: CanvasRenderingContext2D, text: string, size: number) {
  g.font = `800 ${size}px system-ui, sans-serif`;
  return g.measureText(text).width;
}

/** Centred lines stacked about `y`, each at the largest size up to `max` px that fits `width`. */
function fitLines(g: CanvasRenderingContext2D, lines: string[], x: number, y: number, max: number, width: number, weight: number) {
  const step = lines.length > 1 ? max * 0.95 : 0;
  lines.forEach((line, i) => {
    let size = max;
    do g.font = `${weight} ${size}px system-ui, sans-serif`;
    while (g.measureText(line).width > width && (size -= 2) > 14);
    g.fillText(line, x, y + (i - (lines.length - 1) / 2) * step);
  });
}

export const MILESTONE_FACE = { width: 0.6, height: 0.9 }; // metres
const POST = { width: 0.7, height: 1.1, depth: 0.22 };

/** The milestone post: a white block with a coloured cap, colours baked in as vertex colours. Its front (+z) is where the face goes. */
export function milestoneGeometry(style: 'fr' | 'it'): THREE.BufferGeometry {
  const paint = (geo: THREE.BufferGeometry, color: string) => {
    const n = geo.toNonIndexed();
    n.deleteAttribute('uv');
    const c = new THREE.Color(color);
    const arr = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return n;
  };
  return mergeGeometries([
    paint(new THREE.BoxGeometry(POST.width, POST.height, POST.depth).translate(0, POST.height / 2, 0), '#e9e9e4'),
    paint(new THREE.BoxGeometry(POST.width + 0.04, 0.2, POST.depth + 0.04).translate(0, POST.height + 0.1, 0), TOP[style]),
  ])!;
}
