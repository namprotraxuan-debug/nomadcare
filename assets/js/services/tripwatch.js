/*
 * tripwatch.js — NC.trip: reminders before the known dead zones of a started trip + the Buddy heartbeat
 * (round 2 R6, contract C4). Owner: W6.
 * NO continuous GPS: on "Bắt đầu đi" (MOD.02) or a Buddy start that carries a route, the ETA of each dead zone is
 * computed with the routing speed (xe máy 25 km/h, đi bộ 3,5 km/h) and a reminder is scheduled at ETA − lead
 * (routing.THRESHOLDS minutes: 5 / 15). ONE fix (NC.geo.fixOnce, never prompts) is taken when the app comes back to
 * the foreground, after each Buddy check-in and with each heartbeat; it is projected on the route
 * (NC.routing.progressOnLine) and the schedule is recomputed. The trip ends by itself on arrival (≤ 300 m from the
 * destination) or at 2× the expected duration. State lives in NC.store kv 'trip.active' (wiped with personal data).
 * A reminder = system notification (ServiceWorkerRegistration.showNotification, icon-192.png) + an in-app popup that
 * survives navigation (NC.ui.modal keepOnRoute): [Gửi SMS] (sms:<number>?&body=…, OSM link) · [Chia sẻ]
 * (navigator.share, fallback clipboard) · [Để sau]. Recipient: the Buddy session phone, else the emergency contact of
 * the QR profile (never displayed behind a reveal code), else "Bật Buddy". Toasts say "Đã mở ứng dụng SMS", never
 * "Đã gửi". With an open Buddy session each reminder is also recorded as a 'pre_deadzone' check-in.
 * Heartbeat (open Buddy session only): op buddy.heartbeat {session_id, lat, lng, accuracy_m, state:'live'|'paused',
 * silence_until, client_ts} every 5 min while visible & online; 'paused' on hide / pagehide (keepalive beacon + outbox).
 * Web Push (Supabase mode, NC.push): the pending reminders (≤ 20, within 48 h) are sent as op push.schedule.
 * Public API: NC.trip.{start(plan, opts) → Promise<trip>, stop(reason) → Promise<trip|null>, current() → trip|null,
 *   alerts() → [alert], promptShare(opts) → Promise<action>, demoAlert(info) → Promise, simAlert(info) → Promise,
 *   refresh() → Promise, silenceUntil() → ISO|null, askPermission() → Promise<perm>, prefs(), setPrefs(p), core}
 * Events: 'trip:update' {trip|null} (also broadcast to the other tabs), 'trip:alert' {alert}, 'trip:permission' {state}
 * (the notification prompt was answered — possibly long after the tap).
 * Honesty rules: a simulated position (journey simulator, demo button, MOD.02 FAB) is labelled "vị trí mô phỏng" and is
 * never stored on a real Buddy session outside ?demo=1; a fix older than 10 min is shown and sent as "vị trí đã biết gần
 * nhất" with its date; Web Push follows the "Thông báo hệ thống" switch (off → empty server schedule).
 * NC.trip.core is pure (no DOM) and is also module.exports for tools/tests/tripwatch.test.js.
 */
