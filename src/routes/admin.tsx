import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Child } from 'hono/jsx';
import {
  type AppEnv, type User, all, one, run, sanitizeHtml, uniqueSlug, slugify, logRevision, getSetting, setSetting,
  dateLong, dateTime, nowIso, plainText,
} from '../lib';
import {
  loadUser, requireUser, resolveLoginUser, createLoginToken, consumeLoginToken, startSession, endSession, can,
  googleEnabled, googleAuthUrl, googleEmailFromCode, randomId, passwordLogin, hashPassword, verifyPassword,
} from '../auth';
import { sendMail, notifyAdmins } from '../mail';
import { GRANT_FIELDS } from '../grant';
import { archivedRecords } from '../record-catalogue-data';
import { DEFAULT_TILES } from '../lib';
import { contentTypes, getType, STATUS_LABELS, type ContentType, type Field } from '../content-types';
import { AdminLayout, FieldInput, StatusPill } from '../views/admin';
import { Icon } from '../views/icons';
import { MAX_RECORD_FILE, uploadedRecordKey, validateRecordSheets } from '../record-books';
import { asset } from '../static';

const app = new Hono<AppEnv>();
type Row = Record<string, unknown> & { id: number };

const MESSAGES: Record<string, string> = {
  vistad: 'Vistað.', birt: 'Birt á vefnum.', eytt: 'Eytt.', sent: 'Sent til samþykktar. Starfsfólk HSK fær tilkynningu.',
  samthykkt: 'Samþykkt og birt.', hafnad: 'Hafnað. Sendandi fær athugasemdina.', endurheimt: 'Eldri útgáfa endurheimt.',
  bodid: 'Boð sent.', myndir: 'Myndir uppfærðar.',
};

function isStaff(u: User) { return u.role === 'admin' || u.role === 'editor'; }

async function page(c: Context<AppEnv>, title: string, active: string, body: Child, opts: { error?: string; status?: number } = {}) {
  const user = c.get('user');
  let pending = 0;
  let applications = 0;
  if (user && (user.role === 'admin' || user.role === 'editor')) {
    applications = (await one<{ n: number }>(c.env.DB, "SELECT count(*) AS n FROM applications WHERE status = 'ny'"))?.n ?? 0;
  }
  if (user?.role === 'admin') {
    const r = await one<{ n: number }>(c.env.DB, "SELECT (SELECT count(*) FROM news WHERE status = 'pending') + (SELECT count(*) FROM events WHERE status = 'pending') AS n");
    pending = r?.n ?? 0;
  }
  const flash = MESSAGES[c.req.query('m') || ''];
  c.header('Cache-Control', 'no-store');
  return c.html('<!doctype html>' + (
    <AdminLayout title={title} user={user} active={active} flash={flash} error={opts.error} pending={pending} applications={applications}>{body}</AdminLayout>
  ).toString(), (opts.status ?? 200) as 200);
}

// Innflutningur af gamla vefnum: tekur við skrám í R2. Virkar aðeins ef IMPORT_TOKEN er stillt.
app.put('/innflutningur/*', async (c) => {
  const token = c.env.IMPORT_TOKEN;
  if (!token || c.req.header('authorization') !== `Bearer ${token}`) return c.text('Óheimilt', 401);
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice('/stjorn/innflutningur/'.length));
  if (!key.startsWith('old/') || key.includes('..')) return c.text('Ógildur lykill', 400);
  await c.env.MEDIA.put(key, c.req.raw.body, { httpMetadata: { contentType: c.req.header('content-type') || 'application/octet-stream' } });
  return c.text('ok');
});

app.use('*', loadUser);

// ---------- Innskráning ----------

app.get('/innskraning', async (c) => {
  if (c.get('user')) return c.redirect('/stjorn');
  const err = c.req.query('villa');
  return page(c, 'Innskráning', '', (
    <div class="login-box">
      <img src="/img/hsk-merki.svg" alt="" width="64" />
      <h1>Vefumsjón HSK</h1>
      {err && <p class="flash err">{LOGIN_ERRORS[err] ?? LOGIN_ERRORS.adgangur}</p>}
      <form method="post" action="/stjorn/innskraning/lykilord">
        <label for="pw-email">Netfang</label>
        <input id="pw-email" name="email" type="email" required autocomplete="username" />
        <label for="pw">Lykilorð</label>
        <input id="pw" name="password" type="password" required autocomplete="current-password" />
        <button class="btn">Skrá inn</button>
      </form>
      <p class="or"><span>eða</span></p>
      {googleEnabled(c.env) && <a class="btn google" href="/stjorn/google">Skrá inn með Google</a>}
      <form method="post" action="/stjorn/innskraning">
        <label for="email">Fá innskráningartengil í tölvupósti</label>
        <input id="email" name="email" type="email" required autocomplete="email" placeholder="nafn@hsk.is" />
        <button class="btn">Senda innskráningartengil</button>
      </form>
      <p class="muted small">Starfsfólk HSK notar @hsk.is-netfang. Formenn aðildarfélaga nota netfangið sem þeim var boðið með.</p>
    </div>
  ));
});

const LOGIN_ERRORS: Record<string, string> = {
  tengill: 'Innskráningartengillinn er útrunninn eða hefur þegar verið notaður. Biddu um nýjan.',
  adgangur: 'Þetta netfang hefur ekki aðgang að vefumsjón. Hafðu samband við skrifstofu HSK.',
  lykilord: 'Netfang eða lykilorð er rangt.',
  laest: 'Of margar rangar tilraunir. Reyndu aftur eftir 15 mínútur eða fáðu tengil í tölvupósti.',
};

app.post('/innskraning/lykilord', async (c) => {
  const form = await c.req.formData();
  const r = await passwordLogin(c.env, String(form.get('email') || ''), String(form.get('password') || ''));
  if (!r.user) return c.redirect('/stjorn/innskraning?villa=' + (r.locked ? 'laest' : 'lykilord'));
  await startSession(c, r.user);
  return c.redirect('/stjorn');
});

app.post('/innskraning', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const user = await resolveLoginUser(c.env, email, false);
  let devLink = '';
  if (user) {
    const token = await createLoginToken(c.env, email);
    const link = `${c.env.SITE_URL}/stjorn/innskra?t=${encodeURIComponent(token)}`;
    const sent = await sendMail(c.env, email, 'Innskráning á vef HSK',
      `Smelltu á tengilinn til að skrá þig inn í vefumsjón HSK:\n\n${link}\n\nTengillinn gildir í 20 mínútur. Ef þú baðst ekki um þetta máttu hunsa póstinn.`);
    if (!sent && c.env.DEV_LOGIN_LINKS === 'true') devLink = link;
  }
  return page(c, 'Athugaðu tölvupóstinn', '', (
    <div class="login-box">
      <img src="/img/hsk-merki.svg" alt="" width="64" />
      <h1>Athugaðu tölvupóstinn</h1>
      <p>Ef <strong>{email}</strong> hefur aðgang að vefumsjón fær það innskráningartengil á næstu mínútum.</p>
      {devLink && (
        <div class="dev-box">
          <strong>Þróunarhamur:</strong> póstur er ekki stilltur, svo hér er tengillinn:
          <a href={devLink}>Skrá inn</a>
        </div>
      )}
      <p><a class="back" href="/stjorn/innskraning"><Icon name="chevronLeft" />Til baka</a></p>
    </div>
  ));
});

app.get('/innskra', async (c) => {
  const email = await consumeLoginToken(c.env, c.req.query('t') || '');
  if (!email) return c.redirect('/stjorn/innskraning?villa=tengill');
  const user = await resolveLoginUser(c.env, email, true);
  if (!user) return c.redirect('/stjorn/innskraning?villa=adgangur');
  await startSession(c, user);
  return c.redirect('/stjorn');
});

app.get('/google', (c) => {
  if (!googleEnabled(c.env)) return c.redirect('/stjorn/innskraning');
  const state = randomId(16);
  setCookie(c, 'hsk_oauth', state, { httpOnly: true, sameSite: 'Lax', path: '/stjorn', maxAge: 600, secure: c.env.SITE_URL.startsWith('https') });
  return c.redirect(googleAuthUrl(c.env, state));
});

app.get('/google/callback', async (c) => {
  const state = getCookie(c, 'hsk_oauth');
  deleteCookie(c, 'hsk_oauth', { path: '/stjorn' });
  if (!state || state !== c.req.query('state') || !c.req.query('code')) return c.redirect('/stjorn/innskraning?villa=adgangur');
  const g = await googleEmailFromCode(c.env, c.req.query('code')!);
  if (!g) return c.redirect('/stjorn/innskraning?villa=adgangur');
  const user = await resolveLoginUser(c.env, g.email, true);
  if (!user) return c.redirect('/stjorn/innskraning?villa=adgangur');
  if (g.name && (!user.name || user.name === g.email.split('@')[0])) await run(c.env.DB, 'UPDATE users SET name = ? WHERE id = ?', g.name, user.id);
  await startSession(c, user);
  return c.redirect('/stjorn');
});

// Bráðabirgðainnskráning fyrir eiganda á meðan póstur og Google eru ekki komin upp.
// Virkar aðeins ef leyndarmálið LOGIN_KEY er stillt; skráir inn fyrsta netfangið í ADMIN_EMAILS.
app.get('/lykill', async (c) => {
  const key = c.env.LOGIN_KEY;
  const given = c.req.query('k') || '';
  if (!key || key.length < 24 || given.length !== key.length) return c.redirect('/stjorn/innskraning');
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff) return c.redirect('/stjorn/innskraning');
  const email = (c.env.ADMIN_EMAILS || '').split(',')[0]?.trim();
  const user = email ? await resolveLoginUser(c.env, email, true) : null;
  if (!user) return c.redirect('/stjorn/innskraning?villa=adgangur');
  await startSession(c, user);
  return c.redirect('/stjorn');
});

app.post('/utskra', async (c) => {
  await endSession(c);
  return c.redirect('/stjorn/innskraning');
});

// Allt hér fyrir neðan krefst innskráningar
app.use('*', requireUser);

// ---------- Yfirlit ----------

