// The always-present part of the account UI: the 👤 button in the top bar (its
// name, and the admin button), and the three entry points that open the real
// dialogs. The dialogs themselves (sign-in, profile with its charts, feedback,
// the admin dashboard) are in ui.ts and load when one of these is used, or in a
// spare moment after the first frame.

import { lazy, use } from '../lazy';
import { account, onAccountChange } from './account';
import { isAdmin } from './sync';
import type { Deps } from './ui';

export function initAccountUi(deps: Deps) {
  const dialogs = lazy(() => import('./ui').then((m) => m.initAccountDialogs(deps)));
  const accountBtn = document.getElementById('btn-account') as HTMLButtonElement;
  const adminBtn = document.getElementById('btn-admin') as HTMLButtonElement;

  // Coming back from a failed Google sign-in, the address carries the error.
  const params = new URLSearchParams(location.search);
  if (params.has('error')) {
    deps.toast(`Sign-in didn’t finish: ${params.get('error_description') ?? params.get('error')}`, 7000);
    const url = new URL(location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    history.replaceState(null, '', url);
  }
  // A password-reset link (?token=…) needs its dialog straight away.
  if (params.has('token')) dialogs.prefetch();

  async function checkAdmin() {
    const id = account()?.id;
    const yes = id ? await isAdmin() : false;
    if (account()?.id !== id) return; // signed in/out meanwhile
    adminBtn.hidden = !yes;
  }

  function refreshAccountButton() {
    const a = account();
    accountBtn.textContent = a ? `👤 ${a.name.split(' ')[0]}` : '👤 Sign in';
    accountBtn.title = a ? `${a.name} (${a.email}): profile & stats` : 'Sign in or create a free account';
    checkAdmin();
  }
  onAccountChange(refreshAccountButton);
  refreshAccountButton();

  accountBtn.addEventListener('click', () => use(dialogs, (u) => (account() ? u.openProfile('stats') : u.openSignIn()), accountBtn));
  adminBtn.addEventListener('click', () => use(dialogs, (u) => u.openProfile('admin'), adminBtn));
  const feedbackBtn = document.getElementById('btn-feedback')!;
  feedbackBtn.addEventListener('click', () => use(dialogs, (u) => u.openFeedback(), feedbackBtn));

  return {
    /** Opens the sign-in dialog; `then` runs once the rider is signed in. */
    openSignIn: (reason?: string, then?: () => void) => { use(dialogs, (u) => u.openSignIn(reason, then)); },
    /** Forget cached rides so the profile reloads them (after a save). Nothing to do if it hasn't been opened. */
    invalidate: () => dialogs.peek()?.invalidate(),
    /** Re-asks whether this is an admin (after the session settles). */
    checkAdmin,
    prefetch: () => dialogs.prefetch(),
    dialogs,
  };
}
