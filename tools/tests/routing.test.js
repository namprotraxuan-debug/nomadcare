/*
 * routing.test.js — node --test suite for assets/js/services/routing.js (owner: P1 data).
 * Synthetic graphs only (no seed dependency): strategies, reversed edges, snapping, analysis totals,
 * dead-zone thresholds per travel mode, mode detection, stops along, geometry helpers, A* vs Dijkstra optimality.
 * Run: node --test tools/tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const R = require(path.join(__dirname, '../../assets/js/services/routing.js'));

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);

/* ---------- synthetic pack builder ---------- */

/** Offset a base point by dx/dy km (equirectangular, fine for tests). */
function at(base, dxKm, dyKm) {
  const lat = base[0] + dyKm / 110.574;
  const lng = base[1] + dxKm / (111.32 * Math.cos(base[0] * Math.PI / 180));
  return [lat, lng];
}

/** Build a Pack-like object. edges: {id, from, to, via?:[[lat,lng]], segs?:[[from_km,to_km,level]]} */
function makePack(nodes, edges, extra) {
  const byId = {};
  nodes.forEach((n) => { byId[n.id] = n; });
  const packEdges = [];
  const segments = [];
  edges.forEach((e) => {
    const geom = [[byId[e.from].lat, byId[e.from].lng]].concat(e.via || [], [[byId[e.to].lat, byId[e.to].lng]]);
    const len = R.lineLengthKm(geom);
    packEdges.push({ id: e.id, from: e.from, to: e.to, length_km: len, is_connector: false, geometry: geom });
    (e.segs || []).forEach((s, i) => {
      const toKm = s[1] === 'end' ? len : s[1];
      segments.push({ edge_id: e.id, seq: i, from_km: s[0], to_km: toKm, level: s[2], confidence: 0.8 });
    });
  });
  return Object.assign({
    schema: 1,
    route: { id: 'test', name: 'Test', bbox: [0, 0, 0, 0] },
    carrier: 'viettel', version: 1,
    nodes, edges: packEdges, segments, facilities: [], services: []
  }, extra || {});
}

const BASE = [23.0, 105.0];
function node(id, dx, dy) { const p = at(BASE, dx, dy); return { id, name: id, kind: 'junction', lat: p[0], lng: p[1] }; }

/*
 * Loop A → D with two alternatives:
 *   North via B: A(0,0) → B(5,0.5) → D(10,0)  ≈ 10 km, mostly LOST
 *   South via C: A(0,0) → C(5,-4)  → D(10,0)  ≈ 12.8 km, all LIKELY
 * Edge B–D is stored reversed (D → B) to exercise reversed traversal.
 */
function loopPack() {
  const nodes = [node('A', 0, 0), node('B', 5, 0.5), node('C', 5, -4), node('D', 10, 0)];
  const edges = [
    { id: 'AB', from: 'A', to: 'B', segs: [[0, 1, 'likely'], [1, 'end', 'lost']] },
    { id: 'DB', from: 'D', to: 'B', segs: [[0, 1.5, 'likely'], [1.5, 'end', 'lost']] },
    { id: 'AC', from: 'A', to: 'C', via: [at(BASE, 2.5, -2.5)], segs: [[0, 'end', 'likely']] },
    { id: 'CD', from: 'C', to: 'D', via: [at(BASE, 7.5, -2.5)], segs: [[0, 'end', 'likely']] }
  ];
  return makePack(nodes, edges);
}

/* ---------- geometry helpers ---------- */

