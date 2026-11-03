import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { FLAG_DESIGNS, MAX_DESIGNS, POLKA, cultureOf, pickShirt, type CultureId, type FlagDesign } from './crowdCulture';
import { flagAtlas } from './crowdFlags';
import { crowdAt, hotspotAt } from './crowdZones';
import { ROAD_HALF_WIDTH, hash01, seedOf } from './roadside';

// Spectators: instanced low-poly people lining the hairpins, the summit and the
// last few hundred metres, wherever crowdAt() (crowdZones.ts, which the crowd
// roar in the sound also uses) says crowds are. They stand in clumps on both
// sides, some of them waving flags. Positions are a pure function of the stage
// and the distance, so a crowd is in the same place every ride. Their shirts and
// flags come from the stage's culture (crowdCulture.ts: French polka dots, Giro
// pink, stars and stripes), and in a crowd hotspot (the Alpe's Dutch Corner) the
// crowd is three rows deep and dressed in that hotspot's colours. The cheering
// (jumping, waving arms and flags) is all in the vertex shader: spectators near
// the rider get going as you pass, the rest sway a little.

const SLOT = 1.7; // metres between spectator slots along the road
const FLAG_SHARE = 0.14;

export interface Spectator {
  d: number;
  lat: number; // metres from the centreline, + right
  yaw: number; // extra turn, rad
  scale: number;
  shirt: string; // a CSS colour, or POLKA
  culture: CultureId; // whose flags they wave
  flag: boolean;
}

