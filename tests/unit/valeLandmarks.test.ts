// Kestrel Vale's stand-apart landmarks (the viaduct, the jetty) through the real Landmarks class: a landmark with `within` is placed only while the rider is
// near it (so it is never seen over terrain that is not built), it is the same on a route that starts partway round, and trees keep off it by position.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { Landmarks, nearLandmark } from '../../src/world/landmarks';
import { KESTREL_VALE, KV } from '../../src/worlds/kestrelVale';

// The model files are not there in a unit test: every GLB is "missing" (skipped), the code-built monuments are what is placed.
vi.mock('../../src/world/gltf', () => ({ gltfLoader: () => ({ load: (_u: string, _ok: unknown, _p: unknown, err: () => void) => err() }) }));

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
    await settle(l, 0);
    const obj = l.group.children.find((c) => Math.abs(c.position.x - k.world!.x) < 1 && Math.abs(c.position.z - k.world!.z) < 1);
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
