// The data blocks across the top of the screen. The rider picks which fields
// to show and in what order; the first one is drawn larger.

import { gradeColor } from './profile';
import type { Settings } from './settings';
import type { RideStats } from './stats';
import { zoneColor } from './workouts/model';

const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;

export interface HudContext {
  settings: Settings;
  power3s: number;
  power1s: number;
  cadence: number;
  speedMs: number;
  hr: number;
  distance: number; // metres ridden
  toGo: number | null; // metres left on a stage with a finish
  movingTime: number;
  grade: number;
  climbed: number;
  elevation: number;
  stats: RideStats;
  workout: { target: number | null; stepLeft: number; workoutLeft: number; label: string } | null;
}

interface Field {
  id: string;
  label: string;
  value(c: HudContext): string;
  unit?(c: HudContext): string;
  sub?(c: HudContext): string; // small line under the value
  accent?(c: HudContext): string | undefined; // tile highlight colour
}

const imperial = (c: HudContext) => c.settings.units === 'imperial';
const km = (c: HudContext, m: number) => (m / 1000 / (imperial(c) ? KM_PER_MI : 1)).toFixed(2);
const kmh = (c: HudContext, ms: number) => ((ms * 3.6) / (imperial(c) ? KM_PER_MI : 1)).toFixed(1);
const watts = (w: number) => String(Math.round(w));
const dash = (v: number, f: (v: number) => string) => (v > 0 ? f(v) : '--');

export function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function powerZone(ratio: number) {
  if (ratio < 0.55) return 'Z1 Recovery';
  if (ratio < 0.75) return 'Z2 Endurance';
  if (ratio < 0.9) return 'Z3 Tempo';
  if (ratio < 1.05) return 'Z4 Threshold';
  if (ratio < 1.2) return 'Z5 VO2 max';
  return 'Z6 Anaerobic';
}

export const FIELDS: Field[] = [
  {
    id: 'power', label: 'Power', value: (c) => watts(c.power3s), unit: () => 'W',
    sub: (c) => powerZone(c.power3s / c.settings.ftp), accent: (c) => zoneColor(c.power3s / c.settings.ftp),
  },
  { id: 'power1s', label: 'Power (1 s)', value: (c) => watts(c.power1s), unit: () => 'W', accent: (c) => zoneColor(c.power1s / c.settings.ftp) },
  { id: 'wkg', label: 'W/kg', value: (c) => (c.power3s / c.settings.riderKg).toFixed(1) },
  { id: 'avgPower', label: 'Avg power', value: (c) => watts(c.stats.avgPower), unit: () => 'W' },
  { id: 'np', label: 'Norm. power', value: (c) => watts(c.stats.np), unit: () => 'W' },
  { id: 'maxPower', label: 'Max power', value: (c) => watts(c.stats.maxPower), unit: () => 'W' },
  {
    id: 'target', label: 'Target', unit: () => 'W',
    value: (c) => (c.workout?.target ? String(c.workout.target) : '--'),
    sub: (c) => c.workout?.label ?? 'No workout',
    accent: (c) => (c.workout?.target ? zoneColor(c.workout.target / c.settings.ftp) : undefined),
  },
  { id: 'intervalLeft', label: 'Interval left', value: (c) => (c.workout ? formatTime(c.workout.stepLeft) : '--') },
  { id: 'workoutLeft', label: 'Workout left', value: (c) => (c.workout ? formatTime(c.workout.workoutLeft) : '--') },
  { id: 'cadence', label: 'Cadence', value: (c) => String(Math.round(c.cadence)), unit: () => 'rpm' },
  { id: 'avgCadence', label: 'Avg cadence', value: (c) => dash(c.stats.avgCadence, (v) => String(Math.round(v))), unit: () => 'rpm' },
  { id: 'speed', label: 'Speed', value: (c) => kmh(c, c.speedMs), unit: (c) => (imperial(c) ? 'mph' : 'km/h') },
  {
    id: 'avgSpeed', label: 'Avg speed', unit: (c) => (imperial(c) ? 'mph' : 'km/h'),
    value: (c) => (c.movingTime > 0 ? kmh(c, c.distance / c.movingTime) : '--'),
  },
  { id: 'hr', label: 'Heart rate', value: (c) => dash(c.hr, (v) => String(Math.round(v))), unit: () => 'bpm' },
  { id: 'avgHr', label: 'Avg HR', value: (c) => dash(c.stats.avgHr, (v) => String(Math.round(v))), unit: () => 'bpm' },
  { id: 'maxHr', label: 'Max HR', value: (c) => dash(c.stats.maxHr, (v) => String(Math.round(v))), unit: () => 'bpm' },
  { id: 'distance', label: 'Distance', value: (c) => km(c, c.distance), unit: (c) => (imperial(c) ? 'mi' : 'km') },
  { id: 'toGo', label: 'To go', value: (c) => (c.toGo === null ? '--' : km(c, Math.max(0, c.toGo))), unit: (c) => (imperial(c) ? 'mi' : 'km') },
  { id: 'time', label: 'Time', value: (c) => formatTime(c.movingTime) },
  {
    id: 'grade', label: 'Grade', unit: () => '%',
    value: (c) => (Math.abs(c.grade) < 0.0005 ? 0 : c.grade * 100).toFixed(1), accent: (c) => gradeColor(c.grade),
  },
  { id: 'climbed', label: 'Climbed', value: (c) => String(Math.round(c.climbed * (imperial(c) ? FT_PER_M : 1))), unit: (c) => (imperial(c) ? 'ft' : 'm') },
  { id: 'elevation', label: 'Elevation', value: (c) => String(Math.round(c.elevation * (imperial(c) ? FT_PER_M : 1))), unit: (c) => (imperial(c) ? 'ft' : 'm') },
  { id: 'kj', label: 'Energy', value: (c) => String(Math.round(c.stats.work / 1000)), unit: () => 'kJ' },
  { id: 'tss', label: 'TSS', value: (c) => String(Math.round(c.stats.tss(c.settings.ftp))) },
];

