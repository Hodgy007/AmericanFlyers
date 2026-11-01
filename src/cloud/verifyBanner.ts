// A gentle note at the top of the profile for riders whose email address isn't
// verified yet: "Verify now" emails a 6-digit code and shows the code box in place.
// Google accounts come back already verified, so they never see it.

import { account, markEmailVerified, restoreSession } from './account';
import { mountCodeEntry } from './codeEntry';
import { sendVerificationCode } from './verification';

export function mountVerifyBanner(el: HTMLElement, toast: (msg: string, ms?: number) => void) {
  let code: ReturnType<typeof mountCodeEntry> | null = null;

  function refresh() {
    const a = account();
    code?.destroy();
    code = null;
    el.replaceChildren();
    el.hidden = !a || a.emailVerified !== false;
    if (el.hidden || !a) return;

    const text = document.createElement('p');
    text.innerHTML = '<strong>Verify your email address.</strong> It keeps your account safe and lets us reach you if you forget your password.';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'primary';
    go.textContent = 'Email me a code';
    const msg = document.createElement('p');
    msg.className = 'error';
    msg.setAttribute('role', 'alert');
    el.append(text, go, msg);

    go.addEventListener('click', async () => {
      go.disabled = true;
      msg.textContent = '';
      try {
        await sendVerificationCode(a.email);
        go.hidden = true;
        code = mountCodeEntry(el, {
          email: a.email,
          onVerified: async () => {
            await restoreSession();
            markEmailVerified(a.email); // the session may be cached from before the code
            refresh();
            toast('Email verified. Thank you!', 5000);
          },
        });
        code.focus();
      } catch (e) {
        msg.textContent = (e as Error).message;
        go.disabled = false;
      }
    });
  }

  return { refresh };
}
