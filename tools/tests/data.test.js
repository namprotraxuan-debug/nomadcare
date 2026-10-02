/*
 * data.test.js — node --test suite for the data layer (owner: P1 data).
 * Runs routing.js + backend-local.js + profile.js + dataservice.js inside a vm sandbox (no DOM, no IndexedDB →
 * the local server uses its in-memory store) with the synthetic fixture tools/tests/fixtures/mini-seed.js.
 * Covers: Pack format/builder, facility validation, EWKB parsing, profile QR text, device ops semantics (idempotency,
 * overdue → simulated alert, check-in recovery), outbox offline → online flush, admin operations.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const FILES = [
  'assets/js/services/routing.js',
  'tools/tests/fixtures/mini-seed.js',
  'assets/js/services/profile.js',
  'assets/js/services/backend-local.js',
  'assets/js/services/backend-supabase.js',
  'assets/js/services/dataservice.js'
];

/** Fresh sandbox with minimal NC core stubs (bus, net, settings). */
function sandbox(opts) {
  opts = opts || {};
  const timers = {
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout, clearInterval
  };
  const ctx = Object.assign({ console, Date, Math, JSON, Promise, TextEncoder, Uint8Array, DataView, crypto: webcrypto, unescape, encodeURIComponent }, timers);
  ctx.window = ctx;
  ctx.globalThis = ctx;
  if (opts.config) ctx.NC_CONFIG = opts.config;
  if (opts.supabase) ctx.supabase = opts.supabase;
  vm.createContext(ctx);
  // --- core stubs (the real ones are browser-only) ---
  const handlers = {};
  const emitted = [];
  const settings = Object.assign({ carrier: 'viettel', route_id: 'mini-loop', travel_mode: 'motorbike', community_logs: false, last_position: null, onboarded: true }, opts.settings || {});
  const net = { online: true };
  ctx.NC = {
    bus: {
      on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => { handlers[evt] = handlers[evt].filter((f) => f !== fn); }; },
      emit(evt, p) { emitted.push(evt); (handlers[evt] || []).slice().forEach((fn) => fn(p)); }
    },
    net: { online: () => net.online },
    settings: { get: (k) => settings[k], set: (k, v) => { settings[k] = v; return Promise.resolve(); }, all: () => Object.assign({}, settings) }
  };
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  if (opts.seed !== false) ctx.NC_SEED = ctx.NC_SEED_MINI;
  if (opts.admin) ctx.NC_SEED_ADMIN = ctx.NC_SEED_ADMIN_MINI;
  ctx.NC.backend.local.latency = [0, 0];
  return { ctx, NC: ctx.NC, net, settings, handlers, emitted };
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ pack builder */

test('buildPack: exact Pack format, verified facilities only, stale flags, active services, gap segments, size_bytes', () => {
  const { ctx, NC } = sandbox();
  const S = ctx.NC_SEED_MINI;
  const pack = plain(NC.backend.shared.buildPack(S, 'mini-loop', 'viettel', { version: 2, published_at: '2026-09-20T00:00:00Z', now: '2026-09-28T12:00:00' }));
  assert.deepEqual(Object.keys(pack), ['schema', 'route', 'carrier', 'version', 'published_at', 'model_version', 'accuracy', 'holdout_n',
    'nodes', 'edges', 'segments', 'facilities', 'services', 'size_bytes']);
  assert.deepEqual(Object.keys(pack.route), ['id', 'name', 'name_en', 'region', 'region_en', 'travel_mode', 'length_km', 'color', 'bbox', 'description_vi', 'description_en']);
  assert.equal(pack.schema, 1);
  assert.equal(pack.version, 2);
  assert.equal(pack.accuracy, 0.84);
  assert.equal(pack.holdout_n, 40);
  assert.deepEqual(Object.keys(pack.nodes[0]), ['id', 'name', 'name_en', 'kind', 'lat', 'lng']);
  assert.deepEqual(Object.keys(pack.edges[0]), ['id', 'from', 'to', 'length_km', 'is_connector', 'geometry']);
  assert.deepEqual(Object.keys(pack.segments[0]), ['edge_id', 'seq', 'from_km', 'to_km', 'level', 'confidence']);
  assert.deepEqual(pack.facilities.map((f) => f.id).sort(), ['mf-1', 'mf-2', 'mf-3']);
  assert.deepEqual(Object.keys(pack.facilities[0]), ['id', 'name', 'type', 'address', 'lat', 'lng', 'phone', 'open_hours', 'night_shift',
    'trauma_capable', 'verified_by', 'verified_at', 'is_stale', 'days_since_verified', 'is_demo']);
  const f1 = pack.facilities.find((f) => f.id === 'mf-1');
  const f3 = pack.facilities.find((f) => f.id === 'mf-3');
  assert.equal(f1.days_since_verified, 18);
  assert.equal(f1.is_stale, false);
  assert.equal(f3.is_stale, true, 'verified 2026-04-01 is > 90 days old');
  assert.deepEqual(pack.services.map((s) => s.id).sort(), ['ms-1', 'ms-2'], 'inactive service excluded');
  assert.deepEqual(Object.keys(pack.services[0]), ['id', 'name', 'type', 'lat', 'lng', 'phone', 'open_hours', 'is_partner', 'is_demo']);
  const gap = pack.segments.filter((s) => s.edge_id === 'me-cd');
  assert.equal(gap.length, 1, 'uncovered edge gets one synthetic segment');
  assert.equal(gap[0].level, 'uncertain');
  assert.equal(pack.size_bytes, Buffer.byteLength(JSON.stringify(pack), 'utf8'), 'size_bytes is the UTF-8 length of the pack itself');
  assert.equal(NC.backend.shared.buildPack(S, 'nope', 'viettel'), null);
});

test('bundled pack feeds the router: shortest takes the lost north road, signal the covered south road', () => {
  const { ctx, NC } = sandbox();
  const pack = NC.backend.shared.buildPack(ctx.NC_SEED_MINI, 'mini-loop', 'vinaphone', {});
  const g = NC.routing.buildGraph([pack]);
  assert.deepEqual(plain(NC.routing.astar(g, 'mn-a', 'mn-d', { strategy: 'shortest' }).nodeIds), ['mn-a', 'mn-b', 'mn-d']);
  const safe = NC.routing.astar(g, 'mn-a', 'mn-d', { strategy: 'signal' });
  assert.deepEqual(plain(safe.nodeIds), ['mn-a', 'mn-c', 'mn-d']);
  const an = NC.routing.analyze(g, safe);
  near(an.likely_km + an.uncertain_km + an.lost_km, an.length_km, 1e-9);
});

test('facilityMissing / parsePoint (EWKB hex, GeoJSON, WKT) / levelFromRsrp', () => {
  const { ctx, NC } = sandbox();
  const sh = NC.backend.shared;
  assert.deepEqual(plain(sh.facilityMissing(ctx.NC_SEED_MINI.facilities[0])), []);
  assert.deepEqual(plain(sh.facilityMissing(ctx.NC_SEED_MINI.facilities[3])),
    ['address', 'phone', 'open_hours', 'night_shift', 'trauma_capable', 'verified_by', 'verified_at'].filter((k) => true).sort((a, b) => sh.FACILITY_REQUIRED.indexOf(a) - sh.FACILITY_REQUIRED.indexOf(b)));
  assert.deepEqual(plain(sh.facilityMissing({ name: ' ', night_shift: false })).slice(0, 2), ['name', 'address']);
  assert.ok(sh.facilityMissing({ night_shift: false }).indexOf('night_shift') < 0, 'false is a valid boolean');
  // EWKB little-endian point with SRID 4326: POINT(105.5 21.25)
  const buf = Buffer.alloc(25);
  buf.writeUInt8(1, 0); buf.writeUInt32LE(0x20000001, 1); buf.writeUInt32LE(4326, 5); buf.writeDoubleLE(105.5, 9); buf.writeDoubleLE(21.25, 17);
  assert.deepEqual(plain(sh.parsePoint(buf.toString('hex').toUpperCase())), { lat: 21.25, lng: 105.5 });
  assert.deepEqual(plain(sh.parsePoint({ type: 'Point', coordinates: [105.1, 21.1] })), { lat: 21.1, lng: 105.1 });
  assert.deepEqual(plain(sh.parsePoint('SRID=4326;POINT(105 21)')), { lat: 21, lng: 105 });
  assert.equal(sh.parsePoint('zz'), null);
  assert.equal(sh.levelFromRsrp(-104), 'likely');
});

/* ------------------------------------------------------------------ profile */

test('profile.publicText: bilingual header/footer, public layer only, ≤ 600 chars, isComplete', () => {
  const { NC } = sandbox();
  const p = {
    public: { blood_type: 'O+', allergies: 'Penicillin', conditions: 'Hen suyễn', medications: 'Ventolin', notes: '' },
    identity: { full_name: 'Minh Anh', nationality: 'Việt Nam', contact_name: 'Lê Hà', contact_phone: '+84 000 000 001', reveal_code: '1234' },
    updated_at: '2026-09-28T01:00:00Z'
  };
  const txt = NC.profile.publicText(p);
  const lines = txt.split('\n');
  assert.equal(lines[0], 'NOMADCARE – THÔNG TIN Y TẾ KHẨN CẤP / EMERGENCY MEDICAL INFO');
  assert.equal(lines[lines.length - 1], 'Gọi/Call 115');
  assert.ok(txt.indexOf('O+') > 0 && txt.indexOf('Penicillin') > 0 && txt.indexOf('Ventolin') > 0);
  ['Minh Anh', 'Lê Hà', '+84 000 000 001', '1234', 'Việt Nam'].forEach((s) => assert.equal(txt.indexOf(s), -1, 'identity never in QR: ' + s));
  assert.ok(NC.profile.isComplete(p));
  assert.deepEqual(plain(NC.profile.missing({ public: { blood_type: 'unknown', allergies: 'Không' } })), ['conditions', 'medications']);
  const unknown = NC.profile.publicText({ public: { blood_type: 'unknown' } }, { langs: ['en'] });
  assert.ok(/^NOMADCARE – EMERGENCY MEDICAL INFO/.test(unknown));
  assert.ok(unknown.indexOf('Blood type: Unknown') > 0);
  assert.ok(unknown.indexOf('Allergies: Not provided') > 0);
  assert.ok(/Call 115$/.test(unknown));
  const long = 'x'.repeat(190) + ' ';
  const big = NC.profile.publicText({ public: { blood_type: 'AB−', allergies: long, conditions: long, medications: long, notes: 'n'.repeat(290) } });
  assert.ok(big.length <= 600, 'length ' + big.length);
  assert.ok(big.indexOf('AB-') > 0, 'U+2212 minus normalised');
  assert.ok(/Gọi\/Call 115$/.test(big));
});

