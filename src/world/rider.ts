import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Bike and rider built from primitives. Local frame: +x forward, +y up,
// +z to the rider's right (the drive side). Units are metres; the origin is
// on the ground directly under the bottom bracket.

const WHEEL_R = 0.34;
const CRANK = 0.17;
const UP = new THREE.Vector3(0, 1, 0);

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

const M = {
  frame: mat('#1f3c88', { metalness: 0.35, roughness: 0.35 }),
  accent: mat('#d62839', { metalness: 0.3, roughness: 0.4 }),
  black: mat('#16181d', { roughness: 0.7 }),
  alloy: mat('#b8bec9', { metalness: 0.8, roughness: 0.3 }),
  rim: mat('#2a2e37', { metalness: 0.4, roughness: 0.45 }),
  jersey: mat('#d62839', { roughness: 0.7 }),
  white: mat('#f4f6fa', { roughness: 0.6 }),
  navy: mat('#14213d', { roughness: 0.7 }),
  skin: mat('#dca684', { roughness: 0.8 }),
  lens: mat('#101218', { metalness: 0.6, roughness: 0.15 }),
};

const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
const unitSphere = new THREE.SphereGeometry(1, 14, 10);

/** A cylinder that can be stretched between two points every frame. */
class Segment {
  readonly mesh: THREE.Mesh;
  private readonly dir = new THREE.Vector3();

  constructor(parent: THREE.Object3D, private readonly radius: number, material: THREE.Material, private readonly depthScale = 1) {
    this.mesh = new THREE.Mesh(unitCylinder, material);
    this.mesh.castShadow = true;
    parent.add(this.mesh);
  }

  set(a: THREE.Vector3, b: THREE.Vector3) {
    this.dir.subVectors(b, a);
    const len = this.dir.length();
    this.mesh.position.addVectors(a, b).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir.divideScalar(len || 1));
    this.mesh.scale.set(this.radius, len, this.radius * this.depthScale);
    return this;
  }
}

function sphere(parent: THREE.Object3D, r: number, material: THREE.Material, at?: THREE.Vector3) {
  const m = new THREE.Mesh(unitSphere, material);
  m.scale.setScalar(r);
  m.castShadow = true;
  if (at) m.position.copy(at);
  parent.add(m);
  return m;
}

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

/** Two-bone IK in the bike's side plane; returns the knee/elbow position. */
function ik(root: THREE.Vector3, end: THREE.Vector3, l1: number, l2: number, bend: 1 | -1, out: THREE.Vector3) {
  const dx = end.x - root.x;
  const dy = end.y - root.y;
  const d = Math.min(Math.max(Math.hypot(dx, dy), 1e-3), l1 + l2 - 1e-4);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const ang = Math.atan2(dy, dx) + bend * a;
  return out.set(root.x + l1 * Math.cos(ang), root.y + l1 * Math.sin(ang), root.z + (end.z - root.z) * (l1 / (l1 + l2)));
}

function buildWheel(): THREE.Group {
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.016, 0.016, 8, 48), M.black);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.055, 0.028, 6, 48).scale(1, 1, 0.55), M.rim);
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const s = new THREE.CylinderGeometry(0.0022, 0.0022, WHEEL_R - 0.08, 4)
      .translate(0, (WHEEL_R - 0.08) / 2, (i % 2 ? 1 : -1) * 0.01)
      .rotateZ((i / 18) * Math.PI * 2);
    spokes.push(s);
  }
  const spokeMesh = new THREE.Mesh(mergeGeometries(spokes)!, M.alloy);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 12).rotateX(Math.PI / 2), M.alloy);
  const decal = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.055, 0.03, 6, 12, 0.6).scale(1, 1, 0.6), M.accent);
  for (const m of [tire, rim, spokeMesh, hub, decal]) { m.castShadow = true; wheel.add(m); }
  return wheel;
}

