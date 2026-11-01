// The bike store's catalogue: frames, wheels, tyres, helmets, jersey designs
// and socks, with their prices, what unlocks them, what they do to the physics
// (modest and realistic) and what they look like.
//
// The server (db/schema.sql: public.store_items) is the source of truth for
// prices, levels and unlock rules, and enforces them in buy_item(). This copy
// drives the screens, the physics and the 3D model, and is what signed-out
// riders see. scripts/gen-store-sql.mjs prints the SQL seed from it, so the
// two stay in step.

import type { BikeStyle, FrameStyle } from './style';

export type Slot = 'frame' | 'wheels' | 'tyres' | 'helmet' | 'jersey' | 'socks';
export type Tab = 'bikes' | 'wheels' | 'clothing';

export interface Effects {
  /** Change in drag area as a fraction (-0.025 = 2.5% less drag). */
  cda?: number;
  /** Change in bike weight, kg. */
  mass?: number;
  /** Change in rolling resistance coefficient. */
  crr?: number;
}

export interface StoreItem {
  id: string;
  slot: Slot;
  name: string;
  blurb: string;
  price: number; // credits; 0 with an unlock rule means "claim it once you've earned it"
  level: number; // level needed to buy
  unlock?: { climbed_m?: number; km?: number };
  effects?: Effects;
  /** Only works on this frame (disc wheels need the time-trial bike). */
  needsFrame?: FrameStyle;
  /** The value this item sets in BikeStyle for its slot. */
  look: string;
  starter?: boolean;
}

export const SLOT_LABEL: Record<Slot, string> = {
  frame: 'Bike', wheels: 'Wheels', tyres: 'Tyres', helmet: 'Helmet', jersey: 'Jersey design', socks: 'Socks',
};

export const TABS: { id: Tab; label: string; slots: Slot[] }[] = [
  { id: 'bikes', label: 'Bikes', slots: ['frame'] },
  { id: 'wheels', label: 'Wheels & tyres', slots: ['wheels', 'tyres'] },
  { id: 'clothing', label: 'Clothing', slots: ['helmet', 'jersey', 'socks'] },
];

export const EVEREST_M = 8848;

