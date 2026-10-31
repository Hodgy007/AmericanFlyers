import { describe, expect, it } from 'vitest';
import { PLANS, complete, nextSession, planById, sessions, type PlanProgress } from '../../src/plans';
import { BUILTIN_WORKOUTS } from '../../src/workouts/model';
import { stageById } from '../../src/stages';

describe('plans', () => {
  it('every session points at a real built-in workout or stage', () => {
    const workouts = new Set(BUILTIN_WORKOUTS.map((w) => w.id));
    for (const plan of PLANS) {
      expect(sessions(plan).length).toBeGreaterThan(0);
      for (const s of sessions(plan)) {
        expect(!!s.workout !== !!s.stage, `${plan.id}: ${s.title} has exactly one target`).toBe(true);
        if (s.workout) expect(workouts.has(s.workout), `${plan.id}: ${s.workout}`).toBe(true);
        if (s.stage) expect(stageById(s.stage).id, `${plan.id}: ${s.stage}`).toBe(s.stage);
      }
    }
  });

  it('plan ids are unique and planById finds them', () => {
    const ids = PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(planById(ids[0])?.id).toBe(ids[0]);
    expect(planById('nope')).toBeNull();
    expect(planById(undefined)).toBeNull();
  });

  it('sessions() numbers the weeks from 1 in order', () => {
    const plan = PLANS[0];
    const all = sessions(plan);
    expect(all[0].week).toBe(1);
    expect(all[all.length - 1].week).toBe(plan.weeks.length);
    for (let i = 1; i < all.length; i++) expect(all[i].week).toBeGreaterThanOrEqual(all[i - 1].week);
  });

  it('nextSession walks the plan and ends with null', () => {
    const plan = PLANS[0];
    const all = sessions(plan);
    let progress: PlanProgress = { id: plan.id, started: '2026-01-01', done: [] };
    expect(nextSession(plan, progress)?.index).toBe(0);
    progress = { ...progress, done: [0, 1] };
    expect(nextSession(plan, progress)?.index).toBe(2);
    progress = { ...progress, done: all.map((_, i) => i) };
    expect(nextSession(plan, progress)).toBeNull();
  });

  it('complete() ticks off the first matching undone session, and only once each', () => {
    const plan = PLANS[0];
    const first = sessions(plan)[0];
    const p0: PlanProgress = { id: plan.id, started: '2026-01-01', done: [] };
    const p1 = complete(plan, p0, { workout: first.workout, stage: first.stage })!;
    expect(p1.done).toEqual([0]);
    expect(p0.done).toEqual([]); // not mutated
    expect(complete(plan, p0, { workout: 'builtin-does-not-exist' })).toBeNull();
    // A workout that appears twice in the plan is ticked off one session at a time.
    const dup = sessions(plan).map((s, i) => ({ s, i })).filter((x) => x.s.workout === 'builtin-endurance-45');
    if (dup.length > 1) {
      const a = complete(plan, p0, { workout: 'builtin-endurance-45' })!;
      const b = complete(plan, a, { workout: 'builtin-endurance-45' })!;
      expect(b.done).toEqual([dup[0].i, dup[1].i].sort((x, y) => x - y));
    }
  });
});
