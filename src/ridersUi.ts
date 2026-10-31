// The 👥 button and the "Riding now" list: who else is on this stage, how far
// ahead or behind they are, and a button to start riding alongside them.

import { account } from './cloud/account';
import type { Presence } from './cloud/presence';

const KM_PER_MI = 1.609344;

interface Options {
  presence: Presence;
  me: () => { distance: number; stageName: string; imperial: boolean; enabled: boolean };
  rideWith: (distance: number, name: string) => void;
  openSignIn: (why: string) => void;
  openSettings: () => void;
  toast: (msg: string, ms?: number) => void;
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

  function render() {
    const me = o.me();
    list.replaceChildren();
    if (!account()) {
      note.textContent = 'Sign in (free) to see and ride with everyone on the same stage.';
      return;
    }
    if (!me.enabled) {
      note.textContent = 'Riding together is switched off in Settings, so nobody sees you and you don’t see them.';
      return;
    }
    const riders = o.presence.riders().sort((a, b) => b.distance - a.distance);
    note.textContent = riders.length
      ? `Everyone signed in and riding ${me.stageName} right now. They see you too.`
      : `Nobody else is riding ${me.stageName} right now. Share the link and ride together: anyone on this stage appears on the road with you.`;
    for (const r of riders) {
      const row = document.createElement('li');
      row.className = 'rider-row';
      const gap = r.distance - me.distance;
      const kmh = r.speedMs * 3.6;
      row.innerHTML = '<span class="rider-dot"></span><span class="rider-name"></span><span class="rider-gap"></span><span class="rider-stats"></span>';
      row.querySelector('.rider-name')!.textContent = r.name;
      row.querySelector('.rider-gap')!.textContent = gapText(gap, me.imperial);
      row.querySelector('.rider-stats')!.textContent =
        `${Math.round(r.power)} W · ${(me.imperial ? kmh / KM_PER_MI : kmh).toFixed(1)} ${me.imperial ? 'mph' : 'km/h'}`;
      if (Math.abs(gap) >= 15) {
        const join = document.createElement('button');
        join.textContent = 'Ride with';
        join.title = `Start a new ride next to ${r.name}`;
        join.addEventListener('click', () => {
          dialog.close();
          o.rideWith(r.distance, r.name);
        });
        row.append(join);
      }
      list.append(row);
    }
  }

  btn.addEventListener('click', () => {
    if (!account()) {
      o.openSignIn('Sign in (free) to ride with other riders. Anyone on the same stage appears on the road with you.');
      return;
    }
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