/* ------------------------------------------------------------------ local server: device ops */

async function registered(NC) {
  const L = NC.backend.local;
  await L.init();
  const dev = await L.register_device('viettel', '2.0.0');
  const sync = (ops) => L.sync_device_ops(dev.device_id, dev.secret, ops);
  return { L, dev, sync };
}
const uid = () => webcrypto.randomUUID();

test('sync_device_ops: auth, idempotency, start/checkin/stop semantics, invalid ops', async () => {
  const { NC } = sandbox();
  const { L, dev, sync } = await registered(NC);
  await assert.rejects(() => L.sync_device_ops(dev.device_id, 'bad', []), (e) => e.code === 'unauthorized_device');
  const sid = uid();
  // Round 2 (R7, = SQL 20260930000100): the recipient phone is required (SMS on the device), the e-mail optional but
  // valid when given; 20261002000100: a Vietnamese 02x landline cannot receive the SMS — refused starts are not retryable
  let r = await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, traveler_name: 'T', recipient_email: 't@example.com', interval_min: 30 } },
    { id: uid(), op: 'buddy.start', data: { session_id: sid, recipient: { phone: '12345', email: 't@example.com' } } },
    { id: uid(), op: 'buddy.start', data: { session_id: sid, recipient: { phone: '+84 912 345 678', email: 'Bad Email' } } },
    { id: uid(), op: 'buddy.start', data: { session_id: sid, recipient: { phone: '024 3826 4444', email: 't@example.com' } } }]);
  assert.deepEqual(plain(r.results.map((x) => [x.status, x.error, x.retryable])),
    [['error', 'recipient_phone_required', false], ['error', 'recipient_phone_invalid', false], ['error', 'recipient_email_invalid', false],
      ['error', 'recipient_phone_not_mobile', false]]);
  assert.equal(r.session, null, 'nothing stored');
  const startOp = { id: uid(), op: 'buddy.start', data: { session_id: sid, traveler_name: 'T', recipient_email: 'T@Example.com', recipient_phone: '0912 345 678',
    interval_min: 30, grace_min: 5, lat: 22.8, lng: 105 } };
  r = await sync([startOp]);
  assert.equal(r.results[0].status, 'ok');
  assert.deepEqual(plain(r.results[0].data.warnings), []);
  assert.equal(r.session.recipient_email, 't@example.com');
  assert.equal(r.session.recipient_phone, '+84912345678', 'phone stored as E.164');
  assert.equal(r.session.id, sid);
  assert.equal(r.session.status, 'active');
  assert.equal(r.session.interval_min, 30);
  r = await sync([startOp]);
  assert.equal(r.results[0].status, 'duplicate', 'same op id is idempotent');
  const evs = (await L._debug.all('checkin_events')).filter((e) => e.session_id === sid);
  assert.equal(evs.filter((e) => e.kind === 'start').length, 1);
  // checkin with a client_ts in the future is clamped to now
  r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'checkin', client_ts: '2099-01-01T00:00:00Z', lat: 22.81, lng: 105.01 } }]);
  assert.equal(r.results[0].status, 'ok');
  assert.ok(Date.parse(r.session.last_checkin_at) <= Date.now() + 1000);
  near(Date.parse(r.session.next_due_at) - Date.parse(r.session.last_checkin_at), 30 * 60000, 1);
  assert.equal(r.session.last_lat, 22.81);
  r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'teleport' } }, { id: 'nope', op: 'buddy.checkin', data: {} },
    { id: uid(), op: 'buddy.checkin', data: { session_id: uid(), kind: 'checkin' } }, { id: uid(), op: 'wat', data: {} }]);
  assert.deepEqual(plain(r.results.map((x) => [x.status, x.error, x.retryable])),
    [['error', 'invalid_kind', false], ['error', 'invalid_op_id', false], ['error', 'session_not_found', false], ['error', 'unknown_op', false]]);
  r = await sync([{ id: uid(), op: 'buddy.stop', data: { session_id: sid } }]);
  assert.equal(r.session.status, 'closed');
  r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'checkin' } }]);
  assert.equal(r.results[0].data.ignored, 'session_closed');
});

test('cron: overdue → (next tick) simulated alert_sent; late check-in resolves + all-clear; SOS alerts', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  const sid = uid();
  const started = new Date(Date.now() - 20 * 60000).toISOString();
  await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'buddy@example.com', recipient_phone: '+84 000 000 001', interval_min: 10, grace_min: 1, started_at: started } }]);
  let t1 = await L.tick({ force: true });
  assert.equal(t1.overdue, 1);
  assert.equal(t1.alerted, 0, 'alert goes out on the next tick');
  let s = (await L._debug.all('buddy_sessions')).find((x) => x.id === sid);
  assert.equal(s.status, 'overdue');
  t1 = await L.tick({ force: true });
  assert.equal(t1.alerted, 1);
  s = (await L._debug.all('buddy_sessions')).find((x) => x.id === sid);
  assert.equal(s.status, 'alerted');
  let evs = (await L._debug.all('checkin_events')).filter((e) => e.session_id === sid);
  const alert = evs.find((e) => e.kind === 'alert_sent');
  assert.equal(alert.meta.provider, 'simulated');
  assert.equal(alert.meta.type, 'overdue');
  // queued check-in arriving later → active + resolved + all-clear
  const r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'checkin', queued: true } }]);
  assert.equal(r.session.status, 'active');
  evs = (await L._debug.all('checkin_events')).filter((e) => e.session_id === sid);
  assert.ok(evs.some((e) => e.kind === 'resolved' && e.meta.by === 'checkin'));
  assert.ok(evs.some((e) => e.kind === 'alert_sent' && e.meta.type === 'resolved'));
  assert.ok(evs.some((e) => e.kind === 'checkin' && e.queued === true));
  // SOS → overdue → alert reason 'sos'
  await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'sos' } }]);
  await L.tick({ force: true });
  evs = (await L._debug.all('checkin_events')).filter((e) => e.session_id === sid && e.kind === 'alert_sent' && e.meta.type === 'overdue');
  assert.equal(evs[evs.length - 1].meta.reason, 'sos');
});

/* ------------------------------------------------------------------ dataservice (NC.data) */

