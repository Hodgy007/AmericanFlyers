import { describe, expect, it } from 'vitest';
import { cleanLine, pickFresh, wordCount } from '../../src/ai/text';
import { sanitizeDebrief, sanitizePlan, sanitizeRivalLines, sanitizeRivalPost, sanitizeTip } from '../../src/ai/sanitize';
import { cannedDebrief, cannedPlan, cannedRivalLine, cannedRivalLines, cannedRivalPost, cannedTip, CANNED_TIPS } from '../../src/ai/canned';
import { SUGGESTION_IDS } from '../../src/ai/catalogue';
import { RIVALS, RIVAL_IDS, rivalById } from '../../src/ai/rivals';
import { COACH_MOMENTS, RIVAL_TRIGGERS, type PlanPayload } from '../../src/ai/types';
import { HR_DRIFT_LIMIT, MomentDetector, TIP_GAP_S, type MomentSample } from '../../src/ai/moments';
import { PlanRunner } from '../../src/ai/coachPlan';
import { LineLimiter, MIN_LINE_GAP_S, RivalTriggerEngine } from '../../src/ai/rivalTriggers';
import { DEFAULT_PARAMS, stepSpeed } from '../../src/physics';
import { RivalBot, type BotContext } from '../../src/ai/rivalBot';

describe('text helpers', () => {
  it('cleanLine keeps one clean line of at most N words', () => {
    expect(cleanLine('  Hello\n\nthere *friend* <b>x</b>  ', 10)).toBe('Hello there friend bx/b');
    expect(cleanLine('one two three four five', 3)).toBe('one two three');
    expect(cleanLine(42, 5)).toBe('');
    expect(cleanLine('x'.repeat(500), 5, 50).length).toBeLessThanOrEqual(50);
  });
  it('pickFresh avoids recent lines when it can', () => {
    expect(pickFresh(['a', 'b'], ['a'], () => 0)).toBe('b');
    expect(pickFresh(['a'], ['a'], () => 0)).toBe('a');
    expect(pickFresh([], [])).toBeUndefined();
  });
});

describe('sanitising AI replies', () => {
  it('tips are trimmed to 18 words; empty is unusable', () => {
    expect(wordCount(sanitizeTip({ text: Array(30).fill('go').join(' ') })!.text)).toBe(18);
    expect(sanitizeTip({ text: '  ' })).toBeNull();
    expect(sanitizeTip(null)).toBeNull();
  });
  it('plans keep at most 8 sorted tips, each with a place', () => {
    const tips = Array.from({ length: 12 }, (_, i) => ({ at_m: 1000 - i * 50, at_s: null, text: `Tip ${i}` }));
    const r = sanitizePlan({ tips: [...tips, { at_m: null, at_s: null, text: 'nowhere' }, { at_m: -5, at_s: null, text: 'negative' }] })!;
    expect(r.tips).toHaveLength(8);
    expect(r.tips.map((t) => t.at_m)).toEqual([...r.tips.map((t) => t.at_m)].sort((a, b) => a! - b!));
    expect(sanitizePlan({ tips: [] })).toBeNull();
    expect(sanitizePlan('nope')).toBeNull();
  });
  it('workout tips use seconds', () => {
    const r = sanitizePlan({ tips: [{ at_m: null, at_s: 600, text: 'Interval time' }] }, null)!;
    expect(r.tips[0]).toEqual({ at_m: null, at_s: 600, text: 'Interval time' });
  });
  it('debriefs need every part and a real next-session id', () => {
    const good = { headline: 'Steady and strong', summary: 'You rode well.', went_well: ['a', 'b', 'c'], work_on: ['x', 'y'], next: { id: SUGGESTION_IDS[1], why: 'Because.' } };
    const r = sanitizeDebrief(good)!;
    expect(r.went_well).toHaveLength(2);
    expect(sanitizeDebrief({ ...good, next: { id: 'nope', why: '' } })).toBeNull();
    expect(sanitizeDebrief({ ...good, went_well: [] })).toBeNull();
    expect(sanitizeDebrief(undefined)).toBeNull();
  });
  it('rival lines fill missing triggers from the canned lines and need at least half', () => {
    const half = Object.fromEntries(RIVAL_TRIGGERS.slice(0, 4).map((t) => [t, [`${t} one`]]));
    const r = sanitizeRivalLines({ lines: half }, 'frost')!;
    expect(r.lines.start).toEqual(['start one']);
    expect(r.lines.you_win).toEqual(rivalById('frost')!.canned.you_win);
    expect(sanitizeRivalLines({ lines: { start: ['x'] } }, 'frost')).toBeNull();
    expect(sanitizeRivalLines({}, 'frost')).toBeNull();
  });
  it('rival post lines are 16 words at most and the note 140 characters', () => {
    const r = sanitizeRivalPost({ line: Array(30).fill('well').join(' '), note: 'n'.repeat(400) })!;
    expect(wordCount(r.line)).toBe(16);
    expect(r.note.length).toBeLessThanOrEqual(140);
    expect(sanitizeRivalPost({ line: '' })).toBeNull();
  });
});

