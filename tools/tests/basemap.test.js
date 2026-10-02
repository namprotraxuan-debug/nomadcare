/*
 * basemap.test.js — node --test suite for the offline vector basemap client (assets/js/services/basemap.js, pure
 * helpers) and the service worker's tile validation (sw.js tileVerdict, run in a vm sandbox with stub globals).
 * R5: never cache OSM "Access blocked" / CARTO "API key required" tiles; keep caching real tiles (even tiny sea tiles).
 * Run: node --test tools/tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const BM = require(path.join(__dirname, '../../assets/js/services/basemap.js'));
const P = BM.pure;

/* ---------- file validation ---------- */

function sample(extra) {
  return Object.assign({
    v: 1, route_id: 'ha-giang-loop', bbox: [22.7, 104.9, 23.4, 105.5], generated_at: '2026-09-30',
    source: 'OpenStreetMap (Overpass API)', license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
    roads: [{ c: 'trunk', n: 'QL4C', g: [[22.8, 104.98], [22.9, 105.0], [23.0, 105.1]] }],
    water: [{ c: 'river', n: 'Sông Nho Quế', a: false, g: [[23.1, 105.3], [23.2, 105.35]] },
      { c: 'lake', n: null, a: true, g: [[23, 105], [23.01, 105], [23.01, 105.01], [23, 105]] }],
    places: [{ n: 'Đồng Văn', k: 'town', p: [23.278, 105.362] }],
    peaks: [{ n: null, e: 1500, p: [23.1, 105.2] }]
  }, extra || {});
}

test('validate accepts a v1 corridor file and rejects broken ones', () => {
  assert.equal(P.validate(sample(), 'ha-giang-loop').ok, true);
  assert.equal(P.validate(sample(), 'khanh-le').error, 'route_id');
  assert.equal(P.validate(sample({ v: 2 })).error, 'version');
  assert.equal(P.validate(sample({ bbox: [1, 2, 3] })).error, 'bbox');
  assert.equal(P.validate(sample({ roads: {} })).error, 'roads');
  assert.equal(P.validate(sample({ roads: [{ c: 'trunk', g: [[22.8, 104.98]] }] })).error, 'geometry');
  assert.equal(P.validate(sample({ places: [{ n: 'X', k: 'town', p: [200, 1] }] })).error, 'point');
  assert.equal(P.validate(null).ok, false);
  // optional arrays may be missing; unknown classes are tolerated
  const minimal = { v: 1, route_id: 'khanh-le', bbox: [11.9, 108.4, 12.4, 109.2], roads: [{ c: 'motorway', g: [[12, 108.5], [12.1, 108.6]] }] };
  assert.equal(P.validate(minimal, 'khanh-le').ok, true);
  assert.equal(P.roadClass('motorway'), 'unclassified');
  assert.equal(P.waterClass({ c: 'ditch', a: false }), 'stream');
  assert.equal(P.waterClass({ c: 'lake', a: true }), 'area');
});

/* ---------- suggestion decision ---------- */

test('shouldSuggest: only for a not-downloaded pilot corridor with a dead zone, online, not postponed', () => {
  const ok = { hasLostZone: true, known: true, supported: true, downloaded: false, later: false, session: false, online: true, available: null, busy: false };
  assert.deepEqual(P.shouldSuggest(ok), { show: true, reason: 'ok' });
  const cases = [
    [{ hasLostZone: false }, 'no_lost_zone'], [{ known: false }, 'not_corridor'], [{ supported: false }, 'unsupported'],
    [{ downloaded: true }, 'downloaded'], [{ later: true }, 'later'], [{ session: true }, 'session'],
    [{ online: false }, 'offline'], [{ available: false }, 'unavailable'], [{ busy: true }, 'busy']
  ];
  cases.forEach(([patch, reason]) => {
    const r = P.shouldSuggest(Object.assign({}, ok, patch));
    assert.equal(r.show, false, reason);
    assert.equal(r.reason, reason);
  });
});

/* ---------- label density + collisions ---------- */

