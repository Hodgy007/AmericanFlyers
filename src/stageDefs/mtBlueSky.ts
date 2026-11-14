
import blueSkyRoute from '../routes/real/mt-blue-sky';
import { monumentAt } from '../stageKit';
import { buildClimb, summitSign } from './climb';

// Mount Blue Sky (formerly Mount Evans), Colorado: Colorado 5 from Echo Lake Lodge (10,600 ft) to the summit
// parking at 14,130 ft, the highest paved road in North America. 14.5 miles (23.3 km), 3,543 ft (1,080 m) of
// climbing at 4.6% (pjammcycling.com, codot.gov). Spruce and bristlecone pines below the tree line (about 3,500 m),
// then tundra, rock and lingering snow; Summit Lake is at 12,830 ft. It carries on from the Hell of the West's Echo Lake stage.
const mtBlueSky = buildClimb({
  id: 'mt-blue-sky',
  route: blueSkyRoute,
  name: 'Mount Blue Sky',
  tagline: '14.5 miles from Echo Lake Lodge, where the Hell of the West stops, up the highest paved road in North America to 14,130 ft.',
  length: 23300,
  gain: 1080,
  maxGrade: 0.09,
  hairpinWord: 'Switchback',
  baseAltitude: 3231,
  places: [{ d: 14630, name: 'Summit Lake' }],
  scenery: {
    bumpAmp: 12,
    rockLine: 350,
    snowLine: 1100, // lingering snow patches near the top
    treeLine: 270, // about 3,500 m
    coniferBias: 1,
    forestCover: 0.35,
    trees: { spruce: 0.55, pine: 0.45 },
    fields: false,
    mountainScale: 3.6,
    horizon: 'rockies',
    road: 'park',
  },
  landmarks: [
    monumentAt('log-lodge', 70, 1, 20, 8.1, { options: { lines: ['ECHO LAKE LODGE'] }, yaw: -0.4, clearance: 22 }),
    monumentAt('crest-house-ruins', 23180, 1, 42, 5.6, { yaw: -0.3, clearance: 24 }),
    summitSign(23300, 'MOUNT BLUE SKY', '14,130 FT'),
  ],
});

export default mtBlueSky;
