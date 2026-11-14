
import washingtonRoute from '../routes/real/mt-washington';
import { monumentAt } from '../stageKit';
import { buildClimb, summitSign } from './climb';


// Mount Washington Auto Road, New Hampshire: from the toll house on NH-16 (about 1,640 ft) to the summit
// parking at 6,288 ft (1,917 m). 7.6 miles (12.2 km) climbing 4,650 ft (1,417 m) at 12% on average, with
// stretches of 18% and the last 50 yards at 22% (the Mount Washington Hillclimb: wikipedia.org, mwarbh.org).
// Northern hardwoods, then spruce and fir, then krummholz at the tree line (about 4,400 ft) and bare grey rock
// above; usually in cloud and always windy. The road is tagged bicycle=no, so it is baked with the car profile.
const mtWashington = buildClimb({
  id: 'mt-washington',
  route: washingtonRoute,
  name: 'Mount Washington Auto Road',
  tagline: '7.6 miles at 12% from the Glen House to the summit of New England, with the last pitch at 22%. Cloud, wind and bare rock above the tree line.',
  length: 12200,
  gain: 1417,
  maxGrade: 0.22,
  hairpinWord: 'Switchback',
  baseAltitude: 499,
  weather: 'cloudy',
  places: (at) => [{ d: at.altitude(1170), name: 'Halfway House' }],
  scenery: {
    bumpAmp: 12,
    rockLine: 700, // bare rock from about 1,200 m
    snowLine: 1700, // it is summer: no snow on the road
    treeLine: 850, // krummholz at about 1,350 m
    coniferBias: 0.7,
    forestCover: 0.5,
    trees: { beech: 0.3, spruce: 0.5, aspen: 0.12, shrub: 0.08 },
    fields: false,
    mountainScale: 3.0,
    horizon: 'hills',
    road: 'lane',
    barrier: 'none', // the Auto Road is unguarded over most of its length: steep drops, no rails
  },
  // The ground falls away from a bare cone at the summit, so the buildings stand against the sky and are in view from
  // the last 500 m (the generic wild ground climbs hundreds of metres within a kilometre of the road and hid them).
  summit: { d: 12225, side: 1, offset: 40, rise: 3, flat: 60, slope: 0.5, fadeFrom: 380, fadeTo: 1200 },
  landmarks: [
    monumentAt('washington-summit', 12225, 1, 40, 38.5, { yaw: -0.12, clearance: 40 }), // the buildings: inside the last bend, just past the finish, so they are ahead on the right from 500 m out, off the right edge at 200 m (the camera swings 100 degrees by 50 m out), and ahead again in the last 100 m
    monumentAt('washington-tower', 12200, -1, 60, 57, { clearance: 20 }), // the broadcast tower, apart from them on the outside of the bend, straight ahead of the last straight: it is what the camera sees at 200 m
    summitSign(12200, 'MOUNT WASHINGTON', 'ELEV. 6,288 FT'),
  ],
});

export default mtWashington;
