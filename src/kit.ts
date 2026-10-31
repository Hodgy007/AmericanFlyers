// Your kit: jersey, accent and bike frame colours. Saved in settings.kit
// (null = the default American Flyers stars and stripes), worn by your rider
// and sent to the other riders on the stage with your position.
//
// A tour jersey (yellow, green, polka-dot) can be laid on top of the chosen
// kit with setTourJersey(); the lead session wires the tour to it.

export interface Kit {
  jersey: string; // main jersey colour
  accent: string; // second colour (sleeves, trim)
  frame: string; // bike frame
}

/** What the rider model is told to wear. `kit` null = the original stars and stripes. */
export interface PlayerLook {
  /** Colours for the rigged rider's navy and red (see modelKit); null = the original. */
  kit: [string, string] | null;
  jersey: string;
  frame: string;
}

export const DEFAULT_JERSEY = '#d62839';
export const DEFAULT_FRAME = '#1f3c88';

/** The original look, shown as the first preset and used for the swatches. */
export const STARS_AND_STRIPES: Kit = { jersey: '#14213d', accent: '#d62839', frame: DEFAULT_FRAME };

export interface KitPreset {
  id: string;
  name: string;
  kit: Kit | null; // null = default stars and stripes
}

// The jersey is the colour of the torso; the second colour is the shorts and trim.
export const PRESETS: KitPreset[] = [
  { id: 'default', name: 'American Flyers', kit: null },
  { id: 'sunrise', name: 'Sunrise Social', kit: { jersey: '#ff8a00', accent: '#1c2b5a', frame: '#fff3d6' } },
  { id: 'forest', name: 'Forest Rollers', kit: { jersey: '#1f9d63', accent: '#0b1f17', frame: '#f5d44a' } },
  { id: 'storm', name: 'Storm Chasers', kit: { jersey: '#4aa3ff', accent: '#1b2a6b', frame: '#f4f6fa' } },
  { id: 'berry', name: 'Berry Blast', kit: { jersey: '#d6249f', accent: '#2a1040', frame: '#ffd1f0' } },
  { id: 'mono', name: 'Night Ride', kit: { jersey: '#2c303a', accent: '#c8102e', frame: '#e8eaf0' } },
  { id: 'lemon', name: 'Lemon Zest', kit: { jersey: '#f4e04d', accent: '#1c2b5a', frame: '#1c2b5a' } },
];

/**
 * The rigged rider's texture is navy (shorts, shoulders) and red (the torso),
 * and RiderModel's kit is [navy replacement, red replacement]. So the jersey
 * colour goes in the second slot and the second colour in the first.
 */
export const modelKit = (jersey: string, accent: string): [string, string] => [accent, jersey];

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (s: unknown): s is string => typeof s === 'string' && HEX.test(s);

/** A kit from stored settings, or null if it's missing or malformed. */
export function cleanKit(k: unknown): Kit | null {
  const o = k as Partial<Kit> | null | undefined;
  if (o && isHex(o.jersey) && isHex(o.accent) && isHex(o.frame)) {
    return { jersey: o.jersey.toLowerCase(), accent: o.accent.toLowerCase(), frame: o.frame.toLowerCase() };
  }
  return null;
}

/** "#jersey,#accent,#frame", as sent to the server; null for the default kit. */
export function kitString(look: PlayerLook | null): string | null {
  // look.kit is [accent, jersey] (see modelKit); the server string is jersey, accent, frame.
  return look?.kit ? `${look.kit[1]},${look.kit[0]},${look.frame}`.toLowerCase() : null;
}

/** Reads the server's kit string; null if it isn't three hex colours. */
export function parseKitString(s: unknown): Kit | null {
  if (typeof s !== 'string') return null;
  const [jersey, accent, frame, ...rest] = s.split(',');
  return rest.length ? null : cleanKit({ jersey, accent, frame });
}

let kit: Kit | null = null;
let tour: [string, string] | null = null;
let listener: (look: PlayerLook) => void = () => {};

/** Your rider's look: the saved kit, with any tour jersey over its jersey and accent. */
export function playerLook(): PlayerLook {
  const k = kit;
  if (tour && isHex(tour[0]) && isHex(tour[1])) {
    return { kit: modelKit(tour[0], tour[1]), jersey: tour[0], frame: k?.frame ?? DEFAULT_FRAME };
  }
  return k
    ? { kit: modelKit(k.jersey, k.accent), jersey: k.jersey, frame: k.frame }
    : { kit: null, jersey: DEFAULT_JERSEY, frame: DEFAULT_FRAME };
}

/** Called with the new look whenever the kit or tour jersey changes. */
export function onLookChange(fn: (look: PlayerLook) => void) {
  listener = fn;
  fn(playerLook());
}

/** Set your kit (null = default stars and stripes). */
export function setPlayerKit(next: unknown) {
  kit = cleanKit(next);
  listener(playerLook());
}

/**
 * Hook for tours: lay a jersey (main colour, second colour) over the chosen
 * kit, or pass null to take it off again. The bike frame stays yours.
 */
export function setTourJersey(colours: [string, string] | null) {
  tour = colours;
  listener(playerLook());
}
