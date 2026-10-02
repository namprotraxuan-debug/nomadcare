/*
 * routing.js — NC.routing: pure routing + signal analysis for MOD.02 (map) and MOD.04 (buddy). Owner: P1 data.
 * Public API: SPEEDS, THRESHOLDS, buildGraph, astar, routeBetween, snap, analyze, deadzoneAhead, detectMode,
 * movingAverage, isSpeedUnstable, stopsAlong, pointAt, sliceLine, lineLengthKm, nearestOnLine, haversineKm, levelFromRsrp,
 * progressOnLine (C2: km along a route polyline), overlaySignal (pilot-edge signal levels on an online route, 'unknown'
 * elsewhere).
 * No DOM / no globals besides NC: runs in browsers (classic script) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  var NC = root.NC = root.NC || {};

  /* ------------------------------------------------------------------ constants */

  /** Default moving speeds (km/h) per travel mode — PDF 6.3 "Cơ chế cảnh báo trước". */
  var SPEEDS = { motorbike: 25, hiking: 3.5 };

  /**
   * Proactive dead-zone warning thresholds per mode. `minutes` is used with a stable GPS speed (basis 'time');
   * `km` is the fallback when speed is missing/unstable (basis 'distance').
   * 5 min @ 25 km/h ≈ 2.08 km ; 15 min @ 3.5 km/h ≈ 0.875 km.
   */
  var THRESHOLDS = { motorbike: { minutes: 5, km: 2 }, hiking: { minutes: 15, km: 0.8 } };

  /** Speed above which a traveller is considered motorised (km/h, median of moving samples). */
  var MODE_SPLIT_KMH = 8;
  /** Cost weights of the 'signal' strategy: cost = len * (1 + 1.5*lostFrac + 0.5*uncertainFrac). */
  var W_LOST = 1.5;
  var W_UNCERTAIN = 0.5;
  var EARTH_KM = 6371.0088;
  var DEG = Math.PI / 180;
  var EPS = 1e-9;

  /* ------------------------------------------------------------------ geometry */

  /** Normalise a point given as [lat,lng] or {lat,lng} (or {lat,lon}) to [lat,lng]. */
  function ll(p) {
    if (!p) return null;
    if (Array.isArray(p)) return [+p[0], +p[1]];
    return [+p.lat, +(p.lng !== undefined ? p.lng : p.lon)];
  }

  /**
   * Great-circle distance in km between two points ([lat,lng] or {lat,lng}).
   * @returns {number}
   */
  function haversineKm(a, b) {
    var p = ll(a), q = ll(b);
    var dLat = (q[0] - p[0]) * DEG;
    var dLng = (q[1] - p[1]) * DEG;
    var s = Math.sin(dLat / 2);
    var t = Math.sin(dLng / 2);
    var h = s * s + Math.cos(p[0] * DEG) * Math.cos(q[0] * DEG) * t * t;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Cumulative distance (km) at every vertex of a polyline. */
  function cumulative(geom) {
    var cum = new Array(geom.length);
    var acc = 0;
    for (var i = 0; i < geom.length; i++) {
      if (i > 0) acc += haversineKm(geom[i - 1], geom[i]);
      cum[i] = acc;
    }
    return cum;
  }

  /**
   * Length of a polyline [[lat,lng],...] in km.
   * @param {Array<Array<number>>} geom
   */
  function lineLengthKm(geom) {
    if (!geom || geom.length < 2) return 0;
    var cum = cumulative(geom);
    return cum[cum.length - 1];
  }

  /* Index i such that cum[i] <= km <= cum[i+1] (binary search). */
  function segIndex(cum, km) {
    var lo = 0, hi = cum.length - 1;
    if (km <= cum[0]) return 0;
    if (km >= cum[hi]) return Math.max(0, hi - 1);
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= km) lo = mid; else hi = mid;
    }
    return lo;
  }

  function lerpPt(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function pointAtCum(geom, cum, km) {
    if (!geom.length) return null;
    if (geom.length === 1) return [geom[0][0], geom[0][1]];
    var total = cum[cum.length - 1];
    var k = Math.max(0, Math.min(total, km));
    var i = segIndex(cum, k);
    var span = cum[i + 1] - cum[i];
    var t = span > EPS ? (k - cum[i]) / span : 0;
    return lerpPt(geom[i], geom[i + 1], t);
  }

  /**
   * Point located `km` along a polyline (clamped to its ends).
   * @returns {Array<number>|null} [lat,lng]
   */
  function pointAt(geom, km) {
    if (!geom || !geom.length) return null;
    return pointAtCum(geom, cumulative(geom), km);
  }

  function samePt(a, b) {
    return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  }

  function sliceCum(geom, cum, fromKm, toKm) {
    if (!geom.length) return [];
    if (fromKm > toKm) return sliceCum(geom, cum, toKm, fromKm).reverse();
    var out = [pointAtCum(geom, cum, fromKm)];
    for (var i = 0; i < geom.length; i++) {
      if (cum[i] > fromKm + EPS && cum[i] < toKm - EPS) out.push([geom[i][0], geom[i][1]]);
    }
    var end = pointAtCum(geom, cum, toKm);
    if (!samePt(out[out.length - 1], end) || out.length === 1) out.push(end);
    return out;
  }

  /**
   * Sub-polyline between two distances along `geom`. If fromKm > toKm the result is reversed
   * (i.e. ordered from `fromKm` to `toKm`).
   * @returns {Array<Array<number>>}
   */
  function sliceLine(geom, fromKm, toKm) {
    if (!geom || !geom.length) return [];
    return sliceCum(geom, cumulative(geom), fromKm, toKm);
  }

  /* Project p onto polyline using a local equirectangular plane; returns {along_km, distance_km, point, index}. */
  function nearestCum(geom, cum, p) {
    var q = ll(p);
    if (!geom.length) return null;
    if (geom.length === 1) return { along_km: 0, distance_km: haversineKm(q, geom[0]), point: [geom[0][0], geom[0][1]], index: 0 };
    var kx = Math.cos(q[0] * DEG) * DEG * EARTH_KM;
    var ky = DEG * EARTH_KM;
    var best = null;
    for (var i = 0; i < geom.length - 1; i++) {
      var a = geom[i], b = geom[i + 1];
      var ax = (a[1] - q[1]) * kx, ay = (a[0] - q[0]) * ky;
      var bx = (b[1] - q[1]) * kx, by = (b[0] - q[0]) * ky;
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 > EPS * EPS ? -(ax * dx + ay * dy) / len2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var px = ax + dx * t, py = ay + dy * t;
      var d2 = px * px + py * py;
      if (!best || d2 < best.d2) best = { d2: d2, i: i, t: t };
    }
    var pt = lerpPt(geom[best.i], geom[best.i + 1], best.t);
    return {
      along_km: cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.t,
      distance_km: haversineKm(q, pt),
      point: pt,
      index: best.i
    };
  }

  /**
   * Nearest point of a polyline to {lat,lng}.
   * @returns {{along_km:number, distance_km:number, point:Array<number>}|null}
   */
  function nearestOnLine(geom, p) {
    if (!geom || !geom.length || !p) return null;
    var r = nearestCum(geom, cumulative(geom), p);
    return { along_km: r.along_km, distance_km: r.distance_km, point: r.point };
  }

  /**
   * Progress of a position along a route polyline (contract C2; NC.trip projects each fix with it).
   * km_along is measured on the polyline itself (geometric km), offset_km is the perpendicular distance.
   * @param {Array<Array<number>>} geometry [[lat,lng],...]
   * @param {Array<number>|{lat:number,lng:number}} p
   * @returns {{km_along:number, offset_km:number, point:Array<number>}|null}
   */
  function progressOnLine(geometry, p) {
    var q = ll(p);
    if (!geometry || !geometry.length || !q || !isFinite(q[0]) || !isFinite(q[1])) return null;
    var geom = geometry.map(ll);
    for (var i = 0; i < geom.length; i++) if (!isFinite(geom[i][0]) || !isFinite(geom[i][1])) return null;
    var r = nearestCum(geom, cumulative(geom), q);
    return { km_along: r.along_km, offset_km: r.distance_km, point: r.point };
  }

  /**
   * 3-level signal classification from RSRP (dBm): likely ≥ −105; uncertain −115…−105; lost < −115 or no service.
   * @param {number|null} rsrp
   * @returns {'likely'|'uncertain'|'lost'}
   */
  function levelFromRsrp(rsrp) {
    if (rsrp === null || rsrp === undefined || rsrp === '' || !isFinite(+rsrp)) return 'lost';
    var v = +rsrp;
    if (v >= -105) return 'likely';
    if (v >= -115) return 'uncertain';
    return 'lost';
  }

  /* ------------------------------------------------------------------ graph */

  /**
   * Build a routing graph from one or more data packs (Pack format, contract §8).
   * Edges are traversable both ways; `adj[node]` lists {edgeId, to, reversed}.
   * @param {Array<Object>|Object} packs
   * @returns {Object} Graph {nodes, edges, adj, segmentsByEdge, facilities, services, routes, carrier}
   */
  function buildGraph(packs) {
    var list = Array.isArray(packs) ? packs : (packs ? [packs] : []);
    var g = {
      nodes: {}, edges: {}, adj: {}, segmentsByEdge: {}, facilities: [], services: [], routes: {}, carrier: null,
      _c: { cum: {}, glen: {}, lv: {}, bbox: {} }
    };
    var seenFac = {}, seenSvc = {};
    list.forEach(function (pack) {
      if (!pack) return;
      var routeId = pack.route && pack.route.id;
      if (routeId) g.routes[routeId] = pack.route;
      if (pack.carrier && !g.carrier) g.carrier = pack.carrier;
      (pack.nodes || []).forEach(function (n) {
        if (!g.nodes[n.id]) g.nodes[n.id] = Object.assign({ route_id: routeId }, n);
        if (!g.adj[n.id]) g.adj[n.id] = [];
      });
      (pack.edges || []).forEach(function (e) {
        if (g.edges[e.id]) return;
        var from = e.from !== undefined ? e.from : e.from_node;
        var to = e.to !== undefined ? e.to : e.to_node;
        var geom = (e.geometry && e.geometry.length >= 2) ? e.geometry : null;
        if (!geom && g.nodes[from] && g.nodes[to]) geom = [[g.nodes[from].lat, g.nodes[from].lng], [g.nodes[to].lat, g.nodes[to].lng]];
        var edge = Object.assign({ route_id: routeId }, e, { from: from, to: to, geometry: geom || [] });
        if (!(edge.length_km > 0)) edge.length_km = lineLengthKm(edge.geometry);
        g.edges[e.id] = edge;
        if (!g.adj[from]) g.adj[from] = [];
        if (!g.adj[to]) g.adj[to] = [];
        g.adj[from].push({ edgeId: e.id, to: to, reversed: false });
        g.adj[to].push({ edgeId: e.id, to: from, reversed: true });
      });
      (pack.segments || []).forEach(function (s) {
        (g.segmentsByEdge[s.edge_id] = g.segmentsByEdge[s.edge_id] || []).push(s);
      });
      (pack.facilities || []).forEach(function (f) {
        if (seenFac[f.id]) return;
        seenFac[f.id] = 1;
        g.facilities.push(Object.assign({ route_id: routeId }, f));
      });
      (pack.services || []).forEach(function (s) {
        if (seenSvc[s.id]) return;
        seenSvc[s.id] = 1;
        g.services.push(Object.assign({ route_id: routeId }, s));
      });
    });
    Object.keys(g.segmentsByEdge).forEach(function (id) {
      g.segmentsByEdge[id].sort(function (a, b) { return (a.from_km - b.from_km) || ((a.seq || 0) - (b.seq || 0)); });
    });
    return g;
  }

  function edgeCum(g, edgeId) {
    var c = g._c.cum[edgeId];
    if (!c) {
      c = cumulative(g.edges[edgeId].geometry);
      g._c.cum[edgeId] = c;
      g._c.glen[edgeId] = c.length ? c[c.length - 1] : 0;
    }
    return c;
  }

  /* Edge-km (measured with length_km) → geometry-km (measured on the polyline); tolerant to rounding differences. */
  function toGeomKm(g, edge, km) {
    edgeCum(g, edge.id);
    var gl = g._c.glen[edge.id];
    return edge.length_km > EPS ? km * gl / edge.length_km : 0;
  }

  function sliceEdge(g, edge, aKm, bKm) {
    var cum = edgeCum(g, edge.id);
    return sliceCum(edge.geometry, cum, toGeomKm(g, edge, aKm), toGeomKm(g, edge, bKm));
  }

  /**
   * Level pieces of an edge restricted to [a,b] (edge km, a<=b), ascending, contiguous, gaps filled with 'uncertain'
   * (unknown coverage is never presented as "có sóng").
   */
  function levelPieces(g, edge, a, b) {
    var segs = g.segmentsByEdge[edge.id] || [];
    var out = [];
    var cur = a;
    function push(x, y, level) {
      if (y - x <= EPS) return;
      var last = out[out.length - 1];
      if (last && last.level === level && Math.abs(last.b - x) < 1e-7) last.b = y;
      else out.push({ a: x, b: y, level: level });
    }
    for (var i = 0; i < segs.length && cur < b - EPS; i++) {
      var s = segs[i];
      var s0 = Math.max(+s.from_km, a), s1 = Math.min(+s.to_km, b);
      if (s1 <= cur + EPS) continue;
      if (s0 > cur + EPS) push(cur, Math.min(s0, b), 'uncertain');
      push(Math.max(s0, cur), s1, s.level === 'likely' || s.level === 'lost' ? s.level : 'uncertain');
      cur = Math.max(cur, s1);
    }
    if (cur < b - EPS) push(cur, b, 'uncertain');
    return out;
  }

  /* km per level over [a,b] of an edge. */
  function levelKm(g, edge, a, b) {
    var r = { likely: 0, uncertain: 0, lost: 0 };
    levelPieces(g, edge, a, b).forEach(function (p) { r[p.level] += p.b - p.a; });
    return r;
  }

  /* Traversal cost of edge range [a,b] for a strategy. Full-edge costs are memoised. */
  function rangeCost(g, edge, a, b, strategy) {
    var len = Math.max(0, b - a);
    if (strategy !== 'signal') return len;
    var full = a <= EPS && Math.abs(b - edge.length_km) <= EPS;
    var lv = full ? g._c.lv[edge.id] : null;
    if (!lv) {
      lv = levelKm(g, edge, a, b);
      if (full) g._c.lv[edge.id] = lv;
    }
    return len + W_LOST * lv.lost + W_UNCERTAIN * lv.uncertain;
  }

  /* ------------------------------------------------------------------ A* */

  /** Minimal binary min-heap keyed by `f`. */
  function Heap() { this.a = []; }
  Heap.prototype.size = function () { return this.a.length; };
  Heap.prototype.push = function (item) {
    var a = this.a;
    a.push(item);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      var t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a;
    var top = a[0];
    var last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < n && a[l].f < a[m].f) m = l;
        if (r < n && a[r].f < a[m].f) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  };

  /*
   * Core A* over the graph plus optional virtual nodes/edges (used for off-node start/goal points).
   * virt = {nodes:{id:{lat,lng}}, adj:{id:[{edgeId,to,reversed,from_km,to_km}]}}
   */
  function search(g, startId, goalId, strategy, virt) {
    virt = virt || { nodes: {}, adj: {} };
    function node(id) { return g.nodes[id] || virt.nodes[id]; }
    var goal = node(goalId);
    if (!node(startId) || !goal) return null;
    if (startId === goalId) return { nodeIds: [startId], steps: [], length_km: 0, cost: 0 };
    var goalLL = [goal.lat, goal.lng];
    function h(id) { var n = node(id); return haversineKm([n.lat, n.lng], goalLL); }

    var gScore = {}; gScore[startId] = 0;
    var came = {};
    var closed = {};
    var open = new Heap();
    open.push({ f: h(startId), id: startId });
    while (open.size()) {
      var cur = open.pop();
      if (closed[cur.id]) continue;
      if (cur.id === goalId) break;
      closed[cur.id] = true;
      var nbrs = (g.adj[cur.id] || []);
      if (virt.adj[cur.id]) nbrs = nbrs.concat(virt.adj[cur.id]);
      for (var i = 0; i < nbrs.length; i++) {
        var nb = nbrs[i];
        if (closed[nb.to]) continue;
        var edge = g.edges[nb.edgeId];
        if (!edge) continue;
        var a = nb.from_km !== undefined ? nb.from_km : 0;
        var b = nb.to_km !== undefined ? nb.to_km : edge.length_km;
        var tentative = gScore[cur.id] + rangeCost(g, edge, a, b, strategy);
        if (gScore[nb.to] === undefined || tentative < gScore[nb.to] - 1e-12) {
          gScore[nb.to] = tentative;
          came[nb.to] = { prev: cur.id, nb: nb, len: b - a };
          open.push({ f: tentative + h(nb.to), id: nb.to });
        }
      }
    }
    if (gScore[goalId] === undefined) return null;

    var steps = [], ids = [goalId], length = 0, at = goalId;
    while (at !== startId) {
      var c = came[at];
      var step = { edgeId: c.nb.edgeId, reversed: !!c.nb.reversed };
      if (c.nb.from_km !== undefined) { step.from_km = c.nb.from_km; step.to_km = c.nb.to_km; }
      steps.push(step);
      length += c.len;
      at = c.prev;
      ids.push(at);
    }
    steps.reverse();
    ids.reverse();
    return {
      nodeIds: ids.filter(function (id) { return !!g.nodes[id]; }),
      steps: steps,
      length_km: length,
      cost: gScore[goalId]
    };
  }

  /**
   * A* shortest path between two graph nodes.
   * strategy 'shortest': cost = length_km; 'signal': cost = length_km*(1 + 1.5*lostFrac + 0.5*uncertainFrac).
   * Heuristic = haversine(node, goal) (admissible for both strategies).
   * @returns {{nodeIds:string[], steps:Array<{edgeId:string,reversed:boolean}>, length_km:number, cost:number}|null}
   */
  function astar(graph, fromId, toId, opts) {
    var strategy = (opts && opts.strategy) || 'shortest';
    return search(graph, fromId, toId, strategy, null);
  }

  /**
   * Route between two places that may be node ids OR arbitrary {lat,lng} points (snapped onto the network;
   * the first/last steps are then partial edges with from_km/to_km). Extension used by MOD.02 for GPS → facility.
   * @returns {Object|null} Path (+ start/end snap results)
   */
  function routeBetween(graph, a, b, opts) {
    var strategy = (opts && opts.strategy) || 'shortest';
    var virt = { nodes: {}, adj: {} };
    var startId = a, goalId = b, sA = null, sB = null;
    if (typeof a !== 'string') {
      sA = snap(graph, a);
      if (!sA) return null;
      if (!sA.edgeId) { startId = sA.nodeId; sA = null; }
    }
    if (sA) {
      var eA = graph.edges[sA.edgeId];
      startId = '@start';
      virt.nodes[startId] = { lat: sA.point[0], lng: sA.point[1] };
      virt.adj[startId] = [
        { edgeId: eA.id, to: eA.from, reversed: true, from_km: 0, to_km: sA.along_km },
        { edgeId: eA.id, to: eA.to, reversed: false, from_km: sA.along_km, to_km: eA.length_km }
      ];
    }
    if (typeof b !== 'string') {
      sB = snap(graph, b);
      if (!sB) return null;
      if (!sB.edgeId) { goalId = sB.nodeId; sB = null; }
    }
    if (sB) {
      var eB = graph.edges[sB.edgeId];
      goalId = '@goal';
      virt.nodes[goalId] = { lat: sB.point[0], lng: sB.point[1] };
      (virt.adj[eB.from] = virt.adj[eB.from] || []).push({ edgeId: eB.id, to: goalId, reversed: false, from_km: 0, to_km: sB.along_km });
      (virt.adj[eB.to] = virt.adj[eB.to] || []).push({ edgeId: eB.id, to: goalId, reversed: true, from_km: sB.along_km, to_km: eB.length_km });
      if (sA && sA.edgeId === sB.edgeId) {
        var fwd = sB.along_km >= sA.along_km;
        virt.adj[startId].push({
          edgeId: eB.id, to: goalId, reversed: !fwd,
          from_km: Math.min(sA.along_km, sB.along_km), to_km: Math.max(sA.along_km, sB.along_km)
        });
      }
    }
    var path = search(graph, startId, goalId, strategy, virt);
    if (!path) return null;
    path.steps = path.steps.filter(function (s) { return s.from_km === undefined || s.to_km - s.from_km > EPS; });
    path.start = sA;
    path.end = sB;
    return path;
  }

  /* ------------------------------------------------------------------ snapping */

  function edgeBBox(g, edge) {
    var bb = g._c.bbox[edge.id];
    if (!bb) {
      bb = [90, 180, -90, -180];
      edge.geometry.forEach(function (p) {
        if (p[0] < bb[0]) bb[0] = p[0];
        if (p[1] < bb[1]) bb[1] = p[1];
        if (p[0] > bb[2]) bb[2] = p[0];
        if (p[1] > bb[3]) bb[3] = p[1];
      });
      g._c.bbox[edge.id] = bb;
    }
    return bb;
  }

  /* Lower bound (km) of the distance from q to a bbox. */
  function bboxDistKm(q, bb) {
    var lat = Math.max(bb[0], Math.min(bb[2], q[0]));
    var lng = Math.max(bb[1], Math.min(bb[3], q[1]));
    return haversineKm(q, [lat, lng]) * 0.995;
  }

  /**
   * Snap a position onto the nearest edge of the graph.
   * @returns {{nodeId:string, edgeId:string|null, along_km:number, distance_km:number, point:number[], from?:string, to?:string, length_km?:number}|null}
   *  nodeId = endpoint of that edge nearer along the edge; along_km measured from the edge's `from` node (edge km).
   */
  function snap(graph, p) {
    var q = ll(p);
    if (!q || !isFinite(q[0]) || !isFinite(q[1])) return null;
    var ids = Object.keys(graph.edges);
    if (!ids.length) {
      var bestN = null;
      Object.keys(graph.nodes).forEach(function (id) {
        var n = graph.nodes[id];
        var d = haversineKm(q, [n.lat, n.lng]);
        if (!bestN || d < bestN.distance_km) bestN = { nodeId: id, edgeId: null, along_km: 0, distance_km: d, point: [n.lat, n.lng] };
      });
      return bestN;
    }
    var cands = ids.map(function (id) { return { id: id, lb: bboxDistKm(q, edgeBBox(graph, graph.edges[id])) }; });
    cands.sort(function (x, y) { return x.lb - y.lb; });
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      if (best && cands[i].lb > best.r.distance_km) break;
      var e = graph.edges[cands[i].id];
      if (e.geometry.length < 1) continue;
      var r = nearestCum(e.geometry, edgeCum(graph, e.id), q);
      if (!best || r.distance_km < best.r.distance_km) best = { e: e, r: r };
    }
    if (!best) return null;
    var gl = graph._c.glen[best.e.id];
    var along = gl > EPS ? best.r.along_km * best.e.length_km / gl : 0;
    return {
      nodeId: along <= best.e.length_km / 2 ? best.e.from : best.e.to,
      edgeId: best.e.id,
      along_km: along,
      distance_km: best.r.distance_km,
      point: best.r.point,
      from: best.e.from,
      to: best.e.to,
      length_km: best.e.length_km
    };
  }

  /* ------------------------------------------------------------------ analysis */

  function round(v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; }

  /** Contiguous 'lost' stretches of an analysis → [{start_km,end_km,length_km}]. */
  function zonesOf(parts) {
    var zones = [];
    (parts || []).forEach(function (p) {
      if (p.level !== 'lost') return;
      var last = zones[zones.length - 1];
      if (last && Math.abs(last.end_km - p.from_km) < 1e-6) {
        last.end_km = p.to_km;
        last.length_km = last.end_km - last.start_km;
      } else {
        zones.push({ start_km: p.from_km, end_km: p.to_km, length_km: p.to_km - p.from_km });
      }
    });
    return zones;
  }

  function appendGeom(target, geom) {
    for (var i = 0; i < geom.length; i++) {
      if (target.length && i === 0 && samePt(target[target.length - 1], geom[0])) continue;
      target.push(geom[i]);
    }
  }

  /**
   * Split a path into coloured parts by signal level, with geometry for each part.
   * @returns {{length_km:number, geometry:Array, parts:Array<{from_km,to_km,level,geometry}>, likely_km:number,
   *   uncertain_km:number, lost_km:number, first_lost_at_km:number|null, eta_min:{motorbike:number,hiking:number},
   *   zones:Array, nodeIds:string[], steps:Array}}
   */
  function analyze(graph, path) {
    var res = {
      length_km: 0, geometry: [], parts: [], likely_km: 0, uncertain_km: 0, lost_km: 0,
      first_lost_at_km: null, eta_min: { motorbike: 0, hiking: 0 }, zones: [],
      nodeIds: path ? path.nodeIds : [], steps: path ? path.steps : []
    };
    if (!path) return res;
    var offset = 0;
    path.steps.forEach(function (step) {
      var e = graph.edges[step.edgeId];
      if (!e) return;
      var r0 = step.from_km !== undefined ? step.from_km : 0;
      var r1 = step.to_km !== undefined ? step.to_km : e.length_km;
      var pieces = levelPieces(graph, e, r0, r1);
      if (step.reversed) pieces.reverse();
      pieces.forEach(function (pc) {
        var from = step.reversed ? offset + (r1 - pc.b) : offset + (pc.a - r0);
        var to = step.reversed ? offset + (r1 - pc.a) : offset + (pc.b - r0);
        var geom = step.reversed ? sliceEdge(graph, e, pc.b, pc.a) : sliceEdge(graph, e, pc.a, pc.b);
        var last = res.parts[res.parts.length - 1];
        if (last && last.level === pc.level && Math.abs(last.to_km - from) < 1e-7) {
          last.to_km = to;
          appendGeom(last.geometry, geom);
        } else {
          res.parts.push({ from_km: from, to_km: to, level: pc.level, geometry: geom.slice() });
        }
        res[pc.level + '_km'] += to - from;
      });
      appendGeom(res.geometry, step.reversed ? sliceEdge(graph, e, r1, r0) : sliceEdge(graph, e, r0, r1));
      offset += r1 - r0;
    });
    res.length_km = offset;
    res.zones = zonesOf(res.parts);
    res.first_lost_at_km = res.zones.length ? res.zones[0].start_km : null;
    res.eta_min = {
      motorbike: round(offset / SPEEDS.motorbike * 60, 1),
      hiking: round(offset / SPEEDS.hiking * 60, 1)
    };
    return res;
  }

  /* ------------------------------------------------------------------ signal overlay (online routes) */

  /** Signal level of an edge at edge-km `km` (gaps between segments → 'uncertain', as levelPieces does). */
  function levelAtKm(g, edge, km) {
    var segs = g.segmentsByEdge[edge.id] || [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (km >= +s.from_km - EPS && km <= +s.to_km + EPS) return s.level === 'likely' || s.level === 'lost' ? s.level : 'uncertain';
    }
    return 'uncertain';
  }
  /* Initial bearing a → b in degrees (0…360). */
  function bearingDeg(a, b) {
    var p1 = a[0] * DEG, p2 = b[0] * DEG, dl = (b[1] - a[1]) * DEG;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }
  /* Angle between two undirected lines (0…90°): a road is "along" a pilot edge in either travel direction. */
  function lineAngle(b1, b2) {
    var d = Math.abs(b1 - b2) % 180;
    return d > 90 ? 180 - d : d;
  }

  /**
   * Signal overlay for a route that is NOT an A* path on the pack graph (e.g. an online OSRM route): every stretch
   * that runs ALONG a pilot edge (≤ max_off_km from it and roughly parallel) takes that edge's signal level; every
   * other stretch is 'unknown' ("chưa có dữ liệu sóng") — never presented as having signal.
   * The polyline is sampled every step_km. A sample whose nearest pilot point is an edge END (the route leaves the
   * corridor at a terminal node) does not match. A matched run shorter than min_run_km (default 2 × max_off_km + 50 m,
   * i.e. what a crossing leaves) between two unknown stretches is treated as a crossing and becomes 'unknown' too.
   * @param {Object|null} graph NC.routing.buildGraph() result (carrier-specific segments)
   * @param {Array<Array<number>>} geometry [[lat,lng],...] of the route
   * @param {{max_off_km?:number, step_km?:number, min_run_km?:number, max_angle_deg?:number}} [opts]
   * @returns {Object} analyze()-shaped: {length_km, geometry, parts[{from_km,to_km,level,geometry}], likely_km,
   *   uncertain_km, lost_km, unknown_km, zones, first_lost_at_km, eta_min, nodeIds:[], steps:[], overlay:true,
   *   routes_km:{route_id:km}, lost_by_route:{route_id:km}}
   */
  function overlaySignal(graph, geometry, opts) {
    opts = opts || {};
    var maxOff = opts.max_off_km > 0 ? opts.max_off_km : 0.15;
    var minRun = opts.min_run_km !== undefined ? +opts.min_run_km : 2 * maxOff + 0.05;
    var maxAngle = opts.max_angle_deg > 0 ? opts.max_angle_deg : 45;
    var geom = [];
    (geometry || []).forEach(function (p) {
      var q = ll(p);
      if (!q || !isFinite(q[0]) || !isFinite(q[1])) return;
      if (geom.length && samePt(geom[geom.length - 1], q)) return;
      geom.push(q);
    });
    var res = {
      length_km: 0, geometry: geom, parts: [], likely_km: 0, uncertain_km: 0, lost_km: 0, unknown_km: 0,
      first_lost_at_km: null, eta_min: { motorbike: 0, hiking: 0 }, zones: [], nodeIds: [], steps: [], overlay: true,
      routes_km: {}, lost_by_route: {}
    };
    if (geom.length < 2) return res;
    var cum = cumulative(geom);
    var total = cum[cum.length - 1];
    res.length_km = total;
    if (!(total > EPS)) return res;
    var step = opts.step_km > 0 ? opts.step_km : 0.05;
    var n = Math.max(1, Math.min(20000, Math.ceil(total / step)));
    var dk = total / n;
    var win = Math.max(dk, 0.075);
    // candidate edges with their bbox grown by the match distance (cheap rejection for samples far from every corridor)
    var edges = [], boxes = [];
    if (graph && graph.edges) {
      Object.keys(graph.edges).forEach(function (id) {
        var e = graph.edges[id];
        if (!e.geometry || e.geometry.length < 2) return;
        var bb = edgeBBox(graph, e);
        var padLat = maxOff / 110.574, padLng = maxOff / (111.32 * Math.max(0.2, Math.cos(((bb[0] + bb[2]) / 2) * DEG)));
        edges.push(e);
        boxes.push([bb[0] - padLat, bb[1] - padLng, bb[2] + padLat, bb[3] + padLng]);
      });
    }
    var lv = new Array(n), rid = new Array(n);
    for (var i = 0; i < n; i++) {
      var k = (i + 0.5) * dk;
      var p = pointAtCum(geom, cum, k);
      lv[i] = 'unknown';
      rid[i] = null;
      var best = null;
      for (var j = 0; j < edges.length; j++) {
        var b = boxes[j];
        if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
        var e = edges[j];
        var r = nearestCum(e.geometry, edgeCum(graph, e.id), p);
        if (r.distance_km > maxOff || (best && r.distance_km >= best.r.distance_km)) continue;
        best = { e: e, r: r };
      }
      if (!best) continue;
      var gl = graph._c.glen[best.e.id];
      // nearest point = an edge end, off to the side: the route has left the corridor at a terminal node
      if ((best.r.along_km <= 1e-6 || best.r.along_km >= gl - 1e-6) && best.r.distance_km > 0.03) continue;
      // roughly parallel? (a road crossing a pilot edge is not "running along" it)
      var rb = bearingDeg(pointAtCum(geom, cum, Math.max(0, k - win)), pointAtCum(geom, cum, Math.min(total, k + win)));
      var ecum = edgeCum(graph, best.e.id), eg = best.e.geometry;
      var eb = bearingDeg(pointAtCum(eg, ecum, Math.max(0, best.r.along_km - win)), pointAtCum(eg, ecum, Math.min(ecum[ecum.length - 1], best.r.along_km + win)));
      if (lineAngle(rb, eb) > maxAngle) continue;
      var along = gl > EPS ? best.r.along_km * best.e.length_km / gl : 0;
      lv[i] = levelAtKm(graph, best.e, along);
      rid[i] = best.e.route_id || null;
    }
    // short matched runs between unknown stretches = crossings → unknown
    if (minRun > 0) {
      var s0 = -1;
      for (var q = 0; q <= n; q++) {
        var matched = q < n && lv[q] !== 'unknown';
        if (matched && s0 < 0) s0 = q;
        if (!matched && s0 >= 0) {
          var runKm = (q - s0) * dk;
          var inner = s0 > 0 && q < n;
          if (inner && runKm < minRun - EPS) for (var z = s0; z < q; z++) { lv[z] = 'unknown'; rid[z] = null; }
          s0 = -1;
        }
      }
    }
    // runs of equal level → parts
    var start = 0;
    for (var m = 1; m <= n; m++) {
      if (m < n && lv[m] === lv[start]) continue;
      var from = start * dk, to = m === n ? total : m * dk;
      var level = lv[start];
      res.parts.push({ from_km: from, to_km: to, level: level, geometry: sliceCum(geom, cum, from, to) });
      res[level + '_km'] += to - from;
      for (var w = start; w < m; w++) {
        if (!rid[w]) continue;
        res.routes_km[rid[w]] = (res.routes_km[rid[w]] || 0) + dk;
        if (lv[w] === 'lost') res.lost_by_route[rid[w]] = (res.lost_by_route[rid[w]] || 0) + dk;
      }
      start = m;
    }
    res.zones = zonesOf(res.parts);
    res.first_lost_at_km = res.zones.length ? res.zones[0].start_km : null;
    res.eta_min = { motorbike: round(total / SPEEDS.motorbike * 60, 1), hiking: round(total / SPEEDS.hiking * 60, 1) };
    return res;
  }

  /* ------------------------------------------------------------------ dead-zone look-ahead */

  function validSpeed(v) { return typeof v === 'number' && isFinite(v) && v >= 0.5 && v <= 150; }

  /**
   * Proactive warning before entering a dead zone (PDF 6.3). Time basis when a stable speed is known, otherwise
   * distance basis (GPS jitter / sudden speed change → opts.unstable=true).
   * @param {Object} analysis result of analyze()
   * @param {number} posKm position along the route (km)
   * @param {{speed_kmh?:number, mode?:'motorbike'|'hiking', unstable?:boolean}} opts
   * @returns {{in_deadzone:boolean, next:{start_km,end_km,length_km}|null, distance_km:number|null, minutes:number|null,
   *   should_warn:boolean, basis:'time'|'distance', mode:string, threshold:{minutes:number,km:number}}}
   */
  function deadzoneAhead(analysis, posKm, opts) {
    opts = opts || {};
    var speed = opts.speed_kmh;
    var mode = opts.mode || (validSpeed(speed) ? (speed > MODE_SPLIT_KMH ? 'motorbike' : 'hiking') : 'motorbike');
    if (!THRESHOLDS[mode]) mode = 'motorbike';
    var th = THRESHOLDS[mode];
    var basis = (validSpeed(speed) && !opts.unstable) ? 'time' : 'distance';
    var zones = (analysis && analysis.zones) || zonesOf(analysis && analysis.parts);
    var pos = Math.max(0, +posKm || 0);
    var out = { in_deadzone: false, next: null, distance_km: null, minutes: null, should_warn: false, basis: basis, mode: mode, threshold: th };
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (pos >= z.start_km - 1e-9 && pos < z.end_km) {
        out.in_deadzone = true;
        out.next = { start_km: z.start_km, end_km: z.end_km, length_km: z.end_km - z.start_km };
        out.distance_km = 0;
        out.minutes = 0;
        return out;
      }
      if (z.start_km > pos) {
        var dist = z.start_km - pos;
        var v = basis === 'time' ? speed : SPEEDS[mode];
        out.next = { start_km: z.start_km, end_km: z.end_km, length_km: z.end_km - z.start_km };
        out.distance_km = dist;
        out.minutes = dist / v * 60;
        out.should_warn = basis === 'time' ? out.minutes <= th.minutes + 1e-9 : dist <= th.km + 1e-9;
        return out;
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ mode & speed */

  function median(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function speedsOf(samples) {
    return (samples || []).map(function (s) {
      return typeof s === 'number' ? s : (s && (s.speed_kmh !== undefined ? s.speed_kmh : s.v));
    }).filter(function (v) { return typeof v === 'number' && isFinite(v) && v >= 0; });
  }

  /**
   * Detect travel mode from recent speed samples (km/h). Ignores stops (≤ 1 km/h); median > 8 km/h ⇒ motorbike.
   * @param {Array<number|{speed_kmh:number}>} samples
   * @param {'motorbike'|'hiking'} [fallback='motorbike'] returned when there is no moving sample
   * @returns {'motorbike'|'hiking'}
   */
  function detectMode(samples, fallback) {
    var moving = speedsOf(samples).filter(function (v) { return v > 1 && v < 200; });
    if (!moving.length) return fallback === 'hiking' ? 'hiking' : 'motorbike';
    return median(moving) > MODE_SPLIT_KMH ? 'motorbike' : 'hiking';
  }

  function tsOf(s) {
    var t = s.t !== undefined ? s.t : (s.ts !== undefined ? s.ts : (s.at !== undefined ? s.at : s.timestamp));
    return typeof t === 'number' ? t : Date.parse(t);
  }

  /**
   * Moving-average speed (km/h) over the last `windowMin` minutes.
   * Accepts numbers (plain mean), {t, speed_kmh} samples (time-windowed mean) or GPS fixes {t, lat, lng}
   * (distance travelled / elapsed time inside the window). Returns null when not computable.
   * @returns {number|null}
   */
  function movingAverage(samples, windowMin) {
    if (!samples || !samples.length) return null;
    var win = (windowMin > 0 ? windowMin : 3) * 60000;
    if (typeof samples[0] === 'number') {
      var nums = speedsOf(samples);
      return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null;
    }
    var withT = samples.filter(function (s) { return s && isFinite(tsOf(s)); })
      .sort(function (a, b) { return tsOf(a) - tsOf(b); });
    if (!withT.length) {
      var sp = speedsOf(samples);
      return sp.length ? sp.reduce(function (a, b) { return a + b; }, 0) / sp.length : null;
    }
    var latest = tsOf(withT[withT.length - 1]);
    var inWin = withT.filter(function (s) { return tsOf(s) >= latest - win; });
    var hasSpeed = inWin.some(function (s) { return typeof (s.speed_kmh !== undefined ? s.speed_kmh : s.v) === 'number'; });
    if (hasSpeed) {
      var v = speedsOf(inWin);
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
    }
    if (inWin.length < 2) return null;
    var dist = 0;
    for (var i = 1; i < inWin.length; i++) dist += haversineKm(inWin[i - 1], inWin[i]);
    var hours = (tsOf(inWin[inWin.length - 1]) - tsOf(inWin[0])) / 3600000;
    return hours > 0 ? dist / hours : null;
  }

  /**
   * True when recent speeds are too erratic for a time-based estimate (coefficient of variation > 0.5 or a ≥3× jump
   * between consecutive moving samples) → callers pass {unstable:true} to deadzoneAhead (distance basis).
   */
  function isSpeedUnstable(samples) {
    var v = speedsOf(samples);
    if (v.length < 3) return true;
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    if (mean <= 0.5) return true;
    var sd = Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / v.length);
    if (sd / mean > 0.5) return true;
    for (var i = 1; i < v.length; i++) {
      var lo = Math.min(v[i], v[i - 1]), hi = Math.max(v[i], v[i - 1]);
      if (lo > 1 && hi / lo >= 3) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ stops along */

  /**
   * POIs within `buffer_km` of a route (analysis geometry) or of any edge of a graph.
   * @param {Object} target analysis (has .geometry) or Graph (has .edges)
   * @param {Array<{lat:number,lng:number}>} pois
   * @param {{buffer_km?:number}} opts
   * @returns {Array<{poi:Object, along_km:number, off_km:number, edgeId?:string}>} sorted by along_km
   */
  function stopsAlong(target, pois, opts) {
    var buffer = (opts && opts.buffer_km !== undefined) ? opts.buffer_km : 3;
    var out = [];
    if (!target || !pois) return out;
    if (target.geometry && !target.edges) {
      var geom = target.geometry;
      if (geom.length < 1) return out;
      var cum = cumulative(geom);
      var total = cum[cum.length - 1];
      var scale = target.length_km > 0 && total > 0 ? target.length_km / total : 1;
      pois.forEach(function (poi) {
        if (!poi || !isFinite(poi.lat) || !isFinite(poi.lng)) return;
        var r = nearestCum(geom, cum, poi);
        if (r.distance_km <= buffer) out.push({ poi: poi, along_km: r.along_km * scale, off_km: r.distance_km });
      });
    } else {
      pois.forEach(function (poi) {
        if (!poi || !isFinite(poi.lat) || !isFinite(poi.lng)) return;
        var s = snap(target, poi);
        if (s && s.distance_km <= buffer) out.push({ poi: poi, along_km: s.along_km, off_km: s.distance_km, edgeId: s.edgeId });
      });
    }
    out.sort(function (a, b) { return (a.along_km - b.along_km) || (a.off_km - b.off_km); });
    return out;
  }

  /* ------------------------------------------------------------------ export */

  var api = {
    SPEEDS: SPEEDS,
    THRESHOLDS: THRESHOLDS,
    buildGraph: buildGraph,
    astar: astar,
    routeBetween: routeBetween,
    snap: snap,
    analyze: analyze,
    deadzoneAhead: deadzoneAhead,
    detectMode: detectMode,
    movingAverage: movingAverage,
    isSpeedUnstable: isSpeedUnstable,
    stopsAlong: stopsAlong,
    pointAt: pointAt,
    sliceLine: sliceLine,
    lineLengthKm: lineLengthKm,
    nearestOnLine: nearestOnLine,
    progressOnLine: progressOnLine,
    overlaySignal: overlaySignal,
    haversineKm: haversineKm,
    levelFromRsrp: levelFromRsrp
  };

  NC.routing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
