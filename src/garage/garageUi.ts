// The ☰ Menu → 🚲 Garage & store dialog: your level and credits, a turntable of
// your rider, the bikes, wheels, tyres and clothing (with what each does in
// plain numbers), and this week's challenges.

import { lookWithStyle } from '../kit';
import { buyItem, claimChallenge, fetchChallenges } from './api';
import { isComplete, previewWeek, progressText, type WeekState } from './challenges';
import { DEFAULT_LOADOUT, ITEMS, SLOT_LABEL, styleOf, TABS, type Loadout, type StoreItem, type Tab } from './catalogue';
import { describeNumbers, describeItem, loadoutNumbers, type RiderContext } from './effects';
import type { Garage } from './garage';
import { levelFraction, levelTitle } from './progression';
import { equip, fitsLoadout, itemState } from './store';
import { GaragePreview } from './preview';

interface Options {
  garage: Garage;
  ctx: () => RiderContext;
  imperial: () => boolean;
  /** Night amount 0..1 for the preview's glow (the world's current light). */
  night: () => number;
  openSignIn: (why: string) => void;
  toast: (msg: string, ms?: number) => void;
}

type TabId = Tab | 'week';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function initGarageUi(o: Options) {
  const dialog = document.getElementById('garage-dialog') as HTMLDialogElement;
  const canvas = document.getElementById('garage-preview') as HTMLCanvasElement;
  const head = document.getElementById('garage-head')!;
  const tabsEl = document.getElementById('garage-tabs')!;
  const body = document.getElementById('garage-body')!;
  const setup = document.getElementById('garage-setup')!;

  let preview: GaragePreview | null = null;
  let tab: TabId = 'bikes';
  let tried: StoreItem | null = null; // the item being looked at (not yet worn)
  let week: WeekState | null = null;
  let weekError = '';
  let busy = false;

  const garage = o.garage;

  /** The loadout the turntable shows: yours, with the item you're looking at put on. */
  function showing(): Loadout {
    const l = garage.loadout();
    return tried ? equip(l, tried, DEFAULT_LOADOUT.wheels) : l;
  }

  function showPreview() {
    if (!preview) return;
    preview.setLook(lookWithStyle(styleOf(showing())));
    preview.setNight(o.night());
    const n = loadoutNumbers(showing(), o.ctx());
    const lines = describeNumbers(n);
    setup.textContent = lines.length ? `This set-up: ${lines.join(' · ')}` : 'This set-up rides like the starter bike. Wheels, frames and tyres add small, realistic gains.';
  }

  // ------------------------------------------------------------ header ----

  function renderHead() {
    const w = garage.wallet;
    head.replaceChildren();
    if (!w) {
      const p = document.createElement('div');
      p.className = 'gar-signin';
      p.innerHTML = '<span>Ride, earn credits, level up, and spend them here. Credits come from your saved rides: 1 per km and 1 per 10 m climbed.</span>';
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = 'Sign in';
      b.addEventListener('click', () => { dialog.close(); o.openSignIn('Sign in to earn credits for your rides and unlock new bikes, wheels and clothes.'); });
      p.append(b);
      head.append(p);
      return;
    }
    const frac = levelFraction(w);
    head.innerHTML = `
      <div class="gar-level"><span class="gar-lv">Level ${w.level}</span><span class="gar-title">${levelTitle(w.level)}</span></div>
      <div class="gar-bar" role="img" aria-label="${Math.round(frac * 100)}% of the way to the next level"><i style="width:${Math.round(frac * 100)}%"></i></div>
      <div class="gar-xp">${w.xpNext === null ? 'Top level!' : `${fmt(w.xp - w.xpThis)} / ${fmt(w.xpNext - w.xpThis)} XP to level ${w.level + 1}`}</div>
      <div class="gar-credits"><strong>🪙 ${fmt(w.balance)}</strong> credits<small>${fmt(w.creditsEarned)} earned · ${fmt(w.creditsSpent)} spent</small></div>
      <div class="gar-totals">${o.imperial() ? `${fmt(w.km / 1.609344)} mi` : `${fmt(w.km)} km`} ridden · ${o.imperial() ? `${fmt(w.climbedM * 3.28084)} ft` : `${fmt(w.climbedM)} m`} climbed · ${fmt(w.rides)} rides</div>`;
  }

  function renderTabs() {
    tabsEl.replaceChildren(...[...TABS.map((t) => ({ id: t.id as TabId, label: t.label })), { id: 'week' as TabId, label: 'This week' }].map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.textContent = t.label;
      b.className = t.id === tab ? 'selected' : '';
      b.setAttribute('aria-selected', String(t.id === tab));
      b.addEventListener('click', () => { tab = t.id; tried = null; render(); if (tab === 'week') loadWeek(); });
      return b;
    }));
  }

  // ------------------------------------------------------------- store ----

  function card(it: StoreItem): HTMLElement {
    const w = garage.wallet;
    const loadout = garage.loadout();
    const st = itemState(it, w);
    const worn = loadout[it.slot] === it.id;
    const el = document.createElement('div');
    el.className = `gi${worn ? ' worn' : ''}${st.kind === 'locked' ? ' locked' : ''}${tried?.id === it.id ? ' tried' : ''}`;
    const fx = describeItem(it, o.ctx());
    el.innerHTML = '<div class="gi-top"><strong></strong><span class="gi-price"></span></div><p class="gi-blurb"></p><ul class="gi-fx"></ul><div class="gi-foot"><span class="gi-note"></span></div>';
    el.querySelector('strong')!.textContent = it.name;
    el.querySelector('.gi-price')!.textContent = st.kind === 'owned' ? (worn ? 'On your bike' : 'Owned') : it.price > 0 ? `🪙 ${fmt(it.price)}` : it.unlock ? 'Unlock' : 'Free';
    el.querySelector('.gi-blurb')!.textContent = it.blurb;
    el.querySelector('.gi-fx')!.replaceChildren(...fx.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    const note = el.querySelector('.gi-note') as HTMLElement;
    const foot = el.querySelector('.gi-foot')!;
    const button = (label: string, cls: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = cls;
      b.disabled = disabled || busy;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      foot.append(b);
    };
    if (st.kind === 'owned') {
      if (worn) note.textContent = '✓ Equipped';
      else if (!fitsLoadout(it, loadout)) note.textContent = 'Needs the time-trial bike';
      else button('Equip', 'primary', () => { garage.equip(equip(loadout, it, DEFAULT_LOADOUT.wheels)); tried = null; render(); });
    } else if (st.kind === 'claim') {
      button('Claim', 'primary', () => purchase(it));
    } else if (st.kind === 'buy') {
      button(`Buy · 🪙 ${fmt(it.price)}`, 'primary', () => purchase(it));
    } else if (st.kind === 'poor') {
      note.textContent = `${fmt(st.short)} more credits needed`;
      button(`Buy · 🪙 ${fmt(it.price)}`, '', () => {}, true);
    } else {
      note.textContent = `🔒 ${st.reason}`;
    }
    el.addEventListener('click', () => { tried = tried?.id === it.id ? null : it; renderList(); showPreview(); });
    return el;
  }

  async function purchase(it: StoreItem) {
    if (busy) return;
    busy = true;
    try {
      garage.wallet = await buyItem(it.id);
      garage.equip(equip(garage.loadout(), it, DEFAULT_LOADOUT.wheels)); // wear it straight away
      o.toast(`${it.name}: yours! It’s on your bike now.`, 4500);
    } catch (e) {
      o.toast((e as Error).message, 5000);
    }
    busy = false;
    tried = null;
    render();
  }

  function renderStore() {
    const t = TABS.find((x) => x.id === tab)!;
    const frag: Node[] = [];
    for (const slot of t.slots) {
      if (t.slots.length > 1) frag.push(Object.assign(document.createElement('h3'), { className: 'riders-sub', textContent: SLOT_LABEL[slot] }));
      const grid = document.createElement('div');
      grid.className = 'gi-grid';
      grid.append(...ITEMS.filter((i) => i.slot === slot).map(card));
      frag.push(grid);
    }
    body.replaceChildren(...frag);
  }

  function renderList() {
    if (tab === 'week') renderWeek();
    else renderStore();
  }

  // ------------------------------------------------------------ weekly ----

  function renderWeek() {
    const signedIn = !!garage.wallet;
    const w = week ?? previewWeek();
    const left = Math.max(0, w.endsAt.getTime() - Date.now());
    const days = Math.floor(left / 86400000);
    const hours = Math.floor((left % 86400000) / 3600000);
    const top = document.createElement('p');
    top.className = 'muted small';
    top.textContent = signedIn
      ? `New challenges every Monday (UTC). ${days > 0 ? `${days} d ${hours} h` : `${hours} h`} left this week. Finish one and claim it for credits.`
      : 'Here is what you could earn this week. Sign in, ride, and claim the credits.';
    const list = document.createElement('div');
    list.className = 'gc-list';
    for (const c of w.challenges) {
      const done = isComplete(c);
      const el = document.createElement('div');
      el.className = `gc${c.claimed ? ' claimed' : done ? ' done' : ''}`;
      const pct = Math.min(100, Math.round((c.progress / c.target) * 100));
      el.innerHTML = '<div class="gc-top"><strong></strong><span class="gc-reward"></span></div><div class="gar-bar"><i></i></div><div class="gc-foot"><span class="gc-prog"></span></div>';
      el.querySelector('strong')!.textContent = c.title;
      el.querySelector('.gc-reward')!.textContent = `🪙 ${c.reward}`;
      (el.querySelector('.gar-bar i') as HTMLElement).style.width = `${pct}%`;
      el.querySelector('.gc-prog')!.textContent = signedIn ? progressText(c, o.imperial()) : `Target: ${progressText({ ...c, progress: 0 }, o.imperial()).split(' / ')[1]}`;
      const foot = el.querySelector('.gc-foot')!;
      if (c.claimed) foot.append(Object.assign(document.createElement('span'), { className: 'gi-note', textContent: '✓ Claimed' }));
      else if (signedIn && done) {
        const b = document.createElement('button');
        b.className = 'primary';
        b.textContent = `Claim 🪙 ${c.reward}`;
        b.disabled = busy;
        b.addEventListener('click', async () => {
          busy = true;
          try {
            garage.wallet = await claimChallenge(c.id);
            o.toast(`+${c.reward} credits for “${c.title}”!`, 4000);
            week = await fetchChallenges();
          } catch (e) { o.toast((e as Error).message, 5000); }
          busy = false;
          render();
        });
        foot.append(b);
      }
      list.append(el);
    }
    const kids: Node[] = [top, list];
    if (weekError) kids.push(Object.assign(document.createElement('p'), { className: 'muted small', textContent: weekError }));
    if (!signedIn) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = 'Sign in to start';
      b.addEventListener('click', () => { dialog.close(); o.openSignIn('Sign in to take on this week’s challenges and earn credits.'); });
      kids.push(b);
    }
    body.replaceChildren(...kids);
  }

  async function loadWeek() {
    weekError = '';
    if (!garage.wallet) { week = null; renderList(); return; }
    try {
      week = await fetchChallenges();
    } catch (e) {
      weekError = `Couldn’t load your progress: ${(e as Error).message}`;
    }
    if (tab === 'week') renderList();
  }

  // -------------------------------------------------------------- shell ----

  function render() {
    renderHead();
    renderTabs();
    renderList();
    showPreview();
  }

  dialog.addEventListener('close', () => {
    preview?.dispose();
    preview = null;
    tried = null;
  });


  return {
    async open(startTab: TabId = 'bikes') {
      tab = startTab;
      tried = null;
      week = null;
      preview?.dispose();
      preview = new GaragePreview(canvas);
      dialog.showModal();
      preview.start();
      render();
      garage.refresh().then(() => { if (dialog.open) { render(); if (tab === 'week') loadWeek(); } });
      if (tab === 'week') loadWeek();
    },
    refresh: render,
  };
}


