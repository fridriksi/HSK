"""
Hreinsar tilvísanir í skrár sem eru horfnar af gamla vefnum (.migration/media-missing.txt):
  - forsíðumyndir frétta, viðburða, félaga og styrktaraðila verða tómar (HSK-merkið birtist í staðinn)
  - myndir í albúmum eru teknar út og forsíðumynd albúms verður fyrsta mynd sem er til
  - <img> í texta er fjarlægð og tengill á horfið skjal verður að venjulegum texta
  - skjöl í skjalasafni sem vísa á horfna skrá fá skýringu í stað tengils

  python3 scripts/migrate/horfnar.py afrit.db > horfnar.sql
"""
import re, sqlite3, sys

db = sqlite3.connect(sys.argv[1])
gone = {'/media/' + k for k in open('.migration/media-missing.txt').read().split()}
esc = lambda s: "'" + s.replace("'", "''") + "'"
out = ['-- Búið til af scripts/migrate/horfnar.py']
n = {}
def count(k): n[k] = n.get(k, 0) + 1

for table, col in [('news', 'image'), ('events', 'image'), ('clubs', 'logo'), ('sponsors', 'logo'), ('events', 'attachment'), ('results', 'attachment')]:
    for rid, v in db.execute(f"SELECT id, {col} FROM {table} WHERE {col} LIKE '/media/old/%'"):
        if v in gone:
            out.append(f"UPDATE {table} SET {col} = '' WHERE id = {rid};"); count(f'{table}.{col}')
for pid, src in db.execute("SELECT id, src FROM photos"):
    if src in gone:
        out.append(f"DELETE FROM photos WHERE id = {pid};"); count('photos')
for aid, cover in db.execute("SELECT id, cover FROM albums"):
    if cover in gone:
        alt = next((s for (s,) in db.execute('SELECT src FROM photos WHERE album_id = ? ORDER BY sort, id', (aid,)) if s not in gone), '')
        out.append(f"UPDATE albums SET cover = {esc(alt)} WHERE id = {aid};"); count('albums.cover')
for did, f, body in db.execute("SELECT id, file, body FROM documents WHERE file LIKE '/media/old/%'"):
    if f in gone:
        note = body or '<p>Skjalið fannst ekki þegar efni var flutt af gamla vefnum.</p>'
        out.append(f"UPDATE documents SET file = '', body = {esc(note)} WHERE id = {did};"); count('documents.file')

IMG = re.compile(r'<img\b[^>]*\bsrc="([^"]+)"[^>]*>')
A = re.compile(r'<a\b[^>]*\bhref="([^"]+)"[^>]*>(.*?)</a>', re.S)
for table, col in [('pages', 'body'), ('news', 'body'), ('events', 'description'), ('results', 'body'), ('documents', 'body'), ('committees', 'body'), ('clubs', 'description'), ('records', 'body')]:
    for rid, text in db.execute(f"SELECT id, {col} FROM {table} WHERE {col} LIKE '%/media/old/%'"):
        new = IMG.sub(lambda m: '' if m.group(1) in gone else m.group(0), text)
        new = A.sub(lambda m: m.group(2) if m.group(1) in gone else m.group(0), new)
        if new != text:
            out.append(f"UPDATE {table} SET {col} = {esc(new)} WHERE id = {rid};"); count(f'{table}.{col} (texti)')
print('\n'.join(out))
print(n, file=sys.stderr)
