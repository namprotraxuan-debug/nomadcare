/*
 * basemap.js — NC.basemap: offline VECTOR basemap per pilot corridor (owner: W4 MOD.02, prefix mk-bm-).
 * Roads, rivers/streams, lakes, place names and peaks extracted ONCE from OpenStreetMap (Overpass, ODbL,
 * "© OpenStreetMap contributors") at seed-build time → assets/data/basemap/<route_id>.json (format: PLAN "Offline
 * vector basemap file format"; NOT precached by sw.js). Downloaded on demand (online only) into Cache Storage
 * 'nc-basemap-v1' (IndexedDB kv fallback where the Cache API is missing, e.g. plain-http LAN tests); sw.js serves the
 * same files from that cache when offline. Drawn by Leaflet UNDER the route / POI layers when raster tiles are
 * unavailable (offline, blocked, failing — see NC.mapkit.rasterState) or when the user turns on "Nền offline".
 * Blocked / failing tiles while ONLINE with no downloaded corridor in view: the corridor in view is fetched for the
 * session only (memory, never stored) so the map still gets a basemap (attach → temporary()).
 * Public API: NC.basemap = {CACHE, ATTRIBUTION, ids(), supported(), status(rid), list(), size(rid),
 *   download(rid, {onProgress}), downloadWithFeedback(rid), remove(rid), load(rid), layer(data, opts),
 *   attach(map, opts), suggestIfNeeded({route_id, hasLostZone}), pure:{validate, shouldSuggest, layoutLabels, …}}
 * Bus: 'basemap:change' {route_id, downloaded}. Map events (attach): 'nc:vbase' {visible, mode, available, away}.
 * Pure helpers also run in Node (module.exports) for tools/tests/basemap.test.js.
 */
