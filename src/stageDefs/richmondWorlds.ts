
import type { WaterBody } from '../world/waterTypes';
import { fbm } from '../world/noise.js';
import { eastSouth, type LonLat } from '../world/flatironsPlacement';
import richmondRoute from '../routes/real/richmond-worlds';
import { sinkInto } from '../world/waterTypes';
import { finishArch, monumentAt, namedPlaces, perLap, startArch, terraceRow } from '../stageKit';
import type { Stage } from '../stages';
import { circuitGeometry } from './circuit';

// ---- Richmond: the 2015 Worlds road-race circuit ----
//
// The UCI Road World Championships road-race circuit, Richmond, Virginia (2015; the elite men rode it 16 times):
// 16.2 km from the Greater Richmond Convention Center on Broad Street west to Monument Avenue and round the Jefferson Davis
// monument, back through Virginia Commonwealth University and Shockoe Slip, east along the canal to Great Shiplock Park and up
// the cobbled Libby Hill from Rocketts Landing (a 250 m climb up Church Hill, the view that gave the city its name), a quick
// descent and the 110 m climb of 23rd Street (cobbles, up to 20%), down through Shockoe Bottom and up the 300 m of Governor
// Street beside the Capitol, then the 680 m of Broad Street to the line (richmond2015.com course notes quoted by
// cyclingmagazine.ca 2015-09-25 and capovelo.com 2014-02-25; WWBT NBC12's race guide 2015-09-24). The road is the real one,
// baked to 15.0 km and stretched to the published lap; its elevation is SRTM's, which smooths the cobbled ramps (the real
// 23rd Street is steeper than the 7% the 100 m grid shows). The stage is two laps.
/** The Capitol's height as built (monumentCity.ts), metres. */
const CAPITOL_HEIGHT = 34.4;
const RW_LAP = 16200;
const RW_LAPS = 2;
const rw = circuitGeometry(richmondRoute, RW_LAP, RW_LAPS, 0.2, 40, 127);
const RW_START: LonLat = [-77.43638, 37.54238]; // the baked road's first point: the finish line
const RW_ALTITUDE = 64; // m above sea level at the line
const RW_GROUND = rw.mean + 4; // the wild ground: the plateau the city stands on, a little above the road's mean
/** A real place in the stage's frame: metres east and south of the line, stretched like the road. */
const rwAt = (p: LonLat): [number, number] => { const e = eastSouth(RW_START, p); return [e.x / rw.scale, e.z / rw.scale]; };
// The James River below the canal, Libby Hill and Great Shiplock Park: its middle, from OpenStreetMap, west to east.
const RW_WATER: WaterBody[] = [{
  kind: 'river', width: 230, level: -RW_ALTITUDE + 1.5,
  pts: ([[-77.4600, 37.5310], [-77.4500, 37.5300], [-77.4420, 37.5268], [-77.4337, 37.5253], [-77.4280, 37.5236], [-77.4235, 37.5215], [-77.4180, 37.5196], [-77.4120, 37.5170], [-77.4040, 37.5140]] as LonLat[]).map(rwAt),
}];
const RW_HILLS = (x: number, z: number) => RW_GROUND + fbm(x / 600 + 11, z / 600, 3) * 10 + fbm(x / 160, z / 160, 2) * 2.5;
// KOMs and places, in lap metres (the baked profile's tops: Libby Hill 12,240; 23rd Street 13,440).
const RW_LIBBY = 12240;
const RW_23RD = 13440;
/** Lap metres (multiples of the 44 m row spacing) where a row of houses fits beside the road, on the left and on the right. */
const RW_LEFT: [number, number][] = [[0, 484], [836, 1804], [2068, 2948], [4708, 5060], [5368, 5764], [5852, 6600], [6688, 7084], [7172, 8140], [8228, 9500], [12364, 12804], [13552, 14564], [14960, 15400]];
const RW_RIGHT: [number, number][] = [[0, 748], [968, 1672], [2024, 2992], [3916, 5016], [5456, 5764], [5852, 6600], [6908, 8140], [8272, 9500], [12276, 12804], [13420, 14740], [15180, 15664], [15752, 16192]];
const RW_PLACES: [number, string][] = [[3400, 'Monument Avenue'], [8100, 'Shockoe Slip'], [10300, 'Great Shiplock Park'], [11000, 'Libby Hill'], [12950, '23rd Street'], [14100, 'Governor Street']];

const richmondWorlds: Stage = {
  id: 'richmond-worlds',
  name: 'Richmond Worlds Circuit',
  tagline: 'Two laps of the 2015 World Championships circuit: Monument Avenue, the cobbles of Libby Hill and 23rd Street, and the drag up Governor Street to the Capitol.',
  finish: rw.finish,
  lapLength: rw.lap,
  elevationAt: rw.elevationAt,
  headingAt: rw.headingAt,
  baseAltitude: RW_ALTITUDE,
  climb: false,
  weather: 'clear',
  scenery: {
    wildHeight: (x, z) => sinkInto(RW_WATER, x, z, RW_HILLS(x, z), 22, 140),
    bumpAmp: 2,
    rockLine: 900,
    snowLine: 1e9,
    treeLine: 900,
    coniferBias: 0.15,
    forestCover: 0.12,
    trees: { oak: 0.35, beech: 0.2, cottonwood: 0.2, pine: 0.1, shrub: 0.15 },
    fields: false,
    mountainScale: 0.6,
    horizon: 'hills',
    road: 'us-highway',
    water: RW_WATER,
    clearing: (d) => { const u = d % rw.lap; return u > rw.lap - 520 && u < rw.lap - 120; }, // Capitol Square
  },
  landmarks: [
    startArch, finishArch(rw.lap), finishArch(rw.finish),
    ...perLap([
      // The Capitol, on the left of Broad Street just before the line (the real one stands a few blocks east, by Governor Street).
      monumentAt('virginia-capitol', rw.lap - 330, -1, 78, CAPITOL_HEIGHT, { yaw: 0, clearance: 50 }),
      // Brick rowhouses along the streets where the whole row clears the road's other legs and the river (found from the stage's own road).
      ...RW_LEFT.flatMap(([a, b]) => terraceRow(a, b, -1, 'brick', [1, 2])),
      ...RW_RIGHT.flatMap(([a, b]) => terraceRow(a, b, 1, 'brick', [3, 4])),
    ], rw.lap, rw.laps),
  ],
  signs: namedPlaces(RW_PLACES, rw.lap, rw.laps),
  crowdSpots: [RW_LIBBY - 150, RW_23RD - 90, 14600].flatMap((d) => [d, d + rw.lap]),
  race: {
    sprints: [{ d: rw.lap, name: 'Broad Street sprint' }],
    summits: [RW_LIBBY, RW_23RD, rw.lap + RW_LIBBY, rw.lap + RW_23RD].map((d, i) => ({ d, name: i % 2 ? '23rd Street' : 'Libby Hill', cat: 3 as const })),
  },
};

export default richmondWorlds;
