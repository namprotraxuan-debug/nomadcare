/*
 * overview.js — Admin "Tổng quan" page (owner: P2 admin-core). Registers NC.admin page 'overview'.
 * KPI tiles (verified x/216 ring, pending, stale > 90 days, Buddy active, OVERDUE red pulse, signal samples), hero with
 * to-do shortcuts, map of the 3 pilot routes (per-route signal layer + verified facilities + live Buddy positions),
 * live activity feed (initial audit/check-in history + realtime NC.admin.live), per-route cards (stacked facility bar vs
 * the 72/route target, accuracy per carrier, current packs), facility mix donut and current-pack matrix.
 * No public API beyond the registration.
 */
(function (NC) {
  'use strict';

  var U = NC.util, h = U.h, $$ = U.$$;
  var A = NC.admin;
  function t(k, v) { return NC.i18n.t(k, v); }
  function icon(n, c) { return NC.ui.icon(n, c); }
  function num(n) { return U.fmtNumber(n || 0); }
  var TARGET_PER_ROUTE = 72;

  NC.i18n.add({
    vi: {
      'ad.ov.title': 'Tổng quan', 'ad.ov.nav': 'Tổng quan',
      'ad.ov.hello': 'Xin chào, {name}',
      'ad.ov.hero_title': 'Bảng điều khiển vận hành',
      'ad.ov.hero_text': '3 cung đường thí điểm · 3 nhà mạng · {facs} điểm y tế · {samples} mẫu sóng',
      'ad.ov.todo': 'Việc cần làm',
      'ad.ov.todo_subs': 'Duyệt {n} đóng góp',
      'ad.ov.todo_overdue': '{n} phiên quá hạn',
      'ad.ov.todo_stale': '{n} điểm cần tái xác thực',
      'ad.ov.todo_pending': '{n} điểm chờ xác thực',
      'ad.ov.todo_clear': 'Không có việc tồn đọng',
      'ad.ov.updated': 'Cập nhật {time}',
      'ad.ov.k_verified': 'Điểm y tế đã xác thực', 'ad.ov.k_verified_meta': 'Chỉ tiêu 216 = 3 cung × 72 điểm (mục 8.1)',
      'ad.ov.k_pending': 'Chờ xác thực', 'ad.ov.k_pending_meta': '+ {n} đóng góp cộng đồng chờ duyệt',
      'ad.ov.k_stale': 'Quá hạn tái xác thực', 'ad.ov.k_stale_meta': '> 90 ngày · vẫn hiển thị kèm ngày xác thực',
      'ad.ov.k_active': 'Buddy đang theo dõi', 'ad.ov.k_active_meta': '{n} phiên kết thúc trong 24 giờ',
      'ad.ov.k_overdue': 'Quá hạn check-in', 'ad.ov.k_overdue_meta': '{o} quá hạn · {a} đã gửi cảnh báo',
      'ad.ov.k_overdue_ok': 'Không có phiên quá hạn',
      'ad.ov.k_samples': 'Mẫu sóng đã thu', 'ad.ov.k_samples_meta': '{n} mẫu cộng đồng chờ duyệt',
      'ad.ov.map_title': 'Bản đồ cung đường thí điểm',
      'ad.ov.map_sub_all': 'Vị trí gần nhất của các phiên Buddy đang mở',
      'ad.ov.map_sub_route': 'Lớp sóng {carrier} · điểm y tế đã xác thực · Buddy',
      'ad.ov.map_all': 'Tất cả',
      'ad.ov.map_carrier': 'Nhà mạng hiển thị',
      'ad.ov.lg_route': 'Cung đường', 'ad.ov.lg_facility': 'Điểm y tế', 'ad.ov.lg_buddy': 'Buddy', 'ad.ov.lg_overdue': 'Quá hạn · SOS',
      'ad.ov.feed_title': 'Hoạt động trực tiếp', 'ad.ov.feed_sub': 'Cập nhật ngay khi máy chủ thay đổi',
      'ad.ov.feed_empty': 'Chưa có hoạt động nào',
      'ad.ov.routes_title': 'Theo từng cung đường',
      'ad.ov.routes_sub': 'Tiến độ xác thực so với chỉ tiêu 72 điểm/cung và độ tin cậy lớp sóng (held-out) theo nhà mạng.',
      'ad.ov.r_verified': '{v}/{target} đã xác thực',
      'ad.ov.r_fresh': 'Còn hạn', 'ad.ov.r_stale': 'Quá hạn', 'ad.ov.r_pending': 'Chờ',
      'ad.ov.r_accuracy': 'Độ tin cậy lớp sóng', 'ad.ov.r_samples': '{n} mẫu', 'ad.ov.r_pack': 'v{v} · {date}',
      'ad.ov.r_nopack': 'chưa phát hành', 'ad.ov.r_show_map': 'Xem trên bản đồ', 'ad.ov.r_packs': 'Gói hiện hành',
      'ad.ov.mix_title': 'Cơ cấu điểm y tế đã xác thực', 'ad.ov.mix_sub': 'Sắp xếp cho người dùng chỉ theo khoảng cách và năng lực — không bao giờ theo tài trợ.',
      'ad.ov.mix_trauma': 'Xử lý chấn thương chảy máu', 'ad.ov.mix_night': 'Trực đêm', 'ad.ov.mix_total': 'đã xác thực',
      'ad.ov.packs_title': 'Gói dữ liệu đang phát hành', 'ad.ov.packs_sub': 'Phiên bản hiện hành theo cung × nhà mạng',
      'ad.ov.packs_open': 'Quản lý gói',
      'ad.ov.ev.start': '{name} bắt đầu phiên Buddy', 'ad.ov.ev.checkin': '{name} check-in “Tôi ổn”', 'ad.ov.ev.location': '{name} gửi vị trí',
      'ad.ov.ev.pre_deadzone': '{name} báo sắp vào vùng mất sóng', 'ad.ov.ev.sos': '{name} gửi SOS', 'ad.ov.ev.overdue': '{name} quá hạn check-in',
      'ad.ov.ev.alert_sent': 'Đã gửi email cảnh báo về {name} tới người nhận', 'ad.ov.ev.alert_failed': 'Gửi cảnh báo về {name} thất bại',
      'ad.ov.ev.stop': '{name} kết thúc phiên', 'ad.ov.ev.resolved': '{name} được xác nhận an toàn',
      'ad.ov.ev.queued': 'gửi bù sau khi có sóng',
      'ad.ov.f.session_new': 'Phiên Buddy mới: {name}',
      'ad.ov.f.session_status': '{name} → {status}',
      'ad.ov.f.sub_new': 'Đóng góp cộng đồng mới: {what}',
      'ad.ov.f.sub_status': 'Đóng góp {id} → {status}',
      'ad.ov.f.fac_new': 'Thêm điểm y tế {name}',
      'ad.ov.f.fac_status': '{name} → {status}',
      'ad.ov.f.fac_update': 'Cập nhật điểm y tế {name}',
      'ad.ov.f.fac_delete': 'Xoá điểm y tế {name}',
      'ad.ov.f.samples': '+{n} mẫu sóng {carrier}',
      'ad.ov.f.samples_review': '{n} mẫu sóng → {status}',
      'ad.ov.f.pack': 'Phát hành gói {route} · {carrier} v{v}',
      'ad.ov.f.content': 'Nội dung y tế {v} → {status}',
      'ad.ov.f.import': 'Nhập mẫu sóng đo thực địa · {route}',
      'ad.ov.f.service': 'Cập nhật dịch vụ {name}',
      'ad.ov.f.reset': 'Dữ liệu demo đã được đặt lại',
      'ad.ov.f.generic': '{action} · {entity}',
      'ad.ov.kind.new': 'điểm mới', 'ad.ov.kind.correction': 'đề xuất sửa', 'ad.ov.kind.closed': 'báo đóng cửa', 'ad.ov.kind.signal_report': 'báo cáo sóng',
      'ad.ov.traveler': 'Người dùng',
      'ad.ov.todo_sos': '{n} SOS cần hỗ trợ ngay',
      'ad.ov.k_overdue_sos': 'SOS · Quá hạn',
      'ad.ov.k_overdue_meta_sos': '{s} SOS · {o} quá hạn · {a} đã gửi cảnh báo',
      'ad.ov.st_sos': 'SOS',
      'ad.ov.st_sos_alerted': 'SOS · đã gửi cảnh báo',
      'ad.ov.ev.alert_sent_sos': 'Đã gửi email báo SOS về {name} tới người nhận',
      'ad.ov.ev.all_clear': 'Đã gửi email báo an toàn về {name} tới người nhận'
    },
    en: {
      'ad.ov.title': 'Overview', 'ad.ov.nav': 'Overview',
      'ad.ov.hello': 'Hello, {name}',
      'ad.ov.hero_title': 'Operations dashboard',
      'ad.ov.hero_text': '3 pilot routes · 3 carriers · {facs} medical facilities · {samples} signal samples',
      'ad.ov.todo': 'To do',
      'ad.ov.todo_subs': 'Review {n} contributions',
      'ad.ov.todo_overdue': '{n} overdue sessions',
      'ad.ov.todo_stale': '{n} facilities to re-verify',
      'ad.ov.todo_pending': '{n} facilities to verify',
      'ad.ov.todo_clear': 'Nothing pending',
      'ad.ov.updated': 'Updated {time}',
      'ad.ov.k_verified': 'Verified facilities', 'ad.ov.k_verified_meta': 'Target 216 = 3 routes × 72 (section 8.1)',
      'ad.ov.k_pending': 'Awaiting verification', 'ad.ov.k_pending_meta': '+ {n} community contributions to review',
      'ad.ov.k_stale': 'Re-verification due', 'ad.ov.k_stale_meta': '> 90 days · still shown with its date',
      'ad.ov.k_active': 'Buddy sessions live', 'ad.ov.k_active_meta': 'Closed in the last 24 h: {n}',
      'ad.ov.k_overdue': 'Overdue check-ins', 'ad.ov.k_overdue_meta': '{o} overdue · {a} alert sent',
      'ad.ov.k_overdue_ok': 'No overdue session',
      'ad.ov.k_samples': 'Signal samples', 'ad.ov.k_samples_meta': '{n} community samples to review',
      'ad.ov.map_title': 'Pilot route map',
      'ad.ov.map_sub_all': 'Latest position of every open Buddy session',
      'ad.ov.map_sub_route': '{carrier} signal layer · verified facilities · Buddy',
      'ad.ov.map_all': 'All',
      'ad.ov.map_carrier': 'Carrier shown',
      'ad.ov.lg_route': 'Route', 'ad.ov.lg_facility': 'Facility', 'ad.ov.lg_buddy': 'Buddy', 'ad.ov.lg_overdue': 'Overdue · SOS',
      'ad.ov.feed_title': 'Live activity', 'ad.ov.feed_sub': 'Updates the moment the server changes',
      'ad.ov.feed_empty': 'No activity yet',
      'ad.ov.routes_title': 'Per route',
      'ad.ov.routes_sub': 'Verification progress against the 72-per-route target and held-out signal-layer accuracy per carrier.',
      'ad.ov.r_verified': '{v}/{target} verified',
      'ad.ov.r_fresh': 'Current', 'ad.ov.r_stale': 'Overdue', 'ad.ov.r_pending': 'Pending',
      'ad.ov.r_accuracy': 'Signal-layer accuracy', 'ad.ov.r_samples': '{n} samples', 'ad.ov.r_pack': 'v{v} · {date}',
      'ad.ov.r_nopack': 'not published', 'ad.ov.r_show_map': 'Show on map', 'ad.ov.r_packs': 'Current packs',
      'ad.ov.mix_title': 'Verified facility mix', 'ad.ov.mix_sub': 'Travellers see them ordered only by distance and capability — never by sponsorship.',
      'ad.ov.mix_trauma': 'Treats bleeding trauma', 'ad.ov.mix_night': 'Night shift', 'ad.ov.mix_total': 'verified',
      'ad.ov.packs_title': 'Published data packs', 'ad.ov.packs_sub': 'Current version per route × carrier',
      'ad.ov.packs_open': 'Manage packs',
      'ad.ov.ev.start': '{name} started a Buddy session', 'ad.ov.ev.checkin': '{name} checked in “I’m OK”', 'ad.ov.ev.location': '{name} shared a location',
      'ad.ov.ev.pre_deadzone': '{name} is about to enter a dead zone', 'ad.ov.ev.sos': '{name} sent an SOS', 'ad.ov.ev.overdue': '{name} missed a check-in',
      'ad.ov.ev.alert_sent': 'Alert e-mail about {name} sent to the recipient', 'ad.ov.ev.alert_failed': 'Alert about {name} failed to send',
      'ad.ov.ev.stop': '{name} ended the session', 'ad.ov.ev.resolved': '{name} confirmed safe',
      'ad.ov.ev.queued': 'delivered after signal returned',
      'ad.ov.f.session_new': 'New Buddy session: {name}',
      'ad.ov.f.session_status': '{name} → {status}',
      'ad.ov.f.sub_new': 'New community contribution: {what}',
      'ad.ov.f.sub_status': 'Contribution {id} → {status}',
      'ad.ov.f.fac_new': 'Added facility {name}',
      'ad.ov.f.fac_status': '{name} → {status}',
      'ad.ov.f.fac_update': 'Updated facility {name}',
      'ad.ov.f.fac_delete': 'Deleted facility {name}',
      'ad.ov.f.samples': '+{n} {carrier} signal samples',
      'ad.ov.f.samples_review': '{n} signal samples → {status}',
      'ad.ov.f.pack': 'Published pack {route} · {carrier} v{v}',
      'ad.ov.f.content': 'Medical content {v} → {status}',
      'ad.ov.f.import': 'Imported field signal samples · {route}',
      'ad.ov.f.service': 'Updated service {name}',
      'ad.ov.f.reset': 'Demo data has been reset',
      'ad.ov.f.generic': '{action} · {entity}',
      'ad.ov.kind.new': 'new place', 'ad.ov.kind.correction': 'correction', 'ad.ov.kind.closed': 'closure report', 'ad.ov.kind.signal_report': 'signal report',
      'ad.ov.traveler': 'Traveller',
      'ad.ov.todo_sos': '{n} SOS to handle now',
      'ad.ov.k_overdue_sos': 'SOS · Overdue',
      'ad.ov.k_overdue_meta_sos': '{s} SOS · {o} overdue · {a} alert sent',
      'ad.ov.st_sos': 'SOS',
      'ad.ov.st_sos_alerted': 'SOS · alert sent',
      'ad.ov.ev.alert_sent_sos': 'SOS e-mail about {name} sent to the recipient',
      'ad.ov.ev.all_clear': 'All-clear e-mail about {name} sent to the recipient'
    }
  });

  /* Buddy honesty (round 2 R7): local mode / a reserved demo address only SIMULATES the alert e-mails — never "đã gửi". */
  NC.i18n.add({
    vi: {
      'ad.ov.k_overdue_meta_local': '{o} quá hạn · {a} cảnh báo (mô phỏng)',
      'ad.ov.k_overdue_meta_sos_local': '{s} SOS · {o} quá hạn · {a} cảnh báo (mô phỏng)',
      'ad.ov.st_alerted_sim': 'Cảnh báo mô phỏng',
      'ad.ov.st_sos_alerted_sim': 'SOS · cảnh báo mô phỏng',
      'ad.ov.ev.alert_sent_sim': 'Email cảnh báo về {name} (mô phỏng — không gửi thật)',
      'ad.ov.ev.alert_sent_sos_sim': 'Email báo SOS về {name} (mô phỏng — không gửi thật)',
      'ad.ov.ev.all_clear_sim': 'Email báo an toàn về {name} (mô phỏng — không gửi thật)'
    },
    en: {
      'ad.ov.k_overdue_meta_local': '{o} overdue · {a} alerted (simulated)',
      'ad.ov.k_overdue_meta_sos_local': '{s} SOS · {o} overdue · {a} alerted (simulated)',
      'ad.ov.st_alerted_sim': 'Simulated alert',
      'ad.ov.st_sos_alerted_sim': 'SOS · simulated alert',
      'ad.ov.ev.alert_sent_sim': 'Alert e-mail about {name} (simulated — not really sent)',
      'ad.ov.ev.alert_sent_sos_sim': 'SOS e-mail about {name} (simulated — not really sent)',
      'ad.ov.ev.all_clear_sim': 'All-clear e-mail about {name} (simulated — not really sent)'
    }
  });
  function localMode() { return !NC.data || NC.data.mode !== 'supabase'; }
  /** The alert e-mails of this session are only simulated (local mode, or a reserved demo address). */
  function simSession(s) {
    if (localMode()) return true;
    var sh = NC.backend && NC.backend.shared;
    return !!(s && s.recipient_email && sh && sh.isReservedEmail && sh.isReservedEmail(s.recipient_email));
  }

  /* ------------------------------------------------------------------ state */
  var root = null, els = {};
  var S = {
    kpis: null, facs: [], sessions: [], sessById: {}, subsPending: 0, feed: [], feedIds: {},
    mapRoute: 'all', carrier: 'viettel', map: null, layers: null, visible: false, loadedAt: null, seq: 0, timer: null,
    sampleBurst: null
  };

  var EV_ICON = {
    start: ['play', 'primary'], checkin: ['check-circle', 'success'], location: ['map-pin', 'info'], pre_deadzone: ['signal-low', 'warning'],
    sos: ['siren', 'danger'], overdue: ['alert-triangle', 'danger'], alert_sent: ['mail', 'accent'], alert_failed: ['x-circle', 'danger'],
    stop: ['stop', 'neutral'], resolved: ['shield-check', 'success']
  };

  /* ------------------------------------------------------------------ mount */
  function mount(section) {
    root = section;
    root.classList.add('ad-ov');
    els.hero = h('section', { class: 'card card--hero ad-ov-hero' });
    els.kpis = h('div', { class: 'ad-grid ad-grid--kpis ad-ov-kpis' });
    els.mapCard = h('section', { class: 'card card--pad-0 ad-ov-mapcard' });
    els.feedCard = h('section', { class: 'card ad-ov-feed' });
    els.routes = h('div', { class: 'ad-grid ad-grid--3 ad-ov-routes' });
    els.mix = h('section', { class: 'card ad-ov-mix' });
    els.packs = h('section', { class: 'card ad-ov-packs' });
    root.appendChild(els.hero);
    root.appendChild(els.kpis);
    root.appendChild(h('div', { class: 'ad-grid ad-grid--main ad-ov-main' }, els.mapCard, els.feedCard));
    root.appendChild(h('div', { class: 'ad-ov-sechead' },
      h('h2', { class: 'ad-ov-sechead__title', 'data-i18n': 'ad.ov.routes_title' }, t('ad.ov.routes_title')),
      h('p', { class: 'ad-ov-sechead__sub', 'data-i18n': 'ad.ov.routes_sub' }, t('ad.ov.routes_sub'))));
    root.appendChild(els.routes);
    root.appendChild(h('div', { class: 'ad-grid ad-grid--aside ad-ov-bottom' }, els.mix, els.packs));
    buildMapCard();
    buildFeedCard();
    renderSkeleton();

    root.addEventListener('click', onClick);
    A.live(onLive);
    NC.bus.on('i18n:change', function () {
      if (!S.kpis) return;
      renderAll();
      buildMapHead();
      renderFeed();
      drawMap();
    });
  }

  function renderSkeleton() {
    els.kpis.innerHTML = '';
    for (var i = 0; i < 6; i++) els.kpis.appendChild(h('div', { class: 'ad-kpi' }, h('span', { class: 'skeleton skeleton--text', style: 'width:60%' }), h('span', { class: 'skeleton skeleton--title', style: 'margin-top:auto' })));
    els.routes.innerHTML = '';
    for (var j = 0; j < 3; j++) els.routes.appendChild(h('div', { class: 'skeleton skeleton--card', style: 'height:280px' }));
  }

  /* ------------------------------------------------------------------ data */
  function load() {
    var k = ++S.seq;
    var first = !S.kpis;
    var jobs = [
      NC.data.admin.kpis(),
      NC.data.admin.listFacilities({}),
      NC.data.admin.listBuddySessions({}),
      NC.data.admin.listSubmissions({ status: 'pending' })
    ];
    return Promise.all(jobs).then(function (r) {
      if (k !== S.seq) return null;
      S.kpis = r[0];
      S.facs = r[1] || [];
      setSessions(r[2] || []);
      S.subsPending = (r[3] || []).length;
      if (first && !S.mapPicked) S.mapRoute = busiestRoute();
      S.loadedAt = new Date();
      renderAll();
      if (first) buildMapHead();
      drawMap();
      if (first) return loadFeedHistory();
      return null;
    }).catch(function (e) {
      if (e && e.sessionLost) return; // the shell is back on the sign-in gate
      console.error('[admin/overview] load failed', e);
      if (k === S.seq) NC.ui.toast(A.errorText(e), { type: 'danger' });
    });
  }
  var reload = U.debounce(function () { if (S.visible) load(); else S.dirty = true; }, 700);

  /* Default map focus: the route with the most alarms, then the most open Buddy sessions. */
  function busiestRoute() {
    var best = null;
    A.routes().forEach(function (r) {
      var open = S.sessions.filter(function (s) { return s.route_id === r.id && s.status !== 'closed'; });
      var alarm = open.filter(function (s) { return s.status === 'overdue' || s.status === 'alerted'; }).length;
      var score = alarm * 10 + open.length;
      if (!best || score > best.score) best = { id: r.id, score: score };
    });
    return best && best.score > 0 ? best.id : 'all';
  }

  function setSessions(list) {
    S.sessions = list;
    S.sessById = {};
    list.forEach(function (s) { S.sessById[s.id] = s; });
  }

  /* initial feed = recent audit rows + recent check-in events of open sessions */
  function loadFeedHistory() {
    var open = S.sessions.filter(function (s) { return s.status !== 'closed'; }).slice(0, 8);
    return Promise.all([
      NC.data.admin.audit({ limit: 40 }).catch(function () { return []; }),
      Promise.all(open.map(function (s) { return NC.data.admin.listBuddyEvents(s.id).catch(function () { return []; }); }))
    ]).then(function (r) {
      var items = [];
      (r[0] || []).forEach(function (a) { var it = auditItem(a); if (it) items.push(it); });
      (r[1] || []).forEach(function (evs) { (evs || []).slice(-4).forEach(function (e) { var it = eventItem(e); if (it) items.push(it); }); });
      items.sort(function (a, b) { return b.at - a.at; });
      items.slice(0, 18).reverse().forEach(function (it) { pushFeed(it, true); });
      renderFeed();
    });
  }

  /* ------------------------------------------------------------------ feed items */
  function travName(sessionId) {
    var s = S.sessById[sessionId];
    return (s && s.traveler_name) || t('ad.ov.traveler');
  }
  function statusText(st) { return NC.i18n.has('ad.core.status.' + st) ? t('ad.core.status.' + st) : st; }
  /** SOS since the last check-in (server alert_reason/sos_at; FIX_CONTRACT A4). An SOS is never "overdue check-in". */
  function isSos(s) { return !!s && s.status !== 'closed' && s.status !== 'active' && (s.alert_reason === 'sos' || !!s.sos_at); }
  function sessStatusText(row) {
    var sim = row && row.status === 'alerted' && simSession(row);
    if (isSos(row)) return t(row.status === 'alerted' ? (sim ? 'ad.ov.st_sos_alerted_sim' : 'ad.ov.st_sos_alerted') : 'ad.ov.st_sos');
    return sim ? t('ad.ov.st_alerted_sim') : statusText(row.status);
  }
  /** Feed text fields may be functions (re-evaluated on every render → follow the UI language). */
  function val(v) { return typeof v === 'function' ? v() : v; }
  function facName(id, row) {
    if (row && row.name) return row.name;
    var f = S.facs.filter(function (x) { return x.id === id; })[0];
    return f ? f.name : id;
  }
  function kindText(k) { return NC.i18n.has('ad.ov.kind.' + k) ? t('ad.ov.kind.' + k) : k; }
  function toMs(v) { var d = U.toDate(v); return d ? d.getTime() : Date.now(); }

  function eventItem(e) {
    if (!e || !e.kind) return null;
    var ic = EV_ICON[e.kind] || ['activity', 'neutral'];
    return {
      id: 'ev:' + e.id, at: toMs(e.received_at || e.client_ts), icon: ic[0], tone: ic[1],
      html: function () {
        var m = e.meta || {};
        var key = e.kind === 'alert_sent' && m.type === 'resolved' ? 'all_clear' : e.kind === 'alert_sent' && m.reason === 'sos' ? 'alert_sent_sos' : e.kind;
        if (e.kind === 'alert_sent' && (simSession(S.sessById[e.session_id]) || m.provider === 'simulated' || m.provider === 'demo' || m.dry_run)) key += '_sim';
        return t('ad.ov.ev.' + key, { name: '<b>' + U.esc(travName(e.session_id)) + '</b>' });
      },
      meta: e.queued ? function () { return t('ad.ov.ev.queued'); } : null, go: 'buddy', params: 'id=' + encodeURIComponent(e.session_id)
    };
  }

  function auditItem(a) {
    var d = a.details || {};
    var row = d.row || {};
    var ch = d.changed || {};
    var st = ch.status ? ch.status.to : null;
    var at = toMs(a.created_at);
    var base = { id: 'au:' + a.id, at: at, icon: 'history', tone: 'neutral' };
    switch (a.entity) {
      case 'facilities':
        base.icon = 'hospital'; base.go = 'facilities'; base.params = 'edit=' + encodeURIComponent(a.entity_id);
        if (a.action === 'insert') { base.tone = 'primary'; base.text = function () { return t('ad.ov.f.fac_new', { name: facName(a.entity_id, row) }); }; }
        else if (a.action === 'status' && st) { base.tone = st === 'verified' ? 'success' : st === 'rejected' ? 'danger' : 'warning'; base.text = function () { return t('ad.ov.f.fac_status', { name: facName(a.entity_id), status: statusText(st) }); }; }
        else if (a.action === 'delete') { base.tone = 'danger'; base.icon = 'trash'; base.text = function () { return t('ad.ov.f.fac_delete', { name: facName(a.entity_id, row) }); }; base.go = null; }
        else base.text = function () { return t('ad.ov.f.fac_update', { name: facName(a.entity_id) }); };
        break;
      case 'facility_submissions':
        base.icon = 'message-square'; base.go = 'community'; base.params = 'id=' + encodeURIComponent(a.entity_id);
        if (a.action === 'insert') { base.tone = 'accent'; base.text = function () { return t('ad.ov.f.sub_new', { what: (row.payload && row.payload.name) || kindText(row.kind) }); }; }
        else { base.tone = st === 'approved' ? 'success' : st === 'rejected' ? 'danger' : 'neutral'; base.text = function () { return t('ad.ov.f.sub_status', { id: a.entity_id, status: statusText(st || 'pending') }); }; }
        break;
      case 'buddy_sessions':
        base.icon = 'shield-check'; base.go = 'buddy'; base.params = 'id=' + encodeURIComponent(a.entity_id);
        if (a.action === 'insert') { base.tone = 'primary'; base.text = function () { return t('ad.ov.f.session_new', { name: row.traveler_name || travName(a.entity_id) }); }; }
        else if (st) {
          var sosRow = { status: st, alert_reason: ch.alert_reason ? ch.alert_reason.to : (row.alert_reason || null) };
          var sos = isSos(sosRow);
          base.tone = sos || st === 'overdue' ? 'danger' : st === 'alerted' ? 'accent' : st === 'closed' ? 'success' : 'info';
          base.icon = sos ? 'siren' : st === 'overdue' ? 'alert-triangle' : st === 'alerted' ? 'bell-ring' : 'shield-check';
          base.text = function () { return t('ad.ov.f.session_status', { name: travName(a.entity_id), status: sessStatusText(sosRow) }); };
        }
        else return null;
        break;
      case 'data_packs':
        base.icon = 'package'; base.tone = 'primary'; base.go = 'packs';
        if (!row.route_id) return null;
        base.text = function () { return t('ad.ov.f.pack', { route: A.routeName(row.route_id, { short: true }), carrier: A.carrierName(row.carrier), v: row.version }); };
        break;
      case 'content_releases':
        base.icon = 'book-open'; base.tone = 'info'; base.go = 'packs';
        base.text = function () { return t('ad.ov.f.content', { v: row.version || a.entity_id, status: statusText(st || row.status || 'draft') }); };
        break;
      case 'signal_samples':
        base.icon = 'signal'; base.tone = 'info'; base.go = 'signal';
        base.text = function () { return t('ad.ov.f.import', { route: A.routeName(a.entity_id, { short: true }) }); };
        break;
      case 'services':
        base.icon = 'bed'; base.tone = 'neutral'; base.go = 'facilities'; base.params = 'tab=services';
        base.text = function () { return t('ad.ov.f.service', { name: row.name || a.entity_id }); };
        break;
      default:
        base.text = function () { return t('ad.ov.f.generic', { action: a.action, entity: a.entity }); };
    }
    if (a.actor_label) {
      var actor = a.actor_label;
      base.meta = function () { return A.actorLabel ? A.actorLabel(actor) : actor; }; // re-evaluated on i18n:change
    }
    return base;
  }

  function liveItem(msg) {
    var row = msg.row || {};
    var now = Date.now();
    switch (msg.table) {
      case 'checkin_events':
        if (msg.type !== 'INSERT') return null;
        var it = eventItem(row);
        if (it) it.at = now;
        return it;
      case 'buddy_sessions':
        var prev = S.sessById[row.id];
        if (msg.type === 'INSERT') return null; // the session's 'start' check-in event already tells the story
        if (msg.type === 'UPDATE' && prev && prev.status !== row.status) {
          var st = row.status;
          var sRow = { status: st, alert_reason: row.alert_reason, sos_at: row.sos_at };
          var sos = isSos(sRow);
          return {
            id: 'bs:' + row.id + ':' + st + ':' + now, at: now,
            icon: sos ? 'siren' : st === 'overdue' ? 'alert-triangle' : st === 'alerted' ? 'bell-ring' : 'shield-check',
            tone: sos || st === 'overdue' ? 'danger' : st === 'alerted' ? 'accent' : st === 'closed' ? 'success' : 'info',
            text: function () { return t('ad.ov.f.session_status', { name: row.traveler_name || travName(row.id), status: sessStatusText(sRow) }); },
            go: 'buddy', params: 'id=' + encodeURIComponent(row.id)
          };
        }
        return null;
      case 'facility_submissions':
        if (msg.type === 'INSERT') return { id: 'fs:' + row.id, at: now, icon: 'message-square', tone: 'accent', text: function () { return t('ad.ov.f.sub_new', { what: (row.payload && row.payload.name) || kindText(row.kind) }); }, go: 'community', params: 'id=' + encodeURIComponent(row.id) };
        if (msg.type === 'UPDATE') return { id: 'fs:' + row.id + ':' + row.status, at: now, icon: 'message-square', tone: row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'neutral', text: function () { return t('ad.ov.f.sub_status', { id: row.id, status: statusText(row.status) }); }, go: 'community', params: 'id=' + encodeURIComponent(row.id) };
        return null;
      case 'facilities':
        if (msg.type === 'DELETE') { var delName = facName(row.id, row); return { id: 'fa:' + row.id + ':del', at: now, icon: 'trash', tone: 'danger', text: function () { return t('ad.ov.f.fac_delete', { name: delName }); } }; }
        var old = S.facs.filter(function (x) { return x.id === row.id; })[0];
        if (msg.type === 'INSERT') return { id: 'fa:' + row.id + ':new', at: now, icon: 'hospital', tone: 'primary', text: function () { return t('ad.ov.f.fac_new', { name: row.name || row.id }); }, go: 'facilities', params: 'edit=' + encodeURIComponent(row.id) };
        if (old && old.status !== row.status) return { id: 'fa:' + row.id + ':' + row.status + ':' + now, at: now, icon: 'hospital', tone: row.status === 'verified' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning', text: function () { return t('ad.ov.f.fac_status', { name: row.name || row.id, status: statusText(row.status) }); }, go: 'facilities', params: 'edit=' + encodeURIComponent(row.id) };
        return { id: 'fa:' + row.id + ':u:' + now, at: now, icon: 'edit', tone: 'neutral', text: function () { return t('ad.ov.f.fac_update', { name: row.name || row.id }); }, go: 'facilities', params: 'edit=' + encodeURIComponent(row.id) };
      case 'signal_samples':
        // Burst of samples (community upload) → one aggregated line.
        var key = msg.type === 'INSERT' ? 'ins:' + (row.carrier || '') : 'rev:' + (row.status || '');
        if (!S.sampleBurst || S.sampleBurst.key !== key || now - S.sampleBurst.at > 4000) {
          S.sampleBurst = { key: key, at: now, n: 0, id: 'ss:' + key + ':' + now };
        }
        S.sampleBurst.n++;
        S.sampleBurst.at = now;
        var burst = S.sampleBurst, ins = msg.type === 'INSERT';
        return {
          id: burst.id, at: now, icon: 'signal', tone: 'info', replace: true, go: 'signal',
          text: function () { return ins ? t('ad.ov.f.samples', { n: burst.n, carrier: A.carrierName(row.carrier) }) : t('ad.ov.f.samples_review', { n: burst.n, status: statusText(row.status) }); }
        };
      case 'data_packs':
        if (msg.type !== 'INSERT' || !row.route_id) return null;
        return { id: 'dp:' + row.id, at: now, icon: 'package', tone: 'primary', text: function () { return t('ad.ov.f.pack', { route: A.routeName(row.route_id, { short: true }), carrier: A.carrierName(row.carrier), v: row.version }); }, go: 'packs' };
      case 'content_releases':
        return { id: 'cr:' + row.id + ':' + row.status, at: now, icon: 'book-open', tone: 'info', text: function () { return t('ad.ov.f.content', { v: row.version, status: statusText(row.status) }); }, go: 'packs' };
      case '*':
        return msg.type === 'RESET' ? { id: 'reset:' + now, at: now, icon: 'rotate-ccw', tone: 'warning', text: function () { return t('ad.ov.f.reset'); } } : null;
      default:
        return null;
    }
  }

  function pushFeed(it, silent) {
    if (!it) return;
    if (S.feedIds[it.id] && !it.replace) return;
    if (S.feedIds[it.id] && it.replace) S.feed = S.feed.filter(function (x) { return x.id !== it.id; });
    S.feedIds[it.id] = true;
    it.fresh = !silent;
    S.feed.unshift(it);
    if (S.feed.length > 40) S.feed.length = 40;
  }

  function onLive(msg) {
    if (!msg) return;
    if (msg.table === 'audit_log') return;
    if (msg.table === 'checkin_events' && msg.type === 'INSERT' && msg.row && !S.sessById[msg.row.session_id]) {
      // Event of a session we have not seen yet (its INSERT may arrive just after) → resolve the name first.
      setTimeout(function () {
        var ready = S.sessById[msg.row.session_id] ? Promise.resolve() : NC.data.admin.listBuddySessions({}).then(setSessions).catch(function () { });
        ready.then(function () { var it2 = liveItem(msg); if (it2) { pushFeed(it2); renderFeed(); } });
      }, 600);
      reload();
      return;
    }
    if (msg.table === 'buddy_sessions' && msg.row) {
      // keep the cache fresh so events name the traveller correctly (status diff is read before the merge)
      var itS = liveItem(msg);
      S.sessById[msg.row.id] = Object.assign({}, S.sessById[msg.row.id] || {}, msg.row);
      if (itS) { pushFeed(itS); renderFeed(); }
      reload();
      return;
    }
    var it = liveItem(msg);
    if (it) { pushFeed(it); renderFeed(); }
    if (msg.table === '*' && msg.type === 'RESET') { S.feed = []; S.feedIds = {}; S.kpis = null; }
    if (['facilities', 'facility_submissions', 'buddy_sessions', 'signal_samples', 'data_packs', 'checkin_events', '*'].indexOf(msg.table) >= 0) reload();
  }

  /* ------------------------------------------------------------------ render */
  function renderAll() {
    renderHero();
    renderKpis();
    renderRoutes();
    renderMix();
    renderPacks();
  }

  function glassBtn(ic, label, go, params, tone) {
    return h('a', {
      class: 'btn btn--glass btn--sm ad-ov-todo' + (tone ? ' ad-ov-todo--' + tone : ''), href: '#/' + go + (params ? '?' + params : ''),
      html: icon(ic) + '<span>' + U.esc(label) + '</span>'
    });
  }

  function renderHero() {
    var k = S.kpis;
    var sess = A.session();
    var who = sess && sess.user ? (sess.user.display_name || String(sess.user.email || '').split('@')[0]) : 'admin';
    var totalFacs = k.facilities.verified + k.facilities.pending + k.facilities.rejected;
    els.hero.innerHTML = '';
    var left = h('div', { class: 'ad-ov-hero__main' },
      h('p', { class: 'ad-ov-hero__eyebrow' }, t('ad.ov.hello', { name: who })),
      h('h2', { class: 'ad-ov-hero__title' }, t('ad.ov.hero_title')),
      h('p', { class: 'ad-ov-hero__text' }, t('ad.ov.hero_text', { facs: num(totalFacs), samples: num(k.samples.total) })),
      h('div', { class: 'ad-ov-hero__chips' },
        h('span', { class: 'ad-ov-glass', title: t('ad.core.mode.' + A.mode() + '_long'), html: icon(A.mode() === 'supabase' ? 'database' : 'hard-drive') + '<span>' + U.esc(t('ad.core.mode.' + A.mode())) + '</span>' }),
        h('span', { class: 'ad-ov-glass ad-ov-hero__time', html: icon('clock') + '<span>' + U.esc(t('ad.ov.updated', { time: U.fmtTime(S.loadedAt) })) + '</span>' }),
        h('span', { class: 'ad-ov-glass', html: icon('info') + '<span>' + U.esc(t('common.demo_data')) + '</span>' }))
    );
    var todo = h('div', { class: 'ad-ov-hero__todo' }, h('p', { class: 'ad-ov-hero__todo-title' }, t('ad.ov.todo')));
    var list = h('div', { class: 'ad-ov-hero__todo-list' });
    var alarm = k.buddy.overdue + k.buddy.alerted;
    var sos = S.sessions.filter(isSos);
    if (sos.length) list.appendChild(glassBtn('siren', t('ad.ov.todo_sos', { n: sos.length }), 'buddy', sos.length === 1 ? 'id=' + encodeURIComponent(sos[0].id) : null, 'sos'));
    if (alarm - sos.length > 0) list.appendChild(glassBtn('alert-triangle', t('ad.ov.todo_overdue', { n: alarm - sos.length }), 'buddy', null, 'danger'));
    if (S.subsPending) list.appendChild(glassBtn('message-square', t('ad.ov.todo_subs', { n: S.subsPending }), 'community', 'status=pending'));
    if (k.facilities.pending) list.appendChild(glassBtn('clock', t('ad.ov.todo_pending', { n: k.facilities.pending }), 'facilities', 'status=pending'));
    if (k.facilities.stale) list.appendChild(glassBtn('history', t('ad.ov.todo_stale', { n: k.facilities.stale }), 'facilities', 'stale=1'));
    if (!list.children.length) list.appendChild(h('span', { class: 'ad-ov-glass', html: icon('check-circle') + '<span>' + U.esc(t('ad.ov.todo_clear')) + '</span>' }));
    todo.appendChild(list);
    els.hero.appendChild(left);
    els.hero.appendChild(todo);
  }

  function kpiTile(o) {
    var tile = h('a', { class: 'ad-kpi' + (o.cls ? ' ' + o.cls : ''), href: o.href || '#/overview', 'data-kpi': o.key });
    var top = h('div', { class: 'ad-kpi__top' },
      h('span', { class: 'ad-kpi__label' }, o.label),
      o.viz ? h('span', { class: 'ad-kpi__viz' }, o.viz) : h('span', { class: 'icon-tile ad-kpi__icon icon-tile--' + (o.tone || 'primary'), html: icon(o.icon) }));
    tile.appendChild(top);
    tile.appendChild(h('span', { class: 'ad-kpi__value', html: o.valueHtml }));
    if (o.extra) tile.appendChild(o.extra);
    if (o.meta) tile.appendChild(h('span', { class: 'ad-kpi__meta', html: o.meta }));
    return tile;
  }

  var prevKpi = {};
  function renderKpis() {
    var k = S.kpis;
    var f = k.facilities, b = k.buddy;
    var target = f.target || 216;
    var pct = target ? f.verified / target : 0;
    var alarm = b.overdue + b.alerted;
    var sosRows = S.sessions.filter(isSos);
    var sosN = typeof b.sos === 'number' ? b.sos : sosRows.length;
    var sosO = sosRows.filter(function (s) { return s.status === 'overdue'; }).length;
    var lm = localMode() ? '_local' : '';   // local mode: "cảnh báo (mô phỏng)", never "đã gửi"
    var overdueMeta = sosN
      ? t('ad.ov.k_overdue_meta_sos' + lm, { s: sosN, o: Math.max(0, b.overdue - sosO), a: Math.max(0, b.alerted - (sosRows.length - sosO)) })
      : t('ad.ov.k_overdue_meta' + lm, { o: b.overdue, a: b.alerted });
    var carriers = A.carriers();
    var sBar = h('div', { class: 'ad-ov-mini', role: 'img', 'aria-label': carriers.map(function (c) { return c.name + ' ' + num(k.samples.by_carrier[c.id]); }).join(', ') });
    carriers.forEach(function (c, i) {
      var v = k.samples.by_carrier[c.id] || 0;
      sBar.appendChild(h('span', { class: 'ad-ov-mini__seg ad-ov-mini__seg--' + i, style: 'flex-grow:' + Math.max(1, v), title: c.name + ': ' + num(v) }));
    });
    var tiles = [
      {
        key: 'verified', label: t('ad.ov.k_verified'), href: '#/facilities?status=verified',
        viz: NC.viz.ring(pct, { size: 54, stroke: 7, tone: 'success', label: Math.round(pct * 100) + '%', ariaLabel: Math.round(pct * 100) + '%' }),
        valueHtml: num(f.verified) + '<small>/ ' + num(target) + '</small>', meta: U.esc(t('ad.ov.k_verified_meta'))
      },
      {
        key: 'pending', label: t('ad.ov.k_pending'), icon: 'clock', tone: 'warning', href: '#/facilities?status=pending',
        valueHtml: num(f.pending), meta: U.esc(t('ad.ov.k_pending_meta', { n: S.subsPending }))
      },
      {
        key: 'stale', label: t('ad.ov.k_stale'), icon: 'history', tone: 'warning', href: '#/facilities?stale=1', cls: f.stale ? 'ad-kpi--warning' : '',
        valueHtml: num(f.stale), meta: U.esc(t('ad.ov.k_stale_meta'))
      },
      {
        key: 'active', label: t('ad.ov.k_active'), icon: 'shield-check', tone: 'info', href: '#/buddy?status=active',
        valueHtml: num(b.active), meta: U.esc(t('ad.ov.k_active_meta', { n: b.closed_24h }))
      },
      {
        key: 'overdue', label: sosN ? t('ad.ov.k_overdue_sos') : t('ad.ov.k_overdue'), icon: 'siren', tone: 'danger', href: '#/buddy', cls: alarm ? 'ad-kpi--danger ad-kpi--alert' + (sosN ? ' ad-ov-kpi--sos' : '') : '',
        valueHtml: num(alarm), meta: U.esc(alarm ? overdueMeta : t('ad.ov.k_overdue_ok'))
      },
      {
        key: 'samples', label: t('ad.ov.k_samples'), icon: 'signal', tone: 'primary', href: '#/signal',
        valueHtml: num(k.samples.total), extra: sBar, meta: U.esc(t('ad.ov.k_samples_meta', { n: k.samples.pending }))
      }
    ];
    els.kpis.innerHTML = '';
    var sig = {};
    tiles.forEach(function (o) {
      var el = kpiTile(o);
      sig[o.key] = o.valueHtml;
      if (prevKpi[o.key] !== undefined && prevKpi[o.key] !== o.valueHtml) el.classList.add('is-flash');
      els.kpis.appendChild(el);
    });
    prevKpi = sig;
  }

  /* ---- map ---- */
  function buildMapCard() {
    els.mapHead = h('div', { class: 'ad-ov-maphead' });
    els.mapEl = h('div', { class: 'ad-map ad-map--flush ad-ov-map', role: 'region', 'aria-label': t('ad.ov.map_title') });
    els.mapLegend = h('div', { class: 'ad-ov-maplegend' });
    els.mapCard.appendChild(els.mapHead);
    els.mapCard.appendChild(els.mapEl);
    els.mapCard.appendChild(els.mapLegend);
    buildMapHead();
  }
  function buildMapHead() {
    var sub = S.mapRoute === 'all' ? t('ad.ov.map_sub_all') : t('ad.ov.map_sub_route', { carrier: A.carrierName(S.carrier) });
    els.mapHead.innerHTML = '';
    els.mapHead.appendChild(h('div', { class: 'ad-ov-maphead__row' }, h('div', { class: 'ad-card-head__title' },
      h('span', { class: 'icon-tile icon-tile--primary', html: icon('map-trifold') }),
      h('span', null, h('span', { class: 'ad-ov-maphead__title' }, t('ad.ov.map_title')), h('span', { class: 'ad-card-head__sub', style: 'display:block' }, sub)))));
    var tabs = h('div', { class: 'chip-group chip-group--scroll ad-ov-maptabs', role: 'tablist', 'aria-label': t('ad.ov.map_title') });
    [{ id: 'all', label: t('ad.ov.map_all') }].concat(A.routes().map(function (r) { return { id: r.id, label: A.routeName(r.id, { short: true }), color: r.color }; })).forEach(function (r) {
      var on = S.mapRoute === r.id;
      var chip = h('button', { type: 'button', class: 'chip chip--soft' + (on ? ' is-selected' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', 'data-map-route': r.id });
      if (r.color) chip.appendChild(h('span', { class: 'ad-ov-dot', style: 'background:' + r.color }));
      chip.appendChild(document.createTextNode(r.label));
      tabs.appendChild(chip);
    });
    var tools = h('div', { class: 'ad-ov-maphead__tools' });
    if (S.mapRoute !== 'all') {
      tools.appendChild(A.select({ cls: 'ad-ov-carrier', label: t('ad.ov.map_carrier'), value: S.carrier, options: A.carriers().map(function (c) { return { value: c.id, label: c.name }; }) }));
    }
    els.mapHead.firstChild.appendChild(tools);
    els.mapHead.appendChild(tabs);
    var sel = els.mapHead.querySelector('.ad-ov-carrier');
    if (sel) sel.addEventListener('change', function () { S.carrier = sel.value; buildMapHead(); drawMap(); });
    // legend
    els.mapLegend.innerHTML = '';
    var lg = h('div', { class: 'ad-legend' });
    if (S.mapRoute === 'all') {
      A.routes().forEach(function (r) { lg.appendChild(h('span', { class: 'ad-legend__item' }, h('span', { class: 'ad-swatch', style: 'background:' + r.color }), A.routeName(r.id, { short: true }))); });
    } else {
      ['likely', 'uncertain', 'lost'].forEach(function (l) { lg.appendChild(h('span', { class: 'ad-legend__item' }, h('span', { class: 'ad-swatch ad-swatch--' + l }), t('common.sig.' + l))); });
      lg.appendChild(h('span', { class: 'ad-legend__item', html: '<span class="ad-ov-lgpoi"></span>' + U.esc(t('ad.ov.lg_facility')) }));
    }
    lg.appendChild(h('span', { class: 'ad-legend__item', html: '<span class="ad-ov-pin ad-ov-pin--mini"></span>' + U.esc(t('ad.ov.lg_buddy')) }));
    lg.appendChild(h('span', { class: 'ad-legend__item', html: '<span class="ad-ov-pin ad-ov-pin--mini ad-ov-pin--overdue"></span>' + U.esc(t('ad.ov.lg_overdue')) }));
    els.mapLegend.appendChild(lg);
  }

  function ensureMap() {
    if (S.map || !window.L) return S.map;
    S.map = A.miniMap(els.mapEl, { zoom: 6, scrollWheelZoom: false, center: [16.5, 106.5] });
    if (S.map) S.layers = window.L.layerGroup().addTo(S.map);
    // Overlapping facility markers / 44 px touch boxes are hidden per zoom level (NC.mapkit.declutter, WCAG target-size).
    if (S.map && NC.mapkit.declutter) S.decl = NC.mapkit.declutter(S.map, function () { return [S.layers]; }, { keep: function (m) { return !!m.ncBuddy; } });
    return S.map;
  }

  function buddyMarker(s) {
    var Lf = window.L;
    var st = s.status;
    var sos = isSos(s);
    var html = '<span class="ad-ov-pin ad-ov-pin--' + U.esc(st) + (sos ? ' ad-ov-pin--sos' : '') + '">' + icon(sos ? 'siren' : st === 'overdue' || st === 'alerted' ? 'alert-triangle' : 'user') + '</span>';
    var m = Lf.marker([s.lat, s.lng], {
      icon: Lf.divIcon({ className: 'ad-ov-pinwrap', html: html, iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: (s.traveler_name || '') + ' · ' + sessStatusText(s), keyboard: true, zIndexOffset: sos ? 1000 : st === 'overdue' || st === 'alerted' ? 900 : 600
    });
    m.bindTooltip('<b>' + U.esc(s.traveler_name || t('ad.ov.traveler')) + '</b><br>' + U.esc(sessStatusText(s)) + (s.last_location_at ? ' · ' + U.esc(U.relTime(s.last_location_at)) : ''), { direction: 'top', offset: [0, -14] });
    m.on('click', function () { A.go('buddy', { id: s.id }); });
    m.poi = { id: s.id, type: 'buddy' };   // takes part in the declutter (kept; nearby facility markers yield)
    m.ncBuddy = true;
    return m;
  }

  var drawSeq = 0;
  function drawMap() {
    if (!S.visible || !S.kpis) return;
    var map = ensureMap();
    if (!map) return;
    var Lf = window.L;
    var k = ++drawSeq;
    S.layers.clearLayers();
    var open = S.sessions.filter(function (s) { return s.status !== 'closed' && s.lat !== null && s.lat !== undefined && isFinite(s.lat); });
    if (S.mapRoute === 'all') {
      var pts = [];
      var southId = A.routes().reduce(function (b, r) { return !b || (r.bbox && r.bbox[0] < b.bbox[0]) ? r : b; }, null);
      southId = southId ? southId.id : null;
      A.routes().forEach(function (r) {
        if (!r.geometry || r.geometry.length < 2) return;
        Lf.polyline(r.geometry, { color: r.color, weight: 10, opacity: 0.22, lineCap: 'round', interactive: false }).addTo(S.layers);
        var line = Lf.polyline(r.geometry, { color: r.color, weight: 4, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(S.layers);
        line.bindTooltip(U.esc(A.routeName(r.id, { short: true })), { sticky: true });
        line.on('click', function () { setMapRoute(r.id); });
        // Label above the northernmost point, except the southernmost route (below) → no overlap at country zoom.
        var south = r.id === southId;
        var pick = r.geometry.reduce(function (b, p) { return (south ? p[0] < b[0] : p[0] > b[0]) ? p : b; }, r.geometry[0]);
        Lf.marker(pick, { icon: Lf.divIcon({ className: 'ad-ov-labelwrap', html: '<span class="ad-ov-label ad-ov-label--' + (south ? 'below' : 'above') + '" style="--c:' + U.esc(r.color) + '">' + U.esc(A.routeName(r.id, { short: true })) + '</span>', iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, keyboard: false }).addTo(S.layers);
        pts.push([r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]);
      });
      open.forEach(function (s) { buddyMarker(s).addTo(S.layers); });
      NC.mapkit.refresh(map);
      setTimeout(function () { if (k === drawSeq) NC.mapkit.fitTo(map, pts, { padding: [36, 36], maxZoom: 9 }); }, 30);
      return;
    }
    var rid = S.mapRoute;
    var route = A.routes().filter(function (r) { return r.id === rid; })[0];
    NC.data.getPack(rid, S.carrier).then(function (pack) {
      if (k !== drawSeq) return;
      NC.mapkit.drawRoute(null, pack, { weight: 5 }).addTo(S.layers);
      S.facs.filter(function (f) { return f.route_id === rid && f.status === 'verified' && isFinite(f.lat) && f.lat !== null; }).forEach(function (f) {
        var m = NC.mapkit.poiMarker(f, 'facility', { size: 26 });
        m.bindTooltip('<b>' + U.esc(f.name) + '</b><br>' + U.esc(A.facType(f.type)) + (f.is_stale ? ' · ' + U.esc(t('ad.core.status.stale')) : ''), { direction: 'top' });
        m.on('click', function () { A.go('facilities', { edit: f.id }); });
        m.addTo(S.layers);
      });
      open.filter(function (s) { return s.route_id === rid; }).forEach(function (s) { buddyMarker(s).addTo(S.layers); });
      NC.mapkit.refresh(map);
      setTimeout(function () {
        if (k === drawSeq && route) NC.mapkit.fitTo(map, route.bbox, { padding: [24, 24] });
        if (k === drawSeq && S.decl) S.decl.update();
      }, 30);
    }).catch(function (e) {
      console.warn('[admin/overview] pack failed', e);
      if (route && route.geometry) Lf.polyline(route.geometry, { color: route.color, weight: 4 }).addTo(S.layers);
    });
  }

  function setMapRoute(id) {
    S.mapRoute = id;
    S.mapPicked = true;
    buildMapHead();
    drawMap();
  }

  /* ---- feed ---- */
  function buildFeedCard() {
    els.feedCard.appendChild(h('div', { class: 'ad-card-head' },
      h('div', { class: 'ad-card-head__title' },
        h('span', { class: 'icon-tile icon-tile--accent', html: icon('activity') }),
        h('span', null, h('span', { 'data-i18n': 'ad.ov.feed_title' }, t('ad.ov.feed_title')), h('span', { class: 'ad-card-head__sub', style: 'display:block', 'data-i18n': 'ad.ov.feed_sub' }, t('ad.ov.feed_sub')))),
      h('span', { class: 'ad-live-dot', 'data-live-dot': '', 'data-state': A.liveState(), 'aria-hidden': 'true' })));
    els.feed = h('ol', { class: 'ad-ov-feed__list', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    els.feedCard.appendChild(els.feed);
  }
  function renderFeed() {
    if (!els.feed) return;
    els.feed.innerHTML = '';
    if (!S.feed.length) {
      els.feed.appendChild(h('li', { class: 'ad-ov-feed__empty' }, t('ad.ov.feed_empty')));
      return;
    }
    S.feed.slice(0, 24).forEach(function (it) {
      var tag = it.go ? 'a' : 'div';
      var inner = h(tag, { class: 'ad-ov-feed__item', href: it.go ? '#/' + it.go + (it.params ? '?' + it.params : '') : null },
        h('span', { class: 'icon-tile icon-tile--sm icon-tile--' + (it.tone || 'neutral'), html: icon(it.icon || 'activity') }),
        h('span', { class: 'ad-ov-feed__body' },
          h('span', { class: 'ad-ov-feed__text', html: val(it.html) || U.esc(val(it.text) || '') }),
          h('span', { class: 'ad-ov-feed__meta' }, U.relTime(it.at) + (it.meta ? ' · ' + val(it.meta) : ''))));
      var li = h('li', { class: it.fresh ? 'is-new' : null }, inner);
      it.fresh = false;
      els.feed.appendChild(li);
    });
  }

  /* ---- route cards ---- */
  function packFor(routeId, carrier) {
    return (S.kpis.packs || []).filter(function (p) { return p.route_id === routeId && p.carrier === carrier; })[0] || null;
  }
  function renderRoutes() {
    var k = S.kpis;
    var meta = {};
    A.routes().forEach(function (r) { meta[r.id] = r; });
    els.routes.innerHTML = '';
    (k.routes || []).forEach(function (r) {
      var m = meta[r.id] || {};
      var fresh = Math.max(0, r.verified - r.stale);
      var denom = Math.max(TARGET_PER_ROUTE, r.verified + r.pending);
      var card = h('article', { class: 'card ad-ov-route', style: '--route:' + (m.color || 'var(--c-primary)') });
      card.appendChild(h('div', { class: 'ad-ov-route__head' },
        h('span', { class: 'ad-ov-route__icon', html: icon(m.travel_mode === 'hiking' ? 'footprints' : 'bike') }),
        h('div', { class: 'ad-ov-route__title' },
          h('h3', null, A.routeName(r.id, { short: true })),
          h('p', null, [A.routeRegion ? A.routeRegion(m) : m.region, m.length_km ? U.fmtKm(m.length_km) : null, A.travelMode(m.travel_mode)].filter(Boolean).join(' · ')))));
      // facilities stacked bar
      var bar = h('div', { class: 'ad-ov-stack', role: 'img', 'aria-label': t('ad.ov.r_verified', { v: r.verified, target: TARGET_PER_ROUTE }) + ' · ' + t('ad.ov.r_stale') + ' ' + r.stale + ' · ' + t('ad.ov.r_pending') + ' ' + r.pending },
        h('span', { class: 'ad-ov-stack__seg ad-ov-stack__seg--fresh', style: 'width:' + (fresh / denom * 100).toFixed(2) + '%' }),
        h('span', { class: 'ad-ov-stack__seg ad-ov-stack__seg--stale', style: 'width:' + (r.stale / denom * 100).toFixed(2) + '%' }),
        h('span', { class: 'ad-ov-stack__seg ad-ov-stack__seg--pending', style: 'width:' + (r.pending / denom * 100).toFixed(2) + '%' }),
        h('span', { class: 'ad-ov-stack__target', style: 'left:' + Math.min(100, TARGET_PER_ROUTE / denom * 100).toFixed(2) + '%' }));
      card.appendChild(h('div', { class: 'ad-ov-route__fac' },
        h('div', { class: 'ad-ov-route__row' },
          h('b', { class: 'ad-ov-route__big tabular' }, String(r.verified), h('small', null, '/' + TARGET_PER_ROUTE)),
          h('span', { class: 'ad-ov-route__pct tabular' }, Math.round(r.verified / TARGET_PER_ROUTE * 100) + '%')),
        bar,
        h('div', { class: 'ad-legend ad-ov-route__legend' },
          h('span', { class: 'ad-legend__item' }, h('span', { class: 'ad-swatch ad-swatch--verified' }), t('ad.ov.r_fresh') + ' ' + fresh),
          h('span', { class: 'ad-legend__item' }, h('span', { class: 'ad-swatch ad-swatch--stale' }), t('ad.ov.r_stale') + ' ' + r.stale),
          h('span', { class: 'ad-legend__item' }, h('span', { class: 'ad-swatch ad-swatch--pending' }), t('ad.ov.r_pending') + ' ' + r.pending))));
      // accuracy
      var accRows = A.carriers().map(function (c) {
        var a = r.accuracy ? r.accuracy[c.id] : null;
        var v = a === null || a === undefined ? 0 : Math.round(a * 1000) / 10;
        return { label: c.name, value: v, color: v >= 90 ? 'success' : v >= 80 ? 'primary' : 'warning' };
      });
      card.appendChild(h('div', { class: 'ad-ov-route__acc' },
        h('p', { class: 'ad-ov-route__label' }, t('ad.ov.r_accuracy')),
        NC.viz.bars(accRows, { max: 100, unit: '%', rowHeight: 30 })));
      card.appendChild(h('div', { class: 'ad-ov-route__foot' },
        h('span', { class: 'ad-ov-route__samples', html: icon('signal', 'icon--sm') + '<span>' + U.esc(t('ad.ov.r_samples', { n: num(r.samples) })) + '</span>' }),
        h('button', { type: 'button', class: 'btn btn--soft btn--sm', 'data-map-route': r.id, html: icon('map') + '<span>' + U.esc(t('ad.ov.r_show_map')) + '</span>' })));
      els.routes.appendChild(card);
    });
  }

  /* ---- facility mix ---- */
  var TYPE_TONE = { benh_vien: 'danger', tram_y_te: 'primary', phong_kham: 'info', nha_thuoc: 'success' };
  function renderMix() {
    var ver = S.facs.filter(function (f) { return f.status === 'verified'; });
    var by = {};
    ver.forEach(function (f) { by[f.type] = (by[f.type] || 0) + 1; });
    var types = ['tram_y_te', 'phong_kham', 'benh_vien', 'nha_thuoc'];
    var parts = types.map(function (ty) { return { label: A.facType(ty), value: by[ty] || 0, color: TYPE_TONE[ty] }; });
    var trauma = ver.filter(function (f) { return f.trauma_capable === true; }).length;
    var night = ver.filter(function (f) { return f.night_shift === true; }).length;
    els.mix.innerHTML = '';
    els.mix.appendChild(h('div', { class: 'ad-card-head' },
      h('div', { class: 'ad-card-head__title' }, h('span', { class: 'icon-tile icon-tile--success', html: icon('hospital') }),
        h('span', null, t('ad.ov.mix_title'), h('span', { class: 'ad-card-head__sub', style: 'display:block' }, t('ad.ov.mix_sub'))))));
    var legend = h('ul', { class: 'ad-ov-mix__legend' });
    parts.forEach(function (p, i) {
      legend.appendChild(h('li', null, h('span', { class: 'ad-swatch ad-ov-mix__sw--' + types[i] }), h('span', { class: 'ad-ov-mix__name' }, p.label), h('b', { class: 'tabular' }, String(p.value))));
    });
    els.mix.appendChild(h('div', { class: 'ad-ov-mix__body' },
      h('div', { class: 'ad-ov-mix__donut' }, NC.viz.donut(parts, { size: 132, stroke: 18, label: String(ver.length), sublabel: t('ad.ov.mix_total') })),
      legend));
    els.mix.appendChild(h('div', { class: 'ad-ov-mix__caps' },
      h('span', { class: 'ad-ov-cap', html: icon('bandage', 'icon--sm') + '<span>' + U.esc(t('ad.ov.mix_trauma')) + '</span><b class="tabular">' + trauma + '</b>' }),
      h('span', { class: 'ad-ov-cap', html: icon('moon', 'icon--sm') + '<span>' + U.esc(t('ad.ov.mix_night')) + '</span><b class="tabular">' + night + '</b>' })));
  }

  /* ---- packs matrix ---- */
  function renderPacks() {
    var carriers = A.carriers();
    els.packs.innerHTML = '';
    els.packs.appendChild(h('div', { class: 'ad-card-head' },
      h('div', { class: 'ad-card-head__title' }, h('span', { class: 'icon-tile icon-tile--info', html: icon('package') }),
        h('span', null, t('ad.ov.packs_title'), h('span', { class: 'ad-card-head__sub', style: 'display:block' }, t('ad.ov.packs_sub')))),
      h('a', { class: 'btn btn--ghost btn--sm', href: '#/packs', html: '<span>' + U.esc(t('ad.ov.packs_open')) + '</span>' + icon('chevron-right') })));
    // table--keep scrolls sideways on phones → keyboard-focusable, named region (axe scrollable-region-focusable).
    var tbl = h('table', { class: 'table table--keep ad-ov-matrix', tabindex: '0', 'aria-label': t('ad.ov.packs_title') });
    var hr = h('tr', null, h('th', { scope: 'col' }, t('ad.ov.lg_route')));
    carriers.forEach(function (c) { hr.appendChild(h('th', { scope: 'col' }, c.name)); });
    tbl.appendChild(h('thead', null, hr));
    var tb = h('tbody');
    A.routes().forEach(function (r) {
      var tr = h('tr', null, h('th', { scope: 'row' }, h('span', { class: 'ad-ov-dot', style: 'background:' + r.color }), A.routeName(r.id, { short: true })));
      carriers.forEach(function (c) {
        var p = packFor(r.id, c.id);
        tr.appendChild(h('td', null, p ? h('span', { class: 'ad-ov-pack' }, h('b', null, 'v' + p.version), h('small', null, U.fmtDate(p.published_at))) : h('span', { class: 'muted' }, '—')));
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    els.packs.appendChild(h('div', { class: 'ad-ov-matrix-wrap' }, tbl));
  }

  /* ------------------------------------------------------------------ events */
  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-map-route]') : null;
    if (b) {
      e.preventDefault();
      setMapRoute(b.getAttribute('data-map-route'));
      if (!b.closest('.ad-ov-maphead')) els.mapCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function show() {
    S.visible = true;
    load();
    if (S.map) NC.mapkit.refresh(S.map);
    clearInterval(S.timer);
    S.timer = setInterval(function () { if (S.visible) renderFeed(); }, 30000);
  }
  function hide() {
    S.visible = false;
    clearInterval(S.timer);
  }

  A.register('overview', { titleKey: 'ad.ov.title', navKey: 'ad.ov.nav', icon: 'grid', order: 0, group: 'main', mount: mount, show: show, hide: hide });
})(window.NC = window.NC || {});
