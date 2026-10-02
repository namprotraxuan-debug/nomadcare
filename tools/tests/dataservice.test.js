/*
 * dataservice.test.js — node --test suite for the wave-3 NC.data behaviour (owner: client-core).
 * Runs the real routing/profile/backend-local/backend-supabase/dataservice files in a vm sandbox with small core stubs
 * (in-memory NC.store with kv + tables + keys, cross-sandbox bus, localStorage, fake NC.secure.seal).
 * Covers: page role gating (admin / undefined / app), outbox lease + delegation between two app tabs, Buddy contact
 * sealed at rest, buddy.update (consent withdrawal) + send-time medical re-check, op errors (data:op_error +
 * session.sync_error), derived 'resolved' acknowledgement, offline wipe → erase tombstone → sent on reconnect,
 * full personal-key wipe, eraseServerData, lazy supabase-js loading through NC.loader, ?reset=1 (boot.js: server erase
 * first, mock server DB + admin session kept).
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (o) => JSON.parse(JSON.stringify(o));

/* A "browser" shared by several sandboxes (tabs): one localStorage + one broadcast hub. */
function browserHub() {
  const ls = new Map();
  const tabs = [];
  const localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); },
    get length() { return ls.size; },
    key: (i) => Array.from(ls.keys())[i] || null
  };
  return { localStorage, tabs, ls };
}

/* In-memory NC.store (kv + tables + keys) — shape of assets/js/core/store.js. */
function memStore() {
  const kvm = new Map();
  const tables = {};
  const c = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    kvm,
    tables,
    get: (k) => Promise.resolve(kvm.has(k) ? c(kvm.get(k)) : null),
    set: (k, v) => { kvm.set(k, c(v)); return Promise.resolve(v); },
    del: (k) => { kvm.delete(k); return Promise.resolve(true); },
    keys: (prefix) => Promise.resolve(Array.from(kvm.keys()).filter((k) => !prefix || k.indexOf(prefix) === 0)),
    wipe: () => { kvm.clear(); Object.keys(tables).forEach((n) => tables[n].clear()); return Promise.resolve(true); },
    table(name) {
      const t = tables[name] = tables[name] || new Map();
      return {
        all: () => Promise.resolve(Array.from(t.values()).map(c)),
        get: (id) => Promise.resolve(t.has(id) ? c(t.get(id)) : null),
        put: (o) => { t.set(o.id, c(o)); return Promise.resolve(o); },
        bulkPut: (a) => { a.forEach((o) => t.set(o.id, c(o))); return Promise.resolve(a.length); },
        delete: (id) => { t.delete(id); return Promise.resolve(true); },
        clear: () => { t.clear(); return Promise.resolve(true); },
        count: () => Promise.resolve(t.size)
      };
    }
  };
}

/* Fake at-rest sealing: reversible, but never contains the plaintext (enough to prove nothing is stored in clear). */
const fakeSecure = {
  seal: (o) => Promise.resolve({ sealed: 1, enc: true, data: Buffer.from(JSON.stringify(o)).toString('base64').split('').reverse().join('') }),
  unseal: (x) => Promise.resolve(x && x.sealed === 1 ? JSON.parse(Buffer.from(x.data.split('').reverse().join(''), 'base64').toString()) : null),
  save: (n, o) => { fakeSecure._m[n] = JSON.parse(JSON.stringify(o)); return Promise.resolve(true); },
  load: (n) => Promise.resolve(fakeSecure._m[n] ? JSON.parse(JSON.stringify(fakeSecure._m[n])) : null),
  remove: (n) => { delete fakeSecure._m[n]; return Promise.resolve(true); },
  wipe: () => { fakeSecure._m = {}; return Promise.resolve(true); },
  _m: {}
};

/**
 * One tab. opts: {page, hub, store, secure, config, loader, supabase, settings}
 */
function sandbox(opts) {
  opts = opts || {};
  const intervals = [];
  const timers = {
    // short timers keep the loop alive (delegated flush, scheduled flush); long ones (retries, lease) do not
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref && (ms || 0) >= 5000) t.unref(); return t; },
    setInterval: (fn, ms) => { intervals.push(ms); const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout, clearInterval
  };
  const ctx = Object.assign({ console, Date, Math, JSON, Promise, TextEncoder, Uint8Array, DataView, crypto: webcrypto, unescape, encodeURIComponent }, timers);
  ctx.window = ctx;
  ctx.globalThis = ctx;
  if (opts.page !== undefined) ctx.NC_PAGE = opts.page;
  if (opts.config) ctx.NC_CONFIG = opts.config;
  if (opts.supabase) ctx.supabase = opts.supabase;
  if (opts.hub) ctx.localStorage = opts.hub.localStorage;
  ctx.addEventListener = () => { };
  vm.createContext(ctx);
  const handlers = {};
  const emitted = [];
  const settings = Object.assign({ carrier: 'viettel', route_id: 'mini-loop', travel_mode: 'motorbike', community_logs: false, last_position: null, onboarded: true }, opts.settings || {});
  const net = { online: true };
  const tabId = 'tab-' + Math.random().toString(36).slice(2, 8);
  function emitLocal(evt, p, meta) { emitted.push(evt); (handlers[evt] || []).slice().forEach((fn) => fn(p, meta || { remote: false })); }
  const bus = {
    tabId,
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => { handlers[evt] = handlers[evt].filter((f) => f !== fn); }; },
    emit: emitLocal,
    broadcast(evt, p) {
      emitLocal(evt, p);
      if (opts.hub) opts.hub.tabs.forEach((t) => { if (t !== me) setTimeout(() => t.emitLocal(evt, JSON.parse(JSON.stringify(p === undefined ? null : p)), { remote: true }), 0); });
    }
  };
  ctx.NC = {
    bus,
    net: { online: () => net.online },
    settings: { get: (k) => settings[k], set: (k, v) => { settings[k] = v; return Promise.resolve(); }, all: () => Object.assign({}, settings) }
  };
  if (opts.store) ctx.NC.store = opts.store;
  if (opts.secure) ctx.NC.secure = opts.secure;
  if (opts.loader) ctx.NC.loader = opts.loader;
  FILES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  ctx.NC_SEED = ctx.NC_SEED_MINI;
  ctx.NC.backend.local.latency = [0, 0];
  const me = { ctx, NC: ctx.NC, net, settings, handlers, emitted, intervals, emitLocal, tabId };
  if (opts.hub) opts.hub.tabs.push(me);
  return me;
}

