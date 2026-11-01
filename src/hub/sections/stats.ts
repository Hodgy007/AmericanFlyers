// Hub → Stats: this week and the last four weeks (distance, time, climbing, TSS), FTP and its
// history, the weekly distance for two months, and your last few rides (each opens the existing
// ride detail in your profile). Signed-out riders get a way in instead.

import { raceTime } from '../../ghost';
import { pickWorkout, climbText, distanceText, durationShort, durationText, type Summary, type Totals } from '../data';
import { allStages } from '../../routes/library';
import { RAMP_TEST_ID } from '../../workouts/model';
import { button, h, skeleton } from '../dom';
import type { SectionMount } from '../types';

const NS = 'http://www.w3.org/2000/svg';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const shortDate = (d: string | number | Date) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function tile(label: string, value: string, sub?: string) {
  return h('div', { class: 'hub-kpi' }, h('span', { text: label }), h('strong', { text: value }), sub ? h('small', { text: sub }) : null);
}

function totalsBlock(title: string, t: Totals, imp: boolean) {
  return h('section', { class: 'hub-stat-block', 'aria-label': title },
    h('h3', { class: 'hub-sub', text: title }),
    h('div', { class: 'hub-kpis' },
      tile('Distance', distanceText(t.distanceM, imp, t.distanceM >= 100000 ? 0 : 1)),
      tile('Time', durationShort(t.timeS)),
      tile('Climbing', climbText(t.climbedM, imp)),
      tile('TSS', t.tss === null ? '--' : fmt(t.tss), t.tss === null ? 'needs power data' : undefined),
      tile('Rides', fmt(t.rides)),
    ));
}

