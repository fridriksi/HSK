-- Einfaldari aðalvalmynd: Viðburðir undir „Mót og úrslit“, Myndir undir „Fréttir“.
INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ('path:vidburdir', '/mot/vidburdir'), ('path:myndir', '/frettir/myndir');
UPDATE pages SET parent_id = (SELECT id FROM pages WHERE path = 'mot'), path = 'mot/vidburdir', sort = 15 WHERE path = 'vidburdir';
UPDATE pages SET parent_id = (SELECT id FROM pages WHERE path = 'frettir'), path = 'frettir/myndir', sort = 30 WHERE path = 'myndir';
UPDATE redirects SET new_path = '/mot/vidburdir' || substr(new_path, 11) WHERE new_path = '/vidburdir' OR new_path LIKE '/vidburdir?%';
UPDATE redirects SET new_path = '/frettir/myndir' || substr(new_path, 8) WHERE new_path = '/myndir' OR new_path LIKE '/myndir?%';
