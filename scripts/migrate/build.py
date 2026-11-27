"""
Les hrátt HTML úr .migration/cache/ (sjá crawl.py) og býr til:
  .migration/import.sql   – SQL sem hleður öllu efni inn í gagnagrunninn
  .migration/media.tsv    – listi yfir myndir og skjöl sem þarf að sækja (gömul slóð → lykill í R2)
  .migration/report.txt   – samanburðarskýrsla

  python3 scripts/migrate/build.py
"""
import html
import json
import os
import re
import unicodedata
from html.parser import HTMLParser
from urllib.parse import urljoin, unquote, urlparse, parse_qs

import classify

CACHE = '.migration/cache'
OUT = '.migration'
OLD = 'https://www.hsk.is/web/default.cfm'

MONTHS = {m: i for i, m in enumerate(['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'], 1)}
IS_MAP = {'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ý': 'y', 'ð': 'd', 'þ': 'th', 'æ': 'ae', 'ö': 'o'}

media: dict[str, str] = {}   # gömul slóð -> lykill í R2


def slugify(s: str) -> str:
    s = ''.join(IS_MAP.get(c, c) for c in s.lower())
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:80] or 'efni'


def fix_text(s: str) -> str:
    """Síðurnar voru lesnar sem ISO-8859-1 en eru í raun Windows-1252 („“ – o.fl.)."""
    return re.sub(r'[\x80-\x9f]', lambda m: m.group(0).encode('latin-1').decode('cp1252', errors='replace'), s)


def read(key: str) -> str | None:
    p = os.path.join(CACHE, key + '.html')
    if not os.path.exists(p):
        return None
    return fix_text(open(p, encoding='utf-8').read())


def text(h: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h or ''))).strip()


def parse_is_date(s: str) -> str | None:
    s = s.strip()
    m = re.match(r'(\d{1,2})\.\s*([a-záéíóúýþæö]+)\s+(\d{4})', s, re.I)
    if m and m.group(2).lower() in MONTHS:
        return f'{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'
    m = re.match(r'(\d{1,2})\.(\d{1,2})\.(\d{4})', s)
    if m:
        return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
    return None


def media_key(url: str) -> str:
    """Gömul slóð á skrá -> /media/old/… á nýja vefnum."""
    u = urlparse(url)
    path = unquote(u.path).lstrip('/')
    path = re.sub(r'^web/', '', path)
    safe = '/'.join(re.sub(r'[^A-Za-z0-9._-]+', '_', seg) for seg in path.split('/'))
    key = 'old/' + safe
    media[url] = key
    return '/media/' + key


FILE_EXT = re.compile(r'\.(jpe?g|png|gif|webp|bmp|pdf|docx?|xlsx?|pptx?|rtf|txt|zip)$', re.I)


def absolute(href: str, base: str) -> str:
    href = html.unescape(href.strip()).replace('\\', '/')
    return urljoin(base, href.replace(' ', '%20'))


