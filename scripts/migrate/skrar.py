"""
Skráir allar myndir og skjöl sem flutt voru af gamla vefnum í töfluna media,
svo þær birtist í „Myndir og skjöl“ í vefumsjón. Skrárnar sjálfar eru þegar í R2.

  python3 scripts/migrate/skrar.py .migration/media-uploaded-<host>.txt > skrar.sql
"""
import mimetypes, os, sys, urllib.parse

done = [k for k in open(sys.argv[1]).read().split() if k.startswith('old/')]
names = {}
for line in open('.migration/media.tsv', encoding='utf-8'):
    if '\t' in line:
        url, key = line.rstrip('\n').split('\t')
        names[key] = urllib.parse.unquote(url.rsplit('/', 1)[-1])
# Merki félaga og styrktaraðila sem sett voru inn sérstaklega
extra = [('old/merki/' + f) for f in ('kfr.png', 'ondverdarnes.jpg', 'thorlakshofn.png')] + \
        [('old/styrktaradilar/' + f) for f in ('ISI-logo_2012_l.jpg', 'umfi_logo.jpg', 'lotto.png', '1x2.jpg', 'Hotel_ork_logo.png', 'ARION.jpg')]
esc = lambda s: "'" + s.replace("'", "''") + "'"
out = ['-- Búið til af scripts/migrate/skrar.py']
for key in sorted(set(done) | set(extra)):
    path = os.path.join('.migration/media', key)
    size = os.path.getsize(path) if os.path.exists(path) else 0
    ctype = mimetypes.guess_type(key)[0] or 'application/octet-stream'
    name = names.get(key, key.rsplit('/', 1)[-1])
    out.append(f"INSERT OR IGNORE INTO media (key, filename, content_type, size, created_at) VALUES ({esc(key)}, {esc(name)}, {esc(ctype)}, {size}, '2026-11-27 12:00:00');")
print('\n'.join(out))
print(f'{len(out) - 1} skrár', file=sys.stderr)