/* Record every sync_device_ops call (the ops as they go over the wire). */
function spyWire(NC) {
  const calls = [];
  const orig = NC.backend.local.sync_device_ops;
  NC.backend.local.sync_device_ops = function (id, secret, ops) {
    calls.push({ id, ops: JSON.parse(JSON.stringify(ops || [])) });
    return orig.apply(this, arguments);
  };
  return calls;
}
const srvSessions = (NC) => NC.backend.local._debug.all('buddy_sessions');
const START = { traveler_name: 'Minh Anh', recipient: { name: 'Lê Hà', email: 'le.ha@example.com', phone: '+84000000001' }, interval_min: 60, grace_min: 15 };

/* ------------------------------------------------------------------ page role (A7) */

test('page role: admin never flushes/ticks; undefined role runs nothing automatically but explicit calls work', async () => {
  const admin = sandbox({ page: 'admin' });
  await admin.NC.data.init();
  const DS = [30000, 10000, 7000];   // dataservice loops (flush, Buddy tick, lease renew); 15000 = local mock cron
  assert.deepEqual(admin.intervals.filter((ms) => DS.indexOf(ms) >= 0), [], 'no device loops on the admin page');
  await admin.NC.data.buddy.start(START);
  assert.deepEqual(plain(await admin.NC.data.flush()), { sent: 0, failed: 0, skipped: 'page' });
  assert.equal(await admin.NC.data.buddy.tick({ now: Date.now() + 999 * 60000 }), null);
  assert.ok((await admin.NC.data.outbox()).length >= 1, 'device ops stay queued for the traveller tab');

  const none = sandbox({});
  await none.NC.data.init();
  assert.deepEqual(none.intervals.filter((ms) => DS.indexOf(ms) >= 0), [], 'no device loops without NC_PAGE');
  await none.NC.data.buddy.start(START);
  await sleep(500);
  assert.equal((await none.NC.data.outbox()).filter((o) => o.op === 'buddy.start').length, 1, 'nothing flushed by itself');
  const r = await none.NC.data.flush();
  assert.equal(r.sent, 1, 'explicit flush still works (tests / harness)');
});

test('app tabs: one lease holder flushes; another app tab delegates and gets the leader result', async () => {
  const hub = browserHub();
  const a = sandbox({ page: 'app', hub });
  await a.NC.data.init();
  assert.deepEqual(a.intervals.filter((ms) => [30000, 10000, 7000].indexOf(ms) >= 0).sort(), [10000, 30000, 7000], 'app page runs its loops');
  assert.equal(a.NC.data.status().leader, true);
  const lease = JSON.parse(hub.localStorage.getItem('nc.outbox.lease'));
  assert.equal(lease.tab, a.tabId);
  assert.ok(lease.until > Date.now() + 15000);

  const b = sandbox({ page: 'app', hub });
  await b.NC.data.init();
  assert.equal(b.NC.data.status().leader, false, 'second tab respects the live lease');
  await a.NC.data.buddy.start(START);   // something for the leader to send
  const res = await b.NC.data.flush();
  assert.equal(res.delegated, true);
  assert.ok(res.sent >= 1, 'leader flushed on request: ' + JSON.stringify(res));
  assert.equal((await a.NC.data.outbox()).length, 0);
  // an expired lease is taken over
  hub.localStorage.setItem('nc.outbox.lease', JSON.stringify({ tab: a.tabId, until: Date.now() - 1 }));
  const r2 = await b.NC.data.flush();
  assert.equal(r2.delegated, undefined);
  assert.equal(b.NC.data.status().leader, true);
  // offline is re-checked: no flush while offline even as the leader
  b.net.online = false;
  assert.equal((await b.NC.data.flush()).offline, true);
});

/* ------------------------------------------------------------------ Buddy contact at rest */

