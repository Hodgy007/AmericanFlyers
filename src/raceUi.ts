// The race's screens: the 3-2-1 countdown, the small live race panel, and the
// result tables (stage, general classification, points, mountains).

import { TEAMS } from './peloton';
import type { PanelData, ResultRow } from './race';
import { raceTime } from './ghost';
import { JERSEY_NAMES, jerseyHolders, standings, type Jersey, type TourProgress, type TourRow } from './tour';

const el = (id: string) => document.getElementById(id)!;

export function gapText(sec: number) {
  const s = Math.round(sec);
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function distText(m: number, imperial: boolean) {
  if (imperial) return m < 1000 ? `${Math.round(m * 3.28084)} ft` : `${(m / 1609.344).toFixed(1)} mi`;
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

// ---------------------------------------------------------- live panel ----

export function initRaceUi() {
  const panel = el('race-panel');
  const count = el('race-count');
  let countShown = '';
  return {
    /** Draws the 3-2-1 (or GO!) in the middle of the screen; null hides it. */
    countdown(text: string | null) {
      if (text === countShown) return;
      countShown = text ?? '';
      count.hidden = !text;
      count.textContent = text ?? '';
      count.classList.remove('pulse');
      void count.offsetWidth; // restart the animation
      if (text) count.classList.add('pulse');
    },
    /** The live panel; null hides it. */
    panel(d: PanelData | null, imperial: boolean) {
      panel.hidden = !d;
      if (!d) return;
      el('rp-place').textContent = `${d.place}`;
      el('rp-total').textContent = `/ ${d.total}`;
      el('rp-gap').textContent = d.place === 1 ? 'Leading' : `${gapText(d.gapSec)} to ${d.leader}`;
      el('rp-time').textContent = raceTime(d.raceTime);
      el('rp-groups').replaceChildren(...d.groups.map((g) => {
        const row = document.createElement('div');
        row.className = 'rp-group' + (g.you ? ' you' : '');
        const gap = g.gapSec < 1 ? 'on the road' : gapText(g.gapSec);
        row.innerHTML = '<span></span><em></em><b></b>';
        row.children[0].textContent = g.you && g.label !== 'You' ? `${g.label} · you` : g.label;
        row.children[1].textContent = `${g.size} rider${g.size === 1 ? '' : 's'}`;
        row.children[2].textContent = gap;
        return row;
      }));
      const next = el('rp-next');
      next.hidden = !d.next;
      if (d.next) next.textContent = `${d.next.text} in ${distText(d.next.toGo, imperial)}`;
      const names = el('rp-jerseys');
      names.replaceChildren(...(['yellow', 'green', 'polka'] as Jersey[]).map((j) => {
        const who = d.jerseys[j];
        const row = document.createElement('div');
        row.className = 'rp-jersey' + (who === 'You' ? ' you' : '');
        row.innerHTML = '<i class="jersey-dot"></i><span></span>';
        (row.firstChild as HTMLElement).classList.add(j);
        row.title = JERSEY_NAMES[j];
        row.lastElementChild!.textContent = who ?? '–';
        return row;
      }));
      const msg = el('rp-msg');
      msg.hidden = !d.message;
      msg.textContent = d.message ?? '';
    },
  };
}

// -------------------------------------------------------------- results ----

type Tab = 'stage' | 'gc' | 'points' | 'mountains';

const dot = (team: number) => {
  const i = document.createElement('i');
  i.className = 'team-dot';
  if (team >= 0) i.style.background = TEAMS[team].color;
  else i.classList.add('me');
  return i;
};

function table(head: string[], rows: { cells: (string | Node)[]; you: boolean }[]) {
  const t = document.createElement('table');
  t.className = 'rr-table';
  const thead = t.createTHead().insertRow();
  head.forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (i > 1) th.className = 'num'; thead.append(th); });
  const body = t.createTBody();
  rows.forEach((r) => {
    const tr = body.insertRow();
    if (r.you) tr.className = 'you';
    r.cells.forEach((c, i) => {
      const td = tr.insertCell();
      if (i > 1) td.className = 'num';
      if (typeof c === 'string') td.textContent = c;
      else td.append(c);
    });
  });
  return t;
}

