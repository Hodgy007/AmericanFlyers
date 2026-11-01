// The 🗓 Events dialog (☰ Menu): upcoming group rides and races with countdowns and
// Join, the results of races that have finished, the lobby bar shown while you wait
// on the start line, and the combined results table for the finish card.

import { account } from './cloud/account';
import { eventResults, serverNow, upcomingEvents, type EventRow, type EventResultRow } from './cloud/events';
import type { MergedResult } from './eventSession';
import { raceTime } from './ghost';
import { TEAMS } from './peloton';
import { RACE_MINUTES, RIDE_MINUTES, countdownLabel, dailySchedule, joinState, type EventKind } from './schedule';

const el = (id: string) => document.getElementById(id)!;

interface Options {
  /** Joins an event: switches to its stage and waits on the line. */
  join: (ev: EventRow) => void;
  stageName: (stageId: string) => string;
  openSignIn: (why: string) => void;
  /** The event you are in, if any (its row is marked). */
  currentEventId: () => string | null;
}

const icon = (kind: EventKind) => (kind === 'race' ? '🏁' : '🚴');
const durationMin = (kind: EventKind) => (kind === 'race' ? RACE_MINUTES : RIDE_MINUTES);

function when(startsAt: number) {
  const d = new Date(startsAt);
  const day = d.toDateString() === new Date(serverNow()).toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function initEventsUi(o: Options) {
  const dialog = el('events') as HTMLDialogElement;
  const list = el('events-list');
  const note = el('events-note');
  let tick = 0;
  let seq = 0;
  let rows: EventRow[] = [];
  let signedIn = false;

  const p = (text: string, cls = 'muted small') => Object.assign(document.createElement('p'), { className: cls, textContent: text });

  async function render() {
    signedIn = !!account();
    const mine = ++seq;
    note.textContent = signedIn
      ? 'A race every evening and a steady group ride at midday, plus one-off events. Times are shown in your time zone. Everyone who joins a race sees the same computer-ridden field.'
      : 'Sign in (free) to join. This is the daily schedule; times are shown in your time zone.';
    list.replaceChildren(p('Loading…'));
    try {
      rows = signedIn
        ? await upcomingEvents(48)
        : dailySchedule(serverNow(), 48).map((e, i) => ({
          id: `sched-${i}`, kind: e.kind, stage_id: e.stageId, title: e.title, starts_at: new Date(e.startsAt).toISOString(), seed: 0,
          pace_wkg: e.paceWkg, duration_min: durationMin(e.kind), waiting: 0, results: 0, my_finish_s: null,
        }));
    } catch (e) {
      if (mine === seq) list.replaceChildren(p(`Couldn’t load events: ${(e as Error).message}`));
      return;
    }
    if (mine !== seq) return;
    draw();
  }

  function draw() {
    if (!rows.length) { list.replaceChildren(p('Nothing is scheduled just now. Check back soon.')); return; }
    const now = serverNow();
    const upcoming: HTMLElement[] = [];
    const past: HTMLElement[] = [];
    for (const ev of rows) {
      const start = new Date(ev.starts_at).getTime();
      const over = now > start + ev.duration_min * 60000;
      (over ? past : upcoming).push(card(ev, start, over));
    }
    const out: Node[] = [];
    if (upcoming.length) out.push(...upcoming);
    if (past.length) out.push(Object.assign(document.createElement('h3'), { className: 'riders-sub', textContent: 'Finished' }), ...past.reverse());
    list.replaceChildren(...out);
  }

  function card(ev: EventRow, start: number, over: boolean) {
    const now = serverNow();
    const box = document.createElement('div');
    box.className = 'event-card';
    box.dataset.start = String(start);
    const head = document.createElement('div');
    head.className = 'event-head';
    const title = document.createElement('strong');
    title.textContent = `${icon(ev.kind)} ${ev.title}`;
    const sub = document.createElement('span');
    sub.className = 'event-sub';
    sub.textContent = `${when(start)} · ${o.stageName(ev.stage_id)}${ev.kind === 'group_ride' && ev.pace_wkg ? ` · ${ev.pace_wkg} W/kg pace` : ''}`;
    head.append(title, sub);
    const status = document.createElement('span');
    status.className = 'event-count';
    status.textContent = over ? (ev.kind === 'race' ? `${ev.results} finisher${ev.results === 1 ? '' : 's'}` : 'finished') : countdownLabel(start - now);
    const actions = document.createElement('div');
    actions.className = 'event-actions';
    if (ev.waiting > 0 && !over) status.textContent += ` · ${ev.waiting} on the line`;

    if (!over) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'primary';
      const st = joinState(ev.kind, start, now);
      if (o.currentEventId() === ev.id) { b.textContent = 'You’re in'; b.disabled = true; }
      else if (!signedIn) { b.textContent = 'Sign in to join'; b.addEventListener('click', () => o.openSignIn('Sign in (free) to join group rides and races.')); }
      else if (st === 'early') { b.textContent = 'Opens an hour before'; b.disabled = true; }
      else if (st === 'late') { b.textContent = 'Started too long ago'; b.disabled = true; }
      else b.addEventListener('click', () => { dialog.close(); o.join(ev); });
      if (b.textContent === '') b.textContent = start > now ? 'Join the lobby' : 'Join now';
      if (b.disabled) b.className = 'event-wait'; // a status, not a call to action: plain, not red
      actions.append(b);
    } else if (ev.kind === 'race' && signedIn && ev.results > 0) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Results';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const res = await eventResults(ev.id);
          box.querySelector('.event-results')?.remove();
          box.append(resultsTable(res));
        } catch (e) {
          box.append(p(`Couldn’t load results: ${(e as Error).message}`));
        }
        b.disabled = false;
      });
      actions.append(b);
    }
    if (ev.my_finish_s) actions.prepend(Object.assign(document.createElement('span'), { className: 'event-mine', textContent: `Your time ${raceTime(ev.my_finish_s)}` }));
    box.append(head, status, actions);
    return box;
  }

  function resultsTable(res: EventResultRow[]) {
    const wrap = document.createElement('div');
    wrap.className = 'event-results';
    if (!res.length) { wrap.append(p('No results yet.')); return wrap; }
    const t = document.createElement('table');
    t.className = 'lb-table';
    t.innerHTML = '<thead><tr><th>#</th><th>Rider</th><th class="num">Time</th><th class="num">Avg</th></tr></thead>';
    const tb = document.createElement('tbody');
    const lead = res[0].finish_s;
    for (const r of res) {
      const tr = document.createElement('tr');
      if (r.is_me) tr.className = 'me';
      tr.innerHTML = '<td class="rank"></td><td class="who"></td><td class="num time"></td><td class="num"></td>';
      tr.children[0].textContent = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : String(r.rank);
      tr.children[1].textContent = r.is_me ? `${r.name} (you)` : r.name;
      tr.children[2].textContent = raceTime(r.finish_s) + (r.finish_s > lead ? `  +${raceTime(r.finish_s - lead)}` : '');
      tr.children[3].textContent = r.avg_power ? `${Math.round(r.avg_power)} W` : '';
      tb.append(tr);
    }
    t.append(tb);
    wrap.append(t);
    return wrap;
  }

  el('btn-events').addEventListener('click', () => {
    dialog.showModal();
    render();
    window.clearInterval(tick);
    // Countdowns tick every second; the list itself refreshes every 30 s.
    let n = 0;
    tick = window.setInterval(() => {
      if (!dialog.open) { window.clearInterval(tick); return; }
      if (++n % 30 === 0) { render(); return; }
      const now = serverNow();
      for (const c of list.querySelectorAll<HTMLElement>('.event-card')) {
        const start = Number(c.dataset.start);
        const s = c.querySelector('.event-count');
        const ev = rows.find((r) => new Date(r.starts_at).getTime() === start);
        if (s && ev && now <= start + ev.duration_min * 60000) s.textContent = countdownLabel(start - now) + (ev.waiting > 0 ? ` · ${ev.waiting} on the line` : '');
      }
    }, 1000);
  });
  dialog.addEventListener('close', () => window.clearInterval(tick));

  return { open: () => el('btn-events').click() };
}

