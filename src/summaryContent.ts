// What the finish and summary cards say, as plain data: the title, the [label, value] figures, which actions are offered and the
// notes under them. No DOM, no three.js and no state: every function takes plain numbers and returns plain data, so it can be
// driven directly in a unit test (tests/unit/summaryContent.test.ts). The card itself is built in src/summaryCard.ts; the
// state changes at the finish (the flags, the fanfare, the plan, the race and tour, saving) stay in main.ts, which passes what
// it worked out in here.
import { formatTime } from './hud';
import { raceTime } from './ghost';

/** One line of the card: the label and its value. */
export type SummaryItem = [string, string];

/** A button on the card. Clicking it closes the card, then runs `onClick`. */
export interface SummaryAction { label: string; primary?: boolean; onClick: () => void }

/** The figures of a `RideStats` that the cards show (so a test needn't build a whole recorder). */
export interface StatsLike { seconds: number; avgPower: number; np: number; avgHr: number }

export const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const heartRate = (avgHr: number) => (avgHr ? `${Math.round(avgHr)} bpm` : '--');
const climbedText = (m: number, imperial: boolean) => `${Math.round(imperial ? m * FT_PER_M : m)} ${imperial ? 'ft' : 'm'}`;

/** The card for ending a ride (Reset): the window being recorded, with the distance and climbing within it. */
export function rideSummaryItems(stats: StatsLike, totals: { distance: number; climbed: number }, imperial: boolean): SummaryItem[] {
  const km = totals.distance / 1000;
  return [
    ['Time', formatTime(stats.seconds)],
    ['Distance', imperial ? `${(km / KM_PER_MI).toFixed(2)} mi` : `${km.toFixed(2)} km`],
    ['Avg power', `${Math.round(stats.avgPower)} W`],
    ['Norm. power', `${Math.round(stats.np)} W`],
    ['Avg HR', heartRate(stats.avgHr)],
    ['Climbed', climbedText(totals.climbed, imperial)],
  ];
}

/** The two buttons of the end-of-ride card. */
export function rideSummaryActions(startNew: () => void): SummaryAction[] {
  return [
    { label: 'Keep riding', onClick: () => {} },
    { label: 'Start a new ride', primary: true, onClick: startNew },
  ];
}

/** Said under the end-of-ride card when a workout split the trip, or '' when it didn't. */
export function splitNote(splitByWorkout: boolean, windowIsWorkout: boolean) {
  return splitByWorkout && !windowIsWorkout ? 'Part of this trip was a workout, saved as its own activity; these numbers are the ride since.' : '';
}

/** The ramp test's estimate: FTP is about 75 % of the best one-minute power. Null for any other workout, or with no best minute. */
export function rampTestFtp(isRampTest: boolean, best60: number): number | null {
  return isRampTest && best60 > 0 ? Math.round(best60 * 0.75) : null;
}

/** The card for a finished workout. `rampFtp` (from `rampTestFtp`) adds the estimate and the best minute at the top. */
export function workoutSummaryItems(
  stats: StatsLike & { tss(ftp: number): number; work: number; best60: number },
  ftp: number,
  rampFtp: number | null,
): SummaryItem[] {
  const items: SummaryItem[] = [
    ['Time', formatTime(stats.seconds)],
    ['Avg power', `${Math.round(stats.avgPower)} W`],
    ['Norm. power', `${Math.round(stats.np)} W`],
    ['TSS', String(Math.round(stats.tss(ftp)))],
    ['Energy', `${Math.round(stats.work / 1000)} kJ`],
    ['Avg HR', heartRate(stats.avgHr)],
  ];
  if (rampFtp !== null) items.unshift(['Est. FTP', `${rampFtp} W`], ['Best minute', `${Math.round(stats.best60)} W`]);
  return items;
}

/** The buttons of a finished workout: Done, and for a ramp test first "Set my FTP to …" (which runs `setFtp`). */
export function workoutSummaryActions(rampFtp: number | null, setFtp: (ftp: number) => void): SummaryAction[] {
  const actions: SummaryAction[] = [{ label: 'Done', onClick: () => {} }];
  if (rampFtp !== null) actions.unshift({ label: `Set my FTP to ${rampFtp} W`, primary: true, onClick: () => setFtp(rampFtp) });
  return actions;
}