describe('canned fallbacks', () => {
  const stage = { id: 's', name: 'Alpe', lengthM: 14000, totalClimbM: 1000, climbs: [{ startM: 500, endM: 13000, avgPct: 8.1, gainM: 1000 }], sprints: [{ atM: 6000, name: 'Halfway' }], koms: [{ atM: 13000, name: 'The Top' }] };
  it('every coach moment has tips of 18 words or fewer', () => {
    for (const m of COACH_MOMENTS) {
      expect(CANNED_TIPS[m].length).toBeGreaterThan(0);
      for (const t of CANNED_TIPS[m]) expect(wordCount(t)).toBeLessThanOrEqual(18);
      expect(cannedTip(m)).toBeTruthy();
    }
  });
  it('a plan is built from the stage features, sorted, at most 8', () => {
    const plan = cannedPlan({ stage, mode: 'ride', workout: null });
    expect(plan.tips.length).toBeGreaterThan(2);
    expect(plan.tips.length).toBeLessThanOrEqual(8);
    expect(plan.tips.every((t) => t.at_m !== null && t.at_m <= 14000)).toBe(true);
    expect(plan.tips.map((t) => t.at_m)).toEqual([...plan.tips.map((t) => t.at_m)].sort((a, b) => a! - b!));
  });
  it('a workout plan uses seconds', () => {
    const p: PlanPayload = { stage, mode: 'workout', workout: { name: 'SS', minutes: 60, steps: [{ atS: 600, durS: 600, label: 'Interval 1/3', pctFtp: 0.9 }, { atS: 1500, durS: 300, label: 'Rest', pctFtp: 0.5 }] } };
    const plan = cannedPlan(p);
    expect(plan.tips.every((t) => t.at_m === null && t.at_s !== null)).toBe(true);
  });
  it('a debrief always suggests a real session', () => {
    const base = { title: 'x', mode: 'ride' as const, durationS: 3000, distanceKm: 20, climbedM: 100, avgW: 150, npW: 160, powerZoneS: [0, 0, 0, 0, 0, 0], hrZoneS: [0, 0, 0, 0, 0], avgHr: null, maxHr: null, avgCadence: null, tss: 50, workout: null, race: null, plan: null };
    for (const v of [base, { ...base, durationS: 900 }, { ...base, climbedM: 900 }, { ...base, workout: { name: 'w', compliancePct: 90 }, tss: 120 }, { ...base, workout: { name: 'w', compliancePct: 90 } }]) {
      expect(SUGGESTION_IDS).toContain(cannedDebrief(v).next.id);
    }
  });
  it('rivals have canned lines for every trigger, within 16 words, and kind closings', () => {
    for (const r of RIVALS) {
      for (const t of RIVAL_TRIGGERS) {
        expect(r.canned[t].length).toBeGreaterThan(0);
        for (const l of r.canned[t]) expect(wordCount(l)).toBeLessThanOrEqual(16);
      }
      for (const l of [...r.closing.won, ...r.closing.lost]) expect(wordCount(l)).toBeLessThanOrEqual(16);
      expect(cannedRivalLine(r.id, 'start')).toBeTruthy();
      expect(Object.keys(cannedRivalLines(r.id))).toHaveLength(8);
    }
    const post = cannedRivalPost({ rival: 'blaze', result: 'won', gapS: 12, stageName: 'Heartland', lengthKm: 25, moments: [], counts: true });
    expect(post.note).toMatch(/beat me/);
  });
  it('the cast is original: four rivals, unique ids, no pro-cycling names or banned words', () => {
    expect(RIVAL_IDS).toHaveLength(4);
    expect(new Set(RIVAL_IDS).size).toBe(4);
    const text = JSON.stringify(RIVALS).toLowerCase();
    for (const bad of ['pogacar', 'vingegaard', 'froome', 'contador', 'evenepoel', 'merckx', 'armstrong', 'damn', 'hell ', 'fat', 'skinny', 'ugly']) expect(text).not.toContain(bad);
  });
});

