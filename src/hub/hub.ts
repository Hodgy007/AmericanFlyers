// The Hub: the full-screen screen shown before you ride. Sign-in leads here, and so does opening
// the app as a signed-in rider; an account is required, so the hub is never shown without one.
// The header says who you are and what Ride will start; below it sit the sections (Route, Training, Plan, Achievements,
// Garage, Stats, Events), each a small module that is loaded the first time it is shown.
//
// The hub is light on purpose: it paints from what the browser already has (settings, the saved
// workouts and routes, and a cached copy of last visit's wallet and ride summary), then fills in
// the account's numbers as they arrive. Detail views are the app's existing dialogs.
//
// Loading order: this file and header.ts are in the main bundle; every section is a dynamic
// import(), and the garage preview, charts and account queries sit behind their own.

import './hub.css';
import { account, onAccountChange, type Account } from '../cloud/account';
import type { Wallet } from '../garage/progression';
import { allStages, stageById } from '../routes/library';
import { workoutById } from '../workouts/library';
import { clearCache, loadCache, loadStageChoice, saveCache, saveStageChoice, type HubCache } from './cache';
import type { Choice, Summary } from './data';
import { FREE_RIDE_STAGE } from './data';
import { h, onceVisible, prefersReducedMotion } from './dom';
import { mountHeader } from './header';
import type { HubCtx, HubDeps, IdentityState, SectionId, SectionMount, SectionView, Topic } from './types';

interface SectionDef {
  id: SectionId;
  icon: string;
  label: string;
  title: string;
  blurb: string;
  load: () => Promise<{ mount: SectionMount }>;
}

const SECTIONS: SectionDef[] = [
  { id: 'route', icon: '🏁', label: 'Route', title: 'Route', blurb: 'Pick the road. Ride starts it.', load: () => import('./sections/route') },
  { id: 'training', icon: '🏋', label: 'Training', title: 'Training', blurb: 'Pick a workout to do on the road.', load: () => import('./sections/training') },
  { id: 'plan', icon: '📅', label: 'Plan', title: 'Training plan', blurb: 'Your next session is always one click away.', load: () => import('./sections/plan') },
  { id: 'achievements', icon: '🏅', label: 'Achievements', title: 'Achievements', blurb: 'Badges you have earned and the ones to go.', load: () => import('./sections/achievements') },
  { id: 'garage', icon: '🚲', label: 'Garage', title: 'Garage', blurb: 'Your bike and kit, your level and this week’s challenges.', load: () => import('./sections/garage') },
  { id: 'stats', icon: '📊', label: 'Stats', title: 'Stats', blurb: 'How your riding is going.', load: () => import('./sections/stats') },
  { id: 'events', icon: '🗓', label: 'Events', title: 'Next event', blurb: 'Group rides and races, with a start everyone shares.', load: () => import('./sections/events') },
];

interface Slot {
  def: SectionDef;
  el: HTMLElement;
  body: HTMLElement;
  tab: HTMLButtonElement;
  view?: SectionView;
  loading?: boolean;
}

