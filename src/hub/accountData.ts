// Loads the rider's rides and FTP history and turns them into the hub's Summary. Kept apart from
// hub.ts so the hub itself stays small; it is only imported when there is an account to ask.

import { ftpHistory, listActivities } from '../cloud/sync';
import { buildSummary, type Summary } from './data';

/** Fetches rides and FTP history together. (The hub ignores all but the newest answer.) */
export async function loadSummary(riderKg: number, ftpNow: number): Promise<Summary> {
  const [acts, ftp] = await Promise.all([listActivities(), ftpHistory()]);
  return buildSummary({ acts, ftp, riderKg, ftpNow });
}