app.get('/', async (c) => {
  const user = c.get('user')!;
  const db = c.env.DB;
  if (!isStaff(user)) {
    const club = await one<{ name: string }>(db, 'SELECT name FROM clubs WHERE id = ?', user.club_id ?? 0);
    const mine = await all<{ t: string; id: number; title: string; status: string; review_note: string; created_at: string }>(db,
      `SELECT 'frettir' AS t, id, title, status, review_note, created_at FROM news WHERE club_id = ?
       UNION ALL SELECT 'vidburdir', id, title, status, review_note, created_at FROM events WHERE club_id = ?
       ORDER BY created_at DESC LIMIT 30`, user.club_id ?? 0, user.club_id ?? 0);
    return page(c, 'Yfirlit', 'home', (
      <>
        <h1>Velkomin{user.name ? `, ${user.name}` : ''}</h1>
        <p class="lead">Þú ert skráð/ur inn fyrir <strong>{club?.name ?? 'aðildarfélag'}</strong>. Fréttir og viðburðir sem þú sendir inn birtast eftir að starfsfólk HSK hefur samþykkt þau.</p>
        <div class="actions">
          <a class="btn" href="/stjorn/frettir/nytt">Senda inn frétt</a>
          <a class="btn" href="/stjorn/vidburdir/nytt">Senda inn viðburð</a>
          <a class="btn ghost" href={`/stjorn/felog/${user.club_id ?? 0}`}>Uppfæra upplýsingar um félagið</a>
        </div>
        <h2>Innsent efni</h2>
        {mine.length === 0 ? <p class="muted">Ekkert innsent efni enn.</p> : (
          <table class="tbl">
            <thead><tr><th>Heiti</th><th>Sent</th><th>Staða</th><th>Athugasemd</th></tr></thead>
            <tbody>{mine.map((r) => (
              <tr><td><a href={`/stjorn/${r.t}/${r.id}`}>{r.title}</a></td><td>{dateLong(r.created_at)}</td><td><StatusPill status={r.status} /></td><td>{r.review_note}</td></tr>
            ))}</tbody>
          </table>
        )}
      </>
    ));
  }
  const pending = await all<{ t: string; id: number; title: string; club: string | null; created_at: string }>(db,
    `SELECT 'frettir' AS t, n.id, n.title, cl.name AS club, n.created_at FROM news n LEFT JOIN clubs cl ON cl.id = n.club_id WHERE n.status = 'pending'
     UNION ALL SELECT 'vidburdir', e.id, e.title, cl.name, e.created_at FROM events e LEFT JOIN clubs cl ON cl.id = e.club_id WHERE e.status = 'pending'
     ORDER BY created_at`);
  const counts = await one<Record<string, number>>(db, `SELECT
    (SELECT count(*) FROM news WHERE status = 'published') AS news,
    (SELECT count(*) FROM events WHERE status = 'published' AND starts_at >= date('now')) AS upcoming,
    (SELECT count(*) FROM results) AS results, (SELECT count(*) FROM pages) AS pages,
    (SELECT count(*) FROM clubs) AS clubs, (SELECT count(*) FROM photos) AS photos`);
  const newApps = await all<{ id: number; title: string; created_at: string }>(db, "SELECT id, title, created_at FROM applications WHERE status = 'ny' ORDER BY created_at");
  const recent = await all<{ entity: string; entity_id: number; action: string; created_at: string; who: string | null; data: string }>(db,
    'SELECT r.entity, r.entity_id, r.action, r.created_at, u.email AS who, r.data FROM revisions r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 12');
  return page(c, 'Yfirlit', 'home', (
    <>
      <h1>Yfirlit</h1>
      <div class="actions">
        <a class="btn" href="/stjorn/frettir/nytt">Ný frétt</a>
        <a class="btn" href="/stjorn/vidburdir/nytt">Nýtt mót eða viðburður</a>
        <a class="btn ghost" href="/stjorn/urslit/nytt">Skrá úrslit</a>
        <a class="btn ghost" href="/stjorn/myndasofn/nytt">Nýtt myndaalbúm</a>
        <a class="btn ghost" href="/stjorn/sidur/nytt">Ný síða</a>
      </div>
      {pending.length > 0 && (
        <section class="panel attention">
          <h2>Bíður samþykktar ({pending.length})</h2>
          <table class="tbl">
            <thead><tr><th>Heiti</th><th>Tegund</th><th>Frá</th><th>Sent</th></tr></thead>
            <tbody>{pending.map((p) => (
              <tr><td><a href={`/stjorn/${p.t}/${p.id}`}>{p.title}</a></td><td>{p.t === 'frettir' ? 'Frétt' : 'Mót eða viðburður'}</td><td>{p.club ?? '—'}</td><td>{dateLong(p.created_at)}</td></tr>
            ))}</tbody>
          </table>
          {user.role !== 'admin' && <p class="muted small">Aðeins stjórnendur geta samþykkt innsent efni.</p>}
        </section>
      )}
      {newApps.length > 0 && (
        <section class="panel attention">
          <h2>Nýjar umsóknir í Verkefnasjóð ({newApps.length})</h2>
          <table class="tbl">
            <thead><tr><th>Umsókn</th><th>Barst</th></tr></thead>
            <tbody>{newApps.map((a) => <tr><td><a href={`/stjorn/umsoknir/${a.id}`}>{a.title}</a></td><td>{dateLong(a.created_at)}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      <div class="stats">
        {[['news', 'birtar fréttir', '/stjorn/frettir'], ['upcoming', 'mót og viðburðir framundan', '/stjorn/vidburdir'], ['results', 'úrslit', '/stjorn/urslit'], ['pages', 'síður', '/stjorn/sidur'], ['clubs', 'aðildarfélög', '/stjorn/felog'], ['photos', 'myndir í söfnum', '/stjorn/myndasofn']].map(([k, l, h]) => (
          <a href={h}><b>{counts?.[k] ?? 0}</b><span>{l}</span></a>
        ))}
      </div>
      <h2>Nýlegar breytingar</h2>
      <table class="tbl">
        <thead><tr><th>Hvenær</th><th>Hver</th><th>Hvað</th></tr></thead>
        <tbody>{recent.map((r) => {
          const t = contentTypes.find((x) => x.table === r.entity);
          let title = '';
          try { const d = JSON.parse(r.data); title = d.title || d.name || ''; } catch { /* tómt */ }
          const href = r.entity === 'pages' ? `/stjorn/sidur/${r.entity_id}` : t ? `/stjorn/${t.key}/${r.entity_id}` : '#';
          return <tr><td>{dateTime(r.created_at)}</td><td>{r.who ?? '—'}</td><td>{actionLabel(r.action)} <a href={href}>{title || `#${r.entity_id}`}</a></td></tr>;
        })}</tbody>
      </table>
    </>
  ));
});

function actionLabel(a: string) {
  return ({ create: 'Stofnaði', update: 'Breytti', delete: 'Eyddi', approve: 'Samþykkti', reject: 'Hafnaði', restore: 'Endurheimti', submit: 'Sendi inn' } as Record<string, string>)[a] ?? a;
}

// ---------- Upphleðsla ----------

const ALLOWED_UPLOAD = /^(image\/(jpeg|png|gif|webp|svg\+xml)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|application\/vnd\.ms-(excel|powerpoint))$/;

app.post('/upload', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'Engin skrá' }, 400);
  if (file.size > 25 * 1024 * 1024) return c.json({ error: 'Skráin er of stór (hámark 25 MB).' }, 400);
  const mime = /\.xlsx$/i.test(file.name) && (!file.type || file.type === 'application/octet-stream')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : file.type;
  if (!ALLOWED_UPLOAD.test(mime)) return c.json({ error: 'Þessi skráartegund er ekki leyfð.' }, 400);
  const d = new Date();
  const safe = slugify(file.name.replace(/\.[^.]+$/, '')) + (file.name.match(/\.[a-zA-Z0-9]+$/)?.[0].toLowerCase() ?? '');
  const key = `uploads/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomId(6)}-${safe}`;
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: mime } });
  await run(c.env.DB, 'INSERT INTO media (key, filename, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)', key, file.name, mime, file.size, c.get('user')!.id);
  return c.json({ location: '/media/' + key });
});

