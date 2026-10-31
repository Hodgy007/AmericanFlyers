import * as THREE from 'three';
import type { Stage } from '../stages';
import type { TimeOfDay, Weather } from '../settings';
import { Rain } from './rain';
import { HORIZON_COLOR, SUN_COLOR, SUN_DIRECTION, ZENITH_COLOR, type Sky } from './sky';

// Time of day and weather. One object owns everything that changes with the
// light: sky colours, the sun (or moon), the ambient light, fog, exposure,
// clouds, the rider's front light, the wet road and the rain.
//
// The state is a "look". The look we want is worked out each frame from the
// clock (a keyframed day) and the weather, and the look on screen eases
// towards it, so any change (a new stage, a choice in the menu, the hour
// moving on, a shower arriving) blends over a few seconds. Nothing here
// allocates per frame: every Colour and Vector is made once and updated in place.

type Phase = Exclude<TimeOfDay, 'auto'>;
type Climate = Exclude<Weather, 'auto'>;

/** Hours of the day (0–24) used when a time is fixed, or the stage's starting time on Auto. */
const PHASE_HOUR: Record<Phase, number> = { dawn: 6.3, day: 10, dusk: 19.3, night: 22.5 };
/** On Auto the clock runs this many hours per second of riding: one hour of light per two minutes. */
const HOURS_PER_SECOND = 1 / 120;
/** The look eases towards its target with this time constant (about 5 s to settle). */
const EASE_SECONDS = 1.6;
/** Auto weather rolls the dice every so many seconds of riding. */
const WEATHER_CHECK = [240, 480];

interface Look {
  zenith: THREE.Color; // top of the sky
  horizon: THREE.Color; // horizon haze, also the fog colour
  sunColor: THREE.Color; // the main light: sun by day, moon by night
  sunIntensity: number;
  sunDir: THREE.Vector3;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  exposure: number;
  fogNear: number;
  fogFar: number;
  night: number; // 0..1: stars and moon showing
  glow: number; // haze round the sun
  headlight: number; // 0..1: the rider's front light
  cloudCover: number; // 0..1+
  cloudColor: THREE.Color;
  cloudGlow: THREE.Color;
  mountain: THREE.Color; // multiplied over the far mountains
  wet: number; // 0..1: road and ground wetness
  rain: number; // 0..1: how hard it's raining
}

function makeLook(): Look {
  return {
    zenith: new THREE.Color(), horizon: new THREE.Color(), sunColor: new THREE.Color(), sunIntensity: 0,
    sunDir: new THREE.Vector3(0, 1, 0), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 0,
    exposure: 1, fogNear: 100, fogFar: 1000, night: 0, glow: 1, headlight: 0, cloudCover: 0,
    cloudColor: new THREE.Color(), cloudGlow: new THREE.Color(), mountain: new THREE.Color(), wet: 0, rain: 0,
  };
}

interface Keyframe {
  zenith: string; horizon: string; sun: string; sunIntensity: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  exposure: number; fogNear: number; fogFar: number;
  night: number; glow: number; headlight: number;
  cloud: string; cloudGlow: string; mountain: string;
}

