// Where the climb card and the KOM card live, and how big they are.
//
// They used to sit side by side in the middle of the screen, right over the road ahead. Now they dock at the
// screen edges (the climb card on the left, the KOM card on the right, each under whatever already holds that
// edge: the data blocks in a side column, the race panel, the workout panel) and above whatever sits at the
// bottom of that edge (mini-map, demo slider, gear and draft panels). After a few seconds with nothing new each
// shrinks to a slim chip; it opens again on hover, on a tap or click (a real button, aria-expanded), and by
// itself for a few seconds when something meaningful changes (`notify`). On phones the chips only ever open
// on a tap. Opened by the rider, a card may overlap what is under it: they asked for it.

const AUTO_MS = 6000; // how long a card stays open after something new
const HOVER_LEAVE_MS = 350; // a pointer that just left does not collapse it at once
const GAP = 8;
const COL_W = 290; // the cards' width (CSS px, before any TV zoom)
const PHONE = 560;

type Side = 'left' | 'right';
export type CardId = 'climb' | 'kom';

interface Entry {
  id: CardId;
  el: HTMLElement;
  toggle: HTMLButtonElement;
  pinned: boolean | null; // the rider's choice: true open, false closed, null leave it to the timer and the pointer
  hover: boolean;
  autoUntil: number;
  room: boolean; // does the open card fit where it is docked? Only then may it open by itself
  openH: number; // its height when open (measured whenever it is), to know whether it fits
  side: Side | null;
  timer: number;
}

const entries = new Map<CardId, Entry>();

export interface DockCard {
  /** Something new: open for a few seconds. */
  notify(): void;
  /** The card went away: forget the rider's choice and its side. */
  gone(): void;
}

const zoomOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).zoom) || 1;

function isOpen(e: Entry, now = Date.now()): boolean {
  if (e.pinned !== null) return e.pinned;
  return e.hover || (e.room && !narrow() && now < e.autoUntil);
}
const narrow = () => innerWidth <= PHONE;

function apply(e: Entry) {
  const now = Date.now();
  const open = isOpen(e, now);
  e.el.toggleAttribute('data-compact', !open);
  e.toggle.setAttribute('aria-expanded', String(open));
  e.el.dataset.open = open && (e.pinned === true || e.hover) ? 'user' : open ? 'auto' : '';
  if (open) e.openH = e.el.getBoundingClientRect().height || e.openH;
  clearTimeout(e.timer);
  if (e.pinned === null && !e.hover && now < e.autoUntil) e.timer = window.setTimeout(() => apply(e), e.autoUntil - now + 20);
}

export function registerCard(id: CardId, el: HTMLElement, toggle: HTMLButtonElement, openH: number): DockCard {
  const e: Entry = { id, el, toggle, pinned: null, hover: false, autoUntil: 0, room: true, openH, side: null, timer: 0 };
  entries.set(id, e);
  el.toggleAttribute('data-compact', true);

  // Click anywhere on the card (the toggle button covers it; Enter and Space on the button give the same click).
  toggle.addEventListener('click', () => {
    e.pinned = !isOpen(e);
    e.hover = false;
    apply(e);
  });
  el.addEventListener('pointerenter', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    if (e.pinned === false) e.pinned = null;
    e.hover = true;
    clearTimeout(e.timer);
    apply(e);
  });
  el.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    e.timer = window.setTimeout(() => { e.hover = false; apply(e); }, HOVER_LEAVE_MS);
  });
  el.addEventListener('focusout', () => { if (e.pinned === null) apply(e); });

  return {
    notify() {
      if (e.pinned === true) return;
      e.pinned = null;
      e.autoUntil = Date.now() + AUTO_MS;
      apply(e);
    },
    gone() {
      e.pinned = null; e.hover = false; e.autoUntil = 0; e.side = null;
      el.style.top = '';
      delete el.dataset.dock;
    },
  };
}

