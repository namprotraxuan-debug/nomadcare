#!/usr/bin/env node
/*
 * build-mockup.js — NomadCare v2 mockup kit (AISC 2026 · team Stormbreakers).
 * Chụp ảnh màn hình THẬT của app theo shots.json → mockup/screens/*.png, rồi render các board (boards.html) → mockup/export/*.png.
 * Usage: node build-mockup.js <shots|boards|all|placeholders|data|list> [--only id1,id2] [--device phone] [--board mobile,dark]
 *        [--scale 2] [--parallel 3] [--lang vi|en] [--force] [--keep] [--verbose] [--base http://localhost:8099]
 *        [--profile DIR]
 * Chrome profile: --profile DIR (default <os.tmpdir()>/nomadcare-mockup-profile) is kept between runs. Map tiles fetched from
 * third-party tile servers are stored in DIR/tile-cache and served from there on re-runs (at least 7 days, longer when the
 * server's Cache-Control allows), per the OSM tile usage policy (no bulk re-fetching). Shots get geolocation + notifications
 * granted with a fixed position (shots.json defaults.geo); a shot with "geo": false keeps the browser default (prompt).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MOCKUP = __dirname;
const ROOT = path.resolve(MOCKUP, '..');
const SCREENS = path.join(MOCKUP, 'screens');
const THUMBS = path.join(SCREENS, 'thumb');
const FAILED = path.join(SCREENS, '_failed');
const EXPORT = path.join(MOCKUP, 'export');
const MANIFEST = path.join(SCREENS, 'manifest.json');
const FALLBACK_NODE_PATHS = [MOCKUP, path.join(MOCKUP, 'node_modules')];
const DEFAULT_PROFILE = path.join(os.tmpdir(), 'nomadcare-mockup-profile');
const DEFAULT_GEO = { latitude: 22.99, longitude: 104.98, accuracy: 20 };
const TILE_MIN_TTL_MS = 7 * 24 * 3600 * 1000;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.map': 'application/json'
};

/* ------------------------------------------------------------------ CLI */
const argv = process.argv.slice(2);
const CMD = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'help';
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
const OPTS = {
  only: listOpt(opt('only', '')), device: opt('device', ''), board: listOpt(opt('board', '')),
  scale: +opt('scale', 0) || 0, parallel: +opt('parallel', 0) || 0, lang: opt('lang', 'vi'),
  force: !!opt('force', false), keep: !!opt('keep', false), verbose: !!opt('verbose', false),
  base: opt('base', '') || '',
  profile: path.resolve(typeof opt('profile', '') === 'string' && opt('profile', '') ? opt('profile', '') : DEFAULT_PROFILE)
};
function listOpt(v) { return (typeof v === 'string' && v) ? v.split(',').map(s => s.trim()).filter(Boolean) : []; }

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('\x1b[33m⚠\x1b[0m', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ deps */
function loadPuppeteer() {
  for (const p of FALLBACK_NODE_PATHS) {
    try { return require(require.resolve('puppeteer-core', { paths: [p] })); } catch (e) { /* try next */ }
  }
  console.error('Không tìm thấy puppeteer-core. Chạy: cd mockup && npm i puppeteer-core');
  process.exit(1);
}
function chromePath() {
  const p = CHROME_CANDIDATES.find(c => { try { return fs.existsSync(c); } catch (e) { return false; } });
  if (!p) { console.error('Không tìm thấy Chrome. Đặt biến môi trường CHROME_PATH=/đường/dẫn/chrome'); process.exit(1); }
  return p;
}

/* ------------------------------------------------------------------ config */
function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(path.join(MOCKUP, 'shots.json'), 'utf8'));
  const macros = raw.macros || {};
  const expand = (actions, depth) => {
    const out = [];
    (actions || []).forEach(a => {
      if (a && a.macro) {
        if (!macros[a.macro]) throw new Error('shots.json: macro không tồn tại: ' + a.macro);
        if ((depth || 0) > 5) throw new Error('shots.json: macro lồng quá sâu: ' + a.macro);
        expand(macros[a.macro], (depth || 0) + 1).forEach(m => out.push(a.optional ? Object.assign({}, m, { optional: true }) : m));
      } else out.push(a);
    });
    return out;
  };
  const byId = new Map();
  raw.shots.forEach(s => {
    if (!s.id) throw new Error('shots.json: shot thiếu id');
    if (byId.has(s.id)) throw new Error('shots.json: trùng id ' + s.id);
    byId.set(s.id, s);
  });
  const memo = new Map();
  const resolve = (id, stack) => {
    if (memo.has(id)) return memo.get(id);
    const s = byId.get(id);
    if (!s) throw new Error('shots.json: extends tới shot không tồn tại: ' + id);
    if (stack.indexOf(id) >= 0) throw new Error('shots.json: extends vòng lặp ' + stack.concat(id).join(' → '));
    let r;
    if (s.extends) {
      const p = resolve(s.extends, stack.concat(id));
      const inherited = p.actions.map(a => a.tap ? tapToClick(a) : a);
      r = Object.assign({}, p, s, { actions: inherited.concat(expand(s.actions)) });
    } else {
      r = Object.assign({}, s, { actions: expand(s.actions) });
    }
    if (!raw.devices[r.device]) throw new Error('shots.json: device không hợp lệ ở ' + id + ': ' + r.device);
    if (!r.url) throw new Error('shots.json: shot ' + id + ' thiếu url');
    memo.set(id, r);
    return r;
  };
  const shots = raw.shots.map(s => resolve(s.id, []));
  Object.keys(raw.boards || {}).forEach(b => (raw.boards[b].shots || []).forEach(id => {
    if (!byId.has(id)) warn('board "' + b + '" tham chiếu shot không tồn tại: ' + id);
  }));
  return Object.assign({}, raw, { shots, byId: new Map(shots.map(s => [s.id, s])) });
}
function tapToClick(a) {
  const q = typeof a.tap === 'string' ? { text: a.tap } : (a.tap || {});
  return { clickText: q.text || '', sel: q.sel, within: q.within, selector: q.selector, index: q.index, exact: q.exact, optional: a.optional };
}
function shotUrl(shot) {
  const u = new URL(shot.url, 'http://mockup.local');
  const q = u.searchParams;
  if (shot.theme && !q.has('theme')) q.set('theme', shot.theme);
  if (shot.lang && !q.has('lang')) q.set('lang', shot.lang);
  if (shot.offline && !q.has('offline')) q.set('offline', '1');
  const qs = q.toString();
  return u.pathname + (qs ? '?' + qs : '') + u.hash;
}
function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return {}; }
}
function writeManifest(m) {
  fs.mkdirSync(SCREENS, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
}

/* data.js = snapshot of shots.json + manifest, loaded by boards.html / index.html (works on file:// too) */
function writeData(cfg) {
  const manifest = readManifest();
  const shots = cfg.shots.map(s => {
    const file = path.join(SCREENS, s.id + '.png');
    const thumb = path.join(THUMBS, s.id + '.webp');
    const m = manifest[s.id] || {};
    return {
      id: s.id, device: s.device, url: shotUrl(s), theme: s.theme || 'light', lang: s.lang || 'vi', offline: !!s.offline,
      module: s.module || '', caption: s.caption || {}, actions: s.actions || [], live: s.live || null,
      exists: fs.existsSync(file), thumb: fs.existsSync(thumb), placeholder: !!m.placeholder,
      v: m.captured_at ? Date.parse(m.captured_at) || 0 : 0,
      tone: m.tone || null, taps: m.taps || [], safeApplied: !!m.safe_area_applied,
      lastRun: m.lastRun ? { ok: m.lastRun.ok, at: m.lastRun.at, error: (m.lastRun.errors || [])[0] || null } : null
    };
  });
  const data = {
    generated_at: new Date().toISOString(), browserHost: cfg.browserHost || 'nomadcare.demo',
    devices: cfg.devices, modules: cfg.modules || {}, boards: cfg.boards || {}, shots
  };
  fs.writeFileSync(path.join(MOCKUP, 'data.js'),
    '/* Sinh tự động bởi build-mockup.js — KHÔNG sửa tay; hãy sửa shots.json rồi chạy `node build-mockup.js data`. */\n' +
    'window.NC_MOCKUP = ' + JSON.stringify(data, null, 1) + ';\n');
  return data;
}

/* ------------------------------------------------------------------ static server (rooted at project root) */
function serve() {
  return new Promise((res, rej) => {
    const srv = http.createServer((req, resp) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0].split('#')[0]); } catch (e) { resp.writeHead(400); resp.end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const f = path.normalize(path.join(ROOT, p));
      if (!f.startsWith(ROOT)) { resp.writeHead(403); resp.end('403'); return; }
      fs.stat(f, (err, st) => {
        if (err || !st.isFile()) { resp.writeHead(404, { 'Content-Type': 'text/plain' }); resp.end('404 ' + p); return; }
        resp.writeHead(200, {
          'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size, 'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') { resp.end(); return; }
        fs.createReadStream(f).pipe(resp);
      });
    });
    srv.on('error', rej);
    srv.listen(+opt('port', 0) || 0, '127.0.0.1', () => res(srv));
  });
}
async function withServer(fn) {
  if (OPTS.base) return fn(OPTS.base.replace(/\/$/, ''));
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  try { return await fn(base); } finally { srv.close(); }
}
/* Chrome profile kept between runs (--profile). If it is locked by another run, fall back to a throw-away profile. */
async function withBrowser(fn) {
  const puppeteer = loadPuppeteer();
  const launch = userDataDir => puppeteer.launch({
    executablePath: chromePath(), headless: true, userDataDir,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio',
      '--force-color-profile=srgb', '--font-render-hinting=none', '--lang=vi-VN', '--disable-features=Translate,MediaRouter']
  });
  let tempDir = null, browser;
  try {
    fs.mkdirSync(OPTS.profile, { recursive: true });
    browser = await launch(OPTS.profile);
  } catch (e) {
    warn('Không mở được Chrome với profile ' + OPTS.profile + ' (' + String(e.message || e).split('\n')[0] + '), dùng profile tạm.');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-mockup-'));
    browser = await launch(tempDir);
  }
  try { return await fn(browser); } finally {
    await browser.close().catch(() => {});
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  }
}

