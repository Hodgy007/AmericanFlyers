// Hub → Route: every stage and climb (and the rider's uploaded GPX routes) as a card with its
// elevation profile, length, climbing and your best time. Choosing one sets what Ride starts.

import { raceTime } from '../../ghost';
import { drawProfile } from '../../profile';
import { allStages } from '../../routes/library';
import type { Stage } from '../../stages';
import { climbText, distanceText, pickStage, stageFigures } from '../data';
import { button, drawWhenVisible, forgetCanvas, h } from '../dom';
import type { SectionMount } from '../types';

export const mount: SectionMount = (root, ctx) => {
  const imp = () => ctx.imperial();

  const upload = button('⬆ Upload a GPX route', () => document.getElementById('route-upload')?.click(), '', { 'data-fkey': 'upload' });
  const picker = button('Open the stage picker', () => ctx.deps.dialogs.stages(), '', { 'data-fkey': 'picker', title: 'The full list, with the option to delete uploaded routes' });
  const actions = h('div', { class: 'hub-actions' }, upload, picker);
  const grid = h('div', { class: 'hub-grid hub-stages' });
  const mine = h('div', { class: 'hub-grid hub-stages' });
  const mineHead = h('h3', { class: 'hub-sub', text: 'Your routes' });
  root.replaceChildren(actions, grid, mineHead, mine);

  const cards = new Map<string, HTMLElement>();
  const canvases: HTMLCanvasElement[] = [];

  function card(stage: Stage): HTMLElement {
    const fig = stageFigures(stage);
    const best = ctx.summary()?.bests[stage.id];
    const canvas = h('canvas', { class: 'hub-thumb', 'aria-hidden': 'true' });
    canvases.push(canvas);
    drawWhenVisible(canvas, () => drawProfile(canvas, null, [0, stage.finish ?? 20000], stage.elevationAt));
    const metaId = `hub-stage-meta-${stage.id}`;
    const pick = button(stage.name, () => ctx.pick(pickStage(ctx.choice(), stage.id)), 'hub-pick', { 'data-fkey': `stage-${stage.id}`, 'aria-describedby': metaId, 'aria-pressed': 'false' });
    const meta = h('p', { class: 'hub-meta', id: metaId, text: `${fig.lengthM === null ? 'Endless' : distanceText(fig.lengthM, imp())} · ${climbText(fig.climbM, imp())} climbing${fig.lengthM === null ? ' per 20 km' : ''}` });
    const foot = h('div', { class: 'hub-card-foot' });
    if (best) foot.append(h('span', { class: 'hub-chip gold', title: 'Your best whole-stage time', text: `🏆 ${raceTime(best.finishS)}` }));
    if (stage.finish !== null) foot.append(button('🏁 Race', () => ctx.deps.race(stage), 'hub-mini', { title: `Race the pro teams over ${stage.name}`, 'aria-label': `Race the pro teams over ${stage.name}`, 'data-fkey': `race-${stage.id}` }));
    const el = h('article', { class: 'hub-card hub-stage' },
      canvas,
      h('div', { class: 'hub-card-body' }, h('h3', {}, pick), meta, h('p', { class: 'hub-desc', text: stage.tagline }), foot),
      h('span', { class: 'hub-tick', 'aria-hidden': 'true', text: '✓ Chosen' }),
    );
    cards.set(stage.id, el);
    return el;
  }

  function tourCard(): HTMLElement {
    const pick = button('🏆 Hell of the West tour', () => ctx.deps.dialogs.tour(), 'hub-pick', { 'data-fkey': 'tour' });
    return h('article', { class: 'hub-card hub-stage hub-tour' },
      h('div', { class: 'hub-card-body' },
        h('h3', {}, pick),
        h('p', { class: 'hub-meta', text: '3 stages · race the pro teams' }),
        h('p', { class: 'hub-desc', text: 'Morgul-Bismark, the Tour of the Moon, then Echo Lake, in order, for the yellow, green and polka-dot jerseys.' }),
        h('div', { class: 'hub-card-foot' }, h('span', { class: 'hub-chip', text: 'Opens the tour' })),
      ));
  }

  function render() {
    for (const c of canvases) forgetCanvas(c);
    canvases.length = 0;
    cards.clear();
    const stages = allStages();
    grid.replaceChildren(tourCard(), ...stages.filter((s) => !s.uploaded).map(card));
    const own = stages.filter((s) => s.uploaded);
    mine.replaceChildren(...own.map(card));
    if (!own.length) mine.append(h('p', { class: 'hub-note', text: 'Upload a .gpx file from Strava, Komoot, RideWithGPS or Garmin and ride it here. Routes are kept in this browser, and in your account when you’re signed in.' }));
    updateSelection();
  }

  function updateSelection() {
    const c = ctx.choice();
    for (const [id, el] of cards) {
      const on = id === c.stageId && !c.workoutId;
      el.classList.toggle('selected', on);
      el.querySelector('.hub-pick')?.setAttribute('aria-pressed', String(on));
    }
  }

  render();
  return {
    refresh(topic) {
      if (topic === 'choice') updateSelection();
      else render();
    },
    dispose() {
      for (const c of canvases) forgetCanvas(c);
    },
  };
};
