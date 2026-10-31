// Training zones: heart rate as % of max HR (5 zones) and power as % of FTP
// (the same 6 zones the HUD uses). Time in each zone is kept in seconds.

export interface Zone { label: string; name: string; color: string; from: number }

export const HR_ZONES: Zone[] = [
  { label: 'Z1', name: 'Recovery', color: '#9aa5b1', from: 0 },
  { label: 'Z2', name: 'Endurance', color: '#3e8ed0', from: 0.6 },
  { label: 'Z3', name: 'Tempo', color: '#48c774', from: 0.7 },
  { label: 'Z4', name: 'Threshold', color: '#f2c14e', from: 0.8 },
  { label: 'Z5', name: 'Maximum', color: '#e5383b', from: 0.9 },
];

export const POWER_ZONES: Zone[] = [
  { label: 'Z1', name: 'Recovery', color: '#9aa5b1', from: 0 },
  { label: 'Z2', name: 'Endurance', color: '#3e8ed0', from: 0.55 },
  { label: 'Z3', name: 'Tempo', color: '#48c774', from: 0.75 },
  { label: 'Z4', name: 'Threshold', color: '#f2c14e', from: 0.9 },
  { label: 'Z5', name: 'VO2 max', color: '#f08a4b', from: 1.05 },
  { label: 'Z6', name: 'Anaerobic', color: '#e5383b', from: 1.2 },
];

export function zoneIndex(zones: Zone[], ratio: number) {
  let i = 0;
  while (i + 1 < zones.length && ratio >= zones[i + 1].from) i++;
  return i;
}

/** "142–158 bpm" / "180–216 W" for zone i given the reference (max HR or FTP). */
export function zoneRange(zones: Zone[], i: number, ref: number, unit: string) {
  const lo = Math.round(zones[i].from * ref);
  const next = zones[i + 1];
  return next ? `${lo}–${Math.round(next.from * ref) - 1} ${unit}` : `${lo}+ ${unit}`;
}

export function addZones(a: number[] | null | undefined, b: number[] | null | undefined, n: number) {
  return Array.from({ length: n }, (_, i) => (a?.[i] ?? 0) + (b?.[i] ?? 0));
}

const fmt = (s: number) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A zone breakdown: one row per zone with its name, a bar for its share of
 * the time and the time itself. Each bar is labelled, so colour isn't the
 * only cue.
 */
export function zoneBars(title: string, zones: Zone[], seconds: number[] | null | undefined, opts: { ref?: number; unit?: string } = {}) {
  const el = document.createElement('div');
  el.className = 'zones';
  const total = (seconds ?? []).reduce((a, b) => a + b, 0);
  const h = document.createElement('h4');
  h.textContent = title;
  el.append(h);
  if (!total) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = title.includes('Heart') ? 'No heart-rate data. Pair a strap (or a trainer that sends HR) to see your zones.' : 'No data yet.';
    el.append(p);
    return el;
  }
  zones.forEach((z, i) => {
    const s = seconds?.[i] ?? 0;
    const pct = (s / total) * 100;
    const row = document.createElement('div');
    row.className = 'zone-row';
    const range = opts.ref ? zoneRange(zones, i, opts.ref, opts.unit ?? '') : '';
    row.title = `${z.label} ${z.name}${range ? ` (${range})` : ''}: ${fmt(s)}, ${pct.toFixed(0)}%`;
    row.innerHTML = `<span class="zone-name"><b></b> <span></span></span><span class="zone-track"><span class="zone-fill"></span></span><span class="zone-time"></span>`;
    row.querySelector('b')!.textContent = z.label;
    row.querySelector('.zone-name span')!.textContent = z.name;
    const fill = row.querySelector<HTMLElement>('.zone-fill')!;
    fill.style.width = `${pct}%`;
    fill.style.background = z.color;
    row.querySelector('.zone-time')!.textContent = `${fmt(s)} · ${pct.toFixed(0)}%`;
    el.append(row);
  });
  return el;
}