const KEYS: Record<'night' | 'dawn' | 'day' | 'dusk', Keyframe> = {
  night: {
    zenith: '#050a1e', horizon: '#10203f', sun: '#9db4ff', sunIntensity: 0.55,
    hemiSky: '#2a3c78', hemiGround: '#0e1428', hemiIntensity: 0.75,
    exposure: 1.2, fogNear: 90, fogFar: 900, night: 1, glow: 0, headlight: 1,
    cloud: '#2a3558', cloudGlow: '#0c1226', mountain: '#0d1630',
  },
  dawn: {
    zenith: '#46659e', horizon: '#f4b992', sun: '#ffb577', sunIntensity: 2.1,
    hemiSky: '#b9c4e6', hemiGround: '#5a5650', hemiIntensity: 1.05,
    exposure: 1.05, fogNear: 150, fogFar: 1000, night: 0, glow: 1.7, headlight: 0,
    cloud: '#ffd9c4', cloudGlow: '#d89c88', mountain: '#f0c8c0',
  },
  day: {
    zenith: '#2f6db5', horizon: '#cfe0ee', sun: '#fff4e0', sunIntensity: 2.6,
    hemiSky: '#cfe3ff', hemiGround: '#4d5a3a', hemiIntensity: 1.1,
    exposure: 1.05, fogNear: 180, fogFar: 1150, night: 0, glow: 1, headlight: 0,
    cloud: '#ffffff', cloudGlow: '#c4d2e2', mountain: '#ffffff',
  },
  dusk: {
    zenith: '#34457f', horizon: '#ff9d63', sun: '#ff8f4f', sunIntensity: 1.9,
    hemiSky: '#9aa0d8', hemiGround: '#4a3f3b', hemiIntensity: 0.85,
    exposure: 1.08, fogNear: 140, fogFar: 1000, night: 0.15, glow: 2.1, headlight: 0.25,
    cloud: '#ffb48c', cloudGlow: '#a05468', mountain: '#caa0a8',
  },
};

/** The day, as keyframes by hour. Midnight and 24 h are both night, so the day wraps. */
const TIMELINE: { hour: number; key: Keyframe }[] = [
  { hour: 0, key: KEYS.night },
  { hour: 4.8, key: KEYS.night },
  { hour: 6.3, key: KEYS.dawn },
  { hour: 8.6, key: KEYS.day },
  { hour: 17, key: KEYS.day },
  { hour: 19.3, key: KEYS.dusk },
  { hour: 21, key: KEYS.night },
  { hour: 24, key: KEYS.night },
];

/** How the weather changes the light (see `weatherLook`). */
const CLIMATE: Record<Climate, { overcast: number; cover: number; fog: number; wet: number; rain: number }> = {
  clear: { overcast: 0.1, cover: 0.35, fog: 1, wet: 0, rain: 0 },
  cloudy: { overcast: 0.85, cover: 1.15, fog: 0.8, wet: 0, rain: 0 },
  rain: { overcast: 1, cover: 1.3, fog: 0.42, wet: 1, rain: 1 },
};

/** The moonlight comes from higher up and behind than the moon you see, so the rider is lit from above. */
const MOON_LIGHT = new THREE.Vector3(-0.35, 0.8, 0.4).normalize();
const SUN_MAX_ELEVATION = 55 * (Math.PI / 180);
const SUN_RISE = 5.8;
const SUN_SET = 20.0;

const _grey = new THREE.Color();

/** Colour of a keyframe, parsed once. */
const parsed = new Map<string, THREE.Color>();
function colour(hex: string) {
  let c = parsed.get(hex);
  if (!c) parsed.set(hex, (c = new THREE.Color(hex)));
  return c;
}

function sunDirectionAt(hour: number, out: THREE.Vector3) {
  const f = (hour - SUN_RISE) / (SUN_SET - SUN_RISE); // 0 at sunrise, 1 at sunset
  const elevation = SUN_MAX_ELEVATION * Math.sin(Math.PI * f); // dips below the horizon at night
  const azimuth = -0.96 + (hour - 10) * 0.17; // from the left of the road in the morning, round to ahead of you at dusk
  const c = Math.cos(elevation);
  return out.set(c * Math.cos(azimuth), Math.sin(elevation), c * Math.sin(azimuth));
}

