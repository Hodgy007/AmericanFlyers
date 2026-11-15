// @vitest-environment jsdom
// The finish and summary card's DOM (src/summaryCard.ts), on the same markup as index.html: the flag, title, figures, extra blocks,
// the buttons (and the hub button after them), the version counter and the late additions.
import { beforeEach, describe, expect, it } from 'vitest';
import { createSummaryCard } from '../../src/summaryCard';
import { RideStats } from '../../src/stats';

const html = `<div id="finish" class="finish" hidden><div class="finish-card"><div class="finish-flag">🏁</div><h2 id="finish-title">Finished!</h2>
<div id="finish-stats" class="finish-stats"></div><div id="finish-extra"></div><p id="finish-note" class="finish-note"></p>
<div id="finish-actions" class="dialog-actions"></div></div></div>`;
const $ = (id: string) => document.getElementById(id)!;

function rig() {
  const log: string[] = [];
  const card = createSummaryCard({ backToHub: () => log.push('hub'), zones: () => ({ ftp: 250, maxHr: 190 }) });
  return { card, log };
}

describe('the summary card', () => {
  beforeEach(() => { document.body.innerHTML = html; });

  it('fills the flag, title and figures, and shows the card', () => {
    const { card } = rig();
    card.show('🚴', 'Ride summary', [['Time', '1:00'], ['Avg power', '200 W']], []);
    expect($('finish').hidden).toBe(false);
    expect($('finish').querySelector('.finish-flag')!.textContent).toBe('🚴');
    expect($('finish-title').textContent).toBe('Ride summary');
    expect([...$('finish-stats').children].map((d) => d.innerHTML)).toEqual(['<span>Time</span><strong>1:00</strong>', '<span>Avg power</span><strong>200 W</strong>']);
  });

  it('puts the buttons first and then Back to the hub; the primary one has its class', () => {
    const { card } = rig();
    card.show('🏁', 'T', [], [{ label: 'Keep riding', onClick: () => {} }, { label: 'Again', primary: true, onClick: () => {} }]);
    const buttons = [...$('finish-actions').querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Keep riding', 'Again', '🏠 Back to the hub']);
    expect(buttons.map((b) => b.className)).toEqual(['', 'primary', '']);
  });

  it('a button closes the card, then runs its action', () => {
    const { card } = rig();
    const seen: boolean[] = [];
    card.show('🏁', 'T', [], [{ label: 'Go', onClick: () => seen.push($('finish').hidden) }]);
    ($('finish-actions').querySelector('button') as HTMLButtonElement).click();
    expect(seen).toEqual([true]);
  });

  it('Back to the hub closes the card and goes to the hub', () => {
    const { card, log } = rig();
    card.show('🏁', 'T', [], []);
    ($('finish-actions').querySelector('button') as HTMLButtonElement).click();
    expect($('finish').hidden).toBe(true);
    expect(log).toEqual(['hub']);
  });

  it('is wide only with extra blocks, and showing again clears the note and the old extras', () => {
    const { card } = rig();
    const extra = document.createElement('section');
    card.show('🏁', 'T', [], [], [extra]);
    expect($('finish').querySelector('.finish-card')!.classList.contains('wide')).toBe(true);
    expect($('finish-extra').contains(extra)).toBe(true);
    $('finish-note').textContent = 'Saving to your rides…';
    card.show('🏁', 'T2', [], []);
    expect($('finish').querySelector('.finish-card')!.classList.contains('wide')).toBe(false);
    expect($('finish-extra').children.length).toBe(0);
    expect($('finish-note').textContent).toBe('');
  });

  it('every show() bumps the version', () => {
    const { card } = rig();
    const v = card.version();
    card.show('🏁', 'T', [], []);
    card.show('🏁', 'T', [], []);
    expect(card.version()).toBe(v + 2);
  });

  it('late additions: notes and blocks go to the top, the title can change, the race class toggles', () => {
    const { card } = rig();
    const block = document.createElement('section');
    card.show('🏁', 'T', [], [], [block]);
    card.prependNote('finish-ghost off-board', 'ℹ️ Not on the board');
    card.prependExtra(Object.assign(document.createElement('div'), { id: 'ai-note' }));
    expect([...$('finish-extra').children].map((c) => c.id || c.className)).toEqual(['ai-note', 'finish-ghost off-board', '']);
    expect($('finish-extra').children[1].textContent).toBe('ℹ️ Not on the board');
    card.setTitle('New title');
    expect($('finish-title').textContent).toBe('New title');
    card.setRace(true);
    expect($('finish').querySelector('.finish-card')!.classList.contains('race')).toBe(true);
    card.setRace(false);
    expect($('finish').querySelector('.finish-card')!.classList.contains('race')).toBe(false);
  });

  it('draws the heart-rate and power zone bars', () => {
    const { card } = rig();
    const sections = card.zoneSections(new RideStats(() => ({ ftp: 250, maxHr: 190 })));
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain('Heart-rate zones');
    expect(sections[1].textContent).toContain('Power zones');
  });
});
