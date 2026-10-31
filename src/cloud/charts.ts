// Small SVG charts for the profile and admin pages: single-series bars and
// lines, each with a hover tooltip. Text uses the text colours; the series
// colour is only on the marks.

const NS = 'http://www.w3.org/2000/svg';
const SERIES = '#4c8df6';

function svg(tag: string, attrs: Record<string, string | number>) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A chart frame: title, the plot, and a tooltip that lives inside the frame
 * (so it shows above modal dialogs too). */
function frame(title: string, empty: string | null) {
  const wrap = document.createElement('figure');
  wrap.className = 'chart';
  const cap = document.createElement('figcaption');
  cap.textContent = title;
  wrap.append(cap);
  const plot = document.createElement('div');
  plot.className = 'chart-plot';
  wrap.append(plot);
  if (empty) {
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = empty;
    plot.append(p);
  }
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  plot.append(tip);
  const show = (html: [string, string], x: number, y: number) => {
    tip.replaceChildren();
    const a = document.createElement('strong');
    a.textContent = html[0];
    const b = document.createElement('span');
    b.textContent = html[1];
    tip.append(a, b);
    tip.hidden = false;
    const w = plot.clientWidth;
    tip.style.left = `${Math.min(Math.max(x, 60), w - 60)}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => { tip.hidden = true; };
  /** Calls draw(width) once the plot has a width, and again when it changes,
   * so text and marks stay the same size at any width. */
  const onWidth = (draw: (w: number) => SVGElement) => {
    let last = 0;
    new ResizeObserver(() => {
      const w = Math.round(plot.clientWidth);
      if (!w || w === last) return;
      last = w;
      plot.querySelector('svg')?.remove();
      plot.prepend(draw(w));
    }).observe(plot);
  };
  return { wrap, plot, show, hide, onWidth };
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export interface Bar { label: string; value: number; tip: string }

/** Vertical bars, one series. `axisEvery` labels every nth bar on the x axis. */
export function barChart(title: string, bars: Bar[], opts: { height?: number; format?: (v: number) => string; axisEvery?: number; color?: string } = {}) {
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)));
  const max = Math.max(0, ...bars.map((b) => b.value));
  const { wrap, show, hide, onWidth } = frame(title, bars.length && max > 0 ? null : 'Nothing to show yet.');
  if (!bars.length || max <= 0) return wrap;
  onWidth((W) => {
  const H = opts.height ?? 160, L = 34, B = 20, T = 8;
  const top = niceMax(max);
  const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': title });
  const ph = H - B - T;
  for (const f of [0, 0.5, 1]) {
    const y = T + ph * (1 - f);
    el.append(svg('line', { x1: L, x2: W, y1: y, y2: y, class: f ? 'grid' : 'axis' }));
    const t = svg('text', { x: L - 6, y: y + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = fmt(top * f);
    el.append(t);
  }
  const slot = (W - L) / bars.length;
  const bw = Math.max(1, Math.min(28, slot - 2));
  // Label every nth bar, thinning further when the chart is narrow.
  const every = Math.max(opts.axisEvery ?? 1, Math.ceil(bars.length / Math.max(2, Math.floor((W - L) / 60))));
  bars.forEach((b, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const h = (b.value / top) * ph;
    const r = Math.min(4, bw / 2, h);
    if (h > 0) {
      // Rounded top, square base on the axis.
      const y = T + ph - h;
      el.append(svg('path', {
        d: `M${x},${T + ph}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${T + ph}Z`,
        fill: opts.color ?? SERIES,
      }));
    }
    if (i % every === 0) {
      const t = svg('text', { x: x + bw / 2, y: H - 5, 'text-anchor': 'middle', class: 'tick' });
      t.textContent = b.label;
      el.append(t);
    }
    // Hit target: the whole column, larger than the bar.
    const hit = svg('rect', { x: L + i * slot, y: T, width: slot, height: ph, class: 'hit' });
    hit.addEventListener('pointerenter', () => show([b.tip, fmt(b.value)], L + i * slot + slot / 2, T + ph - h));
    hit.addEventListener('pointerleave', hide);
    el.append(hit);
  });
  return el;
  });
  return wrap;
}

export interface Point { x: number; y: number; tip?: string }

/**
 * A line over time (x in ms for dates, or seconds), one series, with a
 * crosshair tooltip. `step` draws a staircase (for FTP changes).
 */
export function lineChart(title: string, points: Point[], opts: {
  height?: number; step?: boolean; color?: string; unit?: string;
  xLabel: (x: number) => string; xTip?: (x: number) => string; yMin?: number; extendTo?: number; dots?: boolean;
}) {
  const { wrap, show, hide, onWidth } = frame(title, points.length ? null : 'Nothing to show yet.');
  if (!points.length) return wrap;
  onWidth((W) => {
  const H = opts.height ?? 150, L = 38, R = 8, B = 20, T = 10;
  const xs = points.map((p) => p.x);
  const x0 = Math.min(...xs);
  let x1 = Math.max(...xs, opts.extendTo ?? -Infinity);
  if (x1 === x0) x1 = x0 + 1;
  const ys = points.map((p) => p.y);
  const yMin = opts.yMin ?? 0;
  const yMax = yMin + niceMax((Math.max(...ys) - yMin) * 1.08);
  const px = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const py = (y: number) => T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': title });
  for (const f of [0, 0.5, 1]) {
    const v = yMin + (yMax - yMin) * f;
    el.append(svg('line', { x1: L, x2: W - R, y1: py(v), y2: py(v), class: f ? 'grid' : 'axis' }));
    const t = svg('text', { x: L - 6, y: py(v) + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = String(Math.round(v));
    el.append(t);
  }
  for (const f of [0, 0.5, 1]) {
    const t = svg('text', { x: px(x0 + (x1 - x0) * f), y: H - 5, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle', class: 'tick' });
    t.textContent = opts.xLabel(x0 + (x1 - x0) * f);
    el.append(t);
  }
  let d = '';
  points.forEach((p, i) => {
    if (i === 0) d += `M${px(p.x)},${py(p.y)}`;
    else if (opts.step) d += `H${px(p.x)}V${py(p.y)}`;
    else d += `L${px(p.x)},${py(p.y)}`;
  });
  if (opts.extendTo !== undefined) d += `H${px(x1)}`;
  const color = opts.color ?? SERIES;
  el.append(svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
  if (opts.dots) for (const p of points) el.append(svg('circle', { cx: px(p.x), cy: py(p.y), r: 4, fill: color, class: 'dot-ring' }));
  const cross = svg('line', { y1: T, y2: H - B, class: 'crosshair', visibility: 'hidden' });
  const marker = svg('circle', { r: 4, fill: color, class: 'dot-ring', visibility: 'hidden' });
  el.append(cross, marker);
  const hit = svg('rect', { x: L, y: 0, width: W - L - R, height: H, class: 'hit' });
  hit.addEventListener('pointermove', (e) => {
    const sx = e.clientX - el.getBoundingClientRect().left;
    const x = x0 + ((sx - L) / (W - L - R)) * (x1 - x0);
    // Nearest point (for a step line: the last one at or before x).
    let best = points[0];
    for (const p of points) {
      if (opts.step ? p.x <= x : Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    }
    const cx = opts.step ? Math.max(px(best.x), Math.min(sx, W - R)) : px(best.x);
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    marker.setAttribute('cx', String(px(best.x)));
    marker.setAttribute('cy', String(py(best.y)));
    cross.setAttribute('visibility', 'visible');
    marker.setAttribute('visibility', 'visible');
    show([best.tip ?? (opts.xTip ?? opts.xLabel)(best.x), `${Math.round(best.y)}${opts.unit ? ` ${opts.unit}` : ''}`], cx, py(best.y));
  });
  hit.addEventListener('pointerleave', () => {
    hide();
    cross.setAttribute('visibility', 'hidden');
    marker.setAttribute('visibility', 'hidden');
  });
  el.append(hit);
  return el;
  });
  return wrap;
}

/** A row of stat tiles (KPIs). */
export function statTiles(items: [string, string, string?][]) {
  const el = document.createElement('div');
  el.className = 'kpis';
  for (const [label, value, sub] of items) {
    const t = document.createElement('div');
    t.className = 'kpi';
    t.innerHTML = '<span></span><strong></strong>';
    t.querySelector('span')!.textContent = label;
    t.querySelector('strong')!.textContent = value;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      t.append(s);
    }
    el.append(t);
  }
  return el;
}
