// Kestrel Vale's stand-apart landmarks (the viaduct, the jetty) through the real Landmarks class: a landmark with `within` is placed only while the rider is
// near it (so it is never seen over terrain that is not built), it is the same on a route that starts partway round, and trees keep off it by position.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roadPoint, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { Landmarks, nearLandmark } from '../../src/world/landmarks';
import { groundSampler } from '../../src/world/terrain';
import { KESTREL_VALE, KV } from '../../src/worlds/kestrelVale';

// The model files are not there in a unit test: every GLB is "missing" (skipped), the code-built monuments are what is placed. The three hero models are the
// exception: each loads as a box the size of its real file (as normalised, front towards +z), so their placement can be read back.
vi.mock('../../src/world/gltf', async () => {
  const T = await import('three');
  const SIZES: Record<string, [number, number, number]> = { 'raven-keep.glb': [0.7176, 1, 0.6954], 'kestrel-boathouse.glb': [0.8538, 0.7928, 1], 'hollins-cross-inn.glb': [1, 0.8683, 0.7931] };
  return {
    gltfLoader: () => ({
      load: (url: string, ok: (g: { scene: unknown }) => void, _p: unknown, err: () => void) => {
        const size = SIZES[url.split('/').pop()!];
        if (!size) { err(); return; }
        const scene = new T.Group();
        const mesh = new T.Mesh(new T.BoxGeometry(...size), new T.MeshBasicMaterial());
        mesh.position.y = size[1] / 2 + 0.2; // not on y = 0: normalise stands it there
        scene.add(mesh);
        ok({ scene });
      },
    }),
  };
});

const viaduct = KESTREL_VALE.landmarks.find((k) => k.model === 'stone-viaduct')!;
const settle = async (l: Landmarks, d: number) => {
  await vi.waitFor(() => { l.update(d); expect(l.group.children.length).toBeGreaterThan(0); }, { timeout: 4000, interval: 50 }).catch(() => undefined);
  l.update(d);
};
const placedAt = (l: Landmarks) => l.group.children.filter((c) => Math.abs(c.position.x - viaduct.world!.x) < 1 && Math.abs(c.position.z - viaduct.world!.z) < 1);

describe('the viaduct’s `within`', () => {
  afterEach(() => setStage(stageById(null)));

  it('is put up when the rider is on the Foss straight within 1,050 m, stands where the world says (origin on the gill’s floor), and is not placed from the village, the lake or the far side of the climb', async () => {
    setStage(stageById('kestrel-vale-loop'));
    const l = new Landmarks();
    await settle(l, 4900);
    const [obj] = placedAt(l);
    expect(obj, 'placed from 4,900 m').toBeDefined();
    expect(obj.position.y).toBeCloseTo(viaduct.world!.y, 6);
    expect(obj.rotation.y).toBeCloseTo(viaduct.world!.yaw, 6);
    const box = new THREE.Box3().setFromObject(obj);
    expect(box.max.y - obj.position.y, 'its natural height, unscaled').toBeCloseTo(20.09, 1);
    // Gone once the rider is far from it (a hysteresis of 80 m aside).
    l.update(1000);
    expect(placedAt(l)).toHaveLength(0);
    l.update(2500);
    expect(placedAt(l)).toHaveLength(0);
    l.update(9400);
    expect(placedAt(l), '1,000 m away on the climb: placed or not by the straight-line distance').toHaveLength(Math.hypot(KV.roadPoint(9400).x - viaduct.world!.x, KV.roadPoint(9400).z - viaduct.world!.z) <= 1050 ? 1 : 0);
  });

  it('is placed on the Raven Scar route too, in that route’s own frame (moved by the start)', async () => {
    const scar = stageById('kestrel-vale-raven-scar');
    setStage(scar);
    const l = new Landmarks();
    const k = scar.landmarks.find((m) => m.model === 'stone-viaduct')!;
    const isViaduct = (c: THREE.Object3D) => Math.abs(c.position.x - k.world!.x) < 1 && Math.abs(c.position.z - k.world!.z) < 1;
    await vi.waitFor(() => { l.update(0); expect(l.group.children.some(isViaduct)).toBe(true); }, { timeout: 4000, interval: 50 }).catch(() => undefined); // (the keep, a model, is placed at once; the viaduct waits for the monuments chunk)
    const obj = l.group.children.find(isViaduct);
    expect(obj, 'placed from the start of the climb').toBeDefined();
    expect(obj!.position.y).toBeCloseTo(k.world!.y, 6);
  });

  it('keeps trees off the viaduct by its own position (nearLandmark), whatever road is nearest to the tree', () => {
    setStage(stageById('kestrel-vale-loop'));
    const { x, z } = viaduct.world!;
    expect(nearLandmark(x, z, 0), 'on the viaduct, with a far-away course distance').toBe(true);
    expect(nearLandmark(x + 90, z, 4000)).toBe(true);
    expect(nearLandmark(x + viaduct.clearance + 40, z, 8000)).toBe(false);
  });
});

