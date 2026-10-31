// The home page: a welcome screen over the 3D world for riders who aren't
// signed in, with free sign-in (Google / Apple) or "ride without an account".

import { account, onAccountChange, signInWith } from './cloud/account';

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

export function initHome(opts: { onEnterApp?: () => void } = {}) {
  const home = document.getElementById('home')!;
  const error = document.getElementById('home-error')!;
  addHeroVideo(home);

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
      const provider = b.dataset.provider as 'google' | 'apple';
      b.disabled = true;
      try {
        await signInWith(provider); // leaves the page for Google / Apple
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        error.textContent = provider === 'apple' && /provider|not.*(found|enabled|configured)/i.test(msg)
          ? 'Sign in with Apple isn’t switched on yet. Please use Google for now.'
          : msg;
      } finally {
        b.disabled = false;
      }
    });
  }

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
  video.src = matchMedia('(max-width: 768px)').matches ? '/images/hero-480.mp4' : '/images/hero.mp4';
  video.addEventListener('playing', () => video.classList.add('ready'), { once: true });
  home.querySelector('.home-bg')!.after(video);
  if (!home.hidden) video.play().catch(() => {});
}
