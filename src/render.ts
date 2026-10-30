import { elevationAt } from './course';

export interface SceneState {
  distance: number; // metres travelled
  speedMs: number;
  crankAngle: number; // radians, decreases as the rider pedals forward
  markerEvery: number; // metres between labelled road signs
  markerLabel: (n: number) => string;
}

const ROAD_EXAGGERATION = 2; // makes gentle grades readable on screen
const WHEEL_R = 0.34;
const CRANK_LEN = 0.17;

const C = {
  frame: '#1f3c88',
  frameAccent: '#d62839',
  jersey: '#d62839',
  jerseyBand: '#ffffff',
  shorts: '#14213d',
  skin: '#e0ac8a',
  skinFar: '#b98767',
  farShade: 'rgba(10, 16, 40, 0.35)',
  tire: '#16181d',
  rim: '#3a3f4b',
  spoke: 'rgba(220, 225, 235, 0.8)',
  helmet: '#f5f7fb',
};

type Pt = [number, number];

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private camElev = 0;
  private time = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  draw(s: SceneState, dt: number) {
    const { ctx, w, h } = this;
    this.time += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const elev = elevationAt(s.distance);
    this.camElev += (elev - this.camElev) * Math.min(1, dt * 2.5);

    const scale = Math.max(42, Math.min(120, Math.min(h / 9.5, w / 8))); // px per metre
    const riderX = w * 0.36;
    const groundY = h * 0.7;
    const toScreen = (worldX: number): Pt => [
      riderX + (worldX - s.distance) * scale,
      groundY - (elevationAt(worldX) - this.camElev) * scale * ROAD_EXAGGERATION,
    ];

    this.drawSky();
    this.drawClouds(s.distance);
    this.drawRidges(s.distance, 0.04, h * 0.5 + this.camElev * 0.6, h * 0.22, '#7d93b8', '#9fb2d1', 11);
    this.drawRidges(s.distance, 0.12, h * 0.6 + this.camElev * 1.4, h * 0.12, '#5f9a6a', '#77b07f', 23);
    this.drawTreeLine(s.distance, 0.35, h * 0.7 + this.camElev * 3);
    this.drawRoad(s, scale, riderX, toScreen);
    this.drawRider(s, scale, toScreen);
  }

  // ----------------------------------------------------------- scenery ----

  private drawSky() {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.75);
    g.addColorStop(0, '#2f6fbf');
    g.addColorStop(0.55, '#8ec2ea');
    g.addColorStop(1, '#e8f1f7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const sun = ctx.createRadialGradient(w * 0.8, h * 0.2, 0, w * 0.8, h * 0.2, h * 0.25);
    sun.addColorStop(0, 'rgba(255, 248, 220, 0.95)');
    sun.addColorStop(0.15, 'rgba(255, 240, 200, 0.6)');
    sun.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);
  }

  private drawClouds(distance: number) {
    const { ctx, w, h } = this;
    const span = w + 400;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 7; i++) {
      const speed = 4 + hash(i) * 6;
      const x = mod(hash(i + 50) * span - distance * 0.6 - this.time * speed, span) - 200;
      const y = h * (0.08 + hash(i + 99) * 0.25);
      const size = 30 + hash(i + 7) * 50;
      ctx.beginPath();
      ctx.ellipse(x, y, size * 1.6, size * 0.45, 0, 0, Math.PI * 2);
      ctx.ellipse(x - size * 0.6, y + size * 0.1, size * 0.8, size * 0.35, 0, 0, Math.PI * 2);
      ctx.ellipse(x + size * 0.3, y - size * 0.25, size * 0.8, size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRidges(distance: number, parallax: number, baseY: number, height: number, fill: string, top: string, seed: number) {
    const { ctx, w, h } = this;
    const offset = distance * 60 * parallax;
    const ridge = (x: number) => {
      const u = (x + offset) / 260;
      return (
        Math.sin(u + seed) * 0.45 +
        Math.sin(u * 2.3 + seed * 1.7) * 0.25 +
        Math.abs(Math.sin(u * 0.7 + seed * 0.3)) * 0.6
      );
    };
    const g = ctx.createLinearGradient(0, baseY - height, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(0.5, fill);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, baseY - ridge(x) * height);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }

  private drawTreeLine(distance: number, parallax: number, baseY: number) {
    const { ctx, w, h } = this;
    const offset = distance * 60 * parallax;
    const bank = (x: number) => baseY - 18 - Math.sin((x + offset) / 180) * 14;

    ctx.fillStyle = '#4d8a55';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, bank(x));
    ctx.lineTo(w, h);
    ctx.fill();

    const spacing = 46;
    const first = Math.floor(offset / spacing) - 1;
    for (let i = first; i < first + w / spacing + 3; i++) {
      if (hash(i) < 0.35) continue;
      const x = i * spacing - offset + hash(i + 3) * 30;
      const y = bank(x) + 4;
      const size = 26 + hash(i + 11) * 34;
      if (hash(i + 5) < 0.55) {
        ctx.fillStyle = '#5b4030';
        ctx.fillRect(x - 2, y - size * 0.3, 4, size * 0.3);
        ctx.fillStyle = hash(i + 9) < 0.5 ? '#2f6b3c' : '#3a7a45';
        ctx.beginPath();
        ctx.moveTo(x, y - size * 1.25);
        ctx.lineTo(x + size * 0.38, y - size * 0.22);
        ctx.lineTo(x - size * 0.38, y - size * 0.22);
        ctx.fill();
      } else {
        ctx.fillStyle = '#5b4030';
        ctx.fillRect(x - 2.5, y - size * 0.45, 5, size * 0.45);
        ctx.fillStyle = hash(i + 9) < 0.5 ? '#3f8a4a' : '#57a05c';
        ctx.beginPath();
        ctx.arc(x, y - size * 0.7, size * 0.38, 0, Math.PI * 2);
        ctx.arc(x - size * 0.2, y - size * 0.55, size * 0.28, 0, Math.PI * 2);
        ctx.arc(x + size * 0.22, y - size * 0.55, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawRoad(s: SceneState, scale: number, riderX: number, toScreen: (x: number) => Pt) {
    const { ctx, w, h } = this;
    const left = s.distance - riderX / scale - 1;
    const right = s.distance + (w - riderX) / scale + 1;
    const step = 8 / scale;
    const pts: Pt[] = [];
    for (let x = left; x <= right; x += step) pts.push(toScreen(x));

    const roadThickness = Math.max(10, scale * 0.22);
    // Verge below the road.
    ctx.fillStyle = '#6a9b4f';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    // Earth bank.
    const earth = ctx.createLinearGradient(0, h * 0.6, 0, h);
    earth.addColorStop(0, '#7a5b3e');
    earth.addColorStop(1, '#4f3a29');
    ctx.fillStyle = earth;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + roadThickness + 6) : ctx.moveTo(x, y + roadThickness + 6)));
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    // Asphalt.
    ctx.fillStyle = '#3b3f47';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + roadThickness);
    ctx.fill();
    // Edge line and dashed centre line, scrolling with distance.
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 1) : ctx.moveTo(x, y + 1)));
    ctx.stroke();
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 3;
    ctx.setLineDash([scale * 1.2, scale * 1.4]);
    ctx.lineDashOffset = left * scale;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + roadThickness * 0.55) : ctx.moveTo(x, y + roadThickness * 0.55)));
    ctx.stroke();
    ctx.setLineDash([]);

    // Marker posts every 100 m and labelled signs every `markerEvery`.
    for (let m = Math.ceil(left / 100) * 100; m <= right; m += 100) {
      const [x, y] = toScreen(m);
      ctx.fillStyle = '#f4f4f4';
      ctx.fillRect(x - 3, y - scale * 0.55, 6, scale * 0.55);
      ctx.fillStyle = '#d62839';
      ctx.fillRect(x - 3, y - scale * 0.55, 6, scale * 0.1);
    }
    for (let m = Math.ceil(left / s.markerEvery) * s.markerEvery; m <= right; m += s.markerEvery) {
      if (m <= 0) continue;
      const [x, y] = toScreen(m);
      const label = s.markerLabel(Math.round(m / s.markerEvery));
      ctx.fillStyle = '#8a8f99';
      ctx.fillRect(x - 2, y - scale * 1.6, 4, scale * 1.6);
      ctx.font = `700 ${Math.round(scale * 0.28)}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + scale * 0.3;
      ctx.fillStyle = '#1f6f43';
      roundRect(ctx, x - tw / 2, y - scale * 2.1, tw, scale * 0.5, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y - scale * 1.85);
    }
  }

  // ------------------------------------------------------------- rider ----

  private drawRider(s: SceneState, scale: number, toScreen: (x: number) => Pt) {
    const { ctx } = this;
    const [rx, ry] = toScreen(s.distance - 0.45);
    const [fx, fy] = toScreen(s.distance + 0.55);
    const [bx, by] = toScreen(s.distance);
    const tilt = Math.atan2(fy - ry, fx - rx);

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(tilt);
    ctx.scale(scale, -scale); // local units are metres, y up
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const rear: Pt = [-0.41, WHEEL_R];
    const front: Pt = [0.6, WHEEL_R];
    const bb: Pt = [0, 0.27];
    const hip: Pt = [-0.17, 0.95];
    const shoulder: Pt = [0.28, 1.27];
    const hands: Pt = [0.6, 0.875];
    const wheelAngle = -s.distance / WHEEL_R;
    const pedal = (a: number): Pt => [bb[0] + CRANK_LEN * Math.cos(a), bb[1] + CRANK_LEN * Math.sin(a)];
    const nearPedal = pedal(s.crankAngle);
    const farPedal = pedal(s.crankAngle + Math.PI);

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(0.1, -0.01, 0.85, 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawWheel(rear, wheelAngle, s.speedMs);
    this.drawWheel(front, wheelAngle, s.speedMs);

    // Far side: leg and crank, shaded.
    this.drawCrank(bb, farPedal, true);
    this.drawLeg(hip, farPedal, true);

    this.drawFrame(rear, front, bb);
    this.drawArm(shoulder, hands, true);
    this.drawTorsoAndHead(hip, shoulder);

    // Drivetrain and near side.
    this.drawDrivetrain(bb, rear);
    this.drawCrank(bb, nearPedal, false);
    this.drawLeg(hip, nearPedal, false);
    this.drawArm(shoulder, hands, false);

    ctx.restore();
  }

  private drawWheel(c: Pt, angle: number, speed: number) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(c[0], c[1]);
    // Deep-section rim.
    ctx.strokeStyle = C.rim;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL_R - 0.05, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = C.tire;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL_R - 0.0175, 0, Math.PI * 2);
    ctx.stroke();
    // Spokes fade into a blur as speed builds.
    ctx.globalAlpha = Math.max(0.25, 1 - speed / 16);
    ctx.strokeStyle = C.spoke;
    ctx.lineWidth = 0.006;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = angle + (i / 18) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * (WHEEL_R - 0.08), Math.sin(a) * (WHEEL_R - 0.08));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Rim decal so rotation reads even at speed.
    ctx.strokeStyle = C.frameAccent;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, WHEEL_R - 0.05, angle, angle + 0.5);
    ctx.stroke();
    ctx.fillStyle = '#c9ced8';
    ctx.beginPath();
    ctx.arc(0, 0, 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawFrame(rear: Pt, front: Pt, bb: Pt) {
    const { ctx } = this;
    const seatCluster: Pt = [-0.14, 0.76];
    const headTop: Pt = [0.47, 0.79];
    const headBottom: Pt = [0.51, 0.65];
    const saddle: Pt = [-0.19, 0.87];

    ctx.strokeStyle = C.frame;
    ctx.lineWidth = 0.045;
    line(ctx, bb, rear); // chainstay
    line(ctx, seatCluster, rear); // seatstay
    line(ctx, bb, seatCluster); // seat tube
    line(ctx, seatCluster, headTop); // top tube
    ctx.lineWidth = 0.055;
    line(ctx, bb, headBottom); // down tube
    ctx.lineWidth = 0.05;
    line(ctx, headTop, headBottom); // head tube
    ctx.strokeStyle = '#2b2f38';
    ctx.lineWidth = 0.035;
    line(ctx, headBottom, front); // fork
    // Accent stripe on the down tube.
    ctx.strokeStyle = C.frameAccent;
    ctx.lineWidth = 0.02;
    line(ctx, lerp(bb, headBottom, 0.25), lerp(bb, headBottom, 0.65));
    // Seatpost, saddle, stem, bars.
    ctx.strokeStyle = '#2b2f38';
    ctx.lineWidth = 0.025;
    line(ctx, seatCluster, [saddle[0] + 0.01, saddle[1]]);
    ctx.lineWidth = 0.04;
    line(ctx, [saddle[0] - 0.1, saddle[1] + 0.01], [saddle[0] + 0.12, saddle[1]]);
    ctx.lineWidth = 0.03;
    line(ctx, headTop, [0.58, 0.84]);
    ctx.beginPath();
    ctx.moveTo(0.58, 0.84);
    ctx.quadraticCurveTo(0.66, 0.84, 0.64, 0.75);
    ctx.quadraticCurveTo(0.62, 0.69, 0.56, 0.71);
    ctx.stroke();
  }

  private drawDrivetrain(bb: Pt, rear: Pt) {
    const { ctx } = this;
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 0.008;
    line(ctx, [bb[0], bb[1] + 0.1], [rear[0], rear[1] + 0.045]);
    line(ctx, [bb[0], bb[1] - 0.1], [rear[0], rear[1] - 0.045]);
    ctx.fillStyle = '#9aa1ad';
    ctx.beginPath();
    ctx.arc(rear[0], rear[1], 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c3c8d1';
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.arc(bb[0], bb[1], 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawCrank(bb: Pt, pedal: Pt, far: boolean) {
    const { ctx } = this;
    ctx.strokeStyle = far ? '#4b5260' : '#2b2f38';
    ctx.lineWidth = 0.03;
    line(ctx, bb, pedal);
    ctx.lineWidth = 0.025;
    line(ctx, [pedal[0] - 0.045, pedal[1]], [pedal[0] + 0.045, pedal[1]]);
  }

  private drawLeg(hip: Pt, pedal: Pt, far: boolean) {
    const { ctx } = this;
    const ankle: Pt = [pedal[0] - 0.04, pedal[1] + 0.06];
    const knee = ik(hip, ankle, 0.44, 0.43, 1);
    ctx.strokeStyle = C.shorts;
    ctx.lineWidth = 0.13;
    line(ctx, hip, knee);
    ctx.strokeStyle = far ? C.skinFar : C.skin;
    ctx.lineWidth = 0.09;
    line(ctx, knee, ankle);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.075;
    line(ctx, lerp(knee, ankle, 0.82), ankle);
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 0.06;
    line(ctx, ankle, [pedal[0] + 0.09, pedal[1] + 0.02]);
    if (far) this.shade(() => {
      ctx.lineWidth = 0.13;
      line(ctx, hip, knee);
      ctx.lineWidth = 0.09;
      line(ctx, knee, ankle);
    });
  }

  private drawArm(shoulder: Pt, hands: Pt, far: boolean) {
    const { ctx } = this;
    const elbow = ik(shoulder, hands, 0.3, 0.3, -1);
    ctx.strokeStyle = C.jersey;
    ctx.lineWidth = 0.09;
    line(ctx, shoulder, elbow);
    ctx.strokeStyle = far ? C.skinFar : C.skin;
    ctx.lineWidth = 0.065;
    line(ctx, elbow, hands);
    ctx.fillStyle = '#111318';
    ctx.beginPath();
    ctx.arc(hands[0], hands[1], 0.04, 0, Math.PI * 2);
    ctx.fill();
    if (far) this.shade(() => {
      ctx.lineWidth = 0.09;
      line(ctx, shoulder, elbow);
      line(ctx, elbow, hands);
    });
  }

  private drawTorsoAndHead(hip: Pt, shoulder: Pt) {
    const { ctx } = this;
    ctx.strokeStyle = C.shorts;
    ctx.lineWidth = 0.2;
    line(ctx, hip, lerp(hip, shoulder, 0.2));
    ctx.strokeStyle = C.jersey;
    ctx.lineWidth = 0.22;
    line(ctx, lerp(hip, shoulder, 0.15), shoulder);
    // White chest band and navy star panel, perpendicular to the torso.
    const dir = norm([shoulder[0] - hip[0], shoulder[1] - hip[1]]);
    const perp: Pt = [-dir[1], dir[0]];
    const band = (t: number, color: string, width: number) => {
      const c = lerp(hip, shoulder, t);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      line(ctx, [c[0] - perp[0] * 0.1, c[1] - perp[1] * 0.1], [c[0] + perp[0] * 0.1, c[1] + perp[1] * 0.1]);
    };
    band(0.5, C.jerseyBand, 0.07);
    band(0.62, '#1f3c88', 0.06);
    ctx.fillStyle = '#ffffff';
    star(ctx, ...lerp(hip, shoulder, 0.8), 0.04);

    // Neck and head.
    const head: Pt = [shoulder[0] + 0.14, shoulder[1] + 0.13];
    ctx.strokeStyle = C.skin;
    ctx.lineWidth = 0.08;
    line(ctx, shoulder, [head[0] - 0.03, head[1] - 0.05]);
    ctx.fillStyle = C.skin;
    ctx.beginPath();
    ctx.arc(head[0], head[1], 0.1, 0, Math.PI * 2);
    ctx.fill();
    // Helmet, tilted with the riding position.
    ctx.save();
    ctx.translate(head[0], head[1] + 0.02);
    ctx.rotate(-0.25);
    ctx.fillStyle = C.helmet;
    ctx.beginPath();
    ctx.ellipse(-0.01, 0.02, 0.15, 0.1, 0, 0, Math.PI);
    ctx.fill();
    ctx.strokeStyle = C.frameAccent;
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.ellipse(-0.01, 0.02, 0.12, 0.075, 0, 0.3, Math.PI - 0.3);
    ctx.stroke();
    ctx.restore();
    // Sunglasses.
    ctx.strokeStyle = '#111318';
    ctx.lineWidth = 0.035;
    line(ctx, [head[0] + 0.02, head[1] + 0.005], [head[0] + 0.1, head[1] - 0.005]);
  }

  /** Re-strokes the current shape with a translucent dark overlay (far-side limbs). */
  private shade(strokes: () => void) {
    this.ctx.save();
    this.ctx.strokeStyle = C.farShade;
    strokes();
    this.ctx.restore();
  }
}

/** Elevation profile strip: 0.5 km behind to 4.5 km ahead, coloured by grade. */
export function drawProfile(canvas: HTMLCanvasElement, distance: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const from = Math.max(0, distance - 500);
  const to = from + 5000;
  const samples: { x: number; e: number; g: number }[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= w; i += 3) {
    const d = from + ((to - from) * i) / w;
    const e = elevationAt(d);
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
    // Grade averaged over 100 m so the colour bands show climbs, not every bump.
    samples.push({ x: i, e, g: (elevationAt(d + 50) - elevationAt(d - 50)) / 100 });
  }
  const range = Math.max(30, hi - lo);
  const y = (e: number) => h - 4 - ((e - lo) / range) * (h - 14);

  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    ctx.fillStyle = gradeColor(b.g);
    ctx.beginPath();
    ctx.moveTo(a.x, h);
    ctx.lineTo(a.x, y(a.e));
    ctx.lineTo(b.x, y(b.e));
    ctx.lineTo(b.x, h);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(10, 15, 30, 0.45)';
  const px = ((distance - from) / (to - from)) * w;
  ctx.fillRect(0, 0, px, h);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d62839';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, y(elevationAt(distance)), 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function gradeColor(g: number): string {
  const pct = g * 100;
  if (pct < -1) return '#5aa9e6';
  if (pct < 2) return '#6cc070';
  if (pct < 5) return '#f2c14e';
  if (pct < 8) return '#f08a4b';
  return '#d62839';
}

// ------------------------------------------------------------- helpers ----

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function norm(v: Pt): Pt {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Two-bone inverse kinematics: returns the middle joint (knee / elbow). */
function ik(root: Pt, end: Pt, l1: number, l2: number, bend: 1 | -1): Pt {
  const dx = end[0] - root[0];
  const dy = end[1] - root[1];
  const d = Math.min(Math.max(Math.hypot(dx, dy), 1e-3), l1 + l2 - 1e-4);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const ang = Math.atan2(dy, dx) + bend * a;
  return [root[0] + l1 * Math.cos(ang), root[1] + l1 * Math.sin(ang)];
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}
