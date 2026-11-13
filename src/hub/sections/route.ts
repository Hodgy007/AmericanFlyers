// Hub → Route: every stage and climb (and the rider's uploaded GPX routes) as a card with its
// elevation profile, length, climbing and your best time. Choosing one sets what Ride starts (the ride mode,
// solo, with pro teams or a race, is chosen beside the Ride button; a card's small Race chip is a shortcut).

import { climbById } from '../../ai/climbs';
import { raceTime } from '../../ghost';
import { drawProfile } from '../../profile';
import { allStages } from '../../routes/library';
import { segmentsFor, shortStageName } from '../../segments';
import { isStageLoaded, loadStage, stageCatalogue, stageProfile, worldLapProfile, type Stage } from '../../stages';
import { climbText, distanceText, pickStage, stageFigures } from '../data';
import { button, drawWhenVisible, forgetCanvas, h } from '../dom';
import type { SectionMount } from '../types';

/** The names of a stage's KOM segments: found from its road once that has arrived, until then the catalogue's list (so the hub's cards don't fetch every road). */
function komNames(stage: Stage): string[] {
  if (isStageLoaded(stage) || stage.uploaded) return segmentsFor(stage).map((g) => g.name);
  return stageCatalogue(stage)?.segments ?? [];
}

export const mount: SectionMount = (root, ctx) => {
  const imp = () => ctx.imperial();

  const upload = button('⬆ Upload a GPX route', () => document.getElementById('route-upload')?.click(), '', { 'data-fkey': 'upload' });
  const picker = button('Open the stage picker', () => ctx.deps.dialogs.stages(), '', { 'data-fkey': 'picker', title: 'The full list, with the option to delete uploaded routes' });
  const actions = h('div', { class: 'hub-actions' }, upload, picker);
  const grid = h('div', { class: 'hub-grid hub-stages' });
  const mine = h('div', { class: 'hub-grid hub-stages' });
  const mineHead = h('h3', { class: 'hub-sub', text: 'Your routes' });
  // The mountain stages and the Hell of the West follow real roads.
  const credit = h('p', { class: 'hub-note', text: 'Map data: road lines © OpenStreetMap contributors (ODbL), routed with BRouter; elevation: SRTM (NASA, public domain).' });
  root.replaceChildren(actions, grid, mineHead, mine, credit);

  const cards = new Map<string, HTMLElement>();
  /** A world's routes are one card with a chip each: the chips by stage id, and each world card's routes (for the selection and its Race and KOM shortcuts). */
  const chips = new Map<string, HTMLElement>();
  const worldCards = new Map<HTMLElement, { stages: Stage[]; sync(): void }>();
  const canvases: HTMLCanvasElement[] = [];

  // The Climb guide: one panel at a time, shown as a full-width row under the stage's card. Its module loads on the first click.
  let guide: { id: string; el: HTMLElement; dispose(): void } | null = null;
  let guideSeq = 0;
  function closeGuide() {
    guideSeq++;
    if (!guide) return;
    const { id, el, dispose } = guide;
    guide = null;
    dispose();
    el.remove();
    const b = cards.get(id)?.querySelector('[data-guide]');
    b?.setAttribute('aria-expanded', 'false');
    (b as HTMLElement | null)?.focus();
  }
  async function toggleGuide(stage: Stage) {
    const climb = climbById(stage.id);
    if (!climb) return;
    if (guide?.id === stage.id) return closeGuide();
    closeGuide();
    const seq = guideSeq;
    const { mountClimbGuide } = await import('../climbGuide');
    if (seq !== guideSeq || !cards.has(stage.id)) return; // closed or redrawn while the module loaded
    const g = mountClimbGuide({ climb, stageName: stage.name, host: ctx.deps.climbGuide, imperial: () => ctx.imperial(), onClose: closeGuide });
    guide = { id: stage.id, el: g.el, dispose: g.dispose };
    cards.get(stage.id)!.after(g.el);
    cards.get(stage.id)!.querySelector('[data-guide]')?.setAttribute('aria-expanded', 'true');
    g.focus();
    g.el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function card(stage: Stage): HTMLElement {
    const fig = stageFigures(stage);
    const best = ctx.summary()?.bests[stage.id];
    const canvas = h('canvas', { class: 'hub-thumb', 'aria-hidden': 'true' });
    canvases.push(canvas);
    drawWhenVisible(canvas, () => drawProfile(canvas, null, [0, stage.finish ?? 20000], stageProfile(stage)));
    const metaId = `hub-stage-meta-${stage.id}`;
    const pick = button(stage.name, () => ctx.pick(pickStage(ctx.choice(), stage.id)), 'hub-pick', { 'data-fkey': `stage-${stage.id}`, 'aria-describedby': metaId, 'aria-pressed': 'false' });
    const meta = h('p', { class: 'hub-meta', id: metaId, text: `${fig.lengthM === null ? 'Endless' : distanceText(fig.lengthM, imp())} · ${climbText(fig.climbM, imp())} climbing${fig.lengthM === null ? ' per 20 km' : ''}` });
    const foot = h('div', { class: 'hub-card-foot' });
    if (best) foot.append(h('span', { class: 'hub-chip gold', title: 'Your best whole-stage time', text: `🏆 ${raceTime(best.finishS)}` }));
    if (climbById(stage.id)) foot.append(button('🧭 Climb guide', () => { void toggleGuide(stage); }, 'hub-mini hub-race', { title: `Current, web-sourced facts about ${stage.name}: history, records, road conditions, riding it for real`, 'aria-label': `Climb guide for ${stage.name}`, 'aria-expanded': 'false', 'data-guide': stage.id, 'data-fkey': `guide-${stage.id}` }));
    if (stage.finish !== null) foot.append(button('🏁 Race it', () => ctx.deps.race(stage), 'hub-mini hub-race', { title: `Skip the ride mode and race the pro teams over ${stage.name} now`, 'aria-label': `Race the pro teams over ${stage.name}`, 'data-fkey': `race-${stage.id}` }));
    const segs = komNames(stage);
    if (segs.length) {
      foot.append(button(`⛰ KOM ×${segs.length}`, () => {
        loadStage(stage).then(() => import('../../segmentBoardUi')).then((m) => m.openStageSegments(stage, imp(), () => ctx.deps.dialogs.account())).catch(() => ctx.deps.toast('Couldn’t open the KOM segments just now.'));
      }, 'hub-mini hub-race', { title: `The big climbs on ${stage.name}: who holds the KOM, and your best`, 'aria-label': `KOM segments on ${stage.name}: ${segs.join(', ')}`, 'data-fkey': `kom-${stage.id}` }));
    }
    const el = h('article', { class: 'hub-card hub-stage' },
      canvas,
      h('div', { class: 'hub-card-body' }, h('h3', {}, pick), meta, h('p', { class: 'hub-desc', text: stage.tagline }), foot),
      h('span', { class: 'hub-tick', 'aria-hidden': 'true', text: '✓ Chosen' }),
    );
    cards.set(stage.id, el);
    return el;
  }

  /** One card for a world (Kestrel Vale): its profile, a line about it and a chip per route; a chip picks that route's stage as a normal card does. */
  function worldCard(stages: Stage[]): HTMLElement {
    const w = stages[0].world!;
    const lapElevation = worldLapProfile(w) ?? (() => 0); // (the stored lap profile: the world's road isn't fetched for a thumbnail)
    const canvas = h('canvas', { class: 'hub-thumb', 'aria-hidden': 'true' });
    canvases.push(canvas);
    drawWhenVisible(canvas, () => drawProfile(canvas, null, [0, w.lap], lapElevation));
    const metaId = `hub-world-meta-${w.id}`;
    const list = h('div', { class: 'hub-routes', role: 'group', 'aria-label': `${w.name} routes`, 'aria-describedby': metaId });
    for (const stage of stages) {
      const fig = stageFigures(stage);
      const length = fig.lengthM === null ? '∞' : distanceText(fig.lengthM, imp());
      const climb = `${climbText(fig.climbM, imp())}${fig.lengthM === null ? ' per 20 km' : ''}`;
      const chip = button('', () => ctx.pick(pickStage(ctx.choice(), stage.id)), 'hub-route', {
        'data-fkey': `stage-${stage.id}`, 'data-world': w.id, 'aria-pressed': 'false',
        title: stage.tagline,
        'aria-label': `${stage.name}: ${fig.lengthM === null ? 'endless' : length}, ${climb} climbing`,
      });
      chip.append(h('span', { class: 'hub-route-name', text: shortStageName(stage.name) }), h('span', { class: 'hub-route-meta', text: `${length} · ${climb}` }));
      chips.set(stage.id, chip);
      list.append(chip);
    }
    // The Race and KOM shortcuts act on the world's chosen route (else its first route with a finish).
    const race = button('🏁 Race it', () => ctx.deps.race(active()), 'hub-mini hub-race', { 'data-fkey': `race-${w.id}` });
    const kom = button('', () => {
      const stage = active();
      loadStage(stage).then(() => import('../../segmentBoardUi')).then((m) => m.openStageSegments(stage, imp(), () => ctx.deps.dialogs.account())).catch(() => ctx.deps.toast('Couldn’t open the KOM segments just now.'));
    }, 'hub-mini hub-race', { 'data-fkey': `kom-${w.id}` });
    const foot = h('div', { class: 'hub-card-foot' });
    const bests = h('span', { class: 'hub-chip gold', hidden: '' });
    foot.append(bests, race, kom);
    function active(): Stage {
      const c = ctx.choice();
      return stages.find((s) => s.id === c.stageId && !c.workoutId) ?? stages.find((s) => s.finish !== null) ?? stages[0];
    }
    function sync() {
      const stage = active();
      const segs = komNames(stage);
      race.hidden = stage.finish === null;
      race.title = `Skip the ride mode and race the pro teams over ${stage.name} now`;
      race.setAttribute('aria-label', `Race the pro teams over ${stage.name}`);
      kom.hidden = segs.length === 0;
      kom.textContent = `⛰ KOM ×${segs.length}`;
      kom.title = `The big climbs on ${stage.name}: who holds the KOM, and your best`;
      kom.setAttribute('aria-label', `KOM segments on ${stage.name}: ${segs.join(', ')}`);
      const best = ctx.summary()?.bests[stage.id];
      bests.hidden = !best;
      if (best) { bests.textContent = `🏆 ${raceTime(best.finishS)}`; bests.title = `Your best whole-stage time on ${shortStageName(stage.name)}`; }
    }
    const el = h('article', { class: 'hub-card hub-stage hub-world' },
      canvas,
      h('div', { class: 'hub-card-body' },
        h('h3', { class: 'hub-world-name', text: w.name }),
        h('p', { class: 'hub-meta', id: metaId, text: `${stages.length} routes · one valley` }),
        h('p', { class: 'hub-desc', text: w.tagline }),
        list, foot),
      h('span', { class: 'hub-tick', 'aria-hidden': 'true', text: '✓ Chosen' }),
    );
    for (const stage of stages) cards.set(stage.id, el);
    worldCards.set(el, { stages, sync });
    sync();
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
    chips.clear();
    worldCards.clear();
    const open = guide;
    const stages = allStages();
    // A world's routes are one card, where its first route would be.
    const built = new Set<string>();
    const tiles = stages.filter((s) => !s.uploaded).flatMap((s) => {
      if (!s.world) return [card(s)];
      if (built.has(s.world.id)) return [];
      built.add(s.world.id);
      return [worldCard(stages.filter((o) => o.world?.id === s.world!.id))];
    });
    grid.replaceChildren(tourCard(), ...tiles);
    const own = stages.filter((s) => s.uploaded);
    mine.replaceChildren(...own.map(card));
    if (!own.length) mine.append(h('p', { class: 'hub-note', text: 'Upload a .gpx file from Strava, Komoot, RideWithGPS or Garmin and ride it here. Routes are kept in this browser, and in your account when you’re signed in.' }));
    updateSelection();
    if (open) {
      // A redraw (new rides loaded, units changed) keeps an open guide in place under its card.
      const at = cards.get(open.id);
      if (at) { at.after(open.el); at.querySelector('[data-guide]')?.setAttribute('aria-expanded', 'true'); } else closeGuide();
    }
  }

  function updateSelection() {
    const c = ctx.choice();
    for (const [id, el] of cards) {
      if (worldCards.has(el)) continue;
      const on = id === c.stageId && !c.workoutId;
      el.classList.toggle('selected', on);
      el.querySelector('.hub-pick')?.setAttribute('aria-pressed', String(on));
    }
    for (const [id, chip] of chips) chip.setAttribute('aria-pressed', String(id === c.stageId && !c.workoutId));
    for (const [el, w] of worldCards) {
      el.classList.toggle('selected', !c.workoutId && w.stages.some((s) => s.id === c.stageId));
      w.sync();
    }
  }

  render();
  return {
    refresh(topic) {
      if (topic === 'choice') updateSelection();
      else if (topic !== 'mode') render();
    },
    dispose() {
      for (const c of canvases) forgetCanvas(c);
      guideSeq++;
      guide?.dispose();
      guide = null;
    },
  };
};
