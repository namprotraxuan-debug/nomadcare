/*
 * mapkit.js — NC.mapkit: Leaflet helpers shared by MOD.02 (map), MOD.04 (buddy) and the admin dashboard (owner: P1 data).
 * Public API: create, drawRoute, drawEdges, poiMarker, userMarker, fitTo, heatLayer, refresh, iconFor, levelColor, rsrpColor,
 * isDark, basemap, rasterState, setCover, releaseTiles. Basemap CARTO Voyager (light) / Dark Matter (dark) swapped on theme change
 * (keyless CARTO URL → OSM fallback, see OSM_TILES); tiles are requested with referrerPolicy
 * 'strict-origin-when-cross-origin' (OSM blocks requests without a Referer). Offline (real or simulated) the basemap
 * stays on and reads tiles straight from the service worker's tile cache; the notice appears only when visible tiles
 * actually fail. Online, blocked / failing raster tiles are detected (tileerror burst, a tile image that is not a
 * 256 px square, probes of newly loaded tiles (≤ 1 per 5 s) against the known OSM "Access blocked" / CARTO "API key
 * required" images, or the worker's 'x-nc-tile: blocked' answer) → the raster layer is hidden with a notice, and
 * NC.basemap (vector, offline) can cover the map (setCover). 'failed' re-tests one tile with a backoff and recovers. Map event 'nc:basemap' {state, online, cover, causedByCover} on every change of
 * rasterState() — state 'ok'|'offline'|'blocked'|'failed'|'none'. Maps re-measure themselves (ResizeObserver) and skip
 * zoom/fade animations under prefers-reduced-motion. Styles use tokens.css variables. Signal levels: likely /
 * uncertain / lost + 'unknown' (no signal data, grey).
 */
