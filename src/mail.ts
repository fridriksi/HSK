import type { Env } from './lib';

const FROM_NAME = 'Vefur HSK';

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

/** Einfalt HTML-snið fyrir póst úr kerfinu: haus með heiti HSK og tenglar gerðir virkir */
function htmlFromText(text: string): string {
  const body = esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#01279a">$1</a>')}</p>`)
    .join('');
  return `<!doctype html><html lang="is"><body style="margin:0;background:#f6f8fc;font-family:Arial,Helvetica,sans-serif;color:#16203f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e8f2;border-radius:8px">
<tr><td style="background:#01279a;color:#ffffff;padding:16px 24px;font-weight:bold;font-size:16px;border-radius:8px 8px 0 0">Héraðssambandið Skarphéðinn</td></tr>
<tr><td style="padding:24px;font-size:15px">${body}</td></tr>
</table>
<p style="font-size:12px;color:#5b6582;margin:14px 0 0">Þessi póstur var sendur sjálfvirkt af vef HSK.</p>
</td></tr></table></body></html>`;
}

/**
 * Sendir tölvupóst úr kerfinu (boð, innskráningartenglar, tilkynningar).
 * Notar Postmark ef POSTMARK_SERVER_TOKEN er stillt, annars Resend (RESEND_API_KEY),
 * annars Cloudflare Email Service (binding "EMAIL").
 * Ef hvorugt er stillt skilar fallið false, og í þróun birtist tengillinn þá á skjánum.
 */
export async function sendMail(env: Env, to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const content = html ?? htmlFromText(text);
  if (env.POSTMARK_SERVER_TOKEN && env.EMAIL_FROM) {
    try {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN },
        body: JSON.stringify({ From: `${FROM_NAME} <${env.EMAIL_FROM}>`, To: to, Subject: subject, TextBody: text, HtmlBody: content, MessageStream: env.POSTMARK_STREAM || 'outbound' }),
      });
      if (!res.ok) {
        console.error('Póstsending (Postmark) mistókst', res.status, await res.text());
        return false;
      }
      return true;
    } catch (e) {
      console.error('Póstsending (Postmark) mistókst', e);
      return false;
    }
  }
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${FROM_NAME} <${env.EMAIL_FROM}>`, to: [to], subject, text, html: content }),
      });
      if (!res.ok) {
        console.error('Póstsending (Resend) mistókst', res.status, await res.text());
        return false;
      }
      return true;
    } catch (e) {
      console.error('Póstsending (Resend) mistókst', e);
      return false;
    }
  }
  if (env.EMAIL && env.EMAIL_FROM) {
    try {
      await env.EMAIL.send({ to, from: { email: env.EMAIL_FROM, name: FROM_NAME }, subject, text, html: content });
      return true;
    } catch (e) {
      console.error('Póstsending mistókst', e);
      return false;
    }
  }
  console.log(`[póstur ekki stilltur] Til: ${to} | ${subject}\n${text}`);
  return false;
}

/** Lætur stjórnendur vita þegar formaður sendir inn efni til samþykktar */
export async function notifyAdmins(env: Env, subject: string, text: string) {
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all<{ email: string }>();
  for (const r of results ?? []) await sendMail(env, r.email, subject, text);
}