/** The rigged rider, loaded once and cloned for every rider on the road. */
let riderGltf: Promise<GLTF | null> | null = null;
function loadRiderModel() {
  riderGltf ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/rider.glb`).catch(() => {
    console.info('Rider model not found: models/rider.glb (using the built-in rider)');
    return null;
  });
  return riderGltf;
}

export interface RiderLook {
  frame?: string; // bike frame colour
  jersey?: string; // jersey colour of the built-in rider
  ghost?: boolean; // see-through, for the ghost of a past ride
  /** Team kit: the rigged rider's navy becomes the first colour and its red the second. */
  kit?: [string, string];
}

const kitMats = new Map<string, THREE.Material>();
/**
 * Recolours the rigged rider's stars-and-stripes kit for a team. The texture is
 * navy, red, white, skin and black; a fragment-shader tweak swaps navy and red
 * for the team colours (keeping the shading), and leaves the rest alone.
 */
function applyKit(root: THREE.Object3D, kit: [string, string]) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const key = `${src.uuid}|${kit.join('|')}`;
    let m = kitMats.get(key);
    if (!m) {
      const mat = src.clone();
      const a = new THREE.Color(kit[0]);
      const b = new THREE.Color(kit[1]);
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.kitA = { value: a };
        shader.uniforms.kitB = { value: b };
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'uniform vec3 kitA;\nuniform vec3 kitB;\nvoid main() {')
          .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec3 kc = sampledDiffuseColor.rgb;
  float klum = dot( kc, vec3( 0.2126, 0.7152, 0.0722 ) );
  float isNavy = step( kc.r * 1.6 + 0.004, kc.b ) * step( kc.g * 1.25 + 0.002, kc.b );
  float isRed = step( kc.g * 3.0 + 0.02, kc.r ) * step( kc.b * 3.0 + 0.02, kc.r );
  kc = mix( kc, kitA * clamp( klum / 0.03, 0.45, 1.3 ), isNavy );
  kc = mix( kc, kitB * clamp( klum / 0.16, 0.45, 1.3 ), isRed );
  sampledDiffuseColor.rgb = kc;
  diffuseColor *= sampledDiffuseColor;
#endif`);
      };
      mat.customProgramCacheKey = () => 'team-kit';
      kitMats.set(key, mat);
      m = mat;
    }
    mesh.material = m;
  });
}

const ghostMats = new Map<THREE.Material, THREE.Material>();
/** Makes every mesh under `root` see-through and shadowless. */
function makeGhost(root: THREE.Object3D, share: boolean) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.Sprite).isSprite) return;
    mesh.castShadow = false;
    const src = mesh.material as THREE.Material;
    let m = share ? ghostMats.get(src) : undefined;
    if (!m) {
      m = src.clone();
      Object.assign(m, { transparent: true, opacity: 0.38, depthWrite: false });
      (m as THREE.MeshStandardMaterial).emissive?.set('#6f9bff');
      (m as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
      if (share) ghostMats.set(src, m);
    }
    mesh.material = m;
  });
}

export class RiderModel {
  /** Placed on the road each frame: yaw on this group, pitch on `body`. */
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  /** Everything above the bike (hidden in first-person view). */
  readonly person = new THREE.Group();

  private readonly rearWheel = buildWheel();
  private readonly frontWheel = buildWheel();
  private readonly bb = v(0, 0.27);
  private readonly legs: { side: number; thigh: Segment; shin: Segment; sock: Segment; shoe: Segment; knee: THREE.Mesh; crank: Segment; pedal: THREE.Mesh }[] = [];
  private readonly tmp = { knee: v(0, 0), ankle: v(0, 0), pedal: v(0, 0), toe: v(0, 0), sock: v(0, 0), crankEnd: v(0, 0), crankStart: v(0, 0) };
  private readonly pedals = new Map<number, THREE.Vector3>([[-1, v(0, 0)], [1, v(0, 0)]]);
  private rig: Rig | null = null;
  private personVisible = true;

  private readonly frameMat: THREE.Material;
  private readonly jerseyMat: THREE.Material;
  private disposed = false;

