// Pro teams on the road: computer-ridden groups that ride the stage at their
// own steady watts per kilo, in a two-by-two paceline, slowing on the climbs
// and flying down the descents like you do. The team names are (lovingly)
// comedic near-misses of real ones; the riders are made up.

import { gradeAt, currentStage } from './course';
import { DEFAULT_PARAMS, stepSpeed } from './physics';
import type { OtherRider } from './world/others';

interface Team {
  name: string;
  short: string; // on name tags
  color: string; // jersey and frame
  frame: string;
}

export const TEAMS: Team[] = [
  { name: 'UAE Team Emigrates', short: 'Emigrates', color: '#f4f4f4', frame: '#c8102e' },
  { name: 'Plasma | Lease-a-Trike', short: 'Plasma', color: '#ffd200', frame: '#111111' },
  { name: 'INEPTOS Grenadines', short: 'Ineptos', color: '#1b2a4a', frame: '#c8102e' },
  { name: 'Scandal Quick-Slip', short: 'Quick-Slip', color: '#1e64c8', frame: '#ffffff' },
  { name: 'Little-Trek', short: 'Little-Trek', color: '#c8102e', frame: '#0a1a3a' },
  { name: 'EZ Procrastination–EasyToast', short: 'EZ', color: '#ff4fa3', frame: '#1c2b5a' },
  { name: 'Red Mule–BORE–hanggrohe', short: 'Red Mule', color: '#1a2340', frame: '#d4002a' },
  { name: 'Moviestar', short: 'Moviestar', color: '#0a3d91', frame: '#7ac143' },
  { name: 'Groupie–FDJ', short: 'Groupie', color: '#2a6ee0', frame: '#e02a2a' },
  { name: 'Coffeedis', short: 'Coffeedis', color: '#d6001c', frame: '#ffffff' },
  { name: 'Alpaca–Deceuncle', short: 'Alpaca', color: '#1f8fb8', frame: '#0f1d2e' },
  { name: 'Bahrain Vicarious', short: 'Vicarious', color: '#b8001f', frame: '#c9a227' },
];

const FIRST_NAMES = ['Hugo', 'Luca', 'Jan', 'Matteo', 'Sven', 'Diego', 'Tom', 'Kasper', 'Nils', 'Rui', 'Marco', 'Felix',
  'Oscar', 'Theo', 'Arne', 'Bruno', 'Pierre', 'Lars', 'Enzo', 'Joris', 'Milan', 'Emil', 'Paco', 'Bram', 'Gus', 'Otto'];

/** Watts per kilo for each group, from a steady club pace to pros on a training ride. */
const PACES = [2.0, 2.6, 3.1, 3.6, 4.2];
const RIDER_KG = 68;
const BIKE_KG = 7.5;
const PACK_CDA = DEFAULT_PARAMS.cda * 0.72; // most of the bunch sits in the draft
const ROW = 2.1; // metres between rows of the paceline

export interface Group {
  id: string;
  team: Team;
  wkg: number;
  distance: number; // the front of the group
  speed: number;
  riders: { id: string; name: string; row: number; side: number }[];
  phase: number; // for small surges
}

function pick<T>(list: T[], n: number, seed: number) {
  const out: T[] = [];
  let s = seed;
  while (out.length < n) {
    s = (s * 9301 + 49297) % 233280;
    const item = list[Math.floor((s / 233280) * list.length)];
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

export class Peloton {
  groups: Group[] = [];
  private time = 0;

  /** New groups spread around the rider, as when a stage is chosen. */
  reset(around: number) {
    const seed = Math.floor(Math.random() * 100000);
    const teams = pick(TEAMS, PACES.length, seed);
    const offsets = [-140, 70, 260, 620, 1150].sort(() => Math.random() - 0.5);
    const finish = currentStage().finish;
    this.groups = PACES.map((wkg, g) => {
      const size = 4 + ((seed + g) % 3); // 4–6 riders
      const names = pick(FIRST_NAMES, size, seed + g * 17);
      let d = Math.max(20, around + offsets[g]);
      if (finish !== null) d = Math.min(d, Math.max(20, finish - 300));
      return {
        id: `team-${g}`,
        team: teams[g],
        wkg,
        distance: d,
        speed: 5 + wkg * 1.5,
        riders: names.map((name, i) => ({ id: `team-${g}-${i}`, name, row: Math.floor(i / 2), side: i % 2 ? 1 : -1 })),
        phase: Math.random() * 10,
      };
    });
  }

  update(dt: number) {
    this.time += dt;
    const finish = currentStage().finish;
    for (const g of this.groups) {
      const grade = gradeAt(g.distance);
      // Steady effort with gentle surges; they soft-pedal steep descents.
      const surge = 1 + 0.05 * Math.sin(this.time / 23 + g.phase) + 0.03 * Math.sin(this.time / 7 + g.phase * 2);
      const power = g.wkg * RIDER_KG * surge * (grade < -0.04 ? 0.35 : 1);
      g.speed = stepSpeed(g.speed, power, grade, dt, { massKg: RIDER_KG + BIKE_KG, cda: PACK_CDA, crr: DEFAULT_PARAMS.crr });
      g.distance += g.speed * dt;
      // Over the line: they roll out and start the stage again.
      if (finish !== null && g.distance > finish + 120) {
        g.distance = 20;
        g.speed = 4;
      }
    }
  }

  /** Every pro rider as an "other rider" for the world, drafting and the riders list. */
  riders(): OtherRider[] {
    const out: OtherRider[] = [];
    for (const g of this.groups) {
      const power = Math.round(g.wkg * RIDER_KG);
      for (const r of g.riders) {
        out.push({
          id: r.id,
          name: `${r.name} (${g.team.short})`,
          tag: r.row === 0 && r.side < 0 ? `${g.team.short} · ${g.wkg.toFixed(1)} W/kg` : '',
          distance: g.distance - r.row * ROW,
          speedMs: g.speed,
          power,
          cadence: 88 + (r.row % 3) * 3,
          team: g.team.name,
          jersey: g.team.color,
          frame: g.team.frame,
          lane: 2.6 + r.side * 0.42, // two by two, just right of centre
        });
      }
    }
    return out;
  }

  /** The back of a group, for "Join". */
  back(g: Group) {
    return g.distance - (Math.ceil(g.riders.length / 2) - 1) * ROW;
  }
}
