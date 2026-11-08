// Bakes the real road lines of the built-in stages into src/routes/real/<id>.ts.
//
//   node scripts/bake-routes.mjs [id ...]      # all stages when no id is given
//
// For each stage in ROUTES it asks BRouter (an OpenStreetMap router that returns SRTM elevation with
// every point) for the road between the waypoints, checks the result against the stage's published
// figures, and writes a compact module: the road's heading every 5 m and its elevation every 20 m,
// both as base64 int8 *changes* (heading in units of 4 mrad, elevation in decimetres). The game maps
// the real length proportionally onto the stage's length (see src/routes/realStage.ts), so a few
// per cent of difference between the two is fine, and it rescales the elevation to the published gain.
//
// Raw BRouter answers are cached in scripts/.cache (not committed), so re-running while tuning the
// processing doesn't hit the server again; delete the folder to refetch. Everything after the fetch is
// deterministic: the same answer always bakes to the same bytes.
//
// Map data: road lines © OpenStreetMap contributors (ODbL), routed with BRouter; elevation SRTM (NASA, public domain).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const OUT = join(ROOT, 'src', 'routes', 'real');

const HEAD_STEP = 5; // metres between heading samples
const ELE_STEP = 20; // metres between elevation samples
const HEAD_UNIT = 0.004; // radians per heading unit
const MAX_TURN_RATE = 0.09; // rad/m: a 11 m radius centreline, so the 9.2 m road never folds on itself
const EARTH_R = 6371000;

/**
 * lonlats: [lon, lat] waypoints (extra ones force the right road). length: the stage's length in
 * metres (src/stages.ts). start/end: the published altitudes, to sanity-check the route.
 * closed: a circuit, forced to close exactly (heading included). noElevation: shape only. trimToTop: a summit
 * finish, cut at the highest point (routing to a waypoint just past it adds a short descent). smoothing: a
 * multiple of the usual elevation smoothing, for a rolling road whose SRTM wobble adds climbing that isn't there.
 * profile: the BRouter profile (default fastbike); 'car-eco' for a road that is closed to bicycles in the map
 * (the Mount Washington Auto Road is tagged bicycle=no: fastbike routes round it over footpaths).
 */
const ROUTES = {
  'alpe-dhuez': {
    lonlats: [[6.0399, 45.0658], [6.0698, 45.0912]],
    length: 14000, start: 723, end: 1841,
  },
  // Prato allo Stelvio up the SS38 through Gomagoi and Trafoi (no waypoint needed: it is the only road).
  stelvio: {
    lonlats: [[10.5897, 46.6196], [10.4533, 46.5287]],
    length: 24500, start: 915, end: 2758,
  },
  // Bédoin up the D974 through Saint-Estève and Chalet Reynard to the summit.
  ventoux: {
    lonlats: [[5.1778, 44.1226], [5.2788, 44.1738]],
    length: 21400, start: 300, end: 1910,
  },
  // Luz-Saint-Sauveur up the D918 through Barèges to the col.
  tourmalet: {
    lonlats: [[-0.004, 42.872], [0.1428, 42.9082]],
    length: 19000, start: 711, end: 2115,
  },
  // Ovaro to the Sella Zoncolan by the Liariis road.
  zoncolan: {
    lonlats: [[12.8673, 46.4835], [12.9301, 46.5049]],
    length: 10100, start: 525, end: 1735, trimToTop: true,
  },
  // Idaho Springs up Colorado 103 (Chicago Creek Road) to Echo Lake.
  'hell-of-the-west': {
    lonlats: [[-105.5131, 39.7427], [-105.597, 39.6612]],
    length: 20800, start: 2293, end: 3235,
  },
  // Rim Rock Drive, Grand Junction entrance (Monument Road side) past Cold Shivers Point and the
  // Saddlehorn visitor center to the Fruita entrance. The waypoints keep the router on the park road:
  // they sit on the drive itself, since one on a viewpoint's parking loop sends the route round the loop.
  'hotw-tour-of-the-moon': {
    lonlats: [[-108.619, 39.044], [-108.6465, 39.0307], [-108.7328, 39.0956], [-108.7379, 39.1316]],
    length: 37000, start: 1440, end: 1440, smoothing: 3,
  },
  // The Morgul-Bismark loop (Superior, Colorado), ridden the way it finished: from the top of the Wall
  // at McCaslin Boulevard and Highway 128, west on 128 to Highway 93, north on 93, east on Highway 170
  // (Marshall Road) and back south down McCaslin to the line. The real loop is longer than the stage's
  // lap, so it is scaled; only its shape is used (the stage keeps its own elevation, with the Wall).
  'hotw-morgul-bismark': {
    lonlats: [[-105.1742, 39.9089], [-105.2133, 39.9139], [-105.23, 39.9269], [-105.23, 39.9441], [-105.218, 39.956], [-105.1933, 39.9622], [-105.1734, 39.9604], [-105.1649, 39.9506], [-105.1658, 39.9336], [-105.1742, 39.9089]],
    length: 21131, closed: true, noElevation: true,
  },
  // Mount Washington Auto Road: the toll house on NH-16 at the foot of the Glen House to the summit parking.
  // The road is tagged bicycle=no (cars only, bicycles on the hill-climb day), so the car profile follows it.
  'mt-washington': {
    lonlats: [[-71.2269798, 44.2890986], [-71.3031133, 44.2699445]],
    length: 12200, start: 499, end: 1917, profile: 'car-eco',
  },
  // Mount Blue Sky Road (CO 5) from Echo Lake Lodge, at the foot of the byway, to the summit parking lot.
  'mt-blue-sky': {
    lonlats: [[-105.596298, 39.656757], [-105.6432544, 39.587607]],
    length: 23300, start: 3231, end: 4307,
  },
  // Mount Diablo: Diablo Road and Mt Diablo Scenic Boulevard in Danville (the Athenian School road; the Mount Diablo
  // Challenge's 11.2 miles), South Gate Road and Summit Road to the summit.
  'mt-diablo': {
    lonlats: [[-121.9529, 37.83193], [-121.9147509, 37.8817362]],
    length: 18000, start: 183, end: 1173,
  },
  // Flagstaff Road, Boulder: from Baseline Road up past Panorama Point and the switchbacks to the crest (7,705 ft), where
  // the road stops climbing (a waypoint a little past it would add the descent to Gross Reservoir).
  flagstaff: {
    lonlats: [[-105.2877748, 40.0000659], [-105.3234, 39.9834]],
    length: 7400, start: 1746, end: 2349,
  },
};