  constructor(look: RiderLook = {}) {
    this.frameMat = look.frame ? mat(look.frame, { metalness: 0.35, roughness: 0.35 }) : M.frame;
    this.jerseyMat = look.jersey ? mat(look.jersey, { roughness: 0.7 }) : M.jersey;
    this.group.add(this.body);
    this.body.add(this.person);
    this.buildBike();
    this.buildRider();
    if (look.ghost) makeGhost(this.body, true);
    // Swap in the rigged 3D rider when it loads; the primitive rider stays as a fallback.
    loadRiderModel().then((gltf) => {
      if (!gltf || this.disposed) return;
      this.rig = new Rig(cloneSkinned(gltf.scene));
      if (look.ghost) makeGhost(this.rig.root, true);
      else if (look.kit) applyKit(this.rig.root, look.kit);
      this.body.add(this.rig.root);
      this.setPersonVisible(this.personVisible);
    });
  }

  /** Frees this rider's own materials (shared geometry and textures stay). */
  dispose() {
    this.disposed = true;
    if (this.frameMat !== M.frame) this.frameMat.dispose();
    if (this.jerseyMat !== M.jersey) this.jerseyMat.dispose();
  }

  /** Shows or hides the rider (hidden in the rider's-eye camera). */
  setPersonVisible(visible: boolean) {
    this.personVisible = visible;
    this.person.visible = visible && !this.rig;
    if (this.rig) this.rig.root.visible = visible;
  }

  /** `crankAngle` decreases as the rider pedals forward; `distance` spins the wheels. */
  update(distance: number, crankAngle: number) {
    const spin = -distance / WHEEL_R;
    this.rearWheel.rotation.z = spin;
    this.frontWheel.rotation.z = spin;

    const hip = (side: number) => v(-0.17, 0.95, 0.1 * side);
    const t = this.tmp;
    for (const leg of this.legs) {
      const a = crankAngle + (leg.side > 0 ? 0 : Math.PI);
      t.pedal.set(this.bb.x + CRANK * Math.cos(a), this.bb.y + CRANK * Math.sin(a), 0.13 * leg.side);
      t.crankStart.set(this.bb.x, this.bb.y, 0.07 * leg.side);
      t.crankEnd.set(t.pedal.x, t.pedal.y, 0.08 * leg.side);
      leg.crank.set(t.crankStart, t.crankEnd);
      leg.pedal.position.copy(t.pedal);
      this.pedals.get(leg.side)!.copy(t.pedal);
      if (this.rig) continue;

      t.ankle.set(t.pedal.x - 0.04, t.pedal.y + 0.06, t.pedal.z);
      const h = hip(leg.side);
      ik(h, t.ankle, 0.44, 0.43, 1, t.knee);
      leg.thigh.set(h, t.knee);
      leg.knee.position.copy(t.knee);
      t.sock.lerpVectors(t.knee, t.ankle, 0.78);
      leg.shin.set(t.knee, t.sock);
      leg.sock.set(t.sock, t.ankle);
      t.toe.set(t.pedal.x + 0.1, t.pedal.y + 0.025, t.pedal.z);
      leg.shoe.set(t.ankle, t.toe);
    }
  }

  /** Poses the rigged rider (after `update`, once the bike is placed in the world). */
  poseRider() {
    if (this.rig?.root.visible) this.rig.pose(this.body, this.pedals);
  }

