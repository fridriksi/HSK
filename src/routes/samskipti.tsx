// Samskipti: fjöldapóstur til tengiliða HSK og aðildarfélaga (útsendingar, tengiliðir, niðurstöður)
import { Hono, type Context } from 'hono';
import type { Child } from 'hono/jsx';
import { type AppEnv, type User, all, one, run, sanitizeHtml, dateTime, dateLong, fmtNum, nowIso } from '../lib';
import { AREAS, SPORTS } from '../content-types';
import {
  type Audience, type Campaign, KINDS, STATUS, REASONS, APPROVAL_LIMIT, parseAudience, audienceEmpty, audienceCounts, resolveAudience,
  skipReason, senderName, emailHtml, sendTest, queueCampaign, processQueue, mailReady,
} from '../campaigns';

type PageFn = (c: Context<AppEnv>, title: string, active: string, body: Child, opts?: { error?: string; status?: number }) => Promise<Response>;

const isStaff = (u: User) => u.role === 'admin' || u.role === 'editor';
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const TABS: [string, string][] = [
  ['', 'Allt'], ['drog', 'Drög'], ['timasett', 'Tímasett'], ['bidur_samthykktar', 'Bíður samþykktar'], ['i_sendingu', 'Í sendingu'], ['sent', 'Sent'], ['rusl', 'Rusl'],
];

