
import { fbm } from '../world/noise.js';
import harrogateRoute from '../routes/real/harrogate-worlds';
import { finishArch, namedPlaces, perLap, startArch, terraceRow } from '../stageKit';
import type { Stage } from '../stages';
import { circuitGeometry } from './circuit';

// ---- Harrogate: the 2019 Worlds finishing circuit ----
//
// The finishing circuit of the 2019 UCI Road World Championships, Harrogate, North Yorkshire: 13.9 km (Strava's "Harrogate
// Worlds Lap", VeloViewer; 14 km in the UCI's words), ridden in the race direction from the line on Parliament Street, south
// down West Park beside The Stray, then right on to Otley Road, the long straight out of town (Zwift Insider's notes for the
// route), north through the farmland of the Oak Beck valley to Penny Pot Lane, the sharp descent to the stone bridge over the beck
// and the climb out of the valley (the Yorkshire KOM), east along Cornwall Road in the Duchy Estate and the Royal Pump Room, and
// up the drag of Parliament Street past Betty's to the line, where Cavendish crashed in 2014. The sources do not name every
// road, so the loop between Otley Road and Cornwall Road is reconstructed; the baked road is 12.1 km and the game stretches it to
// the published lap. Two laps.
const HW_LAP = 13900;
const HW_LAPS = 2;
const hw = circuitGeometry(harrogateRoute, HW_LAP, HW_LAPS, 0.12, 100, 245);
const HW_ALTITUDE = 120;
const HW_KOM = 10600; // the top of the Oak Beck climb
const HW_PLACES: [number, string][] = [[1500, 'Otley Road'], [9650, 'Oak Beck'], [10900, 'Cornwall Road'], [12500, 'Royal Pump Room'], [13300, 'Parliament Street']];
/** The open country between Otley Road's last houses and the Duchy Estate: dry-stone walls line the lane. */
const hwRural = (d: number) => { const u = d % hw.lap; return u > 1900 && u < 10250; };
/** The Stray, the open common beside West Park at the line, where no trees grow. */
const hwStray = (d: number) => { const u = d % hw.lap; return u < 900 || u > hw.lap - 500; };

const harrogateWorlds: Stage = {
  id: 'harrogate-worlds',
  name: 'Harrogate Worlds Circuit',
  tagline: 'Two laps of the 2019 World Championships finishing circuit: Otley Road, the Oak Beck valley between its dry-stone walls, and the drag up Parliament Street.',
  finish: hw.finish,
  lapLength: hw.lap,
  elevationAt: hw.elevationAt,
  headingAt: hw.headingAt,
  baseAltitude: HW_ALTITUDE,
  climb: false,
  culture: 'gb',
  weather: 'cloudy',
  scenery: {
    wildHeight: (x, z) => hw.mean + 8 + fbm(x / 800 + 21, z / 800, 4) * 40 + fbm(x / 240, z / 240, 3) * 7,
    bumpAmp: 3,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 900,
    coniferBias: 0.1,
    forestCover: -0.1, // fields and hedgerows: a tree here, a copse there
    trees: { oak: 0.4, beech: 0.3, pine: 0.05, shrub: 0.25 },
    fields: false,
    mountainScale: 1.4, // the Pennines
    horizon: 'hills',
    road: 'alpine', // white dashed centre, thin edge lines
    barrier: 'stone',
    walls: hwRural,
    clearing: hwStray,
  },
  landmarks: [
    startArch, finishArch(hw.lap), finishArch(hw.finish),
    // Stone terraces in the town stretches: West Park (the Stray is on the left), the Duchy Estate's Cornwall Road and the finish straight.
    ...perLap([
      ...terraceRow(220, 1320, 1, 'stone', [1, 2]),
      ...terraceRow(9328, 11572, 1, 'stone', [3, 4]),
      ...terraceRow(11660, 13024, -1, 'stone', [5, 6]),
      ...terraceRow(12452, 12848, 1, 'stone', [7, 8]),
    ], hw.lap, hw.laps),
  ],
  signs: namedPlaces(HW_PLACES, hw.lap, hw.laps),
  crowdSpots: Array.from({ length: hw.laps }, (_, i) => i * hw.lap + HW_KOM - 80),
  race: {
    sprints: [{ d: hw.lap, name: 'Parliament Street sprint' }],
    summits: Array.from({ length: hw.laps }, (_, i) => ({ d: i * hw.lap + HW_KOM, name: 'Oak Beck climb', cat: 4 as const })),
  },
};

export default harrogateWorlds;