test('zoom thresholds: minor classes and labels appear only when zoomed in', () => {
  assert.ok(P.minZoom('road', 'trunk') < P.minZoom('road', 'tertiary'));
  assert.ok(P.minZoom('road', 'tertiary') < P.minZoom('road', 'residential'));
  assert.ok(P.minZoom('place', 'town') < P.minZoom('place', 'village'));
  assert.ok(P.minZoom('place', 'village') < P.minZoom('place', 'hamlet'));
  assert.ok(P.minZoom('water', 'river') < P.minZoom('water', 'stream'));
  assert.equal(P.minZoom('road', 'nope'), 99);
  assert.ok(P.weightFor('trunk', 14) > P.weightFor('trunk', 8));
  assert.ok(P.weightFor('primary', 12, true) > P.weightFor('primary', 12));
});

test('layoutLabels keeps the higher-priority label and drops overlaps / off-screen ones', () => {
  const items = [
    { x: 100, y: 100, w: 60, h: 16, pri: 3 },   // village
    { x: 110, y: 104, w: 60, h: 16, pri: 0 },   // town, overlaps the village → wins
    { x: 300, y: 300, w: 40, h: 16, pri: 5 },   // free
    { x: 5, y: 50, w: 60, h: 16, pri: 0 }       // crosses the left edge → hidden
  ];
  assert.deepEqual(P.layoutLabels(items, { W: 400, H: 400 }, 3), [false, true, true, false]);
  // obstacles (floating controls) block labels too
  assert.deepEqual(P.layoutLabels([{ x: 300, y: 300, w: 40, h: 16, pri: 0 }], { W: 400, H: 400 }, 3, [{ x: 280, y: 280, r: 340, b: 320 }]), [false]);
});

test('refLabels: one label per road ref, on its longest line', () => {
  const roads = [
    { c: 'trunk', n: 'QL4C', g: [[1, 1], [1, 2]] },
    { c: 'trunk', n: 'QL4C', g: [[2, 1], [2, 2], [2, 3], [2, 4]] },
    { c: 'track', n: 'Đường mòn', g: [[3, 1], [3, 2]] },   // minor class → no ref label
    { c: 'primary', n: null, g: [[4, 1], [4, 2]] }
  ];
  const r = P.refLabels(roads);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 'QL4C');
  assert.deepEqual(r[0].p, [2, 3]);
});

test('coversView: the vector basemap stands for the view only where a corridor has data', () => {
  const hg = [22.7, 104.9, 23.4, 105.5];
  // centre inside the corridor bbox
  assert.equal(P.coversView(hg, { s: 22.9, w: 105.0, n: 23.1, e: 105.2 }, [23.0, 105.1]), true);
  // far away (another corridor on screen) → no
  assert.equal(P.coversView(hg, { s: 11.9, w: 108.4, n: 12.4, e: 109.2 }, [12.1, 108.8]), false);
  // corridor in a corner, < 25 % of the view → no; ≥ 25 % → yes
  assert.equal(P.coversView(hg, { s: 23.3, w: 105.4, n: 24.3, e: 106.4 }, [23.8, 105.9]), false);
  assert.equal(P.coversView(hg, { s: 22.9, w: 105.0, n: 23.9, e: 106.0 }, [23.4 + 0.001, 105.5]), true); // 0.5 × 0.5 of 1 × 1
  // whole country view: the corridor is a speck → no
  assert.equal(P.coversView(hg, { s: 8, w: 102, n: 23.5, e: 110 }, [16, 106]), false);
  assert.equal(P.coversView(null, { s: 0, w: 0, n: 1, e: 1 }, [0.5, 0.5]), false);
});