test('haversine / lineLengthKm / pointAt / sliceLine / nearestOnLine', () => {
  const a = at(BASE, 0, 0), b = at(BASE, 3, 0), c = at(BASE, 3, 4);
  near(R.haversineKm(a, b), 3, 0.01, 'haversine');
  near(R.haversineKm({ lat: a[0], lng: a[1] }, { lat: c[0], lng: c[1] }), 5, 0.02, 'haversine obj');
  const line = [a, b, c];
  near(R.lineLengthKm(line), 7, 0.02, 'length');
  const p = R.pointAt(line, 5);
  near(R.haversineKm(p, at(BASE, 3, 2)), 0, 0.01, 'pointAt');
  assert.deepEqual(R.pointAt(line, -1), a, 'pointAt clamps start');
  const s = R.sliceLine(line, 1, 5);
  near(R.lineLengthKm(s), 4, 0.02, 'slice length');
  assert.equal(s.length, 3, 'slice keeps inner vertex');
  const rs = R.sliceLine(line, 5, 1);
  near(R.haversineKm(rs[0], s[s.length - 1]), 0, 1e-6, 'reverse slice starts at 5km');
  const q = at(BASE, 1.5, 0.4);
  const n = R.nearestOnLine(line, { lat: q[0], lng: q[1] });
  near(n.along_km, 1.5, 0.02, 'nearest along');
  near(n.distance_km, 0.4, 0.02, 'nearest distance');
});

test('levelFromRsrp thresholds (likely ≥ −105, uncertain −115…−105, lost < −115)', () => {
  assert.equal(R.levelFromRsrp(-90), 'likely');
  assert.equal(R.levelFromRsrp(-105), 'likely');
  assert.equal(R.levelFromRsrp(-110), 'uncertain');
  assert.equal(R.levelFromRsrp(-115), 'uncertain');
  assert.equal(R.levelFromRsrp(-116), 'lost');
  assert.equal(R.levelFromRsrp(null), 'lost');
});

/* ---------- graph + A* ---------- */

test('buildGraph: nodes, bidirectional adjacency, sorted segments, merge of several packs', () => {
  const g = R.buildGraph([loopPack()]);
  assert.equal(Object.keys(g.nodes).length, 4);
  assert.equal(Object.keys(g.edges).length, 4);
  assert.equal(g.adj.A.length, 2);
  assert.ok(g.adj.B.some((x) => x.edgeId === 'DB' && x.reversed === true && x.to === 'D'));
  assert.ok(g.adj.D.some((x) => x.edgeId === 'DB' && x.reversed === false && x.to === 'B'));
  assert.equal(g.segmentsByEdge.AB.length, 2);
  const other = makePack([node('X', 20, 0), node('Y', 22, 0)], [{ id: 'XY', from: 'X', to: 'Y' }],
    { route: { id: 'r2' }, facilities: [{ id: 'f1', lat: 1, lng: 1 }] });
  const g2 = R.buildGraph([loopPack(), other, other]);
  assert.equal(Object.keys(g2.edges).length, 5, 'duplicate pack edges ignored');
  assert.equal(g2.facilities.length, 1, 'facilities deduped');
  assert.equal(g2.edges.XY.route_id, 'r2');
});

test("A*: 'shortest' takes the short north road, 'signal' takes the longer covered south road", () => {
  const g = R.buildGraph([loopPack()]);
  const short = R.astar(g, 'A', 'D', { strategy: 'shortest' });
  const safe = R.astar(g, 'A', 'D', { strategy: 'signal' });
  assert.deepEqual(short.nodeIds, ['A', 'B', 'D']);
  assert.deepEqual(safe.nodeIds, ['A', 'C', 'D']);
  assert.ok(safe.length_km > short.length_km, 'signal path is longer');
  near(short.cost, short.length_km, 1e-9, 'shortest cost = length');
  assert.ok(safe.cost < R.astar(g, 'A', 'D', { strategy: 'shortest' }).length_km * 2, 'sanity');
  // signal cost of the covered path equals its length (all likely)
  near(safe.cost, safe.length_km, 1e-9, 'fully covered path has cost = length');
  // default strategy is shortest
  assert.deepEqual(R.astar(g, 'A', 'D').nodeIds, ['A', 'B', 'D']);
});