test('NC.data: offline buddy start → checkins queued → online flush → server session updated; local overdue tick', async () => {
  const { NC, net, emitted } = sandbox({ settings: { last_position: { lat: 22.8, lng: 104.98, at: '2026-01-01T00:00:00Z', source: 'sim' } } });
  await NC.data.init();
  assert.equal(NC.data.mode, 'local');
  net.online = false;
  const s = await NC.data.buddy.start({ traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', email: 'le.ha@example.com', phone: '+84 000 000 001' }, interval_min: 1, grace_min: 0 });
  assert.equal(s.status, 'active');
  await NC.data.buddy.checkin({ kind: 'checkin', lat: 22.81, lng: 105 });
  await NC.data.buddy.checkin({ kind: 'location' });
  const ops = await NC.data.outbox();
  assert.deepEqual(plain(ops.map((o) => o.op).sort()), ['buddy.checkin', 'buddy.checkin', 'buddy.start', 'device.register']);
  assert.equal(NC.data.status().outboxCount, 4);
  const offline = await NC.data.flush();
  assert.equal(offline.offline, true);
  const evs = await NC.data.buddy.events();
  assert.ok(evs.every((e) => e.queued === true && e.received_at === null));
  assert.equal(evs[0].lat, 22.8, 'start falls back to settings.last_position');
  assert.equal(evs[2].meta.position, 'last_known', 'location without coordinates uses a last-known position');
  assert.equal(evs[2].lat, 22.81, 'freshest last-known position = the explicit check-in, not the older settings value');
  // back online
  net.online = true;
  const res = await NC.data.flush();
  assert.equal(res.sent, 3);
  assert.equal(NC.data.status().outboxCount, 0);
  assert.ok(NC.data.status().deviceId);
  const srv = (await NC.backend.local._debug.all('buddy_sessions')).find((x) => x.id === s.id);
  assert.equal(srv.status, 'active');
  assert.equal(srv.last_lat, 22.81);
  assert.ok((await NC.data.buddy.events()).filter((e) => e.kind !== 'start').every((e) => e.received_at));
  // local dead-man tick with a fast clock
  let seen = null;
  NC.bus.on('buddy:event', (p) => { if (p.event.kind === 'overdue') seen = p.event; });
  const due = await NC.data.buddy.tick({ now: Date.now() + 5 * 60000 });
  assert.equal(due.status, 'overdue');
  assert.ok(seen && seen.meta.source === 'device');
  assert.equal((await NC.data.outbox()).slice(-1)[0].data.kind, 'overdue');
  await NC.data.flush();
  assert.equal((await NC.backend.local._debug.all('buddy_sessions')).find((x) => x.id === s.id).status, 'overdue');
  // "I'm OK"
  const ok = await NC.data.buddy.resolve();
  assert.equal(ok.status, 'active');
  await NC.data.flush();
  assert.equal((await NC.backend.local._debug.all('buddy_sessions')).find((x) => x.id === s.id).status, 'active');
  ['data:mode', 'data:outbox', 'data:sync', 'buddy:update', 'buddy:event'].forEach((e) => assert.ok(emitted.indexOf(e) >= 0, 'emitted ' + e));
});

test('NC.data: packs (bundled/server/downloaded), listRoutes, nearestFacilities offline, reports, wipePersonal', async () => {
  const { NC, net, settings } = sandbox();
  await NC.data.init();
  net.online = false;
  const bundled = await NC.data.getPack('mini-loop', 'viettel');
  assert.equal(bundled.source, 'bundled');
  assert.equal(bundled.version, 2);
  await assert.rejects(() => NC.data.downloadPack('mini-loop', 'viettel'), (e) => e.code === 'offline');
  const offRoutes = await NC.data.listRoutes();
  assert.equal(offRoutes[0].source, 'bundled');
  assert.equal(offRoutes[0].verified_facilities, 3);
  net.online = true;
  const routes = await NC.data.listRoutes();
  assert.equal(routes[0].source, 'server');
  assert.equal(routes[0].packs.viettel.version, 2);
  assert.equal(routes[0].packs.mobifone, undefined, 'mobifone never published');
  const live = await NC.data.getPack('mini-loop', 'mobifone');
  assert.equal(live.source, 'server');
  assert.equal(live.version, 0, 'unpublished → live build version 0');
  const meta = await NC.data.downloadPack('mini-loop', 'viettel');
  assert.equal(meta.version, 2);
  assert.ok(meta.size_bytes > 1000);
  net.online = false;
  assert.equal((await NC.data.getPack('mini-loop', 'viettel')).source, 'downloaded');
  assert.equal((await NC.data.listDownloadedPacks()).length, 1);
  const near1 = await NC.data.nearestFacilities({ lat: 22.8, lng: 104.98 }, { limit: 2 });
  assert.equal(near1[0].id, 'mf-1');
  assert.ok(near1[0].distance_km < 1);
  assert.equal(near1[0].route_id, 'mini-loop');
  const pharm = await NC.data.nearestFacilities({ lat: 22.8, lng: 104.98 }, { types: ['nha_thuoc'] });
  assert.deepEqual(plain(pharm.map((f) => f.id)), ['mf-3']);
  assert.equal(pharm[0].is_stale, true);
  // community contributions
  await NC.data.submitReport({ kind: 'new', name: 'Trạm mới', type: 'tram_y_te', lat: 22.79, lng: 105.0, note: 'test' });
  assert.equal(await NC.data.logSignal([{ lat: 22.8, lng: 105, rsrp_dbm: -100 }]), null, 'community logs off by default');
  settings.community_logs = true;
  const logged = await NC.data.logSignal([{ lat: 22.8, lng: 105, rsrp_dbm: -100, route_id: 'mini-loop' }]);
  assert.equal(logged.length, 1);
  net.online = true;
  const fl = await NC.data.flush();
  assert.equal(fl.failed, 0);
  await assert.rejects(() => NC.data.admin.listSubmissions({ status: 'pending' }), (e) => e.code === 'forbidden', 'admin API needs the admin session');
  await NC.data.admin.enterDemo();
  const subs = await NC.data.admin.listSubmissions({ status: 'pending' });
  const mine = subs.find((x) => x.payload && x.payload.name === 'Trạm mới');
  assert.ok(mine, 'submission stored with a flat payload');
  const samples = await NC.data.admin.listSamples({ status: 'pending' });
  assert.ok(samples.some((x) => x.source === 'community' && x.level === 'likely'));
  // wipe
  await NC.profile.save({ public: { blood_type: 'O+', allergies: 'a', conditions: 'b', medications: 'c' } });
  await NC.data.buddy.start({ recipient: { email: 'x@example.com', phone: '+84 000 000 002' } });
  await NC.data.wipePersonal();
  assert.equal(await NC.profile.get(), null);
  assert.equal(await NC.data.buddy.current(), null);
  assert.equal((await NC.data.outbox()).length, 0);
  assert.equal(settings.onboarded, false);
  assert.equal((await NC.data.listDownloadedPacks()).length, 1, 'packs are kept');
  const srvSessions = await NC.backend.local._debug.all('buddy_sessions');
  assert.ok(srvSessions.every((x) => x.status === 'closed'), 'open session was closed on the server before wiping');
});

test('NC.data.admin (local): kpis, facility validation, submission review, publish, samples, content, audit', async () => {
  const { NC } = sandbox({ admin: true });
  await NC.data.init();
  await NC.data.admin.enterDemo();
  const k = await NC.data.admin.kpis();
  assert.deepEqual(plain(k.facilities), { verified: 3, pending: 1, rejected: 1, stale: 1, target: 216 });
  assert.equal(k.submissions_pending, 2);
  assert.equal(k.samples.total, 3);
  assert.equal(k.buddy.overdue, 1);
  assert.equal(k.routes[0].verified, 3);
  const list = await NC.data.admin.listFacilities({ route_id: 'mini-loop', stale: true });
  assert.deepEqual(plain(list.map((f) => f.id)), ['mf-3']);
  assert.equal((await NC.data.admin.listFacilities({ q: 'benh vien' })).length, 1, 'diacritic-insensitive search');
  await assert.rejects(() => NC.data.admin.upsertFacility({ id: 'mf-4', status: 'verified' }), (e) => e.code === 'incomplete' && e.missing.indexOf('phone') >= 0);
  await assert.rejects(() => NC.data.admin.setFacilityStatus('mf-4', 'verified'), (e) => e.code === 'incomplete');
  const ok = await NC.data.admin.upsertFacility({ id: 'mf-4', address: 'Đèo B', phone: '+84 000 000 004', open_hours: '08:00–16:00', night_shift: false,
    trauma_capable: false, verified_by: 'Nhóm Stormbreakers', verified_at: '2026-09-27', status: 'verified' });
  assert.equal(ok.status, 'verified');
  assert.equal(ok.is_stale, false);
  // submission review
  const rv = await NC.data.admin.reviewSubmission('msub-1', 'approved', 'Đã gọi xác minh');
  assert.equal(rv.status, 'approved');
  const created = (await NC.data.admin.listFacilities({ status: 'pending' })).find((f) => f.id === rv.facility_id);
  assert.equal(created.source, 'community');
  assert.equal(created.route_id, 'mini-loop', 'route inferred from the nearest edge');
  const closed = await NC.data.admin.reviewSubmission('msub-2', 'approved');
  assert.equal(closed.facility_id, 'mf-3');
  assert.equal((await NC.data.admin.listFacilities({ q: 'Nhà thuốc C' }))[0].status, 'pending', 'closed report → back to pending');
  // publish → version bump, pack contains the newly verified facility
  const pub = await NC.data.admin.publishPack('mini-loop', 'viettel', 'test');
  assert.equal(pub.version, 3);
  const packs = await NC.data.admin.listPacks();
  assert.equal(packs.filter((p) => p.route_id === 'mini-loop' && p.carrier === 'viettel' && p.is_current).length, 1);
  const served = await NC.backend.local.get_data_pack('mini-loop', 'viettel');
  assert.equal(served.version, 3);
  assert.ok(served.facilities.some((f) => f.id === 'mf-4'));
  assert.ok(!served.facilities.some((f) => f.id === 'mf-3'));
  // samples, content, audit
  assert.equal(await NC.data.admin.reviewSamples([3], 'approved'), 1);
  await assert.rejects(() => NC.data.admin.approveContentRelease(1, ''), (e) => e.code === 'approver_required');
  const rel = await NC.data.admin.approveContentRelease(1, 'BS. Cố vấn');
  assert.equal(rel.status, 'approved');
  assert.equal((await NC.data.contentRelease()).status, 'approved');
  const audit = await NC.data.admin.audit({ limit: 50 });
  assert.ok(audit.some((a) => a.entity === 'data_packs' && a.action === 'publish'));
  assert.ok(audit.some((a) => a.entity === 'facilities' && a.action === 'status'));
  // buddy admin
  const sessions = await NC.data.admin.listBuddySessions({ status: 'overdue' });
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].overdue_by_min > 0);
  const trig = await NC.data.admin.triggerAlert(sessions[0].id);
  assert.equal(trig.sent, 1);
  const res = await NC.data.admin.resolveSession(sessions[0].id, 'Đã liên lạc được');
  assert.equal(res.status, 'closed');
  assert.equal(res.previous_status, 'alerted');
  const evs = await NC.data.admin.listBuddyEvents(sessions[0].id);
  assert.deepEqual(plain(evs.map((e) => e.kind)), ['start', 'alert_sent', 'resolved', 'alert_sent']);
  // subscribe receives realtime changes
  const got = [];
  const off = NC.data.admin.subscribe((m) => got.push(m.table));
  await new Promise((r) => setTimeout(r, 5));
  await NC.data.admin.upsertService({ name: 'Rental X', type: 'rental', lat: 22.8, lng: 105 });
  off();
  assert.ok(got.indexOf('services') >= 0);
  // reset
  await NC.data.admin.resetDemo();
  assert.equal((await NC.data.admin.kpis()).facilities.verified, 3);
});

/* ------------------------------------------------------------------ local server: wave-3 hardening (= SQL 20260928000100) */

/* Same table as tools/db-test/tests.sql 'norm_phone' (app_private.norm_phone): keep both in sync. */
const PHONE_CASES = [
  ['+84 912 345 678', '+84912345678'], ['0912 345 678', '+84912345678'], ['0912-345-678', '+84912345678'],
  ['(+84) 912.345.678', '+84912345678'], ['+84 (0) 912 345 678', '+84912345678'], ['+84 0912 345 678', '+84912345678'],
  ['0084 912 345 678', '+84912345678'], ['0912345678', '+84912345678'], ['+84912345678', '+84912345678'],
  ['+84\u00a0912\u00a0345\u00a0678', '+84912345678'],
  ['+84 000 000 001', '+84000000001'], ['+84000000001', '+84000000001'], ['0 000 000 012', null],
  ['024 3826 4444', '+842438264444'], ['+84 24 3826 4444', '+842438264444'],
  ['+1 (415) 555-2671', '+14155552671'], ['+44 20 7946 0958', '+442079460958'], ['0049 30 123456', '+4930123456'],
  ['+84 912 345 6789', null], ['912345678', null], ['84912345678', null], ['+84 123 456 789', null],
  ['0123 456 789', null], ['+84 912 345', null], ['abc', null], ['+84 912 345 678 ext 5', null], ['', null],
  ['   ', null], ['+0 123 4567 890', null], ['+123 4567', null], ['+1234567890123456', null],
  ['++84 912 345 678', null], ['+84 000 000 123', null], ['+84 912 345 678 +1', null], [null, null]
];

test('normPhone (shared): VN national / +84 / 00 / international → E.164, demo numbers, invalid input (= SQL norm_phone)', () => {
  const { NC } = sandbox();
  const sh = NC.backend.shared;
  const bad = PHONE_CASES.filter(([raw, want]) => sh.normPhone(raw).e164 !== want).map(([raw]) => raw + ' → ' + sh.normPhone(raw).e164);
  assert.deepEqual(bad, [], 'mismatches');
  assert.deepEqual(plain(sh.normPhone('+84 000 000 009')), { e164: '+84000000009', valid: true, isDemo: true, empty: false, landline: false });
  assert.deepEqual(plain(sh.normPhone('  ')), { e164: null, valid: false, isDemo: false, empty: true, landline: false });
  assert.deepEqual(plain(sh.normPhone('+84 1')), { e164: null, valid: false, isDemo: false, empty: false, landline: false });
  assert.deepEqual(plain(sh.normPhone('024 3826 4444')), { e164: '+842438264444', valid: false, isDemo: false, empty: false, landline: true },
    'a 02x landline is normalised (legacy display) but not valid: it cannot receive the SMS');
  assert.equal(sh.normPhone(912345678).e164, null, 'a bare number without prefix is not guessed');
  assert.ok(sh.validEmail('a.b+c@gmail.com') && !sh.validEmail('a@b') && !sh.validEmail('a b@c.com') && !sh.validEmail(null));
});

