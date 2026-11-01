import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HelmetStyle, PatternStyle, SocksStyle, TyreStyle, WheelStyle } from '../garage/style';

// The parts of a bike and rider that change with what you own (src/garage):
// wheels and tyres, the Tron bike's glow, helmets, jersey patterns and socks.
// Local frame as in rider.ts: +x forward, +y up, +z to the rider's right.

export const WHEEL_R = 0.34;

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

// -------------------------------------------------------------- glow ----

const NEON = '#00cfff';
/** Light-ribbon material of the Tron bike: shared by every Tron bike, pulsed by updateGlow(). */
export const neonMat = new THREE.MeshStandardMaterial({ color: '#031219', emissive: NEON, emissiveIntensity: 1.2, roughness: 0.4, toneMapped: false });
/** Soft additive halos around the neon, standing in for bloom. */
export const haloMat = new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
export const tronBody = std('#0a0d14', { metalness: 0.85, roughness: 0.28 });

let groundGlowTex: THREE.CanvasTexture | null = null;
let groundMat: THREE.MeshBasicMaterial | null = null;
/** A pool of light on the road under a Tron bike. */
export function groundGlow(): THREE.Mesh {
  if (!groundGlowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(38,232,255,0.85)');
    grad.addColorStop(0.5, 'rgba(38,232,255,0.28)');
    grad.addColorStop(1, 'rgba(38,232,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    groundGlowTex = new THREE.CanvasTexture(c);
    groundGlowTex.colorSpace = THREE.SRGBColorSpace;
  }
  groundMat ??= new THREE.MeshBasicMaterial({ map: groundGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, opacity: 0.45 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3).rotateX(-Math.PI / 2), groundMat);
  m.position.set(0.1, 0.03, 0);
  m.name = 'tron-ground-glow';
  return m;
}

/** Pulses every Tron bike's glow; brighter at night. Call once a frame with the clock in seconds and the night amount 0..1. */
export function updateGlow(timeS: number, night: number) {
  const pulse = 0.88 + 0.12 * Math.sin(timeS * 2.4);
  neonMat.emissiveIntensity = (1.0 + 1.3 * night) * pulse;
  haloMat.opacity = (0.06 + 0.24 * night) * pulse;
  if (groundMat) groundMat.opacity = (0.4 + 0.5 * night) * pulse;
}

// ------------------------------------------------------------ wheels ----

interface WheelSpec {
  depth: number; // rim depth, m
  width: number; // rim width, m
  spokes: number;
  rim: THREE.Material;
}

const carbon = std('#101319', { metalness: 0.35, roughness: 0.28, side: THREE.DoubleSide });
const WHEELS: Record<Exclude<WheelStyle, 'disc'>, WheelSpec> = {
  alloy35: { depth: 0.035, width: 0.02, spokes: 18, rim: std('#2a2e37', { metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide }) },
  carbon50: { depth: 0.05, width: 0.023, spokes: 16, rim: carbon },
  deep80: { depth: 0.08, width: 0.027, spokes: 12, rim: carbon },
  climb: { depth: 0.026, width: 0.017, spokes: 20, rim: std('#4a5160', { metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide }) },
};

const alloyMat = std('#b8bec9', { metalness: 0.8, roughness: 0.3 });
const blackMat = std('#16181d', { roughness: 0.7 });
const tanMat = std('#bfa37a', { roughness: 0.6 });
const accentMat = std('#d62839', { metalness: 0.3, roughness: 0.4 });
const discMat = std('#262b36', { metalness: 0.4, roughness: 0.22, side: THREE.DoubleSide });

const geoCache = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
};

/** A band (rim) or lens (disc) revolved about the wheel's axle. */
const lathe = (rIn: number, rOut: number, width: number) =>
  new THREE.LatheGeometry(
    [new THREE.Vector2(rIn, -width / 2), new THREE.Vector2(rOut, -width * 0.4), new THREE.Vector2(rOut, width * 0.4), new THREE.Vector2(rIn, width / 2), new THREE.Vector2(rIn, -width / 2)],
    48,
  ).rotateX(Math.PI / 2);

/**
 * A wheel. `glow` is the Tron bike's light-ribbon rim and spokes. A disc is a
 * rear wheel only; on a front wheel it shows the deep 80 mm rim instead.
 */
