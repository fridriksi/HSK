-- Endurskipulagning á „Um HSK“: skrifstofa í valmynd, héraðsþing og saga í eigin flokkum.
-- Keyrt einu sinni eftir innflutning (wrangler d1 execute DB --file scripts/migrate/um-hsk.sql).

-- Skrifstofa HSK (af gamla vefnum: hsk_uppl id=2)
INSERT OR IGNORE INTO pages (parent_id, slug, path, title, body, sort, in_menu) VALUES ((SELECT id FROM pages WHERE path='um-hsk'), 'skrifstofa', 'um-hsk/skrifstofa', 'Skrifstofa HSK',
'<p><strong>Þjónustumiðstöð HSK</strong> er til húsa í Selinu á íþróttavallarsvæðinu á Selfossi.</p>
<p><strong>Aðsetur:</strong> Engjavegi 48, 800 Selfoss</p>
<p><strong>Framkvæmdastjóri:</strong> Engilbert Olgeirsson</p>
<p><strong>Opið:</strong> Viðtals- og símatími framkvæmdastjóra er milli 10:00–12:00 og 13:00–15:00 alla virka daga.</p>
<p><strong>Sími:</strong> 482 1189<br><strong>Farsími framkvæmdastjóra:</strong> 899 6514<br><strong>Netfang:</strong> <a href="mailto:hsk@hsk.is">hsk@hsk.is</a></p>', 5, 1);
INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ('hsk_uppl:2', '/um-hsk/skrifstofa');

-- Tengillinn „Skrifstofa HSK“ efst á Um HSK fer (síðan er nú í valmyndinni)
UPDATE pages SET body = substr(body, instr(body, '</p>') + 4) WHERE path = 'um-hsk' AND body LIKE '<p>%Skrifstofa HSK</a></p>%' AND instr(body, '</p>') < 140;
UPDATE pages SET body = ltrim(body, char(10, 13, 32)) WHERE path = 'um-hsk';

-- Flokkar
INSERT OR IGNORE INTO pages (parent_id, slug, path, title, body, module, sort, in_menu) VALUES ((SELECT id FROM pages WHERE path='um-hsk'), 'heradsthing', 'um-hsk/heradsthing', 'Héraðsþing',
'<p>Héraðsþing HSK er haldið árlega og fer með æðsta vald í málefnum sambandsins. Hér eru upplýsingar og gögn frá þingunum.</p>', 'subpages', 35, 1);
INSERT OR IGNORE INTO pages (parent_id, slug, path, title, body, module, sort, in_menu) VALUES ((SELECT id FROM pages WHERE path='um-hsk'), 'saga', 'um-hsk/saga', 'Saga og viðurkenningar',
'<p>Fróðleikur um sögu HSK, íþróttafólk sambandsins og handhafa viðurkenninga frá upphafi.</p>', 'subpages', 60, 1);

-- Færa síður í flokkana (gamla slóðin vísar áfram á þá nýju)
DROP TABLE IF EXISTS mv; CREATE TABLE mv (old TEXT, cat TEXT, sort INTEGER);
INSERT INTO mv VALUES
 ('um-hsk/heradsthing-a-borg-26-mars-2026', 'um-hsk/heradsthing', 10),
 ('um-hsk/heradsthing-i-aratungu-27-mars-2025', 'um-hsk/heradsthing', 20),
 ('um-hsk/heradsthing-i-arnesi-14-mars-2024', 'um-hsk/heradsthing', 30),
 ('um-hsk/heradsthing-a-hellu-23-mars-2023', 'um-hsk/heradsthing', 40),
 ('um-hsk/eldri-thing', 'um-hsk/heradsthing', 50),
 ('um-hsk/ithrottamenn-hsk', 'um-hsk/saga', 10),
 ('um-hsk/sleifarhafar-hsk', 'um-hsk/saga', 20),
 ('um-hsk/skjaldarhafar-skarphedins-fra-upphafi', 'um-hsk/saga', 30),
 ('um-hsk/skjaldarhafar-berthoru-fra-upphafi', 'um-hsk/saga', 40),
 ('um-hsk/matmenn-hsk', 'um-hsk/saga', 50),
 ('um-hsk/hvatningarsongur-hsk-sem-sunginn-er-a-landsmotum', 'um-hsk/saga', 60);
INSERT OR REPLACE INTO redirects (old_key, new_path)
  SELECT 'path:' || mv.old, '/' || mv.cat || '/' || p.slug FROM mv JOIN pages p ON p.path = mv.old;
UPDATE redirects SET new_path = (SELECT '/' || mv.cat || '/' || p.slug FROM mv JOIN pages p ON p.path = mv.old WHERE '/' || mv.old = redirects.new_path)
  WHERE new_path IN (SELECT '/' || old FROM mv);
UPDATE pages SET
  parent_id = (SELECT id FROM pages c WHERE c.path = (SELECT cat FROM mv WHERE mv.old = pages.path)),
  sort = (SELECT sort FROM mv WHERE mv.old = pages.path),
  path = (SELECT cat FROM mv WHERE mv.old = pages.path) || '/' || slug
  WHERE path IN (SELECT old FROM mv);
DROP TABLE mv;
