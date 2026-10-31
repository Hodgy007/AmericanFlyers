// Records a ride second by second, and exports it as a .tcx file (which
// Strava, TrainingPeaks and Garmin Connect accept as an indoor ride).

import type { Samples } from './sync';

export class RideRecorder {
  id = crypto.randomUUID();
  startedAt: Date | null = null;
  readonly samples: Samples = { power: [], cadence: [], hr: [], speed: [], distance: [], elevation: [] };
  private acc = 0;

  get seconds() {
    return this.samples.power.length;
  }

  /** Call every frame; stores one sample per second while moving. */
  tick(dt: number, moving: boolean, s: { power: number; cadence: number; hr: number; speedMs: number; distance: number; elevation: number }) {
    if (!moving) return;
    this.startedAt ??= new Date();
    this.acc += dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      const x = this.samples;
      x.power.push(Math.round(s.power));
      x.cadence.push(Math.round(s.cadence));
      x.hr.push(Math.round(s.hr));
      x.speed.push(Math.round(s.speedMs * 10));
      x.distance.push(Math.round(s.distance));
      x.elevation.push(Math.round(s.elevation * 10));
    }
  }
}

export function toTcx(a: { title: string; started_at: string; duration_s: number; distance_m: number; kj: number | null }, s: Samples) {
  const t0 = new Date(a.started_at).getTime();
  const esc = (v: string) => v.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
  const points = s.power.map((p, i) => {
    const hr = s.hr[i] ? `<HeartRateBpm><Value>${s.hr[i]}</Value></HeartRateBpm>` : '';
    return `<Trackpoint><Time>${new Date(t0 + i * 1000).toISOString()}</Time><AltitudeMeters>${(s.elevation[i] / 10).toFixed(1)}</AltitudeMeters><DistanceMeters>${s.distance[i]}</DistanceMeters>${hr}<Cadence>${Math.min(254, s.cadence[i])}</Cadence><Extensions><ns3:TPX><ns3:Speed>${(s.speed[i] / 10).toFixed(1)}</ns3:Speed><ns3:Watts>${p}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${new Date(t0).toISOString()}</Id>
<Lap StartTime="${new Date(t0).toISOString()}"><TotalTimeSeconds>${a.duration_s}</TotalTimeSeconds><DistanceMeters>${Math.round(a.distance_m)}</DistanceMeters><Calories>${Math.round(a.kj ?? 0)}</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>
${points.join('\n')}
</Track></Lap>
<Notes>${esc(a.title)} (American Flyers)</Notes>
</Activity></Activities></TrainingCenterDatabase>
`;
}