/* Same table as tools/db-test/tests.sql 'valid_phone / phone_is_landline' (20261002000100): keep both in sync.
   [raw, valid (accepted for a new Buddy session), landline (Vietnamese 02x)] */
const PHONE_KIND_CASES = [
  ['0312 345 678', true, false], ['0562 345 678', true, false], ['0701 234 567', true, false], ['0812 345 678', true, false],
  ['0987 654 321', true, false], ['+84 326 789 012', true, false], ['0084 912 345 678', true, false], ['+84 (0) 912 345 678', true, false],
  ['024 3826 4444', false, true], ['028 3829 5555', false, true], ['0203 3825 111', false, true], ['+84 24 3826 4444', false, true],
  ['0084 28 3829 5555', false, true], ['+84 (0) 24 3826 4444', false, true], ['+842438264444', false, true],
  ['+84 000 000 001', true, false], ['+44 20 7946 0958', true, false], ['+1 (415) 555-2671', true, false], ['0049 30 123456', true, false],
  ['024 382 6444', false, false], ['0123 456 789', false, false], ['12345', false, false], ['', false, false], [null, false, false]
];

test('normPhone (shared, 20261002000100): VN mobiles 03x–09x valid, 02x landlines flagged and refused, international / demo valid (= SQL valid_phone / phone_is_landline)', () => {
  const { NC } = sandbox();
  const sh = NC.backend.shared;
  const bad = PHONE_KIND_CASES.filter(([raw, valid, land]) => sh.normPhone(raw).valid !== valid || sh.normPhone(raw).landline !== land)
    .map(([raw]) => raw + ' → ' + JSON.stringify(plain(sh.normPhone(raw))));
  assert.deepEqual(bad, [], 'mismatches');
});

test('buddy.start (20261002000100): 02x landline refused for a new session, mobile / international / demo accepted, legacy landline session keeps working', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  const start = (data) => ({ id: uid(), op: 'buddy.start', data: Object.assign({ interval_min: 60 }, data) });
  let r = await sync([start({ recipient: { name: 'Mẹ', phone: '024 3826 4444' } }),
    start({ recipient_phone: '+84 28 3829 5555', recipient_email: 'real.person@gmail.com' }),
    start({ recipient: { phone: '0203 3825 111', email: 'not an email' } })]);
  assert.deepEqual(plain(r.results.map((x) => [x.status, x.error, x.retryable])),
    [['error', 'recipient_phone_not_mobile', false], ['error', 'recipient_phone_not_mobile', false], ['error', 'recipient_email_invalid', false]],
    'landline → recipient_phone_not_mobile (not retryable); a bad e-mail is reported first, as in SQL');
  assert.equal(r.session, null, 'a refused start stores nothing');
  for (const [raw, e164] of [['0362 123 456', '+84362123456'], ['+44 20 7946 0958', '+442079460958'], ['+84 000 000 021', '+84000000021']]) {
    r = await sync([start({ recipient: { name: 'Mẹ', phone: raw } })]);
    assert.deepEqual(plain([r.results[0].status, r.session.recipient_phone]), ['ok', e164], raw + ' accepted');
  }
  // a session created before 20261002000100 that stored a landline: re-sent start + check-ins keep working, phone kept
  const leg = uid();
  await sync([start({ session_id: leg, recipient_phone: '+84 000 000 032' })]);
  const row = (await L._debug.all('buddy_sessions')).find((x) => x.id === leg);
  row.recipient_phone = '+842438264444';
  await L._debug.put('buddy_sessions', row);
  r = await sync([start({ session_id: leg, recipient_phone: '024 3826 4444', interval_min: 90 }),
    { id: uid(), op: 'buddy.checkin', data: { session_id: leg, kind: 'checkin' } }]);
  assert.deepEqual(plain(r.results.map((x) => x.status)), ['ok', 'ok']);
  assert.deepEqual(plain([r.session.id, r.session.status, r.session.recipient_phone, r.session.interval_min]), [leg, 'active', '+842438264444', 90],
    'legacy landline session: re-sent start keeps the stored phone, check-in accepted');
  r = await sync([start({ session_id: leg, recipient_phone: '028 3829 5555', interval_min: 60 })]);
  assert.equal(r.session.recipient_phone, '+842438264444', 'a re-sent landline never replaces the stored phone');
});

test('buddy.start: names cleaned, 24 h cap, per-device limit (demo domains exempt), late re-send keeps its successor', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  const sh = NC.backend.shared;
  assert.equal(sh.cleanName('Anna\n\tBell http://evil.example.org/x www.phish.io bob@evil.com verify-at evil.example.org now'), 'Anna Bell verify-at now');
  assert.equal(sh.cleanName('Dr.Smith Nguyễn Văn'), 'Dr.Smith Nguyễn Văn');
  assert.equal(Array.from(sh.cleanName('Ă'.repeat(100))).length, 60);
  assert.equal(sh.cleanName('https://x.co'), null);
  assert.ok(sh.isReservedEmail('a@example.com') && sh.isReservedEmail('c@demo.test') && !sh.isReservedEmail('d@gmail.com') && !sh.isReservedEmail('e@notexample.com'));
  const sid = uid();
  let r = await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, traveler_name: 'Lan http://evil.example.org Trần ' + 'x'.repeat(80),
    recipient: { name: 'Mẹ www.x.com', email: 'QA-Limit@Gmail.com', phone: '0912 345 678' }, started_at: '2020-01-01T00:00:00Z', interval_min: 60 } }]);
  assert.equal(r.results[0].status, 'ok');
  assert.deepEqual(plain(r.results[0].data.warnings), ['traveler_name_sanitized']);
  assert.ok(/^Lan Trần x+$/.test(r.session.traveler_name) && r.session.traveler_name.length === 60);
  assert.equal(r.session.recipient_name, 'Mẹ');
  near(Date.parse(r.session.started_at), Date.now() - 86400000, 5000, 'backdated start capped to 24 h');
  for (let i = 1; i <= 4; i++) {
    r = await sync([{ id: uid(), op: 'buddy.start', data: { recipient_email: 'qa-limit' + i + '@gmail.com', recipient_phone: '+84 000 000 013' } }]);
    assert.equal(r.results[0].status, 'ok', 'session ' + (i + 1) + '/5');
  }
  r = await sync([{ id: uid(), op: 'buddy.start', data: { recipient_email: 'qa-limit9@gmail.com', recipient_phone: '+84 000 000 013' } }]);
  // permanent (= SQL 54000): a retried start would land later, backdated and already overdue
  assert.deepEqual(plain([r.results[0].status, r.results[0].error, r.results[0].retryable]), ['error', 'rate_limited', false]);
  const friend = uid();
  r = await sync([{ id: uid(), op: 'buddy.start', data: { session_id: friend, recipient_email: 'friend@example.com', recipient_phone: '+84 000 000 014' } }]);
  assert.equal(r.results[0].status, 'ok', 'demo recipients are not limited');
  // phone-only sessions (no e-mail) can never make the server send anything: not counted, not limited
  const solo = uid();
  r = await sync([{ id: uid(), op: 'buddy.start', data: { session_id: solo, recipient_phone: '+84 987 654 321' } }]);
  assert.deepEqual(plain([r.results[0].status, r.session.recipient_email, r.session.recipient_phone]), ['ok', null, '+84987654321'], 'phone-only start not limited');
  r = await sync([{ id: uid(), op: 'buddy.start', data: { recipient_email: 'qa-limit9@gmail.com', recipient_phone: '+84 000 000 013' } }]);
  assert.equal(r.results[0].error, 'rate_limited', 'phone-only / demo sessions are not counted: a 6th real mailbox is still limited');
  r = await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'qa-limit@gmail.com', interval_min: 45 } }]);
  assert.equal(r.results[0].status, 'ok');
  assert.equal(r.session.id, solo, 'late re-send of a closed session does not close its successor');
  const old = (await L._debug.all('buddy_sessions')).find((x) => x.id === sid);
  assert.equal(old.status, 'closed');
  assert.deepEqual([old.recipient_phone, old.interval_min], ['+84912345678', 45], 'a re-sent start without a phone (legacy client) keeps the stored phone');
});

test('SOS: alert_reason sos (kept while alerted, e-mail worded SOS), check-in clears it, SOS after an overdue alert re-alerts', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  await NC.backend.local.admin.enterDemo();
  const sid = uid();
  const sos = { id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'sos', lat: 22.9, lng: 105.1 } };
  await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'sos@example.com', recipient_phone: '+84 000 000 015', interval_min: 60, share_public_medical: true, public_medical: { blood_type: 'B+' } } }]);
  let r = await sync([sos]);
  assert.deepEqual(plain([r.session.status, r.session.alert_reason, r.results[0].data.alert_reason]), ['overdue', 'sos', 'sos']);
  let row = (await L.admin.listBuddySessions()).find((x) => x.id === sid);
  assert.equal(row.alert_reason, 'sos');
  assert.ok(row.sos_at, 'sos_at exposed');
  await L.tick({ force: true });
  row = (await L.admin.listBuddySessions()).find((x) => x.id === sid);
  assert.deepEqual(plain([row.status, row.alert_reason, row.last_event_kind]), ['alerted', 'sos', 'alert_sent'], 'still SOS after the alert went out');
  let evs = await L.admin.listBuddyEvents(sid);
  assert.equal(evs.filter((e) => e.kind === 'alert_sent').pop().meta.reason, 'sos');
  r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'sos' } }]);
  assert.equal(r.session.status, 'alerted', 'a second SOS after the SOS e-mail changes nothing');
  await new Promise((res) => setTimeout(res, 5)); // the check-in comes after the SOS events (ms timestamps)
  r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'checkin' } }]);
  assert.deepEqual(plain([r.session.status, r.session.alert_reason]), ['active', null]);
  // missed check-in → overdue reason 'overdue' → alerted → SOS → overdue again with reason sos
  const s = (await L._debug.all('buddy_sessions')).find((x) => x.id === sid);
  s.next_due_at = new Date(Date.now() - 30 * 60000).toISOString();
  await L._debug.put('buddy_sessions', s);
  await L.tick({ force: true });
  assert.equal((await L.admin.listBuddySessions()).find((x) => x.id === sid).alert_reason, 'overdue');
  await L.tick({ force: true });
  evs = await L.admin.listBuddyEvents(sid);
  assert.equal(evs.filter((e) => e.kind === 'alert_sent').pop().meta.reason, 'overdue');
  r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'sos' } }]);
  assert.deepEqual(plain([r.session.status, r.session.alert_reason, r.session.alerted_at]), ['overdue', 'sos', null], 'SOS re-arms the alert');
  await L.tick({ force: true });
  evs = await L.admin.listBuddyEvents(sid);
  assert.equal(evs.filter((e) => e.kind === 'alert_sent').pop().meta.reason, 'sos', 'second e-mail worded as SOS');
  // stop: medical layer dropped at once (retention)
  await sync([{ id: uid(), op: 'buddy.stop', data: { session_id: sid } }]);
  const closed = (await L._debug.all('buddy_sessions')).find((x) => x.id === sid);
  assert.deepEqual(plain([closed.status, closed.public_medical, closed.alert_reason]), ['closed', null, null]);
});

