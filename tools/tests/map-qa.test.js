/*
 * map-qa.test.js — regression tests for the MOD.02 QA fixes (round 3, package F-MAP):
 *  - sw.js imageSize / tileVerdict: a "tile" that is not a ≥ 128 px square (1×1 / banner placeholder served with
 *    cacheable headers) is never cached; sweepTiles drops such entries an older worker stored (R5.0)
 *  - geo.js fixTime: an implausible GeolocationPosition.timestamp (µs instead of ms, wrong clock) falls back to now
 *    (R4.1 / R6.2 / XB.4)
 *  - mod02-map.js dictionaries: VI / EN key parity; the packs head card for a server copy never says "works offline"
 *    (R1.8 second pass)
 * Run: node --test tools/tests
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

/* ---------- sw.js ---------- */
function loadSw(caches) {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const self = {
    location: { hostname: 'localhost', href: 'http://localhost:8099/sw.js', origin: 'http://localhost:8099' },
    addEventListener() { }, skipWaiting() { }, clients: { claim() { }, matchAll: async () => [], openWindow: async () => null },
    registration: { scope: 'http://localhost:8099/', showNotification: async () => { } },
    crypto: globalThis.crypto
  };
  const ctx = vm.createContext({ self, caches: caches || {}, fetch: async () => { throw new Error('no network in tests'); }, Response, Headers, Request, URL, Uint8Array, setTimeout, clearTimeout, console });
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  return ctx;
}
function png(w, h, extra) {
  const b = Buffer.alloc(33 + (extra || 0));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6;
  return b;
}
function gif(w, h) { const b = Buffer.alloc(32); b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; }
function jpeg(w, h) {
  // SOI, APP0 (len 16), SOF0 (len 17: precision, height, width, …), EOI
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.alloc(19); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
function webpX(w, h) { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBPVP8X', 8, 'latin1'); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; }
function webpL(w, h) {
  const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBPVP8L', 8, 'latin1'); b[20] = 0x2f;
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
}
const osm = (z) => new Request('https://tile.openstreetmap.org/' + z + '.png');
const img = (body, headers) => new Response(body, { status: 200, headers: Object.assign({ 'content-type': 'image/png', 'cache-control': 'max-age=600' }, headers || {}) });

test('sw imageSize reads PNG / GIF / JPEG / WebP header dimensions', () => {
  const sw = loadSw();
  const size = (b) => { const s = sw.imageSize(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); return s ? s.w + 'x' + s.h : null; };
  assert.equal(size(png(256, 256)), '256x256');
  assert.equal(size(png(1, 1)), '1x1');
  assert.equal(size(gif(1, 1)), '1x1');
  assert.equal(size(jpeg(256, 256)), '256x256');
  assert.equal(size(jpeg(300, 40)), '300x40');
  assert.equal(size(webpX(512, 512)), '512x512');
  assert.equal(size(webpL(1, 1)), '1x1');
  assert.equal(size(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), null, 'unknown format → null');
});

test('sw tileVerdict: placeholder images (not a ≥ 128 px square) are blocked even with cacheable headers; real tiles are cached', async () => {
  const sw = loadSw();
  assert.equal(await sw.tileVerdict(osm('9/408/228'), img(png(256, 256, 70))), 'ok');
  assert.equal(await sw.tileVerdict(osm('9/408/228'), img(png(512, 512))), 'ok', 'retina tile');
  // the QA case: a 70-byte 1×1 PNG with cache-control max-age=600
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(png(1, 1, 37))), 'blocked');
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(png(256, 128))), 'blocked', 'banner');
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(png(64, 64))), 'blocked', 'small square');
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(gif(1, 1), { 'content-type': 'image/gif' })), 'blocked');
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(jpeg(1, 1), { 'content-type': 'image/jpeg' })), 'blocked');
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(jpeg(256, 256), { 'content-type': 'image/jpeg' })), 'ok');
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(webpX(1, 1), { 'content-type': 'image/webp' })), 'blocked');
  // a real tile sent with no-cache is still only handed through
  assert.equal(await sw.tileVerdict(osm('10/809/451'), img(png(256, 256), { 'cache-control': 'no-cache' })), 'nocache');
});