/* ------------------------------------------------------------------ tile cache (third-party map tiles, kept in the profile) */
/* Every shot runs in its own (incognito) browser context, whose HTTP cache is in memory only, so the profile's disk cache
 * alone would not stop re-fetching tiles. Tile requests to other origins are answered from DIR/tile-cache when fresh;
 * new tiles are stored with the server's max-age (minimum 7 days, as the OSM tile usage policy allows). */
const TILE_RE = /\/\d{1,2}\/\d+\/\d+(@2x)?\.(png|jpe?g|webp|pbf)(\?|$)/i;
const crypto = require('crypto');
const tileStats = { hit: 0, stored: 0 };
function tileDir() { return path.join(OPTS.profile, 'tile-cache'); }
function isTileUrl(u, appOrigin) {
  if (!/^https?:/i.test(u) || u.indexOf(appOrigin + '/') === 0) return false;
  return TILE_RE.test(u);
}
function tileFile(u) { return path.join(tileDir(), crypto.createHash('sha1').update(u).digest('hex')); }
function tileGet(u) {
  const f = tileFile(u);
  try {
    const meta = JSON.parse(fs.readFileSync(f + '.json', 'utf8'));
    if (Date.now() > meta.expires) return null;
    return { body: fs.readFileSync(f + '.bin'), type: meta.type || 'image/png' };
  } catch (e) { return null; }
}
function tilePut(u, body, headers) {
  if (!body || body.length < 200) return; // blocked / error tiles are tiny: never keep them
  if (headers['x-blocked']) return;
  const cc = String(headers['cache-control'] || '');
  if (/no-store/i.test(cc)) return;
  const m = /max-age=(\d+)/i.exec(cc);
  const ttl = Math.max(TILE_MIN_TTL_MS, m ? (+m[1]) * 1000 : 0);
  const f = tileFile(u);
  try {
    fs.mkdirSync(tileDir(), { recursive: true });
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, f + '.bin');
    fs.writeFileSync(f + '.json', JSON.stringify({ url: u, type: headers['content-type'] || 'image/png', fetched: Date.now(), expires: Date.now() + ttl }));
    tileStats.stored++;
  } catch (e) { /* cache is best effort */ }
}
async function useTileCache(page, appOrigin, st) {
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.isInterceptResolutionHandled && req.isInterceptResolutionHandled()) return;
    const u = req.url();
    if (!st.offline && req.method() === 'GET' && isTileUrl(u, appOrigin)) {
      const hit = tileGet(u);
      if (hit) {
        tileStats.hit++;
        req.respond({ status: 200, contentType: hit.type, body: hit.body,
          headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=604800', 'X-Mockup-Cache': 'hit' } }).catch(() => {});
        return;
      }
    }
    req.continue().catch(() => {});
  });
  page.on('response', res => {
    const u = res.url();
    if (res.status() !== 200 || !isTileUrl(u, appOrigin) || (res.headers() || {})['x-mockup-cache']) return;
    res.buffer().then(b => tilePut(u, b, res.headers() || {})).catch(() => {});
  });
}

