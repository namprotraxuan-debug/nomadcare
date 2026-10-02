/*
 * geo.js — NC.geo: the device position for the whole app (round 2 R4, contract C2). Owner: W4 (MOD.02).
 * NO continuous GPS: positions come from ONE fix at a time — request() from a user tap (the only call that may show
 * the browser prompt) or fixOnce() (never prompts: resolves null unless the permission is already granted).
 * The last position is kept in NC.settings 'last_position' {lat, lng, accuracy_m, at (ISO), source:'gps'|'sim'|'manual'}
 * with throttled writes (every settings:change re-renders Home) and announced on the bus as 'geo:position' {pos}
 * (≤ 1 per 10 s); permission changes as 'geo:permission' {state}.
 * App open: after 'app:ready' (or after 'onboarding:done' when onboarding is on screen) a permission still in the
 * 'prompt' state shows a short explanation sheet — the browser prompt is triggered only by its "Cho phép" tap —
 * on every open until granted; 'granted' takes one quiet fix; 'denied' / unsupported / insecure (file://, http LAN IP)
 * show nothing (MOD.02 explains the manual start point).
 * Demo (?demo=1): a real fix farther than 30 km from every pilot route keeps the simulated position (Quản Bạ) and
 * offers "Dùng vị trí thật" (useReal(), remembered for this tab session).
 * Public API: NC.geo = {permission(), request(), fixOnce(opts), last(), useReal(), demoKept(), isDemo(), supported(),
 *   corridorKm(p), lastError(), fixTime(ts), FAR_KM}. A fix's time is GeolocationPosition.timestamp only when it is sane
 *   (within [now − 24 h, now + 5 min]), else the time it arrived (fixTime).
 */
