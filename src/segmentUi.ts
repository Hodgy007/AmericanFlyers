// The KOM panel and the segment timing that feeds it. While a KOM segment (segments.ts) is within 2 km the panel
// shows its name, length and grade, the top 5 on the shared board and your best; on the segment it shows how far
// ahead or behind you are, live, against your best and your last attempt; at the top a toast gives the result.
// Times are kept in segmentStore.ts (this browser) and, for built-in stages, in the account (cloud/segmentApi.ts).

import { account } from './cloud/account';
import { flushPendingEfforts, myEfforts, saveSegmentEffort, segmentLeaderboard, type SegmentRow } from './cloud/segmentApi';
import { PREVIEW_RANGE } from './climb';
import { sharedSegmentStore, type SegmentStore } from './segmentStore';
import {
  SegmentTracker, distanceAt, gapSeconds, gapText, judgeEffort, resultText, segmentStatus, segmentTime, segmentsFor,
  type Effort, type Segment,
} from './segments';
import type { Stage } from './stages';
import { layoutCards, registerCard } from './cardDock';

export interface SegmentUiDeps {
  stage(): Stage;
  toast(msg: string, ms?: number): void;
  /** Whether this ride may count on the shared boards: no demo slider and a normal clock (rideIntegrity.ts). */
  eligible(): boolean;
  /** `?komtest`: a demo or sped-up ride still counts for your own times on this device (it is never sent), for tests. */
  testing: boolean;
  store?: SegmentStore;
}

interface Board {
  state: 'loading' | 'ready' | 'error';
  rows: SegmentRow[];
  at: number;
}

const KM_PER_MI = 1.609344;
const dist = (m: number, imperial: boolean) => {
  if (imperial) return `${(m / 1000 / KM_PER_MI).toFixed(m < 1600 ? 2 : 1)} mi`;
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
};
const pct = (g: number) => `${(g * 100).toFixed(1)}%`;
const TOP_ROWS = 5;
const RETRY_AFTER = 60_000; // a failed board is tried again after this long
const RESULT_WAIT = 2500; // how long the result toast waits for your rank

