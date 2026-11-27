import { FilterXSS } from 'xss';

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  SITE_URL: string;
  ADMIN_EMAILS: string;
  STAFF_DOMAIN: string;
  DEV_LOGIN_LINKS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  IMPORT_TOKEN?: string;
  LOGIN_KEY?: string;
};

export type Role = 'admin' | 'editor' | 'club';
export type User = { id: number; email: string; name: string; role: Role; club_id: number | null };

export type AppEnv = { Bindings: Env; Variables: { user: User | null } };

// ---------- Texti og slóðir ----------

const IS_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ý: 'y', ð: 'd', þ: 'th', æ: 'ae', ö: 'o',
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[áéíóúýðþæö]/g, (c) => IS_MAP[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'efni';
}

const MONTHS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maí', 'jún', 'júl', 'ágú', 'sep', 'okt', 'nóv', 'des'];
const DAYS = ['sunnudagur', 'mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur'];

function parse(d: string | null | undefined): Date | null {
  if (!d) return null;
  const x = new Date(d.length === 10 ? d + 'T00:00:00Z' : d.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? '' : 'Z'));
  return isNaN(x.getTime()) ? null : x;
}

/** 27. nóvember 2026 */
export function dateLong(d: string | null | undefined): string {
  const x = parse(d);
  return x ? `${x.getUTCDate()}. ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}` : '';
}
/** 27.11.2026 */
export function dateShort(d: string | null | undefined): string {
  const x = parse(d);
  if (!x) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}.${p(x.getUTCMonth() + 1)}.${x.getUTCFullYear()}`;
}
/** 27.11 */
export function dayMonth(d: string | null | undefined): string {
  return dateShort(d).slice(0, 5);
}
export function monthShort(d: string | null | undefined): string {
  const x = parse(d);
  return x ? MONTHS_SHORT[x.getUTCMonth()] : '';
}
export function dayNum(d: string | null | undefined): string {
  const x = parse(d);
  return x ? String(x.getUTCDate()) : '';
}
export function monthYear(d: string | null | undefined): string {
  const x = parse(d);
  return x ? `${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}` : '';
}
export function weekday(d: string | null | undefined): string {
  const x = parse(d);
  return x ? DAYS[x.getUTCDay()] : '';
}
/** kl. 13:00, eða tómt ef enginn tími */
export function timeOf(d: string | null | undefined): string {
  if (!d || d.length <= 10) return '';
  const x = parse(d);
  if (!x) return '';
  const hm = `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
  return hm === '00:00' ? '' : `kl. ${hm}`;
}
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
export function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Hreinn texti úr HTML, t.d. fyrir útdrátt */
export function plainText(html: string, max = 0): string {
  const t = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  if (!max || t.length <= max) return t;
  const cut = t.slice(0, t.lastIndexOf(' ', max) > max * 0.6 ? t.lastIndexOf(' ', max) : max);
  return cut.replace(/[\s.,;:–-]+$/, '') + '…';
}

// ---------- Hreinsun á HTML úr ritli ----------

const common = ['class', 'style'];
const sanitizer = new FilterXSS({
  whiteList: {
    p: common, br: [], strong: [], b: [], em: [], i: [], u: [], s: [], del: [], sub: [], sup: [], span: common, div: common,
    h2: common, h3: common, h4: common, h5: [], blockquote: [], pre: [], code: [], hr: [],
    ul: common, ol: ['start', 'type'], li: [],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style', 'loading'],
    figure: common, figcaption: [],
    table: ['class', 'style', 'border', 'cellpadding', 'cellspacing', 'width'], thead: [], tbody: [], tfoot: [], tr: ['style'],
    th: ['colspan', 'rowspan', 'style', 'scope'], td: ['colspan', 'rowspan', 'style'], caption: [], colgroup: [], col: ['span', 'style', 'width'],
    iframe: ['src', 'width', 'height', 'allowfullscreen', 'frameborder', 'allow', 'title'],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  onTagAttr(tag, name, value) {
    // Aðeins myndbönd frá YouTube/Vimeo í iframe
    if (tag === 'iframe' && name === 'src' && !/^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(value)) return '';
    return undefined;
  },
  css: {
    whiteList: {
      'text-align': true, 'text-decoration': true, 'font-weight': true, 'font-style': true,
      width: true, height: true, 'max-width': true, float: true, margin: true, 'margin-left': true, 'margin-right': true,
      'border-collapse': true, 'vertical-align': true, color: true, 'background-color': true, 'list-style-type': true,
    },
  },
});
export function sanitizeHtml(html: string): string {
  return sanitizer.process(html || '');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- Gagnagrunnur ----------

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}
export async function one<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}
export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const r = await one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? fallback;
}
export async function setSetting(db: D1Database, key: string, value: string) {
  await run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export async function logRevision(db: D1Database, entity: string, id: number, userId: number | null, action: string, data: unknown) {
  await run(db, 'INSERT INTO revisions (entity, entity_id, user_id, action, data) VALUES (?, ?, ?, ?, ?)', entity, id, userId, action, JSON.stringify(data));
}

/** Finnur einkvæma slóð í töflu, t.d. "frett", "frett-2" */
export async function uniqueSlug(db: D1Database, table: string, base: string, exceptId?: number): Promise<string> {
  let slug = slugify(base);
  for (let i = 2; ; i++) {
    const hit = await one(db, `SELECT id FROM ${table} WHERE slug = ? AND id != ?`, slug, exceptId ?? -1);
    if (!hit) return slug;
    slug = `${slugify(base)}-${i}`;
  }
}
