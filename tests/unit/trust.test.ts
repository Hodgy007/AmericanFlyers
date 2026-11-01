import { describe, expect, it } from 'vitest';
import { leaderboardEligible, leaderboardNote } from '../../src/rideIntegrity';
import { isCompleteCode, isNotVerifiedError, normaliseCode, resendSecondsLeft, signUpNeedsCode, explainVerifyError } from '../../src/cloud/verification';
import { DELETE_PHRASE, confirmsDeletion, dataFileName, tidyDataExport } from '../../src/cloud/privacy';

describe('leaderboard eligibility', () => {
  it('counts normal rides only', () => {
    expect(leaderboardEligible({ usedDemo: false, timeScale: 1 })).toBe(true);
    expect(leaderboardEligible({ usedDemo: true, timeScale: 1 })).toBe(false);
    expect(leaderboardEligible({ usedDemo: false, timeScale: 8 })).toBe(false);
  });
  it('explains why a ride does not count', () => {
    expect(leaderboardNote({ usedDemo: false, timeScale: 1 })).toBeNull();
    expect(leaderboardNote({ usedDemo: true, timeScale: 1 })).toMatch(/demo/i);
    expect(leaderboardNote({ usedDemo: false, timeScale: 4 })).toMatch(/sped-up/i);
  });
});

describe('verification codes', () => {
  it('keeps the first six digits only', () => {
    expect(normaliseCode('123 456')).toBe('123456');
    expect(normaliseCode('12-34-56-78')).toBe('123456');
    expect(normaliseCode('ab12')).toBe('12');
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
  });
  it('counts down the resend timer', () => {
    expect(resendSecondsLeft(0, 0)).toBe(30);
    expect(resendSecondsLeft(0, 12_300)).toBe(18);
    expect(resendSecondsLeft(0, 30_000)).toBe(0);
    expect(resendSecondsLeft(0, 90_000)).toBe(0);
  });
  it('asks for a code only when the server held the session back', () => {
    expect(signUpNeedsCode({ user: { emailVerified: false }, token: null })).toBe(true);
    expect(signUpNeedsCode({ user: { emailVerified: false }, token: 'abc' })).toBe(false); // verification off, or optional
    expect(signUpNeedsCode({ user: { emailVerified: true }, token: null })).toBe(false);
    expect(signUpNeedsCode(null)).toBe(false);
  });
  it('recognises the not-verified sign-in error', () => {
    expect(isNotVerifiedError({ code: 'EMAIL_NOT_VERIFIED' })).toBe(true);
    expect(isNotVerifiedError({ status: 403, message: 'Email not verified' })).toBe(true);
    expect(isNotVerifiedError({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(false);
    expect(isNotVerifiedError(null)).toBe(false);
  });
  it('words code errors plainly', () => {
    expect(explainVerifyError({ code: 'TOO_MANY_ATTEMPTS' })).toMatch(/new code/i);
    expect(explainVerifyError({ code: 'OTP_EXPIRED' })).toMatch(/expired/i);
    expect(explainVerifyError({ code: 'INVALID_OTP' })).toMatch(/isn’t right/);
  });
});

describe('account deletion and data export', () => {
  it('needs the exact phrase typed', () => {
    expect(DELETE_PHRASE).toBe('DELETE');
    expect(confirmsDeletion('DELETE')).toBe(true);
    expect(confirmsDeletion('  delete ')).toBe(true);
    expect(confirmsDeletion('DELET')).toBe(false);
    expect(confirmsDeletion('')).toBe(false);
  });
  it('names the export file by date', () => {
    expect(dataFileName(new Date('2026-11-01T10:00:00Z'))).toBe('american-flyers-my-data-2026-11-01.json');
  });
  it('puts the export together and leaves out user ids', () => {
    const out = tidyDataExport({
      account: { id: 'u1', email: 'a@b.c' },
      profile: { user_id: 'u1', settings: { ftp: 200 } },
      workouts: [{ id: 'w', user_id: 'u1', data: {} }],
      extras: { ride_ons_sent: [{ emote: '👍' }], other_tables: { purchases: [{ user_id: 'u1', item: 'x' }] } },
      now: new Date('2026-11-01T10:00:00Z'),
    });
    expect(out.exported_at).toBe('2026-11-01T10:00:00.000Z');
    expect(JSON.stringify(out)).not.toContain('user_id');
    expect((out.workouts as unknown[]).length).toBe(1);
    expect(out.ride_ons_sent).toEqual([{ emote: '👍' }]);
    expect((out.other_tables as Record<string, unknown[]>).purchases).toEqual([{ item: 'x' }]);
  });
});
