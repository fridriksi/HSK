# Vefur HSK

Nýr vefur Héraðssambandsins Skarphéðins (hsk.is) með eigin vefumsjónarkerfi.
Keyrir á Cloudflare Workers með D1-gagnagrunni og R2-skráageymslu.

- **Vefurinn:** forsíða, fréttir, síður í veftré, viðburðadagatal, mótaskrá, úrslit, HSK met, aðildarfélög, nefndir, fundargerðir, myndasöfn, styrktaraðilar, leit, RSS og iCal-dagatal.
- **Vefumsjón á `/stjorn`:** starfsfólk HSK (@hsk.is) og formenn aðildarfélaga (eftir boði) skrá sig inn með innskráningartengli í tölvupósti eða Google.
- **Gamlar slóðir** (`/web/default.cfm?...`) vísa sjálfkrafa á nýju síðurnar.

Tillaga og hönnun: [`docs/tillaga.html`](docs/tillaga.html). Merki HSK: [`assets/merki/`](assets/merki/).

## Hlutverk

| Hlutverk | Hverjir | Má gera |
|---|---|---|
| Stjórnandi | Netföng í `ADMIN_EMAILS` | Allt, þar á meðal samþykkja innsent efni og stýra notendum |
| Ritstjóri | Allir með netfang á `STAFF_DOMAIN` (hsk.is) | Allt efni og síður, en ekki notendur eða samþykktir |
| Félagsaðgangur | Formenn sem stjórnandi hefur boðið | Uppfæra eigið félag, senda inn fréttir og viðburði til samþykktar |

## Þróun

```bash
npm install
cp .dev.vars.example .dev.vars   # setur stjornandi@hsk.is sem stjórnanda
npm run setup                    # afritar ritil, býr til gagnagrunn og setur inn upphafsgögn
npm run dev                      # http://localhost:8787
```

Í þróun er póstur ekki sendur. Innskráningartengillinn birtist þá á skjánum (`DEV_LOGIN_LINKS=true`).

```bash
npm run check   # tegundaprófun (TypeScript)
npm test        # prófar vef og vefumsjón frá enda til enda (þarf `npm run dev` í gangi)
```

## Uppbygging

```
src/index.tsx           Inngangur, öryggishausar, tilvísanir
src/routes/public.tsx   Opni vefurinn
src/routes/admin.tsx    Vefumsjón (/stjorn)
src/content-types.ts    Efnistegundir og reitir. Ný efnistegund = ný færsla hér + tafla í migrations/
src/auth.ts             Innskráning (tengill í pósti, Google), setur, réttindi
src/views/              Útlit (JSX)
migrations/             Gagnagrunnur (D1)
public/                 CSS, JS, merki. TinyMCE er afritað í public/vendor við uppsetningu
seed/                   Upphafsgögn til prófunar
```

## Uppfæra metaskrár

Bættu eða uppfærðu færslu í `scripts/record-book-sources.json` og tengdu sömu
Excel-skrá við metaskrána í vefumsjón. `file` er slóðin úr vefumsjón og `source`
er opinber slóð á frumskrána. Vefurinn opnar tengilinn sem töflu þegar skráin er
í innfluttu gögnunum. Keyrðu svo úr rót verkefnisins og vistaðu breytta gagnaskrá
með kóðanum.

```bash
python -m pip install xlrd==2.0.2 openpyxl==3.1.5
python scripts/import-record-books.py
```

## Uppsetning á Cloudflare

1. Búa til gagnagrunn og geymslu:
   ```bash
   npx wrangler d1 create hsk          # setja database_id í wrangler.jsonc
   npx wrangler r2 bucket create hsk-media
   npx wrangler d1 migrations apply hsk --remote
   ```
2. Stilla `SITE_URL` í `wrangler.jsonc` og setja leyndarmál:
   ```bash
   npx wrangler secret put ADMIN_EMAILS   # netföng stjórnenda, komma á milli
   npx wrangler secret put LOGIN_KEY      # langur slembilykill; <SITE_URL>/stjorn/lykill?k=… skráir fyrsta stjórnanda inn
   ```
3. Póstur: virkja Cloudflare Email Sending fyrir lénið og bæta við
   `"send_email": [{ "name": "EMAIL" }]` og `EMAIL_FROM` (t.d. `vefur@hsk.is`).
4. Google-innskráning (valkvætt): `npx wrangler secret put GOOGLE_CLIENT_ID` og `GOOGLE_CLIENT_SECRET`.
   Slóð til baka: `<SITE_URL>/stjorn/google/callback`.
5. `npm run deploy`
