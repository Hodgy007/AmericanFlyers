// ☰ Menu → Rivals: pick one of the four AI rivals to ride the stage with, see
// your head-to-head record and what they remember. Without the AI turned on a
// rival still rides and talks (ready-made lines); the AI adds fresh lines and
// a memory.

import type { RivalRecord } from '../cloud/aiApi';
import { RIVALS, type RivalProfile } from './rivals';

export interface RivalsUiDeps {
  signedIn(): boolean;
  rivalsOn(): boolean;
  /** The rival riding with you now, if any. */
  active(): string | null;
  start(id: string): void;
  stop(): void;
  openSettings(): void;
  openSignIn(): void;
  records(): Promise<RivalRecord[]>;
  forget(id?: string): Promise<boolean>;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function recordText(r: RivalRecord | undefined): string {
  if (!r || r.rides === 0) return 'No rides together yet';
  const ago = r.last_ride ? ` · last ${new Date(r.last_ride).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : '';
  return `You ${r.wins} – ${r.losses} them · ${r.rides} ride${r.rides === 1 ? '' : 's'}${ago}`;
}

export function initRivalsUi(deps: RivalsUiDeps) {
  const dialog = document.getElementById('rivals') as HTMLDialogElement;
  const list = document.getElementById('rivals-list')!;
  const note = document.getElementById('rivals-note')!;
  let records = new Map<string, RivalRecord>();
  let seq = 0;

  function card(r: RivalProfile) {
    const rec = records.get(r.id);
    const active = deps.active() === r.id;
    const el = h('article', `rival-card${active ? ' active' : ''}`);
    el.dataset.rival = r.id;
    const swatch = h('div', 'rival-swatch');
    swatch.style.background = `linear-gradient(135deg, ${r.jersey} 0 50%, ${r.accent} 50% 100%)`;
    swatch.style.borderColor = r.frame;
    swatch.textContent = r.emoji;
    const info = h('div', 'rival-info');
    info.append(h('strong', '', r.name), h('span', 'rival-tag', r.tagline), h('span', 'rival-record', recordText(rec)));
    if (rec?.notes.length) {
      const mem = h('ul', 'rival-memory');
      for (const n of rec.notes.slice(-3)) mem.append(h('li', '', n));
      info.append(h('span', 'rival-remember', `${r.short} remembers`), mem);
    }
    const actions = h('div', 'rival-actions');
    const go = h('button', active ? '' : 'primary', active ? `Stop riding with ${r.short.split(' ')[0]}` : `Ride with ${r.short.split(' ')[0]}`);
    go.type = 'button';
    go.addEventListener('click', () => { if (active) deps.stop(); else deps.start(r.id); dialog.close(); });
    actions.append(go);
    if (rec && rec.rides > 0) {
      const f = h('button', 'link', 'Forget me');
      f.type = 'button';
      f.addEventListener('click', async () => {
        if (await deps.forget(r.id)) { records.delete(r.id); render(); }
      });
      actions.append(f);
    }
    el.append(swatch, info, actions);
    return el;
  }

  function render() {
    list.replaceChildren(...RIVALS.map(card));
    note.replaceChildren();
    if (!deps.signedIn()) {
      note.append(h('span', '', 'Rivals ride and chat with ready-made lines. Sign in and turn on AI rivals to get fresh lines and rivals who remember you. '));
      const b = h('button', 'link', 'Sign in');
      b.type = 'button';
      b.addEventListener('click', () => { dialog.close(); deps.openSignIn(); });
      note.append(b);
    } else if (!deps.rivalsOn()) {
      note.append(h('span', '', 'Turn on AI rivals in Settings to get fresh lines and rivals who remember you. '));
      const b = h('button', 'link', 'Open settings');
      b.type = 'button';
      b.addEventListener('click', () => { dialog.close(); deps.openSettings(); });
      note.append(b);
    } else {
      note.textContent = 'Demo rides and sped-up rides don’t count in your record.';
    }
  }

  return {
    async open() {
      records = new Map();
      render();
      dialog.showModal();
      if (deps.signedIn() && deps.rivalsOn()) {
        const mine = ++seq;
        const rows = await deps.records();
        if (mine === seq && dialog.open) { records = new Map(rows.map((r) => [r.rival, r])); render(); }
      }
    },
  };
}
