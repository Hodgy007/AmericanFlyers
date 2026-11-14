
import type { WaterBody } from '../world/waterTypes';
import { fbm } from '../world/noise.js';
import { eastSouth, type LonLat } from '../world/flatironsPlacement';
import centralParkRoute from '../routes/real/central-park';
import { sinkInto } from '../world/waterTypes';
import { skylineHeight, skylineTowers } from '../world/skyline';
import { finishArch, namedPlaces, roadTrace, startArch } from '../stageKit';
import type { Stage } from '../stages';
import { monumentInWorld } from '../stages';
import { circuitGeometry } from './circuit';

// ---- Central Park: the Park Drive loop ----
//
// Park Drive, Central Park, New York: the 6.1-mile loop of East, Center and West Drives (nycgovparks.org; the drives are
// closed to cars, which is why OpenStreetMap maps them as pedestrian ways and the baked route needed waypoints on them),
// ridden counter-clockwise, the way the cyclists go: north up the east side past the Met and the Reservoir, with Cat Hill on
// East Drive, round Harlem Meer, up Harlem Hill (about 28 m in 700 m, the park's steepest) and south down West Drive.
// The road is the real one (baked to 10.3 km, scaled to 9.8 km: 6.1 miles); three laps. The towers round the park are
// procedural (world/skyline.ts): a band outside the drive, taller to the south.
const CP_LAP = 9800;
const CP_LAPS = 3;
const cp = circuitGeometry(centralParkRoute, CP_LAP, CP_LAPS, 0.07, 250, 88);
const CP_START: LonLat = [-73.97293, 40.76885];
const CP_ALTITUDE = 28;
const cpAt = (p: LonLat): { x: number; z: number } => { const e = eastSouth(CP_START, p); return { x: e.x / cp.scale, z: e.z / cp.scale }; };
const CP_LOOP = roadTrace(cp.headingAt, CP_LAP, 20);
const CP_TOWERS = skylineTowers(CP_LOOP);
const CP_GROUND = cp.mean; // the park's own ground, in the road's datum
// The Reservoir (the Jacqueline Kennedy Onassis Reservoir, 106 acres), inside the loop between 86th and 96th Streets, its long side along the avenues.
const CP_RESERVOIR_AT = cpAt([-73.9626, 40.78545]);
const CP_WATER: WaterBody[] = [{ kind: 'pond', ...CP_RESERVOIR_AT, rx: 230, rz: 400, rot: -0.507, level: CP_GROUND + 4 }];
const CP_KOM_CAT = 1520; // the top of Cat Hill on East Drive
const CP_KOM_HARLEM = 4760; // the top of Harlem Hill
const CP_PLACES: [number, string][] = [[700, 'Cat Hill'], [2200, 'The Reservoir'], [3900, 'Harlem Meer'], [4000, 'Harlem Hill'], [7300, 'West Drive']];

const centralPark: Stage = {
  id: 'central-park',
  name: 'Central Park Loop',
  tagline: 'Three counter-clockwise laps of Park Drive: Cat Hill, the Reservoir, Harlem Hill, with Manhattan standing round the park.',
  finish: cp.finish,
  lapLength: cp.lap,
  elevationAt: cp.elevationAt,
  headingAt: cp.headingAt,
  baseAltitude: CP_ALTITUDE,
  climb: false,
  scenery: {
    wildHeight: (x, z) => sinkInto(CP_WATER, x, z, CP_GROUND + fbm(x / 420 + 5, z / 420, 3) * 5 + fbm(x / 110, z / 110, 2), 6, 60),
    bumpAmp: 1.6,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 900,
    coniferBias: 0.2,
    forestCover: 0.25,
    trees: { oak: 0.35, beech: 0.2, cottonwood: 0.2, pine: 0.1, aspen: 0.05, shrub: 0.1 },
    fields: false,
    mountainScale: 0.4,
    horizon: 'hills',
    road: 'city-park', // a granite kerb, white edge and lane lines
    water: CP_WATER,
  },
  landmarks: [
    startArch, finishArch(cp.lap), finishArch(2 * cp.lap), finishArch(cp.finish),
    // Manhattan, round the whole loop: one landmark at the world's origin, in range the whole stage (the tower positions are in the course frame).
    monumentInWorld('manhattan-skyline', { x: 0, z: 0, y: CP_GROUND - 3, yaw: 0 }, skylineHeight(CP_TOWERS), { options: { loop: CP_LOOP } }),
  ],
  signs: namedPlaces(CP_PLACES, cp.lap, cp.laps),
  crowdSpots: [CP_KOM_CAT - 120, CP_KOM_HARLEM - 120].flatMap((d) => Array.from({ length: cp.laps }, (_, i) => d + i * cp.lap)),
  race: {
    sprints: [{ d: cp.lap, name: 'Park Drive sprint' }, { d: 2 * cp.lap, name: 'Park Drive sprint' }],
    summits: Array.from({ length: cp.laps }, (_, i) => [
      { d: i * cp.lap + CP_KOM_CAT, name: 'Cat Hill', cat: 4 as const },
      { d: i * cp.lap + CP_KOM_HARLEM, name: 'Harlem Hill', cat: 3 as const },
    ]).flat(),
  },
};

export default centralPark;
