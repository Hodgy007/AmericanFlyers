// Workout library (built-in, uploaded, created) and the workout creator.

import { formatTime } from '../hud';
import { parseWorkoutFile, toZwo, newId } from './files';
import { drawWorkout } from './graph';
import { allWorkouts, deleteWorkout, saveWorkout } from './library';
import { estimateTss, expand, totalDuration, type Block, type Workout } from './model';

export interface WorkoutUiHooks {
  ftp(): number;
  ride(w: Workout): void;
  toast(msg: string, ms?: number): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initWorkoutUi(hooks: WorkoutUiHooks) {
  const library = $<HTMLDialogElement>('workouts');
  const creator = $<HTMLDialogElement>('creator');

  // ------------------------------------------------------------ library ----

  function renderLibrary() {
    const list = $('workout-list');
    list.replaceChildren();
    const ftp = hooks.ftp();
    for (const w of allWorkouts()) {
      const steps = expand(w.blocks);
      const card = document.createElement('div');
      card.className = 'workout-card';
      card.innerHTML = `
        <canvas class="workout-thumb"></canvas>
        <div class="workout-info">
          <div class="workout-title"><strong></strong> <span class="badge"></span></div>
          <div class="workout-meta">${formatTime(totalDuration(steps))} · TSS ${estimateTss(steps)}</div>
          <div class="workout-desc"></div>
        </div>
        <div class="workout-actions">
          <button type="button" class="primary" data-act="ride">Ride</button>
          <button type="button" data-act="edit">${w.source === 'builtin' ? 'Copy & edit' : 'Edit'}</button>
          <button type="button" data-act="export" title="Download as .zwo">.zwo</button>
          ${w.source === 'builtin' ? '' : '<button type="button" data-act="delete" aria-label="Delete" title="Delete">🗑</button>'}
        </div>`;
      card.querySelector('strong')!.textContent = w.name;
      card.querySelector('.badge')!.textContent = { builtin: 'Built-in', uploaded: 'Uploaded', custom: 'My workout' }[w.source];
      card.querySelector('.workout-desc')!.textContent = w.description || `Targets at your FTP of ${ftp} W.`;
      card.querySelector('[data-act=ride]')!.addEventListener('click', () => { library.close(); hooks.ride(w); });
      card.querySelector('[data-act=edit]')!.addEventListener('click', () => {
        const draft = w.source === 'builtin' ? { ...structuredClone(w), id: newId(), name: `${w.name} (copy)`, source: 'custom' as const } : structuredClone(w);
        library.close();
        openCreator(draft);
      });
      card.querySelector('[data-act=export]')!.addEventListener('click', () => download(`${w.name}.zwo`, toZwo(w)));
      card.querySelector('[data-act=delete]')?.addEventListener('click', () => {
        if (!confirm(`Delete "${w.name}"?`)) return;
        deleteWorkout(w.id);
        renderLibrary();
      });
      list.append(card);
      requestAnimationFrame(() => drawWorkout(card.querySelector('canvas')!, steps));
    }
  }

  function openLibrary() {
    library.showModal();
    renderLibrary();
  }

  $<HTMLInputElement>('workout-upload').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const added: string[] = [];
    for (const file of Array.from(input.files ?? [])) {
      try {
        const w = parseWorkoutFile(file.name, await file.text(), hooks.ftp());
        if (!saveWorkout(w)) hooks.toast('Couldn’t save to this browser’s storage; the workout is available until you reload.');
        added.push(w.name);
      } catch (err) {
        hooks.toast(`${file.name}: ${(err as Error).message}`, 6000);
      }
    }
    input.value = '';
    if (added.length) hooks.toast(`Added ${added.join(', ')}`);
    renderLibrary();
  });
  $('workout-new').addEventListener('click', () => {
    library.close();
    openCreator({
      id: newId(),
      name: 'My workout',
      description: '',
      source: 'custom',
      blocks: [
        { kind: 'ramp', duration: 600, from: 0.5, to: 0.75 },
        { kind: 'intervals', repeats: 4, onDuration: 300, onPower: 1.0, offDuration: 180, offPower: 0.55 },
        { kind: 'ramp', duration: 300, from: 0.6, to: 0.4 },
      ],
    });
  });

  // ------------------------------------------------------------ creator ----

  let draft: Workout;

  function openCreator(w: Workout) {
    draft = w;
    const form = creator.querySelector('form')!;
    (form.elements.namedItem('name') as HTMLInputElement).value = w.name;
    (form.elements.namedItem('description') as HTMLInputElement).value = w.description;
    creator.showModal();
    renderBlocks();
  }

  function renderBlocks() {
    const box = $('creator-blocks');
    box.replaceChildren();
    const ftp = hooks.ftp();
    draft.blocks.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'block-row';
      const title = { steady: 'Steady', ramp: 'Ramp', intervals: 'Intervals', free: 'Free ride' }[b.kind];
      row.innerHTML = `<span class="block-kind kind-${b.kind}">${title}</span><div class="block-fields"></div>
        <div class="block-tools">
          <button type="button" class="icon" data-op="up" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
          <button type="button" class="icon" data-op="down" aria-label="Move down" ${i < draft.blocks.length - 1 ? '' : 'disabled'}>↓</button>
          <button type="button" class="icon" data-op="copy" aria-label="Duplicate" title="Duplicate">⧉</button>
          <button type="button" class="icon" data-op="del" aria-label="Remove" title="Remove">✕</button>
        </div>`;
      const fields = row.querySelector('.block-fields')!;
      const time = (label: string, key: string) => field(fields, label, formatTime((b as any)[key]), 'text', (v) => {
        const s = parseDuration(v);
        if (s !== null) { (b as any)[key] = s; changed(); }
      });
      const pct = (label: string, key: string) => field(fields, label, String(Math.round((b as any)[key] * 100)), 'number', (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) { (b as any)[key] = n / 100; changed(); }
      }, () => `${Math.round((b as any)[key] * ftp)} W`);
      switch (b.kind) {
        case 'steady': time('Time', 'duration'); pct('% FTP', 'power'); break;
        case 'ramp': time('Time', 'duration'); pct('From %', 'from'); pct('To %', 'to'); break;
        case 'intervals':
          field(fields, 'Repeats', String(b.repeats), 'number', (v) => { const n = Math.round(Number(v)); if (n >= 1) { b.repeats = n; changed(); } });
          time('On', 'onDuration'); pct('On %', 'onPower'); time('Off', 'offDuration'); pct('Off %', 'offPower');
          break;
        case 'free': time('Time', 'duration'); break;
      }
      row.querySelectorAll<HTMLButtonElement>('[data-op]').forEach((btn) => btn.addEventListener('click', () => {
        const op = btn.dataset.op;
        if (op === 'up' || op === 'down') {
          const j = i + (op === 'up' ? -1 : 1);
          [draft.blocks[i], draft.blocks[j]] = [draft.blocks[j], draft.blocks[i]];
        } else if (op === 'copy') {
          draft.blocks.splice(i + 1, 0, structuredClone(b));
        } else {
          draft.blocks.splice(i, 1);
        }
        renderBlocks();
      }));
      box.append(row);
    });
    preview();
  }

  /** Re-renders the preview without rebuilding the inputs being typed in. */
  function changed() {
    preview();
    creator.querySelectorAll<HTMLElement>('[data-watts]').forEach((el) => { el.textContent = (el as any).watts(); });
  }

  function preview() {
    const steps = expand(draft.blocks);
    drawWorkout($<HTMLCanvasElement>('creator-graph'), steps);
    const T = totalDuration(steps);
    const ftp = hooks.ftp();
    const avg = T ? steps.reduce((a, s) => a + ((s.free ? 0.5 : (s.start + s.end) / 2) * s.duration), 0) / T : 0;
    $('creator-summary').textContent = draft.blocks.length
      ? `${formatTime(T)} · TSS ${estimateTss(steps)} · average ${Math.round(avg * ftp)} W at your FTP of ${ftp} W`
      : 'Add some blocks below to build your workout.';
  }

  creator.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    const add: Record<string, Block> = {
      steady: { kind: 'steady', duration: 300, power: 0.75 },
      ramp: { kind: 'ramp', duration: 300, from: 0.5, to: 0.8 },
      intervals: { kind: 'intervals', repeats: 5, onDuration: 60, onPower: 1.2, offDuration: 60, offPower: 0.5 },
      free: { kind: 'free', duration: 300 },
    };
    draft.blocks.push(structuredClone(add[btn.dataset.add!]));
    renderBlocks();
    $('creator-blocks').lastElementChild?.scrollIntoView({ block: 'nearest' });
  }));

  function readMeta() {
    const form = creator.querySelector('form')!;
    draft.name = (form.elements.namedItem('name') as HTMLInputElement).value.trim() || 'My workout';
    draft.description = (form.elements.namedItem('description') as HTMLInputElement).value.trim();
  }

  $('creator-export').addEventListener('click', () => {
    readMeta();
    download(`${draft.name}.zwo`, toZwo(draft));
  });

  creator.addEventListener('close', () => {
    const action = creator.returnValue;
    if (action !== 'save' && action !== 'ride') return;
    readMeta();
    if (!draft.blocks.length) { hooks.toast('A workout needs at least one block.'); return; }
    if (!saveWorkout(draft)) hooks.toast('Couldn’t save to this browser’s storage; the workout is available until you reload.');
    if (action === 'ride') hooks.ride(draft);
    else { hooks.toast(`Saved "${draft.name}"`); openLibrary(); }
  });

  // The hub's "Create a workout" opens the creator on a fresh workout (same as ＋ Create in the library).
  return { openLibrary, newWorkout: () => $('workout-new').click() };
}

// -------------------------------------------------------------- helpers ----

function field(parent: Element, label: string, value: string, type: 'text' | 'number', onInput: (v: string) => void, hint?: () => string) {
  const wrap = document.createElement('label');
  wrap.className = 'block-field';
  wrap.innerHTML = `<span></span><input type="${type}" ${type === 'number' ? 'min="0" step="1"' : 'inputmode="numeric" placeholder="m:ss"'} />`;
  wrap.querySelector('span')!.textContent = label;
  const input = wrap.querySelector('input')!;
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  if (hint) {
    const h = document.createElement('small');
    h.dataset.watts = '';
    (h as any).watts = hint;
    h.textContent = hint();
    wrap.append(h);
  }
  parent.append(wrap);
}

/** "5" → 5 min, "1:30" → 90 s, "45s" → 45 s, "1:00:00" → 1 h. */
export function parseDuration(v: string): number | null {
  const t = v.trim().toLowerCase();
  if (/^\d+(\.\d+)?s$/.test(t)) return Math.round(parseFloat(t));
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  const s = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
  return s > 0 ? s : null;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, '-');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