function setFromKeys(out: Look, a: Keyframe, b: Keyframe, t: number) {
  out.zenith.copy(colour(a.zenith)).lerp(colour(b.zenith), t);
  out.horizon.copy(colour(a.horizon)).lerp(colour(b.horizon), t);
  out.sunColor.copy(colour(a.sun)).lerp(colour(b.sun), t);
  out.hemiSky.copy(colour(a.hemiSky)).lerp(colour(b.hemiSky), t);
  out.hemiGround.copy(colour(a.hemiGround)).lerp(colour(b.hemiGround), t);
  out.cloudColor.copy(colour(a.cloud)).lerp(colour(b.cloud), t);
  out.cloudGlow.copy(colour(a.cloudGlow)).lerp(colour(b.cloudGlow), t);
  out.mountain.copy(colour(a.mountain)).lerp(colour(b.mountain), t);
  const m = (x: number, y: number) => x + (y - x) * t;
  out.sunIntensity = m(a.sunIntensity, b.sunIntensity);
  out.hemiIntensity = m(a.hemiIntensity, b.hemiIntensity);
  out.exposure = m(a.exposure, b.exposure);
  out.fogNear = m(a.fogNear, b.fogNear);
  out.fogFar = m(a.fogFar, b.fogFar);
  out.night = m(a.night, b.night);
  out.glow = m(a.glow, b.glow);
  out.headlight = m(a.headlight, b.headlight);
}

/** The clear-weather look for an hour of the day. */
function lookAtHour(hour: number, out: Look) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < TIMELINE.length - 2 && h >= TIMELINE[i + 1].hour) i++;
  const a = TIMELINE[i];
  const b = TIMELINE[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.hour) / (b.hour - a.hour)));
  setFromKeys(out, a.key, b.key, t * t * (3 - 2 * t));
  sunDirectionAt(h, out.sunDir);
  out.cloudCover = 0;
  out.wet = 0;
  out.rain = 0;
}

/** Greys, dims and thickens a look for the weather, in place. */
function weatherLook(out: Look, c: Climate) {
  const w = CLIMATE[c];
  const o = w.overcast;
  // Sky: drain the colour (keeping its brightness) and pull the top of the sky towards the haze.
  for (const col of [out.zenith, out.horizon, out.cloudColor, out.mountain]) {
    const l = col.r * 0.3 + col.g * 0.55 + col.b * 0.15;
    _grey.setRGB(l * 0.96, l, l * 1.05);
    col.lerp(_grey, o * 0.75);
  }
  out.zenith.lerp(out.horizon, o * 0.55);
  // Cloud undersides grow darker as the cover thickens.
  out.cloudColor.multiplyScalar(1 - 0.38 * o * (c === 'rain' ? 1.15 : 1));
  out.cloudGlow.multiplyScalar(1 - 0.5 * o);
  out.sunIntensity *= 1 - 0.72 * o;
  out.glow *= 1 - 0.9 * o;
  out.hemiIntensity *= 1 + 0.2 * o + 0.9 * o * out.night; // a night under cloud is lit by the glow of the sky, not pitch black
  out.exposure *= 1 - 0.04 * o;
  out.fogFar *= w.fog;
  out.fogNear *= 0.45 + 0.55 * w.fog;
  // Stars are hidden by cloud; the moon too.
  out.night *= 1 - 0.85 * o;
  out.cloudCover = w.cover;
  out.wet = w.wet;
  out.rain = w.rain;
}

function copyLook(dst: Look, src: Look) {
  dst.zenith.copy(src.zenith); dst.horizon.copy(src.horizon); dst.sunColor.copy(src.sunColor);
  dst.sunIntensity = src.sunIntensity; dst.sunDir.copy(src.sunDir);
  dst.hemiSky.copy(src.hemiSky); dst.hemiGround.copy(src.hemiGround); dst.hemiIntensity = src.hemiIntensity;
  dst.exposure = src.exposure; dst.fogNear = src.fogNear; dst.fogFar = src.fogFar;
  dst.night = src.night; dst.glow = src.glow; dst.headlight = src.headlight; dst.cloudCover = src.cloudCover;
  dst.cloudColor.copy(src.cloudColor); dst.cloudGlow.copy(src.cloudGlow); dst.mountain.copy(src.mountain);
  dst.wet = src.wet; dst.rain = src.rain;
}

