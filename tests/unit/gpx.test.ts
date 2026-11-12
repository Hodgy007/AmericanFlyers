// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseGpx, routeToStage } from '../../src/routes/gpx';

// A ~1.1 km out-and-up route heading north-east, climbing 40 m.
function makeGpx(opts: { ele?: boolean; n?: number; tag?: 'trkpt' | 'rtept' } = {}) {
  const { ele = true, n = 12, tag = 'trkpt' } = opts;
  const pts = Array.from({ length: n }, (_, i) => {
    const lat = (39.7392 + i * 0.001).toFixed(6);
    const lon = (-104.9903 + i * 0.0006).toFixed(6);
    return `<${tag} lat="${lat}" lon="${lon}">${ele ? `<ele>${1600 + i * 4}</ele>` : ''}</${tag}>`;
  });
  const body = tag === 'trkpt' ? `<trk><name>Test Hill</name><trkseg>${pts.join('')}</trkseg></trk>` : `<rte><name>Route Hill</name>${pts.join('')}</rte>`;
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><metadata></metadata>${body}</gpx>`;
}

describe('parseGpx', () => {
  it('reads track points, name and elevation', () => {
    const r = parseGpx('x.gpx', makeGpx());
    expect(r.name).toBe('Test Hill');
    expect(r.points).toHaveLength(12);
    expect(r.hasElevation).toBe(true);
    expect(r.points[0]).toEqual([39.7392, -104.9903, 1600]);
    expect(r.points[11][2]).toBe(1644);
    expect(r.id).toMatch(/^gpx-/);
  });

  it('falls back to route points and to the file name', () => {
    const r = parseGpx('x.gpx', makeGpx({ tag: 'rtept' }));
    expect(r.name).toBe('Route Hill');
    const noName = makeGpx().replace('<name>Test Hill</name>', '');
    expect(parseGpx('My Ride.gpx', noName).name).toBe('My Ride');
  });

  it('handles files without elevation', () => {
    const r = parseGpx('x.gpx', makeGpx({ ele: false }));
    expect(r.hasElevation).toBe(false);
    expect(r.points.every((p) => p[2] === 0)).toBe(true);
  });

  it('thins out points closer than 5 m', () => {
    const dense = `<gpx><trk><trkseg>
      <trkpt lat="40" lon="-105"><ele>1</ele></trkpt>
      <trkpt lat="40.00001" lon="-105"><ele>1</ele></trkpt>
      <trkpt lat="40.002" lon="-105"><ele>1</ele></trkpt>
    </trkseg></trk></gpx>`;
    expect(parseGpx('d.gpx', dense).points).toHaveLength(2);
  });

  it('rejects bad XML, too few points, and a single-spot route', () => {
    expect(() => parseGpx('a.gpx', '<gpx><trk>')).toThrow(/not valid GPX/);
    expect(() => parseGpx('a.gpx', '<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>')).toThrow(/No track or route points/);
    const same = '<gpx><trk><trkseg><trkpt lat="40" lon="-105"/><trkpt lat="40" lon="-105"/></trkseg></trk></gpx>';
    expect(() => parseGpx('a.gpx', same)).toThrow(/too short/);
  });
});

describe('routeToStage', () => {
  const stage = routeToStage(parseGpx('x.gpx', makeGpx()));

  it('builds a finite, uploaded stage about as long as the route', () => {
    expect(stage.uploaded).toBe(true);
    expect(stage.finish!).toBeGreaterThan(1100);
    expect(stage.finish!).toBeLessThan(1500);
    expect(stage.tagline).toContain('Your GPX route');
  });

  it('follows the route\'s climb (smoothed, so approximately)', () => {
    expect(stage.elevationAt(0)).toBe(0);
    const top = stage.elevationAt(stage.finish!);
    expect(top).toBeGreaterThan(25);
    expect(top).toBeLessThan(50);
    expect(stage.elevationAt(stage.finish! + 500)).toBe(top);
    expect(stage.elevationAt(stage.finish! / 2)).toBeLessThan(top);
  });

  it('heads north-east (z is south, x is east: heading between -90 and 0 degrees)', () => {
    const h = stage.headingAt(stage.finish! / 2);
    expect(h).toBeGreaterThan(-Math.PI / 2);
    expect(h).toBeLessThan(0);
  });

  it('a route without elevation rides flat', () => {
    const flat = routeToStage(parseGpx('x.gpx', makeGpx({ ele: false })));
    expect(flat.elevationAt(flat.finish!)).toBe(0);
    expect(flat.tagline).toContain('rides flat');
  });
});

describe('import limits and degenerate routes', () => {
  const straight = (pts: [number, number, number][]) => ({ id: 'gpx-straight', name: 'Straight', points: pts, hasElevation: true });

  it('a dead-straight east-west route still has finite terrain everywhere', () => {
    // Exactly collinear samples make the scenery plane singular: it used to fill every height with NaN.
    const points: [number, number, number][] = Array.from({ length: 40 }, (_, i) => [39.7392, -104.9903 + i * 0.001, 1600 + i]);
    const stage = routeToStage(straight(points));
    const s = stage.scenery!;
    for (const [x, z] of [[0, 0], [600, 0], [1200, 30], [-400, -30]]) {
      const h = s.wildHeight(x, z);
      expect(Number.isFinite(h), `${x},${z}`).toBe(true);
    }
    expect(Number.isFinite(stage.elevationAt(stage.finish! / 2))).toBe(true);
  });

  it('rejects a file that jumps between distant points', () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="39.7" lon="-104.9"><ele>1600</ele></trkpt>
      <trkpt lat="45.0" lon="-104.9"><ele>1600</ele></trkpt>
    </trkseg></trk></gpx>`;
    expect(() => parseGpx('x.gpx', gpx)).toThrow(/jumps/);
  });

  it('rejects coordinates outside the map range and absurd elevations', () => {
    const bad = (lat: number, ele: number) => `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="${lat}" lon="-104.9"><ele>${ele}</ele></trkpt>
      <trkpt lat="39.7002" lon="-104.9"><ele>${ele}</ele></trkpt>
    </trkseg></trk></gpx>`;
    expect(() => parseGpx('x.gpx', bad(120, 1600))).toThrow(/too short/);
    expect(() => parseGpx('x.gpx', bad(39.7, 20_000))).toThrow(/elevation/);
  });

  it('a corrupt stored route is rejected before it is built', () => {
    expect(() => routeToStage({ id: '', name: 'x', points: [[0, 0, 0], [0, 0, 0]], hasElevation: false })).toThrow();
    expect(() => routeToStage({ id: 'ok', name: 'x', points: [[0, 0, 0], [NaN, 0, 0]], hasElevation: false })).toThrow(/point/);
  });
});