test('Buddy contact is sealed in the session record and in the queued buddy.start op, clear on the wire', async () => {
  const store = memStore();
  const t = sandbox({ store, secure: fakeSecure });
  await t.NC.data.init();
  t.net.online = false;
  const s = await t.NC.data.buddy.start(START);
  assert.equal(s.recipient_email, 'le.ha@example.com', 'API returns the contact in clear');
  const raw = JSON.stringify({ kv: Array.from(store.kvm.entries()), outbox: Array.from((store.tables.outbox || new Map()).values()) });
  ['le.ha@example.com', 'Lê Hà', 'Minh Anh', '+84000000001'].forEach((needle) => assert.ok(raw.indexOf(needle) < 0, 'no plaintext ' + needle + ' at rest'));
  const cur = await t.NC.data.buddy.current();
  assert.equal(cur.recipient_name, 'Lê Hà');
  assert.equal(cur.traveler_name, 'Minh Anh');
  const wire = spyWire(t.NC);
  t.net.online = true;
  const r = await t.NC.data.flush();
  assert.equal(r.sent, 1);
  const op = wire.flatMap((c) => c.ops).find((o) => o.op === 'buddy.start');
  assert.equal(op.data.recipient_email, 'le.ha@example.com');
  assert.equal(op.data.contact_sealed, undefined);
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.equal(srv.recipient_email, 'le.ha@example.com');
  // traveler_name is sanitised client-side too (≤ 60 chars, no links)
  t.net.online = false;
  const s2 = await t.NC.data.buddy.start(Object.assign({}, START, { traveler_name: '  Anh http://evil.example/x www.spam.vn ' + 'x'.repeat(80) }));
  assert.ok(s2.traveler_name.length <= 60);
  assert.ok(!/http|www\./i.test(s2.traveler_name));
});

/* ------------------------------------------------------------------ buddy.update (A1) */

test('buddy.update withdraws the medical layer: queued op, send-time re-check for a queued buddy.start', async () => {
  const t = sandbox({});
  await t.NC.data.init();
  await t.NC.profile.save({ public: { blood_type: 'O+', allergies: 'Penicillin', conditions: 'Hen suyễn', medications: 'Ventolin' } });
  const wire = spyWire(t.NC);
  // offline start with sharing ON, then consent withdrawn BEFORE anything was sent
  t.net.online = false;
  const s = await t.NC.data.buddy.start(Object.assign({}, START, { share_public_medical: true, public_medical: { blood_type: 'O+', allergies: 'Penicillin' } }));
  const u = await t.NC.data.buddy.update({ share_public_medical: false, public_medical: null });
  assert.equal(u.share_public_medical, false);
  const q = await t.NC.data.outbox();
  const upd = q.find((o) => o.op === 'buddy.update');
  assert.ok(upd, 'buddy.update queued');
  assert.deepEqual(Object.keys(upd.data).sort(), ['client_ts', 'public_medical', 'session_id', 'share_public_medical']);
  assert.equal(upd.data.public_medical, null);
  t.net.online = true;
  await t.NC.data.flush();
  const sent = wire.flatMap((c) => c.ops);
  const st = sent.find((o) => o.op === 'buddy.start');
  assert.equal(st.data.share_public_medical, false, 'the queued start no longer shares after withdrawal');
  assert.equal(st.data.public_medical, null);
  const up = sent.find((o) => o.op === 'buddy.update');
  assert.ok(up && up.data.share_public_medical === false && up.data.public_medical === null);
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.ok(!srv.public_medical, 'server row never received the medical layer');
  assert.equal(await t.NC.data.buddy.update({ share_public_medical: true }).then((x) => !!x), true);
  await t.NC.data.buddy.stop();
  assert.equal(await t.NC.data.buddy.update({ share_public_medical: false }), null, 'no open session → null');
});

/* ------------------------------------------------------------------ op errors (A5) */

test('rejected ops surface as data:op_error and session.sync_error (cleared by the next acknowledged Buddy op)', async () => {
  const store = memStore();
  const t = sandbox({ store });
  await t.NC.data.init();
  const orig = t.NC.backend.local.sync_device_ops;
  let reject = true;
  t.NC.backend.local.sync_device_ops = function (id, secret, ops) {
    if (!reject) return orig.apply(this, arguments);
    return orig.call(this, id, secret, (ops || []).filter((o) => o.op !== 'buddy.start')).then((out) => {
      (ops || []).filter((o) => o.op === 'buddy.start').forEach((o) => out.results.push({ id: o.id, status: 'error', error: 'recipient_email_required', retryable: false }));
      return out;
    });
  };
  const errs = [];
  t.NC.bus.on('data:op_error', (p) => errs.push(p));
  const due = () => { store.tables.outbox.forEach((o) => { o.next_at = 0; }); };
  const s = await t.NC.data.buddy.start(START);
  await t.NC.data.flush();
  assert.equal(errs.length, 1);
  assert.deepEqual(plain({ op: errs[0].op, code: errs[0].code, session_id: errs[0].session_id }), { op: 'buddy.start', code: 'recipient_email_required', session_id: s.id });
  assert.equal((await t.NC.data.buddy.current()).sync_error, 'recipient_email_required');
  // fixed server-side (or data corrected) → the retry is acknowledged and the error clears
  reject = false;
  due();
  await t.NC.data.flush();
  assert.equal((await t.NC.data.buddy.current()).sync_error, null);
  // a permanent error that persists: reported, then dropped on the second failure
  reject = true;
  const s2 = await t.NC.data.buddy.start(START);
  await t.NC.data.flush();
  due();
  await t.NC.data.flush();
  assert.equal((await t.NC.data.outbox()).filter((o) => o.op === 'buddy.start').length, 0, 'dropped');
  assert.ok(errs.filter((e) => e.session_id === s2.id).length >= 1);
});

