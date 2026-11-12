// Workout file import/export: Zwift .zwo (XML), and .erg / .mrc (text).

import { validateWorkout, WORKOUT_LIMITS, type Block, type Workout } from './model';

export const MAX_WORKOUT_FILE_BYTES = 2 * 1024 * 1024;

export function parseWorkoutFile(name: string, text: string, ftp: number): Workout {
  if (text.length > MAX_WORKOUT_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_WORKOUT_FILE_BYTES) {
    throw new Error('Workout files must be no larger than 2 MiB.');
  }
  const ext = name.toLowerCase().split('.').pop();
  const base = name.replace(/\.[^.]+$/, '');
  let workout: Workout;
  if (ext === 'zwo') workout = parseZwo(text, base);
  else if (ext === 'erg' || ext === 'mrc') workout = parseErgMrc(text, base, ftp);
  else throw new Error(`Unsupported file type ".${ext}". Use .zwo, .erg or .mrc.`);
  validateWorkout(workout);
  return workout;
}

// --------------------------------------------------------------- .zwo ----

function parseZwo(text: string, fallbackName: string): Workout {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This .zwo file is not valid XML.');
  const root = doc.querySelector('workout');
  if (!root) throw new Error('No <workout> section found in this .zwo file.');
  if (root.children.length > WORKOUT_LIMITS.blocks) throw new Error(`A workout file can contain at most ${WORKOUT_LIMITS.blocks} steps.`);

  const num = (el: Element, ...names: string[]) => {
    for (const n of names) {
      const v = el.getAttribute(n) ?? el.getAttribute(n.toLowerCase());
      if (v !== null && v !== '') return Number(v);
    }
    return NaN;
  };
  const blocks: Block[] = [];
  for (const el of Array.from(root.children)) {
    const duration = num(el, 'Duration');
    const cadence = el.getAttribute('Cadence') ?? el.getAttribute('cadence');
    const cad = cadence === null || cadence === '' ? undefined : Number(cadence);
    switch (el.tagName.toLowerCase()) {
      case 'warmup':
      case 'cooldown':
      case 'ramp':
        blocks.push({ kind: 'ramp', duration, from: num(el, 'PowerLow'), to: num(el, 'PowerHigh'), cadence: cad });
        break;
      case 'steadystate':
      case 'solidstate':
        blocks.push({ kind: 'steady', duration, power: num(el, 'Power', 'PowerLow'), cadence: cad });
        break;
      case 'intervalst':
        blocks.push({
          kind: 'intervals',
          repeats: num(el, 'Repeat'),
          onDuration: num(el, 'OnDuration'),
          onPower: num(el, 'OnPower', 'PowerOnHigh', 'PowerOnLow'),
          offDuration: num(el, 'OffDuration'),
          offPower: num(el, 'OffPower', 'PowerOffHigh', 'PowerOffLow'),
          cadence: cad,
        });
        break;
      case 'freeride':
      case 'maxeffort':
        blocks.push({ kind: 'free', duration });
        break;
      // Text events and unknown elements are ignored.
    }
  }
  if (!blocks.length) throw new Error('This .zwo file has no workout steps.');
  return {
    id: newId(),
    name: doc.querySelector('workout_file > name')?.textContent?.trim() || fallbackName,
    description: doc.querySelector('workout_file > description')?.textContent?.trim() || '',
    blocks,
    source: 'uploaded',
  };
}

// --------------------------------------------------------- .erg / .mrc ----
//
// [COURSE HEADER] … FTP = 250 … MINUTES WATTS (or PERCENT) [END COURSE HEADER]
// [COURSE DATA] then "minutes value" pairs; power changes linearly between points.

