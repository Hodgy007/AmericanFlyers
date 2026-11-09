// The far horizon: a panorama of the stage's region (Higgsfield-generated, keyed on its sky) wrapped
// round the sky's mountain ring. These are the pure parts (which panorama a stage gets, how tall
// and how many times the band wraps); sky.ts loads the texture and draws it.

export type HorizonKind = 'alps' | 'pyrenees' | 'rockies' | 'desert' | 'hills';

/** A stage's `scenery.horizon`: one of the panoramas, or 'none' for the procedural ring alone. */
export type HorizonChoice = HorizonKind | 'none';

/** Radius of the ring and of the band wrapped on it, metres from the camera. */
export const RING_RADIUS = 3600;
/** Where the band's lower edge sits, relative to the sky group (which rides 60 m under the camera). */
export const BAND_BOTTOM = -150;

export const PANORAMA_W = 1344;
export const PANORAMA_H = 576;

/** Fraction of each panorama's height, measured up from its bottom edge, at which its ridge line sits on average. */
const RIDGE_FRAC: Record<HorizonKind, number> = {
  alps: 0.545,
  pyrenees: 0.516,
  rockies: 0.563,
  desert: 0.36,
  hills: 0.42,
};

/** The panorama's URL under public/. Low uses the half-size file. */
export function horizonUrl(kind: HorizonKind, low: boolean, base = '/'): string {
  return `${base}textures/horizon/${kind}${low ? '-low' : ''}.webp`;
}

/** A stage's horizon: what its scenery says, or one found from how mountainous it is (uploaded GPX routes). */
export function horizonFor(scenery: { horizon?: HorizonChoice; mountainScale: number }): HorizonChoice {
  if (scenery.horizon) return scenery.horizon;
  return scenery.mountainScale >= 2 ? 'alps' : 'hills';
}

/**
 * Elevation angle (degrees) the ridge line sits at, on average, for a stage's `mountainScale`.
 * Scale 1 (rolling country) is about 6 degrees; scale 3.6 (Stelvio) about 14.
 */
export function ridgeDegrees(mountainScale: number): number {
  return 3 + 3.2 * Math.max(0.4, mountainScale);
}

export interface BandShape {
  /** Height of the cylinder band, metres. */
  height: number;
  /** Lower edge, metres (relative to the sky group). */
  bottom: number;
  /** How many times the panorama wraps round the ring: even, so the mirrored repeat closes seamlessly. */
  repeats: number;
}

/**
 * Size of the band for a panorama and a stage's mountain scale: tall enough that the ridge line sits
 * at `ridgeDegrees`, wrapped so that the panorama's pixels are not stretched more than ~1.4x either way.
 */
export function bandShape(kind: HorizonKind, mountainScale: number): BandShape {
  const ridgeY = RING_RADIUS * Math.tan((ridgeDegrees(mountainScale) * Math.PI) / 180);
  const height = (ridgeY - BAND_BOTTOM) / RIDGE_FRAC[kind];
  const naturalWidth = (height * PANORAMA_W) / PANORAMA_H;
  const circumference = 2 * Math.PI * RING_RADIUS;
  const repeats = Math.max(4, Math.min(12, 2 * Math.round(circumference / naturalWidth / 2)));
  return { height, bottom: BAND_BOTTOM, repeats };
}

/** Where along the panorama the ring starts, 0..1: varies per stage so two stages in one region don't show the same peak straight ahead. */
export function bandOffset(stageId: string): number {
  let h = 2166136261;
  for (let i = 0; i < stageId.length; i++) h = Math.imul(h ^ stageId.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