/* ------------------------------------------------------------------ refused starts (A5/A11, integrator wave 3b) */

test('buddy.start: phone required, e-mail optional but valid — refused up front without state (round 2, R7)', async () => {
  const t = sandbox({});
  await t.NC.data.init();
  const cases = [
    [{ name: 'Lê Hà', email: 'le.ha@example.com' }, 'recipient_phone_required'],
    [{ email: 'le.ha@example.com', phone: '   ' }, 'recipient_phone_required'],
    [{ email: 'le.ha@example.com', phone: '12345' }, 'recipient_phone_invalid'],
    [{ phone: '+84 912 345 678', email: 'not-an-email' }, 'recipient_email_invalid'],
    // 20261002000100: a Vietnamese 02x landline cannot receive the SMS
    [{ name: 'Lê Hà', phone: '024 3826 4444' }, 'recipient_phone_not_mobile'],
    [{ email: 'le.ha@example.com', phone: '+84 28 3829 5555' }, 'recipient_phone_not_mobile'],
    [{ phone: '0203 3825 111', email: 'not-an-email' }, 'recipient_email_invalid']
  ];
  for (const [rcp, code] of cases) {
    await assert.rejects(() => t.NC.data.buddy.start(Object.assign({}, START, { recipient: rcp })), (e) => e.code === code, code);
  }
  assert.equal(await t.NC.data.buddy.current(), null, 'no local session created');
  assert.equal((await t.NC.data.outbox()).length, 0, 'nothing queued');
});

test('buddy.start mobile only (20261002000100): mobiles / international / demo accepted; a landline queued by an older app is refused for good', async () => {
  const t = sandbox({ store: memStore() });
  await t.NC.data.init();
  for (const [raw, e164] of [['0362 123 456', '+84362123456'], ['+44 20 7946 0958', '+442079460958'], ['+84 000 000 001', '+84000000001']]) {
    const s = await t.NC.data.buddy.start(Object.assign({}, START, { recipient: { name: 'Lê Hà', phone: raw } }));
    assert.equal(s.recipient_phone, e164, raw + ' accepted');
  }
  await t.NC.data.flush();
  assert.equal((await t.NC.data.outbox()).filter((o) => o.op === 'buddy.start').length, 0, 'accepted by the server');
  // an older app version queued its start with a landline: the server refuses it (permanent, surfaced on the session)
  const orig = t.NC.backend.local.sync_device_ops;
  t.NC.backend.local.sync_device_ops = function (id, secret, ops) {
    return orig.call(this, id, secret, (ops || []).map((o) => (o.op === 'buddy.start'
      ? Object.assign({}, o, { data: Object.assign({}, o.data, { recipient_phone: '024 3826 4444' }) }) : o)));
  };
  const errs = [];
  t.NC.bus.on('data:op_error', (p) => errs.push(p));
  const s = await t.NC.data.buddy.start(Object.assign({}, START, { recipient: { name: 'Lê Hà', phone: '0912 345 678' } }));
  await t.NC.data.flush();
  assert.ok(errs.some((e) => e.session_id === s.id && e.op === 'buddy.start' && e.code === 'recipient_phone_not_mobile'), 'reported');
  assert.equal((await t.NC.data.buddy.current()).sync_error, 'recipient_phone_not_mobile');
  assert.ok(!(await srvSessions(t.NC)).some((x) => x.id === s.id), 'nothing stored on the server');
});

test('buddy.start phone-only (no e-mail): session on the device + server, phone as E.164, never e-mailed', async () => {
  const t = sandbox({});
  await t.NC.data.init();
  const s = await t.NC.data.buddy.start(Object.assign({}, START, { recipient: { name: 'Lê Hà', phone: '0912 345 678', email: '  ' }, interval_min: 1, grace_min: 0 }));
  assert.equal(s.recipient_email, null, 'blank e-mail = no e-mail');
  assert.equal(s.recipient_phone, '+84912345678');
  const op = (await t.NC.data.outbox()).find((o) => o.op === 'buddy.start');
  assert.ok(op, 'start queued');
  await t.NC.data.flush();
  assert.equal((await t.NC.data.outbox()).filter((o) => o.op === 'buddy.start').length, 0, 'accepted by the server');
  const cur = await t.NC.data.buddy.current();
  assert.equal(cur.sync_error || null, null, 'no sync error');
  const srv = (await t.NC.backend.local._debug.all('buddy_sessions')).find((x) => x.id === s.id);
  assert.deepEqual([srv.recipient_email, srv.recipient_phone, srv.status], [null, '+84912345678', 'active']);
  // overdue on the server → never alerted (no channel), no alert_sent event
  srv.next_due_at = new Date(Date.now() - 5 * 60000).toISOString();
  await t.NC.backend.local._debug.put('buddy_sessions', srv);
  await t.NC.backend.local.tick({ force: true });
  await t.NC.backend.local.tick({ force: true });
  const after = (await t.NC.backend.local._debug.all('buddy_sessions')).find((x) => x.id === s.id);
  assert.equal(after.status, 'overdue', 'overdue, not alerted');
  const evs = (await t.NC.backend.local._debug.all('checkin_events')).filter((e) => e.session_id === s.id);
  assert.ok(!evs.some((e) => e.kind === 'alert_sent'), 'no e-mail simulated for a phone-only session');
});