export const DEFAULT_FIELDS = ['power', 'cadence', 'speed', 'hr', 'distance', 'time', 'grade', 'climbed'];
export const MAX_FIELDS = 12;

const byId = new Map(FIELDS.map((f) => [f.id, f]));

/** Renders and refreshes the selected data blocks inside `container`. */
export class Hud {
  private tiles: { field: Field; el: HTMLElement; value: HTMLElement; unit: HTMLElement; sub: HTMLElement | null }[] = [];

  constructor(private readonly container: HTMLElement) {}

  setFields(ids: string[]) {
    this.container.replaceChildren();
    this.tiles = [];
    ids.map((id) => byId.get(id)).filter((f): f is Field => !!f).forEach((field, i) => {
      const el = document.createElement('div');
      el.className = 'tile' + (i === 0 ? ' hero' : '');
      el.innerHTML = `<div class="label"></div><div class="value"><span></span><small></small></div>${field.sub ? '<div class="sub"></div>' : ''}`;
      el.querySelector('.label')!.textContent = field.label;
      this.container.append(el);
      this.tiles.push({ field, el, value: el.querySelector('.value span')!, unit: el.querySelector('.value small')!, sub: el.querySelector('.sub') });
    });
    // One row with the first tile wider; beyond 8 tiles, two rows with the first spanning both.
    const n = this.tiles.length;
    const rest = n > 8 ? Math.ceil((n - 1) / 2) : n - 1;
    this.container.style.gridTemplateColumns = n > 1 ? `1.6fr repeat(${rest}, minmax(0, 1fr))` : 'minmax(0, 260px)';
    if (this.tiles[0]) this.tiles[0].el.style.gridRow = n > 8 ? 'span 2' : '';
  }

  update(c: HudContext) {
    for (const t of this.tiles) {
      t.value.textContent = t.field.value(c);
      t.unit.textContent = t.field.unit?.(c) ?? '';
      if (t.sub) t.sub.textContent = t.field.sub!(c);
      const accent = t.field.accent?.(c);
      if (accent) t.el.style.setProperty('--accent', accent);
      else t.el.style.removeProperty('--accent');
      t.el.classList.toggle('accented', !!accent);
    }
  }
}

/** The "Data blocks" chooser: tick fields and reorder them. */
export function openDataBlocks(dialog: HTMLDialogElement, current: string[], onSave: (ids: string[]) => void) {
  let selected = current.filter((id) => byId.has(id));
  const list = dialog.querySelector<HTMLElement>('.field-list')!;
  const count = dialog.querySelector<HTMLElement>('.field-count')!;

  const render = () => {
    list.replaceChildren();
    // Selected fields first (in display order), then the rest.
    const order = [...selected, ...FIELDS.map((f) => f.id).filter((id) => !selected.includes(id))];
    for (const id of order) {
      const f = byId.get(id)!;
      const on = selected.includes(id);
      const row = document.createElement('div');
      row.className = 'field-row' + (on ? ' on' : '');
      row.innerHTML = `
        <label><input type="checkbox" ${on ? 'checked' : ''}/> <span></span></label>
        <span class="field-pos">${on ? (selected.indexOf(id) === 0 ? 'Large' : `#${selected.indexOf(id) + 1}`) : ''}</span>
        <button type="button" class="icon" data-move="-1" aria-label="Move up" ${on && selected.indexOf(id) > 0 ? '' : 'disabled'}>↑</button>
        <button type="button" class="icon" data-move="1" aria-label="Move down" ${on && selected.indexOf(id) < selected.length - 1 ? '' : 'disabled'}>↓</button>`;
      row.querySelector('span')!.textContent = f.label;
      row.querySelector('input')!.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
          if (selected.length >= MAX_FIELDS) { (e.target as HTMLInputElement).checked = false; return; }
          selected.push(id);
        } else {
          selected = selected.filter((x) => x !== id);
        }
        render();
      });
      row.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = selected.indexOf(id);
          const j = i + Number(b.dataset.move);
          [selected[i], selected[j]] = [selected[j], selected[i]];
          render();
        }),
      );
      list.append(row);
    }
    count.textContent = `${selected.length} of ${MAX_FIELDS} shown`;
  };
  render();

  dialog.querySelector<HTMLButtonElement>('[data-reset]')!.onclick = () => { selected = [...DEFAULT_FIELDS]; render(); };
  dialog.onclose = () => {
    if (dialog.returnValue === 'save' && selected.length) onSave(selected);
  };
  dialog.showModal();
}