/** Moves `cur` a fraction `k` of the way to `tgt`. */
function easeLook(cur: Look, tgt: Look, k: number) {
  cur.zenith.lerp(tgt.zenith, k); cur.horizon.lerp(tgt.horizon, k); cur.sunColor.lerp(tgt.sunColor, k);
  cur.hemiSky.lerp(tgt.hemiSky, k); cur.hemiGround.lerp(tgt.hemiGround, k);
  cur.cloudColor.lerp(tgt.cloudColor, k); cur.cloudGlow.lerp(tgt.cloudGlow, k); cur.mountain.lerp(tgt.mountain, k);
  cur.sunDir.lerp(tgt.sunDir, k).normalize();
  const m = (x: number, y: number) => x + (y - x) * k;
  cur.sunIntensity = m(cur.sunIntensity, tgt.sunIntensity);
  cur.hemiIntensity = m(cur.hemiIntensity, tgt.hemiIntensity);
  cur.exposure = m(cur.exposure, tgt.exposure);
  cur.fogNear = m(cur.fogNear, tgt.fogNear);
  cur.fogFar = m(cur.fogFar, tgt.fogFar);
  cur.night = m(cur.night, tgt.night);
  cur.glow = m(cur.glow, tgt.glow);
  cur.headlight = m(cur.headlight, tgt.headlight);
  cur.cloudCover = m(cur.cloudCover, tgt.cloudCover);
  cur.wet = m(cur.wet, tgt.wet);
  cur.rain = m(cur.rain, tgt.rain);
}

export interface AtmosphereParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: Sky;
  /** Called when the wetness changes (0 dry … 1 soaked). */
  setWet(wet: number): void;
}

export class Atmosphere {
  private readonly cur = makeLook();
  private readonly tgt = makeLook();
  private readonly rain = new Rain();
  private readonly headlight = new THREE.SpotLight('#fff1d6', 0, 70, 0.8, 1, 1.1);
  private readonly rainTint = new THREE.Color();
  /** Direction the shadow-casting light shines from (the sun, or the moon at night). */
  readonly lightDir = new THREE.Vector3(0.45, 0.62, -0.64).normalize();

  private choice = { time: 'auto' as TimeOfDay, weather: 'auto' as Weather };
  private stageTime: Phase = 'day';
  private stageWeather: Climate = 'clear';
  private hour = PHASE_HOUR.day; // the Auto clock
  private autoWeather: Climate = 'clear';
  private weatherTimer = 300;
  private snap = true;
  private wetShown = -1;

  constructor(private readonly p: AtmosphereParts) {
    p.scene.add(this.rain.object, this.headlight, this.headlight.target);
    this.headlight.castShadow = false;
  }

  /** 0..1: how hard it's raining right now. */
  get rainLevel() {
    return this.cur.rain;
  }

  /** The hour on the clock (0–24), for the readout and tests. */
  get clockHour() {
    return this.hour;
  }

  get currentWeather(): Climate {
    return this.choice.weather === 'auto' ? this.autoWeather : this.choice.weather;
  }

  /** The rider's choices from Settings. Takes effect at once (the look eases over a few seconds). */
  setChoice(time: TimeOfDay, weather: Weather) {
    const t: TimeOfDay = (['auto', 'dawn', 'day', 'dusk', 'night'] as const).includes(time) ? time : 'auto';
    const w: Weather = (['auto', 'clear', 'cloudy', 'rain'] as const).includes(weather) ? weather : 'auto';
    if (t === 'auto' && this.choice.time !== 'auto') this.hour = PHASE_HOUR[this.stageTime];
    if (w === 'auto' && this.choice.weather !== 'auto') this.autoWeather = this.stageWeather;
    this.choice = { time: t, weather: w };
  }

  /** A new stage: restart the Auto clock and weather from the stage's own, and show them straight away. */
  restage(stage: Stage) {
    this.stageTime = stage.timeOfDay ?? 'day';
    this.stageWeather = stage.weather ?? 'clear';
    this.hour = PHASE_HOUR[this.stageTime];
    this.autoWeather = this.stageWeather;
    this.weatherTimer = this.nextCheck();
    this.snap = true;
  }

  private nextCheck() {
    return WEATHER_CHECK[0] + Math.random() * (WEATHER_CHECK[1] - WEATHER_CHECK[0]);
  }