export function initSegmentUi(els: { card: HTMLElement; climbCard: HTMLElement }, deps: SegmentUiDeps) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const title = $('kom-title');
  const sub = $('kom-sub');
  const gap = $('kom-gap');
  const gapMain = $('kom-gap-main');
  const gapText1 = $('kom-gap-text');
  const gapLast = $('kom-gap-last');
  const list = $('kom-board');
  const note = $('kom-note');
  const me = $('kom-me');
  const rows = Array.from({ length: TOP_ROWS }, () => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="k-rank"></span><span class="k-name"></span><span class="k-time"></span>';
    list.append(li);
    return li;
  });

  const store = deps.store ?? sharedSegmentStore();
  const tracker = new SegmentTracker({ finish: (seg, pass, effort) => { void finished(seg, pass, effort); } });
  const boards = new Map<string, Board>();
  let version = 0; // bumped when a board arrives, so the rows are redrawn
  let stage: Stage | null = null;
  let segments: Segment[] = [];
  let shown = false;
  let drawnKey = '';
  let lastSecond = -1;
  const cache = new Map<HTMLElement, string>();
  const dock = registerCard('kom', els.card, $('kom-toggle') as HTMLButtonElement, 250);
  let sign = '';
  let seen = ''; // the segment, its state and the sign of the live gap: a change opens the card for a few seconds

  const set = (el: HTMLElement, text: string) => {
    if (cache.get(el) !== text) { cache.set(el, text); el.textContent = text; }
  };

  function load(seg: Segment) {
    const hit = boards.get(seg.id);
    if (hit && (hit.state !== 'error' || performance.now() - hit.at < RETRY_AFTER)) return;
    const board: Board = { state: 'loading', rows: [], at: performance.now() };
    boards.set(seg.id, board);
    if (!account()) { board.state = 'ready'; return; }
    flushPendingEfforts().catch(() => {}); // anything waiting from an earlier ride goes first
    // Your own best and latest from the account, for a new device.
    myEfforts(seg.id).then((m) => { if (store.merge(seg.id, m.best, m.last)) version++; }).catch(() => {});
    if (!seg.shared) { board.state = 'ready'; return; }
    segmentLeaderboard(seg.id)
      .then((r) => { board.rows = r; board.state = 'ready'; version++; })
      .catch(() => { board.state = 'error'; board.at = performance.now(); version++; });
  }

  function hide() {
    if (shown) { els.card.hidden = true; shown = false; drawnKey = ''; lastSecond = -1; seen = ''; dock.gone(); }
  }

  function drawBoard(seg: Segment, board: Board | undefined) {
    const mine = board?.rows.find((r) => r.is_me);
    const best = store.get(seg.id).best;
    const top = board?.state === 'ready' && seg.shared ? board.rows.slice(0, TOP_ROWS) : [];
    rows.forEach((li, i) => {
      const r = top[i];
      li.hidden = !r;
      if (!r) return;
      li.className = r.is_me ? 'me' : '';
      li.children[0].textContent = r.rank === 1 ? '👑' : String(r.rank);
      li.children[1].textContent = r.is_me ? `${r.short_name} (you)` : r.short_name;
      li.children[2].textContent = segmentTime(r.elapsed_s);
    });
    list.hidden = !top.length;
    let msg = '';
    if (!account()) msg = 'Sign in for the leaderboard';
    else if (!seg.shared) msg = 'Your own times on this route';
    else if (!board || board.state === 'loading') msg = 'Loading the leaderboard…';
    else if (board.state === 'error') msg = 'Leaderboard unavailable';
    else if (!board.rows.length) msg = 'Nobody has a time yet. Set the first one!';
    note.textContent = msg;
    note.hidden = !msg;
    if (mine) me.textContent = `You: #${mine.rank}${mine.rank <= 1 ? ' 👑' : ''} · ${segmentTime(mine.elapsed_s)}`;
    else if (best) me.textContent = `Your best ${segmentTime(best.t)}`;
    else me.textContent = 'No time yet: yours to set';
  }

  function drawGap(seg: Segment) {
    const live = tracker.live;
    const rec = store.get(seg.id);
    if (!live) {
      gap.hidden = false;
      set(gapMain, '--');
      set(gapText1, 'Not timed: start at the line to set a time');
      set(gapLast, '');
      gap.dataset.state = 'none';
      return;
    }
    const sec = Math.floor(live.elapsed);
    if (sec === lastSecond) return; // once a second: calm, no flicker
    lastSecond = sec;
    gap.hidden = false;
    const best = rec.best;
    if (!best) {
      set(gapMain, segmentTime(live.elapsed));
      set(gapText1, 'First attempt: set your time');
      set(gapLast, '');
      gap.dataset.state = 'first';
      return;
    }
    const g = gapSeconds(best, seg.length, live.x, live.elapsed);
    set(gapMain, gapText(g));
    set(gapText1, `vs your best ${segmentTime(best.t)}`);
    gap.dataset.state = Math.abs(g) < 0.5 ? 'level' : g < 0 ? 'ahead' : 'behind';
    const last = rec.last;
    if (last && last.at !== best.at) {
      const gl = gapSeconds(last, seg.length, live.x, live.elapsed);
      set(gapLast, `${gapText(gl)} vs your last`);
      gapLast.dataset.state = Math.abs(gl) < 0.5 ? 'level' : gl < 0 ? 'ahead' : 'behind';
    } else set(gapLast, '');
  }

  async function finished(seg: Segment, pass: number, effort: Effort) {
    const counts = deps.eligible() || deps.testing;
    if (!counts) {
      deps.toast(`${seg.name} — ${segmentTime(effort.t)} · Demo ride, not saved`, 6000);
      return;
    }
    const { previousBest } = store.record(seg.id, effort);
    const verdict = judgeEffort(effort, previousBest);
    boards.delete(seg.id);
    version++;
    lastSecond = -1;
    let rank: number | null = null;
    let riders: number | null = null;
    if (seg.shared && account()) {
      const work = (async () => {
        if (deps.eligible()) await saveSegmentEffort(seg.stageId, seg.id, effort);
        const board = await segmentLeaderboard(seg.id);
        const mine = board.find((r) => r.is_me);
        if (mine) { rank = mine.rank; riders = mine.riders ?? null; }
      })().catch(() => {});
      await Promise.race([work, new Promise((r) => setTimeout(r, RESULT_WAIT))]);
    }
    const lap = seg.passes > 1 ? ` (lap ${pass + 1})` : '';
    deps.toast(resultText(seg.name + lap, effort, verdict, rank, riders), 9000);
  }

  return {
    /** Every frame: times the ride through the segments. `riding` is false while stopped, on the start line or finished. */
    frame(distance: number, movingTime: number, work: number, riding: boolean) {
      tracker.update(distance, movingTime, work, riding);
    },

    /** A new stage or a new ride: forget any effort in progress and the boards fetched. */
    reset() {
      tracker.reset();
      boards.clear();
      lastSecond = -1;
      const s = deps.stage();
      if (s !== stage) { stage = s; segments = segmentsFor(s); tracker.setSegments(segments); }
      hide();
    },

    /** A ghost of your best effort on the segment you are on, for the road: metres along the stage and its speed, or null. */
    ghost(): { distance: number; speedMs: number } | null {
      const live = tracker.live;
      if (!live) return null;
      const best = store.get(live.segment.id).best;
      if (!best || live.elapsed >= best.t) return null;
      const start = live.segment.start + live.pass * (live.segment.lap ?? 0);
      const here = distanceAt(best, live.segment.length, live.elapsed);
      return { distance: start + here, speedMs: Math.max(0, distanceAt(best, live.segment.length, live.elapsed + 0.5) - distanceAt(best, live.segment.length, live.elapsed - 0.5)) };
    },

    /** A few times a second. */
    update(distance: number, enabled: boolean, riding: boolean, imperial: boolean) {
      const s = deps.stage();
      if (s !== stage) { stage = s; segments = segmentsFor(s); tracker.setSegments(segments); boards.clear(); }
      const status = enabled && riding && segments.length ? segmentStatus(segments, distance, PREVIEW_RANGE) : null;
      if (!status) return hide();
      const seg = status.segment;
      load(seg);
      const board = boards.get(seg.id);
      const key = `${seg.id}|${status.state}|${version}|${board?.state}|${account() ? 1 : 0}`;
      if (key !== drawnKey) {
        drawnKey = key;
        set(title, seg.passes > 1 ? `${seg.name} · lap ${status.pass + 1}` : seg.name);
        drawBoard(seg, board);
        els.card.dataset.state = status.state;
      }
      if (status.state === 'ahead') {
        set(sub, `Starts in ${dist(status.toStart, imperial)} · ${dist(seg.length, imperial)} at ${pct(seg.avg)}`);
        gap.hidden = true;
      } else {
        const live = tracker.live;
        set(sub, live ? `${segmentTime(live.elapsed)} · ${dist(Math.max(0, seg.length - live.x), imperial)} to go` : `${dist(seg.length, imperial)} at ${pct(seg.avg)}`);
        drawGap(seg);
      }
      if (!shown) { els.card.hidden = false; shown = true; }
      const g = gap.dataset.state;
      if (status.state !== 'on') sign = '';
      else if (g === 'ahead' || g === 'behind') sign = g; // "level" is not a flip: no flicker while you hover around zero
      const now = `${seg.id}|${status.state}|${sign}`;
      if (now !== seen) { seen = now; dock.notify(); }
      layoutCards(); // docks the card at the edge, under the climb card on a phone
    },
  };
}