  private buildBike() {
    const b = this.body;
    const rear = v(-0.41, WHEEL_R);
    const front = v(0.6, WHEEL_R);
    const seat = v(-0.14, 0.76);
    const headTop = v(0.47, 0.79);
    const headBottom = v(0.51, 0.65);
    const tube = (a: THREE.Vector3, c: THREE.Vector3, r: number, m: THREE.Material, depth = 1) => new Segment(b, r, m, depth).set(a, c);

    this.rearWheel.position.copy(rear);
    this.frontWheel.position.copy(front);
    b.add(this.rearWheel, this.frontWheel);

    for (const side of [-1, 1]) {
      tube(this.bb.clone().setZ(0.03 * side), rear.clone().setZ(0.055 * side), 0.012, this.frameMat); // chainstays
      tube(seat.clone().setZ(0.02 * side), rear.clone().setZ(0.055 * side), 0.01, this.frameMat); // seatstays
      tube(headBottom.clone().setZ(0.02 * side), front.clone().setZ(0.05 * side), 0.012, M.black); // fork legs
    }
    tube(this.bb, seat, 0.019, this.frameMat); // seat tube
    tube(seat, headTop, 0.019, this.frameMat, 1.2); // top tube
    tube(this.bb, headBottom, 0.026, this.frameMat, 1.3); // down tube
    tube(headBottom, headTop, 0.024, this.frameMat); // head tube
    tube(this.bb.clone().lerp(headBottom, 0.3), this.bb.clone().lerp(headBottom, 0.65), 0.0275, M.accent, 1.3);

    // Seatpost and saddle.
    tube(seat, v(-0.18, 0.86), 0.012, M.black);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.035, 0.13), M.black);
    saddle.position.set(-0.19, 0.875, 0);
    saddle.castShadow = true;
    b.add(saddle);

    // Stem and drop bars.
    tube(headTop, v(0.58, 0.84), 0.014, M.black);
    tube(v(0.58, 0.84, -0.21), v(0.58, 0.84, 0.21), 0.012, M.black);
    for (const side of [-1, 1]) {
      const z = 0.21 * side;
      tube(v(0.58, 0.84, z), v(0.64, 0.8, z), 0.012, M.black);
      tube(v(0.64, 0.8, z), v(0.63, 0.71, z), 0.012, M.black);
      tube(v(0.63, 0.71, z), v(0.56, 0.7, z), 0.012, M.black);
    }

    // Drivetrain on the right.
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.006, 32).rotateX(Math.PI / 2), M.alloy);
    ring.position.set(this.bb.x, this.bb.y, 0.055);
    const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 20).rotateX(Math.PI / 2), M.alloy);
    cassette.position.set(rear.x, rear.y, 0.05);
    b.add(ring, cassette);
    tube(v(0, 0.37, 0.055), v(-0.41, 0.385, 0.05), 0.004, M.black);
    tube(v(0, 0.17, 0.055), v(-0.41, 0.295, 0.05), 0.004, M.black);

    for (const side of [-1, 1]) {
      const crank = new Segment(b, 0.012, M.black, 1.6);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.08), M.black);
      pedal.castShadow = true;
      b.add(pedal);
      this.legs.push({
        side,
        crank,
        pedal,
        thigh: new Segment(this.person, 0.068, M.navy),
        shin: new Segment(this.person, 0.048, M.skin),
        sock: new Segment(this.person, 0.045, M.white),
        shoe: new Segment(this.person, 0.042, M.black, 0.9),
        knee: sphere(this.person, 0.055, M.skin),
      });
    }
  }

  private buildRider() {
    const p = this.person;
    const hip = v(-0.17, 0.95);
    const shoulder = v(0.28, 1.27);

    // Hips and torso (wider than deep), with a white chest band and navy shoulders.
    const pelvis = sphere(p, 0.14, M.navy, hip);
    pelvis.scale.set(0.14, 0.12, 0.17);
    new Segment(p, 0.15, this.jerseyMat, 1.25).set(hip.clone().lerp(shoulder, 0.1), shoulder);
    new Segment(p, 0.153, M.white, 1.25).set(hip.clone().lerp(shoulder, 0.48), hip.clone().lerp(shoulder, 0.58));
    new Segment(p, 0.153, M.navy, 1.25).set(hip.clone().lerp(shoulder, 0.7), hip.clone().lerp(shoulder, 0.85));
    const chest = sphere(p, 0.15, M.navy, shoulder);
    chest.scale.set(0.15, 0.14, 0.2);

    // Arms reaching to the hoods.
    for (const side of [-1, 1]) {
      const s = v(0.27, 1.26, 0.17 * side);
      const hand = v(0.6, 0.86, 0.2 * side);
      const elbow = ik(s, hand, 0.3, 0.3, -1, new THREE.Vector3());
      sphere(p, 0.055, this.jerseyMat, s);
      new Segment(p, 0.047, this.jerseyMat).set(s, elbow);
      sphere(p, 0.04, M.skin, elbow);
      new Segment(p, 0.036, M.skin).set(elbow, hand);
      sphere(p, 0.042, M.black, hand);
    }

    // Neck, head, helmet and glasses.
    const head = v(0.42, 1.4);
    new Segment(p, 0.045, M.skin).set(shoulder, head.clone().add(v(-0.03, -0.05)));
    sphere(p, 0.1, M.skin, head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
    helmet.scale.set(1.3, 0.9, 1.05);
    helmet.position.copy(head).add(v(-0.015, 0.02));
    helmet.rotation.z = -0.3;
    helmet.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 24, Math.PI), M.accent);
    stripe.scale.set(1.3, 0.9, 1);
    stripe.position.copy(helmet.position);
    stripe.rotation.z = -0.3;
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.19), M.lens);
    glasses.position.copy(head).add(v(0.085, 0.0));
    p.add(helmet, stripe, glasses);
  }
}

