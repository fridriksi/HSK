import { Hono } from 'hono';
import type { AppEnv } from './lib';
import { one } from './lib';
import admin from './routes/admin';
import site, { notFound } from './routes/public';
import { staticFile } from './static';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'SAMEORIGIN');
});

// Síður sem hafa verið færðar í veftré vísa á nýja slóð
app.use('*', async (c, next) => {
  await next();
  if (c.res.status === 404 && c.req.method === 'GET') {
    const path = new URL(c.req.url).pathname.replace(/^\/+|\/+$/g, '');
    const hit = path ? await one<{ new_path: string }>(c.env.DB, 'SELECT new_path FROM redirects WHERE old_key = ?', 'path:' + path) : null;
    if (hit) c.res = c.redirect(hit.new_path, 301);
  }
});

app.get('/css/*', (c) => staticFile(new URL(c.req.url).pathname) ?? c.notFound());
app.get('/js/*', (c) => staticFile(new URL(c.req.url).pathname) ?? c.notFound());
app.get('/img/*', (c) => staticFile(new URL(c.req.url).pathname) ?? c.notFound());

app.route('/stjorn', admin);
app.route('/', site);
app.notFound((c) => notFound(c));
app.onError((err, c) => {
  console.error(err);
  return c.text('Villa kom upp. Reyndu aftur eftir smá stund.', 500);
});

export default app;
