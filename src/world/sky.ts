import * as THREE from 'three';
import { fbm, rng } from './noise';

export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
export const HORIZON_COLOR = new THREE.Color('#cfe0ee');
const ZENITH_COLOR = new THREE.Color('#2f6db5');

/** Sky dome, distant mountain ring and clouds. Everything here follows the camera. */
export class Sky {
  readonly group = new THREE.Group();
  private readonly clouds = new THREE.Group();

  constructor() {
    this.group.add(this.dome(), this.mountains(), this.clouds);
    this.buildClouds();
  }

  update(camera: THREE.Camera, dt: number) {
    this.group.position.set(camera.position.x, 0, camera.position.z);
    this.clouds.rotation.y += dt * 0.002;
  }

  private dome() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: ZENITH_COLOR },
        horizon: { value: HORIZON_COLOR },
        sunDir: { value: SUN_DIRECTION },
      },
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
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = max(dir.y, 0.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.45));
          float s = max(dot(dir, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 6.0 + pow(s, 14.0) * 0.35);
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
  private mountains() {
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
      const h = 220 + n * 420 + Math.abs(fbm(Math.cos(a) * 25 + 5, Math.sin(a) * 25, 2)) * 160;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      // Three vertices per column so snow only caps the top of each peak.
      pos.push(x, -80, z, x, h * 0.72, z, x, h, z);
      col.push(base.r, base.g, base.b, base.r, base.g, base.b);
      c.copy(base).lerp(peak, Math.min(1, Math.max(0, (h - 380) / 260)));
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
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c4d2e2', flatShading: true, fog: false });
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
    }
  }
}
