
import alpeRoute from '../routes/real/alpe-dhuez';
import { monumentAt } from '../stageKit';
import { buildClimb, colSign } from './climb';

// From Le Bourg-d'Oisans (723 m) to the top (1841 m). The road is the real one;
// per-kilometre gradients from swi-cycling.com. Its 21 hairpins are found in the road.
const alpe = buildClimb({
  id: 'alpe-dhuez',
  route: alpeRoute,
  name: "Alpe d'Huez",
  tagline: "14 km at 8% from Le Bourg-d'Oisans, up all 21 hairpins. Real gradients.",
  kmGrades: [9.3, 10.2, 8.6, 8.2, 8.6, 8.0, 8.6, 8.9, 7.3, 8.4, 8.8, 8.7, 5.8, 2.4],
  length: 14000,
  gain: 1118,
  maxGrade: 0.135,
  hairpins: 21,
  hairpinWord: 'Virage',
  baseAltitude: 723,
  scenery: {
    bumpAmp: 10,
    rockLine: 1250,
    snowLine: 1650,
    treeLine: 760,
    coniferBias: 0.9,
    forestCover: 0.3,
    trees: { spruce: 0.5, larch: 0.25, beech: 0.25 },
    fields: false,
    mountainScale: 2.6,
    horizon: 'alps',
    road: 'alpine',
  },
  landmarks: (at) => {
    const seven = at.hairpin('7'); // Huez village: its church stands on the outside of hairpin 7
    return [
      monumentAt('alpine-church', seven.d, seven.outside, 30, 26.6, { yaw: seven.outside * -0.3, clearance: 16 }),
      monumentAt('ski-apartments', 13380, -1, 40, 15, { options: { seed: 1 }, yaw: 0.3, clearance: 32 }),
      monumentAt('alpe-village', 13720, 1, 28, 17, { options: { seed: 1 }, yaw: 0.12, clearance: 48 }),
      colSign(14000, { style: 'fr', lines: ["ALPE D'HUEZ", '1850 m'] }),
    ];
  },
});

export default alpe;
