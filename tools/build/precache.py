#!/usr/bin/env python3
"""tools/build/precache.py — regenerate the PRECACHE array in ROOT/sw.js from the files the app actually ships.
Replaces the first `const PRECACHE = [ ... ];` block and bumps the cache version suffix if present.
"""
import os, re, hashlib, json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
INCLUDE_DIRS = ['assets/css', 'assets/js', 'assets/img', 'assets/fonts', 'assets/vendor']
EXCLUDE_JS = {'seed-admin.js', 'page-admin.js'}   # admin-only, not needed for the offline user app
EXCLUDE_FILES = {'assets/css/admin.css'}          # admin.html styles (the traveller app never loads them)
# assets/js/admin: admin-only. assets/data/basemap: offline vector basemap JSON (≤ 700 KB per corridor) — downloaded
# on demand by NC.basemap into Cache Storage 'nc-basemap-v1', never precached (sw.js serves it from that cache offline).
EXCLUDE_DIRS = {'assets/js/admin', 'assets/data/basemap'}
TOP = ['./', 'index.html', 'manifest.webmanifest']
EXT = {'.css', '.js', '.svg', '.png', '.woff2', '.webmanifest', '.html', '.json', '.webp', '.jpg'}

files = []
for d in INCLUDE_DIRS:
    for base, dirs, names in os.walk(os.path.join(ROOT, d)):
        rel_base = os.path.relpath(base, ROOT)
        if any(rel_base == x or rel_base.startswith(x + os.sep) for x in EXCLUDE_DIRS):
            continue
        for n in sorted(names):
            if n.startswith('.') or n in EXCLUDE_JS or os.path.splitext(n)[1] not in EXT:
                continue
            rel = os.path.join(rel_base, n).replace(os.sep, '/')
            if rel in EXCLUDE_FILES:
                continue
            files.append(rel)
files = TOP + sorted(files)
h = hashlib.sha1()
for f in files:
    p = os.path.join(ROOT, f)
    if os.path.isfile(p):
        with open(p, 'rb') as fh:
            h.update(fh.read())
digest = h.hexdigest()[:8]
sw_p = os.path.join(ROOT, 'sw.js')
sw = open(sw_p, encoding='utf-8').read()
arr = 'const PRECACHE = ' + json.dumps(files, indent=2, ensure_ascii=False) + ';'
sw, n = re.subn(r'const PRECACHE\s*=\s*\[.*?\];', lambda m: arr, sw, count=1, flags=re.S)
if not n:
    raise SystemExit('PRECACHE array not found in sw.js')
sw = re.sub(r"(['\"]nc-v2-)[^'\"]*(['\"])", lambda m: m.group(1) + digest + m.group(2), sw, count=1)
open(sw_p, 'w', encoding='utf-8').write(sw)
print('PRECACHE entries:', len(files), 'cache version nc-v2-' + digest)
