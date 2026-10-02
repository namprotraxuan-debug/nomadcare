/*
 * signal.js — Admin page "signal" (owner: admin-pages): RSRP heat map per route × carrier (custom canvas layer, thousands
 * of samples), 3-level segment overlay, stats by level, held-out accuracy + model version, community samples review.
 * Also defines NC.adp — the small shared kit used by admin-pages (signal, buddy, packs, audit).
 * Public API: NC.adp.{t, esc, h, icon, register, refreshBadges, routes, routeName, routeById, carriers, carrierName, pack,
 * graph, subscribe, head, kpi, toastErr, setHash, lsGet, lsSet, levelOf}; page registered as NC.admin 'signal'.
 */
(function (NC) {
  'use strict';

  var U = NC.util;

  /* ================================================================== i18n */
  NC.i18n.add({
    vi: {
      'ad.sig.nav': 'Lớp phủ sóng', 'ad.sig.nav_short': 'Sóng',
      'ad.sig.title': 'Lớp phủ sóng & mẫu đo',
      'ad.sig.subtitle': 'Bản đồ nhiệt RSRP theo cung × nhà mạng, phân loại 3 mức, độ tin cậy held-out và duyệt mẫu cộng đồng.',
      'ad.sig.route': 'Cung đường',
      'ad.sig.carrier': 'Nhà mạng',
      'ad.sig.status': 'Trạng thái mẫu',
      'ad.sig.st_all': 'Mọi mẫu',
      'ad.sig.st_approved': 'Đã duyệt',
      'ad.sig.st_pending': 'Chờ duyệt',
      'ad.sig.st_rejected': 'Đã từ chối',
      'ad.sig.view': 'Hiển thị',
      'ad.sig.mode_heat': 'Nhiệt',
      'ad.sig.mode_dots': 'Điểm',
      'ad.sig.segments': 'Đoạn phân loại',
      'ad.sig.kpi_samples': 'Mẫu đo',
      'ad.sig.kpi_samples_sub': '{approved} đã duyệt · {pending} chờ duyệt',
      'ad.sig.kpi_median': 'RSRP trung vị',
      'ad.sig.kpi_median_sub': '10% yếu nhất ≤ {p10} dBm',
      'ad.sig.kpi_lost': 'Mẫu mất sóng',
      'ad.sig.kpi_lost_sub': '< −115 dBm hoặc không dịch vụ',
      'ad.sig.kpi_acc': 'Độ chính xác held-out',
      'ad.sig.kpi_acc_sub': '{n} điểm kiểm tra giữ riêng',
      'ad.sig.kpi_dead': 'Quãng mất sóng',
      'ad.sig.kpi_dead_sub': 'trên {total} đã phân loại',
      'ad.sig.map_title': 'Bản đồ nhiệt RSRP',
      'ad.sig.map_sub': '{route} · {carrier} · {n} mẫu',
      'ad.sig.legend_rsrp': 'RSRP (dBm)',
      'ad.sig.legend_hint': 'Chạm vào một mức để ẩn/hiện',
      'ad.sig.legend_pending': 'Viền đứt: mẫu cộng đồng chờ duyệt',
      'ad.sig.legend_line': 'Đường: lớp phủ 3 mức đang phát hành',
      'ad.sig.tip_team': 'Nhóm đo thực địa',
      'ad.sig.tip_community': 'Cộng đồng',
      'ad.sig.tip_holdout': 'tập kiểm tra',
      'ad.sig.no_service': 'Không dịch vụ',
      'ad.sig.acc_title': 'Độ tin cậy lớp sóng',
      'ad.sig.acc_body': 'Tỷ lệ dự đoán đúng trạng thái có/mất sóng trên {n} điểm kiểm tra giữ riêng (không dùng để nội suy). Công bố riêng cho từng cung.',
      'ad.sig.acc_model': 'Mô hình {model} · tính lúc {at}',
      'ad.sig.acc_none': 'Chưa có chỉ số cho cung/nhà mạng này.',
      'ad.sig.hist_title': 'Phân bố RSRP',
      'ad.sig.hist_sub': '≥ −105 có sóng · −115…−105 không chắc · < −115 mất sóng',
      'ad.sig.hist_none': 'Không DV',
      'ad.sig.cmp_title': 'Phân loại 3 mức theo nhà mạng',
      'ad.sig.cmp_sub': 'Km dọc cung theo lớp phủ hiện tại. Cùng một đoạn đèo, mỗi nhà mạng một khác.',
      'ad.sig.tech_title': 'Công nghệ mạng',
      'ad.sig.pend_title': 'Mẫu cộng đồng chờ duyệt',
      'ad.sig.pend_sub': 'Log ẩn danh do người dùng chủ động bật. Chỉ nhập vào lớp chính sau khi duyệt.',
      'ad.sig.scope_route': 'Cung đang xem',
      'ad.sig.scope_all': 'Tất cả cung',
      'ad.sig.selected': 'Đã chọn {n}',
      'ad.sig.approve': 'Duyệt',
      'ad.sig.reject': 'Từ chối',
      'ad.sig.select_all': 'Chọn tất cả',
      'ad.sig.more': 'Xem thêm {n} mẫu',
      'ad.sig.select': 'Chọn',
      'ad.sig.bulk_hint': 'Chọn mẫu để duyệt hoặc từ chối hàng loạt',
      'ad.sig.select_row': 'Chọn mẫu {id}',
      'ad.sig.col_time': 'Thời điểm',
      'ad.sig.col_route': 'Cung',
      'ad.sig.col_carrier': 'Nhà mạng',
      'ad.sig.col_rsrp': 'RSRP',
      'ad.sig.col_level': 'Mức',
      'ad.sig.col_device': 'Thiết bị',
      'ad.sig.col_pos': 'Vị trí',
      'ad.sig.locate': 'Xem trên bản đồ',
      'ad.sig.approved_n': 'Đã duyệt {n} mẫu. Mẫu mới được dùng ở lần nội suy kế tiếp — phát hành lại gói để thiết bị nhận.',
      'ad.sig.rejected_n': 'Đã từ chối {n} mẫu.',
      'ad.sig.open_packs': 'Mở Gói dữ liệu',
      'ad.sig.reject_t': 'Từ chối {n} mẫu?',
      'ad.sig.reject_m': 'Mẫu bị từ chối không được dùng để nội suy lớp phủ. Có thể duyệt lại sau.',
      'ad.sig.pend_empty': 'Không còn mẫu chờ duyệt',
      'ad.sig.pend_empty_t': 'Mẫu cộng đồng mới sẽ xuất hiện ở đây theo thời gian thực.',
      'ad.sig.load_err': 'Không tải được dữ liệu sóng',
      'ad.sig.refresh': 'Làm mới',
      'ad.sig.fit': 'Vừa khung cung đường',
      'ad.sig.live_new': 'Có mẫu cộng đồng mới chờ duyệt',
      'ad.sig.err': 'Thao tác thất bại: {msg}',
      'ad.sig.demo_note': 'Dữ liệu đo minh hoạ (đợt đo 07–08/2026, ~400 m/mẫu, 3 thiết bị Android chạy song song).'
    },
    en: {
      'ad.sig.nav': 'Signal layer', 'ad.sig.nav_short': 'Signal',
      'ad.sig.title': 'Signal layer & samples',
      'ad.sig.subtitle': 'RSRP heat map per route × carrier, 3-level classification, held-out accuracy and community sample review.',
      'ad.sig.route': 'Route',
      'ad.sig.carrier': 'Carrier',
      'ad.sig.status': 'Sample status',
      'ad.sig.st_all': 'All samples',
      'ad.sig.st_approved': 'Approved',
      'ad.sig.st_pending': 'Pending',
      'ad.sig.st_rejected': 'Rejected',
      'ad.sig.view': 'Display',
      'ad.sig.mode_heat': 'Heat',
      'ad.sig.mode_dots': 'Dots',
      'ad.sig.segments': 'Classified segments',
      'ad.sig.kpi_samples': 'Samples',
      'ad.sig.kpi_samples_sub': '{approved} approved · {pending} pending',
      'ad.sig.kpi_median': 'Median RSRP',
      'ad.sig.kpi_median_sub': 'weakest 10% ≤ {p10} dBm',
      'ad.sig.kpi_lost': 'No-signal samples',
      'ad.sig.kpi_lost_sub': '< −115 dBm or no service',
      'ad.sig.kpi_acc': 'Held-out accuracy',
      'ad.sig.kpi_acc_sub': '{n} held-out checkpoints',
      'ad.sig.kpi_dead': 'Dead-zone length',
      'ad.sig.kpi_dead_sub': 'of {total} classified',
      'ad.sig.map_title': 'RSRP heat map',
      'ad.sig.map_sub': '{route} · {carrier} · {n} samples',
      'ad.sig.legend_rsrp': 'RSRP (dBm)',
      'ad.sig.legend_hint': 'Tap a level to hide/show it',
      'ad.sig.legend_pending': 'Dashed ring: pending community sample',
      'ad.sig.legend_line': 'Line: published 3-level layer',
      'ad.sig.tip_team': 'Team field survey',
      'ad.sig.tip_community': 'Community',
      'ad.sig.tip_holdout': 'held-out',
      'ad.sig.no_service': 'No service',
      'ad.sig.acc_title': 'Signal layer confidence',
      'ad.sig.acc_body': 'Share of correct signal/no-signal predictions on {n} held-out checkpoints (never used for interpolation). Published per route.',
      'ad.sig.acc_model': 'Model {model} · computed {at}',
      'ad.sig.acc_none': 'No accuracy figure for this route/carrier yet.',
      'ad.sig.hist_title': 'RSRP distribution',
      'ad.sig.hist_sub': '≥ −105 likely · −115…−105 uncertain · < −115 lost',
      'ad.sig.hist_none': 'No svc',
      'ad.sig.cmp_title': '3-level classification by carrier',
      'ad.sig.cmp_sub': 'Km along the route in the current layer. Same pass, very different coverage per carrier.',
      'ad.sig.tech_title': 'Network technology',
      'ad.sig.pend_title': 'Community samples awaiting review',
      'ad.sig.pend_sub': 'Anonymous logs from users who opted in. Merged into the main layer only after review.',
      'ad.sig.scope_route': 'This route',
      'ad.sig.scope_all': 'All routes',
      'ad.sig.selected': '{n} selected',
      'ad.sig.approve': 'Approve',
      'ad.sig.reject': 'Reject',
      'ad.sig.select_all': 'Select all',
      'ad.sig.more': 'Show {n} more',
      'ad.sig.select': 'Select',
      'ad.sig.bulk_hint': 'Select samples to approve or reject in bulk',
      'ad.sig.select_row': 'Select sample {id}',
      'ad.sig.col_time': 'Measured',
      'ad.sig.col_route': 'Route',
      'ad.sig.col_carrier': 'Carrier',
      'ad.sig.col_rsrp': 'RSRP',
      'ad.sig.col_level': 'Level',
      'ad.sig.col_device': 'Device',
      'ad.sig.col_pos': 'Position',
      'ad.sig.locate': 'Show on map',
      'ad.sig.approved_n': '{n} samples approved. They join the next interpolation run — republish the pack so devices get it.',
      'ad.sig.rejected_n': '{n} samples rejected.',
      'ad.sig.open_packs': 'Open Data packs',
      'ad.sig.reject_t': 'Reject {n} samples?',
      'ad.sig.reject_m': 'Rejected samples are not used to interpolate the layer. You can approve them later.',
      'ad.sig.pend_empty': 'Nothing left to review',
      'ad.sig.pend_empty_t': 'New community samples appear here in real time.',
      'ad.sig.load_err': 'Could not load signal data',
      'ad.sig.refresh': 'Refresh',
      'ad.sig.fit': 'Fit route',
      'ad.sig.live_new': 'New community samples awaiting review',
      'ad.sig.err': 'Action failed: {msg}',
      'ad.sig.demo_note': 'Illustrative survey data (Jul–Aug 2026 trips, ~400 m spacing, 3 Android loggers in parallel).'
    }
  });

  /* ================================================================== shared kit (NC.adp) */
  var kit = NC.adp = NC.adp || {};
  var t = kit.t = function (k, v) { return NC.i18n.t(k, v); };
  var esc = kit.esc = U.esc;
  var h = kit.h = U.h;
  var icon = kit.icon = function (n, c) { return NC.ui.icon(n, c); };

  var CARRIERS_DEFAULT = [{ id: 'viettel', name: 'Viettel' }, { id: 'vinaphone', name: 'VinaPhone' }, { id: 'mobifone', name: 'MobiFone' }];

  /** Register an admin page; guarded shim when admin-core's router is not there yet (queues until it appears). */
  kit.register = function (name, def) {
    if (NC.admin && typeof NC.admin.register === 'function') { NC.admin.register(name, def); return; }
    console.warn('[admin-pages] NC.admin.register missing — queued', name);
    (kit._queue = kit._queue || []).push([name, def]);
    document.addEventListener('DOMContentLoaded', function () {
      if (!NC.admin || !NC.admin.register) return;
      (kit._queue || []).splice(0).forEach(function (q) { NC.admin.register(q[0], q[1]); });
    });
  };
  kit.refreshBadges = function () { try { if (NC.admin && NC.admin.refreshBadges) NC.admin.refreshBadges(); } catch (e) { /* ignore */ } };

  kit.carriers = function () {
    var s = window.NC_SEED && window.NC_SEED.carriers;
    return (s && s.length ? s : CARRIERS_DEFAULT).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); })
      .map(function (c) { return { id: c.id, name: c.name || c.id }; });
  };
  kit.carrierName = function (id) {
    var c = kit.carriers().filter(function (x) { return x.id === id; })[0];
    return c ? c.name : (id || '–');
  };

  var routesCache = null, routesP = null;
  function seedRoutes() {
    var s = window.NC_SEED && window.NC_SEED.routes;
    return (s || []).map(function (r) { return { id: r.id, name: r.name, name_en: r.name_en, bbox: r.bbox, color: r.color, travel_mode: r.travel_mode, length_km: r.length_km, sort: r.sort }; });
  }
  /** Routes (id, name, name_en, bbox, travel_mode, length_km) — server list, seed fallback. Cached. */
  kit.routes = function (force) {
    if (routesP && !force) return routesP;
    routesCache = routesCache || seedRoutes();
    routesP = NC.data.listRoutes().then(function (rows) {
      if (rows && rows.length) routesCache = rows.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      return routesCache;
    }, function () { return routesCache; });
    return routesP;
  };
  /** Sync route list (last server list, seed until then). */
  kit.routeList = function () { return (routesCache || seedRoutes()).slice(); };
  kit.routeById = function (id) {
    var list = routesCache || seedRoutes();
    return list.filter(function (r) { return r.id === id; })[0] || null;
  };
  /** Route name without the parenthetical detail ("Đèo Khánh Lê (QL27C …)" → "Đèo Khánh Lê"). */
  kit.routeShort = function (id) { return String(kit.routeName(id)).replace(/\s*\([^)]*\)\s*$/, ''); };
  kit.routeName = function (id) {
    var r = kit.routeById(id);
    if (!r) return id || '–';
    return (NC.i18n.lang() === 'en' && r.name_en) ? r.name_en : r.name;
  };

  var packs = {}, graphs = {};
  /** Pack for route/carrier (cached promise; bundled/server/downloaded per NC.data.getPack). */
  kit.pack = function (routeId, carrier) {
    var k = routeId + ':' + carrier;
    if (!packs[k]) packs[k] = NC.data.getPack(routeId, carrier).catch(function (e) { delete packs[k]; throw e; });
    return packs[k];
  };
  kit.graph = function (routeId, carrier) {
    var k = routeId + ':' + carrier;
    if (!graphs[k]) graphs[k] = kit.pack(routeId, carrier).then(function (p) { return NC.routing.buildGraph([p]); }).catch(function (e) { delete graphs[k]; throw e; });
    return graphs[k];
  };
  kit.dropPackCache = function () { packs = {}; graphs = {}; };

  /** Signal level at a point for a graph (snap → segment containing along_km). */
  kit.levelOf = function (graph, pt) {
    if (!graph || !pt || !isFinite(pt.lat) || !isFinite(pt.lng)) return null;
    var sn = NC.routing.snap(graph, pt);
    if (!sn || !sn.edgeId) return null;
    var segs = (graph.segmentsByEdge && graph.segmentsByEdge[sn.edgeId]) || [];
    var hit = segs.filter(function (s) { return sn.along_km >= s.from_km - 1e-6 && sn.along_km <= s.to_km + 1e-6; })[0];
    return { level: hit ? hit.level : null, distance_km: sn.distance_km, edge_id: sn.edgeId, along_km: sn.along_km };
  };

  /**
   * Realtime subscription filtered by table names ('*' = all), debounced.
   * @returns {function} unsubscribe
   */
  kit.subscribe = function (tables, fn, ms) {
    var pending = [];
    var run = U.debounce(function () { var batch = pending.splice(0); try { fn(batch); } catch (e) { console.error('[admin-pages] realtime handler', e); } }, ms || 500);
    return NC.data.admin.subscribe(function (msg) {
      if (!msg) return;
      if (tables.indexOf('*') < 0 && tables.indexOf(msg.table) < 0 && msg.table !== '*') return;
      pending.push(msg);
      run();
    });
  };

  /** Page header — same markup as NC.admin.pageHead (admin.css .ad-page-head) + i18n hooks. */
  kit.head = function (o) {
    return h('header', { class: 'ad-page-head' },
      h('span', { class: 'icon-tile icon-tile--lg ad-page-head__icon icon-tile--' + (o.tone || 'primary'), html: icon(o.icon || 'circle') }),
      h('div', { class: 'ad-page-head__text' },
        h('h2', { class: 'ad-page-head__title', 'data-i18n': o.titleKey }, t(o.titleKey)),
        o.subKey ? h('p', { class: 'ad-page-head__sub', 'data-i18n': o.subKey }, t(o.subKey)) : null),
      h('div', { class: 'ad-page-head__actions' }, o.actions || []));
  };

  /** KPI tile — admin.css .ad-kpi markup (label + icon, big value, meta). o: {icon, tone, label, value, sub, alert}. */
  kit.kpi = function (o) {
    return h('div', { class: ['ad-kpi', 'ad-pg-kpi', o.tone ? 'ad-pg-kpi--' + o.tone : null], 'data-kpi': o.id || null },
      h('div', { class: 'ad-kpi__top' },
        h('span', { class: 'ad-kpi__label ad-pg-kpi__label' }, o.label || ''),
        h('span', { class: 'icon-tile icon-tile--sm ad-kpi__icon icon-tile--' + (o.tone || 'primary'), html: icon(o.icon || 'circle') })),
      h('strong', { class: 'ad-kpi__value ad-pg-kpi__value' }, o.value === undefined ? '–' : String(o.value)),
      h('span', { class: 'ad-kpi__meta ad-pg-kpi__sub' }, o.sub || ''));
  };
  kit.setKpi = function (el, value, sub, alert) {
    if (!el) return;
    var v = el.querySelector('.ad-pg-kpi__value'), s = el.querySelector('.ad-pg-kpi__sub');
    if (v) v.textContent = value === undefined || value === null ? '–' : String(value);
    if (s && sub !== undefined) s.textContent = sub || '';
    if (alert !== undefined) { el.classList.toggle('ad-kpi--alert', !!alert); el.classList.toggle('ad-kpi--danger', !!alert); }
  };

  kit.errMsg = function (e) {
    if (!e) return t('common.error');
    if (e.code === 'forbidden') return e.message || 'forbidden';
    return e.message || String(e.code || e);
  };
  kit.toastErr = function (e) {
    if (e && e.sessionLost) return; // admin session vanished: the shell already shows the sign-in gate (admin.js guard)
    console.error('[admin-pages]', e);
    NC.ui.toast(t('ad.sig.err', { msg: kit.errMsg(e) }), { type: 'danger', timeout: 6000 });
  };

  /** Update the hash query silently (no hashchange → no re-route). */
  kit.setHash = function (name, params) {
    if (NC.admin && typeof NC.admin.go === 'function' && NC.admin.current && (NC.admin.current() || {}).name === name) {
      try { NC.admin.go(name, params || {}, { silent: true }); return; } catch (e) { /* fall back */ }
    }
    try {
      var q = Object.keys(params || {}).filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
      var hash = '#/' + name + (q ? '?' + q : '');
      if (location.hash !== hash && window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search + hash);
    } catch (e) { /* ignore */ }
  };
  kit.lsGet = function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  kit.lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  kit.pct = function (v, d) { return v === null || v === undefined || !isFinite(v) ? '–' : U.fmtNumber(v * 100, d === undefined ? 1 : d) + '%'; };
  kit.visible = function (el) { return !!(el && el.offsetParent !== null); };

  /* ================================================================== canvas heat layer */

  var LEVELS = ['likely', 'uncertain', 'lost'];
  function levelOfRsrp(r) {
    if (r === null || r === undefined || !isFinite(r)) return 'lost';
    return r >= -105 ? 'likely' : r >= -115 ? 'uncertain' : 'lost';
  }
  function rgbOf(c) {
    if (!c) return [128, 128, 128];
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (m) {
      var x = m[1].length === 3 ? m[1].replace(/./g, function (q) { return q + q; }) : m[1];
      return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
    }
    m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(c);
    return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  }
  function cssToken(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
  }
  /* 13 RSRP buckets (−125…−95 dBm, 2.5 dB) + 1 bucket for "no service". */
  var NB = 13;
  function bucketOf(r) {
    if (r === null || r === undefined || !isFinite(r)) return NB;
    var v = Math.max(-125, Math.min(-95, +r));
    return Math.min(NB - 1, Math.floor((v + 125) / 2.5));
  }
  function bucketRsrp(b) { return b >= NB ? null : -125 + b * 2.5 + 1.25; }

  var HeatLayer = null;
  function heatClass() {
    if (HeatLayer) return HeatLayer;
    var L = window.L;
    HeatLayer = L.Layer.extend({
      initialize: function (opts) {
        this._o = opts || {};
        this._pts = [];
        this._hidden = {};
        this._mode = 'heat';
        this._sel = null;
        this._pad = 0.1;
        this._raf = 0;
      },
      /** samples: [{id,lat,lng,rsrp_dbm,level,status,source,...}] */
      setData: function (samples) {
        var pts = (samples || []).filter(function (s) { return isFinite(s.lat) && isFinite(s.lng); });
        // Strong first, weak last → dead zones are painted on top.
        pts.sort(function (a, b) { return (b.rsrp_dbm === null || b.rsrp_dbm === undefined ? -999 : b.rsrp_dbm) - (a.rsrp_dbm === null || a.rsrp_dbm === undefined ? -999 : a.rsrp_dbm); });
        this._pts = pts;
        this._bk = pts.map(function (s) { return bucketOf(s.rsrp_dbm); });
        this._projZ = null;
        this._schedule();
        return this;
      },
      setMode: function (m) { this._mode = m === 'dots' ? 'dots' : 'heat'; this._spr = null; this._schedule(); return this; },
      setHidden: function (map) { this._hidden = map || {}; this._schedule(); return this; },
      setSelected: function (id) { this._sel = id === undefined ? null : id; this._schedule(); return this; },
      sampleById: function (id) { return this._pts.filter(function (s) { return s.id === id; })[0] || null; },
      onAdd: function (map) {
        this._map = map;
        if (!map.getPane('adSig')) {
          var pane = map.createPane('adSig');
          pane.style.zIndex = 450;
          pane.style.pointerEvents = 'none';
        }
        this._c = L.DomUtil.create('canvas', 'ad-sig-canvas leaflet-zoom-animated', map.getPane('adSig'));
        this._tip = L.DomUtil.create('div', 'ad-sig-tip', map.getContainer());
        this._tip.setAttribute('role', 'status');
        this._tip.hidden = true;
        map.on('moveend zoomend viewreset resize', this._reset, this);
        if (map.options.zoomAnimation && L.Browser.any3d) map.on('zoomanim', this._animZoom, this);
        map.on('mousemove', this._onMove, this);
        map.on('mouseout', this._onOut, this);
        map.on('click', this._onClick, this);
        map.on('nc:theme', this._retheme, this);
        this._reset();
      },
      onRemove: function (map) {
        map.off('moveend zoomend viewreset resize', this._reset, this);
        map.off('zoomanim', this._animZoom, this);
        map.off('mousemove', this._onMove, this);
        map.off('mouseout', this._onOut, this);
        map.off('click', this._onClick, this);
        map.off('nc:theme', this._retheme, this);
        if (this._c && this._c.parentNode) this._c.parentNode.removeChild(this._c);
        if (this._tip && this._tip.parentNode) this._tip.parentNode.removeChild(this._tip);
        cancelAnimationFrame(this._raf);
        this._map = null;
      },
      _retheme: function () { this._spr = null; this._schedule(); },
      _schedule: function () {
        if (!this._map) return;
        var self = this;
        cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(function () { self._draw(); });
      },
      _reset: function () {
        var map = this._map;
        if (!map) return;
        var size = map.getSize();
        var pw = Math.round(size.x * this._pad), ph = Math.round(size.y * this._pad);
        var tl = map.containerPointToLayerPoint([-pw, -ph]).round();
        var w = size.x + 2 * pw, hgt = size.y + 2 * ph;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        this._tl = tl; this._w = w; this._h = hgt; this._dpr = dpr;
        L.DomUtil.setPosition(this._c, tl);
        if (this._c.width !== Math.round(w * dpr) || this._c.height !== Math.round(hgt * dpr)) {
          this._c.width = Math.round(w * dpr); this._c.height = Math.round(hgt * dpr);
          this._c.style.width = w + 'px'; this._c.style.height = hgt + 'px';
        }
        this._bounds = L.latLngBounds(map.containerPointToLatLng([-pw, -ph]), map.containerPointToLatLng([size.x + pw, size.y + ph]));
        this._draw();
      },
      _animZoom: function (e) {
        var map = this._map;
        if (!map || !this._bounds) return;
        if (typeof map._latLngBoundsToNewLayerBounds !== 'function') { this._c.style.opacity = '0'; return; }
        var scale = map.getZoomScale(e.zoom);
        var offset = map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
        L.DomUtil.setTransform(this._c, offset, scale);
      },
      _radius: function (z) { return Math.max(2.4, Math.min(9, 2.2 + (z - 8) * 1.05)); },
      _sprites: function (r) {
        var key = this._mode + ':' + r.toFixed(2) + ':' + this._dpr;
        if (this._spr && this._sprKey === key) return this._spr;
        var dpr = this._dpr, heat = this._mode === 'heat';
        var R = heat ? r * 2.7 : r + 1.6;
        var surface = rgbOf(cssToken('--c-surface') || '#ffffff');
        var out = [];
        for (var b = 0; b <= NB; b++) {
          var col = rgbOf(NC.mapkit.rsrpColor(bucketRsrp(b), 'lost'));
          var cv = document.createElement('canvas');
          var px = Math.ceil(R * 2 * dpr);
          cv.width = px; cv.height = px;
          var g = cv.getContext('2d');
          g.scale(dpr, dpr);
          var c = 'rgba(' + col.join(',') + ',';
          if (heat) {
            var grd = g.createRadialGradient(R, R, 0, R, R, R);
            grd.addColorStop(0, c + '0.62)');
            grd.addColorStop(0.35, c + '0.34)');
            grd.addColorStop(1, c + '0)');
            g.fillStyle = grd;
            g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill();
            g.fillStyle = c + '1)';
            g.beginPath(); g.arc(R, R, Math.max(1.6, r * 0.5), 0, Math.PI * 2); g.fill();
          } else {
            g.fillStyle = c + '0.92)';
            g.strokeStyle = 'rgba(' + surface.join(',') + ',0.95)';
            g.lineWidth = 1.4;
            g.beginPath(); g.arc(R, R, r, 0, Math.PI * 2); g.fill(); g.stroke();
          }
          out.push({ cv: cv, R: R });
        }
        this._spr = out; this._sprKey = key;
        return out;
      },
      _project: function (z) {
        if (this._projZ === z && this._px) return;
        var map = this._map, n = this._pts.length;
        var px = new Float64Array(n), py = new Float64Array(n);
        for (var i = 0; i < n; i++) {
          var p = map.project([this._pts[i].lat, this._pts[i].lng], z);
          px[i] = p.x; py[i] = p.y;
        }
        this._px = px; this._py = py; this._projZ = z;
      },
      _draw: function () {
        var map = this._map;
        if (!map || !this._c || !this._tl) return;
        this._c.style.opacity = '';
        var ctx = this._c.getContext('2d');
        var dpr = this._dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this._w, this._h);
        var z = map.getZoom();
        this._project(z);
        var r = this._radius(z);
        var spr = this._sprites(r);
        var po = map.getPixelOrigin(), tl = this._tl;
        var ox = po.x + tl.x, oy = po.y + tl.y;
        var CELL = 14, grid = {}, n = this._pts.length, w = this._w, hh = this._h;
        var rings = [], sel = null;
        for (var i = 0; i < n; i++) {
          var s = this._pts[i];
          var lvl = s.level || levelOfRsrp(s.rsrp_dbm);
          if (this._hidden[lvl]) continue;
          var x = this._px[i] - ox, y = this._py[i] - oy;
          var sp = spr[this._bk[i]];
          if (x < -sp.R || y < -sp.R || x > w + sp.R || y > hh + sp.R) continue;
          ctx.globalAlpha = s.status === 'rejected' ? 0.28 : 1;
          ctx.drawImage(sp.cv, x - sp.R, y - sp.R, sp.R * 2, sp.R * 2);
          if (s.status === 'pending') rings.push([x, y]);
          if (this._sel !== null && s.id === this._sel) sel = [x, y];
          var k = Math.floor(x / CELL) + ':' + Math.floor(y / CELL);
          (grid[k] = grid[k] || []).push(i);
        }
        ctx.globalAlpha = 1;
        var ink = cssToken('--c-text') || '#0F1F1E';
        if (rings.length) {
          ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.setLineDash([2.5, 2.5]);
          ctx.beginPath();
          rings.forEach(function (p) { ctx.moveTo(p[0] + r + 3, p[1]); ctx.arc(p[0], p[1], r + 3, 0, Math.PI * 2); });
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (sel) {
          ctx.strokeStyle = cssToken('--c-surface') || '#fff'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(sel[0], sel[1], r + 6, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(sel[0], sel[1], r + 6, 0, Math.PI * 2); ctx.stroke();
        }
        this._grid = grid; this._cell = CELL; this._r = r;
      },
      _hit: function (cp) {
        if (!this._grid || !this._map) return null;
        var lp = this._map.containerPointToLayerPoint(cp);
        var x = lp.x - this._tl.x, y = lp.y - this._tl.y;
        var cx = Math.floor(x / this._cell), cy = Math.floor(y / this._cell);
        var best = null, bd = Math.max(this._r + 5, 9);
        var po = this._map.getPixelOrigin(), ox = po.x + this._tl.x, oy = po.y + this._tl.y;
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            var list = this._grid[(cx + dx) + ':' + (cy + dy)];
            if (!list) continue;
            for (var j = 0; j < list.length; j++) {
              var i = list[j];
              var ddx = this._px[i] - ox - x, ddy = this._py[i] - oy - y;
              var d = Math.sqrt(ddx * ddx + ddy * ddy);
              if (d < bd) { bd = d; best = i; }
            }
          }
        }
        return best === null ? null : this._pts[best];
      },
      _onMove: function (e) {
        var self = this;
        if (this._moveRaf) return;
        this._moveRaf = requestAnimationFrame(function () {
          self._moveRaf = 0;
          if (!self._map) return;
          var s = self._hit(e.containerPoint);
          self._map.getContainer().classList.toggle('ad-sig-hover', !!s);
          if (s) self._showTip(s, e.containerPoint);
          else if (!self._pinned) self._tip.hidden = true;
        });
      },
      _onOut: function () { if (!this._pinned && this._tip) this._tip.hidden = true; },
      _onClick: function (e) {
        var s = this._hit(e.containerPoint);
        if (s) {
          this._pinned = true;
          this.setSelected(s.id);
          this._showTip(s, e.containerPoint);
          if (this._o.onSelect) this._o.onSelect(s);
        } else if (this._pinned) {
          this._pinned = false; this._tip.hidden = true; this.setSelected(null);
          if (this._o.onSelect) this._o.onSelect(null);
        }
      },
      /** Pin the tooltip on a sample (e.g. from the pending table). */
      focusSample: function (s) {
        if (!this._map || !s) return;
        this._pinned = true;
        this.setSelected(s.id);
        var self = this;
        setTimeout(function () {
          if (!self._map) return;
          self._showTip(s, self._map.latLngToContainerPoint([s.lat, s.lng]));
        }, 60);
      },
      _showTip: function (s, cp) {
        var tip = this._tip;
        tip.innerHTML = tipHtml(s);
        tip.hidden = false;
        var size = this._map.getSize();
        var tw = tip.offsetWidth || 200, th = tip.offsetHeight || 70;
        var x = Math.min(Math.max(8, cp.x - tw / 2), size.x - tw - 8);
        var y = cp.y - th - 16;
        if (y < 8) y = cp.y + 18;
        tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
    });
    return HeatLayer;
  }

  function tipHtml(s) {
    var lvl = s.level || levelOfRsrp(s.rsrp_dbm);
    var rsrp = s.rsrp_dbm === null || s.rsrp_dbm === undefined ? t('ad.sig.no_service') : s.rsrp_dbm + ' dBm';
    var src = s.source === 'community' ? t('ad.sig.tip_community') : t('ad.sig.tip_team');
    var st = s.status && s.status !== 'approved' ? ' · ' + t('ad.sig.st_' + s.status) : '';
    return '<div class="ad-sig-tip__top"><span class="signal-dot signal-dot--' + esc(lvl) + '"></span><strong>' + esc(rsrp) + '</strong>' +
      (s.tech && s.tech !== 'none' ? '<span class="ad-sig-tip__tech">' + esc(s.tech) + '</span>' : '') + '</div>' +
      '<div class="ad-sig-tip__row">' + esc(kit.carrierName(s.carrier)) + ' · ' + esc(t('common.sig.' + lvl)) + '</div>' +
      '<div class="ad-sig-tip__row ad-sig-tip__muted">' + esc(U.fmtDateTime(s.measured_at)) + ' · ' + esc(src) + esc(st) +
      (s.is_holdout ? ' · ' + esc(t('ad.sig.tip_holdout')) : '') + '</div>' +
      (s.device_model ? '<div class="ad-sig-tip__row ad-sig-tip__muted">' + esc(s.device_model) + '</div>' : '') +
      '<div class="ad-sig-tip__row ad-sig-tip__mono">#' + esc(s.id) + ' · ' + esc(U.fmtNumber(s.lat, 5)) + ', ' + esc(U.fmtNumber(s.lng, 5)) + '</div>';
  }

  /* ================================================================== stats helpers */

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function segKm(rows) {
    var out = { likely: 0, uncertain: 0, lost: 0, total: 0 };
    rows.forEach(function (s) {
      var d = Math.max(0, (+s.to_km) - (+s.from_km));
      if (out[s.level] !== undefined) out[s.level] += d;
      out.total += d;
    });
    return out;
  }

  /* ================================================================== page */

  var state = {
    route: null, carrier: 'viettel', status: 'all', mode: 'heat', showSeg: true, hidden: {},
    scope: 'all', sel: {}, samples: [], segments: [], accuracy: [], pending: [], loadSeq: 0, fittedRoute: null, pendLimit: 8
  };
  var el = {};
  var map = null, heat = null, segLayer = null;
  var sampleCache = {};
  var offRealtime = null;
  var mounted = false;

  var LS_KEY = 'nc.admin.sig';
  function savePrefs() { kit.lsSet(LS_KEY, { route: state.route, carrier: state.carrier, status: state.status, mode: state.mode, showSeg: state.showSeg, scope: state.scope }); }
  function loadPrefs() {
    var p = kit.lsGet(LS_KEY, null);
    if (!p) return;
    ['route', 'carrier', 'status', 'mode', 'scope'].forEach(function (k) { if (p[k]) state[k] = p[k]; });
    if (typeof p.showSeg === 'boolean') state.showSeg = p.showSeg;
  }

  function mount(section) {
    mounted = true;
    loadPrefs();
    el.root = h('div', { class: 'ad-pg ad-sig' });
    section.appendChild(el.root);

    el.refresh = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'refresh', html: icon('refresh') + '<span data-i18n="ad.sig.refresh">' + esc(t('ad.sig.refresh')) + '</span>' });
    el.root.appendChild(kit.head({ icon: 'signal', titleKey: 'ad.sig.title', subKey: 'ad.sig.subtitle', actions: [el.refresh] }));

    /* toolbar: route + carrier */
    el.routes = h('div', { class: 'chip-group chip-group--scroll ad-sig-routes', role: 'radiogroup', 'aria-label': t('ad.sig.route') });
    el.carriers = h('div', { class: 'segmented ad-sig-carriers', 'aria-label': t('ad.sig.carrier') },
      kit.carriers().map(function (c) {
        return h('button', { type: 'button', class: 'segmented__btn', 'data-value': c.id },
          h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + c.id, 'aria-hidden': 'true' }), c.name);
      }));
    el.root.appendChild(h('div', { class: 'ad-sig-toolbar' },
      h('div', { class: 'ad-sig-toolbar__group ad-sig-toolbar__routes' }, h('span', { class: 'ad-pg-label', 'data-i18n': 'ad.sig.route' }, t('ad.sig.route')), el.routes),
      h('div', { class: 'ad-sig-toolbar__group' }, h('span', { class: 'ad-pg-label', 'data-i18n': 'ad.sig.carrier' }, t('ad.sig.carrier')), el.carriers)));

    /* map card */
    el.status = h('select', { class: 'select ad-sig-status', 'aria-label': t('ad.sig.status') });
    el.mode = h('div', { class: 'segmented ad-sig-mode', 'aria-label': t('ad.sig.view') },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'heat', html: icon('sparkles') + '<span data-i18n="ad.sig.mode_heat">' + esc(t('ad.sig.mode_heat')) + '</span>' }),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'dots', html: icon('dot') + '<span data-i18n="ad.sig.mode_dots">' + esc(t('ad.sig.mode_dots')) + '</span>' }));
    el.segSwitch = h('input', { type: 'checkbox', checked: state.showSeg });
    var segLabel = h('label', { class: 'switch ad-sig-segswitch' }, el.segSwitch, h('span', { class: 'switch__track' }), h('span', { class: 'switch__label', 'data-i18n': 'ad.sig.segments' }, t('ad.sig.segments')));
    el.mapEl = h('div', { class: 'ad-sig-map', role: 'region', 'aria-label': t('ad.sig.map_title') });
    el.mapSub = h('p', { class: 'card__subtitle ad-sig-mapsub' });
    el.fit = h('button', { type: 'button', class: 'btn btn--outline btn--sm btn--icon', 'data-act': 'fit', title: t('ad.sig.fit'), 'aria-label': t('ad.sig.fit'), 'data-i18n-attr': 'title:ad.sig.fit;aria-label:ad.sig.fit', html: icon('maximize') });
    el.legend = h('div', { class: 'ad-sig-legend' });
    el.loading = h('div', { class: 'ad-sig-loading', hidden: true }, h('span', { class: 'spinner' }));
    var mapCard = h('section', { class: 'card card--pad-0 ad-sig-mapcard' },
      h('div', { class: 'ad-sig-mapcard__head' },
        h('div', { class: 'ad-sig-mapcard__title' }, h('h3', { class: 'card__title', 'data-i18n': 'ad.sig.map_title' }, t('ad.sig.map_title')), el.mapSub),
        h('div', { class: 'ad-sig-mapcard__ctl' }, el.mode, el.status, segLabel, el.fit)),
      h('div', { class: 'ad-sig-mapwrap' }, el.mapEl, el.loading, h('div', { class: 'ad-sig-mapbadge' }, NC.ui.demoBadge())),
      el.legend);

    /* side: KPIs + accuracy + carriers + histogram */
    el.kSamples = kit.kpi({ id: 'samples', icon: 'database', tone: 'primary' });
    el.kMedian = kit.kpi({ id: 'median', icon: 'signal', tone: 'info' });
    el.kLost = kit.kpi({ id: 'lost', icon: 'signal-off', tone: 'danger' });
    el.kDead = kit.kpi({ id: 'dead', icon: 'route', tone: 'warning' });
    el.accBody = h('div', { class: 'ad-sig-acc' });
    el.histBody = h('div', { class: 'ad-sig-hist' });
    el.cmpBody = h('div', { class: 'ad-sig-cmp' });
    el.techBody = h('div', { class: 'ad-sig-tech' });
    var side = h('div', { class: 'ad-sig-side' },
      h('div', { class: 'ad-pg-kpis ad-sig-kpis' }, el.kSamples, el.kMedian, el.kLost, el.kDead),
      h('section', { class: 'card ad-sig-card ad-sig-card--acc' },
        h('div', { class: 'card__header' }, h('div', null, h('h3', { class: 'card__title', 'data-i18n': 'ad.sig.acc_title' }, t('ad.sig.acc_title')))),
        el.accBody),
      h('section', { class: 'card ad-sig-card' },
        h('div', { class: 'card__header' }, h('div', null,
          h('h3', { class: 'card__title', 'data-i18n': 'ad.sig.cmp_title' }, t('ad.sig.cmp_title')),
          h('p', { class: 'card__subtitle', 'data-i18n': 'ad.sig.cmp_sub' }, t('ad.sig.cmp_sub')))),
        el.cmpBody),
      h('section', { class: 'card ad-sig-card' },
        h('div', { class: 'card__header' }, h('div', null,
          h('h3', { class: 'card__title', 'data-i18n': 'ad.sig.hist_title' }, t('ad.sig.hist_title')),
          h('p', { class: 'card__subtitle', 'data-i18n': 'ad.sig.hist_sub' }, t('ad.sig.hist_sub')))),
        el.histBody, el.techBody));
    el.root.appendChild(h('div', { class: 'ad-sig-layout' }, mapCard, side));

    /* pending review */
    el.pendCount = h('span', { class: 'badge badge--warning' }, '0');
    el.scope = h('div', { class: 'segmented ad-sig-scope' },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'route', 'data-i18n': 'ad.sig.scope_route' }, t('ad.sig.scope_route')),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'all', 'data-i18n': 'ad.sig.scope_all' }, t('ad.sig.scope_all')));
    el.selInfo = h('span', { class: 'ad-sig-bulk__info' });
    // select-all for the card/grid layouts (< 1200 px) where the table header with its checkbox is hidden
    el.selAll = h('input', { type: 'checkbox', 'data-sel': 'all', 'aria-label': t('ad.sig.select_all'), 'data-i18n-attr': 'aria-label:ad.sig.select_all' });
    el.selAllLbl = h('label', { class: 'check ad-sig-bulk__all' }, el.selAll, h('span', { 'data-i18n': 'ad.sig.select_all' }, t('ad.sig.select_all')));
    el.approve = h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-act': 'approve', disabled: true, html: icon('check') + '<span data-i18n="ad.sig.approve">' + esc(t('ad.sig.approve')) + '</span>' });
    el.reject = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'reject', disabled: true, html: icon('x') + '<span data-i18n="ad.sig.reject">' + esc(t('ad.sig.reject')) + '</span>' });
    el.pendBody = h('div', { class: 'ad-sig-pendbody' });
    el.root.appendChild(h('section', { class: 'card ad-sig-pending', id: 'ad-sig-pending' },
      h('div', { class: 'card__header' },
        h('span', { class: 'icon-tile icon-tile--warning', html: icon('users') }),
        h('div', null,
          h('h3', { class: 'card__title' }, h('span', { 'data-i18n': 'ad.sig.pend_title' }, t('ad.sig.pend_title')), ' ', el.pendCount),
          h('p', { class: 'card__subtitle', 'data-i18n': 'ad.sig.pend_sub' }, t('ad.sig.pend_sub'))),
        el.scope),
      h('div', { class: 'ad-sig-bulk' }, h('div', { class: 'ad-sig-bulk__left' }, el.selAllLbl, el.selInfo), h('div', { class: 'cluster' }, el.reject, el.approve)),
      el.pendBody));

    el.root.appendChild(h('p', { class: 'ad-pg-foot', 'data-i18n': 'ad.sig.demo_note' }, t('ad.sig.demo_note')));

    wire();
    fillStatus();
    el.carrierSeg = NC.ui.segmented(el.carriers, { value: state.carrier, onChange: function (v) { state.carrier = v; savePrefs(); loadMain(); } });
    NC.ui.segmented(el.mode, { value: state.mode, onChange: function (v) { state.mode = v; savePrefs(); if (heat) heat.setMode(v); } });
    NC.ui.segmented(el.scope, { value: state.scope, onChange: function (v) { state.scope = v; savePrefs(); renderPending(); } });

    NC.bus.on('i18n:change', function () {
      NC.i18n.apply(el.root);
      fillStatus();
      renderRoutes();
      renderAll();
      renderPending();
    });
  }

  function fillStatus() {
    el.status.innerHTML = '';
    ['all', 'approved', 'pending', 'rejected'].forEach(function (s) {
      el.status.appendChild(h('option', { value: s, selected: s === state.status }, t('ad.sig.st_' + s)));
    });
    el.status.value = state.status;
  }

  function wire() {
    el.root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || !el.root.contains(b)) return;
      var act = b.getAttribute('data-act');
      if (act === 'refresh') { sampleCache = {}; kit.dropPackCache(); loadMain(true); loadPending(); }
      else if (act === 'fit') fitRoute();
      else if (act === 'route') { state.route = b.getAttribute('data-value'); savePrefs(); renderRoutes(); loadMain(); if (state.scope === 'route') renderPending(); }
      else if (act === 'level') {
        var lv = b.getAttribute('data-level');
        state.hidden[lv] = !state.hidden[lv];
        b.setAttribute('aria-pressed', state.hidden[lv] ? 'false' : 'true');
        if (heat) heat.setHidden(state.hidden);
      }
      else if (act === 'approve') review('approved');
      else if (act === 'reject') review('rejected');
      else if (act === 'locate') locate(+b.getAttribute('data-id'));
      else if (act === 'more') { state.pendLimit += 16; renderPending(); }
    });
    el.root.addEventListener('change', function (e) {
      var tg = e.target;
      if (tg === el.status) { state.status = tg.value; savePrefs(); applySamples(); }
      else if (tg === el.segSwitch) { state.showSeg = tg.checked; savePrefs(); drawSegments(); }
      else if (tg.getAttribute('data-sel') === 'all') {
        visiblePending().slice(0, state.pendLimit).forEach(function (s) { if (tg.checked) state.sel[s.id] = true; else delete state.sel[s.id]; });
        renderPending();
      } else if (tg.hasAttribute('data-sel')) {
        var id = +tg.getAttribute('data-sel');
        if (tg.checked) state.sel[id] = true; else delete state.sel[id];
        syncBulk();
        var row = tg.closest('tr');
        if (row) row.classList.toggle('is-selected', tg.checked);
      }
    });
  }

  function renderRoutes() {
    var list = kit.routeList();
    el.routes.innerHTML = '';
    list.forEach(function (r) {
      var on = r.id === state.route;
      el.routes.appendChild(h('button', {
        type: 'button', class: 'chip' + (on ? ' is-selected' : ''), 'data-act': 'route', 'data-value': r.id,
        role: 'radio', 'aria-checked': on ? 'true' : 'false', title: kit.routeName(r.id), html: icon(r.travel_mode === 'hiking' ? 'footprints' : 'bike') + '<span>' + esc(kit.routeShort(r.id)) + '</span>'
      }));
    });
  }

  function ensureMap() {
    if (map) return;
    map = NC.mapkit.create(el.mapEl, { zoom: 9, scrollWheelZoom: true });
    heat = new (heatClass())({ onSelect: function (s) { markRow(s ? s.id : null); } });
    heat.setMode(state.mode);
    heat.setHidden(state.hidden);
    heat.addTo(map);
    if (U.qs().debug) kit._sig = { map: map, heat: heat }; // test hook (?debug=1)
  }

  function fitRoute() {
    var r = kit.routeById(state.route);
    if (map && r && r.bbox) NC.mapkit.fitTo(map, r.bbox, { padding: [24, 24] });
  }

  /* ------------------------------------------------------------ data */

  function loadMain(force) {
    if (!state.route) return Promise.resolve();
    var seq = ++state.loadSeq;
    var key = state.route + ':' + state.carrier;
    el.loading.hidden = false;
    var samplesP = (!force && sampleCache[key]) ? Promise.resolve(sampleCache[key]) :
      NC.data.admin.listSamples({ route_id: state.route, carrier: state.carrier, limit: 20000 }).then(function (rows) { sampleCache[key] = rows; return rows; });
    return Promise.all([
      samplesP,
      NC.data.admin.listSegments({ route_id: state.route }),
      NC.data.admin.listAccuracy(),
      kit.pack(state.route, state.carrier).catch(function () { return null; })
    ]).then(function (r) {
      if (seq !== state.loadSeq) return;
      state.samples = r[0] || [];
      state.segments = r[1] || [];
      state.accuracy = r[2] || [];
      state.pack = r[3];
      el.loading.hidden = true;
      ensureMap();
      NC.mapkit.refresh(map);
      if (state.fittedRoute !== state.route) { state.fittedRoute = state.route; setTimeout(fitRoute, 30); }
      applySamples();
      drawSegments();
      renderAll();
      kit.setHash('signal', { route: state.route, carrier: state.carrier });
    }).catch(function (e) {
      if (seq !== state.loadSeq) return;
      el.loading.hidden = true;
      kit.toastErr(e);
    });
  }

  function filteredSamples() {
    var st = state.status;
    return state.samples.filter(function (s) { return st === 'all' || s.status === st; });
  }

  function applySamples() {
    if (!heat) return;
    var rows = filteredSamples();
    heat.setData(rows);
    el.mapSub.textContent = t('ad.sig.map_sub', { route: kit.routeName(state.route), carrier: kit.carrierName(state.carrier), n: U.fmtNumber(rows.length) });
  }

  function drawSegments() {
    if (!map) return;
    if (segLayer) { map.removeLayer(segLayer); segLayer = null; }
    if (!state.showSeg || !state.pack || !state.pack.edges) return;
    var segs = state.segments.filter(function (s) { return s.carrier === state.carrier; });
    var pseudo = Object.assign({}, state.pack, { segments: segs.length ? segs : state.pack.segments, facilities: [], services: [] });
    try {
      var graph = NC.routing.buildGraph([pseudo]);
      segLayer = NC.mapkit.drawEdges(map, graph, { weight: 4, casing: true });
    } catch (e) { console.warn('[signal] segments overlay', e); }
  }

  /* ------------------------------------------------------------ render */

  function renderAll() {
    renderKpis();
    renderLegend();
    renderAccuracy();
    renderCompare();
    renderHist();
  }

  function renderKpis() {
    var all = state.samples;
    var approved = all.filter(function (s) { return s.status === 'approved'; });
    var pending = all.filter(function (s) { return s.status === 'pending'; }).length;
    kit.setKpi(el.kSamples, U.fmtNumber(all.length), t('ad.sig.kpi_samples_sub', { approved: U.fmtNumber(approved.length), pending: U.fmtNumber(pending) }));
    el.kSamples.querySelector('.ad-pg-kpi__label').textContent = t('ad.sig.kpi_samples');
    var vals = approved.map(function (s) { return s.rsrp_dbm; }).filter(function (v) { return v !== null && v !== undefined && isFinite(v); }).sort(function (a, b) { return a - b; });
    var med = quantile(vals, 0.5), p10 = quantile(vals, 0.1);
    el.kMedian.querySelector('.ad-pg-kpi__label').textContent = t('ad.sig.kpi_median');
    kit.setKpi(el.kMedian, med === null ? '–' : Math.round(med) + ' dBm', p10 === null ? '' : t('ad.sig.kpi_median_sub', { p10: Math.round(p10) }));
    var lost = approved.filter(function (s) { return (s.level || levelOfRsrp(s.rsrp_dbm)) === 'lost'; }).length;
    el.kLost.querySelector('.ad-pg-kpi__label').textContent = t('ad.sig.kpi_lost');
    kit.setKpi(el.kLost, approved.length ? kit.pct(lost / approved.length, 0) : '–', t('ad.sig.kpi_lost_sub'));
    var km = segKm(state.segments.filter(function (s) { return s.carrier === state.carrier; }));
    el.kDead.querySelector('.ad-pg-kpi__label').textContent = t('ad.sig.kpi_dead');
    kit.setKpi(el.kDead, U.fmtKm(km.lost), t('ad.sig.kpi_dead_sub', { total: U.fmtKm(km.total) }));
  }

  function accFor(route, carrier) {
    return state.accuracy.filter(function (a) { return a.route_id === route && a.carrier === carrier; })[0] || null;
  }

  function renderLegend() {
    var counts = { likely: 0, uncertain: 0, lost: 0 };
    filteredSamples().forEach(function (s) { var l = s.level || levelOfRsrp(s.rsrp_dbm); counts[l] = (counts[l] || 0) + 1; });
    el.legend.innerHTML = '';
    var scale = h('div', { class: 'ad-sig-legend__scale' },
      h('span', { class: 'ad-sig-legend__label', 'data-i18n': 'ad.sig.legend_rsrp' }, t('ad.sig.legend_rsrp')),
      h('div', { class: 'ad-sig-legend__barwrap' },
        h('span', { class: 'ad-sig-legend__bar', 'aria-hidden': 'true' }),
        h('div', { class: 'ad-sig-legend__ticks' }, h('span', null, '−125'), h('span', null, '−115'), h('span', null, '−105'), h('span', null, '−95'))));
    var chips = h('div', { class: 'ad-sig-legend__levels', role: 'group', 'aria-label': t('ad.sig.legend_hint'), title: t('ad.sig.legend_hint') },
      LEVELS.map(function (lv) {
        return h('button', {
          type: 'button', class: 'ad-sig-lvl ad-sig-lvl--' + lv, 'data-act': 'level', 'data-level': lv,
          'aria-pressed': state.hidden[lv] ? 'false' : 'true'
        }, h('span', { class: 'signal-dot signal-dot--' + lv, 'aria-hidden': 'true' }), h('span', null, t('common.sig.' + lv)), h('b', null, U.fmtNumber(counts[lv] || 0)));
      }));
    var notes = h('div', { class: 'ad-sig-legend__notes' },
      h('span', null, h('i', { class: 'ad-sig-legend__ring', 'aria-hidden': 'true' }), t('ad.sig.legend_pending')),
      h('span', null, h('i', { class: 'ad-sig-legend__line', 'aria-hidden': 'true' }), t('ad.sig.legend_line')));
    el.legend.appendChild(scale);
    el.legend.appendChild(chips);
    el.legend.appendChild(notes);
  }

  function renderAccuracy() {
    var acc = accFor(state.route, state.carrier);
    el.accBody.innerHTML = '';
    if (!acc) { el.accBody.appendChild(h('p', { class: 'muted small' }, t('ad.sig.acc_none'))); return; }
    var v = +acc.accuracy;
    var tone = v >= 0.9 ? 'success' : v >= 0.8 ? 'primary' : 'warning';
    var ring = NC.viz.ring(v, { size: 104, stroke: 11, label: kit.pct(v, 1), sublabel: 'held-out', tone: tone });
    el.accBody.appendChild(h('div', { class: 'ad-sig-acc__top' },
      h('div', { class: 'ad-sig-acc__ring' }, ring),
      h('div', { class: 'ad-sig-acc__text' },
        h('p', { class: 'ad-sig-acc__body' }, t('ad.sig.acc_body', { n: acc.holdout_n })),
        h('p', { class: 'ad-sig-acc__model', html: icon('sliders', 'icon--xs') + '<span>' + esc(t('ad.sig.acc_model', { model: acc.model_version || '–', at: U.fmtDateTime(acc.computed_at) })) + '</span>' }))));
  }

  function renderCompare() {
    el.cmpBody.innerHTML = '';
    kit.carriers().forEach(function (c) {
      var km = segKm(state.segments.filter(function (s) { return s.carrier === c.id; }));
      var acc = accFor(state.route, c.id);
      var tot = km.total || 1;
      var row = h('button', { type: 'button', class: 'ad-sig-cmp__row' + (c.id === state.carrier ? ' is-current' : ''), 'data-carrier': c.id, 'aria-pressed': c.id === state.carrier ? 'true' : 'false' },
        h('span', { class: 'ad-sig-cmp__name' }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + c.id, 'aria-hidden': 'true' }), c.name),
        h('span', { class: 'ad-sig-stack', role: 'img', 'aria-label': c.name + ': ' + LEVELS.map(function (l) { return t('common.sig.' + l) + ' ' + U.fmtKm(km[l]); }).join('; ') },
          LEVELS.map(function (l) {
            var w = km[l] / tot * 100;
            return w > 0 ? h('span', { class: 'ad-sig-stack__seg ad-sig-stack__seg--' + l, style: { width: w.toFixed(2) + '%' }, title: t('common.sig.' + l) + ': ' + U.fmtKm(km[l]) }) : null;
          })),
        h('span', { class: 'ad-sig-cmp__vals' },
          h('b', { class: 'ad-sig-cmp__lost' }, U.fmtKm(km.lost)),
          h('small', null, acc ? kit.pct(+acc.accuracy, 0) : '–')));
      el.cmpBody.appendChild(row);
    });
    if (!el.cmpBody._wired) {
      el.cmpBody._wired = true;
      el.cmpBody.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-carrier]') : null;
        if (!b) return;
        var c = b.getAttribute('data-carrier');
        if (c === state.carrier) return;
        state.carrier = c; savePrefs();
        el.carrierSeg.set(c);
        loadMain();
      });
    }
    el.cmpBody.appendChild(h('div', { class: 'ad-sig-cmp__keys' },
      LEVELS.map(function (l) { return h('span', null, h('span', { class: 'signal-dot signal-dot--' + l }), t('common.sig.' + l)); }),
      h('span', { class: 'ad-sig-cmp__keyr' }, 'km ' + t('common.sig.lost').toLowerCase() + ' · acc')));
  }

  function renderHist() {
    var rows = state.samples.filter(function (s) { return s.status !== 'rejected'; });
    var bins = [], i;
    var LO = -130, HI = -60, STEP = 5;
    for (i = LO; i < HI; i += STEP) bins.push({ from: i, n: 0 });
    var none = 0, max = 1;
    var tech = {};
    rows.forEach(function (s) {
      tech[s.tech || 'none'] = (tech[s.tech || 'none'] || 0) + 1;
      if (s.rsrp_dbm === null || s.rsrp_dbm === undefined || !isFinite(s.rsrp_dbm)) { none++; return; }
      var k = Math.min(bins.length - 1, Math.max(0, Math.floor((s.rsrp_dbm - LO) / STEP)));
      bins[k].n++;
    });
    bins.forEach(function (b) { max = Math.max(max, b.n); });
    max = Math.max(max, none);
    var W = 320, H = 132, padB = 22, padT = 8, n = bins.length + 1, gap = 3;
    var bw = (W - gap * (n - 1)) / n;
    var svg = h('svg', { class: 'ad-sig-hist__svg', viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': t('ad.sig.hist_title') });
    var ch = H - padB - padT;
    function x(idx) { return idx * (bw + gap); }
    bins.forEach(function (b, idx) {
      var lv = levelOfRsrp(b.from + STEP / 2);
      var hh = b.n ? Math.max(2, b.n / max * ch) : 0;
      svg.appendChild(h('rect', { class: 'ad-sig-hist__bar ad-sig-hist__bar--' + lv, x: x(idx).toFixed(1), y: (padT + ch - hh).toFixed(1), width: bw.toFixed(1), height: hh.toFixed(1), rx: 2.5 },
        h('title', null, b.from + '…' + (b.from + STEP) + ' dBm: ' + b.n)));
    });
    var nh = none ? Math.max(2, none / max * ch) : 0;
    svg.appendChild(h('rect', { class: 'ad-sig-hist__bar ad-sig-hist__bar--none', x: x(bins.length).toFixed(1), y: (padT + ch - nh).toFixed(1), width: bw.toFixed(1), height: nh.toFixed(1), rx: 2.5 },
      h('title', null, t('ad.sig.no_service') + ': ' + none)));
    svg.appendChild(h('line', { class: 'ad-sig-hist__axis', x1: 0, x2: W, y1: padT + ch + 0.5, y2: padT + ch + 0.5 }));
    [-115, -105].forEach(function (thr) {
      var xx = ((thr - LO) / STEP) * (bw + gap) - gap / 2;
      svg.appendChild(h('line', { class: 'ad-sig-hist__thr', x1: xx, x2: xx, y1: padT - 4, y2: padT + ch }));
    });
    [-130, -110, -90, -70].forEach(function (tick) {
      var xx = ((tick - LO) / STEP) * (bw + gap);
      svg.appendChild(h('text', { class: 'ad-sig-hist__tick', x: xx, y: H - 6, 'text-anchor': tick === -130 ? 'start' : 'middle' }, String(tick).replace('-', '−')));
    });
    svg.appendChild(h('text', { class: 'ad-sig-hist__tick', x: x(bins.length) + bw / 2, y: H - 6, 'text-anchor': 'middle' }, t('ad.sig.hist_none')));
    el.histBody.innerHTML = '';
    el.histBody.appendChild(svg);

    el.techBody.innerHTML = '';
    var total = rows.length || 1;
    var order = ['5G', '4G', '3G', '2G', 'none'];
    el.techBody.appendChild(h('p', { class: 'ad-sig-tech__title', 'data-i18n': 'ad.sig.tech_title' }, t('ad.sig.tech_title')));
    el.techBody.appendChild(h('div', { class: 'chip-group' }, order.filter(function (k) { return tech[k]; }).map(function (k) {
      return h('span', { class: 'badge ' + (k === 'none' ? 'badge--danger' : k === '4G' || k === '5G' ? 'badge--primary' : 'badge--neutral') },
        (k === 'none' ? t('ad.sig.no_service') : k) + ' · ' + kit.pct(tech[k] / total, 0));
    })));
  }

  /* ------------------------------------------------------------ pending review */

  function loadPending() {
    return NC.data.admin.listSamples({ status: 'pending', limit: 5000 }).then(function (rows) {
      state.pending = rows || [];
      var ids = {};
      state.pending.forEach(function (s) { ids[s.id] = true; });
      Object.keys(state.sel).forEach(function (k) { if (!ids[k]) delete state.sel[k]; });
      renderPending();
      kit.refreshBadges();
    }).catch(kit.toastErr);
  }

  function visiblePending() {
    return state.pending.filter(function (s) { return state.scope === 'all' || s.route_id === state.route; });
  }

  function renderPending() {
    var all = visiblePending();
    var rows = all.slice(0, state.pendLimit);
    el.pendCount.textContent = U.fmtNumber(state.pending.length);
    el.pendBody.innerHTML = '';
    if (!rows.length) {
      el.pendBody.appendChild(NC.ui.emptyState({ icon: 'check-circle', variant: 'success', title: t('ad.sig.pend_empty'), text: t('ad.sig.pend_empty_t'), compact: true }));
      syncBulk();
      return;
    }
    var allOn = rows.every(function (s) { return state.sel[s.id]; });
    var table = h('table', { class: 'table ad-sig-ptable' },
      h('thead', null, h('tr', null,
        h('th', { class: 'ad-sig-ptable__chk' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-sel': 'all', checked: allOn, 'aria-label': t('ad.sig.select_all') }))),
        h('th', null, t('ad.sig.col_time')), h('th', null, t('ad.sig.col_route')), h('th', null, t('ad.sig.col_carrier')),
        h('th', { class: 'num' }, t('ad.sig.col_rsrp')), h('th', null, t('ad.sig.col_level')), h('th', null, t('ad.sig.col_device')), h('th', null, h('span', { class: 'visually-hidden' }, t('ad.sig.locate'))))),
      h('tbody', null, rows.map(function (s) {
        var lv = s.level || levelOfRsrp(s.rsrp_dbm);
        var on = !!state.sel[s.id];
        return h('tr', { class: on ? 'is-selected' : null, 'data-id': s.id },
          h('td', { class: 'ad-sig-ptable__chk', 'data-label': t('ad.sig.select') }, h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-sel': s.id, checked: on, 'aria-label': t('ad.sig.select_row', { id: s.id }) }))),
          h('td', { 'data-label': t('ad.sig.col_time'), class: 'nowrap ad-sig-ptable__time' }, U.fmtDateTime(s.measured_at)),
          h('td', { 'data-label': t('ad.sig.col_route'), class: 'ad-sig-ptable__rt' }, h('span', { class: 'truncate ad-sig-ptable__route', title: kit.routeName(s.route_id) }, kit.routeShort(s.route_id))),
          h('td', { 'data-label': t('ad.sig.col_carrier'), class: 'ad-sig-ptable__car' }, h('span', { class: 'ad-sig-cname' }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + s.carrier }), kit.carrierName(s.carrier))),
          h('td', { 'data-label': t('ad.sig.col_rsrp'), class: 'num mono ad-sig-ptable__rsrp' }, s.rsrp_dbm === null || s.rsrp_dbm === undefined ? t('ad.sig.no_service') : s.rsrp_dbm + ' dBm' + (s.tech && s.tech !== 'none' ? ' · ' + s.tech : '')),
          h('td', { 'data-label': t('ad.sig.col_level'), class: 'ad-sig-ptable__lv' }, NC.ui.signalBadge(lv)),
          h('td', { 'data-label': t('ad.sig.col_device'), class: 'ad-sig-ptable__dev' }, s.device_model || '–'),
          h('td', { class: 'ad-sig-ptable__act' }, h('button', {
            type: 'button', class: 'btn btn--ghost btn--sm', 'data-act': 'locate', 'data-id': s.id, title: t('ad.sig.locate'), 'aria-label': t('ad.sig.locate') + ' #' + s.id,
            html: icon('crosshair') + '<span class="ad-sig-ptable__actlbl">' + esc(t('ad.sig.locate')) + '</span>'
          })));
      })));
    el.pendBody.appendChild(h('div', { class: 'table-wrap' }, table));
    if (all.length > rows.length) {
      el.pendBody.appendChild(h('div', { class: 'ad-sig-more' }, h('button', {
        type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'more',
        html: icon('chevron-down') + '<span>' + esc(t('ad.sig.more', { n: all.length - rows.length })) + '</span>'
      })));
    }
    syncBulk();
  }

  function selectedIds() {
    var vis = {};
    visiblePending().forEach(function (s) { vis[s.id] = true; });
    return Object.keys(state.sel).filter(function (k) { return vis[k]; }).map(Number);
  }

  function syncBulk() {
    var n = selectedIds().length;
    if (el.selAll) {
      var vis = visiblePending().slice(0, state.pendLimit);
      el.selAll.disabled = !vis.length;
      el.selAll.checked = vis.length > 0 && vis.every(function (s) { return state.sel[s.id]; });
    }
    el.selInfo.textContent = n ? t('ad.sig.selected', { n: n }) : t('ad.sig.bulk_hint');
    el.selInfo.classList.toggle('is-active', n > 0);
    el.approve.disabled = !n;
    el.reject.disabled = !n;
  }

  function review(status) {
    var ids = selectedIds();
    if (!ids.length) return;
    var go = status === 'rejected'
      ? NC.ui.confirm({ title: t('ad.sig.reject_t', { n: ids.length }), message: t('ad.sig.reject_m'), confirmLabel: t('ad.sig.reject'), danger: true })
      : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      var btn = status === 'approved' ? el.approve : el.reject;
      NC.ui.setLoading(btn, true);
      return NC.data.admin.reviewSamples(ids, status).then(function (n) {
        NC.ui.setLoading(btn, false);
        ids.forEach(function (id) { delete state.sel[id]; });
        if (status === 'approved') {
          NC.ui.toast(t('ad.sig.approved_n', { n: n }), { type: 'success', timeout: 7000, action: { label: t('ad.sig.open_packs'), onClick: function () { if (NC.admin && NC.admin.go) NC.admin.go('packs'); } } });
        } else {
          NC.ui.toast(t('ad.sig.rejected_n', { n: n }), { type: 'info' });
        }
        sampleCache = {};
        return Promise.all([loadPending(), loadMain(true)]);
      }, function (e) { NC.ui.setLoading(btn, false); kit.toastErr(e); });
    });
  }

  function markRow(id) {
    U.$$('tr[data-id]', el.pendBody).forEach(function (tr) { tr.classList.toggle('is-focus', +tr.getAttribute('data-id') === id); });
  }

  function locate(id) {
    var s = state.pending.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var jobs = [];
    var changed = s.route_id !== state.route || s.carrier !== state.carrier;
    if (s.status && state.status !== 'all' && state.status !== s.status) { state.status = 'all'; el.status.value = 'all'; }
    if (changed) {
      state.route = s.route_id; state.carrier = s.carrier; savePrefs();
      renderRoutes();
      el.carrierSeg.set(s.carrier);
      state.fittedRoute = s.route_id; // keep the zoom on the sample
      jobs.push(loadMain());
    } else {
      applySamples();
    }
    Promise.all(jobs).then(function () {
      if (!map) return;
      el.mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      map.setView([s.lat, s.lng], Math.max(map.getZoom(), 13), { animate: false });
      setTimeout(function () { var hit = heat.sampleById(s.id) || s; heat.focusSample(hit); markRow(s.id); }, 120);
    });
  }

  /* ------------------------------------------------------------ lifecycle */

  function show(params) {
    params = params || {};
    kit.routes().then(function (list) {
      if (params.route && kit.routeById(params.route)) state.route = params.route;
      if (params.carrier && kit.carriers().some(function (c) { return c.id === params.carrier; })) state.carrier = params.carrier;
      if (!state.route || !kit.routeById(state.route)) state.route = (list[0] && list[0].id) || null;
      el.carrierSeg.set(state.carrier);
      renderRoutes();
      loadMain();
      loadPending();
      if (map) NC.mapkit.refresh(map);
    });
    if (!offRealtime) {
      offRealtime = kit.subscribe(['signal_samples', 'signal_segments', 'route_accuracy'], function (batch) {
        var fresh = batch.some(function (m) { return m.table === 'signal_samples' && m.type === 'INSERT' && m.row && m.row.status === 'pending'; });
        sampleCache = {};
        if (batch.some(function (m) { return m.table === '*'; })) kit.dropPackCache();
        loadPending();
        loadMain(true);
        if (fresh) NC.ui.toast(t('ad.sig.live_new'), { type: 'info' });
      }, 700);
    }
  }

  function hide() {
    if (offRealtime) { offRealtime(); offRealtime = null; }
  }

  kit.register('signal', {
    titleKey: 'ad.sig.nav',
    shortKey: 'ad.sig.nav_short',
    icon: 'signal',
    order: 40,
    group: 'data',
    mount: mount,
    show: show,
    hide: hide,
    /** Nav badge: community samples awaiting review. */
    badge: function () {
      return NC.data.admin.listSamples({ status: 'pending', limit: 5000 }).then(function (r) { return r && r.length ? { count: r.length, tone: 'warning' } : null; }, function () { return null; });
    }
  });
})(window.NC = window.NC || {});