test('buddy.update: withdraw / give the medical layer of the open session (no event); closed → ignored', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  const sid = uid();
  await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'upd@example.com', recipient_phone: '+84 000 000 016', share_public_medical: true, public_medical: { blood_type: 'O+', allergies: 'Penicillin' } } }]);
  const row = () => L._debug.all('buddy_sessions').then((rows) => rows.find((x) => x.id === sid));
  assert.equal((await row()).public_medical.allergies, 'Penicillin');
  const n = (await L._debug.all('checkin_events')).filter((e) => e.session_id === sid).length;
  let r = await sync([{ id: uid(), op: 'buddy.update', data: { session_id: sid, share_public_medical: false, public_medical: { blood_type: 'O+' }, client_ts: new Date().toISOString() } }]);
  assert.deepEqual(plain([r.results[0].status, r.results[0].data.has_public_medical, r.session.share_public_medical]), ['ok', false, false]);
  assert.equal((await row()).public_medical, null);
  assert.equal((await L._debug.all('checkin_events')).filter((e) => e.session_id === sid).length, n, 'no event');
  r = await sync([{ id: uid(), op: 'buddy.update', data: { session_id: sid, share_public_medical: true, public_medical: { blood_type: 'A+', full_name: 'LEAK' } } }]);
  assert.deepEqual(plain((await row()).public_medical), { blood_type: 'A+' }, 'only the sanitised public layer');
  await sync([{ id: uid(), op: 'buddy.stop', data: { session_id: sid } }]);
  r = await sync([{ id: uid(), op: 'buddy.update', data: { session_id: sid, share_public_medical: true, public_medical: { blood_type: 'A+' } } }]);
  assert.equal(r.results[0].data.ignored, 'session_closed');
  assert.equal((await row()).public_medical, null);
});

test('device.erase: device, ops, sessions and events deleted; reports unlinked; tombstone replay is a no-op', async () => {
  const { NC } = sandbox();
  const { L, dev, sync } = await registered(NC);
  const sid = uid();
  const sub = 'erase-' + uid();
  await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'erase@example.com', recipient_phone: '+84 000 000 018', share_public_medical: true, public_medical: { blood_type: 'O+' } } },
    { id: uid(), op: 'report.submit', data: { id: sub, kind: 'new', lat: 22.9, lng: 105.1, name: 'Erase report' } }]);
  let r = await sync([{ id: uid(), op: 'buddy.stop', data: { session_id: sid } }, { id: uid(), op: 'device.erase', data: { client_ts: new Date().toISOString() } },
    { id: uid(), op: 'buddy.checkin', data: { session_id: sid } }]);
  assert.deepEqual(plain(r.results.map((x) => x.status)), ['ok', 'ok', 'error']);
  assert.deepEqual(plain([r.results[1].data.erased, r.results[1].data.sessions_deleted, r.results[1].data.submissions_unlinked]), [true, 1, 1]);
  assert.deepEqual(plain([r.results[2].error, r.results[2].retryable]), ['device_erased', false]);
  assert.equal(r.session, null);
  const all = async (t) => (await L._debug.all(t));
  assert.ok(!(await all('devices')).some((d) => d.id === dev.device_id));
  assert.ok(!(await all('device_ops')).some((o) => o.device_id === dev.device_id));
  assert.ok(!(await all('buddy_sessions')).some((s) => s.device_id === dev.device_id));
  assert.ok(!(await all('checkin_events')).some((e) => e.session_id === sid));
  assert.equal((await all('facility_submissions')).find((x) => x.id === sub).device_id, null);
  assert.ok(!JSON.stringify(await all('audit_log')).includes(dev.device_id), 'device id gone from the audit snapshots');
  r = await sync([{ id: uid(), op: 'buddy.stop', data: { session_id: sid } }, { id: uid(), op: 'device.erase', data: {} }]);
  assert.deepEqual(plain(r.results.map((x) => [x.status, x.error || null])), [['error', 'device_erased'], ['ok', null]]);
  assert.equal(r.results[1].data.already_erased, true);
  r = await L.sync_device_ops(uid(), 'whatever', [{ id: uid(), op: 'device.erase' }]);
  assert.equal(r.results[0].status, 'ok', 'unknown device + device.erase → no-op success');
  await assert.rejects(() => sync([{ id: uid(), op: 'buddy.checkin', data: {} }]), (e) => e.code === 'unauthorized_device');
  const other = await L.register_device('viettel', '2.0.0');
  await assert.rejects(() => L.sync_device_ops(other.device_id, 'wrong', [{ id: uid(), op: 'device.erase' }]), (e) => e.code === 'unauthorized_device');
});

test('alert quota: 3 e-mails per recipient / 24 h (one rate_limited marker), manual alerts exempt + attributed, failures reported', async () => {
  const { NC } = sandbox();
  const L = NC.backend.local;
  await L.init();
  await L.admin.enterDemo('qa-admin@nomadcare.test');
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const d = await L.register_device('viettel', '2.0.0');
    const sid = uid();
    await L.sync_device_ops(d.device_id, d.secret, [{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'QA-Victim@Gmail.com', recipient_phone: '+84 000 000 017', interval_min: 30, grace_min: 0 } }]);
    ids.push(sid);
  }
  for (const s of (await L._debug.all('buddy_sessions')).filter((x) => ids.indexOf(x.id) >= 0)) {
    s.next_due_at = new Date(Date.now() - 5 * 60000).toISOString();
    await L._debug.put('buddy_sessions', s);
  }
  assert.equal((await L.tick({ force: true })).overdue, 4);
  const t2 = await L.tick({ force: true });
  assert.equal(t2.alerted, 3, 'only 3 alert e-mails to the same recipient');
  const evs = (await L._debug.all('checkin_events')).filter((e) => ids.indexOf(e.session_id) >= 0);
  const limited = evs.filter((e) => e.kind === 'alert_failed' && e.meta.reason === 'rate_limited');
  assert.equal(limited.length, 1);
  assert.equal(limited[0].meta.limit, 'recipient_24h');
  await L.tick({ force: true });
  assert.equal((await L._debug.all('checkin_events')).filter((e) => e.kind === 'alert_failed' && e.meta.reason === 'rate_limited').length, 1, 'one marker per episode');
  const lim = limited[0].session_id;
  assert.equal((await L._debug.all('buddy_sessions')).find((x) => x.id === lim).status, 'overdue', 'held back, still overdue');
  // manual alert: never limited, attributed to the admin
  const trig = await L.admin.triggerAlert(lim);
  assert.deepEqual(plain([trig.ok, trig.sent, trig.failed, trig.results[0].status]), [true, 1, 0, 'sent']);
  const audit = await L.admin.audit({ limit: 20 });
  assert.ok(audit.some((a) => a.entity === 'buddy_sessions' && a.entity_id === lim && a.details.to === 'alerted' && a.actor_label === 'qa-admin@nomadcare.test'),
    'manual alert audited with the admin, not "system"');
  const sent = (await L.admin.listBuddyEvents(lim)).filter((e) => e.kind === 'alert_sent').pop();
  assert.deepEqual(plain([sent.meta.trigger, sent.meta.actor]), ['manual', 'qa-admin@nomadcare.test']);
  // a failed e-mail is reported as failed (not "nothing to send")
  L.failAlerts = 'RESEND_API_KEY is not set';
  const fail = await L.admin.triggerAlert(ids.find((x) => x !== lim));
  L.failAlerts = null;
  assert.deepEqual(plain([fail.ok, fail.processed, fail.sent, fail.failed, fail.error, fail.results[0].status]),
    [false, 1, 0, 1, 'RESEND_API_KEY is not set', 'failed']);
  // global hourly cap
  L.limits.alert_global_1h = 0;
  const d5 = await L.register_device('viettel', '2.0.0');
  const s5 = uid();
  await L.sync_device_ops(d5.device_id, d5.secret, [{ id: uid(), op: 'buddy.start', data: { session_id: s5, recipient_email: 'someone@gmail.com', recipient_phone: '+84 000 000 019', interval_min: 30, grace_min: 0 } },
    { id: uid(), op: 'buddy.checkin', data: { session_id: s5, kind: 'sos' } }]);
  await L.tick({ force: true });
  assert.equal((await L.admin.listBuddyEvents(s5)).filter((e) => e.kind === 'alert_failed' && e.meta.limit === 'global_1h').length, 1, 'global cap');
});

