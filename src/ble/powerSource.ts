// Where the ride's watts and cadence come from when a separate power meter may be connected beside the trainer.
// Pure rules (unit-tested in tests/unit/powerSource.test.ts); devicesUi.ts feeds them the clock and the readings.

import type { ControlState, TrainerReading } from './trainer';

/** A meter counts as sending while its last reading is no older than this (ms). */
export const METER_FRESH_MS = 3000;

export type PowerSource = 'meter' | 'trainer' | 'none';

export interface SourceInput {
  now: number;
  /** When the meter last sent a reading; null when no meter is connected. */
  meterAt: number | null;
  /** When the trainer last sent a reading; null when no trainer is connected. */
  trainerAt: number | null;
}

/**
 * Which device drives power: a connected meter that sent something in the last 3 s wins; otherwise the
 * connected trainer (even if it is quiet too: its own staleness rule zeroes the numbers); otherwise nothing.
 */
export function pickPowerSource(i: SourceInput): PowerSource {
  if (i.meterAt !== null && i.now - i.meterAt <= METER_FRESH_MS) return 'meter';
  if (i.trainerAt !== null) return 'trainer';
  return 'none';
}

/**
 * A trainer reading with what the meter already covers taken out: while the meter is the source the trainer's
 * power is ignored (its heart-rate relay stays), and so is its cadence unless the meter doesn't report cadence.
 */
export function trainerReadingFor(source: PowerSource, r: TrainerReading, meterHasCadence: boolean): TrainerReading {
  if (source !== 'meter') return r;
  const out: TrainerReading = {};
  if (r.heartRate !== undefined) out.heartRate = r.heartRate;
  if (r.speedKmh !== undefined) out.speedKmh = r.speedKmh;
  if (!meterHasCadence && r.cadence !== undefined) out.cadence = r.cadence;
  return out;
}

export interface StatusInput {
  trainerName: string | null;
  canControl: boolean;
  controlState: ControlState;
  meterName: string | null;
  source: PowerSource;
  /** True while a workout's power target is on. */
  erg: boolean;
}

/** The line under the data blocks: what the trainer is doing, and where the power comes from. */
export function trainerStatusText(i: StatusInput): string {
  const power = i.meterName && i.source === 'meter' ? ` · power from ${i.meterName}` : '';
  if (!i.trainerName) return i.meterName ? `No trainer · power from ${i.meterName}${i.source === 'meter' ? '' : ' (waiting for it)'}` : 'No trainer connected';
  let what: string;
  if (!i.canControl) what = 'power only (no resistance control)';
  else if (i.controlState === 'lost') what = i.erg ? 'not holding the target power (another app may be in control)' : 'not taking resistance commands';
  else what = 'resistance follows the road';
  return `${i.trainerName} · ${what}${power}`;
}

/** The toast for a change of control state (see Trainer.controlState). */
export function controlToast(state: ControlState, trainerName: string, erg: boolean): string | null {
  if (state === 'lost') {
    return erg
      ? `${trainerName} is no longer holding the workout target: close other apps that may be controlling it (Zwift, the Wahoo app). Power and cadence still work.`
      : `${trainerName} stopped taking resistance commands: close other apps that may be controlling it (Zwift, the Wahoo app). Power and cadence still work.`;
  }
  if (state === 'ok') return `${trainerName} is taking resistance commands again.`;
  return null;
}
