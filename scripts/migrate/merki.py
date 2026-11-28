"""
Merki aðildarfélaga af gamla vefnum: myndin efst á félagssíðunni verður merki félagsins
og er tekin úr lýsingartextanum svo hún birtist ekki tvisvar.

  python3 scripts/migrate/merki.py afrit.db > merki.sql
"""
import os, re, sqlite3, sys, urllib.parse

db = sqlite3.connect(sys.argv[1])
tsv = {}
for l in open('.migration/media.tsv', encoding='utf-8'):
    if '\t' in l:
        u, k = l.rstrip('\n').split('\t')
        tsv[urllib.parse.unquote(u.split('/web/')[-1])] = k
gone = set(open('.migration/media-missing.txt').read().split())
SKIP = {77}  # Öndverðarnes: gamli vefurinn sýndi ranglega merki Kiðjabergs
esc = lambda s: "'" + s.replace("'", "''") + "'"
out = ['-- Búið til af scripts/migrate/merki.py']
for fn in sorted(os.listdir('.migration/cache/felag')):
    cid = int(fn[:-5])
    m = re.search(r'<img src="(img/fretta_myndir/[^"]+)"', open('.migration/cache/felag/' + fn, encoding='utf-8').read())
    k = m and tsv.get(m.group(1))
    if not k or k in gone or k.endswith('.psd') or cid in SKIP:
        continue
    row = db.execute('SELECT id, description FROM clubs WHERE legacy_id = ? AND logo = ?', (cid, '')).fetchone()
    if not row:
        continue
    desc = re.sub(r'<img\b[^>]*src="/media/' + re.escape(k) + r'"[^>]*>', '', row[1], count=1)
    desc = re.sub(r'<p>\s*</p>', '', desc).strip()
    out.append(f"UPDATE clubs SET logo = '/media/{k}', description = {esc(desc)} WHERE id = {row[0]};")
print('\n'.join(out))
print(f'{len(out) - 1} merki', file=sys.stderr)
