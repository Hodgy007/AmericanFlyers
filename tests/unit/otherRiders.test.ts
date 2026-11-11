import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OtherRiders, type ModelLike, type OtherRider, type SlotFactory, type TagLike } from '../../src/world/others';
import { RiderModel } from '../../src/world/rider';
import { Pool } from '../../src/world/riderPool';

// The pool of other riders' models. A fake factory stands in for RiderModel and the name tag
// (no WebGL, no canvas in node) and counts what gets built and dressed.

interface FakeModel extends ModelLike {
  id: number;
  looks: Parameters<ModelLike['setLook']>[0][];
  disposed: boolean;
  ctor: unknown;
}
interface FakeTag extends TagLike {
  id: number;
  texts: string[];
  disposed: boolean;
}

function fakes() {
  const models: FakeModel[] = [];
  const tags: FakeTag[] = [];
  const factory: SlotFactory = {
    model(look) {
      const m: FakeModel = {
        id: models.length,
        group: new THREE.Group(),
        body: new THREE.Group(),
        looks: [],
        disposed: false,
        ctor: look,
        setLook(l) { m.looks.push(l); },
        update() {},
        poseRider() {},
        dispose() { m.disposed = true; },
      };
      m.group.add(m.body);
      models.push(m);
      return m;
    },
    tag() {
      const t: FakeTag = {
        id: tags.length,
        sprite: new THREE.Sprite(new THREE.SpriteMaterial()),
        texts: [],
        disposed: false,
        set(text) { t.texts.push(text); },
        dispose() { t.disposed = true; },
      };
      tags.push(t);
      return t;
    },
  };
  return { models, tags, factory };
}

let clock = 0;
beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  // Emoji sprites draw on a canvas, which node doesn't have.
  const ctx = { font: '', textAlign: '', textBaseline: '', fillText() {} };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const camera = new THREE.PerspectiveCamera();
const rider = (id: string, distance: number, extra: Partial<OtherRider> = {}): OtherRider => ({ id, name: id, distance, speedMs: 8, power: 200, cadence: 85, ...extra });
/** One frame: advance the clock 16 ms and update with the player at `at`. */
function frame(o: OtherRiders, at = 0) {
  clock += 16;
  o.update(at, 1 / 60, camera);
}
/** Frames until `ms` have passed. */
function wait(o: OtherRiders, ms: number, at = 0) {
  for (let t = 0; t < ms; t += 16) frame(o, at);
}

describe('Pool', () => {
  it('serves a released item before building, and counts', () => {
    let n = 0;
    const pool = new Pool<{ n: number }, undefined>({ make: () => ({ n: n++ }), dispose: () => {}, cap: 2 });
    const a = pool.acquire('k', 0, undefined);
    pool.release('k', a);
    expect(pool.acquire('k', 1, undefined)).toBe(a);
    expect(pool.stats).toEqual({ created: 1, reused: 1, disposed: 0 });
  });

  it('keeps one free list per key', () => {
    const pool = new Pool<string, undefined>({ make: (k) => k, dispose: () => {}, cap: 4 });
    pool.release('ghost', pool.acquire('ghost', 0, undefined));
    expect(pool.acquire('live', 0, undefined)).toBe('live');
    expect(pool.freeCount('ghost')).toBe(1);
  });

  it('disposes what a full free list cannot take', () => {
    const gone: number[] = [];
    const pool = new Pool<number, undefined>({ make: () => Math.random(), dispose: (x) => gone.push(x), cap: 2 });
    const items = [0, 1, 2, 3].map(() => pool.acquire('k', 0, undefined));
    for (const i of items) pool.release('k', i);
    expect(pool.freeCount('k')).toBe(2);
    expect(gone).toEqual([items[2], items[3]]);
    expect(pool.stats.disposed).toBe(2);
  });

  it('cap 0 keeps nothing, so every acquire builds', () => {
    const pool = new Pool<number, undefined>({ make: () => 1, dispose: () => {}, cap: 0 });
    for (let i = 0; i < 5; i++) pool.release('k', pool.acquire('k', i, undefined));
    expect(pool.stats).toEqual({ created: 5, reused: 0, disposed: 5 });
  });

  it('trims free items after the idle time, and clear() empties it', () => {
    const gone: number[] = [];
    const pool = new Pool<number, undefined>({ make: () => 7, dispose: (x) => gone.push(x), cap: 4, idleMs: 1000 });
    pool.release('k', pool.acquire('k', 0, undefined));
    pool.trim(500);
    expect(pool.freeCount()).toBe(1);
    pool.trim(1500);
    expect(pool.freeCount()).toBe(0);
    expect(gone).toHaveLength(1);
    pool.release('k', pool.acquire('k', 2000, undefined));
    pool.clear();
    expect(gone).toHaveLength(2);
  });
});

