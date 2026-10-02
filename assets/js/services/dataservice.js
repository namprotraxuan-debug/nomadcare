/*
 * dataservice.js — NC.data: backend-agnostic data facade of the DEVICE tier (owner: P1 data / client-core).
 * Backend selection (Supabase | local mock; supabase-js is loaded on demand through NC.loader only when configured),
 * data packs (downloaded → server → bundled seed), nearest facilities offline, durable outbox (NC.store 'outbox')
 * with batching/backoff/auto-flush, device registration, Buddy session state machine (start/checkin/stop/resolve/update
 * + local overdue tick every 10 s), reports & community signal logs, wipePersonal / eraseServerData (erase tombstone),
 * admin proxy.
 * Page role (window.NC_PAGE): only 'app' pages flush the device outbox and tick Buddy automatically, and among several
 * app tabs a localStorage lease 'nc.outbox.lease' (TTL 20 s) elects ONE flusher. 'admin' (or any other role) never
 * touches the device outbox. Undefined role (tests, harness): nothing runs by itself; explicit calls still work.
 * At rest, the Buddy contact (traveler / recipient name, e-mail, phone) is sealed with NC.secure in the session record
 * and in buddy.start outbox ops; it is unsealed only in memory and at send time.
 * Round 2 R6 (W6): buddy.heartbeat (NC.data.buddy.heartbeat, coalesced per session in the outbox, 'paused' also sent as a
 * fetch-keepalive beacon in Supabase mode) and the Web Push ops push.subscribe / push.unsubscribe / push.schedule
 * (NC.data.push, schedule coalesced per device); checks = NC.backend.shared.validPushEndpoint / validPushKeys /
 * pushScheduleItems (= SQL 20260930000200).
 * Events: data:mode, data:outbox*, data:sync*, data:pack, data:op_error, data:wiped, buddy:update*, buddy:event*
 * (* also broadcast to the other tabs of this origin).
 */
