// The mini-map: the shape of the route from the course centreline, with you,
// the other riders, the pro teams, your ghost and (in a race) the sprint and
// summit markers. North-up shows the whole route; heading-up follows you and
// shows the road ahead. Click or tap it to switch. Cheap on purpose: a few
// hundred line segments redrawn about five times a second.

import { currentStage, roadPoint, ensureRoad } from './course';
import type { Stage } from './stages';
import type { OtherRider } from './world/others';
import { TEAMS } from './peloton';

export interface MapLine { kind: 'sprint' | 'summit' | 'finish'; d: number }

export interface MapData {
  distance: number; // you, metres along the course
  riders: OtherRider[]; // live riders, pro teams and the ghost
  lines: MapLine[]; // race sprints and summits (empty outside a race)
}

type Mode = 'north' | 'heading';
const MODE_KEY = 'americanflyers.mapMode';
const REDRAW_MS = 200; // about 5 Hz
const MAX_ROUTE_POINTS = 1500;
const HEADING_RADIUS = 1400; // metres from you to the edge, heading-up
const ENDLESS_BEHIND = 600; // metres of road shown behind you on a stage with no finish
const ENDLESS_AHEAD = 4000;

interface Route { stage: Stage; step: number; x: Float32Array; z: Float32Array }

function loadMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'heading' ? 'heading' : 'north'; } catch { return 'north'; }
}

/** Colours for the pro teams' dots, by team name. */
const TEAM_COLOURS = new Map(TEAMS.map((t) => [t.name, t.color]));

export class MiniMap {
  private readonly ctx: CanvasRenderingContext2D;
  private mode: Mode = loadMode();
  private route: Route | null = null;
  private last = 0;
  private visible = false;

  constructor(private readonly button: HTMLElement, private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    button.addEventListener('click', () => {
      this.mode = this.mode === 'north' ? 'heading' : 'north';
      try { localStorage.setItem(MODE_KEY, this.mode); } catch { /* fine */ }
      this.last = 0; // redraw at once
      button.title = this.title();
    });
    button.title = this.title();
  }

  private title() {
    return this.mode === 'north' ? 'Mini-map, north up. Click to follow your heading.' : 'Mini-map, your heading up. Click for the whole route, north up.';
  }

  /** Shows or hides the map (Settings). */
  setVisible(on: boolean) {
    if (on === this.visible) return;
    this.visible = on;
    this.button.hidden = !on;
    this.last = 0;
  }

