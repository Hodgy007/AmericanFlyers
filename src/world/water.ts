import * as THREE from 'three';
import type { Stage } from '../stages';
import type { PondBody, RiverBody, SeaBody } from './waterTypes';

// The stage's water: flat sheets at their level (waterTypes.ts) that the terrain sinks below. A standard
// material with a moving swell in its normal and a lighter share of the haze (patchWater); the sea is a big plane that follows
// the rider, ponds and rivers are fixed meshes. Built when the stage is set, torn down at the next.

const SEA_SIZE = 16000;
const SEA_SNAP = 200;

// Deep colours: the haze and the sky's reflection lighten them a lot at the distance water is seen from the road.
const COLOURS = { sea: '#0d4f6c', pond: '#27505f', river: '#3f666c' };
/** How big the ripples are (slope) and how much of the haze the water takes: a sea keeps its colour to the horizon, a pond is still. */
const LOOK = { sea: { ripple: 0.085, haze: 0.5 }, pond: { ripple: 0.02, haze: 0.85 }, river: { ripple: 0.045, haze: 0.85 } };

/** Seconds, shared by every water material: the swell moves with it (set in update()). */
const TIME = { value: 0 };

/**
 * Makes a standard material look like water: a moving swell in the normal (so the sun glints and the sky's
 * reflection breaks up), and less of the height haze than the land takes, so a sea far below the road still
 * reads as blue water with a horizon instead of fading into the mist. A few sines per pixel: cheap on every tier.
 */
function patchWater(m: THREE.MeshStandardMaterial, look: { ripple: number; haze: number }) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.afWaterTime = TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAfWaterPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvAfWaterPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float afWaterTime;\nvarying vec3 vAfWaterPos;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
      {
        // Three trains of waves at different headings and lengths; the slope fades with distance so the far sea doesn't shimmer.
        vec2 p = vAfWaterPos.xz;
        float t = afWaterTime;
        vec2 g = vec2( 0.0 );
        g += vec2( 0.80, 0.60 ) * cos( dot( p, vec2( 0.80, 0.60 ) ) * 0.21 + t * 0.90 );
        g += vec2( -0.45, 0.89 ) * cos( dot( p, vec2( -0.45, 0.89 ) ) * 0.47 + t * 1.35 ) * 0.6;
        g += vec2( 0.97, -0.26 ) * cos( dot( p, vec2( 0.97, -0.26 ) ) * 1.30 + t * 2.10 ) * 0.35;
        float fade = 1.0 / ( 1.0 + length( vViewPosition ) * 0.004 );
        vec3 wn = normalize( vec3( -g.x * ${look.ripple.toFixed(3)} * fade, 1.0, -g.y * ${look.ripple.toFixed(3)} * fade ) );
        normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
      }`)
      .replace('#include <fog_fragment>', `vec3 afWaterLit = gl_FragColor.rgb;\n#include <fog_fragment>\ngl_FragColor.rgb = mix( afWaterLit, gl_FragColor.rgb, ${look.haze.toFixed(2)} );`);
  };
  m.customProgramCacheKey = () => `afWater:${look.ripple}:${look.haze}`;
}

export class Water {
  readonly group = new THREE.Group();
  private sea: THREE.Mesh | null = null;
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private geos: THREE.BufferGeometry[] = [];

  private material(kind: 'sea' | 'pond' | 'river') {
    let m = this.mats.get(kind);
    if (!m) {
      // Smooth enough for a sun glint off the swell; the sky's reflection is kept low so it tints the water rather than whitening it.
      m = new THREE.MeshStandardMaterial({ color: COLOURS[kind], roughness: kind === 'sea' ? 0.22 : 0.16, metalness: 0, envMapIntensity: 0.45 });
      patchWater(m, LOOK[kind]);
      this.mats.set(kind, m);
    }
    return m;
  }

  /** Replaces the water with the stage's own (or none). */
  restage(stage: Stage) {
    for (const c of [...this.group.children]) this.group.remove(c);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    this.sea = null;
    for (const body of stage.scenery.water ?? []) {
      if (body.kind === 'sea') this.addSea(body);
      else if (body.kind === 'pond') this.addPond(body);
      else this.addRiver(body);
    }
  }

  private addSea(b: SeaBody) {
    const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE).rotateX(-Math.PI / 2);
    this.geos.push(geo);
    this.sea = new THREE.Mesh(geo, this.material('sea'));
    this.sea.position.y = b.level;
    this.sea.userData.level = b.level;
    this.group.add(this.sea);
  }

  private addPond(b: PondBody) {
    const geo = new THREE.CircleGeometry(1, 56).rotateX(-Math.PI / 2);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, this.material('pond'));
    mesh.scale.set(b.rx, 1, b.rz);
    mesh.rotation.y = b.rot;
    mesh.position.set(b.x, b.level, b.z);
    this.group.add(mesh);
  }

  private addRiver(b: RiverBody) {
    // A strip along the polyline: two vertices per point, offset either side along the local normal.
    const n = b.pts.length;
    const pos = new Float32Array(n * 6);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = b.pts[i];
      const [ax, az] = b.pts[Math.max(0, i - 1)];
      const [bx, bz] = b.pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      pos.set([px + (nx * b.width) / 2, 0, pz + (nz * b.width) / 2, px - (nx * b.width) / 2, 0, pz - (nz * b.width) / 2], i * 6);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // The strip's winding may face down depending on the polyline's direction: draw both sides, the normals point up.
    const up = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < up.count; i++) up.setXYZ(i, 0, 1, 0);
    this.geos.push(geo);
    const mat = this.material('river').clone();
    patchWater(mat, LOOK.river); // (clone() doesn't copy onBeforeCompile)
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = b.level;
    this.group.add(mesh);
  }

  /** Keeps the sea under the rider, and the swell moving. */
  update(x: number, z: number) {
    TIME.value = (performance.now() / 1000) % 3600;
    if (!this.sea) return;
    this.sea.position.x = Math.round(x / SEA_SNAP) * SEA_SNAP;
    this.sea.position.z = Math.round(z / SEA_SNAP) * SEA_SNAP;
  }
}
