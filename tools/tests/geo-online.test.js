/*
 * geo-online.test.js — node --test suite for the pure part of assets/js/services/geo-online.js (owner: W4 MOD.02):
 * Nominatim / OSRM URL building, response parsing, Douglas–Peucker simplification, the ≤ 1 request/s global
 * limiter (fake clock), the LRU cache and route keys. No network.
 * Run: node --test tools/tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const G = require(path.join(__dirname, '../../assets/js/services/geo-online.js'));

test('searchUrl: jsonv2, Vietnam only, vi,en, limit 8, encoded query; no position is sent', () => {
  const u = G.searchUrl('https://nominatim.openstreetmap.org/search', '  Chợ  Bến Thành & co ');
  assert.equal(u, 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=vn&accept-language=vi%2Cen&limit=8&q=' +
    encodeURIComponent('Chợ Bến Thành & co'));
  assert.ok(!/viewbox|lat=|lon=/.test(u));
  assert.match(G.searchUrl(null, 'x', { limit: 99 }), /limit=20/);
  assert.match(G.searchUrl(undefined, 'x'), /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
});

test('routeUrl / profileBase: lng,lat order, 5 decimals, full geojson overview; car for motorbike, foot for hiking', () => {
  const cfg = { osrmCarUrl: 'https://routing.openstreetmap.de/routed-car/route/v1/driving', osrmFootUrl: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot' };
  assert.equal(G.profileBase(cfg, 'motorbike'), cfg.osrmCarUrl);
  assert.equal(G.profileBase(cfg, 'hiking'), cfg.osrmFootUrl);
  assert.equal(G.profileBase({}, 'hiking'), G.DEFAULTS.osrmFootUrl);
  const u = G.routeUrl(cfg.osrmCarUrl, { lat: 10.7769123, lng: 106.7009456 }, [22.8233, 104.98357]);
  assert.equal(u, 'https://routing.openstreetmap.de/routed-car/route/v1/driving/106.70095,10.77691;104.98357,22.8233?overview=full&geometries=geojson');
  assert.throws(() => G.routeUrl(cfg.osrmCarUrl, null, [1, 2]), /parse/);
});

test('parseSearch: coordinates, names, Vietnam bbox, de-duplication, malformed input', () => {
  const json = [
    { place_id: 1, osm_type: 'node', osm_id: 42, lat: '10.7725', lon: '106.6980', category: 'amenity', type: 'marketplace', addresstype: 'amenity',
      name: 'Chợ Bến Thành', display_name: 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh, Việt Nam', place_rank: 30 },
    { place_id: 2, osm_type: 'node', osm_id: 42, lat: '10.7725', lon: '106.6980', name: 'dup', display_name: 'dup' },
    { place_id: 3, osm_type: 'way', osm_id: 7, lat: '48.85', lon: '2.35', name: 'Paris', display_name: 'Paris, France' },
    { place_id: 4, osm_type: 'relation', osm_id: 9, lat: 'x', lon: '1' },
    { place_id: 5, osm_type: 'relation', osm_id: 10, lat: '21.0285', lon: '105.8542', name: '', display_name: 'Hà Nội, 10000, Việt Nam', addresstype: 'city' },
    null
  ];
  const out = G.parseSearch(json);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'osm:n42', name: 'Chợ Bến Thành', label: 'Chợ Bến Thành, Lê Lợi, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh',
    area: 'Lê Lợi, Phường Bến Thành, Quận 1, Thành phố Hồ Chí Minh', lat: 10.7725, lng: 106.698, type: 'amenity', category: 'amenity', rank: 30 });
  assert.equal(out[1].name, 'Hà Nội', 'name falls back to the first part of display_name');
  assert.equal(out[1].label, 'Hà Nội', 'country and postcode dropped from the label');
  assert.equal(out[1].id, 'osm:r10');
  assert.deepEqual(G.parseSearch([]), []);
  assert.throws(() => G.parseSearch({ error: 'x' }), /parse/);
});

test('parseRoute: geojson [lng,lat] → [lat,lng], km, minutes; NoRoute and malformed responses', () => {
  const ok = { code: 'Ok', routes: [{ distance: 12345.6, duration: 1800, geometry: { type: 'LineString', coordinates: [[106.7, 10.77], [106.71, 10.78], [106.72, 10.8]] } }] };
  const r = G.parseRoute(ok);
  assert.deepEqual(r.geometry, [[10.77, 106.7], [10.78, 106.71], [10.8, 106.72]]);
  assert.ok(Math.abs(r.distance_km - 12.3456) < 1e-9);
  assert.equal(r.duration_min, 30);
  assert.throws(() => G.parseRoute({ code: 'NoRoute', routes: [] }), (e) => e.code === 'no_route');
  assert.throws(() => G.parseRoute({ code: 'NoSegment' }), (e) => e.code === 'no_route');
  assert.throws(() => G.parseRoute({ code: 'Ok', routes: [] }), (e) => e.code === 'no_route');
  assert.throws(() => G.parseRoute({ code: 'InvalidQuery' }), (e) => e.code === 'parse');
  assert.throws(() => G.parseRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2]] } }] }), (e) => e.code === 'parse');
  assert.throws(() => G.parseRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2], ['a', 3]] } }] }), (e) => e.code === 'parse');
  assert.throws(() => G.parseRoute(null), (e) => e.code === 'parse');
});

test('simplify / simplifyTo: straight runs collapse, bends and ends stay, point budget respected', () => {
  const line = [];
  for (let i = 0; i <= 100; i++) line.push([10 + i * 0.001, 106]);             // ~11 km straight north
  for (let i = 1; i <= 100; i++) line.push([10.1, 106 + i * 0.001]);           // then east
  const s = G.simplify(line, 0.01);
  assert.equal(s.length, 3, 'two straight legs → 3 points');
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[2], line[line.length - 1]);
  assert.deepEqual(s[1], [10.1, 106]);
  const wig = [];
  for (let i = 0; i < 5000; i++) wig.push([10 + i * 0.0005, 106 + Math.sin(i / 7) * 0.01]);
  const t = G.simplifyTo(wig, 600, 0.005);
  assert.ok(t.length <= 600 && t.length >= 2, 'budget ' + t.length);
  assert.deepEqual(t[0], wig[0]);
  assert.deepEqual(t[t.length - 1], wig[wig.length - 1]);
  assert.deepEqual(G.simplify([[1, 2]], 1), [[1, 2]]);
  assert.deepEqual(G.simplifyTo([], 10), []);
});

/* Fake clock: timers run when the test advances time. */
function fakeClock() {
  let now = 0, id = 0; const timers = [];
  return {
    now: () => now,
    setTimeout: (f, ms) => { timers.push({ id: ++id, at: now + ms, f }); return id; },
    clearTimeout: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift(); now = t.at; t.f();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
      await new Promise((r) => setImmediate(r));
    }
  };
}

