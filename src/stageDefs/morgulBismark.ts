
import { fbm } from '../world/noise.js';
import { mapRoute } from '../routes/realStage';
import morgulRoute from '../routes/real/hotw-morgul-bismark';
import { finishArch, monumentAt, pchip, startArch } from '../stageKit';
import type { Stage } from '../stages';
import { FARM_LANDMARKS } from '../stages';

// ------------------------------------------------ Hell of the West tour ----
//
// American Flyers (1985) has three stages: the Morgul-Bismark circuit near
// Boulder, the "Tour of the Moon" through Colorado National Monument, and the
// final climb to Echo Lake (the existing Hell of the West stage). Stage 1's
// loop and stage 2's road are the real ones (see routes/real/); stage 1's
// elevation is shaped from published figures.

// ---- Stage 1: Morgul-Bismark ----
//
// The Morgul-Bismark loop around Superior, south of Boulder, used by the Red Zinger and Coors
// Classics and for the first race in the film: 13.1 miles (21.1 km), starting
// where Highway 128 meets McCaslin Boulevard, west on 128 to Highway 93, north
// on 93, east on 170 and back down McCaslin, with "The Wall" at the south end
// of McCaslin: a mile-long incline that kicks up to 18% (wikipedia.org
// Morgul-Bismark; coloradohometownweekly.com 2011-05-25 gives 13.3 mi). The
// Coors Classic riders did eight laps and sprinted to the top of the Wall.
// Here the lap is ridden the way the Coors Classic finished it, in that
// direction: out along 128, round, and up the Wall to the line, two laps
// (42 km). The shape of the loop is the real road's (OpenStreetMap, baked
// into routes/real/hotw-morgul-bismark.ts, which is a little longer than
// the stage's lap and is scaled to it, and closes exactly so laps meet). The elevation is
// approximated (about 90 m up the Wall, a rolling 128, a gentle rise to
// Highway 93); the Wall is the lap's last 1,600 m.
const MB_WALL = 1600; // "one mile"
// The lap's length, which leaderboards and races are timed against, kept to the metre it had as a
// rounded rectangle: 3,240 m of McCaslin above the Wall, two 5,600 m east-west roads, 4,840 m of
// Highway 93 (to the Wall's foot) and four 40 m corners, in lap order.
const MB_ARC = (Math.PI / 2) * 40;
const MB_PIECES = [3240, MB_ARC, 5600, MB_ARC, 4840, MB_ARC, 5600, MB_ARC, MB_WALL];
const MB_LAP = MB_PIECES.reduce((a, v) => a + v, 0);
// Where Highway 93 begins and where the second east-west road does, which the elevation knots below sit at.
const MB_HWY93 = MB_PIECES.slice(0, 4).reduce((a, v) => a + v, 0);
const MB_SOUTH = MB_PIECES.slice(0, 6).reduce((a, v) => a + v, 0);
const MB_LAPS = 2;
const MB_FINISH = MB_LAP * MB_LAPS;
const mbRoute = mapRoute(morgulRoute, MB_LAP);
/** Half way up the Highway 93 leg of the lap (found from the baked road): the sprint, and the Flatirons stand opposite. */
const MB_SPRINT = 6900;
// The real loop turns a whole number of times (once, clockwise); each lap adds that again.
const MB_TURN = mbRoute.headingAt(MB_LAP) - mbRoute.headingAt(0);
function mbHeading(d: number) {
  if (d <= 0) return mbRoute.headingAt(0);
  const lap = Math.floor(d / MB_LAP);
  return mbRoute.headingAt(d - lap * MB_LAP) + lap * MB_TURN;
}

