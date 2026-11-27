import type { Child, FC } from 'hono/jsx';
import { raw } from 'hono/html';
import { Icon } from './icons';
import { dateLong, dayMonth, dayNum, monthShort, timeOf, plainText } from '../lib';

export type MenuItem = { id: number; title: string; path: string; children: MenuItem[] };
export type Sponsor = { name: string; logo: string; url: string; tier: string };
export type SiteChrome = {
  menu: MenuItem[];
  sponsors: Sponsor[];
  notice: string;
  contact: { address: string; phone: string; email: string };
};

export const Layout: FC<{
  title: string;
  chrome: SiteChrome;
  path: string;
  description?: string;
  image?: string;
  lang?: string;
  children?: Child;
}> = ({ title, chrome, path, description, image, lang, children }) => {
  const fullTitle = title === 'Forsíða' ? 'Héraðssambandið Skarphéðinn – HSK' : `${title} – HSK`;
  const active = (p: string) => path === '/' + p || path.startsWith('/' + p + '/');
  return (
    <html lang={lang ?? 'is'}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        {description && <meta name="description" content={description} />}
        <meta property="og:title" content={title} />
        {description && <meta property="og:description" content={description} />}
        {image && <meta property="og:image" content={image} />}
        <link rel="icon" href="/img/hsk-merki.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&display=swap" />
        <link rel="stylesheet" href="/css/site.css" />
        <link rel="alternate" type="application/rss+xml" title="Fréttir HSK" href="/rss.xml" />
      </head>
      <body>
        <a class="skip" href="#efni">Fara í efni</a>
        <header class="site-header">
          <div class="wrap header-inner">
            <a class="brand" href="/">
              <img src="/img/hsk-merki.svg" alt="" width="40" height="66" />
              <span>Héraðssambandið<br />Skarphéðinn<small>Stofnað 1910</small></span>
            </a>
            <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="valmynd">
              <Icon name="menu" /><span>Valmynd</span>
            </button>
            <nav id="valmynd" class="main-nav" aria-label="Aðalvalmynd">
              <ul>
                {chrome.menu.map((m) => (
                  <li class={m.children.length ? 'has-sub' : ''}>
                    <a href={'/' + m.path} class={active(m.path) ? 'on' : ''} aria-current={path === '/' + m.path ? 'page' : undefined}>{m.title}</a>
                    {m.children.length > 0 && (
                      <ul class="sub">
                        {m.children.map((s) => <li><a href={'/' + s.path}>{s.title}</a></li>)}
                      </ul>
                    )}
                  </li>
                ))}
                <li class="search-li">
                  <form action="/leit" method="get" class="nav-search" role="search">
                    <label class="sr" for="leit-q">Leita</label>
                    <Icon name="search" />
                    <input id="leit-q" name="q" type="search" placeholder="Leita" />
                  </form>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        {chrome.notice && (
          <div class="notice"><div class="wrap">{raw(chrome.notice)}</div></div>
        )}
        <main id="efni">{children}</main>
        <footer class="site-footer">
          {chrome.sponsors.length > 0 && (
            <section class="sponsors" aria-label="Styrktaraðilar">
              <div class="wrap">
                <h2 class="eyebrow">Styrktar- og samstarfsaðilar</h2>
                <ul>
                  {chrome.sponsors.map((s) => (
                    <li>
                      <a href={s.url || '/styrktaradilar'} rel="noopener" target={s.url ? '_blank' : undefined} title={s.name}>
                        {s.logo ? <img src={s.logo} alt={s.name} loading="lazy" /> : <span>{s.name}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          <div class="footer-main">
            <div class="wrap footer-grid">
              <div>
                <strong>Héraðssambandið Skarphéðinn</strong>
                <p>{chrome.contact.address}</p>
              </div>
              <div>
                <p>Sími <a href={'tel:' + chrome.contact.phone.replace(/\s/g, '')}>{chrome.contact.phone}</a></p>
                <p><a href={'mailto:' + chrome.contact.email}>{chrome.contact.email}</a></p>
              </div>
              <div>
                <p><a href="/en">English</a> · <a href="/rss.xml">RSS</a> · <a href="/stjorn">Innskráning</a></p>
              </div>
            </div>
          </div>
        </footer>
        <script src="/js/site.js" defer></script>
      </body>
    </html>
  );
};

export const PageHead: FC<{ title: string; crumbs?: { title: string; path: string }[]; lead?: string }> = ({ title, crumbs, lead }) => (
  <div class="page-head">
    <div class="wrap">
      {crumbs && crumbs.length > 0 && (
        <nav class="crumbs" aria-label="Brauðmolar">
          <a href="/">Forsíða</a>
          {crumbs.map((c) => <> <span aria-hidden="true">/</span> <a href={c.path}>{c.title}</a></>)}
        </nav>
      )}
      <h1>{title}</h1>
      {lead && <p class="lead">{lead}</p>}
    </div>
  </div>
);

export type NewsRow = { slug: string; title: string; excerpt: string; body: string; image: string; published_at: string; kind: string; author: string };

export const NewsCard: FC<{ n: NewsRow; big?: boolean }> = ({ n, big }) => (
  <article class={big ? 'news-card big' : 'news-card'}>
    <a href={'/frett/' + n.slug}>
      <div class="thumb">{n.image ? <img src={n.image} alt="" loading="lazy" /> : <img class="ph" src="/img/hsk-merki.svg" alt="" />}</div>
      <div class="txt">
        <time datetime={n.published_at}>{dateLong(n.published_at)}</time>
        <h3>{n.title}</h3>
        {big && <p>{n.excerpt || plainText(n.body, 180)}</p>}
      </div>
    </a>
  </article>
);

export type EventRow = { id: number; kind: string; title: string; starts_at: string; ends_at: string | null; location: string; sport: string; image: string };

export const EventItem: FC<{ e: EventRow }> = ({ e }) => (
  <li class="event-item">
    <a href={'/vidburdur/' + e.id}>
      <span class="datebox"><b>{dayNum(e.starts_at)}</b>{monthShort(e.starts_at)}</span>
      <span class="ev-txt">
        <strong>{e.title}</strong>
        <small>{[e.kind === 'mot' ? 'Mót' : '', e.sport, e.location, timeOf(e.starts_at)].filter(Boolean).join(' · ')}</small>
      </span>
    </a>
  </li>
);

export const ResultItem: FC<{ r: { id: number; title: string; date: string; sport: string } }> = ({ r }) => (
  <li class="result-item">
    <a href={'/urslit/' + r.id}>
      <span class="d">{dayMonth(r.date)}</span>
      <span>{r.title}</span>
    </a>
  </li>
);

export const Pager: FC<{ page: number; hasNext: boolean; base: string }> = ({ page, hasNext, base }) => {
  if (page <= 1 && !hasNext) return null;
  const sep = base.includes('?') ? '&' : '?';
  return (
    <nav class="pager" aria-label="Síður">
      {page > 1 ? <a href={`${base}${sep}s=${page - 1}`}><Icon name="chevronLeft" />Nýrra</a> : <span></span>}
      <span>Síða {page}</span>
      {hasNext ? <a href={`${base}${sep}s=${page + 1}`}>Eldra<Icon name="chevronRight" /></a> : <span></span>}
    </nav>
  );
};

export const Prose: FC<{ html: string }> = ({ html }) => <div class="prose">{raw(html)}</div>;