// ---------------------------------------------------------------- fetch ----

async function fetchRoute(id, cfg) {
  const profile = cfg.profile ?? 'fastbike';
  const lonlats = cfg.lonlats.map(([lo, la]) => `${lo},${la}`).join('|');
  const url = `https://brouter.de/brouter?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${id}-${createHash('sha1').update(url).digest('hex').slice(0, 10)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  console.log(`  fetching ${url}`);
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`BRouter said: ${text.slice(0, 200)}`); }
  writeFileSync(file, JSON.stringify(json));
  return json;
}

// ------------------------------------------------------------- geometry ----

/** Smooths with a centred moving average of half-width k, edges handled by shrinking the window. */
function boxSmooth(a, k) {
  const out = new Float64Array(a.length);
  const pre = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - k), hi = Math.min(a.length - 1, i + k);
    out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
  }
  return out;
}

/** The route resampled every metre: x east, z south (as in src/routes/gpx.ts), elevation. */
function resample1m(coords) {
  const [lon0, lat0] = coords[0];
  const kx = (Math.PI / 180) * EARTH_R * Math.cos((lat0 * Math.PI) / 180);
  const kz = (Math.PI / 180) * EARTH_R;
  const xs = coords.map((c) => (c[0] - lon0) * kx);
  const zs = coords.map((c) => -(c[1] - lat0) * kz);
  // Now and then BRouter leaves the elevation off a point (often the last): carry the previous one on.
  const es = [];
  for (const c of coords) es.push(Number.isFinite(c[2]) ? c[2] : es[es.length - 1] ?? 0);
  const ds = [0];
  for (let i = 1; i < xs.length; i++) ds.push(ds[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  const length = ds[ds.length - 1];
  const n = Math.floor(length) + 1;
  const X = new Float64Array(n), Z = new Float64Array(n), E = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const d = i;
    while (j < ds.length - 2 && ds[j + 1] < d) j++;
    const t = ds[j + 1] > ds[j] ? (d - ds[j]) / (ds[j + 1] - ds[j]) : 0;
    X[i] = xs[j] + (xs[j + 1] - xs[j]) * t;
    Z[i] = zs[j] + (zs[j + 1] - zs[j]) * t;
    E[i] = es[j] + (es[j + 1] - es[j]) * t;
  }
  return { X, Z, E, length: n - 1 + (length - Math.floor(length)) };
}

/** Heading (radians, unwrapped) every HEAD_STEP metres from positions smoothed over ~10 m. */
function headings(X, Z, length) {
  const sx = boxSmooth(boxSmooth(X, 3), 3);
  const sz = boxSmooth(boxSmooth(Z, 3), 3);
  const n = Math.floor(length / HEAD_STEP) + 1;
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * HEAD_STEP - HEAD_STEP), b = Math.min(sx.length - 1, i * HEAD_STEP + HEAD_STEP);
    let v = Math.atan2(sz[b] - sz[a], sx[b] - sx[a]);
    if (i) { while (v - h[i - 1] > Math.PI) v -= 2 * Math.PI; while (v - h[i - 1] < -Math.PI) v += 2 * Math.PI; }
    h[i] = v;
  }
  return h;
}

/**
 * Caps how fast the heading may change (a hairpin's centreline can't be tighter than the road is wide),
 * spreading the excess turn onto the neighbouring samples so the total turn is kept.
 */
function limitTurnRate(h) {
  const cap = MAX_TURN_RATE * HEAD_STEP;
  const dh = new Float64Array(h.length - 1);
  for (let i = 0; i < dh.length; i++) dh[i] = h[i + 1] - h[i];
  for (let pass = 0; pass < 2000; pass++) {
    const ex = new Float64Array(dh.length);
    let worst = 0;
    for (let i = 0; i < dh.length; i++) {
      const over = Math.abs(dh[i]) - cap;
      if (over > 0) { ex[i] = Math.sign(dh[i]) * over; dh[i] -= ex[i]; worst = Math.max(worst, over); }
    }
    if (worst < 1e-4) { for (let i = 0; i < dh.length; i++) dh[i] += ex[i]; break; }
    // Hand the excess to the neighbours (reflecting at the ends so the sum is kept).
    for (let i = 0; i < dh.length; i++) {
      if (!ex[i]) continue;
      for (const o of [-2, -1, 0, 1, 2]) {
        let j = i + o;
        if (j < 0) j = -j - 1;
        if (j >= dh.length) j = 2 * dh.length - j - 1;
        dh[Math.max(0, Math.min(dh.length - 1, j))] += ex[i] / 5;
      }
    }
  }
  const out = new Float64Array(h.length);
  out[0] = h[0];
  for (let i = 0; i < dh.length; i++) out[i + 1] = out[i] + dh[i];
  return out;
}

/** Position after integrating the heading samples (linear between them) over their whole length. */
function endOffset(h) {
  let x = 0, z = 0;
  for (let i = 0; i < h.length - 1; i++) {
    const m = (h[i] + h[i + 1]) / 2;
    x += Math.cos(m) * HEAD_STEP;
    z += Math.sin(m) * HEAD_STEP;
  }
  return [x, z];
}

/** Nudges a circuit's heading so it closes exactly: it turns a whole 2π and the end meets the start. */
function closeLoop(h) {
  const n = h.length;
  const out = new Float64Array(h);
  // A whole number of turns (one, unless the road crosses itself): spread the leftover linearly, then
  // trim the position error with two sine bumps that vanish at both ends (so the heading's start and end stay put).
  const left = Math.round((h[n - 1] - h[0]) / (2 * Math.PI)) * 2 * Math.PI - (h[n - 1] - h[0]);
  if (Math.abs(left) > 0.6) console.warn(`  WARNING: the loop's start and end headings differ by ${(left * 57.3).toFixed(0)} degrees: start it on a straight`);
  for (let i = 0; i < n; i++) out[i] += (left * i) / (n - 1);
  const basis = [1, 2].map((k) => Float64Array.from({ length: n }, (_, i) => Math.sin((k * Math.PI * i) / (n - 1))));
  const coef = [0, 0];
  for (let it = 0; it < 12; it++) {
    const cur = Float64Array.from(out, (v, i) => v + coef[0] * basis[0][i] + coef[1] * basis[1][i]);
    const [ex, ez] = endOffset(cur);
    if (Math.hypot(ex, ez) < 0.05) break;
    // Jacobian by finite differences.
    const J = [0, 1].map((k) => {
      const t = Float64Array.from(cur, (v, i) => v + 1e-3 * basis[k][i]);
      const [tx, tz] = endOffset(t);
      return [(tx - ex) / 1e-3, (tz - ez) / 1e-3];
    });
    const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
    coef[0] -= (ex * J[1][1] - ez * J[1][0]) / det;
    coef[1] -= (ez * J[0][0] - ex * J[0][1]) / det;
  }
  return Float64Array.from(out, (v, i) => v + coef[0] * basis[0][i] + coef[1] * basis[1][i]);
}

