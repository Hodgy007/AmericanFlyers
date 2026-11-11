import * as THREE from 'three';
import { wind } from './wind';
import { fbm } from './noise';
import { CLOUD_CELL, CLOUD_GLSL, CLOUD_HEIGHT } from './fog';
import { RING_RADIUS, bandOffset, bandShape, horizonUrl, type HorizonChoice, type HorizonKind } from './horizon';

// Live sky state. These start as a clear mid-morning and are changed in place
// every frame by the Atmosphere (time of day and weather), never replaced, so
// the dome shader and the fog keep pointing at the same objects.
export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
export const HORIZON_COLOR = new THREE.Color('#cfe0ee');
export const ZENITH_COLOR = new THREE.Color('#2f6db5');
export const SUN_COLOR = new THREE.Color('#ffe9c0');
// Where the moon hangs in the sky (low and ahead-right, so it clears the numbers across the top).
export const MOON_DIRECTION = new THREE.Vector3(Math.cos(0.16) * Math.cos(0.5), Math.sin(0.16), Math.cos(0.16) * Math.sin(0.5)).normalize();

/**
 * The sky's colour without clouds, sun or stars: the preset gradient (zenith to horizon, which
 * the time of day and weather drive) plus the scattering that depends on where the sun is: the
 * warm band along the horizon on the sun's side at low sun, and the pink "belt of Venus" opposite it.
 * Shared by the dome and by the haze on the far mountains so the two meet seamlessly.
 */
