// Runs the compiled deadman-alert Edge Function under Node 18+ with a fake Deno,
// a fake supabase client and a fake Resend (fetch). Asserts the HTTP contract and
// writes the rendered e-mails (email-*.html / .txt) next to the compiled module.
// Usage: node run.mjs <dir containing index.mjs + fake-supabase.mjs>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.argv[2] || '.');
const env = {
  SUPABASE_URL: 'https://example-ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  RESEND_API_KEY: 're_test', CRON_SECRET: 'cron-secret', ALLOWED_ORIGINS: 'https://admin.example.org'
};
let handler = null;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const sent = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  if (body.to[0] === 'bounce@gmail.com') {   // provider refuses this recipient
    return new Response('{"message":"The to address is invalid"}', { status: 422 });
  }
  sent.push({ url: String(url), headers: init.headers, body });
  return new Response(JSON.stringify({ id: 'em_' + sent.length }), { status: 200 });
};
const log = console.log;
console.log = () => { };   // the function logs a one-line summary per call

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const base = {
  id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', type: 'overdue', reason: 'overdue',
  traveler_name: 'Minh Anh <b>&', recipient_name: 'Lê Hà', recipient_email: 'ha@gmail.com', recipient_phone: null,
  route_id: 'ha-giang-loop', route_name: 'Hà Giang Loop', route_name_en: 'Ha Giang Loop', travel_mode: 'motorbike',
  interval_min: 60, grace_min: 15, status: 'overdue', started_at: iso(300), last_checkin_at: iso(200),
  next_due_at: iso(140), last_lat: 23.2521, last_lng: 105.4118, last_location_at: iso(190), overdue_by_min: 140,
  share_public_medical: true, public_medical: { blood_type: 'O+', allergies: 'Penicillin', conditions: 'Hen suyễn', medications: 'Ventolin' },
  resolved_note: null, claim_at: iso(0), server_time: iso(0)
};
globalThis.__claim = (args) => {
  if (args.p_type === 'resolved') return [{ ...base, type: 'resolved', reason: 'resolved', status: 'active', resolved_note: 'Đã gọi được' }];
  if (globalThis.__claimOnly) return globalThis.__claimOnly;
  return [
    base,
    { ...base, id: '2b4e28ba-2fa1-11d2-883f-0016d3cca427', reason: 'sos', alert_reason: 'sos', sos_at: iso(3),
      share_public_medical: false, public_medical: null, last_lat: null, last_lng: null, traveler_name: null, recipient_name: null },
    { ...base, id: '3b4e28ba-2fa1-11d2-883f-0016d3cca427', recipient_email: 'demo@example.com' }
  ];
};

await import(pathToFileURL(path.join(dir, 'index.mjs')).href);
const fake = await import(pathToFileURL(path.join(dir, 'fake-supabase.mjs')).href);
assert.ok(handler, 'Deno.serve was called');

