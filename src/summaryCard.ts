// The finish and summary card (the `#finish` element in index.html): the flag, title, figures, extra blocks, note and buttons.
// `createSummaryCard()` owns the one piece of state, the version counter, and builds the card from plain data (what it says is
// worked out in src/summaryContent.ts). The state changes around a finish and the saving of the ride stay in main.ts, which reads
// `version()` to tell whether a save finished after the card was replaced. Tested with jsdom in tests/unit/summaryCard.test.ts.
import { HR_ZONES, POWER_ZONES, zoneBars } from './zones';
import type { RideStats } from './stats';
import type { SummaryAction, SummaryItem } from './summaryContent';

export interface SummaryCardDeps {
  /** The card's "Back to the hub": the ride is over, so no questions asked. */
  backToHub(): void;
  /** The rider's FTP and max heart rate, read when the zone bars are drawn (main.ts replaces its settings object, so a function). */
  zones(): { ftp: number; maxHr: number };
}

export interface SummaryCard {
  /** Shows the card with this flag, title, figures, buttons (then "Back to the hub") and extra blocks. Clears the note. */
  show(flag: string, title: string, items: SummaryItem[], actions: SummaryAction[], extra?: Node[]): void;
  /** Bumped by every `show()`: a save finishing after the card was replaced doesn't write into the new one. */
  version(): number;
  /** Puts a block at the top of the extra blocks (a late arrival: the AI's note, the ghost line). */
  prependExtra(node: Node): void;
  /** Puts a one-line note (a `<p>` with this class, such as 'finish-ghost') at the top of the extra blocks. */
  prependNote(className: string, text: string): void;
  /** Replaces the title (the card is up). */
  setTitle(text: string): void;
  /** Marks the card as a race's (its own styling). */
  setRace(on: boolean): void;
  /** Heart-rate and power zone breakdowns for a ride summary. */
  zoneSections(st: RideStats): Node[];
}

export function createSummaryCard(deps: SummaryCardDeps): SummaryCard {
  const $ = (id: string) => document.getElementById(id)!;
  let version = 0;

  const backToHubButton = () => {
    const b = document.createElement('button');
    b.textContent = '🏠 Back to the hub';
    b.addEventListener('click', () => { $('finish').hidden = true; deps.backToHub(); });
    return b;
  };

  return {
    show(flag, title, items, actions, extra = []) {
      version++;
      $('finish').querySelector('.finish-card')!.classList.toggle('wide', extra.length > 0);
      $('finish-extra').replaceChildren(...extra);
      $('finish-note').textContent = '';
      $('finish').querySelector('.finish-flag')!.textContent = flag;
      $('finish-title').textContent = title;
      const statsEl = $('finish-stats');
      statsEl.replaceChildren(...items.map(([k, v]) => {
        const d = document.createElement('div');
        d.innerHTML = '<span></span><strong></strong>';
        d.querySelector('span')!.textContent = k;
        d.querySelector('strong')!.textContent = v;
        return d;
      }));
      $('finish-actions').replaceChildren(...actions.map((a) => {
        const b = document.createElement('button');
        b.textContent = a.label;
        if (a.primary) b.className = 'primary';
        b.addEventListener('click', () => { $('finish').hidden = true; a.onClick(); });
        return b;
      }), backToHubButton());
      $('finish').hidden = false;
    },
    version: () => version,
    prependExtra: (node) => $('finish-extra').prepend(node),
    prependNote: (className, text) => $('finish-extra').prepend(Object.assign(document.createElement('p'), { className, textContent: text })),
    setTitle: (text) => { $('finish-title').textContent = text; },
    setRace: (on) => { $('finish').querySelector('.finish-card')!.classList.toggle('race', on); },
    zoneSections(st) {
      const z = deps.zones();
      return [
        zoneBars('Heart-rate zones', HR_ZONES, st.hrZones, { ref: z.maxHr, unit: 'bpm' }),
        zoneBars('Power zones', POWER_ZONES, st.powerZones, { ref: z.ftp, unit: 'W' }),
      ];
    },
  };
}