const sample = (o: Partial<MomentSample> = {}): MomentSample => ({ dt: 1, riding: true, gradePct: 0, cadence: 90, watts: 150, targetW: null, hr: 0, gapAheadM: null, drafting: false, ...o });
function run(d: MomentDetector, seconds: number, o: Partial<MomentSample>) {
  const hits = [];
  for (let i = 0; i < seconds; i++) { const h = d.update(sample(o)); if (h) hits.push(h); }
  return hits;
}

describe('coach moments', () => {
  it('low cadence on a climb after 30 s', () => {
    const d = new MomentDetector();
    expect(run(d, 29, { cadence: 52, gradePct: 7 })).toHaveLength(0);
    const hits = run(d, 2, { cadence: 52, gradePct: 7 });
    expect(hits[0]?.moment).toBe('low_cadence_climb');
  });
  it('does not fire for low cadence on the flat, or when coasting', () => {
    const d = new MomentDetector();
    expect(run(d, 120, { cadence: 50, gradePct: 0 })).toHaveLength(0);
    expect(run(d, 120, { cadence: 50, gradePct: 8, watts: 0 })).toHaveLength(0);
  });
  it('power 20% over target for 20 s in a workout', () => {
    const d = new MomentDetector();
    expect(run(d, 19, { targetW: 200, watts: 250 })).toHaveLength(0);
    expect(run(d, 2, { targetW: 200, watts: 250 })[0]?.moment).toBe('over_target');
    const e = new MomentDetector();
    expect(run(e, 60, { targetW: 200, watts: 230 })).toHaveLength(0);
  });
  it('riding close behind a rider without the draft for 10 s', () => {
    const d = new MomentDetector();
    expect(run(d, 12, { gapAheadM: 3, drafting: true })).toHaveLength(0);
    expect(run(d, 12, { gapAheadM: 3, drafting: false })[0]?.moment).toBe('no_draft');
  });
  it('heart rate drifting over 8% at steady power', () => {
    const d = new MomentDetector();
    const hits = [];
    for (let minute = 0; minute < 14; minute++) {
      const hr = 130 + minute * 2.5; // 130 -> 162
      hits.push(...run(d, 60, { watts: 200, hr }));
    }
    expect(hits[0]?.moment).toBe('hr_drift');
    expect(hits[0]?.hrDriftPct).toBeGreaterThan(HR_DRIFT_LIMIT * 100);
  });
  it('no drift tip when power changes or heart rate is flat', () => {
    const flat = new MomentDetector();
    for (let m = 0; m < 20; m++) expect(run(flat, 60, { watts: 200, hr: 140 })).toHaveLength(0);
    const varied = new MomentDetector();
    for (let m = 0; m < 14; m++) expect(run(varied, 60, { watts: 150 + m * 15, hr: 130 + m * 3 })).toHaveLength(0);
  });
  it('at most one tip every five minutes, and not the same kind twice in ten', () => {
    const d = new MomentDetector();
    expect(run(d, 31, { cadence: 50, gradePct: 8 })).toHaveLength(1);
    expect(run(d, 100, { cadence: 50, gradePct: 8 })).toHaveLength(0); // blocked by the five-minute gap
    expect(run(d, 100, { targetW: 200, watts: 260 })).toHaveLength(0);
    // after 5 minutes a different moment may speak, the same one may not yet
    run(d, TIP_GAP_S, { watts: 100 });
    expect(run(d, 40, { cadence: 50, gradePct: 8 })).toHaveLength(0);
    expect(run(d, 30, { targetW: 200, watts: 260 })).toHaveLength(1);
  });
  it('ignores paused time', () => {
    const d = new MomentDetector();
    expect(run(d, 300, { cadence: 50, gradePct: 8, riding: false })).toHaveLength(0);
  });
});