  /** Auto weather drifts now and then: mostly fair, sometimes turning cloudy, now and again a shower. */
  private rollWeather() {
    const r = Math.random();
    const was = this.autoWeather;
    if (was === 'clear') this.autoWeather = r < 0.7 ? 'cloudy' : 'clear';
    else if (was === 'cloudy') this.autoWeather = r < 0.35 ? 'clear' : r < 0.65 ? 'rain' : 'cloudy';
    else this.autoWeather = r < 0.75 ? 'cloudy' : 'rain';
  }

  /**
   * Call every frame. `riding` moves the Auto clock on; `riderPos` and `forward`
   * place the front light; the camera carries the rain.
   */
  update(dt: number, riding: boolean, riderPos: THREE.Vector3, forward: THREE.Vector3, camera: THREE.Camera) {
    if (riding) {
      if (this.choice.time === 'auto') this.hour = (this.hour + dt * HOURS_PER_SECOND) % 24;
      if (this.choice.weather === 'auto') {
        this.weatherTimer -= dt;
        if (this.weatherTimer <= 0) { this.rollWeather(); this.weatherTimer = this.nextCheck(); }
      }
    }

    // Target look: the hour's light, then the weather over it.
    const hour = this.choice.time === 'auto' ? this.hour : PHASE_HOUR[this.choice.time];
    lookAtHour(hour, this.tgt);
    weatherLook(this.tgt, this.currentWeather);

    if (this.snap) {
      copyLook(this.cur, this.tgt);
      this.snap = false;
    } else {
      easeLook(this.cur, this.tgt, 1 - Math.exp(-dt / EASE_SECONDS));
    }
    this.apply(dt, riderPos, forward, camera);
  }

  private apply(dt: number, riderPos: THREE.Vector3, forward: THREE.Vector3, camera: THREE.Camera) {
    const l = this.cur;
    const { renderer, scene, sun, hemi, sky } = this.p;

    // Sky and fog share the horizon colour so the distance melts into the sky.
    ZENITH_COLOR.copy(l.zenith);
    HORIZON_COLOR.copy(l.horizon);
    SUN_COLOR.copy(l.sunColor);
    SUN_DIRECTION.copy(l.sunDir);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(l.horizon);
      scene.fog.near = l.fogNear;
      scene.fog.far = l.fogFar;
    }
    sky.setSkyLook(l.glow, l.night);
    sky.setMountainTint(l.mountain);
    sky.setClouds(l.cloudColor, l.cloudGlow);
    sky.setCloudCover(l.cloudCover);

    // The main light: the sun, handing over to the moon as night comes in.
    const moonness = THREE.MathUtils.smoothstep(l.night, 0.35, 0.8);
    this.lightDir.copy(l.sunDir).lerp(MOON_LIGHT, moonness);
    if (this.lightDir.y < 0.14) this.lightDir.y = 0.14; // never rake along the ground
    this.lightDir.normalize();
    sun.color.copy(l.sunColor);
    sun.intensity = l.sunIntensity;
    hemi.color.copy(l.hemiSky);
    hemi.groundColor.copy(l.hemiGround);
    hemi.intensity = l.hemiIntensity;
    renderer.toneMappingExposure = l.exposure;

    // The rider's front light: a soft pool on the road ahead, only once it's dim.
    const hl = this.headlight;
    hl.intensity = l.headlight * 70;
    hl.position.copy(riderPos).addScaledVector(forward, 0.9);
    hl.position.y += 1.2;
    hl.target.position.copy(riderPos).addScaledVector(forward, 20);
    hl.target.position.y = riderPos.y - 0.3;

    // Wet road and ground.
    if (Math.abs(l.wet - this.wetShown) > 0.004) {
      this.wetShown = l.wet;
      this.p.setWet(l.wet);
    }

    // Rain, lit by whatever light there is.
    this.rainTint.copy(l.horizon).multiplyScalar(0.55 + 0.9 * Math.min(1, l.sunIntensity / 2));
    this.rain.update(dt, l.rain, camera, this.rainTint);
  }
}
