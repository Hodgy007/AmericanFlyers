// The home page: a welcome screen over the 3D world for riders who aren't
// signed in, with free sign-in (Google, or email and password) or "ride
// without an account".

import { account, onAccountChange, signInWith } from './cloud/account';
import { mountEmailAuth, type RiderDetails } from './cloud/emailAuth';

const HINT_KEY = 'americanflyers.signedIn'; // remembered so signed-in riders skip the home page

function hint(on?: boolean) {
  try {
    if (on === undefined) return localStorage.getItem(HINT_KEY) === '1';
    if (on) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // storage blocked: the home page just shows a little more often
  }
  return false;
}

export function initHome(opts: { onEnterApp?: () => void; onRiderDetails: (d: RiderDetails) => void; defaults: () => { riderKg: number } }) {
  const home = document.getElementById('home')!;
  const error = document.getElementById('home-error')!;
  addHeroVideo(home);
  if (document.documentElement.dataset.hero === 'dog') home.querySelector('.home-bg')!.setAttribute('aria-label', 'A cyclist sprinting along a desert highway at sunset, chased by a pit bull');

  const show = () => {
    home.hidden = false;
    document.body.classList.add('at-home');
    home.querySelector<HTMLVideoElement>('video')?.play().catch(() => {});
  };
  let entered = false;
  const hide = () => {
    if (!entered) { entered = true; opts.onEnterApp?.(); }
    home.hidden = true;
    document.body.classList.remove('at-home');
    home.querySelector<HTMLVideoElement>('video')?.pause();
  };

  // Riders who were signed in last time go straight to the bike; everyone
  // else starts here. Sign-in state settles a moment later and corrects this.
  if (hint()) hide();
  else show();

  onAccountChange((a) => {
    hint(!!a);
    if (a) hide();
    else show();
  });

  for (const b of home.querySelectorAll<HTMLButtonElement>('[data-provider]')) {
    b.addEventListener('click', async () => {
      error.textContent = '';
      b.disabled = true;
      try {
        await signInWith('google'); // leaves the page for Google
      } catch (e) {
        error.textContent = (e as Error)?.message ?? String(e);
      } finally {
        b.disabled = false;
      }
    });
  }

  // Email sign-up opens in place of the button.
  const emailBox = document.getElementById('home-email')!;
  const emailToggle = document.getElementById('home-email-toggle')!;
  mountEmailAuth(emailBox, { onDetails: opts.onRiderDetails, defaults: opts.defaults });
  emailToggle.addEventListener('click', () => {
    emailToggle.hidden = true;
    emailBox.hidden = false;
    emailBox.querySelector<HTMLInputElement>('input[name=name]')?.focus();
  });

  document.getElementById('home-ride')!.addEventListener('click', hide);
  document.getElementById('btn-home')!.addEventListener('click', () => {
    if (!account()) show();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !home.hidden && !document.querySelector('dialog[open]')) hide();
  });

  return { show, hide };
}

/**
 * The looping hero clip, over the still image. Skipped for riders who prefer
 * reduced motion or have data saver on; the still image stays either way.
 */
function addHeroVideo(home: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (reduced || saveData) return;
  const video = document.createElement('video');
  video.className = 'home-video';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  // Matches the hero picked for this visit in index.html (the rider, or the pit bull chase).
  const base = document.documentElement.dataset.hero === 'dog' ? '/images/hero-dog' : '/images/hero';
  video.src = matchMedia('(max-width: 768px)').matches ? `${base}-480.mp4` : `${base}.mp4`;
  video.addEventListener('playing', () => video.classList.add('ready'), { once: true });
  home.querySelector('.home-bg')!.after(video);
  if (!home.hidden) video.play().catch(() => {});
}
