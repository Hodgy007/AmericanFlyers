
import zoncolanRoute from '../routes/real/zoncolan';
import { buildClimb, colSign } from './climb';

// Monte Zoncolan from Ovaro (525 m) to the top (1,735 m): 10.1 km, 1,210 m,
// 11.9%, with long stretches at 13–15% and ramps over 20%. The road and its
// profile are the real ones (the steepest ramps flattened to 22%).
const zoncolan = buildClimb({
  id: 'zoncolan',
  route: zoncolanRoute,
  name: 'Monte Zoncolan',
  tagline: '10.1 km at 11.9% from Ovaro, with ramps over 20%. The hardest climb in Italy.',
  kmGrades: [6.5, 8.8, 12.4, 14.2, 15.0, 14.5, 13.8, 15.4, 13.6, 8.0, 6.0],
  length: 10100,
  gain: 1210,
  maxGrade: 0.22,
  hairpinWord: 'Tornante',
  baseAltitude: 525,
  scenery: {
    bumpAmp: 11,
    rockLine: 1150,
    snowLine: 1500,
    treeLine: 1000,
    coniferBias: 0.8,
    forestCover: 0.4,
    trees: { beech: 0.55, spruce: 0.45 },
    fields: false,
    mountainScale: 2.8,
    horizon: 'alps',
    road: 'lane',
  },
  landmarks: [colSign(10100, { style: 'it', lines: ['MONTE ZONCOLAN', '1750 m'] })],
});

export default zoncolan;