/** Spectators for road distances [d0, d1). `share` (0..1) thins them for the weaker graphics tiers; `signs` are course distances to keep clear (roadside signs). */
export function planCrowd(stage: Stage, d0: number, d1: number, share: number, signs: number[], flags: boolean): Spectator[] {
  if (share <= 0) return [];
  const seed = seedOf(stage.id);
  const home = cultureOf(stage);
  const out: Spectator[] = [];
  for (let k = Math.ceil(d0 / SLOT); k * SLOT < d1; k++) {
    const d = k * SLOT;
    const raw = crowdAt(stage, d);
    if (raw < 0.04) continue;
    const c = Math.min(1, raw);
    const hot = hotspotAt(stage, d);
    const boost = hot ? hot.weight : 0; // 0..1 inside a hotspot: fewer gaps, a third row, its colours
    // Clumps: a slow wave along the road, different on each side, leaves gaps.
    for (const side of [-1, 1] as const) {
      const clump = 0.5 + 0.5 * Math.sin(d / 9.5 + hash01(seed, side, 3) * 40) * Math.sin(d / 23 + hash01(seed, side, 4) * 40);
      const lumpy = clump + (1 - clump) * boost * 0.85;
      for (let row = 0; row < (boost > 0 ? 3 : 2); row++) {
        const rowShare = row === 0 ? 1 : row === 1 ? 0.6 + 0.35 * boost : 0.85 * boost * boost;
        const p = c * (0.2 + 0.85 * lumpy) * rowShare * share;
        const r = hash01(k, side * 3 + row, seed);
        if (r >= p) continue;
        if (side === 1 && signs.some((s) => Math.abs(d - s) < 1.4)) continue;
        const j = hash01(k, side * 7 + row, seed ^ 0x51);
        const culture = hot && hash01(k, side * 5 + row, seed ^ 0x7a) < Math.sqrt(boost) ? hot.hotspot.culture : home;
        out.push({
          d: d + (hash01(k, row, seed ^ 0x77) - 0.5) * SLOT * 0.8,
          lat: side * (ROAD_HALF_WIDTH + 1.45 + row * 1.15 + hash01(k, side + 5, seed ^ 0x33) * 0.8),
          yaw: (j - 0.5) * 0.7,
          scale: 0.9 + hash01(k, side, seed ^ 0x99) * 0.22,
          shirt: pickShirt(culture, hash01(k, side + row * 9, seed ^ 0x13)),
          culture,
          flag: flags && hash01(k, side + 11, seed ^ 0x24) < FLAG_SHARE + 0.16 * boost,
        });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- geometry ----

/**
 * One spectator facing +z, about 1.75 m tall. Vertex attributes: `aPart` (0 skin, 1 shirt,
 * 2 trousers, 3 pole, 4 flag cloth, 5 cap) tells the shader which colour to use, `aWave` (0..1,
 * how far out along an arm or a flag) how much that vertex moves when they cheer, and `aFlagUv`
 * where on the flag cloth a vertex is. `detailed` (High and Ultra) adds caps, which the shader
 * shows on about half of the spectators, and a bigger flag.
 */
export function spectatorGeometry(flag: boolean, detailed = false): THREE.BufferGeometry {
  const part = (g: THREE.BufferGeometry, id: number, wave: (y: number, x: number) => number = () => 0) => {
    const n = g.index ? g.toNonIndexed() : g;
    const p = n.attributes.position;
    // Only the flag cloth keeps its uv (as aFlagUv); the other parts carry zeros so the merged geometry has the same attributes.
    n.setAttribute('aFlagUv', id === 4 ? n.attributes.uv : new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
    n.deleteAttribute('uv');
    n.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(p.count).fill(id), 1));
    n.setAttribute('aWave', new THREE.BufferAttribute(Float32Array.from({ length: p.count }, (_, i) => wave(p.getY(i), p.getX(i))), 1));
    return n;
  };
  const armWave = (y: number) => Math.min(1, Math.max(0, (y - 1.38) / 0.45));
  // An arm raised and angled out from the shoulder (so it reads as a wave, not rabbit ears); `side` is -1 left, +1 right.
  const arm = (side: number, tilt = 0.45) => new THREE.BoxGeometry(0.12, 0.45, 0.12).translate(0, 0.225, 0).rotateZ(-side * tilt).translate(side * 0.27, 1.38, 0);
  const parts = [
    part(new THREE.BoxGeometry(0.28, 0.8, 0.22).translate(0, 0.4, 0), 2),
    part(new THREE.BoxGeometry(0.5, 0.62, 0.28).translate(0, 1.1, 0), 1),
    part(new THREE.IcosahedronGeometry(0.16, 1).translate(0, 1.58, 0), 0),
    part(arm(-1), 0, armWave), // arms up
    part(arm(1), 0, armWave),
  ];
  if (detailed) {
    parts.push(part(new THREE.CylinderGeometry(0.15, 0.17, 0.09, 8).translate(0, 1.71, 0), 5)); // a cap with a peak
    parts.push(part(new THREE.BoxGeometry(0.2, 0.02, 0.15).translate(0, 1.68, 0.2), 5));
  }
  if (flag) {
    const w = detailed ? 1.1 : 0.85;
    const h = detailed ? 0.66 : 0.5;
    const top = detailed ? 3.2 : 2.95; // the top of the pole, and of the cloth
    parts.push(part(new THREE.CylinderGeometry(0.018, 0.018, top - 0.85, 5).translate(0.36, (top + 0.85) / 2, 0.02), 3));
    parts.push(part(new THREE.PlaneGeometry(w, h, 4, 1).translate(0.36 + w / 2, top - h / 2, 0.02), 4, (_y, x) => Math.min(1, Math.max(0, (x - 0.36) / w))));
  }
  return mergeGeometries(parts)!;
}

export const crowdUniforms = {
  uTime: { value: 0 },
  uRider: { value: new THREE.Vector3(1e6, 0, 1e6) },
};

/**
 * The crowd's material. `flags` are the designs its flag-wavers choose from (a culture's list):
 * each material has its own table, so a crowd of Dutch fans and one of French ones are two
 * materials sharing one program and one flag atlas. Without flags the atlas isn't touched.
 */
export function crowdMaterial(flags: readonly FlagDesign[] = []): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
  const designs = new Array<number>(MAX_DESIGNS).fill(0);
  flags.slice(0, MAX_DESIGNS).forEach((f, i) => { designs[i] = FLAG_DESIGNS.indexOf(f); });
  const own = {
    uDesigns: { value: designs },
    uDesignCount: { value: Math.min(flags.length, MAX_DESIGNS) },
    uFlags: { value: flags.length ? flagAtlas() : null },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, crowdUniforms, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
#define FLAG_N ${FLAG_DESIGNS.length}.0
attribute float aPart;
attribute float aWave;
attribute vec2 aFlagUv;
uniform float uTime;
uniform vec3 uRider;
uniform float uDesigns[${MAX_DESIGNS}];
uniform float uDesignCount;
varying vec3 vCrowd;
varying vec2 vFlagUv;
varying vec3 vLocal;
varying float vFlag;
varying float vDots;
float afCh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float h1 = afCh(ip.xz * 0.37);
  float h2 = afCh(ip.zx * 0.53 + 3.1);
  float h3 = afCh(ip.xz * 0.71 + 7.7);
  float near = 1.0 - smoothstep(10.0, 70.0, distance(ip.xz, uRider.xz));
  float ph = uTime * (4.5 + h1 * 3.0) + h2 * 40.0;
  float cheer = 0.2 + 0.8 * near;
  // Jump (some of them), sway, arms and flags waving.
  transformed.y += max(0.0, sin(ph)) * 0.2 * near * step(0.45, h1);
  transformed.x += sin(ph * 0.5) * 0.03;
  if (aPart < 0.5) transformed.x += aWave * sin(ph * 1.7) * 0.22 * cheer;
  if (aPart > 3.5 && aPart < 4.5) transformed.z += aWave * sin(ph * 2.3 - aWave * 5.0) * (0.1 + 0.14 * cheer);
  // Caps (High and Ultra) sit on about half of them: the rest are folded away to nothing.
  if (aPart > 4.5 && h3 < 0.5) transformed = vec3(0.0);
  // A shirt colour with red above 1.5 is the polka-dot jersey: white here, the dots are drawn in the fragment shader.
  vec3 shirt = instanceColor;
  float polka = step(1.5, shirt.r);
  shirt = mix(shirt, vec3(1.0), polka);
  vec3 skin = h2 < 0.25 ? vec3(0.55, 0.33, 0.22) : h2 < 0.5 ? vec3(0.78, 0.55, 0.41) : h2 < 0.75 ? vec3(0.87, 0.67, 0.55) : vec3(0.32, 0.19, 0.13);
  vec3 cap = h1 > 0.8 ? vec3(0.04, 0.05, 0.08) : shirt;
  vCrowd = aPart < 0.5 ? skin : aPart < 1.5 ? shirt : aPart < 2.5 ? vec3(0.03, 0.04, 0.07) * (0.6 + h1) : aPart < 3.5 ? vec3(0.5) : aPart < 4.5 ? vec3(1.0) : cap;
  vDots = polka * step(0.5, aPart) * (1.0 - step(1.5, aPart));
  vLocal = position;
  // The flag cloth shows one row of the atlas, picked per spectator from the material's table.
  vFlag = step(3.5, aPart) * (1.0 - step(4.5, aPart));
  float row = uDesignCount > 0.5 ? uDesigns[int(floor(h3 * uDesignCount))] : 0.0;
  vFlagUv = vec2(aFlagUv.x, (FLAG_N - 1.0 - row + aFlagUv.y) / FLAG_N);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uFlags;
varying vec3 vCrowd;
varying vec2 vFlagUv;
varying vec3 vLocal;
varying float vFlag;
varying float vDots;`)
      // three multiplies the instance colour in already (as vColor); the shader picks each part's colour itself.
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = diffuse * vCrowd;
if (vFlag > 0.5) diffuseColor.rgb = diffuse * texture2D(uFlags, vFlagUv).rgb;
else if (vDots > 0.5) {
  vec3 q = fract(vLocal * 5.0) - 0.5;
  if (dot(q, q) < 0.075) diffuseColor.rgb = diffuse * vec3(0.6, 0.012, 0.02);
}`);
  };
  mat.side = THREE.DoubleSide; // the flag cloth
  return mat;
}

/** An instanced mesh of `people` (all plain or all flag-wavers), placed relative to `origin`. */
export function buildCrowd(people: Spectator[], geo: THREE.BufferGeometry, mat: THREE.Material, origin: { x: number; z: number }, shadows: boolean): THREE.InstancedMesh | null {
  if (!people.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, people.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  people.forEach((s, i) => {
    const p = roadPoint(s.d);
    const rx = -Math.sin(p.heading);
    const rz = Math.cos(p.heading);
    pos.set(p.x + rx * s.lat - origin.x, p.y - 0.15, p.z + rz * s.lat - origin.z);
    // Face the road: the direction from the spectator back to the centreline, +z being the front.
    const fx = -rx * Math.sign(s.lat);
    const fz = -rz * Math.sign(s.lat);
    q.setFromAxisAngle(up, Math.atan2(fx, fz) + s.yaw);
    sc.setScalar(s.scale);
    m.compose(pos, q, sc);
    mesh.setMatrixAt(i, m);
    // The polka-dot jersey is marked by a red channel above 1 (the colour buffer is floats).
    mesh.setColorAt(i, s.shirt === POLKA ? col.setRGB(2, 2, 2) : col.set(s.shirt));
  });
  mesh.castShadow = shadows;
  mesh.computeBoundingSphere();
  return mesh;
}
