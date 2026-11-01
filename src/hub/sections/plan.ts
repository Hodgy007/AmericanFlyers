// Hub → Plan: the training plan you are following (progress and the next session with a one-click
// "Ride it"), or a prompt to pick one. The full plan, with every session, is the existing dialog.

import { allStages } from '../../routes/library';
import { PLANS, planById } from '../../plans';
import { pickWorkout, planSummary } from '../data';
import { button, h } from '../dom';
import type { SectionMount } from '../types';

export const mount: SectionMount = (root, ctx) => {
  function render() {
    const progress = ctx.deps.settings().plan;
    const plan = planById(progress?.id);
    if (!plan || !progress) {
      root.replaceChildren(
        h('p', { class: 'hub-note', text: 'Follow a plan and your next session is always one click away. Sessions tick off when you finish the workout or reach the finish line.' }),
        h('div', { class: 'hub-grid hub-plans' }, ...PLANS.map((p) => h('article', { class: 'hub-card hub-plan-card' },
          h('div', { class: 'hub-card-body' },
            h('h3', { text: p.name }),
            h('p', { class: 'hub-meta', text: p.level }),
            h('p', { class: 'hub-desc', text: p.description }),
            h('div', { class: 'hub-card-foot' },
              button('Start this plan', () => ctx.deps.startPlan(p.id), 'primary', { 'data-fkey': `start-${p.id}`, 'aria-label': `Start the ${p.name} plan` }),
              button('See the sessions', () => ctx.deps.dialogs.plans(), '', { 'data-fkey': `see-${p.id}` }),
            ),
          )))),
      );
      return;
    }

    const s = planSummary(plan, progress);
    const dots = h('ol', { class: 'hub-dots', 'aria-label': `${s.done} of ${s.total} sessions done` });
    plan.weeks.flatMap((w) => w).forEach((_, i) => {
      dots.append(h('li', { class: `${progress.done.includes(i) ? 'done' : ''}${s.next?.index === i ? ' next' : ''}`.trim(), 'aria-hidden': 'true' }));
    });
    const head = h('div', { class: 'hub-plan-head' },
      h('div', {}, h('h3', { text: plan.name }), h('p', { class: 'hub-meta', text: `${s.done} of ${s.total} sessions · ${s.pct}%` })),
      button('Open the full plan', () => ctx.deps.dialogs.plans(), '', { 'data-fkey': 'open-plan' }),
    );
    const bar = h('div', { class: 'hub-bar', role: 'img', 'aria-label': `${s.pct}% of the plan done` }, h('i'));
    (bar.firstChild as HTMLElement).style.width = `${s.pct}%`;

    const parts: Node[] = [head, bar, dots];
    if (s.next) {
      const next = s.next;
      const ride = button(next.workout ? 'Ride it' : 'Ride this stage', () => {
        if (next.workout) ctx.goWith(pickWorkout(ctx.choice(), next.workout, allStages()));
        else if (next.stage) ctx.goWith({ stageId: next.stage, workoutId: null });
      }, 'primary hub-plan-ride', { 'data-fkey': 'plan-ride', 'aria-label': `Ride it: ${next.title}` });
      const choose = button('Choose it', () => {
        if (next.workout) ctx.pick(pickWorkout(ctx.choice(), next.workout, allStages()));
        else if (next.stage) ctx.pick({ stageId: next.stage, workoutId: null });
      }, '', { 'data-fkey': 'plan-choose', title: 'Set Ride to this session without starting it' });
      parts.push(h('div', { class: 'hub-next-session' },
        h('p', { class: 'hub-eyebrow' }, h('span', { class: 'stripe' }), `Next · week ${next.week}`),
        h('h3', { text: next.title }),
        h('span', { class: 'hub-chip', text: next.workout ? 'Workout' : 'Stage' }),
        h('p', { class: 'hub-desc', text: next.note }),
        h('div', { class: 'hub-card-foot' }, ride, choose),
      ));
      if (s.upcoming.length) {
        parts.push(h('h3', { class: 'hub-sub', text: 'After that' }), h('ul', { class: 'hub-list' }, ...s.upcoming.map((u) => h('li', {},
          h('span', { class: 'hub-list-main', text: u.title }),
          h('span', { class: 'hub-list-meta', text: `Week ${u.week} · ${u.workout ? 'Workout' : 'Stage'}` }),
        ))));
      }
    } else {
      parts.push(h('div', { class: 'hub-next-session' }, h('h3', { text: '🏆 Plan complete!' }), h('p', { class: 'hub-desc', text: 'Great work. Pick another plan when you’re ready.' }),
        h('div', { class: 'hub-card-foot' }, button('Pick another plan', () => ctx.deps.dialogs.plans(), 'primary', { 'data-fkey': 'pick-plan' }))));
    }
    root.replaceChildren(h('div', { class: 'hub-plan' }, ...parts));
  }

  render();
  return {
    refresh(topic) {
      if (topic === 'plan' || topic === 'local') render();
    },
  };
};
