import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLIPS, Commentator, RaceCommentary, clipUrl, type ClipKey, type LinePlayer, type RaceSnapshot } from '../../src/commentary';

/** A player whose clips last `len` seconds on a clock the test controls. */
function rig(len = 3) {
  let t = 100;
  let until = -1;
  const played: string[] = [];
  const player: LinePlayer = {
    play: (url) => { played.push(url); until = t + len; },
    playing: () => t < until,
  };
  const c = new Commentator(player, () => t, () => 0);
  return {
    c,
    played,
    // Frames every quarter second, as in the app, so the end of a line is noticed promptly.
    advance: (s: number) => { for (let i = 0; i < Math.round(s * 4); i++) { t += 0.25; c.tick(); } },
    player,
  };
}

describe('Commentator rate limiting', () => {
  it('speaks, then stays quiet while a line is playing and for a pause after', () => {
    const { c, played, advance } = rig(3);
    expect(c.say('attack')).toBe(true);
    advance(1);
    expect(c.say('break', 1)).toBe(false); // still talking: a nice-to-have line is dropped
    advance(3); // the line ended at +3, so we're 1 s into the 3 s pause
    expect(c.say('break', 1)).toBe(false);
    advance(3);
    expect(c.say('break', 1)).toBe(true);
    expect(played).toHaveLength(2);
  });

  it('keeps a cooldown per kind of line', () => {
    const { c, advance } = rig(2);
    expect(c.say('attack')).toBe(true);
    advance(10);
    expect(c.say('attack')).toBe(false); // attacks: 45 s apart at least
    advance(40);
    expect(c.say('attack')).toBe(true);
  });

  it('queues an important line and plays it when the current one ends, but not if it is stale', () => {
    const a = rig(4);
    a.c.say('attack');
    a.advance(1);
    expect(a.c.say('one_km', 3)).toBe(false); // queued
    a.advance(2.5);
    expect(a.played).toHaveLength(1);
    a.advance(4); // the line is over, and so is the pause
    expect(a.played).toHaveLength(2);
    expect(a.played[1]).toMatch(/one_km-/);

    const b = rig(30);
    b.c.say('attack');
    b.advance(1);
    b.c.say('one_km', 3);
    b.advance(40); // the long line ended long after the queued one went stale
    b.advance(5);
    expect(b.played).toHaveLength(1);
  });

  it('never says more than five lines in a minute, except must-hear ones', () => {
    const { c, played, advance } = rig(1);
    const keys: ClipKey[] = ['attack', 'break', 'caught', 'gap_growing', 'gap_closing', 'sprint_mid', 'kom'];
    for (const k of keys) { c.say(k, 2); advance(4.5); }
    expect(played.length).toBe(5);
    expect(c.say('start', 3)).toBe(true);
  });

  it('is silent when switched off, and never repeats a variant twice running', () => {
    const { c, played, advance } = rig(1);
    c.enabled = false;
    expect(c.say('start', 3)).toBe(false);
    c.enabled = true;
    expect(played).toHaveLength(0);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { c.say('start', 3); seen.push(played[played.length - 1]); advance(70); }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });
});

const snap = (o: Partial<RaceSnapshot> = {}): RaceSnapshot => ({
  t: 100, place: 12, total: 37, myDistance: 4000, leadDistance: 4200, finish: 20000, power: 200, ftp: 250,
  groups: [{ label: 'Bunch', size: 30, gapSec: 0, you: true }], yellowIsYou: false, tour: false, summits: [], dt: 0.2, ...o,
});

describe('RaceCommentary', () => {
  const make = () => {
    const r = rig(1);
    return { ...r, rc: new RaceCommentary(r.c), last: () => r.played[r.played.length - 1] };
  };

  it('opens the race, but not for someone joining late', () => {
    const a = make();
    a.rc.update(snap({ t: 2 }));
    expect(a.last()).toMatch(/start-/);
    const b = make();
    b.rc.update(snap({ t: 300 }));
    expect(b.played).toHaveLength(0);
  });

  it('calls the last kilometre once', () => {
    const a = make();
    a.rc.update(snap({ t: 2 })); // start
    a.advance(5);
    a.rc.update(snap({ leadDistance: 19200, myDistance: 19000 }));
    expect(a.last()).toMatch(/one_km-/);
    const n = a.played.length;
    a.advance(80);
    a.rc.update(snap({ leadDistance: 19300 }));
    expect(a.played.length).toBe(n);
  });

  it('notices when you are dropped and when you are back', () => {
    const a = make();
    a.rc.update(snap({ t: 2 }));
    a.advance(5);
    a.rc.update(snap({ t: 100, groups: [{ label: 'Bunch', size: 30, gapSec: 0, you: false }, { label: 'You', size: 1, gapSec: 40, you: true }] }));
    expect(a.last()).toMatch(/you_dropped-/);
    a.advance(30);
    a.rc.update(snap({ t: 140, groups: [{ label: 'Bunch', size: 30, gapSec: 0, you: true }] }));
    a.advance(5);
    a.rc.tick?.call(a.rc);
    expect(a.played.some((u) => /you_back-/.test(u))).toBe(true);
  });

  it('says you attack only after six seconds well over threshold', () => {
    const a = make();
    a.rc.update(snap({ t: 2 }));
    a.advance(5);
    for (let i = 0; i < 20; i++) a.rc.update(snap({ t: 100 + i * 0.2, power: 400 }));
    expect(a.played.some((u) => /you_attack-/.test(u))).toBe(false); // 4 s
    for (let i = 0; i < 20; i++) a.rc.update(snap({ t: 104 + i * 0.2, power: 400 }));
    expect(a.played.some((u) => /you_attack-/.test(u))).toBe(true);
  });

  it('maps race events and the finish to lines', () => {
    const a = make();
    a.rc.event('Hugo attacks!', 'attack');
    expect(a.last()).toMatch(/attack-/);
    a.advance(5);
    a.rc.event('The sprint for the line is on!', 'sprint');
    expect(a.last()).toMatch(/sprint_launch-/);
    a.advance(5);
    a.rc.finished(1);
    expect(a.last()).toMatch(/you_win-/);
  });
});

describe('the clips', () => {
  it('every line has an audio file, and every line is written down', () => {
    for (const [key, lines] of Object.entries(CLIPS)) {
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((text, i) => {
        expect(text.length).toBeGreaterThan(5);
        expect(existsSync(`public${clipUrl(key as ClipKey, i)}`), `${key}-${i + 1}.mp3`).toBe(true);
      });
    }
  });
  it('never names a real person or team', () => {
    const all = Object.values(CLIPS).flat().join(' ');
    expect(all).not.toMatch(/Pogacar|Vingegaard|Tadej|Jonas|Mark Cavendish|UAE|Visma|Ineos/i);
  });
});
