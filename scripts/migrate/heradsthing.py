"""
Flytur héraðsþing úr undirsíðum („um-hsk/heradsthing/...“) yfir í töflurnar assemblies og assembly_docs.
Dagsetning og staður eru lesin úr heiti („Héraðsþing á Borg 26. mars 2026“) og þinggögn úr tenglum í texta.
Þing án dagsetningar verða drög. Undirsíðunum er eytt og slóðir þeirra vísa á kaflann á síðunni Héraðsþing.

  wrangler d1 execute DB --json --command "SELECT id, slug, title, body, status FROM pages WHERE parent_id = (SELECT id FROM pages WHERE path = 'um-hsk/heradsthing')" > sidur.json
  python3 scripts/migrate/heradsthing.py sidur.json > heradsthing.sql
"""
import html, json, re, sys

MONTHS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember']
esc = lambda s: "'" + s.replace("'", "''") + "'"

data = json.load(open(sys.argv[1]))
rows = data[0]['results'] if isinstance(data, list) else data
# Staður er í þágufalli í heitinu („á Hellu“); á vefnum birtist hann í nefnifalli
NOM = {'Hellu': 'Hella', 'Árnesi': 'Árnes', 'Aratungu': 'Aratunga', 'Selfossi': 'Selfoss', 'Hvolsvelli': 'Hvolsvöllur', 'Flúðum': 'Flúðir'}
out = ['-- Búið til af scripts/migrate/heradsthing.py']
for r in rows:
    m = re.search(r'(\d{1,2})\.\s*(' + '|'.join(MONTHS) + r')\s+(\d{4})', r['title'])
    date = f'{m.group(3)}-{MONTHS.index(m.group(2)) + 1:02d}-{int(m.group(1)):02d}' if m else None
    loc = re.search(r'\b(?:á|í)\s+(.+?)\s+\d', r['title'])
    links = [(h, html.unescape(re.sub(r'<[^>]+>', '', t)).strip()) for h, t in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', r['body'] or '', re.S)]
    links = [(h, t) for h, t in links if t and 'eldri-thing' not in h and 'default.cfm' not in h]
    status = 'published' if date and r['status'] == 'published' else 'draft'
    out.append(f"INSERT OR IGNORE INTO assemblies (slug, title, date, location, status) VALUES ({esc(r['slug'])}, {esc(r['title'])}, {esc(date) if date else 'NULL'}, {esc(NOM.get(loc.group(1), loc.group(1)) if loc else '')}, '{status}');")
    for i, (h, t) in enumerate(links):
        out.append(f"INSERT INTO assembly_docs (assembly_id, title, file, sort) SELECT id, {esc(t)}, {esc(h)}, {i * 10} FROM assemblies WHERE slug = {esc(r['slug'])} AND NOT EXISTS (SELECT 1 FROM assembly_docs d JOIN assemblies a ON a.id = d.assembly_id WHERE a.slug = {esc(r['slug'])} AND d.file = {esc(h)});")
    out.append(f"INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ({esc('path:um-hsk/heradsthing/' + r['slug'])}, {esc('/um-hsk/heradsthing#' + r['slug'])});")
    out.append(f"DELETE FROM pages WHERE id = {r['id']};")
out.append("UPDATE pages SET module = 'assemblies' WHERE path = 'um-hsk/heradsthing';")
print('\n'.join(out))
