#!/usr/bin/env python3
"""NomadCare v2 — offline VECTOR basemap builder (owner: W4b basemap data; Python 3 stdlib only).

For each pilot corridor it writes assets/data/basemap/<route_id>.json: roads, water, place names and peaks
extracted ONCE from OpenStreetMap through the Overpass API, clipped to a buffer around the route network,
simplified (Douglas–Peucker ~15 m) and rounded to 5 decimals. MOD.02 draws it under the route when raster
tiles are unavailable (offline / blocked). Data © OpenStreetMap contributors, ODbL-1.0.

Usage:
  python3 tools/seed/build_basemap.py              build all corridors (network only when a cache file is missing)
  python3 tools/seed/build_basemap.py --offline    build strictly from tools/seed/cache/overpass-<route>.json
  python3 tools/seed/build_basemap.py --route khanh-le     build one corridor
  python3 tools/seed/build_basemap.py --check      validate assets/data/basemap/*.json and print the stats table
  python3 tools/seed/build_basemap.py --refresh --route X  re-download one corridor (rarely needed; one query)

Overpass fair use: exactly ONE query per corridor, sent only when its cache file is missing (or --refresh),
POST with a descriptive User-Agent, the /api/status slot check before each query, >= 5 s between queries,
and back-off on 429/502/503/504 (at most ~10 min in total), after which the build stops and reports.
The cache (tools/seed/cache/overpass-<route>.json, ~29 MB) is git-ignored and not shipped: the app needs only
assets/data/basemap/*.json, and --check reads only those files. On a fresh checkout a rebuild therefore sends
the one query per corridor again (a newer OSM snapshot, so the output changes); later builds reuse the cache.
Size budget: <= MAX_BYTES (700 000) per file.
Deterministic: the output depends only on the cached responses and on seed-core.js; `generated_at` is the
OSM snapshot date reported by Overpass (osm3s.timestamp_osm_base), not the wall clock.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # keep tools/seed/ free of __pycache__

import geo  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SEED_CORE = os.path.join(ROOT, 'assets', 'js', 'data', 'seed-core.js')
OUT_DIR = os.path.join(ROOT, 'assets', 'data', 'basemap')
CACHE_DIR = os.path.join(HERE, 'cache')

ROUTES = ['khanh-le', 'ta-nang-phan-dung', 'ha-giang-loop']
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
STATUS_URL = 'https://overpass-api.de/api/status'
USER_AGENT = 'NomadCare-seed/2.0 (AISC student project; contact via project README)'
HTTP_TIMEOUT_S = 300          # client read timeout (the query itself asks for [timeout:180])
MIN_GAP_S = 5.0               # pause between two Overpass queries (fair use asks for >= 2 s)
BACKOFF_S = [30, 60, 120, 180, 240]   # 429/5xx/network back-off, ~10 min in total, then give up

# Query envelope (wide on purpose so a smaller build buffer never needs a new query).
QUERY_PAD_KM = 8.5            # bbox padding around the route network for major classes, water, places, peaks
QUERY_MINOR_M = 2300          # Overpass `around` radius for minor roads and streams (per edge polyline)
QUERY_LINE_TOL_M = 100        # simplification of the edge polylines used in `around` (radius covers it)

MAX_BYTES = 700000            # hard limit per file (raised from 500 000 on 2026-10-02 to keep mountain detail)
TARGET_BYTES = 690000         # the size ladder stops at the first level under this
VN_ENVELOPE = (8.0, 102.0, 23.5, 110.0)   # loose lat/lng envelope of mainland Vietnam + near-shore islands

ROAD_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'track', 'path']
WATER_CLASSES = ['river', 'stream', 'canal', 'lake', 'reservoir']
PLACE_KINDS = ['town', 'village', 'hamlet', 'suburb', 'locality']
TOP_KEYS = ['v', 'route_id', 'bbox', 'generated_at', 'source', 'license', 'attribution',
            'roads', 'water', 'places', 'peaks']

HW_MAP = {
    'motorway': 'trunk', 'motorway_link': 'trunk', 'trunk': 'trunk', 'trunk_link': 'trunk',
    'primary': 'primary', 'primary_link': 'primary', 'secondary': 'secondary', 'secondary_link': 'secondary',
    'tertiary': 'tertiary', 'tertiary_link': 'tertiary', 'unclassified': 'unclassified',
    'residential': 'residential', 'living_street': 'residential',
    'track': 'track', 'path': 'path', 'footway': 'path', 'bridleway': 'path',
}
MAJOR_HW = [k for k, v in HW_MAP.items() if v in ('trunk', 'primary', 'secondary', 'tertiary', 'unclassified')]
MINOR_HW = [k for k, v in HW_MAP.items() if v in ('residential', 'track', 'path')]
PLACE_MAP = {'city': 'town', 'town': 'town', 'village': 'village', 'hamlet': 'hamlet',
             'suburb': 'suburb', 'quarter': 'suburb', 'locality': 'locality'}
PLACE_RANK = {'town': 0, 'suburb': 1, 'village': 2, 'locality': 3, 'hamlet': 4}
# Drawing order = array order: minor classes first, so major roads end up on top.
ROAD_DRAW_RANK = {c: i for i, c in enumerate(reversed(ROAD_CLASSES))}
WATER_AREA_SKIP = {'wastewater', 'swimming_pool', 'reflecting_pool', 'fountain'}

# Size ladder: the first level whose file is <= TARGET_BYTES wins (per corridor). Distances in km.
#   major  = trunk…tertiary + rivers/canals/lakes/places/peaks; uncl = unclassified roads;
#   resid  = residential; urban = residential inside dense town grids (see URBAN_KM_PER_KM2);
#   minor  = track/path; stream = streams; dp_m = Douglas–Peucker tolerance.
# Level 0 is the PLAN default (6–8 km corridor, minor classes within 2 km). Later levels first thin the dense
# street grids of towns (where there is mobile signal and raster tiles anyway), then far minor classes.
LEVELS = [
    {'major': 7.0, 'uncl': 7.0, 'resid': 2.0, 'urban': 2.0, 'minor': 2.0, 'stream': 2.0, 'dp_m': 15.0},
    {'major': 7.0, 'uncl': 7.0, 'resid': 2.0, 'urban': 0.6, 'minor': 2.0, 'stream': 2.0, 'dp_m': 15.0},
    {'major': 7.0, 'uncl': 6.0, 'resid': 1.5, 'urban': 0.5, 'minor': 2.0, 'stream': 1.5, 'dp_m': 15.0},
    {'major': 7.0, 'uncl': 5.0, 'resid': 1.2, 'urban': 0.4, 'minor': 1.8, 'stream': 1.2, 'dp_m': 15.0},
    {'major': 7.0, 'uncl': 4.5, 'resid': 1.0, 'urban': 0.3, 'minor': 1.5, 'stream': 1.0, 'dp_m': 15.0},
    {'major': 6.5, 'uncl': 4.0, 'resid': 0.8, 'urban': 0.3, 'minor': 1.2, 'stream': 0.8, 'dp_m': 15.0},
    {'major': 6.0, 'uncl': 3.0, 'resid': 0.6, 'urban': 0.2, 'minor': 1.0, 'stream': 0.6, 'dp_m': 18.0},
    {'major': 6.0, 'uncl': 2.5, 'resid': 0.5, 'urban': 0.2, 'minor': 0.8, 'stream': 0.5, 'dp_m': 20.0},
]
URBAN_KM_PER_KM2 = 6.0        # a 1 km cell with more residential street length than this counts as a town grid
MIN_RUN_KM = 0.08             # clipped line pieces shorter than this are dropped
MIN_WATER_AREA_KM2 = 0.01     # unnamed lakes/ponds below 1 ha are dropped
DENSIFY_KM = 0.2              # max vertex spacing while clipping (so long straight segments cannot skip the buffer)


class OverpassError(RuntimeError):
    pass


# ----------------------------------------------------------------------------------------------- seed input

def load_seed():
    """Parse window.NC_SEED out of assets/js/data/seed-core.js (generated by build_seed.py)."""
    with open(SEED_CORE, 'r', encoding='utf-8') as fh:
        txt = fh.read()
    i = txt.index('root.NC_SEED =')
    obj, _ = json.JSONDecoder().raw_decode(txt, txt.index('{', i))
    return obj


def route_network(seed, route_id):
    """All edge polylines of a route (main, alternatives, spurs, connectors) as lists of (lat, lng)."""
    lines = [[(p[0], p[1]) for p in e['geometry']] for e in seed['edges'] if e['route_id'] == route_id]
    lines = [ln for ln in lines if len(ln) >= 2]
    if not lines:
        raise SystemExit('route %s has no edges in seed-core.js' % route_id)
    return lines


def pad_bbox(lines, pad_km):
    pts = [p for ln in lines for p in ln]
    s, w, n, e = min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)
    dlat = pad_km / 110.574
    dlng = pad_km / (111.32 * math.cos(math.radians((s + n) / 2)))
    return (s - dlat, w - dlng, n + dlat, e + dlng)


# ----------------------------------------------------------------------------------------------- Overpass

def build_query(lines):
    s, w, n, e = pad_bbox(lines, QUERY_PAD_KM)
    bb = '(%.4f,%.4f,%.4f,%.4f)' % (s, w, n, e)
    arounds = []
    for ln in lines:
        simp = geo.simplify(ln, tol_m=QUERY_LINE_TOL_M)
        arounds.append('(around:%d,%s)' % (QUERY_MINOR_M, ','.join('%.5f,%.5f' % (p[0], p[1]) for p in simp)))
    major = '^(%s)$' % '|'.join(sorted(MAJOR_HW))
    minor = '^(%s)$' % '|'.join(sorted(MINOR_HW))
    places = '^(%s)$' % '|'.join(sorted(PLACE_MAP))
    q = ['[out:json][timeout:180];',
         'area["ISO3166-1"="VN"]["admin_level"="2"]->.vn;',
         '(',
         '  way["highway"~"%s"]%s(area.vn);' % (major, bb)]
    q += ['  way["highway"~"%s"](area.vn)%s;' % (minor, a) for a in arounds]
    q += ['  way["waterway"~"^(canal|river)$"]%s(area.vn);' % bb]
    q += ['  way["waterway"="stream"](area.vn)%s;' % a for a in arounds]
    q += ['  way["natural"="water"]%s(area.vn);' % bb,
          '  relation["natural"="water"]%s(area.vn);' % bb,
          '  way["landuse"="reservoir"]%s(area.vn);' % bb,
          '  relation["landuse"="reservoir"]%s(area.vn);' % bb,
          '  way["waterway"="riverbank"]%s(area.vn);' % bb,
          '  node["place"~"%s"]%s(area.vn);' % (places, bb),
          '  node["natural"="peak"]%s(area.vn);' % bb,
          ');',
          'out geom qt;']
    return '\n'.join(q)


def cache_file(route_id):
    return os.path.join(CACHE_DIR, 'overpass-%s.json' % route_id)


_last_query = [0.0]


def _http(url, data=None, timeout=HTTP_TIMEOUT_S):
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def wait_for_slot(log):
    """Read /api/status and wait until a query slot is free (bounded, best effort)."""
    for _ in range(6):
        try:
            txt = _http(STATUS_URL, timeout=30).decode('utf-8', 'replace')
        except Exception as exc:  # status page unreachable: let the query itself decide
            log('    status check failed (%s) — continuing' % exc)
            return
        m = re.search(r'(\d+) slots? available now', txt)
        if m and int(m.group(1)) > 0:
            return
        waits = [int(x) for x in re.findall(r'in (\d+) seconds', txt)]
        delay = min(max(min(waits) if waits else 15, 3), 120)
        log('    no free Overpass slot, waiting %d s' % delay)
        time.sleep(delay)


def fetch_overpass(route_id, query, offline=False, refresh=False, log=print):
    """Return the Overpass JSON for a corridor: from the cache, or ONE polite POST (then cached)."""
    path = cache_file(route_id)
    qsha = hashlib.sha1(query.encode('utf-8')).hexdigest()
    if os.path.exists(path) and not refresh:
        with open(path, 'r', encoding='utf-8') as fh:
            doc = json.load(fh)
        if doc.get('query_sha1') != qsha:
            log('  note: %s was fetched with a different query (use --refresh to re-download)'
                % os.path.relpath(path, ROOT))
        return doc['response']
    if offline:
        raise OverpassError('offline and no cache file %s' % os.path.relpath(path, ROOT))
    body = urllib.parse.urlencode({'data': query}).encode('utf-8')
    last_err = None
    retry_after = 0
    for attempt in range(len(BACKOFF_S) + 1):
        gap = MIN_GAP_S - (time.time() - _last_query[0])
        if gap > 0:
            time.sleep(gap)
        wait_for_slot(log)
        _last_query[0] = time.time()
        log('    POST %s (%d bytes query, attempt %d)' % (OVERPASS_URL, len(body), attempt + 1))
        t0 = time.time()
        try:
            raw = _http(OVERPASS_URL, data=body)
            data = json.loads(raw.decode('utf-8'))
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:400].decode('utf-8', 'replace') if hasattr(exc, 'read') else ''
            last_err = 'HTTP %s %s' % (exc.code, re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', detail)).strip())
            if exc.code not in (429, 502, 503, 504):
                raise OverpassError(last_err)  # 400 = query error: retrying would not help
            ra = (exc.headers.get('Retry-After') or '').strip() if exc.headers else ''
            retry_after = min(int(ra), 300) if ra.isdigit() else 0
        except (urllib.error.URLError, OSError, ValueError) as exc:
            last_err = '%s: %s' % (type(exc).__name__, exc)
        else:
            remark = data.get('remark') or ''
            if 'error' in remark.lower():
                raise OverpassError('Overpass runtime error: %s' % remark)
            if not data.get('elements'):
                raise OverpassError('Overpass returned no elements for %s (query problem?)' % route_id)
            os.makedirs(CACHE_DIR, exist_ok=True)
            doc = {'route_id': route_id, 'endpoint': OVERPASS_URL,
                   'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                   'user_agent': USER_AGENT, 'query_sha1': qsha, 'query': query, 'response': data}
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(doc, fh, ensure_ascii=False, separators=(',', ':'))
            log('    ok: %d elements, %.1f MB in %.0f s -> %s' % (len(data['elements']), len(raw) / 1e6,
                                                               time.time() - t0, os.path.relpath(path, ROOT)))
            return data
        if attempt < len(BACKOFF_S):
            delay = max(BACKOFF_S[attempt], retry_after)  # honour Retry-After on 429
            log('    %s — backing off %d s' % (last_err, delay))
            time.sleep(delay)
            retry_after = 0
    raise OverpassError('Overpass unavailable for %s after back-off: %s' % (route_id, last_err))


# ----------------------------------------------------------------------------------------------- geometry

class DistanceField:
    """Distance (km) to the route network, sampled exactly on a regular grid and bilinearly interpolated.

    Planar approximation around the corridor (equirectangular, error < 0.5 % over one corridor); grid step
    250 m, so the buffer edges are accurate to ~0.1 km, which is plenty for a 0.5–7 km corridor.
    """

    def __init__(self, lines, bbox, cap_km, step_km=0.25, bucket_km=1.0, grid=True):
        s, w, n, e = bbox
        self.s, self.w = s, w
        self.ky = 110.574
        self.kx = 111.32 * math.cos(math.radians((s + n) / 2))
        self.cap = cap_km
        self.step = step_km
        self.B = bucket_km
        buckets = {}
        for ln in lines:
            for a, b in zip(ln, ln[1:]):
                ax, ay = self.xy(a)
                bx, by = self.xy(b)
                dx, dy = bx - ax, by - ay
                l2 = dx * dx + dy * dy
                if l2 <= 0:
                    continue
                seg = (ax, ay, dx, dy, l2)
                for i in range(int(min(ax, bx) // self.B), int(max(ax, bx) // self.B) + 1):
                    for j in range(int(min(ay, by) // self.B), int(max(ay, by) // self.B) + 1):
                        buckets.setdefault((i, j), []).append(seg)
        self.buckets = buckets
        self.nx = int(math.ceil((e - w) * self.kx / step_km)) + 2 if grid else 0
        self.ny = int(math.ceil((n - s) * self.ky / step_km)) + 2 if grid else 0
        vals = []
        for j in range(self.ny):
            y = j * step_km
            for i in range(self.nx):
                vals.append(self._exact(i * step_km, y))
        self.vals = vals

    def xy(self, p):
        return ((p[1] - self.w) * self.kx, (p[0] - self.s) * self.ky)

    def exact(self, p):
        """Exact planar distance (km, capped) from p to the lines — no grid needed."""
        x, y = self.xy(p)
        return self._exact(x, y)

    def cell(self, p, size_km=1.0):
        x, y = self.xy(p)
        return (int(x // size_km), int(y // size_km))

    def _exact(self, x, y):
        B, cap2 = self.B, self.cap * self.cap
        bi, bj = int(x // B), int(y // B)
        best = cap2
        r = 0
        get = self.buckets.get
        while True:
            lo = (r - 1) * B
            if lo > 0 and lo * lo >= best:
                break
            if r == 0:
                cells = [(bi, bj)]
            else:
                cells = [(bi + k, bj - r) for k in range(-r, r + 1)] + [(bi + k, bj + r) for k in range(-r, r + 1)]
                cells += [(bi - r, bj + k) for k in range(-r + 1, r)] + [(bi + r, bj + k) for k in range(-r + 1, r)]
            for c in cells:
                for ax, ay, dx, dy, l2 in get(c, ()):
                    t = ((x - ax) * dx + (y - ay) * dy) / l2
                    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                    ex, ey = ax + t * dx - x, ay + t * dy - y
                    d2 = ex * ex + ey * ey
                    if d2 < best:
                        best = d2
            r += 1
        return math.sqrt(best)

    def at(self, p):
        x, y = self.xy(p)
        fx, fy = x / self.step, y / self.step
        i, j = int(math.floor(fx)), int(math.floor(fy))
        if i < 0 or j < 0 or i >= self.nx - 1 or j >= self.ny - 1:
            return self.cap
        tx, ty = fx - i, fy - j
        v = self.vals
        k = j * self.nx + i
        a, b, c, d = v[k], v[k + 1], v[k + self.nx], v[k + self.nx + 1]
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def densify(line, max_km=DENSIFY_KM):
    out = [line[0]]
    for a, b in zip(line, line[1:]):
        d = geo.haversine_km(a, b)
        if d > max_km:
            k = int(math.ceil(d / max_km))
            for t in range(1, k):
                f = t / float(k)
                out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
        out.append(b)
    return out


def _crossing(inside, a, b):
    """Point on segment a–b where the inside() predicate flips (bisection, ~1 m)."""
    fa = inside(a)
    lo, hi = 0.0, 1.0
    for _ in range(14):
        mid = (lo + hi) / 2
        if inside((a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid)) == fa:
            lo = mid
        else:
            hi = mid
    t = (lo + hi) / 2
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def clip_line(line, inside):
    """Split a polyline into the runs where inside(point) holds (e.g. within thr km of the route network)."""
    pts = densify(line)
    runs, cur = [], None
    prev_in = None
    for i, p in enumerate(pts):
        now_in = inside(p)
        if now_in:
            if cur is None:
                cur = [_crossing(inside, pts[i - 1], p)] if i > 0 else []
            cur.append(p)
        elif prev_in:
            cur.append(_crossing(inside, pts[i - 1], p))
            runs.append(cur)
            cur = None
        prev_in = now_in
    if cur:
        runs.append(cur)
    return runs


def within(field, thr):
    return lambda p: field.at(p) <= thr


def urban_cells(roads_merged, field, thr_km):
    """1 km cells whose residential street length (within thr_km of the route) exceeds URBAN_KM_PER_KM2."""
    dens = {}
    for (c, _n), line in roads_merged:
        if c != 'residential':
            continue
        for run in clip_line(line, within(field, thr_km)):
            for a, b in zip(run, run[1:]):
                k = field.cell(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
                dens[k] = dens.get(k, 0.0) + geo.haversine_km(a, b)
    return frozenset(k for k, v in dens.items() if v > URBAN_KM_PER_KM2)


def clip_ring_to_bbox(ring, bbox):
    """Sutherland–Hodgman clip of a closed ring against the rectangle bbox (s, w, n, e)."""
    s, w, n, e = bbox
    edges = [(lambda p: p[0] >= s, lambda a, b: _ix_lat(a, b, s)),
             (lambda p: p[0] <= n, lambda a, b: _ix_lat(a, b, n)),
             (lambda p: p[1] >= w, lambda a, b: _ix_lng(a, b, w)),
             (lambda p: p[1] <= e, lambda a, b: _ix_lng(a, b, e))]
    pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
    for inside, ix in edges:
        if not pts:
            break
        out = []
        prev = pts[-1]
        for cur in pts:
            if inside(cur):
                if not inside(prev):
                    out.append(ix(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(ix(prev, cur))
            prev = cur
        pts = out
    if len(pts) < 3:
        return None
    return pts + [pts[0]]


def _ix_lat(a, b, lat):
    t = (lat - a[0]) / (b[0] - a[0])
    return (lat, a[1] + (b[1] - a[1]) * t)


def _ix_lng(a, b, lng):
    t = (lng - a[1]) / (b[1] - a[1])
    return (a[0] + (b[0] - a[0]) * t, lng)


def ring_area_km2(ring, field):
    pts = [field.xy(p) for p in ring]
    return abs(sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1))) / 2.0


def stitch_rings(ways):
    """Join way geometries (lists of (lat, lng)) end to end into closed rings (multipolygon outers)."""
    todo = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while todo:
        cur = todo.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for k, w in enumerate(todo):
                if w[0] == cur[-1]:
                    cur += w[1:]
                elif w[-1] == cur[-1]:
                    cur += w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w[:-1] + cur
                elif w[0] == cur[0]:
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                todo.pop(k)
                changed = True
                break
        if cur[0] == cur[-1] and len(cur) >= 4:
            rings.append(cur)
    return rings


def merge_lines(items):
    """Greedy end-to-end merge of ways sharing an endpoint and the same (class, name) key.

    items: list of (key, osm_id, [(lat, lng), ...]); returns list of (key, line). Deterministic (id order).
    """
    by_key = {}
    for key, oid, line in sorted(items, key=lambda t: (t[0][0], t[0][1] or '', t[1])):
        by_key.setdefault(key, []).append(list(line))
    out = []
    for key in sorted(by_key, key=lambda k: (k[0], k[1] or '')):
        lines = by_key[key]
        ends = {}
        for idx, ln in enumerate(lines):
            ends.setdefault(ln[0], []).append(idx)
            ends.setdefault(ln[-1], []).append(idx)
        used = [False] * len(lines)

        def take(pt, used=used, ends=ends):
            for idx in ends.get(pt, ()):
                if not used[idx]:
                    used[idx] = True
                    return lines[idx]
            return None

        for idx, ln in enumerate(lines):
            if used[idx]:
                continue
            used[idx] = True
            cur = list(ln)
            while cur[0] != cur[-1]:
                nxt = take(cur[-1])
                if nxt is None:
                    break
                cur += (nxt[1:] if nxt[0] == cur[-1] else nxt[::-1][1:])
            while cur[0] != cur[-1]:
                nxt = take(cur[0])
                if nxt is None:
                    break
                cur = (nxt[:-1] if nxt[-1] == cur[0] else nxt[::-1][:-1]) + cur
            out.append((key, cur))
    return out


def rline(line):
    """Round to 5 decimals and drop consecutive duplicates."""
    out = []
    for p in line:
        q = [round(p[0], 5), round(p[1], 5)]
        if not out or out[-1] != q:
            out.append(q)
    return out


# ----------------------------------------------------------------------------------------------- extraction

def _clean(s):
    if not s:
        return None
    s = re.sub(r'\s+', ' ', s).strip()
    return s or None


def pick_name(tags):
    return _clean(tags.get('name:vi')) or _clean(tags.get('name'))


def road_name(tags, c):
    """Major roads show their route number (QL.4C, ĐT.176, CT.01); a bare number ('2', '4C') loses to the name."""
    ref = _clean((tags.get('ref') or '').split(';')[0])
    if ref and c in ('trunk', 'primary', 'secondary', 'tertiary') and not ref[0].isdigit():
        return ref
    return pick_name(tags) or ref


def parse_ele(v):
    """OSM ele tag -> integer metres or None ('1500', '1500 m', '1 500', '1,500', '1500,5')."""
    if not v:
        return None
    s = re.sub(r'\s+', '', v.strip().lower())
    s = re.sub(r'(m|meters?|mét)$', '', s)
    s = s.replace(',', '.') if re.match(r'^-?\d+,\d{1,2}$', s) else s.replace(',', '')
    try:
        e = int(round(float(s)))
    except ValueError:
        return None
    return e if -100 < e < 3500 else None


def geom_of(el):
    return [(g['lat'], g['lon']) for g in el.get('geometry') or () if g]


def classify(elements):
    """Split raw Overpass elements into road ways, water lines, water areas, places and peaks (no clipping)."""
    roads, wlines, wareas, places, peaks = [], [], [], [], []
    seen = set()
    for el in sorted(elements, key=lambda x: (x['type'], x['id'])):
        k = (el['type'], el['id'])
        if k in seen:
            continue
        seen.add(k)
        tags = el.get('tags') or {}
        t = el['type']
        if t == 'node':
            if tags.get('natural') == 'peak':
                pn, pe = pick_name(tags), parse_ele(tags.get('ele'))
                if pn or pe is not None:  # a peak with neither name nor elevation has no label to draw
                    peaks.append({'id': el['id'], 'n': pn, 'e': pe, 'p': (el['lat'], el['lon'])})
            kind = PLACE_MAP.get(tags.get('place') or '')
            name = pick_name(tags)
            if kind and name:
                places.append({'id': el['id'], 'n': name, 'k': kind, 'p': (el['lat'], el['lon'])})
            continue
        water_area_cls = None
        if tags.get('natural') == 'water' or tags.get('landuse') == 'reservoir' or tags.get('waterway') == 'riverbank':
            wv = tags.get('water') or ''
            if tags.get('waterway') == 'riverbank' or wv in ('river', 'oxbow'):
                water_area_cls = 'river'
            elif wv == 'canal':
                water_area_cls = 'canal'
            elif wv == 'stream':
                water_area_cls = 'stream'
            elif wv == 'reservoir' or tags.get('landuse') == 'reservoir':
                water_area_cls = 'reservoir'
            elif wv not in WATER_AREA_SKIP:
                water_area_cls = 'lake'
        if t == 'relation':
            if water_area_cls:
                outers = [geom_of(m) for m in el.get('members') or ()
                          if m.get('type') == 'way' and (m.get('role') or 'outer') == 'outer']
                for ring in stitch_rings(outers):
                    wareas.append({'id': el['id'], 'c': water_area_cls, 'n': pick_name(tags), 'g': ring})
            continue
        g = geom_of(el)
        if len(g) < 2:
            continue
        if water_area_cls:
            if g[0] == g[-1] and len(g) >= 4:
                wareas.append({'id': el['id'], 'c': water_area_cls, 'n': pick_name(tags), 'g': g})
            continue
        hw = tags.get('highway')
        if hw in HW_MAP and tags.get('area') != 'yes':
            c = HW_MAP[hw]
            roads.append(((c, road_name(tags, c)), el['id'], g))
            continue
        ww = tags.get('waterway')
        if ww in ('river', 'stream', 'canal') and tags.get('tunnel') != 'culvert':
            wlines.append(((ww, pick_name(tags)), el['id'], g))
    return roads, wlines, wareas, places, peaks


def road_threshold(c, lv):
    if c in ('trunk', 'primary', 'secondary', 'tertiary'):
        return lv['major']
    if c == 'unclassified':
        return lv['uncl']
    if c == 'residential':
        return lv['resid']
    return lv['minor']


def build_layers(parts, field, urban, corridor_bbox, lv):
    roads_m, wlines_m, wareas, places, peaks = parts
    tol = lv['dp_m']
    resid_thr, urban_thr = lv['resid'], min(lv['resid'], lv['urban'])

    def resid_inside(p):
        return field.at(p) <= (urban_thr if field.cell(p) in urban else resid_thr)

    roads = []
    for (c, n), line in roads_m:
        inside = resid_inside if c == 'residential' else within(field, road_threshold(c, lv))
        for run in clip_line(line, inside):
            if geo.line_length_km(run) < MIN_RUN_KM:
                continue
            g = rline(geo.simplify(run, tol_m=tol))
            if len(g) >= 2:
                roads.append({'c': c, 'n': n, 'g': g})
    water = []
    for w in wareas:
        ring = w['g']
        if min(field.at(p) for p in densify(ring, 0.25)) > lv['major']:
            continue
        clipped = clip_ring_to_bbox(ring, corridor_bbox)
        if not clipped:
            continue
        if ring_area_km2(clipped, field) < MIN_WATER_AREA_KM2 and not w['n']:
            continue
        g = rline(geo.simplify(clipped, tol_m=tol))
        if len(g) >= 4 and g[0] == g[-1]:
            water.append({'c': w['c'], 'n': w['n'], 'a': True, 'g': g})
    for (c, n), line in wlines_m:
        thr = lv['stream'] if c == 'stream' else lv['major']
        for run in clip_line(line, within(field, thr)):
            if geo.line_length_km(run) < MIN_RUN_KM:
                continue
            g = rline(geo.simplify(run, tol_m=tol))
            if len(g) >= 2:
                water.append({'c': c, 'n': n, 'a': False, 'g': g})
    pl = [{'n': p['n'], 'k': p['k'], 'p': rline([p['p']])[0]} for p in places if field.at(p['p']) <= lv['major']]
    pk = [{'n': p['n'], 'e': p['e'], 'p': rline([p['p']])[0]} for p in peaks if field.at(p['p']) <= lv['major']]
    # deterministic order: roads minor -> major (draw order), water areas first, places by importance
    roads.sort(key=lambda r: (ROAD_DRAW_RANK[r['c']], r['n'] or '', r['g'][0], len(r['g'])))
    water.sort(key=lambda r: (0 if r['a'] else 1, WATER_CLASSES.index(r['c']), r['n'] or '', r['g'][0]))
    pl.sort(key=lambda r: (PLACE_RANK[r['k']], r['n'], r['p']))
    pk.sort(key=lambda r: (-(r['e'] or -1), r['n'] or '', r['p']))
    return roads, water, pl, pk


def extent(doc):
    lats, lngs = [], []
    for layer in ('roads', 'water'):
        for f in doc[layer]:
            for p in f['g']:
                lats.append(p[0])
                lngs.append(p[1])
    for layer in ('places', 'peaks'):
        for f in doc[layer]:
            lats.append(f['p'][0])
            lngs.append(f['p'][1])
    return [min(lats), min(lngs), max(lats), max(lngs)]


def serialize(doc):
    """Valid JSON with one feature per line (diff-friendly, ~1 byte/feature overhead)."""
    d = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))  # noqa: E731
    head = ','.join('%s:%s' % (d(k), d(doc[k])) for k in TOP_KEYS[:7])
    parts = []
    for k in TOP_KEYS[7:]:
        rows = doc[k]
        parts.append('%s:[%s]' % (d(k), ('\n' + ',\n'.join(d(r) for r in rows) + '\n') if rows else ''))
    return '{' + head + ',\n' + ',\n'.join(parts) + '}\n'


def build_route(seed, route_id, offline, refresh, log):
    lines = route_network(seed, route_id)
    query = build_query(lines)
    log('[%s] %d edges, query %d chars' % (route_id, len(lines), len(query)))
    data = fetch_overpass(route_id, query, offline=offline, refresh=refresh, log=log)
    osm_date = ((data.get('osm3s') or {}).get('timestamp_osm_base') or '')[:10]
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', osm_date):
        raise SystemExit('cache for %s has no osm3s.timestamp_osm_base' % route_id)
    t0 = time.time()
    field_bbox = pad_bbox(lines, LEVELS[0]['major'] + 1.0)
    field = DistanceField(lines, field_bbox, cap_km=LEVELS[0]['major'] + 1.0)
    roads, wlines, wareas, places, peaks = classify(data['elements'])
    parts = (merge_lines(roads), merge_lines(wlines), wareas, places, peaks)
    urban = urban_cells(parts[0], field, LEVELS[0]['resid'])
    log('  raw: %d road ways -> %d merged, %d waterways -> %d merged, %d water areas, %d places, %d peaks,'
        ' %d town-grid cells (field %dx%d, %.1f s)' % (len(roads), len(parts[0]), len(wlines), len(parts[1]),
                                                     len(wareas), len(places), len(peaks), len(urban), field.nx,
                                                     field.ny, time.time() - t0))
    chosen = None
    for li, lv in enumerate(LEVELS):
        corridor = pad_bbox(lines, lv['major'])
        r, w, pl, pk = build_layers(parts, field, urban, corridor, lv)
        doc = {'v': 1, 'route_id': route_id, 'bbox': None, 'generated_at': osm_date,
               'source': 'OpenStreetMap (Overpass API)', 'license': 'ODbL-1.0',
               'attribution': '© OpenStreetMap contributors', 'roads': r, 'water': w, 'places': pl, 'peaks': pk}
        doc['bbox'] = extent(doc)
        txt = serialize(doc)
        size = len(txt.encode('utf-8'))
        log('  level %d %s -> %d bytes' % (li, json.dumps(lv, sort_keys=True), size))
        chosen = (li, lv, doc, txt, size)
        if size <= TARGET_BYTES:
            break
    li, lv, doc, txt, size = chosen
    if size > MAX_BYTES:
        raise SystemExit('%s: %d bytes even at the tightest level (limit %d)' % (route_id, size, MAX_BYTES))
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, route_id + '.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(txt)
    log('  wrote %s (%d bytes, level %d, %.1f s)' % (os.path.relpath(out, ROOT), size, li, time.time() - t0))
    return out


# ----------------------------------------------------------------------------------------------- --check

def _is_pt(p):
    return (isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                                                         for v in p))


def _dec_ok(v):
    return abs(round(v, 5) - v) < 1e-9


def check_file(path, route_id, seed):
    """Return (errors, stats) for one basemap file."""
    errs = []
    size = os.path.getsize(path)
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            doc = json.load(fh)
    except ValueError as exc:
        return ['invalid JSON: %s' % exc], {}
    if not isinstance(doc, dict):
        return ['top level must be a JSON object, got %s' % type(doc).__name__], {}
    if list(doc.keys()) != TOP_KEYS:
        errs.append('top-level keys %s != %s' % (list(doc.keys()), TOP_KEYS))
    if doc.get('v') != 1:
        errs.append('v must be 1')
    if doc.get('route_id') != route_id:
        errs.append('route_id %r != file name' % doc.get('route_id'))
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(doc.get('generated_at'))):
        errs.append('generated_at must be YYYY-MM-DD')
    for k, v in (('source', 'OpenStreetMap (Overpass API)'), ('license', 'ODbL-1.0'),
                 ('attribution', '© OpenStreetMap contributors')):
        if doc.get(k) != v:
            errs.append('%s must be %r' % (k, v))
    bb = doc.get('bbox')
    if not (isinstance(bb, list) and len(bb) == 4
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in bb)
            and bb[0] < bb[2] and bb[1] < bb[3]):
        errs.append('bbox must be [south, west, north, east]')
        bb = [-90, -180, 90, 180]
    vs, vw, vn, ve = VN_ENVELOPE
    if not (vs <= bb[0] and bb[2] <= vn and vw <= bb[1] and bb[3] <= ve):
        errs.append('bbox %s outside the Vietnam envelope %s' % (bb, VN_ENVELOPE))
    if size > MAX_BYTES:
        errs.append('size %d bytes > %d' % (size, MAX_BYTES))

    def in_bb(p):
        return bb[0] - 1e-9 <= p[0] <= bb[2] + 1e-9 and bb[1] - 1e-9 <= p[1] <= bb[3] + 1e-9

    def pt_ok(p):  # a [lat,lng] pair inside the bbox with at most 5 decimals
        return _is_pt(p) and in_bb(p) and _dec_ok(p[0]) and _dec_ok(p[1])

    def arr(layer):
        v = doc.get(layer)
        return v if isinstance(v, list) else []

    stats = {'bytes': size, 'roads': {}, 'water': {}, 'places': {}, 'peaks': 0, 'points': 0, 'road_km': 0.0}
    bad_pts = 0
    good_roads = []  # features that passed validation (used by the coverage checks below)
    good_places = []
    for layer, enum, amin in (('roads', ROAD_CLASSES, 2), ('water', WATER_CLASSES, 2)):
        feats = doc.get(layer)
        if not isinstance(feats, list):
            errs.append('%s must be an array' % layer)
            continue
        want = ['c', 'n', 'g'] if layer == 'roads' else ['c', 'n', 'a', 'g']
        for i, f in enumerate(feats):
            if not isinstance(f, dict) or list(f.keys()) != want:
                errs.append('%s[%d] keys must be %s' % (layer, i, want))
                continue
            cls_ok = isinstance(f['c'], str) and f['c'] in enum
            if not cls_ok:
                errs.append('%s[%d] bad class %r' % (layer, i, f['c']))
            if f['n'] is not None and not (isinstance(f['n'], str) and f['n'].strip()):
                errs.append('%s[%d] n must be a non-empty string or null' % (layer, i))
            if layer == 'water' and not isinstance(f['a'], bool):
                errs.append('water[%d] a must be boolean' % i)
            g = f['g']
            if not isinstance(g, list) or len(g) < amin or not all(_is_pt(p) for p in g):
                errs.append('%s[%d] g must be >= %d [lat,lng] points' % (layer, i, amin))
                continue
            if layer == 'water' and f['a'] and (len(g) < 4 or g[0] != g[-1]):
                errs.append('water[%d] area ring must be closed with >= 4 points' % i)
            bad_pts += sum(1 for p in g if not pt_ok(p))
            stats['points'] += len(g)
            if layer == 'roads':
                good_roads.append(g)
                stats['road_km'] += geo.line_length_km(g)
            if cls_ok:
                key = f['c'] + ('/area' if layer == 'water' and f['a'] is True else '')
                stats[layer][key] = stats[layer].get(key, 0) + 1
    for i, f in enumerate(arr('places')):
        if not isinstance(f, dict) or list(f.keys()) != ['n', 'k', 'p']:
            errs.append('places[%d] keys must be n,k,p' % i)
            continue
        if not (isinstance(f['n'], str) and f['n'].strip()):
            errs.append('places[%d] needs a name' % i)
        kind_ok = isinstance(f['k'], str) and f['k'] in PLACE_KINDS
        if not kind_ok:
            errs.append('places[%d] bad kind %r' % (i, f['k']))
        if not pt_ok(f['p']):
            bad_pts += 1
        else:
            good_places.append(f)
        if kind_ok:
            stats['places'][f['k']] = stats['places'].get(f['k'], 0) + 1
    for i, f in enumerate(arr('peaks')):
        if not isinstance(f, dict) or list(f.keys()) != ['n', 'e', 'p']:
            errs.append('peaks[%d] keys must be n,e,p' % i)
            continue
        if f['n'] is not None and not (isinstance(f['n'], str) and f['n'].strip()):
            errs.append('peaks[%d] n must be a non-empty string or null' % i)
        if f['e'] is not None and not (isinstance(f['e'], int) and not isinstance(f['e'], bool)):
            errs.append('peaks[%d] e must be an integer or null' % i)
        if f['n'] is None and f['e'] is None:
            errs.append('peaks[%d] needs a name or an elevation (nothing to label)' % i)
        if not pt_ok(f['p']):
            bad_pts += 1
        stats['peaks'] += 1
    for layer in ('places', 'peaks'):
        if not isinstance(doc.get(layer), list):
            errs.append('%s must be an array' % layer)
    if bad_pts:
        errs.append('%d coordinates outside bbox or with more than 5 decimals' % bad_pts)
    if not doc.get('roads') or not doc.get('places'):
        errs.append('roads and places must not be empty')
    # the file must cover the corridor it belongs to
    if seed is not None:
        lines = route_network(seed, route_id)
        pts = [p for ln in lines for p in ln]
        outside = sum(1 for p in pts if not in_bb(p))
        if outside:
            errs.append('bbox does not cover %d route network vertices' % outside)
        field = DistanceField(lines, pad_bbox(lines, 8.0), cap_km=8.0, step_km=0.5)
        far = [f['n'] for f in good_places if field.at(tuple(f['p'])) > 7.6]
        if far:
            errs.append('%d places farther than the corridor buffer, e.g. %s' % (len(far), far[:3]))
        stats['net_km'] = sum(geo.line_length_km(ln) for ln in lines)
        # informational: share of each route edge that runs along a basemap road (sampled every 0.5 km)
        roads = [[tuple(p) for p in g] for g in good_roads]
        rfield = DistanceField(roads, pad_bbox(lines, 1.0), cap_km=1.0, grid=False)
        gaps = []
        for e in seed['edges']:
            if e['route_id'] != route_id:
                continue
            g = [tuple(p) for p in e['geometry']]
            cum = geo.cumulative_km(g)
            samples = [geo.point_at(g, k * 0.5, cum) for k in range(int(cum[-1] / 0.5) + 1)]
            off = sum(1 for q in samples if rfield.exact(q) > 0.05)
            if off > 0.2 * len(samples):
                gaps.append('%s %d/%d' % (e['id'], off, len(samples)))
        stats['edge_gaps'] = gaps
    stats['bbox'] = bb
    stats['generated_at'] = doc.get('generated_at')
    return errs, stats


def check(log=print):
    try:
        seed = load_seed()
    except (OSError, ValueError) as exc:
        log('warning: cannot read seed-core.js (%s) — corridor coverage checks skipped' % exc)
        seed = None
    ok = True
    rows = []
    for rid in ROUTES:
        path = os.path.join(OUT_DIR, rid + '.json')
        if not os.path.exists(path):
            log('FAIL %s: missing %s' % (rid, os.path.relpath(path, ROOT)))
            ok = False
            continue
        try:
            errs, st = check_file(path, rid, seed)
        except Exception as exc:  # malformed structure the checks above did not anticipate: report, don't crash
            errs, st = ['malformed file (%s: %s)' % (type(exc).__name__, exc)], {}
        for e in errs:
            log('FAIL %s: %s' % (rid, e))
        ok = ok and not errs
        if st:
            rows.append((rid, st))
    extra = sorted(f for f in os.listdir(OUT_DIR) if f.endswith('.json') and f[:-5] not in ROUTES) \
        if os.path.isdir(OUT_DIR) else []
    for f in extra:
        log('FAIL unexpected file assets/data/basemap/%s' % f)
        ok = False
    log('\n%-18s %8s %8s %6s %7s %6s %6s %6s %7s  %s' % ('route', 'bytes', 'headroom', 'roads', 'road_km', 'water',
                                                        'places', 'peaks', 'points', 'bbox'))
    for rid, st in rows:
        log('%-18s %8d %8d %6d %7.0f %6d %6d %6d %7d  %s' % (
            rid, st['bytes'], MAX_BYTES - st['bytes'], sum(st['roads'].values()), st['road_km'],
            sum(st['water'].values()), sum(st['places'].values()), st['peaks'], st['points'], st['bbox']))
    log('  (size limit %d bytes per file; headroom = limit - bytes)' % MAX_BYTES)
    for rid, st in rows:
        if st.get('edge_gaps'):
            log('  note %s: route edges mostly >50 m from any basemap road (samples off/total): %s'
                % (rid, ', '.join(st['edge_gaps'])))
    for rid, st in rows:
        log('  %s (OSM %s): roads %s | water %s | places %s' % (
            rid, st['generated_at'], ', '.join('%s %d' % (c, st['roads'][c]) for c in ROAD_CLASSES if c in st['roads']),
            ', '.join('%s %d' % kv for kv in sorted(st['water'].items())),
            ', '.join('%s %d' % (k, st['places'][k]) for k in PLACE_KINDS if k in st['places'])))
    log('\n%s' % ('OK — all basemap files valid' if ok else 'basemap check FAILED'))
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offline', action='store_true', help='never touch the network (cache only)')
    ap.add_argument('--refresh', action='store_true', help='re-download the Overpass data (one query per route)')
    ap.add_argument('--route', choices=ROUTES, action='append', help='limit to one corridor (repeatable)')
    ap.add_argument('--check', action='store_true', help='validate assets/data/basemap/*.json and print stats')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()
    log = (lambda *a: None) if args.quiet else print
    if args.check:
        sys.exit(0 if check(print) else 1)
    if args.refresh and args.offline:
        ap.error('--refresh and --offline exclude each other')
    seed = load_seed()
    failed = []
    for rid in args.route or ROUTES:
        try:
            build_route(seed, rid, args.offline, args.refresh, log)
        except OverpassError as exc:
            print('ERROR %s: %s' % (rid, exc), file=sys.stderr)
            failed.append(rid)
    if failed:
        sys.exit('basemap build incomplete: %s' % ', '.join(failed))
    log('run with --check to validate.')


if __name__ == '__main__':
    main()
