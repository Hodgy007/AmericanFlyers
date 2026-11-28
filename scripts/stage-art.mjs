// The built-in stages that get a banner picture in the hub's Route section.
//   node scripts/stage-art.mjs --list   write scripts/.cache/stage-art-ids.json: [{ id, name, kind, description }]
//   node scripts/stage-art.mjs --sync   rewrite src/hub/stageArt.ts from the files in public/images/stages/<id>.webp
// A world (Kestrel Vale) is one card with its routes as chips, so it has one id; its routes have none of their own.
// Stages are read through Vite so the TypeScript needs no build step.

import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--sync') ? 'sync' : process.argv.includes('--list') ? 'list' : '';
if (!mode) { console.error('usage: node scripts/stage-art.mjs --list | --sync'); process.exit(1); }

const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
try {
  const { STAGES } = await server.ssrLoadModule('/src/stages.ts');
  const items = [];
  const worlds = new Set();
  for (const s of STAGES) {
    if (!s.world) { items.push({ id: s.id, kind: 'stage', name: s.name, description: s.tagline }); continue; }
    if (worlds.has(s.world.id)) continue;
    worlds.add(s.world.id);
    items.push({ id: s.world.id, kind: 'world', name: s.world.name, description: s.world.tagline });
  }
  if (mode === 'list') {
    const out = join(root, 'scripts/.cache/stage-art-ids.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(items, null, 2)}\n`);
    console.log(`${items.length} ids -> scripts/.cache/stage-art-ids.json: ${items.map((i) => i.id).join(', ')}`);
  } else {
    const dir = join(root, 'public/images/stages');
    const known = new Set(items.map((i) => i.id));
    const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.webp')).map((n) => n.slice(0, -5)) : [];
    const have = files.filter((id) => known.has(id)).sort();
    const stale = files.filter((id) => !known.has(id));
    const body = have.map((k) => `  '${k}',\n`).join('');
    writeFileSync(join(root, 'src/hub/stageArt.ts'), `// The stages and worlds that have banner art: ids (a stage's id, or a world's id for its one card) whose picture is
// in public/images/stages/<id>.webp. GENERATED: do not edit; regenerate with \`npm run stageart:sync\` after adding
// pictures. Only ids in this set are fetched, so a missing picture is never a 404 (see hub/sections/route.ts).

export const STAGE_ART: ReadonlySet<string> = new Set<string>([
${body}]);

/** Where a stage's (or world's) banner is served from. */
export const stageArtUrl = (id: string) => \`/images/stages/\${id}.webp\`;
`);
    console.log(`stageArt.ts: ${have.length} of ${items.length} banners present${stale.length ? `; ignored ${stale.length} file(s) matching no card: ${stale.join(', ')}` : ''}`);
  }
} finally {
  await server.close();
}
