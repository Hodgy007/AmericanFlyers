// The hub's Climb guide: a panel under a stage card with four topic chips. A chip asks /api/ai (kind
// coach_climb) for a short web-grounded answer and shows it with numbered source links. Signed out riders
// get the sign-in prompt, riders who haven't opted in to the AI coach get the opt-in, and a busy or
// out-of-quota server gets a line from our own stage figures plus the server's message. Answers are kept
// in the browser for 24 hours per stage and topic (src/ai/climbCache.ts). The hub loads this file on the
// first click of "Climb guide", so it isn't in the entry chunk.

import { askAi } from '../cloud/aiApi';
import { readClimbCache, writeClimbCache } from '../ai/climbCache';
import { CLIMB_TOPICS, CLIMB_TOPIC_LABELS, type Climb, type ClimbTopic } from '../ai/climbs';
import { cannedClimb } from '../ai/canned';
import { sanitizeClimbGuide } from '../ai/sanitize';
import type { AiOutcome } from '../cloud/aiApi';
import type { ClimbResult } from '../ai/types';
import { button, h, skeleton } from './dom';

/** What the guide needs from the rest of the app (main.ts supplies it through the hub's deps). */
export interface ClimbGuideHost {
  signedIn(): boolean;
  /** The AI coach switch in Settings (the server has the final say through the database). */
  coachOn(): boolean;
  openSignIn(why: string): void;
  /** Saves the opt-in for the AI coach; true when it is on afterwards. */
  enableCoach(): Promise<boolean>;
  openSettings(): void;
}

export interface ClimbGuideOptions {
  climb: Climb;
  stageName: string;
  host: ClimbGuideHost;
  imperial(): boolean;
  onClose(): void;
  ask?: (kind: 'coach_climb', payload: { stageId: string; topic: ClimbTopic }) => Promise<AiOutcome<'coach_climb'>>;
  now?: () => number;
}

export interface ClimbGuide {
  el: HTMLElement;
  /** Moves the keyboard focus to the first topic chip. */
  focus(): void;
  dispose(): void;
}

export const AI_NOTE = 'AI-generated from web sources, may be wrong. Check official sites before you travel.';