def inline_image(data_uri: str) -> str:
    """Myndir sem voru límdar beint inn í texta (data:) eru vistaðar sem sérstakar skrár."""
    import base64
    import hashlib
    m = re.match(r'data:image/(jpeg|jpg|png|gif|webp);base64,(.+)', data_uri, re.S)
    if not m:
        return ''
    raw = base64.b64decode(re.sub(r'\s+', '', m.group(2)) + '==')
    key = f"old/inline/{hashlib.sha1(raw).hexdigest()[:16]}.{'jpg' if m.group(1) in ('jpeg', 'jpg') else m.group(1)}"
    path = os.path.join(OUT, 'media', key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(raw)
    media['inline:' + key] = key
    return '/media/' + key


def rewrite_url(href: str, base: str = 'https://www.hsk.is/web/') -> str:
    if href.startswith('data:'):
        return inline_image(href)
    if not href or href.startswith(('#', 'mailto:', 'tel:', 'javascript:')):
        return '' if href.startswith('javascript:') else href
    url = absolute(href, base)
    host = urlparse(url).netloc.lower()
    if host in ('www.hsk.is', 'hsk.is'):
        path = urlparse(url).path
        if FILE_EXT.search(unquote(path)):
            return media_key(url)
        if path.endswith('.cfm'):
            # Gamlar innri slóðir: nýi vefurinn vísar þeim áfram
            return '/web/' + path.split('/')[-1] + ('?' + urlparse(url).query if urlparse(url).query else '')
        return url
    return url


# ---------- Hreinsun á HTML ----------

ALLOWED = {
    'p': [], 'br': [], 'strong': [], 'b': [], 'em': [], 'i': [], 'u': [], 's': [], 'sub': [], 'sup': [],
    'h2': [], 'h3': [], 'h4': [], 'blockquote': [], 'pre': [], 'hr': [],
    'ul': [], 'ol': [], 'li': [], 'a': ['href'], 'img': ['src', 'alt'],
    'table': [], 'thead': [], 'tbody': [], 'tr': [], 'th': ['colspan', 'rowspan'], 'td': ['colspan', 'rowspan'], 'caption': [],
    'iframe': ['src'], 'figure': [], 'figcaption': [],
}
RENAME = {'h1': 'h2', 'h5': 'h4', 'h6': 'h4', 'center': 'p', 'div': 'p'}
DROP_WITH_CONTENT = {'script', 'style', 'noscript', 'object', 'embed', 'form', 'select', 'button', 'head', 'title'}
VOID = {'br', 'img', 'hr'}


class Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_WITH_CONTENT:
            self.skip += 1
            return
        if self.skip:
            return
        tag = RENAME.get(tag, tag)
        if tag not in ALLOWED:
            return
        if tag == 'p' and 'p' in self.stack:  # div inni í p
            return
        keep = []
        for k, v in attrs:
            if k in ALLOWED[tag] and v is not None:
                if k in ('href', 'src'):
                    v = rewrite_url(v)
                    if not v or (tag == 'iframe' and not re.match(r'https://(www\.)?(youtube(-nocookie)?\.com/embed/|player\.vimeo\.com/)', v)):
                        if tag == 'iframe':
                            self.skip += 1
                            return
                        continue
                keep.append(f'{k}="{html.escape(v, quote=True)}"')
        if tag == 'a' and any(a.startswith('href="http') for a in keep):
            keep.append('rel="noopener"')
        if tag == 'img' and not any(a.startswith('src=') for a in keep):
            return
        self.out.append(f'<{tag}{" " if keep else ""}{" ".join(keep)}>')
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            if tag == 'iframe':
                self.skip = max(0, self.skip - 1)
            return
        tag = RENAME.get(tag, tag)
        if tag in self.stack:
            while self.stack:
                t = self.stack.pop()
                self.out.append(f'</{t}>')
                if t == tag:
                    break

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.stack:
            self.out.append(f'</{self.stack.pop()}>')
        s = ''.join(self.out)
        s = s.replace('\xa0', ' ')
        s = re.sub(r'<(p|strong|em|b|i|span|u)>\s*</\1>', '', s)
        s = re.sub(r'<p>\s*(<br>\s*)+', '<p>', s)
        s = re.sub(r'(<br>\s*){3,}', '<br><br>', s)
        s = re.sub(r'[ \t]+', ' ', s)
        s = re.sub(r'\s*\n\s*', '\n', s)
        # Texti utan málsgreina
        if s.strip() and not s.lstrip().startswith('<'):
            s = '<p>' + s.strip() + '</p>'
        return s.strip()


def clean(h: str) -> str:
    c = Cleaner()
    c.feed(h or '')
    c.close()
    return c.result()


# ---------- Útdráttur úr síðum gamla kerfisins ----------

def main_block(page: str) -> str:
    i = page.find('<section id="main"')
    if i < 0:
        return ''
    j = page.find('frontpage-boxes-top-second', i)
    return page[i:j if j > 0 else len(page)]


def news_item(page: str) -> dict | None:
    """Fyrsta greinin (article.news-item) í aðalefni síðunnar."""
    block = main_block(page)
    h2 = re.search(r'(?s)<h2>\s*<a[^>]*>(.*?)</a>\s*</h2>', block)
    m = re.search(r'(?s)<article class="news-item">(.*?)</article>', block)
    if not m:
        return None
    a = m.group(1)
    if 'news-item-left' in a and 'class="dates"' not in a and '<section' not in a:
        return None
    dates = re.search(r'class="dates">([^<]*)</span>', a)
    h3 = re.search(r'(?s)<h3 class="headlines">(.*?)</h3>', a)
    sec = re.search(r'(?s)<section>(.*)</section>', a)
    after = a[sec.end():] if sec else ''
    return {
        'h2': text(h2.group(1)) if h2 else '',
        'dates': dates.group(1).strip() if dates else '',
        'h3_html': h3.group(1) if h3 else '',
        'h3': text(h3.group(1)) if h3 else '',
        'section': sec.group(1) if sec else '',
        'after': after,
        'block': block,
    }


def lead_image(section: str) -> tuple[str, str]:
    """Fyrsta mynd í frétt (stór útgáfa) er tekin út sem forsíðumynd."""
    m = re.match(r'(?s)\s*<a href="([^"]+)"[^>]*>\s*<img src="([^"]+)"[^>]*>\s*</a>', section)
    if not m:
        return '', section
    big = m.group(1) if FILE_EXT.search(m.group(1)) else m.group(2)
    return rewrite_url(big), section[m.end():]


def table_rows(block: str) -> list[list[str]]:
    rows = []
    for tr in re.findall(r'(?s)<tr[^>]*>(.*?)</tr>', block):
        cells = re.findall(r'(?s)<td[^>]*>(.*?)</td>', re.sub(r'(?s)<!--.*?-->', '', tr))
        if cells:
            rows.append(cells)
    return rows


def first_link(h: str) -> str:
    m = re.search(r'href="([^"]+)"', h)
    if not m:
        return ''
    u = rewrite_url(m.group(1))
    return u if u.startswith('/media/') or u.startswith('http') else ''


def files(sub: str) -> list[str]:
    d = os.path.join(CACHE, sub)
    if not os.path.isdir(d):
        return []
    return sorted((f[:-5] for f in os.listdir(d) if f.endswith('.html')), key=lambda x: int(x) if x.isdigit() else 0)


def q(v) -> str:
    if v is None:
        return 'NULL'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


SPORTS = {
    'badminton': 'Badminton', 'blak': 'Blak', 'borðtennis': 'Borðtennis', 'bridds': 'Bridds', 'frjáls': 'Frjálsíþróttir',
    'glím': 'Glíma', 'golf': 'Golf', 'hesta': 'Hestaíþróttir', 'fatlaðra': 'Íþróttir fatlaðra', 'knattspyrn': 'Knattspyrna', 'fótbolt': 'Knattspyrna',
    'körfu': 'Körfuknattleikur', 'skák': 'Skák', 'skot': 'Skotíþróttir', 'starfsíþrótt': 'Starfsíþróttir', 'sund': 'Sund',
    'fimleik': 'Fimleikar', 'handknatt': 'Handknattleikur', 'júdó': 'Júdó', 'judo': 'Júdó', 'taekwondo': 'Taekwondo', 'pílu': 'Pílukast',
    'motocross': 'Motocross', 'boccia': 'Boccia', 'bogfimi': 'Bogfimi', 'hjól': 'Hjólreiðar', 'skíð': 'Skíði', 'karate': 'Karate',
}


def guess_sport(*texts: str) -> str:
    t = ' '.join(texts).lower()
    for k, v in SPORTS.items():
        if k in t:
            return v
    return ''


def main():
    sql: list[str] = []
    report: list[str] = []
    redirects: dict[str, str] = {}

    # ---- Fréttir ----
    slugs: set[str] = set()

    def uniq(base: str) -> str:
        s = slugify(base)
        n, out = 2, s
        while out in slugs:
            out = f'{s}-{n}'
            n += 1
        slugs.add(out)
        return out

    news_count = 0
    candidates = []
    for fid in files('frett'):
        it = news_item(read(f'frett/{fid}') or '')
        if not it or not it['dates'] or not it['h3']:
            continue
        date = parse_is_date(it['dates'])
        if date:
            candidates.append((int(fid), date, it))
    hsk = classify.hsk_ids([(f, d) for f, d, _ in candidates])
    skipped = [(f, it['h3']) for f, d, it in candidates if f not in hsk or re.match(r'^(prufa|test|bara að prófa)', it['h3'], re.I)]
    skipped_ids = {f for f, _ in skipped}
    for fid, date, it in candidates:
        if fid in skipped_ids:
            continue
        img, body = lead_image(it['section'])
        title = it['h3'][:300]
        slug = uniq(title)
        body = clean(body)
        sql.append(f"INSERT INTO news (slug,title,body,image,kind,status,published_at,legacy_id) VALUES ({q(slug)},{q(title)},{q(body)},{q(img)},'frett','published',{q(date + ' 12:00:00')},{int(fid)});")
        redirects[f'frettirnar:{fid}'] = f'/frett/{slug}'
        news_count += 1
    report.append(f'Fréttir: {news_count} (sleppt {len(skipped)} fréttum annarra vefja á sama kerfi)')
    with open(os.path.join(OUT, 'skipped-news.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(f'{i}\t{t}' for i, t in skipped))

    # ---- Greinar og aðsendar greinar ----
    adsgr = read('list/adsgr') or ''
    adsend_ids = set(re.findall(r'frett_id=(\d+)&brid=0&lang=1&page=greinarnar', adsgr))
    n_gr = 0
    for gid in files('grein'):
        it = news_item(read(f'grein/{gid}') or '')
        if not it or not it['h3']:
            continue
        date = parse_is_date(it['dates']) or '2000-01-01'
        img, body = lead_image(it['section'])
        # Höfundur er stundum fyrsta lína greinar
        author = ''
        am = re.search(r'(?s)<h4[^>]*>(.*?)</h4>', it['block'])
        if am:
            author = text(am.group(1))[:120]
        title = it['h3'][:300]
        slug = uniq(title)
        kind = 'adsend' if gid in adsend_ids else 'grein'
        sql.append(f"INSERT INTO news (slug,title,body,image,kind,author,status,published_at,legacy_id) VALUES ({q(slug)},{q(title)},{q(clean(body))},{q(img)},{q(kind)},{q(author)},'published',{q(date + ' 12:00:00')},NULL);")
        redirects[f'greinarnar:{gid}'] = f'/frett/{slug}'
        n_gr += 1
    report.append(f'Greinar og aðsendar greinar: {n_gr}')

    # ---- Síður (sidur og hsk_uppl) undir „Um HSK“ ----
    page_rows = []
    used_paths = set()
    # Síðutaflan er sameiginleg með öðrum vefjum: aðeins síður sem efni HSK vísar á eru teknar með
    ref_pat = re.compile(r'id=(\d+)(?:&amp;|&)page=sidur|page=sidur(?:&amp;|&)[^"]*?id=(\d+)')
    referenced: set[str] = set()
    for sub in os.listdir(CACHE):
        if sub in ('sida', 'vidburdur'):
            continue
        for fn in os.listdir(os.path.join(CACHE, sub)):
            if sub == 'frett' and (int(fn[:-5]) not in hsk or int(fn[:-5]) in skipped_ids):
                continue
            for a, b in ref_pat.findall(open(os.path.join(CACHE, sub, fn), encoding='utf-8').read()):
                referenced.add(a or b)
    frontier = set(referenced)
    while frontier:  # síður sem vísa á aðrar síður
        nxt = set()
        for pid in frontier:
            for a, b in ref_pat.findall(read(f'sida/{pid}') or ''):
                if (a or b) not in referenced:
                    nxt.add(a or b)
        referenced |= nxt
        frontier = nxt
    for prefix, oldpage in (('sida', 'sidur'), ('hsk_uppl', 'hsk_uppl')):
        for pid in files(prefix):
            if prefix == 'sida' and pid not in referenced:
                continue
            it = news_item(read(f'{prefix}/{pid}') or '')
            if not it:
                continue
            title = it['h3'] or it['h2']
            body = clean(it['section'])
            if not title or (not text(body) and '<img' not in body):
                continue
            merge = {'Um HSK': 'um-hsk', 'Verkefnasjóður HSK': 'um-hsk/verkefnasjodur'}.get(title)
            if merge:
                sql.append(f"UPDATE pages SET body={q(body)} WHERE path={q(merge)};")
                redirects[f'{oldpage}:{pid}'] = '/' + merge
                continue
            slug = slugify(title)
            path = f'um-hsk/{slug}'
            n = 2
            while path in used_paths:
                path = f'um-hsk/{slug}-{n}'
                n += 1
            used_paths.add(path)
            page_rows.append((title, path.split('/')[-1], path, body))
            redirects[f'{oldpage}:{pid}'] = '/' + path
    for i, (title, slug, path, body) in enumerate(page_rows):
        sql.append(f"INSERT INTO pages (parent_id,slug,path,title,body,sort,in_menu) VALUES ((SELECT id FROM pages WHERE path='um-hsk'),{q(slug)},{q(path)},{q(title)},{q(body)},{100 + i * 10},0);")
    report.append(f'Stakar síður: {len(page_rows)}')

    # ---- Aðildarfélög ----
    n_cl = 0
    for cid in files('felag'):
        it = news_item(read(f'felag/{cid}') or '')
        if not it:
            continue
        name = it['h2'] or it['h3']
        if not name:
            continue
        body = clean(it['section'] or it['h3_html'])
        t = text(body)
        web = re.search(r'Vefsíða:\s*(\S+)', t)
        mail = re.search(r'Netfang félags:\s*(\S+@\S+)', t)
        sql.append(f"UPDATE clubs SET description={q(body)}, website=CASE WHEN website='' THEN {q(('https://' + web.group(1).removeprefix('http://').removeprefix('https://')) if web else '')} ELSE website END, email=CASE WHEN email='' THEN {q(mail.group(1).rstrip('.') if mail else '')} ELSE email END WHERE legacy_id={int(cid)};")
        redirects[f'felogin:{cid}'] = f'SQL:\'/felag/\' || (SELECT slug FROM clubs WHERE legacy_id={int(cid)})'
        sql.append(f"INSERT INTO clubs (slug,name,description,legacy_id) SELECT {q(slugify(name))},{q(name)},{q(body)},{int(cid)} WHERE NOT EXISTS (SELECT 1 FROM clubs WHERE legacy_id={int(cid)}) AND NOT EXISTS (SELECT 1 FROM clubs WHERE slug={q(slugify(name))});")
        n_cl += 1
    report.append(f'Aðildarfélög með upplýsingasíðu: {n_cl}')

    # ---- Nefndir ----
    nlist = read('list/nefndir') or ''
    order = re.findall(r'id=(\d+)&page=nefndirnar', nlist)
    n_ne = 0
    for nid in files('nefnd'):
        it = news_item(read(f'nefnd/{nid}') or '')
        if not it:
            continue
        name = it['h2'] or it['h3']
        if not name:
            continue
        sort = (order.index(nid) + 1) * 10 if nid in order else 999
        sql.append(f"INSERT INTO committees (name,body,sort,legacy_id) VALUES ({q(name)},{q(clean(it['section'] or it['h3_html']))},{sort},{int(nid)});")
        redirects[f'nefndirnar:{nid}'] = '/um-hsk/stjorn-nefndir-og-rad'
        n_ne += 1
    report.append(f'Stjórn, nefndir og ráð: {n_ne}')

    # ---- Lög og reglugerðir: ein síða með köflum ----
    llist = read('list/log') or ''
    law_order = re.findall(r'id=(\d+)&page=login', llist.replace(' ', ''))
    law_parts = []
    for lid in sorted(files('log'), key=lambda x: law_order.index(x) if x in law_order else 999):
        it = news_item(read(f'log/{lid}') or '')
        if not it:
            continue
        title = it['h2'] or it['h3']
        body = clean(it['section'])
        if title and text(body):
            law_parts.append((lid, title, body))
    if law_parts:
        # Hver lög/reglugerð fær sína undirsíðu (allt saman færi yfir hámarksstærð í D1)
        typos = {'Relgugerð': 'Reglugerð', 'hérðaðsmót': 'héraðsmót'}
        for i, (lid, t, b) in enumerate(law_parts):
            for wrong, right in typos.items():
                t = t.replace(wrong, right)
            slug = slugify(t)
            path = f'um-hsk/log-og-reglugerdir/{slug}'
            sql.append(f"INSERT INTO pages (parent_id,slug,path,title,body,sort,in_menu) VALUES ((SELECT id FROM pages WHERE path='um-hsk/log-og-reglugerdir'),{q(slug)},{q(path)},{q(t)},{q(b)},{(i + 1) * 10},0);")
            redirects[f'login:{lid}'] = '/' + path
        # Listinn á yfirsíðunni er búinn til sjálfkrafa úr undirsíðunum (module 'laws')
        sql.append("UPDATE pages SET module='laws', body='<p>Lög Héraðssambandsins Skarphéðins og reglugerðir sambandsins.</p>' WHERE path='um-hsk/log-og-reglugerdir';")
    report.append(f'Lög og reglugerðir (kaflar): {len(law_parts)}')

    # ---- Fundargerðir og skjöl ----
    n_doc = 0
    for gid in files('fundargerd'):
        page = read(f'fundargerd/{gid}') or ''
        block = main_block(page)
        h4 = re.search(r'(?s)<h4[^>]*>(.*?)</h4>', block)
        cat_name = text(h4.group(1)) if h4 else ''
        if not table_rows(block):
            continue
        low = cat_name.lower()
        cat = 'arsskyrsla' if 'ársskýrsl' in low else 'log' if 'lög' in low or 'reglu' in low else 'eydublad' if 'eyðubl' in low else 'fundargerd'
        for cells in table_rows(block):
            d = parse_is_date(text(cells[0]))
            if not d:
                continue
            title = text(cells[1])
            if cat == 'fundargerd' and cat_name and cat_name.split('-')[-1].strip().lower() not in title.lower():
                title = f"{title} ({cat_name.split('-')[-1].strip()})"
            link = first_link(cells[-1])
            if not title:
                continue
            sql.append(f"INSERT INTO documents (title,category,date,file,legacy_id) VALUES ({q(title)},{q(cat)},{q(d)},{q(link)},{int(gid)});")
            n_doc += 1
        redirects[f'fundargerd:{gid}'] = f'/um-hsk/fundargerdir?flokkur={cat}'
    report.append(f'Fundargerðir og skjöl: {n_doc}')

    # ---- Úrslit ----
    n_res = 0
    for gid in files('urslit_grein'):
        block = main_block(read(f'urslit_grein/{gid}') or '')
        h = re.search(r'Úrslit\s*-\s*([^<]+)<', block)
        sport_name = h.group(1).strip() if h else ''
        sport = guess_sport(sport_name) or sport_name
        for cells in table_rows(block):
            if len(cells) < 3:
                continue
            d = parse_is_date(text(cells[0]))
            if not d:
                continue
            title = text(cells[1])
            place = text(cells[2]) if len(cells) > 3 else ''
            link = first_link(cells[-1])
            if not title:
                continue
            body = f'<p>Staður: {html.escape(place)}</p>' if place else ''
            sql.append(f"INSERT INTO results (title,date,sport,body,attachment,status,legacy_id) VALUES ({q(title)},{q(d)},{q(sport)},{q(body)},{q(link)},'published',{int(gid)});")
            n_res += 1
        redirects[f'urslitin:{gid}'] = f'/mot/urslit?grein={sport}'
    report.append(f'Úrslit: {n_res}')

    # ---- Viðburðir og mót ----
    def event_rows(sub: str, kind: str) -> int:
        n = 0
        cands = []
        for eid in files(sub):
            it = news_item(read(f'{sub}/{eid}') or '')
            ds = re.findall(r'\d{1,2}\.\d{1,2}\.\d{4}', it['dates']) if it else []
            if it and ds and parse_is_date(ds[0]):
                cands.append((int(eid), parse_is_date(ds[0])))
        ok = classify.hsk_ids(cands, min_id=0) if kind == 'vidburdur' else {c[0] for c in cands}
        for eid in files(sub):
            if int(eid) not in ok:
                continue
            it = news_item(read(f'{sub}/{eid}') or '')
            if not it or not it['dates']:
                continue
            title = it['h2']
            ds = re.findall(r'\d{1,2}\.\d{1,2}\.\d{4}', it['dates'])
            if not title or not ds:
                continue
            if kind == 'vidburdur' and (parse_is_date(ds[0]) < classify.EVENTS_FROM or not classify.looks_like_hsk(title, text(it['h3_html'] + it['section']))):
                skipped_events.append((eid, title))
                continue
            start, end = parse_is_date(ds[0]), parse_is_date(ds[-1])
            desc = clean(it['h3_html'] + it['section'])
            link = first_link(it['section'])
            if link and not link.startswith('/media/'):
                link = ''
            tm = re.search(r'kl\.?\s*(\d{1,2})[:.](\d{2})', text(desc))
            starts = f'{start} {int(tm.group(1)):02d}:{tm.group(2)}:00' if tm and start == end else start
            sport = guess_sport(title) if kind == 'mot' else ''
            sql.append(f"INSERT INTO events (kind,title,starts_at,ends_at,description,sport,attachment,status,legacy_id) VALUES ({q(kind)},{q(title)},{q(starts)},{q(end if end != start else None)},{q(desc)},{q(sport)},{q(link)},'published',{int(eid)});")
            redirects[f'{"vidburdir" if kind == "vidburdur" else "motaskra"}:{eid}'] = f'/web/legacy-event/{kind}/{eid}'
            n += 1
        return n
    skipped_events: list[tuple[str, str]] = []
    n_ev = event_rows('vidburdur', 'vidburdur')
    with open(os.path.join(OUT, 'skipped-events.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(f'{i}\t{t}' for i, t in skipped_events))
    n_mot = event_rows('mot', 'mot')
    report.append(f'Viðburðir: {n_ev} (sleppt {len(skipped_events)} viðburðum annarra vefja)')
    report.append(f'Mót í mótaskrá: {n_mot}')

    # ---- HSK met ----
    n_met = 0
    for mid in files('met'):
        it = news_item(read(f'met/{mid}') or '')
        if not it:
            continue
        title = it['h2'] or it['h3']
        body = clean((it['section'] or it['h3_html']) + it['after'])
        if not title or (not text(body) and '<a' not in body):
            continue
        sql.append(f"INSERT INTO records (title,sport,body,sort,legacy_id) VALUES ({q(title)},{q(guess_sport(title))},{q(body)},{n_met * 10},{int(mid)});")
        redirects[f'hsk_met1:{mid}'] = '/mot/hsk-met'
        n_met += 1
    # Metaskrár sem skjöl (hsk_met_c)
    mc = main_block(read('list/met_c') or '')
    for a_href, a_text in re.findall(r'(?s)<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', mc):
        link = rewrite_url(a_href)
        if link.startswith('/media/'):
            title = text(a_text)
            yr = re.search(r'(19|20)\d{2}', title)
            sql.append(f"INSERT INTO documents (title,category,date,file) VALUES ({q(title)},'met',{q((yr.group(0) if yr else '2000') + '-12-31')},{q(link)});")
            n_met += 1
    report.append(f'HSK met (skrár og skjöl): {n_met}')

    # ---- Myndasöfn ----
    n_alb = n_ph = 0
    last_year = '2006'  # albúm eru í tímaröð; albúm án ártals fá ár næsta albúms á undan
    for aid in files('album'):
        page = read(f'album/{aid}') or ''
        if 'lucee' in page.lower() and 'SESSLANG' in page:
            continue
        t = re.search(r'(?s)<body>\s*<p><font[^>]*>(.*?)</font>', page)
        title = text(t.group(1)) if t else ''
        imgs = re.findall(r'<a href="(https?://[^"]+/myndir/midsize/[^"]+)"', page)
        imgs = [u for u in imgs if re.search(r'\.(jpe?g|png|gif)$', u, re.I)]
        if not title or not imgs:
            continue
        yr = re.search(r'(19|20)\d{2}', title)
        if yr:
            last_year = yr.group(0)
        date = f'{yr.group(0) if yr else last_year}-01-01'
        slug = f'{slugify(title)}-{aid}'
        srcs = [media_key(u) for u in imgs]
        sql.append(f"INSERT INTO albums (slug,title,date,cover,legacy_id) VALUES ({q(slug)},{q(title)},{q(date)},{q(srcs[0])},{int(aid)});")
        for i, s in enumerate(srcs):
            sql.append(f"INSERT INTO photos (album_id,src,sort) VALUES ((SELECT id FROM albums WHERE legacy_id={int(aid)}),{q(s)},{(i + 1) * 10});")
        redirects[f'myndir:{aid}'] = f'/album/{slug}'
        n_alb += 1
        n_ph += len(srcs)
    report.append(f'Myndasöfn: {n_alb} með {n_ph} myndum')

    # ---- Tilvísanir ----
    for k, v in redirects.items():
        if v.startswith('SQL:'):
            sql.append(f"INSERT OR REPLACE INTO redirects (old_key,new_path) SELECT {q(k)},{v[4:]} WHERE {v[4:].split('||', 1)[1].strip()} IS NOT NULL;")
        elif v.startswith('/web/legacy-event/'):
            _, _, _, kind, eid = v.split('/')
            v_sql = f"'/vidburdur/' || (SELECT id FROM events WHERE kind={q(kind)} AND legacy_id={int(eid)})"
            sql.append(f"INSERT OR REPLACE INTO redirects (old_key,new_path) SELECT {q(k)},{v_sql} WHERE EXISTS (SELECT 1 FROM events WHERE kind={q(kind)} AND legacy_id={int(eid)});")
        else:
            sql.append(f"INSERT OR REPLACE INTO redirects (old_key,new_path) VALUES ({q(k)},{q(v)});")
    report.append(f'Tilvísanir frá gömlum slóðum: {len(redirects)}')
    report.append(f'Myndir og skjöl til að sækja: {len(media)}')

    head = [
        '-- Efni flutt af gamla hsk.is. Búið til með scripts/migrate/build.py',
        'DELETE FROM photos; DELETE FROM albums; DELETE FROM results; DELETE FROM events; DELETE FROM news;',
        'DELETE FROM committees; DELETE FROM records; DELETE FROM documents; DELETE FROM redirects WHERE old_key NOT LIKE \'path:%\';',
        "DELETE FROM pages WHERE path LIKE 'um-hsk/log-og-reglugerdir/%';",
        "DELETE FROM pages WHERE parent_id = (SELECT id FROM pages WHERE path='um-hsk') AND path NOT IN ('um-hsk/stjorn-nefndir-og-rad','um-hsk/log-og-reglugerdir','um-hsk/fundargerdir','um-hsk/verkefnasjodur','um-hsk/vidbragdsaaetlun');",
    ]
    with open(os.path.join(OUT, 'import.sql'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(head + sql) + '\n')
    with open(os.path.join(OUT, 'media.tsv'), 'w', encoding='utf-8') as f:
        for url, key in sorted(media.items(), key=lambda x: x[1]):
            f.write(f'{url}\t{key}\n')
    with open(os.path.join(OUT, 'report.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(report) + '\n')
    print('\n'.join(report))


if __name__ == '__main__':
    main()
