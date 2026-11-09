import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { stageById, STAGES } from '../../src/stages';
import { barrierKind, stoneGeometry } from '../../src/world/barriers';
import { averageGrade, milestoneText, signStyleOf } from '../../src/world/milestones';
import { PX_PER_M, RAGGED_ROW, raggedEdge, roadPaintLayout, roadStyleOf, ROAD_TEX_WIDTH, type RoadPaintLayout } from '../../src/world/roadStyle';
import type { RoadStyle } from '../../src/stages';

const STYLES: RoadStyle[] = ['us-highway', 'alpine', 'lane', 'park'];

describe('which stage has which road', () => {
  it('gives the right style to every stage', () => {
    const want: Record<string, RoadStyle> = {
      heartland: 'us-highway',
      route66: 'us-highway',
      'hotw-morgul-bismark': 'us-highway',
      'hell-of-the-west': 'us-highway',
      'hotw-tour-of-the-moon': 'park',
      'alpe-dhuez': 'alpine',
      stelvio: 'alpine',
      ventoux: 'alpine',
      tourmalet: 'alpine',
      zoncolan: 'lane',
      'mt-washington': 'lane',
      'mt-blue-sky': 'park',
      'mt-diablo': 'park',
      flagstaff: 'us-highway',
      'richmond-worlds': 'us-highway',
      'central-park': 'lane',
      'harrogate-worlds': 'alpine',
      'pacific-coast': 'us-highway',
    };
    for (const s of STAGES) expect(roadStyleOf(s), s.id).toBe(want[s.id]);
  });
  it('uses stone parapets on Stelvio, Tourmalet, Ventoux and the Tour of the Moon, and dry-stone walls in Harrogate, only', () => {
    const stone = STAGES.filter((s) => barrierKind(s) === 'stone').map((s) => s.id);
    expect(stone.sort()).toEqual(['harrogate-worlds', 'hotw-tour-of-the-moon', 'stelvio', 'tourmalet', 'ventoux']);
  });
  it('defaults to the US highway for a stage with no road style (an uploaded route)', () => {
    expect(roadStyleOf({ scenery: { ...stageById('heartland').scenery, road: undefined } })).toBe('us-highway');
  });
});

describe('road paint layout', () => {
  const inside = (l: RoadPaintLayout, m: { x: number; y: number; w: number; h: number }) =>
    m.x >= 0 && m.y >= 0 && m.x + m.w <= ROAD_TEX_WIDTH && m.y + m.h <= l.height;

  it('is cached and keeps every mark inside the texture', () => {
    for (const style of STYLES) {
      const l = roadPaintLayout(style);
      expect(roadPaintLayout(style)).toBe(l);
      for (const m of [...l.paint, ...l.surface, ...l.wear]) expect(inside(l, m), `${style} ${JSON.stringify(m)}`).toBe(true);
    }
  });
  it('tiles the asphalt photo cleanly: heights are multiples of 256 and repeatM matches the texels', () => {
    for (const style of STYLES) {
      const l = roadPaintLayout(style);
      expect(l.height % 256).toBe(0);
      expect(l.repeatM).toBeCloseTo(l.height / PX_PER_M, 6);
    }
  });
  it('leaves the US highway exactly as it was', () => {
    const l = roadPaintLayout('us-highway');
    expect(l.height).toBe(512);
    expect(l.repeatM).toBeCloseTo(9.2, 6);
    expect(l.paint.map((m) => [m.x, m.w, m.h])).toEqual([[58, 9, 512], [445, 9, 512], [247, 7, 200], [258, 7, 200]]);
    expect(l.edge).toEqual({ bands: [{ from: 0, to: 44, color: 'rgba(125, 116, 98, 0.85)' }], flat: true });
    expect(l.tint).toBeNull();
  });
  it('paints the alpine centre as one white 3 m dash and a 10 m gap, plus thin edge lines', () => {
    const l = roadPaintLayout('alpine');
    const dash = l.paint.filter((m) => m.h < l.height);
    expect(dash).toHaveLength(1);
    expect(dash[0].h / PX_PER_M).toBeCloseTo(3, 1);
    expect((l.height - dash[0].h) / PX_PER_M).toBeGreaterThan(10);
    expect(dash[0].w / PX_PER_M).toBeCloseTo(0.12, 1);
    const edges = l.paint.filter((m) => m.h === l.height);
    expect(edges).toHaveLength(2);
    expect(edges[0].x + edges[0].w + edges[1].x).toBe(ROAD_TEX_WIDTH); // symmetric about the middle
    expect(edges[0].w / PX_PER_M).toBeLessThan(0.15);
    expect(l.edge?.flat).toBe(false); // dirty asphalt, not gravel
    expect(l.surface.length).toBeGreaterThan(5);
  });
  it('gives the lane no markings but ragged edges, and the park a solid double yellow', () => {
    const lane = roadPaintLayout('lane');
    expect(lane.paint).toEqual([]);
    expect(lane.ragged).not.toBeNull();
    const park = roadPaintLayout('park');
    expect(park.paint).toHaveLength(2);
    for (const m of park.paint) {
      expect(m.h).toBe(park.height); // solid
      expect(m.color).toContain('232, 184, 60'); // yellow
    }
    expect(park.edge?.flat).toBe(true);
  });
});