export function mountClimbGuide(opts: ClimbGuideOptions): ClimbGuide {
  const { climb, host } = opts;
  const ask = opts.ask ?? ((kind, payload) => askAi(kind, payload));
  const now = opts.now ?? Date.now;
  let token = 0;
  let current: ClimbTopic | null = null;
  let disposed = false;

  const chips = new Map<ClimbTopic, HTMLButtonElement>();
  const group = h('div', { class: 'hub-climb-chips', role: 'group', 'aria-label': 'Climb guide topics' });
  for (const topic of CLIMB_TOPICS) {
    const { label, hint } = CLIMB_TOPIC_LABELS[topic];
    const chip = button(label, () => show(topic), 'hub-climb-chip', { title: hint, 'aria-pressed': 'false', 'data-topic': topic });
    chips.set(topic, chip);
    group.append(chip);
  }
  const out = h('div', { class: 'hub-climb-out', 'aria-live': 'polite', 'aria-busy': 'false' });
  const close = button('Close', () => opts.onClose(), 'hub-mini hub-race', { 'aria-label': `Close the climb guide for ${opts.stageName}` });
  const el = h('section', { class: 'hub-climb', 'aria-label': `Climb guide: ${opts.stageName}`, 'data-stage': climb.id },
    h('div', { class: 'hub-climb-head' }, h('h4', { text: `Climb guide · ${opts.stageName}` }), close),
    group,
    out,
    h('p', { class: 'hub-climb-note', text: AI_NOTE }),
  );
  idle();

  function setBusy(busy: boolean) { out.setAttribute('aria-busy', String(busy)); }
  function idle() { setBusy(false); out.replaceChildren(h('p', { class: 'hub-climb-hint', text: 'Pick a topic for a short, current answer from the web.' })); }

  function select(topic: ClimbTopic | null) {
    current = topic;
    for (const [t, chip] of chips) chip.setAttribute('aria-pressed', String(t === topic));
  }

  function loading() {
    setBusy(true);
    out.replaceChildren(
      h('p', { class: 'hub-climb-hint', text: 'Searching the web…' }),
      skeleton('hub-climb-sk', '100%', '14px'), skeleton('hub-climb-sk', '92%', '14px'), skeleton('hub-climb-sk', '64%', '14px'),
    );
  }

  /** Shows the answer: the summary, the facts, the date it is true as of, and the numbered sources. */
  function answer(d: ClimbResult, saved: boolean) {
    setBusy(false);
    const kids: (Node | null)[] = [];
    if (d.summary) kids.push(h('p', { class: 'hub-climb-summary', text: d.summary }));
    if (d.facts.length) kids.push(h('ul', { class: 'hub-climb-facts' }, ...d.facts.map((f) => h('li', { text: f }))));
    if (d.asOf) kids.push(h('p', { class: 'hub-climb-asof', text: `${saved ? 'Saved answer, ' : ''}as of ${d.asOf}${d.sources.length ? '' : '. No web sources were available.'}` }));
    if (d.sources.length) {
      kids.push(h('ol', { class: 'hub-climb-sources', 'aria-label': 'Sources' }, ...d.sources.map((s) => {
        const a = h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title });
        return h('li', { value: String(s.n) }, a, h('span', { class: 'hub-climb-host', text: ` ${s.host}` }));
      })));
    }
    out.replaceChildren(...kids.filter((k): k is Node => !!k));
  }

  function fallback(topic: ClimbTopic, message: string) {
    setBusy(false);
    const c = cannedClimb({ stageId: climb.id, topic }, opts.imperial());
    out.replaceChildren(h('p', { class: 'hub-climb-summary', text: c.summary }), h('p', { class: 'hub-climb-msg', role: 'status', text: message }));
  }

  function signIn() {
    setBusy(false);
    out.replaceChildren(
      h('p', { class: 'hub-climb-hint', text: 'Sign in to use the Climb guide.' }),
      button('Sign in', () => host.openSignIn('Sign in to use the Climb guide.'), 'hub-mini', { 'data-act': 'signin' }),
    );
  }

  function consent(topic: ClimbTopic) {
    setBusy(false);
    const on = button('Turn on the AI coach', async () => {
      on.disabled = true;
      const ok = await host.enableCoach().catch(() => false);
      if (disposed) return;
      if (ok) void show(topic);
      else { on.disabled = false; msg.textContent = 'Couldn’t save your choice. Check your connection and try again.'; }
    }, 'hub-mini', { 'data-act': 'consent' });
    const msg = h('p', { class: 'hub-climb-msg', role: 'status' });
    out.replaceChildren(
      h('p', { class: 'hub-climb-hint', text: 'The Climb guide is part of the AI coach, which is off. When it is on, only the climb and the topic you pick are sent for a web search, along with your sign-in.' }),
      h('div', { class: 'hub-climb-actions' }, on, button('Settings', () => host.openSettings(), 'hub-mini hub-race', { 'data-act': 'settings' })),
      msg,
    );
  }

  async function show(topic: ClimbTopic) {
    const mine = ++token;
    select(topic);
    if (!host.signedIn()) return signIn();
    const saved = readClimbCache(climb.id, topic, now());
    if (saved) return answer(saved, true);
    if (!host.coachOn()) return consent(topic);
    loading();
    const r = await ask('coach_climb', { stageId: climb.id, topic });
    if (disposed || mine !== token) return; // another chip was pressed meanwhile
    if (r.ok) {
      const clean = sanitizeClimbGuide(r.data, climb.id, topic, typeof r.data?.asOf === 'string' ? r.data.asOf : '');
      if (clean && r.source === 'web') { writeClimbCache(clean, now()); return answer(clean, false); }
      return fallback(topic, 'The live guide had nothing to show. Try again in a bit.');
    }
    if (r.error === 'sign_in') return signIn();
    if (r.error === 'no_consent') return consent(topic);
    fallback(topic, r.message || 'The climb guide is taking a break.');
  }

  return {
    el,
    focus: () => { (chips.get(current ?? CLIMB_TOPICS[0]) ?? [...chips.values()][0])?.focus(); },
    dispose: () => { disposed = true; token++; },
  };
}
