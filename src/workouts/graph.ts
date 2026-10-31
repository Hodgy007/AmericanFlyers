import { totalDuration, zoneColor, type Step } from './model';

/**
 * Draws a workout as zone-coloured blocks (height = % FTP). `elapsed` adds a
 * progress shade and marker; `power` overlays the rider's actual power trace.
 */
export function drawWorkout(
  canvas: HTMLCanvasElement,
  steps: Step[],
  opts: { elapsed?: number; trace?: { t: number; ratio: number }[] } = {},
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const T = totalDuration(steps);
  if (!T) return;

  const top = Math.max(1.3, ...steps.map((s) => Math.max(s.start, s.end))) * 1.05;
  const x = (t: number) => (t / T) * w;
  const y = (r: number) => h - (r / top) * (h - 2);

  for (const s of steps) {
    const x0 = x(s.at);
    const x1 = x(s.at + s.duration);
    if (s.free) {
      ctx.fillStyle = 'rgba(160, 170, 190, 0.35)';
      ctx.fillRect(x0, y(0.5), Math.max(1, x1 - x0), h - y(0.5));
      continue;
    }
    // Slice ramps so the colour follows the zone.
    const slices = s.start === s.end ? 1 : Math.max(2, Math.ceil((x1 - x0) / 3));
    for (let i = 0; i < slices; i++) {
      const a = i / slices;
      const b = (i + 1) / slices;
      const ra = s.start + (s.end - s.start) * a;
      const rb = s.start + (s.end - s.start) * b;
      ctx.fillStyle = zoneColor((ra + rb) / 2);
      ctx.beginPath();
      ctx.moveTo(x0 + (x1 - x0) * a, h);
      ctx.lineTo(x0 + (x1 - x0) * a, y(ra));
      ctx.lineTo(x0 + (x1 - x0) * b, y(rb));
      ctx.lineTo(x0 + (x1 - x0) * b, h);
      ctx.fill();
    }
  }
  // FTP line.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y(1));
  ctx.lineTo(w, y(1));
  ctx.stroke();
  ctx.setLineDash([]);

  if (opts.trace?.length) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    opts.trace.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(Math.min(p.ratio, top))) : ctx.moveTo(x(p.t), y(Math.min(p.ratio, top)))));
    ctx.stroke();
  }
  if (opts.elapsed !== undefined) {
    const px = x(Math.min(opts.elapsed, T));
    ctx.fillStyle = 'rgba(10, 15, 30, 0.45)';
    ctx.fillRect(0, 0, px, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 1, 0, 2, h);
  }
}
