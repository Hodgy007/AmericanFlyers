// GPX routes: parse a .gpx file into points, and turn a route into a Stage
// whose road follows the route's bends and elevation profile.

import { FARM_LANDMARKS, finishArch, fitPlane, startArch, type Stage } from '../stages';
import { fbm, smoothstep } from '../world/noise';

export interface StoredRoute {
  id: string;
  name: string;
  points: [number, number, number][]; // lat, lon, elevation (m)
  hasElevation: boolean;
}

const EARTH_R = 6371000;
const MIN_SPACING = 5; // metres between kept points
const STEP = 5; // resampling step along the route, metres
const MAX_GRADE = 0.25;

// ----------------------------------------------------------------- parse ----

export function parseGpx(fileName: string, text: string): StoredRoute {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This file is not valid GPX (XML).');
  // Track points first; fall back to route points.
  let nodes = Array.from(doc.getElementsByTagNameNS('*', 'trkpt'));
  if (nodes.length < 2) nodes = Array.from(doc.getElementsByTagNameNS('*', 'rtept'));
  if (nodes.length < 2) throw new Error('No track or route points found in this GPX file.');

  const raw = nodes.map((n): [number, number, number] => {
    const ele = n.getElementsByTagNameNS('*', 'ele')[0]?.textContent;
    return [Number(n.getAttribute('lat')), Number(n.getAttribute('lon')), ele ? Number(ele) : NaN];
  }).filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
  const hasElevation = raw.filter((p) => Number.isFinite(p[2])).length > raw.length * 0.8;

  // Thin out points closer than MIN_SPACING and fill missing elevations.
  const points: [number, number, number][] = [];
  let lastEle = raw.find((p) => Number.isFinite(p[2]))?.[2] ?? 0;
  for (const [lat, lon, ele] of raw) {
    const e = hasElevation && Number.isFinite(ele) ? ele : hasElevation ? lastEle : 0;
    lastEle = e;
    const prev = points[points.length - 1];
    if (prev && haversine(prev[0], prev[1], lat, lon) < MIN_SPACING) continue;
    points.push([round(lat, 6), round(lon, 6), round(e, 1)]);
  }
  if (points.length < 2) throw new Error('This route is too short.');

  const name =
    text1(doc, 'metadata', 'name') || text1(doc, 'trk', 'name') || text1(doc, 'rte', 'name') ||
    fileName.replace(/\.gpx$/i, '');
  return { id: `gpx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, points, hasElevation };
}

function text1(doc: Document, parent: string, child: string) {
  const p = doc.getElementsByTagNameNS('*', parent)[0];
  const c = p && Array.from(p.children).find((e) => e.localName === child);
  return c?.textContent?.trim() ?? '';
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

// ------------------------------------------------------------------ build ----

export function routeToStage(route: StoredRoute): Stage {
  const pts = route.points;
  // Local flat projection: x = east, z = south (so turns aren't mirrored in the world).
  const [lat0, lon0] = pts[0];
  const kx = (Math.PI / 180) * EARTH_R * Math.cos((lat0 * Math.PI) / 180);
  const kz = (Math.PI / 180) * EARTH_R;
  const xs: number[] = [], zs: number[] = [], es: number[] = [], ds: number[] = [0];
  for (let i = 0; i < pts.length; i++) {
    xs.push((pts[i][1] - lon0) * kx);
    zs.push(-(pts[i][0] - lat0) * kz);
    es.push(pts[i][2]);
    if (i) ds.push(ds[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  const length = ds[ds.length - 1];

  // Resample every STEP metres along the route.
  const n = Math.max(2, Math.floor(length / STEP) + 1);
  const X = new Float64Array(n), Z = new Float64Array(n), E = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const d = Math.min(i * STEP, length);
    while (j < ds.length - 2 && ds[j + 1] < d) j++;
    const t = ds[j + 1] > ds[j] ? (d - ds[j]) / (ds[j + 1] - ds[j]) : 0;
    X[i] = xs[j] + (xs[j + 1] - xs[j]) * t;
    Z[i] = zs[j] + (zs[j + 1] - zs[j]) * t;
    E[i] = es[j] + (es[j + 1] - es[j]) * t;
  }

  // GPS elevation is noisy: smooth over ~80 m, then cap the gradient.
  const smoothE = smooth(smooth(E, 8), 8);
  const elev = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const g = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, (smoothE[i] - smoothE[i - 1]) / STEP));
    elev[i] = elev[i - 1] + g * STEP;
  }

  // Heading from the smoothed track, unwrapped so it can be interpolated.
  const sx = smooth(X, 2), sz = smooth(Z, 2);
  const head = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    let h = Math.atan2(sz[b] - sz[a], sx[b] - sx[a]);
    if (i) while (h - head[i - 1] > Math.PI) h -= 2 * Math.PI;
    if (i) while (h - head[i - 1] < -Math.PI) h += 2 * Math.PI;
    head[i] = h;
  }
  const heading = smooth(head, 2);

  const sample = (arr: Float64Array, d: number) => {
    const f = Math.max(0, Math.min(n - 1, d / STEP));
    const i = Math.min(n - 2, Math.floor(f));
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  };
  const top = elev[n - 1];
  const elevationAt = (d: number) => (d <= 0 ? 0 : d >= length ? top : sample(elev, d));
  const headingAt = (d: number) => sample(heading, Math.max(0, Math.min(length, d)));

  // Scenery scaled to the route: a plane through the road's rise, plus hills
  // in proportion to how much the route climbs.
  let lo = Infinity, hi = -Infinity;
  for (const e of elev) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
  const range = hi - lo;
  let x = 0, z = 0;
  const planePts: [number, number, number][] = [];
  for (let d = 0; d < length; d += STEP) {
    const h = headingAt(d + STEP / 2);
    x += Math.cos(h) * STEP;
    z += Math.sin(h) * STEP;
    if (d % 100 === 0) planePts.push([x, z, elevationAt(d)]);
  }
  const plane = planePts.length >= 3 ? fitPlane(planePts) : () => 0;
  const hilliness = Math.max(0.15, Math.min(1, range / 900));
  const wildHeight = (wx: number, wz: number) => {
    const base = Math.max(lo - 40, Math.min(hi + 150, plane(wx, wz)));
    return base + 20 + fbm(wx / 1300, wz / 1300, 4) * 260 * hilliness + (1 - Math.abs(fbm(wx / 420 + 7, wz / 420 - 3, 3))) * 170 * hilliness;
  };

  const baseAltitude = route.hasElevation ? pts[0][2] : 0;
  const alpine = route.hasElevation && baseAltitude + hi > 1400;
  const km = (length / 1000).toFixed(1);
  return {
    id: route.id,
    name: route.name,
    tagline: `Your GPX route: ${km} km, ${Math.round(climbing(elev))} m of climbing.${route.hasElevation ? '' : ' (No elevation in the file, so it rides flat.)'}`,
    finish: length,
    elevationAt,
    headingAt,
    scenery: {
      wildHeight,
      bumpAmp: 5 + 7 * hilliness,
      // Rock, snow and tree lines at their real-world altitudes.
      rockLine: alpine ? 2300 - baseAltitude : hi + 400,
      snowLine: alpine ? 2800 - baseAltitude : hi + 900,
      treeLine: alpine ? 2000 - baseAltitude : hi + 300,
      coniferBias: baseAltitude > 800 ? 0.85 : 0.4,
      forestCover: alpine ? 0.25 : 0.05,
      fields: !alpine,
      mountainScale: 1 + 2.4 * smoothstep(300, 1500, range),
    },
    landmarks: [startArch, finishArch(length), ...(alpine ? [] : FARM_LANDMARKS)],
    signs: [],
    baseAltitude,
    uploaded: true,
  };
}

function climbing(elev: Float64Array) {
  let c = 0;
  for (let i = 1; i < elev.length; i++) c += Math.max(0, elev[i] - elev[i - 1]);
  return c;
}

/** Centred moving average with half-width `k` samples. */
function smooth(a: Float64Array, k: number) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(a.length - 1, i + k); j++) { sum += a[j]; cnt++; }
    out[i] = sum / cnt;
  }
  return out;
}
