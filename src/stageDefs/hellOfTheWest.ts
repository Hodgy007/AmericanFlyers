
import echoLakeRoute from '../routes/real/hell-of-the-west';
import { monumentAt } from '../stageKit';
import type { Stage } from '../stages';
import { buildClimb } from './climb';

// "Hell of the West", the final stage in American Flyers (1985): filmed on
// Colorado 103 from Idaho Springs (2,293 m) up Chicago Creek to the sprint at
// Echo Lake (3,235 m), below Mount Evans (fast-rewind.com filming notes).
// 20.8 km, 942 m: about 3.5% for the first 11 km, 5.8% for the next 9, then
// the short flat at the lake (pjammcycling.com, summitbiking.org); the real
// road's profile and its two wide switchbacks, in the steeper upper half.
const hellOfTheWestClimb = buildClimb({
  id: 'hell-of-the-west', // keep this id: leaderboards and plans use it
  route: echoLakeRoute,
  name: 'Hell of the West · Stage 3: Echo Lake',
  tagline: 'The Hell of the West’s final stage: 20.8 km from Idaho Springs up Chicago Creek to the sprint at Echo Lake, 3,235 m.',
  kmGrades: [3.0, 3.2, 3.6, 3.8, 3.4, 3.0, 3.8, 4.0, 3.6, 3.4, 3.9, 5.2, 5.8, 6.2, 6.0, 5.8, 6.4, 6.0, 5.6, 5.9, 1.2],
  length: 20800,
  gain: 942,
  maxGrade: 0.1,
  hairpinWord: 'Switchback',
  baseAltitude: 2293,
  timeOfDay: 'dusk',
  scenery: {
    bumpAmp: 12,
    rockLine: 1100,
    snowLine: 1500, // the 4,000 m peaks around Mount Evans keep snow; the road stays below it
    treeLine: 1220, // Colorado's treeline is near 3,500 m, above Echo Lake
    coniferBias: 1,
    forestCover: 0.45,
    trees: { pine: 0.5, spruce: 0.35, aspen: 0.15 },
    fields: false,
    mountainScale: 3.2,
    horizon: 'rockies',
  },
  landmarks: [monumentAt('log-lodge', 20720, 1, 30, 8.1, { yaw: -0.4, clearance: 22 })],
});

const hellOfTheWest: Stage = {
  ...hellOfTheWestClimb,
  tourStage: 3,
  // Echo Lake is a summit finish. The mountain prime is where the road leaves
  // the creek and starts to climb in earnest (approximate: no published prime).
  race: { summits: [{ d: 12500, name: 'Chicago Creek prime', cat: 3 }, { d: 20800, name: 'Echo Lake', cat: 1 }], sprints: [{ d: 10400, name: 'Mid-stage sprint' }] },
};

export default hellOfTheWest;
