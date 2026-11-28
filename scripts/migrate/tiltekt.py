"""
Tiltekt (1. áfangi): býr til SQL sem
  - felur viðburði sem eru líka skráðir sem mót sama dag (mótið heldur sér, gamla slóðin vísar á það)
  - felur fréttir sem eru til í tveimur eintökum með sama texta (eldra eintakið heldur sér)
  - breytir gömlum hsk.is-tenglum í texta í nýjar slóðir
  - breytir feitletruðum málsgreinum sem eru í raun fyrirsagnir („1. gr.“) í fyrirsagnir

  python3 scripts/migrate/tiltekt.py afrit.db > tiltekt.sql
afrit.db er SQLite-afrit af D1 (wrangler d1 export … og hlaðið inn í sqlite).
Ekkert er eytt: færslur fá stöðuna „drög“ og má birta aftur í vefumsjón.
"""
import html, re, sqlite3, sys

db = sqlite3.connect(sys.argv[1])
q = lambda s, *a: db.execute(s, a).fetchall()
sql = ["-- Búið til af scripts/migrate/tiltekt.py"]
esc = lambda s: "'" + s.replace("'", "''") + "'"
plain = lambda h: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()
words = lambda t: {w for w in re.findall(r'\w+', t.lower()) if len(w) > 2 and w not in ('hsk', 'mót', 'móti', 'mótið')}

# ---- Viðburðir sem eru líka mót sama dag ----
by_day = {}
for r in q("SELECT id, kind, title, substr(starts_at,1,10), description, attachment, image FROM events WHERE status = 'published'"):
    by_day.setdefault(r[3], []).append(r)
hidden_ev = []
for day, rows in by_day.items():
    mots = [r for r in rows if r[1] == 'mot']
    for v in (r for r in rows if r[1] == 'vidburdur'):
        a = words(v[2])
        best = max(mots, key=lambda m: len(a & words(m[2])) / max(1, min(len(a), len(words(m[2])))), default=None)
        if not best or not a:
            continue
        b = words(best[2])
        score = len(a & b) / max(1, min(len(a), len(b)))
        # Aðeins ef viðburðurinn bætir engu við (lýsing styttri en mótsins)
        # Tölur (flokkar, aldur) og afmarkandi orð (karla, fatlaðra …) verða að passa
        nums = lambda t: set(re.findall(r'\d+', re.sub(r'\b(19|20)\d\d\b', '', t)))
        QUAL = {'karla', 'kvenna', 'fatlaðra', 'öldunga', 'unglinga', 'eldri', 'yngri', 'innanhúss', 'utanhúss', 'pilta', 'stúlkna', 'drengja', 'fullorðinna', 'seinni', 'fyrri'}
        qual = lambda t: {w for w in re.findall(r'\w+', t.lower()) if w in QUAL}
        same = nums(v[2]) <= nums(best[2]) and (not nums(v[2]) or nums(v[2]) == nums(best[2])) and qual(v[2]) <= qual(best[2])
        extra = (v[5] and v[5] != best[5]) or (v[6] and v[6] != best[6])  # viðburðurinn er með eigið fylgiskjal eða mynd
        if same and not extra and score >= 0.5 and len(plain(v[4])) <= max(40, len(plain(best[4]))):
            hidden_ev.append((v[0], best[0], v[2], best[2]))
for vid, mid, _, _ in hidden_ev:
    sql.append(f"UPDATE events SET status = 'draft', review_note = 'Tvískráð: sama og mót #{mid}' WHERE id = {vid};")
    sql.append(f"INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ('path:vidburdur/{vid}', '/vidburdur/{mid}');")

