"""NomadCare seed — polite, cached HTTP JSON fetcher (Python 3 stdlib only).

Every response is stored in tools/seed/cache/<slug>-<sha1>.json so the seed build is
re-runnable fully offline. Network calls are spaced >= 1.1 s apart and carry the
User-Agent 'NomadCare-AISC-seed/1.0' (OSM/OSRM usage policies).
"""
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
USER_AGENT = 'NomadCare-AISC-seed/1.0'
MIN_INTERVAL_S = 1.1
_last_call = [0.0]


class OfflineCacheMiss(RuntimeError):
    """Raised when --offline is set and a URL is not in the cache."""


def cache_path(url):
    digest = hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]
    host = urllib.parse.urlparse(url).netloc.split('.')[0]
    kind = 'nominatim' if 'nominatim' in url else ('foot' if 'routed-foot' in url else host)
    return os.path.join(CACHE_DIR, '%s-%s.json' % (re.sub(r'[^a-z0-9]+', '-', kind.lower()), digest))


def fetch_json(url, offline=False, retries=3):
    """Return parsed JSON for url, using the on-disk cache first."""
    path = cache_path(url)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as fh:
            return json.load(fh)['response']
    if offline:
        raise OfflineCacheMiss(url)
    os.makedirs(CACHE_DIR, exist_ok=True)
    err = None
    for attempt in range(retries):
        wait = MIN_INTERVAL_S - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=40) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump({'url': url, 'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                           'response': data}, fh, ensure_ascii=False)
            return data
        except Exception as exc:  # network hiccup: back off and retry
            err = exc
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError('fetch failed for %s: %s' % (url, err))


def nominatim(query, offline=False):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'format': 'json', 'q': query, 'countrycodes': 'vn', 'limit': 5})
    return fetch_json(url, offline=offline)


def osrm_route(points, profile='driving', offline=False, alternatives=False):
    """points = [(lat, lng), ...]. profile 'driving' (OSRM demo) or 'foot' (routing.openstreetmap.de)."""
    coords = ';'.join('%.6f,%.6f' % (p[1], p[0]) for p in points)
    if profile == 'foot':
        base = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/'
    else:
        base = 'https://router.project-osrm.org/route/v1/driving/'
    url = base + coords + '?overview=full&geometries=geojson' + ('&alternatives=true' if alternatives else '')
    return fetch_json(url, offline=offline)


def nominatim_reverse(lat, lng, zoom=14, offline=False):
    url = 'https://nominatim.openstreetmap.org/reverse?' + urllib.parse.urlencode(
        {'format': 'json', 'lat': '%.5f' % lat, 'lon': '%.5f' % lng, 'zoom': zoom})
    return fetch_json(url, offline=offline)
