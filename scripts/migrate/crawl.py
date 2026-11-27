"""
Sækir allar síður af gamla hsk.is og geymir hrátt HTML í .migration/cache/.
Keyrt aftur sleppir skrám sem þegar hafa verið sóttar.

  python3 scripts/migrate/crawl.py
"""
import concurrent.futures as cf
import http.cookiejar
import os
import re
import sys
import time
import urllib.request

BASE = 'https://www.hsk.is/web/'
CACHE = '.migration/cache'
UA = 'Mozilla/5.0 (HSK vefflutningur)'
WORKERS = 6

# Gamla kerfið afgreiðir eina beiðni í einu fyrir hverja setu, svo venjulegar síður eru sóttar án vafrakökna.
plain = urllib.request.build_opener()
plain.addheaders = [('User-Agent', UA)]
# Myndasöfnin krefjast setu
jar = http.cookiejar.CookieJar()
session = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
session.addheaders = [('User-Agent', UA)]


def fetch(url: str, tries: int = 4) -> bytes | None:
    opener = session if 'myndir' in url else plain
    for i in range(tries):
        try:
            with opener.open(url, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code >= 500 and i == tries - 1:
                return e.read()
        except Exception:
            pass
        time.sleep(1.5 * (i + 1))
    return None


def cache_path(key: str) -> str:
    return os.path.join(CACHE, key + '.html')


def get(key: str, query: str, file: str = 'default.cfm') -> str:
    """Sækir síðu (eða úr skyndiminni) og skilar UTF-8 texta."""
    p = cache_path(key)
    if os.path.exists(p):
        return open(p, encoding='utf-8').read()
    url = f'{BASE}{file}?{query}'
    raw = fetch(url) or b''
    text = raw.decode('iso-8859-1', errors='replace')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(f'<!-- {url} -->\n' + text)
    return text


def many(jobs, label):
    done = 0
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(get, *j) for j in jobs]
        for _ in cf.as_completed(futs):
            done += 1
            if done % 250 == 0 or done == len(jobs):
                print(f'  {label}: {done}/{len(jobs)}', flush=True)


def ids(html: str, pattern: str) -> list[str]:
    return sorted(set(re.findall(pattern, html)), key=int)


def main():
    q = 'lang=1&brid=0'
    print('Listar…', flush=True)
    lists = {
        'list/frettir': f'{q}&page=frettir',
        'list/felog': f'{q}&page=felog',
        'list/nefndir': f'{q}&page=nefndir',
        'list/log': f'{q}&page=log',
        'list/hsk': f'{q}&page=hsk',
        'list/fundarg': f'{q}&page=fundarg',
        'list/urslit': f'{q}&page=urslit',
        'list/met_b': f'{q}&page=hsk_met_b',
        'list/met_c': f'{q}&page=hsk_met_c',
        'list/myndir': f'{q}&page=myndir&mynd=',
        'list/adsgr': f'{q}&page=adsgr&startrow=1&rowcount=5000',
        'list/vidburdir': f'{q}&page=vidburdir_l&startdate=01/01/1990',
        'list/motaskra': f'{q}&page=motaskra',
    }
    html = {k: get(k, v) for k, v in lists.items()}

    # Fréttir á gamla vefnum eru með númer frá 5001 (eldri númer eru tóm)
    min_news = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    max_news = int(sys.argv[2]) if len(sys.argv) > 2 else 8800
    jobs = [(f'frett/{i}', f'{q}&page=frettirnar&frett_id={i}') for i in range(min_news, max_news + 1)]
    print(f'Fréttir {min_news}–{max_news}…', flush=True)
    many(jobs, 'fréttir')

    greinar = ids(html['list/adsgr'] + html['list/frettir'], r'frett_id=(\d+)&brid=0&lang=1&page=greinarnar')
    jobs = [(f'grein/{i}', f'{q}&page=greinarnar&frett_id={i}') for i in range(1, max(map(int, greinar or ['60'])) + 20)]
    many(jobs, 'greinar')

    jobs = [(f'sida/{i}', f'{q}&page=sidur&id={i}') for i in range(1, 450)]
    jobs += [(f'hsk_uppl/{i}', f'{q}&page=hsk_uppl&id={i}') for i in ids(html['list/hsk'], r'id=(\d+)&page=hsk_uppl')]
    jobs += [(f'felag/{i}', f'{q}&page=felogin&id={i}') for i in ids(html['list/felog'], r'id=(\d+)&page=felogin')]
    jobs += [(f'nefnd/{i}', f'{q}&page=nefndirnar&id={i}') for i in ids(html['list/nefndir'], r'id=(\d+)&page=nefndirnar')]
    jobs += [(f'log/{i}', f'{q}&page=login&id={i}') for i in ids(html['list/log'], r'id=(\d+)&page=login')]
    jobs += [(f'fundargerd/{i}', f'{q}&page=fundargerd&grein={i}') for i in range(1, 40)]
    jobs += [(f'urslit_grein/{i}', f'{q}&page=urslitin&grein={i}') for i in range(1, 40)]
    jobs += [(f'met/{i}', f'{q}&page=hsk_met1&id={i}') for i in ids(html['list/met_b'] + html['list/met_c'], r'id=(\d+)&page=hsk_met1')]
    ev = ids(html['list/vidburdir'], r'id=(\d+)&lang=1&brid=0&page=vidburdir')
    jobs += [(f'vidburdur/{i}', f'{q}&page=vidburdir&id={i}') for i in ev]
    mot = ids(html['list/vidburdir'] + html['list/motaskra'] + html['list/frettir'], r'id=(\d+)&lang=1&brid=0&page=motaskra')
    top = max(map(int, mot or ['700']))
    jobs += [(f'mot/{i}', f'{q}&page=motaskra&id={i}') for i in range(1, top + 30)]
    print(f'Síður, félög, nefndir, lög, skjöl, úrslit, met, {len(ev)} viðburðir, mót 1–{top + 29}…', flush=True)
    many(jobs, 'annað')

    # Myndasöfn þurfa setu (session) á gamla kerfinu
    session.open(f'{BASE}default.cfm?{q}&page=myndir&mynd=', timeout=60).read()
    flokkar = ids(html['list/myndir'], r'flokkur=(\d+)')
    top = max(map(int, flokkar or ['715']))
    jobs = [(f'album/{i}', f'flokkur={i}&page_id=5', 'myndir_yfirl.cfm') for i in range(1, top + 1)]
    print(f'Myndasöfn 1–{top}…', flush=True)
    many(jobs, 'myndasöfn')
    print('Lokið.')


if __name__ == '__main__':
    main()