const SKY_BASE_GLSL = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float band;
vec3 skyBase( vec3 dir ) {
  float hp = max( dir.y, 0.0 );
  vec3 col = mix( horizon, zenith, pow( hp, 0.45 ) );
  float c = dot( normalize( dir.xz + 1e-4 ), normalize( sunDir.xz + 1e-4 ) );
  col += sunColor * band * pow( max( c, 0.0 ), 4.0 ) * exp( -hp * 5.0 );
  col += vec3( 0.9, 0.55, 0.65 ) * band * 0.35 * pow( max( -c, 0.0 ), 2.0 ) * exp( -hp * 6.0 );
  return col;
}`;

/** Sky dome, distant mountain ring and clouds. Everything here follows the camera. */
export class Sky {
  readonly group = new THREE.Group();

  private ring: THREE.Mesh;
  /** The stage's panorama on a cylinder, once it has loaded; the procedural ring is hidden behind it. */
  private band: THREE.Mesh | null = null;
  private bandTex: THREE.Texture | null = null;
  private horizon: HorizonChoice = 'none';
  private horizonStage = '';
  private mountainScale = 1;
  private horizonKey = ''; // loaded, loading or failed: `${kind}|${low}`
  private horizonGen = 0;
  private readonly shared = {
    zenith: { value: ZENITH_COLOR },
    horizon: { value: HORIZON_COLOR },
    sunDir: { value: SUN_DIRECTION },
    sunColor: { value: SUN_COLOR },
    band: { value: 0 }, // strength of the horizon band at low sun
  };
  private readonly domeUniforms = {
    ...this.shared,
    moonDir: { value: MOON_DIRECTION },
    glow: { value: 1 }, // strength of the haze around the sun
    night: { value: 0 }, // 0..1: stars and moon
    overcast: { value: 0 }, // 0..1: grey cover; hides the sun
    discGain: { value: 30 },
    cloudLit: { value: new THREE.Color('#ffffff') },
    cloudShade: { value: new THREE.Color('#c4d2e2') },
    cloudThr: { value: 0.6 }, // density above which there is cloud: lower = more of it
    cloudOff: { value: new THREE.Vector2() }, // drift, in cells
  };
  private readonly ringUniforms = {
    ...this.shared,
    tint: { value: new THREE.Color('#ffffff') },
    hazeD: { value: 3 }, // optical depth of the haze at the foot of the mountains
  };
  private dome: THREE.Mesh;
  private cloudCover = NaN; // nothing applied yet
  readonly drift = new THREE.Vector2(); // the clouds' drift (cells), also read by the cloud shadows
  private quality = -1;

  constructor(mountainScale = 1, horizon: HorizonChoice = 'none', stageId = '') {
    this.mountainScale = mountainScale;
    this.horizon = horizon;
    this.horizonStage = stageId;
    this.dome = this.makeDome();
    this.ring = this.mountains(mountainScale);
    this.group.add(this.dome, this.ring);
    this.setCloudCover(0.35);
    this.setQuality(1);
  }

  /** The dome mesh, for the reflection probe. */
  get domeMesh() { return this.dome; }

  /** Brightness of the sun's disc (turned down while the reflection probe looks at the sky, so it doesn't speckle the filtered map). */
  setDiscGain(g: number) { this.domeUniforms.discGain.value = g; }

  /** Cloud detail by graphics tier: 0, 1, 2 for 3, 4, 5 noise octaves. */
  setQuality(q: number) {
    if (q === this.quality) return;
    this.quality = q;
    this.invalidateHorizon();
    const m = this.dome.material as THREE.ShaderMaterial;
    m.defines = { CLOUD_OCT: 3 + q };
    m.needsUpdate = true;
  }

  /** Per stage: which panorama stands on the horizon and how tall the mountains are. The panorama loads on the next frame; until it has (or if it can't), the procedural ring shows. */
  setHorizon(horizon: HorizonChoice, mountainScale: number, stageId: string) {
    if (horizon !== this.horizon || stageId !== this.horizonStage) this.invalidateHorizon();
    this.horizon = horizon;
    this.horizonStage = stageId;
    this.mountainScale = mountainScale;
    this.setMountainScale(mountainScale);
  }

  /** Atmosphere: glow around the sun, stars and moon (0..1), how overcast (0..1) and the low-sun horizon band. */
  setSkyLook(glow: number, night: number, overcast: number, band: number) {
    const u = this.domeUniforms;
    u.glow.value = glow;
    u.night.value = night;
    u.overcast.value = overcast;
    this.shared.band.value = band;
  }

  /** Atmosphere: colour multiplied over the far mountains (haze, dusk, night), and how thick the haze is at their feet. */
  setMountainTint(c: THREE.Color, hazeDepth: number) {
    this.ringUniforms.tint.value.copy(c);
    this.ringUniforms.hazeD.value = hazeDepth;
  }

  /** Atmosphere: lit and shaded cloud colours. */
  setClouds(lit: THREE.Color, shade: THREE.Color) {
    this.domeUniforms.cloudLit.value.copy(lit);
    this.domeUniforms.cloudShade.value.copy(shade);
  }

  /** How much cloud there is (0 none … 1 broken … above 1 overcast): the density threshold the sky and the cloud shadows share. */
  setCloudCover(cover: number) {
    if (Math.abs(cover - this.cloudCover) < 0.002) return;
    this.cloudCover = cover;
    this.domeUniforms.cloudThr.value = Math.max(0.25, 0.72 - 0.3 * cover);
  }

  get cloudThreshold() { return this.domeUniforms.cloudThr.value; }

  /** Rebuilds the distant mountain ring at a new height scale (per stage). */
  setMountainScale(scale: number) {
    this.mountainScale = scale;
    this.group.remove(this.ring);
    this.ring.geometry.dispose();
    this.ring = this.mountains(scale);
    this.ring.visible = !this.band;
    this.group.add(this.ring);
    if (this.band) this.buildBand(); // same panorama, new height
  }

  /** Fetches the panorama this stage and tier want, once, and swaps it in. A failed or missing file leaves the procedural ring. */
  private syncHorizon() {
    const kind = this.horizon === 'none' ? null : this.horizon;
    const key = kind ? `${kind}|${this.quality === 0}` : 'none';
    if (key === this.horizonKey) return;
    this.horizonKey = key;
    const gen = ++this.horizonGen;
    this.dropBand(); // the old stage's panorama must not hang on while the new one loads
    if (!kind) return;
    new THREE.TextureLoader().loadAsync(horizonUrl(kind, this.quality === 0, import.meta.env.BASE_URL)).then(
      (tex) => {
        if (gen !== this.horizonGen) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.MirroredRepeatWrapping; // mirrored, so the panorama's ends never show a seam
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 4;
        this.bandTex = tex;
        this.buildBand();
      },
      () => { /* keep the failed key and procedural ring until the stage or quality changes */ },
    );
  }

  private invalidateHorizon() {
    this.horizonKey = '';
    ++this.horizonGen; // invalidate pending loads before another frame can accept them
    this.dropBand();
  }

  private dropBand() {
    if (this.band) {
      this.group.remove(this.band);
      this.band.geometry.dispose();
      (this.band.material as THREE.Material).dispose();
      this.band = null;
    }
    this.bandTex?.dispose();
    this.bandTex = null;
    this.ring.visible = true;
  }

  /** The panorama on a cylinder at the ring's radius, tall enough that its ridge line sits where the stage's mountain scale puts it. */
  private buildBand() {
    if (!this.bandTex || this.horizon === 'none') return;
    const kind: HorizonKind = this.horizon;
    const shape = bandShape(kind, this.mountainScale);
    if (this.band) {
      this.group.remove(this.band);
      this.band.geometry.dispose();
      (this.band.material as THREE.Material).dispose();
    }
    const geo = new THREE.CylinderGeometry(RING_RADIUS, RING_RADIUS, shape.height, 160, 1, true);
    geo.translate(0, shape.bottom + shape.height / 2, 0);
    const mat = this.bandMaterial(this.bandTex, shape.repeats, bandOffset(this.horizonStage) * 2);
    this.band = new THREE.Mesh(geo, mat);
    this.band.renderOrder = -1;
    this.band.frustumCulled = false;
    this.group.add(this.band);
    this.ring.visible = false;
  }

  private bandMaterial(map: THREE.Texture, reps: number, off: number) {
    return new THREE.ShaderMaterial({
      fog: false,
      side: THREE.DoubleSide,
      uniforms: { ...this.ringUniforms, map: { value: map }, reps: { value: reps }, uvOff: { value: off } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vP;
        void main() {
          vUv = uv;
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_BASE_GLSL}
        uniform sampler2D map;
        uniform float reps;
        uniform float uvOff;
        uniform vec3 tint;
        uniform float hazeD;
        varying vec2 vUv;
        varying vec3 vP;
        void main() {
          vec4 t = texture2D(map, vec2(vUv.x * reps + uvOff, vUv.y));
          if (t.a < 0.5) discard; // the sky shows through; the silhouette's edge is already softened in the file
          // The haze at the foot of the range, plus a veil over all of it: the panoramas are saturated and nothing 3.6 km off is that crisp.
          float haze = 1.0 - (1.0 - 0.3) * exp(-hazeD * exp(-max(vP.y, 0.0) / 150.0));
          vec3 hz = skyBase(vec3(vP.x, 0.03 * length(vP.xz), vP.z) / length(vP));
          gl_FragColor = vec4(mix(t.rgb * tint, hz, haze), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
  }

  update(camera: THREE.Camera, dt: number) {
    this.syncHorizon();
    // Follow the camera, including most of its climb, so the horizon stays put.
    this.group.position.set(camera.position.x, camera.position.y - 60, camera.position.z);
    // Clouds travel with the wind (high winds run faster than the ones on the road), never quite still.
    const w = wind.vector();
    const speed = Math.hypot(w.x, w.z);
    const k = (3 * Math.max(speed, 0.7)) / CLOUD_CELL;
    const dx = speed > 0.01 ? w.x / speed : 1;
    const dz = speed > 0.01 ? w.z / speed : 0;
    // The cloud pattern is sampled at world position / cell + drift, so it moves with the wind when the drift moves against it.
    this.drift.x -= dx * k * dt;
    this.drift.y -= dz * k * dt;
    this.domeUniforms.cloudOff.value.copy(this.drift);
  }

  private makeDome() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.domeUniforms,
      defines: { CLOUD_OCT: 4 },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_BASE_GLSL}
        ${CLOUD_GLSL}
        uniform vec3 moonDir;
        uniform float glow;
        uniform float night;
        uniform float overcast;
        uniform float discGain;
        uniform vec3 cloudLit;
        uniform vec3 cloudShade;
        uniform float cloudThr;
        uniform vec2 cloudOff;
        varying vec3 vDir;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 dir = normalize(vDir);
          float h = dir.y;
          vec3 col = skyBase(dir);
          float mu = dot(dir, sunDir);
          float up = smoothstep(-0.06, 0.06, sunDir.y);
          float cover = 0.0;
          vec3 cloudCol = vec3(0.0);
          if (h > 0.012) {
            vec2 q = (cameraPosition.xz + dir.xz * (${CLOUD_HEIGHT.toFixed(1)} / h)) / ${CLOUD_CELL.toFixed(1)} + cloudOff;
            float d = afCloud(q, CLOUD_OCT);
            float a = smoothstep(cloudThr, cloudThr + 0.16, d);
            float ds = afCloud(q + sunDir.xz / max(sunDir.y, 0.25) * 0.09, CLOUD_OCT - 1);
            float lit = exp(-max(ds - d, 0.0) * 5.0 - max(d - cloudThr, 0.0) * 1.6 * (0.4 + overcast));
            cloudCol = mix(cloudShade, cloudLit, lit);
            cloudCol += sunColor * pow(max(mu, 0.0), 6.0) * lit * 0.35 * up * (1.0 - overcast);
            float horizonK = smoothstep(0.012, 0.3, h);
            cloudCol = mix(skyBase(vec3(dir.x, 0.02, dir.z)), cloudCol, 0.35 + 0.65 * horizonK);
            cover = a * (0.25 + 0.75 * horizonK);
          }
          float g = 0.76;
          float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * max(mu, 0.0), 1.5);
          float vis = up * (1.0 - cover) * (1.0 - overcast);
          col += sunColor * up * (hg * 0.03 * glow * (1.0 - 0.7 * cover) + pow(max(mu, 0.0), 14.0) * 0.12 * glow);
          col += sunColor * vis * discGain * smoothstep(0.99990, 0.99996, mu);
          col = mix(col, cloudCol, cover);
          if (night > 0.01) {
            float r = hash(floor(dir * 520.0));
            float star = step(0.9975, r) * smoothstep(0.02, 0.3, dir.y) * (0.5 + 0.5 * hash(floor(dir * 520.0) + 7.0));
            float m = max(dot(dir, moonDir), 0.0);
            float clear = 1.0 - cover;
            col += vec3(0.85, 0.9, 1.0) * star * night * 1.4 * clear;
            col += vec3(0.95, 0.97, 1.0) * smoothstep(0.99962, 0.99984, m) * night * 1.6 * clear;
            col += vec3(0.5, 0.6, 0.9) * pow(m, 80.0) * night * 0.35;
          }
          col += (afHash(gl_FragCoord.xy) - 0.5) * 0.004;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), mat);
    dome.renderOrder = 1; // after the opaque scenery (see the vertex shader)
    dome.frustumCulled = false;
    return dome;
  }

  /** A jagged ring of far-off mountains, hazed at their feet towards the horizon colour. */
  private mountains(scale: number) {
    const segs = 160;
    const radius = RING_RADIUS;
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
    const mesh = new THREE.Mesh(geo, this.ringMaterial());
    mesh.renderOrder = -1;
    return mesh;
  }

  private ringMat: THREE.ShaderMaterial | null = null;
  private ringMaterial() {
    return (this.ringMat ??= new THREE.ShaderMaterial({
      fog: false,
      vertexColors: true,
      side: THREE.DoubleSide,
      uniforms: this.ringUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vCol;
        varying vec3 vP;
        void main() {
          vCol = color.rgb;
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_BASE_GLSL}
        uniform vec3 tint;
        uniform float hazeD;
        varying vec3 vCol;
        varying vec3 vP;
        void main() {
          float haze = 1.0 - exp(-hazeD * exp(-max(vP.y, 0.0) / 150.0));
          vec3 hz = skyBase(vec3(vP.x, 0.03 * length(vP.xz), vP.z) / length(vP));
          gl_FragColor = vec4(mix(vCol * tint, hz, haze), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })) as THREE.ShaderMaterial;
  }
}