  /** The route of a stage with a finish, sampled once and kept. */
  private routeFor(stage: Stage): Route | null {
    if (this.route?.stage === stage) return this.route;
    const finish = stage.finish;
    if (finish === null) return null;
    ensureRoad(finish + 20);
    const step = Math.max(10, Math.ceil(finish / MAX_ROUTE_POINTS / 10) * 10);
    const n = Math.floor(finish / step) + 2;
    const x = new Float32Array(n);
    const z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = roadPoint(Math.min(i * step, finish));
      x[i] = p.x;
      z[i] = p.z;
    }
    this.route = { stage, step, x, z };
    return this.route;
  }

  /** Call every frame (or every hud tick): it redraws at most five times a second. */
  update(now: number, data: MapData) {
    if (!this.visible || now - this.last < REDRAW_MS) return;
    this.last = now;
    this.draw(data);
  }

  private draw(data: MapData) {
    const canvas = this.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 10 || h < 10) return; // hidden by the layout (e.g. at home)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const stage = currentStage();
    const me = roadPoint(data.distance);
    const route = this.routeFor(stage);

    // The polyline to draw, as ground-plane points with the distance of each.
    let pts: { x: number; z: number; d: number }[];
    if (route) {
      pts = [];
      for (let i = 0; i < route.x.length; i++) pts.push({ x: route.x[i], z: route.z[i], d: i * route.step });
    } else {
      pts = [];
      const from = Math.max(0, data.distance - ENDLESS_BEHIND);
      for (let d = from; d <= data.distance + ENDLESS_AHEAD; d += 20) {
        const p = roadPoint(d);
        pts.push({ x: p.x, z: p.z, d });
      }
    }

    // To screen. North-up fits the route in the box; heading-up puts you low in the box with the road ahead of you.
    const pad = 12;
    const north = this.mode === 'north';
    const f = { x: Math.cos(me.heading), z: Math.sin(me.heading) };
    let scale: number;
    let project: (x: number, z: number) => [number, number];
    if (north) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      const span = Math.max(80, x1 - x0, z1 - z0);
      scale = (Math.min(w, h) - pad * 2) / span;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      project = (x, z) => [w / 2 + (x - cx) * scale, h / 2 + (z - cz) * scale];
    } else {
      scale = (Math.min(w, h) / 2 - pad) / HEADING_RADIUS;
      const oy = h * 0.68; // you sit low, the road runs up the box
      project = (x, z) => {
        const dx = x - me.x;
        const dz = z - me.z;
        return [w / 2 + (-f.z * dx + f.x * dz) * scale, oy - (f.x * dx + f.z * dz) * scale];
      };
    }

    // The round map face.
    const r = Math.min(w, h) / 2 - 1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 22, 44, 0.78)';
    ctx.fill();
    ctx.clip();

    // Road: behind you dim, ahead bright.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const trace = (from: number, to: number) => {
      let started = false;
      ctx.beginPath();
      for (let i = from; i < to; i++) {
        const [px, py] = project(pts[i].x, pts[i].z);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      if (started) ctx.stroke();
    };
    let split = pts.findIndex((p) => p.d >= data.distance);
    if (split < 0) split = pts.length;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#56648a';
    trace(0, Math.min(pts.length, split + 1));
    ctx.strokeStyle = '#dbe6ff';
    trace(Math.max(0, split - 1), pts.length);

    // Markers: sprints, summits and the finish.
    const at = (d: number) => {
      const p = route ? (() => { const i = Math.min(route.x.length - 1, d / route.step); const a = Math.floor(i); const t = i - a; const b = Math.min(route.x.length - 1, a + 1); return { x: route.x[a] + (route.x[b] - route.x[a]) * t, z: route.z[a] + (route.z[b] - route.z[a]) * t }; })() : roadPoint(d);
      return project(p.x, p.z);
    };
    for (const l of data.lines) {
      if (l.kind === 'finish') continue;
      const [px, py] = at(l.d);
      if (l.kind === 'sprint') {
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 4, py);
        ctx.fill();
      } else {
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.moveTo(px, py - 4.5); ctx.lineTo(px + 4.5, py + 3.5); ctx.lineTo(px - 4.5, py + 3.5);
        ctx.fill();
      }
    }
    if (stage.finish !== null) {
      const [px, py] = at(stage.finish);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        ctx.fillStyle = (a + b) % 2 ? '#111827' : '#ffffff';
        ctx.fillRect(px - 4.5 + a * 3, py - 4.5 + b * 3, 3, 3);
      }
    }

    // Everyone else: pro teams in their colours, live riders in blue, the ghost as a ring.
    for (const o of data.riders) {
      const p = roadPoint(o.distance);
      const [px, py] = project(p.x, p.z);
      if (o.ghost) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.stroke();
      } else if (o.team) {
        ctx.fillStyle = TEAM_COLOURS.get(o.team) ?? '#aab';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.strokeStyle = 'rgba(8, 20, 40, 0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, 3.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // You, last so you're on top: a white dot with a red ring, and a nose pointing the way you're heading.
    const [mx, my] = project(me.x, me.z);
    const nose = north ? Math.atan2(f.z, f.x) : -Math.PI / 2;
    ctx.fillStyle = '#d62839';
    ctx.beginPath();
    ctx.moveTo(mx + Math.cos(nose) * 9, my + Math.sin(nose) * 9);
    ctx.lineTo(mx + Math.cos(nose + 2.5) * 5.5, my + Math.sin(nose + 2.5) * 5.5);
    ctx.lineTo(mx + Math.cos(nose - 2.5) * 5.5, my + Math.sin(nose - 2.5) * 5.5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d62839';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();

    // The rim, and an N for north (it swings round the rim when the map turns with you).
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
    const nAng = north ? -Math.PI / 2 : northAngleHeadingUp(f);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', w / 2 + Math.cos(nAng) * (r - 8), h / 2 + Math.sin(nAng) * (r - 8));
  }
}

/** Screen angle of north (-z on the ground plane) when the map is turned so the heading `f` points up. */
function northAngleHeadingUp(f: { x: number; z: number }) {
  // Screen vector of v = (0,-1): x = dot(v, right) , y = -dot(v, f); right = (-f.z, f.x).
  const sx = -f.x; // dot((0,-1), (-f.z, f.x)) = -f.x
  const sy = f.z; // -dot((0,-1), f) = f.z
  return Math.atan2(sy, sx);
}