// Elevation above the line at the top of the Wall, around one lap.
const MB_WALL_START = MB_LAP - MB_WALL;
// The Wall: gradient per 80 m, building to 18% and easing again just before the line.
const MB_WALL_GRADES = [1, 1, 1.5, 1.5, 2, 2, 2.5, 2.5, 3.5, 3.5, 4.5, 4.5, 6, 7, 9, 12, 16, 18, 12, 6];
const MB_WALL_STEP = MB_WALL / MB_WALL_GRADES.length;
const MB_WALL_RISE = MB_WALL_GRADES.reduce((a, g) => a + (g / 100) * MB_WALL_STEP, 0); // ≈ 90 m
const mbWall = (m: number) => {
  let e = -MB_WALL_RISE;
  for (let i = 0; i < MB_WALL_GRADES.length; i++) {
    const seg = Math.min(MB_WALL_STEP, Math.max(0, m - i * MB_WALL_STEP));
    e += (MB_WALL_GRADES[i] / 100) * seg;
  }
  return e;
};
const mbBase = pchip([
  [0, 0], [3240, 12], [5900, 30], [MB_HWY93, 36], [11400, 41], [MB_SOUTH, 24], [16700, -32], [MB_WALL_START, -MB_WALL_RISE],
]);
const MB_KNOT_U = [0, 3240, 5900, MB_HWY93, 11400, MB_SOUTH, 16700, MB_WALL_START];
function mbLapElevation(u: number) {
  if (u >= MB_WALL_START) return mbWall(u - MB_WALL_START);
  // Rolling swells between the knots, fading to nothing at each knot.
  let i = 0;
  while (i < MB_KNOT_U.length - 2 && MB_KNOT_U[i + 1] < u) i++;
  const f = (u - MB_KNOT_U[i]) / (MB_KNOT_U[i + 1] - MB_KNOT_U[i]);
  const env = Math.sin(Math.PI * f);
  return mbBase(u) + env * (4.2 * Math.sin((2 * Math.PI * u) / 1050 + 0.8) + 1.8 * Math.sin((2 * Math.PI * u) / 410 + 2.3));
}
const mbElevation = (d: number) => mbLapElevation(((d % MB_LAP) + MB_LAP) % MB_LAP);

/** Farm landmarks whose spacing divides the lap, so the second lap shows the same scenery. */
const lapFarm = FARM_LANDMARKS.map((k) => ({ ...k, every: MB_LAP / Math.round(MB_LAP / k.every) }));

const morgulBismark: Stage = {
  id: 'hotw-morgul-bismark',
  name: 'Hell of the West · Stage 1: Morgul-Bismark',
  tagline: 'Two 21 km laps of the Boulder circuit, finishing up The Wall (18%) each time.',
  finish: MB_FINISH,
  lapLength: MB_LAP,
  elevationAt: mbElevation,
  headingAt: mbHeading,
  scenery: {
    wildHeight: (x, z) => -18 + fbm(x / 1100, z / 1100, 3) * 30 + Math.max(0, fbm(x / 450 + 3, z / 450, 3)) * 18,
    bumpAmp: 3,
    rockLine: 400,
    snowLine: 1e9,
    treeLine: 400,
    coniferBias: 0.1,
    forestCover: -0.45, // open foothills grassland: lone trees and the odd clump (the forest noise only reaches 0.5 in a few patches)
    trees: { cottonwood: 0.3, pine: 0.35, shrub: 0.35 },
    fields: true,
    mountainScale: 1.7, // the Front Range and the Flatirons to the west
    horizon: 'rockies',
  },
  landmarks: [
    startArch, finishArch(MB_LAP), finishArch(MB_FINISH), finishArch(MB_SPRINT), finishArch(MB_LAP + MB_SPRINT), ...lapFarm,
    // The Flatirons, 2.5 km west of Highway 93 (the west side of the circuit: the left-hand side riding north), once a lap.
    // Visible from 7 km away along the road, hazy rather than fogged out (monuments.ts).
    { ...monumentAt('flatirons', MB_SPRINT, -1, 2500, 500, { clearance: 1 }), every: MB_LAP, reach: 7000 },
  ],
  signs: [],
  baseAltitude: 1680, // Superior, Colorado: about 5,500 ft
  tourStage: 1,
  race: {
    sprints: [
      { d: MB_SPRINT, name: 'Highway 93 sprint' },
      { d: MB_LAP + MB_SPRINT, name: 'Highway 93 sprint' },
    ],
    summits: [
      { d: MB_LAP, name: 'The Wall', cat: 3 },
      { d: MB_FINISH, name: 'The Wall', cat: 2 },
    ],
  },
};

export default morgulBismark;
