import { Hono, type Context } from 'hono';
import type { Child } from 'hono/jsx';
import {
  type AppEnv, all, one, getSetting, dateLong, dateShort, dayNum, monthShort, today, plainText, weekday, timeOf, monthYear, escapeHtml,
} from '../lib';
import {
  Layout, PageHead, NewsCard, EventItem, ResultItem, Pager, Prose,
  type MenuItem, type SiteChrome, type NewsRow, type EventRow,
} from '../views/site';
import { Icon } from '../views/icons';

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
     ORDER BY CASE tier WHEN 'adalstyrktaradili' THEN 0 WHEN 'styrktaradili' THEN 1 ELSE 2 END, sort, name`, d, d);
  return {
    menu,
    sponsors,
    notice: await getSetting(db, 'notice'),
    contact: {
      address: await getSetting(db, 'contact_address', 'Selinu, Engjavegi 48, 800 Selfossi'),
      phone: await getSetting(db, 'contact_phone', '482 1189'),
      email: await getSetting(db, 'contact_email', 'hsk@hsk.is'),
    },
  };
}

async function render(c: Context<AppEnv>, title: string, body: Child, opts: { description?: string; image?: string; status?: number; lang?: string } = {}) {
  const ch = await chrome(c);
  const html = (
    <Layout title={title} chrome={ch} path={new URL(c.req.url).pathname} description={opts.description} image={opts.image} lang={opts.lang}>
      {body}
    </Layout>
  );
  c.header('Cache-Control', 'public, max-age=60');
  return c.html('<!doctype html>' + html.toString(), (opts.status ?? 200) as 200);
}

function pageNum(c: Context<AppEnv>) {
  return Math.max(1, parseInt(c.req.query('s') || '1', 10) || 1);
}

// ---------- Forsíða ----------

app.get('/', async (c) => {
  const db = c.env.DB;
  const featuredId = parseInt(await getSetting(db, 'featured_news_id', '0'), 10);
  let news = await all<NewsRow & { id: number }>(db, "SELECT id, slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE status = 'published' AND published_at <= datetime('now') ORDER BY published_at DESC LIMIT 6");
  let featured = featuredId ? await one<NewsRow & { id: number }>(db, "SELECT id, slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE id = ? AND status = 'published'", featuredId) : null;
  featured = featured ?? news[0] ?? null;
  news = news.filter((n) => n.id !== featured?.id).slice(0, 5);
  const events = await all<EventRow>(db, "SELECT id, kind, title, starts_at, ends_at, location, sport, image FROM events WHERE status = 'published' AND substr(coalesce(ends_at, starts_at), 1, 10) >= ? ORDER BY starts_at LIMIT 6", today());
  const results = await all<{ id: number; title: string; date: string; sport: string }>(db, "SELECT id, title, date, sport FROM results WHERE status = 'published' ORDER BY date DESC LIMIT 6");
  const quick = (await getSetting(db, 'quick_links', '')).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((l) => l[0] && l[1]);
  const albums = await all<{ slug: string; title: string; cover: string; date: string }>(db, 'SELECT slug, title, cover, date FROM albums ORDER BY date DESC LIMIT 4');

  return render(c, 'Forsíða', (
    <>
      <section class="home-hero">
        <div class="wrap hero-grid">
          {featured && (
            <article class="hero-main">
              <a href={'/frett/' + featured.slug}>
                {featured.image && <img src={featured.image} alt="" />}
                <div class="hero-txt">
                  <time>{dateLong(featured.published_at)}</time>
                  <h2>{featured.title}</h2>
                  <p>{featured.excerpt || plainText(featured.body, 160)}</p>
                </div>
              </a>
            </article>
          )}
          <div class="hero-side">
            {news.slice(0, 5).map((n) => (
              <a class="side-item" href={'/frett/' + n.slug}>
                <time>{dateShort(n.published_at)}</time>
                <strong>{n.title}</strong>
              </a>
            ))}
            <a class="more" href="/frettir">Allar fréttir<Icon name="chevronRight" /></a>
          </div>
        </div>
      </section>

      <section class="wrap block three-col">
        <div>
          <h2 class="col-title">Viðburðir framundan</h2>
          {events.length ? <ul class="event-list">{events.map((e) => <EventItem e={e} />)}</ul> : <p class="muted">Engir viðburðir skráðir á næstunni.</p>}
          <a class="more" href="/vidburdir">Viðburðadagatal<Icon name="chevronRight" /></a>
        </div>
        <div>
          <h2 class="col-title">Nýjustu úrslit</h2>
          {results.length ? <ul class="result-list">{results.map((r) => <ResultItem r={r} />)}</ul> : <p class="muted">Engin úrslit skráð.</p>}
          <a class="more" href="/mot/urslit">Öll úrslit<Icon name="chevronRight" /></a>
        </div>
        <div>
          <h2 class="col-title">Flýtileiðir</h2>
          <ul class="quick-list">
            {quick.map(([label, url]) => <li><a href={url}><Icon name="chevronRight" />{label}</a></li>)}
          </ul>
        </div>
      </section>

      {albums.length > 0 && (
        <section class="wrap block">
          <h2 class="col-title">Nýjar myndir</h2>
          <div class="album-grid">
            {albums.map((a) => (
              <a class="album-card" href={'/album/' + a.slug}>
                <div class="thumb">{a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <img class="ph" src="/img/hsk-merki.svg" alt="" />}</div>
                <strong>{a.title}</strong>
                <small>{a.date.slice(0, 4)}</small>
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  ), { description: 'Héraðssambandið Skarphéðinn (HSK) er héraðssamband íþrótta- og ungmennafélaga á Suðurlandi, stofnað 1910.' });
});

// ---------- Ný forsíða (prufa) ----------

app.get('/forsida-ny', async (c) => {
  const db = c.env.DB;
  const s = (k: string) => getSetting(db, k, '');
  const news = await all<NewsRow & { id: number }>(db, "SELECT id, slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE status = 'published' AND published_at <= datetime('now') ORDER BY published_at DESC LIMIT 4");
  // Stóra myndin: stillt í vefumsjón, annars nýjasta fréttin með mynd
  let hero = { title: await s('hero_title'), text: await s('hero_text'), image: await s('hero_image'), link: await s('hero_link'), button: await s('hero_button') };
  if (!hero.title) {
    const n = news.find((x) => x.image) ?? news[0];
    if (n) hero = { title: n.title, text: n.excerpt || plainText(n.body, 160), image: n.image, link: '/frett/' + n.slug, button: 'Lesa frétt' };
  }
  const cards = news.filter((n) => '/frett/' + n.slug !== hero.link).slice(0, 3);
  const events = await all<EventRow>(db, "SELECT id, kind, title, starts_at, ends_at, location, sport, image FROM events WHERE status = 'published' AND substr(coalesce(ends_at, starts_at), 1, 10) >= ? ORDER BY starts_at LIMIT 6", today());
  const results = await all<{ id: number; title: string; date: string; sport: string }>(db, "SELECT id, title, date, sport FROM results WHERE status = 'published' ORDER BY date DESC LIMIT 5");
  let records = await all<{ title: string; file: string }>(db, "SELECT title, file FROM documents WHERE category = 'met' ORDER BY date DESC, id DESC LIMIT 5");
  if (!records.length) records = (await all<{ title: string }>(db, 'SELECT title FROM records ORDER BY updated_at DESC, sort LIMIT 5')).map((r) => ({ title: r.title, file: '' }));
  const sports = [...new Set((await all<{ sports: string }>(db, "SELECT sports FROM clubs WHERE sports <> ''")).flatMap((r) => r.sports.split(/\s*,\s*/)).filter((x) => x && x !== 'Annað'))].sort((a, b) => a.localeCompare(b, 'is'));
  const clubCount = (await one<{ n: number }>(db, 'SELECT count(*) AS n FROM clubs'))?.n ?? 0;
  // Ein mynd úr hverju af nýjustu myndasöfnunum
  const photos = await all<{ src: string; slug: string; title: string }>(db, "SELECT coalesce(nullif(a.cover, ''), (SELECT src FROM photos p WHERE p.album_id = a.id ORDER BY sort LIMIT 1)) AS src, a.slug, a.title FROM albums a ORDER BY a.date DESC, a.id DESC LIMIT 6").then((r) => r.filter((x) => x.src));

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

      <section class="wrap h2-block">
        <div class="h2-head"><h2>Framundan</h2><a href="/vidburdir">Viðburðadagatal</a></div>
        {events.length ? (
          <ol class="h2-dates">
            {events.map((e) => (
              <li><a href={'/vidburdur/' + e.id}>
                <span class="d"><b>{dayNum(e.starts_at)}</b>{monthShort(e.starts_at)}</span>
                <strong>{e.title}</strong>
                <small>{[e.kind === 'mot' ? 'Mót' : '', e.sport, e.location].filter(Boolean).join(' · ') || weekday(e.starts_at)}</small>
              </a></li>
            ))}
          </ol>
        ) : <p class="muted">Engir viðburðir skráðir á næstunni.</p>}
      </section>

      {cards.length > 0 && (
        <section class="wrap h2-block">
          <div class="h2-head"><h2>Fréttir</h2><a href="/frettir">Allar fréttir</a></div>
          <div class="h2-news">{cards.map((n) => <NewsCard n={n} />)}</div>
        </section>
      )}

      <section class="h2-band">
        <div class="wrap h2-two">
          <div>
            <div class="h2-head"><h2>Nýjustu úrslit</h2><a href="/mot/urslit">Öll úrslit</a></div>
            <ul class="result-list">{results.map((r) => <ResultItem r={r} />)}</ul>
          </div>
          <div>
            <div class="h2-head"><h2>HSK met</h2><a href="/mot/hsk-met">Allar metaskrár</a></div>
            <ul class="h2-links">
              {records.map((r) => <li><a href={r.file || '/mot/hsk-met'}>{r.title}</a></li>)}
            </ul>
          </div>
        </div>
      </section>

      <section class="wrap h2-block h2-finder">
        <div>
          <h2>Finndu félag</h2>
          <p>{clubCount} íþrótta- og ungmennafélög á Suðurlandi eru aðilar að HSK. Leitaðu eftir nafni, íþróttagrein eða heimabyggð.</p>
        </div>
        <form action="/adildarfelog" method="get" class="h2-find" role="search">
          <label class="sr" for="ff-q">Leitarorð</label>
          <input id="ff-q" name="q" type="search" placeholder="T.d. Hamar, sund eða Hella" />
          <label class="sr" for="ff-g">Íþróttagrein</label>
          <select id="ff-g" data-fill-q>
            <option value="">Velja íþróttagrein</option>
            {sports.map((sp) => <option value={sp}>{sp}</option>)}
          </select>
          <button class="btn-hero">Leita</button>
        </form>
      </section>

      {photos.length > 0 && (
        <section class="wrap h2-block">
          <div class="h2-head"><h2>Myndir</h2><a href="/myndir">Öll myndasöfn</a></div>
          <div class="h2-photos">
            {photos.map((p) => <a href={'/album/' + p.slug} title={p.title}><img src={p.src} alt="" loading="lazy" /></a>)}
          </div>
        </section>
      )}

      <section class="wrap h2-block h2-tiles">
        <a href="/um-hsk/verkefnasjodur"><strong>Styrkir og sjóðir</strong><span>Verkefnasjóður HSK, umsóknir og úthlutanir</span></a>
        <a href="/um-hsk/log-og-reglugerdir"><strong>Fyrir félögin</strong><span>Lög, reglugerðir, eyðublöð og innskráning formanna</span></a>
        <a href="/um-hsk"><strong>Um HSK</strong><span>Saga, stjórn, nefndir og starfsfólk</span></a>
      </section>
    </div>
  ), { description: 'Héraðssambandið Skarphéðinn (HSK) er héraðssamband íþrótta- og ungmennafélaga á Suðurlandi, stofnað 1910.' });
});

// ---------- Fréttir ----------

app.get('/frett/:slug', async (c) => {
  const n = await one<NewsRow & { id: number; club_name: string | null; album_slug: string | null }>(c.env.DB,
    `SELECT n.*, cl.name AS club_name, a.slug AS album_slug FROM news n LEFT JOIN clubs cl ON cl.id = n.club_id LEFT JOIN albums a ON a.id = n.album_id
     WHERE n.slug = ? AND n.status = 'published'`, c.req.param('slug'));
  if (!n) return notFound(c);
  const label = n.kind === 'frett' ? 'Fréttir' : n.kind === 'grein' ? 'Greinar' : 'Aðsendar greinar';
  return render(c, n.title, (
    <article class="article">
      <PageHead title={n.title} crumbs={[{ title: label, path: '/frettir' }]} />
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

async function newsList(c: Context<AppEnv>, kind?: string) {
  const page = pageNum(c);
  const year = c.req.query('ar');
  const where = ["status = 'published'", "published_at <= datetime('now')"];
  const params: unknown[] = [];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  if (year && /^\d{4}$/.test(year)) { where.push("substr(published_at, 1, 4) = ?"); params.push(year); }
  const rows = await all<NewsRow>(c.env.DB, `SELECT slug, title, excerpt, body, image, published_at, kind, author FROM news WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ? OFFSET ?`, ...params, PER_PAGE + 1, (page - 1) * PER_PAGE);
  const years = await all<{ y: string }>(c.env.DB, `SELECT DISTINCT substr(published_at, 1, 4) AS y FROM news WHERE status = 'published' ${kind ? 'AND kind = ?' : ''} ORDER BY y DESC`, ...(kind ? [kind] : []));
  return { rows: rows.slice(0, PER_PAGE), hasNext: rows.length > PER_PAGE, page, years: years.map((y) => y.y).filter(Boolean), year };
}

const NewsListing = ({ data, base }: { data: Awaited<ReturnType<typeof newsList>>; base: string }) => (
  <>
    {data.years.length > 1 && (
      <nav class="year-filter" aria-label="Ár">
        <a href={base} class={!data.year ? 'on' : ''}>Allt</a>
        {data.years.map((y) => <a href={`${base}?ar=${y}`} class={data.year === y ? 'on' : ''}>{y}</a>)}
      </nav>
    )}
    {data.rows.length ? <div class="news-grid">{data.rows.map((n) => <NewsCard n={n} />)}</div> : <p class="muted">Engar fréttir fundust.</p>}
    <Pager page={data.page} hasNext={data.hasNext} base={data.year ? `${base}?ar=${data.year}` : base} />
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
      <PageHead title={e.title} crumbs={[isMot ? { title: 'Mótaskrá', path: '/mot/motaskra' } : { title: 'Viðburðir', path: '/vidburdir' }]} />
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
        {results.length > 0 && <><h2>Úrslit</h2><ul class="result-list">{results.map((r) => <ResultItem r={r} />)}</ul></>}
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

async function eventList(c: Context<AppEnv>, kind: 'vidburdur' | 'mot' | null) {
  const past = c.req.query('lidid') === '1';
  const sport = c.req.query('grein') || '';
  const where = ["status = 'published'", past ? "substr(coalesce(ends_at, starts_at), 1, 10) < ?" : "substr(coalesce(ends_at, starts_at), 1, 10) >= ?"];
  const params: unknown[] = [today()];
  if (kind) { where.push('kind = ?'); params.push(kind); }
  if (sport) { where.push('sport = ?'); params.push(sport); }
  const rows = await all<EventRow>(c.env.DB, `SELECT id, kind, title, starts_at, ends_at, location, sport, image FROM events WHERE ${where.join(' AND ')} ORDER BY starts_at ${past ? 'DESC' : 'ASC'} LIMIT 200`, ...params);
  const sports = await all<{ sport: string }>(c.env.DB, `SELECT DISTINCT sport FROM events WHERE sport != '' ${kind ? 'AND kind = ?' : ''} ORDER BY sport`, ...(kind ? [kind] : []));
  return { rows, past, sport, sports: sports.map((s) => s.sport) };
}

const EventListing = ({ data, base }: { data: Awaited<ReturnType<typeof eventList>>; base: string }) => {
  const groups = new Map<string, EventRow[]>();
  for (const e of data.rows) {
    const k = monthYear(e.starts_at);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const q = (p: Record<string, string>) => {
    const u = new URLSearchParams({ ...(data.sport ? { grein: data.sport } : {}), ...(data.past ? { lidid: '1' } : {}), ...p });
    for (const [k, v] of [...u]) if (!v) u.delete(k);
    return `${base}${u.toString() ? '?' + u : ''}`;
  };
  return (
    <>
      <div class="filters">
        <nav class="year-filter">
          <a href={q({ lidid: '' })} class={!data.past ? 'on' : ''}>Framundan</a>
          <a href={q({ lidid: '1' })} class={data.past ? 'on' : ''}>Liðið</a>
        </nav>
        {data.sports.length > 0 && (
          <form method="get" class="inline-form">
            {data.past && <input type="hidden" name="lidid" value="1" />}
            <label for="grein">Íþróttagrein</label>
            <select id="grein" name="grein" onchange="this.form.submit()">
              <option value="">Allar greinar</option>
              {data.sports.map((s) => <option value={s} selected={s === data.sport}>{s}</option>)}
            </select>
            <noscript><button>Sía</button></noscript>
          </form>
        )}
        <a class="ics-link" href="/dagatal.ics"><Icon name="calendar" />Setja dagatalið í símann eða tölvuna</a>
      </div>
      {data.rows.length === 0 && <p class="muted">Ekkert skráð.</p>}
      {[...groups].map(([month, list]) => (
        <section class="month-group">
          <h2>{month}</h2>
          <ul class="event-list wide">{list.map((e) => <EventItem e={e} />)}</ul>
        </section>
      ))}
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
  const year = c.req.query('ar') || '';
  const where = ["status = 'published'"];
  const params: unknown[] = [];
  if (sport) { where.push('sport = ?'); params.push(sport); }
  if (/^\d{4}$/.test(year)) { where.push('substr(date, 1, 4) = ?'); params.push(year); }
  const rows = await all<{ id: number; title: string; date: string; sport: string }>(c.env.DB, `SELECT id, title, date, sport FROM results WHERE ${where.join(' AND ')} ORDER BY date DESC LIMIT 300`, ...params);
  const sports = (await all<{ sport: string }>(c.env.DB, "SELECT DISTINCT sport FROM results WHERE sport != '' ORDER BY sport")).map((s) => s.sport);
  const years = (await all<{ y: string }>(c.env.DB, 'SELECT DISTINCT substr(date, 1, 4) AS y FROM results ORDER BY y DESC')).map((y) => y.y);
  return { rows, sport, year, sports, years };
}

// ---------- Félög, myndir ----------

app.get('/felag/:slug', async (c) => {
  const f = await one<{ id: number; name: string; logo: string; sports: string; area: string; contact_name: string; email: string; phone: string; website: string; facebook: string; description: string }>(c.env.DB,
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
            {f.area && <div><dt>Svæði</dt><dd>{f.area}</dd></div>}
            {f.contact_name && <div><dt>Formaður / tengiliður</dt><dd>{f.contact_name}</dd></div>}
            {f.email && <div><dt>Netfang</dt><dd><a href={'mailto:' + f.email}>{f.email}</a></dd></div>}
            {f.phone && <div><dt>Sími</dt><dd>{f.phone}</dd></div>}
            {f.website && <div><dt>Vefur</dt><dd><a href={f.website} rel="noopener">{f.website.replace(/^https?:\/\//, '')}</a></dd></div>}
            {f.facebook && <div><dt>Facebook</dt><dd><a href={f.facebook} rel="noopener">Facebook-síða</a></dd></div>}
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
      <PageHead title={a.title} crumbs={[{ title: 'Myndir', path: '/myndir' }]} lead={a.date.slice(0, 4)} />
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
        <form action="/leit" method="get" class="search-big" role="search">
          <label class="sr" for="q">Leitarorð</label>
          <input id="q" name="q" type="search" value={q} placeholder="Hverju ertu að leita að?" autofocus />
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
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.text('Skrá fannst ekki', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
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
    frettir: '/frettir', frettir_old: '/frettir', adsgr: '/frettir/adsendar-greinar', felog: '/adildarfelog', nefndir: '/um-hsk/stjorn-nefndir-og-rad',
    log: '/um-hsk/log-og-reglugerdir', fundarg: '/um-hsk/fundargerdir', urslit: '/mot/urslit', motaskra: '/mot/motaskra', vidburdir_l: '/vidburdir',
    myndir: '/myndir', hsk_met_b: '/mot/hsk-met', hsk: '/um-hsk',
  };
  return c.redirect(sections[page] ?? '/', 301);
});

// ---------- Síður úr veftré (allar aðrar slóðir) ----------

app.get('/*', async (c) => {
  const path = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('.')) return notFound(c);
  const p = await one<PageRow>(c.env.DB, "SELECT * FROM pages WHERE path = ? AND status = 'published'", path);
  if (!p) return notFound(c);
  const crumbs: { title: string; path: string }[] = [];
  let parentId = p.parent_id;
  while (parentId) {
    const par = await one<PageRow>(c.env.DB, 'SELECT id, parent_id, title, path FROM pages WHERE id = ?', parentId);
    if (!par) break;
    crumbs.unshift({ title: par.title, path: '/' + par.path });
    parentId = par.parent_id;
  }
  const children = await all<PageRow>(c.env.DB, "SELECT title, path, body FROM pages WHERE parent_id = ? AND status = 'published' ORDER BY sort, title COLLATE NOCASE", p.id);
  const base = '/' + p.path;
  let moduleView: Child = null;
  switch (p.module) {
    case 'news': moduleView = <NewsListing data={await newsList(c)} base={base} />; break;
    case 'articles': moduleView = <NewsListing data={await newsList(c, 'grein')} base={base} />; break;
    case 'submitted': moduleView = <NewsListing data={await newsList(c, 'adsend')} base={base} />; break;
    case 'events': moduleView = <EventListing data={await eventList(c, null)} base={base} />; break;
    case 'competitions': moduleView = <EventListing data={await eventList(c, 'mot')} base={base} />; break;
    case 'results': {
      const d = await resultList(c);
      moduleView = (
        <>
          <form method="get" class="filters inline-form">
            <label for="grein">Íþróttagrein</label>
            <select id="grein" name="grein"><option value="">Allar</option>{d.sports.map((s) => <option selected={s === d.sport}>{s}</option>)}</select>
            <label for="ar">Ár</label>
            <select id="ar" name="ar"><option value="">Öll ár</option>{d.years.map((y) => <option selected={y === d.year}>{y}</option>)}</select>
            <button class="btn small">Sía</button>
          </form>
          <div class="table-wrap">
            <table class="list-table">
              <thead><tr><th>Dags.</th><th>Mót</th><th>Grein</th></tr></thead>
              <tbody>{d.rows.map((r) => <tr><td class="num">{dateShort(r.date)}</td><td><a href={'/urslit/' + r.id}>{r.title}</a></td><td>{r.sport}</td></tr>)}</tbody>
            </table>
          </div>
          {d.rows.length === 0 && <p class="muted">Engin úrslit fundust.</p>}
        </>
      );
      break;
    }
    case 'records': {
      const rows = await all<{ id: number; title: string; sport: string; body: string; updated_at: string }>(c.env.DB, 'SELECT * FROM records ORDER BY sort, title');
      const metDocs = await all<{ title: string; date: string; file: string }>(c.env.DB, "SELECT title, date, file FROM documents WHERE category = 'met' ORDER BY date DESC, title");
      moduleView = [...rows.map((r) => (
        <details class="record">
          <summary><strong>{r.title}</strong>{r.sport && <span class="muted"> · {r.sport}</span>}</summary>
          <div class="table-wrap"><Prose html={r.body} /></div>
          <p class="muted small">Síðast uppfært {dateLong(r.updated_at)}</p>
        </details>
      )), metDocs.length > 0 && (
        <section>
          <h2>Metaskrár</h2>
          <ul class="doc-list">{metDocs.map((d) => <li><a href={d.file}><Icon name="file" />{d.title}</a></li>)}</ul>
        </section>
      )];
      break;
    }
    case 'clubs': {
      const rows = await all<{ slug: string; name: string; logo: string; sports: string; area: string }>(c.env.DB, 'SELECT slug, name, logo, sports, area FROM clubs ORDER BY name');
      moduleView = (
        <>
          <div class="club-filter"><label class="sr" for="felag-leit">Leita að félagi</label><input id="felag-leit" type="search" placeholder="Leita að félagi, íþróttagrein eða svæði" value={c.req.query('q') ?? ''} data-filter=".club-grid > a" data-empty="#felag-tomt" /></div>
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
          <div class="club-filter"><label class="sr" for="nefnd-leit">Leita í stjórn, nefndum og ráðum</label><input id="nefnd-leit" type="search" placeholder="Leita að nefnd eða nafni" data-filter=".committee-grid > section" data-empty="#nefnd-tomt" /></div>
          <p id="nefnd-tomt" class="filter-empty" hidden>Engin nefnd eða manneskja fannst.</p>
          <div class="committee-grid">{rows.map((r) => <section class="committee" data-text={`${r.name} ${plainText(r.body)}`.toLowerCase()}><h2>{r.name}</h2><Prose html={r.body} /></section>)}</div>
        </>
      );
      break;
    }
    case 'documents': {
      const cat = c.req.query('flokkur') || '';
      const rows = await all<{ id: number; title: string; category: string; date: string; file: string; body: string }>(c.env.DB,
        `SELECT * FROM documents ${cat ? 'WHERE category = ?' : ''} ORDER BY date DESC LIMIT 400`, ...(cat ? [cat] : []));
      const cats: Record<string, string> = { fundargerd: 'Fundargerðir', arsskyrsla: 'Ársskýrslur', log: 'Lög og reglugerðir', eydublad: 'Eyðublöð', met: 'Metaskrár', annad: 'Annað' };
      moduleView = (
        <>
          <nav class="year-filter"><a href={base} class={!cat ? 'on' : ''}>Allt</a>{Object.entries(cats).map(([k, v]) => <a href={`${base}?flokkur=${k}`} class={cat === k ? 'on' : ''}>{v}</a>)}</nav>
          <ul class="doc-list">
            {rows.map((d) => (
              <li>
                <time>{dateShort(d.date)}</time>
                {d.file ? <a href={d.file}><Icon name="file" />{d.title}</a> : <details><summary>{d.title}</summary><Prose html={d.body} /></details>}
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
        moduleView = <div class="prose">{groups.filter(([, g]) => g.length).map(([title, g]) => <><h2>{title}</h2>{list(g)}</>)}</div>;
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
  // Undirsíður sem textinn vísar þegar á eru ekki endurteknar í hliðardálki
  const linked = new Set([...p.body.matchAll(/href="\/?([^"#?]+)/g)].map((m) => m[1].replace(/\/$/, '')));
  const unlisted = children.filter((ch) => !linked.has(ch.path));
  const showChildren = unlisted.length > 0 && !p.module;
  return render(c, p.title, (
    <>
      <PageHead title={p.title} crumbs={crumbs} />
      <div class={`wrap block page-layout${showChildren ? ' with-sub' : ''}`}>
        <div class="page-main">
          {p.body && <Prose html={p.body} />}
          {moduleView}
        </div>
        {showChildren && (
          <aside class="subpages">
            <h2 class="col-title">Undirsíður</h2>
            <ul>{unlisted.map((ch) => <li><a href={'/' + ch.path}>{ch.title}</a></li>)}</ul>
          </aside>
        )}
      </div>
    </>
  ), { description: plainText(p.body, 160) || undefined, lang: p.path === 'en' ? 'en' : undefined });
});

export async function notFound(c: Context<AppEnv>) {
  return render(c, 'Síða fannst ekki', (
    <>
      <PageHead title="Síða fannst ekki" />
      <div class="wrap block narrow">
        <p>Síðan sem þú leitaðir að er ekki til eða hefur verið færð.</p>
        <form action="/leit" method="get" class="search-big"><label class="sr" for="q404">Leita</label><input id="q404" name="q" type="search" placeholder="Leita á vefnum…" /><button class="btn">Leita</button></form>
        <p><a href="/"><Icon name="chevronLeft" />Forsíða</a></p>
      </div>
    </>
  ), { status: 404 });
}

export default app;
