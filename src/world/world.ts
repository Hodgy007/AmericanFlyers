import * as THREE from 'three';
import { currentStage, ensureRoad, roadPoint, gradeAt } from '../course';
import { Landmarks } from './landmarks';
import { OtherRiders, type OtherRider } from './others';
import { RiderModel } from './rider';
import { Road, type MarkerConfig } from './road';
import { Sky, HORIZON_COLOR } from './sky';
import { Atmosphere } from './atmosphere';
import { DEFAULT_LANE, LANE_MAX, LANE_MIN } from '../steering';
import type { TimeOfDay, Weather } from '../settings';
import { Terrain } from './terrain';

export interface WorldState {
  distance: number; // metres along the course
  speedMs: number;
  crankAngle: number; // radians, decreasing as the rider pedals forward
  rock?: number; // side-to-side rock of the bike, radians
}

export type CameraMode = 'chase' | 'side' | 'rider';
const CAMERA_MODES: CameraMode[] = ['chase', 'side', 'rider'];
const LANE_EASE_S = 0.27; // time constant: the bike settles on a new lane in about 0.8 s

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
  private lane = DEFAULT_LANE; // where the bike is across the road, eased
  private laneTarget = DEFAULT_LANE;
  private mode: CameraMode = 'chase';
  private readonly camTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothLook = new THREE.Vector3();
  private firstFrame = true;
  private terrainReady = false;

  constructor(canvas: HTMLCanvasElement, markers: MarkerConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.fog = new THREE.Fog(HORIZON_COLOR, 180, 1150);
    this.scene.add(this.hemi);

    // Sun with a tight shadow box that follows the rider.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
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
      setWet: (w) => { this.road.setWet(w); this.terrain.setWet(w); },
    });
    this.atmosphere.restage(currentStage());

    this.resize();
    window.addEventListener('resize', () => this.resize());
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

  /** 0..1: how hard it's raining (for the rain sound). */
  get rainLevel() { return this.atmosphere.rainLevel; }

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
  setPlayerLook(look: { frame?: string; jersey?: string; kit?: [string, string] | null }) {
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
    this.landmarks.clear();
    this.road.setMarkers(markers);
    this.sky.setMountainScale(currentStage().scenery.mountainScale);
    this.atmosphere.restage(currentStage());
    this.jumped();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(state: WorldState, dt: number) {
    ensureRoad(state.distance + 3000);
    this.road.update(state.distance);
    this.landmarks.update(state.distance);

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
    this.terrain.update(riderPos.x, riderPos.z, this.terrainReady ? 2 : Infinity);
    this.terrainReady = true;

    // Camera.
    const ahead = roadPoint(state.distance + 12);
    const up = new THREE.Vector3(0, 1, 0);
    switch (this.mode) {
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
    if (this.mode !== 'rider') {
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

    // Keep the shadow box centred on the rider.
    this.sun.target.position.copy(riderPos);
    this.atmosphere.update(dt, state.speedMs > 0.3, riderPos, forward, this.camera);
    this.sun.position.copy(riderPos).addScaledVector(this.atmosphere.lightDir, 200);

    this.sky.update(this.camera, dt);
    this.renderer.render(this.scene, this.camera);
  }
}