// ------------------------------------------------------------- lobby bar ----

/** The strip at the top while you are in an event: the lobby countdown, then how the group ride is going. */
export function initEventBar(onLeave: () => void) {
  const bar = el('event-bar');
  el('eb-leave').addEventListener('click', onLeave);
  return {
    show(title: string, status: string) {
      bar.hidden = false;
      el('eb-title').textContent = title;
      el('eb-status').textContent = status;
    },
    hide() {
      bar.hidden = true;
    },
  };
}

// ---------------------------------------------------------- finish card ----

/** The finish card's table for a scheduled race: real riders and the computer field, merged by time. */
export function eventResultsNode(rows: MergedResult[], realCount: number): HTMLElement {
  const box = document.createElement('div');
  box.className = 'event-finish';
  const h = document.createElement('h3');
  h.className = 'riders-sub';
  h.textContent = `Event results · ${realCount} real rider${realCount === 1 ? '' : 's'} so far`;
  box.append(h);
  const t = document.createElement('table');
  t.className = 'lb-table';
  t.innerHTML = '<thead><tr><th>#</th><th>Rider</th><th class="num">Time</th></tr></thead>';
  const tb = document.createElement('tbody');
  const lead = rows[0]?.time ?? 0;
  // The top 12, then you if you are lower down.
  const shown = rows.slice(0, 12);
  const me = rows.findIndex((r) => r.kind === 'you');
  const idx = shown.map((_, i) => i);
  if (me >= 12) idx.push(me);
  for (const i of idx) {
    const r = rows[i];
    const tr = document.createElement('tr');
    if (r.kind === 'you') tr.className = 'me';
    tr.innerHTML = '<td class="rank"></td><td class="who"></td><td class="num time"></td>';
    tr.children[0].textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1);
    const who = tr.children[1] as HTMLElement;
    if (r.kind === 'bot' && r.team >= 0) {
      const dot = document.createElement('i');
      dot.className = 'team-dot';
      dot.style.background = TEAMS[r.team].color;
      who.append(dot, ` ${r.name}`);
    } else who.textContent = r.kind === 'real' ? `🚴 ${r.name}` : r.name;
    tr.children[2].textContent = raceTime(r.time) + (r.time > lead ? `  +${raceTime(r.time - lead)}` : '');
    tb.append(tr);
  }
  t.append(tb);
  box.append(t);
  return box;
}
