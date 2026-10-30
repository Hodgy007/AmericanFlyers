import { elevationAt } from './course';

/** Elevation profile strip: 0.5 km behind to 4.5 km ahead, coloured by grade. */
export function drawProfile(canvas: HTMLCanvasElement, distance: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const from = Math.max(0, distance - 500);
  const to = from + 5000;
  const samples: { x: number; e: number; g: number }[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= w; i += 3) {
    const d = from + ((to - from) * i) / w;
    const e = elevationAt(d);
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
    // Grade averaged over 100 m so the colour bands show climbs, not every bump.
    samples.push({ x: i, e, g: (elevationAt(d + 50) - elevationAt(d - 50)) / 100 });
  }
  const range = Math.max(30, hi - lo);
  const y = (e: number) => h - 4 - ((e - lo) / range) * (h - 14);

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    ctx.fillStyle = gradeColor(b.g);
    ctx.beginPath();
    ctx.moveTo(a.x, h);
    ctx.lineTo(a.x, y(a.e));
    ctx.lineTo(b.x, y(b.e));
    ctx.lineTo(b.x, h);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(10, 15, 30, 0.45)';
  const px = ((distance - from) / (to - from)) * w;
  ctx.fillRect(0, 0, px, h);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d62839';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, y(elevationAt(distance)), 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function gradeColor(g: number): string {
  const pct = g * 100;
  if (pct < -1) return '#5aa9e6';
  if (pct < 2) return '#6cc070';
  if (pct < 5) return '#f2c14e';
  if (pct < 8) return '#f08a4b';
  return '#d62839';
}

