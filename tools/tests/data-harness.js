/*
 * data-harness.js — in-browser assertion suite for the NomadCare data layer in LOCAL mode (owner: P1 data, tests only).
 * Exercises NC.data / NC.backend.local / NC.routing / NC.profile / NC.mapkit / NC.viz against the real seed
 * (assets/js/data/seed-core.js + seed-admin.js) or, if not generated yet, tools/tests/fixtures/mini-seed.js.
 * Results: PASS/FAIL table in the page + window.__harness = {done, summary:{pass, fail, seed}, results:[...]}.
 * Auto-runs with ?run=1 (it RESETS local demo data of this origin).
 */
(function (NC) {
  'use strict';

  var results = [];
  var tests = [];
  var H = window.__harness = { done: false, running: false, results: results, summary: null };
  var ctx = {};

  function test(name, fn) { tests.push({ name: name, fn: fn }); }
  function fail(msg) { throw new Error(msg); }
  function ok(cond, msg) { if (!cond) fail(msg || 'assertion failed'); }
  function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) fail((msg || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
  function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) fail((msg || 'not near') + ': ' + a + ' vs ' + b + ' ±' + tol); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout ' + ms + ' ms')); }, ms); })]);
  }
  function bytes(s) { return new TextEncoder().encode(s).length; }
  async function waitFor(fn, ms, step) {
    var end = Date.now() + (ms || 3000);
    while (Date.now() < end) { var v = await fn(); if (v) return v; await sleep(step || 50); }
    return null;
  }

  var CARRIERS = ['viettel', 'vinaphone', 'mobifone'];
  var HAV = function (a, b) { return NC.routing.haversineKm(a, b); };

  /* ------------------------------------------------------------------ pack validation */

  function validatePack(p, routeId, carrier) {
    ok(p && p.schema === 1, 'schema 1');
    eq(p.route.id, routeId, 'route id');
    eq(p.carrier, carrier, 'carrier');
    ['nodes', 'edges', 'segments', 'facilities', 'services'].forEach(function (k) { ok(Array.isArray(p[k]), k + ' array'); });
    ok(p.nodes.length >= 2, 'nodes ≥ 2');
    ok(p.edges.length >= 1, 'edges ≥ 1');
    var nodeIds = {};
    p.nodes.forEach(function (n) { nodeIds[n.id] = 1; ok(isFinite(n.lat) && isFinite(n.lng), 'node coords ' + n.id); });
    var segBy = {};
    p.segments.forEach(function (s) {
      ok(['likely', 'uncertain', 'lost'].indexOf(s.level) >= 0, 'segment level');
      (segBy[s.edge_id] = segBy[s.edge_id] || []).push(s);
    });
    p.edges.forEach(function (e) {
      ok(nodeIds[e.from] && nodeIds[e.to], 'edge endpoints exist ' + e.id);
      ok(e.geometry && e.geometry.length >= 2, 'edge geometry ' + e.id);
      var gl = NC.routing.lineLengthKm(e.geometry);
      ok(Math.abs(gl - e.length_km) <= Math.max(0.05, e.length_km * 0.03), 'edge length ≈ geometry ' + e.id + ' ' + gl + '/' + e.length_km);
      var d0 = HAV(e.geometry[0], p.nodes.filter(function (n) { return n.id === e.from; })[0]);
      ok(d0 < 0.5, 'geometry ordered from→to ' + e.id + ' (' + d0.toFixed(3) + ' km)');
      var segs = (segBy[e.id] || []).sort(function (a, b) { return a.from_km - b.from_km; });
      ok(segs.length >= 1, 'segments for edge ' + e.id);
      near(segs[0].from_km, 0, 0.01, 'segment starts at 0 ' + e.id);
      near(segs[segs.length - 1].to_km, e.length_km, Math.max(0.02, e.length_km * 0.01), 'segments cover edge ' + e.id);
      for (var i = 1; i < segs.length; i++) near(segs[i].from_km, segs[i - 1].to_km, 0.01, 'contiguous ' + e.id);
    });
    p.facilities.forEach(function (f) {
      ok(f.verified_at && f.verified_by && f.phone && f.open_hours && f.address, 'verified facility complete ' + f.id);
      ok(typeof f.is_stale === 'boolean' && typeof f.days_since_verified === 'number', 'stale flags ' + f.id);
      eq(f.is_demo, true, 'is_demo ' + f.id);
    });
    var copy = Object.assign({}, p);
    delete copy.source; delete copy.downloaded_at;
    eq(p.size_bytes, bytes(JSON.stringify(copy)), 'size_bytes = UTF-8 JSON length');
  }

  function farPair(pack) {
    var best = null;
    pack.nodes.forEach(function (a) {
      pack.nodes.forEach(function (b) {
        if (a.id >= b.id) return;
        var d = HAV(a, b);
        if (!best || d > best.d) best = { a: a.id, b: b.id, d: d };
      });
    });
    return best;
  }

  function weighted(an) { return an.length_km + 1.5 * an.lost_km + 0.5 * an.uncertain_km; }

  /* ------------------------------------------------------------------ tests */

  test('setup: seed + local backend + clean state', async function () {
    ctx.seedSource = window.NC_SEED ? 'seed-core.js' : 'mini-seed (fallback)';
    if (!window.NC_SEED) { window.NC_SEED = window.NC_SEED_MINI; window.NC_SEED_ADMIN = window.NC_SEED_ADMIN_MINI; }
    window.NC_CONFIG.forceLocal = true;
    await NC.settings.load();
    await NC.store.wipe();
    await NC.secure.wipe();
    await NC.settings.reset();
    await NC.settings.patch({ onboarded: true, carrier: 'viettel', simulated_offline: false, community_logs: false });
    NC.backend.local.latency = [5, 25];
    await NC.data.init();
    eq(NC.data.mode, 'local', 'mode');
    await NC.data.admin.resetDemo();
    ctx.routes = (window.NC_SEED.routes || []).map(function (r) { return r.id; });
    ok(ctx.routes.length >= 1, 'routes in seed');
    return ctx.seedSource + ' · routes ' + ctx.routes.join(', ') + ' · storage ' + NC.backend.local.storage;
  });

  test('listRoutes (server) — summary shape per route', async function () {
    var routes = await NC.data.listRoutes();
    eq(routes.map(function (r) { return r.id; }).sort(), ctx.routes.slice().sort(), 'route ids');
    routes.forEach(function (r) {
      eq(r.source, 'server', 'source');
      ok(r.name && r.bbox && r.bbox.length === 4, 'name/bbox ' + r.id);
      ok(r.verified_facilities >= 1, 'verified facilities ' + r.id);
      CARRIERS.forEach(function (c) { ok(c in r.accuracy, 'accuracy key ' + c); });
    });
    if (ctx.seedSource === 'seed-core.js') {
      ['khanh-le', 'ta-nang-phan-dung', 'ha-giang-loop'].forEach(function (id) { ok(ctx.routes.indexOf(id) >= 0, 'pilot route ' + id); });
    }
    return routes.map(function (r) { return r.id + ':' + r.verified_facilities + 'fac/' + Object.keys(r.packs).length + 'packs'; }).join(' ');
  });

  test('getPack (server) for every route × carrier — Pack format', async function () {
    var out = [];
    ctx.packs = {};
    for (var i = 0; i < ctx.routes.length; i++) {
      for (var j = 0; j < CARRIERS.length; j++) {
        var p = await NC.data.getPack(ctx.routes[i], CARRIERS[j]);
        eq(p.source, 'server', 'source');
        validatePack(p, ctx.routes[i], CARRIERS[j]);
        ctx.packs[ctx.routes[i] + ':' + CARRIERS[j]] = p;
        out.push(ctx.routes[i].slice(0, 8) + '/' + CARRIERS[j].slice(0, 3) + ' v' + p.version + ' ' + Math.round(p.size_bytes / 1024) + 'KB');
      }
    }
    return out.join(' · ');
  });

  test('getPack (bundled, simulated offline) matches the server content', async function () {
    await NC.net.setSimulated(true);
    ok(!NC.net.online(), 'offline');
    try {
      for (var i = 0; i < ctx.routes.length; i++) {
        for (var j = 0; j < CARRIERS.length; j++) {
          var b = await NC.data.getPack(ctx.routes[i], CARRIERS[j]);
          eq(b.source, 'bundled', 'bundled source');
          validatePack(b, ctx.routes[i], CARRIERS[j]);
          var s = ctx.packs[ctx.routes[i] + ':' + CARRIERS[j]];
          eq(b.facilities.map(function (f) { return f.id; }).sort(), s.facilities.map(function (f) { return f.id; }).sort(), 'same facilities');
          eq(b.edges.length, s.edges.length, 'same edges');
          eq(b.version, s.version, 'same version');
        }
      }
      var routes = await NC.data.listRoutes();
      ok(routes.length === ctx.routes.length && (routes[0].source === 'cache' || routes[0].source === 'bundled'), 'offline listRoutes ' + routes[0].source);
    } finally {
      await NC.net.setSimulated(false);
    }
    return 'bundled packs OK offline';
  });

  test('A* between far nodes on each route (both strategies) + analyze totals', async function () {
    var out = [];
    ctx.analyses = {};
    ctx.routes.forEach(function (rid) {
      var pack = ctx.packs[rid + ':viettel'];
      var g = NC.routing.buildGraph([pack]);
      var fp = farPair(pack);
      var t0 = performance.now();
      var sp = NC.routing.astar(g, fp.a, fp.b, { strategy: 'shortest' });
      var sg = NC.routing.astar(g, fp.a, fp.b, { strategy: 'signal' });
      var ms = performance.now() - t0;
      ok(sp && sg, 'paths found ' + rid);
      var a1 = NC.routing.analyze(g, sp), a2 = NC.routing.analyze(g, sg);
      [a1, a2].forEach(function (an) {
        near(an.likely_km + an.uncertain_km + an.lost_km, an.length_km, 1e-6, 'sum = length ' + rid);
        near(NC.routing.lineLengthKm(an.geometry), an.length_km, Math.max(0.1, an.length_km * 0.03), 'geometry length ' + rid);
        for (var i = 1; i < an.parts.length; i++) near(an.parts[i].from_km, an.parts[i - 1].to_km, 1e-6, 'contiguous parts');
      });
      near(sp.cost, sp.length_km, 1e-9, 'shortest cost = length');
      ok(sg.cost <= weighted(a1) + 1e-6, 'signal path is optimal for the weighted cost');
      ok(sp.length_km <= sg.length_km + 1e-9, 'shortest path is not longer');
      ctx.analyses[rid] = a1;
      ctx.graph = ctx.graph || g;
      out.push(rid + ': ' + fp.a + '→' + fp.b + ' ' + sp.length_km.toFixed(1) + '/' + sg.length_km.toFixed(1) + 'km lost ' + a1.lost_km.toFixed(1) + '/' + a2.lost_km.toFixed(1) + ' (' + ms.toFixed(1) + 'ms)');
    });
    return out.join(' · ');
  });

  test('routeBetween GPS point → facility; deadzoneAhead on a real route', async function () {
    var rid = ctx.routes[ctx.routes.length - 1];
    var pack = ctx.packs[rid + ':viettel'];
    var g = NC.routing.buildGraph([pack]);
    var n0 = pack.nodes[0];
    var fac = pack.facilities.slice().sort(function (a, b) { return HAV(n0, b) - HAV(n0, a); })[0];
    var path = NC.routing.routeBetween(g, { lat: n0.lat + 0.001, lng: n0.lng + 0.001 }, { lat: fac.lat, lng: fac.lng }, { strategy: 'signal' });
    ok(path && path.steps.length >= 1, 'route to facility');
    var an = NC.routing.analyze(g, path);
    near(an.likely_km + an.uncertain_km + an.lost_km, an.length_km, 1e-6, 'sum');
    var det = [];
    Object.keys(ctx.analyses).forEach(function (r) {
      var a = ctx.analyses[r];
      if (!a.zones.length) return;
      var z = a.zones[0];
      if (z.start_km >= 1.5) {
        var w = NC.routing.deadzoneAhead(a, z.start_km - 1.5, { speed_kmh: 25, mode: 'motorbike' });
        ok(w.should_warn && w.basis === 'time', 'motorbike warns 1.5 km before');
        var nw = NC.routing.deadzoneAhead(a, Math.max(0, z.start_km - 1.5), { speed_kmh: 3.5, mode: 'hiking' });
        ok(!nw.should_warn, 'hiker 1.5 km away is > 15 min → no warn yet');
      }
      var inside = NC.routing.deadzoneAhead(a, (z.start_km + z.end_km) / 2, { speed_kmh: 25 });
      ok(inside.in_deadzone, 'inside zone');
      det.push(r + ': first lost at ' + z.start_km.toFixed(1) + ' km');
    });
    return 'to ' + fac.name + ' ' + an.length_km.toFixed(1) + ' km · ' + (det.join(' · ') || 'no lost zone on shortest paths');
  });

  test('downloadPack → offline getPack uses it → removePack', async function () {
    var rid = ctx.routes[0];
    var evt = null;
    var off = NC.bus.on('data:pack', function (p) { evt = p; });
    var meta = await NC.data.downloadPack(rid, 'viettel');
    off();
    ok(evt && evt.route_id === rid, 'data:pack emitted');
    ok(meta.version >= 0 && meta.size_bytes > 0 && meta.downloaded_at, 'meta');
    eq((await NC.data.listDownloadedPacks()).length, 1, 'one downloaded');
    await NC.net.setSimulated(true);
    try {
      var p = await NC.data.getPack(rid, 'viettel');
      eq(p.source, 'downloaded', 'downloaded source');
      var err = null;
      try { await NC.data.downloadPack(rid, 'mobifone'); } catch (e) { err = e; }
      ok(err && err.code === 'offline', 'download requires network');
      var routes = await NC.data.listRoutes();
      ok(routes.filter(function (r) { return r.id === rid; })[0].downloaded.viettel, 'listRoutes shows downloaded');
    } finally { await NC.net.setSimulated(false); }
    ok(NC.data.status().packs === 1, 'status().packs');
    return rid + ' v' + meta.version + ' ' + meta.size_bytes + ' B';
  });

  test('nearestFacilities fully offline (sorted, limit, type filter, stale flags)', async function () {
    var pack = ctx.packs[ctx.routes[0] + ':viettel'];
    var pos = { lat: pack.nodes[0].lat, lng: pack.nodes[0].lng };
    await NC.net.setSimulated(true);
    try {
      var res = await NC.data.nearestFacilities(pos, { limit: 5 });
      ok(res.length >= 1 && res.length <= 5, 'limit');
      for (var i = 1; i < res.length; i++) ok(res[i].distance_km >= res[i - 1].distance_km, 'sorted by distance');
      res.forEach(function (f) { ok(typeof f.is_stale === 'boolean' && f.route_id, 'flags + route'); });
      var ph = await NC.data.nearestFacilities(pos, { types: ['nha_thuoc'], limit: 3 });
      ok(ph.every(function (f) { return f.type === 'nha_thuoc'; }), 'type filter');
      var all = await NC.data.nearestFacilities(pos, { limit: 500 });
      var ids = {};
      all.forEach(function (f) { ok(!ids[f.id], 'no duplicates'); ids[f.id] = 1; });
      return res.map(function (f) { return f.name + ' ' + f.distance_km.toFixed(1) + 'km'; }).join(' · ') + ' · total ' + all.length;
    } finally { await NC.net.setSimulated(false); }
  });

  test('Buddy: start → simulated offline → check-ins queued → online → flush → server updated', async function () {
    var node = ctx.packs[ctx.routes[0] + ':viettel'].nodes[1];
    await NC.settings.set('last_position', { lat: node.lat, lng: node.lng, at: new Date().toISOString(), source: 'sim' });
    var s = await NC.data.buddy.start({ traveler_name: 'Harness', recipient: { name: 'Buddy', email: 'buddy@example.com', phone: '+84 000 000 001' }, interval_min: 60, grace_min: 10, share_public_medical: false });
    await NC.data.flush();
    var srv = await waitFor(async function () { return (await NC.backend.local._debug.all('buddy_sessions')).filter(function (x) { return x.id === s.id; })[0]; }, 3000);
    ok(srv && srv.status === 'active', 'server has the session');
    ok(NC.data.status().deviceId, 'device registered');
    await NC.net.setSimulated(true);
    var e1 = await NC.data.buddy.checkin({ kind: 'checkin', lat: node.lat + 0.01, lng: node.lng + 0.01, accuracy_m: 15 });
    var e2 = await NC.data.buddy.checkin({ kind: 'pre_deadzone', note: 'Sắp vào vùng mất sóng' });
    ok(e1.queued && e2.queued, 'events flagged queued');
    var ob = await NC.data.outbox();
    eq(ob.filter(function (o) { return o.op === 'buddy.checkin'; }).length, 2, 'two queued ops');
    var f0 = await NC.data.flush();
    ok(f0.offline, 'flush is a no-op offline');
    await NC.net.setSimulated(false);
    var r = await NC.data.flush();
    ok(r.sent >= 2 || (await NC.data.outbox()).length === 0, 'sent ' + JSON.stringify(r));
    eq((await NC.data.outbox()).length, 0, 'outbox drained');
    var srv2 = (await NC.backend.local._debug.all('buddy_sessions')).filter(function (x) { return x.id === s.id; })[0];
    ok(Date.parse(srv2.last_checkin_at) >= Date.parse(e1.client_ts) - 1000, 'server last_checkin_at updated');
    near(srv2.last_lat, node.lat + 0.01, 1e-6, 'server location updated');
    var sEvents = (await NC.backend.local._debug.all('checkin_events')).filter(function (x) { return x.session_id === s.id; });
    ok(sEvents.some(function (x) { return x.id === e1.id && x.queued === true; }), 'server event keeps queued flag');
    ok((await NC.data.buddy.events()).filter(function (x) { return x.id === e1.id; })[0].received_at, 'local event acknowledged');
    ctx.session = s;
    return 'session ' + s.id.slice(0, 8) + ' · last_checkin ' + srv2.last_checkin_at;
  });

  test('Buddy phone (20261002000100): 02x landline refused up front (recipient_phone_not_mobile); mobile / international / demo valid', async function () {
    var sh = NC.backend.shared;
    var land = sh.normPhone('024 3826 4444');
    eq([land.e164, land.valid, land.landline], ['+842438264444', false, true], 'landline flags');
    ok(['0362 123 456', '0912 345 678', '+44 20 7946 0958', '+84 000 000 001'].every(function (p) { return sh.normPhone(p).valid; }), 'mobile / international / demo valid');
    var before = await NC.data.buddy.current();
    var code = null;
    try { await NC.data.buddy.start({ recipient: { name: 'Buddy', phone: '028 3829 5555' } }); } catch (e) { code = e.code; }
    eq(code, 'recipient_phone_not_mobile', 'refused before touching state');
    eq((await NC.data.buddy.current() || {}).id, (before || {}).id, 'current session unchanged');
    return 'landline refused · mobiles ok';
  });

  test('Overdue: device tick (fast clock) + server cron → simulated alert → device sees alerted → resolve', async function () {
    var s = await NC.data.buddy.current();
    ok(s, 'open session');
    var seen = [];
    var off = NC.bus.on('buddy:event', function (p) { seen.push(p.event.kind); });
    var due = await NC.data.buddy.tick({ now: Date.parse(s.next_due_at) + (s.grace_min + 1) * 60000 });
    ok(due && due.status === 'overdue', 'device marks overdue');
    ok(seen.indexOf('overdue') >= 0, 'buddy:event overdue');
    await NC.data.flush();
    var row = (await NC.backend.local._debug.all('buddy_sessions')).filter(function (x) { return x.id === s.id; })[0];
    eq(row.status, 'overdue', 'server overdue via queued op');
    var t = await NC.backend.local.tick({ force: true });
    ok(t.alerted >= 1, 'cron dispatched alert');
    var alert = (await NC.backend.local._debug.all('checkin_events')).filter(function (x) { return x.session_id === s.id && x.kind === 'alert_sent'; })[0];
    ok(alert && alert.meta.provider === 'simulated', 'alert_sent meta.provider simulated');
    await NC.data.flush(); // heartbeat → merge server status
    var cur = await waitFor(async function () { var c = await NC.data.buddy.current(); return c && c.status === 'alerted' ? c : null; }, 3000);
    ok(cur, 'device adopted server status alerted');
    ok((await NC.data.buddy.events()).some(function (x) { return x.kind === 'alert_sent'; }), 'local alert_sent event');
    var res = await NC.data.buddy.resolve();
    eq(res.status, 'active', 'resolved locally');
    await NC.data.flush();
    row = (await NC.backend.local._debug.all('buddy_sessions')).filter(function (x) { return x.id === s.id; })[0];
    eq(row.status, 'active', 'server active after resolve');
    // pure server-side detection (device silent): push next_due_at into the past
    row.next_due_at = new Date(Date.now() - 30 * 60000).toISOString();
    row.grace_min = 1;
    await NC.backend.local._debug.put('buddy_sessions', row);
    var t2 = await NC.backend.local.tick({ force: true });
    eq(t2.overdue, 1, 'server marks overdue on its own');
    off();
    return 'events ' + seen.join(',');
  });

  test('Admin (local demo): kpis, listFacilities, incomplete rejection, publishPack bump, reviewSubmission', async function () {
    var sess = await NC.data.admin.enterDemo();
    eq(sess.role, 'admin', 'demo admin');
    var k = await NC.data.admin.kpis();
    ok(k.facilities.verified >= 1 && k.facilities.target === 216, 'kpis facilities');
    ok(k.routes.length === ctx.routes.length, 'kpis routes');
    var ver = await NC.data.admin.listFacilities({ status: 'verified' });
    eq(ver.length, k.facilities.verified, 'verified count matches');
    ok(ver.every(function (f) { return isFinite(f.lat) && typeof f.is_stale === 'boolean'; }), 'v_facilities shape');
    var pend = (await NC.data.admin.listFacilities({ status: 'pending' })).filter(function (f) { return NC.backend.shared.facilityMissing(f).length; })[0];
    var err = null;
    if (pend) {
      try { await NC.data.admin.upsertFacility({ id: pend.id, status: 'verified' }); } catch (e) { err = e; }
      ok(err && err.code === 'incomplete' && err.missing.length, 'incomplete verified rejected');
    } else {
      try { await NC.data.admin.upsertFacility({ name: 'X', status: 'verified' }); } catch (e) { err = e; }
      ok(err && err.code === 'incomplete', 'incomplete verified rejected (new row)');
    }
    var rid = ctx.routes[0];
    var before = (await NC.data.admin.listPacks()).filter(function (p) { return p.route_id === rid && p.carrier === 'vinaphone' && p.is_current; })[0];
    // Nothing changed since the seed pack → no new version (admin-backend#2); {force:true} publishes anyway.
    var same = await NC.data.admin.publishPack(rid, 'vinaphone', 'harness');
    ok(!before || (same.unchanged === true && same.version === before.version), 'publish without changes keeps version ' + (before && before.version));
    var pub = await NC.data.admin.publishPack(rid, 'vinaphone', 'harness', { force: true });
    eq(pub.version, (before ? before.version : 0) + 1, 'version bump (force)');
    var served = await NC.backend.local.get_data_pack(rid, 'vinaphone');
    eq(served.version, pub.version, 'served new version');
    var subs = await NC.data.admin.listSubmissions({ status: 'pending' });
    var sNew = subs.filter(function (x) { return x.kind === 'new'; })[0];
    var rv = null;
    if (sNew) {
      rv = await NC.data.admin.reviewSubmission(sNew.id, 'approved', 'Đã gọi xác minh');
      eq(rv.status, 'approved', 'approved');
      var fac = (await NC.data.admin.listFacilities({ status: 'pending' })).filter(function (f) { return f.id === rv.facility_id; })[0];
      ok(fac && fac.source === 'community', 'pending community facility created');
    }
    var audit = await NC.data.admin.audit({ limit: 20 });
    ok(audit.some(function (a) { return a.action === 'publish'; }), 'audit publish');
    return 'verified ' + k.facilities.verified + ' · pending ' + k.facilities.pending + ' · stale ' + k.facilities.stale + ' · pack v' + pub.version +
      (err ? ' · missing ' + err.missing.join(',') : '') + (rv ? ' · sub→' + rv.facility_id.slice(0, 8) : '');
  });

  test('Realtime: admin.subscribe + BroadcastChannel nomadcare-server', async function () {
    var got = [];
    var off = NC.data.admin.subscribe(function (m) { got.push(m.table + ':' + m.type); });
    var bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nomadcare-server') : null;
    var cross = [];
    if (bc) bc.onmessage = function (e) { cross.push(e.data.table); };
    await sleep(20);
    var svc = await NC.data.admin.upsertService({ name: 'Harness rental', type: 'rental', route_id: ctx.routes[0], lat: 22.8, lng: 105.0, is_partner: true });
    await waitFor(function () { return got.length && (!bc || cross.length); }, 2000);
    off();
    if (bc) bc.close();
    ok(got.indexOf('services:INSERT') >= 0, 'same-tab event');
    ok(!bc || cross.indexOf('services') >= 0, 'cross-tab channel message');
    return 'svc ' + svc.id.slice(0, 8) + ' · events ' + got.join(',');
  });

  test('Profile: encrypted round-trip, consents, QR public text', async function () {
    var p = {
      public: { blood_type: 'O+', allergies: 'Penicillin', conditions: 'Hen suyễn', medications: 'Ventolin', notes: '' },
      identity: { full_name: 'Minh Anh', nationality: 'Việt Nam', contact_name: 'Lê Hà', contact_phone: '+84 000 000 001', reveal_code: null }
    };
    await NC.profile.save(p);
    var back = await NC.profile.get();
    eq(back.public.allergies, 'Penicillin', 'round-trip');
    var raw = await NC.store.table('secure').get('profile');
    ok(raw && JSON.stringify(raw).indexOf('Penicillin') < 0, 'not stored in clear text');
    ok(NC.profile.isComplete(back), 'complete');
    var txt = NC.profile.publicText(back);
    ok(txt.indexOf('NOMADCARE – THÔNG TIN Y TẾ KHẨN CẤP / EMERGENCY MEDICAL INFO') === 0 && /Gọi\/Call 115$/.test(txt), 'header/footer');
    ok(txt.indexOf('Minh Anh') < 0 && txt.indexOf('Lê Hà') < 0, 'no identity');
    var c = await NC.profile.consents.set({ terms: true, sensitive: true, community_logs: true });
    ok(c.terms && c.at, 'consents stored');
    eq(NC.settings.get('community_logs'), true, 'community_logs mirrored');
    var ops = await NC.data.logSignal([{ lat: 22.8, lng: 105, rsrp_dbm: -112, route_id: ctx.routes[0] }]);
    ok(ops && ops.length === 1, 'signal log queued when opted in');
    await NC.data.submitReport({ kind: 'correction', facility_id: 'x', note: 'Giờ mở cửa đã đổi', lat: 22.8, lng: 105 });
    var r = await NC.data.flush();
    eq(r.failed, 0, 'contributions synced');
    return 'encrypted=' + NC.secure.encrypted + ' · QR ' + txt.length + ' chars';
  });

  test('contentRelease + status()', async function () {
    var cr = await NC.data.contentRelease();
    ok(cr && cr.version, 'content release');
    var st = NC.data.status();
    ['mode', 'online', 'outboxCount', 'lastSyncAt', 'deviceId', 'packs'].forEach(function (k) { ok(k in st, 'status.' + k); });
    ok(st.lastSyncAt, 'lastSyncAt set');
    return cr.version + ' (' + cr.status + ') · ' + JSON.stringify(st);
  });

  test('Mapkit + viz render (route colours, POIs, heat, theme swap, offline notice)', async function () {
    var rid = ctx.routes[0];
    var pack = ctx.packs[rid + ':viettel'];
    var g = NC.routing.buildGraph([pack]);
    var fp = farPair(pack);
    var an = NC.routing.analyze(g, NC.routing.astar(g, fp.a, fp.b, { strategy: 'shortest' }));
    var map = NC.mapkit.create(document.getElementById('dh-map'), { center: [pack.nodes[0].lat, pack.nodes[0].lng], zoom: 9 });
    var grp = NC.mapkit.drawRoute(map, an, { fit: true });
    var edges = NC.mapkit.drawEdges(null, g);
    ok(edges.getLayers().length > 0, 'drawEdges layers');
    pack.facilities.slice(0, 8).forEach(function (f) { NC.mapkit.poiMarker(f, 'facility').addTo(map); });
    pack.services.slice(0, 5).forEach(function (s) { NC.mapkit.poiMarker(s, 'service').addTo(map); });
    NC.mapkit.userMarker([pack.nodes[0].lat, pack.nodes[0].lng]).addTo(map);
    var samples = await NC.data.admin.listSamples({ route_id: rid, carrier: 'viettel', limit: 400 });
    var heat = NC.mapkit.heatLayer(map, samples, { radius: 4 });
    await sleep(100);
    var el = map.getContainer();
    ok(el.querySelectorAll('path.mk-route').length === an.parts.length, 'one path per part');
    ok(el.querySelector('.mk-route-casing'), 'casing');
    ok(el.querySelectorAll('.mk-poi').length >= 1, 'poi markers');
    ok(el.querySelector('.mk-user__dot'), 'user marker');
    // Basemap: CARTO Voyager/Dark Matter when NC_CONFIG.tiles carries a key, else the keyless OSM fallback.
    var bmLight = NC.mapkit.basemap(false), bmDark = NC.mapkit.basemap(true);
    var attr = function () { return el.querySelector('.leaflet-control-attribution').textContent; };
    eq(map._nc.tiles._url, bmLight.url, 'light basemap url');
    ok(bmLight.provider === 'osm' || /voyager/.test(bmLight.url), 'light = voyager or OSM fallback');
    ok(/OpenStreetMap/.test(attr()) && (bmLight.provider !== 'carto' || /CARTO/.test(attr())), 'attribution');
    document.documentElement.setAttribute('data-theme', 'dark');
    await sleep(80);
    eq(map._nc.tiles._url, bmDark.url, 'dark basemap url after theme change');
    ok(bmDark.provider === 'osm' ? el.classList.contains('mk-map--invert') : /dark_all/.test(bmDark.url), 'dark = dark_all or inverted OSM');
    document.documentElement.setAttribute('data-theme', 'light');
    await sleep(80);
    ok(!el.classList.contains('mk-map--invert'), 'light theme restores tiles');
    ctx.basemap = bmLight.provider;
    var savedTiles = window.NC_CONFIG.tiles;
    window.NC_CONFIG.tiles = { light: savedTiles.light + '?key=TEST', dark: savedTiles.dark + '?key=TEST' };
    var keyed = NC.mapkit.basemap(true);
    window.NC_CONFIG.tiles = savedTiles;
    ok(keyed.provider === 'carto' && /dark_all/.test(keyed.url) && /key=TEST/.test(keyed.url) && /CARTO/.test(keyed.attribution), 'keyed CARTO URL used as-is');
    await NC.net.setSimulated(true);
    await sleep(30);
    // With the Cache API the basemap stays on offline (tiles come from 'nc-tiles'; the notice shows only if tiles fail);
    // without it (file://) the layer is removed and the notice shown.
    if (window.caches && typeof window.caches.open === 'function') ok(map.hasLayer(map._nc.tiles), 'basemap kept offline (nc-tiles cache)');
    else ok(el.classList.contains('mk-offline') && !map.hasLayer(map._nc.tiles), 'offline notice + basemap removed');
    ok(/OpenStreetMap/.test(attr()), 'OSM data credit kept while offline');
    await NC.net.setSimulated(false);
    await sleep(30);
    ok(!el.classList.contains('mk-offline') && map.hasLayer(map._nc.tiles), 'basemap back online');
    eq(attr().split('OpenStreetMap').length - 1, 1, 'OSM credit shown once');
    var box = document.getElementById('dh-viz');
    var stops = NC.routing.stopsAlong(an, pack.facilities, { buffer_km: 3 });
    box.appendChild(NC.viz.signalStrip(an, { pos_km: an.length_km * 0.3, pois: stops, showKm: true }));
    box.appendChild(NC.viz.ring(0.72, { label: '72%', sublabel: 'accuracy', tone: 'success' }));
    box.appendChild(NC.viz.donut([{ label: 'likely', value: an.likely_km, color: 'likely' }, { label: 'uncertain', value: an.uncertain_km, color: 'uncertain' }, { label: 'lost', value: an.lost_km, color: 'lost' }], { label: Math.round(an.length_km) + ' km' }));
    box.appendChild(NC.viz.sparkline([3, 5, 4, 8, 6, 9, 7], { tone: 'accent' }));
    box.appendChild(NC.viz.bars(CARRIERS.map(function (c, i) { return { label: c, value: [0.84, 0.8, 0.77][i], color: ['primary', 'info', 'accent'][i] }; }), { max: 1, fmt: function (v) { return Math.round(v * 100) + '%'; } }));
    ok(box.querySelectorAll('svg.vz').length === 5, 'viz svgs');
    ok(box.querySelector('.vz-lvl--likely, .vz-lvl--uncertain, .vz-lvl--lost'), 'strip parts');
    var fill = getComputedStyle(box.querySelector('.vz-strip .vz-lvl')).fill;
    ok(fill && fill !== 'none' && fill.indexOf('rgb') === 0, 'token colour resolved: ' + fill);
    ctx.map = map;
    return 'basemap ' + ctx.basemap + ' · parts ' + an.parts.length + ' · heat ' + heat.getLayers().length + ' · stops ' + stops.length + ' · layers ' + grp.getLayers().length;
  });

  test('wipePersonal: profile, buddy, outbox, consents, device creds gone; packs kept', async function () {
    await NC.data.buddy.start({ recipient: { email: 'x@example.com', phone: '+84 000 000 002' } });
    var packsBefore = (await NC.data.listDownloadedPacks()).length;
    await NC.data.wipePersonal();
    eq(await NC.profile.get(), null, 'profile');
    eq(await NC.data.buddy.current(), null, 'buddy session');
    eq((await NC.data.buddy.events()).length, 0, 'events');
    eq((await NC.data.outbox()).length, 0, 'outbox');
    eq((await NC.profile.consents.get()).terms, false, 'consents');
    eq(NC.settings.get('onboarded'), false, 'onboarded reset');
    eq(NC.data.status().deviceId, null, 'device id');
    eq((await NC.data.listDownloadedPacks()).length, packsBefore, 'packs kept');
    var open = (await NC.backend.local._debug.all('buddy_sessions')).filter(function (x) { return x.traveler_name === null && x.recipient_email === 'x@example.com' && x.status !== 'closed'; });
    eq(open.length, 0, 'server session closed before wipe');
    return 'ok';
  });

  /* ------------------------------------------------------------------ runner */

  function row(i, r) {
    var tr = document.createElement('tr');
    [String(i + 1), r.ok ? 'PASS' : 'FAIL', r.name, r.detail || '', String(r.ms)].forEach(function (txt, k) {
      var td = document.createElement('td');
      td.textContent = txt;
      if (k === 1) td.className = r.ok ? 'dh__ok' : 'dh__ko';
      tr.appendChild(td);
    });
    document.getElementById('dh-results').appendChild(tr);
  }

  async function run() {
    if (H.running) return;
    H.running = true;
    H.done = false;
    results.length = 0;
    document.getElementById('dh-results').innerHTML = '';
    var sum = document.getElementById('dh-summary');
    sum.className = 'dh__summary';
    sum.textContent = 'Đang chạy…';
    var errs = [];
    var onErr = function (e) { errs.push(String(e.message || e.reason || e)); };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onErr);
    for (var i = 0; i < tests.length; i++) {
      var t0 = performance.now();
      var r = { name: tests[i].name, ok: false, detail: '', ms: 0 };
      try {
        r.detail = String((await withTimeout(Promise.resolve().then(tests[i].fn), 30000)) || '');
        r.ok = true;
      } catch (e) {
        r.detail = (e && e.message) || String(e);
        if (e && e.stack) r.stack = String(e.stack).split('\n').slice(0, 3).join(' | ');
      }
      r.ms = Math.round(performance.now() - t0);
      results.push(r);
      row(i, r);
      if (i === 0 && !r.ok) break; // setup failed
    }
    try { await NC.net.setSimulated(false); } catch (e) { /* ignore */ }
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onErr);
    var pass = results.filter(function (x) { return x.ok; }).length;
    H.summary = { pass: pass, fail: results.length - pass, total: tests.length, seed: ctx.seedSource, pageErrors: errs };
    sum.textContent = pass + '/' + tests.length + ' PASS · seed: ' + ctx.seedSource + (errs.length ? ' · page errors: ' + errs.length : '');
    sum.className = 'dh__summary ' + (pass === tests.length && !errs.length ? 'is-pass' : 'is-fail');
    H.running = false;
    H.done = true;
  }

  H.run = run;
  document.getElementById('dh-run').addEventListener('click', function () { run(); });
  if (/[?&]run=1\b/.test(location.search)) run();
})(window.NC = window.NC || {});
