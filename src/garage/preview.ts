// A small turntable of your rider on its own WebGL canvas, for the garage:
// the bike, wheels, helmet and clothes you're trying, lit and turning slowly.
// It exists only while the garage is open.

import * as THREE from 'three';
import { RiderModel } from '../world/rider';
import { updateGlow } from '../world/bikeParts';
import type { PlayerLook } from '../kit';

export class GaragePreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: RiderModel | null = null;
  private raf = 0;
  private running = false;
  private angle = 0.9; // radians: the view's bearing round the bike
  private paused = false;
  private t0 = performance.now();
  private last = performance.now();
  private night = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(new THREE.HemisphereLight('#dbe8ff', '#3b4636', 1.5));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#202a40', roughness: 0.9 }));
    floor.position.y = -0.002;
    this.scene.add(floor);
    this.camera.position.set(0, 1, 3);

    // Drag to turn the bike by hand.
    let drag: { x: number; angle: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, angle: this.angle }; this.paused = true; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (drag) this.angle = drag.angle - (e.clientX - drag.x) * 0.012; });
    const end = () => { drag = null; window.setTimeout(() => { if (!drag) this.paused = false; }, 1500); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** Shows this look (replaces the model if the bike's style changes a lot, otherwise restyles it). */
  setLook(look: PlayerLook) {
    if (!this.model) {
      this.model = new RiderModel({ frame: look.frame, jersey: look.jersey, kit: look.kit ?? undefined, style: look.style });
      this.scene.add(this.model.group);
      return;
    }
    this.model.setLook({ frame: look.frame, jersey: look.jersey, kit: look.kit, style: look.style });
  }

  /** The Tron bike glows more in the dark: let the preview show it that way. */
  setNight(night: number) {
    this.night = night;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 200;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.paused) this.angle += dt * 0.35;
    const m = this.model;
    if (m) {
      const t = (now - this.t0) / 1000;
      m.update(t * 2.2, -t * 7); // slow wheels, easy pedalling
      m.poseRider();
      m.group.rotation.y = 0;
    }
    const r = 3.5;
    this.camera.position.set(Math.cos(this.angle) * r, 1.1, Math.sin(this.angle) * r);
    this.camera.lookAt(0.1, 0.8, 0);
    updateGlow(now / 1000, this.night);
    this.renderer.render(this.scene, this.camera);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    this.model?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
