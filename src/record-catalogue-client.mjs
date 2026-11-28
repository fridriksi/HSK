import { CATALOGUE_PAGE_SIZE, catalogueSearch, catalogueSource, compareRecords, currentRecords, formatRecordCount } from './record-catalogue';

const catalogue = document.querySelector('[data-record-catalogue]');
if (catalogue) {
  const controls = catalogue.querySelector('form');
  const search = controls.elements.namedItem('leit');
  const eventFilter = controls.elements.namedItem('grein');
  const category = controls.elements.namedItem('flokkur');
  const age = controls.elements.namedItem('aldur');
  const year = controls.elements.namedItem('ar');
  const onlyCurrent = controls.elements.namedItem('gildandi');
  let current = new Set();
  const body = catalogue.querySelector('tbody');
  const summary = catalogue.querySelector('[data-record-count]');
  const prev = catalogue.querySelector('[data-record-prev]');
  const next = catalogue.querySelector('[data-record-next]');
  const sortButtons = Array.from(catalogue.querySelectorAll('[data-record-sort]'));
  const icelandic = new Intl.Collator('is', { numeric: true });
  let records;
  let activeRows = [];
  let lookup = new Map();
  let sort = 'date';
  let order = 'desc';
  let page = 0;

  const yearOf = (row) => row.dateKey ? String(Math.floor(row.dateKey / 10000)) : '';
  const agesOf = (row) => row.groups.map((group) => /\b(\d+–\d+|\d+\+|\d+ ára)(?=\s|$)/u.exec(group)?.[1]).filter(Boolean)
    .map((group) => group.endsWith(' ára') ? group : `${group} ára`);

  function cell(tr, text, header = false) {
    const td = document.createElement(header ? 'th' : 'td');
    if (header) td.scope = 'row';
    td.textContent = text || '—';
    tr.append(td);
    return td;
  }

  function resultRow(row) {
    const tr = document.createElement('tr');
    cell(tr, row.event, true);
    cell(tr, row.result);
    const athlete = cell(tr, row.athlete);
    if (row.teammates) {
      const team = document.createElement('small');
      team.textContent = row.teammates;
      athlete.append(team);
    }
    const classes = cell(tr, row.categories.join(' · '));
    if (row.groups.length) {
      const group = document.createElement('small');
      group.textContent = row.groups.join(' · ');
      classes.append(group);
    }
    cell(tr, row.date);
    cell(tr, row.place);
    const source = document.createElement('td');
    const href = catalogueSource(row);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = 'Heimild';
      link.setAttribute('aria-label', `Heimild fyrir ${row.event}${row.athlete ? `, ${row.athlete}` : ''}`);
      source.append(link);
    } else {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = 'Nýtt met';
      source.append(span);
    }
    tr.append(source);
    return tr;
  }

  function render() {
    const start = page * CATALOGUE_PAGE_SIZE;
    const end = Math.min(start + CATALOGUE_PAGE_SIZE, activeRows.length);
    body.replaceChildren(...activeRows.slice(start, end).map(resultRow));
    if (!activeRows.length) {
      const tr = document.createElement('tr');
      cell(tr, 'Engin met fundust með þessari leit.').colSpan = 7;
      body.append(tr);
    }
    summary.textContent = activeRows.length ? `${formatRecordCount(start + 1)}–${formatRecordCount(end)} af ${formatRecordCount(activeRows.length)} metum` : '0 met';
    prev.disabled = page === 0;
    next.disabled = end >= activeRows.length;
    for (const button of sortButtons) {
      const th = button.closest('th');
      if (button.dataset.recordSort === sort) th.setAttribute('aria-sort', order === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    }
  }

  function filter() {
    if (!records) return;
    const words = catalogueSearch(search.value).split(/\s+/).filter(Boolean);
    page = 0;
    activeRows = records.filter((row) => (!onlyCurrent.checked || current.has(row)) && (!eventFilter.value || row.event === eventFilter.value) &&
      (!category.value || row.categories.includes(category.value)) && (!age.value || agesOf(row).includes(age.value)) &&
      (!year.value || yearOf(row) === year.value) && words.every((word) => lookup.get(row).includes(word)));
    if (sort !== 'date' || order !== 'desc') activeRows.sort((a, b) => compareRecords(a, b, sort, order));
    render();
  }

  function setOptions(select, values, reverse = false) {
    const items = [...new Set(values.filter(Boolean))].sort(icelandic.compare);
    if (reverse) items.reverse();
    for (const item of items) select.add(new Option(item, item));
  }

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(filter, 120); });
  for (const select of [eventFilter, category, age, year, onlyCurrent]) select.addEventListener('change', filter);
  controls.addEventListener('submit', (event) => { event.preventDefault(); filter(); });
  controls.addEventListener('reset', () => setTimeout(filter, 0));
  for (const button of sortButtons) button.addEventListener('click', () => {
    const column = button.dataset.recordSort;
    order = column === sort ? (order === 'asc' ? 'desc' : 'asc') : column === 'date' ? 'desc' : 'asc';
    sort = column;
    filter();
  });
  const turn = (by) => {
    page += by;
    render();
    catalogue.querySelector('.record-table-scroll').scrollIntoView({ block: 'nearest' });
    if (by > 0 && next.disabled) prev.focus({ preventScroll: true });
    if (by < 0 && prev.disabled) next.focus({ preventScroll: true });
  };
  prev.addEventListener('click', () => turn(-1));
  next.addEventListener('click', () => turn(1));

  fetch(catalogue.dataset.recordCatalogue).then((res) => {
    if (!res.ok) throw new Error('Metaskrá fannst ekki');
    return res.json();
  }).then((data) => {
    records = data;
    current = currentRecords(records);
    lookup = new Map(records.map((row) => [row, catalogueSearch([row.event, row.athlete, row.teammates, row.place, row.book, ...row.categories, ...row.groups].filter(Boolean).join(' '))]));
    setOptions(eventFilter, records.map((row) => row.event));
    setOptions(category, records.flatMap((row) => row.categories));
    setOptions(age, records.flatMap(agesOf));
    setOptions(year, records.map(yearOf), true);
    controls.querySelector('fieldset').disabled = false;
    for (const button of sortButtons) button.disabled = false;
    filter();
  }).catch(() => { summary.textContent = 'Ekki tókst að sækja síur og fleiri met. Endurhladdu síðuna til að reyna aftur.'; });
}
