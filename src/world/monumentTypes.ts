// The names and options of the code-built monuments (monuments.ts), kept apart from the
// builders so that stages.ts can refer to them without pulling in three.js and the DOM.

export type MonumentId =
  | 'ventoux-observatory'
  | 'simpson-memorial'
  | 'chalet'
  | 'alpine-church'
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
  | 'bixby-bridge';

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
  /** A park's road, as (x east, z south) points from the course start: the Manhattan skyline stands round it. */
  loop?: [number, number][];
}
