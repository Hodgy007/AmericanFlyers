// src/startupStage.ts: the stage the app opens on has its road fetched before main.ts runs; a failed fetch falls back to Heartland.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../../src/stages');
  vi.resetModules();
});

async function startup(search: string) {
  vi.stubGlobal('location', { search });
  vi.resetModules();
  return import('../../src/startupStage');
}

describe('chooseStartupStage', () => {
  it('opens on Heartland with no ?stage=, without fetching anything', async () => {
    const m = await startup('');
    await m.chooseStartupStage();
    expect(m.startupStage.id).toBe('heartland');
    expect(m.startupStageFailed).toBeNull();
  });

  it('waits for the asked-for stage’s road, then opens on it', async () => {
    const m = await startup('?stage=stelvio');
    const stages = await import('../../src/stages');
    const stelvio = stages.stageById('stelvio');
    expect(stages.isStageLoaded(stelvio)).toBe(false);
    await m.chooseStartupStage();
    expect(m.startupStage).toBe(stelvio);
    expect(stages.isStageLoaded(stelvio)).toBe(true);
    expect(stelvio.elevationAt(24500)).toBeGreaterThan(1500);
    expect(m.startupStageFailed).toBeNull();
  });

  it('falls back to Heartland, and remembers what was asked for, when the road cannot be fetched', async () => {
    vi.stubGlobal('location', { search: '?stage=ventoux' });
    vi.resetModules();
    const real = await vi.importActual<typeof import('../../src/stages')>('../../src/stages');
    vi.doMock('../../src/stages', () => ({ ...real, loadStage: () => Promise.reject(new Error('offline')) }));
    const m = await import('../../src/startupStage');
    await m.chooseStartupStage();
    expect(m.startupStage.id).toBe('heartland');
    expect(m.startupStageFailed?.id).toBe('ventoux');
  });
});
