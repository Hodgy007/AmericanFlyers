import type { TimeOfDay, Weather } from './settings';

// ☰ Menu → Time & weather: two choices, applied the moment you tap them.

const TIMES: { id: TimeOfDay; label: string }[] = [
  { id: 'auto', label: '⏱ Auto' },
  { id: 'dawn', label: '🌅 Dawn' },
  { id: 'day', label: '☀️ Day' },
  { id: 'dusk', label: '🌇 Dusk' },
  { id: 'night', label: '🌙 Night' },
];
const WEATHERS: { id: Weather; label: string }[] = [
  { id: 'auto', label: '⏱ Auto' },
  { id: 'clear', label: '☀️ Clear' },
  { id: 'cloudy', label: '☁️ Cloudy' },
  { id: 'rain', label: '🌧 Rain' },
];

export interface AtmosphereUiDeps {
  current(): { timeOfDay: TimeOfDay; weather: Weather };
  choose(patch: Partial<{ timeOfDay: TimeOfDay; weather: Weather }>): void;
}

export function initAtmosphereUi(deps: AtmosphereUiDeps) {
  const dialog = document.getElementById('atmosphere') as HTMLDialogElement;
  const timeSeg = document.getElementById('atmosphere-time')!;
  const weatherSeg = document.getElementById('atmosphere-weather')!;

  function fill<T extends string>(el: HTMLElement, options: { id: T; label: string }[], pick: (id: T) => void) {
    el.replaceChildren(
      ...options.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.id = o.id;
        b.textContent = o.label;
        b.addEventListener('click', () => { pick(o.id); render(); });
        return b;
      }),
    );
  }
  fill(timeSeg, TIMES, (id) => deps.choose({ timeOfDay: id }));
  fill(weatherSeg, WEATHERS, (id) => deps.choose({ weather: id }));

  function render() {
    const cur = deps.current();
    timeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === cur.timeOfDay)));
    weatherSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === cur.weather)));
  }

  return {
    open() {
      render();
      dialog.showModal();
    },
  };
}
