/*
 * boot.js — startup sequence (loaded last). Owner: P1 shell. No public API besides NC.boot.done (Promise).
 *   1. await NC.settings.load(); apply theme + language
 *   2. URL flags: ?reset=1 (wipe local data, reload without flag), ?theme=, ?lang=, ?offline=1|0,
 *      ?backend=local, ?demo=1 (seed demo profile/consents/settings once), ?screen=<route>
 *   3. end a stale journey-simulator "signal loss" (owner 'simulator' — a reload ends any simulation; toast once)
 *   4. await NC.data.init() when present (time-boxed so the UI never hangs)
 *   5. NC.app.start()
 * Never throws when later-phase modules (NC.data, NC.profile, screens) are missing.
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var DEMO_FLAG_KEY = 'demo.seeded_at';
  var DATA_INIT_TIMEOUT = 8000;

  function warn(step, e) { console.warn('[boot] ' + step + ' skipped:', e && (e.message || e)); }
  function safe(step, fn) {
    try { return Promise.resolve(fn()).catch(function (e) { warn(step, e); }); }
    catch (e) { warn(step, e); return Promise.resolve(); }
  }
  function timeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; console.warn('[boot] data init still pending after ' + ms + ' ms — starting UI'); resolve(); } }, ms);
      Promise.resolve(p).then(function () { if (!done) { done = true; clearTimeout(timer); resolve(); } },
        function (e) { if (!done) { done = true; clearTimeout(timer); warn('NC.data.init', e); resolve(); } });
    });
  }

  /** URL without the given query flags (hash kept). */
  function urlWithout(flags) {
    var params = U.qs();
    flags.forEach(function (f) { delete params[f]; });
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return window.location.pathname + (q ? '?' + q : '') + window.location.hash;
  }

  /* ---------- ?reset=1 ---------- */
  /*
   * "Xoá toàn bộ dữ liệu trên máy" (README). Strictly sequential:
   *   1. NC.data.wipePersonal() — reads the device credentials + open Buddy session into an erase tombstone, wipes the
   *      personal data, crypto-shreds NC.secure and sends buddy.stop + device.erase now (else at the next online
   *      transition). It MUST run before anything deletes the credentials, or the server keeps an orphaned dead-man
   *      switch that later e-mails the recipient (NOTES §1).
   *   2. NC.secure.wipe() again (no-op after step 1; the crypto-shred when the data layer is missing or failed).
   *   3. every local store cleared, the tombstones put back, settings reset to their defaults.
   *   4. localStorage 'nc.*' dropped EXCEPT what belongs to the in-browser mock server / the admin page ('nc.admin.*':
   *      admin session + prefs, 'nc.server.*': cron lease, realtime relay): an open admin tab stays signed in. The
   *      mock server DB (IndexedDB 'nomadcare-server') is never touched here.
   *   5. Cache Storage: map tiles dropped; the versioned app shell ('nc-v2-…') is kept so the reload also works offline.
   */
  var ERASE_KEYS = ['erase.pending', 'erase.pending.other'];
  var KEEP_LS = ['nc.admin.', 'nc.server.'];
  function keepLs(k) {
    for (var i = 0; i < KEEP_LS.length; i++) { if (k.indexOf(KEEP_LS[i]) === 0) return true; }
    return false;
  }
  function resetAll() {
    var tombstones = {};
    var first = (NC.data && typeof NC.data.wipePersonal === 'function')
      ? safe('data.wipePersonal', function () { return NC.data.wipePersonal(); })
      : Promise.resolve();
    return first.then(function () {
      return NC.secure ? safe('secure.wipe', function () { return NC.secure.wipe(); }) : null;
    }).then(function () {
      // A server erase that could not be sent yet (offline) must survive the full local wipe.
      return Promise.all(ERASE_KEYS.map(function (k) { return NC.store.get(k).then(function (v) { if (v) tombstones[k] = v; }).catch(function () {}); }));
    }).then(function () {
      return safe('store.wipe', function () { return NC.store.wipe(); });
    }).then(function () {
      return Promise.all(Object.keys(tombstones).map(function (k) { return NC.store.set(k, tombstones[k]).catch(function () {}); }));
    }).then(function () {
      return safe('settings.reset', function () { return NC.settings.reset && NC.settings.reset(); });
    }).then(function () {
      try {
        var ls = window.localStorage, drop = [];
        for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && k.indexOf('nc.') === 0 && !keepLs(k)) drop.push(k); }
        drop.forEach(function (k) { ls.removeItem(k); });
      } catch (e) { /* ignore */ }
      if (window.caches && caches.keys) {
        return caches.keys().then(function (ks) {
          return Promise.all(ks.filter(function (k) { return k.indexOf('nc-') === 0 && !/^nc-v\d/.test(k); }).map(function (k) { return caches.delete(k); }));
        }).catch(function () {});
      }
    });
  }

  /* ---------- ?demo=1 ---------- */
  function demoPosition() {
    var seed = window.NC_SEED;
    var nodes = (seed && seed.nodes) || [];
    var onRoute = nodes.filter(function (n) { return n.route_id === 'ha-giang-loop'; });
    var pick = onRoute.filter(function (n) { return /quan-ba|quản bạ|quan ba/i.test((n.id || '') + ' ' + (n.name || '')); })[0] ||
      onRoute.filter(function (n) { return n.kind === 'town'; })[1] || onRoute[0];
    if (pick && typeof pick.lat === 'number') return { lat: pick.lat, lng: pick.lng, at: new Date().toISOString(), source: 'sim' };
    return { lat: 23.0668, lng: 104.9835, at: new Date().toISOString(), source: 'sim' }; // Quản Bạ (fallback)
  }
  function seedDemo() {
    return NC.store.get(DEMO_FLAG_KEY).then(function (already) {
      var jobs = [];
      // Settings that make the demo self-contained (always ensure onboarded).
      var patch = { onboarded: true };
      if (!already) {
        patch.route_id = 'ha-giang-loop';
        patch.carrier = 'viettel';
        patch.travel_mode = 'motorbike';
        patch.last_position = demoPosition();
      } else if (!NC.settings.get('last_position')) {
        patch.last_position = demoPosition();
      }
      jobs.push(NC.settings.patch(patch));
      if (!already && NC.profile) {
        jobs.push(safe('demo profile', function () {
          return Promise.resolve(NC.profile.get()).then(function (existing) {
            if (existing && NC.profile.isComplete && NC.profile.isComplete(existing)) return null;
            return NC.profile.save({
              public: { blood_type: 'O+', allergies: 'Penicillin', conditions: 'Hen suyễn', medications: 'Ventolin', notes: '' },
              identity: { full_name: 'Minh Anh', nationality: 'Việt Nam', contact_name: 'Lê Hà', contact_phone: '+84 000 000 001', reveal_code: null },
              updated_at: new Date().toISOString()
            });
          });
        }));
        if (NC.profile.consents && typeof NC.profile.consents.set === 'function') {
          jobs.push(safe('demo consents', function () {
            return NC.profile.consents.set({ terms: true, sensitive: true, deadman: true, share_medical_in_alert: true, community_logs: false, at: new Date().toISOString() });
          }));
        }
      }
      return Promise.all(jobs).then(function () {
        // Only mark as seeded once the profile module could actually seed.
        if (!already && NC.profile) return NC.store.set(DEMO_FLAG_KEY, new Date().toISOString());
      });
    });
  }

  /* A journey-simulator "signal loss" never survives a reload (FIX_CONTRACT A8). Resolves true → toast once. */
  function resetStaleSim(q) {
    if (q.offline === '1' || !NC.net || typeof NC.net.resetStaleSimulation !== 'function') return Promise.resolve(false);
    return Promise.resolve(NC.net.resetStaleSimulation()).catch(function () { return false; });
  }

  function boot() {
    var q = U.qs();
    var simReset = Promise.resolve(false);
    return safe('settings.load', function () { return NC.settings.load(); })
      .then(function () {
        if (q.reset === '1') {
          return resetAll().then(function () { window.location.replace(urlWithout(['reset'])); throw { halt: true }; });
        }
      })
      .then(function () {
        var jobs = [];
        if (q.theme === 'auto' || q.theme === 'light' || q.theme === 'dark') jobs.push(NC.settings.set('theme', q.theme));
        if (q.lang === 'vi' || q.lang === 'en') jobs.push(NC.settings.set('lang', q.lang));
        if (q.offline === '1' || q.offline === '0') jobs.push(NC.net ? NC.net.setSimulated(q.offline === '1') : null);
        if (q.backend === 'local' && window.NC_CONFIG) window.NC_CONFIG.forceLocal = true;
        return Promise.all(jobs);
      })
      .then(function () {
        // Theme + language before anything renders.
        if (NC.app && NC.app.applyTheme) NC.app.applyTheme(NC.settings.get('theme'), true);
        if (NC.i18n) NC.i18n.setLang(NC.settings.get('lang') || 'vi', { persist: false, force: true });
        if (NC.net && NC.net._notify) NC.net._notify(true);
        simReset = resetStaleSim(q);
        return safe('secure.ready', function () { return NC.secure && NC.secure.ready(); });
      })
      .then(function () {
        if (q.demo === '1') return safe('demo seed', seedDemo);
      })
      .then(function () {
        if (NC.data && typeof NC.data.init === 'function') {
          return timeout(safe('NC.data.init', function () { return NC.data.init(); }), DATA_INIT_TIMEOUT);
        }
      })
      .then(function () {
        return timeout(simReset.then(function (was) { simReset = was; }), 1500).then(function () {
          if (simReset !== true) simReset = false;
        });
      })
      .then(function () {
        if (q.screen && /^[a-z]+$/.test(q.screen)) {
          try { window.history.replaceState(null, '', urlWithout(['screen']).split('#')[0] + '#/' + q.screen); }
          catch (e) { window.location.hash = '#/' + q.screen; }
        }
        if (NC.app && typeof NC.app.start === 'function') NC.app.start();
        else document.documentElement.classList.add('nc-ready');
        if (simReset === true && NC.ui && NC.i18n) {
          setTimeout(function () { NC.ui.toast(NC.i18n.t('app.net.sim_reset'), { type: 'info', timeout: 6000 }); }, 700);
        }
      })
      .catch(function (e) {
        if (e && e.halt) return;
        console.error('[boot] unexpected failure — starting shell anyway', e);
        try { if (NC.app) NC.app.start(); } catch (e2) { document.documentElement.classList.add('nc-ready'); }
      });
  }

  NC.boot = { done: boot() };
})(window.NC = window.NC || {});