test('A*: reversed edge traversal is flagged and analysed in travel order', () => {
  const g = R.buildGraph([loopPack()]);
  const p = R.astar(g, 'A', 'D', { strategy: 'shortest' });
  assert.deepEqual(p.steps.map((s) => [s.edgeId, s.reversed]), [['AB', false], ['DB', true]]);
  const an = R.analyze(g, p);
  // geometry runs A → D
  near(R.haversineKm(an.geometry[0], [g.nodes.A.lat, g.nodes.A.lng]), 0, 1e-6, 'starts at A');
  near(R.haversineKm(an.geometry[an.geometry.length - 1], [g.nodes.D.lat, g.nodes.D.lng]), 0, 1e-6, 'ends at D');
  // levels in travel order: likely(1km) → lost (AB rest + DB lost part) → likely (last 1.5 km of DB, near D)
  assert.deepEqual(an.parts.map((x) => x.level), ['likely', 'lost', 'likely']);
  near(an.parts[2].to_km - an.parts[2].from_km, 1.5, 1e-6, 'reversed edge likely part is at the end');
  near(an.parts[0].to_km, 1, 1e-6);
  assert.equal(an.first_lost_at_km, an.parts[1].from_km);
  near(an.first_lost_at_km, 1, 1e-6);
  // last part geometry ends at D
  const lastGeom = an.parts[2].geometry;
  near(R.haversineKm(lastGeom[lastGeom.length - 1], [g.nodes.D.lat, g.nodes.D.lng]), 0, 1e-6);
});

test('A*: trivial, unknown and disconnected cases', () => {
  const pack = loopPack();
  pack.nodes.push(node('Z', 50, 50));
  const g = R.buildGraph([pack]);
  assert.deepEqual(R.astar(g, 'A', 'A'), { nodeIds: ['A'], steps: [], length_km: 0, cost: 0 });
  assert.equal(R.astar(g, 'A', 'nope'), null);
  assert.equal(R.astar(g, 'A', 'Z'), null);
});

test('A* matches Dijkstra on a random grid for both strategies (optimality with haversine heuristic)', () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const N = 7;
  const nodes = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) nodes.push(node(`n${i}_${j}`, i * 2 + rnd() * 0.6, j * 2 + rnd() * 0.6));
  const edges = [];
  const levels = ['likely', 'uncertain', 'lost'];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const nb = [];
      if (i + 1 < N) nb.push(`n${i + 1}_${j}`);
      if (j + 1 < N) nb.push(`n${i}_${j + 1}`);
      nb.forEach((to) => {
        if (rnd() < 0.15) return; // drop a few edges
        const flip = rnd() < 0.5;
        const from = `n${i}_${j}`;
        const s1 = 0.3 + rnd() * 0.8;
        edges.push({ id: `${from}-${to}`, from: flip ? to : from, to: flip ? from : to,
          segs: [[0, s1, levels[Math.floor(rnd() * 3)]], [s1, 'end', levels[Math.floor(rnd() * 3)]]] });
      });
    }
  }
  const g = R.buildGraph([makePack(nodes, edges)]);
  function dijkstra(src, strategy) {
    const dist = { [src]: 0 }, done = {};
    for (;;) {
      let u = null;
      Object.keys(dist).forEach((k) => { if (!done[k] && (u === null || dist[k] < dist[u])) u = k; });
      if (u === null) break;
      done[u] = true;
      (g.adj[u] || []).forEach((nb) => {
        const e = g.edges[nb.edgeId];
        let c = e.length_km;
        if (strategy === 'signal') {
          const segs = g.segmentsByEdge[e.id];
          let lost = 0, unc = 0;
          segs.forEach((s) => { const l = s.to_km - s.from_km; if (s.level === 'lost') lost += l; if (s.level === 'uncertain') unc += l; });
          c = e.length_km * (1 + 1.5 * lost / e.length_km + 0.5 * unc / e.length_km);
        }
        if (dist[nb.to] === undefined || dist[u] + c < dist[nb.to]) dist[nb.to] = dist[u] + c;
      });
    }
    return dist;
  }
  ['shortest', 'signal'].forEach((strategy) => {
    const d = dijkstra('n0_0', strategy);
    ['n6_6', 'n3_5', 'n6_0', 'n0_6', 'n4_2'].forEach((t) => {
      const p = R.astar(g, 'n0_0', t, { strategy });
      if (d[t] === undefined) { assert.equal(p, null); return; }
      near(p.cost, d[t], 1e-6, `${strategy} cost to ${t}`);
      // path is contiguous
      let cur = 'n0_0';
      p.steps.forEach((s) => { const e = g.edges[s.edgeId]; cur = s.reversed ? (assert.equal(e.to, cur), e.from) : (assert.equal(e.from, cur), e.to); });
      assert.equal(cur, t);
    });
  });
});

