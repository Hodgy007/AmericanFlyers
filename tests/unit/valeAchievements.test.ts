// The "ride every Kestrel Vale route" badge (src/cloud/achievements.ts): earned by finishing every route of the world that has a finish line, the list taken
// from the stages themselves; and not taken away when a route is added later (achievements are worked out afresh from the saved rides every time).
import { afterEach, describe, expect, it } from 'vitest';
import { achievements } from '../../src/cloud/achievements';
import type { Activity } from '../../src/cloud/sync';
import { STAGES } from '../../src/stages';
import { KESTREL_ROUTE_DEFS, KESTREL_ROUTES } from '../../src/worlds/kestrelVale';

const NAME = 'Vale Explorer';
const finishing = KESTREL_ROUTES.filter((s) => s.finish !== null).map((s) => s.id);
const day = (n: number) => new Date(Date.UTC(2026, 10, n, 10)).toISOString();
const ride = (stage: string, d: number, finished = true): Activity => ({ id: `${stage}-${d}`, started_at: day(d), title: 'ride', stage_id: stage, stage_name: stage, finished } as Activity);
const badge = (acts: Activity[]) => achievements(acts, [], 70).find((a) => a.name === NAME)!;

describe('Vale Explorer', () => {
  it('asks for every Kestrel Vale route with a finish line, taken from the world’s own routes (the free ride has none)', () => {
    expect(finishing).toEqual(['kestrel-vale-loop', 'kestrel-vale-grand', 'kestrel-vale-raven-scar', 'kestrel-vale-lakeside']);
    expect(finishing).toEqual(KESTREL_ROUTE_DEFS.filter((r) => r.laps !== null).map((r) => r.id));
    expect(badge([]).detail).toBe('0 / 4 routes');
  });

  it('is earned only when every one of them is finished, by the ride that finishes the last', () => {
    const acts = finishing.map((id, i) => ride(id, i + 1));
    for (let n = 0; n < finishing.length; n++) expect(badge(acts.slice(0, n)).done, `${n} routes`).toBe(false);
    expect(badge(acts.slice(0, 3))).toMatchObject({ done: false, progress: 0.75, detail: '3 / 4 routes' });
    const full = badge(acts);
    expect(full).toMatchObject({ done: true, progress: 1 });
    expect(full.detail).toBe(`Earned ${new Date(day(4)).toLocaleDateString()}`);
  });

  it('counts only finished rides of the world’s routes, in any order, as often as they are ridden', () => {
    const unfinished = finishing.map((id, i) => ride(id, i + 1, false));
    expect(badge(unfinished).done).toBe(false);
    expect(badge([...unfinished, ride('kestrel-vale', 5), ride('route66', 6), ride('alpe-dhuez', 7), ride(finishing[0], 8)]).detail).toBe('1 / 4 routes');
    const shuffled = [finishing[2], finishing[0], finishing[3], finishing[0], finishing[1]].map((id, i) => ride(id, i + 1));
    expect(badge(shuffled).done).toBe(true);
    expect(badge(shuffled.reverse()).done, 'order of the list does not matter, only the dates').toBe(true);
  });

  describe('when a route is added later', () => {
    const original = [...STAGES];
    afterEach(() => { STAGES.length = 0; STAGES.push(...original); });
    /** A pretend sixth route, added to the world on 20 November 2026. */
    const addRoute = (since: string | undefined) => {
      const base = KESTREL_ROUTES.find((s) => s.id === 'kestrel-vale-lakeside')!;
      STAGES.push({ ...base, id: 'kestrel-vale-new', world: { ...base.world!, route: 'kestrel-vale-new', since } });
    };
    const all = finishing.map((id, i) => ride(id, i + 1)); // everything finished by 4 November

    it('does not take the badge away from a rider who had earned it before the route existed', () => {
      expect(badge(all).done).toBe(true);
      addRoute('2026-11-20');
      const after = badge(all);
      expect(after.done).toBe(true);
      expect(after.detail).toBe(`Earned ${new Date(day(4)).toLocaleDateString()}`);
    });

    it('asks a rider who had not yet finished them all for the new route as well, once it exists', () => {
      addRoute('2026-11-20');
      const some = finishing.slice(0, 3).map((id, i) => ride(id, i + 1));
      expect(badge([...some, ride(finishing[3], 25)])).toMatchObject({ done: false, detail: '4 / 5 routes' });
      expect(badge([...some, ride(finishing[3], 25), ride('kestrel-vale-new', 26)]).done).toBe(true);
      // Finishing the last old route before the new one existed is enough, however long ago.
      expect(badge([...some, ride(finishing[3], 15)]).done).toBe(true);
    });

    it('a route with no `since` counts for everybody from the start: so a route added after the badge must say when it is from', () => {
      addRoute(undefined);
      expect(badge(all).done, 'this is the silent un-earning the `since` date exists to prevent').toBe(false);
    });
  });

  it('every Kestrel Vale route that is not one of the launch routes says when it was added', () => {
    // The routes the badge launched with. A route added later needs `since: 'YYYY-MM-DD'` (WorldRoute.since), or riders who earned the badge lose it.
    const LAUNCH = ['kestrel-vale', 'kestrel-vale-loop', 'kestrel-vale-grand', 'kestrel-vale-raven-scar', 'kestrel-vale-lakeside'];
    for (const s of KESTREL_ROUTES) {
      if (LAUNCH.includes(s.id)) expect(s.world!.since, s.id).toBeUndefined();
      else expect(s.world!.since, `${s.id}: new routes need a since date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
