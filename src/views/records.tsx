import recordBooks from '../data/hsk-record-books.json';
import { Icon } from './icons';

type RecordTable = { title: string; headers: string[]; rows: string[][] };
type RecordSheet = { name: string; notes: string[][]; sections: RecordTable[] };
type RecordBook = {
  id: string;
  category: string;
  title: string;
  source: string;
  year: number | null;
  file: string;
  sheets: RecordSheet[];
};

const books: RecordBook[] = recordBooks;
const booksById = new Map(books.map((book) => [book.id, book]));
const bookIdsBySource = new Map(books.flatMap((book) => [[book.file, book.id], [book.source, book.id]]));
export const RECORDS_PATH = '/mot/hsk-met';

export function recordBook(id: string) {
  return booksById.get(id);
}

export function recordLink(file: string) {
  const id = bookIdsBySource.get(file);
  return id ? `${RECORDS_PATH}/skra/${id}` : file || RECORDS_PATH;
}

export const recordEditions = books.map(({ category, title, year, file }) => ({ category, title, year, file }));

function searchable(value: string) {
  return value.toLocaleLowerCase('is').normalize('NFD').replace(/\p{M}/gu, '');
}

function sheetLabel(sheet: RecordSheet) {
  const label = sheet.name.replace(/_/g, ' / ').replace(/(\d)ára/g, '$1 ára');
  return label[0].toLocaleUpperCase('is') + label.slice(1);
}

export function RecordBookView({ book, sheetParam, query }: { book: RecordBook; sheetParam?: string; query?: string }) {
  const defaultIndex = Math.max(0, book.sheets.findIndex((sheet) => /^karlar_konur/i.test(sheet.name)));
  const index = sheetParam && /^\d+$/.test(sheetParam) && book.sheets[Number(sheetParam)] ? Number(sheetParam) : defaultIndex;
  const sheet = book.sheets[index];
  const term = (query ?? '').trim().slice(0, 100);
  const words = searchable(term).split(/\s+/).filter(Boolean);
  const sections = words.length ? sheet.sections.flatMap((table) => {
    const rows = table.rows.filter((row) => {
      const text = searchable([table.title, ...row].join(' '));
      return words.every((word) => text.includes(word));
    });
    return rows.length ? [{ ...table, rows }] : [];
  }) : sheet.sections;
  const detailPath = `${RECORDS_PATH}/skra/${book.id}`;

  return (
    <section class="record-book wrap block">
      <div class="record-book-tools">
        <form class="inline-form record-book-filters" action={detailPath} method="get" role="search" aria-label="Leita í metaskrá">
          <label for="record-sheet">Vinnublað</label>
          <select id="record-sheet" name="blad" aria-label="Vinnublað">
            {book.sheets.map((item, i) => <option value={i} selected={i === index}>{sheetLabel(item)}</option>)}
          </select>
          <label for="record-query">Leit</label>
          <input id="record-query" type="search" name="q" value={term} maxlength={100} placeholder="Nafn eða grein" />
          <button class="btn" type="submit">Sía</button>
          {term && <a href={`${detailPath}?blad=${index}`}>Hreinsa leit</a>}
        </form>
        <a class="record-source" href={book.source}><Icon name="file" /> Upprunaleg Excel-skrá</a>
      </div>
      <h2>{sheetLabel(sheet)}</h2>
      {sheet.notes.length > 0 && <div class="record-notes">{sheet.notes.map((row) => <p>{row.filter(Boolean).join(' · ')}</p>)}</div>}
      {!sections.length && words.length > 0 && <p>Engar færslur fundust í þessu vinnublaði.</p>}
      {sections.map((table) => {
        const label = table.title || sheetLabel(sheet);
        return (
          <section class="record-table-section" aria-label={label}>
            {table.title && <h3>{table.title}</h3>}
            {table.rows.length ? <div class="record-table-scroll" role="region" aria-label={label} tabindex={0}>
              <table class="record-table" aria-label={label}>
                <thead><tr>{table.headers.map((header) => <th scope="col">{header}</th>)}</tr></thead>
                <tbody>{table.rows.map((row) => <tr>{table.headers.map((_, j) =>
                  j === 0 ? <th scope="row">{row[j] || ''}</th> : <td>{row[j] || ''}</td>)}</tr>)}</tbody>
              </table>
            </div> : <p>Engar færslur í þessum flokki.</p>}
          </section>
        );
      })}
    </section>
  );
}