function parseErgMrc(text: string, fallbackName: string, riderFtp: number): Workout {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let fileFtp: number | undefined;
  let percent = false;
  let name = fallbackName;
  let description = '';
  const points: [number, number][] = [];
  let inData = false;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('[COURSE DATA]')) { inData = true; continue; }
    if (upper.startsWith('[END COURSE DATA]')) { inData = false; continue; }
    if (!inData) {
      const kv = line.match(/^(\w[\w ]*?)\s*=\s*(.+)$/);
      if (kv) {
        const key = kv[1].toUpperCase();
        if (key === 'FTP') {
          fileFtp = Number(kv[2]);
          if (!Number.isFinite(fileFtp) || fileFtp <= 0) throw new Error('The file FTP must be a finite, positive number.');
        }
        if (key === 'FILE NAME' || key === 'DESCRIPTION') {
          if (key === 'FILE NAME') name = kv[2].replace(/\.[^.]+$/, '');
          else description = kv[2];
        }
      }
      if (/MINUTES\s+PERCENT/.test(upper)) percent = true;
      continue;
    }
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)/);
    if (!m) throw new Error('Invalid time or power data in this workout file.');
    const time = Number(m[1]) * 60, power = Number(m[2]);
    if (!Number.isFinite(time) || time < 0 || time > WORKOUT_LIMITS.duration) {
      throw new Error('Workout timestamps must be finite and between 0 and 24 hours.');
    }
    if (!Number.isFinite(power) || power < 0) throw new Error('Workout power values must be finite and nonnegative.');
    if (points.length && time < points[points.length - 1][0]) throw new Error('Workout timestamps must be in increasing order.');
    if (points.length >= WORKOUT_LIMITS.blocks + 1) throw new Error(`A workout file can contain at most ${WORKOUT_LIMITS.blocks + 1} power points.`);
    points.push([time, power]);
  }
  if (points.length < 2) throw new Error('No power data found in this file.');
  const ftp = fileFtp ?? riderFtp;
  if (!percent && (!Number.isFinite(ftp) || ftp <= 0)) throw new Error('A finite, positive FTP is needed to read watts.');
  const toFraction = (v: number) => (percent ? v / 100 : v / ftp);
  for (const p of points) {
    p[1] = toFraction(p[1]);
    if (!Number.isFinite(p[1]) || p[1] > WORKOUT_LIMITS.power) throw new Error(`Workout power cannot exceed ${WORKOUT_LIMITS.power * 100}% of FTP.`);
  }

  const blocks: Block[] = [];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    const duration = Math.round(t1 - t0);
    if (duration <= 0) continue; // a vertical step
    const from = v0;
    const to = v1;
    blocks.push(Math.abs(from - to) < 1e-6 ? { kind: 'steady', duration, power: from } : { kind: 'ramp', duration, from, to });
  }
  return { id: newId(), name, description, blocks, source: 'uploaded' };
}

// -------------------------------------------------------------- export ----

export function toZwo(w: Workout): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const f = (n: number) => Number(n.toFixed(3));
  const cad = (c?: number) => (c ? ` Cadence="${c}"` : '');
  const rows = w.blocks.map((b) => {
    switch (b.kind) {
      case 'steady': return `    <SteadyState Duration="${b.duration}" Power="${f(b.power)}"${cad(b.cadence)}/>`;
      case 'ramp': return `    <Ramp Duration="${b.duration}" PowerLow="${f(b.from)}" PowerHigh="${f(b.to)}"${cad(b.cadence)}/>`;
      case 'intervals': return `    <IntervalsT Repeat="${b.repeats}" OnDuration="${b.onDuration}" OffDuration="${b.offDuration}" OnPower="${f(b.onPower)}" OffPower="${f(b.offPower)}"${cad(b.cadence)}/>`;
      case 'free': return `    <FreeRide Duration="${b.duration}"/>`;
    }
  });
  return `<workout_file>
  <author>American Flyers</author>
  <name>${esc(w.name)}</name>
  <description>${esc(w.description)}</description>
  <sportType>bike</sportType>
  <workout>
${rows.join('\n')}
  </workout>
</workout_file>
`;
}

export function newId() {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
