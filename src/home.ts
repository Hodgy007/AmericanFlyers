// The home page: a welcome screen over the 3D world for riders who aren't
// signed in, with free sign-in (Google, or email and password) or "ride
// without an account".

import { account, onAccountChange, signInWith } from './cloud/account';
import type { RiderDetails } from './cloud/emailAuth';
import { firstFrame, lazy, use } from './lazy';

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

/** The email sign-up form's code, loaded on first use. */
export const emailAuth = lazy(() => import('./cloud/emailAuth'));

export function initHome(opts: { onEnterApp?: () => void; onRiderDetails: (d: RiderDetails) => void; defaults: () => { riderKg: number } }) {
  const home = document.getElementById('home')!;
  const error = document.getElementById('home-error')!;
  const hero = heroRotator(home);

  const show = () => {
    home.hidden = false;
    document.body.classList.add('at-home');
    hero.play();
  };
  let entered = false;
  const hide = () => {
    if (!entered) { entered = true; opts.onEnterApp?.(); }
    home.hidden = true;
    document.body.classList.remove('at-home');
    hero.pause();
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

  // Email sign-up opens in place of the button. The form's code loads on the first
  // tap (and in a spare moment before that: main.ts prefetches it), not with the page.
  const emailBox = document.getElementById('home-email')!;
  const emailToggle = document.getElementById('home-email-toggle')!;
  let emailMounted = false;
  emailToggle.addEventListener('click', () => {
    use(emailAuth, (m) => {
      if (!emailMounted) { emailMounted = true; m.mountEmailAuth(emailBox, { onDetails: opts.onRiderDetails, defaults: opts.defaults }); }
      emailToggle.hidden = true;
      emailBox.hidden = false;
      emailBox.querySelector<HTMLInputElement>('input[name=name]')?.focus();
    }, emailToggle);
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

type HeroId = 'dog' | 'rider';

const HEROES: Record<HeroId, { base: string; label: string }> = {
  dog: { base: '/images/hero-dog', label: 'A cyclist sprinting along a desert highway at sunset, chased by a pit bull' },
  rider: { base: '/images/hero', label: 'A cyclist sprinting along a desert highway at sunset' },
};
const ROTATE_MS = 10_000; // time on each hero before crossfading to the other

/**
 * The home page hero: a still image with its looping clip over it. Unless a
 * hero was pinned with ?hero=, it rotates between the pit bull chase and the
 * original rider, crossfading every ROTATE_MS while the home page is showing.
 * Riders who prefer reduced motion or have data saver on get the still image
 * only, and no rotation (index.html still alternates the hero per visit).
 */
function heroRotator(home: HTMLElement) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  const moving = !reduced && !saveData;
  const rotate = moving && document.documentElement.dataset.heroRotate === '1';
  const first: HeroId = document.documentElement.dataset.hero === 'rider' ? 'rider' : 'dog';
  const small = matchMedia('(max-width: 768px)').matches;

  interface Slide { id: HeroId; el: HTMLElement; video?: HTMLVideoElement }
  // The looping clips (up to a megabyte each) wait for the first frame of the world, so they
  // don't compete with the code and models for the connection. The still shows meanwhile.
  let videosReady = false;
  const makeVideo = (id: HeroId, slide: HTMLElement) => {
    const video = document.createElement('video');
    video.className = 'home-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    video.src = small ? `${HEROES[id].base}-480.mp4` : `${HEROES[id].base}.mp4`;
    video.addEventListener('playing', () => video.classList.add('ready'), { once: true });
    slide.append(video);
    return video;
  };
  const makeSlide = (id: HeroId, bg: HTMLElement): Slide => {
    const el = document.createElement('div');
    el.className = 'home-slide';
    bg.classList.add(`hero-${id}`);
    bg.setAttribute('aria-label', HEROES[id].label);
    el.append(bg);
    return { id, el, video: moving && videosReady ? makeVideo(id, el) : undefined };
  };

  // The still in the markup becomes the first slide.
  const bg = home.querySelector<HTMLElement>('.home-bg')!;
  const anchor = document.createComment('hero');
  bg.replaceWith(anchor);
  const slides: Slide[] = [makeSlide(first, bg)];
  anchor.replaceWith(slides[0].el);

  let current = 0;
  let playing = false;
  let timer = 0;

  if (moving) {
    firstFrame.then(() => {
      videosReady = true;
      for (const s of slides) s.video ??= makeVideo(s.id, s.el);
      if (playing) slides[current].video?.play().catch(() => {});
    });
  }

  // The second hero is only fetched once the first has been up a while.
  const addSecond = () => {
    if (slides.length > 1) return;
    const other: HeroId = first === 'dog' ? 'rider' : 'dog';
    const bg2 = document.createElement('div');
    bg2.className = 'home-bg';
    bg2.setAttribute('role', 'img');
    const s = makeSlide(other, bg2);
    s.el.classList.add('off');
    s.el.setAttribute('aria-hidden', 'true');
    slides[0].el.after(s.el);
    slides.push(s);
  };

  const next = () => {
    addSecond();
    const from = slides[current];
    current = (current + 1) % slides.length;
    const to = slides[current];
    if (to.video) { to.video.currentTime = 0; to.video.play().catch(() => {}); }
    to.el.classList.remove('off');
    to.el.removeAttribute('aria-hidden');
    from.el.classList.add('off');
    from.el.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => { if (slides[current] !== from) from.video?.pause(); }, 1400); // after the crossfade
  };

  const schedule = () => {
    window.clearTimeout(timer);
    if (!rotate || !playing) return;
    timer = window.setTimeout(() => { next(); schedule(); }, ROTATE_MS);
    if (slides.length < 2) window.setTimeout(() => { if (playing) addSecond(); }, ROTATE_MS / 2);
  };

  document.addEventListener('visibilitychange', () => {
    if (!playing) return;
    if (document.hidden) { window.clearTimeout(timer); slides[current].video?.pause(); }
    else { slides[current].video?.play().catch(() => {}); schedule(); }
  });

  return {
    play() {
      if (playing) return;
      playing = true;
      slides[current].video?.play().catch(() => {});
      schedule();
    },
    pause() {
      playing = false;
      window.clearTimeout(timer);
      for (const s of slides) s.video?.pause();
    },
  };
}
