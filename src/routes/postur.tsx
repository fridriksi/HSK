// Opinberar slóðir samskiptakerfisins: stöðutilkynningar frá Postmark og afskráning af póstlista
import { Hono } from 'hono';
import type { AppEnv } from '../lib';
import { handleWebhook, readUnsubscribeToken, unsubscribe } from '../campaigns';

const app = new Hono<AppEnv>();

// Postmark sendir stöðu hvers pósts hingað. Slóðin inniheldur leynilykil (POSTMARK_WEBHOOK_KEY).
app.post('/postmark/webhook/:key', async (c) => {
  const key = c.env.POSTMARK_WEBHOOK_KEY;
  if (!key || c.req.param('key') !== key) return c.text('Óheimilt', 403);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.text('Ógilt', 400);
  await handleWebhook(c.env, body as Record<string, unknown>);
  return c.text('ok');
});

const shell = (title: string, inner: string) => `<!doctype html><html lang="is"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – HSK</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/css/site.css"></head>
<body><main style="max-width:560px;margin:60px auto;padding:0 20px;font-family:system-ui,sans-serif;color:#16203f">
<p><a href="/"><img src="/img/hsk-merki.svg" alt="HSK" width="56"></a></p>${inner}</main></body></html>`;

// Staðfestingarsíða. Afskráning gerist aðeins með POST, svo forskoðun tengla í póstforritum afskrái engan.
app.get('/afskra', async (c) => {
  const t = c.req.query('t') || '';
  const data = await readUnsubscribeToken(c.env, t);
  if (!data) return c.html(shell('Ógildur tengill', '<h1>Ógildur tengill</h1><p>Afskráningartengillinn er ekki gildur. Hafðu samband við skrifstofu HSK ef þú vilt hætta að fá póst.</p>'), 400);
  const email = data.email.replace(/[&<>"]/g, '');
  return c.html(shell('Afskrá af póstlista', `<h1>Afskrá af póstlista</h1>
<p>Viltu hætta að fá fjölpóst frá HSK og aðildarfélögum á <strong>${email}</strong>?</p>
<form method="post"><input type="hidden" name="t" value="${t.replace(/"/g, '')}"><button class="btn">Já, afskrá mig</button></form>`));
});

// Afskráning: úr staðfestingarsíðunni eða „einum smelli“ úr póstforriti (List-Unsubscribe-Post)
app.post('/afskra', async (c) => {
  const f = await c.req.formData().catch(() => null);
  const t = c.req.query('t') || String(f?.get('t') ?? '');
  const data = await readUnsubscribeToken(c.env, t);
  if (!data) return c.html(shell('Ógildur tengill', '<h1>Ógildur tengill</h1><p>Afskráningartengillinn er ekki gildur.</p>'), 400);
  await unsubscribe(c.env.DB, data.email, data.campaignId);
  return c.html(shell('Afskráning tókst', '<h1>Þú hefur verið afskráð/ur</h1><p>Þú færð ekki fleiri fjölpósta frá HSK eða aðildarfélögum. Ef þetta var óvart geturðu haft samband við skrifstofu HSK.</p><p><a href="/">Fara á forsíðu HSK</a></p>'));
});

export default app;
