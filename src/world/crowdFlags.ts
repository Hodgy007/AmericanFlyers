import * as THREE from 'three';
import { FLAG_DESIGNS, type FlagDesign } from './crowdCulture';

// The cloth of the spectators' flags: every design in one small canvas texture, a
// row each in the order of FLAG_DESIGNS, shared by every crowd material and made
// the first time a flag-waving crowd is built. The crowd shader (crowds.ts) picks a
// row per spectator. Simple shapes on purpose: a flag is a few pixels from the bike.

const CELL_W = 128;
const CELL_H = 80;

const bands = (ctx: CanvasRenderingContext2D, colors: string[], vertical: boolean) => {
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    if (vertical) ctx.fillRect((i * CELL_W) / colors.length, 0, CELL_W / colors.length + 1, CELL_H);
    else ctx.fillRect(0, (i * CELL_H) / colors.length, CELL_W, CELL_H / colors.length + 1);
  });
};

const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

const PAINT: Record<FlagDesign, (ctx: CanvasRenderingContext2D) => void> = {
  fr: (ctx) => bands(ctx, ['#0055a4', '#ffffff', '#ef4135'], true),
  // White with red dots: the King of the Mountains jersey as a flag.
  polka: (ctx) => {
    bands(ctx, ['#ffffff'], true);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) dot(ctx, 13 + col * 25.5 + (row % 2) * 12, 13 + row * 27, 8.5, '#d5202a');
  },
  // Gwenn-ha-du: nine black and white stripes, ermine spots in the canton.
  bretagne: (ctx) => {
    for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#111111'; ctx.fillRect(0, (i * CELL_H) / 9, CELL_W, CELL_H / 9 + 1); }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 52, (CELL_H * 5) / 9);
    ctx.fillStyle = '#111111';
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) ctx.fillRect(8 + col * 15 + (row % 2) * 6, 6 + row * 13, 4, 8);
  },
  // Ikurriña: a white cross over a green saltire on red.
  basque: (ctx) => {
    bands(ctx, ['#d52b1e'], true);
    ctx.strokeStyle = '#009b48';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(CELL_W, CELL_H);
    ctx.moveTo(CELL_W, 0); ctx.lineTo(0, CELL_H);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, CELL_H / 2 - 5, CELL_W, 10);
    ctx.fillRect(CELL_W / 2 - 5, 0, 10, CELL_H);
  },
  it: (ctx) => bands(ctx, ['#009246', '#ffffff', '#ce2b37'], true),
  // Maglia rosa: Giro pink with a lighter sash.
  pink: (ctx) => {
    bands(ctx, ['#ee5a9a'], true);
    ctx.fillStyle = '#f8b5d0';
    ctx.beginPath();
    ctx.moveTo(0, CELL_H * 0.7); ctx.lineTo(CELL_W * 0.45, CELL_H); ctx.lineTo(CELL_W * 0.7, CELL_H); ctx.lineTo(0, CELL_H * 0.3);
    ctx.fill();
  },
  // Stars and stripes: thirteen stripes, a blue canton of white dots.
  us: (ctx) => {
    for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#b22234'; ctx.fillRect(0, (i * CELL_H) / 13, CELL_W, CELL_H / 13 + 1); }
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, CELL_W * 0.42, (CELL_H * 7) / 13);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) dot(ctx, 7 + col * 10 + (row % 2) * 4, 7 + row * 10, 2.4, '#ffffff');
  },
  // Colorado: blue, white, blue, a red C round a gold disc.
  colorado: (ctx) => {
    bands(ctx, ['#002868', '#ffffff', '#002868'], false);
    ctx.strokeStyle = '#bf0a30';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(CELL_W * 0.4, CELL_H / 2, 21, Math.PI * 0.27, Math.PI * 1.73);
    ctx.stroke();
    dot(ctx, CELL_W * 0.4, CELL_H / 2, 9, '#ffd700');
  },
  nl: (ctx) => bands(ctx, ['#ae1c28', '#ffffff', '#21468b'], false),
  // The Union Flag: the crosses of St George, St Andrew and St Patrick over blue.
  gb: (ctx) => {
    ctx.fillStyle = '#012169';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(CELL_W, CELL_H);
    ctx.moveTo(CELL_W, 0); ctx.lineTo(0, CELL_H);
    ctx.stroke();
    ctx.strokeStyle = '#c8102e';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(CELL_W, CELL_H);
    ctx.moveTo(CELL_W, 0); ctx.lineTo(0, CELL_H);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, CELL_H / 2 - 13, CELL_W, 26);
    ctx.fillRect(CELL_W / 2 - 13, 0, 26, CELL_H);
    ctx.fillStyle = '#c8102e';
    ctx.fillRect(0, CELL_H / 2 - 8, CELL_W, 16);
    ctx.fillRect(CELL_W / 2 - 8, 0, 16, CELL_H);
  },
  // The flag of Yorkshire: a white rose with a gold heart on blue.
  yorkshire: (ctx) => {
    bands(ctx, ['#0b3a8f'], true);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      dot(ctx, CELL_W / 2 + Math.cos(a) * 15, CELL_H / 2 + Math.sin(a) * 15, 12, '#ffffff');
    }
    dot(ctx, CELL_W / 2, CELL_H / 2, 8, '#f2c200');
  },
  // Plain orange with a darker edge: what the Dutch bring when the tricolour is not enough.
  orange: (ctx) => {
    bands(ctx, ['#ff6a00'], true);
    ctx.fillStyle = '#d9540a';
    ctx.fillRect(0, 0, CELL_W, 7);
    ctx.fillRect(0, CELL_H - 7, CELL_W, 7);
  },
};

let atlas: THREE.CanvasTexture | null = null;

/** The flag atlas: row i (from the top) is FLAG_DESIGNS[i]. */
export function flagAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W;
  canvas.height = CELL_H * FLAG_DESIGNS.length;
  const ctx = canvas.getContext('2d')!;
  FLAG_DESIGNS.forEach((design, i) => {
    ctx.save();
    ctx.translate(0, i * CELL_H);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    PAINT[design](ctx);
    ctx.restore();
  });
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  return atlas;
}
