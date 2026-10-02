/*
 * net.js — single source of truth for connectivity. online() = navigator.onLine && !simulated.
 * The "Giả lập mất sóng" demo switch (settings.simulated_offline) makes the whole app behave offline — in EVERY open
 * tab of this origin: the flag is mirrored to localStorage 'nc.sim_offline' ({v, owner, tab}) and the 'storage' event
 * re-syncs the other tabs (so an admin tab or a 2nd app tab never "sees" a network the traveller tab has turned off).
 * Owner: P1 shell. Public API:
 *   NC.net.{online(), real(), simulated(), simulatedOwner() → 'user'|'simulator'|null,
 *           setSimulated(bool, {owner:'user'|'simulator', quiet}) → Promise, status(), resetStaleSimulation() → Promise<bool>}
 * Owner semantics: a simulation started by the MOD.04 journey simulator (owner 'simulator') ends with the page that
 * started it (pagehide) and is reset at boot when no live tab owns it; a user-owned simulation (Settings / connection
 * sheet / ?offline=1) persists. The simulator can never switch off a user-owned simulation.
 * Emits 'net:change' {online, simulated, real, owner, quiet?} on window online/offline and on simulation changes
 * (quiet:true = the caller shows its own feedback, so the shell skips its "lost/back" toast).
 */