test('makeLimiter: one request at a time, ≥ gap between starts, aborted queued jobs are dropped', async () => {
  const clock = fakeClock();
  const L = G.makeLimiter(1000, clock);
  const starts = [];
  const job = (name) => () => { starts.push([name, clock.now()]); return Promise.resolve(name); };
  const p1 = L.schedule(job('a'));
  const p2 = L.schedule(job('b'));
  const ac = { aborted: false, _l: [], addEventListener(ev, f) { this._l.push(f); } };
  const p3 = L.schedule(job('c'), ac);
  const p3r = assert.rejects(p3, (e) => e.code === 'aborted');
  const p4 = L.schedule(job('d'));
  await clock.advance(0);
  assert.deepEqual(starts, [['a', 0]]);
  ac.aborted = true; ac._l.forEach((f) => f());
  await clock.advance(999);
  assert.equal(starts.length, 1, 'nothing before the gap');
  await clock.advance(1);
  assert.deepEqual(starts[1], ['b', 1000]);
  await clock.advance(1000);
  assert.deepEqual(starts[2], ['d', 2000], 'aborted c skipped, d keeps the pace');
  assert.equal(await p1, 'a'); assert.equal(await p2, 'b'); assert.equal(await p4, 'd');
  await p3r;
  const pre = { aborted: true, addEventListener() { } };
  await assert.rejects(L.schedule(job('e'), pre), (e) => e.code === 'aborted');
  // a failing job does not block the queue
  const pf = assert.rejects(L.schedule(() => Promise.reject(new Error('boom'))), /boom/);
  const pg = L.schedule(job('g'));
  await clock.advance(3000);
  await pf;
  assert.equal(await pg, 'g');
  assert.ok(starts[starts.length - 1][1] - starts[starts.length - 2][1] >= 1000);
});

test('lru, routeKey and normQuery', () => {
  const c = G.lru(2);
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('b'), undefined, 'least recently used dropped');
  assert.equal(c.get('a'), 1); assert.equal(c.get('c'), 3); assert.equal(c.size(), 2);
  assert.equal(G.routeKey({ lat: 10.123456, lng: 106.1 }, [22.8, 104.98], 'motorbike'), 'car|10.1235,106.1000|22.8000,104.9800');
  assert.equal(G.routeKey([1, 2], [3, 4], 'hiking').split('|')[0], 'foot');
  assert.equal(G.routeKey(null, [3, 4], 'hiking'), null);
  assert.equal(G.normQuery('  Đà   Lạt '), 'đà lạt');
});
