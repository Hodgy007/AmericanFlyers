
import tourmaletRoute from '../routes/real/tourmalet';
import { monumentAt } from '../stageKit';
import { buildClimb, colSign } from './climb';

// Col du Tourmalet from Luz-Saint-Sauveur (711 m) to the col (2,115 m):
// 19 km, 1,404 m, 7.4%; steadier below Barèges, then 8.5–10% through the
// hairpins of Super-Barèges. The road and its profile are the real ones.
const tourmalet = buildClimb({
  id: 'tourmalet',
  route: tourmaletRoute,
  weather: 'cloudy',
  name: 'Col du Tourmalet',
  tagline: '19 km at 7.4% from Luz-Saint-Sauveur, through Barèges and the hairpins to 2,115 m.',
  kmGrades: [5.2, 6.4, 7.0, 7.2, 7.0, 7.4, 6.2, 6.8, 7.2, 7.6, 7.8, 7.0, 8.6, 8.8, 9.2, 8.4, 9.0, 9.6, 9.8],
  length: 19000,
  gain: 1404,
  maxGrade: 0.12,
  hairpinWord: 'Virage',
  baseAltitude: 711,
  scenery: {
    bumpAmp: 12,
    rockLine: 1150,
    snowLine: 1650,
    treeLine: 900,
    coniferBias: 0.6,
    forestCover: 0.3,
    trees: { beech: 0.45, pine: 0.3, shrub: 0.25 },
    fields: false,
    mountainScale: 3.0,
    horizon: 'pyrenees',
    road: 'alpine',
    barrier: 'stone',
  },
  // Barèges is at 1,230 m; La Mongie's apartment blocks stand about 4 km below the col.
  places: (at) => [{ d: at.altitude(1230), name: 'Barèges' }, { d: 14800, name: 'La Mongie' }],
  landmarks: [
    monumentAt('ski-apartments', 15000, -1, 38, 17, { options: { seed: 3 }, yaw: 0.3, clearance: 30 }),
    monumentAt('ski-apartments', 15180, 1, 44, 17, { options: { seed: 4 }, yaw: -0.3, clearance: 30 }),
    monumentAt('geant-tourmalet', 18940, 1, 20, 7.4, { yaw: -0.35, clearance: 12 }),
    colSign(19000, { style: 'fr', lines: ['COL DU TOURMALET', 'ALT. 2115 m'] }),
  ],
});

export default tourmalet;