async function call(headers, body, method = 'POST') {
  const res = await handler(new Request('https://f.local/deadman-alert', {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const cron = { 'x-nc-cron-secret': 'cron-secret' };
let r;

r = await call({ origin: 'https://evil.example' }, {});
assert.equal(r.status, 401, 'no credentials → 401');
assert.equal(r.headers.get('access-control-allow-origin'), 'https://admin.example.org', 'CORS pinned to ALLOWED_ORIGINS');
r = await call({ 'x-nc-cron-secret': 'wrong' }, {});
assert.equal(r.status, 401, 'wrong cron secret → 401');
r = await call({ authorization: 'Bearer user-jwt' }, {});
assert.equal(r.status, 401, 'signed-in non-admin → 401');
r = await handler(new Request('https://f.local/deadman-alert', { method: 'OPTIONS', headers: { origin: 'https://admin.example.org' } }));
assert.equal(r.status, 204, 'CORS preflight → 204');
r = await call(cron, undefined, 'GET');
assert.equal(r.status, 405, 'GET → 405');
r = await call({ authorization: 'Bearer admin-jwt' }, { session_id: 'not-a-uuid' });
assert.equal(r.status, 400, 'invalid session id → 400');
r = await call(cron, { type: 'resolved' });
assert.equal(r.status, 400, 'resolved without session id → 400');

r = await call(cron, {});
assert.equal(r.status, 200);
assert.deepEqual([r.body.mode, r.body.type, r.body.processed, r.body.sent, r.body.failed], ['cron', 'overdue', 3, 3, 0]);
assert.equal(sent.length, 2, 'reserved-domain recipient is not e-mailed');
assert.equal(r.body.results[2].provider, 'demo', 'reserved-domain send is simulated');
const claim = fake.calls.find((c) => c.fn === 'nc_alert_claim');
assert.deepEqual(claim.args, { p_session_id: null, p_type: 'overdue', p_force: false, p_limit: 25 }, 'cron claim args');
const results = fake.calls.filter((c) => c.fn === 'nc_alert_result');
assert.equal(results.length, 3, 'every outcome recorded');
assert.equal(results[0].args.p_trigger, 'cron');
assert.equal(results[0].args.p_reason, 'overdue', 'the reason the e-mail was worded with is recorded');
assert.equal(results[1].args.p_reason, 'sos');
assert.ok(!('p_actor' in results[0].args) && !('p_actor' in claim.args), 'cron calls carry no actor');
assert.equal(r.body.ok, true, 'ok when every e-mail went out');
assert.deepEqual(r.body.results.map((x) => x.reason), ['overdue', 'sos', 'overdue'], 'results carry the reason');
assert.match(sent[0].headers['Idempotency-Key'], /^nc-1b4e28ba-.*-overdue-\d+$/, 'Resend idempotency key');
assert.ok(!sent[0].body.html.includes('<b>&'), 'traveller name is HTML-escaped');
assert.ok(sent[0].body.html.includes('Minh Anh &lt;b&gt;&amp;'), 'escaped name present');
assert.ok(sent[0].body.html.includes('https://www.google.com/maps/search/?api=1&amp;query=23.25210,105.41180'), 'maps link');
assert.ok(sent[0].body.html.includes('Penicillin'), 'consented medical layer shown');
assert.ok(!sent[1].body.html.includes('Hồ sơ y tế công khai'), 'no medical block without consent');
assert.match(sent[1].body.subject, /^\[NomadCare\] SOS · /, 'SOS subject starts with SOS');
assert.ok(!/missed|chưa check-in/i.test(sent[1].body.subject), 'SOS subject never says missed check-in');
assert.ok(sent[1].body.html.includes('Thời điểm bấm SOS') && !sent[1].body.html.includes('Hạn check-in'), 'SOS e-mail shows the SOS time, not the due time');
assert.ok(sent[1].body.text.includes('SOS'), 'SOS in the plain-text part');

r = await call({ authorization: 'Bearer admin-jwt' }, { session_id: base.id });
assert.equal(r.body.mode, 'admin');
const adminClaim = fake.calls.filter((c) => c.fn === 'nc_alert_claim').pop();
assert.deepEqual([adminClaim.args.p_session_id, adminClaim.args.p_force], [base.id, true], 'admin trigger forces the given session');
assert.equal(adminClaim.args.p_actor, 'admin-1', 'manual claim names the admin (audit attribution)');
const adminResult = fake.calls.filter((c) => c.fn === 'nc_alert_result').pop();
assert.equal(adminResult.args.p_trigger, 'manual');
assert.equal(adminResult.args.p_actor, 'admin-1', 'manual result names the admin');

// a failed e-mail is reported as failed (ok: false, error), never as "nothing to send"
globalThis.__claimOnly = [{ ...base, id: '4b4e28ba-2fa1-11d2-883f-0016d3cca427', recipient_email: 'bounce@gmail.com' }];
r = await call({ authorization: 'Bearer admin-jwt' }, { session_id: '4b4e28ba-2fa1-11d2-883f-0016d3cca427' });
assert.equal(r.status, 200);
assert.deepEqual([r.body.ok, r.body.processed, r.body.sent, r.body.failed], [false, 1, 0, 1], 'failure summary');
assert.match(r.body.error, /Resend HTTP 422/, 'first provider error surfaced');
assert.equal(r.body.results[0].status, 'failed');
const failRec = fake.calls.filter((c) => c.fn === 'nc_alert_result').pop();
assert.deepEqual([failRec.args.p_ok, failRec.args.p_actor], [false, 'admin-1'], 'failure recorded for the admin');

// database without the wave-3 signatures: retried without p_actor / p_reason
globalThis.__legacy = true;
const before = fake.calls.length;
r = await call({ authorization: 'Bearer admin-jwt' }, { session_id: base.id });
globalThis.__legacy = false;
globalThis.__claimOnly = null;
const legacy = fake.calls.slice(before);
assert.equal(r.body.sent, 0, 'bounce claim reused');
assert.ok(legacy.some((c) => c.fn === 'nc_alert_claim' && !('p_actor' in c.args)), 'claim retried with the old signature');
assert.ok(legacy.some((c) => c.fn === 'nc_alert_result' && !('p_actor' in c.args) && !('p_reason' in c.args)), 'result retried with the old signature');

// inline all-clear of an erased device (cron secret only; no claim/result)
const n0 = fake.calls.length;
const s0 = sent.length;
const inlineBody = { type: 'resolved', session_id: '5b4e28ba-2fa1-11d2-883f-0016d3cca427', source: 'erase',
  inline: { ...base, id: '5b4e28ba-2fa1-11d2-883f-0016d3cca427', type: 'resolved', reason: 'resolved', recipient_email: 'erased@gmail.com' } };
r = await call(cron, inlineBody);
assert.deepEqual([r.body.ok, r.body.type, r.body.sent], [true, 'resolved', 1], 'inline all-clear sent');
assert.equal(sent.length, s0 + 1);
assert.match(sent[sent.length - 1].body.subject, /an toàn|All clear/, 'inline all-clear subject');
assert.equal(fake.calls.length, n0, 'inline payload: no claim, no result (the row is gone)');
r = await call({ authorization: 'Bearer admin-jwt' }, { type: 'resolved', inline: inlineBody.inline });
assert.equal(r.status, 400, 'an admin cannot send an inline payload');

r = await call(cron, { session_id: base.id, type: 'resolved' });
assert.equal(r.body.type, 'resolved');
const clear = sent[sent.length - 1];
assert.match(clear.body.subject, /an toàn|All clear/, 'all-clear subject');

// contact_lost (round 2 R6, 20260930000200): the live app went silent outside a predicted dead zone
globalThis.__claimOnly = [{ ...base, id: '6b4e28ba-2fa1-11d2-883f-0016d3cca427', reason: 'contact_lost', alert_reason: 'contact_lost',
  last_heartbeat_at: iso(22), heartbeat_state: 'live', silence_until: null, next_due_at: iso(-120), recipient_email: 'lost@gmail.com' }];
r = await call(cron, {});
globalThis.__claimOnly = null;
assert.deepEqual([r.body.sent, r.body.results[0].reason], [1, 'contact_lost'], 'contact_lost e-mail sent');
const lost = sent[sent.length - 1];
assert.match(lost.body.subject, /^\[NomadCare\] Mất liên lạc bất thường với .+ · Lost contact with /, 'contact_lost subject');
assert.ok(!/SOS|missed|chưa check-in/i.test(lost.body.subject), 'contact_lost is neither an SOS nor a missed check-in');
assert.ok(lost.body.html.includes('không phải vùng mất sóng dự kiến') && lost.body.html.includes('not a no-signal area expected'),
  'explains: abnormal loss of contact, not a predicted dead zone');
assert.ok(lost.body.html.includes('Tín hiệu cuối từ ứng dụng') && lost.body.html.includes('Hạn check-in tiếp theo') && !lost.body.html.includes('Check-in was due'),
  'last signal + next check-in rows (no "was due")');
assert.ok(lost.body.html.includes('https://www.openstreetmap.org/?mlat=23.25210&amp;mlon=105.41180'), 'last location map link');
assert.ok(lost.body.text.includes('Last signal from the app'), 'plain-text part has the last signal');
assert.equal(fake.calls.filter((c) => c.fn === 'nc_alert_result').pop().args.p_reason, 'contact_lost', 'reason recorded');
fs.writeFileSync(path.join(dir, 'email-contact_lost.html'), lost.body.html);

fs.writeFileSync(path.join(dir, 'email-overdue.html'), sent[0].body.html);
fs.writeFileSync(path.join(dir, 'email-overdue.txt'), sent[0].body.text);
fs.writeFileSync(path.join(dir, 'email-sos.html'), sent[1].body.html);
fs.writeFileSync(path.join(dir, 'email-resolved.html'), clear.body.html);
console.log = log;
console.log(`edge function: all checks passed; e-mails written to ${dir}/email-*.html`);
