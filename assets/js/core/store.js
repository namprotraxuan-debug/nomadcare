/*
 * store.js — async local persistence: IndexedDB 'nomadcare' v1 (stores kv, outbox, packs, events, secure, cache)
 * with automatic fallback to localStorage (JSON) → in-memory. Also hosts NC.settings (contract §4).
 * Owner: P1 shell. Public API:
 *   NC.store.{ready(), backend ('idb'|'local'|'memory'), get, set, del, keys(prefix), table(name), wipe(), db()}
 *   NC.store.table(name).{all, get, put, bulkPut, delete, clear, count}   (keyPath 'id')
 *   NC.settings.{load(), all(), get(k), set(k, v), patch(obj), reset(), defaults()}
 */
(function (NC) {
  'use strict';

  var DB_NAME = 'nomadcare';
  var DB_VERSION = 1;
  var TABLES = ['outbox', 'packs', 'events', 'secure', 'cache'];
  var ALL_STORES = ['kv'].concat(TABLES);
  var LS_PREFIX = 'nc.fb.';
  var OPEN_TIMEOUT_MS = 3500;

  var dbPromise = null;
  var api = { backend: 'pending' };

  /* ------------------------------------------------------------------ */
  /* IndexedDB                                                            */
  /* ------------------------------------------------------------------ */
  function openIDB() {
    return new Promise(function (resolve, reject) {
      var idb = null;
      try { idb = window.indexedDB; } catch (e) { idb = null; }
      if (!idb) { reject(new Error('IndexedDB unavailable')); return; }
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('IndexedDB open timeout')); }
      }, OPEN_TIMEOUT_MS);
      var req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        TABLES.forEach(function (t) {
          if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
        });
      };
      req.onsuccess = function () {
        clearTimeout(timer);
        var db = req.result;
        if (settled) { try { db.close(); } catch (e) { /* ignore */ } return; }
        settled = true;
        db.onversionchange = function () { try { db.close(); } catch (e) { /* ignore */ } dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { clearTimeout(timer); if (!settled) { settled = true; reject(req.error || new Error('IndexedDB open error')); } };
      req.onblocked = function () { /* another tab holds an old version; wait for timeout */ };
    });
  }

  function reqP(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Fallback (localStorage JSON, else memory)                            */
  /* ------------------------------------------------------------------ */
  var mem = {};
  var lsOK = (function () {
    try { var k = '__nc_probe'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; }
    catch (e) { return false; }
  })();
  function fbLoad(store) {
    if (mem[store]) return mem[store];
    var data = {};
    if (lsOK) {
      try { data = JSON.parse(window.localStorage.getItem(LS_PREFIX + store) || '{}') || {}; } catch (e) { data = {}; }
    }
    mem[store] = data;
    return data;
  }
  function fbSave(store) {
    if (!lsOK) return;
    try { window.localStorage.setItem(LS_PREFIX + store, JSON.stringify(mem[store] || {})); }
    catch (e) { console.warn('[store] localStorage quota reached — keeping "' + store + '" in memory only'); }
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /* ------------------------------------------------------------------ */
  /* Backend selection                                                    */
  /* ------------------------------------------------------------------ */
  function ready() {
    if (!dbPromise) {
      dbPromise = openIDB().then(function (db) { api.backend = 'idb'; return db; }, function (err) {
        api.backend = lsOK ? 'local' : 'memory';
        console.warn('[store] IndexedDB unavailable (' + (err && err.message) + ') → ' + api.backend + ' fallback');
        return null;
      });
    }
    return dbPromise;
  }

  /** Run fn(objectStore) in a transaction; returns fn's request result. */
  function withStore(name, mode, fn) {
    return ready().then(function (db) {
      if (!db) return fn(null);
      var tx = db.transaction(name, mode);
      var st = tx.objectStore(name);
      var res = fn(st);
      var resP = (res && typeof res.onsuccess !== 'undefined') ? reqP(res) : Promise.resolve(res);
      return Promise.all([resP, mode === 'readwrite' ? txDone(tx) : null]).then(function (r) { return r[0]; });
    });
  }

  /* ---------- kv ---------- */
  function get(key) {
    return withStore('kv', 'readonly', function (st) {
      if (!st) return clone(fbLoad('kv')[key]);
      return st.get(key);
    }).then(function (v) { return v === undefined ? null : v; });
  }
  function set(key, val) {
    return withStore('kv', 'readwrite', function (st) {
      if (!st) { fbLoad('kv')[key] = clone(val); fbSave('kv'); return val; }
      return st.put(val, key);
    }).then(function () { return val; });
  }
  function del(key) {
    return withStore('kv', 'readwrite', function (st) {
      if (!st) { delete fbLoad('kv')[key]; fbSave('kv'); return true; }
      return st.delete(key);
    }).then(function () { return true; });
  }
  function keys(prefix) {
    return withStore('kv', 'readonly', function (st) {
      if (!st) return Object.keys(fbLoad('kv'));
      return st.getAllKeys ? st.getAllKeys() : cursorKeys(st);
    }).then(function (ks) {
      var arr = (ks || []).map(String);
      return prefix ? arr.filter(function (k) { return k.indexOf(prefix) === 0; }) : arr;
    });
  }
  function cursorKeys(st) {
    return new Promise(function (resolve, reject) {
      var out = []; var r = st.openCursor();
      r.onsuccess = function () { var c = r.result; if (c) { out.push(c.key); c.continue(); } else resolve(out); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function cursorAll(st) {
    return new Promise(function (resolve, reject) {
      var out = []; var r = st.openCursor();
      r.onsuccess = function () { var c = r.result; if (c) { out.push(c.value); c.continue(); } else resolve(out); };
      r.onerror = function () { reject(r.error); };
    });
  }

  /* ---------- tables (keyPath 'id') ---------- */
  var tableCache = {};
  function table(name) {
    if (TABLES.indexOf(name) < 0) throw new Error('[store] unknown table "' + name + '"');
    if (tableCache[name]) return tableCache[name];
    var t = {
      all: function () {
        return withStore(name, 'readonly', function (st) {
          if (!st) { var d = fbLoad(name); return Object.keys(d).map(function (k) { return clone(d[k]); }); }
          return st.getAll ? st.getAll() : cursorAll(st);
        }).then(function (r) { return r || []; });
      },
      get: function (id) {
        return withStore(name, 'readonly', function (st) {
          if (!st) return clone(fbLoad(name)[id]);
          return st.get(id);
        }).then(function (v) { return v === undefined ? null : v; });
      },
      put: function (obj) {
        if (!obj || obj.id === undefined || obj.id === null) return Promise.reject(new Error('[store] put() requires obj.id'));
        return withStore(name, 'readwrite', function (st) {
          if (!st) { fbLoad(name)[obj.id] = clone(obj); fbSave(name); return obj.id; }
          return st.put(obj);
        }).then(function () { return obj; });
      },
      bulkPut: function (arr) {
        var list = (arr || []).filter(function (o) { return o && o.id !== undefined && o.id !== null; });
        return withStore(name, 'readwrite', function (st) {
          if (!st) { var d = fbLoad(name); list.forEach(function (o) { d[o.id] = clone(o); }); fbSave(name); return list.length; }
          list.forEach(function (o) { st.put(o); });
          return list.length;
        }).then(function () { return list.length; });
      },
      delete: function (id) {
        return withStore(name, 'readwrite', function (st) {
          if (!st) { delete fbLoad(name)[id]; fbSave(name); return true; }
          return st.delete(id);
        }).then(function () { return true; });
      },
      clear: function () {
        return withStore(name, 'readwrite', function (st) {
          if (!st) { mem[name] = {}; fbSave(name); return true; }
          return st.clear();
        }).then(function () { return true; });
      },
      count: function () {
        return withStore(name, 'readonly', function (st) {
          if (!st) return Object.keys(fbLoad(name)).length;
          return st.count();
        }).then(function (n) { return n || 0; });
      }
    };
    tableCache[name] = t;
    return t;
  }

  /** Clear every store (used by ?reset=1 and "Xoá toàn bộ dữ liệu"). */
  function wipe() {
    return ready().then(function (db) {
      if (!db) {
        ALL_STORES.forEach(function (s) { mem[s] = {}; if (lsOK) { try { window.localStorage.removeItem(LS_PREFIX + s); } catch (e) { /* ignore */ } } });
        return true;
      }
      var tx = db.transaction(ALL_STORES, 'readwrite');
      ALL_STORES.forEach(function (s) { tx.objectStore(s).clear(); });
      return txDone(tx).then(function () { return true; });
    });
  }

  api.ready = ready;
  api.db = ready;
  api.get = get; api.set = set; api.del = del; api.keys = keys;
  api.table = table; api.wipe = wipe;
  api.TABLES = TABLES.slice();
  NC.store = api;

  /* ================================================================== */
  /* NC.settings                                                          */
  /* ================================================================== */
  var SETTINGS_KEY = 'settings';
  var DEFAULTS = {
    lang: 'vi',
    theme: 'auto',
    carrier: 'viettel',
    travel_mode: 'motorbike',
    route_id: 'ha-giang-loop',
    user_lang: 'en',
    onboarded: false,
    demo_timer: false,
    community_logs: false,
    simulated_offline: false,
    simulated_offline_owner: null,   // 'user' | 'simulator' (NC.net)
    last_position: null,
    nav_collapsed: false             // desktop (≥1200 px) sidebar collapsed to the icon rail (per device)
  };
  // Deployment defaults from config.js (route/carrier) when present.
  (function () {
    var cfg = window.NC_CONFIG || {};
    if (cfg.defaultRoute) DEFAULTS.route_id = cfg.defaultRoute;
    if (cfg.defaultCarrier) DEFAULTS.carrier = cfg.defaultCarrier;
  })();

  var state = clone(DEFAULTS);
  var loaded = false;
  var loadPromise = null;

  // Seed theme/lang/nav from the synchronous mirrors so early reads are right even before load().
  try {
    var t0 = window.localStorage.getItem('nc.theme'); if (t0) state.theme = t0;
    var l0 = window.localStorage.getItem('nc.lang'); if (l0) state.lang = l0;
    var n0 = window.localStorage.getItem('nc.nav_collapsed'); if (n0) state.nav_collapsed = n0 === '1';
  } catch (e) { /* ignore */ }

  /* Synchronous localStorage mirrors read by theme-init.js before first paint (no flash of the wrong theme/nav). */
  function mirror(key, value) {
    try {
      if (key === 'theme') window.localStorage.setItem('nc.theme', value || 'auto');
      if (key === 'lang') window.localStorage.setItem('nc.lang', value || 'vi');
      if (key === 'nav_collapsed') window.localStorage.setItem('nc.nav_collapsed', value ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  /** Load persisted settings (merge over defaults). Must be awaited in boot before screens mount. */
  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = get(SETTINGS_KEY).then(function (saved) {
      var s = clone(DEFAULTS);
      if (saved && typeof saved === 'object') Object.keys(saved).forEach(function (k) { s[k] = saved[k]; });
      state = s; loaded = true;
      mirror('theme', state.theme); mirror('lang', state.lang); mirror('nav_collapsed', state.nav_collapsed);
      return all();
    }, function (err) {
      console.warn('[settings] load failed, using defaults', err);
      loaded = true;
      return all();
    });
    return loadPromise;
  }
  function persist() {
    return set(SETTINGS_KEY, clone(state)).catch(function (e) { console.warn('[settings] persist failed', e); });
  }
  /** Shallow copy of all settings (sync). */
  function all() { return clone(state); }
  /** Read one setting (sync). Objects are returned as copies. */
  function getS(key) {
    var v = state[key];
    return (v && typeof v === 'object') ? clone(v) : (v === undefined ? DEFAULTS[key] : v);
  }
  /** Write one setting: updates memory, persists (async), emits 'settings:change' {key, value, settings}. */
  function setS(key, value) {
    var prev = JSON.stringify(state[key]);
    state[key] = (value && typeof value === 'object') ? clone(value) : value;
    mirror(key, value);
    var p = persist();
    if (JSON.stringify(state[key]) !== prev && NC.bus) {
      NC.bus.emit('settings:change', { key: key, value: getS(key), settings: all() });
    }
    return p;
  }
  /** Write several settings at once (one persist, one event per changed key). */
  function patch(obj) {
    var changed = [];
    Object.keys(obj || {}).forEach(function (k) {
      var prev = JSON.stringify(state[k]);
      state[k] = (obj[k] && typeof obj[k] === 'object') ? clone(obj[k]) : obj[k];
      mirror(k, obj[k]);
      if (JSON.stringify(state[k]) !== prev) changed.push(k);
    });
    var p = persist();
    if (NC.bus) changed.forEach(function (k) { NC.bus.emit('settings:change', { key: k, value: getS(k), settings: all() }); });
    return p;
  }
  function reset() { state = clone(DEFAULTS); mirror('theme', state.theme); mirror('lang', state.lang); mirror('nav_collapsed', state.nav_collapsed); return persist(); }
  function defaults() { return clone(DEFAULTS); }

  NC.settings = {
    load: load, all: all, get: getS, set: setS, patch: patch, reset: reset, defaults: defaults,
    isLoaded: function () { return loaded; }
  };
})(window.NC = window.NC || {});