app.get('/skrar', async (c) => {
  const user = c.get('user')!;
  const q = c.req.query('q') || '';
  const rows = await all<{ key: string; filename: string; content_type: string; size: number; created_at: string }>(c.env.DB,
    `SELECT key, filename, content_type, size, created_at FROM media WHERE filename LIKE ? ${isStaff(user) ? '' : 'AND uploaded_by = ' + user.id} ORDER BY id DESC LIMIT 200`, `%${q}%`);
  return page(c, 'Myndir og skjöl', 'skrar', (
    <>
      <h1>Myndir og skjöl</h1>
      <div class="upload-drop" data-library>
        <p><strong>Dragðu skrár hingað</strong> eða <label class="linklike">veldu skrár<input type="file" multiple hidden /></label>. Myndir eru minnkaðar sjálfkrafa.</p>
        <progress hidden max="100" value="0"></progress>
      </div>
      <form method="get" class="toolbar"><input name="q" type="search" value={q} placeholder="Leita að skráarheiti…" /><button class="btn small">Leita</button></form>
      <div class="media-grid">
        {rows.map((m) => (
          <figure>
            {m.content_type.startsWith('image/') ? <img src={'/media/' + m.key} alt="" loading="lazy" /> : <div class="file-icon">{m.filename.split('.').pop()?.toUpperCase()}</div>}
            <figcaption>
              <span title={m.filename}>{m.filename}</span>
              <button type="button" class="btn small ghost" data-copy={'/media/' + m.key}>Afrita slóð</button>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  ));
});

// ---------- Síður og valmynd ----------

type PageRow = { id: number; parent_id: number | null; slug: string; path: string; title: string; body: string; module: string; sort: number; in_menu: number; status: string; updated_at: string };

// Efnislistar sem eru ekki lengur notaðir á vefnum (sameinaðir öðrum); birtast ekki í vali fyrir nýjar síður
const RETIRED_MODULES = ['competitions', 'submitted'];
const MODULES: Record<string, string> = {
  '': 'Engin (venjuleg síða)', news: 'Fréttalisti', articles: 'Greinar (ásamt aðsendum greinum)', submitted: 'Aðsendar greinar (eingöngu)', events: 'Mót og viðburðir', competitions: 'Mótaskrá (eingöngu mót)',
  results: 'Úrslit', records: 'HSK met', clubs: 'Aðildarfélög', committees: 'Stjórn og nefndir', documents: 'Fundargerðir og skjöl', albums: 'Myndasöfn', sponsors: 'Styrktaraðilar',
  subpages: 'Listi yfir undirsíður', laws: 'Lög og reglugerðir (undirsíður í felligluggum, flokkaðar)',
  sections: 'Undirsíður á einni síðu, hver í felliglugga', grant: 'Umsóknarform Verkefnasjóðs', assemblies: 'Héraðsþing (úr liðnum Héraðsþing í vefumsjón)', archive: 'Undirsíður á einni síðu, nýjasta opin og eldri í felligluggum', first: 'Vísa beint á fyrstu undirsíðu',
};

function staffOnly(c: Context<AppEnv>) {
  return isStaff(c.get('user')!) ? null : c.text('Þú hefur ekki aðgang að þessu.', 403);
}

app.get('/sidur', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const pages = await all<PageRow>(c.env.DB, 'SELECT id, parent_id, title, path, module, sort, in_menu, status FROM pages ORDER BY sort, title');
  // Undirsíður sem birtast sem felligluggar á yfirsíðunni eru faldar þar til smellt er á „Sýna kafla“
  const FOLDED = ['sections', 'archive', 'laws'];
  const tree = (parent: number | null, depth: number, folded = false): Child[] => pages.filter((p) => p.parent_id === parent).flatMap((p, i, arr) => {
    const kids = pages.filter((k) => k.parent_id === p.id).length;
    const folds = FOLDED.includes(p.module) && kids > 0;
    return [
      <tr class={folded ? `fold-${parent}` : ''} hidden={folded}>
        <td style={`padding-left:${0.75 + depth * 1.75}rem`} class={depth ? 'child' : ''}>
          <a href={`/stjorn/sidur/${p.id}`}><strong>{p.title}</strong></a>
          <div class="muted small">/{p.path}{p.module && ` · ${MODULES[p.module]}`}</div>
          {folds && <button type="button" class="linklike small" data-unfold={`fold-${p.id}`} aria-expanded="false">Sýna {kids} kafla</button>}
        </td>
        <td>{folded ? <span class="muted">Felligluggi</span> : p.in_menu ? 'Í valmynd' : <span class="muted">Falin</span>}</td>
        <td><StatusPill status={p.status} /></td>
        <td class="row-actions">
          <form method="post" action={`/stjorn/sidur/${p.id}/faera`} class="inline">
            <button name="att" value="upp" class="icon-btn" title="Færa upp" aria-label="Færa upp" disabled={i === 0}><Icon name="chevronUp" /></button>
            <button name="att" value="nidur" class="icon-btn" title="Færa niður" aria-label="Færa niður" disabled={i === arr.length - 1}><Icon name="chevronDown" /></button>
          </form>
          {!folded && <a class="btn small ghost" href={`/stjorn/sidur/nytt?foreldri=${p.id}`}>{FOLDED.includes(p.module) ? 'Bæta við kafla' : 'Bæta við undirsíðu'}</a>}
          <a class="btn small ghost" href={'/' + p.path} target="_blank">Skoða</a>
        </td>
      </tr>,
      ...tree(p.id, depth + 1, folds),
    ];
  });
  return page(c, 'Síður og valmynd', 'sidur', (
    <>
      <div class="title-row"><h1>Síður og valmynd</h1><a class="btn" href="/stjorn/sidur/nytt">Ný síða</a></div>
      <p class="lead">Efstu síðurnar sem eru „í valmynd“ mynda aðalvalmynd vefsins og undirsíður þeirra birtast sem flipar. Sumar síður, t.d. Lög og reglugerðir og Héraðsþing, sýna undirsíður sínar sem felliglugga; smelltu á „Sýna kafla“ til að sjá þær. Notaðu örvarnar til að raða.</p>
      <table class="tbl tree">
        <thead><tr><th>Síða</th><th>Valmynd</th><th>Staða</th><th></th></tr></thead>
        <tbody>{tree(null, 0)}</tbody>
      </table>
    </>
  ));
});

async function pageForm(c: Context<AppEnv>, p: Partial<PageRow>, error?: string) {
  const pages = await all<PageRow>(c.env.DB, 'SELECT id, title, path FROM pages ORDER BY path');
  const isNew = !p.id;
  return page(c, isNew ? 'Ný síða' : p.title!, 'sidur', (
    <>
      <div class="title-row">
        <h1>{isNew ? 'Ný síða' : p.title}</h1>
        {!isNew && <a class="btn ghost" href={'/' + p.path} target="_blank">Skoða á vef</a>}
      </div>
      <form method="post" class="edit-form">
        <div class="form-grid">
          <div class="field wide"><label for="title">Titill <span class="req">*</span></label><input id="title" name="title" value={p.title ?? ''} required data-slug-source /></div>
          <div class="field"><label for="slug">Slóð</label><input id="slug" name="slug" value={p.slug ?? ''} data-slug-target placeholder="búin til úr titli" /><small class="help">Aðeins litlir stafir, tölur og bandstrik.</small></div>
          <div class="field"><label for="parent_id">Yfirsíða</label>
            <select id="parent_id" name="parent_id">
              <option value="">— Efsta stig —</option>
              {pages.filter((x) => x.id !== p.id && !(p.path && x.path.startsWith(p.path + '/'))).map((x) => <option value={String(x.id)} selected={x.id === p.parent_id}>{x.title} (/{x.path})</option>)}
            </select>
          </div>
          <div class="field"><label for="module">Efnislisti á síðunni</label>
            <select id="module" name="module">{Object.entries(MODULES).filter(([k]) => !RETIRED_MODULES.includes(k) || k === p.module).map(([k, l]) => <option value={k} selected={k === (p.module ?? '')}>{l}</option>)}</select>
            <small class="help">Birtir t.d. fréttir eða mót og viðburði fyrir neðan texta síðunnar.</small>
          </div>
          <div class="field"><label class="check"><input type="checkbox" name="in_menu" value="1" checked={p.in_menu !== 0} /> Sýna í valmynd</label></div>
          <div class="field wide"><label for="body">Texti</label><textarea id="body" name="body" class="rte" rows={16}>{p.body ?? ''}</textarea></div>
        </div>
        <div class="form-actions">
          <button class="btn" name="status" value="published">{isNew ? 'Birta síðu' : 'Vista og birta'}</button>
          <button class="btn ghost" name="status" value="draft">Vista sem drög</button>
          {!isNew && <a class="btn ghost" href={`/stjorn/saga/pages/${p.id}`}>Breytingasaga</a>}
        </div>
      </form>
      {!isNew && (
        <form method="post" action={`/stjorn/sidur/${p.id}/eyda`} class="danger-zone" data-confirm="Eyða síðunni? Undirsíður færast á efsta stig.">
          <button class="btn danger small">Eyða síðu</button>
        </form>
      )}
    </>
  ), { error });
}

app.get('/sidur/nytt', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  return pageForm(c, { parent_id: c.req.query('foreldri') ? parseInt(c.req.query('foreldri')!, 10) : null, in_menu: 1 });
});
app.get('/sidur/:id{[0-9]+}', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const p = await one<PageRow>(c.env.DB, 'SELECT * FROM pages WHERE id = ?', c.req.param('id'));
  return p ? pageForm(c, p) : c.notFound();
});

async function savePage(c: Context<AppEnv>, id: number | null) {
  const db = c.env.DB;
  const f = await c.req.formData();
  const user = c.get('user')!;
  const title = String(f.get('title') || '').trim();
  const parentId = f.get('parent_id') ? parseInt(String(f.get('parent_id')), 10) : null;
  const slug = slugify(String(f.get('slug') || '') || title);
  const parent = parentId ? await one<PageRow>(db, 'SELECT id, path FROM pages WHERE id = ?', parentId) : null;
  const path = parent ? `${parent.path}/${slug}` : slug;
  const data = {
    title, slug, path, parent_id: parent?.id ?? null, module: String(f.get('module') || ''), in_menu: f.get('in_menu') ? 1 : 0,
    status: f.get('status') === 'draft' ? 'draft' : 'published', body: sanitizeHtml(String(f.get('body') || '')),
  };
  const RESERVED = ['stjorn', 'frett', 'vidburdur', 'urslit', 'felag', 'album', 'media', 'leit', 'web', 'css', 'js', 'img', 'vendor'];
  const clash = await one<{ id: number }>(db, 'SELECT id FROM pages WHERE path = ? AND id != ?', path, id ?? -1);
  if (!title || clash || (!parent && RESERVED.includes(slug))) {
    return pageForm(c, { ...data, id: id ?? undefined }, !title ? 'Titil vantar.' : `Slóðin /${path} er þegar í notkun. Veldu aðra slóð.`);
  }
  if (id) {
    const old = await one<PageRow>(db, 'SELECT path FROM pages WHERE id = ?', id);
    await run(db, "UPDATE pages SET title=?, slug=?, path=?, parent_id=?, module=?, in_menu=?, status=?, body=?, updated_at=datetime('now'), updated_by=? WHERE id=?",
      data.title, data.slug, data.path, data.parent_id, data.module, data.in_menu, data.status, data.body, user.id, id);
    if (old && old.path !== path) {
      // Uppfæra slóðir undirsíðna og vísa gömlu slóðinni á nýja
      await run(db, 'UPDATE pages SET path = ? || substr(path, ?) WHERE path LIKE ?', path, old.path.length + 1, old.path + '/%');
      await run(db, 'INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES (?, ?)', 'path:' + old.path, '/' + path);
    }
    await logRevision(db, 'pages', id, user.id, 'update', data);
  } else {
    const maxSort = await one<{ s: number }>(db, 'SELECT coalesce(max(sort), 0) + 10 AS s FROM pages WHERE parent_id IS ?', data.parent_id);
    const r = await run(db, 'INSERT INTO pages (title, slug, path, parent_id, module, in_menu, status, body, sort, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
      data.title, data.slug, data.path, data.parent_id, data.module, data.in_menu, data.status, data.body, maxSort?.s ?? 10, user.id);
    id = Number(r.meta.last_row_id);
    await logRevision(db, 'pages', id, user.id, 'create', data);
  }
  return c.redirect(`/stjorn/sidur/${id}?m=vistad`);
}
app.post('/sidur/nytt', async (c) => staffOnly(c) ?? savePage(c, null));
app.post('/sidur/:id{[0-9]+}', async (c) => staffOnly(c) ?? savePage(c, parseInt(c.req.param('id'), 10)));

app.post('/sidur/:id{[0-9]+}/faera', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const p = await one<PageRow>(db, 'SELECT id, parent_id FROM pages WHERE id = ?', c.req.param('id'));
  if (!p) return c.notFound();
  const sibs = await all<PageRow>(db, 'SELECT id FROM pages WHERE parent_id IS ? ORDER BY sort, title', p.parent_id);
  const i = sibs.findIndex((s) => s.id === p.id);
  const j = (await c.req.formData()).get('att') === 'upp' ? i - 1 : i + 1;
  if (j >= 0 && j < sibs.length) [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  await db.batch(sibs.map((s, k) => db.prepare('UPDATE pages SET sort = ? WHERE id = ?').bind((k + 1) * 10, s.id)));
  return c.redirect('/stjorn/sidur');
});

app.post('/sidur/:id{[0-9]+}/eyda', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const id = parseInt(c.req.param('id'), 10);
  const p = await one<PageRow>(c.env.DB, 'SELECT * FROM pages WHERE id = ?', id);
  if (!p) return c.notFound();
  await logRevision(c.env.DB, 'pages', id, c.get('user')!.id, 'delete', p);
  await run(c.env.DB, 'UPDATE pages SET parent_id = NULL WHERE parent_id = ?', id);
  await run(c.env.DB, 'DELETE FROM pages WHERE id = ?', id);
  return c.redirect('/stjorn/sidur?m=eytt');
});

// ---------- Stillingar ----------

