// Builds share cards from rides and shares them. The buttons that start this are in
// shareButton.ts; this file (with the card canvas it draws) loads when one is pressed.

import type { Activity } from '../cloud/sync';
import type { Kit } from '../kit';
import { STAGES, stageById, type Stage } from '../stages';
import { elevationProfile, formatDuration, routeShape, shareCard, type ShareCardData } from './shareCard';

export interface ShareRide {
  stage: Stage | null; // null: no known route
  fromM: number;
  toM: number;
  title: string;
  subtitle: string;
  timeS: number;
  avgPower: number | null;
  climbedM: number;
  distanceM: number;
  headline?: string;
  badges: string[];
  imperial: boolean;
  kit: Kit | null;
  rider?: string;
}

const KM_PER_MI = 1.609344;

/** The card's numbers and picture for a ride. */
export function shareDataFromRide(r: ShareRide): ShareCardData {
  const km = r.distanceM / 1000;
  const stats = [
    { label: 'Time', value: formatDuration(r.timeS) },
    { label: 'Distance', value: r.imperial ? `${(km / KM_PER_MI).toFixed(1)} mi` : `${km.toFixed(1)} km` },
    { label: 'Climbed', value: r.imperial ? `${Math.round(r.climbedM * 3.28084).toLocaleString('en-US')} ft` : `${Math.round(r.climbedM).toLocaleString('en-US')} m` },
  ];
  if (r.avgPower) stats.push({ label: 'Avg power', value: `${Math.round(r.avgPower)} W` });
  if (r.timeS > 0 && r.distanceM > 0) {
    const kmh = (r.distanceM / r.timeS) * 3.6;
    stats.push({ label: 'Avg speed', value: r.imperial ? `${(kmh / KM_PER_MI).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h` });
  }
  const to = Math.max(r.toM, r.fromM + 100);
  return {
    title: r.title,
    subtitle: r.subtitle,
    route: r.stage ? routeShape(r.stage, r.fromM, to) : [],
    profile: r.stage ? elevationProfile(r.stage, r.fromM, to) : [],
    stats,
    headline: r.headline,
    badges: r.badges,
    kit: r.kit,
    rider: r.rider,
  };
}

/** A saved ride, for sharing from your profile. Routes are known for the built-in stages only. */
export function shareRideFromActivity(a: Activity, imperial: boolean, kit: Kit | null, rider?: string): ShareRide {
  const known = a.stage_id && STAGES.some((s) => s.id === a.stage_id) ? stageById(a.stage_id) : null;
  const date = new Date(a.started_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const badges: string[] = [];
  if (a.finished) badges.push('🏁 Finished');
  if (a.race_place && a.race_size) badges.push(`🏆 ${a.race_place}${suffix(a.race_place)} of ${a.race_size}`);
  if (a.finish_s) badges.push(`⏱ ${formatDuration(a.finish_s)}`);
  return {
    stage: known, fromM: 0, toM: a.distance_m, title: a.stage_name ?? a.title, subtitle: date,
    timeS: a.duration_s, avgPower: a.avg_power, climbedM: a.climbed_m, distanceM: a.distance_m,
    headline: a.race_place && a.race_size ? `${a.race_place}${suffix(a.race_place)} of ${a.race_size}` : undefined,
    badges, imperial, kit, rider,
  };
}

function suffix(n: number) {
  const v = n % 100;
  return ['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th';
}

/** Draws the card and shares or saves it; reports through `toast`. */
export async function runShare(data: ShareCardData, toast: (m: string, ms?: number) => void) {
  try {
    const how = await shareCard(data, `${data.title} on American Flyers`);
    if (how === 'saved') toast('Saved your ride card as a picture. Share it anywhere!', 4500);
  } catch (e) {
    toast(`Couldn’t make the card: ${(e as Error).message}`, 5000);
  }
}
