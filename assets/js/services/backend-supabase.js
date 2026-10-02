/*
 * backend-supabase.js — NC.backend.supabase: real server tier via supabase-js v2 UMD (owner: P1 data).
 * Same method names/semantics as NC.backend.local: RPCs list_routes, get_data_pack, build_data_pack, get_content_release,
 * nearest_facilities, register_device, sync_device_ops (anon), admin.* (auth.signInWithPassword + RLS-protected
 * tables/views + admin_* RPCs), realtime via postgres_changes → NC.bus 'server:change', manual alert via Edge Function.
 * window.supabase (supabase-js UMD, loaded on demand by NC.data) is only read when the client is created, never at load.
 * Wave 3: admin.packChanges (admin_pack_changes), publishPack(…, {force}) → {unchanged}, triggerAlert summary with per-
 * session results (failed e-mails are failures), realtime on data_packs/content_releases/services/audit_log.
 */
(function (NC) {
  'use strict';

  var backend = NC.backend = NC.backend || {};
  var shared = backend.shared || {};
  var err = shared.err || function (code, msg, extra) { var e = new Error(msg || code); e.code = code; if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); return e; };
  var parsePoint = shared.parsePoint || function () { return null; };

  var REQUEST_TIMEOUT_MS = 15000;
  var PAGE = 1000; // PostgREST default max-rows on Supabase
  /* Same tables as the supabase_realtime publication (migrations 0900 + 20260928000100). */
  var REALTIME_TABLES = ['buddy_sessions', 'checkin_events', 'facility_submissions', 'facilities', 'signal_samples',
    'data_packs', 'content_releases', 'services', 'audit_log'];
  /* Exception texts raised by the SQL functions (most specific first). */
  var KNOWN_CODES = ['unauthorized_device', 'recipient_email_required', 'recipient_phone_required', 'recipient_phone_invalid',
    'recipient_phone_not_mobile', 'recipient_email_invalid', 'rate_limited', 'device_erased', 'route_not_found', 'carrier_not_found',
    'submission_not_found', 'content_release_not_found', 'session_not_found', 'session_forbidden', 'session_conflict', 'no_active_session',
    'approver_required', 'invalid_coordinates', 'invalid_date', 'invalid_status', 'invalid_kind', 'invalid_type', 'unknown_op', 'incomplete',
    'invalid_state', 'invalid_push_endpoint', 'invalid_push_keys', 'invalid_push_schedule', 'too_many_items',
    'forbidden'];

  function cfg() { return (typeof window !== 'undefined' && window.NC_CONFIG) || {}; }

  var client = null;

  /* fetch with timeout (supabase-js has none by default). */
  function timeoutFetch(input, init) {
    if (typeof AbortController === 'undefined') return fetch(input, init);
    var ctrl = new AbortController();
    var opts = Object.assign({}, init || {});
    if (opts.signal) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    opts.signal = ctrl.signal;
    var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(input, opts).then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  }

  /** True when a Supabase project is configured (URL + anon key), whether or not supabase-js is loaded yet. */
  function configured() {
    var c = cfg();
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  }

  /** True when config + UMD library allow Supabase mode. */
  function available() {
    return configured() && typeof window !== 'undefined' && !!window.supabase && typeof window.supabase.createClient === 'function';
  }

  /**
   * Create the client once. Throws err('no_client') when not configured.
   * @returns {Object} SupabaseClient
   */
  function sb() {
    if (client) return client;
    if (!available()) throw err('no_client', 'Supabase is not configured');
    var c = cfg();
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: { persistSession: true },
      global: { fetch: timeoutFetch }
    });
    return client;
  }

  /* Normalise PostgREST / network errors to err(code) with the SQL exception text kept in .message. */
  function normErr(e) {
    if (!e) return err('unknown', 'Unknown error');
    if (e.code && KNOWN_CODES.indexOf(e.code) >= 0 && e instanceof Error) return e;
    var msg = String(e.message || e.error_description || e.msg || e);
    var hay = (msg + ' ' + (e.details || '') + ' ' + (e.hint || '')).toLowerCase();
    var code = null;
    for (var i = 0; i < KNOWN_CODES.length; i++) { if (hay.indexOf(KNOWN_CODES[i]) >= 0) { code = KNOWN_CODES[i]; break; } }
    // same extra field as the local backend: a verified facility outside Vietnam
    if (code === 'invalid_coordinates' && /outside_vietnam/.test(String(e.details || ''))) {
      return err(code, msg, { details: e.details || null, pgcode: e.code || null, reason: 'outside_vietnam' });
    }
    if (!code) {
      if (e.code === '23514') code = 'check_violation';
      else if (e.code === '23505') code = 'duplicate';
      else if (e.code === '42501' || e.code === 'PGRST301' || /jwt|permission denied|not authorized/.test(hay)) code = 'forbidden';
      else if (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202') code = 'missing_relation';
      else if (/failed to fetch|networkerror|network request failed|load failed|aborted|abort|timeout|fetch/.test(hay) || e.name === 'AbortError' || e.name === 'TypeError') code = 'network';
      else if (/invalid api key|no api key/.test(hay)) code = 'auth';
      else code = e.code || 'server';
    }
    return err(code, msg, { details: e.details || null, pgcode: e.code || null });
  }

  function unwrap(res) {
    if (res && res.error) throw normErr(res.error);
    return res ? res.data : null;
  }

  function rpc(name, params) {
    var c;
    try { c = sb(); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(c.rpc(name, params || {})).then(unwrap, function (e) { throw normErr(e); });
  }

  function q(p) { return Promise.resolve(p).then(unwrap, function (e) { throw normErr(e); }); }

  /* Page through a query (build() must return a fresh builder each call). */
  function fetchAll(build, limit) {
    var max = limit || 100000;
    var out = [];
    function next(from) {
      var to = Math.min(from + PAGE, max) - 1;
      return q(build().range(from, to)).then(function (rows) {
        rows = rows || [];
        out = out.concat(rows);
        if (rows.length < to - from + 1 || out.length >= max) return out;
        return next(from + PAGE);
      });
    }
    return next(0);
  }

  /* Add lat/lng from a geography column when a view with lat/lng is not available. */
  function withLatLng(rows) {
    return (rows || []).map(function (r) {
      if ((r.lat === undefined || r.lat === null) && r.geom) {
        var p = parsePoint(r.geom);
        if (p) { r.lat = p.lat; r.lng = p.lng; }
      }
      return r;
    });
  }

  /* Query a helper view; fall back to the base table (+ EWKB parsing) if the view is missing. */
  function viewOrTable(view, table, apply, limit) {
    return fetchAll(function () { return apply(sb().from(view).select('*')); }, limit).catch(function (e) {
      if (e.code !== 'missing_relation') throw e;
      return fetchAll(function () { return apply(sb().from(table).select('*')); }, limit);
    }).then(withLatLng);
  }

  function blank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

  /* ================================================================== device / public RPCs */

  var api = backend.supabase = {
    mode: 'supabase',
    available: available,
    configured: configured,
    client: function () { return sb(); },

    /** Validate config + create the client (throws when unavailable). */
    init: function () { sb(); return Promise.resolve(); },

    /** Cheap probe used at start-up to detect a wrong URL/key. */
    ping: function () { return rpc('get_content_release'); },

    list_routes: function () { return rpc('list_routes'); },
    get_data_pack: function (routeId, carrier) { return rpc('get_data_pack', { p_route_id: routeId, p_carrier: carrier }); },
    build_data_pack: function (routeId, carrier) { return rpc('build_data_pack', { p_route_id: routeId, p_carrier: carrier }); },
    get_content_release: function () { return rpc('get_content_release'); },
    nearest_facilities: function (lat, lng, limit, types) {
      return rpc('nearest_facilities', { p_lat: lat, p_lng: lng, p_limit: limit || 5, p_types: types && types.length ? types : null });
    },
    register_device: function (carrier, appVersion) { return rpc('register_device', { p_carrier: carrier, p_app_version: appVersion }); },
    sync_device_ops: function (deviceId, secret, ops) {
      return rpc('sync_device_ops', { p_device_id: deviceId, p_secret: secret, p_ops: ops || [] });
    },
    /**
     * Fire-and-forget sync_device_ops that outlives the page (fetch keepalive; round 2 R6: the 'paused' heartbeat on
     * hide / pagehide). The same ops stay queued in the outbox; the op id makes the second delivery a 'duplicate'.
     * @returns {boolean} true when the request was handed to the browser
     */
    beacon: function (deviceId, secret, ops) {
      var c = cfg();
      if (!configured() || typeof fetch !== 'function') return false;
      var key = String(c.supabaseAnonKey);
      var headers = { 'Content-Type': 'application/json', apikey: key };
      if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key;   // legacy anon JWT (publishable keys: apikey only)
      try {
        fetch(String(c.supabaseUrl).replace(/\/+$/, '') + '/rest/v1/rpc/sync_device_ops', {
          method: 'POST', keepalive: true, headers: headers, credentials: 'omit',
          body: JSON.stringify({ p_device_id: deviceId, p_secret: secret, p_ops: ops || [] })
        }).catch(function () { /* the queued copy is sent by the next flush */ });
        return true;
      } catch (e) { return false; }
    },
    is_admin: function () { return rpc('is_admin'); }
  };

  /* ================================================================== admin */

  function pick(src, keys) { var o = {}; keys.forEach(function (k) { if (src[k] !== undefined) o[k] = src[k]; }); return o; }

  /* 'incomplete' (SQLSTATE 23514, detail = JSON array of missing fields) → err('incomplete', {missing}). */
  function incompleteErr(e) {
    if (!e || (e.code !== 'incomplete' && e.code !== 'check_violation')) return e;
    var missing = [];
    try { missing = JSON.parse(e.details || '[]'); } catch (x) { missing = []; }
    var out = [];
    (Array.isArray(missing) ? missing : []).forEach(function (m) { if (m === 'lat_lng') out.push('lat', 'lng'); else out.push(m); });
    return err('incomplete', e.message, { missing: out, details: e.details || null });
  }

  function accessToken() {
    return sb().auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      return s ? s.access_token : null;
    });
  }

  /* Heavy / sensitive columns never travel on the bus (same as lightRow() in backend-local.js). */
  function lightRow(table, row) {
    if (!row) return row;
    if (table === 'data_packs') delete row.payload;
    if (table === 'buddy_sessions') delete row.public_medical;
    if (table === 'devices') delete row.secret_hash;
    return row;
  }

  /*
   * Normalised deadman-alert summary: {ok, mode, type, processed, sent, failed, dry_run, error?, results:[{session_id,
   * status:'sent'|'failed', provider, reason, id, error}]} — ok is false and error set whenever an e-mail failed.
   */
  function alertSummary(body) {
    var b = body && typeof body === 'object' ? body : {};
    var results = (Array.isArray(b.results) ? b.results : []).map(function (r) {
      return { session_id: r.session_id || null, status: r.status === 'sent' ? 'sent' : 'failed', provider: r.provider || null,
        reason: r.reason || null, id: r.id || null, error: r.error || null };
    });
    var sent = typeof b.sent === 'number' ? b.sent : results.filter(function (r) { return r.status === 'sent'; }).length;
    var failed = typeof b.failed === 'number' ? b.failed : results.filter(function (r) { return r.status === 'failed'; }).length;
    var out = {
      ok: failed === 0 && b.ok !== false, mode: b.mode || 'admin', type: b.type || 'overdue',
      processed: typeof b.processed === 'number' ? b.processed : results.length, sent: sent, failed: failed, dry_run: !!b.dry_run,
      results: results
    };
    if (failed || b.ok === false) {
      var first = results.filter(function (r) { return r.status === 'failed'; })[0];
      out.error = b.error || (first && first.error) || 'send_failed';
    }
    return out;
  }

  /* One realtime channel shared by all subscribers; every change is emitted once on NC.bus 'server:change'. */
  var channel = null;
  var subscribers = 0;
  function ensureChannel() {
    if (channel) return;
    var ch = sb().channel('nc-admin-realtime');
    REALTIME_TABLES.forEach(function (tbl) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, function (payload) {
        var row = payload.eventType === 'DELETE' ? payload.old : payload.new;
        if (row) { lightRow(payload.table || tbl, row); withLatLng([row]); }
        var msg = { table: payload.table || tbl, type: payload.eventType, row: row };
        if (NC.bus && NC.bus.emit) NC.bus.emit('server:change', msg);
      });
    });
    ch.subscribe();
    channel = ch;
  }

  var admin = api.admin = {
    /** auth.signInWithPassword → {user:{email,id}, role} (role null when not in admin_users). */
    signIn: function (email, password) {
      return Promise.resolve(sb().auth.signInWithPassword({ email: email, password: password })).then(function (res) {
        if (res.error) throw err('auth', res.error.message);
        return admin.session();
      });
    },
    signOut: function () { return Promise.resolve(sb().auth.signOut()).then(function () { return true; }); },
    session: function () {
      return Promise.resolve(sb().auth.getSession()).then(function (res) {
        var s = res && res.data && res.data.session;
        if (!s || !s.user) return null;
        return q(sb().from('admin_users').select('role, display_name').eq('user_id', s.user.id).maybeSingle())
          .catch(function () { return null; })
          .then(function (row) {
            return { user: { email: s.user.email, id: s.user.id, display_name: row ? row.display_name : null }, role: row ? row.role : null };
          });
      });
    },
    enterDemo: function () { return Promise.reject(err('not_supported', 'Demo admin is only available in local mode')); },

    kpis: function () { return rpc('admin_kpis'); },

    listFacilities: function (f) {
      f = f || {};
      return fetchAll(function () {
        var b = sb().from('v_facilities').select('*');
        if (f.route_id) b = b.eq('route_id', f.route_id);
        if (f.status) b = b.eq('status', f.status);
        if (f.type) b = b.eq('type', f.type);
        if (f.stale === true) { b = b.eq('is_stale', true); if (!f.status) b = b.eq('status', 'verified'); }
        if (f.stale === false) b = b.eq('is_stale', false);
        if (f.q) {
          var needle = String(f.q).replace(/[,()*%\\]/g, ' ').trim();
          if (needle) b = b.or('name.ilike.*' + needle + '*,address.ilike.*' + needle + '*,id.ilike.*' + needle + '*');
        }
        return b.order('route_id', { ascending: true }).order('name', { ascending: true });
      });
    },

    /**
     * admin_upsert_facility(p_row) — server validates completeness; errors map to {code:'incomplete', missing:[...]}
     * with 'lat_lng' expanded to 'lat','lng' (same names as the local backend).
     */
    upsertFacility: function (f) {
      if (!f) return Promise.reject(err('invalid', 'Missing facility'));
      return rpc('admin_upsert_facility', { p_row: f }).catch(function (e) { throw incompleteErr(e); });
    },

    setFacilityStatus: function (id, status) {
      return rpc('admin_upsert_facility', { p_row: { id: id, status: status } }).catch(function (e) { throw incompleteErr(e); });
    },

    deleteFacility: function (id) { return q(sb().from('facilities').delete().eq('id', id)).then(function () { return true; }); },

    listServices: function (f) {
      f = f || {};
      return viewOrTable('v_services', 'services', function (b) {
        if (f.route_id) b = b.eq('route_id', f.route_id);
        if (f.type) b = b.eq('type', f.type);
        return b.order('route_id', { ascending: true }).order('name', { ascending: true });
      });
    },

    upsertService: function (s) {
      if (!s) return Promise.reject(err('invalid', 'Missing service'));
      if (blank(s.name) && !s.id) return Promise.reject(err('incomplete', 'Service name is required', { missing: ['name'] }));
      return rpc('admin_upsert_service', { p_row: s });
    },

    listSubmissions: function (f) {
      f = f || {};
      return fetchAll(function () {
        var b = sb().from('facility_submissions').select('*');
        if (f.status) b = b.eq('status', f.status);
        return b.order('created_at', { ascending: false });
      });
    },

    reviewSubmission: function (id, status, note) { return rpc('admin_review_submission', { p_id: id, p_status: status, p_note: note || null }); },

    listSamples: function (f) {
      f = f || {};
      return viewOrTable('v_signal_samples', 'signal_samples', function (b) {
        if (f.route_id) b = b.eq('route_id', f.route_id);
        if (f.carrier) b = b.eq('carrier', f.carrier);
        if (f.status) b = b.eq('status', f.status);
        if (f.source) b = b.eq('source', f.source);
        return b.order('measured_at', { ascending: false }).order('id', { ascending: false });
      }, f.limit || 5000);
    },

    reviewSamples: function (ids, status) { return rpc('admin_review_samples', { p_ids: (ids || []).map(Number), p_status: status }); },

    listSegments: function (f) {
      f = f || {};
      return fetchAll(function () {
        var b = sb().from('signal_segments').select('*');
        if (f.route_id) b = b.eq('route_id', f.route_id);
        if (f.carrier) b = b.eq('carrier', f.carrier);
        return b.order('edge_id', { ascending: true }).order('seq', { ascending: true });
      });
    },

    listAccuracy: function () {
      return q(sb().from('route_accuracy').select('*').order('route_id', { ascending: true }).order('carrier', { ascending: true }));
    },

    listBuddySessions: function (f) {
      f = f || {};
      return fetchAll(function () {
        var b = sb().from('v_buddy_sessions').select('*');
        if (f.status) b = b.eq('status', f.status);
        return b.order('started_at', { ascending: false });
      });
    },

    listBuddyEvents: function (sessionId) {
      return fetchAll(function () {
        return sb().from('checkin_events').select('*').eq('session_id', sessionId)
          .order('client_ts', { ascending: true, nullsFirst: false }).order('received_at', { ascending: true });
      });
    },

    /**
     * POST {functionsUrl}/deadman-alert {session_id} with the admin JWT (manual: never rate-limited, audited as the
     * admin). Resolves with alertSummary() — a failed e-mail gives ok:false, failed:1, error (e.g. 'RESEND_API_KEY is not set').
     */
    triggerAlert: function (sessionId) {
      var c = cfg();
      var base = (c.functionsUrl || (String(c.supabaseUrl || '').replace(/\/+$/, '') + '/functions/v1')).replace(/\/+$/, '');
      return accessToken().then(function (token) {
        if (!token) throw err('forbidden', 'Admin sign-in required');
        return timeoutFetch(base + '/deadman-alert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: c.supabaseAnonKey },
          body: JSON.stringify({ session_id: sessionId })
        });
      }).then(function (res) {
        return res.text().then(function (txt) {
          var body = null;
          try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = { raw: txt }; }
          // a summary with per-session results is an outcome (sent or failed), whatever the HTTP status
          if (body && Array.isArray(body.results)) return alertSummary(body);
          if (!res.ok) throw err(res.status === 401 || res.status === 403 ? 'forbidden' : 'server', (body && (body.error || body.message)) || ('HTTP ' + res.status), { status: res.status, body: body });
          return alertSummary(body || { ok: true });
        });
      }, function (e) { throw normErr(e); });
    },

    resolveSession: function (id, note) { return rpc('admin_resolve_session', { p_id: id, p_note: note || null }); },

    listPacks: function () {
      return fetchAll(function () {
        return sb().from('data_packs').select('id,route_id,carrier,version,published_at,published_by,notes,size_bytes,checksum,is_current')
          .order('published_at', { ascending: false }).order('version', { ascending: false });
      });
    },

    /**
     * admin_publish_pack → {route_id, carrier, version, size_bytes, checksum, published_at, unchanged}; unchanged:true (same
     * version) when nothing changed since the current pack, unless opts.force (or true).
     */
    publishPack: function (routeId, carrier, notes, opts) {
      var params = { p_route_id: routeId, p_carrier: carrier, p_notes: notes || null };
      if (opts === true || (opts && opts.force)) params.p_force = true;
      return rpc('admin_publish_pack', params);
    },

    /** admin_pack_changes(route?, carrier?) → [{route_id, carrier, version, published, changed, count, facilities, services, other}]. */
    packChanges: function (routeId, carrier) {
      return rpc('admin_pack_changes', { p_route_id: routeId || null, p_carrier: carrier || null });
    },

    listContentReleases: function () {
      return q(sb().from('content_releases').select('*').order('created_at', { ascending: false }));
    },

    upsertContentRelease: function (r) {
      if (!r || blank(r.version)) return Promise.reject(err('incomplete', 'Version is required', { missing: ['version'] }));
      var row = pick(r, ['version', 'kind', 'status', 'notes', 'reviewer_round1', 'approver', 'approved_at']);
      if (row.status === 'approved') {
        var missing = ['approver', 'approved_at'].filter(function (k) { return blank(row[k]); });
        if (missing.length) return Promise.reject(err('incomplete', 'Approved releases need an approver and date', { missing: missing }));
      }
      var job = r.id ? sb().from('content_releases').update(row).eq('id', r.id).select('*').single()
        : sb().from('content_releases').insert(row).select('*').single();
      return q(job).catch(function (e) {
        if (e.code === 'duplicate') throw err('duplicate_version', 'Version already exists');
        throw e;
      });
    },

    approveContentRelease: function (id, approver) { return rpc('admin_approve_content', { p_id: +id, p_approver: approver }); },

    audit: function (f) {
      var limit = (f && f.limit) || 100;
      return fetchAll(function () { return sb().from('audit_log').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }); }, limit);
    },

    /** Realtime feed (postgres_changes on the realtime publication tables). Returns unsubscribe(). */
    subscribe: function (fn) {
      ensureChannel();
      subscribers++;
      var off = NC.bus && NC.bus.on ? NC.bus.on('server:change', fn) : function () { };
      var done = false;
      return function () {
        if (done) return;
        done = true;
        off();
        subscribers--;
        if (subscribers <= 0 && channel) { try { sb().removeChannel(channel); } catch (e) { /* ignore */ } channel = null; subscribers = 0; }
      };
    },

    resetDemo: function () { return Promise.reject(err('not_supported', 'resetDemo is only available in local mode')); }
  };
})(window.NC = window.NC || {});
