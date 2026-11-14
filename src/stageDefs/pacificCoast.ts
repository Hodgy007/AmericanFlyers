
import { fbm, smoothstep } from '../world/noise.js';
import { elevationFrom, mapRoute } from '../routes/realStage';
import pacificRoute from '../routes/real/pacific-coast';
import { finishArch, roadLocator, roadTrace, startArch } from '../stageKit';
import type { Stage, StageSign } from '../stages';

// ---- Pacific Coast Highway through Big Sur ----
//
// California Highway 1 southbound from the Carmel River past Carmel Highlands and Garrapata, over Bixby Creek Bridge, up Hurricane
// Point and past Point Sur to Big Sur village: 39 km, the ocean on the right all the way. The road and its profile are the real
// ones (OpenStreetMap, SRTM; baked with the car profile, which stays on the highway where the bicycle profile prefers the Old
// Coast Road over the hills). Bixby Creek Bridge (1932, 218 m of concrete open-spandrel arch, 79 m above the creek: nps.gov, the
// Monterey County site) is at 21.9 km; Hurricane Point (the highway climbs to about 180 m) peaks at 23.5 km; the Point Sur
// lighthouse stands on its rock 1.4 km offshore at 29.8 km. The ground falls away to the Pacific on the right (the `roadside`
// hook shapes the cliff, sea level is a plane) and climbs in golden hills on the left.
const PC_LENGTH = 39100;
const pcGeo = mapRoute(pacificRoute, PC_LENGTH);
const PC_ALTITUDE = 6; // m above sea level at the start (the Carmel River bridge)
const PC_FLOOR = -1.5; // the lowest the road runs, in the datum: the baked profile dips to the sea's level at the river mouth, the highway does not
const pcElevation = (() => {
  const f = elevationFrom(pcGeo, PC_LENGTH, { maxGrade: 0.09, smooth: 250 });
  return (d: number) => Math.max(PC_FLOOR, f(d));
})();
const PC_BIXBY = 21850;
const PC_HURRICANE = 23470;
const PC_TRACE = roadTrace(pcGeo.headingAt, PC_LENGTH, 20);
const pcLocate = roadLocator(PC_TRACE, 20);
const PC_LIP = 6.5;
const PC_SEA = -PC_ALTITUDE; // sea level in the road's datum
/** 1 where the ocean is beside the road (on the right), fading in after the river and out at the Big Sur valley. */
const pcSea = (d: number) => smoothstep(2800, 3700, d) * (1 - smoothstep(33200, 35500, d));
/** Ground height relative to the road, `lateral` m to its right. */
function pcRel(d: number, lateral: number): number {
  const dd = Math.max(0, Math.min(PC_LENGTH, d));
  const road = pcElevation(dd);
  const above = Math.max(3, PC_ALTITUDE + road); // m above the sea
  const s = Math.abs(lateral);
  // Bixby Creek's gorge cuts across the road at the bridge; its floor stays above the sea.
  const gorge = -Math.max(0, Math.min(78, above - 6)) * (1 - smoothstep(24, 100, Math.abs(dd - PC_BIXBY))) * (1 - smoothstep(520, 880, s));
  if (s <= PC_LIP) return gorge;
  const out = s - PC_LIP;
  // Inland (and where the sea is not near): golden hills that rise from the verge.
  const hills = 200 * (1 - Math.exp(-out / 170)) + fbm(dd / 700 + 3, s / 350, 3) * 55 * smoothstep(30, 300, s);
  let rel = hills;
  if (lateral > 0) {
    const w = pcSea(dd);
    if (w > 0) {
      // The cliff: steep at the lip and easing into the surf, down to a little below the sea.
      const run = Math.max(28, above * 1.5);
      const t = Math.min(1, out / run);
      const cliff = -(above + 8) * (1 - Math.pow(1 - t, 1.7)) + fbm(dd / 80, s / 40, 2) * 2.2 * Math.sin(Math.PI * Math.min(1, t));
      rel = hills * (1 - w) + cliff * w;
    }
  }
  return Math.min(rel, gorge);
}
const PC_PLACES: StageSign[] = ([[4300, 'Carmel Highlands'], [21550, 'Bixby Creek Bridge'], [23300, 'Hurricane Point'], [29500, 'Point Sur'], [35400, 'Andrew Molera']] as [number, string][])
  .map(([d, name]) => ({ d, label: '', name, style: 'hairpin' as const, numbered: false }));

const pacificCoast: Stage = {
  id: 'pacific-coast',
  name: 'Pacific Coast Highway',
  tagline: '39 km of California Highway 1 through Big Sur: the cliffs above the Pacific, Bixby Creek Bridge, Hurricane Point and the road to Big Sur village.',
  finish: PC_LENGTH,
  elevationAt: pcElevation,
  headingAt: pcGeo.headingAt,
  baseAltitude: PC_ALTITUDE,
  climb: false,
  weather: 'cloudy', // the morning marine layer
  scenery: {
    wildHeight: (x, z) => {
      const { d, lateral } = pcLocate(x, z);
      return pcElevation(Math.max(0, Math.min(PC_LENGTH, d))) + pcRel(d, lateral);
    },
    roadside: pcRel,
    bumpAmp: 2.5,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 330,
    dryGrass: 0.7,
    coniferBias: 0.3,
    forestCover: -0.4, // coastal scrub: shrubs, with the odd oak and Monterey pine
    trees: { shrub: 0.55, oak: 0.2, pine: 0.25 },
    fields: false,
    mountainScale: 2.4, // the Santa Lucia range
    horizon: 'hills',
    road: 'us-highway',
    barrier: 'rail',
    water: [{ kind: 'sea', level: PC_SEA }],
  },
  landmarks: [
    startArch, finishArch(PC_LENGTH),
    // Bixby Creek Bridge carries the road: its deck is the model's top (BIXBY_DECK above its origin), 218 m along the road.
    { model: 'bixby-bridge', first: PC_BIXBY, every: 1e9, side: 0, span: 'along', offset: 0, size: 80, clearance: 40, lift: -79.2 },
  ],
  signs: PC_PLACES,
  race: {
    sprints: [{ d: PC_BIXBY, name: 'Bixby Bridge sprint' }],
    summits: [{ d: PC_HURRICANE, name: 'Hurricane Point', cat: 4 }],
  },
};

export default pacificCoast;
