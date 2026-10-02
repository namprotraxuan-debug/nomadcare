/*
 * geo-online.js — NC.geoOnline: search any place in Vietnam (Nominatim) and route to it (FOSSGIS OSRM) when ONLINE
 * (round 2 R4, MOD.02 hybrid routing). Owner: W4 (MOD.02).
 * Usage policy of the public OpenStreetMap services, enforced here for every caller:
 *   - at most 1 request per second across search + route (one global queue), no request without the user's
 *     acceptance (NC.settings 'online_geo_ok', asked once by MOD.02), identical requests are answered from an
 *     in-memory cache;
 *   - search is SUBMIT-ONLY: callers send a query only on an explicit user action (Enter, or a tap on the "Tìm …"
 *     row). Never per keystroke and never on a typing pause / debounce timer — the Nominatim usage policy forbids
 *     client-side autocomplete (PLAN R4). Do not add an auto-search here or in MOD.02;
 *   - a newer search (or route) aborts the previous one (AbortController), every request has a timeout;
 *   - the browser sends the Referer (origin only: strict-origin-when-cross-origin); no cookies (credentials omit).
 * Privacy: search sends only the typed text (never the position); a route sends the two end points (rounded to
 * 5 decimals ≈ 1 m). Endpoints live in config.js (nominatimUrl, osrmCarUrl, osrmFootUrl).
 * Public API: NC.geoOnline = {available(), consented(), accept(), revoke(), search(q, opts) → Promise<[place]>,
 *   route(a, b, mode, opts) → Promise<route>, cached(kind, …), abort(kind), attribution(kind), pure}
 *   place = {id, name, label, lat, lng, type, category, rank}; route = {geometry:[[lat,lng]…], distance_km,
 *   duration_min, profile, source:'osrm'}. Errors reject with Error{code: 'consent'|'offline'|'timeout'|'aborted'|
 *   'rate'|'http'|'parse'|'no_route'|'unsupported', status?}.
 * The pure helpers (URL building, response parsing, polyline simplification, rate limiter, LRU cache) are
 * NC.geoOnline.pure and module.exports for tools/tests/geo-online.test.js.
 */
