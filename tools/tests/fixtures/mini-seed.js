/*
 * mini-seed.js — tiny synthetic NC_SEED / NC_SEED_ADMIN used by the node tests and as a fallback by
 * tools/tests/data-harness.html when assets/js/data/seed-core.js is not generated yet. Owner: P1 data (tests only).
 * Exposes window.NC_SEED_MINI and window.NC_SEED_ADMIN_MINI (never NC_SEED itself). Values are illustrative.
 */
(function (root) {
  'use strict';

  var BASE = [22.80, 104.98];
  function at(dx, dy) { // km offsets → [lat, lng]
    return [+(BASE[0] + dy / 110.574).toFixed(6), +(BASE[1] + dx / (111.32 * Math.cos(BASE[0] * Math.PI / 180))).toFixed(6)];
  }
  function hav(a, b) {
    var R = 6371.0088, d = Math.PI / 180;
    var x = Math.sin((b[0] - a[0]) * d / 2), y = Math.sin((b[1] - a[1]) * d / 2);
    var h = x * x + Math.cos(a[0] * d) * Math.cos(b[0] * d) * y * y;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function len(g) { var s = 0; for (var i = 1; i < g.length; i++) s += hav(g[i - 1], g[i]); return +s.toFixed(3); }

  var R1 = 'mini-loop';
  var nodes = [
    { id: 'mn-a', route_id: R1, name: 'Thị trấn A', name_en: 'Town A', kind: 'town', lat: at(0, 0)[0], lng: at(0, 0)[1] },
    { id: 'mn-b', route_id: R1, name: 'Đèo B', name_en: 'B Pass', kind: 'pass', lat: at(6, 1)[0], lng: at(6, 1)[1] },
    { id: 'mn-c', route_id: R1, name: 'Làng C', name_en: 'C Village', kind: 'village', lat: at(6, -5)[0], lng: at(6, -5)[1] },
    { id: 'mn-d', route_id: R1, name: 'Thị trấn D', name_en: 'Town D', kind: 'town', lat: at(12, 0)[0], lng: at(12, 0)[1] }
  ];
  function geom(from, to, via) {
    var f = nodes.filter(function (n) { return n.id === from; })[0], t = nodes.filter(function (n) { return n.id === to; })[0];
    return [[f.lat, f.lng]].concat(via || [], [[t.lat, t.lng]]);
  }
  var edges = [
    { id: 'me-ab', route_id: R1, from: 'mn-a', to: 'mn-b', is_connector: false, geometry: geom('mn-a', 'mn-b', [at(3, 0.8)]) },
    { id: 'me-bd', route_id: R1, from: 'mn-b', to: 'mn-d', is_connector: false, geometry: geom('mn-b', 'mn-d', [at(9, 0.8)]) },
    { id: 'me-ac', route_id: R1, from: 'mn-a', to: 'mn-c', is_connector: false, geometry: geom('mn-a', 'mn-c', [at(3, -3)]) },
    { id: 'me-cd', route_id: R1, from: 'mn-c', to: 'mn-d', is_connector: false, geometry: geom('mn-c', 'mn-d', [at(9, -3)]) }
  ];
  edges.forEach(function (e) { e.length_km = len(e.geometry); });

  // North road (ab, bd) mostly lost for every carrier; south road (ac, cd) covered. me-cd has no viettel segment (gap test).
  var segments = [];
  ['viettel', 'vinaphone', 'mobifone'].forEach(function (c, ci) {
    edges.forEach(function (e) {
      if (c === 'viettel' && e.id === 'me-cd') return;
      var north = e.id === 'me-ab' || e.id === 'me-bd';
      var cut = +(e.length_km * 0.3).toFixed(3);
      segments.push({ route_id: R1, carrier: c, edge_id: e.id, seq: 0, from_km: 0, to_km: cut, level: north ? 'uncertain' : 'likely', confidence: 0.7 });
      segments.push({ route_id: R1, carrier: c, edge_id: e.id, seq: 1, from_km: cut, to_km: e.length_km, level: north ? 'lost' : (ci === 2 ? 'uncertain' : 'likely'), confidence: 0.8 });
    });
  });

  var facilities = [
    { id: 'mf-1', route_id: R1, name: 'Trạm y tế xã A', type: 'tram_y_te', address: 'Xã A', lat: at(0.3, 0.2)[0], lng: at(0.3, 0.2)[1], phone: '+84 000 000 001',
      open_hours: '07:00–17:00', night_shift: true, trauma_capable: false, verified_by: 'Nhóm Stormbreakers', verified_at: '2026-09-10', status: 'verified', source: 'team', is_demo: true },
    { id: 'mf-2', route_id: R1, name: 'Bệnh viện Đa khoa D', type: 'benh_vien', address: 'TT D', lat: at(12.2, 0.1)[0], lng: at(12.2, 0.1)[1], phone: '+84 000 000 002',
      open_hours: '24/7', night_shift: true, trauma_capable: true, verified_by: 'Nhóm Stormbreakers', verified_at: '2026-08-20', status: 'verified', source: 'team', is_demo: true },
    { id: 'mf-3', route_id: R1, name: 'Nhà thuốc C', type: 'nha_thuoc', address: 'Làng C', lat: at(6.1, -5.1)[0], lng: at(6.1, -5.1)[1], phone: '+84 000 000 003',
      open_hours: '07:00–21:00', night_shift: false, trauma_capable: false, verified_by: 'Nhóm Stormbreakers', verified_at: '2026-04-01', status: 'verified', source: 'team', is_demo: true },
    { id: 'mf-4', route_id: R1, name: 'Phòng khám B (chưa đủ thông tin)', type: 'phong_kham', address: null, lat: at(6, 1.2)[0], lng: at(6, 1.2)[1], phone: null,
      open_hours: null, night_shift: null, trauma_capable: null, verified_by: null, verified_at: null, status: 'pending', source: 'community', is_demo: true },
    { id: 'mf-5', route_id: R1, name: 'Trạm đã đóng', type: 'tram_y_te', address: 'Xã cũ', lat: at(2, 2)[0], lng: at(2, 2)[1], phone: '+84 000 000 005',
      open_hours: '—', night_shift: false, trauma_capable: false, verified_by: 'x', verified_at: '2025-01-01', status: 'rejected', source: 'team', is_demo: true }
  ];
  var services = [
    { id: 'ms-1', route_id: R1, name: 'Homestay A', type: 'lodging', lat: at(0.5, -0.2)[0], lng: at(0.5, -0.2)[1], phone: '+84 000 000 011', open_hours: '24/7', is_partner: true, status: 'active', is_demo: true },
    { id: 'ms-2', route_id: R1, name: 'Sửa xe C', type: 'repair', lat: at(6, -4.8)[0], lng: at(6, -4.8)[1], phone: '+84 000 000 012', open_hours: '06:00–20:00', is_partner: false, status: 'active', is_demo: true },
    { id: 'ms-3', route_id: R1, name: 'Cây xăng cũ', type: 'fuel', lat: at(1, 1)[0], lng: at(1, 1)[1], phone: null, open_hours: null, is_partner: false, status: 'inactive', is_demo: true }
  ];

  root.NC_SEED_MINI = {
    version: 'mini-1', generated_at: '2026-09-27T00:00:00Z', model_version: 'idw-0.3-demo',
    carriers: [{ id: 'viettel', name: 'Viettel', sort: 1 }, { id: 'vinaphone', name: 'VinaPhone', sort: 2 }, { id: 'mobifone', name: 'MobiFone', sort: 3 }],
    routes: [{ id: R1, name: 'Vòng thử nghiệm', name_en: 'Test loop', region: 'Tuyên Quang', travel_mode: 'motorbike',
      length_km: +(edges.reduce(function (a, e) { return a + e.length_km; }, 0)).toFixed(2), color: '#0E9384',
      bbox: [at(0, -5.5)[0], at(-0.5, 0)[1], at(0, 1.5)[0], at(12.5, 0)[1]], description_vi: 'Tuyến giả lập cho kiểm thử', description_en: 'Synthetic test route',
      geometry: edges[0].geometry.concat(edges[1].geometry), sort: 1 }],
    nodes: nodes, edges: edges, segments: segments,
    accuracy: [{ route_id: R1, carrier: 'viettel', accuracy: 0.84, holdout_n: 40, model_version: 'idw-0.3-demo' },
      { route_id: R1, carrier: 'vinaphone', accuracy: 0.8, holdout_n: 38, model_version: 'idw-0.3-demo' },
      { route_id: R1, carrier: 'mobifone', accuracy: 0.77, holdout_n: 35, model_version: 'idw-0.3-demo' }],
    facilities: facilities, services: services,
    submissions: [
      { id: 'msub-1', device_id: null, facility_id: null, kind: 'new', payload: { name: 'Trạm y tế thôn E', type: 'tram_y_te', note: 'Có y sĩ trực' }, lat: at(8, -3)[0], lng: at(8, -3)[1], status: 'pending', created_at: '2026-09-25T08:00:00Z' },
      { id: 'msub-2', device_id: null, facility_id: 'mf-3', kind: 'closed', payload: { note: 'Đóng cửa từ tháng 9' }, lat: null, lng: null, status: 'pending', created_at: '2026-09-26T08:00:00Z' }
    ],
    content_releases: [{ id: 1, version: '1.0.0-demo', kind: 'medical', status: 'in_review', notes: 'Bản demo', reviewer_round1: 'Nhóm Stormbreakers', approver: null, approved_at: null, created_at: '2026-09-20T00:00:00Z' }],
    packs: [
      { route_id: R1, carrier: 'viettel', version: 1, published_at: '2026-09-01T00:00:00Z', notes: 'v1' },
      { route_id: R1, carrier: 'viettel', version: 2, published_at: '2026-09-20T00:00:00Z', notes: 'v2' },
      { route_id: R1, carrier: 'vinaphone', version: 1, published_at: '2026-09-20T00:00:00Z', notes: 'v1' }
    ]
  };

  root.NC_SEED_ADMIN_MINI = {
    version: 'mini-admin-1', generated_at: '2026-09-27T00:00:00Z',
    samples: [
      { id: 1, route_id: R1, edge_id: 'me-ab', carrier: 'viettel', tech: '4G', rsrp_dbm: -98, level: 'likely', lat: at(1, 0.3)[0], lng: at(1, 0.3)[1], measured_at: '2026-09-01T08:00:00Z', source: 'team', status: 'approved', is_holdout: false },
      { id: 2, route_id: R1, edge_id: 'me-ab', carrier: 'viettel', tech: 'none', rsrp_dbm: null, level: 'lost', lat: at(4, 0.8)[0], lng: at(4, 0.8)[1], measured_at: '2026-09-01T08:05:00Z', source: 'team', status: 'approved', is_holdout: true },
      { id: 3, route_id: R1, edge_id: 'me-cd', carrier: 'mobifone', tech: '4G', rsrp_dbm: -112, level: 'uncertain', lat: at(9, -3)[0], lng: at(9, -3)[1], measured_at: '2026-09-02T08:00:00Z', source: 'community', status: 'pending', is_holdout: false }
    ],
    devices: [{ id: '00000000-0000-4000-8000-000000000001', secret_hash: null, carrier: 'viettel', app_version: '2.0.0', created_at: '2026-09-26T00:00:00Z', last_seen_at: '2026-09-26T23:00:00Z' }],
    buddy_sessions: [
      { id: '00000000-0000-4000-8000-0000000000a1', device_id: '00000000-0000-4000-8000-000000000001', traveler_name: 'Demo traveller', recipient_name: 'Người nhận', recipient_email: 'recipient@example.com',
        recipient_phone: '+84 000 000 021', interval_min: 60, grace_min: 15, route_id: R1, travel_mode: 'motorbike', share_public_medical: false, public_medical: null,
        status: 'overdue', started_at: '2026-09-26T20:00:00Z', last_checkin_at: '2026-09-26T21:00:00Z', next_due_at: '2026-09-26T22:00:00Z',
        last_lat: at(6, 1)[0], last_lng: at(6, 1)[1], last_location_at: '2026-09-26T21:00:00Z', alerted_at: null, closed_at: null }
    ],
    checkin_events: [
      { id: '00000000-0000-4000-8000-0000000000e1', session_id: '00000000-0000-4000-8000-0000000000a1', device_id: '00000000-0000-4000-8000-000000000001', kind: 'start', lat: at(0, 0)[0], lng: at(0, 0)[1], client_ts: '2026-09-26T20:00:00Z', received_at: '2026-09-26T20:00:01Z', queued: false, note: null, meta: null }
    ],
    audit: [{ id: 1, actor: null, actor_label: 'system', action: 'insert', entity: 'facilities', entity_id: 'mf-1', details: { row: { id: 'mf-1' } }, created_at: '2026-09-26T00:00:00Z' }]
  };
})(typeof window !== 'undefined' ? window : globalThis);
