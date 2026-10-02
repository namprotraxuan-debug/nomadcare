/*
 * buddy-phone.test.js — node --test suite for the Buddy recipient phone on the MOD.04 side (2026-10-02 decisions):
 *   (1) demo mode prefills only the recipient name + phone, never an e-mail (judges walk the real phone-first flow);
 *   (2) Vietnamese numbers must be mobiles (03x 05x 07x 08x 09x): a 02x landline gets its own error code
 *       'recipient_phone_not_mobile' and a clear VI + EN message in every layer.
 * Loads backend-local.js (NC.backend.shared.normPhone) + mod04-buddy.js in a vm sandbox with minimal DOM stubs (the
 * screen is never mounted), then checks the wrapper NC.buddyPhone.norm, the i18n dictionaries and the error-code
 * plumbing of dataservice / backend-supabase / the SQL migration. Server-side semantics are in data.test.js /
 * dataservice.test.js and tools/db-test/tests.sql.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));
const CODE = 'recipient_phone_not_mobile';

/** backend-local + mod04 in a vm: returns NC and the captured i18n dictionaries {vi:{…}, en:{…}}. */
function load(query) {
  const dict = { vi: {}, en: {} };
  const ctx = {
    console, Date, Math, JSON, Promise, TextEncoder, Uint8Array, DataView, crypto: webcrypto, unescape, encodeURIComponent,
    setTimeout: () => 0, clearTimeout: () => { }, setInterval: () => 0, clearInterval: () => { },
    addEventListener: () => { }, removeEventListener: () => { },
    navigator: { onLine: true },
    document: { readyState: 'complete', addEventListener: () => { }, getElementById: () => null, createElement: () => ({ style: {} }) },
    location: { search: query || '', hash: '' }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.NC = {
    util: { h: () => ({}), esc: (s) => String(s), qs: () => (query === '?demo=1' ? { demo: '1' } : {}), $: () => null, $$: () => [] },
    i18n: {
      add: (d) => { Object.assign(dict.vi, d.vi || {}); Object.assign(dict.en, d.en || {}); },
      t: (k) => k, lang: () => 'vi'
    }
  };
  ['assets/js/services/backend-local.js', 'assets/js/app/mod04-buddy.js'].forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  return { NC: ctx.NC, dict };
}

test('NC.buddyPhone.norm (mod04): landline flag passed through, legacy landline still displays, mobiles / international / demo valid', () => {
  const { NC } = load('?demo=1');
  const n = NC.buddyPhone.norm;
  assert.deepEqual(plain(n('024 3826 4444')),
    { e164: '+842438264444', valid: false, isDemo: false, empty: false, landline: true, display: '+84 24 3826 4444' });
  assert.deepEqual(plain(n('0912345678')),
    { e164: '+84912345678', valid: true, isDemo: false, empty: false, landline: false, display: '+84 912 345 678' });
  assert.deepEqual(plain(n('+84 000 000 001')),
    { e164: '+84000000001', valid: true, isDemo: true, empty: false, landline: false, display: '+84 000 000 001' });
  assert.equal(n('+44 20 7946 0958').valid, true, 'international numbers stay accepted');
  assert.equal(n('+84 28 3829 5555').landline, true);
  assert.deepEqual([n('').empty, n('').valid, n('').landline], [true, false, false]);
  ['0312 345 678', '0562 345 678', '0701 234 567', '0812 345 678', '0987 654 321'].forEach((raw) => assert.equal(n(raw).valid, true, raw));
});

test('NC.buddyPhone.mask (recipient card): one space around *** for mobiles and legacy landlines', () => {
  const { NC } = load();
  const m = (raw) => NC.buddyPhone.mask(NC.buddyPhone.norm(raw).display);
  assert.equal(m('0912345678'), '+84 912 *** 678');
  assert.equal(m('+84 000 000 001'), '+84 000 *** 001');
  assert.equal(m('024 3826 4444'), '+84 24 *** 444', 'legacy landline: no double space');
  assert.equal(NC.buddyPhone.mask('+442079460958'), '+442079 *** 958');
  assert.equal(NC.buddyPhone.mask(''), '');
  assert.equal(NC.buddyPhone.mask('12345'), '***');
  ['0912345678', '024 3826 4444', '+84 000 000 001'].forEach((raw) => assert.ok(!/\s{2}/.test(m(raw)), raw));
});

test('MOD.04 i18n: 02x landline message + server refusal text in VI and EN; hint and label ask for a mobile number', () => {
  const { dict } = load();
  ['bd.f.err_phone_mobile', 'bd.err.recipient_phone_not_mobile', 'bd.f.rphone_hint', 'bd.f.rphone', 'bd.f.err_phone', 'bd.f.err_phone_req']
    .forEach((k) => assert.ok(dict.vi[k] && dict.en[k], k + ' in VI and EN'));
  assert.equal(dict.vi['bd.f.err_phone_mobile'], 'Hãy nhập số di động (03x, 05x, 07x, 08x, 09x) — số máy bàn 02x không nhận được SMS.');
  assert.equal(dict.en['bd.f.err_phone_mobile'], "Enter a mobile number (03x, 05x, 07x, 08x, 09x) — 02x landlines can't receive SMS.");
  assert.ok(/di động/.test(dict.vi['bd.f.rphone_hint']) && /02x/.test(dict.vi['bd.f.rphone_hint']), 'VI hint says a mobile is required');
  assert.ok(/mobile/i.test(dict.en['bd.f.rphone_hint']) && /02x/.test(dict.en['bd.f.rphone_hint']), 'EN hint says a mobile is required');
  assert.ok(/02x/.test(dict.vi['bd.err.recipient_phone_not_mobile']) && /02x/.test(dict.en['bd.err.recipient_phone_not_mobile']));
  // index.html carries the VI text before i18n runs: same strings
  const html = read('index.html');
  ['bd.f.rphone', 'bd.f.rphone_hint', 'bd.f.err_phone_req'].forEach((k) => {
    const m = new RegExp('data-i18n="' + k.replace(/\./g, '\\.') + '">([^<]*)<').exec(html);
    assert.ok(m, k + ' in index.html');
    assert.equal(m[1], dict.vi[k], k + ' default text = VI string');
  });
});

test('MOD.04 demo prefill (2026-10-02): no e-mail is ever prefilled; the phone error maps the new server code', () => {
  const src = read('assets/js/app/mod04-buddy.js');
  assert.ok(!/le\.ha@example\.com|DEMO_EMAIL/.test(src), 'no demo e-mail constant');
  const sets = src.match(/fRemail\.value\s*=[^=][^;]*;/g) || [];
  assert.deepEqual(sets.map((x) => x.replace(/\s+/g, ' ')), ["fRemail.value = o.recipient_email || '';", 'fRemail.value = remail;'],
    'the e-mail field is only filled from the previous session ("Set up again") or trimmed — never prefilled');
  assert.ok(/RECIPIENT_CODES = \[[^\]]*'recipient_phone_not_mobile'/.test(src), 'server refusal shown as a sync problem');
  assert.ok(/recipient_phone_not_mobile: 'bd\.f\.err_phone_mobile'/.test(src), 'server code → field message');
  assert.ok(/n\.landline \? 'bd\.f\.err_phone_mobile'/.test(src), 'form / blur check uses the landline flag');
  // a 02x landline emergency contact from the MOD.03 profile shows the mobile-only error as soon as it is prefilled
  const pre = src.slice(src.indexOf('if (!f.fRphone.value && id.contact_phone)'), src.indexOf('if (st.prefill && st.loaded)'));
  assert.ok(pre.length > 0 && /phoneError\(id\.contact_phone\)/.test(pre) && /fieldError\(f\.fldRphone, true,/.test(pre),
    'profile prefill runs the phone check');
  // the demo profile itself (boot.js) carries a phone but no e-mail
  const boot = read('assets/js/app/boot.js');
  assert.ok(/contact_phone: '\+84 000 000 001'/.test(boot) && !/@/.test(boot.slice(boot.indexOf('function seedDemo'), boot.indexOf('function resetStaleSim'))),
    'boot demo seed: phone, no e-mail');
});

test('recipient_phone_not_mobile is known to every layer (dataservice, backend-local, backend-supabase, SQL migration)', () => {
  const ds = read('assets/js/services/dataservice.js');
  assert.ok(/PERMANENT_ERRORS = \[[^\]]*'recipient_phone_not_mobile'/.test(ds), 'permanent op error');
  assert.ok(/START_REFUSED = \[[^\]]*'recipient_phone_not_mobile'/.test(ds), 'refused start → dead session');
  assert.ok(new RegExp("err\\('" + CODE + "'").test(ds), 'up-front check');
  assert.ok(new RegExp("opErr\\('" + CODE + "'\\)").test(read('assets/js/services/backend-local.js')), 'local server');
  assert.ok(/KNOWN_CODES = \[[^\]]*'recipient_phone_not_mobile'/.test(read('assets/js/services/backend-supabase.js')), 'Supabase error mapping');
  const sql = read('supabase/migrations/20261002000100_buddy_mobile_only.sql');
  assert.ok(/raise exception 'recipient_phone_not_mobile' using errcode = '22023'/.test(sql), 'SQL op_buddy_start');
  assert.ok(/create or replace function app_private\.phone_is_landline/.test(sql) && /create or replace function app_private\.valid_phone/.test(sql));
});
