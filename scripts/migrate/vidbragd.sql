-- Viðbragðsáætlun flutt í Fundargerðir og skjöl (af frétt 8146 á gamla vefnum)
INSERT INTO documents (title, category, date, body, file)
  SELECT 'Samræmd viðbragðsáætlun fyrir íþrótta- og æskulýðsstarf', 'aaetlun', '2022-11-07',
    '<p>Samræmd viðbragðsáætlun vegna atvika og áfalla í íþrótta- og æskulýðsstarfi, t.d. slysa, veikinda, eineltis og ofbeldis. Unnin af BÍS, ÍBR, ÍSÍ, KFUM og K, Samskiptaráðgjafa íþrótta- og æskulýðsstarfs, Slysavarnafélaginu Landsbjörgu, UMFÍ og Æskulýðsvettvanginum.</p><p><a href="https://www.samskiptaradgjafi.is/verkfaerakista">Verkfærakista samskiptaráðgjafa</a> með fleiri leiðbeiningum og eyðublöðum.</p>',
    'https://www.samskiptaradgjafi.is/_files/ugd/48e44a_d4ea92bf07774bb1aab4f310deb56510.pdf'
  WHERE NOT EXISTS (SELECT 1 FROM documents WHERE category = 'aaetlun' AND title LIKE 'Samræmd viðbragðsáætlun%');
UPDATE pages SET status = 'draft', in_menu = 0 WHERE path = 'um-hsk/vidbragdsaaetlun';
INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ('path:um-hsk/vidbragdsaaetlun', '/um-hsk/fundargerdir?flokkur=aaetlun');
UPDATE settings SET value = replace(value, '/um-hsk/vidbragdsaaetlun', '/um-hsk/fundargerdir?flokkur=aaetlun') WHERE key = 'quick_links';
