// The share card: a 1080 x 1350 picture of a ride (route, key numbers, place,
// badges, your colours and the American Flyers mark) drawn on a canvas, then
// shared as a file with the Web Share API where the browser has it, or saved
// as a PNG.

import type { Stage } from '../stages';

export const CARD_W = 1080;
export const CARD_H = 1350;

export interface CardKit {
  jersey: string;
  accent: string;
  frame: string;
}

export interface ShareCardData {
  title: string; // stage or ride name
  subtitle: string; // date, or "Race · Tour stage 2"
  route: [number, number][]; // the route's shape (any units)
  profile: number[]; // elevation along the ride (any units); may be empty
  stats: { label: string; value: string }[]; // up to six
  headline?: string; // "2nd of 12", "New personal best", ...
  badges: string[];
  kit: CardKit | null;
  rider?: string; // "Level 6 · Climber"
}

/** The shape of the road between two distances on a stage: points from walking its heading (north-up, y down). */
export function routeShape(stage: Pick<Stage, 'headingAt'>, fromM: number, toM: number, points = 140): [number, number][] {
  const span = Math.max(1, toM - fromM);
  const step = span / points;
  const out: [number, number][] = [[0, 0]];
  let x = 0;
  let z = 0;
  for (let i = 0; i < points; i++) {
    const h = stage.headingAt(fromM + (i + 0.5) * step);
    x += Math.cos(h) * step;
    z += Math.sin(h) * step;
    out.push([x, z]);
  }
  return out;
}

/** Elevation along a stage between two distances. */
export function elevationProfile(stage: Pick<Stage, 'elevationAt'>, fromM: number, toM: number, points = 120): number[] {
  const out: number[] = [];
  for (let i = 0; i <= points; i++) out.push(stage.elevationAt(fromM + ((toM - fromM) * i) / points));
  return out;
}

/** Scales points to fit a box (keeping their shape), centred in it. */
export function fitPoints(pts: [number, number][], x: number, y: number, w: number, h: number): [number, number][] {
  if (!pts.length) return [];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sw = Math.max(1e-6, maxX - minX), sh = Math.max(1e-6, maxY - minY);
  const k = Math.min(w / sw, h / sh);
  const ox = x + (w - sw * k) / 2, oy = y + (h - sh * k) / 2;
  return pts.map(([px, py]) => [ox + (px - minX) * k, oy + (py - minY) * k]);
}

export function formatDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

const FONT = "'Barlow Condensed', 'Arial Narrow', 'Inter', system-ui, sans-serif";
const BODY = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

/** Shrinks text until it fits `max` pixels wide. */
function fitText(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, max: number) {
  let px = start;
  g.font = font(px);
  while (px > 24 && g.measureText(text).width > max) { px -= 4; g.font = font(px); }
  return px;
}

