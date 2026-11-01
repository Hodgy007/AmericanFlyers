// Hub → Garage: your bike and kit on a small turntable (loaded only when this section is on
// screen), your level and credits, what you are wearing, and this week's challenges. "Open the
// garage" is the existing store dialog.

import { account } from '../../cloud/account';
import { itemById, SLOT_LABEL, SLOTS, styleOf } from '../../garage/catalogue';
import { fetchChallenges } from '../../garage/api';
import { isComplete, previewWeek, progressText, type WeekState } from '../../garage/challenges';
import { levelFraction, levelTitle } from '../../garage/progression';
import { lookWithStyle } from '../../kit';
import { button, h, skeleton } from '../dom';
import type { SectionMount } from '../types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const STILL_AFTER_MS = 2600; // with reduced motion the turntable turns for a moment, then holds still

interface Preview {
  setLook(look: ReturnType<typeof lookWithStyle>): void;
  setNight(n: number): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export const mount: SectionMount = (root, ctx) => {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const newCanvas = () => h('canvas', { class: 'hub-garage-canvas', 'aria-label': 'Your rider on their bike, turning slowly. Drag to turn it.', role: 'img' });
  let canvas = newCanvas();
  const fallback = h('p', { class: 'hub-note hub-garage-fallback', text: 'Open the garage to see your bike.' });
  fallback.hidden = true;
  const stage = h('div', { class: 'hub-garage-stage' }, canvas, fallback, h('span', { class: 'hub-garage-hint', text: 'Drag to turn' }));

  const levelBox = h('div', { class: 'hub-garage-level' });
  const wearBox = h('ul', { class: 'hub-wear' });
  const weekBox = h('div', { class: 'hub-challenges' });
  const open = button('Open the garage', () => ctx.deps.openGarage(), 'primary', { 'data-fkey': 'open-garage' });
  const weekBtn = button('This week’s challenges', () => ctx.deps.openGarage('week'), '', { 'data-fkey': 'open-week' });
  const kitBtn = button('🎨 My kit', () => ctx.deps.dialogs.kit(), '', { 'data-fkey': 'kit', title: 'Design your jersey and bike colours' });
  root.replaceChildren(h('div', { class: 'hub-garage' },
    stage,
    h('div', { class: 'hub-garage-side' },
      levelBox,
      h('h3', { class: 'hub-sub', text: 'On your bike' }), wearBox,
      h('h3', { class: 'hub-sub', text: 'This week' }), weekBox,
      h('div', { class: 'hub-actions' }, open, weekBtn, kitBtn),
    ),
  ));

  // ------------------------------------------------------------------ level ----
  function renderLevel() {
    const w = ctx.wallet();
    if (!ctx.signedIn()) {
      levelBox.replaceChildren(
        h('p', { class: 'hub-desc', text: 'Ride, earn credits, level up, and spend them on bikes, wheels and clothes. Credits come from your saved rides: 1 per km and 1 per 10 m climbed.' }),
        button('Sign in to earn credits', () => ctx.deps.openSignIn('Sign in to earn credits for your rides and unlock new bikes, wheels and clothes.'), 'primary', { 'data-fkey': 'signin' }),
      );
      return;
    }
    if (!w) {
      levelBox.replaceChildren(skeleton('', '60%', '22px'), skeleton('', '100%', '12px'), skeleton('', '40%', '14px'));
      return;
    }
    const frac = levelFraction(w);
    const bar = h('div', { class: 'hub-xp', role: 'img', 'aria-label': `${Math.round(frac * 100)}% of the way to the next level` }, h('i'));
    (bar.firstChild as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
    levelBox.replaceChildren(
      h('div', { class: 'hub-level-row' }, h('span', { class: 'hub-lv', text: `Level ${w.level}` }), h('span', { class: 'hub-lv-title', text: levelTitle(w.level) }), h('strong', { class: 'hub-credits', text: `🪙 ${fmt(w.balance)}` })),
      bar,
      h('div', { class: 'hub-xp-text', text: w.xpNext === null ? 'Top level!' : `${fmt(w.xp - w.xpThis)} / ${fmt(w.xpNext - w.xpThis)} XP to level ${w.level + 1}` }),
    );
  }

  function renderWear() {
    const l = ctx.deps.garage.loadout();
    wearBox.replaceChildren(...SLOTS.map((slot) => h('li', {}, h('span', { text: SLOT_LABEL[slot] }), h('strong', { text: itemById(l[slot])?.name ?? '—' }))));
  }

  // -------------------------------------------------------------- challenges ----
  let week: WeekState | null = null;
  let weekFor = ''; // who the loaded week belongs to
  let weekLoading = false;

  async function loadWeek() {
    const a = account();
    const who = a?.id ?? '';
    if (weekLoading || (week && weekFor === who)) return;
    if (!a) {
      week = previewWeek();
      weekFor = '';
      renderWeek();
      return;
    }
    weekLoading = true;
    try {
      week = await fetchChallenges();
      weekFor = who;
    } catch {
      // keep whatever is on screen; the garage dialog shows the error if it matters
    }
    weekLoading = false;
    renderWeek();
  }

  function renderWeek() {
    const signed = !!account();
    if (!week) {
      weekBox.replaceChildren(...(ctx.signedIn() ? [skeleton('', '100%', '46px'), skeleton('', '100%', '46px')] : [h('p', { class: 'hub-note', text: 'Sign in to take on this week’s challenges.' })]));
      return;
    }
    weekBox.replaceChildren(...week.challenges.map((c) => {
      const done = isComplete(c);
      const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
      const bar = h('span', { class: 'hub-bar small', 'aria-hidden': 'true' }, h('i'));
      (bar.firstChild as HTMLElement).style.width = `${signed ? pct : 0}%`;
      const state = c.claimed ? '✓ Claimed' : signed && done ? 'Ready to claim' : '';
      return h('div', { class: `hub-challenge${c.claimed ? ' claimed' : signed && done ? ' ready' : ''}` },
        h('div', { class: 'hub-challenge-top' }, h('strong', { text: c.title }), h('span', { class: 'hub-chip gold', text: `🪙 ${c.reward}` })),
        bar,
        h('div', { class: 'hub-challenge-foot' }, h('span', { text: signed ? progressText(c, ctx.imperial()) : `Target ${progressText({ ...c, progress: 0 }, ctx.imperial()).split(' / ')[1]}` }), state ? h('span', { class: 'hub-challenge-state', text: state }) : null),
      );
    }));
  }

  // ----------------------------------------------------------------- preview ----
  let preview: Preview | null = null;
  let starting = false;
  let active = false;
  let stillTimer = 0;

  const lookNow = () => lookWithStyle(styleOf(ctx.deps.garage.loadout()));

  async function startPreview() {
    if (preview || starting) return;
    starting = true;
    try {
      const { GaragePreview } = await import('../../garage/preview'); // three.js and the rider: only now
      if (!active) return;
      // A canvas whose WebGL context was released can't be reused: each turntable gets a fresh one.
      const fresh = newCanvas();
      canvas.replaceWith(fresh);
      canvas = fresh;
      const p = new GaragePreview(canvas) as Preview;
      p.setLook(lookNow());
      p.setNight(ctx.deps.night());
      p.start();
      preview = p;
      fallback.hidden = true;
      if (reduced) stillTimer = window.setTimeout(() => preview?.stop(), STILL_AFTER_MS);
    } catch {
      fallback.hidden = false; // no WebGL here: the rest of the section still works
    } finally {
      starting = false;
    }
  }

  function stopPreview() {
    window.clearTimeout(stillTimer);
    preview?.dispose();
    preview = null;
  }

  renderLevel();
  renderWear();
  renderWeek();
  return {
    refresh(topic) {
      if (topic === 'wallet' || topic === 'account' || topic === 'units') renderLevel();
      if (topic === 'wallet' || topic === 'local' || topic === 'account') {
        renderWear();
        preview?.setLook(lookNow());
      }
      if (topic === 'account') {
        week = null;
        weekFor = '';
        renderWeek();
        if (active) void loadWeek();
      }
      if (topic === 'wallet' || topic === 'units') renderWeek();
    },
    setActive(a) {
      active = a;
      if (a) {
        void startPreview();
        void loadWeek();
      } else stopPreview();
    },
    dispose: stopPreview,
  };
};