(function (root) {
  'use strict';

  var NC = root.NC = root.NC || {};
  var CACHE = 'nc-basemap-v1';
  var DIR = 'assets/data/basemap/';
  var KV_LATER = 'basemap.later';      // {route_id: ISO} — "Để sau" on the download suggestion, per route
  var KV_DATA = 'basemap.data.';       // + route_id → parsed file (IndexedDB fallback only)
  var KV_META = 'basemap.meta';        // {route_id: {bytes, generated_at, downloaded_at}} (IndexedDB fallback only)
  var ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  var DEFAULT_IDS = ['ha-giang-loop', 'khanh-le', 'ta-nang-phan-dung'];

  /* ================================================================== pure helpers (Node-testable) */

  var ROAD_ORDER = ['path', 'track', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk'];
  var CASED = { trunk: 1, primary: 1, secondary: 1 };
  var PLACE_KINDS = ['town', 'suburb', 'village', 'hamlet', 'locality'];
  /* Smallest zoom at which a class is drawn: minor classes and label density grow with the zoom. */
  var MINZ = {
    road: { trunk: 6, primary: 7, secondary: 9, tertiary: 10, unclassified: 11, residential: 13, track: 12, path: 13 },
    water: { river: 8, canal: 10, stream: 12, area: 8 },
    place: { town: 8, suburb: 12, village: 11, hamlet: 13, locality: 14 },
    peak: 12, ref: 11
  };
  /* Label priority (lower = placed first, wins collisions). */
  var PRI = { town: 0, ref: 1, suburb: 2, village: 3, peak: 4, hamlet: 5, locality: 6 };
  /* Stroke width (px) per zoom bucket [<9, <11, <13, ≥13]. */
  var WEIGHTS = {
    trunk: [2, 3, 4.5, 6], primary: [1.6, 2.6, 4, 5.5], secondary: [1.2, 2, 3.2, 4.5], tertiary: [1, 1.6, 2.6, 3.6],
    unclassified: [0.8, 1.2, 2, 3], residential: [0.8, 1, 1.6, 2.4], track: [1, 1, 1.4, 1.8], path: [1, 1, 1.2, 1.6],
    river: [1.2, 1.8, 2.4, 3.2], canal: [1, 1.4, 2, 2.6], stream: [0.8, 1, 1.2, 1.6]
  };

  function bucket(z) { return z < 9 ? 0 : z < 11 ? 1 : z < 13 ? 2 : 3; }
  /** Stroke width for a road / waterway class at zoom z (casing = +2.5 px). */
  function weightFor(cls, z, casing) {
    var w = (WEIGHTS[cls] || WEIGHTS.unclassified)[bucket(z)];
    return casing ? w + 2.5 : w;
  }
  /** Minimum zoom of a feature: kind 'road'|'water'|'place'|'peak'|'ref'. */
  function minZoom(kind, cls) {
    var m = MINZ[kind];
    if (typeof m === 'number') return m;
    return m && m[cls] !== undefined ? m[cls] : 99;
  }
  function roadClass(c) { return ROAD_ORDER.indexOf(c) >= 0 ? c : 'unclassified'; }
  function waterClass(w) { return w && w.a ? 'area' : (w && (w.c === 'river' || w.c === 'canal' || w.c === 'stream') ? w.c : 'stream'); }
  function placeKind(k) { return PLACE_KINDS.indexOf(k) >= 0 ? k : 'locality'; }

  function isPt(p) { return Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180; }
  function isLine(g, min) { return Array.isArray(g) && g.length >= (min || 2) && isPt(g[0]) && isPt(g[g.length - 1]); }

  /**
   * Validate a parsed basemap file (format v1). Unknown classes are tolerated (drawn as the nearest default class).
   * @returns {{ok:boolean, error?:string}}
   */
  function validate(d, rid) {
    if (!d || typeof d !== 'object') return { ok: false, error: 'not_object' };
    if (d.v !== 1) return { ok: false, error: 'version' };
    if (rid && d.route_id !== rid) return { ok: false, error: 'route_id' };
    if (!Array.isArray(d.bbox) || d.bbox.length !== 4 || !d.bbox.every(function (x) { return typeof x === 'number' && isFinite(x); })) return { ok: false, error: 'bbox' };
    var keys = ['roads', 'water', 'places', 'peaks'];
    for (var i = 0; i < keys.length; i++) {
      if (d[keys[i]] !== undefined && !Array.isArray(d[keys[i]])) return { ok: false, error: keys[i] };
    }
    var lines = (d.roads || []).concat(d.water || []);
    for (var j = 0; j < lines.length; j++) if (!isLine(lines[j] && lines[j].g)) return { ok: false, error: 'geometry' };
    var pts = (d.places || []).concat(d.peaks || []);
    for (var k = 0; k < pts.length; k++) if (!isPt(pts[k] && pts[k].p)) return { ok: false, error: 'point' };
    return { ok: true };
  }

  /**
   * Decide whether to show the "download the offline basemap" suggestion.
   * o: {hasLostZone, known, supported, downloaded, later, session, online, available (false = no file), busy}
   * @returns {{show:boolean, reason:string}}
   */
  function shouldSuggest(o) {
    o = o || {};
    if (!o.hasLostZone) return { show: false, reason: 'no_lost_zone' };
    if (!o.known) return { show: false, reason: 'not_corridor' };
    if (!o.supported) return { show: false, reason: 'unsupported' };
    if (o.downloaded) return { show: false, reason: 'downloaded' };
    if (o.later) return { show: false, reason: 'later' };
    if (o.session) return { show: false, reason: 'session' };
    if (!o.online) return { show: false, reason: 'offline' };
    if (o.available === false) return { show: false, reason: 'unavailable' };
    if (o.busy) return { show: false, reason: 'busy' };
    return { show: true, reason: 'ok' };
  }

  /**
   * Greedy screen-space label placement. items: [{x, y, w, h, pri}] (container px, centred on x/y).
   * Higher priority (lower pri) first; a label is shown only if its box (+gap) is fully on screen and overlaps no
   * shown label nor an obstacle box {x, y, r, b}. @returns {boolean[]} show flags in input order.
   */
  function layoutLabels(items, view, gap, obstacles) {
    var g = gap === undefined ? 4 : gap;
    var W = view && view.W, H = view && view.H;
    var order = items.map(function (it, i) { return i; }).sort(function (a, b) { return (items[a].pri - items[b].pri) || (a - b); });
    var placed = (obstacles || []).slice();
    var show = items.map(function () { return false; });
    order.forEach(function (i) {
      var it = items[i];
      var r = { x: it.x - it.w / 2 - g, y: it.y - it.h / 2 - g, r: it.x + it.w / 2 + g, b: it.y + it.h / 2 + g };
      if (W !== undefined && (r.x < 0 || r.y < 0 || r.r > W || r.b > H)) return;
      for (var k = 0; k < placed.length; k++) {
        var p = placed[k];
        if (r.x < p.r && p.x < r.r && r.y < p.b && p.y < r.b) return;
      }
      placed.push(r);
      show[i] = true;
    });
    return show;
  }

  /**
   * Obstacle boxes along a drawn line (container px points [{x,y}]): one square of half-size `half` every `step` px, only
   * where the line is on screen (W×H, with a `half` margin). Labels placed by layoutLabels() then keep off the route.
   * @returns {Array<{x,y,r,b}>}
   */
  function lineBoxes(pts, half, step, W, H) {
    var out = [];
    var st = Math.max(2, step || half * 1.5);
    function off(p) { return p.x < -half || p.y < -half || p.x > W + half || p.y > H + half; }
    pts = pts || [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      // both ends beyond the same edge → the segment cannot cross the view
      if ((a.x < -half && b.x < -half) || (a.y < -half && b.y < -half) || (a.x > W + half && b.x > W + half) || (a.y > H + half && b.y > H + half)) continue;
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
      var n = Math.max(1, Math.ceil(len / st));
      for (var k = 0; k < n; k++) {
        var x = a.x + dx * k / n, y = a.y + dy * k / n;
        if (!off({ x: x, y: y })) out.push({ x: x - half, y: y - half, r: x + half, b: y + half });
      }
    }
    var last = pts[pts.length - 1];
    if (last && !off(last)) out.push({ x: last.x - half, y: last.y - half, r: last.x + half, b: last.y + half });
    return out;
  }

  var CORRIDOR_IN = 0.5;   // coversView: share of the corridor bbox inside the view …
  var CORRIDOR_MIN = 0.1;  // … while it still fills this share of the view (not a speck in a country-wide view)

  /**
   * Does a downloaded corridor (bbox [south, west, north, east]) stand for the current view? Yes when the view centre
   * is inside it, or it fills ≥ `frac` (default 25 %) of the view, or most of it (≥ 50 %) is in the view and it still
   * fills ≥ 10 % of it (a route overview zoomed out around the corridor). Used so the vector basemap replaces the
   * raster only where it has data (a corridor far off screen, or a speck in a zoomed-out view, must not blank the map).
   * `view` / `center` should be the part of the map that floating panels leave visible (attach: opts.viewPadding): a
   * bottom sheet frames the route above it, so the centre of the whole map can fall outside the corridor.
   * @param {number[]} bbox @param {{s,w,n,e}} view @param {number[]} center [lat, lng] @param {number} [frac]
   */
  function coversView(bbox, view, center, frac) {
    if (!bbox || bbox.length !== 4 || !view) return false;
    var f = frac === undefined ? 0.25 : frac;
    if (center && center[0] >= bbox[0] && center[0] <= bbox[2] && center[1] >= bbox[1] && center[1] <= bbox[3]) return true;
    var s = Math.max(bbox[0], view.s), n = Math.min(bbox[2], view.n), w = Math.max(bbox[1], view.w), e = Math.min(bbox[3], view.e);
    if (!(s < n && w < e)) return false;
    var va = (view.n - view.s) * (view.e - view.w), ca = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]), ia = (n - s) * (e - w);
    if (!(va > 0)) return false;
    return ia / va >= f || (ca > 0 && ia / ca >= CORRIDOR_IN && ia / va >= CORRIDOR_MIN);
  }

  /** One label per distinct road ref / name (trunk…tertiary): the middle vertex of its longest line. */
  function refLabels(roads) {
    var best = {};
    (roads || []).forEach(function (r) {
      if (!r || !r.n || !isLine(r.g)) return;
      var c = roadClass(r.c);
      if (['trunk', 'primary', 'secondary', 'tertiary'].indexOf(c) < 0) return;
      var name = String(r.n).trim();
      if (!name || name.length > 24) return;
      if (!best[name] || r.g.length > best[name].g.length) best[name] = { n: name, g: r.g, c: c };
    });
    return Object.keys(best).map(function (k) { var b = best[k]; return { n: b.n, c: b.c, p: b.g[Math.floor(b.g.length / 2)] }; });
  }

  /* ================================================================== environment */

  function t(k, v, fb) {
    try { if (NC.i18n && NC.i18n.t) { var s = NC.i18n.t(k, v); if (s && s !== k) return s; } } catch (e) { /* ignore */ }
    return fb || k;
  }
  function online() { try { return NC.net && NC.net.online ? NC.net.online() : root.navigator.onLine !== false; } catch (e) { return true; } }
  function cacheApi() {
    try { return typeof root.caches !== 'undefined' && root.caches && typeof root.caches.open === 'function' ? root.caches : null; } catch (e) { return null; }
  }
  function kvOk() { return !!(NC.store && NC.store.get && NC.store.backend !== 'memory'); }
  function emit(evt, p) { if (NC.bus && NC.bus.emit) NC.bus.emit(evt, p); }
  function fmtBytes(n) {
    if (NC.util && NC.util.fmtBytes) return NC.util.fmtBytes(n);
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  function ids() {
    var r = (root.NC_SEED && root.NC_SEED.routes) || [];
    var list = r.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).map(function (x) { return x.id; });
    return list.length ? list : DEFAULT_IDS.slice();
  }
  function known(rid) { return !!rid && ids().indexOf(rid) >= 0; }
  function supported() { return !!cacheApi() || kvOk(); }
  function fileUrl(rid) {
    var rel = DIR + encodeURIComponent(rid) + '.json';
    try { return new URL(rel, root.document ? root.document.baseURI : root.location.href).href; } catch (e) { return rel; }
  }

  /* ================================================================== storage */

  var DATA = {};     // route_id → parsed file (memo)
  var SIZES = {};    // route_id → bytes on the server (HEAD) | false (no file)
  var busy = {};     // route_id → download promise
  /* Session-only corridor files (never stored): fetched when raster tiles are blocked / failing ONLINE and no
     downloaded corridor covers the view, so the map falls back to the vector basemap instead of a blank grid (R5.1).
     Same-origin JSON (not OpenStreetMap servers). A failed fetch is retried after TEMP_RETRY_MS at the earliest. */
  var TEMP = {}, TEMP_BUSY = {}, TEMP_FAIL = {};
  var TEMP_RETRY_MS = 60000;
  var TEMP_MARGIN = 0.08; // ° around the pilot route bbox ≈ the corridor buffer of the basemap files

  function readMeta() { return kvOk() ? NC.store.get(KV_META).catch(function () { return null; }).then(function (m) { return m || {}; }) : Promise.resolve({}); }
  function writeMeta(fn) {
    if (!kvOk()) return Promise.resolve();
    return readMeta().then(function (m) { fn(m); return NC.store.set(KV_META, m); }).catch(function () { });
  }

  /**
   * Download state of one corridor.
   * @returns {Promise<{route_id, downloaded:boolean, bytes:number|null, generated_at:string|null, downloaded_at:string|null, storage:'cache'|'idb'|null}>}
   */
  function status(rid) {
    var base = { route_id: rid, downloaded: false, bytes: null, generated_at: null, downloaded_at: null, storage: null };
    var cs = cacheApi();
    // CacheStorage.match({cacheName}) never creates the cache (caches.open would, on every status read)
    var viaCache = cs ? cs.match(fileUrl(rid), { cacheName: CACHE, ignoreSearch: true }).then(function (res) {
      if (!res) return null;
      var h = res.headers;
      return {
        route_id: rid, downloaded: true, bytes: +h.get('x-nc-bytes') || null, generated_at: h.get('x-nc-generated') || null,
        downloaded_at: h.get('x-nc-downloaded') || null, storage: 'cache'
      };
    }).catch(function () { return null; }) : Promise.resolve(null);
    return viaCache.then(function (st) {
      if (st) return st;
      return readMeta().then(function (m) {
        var x = m[rid];
        return x ? { route_id: rid, downloaded: true, bytes: x.bytes || null, generated_at: x.generated_at || null, downloaded_at: x.downloaded_at || null, storage: 'idb' } : base;
      });
    });
  }
  function list() { return Promise.all(ids().map(status)); }

  /** Size of the corridor file on the server (HEAD, online only; memoised). null = unknown, false = no such file. */
  function size(rid) {
    if (SIZES[rid] !== undefined) return Promise.resolve(SIZES[rid]);
    if (!online() || !root.fetch) return Promise.resolve(null);
    return root.fetch(fileUrl(rid), { method: 'HEAD', cache: 'no-cache' }).then(function (res) {
      if (res.status === 404) { SIZES[rid] = false; return false; }
      if (!res.ok) return null;
      var n = +res.headers.get('content-length');
      if (n > 0) SIZES[rid] = n;
      return n > 0 ? n : null;
    }).catch(function () { return null; });
  }

  function readBody(res, onProgress) {
    var total = +res.headers.get('content-length') || 0;
    if (!res.body || !res.body.getReader || typeof root.TextDecoder === 'undefined') {
      return res.text().then(function (txt) { if (onProgress) onProgress({ loaded: total || txt.length, total: total || txt.length }); return txt; });
    }
    var reader = res.body.getReader();
    var dec = new root.TextDecoder('utf-8');
    var parts = [], loaded = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { parts.push(dec.decode()); return parts.join(''); }
        loaded += r.value.byteLength;
        parts.push(dec.decode(r.value, { stream: true }));
        if (onProgress) { try { onProgress({ loaded: loaded, total: total }); } catch (e) { /* ignore */ } }
        return pump();
      });
    }
    return pump();
  }

  /**
   * Download one corridor file and keep it for offline use. Online only.
   * @param {string} rid @param {{onProgress?:function({loaded,total})}} [opts]
   * @returns {Promise<Object>} the new status(); rejects with e.code 'offline'|'unsupported'|'unknown_route'|'not_found'|'http'|'invalid'
   */
  function download(rid, opts) {
    opts = opts || {};
    if (!known(rid)) return Promise.reject(err('unknown_route'));
    if (!supported()) return Promise.reject(err('unsupported'));
    if (!online()) return Promise.reject(err('offline'));
    if (busy[rid]) return busy[rid];
    var url = fileUrl(rid);
    var p = root.fetch(url, { cache: 'no-store' }).then(function (res) {
      if (res.status === 404) { SIZES[rid] = false; throw err('not_found'); }
      if (!res.ok) throw err('http', 'HTTP ' + res.status);
      return readBody(res, opts.onProgress);
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) { throw err('invalid'); }
      var v = validate(data, rid);
      if (!v.ok) throw err('invalid', v.error);
      var bytes = txt.length;
      try { bytes = new root.Blob([txt]).size; } catch (e) { /* keep the char count */ }
      SIZES[rid] = bytes;
      var meta = { bytes: bytes, generated_at: data.generated_at || null, downloaded_at: new Date().toISOString() };
      var cs = cacheApi();
      var save = cs ? cs.open(CACHE).then(function (c) {
        return c.put(url, new root.Response(txt, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8', 'X-NC-Bytes': String(bytes),
            'X-NC-Generated': meta.generated_at || '', 'X-NC-Downloaded': meta.downloaded_at, 'X-NC-Route': rid
          }
        }));
      }) : NC.store.set(KV_DATA + rid, data).then(function () { return writeMeta(function (m) { m[rid] = meta; }); });
      return save.then(function () { DATA[rid] = data; return status(rid); });
    }).then(function (st) {
      delete busy[rid];
      emit('basemap:change', { route_id: rid, downloaded: true });
      return st;
    }, function (e) { delete busy[rid]; throw e; });
    busy[rid] = p;
    return p;
  }

  /** Delete a downloaded corridor (both stores). */
  function remove(rid) {
    delete DATA[rid];
    var cs = cacheApi();
    var a = cs ? cs.has(CACHE).then(function (has) { return has ? cs.open(CACHE).then(function (c) { return c.delete(fileUrl(rid), { ignoreSearch: true }); }) : false; }).catch(function () { }) : Promise.resolve();
    var b = kvOk() ? NC.store.del(KV_DATA + rid).catch(function () { }).then(function () { return writeMeta(function (m) { delete m[rid]; }); }) : Promise.resolve();
    return Promise.all([a, b]).then(function () { emit('basemap:change', { route_id: rid, downloaded: false }); });
  }

  /** Session-only copy of a corridor file from the network (memory only, see TEMP). @returns {Promise<Object|null>} */
  function loadTemp(rid) {
    if (DATA[rid]) return Promise.resolve(DATA[rid]);
    if (TEMP[rid]) return Promise.resolve(TEMP[rid]);
    if (TEMP_BUSY[rid]) return TEMP_BUSY[rid];
    if (!known(rid) || !online() || !root.fetch || (TEMP_FAIL[rid] && Date.now() - TEMP_FAIL[rid] < TEMP_RETRY_MS)) return Promise.resolve(null);
    var p = root.fetch(fileUrl(rid), { credentials: 'same-origin' }).then(function (res) {
      if (res.status === 404) SIZES[rid] = false;
      if (!res.ok) throw err('http', 'HTTP ' + res.status);
      return res.json();
    }).then(function (d) {
      if (!validate(d, rid).ok) throw err('invalid');
      TEMP[rid] = d;
      delete TEMP_BUSY[rid];
      return d;
    }).catch(function () { TEMP_FAIL[rid] = Date.now(); delete TEMP_BUSY[rid]; return null; });
    TEMP_BUSY[rid] = p;
    return p;
  }
  function tempReady(rid) { return !!TEMP[rid]; }
  function tempWorth(rid) { return !TEMP[rid] && !TEMP_BUSY[rid] && !(TEMP_FAIL[rid] && Date.now() - TEMP_FAIL[rid] < TEMP_RETRY_MS); }
  /* Pilot route bbox [s, w, n, e] + TEMP_MARGIN (the corridor file's own bbox is only known once it is loaded). */
  function routeBox(rid) {
    var r = ((root.NC_SEED && root.NC_SEED.routes) || []).filter(function (x) { return x.id === rid; })[0];
    var b = r && r.bbox;
    if (!b || b.length !== 4) return null;
    return [b[0] - TEMP_MARGIN, b[1] - TEMP_MARGIN, b[2] + TEMP_MARGIN, b[3] + TEMP_MARGIN];
  }

  /** Parsed corridor file from local storage (never the network). @returns {Promise<Object|null>} */
  function load(rid) {
    if (DATA[rid]) return Promise.resolve(DATA[rid]);
    var cs = cacheApi();
    var fromCache = cs ? cs.match(fileUrl(rid), { cacheName: CACHE, ignoreSearch: true })
      .then(function (res) { return res ? res.json() : null; }).catch(function () { return null; }) : Promise.resolve(null);
    return fromCache.then(function (d) {
      if (d) return d;
      return kvOk() ? NC.store.get(KV_DATA + rid).catch(function () { return null; }) : null;
    }).then(function (d) {
      if (!d || !validate(d, rid).ok) return null;
      DATA[rid] = d;
      return d;
    });
  }

  /* ================================================================== styles (injected once) */

  var CSS = [
    '.mk-map.mk-map--vector{background:var(--c-surface-2);}',
    /* like Leaflet's own overlay-pane rule: a global svg{max-width:100%} would collapse the renderer in a 0×0 pane */
    '.leaflet-container .leaflet-ncBasemap-pane svg{max-width:none !important;max-height:none !important;}',
    '.mk-bm-water-a{fill:var(--c-info-soft);stroke:var(--c-info);stroke-opacity:.3;}',
    '.mk-bm-water{fill:none;stroke:var(--c-info);stroke-opacity:.55;}',
    '.mk-bm-water--stream{stroke-opacity:.4;}',
    '.mk-bm-case{fill:none;stroke:var(--c-muted);stroke-opacity:.5;}',
    '.mk-bm-road{fill:none;stroke:var(--c-muted);stroke-opacity:.5;}',
    '.mk-bm-road--trunk,.mk-bm-road--primary{stroke:var(--c-warning-soft);stroke-opacity:1;}',
    '.mk-bm-road--secondary{stroke:var(--c-surface);stroke-opacity:1;}',
    '.mk-bm-road--tertiary{stroke:var(--c-text-2);stroke-opacity:.45;}',
    '.mk-bm-road--track,.mk-bm-road--path{stroke:var(--c-muted);stroke-opacity:.6;}',
    '.mk-bm-lblw{width:0;height:0;background:none;border:0;pointer-events:none;}',
    '.mk-bm-lbl{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;font-family:var(--font-sans);',
    'font-size:var(--fs-xs);font-weight:600;line-height:1.2;color:var(--c-text-2);letter-spacing:.01em;',
    'text-shadow:0 0 2px var(--c-surface-2),0 0 3px var(--c-surface-2),0 0 5px var(--c-surface-2);}',
    '.mk-bm-lbl--town{font-size:13px;font-weight:800;color:var(--c-text);}',
    '.mk-bm-lbl--hamlet,.mk-bm-lbl--locality{font-weight:500;color:var(--c-muted);}',
    '.mk-bm-lbl--peak{display:flex;flex-direction:column;align-items:center;gap:1px;font-weight:600;}',
    '.mk-bm-lbl--peak i{display:block;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:8px solid var(--c-muted);}',
    '.mk-bm-lbl--ref{padding:0 5px;border-radius:4px;background:var(--c-surface);border:1px solid var(--c-border-strong);color:var(--c-text-2);font-weight:700;text-shadow:none;}',
    '.mk-bm-hide{visibility:hidden;}',
    '.mk-bm-sug__text{margin:0;font-size:var(--fs-md);line-height:var(--lh-base);color:var(--c-text);}',
    '.mk-bm-sug__note{margin:var(--sp-2) 0 0;font-size:var(--fs-xs);color:var(--c-muted);}'
  ].join('\n');
  function injectStyle() {
    var doc = root.document;
    if (!doc || doc.getElementById('nc-basemap-style')) return;
    var st = doc.createElement('style');
    st.id = 'nc-basemap-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  function esc(s) {
    if (NC.util && NC.util.esc) return NC.util.esc(s);
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ================================================================== Leaflet layer */

  var PANE = 'ncBasemap', LABEL_PANE = 'ncBasemapLabels';
  function ensurePanes(map) {
    if (!map.getPane(PANE)) {
      var p = map.createPane(PANE);
      p.style.zIndex = 250;            // above the raster tile pane (200), under overlays / routes (400)
      p.style.pointerEvents = 'none';
    }
    if (!map.getPane(LABEL_PANE)) {
      var q = map.createPane(LABEL_PANE);
      q.style.zIndex = 390;            // labels above the basemap lines, UNDER the route / signal lines (overlayPane 400)
      q.style.pointerEvents = 'none';
    }
  }

  var VectorLayer = null;
  function layerClass() {
    if (VectorLayer) return VectorLayer;
    var Lf = root.L;
    VectorLayer = Lf.Layer.extend({
      options: { attribution: ATTRIBUTION, pane: PANE },
      initialize: function (data, opts) {
        this._d = data;
        this._o = opts || {};
      },
      onAdd: function (map) {
        injectStyle();
        ensurePanes(map);
        if (!this._groups) {
          this._renderer = Lf.svg({ pane: PANE, padding: 0.4 });
          this._groups = this._buildGroups();
          this._labels = this._buildLabels();
        }
        this._shown = null;
        this._onZoom = this._syncZoom.bind(this);
        this._onMove = this._scheduleLabels.bind(this);
        map.on('zoomend', this._onZoom);
        map.on('moveend resize', this._onMove);
        this._syncZoom();
      },
      onRemove: function (map) {
        map.off('zoomend', this._onZoom);
        map.off('moveend resize', this._onMove);
        if (this._raf && root.cancelAnimationFrame) root.cancelAnimationFrame(this._raf);
        this._raf = 0;
        (this._groups || []).forEach(function (g) { if (map.hasLayer(g.layer)) map.removeLayer(g.layer); });
        (this._labels || []).forEach(function (l) { if (map.hasLayer(l.m)) map.removeLayer(l.m); });
        this._shown = null;
      },
      _buildGroups: function () {
        var d = this._d, r = this._renderer, out = [];
        var base = { renderer: r, interactive: false, smoothFactor: 1.2, lineCap: 'round', lineJoin: 'round', bubblingMouseEvents: false };
        function add(key, cls, kind, geoms, o) {
          if (!geoms.length) return;
          var style = Object.assign({}, base, o.style);
          var lyr = o.polygon ? Lf.polygon(geoms, style) : Lf.polyline(geoms, style);
          out.push({ key: key, cls: cls, kind: kind, casing: !!o.casing, minZ: o.minZ, layer: lyr });
        }
        var water = d.water || [];
        add('water-area', 'area', 'water', water.filter(function (w) { return w.a && isLine(w.g, 3); }).map(function (w) { return [w.g]; }),
          { polygon: true, minZ: minZoom('water', 'area'), style: { className: 'mk-bm-water-a', weight: 1, fillOpacity: 1, opacity: 1 } });
        ['stream', 'canal', 'river'].forEach(function (c) {
          add('water-' + c, c, 'water', water.filter(function (w) { return !w.a && waterClass(w) === c; }).map(function (w) { return w.g; }),
            { minZ: minZoom('water', c), style: { className: 'mk-bm-water mk-bm-water--' + c, opacity: 1 } });
        });
        var byCls = {};
        (d.roads || []).forEach(function (rd) { var c = roadClass(rd.c); (byCls[c] = byCls[c] || []).push(rd.g); });
        // casings first (under every fill), then fills from minor to major
        ROAD_ORDER.forEach(function (c) {
          if (CASED[c] && byCls[c]) add('case-' + c, c, 'road', byCls[c], { casing: true, minZ: minZoom('road', c), style: { className: 'mk-bm-case mk-bm-case--' + c, opacity: 1 } });
        });
        ROAD_ORDER.forEach(function (c) {
          if (!byCls[c]) return;
          var dash = c === 'track' ? '5 5' : c === 'path' ? '2 4' : null;
          add('road-' + c, c, 'road', byCls[c], { minZ: minZoom('road', c), style: { className: 'mk-bm-road mk-bm-road--' + c, opacity: 1, dashArray: dash } });
        });
        return out;
      },
      _buildLabels: function () {
        var d = this._d, o = this._o, out = [];
        var skip = typeof o.skipPlace === 'function' ? o.skipPlace : null;
        function mk(p, html, kind, pri, minZ) {
          var m = Lf.marker(p, {
            pane: LABEL_PANE, interactive: false, keyboard: false,
            icon: Lf.divIcon({ className: 'mk-bm-lblw', html: html, iconSize: null })
          });
          out.push({ m: m, kind: kind, pri: pri, minZ: minZ, w: 0, h: 0 });
        }
        (d.places || []).forEach(function (pl) {
          if (!pl || !pl.n || !isPt(pl.p)) return;
          var k = placeKind(pl.k);
          if (skip && skip({ lat: pl.p[0], lng: pl.p[1], name: pl.n, kind: k })) return;
          mk(pl.p, '<span class="mk-bm-lbl mk-bm-lbl--' + k + '" lang="vi">' + esc(pl.n) + '</span>', k, PRI[k], minZoom('place', k));
        });
        (d.peaks || []).forEach(function (pk) {
          if (!pk || !isPt(pk.p) || (!pk.n && !pk.e)) return;
          var txt = (pk.n || '') + (pk.e ? (pk.n ? ' ' : '') + Math.round(pk.e) + ' m' : '');
          mk(pk.p, '<span class="mk-bm-lbl mk-bm-lbl--peak"' + (pk.n ? ' lang="vi"' : '') + '><i aria-hidden="true"></i>' + esc(txt) + '</span>', 'peak', PRI.peak, minZoom('peak'));
        });
        refLabels(d.roads).forEach(function (rf) {
          mk(rf.p, '<span class="mk-bm-lbl mk-bm-lbl--ref" lang="vi">' + esc(rf.n) + '</span>', 'ref', PRI.ref, minZoom('ref'));
        });
        return out;
      },
      /* Zoom change: (re)add the classes visible at this zoom in canonical order (keeps the SVG z-order), restyle widths. */
      _syncZoom: function () {
        var map = this._map;
        if (!map) return;
        var z = map.getZoom();
        var want = this._groups.filter(function (g) { return z >= g.minZ; });
        var sig = want.map(function (g) { return g.key; }).join('|');
        if (sig !== this._shown) {
          this._groups.forEach(function (g) { if (map.hasLayer(g.layer)) map.removeLayer(g.layer); });
          want.forEach(function (g) { g.layer.addTo(map); });
          this._shown = sig;
        }
        want.forEach(function (g) {
          if (g.kind === 'road' || (g.kind === 'water' && g.cls !== 'area')) g.layer.setStyle({ weight: weightFor(g.cls, z, g.casing) });
        });
        this._labels.forEach(function (l) {
          var on = z >= l.minZ;
          if (on && !map.hasLayer(l.m)) l.m.addTo(map);
          else if (!on && map.hasLayer(l.m)) map.removeLayer(l.m);
        });
        this._scheduleLabels();
      },
      _scheduleLabels: function () {
        if (this._raf) return;
        var self = this;
        var raf = root.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
        this._raf = raf(function () { self._raf = 0; self._placeLabels(); });
      },
      /* Collision pass: all reads first (measure once, positions), then writes (class toggles). */
      _placeLabels: function () {
        var map = this._map;
        if (!map) return;
        var size = map.getSize();
        var live = this._labels.filter(function (l) { return map.hasLayer(l.m) && l.m._icon; });
        live.forEach(function (l) {
          if (!l.w) {
            var el = l.m._icon.firstChild;
            if (el) { l.w = el.offsetWidth; l.h = el.offsetHeight; }
          }
        });
        var obstacles = typeof this._o.obstacles === 'function' ? (this._o.obstacles() || []).slice() : [];
        // drawn route lines (signal colours, dead-zone dots): no label sits on them
        var avoid = typeof this._o.avoidLines === 'function' ? (this._o.avoidLines() || []) : [];
        avoid.forEach(function (ln) {
          if (!ln || !ln.g || ln.g.length < 2) return;
          var pts = ln.g.map(function (p) { return map.latLngToContainerPoint(p); });
          obstacles = obstacles.concat(lineBoxes(pts, ln.half || 6, (ln.half || 6) * 1.5, size.x, size.y));
        });
        var items = live.map(function (l) {
          var p = map.latLngToContainerPoint(l.m.getLatLng());
          return { x: p.x, y: p.y, w: l.w || 40, h: l.h || 16, pri: l.pri };
        });
        var show = layoutLabels(items, { W: size.x, H: size.y }, 3, obstacles);
        live.forEach(function (l, i) { l.m._icon.classList.toggle('mk-bm-hide', !show[i]); });
      }
    });
    return VectorLayer;
  }

  /**
   * Leaflet layer for one parsed corridor file.
   * @param {Object} data @param {{skipPlace?:function({lat,lng,name,kind}):boolean, obstacles?:function():Array,
   *   avoidLines?:function():Array<{g:number[][], half:number}>}} [opts]
   *   skipPlace: drop a place label (e.g. already labelled by the app); obstacles: container-px boxes labels avoid;
   *   avoidLines: drawn lines ([[lat,lng]…] + half width in px) labels keep off (the route).
   */
  function layer(data, opts) {
    if (!root.L) throw new Error('Leaflet is not loaded');
    var C = layerClass();
    return new C(data, opts);
  }

  /* ================================================================== auto show / hide on a map */

  /**
   * Keep the downloaded corridors drawn on `map` whenever raster tiles are unavailable (offline, blocked, failing), or
   * always (mode 'on'), or never (mode 'off') — but only where they have data: the vector basemap replaces the raster
   * layer (NC.mapkit.setCover, so the two never mix) only while a downloaded corridor stands for the view (coversView:
   * the view centre is inside its bbox, it fills ≥ 25 % of the view, or most of it is in the view and fills ≥ 10 %;
   * "view" = the part opts.viewPadding leaves visible). Elsewhere the raster layer stays (tiles viewed
   * before still render offline) with its normal notice; re-checked after every move. The © OpenStreetMap credit
   * stays visible. Fires 'nc:vbase' {visible, mode, available, away} on the map (away = wanted, but no downloaded
   * corridor in view). Raster tiles blocked / failing while ONLINE and no downloaded corridor in view: the corridor in
   * view is fetched for this session only (not stored, `temporary` = true in 'nc:vbase') so the map still has a basemap.
   * @param {L.Map} map @param {{mode?:'auto'|'on'|'off', skipPlace?:function, obstacles?:function, avoidLines?:function,
   *   viewPadding?:function():{tl:number[], br:number[]}}} [opts]
   *   viewPadding: container px hidden by floating panels (Leaflet fitBounds padding: tl = [left, top], br = [right,
   *   bottom]) — the coverage test uses the rest of the map and its centre.
   * @returns {{mode():string, setMode(m), visible():boolean, away():boolean, temporary():boolean, available():string[], sync():Promise, destroy()}}
   */
  function attach(map, opts) {
    opts = opts || {};
    var st = {
      mode: opts.mode === 'on' || opts.mode === 'off' ? opts.mode : 'auto', layers: {}, datas: {}, visible: false, away: false,
      available: [], dead: false, gen: 0, lastSig: '', temp: false
    };
    var mk = NC.mapkit;
    function rasterDown() {
      var rs = mk && mk.rasterState ? mk.rasterState(map) : { state: 'ok' };
      return rs.state === 'offline' || rs.state === 'blocked' || rs.state === 'failed';
    }
    function wanted() { return st.mode === 'on' || (st.mode === 'auto' && rasterDown()); }
    /* Online with blocked / failing raster tiles: corridors may be fetched for the session (R5.1). Offline they cannot. */
    function tempOk() {
      if (st.mode === 'off') return false;
      var rs = mk && mk.rasterState ? mk.rasterState(map) : null;
      return !!rs && rs.online && (rs.state === 'blocked' || rs.state === 'failed');
    }
    /* Not-downloaded corridors whose pilot route lies in the current view. */
    function tempCandidates() {
      var v = viewNow();
      return ids().filter(function (rid) {
        if (st.available.indexOf(rid) >= 0) return false;
        var b = routeBox(rid);
        return !!b && inView({ bbox: b }, v);
      });
    }
    function fire() {
      var sig = st.visible + '|' + st.away + '|' + st.mode + '|' + st.temp + '|' + st.available.join(',');
      if (sig === st.lastSig) return;
      st.lastSig = sig;
      map.fire('nc:vbase', { visible: st.visible, mode: st.mode, available: st.available.slice(), away: st.away, temporary: st.temp });
    }
    function hideAll() {
      Object.keys(st.layers).forEach(function (rid) { if (map.hasLayer(st.layers[rid])) map.removeLayer(st.layers[rid]); });
      st.visible = false;
      map.getContainer().classList.remove('mk-map--vector');
      if (mk && mk.setCover) mk.setCover(map, null);
    }
    /* The part of the map floating panels leave visible (opts.viewPadding) and its centre: a phone bottom sheet frames
       the route above it, so the centre of the whole map can fall south of the corridor. Read once per decision (the
       padding callback measures the page). @returns {{view:{s,w,n,e}, center:number[]}|null} */
    function viewNow() {
      var size, p = null;
      try { map.getCenter(); size = map.getSize(); } catch (e) { return null; } // throws before the first setView
      if (typeof opts.viewPadding === 'function') { try { p = opts.viewPadding(); } catch (e) { p = null; } }
      var x0 = 0, y0 = 0, x1 = size.x, y1 = size.y;
      if (p && p.tl && p.br) {
        var l = Math.max(0, +p.tl[0] || 0), tp = Math.max(0, +p.tl[1] || 0), r = Math.max(0, +p.br[0] || 0), bt = Math.max(0, +p.br[1] || 0);
        if (size.x - l - r >= 1 && size.y - tp - bt >= 1) { x0 = l; y0 = tp; x1 = size.x - r; y1 = size.y - bt; } // else: whole map
      }
      var nw = map.containerPointToLatLng([x0, y0]), se = map.containerPointToLatLng([x1, y1]);
      var c = map.containerPointToLatLng([(x0 + x1) / 2, (y0 + y1) / 2]);
      if (!isFinite(nw.lat) || !isFinite(se.lat) || !isFinite(c.lat)) return null;
      return { view: { s: se.lat, w: nw.lng, n: nw.lat, e: se.lng }, center: [c.lat, c.lng] };
    }
    function inView(d, v) {
      if (v === undefined) v = viewNow();
      return !!v && !!d && coversView(d.bbox, v.view, v.center);
    }
    /* Synchronous part: decide from the loaded corridor files and the current view. */
    function apply() {
      if (st.dead) return;
      var want = wanted();
      var v = want ? viewNow() : null;
      var rids = st.available.filter(function (rid) { return !!st.datas[rid]; });
      var show = want && rids.some(function (rid) { return inView(st.datas[rid], v); });
      // no downloaded corridor stands for the view, tiles blocked / failing online → session-only copies (R5.1)
      var temps = !show && want && tempOk() ? ids().filter(function (rid) { return st.available.indexOf(rid) < 0 && tempReady(rid) && inView(TEMP[rid], v); }) : [];
      var dataOf = function (rid) { return st.datas[rid] || TEMP[rid]; };
      st.away = want && rids.length > 0 && !show && !temps.length;
      if (temps.length) { show = true; rids = rids.concat(temps); }
      st.temp = temps.length > 0;
      if (!show) { if (st.visible) hideAll(); fire(); return; }
      // every downloaded corridor is drawn (a neighbour at the edge of the view continues seamlessly)
      Object.keys(st.layers).forEach(function (rid) {
        if (rids.indexOf(rid) < 0 && map.hasLayer(st.layers[rid])) map.removeLayer(st.layers[rid]);
      });
      rids.forEach(function (rid) {
        if (!st.layers[rid]) st.layers[rid] = layer(dataOf(rid), opts);
        if (!map.hasLayer(st.layers[rid])) st.layers[rid].addTo(map);
      });
      st.visible = true;
      map.getContainer().classList.add('mk-map--vector');
      if (mk && mk.setCover) mk.setCover(map, 'vector');
      fire();
    }
    /* Asynchronous part: which corridors are downloaded, and their files (read from local storage only when wanted). */
    function sync() {
      if (st.dead) return Promise.resolve();
      var gen = ++st.gen;
      return list().then(function (sts) {
        if (gen !== st.gen || st.dead) return null;
        st.available = sts.filter(function (s) { return s.downloaded; }).map(function (s) { return s.route_id; });
        Object.keys(st.layers).concat(Object.keys(st.datas)).forEach(function (rid) {
          if (st.available.indexOf(rid) >= 0 || (TEMP[rid] && !st.datas[rid])) return; // session-only layers stay cached
          if (st.layers[rid] && map.hasLayer(st.layers[rid])) map.removeLayer(st.layers[rid]);
          delete st.layers[rid];
          delete st.datas[rid];
        });
        var missing = st.available.filter(function (rid) { return !st.datas[rid]; });
        var temps = wanted() && tempOk() ? tempCandidates().filter(tempWorth) : [];
        if (!wanted() || (!missing.length && !temps.length)) { apply(); return null; }
        return Promise.all(missing.map(load)).then(function (datas) {
          if (gen !== st.gen || st.dead) return null;
          datas.forEach(function (d, i) { if (d) st.datas[missing[i]] = d; });
          var v = viewNow();
          var downloadedInView = st.available.some(function (rid) { return st.datas[rid] && inView(st.datas[rid], v); });
          if (downloadedInView || !temps.length) { apply(); return null; }
          apply(); // downloaded corridors (if any) first, then the session-only copies when they arrive
          return Promise.all(temps.map(loadTemp)).then(function () { if (gen === st.gen && !st.dead) apply(); });
        });
      }).catch(function (e) { if (root.console) root.console.warn('[basemap] sync failed', e && e.message); });
    }
    // Raster availability changes (net, blocked/failed tiles). Events caused by our own setCover() are ignored.
    var onRaster = function (e) { if (e && e.causedByCover) return; sync(); };
    // The view moved: a downloaded corridor may have come into view or left it.
    var onMove = function () {
      if (st.dead) return;
      var want = wanted();
      if (want && tempOk() && tempCandidates().some(tempWorth)) { sync(); return; }
      if (!st.available.length && !st.temp && !(want && tempOk())) return;
      if (want && st.available.some(function (rid) { return !st.datas[rid]; })) sync(); else apply();
    };
    map.on('nc:basemap', onRaster);
    map.on('moveend', onMove);
    var offBus = NC.bus && NC.bus.on ? NC.bus.on('basemap:change', function () { sync(); }) : function () { };
    map.on('unload', function () { st.dead = true; try { offBus(); } catch (e) { /* ignore */ } });
    sync();
    return {
      mode: function () { return st.mode; },
      setMode: function (m) { st.mode = m === 'on' || m === 'off' ? m : 'auto'; return sync(); },
      visible: function () { return st.visible; },
      away: function () { return st.away; },
      /** true while the drawn basemap includes a session-only corridor (not downloaded). */
      temporary: function () { return st.temp; },
      available: function () { return st.available.slice(); },
      sync: sync,
      destroy: function () {
        st.dead = true;
        map.off('nc:basemap', onRaster);
        map.off('moveend', onMove);
        try { offBus(); } catch (e) { /* ignore */ }
        hideAll();
      }
    };
  }

  /* ================================================================== download suggestion */

  if (NC.i18n && NC.i18n.add) {
    NC.i18n.add({
      vi: {
        'bm.sug.title': 'Tải nền bản đồ offline?',
        'bm.sug.text': 'Tuyến này có vùng mất sóng — tải nền bản đồ offline (~{size}) để vẫn xem được bản đồ khi mất sóng?',
        'bm.sug.text_nosize': 'Tuyến này có vùng mất sóng — tải nền bản đồ offline để vẫn xem được bản đồ khi mất sóng?',
        'bm.sug.note': 'Gồm đường, sông suối và địa danh quanh tuyến. Dữ liệu © OpenStreetMap contributors (ODbL).',
        'bm.sug.now': 'Tải ngay', 'bm.sug.later': 'Để sau',
        'bm.done': 'Đã tải nền bản đồ offline · {route} ({size}).',
        'bm.fail': 'Không tải được nền bản đồ offline. Thử lại khi có mạng ổn định.',
        'bm.offline': 'Cần có mạng để tải nền bản đồ offline.',
        'bm.not_found': 'Chưa có nền bản đồ offline cho tuyến này.',
        'bm.unsupported': 'Trình duyệt này không lưu được nền bản đồ offline.',
        'bm.removed': 'Đã xoá nền bản đồ offline · {route}.'
      },
      en: {
        'bm.sug.title': 'Download the offline basemap?',
        'bm.sug.text': 'This route crosses a dead zone — download the offline basemap (~{size}) so you can still see the map without signal?',
        'bm.sug.text_nosize': 'This route crosses a dead zone — download the offline basemap so you can still see the map without signal?',
        'bm.sug.note': 'Roads, rivers and place names around the route. Data © OpenStreetMap contributors (ODbL).',
        'bm.sug.now': 'Download now', 'bm.sug.later': 'Later',
        'bm.done': 'Offline basemap downloaded · {route} ({size}).',
        'bm.fail': "Couldn't download the offline basemap. Try again on a stable connection.",
        'bm.offline': 'A connection is needed to download the offline basemap.',
        'bm.not_found': 'No offline basemap is available for this route yet.',
        'bm.unsupported': "This browser can't store the offline basemap.",
        'bm.removed': 'Offline basemap removed · {route}.'
      }
    });
  }

  function routeLabel(rid) {
    var r = ((root.NC_SEED && root.NC_SEED.routes) || []).filter(function (x) { return x.id === rid; })[0];
    var en = NC.i18n && NC.i18n.lang && NC.i18n.lang() === 'en';
    var name = r ? (en && r.name_en ? r.name_en : r.name) : rid;
    var s = NC.app && NC.app.routeName ? String(NC.app.routeName(rid) || name) : String(name);
    return s.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  }
  function toast(msg, o) { if (NC.ui && NC.ui.toast) NC.ui.toast(msg, o); }
  function failMessage(e) {
    var c = e && e.code;
    return t(c === 'offline' ? 'bm.offline' : c === 'not_found' ? 'bm.not_found' : c === 'unsupported' ? 'bm.unsupported' : 'bm.fail');
  }

  /**
   * download() with the standard toasts (used by the suggestion sheet and the MOD.02 packs tab).
   * @returns {Promise<Object|null>} status, or null on failure (already toasted)
   */
  function downloadWithFeedback(rid, opts) {
    return download(rid, opts).then(function (st) {
      toast(t('bm.done', { route: routeLabel(rid), size: st.bytes ? fmtBytes(st.bytes) : '–' }), { type: 'success' });
      return st;
    }, function (e) {
      toast(failMessage(e), { type: 'warning' });
      return null;
    });
  }
  /** remove() with the standard toast. */
  function removeWithFeedback(rid) {
    return remove(rid).then(function () { toast(t('bm.removed', { route: routeLabel(rid) }), { type: 'success' }); });
  }

  function laterMap() { return kvOk() ? NC.store.get(KV_LATER).catch(function () { return null; }).then(function (m) { return m || {}; }) : Promise.resolve({}); }
  var shownThisSession = {};

  /**
   * After a route is computed: when it crosses a dead zone (level lost) and the corridor basemap is not downloaded,
   * offer to download it. "Để sau" is remembered per route (NC.store kv 'basemap.later'); closing the sheet any other
   * way only skips it for this session. Online only (the download needs a connection); never stacks on another overlay.
   * @param {{route_id:string, hasLostZone:boolean}} o
   * @returns {Promise<string>} 'shown' | 'skipped:<reason>'
   */
  function suggestIfNeeded(o) {
    o = o || {};
    var rid = o.route_id;
    if (!o.hasLostZone || !known(rid)) {
      return Promise.resolve('skipped:' + shouldSuggest({ hasLostZone: o.hasLostZone, known: known(rid) }).reason);
    }
    return Promise.all([status(rid), laterMap()]).then(function (res) {
      var base = {
        hasLostZone: true, known: true, supported: supported(), downloaded: res[0].downloaded, later: !!res[1][rid],
        session: !!shownThisSession[rid], online: online(), busy: !!(NC.ui && NC.ui.openCount && NC.ui.openCount() > 0)
      };
      var pre = shouldSuggest(base);
      if (!pre.show) return 'skipped:' + pre.reason;
      return size(rid).then(function (n) {
        base.available = n === false ? false : null;
        base.session = !!shownThisSession[rid];
        base.busy = !!(NC.ui && NC.ui.openCount && NC.ui.openCount() > 0);
        var d = shouldSuggest(base);
        if (!d.show || !NC.ui || !NC.ui.sheet) return 'skipped:' + (d.show ? 'no_ui' : d.reason);
        shownThisSession[rid] = true;
        injectStyle();
        var body = '<p class="mk-bm-sug__text">' + esc(n ? t('bm.sug.text', { size: fmtBytes(n) }) : t('bm.sug.text_nosize')) + '</p>' +
          '<p class="mk-bm-sug__note">' + esc(t('bm.sug.note')) + '</p>';
        NC.ui.sheet({
          title: t('bm.sug.title'), icon: 'map', size: 'sm', body: body, className: 'mk-bm-sug',
          actions: [
            {
              label: t('bm.sug.later'), variant: 'ghost', onClick: function () {
                if (!kvOk()) return undefined;
                return laterMap().then(function (m) { m[rid] = new Date().toISOString(); return NC.store.set(KV_LATER, m); }).catch(function () { });
              }
            },
            { label: t('bm.sug.now'), variant: 'primary', icon: 'download', autofocus: true, onClick: function () { return downloadWithFeedback(rid); } }
          ]
        });
        return 'shown';
      });
    });
  }

  var api = {
    CACHE: CACHE, DIR: DIR, ATTRIBUTION: ATTRIBUTION,
    ids: ids, supported: supported, url: fileUrl,
    status: status, list: list, size: size, download: download, downloadWithFeedback: downloadWithFeedback,
    remove: remove, removeWithFeedback: removeWithFeedback, load: load, layer: layer, attach: attach, suggestIfNeeded: suggestIfNeeded,
    pure: {
      validate: validate, shouldSuggest: shouldSuggest, layoutLabels: layoutLabels, refLabels: refLabels,
      lineBoxes: lineBoxes, coversView: coversView, weightFor: weightFor, minZoom: minZoom, roadClass: roadClass, waterClass: waterClass
    }
  };
  NC.basemap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