/** Draws the card onto a canvas (resizing it to 1080 x 1350). */
export function drawShareCard(canvas: HTMLCanvasElement, d: ShareCardData) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const g = canvas.getContext('2d')!;
  const kit = d.kit ?? { jersey: '#d62839', accent: '#14213d', frame: '#1f3c88' };

  // Background: deep blue with a soft glow and a big faint star.
  const bg = g.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#0b1230');
  bg.addColorStop(1, '#1a2a5e');
  g.fillStyle = bg;
  g.fillRect(0, 0, CARD_W, CARD_H);
  const glow = g.createRadialGradient(780, 480, 20, 780, 480, 700);
  glow.addColorStop(0, 'rgba(76,141,246,0.28)');
  glow.addColorStop(1, 'rgba(76,141,246,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, CARD_W, CARD_H);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  star(g, 900, 330, 420);
  g.fill();

  // Mark.
  g.fillStyle = '#e5383b';
  star(g, 92, 96, 34);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `italic 800 46px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText('AMERICAN FLYERS', 144, 98);

  // Title.
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  const px = fitText(g, d.title, (p) => `italic 800 ${p}px ${FONT}`, 104, 920);
  g.fillText(d.title, 80, 250);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = `500 32px ${BODY}`;
  g.fillText(d.subtitle, 82, 250 + Math.max(46, px * 0.5));

  // Route panel.
  const px0 = 60, py0 = 330, pw = CARD_W - 120, ph = 500;
  g.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(g, px0, py0, pw, ph, 36);
  g.fill();
  const hasProfile = d.profile.length > 2;
  const routeBox = { x: px0 + 70, y: py0 + 50, w: pw - 140, h: ph - 100 - (hasProfile ? 120 : 0) };
  const pts = fitPoints(d.route, routeBox.x, routeBox.y, routeBox.w, routeBox.h);
  if (pts.length > 1) {
    g.lineJoin = g.lineCap = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = 'rgba(94,225,255,0.25)';
    g.lineWidth = 26;
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.shadowColor = '#5ee1ff';
    g.shadowBlur = 22;
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#3ccf7a';
    g.beginPath(); g.arc(pts[0][0], pts[0][1], 16, 0, Math.PI * 2); g.fill();
    const end = pts[pts.length - 1];
    g.fillStyle = '#e5383b';
    g.beginPath(); g.arc(end[0], end[1], 16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4;
    g.beginPath(); g.arc(end[0], end[1], 16, 0, Math.PI * 2); g.stroke();
  } else {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = `600 34px ${BODY}`;
    g.textAlign = 'center';
    g.fillText('Free ride', px0 + pw / 2, py0 + ph / 2 - 30);
    g.textAlign = 'left';
  }
  if (hasProfile) {
    const lo = Math.min(...d.profile), hi = Math.max(...d.profile);
    const x0 = px0 + 70, w0 = pw - 140, yb = py0 + ph - 36, hh = 84;
    g.beginPath();
    g.moveTo(x0, yb);
    d.profile.forEach((e, i) => g.lineTo(x0 + (i / (d.profile.length - 1)) * w0, yb - ((e - lo) / Math.max(1, hi - lo)) * hh));
    g.lineTo(x0 + w0, yb);
    g.closePath();
    const fill = g.createLinearGradient(0, yb - hh, 0, yb);
    fill.addColorStop(0, 'rgba(76,141,246,0.75)');
    fill.addColorStop(1, 'rgba(76,141,246,0.12)');
    g.fillStyle = fill;
    g.fill();
  }

  // Headline chip.
  let top = py0 + ph + 56;
  if (d.headline) {
    g.font = `italic 800 50px ${FONT}`;
    const tw = g.measureText(d.headline).width + 64;
    g.fillStyle = '#f0b429';
    roundRect(g, 80, top - 8, tw, 74, 37);
    g.fill();
    g.fillStyle = '#1a1405';
    g.fillText(d.headline, 112, top + 44);
    top += 100;
  }

  // Stats: three across, two rows.
  const stats = d.stats.slice(0, 6);
  const cw = (CARD_W - 160) / 3;
  stats.forEach((s, i) => {
    const cx = 80 + (i % 3) * cw;
    const cy = top + Math.floor(i / 3) * 112;
    g.fillStyle = '#fff';
    const size = fitText(g, s.value, (p) => `italic 800 ${p}px ${FONT}`, 76, cw - 24);
    g.fillText(s.value, cx, cy + size * 0.8);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = `600 24px ${BODY}`;
    g.fillText(s.label.toUpperCase(), cx, cy + size * 0.8 + 34);
  });

  // Badges.
  let bx = 80;
  const by = top + (stats.length > 3 ? 2 : 1) * 112 + 6;
  g.font = `700 28px ${BODY}`;
  for (const b of d.badges.slice(0, 4)) {
    const tw = g.measureText(b).width + 44;
    if (bx + tw > CARD_W - 80) break;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, bx, by, tw, 56, 28);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(b, bx + 22, by + 38);
    bx += tw + 14;
  }

  // Footer: your colours, your level, the mark.
  const fy = CARD_H - 56;
  [kit.jersey, kit.accent, kit.frame].forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath(); g.arc(100 + i * 44, fy, 20, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.stroke();
  });
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = `600 28px ${BODY}`;
  g.fillText(d.rider ?? 'Indoor cycling in your browser', 250, fy + 10);
  g.textAlign = 'right';
  g.fillStyle = '#e5383b';
  g.font = `italic 800 34px ${FONT}`;
  g.fillText('AMERICAN FLYERS', CARD_W - 80, fy + 10);
  g.textAlign = 'left';
}

export function cardBlob(d: ShareCardData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  drawShareCard(canvas, d);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t make the picture'))), 'image/png'));
}

/** Shares the card as an image file where the browser can; otherwise saves a PNG. */
export async function shareCard(d: ShareCardData, text: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const blob = await cardBlob(d);
  const name = `${d.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'ride'}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: d.title, text });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // Fall through to saving it.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'saved';
}
