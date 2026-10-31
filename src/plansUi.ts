// The training plans dialog: pick a plan, see your progress week by week,
// and ride the next session.

import { nextSession, PLANS, planById, sessions, type PlanProgress, type Session } from './plans';

interface Options {
  progress: () => PlanProgress | null;
  setProgress: (p: PlanProgress | null) => void;
  ride: (session: Session) => void;
  toast: (msg: string, ms?: number) => void;
}

export function initPlansUi(o: Options) {
  const dialog = document.getElementById('plans') as HTMLDialogElement;
  const body = document.getElementById('plans-body')!;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };

  function render() {
    const progress = o.progress();
    const plan = planById(progress?.id);
    body.replaceChildren();
    if (!plan || !progress) {
      body.append(el('p', 'muted small', 'Follow a plan and the next session is always one click away. Sessions tick off when you finish the workout or reach the finish line.'));
      for (const p of PLANS) {
        const card = el('div', 'plan-card');
        const info = el('div', 'plan-info');
        info.append(el('strong', '', p.name), el('span', 'plan-level', p.level), el('p', 'plan-desc', p.description));
        const start = el('button', 'primary', 'Start plan');
        start.type = 'button';
        start.addEventListener('click', () => {
          o.setProgress({ id: p.id, started: new Date().toISOString().slice(0, 10), done: [] });
          o.toast(`${p.name} plan started. First up: ${p.weeks[0][0].title}.`);
          render();
        });
        card.append(info, start);
        body.append(card);
      }
      return;
    }

    const all = sessions(plan);
    const next = nextSession(plan, progress);
    const pct = Math.round((progress.done.length / all.length) * 100);
    const head = el('div', 'plan-head');
    head.append(el('strong', '', plan.name), el('span', 'plan-level', `${progress.done.length} of ${all.length} sessions · ${pct}%`));
    const bar = el('div', 'plan-bar');
    bar.style.setProperty('--pct', `${pct}%`);
    body.append(head, bar);

    if (next) {
      const card = el('div', 'plan-next');
      card.append(el('span', 'plan-level', `Next · week ${next.week}`), el('strong', '', next.title), el('p', 'plan-desc', next.note));
      const go = el('button', 'primary', next.workout ? 'Ride this workout' : 'Ride this stage');
      go.type = 'button';
      go.addEventListener('click', () => { dialog.close(); o.ride(next); });
      card.append(go);
      body.append(card);
    } else {
      body.append(el('p', 'plan-done', `🏆 Plan complete! Great work. Pick another plan when you’re ready.`));
    }

    let index = -1;
    plan.weeks.forEach((week, w) => {
      const box = el('div', 'plan-week');
      box.append(el('h3', '', `Week ${w + 1}`));
      const list = el('ul', 'plan-sessions');
      week.forEach((sess) => {
        const i = ++index;
        const done = progress.done.includes(i);
        const li = el('li', done ? 'done' : '');
        const tick = el('button', 'plan-tick', done ? '✓' : '');
        tick.type = 'button';
        tick.title = done ? 'Mark as not done' : 'Mark as done';
        tick.setAttribute('aria-label', tick.title);
        tick.addEventListener('click', () => {
          const d = done ? progress.done.filter((k) => k !== i) : [...progress.done, i].sort((a, b) => a - b);
          o.setProgress({ ...progress, done: d });
          render();
        });
        li.append(tick, el('span', 'plan-title', sess.title), el('span', 'plan-kind', sess.workout ? 'Workout' : 'Stage'));
        list.append(li);
      });
      box.append(list);
      body.append(box);
    });

    const leave = el('button', 'link', 'Leave this plan');
    leave.type = 'button';
    leave.addEventListener('click', () => {
      if (!confirm(`Leave the ${plan.name} plan? Your progress will be cleared.`)) return;
      o.setProgress(null);
      render();
    });
    body.append(leave);
  }

  return {
    open() {
      render();
      if (!dialog.open) dialog.showModal();
    },
  };
}
