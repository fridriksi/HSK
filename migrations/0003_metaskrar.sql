-- Metaskrár fá skýra reiti í stað þess að flokkun ráðist af heiti og tengli í texta
ALTER TABLE records ADD COLUMN category TEXT NOT NULL DEFAULT 'annad';
ALTER TABLE records ADD COLUMN year INTEGER;
ALTER TABLE records ADD COLUMN file TEXT NOT NULL DEFAULT '';

-- Fyrirliggjandi metaskrár: flokkur, ár og skrá lesin úr heiti og texta
UPDATE records SET category = CASE
    WHEN lower(title) LIKE '%fatla%' THEN 'fatladir'
    WHEN lower(title) LIKE '%öldung%' AND (lower(title) LIKE '%innanh%') THEN 'oldungar_inni'
    WHEN lower(title) LIKE '%öldung%' THEN 'oldungar_uti'
    WHEN lower(title) LIKE '%innanh%' THEN 'innanhuss'
    WHEN lower(title) LIKE '%utanh%' THEN 'utanhuss'
    ELSE 'annad' END;
UPDATE records SET category = 'reglur' WHERE title LIKE 'Hvaða þarf%';
UPDATE records SET year = CAST(substr(trim(title), -4) AS INTEGER) WHERE substr(trim(title), -4) BETWEEN '1990' AND '2099';
UPDATE records SET file = substr(body, instr(body, 'href="') + 6, instr(substr(body, instr(body, 'href="') + 6), '"') - 1)
  WHERE category <> 'reglur' AND instr(body, 'href="') > 0
    AND (length(body) - length(replace(body, 'href="', ''))) / 6 = 1;
-- Textinn var bara tengillinn á skrána
UPDATE records SET body = '' WHERE file <> '' AND length(trim(replace(replace(body, '<p>', ''), '</p>', ''))) < 400;
