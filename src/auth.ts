import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { type AppEnv, type Env, type User, type Role, one, run, nowIso } from './lib';

const SESSION_COOKIE = 'hsk_sess';
const SESSION_DAYS = 30;
const TOKEN_MINUTES = 20;

function randomId(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function isoIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Hver má skrá sig inn?
 * - Netföng í ADMIN_EMAILS verða stjórnendur.
 * - Netföng á léni starfsfólks (@hsk.is) fá ritstjóraaðgang sjálfkrafa.
 * - Aðrir (t.d. Gmail hjá formönnum) aðeins ef stjórnandi hefur boðið þeim.
 */
export async function resolveLoginUser(env: Env, rawEmail: string, create = true): Promise<User | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const existing = await one<User & { active: number }>(env.DB, 'SELECT id, email, name, role, club_id, active FROM users WHERE email = ?', email);
  const admins = (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isStaff = !!env.STAFF_DOMAIN && email.endsWith('@' + env.STAFF_DOMAIN.toLowerCase());
  if (existing) {
    if (!existing.active) return null;
    if (create && admins.includes(email) && existing.role !== 'admin') {
      await run(env.DB, "UPDATE users SET role = 'admin' WHERE id = ?", existing.id);
      existing.role = 'admin';
    }
    return existing;
  }
  let role: Role | null = null;
  if (admins.includes(email)) role = 'admin';
  else if (isStaff) role = 'editor';
  if (!role) return null;
  if (!create) return { id: 0, email, name: '', role, club_id: null };
  const r = await run(env.DB, 'INSERT INTO users (email, name, role) VALUES (?, ?, ?)', email, email.split('@')[0], role);
  return { id: Number(r.meta.last_row_id), email, name: email.split('@')[0], role, club_id: null };
}

export async function createLoginToken(env: Env, email: string): Promise<string> {
  const token = randomId();
  await run(env.DB, 'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)', await sha256(token), email.toLowerCase(), isoIn(TOKEN_MINUTES));
  return token;
}

export async function consumeLoginToken(env: Env, token: string): Promise<string | null> {
  const hash = await sha256(token);
  const row = await one<{ email: string; expires_at: string; used: number }>(env.DB, 'SELECT email, expires_at, used FROM login_tokens WHERE token_hash = ?', hash);
  if (!row || row.used || row.expires_at < nowIso()) return null;
  await run(env.DB, 'UPDATE login_tokens SET used = 1 WHERE token_hash = ?', hash);
  return row.email;
}

export async function startSession(c: Context<AppEnv>, user: User) {
  const id = randomId();
  await run(c.env.DB, 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', await sha256(id), user.id, isoIn(SESSION_DAYS * 24 * 60));
  await run(c.env.DB, "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
    secure: c.env.SITE_URL.startsWith('https'),
  });
}

export async function endSession(c: Context<AppEnv>) {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await run(c.env.DB, 'DELETE FROM sessions WHERE id = ?', await sha256(id));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** Les notanda úr setu (ef einhver er) */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = getCookie(c, SESSION_COOKIE);
  let user: User | null = null;
  if (id) {
    user = await one<User>(c.env.DB,
      `SELECT u.id, u.email, u.name, u.role, u.club_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now') AND u.active = 1`, await sha256(id));
  }
  c.set('user', user);
  await next();
};

/** Krefst innskráningar í vefumsjón og verndar gegn CSRF */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user')) return c.redirect('/stjorn/innskraning');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.text('Ógild beiðni', 403);
  }
  await next();
};

export function can(user: User | null, action: 'admin' | 'staff' | 'club'): boolean {
  if (!user) return false;
  if (action === 'admin') return user.role === 'admin';
  if (action === 'staff') return user.role === 'admin' || user.role === 'editor';
  return true;
}

// ---------- Innskráning með Google ----------

export function googleEnabled(env: Env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(env: Env, state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.SITE_URL}/stjorn/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Skiptir kóða fyrir netfang. Svarið kemur beint frá Google yfir TLS með leynilykli, svo id_token er treyst. */
export async function googleEmailFromCode(env: Env, code: string): Promise<{ email: string; name: string } | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${env.SITE_URL}/stjorn/google/callback`, grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return null;
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) return null;
  const payload = JSON.parse(atob(id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (!payload.email || !payload.email_verified || payload.aud !== env.GOOGLE_CLIENT_ID) return null;
  return { email: String(payload.email).toLowerCase(), name: String(payload.name || '') };
}

export { randomId };
