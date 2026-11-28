import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Child } from 'hono/jsx';
import {
  type AppEnv, type User, all, one, run, sanitizeHtml, uniqueSlug, slugify, logRevision, getSetting, setSetting,
  dateLong, dateTime, nowIso, plainText, fmtNum,
} from '../lib';
import {
  loadUser, requireUser, VIEW_COOKIE, resolveLoginUser, createLoginToken, consumeLoginToken, startSession, endSession, can,
  googleEnabled, googleAuthUrl, googleEmailFromCode, randomId, passwordLogin, hashPassword, verifyPassword,
} from '../auth';
import { sendMail, notifyAdmins } from '../mail';
import { type GrantField, type GrantFieldType, GRANT_FIELD_TYPES, GRANT_CORE, DEFAULT_GRANT_FORM, grantForm } from '../grant';
import { archivedRecords } from '../record-catalogue-data';
import { catalogueRows } from '../record-rows';
import { currentRecords } from '../record-catalogue';
import { RECORD_CATEGORIES } from '../content-types';
import { RecordCatalogue } from '../views/record-catalogue';
import { DEFAULT_TILES } from '../lib';
import { contentTypes, getType, STATUS_LABELS, type ContentType, type Field } from '../content-types';
import { AdminLayout, FieldInput, StatusPill } from '../views/admin';
import { Icon } from '../views/icons';
import { MAX_RECORD_FILE, uploadedRecordKey, validateRecordSheets } from '../record-books';
import { asset } from '../static';
import { samskiptiRoutes } from './samskipti';

const app = new Hono<AppEnv>();
type Row = Record<string, unknown> & { id: number };

