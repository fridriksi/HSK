import archive from '../data/grant-awards.json';

const archiveFiles = new Set(archive.flatMap((year) => year.sources.map((source) => source.url)));
function formatAmount(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function grantPageIntro(html: string) {
  return html.replace(/<h2\b[^>]*>\s*Úthlutanir fyrri ára\s*<\/h2>\s*(<ul\b[^>]*>)([\s\S]*?)<\/ul>/i,
    (section, listStart, items: string) => {
      const rest = items.replace(/<li\b[^>]*>\s*<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>\s*<\/li>/gi,
        (item, url: string) => archiveFiles.has(url) ? '' : item);
      if (items === rest) return section;
      return rest.trim() ? `<h2>Fleiri úthlutanir</h2>${listStart}${rest}</ul>` : '';
    });
}

function searchText(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('is-IS');
}

const columns = [
  ['recipient', 'Styrkþegi'], ['project', 'Verkefni'], ['year', 'Ár'], ['round', 'Úthlutun'], ['amount', 'Upphæð'],
] as const;
const rounds = [
  { id: 'fyrri', label: 'Fyrri', source: 'Fyrri úthlutun' },
  { id: 'seinni', label: 'Seinni', source: 'Seinni úthlutun' },
  { id: 'serstok', label: 'Sérstök', source: 'Sérstök úthlutun' },
  { id: 'arleg', label: 'Árleg', source: 'Úthlutun' },
];
const pageSize = 75;
const awards = archive.flatMap(({ year, rounds: entries }) => entries.flatMap((entry) => {
  const round = rounds.find((round) => round.source === entry.label);
  if (!round) throw new Error(`Óþekkt úthlutun: ${entry.label}`);
  return entry.rows.map(([name, description, value]) => ({
    recipient: String(name), project: String(description), amount: Number(value), year, round: round.label, roundId: round.id,
    search: searchText(`${name} ${description}`),
  }));
}));

function defaultDirection(key: typeof columns[number][0]) {
  return key === 'year' || key === 'amount' ? 'desc' : 'asc';
}

function grantAwardFilters(params: Record<string, string>) {
  const year = archive.find((entry) => String(entry.year) === params.ar)?.year;
  const round = rounds.find((entry) => entry.id === params.uthlutun)?.id;
  const sort = columns.find(([key]) => key === params.rodun)?.[0] ?? 'year';
  const direction = params.att === 'asc' || params.att === 'desc' ? params.att : defaultDirection(sort);
  const term = params.q?.trim().slice(0, 100) ?? '';
  return { year, round, sort, direction, term };
}

export function GrantAwardResults({ params }: { params: Record<string, string> }) {
  const { year, round, sort, direction, term } = grantAwardFilters(params);
  const words = searchText(term).split(/\s+/).filter(Boolean);
  const matching = awards.filter((award) => (!year || award.year === year) && (!round || award.roundId === round)
    && words.every((word) => award.search.includes(word)));
  matching.sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    const order = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'is-IS', { sensitivity: 'base', numeric: true });
    return order * (direction === 'asc' ? 1 : -1);
  });
  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const requestedPage = Number(params.sida);
  const page = Number.isSafeInteger(requestedPage) ? Math.min(lastPage, Math.max(1, requestedPage)) : 1;
  const start = (page - 1) * pageSize;
  const rows = matching.slice(start, start + pageSize);
  const total = matching.reduce((sum, award) => sum + award.amount, 0);
  const sources = year ? archive.filter((entry) => entry.year === year) : archive;

  function link(nextPage: number, nextSort = sort, nextDirection = direction) {
    const query = new URLSearchParams({ rodun: nextSort, att: nextDirection });
    if (year) query.set('ar', String(year));
    if (round) query.set('uthlutun', round);
    if (term) query.set('q', term);
    if (nextPage > 1) query.set('sida', String(nextPage));
    return `?${query}#grant-results`;
  }

  return (
    <>
      <p role="status">{matching.length
        ? `${start + 1}–${start + rows.length} af ${matching.length} styrkveitingum · Samtals ${formatAmount(total)} kr.`
        : 'Engar úthlutanir fundust.'}</p>
      {rows.length > 0 && <table aria-labelledby="uthlutanir-title">
        <thead><tr>{columns.map(([key, label]) => {
          const active = key === sort;
          const nextDirection = active ? direction === 'asc' ? 'desc' : 'asc' : defaultDirection(key);
          return <th scope="col" aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
            <a href={link(1, key, nextDirection)}>{label}<span class="grant-sort-mark" aria-hidden="true"></span></a>
          </th>;
        })}</tr></thead>
        <tbody>{rows.map(({ recipient, project, amount, year, round }) => (
          <tr><td>{recipient}</td><td>{project}</td><td>{year}</td><td>{round}</td><td class="num">{formatAmount(amount)} kr.</td></tr>
        ))}</tbody>
      </table>}
      {lastPage > 1 && <nav class="grant-awards-pages" aria-label="Síður úthlutana">
        {page > 1 && <a class="btn ghost small" href={link(page - 1)}>Fyrri síða</a>}
        <span>Síða {page} af {lastPage}</span>
        {page < lastPage && <a class="btn ghost small" href={link(page + 1)}>Næsta síða</a>}
      </nav>}
      <details>
        <summary>{year ? `Heimildir fyrir ${year}` : 'Heimildir eftir árum'}</summary>
        <ul>{sources.flatMap((entry) => entry.sources).map((source: { label: string; url: string; displayUrl?: string }) => (
          <li><a href={source.displayUrl ?? source.url}>{source.label}</a></li>
        ))}</ul>
      </details>
    </>
  );
}

export function GrantAwards({ params, script }: { params: Record<string, string>; script: string }) {
  const { year, round, sort, direction, term } = grantAwardFilters(params);
  return (
    <section class="prose grant-awards" id="uthlutanir" aria-labelledby="uthlutanir-title">
      <h2 id="uthlutanir-title">Úthlutanir fyrri ára</h2>
      <form method="get" action="#uthlutanir" class="grant-awards-filter" role="search" aria-label="Leita í úthlutunum">
        <div class="gf grant-awards-search">
          <label for="grant-query">Styrkþegi eða verkefni</label>
          <input type="search" id="grant-query" name="q" value={term} maxlength={100} />
        </div>
        <div class="gf">
          <label for="grant-year">Ár</label>
          <select id="grant-year" name="ar">
            <option value="">Öll ár</option>
            {archive.map((entry) => <option value={entry.year} selected={entry.year === year}>{entry.year}</option>)}
          </select>
        </div>
        <div class="gf">
          <label for="grant-round">Úthlutun</label>
          <select id="grant-round" name="uthlutun">
            <option value="">Allar úthlutanir</option>
            {rounds.map((entry) => <option value={entry.id} selected={entry.id === round}>{entry.label}</option>)}
          </select>
        </div>
        <input type="hidden" name="rodun" value={sort} />
        <input type="hidden" name="att" value={direction} />
        <button class="btn" type="submit">Sía</button>
        <a class="btn ghost" href="?#uthlutanir" hidden={!(year || round || term)}>Hreinsa síur</a>
      </form>
      <div id="grant-results"><GrantAwardResults params={params} /></div>
      <script type="module" src={script}></script>
    </section>
  );
}
