// The faces of Coach Marty and the four rivals: a portrait image per speaker laid over the emoji, which stays as
// the fallback when the file isn't there (or fails to load). DOM, so it lives apart from rivals.ts, which the server shares.

/** Where a speaker's portrait is served from: `coach` or a rival's id. */
export const portraitUrl = (id: string) => `/images/people/${id}.webp`;

/**
 * Lays the speaker's portrait over `host` (which should be `position: relative` with a fixed square size and
 * `overflow: hidden`, see `.face` in style.css). Decorative (alt=""): the name is always beside it. The image is
 * invisible until it has loaded, then the host gets `has-portrait` (which hides the emoji); if it can't load it
 * removes itself and the emoji stays.
 */
export function attachPortrait(host: HTMLElement, id: string): void {
  const img = document.createElement('img');
  img.className = 'face-img';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener('load', () => host.classList.add('has-portrait'));
  img.addEventListener('error', () => img.remove());
  img.src = portraitUrl(id);
  host.append(img);
}

/** A square face for the coach or a rival: the emoji, with the portrait over it when there is one. */
export function portrait(id: string, emoji: string, cls = ''): HTMLElement {
  const face = document.createElement('span');
  face.className = `face ${cls}`.trim();
  face.setAttribute('aria-hidden', 'true');
  face.textContent = emoji;
  attachPortrait(face, id);
  return face;
}
