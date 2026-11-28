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
  await admin.click('button:has-text("Eyða umsókn")');
  await admin.waitForURL(/m=eytt/);
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

  // 3e. Reitir neðst á forsíðu eru stillanlegir
  await admin.goto(`${BASE}/stjorn/stillingar`);
  const tilesBefore = await admin.inputValue('#home_tiles');
  await admin.fill('#home_tiles', `Prufureitur ${stamp} | Texti | /um-hsk`);
  await admin.click('button:has-text("Vista")');
  ok((await (await fetch(`${BASE}/`)).text()).includes(`Prufureitur ${stamp}`), 'Reitir á forsíðu breytast í stillingum');
  await admin.goto(`${BASE}/stjorn/stillingar`);
  await admin.fill('#home_tiles', tilesBefore);
  await admin.click('button:has-text("Vista")');

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
  await admin.click('button:has-text("Eyða")');
  await admin.waitForURL(/m=eytt/);

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

  // 5. Albúm með myndum
  await admin.goto(`${BASE}/stjorn/myndasofn/nytt`);
  await admin.fill('#f_title', `Albúm ${stamp}`);
  await admin.click('button:has-text("Vista")');
  await admin.waitForURL(/myndasofn\/\d+\?m=/);
  await admin.setInputFiles('.upload-drop input[type=file]', ['seed/media/ithrottaeldhugi.jpg', 'seed/media/sjalfbodalidar.png']);
  await admin.waitForSelector('.photo-grid figure:nth-child(2)', { timeout: 20000 });
  ok(await admin.locator('.photo-grid figure').count() === 2, 'Tvær myndir hlaðnar í albúm');

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