test('alert ledger: quotas survive device.erase, count all-clear e-mails and Gmail aliases; no plaintext; pruned after 48 h', async () => {
  const { NC } = sandbox();
  const L = NC.backend.local;
  const sh = NC.backend.shared;
  await L.init();
  assert.equal(sh.normalizeEmail('  T.a.r.g.e.t+promo@GoogleMail.com. '), 'target@gmail.com');
  assert.equal(sh.normalizeEmail('Bob.Smith+x@Outlook.com'), 'bob.smith@outlook.com', 'dots only ignored for Gmail');
  assert.equal(sh.normalizeEmail('+only@gmail.com'), '+only@gmail.com');
  assert.equal(sh.normalizeEmail(''), null);
  // attacker loop (reverify-admin-security): start → overdue → e-mail → device.erase, again and again
  const cycle = async (email) => {
    const d = await L.register_device('viettel', '2.0.0');
    const sid = uid();
    await L.sync_device_ops(d.device_id, d.secret, [{ id: uid(), op: 'buddy.start', data: { session_id: sid, traveler_name: 'Victim',
      recipient: { name: 'V', email, phone: '+84 000 000 020' }, interval_min: 1, grace_min: 0, started_at: '2020-01-01T00:00:00Z' } }]);
    await L.tick({ force: true });
    await L.tick({ force: true });
    const evs = (await L._debug.all('checkin_events')).filter((e) => e.session_id === sid);
    const er = await L.sync_device_ops(d.device_id, d.secret, [{ id: uid(), op: 'device.erase', data: {} }]);
    return { sent: evs.some((e) => e.kind === 'alert_sent'), limited: evs.some((e) => e.kind === 'alert_failed' && e.meta.reason === 'rate_limited'),
      clear: er.results[0].data.all_clear_sent };
  };
  const runs = [];
  for (let i = 0; i < 6; i++) runs.push(await cycle(['erase.victim@gmail.com', 'Erase.Victim+' + i + '@gmail.com', 'e.r.a.s.e.victim@googlemail.com'][i % 3]));
  // alert (1) + all-clear on erase (2), alert (3) + all-clear (4), then every later alert is held back
  assert.deepEqual(plain(runs.map((x) => x.sent)), [true, true, false, false, false, false], 'erase no longer resets the recipient quota');
  assert.deepEqual(plain(runs.map((x) => x.limited)), [false, false, true, true, true, true]);
  assert.deepEqual(plain(runs.map((x) => x.clear)), [1, 1, 0, 0, 0, 0]);
  const ledger = await L._debug.ledger();
  assert.deepEqual(plain(ledger.map((x) => x.kind).sort()), ['alert', 'alert', 'all_clear', 'all_clear'], 'all-clear e-mails are in the ledger');
  assert.ok(ledger.every((x) => /^[0-9a-f]{64}$/.test(x.recipient_hash) || /^fnv/.test(x.recipient_hash)), 'hashed recipient');
  assert.ok(!/victim|gmail/i.test(JSON.stringify(ledger)), 'no plaintext address in the ledger');
  assert.equal(new Set(ledger.map((x) => x.recipient_hash)).size, 1, 'aliases (+tag, dots, googlemail.com) are one recipient');
  // the global hourly cap is not reset by erasing either
  L.limits.alert_global_1h = ledger.length + 1;
  const g1 = await cycle('global.one@gmail.com');
  const g2 = await cycle('global.two@gmail.com');
  assert.deepEqual(plain([g1.sent, g2.sent, g2.limited]), [true, false, true], 'global cap counts erased sessions and all-clears');
  L.limits.alert_global_1h = 50;
  // retention: ledger rows older than 48 h are pruned
  await L._debug.put('meta', { key: 'alert_ledger:old', value: { recipient_hash: 'x'.repeat(64), kind: 'alert', status: 'sent',
    created_at: new Date(Date.now() - 49 * 3600000).toISOString() } });
  const r = await L.cleanup();
  assert.equal(r.ledger_deleted, 1);
  assert.ok(!(await L._debug.ledger()).some((x) => x.key === 'alert_ledger:old'));
});

test('routes: region_en in list_routes and packs; an older local server gets it on the next start', async () => {
  const { ctx, NC } = sandbox();
  ctx.NC_SEED_MINI.routes[0].region_en = 'Tuyen Quang (test, EN)';
  const L = NC.backend.local;
  await L.init();
  const rows = await L.list_routes();
  assert.equal(rows[0].region_en, 'Tuyen Quang (test, EN)');
  assert.equal((await L.get_data_pack('mini-loop', 'viettel')).route.region_en, 'Tuyen Quang (test, EN)');
  // simulate a browser seeded before region_en existed
  const route = (await L._debug.all('routes')).find((x) => x.id === 'mini-loop');
  delete route.region_en;
  await L._debug.put('routes', route);
  const pk = (await L._debug.all('data_packs')).find((x) => x.route_id === 'mini-loop' && x.carrier === 'viettel' && x.is_current);
  delete pk.payload.route.region_en;
  pk.payload.size_bytes = NC.backend.shared.finalizeSize(pk.payload).size_bytes;
  await L._debug.put('data_packs', pk);
  assert.equal((await L.list_routes())[0].region_en, null);
  assert.equal(await L._debug.upgradeSeed(), true);
  assert.equal((await L.list_routes())[0].region_en, 'Tuyen Quang (test, EN)');
  const p = await L.get_data_pack('mini-loop', 'viettel');
  assert.deepEqual(Object.keys(p.route).slice(3, 5), ['region', 'region_en']);
  assert.equal(p.size_bytes, Buffer.byteLength(JSON.stringify(p), 'utf8'), 'size_bytes recomputed');
  assert.equal(await L._debug.upgradeSeed(), false, 'idempotent');
});

test('retention: nc_cleanup deletes sessions closed > 30 days ago and idle > 90 days (with events)', async () => {
  const { NC } = sandbox();
  const L = NC.backend.local;
  await L.init();
  const day = 86400000;
  const iso = (ms) => new Date(Date.now() - ms).toISOString();
  await L._debug.put('buddy_sessions', { id: 'old', device_id: 'd', status: 'closed', started_at: iso(32 * day), closed_at: iso(31 * day), updated_at: iso(31 * day) });
  await L._debug.put('buddy_sessions', { id: 'recent', device_id: 'd', status: 'closed', started_at: iso(11 * day), closed_at: iso(10 * day), updated_at: iso(10 * day) });
  await L._debug.put('buddy_sessions', { id: 'idle', device_id: 'd', status: 'active', started_at: iso(100 * day), updated_at: iso(95 * day) });
  await L._debug.put('checkin_events', { id: 'e1', session_id: 'old', kind: 'start', client_ts: iso(32 * day) });
  await L._debug.put('checkin_events', { id: 'e2', session_id: 'idle', kind: 'start', client_ts: iso(100 * day) });
  const r = await L.cleanup();
  assert.deepEqual(plain([r.sessions_deleted, r.events_deleted]), [2, 2]);
  assert.deepEqual(plain((await L._debug.all('buddy_sessions')).map((s) => s.id)), ['recent']);
});

