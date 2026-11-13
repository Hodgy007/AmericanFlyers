// The names and options of the code-built monuments (monuments.ts), kept apart from the
// builders so that stages.ts can refer to them without pulling in three.js and the DOM.

export type MonumentId =
  | 'ventoux-observatory'
  | 'simpson-memorial'
  | 'chalet'
  | 'alpine-church'
  | 'alpe-village'
  | 'ski-apartments'
  | 'geant-tourmalet'
  | 'pass-buildings'
  | 'col-sign'
  | 'log-lodge'
  | 'flatirons'
  | 'washington-summit'
  | 'washington-tower'
  | 'diablo-summit'
  | 'crest-house-ruins'
  | 'summit-sign-us'
  | 'manhattan-skyline'
  | 'virginia-capitol'
  | 'terrace'
  | 'bixby-bridge'
  | 'tunnel-portal'
  | 'market-cross'
  | 'stone-viaduct'
  | 'lake-jetty'
  | 'vale-arch';

/** The stone viaduct's module (monumentVale.ts), here so a world can size it without three.js: a bay of 15 m (a 11.6 m arch and a pier), 13 bays (195 m), the deck 19 m up, 20.1 m to the top of the coping. */
export const VIADUCT = { module: 15, span: 11.6, bays: 13, deck: 19, height: 20.09 } as const;

/** The market cross's and the jetty's heights as built (monumentVale.ts), so a world can size them without three.js. */
export const MARKET_CROSS_HEIGHT = 8.43;
export const JETTY_HEIGHT = 5.08;

/** The village race arch's dimensions as built (monumentVale.ts), so a world can size it without three.js: it is 11 m between the pier centres, 4.7 m clear under its board, and its pole tops stand 9.3 m up. */
export const VALE_ARCH = { pier: 5.45, bottom: 4.7, boardH: 2.4, height: 9.3 } as const;

/** Words and looks a monument can be given (signs, plaques, clusters). Which fields matter depends on the monument. */
export interface MonumentOptions {
  /** The words on a sign or plaque, top line first. */
  lines?: string[];
  /** Sign colours, and flags on the Italian pass: 'fr' brown, 'it' green, 'us' wood. */
  style?: 'fr' | 'it' | 'us';
  /** Varies a cluster of buildings (how many, how tall); the same seed always builds the same cluster. */
  seed?: number;
  /** What a row of town houses is built of (default: brick). */
  material?: 'brick' | 'stone';
  /** A row of town houses laid out as a village street (`material: 'stone'`): houses of two and three storeys, a low cottage, a ginnel or a shopfront, door and frame colours and a stepped roof line, all from `seed` (terracePlan.ts). Without it the row is built as before (Richmond's and Harrogate's). */
  village?: boolean;
  /** A park's road, as (x east, z south) points from the course start: the Manhattan skyline stands round it. */
  loop?: [number, number][];
  /** A viaduct's length in bays (default 13). */
  bays?: number;
  /** A viaduct's ground: its height (m, relative to the monument's origin) at each of its bays + 1 pier positions, so every pier stands on the land. */
  ground?: number[];
}
