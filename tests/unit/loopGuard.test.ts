import { describe, expect, it } from 'vitest';
import { LoopGuard, REPORT_EVERY_MS, TOAST_AFTER_FAILURES } from '../../src/loopGuard';

function make() {
  let t = 0;
  const reports: string[] = [];
  let toasts = 0;
  const g = new LoopGuard({ report: (p, e) => reports.push(`${p}:${(e as Error).message}`), notify: () => { toasts++; } }, () => t);
  return { g, reports, toasts: () => toasts, at: (ms: number) => { t = ms; } };
}
const boom = (m = 'boom') => () => { throw new Error(m); };

describe('LoopGuard', () => {
  it('runs a part and reports success', () => {
    const { g, reports } = make();
    let ran = 0;
    expect(g.run('sim', () => { ran++; })).toBe(true);
    expect(ran).toBe(1);
    expect(reports).toEqual([]);
  });

  it('swallows an exception and says it did not run cleanly', () => {
    const { g, reports } = make();
    expect(g.run('sim', boom())).toBe(false);
    expect(reports).toEqual(['sim:boom']);
  });

  it('reports the same error at most once per interval', () => {
    const { g, reports, at } = make();
    for (let i = 0; i < 100; i++) { at(i * 16); g.run('render', boom()); }
    expect(reports).toHaveLength(1);
    at(REPORT_EVERY_MS + 1);
    g.run('render', boom());
    expect(reports).toHaveLength(2);
  });

  it('reports a different error straight away', () => {
    const { g, reports } = make();
    g.run('render', boom('a'));
    g.run('render', boom('b'));
    g.run('sim', boom('a'));
    expect(reports).toHaveLength(3);
  });

  it('toasts once after many failures in a row, and not after a recovery', () => {
    const { g, toasts } = make();
    for (let i = 0; i < TOAST_AFTER_FAILURES - 1; i++) g.run('render', boom());
    expect(toasts()).toBe(0);
    g.run('render', () => {}); // recovered: the streak starts again
    for (let i = 0; i < TOAST_AFTER_FAILURES - 1; i++) g.run('render', boom());
    expect(toasts()).toBe(0);
    g.run('render', boom());
    expect(toasts()).toBe(1);
    for (let i = 0; i < 500; i++) g.run('render', boom());
    expect(toasts()).toBe(1);
  });

  it('survives a reporter that throws', () => {
    const g = new LoopGuard({ report: () => { throw new Error('x'); }, notify: () => { throw new Error('y'); } });
    for (let i = 0; i < TOAST_AFTER_FAILURES + 1; i++) expect(g.run('sim', boom())).toBe(false);
  });
});
