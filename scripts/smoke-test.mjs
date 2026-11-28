// Prófar helstu leiðir í gegnum vef og vefumsjón á staðbundnum þjóni (npm run dev).
// Krefst ADMIN_EMAILS=stjornandi@hsk.is í .dev.vars og DEV_LOGIN_LINKS=true.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:8787';
const stamp = Date.now().toString(36);
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failures++; };

async function login(page, email) {
  await page.goto(`${BASE}/stjorn/innskraning`);
  await page.fill('#email', email);
  await page.click('button:has-text("Senda innskráningartengil")');
  const link = page.locator('.dev-box a');
  if (!(await link.count())) return false;
  await link.click();
  await page.waitForURL(`${BASE}/stjorn`);
  return true;
}

async function setRte(page, html) {
  await page.waitForFunction(() => window.tinymce && tinymce.activeEditor && tinymce.activeEditor.initialized);
  await page.evaluate((h) => { const eds = tinymce.get(); eds[eds.length - 1].setContent(h); }, html);
}

const browser = await chromium.launch();
// Ytri leturgerðir eru óþarfar í prófun
async function newPage() {
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  // Ritillinn kemur af jsDelivr; í prófunum er staðbundið afrit notað (sama útgáfa)
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/tinymce@6\.8\.5\//, (r) => {
    const file = 'node_modules/tinymce/' + new URL(r.request().url()).pathname.split('/tinymce@6.8.5/')[1];
    return existsSync(file) ? r.fulfill({ path: file }) : r.fulfill({ status: 404 });
  });
  return ctx.newPage();
}
try {
  // 1. Stjórnandi
  const admin = await newPage();
  admin.on('dialog', (d) => d.accept());
  ok(await login(admin, 'stjornandi@hsk.is'), 'Stjórnandi skráir sig inn með tengli');
  ok(await admin.locator('a:has-text("Notendur")').count() > 0, 'Stjórnandi sér notendastjórnun');

  // 1b. Lykilorð: stjórnandi setur lykilorð og skráir sig inn með því
  const pw = "Prufa-lykilord-2026";  // fast lykilorð svo prófið virki aftur og aftur á sama gagnagrunni
  await admin.goto(`${BASE}/stjorn/adgangur`);
  if (await admin.locator('#current').count()) await admin.fill('#current', pw);
  await admin.fill('#new', pw);
  await admin.fill('#again', pw);
  await admin.click('button:has-text("Vista lykilorð")');
  const pwPage = await newPage();
  await pwPage.goto(`${BASE}/stjorn/innskraning`);
  await pwPage.fill('#pw-email', 'stjornandi@hsk.is');
  await pwPage.fill('#pw', 'rangt-lykilord-123');
  await pwPage.click('button:has-text("Skrá inn")');
  ok(await pwPage.locator('.flash.err').count() > 0, 'Rangt lykilorð er hafnað');
  await pwPage.fill('#pw-email', 'stjornandi@hsk.is');
  await pwPage.fill('#pw', pw);
  await pwPage.click('button:has-text("Skrá inn")');
  await pwPage.waitForURL(`${BASE}/stjorn`);
  ok(await pwPage.locator('h1:has-text("Yfirlit")').count() > 0, 'Stjórnandi skráir sig inn með lykilorði');


  // 2. Ný frétt með mynd
  await admin.goto(`${BASE}/stjorn/frettir/nytt`);
  await admin.fill('#f_title', `Prófunarfrétt ${stamp}`);
  await admin.setInputFiles('.upload-field[data-kind=image] input[type=file]', 'seed/media/hakon.jpg');
  await admin.waitForFunction(() => document.querySelector('#f_image').value.startsWith('/media/'));
  await setRte(admin, '<p>Þetta er <strong>prófun</strong>.</p><script>alert(1)</script>');
  await admin.click('button[value=published]');
  await admin.waitForURL(/m=birt/);
  const newsUrl = await admin.locator('a:has-text("Skoða á vef")').getAttribute('href');
  const pub = await (await fetch(BASE + newsUrl)).text();
  ok(pub.includes(`Prófunarfrétt ${stamp}`) && pub.includes('<strong>prófun</strong>'), 'Frétt birtist á vefnum');
  ok(!pub.includes('<script>alert(1)'), 'Hættulegur kóði er hreinsaður úr texta');
  const imgSrc = pub.match(/class="lead-img"><img src="([^"]+)"/)?.[1];
  const img = imgSrc ? await fetch(BASE + imgSrc) : null;
  ok(img?.ok && Number(img.headers.get('content-length') || (await img.arrayBuffer()).byteLength) < 1_500_000, 'Mynd var minnkuð og er sótt úr R2');
  ok((await (await fetch(BASE + '/')).text()).includes(`Prófunarfrétt ${stamp}`), 'Frétt birtist á forsíðu');

  // 3. Ný undirsíða
  await admin.goto(`${BASE}/stjorn/sidur/nytt`);
  await admin.fill('#title', `Prufusíða ${stamp}`);
  await admin.selectOption('#parent_id', { label: 'Um HSK (/um-hsk)' });
  await setRte(admin, '<p>Texti undirsíðu.</p>');
  await admin.click('button[value=published]');
  await admin.waitForURL(/m=vistad/);
  const sub = await fetch(`${BASE}/um-hsk/prufusida-${stamp}`);
  ok(sub.ok, 'Undirsíða birtist á /um-hsk/prufusida-…');
  ok((await (await fetch(BASE + '/')).text()).includes(`Prufusíða ${stamp}`), 'Undirsíða birtist í valmynd');

  // 3b. Ný reglugerð birtist sjálfkrafa í flokkaða listanum á Lög og reglugerðir og hverfur þegar henni er eytt
  await admin.goto(`${BASE}/stjorn/sidur/nytt`);
  await admin.fill('#title', `Reglugerð um prufumót ${stamp}`);
  await admin.selectOption('#parent_id', { label: 'Lög og reglugerðir (/um-hsk/log-og-reglugerdir)' });
  await admin.uncheck('input[name=in_menu]');
  await setRte(admin, '<p>1. gr. Prufa.</p>');
  await admin.click('button[value=published]');
  await admin.waitForURL(/m=vistad/);
  const lawsHtml = await (await fetch(`${BASE}/um-hsk/log-og-reglugerdir`)).text();
  const regSection = lawsHtml.split('<h2>Reglugerðir</h2>')[1]?.split('<h2>')[0] ?? '';
  ok(regSection.includes(`Reglugerð um prufumót ${stamp}`), 'Ný reglugerð birtist undir Reglugerðir á Lög og reglugerðir');
  await admin.click('button:has-text("Eyða síðu")');
  await admin.waitForURL(/m=eytt/);
  ok(!(await (await fetch(`${BASE}/um-hsk/log-og-reglugerdir`)).text()).includes(`prufumót ${stamp}`), 'Eydd reglugerð hverfur af listanum');

  // 3c. Umsókn í Verkefnasjóð: send af opinbera vefnum, berst í vefumsjón, fylgiskjal er ekki opinbert
  const gp = await newPage();
  await gp.goto(`${BASE}/um-hsk/verkefnasjodur`);
  const fill = async (vals) => { for (const [k, v] of Object.entries(vals)) await gp.fill(`#g-${k}`, v); };
  const grant = { felag: `Umf. Prufa ${stamp}`, kennitala: '470169-1234', banki: '0152-26-1234', heimili: 'Engjavegi 1', postnumer: '800 Selfoss',
    abyrgdarmadur: 'Jón Jónsson', simi: '8991234', netfang: 'prufa@example.com', verkefni: `Leikjanámskeið ${stamp}`, lysing: 'Námskeið fyrir börn.', fjarhagsaaetlun: 'Kostnaður 200.000 kr.', upphaed: '150000' };
  await fill({ ...grant, daemi: '4' });
  await gp.click('button:has-text("Senda umsókn")');
  ok(await gp.locator('.form-error:has-text("reikningsdæminu")').count() > 0, 'Rangt svar við reikningsdæmi stöðvar umsókn og innsláttur helst');
  ok((await gp.inputValue('#g-felag')) === grant.felag, 'Útfylltir reitir haldast eftir villu');
  await gp.fill('#g-daemi', '5');
  await gp.setInputFiles('#g-skjal1', { name: 'lysing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prufa') });
  await gp.click('button:has-text("Senda umsókn")');
  await gp.waitForURL(/umsokn=send/);
  ok(await gp.locator('.form-ok').count() > 0, 'Umsókn í Verkefnasjóð send af vefnum');
  await admin.goto(`${BASE}/stjorn/umsoknir`);
  ok(await admin.locator(`text=Umf. Prufa ${stamp}`).count() > 0, 'Umsóknin birtist í vefumsjón');
  await admin.click(`text=Umf. Prufa ${stamp}`);
  ok(await admin.locator('dd:has-text("4701691234")').count() > 0, 'Kennitala vistuð án bandstriks');
  const fileHref = await admin.locator('a:has-text("lysing.pdf")').getAttribute('href');
  const dl = await admin.request.get(`${BASE}${fileHref}`);
  ok(dl.ok() && (await dl.text()).includes('%PDF'), 'Starfsfólk getur sótt fylgiskjal');
  ok((await (await fetch(`${BASE}${fileHref}`, { redirect: 'manual' })).status) !== 200, 'Fylgiskjal er ekki aðgengilegt án innskráningar');
  // Samþykkt umsókn birtist í úthlutunartöflunni á vefnum
  await admin.fill('#award_amount', '120000');
  await admin.uncheck('input[name=notify]');
  await Promise.all([admin.waitForURL(/\?m=/), admin.click('button[value=samthykkja]')]);
  const awardsHtml = await (await fetch(`${BASE}/um-hsk/verkefnasjodur?q=${encodeURIComponent('Prufa ' + stamp)}`)).text();
  ok(awardsHtml.includes(`Umf. Prufa ${stamp}`) && awardsHtml.includes('120.000 kr.'), 'Samþykkt umsókn birtist í úthlutunum á vefnum');
  await Promise.all([admin.waitForURL(/\?m=/), admin.click('button[value=afturkalla]')]);
  ok(!(await (await fetch(`${BASE}/um-hsk/verkefnasjodur?q=${encodeURIComponent('Prufa ' + stamp)}`)).text()).includes(`Umf. Prufa ${stamp}`), 'Afturkölluð ákvörðun fjarlægir úthlutun af vefnum');
  await admin.click('button:has-text("Eyða umsókn")');
  await admin.waitForURL(/m=eytt/);
  // Lokað fyrir umsóknir: formið hverfur og vefurinn tekur ekki við umsóknum
  await admin.goto(`${BASE}/stjorn/umsoknir`);
  await admin.check('input[name=open][value="0"]');
  await admin.fill('#closed_text', `Lokað til vors ${stamp}`);
  await Promise.all([admin.waitForURL(/\?m=/), admin.click('.grant-open-form button')]);
  const closedHtml = await (await fetch(`${BASE}/um-hsk/verkefnasjodur`)).text();
  const closedPost = await fetch(`${BASE}/umsokn/verkefnasjodur`, { method: 'POST', body: new URLSearchParams({ felag: 'x' }), redirect: 'manual' });
  await admin.check('input[name=open][value="1"]');
  await Promise.all([admin.waitForURL(/\?m=/), admin.click('.grant-open-form button')]);
  ok(closedHtml.includes(`Lokað til vors ${stamp}`) && !closedHtml.includes('Senda umsókn') && closedPost.status === 303
    && (await (await fetch(`${BASE}/um-hsk/verkefnasjodur`)).text()).includes('Senda umsókn'), 'Lokað fyrir umsóknir felur formið og opnað aftur sýnir það');
  const grantPage = await (await fetch(`${BASE}/um-hsk/verkefnasjodur`)).text();
  ok(!grantPage.includes('Reglugerð fyrir Verkefnasjóð') || /inline-acc[\s\S]*?<summary>Reglugerð fyrir Verkefnasjóð[\s\S]*?1\. gr/.test(grantPage), 'Reglugerð birtist í fellilista á síðu Verkefnasjóðs');
  // Umsóknarform stillt í vefumsjón: nýr fellilisti birtist á vefnum og svarið vistast með umsókninni
  await admin.goto(`${BASE}/stjorn/umsoknir/form`);
  await admin.click('[data-ff-add]');
  const newRow = admin.locator('[data-ff-row]').last();
  await newRow.locator('input[name=field_label]').fill(`Aldurshópur ${stamp}`);
  await newRow.locator('select[name=field_type]').selectOption('select');
  await newRow.locator('textarea[name=field_options]').fill('6–9 ára\n10–12 ára');
  await newRow.locator('select[name=field_required]').selectOption('1');
  await Promise.all([admin.waitForURL(/form\?m=/), admin.click('.ff-form button:has-text("Vista form")')]);
  await gp.goto(`${BASE}/um-hsk/verkefnasjodur`);
  const newSel = gp.locator(`label:has-text("Aldurshópur ${stamp}")`);
  ok(await newSel.count() > 0, 'Nýr reitur í umsóknarformi birtist á vefnum');
  await fill({ ...grant, felag: `Umf. Reitur ${stamp}`, daemi: '5' });
  await gp.selectOption(`#${await newSel.getAttribute('for')}`, '10–12 ára');
  await gp.click('button:has-text("Senda umsókn")');
  await gp.waitForURL(/umsokn=send/);
  await admin.goto(`${BASE}/stjorn/umsoknir`);
  await admin.click(`text=Umf. Reitur ${stamp}`);
  ok(await admin.locator(`dt:has-text("Aldurshópur ${stamp}") + dd:has-text("10–12 ára")`).count() > 0, 'Svar í nýjum reit vistast með umsókninni');
  await admin.click('button:has-text("Eyða umsókn")');
  await admin.waitForURL(/m=eytt/);
  await admin.goto(`${BASE}/stjorn/umsoknir/form`);
  await Promise.all([admin.waitForURL(/form\?m=/), admin.click('button[name=reset]')]);
  ok(!(await (await fetch(`${BASE}/um-hsk/verkefnasjodur`)).text()).includes(`Aldurshópur ${stamp}`), 'Endurstillt umsóknarform fjarlægir nýja reitinn');
  ok(await admin.locator(`text=Umf. Prufa ${stamp}`).count() === 0, 'Umsókn eytt');

  // 3d. Ný metaskrá fer á rétt spjald á HSK met eftir flokki og ári
  await admin.goto(`${BASE}/stjorn/met/nytt`);
  await admin.fill('#f_title', `HSK metaskrá öldunga innanhúss prufa ${stamp}`);
  await admin.selectOption('#f_category', 'oldungar_inni');
  await admin.fill('#f_year', '2099');
  await admin.fill('#f_file', `/media/prufa-${stamp}.xlsx`);
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/m=vistad/);
  const metHtml = await (await fetch(`${BASE}/mot/hsk-met`)).text();
  const oldCard = metHtml.split('<h2>Öldungar innanhúss</h2>')[1]?.split('</section>')[0] ?? '';
  ok(oldCard.includes(`prufa-${stamp}.xlsx`) && oldCard.includes('Metaskrá 2099'), 'Ný metaskrá birtist efst á spjaldinu Öldungar innanhúss');
  await admin.click('button:has-text("Eyða")');
  await admin.waitForURL(/m=eytt/);

  // 3e. Flýtireitir neðst á forsíðu eru stillanlegir í töflu (fyrirsögn, texti, síða)
  await admin.goto(`${BASE}/stjorn/stillingar`);
  const lastTitle = admin.locator('input[name=tile_title]').last();
  const lastUrl = admin.locator('input[name=tile_url]').last();
  await lastTitle.fill(`Prufureitur ${stamp}`);
  await lastUrl.fill('/um-hsk');
  await Promise.all([admin.waitForURL(/m=/), admin.click('form .form-actions button:has-text("Vista")')]);
  const tilesHome = await (await fetch(`${BASE}/`)).text();
  await admin.goto(`${BASE}/stjorn/stillingar`);
  await admin.locator(`input[name=tile_title][value="Prufureitur ${stamp}"]`).fill('');
  await Promise.all([admin.waitForURL(/m=/), admin.click('form .form-actions button:has-text("Vista")')]);
  ok(tilesHome.includes(`Prufureitur ${stamp}`) && !(await (await fetch(`${BASE}/`)).text()).includes(`Prufureitur ${stamp}`), 'Flýtireitir á forsíðu breytast í stillingum');

  // 3f. Héraðsþing: nýtt þing með þinggögnum birtist efst á síðunni Héraðsþing
  await admin.goto(`${BASE}/stjorn/heradsthing/nytt`);
  await admin.fill('#title', `Héraðsþing prufa ${stamp}`);
  await admin.fill('#date', '2099-03-20');
  await admin.fill('#location', 'Selfoss');
  await admin.setInputFiles('[data-doc-upload] input[type=file]', { name: 'Dagskra_thing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prufa') });
  await admin.waitForSelector('[data-doc-rows] .doc-row');
  await admin.fill('[data-doc-rows] .doc-row input[name=doc_title]', 'Dagskrá héraðsþings');
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/m=vistad/);
  const thingHtml = await (await fetch(`${BASE}/um-hsk/heradsthing`)).text();
  const firstThing = thingHtml.split('class="merged"')[1]?.split('</section>')[0] ?? '';
  ok(firstThing.includes(`Héraðsþing prufa ${stamp}`) && firstThing.includes('Dagskrá héraðsþings'), 'Nýtt héraðsþing með þinggögnum birtist efst');
  await admin.click('button:has-text("Eyða þingi")');
  await admin.waitForURL(/m=eytt/);

  // 3g. Íþróttagreinar félags: hakað við margar greinar í fellilista
  await admin.goto(`${BASE}/stjorn/felog/1`);
  const sportsBefore = await admin.evaluate(() => [...document.querySelectorAll('#f_sports input:checked')].map((i) => i.value));
  await admin.click('#f_sports summary');
  for (const sp of ['Golf', 'Sund']) { const cb = admin.locator(`#f_sports input[value="${sp}"]`); if (!(await cb.isChecked())) await cb.check(); }
  ok((await admin.textContent('#f_sports [data-multi-label]')).includes('Sund'), 'Valdar greinar birtast í fellilistanum');
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/m=vistad/);
  const saved = await admin.evaluate(() => [...document.querySelectorAll('#f_sports input:checked')].map((i) => i.value));
  ok(saved.includes('Golf') && saved.includes('Sund'), 'Margar íþróttagreinar vistast á félag');
  await admin.click('#f_sports summary');
  for (const sp of ['Golf', 'Sund']) { if (!sportsBefore.includes(sp)) await admin.locator(`#f_sports input[value="${sp}"]`).uncheck(); }
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/m=vistad/);

  // 3h. Sveitarfélag félags: sami fellilisti; félagið finnst eftir sveitarfélagi
  await admin.goto(`${BASE}/stjorn/felog/1`);
  const areaWas = await admin.locator('#f_area input[value="Bláskógabyggð"]').isChecked();
  await admin.click('#f_area summary');
  if (!areaWas) await admin.check('#f_area input[value="Bláskógabyggð"]');
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/m=vistad/);
  const clubsHtml = await (await fetch(`${BASE}/adildarfelog`)).text();
  ok(/data-text="[^"]*bláskógabyggð/.test(clubsHtml), 'Sveitarfélag vistast og félagið finnst eftir því');
  if (!areaWas) { await admin.click('#f_area summary'); await admin.uncheck('#f_area input[value="Bláskógabyggð"]'); await admin.click('button:has-text("Vista")'); await admin.waitForURL(/m=vistad/); }

  // 3i. Nýtt met skráð í vefumsjón birtist í töflunni á HSK met
  await admin.goto(`${BASE}/stjorn/ny-met/nytt`);
  ok(await admin.locator('#f_event_list option[value="60 m hlaup"]').count() > 0, 'Greinar úr metaskrám eru í boði við skráningu nýs mets');
  await admin.fill('#f_event', '60 m hlaup');
  await admin.fill('#f_result', '6,99');
  await admin.fill('#f_athlete', `Prufa Metsdóttir ${stamp}`);
  await admin.selectOption('#f_category', 'innanhuss');
  await admin.fill('#f_age_group', 'Konur');
  await admin.fill('#f_date', '2026-11-20');
  await admin.fill('#f_place', 'Selfoss');
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/m=vistad/);
  const recs = await (await fetch(`${BASE}/mot/hsk-met/gogn`)).json();
  const mine = recs.find((r) => r.athlete === `Prufa Metsdóttir ${stamp}`);
  ok(mine && mine.result === '6,99' && mine.categories.includes('Innanhúss') && mine.date === '20.11.2026', 'Nýja metið birtist í töflunni á HSK met');
  const entryUrl = admin.url().split('?')[0];
  await admin.goto(`${BASE}/stjorn/ny-met`);
  await admin.waitForSelector('[data-record-catalogue] fieldset:not([disabled])');
  await admin.fill('#records-search', `Metsdóttir ${stamp}`);
  await admin.waitForTimeout(400);
  ok(await admin.locator(`[data-record-catalogue] a[href="${new URL(entryUrl).pathname}"]:has-text("Breyta")`).count() > 0, 'Skráð met birtast í öllu metatöflunni í vefumsjón með tengli til að breyta');
  await admin.goto(entryUrl);
  await admin.click('button:has-text("Eyða")');
  await admin.waitForURL(/m=eytt/);

  // 3j. Sía fyrir gildandi met fækkar metum en fjarlægir þau ekki
  const recPage = await newPage();
  await recPage.goto(`${BASE}/mot/hsk-met`);
  await recPage.waitForSelector('fieldset:not([disabled])');
  const allCount = await recPage.textContent('[data-record-count]');
  await recPage.check('input[name=gildandi]');
  const curCount = await recPage.textContent('[data-record-count]');
  await recPage.uncheck('input[name=gildandi]');
  ok(curCount !== allCount && (await recPage.textContent('[data-record-count]')) === allCount, 'Sían „Aðeins gild met“ fækkar metum og öll birtast aftur án hennar');

  // 3k. Skrá nýtt met: gilt met í völdum flokki birtist og varað er við röngum aldursflokki
  await admin.goto(`${BASE}/stjorn/ny-met/nytt`);
  await admin.fill('#f_event', '60 m hlaup');
  await admin.selectOption('#f_category', 'innanhuss');
  await admin.fill('#f_age_group', 'Piltar 11 ára');
  await admin.fill('#f_date', '2030-01-01');
  await admin.waitForSelector('.record-check.info:has-text("Gilt met núna")');
  ok(await admin.locator('.record-check .ok').count() > 0, 'Formið sýnir gilt met og að nýja metið leysi það af');
  await admin.fill('#f_age_group', 'Piltar 11');
  await admin.waitForSelector('.record-check.warn:has-text("Ekkert met finnst")');
  await admin.click('.record-check [data-pick-group="Piltar 11 ára"]');
  await admin.waitForSelector('.record-check.info');
  ok((await admin.inputValue('#f_age_group')) === 'Piltar 11 ára', 'Varað við óþekktum aldursflokki og hægt að velja réttan');

  // 3l. Mót og viðburðir: Lesa úr texta fyllir út reiti eftir reglum (dagsetning, tími, staður, frestur, tengill, grein)
  await admin.goto(`${BASE}/stjorn/vidburdir/nytt`);
  await admin.fill('.ai-fill textarea', 'Aldursflokkamót HSK í sundi\nStaður: Sundhöll Selfoss\nDagsetning: 8.–9. mars 2027 kl. 10\nAldur: 11-12 ára, 13-14 ára\nSkráning í síðasta lagi 1. mars 2027. Nánar á https://hsk.is/sund');
  await admin.click('.ai-fill button');
  await admin.waitForSelector('.ai-fill-msg.ok');
  const aiVals = await Promise.all(['title', 'kind', 'sport', 'starts_at', 'ends_at', 'location', 'reg_deadline', 'url', 'age_groups'].map((n) => admin.inputValue('#f_' + n)));
  ok(aiVals.join('|') === 'Aldursflokkamót HSK í sundi|mot|Sund|2027-03-08T10:00|2027-03-09T00:00|Sundhöll Selfoss|2027-03-01|https://hsk.is/sund|11-12 ára, 13-14 ára'
    && await admin.locator('.field.ai-filled').count() >= 9, 'Lesa úr texta fyllir út reiti og merkir þá');

  // 3m. Sýn: stjórnandi skoðar vefumsjónina sem félagsaðgangur og fer aftur í eigin aðgang
  await admin.goto(`${BASE}/stjorn`);
  const clubOpt = await admin.$eval('#syn optgroup option', (o) => ({ v: o.value, t: o.textContent.trim() }));
  await Promise.all([admin.waitForURL(`${BASE}/stjorn`), admin.selectOption('#syn', clubOpt.v)]);
  await admin.waitForSelector('.view-banner');
  const asClub = (await admin.textContent('.view-banner')).includes(clubOpt.t) && await admin.locator('.side a:has-text("Mitt félag")').count() > 0
    && (await admin.request.get(`${BASE}/stjorn/notendur`)).status() === 403;
  await Promise.all([admin.waitForURL(`${BASE}/stjorn`), admin.click('.view-banner button')]);
  ok(asClub && await admin.locator('.view-banner').count() === 0 && await admin.locator('a:has-text("Notendur")').count() > 0,
    'Sýn: stjórnandi skoðar sem félagsaðgangur og fer aftur í eigin aðgang');

  // 3n. Samskipti: tengiliðir fluttir inn, útsending búin til, prufupóstur, sending og niðurstöður (þróunarhamur sendir ekki í raun)
  await admin.goto(`${BASE}/stjorn/samskipti/tengilidir`);
  const campClub = await admin.$eval('#c-club option:nth-child(2)', (o) => ({ id: o.value, name: o.textContent.trim() }));
  await admin.fill('textarea[name=rows]', [
    `Anna Prófa\tanna.${stamp}@example.com\t8881111\tformaður\t${campClub.name}`,
    `Bjarni Prófa\tbjarni.${stamp}@example.com\t\tfélagi\t${campClub.name}`,
    `Án Netfangs ${stamp}\t\t\tfélagi\t${campClub.name}`,
  ].join('\n'));
  await Promise.all([admin.waitForURL(/tengilidir\?m=/), admin.click('form[action$="innflutningur"] button')]);
  ok((await admin.textContent('.flash')).includes('3 tengiliðum bætt við'), 'Samskipti: tengiliðir fluttir inn úr Excel');
  await admin.goto(`${BASE}/stjorn/samskipti`);
  await Promise.all([admin.waitForURL(/samskipti\/\d+$/), admin.click('button:has-text("Senda tölvupóst")')]);
  const campUrl = admin.url();
  await admin.fill('input[name=internal_name]', `Prufuútsending ${stamp}`);
  await admin.check(`input[name=aud_clubs][value="${campClub.id}"]`);
  await admin.fill('input[name=subject]', `Fréttabréf ${stamp}`);
  await setRte(admin, '<p>Halló félagar, <a href="https://hsk.is">sjá vefinn</a>.</p>');
  await admin.waitForFunction(() => /\d+ í hópi · \d+ hægt að senda á/.test(document.querySelector('[data-aud-count]').textContent), null, { timeout: 15000 });
  const countText = await admin.textContent('[data-aud-count]');
  await Promise.all([admin.waitForURL(/\?m=/), admin.click('button:has-text("Senda prufupóst")')]);
  const [, inGroup, canSend] = countText.replace(/\./g, '').match(/(\d+) í hópi · (\d+) hægt/) || [];
  ok((await admin.textContent('.flash')).includes('Prufupóstur sendur') && Number(inGroup) >= 3 && Number(inGroup) - Number(canSend) >= 1,
    'Samskipti: viðtakendur taldir og prufupóstur sendur');
  await Promise.all([admin.waitForURL(/nidurstodur/), admin.click('[data-send]')]);
  await admin.waitForTimeout(800);
  await admin.reload();
  const res = await admin.textContent('main');
  ok(res.includes('Ekkert netfang') && res.includes(`Án Netfangs ${stamp}`) && /Afhent\s*[1-9]/.test(res), 'Samskipti: útsending send og niðurstöður sýna afhent og ástæðu');
  await admin.goto(`${BASE}/stjorn/samskipti?tab=sent`);
  ok((await admin.textContent('main')).includes(`Fréttabréf ${stamp}`), 'Samskipti: send útsending birtist í yfirliti');
  ok((await fetch(`${BASE}/afskra?t=ogilt.tak`)).status === 400 && (await fetch(`${BASE}/postmark/webhook/rangt`, { method: 'POST', body: '{}' })).status === 403,
    'Samskipti: ógildur afskráningartengill og óheimil stöðutilkynning hafnað');

  // 3o. Samfélagsmiðlar: röð birtist fyrir ofan fótinn þegar slóð er skráð í stillingum, annars ekki
  await admin.goto(`${BASE}/stjorn/stillingar`);
  await admin.fill('#social_facebook', 'https://www.facebook.com/hsk.prufa');
  await admin.fill('#social_instagram', 'https://www.instagram.com/hsk.prufa');
  await Promise.all([admin.waitForURL(/m=/), admin.click('form .form-actions button:has-text("Vista")')]);
  const withSocial = await (await fetch(`${BASE}/`)).text();
  await admin.goto(`${BASE}/stjorn/stillingar`);
  await admin.fill('#social_facebook', '');
  await admin.fill('#social_instagram', '');
  await Promise.all([admin.waitForURL(/m=/), admin.click('form .form-actions button:has-text("Vista")')]);
  ok(withSocial.includes('social-band') && withSocial.includes('https://www.instagram.com/hsk.prufa') && !(await (await fetch(`${BASE}/`)).text()).includes('social-band'),
    'Samfélagsmiðlar birtast í röð fyrir ofan fótinn aðeins þegar slóð er skráð');

  // 3p. Auglýsingar: auglýsing í plássi 1 birtist á forsíðu og hverfur þegar hún er falin
  await admin.goto(`${BASE}/stjorn/auglysingar/nytt`);
  await admin.fill('#f_title', `Prufuauglýsing ${stamp}`);
  await admin.selectOption('#f_slot', 'forsida-midja');
  await admin.fill('#f_image', `/img/hsk-merki-512.png?ad=${stamp}`);
  await admin.fill('#f_url', 'https://example.com/auglysing');
  await Promise.all([admin.waitForURL(/auglysingar\/\d+\?m=/), admin.click('.form-actions button:has-text("Vista")')]);
  const adHome = await (await fetch(`${BASE}/`)).text();
  await admin.selectOption('#f_active', 'falin');
  await Promise.all([admin.waitForURL(/auglysingar\/\d+\?m=/), admin.click('.form-actions button:has-text("Vista")')]);
  ok(adHome.includes(`ad=${stamp}`) && adHome.includes('ad-row') && !(await (await fetch(`${BASE}/`)).text()).includes(`ad=${stamp}`),
    'Auglýsing birtist í auglýsingaplássi á forsíðu og hverfur þegar hún er falin');

  // 4. Viðburður (mót)
  await admin.goto(`${BASE}/stjorn/vidburdir/nytt`);
  await admin.fill('#f_title', `Héraðsmót ${stamp}`);
  await admin.selectOption('#f_kind', 'mot');
  await admin.selectOption('#f_sport', 'Frjálsíþróttir');
  await admin.fill('#f_starts_at', '2027-01-15T10:00');
  await admin.fill('#f_location', 'Selfoss');
  await admin.click('button[value=published]');
  await admin.waitForURL(/m=birt/);
  ok((await (await fetch(`${BASE}/mot/dagskra?tegund=mot`)).text()).includes(`Héraðsmót ${stamp}`), 'Mót birtist í Mót og viðburðir (sía: mót)');

  // 4a. Hætta við: fer aftur á listann og heldur síum
  await admin.goto(`${BASE}/stjorn/vidburdir?q=${encodeURIComponent('Héraðsmót')}`);
  await Promise.all([admin.waitForURL(`${BASE}/stjorn/vidburdir/nytt`), admin.click('a[href="/stjorn/vidburdir/nytt"]')]);
  await Promise.all([admin.waitForURL(/\/stjorn\/vidburdir\?q=/), admin.click('.form-actions a[data-back]')]);
  await admin.goto(`${BASE}/stjorn/frettir/nytt`);
  await Promise.all([admin.waitForURL(`${BASE}/stjorn/frettir`), admin.click('.form-actions a[data-back]')]);
  await admin.goto(`${BASE}/stjorn/stillingar`);
  await Promise.all([admin.waitForURL(`${BASE}/stjorn`), admin.click('.form-actions a[data-back]')]);
  ok(true, 'Hætta við fer aftur á listann (og heldur síum ef komið var þaðan)');

  // 4b. Skrá úrslit: val á móti úr Mót og viðburðir fyllir út heiti, dagsetningu og grein
  await admin.goto(`${BASE}/stjorn/urslit/nytt`);
  const evVal = await admin.$eval('#f_event_id', (sel, t) => [...sel.options].find((o) => o.textContent.includes(t))?.value, `Héraðsmót ${stamp}`);
  await admin.selectOption('#f_event_id', evVal);
  ok((await admin.inputValue('#f_title')) === `Héraðsmót ${stamp}` && (await admin.inputValue('#f_date')) === '2027-01-15'
    && (await admin.inputValue('#f_sport')) === 'Frjálsíþróttir', 'Skrá úrslit: val á móti fyllir út heiti, dagsetningu og grein');

  // 5. Albúm með myndum
  await admin.goto(`${BASE}/stjorn/myndasofn/nytt`);
  await admin.fill('#f_title', `Albúm ${stamp}`);
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/myndasofn\/\d+\?m=/);
  await admin.setInputFiles('.upload-drop input[type=file]', ['seed/media/ithrottaeldhugi.jpg', 'seed/media/sjalfbodalidar.png']);
  await admin.waitForSelector('.photo-grid figure:nth-child(2)', { timeout: 20000 });
  ok(await admin.locator('.photo-grid figure').count() === 2, 'Tvær myndir hlaðnar í albúm');

  // 5b. Myndir og skjöl: eyða ónotaðri skrá; skrá sem er notuð í myndasafni er ekki eytt
  const usedSrc = await admin.getAttribute('.photo-grid figure img', 'src');
  await admin.goto(`${BASE}/stjorn/skrar?uppruni=nyjar`);
  await Promise.all([admin.waitForEvent('load'), admin.setInputFiles('.upload-drop input[type=file]', ['seed/media/sjalfbodalidar.png'])]);
  const newest = await admin.getAttribute('.media-grid figure:first-child button[name=key]', 'value');
  await Promise.all([admin.waitForURL(/eytt=1/), admin.click('.media-grid figure:first-child button[name=key]')]);
  const gone = (await fetch(`${BASE}/media/${newest}`)).status === 404;
  const usedKey = usedSrc.replace(/^\/media\//, '');
  await admin.goto(`${BASE}/stjorn/skrar?uppruni=nyjar`);
  await admin.check(`input[name=keys][value="${usedKey}"]`);
  await Promise.all([admin.waitForURL(/eytt=0/), admin.click('.media-select-bar button[name=bulk]')]);
  ok(gone && (await admin.textContent('.flash')).includes(`Albúm ${stamp}`) && (await fetch(`${BASE}${usedSrc}`)).status === 200,
    'Myndir og skjöl: ónotaðri skrá eytt en skrá í myndasafni haldið');

  // 6. Bjóða formanni
  await admin.goto(`${BASE}/stjorn/notendur`);
  const clubEmail = `formadur.${stamp}@gmail.com`;
  await admin.fill('#email', clubEmail);
  await admin.fill('#name', 'Prófunar Formaður');
  await admin.selectOption('#club_id', { label: 'Ungmennafélag Selfoss' });
  await admin.click('button:has-text("Senda boð")');
  await admin.waitForURL(/m=bodid/);

  // 7. Formaður sendir inn frétt
  const club = await newPage();
  ok(await login(club, clubEmail), 'Formaður skráir sig inn með Gmail-netfangi');
  ok(!(await login(await newPage(), `okunnugur.${stamp}@gmail.com`)), 'Óboðið netfang fær ekki aðgang');
  const denied = await club.goto(`${BASE}/stjorn/sidur`);
  ok(denied.status() === 403, 'Formaður hefur ekki aðgang að síðum');
  await club.goto(`${BASE}/stjorn/frettir/nytt`);
  ok(await club.locator('#f_kind').count() === 0, 'Formaður sér ekki reiti sem eru aðeins fyrir starfsfólk');
  await club.fill('#f_title', `Frétt frá félagi ${stamp}`);
  await setRte(club, '<p>Frá Umf. Selfoss.</p>');
  await club.click('button[value=pending]');
  await club.waitForURL(/m=sent/);
  const pendingId = club.url().match(/frettir\/(\d+)/)[1];
  ok(!(await (await fetch(`${BASE}/frettir`)).text()).includes(`Frétt frá félagi ${stamp}`), 'Innsend frétt er ekki birt fyrr en hún er samþykkt');

  // 8. Formaður uppfærir sitt félag
  await club.click('a:has-text("Mitt félag")');
  await club.fill('#f_contact_name', 'Prófunar Formaður');
  await club.click('button:has-text("Vista")');
  await club.waitForURL(/m=vistad/);
  ok((await (await fetch(`${BASE}/felag/ungmennafelag-selfoss`)).text()).includes('Prófunar Formaður'), 'Formaður uppfærði upplýsingar um félagið');
  const other = await club.goto(`${BASE}/stjorn/felog/1`);
  ok(other.status() === 403, 'Formaður getur ekki breytt öðru félagi');

  // 9. Stjórnandi samþykkir
  await admin.goto(`${BASE}/stjorn`);
  ok(await admin.locator(`text=Frétt frá félagi ${stamp}`).count() > 0, 'Innsend frétt birtist í biðröð stjórnanda');
  await admin.goto(`${BASE}/stjorn/frettir/${pendingId}`);
  await admin.click('button:has-text("Samþykkja og birta")');
  await admin.waitForURL(/m=samthykkt/);
  ok((await (await fetch(`${BASE}/frettir`)).text()).includes(`Frétt frá félagi ${stamp}`), 'Samþykkt frétt birtist á vefnum');

  // 10. Breytingasaga
  await admin.goto(`${BASE}/stjorn/saga/news/${pendingId}`);
  ok(await admin.locator('td:has-text("Samþykkti")').count() > 0, 'Breytingasaga skráir samþykkt');
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} próf mistókust` : '\nÖll próf stóðust');
process.exit(failures ? 1 : 0);