(function (NC) {
  'use strict';

  var shared = (NC.backend && NC.backend.shared) || {};
  var err = shared.err;
  var uuid = shared.uuid;

  var BATCH = 25;
  var FLUSH_EVERY_MS = 30000;
  var TICK_EVERY_MS = 10000;
  var SERVER_PACK_TTL_MS = 5 * 60000;
  var PERMANENT_ERRORS = ['session_closed', 'invalid_kind', 'unknown_op', 'invalid_op', 'invalid_op_id', 'forbidden', 'session_forbidden',
    'session_conflict', 'no_active_session', 'payload_too_large', 'invalid_samples', 'too_many_samples', 'recipient_email_required',
    'recipient_phone_required', 'recipient_phone_invalid', 'recipient_phone_not_mobile', 'recipient_email_invalid',
    // round 2 R6 (W6): heartbeat + Web Push ops
    'invalid_state', 'invalid_push_endpoint', 'invalid_push_keys', 'invalid_push_schedule', 'too_many_items'];
  var DEVICE_ERRORS = ['unauthorized_device', 'invalid_device'];
  var OP_TYPES = ['device.register', 'buddy.start', 'buddy.checkin', 'buddy.stop', 'buddy.resolve', 'buddy.update', 'report.submit', 'signal.log', 'device.erase',
    'buddy.heartbeat', 'push.subscribe', 'push.unsubscribe', 'push.schedule'];
  /* Ops of which only the latest matters: a newer one replaces the queued one (per session / per device), so an
     offline stretch never piles up heartbeats or schedules (round 2 R6). */
  var COALESCE_OPS = { 'buddy.heartbeat': 'session_id', 'push.schedule': null };
  /* Technical ops: queued like the others (Settings › Kết nối & kỹ thuật lists them) but not counted in the
     user-facing outboxCount (topbar pill / badge), which counts what the traveller did and is waiting to be sent. */
  var TECH_OPS = { 'buddy.heartbeat': true, 'push.subscribe': true, 'push.unsubscribe': true, 'push.schedule': true };
  var SESSION_KEY = 'buddy.session';
  var SYNC_KEY = 'sync.last';
  var ROUTES_CACHE = 'cache.routes';
  var CONTENT_CACHE = 'cache.content_release';
  var ERASE_KEY = 'erase.pending';               // erase tombstone of the active backend's device (FIX_CONTRACT A3)
  var ERASE_OTHER_KEY = 'erase.pending.other';   // same for credentials of the other backend mode, if any
  var ERASE_MAX_ATTEMPTS = 5;                     // an old server without device.erase: give up after this many tries
  var LEASE_KEY = 'nc.outbox.lease';
  var LEASE_TTL_MS = 20000;
  var LEASE_RENEW_MS = 7000;
  var DELEGATE_WAIT_MS = 8000;
  /* Buddy contact fields sealed at rest (third-party personal data + the traveller's identity-layer name). */
  var CONTACT_FIELDS = ['traveler_name', 'recipient_name', 'recipient_email', 'recipient_phone'];
  /* kv keys removed by wipePersonal (prefixes), besides any key mentioning a position/location. */
  var WIPE_PREFIXES = ['qr.', 'tr.', 'fa.', 'map.', 'bd.', 'buddy.', 'home.', 'sync.', 'demo.', 'trip.', 'push.'];

  var data = NC.data = NC.data || {};
  var be = null;
  var initP = null;
  var state = {
    outboxCount: 0, outboxTotal: 0, lastSyncAt: null, deviceId: null, packs: 0, flushing: null, flushTimer: null, started: false,
    leader: false, erasePending: false, erasing: null, tabId: Math.random().toString(36).slice(2)
  };
  var medicalMem = {};     // session_id → consented public medical layer (memory only; never persisted in the outbox)
  var contactMem = {};     // session_id → {sealed, contact} (memory cache of the unsealed Buddy contact)
  var recovering = {};     // session_id → true while a buddy.start re-send is pending
  var bundledMemo = {};    // route:carrier → Pack built from NC_SEED
  var serverMemo = {};     // route:carrier → {pack, at}
  function noop() { }

  /* ================================================================== environment shims */

  function cfg() { return window.NC_CONFIG || {}; }
  function seed() { return window.NC_SEED || null; }
  function nowIso() { return new Date().toISOString(); }
  function addMin(iso, m) { return new Date(Date.parse(iso) + m * 60000).toISOString(); }

  function setting(key, def) {
    try {
      if (NC.settings && NC.settings.get) { var v = NC.settings.get(key); return v === undefined || v === null ? def : v; }
    } catch (e) { /* settings not loaded */ }
    return def;
  }
  function setSetting(key, v) {
    try { if (NC.settings && NC.settings.set) return Promise.resolve(NC.settings.set(key, v)); } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  function online() {
    try { if (NC.net && NC.net.online) return !!NC.net.online(); } catch (e) { /* fall through */ }
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function emit(evt, payload) { if (NC.bus && NC.bus.emit) { try { NC.bus.emit(evt, payload); } catch (e) { /* listener error */ } } }
  /* Emit here AND in the other tabs of this origin (counts, badges, Buddy state stay truthful everywhere). */
  function broadcast(evt, payload) {
    if (NC.bus && NC.bus.broadcast) { try { NC.bus.broadcast(evt, payload); return; } catch (e) { /* fall back */ } }
    emit(evt, payload);
  }
  function on(evt, fn) { return NC.bus && NC.bus.on ? NC.bus.on(evt, fn) : function () { }; }

  /* ================================================================== page role + multi-tab lease (A7) */

  function pageRole() { return typeof window !== 'undefined' ? window.NC_PAGE : undefined; }
  /** Automatic outbox/Buddy work only on the traveller app page. */
  function isAppPage() { return pageRole() === 'app'; }
  /** Explicit NC.data.flush()/buddy.tick() calls: allowed on the app page and when no role is declared (tests). */
  function explicitAllowed() { var r = pageRole(); return r === undefined || r === null || r === 'app'; }
  function tabId() { return (NC.bus && NC.bus.tabId) || state.tabId; }

  function readLease() {
    try {
      var raw = window.localStorage.getItem(LEASE_KEY);
      if (!raw) return null;
      var l = JSON.parse(raw);
      return l && typeof l === 'object' ? l : null;
    } catch (e) { return undefined; }   // storage blocked → behave as the only tab
  }
  /**
   * Acquire / renew the outbox lease. True when this tab is the elected flusher.
   * A lease held by another live tab (not expired) is respected; an expired one is taken over.
   */
  function haveLease() {
    if (!isAppPage()) { state.leader = false; return false; }
    var l = readLease();
    if (l === undefined) { state.leader = true; return true; }
    var now = Date.now();
    if (l && l.tab !== tabId() && +l.until > now) { state.leader = false; return false; }
    try { window.localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: tabId(), until: now + LEASE_TTL_MS })); }
    catch (e) { state.leader = true; return true; }
    var chk = readLease();
    state.leader = !chk || chk.tab === tabId();
    return state.leader;
  }
  function releaseLease() {
    var l = readLease();
    if (l && l.tab === tabId()) { try { window.localStorage.removeItem(LEASE_KEY); } catch (e) { /* ignore */ } }
    state.leader = false;
  }

  function tr(key, fallback) {
    try { if (NC.i18n && NC.i18n.t) { var s = NC.i18n.t(key); if (s && s !== key) return s; } } catch (e) { /* ignore */ }
    return fallback;
  }

  if (NC.i18n && NC.i18n.add) {
    NC.i18n.add({
      vi: {
        'data.fallback_local': 'Không kết nối được máy chủ Supabase — tạm dùng máy chủ mô phỏng cục bộ.',
        'data.offline_required': 'Cần kết nối mạng để tải gói dữ liệu.',
        'data.pack_bundled': 'Gói mặc định cài kèm',
        'data.pack_downloaded': 'Đã tải về máy',
        'data.pack_server': 'Trực tuyến'
      },
      en: {
        'data.fallback_local': 'Could not reach the Supabase server — using the local demo server for now.',
        'data.offline_required': 'A network connection is required to download data packs.',
        'data.pack_bundled': 'Bundled default pack',
        'data.pack_downloaded': 'Downloaded',
        'data.pack_server': 'Online'
      }
    });
  }

  /* Minimal in-memory table/kv used only when NC.store is missing (guarded shim). */
  var memKV = {}, memTables = {};
  function kv() {
    if (NC.store && NC.store.get) return NC.store;
    return {
      get: function (k) { return Promise.resolve(memKV[k] === undefined ? null : JSON.parse(JSON.stringify(memKV[k]))); },
      set: function (k, v) { memKV[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(); },
      del: function (k) { delete memKV[k]; return Promise.resolve(); }
    };
  }
  function table(name) {
    if (NC.store && NC.store.table) return NC.store.table(name);
    var t = memTables[name] = memTables[name] || {};
    function c(v) { return JSON.parse(JSON.stringify(v)); }
    return {
      all: function () { return Promise.resolve(Object.keys(t).map(function (k) { return c(t[k]); })); },
      get: function (id) { return Promise.resolve(t[id] ? c(t[id]) : null); },
      put: function (o) { t[o.id] = c(o); return Promise.resolve(o); },
      bulkPut: function (a) { a.forEach(function (o) { t[o.id] = c(o); }); return Promise.resolve(); },
      delete: function (id) { delete t[id]; return Promise.resolve(); },
      clear: function () { Object.keys(t).forEach(function (k) { delete t[k]; }); return Promise.resolve(); },
      count: function () { return Promise.resolve(Object.keys(t).length); }
    };
  }

  function secure() {
    if (NC.secure && NC.secure.save) return NC.secure;
    return {
      save: function (n, o) { return kv().set('secure.' + n, o); },
      load: function (n) { return kv().get('secure.' + n); },
      remove: function (n) { return kv().del('secure.' + n); }
    };
  }

  /* Run fn under a cross-tab Web Lock when supported (outbox flush, buddy tick). */
  function withLock(name, fn) {
    try {
      if (navigator.locks && navigator.locks.request) return navigator.locks.request(name, function () { return fn(); });
    } catch (e) { /* fall through */ }
    return fn();
  }

  function timeout(p, ms, code) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(err(code || 'timeout', 'Timed out')); }, ms);
      p.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function qsBackend() {
    try {
      if (NC.util && NC.util.qs) return NC.util.qs().backend;
      var m = /[?&]backend=([^&#]*)/.exec(location.search);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  /** Supabase keys configured and not overridden by ?backend=local / forceLocal (library not needed yet). */
  function supabaseConfigured() {
    var c = cfg();
    return !!(c.supabaseUrl && c.supabaseAnonKey && !c.forceLocal && qsBackend() !== 'local');
  }

  function wantSupabase() {
    return !!(supabaseConfigured() && window.supabase && NC.backend && NC.backend.supabase && NC.backend.supabase.available());
  }

  /* supabase-js (218 KB, ES2019) is fetched only when a Supabase backend is configured (A10). */
  function loadSupabaseLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(true);
    if (!supabaseConfigured() || !NC.loader || typeof NC.loader.script !== 'function') return Promise.resolve(false);
    return NC.loader.script('assets/vendor/supabase/supabase.min.js', { timeout: 15000 }).then(function () { return true; }, function (e) {
      try { if (window.console) console.warn('[NC.data] supabase-js could not be loaded:', e && (e.code || e.message)); } catch (x) { /* ignore */ }
      return false;
    });
  }

  function useLocal() {
    be = NC.backend.local;
    data.mode = 'local';
    return be.init();
  }

  function fallbackToLocal(reason) {
    try { if (window.console) console.warn('[NC.data] Supabase unavailable, using local backend:', reason && (reason.code || reason.message)); } catch (e) { /* ignore */ }
    var shown = false;
    try { shown = sessionStorage.getItem('nc.fallbackToast') === '1'; sessionStorage.setItem('nc.fallbackToast', '1'); } catch (e) { shown = !!state.toasted; }
    state.toasted = true;
    if (!shown && NC.ui && NC.ui.toast) NC.ui.toast(tr('data.fallback_local', 'Supabase unavailable — using local server'), { type: 'warning' });
    return useLocal().then(function () { emit('data:mode', { mode: data.mode, fallback: true }); });
  }

  /* ================================================================== init */

  /**
   * Select + initialise the backend, restore sync state, start timers. Idempotent.
   * @returns {Promise<void>}
   */
  data.init = function () {
    if (initP) return initP;
    initP = loadSupabaseLib().then(function () {
      if (wantSupabase()) {
        be = NC.backend.supabase;
        data.mode = 'supabase';
        return Promise.resolve().then(function () { return be.init(); }).then(function () {
          if (!online()) { state.verifyPending = true; return null; }
          return timeout(be.ping(), 8000, 'timeout').catch(function (e) { return fallbackToLocal(e); });
        }, function (e) { return fallbackToLocal(e); });
      }
      return useLocal();
    }).then(function () {
      return Promise.all([
        kv().get(SYNC_KEY).then(function (v) { state.lastSyncAt = v || null; }),
        refreshCounts(),
        loadCreds().then(function (c) { state.deviceId = c ? c.id : null; }),
        refreshErasePending(),
        migrateSession()
      ]);
    }).then(function () {
      startLoops();
      emit('data:mode', { mode: data.mode });
      // A pending erase tombstone goes first (before any new device registration), then the queue.
      if (isAppPage() && online() && haveLease()) scheduleFlush(1500);
    });
    return initP;
  };

  function ready() { return data.init(); }

  data.mode = 'local';

  /** Snapshot for pills/badges (sync). */
  data.status = function () {
    return {
      mode: data.mode, online: online(), outboxCount: state.outboxCount, outboxTotal: state.outboxTotal, lastSyncAt: state.lastSyncAt,
      deviceId: state.deviceId, packs: state.packs, storage: be && be.storage ? be.storage : null,
      erasePending: state.erasePending, page: pageRole() || null, leader: state.leader
    };
  };

  /** Active backend object (NC.backend.local | NC.backend.supabase). */
  data.backend = function () { return be; };

  function refreshCounts() {
    return Promise.all([table('outbox').all(), table('packs').count()]).then(function (r) {
      var ops = r[0] || [];
      state.outboxTotal = ops.length;
      state.outboxCount = ops.filter(function (o) { return !(o && TECH_OPS[o.op] === true); }).length;
      state.packs = r[1] || 0;
    }).catch(function () { /* store unavailable */ });
  }

  function startLoops() {
    if (state.started) return;
    state.started = true;
    on('server:change', function (msg) {
      if (msg && (msg.table === 'data_packs' || msg.table === '*')) serverMemo = {};
      // Only the traveller app adopts server changes into ITS device session (never the admin page).
      if (!isAppPage() || !msg || msg.table !== 'buddy_sessions' || !msg.row || !online()) return;
      mergeServerSession(msg.row, { realtime: true }).catch(noop);
    });
    // Another tab changed the shared outbox / wiped → refresh our counters (listeners got the payload already).
    on('data:outbox', function (p, meta) { if (meta && meta.remote) refreshCounts().catch(noop); });
    on('data:wiped', function (p, meta) { if (meta && meta.remote) { medicalMem = {}; contactMem = {}; refreshCounts().catch(noop); refreshErasePending(); } });
    if (!isAppPage()) return;   // admin / tests: nothing automatic (FIX_CONTRACT A7)

    haveLease();
    setInterval(function () { if (online() && haveLease()) data.flush().catch(noop); }, FLUSH_EVERY_MS);
    setInterval(function () { if (haveLease()) data.buddy.tick().catch(noop); }, TICK_EVERY_MS);
    setInterval(function () { if (state.leader) haveLease(); }, LEASE_RENEW_MS);
    on('net:change', function (e) {
      if (!(e ? e.online : online())) return;
      if (state.verifyPending && data.mode === 'supabase') {
        state.verifyPending = false;
        timeout(be.ping(), 8000, 'timeout').catch(function (x) { return fallbackToLocal(x); }).then(function () { if (haveLease()) scheduleFlush(300); });
        return;
      }
      if (haveLease()) scheduleFlush(600);
    });
    // A non-leader app tab asks the elected flusher to send now (e.g. right after a check-in there).
    on('data:flush_req', function (p, meta) { if (meta && meta.remote && online() && haveLease()) scheduleFlush(250); });
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;
        if (!haveLease()) return;
        data.buddy.tick().catch(noop);
        if (online()) scheduleFlush(500);
      });
      window.addEventListener('pagehide', releaseLease);
    } catch (e) { /* no document */ }
  }

  /* ================================================================== routes & packs */

  function carrierOf(c) { return c || setting('carrier', cfg().defaultCarrier || 'viettel'); }

  function seedTables() {
    var S = seed();
    if (!S) return null;
    return {
      routes: S.routes || [], nodes: S.nodes || [], edges: S.edges || [], segments: S.segments || [], accuracy: S.accuracy || [],
      facilities: S.facilities || [], services: S.services || [], model_version: S.model_version || null
    };
  }

  /* Bundled default pack ("gói mặc định cài kèm") built from NC_SEED — works with no server at all. */
  function bundledPack(routeId, carrier) {
    var key = routeId + ':' + carrier;
    if (bundledMemo[key]) return bundledMemo[key];
    var src = seedTables();
    if (!src) return null;
    var S = seed();
    var meta = (S.packs || []).filter(function (p) { return p.route_id === routeId && p.carrier === carrier; })
      .sort(function (a, b) { return b.version - a.version; })[0];
    var pack = shared.buildPack(src, routeId, carrier, { version: meta ? meta.version : 0, published_at: meta ? meta.published_at : (S.generated_at || null) });
    if (!pack) return null;
    pack.source = 'bundled';
    bundledMemo[key] = pack;
    return pack;
  }

  function seedRouteSummaries() {
    var S = seed();
    if (!S) return [];
    var carriers = (S.carriers || []).map(function (c) { return typeof c === 'string' ? c : c.id; });
    if (!carriers.length) carriers = shared.CARRIERS.slice();
    return (S.routes || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).map(function (r) {
      var acc = {}, packs = {};
      carriers.forEach(function (c) {
        acc[c] = null;
        var bp = bundledPack(r.id, c);
        if (bp) packs[c] = { version: bp.version, published_at: bp.published_at, size_bytes: bp.size_bytes };
      });
      (S.accuracy || []).forEach(function (a) { if (a.route_id === r.id) acc[a.carrier] = a.accuracy; });
      return {
        id: r.id, name: r.name, name_en: r.name_en || null, region: r.region || null, region_en: r.region_en || null, travel_mode: r.travel_mode,
        length_km: r.length_km, color: r.color || null, bbox: r.bbox || null,
        verified_facilities: (S.facilities || []).filter(function (f) { return f.route_id === r.id && f.status === 'verified'; }).length,
        accuracy: acc, packs: packs
      };
    });
  }

  function packMeta(rec) {
    return { route_id: rec.route_id, carrier: rec.carrier, version: rec.version, size_bytes: rec.size_bytes, downloaded_at: rec.downloaded_at };
  }

  /**
   * Route summaries (list_routes shape) + `downloaded` {carrier: PackMeta & {update_available}} + `source`.
   * Online → server (cached for offline use); offline → last cached server list, else the bundled seed.
   * @returns {Promise<Array>}
   */
  data.listRoutes = function () {
    return ready().then(function () {
      if (!online()) return null;
      return be.list_routes().then(function (rows) {
        kv().set(ROUTES_CACHE, { at: nowIso(), rows: rows }).catch(function () { });
        return { rows: rows, source: 'server' };
      }).catch(function () { return null; });
    }).then(function (res) {
      if (res) return res;
      return kv().get(ROUTES_CACHE).catch(function () { return null; }).then(function (c) {
        if (c && c.rows && c.rows.length) return { rows: c.rows, source: 'cache' };
        return { rows: seedRouteSummaries(), source: 'bundled' };
      });
    }).then(function (res) {
      return table('packs').all().then(function (recs) {
        return (res.rows || []).map(function (r) {
          var o = Object.assign({}, r, { source: res.source, downloaded: {} });
          recs.forEach(function (rec) {
            if (rec.route_id !== r.id) return;
            var m = packMeta(rec);
            var srv = r.packs && r.packs[rec.carrier];
            m.update_available = !!(srv && srv.version > rec.version);
            o.downloaded[rec.carrier] = m;
          });
          return o;
        });
      });
    });
  };

  /**
   * Pack for a route/carrier. Priority: downloaded (IDB) → server (online, memo 5 min, NOT persisted) → bundled seed.
   * Result carries `source` ('downloaded'|'server'|'bundled'); treat it as read-only.
   * @returns {Promise<Object>} Pack
   */
  data.getPack = function (routeId, carrier) {
    carrier = carrierOf(carrier);
    routeId = routeId || setting('route_id', cfg().defaultRoute);
    var key = routeId + ':' + carrier;
    return ready().then(function () { return table('packs').get(key).catch(function () { return null; }); }).then(function (rec) {
      if (rec && rec.pack) {
        var p = rec.pack;
        p.source = 'downloaded';
        p.downloaded_at = rec.downloaded_at;
        return p;
      }
      // Server copy only while online (contract §8): the memo is a short-lived request cache, never an offline store.
      var memo = serverMemo[key];
      if (memo && online() && Date.now() - memo.at < SERVER_PACK_TTL_MS) return memo.pack;
      var fromServer = online() ? be.get_data_pack(routeId, carrier).then(function (p) {
        if (!p || !p.route) return null;
        p.source = 'server';
        serverMemo[key] = { pack: p, at: Date.now() };
        return p;
      }).catch(function () { return null; }) : Promise.resolve(null);
      return fromServer.then(function (p) {
        if (p) return p;
        var b = bundledPack(routeId, carrier);
        if (!b) throw err('not_found', 'No data pack for ' + key);
        return b;
      });
    });
  };

  /**
   * Download + persist a pack (requires network). Emits data:pack.
   * @returns {Promise<{route_id, carrier, version, size_bytes, downloaded_at}>}
   */
  data.downloadPack = function (routeId, carrier) {
    carrier = carrierOf(carrier);
    return ready().then(function () {
      if (!online()) throw err('offline', tr('data.offline_required', 'Network required'));
      return be.get_data_pack(routeId, carrier);
    }).then(function (pack) {
      if (!pack || !pack.route) throw err('not_found', 'No data pack');
      delete pack.source;
      var rec = {
        id: routeId + ':' + carrier, route_id: routeId, carrier: carrier, version: pack.version,
        size_bytes: pack.size_bytes || shared.utf8Length(JSON.stringify(pack)), downloaded_at: nowIso(), pack: pack
      };
      return table('packs').put(rec).then(function () {
        delete serverMemo[rec.id];
        return refreshCounts();
      }).then(function () {
        emit('data:pack', { route_id: routeId, carrier: carrier, version: rec.version });
        return packMeta(rec);
      });
    });
  };

  /** @returns {Promise<Array<PackMeta>>} */
  data.listDownloadedPacks = function () {
    return ready().then(function () { return table('packs').all(); }).then(function (recs) {
      return recs.map(packMeta).sort(function (a, b) { return a.route_id.localeCompare(b.route_id) || a.carrier.localeCompare(b.carrier); });
    });
  };

  /** Remove a downloaded pack (the bundled default pack stays available). Emits data:pack {version:null, removed:true}. */
  data.removePack = function (routeId, carrier) {
    carrier = carrierOf(carrier);
    return ready().then(function () { return table('packs').delete(routeId + ':' + carrier); }).then(refreshCounts).then(function () {
      emit('data:pack', { route_id: routeId, carrier: carrier, version: null, removed: true });
      return true;
    });
  };

  /* All packs usable offline for a carrier: downloaded + server memo + bundled, one per route (best source wins). */
  function availablePacks(carrier, routeId) {
    return table('packs').all().catch(function () { return []; }).then(function (recs) {
      var byRoute = {};
      recs.forEach(function (rec) {
        if (routeId && rec.route_id !== routeId) return;
        if (!byRoute[rec.route_id] || rec.carrier === carrier) byRoute[rec.route_id] = rec.pack;
      });
      Object.keys(serverMemo).forEach(function (k) {
        var p = serverMemo[k].pack;
        if (routeId && p.route.id !== routeId) return;
        if (!byRoute[p.route.id]) byRoute[p.route.id] = p;
      });
      var src = seedTables();
      if (src) {
        src.routes.forEach(function (r) {
          if (routeId && r.id !== routeId) return;
          if (!byRoute[r.id]) byRoute[r.id] = bundledPack(r.id, carrier);
        });
      }
      return Object.keys(byRoute).map(function (k) { return byRoute[k]; }).filter(Boolean);
    });
  }

  /**
   * Nearest verified facilities, fully offline (from every available pack). Stale flags recomputed for today.
   * Sort: distance, then trauma_capable first.
   * @param {{lat:number,lng:number}} pos
   * @param {{limit?:number, types?:string[], route_id?:string}} [opts]
   * @returns {Promise<Array>}
   */
  data.nearestFacilities = function (pos, opts) {
    opts = opts || {};
    var limit = opts.limit || 5;
    return ready().then(function () { return availablePacks(carrierOf(), opts.route_id); }).then(function (packs) {
      var seen = {};
      var out = [];
      var hav = NC.routing.haversineKm;
      packs.forEach(function (p) {
        (p.facilities || []).forEach(function (f) {
          if (seen[f.id]) return;
          if (opts.types && opts.types.length && opts.types.indexOf(f.type) < 0) return;
          if (f.lat === null || f.lng === null || f.lat === undefined) return;
          seen[f.id] = 1;
          var o = shared.decorateFacility(f);
          o.route_id = p.route.id;
          o.distance_km = pos ? hav(pos, f) : null;
          out.push(o);
        });
      });
      out.sort(function (a, b) {
        return ((a.distance_km || 0) - (b.distance_km || 0)) || ((b.trauma_capable ? 1 : 0) - (a.trauma_capable ? 1 : 0));
      });
      return out.slice(0, limit);
    });
  };

  /** Content release (online → server, cached; offline → cache → seed → bundled contentVersion). */
  data.contentRelease = function () {
    return ready().then(function () {
      if (!online()) return null;
      return be.get_content_release().then(function (r) {
        if (r) kv().set(CONTENT_CACHE, r).catch(function () { });
        return r;
      }).catch(function () { return null; });
    }).then(function (r) {
      if (r) return r;
      return kv().get(CONTENT_CACHE).catch(function () { return null; }).then(function (c) {
        if (c) return c;
        var list = ((seed() && seed().content_releases) || []).slice();
        var approved = list.filter(function (x) { return x.status === 'approved'; });
        var pick = approved[approved.length - 1] || list[list.length - 1];
        if (pick) return { version: pick.version, status: pick.status, approved_at: pick.approved_at || null, approver: pick.approver || null, notes: pick.notes || null, reviewer_round1: pick.reviewer_round1 || null };
        return { version: cfg().contentVersion || '1.0.0', status: 'bundled', approved_at: null, approver: null, notes: null };
      });
    });
  };

  /* ================================================================== device credentials */

  function credKey() { return 'device.' + data.mode; }
  function otherMode() { return data.mode === 'supabase' ? 'local' : 'supabase'; }
  /* The credential is also kept in memory (state.creds): the 'paused' heartbeat beacon runs in pagehide, with no time
     for an async read. */
  function memCreds(c) { state.creds = c && c.id && c.secret ? { id: c.id, secret: c.secret, mode: data.mode } : null; return c; }
  function loadCreds() { return Promise.resolve(secure().load(credKey())).then(memCreds).catch(function () { return null; }); }
  function loadOtherCreds() { return Promise.resolve(secure().load('device.' + otherMode())).catch(function () { return null; }); }
  function saveCreds(c) { memCreds(c); return Promise.resolve(secure().save(credKey(), c)); }
  function dropCreds() { state.deviceId = null; state.creds = null; return Promise.resolve(secure().remove ? secure().remove(credKey()) : null).catch(function () { }); }

  /* Single-flight registration (flush, device() and buddy.start may race). */
  function registerNow() {
    if (state.registering) return state.registering;
    state.registering = registerOnce().then(function (c) { state.registering = null; return c; }, function (e) { state.registering = null; throw e; });
    return state.registering;
  }

  function registerOnce() {
    var carrier = carrierOf();
    return loadCreds().then(function (c) {
      if (c && c.id) return c;
      // A pending server erase of a previous (wiped) device identity is sent before a new identity is created.
      return flushTombstones().catch(noop).then(function () { return doRegister(carrier); });
    });
  }

  function doRegister(carrier) {
    return be.register_device(carrier, cfg().appVersion || null).then(function (res) {
      if (!res || !res.device_id) throw err('server', 'register_device returned nothing');
      var creds = { id: res.device_id, secret: res.secret, carrier: carrier, mode: data.mode, registered_at: nowIso() };
      return saveCreds(creds).then(function () {
        state.deviceId = creds.id;
        return table('outbox').all();
      }).then(function (ops) {
        return Promise.all(ops.filter(function (o) { return o.op === 'device.register'; }).map(function (o) { return table('outbox').delete(o.id); }));
      }).then(refreshCounts).then(function () { broadcast('data:outbox', { count: state.outboxCount }); return creds; });
    });
  }

  /**
   * Device identity (anonymous). Registers lazily: RPC register_device when online, otherwise a queued 'device.register' op.
   * @returns {Promise<{id:string|null, carrier:string}>}
   */
  data.device = function () {
    return ready().then(loadCreds).then(function (c) {
      if (c && c.id) return { id: c.id, carrier: c.carrier };
      if (online()) {
        return registerNow().then(function (n) { return { id: n.id, carrier: n.carrier }; }).catch(function () {
          return queueRegister().then(function () { return { id: null, carrier: carrierOf() }; });
        });
      }
      return queueRegister().then(function () { return { id: null, carrier: carrierOf() }; });
    });
  };

  function queueRegister() {
    return table('outbox').all().then(function (ops) {
      if (ops.some(function (o) { return o.op === 'device.register'; })) return null;
      return enqueue('device.register', { carrier: carrierOf(), app_version: cfg().appVersion || null }, { noFlush: true });
    });
  }

  /* ================================================================== sealing (Buddy contact at rest) */

  /* NC.secure.seal/unseal when available (AES-GCM); otherwise a plain wrapper (node tests / no store). */
  function seal(obj) {
    if (NC.secure && typeof NC.secure.seal === 'function') return NC.secure.seal(obj).catch(function () { return { sealed: 0, v: obj }; });
    return Promise.resolve({ sealed: 0, v: obj });
  }
  function unseal(x) {
    if (!x) return Promise.resolve(null);
    if (x.sealed === 0) return Promise.resolve(x.v || null);
    if (NC.secure && typeof NC.secure.unseal === 'function') return NC.secure.unseal(x).catch(function () { return null; });
    return Promise.resolve(null);
  }
  function pickContact(o) {
    var c = {};
    CONTACT_FIELDS.forEach(function (k) { c[k] = o && o[k] !== undefined ? o[k] : null; });
    return c;
  }
  function withoutContact(o) {
    var out = {};
    Object.keys(o || {}).forEach(function (k) { if (CONTACT_FIELDS.indexOf(k) < 0) out[k] = o[k]; });
    return out;
  }

  /* ================================================================== outbox */

  /**
   * Append an op to the durable outbox; flushes soon when online (app page).
   * buddy.start contact fields are sealed inside the record ({contact_sealed}); wireOp() unseals them at send time.
   * opts: {noFlush, created_at, id (op id chosen by the caller, e.g. already sent as a beacon),
   *        derived:[local event ids acknowledged together with this op]}
   * Coalesced ops (COALESCE_OPS: buddy.heartbeat per session, push.schedule per device) replace the queued one.
   * @returns {Promise<Object>} op record
   */
  function enqueue(op, payload, opts) {
    if (OP_TYPES.indexOf(op) < 0) return Promise.reject(err('unknown_op', 'Unknown op ' + op));
    var d = payload || {};
    var prep = op === 'buddy.start'
      ? seal(pickContact(d)).then(function (sealed) { var o = withoutContact(d); o.contact_sealed = sealed; return o; })
      : Promise.resolve(d);
    return prep.then(function (dataRec) {
      var rec = { id: (opts && opts.id) || uuid(), op: op, data: dataRec, created_at: (opts && opts.created_at) || nowIso(), attempts: 0, last_error: null, next_at: 0 };
      if (opts && opts.derived && opts.derived.length) rec.derived = opts.derived.slice();
      return coalesce(rec).then(function () { return table('outbox').put(rec); }).then(refreshCounts).then(function () {
        broadcast('data:outbox', { count: state.outboxCount });
        if (online() && !(opts && opts.noFlush)) scheduleFlush(300);
        return rec;
      });
    });
  }
  data._enqueue = enqueue;

  /* Drop the queued ops a coalescing op supersedes (same op, same session for heartbeats, any for push.schedule). */
  function coalesce(rec) {
    if (!Object.prototype.hasOwnProperty.call(COALESCE_OPS, rec.op)) return Promise.resolve(0);
    var by = COALESCE_OPS[rec.op];
    return table('outbox').all().then(function (ops) {
      var old = ops.filter(function (o) {
        return o.op === rec.op && o.id !== rec.id && (!by || ((o.data || {})[by] || null) === ((rec.data || {})[by] || null));
      });
      return Promise.all(old.map(function (o) { return table('outbox').delete(o.id).catch(noop); })).then(function () { return old.length; });
    }).catch(function () { return 0; });
  }

  /*
   * Best-effort immediate send that survives the page being hidden / closed (fetch keepalive, Supabase only): used by
   * the 'paused' heartbeat. The same op is also queued (same id): the server applies it once (idempotent op id).
   * @returns {boolean} true when a beacon was handed to the browser
   */
  function beacon(recs) {
    if (!isAppPage() || !online() || !be || typeof be.beacon !== 'function') return false;
    var c = state.creds;
    if (!c || c.mode !== data.mode) return false;
    try {
      return !!be.beacon(c.id, c.secret, recs.map(function (r) { return { id: r.id, op: r.op, data: r.data, created_at: r.created_at }; }));
    } catch (e) { return false; }
  }
  /* Automatic flushes run only on the app page (elected tab); elsewhere this is a no-op. */
  function scheduleFlush(ms) {
    if (!isAppPage()) return;
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(function () { state.flushTimer = null; data.flush().catch(noop); }, ms || 0);
  }

  /** Pending ops, oldest first. */
  data.outbox = function () {
    return ready().then(function () { return table('outbox').all(); }).then(function (ops) {
      return ops.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    });
  };

  function backoffMs(attempts) {
    var base = Math.min(5 * 60000, 5000 * Math.pow(2, Math.max(0, attempts - 1)));
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  function markFailed(rec, message) {
    rec.attempts = (rec.attempts || 0) + 1;
    rec.last_error = String(message || 'error').slice(0, 200);
    rec.next_at = Date.now() + backoffMs(rec.attempts);
    return table('outbox').put(rec);
  }

  /* Current consent to share the public medical layer (defence in depth: re-checked at send time). */
  function medicalConsentOk() {
    if (!NC.profile || !NC.profile.consents || typeof NC.profile.consents.get !== 'function') return Promise.resolve(true);
    return Promise.resolve(NC.profile.consents.get()).then(function (c) {
      return !c || (c.sensitive !== false && c.share_medical_in_alert !== false);
    }, function () { return true; });
  }

  function publicMedical(sessionId) {
    var mem = medicalMem[sessionId];
    var src = mem ? Promise.resolve(mem) : (NC.profile && NC.profile.get ? Promise.resolve(NC.profile.get()).then(function (p) { return p && p.public; }) : Promise.resolve(null));
    return src.then(function (pub) {
      return pub ? { blood_type: pub.blood_type || null, allergies: pub.allergies || null, conditions: pub.conditions || null, medications: pub.medications || null } : null;
    }, function () { return null; });
  }

  /*
   * What actually goes over the wire: unseal the Buddy contact, and attach the consented public medical layer only
   * at send time — and only while the CURRENT session still shares it and consent has not been withdrawn.
   */
  function wireOp(rec) {
    var o = { id: rec.id, op: rec.op, data: Object.assign({}, rec.data), created_at: rec.created_at };
    var sealed = o.data.contact_sealed;
    delete o.data.contact_sealed;
    var contactP = sealed ? unseal(sealed).then(function (c) { Object.assign(o.data, pickContact(c || {})); }) : Promise.resolve();
    if (rec.op !== 'buddy.start' && rec.op !== 'buddy.update') return contactP.then(function () { return o; });
    return contactP.then(function () {
      if (!o.data.share_public_medical) { o.data.share_public_medical = false; o.data.public_medical = null; return o; }
      return Promise.all([getSession(), medicalConsentOk()]).then(function (r) {
        var cur = r[0];
        var stillShared = !(cur && cur.id === o.data.session_id && cur.share_public_medical === false);
        if (!stillShared || !r[1]) { o.data.share_public_medical = false; o.data.public_medical = null; return o; }
        return publicMedical(o.data.session_id).then(function (pub) {
          o.data.public_medical = pub;
          if (!pub) o.data.share_public_medical = false;
          return o;
        });
      });
    }).catch(function () { o.data.share_public_medical = false; o.data.public_medical = null; return o; });
  }

  /* Surface a rejected op (A5): bus data:op_error + session.sync_error for Buddy ops. */
  function reportOpError(rec, code, message) {
    var d = rec.data || {};
    broadcast('data:op_error', { op: rec.op, code: code, message: message || code, id: rec.id, session_id: d.session_id || null });
    if (rec.op.indexOf('buddy.') !== 0 || !d.session_id) return Promise.resolve();
    return getSession().then(function (s) {
      if (!s || s.id !== d.session_id || s.sync_error === code) return null;
      s.sync_error = code;
      return putSession(s).then(function () { publish(s, null); });
    }).catch(noop);
  }
  function clearSyncError(sessionId) {
    return getSession().then(function (s) {
      if (!s || s.id !== sessionId || !s.sync_error) return null;
      s.sync_error = null;
      return putSession(s).then(function () { publish(s, null); });
    }).catch(noop);
  }

  /**
   * Send queued ops (batches of 25 via sync_device_ops). No-op offline. Cross-tab safe (Web Locks + lease).
   * App page: only the elected tab sends; another app tab delegates to it and resolves with its result.
   * Admin page (NC_PAGE set to anything but 'app'): never sends → {sent:0, failed:0, skipped:'page'}.
   * @returns {Promise<{sent:number, failed:number, dropped?:number, offline?:boolean, delegated?:boolean, skipped?:string}>}
   */
  data.flush = function () {
    if (!explicitAllowed()) return Promise.resolve({ sent: 0, failed: 0, skipped: 'page' });
    if (isAppPage() && !haveLease()) return delegateFlush();
    if (state.flushing) return state.flushing;
    state.flushing = ready().then(function () {
      if (!online()) return { sent: 0, failed: 0, offline: true };
      return withLock('nomadcare-outbox', function () {
        // Re-check inside the lock: the (shared) simulated-offline flag may have flipped while we waited.
        if (!online()) return { sent: 0, failed: 0, offline: true };
        return doFlush();
      });
    }).then(function (r) {
      state.flushing = null;
      return r;
    }, function (e) {
      state.flushing = null;
      throw e;
    });
    return state.flushing;
  };

  /* Ask the elected app tab to flush; resolve with its data:sync result (or a neutral one after a timeout). */
  function delegateFlush() {
    return ready().then(function () {
      if (!online()) return { sent: 0, failed: 0, offline: true };
      return new Promise(function (resolve) {
        var done = false;
        var off = on('data:sync', function (p, meta) { if (meta && meta.remote) finish(p); });
        var timer = setTimeout(function () { finish(null); }, DELEGATE_WAIT_MS);
        function finish(p) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { off(); } catch (e) { /* ignore */ }
          refreshCounts().then(function () {
            resolve({ sent: (p && p.sent) || 0, failed: (p && p.failed) || 0, delegated: true });
          });
        }
        broadcast('data:flush_req', { tab: tabId() });
      });
    });
  }

  function doFlush() {
    var res = { sent: 0, failed: 0, dropped: 0 };
    var creds = null;
    var sessionTouched = null;

    function finish() {
      return refreshCounts().then(function () {
        if (res.sent || res.failed || res.heartbeat) {
          state.lastSyncAt = nowIso();
          kv().set(SYNC_KEY, state.lastSyncAt).catch(noop);
        }
        broadcast('data:outbox', { count: state.outboxCount });
        broadcast('data:sync', { sent: res.sent, failed: res.failed, outboxCount: state.outboxCount, at: state.lastSyncAt });
        delete res.heartbeat;
        return res;
      });
    }

    function ensureCreds(ops) {
      return loadCreds().then(function (c) {
        if (c && c.id) return c;
        if (!ops.length && !(state.hasSession)) return null;
        return registerNow().catch(function (e) {
          res.failed++;
          return Promise.all(ops.filter(function (o) { return o.op === 'device.register'; }).map(function (o) { return markFailed(o, e.message); })).then(function () { return null; });
        });
      });
    }

    function sendBatch(batch, retried) {
      return Promise.all(batch.map(wireOp)).then(function (wire) {
        return be.sync_device_ops(creds.id, creds.secret, wire);
      }).then(function (out) {
        var byId = {};
        ((out && out.results) || []).forEach(function (r) { byId[r.id] = r; });
        return batch.reduce(function (p, rec) {
          return p.then(function () {
            var r = byId[rec.id];
            if (r && (r.status === 'ok' || r.status === 'duplicate')) {
              res.sent++;
              return table('outbox').delete(rec.id).then(function () { return applyResult(rec, r, out.server_time); });
            }
            var code = r ? String(r.error || 'error') : 'no_result';
            if (code.indexOf('session_not_found') >= 0 && rec.data && rec.data.session_id) {
              // An op of a session the server can never know (its start was rejected for good, or the session is closed
              // / replaced locally) is dropped; otherwise the server lost it (demo reset) → re-send buddy.start first.
              return sessionFate(rec.data.session_id).then(function (fate) {
                if (fate === 'dead') { res.dropped++; return table('outbox').delete(rec.id); }
                // 'pending': its buddy.start is still queued (retrying) → just wait for it; 'lost' → re-send the start.
                return (fate === 'lost' ? recoverSession(rec) : Promise.resolve()).then(function () { res.failed++; return markFailed(rec, code); });
              });
            }
            var permanent = (r && r.retryable === false) || PERMANENT_ERRORS.some(function (c) { return code.indexOf(c) >= 0; });
            // Tell the UI once per distinct error (and when the op is finally dropped).
            var report = r && (rec.last_error !== code || (permanent && (rec.attempts || 0) >= 1)) ? reportOpError(rec, code, r.message || null) : Promise.resolve();
            return report.then(function () {
              if (permanent && (rec.attempts || 0) >= 1) {
                res.dropped++;
                return table('outbox').delete(rec.id).then(function () {
                  // A buddy.start refused for good: the session's later ops (check-ins, SOS, stop) can never be accepted.
                  return rec.op === 'buddy.start' && rec.data && rec.data.session_id ? dropSessionOps(rec.data.session_id) : null;
                });
              }
              res.failed++;
              return markFailed(rec, code);
            });
          });
        }, Promise.resolve()).then(function () {
          if (out && out.session) sessionTouched = out.session;
          return true;
        });
      }, function (e) {
        if (e && DEVICE_ERRORS.indexOf(e.code) >= 0 && !retried) {
          return dropCreds().then(registerNow).then(function (c) { creds = c; return sendBatch(batch, true); });
        }
        res.failed += batch.length;
        return Promise.all(batch.map(function (rec) { return markFailed(rec, (e && (e.code || e.message)) || 'network'); })).then(function () { return false; });
      });
    }

    // 1) an erase tombstone of a wiped identity (own credentials), 2) the queue of the current device.
    return flushTombstones().catch(noop).then(function () {
      return Promise.all([table('outbox').all(), getSession()]);
    }).then(function (r) {
      var ops = r[0].sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      var sess = r[1];
      state.hasSession = !!(sess && sess.status !== 'closed');
      return ensureCreds(ops).then(function (c) {
        creds = c;
        if (!creds) return finish();
        // Leftover registration ops are fulfilled once credentials exist.
        ops.filter(function (o) { return o.op === 'device.register'; }).forEach(function (o) { table('outbox').delete(o.id).catch(noop); });
        var now = Date.now();
        var due = ops.filter(function (o) { return o.op !== 'device.register' && (o.next_at || 0) <= now; });
        var batches = [];
        for (var i = 0; i < due.length; i += BATCH) batches.push(due.slice(i, i + BATCH));
        var chain = batches.reduce(function (p, b) {
          return p.then(function (okSoFar) { return okSoFar === false ? false : sendBatch(b, false); });
        }, Promise.resolve(true));
        return chain.then(function () {
          // Heartbeat: refresh the server view of an open session even with nothing to send (alerted/overdue by cron).
          if (!due.length && state.hasSession) {
            return be.sync_device_ops(creds.id, creds.secret, []).then(function (out) {
              res.heartbeat = true;
              if (out && out.session) sessionTouched = out.session;
            }).catch(function (e) {
              if (e && DEVICE_ERRORS.indexOf(e.code) >= 0) return dropCreds();
              return null;
            });
          }
          return null;
        }).then(function () {
          return sessionTouched ? mergeServerSession(sessionTouched, {}) : null;
        }).then(finish);
      });
    });
  }

  /* Mark local events (the op's own + derived ones, e.g. 'resolved' after a check-in) as received once acknowledged. */
  function applyResult(rec, r, serverTime) {
    var d = rec.data || {};
    var ids = [];
    if (d.event_id) ids.push(d.event_id);
    (rec.derived || []).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var at = (r.data && r.data.received_at) || serverTime || nowIso();
    var jobs = ids.map(function (evId) {
      return table('events').get(evId).then(function (ev) {
        if (!ev) return null;
        ev.received_at = at;
        return table('events').put(ev).then(function () { broadcast('buddy:event', { event: ev }); });
      }).catch(noop);
    });
    if (rec.op.indexOf('buddy.') === 0 && d.session_id) jobs.push(clearSyncError(d.session_id));
    return Promise.all(jobs);
  }

  /* recipient_email_required: an older server (before 20260930000100) that still requires the e-mail;
     recipient_phone_not_mobile: a Vietnamese 02x landline (20261002000100). */
  var START_REFUSED = ['recipient_email_required', 'recipient_phone_required', 'recipient_phone_invalid', 'recipient_phone_not_mobile',
    'recipient_email_invalid', 'rate_limited'];
  /*
   * What to do with an op the server answered 'session_not_found' for:
   * 'pending' (its buddy.start is still queued), 'dead' (not the local open session any more, or its start was refused
   * for good → the server can never learn it) or 'lost' (server forgot an open session, e.g. demo reset → re-send start).
   */
  function sessionFate(sid) {
    return Promise.all([getSession(), table('outbox').all()]).then(function (r) {
      var s = r[0];
      var startQueued = r[1].some(function (o) { return o.op === 'buddy.start' && o.data && o.data.session_id === sid; });
      if (startQueued) return 'pending';
      if (!s || s.id !== sid || s.status === 'closed') return 'dead';
      return START_REFUSED.some(function (c) { return String(s.sync_error || '').indexOf(c) >= 0; }) ? 'dead' : 'lost';
    }).catch(function () { return 'lost'; });
  }
  /* Remove every queued op of a session (after its buddy.start was dropped as permanent). */
  function dropSessionOps(sid) {
    return table('outbox').all().then(function (ops) {
      return Promise.all(ops.filter(function (o) { return o.data && o.data.session_id === sid && o.op.indexOf('buddy.') === 0; })
        .map(function (o) { return table('outbox').delete(o.id).catch(noop); }));
    }).catch(noop);
  }

  /* Server lost our session (e.g. demo reset) → re-send buddy.start (same session id) before the pending ops. */
  function recoverSession(rec) {
    var sid = rec.data.session_id;
    if (recovering[sid]) return Promise.resolve();
    return getSession().then(function (s) {
      if (!s || s.id !== sid || s.status === 'closed') return null;
      recovering[sid] = true;
      var created = new Date(Date.parse(rec.created_at) - 1).toISOString();
      return enqueue('buddy.start', startPayload(s, null), { created_at: created, noFlush: true }).then(function () {
        setTimeout(function () { delete recovering[sid]; }, 60000);
      });
    });
  }

  /* ================================================================== erase tombstone (A2/A3) */

  /*
   * Everything the server needs to forget this device, WITHOUT personal data: the device credential plus a buddy.stop
   * (open session, no coordinates) and a device.erase op. Kept in kv until device.erase is acknowledged.
   */
  function makeTombstone(creds, sess, mode) {
    var now = nowIso();
    var ops = [];
    if (sess && sess.status !== 'closed' && sess.id) {
      ops.push({ id: uuid(), op: 'buddy.stop', data: { session_id: sess.id, event_id: null, client_ts: now, lat: null, lng: null, queued: !online(), note: null }, created_at: now });
    }
    ops.push({ id: uuid(), op: 'device.erase', data: { client_ts: now }, created_at: now });
    return { device_id: creds.id, secret: creds.secret, mode: mode, ops: ops, at: now, attempts: 0 };
  }

  function refreshErasePending() {
    return Promise.all([kv().get(ERASE_KEY).catch(function () { return null; }), kv().get(ERASE_OTHER_KEY).catch(function () { return null; })]).then(function (r) {
      state.erasePending = !!((r[0] && r[0].device_id) || (r[1] && r[1].device_id));
      return state.erasePending;
    }, function () { return state.erasePending; });
  }

  /** Pending server erase (tombstone) or null. @returns {Promise<null|{at:string, mode:string}>} */
  data.erasePending = function () {
    return ready().then(function () { return Promise.all([kv().get(ERASE_KEY), kv().get(ERASE_OTHER_KEY)]); }).then(function (r) {
      var t = (r[0] && r[0].device_id) ? r[0] : ((r[1] && r[1].device_id) ? r[1] : null);
      state.erasePending = !!t;
      return t ? { at: t.at, mode: t.mode || data.mode } : null;
    }).catch(function () { return null; });
  };

  function sendTombstone(key, t) {
    var er = t.ops.filter(function (o) { return o.op === 'device.erase'; })[0];
    function done() { return kv().del(key).then(function () { return true; }, function () { return true; }); }
    return be.sync_device_ops(t.device_id, t.secret, t.ops).then(function (out) {
      var byId = {};
      ((out && out.results) || []).forEach(function (x) { byId[x.id] = x; });
      var r = er ? byId[er.id] : null;
      if (r && (r.status === 'ok' || r.status === 'duplicate')) return done();
      var code = r ? String(r.error || 'error') : 'no_result';
      // Keep only what is still unacknowledged (the stop may already have closed the session).
      t.ops = t.ops.filter(function (o) { var x = byId[o.id]; return o.op === 'device.erase' || !(x && (x.status === 'ok' || x.status === 'duplicate')); });
      t.attempts = (t.attempts || 0) + 1;
      t.last_error = code;
      broadcast('data:op_error', { op: 'device.erase', code: code, message: (r && r.message) || code, id: er ? er.id : null, session_id: null });
      // A server without device.erase (unknown_op) will never accept it: stop retrying after a few attempts.
      if (t.attempts >= ERASE_MAX_ATTEMPTS && /unknown_op|invalid_op|not_supported/.test(code)) return done();
      return kv().set(key, t).then(function () { return false; });
    }, function (e) {
      // The device no longer exists on the server (already erased / demo reset) → nothing left to erase.
      if (e && DEVICE_ERRORS.indexOf(e.code) >= 0) return done();
      return false;   // network etc. → retried at the next online transition / flush
    });
  }

  /* Send every tombstone of the active backend mode. Resolves true when none is left pending. */
  function flushTombstones() {
    if (!be || typeof be.sync_device_ops !== 'function') return Promise.resolve(false);
    if (!online()) return refreshErasePending().then(function (p) { return !p; });
    if (state.erasing) return state.erasing;
    state.erasing = Promise.all([kv().get(ERASE_KEY).catch(function () { return null; }), kv().get(ERASE_OTHER_KEY).catch(function () { return null; })]).then(function (r) {
      var jobs = [];
      [[ERASE_KEY, r[0]], [ERASE_OTHER_KEY, r[1]]].forEach(function (x) {
        var t = x[1];
        if (!t || !t.device_id || !t.secret) return;
        if ((t.mode || data.mode) !== data.mode) return;   // other backend: sent when that backend is active
        jobs.push(sendTombstone(x[0], t));
      });
      return Promise.all(jobs);
    }).then(function () { return refreshErasePending(); }).then(function (pending) {
      state.erasing = null;
      return !pending;
    }, function () { state.erasing = null; return false; });
    return state.erasing;
  }

  /* ================================================================== buddy (MOD.04) */

  var SESSION_FIELDS = ['status', 'next_due_at', 'last_checkin_at', 'alerted_at', 'closed_at', 'last_lat', 'last_lng', 'last_location_at', 'interval_min', 'grace_min', 'alert_reason'];

  /*
   * The session record in kv never holds the contact in clear: {…session, contact_sealed}. getSession() returns the
   * full object (contact unsealed, cached in memory per session); putSession() re-seals only when the contact changed.
   */
  function getSession() {
    return kv().get(SESSION_KEY).catch(function () { return null; }).then(function (rec) {
      if (!rec || typeof rec !== 'object') return null;
      var sealed = rec.contact_sealed;
      if (!sealed) return rec;   // legacy plaintext record (migrated by migrateSession / next putSession)
      delete rec.contact_sealed;
      var mem = contactMem[rec.id];
      var p = mem && mem.sealed && mem.sealed.data === sealed.data && mem.sealed.v === sealed.v
        ? Promise.resolve(mem.contact)
        : unseal(sealed).then(function (c) { c = c || {}; contactMem[rec.id] = { sealed: sealed, contact: c, json: JSON.stringify(pickContact(c)) }; return c; });
      return p.then(function (c) {
        CONTACT_FIELDS.forEach(function (k) { rec[k] = c && c[k] !== undefined ? c[k] : null; });
        return rec;
      });
    });
  }
  function putSession(s) {
    if (!s) return kv().del(SESSION_KEY);
    var contact = pickContact(s);
    var json = JSON.stringify(contact);
    var mem = contactMem[s.id];
    var sealP = mem && mem.json === json && mem.sealed ? Promise.resolve(mem.sealed)
      : seal(contact).then(function (x) { contactMem[s.id] = { sealed: x, contact: contact, json: json }; return x; });
    return sealP.then(function (x) {
      var rec = withoutContact(s);
      rec.contact_sealed = x;
      return kv().set(SESSION_KEY, rec);
    });
  }
  /* One-time upgrade of a session stored before sealing existed. */
  function migrateSession() {
    return kv().get(SESSION_KEY).then(function (rec) {
      if (!rec || rec.contact_sealed) return null;
      return putSession(rec);
    }).catch(noop);
  }

  /* traveler_name: trimmed, ≤ 60 chars, no links (A5 — the server applies the same rule). */
  function cleanName(v) {
    if (v === undefined || v === null) return null;
    var t = String(v).replace(/\b(?:https?:\/\/|www\.)\S*/gi, ' ').replace(/https?/gi, ' ').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 60).trim() : null;
  }

  function lastPosition() {
    var p = setting('last_position', null);
    return p && isFinite(p.lat) && isFinite(p.lng) ? p : null;
  }

  /**
   * Position attached to an event: the explicit {lat,lng} of the call, else the FRESHEST last-known position among
   * settings.last_position (GPS/simulator) and the session's own last location (e.g. an earlier explicit check-in).
   * Fallback positions are flagged so the event meta says "last known" (with its timestamp).
   */
  function position(o, s) {
    if (o && o.lat !== undefined && o.lat !== null && o.lng !== undefined && o.lng !== null && isFinite(o.lat) && isFinite(o.lng)) {
      return { lat: +o.lat, lng: +o.lng, accuracy_m: o.accuracy_m !== undefined ? o.accuracy_m : null, fallback: false };
    }
    var cands = [];
    var lp = lastPosition();
    if (lp) cands.push({ lat: +lp.lat, lng: +lp.lng, accuracy_m: lp.accuracy_m || null, at: lp.at || null, source: lp.source || null });
    if (s && s.last_lat !== null && s.last_lat !== undefined && s.last_lng !== null && s.last_lng !== undefined && isFinite(s.last_lat) && isFinite(s.last_lng)) {
      cands.push({ lat: +s.last_lat, lng: +s.last_lng, accuracy_m: null, at: s.last_location_at || null, source: 'session' });
    }
    if (!cands.length) return null;
    var ts = function (c) { var v = c.at ? Date.parse(c.at) : NaN; return isFinite(v) ? v : -Infinity; };
    var best = cands.reduce(function (a, b) { return ts(b) > ts(a) ? b : a; });
    best.fallback = true;
    return best;
  }

  function localEvent(s, kind, pos, extra) {
    extra = extra || {};
    var meta = extra.meta || null;
    if (pos && pos.fallback) meta = Object.assign({}, meta || {}, { position: 'last_known', position_at: pos.at || null });
    var ev = {
      id: uuid(), session_id: s ? s.id : null, kind: kind, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null,
      accuracy_m: pos ? pos.accuracy_m : null, client_ts: extra.client_ts || nowIso(), received_at: extra.received_at || null,
      queued: extra.queued !== undefined ? extra.queued : !online(), note: extra.note || null, meta: meta
    };
    return table('events').put(ev).then(function () { return ev; });
  }

  function startPayload(s, ev) {
    return {
      session_id: s.id, event_id: ev ? ev.id : null, traveler_name: s.traveler_name, recipient_name: s.recipient_name,
      recipient_email: s.recipient_email, recipient_phone: s.recipient_phone, interval_min: s.interval_min, grace_min: s.grace_min,
      route_id: s.route_id, travel_mode: s.travel_mode, share_public_medical: !!s.share_public_medical,
      started_at: s.started_at, client_ts: s.started_at, lat: s.last_lat, lng: s.last_lng, queued: ev ? ev.queued : false
    };
  }

  function publish(s, ev) {
    if (s !== undefined) broadcast('buddy:update', { session: s || null });
    if (ev) broadcast('buddy:event', { event: ev });
  }

  function hasPendingBuddyOps(sessionId) {
    return table('outbox').all().then(function (ops) {
      // a queued heartbeat never changes the session state: it must not keep the server's view out
      return ops.some(function (o) { return o.op.indexOf('buddy.') === 0 && o.op !== 'buddy.heartbeat' && o.data && o.data.session_id === sessionId; });
    });
  }

  /* Adopt the server's view of our session when nothing local is pending (e.g. cron marked it overdue/alerted). */
  function mergeServerSession(srv, opts) {
    return getSession().then(function (cur) {
      if (!cur || !srv || cur.id !== srv.id) return null;
      return hasPendingBuddyOps(cur.id).then(function (pending) {
        if (pending) return null;
        var prev = cur.status;
        var changed = false;
        SESSION_FIELDS.forEach(function (k) {
          if (srv[k] === undefined) return;
          if (JSON.stringify(cur[k]) !== JSON.stringify(srv[k])) { cur[k] = srv[k]; changed = true; }
        });
        if (!cur.synced) { cur.synced = true; changed = true; }
        if (!changed) return null;
        var job = Promise.resolve(null);
        if (srv.status === 'alerted' && prev !== 'alerted') {
          job = localEvent(cur, 'alert_sent', srv.last_lat !== null && srv.last_lat !== undefined ? { lat: srv.last_lat, lng: srv.last_lng, accuracy_m: null } : null,
            { queued: false, received_at: srv.alerted_at || nowIso(), client_ts: srv.alerted_at || nowIso(),
              meta: { source: 'server', realtime: !!(opts && opts.realtime), alert_reason: srv.alert_reason || null } });
        } else if (srv.status === 'overdue' && prev === 'active') {
          // alert_reason 'contact_lost' (round 2 R6): the server stopped hearing the heartbeat of a live session
          job = localEvent(cur, 'overdue', null, { queued: false, received_at: nowIso(),
            meta: srv.alert_reason === 'contact_lost' ? { source: 'server', reason: 'contact_lost' } : { source: 'server' } });
        }
        return job.then(function (ev) {
          return putSession(cur).then(function () { publish(cur, ev); return cur; });
        });
      });
    });
  }

  var buddy = data.buddy = {
    /**
     * Start a dead-man-switch session (closes a previous open one). Works offline (queued).
     * @param {{traveler_name?, recipient:{name,email,phone}, interval_min?, grace_min?, route_id?, travel_mode?,
     *          share_public_medical?, public_medical?, lat?, lng?, accuracy_m?}} opts
     * @returns {Promise<Object>} Session
     */
    start: function (opts) {
      opts = opts || {};
      var rcp = opts.recipient || {};
      // Round 2 (R7): the recipient phone is required (on-device SMS fallback), the e-mail is optional (the only channel
      // the server alerts through by itself) but must be valid when given. Same rules as the server (backend-local
      // opBuddyStart / app_private.op_buddy_start) → refuse a session it would reject, before touching state.
      // 20261002000100: a Vietnamese landline (02x) cannot receive the SMS → 'recipient_phone_not_mobile'.
      var phone = shared.normPhone ? shared.normPhone(rcp.phone) : { empty: !rcp.phone, valid: !!rcp.phone, e164: rcp.phone || null };
      var email = rcp.email === null || rcp.email === undefined ? '' : String(rcp.email).trim();
      if (!phone.empty && !phone.e164) return Promise.reject(err('recipient_phone_invalid', 'recipient.phone is not a valid phone number'));
      if (email && !(shared.validEmail ? shared.validEmail(email) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return Promise.reject(err('recipient_email_invalid', 'recipient.email is not a valid e-mail address'));
      }
      if (phone.empty) return Promise.reject(err('recipient_phone_required', 'recipient.phone is required'));
      if (!phone.valid) {
        return Promise.reject(phone.landline ? err('recipient_phone_not_mobile', 'recipient.phone is a Vietnamese landline (02x): it cannot receive SMS')
          : err('recipient_phone_invalid', 'recipient.phone is not a valid phone number'));
      }
      return ready().then(getSession).then(function (cur) {
        return cur && cur.status !== 'closed' ? buddy.stop() : null;
      }).then(function () {
        var now = nowIso();
        var interval = Math.max(1, Math.min(24 * 60, Math.round(+opts.interval_min || 60)));
        var grace = opts.grace_min !== undefined && opts.grace_min !== null && +opts.grace_min >= 0 ? Math.round(+opts.grace_min) : 15;
        var pos = position(opts);
        var share = !!opts.share_public_medical;
        var s = {
          id: uuid(), traveler_name: cleanName(opts.traveler_name), recipient_name: rcp.name || null,
          recipient_email: email || null,
          recipient_phone: phone.e164, interval_min: interval, grace_min: grace,
          route_id: opts.route_id || setting('route_id', cfg().defaultRoute || null), travel_mode: opts.travel_mode || setting('travel_mode', 'motorbike'),
          share_public_medical: share, status: 'active', started_at: now, last_checkin_at: now, next_due_at: addMin(now, interval),
          last_lat: pos ? pos.lat : null, last_lng: pos ? pos.lng : null, last_location_at: pos ? (pos.at || now) : null,
          alerted_at: null, closed_at: null, alert_reason: null, sync_error: null, synced: false
        };
        medicalMem[s.id] = share && opts.public_medical ? opts.public_medical : null;
        var ev;
        return putSession(s).then(function () { return localEvent(s, 'start', pos, { client_ts: now }); }).then(function (e) {
          ev = e;
          return enqueue('buddy.start', startPayload(s, ev));
        }).then(function () {
          data.device().catch(function () { });
          publish(s, ev);
          return s;
        });
      });
    },

    /**
     * Record a check-in/location/pre_deadzone/sos/overdue event. 'checkin' re-arms the timer (overdue/alerted → active).
     * Without an open session the event is only logged locally (never sent).
     * @returns {Promise<Object>} Event
     */
    checkin: function (o) {
      o = o || {};
      var kind = o.kind || 'checkin';
      if (['checkin', 'location', 'pre_deadzone', 'sos', 'overdue'].indexOf(kind) < 0) return Promise.reject(err('invalid_kind', 'Invalid kind ' + kind));
      return ready().then(getSession).then(function (s) {
        var pos = position(o, s);
        var now = nowIso();
        if (!s || s.status === 'closed') {
          return localEvent(null, kind, pos, { note: o.note, meta: Object.assign({ no_session: true }, o.meta || {}), queued: false }).then(function (ev) {
            publish(undefined, ev);
            return ev;
          });
        }
        var events = [];
        return localEvent(s, kind, pos, { note: o.note, meta: o.meta || null, client_ts: now }).then(function (ev) {
          events.push(ev);
          if (pos) { s.last_lat = pos.lat; s.last_lng = pos.lng; s.last_location_at = pos.fallback ? (pos.at || now) : now; }
          if (kind === 'checkin') {
            s.last_checkin_at = now;
            s.next_due_at = addMin(now, s.interval_min);
            if (s.status === 'overdue' || s.status === 'alerted') {
              var prev = s.status;
              s.status = 'active';
              s.alerted_at = null;
              s.alert_reason = null;
              // Derived from this check-in (the server records its own 'resolved'): acknowledged with the check-in op.
              return localEvent(s, 'resolved', pos, { meta: { reason: 'checkin', previous_status: prev, parent_event_id: ev.id } }).then(function (r) { events.push(r); return ev; });
            }
          } else if (kind === 'sos') {
            // SOS always means "alert now" (also when already overdue); the server alerts with reason 'sos'.
            if (s.status === 'active' || s.status === 'overdue') { s.status = 'overdue'; s.alert_reason = 'sos'; }
          } else if (kind === 'overdue' && s.status === 'active') {
            s.status = 'overdue';
            s.alert_reason = 'overdue';
          }
          return ev;
        }).then(function (ev) {
          s.synced = false;
          return putSession(s).then(function () {
            return enqueue('buddy.checkin', {
              session_id: s.id, event_id: ev.id, kind: kind, lat: ev.lat, lng: ev.lng, accuracy_m: ev.accuracy_m,
              client_ts: ev.client_ts, note: ev.note, queued: ev.queued, meta: ev.meta
            }, { derived: events.slice(1).map(function (e) { return e.id; }) });
          }).then(function () {
            publish(s, null);
            events.forEach(function (e) { publish(undefined, e); });
            return ev;
          });
        });
      });
    },

    /** Close the session (queued when offline). @returns {Promise<Object|null>} closed session */
    stop: function (o) {
      return ready().then(getSession).then(function (s) {
        if (!s || s.status === 'closed') return null;
        var now = nowIso();
        var pos = position(o || {}, s);
        s.status = 'closed'; s.closed_at = now; s.synced = false;
        var ev;
        return localEvent(s, 'stop', pos, { client_ts: now }).then(function (e) {
          ev = e;
          return putSession(s);
        }).then(function () {
          return enqueue('buddy.stop', { session_id: s.id, event_id: ev.id, client_ts: now, lat: ev.lat, lng: ev.lng, queued: ev.queued });
        }).then(function () {
          delete medicalMem[s.id];
          broadcast('buddy:update', { session: null, closed: s });
          publish(undefined, ev);
          return s;
        });
      });
    },

    /** "Tôi an toàn": leave overdue/alerted, re-arm timer (event 'resolved'). On an active session it is a normal check-in. */
    resolve: function (o) {
      return ready().then(getSession).then(function (s) {
        if (!s || s.status === 'closed') return null;
        if (s.status === 'active') return buddy.checkin(Object.assign({}, o || {}, { kind: 'checkin' })).then(getSession);
        var now = nowIso();
        var pos = position(o || {}, s);
        var prev = s.status;
        s.status = 'active'; s.alerted_at = null; s.alert_reason = null; s.last_checkin_at = now; s.next_due_at = addMin(now, s.interval_min); s.synced = false;
        if (pos) { s.last_lat = pos.lat; s.last_lng = pos.lng; s.last_location_at = pos.fallback ? (pos.at || now) : now; }
        var ev;
        return localEvent(s, 'resolved', pos, { client_ts: now, meta: { by: 'traveler', previous_status: prev } }).then(function (e) {
          ev = e;
          return putSession(s);
        }).then(function () {
          return enqueue('buddy.resolve', { session_id: s.id, event_id: ev.id, client_ts: now, lat: ev.lat, lng: ev.lng, queued: ev.queued });
        }).then(function () { publish(s, ev); return s; });
      });
    },

    /**
     * Change what the open session shares with the recipient (A1), e.g. after consent withdrawal:
     * {share_public_medical:false} → the server nulls public_medical at once. Queued offline like any op.
     * The medical layer itself is attached only at send time (from `public_medical`, else the current profile).
     * @param {{share_public_medical:boolean, public_medical?:Object|null}} patch
     * @returns {Promise<Object|null>} updated session, or null when no session is open
     */
    update: function (patch) {
      patch = patch || {};
      return ready().then(getSession).then(function (s) {
        if (!s || s.status === 'closed') return null;
        var share = patch.share_public_medical !== undefined ? !!patch.share_public_medical : !!s.share_public_medical;
        if (share && patch.public_medical) medicalMem[s.id] = patch.public_medical;
        if (!share || patch.public_medical === null) medicalMem[s.id] = null;
        s.share_public_medical = share;
        s.synced = false;
        return putSession(s).then(function () {
          return enqueue('buddy.update', { session_id: s.id, share_public_medical: share, public_medical: null, client_ts: nowIso() });
        }).then(function () { publish(s, null); return s; });
      });
    },

    /**
     * Heartbeat of the open session (round 2 R6): {session_id?, state:'live'|'paused', lat, lng, accuracy_m,
     * silence_until}. Coalesced in the outbox (only the latest per session is kept). opts.beacon (hidden / pagehide)
     * with the caller's session_id → also sent at once with fetch keepalive (Supabase), without waiting for storage.
     * @returns {Promise<Object|null>} queued op, or null without an open session
     */
    heartbeat: function (o, opts) {
      o = o || {}; opts = opts || {};
      var state = o.state === 'paused' ? 'paused' : 'live';
      var fin = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };
      var build = function (sid) {
        var lat = fin(o.lat), lng = fin(o.lng);
        var okLL = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        var su = o.silence_until ? new Date(o.silence_until) : null;
        return { session_id: sid, state: state, lat: okLL ? lat : null, lng: okLL ? lng : null,
          accuracy_m: okLL ? fin(o.accuracy_m) : null, silence_until: su && isFinite(su.getTime()) ? su.toISOString() : null, client_ts: nowIso() };
      };
      if (o.session_id && opts.beacon) {
        var d = build(o.session_id);
        var id = uuid(), created = nowIso();
        beacon([{ id: id, op: 'buddy.heartbeat', data: d, created_at: created }]);
        return ready().then(function () { return enqueue('buddy.heartbeat', d, { id: id, created_at: created }); });
      }
      return ready().then(getSession).then(function (s) {
        if (!s || s.status === 'closed' || (o.session_id && o.session_id !== s.id)) return null;
        return enqueue('buddy.heartbeat', build(s.id));
      });
    },

    /** Open session (active/overdue/alerted) or null. */
    current: function () {
      return ready().then(getSession).then(function (s) { return s && s.status !== 'closed' ? s : null; });
    },

    /** Local event log of a session (default: current/last one), oldest first. */
    events: function (sessionId) {
      return ready().then(function () { return Promise.all([table('events').all(), sessionId ? null : getSession()]); }).then(function (r) {
        var sid = sessionId || (r[1] ? r[1].id : null);
        return r[0].filter(function (e) { return sid ? e.session_id === sid : true; })
          .sort(function (a, b) { return String(a.client_ts).localeCompare(String(b.client_ts)); });
      });
    },

    /**
     * Local dead-man check (every 10 s): now > next_due_at + grace → 'overdue' event + queued alert op.
     * @param {{now?:number}} [opts] test hook: evaluate at a given epoch ms
     * @returns {Promise<Object|null>} session when it just became overdue
     */
    tick: function (opts) {
      if (!explicitAllowed()) return Promise.resolve(null);   // admin page never ticks the device session
      return ready().then(function () {
        return withLock('nomadcare-buddy', function () {
          return getSession().then(function (s) {
            if (!s || s.status !== 'active' || !s.next_due_at) return null;
            var now = (opts && opts.now) || Date.now();
            if (now <= Date.parse(s.next_due_at) + (s.grace_min || 0) * 60000) return null;
            s.status = 'overdue';
            s.alert_reason = 'overdue';
            s.synced = false;
            var pos = s.last_lat !== null && s.last_lat !== undefined ? { lat: s.last_lat, lng: s.last_lng, accuracy_m: null } : null;
            var ev;
            return localEvent(s, 'overdue', pos, { meta: { source: 'device', due_at: s.next_due_at, grace_min: s.grace_min } }).then(function (e) {
              ev = e;
              return putSession(s);
            }).then(function () {
              return enqueue('buddy.checkin', { session_id: s.id, event_id: ev.id, kind: 'overdue', lat: ev.lat, lng: ev.lng, client_ts: ev.client_ts, queued: ev.queued, meta: ev.meta });
            }).then(function () { publish(s, ev); return s; });
          });
        });
      });
    }
  };

  /* ================================================================== Web Push (round 2 R6) */

  /*
   * Device ops of the Web Push reminders (Supabase mode; the local mock only stores them). Same checks as the
   * servers (NC.backend.shared.validPushEndpoint / validPushKeys / pushScheduleItems = app_private.*): refused up front.
   */
  data.push = {
    /** {endpoint, p256dh, auth, lang} of a PushSubscription → op push.subscribe (upsert by endpoint). */
    subscribe: function (sub) {
      sub = sub || {};
      if (shared.validPushEndpoint && !shared.validPushEndpoint(sub.endpoint)) return Promise.reject(err('invalid_push_endpoint', 'Unsupported push endpoint'));
      if (shared.validPushKeys && !shared.validPushKeys(sub.p256dh, sub.auth)) return Promise.reject(err('invalid_push_keys', 'Invalid push subscription keys'));
      return ready().then(function () {
        return enqueue('push.subscribe', { endpoint: String(sub.endpoint), p256dh: String(sub.p256dh), auth: String(sub.auth), lang: sub.lang === 'en' ? 'en' : 'vi' });
      }).then(function (op) { data.device().catch(noop); return op; });
    },
    /** Forget one endpoint (or every subscription of this device when endpoint is empty). */
    unsubscribe: function (endpoint) {
      return ready().then(function () { return enqueue('push.unsubscribe', { endpoint: endpoint ? String(endpoint) : null }); });
    },
    /** Replace this device's schedule: [{fire_at, kind:'deadzone_ahead', minutes_before, zone_km}] (≤ 20; [] clears). */
    schedule: function (items) {
      var chk = shared.pushScheduleItems ? shared.pushScheduleItems(items, Date.now()) : { error: null, items: items || [] };
      if (chk.error) return Promise.reject(err(chk.error, chk.error));
      return ready().then(function () { return enqueue('push.schedule', { items: chk.items }); });
    }
  };

  /* ================================================================== community contributions */

  /**
   * Queue a facility report ('new'|'correction'|'closed'|'signal_report'). Only coordinates + the report go to the server.
   * @returns {Promise<Object>} outbox op
   */
  data.submitReport = function (r) {
    r = r || {};
    var kind = r.kind || 'new';
    if (['new', 'correction', 'closed', 'signal_report'].indexOf(kind) < 0) return Promise.reject(err('invalid_kind', 'Invalid report kind'));
    return ready().then(function () {
      // Flat payload: the server stores data minus id as facility_submissions.payload (name/type/note/route_id/...).
      var d = {
        id: uuid(), kind: kind, facility_id: r.facility_id || null, name: r.name || null, type: r.type || null,
        note: r.note || null, route_id: r.route_id || setting('route_id', null),
        lat: r.lat !== undefined ? r.lat : null, lng: r.lng !== undefined ? r.lng : null
      };
      ['address', 'phone', 'open_hours'].forEach(function (k) { if (r[k]) d[k] = r[k]; });
      // Extra structured fields (e.g. content reports {area:'content', module, ref}; corrections {field, value}) are
      // merged FLAT: the SQL op stores `data - id` as payload, and would drop everything else if a nested
      // `payload` object were sent. Known keys above always win; only primitives are copied.
      var extra = r.payload && typeof r.payload === 'object' ? r.payload : {};
      Object.keys(extra).forEach(function (k) {
        var v = extra[k];
        if (k === 'id' || k === 'payload' || Object.prototype.hasOwnProperty.call(d, k)) return;
        if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') d[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      });
      return enqueue('report.submit', d);
    }).then(function (op) { data.device().catch(function () { }); return op; });
  };

  /**
   * Queue anonymous signal samples — only when settings.community_logs is on (explicit opt-in). Chunks of 200.
   * @param {Array<{route_id, edge_id?, carrier?, tech?, rsrp_dbm?, level?, lat, lng, measured_at?, device_model?}>} samples
   * @returns {Promise<Array|null>} queued ops or null when disabled
   */
  data.logSignal = function (samples) {
    if (!setting('community_logs', false)) return Promise.resolve(null);
    var list = (samples || []).filter(function (s) { return s && isFinite(s.lat) && isFinite(s.lng); }).map(function (s) {
      return {
        route_id: s.route_id || setting('route_id', null), edge_id: s.edge_id || null, carrier: s.carrier || carrierOf(),
        tech: s.tech || null, rsrp_dbm: s.rsrp_dbm === undefined ? null : s.rsrp_dbm,
        level: s.level || shared.levelFromRsrp(s.rsrp_dbm), lat: +s.lat, lng: +s.lng,
        measured_at: s.measured_at || nowIso(), device_model: s.device_model || null
      };
    });
    if (!list.length) return Promise.resolve([]);
    var chunks = [];
    for (var i = 0; i < list.length; i += 200) chunks.push(list.slice(i, i + 200));
    return ready().then(function () {
      return chunks.reduce(function (p, c) {
        return p.then(function (acc) { return enqueue('signal.log', { samples: c }).then(function (op) { acc.push(op); return acc; }); });
      }, Promise.resolve([]));
    }).then(function (ops) { data.device().catch(function () { }); return ops; });
  };

  /* ================================================================== privacy */

  /*
   * Move the device identity (+ an open session) into erase tombstones BEFORE local data goes away, so the server can
   * still be told to stop the session and forget the device later (offline wipe → no false alarm to the contact).
   * Resolves the number of tombstones written.
   */
  function writeTombstones() {
    return Promise.all([loadCreds(), loadOtherCreds(), getSession()]).then(function (r) {
      var cur = r[0], other = r[1], sess = r[2];
      var jobs = [];
      if (cur && cur.id && cur.secret) jobs.push(kv().set(ERASE_KEY, makeTombstone(cur, sess, data.mode)));
      // Credentials of the other backend (e.g. an earlier Supabase identity while running on the local fallback).
      if (other && other.id && other.secret) jobs.push(kv().set(ERASE_OTHER_KEY, makeTombstone(other, (cur && cur.id) ? null : sess, otherMode())));
      return Promise.all(jobs).then(function () { return jobs.length; });
    });
  }

  function trySendTombstones(ms) {
    if (!online()) return refreshErasePending();
    return timeout(flushTombstones(), ms || 6000, 'timeout').catch(noop).then(refreshErasePending);
  }

  /**
   * Erase this device's data on the SERVER (A2): its Buddy sessions/events, device ops and the device row.
   * Local personal data is kept (use wipePersonal for everything). The open session is closed locally, pending
   * ops of this identity are dropped, and a fresh anonymous identity is created on the next sync.
   * @returns {Promise<{queued:boolean, sent:boolean}>}
   */
  data.eraseServerData = function () {
    return ready().then(function () { return writeTombstones(); }).then(function (n) {
      if (!n) return { queued: false, sent: false };
      return getSession().then(function (s) {
        if (!s || s.status === 'closed') return null;
        s.status = 'closed'; s.closed_at = nowIso(); s.synced = true;
        return putSession(s).then(function () { broadcast('buddy:update', { session: null, closed: s }); });
      }).then(function () {
        return Promise.all([table('outbox').clear().catch(noop), dropCreds(), secure().remove('device.' + otherMode()) ]);
      }).then(refreshCounts).then(function () {
        medicalMem = {};
        broadcast('data:outbox', { count: state.outboxCount });
        return trySendTombstones(6000);
      }).then(function (pending) { return { queued: true, sent: !pending }; });
    });
  };

  /**
   * Delete all personal data on this device (A3): profile + consents, NC.secure (crypto-shred), Buddy session/events,
   * outbox, device credentials, per-module traces (QR export/reveals, phrase timings, first-aid timers, last routes /
   * positions, Buddy prefs, weather), settings.last_position / community_logs; settings.onboarded=false.
   * Downloaded packs are kept. The server is told to stop an open session and erase this device through an erase
   * tombstone (no personal data) that is sent now when online, else at the next online transition.
   * @returns {Promise<{pendingServerErase:boolean}>}
   */
  data.wipePersonal = function () {
    return ready().then(function () { return writeTombstones().catch(function () { return 0; }); })
      .then(wipeLocal)
      .then(function () { return trySendTombstones(6000); })
      .then(function (pending) {
        var res = { pendingServerErase: !!pending };
        broadcast('data:wiped', res);
        return res;
      });
  };

  function isPersonalKey(k) {
    if (!k || k === SESSION_KEY) return !!k;
    if (k === ERASE_KEY || k === ERASE_OTHER_KEY || k === 'settings' || k.indexOf('secure.') === 0 || k.indexOf('cache.') === 0) return false;
    if (/position|location|gps/i.test(k)) return true;
    for (var i = 0; i < WIPE_PREFIXES.length; i++) { if (k.indexOf(WIPE_PREFIXES[i]) === 0) return true; }
    return false;
  }

  function wipeLocal() {
    var jobs = [];
    if (NC.profile && NC.profile.clear) jobs.push(Promise.resolve(NC.profile.clear()).catch(noop));
    jobs.push(Promise.resolve(secure().remove('device.local')).catch(noop));
    jobs.push(Promise.resolve(secure().remove('device.supabase')).catch(noop));
    jobs.push(kv().del(SESSION_KEY).catch(noop));
    jobs.push(kv().del(SYNC_KEY).catch(noop));
    // Every per-module personal trace kept in kv (QR export/reveals, MOD.01 timings, MOD.05 anaphylaxis/CPR timers,
    // MOD.02 last route + positions, Buddy prefs, home weather for the last position, demo seed marker…).
    var store = kv();
    if (typeof store.keys === 'function') {
      jobs.push(Promise.resolve(store.keys()).then(function (keys) {
        return Promise.all((keys || []).filter(isPersonalKey).map(function (k) { return store.del(k).catch(noop); }));
      }).catch(noop));
    } else {
      ['qr.wallpaper_at', 'qr.reveals', 'tr.timings', 'fa.ana', 'fa.cpr', 'map.last_route', 'map.ui', 'bd.prefs', 'home.weather', 'demo.seeded_at']
        .forEach(function (k) { jobs.push(store.del(k).catch(noop)); });
    }
    jobs.push(table('events').clear().catch(noop));
    jobs.push(table('outbox').clear().catch(noop));
    if (NC.profile && NC.profile.consents && NC.profile.consents.clear) jobs.push(Promise.resolve(NC.profile.consents.clear()).catch(noop));
    return Promise.all(jobs).then(function () {
      // Crypto-shred last: nothing sealed with the old key can be read back (tombstones are not sealed).
      if (NC.secure && NC.secure.wipe) return Promise.resolve(NC.secure.wipe()).catch(noop);
      return null;
    }).then(function () {
      medicalMem = {};
      contactMem = {};
      recovering = {};
      state.deviceId = null;
      state.lastSyncAt = null;
      return Promise.all([setSetting('onboarded', false), setSetting('last_position', null), setSetting('community_logs', false)]);
    }).then(refreshCounts).then(function () {
      broadcast('buddy:update', { session: null });
      broadcast('data:outbox', { count: state.outboxCount });
    });
  }

  /* ================================================================== admin proxy */

  var ADMIN_METHODS = ['signIn', 'signOut', 'session', 'enterDemo', 'kpis', 'listFacilities', 'upsertFacility', 'setFacilityStatus', 'deleteFacility',
    'listServices', 'upsertService', 'listSubmissions', 'reviewSubmission', 'listSamples', 'reviewSamples', 'listSegments', 'listAccuracy',
    'listBuddySessions', 'listBuddyEvents', 'triggerAlert', 'resolveSession', 'listPacks', 'publishPack', 'packChanges', 'listContentReleases',
    'upsertContentRelease', 'approveContentRelease', 'audit', 'resetDemo'];

  /** Dashboard API — same signatures in both backends (see contract §8). */
  data.admin = {};
  ADMIN_METHODS.forEach(function (name) {
    data.admin[name] = function () {
      var args = arguments;
      return ready().then(function () {
        var a = be.admin;
        if (!a || !a[name]) throw err('not_supported', name + ' is not available');
        return a[name].apply(a, args);
      });
    };
  });
  /**
   * Realtime feed of server changes. Returns unsubscribe() synchronously.
   * @param {function({table:string,type:string,row:Object})} fn
   */
  data.admin.subscribe = function (fn) {
    var off = null, cancelled = false;
    ready().then(function () { if (!cancelled) off = be.admin.subscribe(fn); });
    return function () { cancelled = true; if (off) off(); };
  };
})(window.NC = window.NC || {});
