// Hub → Training: the workouts (the Ramp FTP test first, then your own, then the built-in ones)
// with their block charts. Choosing one sets what Ride starts; the creator and the library open
// from here.

import { allStages } from '../../routes/library';
import { drawWorkout } from '../../workouts/graph';
import { allWorkouts } from '../../workouts/library';
import { estimateTss, expand, RAMP_TEST_ID, totalDuration, type Workout } from '../../workouts/model';
import { durationText, pickWorkout } from '../data';
import { button, drawWhenVisible, forgetCanvas, h } from '../dom';
import type { SectionMount } from '../types';

const SOURCE_LABEL = { builtin: 'Built-in', uploaded: 'Uploaded', custom: 'My workout' } as const;

export const mount: SectionMount = (root, ctx) => {
  const create = button('＋ Create a workout', () => ctx.deps.dialogs.newWorkout(), 'primary', { 'data-fkey': 'create' });
  const library = button('Open the workout library', () => ctx.deps.dialogs.workouts(), '', { 'data-fkey': 'library', title: 'Upload .zwo, .erg and .mrc files, edit, export or delete workouts' });
  const actions = h('div', { class: 'hub-actions' }, create, library);
  const body = h('div');
  root.replaceChildren(actions, body);

  const cards = new Map<string, HTMLElement>();
  const canvases: HTMLCanvasElement[] = [];

  function card(w: Workout, featured = false): HTMLElement {
    const steps = expand(w.blocks);
    const canvas = h('canvas', { class: 'hub-thumb hub-thumb-workout', 'aria-hidden': 'true' });
    canvases.push(canvas);
    drawWhenVisible(canvas, () => drawWorkout(canvas, steps));
    const metaId = `hub-w-meta-${w.id}`;
    const pick = button(w.name, () => ctx.pick(pickWorkout(ctx.choice(), w.id, allStages())), 'hub-pick', { 'data-fkey': `w-${w.id}`, 'aria-describedby': metaId, 'aria-pressed': 'false' });
    const ftp = ctx.deps.settings().ftp;
    const desc = featured ? `${w.description} Your FTP now: ${ftp} W.` : (w.description || `Targets are set from your FTP of ${ftp} W.`);
    const el = h('article', { class: `hub-card hub-workout${featured ? ' hub-featured' : ''}` },
      canvas,
      h('div', { class: 'hub-card-body' },
        h('h3', {}, pick),
        h('p', { class: 'hub-meta', id: metaId, text: `${durationText(totalDuration(steps))} · TSS ${estimateTss(steps)}` }),
        h('p', { class: 'hub-desc', text: desc }),
        h('div', { class: 'hub-card-foot' }, h('span', { class: 'hub-chip', text: featured ? '🧪 FTP test' : SOURCE_LABEL[w.source] })),
      ),
      h('span', { class: 'hub-tick', 'aria-hidden': 'true', text: '✓ Chosen' }),
    );
    cards.set(w.id, el);
    return el;
  }

  function render() {
    for (const c of canvases) forgetCanvas(c);
    canvases.length = 0;
    cards.clear();
    const all = allWorkouts();
    const ramp = all.find((w) => w.id === RAMP_TEST_ID);
    const own = all.filter((w) => w.source !== 'builtin');
    const builtin = all.filter((w) => w.source === 'builtin' && w.id !== RAMP_TEST_ID);
    const parts: Node[] = [];
    if (ramp) parts.push(h('div', { class: 'hub-grid hub-workouts hub-one' }, card(ramp, true)));
    if (own.length) parts.push(h('h3', { class: 'hub-sub', text: 'My workouts' }), h('div', { class: 'hub-grid hub-workouts' }, ...own.map((w) => card(w))));
    else parts.push(h('p', { class: 'hub-note', text: 'Your own workouts will appear here. Build one with Create, or upload a Zwift .zwo, .erg or .mrc file in the library.' }));
    parts.push(h('h3', { class: 'hub-sub', text: 'Built-in workouts' }), h('div', { class: 'hub-grid hub-workouts' }, ...builtin.map((w) => card(w))));
    body.replaceChildren(...parts);
    updateSelection();
  }

  function updateSelection() {
    const c = ctx.choice();
    for (const [id, el] of cards) {
      const on = id === c.workoutId;
      el.classList.toggle('selected', on);
      el.querySelector('.hub-pick')?.setAttribute('aria-pressed', String(on));
    }
  }

  render();
  return {
    refresh(topic) {
      if (topic === 'choice') updateSelection();
      else if (topic === 'local' || topic === 'units') render();
    },
    dispose() {
      for (const c of canvases) forgetCanvas(c);
    },
  };
};