export function buildWheel(style: WheelStyle, tyre: TyreStyle, glow: boolean, rear: boolean): THREE.Group {
  const wheel = new THREE.Group();
  const isDisc = style === 'disc' && rear;
  const spec = WHEELS[style === 'disc' ? 'deep80' : style];
  const tr = tyre === 'race' ? 0.0145 : 0.016;
  const rOut = WHEEL_R - 2 * tr + 0.002;
  const rIn = rOut - spec.depth;
  const parts: THREE.Mesh[] = [];

  parts.push(new THREE.Mesh(cached(`tyre${tr}`, () => new THREE.TorusGeometry(WHEEL_R - tr, tr, 8, 48)), blackMat));
  if (tyre === 'race') {
    // Tan sidewalls: the tread stays black down the middle.
    parts[0].geometry = cached('tread', () => new THREE.TorusGeometry(WHEEL_R - tr, tr * 1.02, 8, 48).scale(1, 1, 0.55));
    parts.push(new THREE.Mesh(cached(`tyre${tr}`, () => new THREE.TorusGeometry(WHEEL_R - tr, tr, 8, 48)), tanMat));
  }

  if (isDisc) {
    parts.push(new THREE.Mesh(cached('disc', () => new THREE.LatheGeometry(
      [new THREE.Vector2(0.02, -0.014), new THREE.Vector2(rOut * 0.5, -0.008), new THREE.Vector2(rOut, -0.005), new THREE.Vector2(rOut, 0.005), new THREE.Vector2(rOut * 0.5, 0.008), new THREE.Vector2(0.02, 0.014)],
      48,
    ).rotateX(Math.PI / 2)), glow ? tronBody : discMat));
    if (glow) parts.push(new THREE.Mesh(cached('discring', () => new THREE.TorusGeometry(rOut - 0.003, 0.004, 6, 64)), neonMat));
  } else {
    parts.push(new THREE.Mesh(cached(`rim${style}`, () => lathe(rIn, rOut, spec.width)), glow ? tronBody : spec.rim));
    if (glow) {
      // Light-ribbon rim: a neon line round each edge of a dark rim.
      for (const r of [rOut - 0.002, rIn + 0.002]) parts.push(new THREE.Mesh(cached(`ring${r.toFixed(3)}`, () => new THREE.TorusGeometry(r, 0.0035, 6, 64)), neonMat));
    }
    const len = rIn + 0.006 - 0.02;
    parts.push(new THREE.Mesh(cached(`spokes${style}`, () => {
      const spokes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < spec.spokes; i++) {
        spokes.push(new THREE.CylinderGeometry(0.0022, 0.0022, len, 4).translate(0, 0.02 + len / 2, (i % 2 ? 1 : -1) * 0.01).rotateZ((i / spec.spokes) * Math.PI * 2));
      }
      return mergeGeometries(spokes)!;
    }), glow ? neonMat : alloyMat));
    if (!glow && style === 'alloy35') {
      parts.push(new THREE.Mesh(cached('decal', () => new THREE.TorusGeometry(WHEEL_R - 0.055, 0.03, 6, 12, 0.6).scale(1, 1, 0.6)), accentMat));
    }
  }
  parts.push(new THREE.Mesh(cached('hub', () => new THREE.CylinderGeometry(0.025, 0.025, 0.1, 12).rotateX(Math.PI / 2)), glow ? neonMat : alloyMat));
  for (const m of parts) { m.castShadow = true; wheel.add(m); }

  if (glow) {
    const halo = new THREE.Mesh(cached(`halo${style}${isDisc}`, () => new THREE.TorusGeometry((rOut + rIn) / 2 + 0.004, spec.depth / 2 + 0.014, 8, 48).scale(1, 1, 0.55)), haloMat);
    halo.renderOrder = 2;
    wheel.add(halo);
  }
  return wheel;
}

// ---------------------------------------------------- kit and clothes ----

/** The shader's pattern numbers, in the order of PatternStyle. */
const PATTERN_INDEX: Record<PatternStyle, number> = { plain: 0, stripes: 1, hoops: 2, chevrons: 3, stars: 4, dots: 5, skinsuit: 6 };
const SOCK_COLOUR: Record<SocksStyle, string | null> = { white: null, black: '#16181d', red: '#d62839', neon: '#c6ff00' };

/** Original colours of the rigged rider's kit, for when a pattern is worn without a team kit. */
export const ORIGINAL_KIT: [string, string] = ['#14213d', '#d62839'];

const kitMats = new Map<string, THREE.Material>();

/**
 * Recolours the rigged rider's stars-and-stripes kit and puts a pattern and
 * socks on it. The texture is navy, red, white, skin and black; a
 * fragment-shader tweak swaps navy and red for the kit's two colours (keeping
 * the shading), draws the pattern on the red (jersey) areas from the vertex's
 * pre-skinning position (x across the body, y up), and recolours white near
 * the ankles into socks. A skinsuit takes the jersey colour over the navy and
 * white of the torso too. Everything else is left alone.
 */