/* ---------- snapping + routeBetween ---------- */

test('snap: nearest edge, along_km, perpendicular distance, nearer endpoint', () => {
  const g = R.buildGraph([loopPack()]);
  // 0.3 km south of the AC midpoint region? use a point just north of AB at 1/4 of its length
  const ab = g.edges.AB;
  const pAt = R.pointAt(ab.geometry, ab.length_km * 0.25);
  const q = at(pAt, 0, 0.2);
  const s = R.snap(g, { lat: q[0], lng: q[1] });
  assert.equal(s.edgeId, 'AB');
  near(s.along_km, ab.length_km * 0.25, 0.05, 'along');
  near(s.distance_km, 0.2, 0.03, 'distance');
  assert.equal(s.nodeId, 'A', 'nearer endpoint');
  // a point near D on the reversed-stored edge DB
  const db = g.edges.DB;
  const p2 = R.pointAt(db.geometry, 0.3);
  const s2 = R.snap(g, { lat: p2[0] + 0.001, lng: p2[1] });
  assert.equal(s2.edgeId, 'DB');
  assert.equal(s2.nodeId, 'D');
  assert.equal(R.snap(g, null), null);
});

test('routeBetween: arbitrary GPS points use partial first/last edges; totals consistent', () => {
  const g = R.buildGraph([loopPack()]);
  const ac = g.edges.AC, cd = g.edges.CD;
  const p1 = R.pointAt(ac.geometry, 2);
  const p2 = R.pointAt(cd.geometry, cd.length_km - 1);
  const path = R.routeBetween(g, { lat: p1[0], lng: p1[1] }, { lat: p2[0], lng: p2[1] }, { strategy: 'signal' });
  assert.ok(path, 'path found');
  assert.equal(path.steps[0].edgeId, 'AC');
  assert.equal(path.steps[path.steps.length - 1].edgeId, 'CD');
  near(path.length_km, (ac.length_km - 2) + (cd.length_km - 1), 0.02, 'partial lengths');
  const an = R.analyze(g, path);
  near(an.likely_km + an.uncertain_km + an.lost_km, an.length_km, 1e-9, 'totals');
  near(R.lineLengthKm(an.geometry), an.length_km, 0.02, 'geometry length');
  // same-edge case
  const p3 = R.pointAt(ac.geometry, 3);
  const same = R.routeBetween(g, { lat: p1[0], lng: p1[1] }, { lat: p3[0], lng: p3[1] });
  assert.equal(same.steps.length, 1);
  near(same.length_km, 1, 0.02, 'same-edge partial');
  // node id destination
  const toNode = R.routeBetween(g, { lat: p1[0], lng: p1[1] }, 'D', { strategy: 'signal' });
  assert.equal(toNode.nodeIds[toNode.nodeIds.length - 1], 'D');
});

/* ---------- analysis ---------- */

