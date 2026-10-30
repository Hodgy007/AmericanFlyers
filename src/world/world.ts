import * as THREE from 'three';
import { ensureRoad, roadPoint, gradeAt } from '../course';
import { Landmarks } from './landmarks';
import { RiderModel } from './rider';
import { Road, type MarkerConfig } from './road';
import { Sky, SUN_DIRECTION, HORIZON_COLOR } from './sky';
import { Terrain } from './terrain';

export interface WorldState {
  distance: number; // metres along the course
  speedMs: number;
  crankAngle: number; // radians, decreasing as the rider pedals forward
}

export type CameraMode = 'chase' | 'side' | 'rider';
const CAMERA_MODES: CameraMode[] = ['chase', 'side', 'rider'];
const RIDER_LANE_OFFSET = 1.9; // ride on the right-hand side of the road

export class World {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
  private readonly sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  private readonly rider = new RiderModel();
  private readonly terrain = new Terrain();
  private readonly road: Road;
  private readonly sky = new Sky();
  private readonly landmarks = new Landmarks();
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
    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#4d5a3a', 1.1));

    // Sun with a tight shadow box that follows the rider.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -30; s.right = 30; s.top = 30; s.bottom = -30; s.near = 1; s.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.road = new Road(this.renderer, markers);
    this.scene.add(this.sky.group, this.terrain.group, this.road.group, this.landmarks.group, this.rider.group);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get cameraMode() { return this.mode; }

  cycleCamera(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.rider.person.visible = this.mode !== 'rider';
    this.firstFrame = true;
    return this.mode;
  }

  /** Call after the rider teleports (e.g. reset) so the view is rebuilt at once. */
  jumped() {
    this.terrainReady = false;
    this.firstFrame = true;
  }

  setMarkers(markers: MarkerConfig) {
    this.road.setMarkers(markers);
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

    // Place the bike: yaw follows the road, pitch follows the grade.
    const p = roadPoint(state.distance);
    const right = new THREE.Vector3(-Math.sin(p.heading), 0, Math.cos(p.heading));
    const forward = new THREE.Vector3(Math.cos(p.heading), 0, Math.sin(p.heading));
    const riderPos = new THREE.Vector3(p.x, p.y + 0.02, p.z).addScaledVector(right, RIDER_LANE_OFFSET);
    this.rider.group.position.copy(riderPos);
    this.rider.group.rotation.y = -p.heading;
    this.rider.body.rotation.z = Math.atan(gradeAt(state.distance));
    this.rider.update(state.distance, state.crankAngle);

    // Build everything in view on the first frame, then a couple of tiles per frame.
    this.terrain.update(riderPos.x, riderPos.z, this.terrainReady ? 2 : Infinity);
    this.terrainReady = true;

    // Camera.
    const ahead = roadPoint(state.distance + 12);
    const up = new THREE.Vector3(0, 1, 0);
    switch (this.mode) {
      case 'chase':
        this.camTarget.copy(riderPos).addScaledVector(forward, -5.2).addScaledVector(up, 2.1).addScaledVector(right, 0.5);
        this.lookTarget.set(ahead.x, ahead.y + 0.9, ahead.z).addScaledVector(right, RIDER_LANE_OFFSET * 0.6);
        this.lookTarget.lerp(riderPos.clone().addScaledVector(up, 1), 0.55);
        break;
      case 'side':
        this.camTarget.copy(riderPos).addScaledVector(right, 4.2).addScaledVector(up, 1.1).addScaledVector(forward, 0.6);
        this.lookTarget.copy(riderPos).addScaledVector(up, 0.75).addScaledVector(forward, 0.2);
        break;
      case 'rider': {
        const pitch = Math.atan(gradeAt(state.distance));
        this.camTarget.copy(riderPos).addScaledVector(forward, 0.45).addScaledVector(up, 1.48 + Math.sin(pitch) * 0.45);
        this.lookTarget.set(ahead.x, ahead.y + 1.1, ahead.z).addScaledVector(right, RIDER_LANE_OFFSET);
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

    // Keep the shadow box centred on the rider.
    this.sun.target.position.copy(riderPos);
    this.sun.position.copy(riderPos).addScaledVector(SUN_DIRECTION, 200);

    this.sky.update(this.camera, dt);
    this.renderer.render(this.scene, this.camera);
  }
}
