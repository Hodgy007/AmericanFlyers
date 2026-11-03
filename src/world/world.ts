import * as THREE from 'three';
import { currentStage, ensureRoad, roadPoint, gradeAt } from '../course';
import { Landmarks } from './landmarks';
import { OtherRiders, type OtherRider } from './others';
import { RiderModel, updateGlow } from './rider';
import type { BikeStyle } from '../garage/style';
import { Road, type MarkerConfig } from './road';
import { Sky, HORIZON_COLOR } from './sky';
import { Atmosphere } from './atmosphere';
import { installFog } from './fog';
import { Graphics, probeSignals, wantsMsaa } from './graphics';
import { TIER_SPECS, isChoice, type Tier } from './quality';
import { DEFAULT_LANE, LANE_MAX, LANE_MIN } from '../steering';
import type { TimeOfDay, Weather } from '../settings';
import { Terrain } from './terrain';
import { updateSway } from './sway';
import type { GroundCover } from './groundCover'; // grass, flowers and stones beside the road: High and Ultra only, a lazily loaded chunk

export interface WorldState {
  distance: number; // metres along the course
  speedMs: number;
  crankAngle: number; // radians, decreasing as the rider pedals forward
  rock?: number; // side-to-side rock of the bike, radians
}

export type CameraMode = 'chase' | 'side' | 'rider';
const CAMERA_MODES: CameraMode[] = ['chase', 'side', 'rider'];
const LANE_EASE_S = 0.27; // time constant: the bike settles on a new lane in about 0.8 s

/** A frame that spends longer than this building new scenery is a loading spike (Auto graphics ignores it). */
const BUILD_SPIKE_MS = 8;

/** Camera layer of the ground cover: the camera sees it, the ambient-occlusion pass's own camera does not (it would only redraw thousands of blades for their normals). */
const COVER_LAYER = 1;