describe('ragged lane edge', () => {
  const lane = roadPaintLayout('lane');
  it('has a width for every row, within base ± amp, and differs per side', () => {
    const left = raggedEdge(lane, 0);
    const right = raggedEdge(lane, 1);
    expect(left).toHaveLength(lane.height / RAGGED_ROW);
    for (const w of [...left, ...right]) {
      expect(w).toBeGreaterThanOrEqual(lane.ragged!.base - lane.ragged!.amp);
      expect(w).toBeLessThanOrEqual(lane.ragged!.base + lane.ragged!.amp);
    }
    expect(left).not.toEqual(right);
    expect(raggedEdge(lane, 0)).toEqual(left); // deterministic
  });
  it('wraps: the last row is as close to the first as neighbouring rows are', () => {
    const w = raggedEdge(lane, 0);
    const step = Math.max(...w.slice(1).map((v, i) => Math.abs(v - w[i])));
    expect(Math.abs(w[w.length - 1] - w[0])).toBeLessThanOrEqual(step + 1e-9);
  });
  it('is empty for styles without ragged edges', () => {
    expect(raggedEdge(roadPaintLayout('alpine'), 0)).toEqual([]);
  });
});

describe('distance signs by country', () => {
  it('picks the sign from the hairpin word', () => {
    const style = (id: string) => signStyleOf(stageById(id));
    expect(style('alpe-dhuez')).toBe('fr');
    expect(style('ventoux')).toBe('fr');
    expect(style('tourmalet')).toBe('fr');
    expect(style('stelvio')).toBe('it');
    expect(style('zoncolan')).toBe('it');
    expect(style('hell-of-the-west')).toBe('us'); // "Switchback"
    expect(style('heartland')).toBe('us');
    expect(style('hotw-tour-of-the-moon')).toBe('us');
  });
  it('writes the French and Italian milestones', () => {
    expect(milestoneText('fr', "Alpe d'Huez", 7, 'km', 8.14)).toEqual({ name: "ALPE D'HUEZ", distance: 'Sommet 7 km', grade: 'Pente moy. 8.1 %' });
    expect(milestoneText('it', 'Stelvio Pass', 12, 'km', 7.56)).toEqual({ name: 'STELVIO PASS', distance: 'Cima 12 km', grade: 'Pendenza media 7.6 %' });
    expect(milestoneText('it', 'Stelvio Pass', 4.52, 'km', 8).distance).toBe('Cima 4.5 km'); // the exact distance, not rounded to a whole km
    expect(milestoneText('fr', 'X', 1, 'mi', -0.01).grade).toBe('Pente moy. 0.0 %'); // no "-0.0"
  });
  it("finds the next kilometre's gradient from the stage's elevation", () => {
    const alpe = stageById('alpe-dhuez');
    // Alpe d'Huez's second kilometre is 10.2 %.
    expect(averageGrade(alpe.elevationAt, 1000, 1000)).toBeCloseTo(10.2, 0);
    expect(averageGrade(() => 5, 0, 0)).toBe(0);
  });
});

describe('stone parapet', () => {
  const geo = stoneGeometry();
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  it('is a 3 m section 0.55 m above the road (the section sits 0.12 m below it) and 0.45 m thick', () => {
    expect(box.min.x).toBeGreaterThanOrEqual(-0.001);
    expect(box.max.x).toBeCloseTo(3.06, 1);
    expect(box.max.y).toBeCloseTo(0.55 + 0.12, 1);
    expect(box.max.z - box.min.z).toBeGreaterThan(0.43);
    expect(box.max.z - box.min.z).toBeLessThan(0.5);
  });
  it('is flat-shaded stone with a colour per vertex, in a few hundred triangles', () => {
    expect(geo.index).toBeNull();
    expect(geo.getAttribute('color')).toBeDefined();
    expect(geo.getAttribute('position').count / 3).toBeLessThan(400);
    // A different grey from block to block.
    const c = geo.getAttribute('color') as THREE.BufferAttribute;
    const seen = new Set<string>();
    for (let i = 0; i < c.count; i += 36) seen.add(c.getX(i).toFixed(2));
    expect(seen.size).toBeGreaterThan(3);
  });
  it('is the same every time', () => {
    expect(Array.from(stoneGeometry().getAttribute('position').array.slice(0, 60))).toEqual(Array.from(geo.getAttribute('position').array.slice(0, 60)));
  });
});
