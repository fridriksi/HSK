import { RECORDS_PATH, type RecordSheet } from './record-books';

export type CatalogueBook = { id: string; category: string; year?: number | null; sheets: RecordSheet[] };
export type RecordResult = {
  key: string;
  event: string;
  result: string;
  athlete: string;
  date: string;
  dateKey: number;
  place: string;
  categories: string[];
  groups: string[];
  book: string;
  sheet: number;
  teammates?: string;
};

export const CATALOGUE_PAGE_SIZE = 50;
export const catalogueSource = ({ book, sheet }: RecordResult) => `${RECORDS_PATH}/skra/${encodeURIComponent(book)}?blad=${sheet}`;
export const formatRecordCount = (count: number) => String(count).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const ICELANDIC = new Intl.Collator('is', { numeric: true, sensitivity: 'base' });
const clean = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const lower = (value: string) => clean(value).toLocaleLowerCase('is');

export function catalogueSearch(value: string) {
  return lower(value).normalize('NFD').replace(/\p{M}/gu, '');
}

function eventLabel(value: string) {
  return clean(value).replace(/\b(\d{1,2})\.(\d{3})\s*(?=[mk]m?\b)/gi, '$1$2 ')
    .replace(/\b(\d+)\s*[×x]\s*(\d+)/gi, '$1×$2').replace(/(\d)\s*(km|m)\b/gi, '$1 $2')
    .replace(/(\d)\s*(kg|gr)\b/gi, '$1 $2').replace(/\s*\*+$/, '');
}

function eventKey(event: string) {
  return lower(event).replace(/\b(\d+)(?:\.(\d+))?(?=\s*kg\b)/g, (_, a, b) => a + (b ? ',' + b : ''))
    .replace(/\bgrindahl\.(?=\s|$)/g, 'grindahlaup')
    .replace(/\b(\d+×\d+ m) (?:hlaup|boðhlaup)\b/g, '$1 boðhlaup')
    .replace(/[\s.]/g, '');
}

function resultKey(value: string) {
  const compact = lower(value).replace(/[\s*]+/g, '').replace(/;/g, ':').replace(/\.$/, '');
  const parts = compact.split(':');
  if (parts.length > 1 && parts.length <= 3 && parts.every((part, i) => i === parts.length - 1 ? /^\d+(?:[.,]\d+)?$/.test(part) : /^\d+$/.test(part))) {
    const seconds = parts.reduce((n, part) => n * 60 + Number(part.replace(',', '.')), 0);
    return String(Math.round(seconds * 10000) / 10000);
  }
  const number = /^([+-]?\d+(?:[.,]\d+)?)(s|sek\.?|m)?$/.exec(compact);
  return number ? String(Number(number[1].replace(',', '.'))) : compact;
}

