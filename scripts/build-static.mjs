// Býr til src/static-files.ts úr public/ svo fastar skrár (CSS, JS, merki) séu hluti af Worker-kóðanum.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';

const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const out = {};
function addAsset(path, type, buf) {
  out[path] = { type, b64: buf.toString('base64'), v: createHash('sha1').update(buf).digest('hex').slice(0, 10) };
}
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor') walk(p); continue; }
    const type = TYPES[extname(f)];
    if (!type) continue;
    const buf = readFileSync(p);
    const assetPath = '/' + relative('public', p).split(sep).join('/');
    addAsset(assetPath, type, buf);
  }
}
walk('public');
const [recordImport] = buildSync({ entryPoints: ['src/record-import.ts'], format: 'esm', platform: 'browser', bundle: true, write: false, minify: true, target: 'es2022' }).outputFiles;
addAsset('/js/record-import.js', TYPES['.js'], Buffer.from(recordImport.contents));
const [catalogueClient] = buildSync({ entryPoints: ['src/record-catalogue-client.mjs'], format: 'esm', platform: 'browser', bundle: true, write: false, minify: true, target: 'es2022' }).outputFiles;
addAsset('/js/record-catalogue.js', TYPES['.js'], Buffer.from(catalogueClient.contents));
const [grantAwardsClient] = buildSync({ entryPoints: ['src/grant-awards-client.mjs'], format: 'esm', platform: 'browser', bundle: true, write: false, minify: true, target: 'es2022' }).outputFiles;
addAsset('/js/grant-awards.js', TYPES['.js'], Buffer.from(grantAwardsClient.contents));
const [catalogueBuilder] = buildSync({ entryPoints: ['src/record-catalogue.ts'], format: 'esm', platform: 'node', bundle: true, write: false }).outputFiles;
const { buildCatalogue } = await import(`data:text/javascript;base64,${Buffer.from(catalogueBuilder.contents).toString('base64')}`);
const records = buildCatalogue(JSON.parse(readFileSync('src/data/hsk-record-books.json', 'utf8')));
writeFileSync('src/record-catalogue-data.ts', `// Unnið úr eldri frumskrám með scripts/build-static.mjs.\nimport type { RecordResult } from './record-catalogue';\nexport const archivedRecords: RecordResult[] = ${JSON.stringify(records.rows)};\n`);
console.log(`${records.rows.length} einstök met úr ${records.input} færslum í eldri skrám.`);
writeFileSync('src/static-files.ts',
  '// Sjálfvirkt búið til af scripts/build-static.mjs. Ekki breyta handvirkt.\n' +
  `export const FILES: Record<string, { type: string; b64: string; v: string }> = ${JSON.stringify(out)};\n`);
console.log(`${Object.keys(out).length} fastar skrár settar í src/static-files.ts`);