(function (NC) {
  'use strict';

  if (!NC.util) return;
  var U = NC.util;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function toast(m, o) { return NC.ui && NC.ui.toast ? NC.ui.toast(m, o) : null; }

  if (NC.i18n) NC.i18n.add({
    vi: {
      'geo.card.title': 'Cho phép dùng vị trí?',
      'geo.card.text': 'NomadCare cần vị trí của bạn để tìm đường, báo trước vùng mất sóng và gửi toạ độ cho người thân khi bạn đồng ý. Vị trí chỉ rời máy khi bạn bật Buddy, gửi toạ độ hoặc dùng tìm đường trực tuyến.',
      'geo.card.allow': 'Cho phép', 'geo.card.later': 'Để sau',
      'geo.ok': 'Đã bật vị trí (±{m} m).',
      'geo.denied': 'Chưa có quyền vị trí — bạn vẫn chọn được điểm xuất phát thủ công trên Bản đồ.',
      'geo.fail': 'Chưa lấy được vị trí — thử lại sau, hoặc chọn điểm xuất phát thủ công trên Bản đồ.',
      'geo.demo_kept': 'Vị trí thật cách tuyến thí điểm gần nhất {d} — bản demo giữ vị trí mô phỏng ở {name}.',
      'geo.use_real': 'Dùng vị trí thật', 'geo.real_on': 'Đang dùng vị trí thật (±{m} m).',
      'geo.sim_name': 'Quản Bạ'
    },
    en: {
      'geo.card.title': 'Allow your location?',
      'geo.card.text': 'NomadCare needs your location to find routes, warn you before no-signal areas and send your coordinates to your contacts when you agree. It only leaves this device when you turn on Buddy, send your coordinates or use online route search.',
      'geo.card.allow': 'Allow', 'geo.card.later': 'Later',
      'geo.ok': 'Location on (±{m} m).',
      'geo.denied': 'No location permission — you can still pick a start point by hand on the Map.',
      'geo.fail': "Couldn't get your location — try again later, or pick a start point by hand on the Map.",
      'geo.demo_kept': 'Your real location is {d} from the nearest pilot route — the demo keeps the simulated position at {name}.',
      'geo.use_real': 'Use my real location', 'geo.real_on': 'Using your real location (±{m} m).',
      'geo.sim_name': 'Quan Ba'
    }
  });

  var FAR_KM = 30;                 // demo: a real fix farther than this from every pilot route keeps the simulated one
  var WRITE_GAP_MS = 60000;        // last_position: no rewrite within 60 s unless moved ≥ 30 m / source changed
  var WRITE_MIN_M = 30;
  var EMIT_GAP_MS = 10000;         // 'geo:position' ≤ 1 per 10 s (trailing)
  var LS_PERM = 'nc.geo.perm';     // fallback when the Permissions API is missing (last outcome on this device)
  var SS_REAL = 'nc.geo.real';     // demo: "Dùng vị trí thật" for this tab session

  var DEMO = (function () { try { return U.qs().demo === '1'; } catch (e) { return false; } })();
  var st = {
    perm: null, status: null, inflight: null, wroteAt: 0, emitAt: 0, emitT: null, pendingEmit: null,
    kept: null, lastErr: null, asked: false, card: null
  };

  function secure() { return window.isSecureContext !== false; }
  function supported() { return !!(navigator.geolocation && secure()); }
  function lsGet(k, store) { try { return (store || window.localStorage).getItem(k); } catch (e) { return null; } }
  function lsSet(k, v, store) { try { (store || window.localStorage).setItem(k, v); } catch (e) { /* private mode */ } }
  function useRealFlag() { return lsGet(SS_REAL, window.sessionStorage) === '1'; }

  function setPerm(s) {
    if (s === st.perm) return;
    st.perm = s;
    if (NC.bus) NC.bus.emit('geo:permission', { state: s });
  }
  function norm(s) { return s === 'granted' || s === 'denied' ? s : 'prompt'; }
  /** @returns {Promise<'granted'|'denied'|'prompt'|'unsupported'>} */
  function permission() {
    if (!supported()) { setPerm('unsupported'); return Promise.resolve('unsupported'); }
    var fallback = function () {
      var v = lsGet(LS_PERM);
      var s = v === 'granted' || v === 'denied' ? v : 'prompt';
      setPerm(s);
      return s;
    };
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(fallback());
    var q;
    try { q = navigator.permissions.query({ name: 'geolocation' }); } catch (e) { return Promise.resolve(fallback()); }
    return Promise.resolve(q).then(function (ps) {
      if (ps && !st.status) {
        st.status = ps;
        // allowed from the browser's own UI (site settings) → close the card, take one quiet fix
        var onChange = function () {
          var was = st.perm, ns = norm(ps.state);
          setPerm(ns);
          if (ns === 'granted' && was !== 'granted' && !st.requesting) {
            if (st.card) { try { st.card.close('granted'); } catch (e) { /* closed meanwhile */ } }
            fixOnce();
          }
        };
        if (ps.addEventListener) ps.addEventListener('change', onChange); else ps.onchange = onChange;
      }
      var s = norm(ps && ps.state);
      setPerm(s);
      return s;
    }, fallback);
  }

  /* ---------------- corridors (demo rule) ---------------- */
  var corridorLines = null;
  function lines() {
    if (corridorLines) return corridorLines;
    var seed = window.NC_SEED || {};
    corridorLines = (seed.edges || []).filter(function (e) { return e.geometry && e.geometry.length >= 2; }).map(function (e) { return e.geometry; });
    return corridorLines;
  }
  /** Distance (km) from p to the nearest pilot-route edge (Infinity when unknown). */
  function corridorKm(p) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return Infinity;
    var R = NC.routing, best = Infinity;
    if (R && R.nearestOnLine) {
      lines().forEach(function (g) { var r = R.nearestOnLine(g, p); if (r && r.distance_km < best) best = r.distance_km; });
    }
    if (best === Infinity) {
      ((window.NC_SEED && window.NC_SEED.routes) || []).forEach(function (r) {
        if (!r.bbox) return;
        var c = { lat: (r.bbox[0] + r.bbox[2]) / 2, lng: (r.bbox[1] + r.bbox[3]) / 2 };
        best = Math.min(best, U.haversineKm(p, c));
      });
    }
    return best;
  }
  /** The demo's simulated position: the current one if simulated, else Quản Bạ on the Hà Giang loop (as boot.js). */
  function simPosition() {
    var cur = last();
    if (cur && cur.source === 'sim') return cur;
    var nodes = ((window.NC_SEED && window.NC_SEED.nodes) || []).filter(function (n) { return n.route_id === 'ha-giang-loop'; });
    var pick = nodes.filter(function (n) { return /quan-ba|quản bạ|quan ba/i.test((n.id || '') + ' ' + (n.name || '')); })[0] ||
      nodes.filter(function (n) { return n.kind === 'town'; })[1] || nodes[0];
    var p = pick && isFinite(pick.lat) ? { lat: pick.lat, lng: pick.lng } : { lat: 23.0668, lng: 104.9835 };
    return { lat: p.lat, lng: p.lng, at: new Date().toISOString(), source: 'sim' };
  }

  /* ---------------- last position ---------------- */
  function last() {
    var p = NC.settings ? NC.settings.get('last_position') : null;
    return p && isFinite(p.lat) && isFinite(p.lng) && p.lat !== null ? p : null;
  }
  function emit(pos) {
    if (!NC.bus) return;
    var now = Date.now();
    clearTimeout(st.emitT);
    if (now - st.emitAt >= EMIT_GAP_MS) { st.emitAt = now; NC.bus.emit('geo:position', { pos: pos }); return; }
    st.pendingEmit = pos;
    st.emitT = setTimeout(function () { st.emitAt = Date.now(); var p = st.pendingEmit; st.pendingEmit = null; NC.bus.emit('geo:position', { pos: p }); }, st.emitAt + EMIT_GAP_MS - now);
  }
  function write(pos, force) {
    var cur = last();
    var now = Date.now();
    if (!force && cur && cur.source === pos.source && U.haversineKm(cur, pos) * 1000 < WRITE_MIN_M && now - st.wroteAt < WRITE_GAP_MS) return false;
    st.wroteAt = now;
    if (NC.settings) NC.settings.set('last_position', pos);
    emit(pos);
    return true;
  }
  /*
   * Time of a fix (ms). GeolocationPosition.timestamp is trusted only when it is a finite number within
   * [now − 24 h, now + 5 min]; anything else (a wrong device clock, an engine reporting µs instead of ms — seen in
   * Playwright WebKit: year 58721) falls back to now, so the "Vị trí lúc …" time in the SMS / popup and the age of
   * last_position never come from an impossible value (a future time would also look permanently fresh).
   */
  var FIX_PAST_MS = 24 * 3600000, FIX_FUTURE_MS = 5 * 60000;
  function fixTime(ts, now) {
    var n = now === undefined ? Date.now() : now;
    var v = typeof ts === 'number' ? ts : (ts === null || ts === undefined || ts === '' ? NaN : Number(ts));
    return isFinite(v) && v >= n - FIX_PAST_MS && v <= n + FIX_FUTURE_MS ? v : n;
  }
  function fromFix(g) {
    var c = g.coords;
    return {
      lat: U.round(c.latitude, 6), lng: U.round(c.longitude, 6), accuracy_m: Math.round(c.accuracy || 0),
      at: new Date(fixTime(g.timestamp)).toISOString(), source: 'gps'
    };
  }
  /** A real fix arrived → the position the app uses (demo rule), written to last_position. */
  function accept(real, o) {
    o = o || {};
    lsSet(LS_PERM, 'granted');
    setPerm('granted');
    if (DEMO && !useRealFlag() && !o.real) {
      var d = corridorKm(real);
      if (d > FAR_KM) {
        st.kept = { km: d, real: real, at: Date.now() };
        var sim = simPosition();
        var cur = last();
        if (!cur || cur.source !== 'sim' || Math.abs(cur.lat - sim.lat) > 1e-7 || Math.abs(cur.lng - sim.lng) > 1e-7) write(sim, true);
        if (NC.bus) NC.bus.emit('geo:demo', { kept: true, km: d });
        return sim;
      }
    }
    if (st.kept) { st.kept = null; if (NC.bus) NC.bus.emit('geo:demo', { kept: false }); }
    write(real, !!o.force);
    return real;
  }

  function getFix(opts) {
    return new Promise(function (resolve) {
      try {
        navigator.geolocation.getCurrentPosition(function (g) { st.lastErr = null; resolve({ fix: fromFix(g) }); }, function (e) {
          st.lastErr = e && e.code === 1 ? 'denied' : e && e.code === 3 ? 'timeout' : 'unavailable';
          resolve({ error: st.lastErr });
        }, opts);
      } catch (e) { st.lastErr = 'unavailable'; resolve({ error: 'unavailable' }); }
    });
  }

  /**
   * Ask for the position — MUST run inside a user gesture (the browser prompt appears only then).
   * @returns {Promise<Object|null>} the position the app now uses (simulated in the demo rule), null on refusal/failure
   */
  function request(o) {
    if (!supported()) { st.lastErr = 'unsupported'; return Promise.resolve(null); }
    st.requesting = true;
    var p = getFix({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }); // synchronous call inside the tap
    return p.then(function (r) {
      st.requesting = false;
      if (r.fix) return accept(r.fix, { force: true, real: !!(o && o.real) });
      if (r.error === 'denied') { lsSet(LS_PERM, 'denied'); permission(); }
      return null;
    });
  }

  /**
   * One quiet fix. Never prompts: null unless the permission is already granted. Concurrent calls share one fix.
   * @param {{timeout_ms?:number, maxAge_ms?:number}} [opts]
   */
  function fixOnce(opts) {
    opts = opts || {};
    if (st.inflight) return st.inflight;
    st.inflight = permission().then(function (s) {
      if (s !== 'granted') return null;
      return getFix({ enableHighAccuracy: true, timeout: opts.timeout_ms > 0 ? opts.timeout_ms : 8000, maximumAge: opts.maxAge_ms >= 0 ? opts.maxAge_ms : 60000 })
        .then(function (r) {
          if (r.fix) return accept(r.fix);
          if (r.error === 'denied') { lsSet(LS_PERM, 'denied'); permission(); }
          return null;
        });
    }).then(function (v) { st.inflight = null; return v; }, function () { st.inflight = null; return null; });
    return st.inflight;
  }

  /** Demo: switch to the real position (remembered for this tab session). Call from a tap (may prompt). */
  function useReal() {
    lsSet(SS_REAL, '1', window.sessionStorage);
    var k = st.kept;
    st.kept = null;
    if (NC.bus) NC.bus.emit('geo:demo', { kept: false });
    if (k && k.real && Date.now() - k.at < 10 * 60000) {
      write(k.real, true);
      toast(t('geo.real_on', { m: k.real.accuracy_m || '–' }), { type: 'success', timeout: 2600 });
      return Promise.resolve(k.real);
    }
    return request({ real: true }).then(function (p) {
      if (p) toast(t('geo.real_on', { m: p.accuracy_m || '–' }), { type: 'success', timeout: 2600 });
      else toast(t(st.lastErr === 'denied' ? 'geo.denied' : 'geo.fail'), { type: 'warning', timeout: 5000 });
      return p;
    });
  }

  function keptToast() {
    if (!st.kept) return;
    toast(t('geo.demo_kept', { d: U.fmtKm(st.kept.km), name: t('geo.sim_name') }), {
      type: 'info', timeout: 8000, action: { label: t('geo.use_real'), onClick: function () { useReal(); } }
    });
  }

  /* ---------------- app open: explanation card, then the browser prompt from its tap ---------------- */
  function current() { return NC.app && NC.app.current ? NC.app.current() : null; }
  function showCard() {
    if (st.card || !NC.ui || !NC.ui.sheet) return;
    var body = U.h('div', { class: 'geo-card' });
    body.innerHTML = '<p class="geo-card__text">' + U.esc(t('geo.card.text')) + '</p>';
    st.card = NC.ui.sheet({
      title: t('geo.card.title'), icon: 'locate', size: 'sm', body: body, keepOnRoute: true, className: 'geo-sheet',
      actions: [
        { label: t('geo.card.later'), variant: 'ghost', value: 'later' },
        {
          label: t('geo.card.allow'), variant: 'primary', icon: 'locate', autofocus: true, value: 'allow',
          onClick: function () {
            return request().then(function (p) {
              if (p && st.kept) keptToast();
              else if (p) toast(t('geo.ok', { m: p.accuracy_m || '–' }), { type: 'success', timeout: 2400 });
              else toast(t(st.lastErr === 'denied' ? 'geo.denied' : 'geo.fail'), { type: 'warning', timeout: 6000 });
              return true;
            });
          }
        }
      ],
      onClose: function () { st.card = null; }
    });
  }
  /* Not over the emergency screen, nor on top of another open sheet/dialog: wait (a few tries) for a calm moment. */
  function whenCalm(fn, tries) {
    var n = tries === undefined ? 40 : tries;
    var cur = current();
    var busy = (NC.ui && NC.ui.openCount && NC.ui.openCount() > 0) || (cur && (cur.name === 'emergency' || cur.name === 'onboarding'));
    if (!busy) { fn(); return; }
    if (n <= 0) return;
    setTimeout(function () { whenCalm(fn, n - 1); }, 1500);
  }
  function onOpen() {
    if (st.asked) return;
    st.asked = true;
    permission().then(function (s) {
      if (s === 'granted') { fixOnce({ timeout_ms: 10000, maxAge_ms: 120000 }).then(function (p) { if (p && st.kept) keptToast(); }); return; }
      if (s === 'prompt') setTimeout(function () { whenCalm(showCard); }, 900);
    });
  }
  if (NC.bus) {
    NC.bus.on('app:ready', function (p) {
      if (p && p.onboarding) return; // shown after 'onboarding:done'
      onOpen();
    });
    NC.bus.on('onboarding:done', function () { setTimeout(onOpen, 400); });
  }

  NC.geo = {
    FAR_KM: FAR_KM,
    permission: permission,
    request: request,
    fixOnce: fixOnce,
    last: last,
    useReal: useReal,
    /** Demo: {km, real} while a far real fix is set aside for the simulated position, else null. */
    demoKept: function () { return st.kept ? { km: st.kept.km, real: st.kept.real } : null; },
    isDemo: function () { return DEMO; },
    supported: supported,
    corridorKm: corridorKm,
    /** 'denied' | 'timeout' | 'unavailable' | 'unsupported' | null — why the last fix failed. */
    lastError: function () { return st.lastErr; },
    /** Sane time (ms) of a GeolocationPosition.timestamp: within [now − 24 h, now + 5 min], else now. */
    fixTime: fixTime,
    /** Record a position chosen/obtained elsewhere (MOD.02 locate FAB, simulated position): real=true → demo keeps it. */
    note: function (pos, o) {
      if (!pos) return;
      if (o && o.real) { lsSet(SS_REAL, '1', window.sessionStorage); if (st.kept) { st.kept = null; if (NC.bus) NC.bus.emit('geo:demo', { kept: false }); } }
      if (pos.source === 'gps') { lsSet(LS_PERM, 'granted'); setPerm('granted'); }
    }
  };
})(window.NC = window.NC || {});