test('analyze: parts contiguous, sums equal length, gaps filled as uncertain, ETA per mode', () => {
  const nodes = [node('P', 0, 0), node('Q', 6, 0), node('S', 12, 0)];
  const pack = makePack(nodes, [
    { id: 'PQ', from: 'P', to: 'Q', segs: [[0, 2, 'likely'], [3, 5, 'lost']] }, // gaps 2–3 and 5–6 → uncertain
    { id: 'QS', from: 'Q', to: 'S' } // no coverage at all → uncertain
  ]);
  const g = R.buildGraph([pack]);
  const p = R.astar(g, 'P', 'S');
  const an = R.analyze(g, p);
  near(an.length_km, p.length_km, 1e-9);
  near(an.likely_km + an.uncertain_km + an.lost_km, an.length_km, 1e-9, 'sum = length');
  near(an.likely_km, 2, 1e-6);
  near(an.lost_km, 2, 1e-6);
  assert.deepEqual(an.parts.map((x) => x.level), ['likely', 'uncertain', 'lost', 'uncertain']);
  for (let i = 1; i < an.parts.length; i++) near(an.parts[i].from_km, an.parts[i - 1].to_km, 1e-9, 'contiguous');
  an.parts.forEach((pt) => near(R.lineLengthKm(pt.geometry), pt.to_km - pt.from_km, 0.02, 'part geometry length'));
  near(an.eta_min.motorbike, an.length_km / 25 * 60, 0.06);
  near(an.eta_min.hiking, an.length_km / 3.5 * 60, 0.06);
  assert.deepEqual(an.zones.length, 1);
  near(an.zones[0].start_km, 3, 1e-6);
  assert.equal(R.analyze(g, null).length_km, 0);
});

test('analyze on the real-ish loop: sums equal length for both strategies', () => {
  const g = R.buildGraph([loopPack()]);
  ['shortest', 'signal'].forEach((strategy) => {
    const an = R.analyze(g, R.astar(g, 'A', 'D', { strategy }));
    near(an.likely_km + an.uncertain_km + an.lost_km, an.length_km, 1e-9, strategy);
    near(R.lineLengthKm(an.geometry), an.length_km, 0.02, strategy + ' geometry');
  });
});

/* ---------- dead-zone look-ahead ---------- */

function zoneAnalysis() {
  // likely 0–10, lost 10–12, likely 12–20, lost 20–21
  return {
    length_km: 21,
    parts: [
      { from_km: 0, to_km: 10, level: 'likely' },
      { from_km: 10, to_km: 12, level: 'lost' },
      { from_km: 12, to_km: 20, level: 'likely' },
      { from_km: 20, to_km: 21, level: 'lost' }
    ]
  };
}

test('thresholds: 5 min @ 25 km/h ≈ 2.08 km ; 15 min @ 3.5 km/h ≈ 0.875 km', () => {
  near(R.SPEEDS.motorbike * R.THRESHOLDS.motorbike.minutes / 60, 2.083, 0.001);
  near(R.SPEEDS.hiking * R.THRESHOLDS.hiking.minutes / 60, 0.875, 0.001);
  assert.equal(R.THRESHOLDS.motorbike.km, 2);
  assert.equal(R.THRESHOLDS.hiking.km, 0.8);
});

test('deadzoneAhead motorbike, time basis', () => {
  const an = zoneAnalysis();
  let r = R.deadzoneAhead(an, 8.0, { speed_kmh: 25, mode: 'motorbike' }); // 2.0 km → 4.8 min
  assert.equal(r.basis, 'time');
  assert.equal(r.should_warn, true);
  near(r.minutes, 4.8, 1e-9);
  near(r.distance_km, 2, 1e-9);
  assert.deepEqual(r.next, { start_km: 10, end_km: 12, length_km: 2 });
  r = R.deadzoneAhead(an, 10 - 25 * 5 / 60, { speed_kmh: 25, mode: 'motorbike' }); // exactly 5 min
  assert.equal(r.should_warn, true, 'boundary inclusive');
  r = R.deadzoneAhead(an, 7.8, { speed_kmh: 25, mode: 'motorbike' }); // 2.2 km → 5.28 min
  assert.equal(r.should_warn, false);
  near(r.minutes, 5.28, 1e-9);
  r = R.deadzoneAhead(an, 7.8, { speed_kmh: 40 }); // mode inferred motorbike, 3.3 min
  assert.equal(r.mode, 'motorbike');
  assert.equal(r.should_warn, true);
});

