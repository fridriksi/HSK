// Býr til src/static-files.ts úr public/ svo fastar skrár (CSS, JS, merki) séu hluti af Worker-kóðanum.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const out = {};
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor') walk(p); continue; }
    const type = TYPES[extname(f)];
    if (!type) continue;
    out['/' + p.slice('public/'.length)] = { type, b64: readFileSync(p).toString('base64') };
  }
}
walk('public');
writeFileSync('src/static-files.ts',
  '// Sjálfvirkt búið til af scripts/build-static.mjs. Ekki breyta handvirkt.\n' +
  `export const FILES: Record<string, { type: string; b64: string }> = ${JSON.stringify(out)};\n`);
console.log(`${Object.keys(out).length} fastar skrár settar í src/static-files.ts`);
