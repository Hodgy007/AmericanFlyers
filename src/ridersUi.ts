// The 👥 button and the "Riding now" list: who else is on this stage, how far
// ahead or behind they are, and a button to start riding alongside them.

import { account } from './cloud/account';
import type { Presence } from './cloud/presence';
import { EMOTES } from './cloud/rideOns';

const KM_PER_MI = 1.609344;

interface Options {
  presence: Presence;
  me: () => { distance: number; stageName: string; imperial: boolean; enabled: boolean };
  rideWith: (distance: number, name: string, speedMs?: number) => void;
  openSignIn: (why: string) => void;
  openSettings: () => void;
  toast: (msg: string, ms?: number) => void;
  /** Computer-ridden pro teams on the road (empty when switched off). */
  teams: () => { id: string; name: string; color: string; wkg: number; riders: number; distance: number; back: number; speedMs: number }[];
  riderKg: () => number;
  /** Sends a ride-on (an emoji) to a rider on the list; see rideOnsUi.ts. */
  sendRideOn: (id: string, name: string, emote: string) => void;
}

function gapText(gap: number, imperial: boolean) {
  const a = Math.abs(gap);
  if (a < 15) return 'right with you';
  const text = a < 1000
    ? `${Math.round(imperial ? a * 3.28084 : a)} ${imperial ? 'ft' : 'm'}`
    : `${(imperial ? a / 1000 / KM_PER_MI : a / 1000).toFixed(1)} ${imperial ? 'mi' : 'km'}`;
  return `${text} ${gap > 0 ? 'ahead' : 'behind'}`;
}