test('ops of a session whose start was refused for good (rate_limited) are dropped, not retried forever', async () => {
  const store = memStore();
  const t = sandbox({ store });
  await t.NC.data.init();
  t.NC.backend.local.limits.buddy_start_device_24h = 1;
  const REAL = Object.assign({}, START, { recipient: { name: 'Lê Hà', email: 'le.ha@nomadcare-judge.vn', phone: '+84 000 000 001' } });
  const due = () => { (store.tables.outbox || new Map()).forEach((o) => { o.next_at = 0; }); };
  const errs = [];
  t.NC.bus.on('data:op_error', (p) => errs.push(p));
  await t.NC.data.buddy.start(REAL);
  assert.equal((await t.NC.data.flush()).sent, 1, 'first start accepted');
  // second session (over the per-device quota) with a check-in and a stop queued behind its start
  t.net.online = false;
  const s2 = await t.NC.data.buddy.start(REAL);
  await t.NC.data.buddy.checkin({});
  t.net.online = true;
  await t.NC.data.flush();
  assert.ok(errs.some((e) => e.op === 'buddy.start' && e.session_id === s2.id && /rate_limited/.test(e.code)), 'rate_limited surfaced');
  assert.match(String((await t.NC.data.buddy.current()).sync_error), /rate_limited/);
  due();
  await t.NC.data.flush();
  const left = (await t.NC.data.outbox()).filter((o) => o.data && o.data.session_id === s2.id);
  assert.deepEqual(left.map((o) => o.op), [], 'start dropped as permanent together with the session ops');
  // a stale op of a closed / replaced session answered 'session_not_found' is dropped as well
  t.net.online = false;
  await t.NC.data.buddy.stop({});
  t.net.online = true;
  due();
  await t.NC.data.flush();
  due();
  await t.NC.data.flush();
  assert.equal((await t.NC.data.outbox()).filter((o) => o.op.indexOf('buddy.') === 0).length, 0, 'outbox badge cleared');
});

/* ------------------------------------------------------------------ derived 'resolved' (flows-trip#9) */

test("check-in after SOS: the derived 'resolved' event is acknowledged with its check-in op", async () => {
  const t = sandbox({});
  await t.NC.data.init();
  await t.NC.data.buddy.start(START);
  await t.NC.data.flush();
  await t.NC.data.buddy.checkin({ kind: 'sos', lat: 22.8, lng: 105 });
  const cur = await t.NC.data.buddy.current();
  assert.equal(cur.status, 'overdue');
  assert.equal(cur.alert_reason, 'sos');
  await t.NC.data.flush();
  await t.NC.data.buddy.checkin({ kind: 'checkin', lat: 22.81, lng: 105 });
  const after = await t.NC.data.buddy.current();
  assert.equal(after.status, 'active');
  assert.equal(after.alert_reason, null);
  let evs = await t.NC.data.buddy.events();
  const resolved = evs.find((e) => e.kind === 'resolved');
  const check = evs.filter((e) => e.kind === 'checkin').slice(-1)[0];
  assert.equal(resolved.meta.parent_event_id, check.id);
  assert.equal(resolved.received_at, null);
  await t.NC.data.flush();
  evs = await t.NC.data.buddy.events();
  assert.ok(evs.find((e) => e.kind === 'resolved').received_at, 'resolved acknowledged');
  assert.ok(evs.every((e) => e.received_at), 'no event left "sending…"');
});

/* ------------------------------------------------------------------ wipe + erase tombstone (A2/A3) */