test('deadzoneAhead hiking, time basis (0.875 km ≈ 15 min at 3.5 km/h)', () => {
  const an = zoneAnalysis();
  let r = R.deadzoneAhead(an, 10 - 0.85, { speed_kmh: 3.5, mode: 'hiking' }); // 14.57 min
  assert.equal(r.should_warn, true);
  near(r.minutes, 0.85 / 3.5 * 60, 1e-9);
  r = R.deadzoneAhead(an, 10 - 0.9, { speed_kmh: 3.5, mode: 'hiking' }); // 15.43 min
  assert.equal(r.should_warn, false);
  // same 0.85 km for a motorbike at 25 km/h is 2 min → warn; the 290 m-in-5-min trap for hikers is avoided
  r = R.deadzoneAhead(an, 10 - 0.29, { speed_kmh: 3.5 });
  assert.equal(r.mode, 'hiking');
  assert.equal(r.should_warn, true);
});

test('deadzoneAhead distance basis when speed missing/unstable', () => {
  const an = zoneAnalysis();
  let r = R.deadzoneAhead(an, 8.1, { mode: 'motorbike' }); // 1.9 km ≤ 2
  assert.equal(r.basis, 'distance');
  assert.equal(r.should_warn, true);
  near(r.minutes, 1.9 / 25 * 60, 1e-9, 'minutes estimated with default speed');
  r = R.deadzoneAhead(an, 7.9, { mode: 'motorbike' }); // 2.1 km
  assert.equal(r.should_warn, false);
  r = R.deadzoneAhead(an, 9.21, { mode: 'hiking', speed_kmh: 3.5, unstable: true }); // 0.79 km ≤ 0.8
  assert.equal(r.basis, 'distance');
  assert.equal(r.should_warn, true);
  r = R.deadzoneAhead(an, 9.15, { mode: 'hiking', speed_kmh: 0 }); // 0.85 km > 0.8, speed 0 invalid
  assert.equal(r.basis, 'distance');
  assert.equal(r.should_warn, false);
});

test('deadzoneAhead inside a zone, between zones and after the last zone', () => {
  const an = zoneAnalysis();
  let r = R.deadzoneAhead(an, 11, { speed_kmh: 25 });
  assert.equal(r.in_deadzone, true);
  assert.equal(r.should_warn, false);
  assert.equal(r.distance_km, 0);
  assert.equal(r.next.end_km, 12);
  r = R.deadzoneAhead(an, 12, { speed_kmh: 25 });
  assert.equal(r.in_deadzone, false, 'zone end is exclusive');
  assert.equal(r.next.start_km, 20);
  r = R.deadzoneAhead(an, 21.5, { speed_kmh: 25 });
  assert.equal(r.next, null);
  assert.equal(r.should_warn, false);
  // works on a real analyze() output
  const g = R.buildGraph([loopPack()]);
  const real = R.analyze(g, R.astar(g, 'A', 'D'));
  const w = R.deadzoneAhead(real, 0, { speed_kmh: 25, mode: 'motorbike' }); // lost starts at 1 km
  assert.equal(w.should_warn, true);
  near(w.distance_km, 1, 1e-6);
});

/* ---------- mode detection / speeds ---------- */

test('detectMode / movingAverage / isSpeedUnstable', () => {
  assert.equal(R.detectMode([25, 30, 0, 22, 18]), 'motorbike');
  assert.equal(R.detectMode([3, 4.2, 0, 3.5, 2.8]), 'hiking');
  assert.equal(R.detectMode([]), 'motorbike');
  assert.equal(R.detectMode([0, 0.5], 'hiking'), 'hiking', 'fallback when stopped');
  assert.equal(R.detectMode([{ speed_kmh: 4 }, { speed_kmh: 5 }]), 'hiking');
  near(R.movingAverage([10, 20, 30]), 20, 1e-9);
  const t0 = Date.parse('2026-09-28T08:00:00Z');
  // GPS fixes 1 km apart every 2.4 min → 25 km/h
  const fixes = [0, 1, 2, 3, 4].map((i) => { const p = at(BASE, i, 0); return { t: t0 + i * 144000, lat: p[0], lng: p[1] }; });
  near(R.movingAverage(fixes, 10), 25, 0.2);
  // window keeps only recent samples
  const sp = [{ t: t0, speed_kmh: 100 }, { t: t0 + 600000, speed_kmh: 20 }, { t: t0 + 660000, speed_kmh: 30 }];
  near(R.movingAverage(sp, 3), 25, 1e-9);
  assert.equal(R.movingAverage([], 3), null);
  assert.equal(R.isSpeedUnstable([24, 25, 26, 25]), false);
  assert.equal(R.isSpeedUnstable([24, 5, 26, 25]), true);
  assert.equal(R.isSpeedUnstable([25]), true);
});