export function initRidersUi(o: Options) {
  const btn = document.getElementById('btn-riders') as HTMLButtonElement;
  const dialog = document.getElementById('riders') as HTMLDialogElement;
  const list = document.getElementById('riders-list')!;
  const note = document.getElementById('riders-note')!;
  let known = new Set<string>();
  let refresh = 0;

  const label = () => {
    const n = o.presence.count;
    btn.textContent = n ? `👥 ${n}` : '👥';
    btn.classList.toggle('live', n > 0);
    btn.title = n ? `${n} other rider${n === 1 ? '' : 's'} on this stage` : 'Riding together';
  };

  o.presence.onChange = (riders) => {
    const ids = new Set(riders.map((r) => r.id));
    // Say hello to newcomers (but not to everyone already there when you arrive).
    if (known.size || riders.length === 1) {
      const fresh = riders.filter((r) => !known.has(r.id));
      if (fresh.length === 1) o.toast(`${fresh[0].name} is riding ${o.me().stageName} with you`);
      else if (fresh.length > 1) o.toast(`${fresh.length} riders joined you on ${o.me().stageName}`);
    }
    known = ids;
    label();
    if (dialog.open) render();
  };

  /**
   * Rows are kept between refreshes (keyed by id) and only their text changes,
   * so a button doesn't vanish under the pointer as the list updates.
   */
  type RowInfo = { name: string; gap: string; stats: string; button?: { label: string; title: string; onClick: () => void }; color?: string; emotes?: boolean };
  function syncRows(container: HTMLElement, items: [string, RowInfo][], className: string) {
    const keep = new Set(items.map(([id]) => id));
    for (const el of [...container.children] as HTMLElement[]) if (!keep.has(el.dataset.id!)) el.remove();
    items.forEach(([id, info], i) => {
      let row = container.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      if (!row) {
        row = document.createElement('li');
        row.className = className;
        row.dataset.id = id;
        row.innerHTML = '<span class="rider-dot"></span><span class="rider-name"></span><span class="rider-gap"></span><span class="rider-stats"></span>';
        const b = document.createElement('button');
        b.type = 'button';
        b.addEventListener('click', () => (row as HTMLElement & { act?: () => void }).act?.());
        row.append(b);
        if (info.emotes) {
          // Ride-ons: a quick emoji to this rider.
          const bar = document.createElement('span');
          bar.className = 'rider-emotes';
          for (const emote of EMOTES) {
            const e = document.createElement('button');
            e.type = 'button';
            e.className = 'emote';
            e.textContent = emote;
            e.title = `Send ${emote} to this rider`;
            e.addEventListener('click', () => o.sendRideOn(row!.dataset.id!, row!.querySelector('.rider-name')!.textContent ?? '', emote));
            bar.append(e);
          }
          row.append(bar);
        }
      }
      if (info.color) row.style.setProperty('--team', info.color);
      row.querySelector('.rider-name')!.textContent = info.name;
      row.querySelector('.rider-gap')!.textContent = info.gap;
      row.querySelector('.rider-stats')!.textContent = info.stats;
      const b = row.querySelector('button')!;
      b.hidden = !info.button;
      if (info.button) { b.textContent = info.button.label; b.title = info.button.title; }
      (row as HTMLElement & { act?: () => void }).act = info.button?.onClick;
      if (container.children[i] !== row) container.insertBefore(row, container.children[i] ?? null);
    });
  }

  function render() {
    const me = o.me();
    renderTeams(me);
    if (!account()) {
      list.replaceChildren();
      note.textContent = 'Sign in (free) to see and ride with real riders on the same stage too.';
      return;
    }
    if (!me.enabled) {
      list.replaceChildren();
      note.textContent = 'Riding together is switched off in Settings, so nobody sees you and you don’t see them.';
      return;
    }
    const riders = o.presence.riders().sort((a, b) => b.distance - a.distance);
    note.textContent = riders.length
      ? `Everyone signed in and riding ${me.stageName} right now. They see you too.`
      : `Nobody else is riding ${me.stageName} right now. Share the link and ride together: anyone on this stage appears on the road with you.`;
    syncRows(list, riders.map((r) => {
      const gap = r.distance - me.distance;
      const kmh = r.speedMs * 3.6;
      return [r.id, {
        name: r.name,
        gap: gapText(gap, me.imperial),
        stats: `${Math.round(r.power)} W · ${(me.imperial ? kmh / KM_PER_MI : kmh).toFixed(1)} ${me.imperial ? 'mph' : 'km/h'}`,
        button: Math.abs(gap) >= 15 ? {
          label: 'Ride with',
          title: `Start a new ride next to ${r.name}`,
          onClick: () => { dialog.close(); o.rideWith(r.distance, r.name); },
        } : undefined,
        emotes: true,
      }];
    }), 'rider-row');
  }

  /** The pro teams, with their pace in watts for you, and a Join button. */
  function renderTeams(me: ReturnType<Options['me']>) {
    const teamsEl = document.getElementById('riders-teams')!;
    const teams = o.teams().sort((a, b) => b.distance - a.distance);
    (document.getElementById('riders-teams-head') as HTMLElement).hidden = !teams.length;
    syncRows(teamsEl, teams.map((t) => {
      const kmh = t.speedMs * 3.6;
      const watts = Math.round(t.wkg * o.riderKg());
      return [t.id, {
        name: t.name,
        color: t.color,
        gap: gapText(t.distance - me.distance, me.imperial),
        stats: `${t.riders} riders · ${t.wkg.toFixed(1)} W/kg (≈${watts} W for you) · ${(me.imperial ? kmh / KM_PER_MI : kmh).toFixed(1)} ${me.imperial ? 'mph' : 'km/h'}`,
        button: {
          label: 'Join',
          title: `Start a new ride on the back of ${t.name}`,
          onClick: () => {
            const now = o.teams().find((x) => x.id === t.id) ?? t; // where they are at the moment of the click
            dialog.close();
            o.rideWith(now.back, now.name, now.speedMs);
          },
        },
      }];
    }), 'rider-row team-row');
  }

  btn.addEventListener('click', () => {
    render();
    dialog.showModal();
    clearInterval(refresh);
    refresh = window.setInterval(() => (dialog.open ? render() : clearInterval(refresh)), 1000);
  });
  document.getElementById('riders-settings')!.addEventListener('click', () => {
    dialog.close();
    o.openSettings();
  });

  label();
  const copy = document.getElementById('riders-share')!;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      o.toast('Link copied. Anyone who opens it rides this stage with you.');
    } catch {
      o.toast(location.href, 8000);
    }
  });
  return { refresh: label };
}
