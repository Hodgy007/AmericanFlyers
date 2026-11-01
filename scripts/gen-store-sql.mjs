// Prints the SQL that seeds public.store_items from src/garage/catalogue.ts,
// so the database (the source of truth for prices and rules) and the app's
// screens stay in step. Run: node scripts/gen-store-sql.mjs
import { build } from 'esbuild';

const out = await build({ entryPoints: ['src/garage/catalogue.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
const code = out.outputFiles[0].text;
const { ITEMS } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rows = ITEMS.map((i, n) => `  (${q(i.id)}, ${q(i.slot)}, ${q(i.name)}, ${i.price}, ${i.level}, ${q(JSON.stringify(i.unlock ?? {}))}::jsonb, ${q(JSON.stringify(i.effects ?? {}))}::jsonb, ${!!i.starter}, ${n})`);
console.log(`insert into public.store_items (id, slot, name, price, level_req, unlock, effects, starter, sort) values\n${rows.join(',\n')}\non conflict (id) do update set slot = excluded.slot, name = excluded.name, price = excluded.price, level_req = excluded.level_req,\n  unlock = excluded.unlock, effects = excluded.effects, starter = excluded.starter, sort = excluded.sort;`);
