// Samskipti: val á viðtakendum, biðröð, sending í gegnum Postmark og vinnsla á stöðutilkynningum (webhooks)
import { type Env, all, one, run, getSetting } from './lib';

export type Audience = {
  all?: boolean;           // allir tengiliðir (innan einingar sendanda ef félag sendir)
  clubs?: number[];        // tengiliðir þessara félaga
  kinds?: string[];        // hlutverk: formadur, stjorn, thjalfari, forradamadur, felagi, annad
  areas?: string[];        // sveitarfélag félags
  sports?: string[];       // íþróttagrein félags
  notOpened?: number;      // aðeins þeir sem fengu útsendingu X en opnuðu ekki
  newDays?: number;        // aðeins tengiliðir skráðir síðustu N daga
};

export type Campaign = {
  id: number; type: string; status: string; is_template: number; internal_name: string; notes: string; description: string;
  sender_club_id: number | null; subject: string; header_image: string; body_html: string; reply_to: string; track_clicks: number;
  audience: string; test_sent_at: string | null; scheduled_at: string | null; sent_at: string | null;
  recipient_count: number; sendable_count: number; parent_id: number | null; created_by: number | null; owner_id: number | null;
  approved_by: number | null; created_at: string; updated_at: string; deleted_at: string | null;
};

export const KINDS: Record<string, string> = {
  formadur: 'Formaður', stjorn: 'Stjórnarmaður', thjalfari: 'Þjálfari', forradamadur: 'Forráðamaður', felagi: 'Félagi', annad: 'Annað',
};

export const STATUS: Record<string, string> = {
  drog: 'Drög', bidur_samthykktar: 'Bíður samþykktar', timasett: 'Tímasett', i_sendingu: 'Í sendingu', sent: 'Sent', rusl: 'Rusl',
};

/** Fastar ástæður fyrir því að viðtakandi fékk ekki póst. Hrátt villuboð er aldrei notað til flokkunar. */
export const REASONS: Record<string, string> = {
  ekkert_netfang: 'Ekkert netfang',
  ogilt_netfang: 'Ógilt netfang',
  afthakkad: 'Hefur afþakkað',
  ovirkt: 'Óvirkt netfang (skopp eða ruslpóstskvörtun)',
  villa: 'Óþekkt villa',
};

/** Útsendingar yfir þessum fjölda frá aðildarfélagi fara í samþykkt hjá starfsfólki HSK */
export const APPROVAL_LIMIT = 150;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseAudience(s: string | null | undefined): Audience {
  try { return JSON.parse(s || '{}') as Audience; } catch { return {}; }
}

export function audienceEmpty(a: Audience): boolean {
  return !a.all && !a.clubs?.length && !a.kinds?.length && !a.areas?.length && !a.sports?.length && !a.notOpened;
}

type Person = { contact_id: number; name: string; email: string; unsubscribed_at: string | null; suppressed: string | null };

