// Hub → Achievements: the badges you have earned and the next few to go, from the same
// achievements data as the profile. The full list is the profile's Achievements tab.

import type { Achievement } from '../../cloud/achievements';
import { achievementPicks } from '../data';
import { button, h, skeleton } from '../dom';
import type { SectionMount } from '../types';

function badge(a: Achievement, earned: boolean) {
  const bar = h('span', { class: 'hub-bar small', 'aria-hidden': 'true' }, h('i'));
  (bar.firstChild as HTMLElement).style.width = `${Math.round(a.progress * 100)}%`;
  return h('li', { class: `hub-badge${earned ? ' done' : ''}` },
    h('span', { class: 'hub-badge-icon', 'aria-hidden': 'true', text: a.icon }),
    h('div', { class: 'hub-badge-body' },
      h('strong', { text: a.name }),
      h('span', { class: 'hub-desc', text: a.description }),
      earned ? null : bar,
      h('span', { class: 'hub-badge-detail', text: earned ? `✓ ${a.detail}` : a.detail }),
    ),
  );
}

export const mount: SectionMount = (root, ctx) => {
  const open = () => ctx.deps.openProfile('achievements');

  function render() {
    const sum = ctx.summary();
    if (!sum) {
      root.replaceChildren(ctx.summaryStatus() === 'error'
        ? h('p', { class: 'hub-note', text: 'Couldn’t load your achievements just now. They’ll appear when your rides load.' })
        : h('div', { class: 'hub-grid hub-badges-grid', 'aria-hidden': 'true' }, ...Array.from({ length: 4 }, () => skeleton('hub-sk-card'))));
      return;
    }
    const picks = achievementPicks(sum.achievements, 4);
    const pct = picks.total ? Math.round((picks.earned.length / picks.total) * 100) : 0;
    const bar = h('div', { class: 'hub-bar', role: 'img', 'aria-label': `${picks.earned.length} of ${picks.total} earned` }, h('i'));
    (bar.firstChild as HTMLElement).style.width = `${pct}%`;
    const parts: (Node | null)[] = [
      h('div', { class: 'hub-ach-head' },
        h('div', { class: 'hub-bignum' }, h('strong', { text: String(picks.earned.length) }), h('span', { text: `of ${picks.total} earned` })),
        bar,
        button('All achievements', open, '', { 'data-fkey': 'all' }),
      ),
      picks.earned.length ? h('h3', { class: 'hub-sub', text: 'Earned' }) : null,
      picks.earned.length ? h('ul', { class: 'hub-badges' }, ...picks.earned.map((a) => badge(a, true))) : h('p', { class: 'hub-note', text: 'Nothing yet. Ride for a minute and save a ride to earn “First pedal strokes”.' }),
      picks.next.length ? h('h3', { class: 'hub-sub', text: 'Next to go' }) : h('p', { class: 'hub-note', text: '🏆 You have every badge. Legend.' }),
      picks.next.length ? h('ul', { class: 'hub-badges' }, ...picks.next.map((a) => badge(a, false))) : null,
    ];
    root.replaceChildren(...parts.filter((n): n is Node => !!n));
  }

  render();
  return {
    refresh(topic) {
      if (topic === 'summary' || topic === 'account') render();
    },
  };
};
