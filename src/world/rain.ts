import * as THREE from 'three';

// Rain: a few thousand short streaks in a box that follows the camera. Every
// streak's position is worked out in the vertex shader from the clock, so the
// CPU only updates a handful of uniforms per frame. Streaks are fixed in the
// world and wrap round the box, so when you ride through them they stream past
// the way real rain does.

const BOX = new THREE.Vector3(44, 26, 44); // metres
const MAX_DROPS = 3600;
const REDUCED_DROPS = 1300;

const vertexShader = /* glsl */ `
  attribute vec4 drop;   // xyz: start position in the box (0..1), w: random 0..1
  attribute float tip;   // 0 = head of the streak, 1 = tail
  uniform float time;
  uniform vec3 centre;   // middle of the box, in the world
  uniform vec3 box;
  uniform vec3 fall;     // velocity, metres per second
  uniform float streak;
  uniform float level;   // 0..1: how many drops are out
  uniform float opacity;
  varying float vAlpha;
  void main() {
    vec3 p = drop.xyz * box + fall * time - centre;
    p = mod(p, box);
    vec3 pos = centre + p - box * 0.5;
    pos -= normalize(fall) * streak * tip * (0.6 + 0.8 * drop.w);
    // Fade towards the edges of the box and right next to the camera.
    vec3 e = abs(p / box - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.7, 1.0, max(max(e.x, e.y), e.z));
    vAlpha = opacity * edge * step(drop.w, level) * (1.0 - 0.45 * tip);
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(color, vAlpha);
  }`;

export class Rain {
  readonly object: THREE.LineSegments;
  private readonly uniforms = {
    time: { value: 0 },
    centre: { value: new THREE.Vector3() },
    box: { value: BOX },
    fall: { value: new THREE.Vector3(1.5, -11, 0.6) },
    streak: { value: 1.1 },
    level: { value: 0 },
    opacity: { value: 0.4 },
    color: { value: new THREE.Color('#b9c8dc') },
  };
  private readonly reduced: boolean;
  private level = 0;

  constructor() {
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = this.reduced ? REDUCED_DROPS : MAX_DROPS;
    const drop = new Float32Array(n * 2 * 4);
    const tip = new Float32Array(n * 2);
    const pos = new Float32Array(n * 2 * 3); // unused by the shader, but a draw needs a position attribute
    // A tiny seeded generator, so the pattern is the same each time.
    let seed = 20240607;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      const x = rand(), y = rand(), z = rand(), w = rand();
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 4;
        drop[o] = x; drop[o + 1] = y; drop[o + 2] = z; drop[o + 3] = w;
        tip[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('drop', new THREE.BufferAttribute(drop, 4));
    geo.setAttribute('tip', new THREE.BufferAttribute(tip, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.object = new THREE.LineSegments(geo, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 20;
    this.object.visible = false;
    if (this.reduced) {
      // Gentler: slower, shorter, fainter streaks.
      this.uniforms.fall.value.multiplyScalar(0.55);
      this.uniforms.streak.value = 0.6;
      this.uniforms.opacity.value = 0.3;
    }
  }

  get current() {
    return this.level;
  }

  /** `level` 0..1; `tint` is the colour of the light the drops catch. */
  update(dt: number, level: number, camera: THREE.Camera, tint: THREE.Color) {
    this.level = level;
    const on = level > 0.01;
    this.object.visible = on;
    if (!on) return;
    const u = this.uniforms;
    u.time.value += dt;
    // The box sits a little ahead of the camera, where you're looking.
    camera.getWorldDirection(u.centre.value);
    u.centre.value.multiplyScalar(9).add(camera.position);
    u.level.value = level;
    u.color.value.copy(tint);
  }
}