/** Tengiliðir sem passa við hópinn. senderClub takmarkar við eigið félag þegar aðildarfélag sendir. */
export async function resolveAudience(db: D1Database, a: Audience, senderClub: number | null): Promise<Person[]> {
  if (audienceEmpty(a)) return [];
  const where: string[] = [];
  const p: unknown[] = [];
  if (senderClub) { where.push('c.club_id = ?'); p.push(senderClub); }
  if (!a.all && a.clubs?.length) { where.push(`c.club_id IN (${a.clubs.map(() => '?').join(',')})`); p.push(...a.clubs); }
  if (a.kinds?.length) { where.push(`c.kind IN (${a.kinds.map(() => '?').join(',')})`); p.push(...a.kinds); }
  if (a.areas?.length) { where.push(`(${a.areas.map(() => "(', ' || cl.area || ', ') LIKE ?").join(' OR ')})`); p.push(...a.areas.map((x) => `%, ${x}, %`)); }
  if (a.sports?.length) { where.push(`(${a.sports.map(() => "(', ' || cl.sports || ', ') LIKE ?").join(' OR ')})`); p.push(...a.sports.map((x) => `%, ${x}, %`)); }
  if (a.newDays) { where.push("c.created_at >= datetime('now', ?)"); p.push(`-${Math.max(1, a.newDays)} days`); }
  if (a.notOpened) {
    where.push("lower(c.email) IN (SELECT lower(email) FROM campaign_recipients WHERE campaign_id = ? AND status IN ('sent', 'delivered') AND opened_at IS NULL)");
    p.push(a.notOpened);
  }
  const rows = await all<Person>(db,
    `SELECT c.id AS contact_id, c.name, c.email, c.unsubscribed_at, s.reason AS suppressed
     FROM contacts c LEFT JOIN clubs cl ON cl.id = c.club_id LEFT JOIN suppressions s ON s.email = c.email
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name`, ...p);
  // Sami einstaklingur getur verið skráður í fleiri en eitt félag: einn póstur á hvert netfang
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = r.email.trim().toLowerCase() || `#${r.contact_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Hvort hægt sé að senda á tengilið, og annars hvers vegna ekki (staðlaður kóði) */
export function skipReason(p: Person): string {
  if (!p.email.trim()) return 'ekkert_netfang';
  if (!EMAIL_RE.test(p.email.trim())) return 'ogilt_netfang';
  if (p.unsubscribed_at) return 'afthakkad';
  if (p.suppressed) return 'ovirkt';
  return '';
}

export async function audienceCounts(db: D1Database, a: Audience, senderClub: number | null) {
  const people = await resolveAudience(db, a, senderClub);
  return { total: people.length, sendable: people.filter((x) => !skipReason(x)).length };
}

// ---------- Afskráning: undirritað tákn, engin innskráning ----------

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(env: Env, msg: string): Promise<string> {
  const secret = env.UNSUBSCRIBE_SECRET || env.LOGIN_KEY || env.POSTMARK_WEBHOOK_KEY || 'hsk-afskraning';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))).slice(0, 22);
}

export async function unsubscribeToken(env: Env, email: string, campaignId: number): Promise<string> {
  const payload = b64url(new TextEncoder().encode(`${email.toLowerCase()}|${campaignId}`));
  return `${payload}.${await hmac(env, payload)}`;
}

export async function readUnsubscribeToken(env: Env, token: string): Promise<{ email: string; campaignId: number } | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || sig !== await hmac(env, payload)) return null;
  try {
    const raw = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const text = new TextDecoder().decode(Uint8Array.from(raw, (ch) => ch.charCodeAt(0)));
    const [email, id] = text.split('|');
    return email ? { email, campaignId: Number(id) || 0 } : null;
  } catch { return null; }
}

export async function unsubscribe(db: D1Database, email: string, campaignId: number) {
  const already = await one<{ n: number }>(db, 'SELECT count(*) AS n FROM contacts WHERE email = ? AND unsubscribed_at IS NULL', email);
  await run(db, "UPDATE contacts SET unsubscribed_at = datetime('now') WHERE email = ? AND unsubscribed_at IS NULL", email);
  if (already?.n) await run(db, 'INSERT INTO unsubscribes (email, campaign_id) VALUES (?, ?)', email, campaignId || null);
}

// ---------- Efni póstsins ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export async function senderName(db: D1Database, clubId: number | null): Promise<string> {
  if (!clubId) return 'HSK';
  return (await one<{ name: string }>(db, 'SELECT name FROM clubs WHERE id = ?', clubId))?.name ?? 'HSK';
}

/** HTML póstsins: hausmynd, meginmál og fastur fótur með afskráningartengli */
export async function emailHtml(env: Env, c: Campaign, unit: string, unsubUrl: string): Promise<string> {
  const site = env.SITE_URL.replace(/\/$/, '');
  const abs = (h: string) => h.replace(/(src|href)="\/(?!\/)/g, `$1="${site}/`);
  const address = await getSetting(env.DB, 'contact_address', '');
  const unitText = unit === 'HSK' ? 'HSK' : `${unit} innan HSK`;
  const header = c.header_image
    ? `<tr><td><img src="${esc(c.header_image.startsWith('/') ? site + c.header_image : c.header_image)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border-radius:8px 8px 0 0"></td></tr>`
    : `<tr><td style="background:#01279a;color:#ffffff;padding:18px 28px;font-weight:bold;font-size:17px;border-radius:8px 8px 0 0">${esc(unit === 'HSK' ? 'Héraðssambandið Skarphéðinn' : unit)}</td></tr>`;
  return `<!doctype html><html lang="is"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.subject)}</title>
<style>.body p{margin:0 0 14px}.body img{max-width:100%;height:auto}.body a{color:#01279a}.body h2,.body h3{margin:18px 0 10px;color:#16203f}</style></head>
<body style="margin:0;background:#f2f5fb;font-family:Arial,Helvetica,sans-serif;color:#16203f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e3e8f2;border-radius:8px">
${header}
<tr><td class="body" style="padding:26px 28px;font-size:16px;line-height:1.55">${abs(c.body_html)}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="padding:16px 28px;font-size:12px;line-height:1.5;color:#5b6582;text-align:center">
Þú færð þennan póst því þú ert skráð/ur á póstlista ${esc(unitText)}.<br>
${address ? esc(`Héraðssambandið Skarphéðinn · ${address}`) + '<br>' : ''}
<a href="${esc(unsubUrl)}" style="color:#5b6582">Afskrá af póstlista</a>
</td></tr></table>
</td></tr></table></body></html>`;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|h[1-6]|li|div)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Sending ----------