/** A small step line of FTP over time. */
function sparkline(points: { t: number; w: number }[]): SVGElement | null {
  if (points.length < 2) return null;
  const W = 300, H = 64, P = 6;
  const t0 = points[0].t, t1 = Math.max(Date.now(), points[points.length - 1].t);
  const lo = Math.min(...points.map((p) => p.w)) - 10, hi = Math.max(...points.map((p) => p.w)) + 10;
  const x = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (w: number) => H - P - ((w - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
  let d = `M${x(points[0].t)},${y(points[0].w)}`;
  for (const p of points.slice(1)) d += `H${x(p.t)}V${y(p.w)}`;
  d += `H${x(t1)}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'hub-spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `FTP history: ${points[0].w} W to ${points[points.length - 1].w} W`);
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#4c8df6');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function weeklyBars(weekly: Summary['weekly'], imp: boolean) {
  const max = Math.max(1, ...weekly.map((w) => w.distanceM));
  return h('ol', { class: 'hub-weeks', 'aria-label': 'Distance per week, the last eight weeks' },
    ...weekly.map((w, i) => {
      const col = h('li', { title: `Week of ${shortDate(w.start)}: ${distanceText(w.distanceM, imp)}` },
        h('span', { class: 'hub-week-bar' }, h('i')),
        h('span', { class: 'hub-week-label', text: i === weekly.length - 1 ? 'Now' : shortDate(w.start) }),
        h('span', { class: 'hub-sr', text: `Week of ${shortDate(w.start)}: ${distanceText(w.distanceM, imp)}` }),
      );
      (col.querySelector('i') as HTMLElement).style.height = `${Math.max(w.distanceM > 0 ? 4 : 0, Math.round((w.distanceM / max) * 100))}%`;
      return col;
    }));
}

export const mount: SectionMount = (root, ctx) => {
  function render() {
    if (!ctx.signedIn()) {
      root.replaceChildren(h('div', { class: 'hub-signin-card' }, h('div', {},
        h('h3', { text: 'See how your riding is going' }),
        h('p', { class: 'hub-desc', text: 'Sign in (it’s free) and every ride you save adds to your weekly totals, your best times and your FTP history.' }),
        button('Sign in to see your stats', () => ctx.deps.openSignIn('Sign in to save your rides and see your stats.'), 'primary', { 'data-fkey': 'signin' }),
      )));
      return;
    }
    const sum = ctx.summary();
    const imp = ctx.imperial();
    if (!sum) {
      if (ctx.summaryStatus() === 'error') {
        root.replaceChildren(h('p', { class: 'hub-note', text: 'Couldn’t load your rides just now.' }), button('Try again', () => ctx.reloadSummary(), '', { 'data-fkey': 'retry' }));
        return;
      }
      root.replaceChildren(h('div', { class: 'hub-stats-grid', 'aria-hidden': 'true' }, skeleton('hub-sk-card'), skeleton('hub-sk-card'), skeleton('hub-sk-card')));
      return;
    }

    const ftp = sum.ftp;
    const s = ctx.deps.settings();
    const ftpBlock = h('section', { class: 'hub-stat-block hub-ftp', 'aria-label': 'FTP' },
      h('h3', { class: 'hub-sub', text: 'FTP' }),
      h('div', { class: 'hub-ftp-main' },
        h('div', { class: 'hub-bignum' }, h('strong', { text: String(s.ftp) }), h('span', { text: `W · ${(s.ftp / s.riderKg).toFixed(2)} W/kg` })),
        ftp.first !== null && ftp.points.length > 1 ? h('p', { class: 'hub-meta', text: `${ftp.change >= 0 ? '+' : ''}${s.ftp - ftp.first} W since ${shortDate(ftp.points[0].t)}` }) : h('p', { class: 'hub-meta', text: 'Take the ramp test to track how it changes.' }),
      ),
      sparkline(ftp.points),
      button('Take the ramp test', () => ctx.pick(pickWorkout(ctx.choice(), RAMP_TEST_ID, allStages())), '', { 'data-fkey': 'ramp', title: 'Choose the Ramp FTP Test as what Ride starts' }),
    );

    const recent = sum.recent.length
      ? h('ul', { class: 'hub-rides' }, ...sum.recent.map((r) => h('li', {}, h('button', { type: 'button', class: 'hub-ride-row', 'data-fkey': `ride-${r.id}`, 'aria-label': `Open ride: ${r.title}, ${new Date(r.startedAt).toLocaleDateString()}` },
          h('span', { class: 'hub-ride-date', text: new Date(r.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) }),
          h('strong', { text: r.title }),
          h('span', { class: 'hub-ride-stats', text: [durationText(r.durationS), distanceText(r.distanceM, imp), r.avgPower ? `${r.avgPower} W` : '', r.finished ? '🏁' : ''].filter(Boolean).join(' · ') }),
        )))
      )
      : h('p', { class: 'hub-note', text: 'No rides saved yet. Rides save when you finish a stage or workout, or end a ride of a minute or more.' });
    recent.querySelectorAll?.('button').forEach((b, i) => b.addEventListener('click', () => ctx.deps.openProfile('activities', sum.recent[i].id)));

    const bestEntries = Object.entries(sum.bests);
    root.replaceChildren(
      h('div', { class: 'hub-stats-grid' }, totalsBlock('This week', sum.week, imp), totalsBlock('Last 4 weeks', sum.last4, imp), ftpBlock),
      h('div', { class: 'hub-stats-grid hub-stats-lower' },
        h('section', { class: 'hub-stat-block', 'aria-label': 'Distance per week' }, h('h3', { class: 'hub-sub', text: `Distance per week (${imp ? 'mi' : 'km'})` }), weeklyBars(sum.weekly, imp)),
        h('section', { class: 'hub-stat-block hub-recent', 'aria-label': 'Recent rides' }, h('h3', { class: 'hub-sub', text: 'Recent rides' }), recent),
      ),
      h('div', { class: 'hub-actions' },
        button('All stats and rides', () => ctx.deps.openProfile('stats'), 'primary', { 'data-fkey': 'all-stats' }),
        bestEntries.length ? h('span', { class: 'hub-meta', text: `Best times on ${bestEntries.length} stage${bestEntries.length === 1 ? '' : 's'}, e.g. ${raceTime(bestEntries[0][1].finishS)}` }) : null,
      ),
    );
  }

  render();
  return {
    refresh(topic) {
      if (topic === 'summary' || topic === 'account' || topic === 'units' || topic === 'local') render();
    },
  };
};