app.get('/stillingar', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const s = async (k: string, d = '') => getSetting(db, k, d);
  return page(c, 'Forsíða og stillingar', 'stillingar', (
    <>
      <h1>Forsíða og stillingar</h1>
      <form method="post" class="edit-form">
        <div class="form-grid">
          <div class="field wide"><h2 class="sub-h">Stóra myndin efst á forsíðu</h2><small class="help">Skildu fyrirsögn eftir tóma til að sýna nýjustu fréttina sjálfkrafa.</small></div>
          <div class="field"><label for="hero_title">Fyrirsögn</label><input id="hero_title" name="hero_title" value={await s('hero_title')} placeholder="T.d. Unglingalandsmót UMFÍ 2027" /></div>
          <div class="field"><label for="hero_button">Texti á hnappi</label><input id="hero_button" name="hero_button" value={await s('hero_button')} placeholder="Nánar" /></div>
          <div class="field wide"><label for="hero_text">Stuttur texti</label><textarea id="hero_text" name="hero_text" rows={2}>{await s('hero_text')}</textarea></div>
          <div class="field"><label for="hero_link">Slóð hnapps</label><input id="hero_link" name="hero_link" value={await s('hero_link')} placeholder="/vidburdur/123 eða https://…" /></div>
          <div class="field wide"><label for="hero_image">Mynd</label>
            <div class="upload-field" data-kind="image">
              <img class="preview" src={(await s('hero_image')) || undefined} alt="" hidden={!(await s('hero_image'))} />
              <div class="upload-row">
                <input id="hero_image" name="hero_image" type="text" value={await s('hero_image')} placeholder="Slóð á mynd" />
                <label class="btn small ghost">Hlaða upp<input type="file" accept="image/*" hidden /></label>
                <button type="button" class="btn small ghost" data-clear>Fjarlægja</button>
              </div>
            </div>
            <small class="help">Breið ljósmynd (helst 2000 px á breidd). Texti birtist neðst á myndinni.</small>
          </div>
          <div class="field wide"><label for="notice">Tilkynningaborði efst á öllum síðum</label>
            <textarea id="notice" name="notice" class="rte rte-small" rows={3}>{await s('notice')}</textarea>
            <small class="help">Skildu eftir tómt til að fela borðann. T.d. „Opið fyrir umsóknir í Hvatasjóð til 12. desember“.</small>
          </div>
          <div class="field wide"><label for="home_tiles">Reitir neðst á forsíðu</label>
            <textarea id="home_tiles" name="home_tiles" rows={4}>{await s('home_tiles', DEFAULT_TILES)}</textarea>
            <small class="help">Ein lína fyrir hvern reit: Fyrirsögn | stuttur texti | slóð. T.d. „Styrkir og sjóðir | Verkefnasjóður HSK | /um-hsk/verkefnasjodur“</small>
          </div>
          <div class="field"><label for="contact_address">Heimilisfang</label><input id="contact_address" name="contact_address" value={await s('contact_address', 'Selinu, Engjavegi 48, 800 Selfossi')} /></div>
          <div class="field"><label for="contact_phone">Sími</label><input id="contact_phone" name="contact_phone" value={await s('contact_phone', '482 1189')} /></div>
          <div class="field"><label for="contact_email">Netfang</label><input id="contact_email" name="contact_email" type="email" value={await s('contact_email', 'hsk@hsk.is')} /></div>
        </div>
        <div class="form-actions"><button class="btn">Vista</button></div>
      </form>
    </>
  ));
});

app.post('/stillingar', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  for (const k of ['hero_title', 'hero_text', 'hero_image', 'hero_link', 'hero_button', 'home_tiles', 'contact_address', 'contact_phone', 'contact_email']) await setSetting(c.env.DB, k, String(f.get(k) ?? '').trim());
  const notice = sanitizeHtml(String(f.get('notice') ?? '')).trim();
  await setSetting(c.env.DB, 'notice', plainText(notice) ? notice : '');
  await logRevision(c.env.DB, 'settings', 0, c.get('user')!.id, 'update', Object.fromEntries(f));
  return c.redirect('/stjorn/stillingar?m=vistad');
});



// ---------- Minn aðgangur: lykilorð ----------

app.get('/adgangur', async (c) => {
  const user = c.get('user')!;
  const row = await one<{ password_hash: string | null }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', user.id);
  const has = !!row?.password_hash;
  const err = c.req.query('villa');
  return page(c, 'Minn aðgangur', 'adgangur', (
    <>
      <h1>Minn aðgangur</h1>
      <p class="lead">{user.email}</p>
      <section class="panel">
        <h2>{has ? 'Breyta lykilorði' : 'Setja lykilorð'}</h2>
        {err && <p class="flash err">{err === 'rangt' ? 'Núverandi lykilorð er rangt.' : err === 'stutt' ? 'Nýja lykilorðið þarf að vera að minnsta kosti 10 stafir.' : 'Lykilorðin tvö eru ekki eins.'}</p>}
        <form method="post" action="/stjorn/adgangur" class="form-grid">
          {has && <div class="field wide"><label for="current">Núverandi lykilorð</label><input id="current" name="current" type="password" required autocomplete="current-password" /></div>}
          <div class="field"><label for="new">Nýtt lykilorð</label><input id="new" name="new" type="password" required minlength={10} autocomplete="new-password" /><small class="help">Að minnsta kosti 10 stafir.</small></div>
          <div class="field"><label for="again">Nýtt lykilorð aftur</label><input id="again" name="again" type="password" required minlength={10} autocomplete="new-password" /></div>
          <div class="form-actions wide"><button class="btn">Vista lykilorð</button></div>
        </form>
      </section>
    </>
  ));
});

app.post('/adgangur', async (c) => {
  const user = c.get('user')!;
  const f = await c.req.formData();
  const row = await one<{ password_hash: string | null }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', user.id);
  if (row?.password_hash && !(await verifyPassword(String(f.get('current') || ''), row.password_hash))) return c.redirect('/stjorn/adgangur?villa=rangt');
  const pw = String(f.get('new') || '');
  if (pw.length < 10) return c.redirect('/stjorn/adgangur?villa=stutt');
  if (pw !== String(f.get('again') || '')) return c.redirect('/stjorn/adgangur?villa=ekki-eins');
  await run(c.env.DB, 'UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', await hashPassword(pw), user.id);
  return c.redirect('/stjorn/adgangur?m=vistad');
});

// ---------- Héraðsþing ----------

type Assembly = { id: number; slug: string; title: string; date: string | null; location: string; intro: string; status: string };

