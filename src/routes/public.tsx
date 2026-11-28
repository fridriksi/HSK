import { Hono, type Context } from 'hono';
import type { Child } from 'hono/jsx';
import {
  type AppEnv, all, one, slugify, DEFAULT_TILES, getSetting, dateLong, today, plainText, weekday, timeOf, monthYear, escapeHtml,
} from '../lib';
import {
  Layout, PageHead, SectionTabs, NewsCard, EventItem, ResultItem, DateBox, Pager, Prose,
  type MenuItem, type SiteChrome, type NewsRow, type EventRow,
} from '../views/site';
import { Icon } from '../views/icons';
import { RecordBookView, recordBook, recordEditions, recordLink } from '../views/records';
import { RECORDS_PATH, uploadedRecordKey, type RecordBook, type RecordSheet } from '../record-books';
import { buildCatalogue, mergeCatalogue, type RecordResult } from '../record-catalogue';
import { archivedRecords } from '../record-catalogue-data';
import { FilterField, FilterOptions } from '../views/filters';
import { RecordCatalogue } from '../views/record-catalogue';
import { catalogueRows } from '../record-rows';
import { type GrantField, grantForm, saveGrant } from '../grant';
import { GrantAwards, grantPageIntro, type ExtraAward } from '../views/grant-awards';
import { asset } from '../static';
import { RECORD_CATEGORIES, AREAS } from '../content-types';

const app = new Hono<AppEnv>();
const PER_PAGE = 12;

type PageRow = { id: number; parent_id: number | null; slug: string; path: string; title: string; body: string; module: string; sort: number; in_menu: number; status: string };

