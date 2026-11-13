// Rewrites the Content-Security-Policy-Report-Only value in vercel.json from csp.mjs and index.html.
// Run it after changing either (tests/unit/csp.test.ts fails when vercel.json is out of step).
import { readFileSync, writeFileSync } from 'node:fs';
import { CSP_HEADER, buildCsp } from '../csp.mjs';

const root = new URL('../', import.meta.url);
const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
const policy = buildCsp(readFileSync(new URL('index.html', root), 'utf8'));
const headers = vercel.headers.find((h) => h.source === '/(.*)').headers;
const entry = headers.find((h) => h.key === CSP_HEADER);
if (entry) entry.value = policy;
else headers.push({ key: CSP_HEADER, value: policy });
// One header per line, as the file is written by hand.
const text = JSON.stringify(vercel, null, 2).replace(/\{\n\s+"key": (.*),\n\s+"value": (.*)\n\s+\}/g, '{ "key": $1, "value": $2 }');
writeFileSync(new URL('vercel.json', root), text + '\n');
console.log(`${CSP_HEADER} updated in vercel.json`);