app.get('/heradsthing', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const rows = await all<Assembly & { docs: number }>(c.env.DB,
    'SELECT a.*, (SELECT count(*) FROM assembly_docs d WHERE d.assembly_id = a.id) AS docs FROM assemblies a ORDER BY a.date IS NOT NULL, a.date DESC, a.id DESC');
  return page(c, 'Héraðsþing', 'heradsthing', (
    <>
      <div class="title-row"><h1>Héraðsþing</h1><a class="btn" href="/stjorn/heradsthing/nytt">Skrá nýtt þing</a></div>
      <p class="lead">Þingin birtast á síðunni <a href="/um-hsk/heradsthing" target="_blank">Héraðsþing</a>, nýjasta þingið efst eftir dagsetningu og eldri þing í felligluggum.</p>
      <table class="tbl">
        <thead><tr><th>Þing</th><th>Dagsetning</th><th>Þinggögn</th><th>Staða</th></tr></thead>
        <tbody>{rows.map((a) => (
          <tr>
            <td><a href={`/stjorn/heradsthing/${a.id}`}><strong>{a.title}</strong></a>{a.location && <div class="muted small">{a.location}</div>}</td>
            <td>{a.date ? dateLong(a.date) : <span class="muted">Vantar</span>}</td>
            <td>{a.docs}</td>
            <td><StatusPill status={a.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </>
  ));
});

async function assemblyForm(c: Context<AppEnv>, a: Partial<Assembly>, docs: { title: string; file: string }[], error?: string) {
  const isNew = !a.id;
  const docRow = (d: { title: string; file: string }) => (
    <div class="doc-row">
      <input name="doc_title" value={d.title} placeholder="Heiti skjals, t.d. Dagskrá héraðsþings" aria-label="Heiti skjals" />
      <a class="doc-file" href={d.file} target="_blank">{decodeURIComponent(d.file.split('/').pop() ?? '')}</a>
      <input type="hidden" name="doc_file" value={d.file} />
      <button type="button" class="icon-btn" data-doc-up title="Færa upp" aria-label="Færa upp"><Icon name="chevronUp" /></button>
      <button type="button" class="icon-btn" data-doc-down title="Færa niður" aria-label="Færa niður"><Icon name="chevronDown" /></button>
      <button type="button" class="btn small ghost" data-doc-remove>Fjarlægja</button>
    </div>
  );
  return page(c, isNew ? 'Nýtt héraðsþing' : a.title!, 'heradsthing', (
    <>
      <p><a href="/stjorn/heradsthing">← Öll þing</a></p>
      <h1>{isNew ? 'Nýtt héraðsþing' : a.title}</h1>
      <form method="post" class="edit-form" action={isNew ? '/stjorn/heradsthing/nytt' : `/stjorn/heradsthing/${a.id}`}>
        <div class="form-grid">
          <div class="field wide"><label for="title">Heiti <span class="req">*</span></label><input id="title" name="title" value={a.title ?? ''} required placeholder="T.d. Héraðsþing á Selfossi 18. mars 2027" /></div>
          <div class="field"><label for="date">Þingdagur <span class="req">*</span></label><input id="date" name="date" type="date" value={a.date ?? ''} required /><small class="help">Ræður röðinni: nýjasta þingið birtist efst.</small></div>
          <div class="field"><label for="location">Staður</label><input id="location" name="location" value={a.location ?? ''} placeholder="T.d. Selfoss" /></div>
          <div class="field wide"><label for="intro">Inngangur (valfrjálst)</label><textarea id="intro" name="intro" class="rte rte-small" rows={3}>{a.intro ?? ''}</textarea></div>
          <div class="field wide">
            <label>Þinggögn</label>
            <div class="doc-rows" data-doc-rows>{docs.map(docRow)}</div>
            <template id="doc-row-tpl">{docRow({ title: '', file: '' })}</template>
            <div class="upload-drop" data-doc-upload>
              <p><strong>Dragðu skjöl hingað</strong> eða <label class="linklike">veldu skjöl<input type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,image/*" /></label>. Heiti skjals er búið til úr skráarnafninu og má breyta.</p>
              <progress hidden max="100" value="0"></progress>
            </div>
          </div>
          <div class="field"><label class="check"><input type="checkbox" name="published" value="1" checked={(a.status ?? 'published') === 'published'} /> Birta á vefnum</label></div>
        </div>
        {error && <p class="flash err">{error}</p>}
        <div class="form-actions"><button class="btn">Vista</button>{!isNew && <a class="btn ghost" href={`/um-hsk/heradsthing#${a.slug}`} target="_blank">Skoða á vef</a>}</div>
      </form>
      {!isNew && (
        <form method="post" action={`/stjorn/heradsthing/${a.id}/eyda`} class="danger-zone" data-confirm="Eyða þessu þingi af vefnum? Skjölin sjálf haldast í „Myndir og skjöl“.">
          <button class="btn danger small">Eyða þingi</button>
        </form>
      )}
    </>
  ));
}

app.get('/heradsthing/nytt', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  return assemblyForm(c, {}, []);
});

app.get('/heradsthing/:id{[0-9]+}', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const a = await one<Assembly>(c.env.DB, 'SELECT * FROM assemblies WHERE id = ?', c.req.param('id'));
  if (!a) return c.notFound();
  const docs = await all<{ title: string; file: string }>(c.env.DB, 'SELECT title, file FROM assembly_docs WHERE assembly_id = ? ORDER BY sort, id', a.id);
  return assemblyForm(c, a, docs);
});

async function saveAssembly(c: Context<AppEnv>, id: number | null) {
  const f = await c.req.formData();
  const title = String(f.get('title') ?? '').trim();
  const date = String(f.get('date') ?? '').trim();
  const titles = f.getAll('doc_title').map(String);
  const docs = f.getAll('doc_file').map(String).map((file, i) => ({ file, title: (titles[i] ?? '').trim() || decodeURIComponent(file.split('/').pop() ?? 'Skjal') })).filter((d) => d.file);
  const a: Partial<Assembly> = { id: id ?? undefined, title, date: date || null, location: String(f.get('location') ?? '').trim(), intro: sanitizeHtml(String(f.get('intro') ?? '')), status: f.get('published') ? 'published' : 'draft' };
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return assemblyForm(c, a, docs, 'Heiti og þingdagur eru nauðsynleg.');
  const db = c.env.DB;
  if (id) {
    await run(db, "UPDATE assemblies SET title = ?, date = ?, location = ?, intro = ?, status = ?, updated_at = datetime('now') WHERE id = ?", title, date, a.location, a.intro, a.status, id);
  } else {
    const slug = await uniqueSlug(db, 'assemblies', title);
    id = Number((await run(db, 'INSERT INTO assemblies (slug, title, date, location, intro, status) VALUES (?, ?, ?, ?, ?, ?)', slug, title, date, a.location, a.intro, a.status)).meta.last_row_id);
  }
  await run(db, 'DELETE FROM assembly_docs WHERE assembly_id = ?', id);
  for (const [i, d] of docs.entries()) await run(db, 'INSERT INTO assembly_docs (assembly_id, title, file, sort) VALUES (?, ?, ?, ?)', id, d.title, d.file, i * 10);
  await logRevision(db, 'assemblies', id, c.get('user')!.id, 'update', { ...a, docs });
  return c.redirect(`/stjorn/heradsthing/${id}?m=vistad`);
}

app.post('/heradsthing/nytt', async (c) => { const deny = staffOnly(c); if (deny) return deny; return saveAssembly(c, null); });
app.post('/heradsthing/:id{[0-9]+}', async (c) => { const deny = staffOnly(c); if (deny) return deny; return saveAssembly(c, Number(c.req.param('id'))); });
app.post('/heradsthing/:id{[0-9]+}/eyda', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  await run(c.env.DB, 'DELETE FROM assemblies WHERE id = ?', c.req.param('id'));
  return c.redirect('/stjorn/heradsthing?m=eytt');
});

// ---------- Umsóknir (Verkefnasjóður) ----------

type AppRow = { id: number; kind: string; title: string; data: string; files: string; status: string; note: string; created_at: string };

app.get('/umsoknir', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const rows = await all<AppRow>(c.env.DB, 'SELECT id, title, data, status, created_at FROM applications ORDER BY status, created_at DESC LIMIT 300');
  return page(c, 'Umsóknir', 'umsoknir', (
    <>
      <h1>Umsóknir í Verkefnasjóð</h1>
      <p class="lead">Umsóknir sem berast í gegnum formið á síðunni Verkefnasjóður. Nýjar umsóknir eru efst.</p>
      {rows.length === 0 ? <p class="muted">Engar umsóknir hafa borist.</p> : (
        <table class="tbl">
          <thead><tr><th>Umsókn</th><th>Upphæð</th><th>Barst</th><th>Staða</th></tr></thead>
          <tbody>{rows.map((r) => {
            const d = JSON.parse(r.data) as Record<string, string>;
            return (
              <tr>
                <td><a href={`/stjorn/umsoknir/${r.id}`}><strong>{d.felag}</strong></a><div class="muted small">{d.verkefni}</div></td>
                <td>{Number(d.upphaed || 0).toLocaleString('is-IS')} kr.</td>
                <td>{dateLong(r.created_at)}</td>
                <td>{r.status === 'ny' ? <span class="pill pending">Ný</span> : <span class="pill published">Afgreidd</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </>
  ));
});

app.get('/umsoknir/:id{[0-9]+}', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const r = await one<AppRow>(c.env.DB, 'SELECT * FROM applications WHERE id = ?', c.req.param('id'));
  if (!r) return c.notFound();
  const d = JSON.parse(r.data) as Record<string, string>;
  const files = JSON.parse(r.files) as { key: string; name: string; label: string }[];
  return page(c, r.title, 'umsoknir', (
    <>
      <p><a href="/stjorn/umsoknir">← Allar umsóknir</a></p>
      <h1>{d.verkefni}</h1>
      <p class="lead">{d.felag} · barst {dateLong(r.created_at)} · {r.status === 'ny' ? 'Ný' : 'Afgreidd'}</p>
      <dl class="app-data">
        {GRANT_FIELDS.map((f) => <><dt>{f.label}</dt><dd style="white-space: pre-wrap">{f.name === 'upphaed' ? `${Number(d[f.name] || 0).toLocaleString('is-IS')} kr.` : d[f.name] || '—'}</dd></>)}
        <dt>Fylgiskjöl</dt>
        <dd>{files.length ? files.map((f, i) => <div><a href={`/stjorn/umsoknir/${r.id}/skra/${i}`}>{f.name}</a> <span class="muted small">({f.label})</span></div>) : '—'}</dd>
      </dl>
      <form method="post" action={`/stjorn/umsoknir/${r.id}/stada`} class="edit-form">
        <div class="field wide"><label for="note">Athugasemd starfsfólks (sést ekki opinberlega)</label><textarea id="note" name="note" rows={3}>{r.note}</textarea></div>
        <div class="form-actions">
          <button class="btn" name="status" value={r.status === 'ny' ? 'afgreidd' : 'ny'}>{r.status === 'ny' ? 'Merkja afgreidda' : 'Merkja sem nýja'}</button>
          <button class="btn ghost" name="status" value={r.status}>Vista athugasemd</button>
        </div>
      </form>
      <form method="post" action={`/stjorn/umsoknir/${r.id}/eyda`} class="danger-zone" data-confirm="Eyða umsókninni og fylgiskjölum hennar fyrir fullt og allt?">
        <button class="btn danger">Eyða umsókn</button>
      </form>
    </>
  ));
});

app.get('/umsoknir/:id{[0-9]+}/skra/:n{[0-9]+}', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const r = await one<AppRow>(c.env.DB, 'SELECT files FROM applications WHERE id = ?', c.req.param('id'));
  const f = r ? (JSON.parse(r.files) as { key: string; name: string; type: string }[])[Number(c.req.param('n'))] : undefined;
  const obj = f && await c.env.MEDIA.get(f.key);
  if (!f || !obj) return c.notFound();
  return new Response(obj.body, { headers: {
    'content-type': f.type || 'application/octet-stream',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'cache-control': 'private, no-store',
  } });
});

app.post('/umsoknir/:id{[0-9]+}/stada', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  const status = f.get('status') === 'afgreidd' ? 'afgreidd' : 'ny';
  await run(c.env.DB, 'UPDATE applications SET status = ?, note = ? WHERE id = ?', status, String(f.get('note') ?? '').slice(0, 5000), c.req.param('id'));
  return c.redirect(`/stjorn/umsoknir/${c.req.param('id')}?m=vistad`);
});

app.post('/umsoknir/:id{[0-9]+}/eyda', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const r = await one<AppRow>(c.env.DB, 'SELECT files FROM applications WHERE id = ?', c.req.param('id'));
  if (r) for (const f of JSON.parse(r.files) as { key: string }[]) await c.env.MEDIA.delete(f.key);
  await run(c.env.DB, 'DELETE FROM applications WHERE id = ?', c.req.param('id'));
  return c.redirect('/stjorn/umsoknir?m=eytt');
});

// ---------- Notendur ----------

function adminOnly(c: Context<AppEnv>) {
  return can(c.get('user'), 'admin') ? null : c.text('Aðeins stjórnendur hafa aðgang að þessu.', 403);
}

app.get('/notendur', async (c) => {
  const deny = adminOnly(c); if (deny) return deny;
  const users = await all<{ id: number; email: string; name: string; role: string; club: string | null; active: number; last_login_at: string | null }>(c.env.DB,
    'SELECT u.id, u.email, u.name, u.role, cl.name AS club, u.active, u.last_login_at FROM users u LEFT JOIN clubs cl ON cl.id = u.club_id ORDER BY u.active DESC, u.role, u.email');
  const clubs = await all<{ id: number; name: string }>(c.env.DB, 'SELECT id, name FROM clubs ORDER BY name');
  const roles: Record<string, string> = { admin: 'Stjórnandi', editor: 'Ritstjóri', club: 'Félagsaðgangur' };
  return page(c, 'Notendur', 'notendur', (
    <>
      <h1>Notendur</h1>
      <p class="lead">Starfsfólk með @{c.env.STAFF_DOMAIN}-netfang getur skráð sig inn sem ritstjóri án boðs. Formönnum aðildarfélaga þarf að bjóða hér og tengja þá við sitt félag.</p>
      <section class="panel">
        <h2>Bjóða notanda</h2>
        <form method="post" action="/stjorn/notendur/bjoda" class="form-grid">
          <div class="field"><label for="email">Netfang</label><input id="email" name="email" type="email" required placeholder="formadur@gmail.com" /></div>
          <div class="field"><label for="name">Nafn</label><input id="name" name="name" /></div>
          <div class="field"><label for="role">Hlutverk</label><select id="role" name="role">{Object.entries(roles).map(([k, l]) => <option value={k} selected={k === 'club'}>{l}</option>)}</select></div>
          <div class="field"><label for="club_id">Aðildarfélag</label><select id="club_id" name="club_id"><option value="">—</option>{clubs.map((cl) => <option value={String(cl.id)}>{cl.name}</option>)}</select></div>
          <div class="form-actions wide"><button class="btn">Senda boð</button></div>
        </form>
      </section>
      <table class="tbl">
        <thead><tr><th>Notandi</th><th>Hlutverk</th><th>Félag</th><th>Síðast inni</th><th></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr class={u.active ? '' : 'inactive'}>
            <td><strong>{u.name || '—'}</strong><div class="muted small">{u.email}</div></td>
            <td>{roles[u.role]}</td>
            <td>{u.club ?? '—'}</td>
            <td>{u.last_login_at ? dateLong(u.last_login_at) : <span class="muted">Aldrei</span>}</td>
            <td class="row-actions">
              <form method="post" action={`/stjorn/notendur/${u.id}`} class="inline user-edit">
                <select name="role" aria-label="Hlutverk">{Object.entries(roles).map(([k, l]) => <option value={k} selected={k === u.role}>{l}</option>)}</select>
                <select name="club_id" aria-label="Félag"><option value="">—</option>{clubs.map((cl) => <option value={String(cl.id)} selected={cl.name === u.club}>{cl.name}</option>)}</select>
                <button class="btn small ghost">Vista</button>
                {u.id !== c.get('user')!.id && <button class="btn small ghost" name="active" value={u.active ? '0' : '1'}>{u.active ? 'Loka aðgangi' : 'Opna aðgang'}</button>}
              </form>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </>
  ));
});

app.post('/notendur/bjoda', async (c) => {
  const deny = adminOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  const email = String(f.get('email') || '').trim().toLowerCase();
  const role = ['admin', 'editor', 'club'].includes(String(f.get('role'))) ? String(f.get('role')) : 'club';
  const clubId = f.get('club_id') ? parseInt(String(f.get('club_id')), 10) : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.redirect('/stjorn/notendur');
  await run(c.env.DB, `INSERT INTO users (email, name, role, club_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET role = excluded.role, club_id = excluded.club_id, active = 1, name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END`,
    email, String(f.get('name') || '').trim(), role, role === 'club' ? clubId : null);
  const token = await createLoginToken(c.env, email);
  await sendMail(c.env, email, 'Þér hefur verið boðinn aðgangur að vef HSK',
    `Halló,\n\nÞér hefur verið boðinn aðgangur að vefumsjón Héraðssambandsins Skarphéðins (HSK).\n\nSkráðu þig inn hér:\n${c.env.SITE_URL}/stjorn/innskra?t=${encodeURIComponent(token)}\n\nTengillinn gildir í 20 mínútur. Eftir það getur þú alltaf skráð þig inn á ${c.env.SITE_URL}/stjorn með þessu netfangi.`);
  return c.redirect('/stjorn/notendur?m=bodid');
});

app.post('/notendur/:id{[0-9]+}', async (c) => {
  const deny = adminOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  const id = parseInt(c.req.param('id'), 10);
  const role = ['admin', 'editor', 'club'].includes(String(f.get('role'))) ? String(f.get('role')) : 'club';
  const clubId = f.get('club_id') ? parseInt(String(f.get('club_id')), 10) : null;
  await run(c.env.DB, 'UPDATE users SET role = ?, club_id = ? WHERE id = ?', role, role === 'club' ? clubId : null, id);
  if (f.get('active') !== null && id !== c.get('user')!.id) {
    await run(c.env.DB, 'UPDATE users SET active = ? WHERE id = ?', f.get('active') === '1' ? 1 : 0, id);
    if (f.get('active') === '0') await run(c.env.DB, 'DELETE FROM sessions WHERE user_id = ?', id);
  }
  return c.redirect('/stjorn/notendur?m=vistad');
});

// ---------- Breytingasaga ----------

app.get('/saga/:table/:id{[0-9]+}', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const table = c.req.param('table');
  const id = parseInt(c.req.param('id'), 10);
  const revs = await all<{ id: number; action: string; created_at: string; who: string | null; data: string }>(c.env.DB,
    'SELECT r.id, r.action, r.created_at, u.email AS who, r.data FROM revisions r LEFT JOIN users u ON u.id = r.user_id WHERE r.entity = ? AND r.entity_id = ? ORDER BY r.id DESC LIMIT 100', table, id);
  const t = contentTypes.find((x) => x.table === table);
  const back = table === 'pages' ? `/stjorn/sidur/${id}` : t ? `/stjorn/${t.key}/${id}` : '/stjorn';
  return page(c, 'Breytingasaga', t?.key ?? 'sidur', (
    <>
      <h1>Breytingasaga</h1>
      <p><a class="back" href={back}><Icon name="chevronLeft" />Til baka</a></p>
      <table class="tbl">
        <thead><tr><th>Hvenær</th><th>Hver</th><th>Aðgerð</th><th>Útgáfa</th><th></th></tr></thead>
        <tbody>{revs.map((r, i) => {
          let d: Record<string, unknown> = {};
          try { d = JSON.parse(r.data); } catch { /* tómt */ }
          return (
            <tr>
              <td>{dateTime(r.created_at)}</td><td>{r.who ?? '—'}</td><td>{actionLabel(r.action)}</td>
              <td><details><summary>{String(d.title ?? d.name ?? 'Skoða')}</summary><div class="rev-preview">{plainText(String(d.body ?? d.description ?? ''), 600)}</div></details></td>
              <td>{i > 0 && r.action !== 'delete' && (
                <form method="post" action={`/stjorn/saga/${r.id}/endurheimta`} data-confirm="Endurheimta þessa útgáfu? Núverandi útgáfa geymist í sögunni.">
                  <button class="btn small ghost">Endurheimta</button>
                </form>
              )}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  ));
});

app.post('/saga/:rev{[0-9]+}/endurheimta', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const rev = await one<{ entity: string; entity_id: number; data: string }>(db, 'SELECT entity, entity_id, data FROM revisions WHERE id = ?', c.req.param('rev'));
  if (!rev) return c.notFound();
  const data = JSON.parse(rev.data) as Record<string, unknown>;
  const allowed = rev.entity === 'pages'
    ? ['title', 'body', 'module', 'in_menu', 'status']
    : contentTypes.find((t) => t.table === rev.entity)?.fields.map((f) => f.name) ?? [];
  const cols = allowed.filter((k) => k in data);
  if (!cols.length) return c.redirect('/stjorn');
  await run(db, `UPDATE ${rev.entity} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => data[k] as never), rev.entity_id);
  await logRevision(db, rev.entity, rev.entity_id, c.get('user')!.id, 'restore', data);
  const t = contentTypes.find((x) => x.table === rev.entity);
  return c.redirect((rev.entity === 'pages' ? `/stjorn/sidur/${rev.entity_id}` : `/stjorn/${t?.key}/${rev.entity_id}`) + '?m=endurheimt');
});

// ---------- Almennar efnistegundir ----------

async function refOptions(c: Context<AppEnv>, t: ContentType) {
  const db = c.env.DB;
  const need = new Set(t.fields.map((f) => f.type));
  return {
    club: need.has('club') ? (await all<{ id: number; name: string }>(db, 'SELECT id, name FROM clubs ORDER BY name')).map((r) => ({ id: r.id, label: r.name })) : [],
    event: need.has('event') ? (await all<{ id: number; title: string; starts_at: string }>(db, 'SELECT id, title, starts_at FROM events ORDER BY starts_at DESC LIMIT 400')).map((r) => ({ id: r.id, label: `${dateLong(r.starts_at)} – ${r.title}` })) : [],
    album: need.has('album') ? (await all<{ id: number; title: string; date: string }>(db, 'SELECT id, title, date FROM albums ORDER BY date DESC LIMIT 300')).map((r) => ({ id: r.id, label: `${dateLong(r.date)} – ${r.title}` })) : [],
    ...(need.has('suggest') ? await recordSuggestions(db) : {}),
  };
}

/** Tillögur fyrir skráningu nýrra meta: greinar, aldursflokkar og staðir sem þegar eru í HSK met */
async function recordSuggestions(db: D1Database) {
  const added = await all<{ event: string; age_group: string; place: string }>(db, 'SELECT event, age_group, place FROM record_entries');
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'is', { numeric: true })).map((label, id) => ({ id, label }));
  return {
    record_events: uniq([...archivedRecords.map((r) => r.event), ...added.map((r) => r.event)]),
    record_groups: uniq([...archivedRecords.flatMap((r) => r.groups), ...added.map((r) => r.age_group)]),
    record_places: uniq([...archivedRecords.map((r) => r.place), ...added.map((r) => r.place)]),
  };
}

function visibleFields(t: ContentType, user: User): Field[] {
  return t.fields.filter((f) => isStaff(user) || !f.staffOnly);
}

/** Má notandinn skoða / breyta þessari færslu? */
function canEdit(t: ContentType, user: User, row: Row | null): boolean {
  if (isStaff(user)) return true;
  if (t.clubOwnRecord) return !!row && row.id === user.club_id;
  if (!t.clubSubmit) return false;
  if (!row) return true; // nýtt innsent efni
  return row.club_id === user.club_id && row.status !== 'published';
}

app.get('/:type', async (c) => {
  const t = getType(c.req.param('type'));
  if (!t) return c.notFound();
  const user = c.get('user')!;
  if (!isStaff(user)) {
    if (t.clubOwnRecord) return c.redirect(`/stjorn/${t.key}/${user.club_id ?? 0}`);
    if (!t.clubSubmit) return c.text('Þú hefur ekki aðgang að þessu.', 403);
  }
  const q = (c.req.query('q') || '').trim();
  const status = c.req.query('stada') || '';
  const pageNo = Math.max(1, parseInt(c.req.query('s') || '1', 10) || 1);
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) { where.push('(' + t.searchFields.map((f) => `${f} LIKE ?`).join(' OR ') + ')'); t.searchFields.forEach(() => params.push(`%${q}%`)); }
  // Tvítekningar sem voru faldar við flutning af gamla vefnum sjást aðeins ef beðið er um þær
  const DUP = "(status = 'draft' AND (review_note LIKE 'Tvískráð%' OR review_note LIKE 'Tvítekin%'))";
  if (status === 'tvitekid' && t.status) where.push(DUP);
  else if (status && t.status) { where.push('status = ?'); params.push(status); }
  if (status !== 'tvitekid' && t.status && (t.table === 'events' || t.table === 'news')) where.push('NOT ' + DUP);
  if (!isStaff(user)) { where.push('club_id = ?'); params.push(user.club_id ?? 0); }
  const per = 50;
  const rows = await all<Row>(c.env.DB, `SELECT * FROM ${t.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${t.order} LIMIT ? OFFSET ?`, ...params, per + 1, (pageNo - 1) * per);
  const fmt = (col: ContentType['listColumns'][number], r: Row): Child => {
    const v = r[col.field];
    if (col.format === 'status') return <StatusPill status={String(v)} />;
    if (col.format === 'date') return v ? dateLong(String(v)) : '—';
    if (col.format === 'datetime') return v ? dateTime(String(v)) : '—';
    if (col.format === 'option') return t.fields.find((f) => f.name === col.field)?.options?.[String(v)] ?? String(v ?? '');
    return String(v ?? '');
  };
  const qs = (extra: Record<string, string>) => '?' + new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { stada: status } : {}), ...extra });
  return page(c, t.label, t.key, (
    <>
      {(t.key === 'ny-met' || t.key === 'met') ? (
        // HSK met: stök met og metaskrár (Excel) á einum stað, með flipum
        <>
          <div class="title-row"><h1>HSK met</h1><a class="btn" href={`/stjorn/${t.key}/nytt`}>{t.key === 'ny-met' ? 'Skrá nýtt met' : 'Hlaða inn metaskrá'}</a></div>
          <nav class="subtabs"><a href="/stjorn/ny-met" class={t.key === 'ny-met' ? 'on' : ''}>Skráð met</a><a href="/stjorn/met" class={t.key === 'met' ? 'on' : ''}>Metaskrár (Excel)</a></nav>
          <p class="lead">{t.key === 'ny-met' ? 'Stök met sem skráð eru hér birtast strax í töflunni á síðunni HSK met.' : 'Heilar metaskrár í Excel. Metin í þeim birtast í sömu töflu á síðunni HSK met.'}</p>
        </>
      ) : (
        <div class="title-row"><h1>{t.label}</h1><a class="btn" href={`/stjorn/${t.key}/nytt`}>{isStaff(user) ? `Skrá ${t.singular}` : `Senda inn ${t.singular}`}</a></div>
      )}
      <form method="get" class="toolbar">
        <input name="q" type="search" value={q} placeholder="Leita…" aria-label="Leita" />
        {t.status && (
          <select name="stada" aria-label="Staða">
            <option value="">Allar stöður</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option value={k} selected={k === status}>{l}</option>)}
            {(t.table === 'events' || t.table === 'news') && <option value="tvitekid" selected={status === 'tvitekid'}>Tvítekið (falið)</option>}
          </select>
        )}
        <button class="btn small">Sía</button>
      </form>
      <table class="tbl">
        <thead><tr>{t.listColumns.map((col) => <th>{col.label}</th>)}<th></th></tr></thead>
        <tbody>
          {rows.slice(0, per).map((r) => (
            <tr>
              {t.listColumns.map((col, i) => <td>{i === 0 ? <a href={`/stjorn/${t.key}/${r.id}`}><strong>{fmt(col, r)}</strong></a> : fmt(col, r)}</td>)}
              <td class="row-actions">{t.publicUrl && (!t.status || r.status === 'published') && <a class="btn small ghost" href={t.publicUrl(r)} target="_blank">Skoða</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p class="muted">Ekkert fannst.</p>}
      <nav class="pager">
        {pageNo > 1 ? <a href={qs({ s: String(pageNo - 1) })}><Icon name="chevronLeft" />Fyrri</a> : <span></span>}
        <span>Síða {pageNo}</span>
        {rows.length > per ? <a href={qs({ s: String(pageNo + 1) })}>Næsta<Icon name="chevronRight" /></a> : <span></span>}
      </nav>
    </>
  ));
});

async function editForm(c: Context<AppEnv>, t: ContentType, row: Partial<Row> | null, error?: string) {
  const user = c.get('user')!;
  const opts = await refOptions(c, t);
  const isNew = !row?.id;
  const status = String(row?.status ?? '');
  const title = isNew ? (isStaff(user) ? `Skrá ${t.singular}` : `Senda inn ${t.singular}`) : String(row![t.titleField] ?? '');
  const photos = t.table === 'albums' && row?.id ? await all<{ id: number; src: string; caption: string; sort: number }>(c.env.DB, 'SELECT * FROM photos WHERE album_id = ? ORDER BY sort, id', row.id) : [];
  const isPending = status === 'pending';
  const recordSource = t.table === 'records' ? String(row?.file ?? '') : '';
  const recordKey = uploadedRecordKey(recordSource);
  const readyFile = recordKey && await c.env.MEDIA.head(recordKey) ? recordSource : undefined;
  return page(c, title, t.key, (
    <>
      <div class="title-row">
        <h1>{title}</h1>
        {t.status && !isNew && <StatusPill status={status} />}
        {!isNew && t.publicUrl && (!t.status || status === 'published') && <a class="btn ghost" href={t.publicUrl(row as Row)} target="_blank">Skoða á vef</a>}
      </div>
      {row?.review_note && status === 'rejected' && <div class="flash err">Athugasemd frá HSK: {String(row.review_note)}</div>}
      {isPending && user.role === 'admin' && (
        <section class="panel attention">
          <h2>Bíður samþykktar</h2>
          <p>Farðu yfir efnið, lagaðu ef þarf og vistaðu, og samþykktu svo eða hafnaðu.</p>
          <div class="approve-row">
            <form method="post" action={`/stjorn/${t.key}/${row!.id}/samthykkja`}><button class="btn">Samþykkja og birta</button></form>
            <form method="post" action={`/stjorn/${t.key}/${row!.id}/hafna`} class="reject-form">
              <input name="note" placeholder="Ástæða (send til sendanda)" aria-label="Ástæða höfnunar" />
              <button class="btn ghost">Hafna</button>
            </form>
          </div>
        </section>
      )}
      <form method="post" action={isNew ? `/stjorn/${t.key}/nytt` : `/stjorn/${t.key}/${row!.id}`} class="edit-form"
        data-record-import={t.table === 'records' ? asset('/js/record-import.js') : undefined} data-record-ready={readyFile}
        enctype={t.table === 'records' ? 'multipart/form-data' : undefined}>
        <div class="form-grid">
          {t.slug && isStaff(user) && !isNew && (
            <div class="field"><label for="f_slug">Slóð</label><input id="f_slug" name="slug" value={String(row?.slug ?? '')} /></div>
          )}
          {visibleFields(t, user).map((f) => <FieldInput f={f} value={row?.[f.name]} options={f.type === 'suggest' && f.suggest ? (opts as Record<string, { id: number; label: string }[]>)[f.suggest] : opts[f.type as 'club' | 'event' | 'album']} />)}
        </div>
        {t.table === 'records' && <><input type="hidden" name="record_sheets" /><p role="status" data-record-status hidden></p></>}
        <div class="form-actions">
          {isStaff(user) ? (
            t.status ? (
              <>
                <button class="btn" name="status" value="published">{status === 'published' ? 'Vista' : 'Birta'}</button>
                <button class="btn ghost" name="status" value="draft">{status === 'published' ? 'Taka úr birtingu' : 'Vista sem drög'}</button>
              </>
            ) : <button class="btn">Vista</button>
          ) : t.clubOwnRecord ? <button class="btn">Vista</button> : (
            <>
              <button class="btn" name="status" value="pending">Senda til samþykktar</button>
              <button class="btn ghost" name="status" value="draft">Vista sem drög</button>
            </>
          )}
          {!isNew && isStaff(user) && <a class="btn ghost" href={`/stjorn/saga/${t.table}/${row!.id}`}>Breytingasaga</a>}
        </div>
      </form>
      {t.table === 'albums' && row?.id && (
        <section class="panel">
          <h2>Myndir í albúminu ({photos.length})</h2>
          <div class="upload-drop" data-album={String(row.id)}>
            <p><strong>Dragðu myndir hingað</strong> eða <label class="linklike">veldu myndir<input type="file" accept="image/*" multiple hidden /></label>. Hægt er að velja margar í einu. Myndir eru minnkaðar sjálfkrafa.</p>
            <progress hidden max="100" value="0"></progress>
          </div>
          {photos.length > 0 && (
            <form method="post" action={`/stjorn/myndasofn/${row.id}/myndir`}>
              <div class="photo-grid">
                {photos.map((p, i) => (
                  <figure>
                    <img src={p.src} alt="" loading="lazy" />
                    <input type="hidden" name="id" value={String(p.id)} />
                    <input name={`caption_${p.id}`} value={p.caption} placeholder="Myndatexti" aria-label="Myndatexti" />
                    <div class="photo-tools">
                      <input name={`sort_${p.id}`} type="number" value={String(p.sort || (i + 1) * 10)} aria-label="Röð" title="Röð" />
                      <label class="check small"><input type="checkbox" name={`delete_${p.id}`} value="1" /> Eyða</label>
                    </div>
                  </figure>
                ))}
              </div>
              <div class="form-actions"><button class="btn">Vista myndatexta og röð</button></div>
            </form>
          )}
        </section>
      )}
      {!isNew && isStaff(user) && (
        <form method="post" action={`/stjorn/${t.key}/${row!.id}/eyda`} class="danger-zone" data-confirm={`Eyða þessu (${t.singular})? Afrit geymist í breytingasögu.`}>
          <button class="btn danger small">Eyða</button>
        </form>
      )}
    </>
  ), { error });
}

app.get('/:type/nytt', async (c) => {
  const t = getType(c.req.param('type'));
  if (!t) return c.notFound();
  const user = c.get('user')!;
  if (!canEdit(t, user, null) || (t.clubOwnRecord && !isStaff(user))) return c.text('Þú hefur ekki aðgang að þessu.', 403);
  const defaults: Partial<Row> = {};
  for (const f of t.fields) if (f.type === 'select' && f.options) defaults[f.name] = Object.keys(f.options)[0];
  if (t.dateField === 'date') defaults.date = new Date().toISOString().slice(0, 10);
  return editForm(c, t, defaults);
});

app.get('/:type/:id{[0-9]+}', async (c) => {
  const t = getType(c.req.param('type'));
  if (!t) return c.notFound();
  const row = await one<Row>(c.env.DB, `SELECT * FROM ${t.table} WHERE id = ?`, c.req.param('id'));
  const user = c.get('user')!;
  if (!row) return t.clubOwnRecord && !isStaff(user) ? c.text('Aðgangurinn þinn er ekki tengdur við félag. Hafðu samband við HSK.', 404) : c.notFound();
  if (!canEdit(t, user, row)) {
    if (!isStaff(user) && row.club_id === user.club_id) return editFormReadOnly(c, t, row);
    return c.text('Þú hefur ekki aðgang að þessu.', 403);
  }
  return editForm(c, t, row);
});

async function editFormReadOnly(c: Context<AppEnv>, t: ContentType, row: Row) {
  return page(c, String(row[t.titleField]), t.key, (
    <>
      <div class="title-row"><h1>{String(row[t.titleField])}</h1><StatusPill status={String(row.status)} /></div>
      <p>Þetta efni hefur verið birt. Hafðu samband við skrifstofu HSK ef breyta þarf því.</p>
      {t.publicUrl && <p><a class="btn" href={t.publicUrl(row)} target="_blank">Skoða á vef</a></p>}
    </>
  ));
}

function readFields(t: ContentType, user: User, f: FormData): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of visibleFields(t, user)) {
    const raw = f.get(field.name);
    const v = raw === null ? '' : String(raw).trim();
    switch (field.type) {
      case 'richtext': data[field.name] = sanitizeHtml(v); break;
      case 'number': data[field.name] = v === '' ? 0 : parseInt(v, 10) || 0; break;
      case 'club': case 'event': case 'album': data[field.name] = v ? parseInt(v, 10) : null; break;
      case 'datetime': data[field.name] = v ? (v.length === 10 ? v : v.replace('T', ' ').slice(0, 16) + ':00') : null; break;
      case 'date': data[field.name] = v ? v.slice(0, 10) : null; break;
      case 'select': data[field.name] = field.options && v in field.options ? v : Object.keys(field.options ?? { '': '' })[0]; break;
      case 'multiselect': data[field.name] = f.getAll(field.name).map((x) => String(x).trim()).filter(Boolean).join(', '); break;
      case 'url': data[field.name] = v && !/^(https?:|mailto:|\/)/.test(v) ? 'https://' + v : v; break;
      default: data[field.name] = v;
    }
  }
  return data;
}

async function saveRecordWorkbook(c: Context<AppEnv>, source: string, form: FormData) {
  const key = uploadedRecordKey(source);
  if (!key || await c.env.MEDIA.head(key)) return '';
  const original = await c.env.MEDIA.head(source.slice('/media/'.length));
  if (!original) return 'Excel-skráin fannst ekki. Hladdu henni upp aftur í reitnum Metaskrá.';
  if (original.size > MAX_RECORD_FILE) return 'Metaskrá má vera að hámarki 5 MB.';
  const json = form.get('record_sheets');
  const sheets = typeof json === 'string' ? validateRecordSheets(json) : null;
  if (!sheets) return 'Ekki tókst að útbúa vef­töflu úr skránni. Prófaðu að velja .xlsx-skrána aftur.';
  // Skráin er tilbúin áður en færslan vísar á hana. Upphleðsluslóðir eru einstakar.
  await c.env.MEDIA.put(key, JSON.stringify(sheets), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
  return '';
}

async function saveItem(c: Context<AppEnv>, t: ContentType, id: number | null) {
  const db = c.env.DB;
  const user = c.get('user')!;
  const existing = id ? await one<Row>(db, `SELECT * FROM ${t.table} WHERE id = ?`, id) : null;
  if (id && !existing) return c.notFound();
  if (!canEdit(t, user, existing) || (!id && t.clubOwnRecord && !isStaff(user))) return c.text('Þú hefur ekki aðgang að þessu.', 403);
  const f = await c.req.formData();
  const data = readFields(t, user, f);
  const missing = t.fields.filter((x) => x.required && visibleFields(t, user).includes(x) && !data[x.name]);
  if (missing.length) return editForm(c, t, { ...existing, ...data }, `Fylla þarf út: ${missing.map((m) => m.label).join(', ')}`);
  if (data.ends_at && data.starts_at && String(data.ends_at) < String(data.starts_at)) {
    return editForm(c, t, { ...existing, ...data }, 'Lokatími getur ekki verið á undan upphafstíma.');
  }
  if (t.table === 'records') {
    const error = await saveRecordWorkbook(c, String(data.file ?? ''), f);
    if (error) return editForm(c, t, { ...existing, ...data }, error);
  }

  let action = id ? 'update' : 'create';
  if (t.status) {
    const wanted = String(f.get('status') || 'draft');
    if (isStaff(user)) {
      data.status = wanted === 'published' ? 'published' : 'draft';
      if (existing?.status === 'pending' && wanted === 'published' && user.role !== 'admin') data.status = 'pending';
    } else {
      data.status = wanted === 'pending' ? 'pending' : 'draft';
      data.club_id = user.club_id;
      if (data.status === 'pending') action = 'submit';
    }
    if (t.table === 'news' && data.status === 'published' && !data.published_at) data.published_at = existing?.published_at || nowIso();
    if (t.table === 'news' && !isStaff(user)) data.kind = existing?.kind ?? 'frett';
  }
  if (t.slug) {
    const wantSlug = isStaff(user) && f.get('slug') ? String(f.get('slug')) : existing?.slug ? String(existing.slug) : String(data[t.titleField]);
    data.slug = await uniqueSlug(db, t.table, wantSlug, id ?? undefined);
  }
  const cols = Object.keys(data);
  const hasUpdated = ['news', 'events', 'results', 'records', 'clubs', 'committees', 'documents', 'sponsors', 'albums'].includes(t.table);
  if (id) {
    await run(db, `UPDATE ${t.table} SET ${cols.map((k) => `${k} = ?`).join(', ')}${hasUpdated ? ", updated_at = datetime('now')" : ''} WHERE id = ?`, ...cols.map((k) => data[k] as never), id);
  } else {
    const extra = t.clubSubmit ? { created_by: user.id } : {};
    const all = { ...data, ...extra };
    const keys = Object.keys(all);
    const r = await run(db, `INSERT INTO ${t.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...keys.map((k) => all[k as keyof typeof all] as never));
    id = Number(r.meta.last_row_id);
  }
  await logRevision(db, t.table, id, user.id, action, data);
  if (action === 'submit') {
    const club = await one<{ name: string }>(db, 'SELECT name FROM clubs WHERE id = ?', user.club_id ?? 0);
    await notifyAdmins(c.env, `Nýtt efni bíður samþykktar: ${data[t.titleField]}`,
      `${user.name || user.email} (${club?.name ?? 'aðildarfélag'}) sendi inn ${t.singular}:\n\n${data[t.titleField]}\n\nFarðu yfir það hér: ${c.env.SITE_URL}/stjorn/${t.key}/${id}`);
  }
  const msg = action === 'submit' ? 'sent' : data.status === 'published' ? 'birt' : 'vistad';
  return c.redirect(`/stjorn/${t.key}/${id}?m=${msg}`);
}

app.post('/:type/nytt', async (c) => {
  const t = getType(c.req.param('type'));
  return t ? saveItem(c, t, null) : c.notFound();
});
app.post('/:type/:id{[0-9]+}', async (c) => {
  const t = getType(c.req.param('type'));
  return t ? saveItem(c, t, parseInt(c.req.param('id'), 10)) : c.notFound();
});

app.post('/:type/:id{[0-9]+}/eyda', async (c) => {
  const t = getType(c.req.param('type'));
  if (!t) return c.notFound();
  const deny = staffOnly(c); if (deny) return deny;
  const id = parseInt(c.req.param('id'), 10);
  const row = await one<Row>(c.env.DB, `SELECT * FROM ${t.table} WHERE id = ?`, id);
  if (!row) return c.notFound();
  await logRevision(c.env.DB, t.table, id, c.get('user')!.id, 'delete', row);
  await run(c.env.DB, `DELETE FROM ${t.table} WHERE id = ?`, id);
  return c.redirect(`/stjorn/${t.key}?m=eytt`);
});

async function review(c: Context<AppEnv>, approve: boolean) {
  const t = getType(c.req.param('type') ?? '');
  if (!t || !t.clubSubmit) return c.notFound();
  const deny = adminOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const id = parseInt(c.req.param('id') ?? '0', 10);
  const row = await one<Row>(db, `SELECT t.*, u.email AS submitter FROM ${t.table} t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ?`, id);
  if (!row) return c.notFound();
  const note = approve ? '' : String((await c.req.formData()).get('note') || '').trim();
  if (approve) {
    await run(db, `UPDATE ${t.table} SET status = 'published', review_note = ''${t.table === 'news' ? ", published_at = coalesce(published_at, datetime('now'))" : ''} WHERE id = ?`, id);
  } else {
    await run(db, `UPDATE ${t.table} SET status = 'rejected', review_note = ? WHERE id = ?`, note, id);
  }
  await logRevision(db, t.table, id, c.get('user')!.id, approve ? 'approve' : 'reject', { title: row[t.titleField], note });
  if (row.submitter) {
    await sendMail(c.env, String(row.submitter), approve ? `Birt á vef HSK: ${row[t.titleField]}` : `Ekki birt á vef HSK: ${row[t.titleField]}`,
      approve
        ? `Efnið sem þú sendir inn hefur verið samþykkt og birt:\n\n${row[t.titleField]}\n${c.env.SITE_URL}${t.publicUrl?.(row) ?? ''}`
        : `Efnið sem þú sendir inn var ekki birt:\n\n${row[t.titleField]}\n\nAthugasemd: ${note || '(engin)'}\n\nÞú getur lagað það og sent aftur: ${c.env.SITE_URL}/stjorn/${t.key}/${id}`);
  }
  return c.redirect(`/stjorn/${t.key}/${id}?m=${approve ? 'samthykkt' : 'hafnad'}`);
}
app.post('/:type/:id{[0-9]+}/samthykkja', (c) => review(c, true));
app.post('/:type/:id{[0-9]+}/hafna', (c) => review(c, false));

// ---------- Myndir í albúmum ----------

app.post('/myndasofn/:id{[0-9]+}/baeta', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const id = parseInt(c.req.param('id'), 10);
  const { src, caption } = await c.req.json<{ src: string; caption?: string }>();
  if (!src || !src.startsWith('/media/')) return c.json({ error: 'Ógild slóð' }, 400);
  const max = await one<{ s: number }>(c.env.DB, 'SELECT coalesce(max(sort), 0) + 10 AS s FROM photos WHERE album_id = ?', id);
  await run(c.env.DB, 'INSERT INTO photos (album_id, src, caption, sort) VALUES (?, ?, ?, ?)', id, src, caption ?? '', max?.s ?? 10);
  await run(c.env.DB, "UPDATE albums SET cover = ? WHERE id = ? AND cover = ''", src, id);
  return c.json({ ok: true });
});

app.post('/myndasofn/:id{[0-9]+}/myndir', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const albumId = parseInt(c.req.param('id'), 10);
  const f = await c.req.formData();
  const stmts: D1PreparedStatement[] = [];
  const deleted: string[] = [];
  for (const raw of f.getAll('id')) {
    const pid = parseInt(String(raw), 10);
    if (f.get(`delete_${pid}`)) {
      const ph = await one<{ src: string }>(db, 'SELECT src FROM photos WHERE id = ? AND album_id = ?', pid, albumId);
      if (ph) deleted.push(ph.src);
      stmts.push(db.prepare('DELETE FROM photos WHERE id = ? AND album_id = ?').bind(pid, albumId));
    }
    else stmts.push(db.prepare('UPDATE photos SET caption = ?, sort = ? WHERE id = ? AND album_id = ?').bind(String(f.get(`caption_${pid}`) || ''), parseInt(String(f.get(`sort_${pid}`) || '0'), 10) || 0, pid, albumId));
  }
  if (stmts.length) await db.batch(stmts);
  // Ef forsíðumynd var eytt er fyrsta mynd notuð
  const album = await one<{ cover: string }>(db, 'SELECT cover FROM albums WHERE id = ?', albumId);
  if (album && deleted.includes(album.cover)) {
    await run(db, "UPDATE albums SET cover = coalesce((SELECT src FROM photos WHERE album_id = ? ORDER BY sort, id LIMIT 1), '') WHERE id = ?", albumId, albumId);
  }
  return c.redirect(`/stjorn/myndasofn/${albumId}?m=myndir`);
});

export default app;