(function (root) {
  'use strict';

  var NC = root.NC = root.NC || {};

  /* ================================================================== */
  /* PURE CORE                                                            */
  /* ================================================================== */
  var MIN = 60000, HOUR = 3600000;
  var DEFAULT_SPEEDS = { motorbike: 25, hiking: 3.5 };
  var DEFAULT_LEAD = { motorbike: { minutes: 5, km: 2 }, hiking: { minutes: 15, km: 0.8 } };
  var ARRIVE_KM = 0.3;            // arrival: a fix within 300 m of the destination
  var OFF_ROUTE_KM = 5;           // a fix farther than this from the route does not move the progress
  var LOOP_KM = 2;                // start ≈ end (loop route): disambiguate fixes near the ends with the estimate
  var PUSH_MAX = 20, PUSH_WINDOW_MS = 48 * HOUR;
  var HEARTBEAT_MIN = 5;          // heartbeat period while visible & online
  var CONTACT_LOST_MIN = 15;      // the server flags a 'live' session silent for longer (contact_lost)
  var SILENCE_MARGIN_MIN = 15;    // silence_until = ETA exit of the zone + this

  function routing() { return NC.routing || null; }
  function modeOf(m) { return m === 'hiking' ? 'hiking' : 'motorbike'; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v !== '' && isFinite(+v) ? +v : null); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function lead(mode) {
    var th = routing() && routing().THRESHOLDS;
    return (th && th[mode]) || DEFAULT_LEAD[mode];
  }
  function defaultSpeed(mode) {
    var sp = routing() && routing().SPEEDS;
    return (sp && sp[mode]) || DEFAULT_SPEEDS[mode];
  }
  function haversineKm(a, b) {
    if (routing() && routing().haversineKm) return routing().haversineKm(a, b);
    var R = 6371.0088, d = Math.PI / 180;
    var dLat = (b.lat - a.lat) * d, dLng = (b.lng - a.lng) * d;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function ll(p) { return Array.isArray(p) ? { lat: +p[0], lng: +p[1] } : (p && isFinite(p.lat) && isFinite(p.lng) ? { lat: +p.lat, lng: +p.lng } : null); }
  function lineKm(geom) {
    if (routing() && routing().lineLengthKm) return routing().lineLengthKm(geom);
    var s = 0;
    for (var i = 1; i < geom.length; i++) s += haversineKm(ll(geom[i - 1]), ll(geom[i]));
    return s;
  }
  function validGeom(g) {
    return Array.isArray(g) && g.length >= 2 && g.every(function (p) { return Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180; });
  }

  /**
   * Lost zones → reminder clusters: zones closer than the mode's threshold distance are one reminder (a rider does
   * not want two popups a few hundred metres apart). Ordered by start km.
   * @returns {Array<{key, start_km, end_km, length_km, zones, start:[lat,lng]|null}>}
   */
  function clusters(zones, gapKm) {
    var list = (zones || []).filter(function (z) { return z && isFinite(z.start_km) && isFinite(z.end_km) && z.end_km > z.start_km; })
      .slice().sort(function (a, b) { return a.start_km - b.start_km; });
    var out = [];
    list.forEach(function (z) {
      var last = out[out.length - 1];
      if (last && z.start_km - last.end_km < gapKm) { last.end_km = Math.max(last.end_km, +z.end_km); last.zones++; }
      else out.push({ start_km: +z.start_km, end_km: +z.end_km, zones: 1, start: Array.isArray(z.start) ? [+z.start[0], +z.start[1]] : null });
    });
    out.forEach(function (c) { c.start_km = r3(c.start_km); c.end_km = r3(c.end_km); c.length_km = r3(c.end_km - c.start_km); c.key = 'z' + c.start_km.toFixed(3); });
    return out;
  }

  /**
   * TripPlan (contract C2) → trip record. Throws Error('invalid_plan') without a usable geometry / length.
   * @param {Object} plan @param {number} now epoch ms @param {{id?:string}} [o]
   */
  function makeTrip(plan, now, o) {
    plan = plan || {};
    if (!validGeom(plan.geometry)) { var e = new Error('invalid_plan'); e.code = 'invalid_plan'; throw e; }
    var mode = modeOf(plan.mode);
    var speed = num(plan.speed_kmh);
    if (!speed || speed < 0.5 || speed > 200) speed = defaultSpeed(mode);
    var gl = lineKm(plan.geometry);
    var length = num(plan.length_km);
    if (!length || length <= 0) length = gl;
    var scale = gl > 0 ? length / gl : 1;
    if (!(scale >= 0.5 && scale <= 2)) scale = 1;
    var th = lead(mode);
    var zs = clusters(plan.zones, th.km).filter(function (z) { return z.start_km < length; });
    var expected = length / speed * 60;
    var dest = ll(plan.dest) || ll(plan.geometry[plan.geometry.length - 1]);
    return {
      v: 1, id: (o && o.id) || ('t' + now.toString(36) + Math.random().toString(36).slice(2, 7)),
      route_key: plan.route_key ? String(plan.route_key) : null, source: plan.source === 'online' ? 'online' : 'offline',
      route_id: plan.route_id || null, carrier: plan.carrier || null, mode: mode, speed_kmh: speed, lead_min: th.minutes,
      length_km: r3(length), scale: scale, geometry: plan.geometry.map(function (p) { return [+p[0], +p[1]]; }), zones: zs,
      unknown_km: num(plan.unknown_km) || 0, from_label: plan.from_label || null, to_label: plan.to_label || null,
      dest: dest ? [dest.lat, dest.lng] : null, created_at: plan.created_at || null,
      started_at: iso(now), expected_min: Math.round(expected * 10) / 10, ends_at: iso(now + 2 * expected * MIN),
      pos_km: 0, pos_at: iso(now), pos_src: 'start', off_route_km: null, fired: {}, held: {}
    };
  }

  /** Estimated km along the route at `now` (last known progress + routing speed × elapsed, clamped). */
  function estKm(trip, now) {
    var dt = Math.max(0, (now - Date.parse(trip.pos_at)) / HOUR);
    return clamp(trip.pos_km + dt * trip.speed_kmh, 0, trip.length_km);
  }
  /** ETA (epoch ms) at km `km` from the last known progress. */
  function etaAt(trip, km) { return Date.parse(trip.pos_at) + (km - trip.pos_km) / trip.speed_kmh * HOUR; }

  /**
   * The reminder of each zone. fire_at = pos_at + (start_km − pos_km) / v − lead. Status:
   * 'fired' (already shown), 'skipped' (the last fix is inside / past the zone, or the reminder is late and the
   * estimate says the zone has started), 'due' (late, but the zone is still ahead → show now), 'pending'.
   * A reminder held by nextDue() reports the hold time as fire_at.
   * @returns {Array<Object>} one entry per zone cluster, in route order
   */
  function schedule(trip, now) {
    if (!trip) return [];
    var cur = estKm(trip, now);
    var leadMs = trip.lead_min * MIN;
    return trip.zones.map(function (z) {
      var eta = etaAt(trip, z.start_km);
      var fireAt = eta - leadMs;
      // held (nextDue): a later reminder that was due together with a nearer one waits until that zone is left
      var held = trip.held && trip.held[z.key] ? Date.parse(trip.held[z.key]) : NaN;
      var wakeAt = isFinite(held) && held > fireAt ? held : fireAt;
      var status;
      if (trip.fired && trip.fired[z.key]) status = 'fired';
      else if (trip.pos_km >= z.start_km - 1e-6) status = 'skipped';
      else if (fireAt <= now && cur >= z.start_km - 1e-6) status = 'skipped';
      else if (wakeAt <= now) status = 'due';
      else status = 'pending';
      return {
        key: z.key, trip_id: trip.id, zone_km: z.start_km, end_km: z.end_km, length_km: z.length_km, zones: z.zones,
        eta_at: iso(eta), fire_at: iso(wakeAt), exit_at: iso(etaAt(trip, z.end_km)), minutes_before: trip.lead_min,
        minutes_to_zone: Math.max(0, (eta - now) / MIN), silence_min: z.length_km / trip.speed_kmh * 60, status: status,
        start: z.start || null
      };
    });
  }
  /** Next time the runtime must look again (earliest pending reminder, or the trip expiry). null = never. */
  function nextWake(trip, now) {
    if (!trip) return null;
    var t = Date.parse(trip.ends_at);
    schedule(trip, now).forEach(function (a) { if (a.status === 'pending') t = Math.min(t, Date.parse(a.fire_at)); });
    return isFinite(t) ? t : null;
  }
  /**
   * The ONE reminder to show now: the nearest 'due' one. Other reminders due at the same time (two zones inside one
   * lead window, e.g. on reopen after the phone slept) are held until the estimated exit of the nearer zone, so the
   * imminent zone is never replaced by a later one and each zone still gets its reminder. Mutates trip.held.
   * @returns {Object|null} the alert to fire
   */
  function nextDue(trip, now) {
    var due = schedule(trip, now).filter(function (a) { return a.status === 'due'; });
    if (!due.length) return null;
    var first = due[0];
    if (due.length > 1) {
      trip.held = trip.held || {};
      due.slice(1).forEach(function (a) { trip.held[a.key] = first.exit_at; });
    }
    return first;
  }

  /**
   * Project a fix on the route and move the progress. progressFn(geometry, [lat,lng]) → {km_along, offset_km}
   * (NC.routing.progressOnLine). Off route (> 5 km): progress unchanged. Loop routes (start ≈ end): a fix near the
   * ends is read with the estimate (first or second half of the ride). Mutates trip.
   * @returns {{used:boolean, km:number|null, offset_km:number|null}}
   */
  function applyFix(trip, fix, progressFn, now) {
    var p = ll(fix);
    if (!trip || !p || typeof progressFn !== 'function') return { used: false, km: null, offset_km: null };
    var at = fix.at ? Date.parse(fix.at) : now;
    if (!isFinite(at) || at > now + MIN) at = now;
    var pr = progressFn(trip.geometry, [p.lat, p.lng]);
    var along = pr ? num(pr.km_along !== undefined ? pr.km_along : pr.along_km) : null;
    var off = pr ? num(pr.offset_km !== undefined ? pr.offset_km : pr.distance_km) : null;
    if (along === null || off === null) return { used: false, km: null, offset_km: null };
    if (off > OFF_ROUTE_KM) { trip.off_route_km = r3(off); return { used: false, km: null, offset_km: off }; }
    var km = clamp(along * trip.scale, 0, trip.length_km);
    var a = ll(trip.geometry[0]), b = ll(trip.geometry[trip.geometry.length - 1]);
    if (haversineKm(a, b) <= LOOP_KM && (haversineKm(p, a) <= LOOP_KM || haversineKm(p, b) <= LOOP_KM)) {
      var hint = estKm(trip, at);
      var second = hint > trip.length_km / 2;
      if (second !== km > trip.length_km / 2) km = clamp(trip.length_km - km, 0, trip.length_km);
    }
    trip.pos_km = r3(km); trip.pos_at = iso(at); trip.pos_src = fix.source || 'gps'; trip.off_route_km = null;
    return { used: true, km: trip.pos_km, offset_km: off };
  }

  /**
   * 'arrived' (fix ≤ 300 m from the destination), 'expired' (2× expected duration) or null. A loop route (start ≈
   * destination) only counts as arrived once the estimate is past half of the ride (not at the start line).
   */
  function endReason(trip, now, fix) {
    if (!trip) return null;
    var p = ll(fix), d = ll(trip.dest), s0 = ll(trip.geometry[0]);
    var loop = s0 && d && haversineKm(s0, d) <= LOOP_KM;
    if (p && d && haversineKm(p, d) <= ARRIVE_KM && (!loop || estKm(trip, now) >= trip.length_km / 2)) return 'arrived';
    if (now >= Date.parse(trip.ends_at)) return 'expired';
    return null;
  }

  /**
   * silence_until of the heartbeat: the expected exit of the zone the traveller is in, or of the next one when it
   * starts before the server could notice a silence (heartbeat period + contact-lost threshold), + 15 min. Else null
   * (a zone further ahead is announced by a later heartbeat). @returns {string|null} ISO
   */
  function silenceUntil(trip, now) {
    if (!trip) return null;
    var cur = estKm(trip, now);
    var horizon = (HEARTBEAT_MIN + CONTACT_LOST_MIN) * MIN;
    for (var i = 0; i < trip.zones.length; i++) {
      var z = trip.zones[i];
      if (z.end_km <= cur + 1e-6) continue;
      if (cur >= z.start_km - 1e-6 || etaAt(trip, z.start_km) - now <= horizon) {
        return iso(Math.max(now, etaAt(trip, z.end_km)) + SILENCE_MARGIN_MIN * MIN);
      }
      return null;
    }
    return null;
  }

  /** Items of op push.schedule: pending reminders within 48 h, at most 20. */
  function pushItems(trip, now) {
    return schedule(trip, now).filter(function (a) {
      var f = Date.parse(a.fire_at);
      return a.status === 'pending' && f > now && f - now <= PUSH_WINDOW_MS;
    }).slice(0, PUSH_MAX).map(function (a) {
      return { fire_at: a.fire_at, kind: 'deadzone_ahead', minutes_before: a.minutes_before, zone_km: a.zone_km };
    });
  }

  /** Point of the route at km (estimate), [lat,lng] or null. */
  function pointAtKm(trip, km) {
    if (!trip) return null;
    var R = routing();
    var g = trip.geometry;
    if (R && R.pointAt) { var p = R.pointAt(g, km / (trip.scale || 1)); return p ? [p[0], p[1]] : null; }
    return g[0];
  }

  /**
   * Time of a fix (ISO or ms) that can be trusted, in epoch ms, or null. Some engines report
   * GeolocationPosition.timestamp in µs (geo.js then stores a date ~50 000 years ahead): recovered ÷ 1000. Any other
   * time in the future (> 5 min, clock skew allowance) or unreadable → null (unknown age).
   */
  function fixTime(at, now) {
    if (at === null || at === undefined || at === '') return null;
    var ms = typeof at === 'number' ? at : Date.parse(at);
    if (!isFinite(ms)) return null;
    if (ms > now + 24 * HOUR && Math.abs(ms / 1000 - now) < 48 * HOUR) ms = ms / 1000;
    return ms <= now + 5 * MIN ? Math.round(ms) : null;
  }

  /** OSM link at 15 (= deadman-alert e-mail). */
  function osmLink(lat, lng) {
    var a = (+lat).toFixed(5), b = (+lng).toFixed(5);
    return 'https://www.openstreetmap.org/?mlat=' + a + '&mlon=' + b + '#map=15/' + a + '/' + b;
  }
  /** 'sms:<number>?&body=…' (the ?& form prefills the body on iOS and Android alike). */
  function smsHref(number, body) {
    return 'sms:' + String(number || '').replace(/[^\d+]/g, '') + '?&body=' + encodeURIComponent(body || '');
  }

  var core = {
    MIN: MIN, ARRIVE_KM: ARRIVE_KM, OFF_ROUTE_KM: OFF_ROUTE_KM, PUSH_MAX: PUSH_MAX, HEARTBEAT_MIN: HEARTBEAT_MIN,
    CONTACT_LOST_MIN: CONTACT_LOST_MIN, SILENCE_MARGIN_MIN: SILENCE_MARGIN_MIN,
    clusters: clusters, makeTrip: makeTrip, estKm: estKm, etaAt: etaAt, schedule: schedule, nextWake: nextWake, nextDue: nextDue,
    applyFix: applyFix, endReason: endReason, silenceUntil: silenceUntil, pushItems: pushItems, pointAtKm: pointAtKm,
    fixTime: fixTime, osmLink: osmLink, smsHref: smsHref
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (!root.document || !NC.util) { NC.trip = NC.trip || { core: core }; return; }

  /* ================================================================== */
  /* RUNTIME (browser)                                                    */
  /* ================================================================== */
  var U = NC.util;
  var KV_TRIP = 'trip.active', KV_PREFS = 'trip.prefs', LS_FIRED = 'nc.trip.fired';
  var KV_BD_PREFS = 'bd.prefs';     // MOD.04 switches: its 'vibrate' is the one source of truth for the reminders too
  var FRESH_MS = 10 * MIN;          // a fix older than this is shown / sent as "vị trí đã biết gần nhất" with its date
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function lang() { return NC.i18n ? NC.i18n.lang() : 'vi'; }
  function toast(msg, o) { return NC.ui ? NC.ui.toast(msg, o) : null; }
  function online() { return NC.net ? NC.net.online() : navigator.onLine !== false; }
  function visible() { return document.visibilityState !== 'hidden'; }
  function noop() { }
  function esc(s) { return U.esc(s); }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }

  if (NC.i18n) NC.i18n.add({
    vi: {
      'tw.alert.title': 'Nhắc trước vùng mất sóng',
      'tw.alert.lead': 'Sắp vào vùng mất sóng ~{min} phút (dài {len}). Gửi toạ độ cho người thân?',
      'tw.alert.now': 'Sắp vào vùng mất sóng (dài {len}). Gửi toạ độ cho người thân?',
      'tw.alert.demo': 'Mô phỏng cho buổi demo — không phải cảnh báo thật.',
      'tw.manual.title': 'Gửi vị trí cho người thân',
      'tw.manual.lead': 'Gửi toạ độ hiện tại của bạn cho người thân?',
      'tw.manual.lead_old': 'Chưa lấy được vị trí mới. Gửi vị trí đã biết gần nhất cho người thân?',
      'tw.pos.label': 'Vị trí', 'tw.pos.fix': '{coords} · lúc {time}', 'tw.pos.est': '{coords} · ước tính theo lộ trình',
      'tw.pos.old': '{coords} · vị trí đã biết gần nhất, {when} ({ago})', 'tw.pos.last': '{coords} · vị trí đã biết gần nhất',
      'tw.pos.sim': '{coords} · vị trí mô phỏng',
      'tw.pos.none': 'Chưa có vị trí — tin nhắn sẽ không có toạ độ.',
      'tw.to.label': 'Gửi tới', 'tw.to.buddy': 'Người nhận Buddy: {name}', 'tw.to.buddy_anon': 'Người nhận Buddy của bạn',
      'tw.to.contact': 'Liên hệ khẩn cấp: {name}', 'tw.to.contact_anon': 'Liên hệ khẩn cấp trong Hồ sơ QR (đã ẩn)',
      'tw.to.none': 'Chưa có số người nhận — bật Buddy để lưu số người thân, hoặc bấm Chia sẻ để tự chọn người nhận.',
      'tw.to.demo': 'Số minh hoạ — bản demo không mở ứng dụng SMS.',
      'tw.logged': 'Vị trí cũng được ghi lên máy chủ Buddy (máy chủ không tự báo cho người nhận).',
      'tw.msg.show': 'Xem nội dung tin nhắn',
      'tw.btn.sms': 'Gửi SMS', 'tw.btn.share': 'Chia sẻ', 'tw.btn.later': 'Để sau', 'tw.btn.buddy': 'Bật Buddy',
      'tw.toast.sms': 'Đã mở ứng dụng SMS — bấm Gửi trong ứng dụng để gửi.',
      'tw.toast.sms_demo': 'Số minh hoạ ({num}) — bản demo không mở ứng dụng SMS. Bấm Chia sẻ để thử gửi.',
      'tw.toast.share': 'Đã mở bảng chia sẻ của máy.',
      'tw.toast.copied': 'Máy này không có bảng chia sẻ — đã sao chép nội dung, hãy dán vào tin nhắn.',
      'tw.toast.copy_fail': 'Không sao chép được — mở “Xem nội dung tin nhắn” để chép tay.',
      'tw.share.title': 'NomadCare — vị trí của tôi',
      'tw.sms.deadzone': '[NomadCare] Mình sắp vào vùng mất sóng (~{min} phút nữa, dài khoảng {len}), có thể không liên lạc được khoảng {dur}{until}.',
      'tw.sms.until': ' (tới khoảng {time})',
      'tw.sms.manual': '[NomadCare] Vị trí của mình.',
      'tw.sms.at': ' Vị trí lúc {time}: {coords} {link}',
      'tw.sms.est': ' (ước tính theo lộ trình)',
      'tw.sms.old': ' Vị trí đã biết gần nhất ({when}, {ago}): {coords} {link}',
      'tw.sms.last': ' Vị trí đã biết gần nhất: {coords} {link}',
      'tw.sms.sim': ' Vị trí mô phỏng (demo): {coords} {link}',
      'tw.sms.noloc': ' Chưa có toạ độ.',
      'tw.start.ok': 'Đã bắt đầu chuyến đi — sẽ nhắc trước {n} vùng mất sóng; lần nhắc đầu khoảng {time}.',
      'tw.start.ok_one': 'Đã bắt đầu chuyến đi — sẽ nhắc trước {n} vùng mất sóng; lần nhắc đầu khoảng {time}.',
      'tw.start.none': 'Đã bắt đầu chuyến đi — lộ trình không có vùng mất sóng đã biết.',
      'tw.start.passed': 'Đã bắt đầu chuyến đi — không còn vùng mất sóng nào phía trước.',
      'tw.start.unknown': '{km} chưa có dữ liệu sóng — không nhắc được ở đoạn đó.',
      'tw.start.fg': 'Lời nhắc chạy khi NomadCare đang mở; khoá máy hoặc chuyển ứng dụng có thể làm lời nhắc đến trễ.',
      'tw.start.push': 'Có thông báo đẩy kể cả khi đã đóng ứng dụng.',
      'tw.start.notif_off': 'Thông báo hệ thống chưa được cho phép — lời nhắc chỉ hiện trong ứng dụng.',
      'tw.start.notif_wait': 'Đang chờ bạn cho phép thông báo — nếu không, lời nhắc chỉ hiện trong ứng dụng.',
      'tw.start.notif_user_off': 'Bạn đã tắt thông báo hệ thống — lời nhắc chỉ hiện trong ứng dụng.',
      'tw.start.notif_na': 'Trình duyệt này không có thông báo hệ thống — lời nhắc chỉ hiện trong ứng dụng.',
      'tw.perm.granted': 'Đã bật thông báo — lời nhắc hiện khi NomadCare đang mở; khoá máy có thể làm lời nhắc đến trễ.',
      'tw.perm.granted_push': 'Đã bật thông báo — có thông báo đẩy kể cả khi đã đóng ứng dụng.',
      'tw.perm.denied': 'Thông báo chưa được cho phép — lời nhắc chỉ hiện trong ứng dụng.',
      'tw.start.invalid': 'Lộ trình chưa đủ dữ liệu để bắt đầu chuyến đi.',
      'tw.stop.user': 'Đã kết thúc chuyến đi.', 'tw.stop.arrived': 'Đã tới nơi — chuyến đi tự kết thúc.',
      'tw.stop.expired': 'Chuyến đi tự kết thúc (đã quá gấp đôi thời gian dự kiến).',
      'tw.notif.title': 'NomadCare: sắp vào vùng mất sóng',
      'tw.notif.title_sim': 'NomadCare (mô phỏng): sắp vào vùng mất sóng',
      'tw.notif.body': '~{min} phút nữa (dài {len}). Chạm để gửi toạ độ cho người thân.'
    },
    en: {
      'tw.alert.title': 'No-signal area reminder',
      'tw.alert.lead': 'A no-signal area starts in ~{min} min ({len} long). Send your coordinates to your contact?',
      'tw.alert.now': 'A no-signal area starts now ({len} long). Send your coordinates to your contact?',
      'tw.alert.demo': 'Demo simulation — not a real warning.',
      'tw.manual.title': 'Send your location',
      'tw.manual.lead': 'Send your current coordinates to your contact?',
      'tw.manual.lead_old': 'No fresh location yet. Send your last known location to your contact?',
      'tw.pos.label': 'Location', 'tw.pos.fix': '{coords} · at {time}', 'tw.pos.est': '{coords} · estimated from the route',
      'tw.pos.old': '{coords} · last known location, {when} ({ago})', 'tw.pos.last': '{coords} · last known location',
      'tw.pos.sim': '{coords} · simulated location',
      'tw.pos.none': 'No location yet — the message has no coordinates.',
      'tw.to.label': 'To', 'tw.to.buddy': 'Buddy recipient: {name}', 'tw.to.buddy_anon': 'Your Buddy recipient',
      'tw.to.contact': 'Emergency contact: {name}', 'tw.to.contact_anon': 'Emergency contact from your QR profile (hidden)',
      'tw.to.none': "No recipient number yet — turn on Buddy to save your contact's number, or tap Share to pick someone.",
      'tw.to.demo': 'Illustrative number — the demo does not open the SMS app.',
      'tw.logged': 'Your location is also saved on the Buddy server (the server does not notify your contact by itself).',
      'tw.msg.show': 'Show the message',
      'tw.btn.sms': 'Send SMS', 'tw.btn.share': 'Share', 'tw.btn.later': 'Later', 'tw.btn.buddy': 'Turn on Buddy',
      'tw.toast.sms': 'SMS app opened — tap Send there to send it.',
      'tw.toast.sms_demo': 'Illustrative number ({num}) — the demo does not open the SMS app. Tap Share to try sending.',
      'tw.toast.share': 'Share sheet opened.',
      'tw.toast.copied': 'No share sheet on this device — the text is copied; paste it into a message.',
      'tw.toast.copy_fail': 'Could not copy — open “Show the message” and copy it by hand.',
      'tw.share.title': 'NomadCare — my location',
      'tw.sms.deadzone': "[NomadCare] I'm about to enter a no-signal area (in ~{min} min, about {len} long); I may be unreachable for about {dur}{until}.",
      'tw.sms.until': ' (until about {time})',
      'tw.sms.manual': '[NomadCare] My location.',
      'tw.sms.at': ' Location at {time}: {coords} {link}',
      'tw.sms.est': ' (estimated from my route)',
      'tw.sms.old': ' Last known location ({when}, {ago}): {coords} {link}',
      'tw.sms.last': ' Last known location: {coords} {link}',
      'tw.sms.sim': ' Simulated location (demo): {coords} {link}',
      'tw.sms.noloc': ' No coordinates yet.',
      'tw.start.ok': "Trip started — you'll be reminded before {n} no-signal areas; first reminder around {time}.",
      'tw.start.ok_one': "Trip started — you'll be reminded before {n} no-signal area; first reminder around {time}.",
      'tw.start.none': 'Trip started — no known no-signal area on this route.',
      'tw.start.passed': 'Trip started — no no-signal area left ahead.',
      'tw.start.unknown': '{km} without signal data — no reminder there.',
      'tw.start.fg': 'Reminders work while NomadCare is open; locking the phone or switching apps may delay them.',
      'tw.start.push': 'Push notifications arrive even when the app is closed.',
      'tw.start.notif_off': 'System notifications are not allowed — reminders only show in the app.',
      'tw.start.notif_wait': 'Waiting for you to allow notifications — otherwise reminders only show in the app.',
      'tw.start.notif_user_off': 'You turned system notifications off — reminders only show in the app.',
      'tw.start.notif_na': 'This browser has no system notifications — reminders only show in the app.',
      'tw.perm.granted': 'Notifications on — reminders show while NomadCare is open; locking the phone may delay them.',
      'tw.perm.granted_push': 'Notifications on — push reminders arrive even when the app is closed.',
      'tw.perm.denied': 'Notifications are not allowed — reminders only show in the app.',
      'tw.start.invalid': 'This route lacks the data needed to start a trip.',
      'tw.stop.user': 'Trip ended.', 'tw.stop.arrived': 'You have arrived — the trip ended by itself.',
      'tw.stop.expired': 'The trip ended by itself (twice the expected duration has passed).',
      'tw.notif.title': 'NomadCare: no-signal area ahead',
      'tw.notif.title_sim': 'NomadCare (simulated): no-signal area ahead',
      'tw.notif.body': 'In ~{min} min ({len} long). Tap to send your coordinates to your contact.'
    }
  });

  var st = {
    trip: null, loaded: null, timer: null, popup: null, popupKey: null, prefs: { notify: true, vibrate: true },
    prefsSet: {}, pushJson: null, pushBusy: false, refreshing: null, simWarned: {}
  };
  /** ?demo=1: every position is simulated by design (NC.geo demo rule), so simulated positions may be stored. */
  function demoMode() { return !!(NC.geo && typeof NC.geo.isDemo === 'function' && NC.geo.isDemo()); }
  /**
   * A position that may be stored on the Buddy server as the traveller's location: a fix ≤ 10 min old (never a route
   * estimate or an old saved position; a simulated one only in ?demo=1).
   */
  function storable(pos) { return !!pos && !pos.est && (!pos.sim || demoMode()) && !posOld(pos); }

  /* ---------------- persistence ---------------- */
  function persist() {
    if (!NC.store) return Promise.resolve();
    return (st.trip ? NC.store.set(KV_TRIP, st.trip) : NC.store.del(KV_TRIP)).catch(noop);
  }
  function publicTrip() {
    if (!st.trip) return null;
    var x = JSON.parse(JSON.stringify(st.trip));
    x.alerts = core.schedule(st.trip, Date.now());
    x.est_km = r3(core.estKm(st.trip, Date.now()));
    return x;
  }
  function publish(remote) {
    var p = { trip: publicTrip() };
    if (!NC.bus) return;
    if (!remote && NC.bus.broadcast) NC.bus.broadcast('trip:update', p);
    else NC.bus.emit('trip:update', p);
  }
  function load() {
    if (st.loaded) return st.loaded;
    st.loaded = Promise.all([
      NC.store ? NC.store.get(KV_TRIP).catch(function () { return null; }) : null,
      NC.store ? NC.store.get(KV_PREFS).catch(function () { return null; }) : null,
      NC.store ? NC.store.get(KV_BD_PREFS).catch(function () { return null; }) : null
    ]).then(function (r) {
      var tr = r[0];
      st.trip = tr && tr.v === 1 && validGeom(tr.geometry) && Array.isArray(tr.zones) ? tr : null;
      var saved = r[1] && typeof r[1] === 'object' ? Object.assign({}, r[1]) : {};
      // the MOD.04 "Rung" switch wins (it may have been saved before NC.trip had its own prefs)
      if (r[2] && typeof r[2] === 'object' && typeof r[2].vibrate === 'boolean') saved.vibrate = r[2].vibrate;
      // a setPrefs() made while loading is newer than what was stored
      Object.keys(st.prefs).forEach(function (k) { if (!st.prefsSet[k] && typeof saved[k] === 'boolean') st.prefs[k] = saved[k]; });
      return st.trip;
    });
    return st.loaded;
  }

  /* ---------------- timers ---------------- */
  function arm() {
    clearTimeout(st.timer); st.timer = null;
    var tr = st.trip;
    if (!tr) return;
    var now = Date.now();
    var end = core.endReason(tr, now, null);
    if (end) { stop(end); return; }
    var heldBefore = JSON.stringify(tr.held || {});
    var due = core.nextDue(tr, now);   // the nearest one; others due with it wait until that zone is left
    if (JSON.stringify(tr.held || {}) !== heldBefore) persist();
    if (due) fire(due, { source: 'trip' });
    var next = core.nextWake(tr, now);
    if (next === null) return;
    // setTimeout drifts / sleeps with the device: wake at most every 30 min and look again (also on visibilitychange).
    st.timer = setTimeout(arm, clamp(next - now + 250, 1000, 30 * MIN));
  }

  /**
   * A position with a trustworthy `at` (core.fixTime): µs timestamps recovered; a future / unreadable time becomes
   * `fallbackAt` — "now" for a fix just taken (fixOnce bounds its age with maxAge), null (unknown age → "vị trí đã biết
   * gần nhất") for a saved one. Never shows "lúc 01:26" for a fix taken at 08:26 (WebKit).
   */
  function saneFix(p, fresh) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng)) return null;
    var now = Date.now();
    var ms = core.fixTime(p.at, now);
    var at = ms !== null ? iso(ms) : (fresh ? iso(now) : null);
    return at === p.at ? p : Object.assign({}, p, { at: at });
  }
  /** One fix (never a prompt) → progress → recompute. Resolves the fix or null. */
  function takeFix(timeoutMs) {
    var G = NC.geo;
    if (G && typeof G.fixOnce === 'function') {
      return Promise.resolve(G.fixOnce({ timeout_ms: timeoutMs || 8000, maxAge_ms: 60000 })).then(function (p) {
        return p ? saneFix(p, p.source !== 'sim' && p.source !== 'manual') : null;
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }
  function lastKnown() {
    var G = NC.geo;
    var p = G && typeof G.last === 'function' ? G.last() : (NC.settings ? NC.settings.get('last_position') : null);
    return saneFix(p, false);
  }
  function progressFn() {
    var R = routing();
    if (R && typeof R.progressOnLine === 'function') return R.progressOnLine;
    if (R && typeof R.nearestOnLine === 'function') {
      return function (g, p) { var n = R.nearestOnLine(g, { lat: p[0], lng: p[1] }); return n ? { km_along: n.along_km, offset_km: n.distance_km } : null; };
    }
    return null;
  }
  /** Apply a position (from any fix) to the active trip. */
  function updatePosition(pos) {
    return load().then(function () {
      if (!st.trip || !pos) return null;
      var now = Date.now();
      var end = core.endReason(st.trip, now, pos);
      if (end) return stop(end);
      var r = core.applyFix(st.trip, pos, progressFn(), now);
      if (r.used) { persist(); publish(); schedulePush(); }
      arm();
      return r;
    });
  }
  function refresh(timeoutMs) {
    if (st.refreshing) return st.refreshing;
    st.refreshing = load().then(function () {
      if (!st.trip) return null;
      return takeFix(timeoutMs).then(function (pos) { return pos ? updatePosition(pos) : (arm(), null); });
    }).then(function (r) { st.refreshing = null; return r; }, function () { st.refreshing = null; arm(); return null; });
    return st.refreshing;
  }

  /* ---------------- notifications ---------------- */
  function permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; }
  /** The browser prompt. MUST run synchronously inside the tap (Firefox / Safari need the gesture). */
  function requestPerm() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return new Promise(function (resolve) {
      var done = false;
      var fin = function (p) { if (!done) { done = true; resolve(p || Notification.permission); } };
      try {
        var r = Notification.requestPermission(fin);
        if (r && typeof r.then === 'function') r.then(fin, function () { fin('denied'); });
      } catch (e) { fin('denied'); }
    });
  }
  /** The permission is known (possibly long after the tap): tell the screens, (re)subscribe Web Push when granted. */
  function permKnown(p) {
    if (NC.bus) NC.bus.emit('trip:permission', { state: p });
    if (p === 'granted') ensurePush();
  }
  /** Ask for notification permission (MOD.04 switch). Call it synchronously inside the tap. */
  function askPermission() {
    return requestPerm().then(function (p) { permKnown(p); return p; });
  }
  function notifyOk() { return st.prefs.notify !== false && permission() === 'granted'; }
  function tagOf(a) { return 'nc-dz-' + (+a.zone_km).toFixed(3); }
  function appUrl(key) {
    var base = NC.ui && NC.ui.assetUrl ? NC.ui.assetUrl('index.html') : 'index.html';
    return base + '?nc_alert=' + encodeURIComponent(key || '1') + '#/map';
  }
  function systemNotify(a, simulated) {
    if (!notifyOk()) return;
    // Journey simulator / demo button: say so, and use a separate tag so a simulated reminder never replaces a real one.
    var title = simulated ? t('tw.notif.title_sim') : t('tw.notif.title');
    var opts = {
      body: t('tw.notif.body', { min: Math.max(1, Math.round(a.minutes_to_zone || 0)), len: U.fmtKm(a.length_km) }),
      tag: simulated ? tagOf(a).replace('nc-dz-', 'nc-sim-') : tagOf(a), renotify: true, icon: NC.ui.assetUrl('assets/img/icons/icon-192.png'),
      data: { url: appUrl(a.key), key: a.key, kind: 'deadzone_ahead' }
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg && reg.showNotification) return reg.showNotification(title, opts);
          new Notification(title, opts); // eslint-disable-line no-new
          return null;
        }).catch(function () { try { new Notification(title, opts); } catch (e) { /* best effort */ } }); // eslint-disable-line no-new
      } else new Notification(title, opts); // eslint-disable-line no-new
    } catch (e) { /* notifications are best effort */ }
  }

  /* ---------------- firing ---------------- */
  /** First tab to claim a reminder records it + notifies; other tabs only show the popup when they are visible. */
  function claim(tripId, key) {
    try {
      var raw = localStorage.getItem(LS_FIRED);
      var m = raw ? JSON.parse(raw) : {};
      var k = tripId + '|' + key;
      if (m[k] && Date.now() - m[k] < 6 * HOUR) return false;
      Object.keys(m).forEach(function (x) { if (Date.now() - m[x] > 6 * HOUR) delete m[x]; });
      m[k] = Date.now();
      localStorage.setItem(LS_FIRED, JSON.stringify(m));
      return true;
    } catch (e) { return true; }
  }
  function fire(a, o) {
    o = o || {};
    var tr = st.trip;
    if (tr && o.source === 'trip') { tr.fired[a.key] = new Date().toISOString(); persist(); }
    var mine = o.source !== 'trip' || !tr || claim(tr.id, a.key);
    if (NC.bus) NC.bus.emit('trip:alert', { alert: a, source: o.source || 'trip' });
    if (!mine && !visible()) { publish(); return Promise.resolve(null); }
    if (mine) {
      // Chrome blocks (and logs) vibrate before the first tap of the page: a reminder fired at load stays silent
      var act = navigator.userActivation;
      if (st.prefs.vibrate && (!act || act.hasBeenActive)) U.vibrate([220, 100, 220, 100, 220]);
      // R6: system notification AND the in-app popup, visible or not. One tag per zone ('nc-dz-<km>', the same as the
      // server push of push-dispatch) → a later push or a second tab replaces it instead of stacking a duplicate.
      systemNotify(a, o.source === 'sim' || o.source === 'demo');
    }
    var pos = alertPosition(a, o);
    var logP = mine ? logPreDeadzone(a, pos, o) : Promise.resolve(false);
    publish();
    return logP.then(function (logged) {
      return promptShare({ reason: 'deadzone', alert: a, position: pos, logged: logged, demo: o.source === 'demo' });
    });
  }
  /** A saved position → popup / message position ({…, est:false, sim}); sim = a simulated position (demo rule / FAB). */
  function fromSaved(p) {
    return p ? { lat: +p.lat, lng: +p.lng, at: p.at || null, accuracy_m: p.accuracy_m || null, source: p.source || 'gps', est: false, sim: p.source === 'sim' } : null;
  }
  function posAgeMs(pos) { var at = pos && pos.at ? Date.parse(pos.at) : NaN; return isFinite(at) ? Date.now() - at : null; }
  /** A real fix older than 10 min (or of unknown age): shown and sent as "vị trí đã biết gần nhất" with its date. */
  function posOld(pos) { if (!pos || pos.est || pos.sim) return false; var a = posAgeMs(pos); return a === null || a > FRESH_MS; }
  /**
   * Best position for a reminder: the reminder's own (journey simulator / demo button: simulated, labelled so), a fix
   * ≤ 10 min old, else the route estimate, else the last known fix (labelled with its date).
   */
  function alertPosition(a, o) {
    o = o || {};
    if (a && isFinite(a.lat) && isFinite(a.lng) && a.lat !== null && a.lng !== null) {
      var simulated = o.source === 'sim' || o.source === 'demo' || !!a.simulated;
      return { lat: +a.lat, lng: +a.lng, at: a.at || new Date().toISOString(), source: simulated ? 'sim' : 'gps', est: false, sim: simulated };
    }
    var p = fromSaved(lastKnown());
    if (p && !posOld(p)) return p;
    if (st.trip) {
      var q = core.pointAtKm(st.trip, core.estKm(st.trip, Date.now()));
      if (q) return { lat: q[0], lng: q[1], at: new Date().toISOString(), source: 'route', est: true, sim: false };
    }
    return p;
  }
  /**
   * Open Buddy session → 'pre_deadzone' check-in (the server stores it; nobody is notified by it). Outside ?demo=1 the
   * demo button and the journey simulator never write to the session (their positions are made up); a route estimate or
   * a simulated position is never stored as a location (the server's "vị trí cuối" must be a real fix).
   */
  function logPreDeadzone(a, pos, o) {
    if (!NC.data || !NC.data.buddy) return Promise.resolve(false);
    if ((o.source === 'demo' || o.source === 'sim') && !demoMode()) return Promise.resolve(false);
    return NC.data.buddy.current().then(function (s) {
      if (!s) return false;
      var meta = { source: o.source === 'sim' ? 'simulator' : o.source === 'demo' ? 'demo' : 'trip', zone_start_km: a.zone_km, zone_end_km: a.end_km,
        length_km: a.length_km, minutes: Math.round((a.minutes_to_zone || 0) * 10) / 10, mode: a.mode || (st.trip ? st.trip.mode : null),
        route_id: a.route_id || (st.trip ? st.trip.route_id : null), estimated: !!(pos && pos.est), simulated: !!(pos && pos.sim) };
      var real = storable(pos);
      return NC.data.buddy.checkin({ kind: 'pre_deadzone', lat: real ? pos.lat : null, lng: real ? pos.lng : null,
        accuracy_m: real && pos.accuracy_m ? pos.accuracy_m : null, meta: meta }).then(function () { return true; }, function () { return false; });
    }).catch(function () { return false; });
  }

  /* ---------------- recipient ---------------- */
  function normPhone(p) {
    if (NC.buddyPhone && NC.buddyPhone.norm) return NC.buddyPhone.norm(p);
    var f = NC.ui && NC.ui.formatPhoneAction ? NC.ui.formatPhoneAction(p) : { display: String(p || ''), isDemo: false };
    var d = String(p || '').replace(/[^\d+]/g, '');
    return { e164: d.length >= 8 ? d : null, valid: d.length >= 8, isDemo: !!f.isDemo, display: f.display };
  }
  /** {kind:'buddy'|'contact'|null, number, label, isDemo, hidden} — the number is never shown behind a reveal code. */
  function recipient() {
    var buddyP = NC.data && NC.data.buddy ? NC.data.buddy.current().catch(function () { return null; }) : Promise.resolve(null);
    var profP = NC.profile && NC.profile.get ? Promise.resolve().then(function () { return NC.profile.get(); }).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([buddyP, profP]).then(function (r) {
      var s = r[0], p = r[1];
      var id = (p && p.identity) || {};
      var hidden = !!id.reveal_code;
      if (s && s.recipient_phone) {
        var n = normPhone(s.recipient_phone);
        if (n.valid || n.e164) {
          var name = s.recipient_name || '';
          return { kind: 'buddy', number: n.e164, isDemo: !!n.isDemo, hidden: hidden,
            label: hidden || !name ? t('tw.to.buddy_anon') : t('tw.to.buddy', { name: name }), session: s };
        }
      }
      if (id.contact_phone) {
        var c = normPhone(id.contact_phone);
        var f = NC.ui && NC.ui.formatPhoneAction ? NC.ui.formatPhoneAction(id.contact_phone) : { isDemo: false };
        var number = c.e164 || String(id.contact_phone).replace(/[^\d+]/g, '');
        if (number.replace(/\D/g, '').length >= 8) {
          return { kind: 'contact', number: number, isDemo: !!(c.isDemo || f.isDemo), hidden: hidden,
            label: hidden ? t('tw.to.contact_anon') : t('tw.to.contact', { name: id.contact_name || (c.display || id.contact_phone) }), session: s };
        }
      }
      return { kind: null, number: null, isDemo: false, hidden: false, label: t('tw.to.none'), session: s };
    });
  }

  /* ---------------- message ---------------- */
  function coordsText(p) { return (+p.lat).toFixed(5) + ', ' + (+p.lng).toFixed(5); }
  /** The popup's "Vị trí" line: simulated / route estimate / last known (date + age) / a fresh fix. */
  function posLine(pos) {
    if (!pos) return t('tw.pos.none');
    var c = coordsText(pos);
    if (pos.sim) return t('tw.pos.sim', { coords: c });
    if (pos.est) return t('tw.pos.est', { coords: c });
    if (posOld(pos)) return pos.at ? t('tw.pos.old', { coords: c, when: U.fmtDateTime(pos.at), ago: U.relTime(pos.at) }) : t('tw.pos.last', { coords: c });
    return t('tw.pos.fix', { coords: c, time: U.fmtTime(pos.at || new Date()) });
  }
  /** The position part of the SMS / share text (same labels as the popup). */
  function posSms(pos) {
    if (!pos) return t('tw.sms.noloc');
    var c = { coords: coordsText(pos), link: core.osmLink(pos.lat, pos.lng) };
    if (pos.sim) return t('tw.sms.sim', c);
    if (pos.est) return t('tw.sms.at', Object.assign({ time: U.fmtTime(pos.at || new Date()) }, c)) + t('tw.sms.est');
    if (posOld(pos)) return pos.at ? t('tw.sms.old', Object.assign({ when: U.fmtDateTime(pos.at), ago: U.relTime(pos.at) }, c)) : t('tw.sms.last', c);
    return t('tw.sms.at', Object.assign({ time: U.fmtTime(pos.at || new Date()) }, c));
  }
  function messageFor(o, pos) {
    var a = o.alert;
    var body;
    if (o.reason === 'deadzone' && a) {
      var until = a.exit_at && Date.parse(a.exit_at) > Date.now() ? t('tw.sms.until', { time: U.fmtTime(a.exit_at) }) : '';
      body = t('tw.sms.deadzone', { min: Math.max(1, Math.round(a.minutes_to_zone || 0)), len: U.fmtKm(a.length_km),
        dur: U.fmtDuration(Math.max(1, a.silence_min || 0)), until: until });
    } else body = t('tw.sms.manual');
    return body + posSms(pos);
  }

  /* ---------------- popup ---------------- */
  var uiWaiters = [];
  /** The shell is up and no onboarding runs (contract C1 'app:ready' / 'onboarding:done'). */
  function uiReady() {
    if (!NC.app) return false;
    var rs = NC.app.readyState ? NC.app.readyState() : { ready: true, onboarding: false };
    if (!rs.ready) return false;
    if (!rs.onboarding) return true;
    // the app started on #/onboarding of a device that is already onboarded (restored tab): the onboarding screen
    // only redirects and 'onboarding:done' never comes — the popup must not wait for ever
    var cur = NC.app.current ? NC.app.current() : null;
    return !!(NC.settings && NC.settings.get('onboarded') === true && cur && cur.name !== 'onboarding');
  }
  function whenUiReady() {
    if (uiReady()) return Promise.resolve();
    return new Promise(function (resolve) { uiWaiters.push(resolve); });
  }
  function flushUiWaiters() {
    if (!uiReady()) return;
    var w = uiWaiters; uiWaiters = [];
    w.forEach(function (fn) { setTimeout(fn, 350); });
  }

  /**
   * The ONE popup (reminder / manual "Gửi vị trí" / demo). opts: {reason:'deadzone'|'manual', alert, position, logged,
   * demo}. Survives navigation (keepOnRoute). Resolves with 'sms' | 'sms_demo' | 'share' | 'copy' | 'later' | 'setup' | null.
   */
  function promptShare(opts) {
    opts = opts || {};
    var reason = opts.reason === 'deadzone' ? 'deadzone' : 'manual';
    var key = reason === 'deadzone' && opts.alert ? String(opts.alert.key) : 'manual';
    if (st.popup && st.popupKey === key) return st.popup.closed.then(function (v) { return v || null; });
    return whenUiReady().then(function () { return recipient(); }).then(function (rcp) {
      if (st.popup) { try { st.popup.close(); } catch (e) { /* ignore */ } }
      var pos = opts.position || (reason === 'manual' ? freshOrLast() : alertPosition(opts.alert || {}, {}));
      var logged = !!opts.logged;
      var body = U.h('div', { class: 'tw-pop' });
      var chosen = null;
      function render() {
        var a = opts.alert;
        var lead = reason === 'deadzone' && a
          ? (Math.round(a.minutes_to_zone || 0) >= 1 ? t('tw.alert.lead', { min: Math.round(a.minutes_to_zone), len: U.fmtKm(a.length_km) }) : t('tw.alert.now', { len: U.fmtKm(a.length_km) }))
          : t(posOld(pos) ? 'tw.manual.lead_old' : 'tw.manual.lead');
        var msg = messageFor({ reason: reason, alert: a }, pos);
        var was = body.querySelector('.tw-pop__msg');
        var msgOpen = !!(was && was.open);   // a fresher fix re-renders: keep the message open if it was
        body.innerHTML =
          (opts.demo ? '<p class="tw-pop__demo">' + icon('sparkles', 'icon--xs') + '<span>' + esc(t('tw.alert.demo')) + '</span></p>' : '') +
          '<p class="tw-pop__lead">' + esc(lead) + '</p>' +
          '<dl class="tw-pop__kv">' +
            '<div><dt>' + esc(t('tw.to.label')) + '</dt><dd>' + icon(rcp.kind ? 'user' : 'info', 'icon--xs') + '<span>' + esc(rcp.label) + '</span></dd></div>' +
            '<div><dt>' + esc(t('tw.pos.label')) + '</dt><dd>' + icon('map-pin', 'icon--xs') + '<span translate="no">' + esc(posLine(pos)) + '</span></dd></div>' +
          '</dl>' +
          (rcp.isDemo ? '<p class="tw-pop__note">' + icon('info', 'icon--xs') + '<span>' + esc(t('tw.to.demo')) + '</span></p>' : '') +
          (logged ? '<p class="tw-pop__note">' + icon('cloud', 'icon--xs') + '<span>' + esc(t('tw.logged')) + '</span></p>' : '') +
          // the shared ".disclosure" (components.css): chevron + no native marker, the same in Chrome, Firefox and WebKit
          '<details class="disclosure tw-pop__msg"' + (msgOpen ? ' open' : '') + '><summary class="disclosure__sum"><span class="disclosure__txt"><span class="disclosure__title">' +
            esc(t('tw.msg.show')) + '</span></span><span class="disclosure__chev">' + icon('chevron-down') + '</span></summary>' +
            '<div class="disclosure__body"><pre translate="no">' + esc(msg) + '</pre></div></details>';
      }
      render();
      // A fresher fix may arrive while the popup is open (never a prompt): the message follows it. A simulated
      // reminder (journey simulator / demo button) keeps its simulated position.
      if (!pos || pos.est || posOld(pos)) {
        takeFix(6000).then(function (p) {
          if (!p || !st.popup || st.popupKey !== key || chosen) return;
          pos = fromSaved(p);
          if (!pos.at) pos.at = new Date().toISOString();
          render();
          if (st.trip && reason === 'deadzone') updatePosition(p);
        });
      }
      var msgNow = function () { return messageFor({ reason: reason, alert: opts.alert }, pos); };
      var logManual = function (channel) {
        if (reason !== 'manual' || !rcp.session || logged) return;
        logged = true;
        var real = storable(pos);   // only a recent real fix becomes the session's last location
        NC.data.buddy.checkin({ kind: 'location', lat: real ? pos.lat : null, lng: real ? pos.lng : null,
          meta: { source: 'share', channel: channel, estimated: !!(pos && pos.est), simulated: !!(pos && pos.sim), stale: !!(pos && posOld(pos)) } }).catch(noop);
      };
      // DOM order = visual order = focus order: primary (full width) first, then Chia sẻ, then Để sau
      var actions = [];
      var shareAction = {
        label: t('tw.btn.share'), variant: rcp.kind ? 'soft' : 'outline', icon: 'share', value: 'share', id: 'tw-share',
        onClick: function () {
          var text = msgNow();
          chosen = 'share';
          if (navigator.share) {
            var p;
            try { p = navigator.share({ title: t('tw.share.title'), text: text }); } catch (e) { p = Promise.reject(e); }
            return Promise.resolve(p).then(function () {
              logManual('share');
              toast(t('tw.toast.share'), { type: 'info', timeout: 3500 });
              return true;
            }, function (e) {
              if (e && e.name === 'AbortError') { chosen = null; return false; }   // the user closed the share sheet
              return copyFallback(text).then(function (ok) { if (ok) { chosen = 'copy'; logManual('copy'); } return ok; });
            });
          }
          return copyFallback(text).then(function (ok) { if (ok) { chosen = 'copy'; logManual('copy'); } return ok; });
        }
      };
      if (rcp.kind) {
        actions.push({
          label: t('tw.btn.sms'), variant: 'primary', icon: 'message-square', value: 'sms', autofocus: true, id: 'tw-sms',
          onClick: function () {
            if (rcp.isDemo) {
              chosen = 'sms_demo';
              toast(t('tw.toast.sms_demo', { num: rcp.hidden ? '+84 000 000 0••' : (normPhone(rcp.number).display || rcp.number) }), { type: 'warning', timeout: 5000 });
              return false;
            }
            chosen = 'sms';
            var a = document.createElement('a');
            a.href = core.smsHref(rcp.number, msgNow());
            a.style.display = 'none'; document.body.appendChild(a); a.click();
            setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
            logManual('sms');
            toast(t('tw.toast.sms'), { type: 'info', timeout: 5000 });
            return true;
          }
        });
      } else {
        actions.push({ label: t('tw.btn.buddy'), variant: 'primary', icon: 'shield-check', value: 'setup', id: 'tw-buddy' });
      }
      actions.push(shareAction);
      actions.push({ label: t('tw.btn.later'), variant: 'ghost', value: 'later' });
      st.popupKey = key;
      st.popup = NC.ui.modal({
        title: t(reason === 'deadzone' ? 'tw.alert.title' : 'tw.manual.title'), icon: reason === 'deadzone' ? 'signal-off' : 'map-pin',
        iconVariant: reason === 'deadzone' ? 'warning' : 'primary', size: 'sm', className: 'tw-pop-modal', body: body,
        keepOnRoute: true, actions: actions,
        onClose: function (v) {
          st.popup = null; st.popupKey = null;
          if (v === 'setup') {
            var cur = NC.app && NC.app.current ? NC.app.current() : null;
            if (cur && cur.name === 'buddy' && NC.buddy && NC.buddy.focusSetup) NC.buddy.focusSetup();
            else if (NC.app) NC.app.go('buddy', { setup: '1' });
          }
        }
      });
      return st.popup.closed.then(function (v) { return v === undefined || v === null ? (chosen || 'later') : v; });
    });
  }
  function copyFallback(text) {
    return U.copyText(text).then(function (ok) {
      toast(t(ok ? 'tw.toast.copied' : 'tw.toast.copy_fail'), { type: ok ? 'info' : 'warning', timeout: 5000 });
      return !!ok;
    });
  }
  function freshOrLast() { return fromSaved(lastKnown()); }

  /* ---------------- push schedule (Supabase mode) ---------------- */
  function pushAvailable() { return !!(NC.push && NC.push.available && NC.push.available()); }
  /** Web Push may carry the reminders: available, permission granted AND the "Thông báo hệ thống" switch on. */
  function pushOk() { return pushAvailable() && st.prefs.notify !== false && permission() === 'granted'; }
  /**
   * Send the pending reminders as push.schedule. Without pushOk() (switch off, permission revoked) the schedule sent is
   * EMPTY, so the server never pushes to a closed app against the user's choice.
   */
  function schedulePush(force) {
    if (!pushAvailable()) return;
    var items = st.trip && pushOk() ? core.pushItems(st.trip, Date.now()) : [];
    // one op per real change (fire times rounded to the minute), not per recompute
    var sig = JSON.stringify(items.map(function (i) { return [Math.round(Date.parse(i.fire_at) / MIN), i.zone_km]; }));
    if (!force && sig === st.pushJson) return;
    st.pushJson = sig;
    NC.push.schedule(items).catch(function (e) { console.warn('[trip] push schedule', e && e.message); });
  }
  /** Subscribe (once; push.js skips a fresh subscription) and send the schedule of the active trip. */
  function ensurePush() {
    if (!st.trip || !pushOk() || st.pushBusy) return;   // one at a time (switch on + permission answer come together)
    st.pushBusy = true;
    NC.push.subscribe().then(function () { schedulePush(true); }).catch(function (e) { console.warn('[trip] push', e && e.message); })
      .then(function () { st.pushBusy = false; });
  }

  /* ---------------- public actions ---------------- */
  /**
   * Start a trip from a TripPlan (C2). Asks for notification permission FIRST (inside the tap) when it was never asked.
   * opts: {quiet:boolean (no toast), from:'map'|'buddy'}. Replaces an active trip.
   */
  function start(plan, opts) {
    opts = opts || {};
    // synchronous call inside the user gesture; not when the user turned "Thông báo hệ thống" off
    var wantNotify = st.prefs.notify !== false;
    var permP = wantNotify ? requestPerm() : Promise.resolve(permission());
    var shown = null;   // the permission state the start toast talked about
    var tr;
    try { tr = core.makeTrip(plan, Date.now()); } catch (e) {
      if (!opts.quiet) toast(t('tw.start.invalid'), { type: 'warning' });
      return Promise.reject(e);
    }
    return load().then(function () {
      st.trip = tr;
      st.pushJson = null;
      return persist();
    }).then(function () {
      publish();
      arm();
      if (!pushOk()) schedulePush(true);   // no push for this trip (yet): clear a replaced trip's server schedule
      // Whenever the prompt is answered (a person may read it for a while): push subscription + schedule, the MOD.04
      // switch, and a follow-up toast when the start toast could only say "waiting for your answer".
      permP.then(function (p) {
        permKnown(p);
        if (shown === 'pending' && !opts.quiet && st.trip && st.trip.id === tr.id && tr.zones.length) {
          toast(t(p === 'granted' ? (pushOk() ? 'tw.perm.granted_push' : 'tw.perm.granted') : 'tw.perm.denied'),
            { type: p === 'granted' ? 'success' : 'info', timeout: 5000 });
        }
      }, noop);
      // the start toast waits at most 1.5 s for the answer
      return Promise.race([permP, new Promise(function (r) {
        setTimeout(function () { r(wantNotify && permission() === 'default' ? 'pending' : permission()); }, 1500);
      })]);
    }).then(function (perm) {
      shown = perm;
      if (!opts.quiet) toast(startMessage(tr, perm), { type: 'success', timeout: 7000 });
      // one fix now (the permission may just have been granted by MOD.02): the traveller may already be on the way
      refresh(6000);
      return publicTrip();
    });
  }
  function startMessage(tr, perm) {
    var al = core.schedule(tr, Date.now());
    var ahead = al.filter(function (a) { return a.status === 'pending' || a.status === 'due'; });
    var msg;
    if (!tr.zones.length) msg = t('tw.start.none');
    else if (!ahead.length) msg = t('tw.start.passed');
    else {
      var k = ahead.length === 1 && NC.i18n && NC.i18n.has && NC.i18n.has('tw.start.ok_one') ? 'tw.start.ok_one' : 'tw.start.ok';
      msg = t(k, { n: ahead.length, time: U.fmtTime(ahead[0].status === 'due' ? new Date() : ahead[0].fire_at) });
    }
    // a few hundred metres of approach to the road network is no "stretch without data" worth a sentence
    if (tr.unknown_km >= 0.5) msg += ' ' + t('tw.start.unknown', { km: U.fmtKm(tr.unknown_km) });
    if (tr.zones.length) {
      var k2 = st.prefs.notify === false ? 'tw.start.notif_user_off'
        : perm === 'unsupported' ? 'tw.start.notif_na'
        : perm === 'pending' ? 'tw.start.notif_wait'
        : perm !== 'granted' ? 'tw.start.notif_off'
        : pushOk() ? 'tw.start.push' : 'tw.start.fg';
      msg += ' ' + t(k2);
    }
    return msg;
  }
  /** End the trip: reason 'user' | 'arrived' | 'expired' | 'replaced' | 'wiped'. */
  function stop(reason) {
    return load().then(function () {
      var old = st.trip;
      clearTimeout(st.timer); st.timer = null;
      if (!old) return null;
      st.trip = null;
      st.pushJson = null;
      schedulePush(true);
      return persist().then(function () {
        publish();
        var key = { user: 'tw.stop.user', arrived: 'tw.stop.arrived', expired: 'tw.stop.expired' }[reason];
        if (key && reason !== 'wiped') toast(t(key), { type: reason === 'user' ? 'info' : 'success', timeout: 5000 });
        return old;
      });
    });
  }
  function current() { return publicTrip(); }
  function alerts() { return st.trip ? core.schedule(st.trip, Date.now()) : []; }

  /**
   * Journey simulator (MOD.04 demo): the simulated position reached the reminder point of a zone → the same
   * reminder UX as a real trip. info: {key, zone_km, length_km, minutes, lat, lng, mode, speed_kmh, route_id}.
   */
  function simAlert(info) {
    info = info || {};
    var len = +info.length_km || 0;
    var v = +info.speed_kmh || defaultSpeed(modeOf(info.mode));
    var a = {
      key: String(info.key || ('sim:' + (+info.zone_km || 0).toFixed(3))), zone_km: +info.zone_km || 0, end_km: (+info.zone_km || 0) + len,
      length_km: len, minutes_to_zone: Math.max(0, +info.minutes || 0), silence_min: len / v * 60, mode: modeOf(info.mode),
      exit_at: new Date(Date.now() + ((+info.minutes || 0) + len / v * 60) * MIN).toISOString(), route_id: info.route_id || null,
      lat: isFinite(info.lat) && info.lat !== null ? +info.lat : null, lng: isFinite(info.lng) && info.lng !== null ? +info.lng : null,
      at: new Date().toISOString(), status: 'due'
    };
    return fire(a, { source: info.source === 'demo' ? 'demo' : 'sim' });
  }
  /** "Mô phỏng: sắp vào vùng mất sóng" (Chế độ demo): the popup right now — next zone of the active trip if any. */
  function demoAlert(info) {
    return load().then(function () {
      var a = null;
      if (st.trip) {
        a = core.schedule(st.trip, Date.now()).filter(function (x) { return x.status !== 'skipped'; })[0] || null;
      }
      if (a) {
        a = Object.assign({}, a, { key: 'demo:' + a.key, minutes_to_zone: a.minutes_before });
        return fire(a, { source: 'demo' });
      }
      var i = info || {};
      var mode = modeOf(i.mode || (NC.settings && NC.settings.get('travel_mode')));
      return simAlert({ key: 'demo:' + Date.now(), zone_km: i.zone_km || 0, length_km: i.length_km || 2.4, minutes: i.minutes || lead(mode).minutes,
        lat: i.lat, lng: i.lng, mode: mode, route_id: i.route_id || null, source: 'demo' });
    });
  }
  function silenceUntilNow() { return st.trip ? core.silenceUntil(st.trip, Date.now()) : null; }
  /** {notify, vibrate}. notify off → the server push schedule is emptied; back on → re-sent when permitted. */
  function setPrefs(p) {
    var before = st.prefs.notify;
    Object.keys(p || {}).forEach(function (k) { if (typeof p[k] === 'boolean' && k in st.prefs) { st.prefs[k] = p[k]; st.prefsSet[k] = true; } });
    if (NC.store) NC.store.set(KV_PREFS, st.prefs).catch(noop);
    if (before !== st.prefs.notify) {
      st.pushJson = null;
      if (st.prefs.notify) ensurePush(); else schedulePush(true);
    }
    return Object.assign({}, st.prefs);
  }

  /* ================================================================== */
  /* HEARTBEAT (open Buddy session)                                       */
  /* ================================================================== */
  var HB_MS = HEARTBEAT_MIN * MIN;
  var hb = { sid: null, lastAt: 0, lastState: null, pausedAt: 0, busy: false, timer: null };
  function hbSession(s) {
    var sid = s && s.status !== 'closed' ? s.id : null;
    var changed = sid !== hb.sid;
    hb.sid = sid;
    if (!sid) { hb.lastState = null; return; }
    if (changed && visible() && online()) beat('live');
  }
  /** Send one heartbeat. 'live': one fix (≤ 8 s, never a prompt); 'paused': the last known position, keepalive beacon. */
  function beat(state) {
    if (!hb.sid || !NC.data || !NC.data.buddy || typeof NC.data.buddy.heartbeat !== 'function') return Promise.resolve(null);
    if (state === 'live' && hb.busy) return Promise.resolve(null);
    var sid = hb.sid;
    var send = function (p) {
      // a simulated position (MOD.02 FAB) is never sent as the traveller's location outside ?demo=1
      var fresh = p && (!p.at || Date.now() - Date.parse(p.at) <= 2 * HB_MS) && (p.source !== 'sim' || demoMode());
      hb.lastState = state;
      return NC.data.buddy.heartbeat({
        session_id: sid, state: state, lat: fresh ? +p.lat : null, lng: fresh ? +p.lng : null,
        accuracy_m: fresh && isFinite(p.accuracy_m) ? Math.round(p.accuracy_m) : null, silence_until: silenceUntilNow()
      }, { beacon: state === 'paused' }).catch(function (e) { console.warn('[trip] heartbeat', e && e.message); return null; });
    };
    if (state === 'paused') { hb.pausedAt = Date.now(); return send(lastKnown()); }
    hb.busy = true;
    hb.lastAt = Date.now();
    return takeFix(8000).then(function (p) {
      if (p && st.trip) updatePosition(p);
      return send(p || lastKnown());
    }).then(function (r) { hb.busy = false; return r; }, function () { hb.busy = false; return null; });
  }
  function hbTick() {
    if (!hb.sid || !visible() || !online()) return;
    if (Date.now() - hb.lastAt >= HB_MS - 5000) beat('live');
  }

  /* ================================================================== */
  /* WIRING                                                               */
  /* ================================================================== */
  function onVisible() {
    if (!visible()) {
      if (hb.sid && hb.lastState === 'live') beat('paused');
      return;
    }
    refresh(6000);
    if (hb.sid && online()) beat('live');
  }
  /** notificationclick (sw.js) / ?nc_alert=… → show the popup of that reminder (or the latest due one). */
  function openFromNotification(key) {
    return load().then(function () {
      if (st.popup) return null;
      var list = alerts();
      var a = list.filter(function (x) { return x.key === key; })[0] ||
        list.filter(function (x) { return x.status === 'fired' || x.status === 'due'; }).pop() || null;
      if (!a || a.status === 'skipped') { refresh(6000); return null; }
      return promptShare({ reason: 'deadzone', alert: a });
    });
  }
  function consumeUrlAlert() {
    var q = U.qs();
    if (!q.nc_alert) return;
    try {
      var s = window.location.search.replace(/([?&])nc_alert=[^&]*(&|$)/, function (m, a, b) { return b ? a : ''; }).replace(/\?$/, '');
      history.replaceState(history.state, '', window.location.pathname + s + window.location.hash);
    } catch (e) { /* ignore */ }
    openFromNotification(q.nc_alert);
  }

  function init() {
    load().then(function () {
      arm();
      if (st.trip) { publish(true); refresh(6000); }
      if (uiReady()) consumeUrlAlert();
    }).catch(noop);
    if (NC.bus) {
      NC.bus.on('app:ready', function () { flushUiWaiters(); consumeUrlAlert(); });
      NC.bus.on('onboarding:done', flushUiWaiters);
      NC.bus.on('route:change', function () { if (uiWaiters.length) flushUiWaiters(); });
      NC.bus.on('trip:update', function (p, meta) {
        if (!meta || !meta.remote) return;
        st.loaded = null;       // another tab started / stopped / moved the trip
        load().then(arm);
      });
      NC.bus.on('buddy:update', function (p) { hbSession(p ? p.session : null); });
      NC.bus.on('buddy:event', function (p) {
        var ev = p && p.event;
        if (ev && ev.kind === 'checkin' && !ev.received_at && st.trip) refresh(8000);
      });
      NC.bus.on('net:change', function (s) { if (s && s.online && hb.sid && visible()) beat('live'); });
      NC.bus.on('data:wiped', function () {
        clearTimeout(st.timer); st.trip = null; st.loaded = null; hb.sid = null; st.pushJson = null;
        if (st.popup) { try { st.popup.close(); } catch (e) { /* ignore */ } }
        publish(true);
      });
      NC.bus.on('data:mode', function () { st.pushJson = null; schedulePush(true); });
    }
    if (NC.data && NC.data.buddy) NC.data.buddy.current().then(hbSession).catch(noop);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', function (e) { if (e && e.persisted) onVisible(); });
    window.addEventListener('pagehide', function () {
      if (hb.sid && hb.lastState === 'live' && Date.now() - hb.pausedAt > 3000) beat('paused');
    });
    hb.timer = setInterval(hbTick, 30000);
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        var d = e && e.data;
        if (!d) return;
        if (d.type === 'nc:trip-alert') openFromNotification(d.key || null);
        else if (d.type === 'nc:push' && d.kind === 'deadzone_ahead') refresh(6000);
      });
    }
  }

  NC.trip = {
    start: start, stop: stop, current: current, alerts: alerts, promptShare: promptShare, demoAlert: demoAlert,
    simAlert: simAlert, refresh: refresh, updatePosition: updatePosition, silenceUntil: silenceUntilNow,
    askPermission: askPermission, permission: permission,
    prefs: function () { return Object.assign({}, st.prefs); }, setPrefs: setPrefs,
    heartbeat: { beat: beat, state: function () { return { sid: hb.sid, lastAt: hb.lastAt, lastState: hb.lastState }; } },
    core: core
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);
})(typeof window !== 'undefined' ? window : globalThis);
