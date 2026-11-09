// The Vercel functions in api/ run the app's own TypeScript files one by one as Node ES modules, not bundled. Node
// needs every relative import's `.js` extension, and src/stages.ts (with the whole 3D world behind it) is far too
// heavy for a function anyway. This walks every import the functions reach and checks both, so a missing extension
// fails here instead of as a crashed /api/ai on Vercel (the coach and the climb guide answering "taking a break").
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAGES } from '../../src/stages';
import { STAGE_SUGGESTIONS } from '../../src/ai/stageSuggestions';

/** Value imports and re-exports (type-only ones are erased) of relative paths in a TypeScript file. */
function relativeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) if (!m[1]) out.push(m[2]);
  return out;
}

function apiEntryFiles(dir = 'api'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? apiEntryFiles(p) : p.endsWith('.ts') && !p.endsWith('.d.ts') ? [p] : [];
  });
}

describe('what the Vercel functions import', () => {
  it('uses .js on every relative import they reach, never reaches src/stages.ts, and every file exists', () => {
    const seen = new Set<string>();
    const problems: string[] = [];
    const queue = apiEntryFiles();
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of relativeImports(file)) {
        const where = `${file} imports '${spec}'`;
        if (!spec.endsWith('.js')) { problems.push(`${where}: add .js`); continue; }
        const target = relative(process.cwd(), resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
        if (target === join('src', 'stages.ts')) { problems.push(`${where}: src/stages.ts is too heavy for a function`); continue; }
        if (!existsSync(target)) { problems.push(`${where}: no such file ${target}`); continue; }
        queue.push(target);
      }
    }
    expect(problems).toEqual([]);
    expect(seen.has(join('src', 'ai', 'catalogue.ts'))).toBe(true); // the walk really reaches the app's files
  });

  it('suggests exactly the whole stages src/stages.ts has (paste the printed rows into src/ai/stageSuggestions.ts if not)', () => {
    const want = STAGES.filter((s) => s.finish !== null && !s.tourStage).map((s) => ({
      id: s.id, name: s.name, about: `${((s.finish ?? 0) / 1000).toFixed(1)} km. ${s.tagline}`.slice(0, 140),
    }));
    const q = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const rows = want.map((r) => `  { id: ${q(r.id)}, name: ${q(r.name)}, about: ${q(r.about)} },`).join('\n');
    expect(STAGE_SUGGESTIONS, `src/ai/stageSuggestions.ts should read:\n${rows}`).toEqual(want);
  });
});
