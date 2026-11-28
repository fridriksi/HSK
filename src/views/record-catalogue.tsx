import { RECORDS_PATH } from '../record-books';
import { CATALOGUE_PAGE_SIZE, catalogueSource, formatRecordCount, type RecordResult, type RecordSort } from '../record-catalogue';
import { asset } from '../static';

const columns: [RecordSort, string][] = [['event', 'Grein'], ['result', 'Árangur'], ['athlete', 'Nafn'], ['category', 'Flokkur'], ['date', 'Met sett'], ['place', 'Staður']];

export function RecordCatalogue({ rows, admin = false }: { rows: RecordResult[]; admin?: boolean }) {
  return <section class="record-catalogue" aria-label="Öll HSK met" data-record-catalogue={`${RECORDS_PATH}/gogn`} data-record-admin={admin ? '1' : undefined}>
    <form class="record-catalogue-form" role="search" aria-label="Leita og sía HSK met">
      <fieldset disabled>
        <div class="record-catalogue-field"><label for="records-search">Leit</label><input id="records-search" name="leit" type="search" placeholder="Nafn, grein eða staður" /></div>
        <div class="record-catalogue-field"><label for="records-event">Grein</label><select id="records-event" name="grein"><option value="">Allar greinar</option></select></div>
        <div class="record-catalogue-field"><label for="records-category">Flokkur</label><select id="records-category" name="flokkur"><option value="">Allir flokkar</option></select></div>
        <div class="record-catalogue-field"><label for="records-age">Aldur</label><select id="records-age" name="aldur"><option value="">Allur aldur</option></select></div>
        <div class="record-catalogue-field"><label for="records-year">Ár mets</label><select id="records-year" name="ar"><option value="">Öll ár</option></select></div>
        <label class="record-current check"><input type="checkbox" name="gildandi" value="1" /> Aðeins gild met</label>
        <button type="reset" class="btn ghost">Hreinsa síur</button>
      </fieldset>
    </form>
    <div class="record-catalogue-pages">
      <p role="status" data-record-count>{rows.length ? `1–${Math.min(CATALOGUE_PAGE_SIZE, rows.length)} af ${formatRecordCount(rows.length)} metum` : '0 met'}</p>
      <div><button type="button" class="btn ghost small" data-record-prev disabled>Fyrri síða</button> <button type="button" class="btn ghost small" data-record-next disabled>Næsta síða</button></div>
    </div>
    <div class="record-table-scroll" role="region" aria-label="Tafla yfir HSK met" tabindex={0}>
      <table class="record-table" aria-label="HSK met">
        <thead><tr>{columns.map(([key, label]) => <th scope="col" aria-sort={key === 'date' ? 'descending' : undefined}>
          <button type="button" data-record-sort={key} disabled>{label}</button>
        </th>)}<th scope="col">Heimild</th></tr></thead>
        <tbody>{rows.slice(0, CATALOGUE_PAGE_SIZE).map((row) => <tr>
          <th scope="row">{row.event}</th><td>{row.result}</td>
          <td>{row.athlete || '—'}{row.teammates && <small>{row.teammates}</small>}</td>
          <td>{row.categories.join(' · ')}{row.groups.length > 0 && <small>{row.groups.join(' · ')}</small>}</td>
          <td>{row.date || '—'}</td><td>{row.place || '—'}</td>
          <td>{admin && row.entry ? <a href={`/stjorn/ny-met/${row.entry}`}>Breyta</a> : catalogueSource(row) ? <a href={catalogueSource(row)} aria-label={`Heimild fyrir ${row.event}${row.athlete ? `, ${row.athlete}` : ''}`}>Heimild</a> : <span class="muted">Nýtt met</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <script type="module" src={asset('/js/record-catalogue.js')}></script>
  </section>;
}
