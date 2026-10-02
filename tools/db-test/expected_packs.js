#!/usr/bin/env node
/*
 * tools/db-test/expected_packs.js — what the BROWSER builds from the bundled seed (owner: P1 database, db-test).
 * Loads assets/js/data/seed-core.js (+ seed-admin.js) and assets/js/services/backend-local.js in a sandbox with a
 * fake `window`, builds every route × carrier pack with NC.backend.shared.buildPack (the builder of the local mock
 * backend and of the bundled default pack) and prints ONE JSON document that tools/db-test/tests.sql compares with
 * get_data_pack() / build_data_pack() / admin_kpis() (section "2b/2c parity"). Plain Node >= 12, no dependencies.
 *
 * Usage: node tools/db-test/expected_packs.js [--pretty] [--summary] [--root DIR]
 *   --summary  human-readable counts per route × carrier (instead of JSON)
 * "Today" is the Vietnam calendar date (like app_private.today_vn()), whatever the machine time zone is.
 * Exit code 1 when the seed cannot be loaded or buildPack disagrees with a direct reading of NC_SEED.
 */
'use strict';

// The browser builder uses the local calendar for days_since_verified; pin it to Vietnam (UTC+7, no DST)
// before any Date is created, so the numbers match the server's app_private.today_vn().
process.env.TZ = 'Asia/Ho_Chi_Minh';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name) >= 0;
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const ROOT = path.resolve(opt('--root', path.join(__dirname, '..', '..')));
const STALE_DAYS = 90;
const DAY_MS = 86400000;

function fail(msg) {
  process.stderr.write('expected_packs: ' + msg + '\n');
  process.exit(1);
}

/** Runs the browser scripts in one sandbox; returns the fake window. */
function loadBrowser() {
  const win = { NC: {}, console: console };
  win.window = win;
  const ctx = vm.createContext({ window: win, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined });
  const files = ['assets/js/data/seed-core.js', 'assets/js/data/seed-admin.js', 'assets/js/services/backend-local.js'];
  files.forEach((rel) => {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      if (rel.indexOf('seed-admin') >= 0) return;               // optional (KPIs of samples/buddy are skipped)
      fail('missing ' + rel);
    }
    try {
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
    } catch (e) {
      fail('cannot load ' + rel + ': ' + e.message);
    }
  });
  if (!win.NC_SEED) fail('window.NC_SEED not defined by seed-core.js');
  if (!win.NC.backend || !win.NC.backend.shared || typeof win.NC.backend.shared.buildPack !== 'function') {
    fail('NC.backend.shared.buildPack not defined by backend-local.js');
  }
  return win;
}

