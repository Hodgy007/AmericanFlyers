
import ventouxRoute from '../routes/real/ventoux';
import { monumentAt } from '../stageKit';
import { buildClimb, colSign } from './climb';

// Mont Ventoux from Bédoin (300 m) to the summit (1,910 m): 21.4 km, 1,610 m,
// 7.5%. Gentle vineyards to Saint-Estève, then 9–10% through the forest to
// Chalet Reynard, then the bare white limestone to the top. The road and its
// profile are the real ones. The white scree is the ground's scree layer (`screeLine`).
const ventoux = buildClimb({
  id: 'ventoux',
  route: ventouxRoute,
  name: 'Mont Ventoux',
  tagline: '21.4 km at 7.5% from Bédoin: the forest at 9–10%, then the bare white moonscape to 1,910 m.',
  kmGrades: [4.3, 4.8, 3.4, 5.2, 4.4, 7.6, 10.7, 9.4, 9.2, 9.4, 9.7, 9.0, 8.4, 8.9, 9.1, 6.4, 7.4, 7.8, 6.5, 8.1, 9.0, 9.0],
  length: 21400,
  gain: 1610,
  maxGrade: 0.13,
  hairpinWord: 'Virage',
  baseAltitude: 300,
  scenery: {
    bumpAmp: 9,
    rockLine: 1060,
    snowLine: 1e9, // it is summer: the white summit is limestone, not snow
    screeLine: 1150, // the bald white summit above Chalet Reynard (about 1,450 m up the mountain)
    treeLine: 1100,
    coniferBias: 0.7,
    forestCover: 0.35,
    trees: { oak: 0.3, pine: 0.4, beech: 0.3 },
    fields: false,
    mountainScale: 1.6,
    horizon: 'hills',
    road: 'alpine',
    barrier: 'stone',
  },
  // The summit is a broad, bare, gently rounded top (Mont Ventoux's white plateau), not a ridge: the
  // ground spreads level out to about 130 m around the finish and falls away 20 degrees beyond it.
  summit: { d: 21330, side: 0, offset: 0, rise: 4, flat: 130, slope: 0.36, fadeFrom: 520, fadeTo: 1300 },
  // Chalet Reynard is at 1,440 m on the real road; the Simpson memorial stands 1.3 km below the top.
  places: (at) => [{ d: 5500, name: 'Saint-Estève' }, { d: at.altitude(1440) - 90, name: 'Chalet Reynard' }],
  landmarks: (at) => [
    monumentAt('chalet', at.altitude(1440), 1, 24, 10.2, { options: { lines: ['CHALET REYNARD'] }, yaw: -0.4, clearance: 20 }),
    monumentAt('simpson-memorial', 20100, 1, 8, 2.9, { yaw: -0.5, clearance: 6 }),
    // On the level crown of the summit plateau, right of the road through the last 100 m: the road swings hard left
    // over the finish, so the banded mast stands ahead of the rider on the way up, then sweeps past on the right in
    // the last 130 m. Sized for its part on the skyline: the real mast is 120 m on a plateau this wide. It has to stay
    // inside the 130 m crown: out on the flank the falling ground hides it from below.
    monumentAt('ventoux-observatory', 21300, 1, 40, 76, { yaw: -Math.PI / 2, clearance: 46 }),
    colSign(21400, { style: 'fr', lines: ['MONT VENTOUX', '1910 m'] }),
  ],
});

export default ventoux;
