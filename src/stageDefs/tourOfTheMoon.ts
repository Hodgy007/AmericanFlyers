
import { fbm, smoothstep } from '../world/noise.js';
import { RIM_ROCK_SECTIONS, makeRoadside } from '../world/canyon.js';
import { elevationFrom, mapRoute } from '../routes/realStage';
import moonRoute from '../routes/real/hotw-tour-of-the-moon';
import { finishArch, startArch } from '../stageKit';
import type { Stage } from '../stages';
import { landPlane } from './climb';

// ---- Stage 2: the Tour of the Moon ----
//
// Rim Rock Drive through Colorado National Monument, the stage the Coors
// Classic called the Tour of the Moon (1980–88, mtntownmagazine.com
// "Classic Rides: the Colorado National Monument's Tour of the Moon"). The
// road is 23 miles (37 km) from the Grand Junction entrance to the Fruita
// entrance, tops out at 6,640 ft (2,024 m), and has about 2,300 ft (700 m) of
// climbing in all, most of it on the steep grades just inside either entrance
// (nps.gov "Road Biking on Rim Rock Drive"). From the Grand Junction side the
// road switchbacks up about four miles, through a dark tunnel, to the
// plateau at Cold Shivers; five or six more miles of rolling uphill reach the
// high point, then a descent with one more rise at Black Ridge, the visitor
// center, and a rapid drop through two short tunnels to Fruita
// (mtntownmagazine.com). The road line and profile are the real ones
// (OpenStreetMap and SRTM, baked into routes/real/hotw-tour-of-the-moon.ts),
// scaled so the high point is the published 2,024 m.
const TM_FINISH = 37000;
const TM_START_ALTITUDE = 1460; // where the baked road starts, on Monument Road just below the park entrance
const tm = mapRoute(moonRoute, TM_FINISH);
const tmElevation = elevationFrom(tm, TM_FINISH, { peak: 2024 - TM_START_ALTITUDE, maxGrade: 0.1 });
const tmHeading = tm.headingAt;
// Fit a plane to the road, as the climbs do, so the land follows the road's overall rise.
const TM_VISITOR_CENTER = 29080;
const tmPlane = landPlane(tmHeading, tmElevation, TM_FINISH);
/** Flat shelves joined by cliffs: the stepped mesas and layered sandstone of the Colorado Plateau. */
const terrace = (v: number, step: number) => {
  const f = v / step;
  const i = Math.floor(f);
  return (i + smoothstep(0.55, 1, f - i)) * step;
};

const tourOfTheMoon: Stage = {
  id: 'hotw-tour-of-the-moon',
  name: 'Hell of the West · Stage 2: Tour of the Moon',
  tagline: 'Rim Rock Drive through Colorado National Monument: 37 km of switchbacks, tunnels and red rock canyons, topping out at 2,024 m.',
  finish: TM_FINISH,
  elevationAt: tmElevation,
  headingAt: tmHeading,
  scenery: {
    wildHeight: (x, z) => {
      const base = Math.max(-60, Math.min(700, tmPlane(x, z)));
      const mesa = fbm(x / 1500 + 4, z / 1500, 3) * 120;
      const ridge = (1 - Math.abs(fbm(x / 420 + 7, z / 420 - 3, 3))) * 170;
      return terrace(base + 10 + mesa * 0.6 + ridge * 0.55, 26);
    },
    bumpAmp: 5,
    rockLine: 1e9,
    snowLine: 1e9,
    treeLine: 1e9,
    coniferBias: 1,
    forestCover: -0.3,
    trees: { juniper: 0.75, shrub: 0.25 },
    fields: false,
    mountainScale: 1.3, // the Book Cliffs
    horizon: 'desert',
    palette: 'desert',
    road: 'park',
    barrier: 'stone',
    roadside: makeRoadside(RIM_ROCK_SECTIONS), // the rims of Monument Canyon and its neighbours
    clearAir: 3.2, // dry plateau air: the canyon floors and the monoliths stay readable
    directHaze: true, // and the same on Medium and up as on Low
    skyLight: 0.3, // High and Ultra's sky ambient would pale the red rock
  },
  landmarks: [startArch, finishArch(TM_FINISH), finishArch(TM_VISITOR_CENTER)],
  signs: [],
  baseAltitude: TM_START_ALTITUDE, // just below the Grand Junction entrance (4,700 ft)
  tourStage: 2,
  race: {
    // Places on the real road: Cold Shivers Point, the high point (2,024 m), the rise at Black Ridge and the Saddlehorn visitor center.
    sprints: [{ d: TM_VISITOR_CENTER, name: 'Visitor center sprint' }],
    summits: [
      { d: 6950, name: 'Cold Shivers', cat: 1 },
      { d: 13000, name: 'The high point', cat: 2 },
      { d: 20000, name: 'Black Ridge', cat: 4 },
    ],
  },
};

export default tourOfTheMoon;