const MESSAGES: Record<string, string> = {
  vistad: 'Vistað.', birt: 'Birt á vefnum.', eytt: 'Eytt.', sent: 'Sent til samþykktar. Starfsfólk HSK fær tilkynningu.',
  samthykkt: 'Samþykkt og birt.', hafnad: 'Hafnað. Sendandi fær athugasemdina.', endurheimt: 'Eldri útgáfa endurheimt.',
  bodid: 'Boð sent.', myndir: 'Myndir uppfærðar.',
  'bodid-ekki': 'Notandinn var stofnaður en ekki tókst að senda boðspóst. Hann getur samt skráð sig inn á /stjorn með netfanginu sínu.',
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
  // Sýn: aðeins raunverulegur stjórnandi fær valið
  const realUser = c.get('realUser') ?? null;
  let viewAs: { current: string; label: string; clubs: { id: number; name: string }[] } | undefined;
  if (realUser || user?.role === 'admin') {
    const clubs = await all<{ id: number; name: string }>(c.env.DB, 'SELECT id, name FROM clubs ORDER BY name');
    const current = !realUser ? '' : user!.role === 'club' ? `club:${user!.club_id}` : 'editor';
    const label = !realUser ? '' : user!.role === 'club' ? `félagsaðgangur – ${clubs.find((cl) => cl.id === user!.club_id)?.name ?? 'óþekkt félag'}` : 'ritstjóri';
    viewAs = { current, label, clubs };
  }
  const flash = MESSAGES[c.req.query('m') || ''];
  c.header('Cache-Control', 'no-store');
  return c.html('<!doctype html>' + (
    <AdminLayout title={title} user={user} active={active} flash={flash} error={opts.error} pending={pending} applications={applications} viewAs={viewAs}>{body}</AdminLayout>
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

// Samskipti: fjöldapóstur (útsendingar, tengiliðir, niðurstöður)
app.route('/samskipti', samskiptiRoutes(page));

// „Sýn“: stjórnandi skoðar vefumsjónina sem ritstjóri eða félagsaðgangur tiltekins félags
app.post('/syn', async (c) => {
  const real = c.get('realUser') ?? c.get('user')!;
  if (real.role !== 'admin') return c.text('Þú hefur ekki aðgang að þessu.', 403);
  const v = String((await c.req.formData()).get('syn') ?? '');
  const club = v.match(/^club:(\d+)$/);
  if (v === 'editor' || (club && await one(c.env.DB, 'SELECT id FROM clubs WHERE id = ?', Number(club[1])))) {
    setCookie(c, VIEW_COOKIE, v, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 8, secure: c.env.SITE_URL.startsWith('https') });
  } else deleteCookie(c, VIEW_COOKIE, { path: '/' });
  return c.redirect('/stjorn');
});

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

// Hvar skrá er notuð á vefnum: skrá sem er í notkun er ekki eytt svo myndir og tenglar brotni ekki
const MEDIA_USES: [string, string, string, string[]][] = [
  ['Síða', 'pages', 'title', ['body']],
  ['Frétt', 'news', 'title', ['body', 'image']],
  ['Mót/viðburður', 'events', 'title', ['description', 'image', 'attachment']],
  ['Úrslit', 'results', 'title', ['body', 'attachment']],
  ['Metaskrá', 'records', 'title', ['body', 'file']],
  ['Aðildarfélag', 'clubs', 'name', ['logo', 'description']],
  ['Stjórn/nefnd', 'committees', 'name', ['body']],
  ['Skjal', 'documents', 'title', ['body', 'file']],
  ['Styrktaraðili', 'sponsors', 'name', ['logo']],
  ['Myndasafn', 'albums', 'title', ['description', 'cover']],
  ['Héraðsþing', 'assembly_docs', 'title', ['file']],
  ['Stilling', 'settings', 'key', ['value']],
];
async function mediaUses(db: D1Database, key: string): Promise<string[]> {
  const url = '/media/' + key;
  const out: string[] = [];
  for (const [label, table, name, cols] of MEDIA_USES) {
    const hits = await all<{ n: string }>(db, `SELECT ${name} AS n FROM ${table} WHERE ${cols.map((col) => `instr(${col}, ?) > 0`).join(' OR ')} LIMIT 3`, ...cols.map(() => url));
    for (const h of hits) out.push(`${label} „${h.n}“`);
  }
  const photos = await all<{ n: string }>(db, 'SELECT a.title AS n FROM photos p JOIN albums a ON a.id = p.album_id WHERE instr(p.src, ?) > 0 LIMIT 3', url);
  for (const h of photos) out.push(`Myndasafn „${h.n}“`);
  return out;
}

// Eyða skrám: ein eða fleiri í einu. Félagsaðgangur getur aðeins eytt eigin skrám.
app.post('/skrar/eyda', async (c) => {
  const user = c.get('user')!;
  const f = await c.req.formData();
  const keys = [...new Set((f.getAll('key').length ? f.getAll('key') : f.getAll('keys')).map(String))].slice(0, 200);
  let deleted = 0;
  const kept: string[] = [];
  for (const key of keys) {
    const m = await one<{ id: number; uploaded_by: number | null }>(c.env.DB, 'SELECT id, uploaded_by FROM media WHERE key = ?', key);
    if (!m || (!isStaff(user) && m.uploaded_by !== user.id)) continue;
    if ((await mediaUses(c.env.DB, key)).length) { kept.push(key); continue; }
    await c.env.MEDIA.delete(key);
    await run(c.env.DB, 'DELETE FROM media WHERE id = ?', m.id);
    deleted++;
  }
  const back = new URLSearchParams(String(f.get('back') || ''));
  back.set('eytt', String(deleted));
  back.delete('notad');
  for (const k of kept.slice(0, 10)) back.append('notad', k);
  if (kept.length > 10) back.set('fleiri', String(kept.length - 10));
  return c.redirect('/stjorn/skrar?' + back);
});

app.get('/skrar', async (c) => {
  const user = c.get('user')!;
  const q = (c.req.query('q') || '').trim();
  const kind = c.req.query('tegund') || '';
  const source = c.req.query('uppruni') || '';
  const pageNo = Math.max(1, parseInt(c.req.query('s') || '1', 10) || 1);
  const PER = 120;
  const where = ['filename LIKE ?'];
  const params: unknown[] = [`%${q}%`];
  if (!isStaff(user)) { where.push('uploaded_by = ?'); params.push(user.id); }
  if (kind === 'myndir') where.push("content_type LIKE 'image/%'");
  if (kind === 'skjol') where.push("content_type NOT LIKE 'image/%'");
  // Skrár af gamla vefnum eru geymdar undir old/
  if (source === 'gamli') where.push("key LIKE 'old/%'");
  if (source === 'nyjar') where.push("key NOT LIKE 'old/%'");
  const w = where.join(' AND ');
  const total = (await one<{ n: number }>(c.env.DB, `SELECT count(*) AS n FROM media WHERE ${w}`, ...params))?.n ?? 0;
  const rows = await all<{ key: string; filename: string; content_type: string; size: number; created_at: string }>(c.env.DB,
    `SELECT key, filename, content_type, size, created_at FROM media WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, PER, (pageNo - 1) * PER);
  const qs = (extra: Record<string, string>) => '?' + new URLSearchParams(Object.entries({ q, tegund: kind, uppruni: source, ...extra }).filter(([, v]) => v));
  const pages = Math.max(1, Math.ceil(total / PER));
  // Niðurstaða eyðingar: fjöldi eyddra og skrár sem voru ekki eyddar af því þær eru í notkun
  const deletedN = c.req.query('eytt');
  const keptKeys = c.req.queries('notad') ?? [];
  const kept = await Promise.all(keptKeys.map(async (k) => ({
    name: (await one<{ filename: string }>(c.env.DB, 'SELECT filename FROM media WHERE key = ?', k))?.filename ?? k,
    uses: await mediaUses(c.env.DB, k),
  })));
  const more = Number(c.req.query('fleiri') || 0);
  const backQs = new URLSearchParams(Object.entries({ q, tegund: kind, uppruni: source, s: pageNo > 1 ? String(pageNo) : '' }).filter(([, v]) => v)).toString();
  return page(c, 'Myndir og skjöl', 'skrar', (
    <>
      <h1>Myndir og skjöl</h1>
      {deletedN !== undefined && (
        <div class={kept.length ? 'flash err' : 'flash ok'} role="status">
          {Number(deletedN) === 1 ? '1 skrá eytt.' : `${fmtNum(Number(deletedN))} skrám eytt.`}
          {kept.length > 0 && <>
            {' '}{kept.length + more === 1 ? 'Einni skrá var ekki eytt' : `${kept.length + more} skrám var ekki eytt`} af því að {kept.length + more === 1 ? 'hún er' : 'þær eru'} notuð á vefnum. Fjarlægðu þær þaðan fyrst:
            <ul class="kept-list">{kept.map((k) => <li><strong>{k.name}</strong>: {k.uses.join(', ')}</li>)}</ul>
            {more > 0 && <p>…og {more} í viðbót.</p>}
          </>}
        </div>
      )}
      <div class="upload-drop" data-library>
        <p><strong>Dragðu skrár hingað</strong> eða <label class="linklike">veldu skrár<input type="file" multiple hidden /></label>. Myndir eru minnkaðar sjálfkrafa.</p>
        <progress hidden max="100" value="0"></progress>
      </div>
      <form method="get" class="toolbar filter-bar">
        <div class="fb-field"><label for="sk-q">Leit</label><input id="sk-q" name="q" type="search" value={q} placeholder="Leita að skráarheiti…" /></div>
        <div class="fb-field"><label for="sk-t">Tegund</label><select id="sk-t" name="tegund" data-autosubmit>
          <option value="">Allt</option><option value="myndir" selected={kind === 'myndir'}>Myndir</option><option value="skjol" selected={kind === 'skjol'}>Skjöl</option>
        </select></div>
        <div class="fb-field"><label for="sk-u">Uppruni</label><select id="sk-u" name="uppruni" data-autosubmit>
          <option value="">Allt</option><option value="nyjar" selected={source === 'nyjar'}>Hlaðið upp á nýja vefnum</option><option value="gamli" selected={source === 'gamli'}>Af gamla vefnum</option>
        </select></div>
        <button class="btn small">Leita</button>
      </form>
      <p class="muted">{fmtNum(total)} {total === 1 ? 'skrá' : 'skrár'}{pages > 1 && ` · síða ${pageNo} af ${pages}`}</p>
      <form method="post" action="/stjorn/skrar/eyda" id="media-form" data-media-delete>
        <input type="hidden" name="back" value={backQs} />
        <div class="media-select-bar" hidden>
          <span data-selected-count>0 valdar</span>
          <button type="button" class="btn small ghost" data-select-none>Afvelja</button>
          <button class="btn small danger" name="bulk" value="1">Eyða völdum</button>
        </div>
        <div class="media-grid">
          {rows.map((m) => (
            <figure>
              <label class="media-check" title="Velja"><input type="checkbox" name="keys" value={m.key} aria-label={`Velja ${m.filename}`} /></label>
              {m.content_type.startsWith('image/') ? <a href={'/media/' + m.key} target="_blank"><img src={'/media/' + m.key} alt="" loading="lazy" /></a> : <a class="file-icon" href={'/media/' + m.key} target="_blank">{m.filename.split('.').pop()?.toUpperCase()}</a>}
              <figcaption>
                <span title={m.filename}>{m.filename}</span>
                <div class="media-actions">
                  <button type="button" class="btn small ghost" data-copy={'/media/' + m.key}>Afrita slóð</button>
                  <button class="btn small ghost danger" name="key" value={m.key} data-name={m.filename}>Eyða</button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </form>
      {pages > 1 && (
        <nav class="pager-admin">
          {pageNo > 1 ? <a class="btn small ghost" href={qs({ s: String(pageNo - 1) })}>Fyrri síða</a> : <span></span>}
          <span class="muted">Síða {pageNo} af {pages}</span>
          {pageNo < pages ? <a class="btn small ghost" href={qs({ s: String(pageNo + 1) })}>Næsta síða</a> : <span></span>}
        </nav>
      )}
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
          <a class="btn ghost cancel" href="/stjorn/sidur" data-back>Hætta við</a>
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
  const tilesRaw = await s('home_tiles', DEFAULT_TILES);
  // Síður sem hægt er að velja fyrir flýtireiti (birtar síður, efstu tvö stigin)
  const tilePages = await all<{ path: string; title: string }>(db, "SELECT path, title FROM pages WHERE status = 'published' AND (parent_id IS NULL OR parent_id IN (SELECT id FROM pages WHERE parent_id IS NULL)) ORDER BY path");
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
          <div class="field wide"><label>Flýtireitir neðst á forsíðu</label>
            <small class="help">Hver reitur er hnappur sem vísar á síðu. Fylltu út fyrirsögn, stuttan texta og veldu síðuna sem reiturinn opnar. Tómar línur eru ekki sýndar. Mest 6 reitir; 3 passa í eina röð.</small>
            <table class="tiles-edit">
              <thead><tr><th>Fyrirsögn</th><th>Stuttur texti</th><th>Opnar síðu</th></tr></thead>
              <tbody>{(() => {
                const rows = (tilesRaw).split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((l) => l[0]);
                while (rows.length < 6) rows.push(['', '', '']);
                return rows.slice(0, 6).map(([t, txt, url], i) => (
                  <tr>
                    <td><input name="tile_title" value={t ?? ''} aria-label={`Fyrirsögn reits ${i + 1}`} placeholder={i === 0 ? 'T.d. Styrkir og sjóðir' : ''} /></td>
                    <td><input name="tile_text" value={txt ?? ''} aria-label={`Texti reits ${i + 1}`} placeholder={i === 0 ? 'T.d. Verkefnasjóður HSK og umsóknir' : ''} /></td>
                    <td><input name="tile_url" value={url ?? ''} list="tile-pages" aria-label={`Síða reits ${i + 1}`} placeholder="Veldu síðu eða skrifaðu slóð" /></td>
                  </tr>
                ));
              })()}</tbody>
            </table>
            <datalist id="tile-pages">{tilePages.map((p) => <option value={'/' + p.path}>{p.title}</option>)}</datalist>
          </div>
          <div class="field"><label for="contact_address">Heimilisfang</label><input id="contact_address" name="contact_address" value={await s('contact_address', 'Selinu, Engjavegi 48, 800 Selfossi')} /></div>
          <div class="field"><label for="contact_phone">Sími</label><input id="contact_phone" name="contact_phone" value={await s('contact_phone', '482 1189')} /></div>
          <div class="field"><label for="contact_email">Netfang</label><input id="contact_email" name="contact_email" type="email" value={await s('contact_email', 'hsk@hsk.is')} /></div>
          <div class="field wide"><h3 style="margin: 12px 0 0">Samfélagsmiðlar</h3><small class="help">Slóðir á miðla HSK. Röð með tenglum birtist neðst á öllum síðum, fyrir ofan fótinn, um leið og a.m.k. ein slóð er skráð.</small></div>
          <div class="field"><label for="social_facebook">Facebook</label><input id="social_facebook" name="social_facebook" type="url" placeholder="https://www.facebook.com/…" value={await s('social_facebook')} /></div>
          <div class="field"><label for="social_instagram">Instagram</label><input id="social_instagram" name="social_instagram" type="url" placeholder="https://www.instagram.com/…" value={await s('social_instagram')} /></div>
          <div class="field"><label for="social_tiktok">TikTok</label><input id="social_tiktok" name="social_tiktok" type="url" placeholder="https://www.tiktok.com/@…" value={await s('social_tiktok')} /></div>
          <div class="field"><label for="social_youtube">YouTube</label><input id="social_youtube" name="social_youtube" type="url" placeholder="https://www.youtube.com/@…" value={await s('social_youtube')} /></div>
        </div>
        <div class="form-actions"><button class="btn">Vista</button><a class="btn ghost cancel" href="/stjorn" data-back>Hætta við</a></div>
      </form>
    </>
  ));
});

app.post('/stillingar', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  // Flýtireitir: ein lína á reit, „Fyrirsögn | texti | slóð“
  const tt = f.getAll('tile_title').map(String), tx = f.getAll('tile_text').map(String), tu = f.getAll('tile_url').map(String);
  if (tt.length) {
    const clean = (v: string) => v.replace(/\|/g, '/').trim();
    await setSetting(c.env.DB, 'home_tiles', tt.map((t, i) => [clean(t), clean(tx[i] ?? ''), clean(tu[i] ?? '')]).filter(([t, , u]) => t && u).map((r) => r.join(' | ')).join('\n'));
  }
  for (const k of ['hero_title', 'hero_text', 'hero_image', 'hero_link', 'hero_button', 'contact_address', 'contact_phone', 'contact_email', 'social_facebook', 'social_instagram', 'social_tiktok', 'social_youtube']) await setSetting(c.env.DB, k, String(f.get(k) ?? '').trim());
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
        <div class="form-actions"><button class="btn">Vista</button>{!isNew && <a class="btn ghost" href={`/um-hsk/heradsthing#${a.slug}`} target="_blank">Skoða á vef</a>}<a class="btn ghost cancel" href="/stjorn/heradsthing" data-back>Hætta við</a></div>
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

type AppRow = {
  id: number; kind: string; title: string; data: string; files: string; status: string; note: string; created_at: string;
  decision: string; award_recipient: string; award_project: string; award_amount: number; award_year: number | null; award_round: string;
  award_published: number; decided_at: string | null;
};
const GRANT_ROUNDS: Record<string, string> = { fyrri: 'Fyrri úthlutun', seinni: 'Seinni úthlutun', serstok: 'Sérstök úthlutun', arleg: 'Árleg úthlutun' };
const DECISION_TABS: [string, string][] = [['', 'Óafgreiddar'], ['samthykkt', 'Samþykktar'], ['hafnad', 'Hafnaðar'], ['allar', 'Allar']];
const DecisionPill = ({ d }: { d: string }) => d === 'samthykkt' ? <span class="pill published">Samþykkt</span>
  : d === 'hafnad' ? <span class="pill rejected">Hafnað</span> : <span class="pill pending">Óafgreidd</span>;

app.get('/umsoknir', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const tab = c.req.query('flipi') ?? '';
  const where = tab === 'allar' ? '1 = 1' : 'decision = ?';
  const rows = await all<AppRow>(db, `SELECT * FROM applications WHERE ${where} ORDER BY created_at DESC LIMIT 500`, ...(tab === 'allar' ? [] : [tab]));
  const counts = Object.fromEntries((await all<{ decision: string; n: number }>(db, 'SELECT decision, count(*) AS n FROM applications GROUP BY decision')).map((r) => [r.decision, r.n]));
  const open = (await getSetting(db, 'grant_open', '1')) === '1';
  const closedText = await getSetting(db, 'grant_closed_text', '');
  const msg = c.req.query('m');
  return page(c, 'Umsóknir', 'umsoknir', (
    <>
      <h1>Umsóknir í Verkefnasjóð</h1>
      {msg && <div class="flash ok" role="status">{msg}</div>}
      <section class={open ? 'panel' : 'panel attention'}>
        <h2>Móttaka umsókna: {open ? 'opin' : 'lokuð'}</h2>
        <form method="post" action="/stjorn/umsoknir/mottaka" class="grant-open-form">
          <label class="check"><input type="radio" name="open" value="1" checked={open} /> <strong>Opið fyrir umsóknir.</strong> Umsóknaformið birtist á síðunni Verkefnasjóður.</label>
          <label class="check"><input type="radio" name="open" value="0" checked={!open} /> <strong>Lokað fyrir umsóknir.</strong> Í stað formsins birtast skilaboðin hér fyrir neðan.</label>
          <div class="field wide"><label for="closed_text">Skilaboð þegar lokað er</label>
            <textarea id="closed_text" name="closed_text" rows={2} placeholder="Ekki er tekið við umsóknum í Verkefnasjóð eins og er. Opnað verður fyrir umsóknir fyrir næstu úthlutun og það auglýst hér á vefnum.">{closedText}</textarea></div>
          <div class="form-actions"><button class="btn">Vista</button><a class="btn ghost" href="/stjorn/umsoknir/form">Breyta umsóknarformi</a><a class="btn ghost" href="/um-hsk/verkefnasjodur#umsokn" target="_blank">Skoða á vef</a></div>
        </form>
      </section>
      <nav class="subtabs">{DECISION_TABS.map(([k, l]) => (
        <a href={`/stjorn/umsoknir${k ? '?flipi=' + k : ''}`} class={tab === k ? 'on' : ''}>{l}{k !== 'allar' && ` (${counts[k] ?? 0})`}</a>
      ))}</nav>
      {rows.length === 0 ? <p class="muted">Engar umsóknir hér.</p> : (
        <table class="tbl">
          <thead><tr><th>Umsókn</th><th>Sótt um</th><th>Veitt</th><th>Barst</th><th>Staða</th></tr></thead>
          <tbody>{rows.map((r) => {
            const d = JSON.parse(r.data) as Record<string, string>;
            return (
              <tr>
                <td><a href={`/stjorn/umsoknir/${r.id}`}><strong>{d.felag}</strong></a><div class="muted small">{d.verkefni}</div></td>
                <td>{fmtNum(Number(d.upphaed || 0))} kr.</td>
                <td>{r.decision === 'samthykkt' ? `${fmtNum(r.award_amount)} kr.` : '—'}{r.decision === 'samthykkt' && !r.award_published && <div class="muted small">Ekki birt</div>}</td>
                <td>{dateLong(r.created_at)}</td>
                <td><DecisionPill d={r.decision} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </>
  ));
});

// ---------- Umsóknarform Verkefnasjóðs: reitir stilltir í vefumsjón ----------
app.get('/umsoknir/form', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const fields = await grantForm(c.env.DB);
  const intro = await getSetting(c.env.DB, 'grant_form_intro', '');
  const msg = c.req.query('m');
  const Row = ({ f }: { f: GrantField }) => {
    const core = f.name in GRANT_CORE;
    return (
      <fieldset class="ff-row" data-ff-row>
        <input type="hidden" name="field_name" value={f.name} />
        <div class="ff-main">
          <div class="field"><label>Heiti reits</label><input name="field_label" value={f.label} required /></div>
          <div class="field"><label>Tegund</label>
            {core
              ? <><input type="hidden" name="field_type" value={GRANT_CORE[f.name]} /><select disabled aria-label="Tegund"><option>{GRANT_FIELD_TYPES[GRANT_CORE[f.name]]}</option></select></>
              : <select name="field_type" data-ff-type>{Object.entries(GRANT_FIELD_TYPES).map(([k, l]) => <option value={k} selected={(f.type ?? 'text') === k}>{l}</option>)}</select>}
          </div>
          <div class="field"><label>Skylda</label><select name="field_required"><option value="1" selected={!!f.required}>Já</option><option value="0" selected={!f.required}>Nei</option></select></div>
          <div class="field"><label>Breidd</label><select name="field_half"><option value="0" selected={!f.half}>Heil lína</option><option value="1" selected={!!f.half}>Hálf lína</option></select></div>
          <div class="field wide"><label>Hjálpartexti (valfrjálst)</label><input name="field_help" value={f.help ?? ''} /></div>
          <div class="field wide" data-ff-options hidden={f.type !== 'select'}><label>Valmöguleikar (einn í hverri línu)</label><textarea name="field_options" rows={3}>{(f.options ?? []).join('\n')}</textarea></div>
        </div>
        <div class="ff-tools">
          <button type="button" class="btn small ghost" data-ff-up aria-label="Færa upp">↑</button>
          <button type="button" class="btn small ghost" data-ff-down aria-label="Færa niður">↓</button>
          {core ? <span class="muted small" title="Kerfið notar þennan reit">Fastur reitur</span> : <button type="button" class="btn small ghost danger" data-ff-remove>Eyða</button>}
        </div>
      </fieldset>
    );
  };
  return page(c, 'Umsóknarform', 'umsoknir', (
    <>
      <p><a href="/stjorn/umsoknir">← Umsóknir í Verkefnasjóð</a></p>
      <h1>Umsóknarform Verkefnasjóðs</h1>
      {msg && <div class="flash ok" role="status">{msg}</div>}
      <p class="lead">Reitirnir birtast í þessari röð á síðunni Verkefnasjóður. Breytingar hafa ekki áhrif á umsóknir sem hafa þegar borist. Fastir reitir eru notaðir í kerfinu (heiti umsóknar, upphæð og tölvupóstur til umsækjanda) og þeim er ekki hægt að eyða.</p>
      <form method="post" action="/stjorn/umsoknir/form" class="ff-form">
        <div class="field wide"><label for="intro">Texti fyrir ofan formið</label>
          <input id="intro" name="intro" value={intro} placeholder="Reitir merktir * eru nauðsynlegir. Umsóknin berst skrifstofu HSK." /></div>
        <div class="ff-list" data-ff-list>{fields.map((f) => <Row f={f} />)}</div>
        <template data-ff-template><Row f={{ name: '', label: '', type: 'text' }} /></template>
        <p><button type="button" class="btn ghost" data-ff-add>+ Bæta við reit</button></p>
        <div class="form-actions">
          <button class="btn">Vista form</button>
          <a class="btn ghost" href="/um-hsk/verkefnasjodur#umsokn" target="_blank">Skoða á vef</a>
          <button class="btn ghost" name="reset" value="1" formnovalidate data-confirm-btn="Setja formið aftur í upphaflega útgáfu? Reitir sem þú hefur bætt við hverfa úr forminu.">Endurstilla sjálfgefið form</button>
          <a class="btn ghost cancel" href="/stjorn/umsoknir" data-back>Hætta við</a>
        </div>
      </form>
    </>
  ));
});

app.post('/umsoknir/form', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  await setSetting(c.env.DB, 'grant_form_intro', String(f.get('intro') ?? '').trim().slice(0, 500));
  if (f.get('reset')) {
    await setSetting(c.env.DB, 'grant_form_fields', '');
    return c.redirect('/stjorn/umsoknir/form?m=' + encodeURIComponent('Formið var endurstillt.'));
  }
  const col = (k: string) => f.getAll(k).map(String);
  const names = col('field_name'), labels = col('field_label'), types = col('field_type'), req = col('field_required'),
    half = col('field_half'), help = col('field_help'), opts = col('field_options');
  const used = new Set(['vefsida', 'daemi']);
  const out: GrantField[] = [];
  labels.forEach((label, i) => {
    label = label.trim().slice(0, 200);
    if (!label) return;
    let name = names[i] || slugify(label).replace(/-/g, '_').slice(0, 40) || 'reitur';
    if (!names[i]) { const base = name; let n = 2; while (used.has(name) || name in GRANT_CORE) name = `${base}_${n++}`; }
    if (used.has(name)) return;
    used.add(name);
    const type = (GRANT_CORE[name] ?? (types[i] in GRANT_FIELD_TYPES ? types[i] : 'text')) as GrantFieldType;
    const field: GrantField = { name, label, type, required: req[i] === '1', half: half[i] === '1' };
    if (help[i]?.trim()) field.help = help[i].trim().slice(0, 300);
    if (type === 'select') field.options = (opts[i] ?? '').split(/\r?\n/).map((o) => o.trim()).filter(Boolean).slice(0, 50);
    out.push(field);
  });
  // Fastir reitir mega ekki hverfa
  for (const core of Object.keys(GRANT_CORE)) if (!out.some((x) => x.name === core)) out.push(DEFAULT_GRANT_FORM.find((x) => x.name === core)!);
  await setSetting(c.env.DB, 'grant_form_fields', JSON.stringify(out));
  return c.redirect('/stjorn/umsoknir/form?m=' + encodeURIComponent('Formið var vistað og birtist strax á vefnum.'));
});

app.post('/umsoknir/mottaka', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const f = await c.req.formData();
  const open = f.get('open') === '0' ? '0' : '1';
  await setSetting(c.env.DB, 'grant_open', open);
  await setSetting(c.env.DB, 'grant_closed_text', String(f.get('closed_text') ?? '').trim().slice(0, 1000));
  return c.redirect('/stjorn/umsoknir?m=' + encodeURIComponent(open === '1' ? 'Opið fyrir umsóknir. Formið birtist á vefnum.' : 'Lokað fyrir umsóknir. Formið er falið á vefnum.'));
});

app.get('/umsoknir/:id{[0-9]+}', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const r = await one<AppRow>(c.env.DB, 'SELECT * FROM applications WHERE id = ?', c.req.param('id'));
  if (!r) return c.notFound();
  const d = JSON.parse(r.data) as Record<string, string>;
  const files = JSON.parse(r.files) as { key: string; name: string; label: string }[];
  const decided = r.decision !== '';
  const year = r.award_year ?? new Date().getUTCFullYear();
  // Reitir eins og formið er núna, og reitir sem voru í forminu þegar umsóknin barst en hafa síðan verið fjarlægðir
  const current = (await grantForm(c.env.DB)).filter((f) => f.type !== 'file');
  const fieldList: GrantField[] = [...current, ...Object.keys(d).filter((k) => !current.some((f) => f.name === k))
    .map((k) => ({ name: k, label: DEFAULT_GRANT_FORM.find((f) => f.name === k)?.label ?? k }))];
  const msg = c.req.query('m');
  const awardFields = (
    <div class="form-grid">
      <div class="field"><label for="award_recipient">Styrkþegi</label><input id="award_recipient" name="award_recipient" value={r.award_recipient || d.felag} required /></div>
      <div class="field"><label for="award_amount">Veitt upphæð (kr.)</label><input id="award_amount" name="award_amount" inputmode="numeric" value={String(r.award_amount || Number(String(d.upphaed || '0').replace(/\D/g, '')) || '')} required /></div>
      <div class="field wide"><label for="award_project">Verkefni (eins og það birtist á vefnum)</label><input id="award_project" name="award_project" value={r.award_project || d.verkefni} required /></div>
      <div class="field"><label for="award_year">Ár úthlutunar</label><input id="award_year" name="award_year" inputmode="numeric" value={String(year)} required /></div>
      <div class="field"><label for="award_round">Úthlutun</label><select id="award_round" name="award_round">
        {Object.entries(GRANT_ROUNDS).map(([k, l]) => <option value={k} selected={(r.award_round || 'fyrri') === k}>{l}</option>)}</select></div>
      <div class="field wide"><label class="check"><input type="checkbox" name="award_published" value="1" checked={!decided || !!r.award_published} /> Birta úthlutunina á vefnum (Úthlutanir fyrri ára á síðunni Verkefnasjóður)</label></div>
    </div>
  );
  return page(c, r.title, 'umsoknir', (
    <>
      <p><a href="/stjorn/umsoknir">← Allar umsóknir</a></p>
      {msg && <div class="flash ok" role="status">{msg}</div>}
      <h1>{d.verkefni}</h1>
      <p class="lead">{d.felag} · barst {dateLong(r.created_at)} · <DecisionPill d={r.decision} />{r.decided_at && ` ${dateLong(r.decided_at)}`}</p>
      <dl class="app-data">
        {fieldList.map((f) => <><dt>{f.label}</dt><dd style="white-space: pre-wrap">{f.type === 'number' && d[f.name] ? `${fmtNum(Number(d[f.name] || 0))}${f.name === 'upphaed' ? ' kr.' : ''}` : d[f.name] || '—'}</dd></>)}
        <dt>Fylgiskjöl</dt>
        <dd>{files.length ? files.map((f, i) => <div><a href={`/stjorn/umsoknir/${r.id}/skra/${i}`}>{f.name}</a> <span class="muted small">({f.label})</span></div>) : '—'}</dd>
      </dl>

      <form method="post" action={`/stjorn/umsoknir/${r.id}/akvordun`} class="edit-form decision-form">
        <h2>{decided ? 'Ákvörðun' : 'Afgreiða umsókn'}</h2>
        {r.decision === 'hafnad' ? (
          <p>Umsókninni var hafnað {r.decided_at && dateLong(r.decided_at)}. Hún birtist ekki á vefnum.</p>
        ) : (
          <>
            {!decided && <p class="muted">Ef umsóknin er samþykkt bætist úthlutunin í töfluna „Úthlutanir fyrri ára“ á síðunni Verkefnasjóður (ef hakað er við að birta hana).</p>}
            {awardFields}
          </>
        )}
        {!decided && (
          <div class="field wide"><label for="reason">Ástæða höfnunar (valfrjálst, fer í póstinn til umsækjanda ef hafnað er)</label><textarea id="reason" name="reason" rows={2}></textarea></div>
        )}
        {!decided && d.netfang && <div class="field wide"><label class="check"><input type="checkbox" name="notify" value="1" checked /> Senda umsækjanda tölvupóst um niðurstöðuna ({d.netfang})</label></div>}
        <div class="form-actions">
          {!decided ? (
            <>
              <button class="btn" name="action" value="samthykkja">Samþykkja umsókn</button>
              <button class="btn danger" name="action" value="hafna" formnovalidate data-confirm-btn="Hafna umsókninni?">Hafna umsókn</button>
            </>
          ) : (
            <>
              {r.decision === 'samthykkt' && <button class="btn" name="action" value="vista">Vista breytingar</button>}
              <button class="btn ghost" name="action" value="afturkalla" formnovalidate data-confirm-btn="Afturkalla ákvörðunina? Umsóknin verður aftur óafgreidd og úthlutunin hverfur af vefnum.">Afturkalla ákvörðun</button>
            </>
          )}
          <a class="btn ghost cancel" href="/stjorn/umsoknir" data-back>Til baka</a>
        </div>
      </form>

      <form method="post" action={`/stjorn/umsoknir/${r.id}/stada`} class="edit-form">
        <div class="field wide"><label for="note">Athugasemd starfsfólks (sést ekki opinberlega)</label><textarea id="note" name="note" rows={3}>{r.note}</textarea></div>
        <div class="form-actions"><button class="btn ghost" name="status" value={r.status}>Vista athugasemd</button></div>
      </form>
      <form method="post" action={`/stjorn/umsoknir/${r.id}/eyda`} class="danger-zone" data-confirm="Eyða umsókninni og fylgiskjölum hennar fyrir fullt og allt?">
        <button class="btn danger">Eyða umsókn</button>
      </form>
    </>
  ));
});

app.post('/umsoknir/:id{[0-9]+}/akvordun', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const r = await one<AppRow>(db, 'SELECT * FROM applications WHERE id = ?', id);
  if (!r) return c.notFound();
  const d = JSON.parse(r.data) as Record<string, string>;
  const f = await c.req.formData();
  const action = String(f.get('action') || '');
  const user = c.get('user')!;
  const back = (m: string) => c.redirect(`/stjorn/umsoknir/${id}?m=${encodeURIComponent(m)}`);
  const award = () => ({
    recipient: String(f.get('award_recipient') || d.felag || '').trim().slice(0, 200),
    project: String(f.get('award_project') || d.verkefni || '').trim().slice(0, 500),
    amount: Number(String(f.get('award_amount') || '0').replace(/\D/g, '')) || 0,
    year: Number(String(f.get('award_year') || '').replace(/\D/g, '')) || new Date().getUTCFullYear(),
    round: GRANT_ROUNDS[String(f.get('award_round'))] ? String(f.get('award_round')) : 'fyrri',
    published: f.get('award_published') ? 1 : 0,
  });
  if (action === 'samthykkja' || action === 'vista') {
    const a = award();
    await run(db, `UPDATE applications SET decision = 'samthykkt', status = 'afgreidd', award_recipient = ?, award_project = ?, award_amount = ?,
      award_year = ?, award_round = ?, award_published = ?, decided_at = COALESCE(decided_at, datetime('now')), decided_by = COALESCE(decided_by, ?) WHERE id = ?`,
      a.recipient, a.project, a.amount, a.year, a.round, a.published, user.id, id);
    if (action === 'samthykkja' && f.get('notify') && d.netfang) {
      await sendMail(c.env, d.netfang, `Umsókn í Verkefnasjóð HSK samþykkt: ${a.project}`,
        `Sæl/l,\n\nHSK hefur samþykkt umsókn ${a.recipient} í Verkefnasjóð HSK vegna verkefnisins „${a.project}“. Veittur styrkur er ${fmtNum(a.amount)} kr.\n\nTil hamingju og gangi ykkur vel með verkefnið. Nánari upplýsingar veitir skrifstofa HSK.\n\nKveðja,\nHéraðssambandið Skarphéðinn`);
    }
    return back(action === 'vista' ? 'Breytingar vistaðar.' : a.published ? 'Umsókn samþykkt og úthlutunin birt á vefnum.' : 'Umsókn samþykkt. Úthlutunin er ekki birt á vefnum.');
  }
  if (action === 'hafna') {
    await run(db, "UPDATE applications SET decision = 'hafnad', status = 'afgreidd', award_published = 0, decided_at = datetime('now'), decided_by = ? WHERE id = ?", user.id, id);
    if (f.get('notify') && d.netfang) {
      const reason = String(f.get('reason') || '').trim();
      await sendMail(c.env, d.netfang, `Umsókn í Verkefnasjóð HSK: ${d.verkefni}`,
        `Sæl/l,\n\nTakk fyrir umsókn ${d.felag} í Verkefnasjóð HSK vegna verkefnisins „${d.verkefni}“. Því miður var ekki unnt að verða við umsókninni að þessu sinni.${reason ? `\n\n${reason}` : ''}\n\nNánari upplýsingar veitir skrifstofa HSK.\n\nKveðja,\nHéraðssambandið Skarphéðinn`);
    }
    return back('Umsókn hafnað.');
  }
  if (action === 'afturkalla') {
    await run(db, "UPDATE applications SET decision = '', status = 'ny', award_published = 0, decided_at = NULL, decided_by = NULL WHERE id = ?", id);
    return back('Ákvörðun afturkölluð. Umsóknin er aftur óafgreidd.');
  }
  return back('Engin breyting.');
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
  // Boðstengill gildir í 7 daga svo fólk nái að opna póstinn
  const token = await createLoginToken(c.env, email, 7 * 24 * 60);
  const sent = await sendMail(c.env, email, 'Þér hefur verið boðinn aðgangur að vef HSK',
    `Halló,\n\nÞér hefur verið boðinn aðgangur að vefumsjón Héraðssambandsins Skarphéðins (HSK).\n\nSkráðu þig inn hér:\n${c.env.SITE_URL}/stjorn/innskra?t=${encodeURIComponent(token)}\n\nTengillinn gildir í 7 daga og aðeins einu sinni. Eftir það getur þú alltaf skráð þig inn á ${c.env.SITE_URL}/stjorn með þessu netfangi, og valið þér lykilorð undir „Lykilorð“.`);
  return c.redirect(`/stjorn/notendur?m=${sent ? 'bodid' : 'bodid-ekki'}`);
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

// ---------- HSK met: öll met í einni töflu ----------

// „Skráð met“ sýnir allar línur úr töflunni á vefnum; met skráð í vefumsjón fá tengilinn „Breyta“
// Gilt met í grein, flokki og aldursflokki: sýnt í „Skrá nýtt met“ svo innsláttarvillur sjáist strax
app.get('/met-gild', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const low = (v: string) => v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('is');
  const event = low(c.req.query('grein') ?? '');
  const catLabel = RECORD_CATEGORIES[c.req.query('flokkur') ?? ''] ?? '';
  const group = low(c.req.query('aldur') ?? '');
  const self = Number(c.req.query('id') || 0);
  if (!event || !catLabel) return c.json({ status: 'tomt' });
  const all_ = (await catalogueRows(c.env)).filter((r) => !(self && r.entry === self));
  const current = currentRecords(all_);
  const sameEvent = all_.filter((r) => low(r.event) === event);
  if (!sameEvent.length) return c.json({ status: 'ny-grein' });
  const sameCat = sameEvent.filter((r) => r.categories.includes(catLabel));
  const groupsHere = [...new Set(sameCat.flatMap((r) => r.groups))].sort((a, b) => a.localeCompare(b, 'is', { numeric: true }));
  const combo = sameCat.filter((r) => group ? r.groups.some((g) => low(g) === group) : r.groups.length === 0);
  if (!combo.length) return c.json({ status: 'enginn-flokkur', groups: groupsHere.slice(0, 40) });
  const valid = combo.filter((r) => current.has(r)).map(({ result, athlete, date, place, dateKey }) => ({ result, athlete, date, place, dateKey }));
  return c.json({ status: 'til', current: valid });
});

app.get('/ny-met', async (c) => {
  const deny = staffOnly(c); if (deny) return deny;
  const rows = await catalogueRows(c.env);
  const entries = rows.filter((r) => r.entry).length;
  return page(c, 'HSK met', 'ny-met', (
    <>
      <div class="title-row"><h1>HSK met</h1><a class="btn" href="/stjorn/ny-met/nytt">Skrá nýtt met</a></div>
      <nav class="subtabs"><a href="/stjorn/ny-met" class="on">Skráð met</a><a href="/stjorn/met">Metaskrár (Excel)</a></nav>
      <p class="lead">Öll met eins og þau birtast á síðunni <a href="/mot/hsk-met" target="_blank">HSK met</a>. {entries > 0 ? `${entries} met hafa verið skráð hér í vefumsjón og má breyta þeim.` : 'Met sem skráð eru hér birtast strax í töflunni.'} Met úr metaskrám breytast í gegnum metaskrána sjálfa.</p>
      <RecordCatalogue rows={rows} admin />
    </>
  ));
});

// ---------- Almennar efnistegundir ----------

export type RefOption = { id: number; label: string; group?: string; data?: Record<string, string> };

/** Mót og viðburðir til að tengja við: birt atriði síðustu tveggja ára og fram undan, auk þess sem þegar er tengt.
 *  Hverju fylgja heiti, dagsetning og grein svo formið geti fyllt þau út. */
async function eventOptions(db: D1Database, current?: number, onlyMot = false): Promise<RefOption[]> {
  const rows = await all<{ id: number; title: string; starts_at: string; sport: string; kind: string }>(db,
    `SELECT id, title, starts_at, sport, kind FROM events
     WHERE (status = 'published' AND starts_at >= date('now', '-2 years')${onlyMot ? " AND kind = 'mot'" : ''}) OR id = ? ORDER BY starts_at DESC`, current ?? 0);
  const today = new Date().toISOString().slice(0, 10);
  const opt = (r: typeof rows[number], group: string): RefOption => ({
    id: r.id, group, label: `${dateLong(r.starts_at)} – ${r.title}${r.kind === 'vidburdur' ? ' (viðburður)' : ''}`,
    data: { title: r.title, date: r.starts_at.slice(0, 10), sport: r.sport || '' },
  });
  // Liðin mót fyrst (nýjast efst), svo það sem er fram undan (næst efst)
  return [
    ...rows.filter((r) => r.starts_at.slice(0, 10) <= today).map((r) => opt(r, onlyMot ? 'Liðin mót' : 'Liðin mót og viðburðir')),
    ...rows.filter((r) => r.starts_at.slice(0, 10) > today).reverse().map((r) => opt(r, 'Fram undan')),
  ];
}

async function refOptions(c: Context<AppEnv>, t: ContentType, row?: Partial<Row> | null) {
  const db = c.env.DB;
  const need = new Set(t.fields.map((f) => f.type));
  return {
    club: need.has('club') ? (await all<{ id: number; name: string }>(db, 'SELECT id, name FROM clubs ORDER BY name')).map((r) => ({ id: r.id, label: r.name })) : [],
    event: need.has('event') ? await eventOptions(db, Number(row?.event_id) || undefined, t.key === 'urslit') : [],
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
  // Síur (t.d. flokkur og ár á HSK met): valkostir úr skilgreiningu reitsins eða gildum sem eru til í töflunni
  const filterVals: Record<string, string> = {};
  const filterOpts: Record<string, [string, string][]> = {};
  for (const fl of t.filters ?? []) {
    const def = t.fields.find((f) => f.name === fl.field);
    const present = (await all<{ v: string }>(c.env.DB, `SELECT DISTINCT ${fl.field} AS v FROM ${t.table} WHERE ${fl.field} IS NOT NULL AND ${fl.field} <> '' ORDER BY ${fl.field} ${fl.field === 'year' ? 'DESC' : ''}`)).map((r) => String(r.v));
    filterOpts[fl.field] = present.map((v) => [v, def?.options?.[v] ?? v]);
    const val = c.req.query(fl.field) ?? '';
    if (val && present.includes(val)) { filterVals[fl.field] = val; where.push(`${fl.field} = ?`); params.push(val); }
  }
  // Dráttarröðun: aðeins þegar allur listinn sést (engin leit eða sía)
  const dragging = !!t.dragSort && !q && !Object.keys(filterVals).length && pageNo === 1;
  const per = dragging ? 1000 : 50;
  const rows = await all<Row>(c.env.DB, `SELECT * FROM ${t.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${t.order} LIMIT ? OFFSET ?`, ...params, per + 1, (pageNo - 1) * per);
  const fmt = (col: ContentType['listColumns'][number], r: Row): Child => {
    const v = r[col.field];
    if (col.format === 'status') return <StatusPill status={String(v)} />;
    if (col.format === 'date') return v ? dateLong(String(v)) : '—';
    if (col.format === 'datetime') return v ? dateTime(String(v)) : '—';
    if (col.format === 'option') return t.fields.find((f) => f.name === col.field)?.options?.[String(v)] ?? String(v ?? '');
    return String(v ?? '');
  };
  const qs = (extra: Record<string, string>) => '?' + new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { stada: status } : {}), ...filterVals, ...extra });
  return page(c, t.label, t.key, (
    <>
      {(t.key === 'ny-met' || t.key === 'met') ? (
        // HSK met: stök met og metaskrár (Excel) á einum stað, með flipum
        <>
          <div class="title-row"><h1>HSK met</h1><a class="btn" href={`/stjorn/${t.key}/nytt`}>{t.key === 'ny-met' ? 'Skrá nýtt met' : 'Hlaða inn metaskrá'}</a></div>
          <nav class="subtabs"><a href="/stjorn/ny-met" class={t.key === 'ny-met' ? 'on' : ''}>Skráð met</a><a href="/stjorn/met" class={t.key === 'met' ? 'on' : ''}>Metaskrár (Excel)</a></nav>
          <p class="lead">{t.key === 'ny-met' ? 'Stök met sem skráð eru hér birtast strax í töflunni á síðunni HSK met.' : 'Heilar metaskrár í Excel. Metin í þeim birtast í sömu töflu á síðunni HSK met.'}</p>
        </>
      ) : (t.key === 'styrktaradilar' || t.key === 'auglysingar') ? (
        // Styrktaraðilar og auglýsingar: ein síða í vefumsjón með flipum; aðskilið á vefnum
        <>
          <div class="title-row"><h1>Styrktaraðilar og auglýsingar</h1><a class="btn" href={`/stjorn/${t.key}/nytt`}>{t.key === 'styrktaradilar' ? 'Skrá styrktaraðila' : 'Skrá auglýsingu'}</a></div>
          <nav class="subtabs"><a href="/stjorn/styrktaradilar" class={t.key === 'styrktaradilar' ? 'on' : ''}>Styrktaraðilar</a><a href="/stjorn/auglysingar" class={t.key === 'auglysingar' ? 'on' : ''}>Auglýsingar</a></nav>
          <p class="lead">{t.key === 'styrktaradilar'
            ? 'Merki styrktar- og samstarfsaðila birtast neðst á öllum síðum vefsins, í þeirri röð sem hér er.'
            : 'Auglýsingar birtast í auglýsingaplássum á forsíðunni. Veldu pláss og hladdu upp mynd í stærðinni sem plássið gefur upp.'}</p>
        </>
      ) : (
        <div class="title-row"><h1>{t.label}</h1><a class="btn" href={`/stjorn/${t.key}/nytt`}>{isStaff(user) ? `Skrá ${t.singular}` : `Senda inn ${t.singular}`}</a></div>
      )}
      <form method="get" class={t.filters ? 'toolbar filter-bar' : 'toolbar'}>
        {t.filters ? <div class="fb-field"><label for="tb-q">Leit</label><input id="tb-q" name="q" type="search" value={q} placeholder="Leita…" /></div> : <input name="q" type="search" value={q} placeholder="Leita…" aria-label="Leita" />}
        {(t.filters ?? []).map((fl) => (
          <div class="fb-field"><label for={'tb-' + fl.field}>{fl.label}</label>
            <select id={'tb-' + fl.field} name={fl.field} data-autosubmit>
              <option value="">{fl.field === 'year' ? 'Öll ár' : `Allt`}</option>
              {filterOpts[fl.field].map(([v, l]) => <option value={v} selected={filterVals[fl.field] === v}>{l}</option>)}
            </select>
          </div>
        ))}
        {t.status && (
          <select name="stada" aria-label="Staða">
            <option value="">Allar stöður</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option value={k} selected={k === status}>{l}</option>)}
            {(t.table === 'events' || t.table === 'news') && <option value="tvitekid" selected={status === 'tvitekid'}>Tvítekið (falið)</option>}
          </select>
        )}
        <button class="btn small">Sía</button>
      </form>
      {dragging && <p class="muted small sort-hint">Dragðu línu í handfanginu <span aria-hidden="true">⋮⋮</span> til að breyta röðinni, eða notaðu örvarnar. Röðin vistast strax og birtist eins á vefnum. <span role="status" data-sort-status></span></p>}
      <table class="tbl">
        <thead><tr>{dragging && <th class="drag-col"><span class="sr">Röð</span></th>}{t.listColumns.map((col) => <th>{col.label}</th>)}<th></th></tr></thead>
        <tbody data-sortable={dragging ? `/stjorn/${t.key}/rod` : undefined}>
          {rows.slice(0, per).map((r) => (
            <tr data-id={dragging ? String(r.id) : undefined} draggable={dragging ? 'true' : undefined}>
              {dragging && <td class="drag-col"><span class="drag-handle" title="Dragðu til að raða" aria-hidden="true">⋮⋮</span>
                <button type="button" class="sort-btn" data-move="-1" aria-label={`Færa ${String(r[t.titleField] ?? '')} upp`}>↑</button>
                <button type="button" class="sort-btn" data-move="1" aria-label={`Færa ${String(r[t.titleField] ?? '')} niður`}>↓</button></td>}
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

// Ný röð úr dráttarröðun: listi af auðkennum í réttri röð → sort 1, 2, 3 …
app.post('/:type/rod', async (c) => {
  const t = getType(c.req.param('type'));
  if (!t || !t.dragSort) return c.notFound();
  const deny = staffOnly(c); if (deny) return deny;
  const body = await c.req.json<{ ids?: unknown[] }>().catch(() => ({ ids: [] as unknown[] }));
  const ids = (body.ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return c.json({ error: 'Engin röð' }, 400);
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare(`UPDATE ${t.table} SET sort = ? WHERE id = ?`).bind(i + 1, id)));
  return c.json({ ok: true });
});

async function editForm(c: Context<AppEnv>, t: ContentType, row: Partial<Row> | null, error?: string) {
  const user = c.get('user')!;
  const opts = await refOptions(c, t, row);
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
          <a class="btn ghost cancel" href={isStaff(user) || !t.clubOwnRecord ? `/stjorn/${t.key}` : '/stjorn'} data-back>Hætta við</a>
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
                    <div class="photo-fields">
                      <input class="photo-caption" name={`caption_${p.id}`} value={p.caption} placeholder="Myndatexti" aria-label={`Myndatexti myndar ${i + 1}`} />
                      <div class="photo-tools">
                        <label class="photo-order">Röð <input name={`sort_${p.id}`} type="number" step="any" value={String(i + 1)} aria-label={`Röð myndar ${i + 1}`} /></label>
                        <label class="check small"><input type="checkbox" name={`delete_${p.id}`} value="1" /> Eyða</label>
                      </div>
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
  // Ný færsla í lista sem raðað er með því að draga fer aftast
  if (t.dragSort && !id) data.sort = ((await one<{ s: number }>(db, `SELECT coalesce(max(sort), 0) + 1 AS s FROM ${t.table}`))?.s ?? 1);
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
  const max = await one<{ s: number }>(c.env.DB, 'SELECT coalesce(max(sort), 0) + 1 AS s FROM photos WHERE album_id = ?', id);
  await run(c.env.DB, 'INSERT INTO photos (album_id, src, caption, sort) VALUES (?, ?, ?, ?)', id, src, caption ?? '', max?.s ?? 1);
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
  // Röð: raðað eftir tölunum sem voru slegnar inn (jafnar tölur halda fyrri röð) og síðan númerað 1, 2, 3 …
  const keep: { pid: number; n: number; idx: number }[] = [];
  for (const [idx, raw] of f.getAll('id').entries()) {
    const pid = parseInt(String(raw), 10);
    if (f.get(`delete_${pid}`)) {
      const ph = await one<{ src: string }>(db, 'SELECT src FROM photos WHERE id = ? AND album_id = ?', pid, albumId);
      if (ph) deleted.push(ph.src);
      stmts.push(db.prepare('DELETE FROM photos WHERE id = ? AND album_id = ?').bind(pid, albumId));
    } else {
      const n = parseFloat(String(f.get(`sort_${pid}`) ?? '').replace(',', '.'));
      keep.push({ pid, n: Number.isFinite(n) ? n : idx + 1, idx });
    }
  }
  keep.sort((a, b) => a.n - b.n || a.idx - b.idx).forEach(({ pid }, rank) => {
    stmts.push(db.prepare('UPDATE photos SET caption = ?, sort = ? WHERE id = ? AND album_id = ?').bind(String(f.get(`caption_${pid}`) || ''), rank + 1, pid, albumId));
  });
  if (stmts.length) await db.batch(stmts);
  // Ef forsíðumynd var eytt er fyrsta mynd notuð
  const album = await one<{ cover: string }>(db, 'SELECT cover FROM albums WHERE id = ?', albumId);
  if (album && deleted.includes(album.cover)) {
    await run(db, "UPDATE albums SET cover = coalesce((SELECT src FROM photos WHERE album_id = ? ORDER BY sort, id LIMIT 1), '') WHERE id = ?", albumId, albumId);
  }
  return c.redirect(`/stjorn/myndasofn/${albumId}?m=myndir`);
});

export default app;