/* ---------- stops along ---------- */

test('stopsAlong: buffer filter, along_km ordering, graph mode', () => {
  const g = R.buildGraph([loopPack()]);
  const an = R.analyze(g, R.astar(g, 'A', 'D', { strategy: 'signal' })); // south road via C
  const c = g.nodes.C;
  const pois = [
    { id: 'far', lat: at(BASE, 5, 8)[0], lng: at(BASE, 5, 8)[1] },
    { id: 'nearC', lat: at([c.lat, c.lng], 0, -0.5)[0], lng: at([c.lat, c.lng], 0, -0.5)[1] },
    { id: 'nearA', lat: at(BASE, 0.2, -0.3)[0], lng: at(BASE, 0.2, -0.3)[1] }
  ];
  const res = R.stopsAlong(an, pois, { buffer_km: 3 });
  assert.deepEqual(res.map((r) => r.poi.id), ['nearA', 'nearC']);
  assert.ok(res[0].along_km < res[1].along_km);
  near(res[1].off_km, 0.5, 0.05);
  assert.equal(R.stopsAlong(an, pois, { buffer_km: 0.01 }).length, 0);
  const gm = R.stopsAlong(g, pois);
  assert.ok(gm.every((r) => typeof r.edgeId === 'string'));
  assert.ok(gm.length >= 2);
});

/* ---------- round 2 (C2): progress on a polyline + signal overlay of an online route ---------- */

test('progressOnLine: km along the polyline + perpendicular offset; [lat,lng] or {lat,lng}; invalid → null', () => {
  const line = [at(BASE, 0, 0), at(BASE, 4, 0), at(BASE, 4, 6)];
  const p = at(BASE, 3, 0.5);
  const r = R.progressOnLine(line, p);
  near(r.km_along, 3, 0.02, 'km_along');
  near(r.offset_km, 0.5, 0.02, 'offset_km');
  const q = at(BASE, 4.2, 3);
  const r2 = R.progressOnLine(line, { lat: q[0], lng: q[1] });
  near(r2.km_along, 7, 0.03, 'second leg');
  near(r2.offset_km, 0.2, 0.02);
  const before = R.progressOnLine(line, at(BASE, -2, 0));
  near(before.km_along, 0, 1e-9, 'clamped to the start');
  near(before.offset_km, 2, 0.02);
  assert.equal(R.progressOnLine([], p), null);
  assert.equal(R.progressOnLine(line, null), null);
  assert.equal(R.progressOnLine(line, { lat: NaN, lng: 1 }), null);
  assert.equal(R.progressOnLine([[NaN, 1], [2, 3]], p), null);
});

/* One 10 km pilot edge A → B heading east: likely 0–4 km, lost 4–7 km, no data 7–end (gap → uncertain). */
function overlayPack() {
  const nodes = [node('A', 0, 0), node('B', 10, 0)];
  return makePack(nodes, [{ id: 'AB', from: 'A', to: 'B', via: [at(BASE, 5, 0)], segs: [[0, 4, 'likely'], [4, 7, 'lost']] }]);
}

