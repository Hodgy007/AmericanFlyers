// Email sign-in: a small form with three modes. "Create account" asks only
// for basic rider details (name, email, password, weight, and FTP if known);
// never a phone number or address. "Sign in" and "Forgot password" do what
// they say. Used in the sign-in dialog and on the home page.

import { requestPasswordReset, signInWithEmail, signUpWithEmail } from './account';

export interface RiderDetails {
  riderKg: number;
  ftp: number | null;
}

interface Options {
  /** Called with the rider's details just before the account is created. */
  onDetails: (d: RiderDetails) => void;
  defaults: () => { riderKg: number };
}

type Mode = 'signup' | 'signin' | 'forgot';

let seq = 0;

export function mountEmailAuth(container: HTMLElement, o: Options) {
  const id = (name: string) => `ea${seq}-${name}`;
  seq++;
  let mode: Mode = 'signup';

  const form = document.createElement('form');
  form.className = 'email-auth';
  form.noValidate = false;
  form.innerHTML = `
    <div class="ea-tabs" role="tablist">
      <button type="button" role="tab" data-mode="signup">Create account</button>
      <button type="button" role="tab" data-mode="signin">Sign in</button>
    </div>
    <p class="ea-title" data-show="forgot">Reset your password</p>
    <label data-show="signup">Rider name
      <input name="name" autocomplete="nickname" maxlength="40" minlength="2" placeholder="Shown to other riders as first name + initial" />
    </label>
    <label>Email
      <input name="email" type="email" autocomplete="email" maxlength="120" />
    </label>
    <label data-show="signup signin">Password
      <input name="password" type="password" minlength="8" maxlength="128" />
    </label>
    <div class="ea-row" data-show="signup">
      <label>Weight (kg)
        <input name="weight" type="number" min="30" max="200" step="0.5" inputmode="decimal" />
      </label>
      <label>FTP (W) <span class="ea-optional">optional</span>
        <input name="ftp" type="number" min="50" max="600" step="1" inputmode="numeric" placeholder="Don’t know" />
      </label>
    </div>
    <p class="ea-note" data-show="signup">We only ask what the ride needs. No phone number, no address.</p>
    <p class="ea-note" data-show="forgot">We’ll email you a link to set a new password. It works for 15 minutes.</p>
    <p class="error ea-error" role="alert"></p>
    <p class="ea-ok" role="status"></p>
    <button type="submit" class="primary ea-submit"></button>
    <div class="ea-links">
      <button type="button" class="link" data-go="forgot" data-show="signin">Forgot password?</button>
      <button type="button" class="link" data-go="signin" data-show="forgot">← Back to sign in</button>
    </div>`;
  container.append(form);

  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const error = form.querySelector<HTMLElement>('.ea-error')!;
  const ok = form.querySelector<HTMLElement>('.ea-ok')!;
  const submit = form.querySelector<HTMLButtonElement>('.ea-submit')!;

  // Unique ids so the two copies of the form (dialog and home page) don't clash.
  for (const input of form.querySelectorAll('input')) input.id = id(input.name);

  function setMode(m: Mode) {
    mode = m;
    form.dataset.mode = m;
    for (const el of form.querySelectorAll<HTMLElement>('[data-show]')) el.hidden = !el.dataset.show!.split(' ').includes(m);
    for (const t of form.querySelectorAll<HTMLButtonElement>('[data-mode]')) t.setAttribute('aria-selected', String(t.dataset.mode === m));
    form.querySelector<HTMLElement>('.ea-tabs')!.hidden = m === 'forgot';
    submit.textContent = { signup: 'Create free account', signin: 'Sign in', forgot: 'Email me a reset link' }[m];
    field('name').required = m === 'signup';
    field('weight').required = m === 'signup';
    field('password').required = m !== 'forgot';
    field('password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    field('email').required = true;
    error.textContent = '';
    ok.textContent = '';
  }

  form.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));
  form.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.go as Mode)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation(); // don't close a surrounding <dialog>
    error.textContent = '';
    ok.textContent = '';
    if (!form.reportValidity()) return;
    const email = field('email').value.trim();
    const password = field('password').value;
    submit.disabled = true;
    try {
      if (mode === 'signup') {
        const name = field('name').value.trim().replace(/\s+/g, ' ');
        const kg = Number(field('weight').value);
        const ftp = Number(field('ftp').value);
        o.onDetails({ riderKg: kg, ftp: ftp >= 50 && ftp <= 600 ? Math.round(ftp) : null });
        await signUpWithEmail(name, email, password);
      } else if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await requestPasswordReset(email);
        ok.textContent = `If there’s an account for ${email}, a reset link is on its way. Check your inbox (and spam).`;
      }
    } catch (err) {
      error.textContent = (err as Error).message;
    } finally {
      submit.disabled = false;
    }
  });

  setMode('signup');
  field('weight').value = String(o.defaults().riderKg);

  return {
    setMode,
    reset() {
      form.reset();
      field('weight').value = String(o.defaults().riderKg);
      setMode(mode === 'forgot' ? 'signin' : mode);
    },
  };
}
