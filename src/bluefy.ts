// iPhone and iPad: every browser there (Safari, Chrome, Edge…) is WebKit, which has no Web Bluetooth.
// The free Bluefy browser adds it, so signed-in riders on an Apple phone or tablet that can't connect
// get a small card in the hub with a link to the App Store. Never shown in Bluefy itself (it has
// navigator.bluetooth), on other platforms, or to riders who are not signed in.

export const BLUEFY_URL = 'https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055';
export const BLUEFY_ICON = '/images/bluefy-icon.png';

/** True for iPhone, iPod and iPad, including iPadOS 13+ which reports a Mac user agent (a Mac with a touch screen). */
export function isAppleMobile(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

export interface BluefyInput {
  signedIn: boolean;
  hasBluetooth: boolean;
  ua: string;
  platform: string;
  maxTouchPoints: number;
}

export function shouldSuggestBluefy(o: BluefyInput): boolean {
  return o.signedIn && !o.hasBluetooth && isAppleMobile(o.ua, o.platform, o.maxTouchPoints);
}

/** "iPhone", "iPad", or "iPhone or iPad" when we can't tell. */
export function deviceName(ua: string, platform: string, maxTouchPoints: number): string {
  if (/iPad/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1 && !/iPhone|iPod/i.test(ua))) return 'iPad';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  return 'iPhone or iPad';
}

export interface BluefyEnv {
  /** Live values; read each time the card is refreshed. */
  signedIn(): boolean;
  hasBluetooth(): boolean;
  ua(): string;
  platform(): string;
  maxTouchPoints(): number;
  /** Subscribe to sign-in and sign-out; returns an unsubscribe. */
  onChange(fn: () => void): () => void;
  /** An optional toast for the "Copy link" confirmation. */
  toast?(msg: string, ms?: number): void;
}

/** The environment of this browser; the caller adds signedIn, onChange and toast. */
export function browserEnv(extra: Pick<BluefyEnv, 'signedIn' | 'hasBluetooth' | 'onChange' | 'toast'>): BluefyEnv {
  return {
    ...extra,
    ua: () => navigator.userAgent,
    platform: () => navigator.platform,
    maxTouchPoints: () => navigator.maxTouchPoints,
  };
}

/**
 * Puts the card into `host` (which is hidden and empty until the card applies) and keeps it in step
 * with sign-in and sign-out. Returns a function that stops listening.
 */
export function mountBluefyCard(host: HTMLElement, env: BluefyEnv): () => void {
  let built = false;
  let name: HTMLElement;
  function build() {
    built = true;
    const icon = document.createElement('img');
    icon.className = 'bluefy-icon';
    icon.src = BLUEFY_ICON;
    icon.alt = '';
    icon.width = 48;
    icon.height = 48;
    icon.decoding = 'async';
    name = document.createElement('strong');
    name.className = 'bluefy-title';
    const text = document.createElement('p');
    text.className = 'bluefy-text';
    text.textContent = 'This browser can’t use Bluetooth. Get the free Bluefy browser, then open American Flyers in it.';
    const link = document.createElement('a');
    link.className = 'bluefy-link primary';
    link.href = BLUEFY_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Get Bluefy on the App Store';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'bluefy-copy';
    copy.textContent = 'Copy link';
    copy.title = 'Copy the address of this site, to paste into Bluefy';
    let timer = 0;
    copy.addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(location.origin); ok = true; } catch { /* blocked or unavailable */ }
      clearTimeout(timer);
      copy.textContent = ok ? 'Copied ✓' : 'Copy failed';
      if (ok) env.toast?.('Link copied. Paste it into Bluefy.', 2500);
      timer = window.setTimeout(() => { copy.textContent = 'Copy link'; }, 2000);
    });
    const actions = document.createElement('div');
    actions.className = 'bluefy-actions';
    actions.append(link, copy);
    const body = document.createElement('div');
    body.className = 'bluefy-body';
    body.append(name, text, actions);
    host.replaceChildren(icon, body);
  }
  function refresh() {
    const ua = env.ua();
    const platform = env.platform();
    const touch = env.maxTouchPoints();
    const show = shouldSuggestBluefy({ signedIn: env.signedIn(), hasBluetooth: env.hasBluetooth(), ua, platform, maxTouchPoints: touch });
    if (show) {
      if (!built) build();
      name.textContent = `Connect your trainer on ${deviceName(ua, platform, touch)}`;
    }
    host.hidden = !show;
  }
  host.hidden = true;
  refresh();
  return env.onChange(refresh);
}
