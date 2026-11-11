import { describe, expect, it } from 'vitest';
import { METER_FRESH_MS, controlToast, pickPowerSource, trainerReadingFor, trainerStatusText } from '../../src/ble/powerSource';

describe('pickPowerSource', () => {
  it('prefers a meter that sent something in the last 3 s', () => {
    expect(pickPowerSource({ now: 10000, meterAt: 10000 - METER_FRESH_MS, trainerAt: 9900 })).toBe('meter');
    expect(pickPowerSource({ now: 10000, meterAt: 9990, trainerAt: null })).toBe('meter');
  });

  it('falls back to the trainer when the meter is stale', () => {
    expect(pickPowerSource({ now: 10000, meterAt: 10000 - METER_FRESH_MS - 1, trainerAt: 9900 })).toBe('trainer');
  });

  it('uses the trainer when no meter is connected', () => {
    expect(pickPowerSource({ now: 10000, meterAt: null, trainerAt: 9900 })).toBe('trainer');
  });

  it('is nothing when there is no trainer and the meter is stale or absent', () => {
    expect(pickPowerSource({ now: 10000, meterAt: 1000, trainerAt: null })).toBe('none');
    expect(pickPowerSource({ now: 10000, meterAt: null, trainerAt: null })).toBe('none');
  });
});

describe('trainerReadingFor', () => {
  const r = { power: 250, cadence: 90, heartRate: 140, speedKmh: 30 };
  it('passes everything through unless the meter is the source', () => {
    expect(trainerReadingFor('trainer', r, true)).toEqual(r);
    expect(trainerReadingFor('none', r, true)).toEqual(r);
  });
  it('drops the trainer power and cadence but keeps its heart-rate relay', () => {
    expect(trainerReadingFor('meter', r, true)).toEqual({ heartRate: 140, speedKmh: 30 });
  });
  it('keeps the trainer cadence when the meter sends none', () => {
    expect(trainerReadingFor('meter', r, false)).toEqual({ heartRate: 140, speedKmh: 30, cadence: 90 });
  });
});

describe('trainerStatusText', () => {
  const base = { trainerName: 'KICKR CORE', canControl: true, controlState: 'ok' as const, meterName: null, source: 'trainer' as const, erg: false };
  it('names the meter when it is the source', () => {
    expect(trainerStatusText({ ...base, meterName: 'Assioma', source: 'meter' })).toBe('KICKR CORE · resistance follows the road · power from Assioma');
  });
  it('keeps the old wording with no meter', () => {
    expect(trainerStatusText(base)).toBe('KICKR CORE · resistance follows the road');
    expect(trainerStatusText({ ...base, canControl: false })).toBe('KICKR CORE · power only (no resistance control)');
  });
  it('says so when the trainer stopped taking commands, with ERG wording in a workout', () => {
    expect(trainerStatusText({ ...base, controlState: 'lost' })).toContain('not taking resistance commands');
    expect(trainerStatusText({ ...base, controlState: 'lost', erg: true })).toContain('not holding the target power');
  });
  it('handles a meter with no trainer', () => {
    expect(trainerStatusText({ ...base, trainerName: null, meterName: 'Assioma', source: 'meter' })).toBe('No trainer · power from Assioma');
    expect(trainerStatusText({ ...base, trainerName: null })).toBe('No trainer connected');
  });
});

describe('controlToast', () => {
  it('words the loss for riding and for a workout, and the return', () => {
    expect(controlToast('lost', 'KICKR', false)).toBe('KICKR stopped taking resistance commands: close other apps that may be controlling it (Zwift, the Wahoo app). Power and cadence still work.');
    expect(controlToast('lost', 'KICKR', true)).toContain('no longer holding the workout target');
    expect(controlToast('ok', 'KICKR', false)).toContain('taking resistance commands again');
    expect(controlToast('unavailable', 'KICKR', false)).toBeNull();
  });
});
