export type RecordTable = { title: string; headers: string[]; rows: string[][] };
export type RecordSheet = { name: string; notes: string[][]; sections: RecordTable[] };
export type RecordBook = { id: string; title: string; source: string; sheets: RecordSheet[]; updatedAt?: string };

export const RECORDS_PATH = '/mot/hsk-met';
export const MAX_RECORD_FILE = 5 * 1024 * 1024;
export const MAX_RECORD_JSON = 2 * 1024 * 1024;
export const MAX_RECORD_CELLS = 80_000;

export function uploadedRecordKey(source: string) {
  const match = /^\/media\/(uploads\/\d{4}\/\d{2}\/[\w-]+\.xlsx)$/i.exec(source);
  return match ? `private/record-books/v1/${match[1]}.json` : null;
}

export function validateRecordSheets(json: string): RecordSheet[] | null {
  if (!json || new TextEncoder().encode(json).length > MAX_RECORD_JSON) return null;
  let count = 0;
  const str = (value: unknown): value is string => typeof value === 'string' && value.length <= 4096;
  const row = (value: unknown, width: number) => {
    if (!Array.isArray(value) || value.length > width || !value.every(str)) return false;
    count += value.length;
    return count <= MAX_RECORD_CELLS;
  };
  try {
    const sheets = JSON.parse(json);
    if (!Array.isArray(sheets) || !sheets.length || sheets.length > 50) return null;
    let hasData = false;
    for (const sheet of sheets) {
      if (!sheet || !str(sheet.name) || !Array.isArray(sheet.notes) || sheet.notes.length > 100 || !sheet.notes.every((note: unknown) => row(note, 64)) ||
        !Array.isArray(sheet.sections) || sheet.sections.length > 200) return null;
      for (const table of sheet.sections) {
        if (!table || !str(table.title) || !row(table.headers, 64) || !table.headers.length ||
          !Array.isArray(table.rows) || table.rows.length > 2500 || !table.rows.every((r: unknown) => row(r, table.headers.length))) return null;
        if (table.rows.length) hasData = true;
      }
    }
    return hasData ? sheets : null;
  } catch {
    return null;
  }
}