export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
  private readonly sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  private readonly rider = new RiderModel();
  private readonly terrain: Terrain;
  private readonly road: Road;
  private readonly sky = new Sky(currentStage().scenery.mountainScale);
  private readonly landmarks = new Landmarks();
  private readonly others = new OtherRiders();
  private readonly hemi = new THREE.HemisphereLight('#cfe3ff', '#4d5a3a', 1.1);
  private atmosphere!: Atmosphere;
  private readonly gfx: Graphics;
  private lane = DEFAULT_LANE; // where the bike is across the road, eased
  private laneTarget = DEFAULT_LANE;
  private mode: CameraMode = 'chase';
  private readonly camTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothLook = new THREE.Vector3();
  private firstFrame = true;
  private terrainReady = false;
  private buildAvg = 0; // ms per frame usually spent building scenery (see update)
  private sceneryTier: Tier | null = null; // the tier the ground and roadside were last set up for (see applyScenery)
  private framesDrawn = 0;
  private cover: GroundCover | null = null;
  private coverWet = 0;
  private coverModule: Promise<typeof import('./groundCover')> | null = null;
  // The hub (src/hub): a slow orbit round the rider instead of the ride cameras.
  private orbiting = false;
  private orbitAngle = 2.3;

  constructor(canvas: HTMLCanvasElement, markers: MarkerConfig) {
    const signals = probeSignals(); // what the device is, for the graphics tier
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: wantsMsaa(signals), powerPreference: 'high-performance' });
    installFog(); // the height fog and cloud shadows are shader chunks: in place before any material compiles
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.fog = new THREE.Fog(HORIZON_COLOR, 180, 1150); // only switches fog on and carries its colour: see fog.ts
    this.scene.add(this.hemi);

    // Sun with a tight shadow box that follows the rider.
    this.sun.castShadow = true;
    const s = this.sun.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 1; s.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.road = new Road(this.renderer, markers);
    this.terrain = new Terrain(this.renderer);
    this.scene.add(this.sky.group, this.terrain.group, this.road.group, this.landmarks.group, this.rider.group, this.others.group);
    this.atmosphere = new Atmosphere({
      renderer: this.renderer, scene: this.scene, sun: this.sun, hemi: this.hemi, sky: this.sky,
      setWet: (w) => { this.road.setWet(w); this.terrain.setWet(w); this.cover?.setWet(w); this.coverWet = w; },
    });
    this.atmosphere.restage(currentStage());
    // Graphics tier (Low to Ultra, Auto by default): shadows, post-processing, sky detail, render scale. See graphics.ts.
    this.gfx = new Graphics({ renderer: this.renderer, scene: this.scene, camera: this.camera, sun: this.sun, sky: this.sky }, signals);
    this.gfx.attach(this.atmosphere);
    this.camera.layers.enable(COVER_LAYER);
    this.applyScenery();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Terrain textures, the road's wet look, painted words, guardrails and crowds follow the graphics
   * tier (TIER_SPECS[tier].scenery). Checked each frame, so Auto stepping a tier up or down is picked
   * up without touching graphics.ts. The terrain textures wait until a frame has been drawn.
   */
  private applyScenery() {
    const tier = this.gfx.currentTier;
    if (tier === this.sceneryTier) return;
    this.sceneryTier = tier;
    const spec = TIER_SPECS[tier];
    this.road.setTier(spec.scenery, spec.ibl);
    if (this.framesDrawn > 0) { this.terrain.setScenery(spec.scenery); this.syncCover(); }
  }

  /**
   * Ground cover follows the tier's share: none on Low and Medium (the chunk is not even fetched),
   * some on High, all on Ultra. When Auto steps down to a tier without it, it is disposed; stepping
   * back up makes it again. The chunk may arrive after the tier has changed again, so the share is read afresh.
   */
  private syncCover() {
    const share = () => TIER_SPECS[this.gfx.currentTier].scenery.groundCover;
    if (share() === 0) {
      this.cover?.dispose();
      this.cover = null;
      return;
    }
    if (this.cover) { this.cover.setShare(share()); return; }
    this.coverModule ??= import('./groundCover');
    void this.coverModule.then((m) => {
      if (this.cover || share() === 0) return;
      this.cover = new m.GroundCover(COVER_LAYER);
      this.cover.setShare(share());
      this.cover.setWet(this.coverWet);
      this.scene.add(this.cover.group);
    }).catch(() => { /* chunk failed to load (offline): no cover */ });
  }

  /** The rider's first name, painted on the road on the big climbs ("ALLEZ SAM"). */
  setRiderName(name: string | null | undefined) {
    this.road.setRiderName(name);
  }

  get cameraMode() { return this.mode; }

  /** Where the bike is across the road, metres right of the centre line (eased). */
  get currentLane() { return this.lane; }

  /** Where the bike is steering to; it eases there over about 0.8 s. */
  setLane(target: number) {
    this.laneTarget = Math.min(LANE_MAX, Math.max(LANE_MIN, target));
  }

  /** A drawn rider's lane across the road, if they're on screen. */
  lateralOf(id: string) {
    return this.others.lateralOf(id);
  }

  /** Time of day and weather from Settings. */
  setAtmosphere(time: TimeOfDay, weather: Weather) {
    this.atmosphere.setChoice(time, weather);
  }

  /** The weather being shown right now (clear, cloudy or rain), for the wind. */
  get weather() { return this.atmosphere.currentWeather; }

  /** 0..1: how hard it's raining (for the rain sound). */
  get rainLevel() { return this.atmosphere.rainLevel; }

  /** 0..1: how dark it is (the Tron bike glows more at night). */
  get nightAmount() { return this.atmosphere.nightAmount; }

  /** Graphics quality (Settings): Auto or a fixed tier, remembered on this device. */
  get graphicsChoice() { return this.gfx.currentChoice; }
  setGraphics(c: string) { if (isChoice(c)) this.gfx.setChoice(c); }
  /** A line for Settings saying what Auto picked. */
  graphicsNote() { return this.gfx.describe(); }
  /** The Auto entry's label in Settings: "Auto (now: High)". */
  graphicsAutoLabel() { return this.gfx.autoLabel(); }
  /** Where "Graphics lowered to High for a smoother ride" goes when Auto changes the tier. */
  onGraphicsNote(fn: (msg: string) => void) { this.gfx.onNote(fn); }

  /** The hub's backdrop: the camera circles your rider slowly (and the rider is shown, whatever the ride camera). */
  setOrbit(on: boolean) {
    if (this.orbiting === on) return;
    this.orbiting = on;
    this.gfx.setOrbiting(on);
    this.rider.setPersonVisible(on ? true : this.mode !== 'rider');
    this.firstFrame = true;
  }

  cycleCamera(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.rider.setPersonVisible(this.mode !== 'rider');
    this.firstFrame = true;
    return this.mode;
  }

  /** Call after the rider teleports (e.g. reset) so the view is rebuilt at once. */
  jumped() {
    this.terrainReady = false;
    this.firstFrame = true;
  }

  /** Changes what your rider wears (kit and bike colours) at runtime; see src/kit.ts. */
  setPlayerLook(look: { frame?: string; jersey?: string; kit?: [string, string] | null; style?: BikeStyle }) {
    this.rider.setLook(look);
  }

  /** A short-lived emoji floating above another rider (ride-ons). False if they aren't drawn. */
  showEmote(riderId: string, emoji: string) {
    return this.others.showEmote(riderId, emoji);
  }

  /** Other riders on this stage (live riders and ghosts), positions predicted for now. */
  setOthers(list: OtherRider[]) {
    this.others.set(list);
  }

  setMarkers(markers: MarkerConfig) {
    this.road.setMarkers(markers);
  }

  /** Rebuilds the world for the current stage (call after course.setStage). */
  restage(markers: MarkerConfig) {
    this.terrain.clear();
    this.cover?.clear();
    this.landmarks.clear();
    this.road.setMarkers(markers);
    this.sky.setMountainScale(currentStage().scenery.mountainScale);
    this.atmosphere.restage(currentStage());
    this.gfx.pause(2000); // the new stage's terrain and shaders are building: not a verdict on the device
    this.jumped();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gfx.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(state: WorldState, dt: number) {
    // Building new road, landmarks, roadside extras and terrain tiles happens in the frame loop and
    // costs a frame now and then: time it, and if a frame spent a lot on it, don't let Auto graphics
    // read the spike as the device struggling (see graphics.ts / adapt.ts).
    let built = performance.now();
    ensureRoad(state.distance + 3000);
    this.road.update(state.distance);
    const placed = this.landmarks.group.children.length;
    this.landmarks.update(state.distance);
    if (this.landmarks.group.children.length > placed) this.gfx.pause(1000); // a model just arrived: its first draw compiles shaders and uploads textures
    built = performance.now() - built;

    // Steer: ease across the road to where the rider wants to be.
    this.lane += (this.laneTarget - this.lane) * (1 - Math.exp(-dt / LANE_EASE_S));

    // Place the bike: yaw follows the road, pitch follows the grade.
    const p = roadPoint(state.distance);
    const right = new THREE.Vector3(-Math.sin(p.heading), 0, Math.cos(p.heading));
    const forward = new THREE.Vector3(Math.cos(p.heading), 0, Math.sin(p.heading));
    const riderPos = new THREE.Vector3(p.x, p.y + 0.02, p.z).addScaledVector(right, this.lane);
    this.rider.group.position.copy(riderPos);
    this.rider.group.rotation.y = -p.heading;
    this.rider.body.rotation.z = Math.atan(gradeAt(state.distance));
    this.rider.body.rotation.x = state.rock ?? 0;
    this.rider.update(state.distance, state.crankAngle);
    this.rider.group.updateMatrixWorld(true);
    this.rider.poseRider();

    // Build everything in view on the first frame, then a couple of tiles per frame.
    const tilesFrom = performance.now();
    this.terrain.update(riderPos.x, riderPos.z, this.terrainReady ? 2 : Infinity);
    this.cover?.update(state.distance, riderPos.x, riderPos.z);
    built += performance.now() - tilesFrom;
    // Only a frame that built much more than usual is a spike: a slow device's steady cost must still count.
    if (built > BUILD_SPIKE_MS && built > 3 * this.buildAvg) this.gfx.pause(600); // a loading spike, not a verdict on the device
    this.buildAvg += (Math.min(built, 50) - this.buildAvg) * 0.05;
    this.terrainReady = true;

    // Camera.
    const ahead = roadPoint(state.distance + 12);
    const up = new THREE.Vector3(0, 1, 0);
    if (this.orbiting) {
      // Hub: round the rider at head height, a little above.
      this.orbitAngle += dt * 0.12;
      this.camTarget.copy(riderPos).addScaledVector(forward, Math.cos(this.orbitAngle) * 4.6).addScaledVector(right, Math.sin(this.orbitAngle) * 4.6).addScaledVector(up, 1.5);
      this.lookTarget.copy(riderPos).addScaledVector(up, 0.85);
    } else switch (this.mode) {
      case 'chase':
        this.camTarget.copy(riderPos).addScaledVector(forward, -5.2).addScaledVector(up, 2.1).addScaledVector(right, 0.5);
        this.lookTarget.set(ahead.x, ahead.y + 0.9, ahead.z).addScaledVector(right, this.lane * 0.6);
        this.lookTarget.lerp(riderPos.clone().addScaledVector(up, 1), 0.55);
        break;
      case 'side':
        this.camTarget.copy(riderPos).addScaledVector(right, 4.2).addScaledVector(up, 1.1).addScaledVector(forward, 0.6);
        this.lookTarget.copy(riderPos).addScaledVector(up, 0.75).addScaledVector(forward, 0.2);
        break;
      case 'rider': {
        const pitch = Math.atan(gradeAt(state.distance));
        this.camTarget.copy(riderPos).addScaledVector(forward, 0.45).addScaledVector(up, 1.48 + Math.sin(pitch) * 0.45);
        this.lookTarget.set(ahead.x, ahead.y + 1.1, ahead.z).addScaledVector(right, this.lane);
        break;
      }
    }
    if (this.orbiting) {
      this.camera.position.copy(this.camTarget);
      this.smoothLook.copy(this.lookTarget);
    } else if (this.mode !== 'rider') {
      const k = this.firstFrame ? 1 : 1 - Math.exp(-dt * 5);
      this.camera.position.lerp(this.camTarget, k);
      this.smoothLook.lerp(this.lookTarget, k);
    } else {
      this.camera.position.copy(this.camTarget);
      this.smoothLook.lerp(this.lookTarget, this.firstFrame ? 1 : 1 - Math.exp(-dt * 8));
    }
    if (this.firstFrame) this.smoothLook.copy(this.lookTarget);
    this.firstFrame = false;
    this.camera.lookAt(this.smoothLook);
    this.others.update(state.distance, dt, this.camera, this.lane);

    this.atmosphere.update(dt, state.speedMs > 0.3, riderPos, forward, this.camera);
    // Keep the shadow box centred on the rider (snapped to the shadow map's texels).
    this.gfx.fitShadow(riderPos, this.atmosphere.lightDir);

    updateGlow(performance.now() / 1000, this.atmosphere.nightAmount); // the Tron bike's pulse
    this.sky.update(this.camera, dt);
    updateSway(dt); // trees and grass bend with the wind
    this.road.animate(performance.now() / 1000, riderPos.x, riderPos.y, riderPos.z);
    this.gfx.render(dt);
    if (++this.framesDrawn === 1) { this.terrain.setScenery(TIER_SPECS[this.gfx.currentTier].scenery); this.syncCover(); } // textures and ground cover: after the first frame
    this.applyScenery();
  }
}