describe('the hero models through the real Landmarks class', () => {
  afterEach(() => setStage(stageById(null)));
  const find = (stage: ReturnType<typeof stageById>, f: string) => stage.landmarks.find((k) => k.file === f)!;
  const settleFile = async (l: Landmarks, d: number, test: (o: THREE.Object3D) => boolean) => {
    await vi.waitFor(() => { l.update(d); expect(l.group.children.some(test)).toBe(true); }, { timeout: 4000, interval: 50 });
    return l.group.children.find(test)!;
  };

  it('stands Raven Keep 20 m tall at its world position, turned to face the zigzag, only while the rider is within 1,050 m, and keeps trees off it', async () => {
    const loop = stageById('kestrel-vale-loop');
    setStage(loop);
    const k = find(loop, 'raven-keep.glb');
    const l = new Landmarks();
    const at = (o: THREE.Object3D) => Math.abs(o.position.x - k.world!.x) < 1 && Math.abs(o.position.z - k.world!.z) < 1;
    const obj = await settleFile(l, 8000, at);
    expect(obj.position.y).toBeCloseTo(k.world!.y, 6);
    expect(obj.rotation.y).toBeCloseTo(k.world!.yaw, 6);
    const box = new THREE.Box3().setFromObject(obj);
    expect(box.min.y, 'on its origin').toBeCloseTo(k.world!.y, 3);
    expect(box.max.y - box.min.y, 'its size').toBeCloseTo(20, 2);
    expect(box.max.x - box.min.x).toBeLessThan(20);
    l.update(1000); // the village, 4 km off
    expect(l.group.children.some(at)).toBe(false);
    expect(nearLandmark(k.world!.x + 25, k.world!.z, 0), 'no tree within its clear zone').toBe(true);
  });

  it('stands the keep on the real ground: the terrain the game builds there is level under it (within 2 m) and the origin is at its lowest, the road’s own height untouched', () => {
    const loop = stageById('kestrel-vale-loop');
    setStage(loop);
    const k = KV.keep;
    const ground = groundSampler(k.x - 60, k.x + 60, k.z - 60, k.z + 60);
    const under = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => ground(k.x + (i * k.footprint.w) / 2, k.z + (j * k.footprint.d) / 2)));
    expect(Math.max(...under) - Math.min(...under), 'level under the footprint').toBeLessThan(2.5);
    expect(k.y, 'the origin is at the lowest of it').toBeGreaterThan(Math.min(...under) - 2.5);
    expect(k.y).toBeLessThan(Math.min(...under) + 0.5);
    // The crag stands well above the slope below it.
    expect(ground(k.x, k.z) - ground(k.x + 110, k.z + 110)).toBeGreaterThan(15);
  });

  it('puts the inn on the left of the high street with its front to the road, and the boathouse and the keep in the world, on routes that start partway round', async () => {
    const lakeside = stageById('kestrel-vale-lakeside');
    setStage(lakeside);
    const l = new Landmarks();
    const kInn = find(lakeside, 'hollins-cross-inn.glb');
    const p = roadPoint(kInn.first);
    const px = p.x - Math.sin(p.heading) * kInn.offset * kInn.side, pz = p.z + Math.cos(p.heading) * kInn.offset * kInn.side; // left of the road
    const inn = await settleFile(l, kInn.first - 100, (o) => Math.hypot(o.position.x - px, o.position.z - pz) < 1);
    const box = new THREE.Box3().setFromObject(inn);
    expect(box.max.y - box.min.y).toBeCloseTo(10.5, 2);
    // Its front (the model's +z, towards (sin yaw, cos yaw)) faces the road: it points at the road point across from it.
    const fx = Math.sin(inn.rotation.y), fz = Math.cos(inn.rotation.y);
    expect(fx * (p.x - px) + fz * (p.z - pz), 'the front faces the road').toBeCloseTo(kInn.offset, 1);
    const kBoat = find(lakeside, 'kestrel-boathouse.glb');
    const boat = await settleFile(l, kBoat.first - 60, (o) => Math.abs(o.position.x - kBoat.world!.x) < 1 && Math.abs(o.position.z - kBoat.world!.z) < 1);
    expect(boat.rotation.y).toBeCloseTo(kBoat.world!.yaw, 6);
    expect(new THREE.Box3().setFromObject(boat).max.y - boat.position.y).toBeCloseTo(8.5, 2);
  });
});
