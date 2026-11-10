// Which rides may appear on leaderboards. A ride that used the demo power
// slider, or ran on a sped-up clock (?timescale), is kept in the rider's own
// history but never gets a leaderboard time. The database applies the same
// rule again (activities.demo, see db/schema.sql), so this is a courtesy to the
// rider: the finish card says why, and nothing fake is sent.

export interface RideFlags {
  /** The demo slider supplied power at any point in this ride. */
  usedDemo: boolean;
  /** The clock multiplier from `?timescale=` (1 = normal). */
  timeScale: number;
  /**
   * A workout was ridden on this trip, so it was saved in pieces (the part before, the workout, the part after):
   * no piece holds the whole stage from the start line, so none can give a whole-stage time or a ghost.
   */
  splitByWorkout?: boolean;
}

/** Ridden on the demo slider or a sped-up clock: saved with `demo` set, so the database ignores it for every leaderboard. */
export function isDemoRide(f: RideFlags): boolean {
  return f.usedDemo || f.timeScale !== 1;
}

/** May this ride get a whole-stage leaderboard time (and be a ghost)? */
export function leaderboardEligible(f: RideFlags): boolean {
  return !isDemoRide(f) && !f.splitByWorkout;
}

/** The note for the finish card, or null when the ride counts. */
export function leaderboardNote(f: RideFlags): string | null {
  if (leaderboardEligible(f)) return null;
  if (f.usedDemo) return 'Demo rides don’t count for the leaderboards. Ride with a trainer to set a time.';
  if (f.timeScale !== 1) return 'This ride ran on a sped-up clock, so it doesn’t count for the leaderboards.';
  return 'This ride included a workout, so it doesn’t count for the stage leaderboard.';
}