/** What a race adds to the finish card: where the rider came and the points. */
export interface RaceFigures { place: number; of: number; time: number; sprint: number; kom: number }

/** What the finish card's figures depend on. `whole` is a ride of the whole stage (no workout split the trip). */
export interface FinishInput {
  stats: StatsLike;
  /** Distance and climbing within the window being saved. */
  totals: { distance: number; climbed: number };
  whole: boolean;
  /** The trip's own figures, used when `whole`. */
  ride: { movingTime: number; work: number; climbed: number; startDistance: number };
  /** Where the stage ends, in metres. */
  finish: number;
  imperial: boolean;
  /** Set when the rider finished a race (it replaces the time with the place, the race time and the points). */
  race: RaceFigures | null;
}

/** The finish card's figures: six lines, the race's place, time and points first when the rider raced. */
export function finishItems(i: FinishInput): SummaryItem[] {
  const { stats, totals, whole, ride, finish, imperial } = i;
  const { timeS, avgPower, climbedM } = finishFigures(i);
  const avgKmh = timeS > 0 ? ((whole ? finish - ride.startDistance : totals.distance) / timeS) * 3.6 : 0;
  const items: SummaryItem[] = [
    ['Time', formatTime(timeS)],
    ['Avg power', `${avgPower} W`],
    ['Avg speed', `${(imperial ? avgKmh / KM_PER_MI : avgKmh).toFixed(1)} ${imperial ? 'mph' : 'km/h'}`],
    ['Climbed', climbedText(climbedM, imperial)],
    ['Avg HR', heartRate(stats.avgHr)],
    ['Norm. power', `${Math.round(stats.np)} W`],
  ];
  const r = i.race;
  if (r) {
    items.splice(0, 1, ['Place', `${ordinal(r.place)} of ${r.of}`], ['Race time', raceTime(r.time)]);
    items.splice(2, 0, ['Points', `${r.sprint} sprint · ${r.kom} mountain`]);
    items.length = Math.min(items.length, 6);
  }
  return items;
}

/** The time, average power and climbing of the finish card, which the share picture shows too. */
export function finishFigures(i: Pick<FinishInput, 'stats' | 'totals' | 'whole' | 'ride'>) {
  const { stats, totals, whole, ride } = i;
  const timeS = whole ? ride.movingTime : stats.seconds;
  const avgPower = timeS > 0 ? Math.round(whole ? ride.work / ride.movingTime : stats.avgPower) : 0;
  const climbedM = whole ? ride.climbed : totals.climbed;
  return { timeS, avgPower, climbedM };
}

/** The finish card's two buttons for a ride that wasn't a race. */
export function finishActions(rideAgain: () => void): SummaryAction[] {
  return [
    { label: 'Keep riding', onClick: () => {} },
    { label: 'Ride it again', primary: true, onClick: rideAgain },
  ];
}

/** The finish card's title: the stage, and "finished!" or, after a race, the place. */
export function finishTitle(stageName: string, place: number | null) {
  return place === null ? `${stageName}: finished!` : `${stageName}: ${ordinal(place)}`;
}

/** The headline on the share picture: the place in a race, else a new personal best. */
export function shareHeadline(race: { place: number; of: number } | null, vsGhost: number | null, ghostIsMe: boolean) {
  if (race) return `${ordinal(race.place)} of ${race.of}`;
  return vsGhost !== null && vsGhost < 0 && ghostIsMe ? 'New personal best' : undefined;
}

/**
 * The line under the figures when the rider had a ghost to race, and the title that replaces the card's when they beat their own
 * best. `vsGhost` is the rider's time minus the ghost's, in seconds (negative: faster).
 */
export function ghostComparison(stageName: string, vsGhost: number, ghost: { name: string; isMe: boolean }) {
  const who = ghost.isMe ? 'your best' : `${ghost.name}’s ghost`;
  return {
    title: vsGhost < 0 && ghost.isMe ? `${stageName}: new personal best!` : null,
    note: vsGhost < 0 ? `🏆 ${raceTime(-vsGhost)} faster than ${who}` : `${raceTime(vsGhost)} behind ${who}`,
  };
}
