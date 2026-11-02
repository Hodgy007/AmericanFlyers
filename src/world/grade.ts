// Colour grading and bloom settings for a look (time of day + weather). Pure
// numbers: atmosphere.ts fills one GradeParams per frame from its current look,
// and the post-processing pass (post.ts, Medium and up) reads it.
//
// The grade runs on linear HDR colour before tone mapping, so it is gentle:
// a little warmth and saturation near sunrise and sunset, cooler and flatter
// under cloud and rain, blue-tinted but still contrasty at night, and a soft vignette.

export interface GradeParams {
  saturation: number; // 1 = unchanged
  contrast: number; // power about mid-grey; 1 = unchanged
  gain: [number, number, number]; // multiplies the colour (warm / cool cast)
  lift: [number, number, number]; // added in the shadows (their tint)
  vignette: number; // 0..1: darkening at the corners
  bloomStrength: number;
  bloomThreshold: number; // linear luminance above which things glow
  bloomRadius: number;
}

export interface GradeInput {
  night: number; // 0..1 stars and moon showing
  overcast: number; // 0..1 how grey the sky is
  wet: number; // 0..1 rain-soaked
  sunY: number; // sun direction's height (sin of its elevation); negative below the horizon
}

export const makeGrade = (): GradeParams => ({
  saturation: 1, contrast: 1, gain: [1, 1, 1], lift: [0, 0, 0], vignette: 0.2, bloomStrength: 0.2, bloomThreshold: 1.1, bloomRadius: 0.5,
});

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** How golden the light is: 0 in full day, night and under cloud, 1 with the sun low over the horizon. */
export function goldenAmount(sunY: number, overcast: number) {
  return (1 - smooth(0.1, 0.5, sunY)) * smooth(-0.12, 0.03, sunY) * (1 - 0.75 * overcast);
}

/** Fills `out` for a look. */
export function gradeFor(i: GradeInput, out: GradeParams): GradeParams {
  const gold = goldenAmount(i.sunY, i.overcast);
  const night = clamp01(i.night);
  const grey = clamp01(i.overcast) * (1 - night);
  const wet = clamp01(i.wet);

  out.saturation = (1.05 + 0.1 * gold) * mix(1, 0.86, grey) * mix(1, 0.97, wet) * mix(1, 0.94, night);
  out.contrast = (1.04 + 0.03 * gold) * mix(1, 0.94, grey) * mix(1, 1.05, night);
  // Warm cast in golden light, cool and slightly green-grey under cloud, moonlit blue at night.
  out.gain[0] = (1 + 0.07 * gold) * mix(1, 0.97, grey) * mix(1, 0.86, night);
  out.gain[1] = (1 + 0.01 * gold) * mix(1, 1.0, grey) * mix(1, 0.97, night);
  out.gain[2] = (1 - 0.07 * gold) * mix(1, 1.04, grey) * mix(1, 1.12, night);
  // Shadows lean cool by day and bluer at night, never crushed to black.
  out.lift[0] = 0.0;
  out.lift[1] = 0.002 + 0.003 * night;
  out.lift[2] = 0.004 + 0.012 * night + 0.003 * gold;
  out.vignette = 0.16 + 0.1 * grey + 0.1 * night;
  // Bloom: only the genuinely bright things (sun, neon, lamps, wet glints); easier at night.
  out.bloomThreshold = mix(1.15, 0.95, night);
  out.bloomStrength = mix(0.16, 0.5, night) + 0.12 * gold - 0.06 * grey;
  out.bloomRadius = mix(0.45, 0.6, night);
  return out;
}