async function chrome(c: Context<AppEnv>): Promise<SiteChrome> {
  const db = c.env.DB;
  const pages = await all<PageRow>(db, "SELECT id, parent_id, path, title, sort, in_menu FROM pages WHERE status = 'published' AND in_menu = 1 ORDER BY sort, title");
  const byParent = new Map<number | null, MenuItem[]>();
  for (const p of pages) {
    const list = byParent.get(p.parent_id) ?? [];
    list.push({ id: p.id, title: p.title, path: p.path, children: [] });
    byParent.set(p.parent_id, list);
  }
  const menu = (byParent.get(null) ?? []).map((m) => ({ ...m, children: byParent.get(m.id) ?? [] }));
  const d = today();
  const sponsors = await all<SiteChrome['sponsors'][number]>(db,
    `SELECT name, logo, url, tier FROM sponsors WHERE (active_from IS NULL OR active_from = '' OR active_from <= ?) AND (active_to IS NULL OR active_to = '' OR active_to >= ?)
     ORDER BY sort, name`, d, d);
  return {
    menu,
    sponsors,
    notice: await getSetting(db, 'notice'),
    contact: {
      address: await getSetting(db, 'contact_address', 'Selinu, Engjavegi 48, 800 Selfossi'),
      phone: await getSetting(db, 'contact_phone', '482 1189'),
      email: await getSetting(db, 'contact_email', 'hsk@hsk.is'),
    },
    // Samfélagsmiðlar HSK (stillt í Forsíða og stillingar); röðin birtist aðeins ef einhver slóð er skráð
    social: (await Promise.all(([['Facebook', 'facebook'], ['Instagram', 'instagram'], ['TikTok', 'tiktok'], ['YouTube', 'youtube']] as const)
      .map(async ([name, icon]) => ({ name, icon, url: (await getSetting(db, 'social_' + icon)).trim() }))))
      .filter((x) => /^https?:\/\//.test(x.url)),
  };
}

async function render(c: Context<AppEnv>, title: string, body: Child, opts: { description?: string; image?: string; status?: number; lang?: string; fresh?: boolean } = {}) {
  const ch = await chrome(c);
  const html = (
    <Layout title={title} chrome={ch} path={new URL(c.req.url).pathname} description={opts.description} image={opts.image} lang={opts.lang}>
      {body}
    </Layout>
  );
  c.header('Cache-Control', opts.fresh ? 'public, max-age=0, must-revalidate' : 'public, max-age=60');
  return c.html('<!doctype html>' + html.toString(), (opts.status ?? 200) as 200);
}

function pageNum(c: Context<AppEnv>) {
  return Math.max(1, parseInt(c.req.query('s') || '1', 10) || 1);
}

// ---------- Forsíða ----------

app.get('/forsida-ny', (c) => c.redirect('/', 301));

app.get('/', async (c) => {
  const db = c.env.DB;
  const s = (k: string) => getSetting(db, k, '');
  const news = await all<NewsRow & { id: number }>(db, "SELECT id, slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE status = 'published' AND published_at <= datetime('now') ORDER BY published_at DESC LIMIT 7");
  // Stóra myndin: stillt í vefumsjón, annars nýjasta fréttin með mynd
  let hero = { title: await s('hero_title'), text: await s('hero_text'), image: await s('hero_image'), link: await s('hero_link'), button: await s('hero_button') };
  if (!hero.title) {
    const n = news.find((x) => x.image) ?? news[0];
    if (n) hero = { title: n.title, text: n.excerpt || plainText(n.body, 160), image: n.image, link: '/frett/' + n.slug, button: 'Lesa frétt' };
  }
  // Fréttir: ein aðalfrétt, tvær með lítilli mynd og þrjár eldri í lista (jafnhátt aðalfréttinni) (fréttin í stóru myndinni ekki endurtekin)
  const rest = news.filter((n) => '/frett/' + n.slug !== hero.link);
  const [lead, ...others] = rest;
  const side = others.slice(0, 2);
  const older = others.slice(2, 5);
  const events = await all<EventRow>(db, "SELECT id, kind, title, starts_at, ends_at, location, sport, image FROM events WHERE status = 'published' AND substr(coalesce(ends_at, starts_at), 1, 10) >= ? ORDER BY starts_at LIMIT 6", today());
  const results = await all<{ id: number; title: string; date: string; sport: string }>(db, "SELECT id, title, date, sport FROM results WHERE status = 'published' ORDER BY date DESC LIMIT 5");
  // Nýjustu metin úr töflunni á síðunni HSK met
  const records = await recentRecords(c.env);
  const sports = [...new Set((await all<{ sports: string }>(db, "SELECT sports FROM clubs WHERE sports <> ''")).flatMap((r) => r.sports.split(/\s*,\s*/)).filter((x) => x && x !== 'Annað'))].sort((a, b) => a.localeCompare(b, 'is'));
  const clubCount = (await one<{ n: number }>(db, 'SELECT count(*) AS n FROM clubs'))?.n ?? 0;
  // Ein mynd úr hverju af nýjustu myndasöfnunum
  const tiles = (await getSetting(db, 'home_tiles', DEFAULT_TILES)).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((l) => l[0] && l[2]).slice(0, 6);
  const photos = await all<{ src: string; slug: string; title: string }>(db, "SELECT coalesce(nullif(a.cover, ''), (SELECT src FROM photos p WHERE p.album_id = a.id ORDER BY sort LIMIT 1)) AS src, a.slug, a.title FROM albums a ORDER BY a.date DESC, a.id DESC LIMIT 6").then((r) => r.filter((x) => x.src));

  // Auglýsingar: ein af handahófi í hverju plássi af þeim sem eru virkar í dag
  const adRows = await all<Ad & { slot: string }>(db,
    `SELECT slot, title, image, url FROM ads WHERE active = 'birt' AND image <> ''
       AND (active_from IS NULL OR active_from = '' OR active_from <= ?) AND (active_to IS NULL OR active_to = '' OR active_to >= ?)
     ORDER BY random()`, today(), today());
  const ad = (slot: string) => adRows.find((a) => a.slot === slot);

  return render(c, 'Forsíða', (
    <div class="home2">
      {hero.title && (
        <section class="h2-hero">
          {hero.image && <img src={hero.image} alt="" />}
          <div class="wrap h2-hero-txt">
            <div>
              <h1>{hero.title}</h1>
              {hero.text && <p>{hero.text}</p>}
              {hero.link && <a class="btn-hero" href={hero.link}>{hero.button || 'Nánar'}<Icon name="chevronRight" /></a>}
            </div>
          </div>
        </section>
      )}

      <div class="home2-body">
      {ad('forsida-hlid') && <aside class="ad-side" aria-label="Auglýsing"><div class="ad-side-in"><AdBanner ad={ad('forsida-hlid')!} /></div></aside>}
      {lead && (
        <section class="wrap h2-block">
          <div class="h2-head"><h2>Fréttir</h2><a href="/frettir">Allar fréttir</a></div>
          <div class="hn">
            <NewsCard n={lead} big />
            <div class="hn-side">
              {side.map((n) => (
                <article class="hn-row"><a href={'/frett/' + n.slug}>
                  <div class="thumb">{n.image ? <img src={n.image} alt="" loading="lazy" /> : <img class="ph" src="/img/hsk-merki.svg" alt="" />}</div>
                  <div><time datetime={n.published_at}>{dateLong(n.published_at)}</time><h3>{n.title}</h3></div>
                </a></article>
              ))}
              {older.length > 0 && (
                <div class="hn-more">
                  <h3 class="hn-more-h">Eldri fréttir</h3>
                  <ul>{older.map((n) => (
                    <li><a href={'/frett/' + n.slug}><time datetime={n.published_at}>{dateLong(n.published_at)}</time><span>{n.title}</span></a></li>
                  ))}</ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {ad('forsida-midja') && <div class="wrap ad-row"><AdBanner ad={ad('forsida-midja')!} /></div>}

      <section class="wrap h2-block">
        <div class="h2-head"><h2>Framundan</h2><a href="/mot/dagskra">Viðburðadagatal</a></div>
        {events.length ? (
          <ol class="h2-dates">
            {events.map((e) => (
              <li><a href={'/vidburdur/' + e.id} class={e.kind === 'mot' ? 'is-mot' : ''}>
                <DateBox d={e.starts_at} />
                <span class={'kind-tag' + (e.kind === 'mot' ? ' mot' : '')}>{e.kind === 'mot' ? 'Mót' : 'Viðburður'}</span>
                <strong>{e.title}</strong>
                <small>{[e.sport, e.location].filter(Boolean).join(' · ') || weekday(e.starts_at)}</small>
              </a></li>
            ))}
          </ol>
        ) : <p class="muted">Engir viðburðir skráðir á næstunni.</p>}
      </section>

      <section class="h2-band">
        <div class="wrap h2-two">
          <div>
            <div class="h2-head"><h2>Nýjustu úrslit</h2><a href="/mot/urslit">Öll úrslit</a></div>
            <ul class="event-list">{results.map((r) => <ResultItem r={r} />)}</ul>
          </div>
          <div>
            <div class="h2-head"><h2>Nýjustu HSK met</h2><a href="/mot/hsk-met">Öll met</a></div>
            <ul class="event-list rec-list">
              {records.map((r) => (
                <li class="event-item"><a href="/mot/hsk-met">
                  <DateBox d={recordIso(r.dateKey)} />
                  <span class="ev-txt">
                    {r.groups.length > 0 && <span class="kind-tag">{r.groups.join(' · ')}</span>}
                    <strong>{r.event}</strong>
                    <small class="rec-line"><b>{recordResult(r.event, r.result)}</b>{r.athlete && ` · ${r.athlete}`}{r.categories.length > 0 && ` · ${r.categories.join(', ')}`}</small>
                  </span>
                </a></li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {ad('forsida-nedri') && <div class="wrap ad-row"><AdBanner ad={ad('forsida-nedri')!} /></div>}

      <section class="wrap h2-block h2-finder">
        <div>
          <h2>Finndu félag</h2>
          <p>{clubCount} íþrótta- og ungmennafélög á Suðurlandi eru aðilar að HSK. Leitaðu eftir nafni, íþróttagrein eða heimabyggð.</p>
        </div>
        <form action="/adildarfelog" method="get" class="filter-row h2-find" role="search" aria-label="Finndu félag">
          <FilterField id="ff-q" label="Leit"><input id="ff-q" name="q" type="search" placeholder="T.d. Hamar, sund eða Hella" /></FilterField>
          <FilterField id="ff-g" label="Íþróttagrein">
            <select id="ff-g" data-fill-q>
              <option value="">Allar greinar</option>
              {sports.map((sp) => <option value={sp}>{sp}</option>)}
            </select>
          </FilterField>
          <FilterField id="ff-s" label="Sveitarfélag">
            <select id="ff-s" data-fill-q>
              <option value="">Öll sveitarfélög</option>
              {AREAS.map((a) => <option value={a}>{a}</option>)}
            </select>
          </FilterField>
          <button class="btn">Leita</button>
        </form>
      </section>

      {photos.length > 0 && (
        <section class="wrap h2-block">
          <div class="h2-head"><h2>Myndir</h2><a href="/frettir/myndir">Öll myndasöfn</a></div>
          <div class="h2-photos">
            {photos.map((p) => <a href={'/album/' + p.slug} title={p.title}><img src={p.src} alt="" loading="lazy" /></a>)}
          </div>
        </section>
      )}

      {tiles.length > 0 && (
        <section class="wrap h2-block h2-tiles">
          {tiles.map(([t, txt, url]) => <a href={url}><strong>{t}<Icon name="chevronRight" /></strong>{txt && <span>{txt}</span>}</a>)}
        </section>
      )}
      </div>
    </div>
  ), { description: 'Héraðssambandið Skarphéðinn (HSK) er héraðssamband íþrótta- og ungmennafélaga á Suðurlandi, stofnað 1910.' });
});

const recordIso = (k: number) => `${Math.floor(k / 10000)}-${String(Math.floor(k / 100) % 100).padStart(2, '0')}-${String(k % 100).padStart(2, '0')}`;

/** Árangur með einingu: tími í hlaupum og sundi, metrar í köstum og stökkum, stig í þrautum */
function recordResult(event: string, result: string): string {
  const r = result.trim();
  if (!r || /[a-záðéíóúýþæö]/i.test(r)) return r;          // eining þegar í árangri
  if (/þraut/i.test(event)) return `${r} stig`;
  if (/kast|varp|stökk/i.test(event)) return `${r} m`;
  if (/hlaup|grind|ganga|sund|skrið|bak|bringa|flug|fjór|boð/i.test(event)) return r.includes(':') ? `${r} mín.` : `${r} sek.`;
  return r;
}

/** Fimm nýjustu metin (eftir dagsetningu) úr töflunni HSK met; geymd í minni í 5 mínútur svo forsíðan sé hröð */
let recentCache: { at: number; rows: RecordResult[] } | null = null;
async function recentRecords(env: AppEnv['Bindings']): Promise<RecordResult[]> {
  if (recentCache && Date.now() - recentCache.at < 5 * 60 * 1000) return recentCache.rows;
  const today = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const rows = (await catalogueRows(env)).filter((r) => r.dateKey > 0 && r.dateKey <= today)
    .sort((a, b) => b.dateKey - a.dateKey).slice(0, 5);
  recentCache = { at: Date.now(), rows };
  return rows;
}

type Ad = { title: string; image: string; url: string };

/** Auglýsing: mynd með tengli, merkt sem auglýsing */
const AdBanner = ({ ad }: { ad: Ad }) => (
  <div class="ad">
    <span class="ad-label">Auglýsing</span>
    {ad.url
      ? <a href={ad.url} target="_blank" rel="noopener sponsored"><img src={ad.image} alt={ad.title} loading="lazy" /></a>
      : <img src={ad.image} alt={ad.title} loading="lazy" />}
  </div>
);

// ---------- Fréttir ----------

app.get('/frett/:slug', async (c) => {
  const n = await one<NewsRow & { id: number; club_name: string | null; album_slug: string | null }>(c.env.DB,
    `SELECT n.*, cl.name AS club_name, a.slug AS album_slug FROM news n LEFT JOIN clubs cl ON cl.id = n.club_id LEFT JOIN albums a ON a.id = n.album_id
     WHERE n.slug = ? AND n.status = 'published'`, c.req.param('slug'));
  if (!n) return notFound(c);
  const crumb = n.kind === 'frett' ? { title: 'Fréttir', path: '/frettir' } : { title: 'Greinar', path: '/frettir/greinar' };
  return render(c, n.title, (
    <article class="article">
      <PageHead title={n.title} crumbs={[crumb]} />
      <div class="wrap article-body">
        <p class="meta">
          <time datetime={n.published_at}>{dateLong(n.published_at)}</time>
          {n.author && <> · {n.author}</>}
          {n.club_name && <> · {n.club_name}</>}
        </p>
        {n.image && <figure class="lead-img"><img src={n.image} alt="" /></figure>}
        <Prose html={n.body} />
        {n.album_slug && <p><a class="btn" href={'/album/' + n.album_slug}>Skoða myndir<Icon name="chevronRight" /></a></p>}
        <p><a href="/frettir"><Icon name="chevronLeft" />Allar fréttir</a></p>
      </div>
    </article>
  ), { description: n.excerpt || plainText(n.body, 160), image: n.image || undefined });
});

function sectionSearch(c: Context<AppEnv>, fields: string[], where: string[], params: unknown[]) {
  const term = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (term) {
    // SQLite lower() only covers ASCII. Fold the uppercase Icelandic letters first.
    const text = [...'ÁÐÉÍÓÚÝÞÆÖ'].reduce((sql, letter) =>
      `replace(${sql}, '${letter}', '${letter.toLowerCase()}')`, fields.join(" || ' ' || "));
    for (const word of term.toLowerCase().split(/\s+/)) {
      where.push(`instr(lower(${text}), ?) > 0`);
      params.push(word);
    }
  }
  return term;
}

function sectionUrl(base: string, filters: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return query.size ? `${base}?${query}` : base;
}

function SectionSearchField({ term, placeholder }: { term: string; placeholder: string }) {
  return <>
    <FilterField id="section-search" label="Leit">
      <input id="section-search" name="q" type="search" value={term} maxlength={100} placeholder={placeholder} />
    </FilterField>
    <span class="sr" role="status" data-section-status></span>
  </>;
}

async function newsList(c: Context<AppEnv>, kind?: string | string[]) {
  const kinds = kind ? ([] as string[]).concat(kind) : [];
  const page = pageNum(c);
  const ar = c.req.query('ar');
  const year = ar && /^\d{4}$/.test(ar) ? ar : undefined;
  const where = ["status = 'published'", "published_at <= datetime('now')"];
  const params: unknown[] = [];
  if (kinds.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); params.push(...kinds); }
  if (year) { where.push("substr(published_at, 1, 4) = ?"); params.push(year); }
  const term = sectionSearch(c, ['title', 'excerpt', 'body', 'author'], where, params);
  const rows = await all<NewsRow>(c.env.DB, `SELECT slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ? OFFSET ?`, ...params, PER_PAGE + 1, (page - 1) * PER_PAGE);
  const years = await all<{ y: string }>(c.env.DB, `SELECT DISTINCT substr(published_at, 1, 4) AS y FROM news WHERE status = 'published' ${kinds.length ? `AND kind IN (${kinds.map(() => '?').join(',')})` : ''} ORDER BY y DESC`, ...kinds);
  return { rows: rows.slice(0, PER_PAGE), hasNext: rows.length > PER_PAGE, page, years: years.map((y) => y.y).filter(Boolean), year, term };
}

const NewsListing = ({ data, base }: { data: Awaited<ReturnType<typeof newsList>>; base: string }) => (
  <>
    <form action={base} method="get" class="filter-row filter-compact" role="search" aria-label="Leita í fréttum og greinum" data-section-search>
      {data.year && <input type="hidden" name="ar" value={data.year} />}
      <SectionSearchField term={data.term} placeholder="Titill, efni eða höfundur" />
      <button class="btn">Leita</button>
    </form>
    {data.years.length > 1 && (
      <div class="filter-row" data-section-options>
        <FilterOptions label="Ár">
          <a href={sectionUrl(base, { q: data.term })} aria-current={!data.year ? 'true' : undefined}>Öll ár</a>
          {data.years.map((y) => <a href={sectionUrl(base, { ar: y, q: data.term })} aria-current={data.year === y ? 'true' : undefined}>{y}</a>)}
        </FilterOptions>
      </div>
    )}
    <div id="section-results" data-count={data.rows.length}>
      {data.rows.length ? <div class="news-grid">{data.rows.map((n) => <NewsCard n={n} />)}</div> : <p class="muted">Engar fréttir fundust.</p>}
      <Pager page={data.page} hasNext={data.hasNext} base={sectionUrl(base, { ar: data.year, q: data.term })} />
    </div>
  </>
);

// ---------- Viðburðir, mót, úrslit ----------

app.get('/vidburdur/:id{[0-9]+}', async (c) => {
  const e = await one<EventRow & { description: string; url: string; age_groups: string; organizer: string; reg_deadline: string | null; attachment: string; club_name: string | null }>(c.env.DB,
    "SELECT e.*, cl.name AS club_name FROM events e LEFT JOIN clubs cl ON cl.id = e.club_id WHERE e.id = ? AND e.status = 'published'", c.req.param('id'));
  if (!e) return notFound(c);
  const results = await all<{ id: number; title: string; date: string; sport: string }>(c.env.DB, "SELECT id, title, date, sport FROM results WHERE event_id = ? AND status = 'published'", e.id);
  const albums = await all<{ slug: string; title: string }>(c.env.DB, 'SELECT slug, title FROM albums WHERE event_id = ?', e.id);
  const isMot = e.kind === 'mot';
  const when = e.ends_at && e.ends_at.slice(0, 10) !== e.starts_at.slice(0, 10)
    ? `${dateLong(e.starts_at)} – ${dateLong(e.ends_at)}`
    : `${weekday(e.starts_at)} ${dateLong(e.starts_at)} ${timeOf(e.starts_at)}`;
  return render(c, e.title, (
    <article class="article">
      <PageHead title={e.title} crumbs={[{ title: 'Mót og úrslit', path: '/mot' }, { title: 'Mót og viðburðir', path: '/mot/dagskra' }]} />
      <div class="wrap article-body">
        <dl class="facts-list">
          <div><dt>Hvenær</dt><dd>{when}</dd></div>
          {e.location && <div><dt>Hvar</dt><dd>{e.location}</dd></div>}
          {e.sport && <div><dt>Íþróttagrein</dt><dd>{e.sport}</dd></div>}
          {e.age_groups && <div><dt>Aldursflokkar</dt><dd>{e.age_groups}</dd></div>}
          {(e.organizer || e.club_name) && <div><dt>Mótshaldari</dt><dd>{e.organizer || e.club_name}</dd></div>}
          {e.reg_deadline && <div><dt>Skráningarfrestur</dt><dd>{dateLong(e.reg_deadline)}</dd></div>}
        </dl>
        {e.image && <figure class="lead-img"><img src={e.image} alt="" /></figure>}
        <Prose html={e.description} />
        <p class="btn-row">
          {e.url && <a class="btn" href={e.url} rel="noopener">Skráning og nánari upplýsingar</a>}
          {e.attachment && <a class="btn ghost" href={e.attachment}><Icon name="file" />{isMot ? 'Boðsbréf og reglugerð' : 'Fylgiskjal'}</a>}
          <a class="btn ghost" href={`/vidburdur/${e.id}.ics`}><Icon name="calendar" />Bæta í dagatal</a>
        </p>
        {results.length > 0 && <><h2>Úrslit</h2><ul class="event-list">{results.map((r) => <ResultItem r={r} />)}</ul></>}
        {albums.length > 0 && <><h2>Myndir</h2><ul>{albums.map((a) => <li><a href={'/album/' + a.slug}>{a.title}</a></li>)}</ul></>}
      </div>
    </article>
  ), { description: plainText(e.description, 160) || `${e.title}, ${when}` });
});

function icsDate(d: string) {
  if (d.length <= 10) return `;VALUE=DATE:${d.replace(/-/g, '')}`;
  return ':' + d.replace(' ', 'T').replace(/[-:]/g, '').slice(0, 15) + 'Z';
}
function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
function icsEvent(site: string, e: EventRow & { description?: string }) {
  return [
    'BEGIN:VEVENT', `UID:hsk-${e.id}@hsk.is`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART${icsDate(e.starts_at)}`, ...(e.ends_at ? [`DTEND${icsDate(e.ends_at)}`] : []),
    `SUMMARY:${icsEscape(e.title)}`, ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    `URL:${site}/vidburdur/${e.id}`, ...(e.description ? [`DESCRIPTION:${icsEscape(plainText(e.description, 500))}`] : []), 'END:VEVENT',
  ];
}
function ics(lines: string[]) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HSK//Vefur//IS', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:HSK', ...lines, 'END:VCALENDAR'].join('\r\n');
}
app.get('/vidburdur/:id{[0-9]+\\.ics}', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const e = await one<EventRow & { description: string }>(c.env.DB, "SELECT * FROM events WHERE id = ? AND status = 'published'", id);
  if (!e) return notFound(c);
  return c.body(ics(icsEvent(c.env.SITE_URL, e)), 200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="hsk-${id}.ics"` });
});
app.get('/dagatal.ics', async (c) => {
  const rows = await all<EventRow & { description: string }>(c.env.DB, "SELECT * FROM events WHERE status = 'published' AND starts_at >= date('now', '-60 days') ORDER BY starts_at");
  return c.body(ics(rows.flatMap((e) => icsEvent(c.env.SITE_URL, e))), 200, { 'content-type': 'text/calendar; charset=utf-8' });
});

async function eventList(c: Context<AppEnv>, fixed: 'vidburdur' | 'mot' | null) {
  const t = c.req.query('tegund');
  const kind = fixed ?? (t === 'mot' || t === 'vidburdur' ? t : null);
  const past = c.req.query('lidid') === '1';
  const sport = c.req.query('grein') || '';
  const where = ["status = 'published'", past ? "substr(coalesce(ends_at, starts_at), 1, 10) < ?" : "substr(coalesce(ends_at, starts_at), 1, 10) >= ?"];
  const params: unknown[] = [today()];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  if (sport) { where.push('sport = ?'); params.push(sport); }
  const term = sectionSearch(c, ['title', 'description', 'sport', 'location', 'organizer'], where, params);
  const rows = await all<EventRow>(c.env.DB, `SELECT id, kind, title, starts_at, ends_at, location, sport, image FROM events WHERE ${where.join(' AND ')} ORDER BY starts_at ${past ? 'DESC' : 'ASC'} LIMIT 200`, ...params);
  const sports = await all<{ sport: string }>(c.env.DB, `SELECT DISTINCT sport FROM events WHERE sport != '' ${kind ? 'AND kind = ?' : ''} ORDER BY sport`, ...(kind ? [kind] : []));
  return { rows, past, sport, kind, fixed: !!fixed, sports: sports.map((s) => s.sport), term };
}

const EventListing = ({ data, base }: { data: Awaited<ReturnType<typeof eventList>>; base: string }) => {
  const groups = new Map<string, EventRow[]>();
  for (const e of data.rows) {
    const k = monthYear(e.starts_at);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const q = (p: Record<string, string>) => sectionUrl(base, {
    tegund: !data.fixed ? data.kind ?? undefined : undefined, grein: data.sport, lidid: data.past ? '1' : '', q: data.term, ...p,
  });
  return (
    <>
      <div class="filter-row" data-section-options>
        <FilterOptions label="Tímabil">
          <a href={q({ lidid: '' })} aria-current={!data.past ? 'true' : undefined}>Framundan</a>
          <a href={q({ lidid: '1' })} aria-current={data.past ? 'true' : undefined}>Liðið</a>
        </FilterOptions>
        {!data.fixed && (
          <FilterOptions label="Tegund">
            <a href={q({ tegund: '' })} aria-current={!data.kind ? 'true' : undefined}>Allt</a>
            <a href={q({ tegund: 'mot' })} aria-current={data.kind === 'mot' ? 'true' : undefined}><span class="kind-dot mot"></span>Mót</a>
            <a href={q({ tegund: 'vidburdur' })} aria-current={data.kind === 'vidburdur' ? 'true' : undefined}><span class="kind-dot"></span>Viðburðir</a>
          </FilterOptions>
        )}
        <a class="ics-link" href="/dagatal.ics"><Icon name="calendar" />Setja dagatalið í símann eða tölvuna</a>
      </div>
      <form action={base} method="get" class="filter-row filter-compact" role="search" aria-label="Leita að mótum og viðburðum" data-section-search>
        {data.past && <input type="hidden" name="lidid" value="1" />}
        {!data.fixed && data.kind && <input type="hidden" name="tegund" value={data.kind} />}
        <SectionSearchField term={data.term} placeholder="Heiti, íþróttagrein eða staður" />
        {data.sports.length > 0 && (
            <FilterField id="grein" label="Íþróttagrein">
              <select id="grein" name="grein">
                <option value="">Allar greinar</option>
                {data.sports.map((s) => <option value={s} selected={s === data.sport}>{s}</option>)}
              </select>
            </FilterField>
        )}
        <button class="btn">Leita</button>
      </form>
      <div id="section-results" data-count={data.rows.length}>
        {data.rows.length === 0 && <p class="muted">{data.term ? 'Engin mót eða viðburðir fundust.' : 'Ekkert skráð.'}</p>}
        {[...groups].map(([month, list]) => (
          <section class="month-group">
            <h2>{month}</h2>
            <ul class="event-list wide">{list.map((e) => <EventItem e={e} />)}</ul>
          </section>
        ))}
      </div>
    </>
  );
};

app.get('/urslit/:id{[0-9]+}', async (c) => {
  const r = await one<{ id: number; title: string; date: string; sport: string; body: string; attachment: string; event_id: number | null }>(c.env.DB,
    "SELECT * FROM results WHERE id = ? AND status = 'published'", c.req.param('id'));
  if (!r) return notFound(c);
  return render(c, r.title, (
    <article class="article">
      <PageHead title={r.title} crumbs={[{ title: 'Úrslit', path: '/mot/urslit' }]} />
      <div class="wrap article-body wide">
        <p class="meta">{dateLong(r.date)}{r.sport && <> · {r.sport}</>}{r.event_id && <> · <a href={'/vidburdur/' + r.event_id}>Um mótið</a></>}</p>
        <div class="table-wrap"><Prose html={r.body} /></div>
        {r.attachment && <p><a class="btn ghost" href={r.attachment}><Icon name="file" />Úrslit í skjali</a></p>}
      </div>
    </article>
  ));
});

async function resultList(c: Context<AppEnv>) {
  const sport = c.req.query('grein') || '';
  const years = (await all<{ y: string }>(c.env.DB, "SELECT DISTINCT substr(date, 1, 4) AS y FROM results WHERE status = 'published' ORDER BY y DESC")).map((y) => y.y);
  // Sjálfgefið nýjasta árið; „oll“ sýnir öll ár
  const year = c.req.query('ar') || (sport ? 'oll' : years[0] || 'oll');
  const where = ["status = 'published'"];
  const params: unknown[] = [];
  if (sport) { where.push('sport = ?'); params.push(sport); }
  if (/^\d{4}$/.test(year)) { where.push('substr(date, 1, 4) = ?'); params.push(year); }
  const term = sectionSearch(c, ['title', 'sport', 'body'], where, params);
  const rows = await all<{ id: number; title: string; date: string; sport: string }>(c.env.DB, `SELECT id, title, date, sport FROM results WHERE ${where.join(' AND ')} ORDER BY date DESC LIMIT 300`, ...params);
  const sports = (await all<{ sport: string }>(c.env.DB, "SELECT DISTINCT sport FROM results WHERE sport != '' ORDER BY sport")).map((s) => s.sport);
  return { rows, sport, year, sports, years, term };
}

// ---------- Félög, myndir ----------

app.get('/felag/:slug', async (c) => {
  const f = await one<{ id: number; name: string; logo: string; sports: string; area: string; contact_name: string; email: string; phone: string; website: string; facebook: string; instagram: string; tiktok: string; youtube: string; kennitala: string; description: string }>(c.env.DB,
    'SELECT * FROM clubs WHERE slug = ?', c.req.param('slug'));
  if (!f) return notFound(c);
  const news = await all<NewsRow>(c.env.DB, "SELECT slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE club_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT 6", f.id);
  const events = await all<EventRow>(c.env.DB, "SELECT id, kind, title, starts_at, ends_at, location, sport, image FROM events WHERE club_id = ? AND status = 'published' AND starts_at >= date('now') ORDER BY starts_at LIMIT 6", f.id);
  return render(c, f.name, (
    <article class="article">
      <PageHead title={f.name} crumbs={[{ title: 'Aðildarfélög', path: '/adildarfelog' }]} />
      <div class="wrap club-layout">
        <aside class="club-card">
          {f.logo && <img src={f.logo} alt={'Merki ' + f.name} />}
          <dl class="facts-list">
            {f.sports && <div><dt>Íþróttagreinar</dt><dd>{f.sports}</dd></div>}
            {f.area && <div><dt>Sveitarfélag</dt><dd>{f.area}</dd></div>}
            {f.contact_name && <div><dt>Formaður / tengiliður</dt><dd>{f.contact_name}</dd></div>}
            {f.email && <div><dt>Netfang</dt><dd><a href={'mailto:' + f.email}>{f.email}</a></dd></div>}
            {f.phone && <div><dt>Sími</dt><dd>{f.phone}</dd></div>}
            {f.website && <div><dt>Vefur</dt><dd><a href={f.website} rel="noopener">{f.website.replace(/^https?:\/\//, '')}</a></dd></div>}
            {f.kennitala && <div><dt>Kennitala</dt><dd>{f.kennitala}</dd></div>}
            {(f.facebook || f.instagram || f.tiktok || f.youtube) && (
              <div><dt>Samfélagsmiðlar</dt><dd class="social">
                {[['Facebook', f.facebook], ['Instagram', f.instagram], ['TikTok', f.tiktok], ['YouTube', f.youtube]].filter(([, u]) => u).map(([l, u]) => <a href={u} rel="noopener">{l}</a>)}
              </dd></div>
            )}
          </dl>
        </aside>
        <div class="article-body">
          <Prose html={f.description} />
          {events.length > 0 && <><h2>Á döfinni</h2><ul class="event-list">{events.map((e) => <EventItem e={e} />)}</ul></>}
          {news.length > 0 && <><h2>Fréttir frá félaginu</h2><div class="news-grid">{news.map((n) => <NewsCard n={n} />)}</div></>}
        </div>
      </div>
    </article>
  ));
});

app.get('/album/:slug', async (c) => {
  const a = await one<{ id: number; title: string; date: string; description: string }>(c.env.DB, 'SELECT * FROM albums WHERE slug = ?', c.req.param('slug'));
  if (!a) return notFound(c);
  const photos = await all<{ src: string; caption: string }>(c.env.DB, 'SELECT src, caption FROM photos WHERE album_id = ? ORDER BY sort, id', a.id);
  return render(c, a.title, (
    <>
      <PageHead title={a.title} crumbs={[{ title: 'Myndir', path: '/frettir/myndir' }]} lead={a.date.slice(0, 4)} />
      <div class="wrap block">
        {a.description && <Prose html={a.description} />}
        <div class="gallery" data-gallery>
          {photos.map((p, i) => (
            <a href={p.src} data-index={i} data-caption={p.caption}>
              <img src={p.src} alt={p.caption} loading="lazy" />
            </a>
          ))}
        </div>
        {photos.length === 0 && <p class="muted">Engar myndir í þessu albúmi enn.</p>}
      </div>
    </>
  ), { image: photos[0]?.src });
});

// ---------- Leit ----------

app.get('/leit', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 100);
  type Hit = { type: string; title: string; url: string; date: string; snippet: string };
  let hits: Hit[] = [];
  if (q.length >= 2) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const db = c.env.DB;
    const [n, p, e, r, f, d] = await Promise.all([
      all<{ slug: string; title: string; published_at: string; body: string }>(db, "SELECT slug, title, published_at, body FROM news WHERE status = 'published' AND (title LIKE ? OR body LIKE ?) ORDER BY published_at DESC LIMIT 40", like, like),
      all<{ path: string; title: string; body: string }>(db, "SELECT path, title, body FROM pages WHERE status = 'published' AND (title LIKE ? OR body LIKE ?) LIMIT 20", like, like),
      all<{ id: number; title: string; starts_at: string; description: string }>(db, "SELECT id, title, starts_at, description FROM events WHERE status = 'published' AND (title LIKE ? OR description LIKE ?) ORDER BY starts_at DESC LIMIT 20", like, like),
      all<{ id: number; title: string; date: string; body: string }>(db, "SELECT id, title, date, body FROM results WHERE status = 'published' AND (title LIKE ? OR body LIKE ?) ORDER BY date DESC LIMIT 20", like, like),
      all<{ slug: string; name: string; sports: string }>(db, 'SELECT slug, name, sports FROM clubs WHERE name LIKE ? OR sports LIKE ? LIMIT 20', like, like),
      all<{ id: number; title: string; date: string; file: string; body: string }>(db, 'SELECT id, title, date, file, body FROM documents WHERE title LIKE ? OR body LIKE ? ORDER BY date DESC LIMIT 20', like, like),
    ]);
    hits = [
      ...p.map((x) => ({ type: 'Síða', title: x.title, url: '/' + x.path, date: '', snippet: plainText(x.body, 160) })),
      ...f.map((x) => ({ type: 'Félag', title: x.name, url: '/felag/' + x.slug, date: '', snippet: x.sports })),
      ...n.map((x) => ({ type: 'Frétt', title: x.title, url: '/frett/' + x.slug, date: x.published_at, snippet: plainText(x.body, 160) })),
      ...e.map((x) => ({ type: 'Viðburður', title: x.title, url: '/vidburdur/' + x.id, date: x.starts_at, snippet: plainText(x.description, 160) })),
      ...r.map((x) => ({ type: 'Úrslit', title: x.title, url: '/urslit/' + x.id, date: x.date, snippet: '' })),
      ...d.map((x) => ({ type: 'Skjal', title: x.title, url: x.file || '/um-hsk/fundargerdir', date: x.date, snippet: plainText(x.body, 120) })),
    ];
  }
  return render(c, 'Leit', (
    <>
      <PageHead title="Leit" />
      <div class="wrap block narrow">
        <form action="/leit" method="get" class="filter-row search-big" role="search" aria-label="Leita á vefnum">
          <FilterField id="q" label="Leit"><input id="q" name="q" type="search" value={q} placeholder="Hverju ertu að leita að?" autofocus /></FilterField>
          <button class="btn">Leita</button>
        </form>
        {q.length >= 2 && <p class="muted">{hits.length} niðurstöður fyrir „{q}“</p>}
        <ol class="search-hits">
          {hits.map((h) => (
            <li>
              <span class="hit-type">{h.type}</span>
              <a href={h.url}><strong>{h.title}</strong></a>
              {h.date && <time> · {dateLong(h.date)}</time>}
              {h.snippet && <p>{h.snippet}</p>}
            </li>
          ))}
        </ol>
      </div>
    </>
  ));
});

// ---------- RSS ----------

app.get('/rss.xml', async (c) => {
  const rows = await all<NewsRow>(c.env.DB, "SELECT slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE status = 'published' AND published_at <= datetime('now') ORDER BY published_at DESC LIMIT 30");
  const site = c.env.SITE_URL;
  const items = rows.map((n) => `<item><title>${escapeHtml(n.title)}</title><link>${site}/frett/${n.slug}</link><guid>${site}/frett/${n.slug}</guid><pubDate>${new Date(n.published_at.replace(' ', 'T') + 'Z').toUTCString()}</pubDate><description>${escapeHtml(n.excerpt || plainText(n.body, 300))}</description></item>`).join('');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fréttir HSK</title><link>${site}</link><description>Fréttir frá Héraðssambandinu Skarphéðni</description><language>is</language>${items}</channel></rss>`, 200, { 'content-type': 'application/rss+xml; charset=utf-8' });
});

// ---------- Myndir og skjöl úr R2 ----------

app.get('/media/*', async (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice('/media/'.length));
  if (key.startsWith('private/')) return c.text('Skrá fannst ekki', 404);
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.text('Skrá fannst ekki', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
});

// ---------- Umsókn í Verkefnasjóð ----------

const GrantForm = ({ fields, intro, values = {}, error }: { fields: GrantField[]; intro?: string; values?: Record<string, string>; error?: string }) => (
  <section class="grant" id="umsokn">
    <h2>Sækja um styrk</h2>
    <p class="muted">{intro || 'Reitir merktir * eru nauðsynlegir. Umsóknin berst skrifstofu HSK.'}</p>
    {error && <p class="form-error" role="alert">{error}</p>}
    <form method="post" action="/umsokn/verkefnasjodur" enctype="multipart/form-data" class="grant-form">
      {fields.map((f) => {
        const id = 'g-' + f.name;
        const label = <label for={id}>{f.label}{f.required && ' *'}</label>;
        let input;
        switch (f.type) {
          case 'textarea': input = <textarea id={id} name={f.name} rows={6} required={f.required}>{values[f.name] ?? ''}</textarea>; break;
          case 'select': input = (
            <select id={id} name={f.name} required={f.required}>
              <option value="">Veldu</option>
              {(f.options ?? []).map((o) => <option value={o} selected={values[f.name] === o}>{o}</option>)}
            </select>
          ); break;
          case 'checkbox': return (
            <div class={'gf' + (f.half ? ' half' : '')}>
              <label class="gf-check"><input id={id} name={f.name} type="checkbox" value="1" checked={!!values[f.name]} required={f.required} /> {f.label}{f.required && ' *'}</label>
              {f.help && <small>{f.help}</small>}
            </div>
          );
          case 'file': input = <input id={id} name={f.name} type="file" required={f.required} accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.ods,.jpg,.jpeg,.png" />; break;
          default: input = <input id={id} name={f.name} type={f.type === 'number' ? 'text' : (f.type ?? 'text')} inputmode={f.type === 'number' || f.name === 'kennitala' ? 'numeric' : undefined} value={values[f.name] ?? ''} required={f.required} />;
        }
        return (
          <div class={'gf' + (f.half ? ' half' : '')}>
            {label}{input}
            {f.help && <small>{f.help}</small>}
          </div>
        );
      })}
      <div class="gf hp" aria-hidden="true"><label for="g-vefsida">Vefsíða</label><input id="g-vefsida" name="vefsida" tabindex={-1} autocomplete="off" /></div>
      <div class="gf half">
        <label for="g-daemi">Hver er summan af tveimur og þremur? *</label>
        <input id="g-daemi" name="daemi" inputmode="numeric" required autocomplete="off" />
        <small>Svaraðu með tölustöfum. Þetta ver formið gegn ruslpósti.</small>
      </div>
      <div class="gf"><button class="btn-hero solid">Senda umsókn</button></div>
    </form>
  </section>
);

/** Tengill sem stendur einn í málsgrein og vísar á kafla á annarri síðu (t.d. reglugerð í Lögum og reglugerðum,
 *  „/um-hsk/log-og-reglugerdir#reglugerd-…“) birtist sem fellilisti með texta kaflans á staðnum. */
async function inlineSections(db: D1Database, html: string): Promise<string> {
  const re = /<p>\s*<a href="\/([^"#?]+?)\/?#([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/p>/g;
  const hits = [...html.matchAll(re)];
  if (!hits.length) return html;
  const chevron = (<Icon name="chevronDown" />).toString();
  for (const m of hits) {
    const ch = await one<{ body: string }>(db, "SELECT body FROM pages WHERE path = ? AND status = 'published'", `${m[1]}/${m[2]}`);
    if (!ch?.body) continue;
    html = html.replace(m[0], `<div class="accordion inline-acc"><details class="acc" id="${m[2]}"><summary>${m[3]}${chevron}</summary><div class="acc-body">${ch.body}</div></details></div>`);
  }
  return html;
}

/** Úthlutanir sem voru samþykktar og birtar í vefumsjón; bætast við töfluna úr gamla vefnum */
async function grantExtras(db: D1Database): Promise<ExtraAward[]> {
  return all<ExtraAward>(db,
    `SELECT award_recipient AS recipient, award_project AS project, award_amount AS amount, award_year AS year, award_round AS roundId
     FROM applications WHERE decision = 'samthykkt' AND award_published = 1 AND award_year IS NOT NULL`);
}

const GrantClosed = ({ text }: { text: string }) => (
  <section class="grant" id="umsokn">
    <h2>Lokað fyrir umsóknir</h2>
    <p>{text || 'Ekki er tekið við umsóknum í Verkefnasjóð eins og er. Opnað verður fyrir umsóknir fyrir næstu úthlutun og það auglýst hér á vefnum.'}</p>
  </section>
);

app.post('/umsokn/verkefnasjodur', async (c) => {
  if ((await getSetting(c.env.DB, 'grant_open', '1')) !== '1') return c.redirect('/um-hsk/verkefnasjodur#umsokn', 303);
  const form = await c.req.formData();
  const r = await saveGrant(c.env, form);
  if (!r.error) return c.redirect('/um-hsk/verkefnasjodur?umsokn=send#umsokn', 303);
  return render(c, 'Umsókn í Verkefnasjóð', (
    <>
      <PageHead title="Umsókn í Verkefnasjóð" />
      <div class="wrap block"><GrantForm fields={await grantForm(c.env.DB)} intro={await getSetting(c.env.DB, 'grant_form_intro', '')} values={r.values} error={r.error} /></div>
    </>
  ), { status: 400 });
});

// ---------- Gamlar slóðir af hsk.is ----------

app.get('/web/*', async (c) => {
  const u = new URL(c.req.url);
  const page = u.searchParams.get('page') || '';
  const id = u.searchParams.get('frett_id') || u.searchParams.get('id') || u.searchParams.get('grein') || u.searchParams.get('flokkur') || '';
  const file = u.pathname.split('/').pop() || '';
  const key = `${file === 'myndir_yfirl.cfm' ? 'myndir' : page}:${id}`;
  const hit = await one<{ new_path: string }>(c.env.DB, 'SELECT new_path FROM redirects WHERE old_key = ?', key);
  if (hit) return c.redirect(hit.new_path, 301);
  if (page === 'frettirnar' && id) {
    const n = await one<{ slug: string }>(c.env.DB, 'SELECT slug FROM news WHERE legacy_id = ?', parseInt(id, 10));
    if (n) return c.redirect('/frett/' + n.slug, 301);
  }
  const sections: Record<string, string> = {
    frettir: '/frettir', frettir_old: '/frettir', adsgr: '/frettir/greinar', felog: '/adildarfelog', nefndir: '/um-hsk/stjorn-nefndir-og-rad',
    log: '/um-hsk/log-og-reglugerdir', fundarg: '/um-hsk/fundargerdir', urslit: '/mot/urslit', motaskra: '/mot/dagskra?tegund=mot', vidburdir_l: '/mot/dagskra',
    myndir: '/frettir/myndir', hsk_met_b: '/mot/hsk-met', hsk: '/um-hsk', verkefnasjodur: '/um-hsk/verkefnasjodur',
  };
  return c.redirect(sections[page] ?? '/', 301);
});

// ---------- Síður úr veftré (allar aðrar slóðir) ----------

async function sectionPages(db: D1Database, path: string) {
  return all<{ title: string; path: string }>(db,
    "SELECT title, path FROM pages WHERE parent_id = (SELECT id FROM pages WHERE path = ?) AND in_menu = 1 AND status = 'published' ORDER BY sort, title COLLATE NOCASE", path);
}

app.get(`${RECORDS_PATH}/gogn`, async (c) => {
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  return c.json((await catalogueRows(c.env)).map(({ key, ...row }) => row));
});

app.get(`${RECORDS_PATH}/skra/:id`, async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  let book: RecordBook | undefined = recordBook(id);
  const uploaded = /^innflutt-(\d+)$/.exec(id);
  if (uploaded) {
    const row = await one<{ file: string; title: string; updated_at: string }>(db,
      "SELECT file, title, updated_at FROM records WHERE id = ? AND category <> 'reglur'", Number(uploaded[1]));
    const key = row && uploadedRecordKey(row.file);
    if (!row || !key) return notFound(c);
    const data = await c.env.MEDIA.get(key);
    if (!data) return c.redirect(row.file);
    book = { id, title: row.title, source: row.file, updatedAt: row.updated_at, sheets: await data.json<RecordSheet[]>() };
  }
  if (!book) return notFound(c);
  const [parent, tabs] = await Promise.all([one<{ title: string; module: string }>(db, "SELECT title, module FROM pages WHERE path = 'mot' AND status = 'published'"), sectionPages(db, 'mot')]);
  return render(c, book.title, (
    <>
      <PageHead title={book.title} />
      {parent && <SectionTabs title={parent.title} path={`${RECORDS_PATH}/skra/${id}`} tabs={tabs.map((tab) => ({ ...tab, path: '/' + tab.path }))}
        overview={parent.module !== 'first' ? '/mot' : undefined} />}
      <RecordBookView book={book} sheetParam={c.req.query('blad')} query={c.req.query('q')} />
    </>
  ), { fresh: !!uploaded });
});

app.get('/*', async (c) => {
  const path = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('.')) return notFound(c);
  const p = await one<PageRow>(c.env.DB, "SELECT * FROM pages WHERE path = ? AND status = 'published'", path);
  if (!p) return notFound(c);
  if (p.parent_id) {
    // Undirsíður sem birtast á yfirsíðunni sjálfri vísa á sinn kafla þar
    const par = await one<{ path: string; module: string }>(c.env.DB, 'SELECT path, module FROM pages WHERE id = ?', p.parent_id);
    if (par && ['sections', 'archive', 'laws'].includes(par.module)) return c.redirect(`/${par.path}#${p.slug}`, 301);
    // Undirsíða skjalasafns er inngangur að samnefndum flokki (t.d. Verkefnasjóður)
    if (par && par.module === 'documents') return c.redirect(`/${par.path}?flokkur=${p.slug}`, 301);
  }
  if (p.module === 'first') {
    const first = await one<{ path: string }>(c.env.DB, "SELECT path FROM pages WHERE parent_id = ? AND in_menu = 1 AND status = 'published' ORDER BY sort, title COLLATE NOCASE LIMIT 1", p.id);
    if (first) return c.redirect('/' + first.path, 302);
  }
  const crumbs: { title: string; path: string }[] = [];
  let parentId = p.parent_id;
  while (parentId) {
    const par = await one<PageRow>(c.env.DB, 'SELECT id, parent_id, title, path FROM pages WHERE id = ?', parentId);
    if (!par) break;
    crumbs.unshift({ title: par.title, path: '/' + par.path });
    parentId = par.parent_id;
  }
  const children = await all<PageRow>(c.env.DB, "SELECT title, slug, path, body FROM pages WHERE parent_id = ? AND status = 'published' ORDER BY sort, title COLLATE NOCASE", p.id);
  const base = '/' + p.path;
  let moduleView: Child = null;
  switch (p.module) {
    case 'news': moduleView = <NewsListing data={await newsList(c)} base={base} />; break;
    case 'articles': moduleView = <NewsListing data={await newsList(c, ['grein', 'adsend'])} base={base} />; break;
    case 'submitted': moduleView = <NewsListing data={await newsList(c, 'adsend')} base={base} />; break;
    case 'events': moduleView = <EventListing data={await eventList(c, null)} base={base} />; break;
    case 'competitions': moduleView = <EventListing data={await eventList(c, 'mot')} base={base} />; break;
    case 'results': {
      const d = await resultList(c);
      const groups = new Map<string, typeof d.rows>();
      for (const r of d.rows) { const k = monthYear(r.date); groups.set(k, [...(groups.get(k) ?? []), r]); }
      moduleView = (
        <>
          <form action={base} method="get" class="filter-row" role="search" aria-label="Leita í úrslitum" data-section-search>
            <SectionSearchField term={d.term} placeholder="Mót, íþróttagrein eða nafn" />
            <FilterField id="ar" label="Ár">
              <select id="ar" name="ar">
                {d.years.map((y) => <option selected={y === d.year}>{y}</option>)}
                <option value="oll" selected={d.year === 'oll'}>Öll ár</option>
              </select>
            </FilterField>
            <FilterField id="grein" label="Íþróttagrein">
              <select id="grein" name="grein">
                <option value="">Allar greinar</option>
                {d.sports.map((s) => <option selected={s === d.sport}>{s}</option>)}
              </select>
            </FilterField>
            <button class="btn">Leita</button>
          </form>
          <div id="section-results" data-count={d.rows.length}>
            {d.rows.length === 0 && <p class="muted">Engin úrslit fundust.</p>}
            {[...groups].map(([month, list]) => (
              <section class="month-group">
                <h2>{month}</h2>
                <ul class="event-list wide">{list.map((r) => <ResultItem r={r} />)}</ul>
              </section>
            ))}
          </div>
        </>
      );
      break;
    }
    case 'records': {
      // Metaskrár á spjöldum eftir flokki; nýjasta árið efst og eldri ár sem tenglar
      const rows = await all<{ id: number; title: string; category: string; year: number | null; file: string; body: string }>(c.env.DB, 'SELECT id, title, category, year, file, body FROM records ORDER BY year DESC, title');
      const archiveFiles = new Set(recordEditions.map((edition) => edition.file));
      const hasPublishedArchive = rows.some((r) => archiveFiles.has(r.file));
      const groups = Object.entries(RECORD_CATEGORIES).filter(([k]) => k !== 'reglur')
        .map(([k, label]) => {
          const fromDb = rows.filter((r) => r.category === k && r.file);
          const archive = hasPublishedArchive ? [] : recordEditions.filter((r) => r.category === label).map((r) => ({ ...r, id: null }));
          return [label, [...fromDb, ...archive].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))] as const;
        }).filter(([, l]) => l.length);
      const rules = rows.filter((r) => r.category === 'reglur' || (!r.file && r.body));
      moduleView = (
        <>
          <RecordCatalogue rows={await catalogueRows(c.env)} />
          {rules.length > 0 && <div class="accordion">{rules.map((r) => <details class="acc"><summary>{r.title}<Icon name="chevronDown" /></summary><div class="acc-body"><Prose html={r.body} /></div></details>)}</div>}
          <details class="acc record-archive">
            <summary>Frumskrár og eldri útgáfur<Icon name="chevronDown" /></summary>
            <div class="acc-body record-grid">
            {groups.map(([label, list]) => {
              if (label === 'Önnur met') {
                return <section class="record-card"><h2>{label}</h2><div class="prose"><ul class="link-list">{list.map((d) => <li><a href={recordLink(d.file, d.id)}>{d.title}</a></li>)}</ul></div></section>;
              }
              const [latest, ...older] = list;
              return (
                <section class="record-card">
                  <h2>{label}</h2>
                  <a class="record-latest" href={recordLink(latest.file, latest.id)}><Icon name="chevronRight" />Metaskrá {latest.year ?? ''}</a>
                  {older.length > 0 && <p class="record-older"><span>Eldri:</span> {older.map((d, i) => <>{i > 0 && ' · '}<a href={recordLink(d.file, d.id)}>{d.year ?? d.title}</a></>)}</p>}
                </section>
              );
            })}
            </div>
          </details>
        </>
      );
      break;
    }
    case 'grant': {
      // Opið eða lokað fyrir umsóknir er stillt í vefumsjón (Umsóknir í Verkefnasjóð)
      const open = (await getSetting(c.env.DB, 'grant_open', '1')) === '1';
      const application = c.req.query('umsokn') === 'send'
        ? <section class="grant" id="umsokn"><h2>Umsókn móttekin</h2><p class="form-ok" role="status">Takk fyrir. Umsóknin hefur borist skrifstofu HSK og verður tekin fyrir við næstu úthlutun.</p></section>
        : open ? <GrantForm fields={await grantForm(c.env.DB)} intro={await getSetting(c.env.DB, 'grant_form_intro', '')} /> : <GrantClosed text={await getSetting(c.env.DB, 'grant_closed_text', '')} />;
      moduleView = <><GrantAwards params={c.req.query()} script={asset('/js/grant-awards.js')} extra={await grantExtras(c.env.DB)} />{application}</>;
      break;
    }
    case 'assemblies': {
      // Héraðsþing úr vefumsjón (Héraðsþing): nýjasta þingið opið efst, eldri þing í felligluggum
      const list = await all<{ id: number; slug: string; title: string; date: string | null; location: string; intro: string }>(c.env.DB,
        "SELECT id, slug, title, date, location, intro FROM assemblies WHERE status = 'published' ORDER BY date DESC, id DESC");
      const docs = await all<{ assembly_id: number; title: string; file: string }>(c.env.DB, 'SELECT assembly_id, title, file FROM assembly_docs ORDER BY sort, id');
      const body = (a: (typeof list)[number]) => {
        const mine = docs.filter((d) => d.assembly_id === a.id);
        return (
          <>
            {a.date && <p class="muted">{dateLong(a.date)}{a.location && ` · ${a.location}`}</p>}
            {a.intro && <Prose html={a.intro} />}
            {mine.length > 0
              ? <div class="prose"><ul class="link-list">{mine.map((d) => <li><a href={d.file}>{d.title}</a></li>)}</ul></div>
              : <p class="muted">Þinggögn verða birt hér.</p>}
          </>
        );
      };
      const [latest, ...older] = list;
      moduleView = latest ? (
        <>
          <section class="merged" id={latest.slug}><h2>{latest.title}</h2>{body(latest)}</section>
          {older.length > 0 && <h2 class="older-h">Eldri þing</h2>}
          <div class="accordion">{older.map((a) => <details class="acc" id={a.slug}><summary>{a.title}<Icon name="chevronDown" /></summary><div class="acc-body">{body(a)}</div></details>)}</div>
        </>
      ) : null;
      break;
    }
    case 'sections':
    case 'archive': {
      // Undirsíður birtar á einni síðu: „sections“ með efnisyfirliti, „archive“ með nýjasta opið og eldra í felligluggum
      if (p.module === 'sections') {
        // Hver kafli opnast í felliglugga þegar smellt er á hann
        moduleView = (
          <div class="accordion">
            {children.map((ch) => <details class="acc" id={ch.slug}><summary>{ch.title}<Icon name="chevronDown" /></summary><div class="acc-body"><Prose html={ch.body} /></div></details>)}
          </div>
        );
      } else {
        const [latest, ...older] = children;
        moduleView = latest ? (
          <>
            <section class="merged" id={latest.slug}><h2>{latest.title}</h2><Prose html={latest.body} /></section>
            {older.length > 0 && <h2 class="older-h">Eldri þing</h2>}
            <div class="accordion">{older.map((ch) => <details class="acc" id={ch.slug}><summary>{ch.title}<Icon name="chevronDown" /></summary><div class="acc-body"><Prose html={ch.body} /></div></details>)}</div>
          </>
        ) : null;
      }
      break;
    }
    case 'clubs': {
      const rows = await all<{ slug: string; name: string; logo: string; sports: string; area: string }>(c.env.DB, 'SELECT slug, name, logo, sports, area FROM clubs ORDER BY name');
      moduleView = (
        <>
          <div class="filter-row filter-compact" role="search" aria-label="Leita að félagi">
            <FilterField id="felag-leit" label="Leit">
              <input id="felag-leit" type="search" placeholder="Nafn félags, íþróttagrein eða svæði" value={c.req.query('q') ?? ''} data-filter=".club-grid > a" data-empty="#felag-tomt" />
            </FilterField>
          </div>
          <p id="felag-tomt" class="filter-empty" hidden>Ekkert félag fannst.</p>
          <div class="club-grid">
            {rows.map((f) => (
              <a href={'/felag/' + f.slug} data-text={`${f.name} ${f.sports} ${f.area}`.toLowerCase()}>
                <span class="club-logo">{f.logo ? <img src={f.logo} alt="" loading="lazy" /> : f.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3)}</span>
                <span><strong>{f.name}</strong><small>{f.sports}</small></span>
              </a>
            ))}
          </div>
        </>
      );
      break;
    }
    case 'committees': {
      const rows = await all<{ name: string; body: string }>(c.env.DB, 'SELECT name, body FROM committees ORDER BY sort, name');
      moduleView = (
        <>
          <div class="filter-row filter-compact" role="search" aria-label="Leita í stjórn, nefndum og ráðum">
            <FilterField id="nefnd-leit" label="Leit">
              <input id="nefnd-leit" type="search" placeholder="Nafn nefndar eða einstaklings" data-filter=".committee-list > details" data-empty="#nefnd-tomt" />
            </FilterField>
          </div>
          <p id="nefnd-tomt" class="filter-empty" hidden>Engin nefnd eða manneskja fannst.</p>
          {/* Hver nefnd opnast í felliglugga; leit opnar þær sem passa */}
          <div class="accordion committee-list">{rows.map((r) => (
            <details class="acc" id={slugify(r.name)} data-text={`${r.name} ${plainText(r.body)}`.toLowerCase()}>
              <summary>{r.name}<Icon name="chevronDown" /></summary>
              <div class="acc-body"><Prose html={r.body} /></div>
            </details>
          ))}</div>
        </>
      );
      break;
    }
    case 'documents': {
      const cat = c.req.query('flokkur') || '';
      const rows = await all<{ id: number; title: string; category: string; date: string; file: string; body: string }>(c.env.DB,
        `SELECT * FROM documents ${cat ? 'WHERE category = ?' : ''} ORDER BY date DESC LIMIT 400`, ...(cat ? [cat] : []));
      const cats: Record<string, string> = { fundargerd: 'Fundargerðir', arsskyrsla: 'Ársskýrslur', log: 'Lög og reglugerðir', eydublad: 'Eyðublöð', aaetlun: 'Stefnur og áætlanir', met: 'Metaskrár', annad: 'Annað' };
      // Inngangstexti flokks: undirsíða skjalasafnsins með sama slóðarheiti og flokkurinn
      const intro = cat ? children.find((ch) => ch.slug === cat) : undefined;
      // Aðeins flokkar sem innihalda skjöl fá hnapp
      const used = new Set((await all<{ category: string }>(c.env.DB, 'SELECT DISTINCT category FROM documents')).map((r) => r.category));
      const shown = Object.entries(cats).filter(([k]) => used.has(k));
      moduleView = (
        <>
          {shown.length > 1 && <div class="filter-row">
            <FilterOptions label="Flokkur">
              <a href={base} aria-current={!cat ? 'true' : undefined}>Allir flokkar</a>
              {shown.map(([k, v]) => <a href={`${base}?flokkur=${k}`} aria-current={cat === k ? 'true' : undefined}>{v}</a>)}
            </FilterOptions>
          </div>}
          {intro && <div class="cat-intro"><Prose html={intro.body} /></div>}
          <ul class="doc-list">
            {rows.map((d) => (
              <li>
                <time>{dateLong(d.date)}</time>
                {d.file ? <div class="doc-main"><a href={d.file}><Icon name="file" />{d.title}</a>{d.body && <div class="doc-desc"><Prose html={d.body} /></div>}</div> : <details><summary>{d.title}</summary><Prose html={d.body} /></details>}
                <span class="muted small">{cats[d.category] ?? d.category}</span>
              </li>
            ))}
          </ul>
        </>
      );
      break;
    }
    case 'albums': {
      const page = pageNum(c);
      const rows = await all<{ slug: string; title: string; cover: string; date: string }>(c.env.DB, 'SELECT slug, title, cover, date FROM albums ORDER BY date DESC LIMIT ? OFFSET ?', 25, (page - 1) * 24);
      moduleView = (
        <>
          <div class="album-grid">
            {rows.slice(0, 24).map((a) => (
              <a class="album-card" href={'/album/' + a.slug}>
                <div class="thumb">{a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <img class="ph" src="/img/hsk-merki.svg" alt="" />}</div>
                <strong>{a.title}</strong><small>{a.date.slice(0, 4)}</small>
              </a>
            ))}
          </div>
          <Pager page={page} hasNext={rows.length > 24} base={base} />
        </>
      );
      break;
    }
    case 'subpages':
    case 'laws': {
      // Sjálfvirkur tenglalisti yfir undirsíður. „laws“ flokkar í Lög, Reglugerðir og Aðrar reglur eftir upphafi titils.
      const list = (items: PageRow[]) => (
        <ul class="link-list">{items.map((ch) => <li><a href={'/' + ch.path}>{ch.title}</a></li>)}</ul>
      );
      if (p.module === 'subpages') {
        moduleView = <div class="prose">{list(children)}</div>;
      } else {
        const groups: [string, PageRow[]][] = [
          ['Lög', children.filter((ch) => /^lög\b/i.test(ch.title))],
          ['Reglugerðir', children.filter((ch) => /^reglugerð/i.test(ch.title))],
        ];
        groups.push(['Aðrar reglur', children.filter((ch) => !groups.some(([, g]) => g.includes(ch)))]);
        // Hver regla opnast í felliglugga innan síns flokks
        moduleView = groups.filter(([, g]) => g.length).map(([title, g]) => (
          <section class="acc-group">
            <h2>{title}</h2>
            <div class="accordion">{g.map((ch) => <details class="acc" id={ch.slug}><summary>{ch.title}<Icon name="chevronDown" /></summary><div class="acc-body"><Prose html={ch.body} /></div></details>)}</div>
          </section>
        ));
      }
      break;
    }
    case 'sponsors': {
      const rows = await all<{ name: string; logo: string; url: string; tier: string }>(c.env.DB, "SELECT name, logo, url, tier FROM sponsors ORDER BY CASE tier WHEN 'adalstyrktaradili' THEN 0 WHEN 'styrktaradili' THEN 1 ELSE 2 END, sort, name");
      const tiers: Record<string, string> = { adalstyrktaradili: 'Aðalstyrktaraðilar', styrktaradili: 'Styrktaraðilar', samstarfsadili: 'Samstarfsaðilar' };
      moduleView = Object.entries(tiers).map(([k, label]) => {
        const list = rows.filter((r) => r.tier === k);
        return list.length ? (
          <section class="sponsor-section"><h2>{label}</h2>
            <div class="sponsor-grid">{list.map((s) => <a href={s.url || undefined} rel="noopener">{s.logo ? <img src={s.logo} alt={s.name} /> : <strong>{s.name}</strong>}</a>)}</div>
          </section>
        ) : null;
      });
      break;
    }
  }
  // Hliðarvalmynd hlutans (t.d. allt undir „Um HSK“): síður sem eru í valmynd, núverandi síða merkt
  const top = p.parent_id ? crumbs[0] : { title: p.title, path: '/' + p.path };
  const sectionPath = top.path.slice(1);
  const section = await sectionPages(c.env.DB, sectionPath);
  const topModule = p.parent_id ? (await one<{ module: string }>(c.env.DB, 'SELECT module FROM pages WHERE path = ?', sectionPath))?.module : p.module;
  // Undirsíður sem eru hvorki í valmynd né tengdar í textanum birtast sem listi neðst
  const linked = new Set([...p.body.matchAll(/href="\/?([^"#?]+)/g)].map((m) => m[1].replace(/\/$/, '')));
  const inNav = new Set(section.map((x) => x.path));
  const extra = p.module ? [] : children.filter((ch) => !linked.has(ch.path) && !inNav.has(ch.path));
  const body = await inlineSections(c.env.DB, p.module === 'grant' ? grantPageIntro(p.body) : p.body);
  return render(c, p.title, (
    <>
      <PageHead title={p.title} crumbs={crumbs} />
      <SectionTabs title={top.title} path={'/' + p.path} tabs={section.map((tab) => ({ ...tab, path: '/' + tab.path }))}
        overview={topModule !== 'first' ? top.path : undefined} />
      <div class="wrap block page-layout">
        <div class="page-main">
          {body && <Prose html={body} />}
          {moduleView}
          {extra.length > 0 && <div class="prose"><ul class="link-list">{extra.map((ch) => <li><a href={'/' + ch.path}>{ch.title}</a></li>)}</ul></div>}
        </div>
      </div>
    </>
  ), { description: plainText(p.body, 160) || undefined, lang: p.path === 'en' ? 'en' : undefined, fresh: p.module === 'records' });
});

export async function notFound(c: Context<AppEnv>) {
  return render(c, 'Síða fannst ekki', (
    <>
      <PageHead title="Síða fannst ekki" />
      <div class="wrap block narrow">
        <p>Síðan sem þú leitaðir að er ekki til eða hefur verið færð.</p>
        <form action="/leit" method="get" class="filter-row search-big" role="search" aria-label="Leita á vefnum">
          <FilterField id="q404" label="Leit"><input id="q404" name="q" type="search" placeholder="Leita á vefnum…" /></FilterField>
          <button class="btn">Leita</button>
        </form>
        <p><a href="/"><Icon name="chevronLeft" />Forsíða</a></p>
      </div>
    </>
  ), { status: 404 });
}

export default app;
