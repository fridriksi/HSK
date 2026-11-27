"""
Sækir myndir og skjöl af gamla hsk.is (sjá .migration/media.tsv) og setur þau í R2 nýja vefsins.

  IMPORT_TOKEN=... python3 scripts/migrate/media.py http://localhost:8787
  IMPORT_TOKEN=... python3 scripts/migrate/media.py https://hsk-vefur.<reikningur>.workers.dev

Skrár eru geymdar í .migration/media/ svo ekki þarf að sækja þær aftur.
Skrár sem tókst ekki að sækja eru skráðar í .migration/media-missing.txt.
"""
import concurrent.futures as cf
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TARGET = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://localhost:8787'
TOKEN = os.environ.get('IMPORT_TOKEN', '')
DIR = '.migration/media'
DONE_LOG = f'.migration/media-uploaded-{urllib.parse.urlparse(TARGET).netloc.replace(":", "_")}.txt'
UA = 'Mozilla/5.0 (HSK vefflutningur)'


def download(url: str, path: str) -> bool:
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    if url.startswith('inline:'):
        return False
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(data)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return False


def upload(key: str, path: str) -> bool:
    ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    with open(path, 'rb') as f:
        data = f.read()
    req = urllib.request.Request(f'{TARGET}/stjorn/innflutningur/{urllib.parse.quote(key)}', data=data, method='PUT',
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': ctype})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status == 200
        except Exception:
            time.sleep(2 * (i + 1))
    return False


def main():
    if not TOKEN:
        sys.exit('Vantar IMPORT_TOKEN')
    rows = [l.rstrip('\n').split('\t') for l in open('.migration/media.tsv', encoding='utf-8') if '\t' in l]
    done = set(open(DONE_LOG).read().split()) if os.path.exists(DONE_LOG) else set()
    todo = [(u, k) for u, k in rows if k not in done]
    print(f'{len(rows)} skrár, {len(todo)} eftir', flush=True)
    missing = []
    log = open(DONE_LOG, 'a')

    def work(item):
        url, key = item
        path = os.path.join(DIR, key)
        if not download(url, path):
            return key, 'missing'
        return key, 'ok' if upload(key, path) else 'fail'

    n = 0
    with cf.ThreadPoolExecutor(6) as ex:
        for key, status in ex.map(work, todo):
            n += 1
            if status == 'ok':
                log.write(key + '\n')
            elif status == 'missing':
                missing.append(key)
            if n % 200 == 0:
                print(f'  {n}/{len(todo)}', flush=True)
                log.flush()
    log.close()
    with open('.migration/media-missing.txt', 'w') as f:
        f.write('\n'.join(missing))
    print(f'Lokið. Vantar á gamla vefnum: {len(missing)}')


if __name__ == '__main__':
    main()
