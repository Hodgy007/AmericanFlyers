
import type { RealRouteData } from '../routes/realRoute';
import { elevationFrom, mapRoute } from '../routes/realStage';

// --------------------------------------- real-road circuits and the coast ----
//
// Three race circuits and a coast road, on their real roads (OpenStreetMap, SRTM: routes/real/*.ts, baked by
// scripts/bake-routes.mjs) with the real elevation as it is baked, not rescaled to a published gain. A circuit's
// baked loop closes exactly (heading included), is mapped onto the published lap length, and its elevation is
// periodic (`d mod lap`), so lap 2 lies on lap 1; each lap adds the loop's own whole turn to the heading
// (Morgul-Bismark's way, see `MB_TURN`). The scenery that needs the road's shape (a skyline round a park, the sea
// beside a cliff road) is worked out from the stage's own heading, so it follows the stage's scale.

export interface CircuitGeometry {
  lap: number;
  laps: number;
  finish: number;
  headingAt(d: number): number;
  elevationAt(d: number): number;
  /** Real metres per stage metre. */
  scale: number;
  /** The mean elevation round one lap, m above the start. */
  mean: number;
}

export function circuitGeometry(route: RealRouteData, lap: number, laps: number, maxGrade: number, smooth?: number, lapGain?: number): CircuitGeometry {
  const geo = mapRoute(route, lap);
  // lapGain: the published climbing per lap. SRTM reads a town's roofs and a park's trees as extra ups and downs, so the
  // (smoothed) profile is scaled about the start until a lap climbs that much, before the gradient cap.
  let peak: number | undefined;
  if (lapGain) {
    const raw = elevationFrom(geo, lap, { maxGrade: 1, smooth });
    let high = 0, gain = 0;
    for (let u = 0; u < lap; u += 10) { const a = raw(u), b = raw(u + 10); high = Math.max(high, a); if (b > a) gain += b - a; }
    if (high > 0 && gain > 0) peak = (high * lapGain) / gain;
  }
  const rise = elevationFrom(geo, lap, { maxGrade, smooth, peak });
  // The baked road ends a metre or two off the altitude it started at: spread that over the lap, so the lap is periodic.
  const closing = rise(lap);
  const lapElevation = (u: number) => rise(u) - (closing * u) / lap;
  // The loop turns a whole number of times, once, either way; each lap adds that again.
  const turn = geo.headingAt(lap) - geo.headingAt(0);
  let mean = 0;
  let n = 0;
  for (let u = 0; u < lap; u += 10) { mean += lapElevation(u); n++; }
  return {
    lap, laps, finish: lap * laps, scale: geo.scale, mean: mean / n,
    headingAt: (d) => (d <= 0 ? geo.headingAt(0) : geo.headingAt(d - Math.floor(d / lap) * lap) + Math.floor(d / lap) * turn),
    elevationAt: (d) => lapElevation(((d % lap) + lap) % lap),
  };
}