export function initHub(deps: HubDeps) {
  const root = document.getElementById('hub')!;
  const nav = document.getElementById('hub-tabs')!;
  const holder = document.getElementById('hub-sections')!;
  const live = h('p', { class: 'hub-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.append(live);

  let isOpen = false;
  let cache: HubCache | null = loadCache();
  let summary: Summary | null = cache?.summary ?? null;
  let status: 'idle' | 'loading' | 'ready' | 'error' = summary ? 'ready' : 'idle';
  let appStageAtClose: string | null = null;
  let current: SectionId = 'route';
  const mq = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  let stacked = !!mq?.matches;

  // ----------------------------------------------------------- the choice ----
  const validStage = (id: string | null) => (id && allStages().some((s) => s.id === id) ? id : null);
  const fromUrl = validStage(new URLSearchParams(location.search).get('stage'));
  let choice: Choice = { stageId: fromUrl ?? validStage(loadStageChoice()) ?? validStage(deps.currentStageId()) ?? FREE_RIDE_STAGE, workoutId: null };

  // -------------------------------------------------------------- identity ----
  // The hub only opens for a signed-in rider, or one the last visit left signed in whose session is still being
  // checked ('pending': last visit's name and wallet stand in). If that check finds no account the home page replaces the hub.
  function identity(): { state: IdentityState; name: string } {
    const a = account();
    return a ? { state: 'in', name: a.name } : { state: 'pending', name: cache?.name ?? '' };
  }

  /** The wallet on screen: the live one, or last visit's copy until it arrives. */
  function wallet(): Wallet | null {
    return deps.garage.wallet ?? cache?.wallet ?? null;
  }

  /** Forgets the previous rider's cached numbers (they signed out, or the signed-in hint was stale). */
  function forget() {
    cache = null;
    summary = null;
    status = 'idle';
    clearCache();
  }

  function remember() {
    const a = account();
    if (!a) return;
    cache = { v: 1, userId: a.id, name: a.name, wallet: deps.garage.wallet ?? cache?.wallet ?? null, summary };
    saveCache(cache);
  }

  let summarySeq = 0;
  async function loadSummary() {
    const a = account();
    if (!a) return;
    const mine = a.id;
    const seq = ++summarySeq; // only the newest request may answer (a ride saved while one is in flight asks again)
    if (status !== 'ready') status = 'loading';
    emit('summary');
    try {
      const { loadSummary: load } = await import('./accountData');
      const s = deps.settings();
      const fresh = await load(s.riderKg, s.ftp);
      if (seq !== summarySeq || account()?.id !== mine) return; // signed out, switched, or superseded
      summary = fresh;
      status = 'ready';
      remember();
    } catch {
      if (seq !== summarySeq) return;
      if (status !== 'ready') status = 'error';
    }
    emit('summary');
  }

  // ------------------------------------------------------------------ ctx ----
  const label = (c: Choice) => (c.workoutId ? workoutById(c.workoutId)?.name : undefined) ?? stageById(c.stageId).name;

  const ctx: HubCtx = {
    deps,
    choice: () => choice,
    pick(c) {
      choice = c;
      emit('choice');
      ctx.announce(`${label(c)} chosen. Press Ride to start.`);
    },
    identity,
    summary: () => summary,
    summaryStatus: () => status,
    wallet,
    imperial: () => deps.settings().units === 'imperial',
    reloadSummary: () => { void loadSummary(); },
    announce(msg) {
      live.textContent = '';
      window.setTimeout(() => { live.textContent = msg; }, 40);
    },
    go() {
      saveStageChoice(choice.stageId);
      deps.start(choice);
    },
    goWith(c) {
      choice = c;
      emit('choice');
      ctx.go();
    },
  };

  const header = mountHeader(ctx);

  // -------------------------------------------------------------- sections ----
  const slots = new Map<SectionId, Slot>();
  const visible = new Set<SectionId>(); // stacked layout: sections on screen now
  const wasActive = new Map<SectionId, boolean>();

  for (const def of SECTIONS) {
    const body = h('div', { class: 'hub-section-body' }, h('div', { class: 'hub-sk-grid', 'aria-hidden': 'true' }, h('span', { class: 'hub-sk hub-sk-card' }), h('span', { class: 'hub-sk hub-sk-card' }), h('span', { class: 'hub-sk hub-sk-card' })));
    const el = h('section', { class: 'hub-section', id: `hub-s-${def.id}`, 'aria-labelledby': `hub-h-${def.id}`, tabindex: '-1' },
      h('header', { class: 'hub-section-head' }, h('h2', { id: `hub-h-${def.id}`, text: def.title }), h('p', { text: def.blurb })),
      body);
    const tab = h('button', { type: 'button', class: 'hub-tab', id: `hub-tab-${def.id}` }, h('span', { class: 'hub-tab-icon', 'aria-hidden': 'true', text: def.icon }), h('span', { text: def.label }));
    tab.addEventListener('click', () => select(def.id, true));
    tab.addEventListener('keydown', (e) => tabKeys(e, def.id));
    holder.append(el);
    nav.append(tab);
    slots.set(def.id, { def, el, body, tab });
  }

  /** Re-runs a section's refresh without losing keyboard focus: elements marked data-fkey are found again afterwards. */
  function keepFocus(slot: Slot, fn: () => void) {
    const a = document.activeElement;
    const key = a instanceof HTMLElement && slot.el.contains(a) ? a.closest<HTMLElement>('[data-fkey]')?.dataset.fkey : undefined;
    fn();
    if (key) slot.el.querySelector<HTMLElement>(`[data-fkey="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  function emit(topic: Topic) {
    header.refresh(topic);
    for (const slot of slots.values()) if (slot.view) keepFocus(slot, () => slot.view!.refresh(topic));
  }

  function ensure(id: SectionId) {
    const slot = slots.get(id)!;
    if (slot.view || slot.loading) return;
    slot.loading = true;
    slot.def.load().then((m) => {
      slot.loading = false;
      slot.body.replaceChildren();
      slot.view = m.mount(slot.body, ctx);
      updateActive();
    }).catch((e) => {
      slot.loading = false;
      slot.body.replaceChildren(
        h('p', { class: 'hub-note', text: `Couldn’t load this section: ${(e as Error).message}` }),
        h('button', { type: 'button', text: 'Try again' }),
      );
      slot.body.querySelector('button')!.addEventListener('click', () => { slot.body.replaceChildren(); ensure(id); });
    });
  }

  function updateActive() {
    for (const [id, slot] of slots) {
      if (!slot.view) continue; // not loaded yet: it is told when it mounts
      const active = isOpen && (stacked ? visible.has(id) : id === current);
      if (wasActive.get(id) === active) continue;
      wasActive.set(id, active);
      slot.view.setActive?.(active);
    }
  }

  /** Shows a section. `user` is true when the rider chose it (so the page scrolls and focus follows). */
  function select(id: SectionId, user = false) {
    current = id;
    for (const [sid, slot] of slots) {
      const on = sid === id;
      slot.el.classList.toggle('current', on);
      slot.tab.classList.toggle('selected', on);
      if (!stacked) {
        slot.tab.setAttribute('aria-selected', String(on));
        slot.tab.tabIndex = on ? 0 : -1;
      } else if (on) slot.tab.setAttribute('aria-current', 'true');
      else slot.tab.removeAttribute('aria-current');
    }
    const slot = slots.get(id)!;
    ensure(id);
    if (user && stacked) {
      slot.el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      slot.el.focus({ preventScroll: true });
    }
    updateActive();
  }

  function tabKeys(e: KeyboardEvent, id: SectionId) {
    if (stacked) return;
    const ids = SECTIONS.map((s) => s.id);
    let i = ids.indexOf(id);
    if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = ids.length - 1;
    else return;
    e.preventDefault();
    select(ids[i]);
    slots.get(ids[i])!.tab.focus();
  }

  /** Tabs on a desktop screen, one scrolling column on a phone. */
  function applyLayout() {
    stacked = !!mq?.matches;
    root.dataset.layout = stacked ? 'stacked' : 'tabs';
    nav.setAttribute('role', stacked ? 'navigation' : 'tablist');
    nav.setAttribute('aria-label', 'Hub sections');
    nav.setAttribute('aria-orientation', 'horizontal');
    if (stacked) nav.removeAttribute('aria-orientation');
    for (const slot of slots.values()) {
      if (stacked) {
        slot.tab.removeAttribute('role');
        slot.tab.removeAttribute('aria-controls');
        slot.tab.removeAttribute('aria-selected');
        slot.tab.tabIndex = 0;
        slot.el.removeAttribute('role');
      } else {
        slot.tab.setAttribute('role', 'tab');
        slot.tab.setAttribute('aria-controls', slot.el.id);
        slot.el.setAttribute('role', 'tabpanel');
        slot.el.setAttribute('aria-labelledby', slot.tab.id);
      }
    }
    select(current);
    if (stacked) for (const slot of slots.values()) onceVisible(slot.el, () => ensure(slot.def.id));
  }

  // Which sections are on screen, in the stacked layout (to start and stop their previews and timers).
  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = SECTIONS.find((s) => `hub-s-${s.id}` === (e.target as HTMLElement).id)!.id;
        if (e.isIntersecting) visible.add(id); else visible.delete(id);
      }
      if (stacked) {
        const first = SECTIONS.find((s) => visible.has(s.id));
        if (first && first.id !== current) {
          current = first.id;
          for (const [sid, slot] of slots) slot.tab.classList.toggle('selected', sid === current);
        }
      }
      updateActive();
    }, { rootMargin: '0px 0px -30% 0px' });
    for (const slot of slots.values()) io.observe(slot.el);
  }
  mq?.addEventListener?.('change', () => applyLayout());

  // ------------------------------------------------------------ open/close ----
  function syncChoiceWithApp() {
    const now = deps.currentStageId();
    if (appStageAtClose !== null && now !== appStageAtClose) choice = { stageId: now, workoutId: null }; // a race, an event or an upload moved the app
    if (!validStage(choice.stageId)) choice = { stageId: FREE_RIDE_STAGE, workoutId: null };
    if (choice.workoutId && !workoutById(choice.workoutId)) choice = { ...choice, workoutId: null };
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    syncChoiceWithApp();
    root.hidden = false;
    document.documentElement.removeAttribute('data-start');
    document.body.classList.add('at-home', 'at-hub'); // at-home: the ride's own panels, presence and ride-ons stand down
    deps.onVisibility(true);
    applyLayout();
    emit('account');
    emit('choice');
    emit('plan');
    emit('local');
    void deps.garage.refresh();
    if (account()) void loadSummary();
    root.querySelector<HTMLElement>('.hub-scroll')!.scrollTop = 0;
    window.setTimeout(() => header.focusRide(), 0);
    updateActive();
    // Warm the other sections' code while the browser has nothing better to do, so switching tabs is instant.
    const idle = (window as unknown as { requestIdleCallback?: (fn: () => void) => void }).requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 600));
    idle(() => { for (const s of SECTIONS) void s.load().catch(() => {}); });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    appStageAtClose = deps.currentStageId();
    root.hidden = true;
    document.body.classList.remove('at-home', 'at-hub');
    deps.onVisibility(false);
    updateActive();
  }

  // ---------------------------------------------------- things that change ----
  onAccountChange((a: Account | null) => {
    if (a) {
      if (cache && cache.userId !== a.id) forget();
      if (isOpen) { void deps.garage.refresh(); void loadSummary(); }
    } else forget();
    if (isOpen) { emit('account'); emit('summary'); emit('wallet'); }
  });

  deps.garage.onChange(() => {
    if (!isOpen) return;
    remember();
    emit('wallet');
  });

  // Dialogs opened from the hub change things (the plan, units, workouts, routes, the kit): look again when one closes.
  document.addEventListener('close', (e) => {
    if (!isOpen || !(e.target instanceof HTMLDialogElement)) return;
    window.setTimeout(() => { if (isOpen) { emit('units'); emit('local'); emit('plan'); } }, 0);
  }, true);

  // main.ts tells the hub when the app moved under it.
  document.addEventListener('af:hub-refresh', (e) => {
    const kind = (e as CustomEvent<string>).detail;
    if (kind === 'stage' && isOpen) {
      choice = { stageId: deps.currentStageId(), workoutId: null };
      emit('choice');
      emit('local');
    } else if (kind === 'plan') {
      if (isOpen) { emit('plan'); emit('units'); emit('local'); } // also covers settings that arrived from the account
    } else if (kind === 'ride') {
      if (account()) { if (isOpen) void loadSummary(); else status = status === 'ready' ? 'ready' : 'idle'; }
    }
  });

  // Escape never strands you: with no dialog open it brings you back to the Ride button.
  window.addEventListener('keydown', (e) => {
    if (!isOpen || e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement;
    if (t.matches?.('input, textarea, select')) return;
    header.focusRide();
    root.querySelector<HTMLElement>('.hub-scroll')!.scrollTo({ top: 0 });
  });

  document.getElementById('hub-account')!.addEventListener('click', () => deps.dialogs.account());
  document.getElementById('hub-settings')!.addEventListener('click', () => deps.dialogs.settings());
  const accountBtn = document.getElementById('hub-account')!;
  const syncAccountButton = () => {
    const id = identity();
    accountBtn.textContent = `👤 ${id.name.split(' ')[0] || 'Profile'}`;
  };
  onAccountChange(syncAccountButton);
  syncAccountButton();

  return {
    open,
    close,
    isOpen: () => isOpen,
    /** The first answer from the session check. With no account the signed-in hint was stale: drop last visit's numbers (the home page takes over). */
    sessionSettled(a: Account | null) {
      if (a) return;
      forget();
      syncAccountButton();
    },
  };
}