(function (root) {
  'use strict';

  var NC = root.NC = root.NC || {};

  /* ================================================================== */
  /* PURE                                                                 */
  /* ================================================================== */
  var DEFAULTS = {
    nominatimUrl: 'https://nominatim.openstreetmap.org/search',
    osrmCarUrl: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    osrmFootUrl: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'
  };
  var GAP_MS = 1100;               // ≥ 1 request / s (a little margin for clock jitter)
  var SEARCH_TIMEOUT_MS = 10000;
  var ROUTE_TIMEOUT_MS = 15000;
  var VN_BBOX = [8.0, 102.0, 23.6, 110.0]; // south, west, north, east (+ margin; countrycodes=vn does the real filter)

  function err(code, extra) {
    var e = new Error(code);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function r5(v) { return Math.round(+v * 1e5) / 1e5; }
  function llOf(p) {
    if (!p) return null;
    if (Array.isArray(p)) return isFinite(p[0]) && isFinite(p[1]) ? [+p[0], +p[1]] : null;
    return isFinite(p.lat) && isFinite(p.lng) && p.lat !== null && p.lng !== null ? [+p.lat, +p.lng] : null;
  }
  /** Cache key of a query: trimmed, lower-cased, single spaces (diacritics kept: "Đà Lạt" ≠ "Da Lat" for Nominatim). */
  function normQuery(q) { return String(q || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  /**
   * Nominatim search URL (format=jsonv2, countrycodes=vn, accept-language=vi,en, limit=8).
   * @param {string} base e.g. 'https://nominatim.openstreetmap.org/search'
   * @param {string} q @param {{limit?:number, lang?:string}} [o]
   */
  function searchUrl(base, q, o) {
    o = o || {};
    var lim = Math.max(1, Math.min(20, +o.limit || 8));
    return String(base || DEFAULTS.nominatimUrl) + '?format=jsonv2&countrycodes=vn&accept-language=' + encodeURIComponent(o.lang || 'vi,en') +
      '&limit=' + lim + '&q=' + encodeURIComponent(String(q || '').replace(/\s+/g, ' ').trim());
  }
  /** OSRM route URL: {base}/{lng,lat;lng,lat}?overview=full&geometries=geojson (coordinates rounded to 5 decimals). */
  function routeUrl(base, a, b) {
    var p = llOf(a), q = llOf(b);
    if (!p || !q) throw err('parse');
    return String(base) + '/' + r5(p[1]) + ',' + r5(p[0]) + ';' + r5(q[1]) + ',' + r5(q[0]) + '?overview=full&geometries=geojson';
  }
  /** OSRM profile base URL of a travel mode: motorbike → driving (car profile), hiking → foot. */
  function profileBase(cfg, mode) {
    cfg = cfg || {};
    return mode === 'hiking' ? (cfg.osrmFootUrl || DEFAULTS.osrmFootUrl) : (cfg.osrmCarUrl || DEFAULTS.osrmCarUrl);
  }

  /**
   * Nominatim jsonv2 → places (inside Vietnam, valid coordinates, de-duplicated by OSM id).
   * @returns {Array<{id, name, label, lat, lng, type, category, rank}>}
   */
  function parseSearch(json) {
    if (!Array.isArray(json)) throw err('parse');
    var seen = {}, out = [];
    json.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      if (!isFinite(lat) || !isFinite(lng)) return;
      if (lat < VN_BBOX[0] || lat > VN_BBOX[2] || lng < VN_BBOX[1] || lng > VN_BBOX[3]) return;
      var id = 'osm:' + String(r.osm_type || 'x').charAt(0) + String(r.osm_id || r.place_id || (lat + ',' + lng));
      if (seen[id]) return;
      seen[id] = 1;
      var label = String(r.display_name || '').replace(/,\s*(Việt Nam|Vietnam)\s*$/i, '').replace(/,\s*\d{5,6}\s*$/, '').trim();
      var name = String(r.name || '').trim() || label.split(',')[0].trim();
      if (!name) return;
      var rest = label.indexOf(name) === 0 ? label.slice(name.length).replace(/^\s*,\s*/, '') : label;
      out.push({
        id: id, name: name, label: label, area: rest, lat: lat, lng: lng,
        type: String(r.addresstype || r.type || ''), category: String(r.category || r['class'] || ''),
        rank: isFinite(r.place_rank) ? +r.place_rank : null
      });
    });
    return out;
  }

  /**
   * OSRM /route response → {geometry [[lat,lng]…], distance_km, duration_min}. Throws code 'no_route' when OSRM found
   * nothing (code NoRoute / NoSegment / empty routes) and 'parse' for anything malformed.
   */
  function parseRoute(json) {
    if (!json || typeof json !== 'object') throw err('parse');
    if (json.code && json.code !== 'Ok') throw err(/^No(Route|Segment|Match|Trips)$/.test(json.code) ? 'no_route' : 'parse', { osrm: json.code });
    var rt = json.routes && json.routes[0];
    if (!rt) throw err('no_route');
    var coords = rt.geometry && rt.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) throw err('parse');
    var g = [];
    for (var i = 0; i < coords.length; i++) {
      var c = coords[i];
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) throw err('parse');
      g.push([+c[1], +c[0]]);
    }
    return { geometry: g, distance_km: (+rt.distance || 0) / 1000, duration_min: (+rt.duration || 0) / 60 };
  }

  /* Perpendicular distance (km) of p from segment a–b on a local equirectangular plane. */
  function segDistKm(p, a, b) {
    var kx = Math.cos(p[0] * Math.PI / 180) * 111.32, ky = 110.574;
    var ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 1e-18 ? -(ax * dx + ay * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var x = ax + dx * t, y = ay + dy * t;
    return Math.sqrt(x * x + y * y);
  }
  /**
   * Douglas–Peucker simplification (iterative, keeps both ends).
   * @param {Array<Array<number>>} pts [[lat,lng]…] @param {number} tolKm e.g. 0.01 (10 m)
   */
  function simplify(pts, tolKm) {
    var n = pts ? pts.length : 0;
    if (n <= 2) return (pts || []).slice();
    var keep = new Array(n);
    keep[0] = keep[n - 1] = true;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var s = stack.pop(), a = s[0], b = s[1], best = -1, bestD = 0;
      for (var i = a + 1; i < b; i++) {
        var d = segDistKm(pts[i], pts[a], pts[b]);
        if (d > bestD) { bestD = d; best = i; }
      }
      if (best > 0 && bestD > tolKm) { keep[best] = true; stack.push([a, best], [best, b]); }
    }
    var out = [];
    for (var j = 0; j < n; j++) if (keep[j]) out.push(pts[j]);
    return out;
  }
  /** Simplify until at most maxPts points (tolerance grows ×1.6 from tolKm); even decimation as a last resort. */
  function simplifyTo(pts, maxPts, tolKm) {
    var max = Math.max(2, maxPts || 600);
    var tol = tolKm > 0 ? tolKm : 0.005;
    var out = (pts || []).slice();
    for (var k = 0; out.length > max && k < 16; k++) { out = simplify(pts, tol); tol *= 1.6; }
    if (out.length > max) {
      var step = (out.length - 1) / (max - 1), dec = [];
      for (var i = 0; i < max; i++) dec.push(out[Math.round(i * step)]);
      out = dec;
    }
    return out;
  }

  /**
   * Global request pacing: tasks start one at a time, at least gapMs apart. clock = {now(), setTimeout, clearTimeout}
   * (injectable for tests). schedule(fn, signal) → Promise of fn()'s result; an aborted signal drops a queued task.
   */
  function makeLimiter(gapMs, clock) {
    clock = clock || { now: function () { return Date.now(); }, setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (h) { clearTimeout(h); } };
    var gap = gapMs > 0 ? gapMs : GAP_MS;
    var last = -Infinity, queue = [], timer = null, running = false;
    function pump() {
      timer = null;
      if (running) return;
      while (queue.length && queue[0].signal && queue[0].signal.aborted) queue.shift().reject(err('aborted'));
      if (!queue.length) return;
      var wait = last + gap - clock.now();
      if (wait > 0) { timer = clock.setTimeout(pump, wait); return; }
      var job = queue.shift();
      last = clock.now();
      running = true;
      var p;
      try { p = Promise.resolve(job.fn()); } catch (e) { p = Promise.reject(e); }
      p.then(function (v) { running = false; job.resolve(v); kick(); }, function (e) { running = false; job.reject(e); kick(); });
    }
    function kick() { if (!timer && !running) pump(); }
    return {
      schedule: function (fn, signal) {
        return new Promise(function (resolve, reject) {
          if (signal && signal.aborted) { reject(err('aborted')); return; }
          queue.push({ fn: fn, signal: signal || null, resolve: resolve, reject: reject });
          if (signal && signal.addEventListener) signal.addEventListener('abort', function () { if (timer) { clock.clearTimeout(timer); timer = null; } kick(); });
          kick();
        });
      },
      pending: function () { return queue.length + (running ? 1 : 0); },
      lastAt: function () { return last; }
    };
  }

  /** Small LRU (Map-free for old engines): get/set, oldest dropped past max entries. */
  function lru(max) {
    var keys = [], vals = {};
    return {
      get: function (k) {
        if (!Object.prototype.hasOwnProperty.call(vals, k)) return undefined;
        keys.splice(keys.indexOf(k), 1); keys.push(k);
        return vals[k];
      },
      set: function (k, v) {
        if (Object.prototype.hasOwnProperty.call(vals, k)) keys.splice(keys.indexOf(k), 1);
        keys.push(k); vals[k] = v;
        while (keys.length > (max || 50)) delete vals[keys.shift()];
      },
      size: function () { return keys.length; }
    };
  }
  /** Cache key of a route: profile + both ends rounded to 4 decimals (≈ 11 m). */
  function routeKey(a, b, mode) {
    var p = llOf(a), q = llOf(b);
    if (!p || !q) return null;
    var f = function (v) { return (Math.round(v * 1e4) / 1e4).toFixed(4); };
    return (mode === 'hiking' ? 'foot' : 'car') + '|' + f(p[0]) + ',' + f(p[1]) + '|' + f(q[0]) + ',' + f(q[1]);
  }

  var pure = {
    DEFAULTS: DEFAULTS, GAP_MS: GAP_MS, normQuery: normQuery, searchUrl: searchUrl, routeUrl: routeUrl, profileBase: profileBase,
    parseSearch: parseSearch, parseRoute: parseRoute, simplify: simplify, simplifyTo: simplifyTo, makeLimiter: makeLimiter,
    lru: lru, routeKey: routeKey, err: err
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;
  if (!root.document) { NC.geoOnline = NC.geoOnline || { pure: pure }; return; }

  /* ================================================================== */
  /* RUNTIME (browser)                                                    */
  /* ================================================================== */
  var CONSENT_KEY = 'online_geo_ok';
  var limiter = makeLimiter(GAP_MS);
  var searchCache = lru(40), routeCache = lru(20);
  var ctl = { search: null, route: null };

  function cfg() {
    var c = root.NC_CONFIG || {};
    return { nominatimUrl: c.nominatimUrl || DEFAULTS.nominatimUrl, osrmCarUrl: c.osrmCarUrl || DEFAULTS.osrmCarUrl, osrmFootUrl: c.osrmFootUrl || DEFAULTS.osrmFootUrl };
  }
  function online() { return NC.net ? NC.net.online() : navigator.onLine !== false; }
  function supported() { return typeof root.fetch === 'function'; }
  function consented() { return !!(NC.settings && NC.settings.get(CONSENT_KEY) === true); }

  /** Fetch JSON through the global queue, with its own AbortController (aborted by a newer call of the same kind). */
  function request(kind, url, timeoutMs, external) {
    if (!supported()) return Promise.reject(err('unsupported'));
    if (!consented()) return Promise.reject(err('consent'));
    if (!online()) return Promise.reject(err('offline'));
    if (ctl[kind]) { try { ctl[kind].abort(); } catch (e) { /* ignore */ } }
    var ac = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    ctl[kind] = ac;
    if (external && ac) {
      if (external.aborted) ac.abort();
      else if (external.addEventListener) external.addEventListener('abort', function () { ac.abort(); });
    }
    var sig = ac ? ac.signal : null;
    var timedOut = false;
    return limiter.schedule(function () {
      if (sig && sig.aborted) throw err('aborted');
      if (!online()) throw err('offline');
      var tm = setTimeout(function () { timedOut = true; if (ac) ac.abort(); }, timeoutMs);
      return root.fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', signal: sig || undefined })
        .then(function (res) {
          if (res.status === 429) throw err('rate', { status: 429 });
          if (!res.ok) throw err('http', { status: res.status });
          return res.json().catch(function () { throw err('parse'); });
        })
        .then(function (j) { clearTimeout(tm); return j; }, function (e) {
          clearTimeout(tm);
          if (timedOut) throw err('timeout');
          if (e && (e.name === 'AbortError' || e.code === 'aborted')) throw err('aborted');
          if (e && e.code) throw e;
          throw err(online() ? 'http' : 'offline');
        });
    }, sig).then(function (j) { if (ctl[kind] === ac) ctl[kind] = null; return j; }, function (e) {
      if (ctl[kind] === ac) ctl[kind] = null;
      throw e;
    });
  }

  /**
   * Places in Vietnam matching q (Nominatim). opts: {signal, near:{lat,lng}} — `near` is NOT sent: it only adds
   * distance_km to each place for display.
   */
  function search(q, opts) {
    opts = opts || {};
    var key = normQuery(q);
    if (key.length < 2) return Promise.resolve([]);
    var hit = searchCache.get(key);
    var withDist = function (list) {
      var n = llOf(opts.near), R = NC.routing;
      return list.map(function (p) {
        var x = Object.assign({}, p);
        if (n && R && R.haversineKm) x.distance_km = R.haversineKm(n, [p.lat, p.lng]);
        return x;
      });
    };
    if (hit) return Promise.resolve(withDist(hit));
    return request('search', searchUrl(cfg().nominatimUrl, q, {}), SEARCH_TIMEOUT_MS, opts.signal).then(function (j) {
      var list = parseSearch(j);
      searchCache.set(key, list);
      return withDist(list);
    });
  }

  /**
   * Road route a → b for a travel mode (motorbike → OSRM car profile, hiking → foot profile). The geometry is
   * simplified to ~10 m (drawing + signal overlay); opts.signal aborts.
   */
  function route(a, b, mode, opts) {
    opts = opts || {};
    var key = routeKey(a, b, mode);
    if (!key) return Promise.reject(err('parse'));
    var hit = routeCache.get(key);
    if (hit) return Promise.resolve(hit);
    var url;
    try { url = routeUrl(profileBase(cfg(), mode), a, b); } catch (e) { return Promise.reject(e); }
    return request('route', url, ROUTE_TIMEOUT_MS, opts.signal).then(function (j) {
      var r = parseRoute(j);
      var out = {
        geometry: simplify(r.geometry, 0.01), distance_km: r.distance_km, duration_min: r.duration_min,
        profile: mode === 'hiking' ? 'foot' : 'car', source: 'osrm', key: key, at: new Date().toISOString()
      };
      routeCache.set(key, out);
      return out;
    });
  }

  NC.geoOnline = {
    /** Online services usable right now (network + fetch; consent is checked separately). */
    available: function () { return supported() && online(); },
    consented: consented,
    /** Remember the user's acceptance (the one-line consent before the first online search / route). */
    accept: function () { return NC.settings ? NC.settings.set(CONSENT_KEY, true) : Promise.resolve(); },
    revoke: function () { return NC.settings ? NC.settings.set(CONSENT_KEY, false) : Promise.resolve(); },
    search: search,
    route: route,
    /** Cached result without any request: cached('search', q) / cached('route', a, b, mode). */
    cached: function (kind, a, b, mode) {
      if (kind === 'search') return searchCache.get(normQuery(a)) || null;
      var k = routeKey(a, b, mode);
      return k ? routeCache.get(k) || null : null;
    },
    abort: function (kind) {
      ['search', 'route'].forEach(function (k) { if ((!kind || kind === k) && ctl[k]) { try { ctl[k].abort(); } catch (e) { /* ignore */ } } });
    },
    busy: function () { return limiter.pending() > 0; },
    pure: pure
  };
})(typeof window !== 'undefined' ? window : globalThis);
