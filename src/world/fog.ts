import * as THREE from 'three';

// Aerial perspective for the whole world, installed once by overriding three's
// fog shader chunks (so terrain, road, trees, riders, landmarks and signs all
// get it without touching their materials).
//
//  - Exponential HEIGHT fog: dense in the valley, thinning with height, integrated
//    exactly along the view ray, so distant ridges fade to a hazy silhouette.
//  - In-scattering: the haze takes on the sun's colour towards the sun (and the warm
//    band along the sunset horizon), matching the sky dome's horizon.
//  - A hard far limit so the edge of the terrain tiles never shows.
//  - Cloud shadows: the sun's light on lit surfaces is dimmed where a cloud sits
//    between them and the sun. Same noise as the sky's clouds (CLOUD_GLSL), High and up.
//
// The per-frame numbers live in one shared Float32Array (vec4 afFog[4]) that is
// added to every built-in shader's uniforms; UniformsUtils.clone() passes typed
// arrays by reference, so one write per frame reaches every material.
//
//   [0] density, height falloff per metre, base height (m), far limit (m)
//   [1] sun direction xyz, forward-scatter amount
//   [2] sun colour rgb, horizon band amount
//   [3] cloud threshold, cloud drift x, drift z (cells), cloud-shadow strength

export const FOG_UNIFORM = new Float32Array(16);

export const CLOUD_CELL = 650; // metres across the biggest cloud shapes
export const CLOUD_HEIGHT = 1500; // metres above the camera

/** Cloud noise, shared by the sky dome and the cloud shadows on the ground. */
export const CLOUD_GLSL = /* glsl */ `
float afHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float afNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( afHash( i ), afHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( afHash( i + vec2( 0.0, 1.0 ) ), afHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float afCloud( vec2 q, int octaves ) {
  float a = 0.5, s = 0.0, n = 0.0;
  for ( int i = 0; i < 5; i ++ ) {
    if ( i >= octaves ) break;
    s += a * afNoise( q ); n += a;
    q = q * 2.02 + vec2( 5.2, 1.3 );
    a *= 0.5;
  }
  return ( s / n - 0.5 ) * 1.9 + 0.5;
}`;

const FOG_PARS_FRAGMENT = /* glsl */ `
uniform vec4 afFog[4];
varying vec3 vFogRel;
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
#endif
${CLOUD_GLSL}
float afCloudShade( vec3 wp ) {
  float s = afFog[3].w;
  if ( s <= 0.0 ) return 1.0;
  vec3 sd = afFog[1].xyz;
  float up = max( cameraPosition.y + ${CLOUD_HEIGHT.toFixed(1)} - wp.y, 300.0 );
  vec2 q = ( wp.xz + sd.xz * ( up / max( sd.y, 0.2 ) ) ) / ${CLOUD_CELL.toFixed(1)} + afFog[3].yz;
  return 1.0 - s * smoothstep( afFog[3].x, afFog[3].x + 0.14, afCloud( q, 3 ) );
}`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
{
  vec3 rel = vFogRel;
  float dist = length( rel );
  vec3 vdir = rel / max( dist, 0.001 );
  float k = afFog[0].y;
  float x = clamp( k * rel.y, -30.0, 30.0 );
  float mean = abs( x ) < 0.001 ? 1.0 - 0.5 * x : ( 1.0 - exp( -x ) ) / x;
  float tau = afFog[0].x * max( dist - 70.0, 0.0 ) * exp( clamp( -k * ( cameraPosition.y - afFog[0].z ), -8.0, 8.0 ) ) * mean;
  #ifdef TONE_MAPPING
    tau *= 1.3;
  #endif
  float fogFactor = max( 1.0 - exp( -tau ), smoothstep( afFog[0].w * 0.8, afFog[0].w, dist ) );
  float side = max( dot( normalize( vdir.xz + 1e-4 ), normalize( afFog[1].xz + 1e-4 ) ), 0.0 );
  float toSun = max( dot( vdir, afFog[1].xyz ), 0.0 );
  vec3 fc = fogColor;
  #ifdef TONE_MAPPING
    fc = sRGBTransferEOTF( vec4( fc, 1.0 ) ).rgb;
  #endif
  fc += afFog[2].rgb * ( afFog[2].w * pow( side, 4.0 ) * exp( -max( vdir.y, 0.0 ) * 5.0 ) + afFog[1].w * pow( toSun, 8.0 ) );
  #ifdef TONE_MAPPING
    fc = sRGBTransferOETF( vec4( toneMapping( fc ), 1.0 ) ).rgb;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fc, fogFactor );
}
#endif`;

let installed = false;

/** Call once, before the first render. */
export function installFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  C.fog_pars_vertex = 'varying vec3 vFogRel;\n#ifdef USE_FOG\n  varying float vFogDepth;\n#endif';
  C.fog_vertex = '#ifdef USE_FOG\n  vFogDepth = - mvPosition.z;\n#endif\nvFogRel = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;';
  C.fog_pars_fragment = FOG_PARS_FRAGMENT;
  C.fog_fragment = FOG_FRAGMENT;
  // Cloud shadows: dim the directional light (the sun) on lit, fogged materials (other scenes, like the garage's turntable, have no fog).
  const lights = C.lights_fragment_begin;
  const at = lights.indexOf('DirectionalLight directionalLight;');
  const call = lights.indexOf('RE_Direct( directLight, geometryPosition', at);
  if (at >= 0 && call >= 0) {
    C.lights_fragment_begin = lights.slice(0, call) + '\n#ifdef USE_FOG\n\t\tdirectLight.color *= afCloudShade( cameraPosition + transpose( mat3( viewMatrix ) ) * geometryPosition );\n#endif\n\t\t' + lights.slice(call);
  }
  // Every built-in shader that has fog gets the shared uniform.
  const lib = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, THREE.IUniform> }>;
  for (const key of Object.keys(lib)) {
    const u = lib[key].uniforms;
    if (u && 'fogColor' in u) u.afFog = { value: FOG_UNIFORM };
  }
}

/** Writes this frame's fog and cloud numbers. */
export function setFog(
  density: number, heightK: number, baseY: number, far: number,
  sunDir: THREE.Vector3, forward: number, sunColor: THREE.Color, band: number,
  cloudThreshold: number, driftX: number, driftZ: number, cloudShadow: number,
) {
  const f = FOG_UNIFORM;
  f[0] = density; f[1] = heightK; f[2] = baseY; f[3] = far;
  f[4] = sunDir.x; f[5] = sunDir.y; f[6] = sunDir.z; f[7] = forward;
  f[8] = sunColor.r; f[9] = sunColor.g; f[10] = sunColor.b; f[11] = band;
  f[12] = cloudThreshold; f[13] = driftX; f[14] = driftZ; f[15] = cloudShadow;
}
