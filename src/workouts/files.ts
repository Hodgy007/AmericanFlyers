// Workout file import/export: Zwift .zwo (XML), and .erg / .mrc (text).

import type { Block, Workout } from './model';

export function parseWorkoutFile(name: string, text: string, ftp: number): Workout {
  const ext = name.toLowerCase().split('.').pop();
  const base = name.replace(/\.[^.]+$/, '');
  if (ext === 'zwo') return parseZwo(text, base);
  if (ext === 'erg' || ext === 'mrc') return parseErgMrc(text, base, ftp);
  throw new Error(`Unsupported file type ".${ext}". Use .zwo, .erg or .mrc.`);
}

// --------------------------------------------------------------- .zwo ----

function parseZwo(text: string, fallbackName: string): Workout {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This .zwo file is not valid XML.');
  const root = doc.querySelector('workout');
  if (!root) throw new Error('No <workout> section found in this .zwo file.');

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
    const cadence = num(el, 'Cadence');
    const cad = Number.isFinite(cadence) ? cadence : undefined;
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
          repeats: Math.max(1, Math.round(num(el, 'Repeat'))),
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
  const bad = blocks.find((b) => Object.values(b).some((v) => typeof v === 'number' && !Number.isFinite(v)));
  if (bad) throw new Error(`Couldn't read a <${bad.kind}> step in this .zwo file.`);
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
  let fileFtp = 0;
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
        if (key === 'FTP') fileFtp = Number(kv[2]);
        if (key === 'FILE NAME' || key === 'DESCRIPTION') {
          if (key === 'FILE NAME') name = kv[2].replace(/\.[^.]+$/, '');
          else description = kv[2];
        }
      }
      if (/MINUTES\s+PERCENT/.test(upper)) percent = true;
      continue;
    }
    const m = line.match(/^(-?[\d.]+)\s+(-?[\d.]+)/);
    if (m) points.push([Number(m[1]) * 60, Number(m[2])]);
  }
  if (points.length < 2) throw new Error('No power data found in this file.');
  const toFraction = (v: number) => (percent ? v / 100 : v / (fileFtp || riderFtp));

  const blocks: Block[] = [];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    const duration = Math.round(t1 - t0);
    if (duration <= 0) continue; // a vertical step
    const from = toFraction(v0);
    const to = toFraction(v1);
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
