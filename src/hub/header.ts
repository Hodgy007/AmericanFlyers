// The hub's header: who you are (name, level, XP, credits) and the Ride panel (what Ride will
// start, the big button, Free ride, and the plan's next session). The elements are made once and
// updated in place, so keyboard focus survives the numbers arriving.

import { account, onAccountChange } from '../cloud/account';
import { bluetoothAvailable } from '../ble/trainer';
import { browserEnv, mountBluefyCard } from '../bluefy';
import { raceTime } from '../ghost';
import { canRace, MODE_HELP, MODE_LABEL, RACE_UNAVAILABLE, RIDE_MODES, type RideMode } from '../rideMode';
import { levelFraction, levelTitle } from '../garage/progression';
import { drawProfile } from '../profile';
import { allStages, stageById } from '../routes/library';
import { nextSession, planById } from '../plans';
import { drawWorkout } from '../workouts/graph';
import { workoutById } from '../workouts/library';
import { estimateTss, expand, totalDuration } from '../workouts/model';
import { climbText, distanceText, durationText, FREE_RIDE_STAGE, firstName, greeting, pickWorkout, stageFigures } from './data';
import { button, drawWhenVisible, h, skeleton } from './dom';
import type { HubCtx, Topic } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function mountHeader(ctx: HubCtx) {
  const riderBox = document.getElementById('hub-rider')!;
  const rideBox = document.getElementById('hub-ride')!;

  // ------------------------------------------------------------ rider card ----
  const avatar = h('div', { class: 'hub-avatar', 'aria-hidden': 'true' });
  const hello = h('span', { text: 'Welcome' });
  const eyebrow = h('p', { class: 'hub-eyebrow' }, h('span', { class: 'stripe' }), hello);
  const name = h('h1', { class: 'hub-name', id: 'hub-name' });
  const levelChip = h('span', { class: 'hub-lv' });
  const levelTitleEl = h('span', { class: 'hub-lv-title' });
  const credits = h('strong', { class: 'hub-credits' });
  const creditsWord = h('span', { class: 'hub-sr', text: ' credits' });
  const levelRow = h('div', { class: 'hub-level-row' }, levelChip, levelTitleEl, h('span', { class: 'hub-credits-wrap' }, credits, creditsWord));
  const xpFill = h('i');
  const xpBar = h('div', { class: 'hub-xp', role: 'img' }, xpFill);
  const xpText = h('div', { class: 'hub-xp-text' });
  const totals = h('div', { class: 'hub-rider-totals' });
  const statBox = h('div', { class: 'hub-stat-box' }, levelRow, xpBar, xpText, totals);
  riderBox.replaceChildren(avatar, h('div', { class: 'hub-rider-main' }, eyebrow, name, statBox));

  // ------------------------------------------------------------- ride panel ----
  const ridePanelEyebrow = h('p', { class: 'hub-eyebrow' }, h('span', { class: 'stripe' }), 'Up next');
  const title = h('h2', { class: 'hub-ride-title', id: 'hub-ride-title' });
  const meta = h('p', { class: 'hub-ride-meta' });
  const clear = button('✕ Clear workout', () => ctx.pick({ stageId: ctx.choice().stageId, workoutId: null }), 'hub-clear', { 'aria-label': 'Clear the chosen workout and just ride the route' });
  clear.hidden = true;
  const chart = h('canvas', { class: 'hub-ride-chart', 'aria-hidden': 'true' });
  const rideLabel = h('span', { text: 'Ride' });
  const rideBtn = h('button', { type: 'button', class: 'primary hub-ride-btn', id: 'hub-go', 'aria-describedby': 'hub-ride-title' }, rideLabel, h('span', { class: 'hub-ride-arrow', 'aria-hidden': 'true', text: '▶' }));
  rideBtn.addEventListener('click', () => ctx.go());
  const freeBtn = button('Free ride', () => ctx.goWith({ stageId: FREE_RIDE_STAGE, workoutId: null }), 'hub-free', { title: 'Ride Heartland Rollers, an endless road with no finish line' });
  // Ride mode: who rides with you. Solo and With pro teams are remembered (a setting); Race is for this ride only.
  const modeBtns = new Map<RideMode, HTMLButtonElement>();
  for (const m of RIDE_MODES) {
    const b = h('button', { type: 'button', class: 'hub-mode-opt', role: 'radio', 'aria-checked': 'false', 'data-mode': m, 'data-fkey': `mode-${m}`, text: m === 'race' ? '🏁 Race' : MODE_LABEL[m] }) as HTMLButtonElement;
    b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') ctx.setMode(m); });
    b.addEventListener('keydown', (e) => modeKeys(e, m));
    modeBtns.set(m, b);
  }
  const modeGroup = h('div', { class: 'hub-mode', role: 'radiogroup', 'aria-label': 'Ride mode', 'aria-describedby': 'hub-mode-help' }, ...modeBtns.values());
  const modeHelp = h('p', { class: 'hub-mode-help', id: 'hub-mode-help' });
  const modeBox = h('div', { class: 'hub-mode-box' }, modeGroup, modeHelp);
  function modeKeys(e: KeyboardEvent, m: RideMode) {
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if (!fwd && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const usable = RIDE_MODES.filter((x) => modeBtns.get(x)!.getAttribute('aria-disabled') !== 'true');
    const next = usable[(usable.indexOf(m) + (fwd ? 1 : -1) + usable.length) % usable.length];
    ctx.setMode(next);
    modeBtns.get(next)!.focus();
  }
  const planRow = h('div', { class: 'hub-plan-row' });
  planRow.hidden = true;
  const quick = h('div', { class: 'hub-ride-quick' }, freeBtn, clear);
  // Remembered Bluetooth devices: main.ts moves the "Reconnect …" banner (src/devicesUi.ts) in here while the hub is open, so you connect, then ride.
  const devicesSlot = h('div', { class: 'hub-devices', id: 'hub-devices' });
  // iPhone and iPad riders without Web Bluetooth: a link to the Bluefy browser (hidden everywhere else).
  const bluefySlot = h('aside', { class: 'bluefy-card', id: 'hub-bluefy', 'aria-label': 'Bluetooth on iPhone and iPad' });
  mountBluefyCard(bluefySlot, browserEnv({
    signedIn: () => !!account(),
    hasBluetooth: bluetoothAvailable,
    onChange: (fn) => onAccountChange(fn),
    toast: (m, ms) => ctx.deps.toast(m, ms),
  }));
  rideBox.replaceChildren(ridePanelEyebrow, h('div', { class: 'hub-ride-head' }, title, meta), chart, devicesSlot, bluefySlot, modeBox, rideBtn, quick, planRow);

  // ------------------------------------------------------------------ dock ----
  // On phones the Ride button scrolls away with the header: a bar at the bottom keeps it in reach.
  const dockTitle = h('strong');
  const dockMeta = h('span', {}, h('span', { class: 'hub-sr', text: 'Ride mode: ' }), h('span', {}));
  const dockBtn = button('Ride', () => ctx.go(), 'primary hub-dock-btn');
  const dock = document.getElementById('hub-dock')!;
  dock.replaceChildren(h('div', { class: 'hub-dock-text' }, dockTitle, dockMeta), dockBtn);
  // Hidden off screen the dock is a second, invisible Ride button: keep it out of the tab order and the
  // accessibility tree until it slides in (it is only ever shown by the class below).
  const dockShown = (on: boolean) => {
    dock.classList.toggle('show', on);
    dock.setAttribute('aria-hidden', String(!on));
    for (const b of dock.querySelectorAll('button')) {
      if (on) { b.removeAttribute('aria-hidden'); b.removeAttribute('tabindex'); }
      else { b.setAttribute('aria-hidden', 'true'); b.setAttribute('tabindex', '-1'); }
    }
  };
  dockShown(false);
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(([e]) => dockShown(!e.isIntersecting), { threshold: 0 }).observe(rideBtn);
  }

  // ------------------------------------------------------------- rendering ----
  function renderRider() {
    const id = ctx.identity();
    const w = ctx.wallet();
    hello.textContent = greeting(new Date().getHours());
    const first = firstName(id.name);
    avatar.textContent = (first[0] ?? '★').toUpperCase();
    if (id.state === 'pending' && !first) name.replaceChildren(skeleton('', '220px', '44px'));
    else name.textContent = first || 'Rider';
    if (!w) {
      // The wallet is still on its way (and there is no copy from last time): placeholders the size of the real thing.
      levelChip.replaceChildren(skeleton('', '64px', '18px'));
      levelTitleEl.replaceChildren(skeleton('', '90px', '18px'));
      credits.replaceChildren(skeleton('', '70px', '18px'));
      creditsWord.textContent = '';
      xpFill.style.width = '0%';
      xpBar.removeAttribute('aria-label');
      xpText.replaceChildren(skeleton('', '180px', '14px'));
      totals.replaceChildren(skeleton('', '240px', '14px'));
      return;
    }
    const frac = levelFraction(w);
    levelChip.textContent = `Level ${w.level}`;
    levelTitleEl.textContent = levelTitle(w.level);
    credits.textContent = `🪙 ${fmt(w.balance)}`;
    creditsWord.textContent = ' credits'; // the screen reader says "1,234 credits", the eye just sees the coin
    credits.title = `${fmt(w.creditsEarned)} credits earned, ${fmt(w.creditsSpent)} spent`;
    xpFill.style.width = `${Math.round(frac * 100)}%`;
    xpBar.setAttribute('aria-label', `${Math.round(frac * 100)}% of the way to the next level`);
    xpText.textContent = w.xpNext === null ? 'Top level!' : `${fmt(w.xp - w.xpThis)} / ${fmt(w.xpNext - w.xpThis)} XP to level ${w.level + 1}`;
    const imp = ctx.imperial();
    totals.textContent = `${distanceText(w.km * 1000, imp, 0)} ridden · ${climbText(w.climbedM, imp)} climbed · ${fmt(w.rides)} ride${w.rides === 1 ? '' : 's'}`;
  }

  function renderRide() {
    const c = ctx.choice();
    const stage = stageById(c.stageId);
    const workout = c.workoutId ? workoutById(c.workoutId) : undefined;
    const imp = ctx.imperial();
    const fig = stageFigures(stage);
    const best = ctx.summary()?.bests[stage.id];
    let t: string;
    let m: string;
    if (workout) {
      const steps = expand(workout.blocks);
      t = workout.name;
      m = `${durationText(totalDuration(steps))} · TSS ${estimateTss(steps)} · on ${stage.name}`;
      chart.setAttribute('aria-label', `${workout.name} workout`);
      drawWhenVisible(chart, () => drawWorkout(chart, steps));
    } else {
      t = stage.name;
      const length = fig.lengthM === null ? 'Endless road' : distanceText(fig.lengthM, imp);
      m = `${length} · ${climbText(fig.climbM, imp)} climbing${fig.lengthM === null ? ' per 20 km' : ''}${best ? ` · 🏆 your best ${raceTime(best.finishS)}` : ''}`;
      chart.setAttribute('aria-label', `Elevation profile of ${stage.name}`);
      drawWhenVisible(chart, () => drawProfile(chart, null, [0, stage.finish ?? 20000], stage.elevationAt));
    }
    title.textContent = t;
    meta.textContent = m;
    clear.hidden = !workout;
    dockTitle.textContent = t;
    rideMeta = m;
    renderMode();
    freeBtn.hidden = c.stageId === FREE_RIDE_STAGE && !c.workoutId;
  }

  let rideMeta = '';
  function renderMode() {
    const c = ctx.choice();
    const mode = ctx.mode();
    const raceable = canRace(stageById(c.stageId), c.workoutId);
    for (const [m, b] of modeBtns) {
      const on = m === mode;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      const off = m === 'race' && !raceable;
      if (off) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.title = off ? RACE_UNAVAILABLE : '';
    }
    modeHelp.textContent = MODE_HELP[mode];
    const racing = mode === 'race';
    rideLabel.textContent = racing ? 'Race' : 'Ride';
    dockBtn.textContent = racing ? 'Race' : 'Ride';
    (dockMeta.lastElementChild as HTMLElement).textContent = `${MODE_LABEL[mode]} · ${rideMeta}`;
    if (racing) rideBtn.setAttribute('aria-label', 'Race the pro teams'); else rideBtn.removeAttribute('aria-label');
  }

  function renderPlan() {
    const progress = ctx.deps.settings().plan;
    const plan = planById(progress?.id);
    const next = plan && progress ? nextSession(plan, progress) : null;
    planRow.hidden = !next;
    if (!plan || !progress || !next) return;
    const go = button('Ride it', () => {
      if (next.workout) ctx.goWith(pickWorkout(ctx.choice(), next.workout, allStages()));
      else if (next.stage) ctx.goWith({ stageId: next.stage, workoutId: null });
    }, 'hub-plan-go', { 'aria-label': `Ride it: ${next.title}, from your ${plan.name} plan` });
    planRow.replaceChildren(
      h('span', { class: 'hub-plan-text' }, h('small', { text: `Your plan · ${plan.name}` }), h('strong', { text: next.title })),
      go,
    );
  }

  function refresh(topic: Topic | 'all' = 'all') {
    if (topic === 'all' || topic === 'account' || topic === 'wallet' || topic === 'units') renderRider();
    if (topic === 'all' || topic === 'choice' || topic === 'summary' || topic === 'units' || topic === 'local') renderRide();
    else if (topic === 'mode') renderMode();
    if (topic === 'all' || topic === 'plan' || topic === 'local' || topic === 'choice') renderPlan();
  }
  refresh('all');

  return { refresh, focusRide: () => rideBtn.focus({ preventScroll: true }) };
}