/** YYYY-MM-DD of "now" in Vietnam. */
function todayVn(now) {
  const d = new Date(now.getTime() + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}

/** Whole days between a YYYY-MM-DD date and the Vietnam date of `now` (same rule as the SQL). */
function daysSinceVn(date, now) {
  if (!date) return null;
  const a = Date.parse(String(date).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(todayVn(now) + 'T00:00:00Z');
  return Math.round((b - a) / DAY_MS);
}

const sortedIds = (arr) => arr.map((x) => String(x.id)).sort();
const countBy = (arr, fn) => arr.filter(fn).length;

function main() {
  const win = loadBrowser();
  const S = win.NC_SEED;
  const A = win.NC_SEED_ADMIN || null;
  const shared = win.NC.backend.shared;
  const now = new Date();
  const carriers = (S.carriers || []).map((c) => (typeof c === 'string' ? c : c.id));
  const routes = (S.routes || []).filter((r) => r.is_active !== false);
  const problems = [];

  const out = {
    schema: 1,
    source: {
      seed_generated_at: S.generated_at || null,
      model_version: S.model_version || null,
      today_vn: todayVn(now),
      builder: 'NC.backend.shared.buildPack (assets/js/services/backend-local.js)'
    },
    pairs: [],
    packs: {},
    kpis: null
  };

  routes.forEach((r) => {
    carriers.forEach((c) => {
      const key = r.id + ':' + c;
      const p = shared.buildPack(S, r.id, c, { version: 1, published_at: now.toISOString(), now: now });
      if (!p) { problems.push(key + ': buildPack returned null'); return; }

      // Independent reading of the seed: the verified facilities / active services / nodes / edges of the route.
      const verified = S.facilities.filter((f) => f.status === 'verified' && f.route_id === r.id);
      const untagged = S.facilities.filter((f) => f.status === 'verified' && !f.route_id);
      if (untagged.length) problems.push(key + ': ' + untagged.length + ' verified facilities without route_id (corridor rules differ: server 15 km of the line, browser bbox ± 0.05°)');
      const direct = {
        nodes: sortedIds(S.nodes.filter((n) => n.route_id === r.id)),
        edges: sortedIds(S.edges.filter((e) => e.route_id === r.id)),
        facilities: sortedIds(verified),
        services: sortedIds(S.services.filter((s) => (s.status || 'active') === 'active' && s.route_id === r.id))
      };
      ['nodes', 'edges', 'facilities', 'services'].forEach((k) => {
        if (sortedIds(p[k]).join() !== direct[k].join()) problems.push(key + ': buildPack ' + k + ' differ from NC_SEED');
      });
      p.facilities.forEach((f) => {
        const d = daysSinceVn(f.verified_at, now);
        if (f.days_since_verified !== d || f.is_stale !== (d !== null && d > STALE_DAYS)) {
          problems.push(key + ': freshness of ' + f.id + ' (' + f.days_since_verified + ' vs ' + d + ')');
        }
      });

      out.pairs.push(key);
      out.packs[key] = {
        keys: Object.keys(p).sort(),
        route_keys: Object.keys(p.route).sort(),
        route: { id: p.route.id, name: p.route.name, region: p.route.region, region_en: p.route.region_en,
          travel_mode: p.route.travel_mode, length_km: p.route.length_km, color: p.route.color, bbox: p.route.bbox },
        carrier: p.carrier,
        schema: p.schema,
        model_version: p.model_version,
        accuracy: p.accuracy,
        holdout_n: p.holdout_n,
        counts: { nodes: p.nodes.length, edges: p.edges.length, segments: p.segments.length,
          facilities: p.facilities.length, services: p.services.length },
        nodes: p.nodes.map((n) => ({ id: n.id, name: n.name, name_en: n.name_en, kind: n.kind, lat: n.lat, lng: n.lng })),
        edges: p.edges.map((e) => ({
          id: e.id, from: e.from, to: e.to, length_km: e.length_km, is_connector: e.is_connector,
          npoints: e.geometry.length,
          first: e.geometry.length ? e.geometry[0] : null,
          last: e.geometry.length ? e.geometry[e.geometry.length - 1] : null
        })),
        segments: p.segments.map((s) => ({ edge_id: s.edge_id, seq: s.seq, from_km: s.from_km, to_km: s.to_km,
          level: s.level, confidence: s.confidence })),
        facilities: p.facilities.map((f) => ({
          id: f.id, type: f.type, lat: f.lat, lng: f.lng, phone: f.phone, verified_at: f.verified_at,
          night_shift: f.night_shift, trauma_capable: f.trauma_capable, is_stale: f.is_stale,
          days_since_verified: f.days_since_verified, is_demo: f.is_demo
        })),
        verified_facility_ids: direct.facilities,
        services: p.services.map((s) => ({ id: s.id, type: s.type, is_partner: s.is_partner, is_demo: s.is_demo }))
      };
    });
  });

  // KPIs a freshly seeded database must report (admin_kpis), from the same seed files.
  const facs = S.facilities.map((f) => Object.assign({}, f, { _d: daysSinceVn(f.verified_at, now) }));
  const isStale = (f) => f.status === 'verified' && f._d !== null && f._d > STALE_DAYS;
  const kpis = {
    facilities: {
      verified: countBy(facs, (f) => f.status === 'verified'),
      pending: countBy(facs, (f) => f.status === 'pending'),
      rejected: countBy(facs, (f) => f.status === 'rejected'),
      stale: countBy(facs, isStale),
      target: 216
    },
    submissions_pending: countBy(S.submissions || [], (s) => (s.status || 'pending') === 'pending'),
    routes: routes.map((r) => {
      const acc = {};
      carriers.forEach((c) => {
        const a = (S.accuracy || []).filter((x) => x.route_id === r.id && x.carrier === c)[0];
        acc[c] = a ? a.accuracy : null;
      });
      return {
        id: r.id,
        verified: countBy(facs, (f) => f.route_id === r.id && f.status === 'verified'),
        pending: countBy(facs, (f) => f.route_id === r.id && f.status === 'pending'),
        stale: countBy(facs, (f) => f.route_id === r.id && isStale(f)),
        samples: A ? countBy(A.samples || [], (s) => s.route_id === r.id) : null,
        accuracy: acc
      };
    }),
    packs: (function () {
      const cur = {};
      (S.packs || []).forEach((p) => {
        const k = p.route_id + ':' + p.carrier;
        if (!cur[k] || p.version > cur[k].version) cur[k] = { route_id: p.route_id, carrier: p.carrier, version: p.version };
      });
      return Object.keys(cur).sort().map((k) => cur[k]);
    })(),
    samples: null,
    buddy: null,
    devices: null
  };
  if (A) {
    const samples = A.samples || [];
    const byCarrier = {};
    carriers.forEach((c) => { byCarrier[c] = countBy(samples, (s) => s.carrier === c); });
    kpis.samples = { total: samples.length, pending: countBy(samples, (s) => (s.status || 'approved') === 'pending'),
      by_carrier: byCarrier };
    const sess = A.buddy_sessions || [];
    // closed_at relative to now (seed convention: offset_min minutes from the anchor = now; seed.sql writes now() + interval)
    const closedAgoMin = (s) => {
      if (s.offset_min && typeof s.offset_min.closed_at === 'number') return -s.offset_min.closed_at;
      const anchor = Date.parse(A.anchor_at || A.generated_at || '');
      return s.closed_at && isFinite(anchor) ? (anchor - Date.parse(s.closed_at)) / 60000 : Infinity;
    };
    kpis.buddy = {
      active: countBy(sess, (s) => s.status === 'active'),
      overdue: countBy(sess, (s) => s.status === 'overdue'),
      alerted: countBy(sess, (s) => s.status === 'alerted'),
      closed_24h: countBy(sess, (s) => s.status === 'closed' && closedAgoMin(s) < 1440)
    };
    kpis.devices = (A.devices || []).length;
  }
  out.kpis = kpis;

  if (problems.length) fail('seed/builder inconsistencies:\n  ' + problems.join('\n  '));

  if (flag('--summary')) {
    const lines = ['route × carrier                 nodes edges segs  fac  svc  stale  accuracy'];
    out.pairs.forEach((k) => {
      const p = out.packs[k];
      const stale = p.facilities.filter((f) => f.is_stale).length;
      lines.push((k + '                                ').slice(0, 32) +
        [p.counts.nodes, p.counts.edges, p.counts.segments, p.counts.facilities, p.counts.services, stale]
          .map((n) => String(n).padStart(5)).join(' ') + '   ' + p.accuracy);
    });
    lines.push('today (VN) ' + out.source.today_vn + ' · facilities ' + JSON.stringify(kpis.facilities) +
      (kpis.samples ? ' · samples ' + kpis.samples.total : '') + (kpis.buddy ? ' · buddy ' + JSON.stringify(kpis.buddy) : ''));
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(out, null, flag('--pretty') ? 2 : 0) + '\n');
}

main();
