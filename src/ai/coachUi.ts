// The coach on screen: a bubble in the bottom-left corner for his tips (6
// seconds each), and the debrief card on the ride summary. Plain DOM, built
// here so index.html needs no markup for either.

import { cannedDebrief } from './canned';
import { suggestionById } from './catalogue';
import { speak, stopSpeaking } from './speech';
import type { DebriefPayload, DebriefResult } from './types';

export const COACH_NAME = 'Coach Marty';
export const BUBBLE_MS = 6000;

export interface CoachBubble { show(text: string, voice: boolean): void; hide(): void }

export function initCoachBubble(): CoachBubble {
  const el = document.createElement('aside');
  el.id = 'coach-bubble';
  el.className = 'coach-bubble';
  el.setAttribute('role', 'status');
  el.hidden = true;
  el.innerHTML = '<span class="coach-face" aria-hidden="true">🧢</span><div><strong></strong><p></p></div>';
  el.querySelector('strong')!.textContent = COACH_NAME;
  document.body.append(el);
  const p = el.querySelector('p')!;
  let timer = 0;
  const hide = () => { el.classList.remove('show'); window.setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 300); };
  return {
    show(text, voice) {
      p.textContent = text;
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('show'));
      clearTimeout(timer);
      timer = window.setTimeout(hide, BUBBLE_MS);
      if (voice) speak(text, { pitch: 0.85, rate: 0.95 });
    },
    hide() { clearTimeout(timer); stopSpeaking(); el.classList.remove('show'); el.hidden = true; },
  };
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export interface DebriefCardDeps {
  /** What to show when the AI coach isn't on: null = nothing, otherwise a one-line invitation with a button. */
  invite: null | { text: string; button: string; onClick: () => void };
  /** Loads a suggested session (a workout or a stage). */
  load(id: string, kind: 'workout' | 'stage'): void;
}

/** The debrief as a card: headline, summary, two lists and the suggested next session. */
export function debriefBody(d: DebriefResult, source: 'claude' | 'canned', deps: Partial<Pick<DebriefCardDeps, 'load'>>): Node {
  const box = h('div', 'coach-debrief');
  box.append(h('h3', '', d.headline), h('p', 'coach-summary', d.summary));
  const cols = h('div', 'coach-cols');
  for (const [title, items, cls] of [['Went well', d.went_well, 'good'], ['Work on', d.work_on, 'work']] as const) {
    const col = h('div', `coach-col ${cls}`);
    col.append(h('h4', '', title));
    const ul = h('ul');
    for (const i of items) ul.append(h('li', '', i));
    col.append(ul);
    cols.append(col);
  }
  box.append(cols);
  const next = suggestionById(d.next.id);
  if (next) {
    const row = h('div', 'coach-next');
    const info = h('div');
    info.append(h('strong', '', `Next: ${next.name}`), h('span', '', d.next.why));
    row.append(info);
    if (deps.load) {
      const load = deps.load;
      const b = h('button', 'primary', 'Load it');
      b.type = 'button';
      b.addEventListener('click', () => load(next.id, next.kind));
      row.append(b);
    }
    box.append(row);
  }
  box.append(h('small', 'coach-foot', source === 'claude' ? 'Written by an AI coach from your ride numbers.' : 'Quick notes from your ride numbers.'));
  return box;
}

/**
 * The card for the ride summary. It appears at once, shows "looking over your
 * ride" while the AI works, and is filled in with `fill()` (the AI's debrief or
 * the canned one). `fail()` swaps in the canned debrief.
 */
export function debriefCard(deps: DebriefCardDeps) {
  const card = h('section', 'coach-card');
  const head = h('header');
  head.append(h('span', 'coach-face', '🧢'), h('strong', '', COACH_NAME));
  const body = h('div', 'coach-card-body');
  card.append(head, body);
  if (deps.invite) {
    const inv = deps.invite;
    const p = h('p', 'muted', inv.text);
    const b = h('button', '', inv.button);
    b.type = 'button';
    b.addEventListener('click', inv.onClick);
    body.append(p, b);
  } else {
    body.append(h('p', 'muted coach-wait', 'Coach Marty is looking over your ride…'));
  }
  return {
    node: card,
    fill(d: DebriefResult, source: 'claude' | 'canned') { body.replaceChildren(debriefBody(d, source, deps)); },
    fallback(payload: DebriefPayload) { body.replaceChildren(debriefBody(cannedDebrief(payload), 'canned', deps)); },
  };
}
