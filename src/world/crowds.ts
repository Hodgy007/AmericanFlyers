import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { crowdNear } from './crowdZones';
import { ROAD_HALF_WIDTH, hash01, seedOf } from './roadside';

// Spectators: instanced low-poly people lining the hairpins, the summit and the
// last few hundred metres, wherever crowdNear() (crowdZones.ts, which the crowd
// roar in the sound also uses) says crowds are. They stand in clumps on both
// sides, some of them waving flags. Positions are a pure function of the stage
// and the distance, so a crowd is in the same place every ride. The cheering
// (jumping, waving arms and flags) is all in the vertex shader: spectators near
// the rider get going as you pass, the rest sway a little.

const SLOT = 1.7; // metres between spectator slots along the road
const SHIRTS = ['#e63946', '#f4c430', '#2a9d8f', '#3a86ff', '#ff7f50', '#f4f4f4', '#8338ec', '#06d6a0', '#ff006e', '#fb8500', '#2b2d42', '#70d6ff'];
const FLAG_SHARE = 0.14;

export interface Spectator {
  d: number;
  lat: number; // metres from the centreline, + right
  yaw: number; // extra turn, rad
  scale: number;
  shirt: number; // index into SHIRTS
  flag: boolean;
}

/** Spectators for road distances [d0, d1). `share` (0..1) thins them for the weaker graphics tiers; `signs` are course distances to keep clear (roadside signs). */
export function planCrowd(stage: Stage, d0: number, d1: number, share: number, signs: number[], flags: boolean): Spectator[] {
  if (share <= 0) return [];
  const seed = seedOf(stage.id);
  const out: Spectator[] = [];
  for (let k = Math.ceil(d0 / SLOT); k * SLOT < d1; k++) {
    const d = k * SLOT;
    const c = crowdNear(d);
    if (c < 0.04) continue;
    // Clumps: a slow wave along the road, different on each side, leaves gaps.
    for (const side of [-1, 1] as const) {
      const clump = 0.5 + 0.5 * Math.sin(d / 9.5 + hash01(seed, side, 3) * 40) * Math.sin(d / 23 + hash01(seed, side, 4) * 40);
      for (let row = 0; row < 2; row++) {
        const p = c * (0.2 + 0.85 * clump) * (row ? 0.6 : 1) * share;
        const r = hash01(k, side * 3 + row, seed);
        if (r >= p) continue;
        if (side === 1 && signs.some((s) => Math.abs(d - s) < 1.4)) continue;
        const j = hash01(k, side * 7 + row, seed ^ 0x51);
        out.push({
          d: d + (hash01(k, row, seed ^ 0x77) - 0.5) * SLOT * 0.8,
          lat: side * (ROAD_HALF_WIDTH + 1.45 + row * 1.15 + hash01(k, side + 5, seed ^ 0x33) * 0.8),
          yaw: (j - 0.5) * 0.7,
          scale: 0.9 + hash01(k, side, seed ^ 0x99) * 0.22,
          shirt: Math.floor(hash01(k, side + row * 9, seed ^ 0x13) * SHIRTS.length),
          flag: flags && hash01(k, side + 11, seed ^ 0x24) < FLAG_SHARE,
        });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------- geometry ----

/**
 * One spectator facing +z, about 1.75 m tall. Vertex attributes: `aPart` (0 skin, 1 shirt,
 * 2 trousers, 3 pole, 4 flag cloth) tells the shader which colour to use, and `aWave` (0..1,
 * how far out along an arm or a flag) how much that vertex moves when they cheer.
 */
export function spectatorGeometry(flag: boolean): THREE.BufferGeometry {
  const part = (g: THREE.BufferGeometry, id: number, wave: (y: number, x: number) => number = () => 0) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    const p = n.attributes.position;
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
  if (flag) {
    parts.push(part(new THREE.CylinderGeometry(0.018, 0.018, 2.1, 5).translate(0.36, 1.9, 0.02), 3));
    parts.push(part(new THREE.PlaneGeometry(0.85, 0.5, 4, 1).translate(0.36 + 0.43, 2.7, 0.02), 4, (_y, x) => Math.min(1, Math.max(0, (x - 0.36) / 0.85))));
  }
  return mergeGeometries(parts)!;
}

export const crowdUniforms = {
  uTime: { value: 0 },
  uRider: { value: new THREE.Vector3(1e6, 0, 1e6) },
};

export function crowdMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, crowdUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPart;
attribute float aWave;
uniform float uTime;
uniform vec3 uRider;
varying vec3 vCrowd;
float afCh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float h1 = afCh(ip.xz * 0.37);
  float h2 = afCh(ip.zx * 0.53 + 3.1);
  float near = 1.0 - smoothstep(10.0, 70.0, distance(ip.xz, uRider.xz));
  float ph = uTime * (4.5 + h1 * 3.0) + h2 * 40.0;
  float cheer = 0.2 + 0.8 * near;
  // Jump (some of them), sway, arms and flags waving.
  transformed.y += max(0.0, sin(ph)) * 0.2 * near * step(0.45, h1);
  transformed.x += sin(ph * 0.5) * 0.03;
  if (aPart < 0.5) transformed.x += aWave * sin(ph * 1.7) * 0.22 * cheer;
  if (aPart > 3.5) transformed.z += aWave * sin(ph * 2.3 - aWave * 5.0) * (0.1 + 0.14 * cheer);
  vec3 shirt = instanceColor;
  vec3 skin = h2 < 0.25 ? vec3(0.55, 0.33, 0.22) : h2 < 0.5 ? vec3(0.78, 0.55, 0.41) : h2 < 0.75 ? vec3(0.87, 0.67, 0.55) : vec3(0.32, 0.19, 0.13);
  vCrowd = aPart < 0.5 ? skin : aPart < 1.5 ? shirt : aPart < 2.5 ? vec3(0.03, 0.04, 0.07) * (0.6 + h1) : aPart < 3.5 ? vec3(0.5) : shirt * vec3(1.0, 0.85, 0.7) + vec3(0.1);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCrowd;')
      // three multiplies the instance colour in already (as vColor); the shader picks each part's colour itself.
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = diffuse * vCrowd;');
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
    mesh.setColorAt(i, col.set(SHIRTS[s.shirt]));
  });
  mesh.castShadow = shadows;
  mesh.computeBoundingSphere();
  return mesh;
}
