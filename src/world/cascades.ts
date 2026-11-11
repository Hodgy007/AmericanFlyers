import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import type { CascadePlan } from './quality';
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js';

// Cascaded sun shadows for High and Ultra: three maps fitted to slices of the camera's view, so
// trees, spectators, barriers and landmarks a couple of hundred metres out still anchor to the
// ground, while the rider and bike keep a map as crisp as the old single box.
//
// three r187 ships `SunLight` (examples/jsm/lights): a light whose shadow is a set of cascades in
// one atlas, selected and blended per pixel inside the standard light chunks, so every built-in or
// onBeforeCompile-patched material (terrain, road, trees, riders, the fog and cloud-shadow chunks)
// gets it without a change. Its stock shadow has two cascades split by a fixed rule; ours has three,
// with the first one sized for the rider. That needs three small things the add-on doesn't offer,
// all here: our own fit (below), the cascade count in the shader chunk (`installCascades`), and a
// bias that grows with each cascade's texel size.
//
// The cascade maths follows three's SunLightShadow (MIT): each slice of the view frustum is wrapped
// in a bounding sphere (so turning the camera doesn't change its size), and the sphere's centre is
// snapped to whole texels (so riding along doesn't shimmer).

export const CASCADES = 3;

/** Fraction of a slice's depth over which it blends into the next one. */
const FADE = 0.12;

// What the add-on keeps to itself, which we have to reach.
interface Internals {
  _cameras: THREE.OrthographicCamera[];
  _matrices: THREE.Matrix4[];
  _frustums: THREE.Frustum[];
  _cascadeData: THREE.Vector4[];
  _viewports: THREE.Vector4[];
  _viewportCount: number;
  _frameExtents: THREE.Vector2;
  _updateMatrix(camera: THREE.Camera, matrix: THREE.Matrix4, frustum: THREE.Frustum, viewport: THREE.Vector4): void;
}

const lightRot = new THREE.Matrix4();
const viewToLight = new THREE.Matrix4();
const lightDir = new THREE.Vector3();
const up = new THREE.Vector3();
const centre = new THREE.Vector3();
const nearC = [0, 1, 2, 3].map(() => new THREE.Vector3());
const farC = [0, 1, 2, 3].map(() => new THREE.Vector3());
const corners = Array.from({ length: 8 }, () => new THREE.Vector3());

export class CascadeShadow extends SunLightShadow {
  plan: CascadePlan = { tile: 2048, ends: [24, 75], range: 200 };

  constructor() {
    super();
    const s = this as unknown as Internals;
    s._cameras.push(new THREE.OrthographicCamera());
    s._matrices.push(new THREE.Matrix4());
    s._frustums.push(new THREE.Frustum());
    s._cascadeData.push(new THREE.Vector4());
    while (s._viewports.length < CASCADES) s._viewports.push(new THREE.Vector4());
    s._viewportCount = CASCADES;
    s._frameExtents.set(CASCADES, 1);
  }

  override updateMatrices(light: THREE.Light, viewCamera?: THREE.Camera) {
    const cam = viewCamera as THREE.PerspectiveCamera | undefined;
    if (!cam) return;
    const s = this as unknown as Internals;
    const { plan } = this;
    this.mapSize.set(plan.tile, plan.tile);

    // Inset each cascade's viewport so the PCF taps never read across into the next tile.
    const inset = Math.min(0.25, (Math.ceil(this.radius) + 1) / plan.tile);
    for (let i = 0; i < CASCADES; i++) s._viewports[i].set(i + inset, inset, 1 - 2 * inset, 1 - 2 * inset);
    const res = plan.tile * (1 - 2 * inset);

    const near = cam.near;
    const far = Math.max(near + 1e-6, Math.min(plan.range, cam.far));
    const ends = [plan.ends[0], plan.ends[1], far];

    lightDir.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    up.set(0, 1, 0);
    if (Math.abs(up.dot(lightDir)) > 0.99) up.set(0, 0, 1);
    lightRot.lookAt(centre.set(0, 0, 0), lightDir, up);
    viewToLight.copy(lightRot).transpose().multiply(cam.matrixWorld);

    // The view frustum's corners in light space (a rotation keeps distances, so we can fit and snap there).
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1;
      const y = i === 0 || i === 3 ? 1 : -1;
      const n = nearC[i].set(x, y, -1).applyMatrix4(cam.projectionMatrixInverse);
      farC[i].copy(n).multiplyScalar(far / near);
      n.applyMatrix4(viewToLight);
      farC[i].applyMatrix4(viewToLight);
      maxZ = Math.max(maxZ, n.z, farC[i].z);
    }
    maxZ += far; // casters up the sun's side of the view still shade it
    const shadowNear = this.camera.near;