/** Running median with half-width k: drops the spikes where SRTM's 90 m cells straddle a cliff or a tunnel. */
function medianFilter(a, k) {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const w = Array.from(a.subarray(Math.max(0, i - k), Math.min(a.length, i + k + 1))).sort((x, y) => x - y);
    out[i] = w[w.length >> 1];
  }
  return out;
}

/** Elevation smoothed over ~100 m (SRTM is 90 m cells, so finer is noise), sampled every ELE_STEP metres. */
function elevations(E, length, k = 1) {
  const s = boxSmooth(boxSmooth(boxSmooth(medianFilter(E, Math.round(60 * k)), Math.round(30 * k)), Math.round(30 * k)), Math.round(20 * k));
  const n = Math.ceil(length / ELE_STEP) + 1;
  const e = Float64Array.from({ length: n }, (_, i) => s[Math.min(s.length - 1, Math.round(Math.min(i * ELE_STEP, length)))]);
  // No road is steeper than ~35% over 20 m; where SRTM says so (tunnels, cliff edges) cap it, and spread what
  // that took off the end over the whole road so the finish altitude stays right.
  const cap = ELE_STEP * 0.35;
  const out = new Float64Array(n);
  out[0] = e[0];
  for (let i = 1; i < n; i++) out[i] = out[i - 1] + Math.max(-cap, Math.min(cap, e[i] - e[i - 1]));
  const drift = e[n - 1] - out[n - 1];
  for (let i = 0; i < n; i++) out[i] += (drift * i) / (n - 1);
  return out;
}