describe('ride plan runner', () => {
  const tips = [{ at_m: 500, at_s: null, text: 'a' }, { at_m: 3000, at_s: null, text: 'b' }, { at_m: null, at_s: 120, text: 'c' }];
  it('hands out each tip once as you reach it', () => {
    const r = new PlanRunner(tips);
    expect(r.due(100, null)).toBeNull();
    expect(r.due(520, null)?.text).toBe('a');
    expect(r.due(530, null)).toBeNull();
    expect(r.due(3010, null)?.text).toBe('b');
    expect(r.due(3100, 130)?.text).toBe('c');
    expect(r.remaining).toBe(0);
  });
  it('skips tips you jumped past', () => {
    const r = new PlanRunner(tips);
    expect(r.due(2900, null)).toBeNull(); // 'a' is 2.4 km behind: skipped, not read late
    expect(r.remaining).toBe(2);
  });
});

describe('rival triggers', () => {
  const st = (o = {}) => ({ gap: 4, attacking: false, remaining: 5000 as number | null, started: true, finished: null as 'rival' | 'player' | null, ...o });
  it('start once, then you_pass when you clearly overtake', () => {
    const e = new RivalTriggerEngine();
    expect(e.update(st({ started: false }))).toEqual([]);
    expect(e.update(st())).toEqual(['start']);
    expect(e.update(st({ gap: 30 }))).toEqual([]);
    expect(e.update(st({ gap: 3 }))).toEqual([]);
    expect(e.update(st({ gap: -12 }))).toEqual(['you_pass']);
    expect(e.update(st({ gap: -13 }))).toEqual([]);
  });
  it('they_attack fires on the rising edge only', () => {
    const e = new RivalTriggerEngine();
    e.update(st());
    expect(e.update(st({ attacking: true }))).toEqual(['they_attack']);
    expect(e.update(st({ attacking: true }))).toEqual([]);
    e.update(st({ attacking: false }));
    expect(e.update(st({ attacking: true }))).toEqual(['they_attack']);
  });
  it('drops fire once until the gap closes again', () => {
    const e = new RivalTriggerEngine();
    e.update(st());
    expect(e.update(st({ gap: 70 }))).toEqual(['they_drop_you']);
    expect(e.update(st({ gap: 90 }))).toEqual([]);
    e.update(st({ gap: 10 }));
    expect(e.update(st({ gap: 80 }))).toEqual(['they_drop_you']);
    const f = new RivalTriggerEngine();
    f.update(st());
    expect(f.update(st({ gap: -70 }))).toEqual(['you_drop_them']);
  });
  it('last kilometre, then the winner', () => {
    const e = new RivalTriggerEngine();
    e.update(st());
    expect(e.update(st({ remaining: 990 }))).toEqual(['last_km']);
    expect(e.update(st({ remaining: 500 }))).toEqual([]);
    expect(e.update(st({ remaining: 0, finished: 'rival' }))).toEqual(['they_win']);
    expect(e.update(st({ finished: 'player' }))).toEqual([]);
    const f = new RivalTriggerEngine();
    f.update(st());
    expect(f.update(st({ finished: 'player' }))).toEqual(['you_win']);
  });
  it('the limiter allows one ordinary line per 15 s but always lets the finish through', () => {
    const l = new LineLimiter();
    expect(l.accept('start', 0)).toBe(true);
    expect(l.accept('they_attack', 5)).toBe(false);
    expect(l.accept('they_win', 6)).toBe(true);
    expect(l.accept('you_pass', 6 + MIN_LINE_GAP_S - 1)).toBe(false);
    expect(l.accept('you_pass', 6 + MIN_LINE_GAP_S)).toBe(true);
  });
});

