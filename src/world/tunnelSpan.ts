// Where the road runs through a tunnel (`Scenery.tunnels`): the pure part, with no three.js, so the terrain, the crowds, the guardrails
// and the tests can all ask "is this stretch underground?" without pulling in the tube (tunnel.ts). Spans are in the stage's own course
// metres, sorted and not overlapping (routeStage shifts a world's spans like every other per-distance datum and repeats them each lap).

export interface TunnelSpan {
  /** Course distance of the portal the rider enters by, m. */
  from: number;
  /** Course distance of the portal the rider leaves by, m. */
  to: number;
  /**
   * The hill over the tunnel: its surface's height above the road (m) at course distance `d` and lateral offset `lat` (right is positive), for |lat| up to
   * TUNNEL_HILL. A heightfield cannot close over a road without showing its own slope inside the portal, so the stage's `roadside` hook digs the terrain
   * out below the road along the span (|lat| < 8, climbing steeply to the hill's own height by |lat| 12) and the tube builds this surface over the slot
   * instead (tunnel.ts). It must be at least the vault's height + 0.5 m over the tube and equal the terrain's height at |lat| = TUNNEL_HILL.
   */
  roof?(d: number, lat: number): number;
}

/** How far either side of the centreline the hill over a tunnel is built by the tube (m); the terrain takes over from there. */
export const TUNNEL_HILL = 12;

/** The span that holds `d` (widened by `margin` metres at both ends), or null. Binary search: an endless route lists a span for every lap. */
export function tunnelAt(spans: readonly TunnelSpan[] | undefined, d: number, margin = 0): TunnelSpan | null {
  if (!spans || spans.length === 0) return null;
  let lo = 0;
  let hi = spans.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].from - margin <= d) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && d <= spans[best].to + margin ? spans[best] : null;
}

/** How far from the centreline the hill over a tunnel counts as "over the tunnel": nothing is planted or dyed as a verge on it (a tree could not stand on the vault, and the ridge's top is not a road shoulder). */
export const COVER_LATERAL = 30;
/** Metres either side of a span that count as covered too: the portal ramp, where the ground climbs over the mouth. */
export const COVER_MARGIN = 8;

/** True for a point of ground over (or at the mouth of) a tunnel: `near` is the terrain's nearest-road result (course distance and distance from the centreline). */
export function coveredByTunnel(spans: readonly TunnelSpan[] | undefined, near: { d: number; dist: number } | null): boolean {
  return !!spans && !!near && near.dist < COVER_LATERAL && tunnelAt(spans, near.d, COVER_MARGIN) !== null;
}

// ---------------------------------------------------------------- the shape ----
// The cross-section, shared by the tube (tunnel.ts) and the portal arches (monumentTunnel.ts).

/** Half the clear width between the walls, m (the road is 9.2 m wide, so it keeps a 1 m shoulder each side). */
export const TUNNEL_HALF_WIDTH = 5.6;
/** Height of the straight walls, m; the vault springs from there. */
export const TUNNEL_WALL = 2.4;
/** Height of the crown above the road, m. */
export const TUNNEL_CROWN = 6.2;
/** The tunnel is lit by a lamp every this many metres (and has a ring joint between them). */
export const TUNNEL_BAY = 6;
export const TUNNEL_KERB = 0.9; // height of the lighter concrete kerb band along the foot of each wall
const ARC = 10; // segments across the vault

/** The cross-section as (lateral, height above the road) points from the foot of the left wall over the crown to the foot of the right wall; lateral is positive to the right. */
export function tunnelProfile(): [number, number][] {
  const w = TUNNEL_HALF_WIDTH;
  const rise = TUNNEL_CROWN - TUNNEL_WALL;
  const radius = (w * w + rise * rise) / (2 * rise); // the arc through both wall tops and the crown
  const cy = TUNNEL_CROWN - radius;
  const a = Math.asin((TUNNEL_WALL - cy) / radius); // the arc's angle at a wall top, measured up from the horizontal
  const pts: [number, number][] = [[-w, 0], [-w, TUNNEL_KERB], [-w, TUNNEL_WALL]];
  for (let i = 1; i < ARC; i++) {
    const phi = Math.PI - a - ((Math.PI - 2 * a) * i) / ARC;
    pts.push([radius * Math.cos(phi), cy + radius * Math.sin(phi)]);
  }
  pts.push([w, TUNNEL_WALL], [w, TUNNEL_KERB], [w, 0]);
  return pts;
}

/** The height of the vault's underside above the road at lateral offset `lat` (the straight walls below TUNNEL_WALL). */
export function vaultHeight(lat: number): number {
  const w = TUNNEL_HALF_WIDTH;
  const rise = TUNNEL_CROWN - TUNNEL_WALL;
  const radius = (w * w + rise * rise) / (2 * rise);
  const cy = TUNNEL_CROWN - radius;
  return cy + Math.sqrt(Math.max(0, radius * radius - lat * lat));
}


/** Metres thick, along the road, of the stone wall at each mouth (monumentTunnel.ts). The tube starts at the entrance wall's front face; the terrain climbs over the mouth behind it (the stage's `roadside` hook). */
export const TUNNEL_PORTAL_DEPTH = 2.4;
