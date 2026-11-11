import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { GradeParams } from './grade';
import type { TierSpec } from './quality';
import type { Sky } from './sky';

// The post-processing chunk: only Medium and up ever download it (graphics.ts
// loads it with import()). Scene → [ambient occlusion] → bloom → colour grade →
// tone mapping and sRGB → anti-aliasing. Everything before the OutputPass is
// linear HDR, so bloom sees the sun and neon as truly brighter than white.

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    sat: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0.2 },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    lift: { value: new THREE.Vector3() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float sat;
    uniform float contrast;
    uniform float vignette;
    uniform vec3 gain;
    uniform vec3 lift;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat);
      col = pow(max(col, vec3(0.0)) / 0.18, vec3(contrast)) * 0.18;
      col = col * gain + lift * (1.0 - smoothstep(0.0, 0.4, l));
      vec2 p = (vUv - 0.5) * vec2(1.0, 0.82);
      col *= 1.0 - vignette * smoothstep(0.28, 0.78, length(p) * 1.35);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export interface Post {
  render(dt: number): void;
  /** CSS size and the pixel ratio the renderer is using now. */
  setSize(w: number, h: number, pixelRatio: number): void;
  configure(spec: TierSpec): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, grade: GradeParams, spec: TierSpec): Post {
  // The chain renders to half-float targets; without that support (some old phones) the caller keeps drawing directly.
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) throw new Error('no float render targets');
  const composer = new EffectComposer(renderer);
  let bloom: UnrealBloomPass | null = null;
  let gtao: GTAOPass | null = null;
  let bloomScale = 1;
  let aoScale = 0.5;
  let w = renderer.getSize(new THREE.Vector2()).x;
  let h = renderer.getSize(new THREE.Vector2()).y;
  let pr = renderer.getPixelRatio();
  const gradePass = new ShaderPass(GRADE_SHADER);
  const owned: Pass[] = [];
  // Ambient occlusion only needs the first few hundred metres, and the depth buffer is too coarse beyond that
  // (far hills and the mountain ring would go dark): it sees the world through a copy of the camera with a short far plane.
  const aoCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, 0.3, 280);

  // The bloom chain and the AO buffer run smaller than the frame; the composer sizes every pass to the frame.
  const layout = () => {
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    bloom?.setSize(w * pr * bloomScale, h * pr * bloomScale);
    gtao?.setSize(w * pr * aoScale, h * pr * aoScale);
  };

  const configure = (s: TierSpec) => {
    for (const p of owned) { composer.removePass(p); if (p !== gradePass) p.dispose?.(); }
    owned.length = 0;
    bloom = null; gtao = null;
    const add = (p: Pass) => { composer.addPass(p); owned.push(p); return p; };
    add(new RenderPass(scene, camera));
    if (s.ao > 0) {
      gtao = add(new GTAOPass(scene, aoCamera, w, h)) as GTAOPass;
      gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: s.ao > 0.6 ? 16 : 8, distanceFallOff: 1.2 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: s.ao > 0.6 ? 16 : 8 });
      gtao.blendIntensity = 0.85;
      // The scene is drawn again for its normals: don't redo the shadow map for that.
      const render = gtao.render.bind(gtao) as (...a: unknown[]) => void;
      (gtao as unknown as { render: (...a: unknown[]) => void }).render = (...a) => {
        const sm = renderer.shadowMap;
        const auto = sm.autoUpdate;
        sm.autoUpdate = false;
        try { render(...a); } finally { sm.autoUpdate = auto; }
      };
    }
    aoScale = s.ao;
    if (s.bloom > 0) {
      bloomScale = s.bloom;
      bloom = add(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 1.1)) as UnrealBloomPass;
    }
    add(gradePass);
    add(new OutputPass());
    if (s.aa === 'fxaa') add(new FXAAPass());
    else if (s.aa === 'smaa') add(new SMAAPass());
    layout();
  };

  configure(spec);

  return {
    render(dt) {
      if (bloom) {
        bloom.strength = grade.bloomStrength;
        bloom.threshold = grade.bloomThreshold;
        bloom.radius = grade.bloomRadius;
      }
      const u = gradePass.uniforms;
      u.sat.value = grade.saturation;
      u.contrast.value = grade.contrast;
      u.vignette.value = grade.vignette;
      u.gain.value.set(grade.gain[0], grade.gain[1], grade.gain[2]);
      u.lift.value.set(grade.lift[0], grade.lift[1], grade.lift[2]);
      if (gtao) {
        aoCamera.position.copy(camera.position);
        aoCamera.quaternion.copy(camera.quaternion);
        if (aoCamera.fov !== camera.fov || aoCamera.aspect !== camera.aspect) { aoCamera.fov = camera.fov; aoCamera.aspect = camera.aspect; aoCamera.updateProjectionMatrix(); }
        aoCamera.updateMatrixWorld();
      }
      composer.render(dt);
    },
    setSize(nw, nh, npr) {
      if (nw === w && nh === h && npr === pr) return;
      w = nw; h = nh; pr = npr;
      layout();
    },
    configure,
    dispose() {
      for (const p of owned) p.dispose?.();
      composer.dispose();
    },
  };
}

/**
 * Reflections and ambient light from the sky: the dome rendered to a cube map and
 * prefiltered (PMREM). Built again only when the sky has changed enough.
 */
export class SkyEnvironment {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private target: THREE.WebGLRenderTarget | null = null;
  private key = NaN;
  private at = -Infinity;

  constructor(renderer: THREE.WebGLRenderer, dome: THREE.Mesh) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const m = new THREE.Mesh(dome.geometry, dome.material);
    m.frustumCulled = false;
    this.scene.add(m);
  }

  /** Re-lights the sky reflections if `key` (the sky's state) has changed and it has been a few seconds; true if it did. `size` is the cube face in px. */
  maintain(now: number, key: number, size: number, target: THREE.Scene, sky: Sky): boolean {
    if (key === this.key || now - this.at < 4000) return false;
    sky.setDiscGain(3); // the sun's disc would speckle the filtered map
    const next = this.pmrem.fromScene(this.scene, 0, 0.1, 6000, { size });
    sky.setDiscGain(30);
    this.target?.dispose();
    this.target = next;
    target.environment = next.texture;
    target.environmentIntensity = 0.75;
    this.key = key;
    this.at = now;
    return true;
  }

  dispose() {
    this.target?.dispose();
    this.pmrem.dispose();
  }
}
