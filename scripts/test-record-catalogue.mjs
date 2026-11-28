import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildSync } from 'esbuild';

const [compiled] = buildSync({ entryPoints: ['src/record-catalogue.ts'], format: 'esm', platform: 'node', bundle: true, write: false }).outputFiles;
const { buildCatalogue, compareRecords } = await import(`data:text/javascript;base64,${Buffer.from(compiled.contents).toString('base64')}`);

const book = (id, category, year, title, rows) => ({ id, category, year, sheets: [{
  name: 'Karlar', notes: [], sections: [{ title, headers: ['Grein', 'Árangur', 'Nafn', 'Met sett', 'Staður'], rows }],
}] });

const { rows } = buildCatalogue([
  book('new', 'Utanhúss', 2026, 'Karlar', [
    ['1.500 m hlaup', '3:57,00', 'Jón Jónsson', '12.06.2024', 'Selfoss'],
    ['1.500 m hlaup', '3:57,00', 'Jón Jónsson', '12.06.2025', 'Selfoss'],
    ['1.500 m hlaup', '3:57,00', 'Jón Júlíusson', '12.06.2024', 'Selfoss'],
    ['Hástökk', '', 'enginn með skráðan árangur'], ['Langstökk', '6,74', 'Jón Jónsson', '', 'Selfoss'],
  ]),
  book('old', 'Utanhúss', 2025, 'Piltar 20 - 22 ára', [['1500m hlaup', '3;57.0', 'Jón  Jónsson ', '12/6/24', 'Selfoss']]),
  book('masters', 'Öldungar utanhúss', 2025, 'Karlar 30-34 ára', [['1500 m hlaup', '237,0', 'Jón Jónsson', '2024-06-12', 'Selfoss']]),
  book('indoor', 'Innanhúss', 2025, 'Karlar', [['1500 m hlaup', '3:57,00', 'Jón Jónsson', '12.06.2024', 'Selfoss']]),
]);
assert.equal(rows.length, 5, 'collapse just identical performances across editions and groups');
const combined = rows.find((row) => row.athlete === 'Jón Jónsson' && row.date === '12.06.2024' && row.categories.includes('Utanhúss'));
assert.deepEqual(combined.categories, ['Utanhúss', 'Öldungar utanhúss']);
assert.deepEqual(combined.groups, ['Karlar', 'Piltar 20–22 ára', 'Karlar 30–34 ára']);
assert.equal(combined.book, 'new');
assert.equal(rows[0].date, '12.06.2025');
assert.equal([...rows].sort((a, b) => compareRecords(a, b, 'date', 'asc'))[0].date, '12.06.2024');
assert.equal([...rows].sort((a, b) => compareRecords(a, b, 'date', 'asc')).at(-1).date, '');

const source = JSON.parse(await readFile('src/data/hsk-record-books.json', 'utf8'));
const archive = buildCatalogue(source);
assert.equal(new Set(archive.rows.map((row) => row.key)).size, archive.rows.length);
assert.ok(archive.input > 20_000 && archive.rows.length > 3_000 && archive.rows.length < archive.input);
assert.ok(archive.rows.some((row) => row.event.includes('m laug') && row.book === 'garpasund-2019'));
assert.ok(archive.rows.some((row) => row.book === 'blaskogaskokk'));
assert.ok(archive.rows.some((row) => row.categories.includes('Fatlaðir')));
console.log(`Staðfest: ${archive.rows.length} einstök met úr ${archive.input} færslum.`);