    let texel0 = 0;
    let begin = near;
    for (let i = 0; i < CASCADES; i++) {
      const end = ends[i];
      const fadeStart = end - FADE * (end - (i === 0 ? near : ends[i - 1]));
      s._cascadeData[i].set(i === 0 ? -1e10 : begin, end, fadeStart, 1);

      const a0 = (begin - near) / (far - near);
      const a1 = (end - near) / (far - near);
      centre.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        corners[j * 2].lerpVectors(nearC[j], farC[j], a0);
        corners[j * 2 + 1].lerpVectors(nearC[j], farC[j], a1);
        centre.add(corners[j * 2]).add(corners[j * 2 + 1]);
      }
      centre.multiplyScalar(1 / 8);
      let r2 = 0;
      let minZ = Infinity;
      for (const c of corners) { r2 = Math.max(r2, c.distanceToSquared(centre)); minZ = Math.min(minZ, c.z); }
      const radius = Math.sqrt(r2) / (1 - 1 / res); // half a texel of room, so snapping never clips a corner
      const texel = (2 * radius) / res;
      centre.x = Math.round(centre.x / texel) * texel;
      centre.y = Math.round(centre.y / texel) * texel;
      centre.z = maxZ + shadowNear;
      centre.applyMatrix4(lightRot);
      if (i === 0) texel0 = texel;
      s._cascadeData[i].w = texel / texel0; // the shader widens its bias by this

      const c = s._cameras[i];
      c.position.copy(centre);
      c.quaternion.setFromRotationMatrix(lightRot);
      c.left = -radius; c.right = radius; c.top = radius; c.bottom = -radius;
      c.near = shadowNear;
      c.far = maxZ - minZ + 2 * shadowNear;
      c.coordinateSystem = this.camera.coordinateSystem;
      (c as unknown as { _reversedDepth: boolean })._reversedDepth = (this.camera as unknown as { _reversedDepth: boolean })._reversedDepth;
      c.updateProjectionMatrix();
      c.updateMatrixWorld();
      s._updateMatrix(c, s._matrices[i], s._frustums[i], s._viewports[i]);
      begin = fadeStart;
    }
  }
}

/** A sun light with the three-cascade shadow. */
export function createCascadeLight(): SunLight {
  const light = new SunLight(0xffffff, 1);
  light.shadow = new CascadeShadow();
  return light;
}

let installed = false;

/**
 * Call once before the first render. Tells the shadow chunk there are three cascades, and makes the
 * lookup widen its bias with the cascade's texel size (a far cascade's texels are ten times a near
 * one's, so the offset that keeps the road clean up close would let the far ground speckle).
 */
export function installCascades() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  const src = C.shadowmap_pars_fragment;
  let out = src.replace('#define SUN_LIGHT_CASCADES 2', `#define SUN_LIGHT_CASCADES ${CASCADES}`);
  const a = out.indexOf('float getSunShadow(');
  const b = out.indexOf('#if NUM_POINT_LIGHT_SHADOWS', a);
  if (a >= 0 && b > a) {
    let f = out.slice(a, b);
    f = f.replace(
      /vec4 shadowWorldPosition = vec4\( vSunShadowWorldPosition\.xyz \+ vSunShadowWorldNormal \* sunLightShadow\.shadowNormalBias, 1\.0 \);/,
      'vec3 swp = vSunShadowWorldPosition.xyz;\n\t\t\tvec3 swn = vSunShadowWorldNormal * sunLightShadow.shadowNormalBias;',
    );
    f = f.replace('sunLightShadow.shadowBias,', 'sunLightShadow.shadowBias * sqrt( cascade.w ),');
    f = f.replace('sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition', 'sunShadowMatrix[ cascadeOffset + i ] * vec4( swp + swn * cascade.w, 1.0 )');
    out = out.slice(0, a) + f + out.slice(b);
  }
  C.shadowmap_pars_fragment = out;
}
