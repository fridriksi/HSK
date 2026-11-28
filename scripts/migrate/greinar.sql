-- Greinar og Aðsendar greinar sameinaðar; Dagskrá heitir „Mót og viðburðir“
UPDATE pages SET title = 'Mót og viðburðir' WHERE path = 'mot/dagskra';
UPDATE pages SET body = '<p>Greinar um íþrótta- og félagsstarf, ásamt aðsendum greinum. Aðsendar greinar eru merktar sem slíkar.</p>' WHERE path = 'frettir/greinar' AND body = '';
DELETE FROM pages WHERE path = 'frettir/adsendar-greinar';
INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ('path:frettir/adsendar-greinar', '/frettir/greinar');
UPDATE redirects SET new_path = '/frettir/greinar' || substr(new_path, 25) WHERE new_path LIKE '/frettir/adsendar-greinar%';
