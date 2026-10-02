// Runs the compiled push-dispatch Edge Function under Node 18+ with a fake Deno, a fake supabase client and a fake
// web-push. Asserts auth, the claim → send → result flow, 404/410 pruning, the endpoint allow-list and that the
// payload carries no coordinates. Usage: node run-push.mjs <dir containing push.mjs + fake-*.mjs>
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.argv[2] || '.');
const env = {
  SUPABASE_URL: 'https://example-ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CRON_SECRET: 'cron-secret',
  VAPID_PUBLIC_KEY: 'BPub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:team@example.org'
};
let handler = null;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const log = console.log;
console.log = () => { };

const sub = (endpoint, lang) => ({ endpoint, p256dh: 'A'.repeat(87), auth: 'B'.repeat(22), lang: lang || 'vi' });
globalThis.__pushClaim = () => [
  { id: 1, kind: 'deadzone_ahead', minutes_before: 5, zone_km: 12.3456, fire_at: new Date().toISOString(),
    subscriptions: [sub('https://fcm.googleapis.com/fcm/send/ok-1', 'vi'), sub('https://updates.push.services.mozilla.com/wpush/v2/gone-1', 'en')] },
  { id: 2, kind: 'deadzone_ahead', minutes_before: 15, zone_km: 3, fire_at: new Date().toISOString(),
    subscriptions: [sub('https://evil.example.org/collect', 'vi')] },
  { id: 3, kind: 'deadzone_ahead', minutes_before: 5, zone_km: 7, fire_at: new Date().toISOString(),
    subscriptions: [sub('https://web.push.apple.com/flaky-3', 'en')] },
  { id: 4, kind: 'deadzone_ahead', minutes_before: 5, zone_km: 8, fire_at: new Date().toISOString(), subscriptions: [] }
];

const mod = await import(pathToFileURL(path.join(dir, 'push.mjs')).href);
const fake = await import(pathToFileURL(path.join(dir, 'fake-supabase.mjs')).href);
const wp = await import(pathToFileURL(path.join(dir, 'fake-web-push.mjs')).href);
assert.ok(handler, 'Deno.serve was called');

async function call(headers, method = 'POST') {
  const res = await handler(new Request('https://f.local/push-dispatch', { method, headers, body: method === 'POST' ? '{}' : undefined }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let r = await call({}, 'GET');
assert.equal(r.status, 405, 'GET → 405');
r = await call({});
assert.equal(r.status, 401, 'no cron secret → 401');
r = await call({ 'x-nc-cron-secret': 'nope' });
assert.equal(r.status, 401, 'wrong cron secret → 401');
assert.equal(fake.calls.length, 0, 'nothing claimed without auth');

r = await call({ 'x-nc-cron-secret': 'cron-secret' });
assert.equal(r.status, 200);
assert.deepEqual(wp.default.vapid, { subject: 'mailto:team@example.org', pub: 'BPub', priv: 'priv' }, 'VAPID details from the secrets');
const claim = fake.calls.find((c) => c.fn === 'nc_push_claim');
assert.deepEqual(claim.args, { p_limit: 100 }, 'claim args');
assert.equal(wp.calls.length, 3, 'only allowed endpoints are contacted (evil host skipped)');
assert.ok(!wp.calls.some((c) => /evil/.test(c.sub.endpoint)), 'never POSTs to a non push-service URL');
const p1 = JSON.parse(wp.calls[0].payload);
assert.equal(p1.tag, 'nc-dz-12.346', 'tag per zone (same as the app notification)');
assert.equal(p1.kind, 'deadzone_ahead');
assert.match(p1.title, /vùng mất sóng/, 'Vietnamese subscription → Vietnamese text');
assert.match(JSON.parse(wp.calls[1].payload).title, /no-signal/, 'English subscription → English text');
assert.equal(wp.calls[0].options.TTL, 300, 'TTL = minutes before the zone');
assert.equal(wp.calls[0].options.urgency, 'high');
for (const c of wp.calls) {
  const p = JSON.parse(c.payload);
  assert.deepEqual(Object.keys(p).sort(), ['body', 'kind', 'minutes_before', 'tag', 'title', 'url'], 'generic payload keys only');
  assert.ok(!/\d+\.\d{4,}/.test(c.payload), 'no coordinates in the payload');
}
const res = fake.calls.filter((c) => c.fn === 'nc_push_result').map((c) => c.args);
assert.equal(res.length, 4, 'every reminder gets a result');
assert.deepEqual([res[0].p_id, res[0].p_ok, res[0].p_gone], [1, true, ['https://updates.push.services.mozilla.com/wpush/v2/gone-1']],
  'sent to one browser; the 410 endpoint is reported gone');
assert.deepEqual([res[1].p_id, res[1].p_ok, res[1].p_gone], [2, true, ['https://evil.example.org/collect']], 'a non push-service endpoint is dropped');
assert.equal(res[2].p_ok, false, 'a 500 from the push service is a failure (retried by SQL)');
assert.match(res[2].p_error, /push 500/);
assert.deepEqual([res[3].p_ok, res[3].p_gone], [true, null], 'no subscription: nothing to retry');
assert.deepEqual([r.body.processed, r.body.sent, r.body.failed, r.body.gone, r.body.ok], [4, 1, 3, 2, false], 'summary');
assert.equal(mod.validEndpoint('https://fcm.googleapis.com.evil.io/x'), false, 'look-alike host refused');
assert.equal(mod.validEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x'), true, 'WNS allowed');
console.log = log;
console.log('push-dispatch: all checks passed');