/* ------------------------------------------------------------------ in-page helper (window.__mk) */
function mkHelper() {
  if (window.__mk) return;
  const INTERACTIVE = 'button,a[href],[role=button],[role=tab],[role=radio],[role=option],[role=menuitem],[role=switch],' +
    '[role=checkbox],[role=link],label,summary,select,[tabindex]:not([tabindex="-1"]),[data-action],[data-go],[data-nav],' +
    '.chip,.card--interactive,.list-item,.segmented__btn';
  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const splitSel = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (el.closest('[hidden],[inert]')) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    return true;
  }
  function roots(within) {
    if (!within) return [document.body || document.documentElement];
    const out = [];
    splitSel(within).forEach(sel => {
      try { document.querySelectorAll(sel).forEach(e => { if (visible(e) && out.indexOf(e) < 0) out.push(e); }); } catch (e) { /* bad selector */ }
    });
    return out;
  }
  const labelOf = el => norm([el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt')].filter(Boolean).join(' '));
  function find(q) {
    if (typeof q === 'string') q = { text: q };
    q = q || {};
    const rs = roots(q.within);
    for (const root of rs) {
      if (q.sel) {
        for (const sel of splitSel(q.sel)) {
          let els = [];
          try { els = Array.prototype.slice.call(root.querySelectorAll(sel)).filter(visible); } catch (e) { /* bad selector */ }
          if (els.length) return els[Math.min(q.index || 0, els.length - 1)];
        }
      }
      if (!q.text) continue;
      const alts = String(q.text).split('|').map(norm).filter(Boolean);
      for (const t of alts) {
        const cands = [];
        const pool = root.querySelectorAll(q.selector || '*');
        for (const el of pool) {
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'svg' || el.tagName === 'use') continue;
          const tc = norm(el.textContent), lab = labelOf(el);
          const hit = q.exact ? (tc === t || lab === t) : (tc.indexOf(t) >= 0 || lab.indexOf(t) >= 0);
          if (!hit) continue;
          let target = el;
          if (!q.selector) {
            // deepest element containing the text, then its closest interactive ancestor
            const kids = Array.prototype.slice.call(el.children);
            if (kids.some(k => (q.exact ? norm(k.textContent) === t : norm(k.textContent).indexOf(t) >= 0))) continue;
            const ia = el.closest(INTERACTIVE);
            if (ia && root.contains(ia)) target = ia;
          }
          if (!visible(target) || cands.indexOf(target) >= 0) continue;
          const tt = norm(target.textContent) || lab;
          cands.push(target);
          target.__mkScore = (tt === t ? 0 : (tt.indexOf(t) === 0 ? 1 : 2)) * 100000 + tt.length;
        }
        if (cands.length) {
          cands.sort((a, b) => a.__mkScore - b.__mkScore);
          return cands[Math.min(q.index || 0, cands.length - 1)];
        }
      }
    }
    return null;
  }
  function describe(el) {
    const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + ' "' + norm(el.textContent).slice(0, 48) + '"';
  }
  function locate(q) {
    const el = find(q);
    if (!el) return null;
    if (!q.noScroll) el.scrollIntoView({ block: q.block || 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hitEl = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, w: r.width, h: r.height, hit: !!hitEl && (hitEl === el || el.contains(hitEl)), desc: describe(el) };
  }
  function click(q) {
    const el = find(q);
    if (!el) throw new Error('không tìm thấy phần tử: ' + JSON.stringify(q));
    el.scrollIntoView({ block: 'nearest' });
    el.click();
    return describe(el);
  }
  async function waitFor(what, timeout) {
    const t0 = Date.now(), lim = timeout || 8000;
    while (Date.now() - t0 < lim) {
      let v = null;
      try {
        if (typeof what === 'function') v = await what();
        else if (typeof what === 'string') { const e = document.querySelector(what); v = e && visible(e) ? e : null; }
        else v = find(what);
      } catch (e) { v = null; }
      if (v) return v;
      await sleep(120);
    }
    throw new Error('hết thời gian chờ: ' + (typeof what === 'function' ? 'fn' : JSON.stringify(what)).slice(0, 100));
  }
  function go(name, params) {
    const NC = window.NC;
    if (NC && NC.app && typeof NC.app.go === 'function') { NC.app.go(name, params || undefined); return 'NC.app.go(' + name + ')'; }
    let h = '#/' + name;
    if (params) { const qs = new URLSearchParams(params).toString(); if (qs) h += '?' + qs; }
    location.hash = h;
    return h;
  }
  async function ready(timeout) {
    const lim = timeout || 8000, t0 = Date.now();
    await waitFor(() => document.readyState === 'complete', lim).catch(() => {});
    await waitFor(() => window.NC && (window.NC.app || window.NC.admin), Math.max(600, lim - (Date.now() - t0))).catch(() => {});
    try { if (window.NC && window.NC.data && typeof window.NC.data.init === 'function') await Promise.race([window.NC.data.init(), sleep(4000)]); } catch (e) { /* ignore */ }
    try { await Promise.race([document.fonts.ready, sleep(3000)]); } catch (e) { /* ignore */ }
    return !!(window.NC && (window.NC.app || window.NC.admin));
  }
  async function settle(timeout) {
    const lim = timeout || 8000, t0 = Date.now();
    try { await Promise.race([document.fonts.ready, sleep(3000)]); } catch (e) { /* ignore */ }
    await waitFor(() => Array.prototype.every.call(document.images, i => i.complete), Math.min(4000, lim)).catch(() => {});
    if (document.querySelector('.leaflet-container')) {
      await waitFor(() => {
        const tiles = document.querySelectorAll('.leaflet-tile');
        if (!tiles.length) return Date.now() - t0 > 1500;
        return Array.prototype.every.call(tiles, t => t.complete);
      }, lim).catch(() => {});
      await sleep(350);
    }
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.matches && ae.matches('#view, main, section, [tabindex="-1"]')) ae.blur();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  }
  function scrollTo(q) {
    const el = find(q);
    if (!el) throw new Error('không tìm thấy để cuộn tới: ' + JSON.stringify(q));
    const tb = document.querySelector('#topbar');
    const off = tb && visible(tb) ? tb.getBoundingClientRect().bottom + 12 : 12;
    el.style.scrollMarginTop = off + 'px';
    el.scrollIntoView({ block: q.block || 'start' });
    return describe(el);
  }
  function scroll(s) {
    const el = s && s.selector ? document.querySelector(s.selector) : (document.scrollingElement || document.documentElement);
    if (!el) throw new Error('không có phần tử cuộn ' + (s && s.selector));
    el.scrollTop = +(s && s.y) || 0;
    return el.scrollTop;
  }
  window.__mk = { find, click, locate, go, ready, settle, waitFor, sleep, visible, norm, scrollTo, scroll, describe };
  const css = 'html::-webkit-scrollbar,*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}' +
    '*{scrollbar-width:none!important}input,textarea,[contenteditable]{caret-color:transparent!important}';
  const inject = () => { if (document.getElementById('__mk-style')) return; const st = document.createElement('style'); st.id = '__mk-style'; st.textContent = css; (document.head || document.documentElement).appendChild(st); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
}

/* ------------------------------------------------------------------ shots */
/* o (shots only): { base, geo (false = do not grant), st } → grants geolocation + notifications for the app origin, fixed
 * position, and the tile cache. */
async function preparePage(browser, cfg, dev, theme, o) {
  const ctx = await browser.createBrowserContext();
  o = o || {};
  if (o.base) {
    const origin = new URL(o.base).origin;
    const d0 = cfg.defaults || {};
    if (o.geo !== false) {
      await ctx.overridePermissions(origin, ['geolocation', 'notifications']).catch(e => warn('overridePermissions: ' + e.message));
    }
    o.origin = origin;
    o.position = Object.assign({}, DEFAULT_GEO, d0.geo || {}, (o.geo && typeof o.geo === 'object') ? o.geo : {});
  }
  const page = await ctx.newPage();
  if (o.base) {
    if (o.geo !== false) await page.setGeolocation(o.position).catch(e => warn('setGeolocation: ' + e.message));
    await useTileCache(page, o.origin, o.st || {});
  }
  page.setDefaultTimeout(15000);
  if (dev.ua) await page.setUserAgent(dev.ua);
  await page.setViewport({ width: dev.width, height: dev.height, deviceScaleFactor: dev.scale || 1, isMobile: !!dev.mobile, hasTouch: !!dev.touch });
  const d = cfg.defaults || {};
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: theme === 'dark' ? 'dark' : 'light' },
    { name: 'prefers-reduced-motion', value: d.reducedMotion === false ? 'no-preference' : 'reduce' }
  ]);
  if (d.timezone) await page.emulateTimezone(d.timezone).catch(() => {});
  const cdp = await page.createCDPSession();
  let safeApplied = false;
  if (dev.safeArea) {
    try {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: dev.safeArea.top || 0, bottom: dev.safeArea.bottom || 0, left: 0, right: 0 } });
      safeApplied = true;
    } catch (e) { /* older Chrome: frame falls back to a separate status strip */ }
  }
  // page.setBypassServiceWorker uses puppeteer's own session: sent on a separate CDP session, the bypass did not apply and
  // the app's service worker fetched (and hid) every tile request
  await page.setBypassServiceWorker(true).catch(() => {});
  await page.evaluateOnNewDocument(mkHelper);
  page.on('dialog', dlg => dlg.dismiss().catch(() => {}));
  return { ctx, page, safeApplied };
}
async function nav(page, url, cfg) {
  const t = (cfg.defaults && cfg.defaults.navTimeout) || 30000;
  const resp = await page.goto(url, { waitUntil: 'load', timeout: t });
  if (resp && resp.status() >= 400) throw new Error('HTTP ' + resp.status() + ' ' + url.replace(/^https?:\/\/[^/]+/, ''));
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 7000 }).catch(() => {});
}
async function pageEval(page, fn, ...args) {
  // retry when the app reloads itself (e.g. ?reset=1) and the execution context is destroyed
  for (let i = 0; i < 4; i++) {
    try { return await page.evaluate(fn, ...args); } catch (e) {
      if (!/context was destroyed|Cannot find context|navigat/i.test(e.message) || i === 3) throw e;
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
    }
  }
  return null;
}
function query(a, key) {
  const v = a[key];
  const q = (v && typeof v === 'object') ? Object.assign({}, v) : { text: v };
  ['sel', 'within', 'selector', 'index', 'exact', 'block'].forEach(k => { if (a[k] !== undefined && q[k] === undefined) q[k] = a[k]; });
  return q;
}
async function clickQuery(page, q) {
  const r = await pageEval(page, qq => window.__mk.locate(qq), q);
  if (!r) throw new Error('không tìm thấy ' + JSON.stringify(q));
  if (r.hit) { await page.mouse.click(r.x, r.y); page.__mkMouseUsed = true; }
  else await pageEval(page, qq => window.__mk.click(qq), Object.assign({}, q));
  return r.desc;
}
async function runAction(page, base, a, st, cfg, dev) {
  const label = JSON.stringify(a).slice(0, 140);
  try {
    if (a.goto) { await nav(page, base + a.goto, cfg); await pageEval(page, ms => window.__mk.ready(ms), 8000); await sleep(a.after || 500); }
    else if (a.hash) { await pageEval(page, h => { location.hash = h; }, a.hash); await sleep(a.after || 700); }
    else if (a.go) { await pageEval(page, (n, p) => window.__mk.go(n, p), a.go, a.params || null); await sleep(a.after || 800); }
    else if (a.click) { await clickQuery(page, { sel: a.click, within: a.within }); await sleep(a.after || 450); }
    else if (a.clickText !== undefined) { st.log.push('click → ' + await clickQuery(page, query(a, 'clickText'))); await sleep(a.after || 450); }
    else if (a.tap) {
      const q = query(a, 'tap');
      const r = await pageEval(page, qq => window.__mk.locate(qq), q);
      if (!r) throw new Error('không tìm thấy điểm chạm ' + JSON.stringify(q));
      st.taps.push(Object.assign({}, q, { noScroll: true }));
      st.log.push('tap → ' + r.desc);
    }
    else if (a.type) { await page.type(a.type[0], a.type[1], { delay: 12 }); }
    else if (a.press) { await page.keyboard.press(a.press); await sleep(a.after || 300); }
    else if (a.waitFor) { await page.waitForSelector(a.waitFor, { visible: true, timeout: a.timeout || 8000 }); }
    else if (a.waitText) { await pageEval(page, (q, ms) => window.__mk.waitFor(q, ms), query(a, 'waitText'), a.timeout || 8000); }
    else if (a.wait) { await sleep(a.wait); }
    else if (a.eval) {
      const v = await pageEval(page, new Function('return (async () => { return (' + a.eval + '); })()'));
      st.log.push('eval → ' + JSON.stringify(v === undefined ? null : v).slice(0, 80));
    }
    else if (a.scrollTo) { await pageEval(page, q => window.__mk.scrollTo(q), query(a, 'scrollTo')); await sleep(a.after || 450); }
    else if (a.scroll) { await pageEval(page, s => window.__mk.scroll(s), a.scroll); await sleep(a.after || 300); }
    else if (a.css) { await page.addStyleTag({ content: a.css }); }
    else if (a.offline !== undefined) { st.offline = !!a.offline; await page.setOfflineMode(!!a.offline); }
    else if (a.viewport) { await page.setViewport(Object.assign({ deviceScaleFactor: dev.scale || 1, isMobile: !!dev.mobile, hasTouch: !!dev.touch }, a.viewport)); await sleep(400); }
    else if (a.idle) { await page.waitForNetworkIdle({ idleTime: 500, timeout: +a.idle || 6000 }).catch(() => {}); }
    else if (a.tiles) { await pageEval(page, ms => window.__mk.settle(ms), (cfg.defaults && cfg.defaults.settleTimeout) || 8000); }
    else throw new Error('action không hỗ trợ');
  } catch (e) {
    const msg = label + ' — ' + String(e && e.message || e).split('\n')[0];
    if (a.optional) { st.warnings.push('(optional) ' + msg); return; }
    throw new Error(msg);
  }
}
async function captureShot(browser, util, base, cfg, shot) {
  const dev = cfg.devices[shot.device];
  const t0 = Date.now();
  const st = { taps: [], log: [], warnings: [], errors: [], consoleErrors: [], offline: false };
  const { ctx, page, safeApplied } = await preparePage(browser, cfg, dev, shot.theme, { base, geo: shot.geo, st });
  page.on('console', m => { if (m.type() === 'error' && st.consoleErrors.length < 12) st.consoleErrors.push(m.text().slice(0, 240)); });
  page.on('pageerror', e => { if (st.consoleErrors.length < 12) st.consoleErrors.push('pageerror: ' + String(e && e.message || e).slice(0, 240)); });
  let ok = false, buf = null;
  try {
    await nav(page, base + shotUrl(shot), cfg);
    const hasApp = await pageEval(page, ms => window.__mk.ready(ms), 8000);
    if (!hasApp) st.warnings.push('window.NC.app / NC.admin không xuất hiện (app chưa sẵn sàng?)');
    await sleep(shot.wait || (cfg.defaults && cfg.defaults.wait) || 1200);
    for (const a of shot.actions || []) await runAction(page, base, a, st, cfg, dev);
    await pageEval(page, ms => window.__mk.settle(ms), (cfg.defaults && cfg.defaults.settleTimeout) || 8000);
    const taps = [];
    for (const q of st.taps) {
      const r = await pageEval(page, qq => window.__mk.locate(qq), q).catch(() => null);
      if (r) taps.push({ x: +(r.x / dev.width).toFixed(4), y: +(r.y / dev.height).toFixed(4), w: +(r.w / dev.width).toFixed(4), h: +(r.h / dev.height).toFixed(4) });
    }
    st.tapsOut = taps;
    if (page.__mkMouseUsed) {
      // park the mouse in the top-right corner (status-bar / topbar padding) so the last clicked spot keeps no :hover look
      await page.mouse.move(dev.width - 2, 2).catch(() => {});
      await sleep(150);
    }
    buf = await page.screenshot({ type: 'png', captureBeyondViewport: false });
    ok = true;
  } catch (e) {
    st.errors.push(String(e && e.message || e).split('\n')[0]);
    try { buf = await page.screenshot({ type: 'png', captureBeyondViewport: false }); } catch (e2) { buf = null; }
  } finally {
    await ctx.close().catch(() => {});
  }
  const res = { id: shot.id, ok, ms: Date.now() - t0, st, safeApplied };
  if (buf) {
    if (ok || OPTS.keep) {
      fs.writeFileSync(path.join(SCREENS, shot.id + '.png'), buf);
      const meta = await analyzePng(util, buf, dev, safeApplied).catch(e => { warn(shot.id + " analyze: " + e.message.split("\n")[0]); return null; });
      res.tone = meta && meta.tone;
      if (meta && meta.thumb) fs.writeFileSync(path.join(THUMBS, shot.id + '.webp'), Buffer.from(meta.thumb, 'base64'));
    } else {
      fs.writeFileSync(path.join(FAILED, shot.id + '.png'), buf);
    }
  }
  return res;
}
/* tone of the status-bar / home-indicator zones (for icon colour) + a small webp thumbnail for the showcase page */
async function analyzePng(util, buf, dev, safeApplied) {
  const top = safeApplied && dev.safeArea ? dev.safeArea.top : 24;
  const bottom = safeApplied && dev.safeArea ? dev.safeArea.bottom : 18;
  const thumbW = Math.min(dev.width * 2, 1600);
  return util.evaluate(async (b64, dw, dh, top, bottom, thumbW) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const k = img.width / dw;
    const lum = (y0, h) => {
      const d = x.getImageData(0, Math.round(y0 * k), img.width, Math.max(1, Math.round(h * k))).data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 7) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
      return n ? s / n : 255;
    };
    const lt = lum(0, top), lb = lum(dh - bottom, bottom);
    const t = document.createElement('canvas');
    t.width = thumbW; t.height = Math.round(img.height * thumbW / img.width);
    const tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(img, 0, 0, t.width, t.height);
    const thumb = t.toDataURL('image/webp', 0.9).split(',')[1];
    return { tone: { top: lt < 150 ? 'light' : 'dark', bottom: lb < 150 ? 'light' : 'dark', topLum: Math.round(lt), bottomLum: Math.round(lb) }, thumb };
  }, Buffer.from(buf).toString('base64'), dev.width, dev.height, top, bottom, thumbW);
}
function selectShots(cfg) {
  return cfg.shots.filter(s => (!OPTS.only.length || OPTS.only.indexOf(s.id) >= 0) && (!OPTS.device || s.device === OPTS.device));
}
async function runShots(cfg) {
  if (!OPTS.base && !fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error('Chưa có ' + path.join(ROOT, 'index.html') + ' — app chưa sẵn sàng để chụp. (Dùng `placeholders` để tạo ảnh tạm.)');
    process.exitCode = 1;
    return [];
  }
  [SCREENS, THUMBS, FAILED].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const list = selectShots(cfg);
  if (!list.length) { warn('Không có shot nào khớp bộ lọc.'); return []; }
  const parallel = OPTS.parallel || (cfg.defaults && cfg.defaults.parallel) || 3;
  log('▶ Chụp ' + list.length + ' trạng thái (song song ' + parallel + ')…');
  const results = [];
  await withServer(base => withBrowser(async browser => {
    const util = await browser.newPage();
    await util.goto('about:blank');
    const queue = list.slice();
    const worker = async () => {
      while (queue.length) {
        const shot = queue.shift();
        let r;
        try { r = await captureShot(browser, util, base, cfg, shot); } catch (e) {
          r = { id: shot.id, ok: false, ms: 0, st: { errors: [String(e.message || e)], warnings: [], consoleErrors: [], log: [] } };
        }
        results.push(r);
        const mark = r.ok ? (r.st.warnings.length ? '\x1b[33m~\x1b[0m' : '\x1b[32m✓\x1b[0m') : '\x1b[31m✗\x1b[0m';
        log('  ' + mark + ' ' + shot.id.padEnd(22) + String(r.ms).padStart(6) + ' ms' + (r.ok ? '' : '  ' + r.st.errors[0]));
        r.st.warnings.forEach(w => log('      ⚠ ' + w));
        if (OPTS.verbose) r.st.consoleErrors.forEach(c => log('      console: ' + c));
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, list.length) }, worker));
  }));
  const manifest = readManifest();
  const now = new Date().toISOString();
  results.forEach(r => {
    const prev = manifest[r.id] || {};
    const lastRun = { ok: r.ok, at: now, ms: r.ms, errors: r.st.errors, warnings: r.st.warnings, consoleErrors: r.st.consoleErrors, log: r.st.log };
    if (r.ok || OPTS.keep) {
      const dev = cfg.devices[cfg.byId.get(r.id).device];
      manifest[r.id] = {
        placeholder: false, captured_at: now, width: dev.width, height: dev.height, scale: dev.scale,
        safe_area_applied: !!r.safeApplied, tone: r.tone || null, taps: r.st.tapsOut || [], lastRun
      };
    } else {
      manifest[r.id] = Object.assign({}, prev, { lastRun });
    }
  });
  writeManifest(manifest);
  writeData(cfg);
  const failed = results.filter(r => !r.ok);
  log('■ Xong: ' + (results.length - failed.length) + '/' + results.length + ' thành công' + (failed.length ? ', lỗi: ' + failed.map(r => r.id).join(', ') + ' (ảnh lỗi ở screens/_failed/)' : '') + '.');
  log('  tile cache: ' + tileStats.hit + ' lấy từ cache, ' + tileStats.stored + ' tile mới lưu (' + tileDir() + ')');
  return results;
}

