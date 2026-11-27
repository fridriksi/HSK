import { Workbook, type Cell, type CellValue } from 'exceljs';
import { MAX_RECORD_CELLS, MAX_RECORD_FILE, MAX_RECORD_JSON, type RecordSheet, type RecordTable } from './record-books';

const BIRTH = new Set(['fd', 'fædd', 'fæddur', 'fæðingard', 'fæðingardagur', 'fæðingarár']);
const FIELDS = new Set(['grein', 'nafn', 'nöfn', 'nafn keppanda', 'árangur', 'tími', 'vindur', 'wma%', 'aldur', 'flokkur', 'félag', 'staður', 'dags', 'dagsetning', 'met sett', 'ath', 'athugasemdir', ...BIRTH]);
const GROUP = /^(?:karlar|konur|piltar|stúlkur|drengir|stelpur|strákar|karlaflokkur|kvennaflokkur|piltaflokkur|stúlknaflokkur|bæði kyn)\b/i;
const DATE = /^(\d{1,2})[./-](\d{1,2})[./-]((?:18|19|20)\d{2})$/;
const CLOCK_FORMAT = /^(?:\[h\]|h{1,2}|m{1,2}):[ms]{2}/i;

const field = (s: string) => s.trim().toLocaleLowerCase('is').replace(/[.\s]+/g, ' ').trim().replace(/^f d$/, 'fd');
const clean = (s: string) => s.replace(/\r\n?/g, '\n').trim();
const trimmed = (row: string[]) => { while (row.length && !row[row.length - 1]) row.pop(); return row; };
const pad = (n: number) => String(n).padStart(2, '0');

function dateText(value: Date) {
  return `${pad(value.getUTCDate())}.${pad(value.getUTCMonth() + 1)}.${value.getUTCFullYear()}`;
}

function numberText(value: number, format: string) {
  const fmt = format.toLowerCase().split(';')[0];
  if (CLOCK_FORMAT.test(fmt)) {
    const decimals = fmt.match(/\.(0+)$/)?.[1].length ?? 0;
    const millis = Math.round(value * 86_400_000);
    const seconds = Math.floor(millis / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const fraction = decimals ? ',' + String(millis % 1000).padStart(3, '0').slice(0, decimals) : '';
    if (fmt.startsWith('m')) return `${minutes}:${pad(seconds % 60)}${fraction}`;
    return `${hours}:${pad(minutes % 60)}${fmt.includes('ss') ? ':' + pad(seconds % 60) + fraction : ''}`;
  }
  const decimals = fmt.match(/\.([0]+)/)?.[1].length;
  const percent = fmt.includes('%');
  if (percent || decimals !== undefined) return (value * (percent ? 100 : 1)).toFixed(Math.min(12, decimals ?? 0)).replace('.', ',') + (percent ? '%' : '');
  return String(value).replace('.', ',');
}

function cellText(value: CellValue, format: string, date1904: boolean): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (CLOCK_FORMAT.test(format)) {
      const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
      return numberText((value.getTime() - epoch) / 86_400_000, format);
    }
    return dateText(value);
  }
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'number') return numberText(value, format);
  if (typeof value === 'boolean') return value ? 'Já' : 'Nei';
  if ('result' in value) return cellText(value.result, format, date1904);
  if ('richText' in value) return clean(value.richText.map((item) => item.text).join(''));
  if ('text' in value) return clean(value.text);
  return 'error' in value ? value.error : '';
}

function display(cell: Cell, date1904: boolean) {
  if (cell.isMerged && cell.master.address !== cell.address) return '';
  return cellText(cell.value, cell.numFmt || 'General', date1904);
}

function isHeader(row: string[]) {
  return row.filter((s) => FIELDS.has(field(s))).length >= 2;
}

function structure(rows: string[][]): Omit<RecordSheet, 'name'> {
  const notes: string[][] = [];
  const sections: RecordTable[] = [];
  let current: RecordTable | undefined;
  let title = '';
  const hasHeaders = rows.some(isHeader);
  for (const [i, row] of rows.entries()) {
    const group = row.length === 1 && GROUP.test(row[0]);
    const next = rows[i + 1] ?? [];
    if (isHeader(row)) {
      const headers = [...row];
      if (!row[0] || GROUP.test(row[0])) {
        title = row[0] || title;
        headers[0] = 'Grein';
      }
      current = { title, headers, rows: [] };
      sections.push(current);
      title = '';
    } else if (row.length === 1 && (group || (isHeader(next) && !DATE.test(row[0]) && !GROUP.test(next[0] ?? '')))) {
      if (current && !isHeader(next)) {
        current = { title: row[0], headers: [...current.headers], rows: [] };
        sections.push(current);
      } else {
        title = row[0];
      }
    } else if (current) {
      current.rows.push(row);
    } else if (hasHeaders || row.length === 1) {
      notes.push(row);
    } else {
      current = { title, headers: [], rows: [row] };
      sections.push(current);
    }
  }
  for (const table of sections) {
    const sourceHeaders = table.headers;
    const width = Math.max(sourceHeaders.length, ...table.rows.map((r) => r.length));
    table.headers = Array.from({ length: width }, (_, col) => {
      const h = sourceHeaders[col];
      return h ? (BIRTH.has(field(h)) ? 'Fæðingarár' : h) : `Dálkur ${col + 1}`;
    });
    table.rows = table.rows.map((row) => trimmed(row.map((value, col) => {
      const header = field(sourceHeaders[col] ?? '');
      if (BIRTH.has(header)) return (value.match(/\b(?:18|19|20)\d{2}\b/g) ?? []).join(' / ');
      // Einkadagar í ómerktum dálkum geta verið fæðingardagar.
      const date = DATE.exec(value);
      return date && !['met sett', 'dags', 'dagsetning'].includes(header) ? date[3] : value;
    })));
  }
  return { notes, sections: sections.filter((section) => section.rows.length) };
}

export async function importRecordBook(file: Blob) {
  if (file.size > MAX_RECORD_FILE) throw new Error('Metaskrá má vera að hámarki 5 MB.');
  const workbook = new Workbook();
  try { await workbook.xlsx.load(await file.arrayBuffer()); }
  catch { throw new Error('Ekki tókst að lesa Excel-skrána. Opnaðu hana í Excel og vistaðu aftur sem .xlsx.'); }
  const sheets: RecordSheet[] = [];
  let cells = 0;
  workbook.eachSheet((sheet) => {
    if (sheet.state !== 'visible') return;
    if (sheets.length >= 50 || sheet.rowCount > 2500 || sheet.columnCount > 64) throw new Error('Metaskráin hefur of mörg blöð, raðir eða dálka.');
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      if (row.hidden) return;
      const values: string[] = [];
      row.eachCell((cell, col) => {
        if (!sheet.getColumn(col).hidden) values[col - 1] = display(cell, !!workbook.properties.date1904);
      });
      const filled = trimmed(Array.from(values, (value) => value ?? ''));
      cells += filled.length;
      if (cells > MAX_RECORD_CELLS || filled.some((value) => value.length > 4096)) throw new Error('Metaskráin inniheldur of mikið efni.');
      if (filled.length) rows.push(filled);
    });
    if (rows.length) sheets.push({ name: sheet.name, ...structure(rows) });
  });
  if (!sheets.some((sheet) => sheet.sections.length)) throw new Error('Engin gögn fundust í sýnilegum töflum metaskrárinnar.');
  const json = JSON.stringify(sheets);
  if (new TextEncoder().encode(json).length > MAX_RECORD_JSON) throw new Error('Metaskráin inniheldur of mikið efni.');
  return json;
}
