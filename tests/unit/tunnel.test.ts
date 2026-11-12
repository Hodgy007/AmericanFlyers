// Raven Gap's tunnel: the pure span helpers, the tube's geometry, the hill over it, the world's ground along the span and what must not appear there
// (trees, ground cover, spectators, guardrails). The road's elevation and heading are untouched: the lap, the segments and the limits stay pinned
// in worlds.test.ts, segments.test.ts and stageLimits.test.ts.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { barrierSections } from '../../src/world/barriers';
import { crowdAt } from '../../src/world/crowdZones';
import { planCrowd } from '../../src/world/crowds';
import { planCell, CELL, BANDS, LAT_MIN, type GroundAt } from '../../src/world/groundCover';
import { buildMonument } from '../../src/world/monuments';
import { LAYER } from '../../src/world/scenery';
import { TUNNEL_BAY, tunnelGeometry, tunnelProfile } from '../../src/world/tunnel';
import {
  COVER_LATERAL, COVER_MARGIN, TUNNEL_CROWN, TUNNEL_HALF_WIDTH, TUNNEL_HILL, TUNNEL_PORTAL_DEPTH, TUNNEL_WALL, coveredByTunnel, tunnelAt, vaultHeight,
} from '../../src/world/tunnelSpan';
import { KESTREL_VALE, KV, KV_LAP } from '../../src/worlds/kestrelVale';

const [A, B] = [KV.tunnel.from, KV.tunnel.to];
const straight = (d: number) => ({ x: d, y: 0, z: 0, heading: 0 });
const origin = { x: 0, z: 0 };

describe('tunnel spans', () => {
  const spans = [{ from: 100, to: 200 }, { from: 1000, to: 1100 }, { from: 5000, to: 5200 }];
  it('finds the span that holds a distance, widened by a margin, by binary search', () => {
    expect(tunnelAt(spans, 150)).toBe(spans[0]);
    expect(tunnelAt(spans, 100)).toBe(spans[0]);
    expect(tunnelAt(spans, 200)).toBe(spans[0]);
    expect(tunnelAt(spans, 99.9)).toBeNull();
    expect(tunnelAt(spans, 201)).toBeNull();
    expect(tunnelAt(spans, 96, 4)).toBe(spans[0]);
    expect(tunnelAt(spans, 5204, 4)).toBe(spans[2]);
    expect(tunnelAt(spans, 1050)).toBe(spans[1]);
    expect(tunnelAt(spans, 3000, 50)).toBeNull();
    expect(tunnelAt(undefined, 150)).toBeNull();
    expect(tunnelAt([], 150)).toBeNull();
  });
  it('counts ground near a span as covered, within COVER_LATERAL of the road and COVER_MARGIN of its ends', () => {
    expect(coveredByTunnel(spans, { d: 150, dist: 3 })).toBe(true);
    expect(coveredByTunnel(spans, { d: 150, dist: COVER_LATERAL - 1 })).toBe(true);
    expect(coveredByTunnel(spans, { d: 150, dist: COVER_LATERAL + 1 })).toBe(false);
    expect(coveredByTunnel(spans, { d: 100 - COVER_MARGIN + 1, dist: 5 })).toBe(true);
    expect(coveredByTunnel(spans, { d: 100 - COVER_MARGIN - 1, dist: 5 })).toBe(false);
    expect(coveredByTunnel(undefined, { d: 150, dist: 3 })).toBe(false);
    expect(coveredByTunnel(spans, null)).toBe(false);
  });
});

