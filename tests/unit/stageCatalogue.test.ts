// src/stageCatalogue.ts holds the light half of every built-in stage whose road loads on demand: what the hub, the schedule and
// the lists show before (or without) the road. This test builds each stage from its module and checks the catalogue against it, so
// a changed name, length or climb can't leave the hub saying the old thing. To rewrite the file:
//   UPDATE_STAGE_CATALOGUE=1 npx vitest run tests/unit/stageCatalogue.test.ts
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageClimb } from '../../src/hub/data';
import { segmentsFor } from '../../src/segments';
import { CATALOGUE, PROFILE_SAMPLES, WORLD_PROFILES, type CatalogueEntry, type StageInfo } from '../../src/stageCatalogue';
import { HEAVY_STAGE_FIELDS, STAGES, isStageLoaded, stageById, stageSource, worldLapProfile, type Stage } from '../../src/stages';

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp + 0; // (+ 0: no -0, which JSON writes as 0)

/** The Stage fields the catalogue carries. */
function infoOf(s: Stage): StageInfo {
  const info: Record<string, unknown> = { ...s };
  for (const k of HEAVY_STAGE_FIELDS) delete info[k];
  if (s.world) { const { lapStage: _l, ...w } = s.world; info.world = w; }
  return JSON.parse(JSON.stringify(info)) as StageInfo;
}

function profileOf(elevationAt: (d: number) => number, span: number): number[] {
  return Array.from({ length: PROFILE_SAMPLES }, (_, i) => round(elevationAt((span * i) / (PROFILE_SAMPLES - 1)), 1));
}

const lazyStages = STAGES.filter((s) => stageSourceIsLazy(s));
function stageSourceIsLazy(s: Stage) { return s.id !== 'heartland' && s.id !== 'route66'; }

async function expected() {
  const entries: Record<string, CatalogueEntry> = {};
  const worlds: Record<string, number[]> = {};
  for (const shell of lazyStages) {
    const built = await stageSource(shell);
    entries[shell.id] = {
      info: infoOf(built),
      climbM: round(stageClimb(built), 2),
      profile: profileOf(built.elevationAt, built.finish ?? 20000),
      segments: segmentsFor(shell).map((g) => g.name),
    };
    if (built.world && !worlds[built.world.id]) worlds[built.world.id] = profileOf(built.world.lapStage().elevationAt, built.world.lap);
  }
  return { entries, worlds };
}

describe('the stage catalogue', () => {
  it('matches the stages (rewrite it with UPDATE_STAGE_CATALOGUE=1)', async () => {
    const { entries, worlds } = await expected();
    if (process.env.UPDATE_STAGE_CATALOGUE) {
      const file = new URL('../../src/stageCatalogue.ts', import.meta.url);
      const head = (await import('node:fs')).readFileSync(file, 'utf8').split('export const CATALOGUE')[0];
      const body = Object.entries(entries).map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)},`).join('\n');
      const wbody = Object.entries(worlds).map(([id, p]) => `  ${JSON.stringify(id)}: ${JSON.stringify(p)},`).join('\n');
      writeFileSync(file, `${head}export const CATALOGUE: Record<string, CatalogueEntry> = {\n${body}\n};\n\n/** One lap of each world, as a profile of PROFILE_SAMPLES points from 0 to the lap's length: the hub's world card. */\nexport const WORLD_PROFILES: Record<string, number[]> = {\n${wbody}\n};\n`);
      return;
    }
    expect(Object.keys(CATALOGUE)).toEqual(Object.keys(entries));
    for (const [id, e] of Object.entries(entries)) {
      expect(CATALOGUE[id].info, id).toEqual(e.info);
      expect(CATALOGUE[id].climbM, id).toBeCloseTo(e.climbM, 2);
      expect(CATALOGUE[id].profile, id).toEqual(e.profile);
      expect(CATALOGUE[id].segments, id).toEqual(e.segments);
    }
    expect(WORLD_PROFILES).toEqual(worlds);
  });

  it('lists every lazily loaded stage in STAGES order, with the same light fields the loaded stage has', () => {
    for (const s of lazyStages) {
      expect(infoOf(s), s.id).toEqual(CATALOGUE[s.id].info);
      expect(isStageLoaded(s)).toBe(true); // tests/unit/setup.ts loaded them
    }
  });

  it('draws the stored profile within a metre or two of the real one', () => {
    for (const s of lazyStages) {
      const stored = elevationFromEntry(s);
      const span = s.finish ?? 20000;
      let worst = 0;
      for (let i = 0; i <= 200; i++) worst = Math.max(worst, Math.abs(stored((span * i) / 200) - s.elevationAt((span * i) / 200)));
      // Between samples the real road wiggles (hairpins, bumps): the thumbnail needs the shape, not the wiggle.
      const range = Math.max(...profileOf(s.elevationAt, span)) - Math.min(...profileOf(s.elevationAt, span));
      expect(worst, s.id).toBeLessThan(Math.max(12, range * 0.15));
    }
    for (const [id, p] of Object.entries(WORLD_PROFILES)) expect(worldLapProfile({ id, lap: 10 })!(0), id).toBe(p[0]);
  });
});

function elevationFromEntry(s: Stage) {
  const p = CATALOGUE[s.id].profile;
  const span = s.finish ?? 20000;
  return (d: number) => { const t = Math.max(0, Math.min(1, d / span)) * (p.length - 1); const i = Math.min(p.length - 2, Math.floor(t)); return p[i] + (p[i + 1] - p[i]) * (t - i); };
}

describe('a stage whose road has not loaded', () => {
  it('has its light fields but throws a clear error for the road, until loadStage() fills it in place', async () => {
    // A second copy of the module, so this does not depend on tests/unit/setup.ts having loaded the real stages.
    const m = await freshStages();
    const s = m.STAGES.find((x) => x.id === 'alpe-dhuez')!;
    expect(m.isStageLoaded(s)).toBe(false);
    expect(s.name).toBe("Alpe d'Huez");
    expect(s.finish).toBe(14000);
    expect(() => s.elevationAt).toThrow(m.StageNotLoadedError);
    expect(() => s.scenery).toThrow(/alpe-dhuez/);
    expect(m.stageProfile(s)(14000)).toBeGreaterThan(900); // the stored profile, no road needed
    expect(Object.keys(s)).not.toContain('elevationAt');
    const { stageFigures } = await import('../../src/hub/data'); // the hub's figures need no road either
    expect(stageFigures(s)).toEqual({ lengthM: 14000, climbM: CATALOGUE['alpe-dhuez'].climbM });
    expect(m.isStageLoaded(s)).toBe(false);
    const loaded = await m.loadStage(s);
    expect(loaded).toBe(s);
    expect(m.isStageLoaded(s)).toBe(true);
    expect(s.elevationAt(14000)).toBeGreaterThan(900);
    expect(stageById('alpe-dhuez').elevationAt(14000)).toBeCloseTo(s.elevationAt(14000), 6);
  });
});

async function freshStages() {
  const { vi } = await import('vitest');
  vi.resetModules();
  return await import('../../src/stages');
}
