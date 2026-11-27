import type { Env } from './lib';

/**
 * Sendir tölvupóst með Cloudflare Email Service (binding "EMAIL").
 * Ef póstþjónusta er ekki stillt skilar fallið false, og í þróun birtist tengillinn þá á skjánum.
 */
export async function sendMail(env: Env, to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (!env.EMAIL || !env.EMAIL_FROM) {
    console.log(`[póstur ekki stilltur] Til: ${to} | ${subject}\n${text}`);
    return false;
  }
  try {
    await env.EMAIL.send({
      to,
      from: { email: env.EMAIL_FROM, name: 'Vefur HSK' },
      subject,
      text,
      html: html ?? `<p>${text.replace(/\n/g, '<br>')}</p>`,
    });
    return true;
  } catch (e) {
    console.error('Póstsending mistókst', e);
    return false;
  }
}

/** Lætur stjórnendur vita þegar formaður sendir inn efni til samþykktar */
export async function notifyAdmins(env: Env, subject: string, text: string) {
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE role = 'admin' AND active = 1").all<{ email: string }>();
  for (const r of results ?? []) await sendMail(env, r.email, subject, text);
}