test('overlaySignal: stretches along a pilot edge take its levels, the rest is unknown; sums = length', () => {
  const g = R.buildGraph([overlayPack()]);
  // online route: 5 km approach from the west, the pilot edge (30 m north of it), 3 km beyond B
  const geom = [at(BASE, -5, 0.4), at(BASE, -1, 0.1), at(BASE, 0, 0.03), at(BASE, 5, 0.03), at(BASE, 10, 0.03), at(BASE, 13, 0.2)];
  const an = R.overlaySignal(g, geom);
  near(an.length_km, R.lineLengthKm(geom), 1e-9, 'length = polyline');
  const sum = an.likely_km + an.uncertain_km + an.lost_km + an.unknown_km;
  near(sum, an.length_km, 1e-6, 'levels sum to length');
  near(an.lost_km, 3, 0.15, 'lost from the pilot segments');
  near(an.likely_km, 4, 0.2, 'likely');
  near(an.uncertain_km, 3, 0.2, 'gap on the pilot edge → uncertain');
  near(an.unknown_km, an.length_km - 10, 0.25, 'off-corridor → unknown');
  assert.deepEqual(an.parts.map((p) => p.level), ['unknown', 'likely', 'lost', 'uncertain', 'unknown']);
  for (let i = 1; i < an.parts.length; i++) near(an.parts[i].from_km, an.parts[i - 1].to_km, 1e-9, 'contiguous');
  an.parts.forEach((p) => assert.ok(p.geometry.length >= 2, 'part geometry'));
  assert.equal(an.zones.length, 1);
  const off = R.lineLengthKm(geom.slice(0, 3));
  near(an.zones[0].start_km, off + 4, 0.2, 'zone start along the online route');
  near(an.first_lost_at_km, an.zones[0].start_km, 1e-9);
  near(an.routes_km.test, 10, 0.25, 'km on the pilot route');
  near(an.lost_by_route.test, 3, 0.15);
  assert.deepEqual(an.nodeIds, []);
  assert.equal(an.overlay, true);
  // deadzoneAhead works on the overlay unchanged
  const dz = R.deadzoneAhead(an, an.zones[0].start_km - 1, { mode: 'motorbike' });
  assert.equal(dz.should_warn, true);
});

test('overlaySignal: a road crossing the pilot edge or a parallel road 300 m away is not "along" it', () => {
  const g = R.buildGraph([overlayPack()]);
  const cross = R.overlaySignal(g, [at(BASE, 5.5, -6), at(BASE, 5.5, 6)]);
  assert.equal(cross.unknown_km, cross.length_km, 'perpendicular crossing → all unknown');
  assert.deepEqual(cross.parts.map((p) => p.level), ['unknown']);
  assert.equal(cross.zones.length, 0);
  const parallel = R.overlaySignal(g, [at(BASE, 0, 0.3), at(BASE, 10, 0.3)]);
  near(parallel.unknown_km, parallel.length_km, 1e-9, '300 m off → unknown');
  const oblique = R.overlaySignal(g, [at(BASE, 5.2, -3), at(BASE, 5.5, 0), at(BASE, 5.8, 3)], { max_angle_deg: 90 });
  assert.equal(oblique.lost_km, 0, 'a matched run no longer than a crossing (≤ 2 × 150 m + 50 m) between unknown stretches → unknown');
});

test('overlaySignal: no graph / far from every corridor / degenerate input', () => {
  const g = R.buildGraph([overlayPack()]);
  const far = R.overlaySignal(g, [[10.77, 106.7], [10.8, 106.72], [10.9, 106.8]]);
  near(far.unknown_km, far.length_km, 1e-9);
  assert.equal(far.parts.length, 1);
  const none = R.overlaySignal(null, [at(BASE, 0, 0), at(BASE, 2, 0)]);
  assert.equal(none.parts[0].level, 'unknown');
  const one = R.overlaySignal(g, [at(BASE, 0, 0)]);
  assert.equal(one.length_km, 0);
  assert.deepEqual(one.parts, []);
  const dup = R.overlaySignal(g, [at(BASE, 0, 0.03), at(BASE, 0, 0.03), { lat: at(BASE, 10, 0.03)[0], lng: at(BASE, 10, 0.03)[1] }]);
  near(dup.length_km, 10, 0.05, 'duplicate points dropped, objects accepted');
  near(dup.lost_km, 3, 0.15);
});