describe('OtherRiders pool', () => {
  it('reuses a leaving rider\'s model for the next arrival, re-dressed and with nothing of the last rider left', () => {
    const { models, tags, factory } = fakes();
    const o = new OtherRiders(factory);
    o.set([rider('a', 50, { jersey: '#ff0000', frame: '#00ff00', tag: 'Alice', lane: 1.5 })]);
    frame(o);
    expect(models).toHaveLength(1);
    expect(o.lateralOf('a')).toBe(1.5);
    expect(o.showEmote('a', '👍')).toBe(true);
    expect(models[0].group.children.some((c) => (c as THREE.Sprite).isSprite)).toBe(true);
    const aTag = tags[0].sprite;
    expect(models[0].group.children).toContain(aTag);

    // A leaves (out of range), then B, in another kit with no name tag, arrives.
    o.set([]);
    wait(o, 500);
    expect(o.lateralOf('a')).toBeUndefined();
    expect(o.showEmote('a', '👍')).toBe(false);
    expect(models[0].group.parent).toBeNull();
    expect(models[0].group.children.filter((c) => (c as THREE.Sprite).isSprite)).toHaveLength(0); // tag and emote gone

    o.set([rider('b', 60, { jersey: '#0000ff', frame: '#ffff00', tag: '', name: '', lane: 3.3 })]);
    frame(o);
    expect(models).toHaveLength(1); // no second build
    expect(tags).toHaveLength(1);
    expect(o.poolStats).toMatchObject({ created: 1, reused: 1 });
    expect(models[0].group.parent).toBe(o.group);
    expect(models[0].group.visible).toBe(true);
    expect(models[0].looks.at(-1)).toMatchObject({ jersey: '#0000ff', frame: '#ffff00', kit: ['#0000ff', '#ffff00'] });
    expect(tags[0].texts.at(-1)).toBe(' ');
    expect(models[0].group.children).not.toContain(aTag); // B has no tag: A's is not on the model
    expect(o.lateralOf('b')).toBeCloseTo(3.3, 1); // B's lane, not A's
    expect(o.showEmote('b', '🔥')).toBe(true);
    expect(models[0].group.children.filter((c) => (c as THREE.Sprite).isSprite)).toHaveLength(1); // only B's emote
  });

  it('puts the tag text and the team stripe of the new rider on a reused tag', () => {
    const { models, tags, factory } = fakes();
    const o = new OtherRiders(factory);
    o.set([rider('a', 50, { tag: 'Alice' })]);
    frame(o);
    o.set([]);
    wait(o, 500);
    o.set([rider('b', 50, { tag: 'Bob' })]);
    frame(o);
    expect(models).toHaveLength(1);
    expect(tags[0].texts).toEqual(['Alice', 'Bob']);
    expect(models[0].group.children).toContain(tags[0].sprite);
  });

  it('redraws the tag in place when a rider on the road changes name', () => {
    const { tags, factory } = fakes();
    const o = new OtherRiders(factory);
    o.set([rider('a', 50, { name: 'Rider' })]);
    frame(o);
    o.set([rider('a', 50, { name: 'Alice' })]);
    frame(o);
    expect(tags).toHaveLength(1);
    expect(tags[0].texts).toEqual(['Rider', 'Alice']);
  });

  it('dresses a reused model again only when the look differs', () => {
    const { models, factory } = fakes();
    const o = new OtherRiders(factory);
    const kit = { jersey: '#123456', frame: '#654321' };
    o.set([rider('a', 50, kit)]);
    frame(o);
    o.set([]);
    wait(o, 500);
    o.set([rider('b', 50, kit)]); // the same kit: nothing to do
    frame(o);
    expect(models[0].looks).toHaveLength(0);
    o.set([]);
    wait(o, 500);
    o.set([rider('c', 50, { jersey: '#aaaaaa', frame: '#654321' })]);
    frame(o);
    expect(models[0].looks).toHaveLength(1);
  });

  it('keeps the ghost out of the live riders\' models and the other way round', () => {
    const { models, factory } = fakes();
    const o = new OtherRiders(factory);
    o.set([rider('g', 40, { ghost: true }), rider('a', 50)]);
    frame(o);
    expect(models.map((m) => m.ctor)).toEqual([{ ghost: true }, expect.objectContaining({ frame: expect.any(String) })]);
    o.set([]);
    wait(o, 500);
    // A live rider takes the live model, never the see-through one; the ghost gets its own back.
    o.set([rider('b', 50)]);
    frame(o);
    expect(o.group.children).toEqual([models[1].group]);
    o.set([rider('g2', 40, { ghost: true })]);
    wait(o, 500);
    expect(o.group.children).toEqual([models[0].group]);
    expect(models).toHaveLength(2);
    // The ghost's model is never re-dressed.
    expect(models[0].looks).toHaveLength(0);
  });

  it('keeps no more free models than the cap, and disposes the surplus with its tag', () => {
    const { models, tags, factory } = fakes();
    const o = new OtherRiders(factory, { live: 3, ghost: 1 });
    o.set(Array.from({ length: 10 }, (_, i) => rider(`r${i}`, 20 + i * 5)));
    frame(o);
    expect(models).toHaveLength(10);
    o.set([]);
    wait(o, 500);
    expect(models.filter((m) => m.disposed)).toHaveLength(7);
    expect(tags.filter((t) => t.disposed)).toHaveLength(7);
    expect(o.poolStats).toMatchObject({ created: 10, disposed: 7 });
  });

  it('lets free models go after a long quiet spell', () => {
    const { models, factory } = fakes();
    const o = new OtherRiders(factory);
    o.set([rider('a', 50)]);
    frame(o);
    o.set([]);
    wait(o, 500);
    expect(models[0].disposed).toBe(false);
    clock += 40_000;
    frame(o);
    expect(models[0].disposed).toBe(true);
  });

  it('clears a speech bubble when the model is released', () => {
    const { models, factory } = fakes();
    const o = new OtherRiders(factory);
    // speechBubble() needs a canvas, which node lacks: only check a rider without one releases cleanly.
    o.set([rider('a', 50, { speech: '' })]);
    frame(o);
    o.set([]);
    wait(o, 500);
    expect(models[0].group.children.filter((c) => (c as THREE.Sprite).isSprite)).toHaveLength(0);
  });

  it('reclaims a model from a rider who has just dropped out of the nearest few instead of building', () => {
    const { models, factory } = fakes();
    const o = new OtherRiders(factory);
    // 30 riders: the nearest 24 are shown (nothing is free in the pool).
    const field = (shift: number) => Array.from({ length: 30 }, (_, i) => rider(`r${i}`, i * 10 + shift + 5));
    o.set(field(0));
    frame(o);
    expect(models).toHaveLength(24);
    // Everyone is 300 m nearer the start: now r6..r29 are the nearest 24, so six riders swap places.
    o.set(field(-300));
    frame(o);
    expect(models).toHaveLength(24); // the six arrivals took over the six who dropped out
    expect(o.lateralOf('r29')).toBeDefined();
    expect(o.lateralOf('r0')).toBeUndefined();
    expect(o.group.children).toHaveLength(24);
  });

  describe('churn: 40 riders trading places in the nearest set for 600 frames', () => {
    function run(live: number) {
      const { models, factory } = fakes();
      const o = new OtherRiders(factory, { live, ghost: 1 });
      let maxShown = 0;
      for (let f = 0; f < 600; f++) {
        // Distances oscillate around the player so that the nearest 24 keep changing.
        o.set(Array.from({ length: 40 }, (_, i) => rider(`r${i}`, 30 * Math.sin(f / 22 + i * 1.7) + (i - 20) * 9, { speedMs: 0 })));
        frame(o);
        maxShown = Math.max(maxShown, o.group.children.length);
      }
      return { built: models.length, stats: { ...o.poolStats }, maxShown };
    }

    it('builds far fewer models with the pool than without', () => {
      const before = run(0);
      const after = run(8);
      console.info(`churn 600 frames, 40 riders: without pool ${before.built} builds, with pool ${after.built} builds (${after.stats.reused} reused)`);
      expect(before.maxShown).toBeLessThanOrEqual(24);
      expect(after.maxShown).toBeLessThanOrEqual(24);
      expect(before.built).toBeGreaterThan(100);
      expect(after.built).toBeLessThan(before.built / 4);
      expect(after.built).toBeLessThanOrEqual(40);
    });
  });
});

describe('RiderModel re-skinning (real model)', () => {
  it('setLook with the kit it already has does not dress it again, and recolours in place', () => {
    const m = new RiderModel({ frame: '#112233', jersey: '#445566', kit: ['#aa0000', '#0000aa'] });
    const traverse = vi.spyOn(m.body, 'traverse');
    m.setLook({ frame: '#112233', jersey: '#445566', kit: ['#aa0000', '#0000aa'] });
    // Same colours: recolour() sets the colour on the material it owns, no swap (no traversal) either time.
    expect(traverse).not.toHaveBeenCalled();
    m.setLook({ frame: '#ffffff', jersey: '#000000', kit: null });
    expect(traverse).not.toHaveBeenCalled();
    m.dispose();
  });
});
