// The Privacy page, as a dialog (☰ Menu → Privacy, and links in the sign-in
// dialog, the home page and the profile). Any element with a `data-privacy`
// attribute opens it, so other pages only need that attribute.
//
// The page's text lives in privacyText.ts and is loaded when the dialog is first
// opened (or in a spare moment after the first frame), so it isn't in the first download.

import { lazy, use } from './lazy';

const text = lazy(() => import('./privacyText').then((m) => m.PRIVACY_HTML));

/** Loads the privacy text in a spare moment (main.ts calls this after the first frame). */
export const prefetchPrivacy = () => text.prefetch();

export function initPrivacyUi() {
  const dialog = document.getElementById('privacy') as HTMLDialogElement | null;
  const body = document.getElementById('privacy-body');
  if (!dialog || !body) return;

  function open(trigger: Element) {
    use(text, (html) => {
      if (!body!.childElementCount) body!.innerHTML = html;
      if (!dialog!.open) dialog!.showModal();
    }, trigger);
  }

  // Menu items, small print and profile buttons just carry `data-privacy`.
  document.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement | null)?.closest('[data-privacy]');
    if (!t) return;
    e.preventDefault();
    document.getElementById('menu')?.setAttribute('hidden', '');
    document.getElementById('btn-menu')?.setAttribute('aria-expanded', 'false');
    open(t);
  });

  document.getElementById('goodbye-close')?.addEventListener('click', () => (document.getElementById('goodbye') as HTMLDialogElement).close());
}