test('coversView: a route overview framed above the phone sheet counts as covered, specks and far corridors do not', () => {
  const hg = [22.71009, 104.86071, 23.39267, 105.48664]; // ha-giang-loop.json bbox
  // Measured in Chrome 390×844 (2026-10-02): Mèo Vạc → TP. Hà Giang, half sheet, zoom 9. The fit padding for the sheet
  // pushes the whole-map centre (22.513) south of the corridor and the corridor fills only 22 % of the map.
  const full = { s: 21.6013, w: 104.7464, n: 23.4179, e: 105.8176 };
  assert.equal(P.coversView(hg, full, [22.513, 105.282]), true, 'whole corridor in view, 22 % of the map');
  // same overview at zoom 8.5 (map area × 2, centre 22.21 as reported): still ≥ 10 % of the map (11 %)
  const z85 = { s: 20.93, w: 104.52, n: 23.49, e: 106.035 };
  assert.equal(P.coversView(hg, z85, [22.21, 105.28]), true, 'zoom 8.5 overview');
  // visible part only (the fit padding tl [20, 84] / br [82, 450] on a 390 × 716 map): its centre is on the route
  const vis = { s: 22.738, w: 104.80, n: 23.208, e: 105.59 };
  assert.equal(P.coversView(hg, vis, [22.973, 105.195]), true, 'centre of the visible area');
  // the corridor is fully on screen but small: a zoom-7 view (≈ 1.4 % of the map, centre off it) keeps the raster
  assert.equal(P.coversView(hg, { s: 18.37, w: 103.0, n: 25.63, e: 107.28 }, [22.0, 105.14]), false, 'zoom 7 speck');
  // most of the corridor visible is not enough when it is a sliver of a large view…
  assert.equal(P.coversView(hg, { s: 22.9, w: 104.0, n: 26.0, e: 108.0 }, [24.45, 106.0]), false, 'sliver');
  // …and a small part of the corridor in a corner of a tight view is not enough either (< 50 % of it, < 25 % of the view)
  assert.equal(P.coversView(hg, { s: 23.2, w: 105.3, n: 24.2, e: 106.3 }, [23.7, 105.8]), false, 'corner');
  // far away: Hà Nội at zoom 11 (measured) and a whole-north view without the corridor
  assert.equal(P.coversView(hg, { s: 20.7985, w: 105.7201, n: 21.2574, e: 105.9879 }, [21.028, 105.854]), false, 'Hà Nội');
  assert.equal(P.coversView(hg, { s: 19.5, w: 104.0, n: 22.0, e: 107.0 }, [20.75, 105.5]), false, 'south of the corridor');
  // a degenerate view never counts as covered (unless its centre is on the corridor)
  assert.equal(P.coversView(hg, { s: 22.8, w: 105.0, n: 22.8, e: 105.0 }, [21, 104]), false);
});

test('lineBoxes: obstacle boxes along an on-screen line only', () => {
  const W = 400, H = 300;
  const boxes = P.lineBoxes([{ x: 0, y: 100 }, { x: 100, y: 100 }], 6, 10, W, H);
  assert.ok(boxes.length >= 10 && boxes.length <= 12, 'one box every 10 px');
  assert.ok(boxes.every((b) => b.b - b.y === 12 && b.y === 94));
  // a label box on the line collides, one 20 px above does not
  assert.deepEqual(P.layoutLabels([{ x: 50, y: 100, w: 40, h: 14, pri: 0 }, { x: 50, y: 70, w: 40, h: 14, pri: 0 }], { W, H }, 2, boxes), [false, true]);
  // a segment entirely off screen produces nothing
  assert.equal(P.lineBoxes([{ x: -100, y: -50 }, { x: -20, y: -80 }], 6, 10, W, H).length, 0);
  assert.equal(P.lineBoxes([], 6, 10, W, H).length, 0);
});

/* ---------- sw.js tile validation (tileVerdict) ---------- */

function loadSw() {
  const src = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
  const self = {
    location: { hostname: 'localhost', href: 'http://localhost:8099/sw.js', origin: 'http://localhost:8099' },
    addEventListener() { }, skipWaiting() { }, clients: { claim() { }, matchAll: async () => [], openWindow: async () => null },
    registration: { scope: 'http://localhost:8099/', showNotification: async () => { } }, // push handlers (W6)
    crypto: globalThis.crypto
  };
  const ctx = vm.createContext({ self, caches: {}, fetch: async () => { throw new Error('no network in tests'); }, Response, Headers, Request, URL, Uint8Array, setTimeout, clearTimeout, console });
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  return ctx;
}
function png(bytes) { return Buffer.from(bytes); }

