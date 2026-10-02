/*
 * backend-local.js — NC.backend.local: in-browser mock of the Supabase server tier (owner: P1 data).
 * IndexedDB 'nomadcare-server' (fallback: memory) seeded from window.NC_SEED (+ NC_SEED_ADMIN lazily), same RPC
 * names/semantics as contract §9 (list_routes, get_data_pack, build_data_pack, get_content_release, register_device,
 * sync_device_ops, nearest_facilities, admin_*), cron mock (overdue every 15 s + simulated alert), audit log,
 * realtime via BroadcastChannel 'nomadcare-server' → NC.bus 'server:change'.
 * Also exposes NC.backend.shared (pack builder, facility validation, EWKB/utility helpers) used by the other backends.
 */
(function (NC) {
  'use strict';

  var backend = NC.backend = NC.backend || {};

  /* ================================================================== shared helpers */

  var CARRIERS = ['viettel', 'vinaphone', 'mobifone'];
  var FACILITY_TYPES = ['tram_y_te', 'phong_kham', 'benh_vien', 'nha_thuoc'];
  var SERVICE_TYPES = ['lodging', 'repair', 'fuel', 'rental'];
  var FACILITY_STATUSES = ['verified', 'pending', 'rejected'];
  /** Fields required before a facility may be 'verified' (DB CHECK facilities_verified_complete). */
  var FACILITY_REQUIRED = ['name', 'address', 'lat', 'lng', 'type', 'open_hours', 'night_shift', 'trauma_capable', 'phone', 'verified_by', 'verified_at'];
  var STALE_DAYS = 90;
  var DAY_MS = 86400000;

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function nowIso() { return new Date().toISOString(); }
  function addMin(iso, min) { return new Date(Date.parse(iso) + min * 60000).toISOString(); }
  function minIso(a, b) { return Date.parse(a) <= Date.parse(b) ? a : b; }
  function isBlank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !isFinite(v)); }

  function uuid() {
    if (NC.util && NC.util.uuid) return NC.util.uuid();
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * Error with a machine-readable code (e.g. 'incomplete', 'forbidden', 'network', 'not_found').
   * @returns {Error}
   */
  function err(code, message, extra) {
    var e = new Error(message || code);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  /** Whole days between a date (YYYY-MM-DD or ISO) and today (local calendar), or null. */
  function daysSince(date, now) {
    if (!date) return null;
    var s = String(date).slice(0, 10).split('-');
    if (s.length < 3) return null;
    var then = Date.UTC(+s[0], +s[1] - 1, +s[2]);
    var d = now ? new Date(now) : new Date();
    var today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor((today - then) / DAY_MS);
  }

  /** Facility freshness decoration identical to v_facilities (is_stale = verified_at < current_date - 90). */
  function decorateFacility(f, now) {
    var out = Object.assign({}, f);
    var d = daysSince(f.verified_at, now);
    out.days_since_verified = d;
    out.is_stale = d !== null && d > STALE_DAYS;
    return out;
  }

  /**
   * Missing required fields for a 'verified' facility (strings are trimmed; false is a valid boolean).
   * @returns {string[]}
   */
  function facilityMissing(f) {
    return FACILITY_REQUIRED.filter(function (k) { return isBlank(f ? f[k] : null); });
  }

  function utf8Length(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return unescape(encodeURIComponent(str)).length;
  }

  /** sha256 hex (crypto.subtle) — falls back to a non-cryptographic FNV-1a digest where subtle is unavailable (mock only). */
  function sha256Hex(str) {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
        }).catch(function () { return fnvHex(str); });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(fnvHex(str));
  }

  function fnvHex(str) {
    var out = '';
    for (var round = 0; round < 8; round++) {
      var h = 0x811c9dc5 ^ round;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      out += ('00000000' + (h >>> 0).toString(16)).slice(-8);
    }
    return 'fnv' + out.slice(3);
  }

  function levelFromRsrp(rsrp) {
    if (NC.routing && NC.routing.levelFromRsrp) return NC.routing.levelFromRsrp(rsrp);
    if (rsrp === null || rsrp === undefined || !isFinite(+rsrp)) return 'lost';
    return +rsrp >= -105 ? 'likely' : (+rsrp >= -115 ? 'uncertain' : 'lost');
  }

  function num(v) { return v === null || v === undefined || v === '' ? null : +v; }

  /** Parse a PostGIS point returned by PostgREST (hex EWKB, GeoJSON object or "POINT(x y)") → {lat,lng}|null. */
  function parsePoint(g) {
    if (!g) return null;
    if (typeof g === 'object' && g.coordinates) return { lat: +g.coordinates[1], lng: +g.coordinates[0] };
    if (typeof g !== 'string') return null;
    var m = /POINT\s*\(\s*([-\d.eE]+)\s+([-\d.eE]+)\s*\)/i.exec(g);
    if (m) return { lat: +m[2], lng: +m[1] };
    if (!/^[0-9a-fA-F]+$/.test(g) || g.length < 42) return null;
    try {
      var bytes = new Uint8Array(g.length / 2);
      for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(g.substr(i * 2, 2), 16);
      var dv = new DataView(bytes.buffer);
      var le = bytes[0] === 1;
      var type = dv.getUint32(1, le);
      var off = 5;
      if (type & 0x20000000) off += 4; // SRID present
      if ((type & 0xff) !== 1) return null; // not a point
      return { lat: dv.getFloat64(off + 8, le), lng: dv.getFloat64(off, le) };
    } catch (e) { return null; }
  }

  function byRouteSort(a, b) { return ((a.sort || 0) - (b.sort || 0)) || String(a.id).localeCompare(String(b.id)); }

  /** Vietnam bounding box a verified facility must lie in (same as SQL admin_upsert_facility). */
  var VN_BBOX = { south: 8.1, north: 23.5, west: 102.1, east: 109.6 };
  function inVietnam(lat, lng) { return lat >= VN_BBOX.south && lat <= VN_BBOX.north && lng >= VN_BBOX.west && lng <= VN_BBOX.east; }

  /** "Today" in Vietnam (UTC+7, no DST) as YYYY-MM-DD, like app_private.today_vn(). */
  function todayVn(now) { return new Date((now ? +new Date(now) : Date.now()) + 7 * 3600000).toISOString().slice(0, 10); }
  function addDays(day, n) { var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  /** RFC 2606 / 6761 demo domains: never e-mailed for real, exempt from the abuse limits (= app_private.is_reserved_email). */
  var RESERVED_EMAIL_RE = /@([^@]*\.)?(example\.(com|net|org)|example|test|invalid|localhost)$/i;
  function isReservedEmail(e) { return !!e && RESERVED_EMAIL_RE.test(String(e).trim()); }

  /** Recipient e-mail syntax (= app_private.valid_email). */
  var EMAIL_SYNTAX_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[a-z]{2,}$/i;
  function validEmail(e) { return typeof e === 'string' && e.length <= 254 && EMAIL_SYNTAX_RE.test(e); }

  /*
   * Buddy recipient phone → E.164 (= app_private.norm_phone / valid_phone / phone_is_landline; round 2 R7: the phone is
   * required, the e-mail optional; 20261002000100: a Vietnamese number must be a MOBILE — the SMS fallback).
   * Accepted: '+<cc>…', international '00<cc>…' and Vietnamese national '0…' (→ +84); separators space ( ) . - /.
   * Vietnam (+84): mobile 9 digits [35789]… (03x 05x 07x 08x 09x); a trunk '0' typed after +84 is dropped
   * ('+84 0912…'); demo numbers '+84 000 000 0NN' are accepted as they are (isDemo). A landline (10 digits 2…, 02x) is
   * still normalised (e164, so a stored legacy value displays) but landline: true and valid: false — a new Buddy session
   * refuses it with 'recipient_phone_not_mobile' (it cannot receive the SMS). Other countries: 8–15 digits, first digit
   * 1–9, valid (no generic way to tell a foreign mobile from a landline).
   * @returns {{e164: string|null, valid: boolean, isDemo: boolean, empty: boolean, landline: boolean}}
   */
  var PHONE_SPACE_RE = /[ \t\n\v\f\r\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
  var PHONE_CHARS_RE = /^\(?\+?[0-9 ().\/-]+$/;
  function normPhone(raw) {
    var s = raw === null || raw === undefined ? '' : String(raw).replace(PHONE_SPACE_RE, ' ').replace(/^ +| +$/g, '');
    var out = { e164: null, valid: false, isDemo: false, empty: !s, landline: false };
    if (!s || s.length > 32 || !PHONE_CHARS_RE.test(s)) return out;
    var d = s.replace(/\D/g, '');
    if (s.replace(/^\(+/, '').charAt(0) === '+') { /* already international ('+84 …' or '(+84) …') */ }
    else if (d.slice(0, 2) === '00') d = d.slice(2);
    else if (d.charAt(0) === '0') d = '84' + d.slice(1);
    else return out;
    if (d.slice(0, 2) === '84') {
      var n = d.slice(2);
      if (/^0000000\d{2}$/.test(n)) { out.e164 = '+84' + n; out.valid = true; out.isDemo = true; return out; }
      if (/^0\d{9,10}$/.test(n)) n = n.slice(1);
      if (/^[35789]\d{8}$/.test(n)) { out.e164 = '+84' + n; out.valid = true; }
      else if (/^2\d{9}$/.test(n)) { out.e164 = '+84' + n; out.landline = true; } // 02x landline: no SMS → not valid
      return out;
    }
    if (/^[1-9]\d{7,14}$/.test(d)) { out.e164 = '+' + d; out.valid = true; }
    return out;
  }

  /*
   * Web Push (round 2 R6, = SQL 20260930000200): endpoints only on the browser push services (the Edge Function POSTs
   * to them — no arbitrary URL), base64url keys of a PushSubscription, and the reminder schedule of one device.
   */
  var PUSH_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(\/|$)/i;
  function validPushEndpoint(u) { return typeof u === 'string' && u.length <= 1024 && PUSH_HOST_RE.test(u); }
  function validPushKeys(p256dh, auth) {
    return typeof p256dh === 'string' && /^[A-Za-z0-9_-]{80,100}={0,2}$/.test(p256dh) &&
      typeof auth === 'string' && /^[A-Za-z0-9_-]{16,32}={0,2}$/.test(auth);
  }
  var PUSH_MAX_ITEMS = 20, PUSH_WINDOW_MS = 48 * 3600000;
  /**
   * push.schedule items → {error: 'invalid_push_schedule'|'too_many_items'|null, items, skipped}. Each item:
   * {fire_at ISO, kind 'deadzone_ahead', minutes_before 0–120, zone_km 0–10000}; items in the past (> 1 min) or more
   * than 48 h ahead are skipped, not refused (a queued schedule may arrive late).
   */
  function pushScheduleItems(items, now) {
    now = now || Date.now();
    if (!Array.isArray(items)) return { error: 'invalid_push_schedule', items: [], skipped: 0 };
    if (items.length > PUSH_MAX_ITEMS) return { error: 'too_many_items', items: [], skipped: 0 };
    var out = [], skipped = 0, bad = false;
    items.forEach(function (x) {
      if (bad) return;
      var at = x && typeof x.fire_at === 'string' ? Date.parse(x.fire_at) : NaN;
      var mb = x && typeof x.minutes_before === 'number' ? x.minutes_before : NaN;   // JSON numbers only (= SQL jsonb_typeof)
      var zk = x && typeof x.zone_km === 'number' ? x.zone_km : NaN;
      if (!x || typeof x !== 'object' || x.kind !== 'deadzone_ahead' || !isFinite(at) || !isFinite(mb) || mb < 0 || mb > 120 ||
        Math.round(mb) !== mb || !isFinite(zk) || zk < 0 || zk > 10000) { bad = true; return; }
      if (at < now - 60000 || at > now + PUSH_WINDOW_MS) { skipped++; return; }
      out.push({ fire_at: new Date(at).toISOString(), kind: 'deadzone_ahead', minutes_before: mb, zone_km: Math.round(zk * 1000) / 1000 });
    });
    return bad ? { error: 'invalid_push_schedule', items: [], skipped: 0 } : { error: null, items: out, skipped: skipped };
  }

  /**
   * Canonical recipient for counting (= app_private.normalize_email): trimmed, lower case, "+tag" dropped from the
   * local part; Gmail ignores dots and googlemail.com is gmail.com. @returns {string|null}
   */
  function normalizeEmail(e) {
    if (e === null || e === undefined) return null;
    var v = String(e).trim().toLowerCase();
    if (!v) return null;
    var at = v.lastIndexOf('@');
    if (at < 0) return v;
    var loc = v.slice(0, at);
    var dom = v.slice(at + 1).replace(/\.+$/, '');
    loc = loc.split('+')[0] || loc;
    if (dom === 'gmail.com' || dom === 'googlemail.com') return loc.replace(/\./g, '') + '@gmail.com';
    return loc + '@' + dom;
  }

  var NAME_TLDS = 'com|net|org|info|biz|io|co|me|app|dev|xyz|top|site|online|link|click|shop|store|live|vn|ru|cn|uk|de|fr|us|tk|ml|ga|cf|gq|ly|to|gl|gg|cc|tv|ws|pw|su|in|eu|asia|ai|sh|page|lol|icu|cyou|buzz|rest|work|support|help|email|bank|finance|money|pro|cloud|tech|space|website|fun|club|vip|win|bid|loan|zip|mov';
  var NAME_DOMAIN_RE = new RegExp('\\S+\\.(?:' + NAME_TLDS + ')(?![0-9A-Za-z_])\\S*', 'gi');

  /**
   * Display name as the server stores it (= app_private.clean_name): control characters, URLs, "http", "www.", e-mail
   * addresses and bare domains removed, spaces collapsed, at most `max` characters (default 60); empty → null.
   * @returns {string|null}
   */
  function cleanName(v, max) {
    if (v === null || v === undefined) return null;
    var s = String(v).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/\S*(?:https?|:\/\/|www\.)\S*/gi, ' ')
      .replace(/[^\s@]+@[^\s@]+/g, ' ')
      .replace(NAME_DOMAIN_RE, ' ')
      .replace(/\s+/g, ' ').trim();
    s = Array.from(s).slice(0, max || 60).join('').trim();
    return s || null;
  }

  /* Canonical JSON (sorted keys) for content comparison. */
  function canon(v) {
    if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  function stripFreshness(x) { var o = Object.assign({}, x); delete o.is_stale; delete o.days_since_verified; return o; }
  function byIdSort(a, b) { return String(a.id).localeCompare(String(b.id)); }

  /** Pack content without what changes on every build / every day (= app_private.pack_content). @returns {string|null} */
  function packContentKey(p) {
    if (!p || typeof p !== 'object') return null;
    var o = {};
    Object.keys(p).forEach(function (k) { if (['version', 'published_at', 'size_bytes', 'source', 'facilities', 'services'].indexOf(k) < 0) o[k] = p[k]; });
    o.facilities = (p.facilities || []).map(stripFreshness).sort(byIdSort);
    o.services = (p.services || []).slice().sort(byIdSort);
    return canon(o);
  }

  /** Added / removed (with reason) / updated items between a published and a live pack array (= app_private.pack_item_diff). */
  function itemDiff(pub, live, rows, facility) {
    var P = {}, L = {}, byId = {};
    (pub || []).forEach(function (x) { P[x.id] = stripFreshness(x); });
    (live || []).forEach(function (x) { L[x.id] = stripFreshness(x); });
    (rows || []).forEach(function (r) { byId[r.id] = r; });
    function sortName(a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'vi') || byIdSort(a, b); }
    var okStatus = facility ? 'verified' : 'active';
    return {
      added: Object.keys(L).filter(function (id) { return !P[id]; })
        .map(function (id) { return { id: id, name: L[id].name || null, type: L[id].type || null }; }).sort(sortName),
      removed: Object.keys(P).filter(function (id) { return !L[id]; }).map(function (id) {
        var r = byId[id];
        var st = r ? (r.status || (facility ? 'pending' : 'active')) : null;
        return { id: id, name: P[id].name || null, type: P[id].type || null, reason: !r ? 'deleted' : (st !== okStatus ? st : 'moved') };
      }).sort(sortName),
      updated: Object.keys(L).filter(function (id) { return P[id] && canon(L[id]) !== canon(P[id]); }).map(function (id) {
        var keys = {};
        Object.keys(L[id]).concat(Object.keys(P[id])).forEach(function (k) { keys[k] = 1; });
        return { id: id, name: L[id].name || null, type: L[id].type || null,
          fields: Object.keys(keys).filter(function (k) { return canon(L[id][k]) !== canon(P[id][k]); }).sort() };
      }).sort(sortName)
    };
  }

  /**
   * Build a Pack (contract §8) from plain tables. Used by the local server (its DB tables) and by NC.data for the
   * bundled default pack (window.NC_SEED) — no server needed.
   * @param {{routes, nodes, edges, segments, accuracy, facilities, services, model_version}} src
   * @param {string} routeId
   * @param {string} carrier
   * @param {{version?:number, published_at?:string, now?:Date|string}} [opts]
   * @returns {Object|null} Pack (null when the route does not exist)
   */
  function buildPack(src, routeId, carrier, opts) {
    opts = opts || {};
    var route = (src.routes || []).filter(function (r) { return r.id === routeId; })[0];
    if (!route) return null;
    var nodes = (src.nodes || []).filter(function (n) { return n.route_id === routeId; });
    var edges = (src.edges || []).filter(function (e) { return e.route_id === routeId; });
    var edgeIds = {};
    edges.forEach(function (e) { edgeIds[e.id] = 1; });
    var segs = (src.segments || []).filter(function (s) {
      return s.carrier === carrier && (s.route_id === routeId || (!s.route_id && edgeIds[s.edge_id]));
    }).sort(function (a, b) { return String(a.edge_id).localeCompare(String(b.edge_id)) || (a.seq - b.seq) || (a.from_km - b.from_km); });
    // Edges without any segment for this carrier get one 'uncertain' segment (same as app_private.build_pack).
    var covered = {};
    segs.forEach(function (sg) { covered[sg.edge_id] = 1; });
    edges.forEach(function (e) {
      if (!covered[e.id]) segs.push({ edge_id: e.id, seq: 0, from_km: 0, to_km: num(e.length_km) || 0, level: 'uncertain', confidence: 0 });
    });
    segs.sort(function (a, b) { return String(a.edge_id).localeCompare(String(b.edge_id)) || (a.seq - b.seq) || (a.from_km - b.from_km); });
    var acc = (src.accuracy || []).filter(function (a) { return a.route_id === routeId && a.carrier === carrier; })[0] || null;
    var bb = route.bbox;
    function inBox(p) {
      return bb && p.lat >= bb[0] - 0.05 && p.lat <= bb[2] + 0.05 && p.lng >= bb[1] - 0.05 && p.lng <= bb[3] + 0.05;
    }
    var facilities = (src.facilities || []).filter(function (f) {
      return f.status === 'verified' && (f.route_id === routeId || (!f.route_id && inBox(f)));
    }).map(function (f) {
      var d = decorateFacility(f, opts.now);
      return {
        id: f.id, name: f.name, type: f.type, address: f.address, lat: num(f.lat), lng: num(f.lng), phone: f.phone,
        open_hours: f.open_hours, night_shift: !!f.night_shift, trauma_capable: !!f.trauma_capable,
        verified_by: f.verified_by, verified_at: f.verified_at ? String(f.verified_at).slice(0, 10) : null,
        is_stale: d.is_stale, days_since_verified: d.days_since_verified, is_demo: f.is_demo !== false
      };
    });
    var services = (src.services || []).filter(function (s) {
      return (s.status || 'active') === 'active' && (s.route_id === routeId || (!s.route_id && inBox(s)));
    }).map(function (s) {
      return { id: s.id, name: s.name, type: s.type, lat: num(s.lat), lng: num(s.lng), phone: s.phone || null,
        open_hours: s.open_hours || null, is_partner: !!s.is_partner, is_demo: s.is_demo !== false };
    });
    var pack = {
      schema: 1,
      route: {
        id: route.id, name: route.name, name_en: route.name_en || null, region: route.region || null,
        region_en: route.region_en || null, travel_mode: route.travel_mode || 'motorbike', length_km: num(route.length_km),
        color: route.color || null, bbox: route.bbox || null, description_vi: route.description_vi || null,
        description_en: route.description_en || null
      },
      carrier: carrier,
      version: opts.version !== undefined ? opts.version : 0,
      published_at: opts.published_at || null,
      model_version: (acc && acc.model_version) || src.model_version || null,
      accuracy: acc ? num(acc.accuracy) : null,
      holdout_n: acc && acc.holdout_n !== null && acc.holdout_n !== undefined ? num(acc.holdout_n) : 0,
      nodes: nodes.map(function (n) { return { id: n.id, name: n.name, name_en: n.name_en || null, kind: n.kind, lat: num(n.lat), lng: num(n.lng) }; }),
      edges: edges.map(function (e) {
        return { id: e.id, from: e.from !== undefined ? e.from : e.from_node, to: e.to !== undefined ? e.to : e.to_node,
          length_km: num(e.length_km), is_connector: !!e.is_connector, geometry: e.geometry || [] };
      }),
      segments: segs.map(function (s) {
        return { edge_id: s.edge_id, seq: s.seq, from_km: num(s.from_km), to_km: num(s.to_km), level: s.level, confidence: num(s.confidence) };
      }),
      facilities: facilities,
      services: services,
      size_bytes: 0
    };
    return finalizeSize(pack);
  }

  /** size_bytes = UTF-8 length of the pack JSON *including* its own size_bytes field (fixed point, like the SQL). */
  function finalizeSize(pack) {
    var size = 0;
    for (var i = 0; i < 6; i++) {
      pack.size_bytes = size;
      var len = utf8Length(JSON.stringify(pack));
      if (len === size) break;
      size = len;
    }
    pack.size_bytes = size;
    return pack;
  }

  /**
   * alert_reason of a session row: 'overdue' | 'sos' | 'contact_lost' (round 2 R6: the heartbeat of a live session
   * stopped) while overdue/alerted, else null (rows seeded before the column default to 'overdue').
   */
  function reasonOf(row) {
    if (!row || (row.status !== 'overdue' && row.status !== 'alerted')) return null;
    return row.alert_reason === 'sos' || row.alert_reason === 'contact_lost' ? row.alert_reason : 'overdue';
  }

  /** Contract §8 Session object from a buddy_sessions row (medical payload never echoed back). */
  function sessionView(row) {
    if (!row) return null;
    return {
      id: row.id, traveler_name: row.traveler_name || null, recipient_name: row.recipient_name || null,
      recipient_email: row.recipient_email || null, recipient_phone: row.recipient_phone || null,
      interval_min: row.interval_min, grace_min: row.grace_min, route_id: row.route_id || null,
      travel_mode: row.travel_mode || null, share_public_medical: !!row.share_public_medical, status: row.status,
      alert_reason: reasonOf(row), started_at: row.started_at, last_checkin_at: row.last_checkin_at || null, next_due_at: row.next_due_at || null,
      last_lat: row.last_lat === undefined ? null : row.last_lat, last_lng: row.last_lng === undefined ? null : row.last_lng,
      last_location_at: row.last_location_at || null, alerted_at: row.alerted_at || null, closed_at: row.closed_at || null,
      updated_at: row.updated_at || null, synced: true
    };
  }

  backend.shared = {
    CARRIERS: CARRIERS,
    FACILITY_TYPES: FACILITY_TYPES,
    SERVICE_TYPES: SERVICE_TYPES,
    FACILITY_REQUIRED: FACILITY_REQUIRED,
    STALE_DAYS: STALE_DAYS,
    buildPack: buildPack,
    finalizeSize: finalizeSize,
    facilityMissing: facilityMissing,
    decorateFacility: decorateFacility,
    daysSince: daysSince,
    sessionView: sessionView,
    cleanName: cleanName,
    isReservedEmail: isReservedEmail,
    validEmail: validEmail,
    normPhone: normPhone,
    validPushEndpoint: validPushEndpoint,
    validPushKeys: validPushKeys,
    pushScheduleItems: pushScheduleItems,
    normalizeEmail: normalizeEmail,
    inVietnam: inVietnam,
    VN_BBOX: VN_BBOX,
    todayVn: todayVn,
    packContentKey: packContentKey,
    parsePoint: parsePoint,
    sha256Hex: sha256Hex,
    utf8Length: utf8Length,
    levelFromRsrp: levelFromRsrp,
    uuid: uuid,
    err: err,
    clone: clone,
    sleep: sleep
  };

  /* ================================================================== storage (IndexedDB / memory) */

  var DB_NAME = 'nomadcare-server';
  var DB_VERSION = 1;
  /** Object stores. auto = identity bigint primary key. */
  var STORES = {
    meta: { key: 'key' },
    carriers: { key: 'id' },
    routes: { key: 'id' },
    route_nodes: { key: 'id' },
    route_edges: { key: 'id' },
    signal_samples: { key: 'id', auto: true },
    signal_segments: { key: 'id', auto: true },
    route_accuracy: { key: 'id' }, // id = route_id:carrier (composite PK in SQL)
    facilities: { key: 'id' },
    services: { key: 'id' },
    facility_submissions: { key: 'id' },
    data_packs: { key: 'id', auto: true },
    content_releases: { key: 'id', auto: true },
    devices: { key: 'id' },
    device_ops: { key: 'id' },
    buddy_sessions: { key: 'id' },
    checkin_events: { key: 'id' },
    audit_log: { key: 'id', auto: true }
  };
  var STORE_NAMES = Object.keys(STORES);

  function reqP(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  /** IndexedDB-backed table store. */
  function IdbStore(db) { this.db = db; this.kind = 'indexeddb'; }
  IdbStore.prototype._tx = function (name, mode) { return this.db.transaction(name, mode).objectStore(name); };
  IdbStore.prototype.all = function (name) {
    var st = this._tx(name, 'readonly');
    if (st.getAll) return reqP(st.getAll());
    return new Promise(function (resolve, reject) {
      var out = [];
      var c = st.openCursor();
      c.onsuccess = function () { var cur = c.result; if (cur) { out.push(cur.value); cur.continue(); } else resolve(out); };
      c.onerror = function () { reject(c.error); };
    });
  };
  IdbStore.prototype.get = function (name, key) { return reqP(this._tx(name, 'readonly').get(key)).then(function (v) { return v || null; }); };
  IdbStore.prototype.put = function (name, row) {
    var spec = STORES[name];
    var st = this._tx(name, 'readwrite');
    var val = Object.assign({}, row);
    if (spec.auto && (val.id === undefined || val.id === null)) delete val.id;
    return reqP(st.put(val)).then(function (key) { val[spec.key] = key; return val; });
  };
  IdbStore.prototype.bulkPut = function (name, rows) {
    var db = this.db;
    var spec = STORES[name];
    return new Promise(function (resolve, reject) {
      if (!rows.length) { resolve(0); return; }
      var tx = db.transaction(name, 'readwrite');
      var st = tx.objectStore(name);
      rows.forEach(function (r) {
        var v = Object.assign({}, r);
        if (spec.auto && (v.id === undefined || v.id === null)) delete v.id;
        st.put(v);
      });
      tx.oncomplete = function () { resolve(rows.length); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  };
  IdbStore.prototype.del = function (name, key) { return reqP(this._tx(name, 'readwrite').delete(key)); };
  IdbStore.prototype.clear = function (name) { return reqP(this._tx(name, 'readwrite').clear()); };

  /** In-memory fallback (file:// on some browsers, private mode, IDB blocked). Single-tab only. */
  function MemStore() { this.t = {}; this.seq = {}; this.kind = 'memory'; var self = this; STORE_NAMES.forEach(function (n) { self.t[n] = {}; self.seq[n] = 0; }); }
  MemStore.prototype.all = function (name) { var t = this.t[name]; return Promise.resolve(Object.keys(t).map(function (k) { return clone(t[k]); })); };
  MemStore.prototype.get = function (name, key) { var v = this.t[name][key]; return Promise.resolve(v ? clone(v) : null); };
  MemStore.prototype._put = function (name, row) {
    var spec = STORES[name];
    var v = clone(row);
    if (spec.auto) {
      if (v.id === undefined || v.id === null) v.id = ++this.seq[name];
      else if (+v.id > this.seq[name]) this.seq[name] = +v.id;
    }
    this.t[name][v[spec.key]] = v;
    return v;
  };
  MemStore.prototype.put = function (name, row) { return Promise.resolve(clone(this._put(name, row))); };
  MemStore.prototype.bulkPut = function (name, rows) { var self = this; rows.forEach(function (r) { self._put(name, r); }); return Promise.resolve(rows.length); };
  MemStore.prototype.del = function (name, key) { delete this.t[name][key]; return Promise.resolve(); };
  MemStore.prototype.clear = function (name) { this.t[name] = {}; return Promise.resolve(); };

  function openStore() {
    return new Promise(function (resolve) {
      var idb = null;
      try { idb = (typeof indexedDB !== 'undefined') ? indexedDB : null; } catch (e) { idb = null; }
      if (!idb) { resolve(new MemStore()); return; }
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(new MemStore()); } }, 4000);
      try {
        var r = idb.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = function () {
          var db = r.result;
          STORE_NAMES.forEach(function (n) {
            if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: STORES[n].key, autoIncrement: !!STORES[n].auto });
          });
        };
        r.onsuccess = function () {
          if (done) return;
          done = true; clearTimeout(timer);
          var db = r.result;
          db.onversionchange = function () { db.close(); };
          resolve(new IdbStore(db));
        };
        r.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(new MemStore()); } };
        r.onblocked = function () { /* another tab holds an old version; wait for timeout */ };
      } catch (e) {
        if (!done) { done = true; clearTimeout(timer); resolve(new MemStore()); }
      }
    });
  }

  /* ================================================================== realtime (cross-tab) */

  var CHANNEL = 'nomadcare-server';
  var LS_MSG = 'nc.server.msg';
  var chan = null;
  var TAB_ID = uuid();

  function emitBus(msg) {
    if (NC.bus && NC.bus.emit) {
      try { NC.bus.emit('server:change', msg); } catch (e) { /* listener errors must not break the server */ }
    }
  }

  function setupChannel() {
    if (chan !== null) return;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        chan = new BroadcastChannel(CHANNEL);
        chan.onmessage = function (ev) { if (ev && ev.data && ev.data.table) emitBus(ev.data); };
        return;
      }
    } catch (e) { /* fall through */ }
    chan = false;
    try {
      window.addEventListener('storage', function (ev) {
        if (ev.key !== LS_MSG || !ev.newValue) return;
        try { var m = JSON.parse(ev.newValue); if (m && m.tab !== TAB_ID) emitBus(m.msg); } catch (e) { /* ignore */ }
      });
    } catch (e) { /* no storage */ }
  }

  /* Strip heavy/secret fields before broadcasting a row. */
  function lightRow(table, row) {
    if (!row) return row;
    var r = Object.assign({}, row);
    if (table === 'data_packs') delete r.payload;
    if (table === 'devices') delete r.secret_hash;
    if (table === 'buddy_sessions') delete r.public_medical;
    return r;
  }

  /** Emit {table, type, row} locally and to other tabs. type: INSERT | UPDATE | DELETE | RESET. */
  function notify(table, type, row) {
    var msg = { table: table, type: type, row: lightRow(table, row) };
    emitBus(msg);
    try {
      if (chan) chan.postMessage(msg);
      else if (chan === false && typeof localStorage !== 'undefined') localStorage.setItem(LS_MSG, JSON.stringify({ tab: TAB_ID, at: Date.now(), msg: msg }));
    } catch (e) { /* cloning/quota issues are non-fatal */ }
  }

  /* ================================================================== server state */

  var store = null;
  var initP = null;
  var cronTimer = null;
  var CRON_MS = 15000;
  var ADMIN_LS = 'nc.admin.demo';

  var local = backend.local = {
    mode: 'local',
    /** Simulated network latency range in ms (set to [0,0] in tests). */
    latency: [120, 350],
    /** Cron interval (ms) for nc_mark_overdue + simulated nc_dispatch_alerts. */
    cronMs: CRON_MS,
    /**
     * Abuse limits (same defaults as the SQL app_private.limit_value keys limit_*). Recipients on demo domains
     * (example.com, *.test, …) are exempt; manual admin alerts are never limited.
     */
    limits: { buddy_start_device_24h: 5, alert_recipient_24h: 3, alert_global_1h: 50, contact_lost_after_min: 15 },
    /** Test hook: a string (or true) makes every simulated alert e-mail fail with that error (like Resend refusing it). */
    failAlerts: null
  };

  function t(name) { return store.all(name); }

  function online() {
    try { return NC.net && NC.net.online ? !!NC.net.online() : (typeof navigator === 'undefined' || navigator.onLine !== false); } catch (e) { return true; }
  }

  /* Every RPC: wait for init, add latency; device-facing RPCs fail like a real network when offline. */
  function gate(requireNet) {
    return init().then(function () {
      if (requireNet && !online()) throw err('network', 'Server unreachable (offline)');
      var l = local.latency || [0, 0];
      var ms = l[0] + Math.random() * Math.max(0, l[1] - l[0]);
      return ms > 0 ? sleep(ms) : null;
    }).then(function () {
      if (requireNet && !online()) throw err('network', 'Server unreachable (offline)');
    });
  }

  function seedVersion(S) {
    if (!S) return null;
    return [S.version || '', S.generated_at || '', S.model_version || '',
      (S.routes || []).length, (S.edges || []).length, (S.facilities || []).length, (S.segments || []).length].join('|');
  }
  function adminSeedVersion(A) {
    if (!A) return null;
    return [A.version || '', A.generated_at || '', A.anchor_at || '', (A.samples || []).length, (A.buddy_sessions || []).length, (A.audit || []).length].join('|');
  }

  function getMeta(key) { return store.get('meta', key).then(function (r) { return r ? r.value : null; }); }
  function setMeta(key, value) { return store.put('meta', { key: key, value: value }); }

  /** Server-side "today" snapshot used for pack decoration. */
  function packSource() {
    return Promise.all([t('routes'), t('route_nodes'), t('route_edges'), t('signal_segments'), t('route_accuracy'), t('facilities'), t('services'), getMeta('model_version')])
      .then(function (r) {
        return { routes: r[0], nodes: r[1], edges: r[2], segments: r[3], accuracy: r[4], facilities: r[5], services: r[6], model_version: r[7] };
      });
  }

  function importCore(S) {
    var jobs = [];
    var carriers = (S.carriers && S.carriers.length ? S.carriers : CARRIERS).map(function (c, i) {
      return typeof c === 'string' ? { id: c, name: c, sort: i } : Object.assign({ sort: i }, c);
    });
    jobs.push(store.bulkPut('carriers', carriers));
    jobs.push(store.bulkPut('routes', (S.routes || []).map(function (r, i) { return Object.assign({ sort: i, is_active: true }, r); })));
    jobs.push(store.bulkPut('route_nodes', S.nodes || []));
    jobs.push(store.bulkPut('route_edges', (S.edges || []).map(function (e) {
      return Object.assign({}, e, { from: e.from !== undefined ? e.from : e.from_node, to: e.to !== undefined ? e.to : e.to_node });
    })));
    jobs.push(store.bulkPut('signal_segments', (S.segments || []).map(function (s) { var r = Object.assign({}, s); delete r.id; return r; })));
    jobs.push(store.bulkPut('route_accuracy', (S.accuracy || []).map(function (a) {
      return Object.assign({ computed_at: S.generated_at || nowIso() }, a, { id: a.route_id + ':' + a.carrier });
    })));
    var now = nowIso();
    jobs.push(store.bulkPut('facilities', (S.facilities || []).map(function (f) {
      return Object.assign({ status: 'pending', source: 'team', is_demo: true, created_at: now, updated_at: now }, f);
    })));
    jobs.push(store.bulkPut('services', (S.services || []).map(function (s) {
      return Object.assign({ status: 'active', is_partner: false, commission_rate: 0, is_demo: true, created_at: now, updated_at: now }, s);
    })));
    jobs.push(store.bulkPut('facility_submissions', (S.submissions || []).map(function (s) {
      return Object.assign({ id: uuid(), status: 'pending', payload: {}, created_at: now }, s);
    })));
    jobs.push(store.bulkPut('content_releases', (S.content_releases || []).map(function (c) {
      return Object.assign({ kind: 'medical', status: 'draft', created_at: S.generated_at || now }, c);
    })));
    jobs.push(setMeta('model_version', S.model_version || null));
    return Promise.all(jobs).then(function () { return seedPacks(S); });
  }

  /* Seed data_packs: payload stored for the current (latest) version of each route/carrier. */
  function seedPacks(S) {
    return packSource().then(function (src) {
      var list = (S.packs || []).slice().sort(function (a, b) { return a.version - b.version; });
      var latest = {};
      list.forEach(function (p) { latest[p.route_id + ':' + p.carrier] = p; });
      var rows = [];
      var jobs = list.map(function (p) {
        var cur = latest[p.route_id + ':' + p.carrier] === p;
        var pack = buildPack(src, p.route_id, p.carrier, { version: p.version, published_at: p.published_at || S.generated_at || nowIso() });
        if (!pack) return null;
        var text = JSON.stringify(pack);
        return sha256Hex(text).then(function (sum) {
          rows.push({
            route_id: p.route_id, carrier: p.carrier, version: p.version, published_at: pack.published_at,
            published_by: null, notes: p.notes || null, size_bytes: pack.size_bytes, checksum: sum,
            payload: cur ? pack : null, is_current: cur
          });
        });
      });
      return Promise.all(jobs).then(function () { return store.bulkPut('data_packs', rows); });
    });
  }

  /*
   * Admin seed: additive import. Buddy/device/audit timestamps are rebased to "now" so the demo looks live:
   * rows carrying offset_min {column: minutes} get column = now + minutes (seed convention, relative to anchor_at);
   * other timestamps are shifted by now − anchor_at (or generated_at).
   */
  function importAdmin(A, S) {
    var ref = Date.parse(A.anchor_at || A.generated_at || (S && S.generated_at) || '');
    var now = Date.now();
    var shift = isFinite(ref) ? now - ref : 0;
    function rebase(row, keys) {
      var r = Object.assign({}, row);
      var off = r.offset_min && typeof r.offset_min === 'object' ? r.offset_min : null;
      delete r.offset_min;
      keys.forEach(function (k) {
        if (off && typeof off[k] === 'number') r[k] = new Date(now + off[k] * 60000).toISOString();
        else if (r[k] && shift) r[k] = new Date(Date.parse(r[k]) + shift).toISOString();
      });
      return r;
    }
    var jobs = [];
    jobs.push(store.bulkPut('signal_samples', (A.samples || []).map(function (s) {
      var r = Object.assign({ source: 'team', status: 'approved', is_holdout: false, created_at: s.measured_at }, s, { level: s.level || levelFromRsrp(s.rsrp_dbm) });
      delete r.offset_min;
      return r;
    })));
    jobs.push(store.bulkPut('devices', (A.devices || []).map(function (d) { return rebase(d, ['created_at', 'last_seen_at']); })));
    jobs.push(store.bulkPut('buddy_sessions', (A.buddy_sessions || []).map(function (x) {
      return rebase(Object.assign({ status: 'active', interval_min: 60, grace_min: 15, share_public_medical: false }, x),
        ['started_at', 'last_checkin_at', 'next_due_at', 'last_location_at', 'alerted_at', 'closed_at', 'created_at', 'updated_at']);
    })));
    jobs.push(store.bulkPut('checkin_events', (A.checkin_events || []).map(function (e) {
      return rebase(Object.assign({ queued: false, meta: null }, e), ['client_ts', 'received_at']);
    })));
    jobs.push(store.bulkPut('audit_log', (A.audit || []).map(function (x) { return rebase(x, ['created_at']); })));
    return Promise.all(jobs);
  }

  function wipeAll() { return Promise.all(STORE_NAMES.map(function (n) { return store.clear(n); })); }

  /** (Re)seed when NC_SEED/NC_SEED_ADMIN changed; force = resetDemo. */
  function ensureSeed(force) {
    var S = root().NC_SEED;
    var A = root().NC_SEED_ADMIN;
    var sv = seedVersion(S);
    return getMeta('seed_version').then(function (cur) {
      if (!S) return false;
      if (!force && cur === sv) return false;
      return wipeAll().then(function () { return importCore(S); })
        .then(function () { return setMeta('seed_version', sv); })
        .then(function () { return setMeta('admin_seed_version', null); })
        .then(function () { return true; });
    }).then(function (reseeded) {
      if (!A) return reseeded;
      var av = adminSeedVersion(A);
      return getMeta('admin_seed_version').then(function (cur) {
        if (cur === av) return reseeded;
        var prep = cur ? Promise.all(['signal_samples', 'buddy_sessions', 'checkin_events', 'audit_log'].map(function (n) { return store.clear(n); })) : Promise.resolve();
        return prep.then(function () { return importAdmin(A, S); })
          .then(function () { return setMeta('admin_seed_version', av); })
          .then(function () { return true; });
      });
    });
  }

  /*
   * Fields added to seed-core.js after this browser was seeded (same seed_version, so no reseed): copy them into the
   * stored routes and into the seed packs (version of S.packs, not published by an admin), recomputing size_bytes and
   * checksum, like the SQL migration's backfill. Today: routes.region_en (20260929000100). @returns {Promise<boolean>}
   */
  function upgradeSeed(S) {
    if (!S || !S.routes) return Promise.resolve(false);
    var regionEn = {};
    S.routes.forEach(function (r) { if (r && r.region_en) regionEn[r.id] = r.region_en; });
    var seedPack = {};
    (S.packs || []).forEach(function (p) { seedPack[p.route_id + ':' + p.carrier + ':' + p.version] = 1; });
    return Promise.all([t('routes'), t('data_packs')]).then(function (r) {
      var jobs = [];
      r[0].forEach(function (row) {
        if (regionEn[row.id] && !row.region_en) jobs.push(store.put('routes', Object.assign({}, row, { region_en: regionEn[row.id] })));
      });
      r[1].forEach(function (row) {
        var p = row.payload;
        if (!p || !p.route || row.published_by || !seedPack[row.route_id + ':' + row.carrier + ':' + row.version]) return;
        if (!regionEn[p.route.id] || p.route.region_en !== undefined) return;
        var route = {};
        Object.keys(p.route).forEach(function (k) {
          route[k] = p.route[k];
          if (k === 'region') route.region_en = regionEn[p.route.id];
        });
        if (route.region_en === undefined) route.region_en = regionEn[p.route.id];
        var pack = finalizeSize(Object.assign({}, p, { route: route }));
        jobs.push(sha256Hex(JSON.stringify(pack)).then(function (sum) {
          return store.put('data_packs', Object.assign({}, row, { payload: pack, size_bytes: pack.size_bytes, checksum: sum }));
        }));
      });
      return Promise.all(jobs).then(function () { return jobs.length > 0; });
    });
  }

  function root() { return typeof window !== 'undefined' ? window : globalThis; }

  /**
   * Open the server DB, seed, start realtime + cron. Idempotent.
   * @returns {Promise<void>}
   */
  function init() {
    if (initP) return initP;
    setupChannel();
    initP = openStore().then(function (s) {
      store = s;
      local.storage = s.kind;
      return withSeedLock(function () {
        return ensureSeed(false).then(function (reseeded) {
          return upgradeSeed(root().NC_SEED).catch(function () { return false; }).then(function () { return reseeded; });
        });
      });
    }).then(function (reseeded) {
      if (reseeded) notify('*', 'RESET', null);
      startCron();
    });
    return initP;
  }
  local.init = init;

  /* Serialise seeding across tabs (Web Locks when available). */
  function withSeedLock(fn) {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
        return navigator.locks.request('nomadcare-server-seed', function () { return fn(); });
      }
    } catch (e) { /* fall through */ }
    return fn();
  }

  /* ================================================================== audit (trigger mock) */

  function actorLabel() {
    var s = adminSession();
    return s ? (s.user.display_name || s.user.email) : 'demo-admin';
  }

  /**
   * Append an audit_log row (mirrors app_private.audit_row: action insert|update|delete|status|publish, entity = table,
   * details {row} | {changed:{col:{from,to}}} | {from,to} for buddy_sessions).
   */
  function audit(action, entity, entityId, details, actor) {
    return store.put('audit_log', {
      actor: null, actor_label: actor || actorLabel(), action: action, entity: entity,
      entity_id: entityId === undefined || entityId === null ? null : String(entityId), details: details || null, created_at: nowIso()
    }).then(function (row) { notify('audit_log', 'INSERT', row); return row; });
  }

  var AUDIT_SKIP = ['payload', 'created_at', 'updated_at', 'secret_hash', 'geom'];

  function auditClean(row) {
    var o = {};
    Object.keys(row || {}).forEach(function (k) { if (AUDIT_SKIP.indexOf(k) < 0) o[k] = row[k]; });
    return o;
  }

  function diff(before, after) {
    var out = {};
    var a = auditClean(before), b = auditClean(after);
    Object.keys(b).forEach(function (k) {
      if (JSON.stringify(a[k] === undefined ? null : a[k]) !== JSON.stringify(b[k] === undefined ? null : b[k])) {
        out[k] = { from: a[k] === undefined ? null : a[k], to: b[k] === undefined ? null : b[k] };
      }
    });
    return out;
  }

  /* Write a row + realtime + audit (for audited tables). */
  var AUDITED = { facilities: 1, services: 1, facility_submissions: 1, data_packs: 1, content_releases: 1 };
  function write(table, row, before, actor) {
    return store.put(table, row).then(function (saved) {
      notify(table, before ? 'UPDATE' : 'INSERT', saved);
      var job = null;
      if (AUDITED[table]) {
        if (!before) {
          job = audit(table === 'data_packs' ? 'publish' : 'insert', table, saved.id, { row: auditClean(saved) }, actor);
        } else {
          var changed = diff(before, saved);
          var keys = Object.keys(changed);
          if (keys.length && !(table === 'data_packs' && keys.length === 1 && keys[0] === 'is_current')) {
            job = audit(changed.status ? 'status' : 'update', table, saved.id, { changed: changed }, actor);
          }
        }
      } else if (table === 'buddy_sessions' && before && before.status !== saved.status) {
        job = audit('status', table, saved.id, { from: before.status, to: saved.status }, actor);
      }
      return (job || Promise.resolve()).then(function () { return saved; });
    });
  }
  function remove(table, id, before, actor) {
    return store.del(table, id).then(function () {
      notify(table, 'DELETE', before || { id: id });
      return AUDITED[table] ? audit('delete', table, id, { row: auditClean(before || { id: id }) }, actor) : null;
    });
  }

  /* ================================================================== public RPC mocks */

  function carrierList() {
    return t('carriers').then(function (rows) {
      var ids = rows.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }).map(function (r) { return r.id; });
      return ids.length ? ids : CARRIERS.slice();
    });
  }

  /**
   * list_routes() → [{id,name,name_en,region,region_en,travel_mode,length_km,color,bbox,verified_facilities,accuracy:{carrier:n},packs:{carrier:{version,published_at,size_bytes}}}]
   */
  local.list_routes = function () {
    return gate(true).then(function () {
      return Promise.all([t('routes'), t('facilities'), t('route_accuracy'), t('data_packs'), carrierList()]);
    }).then(function (r) {
      var routes = r[0], facs = r[1], acc = r[2], packs = r[3], carriers = r[4];
      return routes.filter(function (x) { return x.is_active !== false; }).sort(byRouteSort).map(function (rt) {
        var a = {}, p = {};
        carriers.forEach(function (c) { a[c] = null; });
        acc.forEach(function (x) { if (x.route_id === rt.id) a[x.carrier] = num(x.accuracy); });
        packs.forEach(function (x) {
          if (x.route_id === rt.id && x.is_current) p[x.carrier] = { version: x.version, published_at: x.published_at, size_bytes: x.size_bytes };
        });
        return {
          id: rt.id, name: rt.name, name_en: rt.name_en || null, region: rt.region || null, region_en: rt.region_en || null,
          travel_mode: rt.travel_mode, length_km: num(rt.length_km), color: rt.color || null, bbox: rt.bbox || null,
          description_vi: rt.description_vi || null, description_en: rt.description_en || null,
          verified_facilities: facs.filter(function (f) { return f.route_id === rt.id && f.status === 'verified'; }).length,
          accuracy: a, packs: p
        };
      });
    });
  };

  function assertCarrier(carrier) {
    return carrierList().then(function (ids) { if (ids.indexOf(carrier) < 0) throw err('carrier_not_found', 'Unknown carrier ' + carrier); });
  }

  /**
   * Live Pack (not stored). version = current published version or 0.
   * @param {boolean} [keepPublishedAt] get_data_pack fallback keeps the current published_at; build_data_pack uses now().
   */
  function buildLive(routeId, carrier, keepPublishedAt) {
    return Promise.all([packSource(), t('data_packs'), assertCarrier(carrier)]).then(function (r) {
      var cur = r[1].filter(function (p) { return p.route_id === routeId && p.carrier === carrier && p.is_current; })[0];
      var pack = buildPack(r[0], routeId, carrier, { version: cur ? cur.version : 0, published_at: keepPublishedAt && cur ? cur.published_at : nowIso() });
      if (!pack) throw err('route_not_found', 'Unknown route ' + routeId);
      return pack;
    });
  }
  local.build_data_pack = function (routeId, carrier) { return gate(true).then(function () { return buildLive(routeId, carrier, false); }); };

  /** get_data_pack(route, carrier) → current published payload, or a live build when nothing is published. */
  local.get_data_pack = function (routeId, carrier) {
    return gate(true).then(function () { return t('data_packs'); }).then(function (rows) {
      var cur = rows.filter(function (p) { return p.route_id === routeId && p.carrier === carrier && p.is_current && p.payload; })[0];
      return cur ? cur.payload : buildLive(routeId, carrier, true);
    });
  };

  /** get_content_release() → latest approved, else latest. */
  local.get_content_release = function () {
    return gate(true).then(function () { return t('content_releases'); }).then(function (rows) {
      if (!rows.length) return null;
      var r = rows.sort(function (a, b) {
        return ((b.status === 'approved') - (a.status === 'approved')) || String(b.approved_at || '').localeCompare(String(a.approved_at || '')) ||
          String(b.created_at || '').localeCompare(String(a.created_at || '')) || (b.id - a.id);
      })[0];
      return { id: r.id, version: r.version, kind: r.kind || 'medical', status: r.status, notes: r.notes || null, reviewer_round1: r.reviewer_round1 || null,
        approver: r.approver || null, approved_at: r.approved_at || null, created_at: r.created_at || null };
    });
  };

  /** nearest_facilities(lat, lng, limit=5, types=null) → verified facilities by distance (+ trauma tie-break). */
  local.nearest_facilities = function (lat, lng, limit, types) {
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Promise.reject(err('invalid_coordinates', 'invalid_coordinates'));
    var n = Math.max(1, Math.min(limit || 5, 50));
    return gate(true).then(function () { return t('facilities'); }).then(function (rows) {
      var hv = NC.routing.haversineKm;
      return rows.filter(function (f) {
        return f.status === 'verified' && !isBlank(f.lat) && !isBlank(f.lng) && (!types || !types.length || types.indexOf(f.type) >= 0);
      }).map(function (f) {
        var d = decorateFacility(f);
        var o = {
          id: f.id, name: f.name, type: f.type, address: f.address, lat: num(f.lat), lng: num(f.lng), phone: f.phone, open_hours: f.open_hours,
          night_shift: f.night_shift, trauma_capable: f.trauma_capable, verified_by: f.verified_by, verified_at: f.verified_at,
          is_stale: d.is_stale, days_since_verified: d.days_since_verified, is_demo: f.is_demo !== false, route_id: f.route_id || null
        };
        o.distance_km = Math.round(hv({ lat: +lat, lng: +lng }, f) * 1000) / 1000;
        return o;
      }).sort(function (a, b) { return (a.distance_km - b.distance_km) || ((b.trauma_capable ? 1 : 0) - (a.trauma_capable ? 1 : 0)); })
        .slice(0, n);
    });
  };

  function randomSecret() {
    var b = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
  }

  /** register_device(carrier, app_version) → {device_id, secret} (only the sha256 of the secret is stored). */
  local.register_device = function (carrier, appVersion) {
    var secret = randomSecret();
    var id = uuid();
    return gate(true).then(function () { return sha256Hex(secret); }).then(function (hash) {
      var now = nowIso();
      return store.put('devices', { id: id, secret_hash: hash, carrier: carrier || null, app_version: appVersion || null, created_at: now, last_seen_at: now });
    }).then(function (row) {
      notify('devices', 'INSERT', row);
      return { device_id: id, secret: secret };
    });
  };

  var CHECKIN_KINDS = ['checkin', 'location', 'pre_deadzone', 'sos', 'overdue'];
  var SUBMISSION_KINDS = ['new', 'correction', 'closed', 'signal_report'];
  var EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[a-z]{2,}$/i;

  /* Validation error of one op (SQLSTATE class 22/23/P0002 → not retryable, like the SQL function). */
  function opErr(code, retryable) { return err(code, code, { retryable: !!retryable }); }

  function cleanText(v, max) {
    if (v === null || v === undefined) return null;
    var s = String(v).slice(0, max || 200).trim();
    return s ? s : null;
  }

  function insertEvent(ev) {
    var row = Object.assign({ id: uuid(), lat: null, lng: null, accuracy_m: null, client_ts: nowIso(), received_at: nowIso(), queued: false, note: null, meta: null }, ev);
    return store.get('checkin_events', row.id).then(function (exists) {
      if (exists) return exists;
      return store.put('checkin_events', row).then(function (saved) { notify('checkin_events', 'INSERT', saved); return saved; });
    });
  }

  function hasLL(d) {
    return !!d && d.lat !== null && d.lat !== undefined && d.lng !== null && d.lng !== undefined && d.lat !== '' && d.lng !== '' &&
      isFinite(d.lat) && isFinite(d.lng) && Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180;
  }

  function applyLocation(s, d, ts) {
    if (!hasLL(d)) return;
    if (!s.last_location_at || Date.parse(ts) >= Date.parse(s.last_location_at)) {
      s.last_lat = +d.lat; s.last_lng = +d.lng; s.last_location_at = ts;
    }
  }

  function wasQueued(d, ts) {
    if (d && typeof d.queued === 'boolean') return d.queued;
    return Date.now() - Date.parse(ts) > 120000;
  }

  /* op_session(): explicit id → must belong to the device; none → the device's latest open session. */
  function opSession(deviceId, sessionId) {
    if (sessionId) {
      return store.get('buddy_sessions', sessionId).then(function (s) {
        if (!s) throw opErr('session_not_found');
        if (s.device_id !== deviceId) throw opErr('session_forbidden');
        return s;
      });
    }
    return t('buddy_sessions').then(function (rows) {
      var s = rows.filter(function (x) { return x.device_id === deviceId && x.status !== 'closed'; })
        .sort(function (a, b) { return String(b.started_at).localeCompare(String(a.started_at)); })[0];
      if (!s) throw opErr('no_active_session');
      return s;
    });
  }

  /* Latest session of a device, open sessions first (app_private.device_session_json). */
  function deviceSession(deviceId) {
    return t('buddy_sessions').then(function (rows) {
      return rows.filter(function (s) { return s.device_id === deviceId; }).sort(function (a, b) {
        return ((b.status !== 'closed') - (a.status !== 'closed')) || String(b.started_at).localeCompare(String(a.started_at));
      })[0] || null;
    });
  }

  /*
   * Session invariants (= SQL trigger buddy_sessions_defaults): alert_reason only while overdue/alerted (default
   * 'overdue'); the consented medical layer is dropped when the session closes or sharing is off.
   */
  function normSession(s) {
    if (s.status === 'active' || s.status === 'closed') s.alert_reason = null;
    else if (s.alert_reason !== 'sos' && s.alert_reason !== 'contact_lost') s.alert_reason = 'overdue';
    if (s.status === 'closed' || !s.share_public_medical) s.public_medical = null;
    return s;
  }

  function saveSession(s, before, actor) {
    normSession(s);
    s.updated_at = nowIso();
    return write('buddy_sessions', s, before, actor || 'device');
  }

  /* Only the consented PUBLIC layer (= app_private.sanitize_public_medical). */
  function sanitizeMedical(m) {
    if (!m || typeof m !== 'object') return null;
    var pub = {};
    [['blood_type', 12], ['allergies', 300], ['conditions', 300], ['medications', 300], ['notes', 300]].forEach(function (k) {
      var x = cleanText(m[k[0]], k[1]);
      if (x) pub[k[0]] = x;
    });
    return Object.keys(pub).length ? pub : null;
  }

  function opBuddyStart(device, d) {
    var v = d.session && typeof d.session === 'object' ? d.session : d;
    var rcp = v.recipient || {};
    var sid = v.id || v.session_id || d.session_id || uuid();
    var now = nowIso();
    // offline-first: a queued start keeps its time, never more than 24 h back (= SQL)
    var start = minIso(v.started_at || d.client_ts || now, now);
    if (Date.parse(start) < Date.now() - DAY_MS) start = new Date(Date.now() - DAY_MS).toISOString();
    var interval = Math.max(1, Math.min(10080, Math.round(+v.interval_min || 60)));
    var grace = Math.max(0, Math.min(1440, Math.round(v.grace_min === undefined || v.grace_min === null || v.grace_min === '' ? 15 : +v.grace_min)));
    var share = v.share_public_medical === true || v.share_public_medical === 'true';
    var email = cleanText(rcp.email || v.recipient_email, 254);
    email = email ? email.toLowerCase() : null;
    // Round 2 (R7, = SQL 20260930000100): the phone is required (on-device SMS), the e-mail optional — it is the only
    // channel the server alerts through by itself, so it must be valid when given. A re-sent start of a session the
    // server already has (legacy e-mail-only sessions) may come without a phone: the stored one is kept.
    // 20261002000100: a Vietnamese landline (02x) cannot receive the SMS → a NEW session refuses it
    // ('recipient_phone_not_mobile'); a re-sent start of a known session ignores it and keeps the stored phone.
    var phone = normPhone(rcp.phone || v.recipient_phone);
    if (!phone.empty && !phone.e164) return Promise.reject(opErr('recipient_phone_invalid'));
    if (email && !EMAIL_RE.test(email)) return Promise.reject(opErr('recipient_email_invalid'));
    var warnings = [];
    var name = cleanName(v.traveler_name, 60);
    if (name !== cleanText(v.traveler_name, 200)) warnings.push('traveler_name_sanitized');
    var ll = hasLL(v) ? { lat: +v.lat, lng: +v.lng } : (hasLL({ lat: v.last_lat, lng: v.last_lng }) ? { lat: +v.last_lat, lng: +v.last_lng } : null);
    var pub = share ? sanitizeMedical(v.public_medical) : null;
    var settings = {
      traveler_name: name, recipient_name: cleanName(rcp.name || v.recipient_name, 60), recipient_email: email,
      recipient_phone: phone.landline ? null : phone.e164, interval_min: interval, grace_min: grace,
      route_id: cleanText(v.route_id, 64), travel_mode: cleanText(v.travel_mode, 20), share_public_medical: share, public_medical: share ? pub : null
    };
    return store.get('buddy_sessions', sid).then(function (prev) {
      if (prev && prev.device_id !== device.id) throw opErr('session_conflict');
      if (!prev && phone.landline) throw opErr('recipient_phone_not_mobile');
      if (!prev && !settings.recipient_phone) throw opErr('recipient_phone_required');
      if (prev && !settings.recipient_phone) settings.recipient_phone = prev.recipient_phone || null;
      // Only starts towards a real mailbox count (and are limited): no e-mail or a demo domain → never e-mailed.
      if (prev || !email || isReservedEmail(email)) return prev;
      // at most N new sessions per device per 24 h towards real mailboxes (SQL limit_buddy_start_device_24h)
      return t('buddy_sessions').then(function (rows) {
        var since = Date.now() - DAY_MS;
        var n = rows.filter(function (x) {
          return x.device_id === device.id && Date.parse(x.created_at || x.started_at) > since && x.recipient_email && !isReservedEmail(x.recipient_email);
        }).length;
        // permanent for this op (= SQL 54000): a retried start would land later, backdated and already overdue
        if (n >= local.limits.buddy_start_device_24h) throw opErr('rate_limited', false);
        return prev;
      });
    }).then(function (prev) {
      // Supersede the device's other open sessions (a late re-send of a closed session must not close its successor).
      return t('buddy_sessions').then(function (rows) {
        if (prev && prev.status === 'closed') return null;
        return rows.filter(function (x) { return x.device_id === device.id && x.status !== 'closed' && x.id !== sid; }).reduce(function (p, old) {
          return p.then(function () {
            var b = clone(old);
            old.status = 'closed'; old.closed_at = nowIso();
            return saveSession(old, b).then(function () {
              return insertEvent({ session_id: old.id, device_id: device.id, kind: 'stop', client_ts: nowIso(), meta: { reason: 'superseded', by: sid } });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        if (prev) {
          var b = clone(prev);
          Object.assign(prev, settings);
          return saveSession(prev, b).then(function () { return prev; });
        }
        var s = Object.assign({ id: sid, device_id: device.id }, settings, {
          status: 'active', started_at: start, last_checkin_at: start, next_due_at: addMin(start, interval),
          last_lat: ll ? ll.lat : null, last_lng: ll ? ll.lng : null, last_location_at: ll ? start : null,
          alerted_at: null, closed_at: null, created_at: now
        });
        return saveSession(s, null).then(function () {
          return insertEvent({ id: d.event_id || (d.event && d.event.id) || uuid(), session_id: sid, device_id: device.id, kind: 'start',
            lat: ll ? ll.lat : null, lng: ll ? ll.lng : null, accuracy_m: num(v.accuracy_m), client_ts: start,
            queued: Date.now() - Date.parse(start) > 120000, meta: { interval_min: interval, grace_min: grace } });
        }).then(function () { return s; });
      });
    }).then(function (s) {
      return { session_id: s.id, status: s.status, next_due_at: s.next_due_at, warnings: warnings };
    });
  }

  function opBuddyCheckin(device, d) {
    var v = d.event && typeof d.event === 'object' ? d.event : d;
    var kind = v.kind || 'checkin';
    if (CHECKIN_KINDS.indexOf(kind) < 0) return Promise.reject(opErr('invalid_kind'));
    var now = nowIso();
    var ts = minIso(v.client_ts || now, now);
    var ll = hasLL(v) ? { lat: +v.lat, lng: +v.lng } : null;
    return opSession(device.id, v.session_id || d.session_id).then(function (s) {
      var prevStatus = s.status;
      return insertEvent({ id: v.event_id || v.id || uuid(), session_id: s.id, device_id: device.id, kind: kind,
        lat: ll ? ll.lat : null, lng: ll ? ll.lng : null, accuracy_m: num(v.accuracy_m), client_ts: ts,
        queued: wasQueued(v, ts), note: cleanText(v.note, 500), meta: v.meta && typeof v.meta === 'object' ? v.meta : null
      }).then(function (ev) {
        if (s.status === 'closed') return { event_id: ev.id, session_status: s.status, ignored: 'session_closed' };
        var before = clone(s);
        var allClear = false;
        applyLocation(s, ll, ts);
        var extra = null;
        if (kind === 'checkin') {
          var last = s.last_checkin_at && Date.parse(s.last_checkin_at) > Date.parse(ts) ? s.last_checkin_at : ts;
          s.last_checkin_at = last;
          s.next_due_at = addMin(last, s.interval_min);
          if (s.status === 'overdue' || s.status === 'alerted') {
            allClear = s.status === 'alerted';
            s.status = 'active';
            s.alerted_at = null;
            extra = { session_id: s.id, device_id: device.id, kind: 'resolved', lat: ll ? ll.lat : null, lng: ll ? ll.lng : null,
              client_ts: nowIso(), meta: { by: 'checkin', previous_status: prevStatus } };
          }
        } else if (kind === 'sos') {
          // SOS is an emergency: escalate an active session, and re-alert when the recipient was only told about a
          // missed check-in (the next e-mail is worded as SOS). Same rule as SQL op_buddy_checkin.
          if (s.status === 'active' || (s.status === 'alerted' && s.alert_reason !== 'sos')) {
            s.status = 'overdue';
            s.alerted_at = null;
          }
          if (s.status === 'overdue' || s.status === 'alerted') s.alert_reason = 'sos';
        } else if (kind === 'overdue' && s.status === 'active') {
          s.status = 'overdue'; // detected on the device while offline
          s.alerted_at = null;
          s.alert_reason = 'overdue';
        }
        return saveSession(s, before).then(function () { return extra ? insertEvent(extra) : null; })
          .then(function () { return allClear ? allClearAlert(s) : null; })
          .then(function () {
            return { event_id: ev.id, session_status: s.status, status: s.status, alert_reason: s.alert_reason || null,
              next_due_at: s.next_due_at, received_at: ev.received_at };
          });
      });
    });
  }

  function opBuddyStop(device, d) {
    var now = nowIso();
    var ts = minIso(d.client_ts || now, now);
    var ll = hasLL(d) ? { lat: +d.lat, lng: +d.lng } : null;
    return opSession(device.id, d.session_id || d.id).then(function (s) {
      if (s.status === 'closed') return { session_id: s.id, session_status: s.status, ignored: 'already_closed' };
      var before = clone(s);
      var wasAlerted = s.status === 'alerted';
      var pre = (s.status === 'overdue' || s.status === 'alerted')
        ? insertEvent({ session_id: s.id, device_id: device.id, kind: 'resolved', lat: ll ? ll.lat : null, lng: ll ? ll.lng : null, client_ts: ts, meta: { by: 'stop', previous_status: s.status } })
        : Promise.resolve();
      return pre.then(function () {
        return insertEvent({ id: d.event_id || uuid(), session_id: s.id, device_id: device.id, kind: 'stop', lat: ll ? ll.lat : null, lng: ll ? ll.lng : null,
          accuracy_m: num(d.accuracy_m), client_ts: ts, queued: wasQueued(d, ts), note: cleanText(d.note, 500) });
      }).then(function () {
        s.status = 'closed'; s.closed_at = ts;
        return saveSession(s, before);
      }).then(function () { return wasAlerted ? allClearAlert(s) : null; })
        .then(function () { return { session_id: s.id, session_status: 'closed' }; });
    });
  }

  function opBuddyResolve(device, d) {
    var now = nowIso();
    var ts = minIso(d.client_ts || now, now);
    return opSession(device.id, d.session_id || d.id).then(function (s) {
      var was = s.status;
      if (was !== 'overdue' && was !== 'alerted') return { session_id: s.id, session_status: s.status, ignored: 'not_overdue' };
      var before = clone(s);
      return insertEvent({ id: d.event_id || uuid(), session_id: s.id, device_id: device.id, kind: 'resolved',
        lat: hasLL(d) ? +d.lat : null, lng: hasLL(d) ? +d.lng : null, client_ts: ts, queued: wasQueued(d, ts), note: cleanText(d.note, 500),
        meta: { by: 'device', previous_status: was } }).then(function () {
        var last = s.last_checkin_at && Date.parse(s.last_checkin_at) > Date.parse(ts) ? s.last_checkin_at : ts;
        s.status = 'active'; s.alerted_at = null; s.last_checkin_at = last; s.next_due_at = addMin(last, s.interval_min);
        return saveSession(s, before);
      }).then(function () { return was === 'alerted' ? allClearAlert(s) : null; })
        .then(function () { return { session_id: s.id, session_status: s.status, next_due_at: s.next_due_at }; });
    });
  }

  /* buddy.update {session_id, share_public_medical, public_medical}: only the medical-layer columns (no event). */
  function opBuddyUpdate(device, d) {
    return opSession(device.id, d.session_id || d.id).then(function (s) {
      if (s.status === 'closed') return { session_id: s.id, session_status: s.status, status: s.status, ignored: 'session_closed', received_at: nowIso() };
      var before = clone(s);
      var share = d.share_public_medical === undefined || d.share_public_medical === null
        ? !!s.share_public_medical : (d.share_public_medical === true || d.share_public_medical === 'true');
      s.share_public_medical = share;
      if (!share) s.public_medical = null;
      else if (Object.prototype.hasOwnProperty.call(d, 'public_medical')) s.public_medical = sanitizeMedical(d.public_medical);
      return saveSession(s, before).then(function () {
        return { session_id: s.id, session_status: s.status, status: s.status, share_public_medical: share,
          has_public_medical: !!s.public_medical, received_at: nowIso() };
      });
    });
  }

  /*
   * buddy.heartbeat {session_id, state:'live'|'paused', lat, lng, accuracy_m, silence_until, client_ts} (round 2 R6,
   * = SQL op_buddy_heartbeat): the device is alive. last_heartbeat_at = receive time (arrival order = creation order:
   * the outbox coalesces heartbeats), heartbeat_state, silence_until (≤ 24 h ahead; null = none), last location when the
   * fix is newer. No event (the log would fill up every 5 min); a closed session is ignored.
   */
  function opBuddyHeartbeat(device, d) {
    var state = d.state === undefined || d.state === null || d.state === '' ? 'live' : String(d.state);
    if (state !== 'live' && state !== 'paused') return Promise.reject(opErr('invalid_state'));
    var now = nowIso();
    var ts = minIso(d.client_ts || now, now);
    var su = d.silence_until ? Date.parse(d.silence_until) : NaN;
    var silence = isFinite(su) ? new Date(Math.min(su, Date.now() + DAY_MS)).toISOString() : null;
    var ll = hasLL(d) ? { lat: +d.lat, lng: +d.lng } : null;
    return opSession(device.id, d.session_id).then(function (s) {
      if (s.status === 'closed') return { session_id: s.id, session_status: s.status, status: s.status, ignored: 'session_closed', received_at: now };
      var before = clone(s);
      applyLocation(s, ll, ts);
      s.last_heartbeat_at = now;
      s.heartbeat_state = state;
      s.silence_until = silence;
      return saveSession(s, before).then(function () {
        return { session_id: s.id, session_status: s.status, status: s.status, alert_reason: s.alert_reason || null,
          heartbeat_state: state, silence_until: silence, received_at: now };
      });
    });
  }

  /* ---- Web Push ops (round 2 R6, = SQL): stored only — the local mock never delivers a push (NC.trip keeps in-app
     timers). meta rows 'push_sub:<endpoint>' {device_id, endpoint, p256dh, auth, lang} and 'push_sched:<device>' {items}. */
  var PUSH_SUB = 'push_sub:', PUSH_SCHED = 'push_sched:';
  function pushRows(prefix) {
    return t('meta').then(function (rows) { return rows.filter(function (r) { return r && typeof r.key === 'string' && r.key.indexOf(prefix) === 0 && r.value; }); });
  }
  function opPushSubscribe(device, d) {
    if (!validPushEndpoint(d.endpoint)) return Promise.reject(opErr('invalid_push_endpoint'));
    if (!validPushKeys(d.p256dh, d.auth)) return Promise.reject(opErr('invalid_push_keys'));
    var now = nowIso();
    return store.get('meta', PUSH_SUB + d.endpoint).then(function (prev) {
      var v = { device_id: device.id, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth, lang: d.lang === 'en' ? 'en' : 'vi',
        created_at: prev && prev.value ? prev.value.created_at : now, updated_at: now };
      return store.put('meta', { key: PUSH_SUB + d.endpoint, value: v });
    }).then(function () {
      // at most 5 subscriptions per device (the oldest go)
      return pushRows(PUSH_SUB).then(function (rows) {
        var mine = rows.filter(function (r) { return r.value.device_id === device.id; })
          .sort(function (a, b) { return String(b.value.updated_at).localeCompare(String(a.value.updated_at)); });
        return Promise.all(mine.slice(5).map(function (r) { return store.del('meta', r.key); })).then(function () { return mine.length; });
      });
    }).then(function (n) { return { subscribed: true, subscriptions: Math.min(n, 5), received_at: now }; });
  }
  function opPushUnsubscribe(device, d) {
    return pushRows(PUSH_SUB).then(function (rows) {
      var gone = rows.filter(function (r) { return r.value.device_id === device.id && (!d.endpoint || r.value.endpoint === d.endpoint); });
      return Promise.all(gone.map(function (r) { return store.del('meta', r.key); })).then(function () { return { deleted: gone.length, received_at: nowIso() }; });
    });
  }
  function opPushSchedule(device, d) {
    var chk = pushScheduleItems(d.items, Date.now());
    if (chk.error) return Promise.reject(opErr(chk.error));
    return store.put('meta', { key: PUSH_SCHED + device.id, value: { device_id: device.id, items: chk.items, updated_at: nowIso() } }).then(function () {
      return { scheduled: chk.items.length, skipped: chk.skipped, received_at: nowIso() };
    });
  }
  function dropPushRows(deviceId) {
    return pushRows(PUSH_SUB).then(function (rows) {
      return Promise.all(rows.filter(function (r) { return r.value.device_id === deviceId; }).map(function (r) { return store.del('meta', r.key); }));
    }).then(function () { return store.del('meta', PUSH_SCHED + deviceId); });
  }

  /*
   * device.erase: open sessions are closed WITHOUT an alert, then the device's sessions + events, device_ops and the
   * device row are deleted; its community reports stay but lose the device link (also in the audit snapshots).
   */
  function opDeviceErase(device) {
    return Promise.all([t('buddy_sessions'), t('checkin_events'), t('facility_submissions'), t('device_ops'), t('audit_log')]).then(function (r) {
      var sessions = r[0].filter(function (s) { return s.device_id === device.id; });
      var ids = {};
      sessions.forEach(function (s) { ids[s.id] = 1; });
      var evs = r[1].filter(function (e) { return ids[e.session_id]; });
      var subs = r[2].filter(function (x) { return x.device_id === device.id; });
      var ops = r[3].filter(function (o) { return o.device_id === device.id; });
      // recipients who were alerted and never got the all-clear (the server sends it from an inline payload, counted
      // in the alert ledger like every other e-mail)
      var clearList = sessions.filter(function (s) {
        var last = { overdue: 0, resolved: 0 };
        evs.forEach(function (e) {
          if (e.session_id !== s.id || e.kind !== 'alert_sent') return;
          var k = e.meta && e.meta.type === 'resolved' ? 'resolved' : 'overdue';
          last[k] = Math.max(last[k], Date.parse(e.received_at || e.client_ts) || 0);
        });
        return s.recipient_email && last.overdue > last.resolved;
      });
      var clear = clearList.length;
      return clearList.reduce(function (p, s) {
        return p.then(function () { return ledgerAdd(s.recipient_email, 'all_clear', 'resolved', 'erase'); });
      }, Promise.resolve()).then(function () {
        return sessions.reduce(function (p, s) {
          return p.then(function () {
            if (s.status === 'closed') return null;
            var b = clone(s);
            s.status = 'closed'; s.closed_at = nowIso();
            return saveSession(s, b, 'device');
          });
        }, Promise.resolve());
      }).then(function () {
        return Promise.all(evs.map(function (e) { return store.del('checkin_events', e.id); }));
      }).then(function () {
        return Promise.all(sessions.map(function (s) {
          return store.del('buddy_sessions', s.id).then(function () { notify('buddy_sessions', 'DELETE', { id: s.id }); });
        }));
      }).then(function () {
        return Promise.all(subs.map(function (x) {
          return store.put('facility_submissions', Object.assign({}, x, { device_id: null })).then(function (saved) { notify('facility_submissions', 'UPDATE', saved); });
        }));
      }).then(function () {
        return Promise.all(r[4].filter(function (a) {
          return a.entity === 'facility_submissions' && a.details && a.details.row && a.details.row.device_id === device.id;
        }).map(function (a) { a.details.row.device_id = null; return store.put('audit_log', a); }));
      }).then(function () {
        return Promise.all(ops.map(function (o) { return store.del('device_ops', o.id); }));
      }).then(function () { return dropPushRows(device.id); })   // push_subscriptions / push_schedule cascade in SQL
        .then(function () { return store.del('devices', device.id); }).then(function () {
        notify('devices', 'DELETE', { id: device.id });
        return { erased: true, sessions_deleted: sessions.length, events_deleted: evs.length, submissions_unlinked: subs.length,
          all_clear_sent: clear, received_at: nowIso() };
      });
    });
  }

  function opReportSubmit(device, d, opId) {
    var kind = d.kind || 'new';
    if (SUBMISSION_KINDS.indexOf(kind) < 0) return Promise.reject(opErr('invalid_kind'));
    if (JSON.stringify(d).length > 8000) return Promise.reject(opErr('payload_too_large'));
    var id = cleanText(d.id, 64) || opId;
    var payload = Object.assign({}, d);
    delete payload.id;
    return store.get('facility_submissions', id).then(function (ex) {
      if (ex) return { submission_id: ex.id };
      var row = { id: id, device_id: device.id, facility_id: cleanText(d.facility_id, 64), kind: kind, payload: payload,
        lat: hasLL(d) ? +d.lat : null, lng: hasLL(d) ? +d.lng : null, status: 'pending', review_note: null,
        reviewed_by: null, reviewed_at: null, created_at: nowIso() };
      return write('facility_submissions', row, null, 'device').then(function () { return { submission_id: id }; });
    });
  }

  function opSignalLog(device, d) {
    var arr = Array.isArray(d) ? d : d.samples;
    if (!Array.isArray(arr)) return Promise.reject(opErr('invalid_samples'));
    if (arr.length > 1000) return Promise.reject(opErr('too_many_samples'));
    return Promise.all([t('routes'), t('route_edges'), carrierList()]).then(function (r) {
      var routeIds = r[0].map(function (x) { return x.id; });
      var edges = {};
      r[1].forEach(function (e) { edges[e.id] = e; });
      var ok = 0, skipped = 0;
      var now = nowIso();
      return arr.reduce(function (p, x) {
        return p.then(function () {
          var carrier = (x && x.carrier) || device.carrier;
          var rsrp = x && (x.rsrp_dbm !== undefined ? x.rsrp_dbm : x.rsrp);
          rsrp = rsrp === null || rsrp === undefined || rsrp === '' || !isFinite(rsrp) ? null : Math.round(+rsrp);
          if (rsrp !== null && (rsrp < -160 || rsrp > -20)) rsrp = null;
          var tech = x && ['5G', '4G', '3G', '2G', 'none'].indexOf(x.tech) >= 0 ? x.tech : null;
          var level = x && ['likely', 'uncertain', 'lost'].indexOf(x.level) >= 0 ? x.level : null;
          var route = x && routeIds.indexOf(x.route_id) >= 0 ? x.route_id : null;
          var edge = x && edges[x.edge_id] ? x.edge_id : null;
          if (edge && !route) route = edges[edge].route_id;
          if (!hasLL(x) || r[2].indexOf(carrier) < 0 || (level === null && rsrp === null && tech === null) || !route) { skipped++; return null; }
          ok++;
          return store.put('signal_samples', {
            route_id: route, edge_id: edge, carrier: carrier, tech: tech, rsrp_dbm: rsrp,
            level: level || (tech === 'none' ? 'lost' : levelFromRsrp(rsrp)), lat: +x.lat, lng: +x.lng,
            measured_at: minIso(x.measured_at || x.ts || now, now), source: 'community', status: 'pending',
            device_model: cleanText(x.device_model, 60), is_holdout: false, created_at: now
          }).then(function (saved) { notify('signal_samples', 'INSERT', saved); });
        });
      }, Promise.resolve()).then(function () { return { inserted: ok, skipped: skipped }; });
    });
  }

  /* app_private.apply_device_op */
  function applyOp(device, op) {
    var d = op.data && typeof op.data === 'object' ? op.data : {};
    switch (op.op) {
      case 'device.register':
        return carrierList().then(function (ids) {
          if (ids.indexOf(d.carrier) >= 0) device.carrier = d.carrier;
          if (d.app_version) device.app_version = cleanText(d.app_version, 40);
          return store.put('devices', device).then(function () { return { device_id: device.id }; });
        });
      case 'buddy.start': return opBuddyStart(device, d);
      case 'buddy.checkin': return opBuddyCheckin(device, d);
      case 'buddy.stop': return opBuddyStop(device, d);
      case 'buddy.resolve': return opBuddyResolve(device, d);
      case 'buddy.update': return opBuddyUpdate(device, d);
      case 'report.submit': return opReportSubmit(device, d, op.id);
      case 'signal.log': return opSignalLog(device, d);
      case 'device.erase': return opDeviceErase(device);
      case 'buddy.heartbeat': return opBuddyHeartbeat(device, d);
      case 'push.subscribe': return opPushSubscribe(device, d);
      case 'push.unsubscribe': return opPushUnsubscribe(device, d);
      case 'push.schedule': return opPushSchedule(device, d);
      default: return Promise.reject(opErr('unknown_op'));
    }
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * sync_device_ops(device_id, secret, ops) → {results:[{id, status:'ok'|'duplicate'|'error', data?, error?, retryable?}],
   * server_time, session}. Idempotent on op id (device_ops). Throws err('unauthorized_device') on bad credentials.
   */
  local.sync_device_ops = function (deviceId, secret, ops) {
    var results = [];
    var device = null;
    var erased = false;
    var tombstone = false;
    return gate(true).then(function () { return store.get('devices', deviceId); }).then(function (dev) {
      // replay of an erase tombstone: the device (and everything it owned) is already gone → no-op success
      if (!dev && Array.isArray(ops) && ops.length <= 200 && ops.some(function (o) { return o && o.op === 'device.erase'; })) {
        tombstone = true;
        ops.forEach(function (o) {
          results.push(o && o.op === 'device.erase'
            ? { id: o.id, status: 'ok', data: { erased: true, already_erased: true } }
            : { id: o ? o.id : null, status: 'error', error: 'device_erased', retryable: false });
        });
        return null;
      }
      if (!dev || !dev.secret_hash) throw err('unauthorized_device', 'Unknown device or wrong secret: call register_device again.');
      device = dev;
      return sha256Hex(secret || '');
    }).then(function (hash) {
      if (tombstone) return null;
      if (hash !== device.secret_hash) throw err('unauthorized_device', 'Unknown device or wrong secret: call register_device again.');
      if (!Array.isArray(ops || [])) throw err('invalid_ops', 'invalid_ops');
      if ((ops || []).length > 200) throw err('too_many_ops', 'Send at most 200 ops per call.');
      device.last_seen_at = nowIso();
      return store.put('devices', device);
    }).then(function () {
      if (tombstone) return null;
      return (ops || []).reduce(function (p, op) {
        return p.then(function () {
          if (erased) { results.push({ id: op ? op.id : null, status: 'error', error: 'device_erased', retryable: false }); return null; }
          if (!op || !UUID_RE.test(String(op.id || ''))) {
            results.push({ id: op ? op.id : null, status: 'error', error: 'invalid_op_id', retryable: false });
            return null;
          }
          return store.get('device_ops', op.id).then(function (seen) {
            if (seen) { results.push({ id: op.id, status: 'duplicate', data: seen.result ? seen.result.data : null }); return null; }
            return store.put('device_ops', { id: op.id, device_id: deviceId, op: op.op || '?', received_at: nowIso(), result: null }).then(function () {
              return applyOp(device, op);
            }).then(function (data) {
              results.push({ id: op.id, status: 'ok', data: data || null });
              if (op.op === 'device.erase') { erased = true; return null; } // its device_ops rows are gone with the device
              return store.put('device_ops', { id: op.id, device_id: deviceId, op: op.op, received_at: nowIso(), result: { status: 'ok', data: data || null } });
            }, function (e) {
              results.push({ id: op.id, status: 'error', error: e.code || e.message || String(e), retryable: e.retryable !== false });
              return store.del('device_ops', op.id); // rolled back like the SQL sub-transaction
            });
          });
        });
      }, Promise.resolve());
    }).then(function () { return tombstone || erased ? null : deviceSession(deviceId); }).then(function (s) {
      return { results: results, server_time: nowIso(), session: sessionView(s) };
    });
  };

  /* ================================================================== cron mock (pg_cron every minute → here every 15 s) */

  var CRON_LEASE = 'nc.server.cron';
  var ALERT_RETRY_MS = 10 * 60000;

  function isLeader() {
    try {
      var now = Date.now();
      var raw = localStorage.getItem(CRON_LEASE);
      var lease = raw ? JSON.parse(raw) : null;
      if (!lease || lease.tab === TAB_ID || lease.until < now) {
        localStorage.setItem(CRON_LEASE, JSON.stringify({ tab: TAB_ID, until: now + local.cronMs * 2 + 1000 }));
        return true;
      }
      return false;
    } catch (e) { return true; }
  }

  function maskEmail(e) {
    var m = /^([^@]{0,2})[^@]*(@.*)$/.exec(e || '');
    return m ? m[1] + '***' + m[2] : null;
  }

  /* Latest SOS since the last check-in (ISO) or null — v_buddy_sessions.sos_at. */
  function sosSince(s, events) {
    var since = Date.parse(s.last_checkin_at || s.started_at);
    var best = null;
    events.forEach(function (e) {
      if (e.session_id !== s.id || e.kind !== 'sos') return;
      var at = e.client_ts || e.received_at;
      if (Date.parse(at) >= since && (!best || Date.parse(at) > Date.parse(best))) best = at;
    });
    return best;
  }

  /*
   * alert_payload().reason: alert_reason 'sos' (or an SOS since the last check-in) → 'sos'; 'contact_lost' → 'contact_lost';
   * active (manual) → 'manual'; else 'overdue'.
   */
  function alertReason(s) {
    return t('checkin_events').then(function (rows) {
      if (s.alert_reason === 'sos' || sosSince(s, rows)) return 'sos';
      if (s.alert_reason === 'contact_lost' && s.status !== 'active') return 'contact_lost';
      return s.status === 'active' ? 'manual' : 'overdue';
    });
  }

  /**
   * Simulated e-mail delivery (edge function 'deadman-alert' + nc_alert_result, provider 'simulated'):
   * overdue (or manual trigger on active/alerted) → 'alerted' + event 'alert_sent' {type, provider, id, trigger, reason}.
   * A manual alert is attributed to the signed-in admin. With local.failAlerts set the send fails like a provider error:
   * event 'alert_failed' {reason:'send_failed', error}, the session stays as it was (the cron retries with backoff).
   * @returns {Promise<{session_id, status:'sent'|'failed', provider, reason, id?, error?}>}
   */
  function sendAlert(s, trigger) {
    return alertReason(s).then(function (reason) {
      var before = clone(s);
      var at = nowIso();
      var manual = trigger === 'manual';
      var actor = manual ? actorLabel() : 'system';
      var fail = local.failAlerts ? (typeof local.failAlerts === 'string' ? local.failAlerts : 'simulated_failure') : null;
      if (fail) {
        return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'alert_failed', client_ts: at,
          meta: { type: 'overdue', provider: 'simulated', error: fail, trigger: trigger, reason: 'send_failed', alert_reason: reason,
            actor: manual ? actor : undefined } })
          .then(function () { return { session_id: s.id, status: 'failed', provider: 'simulated', reason: reason, error: fail }; });
      }
      var pid = 'sim-' + uuid().slice(0, 8);
      if (s.status === 'overdue' || (manual && (s.status === 'active' || s.status === 'alerted'))) {
        s.status = 'alerted';
        s.alerted_at = at;
      }
      return saveSession(s, before, actor).then(function () {
        return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'alert_sent', client_ts: at,
          meta: { type: 'overdue', provider: 'simulated', id: pid, trigger: trigger, reason: reason, to: maskEmail(s.recipient_email),
            include_medical: !!s.share_public_medical, actor: manual ? actor : undefined } });
      }).then(function () { return ledgerAdd(s.recipient_email, 'alert', reason, trigger); })
        .then(function () { return { session_id: s.id, status: 'sent', provider: 'simulated', reason: reason, id: pid }; });
    });
  }

  /* "All clear" e-mail after an alerted session is resolved/checked-in/closed (type 'resolved'). */
  function allClearAlert(s) {
    if (!s.recipient_email) return Promise.resolve(null);
    return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'alert_sent', client_ts: nowIso(),
      meta: { type: 'resolved', provider: 'simulated', id: 'sim-' + uuid().slice(0, 8), trigger: 'cron', to: maskEmail(s.recipient_email) } })
      .then(function (ev) { return ledgerAdd(s.recipient_email, 'all_clear', 'resolved', 'cron').then(function () { return ev; }); });
  }

  /** nc_mark_overdue() → count (active & now > next_due_at + grace → 'overdue' + event). */
  function markOverdue(rows) {
    var now = Date.now();
    var due = rows.filter(function (s) {
      return s.status === 'active' && s.next_due_at && now > Date.parse(s.next_due_at) + (s.grace_min || 0) * 60000;
    });
    return due.reduce(function (p, s) {
      return p.then(function () {
        var before = clone(s);
        s.status = 'overdue'; s.alerted_at = null;
        return saveSession(s, before, 'system').then(function () {
          return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'overdue', lat: s.last_lat, lng: s.last_lng, client_ts: nowIso(),
            meta: { source: 'server', next_due_at: s.next_due_at, grace_min: s.grace_min } });
        });
      });
    }, Promise.resolve()).then(function () { return due.length; });
  }

  /*
   * nc_mark_contact_lost() (round 2 R6) → count. A session whose app said 'live' (visible, online) and that has been
   * silent — no heartbeat and no check-in — for more than contact_lost_after_min (15), outside its predicted dead zone
   * (silence_until null or past), becomes 'overdue' with alert_reason 'contact_lost' + event overdue {reason}. The
   * normal dispatch then e-mails the recipient (only with an e-mail). 'paused' sessions: the dead-man switch only.
   * This mock runs inside the traveller's own page, so it can only judge a silence while it was running itself:
   * the silence counts from max(last heartbeat, last check-in, start of the current cron run). The SQL server never
   * stops, so there it counts from the last heartbeat / check-in.
   */
  function markContactLost(rows) {
    var now = Date.now();
    var limit = (local.limits.contact_lost_after_min || 15) * 60000;
    var since = observedSince();
    var due = rows.filter(function (s) {
      if (s.status !== 'active' || s.heartbeat_state !== 'live' || !s.last_heartbeat_at) return false;
      if (s.silence_until && Date.parse(s.silence_until) >= now) return false;
      var heard = Math.max(Date.parse(s.last_heartbeat_at) || 0, Date.parse(s.last_checkin_at || '') || 0, since);
      return now - heard > limit;
    });
    return due.reduce(function (p, s) {
      return p.then(function () {
        var before = clone(s);
        s.status = 'overdue'; s.alerted_at = null; s.alert_reason = 'contact_lost';
        return saveSession(s, before, 'system').then(function () {
          return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'overdue', lat: s.last_lat, lng: s.last_lng, client_ts: nowIso(),
            meta: { source: 'server', reason: 'contact_lost', last_heartbeat_at: s.last_heartbeat_at, silence_until: s.silence_until || null } });
        });
      });
    }, Promise.resolve()).then(function () { return due.length; });
  }
  /* Start of the current uninterrupted cron run (a frozen / closed page is a server outage for this mock). */
  var cronSeen = { first: 0, last: 0 };
  function observedSince() {
    if (typeof local.observedSince === 'number') return local.observedSince;   // test hook
    return cronSeen.first || Date.now();
  }
  function noteCronRun() {
    var now = Date.now();
    if (!cronSeen.last || now - cronSeen.last > 3 * local.cronMs + 5000) cronSeen.first = now;
    cronSeen.last = now;
  }

  /* Retry policy after failed sends (= app_private.alert_backoff_ok): 2, 4, 8, 16, 32 min; stop after 6 in an hour. */
  function backoffOk(sessionId, events, now) {
    var fails = events.filter(function (e) {
      return e.session_id === sessionId && e.kind === 'alert_failed' && !(e.meta && (e.meta.type === 'resolved' || e.meta.reason === 'rate_limited')) &&
        Date.parse(e.received_at || e.client_ts) > now - 3600000;
    });
    if (!fails.length) return true;
    if (fails.length >= 6) return false;
    var last = Math.max.apply(null, fails.map(function (e) { return Date.parse(e.received_at || e.client_ts); }));
    return last < now - Math.pow(2, fails.length) * 60000;
  }

  /* ---------------------------------------------------- alert quota ledger (= app_private.alert_ledger, SQL 20260929000100) */

  var LEDGER_PREFIX = 'alert_ledger:';
  var LEDGER_KEEP_MS = 2 * DAY_MS;

  /** Ledger key of a recipient: sha256 of the normalised address, never the address itself. @returns {Promise<string|null>} */
  function recipientHash(email) {
    var n = normalizeEmail(email);
    return n ? sha256Hex('nomadcare-alert-ledger|' + n) : Promise.resolve(null);
  }

  /** Ledger rows (meta store, keys 'alert_ledger:*'): [{key, recipient_hash, kind, reason, source, status, created_at, at(ms)}]. */
  function ledgerRows() {
    return t('meta').then(function (rows) {
      return rows.filter(function (r) { return r && typeof r.key === 'string' && r.key.indexOf(LEDGER_PREFIX) === 0 && r.value; })
        .map(function (r) { return Object.assign({ key: r.key, at: Date.parse(r.value.created_at) || 0 }, r.value); });
    });
  }

  /**
   * Records one alert / all-clear e-mail. No session or device link: device.erase and the session retention keep it,
   * local.cleanup() prunes it after 48 h. Demo recipients are never e-mailed for real and are not recorded.
   * @param {string} email @param {'alert'|'all_clear'} kind @param {string} reason @param {string} source
   * @returns {Promise<Object|null>} the ledger row or null
   */
  function ledgerAdd(email, kind, reason, source) {
    if (!email || isReservedEmail(email)) return Promise.resolve(null);
    return recipientHash(email).then(function (h) {
      if (!h) return null;
      var v = { recipient_hash: h, kind: kind, reason: reason || null, source: source || null, status: 'sent', created_at: nowIso() };
      return store.put('meta', { key: LEDGER_PREFIX + uuid(), value: v }).then(function () {
        return Object.assign({ at: Date.parse(v.created_at) }, v);
      });
    });
  }

  /*
   * Why no alert e-mail may go to `email` (ledger key `hash`) now (= app_private.alert_quota_block): 'recipient_24h' |
   * 'global_1h' | null. Counts the ledger: alerts AND all-clear e-mails, which device.erase cannot delete.
   */
  function quotaBlock(email, hash, ledger, now) {
    if (!email || isReservedEmail(email)) return null;
    var live = ledger.filter(function (x) { return x.status === 'sent' || x.status === 'claimed'; });
    if (live.filter(function (x) { return x.recipient_hash === hash && x.at > now - DAY_MS; }).length >= local.limits.alert_recipient_24h) return 'recipient_24h';
    if (live.filter(function (x) { return x.at > now - 3600000; }).length >= local.limits.alert_global_1h) return 'global_1h';
    return null;
  }

  /**
   * nc_dispatch_alerts() → number of alert e-mails sent (alert_due: overdue, recipient e-mail, not alerted in the last
   * 10 min, send backoff, abuse quota). Sessions held back by the quota stay 'overdue' and get ONE 'alert_failed'
   * {reason:'rate_limited'} per overdue episode.
   */
  function dispatchAlerts(rows) {
    var now = Date.now();
    return Promise.all([t('checkin_events'), ledgerRows()]).then(function (r) {
      var events = r[0];
      var ledger = r[1];
      var todo = rows.filter(function (s) {
        return s.status === 'overdue' && s.recipient_email && (!s.alerted_at || Date.parse(s.alerted_at) < now - ALERT_RETRY_MS) && backoffOk(s.id, events, now);
      }).sort(function (a, b) { return String(a.next_due_at || '').localeCompare(String(b.next_due_at || '')); });
      var n = 0;
      return todo.reduce(function (p, s) {
        return p.then(function () { return recipientHash(s.recipient_email); }).then(function (hash) {
          var block = quotaBlock(s.recipient_email, hash, ledger, now);
          if (!block) {
            return sendAlert(s, 'cron').then(function (res) {
              if (res.status !== 'sent') return;
              n++;
              if (!isReservedEmail(s.recipient_email)) ledger.push({ recipient_hash: hash, kind: 'alert', status: 'sent', at: now });
            });
          }
          var since = Date.parse(s.last_checkin_at || s.started_at);
          var flagged = events.some(function (e) {
            return e.session_id === s.id && e.kind === 'alert_failed' && e.meta && e.meta.reason === 'rate_limited' && Date.parse(e.received_at || e.client_ts) >= since;
          });
          if (flagged) return null;
          return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'alert_failed', client_ts: nowIso(),
            meta: { type: 'overdue', reason: 'rate_limited', limit: block,
              max: block === 'recipient_24h' ? local.limits.alert_recipient_24h : local.limits.alert_global_1h, trigger: 'cron', provider: 'none' } })
            .then(function (ev) { events.push(ev); });
        });
      }, Promise.resolve()).then(function () { return n; });
    });
  }

  /**
   * nc_cleanup() (retention): device_ops > 30 days, sessions closed > 30 days ago or idle > 90 days (with their events),
   * alert ledger rows > 48 h. Runs from the cron tick at most once an hour. @returns {Promise<Object>} counts
   */
  local.cleanup = function () {
    return init().then(function () { return Promise.all([t('buddy_sessions'), t('checkin_events'), t('device_ops'), ledgerRows()]); }).then(function (r) {
      var now = Date.now();
      var old = {};
      r[0].forEach(function (s) {
        var closed = Date.parse(s.closed_at || s.updated_at || s.started_at);
        var touched = Date.parse(s.updated_at || s.last_checkin_at || s.started_at);
        if ((s.status === 'closed' && closed < now - 30 * DAY_MS) || (s.status !== 'closed' && touched < now - 90 * DAY_MS)) old[s.id] = 1;
      });
      var evs = r[1].filter(function (e) { return old[e.session_id]; });
      var ops = r[2].filter(function (o) { return Date.parse(o.received_at) < now - 30 * DAY_MS; });
      var ledger = r[3].filter(function (x) { return x.at < now - LEDGER_KEEP_MS; });
      return Promise.all(evs.map(function (e) { return store.del('checkin_events', e.id); })
        .concat(Object.keys(old).map(function (id) { return store.del('buddy_sessions', id).then(function () { notify('buddy_sessions', 'DELETE', { id: id }); }); }))
        .concat(ops.map(function (o) { return store.del('device_ops', o.id); }))
        .concat(ledger.map(function (x) { return store.del('meta', x.key); }))).then(function () {
        return { device_ops_deleted: ops.length, sessions_deleted: Object.keys(old).length, events_deleted: evs.length,
          ledger_deleted: ledger.length, at: nowIso() };
      });
    });
  };
  var lastCleanup = 0;

  var ticking = false;
  /**
   * One cron tick. Alerts go out for sessions that were already overdue at the previous tick (simulates the
   * asynchronous pg_net → Edge Function → Resend delivery), then newly overdue sessions are marked; retention hourly.
   * @param {{force?:boolean}} [opts] force = skip leader election (tests)
   * @returns {Promise<{alerted:number, overdue:number}>}
   */
  local.tick = function (opts) {
    if (ticking) return Promise.resolve({ alerted: 0, overdue: 0, skipped: true });
    if (!(opts && opts.force) && !isLeader()) return Promise.resolve({ alerted: 0, overdue: 0, skipped: true });
    ticking = true;
    var res = { alerted: 0, overdue: 0 };
    noteCronRun();
    return init().then(function () { return t('buddy_sessions'); })
      .then(function (rows) { return dispatchAlerts(rows); })
      .then(function (n) { res.alerted = n; return t('buddy_sessions'); })
      .then(function (rows) { return markOverdue(rows); })
      .then(function (n) { res.overdue = n; return t('buddy_sessions'); })
      .then(function (rows) { return markContactLost(rows); })
      .then(function (n) {
        res.contact_lost = n;
        if (Date.now() - lastCleanup < 3600000) return null;
        lastCleanup = Date.now();
        return local.cleanup().catch(function () { return null; });
      })
      .then(function () { ticking = false; return res; }, function (e) { ticking = false; throw e; });
  };

  function startCron() {
    if (cronTimer) return;
    cronTimer = setInterval(function () { local.tick().catch(function () { /* next tick */ }); }, local.cronMs);
    setTimeout(function () { local.tick().catch(function () { }); }, 1500);
  }

  /* ================================================================== admin (dashboard) */

  function adminSession() {
    try {
      var raw = localStorage.getItem(ADMIN_LS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return local._memAdmin || null; }
  }
  function setAdminSession(s) {
    local._memAdmin = s;
    try { if (s) localStorage.setItem(ADMIN_LS, JSON.stringify(s)); else localStorage.removeItem(ADMIN_LS); } catch (e) { /* memory only */ }
  }

  /* Admin RPCs need the demo/admin session (enterDemo / signIn), like RLS + is_admin() on Supabase. */
  function adminGate() {
    return gate(false).then(function () {
      if (!adminSession()) throw err('forbidden', 'Admin sign-in required');
    });
  }

  function filterFacilities(rows, q) {
    q = q || {};
    var norm = (NC.util && NC.util.normalize) ? NC.util.normalize : function (s) {
      var x = String(s || '').toLowerCase().replace(/đ/g, 'd');
      return x.normalize ? x.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : x;
    };
    var needle = q.q ? norm(q.q) : null;
    return rows.map(function (f) { return decorateFacility(f); }).filter(function (f) {
      if (q.route_id && f.route_id !== q.route_id) return false;
      if (q.status && f.status !== q.status) return false;
      if (q.type && f.type !== q.type) return false;
      if (q.stale === true && !(f.status === 'verified' && f.is_stale)) return false;
      if (q.stale === false && f.is_stale) return false;
      if (needle && norm(f.name).indexOf(needle) < 0 && norm(f.address).indexOf(needle) < 0 && norm(f.id).indexOf(needle) < 0) return false;
      return true;
    }).sort(function (a, b) { return String(a.route_id || '').localeCompare(String(b.route_id || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'); });
  }

  var FAC_FIELDS = ['id', 'route_id', 'name', 'type', 'address', 'lat', 'lng', 'phone', 'open_hours', 'night_shift', 'trauma_capable',
    'verified_by', 'verified_at', 'status', 'source', 'notes', 'is_demo'];
  var SVC_FIELDS = ['id', 'route_id', 'name', 'type', 'lat', 'lng', 'phone', 'open_hours', 'is_partner', 'commission_rate', 'status', 'notes', 'is_demo'];

  function pick(src, keys) {
    var o = {};
    keys.forEach(function (k) { if (src[k] !== undefined) o[k] = src[k]; });
    return o;
  }

  function normFacility(row) {
    ['lat', 'lng'].forEach(function (k) { row[k] = isBlank(row[k]) ? null : +row[k]; });
    ['name', 'address', 'phone', 'open_hours', 'verified_by', 'notes'].forEach(function (k) { if (typeof row[k] === 'string') row[k] = row[k].trim(); if (row[k] === '') row[k] = null; });
    ['night_shift', 'trauma_capable'].forEach(function (k) { if (row[k] === '' || row[k] === undefined) row[k] = null; else if (row[k] !== null) row[k] = row[k] === true || row[k] === 'true' || row[k] === 1; });
    if (row.verified_at === '') row.verified_at = null;
    if (row.verified_at) row.verified_at = String(row.verified_at).slice(0, 10);
    return row;
  }

  var admin = local.admin = {
    /** Local mode: any e-mail/password enters the demo admin (no real auth on the mock server). */
    signIn: function (email) { return admin.enterDemo(email); },
    signOut: function () { setAdminSession(null); return Promise.resolve(); },
    session: function () { return Promise.resolve(adminSession()); },
    enterDemo: function (email) {
      var s = { user: { email: email || 'demo-admin@nomadcare.local', id: null }, role: 'admin', demo: true };
      setAdminSession(s);
      return init().then(function () { return s; });
    },

    /** admin_kpis() */
    kpis: function () {
      return adminGate().then(function () {
        return Promise.all([t('facilities'), t('facility_submissions'), t('buddy_sessions'), t('signal_samples'), t('routes'), t('route_accuracy'), t('data_packs'), carrierList()]);
      }).then(function (r) {
        var facs = r[0].map(function (f) { return decorateFacility(f); });
        var subs = r[1], sess = r[2], samples = r[3], routes = r[4].sort(byRouteSort), acc = r[5], packs = r[6], carriers = r[7];
        var dayAgo = Date.now() - DAY_MS;
        function cnt(arr, fn) { return arr.filter(fn).length; }
        var byCarrier = {};
        carriers.forEach(function (c) { byCarrier[c] = cnt(samples, function (s) { return s.carrier === c; }); });
        return {
          facilities: {
            verified: cnt(facs, function (f) { return f.status === 'verified'; }),
            pending: cnt(facs, function (f) { return f.status === 'pending'; }),
            rejected: cnt(facs, function (f) { return f.status === 'rejected'; }),
            stale: cnt(facs, function (f) { return f.status === 'verified' && f.is_stale; }),
            target: 216
          },
          submissions_pending: cnt(subs, function (s) { return s.status === 'pending'; }),
          buddy: {
            active: cnt(sess, function (s) { return s.status === 'active'; }),
            overdue: cnt(sess, function (s) { return s.status === 'overdue'; }),
            alerted: cnt(sess, function (s) { return s.status === 'alerted'; }),
            closed_24h: cnt(sess, function (s) { return s.status === 'closed' && s.closed_at && Date.parse(s.closed_at) >= dayAgo; })
          },
          samples: { total: samples.length, pending: cnt(samples, function (s) { return s.status === 'pending'; }), by_carrier: byCarrier },
          routes: routes.map(function (rt) {
            var a = {};
            carriers.forEach(function (c) { a[c] = null; });
            acc.forEach(function (x) { if (x.route_id === rt.id) a[x.carrier] = num(x.accuracy); });
            return {
              id: rt.id, name: rt.name,
              verified: cnt(facs, function (f) { return f.route_id === rt.id && f.status === 'verified'; }),
              pending: cnt(facs, function (f) { return f.route_id === rt.id && f.status === 'pending'; }),
              stale: cnt(facs, function (f) { return f.route_id === rt.id && f.status === 'verified' && f.is_stale; }),
              accuracy: a,
              samples: cnt(samples, function (s) { return s.route_id === rt.id; })
            };
          }),
          packs: packs.filter(function (p) { return p.is_current; }).map(function (p) {
            return { route_id: p.route_id, carrier: p.carrier, version: p.version, published_at: p.published_at };
          }).sort(function (a, b) { return a.route_id.localeCompare(b.route_id) || a.carrier.localeCompare(b.carrier); })
        };
      });
    },

    /** Rows shaped like v_facilities (lat/lng, is_stale, days_since_verified). */
    listFacilities: function (q) {
      return adminGate().then(function () { return t('facilities'); }).then(function (rows) { return filterFacilities(rows, q); });
    },

    /**
     * Insert/update a facility. Throws {code:'incomplete', missing:[...]} when status 'verified' lacks required fields.
     * @returns {Promise<Object>} saved row (v_facilities shape)
     */
    upsertFacility: function (f) {
      if (!f) return Promise.reject(err('invalid', 'Missing facility'));
      return adminGate().then(function () { return f.id ? store.get('facilities', f.id) : null; }).then(function (before) {
        var now = nowIso();
        var row = normFacility(Object.assign({}, before || { status: 'pending', source: 'team', is_demo: true, created_at: now }, pick(f, FAC_FIELDS)));
        if (!row.id) row.id = uuid();
        if (row.type && FACILITY_TYPES.indexOf(row.type) < 0) throw err('invalid_type', 'Invalid facility type');
        if ((row.lat !== null && Math.abs(row.lat) > 90) || (row.lng !== null && Math.abs(row.lng) > 180) || (row.lat === null) !== (row.lng === null)) {
          if (row.lat === null || row.lng === null) { row.lat = null; row.lng = null; } else throw err('invalid_coordinates', 'invalid_coordinates');
        }
        if (FACILITY_STATUSES.indexOf(row.status) < 0) throw err('invalid_status', 'Invalid status');
        // a typo like 2062 would keep a facility "fresh" for decades (1 day of tolerance for time zones ahead of Vietnam)
        if (row.verified_at && (!/^\d{4}-\d{2}-\d{2}$/.test(row.verified_at) || row.verified_at > addDays(todayVn(), 1) || row.verified_at < '2000-01-01')) {
          throw err('invalid_date', 'The verification date cannot be in the future', { field: 'verified_at', details: row.verified_at });
        }
        if (row.status === 'verified' && row.lat !== null && row.lng !== null && !inVietnam(row.lat, row.lng)) {
          throw err('invalid_coordinates', 'A verified facility must be inside Vietnam', { reason: 'outside_vietnam', details: 'outside_vietnam' });
        }
        if (row.status === 'verified') {
          var missing = facilityMissing(row);
          if (missing.length) throw err('incomplete', 'Facility is missing required fields: ' + missing.join(', '), { missing: missing });
        }
        row.updated_at = now;
        return write('facilities', row, before).then(function (saved) { return decorateFacility(saved); });
      });
    },

    setFacilityStatus: function (id, status) {
      return adminGate().then(function () { return store.get('facilities', id); }).then(function (before) {
        if (!before) throw err('not_found', 'Facility not found');
        return admin.upsertFacility({ id: id, status: status });
      });
    },

    deleteFacility: function (id) {
      return adminGate().then(function () { return store.get('facilities', id); }).then(function (before) {
        if (!before) throw err('not_found', 'Facility not found');
        return remove('facilities', id, before).then(function () { return true; });
      });
    },

    listServices: function (q) {
      q = q || {};
      return adminGate().then(function () { return t('services'); }).then(function (rows) {
        return rows.filter(function (s) { return !q.route_id || s.route_id === q.route_id; })
          .filter(function (s) { return !q.type || s.type === q.type; })
          .sort(function (a, b) { return String(a.route_id || '').localeCompare(String(b.route_id || '')) || String(a.name).localeCompare(String(b.name), 'vi'); });
      });
    },

    upsertService: function (s) {
      if (!s) return Promise.reject(err('invalid', 'Missing service'));
      return adminGate().then(function () { return s.id ? store.get('services', s.id) : null; }).then(function (before) {
        var now = nowIso();
        var row = Object.assign({}, before || { status: 'active', is_partner: false, commission_rate: 0, is_demo: true, created_at: now }, pick(s, SVC_FIELDS));
        if (!row.id) row.id = uuid();
        if (isBlank(row.name)) throw err('incomplete', 'Service name is required', { missing: ['name'] });
        if (SERVICE_TYPES.indexOf(row.type) < 0) throw err('invalid_type', 'Invalid service type');
        ['lat', 'lng'].forEach(function (k) { row[k] = isBlank(row[k]) ? null : +row[k]; });
        row.commission_rate = +row.commission_rate || 0;
        row.is_partner = !!row.is_partner;
        row.updated_at = now;
        return write('services', row, before);
      });
    },

    listSubmissions: function (q) {
      q = q || {};
      return adminGate().then(function () { return t('facility_submissions'); }).then(function (rows) {
        return rows.filter(function (s) { return !q.status || s.status === q.status; })
          .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
      });
    },

    /**
     * admin_review_submission(id, status, note) → {id, kind, status, facility_id, reviewed_at}.
     * Approving: 'new' → pending community facility (route inferred ≤ 20 km); 'closed' → verified facility back to pending;
     * 'correction' → note appended to the facility.
     */
    reviewSubmission: function (id, status, note) {
      if (['approved', 'rejected', 'pending'].indexOf(status) < 0) return Promise.reject(err('invalid_status', 'invalid_status'));
      var reviewNote = cleanText(note, 500);
      return adminGate().then(function () { return Promise.all([store.get('facility_submissions', id), t('route_edges'), t('routes')]); }).then(function (r) {
        var before = r[0];
        if (!before) throw err('submission_not_found', 'submission_not_found');
        var p = before.payload || {};
        var facId = before.facility_id || null;
        var job = Promise.resolve();
        if (status === 'approved' && before.status !== 'approved') {
          if (before.kind === 'new') {
            // re-approval of a reopened report reuses the facility created the first time (recreated under the same id if deleted)
            job = (facId ? store.get('facilities', facId) : Promise.resolve(null)).then(function (existing) {
              if (existing) return null;
              var lat = !isBlank(before.lat) ? +before.lat : (!isBlank(p.lat) ? +p.lat : null);
              var lng = !isBlank(before.lng) ? +before.lng : (!isBlank(p.lng) ? +p.lng : null);
              var route = r[2].some(function (x) { return x.id === p.route_id; }) ? p.route_id : null;
              if (!route && lat !== null) {
                var best = null;
                r[1].forEach(function (e) {
                  var n = NC.routing.nearestOnLine(e.geometry || [], { lat: lat, lng: lng });
                  if (n && n.distance_km <= 20 && (!best || n.distance_km < best.d)) best = { d: n.distance_km, route: e.route_id };
                });
                route = best ? best.route : null;
              }
              return admin.upsertFacility({
                id: facId || undefined,
                route_id: route, name: cleanText(p.name, 160) || 'Điểm y tế cộng đồng đề xuất',
                type: FACILITY_TYPES.indexOf(p.type) >= 0 ? p.type : null, address: cleanText(p.address, 300),
                lat: lat, lng: lng, phone: cleanText(p.phone, 32), open_hours: cleanText(p.open_hours, 120),
                status: 'pending', source: 'community', is_demo: true,
                notes: ['Từ đóng góp cộng đồng #' + before.id, cleanText(p.note, 500), reviewNote].filter(Boolean).join('\n')
              }).then(function (fac) { facId = fac.id; });
            });
          } else if ((before.kind === 'closed' || before.kind === 'correction') && facId) {
            job = store.get('facilities', facId).then(function (f) {
              if (!f) return null;
              var line = before.kind === 'closed'
                ? 'Báo đóng cửa (#' + before.id + ')' + (reviewNote ? ': ' + reviewNote : '')
                : 'Đề xuất sửa (#' + before.id + '): ' + (cleanText(p.note, 500) || JSON.stringify(p));
              var seen = String(f.notes || '').indexOf('(#' + before.id + ')') >= 0; // re-approval: no duplicate note
              var patch = { id: f.id, notes: seen ? f.notes : [f.notes, line].filter(Boolean).join('\n') };
              if (before.kind === 'closed' && f.status === 'verified') patch.status = 'pending';
              return admin.upsertFacility(patch);
            });
          }
        }
        return job.then(function () {
          var row = Object.assign({}, before, { status: status, review_note: reviewNote, reviewed_by: null, reviewed_at: nowIso(), facility_id: facId });
          return write('facility_submissions', row, before);
        }).then(function (saved) {
          return { id: saved.id, kind: saved.kind, status: saved.status, facility_id: saved.facility_id, reviewed_at: saved.reviewed_at };
        });
      });
    },

    listSamples: function (q) {
      q = q || {};
      return adminGate().then(function () { return t('signal_samples'); }).then(function (rows) {
        var out = rows.filter(function (s) {
          return (!q.route_id || s.route_id === q.route_id) && (!q.carrier || s.carrier === q.carrier) && (!q.status || s.status === q.status) &&
            (!q.source || s.source === q.source);
        }).sort(function (a, b) { return String(b.measured_at).localeCompare(String(a.measured_at)) || (b.id - a.id); });
        return out.slice(0, q.limit || 5000);
      });
    },

    /** admin_review_samples(ids, status) → number of rows whose status changed; one aggregated audit row per call. */
    reviewSamples: function (ids, status) {
      if (['approved', 'pending', 'rejected'].indexOf(status) < 0) return Promise.reject(err('invalid_status', 'Invalid status'));
      var changed = [];
      return adminGate().then(function () {
        return (ids || []).reduce(function (p, id) {
          return p.then(function () {
            return store.get('signal_samples', +id).then(function (row) {
              if (!row || row.status === status) return null;
              row.status = status;
              changed.push(row.id);
              return store.put('signal_samples', row).then(function (saved) { notify('signal_samples', 'UPDATE', saved); });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        if (!changed.length) return null;
        changed.sort(function (a, b) { return a - b; });
        return audit('status', 'signal_samples', 'batch', { count: changed.length, status: status, ids: changed.slice(0, 50), truncated: changed.length > 50 });
      }).then(function () { return changed.length; });
    },

    listSegments: function (q) {
      q = q || {};
      return adminGate().then(function () { return t('signal_segments'); }).then(function (rows) {
        return rows.filter(function (s) { return (!q.route_id || s.route_id === q.route_id) && (!q.carrier || s.carrier === q.carrier); })
          .sort(function (a, b) { return String(a.edge_id).localeCompare(String(b.edge_id)) || (a.seq - b.seq); });
      });
    },

    listAccuracy: function () {
      return adminGate().then(function () { return t('route_accuracy'); }).then(function (rows) {
        return rows.map(function (r) { var o = Object.assign({}, r); delete o.id; return o; })
          .sort(function (a, b) { return a.route_id.localeCompare(b.route_id) || a.carrier.localeCompare(b.carrier); });
      });
    },

    /** Rows shaped like v_buddy_sessions (+ lat/lng, overdue_by_min, event_count, last_event_kind). */
    listBuddySessions: function (q) {
      q = q || {};
      return adminGate().then(function () { return Promise.all([t('buddy_sessions'), t('checkin_events')]); }).then(function (r) {
        var evBy = {};
        r[1].forEach(function (e) { (evBy[e.session_id] = evBy[e.session_id] || []).push(e); });
        var now = Date.now();
        return r[0].filter(function (s) { return !q.status || s.status === q.status; }).map(function (s) {
          var evs = (evBy[s.id] || []).sort(function (a, b) { return String(a.client_ts || a.received_at).localeCompare(String(b.client_ts || b.received_at)); });
          var o = Object.assign({}, s);
          o.lat = s.last_lat === undefined ? null : s.last_lat;
          o.lng = s.last_lng === undefined ? null : s.last_lng;
          o.overdue_by_min = s.status !== 'closed' && s.next_due_at && now > Date.parse(s.next_due_at) ? Math.floor((now - Date.parse(s.next_due_at)) / 60000) : 0;
          o.event_count = evs.length;
          o.last_event_kind = evs.length ? evs[evs.length - 1].kind : null;
          o.sos_at = sosSince(s, evs);
          // rows seeded before alert_reason existed: derive it like the SQL backfill (SOS since the last check-in)
          o.alert_reason = s.alert_reason === undefined && o.sos_at && reasonOf(s) ? 'sos' : reasonOf(s);
          return o;
        }).sort(function (a, b) { return String(b.started_at).localeCompare(String(a.started_at)); });
      });
    },

    /** Events of a session, chronological (oldest first). */
    listBuddyEvents: function (sessionId) {
      return adminGate().then(function () { return t('checkin_events'); }).then(function (rows) {
        return rows.filter(function (e) { return e.session_id === sessionId; })
          .sort(function (a, b) { return String(a.client_ts || a.received_at).localeCompare(String(b.client_ts || b.received_at)); });
      });
    },

    /**
     * Manual alert = POST deadman-alert {session_id} as admin (force): sent for any non-closed session with a recipient
     * e-mail, never rate-limited, attributed to the admin. Simulated delivery. Returns the edge-function summary
     * {ok, mode, type, processed, sent, failed, dry_run, error?, results:[{session_id, status:'sent'|'failed', provider, reason, id?, error?}]}
     * (ok = false and error set when the e-mail failed; processed = 0 when nothing could be sent).
     */
    triggerAlert: function (sessionId) {
      return adminGate().then(function () { return store.get('buddy_sessions', sessionId); }).then(function (s) {
        var summary = { ok: true, mode: 'admin', type: 'overdue', processed: 0, sent: 0, failed: 0, dry_run: true, provider: 'simulated', results: [] };
        if (!s || s.status === 'closed' || !s.recipient_email) return summary;
        return sendAlert(s, 'manual').then(function (r) {
          summary.processed = 1;
          summary.results.push(r);
          if (r.status === 'sent') summary.sent = 1;
          else { summary.failed = 1; summary.ok = false; summary.error = r.error || 'send_failed'; }
          return summary;
        });
      });
    },

    /** admin_resolve_session(id, note): operator confirmed the traveller is safe → closed + event 'resolved' (+ all-clear). */
    resolveSession: function (id, note) {
      return adminGate().then(function () { return store.get('buddy_sessions', id); }).then(function (s) {
        if (!s) throw err('session_not_found', 'session_not_found');
        var was = s.status;
        if (was === 'closed') return Object.assign(sessionView(s), { previous_status: was });
        var before = clone(s);
        var at = nowIso();
        return insertEvent({ session_id: s.id, device_id: s.device_id, kind: 'resolved', client_ts: at, note: cleanText(note, 500),
          meta: { by: 'admin', admin: actorLabel(), previous_status: was } }).then(function () {
          s.status = 'closed'; s.closed_at = at;
          return saveSession(s, before, actorLabel());
        }).then(function () { return was === 'alerted' ? allClearAlert(s) : null; })
          .then(function () { return Object.assign(sessionView(s), { previous_status: was }); });
      });
    },

    /** data_packs rows without payload, newest first. */
    listPacks: function () {
      return adminGate().then(function () { return t('data_packs'); }).then(function (rows) {
        return rows.map(function (p) { var o = Object.assign({}, p); delete o.payload; return o; })
          .sort(function (a, b) { return String(b.published_at).localeCompare(String(a.published_at)) || (b.version - a.version); });
      });
    },

    /**
     * admin_publish_pack(route, carrier, notes, force) → {route_id, carrier, version, size_bytes, checksum, published_at, unchanged};
     * previous version stops being current. When the live content equals the current pack (facility freshness aside)
     * nothing is published and the current version comes back with unchanged: true — unless opts.force (or true).
     * @param {{force?:boolean}|boolean} [opts]
     */
    publishPack: function (routeId, carrier, notes, opts) {
      var res = null;
      var force = opts === true || !!(opts && opts.force);
      return adminGate().then(function () { return Promise.all([buildLive(routeId, carrier, false), t('data_packs')]); }).then(function (r) {
        var rows = r[1].filter(function (p) { return p.route_id === routeId && p.carrier === carrier; });
        var cur = rows.filter(function (p) { return p.is_current; }).sort(function (a, b) { return b.version - a.version; })[0];
        if (!force && cur && cur.payload && packContentKey(cur.payload) === packContentKey(r[0])) {
          return { route_id: routeId, carrier: carrier, version: cur.version, size_bytes: cur.size_bytes, checksum: cur.checksum,
            published_at: cur.published_at, unchanged: true };
        }
        var version = rows.reduce(function (m, p) { return Math.max(m, p.version); }, 0) + 1;
        var pack = r[0];
        pack.version = version;
        pack.published_at = nowIso();
        finalizeSize(pack);
        var text = JSON.stringify(pack);
        return Promise.all(rows.filter(function (p) { return p.is_current; }).map(function (p) {
          p.is_current = false;
          p.payload = null;
          return store.put('data_packs', p).then(function (saved) { notify('data_packs', 'UPDATE', saved); });
        })).then(function () { return sha256Hex(text); }).then(function (sum) {
          var sess = adminSession();
          return write('data_packs', {
            route_id: routeId, carrier: carrier, version: version, published_at: pack.published_at, published_by: sess && sess.user.id || null,
            notes: notes || null, size_bytes: pack.size_bytes, checksum: sum, payload: pack, is_current: true
          }, null);
        }).then(function (saved) {
          res = { route_id: routeId, carrier: carrier, version: version, size_bytes: pack.size_bytes, checksum: saved.checksum,
            published_at: pack.published_at, unchanged: false };
          return res;
        });
      });
    },

    /**
     * admin_pack_changes(route?, carrier?) → per route × carrier, what the next publish would change (closures and
     * deletions included): [{route_id, carrier, version, published_at, published, changed, count,
     * facilities:{added:[{id,name,type}], removed:[{id,name,type,reason:'deleted'|'pending'|'rejected'|'moved'}],
     * updated:[{id,name,type,fields}]}, services:{…, reason 'deleted'|'inactive'|'moved'}, other:[section]}]
     */
    packChanges: function (routeId, carrier) {
      return adminGate().then(function () {
        return Promise.all([packSource(), t('data_packs'), carrierList()]);
      }).then(function (r) {
        var src = r[0], packs = r[1], carriers = r[2];
        var out = [];
        src.routes.filter(function (x) { return x.is_active !== false && (!routeId || x.id === routeId); }).sort(byRouteSort).forEach(function (rt) {
          carriers.filter(function (c) { return !carrier || c === carrier; }).forEach(function (c) {
            var cur = packs.filter(function (p) { return p.route_id === rt.id && p.carrier === c && p.is_current; })
              .sort(function (a, b) { return b.version - a.version; })[0] || null;
            var pub = cur && cur.payload ? cur.payload : null;
            var live = buildPack(src, rt.id, c, { version: cur ? cur.version : 0, published_at: cur ? cur.published_at : nowIso() });
            var fac = itemDiff(pub && pub.facilities, live.facilities, src.facilities, true);
            var svc = itemDiff(pub && pub.services, live.services, src.services, false);
            var other = pub ? ['schema', 'route', 'nodes', 'edges', 'segments', 'model_version', 'accuracy', 'holdout_n'].filter(function (k) {
              return canon(pub[k]) !== canon(live[k]);
            }).sort() : [];
            var count = fac.added.length + fac.removed.length + fac.updated.length + svc.added.length + svc.removed.length + svc.updated.length + other.length;
            out.push({
              route_id: rt.id, carrier: c, version: cur ? cur.version : 0, published_at: cur ? cur.published_at : null, published: !!pub,
              changed: !pub || packContentKey(pub) !== packContentKey(live), count: count, facilities: fac, services: svc, other: other
            });
          });
        });
        return out;
      });
    },

    listContentReleases: function () {
      return adminGate().then(function () { return t('content_releases'); }).then(function (rows) {
        return rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)) || (b.id - a.id); });
      });
    },

    upsertContentRelease: function (r) {
      if (!r || isBlank(r.version)) return Promise.reject(err('incomplete', 'Version is required', { missing: ['version'] }));
      return adminGate().then(function () { return t('content_releases'); }).then(function (rows) {
        var before = r.id ? rows.filter(function (x) { return x.id === +r.id; })[0] || null : null;
        if (rows.some(function (x) { return x.version === r.version && (!before || x.id !== before.id); })) throw err('duplicate_version', 'Version already exists');
        var row = Object.assign({}, before || { kind: 'medical', status: 'draft', created_at: nowIso() },
          pick(r, ['version', 'kind', 'status', 'notes', 'reviewer_round1', 'approver', 'approved_at']));
        if (before) row.id = before.id;
        if (['draft', 'in_review', 'approved', 'retracted'].indexOf(row.status) < 0) throw err('invalid_status', 'Invalid status');
        if (row.status === 'approved') {
          var missing = ['approver', 'approved_at'].filter(function (k) { return isBlank(row[k]); });
          if (missing.length) throw err('incomplete', 'Approved releases need an approver and date', { missing: missing });
        }
        return write('content_releases', row, before);
      });
    },

    /** admin_approve_content(id, approver) — round-2 medical sign-off. */
    approveContentRelease: function (id, approver) {
      if (isBlank(approver)) return Promise.reject(err('approver_required', 'Round-2 approval must name the medical advisor.', { missing: ['approver'] }));
      return adminGate().then(function () { return store.get('content_releases', +id); }).then(function (before) {
        if (!before) throw err('content_release_not_found', 'content_release_not_found');
        return write('content_releases', Object.assign({}, before, { status: 'approved', approver: approver, approved_at: nowIso() }), before);
      });
    },

    audit: function (q) {
      var limit = (q && q.limit) || 100;
      return adminGate().then(function () { return t('audit_log'); }).then(function (rows) {
        return rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)) || (b.id - a.id); }).slice(0, limit);
      });
    },

    /** Realtime feed: fn({table, type, row}) for every server change (any tab). */
    subscribe: function (fn) {
      init();
      if (!NC.bus || !NC.bus.on) return function () { };
      return NC.bus.on('server:change', fn);
    },

    /** Wipe and re-seed the mock server (local only). */
    resetDemo: function () {
      return init().then(function () {
        return withSeedLock(function () { return ensureSeed(true); });
      }).then(function () { notify('*', 'RESET', null); return true; });
    }
  };

  /** Admin role check (is_admin()). */
  local.is_admin = function () { return Promise.resolve(!!adminSession()); };

  /** Lightweight connectivity probe (used by NC.data for parity with the Supabase backend). */
  local.ping = function () { return gate(true).then(function () { return true; }); };

  /** Internal access for tests / harness (not part of the contract). */
  local._debug = {
    all: function (name) { return init().then(function () { return t(name); }); },
    put: function (name, row) { return init().then(function () { return store.put(name, row); }); },
    /** Alert ledger rows (meta 'alert_ledger:*') and the seed upgrade step of init(), for tests. */
    ledger: function () { return init().then(function () { return ledgerRows(); }); },
    upgradeSeed: function () { return init().then(function () { return upgradeSeed(root().NC_SEED); }); },
    /** Stored Web Push rows (round 2 R6): {subs:[…], schedules:[…]}. */
    push: function () { return init().then(function () { return Promise.all([pushRows(PUSH_SUB), pushRows(PUSH_SCHED)]); }).then(function (r) { return { subs: r[0].map(function (x) { return x.value; }), schedules: r[1].map(function (x) { return x.value; }) }; }); },
    tabId: TAB_ID
  };
})(window.NC = window.NC || {});
