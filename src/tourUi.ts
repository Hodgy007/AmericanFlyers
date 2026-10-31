// The Hell of the West tour dialog: the three stages, where you stand, the
// jerseys, and the buttons to race (or simulate) the next stage.

import { raceTime } from './ghost';
import { gapText, resultsNode } from './raceUi';
import { stageById } from './stages';
import {
  JERSEY_NAMES, TOUR_STAGE_IDS, getTour, jerseyHolders, quitTour, startTour, tourComplete, type Jersey, type TourProgress,
} from './tour';

interface Options {
  /** Starts a race on tour stage `n` (1–3). */
  race: (n: number) => void;
  /** Simulates tour stage `n` instead of riding it; returns when the result is saved. */
  simulate: (n: number) => void;
  imperial: () => boolean;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function initTourUi(o: Options) {
  const dialog = document.getElementById('tour') as HTMLDialogElement;
  const stagesEl = document.getElementById('tour-stages')!;
  const jerseysEl = document.getElementById('tour-jerseys')!;
  const standingsEl = document.getElementById('tour-standings')!;
  const actionsEl = document.getElementById('tour-actions')!;
  const intro = document.getElementById('tour-intro')!;

  function button(label: string, onClick: () => void, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    const tour: TourProgress | null = getTour();
    const imperial = o.imperial();
    const done = tourComplete(tour);
    intro.textContent = !tour
      ? 'Race the three stages of American Flyers in order: the Morgul-Bismark circuit near Boulder, the Tour of the Moon through Colorado National Monument, and the climb to Echo Lake. Every stage is a race against the same twelve pro teams. Your total time decides the yellow jersey; sprint points the green; mountain points the polka dots.'
      : done
        ? 'The tour is finished. Here is how the classifications ended.'
        : `Stage ${tour.stage + 1} is next. The field is the same for all three stages.`;

    stagesEl.replaceChildren(...TOUR_STAGE_IDS.map((id, i) => {
      const stage = stageById(id);
      const li = document.createElement('li');
      const result = tour?.results.find((r) => r.stage === id);
      const mine = result?.rows.find((r) => r[0] === 'me');
      const rank = result && mine ? [...result.rows].sort((a, b) => a[1] - b[1]).findIndex((r) => r[0] === 'me') + 1 : 0;
      const isNext = !!tour && !done && tour.stage === i;
      li.className = 'tour-stage' + (isNext ? ' next' : '') + (result ? ' done' : '');
      const km = (stage.finish ?? 0) / 1000;
      const dist = imperial ? `${(km / 1.609344).toFixed(1)} mi` : `${km.toFixed(1)} km`;
      const status = result && mine
        ? `${ordinal(rank)} · ${raceTime(mine[1])}${rank > 1 ? ` (${gapText(mine[1] - Math.min(...result.rows.map((r) => r[1])))})` : ''}`
        : isNext ? 'Next' : tour ? 'To come' : '';
      li.innerHTML = '<span class="ts-num"></span><span class="ts-main"><strong></strong><small></small></span><span class="ts-status"></span>';
      li.querySelector('.ts-num')!.textContent = result ? '✓' : String(i + 1);
      li.querySelector('strong')!.textContent = stage.name.replace('Hell of the West · ', '');
      li.querySelector('small')!.textContent = `${dist} · ${stage.tagline}`;
      li.querySelector('.ts-status')!.textContent = status;
      return li;
    }));

    // Jerseys: who wears them now.
    const holders = jerseyHolders(tour);
    jerseysEl.replaceChildren(...(['yellow', 'green', 'polka'] as Jersey[]).map((j) => {
      const row = document.createElement('div');
      row.className = 'tour-jersey' + (holders[j]?.you ? ' you' : '');
      row.innerHTML = '<i class="jersey-dot"></i><span><small></small><b></b></span>';
      (row.firstChild as HTMLElement).classList.add(j);
      row.querySelector('small')!.textContent = JERSEY_NAMES[j];
      row.querySelector('b')!.textContent = holders[j]?.name ?? '–';
      return row;
    }));
    jerseysEl.hidden = !tour || !tour.results.length;

    standingsEl.replaceChildren();
    if (tour && tour.results.length) standingsEl.append(resultsNode(null, tour));

    actionsEl.replaceChildren();
    if (!tour || done) {
      actionsEl.append(button(done ? 'Start a new tour' : 'Start the tour', () => { startTour(); render(); o.race(1); dialog.close(); }, 'primary'));
    } else {
      const n = tour.stage + 1;
      actionsEl.append(
        button(`Race stage ${n}`, () => { dialog.close(); o.race(n); }, 'primary'),
        button('Simulate it', () => { o.simulate(n); render(); }),
        button('Restart the tour', () => { if (confirm('Throw away this tour and start again?')) { quitTour(); render(); } }, 'danger'),
      );
    }
    actionsEl.append(button('Close', () => dialog.close()));
  }

  return {
    open() {
      render();
      if (!dialog.open) dialog.showModal();
    },
    refresh: render,
  };
}