// ------------------------------------------------------------- encoding ----

/** Integers whose steps fit an int8, cumulative rounding error carried forward so it never drifts. */
function deltas(values, unit) {
  const out = [];
  let prev = 0;
  for (let i = 1; i < values.length; i++) {
    const q = Math.round((values[i] - values[0]) / unit);
    const d = q - prev;
    if (d < -127 || d > 127) throw new Error(`step ${d} at sample ${i} does not fit an int8`);
    out.push(d);
    prev = q;
  }
  return Buffer.from(Int8Array.from(out).buffer).toString('base64');
}

function wrap(s) {
  return s.match(/.{1,100}/g).map((l) => `  '${l}'`).join(' +\n');
}

function moduleText(id, cfg, length, h, e) {
  return `// Generated by scripts/bake-routes.mjs (${id}); do not edit. Road line © OpenStreetMap contributors (ODbL),
// routed with BRouter; elevation SRTM (NASA, public domain).
import type { RealRouteData } from '../realRoute';

const data: RealRouteData = {
  length: ${length.toFixed(1)},
  head0: ${Math.round(h[0] / HEAD_UNIT)},
  ele0: ${e ? Math.round(e[0] * 10) : 0},
  head:
${wrap(deltas(h, HEAD_UNIT))},
  ele: ${e ? `\n${wrap(deltas(e, 0.1))}` : "''"},
};
export default data;
`;
}

// ----------------------------------------------------------------- main ----

async function bake(id, cfg) {
  console.log(id);
  const json = await fetchRoute(id, cfg);
  const coords = json.features[0].geometry.coordinates;
  let { X, Z, E, length } = resample1m(coords);
  if (cfg.trimToTop) {
    // A summit finish ends at the highest point; routing to a waypoint just past it adds a short descent.
    const s = boxSmooth(E, 30);
    let top = s.length - 1;
    for (let i = s.length - 1; i > s.length * 0.9; i--) if (s[i] >= s[top] - 1e-9) top = i;
    for (let i = s.length - 1; i > s.length * 0.9; i--) if (s[i] > s[top]) top = i;
    X = X.slice(0, top + 1); Z = Z.slice(0, top + 1); E = E.slice(0, top + 1); length = top;
  }
  let h = limitTurnRate(headings(X, Z, length));
  if (cfg.closed) h = closeLoop(h);
  const e = cfg.noElevation ? null : elevations(E, length, cfg.smoothing);

  // Report against the published figures.
  const gain = e ? e.reduce((a, v, i) => a + (i ? Math.max(0, v - e[i - 1]) : 0), 0) : 0;
  let turns = 0;
  for (let i = 1; i < h.length; i++) turns += Math.abs(h[i] - h[i - 1]);
  console.log(`  length ${length.toFixed(0)} m (stage ${cfg.length}, ${(((length / cfg.length) - 1) * 100).toFixed(1)}%)`);
  if (e) console.log(`  elevation ${e[0].toFixed(0)} -> ${e[e.length - 1].toFixed(0)} m (published ${cfg.start} -> ${cfg.end}), gain ${gain.toFixed(0)} m`);
  console.log(`  total turning ${(turns / Math.PI).toFixed(1)} pi; loop closing error ${endOffset(h).map((v) => v.toFixed(2)).join(', ')} m`);
  if (Math.abs(length / cfg.length - 1) > 0.08 && !cfg.closed) console.warn(`  WARNING: length is more than 8% off the stage's`);
  if (e && (Math.abs(e[0] - cfg.start) > 40 || Math.abs(e[e.length - 1] - cfg.end) > 60)) console.warn('  WARNING: start or end altitude is far from the published one');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${id}.ts`), moduleText(id, cfg, length, h, e));
}

const wanted = process.argv.slice(2);
for (const [id, cfg] of Object.entries(ROUTES)) {
  if (wanted.length && !wanted.includes(id)) continue;
  await bake(id, cfg);
}