(function (NC) {
  'use strict';

  var ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
  var DEFAULT_TILES = {
    light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
  };
  /*
   * Since 23/09/2026 CARTO serves an "API key required" watermark unless the tile URL carries ?key=… (free key,
   * requested by a person at carto.com/basemaps/apikey). A keyless CARTO URL therefore falls back to the standard
   * OpenStreetMap tiles (light use, attribution kept; dark theme = CSS filter on the tile pane). Adding the key to
   * NC_CONFIG.tiles restores CARTO Voyager / Dark Matter automatically.
   */
  var OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  var DEFAULT_CENTER = [16.2, 107.8]; // Vietnam
  var TILE_ERROR_LIMIT = 4;
  var TILE_CACHE = 'nc-tiles-v2'; // sw.js stale-while-revalidate cache of viewed basemap tiles (same name as sw.js TILE_CACHE)
  var HIT = 44;                // minimum marker hit area on touch screens (contract: touch targets ≥ 44 px)
  var REFERRER_POLICY = 'strict-origin-when-cross-origin';
  var SUSPECT_LIMIT = 3;       // tiles that decode to something other than a ≥128 px square → treated as blocked
  var PROBE_GAP_MS = 5000;     // at most one probe of a newly loaded tile per 5 s (a block may start mid-session)
  var PROBE_SEEN_MAX = 400;    // probed tile URLs remembered per layer (then the memo restarts)
  var RETRY_MS = [30000, 60000, 120000, 300000]; // 'failed' (tile errors online): re-test one tile with this backoff
  /* Byte length → SHA-256 of the known "not a map" tiles (OSM "Access blocked", CARTO "API KEY REQUIRED" light/dark).
     Same list as sw.js BLOCK_TILES. */
  var BLOCK_TILES = {
    6987: ['b02c44252dac5a5e820ecef1e9bf9200e9407c042df668a466a1aa81a9ecca7a'],
    2049: ['69be4aecf9f814ba45d585801a5aa41e79b16fc88eafec5b1954a9f06a69e6be'],
    2513: ['cc3f31364a735d9a8179af36b3db7617cdff8bdb0248654ebcc3df91607abedc']
  };

  /** POI type → icon name in the NC.ui sprite. */
  var ICONS = {
    benh_vien: 'hospital', tram_y_te: 'cross', phong_kham: 'cross', nha_thuoc: 'pill',
    lodging: 'bed', repair: 'wrench', fuel: 'fuel', rental: 'bike'
  };
  var MEDICAL = { benh_vien: 1, tram_y_te: 1, phong_kham: 1, nha_thuoc: 1 };
  /** Non-colour cue per level (colour-blind safe): likely solid, uncertain long dash, lost dots, unknown dash-dot
      (dashFor; distinct from the grey dotted alternative route drawn by MOD.02). */
  var DASH = { likely: null, uncertain: '10 8', lost: '1 9' };
  /* Dash pattern of a level at line width w. 'unknown' = dash-dot sized for round caps (each dash grows by w). */
  function dashFor(lvl, w) {
    if (lvl !== 'unknown') return DASH[lvl] || null;
    var g = Math.round(w * 2);
    return Math.round(w * 1.4) + ' ' + g + ' 0.1 ' + g;
  }

  /* ---------------------------------------------------------------- i18n */

  if (NC.i18n && NC.i18n.add) {
    NC.i18n.add({
      vi: {
        'mk.basemap_offline': 'Bản đồ nền cần mạng — lớp dữ liệu offline vẫn hiển thị',
        'mk.basemap_partial': 'Một phần bản đồ nền chưa được lưu offline — lớp dữ liệu offline vẫn hiển thị',
        'mk.basemap_blocked': 'Không tải được ảnh nền bản đồ — lớp dữ liệu offline vẫn hiển thị',
        'mk.basemap_vector': 'Đang dùng nền bản đồ offline',
        'mk.you_are_here': 'Vị trí của bạn',
        'mk.partner': 'Đối tác',
        'mk.stale': 'Cần xác minh lại'
      },
      en: {
        'mk.basemap_offline': 'Basemap needs a connection — offline data layers are still shown',
        'mk.basemap_partial': 'Part of the basemap is not saved offline — offline data layers are still shown',
        'mk.basemap_blocked': "Couldn't load the basemap images — offline data layers are still shown",
        'mk.basemap_vector': 'Showing the offline basemap',
        'mk.you_are_here': 'Your location',
        'mk.partner': 'Partner',
        'mk.stale': 'Needs re-verification'
      }
    });
  }

  function t(key, fallback) {
    try { if (NC.i18n && NC.i18n.t) { var s = NC.i18n.t(key); if (s && s !== key) return s; } } catch (e) { /* ignore */ }
    return fallback;
  }
  function esc(s) {
    if (NC.util && NC.util.esc) return NC.util.esc(s);
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function icon(name) {
    if (NC.ui && NC.ui.icon) return NC.ui.icon(name);
    return '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-' + esc(name) + '"></use></svg>';
  }
  function online() { try { return NC.net && NC.net.online ? NC.net.online() : navigator.onLine !== false; } catch (e) { return true; } }
  function mq(q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } }
  function reducedMotion() { return mq('(prefers-reduced-motion: reduce)'); }
  function coarsePointer() { return mq('(pointer: coarse)'); }
  /* Cache Storage (secure contexts only; absent on file:// and plain http hosts other than localhost). */
  function cacheApi() {
    try { return typeof window.caches !== 'undefined' && window.caches && typeof window.caches.open === 'function' ? window.caches : null; } catch (e) { return null; }
  }
  function onBus(evt, fn) { return NC.bus && NC.bus.on ? NC.bus.on(evt, fn) : function () { }; }

  /* ---------------------------------------------------------------- styles (injected once) */

  var CSS = [
    '.mk-map{background:var(--c-surface-2);font-family:var(--font-sans);}',
    '.mk-map.mk-offline{background-color:var(--c-surface-2);background-image:linear-gradient(var(--c-border) 1px,transparent 1px),linear-gradient(90deg,var(--c-border) 1px,transparent 1px);background-size:32px 32px;}',
    /* calmer OSM standard style: muted colours + softer contrast so the signal / route colours stay the loudest thing */
    '.mk-map--osm .leaflet-tile-pane{-webkit-filter:saturate(.35) contrast(.9) brightness(1.05);filter:saturate(.35) contrast(.9) brightness(1.05);}',
    '.mk-map--invert .leaflet-tile-pane{-webkit-filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.84) saturate(.35);filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.84) saturate(.35);}',
    '.mk-map .leaflet-control-attribution{background:var(--c-surface);color:var(--c-muted);font-size:var(--fs-xs);line-height:1.4;border-radius:var(--r-sm) 0 0 0;opacity:.92;}',
    '.mk-map .leaflet-control-attribution a{color:var(--c-primary-strong);}',
    '.mk-map .leaflet-bar{border:0;box-shadow:var(--sh-2);border-radius:var(--r-md);overflow:hidden;}',
    '.mk-map .leaflet-bar a{background:var(--c-surface);color:var(--c-text);border-bottom-color:var(--c-border);width:36px;height:36px;line-height:36px;}',
    '@media (pointer: coarse){.mk-map .leaflet-bar a{width:44px;height:44px;line-height:44px;font-size:22px;}}',
    '.mk-map .leaflet-bar a:hover,.mk-map .leaflet-bar a:focus-visible{background:var(--c-surface-2);color:var(--c-primary-strong);}',
    '.mk-map .leaflet-popup-content-wrapper,.mk-map .leaflet-popup-tip{background:var(--c-surface);color:var(--c-text);box-shadow:var(--sh-3);}',
    '.mk-map .leaflet-popup-content-wrapper{border-radius:var(--r-md);}',
    '.mk-map .leaflet-tooltip{background:var(--c-surface);color:var(--c-text);border-color:var(--c-border);box-shadow:var(--sh-1);border-radius:var(--r-sm);}',
    '.mk-notice{position:absolute;z-index:500;top:var(--sp-3);left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 112px);display:none;align-items:center;gap:var(--sp-2);',
    'padding:6px var(--sp-3);border-radius:var(--r-md);background:var(--c-warning-soft);color:var(--c-text);border:1px solid var(--c-warning);font-size:var(--fs-xs);line-height:1.35;font-weight:600;box-shadow:var(--sh-2);pointer-events:none;}',
    '.mk-notice .icon{width:16px;height:16px;flex:none;color:var(--c-warning);}',
    '.mk-notice--info{background:var(--c-surface);border-color:var(--c-border-strong);font-weight:600;}',
    '.mk-notice--info .icon{color:var(--c-info);}',
    '.mk-offline .mk-notice,.mk-map .mk-notice.is-on{display:flex;}',
    '.mk-map.mk-map--vector.mk-offline{background-image:none;}',
    '.mk-route--unknown{stroke:var(--c-muted);}',
    '.mk-route-casing{stroke:var(--c-surface);}',
    '.mk-route--likely{stroke:var(--sig-likely);}',
    '.mk-route--uncertain{stroke:var(--sig-uncertain);}',
    '.mk-route--lost{stroke:var(--sig-lost);}',
    '.mk-route--muted{stroke:var(--c-muted);}',
    '.mk-poi-wrap{background:none;border:0;}',
    '.mk-poi-wrap--hit{display:flex;align-items:center;justify-content:center;}',
    '.leaflet-marker-icon.mk-poi-wrap--culled{display:none !important;}',
    '.mk-poi{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;color:var(--c-on-primary);background:var(--c-primary);',
    'border:2px solid var(--c-surface);box-shadow:var(--sh-2);box-sizing:border-box;transition:transform var(--dur-1) var(--ease);}',
    '.mk-poi .icon{width:58%;height:58%;}',
    '.mk-poi--service{border-radius:var(--r-sm);}',
    '.mk-poi--benh_vien{background:var(--c-danger);color:var(--c-on-danger);}',
    '.mk-poi--tram_y_te{background:var(--c-primary);}',
    '.mk-poi--phong_kham{background:var(--c-info);color:var(--c-on-primary);}',
    '.mk-poi--nha_thuoc{background:var(--c-success);color:var(--c-on-primary);}',
    '.mk-poi--lodging{background:var(--c-accent);color:var(--c-on-accent);}',
    '.mk-poi--repair{background:var(--c-text-2);color:var(--c-surface);}',
    '.mk-poi--fuel{background:var(--c-warning);color:var(--c-text);}',
    '.mk-poi--rental{background:var(--c-info-strong);color:var(--c-on-primary);}',
    '.mk-poi--stale{box-shadow:0 0 0 2px var(--c-warning),var(--sh-2);}',
    '.mk-poi--selected{transform:scale(1.18);box-shadow:0 0 0 3px var(--c-focus),var(--sh-3);}',
    '.mk-poi__badge{position:absolute;top:-4px;right:-4px;width:12px;height:12px;border-radius:50%;background:var(--c-accent);border:2px solid var(--c-surface);}',
    '.leaflet-marker-icon:hover .mk-poi,.leaflet-marker-icon:focus-visible .mk-poi{transform:scale(1.12);}',
    '.leaflet-marker-icon:focus-visible{outline:none;}',
    '.leaflet-marker-icon:focus-visible .mk-poi{box-shadow:0 0 0 3px var(--c-focus),var(--sh-2);}',
    '.mk-user{position:relative;display:block;width:100%;height:100%;}',
    '.mk-user__dot{position:absolute;top:3px;right:3px;bottom:3px;left:3px;border-radius:50%;background:var(--c-info);border:3px solid var(--c-surface);box-shadow:var(--sh-2);}',
    '.mk-user__pulse{position:absolute;top:-10px;right:-10px;bottom:-10px;left:-10px;border-radius:50%;background:var(--c-info);opacity:.28;animation:mk-pulse 2s var(--ease) infinite;}',
    '@keyframes mk-pulse{0%{transform:scale(.4);opacity:.45;}70%{transform:scale(1);opacity:0;}100%{transform:scale(1);opacity:0;}}',
    '@media (prefers-reduced-motion: reduce){.mk-user__pulse{animation-duration:.01ms;animation-iteration-count:1;opacity:.18;}.mk-poi{transition-duration:.01ms;}}'
  ].join('\n');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById('nc-mapkit-style')) return;
    var st = document.createElement('style');
    st.id = 'nc-mapkit-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------------------------------------------------------- theme + colour tokens */

  function isDark() {
    var th = document.documentElement.getAttribute('data-theme');
    if (th === 'dark') return true;
    if (th === 'light') return false;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }

  function tileUrl(dark) {
    var tiles = (window.NC_CONFIG && window.NC_CONFIG.tiles) || DEFAULT_TILES;
    return dark ? (tiles.dark || DEFAULT_TILES.dark) : (tiles.light || DEFAULT_TILES.light);
  }

  /**
   * Effective basemap for a theme: the configured URL, or the OSM fallback when it is a keyless CARTO URL.
   * @param {boolean} dark
   * @returns {{provider:'carto'|'osm'|'custom', url:string, attribution:string, subdomains:string, maxZoom:number, invert:boolean}}
   */
  function basemap(dark) {
    var url = tileUrl(dark);
    var carto = /(^|[/.])basemaps\.cartocdn\.com\//.test(url);
    if (carto && !/[?&](key|api_key)=[^&]+/.test(url)) {
      return { provider: 'osm', url: OSM_TILES, attribution: OSM_ATTRIBUTION, subdomains: 'abc', maxZoom: 19, invert: !!dark };
    }
    return {
      provider: carto ? 'carto' : 'custom', url: url, attribution: carto ? ATTRIBUTION : OSM_ATTRIBUTION,
      subdomains: carto ? 'abcd' : 'abc', maxZoom: carto ? 20 : 19, invert: false
    };
  }

  /** Resolved value of a CSS custom property on :root (e.g. '--sig-lost' → '#E5484D'). */
  function token(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null; } catch (e) { return null; }
  }

  /** Current colour for a signal level (resolved from tokens; used for canvas layers that ignore CSS). */
  function levelColor(level) {
    // 'unknown' (no signal data, e.g. an online route outside the pilot corridors) and anything else → grey
    return token(level === 'likely' ? '--sig-likely' : level === 'lost' ? '--sig-lost' : level === 'uncertain' ? '--sig-uncertain' : '--c-muted');
  }

  function parseColor(c) {
    if (!c) return null;
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (m) {
      var h = m[1].length === 3 ? m[1].replace(/./g, function (x) { return x + x; }) : m[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function mix(a, b, f) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }

  /**
   * Continuous colour for an RSRP value: −125 dBm (lost) → −110 (uncertain) → −95 (likely). null/none → lost.
   * @param {number|null} rsrp
   * @param {string} [level] used when rsrp is missing
   */
  function rsrpColor(rsrp, level) {
    var lost = parseColor(levelColor('lost')), unc = parseColor(levelColor('uncertain')), ok = parseColor(levelColor('likely'));
    if (!lost || !unc || !ok) return levelColor(level || 'lost');
    if (rsrp === null || rsrp === undefined || !isFinite(rsrp)) return levelColor(level || 'lost');
    var v = Math.max(-125, Math.min(-95, +rsrp));
    return v <= -110 ? mix(lost, unc, (v + 125) / 15) : mix(unc, ok, (v + 110) / 15);
  }

  /* ---------------------------------------------------------------- map */

  function L() {
    if (!window.L) throw new Error('Leaflet is not loaded');
    return window.L;
  }

  /**
   * Create a Leaflet map with the themed basemap, offline notice and cleanup on map.remove().
   * @param {HTMLElement|string} el
   * @param {{center?:number[], zoom?:number, interactive?:boolean, basemap?:boolean, zoomControl?:boolean, minZoom?:number, maxZoom?:number, holdTiles?:boolean}} [opts]
   *   holdTiles: no raster tile is requested until releaseTiles(map) — for a caller that frames the map (fitBounds)
   *   right after creating it, so no tile set is fetched for the provisional center / zoom (OSM tile usage).
   * @returns {L.Map}
   */
  function create(el, opts) {
    opts = opts || {};
    injectStyle();
    var Lf = L();
    var interactive = opts.interactive !== false;
    // Reduced motion: no zoom/fade/marker animations and no pan inertia (also avoids waiting on transitionend).
    var still = reducedMotion();
    function anim(k) { return opts[k] !== undefined ? !!opts[k] : !still; }
    var map = Lf.map(el, {
      center: opts.center || DEFAULT_CENTER,
      zoom: opts.zoom !== undefined ? opts.zoom : 6,
      minZoom: opts.minZoom || 3,
      maxZoom: opts.maxZoom || 19,
      zoomControl: opts.zoomControl !== undefined ? opts.zoomControl : interactive,
      attributionControl: true,
      dragging: interactive, touchZoom: interactive, scrollWheelZoom: interactive && opts.scrollWheelZoom !== false,
      doubleClickZoom: interactive, boxZoom: interactive, keyboard: interactive,
      zoomSnap: 0.5, worldCopyJump: false,
      zoomAnimation: anim('zoomAnimation'), fadeAnimation: anim('fadeAnimation'), markerZoomAnimation: anim('markerZoomAnimation'),
      inertia: anim('inertia')
    });
    var container = map.getContainer();
    container.classList.add('mk-map');
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    // blocked: raster tiles are "not a map" images (probe / worker / suspect sizes) → layer hidden until the network changes.
    // cover: another basemap (NC.basemap vector) is drawn instead of the raster layer (setCover).
    var st = map._nc = {
      dark: isDark(), tiles: null, errors: 0, tileFail: false, blocked: false, suspect: 0, probe: newProbe(), cover: null,
      offs: [], basemap: opts.basemap !== false, net: online(), lastSig: '', retryN: 0, retryT: null, hold: !!opts.holdTiles
    };

    var notice = document.createElement('div');
    notice.className = 'mk-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = icon('wifi-off') + '<span></span>';
    notice.lastChild.textContent = t('mk.basemap_offline', 'Basemap needs a connection — offline layers still shown');
    container.appendChild(notice);
    st.notice = notice;
    st.noticeKey = 'mk.basemap_offline';

    if (st.basemap) {
      setBasemap(map, basemap(st.dark));
    }
    syncOffline(map);

    function retheme() {
      var d = isDark();
      if (d === st.dark) return;
      st.dark = d;
      if (st.basemap) setBasemap(map, basemap(d));
      map.fire('nc:theme', { dark: d });
    }
    st.offs.push(onBus('theme:change', function () { setTimeout(retheme, 0); }));
    st.offs.push(onBus('net:change', function () {
      // Back online (or a first real connection): forget blocked / failing verdicts and let the tiles prove themselves again.
      if (online() && st.net === false) { st.blocked = false; st.tileFail = false; st.errors = 0; st.suspect = 0; resetProbe(st); clearRetry(st); }
      syncOffline(map);
    }));
    st.offs.push(onBus('i18n:change', function () { notice.lastChild.textContent = t(st.noticeKey, notice.lastChild.textContent); }));
    var mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      if (mq) {
        if (mq.addEventListener) mq.addEventListener('change', retheme); else if (mq.addListener) mq.addListener(retheme);
      }
    } catch (e) { mq = null; }
    var mo = null;
    if (window.MutationObserver) {
      mo = new MutationObserver(retheme);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    // Re-measure whenever the container's box changes (late layout, rotation, side panel, WebKit settling styles after
    // the first measurement). Leaflet only listens to window resize; a stale size frames the wrong area.
    var ro = null, roFrame = 0;
    if (window.ResizeObserver) {
      ro = new window.ResizeObserver(function () {
        if (roFrame) return;
        roFrame = requestAnimationFrame(function () { roFrame = 0; syncSize(map); });
      });
      ro.observe(container);
    }
    map.on('unload', function () {
      st.removed = true;
      if (st.noticeT) { clearTimeout(st.noticeT); st.noticeT = null; }
      resetProbe(st);
      clearRetry(st);
      if (ro) ro.disconnect();
      if (roFrame) cancelAnimationFrame(roFrame);
      st.offs.forEach(function (off) { try { off(); } catch (e) { /* ignore */ } });
      if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', retheme); else if (mq.removeListener) mq.removeListener(retheme); }
      if (mo) mo.disconnect();
    });
    return map;
  }

  /*
   * Tile layer that, while offline (real or simulated), reads tiles straight from the service worker's tile cache
   * (TILE_CACHE) instead of the network: already viewed tiles keep rendering (tiles are never pre-fetched — OSM tile
   * policy; the offline map is the NC.basemap vector layer), a simulated outage makes
   * no network request, and a missing tile is an ordinary tile error (counted for the notice). Online = stock layer.
   */
  var CachedTileLayer = null;
  function tileLayerClass() {
    if (CachedTileLayer) return CachedTileLayer;
    var Lf = L();
    CachedTileLayer = Lf.TileLayer.extend({
      createTile: function (coords, done) {
        var cs = cacheApi();
        if (online() || !cs) return Lf.TileLayer.prototype.createTile.call(this, coords, done);
        var self = this;
        var tile = document.createElement('img');
        var url = this.getTileUrl(coords);
        tile.alt = '';
        tile.setAttribute('role', 'presentation');
        Lf.DomEvent.on(tile, 'load', function () {
          if (tile._ncBlob) { try { URL.revokeObjectURL(tile._ncBlob); } catch (e) { /* ignore */ } tile._ncBlob = null; }
          self._tileOnLoad(done, tile);
        });
        Lf.DomEvent.on(tile, 'error', function (e) { self._tileOnError(done, tile, e); });
        var st = this._map && this._map._nc;
        var open = st && st.cacheP ? st.cacheP : cs.open(TILE_CACHE);
        if (st) st.cacheP = open;
        open.then(function (c) { return c.match(url, { ignoreVary: true }); }).then(function (res) {
          return res && res.status !== 504 ? res.blob() : null;
        }).then(function (blob) {
          if (!blob || !blob.size) throw new Error('tile not cached');
          tile._ncBlob = URL.createObjectURL(blob);
          tile.src = tile._ncBlob;
        }).catch(function (e) {
          if (st && open === st.cacheP && !(e && e.message === 'tile not cached')) st.cacheP = null; // retry opening next time
          self._tileOnError(done, tile, e);
        });
        return tile;
      }
    });
    return CachedTileLayer;
  }

  /*
   * (Re)build the raster basemap layer for a basemap() descriptor. Same provider → setUrl (keeps the layer and its
   * attribution); provider change → replace the layer so the attribution follows. Invert class = OSM dark fallback.
   */
  function setBasemap(map, bm) {
    var st = map._nc;
    map.getContainer().classList.toggle('mk-map--osm', bm.provider === 'osm');
    map.getContainer().classList.toggle('mk-map--invert', !!bm.invert);
    if (st.tiles && st.bm && st.bm.provider === bm.provider) {
      if (st.bm.url !== bm.url) st.tiles.setUrl(bm.url);
      st.bm = bm;
      return;
    }
    var wasOn = st.tiles && map.hasLayer(st.tiles);
    if (st.tiles) map.removeLayer(st.tiles);
    var Layer = tileLayerClass();
    // referrerPolicy: an extension / proxy / page-level "no-referrer" must not strip the Referer the OSM tile servers
    // require (they answer a Referer-less request with a 200 "Access blocked" image).
    var layer = new Layer(bm.url, {
      subdomains: bm.subdomains, maxZoom: bm.maxZoom, maxNativeZoom: bm.maxZoom, attribution: bm.attribution,
      crossOrigin: true, referrerPolicy: REFERRER_POLICY
    });
    layer.on('tileerror', function (e) {
      if (e && e.tile) e.tile._ncErr = true;
      if (online()) {
        st.errors++;
        if (st.errors >= TILE_ERROR_LIMIT && !st.tileFail) st.tileFail = true;
        queueProbe(st, e && e.tile);
        probeSoon(map, layer);
      }
      scheduleNotice(map);
    });
    layer.on('tileload', function (e) {
      var img = e && e.tile;
      if (img && suspectImage(img)) {
        // A "tile" that is not a map tile (e.g. a 1×1 or banner image from a blocking proxy): never show it — online,
        // and offline too (a placeholder cached by an older service worker would be drawn stretched over the map).
        img._ncErr = true;
        img.style.visibility = 'hidden';
        if (online()) {
          st.errors++;
          if (++st.suspect >= SUSPECT_LIMIT) st.blocked = true;
          if (st.errors >= TILE_ERROR_LIMIT) st.tileFail = true;
        }
        scheduleNotice(map);
        return;
      }
      if (img) img._ncErr = false;
      st.errors = 0;
      if (st.tileFail) { st.tileFail = false; clearRetry(st); }
      if (online()) { queueProbe(st, img); probeSoon(map, layer); }
      scheduleNotice(map);
    });
    layer.on('load', function () { scheduleNotice(map); });
    st.tiles = layer;
    st.bm = bm;
    st.errors = 0;
    st.suspect = 0;
    resetProbe(st);
    clearRetry(st);
    st.tileFail = false;
    st.blocked = false;
    if (wasOn) { layer.addTo(map); layer.bringToBack(); }
    scheduleNotice(map); // re-evaluate visibility (cover / offline) for the new layer
  }

  /* A loaded raster tile that is not a ≥ 128 px square cannot be a map tile (OSM / CARTO serve 256 / 512 px). */
  function suspectImage(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    return !!(w && h) && (w < 128 || h < 128 || w !== h);
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  /**
   * Is this tile body one of the known "not a map" images? OSM never sends its real tiles with no-cache (its block /
   * error tiles do); otherwise byte length + SHA-256 (length only where crypto.subtle is missing, i.e. insecure http).
   * @returns {Promise<boolean>}
   */
  function isBlockTile(buf, cacheControl, provider) {
    var n = buf ? buf.byteLength : 0;
    if (!n) return Promise.resolve(false);
    if (provider === 'osm' && /no-cache|no-store/i.test(cacheControl || '')) return Promise.resolve(true);
    var known = BLOCK_TILES[n];
    if (!known) return Promise.resolve(false);
    var subtle = null;
    try { subtle = window.crypto && window.crypto.subtle; } catch (e) { subtle = null; }
    if (!subtle) return Promise.resolve(provider === 'carto' || /no-cache/i.test(cacheControl || ''));
    return subtle.digest('SHA-256', buf).then(function (d) { return known.indexOf(hex(d)) >= 0; }, function () { return false; });
  }
  /*
   * Probing: re-read a tile the layer has just loaded (or failed) — from the HTTP cache / service worker (cache
   * 'force-cache'), so it normally costs no extra download — and check it against the known "not a map" images. An
   * "Access blocked" tile loads as a valid 256 px image, so without this the map would show it without any notice.
   * A block can start in the middle of a session (or only for new areas while older tiles come from the HTTP cache),
   * so newly loaded tiles keep being sampled: the newest tile of each burst, each URL once, at most one probe per
   * PROBE_GAP_MS (no new tiles → no probe).
   */
  function newProbe() { return { busy: false, last: 0, timer: null, seen: {}, n: 0, queue: [] }; }
  function resetProbe(st) {
    var p = st && st.probe;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    st.probe = newProbe();
  }
  function queueProbe(st, img) {
    var s = img && img.src;
    if (!s || !/^https?:/i.test(s) || !st.probe || st.probe.seen[s]) return;
    var q = st.probe.queue;
    if (q[q.length - 1] === s) return;
    q.push(s);
    if (q.length > 16) q.shift();
  }
  function probeSoon(map, layer) {
    var st = map._nc;
    if (!st || st.removed || st.blocked || !window.fetch) return;
    var p = st.probe;
    if (p.busy || p.timer || !p.queue.length) return;
    var wait = Math.max(300, p.last + PROBE_GAP_MS - Date.now());
    p.timer = setTimeout(function () { p.timer = null; probe(map, layer); }, wait);
  }
  /* The newest not-yet-probed tile loaded since the last probe (older ones of the same burst are skipped). */
  function nextProbe(p) {
    var s = null;
    while (p.queue.length && !s) {
      var x = p.queue.pop();
      if (!p.seen[x]) s = x;
    }
    p.queue.length = 0;
    return s;
  }
  function probe(map, layer) {
    var st = map._nc;
    if (!st || st.removed || st.tiles !== layer || !online() || st.blocked) return;
    var p = st.probe;
    var src = nextProbe(p);
    if (!src) return;
    if (++p.n > PROBE_SEEN_MAX) { p.seen = {}; p.n = 1; }
    p.seen[src] = 1;
    p.busy = true;
    p.last = Date.now();
    var provider = st.bm && st.bm.provider;
    function done() {
      if (st.probe !== p) return; // layer rebuilt / network changed meanwhile
      p.busy = false;
      if (!st.blocked) probeSoon(map, layer);
    }
    window.fetch(src, { mode: 'cors', credentials: 'same-origin', cache: 'force-cache', referrerPolicy: REFERRER_POLICY }).then(function (res) {
      var h = res.headers;
      if (h.get('x-nc-tile') === 'blocked' || h.get('x-blocked')) return true;
      if (!res.ok) return false;
      var cc = h.get('cache-control') || '';
      return res.arrayBuffer().then(function (buf) { return isBlockTile(buf, cc, provider); });
    }).then(function (blocked) {
      if (blocked && !st.removed && st.tiles === layer && st.probe === p) {
        st.blocked = true;
        syncOffline(map);
      }
      done();
    }).catch(function () { done(); /* network error: the tileerror count covers it */ });
  }

  /*
   * 'failed' (repeated tile errors online) can be a passing network hiccup. While it lasts — and especially while the
   * vector basemap covers the map, so no raster tile is requested — re-test ONE tile of the current view with a backoff
   * (RETRY_MS); when it loads as a real tile the raster layer comes back (and its failed tiles are requested again).
   */
  function clearRetry(st) {
    if (!st) return;
    if (st.retryT) { clearTimeout(st.retryT); st.retryT = null; }
    st.retryN = 0;
  }
  function scheduleRetry(map) {
    var st = map._nc;
    if (!st || st.removed || st.retryT || !st.tileFail || st.blocked || !st.tiles) return;
    var wait = RETRY_MS[Math.min(st.retryN, RETRY_MS.length - 1)];
    st.retryT = setTimeout(function () { st.retryT = null; retryTile(map); }, wait);
  }
  function viewTileUrl(map, bm) {
    var Lf = L();
    var z = Math.max(0, Math.min(bm.maxZoom || 19, Math.round(map.getZoom())));
    var c = map.project(map.getCenter(), z).divideBy(256).floor();
    var subs = bm.subdomains || 'abc';
    return Lf.Util.template(bm.url, {
      s: subs.charAt(Math.abs(c.x + c.y) % subs.length), z: z, x: c.x, y: c.y,
      r: Lf.Browser && Lf.Browser.retina ? '@2x' : ''
    });
  }
  function retryTile(map) {
    var st = map._nc;
    if (!st || st.removed || !st.tileFail || st.blocked || !st.tiles || !st.bm) return;
    // offline or a hidden page: try again later without spending the backoff step
    if (!online() || (document.visibilityState && document.visibilityState === 'hidden')) { scheduleRetry(map); return; }
    var url;
    try { url = viewTileUrl(map, st.bm); } catch (e) { return; }
    var layer = st.tiles, bm = st.bm;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    try { img.referrerPolicy = REFERRER_POLICY; } catch (e) { /* old engines */ }
    img.onload = function () {
      if (st.removed || st.tiles !== layer || st.bm !== bm) return;
      if (suspectImage(img)) { st.retryN++; scheduleRetry(map); return; }
      st.retryN = 0;
      st.tileFail = false;
      st.errors = 0;
      syncOffline(map);
      if (map.hasLayer(layer) && tileHealth(layer).bad) layer.redraw();
    };
    img.onerror = function () {
      if (st.removed || st.tiles !== layer) return;
      st.retryN++;
      scheduleRetry(map);
    };
    img.src = url;
  }

  /* Tiles of the current view that loaded / failed (Leaflet keeps them in layer._tiles with a `current` flag). */
  function tileHealth(layer) {
    var ok = 0, bad = 0;
    var tiles = (layer && layer._tiles) || {};
    Object.keys(tiles).forEach(function (k) {
      var tl = tiles[k];
      if (!tl || !tl.current || !tl.el) return;
      if (tl.el._ncErr) bad++;
      else if (tl.loaded) ok++;
    });
    return { ok: ok, bad: bad };
  }

  function scheduleNotice(map) {
    var st = map._nc;
    if (!st || st.removed || st.noticeT) return;
    st.noticeT = setTimeout(function () { st.noticeT = null; syncOffline(map); }, 120);
  }

  /**
   * Raster basemap availability: 'ok' | 'offline' (real or simulated) | 'blocked' ("not a map" tiles detected) |
   * 'failed' (repeated tile errors online) | 'none' (no basemap on this map). cover = what replaces the raster layer.
   * @returns {{state:string, online:boolean, cover:string|null, provider:string|null}}
   */
  function rasterState(map) {
    var st = map && map._nc;
    var net = online();
    if (!st) return { state: 'none', online: net, cover: null, provider: null };
    var s = !st.basemap || !st.tiles ? 'none' : !net ? 'offline' : st.blocked ? 'blocked' : st.tileFail ? 'failed' : 'ok';
    return { state: s, online: net, cover: st.cover || null, provider: st.bm ? st.bm.provider : null };
  }

  /** Start requesting raster tiles on a map created with {holdTiles: true} (call once its view is final). */
  function releaseTiles(map) {
    var st = map && map._nc;
    if (!st || st.removed || !st.hold) return;
    st.hold = false;
    syncOffline(map);
  }

  /** Another basemap (e.g. 'vector' from NC.basemap) is drawn instead of the raster layer; null restores the raster. */
  function setCover(map, cover) {
    var st = map && map._nc;
    if (!st || st.removed) return;
    cover = cover || null;
    if (st.cover === cover) return;
    st.cover = cover;
    syncOffline(map, true);
  }

  function setNotice(st, key, info) {
    if (!st.notice) return;
    if (key !== st.noticeKey) {
      st.noticeKey = key;
      st.notice.lastChild.textContent = t(key, st.notice.lastChild.textContent);
    }
    if (!!info !== !!st.noticeInfo) {
      st.noticeInfo = !!info;
      st.notice.classList.toggle('mk-notice--info', !!info);
      var old = st.notice.firstChild;
      var tmp = document.createElement('span');
      tmp.innerHTML = icon(info ? 'map' : 'wifi-off');
      if (tmp.firstChild) st.notice.replaceChild(tmp.firstChild, old);
    }
    st.notice.classList.toggle('is-on', !!info);
  }

  /*
   * Offline: keep the basemap on when the Cache API exists (tiles come from the tile cache); without it (file://) hide
   * the layer so no request fails. Online: hide it when its tiles are blocked ("not a map" images). A cover (vector
   * basemap) always replaces it. The warning notice shows only when tiles actually fail: offline with failed tiles in
   * view (all → "needs a connection", some → "part not saved"), online when blocked or after repeated tile errors; with
   * a cover standing in for an unavailable raster, a neutral "offline basemap" notice instead.
   */
  function syncOffline(map, causedByCover) {
    var st = map._nc;
    // A pending timer / late event after map.remove(): Leaflet has no panes any more (addTo would throw).
    if (!st || st.removed || !map._mapPane) return;
    var net = online();
    var keepOffline = !!cacheApi();
    if (st.tiles) {
      var want = !st.hold && !st.cover && (net ? !st.blocked : keepOffline);
      if (want && !map.hasLayer(st.tiles)) { st.errors = 0; st.tiles.addTo(map); st.tiles.bringToBack(); }
      if (!want && map.hasLayer(st.tiles)) map.removeLayer(st.tiles);
      // Back online after an offline spell: re-request the tiles that were missing from the cache.
      if (net && st.net === false && map.hasLayer(st.tiles) && tileHealth(st.tiles).bad) st.tiles.redraw();
    }
    st.net = net;
    if (net && st.tileFail && !st.blocked) scheduleRetry(map); else if (st.retryT && (!st.tileFail || st.blocked)) clearRetry(st);
    // Route/POI geometry is OpenStreetMap-derived: keep the OSM credit visible whenever no basemap carries it.
    var needDataAttr = !st.tiles || (!map.hasLayer(st.tiles) && !st.hold);
    if (needDataAttr !== !!st.dataAttr && map.attributionControl) {
      if (needDataAttr) map.attributionControl.addAttribution(OSM_ATTRIBUTION);
      else map.attributionControl.removeAttribution(OSM_ATTRIBUTION);
      st.dataAttr = needDataAttr;
    }
    var rs = rasterState(map);
    var key = 'mk.basemap_offline';
    var off = false, info = false;
    if (st.cover) {
      info = rs.state !== 'ok' && rs.state !== 'none';
      key = 'mk.basemap_vector';
    } else if (st.hold) {
      off = false; // tiles not requested yet (holdTiles): nothing has failed
    } else if (!st.tiles || !map.hasLayer(st.tiles)) {
      if (!net) off = st.basemap;
      else if (st.blocked) { off = true; key = 'mk.basemap_blocked'; }
    } else if (!net) {
      var hl = tileHealth(st.tiles);
      off = hl.bad > 0;
      if (off && hl.ok > 0) key = 'mk.basemap_partial';
    } else if (st.tileFail) { off = true; key = 'mk.basemap_blocked'; }
    setNotice(st, key, info);
    var was = map.getContainer().classList.contains('mk-offline');
    map.getContainer().classList.toggle('mk-offline', !!off);
    if (was !== !!off || st.lastNet !== net) map.fire('nc:offline', { offline: !!off, online: net });
    st.lastNet = net;
    var sig = rs.state + '|' + (rs.cover || '');
    if (sig !== st.lastSig) {
      st.lastSig = sig;
      map.fire('nc:basemap', { state: rs.state, online: net, cover: rs.cover, causedByCover: !!causedByCover });
    }
  }

  /* Size check used by the ResizeObserver: re-measure only when Leaflet's cached size is stale (fires 'resize'). */
  function syncSize(map) {
    var c = map.getContainer();
    if (!c || !c.clientWidth || !c.clientHeight) return; // hidden screen: refresh() re-measures when shown
    var s;
    try { s = map.getSize(); } catch (e) { return; }
    if (s.x !== c.clientWidth || s.y !== c.clientHeight) { try { map.invalidateSize(false); } catch (e) { /* removed */ } }
  }

  /** Re-measure after the container becomes visible (screens are display:none until shown). */
  function refresh(map) {
    if (!map) return;
    setTimeout(function () { try { map.invalidateSize(); } catch (e) { /* removed */ } }, 0);
  }

  /* ---------------------------------------------------------------- routes */

  function partLine(Lf, part, o) {
    var lvl = part.level || 'uncertain';
    return Lf.polyline(part.geometry, {
      className: 'mk-route mk-route--' + lvl, color: levelColor(lvl) || undefined, weight: lvl === 'lost' ? o.weight + 1 : o.weight,
      opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray: dashFor(lvl, o.weight), interactive: !!o.interactive, bubblingMouseEvents: true
    });
  }

  function casingLine(Lf, geom, o) {
    return Lf.polyline(geom, {
      className: 'mk-route-casing', color: token('--c-surface') || undefined, weight: o.weight + 5, opacity: 0.95,
      lineCap: 'round', lineJoin: 'round', interactive: false
    });
  }

  function addParts(Lf, group, parts, geometry, o) {
    if (o.casing !== false && geometry && geometry.length > 1) group.addLayer(casingLine(Lf, geometry, o));
    parts.forEach(function (p) {
      if (!p.geometry || p.geometry.length < 2) return;
      var line = partLine(Lf, p, o);
      line.part = p;
      group.addLayer(line);
    });
  }

  /**
   * Draw every edge of a graph coloured by its signal segments.
   * @param {L.Map|null} map
   * @param {Object} graph NC.routing.buildGraph() result
   * @param {{carrier?:string, weight?:number, casing?:boolean, interactive?:boolean}} [opts]
   * @returns {L.LayerGroup}
   */
  function drawEdges(map, graph, opts) {
    var Lf = L();
    var o = Object.assign({ weight: 5 }, opts || {});
    var group = Lf.layerGroup();
    Object.keys(graph.edges).forEach(function (id) {
      var an = NC.routing.analyze(graph, { nodeIds: [], steps: [{ edgeId: id, reversed: false }], length_km: graph.edges[id].length_km });
      addParts(Lf, group, an.parts, graph.edges[id].geometry, o);
    });
    if (map) group.addTo(map);
    return group;
  }

  /**
   * Draw a route coloured by signal level. Accepts an Analysis (from NC.routing.analyze), a Pack or a Graph.
   * @param {L.Map|null} map
   * @param {Object} src
   * @param {{carrier?:string, weight?:number, casing?:boolean, interactive?:boolean, fit?:boolean}} [opts]
   * @returns {L.LayerGroup}
   */
  function drawRoute(map, src, opts) {
    var Lf = L();
    var o = Object.assign({ weight: 6 }, opts || {});
    var group;
    if (src && src.parts) {
      group = Lf.layerGroup();
      addParts(Lf, group, src.parts, src.geometry, o);
      if (map) group.addTo(map);
    } else if (src && src.adj) {
      group = drawEdges(map, src, o);
    } else if (src && src.edges) {
      group = drawEdges(map, NC.routing.buildGraph([src]), o);
    } else {
      group = Lf.layerGroup();
      if (map) group.addTo(map);
    }
    if (map) {
      // Canvas renderers ignore CSS classes: recolour on theme change.
      var recolor = function () {
        group.eachLayer(function (l) {
          if (l.part && l.setStyle) l.setStyle({ color: levelColor(l.part.level) || undefined });
          else if (l.setStyle && l.options && l.options.className === 'mk-route-casing') l.setStyle({ color: token('--c-surface') || undefined });
        });
      };
      map.on('nc:theme', recolor);
      group.on('remove', function () { map.off('nc:theme', recolor); });
      if (o.fit) {
        var b = boundsOf(group);
        if (b) fitTo(map, b);
      }
    }
    return group;
  }

  function boundsOf(group) {
    var b = null;
    group.eachLayer(function (l) {
      if (!l.getBounds) return;
      var lb = l.getBounds();
      if (!lb.isValid()) return;
      b = b ? b.extend(lb) : L().latLngBounds(lb.getSouthWest(), lb.getNorthEast());
    });
    return b;
  }

  /* ---------------------------------------------------------------- markers */

  /** Icon name for a POI type (facility or service). */
  function iconFor(type) { return ICONS[type] || 'map-pin'; }

  /**
   * DivIcon marker for a facility/service ({id,name,type,lat,lng,is_stale?,is_partner?}).
   * @param {Object} poi
   * @param {string} [kind] 'facility' | 'service' | explicit type (fallback when poi.type is missing)
   * @param {{size?:number, selected?:boolean, hit?:number}} [opts] size = visual diameter; hit = tap area (default 44 px
   *   on touch screens, the visual size otherwise) — the visual stays centred inside a transparent hit box.
   * @returns {L.Marker}
   */
  function poiMarker(poi, kind, opts) {
    injectStyle();
    var Lf = L();
    opts = opts || {};
    var type = poi.type || (ICONS[kind] ? kind : null) || 'poi';
    var medical = !!MEDICAL[type] || kind === 'facility';
    var size = opts.size || (medical ? 34 : 30);
    var cls = ['mk-poi', 'mk-poi--' + type, medical ? 'mk-poi--medical' : 'mk-poi--service'];
    if (poi.is_stale) cls.push('mk-poi--stale');
    if (opts.selected) cls.push('mk-poi--selected');
    var label = poi.name || '';
    if (poi.is_stale) label += ' (' + t('mk.stale', 'stale') + ')';
    if (poi.is_partner) label += ' (' + t('mk.partner', 'Partner') + ')';
    var hit = Math.max(size, opts.hit || (coarsePointer() ? HIT : 0));
    var box = hit > size ? ' style="width:' + size + 'px;height:' + size + 'px;flex:none"' : '';
    var html = '<span class="' + cls.join(' ') + '"' + box + '>' + icon(iconFor(type)) + (poi.is_partner ? '<span class="mk-poi__badge"></span>' : '') + '</span>';
    var m = Lf.marker([poi.lat, poi.lng], {
      icon: Lf.divIcon({
        className: 'mk-poi-wrap mk-poi-wrap--' + type + (hit > size ? ' mk-poi-wrap--hit' : ''), html: html,
        iconSize: [hit, hit], iconAnchor: [hit / 2, hit / 2], popupAnchor: [0, -size / 2], tooltipAnchor: [size / 2, 0]
      }),
      title: label, alt: label, keyboard: true, riseOnHover: true, zIndexOffset: medical ? 200 : 0
    });
    m.poi = poi;
    return m;
  }

  /*
   * Screen-space declutter for POI markers. After every zoom it hides a marker whose centre is closer than `gap` px
   * (in both axes) to a higher-priority visible one, so neither the icons nor their 44 px touch boxes overlap
   * (overlapping targets are hard to hit and fail WCAG target-size). Priority: opts.keep() first, then care level
   * (hospital > clinic > health station > pharmacy > services), then input order — never partnership. Hidden
   * markers stay in their layer (lists and search still show them) and reappear when zooming in.
   */
  var POI_RANK = { benh_vien: 0, phong_kham: 1, tram_y_te: 2, nha_thuoc: 3 };
  /**
   * @param {L.Map} map
   * @param {function():Array<L.LayerGroup|L.Marker|null>} groups current marker groups (re-read on every update)
   * @param {{gap?:number, keep?:function(L.Marker):boolean, skip?:function(L.Marker):boolean}} [opts]
   *   keep = never hidden, placed first (e.g. the selected destination); skip = ignored (already hidden by CSS).
   * @returns {{update:function(), remove:function()}} call update() after (re)drawing markers.
   */
  function declutter(map, groups, opts) {
    opts = opts || {};
    function update() {
      if (!map || !map._loaded) return;
      var gap = opts.gap || (coarsePointer() ? HIT : 26); // touch: = hit box, so two 44 px boxes never overlap
      var list = [];
      (groups() || []).forEach(function (g) {
        if (!g || !map.hasLayer(g)) return;
        if (g.eachLayer) g.eachLayer(function (m) { if (m.getLatLng && m.poi) list.push(m); });
        else if (g.getLatLng && g.poi) list.push(g);
      });
      var items = list.map(function (m, i) {
        var r = POI_RANK[m.poi.type];
        return { m: m, i: i, keep: !!(opts.keep && opts.keep(m)), r: r === undefined ? 4 : r };
      });
      items.sort(function (a, b) { return ((b.keep ? 1 : 0) - (a.keep ? 1 : 0)) || (a.r - b.r) || (a.i - b.i); });
      var grid = {};
      items.forEach(function (o) {
        var el = o.m.getElement ? o.m.getElement() : o.m._icon;
        if (!el) return;
        if (opts.skip && opts.skip(o.m)) { el.classList.remove('mk-poi-wrap--culled'); return; }
        var p = map.latLngToLayerPoint(o.m.getLatLng());
        var gx = Math.floor(p.x / gap), gy = Math.floor(p.y / gap), hide = false;
        for (var dx = -1; dx <= 1 && !hide && !o.keep; dx++) {
          for (var dy = -1; dy <= 1 && !hide; dy++) {
            var cell = grid[(gx + dx) + ':' + (gy + dy)];
            for (var k = 0; cell && k < cell.length; k++) {
              if (Math.abs(cell[k].x - p.x) < gap && Math.abs(cell[k].y - p.y) < gap) { hide = true; break; }
            }
          }
        }
        if (hide && o.m.isPopupOpen && o.m.isPopupOpen()) hide = false; // keep the marker whose popup is open
        el.classList.toggle('mk-poi-wrap--culled', hide);
        if (hide) el.setAttribute('aria-hidden', 'true');
        else {
          el.removeAttribute('aria-hidden');
          var key = gx + ':' + gy;
          (grid[key] = grid[key] || []).push(p);
        }
      });
    }
    map.on('zoomend viewreset load', update);
    return { update: update, remove: function () { map.off('zoomend viewreset load', update); } };
  }

  /**
   * Pulsing "you are here" marker (non-interactive). Update with marker.setLatLng().
   * @param {number[]|{lat:number,lng:number}} latlng
   * @returns {L.Marker}
   */
  function userMarker(latlng) {
    injectStyle();
    var Lf = L();
    var ll = Array.isArray(latlng) ? latlng : [latlng.lat, latlng.lng];
    return Lf.marker(ll, {
      icon: Lf.divIcon({ className: 'mk-poi-wrap', html: '<span class="mk-user" role="img" aria-label="' + esc(t('mk.you_are_here', 'Your location')) + '"><span class="mk-user__pulse"></span><span class="mk-user__dot"></span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false, keyboard: false, zIndexOffset: 1000
    });
  }

  /**
   * Fit the view to a bbox [south,west,north,east], an array of [lat,lng]/{lat,lng}, an L.LatLngBounds or a layer.
   * @param {L.Map} map
   * @param {*} target
   * @param {{padding?:number[], paddingTopLeft?:number[], paddingBottomRight?:number[], maxZoom?:number, animate?:boolean}} [opts]
   *   paddingTopLeft/paddingBottomRight (Leaflet semantics) keep the fitted area clear of floating panels.
   */
  function fitTo(map, target, opts) {
    if (!map || !target) return;
    var Lf = L();
    opts = opts || {};
    var b = null;
    if (target.getBounds) b = target.getBounds();
    else if (target instanceof Lf.LatLngBounds) b = target;
    else if (Array.isArray(target) && target.length === 4 && typeof target[0] === 'number') b = Lf.latLngBounds([target[0], target[1]], [target[2], target[3]]);
    else if (Array.isArray(target) && target.length) {
      var pts = target.map(function (p) { return Array.isArray(p) ? p : [p.lat, p.lng]; }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
      if (pts.length) b = Lf.latLngBounds(pts);
    }
    if (!b || !b.isValid()) return;
    try { map.invalidateSize(false); } catch (e) { /* ignore */ }
    var fo = { maxZoom: opts.maxZoom || 15, animate: opts.animate === true };
    if (opts.paddingTopLeft || opts.paddingBottomRight) {
      fo.paddingTopLeft = opts.paddingTopLeft || [28, 28];
      fo.paddingBottomRight = opts.paddingBottomRight || [28, 28];
    } else fo.padding = opts.padding || [28, 28];
    map.fitBounds(b, fo);
  }

  /* ---------------------------------------------------------------- heat layer */

  /**
   * Canvas circle markers coloured by RSRP (community/pending samples get an outline).
   * @param {L.Map|null} map
   * @param {Array<{lat,lng,rsrp_dbm,level,status?,carrier?,measured_at?}>} samples
   * @param {{radius?:number, opacity?:number, tooltip?:boolean}} [opts]
   * @returns {L.LayerGroup}
   */
  function heatLayer(map, samples, opts) {
    var Lf = L();
    opts = opts || {};
    var renderer = Lf.canvas({ padding: 0.5 });
    var group = Lf.layerGroup();
    var outline = token('--c-text') || undefined;
    (samples || []).forEach(function (s) {
      if (s.lat === null || s.lat === undefined || !isFinite(s.lat) || !isFinite(s.lng)) return;
      var pending = s.status && s.status !== 'approved';
      var cm = Lf.circleMarker([s.lat, s.lng], {
        renderer: renderer, radius: opts.radius || 6, stroke: !!pending, color: outline, weight: 1, dashArray: pending ? '2 2' : null,
        fillColor: rsrpColor(s.rsrp_dbm, s.level), fillOpacity: s.status === 'rejected' ? 0.25 : (opts.opacity || 0.78), interactive: !!opts.tooltip
      });
      cm.sample = s;
      if (opts.tooltip) {
        cm.bindTooltip(esc((s.rsrp_dbm === null || s.rsrp_dbm === undefined ? '—' : s.rsrp_dbm + ' dBm') + ' · ' + (s.carrier || '') + (s.tech ? ' · ' + s.tech : '')), { direction: 'top' });
      }
      group.addLayer(cm);
    });
    if (map) {
      group.addTo(map);
      var recolor = function () {
        var oc = token('--c-text') || undefined;
        group.eachLayer(function (l) { if (l.sample) l.setStyle({ fillColor: rsrpColor(l.sample.rsrp_dbm, l.sample.level), color: oc }); });
      };
      map.on('nc:theme', recolor);
      group.on('remove', function () { map.off('nc:theme', recolor); });
    }
    return group;
  }

  NC.mapkit = {
    ATTRIBUTION: ATTRIBUTION,
    create: create,
    drawRoute: drawRoute,
    drawEdges: drawEdges,
    poiMarker: poiMarker,
    declutter: declutter,
    userMarker: userMarker,
    fitTo: fitTo,
    heatLayer: heatLayer,
    refresh: refresh,
    iconFor: iconFor,
    levelColor: levelColor,
    rsrpColor: rsrpColor,
    isDark: isDark,
    basemap: basemap,
    rasterState: rasterState,
    setCover: setCover,
    releaseTiles: releaseTiles,
    REFERRER_POLICY: REFERRER_POLICY
  };
})(window.NC = window.NC || {});