(function (NC) {
  'use strict';

  var LS_KEY = 'nc.sim_offline';
  var SS_RESET = 'nc.sim_reset';

  function tabId() { return (NC.bus && NC.bus.tabId) || 'tab'; }

  /* ---------- cross-tab mirror ---------- */
  function lsRead() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (raw === null || raw === undefined) return null;
      var o = JSON.parse(raw);
      return o && typeof o.v === 'boolean' ? o : null;
    } catch (e) { return null; }
  }
  var mirror = lsRead();
  function lsWrite(v, owner) {
    var o = v ? { v: true, owner: owner || 'user', tab: owner === 'simulator' ? tabId() : null } : { v: false, owner: null, tab: null };
    mirror = o;
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* storage blocked → this tab only */ }
  }

  function settingsSim() { return !!(NC.settings && NC.settings.get('simulated_offline')); }
  function settingsOwner() {
    var o = NC.settings && NC.settings.get('simulated_offline_owner');
    return o === 'simulator' ? 'simulator' : 'user';
  }

  function real() { return navigator.onLine !== false; }
  function simulated() { return mirror ? mirror.v : settingsSim(); }
  function simulatedOwner() {
    if (!simulated()) return null;
    if (mirror) return mirror.owner === 'simulator' ? 'simulator' : 'user';
    return settingsOwner();
  }
  function online() { return real() && !simulated(); }
  function status() { return { online: online(), simulated: simulated(), real: real(), owner: simulatedOwner() }; }

  var lastSig = null;
  var quiet = false;
  var syncing = false;
  function notify(force) {
    var s = status();
    var sig = s.online + '|' + s.simulated + '|' + s.real;
    if (!force && sig === lastSig) return;
    lastSig = sig;
    document.documentElement.classList.toggle('nc-offline', !s.online);
    if (quiet) s.quiet = true;
    if (NC.bus) NC.bus.emit('net:change', s);
  }

  function writeSettings(val, owner) {
    if (!NC.settings) return Promise.resolve();
    if (NC.settings.patch) return NC.settings.patch({ simulated_offline: val, simulated_offline_owner: val ? owner : null });
    return NC.settings.set('simulated_offline', val);
  }

  /**
   * Toggle simulated offline (persisted in settings.simulated_offline + owner, mirrored to every tab).
   * @param {boolean} v
   * @param {{owner?:'user'|'simulator', quiet?:boolean}} [opts] owner defaults to 'user'. quiet: flag the resulting
   *        net:change so the shell does not toast it.
   * @returns {Promise}
   */
  function setSimulated(v, opts) {
    var o = opts || {};
    var val = !!v;
    var owner = o.owner === 'simulator' ? 'simulator' : 'user';
    var curOwner = simulatedOwner();
    if (owner === 'simulator') {
      if (!val && curOwner === 'user') return Promise.resolve(false);   // never end a user-owned simulation
      if (val && curOwner === 'user') return Promise.resolve(true);     // already offline by the user's choice
    }
    quiet = !!o.quiet;
    syncing = true;
    try {
      lsWrite(val, owner);
      var p = writeSettings(val, owner);   // emits settings:change synchronously
      notify();
      return Promise.resolve(p);
    } finally { quiet = false; syncing = false; }
  }

  /**
   * Boot helper: end a journey-simulator simulation that no live tab owns any more (reload, crash, killed tab).
   * Resolves true when a simulator simulation was ended (now or at the previous pagehide) → the caller toasts once.
   * @param {number} [waitMs] how long to wait for the owning tab to answer (default 600)
   * @returns {Promise<boolean>}
   */
  /*
   * The cross-tab mirror is the source of truth. The settings copy can lag behind it when the previous page ended a
   * simulator simulation at pagehide (the IndexedDB write may not finish while unloading) → align it once at boot so
   * Settings never shows "simulated offline: on" while the app is actually online.
   */
  function reconcileSettings() {
    if (!mirror || !NC.settings || typeof NC.settings.patch !== 'function' || typeof NC.settings.get !== 'function') return;
    var want = !!mirror.v;
    var wantOwner = want ? (mirror.owner === 'simulator' ? 'simulator' : 'user') : null;
    var curOwner = NC.settings.get('simulated_offline_owner') || null;
    if (settingsSim() === want && (want ? curOwner === wantOwner : !curOwner)) return;
    syncing = true;
    try { NC.settings.patch({ simulated_offline: want, simulated_offline_owner: wantOwner }); }
    catch (e) { /* settings not writable → the mirror still decides online() */ }
    finally { syncing = false; }
  }

  function resetStaleSimulation(waitMs) {
    reconcileSettings();
    return new Promise(function (resolve) {
      var endedOnHide = false;
      try { endedOnHide = window.sessionStorage.getItem(SS_RESET) === '1'; window.sessionStorage.removeItem(SS_RESET); } catch (e) { /* ignore */ }
      if (!simulated() || simulatedOwner() !== 'simulator') { resolve(endedOnHide); return; }
      var ownerTab = mirror && mirror.tab;
      var alive = false;
      var unsub = null;
      var ask = !!(ownerTab && ownerTab !== tabId() && NC.bus && NC.bus.broadcast);
      if (ask) {
        unsub = NC.bus.on('net:sim_pong', function (p) { if (p && p.tab === ownerTab) alive = true; });
        try { NC.bus.broadcast('net:sim_ping', { tab: ownerTab }); } catch (e) { /* ignore */ }
      }
      setTimeout(function () {
        if (unsub) unsub();
        if (alive) { resolve(false); return; }
        setSimulated(false, { owner: 'simulator', quiet: true }).then(function () { resolve(true); }, function () { resolve(true); });
      }, ask ? (waitMs || 600) : 0);
    });
  }

  window.addEventListener('online', function () { notify(); });
  window.addEventListener('offline', function () { notify(); });

  // Another tab changed the simulation → adopt it here (settings kept in sync for this tab's UI).
  window.addEventListener('storage', function (e) {
    if (e.key !== LS_KEY) return;
    var m = lsRead();
    if (!m && e.newValue !== null) return;
    mirror = m;
    syncing = true;
    try {
      if (m && NC.settings && NC.settings.patch && (settingsSim() !== m.v)) {
        NC.settings.patch({ simulated_offline: m.v, simulated_offline_owner: m.v ? (m.owner || 'user') : null });
      }
    } finally { syncing = false; }
    notify();
  });

  if (NC.bus) {
    NC.bus.on('settings:change', function (p) {
      if (!p || p.key !== 'simulated_offline') return;
      // Someone wrote the setting directly (not through setSimulated) → keep the cross-tab mirror in sync.
      if (!syncing && (!mirror || mirror.v !== !!p.value)) lsWrite(!!p.value, p.value ? settingsOwner() : null);
      notify();
    });
    NC.bus.on('net:sim_ping', function (p, meta) {
      if (!meta || !meta.remote || !p || p.tab !== tabId()) return;
      if (simulated() && simulatedOwner() === 'simulator' && mirror && mirror.tab === tabId()) {
        NC.bus.broadcast('net:sim_pong', { tab: tabId() });
      }
    });
  }

  // A simulator-owned simulation ends with the page that started it (reload / close / navigation).
  window.addEventListener('pagehide', function () {
    if (!(simulated() && simulatedOwner() === 'simulator' && mirror && mirror.tab === tabId())) return;
    lsWrite(false, null);
    try { writeSettings(false, null); } catch (e) { /* best effort while unloading */ }
    try { window.sessionStorage.setItem(SS_RESET, '1'); } catch (e) { /* ignore */ }
  });

  document.documentElement.classList.toggle('nc-offline', !online());

  NC.net = {
    online: online, real: real, simulated: simulated, simulatedOwner: simulatedOwner, setSimulated: setSimulated,
    status: status, resetStaleSimulation: resetStaleSimulation, _notify: notify
  };
})(window.NC = window.NC || {});
