// The signed-in rider (if any). Sign-in is Google or Apple only.

import { neon } from './client';

export interface Account {
  id: string;
  name: string;
  email: string;
  image?: string | null;
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

/** Loads the session (including right after returning from Google / Apple). */
export async function restoreSession() {
  try {
    const { data } = await neon.auth.getSession();
    const u = data?.user;
    set(u ? { id: u.id, name: u.name || u.email, email: u.email, image: u.image } : null);
  } catch {
    set(null);
  }
  return current;
}

export async function signInWith(provider: 'google' | 'apple') {
  const here = `${location.origin}${location.pathname}${location.search}`;
  const { error } = await neon.auth.signIn.social({ provider, callbackURL: here, errorCallbackURL: here });
  if (error) throw new Error(error.message || `Couldn't start ${provider} sign-in`);
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
