// The KOM segments dialog, opened from a stage's card in the hub: the stage's segments with the king of each climb and your
// best, and tapping one opens its full board (top 10 and you, this month or all time). Loaded on first use.

import { account } from './cloud/account';
import { segmentLeaderboard, type SegmentRow } from './cloud/segmentApi';
import { sharedSegmentStore } from './segmentStore';
import { boardSummary, segmentTime, segmentsFor, type Segment } from './segments';
import type { Stage } from './stages';

const KM_PER_MI = 1.609344;
const dist = (m: number, imperial: boolean) => (imperial ? `${(m / 1000 / KM_PER_MI).toFixed(1)} mi` : m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function openStageSegments(stage: Stage, imperial: boolean, openSignIn: (why: string) => void, only?: Segment) {
  const dialog = document.getElementById('segment-board') as HTMLDialogElement;
  const title = document.getElementById('sb-title')!;
  const tabs = document.getElementById('sb-tabs')!;
  const body = document.getElementById('sb-body')!;
  const foot = document.getElementById('sb-foot')!;
  const store = sharedSegmentStore();
  const segments = segmentsFor(stage);
  let range: 'month' | 'all' = 'all';
  let seq = 0;
  let current: Segment | null = null;

  const mine = (s: Segment) => store.get(s.id).best;
  const sub = (s: Segment) => `${dist(s.length, imperial)} at ${(s.avg * 100).toFixed(1)}%${s.passes > 1 ? ` · ridden every lap` : ''}`;

  /** The list: one button per segment with the king and your best. */
  async function list() {
    const mineSeq = ++seq;
    title.textContent = stage.name;
    tabs.hidden = true;
    foot.textContent = stage.uploaded
      ? 'This is your own route, so segments only keep your times on this device.'
      : 'A segment counts when you ride all of it, on any ride. Times are moving time. Demo rides never count.';
    body.replaceChildren();
    if (!segments.length) {
      body.append(el('p', 'muted small', 'No big climbs on this route.'));
      return;
    }
    const items = segments.map((s) => {
      const b = el('button', 'sb-item');
      b.type = 'button';
      const head = el('span', 'sb-name', s.name);
      const meta = el('span', 'sb-meta', sub(s));
      const king = el('span', 'sb-king', s.shared && account() ? 'Loading…' : '');
      const you = el('span', 'sb-you', mine(s) ? `Your best ${segmentTime(mine(s)!.t)}` : 'Not ridden yet');
      b.append(head, meta, king, you);
      b.addEventListener('click', () => { void board(s, true); });
      body.append(b);
      return { s, king };
    });
    if (!account()) foot.textContent = 'Sign in to see who holds the KOM.';
    await Promise.all(items.map(async ({ s, king }) => {
      if (!s.shared || !account()) return;
      try {
        const rows = await segmentLeaderboard(s.id);
        if (mineSeq !== seq) return;
        const { king: k, me } = boardSummary(rows);
        king.textContent = k ? `👑 ${k.is_me ? `${k.short_name} (you)` : k.short_name} ${segmentTime(k.elapsed_s)}` : 'Nobody has a time yet';
        if (me) (king.nextElementSibling as HTMLElement).textContent = `You: #${me.rank} of ${boardSummary(rows).riders} · ${segmentTime(me.elapsed_s)}`;
      } catch {
        king.textContent = 'Leaderboard unavailable';
      }
    }));
  }

  /** One segment's board. */
  async function board(s: Segment, fromList: boolean) {
    const mineSeq = ++seq;
    current = s;
    title.textContent = s.name;
    tabs.hidden = !s.shared || !account();
    for (const t of tabs.querySelectorAll<HTMLButtonElement>('[data-sb-range]')) t.setAttribute('aria-selected', String(t.dataset.sbRange === range));
    const back = el('button', 'link', '← All segments on this stage');
    back.type = 'button';
    back.addEventListener('click', () => { void list(); });
    const head = el('p', 'muted small', sub(s));
    body.replaceChildren(...(fromList && segments.length > 1 ? [back] : []), head);
    foot.textContent = 'Each rider’s best time up this climb. Times are moving time; efforts that look too fast to be true are left off.';
    const best = mine(s);
    const yours = el('p', 'muted small', best ? `Your best on this device: ${segmentTime(best.t)}${best.p ? ` · ${best.p} W` : ''}` : 'You haven’t ridden it yet.');
    if (!s.shared) { body.append(el('p', 'muted small', 'This is your own route, so there is no shared leaderboard, only your times.'), yours); return; }
    if (!account()) {
      body.append(yours);
      const b = el('button', 'link', 'Sign in for the leaderboard');
      b.type = 'button';
      b.addEventListener('click', () => { dialog.close(); openSignIn('Sign in (free) to see the KOM leaderboards.'); });
      body.append(b);
      return;
    }
    const loading = el('p', 'muted small', 'Loading…');
    body.append(loading);
    let rows: SegmentRow[];
    try {
      rows = await segmentLeaderboard(s.id, range === 'month' ? monthStart() : undefined);
    } catch (e) {
      if (mineSeq === seq) loading.textContent = `Couldn’t load the leaderboard: ${(e as Error).message}`;
      return;
    }
    if (mineSeq !== seq) return;
    loading.remove();
    if (!rows.length) {
      body.append(el('p', 'muted small', range === 'month' ? 'Nobody has a time on this climb this month. Ride it to take the crown!' : 'Nobody has a time on this climb yet. Ride it to set the first one!'), yours);
      return;
    }
    const table = el('table', 'lb-table');
    table.innerHTML = '<thead><tr><th>#</th><th>Rider</th><th class="num">Time</th><th class="num">Avg</th></tr></thead>';
    const tb = el('tbody');
    const leader = rows[0].elapsed_s;
    for (const r of rows) {
      const tr = el('tr', r.is_me ? 'me' : '');
      tr.innerHTML = '<td class="rank"></td><td class="who"></td><td class="num time"></td><td class="num"></td>';
      const c = tr.children;
      c[0].textContent = r.rank === 1 ? '👑' : String(r.rank);
      c[1].textContent = r.is_me ? `${r.short_name} (you)` : r.short_name;
      c[2].textContent = segmentTime(r.elapsed_s) + (r.elapsed_s > leader ? `  +${segmentTime(r.elapsed_s - leader)}` : '');
      c[3].textContent = r.avg_power ? `${Math.round(r.avg_power)} W` : '';
      tb.append(tr);
    }
    table.append(tb);
    body.append(table, yours);
  }

  for (const t of tabs.querySelectorAll<HTMLButtonElement>('[data-sb-range]')) {
    t.onclick = () => {
      range = t.dataset.sbRange as 'month' | 'all';
      if (current) void board(current, segments.length > 1);
    };
  }
  if (!dialog.open) dialog.showModal();
  if (only) void board(only, false);
  else if (segments.length === 1) void board(segments[0], false);
  else void list();
}