const rectOf = (el: Element | null) => {
  if (!el || (el as HTMLElement).hidden) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

/** Places the docked cards. Cheap: call it whenever a card changes, or the screen does. */
export function layoutCards() {
  const vw = innerWidth;
  const live = [...entries.values()].filter((e) => !e.el.hidden);
  if (!live.length) return;

  if (narrow()) {
    // Phone: the chips stack under the data blocks, left of the mini-map (CSS); the KOM chip under the climb chip.
    const climb = entries.get('climb');
    const climbR = climb && !climb.el.hidden ? rectOf(climb.el) : null;
    for (const e of live) {
      delete e.el.dataset.dock;
      e.room = false;
      const below = e.id === 'kom' && climbR ? `${Math.round((climbR.bottom + 6) / zoomOf(e.el))}px` : '';
      if (e.el.style.top !== below) e.el.style.top = below;
      apply(e);
    }
    return;
  }

  const body = document.body.classList;
  const belowHud = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--below-hud')) || 150;
  const top: Record<Side, number> = { left: belowHud, right: belowHud };
  const bottom: Record<Side, number> = { left: Infinity, right: Infinity };
  const footer = rectOf(document.querySelector('.bottom'));
  const floor = footer ? footer.top - GAP : innerHeight - 90;
  bottom.left = bottom.right = floor;

  // What already holds the top of each edge.
  const hud = rectOf(document.querySelector('.hud-wrap'));
  if (hud && (body.contains('hud-left') || body.contains('hud-right'))) {
    const s: Side = body.contains('hud-left') ? 'left' : 'right';
    top[s] = Math.max(top[s], hud.bottom + GAP);
  }
  for (const id of ['race-panel', 'workout-panel']) {
    const r = rectOf(document.getElementById(id));
    if (!r) continue;
    const s: Side = (r.left + r.right) / 2 < vw / 2 ? 'left' : 'right';
    top[s] = Math.max(top[s], r.bottom + GAP);
  }
  // What sits at the bottom of each edge, and any card's column that it reaches into.
  const colW = COL_W * (live[0] ? zoomOf(live[0].el) : 1);
  const cols: Record<Side, [number, number]> = { left: [0, 16 + colW], right: [vw - 16 - colW, vw] };
  for (const sel of ['#minimap', '#demo-panel', '#gear-panel', '#draft-panel', '.device-banner']) {
    const r = rectOf(document.querySelector(sel));
    if (!r) continue;
    for (const s of ['left', 'right'] as Side[]) {
      if (r.right > cols[s][0] && r.left < cols[s][1] && r.top > top[s]) bottom[s] = Math.min(bottom[s], r.top - GAP);
    }
  }

  // Sides: the climb card prefers the left, the KOM card the right; the one whose edge is clearer wins a close call.
  for (const e of live) {
    if (e.side) continue;
    const other = [...entries.values()].find((o) => o !== e && !o.el.hidden && o.side)?.side ?? null;
    const prefer: Side = e.id === 'climb' ? 'left' : 'right';
    const alt: Side = prefer === 'left' ? 'right' : 'left';
    e.side = other === prefer ? alt : other === alt ? prefer : top[prefer] - top[alt] > 80 ? alt : prefer;
  }
  for (const e of live) {
    const s = e.side!;
    if (e.el.dataset.dock !== s) e.el.dataset.dock = s;
    const t = `${Math.round(top[s] / zoomOf(e.el))}px`;
    if (e.el.style.top !== t) e.el.style.top = t;
    e.room = bottom[s] - top[s] >= e.openH;
    apply(e);
  }
}

addEventListener('resize', layoutCards);

// The bottom bar's height, for the phone layout's panels that stack above it (CSS: --footer-h).
const footerEl = document.querySelector<HTMLElement>('.bottom');
if (footerEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => document.documentElement.style.setProperty('--footer-h', `${Math.round(footerEl.getBoundingClientRect().height)}px`)).observe(footerEl);
}
