"""
Les „Ýmsar/Aðrar upplýsingar“ úr lýsingu aðildarfélaga (netfang, vefsíða, kennitala, Facebook o.fl.)
og færir í sérreiti félagsins. Kaflinn er tekinn úr lýsingunni því hann birtist nú í hliðardálki.
Formaður (nafn, sími, netfang) fer í reitinn „Formaður / tengiliður“ en helst líka í lýsingunni.
Aðeins tómir reitir eru fylltir.

  wrangler d1 execute DB --json --command "SELECT id, name, contact_name, email, phone, website, facebook, kennitala, description FROM clubs" > felog.json
  python3 scripts/migrate/felog-upplysingar.py felog.json > felog.sql
"""
import html, json, re, sys

data = json.load(open(sys.argv[1]))
rows = data[0]['results'] if isinstance(data, list) else data
esc = lambda s: "'" + s.replace("'", "''") + "'"
text = lambda h: html.unescape(re.sub(r'<[^>]+>', '', h)).replace('\xa0', ' ')
INFO = re.compile(r'^\s*(ýmsar|aðrar)\s*upp?lýsingar', re.I)
# Kafli án fyrirsagnar sem hefst beint á upplýsingum félagsins
INFO_LINE = re.compile(r'^\s*(heimasíða|vefsíða|kennitala|netfang félag|sími skrifstofu)', re.I)
CHAIR = re.compile(r'^\s*(formaður|fornaður|íþróttaformenn|formenn)', re.I)

out = ['-- Búið til af scripts/migrate/felog-upplysingar.py']
for r in rows:
    orig = r['description'] or ''
    # Samræma: upplýsingakafli inni í öðrum kafla eða í lista verður sér kafli
    desc = re.sub(r'(<br>\s*)+(<strong>\s*(Ýmsar|Aðrar)\s*upp)', r'</p>\n<p>\n\2', orig)
    desc = re.sub(r'<ul>\s*<li>(.*?)</li>\s*</ul>', r'<p>\1</p>', desc, flags=re.S)
    blocks = re.findall(r'<p>.*?</p>', desc, re.S)
    found = {}
    keep = desc
    for b in blocks:
        lines = [l.strip() for l in text(re.sub(r'<br\s*/?>', '\n', b)).split('\n') if l.strip()]
        if not lines:
            continue
        head = lines[0]
        hrefs = re.findall(r'href="([^"]+)"', b)
        if INFO.match(head) or INFO_LINE.match(head):
            for l in (lines[1:] if INFO.match(head) else lines):
                m = re.match(r'([^:]+):\s*(.*)', l)
                if not m:
                    continue
                k, v = m.group(1).strip().lower(), m.group(2).strip()
                if k.startswith('netfang') or k.startswith('netang'):
                    found.setdefault('email', v.rstrip('.'))
                elif k.startswith(('heimasíða', 'vefsíða')):
                    found.setdefault('website', v.replace(' ', ''))
                elif k.startswith('kennitala'):
                    found.setdefault('kennitala', v)
                elif k.startswith('sími'):
                    found.setdefault('phone', v)
            for h in hrefs:
                if 'facebook.com' in h:
                    found.setdefault('facebook', h)
            keep = keep.replace(b, '')
        elif CHAIR.match(head) and 'contact_name' not in found:
            if len(lines) == 1:  # fyrirsögnin ein í kafla; nafnið er í næsta kafla
                nxt = blocks[blocks.index(b) + 1] if blocks.index(b) + 1 < len(blocks) else ''
                lines = [head] + [l.strip() for l in text(re.sub(r'<br\s*/?>', '\n', nxt)).split('\n') if l.strip()]
            if len(lines) < 2:
                continue
            found['contact_name'] = lines[1]
            for l in lines[2:]:
                if re.match(r's\.\s*\d|gsm|sími', l, re.I):
                    found.setdefault('chair_phone', re.sub(r'^(s\.|gsm:?|sími:?)\s*', '', l, flags=re.I))
                m = re.match(r'netfang:\s*(\S+@\S+)', l, re.I)
                if m:
                    found.setdefault('chair_email', m.group(1).rstrip('.'))
        elif re.match(r'^\s*kennitala', head, re.I):
            m = re.search(r'\d{6}-?\d{4}', ' '.join(lines))
            if m:
                found.setdefault('kennitala', m.group(0))
                keep = keep.replace(b, '')
    # Netfang og sími félags: netfang félagsins ef til er, annars formanns
    found.setdefault('email', found.get('chair_email', ''))
    found.setdefault('phone', found.get('chair_phone', ''))
    if 'facebook.com' in found.get('website', ''):
        found.setdefault('facebook', found.pop('website'))
    if found.get('website') and not found['website'].startswith('http'):
        found['website'] = 'https://' + found['website'].lstrip('/')
    sets = []
    for col in ('contact_name', 'email', 'phone', 'website', 'facebook', 'kennitala'):
        v = (found.get(col) or '').strip()
        if v and not (r.get(col) or '').strip():
            sets.append(f'{col} = {esc(v)}')
    keep = re.sub(r'<a\b[^>]*>\s*(<img src="">)?\s*</a>', '', keep)  # tómir tenglar eftir gömlu merkin
    keep = re.sub(r'<p>\s*(<br\s*/?>\s*)*</p>', '', keep).strip()
    if keep != orig.strip():
        sets.append(f'description = {esc(keep)}')
    if sets:
        out.append(f"UPDATE clubs SET {', '.join(sets)} WHERE id = {r['id']};")
print('\n'.join(out))
