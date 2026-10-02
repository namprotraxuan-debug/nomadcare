/*
 * push.js — NC.push: Web Push for the pre-dead-zone reminders (round 2 R6, contract C4). Owner: W6.
 * Supabase mode only, and only when assets/js/config.js has a vapidPublicKey (empty → disabled; local mode keeps the
 * in-app timers of NC.trip). After the notification permission is granted, the device subscribes with the
 * PushManager of the service worker and sends op push.subscribe {endpoint, p256dh, auth, lang}; the reminders of the
 * active trip go as op push.schedule {items:[{fire_at, kind:'deadzone_ahead', minutes_before, zone_km}]} (≤ 20,
 * within 48 h; replace-all per device, an empty list clears it). A server cron + Edge Function push-dispatch sends
 * them at fire time, so the reminder arrives with the app closed. The payload is generic (no coordinates).
 * Public API: NC.push.{available() → boolean, subscribe() → Promise<{endpoint}|null>, unsubscribe() → Promise,
 *             schedule(items) → Promise<op|null>}
 */
(function (NC) {
  'use strict';

  var KV_SUB = 'push.sub';
  var RESEND_MS = 7 * 86400000;     // re-send push.subscribe at least weekly (the server prunes dead endpoints)
  function cfg() { return window.NC_CONFIG || {}; }
  function noop() { }
  function lang() { return NC.i18n && NC.i18n.lang() === 'en' ? 'en' : 'vi'; }

  function available() {
    var key = String(cfg().vapidPublicKey || '').trim();
    return !!key && !!NC.data && NC.data.mode === 'supabase' && typeof NC.data.push === 'object' &&
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!window.isSecureContext;
  }

  /** base64url VAPID public key → Uint8Array (applicationServerKey). */
  function keyBytes(b64) {
    var s = String(b64).trim().replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function b64url(buf) {
    if (!buf) return null;
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function registration() {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 6000);
      navigator.serviceWorker.ready.then(function (reg) { if (!done) { done = true; clearTimeout(timer); resolve(reg); } }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      });
    });
  }
  function subJson(sub) {
    var j = sub && sub.toJSON ? sub.toJSON() : null;
    var keys = (j && j.keys) || {};
    return {
      endpoint: sub.endpoint,
      p256dh: keys.p256dh || b64url(sub.getKey && sub.getKey('p256dh')),
      auth: keys.auth || b64url(sub.getKey && sub.getKey('auth'))
    };
  }

  /** Subscribe (or reuse the subscription) and tell the server when it is new or stale. Needs permission 'granted'. */
  function subscribe() {
    if (!available() || Notification.permission !== 'granted') return Promise.resolve(null);
    var appKey = keyBytes(cfg().vapidPublicKey);
    return registration().then(function (reg) {
      if (!reg || !reg.pushManager) return null;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) return sub;
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey }).catch(function (e) {
          // an old subscription made with another VAPID key: drop it and try once more
          if (e && e.name === 'InvalidStateError') {
            return reg.pushManager.getSubscription().then(function (old) { return old ? old.unsubscribe() : null; })
              .then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey }); });
          }
          throw e;
        });
      });
    }).then(function (sub) {
      if (!sub) return null;
      var s = subJson(sub);
      return NC.store.get(KV_SUB).catch(function () { return null; }).then(function (prev) {
        var fresh = prev && prev.endpoint === s.endpoint && prev.lang === lang() && Date.now() - (prev.at || 0) < RESEND_MS;
        if (fresh) return { endpoint: s.endpoint };
        return NC.data.push.subscribe({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, lang: lang() }).then(function () {
          return NC.store.set(KV_SUB, { endpoint: s.endpoint, lang: lang(), at: Date.now() }).catch(noop);
        }).then(function () { return { endpoint: s.endpoint }; });
      });
    });
  }

  /** Stop push on this device: browser subscription + server rows. */
  function unsubscribe() {
    var prevP = NC.store ? NC.store.get(KV_SUB).catch(function () { return null; }) : Promise.resolve(null);
    return prevP.then(function (prev) {
      var jobs = [];
      if ('serviceWorker' in navigator) {
        jobs.push(registration().then(function (reg) {
          return reg && reg.pushManager ? reg.pushManager.getSubscription().then(function (sub) { return sub ? sub.unsubscribe() : null; }) : null;
        }).catch(noop));
      }
      if (prev && NC.data && NC.data.push) jobs.push(NC.data.push.unsubscribe(prev.endpoint).catch(noop));
      if (NC.store) jobs.push(NC.store.del(KV_SUB).catch(noop));
      return Promise.all(jobs).then(function () { return true; });
    });
  }

  /** Replace this device's server-side schedule (an empty list clears it; only sent once the device subscribed). */
  function schedule(items) {
    if (!available()) return Promise.resolve(null);
    var list = (items || []).slice(0, 20);
    return NC.store.get(KV_SUB).catch(function () { return null; }).then(function (prev) {
      if (!prev) {
        if (!list.length) return null;
        return subscribe().then(function (s) { return s ? NC.data.push.schedule(list) : null; });
      }
      return NC.data.push.schedule(list);
    });
  }

  NC.push = { available: available, subscribe: subscribe, unsubscribe: unsubscribe, schedule: schedule };
})(window.NC = window.NC || {});