export const ITEMS: StoreItem[] = [
  // ---- bikes
  { id: 'frame-classic', slot: 'frame', name: 'Classic road bike', blurb: 'Your trusty steel-blue all-rounder. Choose any colour in My kit.', price: 0, level: 1, look: 'classic', starter: true },
  { id: 'frame-aero', slot: 'frame', name: 'Aero road frame', blurb: 'Deep, narrow tubes that slip through the air. Fastest on the flat.', price: 700, level: 4, effects: { cda: -0.025 }, look: 'aero' },
  { id: 'frame-climber', slot: 'frame', name: 'Climbing frame', blurb: 'A skinny, lightweight frame. Every gram counts on a mountain.', price: 700, level: 4, effects: { mass: -0.8 }, look: 'climber' },
  { id: 'frame-tt', slot: 'frame', name: 'Time-trial bike', blurb: 'Tri-bars and a low tuck. Quick on the flat, a bit heavy on the hills. Unlocks disc wheels.', price: 1200, level: 8, effects: { cda: -0.05, mass: 0.4 }, look: 'tt' },
  { id: 'frame-tron', slot: 'frame', name: 'The Tron bike', blurb: 'A glowing neon frame with light-ribbon wheels. Earned by climbing the height of Everest, 8,848 m, in total.', price: 0, level: 1, unlock: { climbed_m: EVEREST_M }, effects: { cda: -0.025, mass: -0.3 }, look: 'tron' },
  // ---- wheels
  { id: 'wheels-alloy35', slot: 'wheels', name: '35 mm alloy wheels', blurb: 'Solid, shallow alloy rims. They come with every bike.', price: 0, level: 1, look: 'alloy35', starter: true },
  { id: 'wheels-carbon50', slot: 'wheels', name: '50 mm carbon wheels', blurb: 'Medium-depth carbon rims: a little faster in the wind.', price: 450, level: 3, effects: { cda: -0.015 }, look: 'carbon50' },
  { id: 'wheels-deep80', slot: 'wheels', name: '80 mm deep wheels', blurb: 'Very deep carbon rims: the quickest on flat roads, but heavier.', price: 650, level: 6, effects: { cda: -0.025, mass: 0.25 }, look: 'deep80' },
  { id: 'wheels-climb', slot: 'wheels', name: 'Lightweight climbing wheels', blurb: 'Skinny, light rims that spin up quickly on a hill.', price: 500, level: 5, effects: { mass: -0.45 }, look: 'climb' },
  { id: 'wheels-disc', slot: 'wheels', name: 'Disc wheel (time-trial bike only)', blurb: 'A solid rear wheel. The fastest of all on the flat. Works with the time-trial bike.', price: 900, level: 10, effects: { cda: -0.035, mass: 0.4 }, needsFrame: 'tt', look: 'disc' },
  // ---- tyres
  { id: 'tyres-standard', slot: 'tyres', name: 'Standard tyres', blurb: 'Sturdy everyday tyres.', price: 0, level: 1, look: 'standard', starter: true },
  { id: 'tyres-race', slot: 'tyres', name: 'Race tyres', blurb: 'Supple, tan-wall race tyres that roll a little easier.', price: 250, level: 2, effects: { crr: -0.0005 }, look: 'race' },
  // ---- helmets
  { id: 'helmet-standard', slot: 'helmet', name: 'White road helmet', blurb: 'The classic.', price: 0, level: 1, look: 'standard', starter: true },
  { id: 'helmet-black', slot: 'helmet', name: 'Black road helmet', blurb: 'Same helmet, stealthier.', price: 60, level: 1, look: 'black' },
  { id: 'helmet-aero', slot: 'helmet', name: 'Aero helmet', blurb: 'A smooth, tailed shell that cuts a little drag.', price: 300, level: 3, effects: { cda: -0.015 }, look: 'aero' },
  { id: 'helmet-aero-dark', slot: 'helmet', name: 'Aero helmet (carbon black)', blurb: 'The aero helmet in carbon black.', price: 340, level: 3, effects: { cda: -0.015 }, look: 'aerodark' },
  // ---- jersey designs (they use your jersey and second colour from My kit)
  { id: 'jersey-plain', slot: 'jersey', name: 'Plain jersey', blurb: 'Your colours, nice and simple.', price: 0, level: 1, look: 'plain', starter: true },
  { id: 'jersey-stripes', slot: 'jersey', name: 'Stripes', blurb: 'Vertical pinstripes in your second colour.', price: 120, level: 2, look: 'stripes' },
  { id: 'jersey-hoops', slot: 'jersey', name: 'Hoops', blurb: 'Bold horizontal hoops.', price: 150, level: 3, look: 'hoops' },
  { id: 'jersey-chevrons', slot: 'jersey', name: 'Chevrons', blurb: 'A racing V across the chest.', price: 200, level: 3, look: 'chevrons' },
  { id: 'jersey-stars', slot: 'jersey', name: 'Stars', blurb: 'A field of stars.', price: 220, level: 5, look: 'stars' },
  { id: 'jersey-dots', slot: 'jersey', name: 'Polka dots', blurb: 'Spots, in your second colour.', price: 220, level: 5, look: 'dots' },
  { id: 'jersey-skinsuit', slot: 'jersey', name: 'Skinsuit', blurb: 'A one-piece suit in your jersey colour. Smooth and fast.', price: 500, level: 7, effects: { cda: -0.02 }, look: 'skinsuit' },
  // ---- socks
  { id: 'socks-white', slot: 'socks', name: 'White socks', blurb: 'Classic.', price: 0, level: 1, look: 'white', starter: true },
  { id: 'socks-black', slot: 'socks', name: 'Black socks', blurb: 'Pro-style black.', price: 40, level: 1, look: 'black' },
  { id: 'socks-red', slot: 'socks', name: 'Red socks', blurb: 'A flash of red.', price: 50, level: 1, look: 'red' },
  { id: 'socks-neon', slot: 'socks', name: 'Neon socks', blurb: 'You can see these from space.', price: 90, level: 2, look: 'neon' },
];

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);
export const STARTERS = ITEMS.filter((i) => i.starter);
export const STARTER_IDS = new Set(STARTERS.map((i) => i.id));