test('offline wipe keeps a personal-data-free erase tombstone; reconnect stops the session and erases the device', async () => {
  const store = memStore();
  const t = sandbox({ store, secure: fakeSecure, settings: { last_position: { lat: 22.8, lng: 104.98, at: '2026-01-01T00:00:00Z' } } });
  await t.NC.data.init();
  const s = await t.NC.data.buddy.start(Object.assign({}, START, { interval_min: 1, grace_min: 0 }));
  await t.NC.data.flush();
  const dev = t.NC.data.status().deviceId;
  assert.ok(dev);
  // module traces
  for (const [k, v] of [['fa.ana', { doses: [1] }], ['fa.cpr', { at: 1 }], ['fa.kit', { a: 1 }], ['map.last_route', { from: { lat: 1, lng: 2 } }], ['map.ui', { a: 1 }],
    ['qr.reveals', [1]], ['qr.wallpaper_at', 'x'], ['tr.timings', [1]], ['bd.prefs', { email: 'le.ha@example.com' }], ['home.weather', { lat: 1 }],
    ['mp.last_position', { lat: 1 }], ['demo.seeded_at', 'x'], ['cache.routes', { rows: [] }]]) await store.set(k, v);
  t.net.online = false;
  await t.NC.data.buddy.checkin({ kind: 'location', lat: 23.1, lng: 105 });
  const res = await t.NC.data.wipePersonal();
  assert.deepEqual(plain(res), { pendingServerErase: true });
  const tomb = await store.get('erase.pending');
  assert.equal(tomb.device_id, dev);
  assert.ok(tomb.secret);
  assert.deepEqual(tomb.ops.map((o) => o.op), ['buddy.stop', 'device.erase']);
  assert.equal(tomb.ops[0].data.session_id, s.id);
  assert.equal(tomb.ops[0].data.lat, null);
  const tj = JSON.stringify(tomb);
  ['le.ha@example.com', 'Lê Hà', 'Minh Anh', '23.1', '22.8'].forEach((needle) => assert.ok(tj.indexOf(needle) < 0, 'tombstone has no ' + needle));
  assert.equal((await t.NC.data.outbox()).length, 0);
  assert.equal(await t.NC.data.buddy.current(), null);
  assert.equal(t.NC.data.status().deviceId, null);
  assert.equal(t.settings.last_position, null);
  assert.equal(t.settings.onboarded, false);
  const left = Array.from(store.kvm.keys()).sort();
  assert.deepEqual(left, ['cache.routes', 'erase.pending'], 'every personal kv trace removed: ' + left.join(','));
  assert.equal(await t.NC.data.erasePending().then((x) => !!x), true);
  assert.equal(t.NC.data.status().erasePending, true);
  // server still has the session running
  assert.notEqual((await srvSessions(t.NC)).find((x) => x.id === s.id).status, 'closed');
  // reconnect → flush sends the tombstone BEFORE registering a new identity
  const wire = spyWire(t.NC);
  t.net.online = true;
  await t.NC.data.flush();
  assert.equal(wire[0].id, dev, 'first call uses the wiped identity');
  assert.deepEqual(wire[0].ops.map((o) => o.op), ['buddy.stop', 'device.erase']);
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.ok(!srv || srv.status === 'closed', 'session stopped (or erased) on the server → no false alarm');
  const pending = await store.get('erase.pending');
  if (pending) {
    // backend without device.erase yet: the stop is acknowledged and not re-sent; device.erase is retried
    assert.deepEqual(pending.ops.map((o) => o.op), ['device.erase']);
    assert.ok(pending.attempts >= 1);
  } else {
    assert.equal(t.NC.data.status().erasePending, false);
  }
});

test('eraseServerData (online) closes the session, drops this identity and sends the tombstone', async () => {
  const t = sandbox({});
  await t.NC.data.init();
  const s = await t.NC.data.buddy.start(START);
  await t.NC.data.flush();
  await t.NC.data.submitReport({ kind: 'new', name: 'X', type: 'tram_y_te', lat: 22.79, lng: 105 });
  t.net.online = false;
  await t.NC.data.submitReport({ kind: 'new', name: 'Y', type: 'tram_y_te', lat: 22.79, lng: 105 });
  t.net.online = true;
  const r = await t.NC.data.eraseServerData();
  assert.equal(r.queued, true);
  assert.equal(typeof r.sent, 'boolean');
  assert.equal(await t.NC.data.buddy.current(), null);
  assert.equal((await t.NC.data.outbox()).length, 0);
  assert.equal(t.NC.data.status().deviceId, null);
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.ok(!srv || srv.status === 'closed');
  const none = sandbox({});
  await none.NC.data.init();
  assert.deepEqual(plain(await none.NC.data.eraseServerData()), { queued: false, sent: false }, 'nothing registered → nothing to erase');
});

/* ------------------------------------------------------------------ lazy supabase-js (A10) */