describe('the tube', () => {
  it('has a profile a little wider than the 9.2 m road and about 6 m high, symmetric, walls then a vault', () => {
    const p = tunnelProfile();
    expect(TUNNEL_HALF_WIDTH * 2).toBeGreaterThan(9.2);
    expect(Math.max(...p.map(([, y]) => y))).toBeCloseTo(TUNNEL_CROWN, 6);
    expect(TUNNEL_CROWN).toBeGreaterThanOrEqual(5.5);
    expect(TUNNEL_CROWN).toBeLessThanOrEqual(7);
    expect(Math.max(...p.map(([x]) => Math.abs(x)))).toBeCloseTo(TUNNEL_HALF_WIDTH, 6);
    for (const [x, y] of p) { const m = p.find(([x2, y2]) => Math.abs(x2 + x) < 1e-9 && Math.abs(y2 - y) < 1e-9); expect(m, `${x},${y}`).toBeDefined(); }
    expect(vaultHeight(0)).toBeCloseTo(TUNNEL_CROWN, 6);
    expect(vaultHeight(TUNNEL_HALF_WIDTH)).toBeCloseTo(TUNNEL_WALL, 6);
  });

  it('builds a shell whose faces all look in at the road, inside its profile, and lamps and a hill that stay out of the road', () => {
    const g = tunnelGeometry([{ from: 0, to: 60, roof: () => 12 }], 0, 100, straight, origin);
    const shell = g.shell!;
    const pos = shell.attributes.position;
    const idx = shell.index!;
    expect(idx.count / 3).toBeGreaterThan(300);
    let outward = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const v = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(t + i)));
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0])).normalize();
      const c = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
      // The axis of the tube at this height: the middle of the road at 3 m up (a face looks in if its normal points at it).
      const toAxis = new THREE.Vector3(0, 3 - c.y, -c.z);
      if (n.dot(toAxis) <= 0) outward++;
    }
    expect(outward).toBe(0);
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(TUNNEL_HALF_WIDTH + 1e-6);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(pos.getY(i)).toBeLessThanOrEqual(TUNNEL_CROWN + 1e-6);
      expect(pos.getX(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(pos.getX(i)).toBeLessThanOrEqual(60 + 1e-6); // only the span's part of the chunk
    }
    const lamps = g.lamps!.attributes.position;
    for (let i = 0; i < lamps.count; i++) {
      expect(lamps.getY(i)).toBeGreaterThan(TUNNEL_WALL);
      expect(lamps.getY(i)).toBeLessThan(TUNNEL_CROWN);
    }
    // A lamp every bay, in two rows: 10 bays in 60 m, 24 vertices a box.
    expect(lamps.count / 24).toBe(2 * (60 / TUNNEL_BAY));
    // The hill faces up and lies over the vault.
    const hill = g.hill!;
    const hp = hill.attributes.position;
    const hn = hill.attributes.normal;
    for (let i = 0; i < hn.count; i++) expect(hn.getY(i), `hill vertex ${i}`).toBeGreaterThan(0);
    for (let i = 0; i < hp.count; i++) if (Math.abs(hp.getZ(i)) < TUNNEL_HALF_WIDTH) expect(hp.getY(i)).toBeGreaterThan(TUNNEL_CROWN);
  });

  it('is a handful of draw calls a chunk: one shell, one set of lamps, one hill', () => {
    const g = tunnelGeometry([{ from: 0, to: 300, roof: () => 12 }], 100, 200, straight, origin);
    expect([g.shell, g.lamps, g.hill].filter(Boolean)).toHaveLength(3);
    expect(g.shell!.index!.count / 3 + g.hill!.index!.count / 3, 'triangles a chunk').toBeLessThan(2600);
  });

  it('meets its neighbour chunk on the same ring, so the shell has no gap at a chunk boundary', () => {
    const spans = [{ from: 13, to: 330, roof: () => 12 }];
    const ring = (geo: THREE.BufferGeometry, last: boolean) => {
      const p = geo.attributes.position;
      const n = tunnelProfile().length + 2;
      const start = last ? p.count - n : 0;
      return Array.from({ length: n }, (_, i) => [p.getX(start + i), p.getY(start + i), p.getZ(start + i)].map((v) => +v.toFixed(5)));
    };
    const a = tunnelGeometry(spans, 0, 100, straight, origin).shell!;
    const b = tunnelGeometry(spans, 100, 200, straight, origin).shell!;
    expect(ring(a, true)).toEqual(ring(b, false));
    // The ends of the span are the portals' faces exactly.
    const first = tunnelGeometry(spans, 0, 100, straight, origin).shell!.attributes.position;
    expect(first.getX(0)).toBeCloseTo(13, 6);
    expect(tunnelGeometry(spans, 300, 400, straight, origin).shell!.attributes.position.getX(0)).toBeCloseTo(300, 6);
    expect(tunnelGeometry(spans, 400, 500, straight, origin).shell).toBeNull();
  });

  it('follows a curving, climbing road: the rings stay perpendicular to it and the vault keeps its height above the road', () => {
    const curve = (d: number) => ({ x: 100 * Math.sin(d / 100), y: d * 0.05, z: 100 * (1 - Math.cos(d / 100)), heading: d / 100 });
    const pos = tunnelGeometry([{ from: 0, to: 40 }], 0, 40, curve, origin).shell!.attributes.position;
    const n = tunnelProfile().length + 2;
    const rows = pos.count / n;
    for (let r = 0; r < rows; r++) {
      const crown = [...Array(n).keys()].map((i) => i + r * n).reduce((best, i) => (pos.getY(i) > pos.getY(best) ? i : best));
      const road = curve([...Array(rows).keys()].length ? (r === rows - 1 ? 40 : r * 2) : 0);
      expect(pos.getY(crown) - road.y).toBeCloseTo(TUNNEL_CROWN, 4);
    }
  });
});

