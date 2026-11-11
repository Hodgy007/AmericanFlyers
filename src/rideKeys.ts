// Which key presses the ride screen's shortcuts (c, m, f, r, arrows, shifting) should ignore.
// Kept pure so it can be tested without a browser.

/** The parts of a keyboard event's target the rule looks at. */
export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

export interface KeyEventLike {
  /** A DOM event's target (anything; only the fields of KeyTarget are looked at). */
  target: object | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** True while an input method (IME) is composing text: those keys belong to it. */
  isComposing?: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the target is a field the rider is typing into. */
export function isTypingTarget(t: KeyTarget | null): boolean {
  if (!t) return false;
  return TYPING_TAGS.has((t.tagName ?? '').toUpperCase()) || t.isContentEditable === true;
}

/**
 * Should a key press be left alone by the ride's shortcuts? Yes in dialogs and in text fields, on the home page
 * (its sign-up form is not a dialog), and with Ctrl, Cmd or Alt held (Ctrl+C, Ctrl+F and friends are the browser's).
 * `release` is for keyup: letting go of a steering key must always work, so modifiers and the home page don't block it.
 */
export function ignoreRideKey(e: KeyEventLike, atHome: boolean, release = false): boolean {
  const target = e.target as KeyTarget | null;
  if (target?.closest?.('dialog')) return true;
  if (isTypingTarget(target)) return true;
  if (release) return false;
  if (e.isComposing) return true;
  if (atHome) return true;
  return !!(e.ctrlKey || e.metaKey || e.altKey);
}
