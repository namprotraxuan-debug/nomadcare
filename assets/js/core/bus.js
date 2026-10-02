/*
 * bus.js — tiny pub/sub event bus (same tab) + cross-tab broadcast (BroadcastChannel 'nomadcare-bus',
 * fallback: localStorage 'storage' event). Owner: P1 shell.
 * Public API: NC.bus.{on(evt, fn) → off, once(evt, fn) → off, off(evt, fn), emit(evt, payload), broadcast(evt, payload)}
 * Event names: see CONTRACT §4 (net:change, data:outbox, data:sync, settings:change, i18n:change, route:change …).
 */
(function (NC) {
  'use strict';

  var handlers = Object.create(null);
  var CHANNEL = 'nomadcare-bus';
  var LS_KEY = 'nc.bus';
  var tabId = Math.random().toString(36).slice(2);
  var channel = null;

  function on(evt, fn) {
    if (typeof fn !== 'function') return function () {};
    (handlers[evt] || (handlers[evt] = [])).push(fn);
    return function () { off(evt, fn); };
  }
  function off(evt, fn) {
    var list = handlers[evt]; if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  function once(evt, fn) {
    var unsub = on(evt, function (p, meta) { unsub(); fn(p, meta); });
    return unsub;
  }
  /** Dispatch to local listeners. A throwing listener never breaks the others. */
  function emit(evt, payload, meta) {
    var list = handlers[evt];
    if (!list || !list.length) return;
    list.slice().forEach(function (fn) {
      try { fn(payload, meta || { remote: false }); }
      catch (e) { console.error('[bus] listener for "' + evt + '" failed:', e); }
    });
    var any = handlers['*'];
    if (any) any.slice().forEach(function (fn) { try { fn({ evt: evt, payload: payload }, meta || { remote: false }); } catch (e) { /* ignore */ } });
  }

  /* ---------- cross-tab ---------- */
  function initChannel() {
    if (channel !== null) return;
    channel = false;
    try {
      if (typeof window.BroadcastChannel === 'function') {
        channel = new window.BroadcastChannel(CHANNEL);
        channel.onmessage = function (e) {
          var m = e && e.data; if (!m || m.src === tabId || !m.evt) return;
          emit(m.evt, m.payload, { remote: true });
        };
      }
    } catch (e) { channel = false; }
    if (!channel) {
      window.addEventListener('storage', function (e) {
        if (e.key !== LS_KEY || !e.newValue) return;
        try {
          var m = JSON.parse(e.newValue);
          if (m && m.src !== tabId && m.evt) emit(m.evt, m.payload, { remote: true });
        } catch (err) { /* ignore malformed */ }
      });
    }
  }
  /** Emit locally AND to other open tabs of the same origin. Payload must be JSON/structured-cloneable. */
  function broadcast(evt, payload) {
    emit(evt, payload);
    initChannel();
    var msg = { src: tabId, evt: evt, payload: payload, t: Date.now() };
    try {
      if (channel) channel.postMessage(msg);
      else if (window.localStorage) {
        window.localStorage.setItem(LS_KEY, JSON.stringify(msg));
        window.localStorage.removeItem(LS_KEY);
      }
    } catch (e) { /* storage full / blocked → same-tab only */ }
  }

  initChannel();

  NC.bus = { on: on, once: once, off: off, emit: emit, broadcast: broadcast, tabId: tabId };
})(window.NC = window.NC || {});