test('admin (local): gate, re-approval reuse, future date, Vietnam box, sample audit, no-op publish, pack changes', async () => {
  const { NC } = sandbox({ admin: true });
  await NC.data.init();
  const A = NC.data.admin;
  // NC.data.admin.packChanges is proxied once dataservice lists it; the backend method exists either way
  const packChanges = (r, c) => (A.packChanges ? A.packChanges(r, c) : NC.data.backend().admin.packChanges(r, c));
  await assert.rejects(() => A.listFacilities({}), (e) => e.code === 'forbidden', 'no admin session → forbidden');
  await A.enterDemo();
  assert.ok((await A.listFacilities({})).length > 0);
  await A.signOut();
  await assert.rejects(() => A.listBuddySessions(), (e) => e.code === 'forbidden', 'signed out → forbidden');
  await A.enterDemo();
  // approve → reopen → approve: one facility
  const r1 = await A.reviewSubmission('msub-1', 'approved', 'ok');
  await A.reviewSubmission('msub-1', 'pending', 'reopen');
  const r2 = await A.reviewSubmission('msub-1', 'approved', 'again');
  assert.equal(r2.facility_id, r1.facility_id);
  assert.equal((await A.listFacilities({})).filter((f) => /#msub-1/.test(f.notes || '')).length, 1);
  await A.deleteFacility(r1.facility_id);
  await A.reviewSubmission('msub-1', 'pending');
  assert.equal((await A.reviewSubmission('msub-1', 'approved')).facility_id, r1.facility_id, 'recreated under the same id');
  // closed report approved twice: note once
  await A.reviewSubmission('msub-2', 'approved');
  await A.reviewSubmission('msub-2', 'pending');
  await A.reviewSubmission('msub-2', 'approved');
  assert.equal(((await A.listFacilities({ q: 'Nhà thuốc C' }))[0].notes.match(/\(#msub-2\)/g) || []).length, 1);
  // dates and coordinates
  await assert.rejects(() => A.upsertFacility({ id: 'mf-1', verified_at: '2031-01-01' }), (e) => e.code === 'invalid_date');
  const tomorrow = NC.backend.shared.todayVn();
  assert.ok(await A.upsertFacility({ id: 'mf-1', verified_at: tomorrow }), 'today (VN) accepted');
  const full = { name: 'QA zero', type: 'tram_y_te', route_id: 'mini-loop', address: 'x', phone: '+84 000 000 099', open_hours: '24/7', night_shift: true,
    trauma_capable: false, lat: 0, lng: 0, verified_by: 'QA', verified_at: tomorrow, status: 'verified' };
  await assert.rejects(() => A.upsertFacility(full), (e) => e.code === 'invalid_coordinates' && e.reason === 'outside_vietnam');
  assert.equal((await A.upsertFacility(Object.assign({}, full, { status: 'pending' }))).status, 'pending', 'drafts may hold any point');
  // sample review audit (one aggregated row, changed rows only)
  const n0 = (await A.audit({ limit: 500 })).filter((a) => a.entity === 'signal_samples').length;
  assert.equal(await A.reviewSamples([1, 2, 3], 'rejected'), 3);
  assert.equal(await A.reviewSamples([1, 2, 3], 'rejected'), 0);
  const rows = (await A.audit({ limit: 500 })).filter((a) => a.entity === 'signal_samples');
  assert.equal(rows.length, n0 + 1);
  assert.deepEqual(plain([rows[0].action, rows[0].entity_id, rows[0].details.count, rows[0].details.status, rows[0].details.ids]), ['status', 'batch', 3, 'rejected', [1, 2, 3]]);
  // no-op publish, force, pack changes with closure + deletion
  const base = await A.publishPack('mini-loop', 'viettel', 'baseline', { force: true });
  const same = await A.publishPack('mini-loop', 'viettel', 'again');
  assert.deepEqual(plain([same.unchanged, same.version]), [true, base.version]);
  let ch = await packChanges('mini-loop', 'viettel');
  assert.deepEqual(plain([ch.length, ch[0].changed, ch[0].count, ch[0].version]), [1, false, 0, base.version]);
  await A.setFacilityStatus('mf-2', 'pending');
  await A.deleteFacility('mf-1');
  await A.upsertService({ id: 'ms-1', name: 'Homestay A (mới)', type: 'lodging' });
  ch = (await packChanges('mini-loop', 'viettel'))[0];
  assert.equal(ch.changed, true);
  assert.deepEqual(plain(ch.facilities.removed.map((f) => [f.id, f.reason]).sort()), [['mf-1', 'deleted'], ['mf-2', 'pending']]);
  assert.deepEqual(plain(ch.services.updated.map((s) => [s.id, s.fields])), [['ms-1', ['name']]]);
  assert.equal(ch.count, 3);
  const pub = await A.publishPack('mini-loop', 'viettel', 'closures');
  assert.deepEqual(plain([pub.unchanged, pub.version]), [false, base.version + 1]);
  assert.equal((await packChanges('mini-loop', 'viettel'))[0].changed, false);
  assert.equal((await packChanges()).length, 3, 'every route × carrier');
  assert.equal((await packChanges('mini-loop', 'mobifone'))[0].published, false, 'never published → changed, published false');
});

/* ------------------------------------------------------------------ supabase backend (fake supabase-js client) */

/** Minimal supabase-js v2 stand-in: rpc(name, params) answered by `handler`, calls recorded. */
function fakeSupabase(handler) {
  const calls = [];
  const client = {
    rpc(name, params) { calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) }); return Promise.resolve(handler(name, params, calls)); },
    from() { throw new Error('table access not expected in this test'); },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() { }
  };
  return { calls, lib: { createClient: (url, key, opts) => { calls.push({ name: 'createClient', params: { url, key, persist: opts.auth.persistSession } }); return client; } } };
}

const SB_CONFIG = { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key', functionsUrl: '', appVersion: '2.0.0', forceLocal: false };

test('backend-supabase: bad key at init → local fallback; RPC parameter names; incomplete mapping; device re-registration', async () => {
  // 1) wrong key → ping fails → NC.data falls back to the local mock server
  const bad = fakeSupabase(() => ({ data: null, error: { message: 'Invalid API key', code: '401' } }));
  const a = sandbox({ config: SB_CONFIG, supabase: bad.lib });
  await a.NC.data.init();
  assert.equal(a.NC.data.mode, 'local', 'fallback to local');
  assert.ok(a.emitted.indexOf('data:mode') >= 0);

  // 2) healthy project
  const pack = plain(a.NC.backend.shared.buildPack(a.ctx.NC_SEED_MINI, 'mini-loop', 'viettel', { version: 7 }));
  let syncCalls = 0;
  const good = fakeSupabase((name, params) => {
    switch (name) {
      case 'get_content_release': return { data: { version: '1.0.0-demo', status: 'in_review' }, error: null };
      case 'get_data_pack': return { data: pack, error: null };
      case 'register_device': return { data: { device_id: '11111111-1111-4111-8111-11111111111' + (syncCalls ? '2' : '1'), secret: 'ab'.repeat(32) }, error: null };
      case 'sync_device_ops':
        syncCalls++;
        if (syncCalls === 1) return { data: null, error: { message: 'unauthorized_device', code: '28000' } };
        return { data: { results: params.p_ops.map((o) => ({ id: o.id, status: 'ok', data: null })), server_time: new Date().toISOString(), session: null }, error: null };
      case 'admin_upsert_facility':
        return { data: null, error: { message: 'incomplete', code: '23514', details: '["phone","lat_lng"]', hint: 'A verified facility needs every field' } };
      default: return { data: null, error: { message: 'unexpected ' + name } };
    }
  });
  const b = sandbox({ config: SB_CONFIG, supabase: good.lib });
  await b.NC.data.init();
  assert.equal(b.NC.data.mode, 'supabase');
  const cc = good.calls.find((c) => c.name === 'createClient');
  assert.deepEqual(cc.params, { url: SB_CONFIG.supabaseUrl, key: SB_CONFIG.supabaseAnonKey, persist: true });
  const p = await b.NC.data.getPack('mini-loop', 'viettel');
  assert.equal(p.source, 'server');
  assert.equal(p.version, 7);
  assert.deepEqual(good.calls.find((c) => c.name === 'get_data_pack').params, { p_route_id: 'mini-loop', p_carrier: 'viettel' });
  // verified facility with missing fields → {code:'incomplete', missing:[...]} with lat_lng expanded
  await assert.rejects(() => b.NC.data.admin.upsertFacility({ id: 'f1', status: 'verified' }), (e) => e.code === 'incomplete' && JSON.stringify(e.missing) === '["phone","lat","lng"]');
  // outbox → register_device → sync_device_ops (401-like unauthorized_device → re-register once → resend)
  await b.NC.data.buddy.start({ traveler_name: 'T', recipient: { email: 't@example.com', phone: '0912 345 678' }, interval_min: 60 });
  const res = await b.NC.data.flush();
  assert.equal(res.sent, 1);
  const regs = good.calls.filter((c) => c.name === 'register_device');
  assert.equal(regs.length, 2, 'registered again after unauthorized_device');
  assert.deepEqual(regs[0].params, { p_carrier: 'viettel', p_app_version: '2.0.0' });
  const sync = good.calls.filter((c) => c.name === 'sync_device_ops').slice(-1)[0].params;
  assert.deepEqual(Object.keys(sync).sort(), ['p_device_id', 'p_ops', 'p_secret']);
  assert.equal(sync.p_device_id, '11111111-1111-4111-8111-111111111112');
  assert.equal(sync.p_ops[0].op, 'buddy.start');
  assert.equal(sync.p_ops[0].data.recipient_email, 't@example.com');
  assert.equal(sync.p_ops[0].data.recipient_phone, '+84912345678', 'the device sends the phone as E.164');
  assert.equal(b.NC.data.status().outboxCount, 0);
});

test('backend-supabase (wave 3): alert summary maps failures, publish force / unchanged, packChanges, new error codes, realtime tables', async () => {
  const calls = [];
  const channels = [];
  let syncErr = 'recipient_email_required';
  const client = {
    rpc(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params || {})) });
      if (name === 'admin_publish_pack') return Promise.resolve({ data: { version: params.p_force ? 3 : 2, unchanged: !params.p_force }, error: null });
      if (name === 'admin_pack_changes') return Promise.resolve({ data: [{ route_id: 'mini-loop', carrier: 'viettel', changed: true, count: 1 }], error: null });
      if (name === 'sync_device_ops') return Promise.resolve({ data: null, error: { message: syncErr, code: '22023' } });
      if (name === 'admin_upsert_facility') return Promise.resolve({ data: null, error: { message: 'invalid_coordinates', code: '22023', details: 'outside_vietnam' } });
      return Promise.resolve({ data: null, error: { message: 'invalid_date', code: '22023', details: '2031-01-01' } });
    },
    from() { throw new Error('no table access here'); },
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt-admin', user: { id: 'u1', email: 'a@x' } } } }) },
    channel(name) { const ch = { name, tables: [], on(kind, f) { ch.tables.push(f.table); return ch; }, subscribe() { return ch; } }; channels.push(ch); return ch; },
    removeChannel() { }
  };
  const { ctx, NC } = sandbox({ config: SB_CONFIG, supabase: { createClient: () => client } });
  const S = NC.backend.supabase;
  assert.equal(S.configured(), true);
  let reply = { status: 200, body: { ok: false, mode: 'admin', type: 'overdue', processed: 1, sent: 0, failed: 1, dry_run: false, error: 'RESEND_API_KEY is not set',
    results: [{ session_id: 's1', status: 'failed', provider: 'resend', reason: 'overdue', error: 'RESEND_API_KEY is not set' }] } };
  let lastFetch = null;
  ctx.fetch = (url, init) => { lastFetch = { url, init }; return Promise.resolve({ ok: reply.status < 400, status: reply.status, text: () => Promise.resolve(JSON.stringify(reply.body)) }); };
  let res = await S.admin.triggerAlert('s1');
  assert.deepEqual(plain([res.ok, res.processed, res.sent, res.failed, res.error, res.results[0].status]), [false, 1, 0, 1, 'RESEND_API_KEY is not set', 'failed']);
  assert.equal(lastFetch.url, 'https://demo.supabase.co/functions/v1/deadman-alert');
  assert.equal(lastFetch.init.headers.Authorization, 'Bearer jwt-admin');
  reply = { status: 502, body: { ok: false, processed: 1, sent: 0, failed: 1, results: [{ session_id: 's1', status: 'failed', error: 'Resend HTTP 500' }] } };
  res = await S.admin.triggerAlert('s1');
  assert.deepEqual(plain([res.ok, res.failed, res.error]), [false, 1, 'Resend HTTP 500'], 'a non-2xx summary is still an outcome');
  reply = { status: 200, body: { ok: true, processed: 1, sent: 1, failed: 0, results: [{ session_id: 's1', status: 'sent', provider: 'resend', id: 'em_1' }] } };
  res = await S.admin.triggerAlert('s1');
  assert.deepEqual(plain([res.ok, res.sent, res.error === undefined]), [true, 1, true]);
  reply = { status: 401, body: { ok: false, error: 'unauthorized' } };
  await assert.rejects(() => S.admin.triggerAlert('s1'), (e) => e.code === 'forbidden');
  // publish: no p_force unless asked (works on databases without the wave-3 signature too)
  assert.equal((await S.admin.publishPack('mini-loop', 'viettel', 'n')).unchanged, true);
  assert.equal((await S.admin.publishPack('mini-loop', 'viettel', 'n', { force: true })).version, 3);
  assert.deepEqual(calls.filter((c) => c.name === 'admin_publish_pack').map((c) => Object.keys(c.params).sort()),
    [['p_carrier', 'p_notes', 'p_route_id'], ['p_carrier', 'p_force', 'p_notes', 'p_route_id']]);
  assert.equal((await S.admin.packChanges('mini-loop'))[0].changed, true);
  assert.deepEqual(calls.find((c) => c.name === 'admin_pack_changes').params, { p_route_id: 'mini-loop', p_carrier: null });
  await assert.rejects(() => S.sync_device_ops('d', 's', []), (e) => e.code === 'recipient_email_required');
  syncErr = 'recipient_phone_not_mobile';   // 20261002000100: Vietnamese 02x landline
  await assert.rejects(() => S.sync_device_ops('d', 's', []), (e) => e.code === 'recipient_phone_not_mobile');
  await assert.rejects(() => S.admin.upsertFacility({ id: 'f', lat: 0, lng: 0 }), (e) => e.code === 'invalid_coordinates' && e.reason === 'outside_vietnam');
  await assert.rejects(() => S.admin.approveContentRelease(1, 'x'), (e) => e.code === 'invalid_date');
  // realtime: the 9 publication tables; pack payload / medical layer never on the bus
  const got = [];
  NC.bus.on('server:change', (m) => got.push(m));
  S.admin.subscribe(() => { });
  assert.deepEqual(plain(channels[0].tables.slice().sort()), ['audit_log', 'buddy_sessions', 'checkin_events', 'content_releases', 'data_packs',
    'facilities', 'facility_submissions', 'services', 'signal_samples']);
});

