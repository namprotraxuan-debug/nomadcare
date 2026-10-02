/*
 * tripwatch.test.js — node --test suite for the pure scheduling core of NC.trip (assets/js/services/tripwatch.js,
 * round 2 R6, owner W6): dead-zone clusters, reminder times (ETA − lead with the routing speed), late reminders
 * (fire now while the zone is still ahead, skip once inside / past), progress from ONE fix (off route, loop routes),
 * auto-end (arrival ≤ 300 m, 2× expected duration), silence_until of the heartbeat, Web Push items, SMS / OSM links.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const R = require(path.join(ROOT, 'assets/js/services/routing.js'));
const core = require(path.join(ROOT, 'assets/js/services/tripwatch.js'));

const MIN = 60000;
const T0 = Date.parse('2026-10-01T06:00:00Z');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);

/* A straight 50 km west → east road at 22°N (0.1° steps). */
const GEOM = [];
for (let i = 0; i <= 5; i++) GEOM.push([22.0, 105.0 + i * 0.1]);
const LEN = R.lineLengthKm(GEOM);
const at = (km) => { const p = R.pointAt(GEOM, km); return { lat: p[0], lng: p[1] }; };
const progress = typeof R.progressOnLine === 'function' ? R.progressOnLine
  : (g, p) => { const n = R.nearestOnLine(g, { lat: p[0], lng: p[1] }); return { km_along: n.along_km, offset_km: n.distance_km }; };
function plan(extra) {
  return Object.assign({
    route_key: 'test:a-b', source: 'offline', route_id: 'mini-loop', carrier: 'viettel', mode: 'motorbike', speed_kmh: 25,
    length_km: LEN, geometry: GEOM, unknown_km: 0, from_label: 'A', to_label: 'B', dest: GEOM[GEOM.length - 1],
    zones: [{ start_km: 10, end_km: 12, length_km: 2 }, { start_km: 30, end_km: 31, length_km: 1 }], created_at: new Date(T0).toISOString()
  }, extra || {});
}

test('clusters: zones closer than the mode threshold are one reminder; ordered; keys by start km', () => {
  const c = core.clusters([{ start_km: 30, end_km: 31 }, { start_km: 10, end_km: 11 }, { start_km: 12.5, end_km: 13 }, { start_km: 5, end_km: 5 }], 2);
  assert.deepEqual(c.map((z) => [z.key, z.start_km, z.end_km, z.length_km, z.zones]),
    [['z10.000', 10, 13, 3, 2], ['z30.000', 30, 31, 1, 1]], '10–11 and 12.5–13 merge (gap 1.5 < 2 km); empty zone dropped');
});

test('makeTrip: defaults per mode (25 km/h + 5 min, 3.5 km/h + 15 min), 2× expected duration, invalid plans refused', () => {
  const tr = core.makeTrip(plan({ speed_kmh: null }), T0);
  assert.equal(tr.mode, 'motorbike');
  assert.equal(tr.speed_kmh, R.SPEEDS.motorbike);
  assert.equal(tr.lead_min, R.THRESHOLDS.motorbike.minutes);
  assert.equal(tr.pos_km, 0);
  near(tr.expected_min, LEN / 25 * 60, 0.1, 'expected duration');
  near(Date.parse(tr.ends_at) - T0, 2 * LEN / 25 * 60 * MIN, 60000, 'auto-end at 2× the expected duration');
  const hk = core.makeTrip(plan({ mode: 'hiking', speed_kmh: undefined }), T0);
  assert.deepEqual([hk.speed_kmh, hk.lead_min], [3.5, 15]);
  assert.throws(() => core.makeTrip(plan({ geometry: [[22, 105]] }), T0), /invalid_plan/);
  assert.throws(() => core.makeTrip(plan({ geometry: [[99, 105], [22, 105.1]] }), T0), /invalid_plan/);
});

