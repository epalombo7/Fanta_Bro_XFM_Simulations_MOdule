"""Shared HTTP helpers for the FantaBall data pipeline: polite, cached, retrying downloads."""
import gzip, hashlib, os, pathlib, time, random
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
RAW = DATA / 'raw'            # parsed source tables, committed
CACHE = DATA / 'cache'        # downloaded pages, not committed (see .gitignore)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

# Seasons as Fantacalcio/football-data label them. 2015-16 is the first season Fantacalcio.it votes cover.
SEASONS = [f'{y}-{str(y + 1)[2:]}' for y in range(2015, 2027)]
CURRENT = SEASONS[-1]

_session = requests.Session()
_session.headers.update({'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8'})
_last = {}


def get(url, *, delay=1.0, cache=True, headers=None, retries=4, max_age=None):
    """GET url with a per-host delay, retries with backoff, and a gzip disk cache.
    max_age (seconds) re-downloads cached pages older than that; None keeps them forever."""
    key = hashlib.sha1(url.encode()).hexdigest()
    path = CACHE / key[:2] / (key + '.gz')
    if cache and path.exists() and (max_age is None or time.time() - path.stat().st_mtime < max_age):
        return gzip.decompress(path.read_bytes()).decode('utf-8', 'replace')
    host = url.split('/')[2]
    for attempt in range(retries):
        wait = _last.get(host, 0) + delay - time.time()
        if wait > 0:
            time.sleep(wait + random.random() * 0.3)
        _last[host] = time.time()
        try:
            r = _session.get(url, headers=headers, timeout=45)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            try:
                text = r.content.decode('utf-8-sig')
            except UnicodeDecodeError:
                text = r.content.decode('latin-1')
            if cache:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(gzip.compress(text.encode('utf-8')))
            return text
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** (attempt + 1))


def num(s):
    """Italian decimal string to float ('6,5' -> 6.5); None for blanks."""
    s = (s or '').strip().replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def out(*parts):
    p = RAW.joinpath(*parts)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p
