
import diabloRoute from '../routes/real/mt-diablo';
import { monumentAt } from '../stageKit';
import { buildClimb, summitSign } from './climb';

// Mount Diablo, California: from Diablo Road in Danville up Mount Diablo Scenic Boulevard, South Gate Road and
// Summit Road to the summit (3,849 ft, 1,173 m). The Mount Diablo Challenge's 11.2 miles (18 km) climb 3,249 ft
// (990 m) from the Athenian School's road (mountdiablochallenge.itsyourrace.com). Golden summer grass, blue and
// live oaks, grey pines and chaparral. (It stays on daytime light: at dusk the straw goes brown.)
const mtDiablo = buildClimb({
  id: 'mt-diablo',
  route: diabloRoute,
  name: 'Mount Diablo',
  tagline: '11.2 miles from Danville through South Gate to the stone summit tower, over golden grass and oaks.',
  length: 18000,
  gain: 990,
  maxGrade: 0.16,
  hairpinWord: 'Switchback',
  baseAltitude: 183,
  places: [{ d: 5900, name: 'South Gate' }],
  scenery: {
    bumpAmp: 9,
    rockLine: 750,
    snowLine: 1900,
    treeLine: 1500,
    dryGrass: 1,
    coniferBias: 0.3,
    forestCover: 0.1, // oak savanna: groves among the grass
    trees: { oak: 0.5, pine: 0.2, shrub: 0.3 },
    fields: false,
    mountainScale: 1.8,
    horizon: 'hills',
    road: 'park',
  },
  landmarks: [
    monumentAt('diablo-summit', 18035, 1, 26, 19, { yaw: -0.2, clearance: 24 }),
    summitSign(18000, 'MOUNT DIABLO', 'SUMMIT 3,849 FT'),
  ],
});

export default mtDiablo;
