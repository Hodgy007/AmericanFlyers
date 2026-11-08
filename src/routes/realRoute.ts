// A baked real road: its heading and elevation as stored by scripts/bake-routes.mjs, and the decoder.
// The data modules in ./real/ are generated; this file is the format.

/** A baked road. `head` and `ele` are base64 int8 changes between samples (see HEAD_STEP, HEAD_UNIT, ELE_STEP). */
export interface RealRouteData {
  /** Length of the real road, m. */
  length: number;
  /** Heading of the first sample, in HEAD_UNIT units (radians: east = 0, south = +π/2, so a right turn rises). */
  head0: number;
  /** Elevation of the first sample, decimetres. */
  ele0: number;
  head: string;
  /** Empty for shape-only routes (the stage keeps its own elevation). */
  ele: string;
}

export const HEAD_STEP = 5; // metres between heading samples
export const ELE_STEP = 20; // metres between elevation samples
export const HEAD_UNIT = 0.004; // radians per heading unit

/** A decoded road: heading (rad) every HEAD_STEP metres and elevation (m) every ELE_STEP metres. */
export interface RealRoute {
  length: number;
  heading: Float64Array;
  elevation: Float64Array;
}

function unpack(b64: string): Int8Array {
  const bin = atob(b64);
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}

export function decodeRoute(data: RealRouteData): RealRoute {
  const hd = unpack(data.head);
  const heading = new Float64Array(hd.length + 1);
  let q = data.head0;
  heading[0] = q * HEAD_UNIT;
  for (let i = 0; i < hd.length; i++) heading[i + 1] = (q += hd[i]) * HEAD_UNIT;
  const ed = unpack(data.ele);
  const elevation = new Float64Array(data.ele ? ed.length + 1 : 0);
  let e = data.ele0;
  if (elevation.length) elevation[0] = e / 10;
  for (let i = 0; i < ed.length; i++) elevation[i + 1] = (e += ed[i]) / 10;
  return { length: data.length, heading, elevation };
}
