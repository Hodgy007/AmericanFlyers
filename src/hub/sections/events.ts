// Hub → Next event: the next scheduled race and group ride, with a live countdown and Join. The
// schedule is the same one the Events dialog shows (the daily schedule is known without signing
// in; signed-in riders get the server's rows, with who is waiting on the line).

import { account } from '../../cloud/account';
import { serverNow, upcomingEvents, type EventRow } from '../../cloud/events';
import { stageById } from '../../routes/library';
import { countdownLabel, joinState } from '../../schedule';
import { nextEvents, scheduleRows } from '../data';
import { button, h } from '../dom';
import type { SectionMount } from '../types';

const REFETCH_MS = 60_000;

function whenText(startMs: number, nowMs: number) {
  const d = new Date(startMs);
  const day = d.toDateString() === new Date(nowMs).toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export const mount: SectionMount = (root, ctx) => {
  let rows: EventRow[] = scheduleRows(serverNow());
  let fetchedAt = 0;
  let timer = 0;
  let active = false;
  let busy = '';

  const list = h('div', { class: 'hub-grid hub-events' });
  const all = button('Open the events list', () => ctx.deps.dialogs.events(), '', { 'data-fkey': 'all-events', title: 'Every upcoming event, and the results of races that have finished' });
  root.replaceChildren(list, h('div', { class: 'hub-actions' }, all));

  const counts: { el: HTMLElement; ev: EventRow }[] = [];
  const joins: { el: HTMLButtonElement; ev: EventRow }[] = [];

  function joinLabel(ev: EventRow, now: number): { text: string; disabled: boolean } {
    const start = new Date(ev.starts_at).getTime();
    if (busy === ev.id) return { text: 'Joining…', disabled: true };
    if (!account()) return { text: 'Sign in to join', disabled: false };
    const st = joinState(ev.kind, start, now);
    if (st === 'early') return { text: 'Opens an hour before', disabled: true };
    if (st === 'late') return { text: 'Started too long ago', disabled: true };
    return { text: start > now ? 'Join the lobby' : 'Join now', disabled: false };
  }

  function card(ev: EventRow, now: number): HTMLElement {
    const start = new Date(ev.starts_at).getTime();
    const count = h('strong', { class: 'hub-event-count', text: countdownLabel(start - now) });
    const label = joinLabel(ev, now);
    const join = h('button', { type: 'button', class: label.disabled ? 'hub-event-wait' : 'primary', 'data-fkey': `join-${ev.kind}`, text: label.text });
    join.disabled = label.disabled;
    join.addEventListener('click', async () => {
      if (!account()) { ctx.deps.openSignIn('Sign in (free) to join group rides and races.'); return; }
      busy = ev.id;
      draw();
      try { await ctx.deps.joinEvent(ev); } finally { busy = ''; draw(); }
    });
    counts.push({ el: count, ev });
    joins.push({ el: join, ev });
    const waiting = ev.waiting > 0 ? h('span', { class: 'hub-chip', text: `${ev.waiting} on the line` }) : null;
    return h('article', { class: `hub-card hub-event ${ev.kind}` },
      h('div', { class: 'hub-card-body' },
        h('p', { class: 'hub-eyebrow' }, h('span', { class: 'stripe' }), ev.kind === 'race' ? 'Next race' : 'Next group ride'),
        h('h3', { text: `${ev.kind === 'race' ? '🏁' : '🚴'} ${ev.title}` }),
        h('p', { class: 'hub-meta', text: `${whenText(start, now)} · ${stageById(ev.stage_id).name}${ev.kind === 'group_ride' && ev.pace_wkg ? ` · ${ev.pace_wkg} W/kg pace` : ''}` }),
        count,
        h('div', { class: 'hub-card-foot' }, join, waiting),
      ));
  }

  function draw() {
    counts.length = 0;
    joins.length = 0;
    const now = serverNow();
    const next = nextEvents(rows, now);
    const cards = [next.race, next.groupRide].filter((e): e is EventRow => !!e).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    list.replaceChildren(...(cards.length ? cards.map((e) => card(e, now)) : [h('p', { class: 'hub-note', text: 'Nothing is scheduled just now. Check back soon.' })]));
  }

  /** Once a second: the countdowns and which Join buttons are open. */
  function tick() {
    const now = serverNow();
    for (const c of counts) c.el.textContent = countdownLabel(new Date(c.ev.starts_at).getTime() - now);
    for (const j of joins) {
      const l = joinLabel(j.ev, now);
      if (j.el.textContent !== l.text) {
        j.el.textContent = l.text;
        j.el.disabled = l.disabled;
        j.el.className = l.disabled ? 'hub-event-wait' : 'primary';
      }
    }
    // The next event may have moved on (it started and the window closed): look again.
    const next = nextEvents(rows, now);
    const shown = new Set(counts.map((c) => c.ev.id));
    const wanted = [next.race, next.groupRide].filter((e): e is EventRow => !!e).map((e) => e.id);
    if (wanted.length !== shown.size || wanted.some((id) => !shown.has(id))) draw();
    if (account() && Date.now() - fetchedAt > REFETCH_MS) void fetchRows();
  }

  async function fetchRows() {
    fetchedAt = Date.now(); // one try a minute, even if it fails
    if (!account()) { rows = scheduleRows(serverNow()); draw(); return; }
    try {
      const got = await upcomingEvents(48);
      if (got.length) rows = got;
    } catch {
      // keep the schedule we have: it is the same one, without the "on the line" counts
    }
    if (active) draw();
  }

  function start() {
    window.clearInterval(timer);
    draw();
    void fetchRows();
    timer = window.setInterval(() => { if (!document.hidden) tick(); }, 1000);
  }

  draw();
  return {
    refresh(topic) {
      if (topic === 'account') { rows = scheduleRows(serverNow()); fetchedAt = 0; draw(); if (active) void fetchRows(); }
    },
    setActive(a) {
      active = a;
      if (a) start();
      else window.clearInterval(timer);
    },
    dispose: () => window.clearInterval(timer),
  };
};
