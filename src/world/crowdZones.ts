import { currentStage } from '../course';
import type { Stage } from '../stages';
import type { CultureId } from './crowdCulture';
import { bendsOf } from './roadside';
import { tunnelAt } from './tunnelSpan';

/**
 * A place where the crowd is much thicker and louder than a hairpin's usual one,
 * and has its own culture: the Alpe's Dutch Corner. Data only; add a stage's here.
 */
export interface CrowdHotspot {
  /** Course distance of the middle of the crowd, m. */
  d: number;
  /** Metres either side where the crowd fades out; it is at full strength within half of it. */
  radius: number;
  /** 1 = as thick as a finish straight; more is louder still (the sound reads it). */
  density: number;
  culture: CultureId;
}

interface HotspotSpec {
  /** The label of the hairpin sign it sits at ("7": the sign's countdown number). */
  sign: string;
  radius: number;
  density: number;
  culture: CultureId;
}

const HOTSPOT_SPECS: Record<string, HotspotSpec[]> = {
  // Alpe d'Huez's seventh hairpin is the Dutch Corner: orange vans, orange flags, a roar you can hear from far down the road.
  'alpe-dhuez': [{ sign: '7', radius: 130, density: 1.35, culture: 'nl' }],
};

const cache = new WeakMap<Stage, CrowdHotspot[]>();

/** A stage's crowd hotspots, placed from its hairpin signs (the middle of the bend that follows the sign). */
export function hotspotsOf(stage: Stage): CrowdHotspot[] {
  const hit = cache.get(stage);
  if (hit) return hit;
  const out: CrowdHotspot[] = [];
  for (const spec of HOTSPOT_SPECS[stage.id] ?? []) {
    const sign = stage.signs.find((s) => s.label === spec.sign);
    if (!sign) continue;
    // bendsOf() finds the arc within a few metres after the sign; the crowd stands around its middle.
    const bend = bendsOf(stage).find((b) => b.start >= sign.d - 10 && b.start < sign.d + 80);
    const d = bend ? (bend.start + bend.end) / 2 : sign.d + 25;
    out.push({ d, radius: spec.radius, density: spec.density, culture: spec.culture });
  }
  cache.set(stage, out);
  return out;
}

/** 0..1: how far into a hotspot `d` is (1 across its middle half, fading to 0 at its radius). */
export function hotspotWeight(h: CrowdHotspot, d: number): number {
  return Math.max(0, Math.min(1, (1 - Math.abs(d - h.d) / h.radius) * 2));
}

/** The hotspot that holds `d` strongest, with its weight, or null. */
export function hotspotAt(stage: Stage, d: number): { hotspot: CrowdHotspot; weight: number } | null {
  let best: { hotspot: CrowdHotspot; weight: number } | null = null;
  for (const hotspot of hotspotsOf(stage)) {
    const weight = hotspotWeight(hotspot, d);
    if (weight > 0 && (!best || weight > best.weight)) best = { hotspot, weight };
  }
  return best;
}

/**
 * How thickly crowds line the road at course distance `d` on `stage`: the hairpins
 * of the climbs and the last few hundred metres, 0..1, and above 1 inside a hotspot
 * (louder). Pure; `crowdNear()` is it for the current stage.
 */
export function crowdAt(stage: Stage, d: number): number {
  // Nobody lines the road inside a tunnel (or on its portal's doorstep): no spectators, no camp, no roar.
  if (tunnelAt(stage.scenery.tunnels, d, 4)) return 0;
  let c = 0;
  // Named places on a circuit or a coast road (`climb: false`) are only announced: the crowds gather at its `crowdSpots`.
  if (stage.climb !== false) {
    for (const sign of stage.signs) {
      const k = 1 - Math.abs(d - sign.d - 10) / 110;
      if (k > c) c = k;
    }
  }
  for (const spot of stage.crowdSpots ?? []) {
    // The same spots every lap of a circuit.
    const at = stage.lapLength ? ((d - spot) % stage.lapLength + stage.lapLength * 1.5) % stage.lapLength - stage.lapLength / 2 : d - spot;
    const k = 1 - Math.abs(at) / 120;
    if (k > c) c = k;
  }
  c *= 0.75;
  if (stage.finish !== null) {
    // The finish line, and on a circuit every lap's line too.
    const lap = stage.lapLength;
    const toGo = lap ? lap - ((d % lap) + lap) % lap : stage.finish - d;
    const lineNear = lap ? toGo < 700 || toGo > lap - 150 : toGo < 700 && toGo > -150;
    if (lineNear) {
      const t = lap && toGo > lap - 150 ? toGo - lap : toGo;
      c = Math.max(c, t > 0 ? 1 - t / 700 : 1 + t / 150);
    }
  }
  const hot = hotspotAt(stage, d);
  if (hot) c = Math.max(c, hot.weight * hot.hotspot.density);
  return Math.max(0, c);
}

/**
 * How thickly crowds line the road at course distance `d`. One place for the numbers:
 * the sound's crowd roar (main.ts) and the spectators drawn beside the road
 * (crowds.ts) both read it.
 */
export function crowdNear(d: number): number {
  return crowdAt(currentStage(), d);
}
