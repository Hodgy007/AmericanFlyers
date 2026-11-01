// Small text helpers for AI replies: whatever Claude (or a canned table) says is
// cleaned, kept to a few words and kept on one line before it reaches the screen.

/** One line, no control characters or markup, at most `maxWords` words. */
export function cleanLine(text: unknown, maxWords: number, maxChars = 200): string {
  if (typeof text !== 'string') return '';
  const flat = text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[<>`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = flat.split(' ').filter(Boolean);
  let out = words.slice(0, maxWords).join(' ');
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, '');
  return out;
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** A pick from a list that avoids the last few choices (so lines don't repeat back to back). */
export function pickFresh<T>(list: readonly T[], recent: T[], rand: () => number = Math.random): T | undefined {
  if (!list.length) return undefined;
  const fresh = list.filter((x) => !recent.includes(x));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}
