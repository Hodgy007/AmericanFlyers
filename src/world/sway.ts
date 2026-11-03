// Wind sway for plants: one set of uniforms shared by every material that bends in the wind
// (trees, grass, flowers), and the GLSL that bends them. World.update() calls updateSway() once a
// frame; a material opts in by adding SWAY_UNIFORMS to its shader and calling afSway() on its
// world-space position (see trees.ts and groundCover.ts).
//
// The bend grows with the square of the height above the plant's base, so trunks stay put and tips
// move; each plant gets its own phase from its world position, so a field ripples instead of
// nodding in step; gusts come through as a slow wave travelling downwind.

import * as THREE from 'three';
import { wind } from './wind';

export const SWAY_UNIFORMS = {
  uSwayTime: { value: 0 },
  /** Bend strength, 0 (calm) to about 1 (a gale). */
  uSwayStrength: { value: 0 },
  /** Unit vector the wind blows towards, on the ground plane (x, z). */
  uSwayDir: { value: new THREE.Vector2(1, 0) },
};

/** Called once a frame. `dt` in seconds. */
export function updateSway(dt: number) {
  SWAY_UNIFORMS.uSwayTime.value += dt;
  const target = Math.min(1, wind.speed / 14); // 14 m/s (50 km/h) bends everything as far as it goes
  const s = SWAY_UNIFORMS.uSwayStrength;
  s.value += (target - s.value) * (1 - Math.exp(-dt / 1.5));
  SWAY_UNIFORMS.uSwayDir.value.set(Math.cos(wind.toRad), Math.sin(wind.toRad));
}

/**
 * GLSL: uniforms and `vec3 afSway(vec3 worldPos, float height, float stiffness)`, the offset to add
 * to a vertex at `worldPos` that is `height` metres above its plant's base. `stiffness` scales it
 * down (trees about 1, grass about 0.25: grass is short, so it needs a smaller stiffness to move as
 * much). There is always a little movement, even in a calm.
 */
export const SWAY_GLSL = /* glsl */ `
uniform float uSwayTime;
uniform float uSwayStrength;
uniform vec2 uSwayDir;
vec3 afSway(vec3 worldPos, float height, float stiffness) {
  float phase = dot(worldPos.xz, vec2(0.137, 0.091));
  float gust = 0.6 + 0.4 * sin(dot(worldPos.xz, uSwayDir) * 0.03 - uSwayTime * 1.3);
  float s = (0.08 + uSwayStrength) * gust;
  float bend = height * height * 0.004 / max(stiffness, 0.05);
  float flutter = sin(uSwayTime * 2.1 + phase) * 0.35 + sin(uSwayTime * 3.7 + phase * 1.7) * 0.15;
  float lean = s * bend;
  return vec3(uSwayDir.x, 0.0, uSwayDir.y) * lean * (0.7 + flutter) + vec3(-uSwayDir.y, 0.0, uSwayDir.x) * lean * flutter * 0.4;
}
`;
