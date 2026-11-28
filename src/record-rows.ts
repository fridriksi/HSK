// Allar línur í töflunni HSK met: met úr eldri metaskrám, innfluttum Excel-skrám og met skráð í vefumsjón
import { type Env, all } from './lib';
import { RECORD_CATEGORIES } from './content-types';
import { uploadedRecordKey, type RecordSheet } from './record-books';
import { buildCatalogue, mergeCatalogue, type RecordResult } from './record-catalogue';
import { archivedRecords } from './record-catalogue-data';

export async function catalogueRows(env: Env): Promise<RecordResult[]> {
  const rows = await all<{ id: number; category: string; year: number | null; file: string }>(env.DB,
    "SELECT id, category, year, file FROM records WHERE category <> 'reglur' AND file LIKE '/media/uploads/%.xlsx' ORDER BY year DESC, id DESC");
  const books = await Promise.all(rows.map(async (row) => {
    const key = uploadedRecordKey(row.file);
    if (!key) return null;
    const data = await env.MEDIA.get(key);
    if (!data) return null;
    return { id: `innflutt-${row.id}`, category: RECORD_CATEGORIES[row.category] ?? RECORD_CATEGORIES.annad, year: row.year, sheets: await data.json<RecordSheet[]>() };
  }));
  const available = books.filter((book) => book !== null);
  // Met skráð í vefumsjón (Ný met)
  const entries = await all<{ id: number; event: string; result: string; athlete: string; club: string; category: string; age_group: string; date: string; place: string; note: string }>(env.DB,
    'SELECT * FROM record_entries ORDER BY date DESC, id DESC');
  const added: RecordResult[] = entries.map((e) => {
    const [y, m, d] = e.date.split('-').map(Number);
    return {
      key: JSON.stringify(['vefumsjon', e.id]), event: e.event, result: e.result, athlete: e.athlete, place: e.place,
      date: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`, dateKey: y * 10000 + m * 100 + d,
      categories: [RECORD_CATEGORIES[e.category] ?? RECORD_CATEGORIES.annad], groups: e.age_group ? [e.age_group] : [],
      book: '', sheet: 0, entry: e.id, teammates: [e.club, e.note].filter(Boolean).join(' · ') || undefined,
    };
  });
  const base = available.length ? mergeCatalogue([...buildCatalogue(available).rows, ...archivedRecords]) : archivedRecords;
  return added.length ? mergeCatalogue([...added, ...base]) : base;
}

