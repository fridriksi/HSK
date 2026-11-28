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

/** Innskráningartengill; gildir í TOKEN_MINUTES nema annað sé tekið fram (boð til nýrra notenda gilda lengur) */
export async function createLoginToken(env: Env, email: string, minutes = TOKEN_MINUTES): Promise<string> {
  const token = randomId();
  await run(env.DB, 'INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)', await sha256(token), email.toLowerCase(), isoIn(minutes));
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
export const VIEW_COOKIE = 'hsk_syn';

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = getCookie(c, SESSION_COOKIE);
  let user: User | null = null;
  if (id) {
    user = await one<User>(c.env.DB,
      `SELECT u.id, u.email, u.name, u.role, u.club_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now') AND u.active = 1`, await sha256(id));
  }
  // „Sýn“: stjórnandi getur skoðað vefumsjónina sem ritstjóri eða félagsaðgangur. Réttindi minnka aðeins;
  // notandinn er sá sami svo allar aðgerðir eru áfram skráðar á stjórnandann.
  const view = getCookie(c, VIEW_COOKIE);
  if (user?.role === 'admin' && view) {
    const m = view.match(/^(editor|club:(\d+))$/);
    if (m) {
      c.set('realUser', user);
      user = m[2] ? { ...user, role: 'club', club_id: Number(m[2]) } : { ...user, role: 'editor', club_id: null };
    }
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

// ---------- Lykilorð ----------
// PBKDF2-SHA256 með salti; geymt sem pbkdf2$<umferðir>$<salt>$<hash> (base64)
const PBKDF2_ITER = 100_000;
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return ['pbkdf2', PBKDF2_ITER, b64(salt), b64(await pbkdf2(password, salt, PBKDF2_ITER))].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [alg, iter, salt, hash] = (stored ?? '').split('$');
  if (alg !== 'pbkdf2' || !hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

const DUMMY_HASH = ['pbkdf2', PBKDF2_ITER, 'AAAAAAAAAAAAAAAAAAAAAA==', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='].join('$');

/** Skilar notanda ef netfang og lykilorð passa. Fimm rangar tilraunir í röð læsa aðganginum í 15 mínútur. */
export async function passwordLogin(env: Env, rawEmail: string, password: string): Promise<{ user?: User; locked?: boolean }> {
  const email = rawEmail.trim().toLowerCase();
  const u = await one<User & { active: number; password_hash: string | null; failed_logins: number; locked_until: string | null }>(env.DB,
    'SELECT id, email, name, role, club_id, active, password_hash, failed_logins, locked_until FROM users WHERE email = ?', email);
  // Sama vinna hvort sem notandinn er til eða ekki, svo tíminn komi ekki upp um netföng
  if (!u || !u.active || !u.password_hash) { await verifyPassword(password, DUMMY_HASH); return {}; }
  if (u.locked_until && u.locked_until > nowIso()) return { locked: true };
  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = u.failed_logins + 1;
    await run(env.DB, 'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', fails >= 5 ? 0 : fails, fails >= 5 ? isoIn(15) : null, u.id);
    return { locked: fails >= 5 };
  }
  await run(env.DB, 'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', u.id);
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role, club_id: u.club_id } };
}
