// Lists every fixed coach and rival line for the voice generator, and keeps src/ai/voiceClips.ts in step with the
// clips on disk.
//   node scripts/voice-lines.mjs           write scripts/.cache/voice-lines.json: [{ speaker, text, key, file }]
//   node scripts/voice-lines.mjs --sync    rewrite src/ai/voiceClips.ts from public/audio/voices/<speaker>/<slug>.mp3
// The lines come from src/ai/voiceLines.ts, loaded through Vite so the TypeScript needs no build step.

import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sync = process.argv.includes('--sync');

const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
try {
  const { allVoiceLines } = await server.ssrLoadModule('/src/ai/voiceLines.ts');
  const lines = allVoiceLines();
  if (sync) {
    const dir = join(root, 'public/audio/voices');
    const known = new Set(lines.map((l) => l.key));
    const have = [];
    const stale = [];
    for (const speaker of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []) {
      for (const f of readdirSync(join(dir, speaker)).filter((n) => n.endsWith('.mp3'))) {
        const key = `${speaker}/${f.slice(0, -4)}`;
        (known.has(key) ? have : stale).push(key);
      }
    }
    have.sort();
    const body = have.map((k) => `  '${k}',\n`).join('');
    writeFileSync(join(root, 'src/ai/voiceClips.ts'), `// The voice clips that have been recorded: \`speaker/slug\` keys (see voiceLines.ts) of the files in
// public/audio/voices/. GENERATED: do not edit; regenerate with \`npm run voices:sync\` after adding clips.
// Only lines in this set are played from a file; every other line is spoken by the browser's own voice.

export const VOICE_CLIPS: ReadonlySet<string> = new Set<string>([
${body}]);
`);
    console.log(`voiceClips.ts: ${have.length} of ${lines.length} lines recorded${stale.length ? `; ignored ${stale.length} clip(s) that match no current line: ${stale.join(', ')}` : ''}`);
  } else {
    const out = join(root, 'scripts/.cache/voice-lines.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(lines, null, 2)}\n`);
    const per = {};
    for (const l of lines) per[l.speaker] = (per[l.speaker] ?? 0) + 1;
    console.log(`${lines.length} lines -> scripts/.cache/voice-lines.json`, per);
  }
} finally {
  await server.close();
}