export function applyKitStyle(root: THREE.Object3D, kit: [string, string] | null, pattern: PatternStyle, socks: SocksStyle) {
  const sock = SOCK_COLOUR[socks];
  const plain = !kit && pattern === 'plain' && !sock;
  const colours = kit ?? ORIGINAL_KIT;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Remember the model's own material so the kit can change (or be taken off) later.
    const src = (mesh.userData.kitSrc ??= mesh.material) as THREE.MeshStandardMaterial;
    if (plain) { mesh.material = src; return; }
    const key = `${src.uuid}|${colours.join('|')}|${pattern}|${sock ?? ''}`;
    let m = kitMats.get(key);
    if (!m) {
      const mat = src.clone();
      const a = new THREE.Color(colours[0]);
      const b = new THREE.Color(colours[1]);
      const sc = new THREE.Color(sock ?? '#ffffff');
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.kitA = { value: a };
        shader.uniforms.kitB = { value: b };
        shader.uniforms.kitPattern = { value: PATTERN_INDEX[pattern] };
        shader.uniforms.sockColour = { value: sc };
        shader.uniforms.sockOn = { value: sock ? 1 : 0 };
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'varying vec3 vKitPos;\nvoid main() {')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitPos = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', `uniform vec3 kitA;
uniform vec3 kitB;
uniform float kitPattern;
uniform vec3 sockColour;
uniform float sockOn;
varying vec3 vKitPos;
// 1 where the pattern draws the second colour on the jersey. p: x across the body, y up (metres).
float kitMask( vec3 p, float pat ) {
  float ax = abs( p.x );
  if ( pat < 0.5 ) return 0.0;
  if ( pat < 1.5 ) return step( 0.7, fract( p.x * 30.0 ) );
  if ( pat < 2.5 ) return step( 0.5, fract( ( ax > 0.2 ? ax * 1.3 : p.y ) * 10.0 ) );
  if ( pat < 3.5 ) return step( 0.5, fract( p.y * 7.0 - ax * 6.0 ) );
  vec2 g = p.xy * 13.0;
  g.x += mod( floor( g.y ), 2.0 ) * 0.5;
  vec2 f = fract( g ) - 0.5;
  if ( pat < 4.5 ) {
    float ang = atan( f.y, f.x );
    return 1.0 - step( 0.2 + 0.17 * cos( 5.0 * ( ang - 1.5708 ) ), length( f ) );
  }
  if ( pat < 5.5 ) return 1.0 - step( 0.3, length( f ) );
  return 0.0;
}
void main() {`)
          .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec3 kc = sampledDiffuseColor.rgb;
  float klum = dot( kc, vec3( 0.2126, 0.7152, 0.0722 ) );
  float isNavy = step( kc.r * 1.6 + 0.004, kc.b ) * step( kc.g * 1.25 + 0.002, kc.b );
  float isRed = step( kc.g * 3.0 + 0.02, kc.r ) * step( kc.b * 3.0 + 0.02, kc.r );
  float isWhite = step( 0.6, min( kc.r, min( kc.g, kc.b ) ) );
  float onBody = step( 0.62, vKitPos.y ) * step( vKitPos.y, 1.5 );
  float skin = step( 5.5, kitPattern );
  kc = mix( kc, kitA * clamp( klum / 0.03, 0.45, 1.3 ), isNavy );
  kc = mix( kc, kitB * clamp( klum / 0.16, 0.45, 1.3 ), isRed );
  // Pattern on the jersey; a skinsuit is one colour over the shorts and white bands too.
  kc = mix( kc, kitA * clamp( klum / 0.16, 0.5, 1.3 ), isRed * kitMask( vKitPos, kitPattern ) );
  kc = mix( kc, kitB * clamp( klum / 0.03, 0.45, 1.3 ), isNavy * skin );
  kc = mix( kc, kitB * clamp( klum * 0.9, 0.55, 1.0 ), isWhite * onBody * skin );
  // Socks: white near the ankles.
  kc = mix( kc, sockColour * clamp( klum, 0.6, 1.0 ), isWhite * sockOn * step( vKitPos.y, 0.24 ) );
  sampledDiffuseColor.rgb = kc;
  diffuseColor *= sampledDiffuseColor;
#endif`);
      };
      mat.customProgramCacheKey = () => 'team-kit-style';
      kitMats.set(key, mat);
      m = mat;
    }
    mesh.material = m;
  });
}

// ----------------------------------------------------------- helmets ----

const helmetMats: Record<HelmetStyle, THREE.Material | null> = {
  standard: null,
  black: std('#14161b', { roughness: 0.4, metalness: 0.1 }),
  aero: std('#f4f6fa', { roughness: 0.35 }),
  aerodark: std('#0e1014', { roughness: 0.3, metalness: 0.2 }),
};

/**
 * A helmet shell to fit over the rigged rider's own white helmet (null for the
 * standard one). Built in the Head bone's space: its units are centimetres
 * (the rig's armature is scaled 0.01), the head's centre is about 15 cm up
 * (its top at 26.7 cm) and the face looks along +z.
 */
export function buildHelmetShell(style: HelmetStyle): THREE.Object3D | null {
  const material = helmetMats[style];
  if (!material) return null;
  const g = new THREE.Group();
  g.name = 'helmet-shell';
  const aero = style === 'aero' || style === 'aerodark';
  const dome = new THREE.Mesh(
    cached(`dome${aero}`, () => new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.58).scale(aero ? 12.6 : 12.9, aero ? 13.6 : 13.6, aero ? 17 : 16.4)),
    material,
  );
  dome.position.set(0, 15.2, 1.2);
  dome.castShadow = true;
  g.add(dome);
  if (aero) {
    // The long tail, lying along the back with its tip a little low.
    const tail = new THREE.Mesh(cached('tail', () => new THREE.ConeGeometry(1, 1, 18).rotateX(-Math.PI / 2).scale(9.5, 6.5, 24)), material);
    tail.position.set(0, 14.5, -19);
    tail.rotation.x = -0.8;
    tail.castShadow = true;
    g.add(tail);
  }
  return g;
}