export function mailReady(env: Env): 'postmark' | 'dev' | null {
  if (env.POSTMARK_SERVER_TOKEN && env.EMAIL_FROM) return 'postmark';
  if (env.DEV_LOGIN_LINKS === 'true') return 'dev';
  return null;
}

type PostmarkMessage = Record<string, unknown>;
type PostmarkResult = { ErrorCode: number; Message: string; MessageID?: string; To?: string };

async function postmarkBatch(env: Env, messages: PostmarkMessage[]): Promise<PostmarkResult[]> {
  const res = await fetch('https://api.postmarkapp.com/email/batch', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN! },
    body: JSON.stringify(messages),
  });
  if (!res.ok) throw new Error(`Postmark ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Villukóðar Postmark → staðlaðar ástæður */
function reasonFromPostmark(code: number): string {
  if (code === 406) return 'ovirkt';      // Inactive recipient (skopp eða kvörtun áður)
  if (code === 300) return 'ogilt_netfang';
  return 'villa';
}

async function buildMessage(env: Env, c: Campaign, unit: string, to: { name: string; email: string }, opts: { test?: boolean; recipientId?: number } = {}): Promise<PostmarkMessage> {
  const token = await unsubscribeToken(env, to.email, opts.test ? 0 : c.id);
  const unsubUrl = `${env.SITE_URL.replace(/\/$/, '')}/afskra?t=${token}`;
  const html = await emailHtml(env, c, unit, unsubUrl);
  const footer = `\n\n—\nÞú færð þennan póst því þú ert skráð/ur á póstlista ${unit === 'HSK' ? 'HSK' : unit + ' innan HSK'}.\nAfskrá af póstlista: ${unsubUrl}`;
  return {
    From: `${unit} <${env.EMAIL_FROM}>`,
    To: to.name ? `"${to.name.replace(/"/g, '')}" <${to.email}>` : to.email,
    Subject: (opts.test ? '[Prufa] ' : '') + c.subject,
    HtmlBody: html,
    TextBody: htmlToText(c.body_html) + footer,
    ReplyTo: c.reply_to || undefined,
    MessageStream: opts.test ? (env.POSTMARK_STREAM || 'outbound') : (env.POSTMARK_BROADCAST_STREAM || 'broadcast'),
    TrackOpens: !opts.test,
    TrackLinks: !opts.test && c.track_clicks ? 'HtmlAndText' : 'None',
    Headers: [
      { Name: 'List-Unsubscribe', Value: `<${unsubUrl}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ],
    Metadata: opts.test ? { prufa: '1' } : { campaign: String(c.id), recipient: String(opts.recipientId ?? '') },
  };
}

/** Prufupóstur á allt að 5 netföng */
export async function sendTest(env: Env, c: Campaign, emails: string[]): Promise<{ ok: number; errors: string[] }> {
  const mode = mailReady(env);
  if (!mode) return { ok: 0, errors: ['Póstþjónusta (Postmark) er ekki tengd.'] };
  const unit = await senderName(env.DB, c.sender_club_id);
  const valid = emails.map((e) => e.trim()).filter((e) => EMAIL_RE.test(e)).slice(0, 5);
  if (mode === 'dev') return { ok: valid.length, errors: [] };
  const results = await postmarkBatch(env, await Promise.all(valid.map((email) => buildMessage(env, c, unit, { name: '', email }, { test: true }))));
  return { ok: results.filter((r) => r.ErrorCode === 0).length, errors: results.filter((r) => r.ErrorCode !== 0).map((r) => `${r.To}: ${r.Message}`) };
}

/** Býr til viðtakendalista útsendingar og setur hana í sendingu */
export async function queueCampaign(env: Env, id: number) {
  const c = await one<Campaign>(env.DB, 'SELECT * FROM campaigns WHERE id = ?', id);
  if (!c) return;
  const existing = await one<{ n: number }>(env.DB, 'SELECT count(*) AS n FROM campaign_recipients WHERE campaign_id = ?', id);
  if (!existing?.n) {
    const people = await resolveAudience(env.DB, parseAudience(c.audience), c.sender_club_id);
    const stmts = people.map((p) => {
      const reason = skipReason(p);
      return env.DB.prepare('INSERT INTO campaign_recipients (campaign_id, contact_id, name, email, status, reason) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, p.contact_id, p.name, p.email.trim(), reason ? 'skipped' : 'queued', reason);
    });
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    await run(env.DB, 'UPDATE campaigns SET recipient_count = ?, sendable_count = ? WHERE id = ?',
      people.length, people.filter((p) => !skipReason(p)).length, id);
  }
  await run(env.DB, "UPDATE campaigns SET status = 'i_sendingu', updated_at = datetime('now') WHERE id = ?", id);
}

/** Sendir næstu lotu úr biðröð (allt að 500 í hverri Postmark-beiðni). Kallað strax og á mínútu fresti (cron). */
export async function processQueue(env: Env, maxBatches = 4) {
  const mode = mailReady(env);
  if (!mode) return;
  // Tímasettar útsendingar sem komið er að
  const due = await all<{ id: number }>(env.DB, "SELECT id FROM campaigns WHERE status = 'timasett' AND scheduled_at <= datetime('now') AND deleted_at IS NULL");
  for (const d of due) await queueCampaign(env, d.id);
  for (let b = 0; b < maxBatches; b++) {
    const c = await one<Campaign>(env.DB, "SELECT * FROM campaigns WHERE status = 'i_sendingu' AND deleted_at IS NULL ORDER BY updated_at LIMIT 1");
    if (!c) return;
    const batch = await all<{ id: number; name: string; email: string }>(env.DB,
      "SELECT id, name, email FROM campaign_recipients WHERE campaign_id = ? AND status = 'queued' ORDER BY id LIMIT 500", c.id);
    if (!batch.length) {
      await run(env.DB, "UPDATE campaigns SET status = 'sent', sent_at = COALESCE(sent_at, datetime('now')), updated_at = datetime('now') WHERE id = ?", c.id);
      continue;
    }
    const unit = await senderName(env.DB, c.sender_club_id);
    const stmts: D1PreparedStatement[] = [];
    if (mode === 'dev') {
      // Þróun: enginn póstur fer út, en allt er merkt afhent svo hægt sé að prófa viðmótið
      for (const r of batch) stmts.push(env.DB.prepare("UPDATE campaign_recipients SET status = 'delivered', message_id = ?, sent_at = datetime('now'), delivered_at = datetime('now') WHERE id = ?").bind(`dev-${r.id}`, r.id));
    } else {
      let results: PostmarkResult[];
      try {
        results = await postmarkBatch(env, await Promise.all(batch.map((r) => buildMessage(env, c, unit, r, { recipientId: r.id }))));
      } catch (e) {
        console.error('Postmark lota mistókst', e);
        return; // reynt aftur í næstu keyrslu
      }
      batch.forEach((r, i) => {
        const res = results[i];
        if (res && res.ErrorCode === 0) stmts.push(env.DB.prepare("UPDATE campaign_recipients SET status = 'sent', message_id = ?, sent_at = datetime('now') WHERE id = ?").bind(res.MessageID ?? null, r.id));
        else stmts.push(env.DB.prepare("UPDATE campaign_recipients SET status = 'failed', reason = ?, raw_error = ? WHERE id = ?").bind(reasonFromPostmark(res?.ErrorCode ?? -1), res?.Message ?? 'Ekkert svar', r.id));
      });
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  }
}

/** Stöðutilkynningar frá Postmark: afhent, skopp, opnað, smellt, kvörtun, afskráning */
export async function handleWebhook(env: Env, e: Record<string, any>) {
  const db = env.DB;
  const mid = String(e.MessageID ?? '');
  switch (e.RecordType) {
    case 'Delivery':
      await run(db, "UPDATE campaign_recipients SET status = 'delivered', delivered_at = COALESCE(delivered_at, datetime('now')) WHERE message_id = ? AND status IN ('sent', 'delivered')", mid);
      break;
    case 'Bounce': {
      const hard = ['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated', 'SpamNotification', 'Blocked'].includes(String(e.Type));
      await run(db, "UPDATE campaign_recipients SET status = 'failed', reason = ?, raw_error = ? WHERE message_id = ?",
        hard ? 'ovirkt' : 'villa', `${e.Type ?? ''}: ${e.Description ?? ''}`.slice(0, 500), mid);
      if (hard && e.Email) await run(db, "INSERT OR IGNORE INTO suppressions (email, reason) VALUES (?, 'hard_bounce')", String(e.Email));
      break;
    }
    case 'SpamComplaint':
      await run(db, "UPDATE campaign_recipients SET status = 'failed', reason = 'ovirkt', raw_error = 'Ruslpóstskvörtun' WHERE message_id = ?", mid);
      if (e.Email) await run(db, "INSERT OR IGNORE INTO suppressions (email, reason) VALUES (?, 'complaint')", String(e.Email));
      break;
    case 'Open':
      await run(db, "UPDATE campaign_recipients SET opened_at = COALESCE(opened_at, datetime('now')), status = CASE WHEN status = 'sent' THEN 'delivered' ELSE status END WHERE message_id = ?", mid);
      break;
    case 'Click': {
      const r = await one<{ id: number; campaign_id: number }>(db, 'SELECT id, campaign_id FROM campaign_recipients WHERE message_id = ?', mid);
      if (r) {
        await run(db, 'INSERT INTO campaign_clicks (campaign_id, recipient_id, url) VALUES (?, ?, ?)', r.campaign_id, r.id, String(e.OriginalLink ?? ''));
        await run(db, "UPDATE campaign_recipients SET clicked_at = COALESCE(clicked_at, datetime('now')), opened_at = COALESCE(opened_at, datetime('now')) WHERE id = ?", r.id);
      }
      break;
    }
    case 'SubscriptionChange':
      if (e.SuppressSending && e.Recipient) {
        const r = await one<{ campaign_id: number }>(db, 'SELECT campaign_id FROM campaign_recipients WHERE message_id = ?', mid);
        await unsubscribe(db, String(e.Recipient), r?.campaign_id ?? 0);
      }
      break;
  }
}