/* ------------------------------------------------------------------ round 2 R6 (W6): heartbeat, contact_lost, push */

test('buddy.heartbeat + contact_lost (= SQL 20260930000200): no event, closed ignored, paused / silence_until / check-in protect, e-mail only with an address', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  const row = async (id) => (await L._debug.all('buddy_sessions')).find((x) => x.id === id);
  const sid = uid();
  await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid, recipient_email: 'lost.contact@example.com', recipient_phone: '+84 000 000 031', interval_min: 240, grace_min: 15 } }]);
  let r = await sync([{ id: uid(), op: 'buddy.heartbeat', data: { session_id: sid, state: 'live', lat: 23.1, lng: 105.2, accuracy_m: 12, client_ts: new Date().toISOString() } }]);
  assert.deepEqual([r.results[0].status, r.results[0].data.heartbeat_state], ['ok', 'live']);
  let s = await row(sid);
  assert.equal(s.heartbeat_state, 'live');
  assert.ok(Date.now() - Date.parse(s.last_heartbeat_at) < 5000, 'last_heartbeat_at = receive time');
  assert.deepEqual([s.last_lat, s.last_lng, s.silence_until], [23.1, 105.2, null], 'a newer fix becomes the last location');
  assert.equal((await L._debug.all('checkin_events')).filter((e) => e.session_id === sid).length, 1, 'a heartbeat writes no event');
  r = await sync([{ id: uid(), op: 'buddy.heartbeat', data: { session_id: sid, state: 'asleep' } }]);
  assert.deepEqual(plain([r.results[0].status, r.results[0].error, r.results[0].retryable]), ['error', 'invalid_state', false]);
  await sync([{ id: uid(), op: 'buddy.heartbeat', data: { session_id: sid, state: 'live', silence_until: new Date(Date.now() + 3 * 86400000).toISOString() } }]);
  s = await row(sid);
  assert.ok(Date.parse(s.silence_until) <= Date.now() + 86400000 + 1000, 'silence_until capped at 24 h');

  L.observedSince = 0;   // test hook: the mock server "ran" all along (the SQL server never stops)
  try {
    const put = async (patch) => { const x = await row(sid); Object.assign(x, patch); await L._debug.put('buddy_sessions', x); };
    const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
    await put({ last_heartbeat_at: ago(20), last_checkin_at: ago(60), silence_until: new Date(Date.now() + 10 * 60000).toISOString() });
    assert.equal((await L.tick({ force: true })).contact_lost, 0, 'inside the predicted dead zone');
    await put({ silence_until: null, heartbeat_state: 'paused' });
    assert.equal((await L.tick({ force: true })).contact_lost, 0, 'paused (app hidden): dead-man switch only');
    await put({ heartbeat_state: 'live', last_checkin_at: ago(5) });
    assert.equal((await L.tick({ force: true })).contact_lost, 0, 'a check-in within 15 min is contact');
    await put({ last_checkin_at: ago(60), silence_until: ago(1) });
    assert.equal((await L.tick({ force: true })).contact_lost, 1, 'live + silent > 15 min + silence_until past');
    s = await row(sid);
    assert.deepEqual([s.status, s.alert_reason], ['overdue', 'contact_lost']);
    const ev = (await L._debug.all('checkin_events')).find((e) => e.session_id === sid && e.kind === 'overdue');
    assert.deepEqual([ev.meta.source, ev.meta.reason, !!ev.meta.last_heartbeat_at], ['server', 'contact_lost', true]);
    assert.equal((await L.tick({ force: true })).alerted, 1, 'the next tick e-mails (simulated)');
    s = await row(sid);
    const sent = (await L._debug.all('checkin_events')).find((e) => e.session_id === sid && e.kind === 'alert_sent');
    assert.deepEqual([s.status, s.alert_reason, sent.meta.reason, sent.meta.provider], ['alerted', 'contact_lost', 'contact_lost', 'simulated']);
    r = await sync([{ id: uid(), op: 'buddy.heartbeat', data: { session_id: sid, state: 'live' } }]);
    assert.deepEqual([r.session.status, r.session.alert_reason], ['alerted', 'contact_lost'], 'a later heartbeat never clears it; the device sees the reason');
    r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'sos' } }]);
    assert.deepEqual([r.session.status, r.session.alert_reason], ['overdue', 'sos'], 'SOS after contact_lost → re-alert as SOS');
    r = await sync([{ id: uid(), op: 'buddy.checkin', data: { session_id: sid, kind: 'checkin' } }]);
    assert.deepEqual([r.session.status, r.session.alert_reason], ['active', null]);
    // the mock only judges a silence it saw: a heartbeat older than the current cron run does not count
    await put({ last_heartbeat_at: ago(30), last_checkin_at: ago(60), silence_until: null, heartbeat_state: 'live' });
    L.observedSince = Date.now() - 5 * 60000;
    assert.equal((await L.tick({ force: true })).contact_lost, 0, 'page (= mock server) was closed during the silence → no false alarm');
    await sync([{ id: uid(), op: 'buddy.stop', data: { session_id: sid } }]);
    r = await sync([{ id: uid(), op: 'buddy.heartbeat', data: { session_id: sid, state: 'live' } }]);
    assert.equal(r.results[0].data.ignored, 'session_closed');

    // phone-only: flagged (dashboard) but never e-mailed
    L.observedSince = 0;
    const sid2 = uid();
    await sync([{ id: uid(), op: 'buddy.start', data: { session_id: sid2, recipient_phone: '+84 987 654 321', interval_min: 240 } }]);
    await sync([{ id: uid(), op: 'buddy.heartbeat', data: { session_id: sid2, state: 'live' } }]);
    const x = await row(sid2);
    Object.assign(x, { last_heartbeat_at: ago(16), last_checkin_at: ago(30) });
    await L._debug.put('buddy_sessions', x);
    await L.tick({ force: true });
    await L.tick({ force: true });
    const s2 = await row(sid2);
    assert.deepEqual([s2.status, s2.alert_reason], ['overdue', 'contact_lost']);
    assert.ok(!(await L._debug.all('checkin_events')).some((e) => e.session_id === sid2 && e.kind === 'alert_sent'), 'no e-mail without an address');
  } finally { delete L.observedSince; }
});

test('push.subscribe / unsubscribe / schedule (local mock = SQL): allow-listed endpoints, keys, ≤ 5 per device, replace-all, device.erase', async () => {
  const { NC } = sandbox();
  const { L, sync } = await registered(NC);
  const S = NC.backend.shared;
  const k1 = 'A'.repeat(87), k2 = 'B'.repeat(22);
  const one = async (op, data) => (await sync([{ id: uid(), op, data }])).results[0];
  const ep = 'https://fcm.googleapis.com/fcm/send/nc-test';
  let r = await one('push.subscribe', { endpoint: ep, p256dh: k1, auth: k2, lang: 'en' });
  assert.equal(r.status, 'ok');
  let rows = await L._debug.push();
  assert.deepEqual(plain(rows.subs.map((x) => [x.endpoint, x.lang])), [[ep, 'en']]);
  r = await one('push.subscribe', { endpoint: ep, p256dh: k1, auth: k2 });
  assert.equal((await L._debug.push()).subs.length, 1, 'upsert by endpoint');
  r = await one('push.subscribe', { endpoint: 'https://evil.example.org/fcm.googleapis.com/x', p256dh: k1, auth: k2 });
  assert.deepEqual(plain([r.error, r.retryable]), ['invalid_push_endpoint', false]);
  r = await one('push.subscribe', { endpoint: ep, p256dh: 'short', auth: k2 });
  assert.equal(r.error, 'invalid_push_keys');
  assert.deepEqual([S.validPushEndpoint('http://fcm.googleapis.com/x'), S.validPushEndpoint('https://fcm.googleapis.com.evil.io/x'),
    S.validPushEndpoint('https://user@fcm.googleapis.com/x'), S.validPushEndpoint('https://web.push.apple.com/QX'),
    S.validPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'), S.validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')],
  [false, false, false, true, true, true], 'same allow-list as app_private.valid_push_endpoint');
  for (let i = 1; i <= 6; i++) {
    await one('push.subscribe', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/nc' + i, p256dh: k1, auth: k2 });
    await new Promise((res) => setTimeout(res, 3));
  }
  assert.equal((await L._debug.push()).subs.length, 5, 'at most 5 per device (the oldest go)');
  const iso = (ms) => new Date(Date.now() + ms).toISOString();
  r = await one('push.schedule', { items: [
    { fire_at: iso(10 * 60000), kind: 'deadzone_ahead', minutes_before: 5, zone_km: 12.3456 },
    { fire_at: iso(-3600000), kind: 'deadzone_ahead', minutes_before: 5, zone_km: 1 },
    { fire_at: iso(49 * 3600000), kind: 'deadzone_ahead', minutes_before: 5, zone_km: 2 }] });
  assert.deepEqual([r.status, r.data.scheduled, r.data.skipped], ['ok', 1, 2]);
  rows = await L._debug.push();
  assert.deepEqual(plain(rows.schedules[0].items.map((i) => i.zone_km)), [12.346]);
  r = await one('push.schedule', { items: Array.from({ length: 21 }, (x, i) => ({ fire_at: iso((i + 1) * 60000), kind: 'deadzone_ahead', minutes_before: 5, zone_km: i })) });
  assert.deepEqual(plain([r.error, r.retryable]), ['too_many_items', false]);
  r = await one('push.schedule', { items: [{ fire_at: iso(5 * 60000), kind: 'deadzone_ahead', minutes_before: '5', zone_km: 1 }] });
  assert.equal(r.error, 'invalid_push_schedule', 'strings are not numbers (= SQL jsonb_typeof)');
  assert.equal((await L._debug.push()).schedules[0].items.length, 1, 'a refused schedule keeps the old one');
  await one('push.schedule', { items: [] });
  assert.equal((await L._debug.push()).schedules[0].items.length, 0, 'an empty schedule clears it');
  r = await one('push.unsubscribe', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/nc6' });
  assert.equal(r.data.deleted, 1);
  r = await one('push.unsubscribe', {});
  assert.equal(r.data.deleted, 4);
  await one('push.subscribe', { endpoint: ep, p256dh: k1, auth: k2 });
  await one('push.schedule', { items: [{ fire_at: iso(20 * 60000), kind: 'deadzone_ahead', minutes_before: 15, zone_km: 4 }] });
  await one('device.erase', {});
  rows = await L._debug.push();
  assert.deepEqual([rows.subs.length, rows.schedules.length], [0, 0], 'device.erase drops the push rows');
});