describe('rival bot', () => {
  const flat: BotContext = { playerDistance: 0, playerWatts: 200, playerMoving: true, finish: 5000, gradeAt: () => 0, headwindAt: () => 0, ftp: 250, massKg: 83 };
  function ride(bot: RivalBot, seconds: number, ctx: (t: number, bot: RivalBot) => Partial<BotContext>, playerSpeed = 8) {
    let pd = 0;
    const attacks: number[] = [];
    for (let t = 0; t < seconds; t++) {
      pd += playerSpeed;
      const ev = bot.update(1, { ...flat, playerDistance: pd, ...ctx(t, bot) });
      if (ev.attackStarted) attacks.push(t);
    }
    return { pd, attacks };
  }
  it('waits on the line until you move', () => {
    const bot = new RivalBot(rivalById('wattson')!, 0, 250);
    bot.update(1, { ...flat, playerMoving: false });
    expect(bot.started).toBe(false);
    expect(bot.distance).toBe(4);
    bot.update(1, flat);
    expect(bot.started).toBe(true);
  });
  it('stays close to a rider holding steady power (rubber band)', () => {
    for (const id of RIVAL_IDS) {
      const bot = new RivalBot(rivalById(id)!, 0, 250);
      let pd = 0;
      let v = 0;
      let maxGap = 0;
      for (let t = 0; t < 600; t++) {
        v = stepSpeed(v, 180, 0, 1, { ...DEFAULT_PARAMS, massKg: 83 }); // the rider, on the same physics
        pd += v;
        bot.update(1, { ...flat, finish: null, playerDistance: pd, playerWatts: 180 });
        if (t > 120) maxGap = Math.max(maxGap, Math.abs(bot.distance - pd));
      }
      expect(maxGap, id).toBeLessThan(250);
    }
  });
  it('the sprinter goes for it in the last 300 m', () => {
    const bot = new RivalBot(rivalById('blaze')!, 0, 250);
    bot.distance = 4600;
    bot.started = true;
    const { attacks } = ride(bot, 20, () => ({ playerDistance: 4600, finish: 5000 }), 0);
    expect(attacks.length).toBe(1);
    expect(bot.power).toBeGreaterThan(1.4 * 250);
  });
  it('the climber attacks once the road passes 6%, then waits out the cooldown', () => {
    const bot = new RivalBot(rivalById('frost')!, 0, 250);
    const steep = (t: number) => ({ gradeAt: () => (t > 40 ? 0.08 : 0.01), finish: null, playerWatts: 200 });
    const { attacks } = ride(bot, 120, steep, 3);
    expect(attacks[0]).toBeGreaterThanOrEqual(40);
    expect(attacks).toHaveLength(1);
  });
  it('the old fox pounces when you ease', () => {
    const bot = new RivalBot(rivalById('fenwick')!, 0, 250);
    let pd = 0;
    const attacks: number[] = [];
    for (let t = 0; t < 200; t++) {
      pd += 7;
      const watts = t < 120 ? 220 : 30; // easing off at 120 s
      const ev = bot.update(1, { ...flat, finish: null, playerDistance: pd - 5, playerWatts: watts });
      if (ev.attackStarted) attacks.push(t);
      bot.distance = Math.min(bot.distance, pd + 3); // keep him on the wheel for the test
    }
    expect(attacks.some((t) => t >= 120)).toBe(true);
    expect(attacks.some((t) => t < 100)).toBe(false);
  });
  it('the time triallist never attacks', () => {
    const bot = new RivalBot(rivalById('wattson')!, 0, 250);
    const { attacks } = ride(bot, 600, (t) => ({ gradeAt: () => 0.08, finish: null, playerWatts: t % 60 < 10 ? 400 : 180 }), 3);
    expect(attacks).toHaveLength(0);
  });
  it('reports who won, with the gap', () => {
    const bot = new RivalBot(rivalById('blaze')!, 0, 250);
    bot.crossedAt = 1000;
    expect(bot.result({ playerDistance: 5000, finish: 5000, playerFinishS: 990 })).toEqual({ won: true, gapS: 10 });
    expect(bot.result({ playerDistance: 5000, finish: 5000, playerFinishS: 1030 })).toEqual({ won: false, gapS: 30 });
    const behind = new RivalBot(rivalById('blaze')!, 0, 250);
    behind.distance = 4900;
    behind.speed = 10;
    const r = behind.result({ playerDistance: 5000, finish: 5000, playerFinishS: 500 });
    expect(r.won).toBe(true);
    expect(r.gapS).toBeCloseTo(10, 0);
    expect(behind.result({ playerDistance: 3000, finish: null, playerFinishS: null }).won).toBe(false);
  });
  it('shows up on the road as an other rider with a name tag and speech', () => {
    const bot = new RivalBot(rivalById('frost')!, 100, 250);
    const r = bot.asRider('Breathe.');
    expect(r).toMatchObject({ id: 'ai-rival', speech: 'Breathe.', jersey: '#dff3ff' });
    expect(r.tag).toContain('Sasha Frost');
    expect(bot.asRider(null).speech).toBeUndefined();
  });
});