// ----------------------------------------------------------- rigged rider ----

// Targets in the bike's frame (+x forward, +y up, +z right).
const RIDER_SCALE = 1.06; // fits the model's 0.80 m legs to this bike
const HIP_CENTRE = v(-0.17, 0.93); // midpoint between the hip joints, just above the saddle
const BACK_ANGLE = (40 * Math.PI) / 180; // hip-to-shoulder line, measured from horizontal
const PELVIS_TILT = (28 * Math.PI) / 180; // pelvis rolled forward on the saddle
const HAND = (side: number) => v(0.6, 0.865, 0.2 * side); // on the brake hoods
const HEAD_UP = v(0.42, 0.91).normalize(); // head tilted up to look along the road
const ELBOW_POLE = (side: number) => v(-0.2, -1, 0.5 * side); // elbows bend down and out
const KNEE_POLE = (side: number) => v(1, 0.15, 0.12 * side); // knees point forward
const BB_HEIGHT = 0.27; // bottom bracket height, as in RiderModel
const TOE_DROP = 0.045; // toe target below the pedal: a level shoe over the top of the stroke

/**
 * A skinned humanoid (Hips / Spine02 / Spine01 / Spine / neck / Head,
 * Left|Right Arm / ForeArm / Hand, Left|Right UpLeg / Leg / Foot / ToeBase)
 * posed by aiming bones at targets, starting from the bind pose each frame.
 */
class Rig {
  readonly root = new THREE.Group();
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly len = new Map<string, number>();
  private torso = 0.5; // hip joints to base of neck, metres
  private readonly wq = new THREE.Quaternion();
  private readonly pq = new THREE.Quaternion();

