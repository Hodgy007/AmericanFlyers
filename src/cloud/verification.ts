// Email verification with a 6-digit code (Neon Auth "Verification code" method).
// Pure helpers live here so they can be unit-tested; the SDK calls are at the bottom.
//
// The flow works whether verification is switched on in Neon Auth or not:
//  - off: sign-up returns a session and nothing asks for a code (no step is shown);
//  - on + "require": sign-up returns the user but no session, so the code step
//    appears; an unverified account that tries to sign in is told 403
//    EMAIL_NOT_VERIFIED, which also opens the code step.
// See docs/admin-guide/authentication-setup.md for the exact settings.

import { neon } from './client';

export const CODE_LENGTH = 6;
/** Seconds before "Resend code" can be used again. */
export const RESEND_SECONDS = 30;

/** Keeps only the digits of what was typed or pasted ("123 456" -> "123456"). */
export function normaliseCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export const isCompleteCode = (input: string) => normaliseCode(input).length === CODE_LENGTH;

/** Whole seconds left before the next resend is allowed (0 = allowed now). */
export function resendSecondsLeft(sentAt: number, now: number, cooldown = RESEND_SECONDS): number {
  return Math.max(0, Math.ceil(cooldown - (now - sentAt) / 1000));
}

type AuthErr = { message?: string; code?: string; status?: number } | null | undefined;

/** True when the server refused a sign-in because the email isn't verified yet. */
export function isNotVerifiedError(err: AuthErr): boolean {
  if (!err) return false;
  return /EMAIL_NOT_VERIFIED/i.test(err.code ?? '') || (err.status === 403 && /verif/i.test(err.message ?? ''));
}

interface SignUpData {
  user?: { emailVerified?: boolean } | null;
  token?: string | null;
}

/**
 * After sign-up: does the rider need to type a code now? Yes when the account
 * exists, isn't verified, and the server did not start a session (verification
 * is required). With verification off the sign-up comes back with a session.
 */
export function signUpNeedsCode(data: SignUpData | null | undefined): boolean {
  return !!data?.user && data.user.emailVerified === false && !data.token;
}

/** Plain-English messages for the errors a rider can hit while verifying. */
export function explainVerifyError(err: AuthErr): string {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  if (/TOO_MANY_ATTEMPTS/i.test(text)) return 'Too many wrong codes. Ask for a new code.';
  if (/OTP_EXPIRED|expired/i.test(text)) return 'That code has expired. Ask for a new one.';
  if (/INVALID_OTP|invalid/i.test(text)) return 'That code isn’t right. Check the latest email and try again.';
  if (err?.status === 429) return 'Too many tries. Wait a minute and try again.';
  return err?.message || 'Couldn’t check that code. Try again.';
}

// The SDK has these methods at run time (see the Neon docs, "Email OTP"), but its
// bundled types don't list them yet, so describe the two we use here.
interface EmailOtpApi {
  emailOtp: {
    sendVerificationOtp(a: { email: string; type: 'email-verification' }): Promise<{ error?: AuthErr }>;
    verifyEmail(a: { email: string; otp: string }): Promise<{ error?: AuthErr }>;
  };
}
const otp = () => (neon.auth as unknown as EmailOtpApi).emailOtp;

async function call(fn: () => Promise<{ error?: AuthErr }>): Promise<AuthErr> {
  try {
    return (await fn())?.error ?? null;
  } catch (e) {
    const err = e as { message?: string; code?: string; status?: number; error?: AuthErr };
    return err.error ?? { message: err.message, code: err.code, status: err.status };
  }
}

/** Emails a fresh 6-digit code (the old one stops working). */
export async function sendVerificationCode(email: string) {
  const error = await call(() => otp().sendVerificationOtp({ email, type: 'email-verification' }));
  if (error) throw new Error(error.status === 429 ? 'Too many tries. Wait a minute and try again.' : error.message || 'Couldn’t send a code.');
}

/** Checks the code. Throws a friendly error when it's wrong or expired. */
export async function verifyEmailCode(email: string, code: string) {
  const error = await call(() => otp().verifyEmail({ email, otp: normaliseCode(code) }));
  if (error) throw new Error(explainVerifyError(error));
}
