import * as THREE from 'three';
import { fbm, rng } from './noise';

// Live sky state. These start as a clear mid-morning and are changed in place
// every frame by the Atmosphere (time of day and weather), never replaced, so
// the dome shader and the fog keep pointing at the same objects.
export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
export const HORIZON_COLOR = new THREE.Color('#cfe0ee');
export const ZENITH_COLOR = new THREE.Color('#2f6db5');
export const SUN_COLOR = new THREE.Color('#ffe9c0');
// Where the moon hangs in the sky (low and ahead-right, so it clears the numbers across the top).
export const MOON_DIRECTION = new THREE.Vector3(Math.cos(0.16) * Math.cos(0.5), Math.sin(0.16), Math.cos(0.16) * Math.sin(0.5)).normalize();

/** Sky dome, distant mountain ring and clouds. Everything here follows the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private readonly clouds = new THREE.Group();

  private ring: THREE.Mesh;
  private readonly domeUniforms = {
    zenith: { value: ZENITH_COLOR },
    horizon: { value: HORIZON_COLOR },
    sunDir: { value: SUN_DIRECTION },
    sunColor: { value: SUN_COLOR },
    moonDir: { value: MOON_DIRECTION },
    glow: { value: 1 }, // strength of the haze around the sun
    night: { value: 0 }, // 0..1: stars and moon
  };
  private readonly cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c4d2e2', flatShading: true, fog: false });
  private readonly cloudList: THREE.Group[] = [];
  private readonly mountainTint = new THREE.Color('#ffffff');
  private cloudCover = NaN; // nothing applied yet

  constructor(mountainScale = 1) {
    this.ring = this.mountains(mountainScale);
    this.group.add(this.dome(), this.ring, this.clouds);
    this.buildClouds();
    this.setCloudCover(0.35);
  }

  /** Atmosphere: glow around the sun, stars and moon (0..1). */
  setSkyLook(glow: number, night: number) {
    this.domeUniforms.glow.value = glow;
    this.domeUniforms.night.value = night;
  }

  /** Atmosphere: colour multiplied over the far mountains (haze, dusk, night). */
  setMountainTint(c: THREE.Color) {
    this.mountainTint.copy(c);
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(c);
  }

  /** Atmosphere: cloud colours, and how many clouds are out (0 = none, 1 = all, with overcast above). */
  setClouds(color: THREE.Color, glow: THREE.Color) {
    this.cloudMat.color.copy(color);
    this.cloudMat.emissive.copy(glow);
  }

  setCloudCover(cover: number) {
    if (Math.abs(cover - this.cloudCover) < 0.002) return;
    this.cloudCover = cover;
    const n = this.cloudList.length;
    for (let i = 0; i < n; i++) {
      // Each cloud grows in as the cover passes its turn; above 1 they swell into an overcast.
      const s = Math.min(1, Math.max(0, cover * n - i)) * (1 + 0.5 * Math.max(0, cover - 0.6));
      this.cloudList[i].scale.setScalar(Math.max(s, 0.0001));
      this.cloudList[i].visible = s > 0.01;
    }
  }

  /** Rebuilds the distant mountain ring at a new height scale (per stage). */
  setMountainScale(scale: number) {
    this.group.remove(this.ring);
    this.ring.geometry.dispose();
    this.ring = this.mountains(scale);
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(this.mountainTint);
    this.group.add(this.ring);
  }

  update(camera: THREE.Camera, dt: number) {
    // Follow the camera, including most of its climb, so the horizon stays put.
    this.group.position.set(camera.position.x, camera.position.y - 60, camera.position.z);
    this.clouds.rotation.y += dt * 0.002;
  }

  private dome() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.domeUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform vec3 moonDir;
        uniform float glow;
        uniform float night;
        varying vec3 vDir;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 dir = normalize(vDir);
          float h = max(dir.y, 0.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.45));
          // The sun: a hot disc and a soft glow, fading as it drops below the horizon.
          float up = smoothstep(-0.04, 0.05, sunDir.y);
          float s = max(dot(dir, sunDir), 0.0);
          col += sunColor * up * (pow(s, 900.0) * 6.0 + pow(s, 14.0) * 0.35 * glow + pow(s, 4.0) * 0.1 * glow);
          if (night > 0.01) {
            // Stars: one per grid cell on the sky, a few per cent of cells, fading towards the horizon.
            float r = hash(floor(dir * 520.0));
            float star = step(0.9975, r) * smoothstep(0.02, 0.3, dir.y) * (0.5 + 0.5 * hash(floor(dir * 520.0) + 7.0));
            // The moon: a pale disc with a faint halo.
            float m = max(dot(dir, moonDir), 0.0);
            col += vec3(0.85, 0.9, 1.0) * star * night * 1.4;
            col += vec3(0.95, 0.97, 1.0) * smoothstep(0.99962, 0.99984, m) * night * 1.6;
            col += vec3(0.5, 0.6, 0.9) * pow(m, 80.0) * night * 0.35;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), mat);
    dome.renderOrder = -2;
    return dome;
  }

  /** A jagged ring of far-off mountains, tinted towards the haze colour. */
  private mountains(scale: number) {
    const segs = 160;
    const radius = 3600;
    const pos: number[] = [];
    const col: number[] = [];
    const base = new THREE.Color('#7f95b3');
    const peak = new THREE.Color('#e6edf5');
    const c = new THREE.Color();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      // Sample noise around a circle so the ring joins up seamlessly.
      const n = fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3, 4);
      const h = (220 + n * 420 + Math.abs(fbm(Math.cos(a) * 25 + 5, Math.sin(a) * 25, 2)) * 160) * scale;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      // Three vertices per column so snow only caps the top of each peak.
      pos.push(x, -80, z, x, h * 0.72, z, x, h, z);
      col.push(base.r, base.g, base.b, base.r, base.g, base.b);
      c.copy(base).lerp(peak, Math.min(1, Math.max(0, (h / scale - 380) / 260)));
      col.push(c.r, c.g, c.b);
    }
    const index: number[] = [];
    for (let i = 0; i < segs; i++) {
      for (let row = 0; row < 2; row++) {
        const a = i * 3 + row;
        index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    mesh.renderOrder = -1;
    return mesh;
  }

  private buildClouds() {
    const mat = this.cloudMat;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const rand = rng(7);
    for (let i = 0; i < 26; i++) {
      const cloud = new THREE.Group();
      const puffs = 4 + Math.floor(rand() * 5);
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(geo, mat);
        const s = 40 + rand() * 50;
        m.scale.set(s * 1.5, s * 0.6, s);
        m.position.set((p - puffs / 2) * 55 + rand() * 30, rand() * 25, rand() * 40);
        cloud.add(m);
      }
      const a = rand() * Math.PI * 2;
      const r = 1600 + rand() * 1800;
      cloud.position.set(Math.cos(a) * r, 380 + rand() * 380, Math.sin(a) * r);
      cloud.rotation.y = rand() * Math.PI;
      this.clouds.add(cloud);
      this.cloudList.push(cloud);
    }
  }
}
