// The 🏆 leaderboard for the current stage: everyone's fastest whole-stage
// ride (this week or all time), with a button to race any of them as a ghost.

import { account } from './cloud/account';
import { stageLeaderboard, type LeaderboardRow } from './cloud/sync';
import { raceTime } from './ghost';
import type { Stage } from './stages';

interface Options {
  stage: () => Stage;
  race: (row: LeaderboardRow) => void;
  clearGhost: () => void;
  ghostName: () => string | null;
  openSignIn: (why: string) => void;
}

function weekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

export function initLeaderboardUi(o: Options) {
  const dialog = document.getElementById('leaderboard') as HTMLDialogElement;
  const body = document.getElementById('lb-body')!;
  const title = document.getElementById('lb-title')!;
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-lb-range]')];
  const ghostNote = document.getElementById('lb-ghost')!;
  let range: 'week' | 'all' = 'week';
  let seq = 0;

  async function render() {
    const stage = o.stage();
    title.textContent = `${stage.name}`;
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.lbRange === range));
    const g = o.ghostName();
    ghostNote.replaceChildren(g ? `Racing: ${g}. ` : 'No ghost. ');
    if (g) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.textContent = 'Ride without a ghost';
      b.addEventListener('click', () => { o.clearGhost(); render(); });
      ghostNote.append(b);
    }
    if (stage.finish === null) {
      body.replaceChildren(p('This stage has no finish line, so there’s no leaderboard. Pick a climb or Route 66 to race the clock.'));
      return;
    }
    body.replaceChildren(p('Loading…'));
    const mine = ++seq;
    let rows: LeaderboardRow[];
    try {
      rows = await stageLeaderboard(stage.id, range === 'week' ? weekStart() : undefined);
    } catch (e) {
      if (mine === seq) body.replaceChildren(p(`Couldn’t load the leaderboard: ${(e as Error).message}`));
      return;
    }
    if (mine !== seq) return;
    if (!rows.length) {
      body.replaceChildren(p(range === 'week'
        ? 'Nobody has finished this stage this week. Ride it from the start line to the finish to top the board!'
        : 'Nobody has finished this stage yet. Ride it from the start line to the finish to be first!'));
      return;
    }
    const table = document.createElement('table');
    table.className = 'lb-table';
    table.innerHTML = '<thead><tr><th>#</th><th>Rider</th><th class="num">Time</th><th class="num">Avg</th><th></th></tr></thead>';
    const tb = document.createElement('tbody');
    const leader = rows[0].finish_s;
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.is_me) tr.className = 'me';
      const gap = r.finish_s - leader;
      tr.innerHTML = '<td class="rank"></td><td class="who"></td><td class="num time"></td><td class="num"></td><td></td>';
      const c = tr.children;
      c[0].textContent = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : String(r.rank);
      c[1].textContent = r.is_me ? `${r.name} (you)` : r.name;
      c[2].textContent = raceTime(r.finish_s) + (gap > 0 ? `  +${raceTime(gap)}` : '');
      c[3].textContent = r.avg_power ? `${Math.round(r.avg_power)} W` : '';
      const race = document.createElement('button');
      race.type = 'button';
      race.textContent = 'Race';
      race.title = `Race ${r.is_me ? 'your' : `${r.name}’s`} ghost from the start line`;
      race.addEventListener('click', () => { dialog.close(); o.race(r); });
      c[4].append(race);
      tb.append(tr);
    }
    table.append(tb);
    body.replaceChildren(table, p('Whole-stage rides only: start on the start line and ride to the finish. Times are moving time.'));
  }

  function p(text: string) {
    const el = document.createElement('p');
    el.className = 'muted small';
    el.textContent = text;
    return el;
  }

  for (const t of tabs) t.addEventListener('click', () => { range = t.dataset.lbRange as 'week' | 'all'; render(); });
  document.getElementById('btn-leaderboard')!.addEventListener('click', () => {
    if (!account()) {
      o.openSignIn('Sign in (free) to see the leaderboards and race other riders’ ghosts.');
      return;
    }
    dialog.showModal();
    render();
  });

  return { open: () => document.getElementById('btn-leaderboard')!.click() };
}
