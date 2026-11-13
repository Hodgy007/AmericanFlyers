
import type { MonumentOptions } from '../world/monumentTypes';
import { fbm } from '../world/noise.js';
import { basinHeight, summitCone, type Basin, type SummitCone } from '../world/summitCone';
import type { RealRouteData } from '../routes/realRoute';
import { detectHairpins, elevationFrom, mapRoute } from '../routes/realStage';
import { finishArch, monumentAt, startArch } from '../stageKit';
import type { Stage, Scenery, LandmarkKind, StageSign } from '../stages';
import { fitPlane } from '../stages';

// -------------------------------------------------------- mountain climbs ----
//
// A climb follows its real road: heading and elevation come from OpenStreetMap and SRTM data baked by
// scripts/bake-routes.mjs (src/routes/real/), mapped onto the stage's published length and rescaled to
// its published gain. Its hairpins are found in that heading (routes/realStage.ts) and numbered
// when the road numbers them (Alpe d'Huez, Stelvio).

export interface ClimbSpec {
  id: string;
  name: string;
  tagline: string;
  route: RealRouteData;
  length: number; // metres
  gain: number; // metres
  /** The steepest gradient as a fraction, near the published maximum (SRTM's ramps are flattened to it). Default 0.25. */
  maxGrade?: number;
  /** % per kilometre as published: each kilometre of the real profile is rescaled to it (left out: the real profile's own). */
  kmGrades?: number[];
  /** The official number of numbered hairpins. Left out: the road's hairpins are not numbered. */
  hairpins?: number;
  /** Named places that get a "next:" announcement (a function is given the sites, to place them by altitude). */
  places?: { d: number; name: string }[] | ((at: ClimbSites) => { d: number; name: string }[]);
  hairpinWord: string;
  baseAltitude: number;
  timeOfDay?: Stage['timeOfDay'];
  weather?: Stage['weather'];
  scenery: Omit<Scenery, 'wildHeight'>;
  /** A bare cone at the summit that the ground falls away from, so buildings there stand clear of the land (world/summitCone.ts). */
  summit?: SummitCone;
  /** A basin the wild ground sinks into, so a distant landmark can be seen across it (world/summitCone.ts). */
  basin?: Basin;
  /**
   * Landmarks beyond the start and finish arches. A function is given where things on the road are
   * (see ClimbSites), for those that belong at a particular bend or altitude.
   */
  landmarks?: LandmarkKind[] | ((at: ClimbSites) => LandmarkKind[]);
}

/** Where things on a climb can be anchored. */
export interface ClimbSites {
  /** A numbered hairpin's apex and which side of the road is the outside of its turn. */
  hairpin(label: string): { d: number; outside: -1 | 1 };
  /** Course distance where the road first reaches this altitude above sea level. */
  altitude(metres: number): number;
}

const SIGN_LEAD = 12; // metres before a hairpin that its number sign stands
const PLANE_STEP = 2; // metres between samples when fitting the land to the road

/**
 * A plane through the road's rise across the land beside it, so the ground far from the road climbs
 * with it instead of the road sitting on a pillar.
 */
export function landPlane(headingAt: (d: number) => number, elevationAt: (d: number) => number, length: number) {
  let x = 0, z = 0;
  const pts: [number, number, number][] = [];
  for (let d = 0; d < length; d += PLANE_STEP) {
    const h = headingAt(d + PLANE_STEP / 2);
    x += Math.cos(h) * PLANE_STEP;
    z += Math.sin(h) * PLANE_STEP;
    if (d % 50 === 0) pts.push([x, z, elevationAt(d)]);
  }
  return fitPlane(pts);
}

export function buildClimb(spec: ClimbSpec): Stage {
  const { length } = spec;
  const geo = mapRoute(spec.route, length);
  const { headingAt } = geo;
  const elevationAt = elevationFrom(geo, length, { gain: spec.gain, maxGrade: spec.maxGrade, climbOnly: true }, spec.kmGrades);

  const found = detectHairpins(headingAt, length, spec.hairpins);
  const numbered = spec.hairpins !== undefined;
  const at: ClimbSites = {
    hairpin: (label) => {
      const i = found.findIndex((_, k) => String(found.length - k) === label);
      if (!numbered || i < 0) throw new Error(`${spec.id} has no hairpin ${label}`);
      // A right turn (heading rising) has its outside on the left.
      return { d: found[i].apex, outside: found[i].turn > 0 ? -1 : 1 };
    },
    altitude: (metres) => {
      for (let d = 0; d < length; d += 5) if (spec.baseAltitude + elevationAt(d) >= metres) return d;
      return length;
    },
  };
  const signs: StageSign[] = found.map((h, i) => ({
    d: Math.max(0, h.start - SIGN_LEAD),
    label: numbered ? String(found.length - i) : '',
    style: 'hairpin',
    numbered,
  }));
  const places = typeof spec.places === 'function' ? spec.places(at) : spec.places ?? [];
  for (const p of places) signs.push({ d: p.d, label: '', name: p.name, style: 'hairpin', numbered: false });
  signs.sort((a, b) => a.d - b.d);

  const plane = landPlane(headingAt, elevationAt, length);

  const cone = spec.summit ? summitCone(spec.summit, headingAt, elevationAt) : null;
  const basin = spec.basin ? basinHeight(spec.basin) : null;
  const wildHeight = (wx: number, wz: number) => {
    const base = Math.max(-40, Math.min(spec.gain + 150, plane(wx, wz)));
    const massif = fbm(wx / 1300, wz / 1300, 4) * 260;
    const ridges = (1 - Math.abs(fbm(wx / 420 + 7, wz / 420 - 3, 3))) * 170;
    const wild = base + 60 + massif + ridges;
    return basin ? basin(wx, wz, cone ? cone(wx, wz, wild) : wild) : cone ? cone(wx, wz, wild) : wild;
  };

  const extra = typeof spec.landmarks === 'function' ? spec.landmarks(at) : spec.landmarks ?? [];

  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    finish: length,
    elevationAt,
    headingAt,
    scenery: { ...spec.scenery, wildHeight },
    landmarks: [startArch, finishArch(length), ...extra],
    signs,
    hairpinWord: spec.hairpinWord,
    baseAltitude: spec.baseAltitude,
    timeOfDay: spec.timeOfDay,
    weather: spec.weather,
  };
}


export const colSign = (finish: number, options: MonumentOptions): LandmarkKind => monumentAt('col-sign', finish - 55, 1, 8.5, 2.6, { yaw: -0.35, clearance: 6, options });


/** The wooden park sign at the top of an American climb, just before the finish, on the right. */
export const summitSign = (finish: number, ...lines: string[]): LandmarkKind =>
  monumentAt('summit-sign-us', finish - 55, 1, 8, 2.8, { yaw: -0.35, clearance: 6, options: { lines } });