test('sw sweepTiles drops placeholder entries an older worker cached, keeps the real tiles', async () => {
  const store = new Map([
    ['https://tile.openstreetmap.org/9/1/1.png', png(256, 256, 40)],
    ['https://tile.openstreetmap.org/9/1/2.png', png(1, 1, 37)],
    ['https://tile.openstreetmap.org/9/1/3.png', png(256, 64)],
    ['https://tile.openstreetmap.org/9/1/4.png', Buffer.from([1, 2, 3])]
  ]);
  const cache = {
    keys: async () => [...store.keys()].map((u) => new Request(u)),
    match: async (req) => { const b = store.get(req.url); return b ? new Response(b) : undefined; },
    delete: async (req) => store.delete(req.url)
  };
  const caches = { has: async (n) => n === 'nc-tiles-v2', open: async () => cache };
  const sw = loadSw(caches);
  await sw.sweepTiles();
  assert.deepEqual([...store.keys()].map((u) => u.split('/').pop()).sort(), ['1.png', '4.png'], 'tiny + banner removed, unknown format kept');
});

/* ---------- geo.js fixTime ---------- */
function loadGeo() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/services/geo.js'), 'utf8');
  const util = { qs: () => ({}), round: (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d), haversineKm: () => 0, esc: String, h: () => ({}), fmtKm: String };
  const window = { NC: { util }, isSecureContext: true, localStorage: null, sessionStorage: null };
  const ctx = vm.createContext({ window, navigator: {}, console, setTimeout, clearTimeout, Promise, Date, Math, isFinite, Number });
  vm.runInContext(src, ctx, { filename: 'geo.js' });
  return window.NC.geo;
}

test('geo.fixTime keeps a sane fix time and replaces impossible ones by now', () => {
  const G = loadGeo();
  const now = 1790905175558;
  assert.equal(G.fixTime(now - 3000, now), now - 3000);
  assert.equal(G.fixTime(now - 23 * 3600000, now), now - 23 * 3600000, 'a day-old fix is still a fix time');
  assert.equal(G.fixTime(now + 4 * 60000, now), now + 4 * 60000, 'small clock skew tolerated');
  // Playwright WebKit: microseconds instead of milliseconds → year 58721
  assert.equal(G.fixTime(1790905175194000, now), now);
  assert.equal(G.fixTime(now + 6 * 60000, now), now, 'future beyond 5 min');
  assert.equal(G.fixTime(now - 25 * 3600000, now), now, 'older than 24 h');
  [undefined, null, NaN, '', 'abc', Infinity].forEach((v) => assert.equal(G.fixTime(v, now), now, String(v)));
  const t = G.fixTime(undefined);
  assert.ok(Math.abs(t - Date.now()) < 1000, 'defaults to the current time');
});

/* ---------- mod02-map.js i18n ---------- */
/* The NC.i18n.add({vi, en}) literal, cut out of the module source (string / comment aware) and evaluated alone. */
function mod02Dict() {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/app/mod02-map.js'), 'utf8');
  const start = src.indexOf('{', src.indexOf('NC.i18n.add('));
  let depth = 0, i = start, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) break;
  }
  return vm.runInNewContext('(' + src.slice(start, i + 1) + ')');
}

test('mod02 dictionaries: VI and EN have the same keys; a server pack copy never claims to work offline', () => {
  const d = mod02Dict();
  const vi = Object.keys(d.vi).sort(), en = Object.keys(d.en).sort();
  assert.deepEqual(vi.filter((k) => !d.en[k]), [], 'keys missing in EN');
  assert.deepEqual(en.filter((k) => !d.vi[k]), [], 'keys missing in VI');
  // R1.8: the head card under "Bản trên máy chủ · chưa lưu offline" must not say the route "dùng được hoàn toàn offline"
  assert.ok(d.vi['mp.pk.lead_server'] && d.en['mp.pk.lead_server']);
  assert.doesNotMatch(d.vi['mp.pk.lead_server'], /dùng được (hoàn toàn )?offline/);
  assert.doesNotMatch(d.en['mp.pk.lead_server'], /works? (fully )?offline/);
  assert.match(d.vi['mp.pk.src.server'], /chưa lưu offline/);
});