/* ------------------------------------------------------------------ placeholders (development only) */
async function runPlaceholders(cfg) {
  [SCREENS, THUMBS].forEach(d => fs.mkdirSync(d, { recursive: true }));
  writeData(cfg);
  const list = selectShots(cfg).filter(s => OPTS.force || !fs.existsSync(path.join(SCREENS, s.id + '.png')));
  if (!list.length) { log('Tất cả shot đã có ảnh (dùng --force để tạo lại placeholder).'); return; }
  log('▶ Tạo ' + list.length + ' ảnh placeholder…');
  const manifest = readManifest();
  await withServer(base => withBrowser(async browser => {
    const util = await browser.newPage();
    await util.goto('about:blank');
    for (const shot of list) {
      const dev = cfg.devices[shot.device];
      const { ctx, page, safeApplied } = await preparePage(browser, cfg, dev, shot.theme);
      try {
        await page.goto(base + '/mockup/placeholder.html?id=' + encodeURIComponent(shot.id), { waitUntil: 'load' });
        await page.waitForFunction('window.__phReady === true', { timeout: 10000 });
        const taps = await page.evaluate((w, h) => Array.prototype.map.call(document.querySelectorAll('[data-mk-tap]'), e => {
          const r = e.getBoundingClientRect();
          return { x: +((r.left + r.width / 2) / w).toFixed(4), y: +((r.top + r.height / 2) / h).toFixed(4), w: +(r.width / w).toFixed(4), h: +(r.height / h).toFixed(4) };
        }), dev.width, dev.height);
        const buf = await page.screenshot({ type: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(SCREENS, shot.id + '.png'), buf);
        const meta = await analyzePng(util, buf, dev, safeApplied).catch(e => { warn(shot.id + " analyze: " + e.message.split("\n")[0]); return null; });
        if (meta && meta.thumb) fs.writeFileSync(path.join(THUMBS, shot.id + '.webp'), Buffer.from(meta.thumb, 'base64'));
        manifest[shot.id] = { placeholder: true, captured_at: new Date().toISOString(), width: dev.width, height: dev.height, scale: dev.scale, safe_area_applied: safeApplied, tone: meta && meta.tone, taps: taps };
        log('  ◌ ' + shot.id);
      } catch (e) { warn(shot.id + ': ' + e.message); } finally { await ctx.close().catch(() => {}); }
    }
  }));
  writeManifest(manifest);
  writeData(cfg);
}

/* ------------------------------------------------------------------ boards */
async function runBoards(cfg) {
  fs.mkdirSync(EXPORT, { recursive: true });
  writeData(cfg);
  const names = Object.keys(cfg.boards || {}).filter(n => !OPTS.board.length || OPTS.board.indexOf(n) >= 0);
  if (!names.length) { warn('Không có board nào khớp.'); return; }
  log('▶ Render ' + names.length + ' board…');
  await withServer(base => withBrowser(async browser => {
    const page = await browser.newPage();
    page.on('pageerror', e => warn('boards.html: ' + e.message));
    for (const name of names) {
      const b = cfg.boards[name];
      const scale = OPTS.scale || b.scale || 1;
      const t0 = Date.now();
      await page.setViewport({ width: b.width, height: b.height, deviceScaleFactor: scale });
      await page.goto(base + '/mockup/boards.html?board=' + encodeURIComponent(name) + '&lang=' + OPTS.lang + '&t=' + Date.now() + '#' + name, { waitUntil: 'load' });
      try { await page.waitForFunction('window.__boardReady === true', { timeout: 90000 }); } catch (e) { warn(name + ': board chưa báo sẵn sàng, vẫn chụp.'); }
      const info = await page.evaluate(() => window.__boardInfo || {}).catch(() => ({}));
      const file = path.join(EXPORT, b.file || ('board-' + name + '.png'));
      await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: b.width, height: b.height }, captureBeyondViewport: false });
      // small webp preview for the showcase download cards
      try {
        fs.mkdirSync(path.join(EXPORT, 'thumb'), { recursive: true });
        await page.setViewport({ width: b.width, height: b.height, deviceScaleFactor: 0.3 });
        await sleep(400);
        await page.screenshot({ path: path.join(EXPORT, 'thumb', (b.file || ('board-' + name + '.png')).replace(/\.png$/, '.webp')), type: 'webp', quality: 82, clip: { x: 0, y: 0, width: b.width, height: b.height }, captureBeyondViewport: false });
      } catch (e) { warn(name + ': thumbnail — ' + e.message); }
      const miss = (info.missing || []).length ? '  (thiếu ảnh: ' + info.missing.join(', ') + ')' : '';
      const ph = (info.placeholders || []).length ? '  (placeholder: ' + info.placeholders.length + ')' : '';
      (info.errors || []).forEach(e => warn(name + ': lỗi layout — ' + e));
      log('  ✓ ' + path.relative(MOCKUP, file).padEnd(28) + (b.width * scale) + '×' + (b.height * scale) + ' px  ' + (Date.now() - t0) + ' ms' + miss + ph);
    }
  }));
}