/** Top 20, then a gap and you if you are further down. */
function pick<T extends { you: boolean }>(sorted: T[], n = 20): { row: T; pos: number; gapBefore: boolean }[] {
  const out = sorted.slice(0, n).map((row, i) => ({ row, pos: i + 1, gapBefore: false }));
  const me = sorted.findIndex((r) => r.you);
  if (me >= n) out.push({ row: sorted[me], pos: me + 1, gapBefore: me > n });
  return out;
}

function riderCell(name: string, team: number, jerseys: Jersey[]) {
  const span = document.createElement('span');
  span.className = 'rr-rider';
  span.append(dot(team));
  const n = document.createElement('span');
  n.textContent = name;
  span.append(n);
  for (const j of jerseys) {
    const d = document.createElement('i');
    d.className = `jersey-dot ${j}`;
    d.title = JERSEY_NAMES[j];
    span.append(d);
  }
  return span;
}

/**
 * The finish card's tables. `stage` is today's result; with a tour, the general,
 * points and mountains tabs are the running totals, with jersey dots on the leaders.
 */
export function resultsNode(stage: ResultRow[] | null, tour: TourProgress | null): HTMLElement {
  const root = document.createElement('div');
  root.className = 'race-results';
  const tabs = document.createElement('div');
  tabs.className = 'rr-tabs';
  const body = document.createElement('div');
  const labels: [Tab, string][] = tour
    ? [...(stage ? [['stage', 'Stage'] as [Tab, string]] : []), ['gc', 'General'], ['points', 'Points'], ['mountains', 'Mountains']]
    : [['stage', 'Result'], ['points', 'Points'], ['mountains', 'Mountains']];

  const stageTab = (by: 'time' | 'sprint' | 'kom') => {
    const sorted = [...(stage ?? [])].sort((a, b) => (by === 'time' ? a.time - b.time : b[by] - a[by] || a.time - b.time));
    const lead = sorted[0];
    return table(
      by === 'time' ? ['#', 'Rider', 'Time'] : ['#', 'Rider', 'Pts'],
      pick(sorted).map(({ row, pos, gapBefore }) => ({
        you: row.you,
        cells: [gapBefore ? `… ${pos}` : String(pos), riderCell(row.name, row.team, []),
          by === 'time' ? (pos === 1 ? raceTime(row.time) : gapText(row.time - lead.time)) : String(row[by])],
      })),
    );
  };
  const tourTab = (kind: 'gc' | 'points' | 'mountains') => {
    const s = standings(tour!);
    const sorted: TourRow[] = s[kind === 'gc' ? 'gc' : kind];
    const holders = jerseyHolders(tour);
    const jerseysOf = (id: string): Jersey[] => (['yellow', 'green', 'polka'] as Jersey[]).filter((j) => holders[j]?.id === id);
    const lead = sorted[0];
    return table(
      kind === 'gc' ? ['#', 'Rider', 'Total'] : ['#', 'Rider', 'Pts'],
      pick(sorted).map(({ row, pos, gapBefore }) => ({
        you: row.you,
        cells: [gapBefore ? `… ${pos}` : String(pos), riderCell(row.name, row.team, jerseysOf(row.id)),
          kind === 'gc' ? (pos === 1 ? raceTime(row.time) : gapText(row.time - lead.time)) : String(kind === 'points' ? row.sprint : row.kom)],
      })),
    );
  };

  const show = (tab: Tab) => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    let t: HTMLElement;
    if (tab === 'stage') t = stageTab('time');
    else if (!tour) t = stageTab(tab === 'points' ? 'sprint' : 'kom');
    else t = tourTab(tab === 'gc' ? 'gc' : tab);
    const wrap = document.createElement('div');
    wrap.className = 'rr-scroll';
    wrap.append(t);
    body.replaceChildren(wrap);
  };
  for (const [tab, label] of labels) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tab = tab;
    b.textContent = label;
    b.addEventListener('click', () => show(tab));
    tabs.append(b);
  }
  root.append(tabs, body);
  show(stage ? 'stage' : 'gc');
  return root;
}
