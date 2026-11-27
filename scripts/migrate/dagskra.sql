-- Mótaskrá og Viðburðir sameinuð í eina síðu: Mót og úrslit → Dagskrá
UPDATE pages SET slug = 'dagskra', path = 'mot/dagskra', title = 'Dagskrá', module = 'events', sort = 10,
  body = '<p>Mót og viðburðir á vegum HSK og aðildarfélaganna. Mót eru merkt með bláu.</p>'
  WHERE path = 'mot/vidburdir';
DELETE FROM pages WHERE path = 'mot/motaskra';
INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES
  ('path:mot/motaskra', '/mot/dagskra?tegund=mot'), ('path:mot/vidburdir', '/mot/dagskra'), ('path:vidburdir', '/mot/dagskra');
UPDATE redirects SET new_path = '/mot/dagskra?tegund=mot' || replace(substr(new_path, 14), '?', '&') WHERE new_path LIKE '/mot/motaskra%';
UPDATE redirects SET new_path = '/mot/dagskra' || substr(new_path, 15) WHERE new_path LIKE '/mot/vidburdir%';
UPDATE settings SET value = replace(replace(value, '/mot/motaskra', '/mot/dagskra?tegund=mot'), 'Mótaskrá HSK |', 'Mótaskrá HSK |') WHERE key = 'quick_links';