test('schedule: fire_at = ETA − lead; late but still ahead → due (fire now); estimate inside / past → skipped; fired stays fired', () => {
  const tr = core.makeTrip(plan(), T0);
  let a = core.schedule(tr, T0);
  assert.deepEqual(a.map((x) => x.status), ['pending', 'pending']);
  near(Date.parse(a[0].eta_at) - T0, 10 / 25 * 60 * MIN, 1000, 'ETA of km 10 at 25 km/h = 24 min');
  near(Date.parse(a[0].fire_at) - T0, 19 * MIN, 1000, 'reminder 5 min before');
  near(a[0].minutes_to_zone, 24, 0.01);
  near(a[0].silence_min, 2 / 25 * 60, 0.01, 'expected silence = zone length / speed');
  assert.equal(core.nextWake(tr, T0), Date.parse(a[0].fire_at), 'next wake = first pending reminder');
  // the app was asleep: 20 min later (estimate km 8.3 < 10) → show it now
  a = core.schedule(tr, T0 + 20 * MIN);
  assert.equal(a[0].status, 'due');
  // 30 min later the estimate (km 12.5) is past the zone start → skipped, the next zone keeps its reminder
  a = core.schedule(tr, T0 + 30 * MIN);
  assert.deepEqual(a.map((x) => x.status), ['skipped', 'pending']);
  tr.fired[a[1].key] = new Date(T0).toISOString();
  assert.equal(core.schedule(tr, T0 + 30 * MIN)[1].status, 'fired');
});

test('nextDue: two reminders due at once → the nearest fires, the later one waits until that zone is left', () => {
  const tr = core.makeTrip(plan({ mode: 'hiking', speed_kmh: 3.5, zones: [{ start_km: 0.02, end_km: 0.05 }, { start_km: 0.86, end_km: 0.9 }] }), T0);
  let a = core.schedule(tr, T0);
  assert.deepEqual(a.map((x) => x.status), ['due', 'due'], 'both inside one 15-min lead window');
  const first = core.nextDue(tr, T0);
  assert.equal(first.key, 'z0.020', 'the imminent zone, not the later one');
  tr.fired[first.key] = new Date(T0).toISOString();                 // what fire() records
  a = core.schedule(tr, T0);
  assert.deepEqual(a.map((x) => x.status), ['fired', 'pending']);
  assert.equal(a[1].fire_at, first.exit_at, 'held until the estimated exit of the nearer zone');
  assert.equal(core.nextWake(tr, T0), Date.parse(first.exit_at));
  assert.equal(core.nextDue(tr, T0), null);
  const second = core.nextDue(tr, Date.parse(first.exit_at) + 1000);
  assert.equal(second && second.key, 'z0.860', 'then the later zone gets its own reminder');
  assert.ok(second.minutes_to_zone > 10, 'still well ahead');
  assert.equal(core.schedule(tr, T0 + 16 * MIN)[1].status, 'skipped', 'a held reminder whose zone the estimate reached is never shown late');
  assert.equal(core.nextDue(core.makeTrip(plan(), T0), T0), null, 'nothing due at the start of a normal trip');
});

test('applyFix: one fix moves the progress (slower than estimated → reminder re-armed; inside the zone → skipped); off route ignored', () => {
  const tr = core.makeTrip(plan(), T0);
  const now = T0 + 20 * MIN;
  assert.equal(core.schedule(tr, now)[0].status, 'due');
  const fix = Object.assign(at(2), { at: new Date(now).toISOString(), source: 'gps' });
  const r = core.applyFix(tr, fix, progress, now);
  assert.ok(r.used);
  near(tr.pos_km, 2, 0.05, 'progress from the fix');
  const a = core.schedule(tr, now);
  assert.equal(a[0].status, 'pending', 'still 8 km away → reminder again at ETA − 5 min');
  near(Date.parse(a[0].fire_at) - now, (8 / 25 * 60 - 5) * MIN, 5000);
  core.applyFix(tr, Object.assign(at(11), { at: new Date(now + MIN).toISOString() }), progress, now + MIN);
  assert.equal(core.schedule(tr, now + MIN)[0].status, 'skipped', 'already inside the zone: too late, no popup');
  const off = { lat: at(20).lat + 0.1, lng: at(20).lng, at: new Date(now).toISOString() };   // ≈ 11 km north
  const before = tr.pos_km;
  const r2 = core.applyFix(tr, off, progress, now + 2 * MIN);
  assert.deepEqual([r2.used, tr.pos_km], [false, before], 'a fix > 5 km off the route does not move the progress');
  assert.ok(tr.off_route_km > 5);
});

