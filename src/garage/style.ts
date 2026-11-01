// How your bike and clothes look: the style names the 3D model understands,
// and the short codes that travel with your kit string to other riders.
// Pure data (no Three.js), so the kit, presence and store code can share it.

export type FrameStyle = 'classic' | 'aero' | 'climber' | 'tt' | 'tron';
export type WheelStyle = 'alloy35' | 'carbon50' | 'deep80' | 'climb' | 'disc';
export type TyreStyle = 'standard' | 'race';
export type HelmetStyle = 'standard' | 'black' | 'aero' | 'aerodark';
export type PatternStyle = 'plain' | 'stripes' | 'hoops' | 'chevrons' | 'stars' | 'dots' | 'skinsuit';
export type SocksStyle = 'white' | 'black' | 'red' | 'neon';

export interface BikeStyle {
  frame: FrameStyle;
  wheels: WheelStyle;
  tyres: TyreStyle;
  helmet: HelmetStyle;
  pattern: PatternStyle;
  socks: SocksStyle;
}

export const DEFAULT_STYLE: BikeStyle = {
  frame: 'classic', wheels: 'alloy35', tyres: 'standard', helmet: 'standard', pattern: 'plain', socks: 'white',
};

const VALID: { [K in keyof BikeStyle]: readonly BikeStyle[K][] } = {
  frame: ['classic', 'aero', 'climber', 'tt', 'tron'],
  wheels: ['alloy35', 'carbon50', 'deep80', 'climb', 'disc'],
  tyres: ['standard', 'race'],
  helmet: ['standard', 'black', 'aero', 'aerodark'],
  pattern: ['plain', 'stripes', 'hoops', 'chevrons', 'stars', 'dots', 'skinsuit'],
  socks: ['white', 'black', 'red', 'neon'],
};

/** Short keys used in the kit string sent to other riders. */
const KEYS: { [K in keyof BikeStyle]: string } = { frame: 'f', wheels: 'w', tyres: 't', helmet: 'h', pattern: 'p', socks: 's' };

/** A full style from anything (unknown or missing values fall back to the defaults). */
export function cleanStyle(s: unknown): BikeStyle {
  const o = (s ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_STYLE } as Record<string, string>;
  for (const k of Object.keys(VALID) as (keyof BikeStyle)[]) {
    if ((VALID[k] as readonly unknown[]).includes(o[k])) out[k] = o[k] as string;
  }
  return out as unknown as BikeStyle;
}

export const isDefaultStyle = (s: BikeStyle) => (Object.keys(DEFAULT_STYLE) as (keyof BikeStyle)[]).every((k) => s[k] === DEFAULT_STYLE[k]);

/** ";f=tron;w=deep80" for the parts that aren't the defaults ("" for a plain bike). Matches the check in ride_presence(). */
export function styleSuffix(s: BikeStyle): string {
  let out = '';
  for (const k of Object.keys(VALID) as (keyof BikeStyle)[]) {
    if (s[k] !== DEFAULT_STYLE[k]) out += `;${KEYS[k]}=${s[k]}`;
  }
  return out;
}

/** Reads the ";f=tron;…" part of a kit string (everything after the colours). Unknown parts are ignored. */
export function parseStyleSuffix(parts: string[]): BikeStyle | null {
  const raw: Record<string, string> = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    const name = (Object.keys(KEYS) as (keyof BikeStyle)[]).find((n) => KEYS[n] === k);
    if (name && v) raw[name] = v;
  }
  const style = cleanStyle(raw);
  return isDefaultStyle(style) ? null : style;
}