export function samskiptiRoutes(page: PageFn) {
  const app = new Hono<AppEnv>();

  async function load(c: Context<AppEnv>): Promise<Campaign | null> {
    const user = c.get('user')!;
    const camp = await one<Campaign>(c.env.DB, 'SELECT * FROM campaigns WHERE id = ?', Number(c.req.param('id')));
    if (!camp) return null;
    if (!isStaff(user) && (camp.is_template ? false : camp.sender_club_id !== user.club_id)) return null;
    return camp;
  }

  // ---------- Yfirlit ----------
  app.get('/', async (c) => {
    const user = c.get('user')!;
    const db = c.env.DB;
    const tab = c.req.query('tab') || '';
    const q = (c.req.query('q') || '').trim();
    const view = c.req.query('syn') === 'tafla' ? 'tafla' : 'kort';
    const limit = Math.min(500, Math.max(20, Number(c.req.query('fjoldi')) || 20));
    const where = ['is_template = 0'];
    const p: unknown[] = [];
    if (tab === 'rusl') where.push('deleted_at IS NOT NULL');
    else { where.push('deleted_at IS NULL'); if (tab) { where.push('status = ?'); p.push(tab); } }
    if (!isStaff(user)) { where.push('sender_club_id = ?'); p.push(user.club_id ?? 0); }
    if (q) { where.push('(subject LIKE ? OR internal_name LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    const rows = await all<Campaign & { unit: string; delivered: number; attempted: number }>(db,
      `SELECT k.*, COALESCE(cl.name, 'HSK') AS unit,
         (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = k.id AND r.status = 'delivered') AS delivered,
         (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = k.id AND r.status <> 'skipped') AS attempted
       FROM campaigns k LEFT JOIN clubs cl ON cl.id = k.sender_club_id
       WHERE ${where.join(' AND ')} ORDER BY COALESCE(k.sent_at, k.scheduled_at, k.updated_at) DESC LIMIT ?`, ...p, limit + 1);
    const more = rows.length > limit;
    // Lykiltölur síðustu 30 daga
    const scope = isStaff(user) ? '' : 'AND k.sender_club_id = ' + Number(user.club_id ?? 0);
    const kpi = await one<{ sent: number; delivered: number; opened: number }>(db,
      `SELECT count(*) AS sent, sum(r.status = 'delivered') AS delivered, sum(r.opened_at IS NOT NULL) AS opened
       FROM campaign_recipients r JOIN campaigns k ON k.id = r.campaign_id
       WHERE r.status IN ('sent', 'delivered', 'failed') AND r.sent_at >= datetime('now', '-30 days') ${scope}`);
    const uns = await one<{ now: number; before: number }>(db,
      `SELECT sum(created_at >= datetime('now', '-30 days')) AS now,
              sum(created_at < datetime('now', '-30 days') AND created_at >= datetime('now', '-60 days')) AS before FROM unsubscribes`);
    const diff = (uns?.now ?? 0) - (uns?.before ?? 0);
    const qs = (extra: Record<string, string>) => '?' + new URLSearchParams(Object.entries({ tab, q, syn: view === 'tafla' ? 'tafla' : '', ...extra }).filter(([, v]) => v));
    return page(c, 'Samskipti', 'samskipti', (
      <>
        <div class="title-row">
          <div><h1>Samskipti</h1><p class="lead">Fjölpóstur til tengiliða HSK og aðildarfélaga.</p></div>
          <div class="title-actions">
            <button class="btn ghost" disabled title="SMS-gátt er ekki tengd enn">Senda SMS</button>
            <form method="post" action="/stjorn/samskipti/nytt" class="inline"><button class="btn">Senda tölvupóst</button></form>
          </div>
        </div>
        {!mailReady(c.env) && <div class="flash err" role="status">Póstþjónusta (Postmark) er ekki tengd. Hægt er að skrifa drög og velja viðtakendur, en ekki senda.</div>}
        <nav class="subtabs">{TABS.map(([k, l]) => <a href={'/stjorn/samskipti' + qs({ tab: k })} class={tab === k ? 'on' : ''}>{l}</a>)}<a href="/stjorn/samskipti/tengilidir">Tengiliðir</a></nav>
        <div class="kpi-row">
          <div class="kpi"><span>Póstar sendir</span><strong>{fmtNum(kpi?.sent ?? 0)}</strong><small>síðustu 30 daga</small></div>
          <div class="kpi"><span>Afhent</span><strong>{fmtNum(kpi?.delivered ?? 0)}</strong><small>{pct(kpi?.delivered ?? 0, kpi?.sent ?? 0)}% af sendum</small></div>
          <div class="kpi"><span>Opnað</span><strong>{pct(kpi?.opened ?? 0, kpi?.delivered ?? 0)}%</strong><small>{fmtNum(kpi?.opened ?? 0)} af {fmtNum(kpi?.delivered ?? 0)} afhentum</small></div>
          <div class="kpi"><span>Afskráðu sig</span><strong>{fmtNum(uns?.now ?? 0)}</strong><small>{diff >= 0 ? '+' : ''}{diff} frá fyrri 30 dögum</small></div>
        </div>
        <form method="get" class="toolbar filter-bar">
          <input type="hidden" name="tab" value={tab} />
          <div class="fb-field"><label for="sk-q">Leit</label><input id="sk-q" name="q" type="search" value={q} placeholder="Leita að útsendingu" /></div>
          <div class="fb-field"><label for="sk-t">Tegund</label><select id="sk-t" name="tegund" data-autosubmit><option value="">Allar</option><option value="email">Tölvupóstur</option></select></div>
          <div class="fb-field"><label for="sk-s">Sýn</label><select id="sk-s" name="syn" data-autosubmit><option value="">Kort</option><option value="tafla" selected={view === 'tafla'}>Tafla</option></select></div>
          <button class="btn small">Leita</button>
        </form>
        {!rows.length && <p class="muted">Engar útsendingar hér enn.</p>}
        {view === 'kort' ? (
          <div class="camp-cards">
            {rows.slice(0, limit).map((k) => (
              <article class="camp-card">
                <div class="camp-card-head">
                  <h2><a href={`/stjorn/samskipti/${k.id}${['sent', 'i_sendingu'].includes(k.status) ? '/nidurstodur' : ''}`}>{k.subject || '(engin efnislína)'}</a></h2>
                  <span class="tag">Tölvupóstur</span><span class={`tag st-${k.status}`}>{k.deleted_at ? 'Rusl' : STATUS[k.status]}</span>
                </div>
                {k.internal_name && <p class="muted small">{k.internal_name}</p>}
                <p class="small">{k.unit} · {fmtNum(k.recipient_count || k.sendable_count)} viðtakendur</p>
                {k.description && <p class="small">{k.description}</p>}
                {['sent', 'i_sendingu'].includes(k.status) ? (
                  <>
                    <p class="small">{fmtNum(k.delivered)} af {fmtNum(k.attempted)} afhent · {pct(k.delivered, k.attempted)}%</p>
                    <div class="bar"><span style={`width:${pct(k.delivered, k.attempted)}%`}></span></div>
                    <p class="small muted">{k.sent_at ? `Sent ${dateTime(k.sent_at)}` : 'Í sendingu'} · <a href={`/stjorn/samskipti/${k.id}/nidurstodur`}>Sjá niðurstöður</a></p>
                  </>
                ) : k.status === 'timasett' ? (
                  <p class="small muted">Sendist {dateTime(k.scheduled_at)} · <a href={`/stjorn/samskipti/${k.id}`}>Opna</a></p>
                ) : (
                  <p class="small muted">Breytt {dateTime(k.updated_at)} · <a href={`/stjorn/samskipti/${k.id}`}>Halda áfram</a></p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <table class="list">
            <thead><tr><th>Efnislína</th><th>Sendandi</th><th>Staða</th><th>Viðtakendur</th><th>Afhent</th><th>Dags.</th></tr></thead>
            <tbody>{rows.slice(0, limit).map((k) => (
              <tr>
                <td><a href={`/stjorn/samskipti/${k.id}${['sent', 'i_sendingu'].includes(k.status) ? '/nidurstodur' : ''}`}>{k.subject || '(engin efnislína)'}</a>{k.internal_name && <div class="muted small">{k.internal_name}</div>}</td>
                <td>{k.unit}</td><td>{k.deleted_at ? 'Rusl' : STATUS[k.status]}</td><td>{fmtNum(k.recipient_count || k.sendable_count)}</td>
                <td>{k.attempted ? `${pct(k.delivered, k.attempted)}%` : '—'}</td><td>{dateLong(k.sent_at || k.scheduled_at || k.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {more && <p><a class="btn ghost" href={'/stjorn/samskipti' + qs({ fjoldi: String(limit + 20) })}>Hlaða meira</a></p>}
      </>
    ));
  });

  // Ný drög
  app.post('/nytt', async (c) => {
    const user = c.get('user')!;
    const r = await run(c.env.DB, 'INSERT INTO campaigns (sender_club_id, created_by, owner_id, audience) VALUES (?, ?, ?, ?)',
      isStaff(user) ? null : user.club_id, user.id, user.id, '{}');
    return c.redirect(`/stjorn/samskipti/${r.meta.last_row_id}`);
  });

  // ---------- Tengiliðir ----------
  app.get('/tengilidir', async (c) => {
    const user = c.get('user')!;
    const db = c.env.DB;
    const q = (c.req.query('q') || '').trim();
    const club = isStaff(user) ? Number(c.req.query('felag') || 0) : (user.club_id ?? -1);
    const kind = c.req.query('hlutverk') || '';
    const where = ['1 = 1'];
    const p: unknown[] = [];
    if (club) { where.push('t.club_id = ?'); p.push(club); }
    if (kind) { where.push('t.kind = ?'); p.push(kind); }
    if (q) { where.push('(t.name LIKE ? OR t.email LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    const rows = await all<{ id: number; name: string; email: string; phone: string; kind: string; club: string | null; unsubscribed_at: string | null; suppressed: string | null }>(db,
      `SELECT t.id, t.name, t.email, t.phone, t.kind, cl.name AS club, t.unsubscribed_at, s.reason AS suppressed
       FROM contacts t LEFT JOIN clubs cl ON cl.id = t.club_id LEFT JOIN suppressions s ON s.email = t.email
       WHERE ${where.join(' AND ')} ORDER BY cl.name, t.name LIMIT 500`, ...p);
    const total = (await one<{ n: number }>(db, `SELECT count(*) AS n FROM contacts t WHERE ${where.join(' AND ')}`, ...p))?.n ?? 0;
    const clubs = isStaff(user) ? await all<{ id: number; name: string }>(db, 'SELECT id, name FROM clubs ORDER BY name') : [];
    const msg = c.req.query('m');
    return page(c, 'Tengiliðir', 'samskipti', (
      <>
        <div class="title-row"><h1>Tengiliðir</h1></div>
        <nav class="subtabs"><a href="/stjorn/samskipti">Útsendingar</a><a href="/stjorn/samskipti/tengilidir" class="on">Tengiliðir</a></nav>
        {msg && <div class="flash ok" role="status">{msg}</div>}
        <p class="lead">Fólk sem hægt er að senda fjölpóst á. Svæði og íþróttagreinar ráðast af félaginu sem tengiliðurinn tilheyrir.</p>
        <form method="get" class="toolbar filter-bar">
          <div class="fb-field"><label for="t-q">Leit</label><input id="t-q" name="q" type="search" value={q} placeholder="Nafn eða netfang" /></div>
          {isStaff(user) && <div class="fb-field"><label for="t-f">Félag</label><select id="t-f" name="felag" data-autosubmit><option value="">Öll</option>{clubs.map((cl) => <option value={String(cl.id)} selected={club === cl.id}>{cl.name}</option>)}</select></div>}
          <div class="fb-field"><label for="t-h">Hlutverk</label><select id="t-h" name="hlutverk" data-autosubmit><option value="">Öll</option>{Object.entries(KINDS).map(([k, l]) => <option value={k} selected={kind === k}>{l}</option>)}</select></div>
          <button class="btn small">Leita</button>
        </form>
        <p class="muted">{fmtNum(total)} tengiliðir{total > rows.length && ` · fyrstu ${rows.length} sýndir`}</p>
        <table class="list">
          <thead><tr><th>Nafn</th><th>Netfang</th><th>Sími</th><th>Félag</th><th>Hlutverk</th><th>Staða</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr>
              <td>{r.name}</td><td>{r.email}</td><td>{r.phone}</td><td>{r.club ?? 'HSK'}</td><td>{KINDS[r.kind] ?? r.kind}</td>
              <td>{r.unsubscribed_at ? 'Afskráð' : r.suppressed ? 'Óvirkt netfang' : !r.email ? 'Ekkert netfang' : 'Virkt'}</td>
              <td><form method="post" action={`/stjorn/samskipti/tengilidir/${r.id}/eyda`} class="inline" data-confirm={`Eyða ${r.name || r.email}?`}><button class="btn small ghost danger">Eyða</button></form></td>
            </tr>
          ))}</tbody>
        </table>
        <section class="panel">
          <h2>Bæta við tengilið</h2>
          <form method="post" action="/stjorn/samskipti/tengilidir" class="form-grid">
            <div class="field"><label for="c-name">Nafn</label><input id="c-name" name="name" /></div>
            <div class="field"><label for="c-email">Netfang</label><input id="c-email" name="email" type="email" /></div>
            <div class="field"><label for="c-phone">Sími</label><input id="c-phone" name="phone" /></div>
            {isStaff(user) && <div class="field"><label for="c-club">Félag</label><select id="c-club" name="club_id"><option value="">HSK (ekkert félag)</option>{clubs.map((cl) => <option value={String(cl.id)}>{cl.name}</option>)}</select></div>}
            <div class="field"><label for="c-kind">Hlutverk</label><select id="c-kind" name="kind">{Object.entries(KINDS).map(([k, l]) => <option value={k} selected={k === 'felagi'}>{l}</option>)}</select></div>
            <div class="form-actions wide"><button class="btn">Bæta við</button></div>
          </form>
        </section>
        <section class="panel">
          <h2>Flytja inn úr Excel</h2>
          <p class="muted">Afritaðu dálkana <strong>Nafn, Netfang, Sími, Hlutverk{isStaff(user) && ', Félag'}</strong> úr Excel og límdu hér, ein lína á hvern tengilið. Hlutverk getur verið formaður, stjórn, þjálfari, forráðamaður eða félagi. Netföng sem eru þegar skráð í sama félag eru uppfærð.</p>
          <form method="post" action="/stjorn/samskipti/tengilidir/innflutningur">
            <textarea name="rows" rows={6} placeholder={'Jón Jónsson\tjon@daemi.is\t8881234\tformaður' + (isStaff(user) ? '\tUmf. Selfoss' : '')}></textarea>
            <div class="form-actions"><button class="btn">Flytja inn</button></div>
          </form>
        </section>
        {isStaff(user) && (
          <section class="panel">
            <h2>Tengiliðir úr Aðildarfélögum</h2>
            <p class="muted">Sækir netfang hvers félags og formann/tengilið úr upplýsingum félaganna (Aðildarfélög) og skráir sem tengiliði með hlutverkið formaður. Keyrðu aftur eftir að upplýsingar félaga breytast.</p>
            <form method="post" action="/stjorn/samskipti/tengilidir/felog"><button class="btn ghost">Sækja tengiliði félaga</button></form>
          </section>
        )}
      </>
    ));
  });

  const KIND_WORDS: [RegExp, string][] = [[/forma/i, 'formadur'], [/stj[oó]rn/i, 'stjorn'], [/þjálf|thjalf/i, 'thjalfari'], [/forr[aá]ð/i, 'forradamadur'], [/f[eé]lag/i, 'felagi']];
  const kindOf = (s: string) => KINDS[s] ? s : KIND_WORDS.find(([re]) => re.test(s))?.[1] ?? 'felagi';

  async function upsertContact(db: D1Database, x: { name: string; email: string; phone: string; club_id: number | null; kind: string; source: string }) {
    const email = x.email.trim().toLowerCase();
    if (email) {
      const ex = await one<{ id: number }>(db, 'SELECT id FROM contacts WHERE email = ? AND IFNULL(club_id, 0) = ?', email, x.club_id ?? 0);
      if (ex) {
        await run(db, "UPDATE contacts SET name = CASE WHEN ? <> '' THEN ? ELSE name END, phone = CASE WHEN ? <> '' THEN ? ELSE phone END, kind = ?, updated_at = datetime('now') WHERE id = ?",
          x.name, x.name, x.phone, x.phone, x.kind, ex.id);
        return 'uppfaert';
      }
    }
    await run(db, 'INSERT INTO contacts (name, email, phone, club_id, kind, source) VALUES (?, ?, ?, ?, ?, ?)', x.name.trim(), email, x.phone.trim(), x.club_id, x.kind, x.source);
    return 'nytt';
  }

  app.post('/tengilidir', async (c) => {
    const user = c.get('user')!;
    const f = await c.req.formData();
    const clubId = isStaff(user) ? (Number(f.get('club_id')) || null) : user.club_id;
    await upsertContact(c.env.DB, { name: String(f.get('name') || ''), email: String(f.get('email') || ''), phone: String(f.get('phone') || ''), club_id: clubId, kind: kindOf(String(f.get('kind') || '')), source: 'handvirkt' });
    return c.redirect('/stjorn/samskipti/tengilidir?m=' + encodeURIComponent('Tengilið bætt við.'));
  });

  app.post('/tengilidir/innflutningur', async (c) => {
    const user = c.get('user')!;
    const db = c.env.DB;
    const text = String((await c.req.formData()).get('rows') || '');
    const clubs = await all<{ id: number; name: string }>(db, 'SELECT id, name FROM clubs');
    const norm = (s: string) => s.toLowerCase().replace(/ungmennafélagið|ungmennafélag|umf\.?|íþróttafélagið|golfklúbburinn|hestamannafélagið/g, '').replace(/[^a-záðéíóúýþæö0-9]/g, '');
    let added = 0, updated = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cols = line.split(/\t|;/).map((s) => s.trim());
      const email = cols.find((x) => /@/.test(x)) ?? '';
      const name = cols[0] && !/@/.test(cols[0]) ? cols[0] : '';
      const phone = cols.find((x) => /^\+?[\d\s-]{7,}$/.test(x)) ?? '';
      const rest = cols.filter((x) => x && x !== email && x !== name && x !== phone);
      const kindCol = rest.find((x) => KIND_WORDS.some(([re]) => re.test(x)) && !clubs.some((cl) => norm(cl.name) === norm(x))) ?? '';
      let clubId: number | null = user.club_id;
      if (isStaff(user)) {
        const clubCol = rest.find((x) => x !== kindCol) ?? '';
        clubId = clubCol ? clubs.find((cl) => norm(cl.name) === norm(clubCol) || cl.name.toLowerCase() === clubCol.toLowerCase())?.id ?? null : null;
      }
      if (!email && !name) continue;
      const r = await upsertContact(db, { name, email, phone, club_id: clubId, kind: kindOf(kindCol), source: 'innflutningur' });
      if (r === 'nytt') added++; else updated++;
    }
    return c.redirect('/stjorn/samskipti/tengilidir?m=' + encodeURIComponent(`${added} tengiliðum bætt við, ${updated} uppfærðir.`));
  });

  app.post('/tengilidir/felog', async (c) => {
    const user = c.get('user')!;
    if (!isStaff(user)) return c.text('Þú hefur ekki aðgang að þessu.', 403);
    const db = c.env.DB;
    const clubs = await all<{ id: number; name: string; contact_name: string; email: string; phone: string }>(db, "SELECT id, name, contact_name, email, phone FROM clubs WHERE email <> ''");
    let n = 0;
    for (const cl of clubs) {
      for (const email of cl.email.split(/[\s,;]+/).filter((e) => /@/.test(e))) {
        await upsertContact(db, { name: cl.contact_name || cl.name, email, phone: cl.phone, club_id: cl.id, kind: 'formadur', source: 'felag' });
        n++;
      }
    }
    return c.redirect('/stjorn/samskipti/tengilidir?m=' + encodeURIComponent(`${n} tengiliðir sóttir úr upplýsingum ${clubs.length} félaga.`));
  });

  app.post('/tengilidir/:id{[0-9]+}/eyda', async (c) => {
    const user = c.get('user')!;
    const id = Number(c.req.param('id'));
    if (isStaff(user)) await run(c.env.DB, 'DELETE FROM contacts WHERE id = ?', id);
    else await run(c.env.DB, 'DELETE FROM contacts WHERE id = ? AND club_id = ?', id, user.club_id ?? -1);
    return c.redirect('/stjorn/samskipti/tengilidir?m=' + encodeURIComponent('Tengilið eytt.'));
  });

  // ---------- Ritill ----------

  /** Les reiti ritilsins og vistar. Félagsaðgangur sendir alltaf frá eigin félagi. */
  async function save(c: Context<AppEnv>, camp: Campaign, f: FormData) {
    const user = c.get('user')!;
    const nums = (k: string) => f.getAll(k).map(Number).filter(Boolean);
    const strs = (k: string) => f.getAll(k).map(String).filter(Boolean);
    const audience: Audience = {
      all: f.get('aud_all') === '1' || undefined,
      clubs: nums('aud_clubs'), kinds: strs('aud_kinds'), areas: strs('aud_areas'), sports: strs('aud_sports'),
      notOpened: Number(f.get('aud_notopened')) || undefined, newDays: Number(f.get('aud_newdays')) || undefined,
    };
    const sender = isStaff(user) ? (Number(f.get('sender_club_id')) || null) : user.club_id;
    const counts = await audienceCounts(c.env.DB, audience, sender);
    await run(c.env.DB,
      `UPDATE campaigns SET internal_name = ?, notes = ?, description = ?, sender_club_id = ?, subject = ?, header_image = ?, body_html = ?,
         reply_to = ?, track_clicks = ?, audience = ?, recipient_count = ?, sendable_count = ?, updated_at = datetime('now') WHERE id = ?`,
      String(f.get('internal_name') ?? camp.internal_name), String(f.get('notes') ?? camp.notes), String(f.get('description') ?? camp.description),
      sender, String(f.get('subject') ?? camp.subject).trim(), String(f.get('header_image') ?? camp.header_image),
      sanitizeHtml(String(f.get('body_html') ?? camp.body_html)), String(f.get('reply_to') ?? '').trim(),
      f.get('track_clicks') ? 1 : 0, JSON.stringify(audience), counts.total, counts.sendable, camp.id);
    return { audience, counts, sender };
  }

  const editable = (k: Campaign) => !k.deleted_at && ['drog', 'bidur_samthykktar', 'timasett'].includes(k.status);

  app.get('/:id{[0-9]+}', async (c) => {
    const user = c.get('user')!;
    const db = c.env.DB;
    const k = await load(c);
    if (!k) return c.notFound();
    if (['sent', 'i_sendingu'].includes(k.status)) return c.redirect(`/stjorn/samskipti/${k.id}/nidurstodur`);
    const a = parseAudience(k.audience);
    const clubs = await all<{ id: number; name: string }>(db, isStaff(user) ? 'SELECT id, name FROM clubs ORDER BY name' : 'SELECT id, name FROM clubs WHERE id = ?', ...(isStaff(user) ? [] : [user.club_id ?? 0]));
    const sources = await all<{ id: number; label: string }>(db,
      `SELECT id, CASE WHEN is_template = 1 THEN internal_name ELSE COALESCE(NULLIF(subject, ''), internal_name, 'Án efnislínu') || ' (' || substr(COALESCE(sent_at, updated_at), 1, 10) || ')' END AS label
       FROM campaigns WHERE id <> ? AND deleted_at IS NULL AND (is_template = 1 OR status = 'sent') ${isStaff(user) ? '' : 'AND (is_template = 1 OR sender_club_id = ' + Number(user.club_id ?? 0) + ')'}
       ORDER BY is_template DESC, COALESCE(sent_at, updated_at) DESC LIMIT 30`, k.id);
    const prior = await all<{ id: number; subject: string; sent_at: string }>(db,
      `SELECT id, subject, sent_at FROM campaigns WHERE status = 'sent' AND deleted_at IS NULL ${isStaff(user) ? '' : 'AND sender_club_id = ' + Number(user.club_id ?? 0)} ORDER BY sent_at DESC LIMIT 20`);
    const owner = k.owner_id && k.owner_id !== user.id ? await one<{ name: string; email: string }>(db, 'SELECT name, email FROM users WHERE id = ?', k.owner_id) : null;
    const unit = await senderName(db, k.sender_club_id);
    const counts = await audienceCounts(db, a, k.sender_club_id);
    const needsApproval = !isStaff(user) && counts.sendable > APPROVAL_LIMIT;
    const ready = { sender: true, audience: counts.sendable > 0, subject: !!k.subject.trim(), test: !!k.test_sent_at };
    const msg = c.req.query('m');
    const err = c.req.query('villa');
    const disabled = !editable(k);
    const check = (on: boolean) => on ? <span class="step-ok">Tilbúið</span> : null;
    return page(c, k.internal_name || k.subject || 'Ný útsending', 'samskipti', (
      <form method="post" action={`/stjorn/samskipti/${k.id}/vista`} class="camp-editor" data-campaign={String(k.id)}>
        <p class="crumbs"><a href="/stjorn/samskipti">Samskipti</a> / {k.internal_name || k.subject || 'Ný útsending'}</p>
        {msg && <div class="flash ok" role="status">{msg}</div>}
        {err && <div class="flash err" role="alert">{err}</div>}
        {k.status === 'timasett' && <div class="flash ok" role="status">Tímasett: sendist {dateTime(k.scheduled_at)}. <button class="linklike" formaction={`/stjorn/samskipti/${k.id}/haetta`}>Hætta við tímasetningu</button></div>}
        {k.status === 'bidur_samthykktar' && (
          <div class="flash err" role="status">Bíður samþykktar starfsfólks HSK.
            {isStaff(user) && <> <button class="btn small" formaction={`/stjorn/samskipti/${k.id}/samthykkja`}>Samþykkja og senda</button></>}
          </div>
        )}
        {owner && isStaff(user) && (
          <div class="view-banner"><span><strong>{owner.name || owner.email}</strong> skrifaði þennan póst. Skrifstofan getur tekið við honum og klárað hann.</span>
            <button class="btn small" formaction={`/stjorn/samskipti/${k.id}/taka`}>Taka við póstinum</button></div>
        )}
        <div class="camp-head">
          <input class="camp-name" name="internal_name" value={k.internal_name} placeholder="Innra heiti (sést ekki viðtakendum)" aria-label="Innra heiti" disabled={disabled} />
          <span class="muted small" data-saved>{disabled ? STATUS[k.status] : `Vistað ${dateTime(k.updated_at)}`}</span>
          <details class="menu">
            <summary class="btn small ghost">Aðgerðir</summary>
            <div class="menu-items">
              <button class="linklike" formaction={`/stjorn/samskipti/${k.id}/afrita`}>Afrita</button>
              {isStaff(user) && <button class="linklike" formaction={`/stjorn/samskipti/${k.id}/snidmat`}>Vista sem sniðmát</button>}
              <button class="linklike danger" formaction={`/stjorn/samskipti/${k.id}/eyda`} data-confirm-click="Færa útsendinguna í rusl?">Eyða útsendingu</button>
            </div>
          </details>
        </div>
        <details class="notes"><summary>Minnispunktar</summary>
          <textarea name="notes" rows={3} placeholder="Innri athugasemdir, sjást ekki viðtakendum" disabled={disabled}>{k.notes}</textarea>
          <label class="small">Lýsing á yfirlitssíðu<input name="description" value={k.description} placeholder="T.d. Þeir sem áttu eftir að fá póstinn" disabled={disabled} /></label>
        </details>
        <div class="camp-grid">
          <div class="camp-main">
            {sources.length > 0 && !disabled && (
              <div class="camp-start">
                <label for="source">Byrja á eldri pósti eða sniðmáti</label>
                <select id="source" name="source"><option value="">— Veldu —</option>{sources.map((s) => <option value={String(s.id)}>{s.label}</option>)}</select>
                <button class="btn small ghost" formaction={`/stjorn/samskipti/${k.id}/byrja`} data-confirm-click="Skipta út efni og efnislínu fyrir efni úr völdum pósti?">Nota</button>
              </div>
            )}
            <div class="camp-tabs" role="tablist">
              <button type="button" role="tab" class="on" data-tab="skrifa">Skrifa</button>
              <button type="button" role="tab" data-tab="forskoda">Forskoða</button>
            </div>
            <div data-pane="skrifa">
              <div class="field">
                <label for="f_header_image">Hausmynd (1200×600)</label>
                <div class="upload-field" data-kind="image">
                  <img class="preview" src={k.header_image || undefined} alt="" hidden={!k.header_image} />
                  <div class="upload-row">
                    <input id="f_header_image" name="header_image" type="text" value={k.header_image} placeholder="Slóð á mynd" disabled={disabled} />
                    <label class="btn small ghost">Hlaða upp<input type="file" accept="image/*" hidden /></label>
                    <button type="button" class="btn small ghost" data-clear>Fjarlægja</button>
                  </div>
                  <small class="help">Mynd í öðru hlutfalli er skorin frá miðju. Án myndar birtist blár haus með nafni sendanda.</small>
                </div>
              </div>
              <div class="field">
                <label for="f_body_html">Meginmál</label>
                <textarea id="f_body_html" name="body_html" class="rte" rows={18} disabled={disabled}>{k.body_html}</textarea>
              </div>
              <p class="muted small">Fastur fótur bætist neðst: „Þú færð þennan póst því þú ert skráð/ur á póstlista {unit === 'HSK' ? 'HSK' : unit + ' innan HSK'}.“, heimilisfang HSK og tengill til að afskrá sig.</p>
            </div>
            <div data-pane="forskoda" hidden>
              <iframe class="camp-preview" title="Forskoðun" data-src={`/stjorn/samskipti/${k.id}/forskodun`}></iframe>
            </div>
          </div>

          <aside class="camp-steps">
            <details open>
              <summary>1. Sendandi {check(ready.sender)}</summary>
              <select name="sender_club_id" disabled={disabled || !isStaff(user)} aria-label="Sendandi">
                {isStaff(user) && <option value="">HSK</option>}
                {clubs.map((cl) => <option value={String(cl.id)} selected={k.sender_club_id === cl.id}>{cl.name}</option>)}
              </select>
              <p class="muted small">Birtist sem „Fjölpóstur · frá {unit}“.</p>
            </details>
            <details open>
              <summary>2. Viðtakendur {check(ready.audience)}</summary>
              <div class="aud">
                <h4>Félagar í einingum</h4>
                {isStaff(user) && <label class="check"><input type="checkbox" name="aud_all" value="1" checked={!!a.all} disabled={disabled} /> Allt HSK (allir tengiliðir)</label>}
                <input type="search" class="aud-search" placeholder="Leita að félagi" aria-label="Leita að félagi" />
                <div class="aud-tools"><button type="button" class="linklike" data-aud-all>Allir</button> · <button type="button" class="linklike" data-aud-none>Fjarlægja</button></div>
                <div class="aud-list">
                  {clubs.map((cl) => <label class="check" data-name={cl.name.toLowerCase()}><input type="checkbox" name="aud_clubs" value={String(cl.id)} checked={a.clubs?.includes(cl.id)} disabled={disabled} /> {cl.name}</label>)}
                </div>
                <h4>Stjórnarfólk og hlutverk</h4>
                <div class="aud-inline">{Object.entries(KINDS).map(([v, l]) => <label class="check"><input type="checkbox" name="aud_kinds" value={v} checked={a.kinds?.includes(v)} disabled={disabled} /> {l}</label>)}</div>
                <details class="aud-more"><summary>Eftir svæði</summary>
                  <div class="aud-inline">{AREAS.map((v) => <label class="check"><input type="checkbox" name="aud_areas" value={v} checked={a.areas?.includes(v)} disabled={disabled} /> {v}</label>)}</div>
                </details>
                <details class="aud-more"><summary>Opna síu: íþróttagrein, nýir, opnuðu ekki</summary>
                  <div class="aud-inline">{SPORTS.map((v) => <label class="check"><input type="checkbox" name="aud_sports" value={v} checked={a.sports?.includes(v)} disabled={disabled} /> {v}</label>)}</div>
                  <label class="small">Nýir tengiliðir
                    <select name="aud_newdays" disabled={disabled}><option value="">Allir</option>{[7, 30, 90, 365].map((d) => <option value={String(d)} selected={a.newDays === d}>Skráðir síðustu {d} daga</option>)}</select>
                  </label>
                  <label class="small">Opnuðu ekki fyrri póst
                    <select name="aud_notopened" disabled={disabled}><option value="">—</option>{prior.map((p) => <option value={String(p.id)} selected={a.notOpened === p.id}>{p.subject} ({dateLong(p.sent_at)})</option>)}</select>
                  </label>
                </details>
                <p class="aud-count" data-aud-count role="status">{audienceEmpty(a) ? 'Enginn hópur valinn' : `${fmtNum(counts.total)} í hópi · ${fmtNum(counts.sendable)} hægt að senda á`}</p>
                <p class="small"><a href={`/stjorn/samskipti/${k.id}/vidtakendur.csv`} data-aud-csv>Sækja lista (CSV)</a></p>
              </div>
            </details>
            <details open>
              <summary>3. Efnislína {check(ready.subject)}</summary>
              <input name="subject" value={k.subject} placeholder="Efnislína" aria-label="Efnislína" disabled={disabled} />
            </details>
            <details open>
              <summary>4. Prufupóstur {check(ready.test)}</summary>
              <p class="small">Sendu prufupóst, opnaðu hann og smelltu á hlekkina áður en hann fer á alla.</p>
              <textarea name="test_emails" rows={2} placeholder="Allt að 5 netföng" aria-label="Netföng fyrir prufupóst">{user.email}</textarea>
              <button class="btn small ghost" formaction={`/stjorn/samskipti/${k.id}/prufa`} disabled={disabled}>Senda prufupóst</button>
              {k.test_sent_at && <p class="muted small">Prufa send {dateTime(k.test_sent_at)}.</p>}
            </details>
            <details open>
              <summary>5. Senda</summary>
              <label class="check"><input type="radio" name="when" value="now" checked /> Senda núna</label>
              <label class="check"><input type="radio" name="when" value="later" /> Tímasetja</label>
              <input type="datetime-local" name="scheduled_at" aria-label="Sendingartími" />
              <button class="btn" formaction={`/stjorn/samskipti/${k.id}/senda`} disabled={disabled || !(ready.audience && ready.subject && ready.test)} data-send
                data-confirm-click={`Senda á ${counts.sendable} viðtakendur?`}>{needsApproval ? 'Senda til samþykktar' : `Senda á ${fmtNum(counts.sendable)} viðtakendur`}</button>
              {!(ready.audience && ready.subject && ready.test) && <p class="muted small">Ljúktu skrefum 1–4 fyrst.</p>}
              {needsApproval && <p class="muted small">Útsendingar félaga á fleiri en {APPROVAL_LIMIT} fara í samþykkt hjá HSK.</p>}
            </details>
            <details>
              <summary>Aukastillingar</summary>
              <label class="small">Svarnetfang<input name="reply_to" type="email" value={k.reply_to} placeholder="Sjálfgefið: ekki hægt að svara" disabled={disabled} /></label>
              <label class="check"><input type="checkbox" name="track_clicks" value="1" checked={!!k.track_clicks} disabled={disabled} /> Mæla smelli á hlekki</label>
            </details>
          </aside>
        </div>
      </form>
    ));
  });

  // Sjálfvirk vistun úr ritlinum
  app.post('/:id{[0-9]+}/vista', async (c) => {
    const k = await load(c);
    if (!k || !editable(k)) return c.json({ error: 'Ekki hægt að breyta' }, 400);
    const { counts, audience } = await save(c, k, await c.req.formData());
    const now = new Date();
    return c.json({ saved: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`, total: counts.total, sendable: counts.sendable, empty: audienceEmpty(audience) });
  });

  app.get('/:id{[0-9]+}/forskodun', async (c) => {
    const k = await load(c);
    if (!k) return c.notFound();
    return c.html(await emailHtml(c.env, k, await senderName(c.env.DB, k.sender_club_id), '#'));
  });

  app.get('/:id{[0-9]+}/vidtakendur.csv', async (c) => {
    const k = await load(c);
    if (!k) return c.notFound();
    const people = await resolveAudience(c.env.DB, parseAudience(k.audience), k.sender_club_id);
    const csv = ['Nafn;Netfang;Hægt að senda;Ástæða', ...people.map((p) => { const r = skipReason(p); return [p.name, p.email, r ? 'Nei' : 'Já', r ? REASONS[r] : ''].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';'); })].join('\n');
    return c.body('﻿' + csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vidtakendur-${k.id}.csv"` });
  });

  const back = (c: Context<AppEnv>, id: number, m: string, err = false) => c.redirect(`/stjorn/samskipti/${id}?${err ? 'villa' : 'm'}=${encodeURIComponent(m)}`);

  app.post('/:id{[0-9]+}/prufa', async (c) => {
    const k = await load(c);
    if (!k) return c.notFound();
    const f = await c.req.formData();
    if (editable(k)) await save(c, k, f);
    const fresh = (await one<Campaign>(c.env.DB, 'SELECT * FROM campaigns WHERE id = ?', k.id))!;
    if (!fresh.subject) return back(c, k.id, 'Settu inn efnislínu áður en prufupóstur er sendur.', true);
    const emails = String(f.get('test_emails') || '').split(/[\s,;]+/).filter(Boolean);
    if (!emails.length) return back(c, k.id, 'Settu inn netfang fyrir prufupóstinn.', true);
    const r = await sendTest(c.env, fresh, emails);
    if (!r.ok) return back(c, k.id, r.errors.join(' ') || 'Prufupóstur sendist ekki.', true);
    await run(c.env.DB, "UPDATE campaigns SET test_sent_at = datetime('now') WHERE id = ?", k.id);
    return back(c, k.id, `Prufupóstur sendur á ${r.ok} netfang${r.ok === 1 ? '' : 'a'}.${r.errors.length ? ' Villur: ' + r.errors.join(', ') : ''}`);
  });

  app.post('/:id{[0-9]+}/senda', async (c) => {
    const user = c.get('user')!;
    const k = await load(c);
    if (!k || !editable(k)) return c.notFound();
    const f = await c.req.formData();
    const { counts } = await save(c, k, f);
    const fresh = (await one<Campaign>(c.env.DB, 'SELECT * FROM campaigns WHERE id = ?', k.id))!;
    if (!counts.sendable) return back(c, k.id, 'Enginn viðtakandi sem hægt er að senda á.', true);
    if (!fresh.subject) return back(c, k.id, 'Efnislínu vantar.', true);
    if (!fresh.test_sent_at) return back(c, k.id, 'Sendu prufupóst fyrst.', true);
    if (!mailReady(c.env)) return back(c, k.id, 'Póstþjónusta (Postmark) er ekki tengd. Ekki er hægt að senda.', true);
    if (!isStaff(user) && counts.sendable > APPROVAL_LIMIT) {
      await run(c.env.DB, "UPDATE campaigns SET status = 'bidur_samthykktar', scheduled_at = ?, updated_at = datetime('now') WHERE id = ?",
        f.get('when') === 'later' && f.get('scheduled_at') ? String(f.get('scheduled_at')).replace('T', ' ') + ':00' : null, k.id);
      return back(c, k.id, 'Útsendingin bíður samþykktar starfsfólks HSK.');
    }
    if (f.get('when') === 'later') {
      const at = String(f.get('scheduled_at') || '');
      if (!at) return back(c, k.id, 'Veldu tíma fyrir tímasetta sendingu.', true);
      await run(c.env.DB, "UPDATE campaigns SET status = 'timasett', scheduled_at = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?", at.replace('T', ' ') + ':00', user.id, k.id);
      return back(c, k.id, `Útsending tímasett ${dateTime(at.replace('T', ' '))}.`);
    }
    await queueCampaign(c.env, k.id);
    c.executionCtx.waitUntil(processQueue(c.env));
    return c.redirect(`/stjorn/samskipti/${k.id}/nidurstodur`);
  });

  app.post('/:id{[0-9]+}/samthykkja', async (c) => {
    const user = c.get('user')!;
    if (!isStaff(user)) return c.text('Þú hefur ekki aðgang að þessu.', 403);
    const k = await load(c);
    if (!k || k.status !== 'bidur_samthykktar') return c.notFound();
    if (!mailReady(c.env)) return back(c, k.id, 'Póstþjónusta (Postmark) er ekki tengd.', true);
    await run(c.env.DB, 'UPDATE campaigns SET approved_by = ? WHERE id = ?', user.id, k.id);
    if (k.scheduled_at && k.scheduled_at > nowIso().replace('T', ' ').slice(0, 19)) {
      await run(c.env.DB, "UPDATE campaigns SET status = 'timasett' WHERE id = ?", k.id);
      return back(c, k.id, 'Samþykkt og tímasett.');
    }
    await queueCampaign(c.env, k.id);
    c.executionCtx.waitUntil(processQueue(c.env));
    return c.redirect(`/stjorn/samskipti/${k.id}/nidurstodur`);
  });

  app.post('/:id{[0-9]+}/haetta', async (c) => {
    const k = await load(c);
    if (!k || k.status !== 'timasett') return c.notFound();
    await run(c.env.DB, "UPDATE campaigns SET status = 'drog', scheduled_at = NULL WHERE id = ?", k.id);
    return back(c, k.id, 'Hætt við tímasetningu. Útsendingin er aftur í drögum.');
  });

  async function copy(c: Context<AppEnv>, k: Campaign, opts: { template?: boolean; audience?: Audience; parent?: number; description?: string }) {
    const user = c.get('user')!;
    const r = await run(c.env.DB,
      `INSERT INTO campaigns (is_template, internal_name, sender_club_id, subject, header_image, body_html, reply_to, track_clicks, audience, parent_id, description, created_by, owner_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      opts.template ? 1 : 0, opts.template ? `Sniðmát: ${k.internal_name || k.subject}` : (k.internal_name ? `${k.internal_name} (afrit)` : ''),
      isStaff(user) ? k.sender_club_id : user.club_id, k.subject, k.header_image, k.body_html, k.reply_to, k.track_clicks,
      JSON.stringify(opts.audience ?? (opts.template ? {} : parseAudience(k.audience))), opts.parent ?? null, opts.description ?? '', user.id, user.id);
    return Number(r.meta.last_row_id);
  }

  app.post('/:id{[0-9]+}/afrita', async (c) => {
    const k = await load(c);
    if (!k) return c.notFound();
    if (editable(k)) await save(c, k, await c.req.formData());
    const fresh = (await one<Campaign>(c.env.DB, 'SELECT * FROM campaigns WHERE id = ?', k.id))!;
    return c.redirect(`/stjorn/samskipti/${await copy(c, fresh, {})}?m=${encodeURIComponent('Afrit búið til.')}`);
  });

  app.post('/:id{[0-9]+}/snidmat', async (c) => {
    const k = await load(c);
    if (!k || !isStaff(c.get('user')!)) return c.notFound();
    if (editable(k)) await save(c, k, await c.req.formData());
    const fresh = (await one<Campaign>(c.env.DB, 'SELECT * FROM campaigns WHERE id = ?', k.id))!;
    await copy(c, fresh, { template: true });
    return back(c, k.id, 'Vistað sem sniðmát. Það birtist í „Byrja á eldri pósti eða sniðmáti“.');
  });

  app.post('/:id{[0-9]+}/byrja', async (c) => {
    const k = await load(c);
    if (!k || !editable(k)) return c.notFound();
    const f = await c.req.formData();
    await save(c, k, f);
    const src = await one<Campaign>(c.env.DB, 'SELECT * FROM campaigns WHERE id = ?', Number(f.get('source')));
    if (!src) return back(c, k.id, 'Veldu póst eða sniðmát.', true);
    await run(c.env.DB, "UPDATE campaigns SET subject = ?, header_image = ?, body_html = ?, updated_at = datetime('now') WHERE id = ?", src.subject, src.header_image, src.body_html, k.id);
    return back(c, k.id, 'Efni sótt. Fylltu inn í hornklofana, t.d. [Dagsetning].');
  });

  app.post('/:id{[0-9]+}/eyda', async (c) => {
    const k = await load(c);
    if (!k || k.status === 'i_sendingu') return c.notFound();
    await run(c.env.DB, "UPDATE campaigns SET deleted_at = datetime('now'), status = CASE WHEN status = 'timasett' THEN 'drog' ELSE status END WHERE id = ?", k.id);
    return c.redirect('/stjorn/samskipti?tab=rusl');
  });

  app.post('/:id{[0-9]+}/taka', async (c) => {
    const user = c.get('user')!;
    const k = await load(c);
    if (!k || !isStaff(user)) return c.notFound();
    await run(c.env.DB, 'UPDATE campaigns SET owner_id = ? WHERE id = ?', user.id, k.id);
    return back(c, k.id, 'Þú ert nú eigandi útsendingarinnar.');
  });

  // ---------- Niðurstöður ----------
  app.get('/:id{[0-9]+}/nidurstodur', async (c) => {
    const db = c.env.DB;
    const k = await load(c);
    if (!k) return c.notFound();
    const s = await one<{ total: number; skipped: number; queued: number; sent: number; delivered: number; failed: number; opened: number }>(db,
      `SELECT count(*) AS total, sum(status = 'skipped') AS skipped, sum(status = 'queued') AS queued, sum(status = 'sent') AS sent,
              sum(status = 'delivered') AS delivered, sum(status = 'failed') AS failed, sum(opened_at IS NOT NULL) AS opened
       FROM campaign_recipients WHERE campaign_id = ?`, k.id);
    const total = s?.total ?? 0, sendable = total - (s?.skipped ?? 0), delivered = s?.delivered ?? 0;
    const reasons = await all<{ reason: string; n: number }>(db,
      "SELECT reason, count(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND status IN ('skipped', 'failed') GROUP BY reason ORDER BY n DESC", k.id);
    const names = await all<{ reason: string; name: string; email: string }>(db,
      "SELECT reason, name, email FROM campaign_recipients WHERE campaign_id = ? AND status IN ('skipped', 'failed') ORDER BY name LIMIT 2000", k.id);
    const links = await all<{ url: string; n: number; people: number }>(db,
      'SELECT url, count(*) AS n, count(DISTINCT recipient_id) AS people FROM campaign_clicks WHERE campaign_id = ? GROUP BY url ORDER BY n DESC', k.id);
    const creator = k.created_by ? await one<{ name: string; email: string }>(db, 'SELECT name, email FROM users WHERE id = ?', k.created_by) : null;
    const unit = await senderName(db, k.sender_club_id);
    const notOpened = Math.max(0, delivered - (s?.opened ?? 0));
    return page(c, `Niðurstöður: ${k.subject}`, 'samskipti', (
      <>
        <p class="crumbs"><a href="/stjorn/samskipti">Samskipti</a> / {k.internal_name || k.subject}</p>
        {c.req.query('m') && <div class="flash ok" role="status">{c.req.query('m')}</div>}
        <h1>{k.subject}</h1>
        <p class="lead">{k.status === 'i_sendingu' ? `Í sendingu: ${fmtNum(s?.queued ?? 0)} eftir í biðröð.` : `Sent á ${fmtNum(sendable)} viðtakendur ${dateTime(k.sent_at)}.`}</p>
        <div class="kpi-row">
          <div class="kpi"><span>Afhent</span><strong>{fmtNum(delivered)}</strong><small>{pct(delivered, sendable)}% af þeim sem hægt var að senda á</small></div>
          <div class="kpi"><span>Mistókst</span><strong>{fmtNum(s?.failed ?? 0)}</strong><small>{fmtNum(s?.skipped ?? 0)} að auki ekki sent</small></div>
          <div class="kpi"><span>Opnað</span><strong>{pct(s?.opened ?? 0, delivered)}%</strong><small>{fmtNum(s?.opened ?? 0)} af {fmtNum(delivered)} afhentum</small></div>
          <div class="kpi"><span>Smellir</span><strong>{fmtNum(links.reduce((x, l) => x + l.n, 0))}</strong><small>á {links.length} hlekki</small></div>
        </div>
        {links.length > 0 && (
          <section class="panel"><h2>Smellir á hlekki</h2>
            <table class="list"><thead><tr><th>Hlekkur</th><th>Smellir</th><th>Fólk</th></tr></thead>
              <tbody>{links.map((l) => <tr><td><a href={l.url} target="_blank" rel="noopener">{l.url}</a></td><td>{fmtNum(l.n)}</td><td>{fmtNum(l.people)}</td></tr>)}</tbody></table>
          </section>
        )}
        <section class="panel">
          <h2>Hverjir fengu ekki skilaboðin?</h2>
          {!reasons.length ? <p class="muted">Allir sem hægt var að senda á fengu póstinn{k.status === 'i_sendingu' ? ' hingað til' : ''}.</p> : reasons.map((r) => (
            <details class="reason">
              <summary><strong>{REASONS[r.reason] ?? REASONS.villa}</strong> · {fmtNum(r.n)} · Sýna nöfn</summary>
              <ul>{names.filter((x) => x.reason === r.reason).map((x) => <li>{x.name || '(nafn vantar)'}{x.email && ` – ${x.email}`}</li>)}</ul>
            </details>
          ))}
        </section>
        {k.status === 'sent' && notOpened > 0 && (
          <section class="panel">
            <h2>Framhaldsútsending</h2>
            <p class="muted">Búa til ný drög með sama efni á þá {fmtNum(notOpened)} sem fengu póstinn en opnuðu hann ekki. Drögin eru ekki send héðan.</p>
            <form method="post" action={`/stjorn/samskipti/${k.id}/framhald`}><button class="btn ghost">Búa til framhaldsútsendingu</button></form>
          </section>
        )}
        <section class="panel">
          <h2>Innihald</h2>
          <p><strong>Sendandi:</strong> Fjölpóstur · frá {unit}<br /><strong>Efnislína:</strong> {k.subject}</p>
          <iframe class="camp-preview" title="Innihald" src={`/stjorn/samskipti/${k.id}/forskodun`}></iframe>
        </section>
        <section class="panel">
          <h2>Upplýsingar</h2>
          <dl class="facts">
            <dt>Viðtakendur</dt><dd>{fmtNum(total)}</dd>
            <dt>Hægt að senda á</dt><dd>{fmtNum(sendable)}</dd>
            <dt>Stofnað</dt><dd>{dateTime(k.created_at)}</dd>
            <dt>Stofnandi</dt><dd>{creator ? (creator.name || creator.email) : '—'}</dd>
            <dt>Sent</dt><dd>{k.sent_at ? dateTime(k.sent_at) : '—'}</dd>
            <dt>Eining</dt><dd>{unit}</dd>
          </dl>
        </section>
      </>
    ));
  });

  app.post('/:id{[0-9]+}/framhald', async (c) => {
    const k = await load(c);
    if (!k || k.status !== 'sent') return c.notFound();
    const id = await copy(c, k, { audience: { notOpened: k.id }, parent: k.id, description: 'Þeir sem opnuðu ekki fyrri póst' });
    return c.redirect(`/stjorn/samskipti/${id}?m=${encodeURIComponent('Framhaldsútsending búin til á þá sem opnuðu ekki. Farðu yfir efnið og sendu prufupóst.')}`);
  });

  return app;
}