  constructor(scene: THREE.Object3D) {
    const holder = new THREE.Group();
    holder.rotation.y = Math.PI / 2; // model faces +z; the bike faces +x
    holder.scale.setScalar(RIDER_SCALE);
    holder.add(scene);
    this.root.add(holder);
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
        o.frustumCulled = false; // bounds are from the bind pose
        o.castShadow = true;
        o.receiveShadow = true;
      }
      if ((o as THREE.Bone).isBone) {
        this.bones.set(o.name, o);
        this.rest.set(o, o.quaternion.clone());
      }
    });

    // Measure limbs and seat the hips over the saddle.
    this.root.updateMatrixWorld(true);
    const at = (name: string) => this.bone(name).getWorldPosition(new THREE.Vector3());
    for (const s of ['Left', 'Right']) {
      this.len.set(`${s}Thigh`, at(`${s}UpLeg`).distanceTo(at(`${s}Leg`)));
      this.len.set(`${s}Shin`, at(`${s}Leg`).distanceTo(at(`${s}Foot`)));
      this.len.set(`${s}Upper`, at(`${s}Arm`).distanceTo(at(`${s}ForeArm`)));
      this.len.set(`${s}Fore`, at(`${s}ForeArm`).distanceTo(at(`${s}Hand`)));
    }
    const hips = at('LeftUpLeg').add(at('RightUpLeg')).multiplyScalar(0.5);
    this.torso = hips.distanceTo(at('neck'));
    this.root.position.copy(HIP_CENTRE).sub(hips);
  }

  private bone(name: string) {
    const b = this.bones.get(name);
    if (!b) throw new Error(`rider.glb has no bone named ${name}`);
    return b;
  }

  pose(body: THREE.Object3D, pedals: Map<number, THREE.Vector3>) {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    const world = (p: THREE.Vector3) => body.localToWorld(p.clone());
    const dir = (p: THREE.Vector3) => p.clone().normalize().applyQuaternion(body.getWorldQuaternion(this.wq));
    const pos = (name: string) => this.bone(name).getWorldPosition(new THREE.Vector3());

    // Roll the pelvis forward, then lean the back over three joints so it
    // curves instead of hinging, ending with the neck on a BACK_ANGLE line
    // from the hip joints.
    this.aim('Hips', 'Spine02', pos('Hips').add(dir(v(Math.sin(PELVIS_TILT), Math.cos(PELVIS_TILT)))));
    const neck = world(v(HIP_CENTRE.x + this.torso * Math.cos(BACK_ANGLE), HIP_CENTRE.y + this.torso * Math.sin(BACK_ANGLE)));
    this.aim('Spine02', 'neck', neck, 0.6);
    this.aim('Spine01', 'neck', neck, 0.8);
    this.aim('Spine', 'neck', neck, 1);
    const head = pos('Head');
    this.aim('Head', 'head_end', head.add(dir(HEAD_UP).multiplyScalar(0.2)));

    for (const [side, s] of [[-1, 'Left'], [1, 'Right']] as const) {
      // Arms to the hoods.
      const hand = world(HAND(side));
      const elbow = ik3(pos(`${s}Arm`), hand, this.len.get(`${s}Upper`)!, this.len.get(`${s}Fore`)!, dir(ELBOW_POLE(side)));
      this.aim(`${s}Arm`, `${s}ForeArm`, elbow);
      this.aim(`${s}ForeArm`, `${s}Hand`, hand);

      // Legs to the pedals: ball of the foot on the pedal, ankle above and behind.
      // The model's foot bone runs well above the sole, so the toe target sits
      // below the pedal to keep the shoe level. Ankling: the toes dip a little
      // more through the bottom of the stroke than over the top.
      const pedal = pedals.get(side)!;
      const crank = Math.atan2(pedal.y - BB_HEIGHT, pedal.x);
      const dip = TOE_DROP + 0.025 * (0.5 - 0.5 * Math.sin(crank));
      const ankle = world(v(pedal.x - 0.075, pedal.y + 0.075, pedal.z));
      const toe = world(v(pedal.x + 0.035, pedal.y - dip, pedal.z));
      const knee = ik3(pos(`${s}UpLeg`), ankle, this.len.get(`${s}Thigh`)!, this.len.get(`${s}Shin`)!, dir(KNEE_POLE(side)));
      this.aim(`${s}UpLeg`, `${s}Leg`, knee);
      this.aim(`${s}Leg`, `${s}Foot`, ankle);
      this.aim(`${s}Foot`, `${s}ToeBase`, toe);
    }
  }

  /** Rotates `name` (by `fraction` of the way) so that `child` points at `target`. */
  private aim(name: string, child: string, target: THREE.Vector3, fraction = 1) {
    const b = this.bone(name);
    const from = this.bone(child).getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    const to = target.clone().sub(b.getWorldPosition(new THREE.Vector3())).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    if (fraction < 1) q.slerp(new THREE.Quaternion(), 1 - fraction);
    b.getWorldQuaternion(this.wq);
    b.parent!.getWorldQuaternion(this.pq);
    b.quaternion.copy(this.pq.invert().multiply(q.multiply(this.wq)));
    b.updateMatrixWorld(true);
  }
}

/** Two-bone IK in 3D: middle joint position, bending towards `pole`. */
function ik3(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  const u = c.clone().sub(a);
  const d = Math.min(Math.max(u.length(), 1e-3), l1 + l2 - 1e-4);
  u.normalize();
  const cos = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const w = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  return a.clone().addScaledVector(u, l1 * cos).addScaledVector(w, l1 * Math.sqrt(1 - cos * cos));
}
