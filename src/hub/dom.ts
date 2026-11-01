// Small DOM helpers for the hub: element builder, a keyboard-friendly button, and a queue that
// draws canvases only while they are on screen (and again when they change size).

type Props = { class?: string; text?: string; title?: string; [attr: string]: string | undefined };

/** h('div', { class: 'x', text: 'hi' }, child, 'text') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

export function button(label: string, onClick: (e: MouseEvent) => void, cls = '', attrs: Props = {}) {
  const b = h('button', { type: 'button', class: cls, text: label, ...attrs });
  b.addEventListener('click', onClick);
  return b;
}

/** A shimmering placeholder block; give it the size of what will replace it so nothing jumps. */
export function skeleton(cls = '', width?: string, height?: string) {
  const s = h('span', { class: `hub-sk ${cls}`.trim(), 'aria-hidden': 'true' });
  if (width) s.style.width = width;
  if (height) s.style.height = height;
  return s;
}

// ---------------------------------------------------------------- charts ----

const draws = new WeakMap<Element, () => void>();
const onScreen = new WeakSet<Element>();
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;

function drawNow(el: Element) {
  const canvas = el as HTMLCanvasElement;
  if (!canvas.clientWidth || !canvas.clientHeight) return; // hidden (another tab) or not laid out yet
  draws.get(el)?.();
}

/**
 * Calls `draw` for a canvas once it is on screen and has a size, and again whenever it is resized
 * while on screen. Canvases in a hidden tab or below the fold cost nothing until they are seen.
 */
export function drawWhenVisible(canvas: HTMLCanvasElement, draw: () => void) {
  draws.set(canvas, draw);
  if (onScreen.has(canvas)) drawNow(canvas); // already watched: the new drawing replaces the old one now
  if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') {
    requestAnimationFrame(() => drawNow(canvas));
    return;
  }
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { onScreen.add(e.target); drawNow(e.target); } else onScreen.delete(e.target);
    }
  }, { rootMargin: '200px' });
  ro ??= new ResizeObserver((entries) => {
    for (const e of entries) if (onScreen.has(e.target)) drawNow(e.target);
  });
  io.observe(canvas);
  ro.observe(canvas);
}

/** Stops watching a canvas (when its card is thrown away). */
export function forgetCanvas(canvas: HTMLCanvasElement) {
  io?.unobserve(canvas);
  ro?.unobserve(canvas);
  draws.delete(canvas);
  onScreen.delete(canvas);
}

/** Runs `fn` once `el` is first on screen (or at once without IntersectionObserver). Returns a cancel function. */
export function onceVisible(el: Element, fn: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') { fn(); return () => {}; }
  const obs = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { obs.disconnect(); fn(); }
  }, { rootMargin: '120px' });
  obs.observe(el);
  return () => obs.disconnect();
}

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