# ---- Fréttir í tveimur eintökum ----
hidden_news = []
for (body,) in q("SELECT body FROM news WHERE status = 'published' AND length(body) > 200 GROUP BY body HAVING count(*) > 1"):
    rows = q("SELECT id, slug, title FROM news WHERE body = ? AND status = 'published' ORDER BY published_at, id", body)
    keep = rows[0]
    for r in rows[1:]:
        hidden_news.append((r, keep))
        sql.append(f"UPDATE news SET status = 'draft', review_note = {esc('Tvítekin: sama og ' + keep[2])} WHERE id = {r[0]};")
        sql.append(f"INSERT OR REPLACE INTO redirects (old_key, new_path) VALUES ({esc('path:frett/' + r[1])}, {esc('/frett/' + keep[1])});")

# ---- Gamlir tenglar ----
redirects = dict(q("SELECT old_key, new_path FROM redirects"))
SECTIONS = {'verkefnasjodur': '/um-hsk/verkefnasjodur', 'frettir': '/frettir', 'log': '/um-hsk/log-og-reglugerdir',
            'fundarg': '/um-hsk/fundargerdir', 'urslit': '/mot/urslit', 'myndir': '/frettir/myndir'}
def resolve(href):
    m = re.search(r'default\.cfm\?([^"]*)', html.unescape(href))
    if not m:
        return None
    p = dict(kv.split('=', 1) for kv in m.group(1).split('&') if '=' in kv)
    page = p.get('page', '')
    key = f"{page}:{p.get('frett_id') or p.get('id') or p.get('grein') or p.get('flokkur') or ''}"
    new = redirects.get(key) or SECTIONS.get(page)
    for _ in range(3):  # fylgja færðum síðum
        nxt = new and redirects.get('path:' + new.strip('/').split('?')[0])
        if not nxt:
            break
        new = nxt
    return new
fixed_links = 0
def fix_links(text):
    global fixed_links
    def sub(m):
        global fixed_links
        new = resolve(m.group(1))
        if new:
            fixed_links += 1
            return f'href="{new}"'
        return m.group(0)
    return re.sub(r'href="((?:https?://(?:www\.)?hsk\.is)?/?(?:web/)?default\.cfm[^"]*)"', sub, text)

# ---- Fyrirsagnir ----
HEAD = re.compile(r'<p>\s*<strong>([^<]{1,80}?)</strong>\s*</p>')
def fix_heads(text):
    return HEAD.sub(lambda m: f'<h3>{m.group(1).strip()}</h3>', text)

changed = {}
for table, col in [('pages', 'body'), ('news', 'body'), ('committees', 'body'), ('clubs', 'description')]:
    for rid, text in q(f"SELECT id, {col} FROM {table} WHERE {col} LIKE '%default.cfm%'"):
        new = fix_links(text)
        if new != text:
            changed[(table, col, rid)] = new
heads = 0
for rid, path, title, text in q("SELECT id, path, title, body FROM pages WHERE path LIKE 'um-hsk/log-og-reglugerdir/%' OR path LIKE 'um-hsk/saga/%'"):
    cur = changed.get(('pages', 'body', rid), text)
    new = fix_heads(cur)
    # Fyrsta lína sem endurtekur titil síðunnar fer (titillinn er þegar efst)
    new = re.sub(r'^\s*<(?:h3|p)>\s*' + re.escape(title) + r'\s*</(?:h3|p)>\s*', '', new, flags=re.I)
    if new != cur:
        heads += 1
        changed[('pages', 'body', rid)] = new
for (table, col, rid), text in changed.items():
    sql.append(f"UPDATE {table} SET {col} = {esc(text)} WHERE id = {rid};")

print('\n'.join(sql))
print(f"Viðburðir faldir: {len(hidden_ev)}, fréttir faldar: {len(hidden_news)}, tenglar lagaðir: {fixed_links}, síður með nýjum fyrirsögnum: {heads}", file=sys.stderr)
if '-v' in sys.argv:
    for v in hidden_ev: print('EV', v, file=sys.stderr)
    for r, k in hidden_news: print('NEWS', r[2], '->', k[2], file=sys.stderr)
