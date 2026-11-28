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

export function GrantAwards({ year, query }: { year?: string; query?: string }) {
  const selected = archive.find((entry) => String(entry.year) === year) ?? archive[0];
  const term = query?.trim().slice(0, 100) ?? '';
  const words = searchText(term).split(/\s+/).filter(Boolean);
  const rounds = selected.rounds.map((round) => ({
    ...round,
    rows: words.length
      ? round.rows.filter(([recipient, project]) => {
        const haystack = searchText(`${recipient} ${project}`);
        return words.every((word) => haystack.includes(word));
      })
      : round.rows,
  })).filter((round) => round.rows.length);

  return (
    <section class="prose grant-awards" id="uthlutanir" aria-labelledby="uthlutanir-title">
      <h2 id="uthlutanir-title">Úthlutanir fyrri ára</h2>
      <form method="get" action="#uthlutanir" class="grant-awards-filter" role="search" aria-label="Leita í úthlutunum">
        <div class="gf">
          <label for="grant-year">Ár</label>
          <select id="grant-year" name="ar">
            {archive.map((entry) => <option value={entry.year} selected={entry.year === selected.year}>{entry.year}</option>)}
          </select>
        </div>
        <div class="gf">
          <label for="grant-query">Styrkþegi eða verkefni</label>
          <input type="search" id="grant-query" name="q" value={term} maxlength={100} />
        </div>
        <button class="btn" type="submit">Sýna úthlutanir</button>
      </form>
      <p><strong>Samtals úthlutað {selected.year}</strong> · {formatAmount(selected.total)} kr.</p>
      {term && <p><a href={`?ar=${selected.year}#uthlutanir`}>Hreinsa leit</a></p>}
      {rounds.length === 0 && <p>Engar úthlutanir fundust fyrir þessa leit.</p>}
      {rounds.map((round, index) => {
        const titleId = `grant-round-${index}`;
        return (
          <>
            <h3 id={titleId}>{round.label}</h3>
            <table aria-labelledby={titleId}>
              <thead><tr><th scope="col">Styrkþegi</th><th scope="col">Verkefni</th><th scope="col">Kr.</th></tr></thead>
              <tbody>
                {round.rows.map(([recipient, project, amount]) => (
                  <tr><td>{recipient}</td><td>{project}</td><td class="num">{formatAmount(Number(amount))}</td></tr>
                ))}
              </tbody>
              {!term && <tfoot><tr><th scope="row" colspan={2}>Samtals</th><td class="num">{formatAmount(round.total)}</td></tr></tfoot>}
            </table>
          </>
        );
      })}
      <details>
        <summary>Heimildir fyrir {selected.year}</summary>
        <ul>{selected.sources.map((source: { label: string; url: string; displayUrl?: string }) => (
          <li><a href={source.displayUrl ?? source.url}>{source.label}</a></li>
        ))}</ul>
      </details>
    </section>
  );
}