test('sw tileVerdict: blocked / watermark / uncacheable tiles are never cached, real tiles are', async () => {
  const sw = loadSw();
  const osm = (z) => new Request('https://tile.openstreetmap.org/' + z + '.png');
  const img = (body, headers) => new Response(body, { status: 200, headers: Object.assign({ 'content-type': 'image/png' }, headers || {}) });
  // a normal tile (any size — a plain sea tile is only ~100 bytes and must still be cached)
  assert.equal(await sw.tileVerdict(osm('9/408/228'), img(png(new Array(103).fill(7)), { 'cache-control': 'max-age=522909, stale-while-revalidate=604800' })), 'ok');
  // x-blocked (readable only when exposed, e.g. same-origin proxies) → blocked
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(png([1, 2, 3]), { 'x-blocked': 'No referer sent' })), 'blocked');
  // OSM block tiles come with cache-control: no-cache → never stored
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(png(new Array(500).fill(1)), { 'cache-control': 'no-cache' })), 'nocache');
  // keyless CARTO URL = "API KEY REQUIRED" watermark → blocked; keyed URL is fine
  assert.equal(await sw.tileVerdict(new Request('https://a.basemaps.cartocdn.com/rastertiles/voyager/9/408/228.png'), img(png([1, 2]), { 'cache-control': 'public, max-age=86400' })), 'blocked');
  assert.equal(await sw.tileVerdict(new Request('https://a.basemaps.cartocdn.com/rastertiles/voyager/9/408/228.png?key=abc'), img(png([1, 2]), { 'cache-control': 'public, max-age=86400' })), 'ok');
  // non-image bodies and errors are not tiles
  assert.equal(await sw.tileVerdict(osm('1/0/0'), new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })), 'error');
  assert.equal(await sw.tileVerdict(osm('1/0/0'), new Response('', { status: 404 })), 'error');
  assert.equal(await sw.tileVerdict(osm('1/0/0'), img(png([]))), 'error');
  assert.equal(await sw.tileVerdict(osm('1/0/0'), null), 'error');
});

test('sw tileVerdict: the known block images are recognised by length + SHA-256 even with cacheable headers', async () => {
  const sw = loadSw();
  // BLOCK_TILES is a top-level const (not a context property): read it with a script in the same context
  const table = vm.runInContext('BLOCK_TILES', sw);
  assert.ok(Object.keys(table).length >= 3, 'fingerprint table present');
  // forge a body of the right length whose hash we register, to prove the hash path works
  const body = Buffer.alloc(6987, 9);
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  vm.runInContext('BLOCK_TILES[6987].push(' + JSON.stringify(sha) + ')', sw);
  const res = new Response(body, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'max-age=600' } });
  assert.equal(await sw.tileVerdict(new Request('https://tile.openstreetmap.org/10/809/451.png'), res), 'blocked');
  // same length, different content → a real tile
  const other = Buffer.alloc(6987, 3);
  assert.equal(await sw.tileVerdict(new Request('https://tile.openstreetmap.org/10/809/452.png'), new Response(other, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'max-age=600' } })), 'ok');
  // the table in sw.js and mapkit.js must stay identical
  const mk = fs.readFileSync(path.join(__dirname, '../../assets/js/services/mapkit.js'), 'utf8');
  const swSrc = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
  const hashes = (s) => (s.match(/[0-9a-f]{64}/g) || []).sort().join(',');
  assert.equal(hashes(mk), hashes(swSrc), 'BLOCK_TILES fingerprints identical in sw.js and mapkit.js');
});

test('sw: no tile prefetch path, tile + basemap cache names consistent with the page', () => {
  const swSrc = fs.readFileSync(path.join(__dirname, '../../sw.js'), 'utf8');
  const mk = fs.readFileSync(path.join(__dirname, '../../assets/js/services/mapkit.js'), 'utf8');
  const bm = fs.readFileSync(path.join(__dirname, '../../assets/js/services/basemap.js'), 'utf8');
  const tileSw = /const TILE_CACHE = '([^']+)'/.exec(swSrc)[1];
  const tileMk = /var TILE_CACHE = '([^']+)'/.exec(mk)[1];
  assert.equal(tileSw, tileMk, 'page reads the same tile cache the worker writes');
  assert.notEqual(tileSw, 'nc-tiles', 'tile cache renamed so tiles cached by older workers are purged');
  assert.equal(/const BASEMAP_CACHE = '([^']+)'/.exec(swSrc)[1], /var CACHE = '([^']+)'/.exec(bm)[1]);
  assert.match(swSrc, /tile_prefetch_disabled/);
  const pre = fs.readFileSync(path.join(__dirname, '../../tools/build/precache.py'), 'utf8');
  assert.match(pre, /'assets\/data\/basemap'/, 'precache.py excludes the basemap directory');
  assert.doesNotMatch(swSrc.slice(swSrc.indexOf('const PRECACHE'), swSrc.indexOf('];', swSrc.indexOf('const PRECACHE'))), /assets\/data\/basemap/);
});
