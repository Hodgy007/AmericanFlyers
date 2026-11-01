// The signed-in rider (if any). Riders sign in with Google, or with an
// email address and password.

import { neon } from './client';
import { isNotVerifiedError, signUpNeedsCode } from './verification';

export interface Account {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  /** False for an email account that hasn't entered its 6-digit code yet. */
  emailVerified?: boolean;
}

type Listener = (account: Account | null) => void;

let current: Account | null = null;
const listeners = new Set<Listener>();

export function account() {
  return current;
}

export function onAccountChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: Account | null) {
  const changed = next?.id !== current?.id;
  current = next;
  if (changed) listeners.forEach((fn) => fn(current));
}

/** Loads the session (including right after returning from Google). */
export async function restoreSession() {
  try {
    const { data } = await neon.auth.getSession();
    const u = data?.user;
    set(u ? { id: u.id, name: u.name || u.email, email: u.email, image: u.image, emailVerified: u.emailVerified !== false } : null);
  } catch {
    set(null);
  }
  return current;
}

export async function signInWith(provider: 'google') {
  const here = `${location.origin}${location.pathname}${location.search}`;
  const { error } = await neon.auth.signIn.social({ provider, callbackURL: here, errorCallbackURL: here });
  if (error) throw new Error(error.message || `Couldn't start ${provider} sign-in`);
}

type AuthError = { message?: string; code?: string; status?: number } | null | undefined;

/** Plain-English messages for the email sign-in errors riders are likely to hit. */
function explain(error: AuthError, fallback: string) {
  const code = error?.code ?? '';
  const msg = error?.message ?? '';
  if (/USER_ALREADY_EXISTS|already exists/i.test(code + msg)) return 'There’s already an account with this email. Sign in instead, or reset your password.';
  if (/INVALID_EMAIL_OR_PASSWORD|invalid (email|password)/i.test(code + msg)) return 'That email and password don’t match. Check them, or reset your password.';
  if (/PASSWORD_TOO_SHORT/i.test(code)) return 'Your password needs at least 8 characters.';
  if (/PASSWORD_TOO_LONG/i.test(code)) return 'That password is too long.';
  if (/INVALID_EMAIL/i.test(code)) return 'That doesn’t look like an email address.';
  if (/INVALID_TOKEN|expired/i.test(code + msg)) return 'This reset link has expired or was already used. Ask for a new one.';
  if (error?.status === 429) return 'Too many tries. Wait a minute and try again.';
  return msg || fallback;
}

/** Runs an auth call; errors come back as `{ error }` whether the SDK returns or throws them. */
async function attempt(call: () => Promise<{ error?: AuthError }>): Promise<{ error: AuthError }> {
  try {
    const res = await call();
    return { error: res?.error ?? null };
  } catch (e) {
    const err = e as { message?: string; code?: string; status?: number; error?: AuthError };
    return { error: err.error ?? { message: err.message, code: err.code, status: err.status } };
  }
}

/** Thrown when the account exists but its email address still needs the 6-digit code. */
export class NeedsVerificationError extends Error {
  constructor(readonly email: string) {
    super('Enter the 6-digit code we emailed you to finish.');
  }
}

/**
 * Creates an account with email and password. Resolves when the rider is
 * signed in; throws NeedsVerificationError when the server wants the emailed
 * code first (only when email verification is switched on in Neon Auth).
 */
export async function signUpWithEmail(name: string, email: string, password: string) {
  let data: unknown;
  const { error } = await attempt(async () => {
    const res = await neon.auth.signUp.email({ name, email, password });
    data = res?.data;
    return res;
  });
  if (error) throw new Error(explain(error, 'Couldn’t create your account.'));
  if (signUpNeedsCode(data as Parameters<typeof signUpNeedsCode>[0])) throw new NeedsVerificationError(email);
  return restoreSession();
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await attempt(() => neon.auth.signIn.email({ email, password }));
  if (isNotVerifiedError(error)) throw new NeedsVerificationError(email);
  if (error) throw new Error(explain(error, 'Couldn’t sign in.'));
  return restoreSession();
}

/** The server just accepted this account's code: show it as verified even if the SDK's cached session is stale. */
export function markEmailVerified(email: string) {
  if (current && current.email.toLowerCase() === email.toLowerCase()) current = { ...current, emailVerified: true };
}

/** After a correct code: pick up the session the server started, or sign in with the password just typed. */
export async function finishVerification(email: string, password?: string) {
  const a = await restoreSession();
  if (a || !password) return a;
  return signInWithEmail(email, password);
}

/** Emails a password reset link that comes back to this site with `?token=…`. */
export async function requestPasswordReset(email: string) {
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await attempt(() => neon.auth.requestPasswordReset({ email, redirectTo }));
  if (error) throw new Error(explain(error, 'Couldn’t send the reset email.'));
}

export async function resetPassword(token: string, newPassword: string) {
  const { error } = await attempt(() => neon.auth.resetPassword({ token, newPassword }));
  if (error) throw new Error(explain(error, 'Couldn’t set your new password.'));
}

export async function signOut() {
  await neon.auth.signOut();
  set(null);
}

export async function rename(name: string) {
  const { error } = await neon.auth.updateUser({ name });
  if (error) throw new Error(error.message);
  if (current) set({ ...current, name });
  listeners.forEach((fn) => fn(current));
}
