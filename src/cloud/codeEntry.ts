// The "enter your 6-digit code" box: used in the email sign-up/sign-in form and
// in the profile banner for riders whose email isn't verified yet. It has a
// resend button with a countdown, and tells the rider plainly when a code is wrong.

import { isCompleteCode, normaliseCode, resendSecondsLeft, sendVerificationCode, verifyEmailCode } from './verification';

interface Options {
  email: string;
  /** Called after the server accepted the code. */
  onVerified: () => void | Promise<void>;
  /** Replaces the default "email a new code" call (tests, or a flow that sends its own). */
  send?: (email: string) => Promise<void>;
  verify?: (email: string, code: string) => Promise<void>;
  /** True if a code was emailed just before this box opened (starts the resend timer). */
  justSent?: boolean;
}

export function mountCodeEntry(container: HTMLElement, o: Options) {
  const send = o.send ?? sendVerificationCode;
  const verify = o.verify ?? verifyEmailCode;
  const wrap = document.createElement('div');
  wrap.className = 'code-entry';
  wrap.innerHTML = `
    <p class="code-intro"></p>
    <label>6-digit code
      <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="9" placeholder="123456" aria-label="6-digit code" />
    </label>
    <p class="error code-error" role="alert"></p>
    <p class="ea-ok code-ok" role="status"></p>
    <button type="button" class="primary code-verify">Verify</button>
    <div class="ea-links"><button type="button" class="link code-resend"></button></div>`;
  container.append(wrap);
  wrap.querySelector<HTMLElement>('.code-intro')!.textContent = `We’ve emailed a 6-digit code to ${o.email}. It works for 15 minutes. Check your spam folder if it doesn’t show up.`;

  const input = wrap.querySelector<HTMLInputElement>('.code-input')!;
  const error = wrap.querySelector<HTMLElement>('.code-error')!;
  const ok = wrap.querySelector<HTMLElement>('.code-ok')!;
  const verifyBtn = wrap.querySelector<HTMLButtonElement>('.code-verify')!;
  const resend = wrap.querySelector<HTMLButtonElement>('.code-resend')!;

  let sentAt = Date.now(); // the code that brought us here counts as just sent
  if (o.justSent === false) sentAt = 0;
  let busy = false;
  const timer = window.setInterval(tick, 500);

  function tick() {
    if (!wrap.isConnected) { window.clearInterval(timer); return; }
    const left = resendSecondsLeft(sentAt, Date.now());
    resend.disabled = busy || left > 0;
    resend.textContent = left > 0 ? `Send a new code (${left}s)` : 'Send a new code';
  }

  async function submit() {
    if (busy) return;
    error.textContent = '';
    ok.textContent = '';
    if (!isCompleteCode(input.value)) { error.textContent = `Type the 6-digit code from the email.`; return; }
    busy = true;
    verifyBtn.disabled = true;
    try {
      await verify(o.email, input.value);
      await o.onVerified();
    } catch (e) {
      error.textContent = (e as Error).message;
    } finally {
      busy = false;
      verifyBtn.disabled = false;
      tick();
    }
  }

  input.addEventListener('input', () => {
    const digits = normaliseCode(input.value);
    if (input.value !== digits) input.value = digits;
    error.textContent = '';
    if (digits.length === 6) void submit(); // paste or type the last digit: go
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void submit(); }
  });
  verifyBtn.addEventListener('click', () => void submit());
  resend.addEventListener('click', async () => {
    if (busy) return;
    error.textContent = '';
    busy = true;
    tick();
    try {
      await send(o.email);
      sentAt = Date.now();
      ok.textContent = 'A new code is on its way. Only the newest one works.';
    } catch (e) {
      error.textContent = (e as Error).message;
    } finally {
      busy = false;
      tick();
    }
  });

  tick();
  return {
    focus: () => input.focus(),
    /** Marks that a code has just been sent (restarts the resend countdown). */
    sent: () => { sentAt = Date.now(); tick(); },
    destroy: () => { window.clearInterval(timer); wrap.remove(); },
  };
}