/* ------------------------------------------------------------------ list / help */
function runList(cfg) {
  const m = readManifest();
  log('Shots (' + cfg.shots.length + '):');
  cfg.shots.forEach(s => {
    const has = fs.existsSync(path.join(SCREENS, s.id + '.png'));
    const e = m[s.id] || {};
    const status = !has ? 'thiếu' : (e.placeholder ? 'placeholder' : 'ảnh thật ' + (e.captured_at || '').slice(0, 16));
    const last = e.lastRun && !e.lastRun.ok ? '  ✗ lần chạy cuối lỗi: ' + (e.lastRun.errors || [])[0] : '';
    log('  ' + s.id.padEnd(22) + s.device.padEnd(8) + (s.module || '').padEnd(11) + status + last);
  });
  log('Boards:');
  Object.keys(cfg.boards || {}).forEach(n => { const b = cfg.boards[n]; log('  ' + n.padEnd(12) + (b.file || '').padEnd(24) + b.width + '×' + b.height + '  ' + (b.shots || []).length + ' màn hình'); });
}
function help() {
  log([
    'NomadCare mockup kit',
    '  node build-mockup.js shots          chụp mọi trạng thái trong shots.json → screens/<id>.png',
    '  node build-mockup.js boards         render boards.html → export/*.png',
    '  node build-mockup.js all            shots + boards',
    '  node build-mockup.js placeholders   tạo ảnh tạm cho shot chưa có ảnh (--force: ghi đè)',
    '  node build-mockup.js data           chỉ cập nhật data.js từ shots.json',
    '  node build-mockup.js list           liệt kê trạng thái ảnh',
    'Tuỳ chọn: --only id1,id2  --device phone|tablet|desktop  --board mobile,dark  --scale 2  --parallel 3',
    '          --lang vi|en (chữ trên board)  --keep (giữ ảnh cả khi action lỗi)  --verbose  --base http://localhost:8099',
    '          --profile DIR (profile Chrome + cache tile, mặc định ' + DEFAULT_PROFILE + ')'
  ].join('\n'));
}

(async () => {
  const cfg = loadConfig();
  if (CMD === 'shots') await runShots(cfg);
  else if (CMD === 'boards') await runBoards(cfg);
  else if (CMD === 'all') { await runShots(cfg); await runBoards(cfg); }
  else if (CMD === 'placeholders') await runPlaceholders(cfg);
  else if (CMD === 'data') { writeData(cfg); log('✓ data.js'); }
  else if (CMD === 'list') runList(cfg);
  else help();
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