// ------------------------------------------------------------- loadout ----

/** What's equipped: an item id for each slot. */
export type Loadout = Record<Slot, string>;

export const SLOTS: Slot[] = ['frame', 'wheels', 'tyres', 'helmet', 'jersey', 'socks'];

export const DEFAULT_LOADOUT: Loadout = {
  frame: 'frame-classic', wheels: 'wheels-alloy35', tyres: 'tyres-standard',
  helmet: 'helmet-standard', jersey: 'jersey-plain', socks: 'socks-white',
};

/**
 * A usable loadout: each slot holds an item that exists, is in that slot,
 * and is owned (starters always are); anything else falls back to the starter.
 * Disc wheels without the time-trial bike fall back to the starter wheels.
 * `owned` null means "not known yet": trust the saved choice.
 */
export function cleanLoadout(raw: unknown, owned: ReadonlySet<string> | null): Loadout {
  const o = (raw ?? {}) as Partial<Record<Slot, unknown>>;
  const out = { ...DEFAULT_LOADOUT };
  for (const slot of SLOTS) {
    const it = typeof o[slot] === 'string' ? itemById(o[slot] as string) : undefined;
    if (it && it.slot === slot && (it.starter || !owned || owned.has(it.id))) out[slot] = it.id;
  }
  const wheels = itemById(out.wheels);
  if (wheels?.needsFrame && itemById(out.frame)?.look !== wheels.needsFrame) out.wheels = DEFAULT_LOADOUT.wheels;
  return out;
}

/** The 3D model's style for a loadout. */
export function styleOf(l: Loadout): BikeStyle {
  const look = (slot: Slot) => itemById(l[slot])?.look ?? itemById(DEFAULT_LOADOUT[slot])!.look;
  return {
    frame: look('frame'), wheels: look('wheels'), tyres: look('tyres'),
    helmet: look('helmet'), pattern: look('jersey'), socks: look('socks'),
  } as BikeStyle;
}

// -------------------------------------------------------------- effects ----

export interface EquipmentEffects {
  /** Added to rider + bike weight, kg. */
  massKg: number;
  /** Multiplies the drag area (1 = no change). */
  cdaFactor: number;
  /** Added to the rolling resistance coefficient. */
  crrDelta: number;
}

/** What a loadout does to the physics: the sum of its items' weights and rolling resistance, and the product of their drag changes. */
export function equipmentEffects(l: Loadout): EquipmentEffects {
  let massKg = 0;
  let cdaFactor = 1;
  let crrDelta = 0;
  for (const slot of SLOTS) {
    const e = itemById(l[slot])?.effects;
    if (!e) continue;
    massKg += e.mass ?? 0;
    cdaFactor *= 1 + (e.cda ?? 0);
    crrDelta += e.crr ?? 0;
  }
  return { massKg, cdaFactor, crrDelta };
}

export const NO_EFFECTS: EquipmentEffects = { massKg: 0, cdaFactor: 1, crrDelta: 0 };

/** Plain words for how an item unlocks. */
export function unlockText(it: StoreItem): string {
  const parts: string[] = [];
  if (it.unlock?.climbed_m) parts.push(`climb ${it.unlock.climbed_m.toLocaleString('en-US')} m in total`);
  if (it.unlock?.km) parts.push(`ride ${it.unlock.km.toLocaleString('en-US')} km in total`);
  if (it.level > 1) parts.push(`reach level ${it.level}`);
  return parts.length ? parts.join(' and ') : '';
}