test('supabase-js is loaded through NC.loader only when a Supabase backend is configured', async () => {
  const SB = { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key', appVersion: '2.0.0', forceLocal: false };
  const calls = [];
  let ctxRef = null;
  const loader = {
    script(src) {
      calls.push(src);
      ctxRef.supabase = { createClient: () => ({ rpc: () => Promise.resolve({ data: null, error: { message: 'Invalid API key', code: '401' } }), channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() { }, auth: { getSession: () => Promise.resolve({ data: { session: null } }) }, from() { throw new Error('x'); } }) };
      return Promise.resolve();
    }
  };
  const a = sandbox({ config: SB, loader });
  ctxRef = a.ctx;
  await a.NC.data.init();
  assert.deepEqual(calls, ['assets/vendor/supabase/supabase.min.js']);
  assert.equal(a.NC.data.mode, 'local', 'bad key → local fallback (library was loaded and tried)');
  const calls2 = [];
  const b = sandbox({ config: Object.assign({}, SB, { forceLocal: true }), loader: { script: (s) => { calls2.push(s); return Promise.resolve(); } } });
  await b.NC.data.init();
  assert.deepEqual(calls2, [], 'forceLocal → library never fetched');
  const c = sandbox({ config: { supabaseUrl: '', supabaseAnonKey: '' }, loader: { script: (s) => { calls2.push(s); return Promise.resolve(); } } });
  await c.NC.data.init();
  assert.deepEqual(calls2, [], 'no keys → library never fetched');
  assert.equal(c.NC.data.mode, 'local');
});

/* ------------------------------------------------------------------ ?reset=1 (boot.js, wave3d NOTES §1) */

/* Crypto store double (own instance: never shares state with the other tests). */
function secureDouble() {
  const m = {};
  return {
    _m: m,
    seal: fakeSecure.seal, unseal: fakeSecure.unseal,
    save: (n, o) => { m[n] = JSON.parse(JSON.stringify(o)); return Promise.resolve(true); },
    load: (n) => Promise.resolve(m[n] ? JSON.parse(JSON.stringify(m[n])) : null),
    remove: (n) => { delete m[n]; return Promise.resolve(true); },
    wipe: () => { Object.keys(m).forEach((k) => delete m[k]); return Promise.resolve(true); }   // resolves synchronously, like a fast IDB clear
  };
}

/* Load the real boot.js into a tab whose URL carries ?reset=1; resolves the URL it reloads to. */
function bootReset(tab) {
  const ctx = tab.ctx;
  const replaced = [];
  ctx.location = { pathname: '/index.html', search: '?reset=1', hash: '#/home', replace: (u) => replaced.push(u) };
  ctx.NC.util = { qs: () => ({ reset: '1' }) };
  ctx.NC.settings.load = () => Promise.resolve(tab.NC.settings.all());
  ctx.NC.settings.reset = () => {
    Object.keys(tab.settings).forEach((k) => delete tab.settings[k]);
    Object.assign(tab.settings, { onboarded: false, lang: 'vi', theme: 'auto', simulated_offline: false, last_position: null, reset_marker: true });
    return Promise.resolve();
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/app/boot.js'), 'utf8'), ctx, { filename: 'assets/js/app/boot.js' });
  return ctx.NC.boot.done.then(() => replaced);
}

test('?reset=1 erases the device + open Buddy session on the server first, keeps the mock server DB and the admin session', async () => {
  const hub = browserHub();
  const store = memStore();
  const secure = secureDouble();
  const t = sandbox({ page: 'app', hub, store, secure });
  await t.NC.data.init();
  const s = await t.NC.data.buddy.start(Object.assign({}, START, { interval_min: 1, grace_min: 0 }));
  await t.NC.data.flush();
  const dev = t.NC.data.status().deviceId;
  assert.ok(dev);
  assert.equal((await srvSessions(t.NC)).find((x) => x.id === s.id).status, 'active');
  const facilitiesBefore = (await t.NC.backend.local._debug.all('facilities')).length;
  assert.ok(facilitiesBefore > 0);
  // another traveller's device + session on the same (mock) server must survive this device's reset
  const other = await t.NC.backend.local.register_device('viettel', null);
  const otherSid = webcrypto.randomUUID();
  const ro = await t.NC.backend.local.sync_device_ops(other.device_id, other.secret, [{ id: webcrypto.randomUUID(), op: 'buddy.start', created_at: new Date().toISOString(),
    data: { session_id: otherSid, traveler_name: 'Other', recipient_email: 'other@example.com', recipient_phone: '+84 000 000 002', interval_min: 60, grace_min: 15, client_ts: new Date().toISOString() } }]);
  assert.equal(ro.results[0].status, 'ok', JSON.stringify(ro.results));
  [['nc.admin.demo', '{"email":"demo@nomadcare.vn"}'], ['nc.admin.bud.alerts', 'true'], ['nc.server.cron', '{"tab":"x","until":1}'],
    ['nc.theme', 'dark'], ['nc.lang', 'en'], ['nc.fa.steps', 'list'], ['nc.sim_offline', '{"v":false}'], ['other.app', 'keep']].forEach(([k, v]) => hub.localStorage.setItem(k, v));
  await store.set('qr.reveals', [1]);
  await store.set('cache.routes', { rows: [] });

  const replaced = await bootReset(t);
  assert.deepEqual(replaced, ['/index.html#/home'], 'reloads without the flag');
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.ok(!srv || srv.status === 'closed', 'no orphaned dead-man switch left running on the server: ' + JSON.stringify(srv && srv.status));
  assert.equal((await t.NC.backend.local._debug.all('devices')).some((d) => d.id === dev), false, 'device row erased on the server');
  assert.equal(await store.get('erase.pending'), null, 'tombstone acknowledged and removed (online)');
  // the mock server DB is untouched otherwise
  assert.equal((await t.NC.backend.local._debug.all('facilities')).length, facilitiesBefore);
  assert.equal((await t.NC.backend.local._debug.all('devices')).some((d) => d.id === other.device_id), true, 'other devices kept');
  assert.equal((await srvSessions(t.NC)).find((x) => x.id === otherSid).status, 'active', 'other sessions kept');
  // local side: everything gone, settings back to defaults
  assert.deepEqual(Array.from(store.kvm.keys()), [], 'local stores wiped: ' + Array.from(store.kvm.keys()).join(','));
  assert.deepEqual(Object.keys(secure._m), [], 'credentials crypto-shredded');
  assert.equal(t.settings.reset_marker, true, 'NC.settings.reset() called');
  const ls = Array.from(hub.ls.keys()).filter((k) => k !== 'nc.server.msg').sort();   // (realtime relay of the mock server)
  assert.deepEqual(ls, ['nc.admin.bud.alerts', 'nc.admin.demo', 'nc.server.cron', 'other.app'], 'admin session / mock-server keys kept, app keys dropped: ' + ls.join(','));
  assert.equal(hub.localStorage.getItem('nc.admin.demo'), '{"email":"demo@nomadcare.vn"}', 'admin demo session untouched');
});

test('?reset=1 while offline keeps the erase tombstone through the local wipe; the next online flush stops the session', async () => {
  const hub = browserHub();
  const store = memStore();
  const secure = secureDouble();
  const t = sandbox({ page: 'app', hub, store, secure });
  await t.NC.data.init();
  const s = await t.NC.data.buddy.start(Object.assign({}, START, { interval_min: 1, grace_min: 0 }));
  await t.NC.data.flush();
  const dev = t.NC.data.status().deviceId;
  t.net.online = false;
  await bootReset(t);
  const tomb = await store.get('erase.pending');
  assert.ok(tomb && tomb.device_id === dev && tomb.secret, 'tombstone survived store.wipe');
  assert.deepEqual(tomb.ops.map((o) => o.op), ['buddy.stop', 'device.erase']);
  assert.deepEqual(Array.from(store.kvm.keys()), ['erase.pending'], 'nothing else left locally');
  assert.notEqual((await srvSessions(t.NC)).find((x) => x.id === s.id).status, 'closed', 'not sent while offline');
  t.net.online = true;
  await t.NC.data.flush();
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.ok(!srv || srv.status === 'closed', 'stopped at reconnect → no false alarm');
  assert.equal((await t.NC.backend.local._debug.all('devices')).some((d) => d.id === dev), false);
  assert.equal(await store.get('erase.pending'), null);
});

/* ------------------------------------------------------------------ round 2 R6 (W6): heartbeat + push ops */

test('heartbeats are coalesced per session in the outbox (latest wins), push.schedule per device; invalid push ops refused up front', async () => {
  const t = sandbox();
  await t.NC.data.init();
  assert.equal(await t.NC.data.buddy.heartbeat({ state: 'live' }), null, 'no open session → no heartbeat');
  t.net.online = false;
  const s = await t.NC.data.buddy.start(START);
  await t.NC.data.buddy.heartbeat({ state: 'live', lat: 22.1, lng: 105.1, accuracy_m: 9 });
  await t.NC.data.buddy.heartbeat({ state: 'live', lat: 22.2, lng: 105.2 });
  const su = new Date(Date.now() + 30 * 60000).toISOString();
  await t.NC.data.buddy.heartbeat({ session_id: s.id, state: 'paused', silence_until: su }, { beacon: true });
  let hb = (await t.NC.data.outbox()).filter((o) => o.op === 'buddy.heartbeat');
  assert.equal(hb.length, 1, 'an offline stretch never piles up heartbeats');
  assert.deepEqual([hb[0].data.state, hb[0].data.session_id, hb[0].data.silence_until], ['paused', s.id, su]);
  const item = (m) => ({ fire_at: new Date(Date.now() + m * 60000).toISOString(), kind: 'deadzone_ahead', minutes_before: 5, zone_km: m });
  await t.NC.data.push.schedule([item(10)]);
  await t.NC.data.push.schedule([item(20), item(30)]);
  const ps = (await t.NC.data.outbox()).filter((o) => o.op === 'push.schedule');
  assert.deepEqual([ps.length, ps[0].data.items.length], [1, 2], 'only the latest schedule is queued');
  // the topbar pill counts what the traveller did; heartbeats / push ops stay in the outbox (and in Settings) only
  const queued = await t.NC.data.outbox();
  const st1 = t.NC.data.status();
  assert.equal(st1.outboxTotal, queued.length);
  assert.equal(st1.outboxCount, queued.filter((o) => !/^(buddy\.heartbeat|push\.)/.test(o.op)).length, 'technical ops are not counted for the pill');
  assert.ok(st1.outboxCount >= 1 && st1.outboxCount === st1.outboxTotal - 2, 'buddy.start still counts; 1 heartbeat + 1 schedule do not');
  await assert.rejects(() => t.NC.data.push.subscribe({ endpoint: 'https://evil.example.org/x', p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }), (e) => e.code === 'invalid_push_endpoint');
  await assert.rejects(() => t.NC.data.push.subscribe({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'x', auth: 'y' }), (e) => e.code === 'invalid_push_keys');
  await assert.rejects(() => t.NC.data.push.schedule(Array.from({ length: 21 }, (x, i) => item(i + 1))), (e) => e.code === 'too_many_items');
  await assert.rejects(() => t.NC.data.push.schedule([{ fire_at: 'soon', kind: 'deadzone_ahead', minutes_before: 5, zone_km: 1 }]), (e) => e.code === 'invalid_push_schedule');
  // back online: one heartbeat reaches the server; a queued heartbeat never keeps the server's view of the session out
  const wire = spyWire(t.NC);
  t.net.online = true;
  await t.NC.data.flush();
  assert.equal(wire.flatMap((c) => c.ops).filter((o) => o.op === 'buddy.heartbeat').length, 1);
  const srv = (await srvSessions(t.NC)).find((x) => x.id === s.id);
  assert.deepEqual([srv.heartbeat_state, srv.silence_until], ['paused', su]);
  assert.ok(srv.last_heartbeat_at);
  hb = (await t.NC.data.outbox()).filter((o) => o.op === 'buddy.heartbeat');
  assert.equal(hb.length, 0, 'sent and removed');
  assert.deepEqual(t.NC.data.buddy.heartbeat.length, 2);
});
