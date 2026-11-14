
import stelvioRoute from '../routes/real/stelvio';
import { monumentAt } from '../stageKit';
import { buildClimb, colSign } from './climb';

// From Prato allo Stelvio (~915 m) to the pass (2758 m): 24.5 km, 1843 m,
// 7.5% average (mycols.app, climbfinder.com). The road is the real one: an
// easier valley start past Gomagoi and Trafoi, then the 48 hairpins, which
// bunch into the famous wall below the summit.
const stelvio = buildClimb({
  id: 'stelvio',
  route: stelvioRoute,
  name: 'Stelvio Pass',
  tagline: '24.5 km at 7.5% from Prato to 2758 m, through 48 numbered hairpins.',
  kmGrades: [4.5, 5.0, 5.5, 6.0, 6.0, 6.5, 6.5, 7.0, 7.5, 8.0, 8.0, 8.5, 8.5, 8.0, 8.5, 8.5, 9.0, 8.5, 8.5, 8.0, 8.5, 8.5, 8.0, 8.0, 7.5],
  length: 24500,
  gain: 1843, // 915 m + 1843 m = 2758 m at the pass
  maxGrade: 0.13,
  hairpins: 48,
  hairpinWord: 'Tornante',
  baseAltitude: 915,
  scenery: {
    bumpAmp: 12,
    rockLine: 1150,
    snowLine: 1760,
    treeLine: 1050,
    coniferBias: 0.95,
    forestCover: 0.35,
    trees: { spruce: 0.45, larch: 0.3, pine: 0.25 },
    fields: false,
    mountainScale: 3.4,
    horizon: 'alps',
    road: 'alpine',
    barrier: 'stone',
  },
  landmarks: [
    monumentAt('pass-buildings', 24400, 1, 30, 22.5, { options: { style: 'it' }, yaw: -0.25, clearance: 28 }),
    monumentAt('pass-buildings', 24470, -1, 36, 22.5, { options: { seed: 5 }, yaw: 0.25, clearance: 28 }),
    colSign(24500, { style: 'it', lines: ['PASSO DELLO STELVIO', '2758 m'] }),
  ],
});

export default stelvio;