test('loop route (start ≈ end): a fix near the ends is read with the estimate; no "arrived" at the start line', () => {
  const loop = GEOM.concat(GEOM.slice(0, -1).reverse());       // out and back: 100 km, start = end
  const len = R.lineLengthKm(loop);
  const tr = core.makeTrip(plan({ geometry: loop, length_km: len, dest: loop[loop.length - 1], zones: [] }), T0);
  const start = { lat: loop[0][0], lng: loop[0][1] + 0.001, at: new Date(T0 + 5 * MIN).toISOString() };
  assert.equal(core.endReason(tr, T0 + 5 * MIN, start), null, 'at the start of a loop: not arrived');
  core.applyFix(tr, start, progress, T0 + 5 * MIN);
  assert.ok(tr.pos_km < 1, 'early in the ride: the start end');
  const late = T0 + (len / 25 * 60 - 3) * MIN;                 // estimate: almost done
  const back = { lat: loop[0][0], lng: loop[0][1] + 0.002, at: new Date(late).toISOString() };   // ≈ 200 m from home
  core.applyFix(tr, back, progress, late);
  assert.ok(tr.pos_km > len - 2, 'late in the ride: the finish end (' + tr.pos_km + ')');
  assert.equal(core.endReason(tr, late, back), 'arrived', 'back home after the loop → arrived');
});

test('endReason: arrival ≤ 300 m from the destination, expiry at 2× expected duration', () => {
  const tr = core.makeTrip(plan(), T0);
  const dest = { lat: GEOM[5][0], lng: GEOM[5][1] };
  assert.equal(core.endReason(tr, T0 + MIN, { lat: dest.lat + 0.002, lng: dest.lng }), 'arrived', '≈ 220 m');
  assert.equal(core.endReason(tr, T0 + MIN, { lat: dest.lat + 0.004, lng: dest.lng }), null, '≈ 440 m');
  assert.equal(core.endReason(tr, Date.parse(tr.ends_at) - 1000, null), null);
  assert.equal(core.endReason(tr, Date.parse(tr.ends_at), null), 'expired');
});

test('silenceUntil: ETA exit of the current / imminent zone + 15 min; nothing when the next zone is far', () => {
  const tr = core.makeTrip(plan(), T0);
  assert.equal(core.silenceUntil(tr, T0), null, 'zone 24 min away (> 5 + 15 min): a later heartbeat announces it');
  const t1 = T0 + 6 * MIN;                                       // km 2.5 → zone in 18 min
  near(Date.parse(core.silenceUntil(tr, t1)) - T0, (12 / 25 * 60 + 15) * MIN, 2000, 'exit at km 12 (28.8 min) + 15 min');
  const t2 = T0 + 26 * MIN;                                      // km 10.8: inside
  near(Date.parse(core.silenceUntil(tr, t2)) - T0, (12 / 25 * 60 + 15) * MIN, 2000, 'inside the zone: its exit + 15 min');
  const t3 = T0 + 40 * MIN;                                      // km 16.7: next zone (30) 32 min away
  assert.equal(core.silenceUntil(tr, t3), null);
  const t4 = T0 + (31 / 25 * 60 + 1) * MIN;                      // past the last zone
  assert.equal(core.silenceUntil(tr, t4), null);
  assert.equal(core.silenceUntil(null, T0), null);
});

test('pushItems: pending reminders only, within 48 h, at most 20, generic fields', () => {
  const zones = [];
  for (let i = 0; i < 25; i++) zones.push({ start_km: 3 + i * 1.8, end_km: 3.1 + i * 1.8 });
  const tr = core.makeTrip(plan({ mode: 'hiking', speed_kmh: 3.5, zones }), T0);
  const items = core.pushItems(tr, T0);
  assert.ok(items.length <= 20, 'at most 20');
  items.forEach((i) => {
    assert.deepEqual(Object.keys(i).sort(), ['fire_at', 'kind', 'minutes_before', 'zone_km']);
    assert.equal(i.kind, 'deadzone_ahead');
    assert.equal(i.minutes_before, 15);
    assert.ok(Date.parse(i.fire_at) > T0 && Date.parse(i.fire_at) - T0 <= 48 * 3600000);
  });
  const trip2 = core.makeTrip(plan(), T0);
  assert.deepEqual(core.pushItems(trip2, T0).map((i) => i.zone_km), [10, 30]);
  trip2.fired['z10.000'] = new Date(T0).toISOString();
  assert.deepEqual(core.pushItems(trip2, T0).map((i) => i.zone_km), [30], 'a shown reminder is not pushed again');
});

test('links: sms:<number>?&body=… (iOS + Android) and the OSM link of the e-mails', () => {
  assert.equal(core.smsHref('+84 912 345 678', 'Vị trí: 22.1, 105.2 & more'), 'sms:+84912345678?&body=' + encodeURIComponent('Vị trí: 22.1, 105.2 & more'));
  assert.equal(core.osmLink(22.123456, 105.9), 'https://www.openstreetmap.org/?mlat=22.12346&mlon=105.90000#map=15/22.12346/105.90000');
});