function dateInfo(value: string) {
  const day = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\.?$/.exec(value);
  const iso = /^(\d{4})-(\d\d)-(\d\d)$/.exec(value);
  const latestYear = new Date().getUTCFullYear() + 1;
  const yearOnly = /^(?:18|19|20)\d\d$/.test(value) && Number(value) <= latestYear;
  if (!day && !iso) return { date: value, dateKey: yearOnly ? Number(value) * 10000 : 0 };
  const year = iso ? Number(iso[1]) : Number(day![3]) + (day![3].length === 2 ? (Number(day![3]) > 40 ? 1900 : 2000) : 0);
  const month = Number(iso ? iso[2] : day![2]);
  const rawDay = Number(iso ? iso[3] : day![1]);
  const check = new Date(Date.UTC(year, month - 1, rawDay));
  if (year < 1850 || year > latestYear || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== rawDay) return { date: value, dateKey: 0 };
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${pad(rawDay)}.${pad(month)}.${year}`, dateKey: year * 10000 + month * 100 + rawDay };
}

function groupLabel(value: string) {
  return clean(value).replace(/\s*·\s*\d+ met\s*$/i, '').replace(/\b(\d+)\s*[-–]\s*(\d+)/g, '$1–$2').replace(/(\d)ára\b/g, '$1 ára')
    .replace(/^(Karlaflokkur|Kvennaflokkur)$/i, (v) => /^karl/i.test(v) ? 'Karlar' : 'Konur');
}

const PLACEHOLDER = /^(?:enginn|engin|ekkert|vantar|óþekkt)\b/i;

function extractBook(book: CatalogueBook) {
  const rows: RecordResult[] = [];
  for (const [sheetIndex, sheet] of book.sheets.entries()) {
    const swimming = book.id === 'garpasund-2019' || /\blaug\b/i.test(sheet.name);
    const course = book.id === 'blaskogaskokk';
    const indoor = /innanh/i.test(book.category + ' ' + sheet.name + ' ' + sheet.notes.flat().slice(0, 2).join(' '));
    const pool = swimming ? /\b(25|50)\s*m/i.exec(sheet.name)?.[1] ?? '' : '';
    const setting = swimming ? `sund-${pool}` : course ? 'blaskogaskokk' : `${book.category === 'Fatlaðir' ? 'flokkun-' : ''}${indoor ? 'innanhuss' : 'utanhuss'}`;
    for (const table of sheet.sections) {
      const heads = table.headers.map((x) => lower(x).replace(/\./g, ''));
      const find = (...keys: string[]) => heads.findIndex((header) => keys.includes(header));
      const athleteCol = find('nafn', 'nöfn', 'nafn keppanda', 'keppandi', 'lið');
      const resultCol = find('árangur', 'tími', 'met', 'vegalengd', 'stig');
      if (resultCol < 0) continue;
      const eventCol = find('grein', 'keppnisgrein');
      const placeCol = find('staður', 'staðsetning', 'leið');
      const dateCol = find('met sett', 'dagsetning', 'dags', 'dagur');
      const groupCol = find('aldur', 'flokkur', 'aldursflokkur');
      let previousEvent = '';
      let previous: RecordResult | undefined;
      const get = (row: string[], col: number) => clean(row[col] ?? '');
      for (const row of table.rows) {
        const event = eventLabel(swimming || course ? table.title : get(row, eventCol < 0 ? 0 : eventCol));
        if (event && !event.startsWith('(')) previousEvent = event;
        const result = get(row, resultCol);
        const athleteText = get(row, athleteCol);
        const athlete = PLACEHOLDER.test(athleteText) ? '' : athleteText;
        if (!result || !/\d/.test(result)) {
          if (!event && previous && athlete && /(?:,|\/|\bog\b)/i.test(athlete) && /(?:boðhlaup|\d+×\d+)/i.test(previous.event) && /\p{L}{2}/u.test(athlete)) previous.teammates ??= athlete;
          if (event) previous = undefined;
          continue;
        }
        const discipline = event || previousEvent;
        if (!discipline || discipline.startsWith('(')) continue;
        const displayedEvent = swimming && pool ? `${discipline} · ${pool} m laug` : course ? `Bláskógaskokk · ${discipline}` : discipline;
        const place = get(row, placeCol);
        const recordedDate = dateInfo(get(row, dateCol));
        const group = groupLabel(swimming ? `${/konur/i.test(sheet.name) ? 'Konur' : 'Karlar'} ${get(row, groupCol)}`.trim() : course ? '' : table.title);
        const extraGroup = groupLabel(swimming ? '' : get(row, groupCol));
        let fallbackGroup = '';
        if (!group && /\d/.test(sheet.name) && /ára|^\d+\s*-\s*\d+$/.test(sheet.name)) fallbackGroup = groupLabel(sheet.name);
        const groups = [...new Set([group || fallbackGroup, extraGroup].filter(Boolean))];
        const name = lower(athlete).replace(/[.*]/g, '');
        const date = recordedDate.dateKey || lower(recordedDate.date);
        const key = JSON.stringify([setting, eventKey(discipline), resultKey(result), name, date, date ? '' : lower(place)]);
        previous = { key, event: displayedEvent, result, athlete, place, ...recordedDate, categories: [book.category], groups, book: book.id, sheet: sheetIndex };
        rows.push(previous);
      }
    }
  }
  return rows;
}

export function mergeCatalogue(rows: RecordResult[]): RecordResult[] {
  const byKey = new Map<string, RecordResult>();
  for (const row of rows) {
    const previous = byKey.get(row.key);
    if (!previous) {
      byKey.set(row.key, { ...row, categories: [...row.categories], groups: [...row.groups] });
      continue;
    }
    for (const category of row.categories) if (!previous.categories.includes(category)) previous.categories.push(category);
    for (const group of row.groups) if (!previous.groups.includes(group)) previous.groups.push(group);
    previous.place ||= row.place;
    previous.teammates ||= row.teammates;
  }
  return [...byKey.values()].sort((a, b) => compareRecords(a, b, 'date', 'desc'));
}

export function buildCatalogue(books: CatalogueBook[]) {
  const rows = [...books].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).flatMap(extractBook);
  return { input: rows.length, rows: mergeCatalogue(rows) };
}

export type RecordSort = 'event' | 'result' | 'athlete' | 'category' | 'date' | 'place';
export type RecordOrder = 'asc' | 'desc';

export function compareRecords(a: RecordResult, b: RecordResult, field: RecordSort, order: RecordOrder) {
  const direction = order === 'asc' ? 1 : -1;
  let delta = 0;
  if (field === 'date') {
    if (!a.dateKey || !b.dateKey) return (a.dateKey ? -1 : b.dateKey ? 1 : 0) || ICELANDIC.compare(a.event, b.event);
    delta = a.dateKey - b.dateKey;
  } else {
    const x = field === 'category' ? a.categories.join(' · ') : a[field];
    const y = field === 'category' ? b.categories.join(' · ') : b[field];
    if (!x || !y) return (x ? -1 : y ? 1 : 0) || ICELANDIC.compare(a.event, b.event);
    if (field === 'result') {
      const nx = Number(resultKey(x)), ny = Number(resultKey(y));
      delta = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : ICELANDIC.compare(x, y);
    } else delta = ICELANDIC.compare(x, y);
  }
  return delta * direction || ICELANDIC.compare(a.event, b.event) || ICELANDIC.compare(a.athlete, b.athlete);
}