describe('the portal monument', () => {
  const g = buildMonument('tunnel-portal', { lines: ['RAVEN GAP TUNNEL', 'ALT. 300 m'] });
  const box = new THREE.Box3().setFromObject(g);
  it('is a wall across the cutting with the tunnel’s profile cut in it, the same depth as the tube expects, on both faces', () => {
    expect(box.max.y).toBeGreaterThan(10);
    expect(box.max.y).toBeLessThan(13);
    expect(box.max.x - box.min.x).toBeGreaterThan(20);
    expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(TUNNEL_PORTAL_DEPTH);
    expect(box.max.z - box.min.z).toBeLessThan(TUNNEL_PORTAL_DEPTH + 2);
    // Two text boards, one each side.
    const panels = g.children.filter((c) => (c as THREE.Mesh).geometry && !(c as THREE.Mesh).geometry.attributes.color);
    expect(panels).toHaveLength(2);
    expect(panels[0].position.z).toBeGreaterThan(0);
    expect(panels[1].position.z).toBeLessThan(0);
    expect(g.userData.shadows).toBe(true);
  });
});

describe('Raven Gap', () => {
  const lapStage = stageById('kestrel-vale-loop');
  const sc = KESTREL_VALE.scenery;

  it('has one tunnel of about 320 m through the ridge, on the cutting’s straight, with the road’s elevation and heading unchanged', () => {
    expect(sc.tunnels).toEqual([KV.tunnel]);
    expect(B - A).toBeGreaterThan(300);
    expect(B - A).toBeLessThan(340);
    expect(A).toBeGreaterThan(KV.gap[0]);
    expect(B).toBeLessThan(KV.gap[1]);
    // The cutting's piece is a dead-straight, level road (the elevation and heading are the plain climb's: pinned elsewhere).
    for (let u = A; u <= B; u += 20) {
      expect(KESTREL_VALE.headingAt(u)).toBeCloseTo(KESTREL_VALE.headingAt(A), 9);
      expect(KESTREL_VALE.elevationAt(u)).toBeCloseTo(300, 6);
    }
    // The tube ends are the portals' faces.
    const portals = KESTREL_VALE.landmarks.filter((k) => k.model === 'tunnel-portal').sort((a, b) => a.first - b.first);
    expect(portals).toHaveLength(2);
    expect(portals[0].first - TUNNEL_PORTAL_DEPTH / 2).toBeCloseTo(A, 9);
    expect(portals[1].first + TUNNEL_PORTAL_DEPTH / 2).toBeCloseTo(B, 9);
    for (const p of portals) { expect(p.side).toBe(0); expect(p.span).toBe('across'); expect(p.every).toBe(KV_LAP); }
  });

  it('closes the hill over the road: the roof is at least 6 m over the centreline from just inside each portal, and over the vault everywhere in the span', () => {
    const roof = KV.tunnel.roof!;
    for (let u = A + TUNNEL_PORTAL_DEPTH; u <= B - TUNNEL_PORTAL_DEPTH; u += 5) expect(roof(u, 0), `${u}`).toBeGreaterThanOrEqual(6);
    for (let u = A; u <= B; u += 2) {
      for (let lat = -TUNNEL_HALF_WIDTH; lat <= TUNNEL_HALF_WIDTH; lat += 0.7) expect(roof(u, lat), `${u}/${lat}`).toBeGreaterThanOrEqual(vaultHeight(lat) + 0.5);
    }
    // In the middle it is a real hill: well over the vault.
    expect(roof((A + B) / 2, 0)).toBeGreaterThan(15);
  });

  it('digs the terrain out below the road over the slot, so no slope of it shows inside a portal, and meets the roof at the slot’s edge', () => {
    const rel = sc.roadside!;
    for (let u = A; u <= B; u += 1.5) {
      for (let lat = -TUNNEL_HALF_WIDTH - 2; lat <= TUNNEL_HALF_WIDTH + 2; lat += 0.5) expect(rel(u, lat, 4)!, `${u}/${lat}`).toBeLessThanOrEqual(1e-6);
    }
    for (let u = A + 4; u <= B - 4; u += 7) expect(rel(u, 0, 4)!).toBeLessThan(-4); // the slot's floor
    // From the slot's edge outwards the ground is the hill: no step against the roof.
    for (let u = A; u <= B; u += 9) {
      for (const side of [-1, 1]) {
        expect(rel(u, side * TUNNEL_HILL, 4)!, `${u}`).toBeCloseTo(KV.tunnel.roof!(u, side * TUNNEL_HILL), 6);
        expect(rel(u, side * (TUNNEL_HILL + 8), 4)!).toBeGreaterThan(5);
      }
    }
  });

  it('lets the ridge fade back outside the span: the cutting is open at the centre again, with its walls, short of each portal', () => {
    const rel = sc.roadside!;
    for (const u of [A - 40, A - 10, B + 10, B + 40]) {
      expect(rel(u, 0, 4)!, `${u}`).toBeCloseTo(0, 6);
      expect(rel(u, 6, 4)!).toBeCloseTo(0, 6);
      expect(Math.abs(rel(u, 25, 4)!), 'the cutting walls stand either side').toBeGreaterThan(1);
    }
  });

  describe('as routes', () => {
    it('gives every lap of a route its own tunnel, cut to the route and shifted like the other per-distance data', () => {
      const s = (id: string) => stageById(id).scenery.tunnels!;
      expect(s('kestrel-vale-loop').map((t) => [t.from, t.to])).toEqual([[A, B]]);
      expect(s('kestrel-vale-grand').map((t) => [t.from, t.to])).toEqual([0, 1, 2].map((k) => [A + k * KV_LAP, B + k * KV_LAP]));
      expect(s('kestrel-vale-raven-scar').map((t) => [t.from, t.to])).toEqual([[A - 5900, B - 5900]]);
      expect(stageById('kestrel-vale-lakeside').scenery.tunnels).toEqual([]);
      const free = s('kestrel-vale');
      expect(free.length).toBeGreaterThan(100);
      expect(free[3].from).toBeCloseTo(A + 3 * KV_LAP, 6);
      // The roofs follow: the second lap's roof is the lap's.
      expect(s('kestrel-vale-grand')[1].roof!(A + KV_LAP + 50, 0)).toBeCloseTo(KV.tunnel.roof!(A + 50, 0), 9);
      expect(s('kestrel-vale-raven-scar')[0].roof!(A - 5900 + 50, 0)).toBeCloseTo(KV.tunnel.roof!(A + 50, 0), 9);
    });
  });

  describe('keeps everything else out of the tunnel', () => {
    afterEach(() => setStage(stageById(null)));
    const span = { from: A, to: B };

    it('has no spectators, camp or roar there, and some just short of the portal: the summit crowd stands outside', () => {
      for (const id of ['kestrel-vale-loop', 'kestrel-vale-grand', 'kestrel-vale-raven-scar']) {
        const st = stageById(id);
        const at = st.scenery.tunnels![0];
        for (let d = at.from - 4; d <= at.to + 4; d += 3) expect(crowdAt(st, d), `${id} ${d}`).toBe(0);
        expect(crowdAt(st, at.from - 25), `${id} just before the portal`).toBeGreaterThan(0.25);
      }
      const spots = lapStage.crowdSpots!.map((d) => d % KV_LAP);
      for (const d of spots) expect(d < A - 4 || d > B + 4, `crowd spot ${d}`).toBe(true);
      const all = planCrowd(lapStage, span.from - 200, span.to + 200, 1, [], true);
      expect(all.length).toBeGreaterThan(5); // the summit crowd is there ...
      expect(all.filter((s) => s.d > span.from - 3 && s.d < span.to + 3)).toEqual([]); // ... and none in the tunnel
    });

    it('gathers crowds in the Hollins Cross square on the start and finish straight, on a route that crosses the line too', () => {
      for (const id of ['kestrel-vale-loop', 'kestrel-vale-grand']) {
        const st = stageById(id);
        for (const d of [30, 90, 130]) expect(crowdAt(st, d), `${id} ${d}`).toBeGreaterThan(0.3);
      }
      // The Lakeside Sprint crosses the line at 1,399 m: the village either side of it is crowded, though a finish is 5.7 km away.
      const lake = stageById('kestrel-vale-lakeside');
      const line = KV_LAP - 14000;
      for (const d of [line - 70, line, line + 70]) expect(crowdAt(lake, d), `lakeside ${d}`).toBeGreaterThan(0.3);
      expect(crowdAt(lake, line + 600), 'and the open road beyond it is not').toBeLessThan(0.05);
    });

    it('has no guardrails or parapets there', () => {
      setStage(lapStage);
      const drop = () => -50; // ground far below the road: every section would want a rail
      const here = barrierSections(lapStage, A - 30, B + 30, drop);
      expect(here.length, 'the approach is guarded').toBeGreaterThan(20);
      expect(here.filter((s) => s.d > A - 4 && s.d < B + 4)).toEqual([]);
    });

    it('plants no ground cover on or at the mouth of the hill', () => {
      const probe = (covered: boolean): GroundAt => (_x, z, w) => { w.fill(0); w[LAYER.grass] = 1; return { h: 0, roadDist: Math.abs(z), covered }; };
      const road = (d: number) => ({ x: d, z: 0, heading: 0 });
      let bare = 0, grown = 0;
      for (let k = 0; k < 8; k++) for (let band = 0; band < BANDS; band++) {
        grown += planCell({ k, side: 1, band }, { share: 1, seed: 7, desert: false }, road, probe(false)).length;
        bare += planCell({ k, side: 1, band }, { share: 1, seed: 7, desert: false }, road, probe(true)).length;
      }
      expect(grown).toBeGreaterThan(100);
      expect(bare).toBe(0);
      expect(CELL).toBeGreaterThan(0);
      expect(LAT_MIN).toBeGreaterThan(4.6);
    });
  });
});
