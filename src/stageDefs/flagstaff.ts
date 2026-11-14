
import { eastSouth, flatironsPlacement, type LonLat } from '../world/flatironsPlacement';
import flagstaffRoute from '../routes/real/flagstaff';
import { monumentInWorld } from '../stages';
import { buildClimb, summitSign } from './climb';

// Flagstaff Mountain, Boulder, Colorado: Flagstaff Road from Baseline Road (5,730 ft) round Panorama Point and up
// the switchbacks to the crest at 7,705 ft. 4.6 miles, 1,975 ft (602 m), 8.1% (pjammcycling.com; the Super Flag
// climb the locals race). Ponderosa pine and open meadow, sandstone outcrops, and the Flatirons across the valley.
const FLAGSTAFF_START: LonLat = [-105.2877748, 40.0000659]; // Baseline Road and Flagstaff Road: the point the road is baked from
const FLAGSTAFF_FLATIRONS_SIZE = 270; // m tall: about 10 degrees of sky from the start, so they read from the road
const FIRST_FLATIRON: LonLat = [-105.29467, 39.99047];
const FIFTH_FLATIRON: LonLat = [-105.29281, 39.982];
const flatirons = flatironsPlacement(FLAGSTAFF_START, FIRST_FLATIRON, FIFTH_FLATIRON, [-105.2, 39.99], FLAGSTAFF_FLATIRONS_SIZE);
const flatironsMid = { x: (eastSouth(FLAGSTAFF_START, FIRST_FLATIRON).x + eastSouth(FLAGSTAFF_START, FIFTH_FLATIRON).x) / 2, z: (eastSouth(FLAGSTAFF_START, FIRST_FLATIRON).z + eastSouth(FLAGSTAFF_START, FIFTH_FLATIRON).z) / 2 };
const FLAGSTAFF_FLATIRONS = monumentInWorld('flatirons', { x: flatirons.x, z: flatirons.z, y: 10, yaw: flatirons.yaw }, FLAGSTAFF_FLATIRONS_SIZE);

const flagstaff = buildClimb({
  id: 'flagstaff',
  route: flagstaffRoute,
  name: 'Flagstaff Mountain',
  tagline: '4.6 miles at 8% up Boulder’s own climb: Flagstaff Road from Baseline, with the Flatirons beside the first switchbacks.',
  length: 7400,
  gain: 602,
  maxGrade: 0.13,
  hairpinWord: 'Switchback',
  baseAltitude: 1746,
  places: [{ d: 1125, name: 'Panorama Point' }],
  scenery: {
    bumpAmp: 9,
    rockLine: 500,
    snowLine: 1100,
    treeLine: 900,
    coniferBias: 0.9,
    forestCover: 0.15,
    trees: { pine: 0.75, spruce: 0.1, shrub: 0.15 },
    fields: false,
    mountainScale: 2.4,
    horizon: 'rockies',
    road: 'us-highway',
  },
  // Boulder lies in a basin below the road and the Flatirons rise from its edge: sink the wild ground towards them so the road
  // looks across to them instead of into the hillside beside it.
  basin: { ...flatironsMid, radius: 900, fade: 1500, floor: 0 },
  landmarks: [
    // The Flatirons stand where they really do: their slabs run north to south about 1.1 to 2 km south-west of the start
    // (the First Flatiron at 39°59'25.7"N 105°17'40.8"W, the Fifth at 39°58'55.2"N 105°17'34.1"W, uncovercolorado.com)
    // and face east, over Boulder. So they are on the left of the lower road and of the first switchbacks, and the road
    // swings round until they are behind it. See world/flatironsPlacement.ts.
    FLAGSTAFF_FLATIRONS,
    summitSign(7400, 'FLAGSTAFF MOUNTAIN'),
  ],
});

export default flagstaff;
