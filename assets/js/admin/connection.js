/*
 * connection.js — Admin "Kết nối & cấu hình" page (owner: P2 admin-core). Registers NC.admin page 'connection'.
 * Server mode (Supabase | local simulated server), masked project URL / anon key, connection test (admin RPC latency),
 * realtime status + recent event log, row counts per table, Supabase setup steps (summary of supabase/README.md),
 * security notes, and in local mode "reset demo data" (NC.data.admin.resetDemo) with confirmation.
 */
(function (NC) {
  'use strict';

  var U = NC.util, h = U.h;
  var A = NC.admin;
  function t(k, v) { return NC.i18n.t(k, v); }
  function icon(n, c) { return NC.ui.icon(n, c); }

  var TABLES = ['routes', 'route_nodes', 'route_edges', 'signal_samples', 'signal_segments', 'route_accuracy', 'facilities', 'services',
    'facility_submissions', 'data_packs', 'content_releases', 'devices', 'buddy_sessions', 'checkin_events', 'audit_log'];
  var REALTIME_SUPABASE = ['buddy_sessions', 'checkin_events', 'facility_submissions', 'facilities', 'signal_samples'];
  var STEPS = ['project', 'migrations', 'seed', 'admin', 'cron', 'function', 'connect'];

  NC.i18n.add({
    vi: {
      'ad.conn.title': 'Kết nối & cấu hình', 'ad.conn.nav': 'Kết nối',
      'ad.conn.head': 'Kết nối tầng máy chủ',
      'ad.conn.sub': 'Bảng điều khiển đọc và ghi trực tiếp vào cơ sở dữ liệu; ứng dụng tải gói dữ liệu do máy chủ phát hành. Trang này cho biết đang nối với máy chủ nào và tình trạng kết nối.',
      'ad.conn.mode_title': 'Chế độ máy chủ',
      'ad.conn.local_desc': 'Máy chủ mô phỏng chạy ngay trong trình duyệt (IndexedDB “nomadcare-server”), cùng tên hàm và ngữ nghĩa với các RPC của Supabase. Dùng cho demo không cần mạng.',
      'ad.conn.supabase_desc': 'PostgreSQL + PostGIS trên Supabase. Mọi quyền ghi của thiết bị đi qua hàm RPC SECURITY DEFINER; bảng dữ liệu bật RLS.',
      'ad.conn.k.mode': 'Chế độ', 'ad.conn.k.url': 'Project URL', 'ad.conn.k.key': 'Khoá anon (công khai)', 'ad.conn.k.functions': 'Edge Functions',
      'ad.conn.k.storage': 'Lưu trữ', 'ad.conn.k.realtime': 'Realtime', 'ad.conn.k.app': 'Phiên bản ứng dụng', 'ad.conn.k.content': 'Nội dung y tế đóng gói',
      'ad.conn.k.user': 'Tài khoản', 'ad.conn.k.cron': 'Cron quá hạn',
      'ad.conn.not_set': 'Chưa cấu hình', 'ad.conn.derived': 'suy ra từ Project URL',
      'ad.conn.storage_idb': 'IndexedDB (bền vững trong trình duyệt này)', 'ad.conn.storage_mem': 'Bộ nhớ tạm (mất khi tải lại)',
      'ad.conn.rt_local': 'BroadcastChannel giữa các tab cùng trình duyệt', 'ad.conn.rt_local_fb': 'Sự kiện localStorage (dự phòng)', 'ad.conn.rt_supabase': 'postgres_changes (Supabase Realtime)',
      'ad.conn.cron_local': 'Mỗi 15 giây ở tab giữ khoá (mô phỏng pg_cron)', 'ad.conn.cron_supabase': 'pg_cron mỗi phút → Edge Function deadman-alert',
      'ad.conn.test': 'Kiểm tra kết nối', 'ad.conn.test_ok': 'Máy chủ phản hồi sau {ms} ms · quyền quản trị hợp lệ', 'ad.conn.test_fail': 'Không kết nối được: {msg}',
      'ad.conn.status_ok': 'Đã kết nối', 'ad.conn.status_fail': 'Lỗi kết nối', 'ad.conn.status_unknown': 'Chưa kiểm tra',
      'ad.conn.rt_title': 'Realtime', 'ad.conn.rt_sub': 'Một kênh duy nhất cho cả bảng điều khiển; KPI và danh sách tự cập nhật.',
      'ad.conn.rt_events': 'Sự kiện nhận trong phiên này', 'ad.conn.rt_last': 'Sự kiện gần nhất', 'ad.conn.rt_tables': 'Bảng được theo dõi',
      'ad.conn.rt_log': 'Nhật ký sự kiện gần đây', 'ad.conn.rt_empty': 'Chưa có sự kiện. Mở ứng dụng ở tab khác và bật Buddy để thấy dữ liệu chảy về.',
      'ad.conn.rt_try': 'Mở ứng dụng (tab mới)',
      'ad.conn.tables_title': 'Số bản ghi theo bảng', 'ad.conn.tables_sub': 'Đếm trực tiếp trên cơ sở dữ liệu hiện tại.',
      'ad.conn.tables_na': 'Không đếm được', 'ad.conn.refresh_counts': 'Đếm lại',
      'ad.conn.tbl.routes': 'Cung đường', 'ad.conn.tbl.route_nodes': 'Nút định tuyến', 'ad.conn.tbl.route_edges': 'Đoạn tuyến',
      'ad.conn.tbl.signal_samples': 'Mẫu sóng', 'ad.conn.tbl.signal_segments': 'Đoạn phân loại sóng', 'ad.conn.tbl.route_accuracy': 'Độ tin cậy held-out',
      'ad.conn.tbl.facilities': 'Điểm y tế', 'ad.conn.tbl.services': 'Dịch vụ & đối tác', 'ad.conn.tbl.facility_submissions': 'Đóng góp cộng đồng',
      'ad.conn.tbl.data_packs': 'Gói dữ liệu', 'ad.conn.tbl.content_releases': 'Phát hành nội dung y tế', 'ad.conn.tbl.devices': 'Thiết bị ẩn danh',
      'ad.conn.tbl.buddy_sessions': 'Phiên Buddy', 'ad.conn.tbl.checkin_events': 'Sự kiện check-in', 'ad.conn.tbl.audit_log': 'Nhật ký kiểm toán',
      'ad.conn.setup_title': 'Các bước cài đặt Supabase', 'ad.conn.setup_sub': 'Tóm tắt supabase/README.md — khoảng 20 phút cho project mới.',
      'ad.conn.setup_open': 'Mở hướng dẫn đầy đủ',
      'ad.conn.step.project': 'Tạo project Supabase (region Singapore ap-southeast-1)',
      'ad.conn.step.migrations': 'Chạy supabase/setup_all.sql trong SQL Editor (PostGIS, bảng, RLS, RPC)',
      'ad.conn.step.seed': 'Nạp dữ liệu mẫu supabase/seed.sql và phát hành gói lần đầu',
      'ad.conn.step.admin': 'Tạo tài khoản quản trị (Auth) và thêm vào admin_users; tắt đăng ký tự do',
      'ad.conn.step.cron': 'Bật pg_cron + pg_net, lưu functions_url và cron_secret',
      'ad.conn.step.function': 'Deploy Edge Function deadman-alert + secret RESEND_API_KEY',
      'ad.conn.step.connect': 'Điền supabaseUrl + supabaseAnonKey vào assets/js/config.js',
      'ad.conn.step_done': 'Đã xong', 'ad.conn.step_check': 'Kiểm tra trên Dashboard', 'ad.conn.step_todo': 'Chưa',
      'ad.conn.local_title': 'Dữ liệu demo cục bộ',
      'ad.conn.local_text': 'Đặt lại xoá mọi thay đổi trên máy chủ mô phỏng (duyệt, sửa điểm y tế, phiên Buddy mới…) và nạp lại bộ dữ liệu minh hoạ ban đầu. Dữ liệu cá nhân trong ứng dụng người dùng không bị ảnh hưởng.',
      'ad.conn.reset': 'Đặt lại dữ liệu demo', 'ad.conn.reset_q': 'Đặt lại toàn bộ dữ liệu demo?',
      'ad.conn.reset_msg': 'Mọi thay đổi trên máy chủ mô phỏng sẽ mất và bộ dữ liệu minh hoạ được nạp lại. Các tab khác nhận sự kiện đặt lại ngay.',
      'ad.conn.reset_done': 'Đã nạp lại dữ liệu demo', 'ad.conn.reset_na': 'Chỉ có ở chế độ cục bộ.',
      'ad.conn.sec_title': 'Bảo mật & quyền riêng tư',
      'ad.conn.sec1': 'Khoá anon được phép công khai: thiết bị chỉ gọi hàm RPC, không có quyền trực tiếp trên bảng.',
      'ad.conn.sec2': 'Mọi bảng bật Row Level Security; chỉ tài khoản trong admin_users đọc/ghi được dữ liệu quản trị.',
      'ad.conn.sec3': 'Không bao giờ đặt khoá service_role trong mã phía trình duyệt.',
      'ad.conn.sec4': 'Hồ sơ y tế được mã hoá trên máy người dùng và không bao giờ đồng bộ lên máy chủ — chỉ lớp y tế công khai được người dùng đồng ý gửi kèm cảnh báo Buddy.',
      'ad.conn.device_title': 'Ứng dụng người dùng trên trình duyệt này',
      'ad.conn.k.outbox': 'Hàng đợi gửi', 'ad.conn.k.device': 'Mã thiết bị', 'ad.conn.k.sync': 'Đồng bộ gần nhất', 'ad.conn.ops': '{n} thao tác'
    },
    en: {
      'ad.conn.title': 'Connection & setup', 'ad.conn.nav': 'Connection',
      'ad.conn.head': 'Server-tier connection',
      'ad.conn.sub': 'The dashboard reads and writes the database directly; the app downloads the data packs the server publishes. This page shows which server is connected and its health.',
      'ad.conn.mode_title': 'Server mode',
      'ad.conn.local_desc': 'A simulated server running inside the browser (IndexedDB “nomadcare-server”) with the same function names and semantics as the Supabase RPCs. Used for offline demos.',
      'ad.conn.supabase_desc': 'PostgreSQL + PostGIS on Supabase. Every device write goes through SECURITY DEFINER RPC functions; tables have RLS enabled.',
      'ad.conn.k.mode': 'Mode', 'ad.conn.k.url': 'Project URL', 'ad.conn.k.key': 'Anon key (public)', 'ad.conn.k.functions': 'Edge Functions',
      'ad.conn.k.storage': 'Storage', 'ad.conn.k.realtime': 'Realtime', 'ad.conn.k.app': 'App version', 'ad.conn.k.content': 'Bundled medical content',
      'ad.conn.k.user': 'Account', 'ad.conn.k.cron': 'Overdue cron',
      'ad.conn.not_set': 'Not configured', 'ad.conn.derived': 'derived from Project URL',
      'ad.conn.storage_idb': 'IndexedDB (persistent in this browser)', 'ad.conn.storage_mem': 'Memory (lost on reload)',
      'ad.conn.rt_local': 'BroadcastChannel between tabs of this browser', 'ad.conn.rt_local_fb': 'localStorage events (fallback)', 'ad.conn.rt_supabase': 'postgres_changes (Supabase Realtime)',
      'ad.conn.cron_local': 'Every 15 s in the tab holding the lease (simulated pg_cron)', 'ad.conn.cron_supabase': 'pg_cron every minute → deadman-alert Edge Function',
      'ad.conn.test': 'Test connection', 'ad.conn.test_ok': 'Server answered in {ms} ms · admin rights valid', 'ad.conn.test_fail': 'Connection failed: {msg}',
      'ad.conn.status_ok': 'Connected', 'ad.conn.status_fail': 'Connection error', 'ad.conn.status_unknown': 'Not tested',
      'ad.conn.rt_title': 'Realtime', 'ad.conn.rt_sub': 'One channel for the whole dashboard; KPIs and lists update themselves.',
      'ad.conn.rt_events': 'Events received this session', 'ad.conn.rt_last': 'Latest event', 'ad.conn.rt_tables': 'Tables watched',
      'ad.conn.rt_log': 'Recent events', 'ad.conn.rt_empty': 'No events yet. Open the app in another tab and start Buddy to see data flowing in.',
      'ad.conn.rt_try': 'Open the app (new tab)',
      'ad.conn.tables_title': 'Rows per table', 'ad.conn.tables_sub': 'Counted live on the current database.',
      'ad.conn.tables_na': 'Not countable', 'ad.conn.refresh_counts': 'Recount',
      'ad.conn.tbl.routes': 'Routes', 'ad.conn.tbl.route_nodes': 'Routing nodes', 'ad.conn.tbl.route_edges': 'Route edges',
      'ad.conn.tbl.signal_samples': 'Signal samples', 'ad.conn.tbl.signal_segments': 'Classified segments', 'ad.conn.tbl.route_accuracy': 'Held-out accuracy',
      'ad.conn.tbl.facilities': 'Medical facilities', 'ad.conn.tbl.services': 'Services & partners', 'ad.conn.tbl.facility_submissions': 'Community contributions',
      'ad.conn.tbl.data_packs': 'Data packs', 'ad.conn.tbl.content_releases': 'Medical content releases', 'ad.conn.tbl.devices': 'Anonymous devices',
      'ad.conn.tbl.buddy_sessions': 'Buddy sessions', 'ad.conn.tbl.checkin_events': 'Check-in events', 'ad.conn.tbl.audit_log': 'Audit log',
      'ad.conn.setup_title': 'Supabase setup steps', 'ad.conn.setup_sub': 'Summary of supabase/README.md — about 20 minutes for a new project.',
      'ad.conn.setup_open': 'Open the full guide',
      'ad.conn.step.project': 'Create a Supabase project (region Singapore ap-southeast-1)',
      'ad.conn.step.migrations': 'Run supabase/setup_all.sql in the SQL Editor (PostGIS, tables, RLS, RPCs)',
      'ad.conn.step.seed': 'Load supabase/seed.sql and publish the first packs',
      'ad.conn.step.admin': 'Create the admin account (Auth), add it to admin_users, disable public sign-up',
      'ad.conn.step.cron': 'Enable pg_cron + pg_net, store functions_url and cron_secret',
      'ad.conn.step.function': 'Deploy the deadman-alert Edge Function + RESEND_API_KEY secret',
      'ad.conn.step.connect': 'Put supabaseUrl + supabaseAnonKey in assets/js/config.js',
      'ad.conn.step_done': 'Done', 'ad.conn.step_check': 'Check in the Dashboard', 'ad.conn.step_todo': 'To do',
      'ad.conn.local_title': 'Local demo data',
      'ad.conn.local_text': 'Resetting discards every change on the simulated server (reviews, facility edits, new Buddy sessions…) and reloads the original illustrative dataset. Personal data in the traveller app is not touched.',
      'ad.conn.reset': 'Reset demo data', 'ad.conn.reset_q': 'Reset all demo data?',
      'ad.conn.reset_msg': 'Every change on the simulated server is lost and the illustrative dataset is reloaded. Other tabs receive the reset event immediately.',
      'ad.conn.reset_done': 'Demo data reloaded', 'ad.conn.reset_na': 'Local mode only.',
      'ad.conn.sec_title': 'Security & privacy',
      'ad.conn.sec1': 'The anon key is public by design: devices can only call RPC functions, never tables directly.',
      'ad.conn.sec2': 'Every table has Row Level Security; only accounts in admin_users can read or write admin data.',
      'ad.conn.sec3': 'Never put the service_role key in browser code.',
      'ad.conn.sec4': 'Medical profiles are encrypted on the traveller’s device and never synced — only the public medical layer the traveller consents to attach to a Buddy alert.',
      'ad.conn.device_title': 'Traveller app in this browser',
      'ad.conn.k.outbox': 'Outbox', 'ad.conn.k.device': 'Device ID', 'ad.conn.k.sync': 'Last sync', 'ad.conn.ops': '{n} operations'
    }
  });

  /* ------------------------------------------------------------------ state */
  var root = null, els = {};
  var S = { visible: false, test: null, counts: null, log: [], events: 0, countSeq: 0 };

  function cfg() { return window.NC_CONFIG || {}; }
  function maskKey(k) { var s = String(k || ''); return s.length > 12 ? s.slice(0, 6) + '••••' + s.slice(-4) : (s ? '••••' : ''); }

  function mount(section) {
    root = section;
    root.classList.add('ad-conn');
    A.live(function (msg) {
      if (!msg) return;
      S.events++;
      S.log.unshift({ at: new Date(), table: msg.table, type: msg.type });
      if (S.log.length > 12) S.log.length = 12;
      if (S.visible) renderRealtime();
      if (msg.table === '*' && S.visible) countTables();
    });
    NC.bus.on('i18n:change', function () { if (root && S.visible) render(); });
    root.addEventListener('click', onClick);
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    root.innerHTML = '';
    var m = A.mode();
    root.appendChild(A.pageHead({
      icon: 'server', title: t('ad.conn.head'), sub: t('ad.conn.sub'),
      actions: [h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-conn': 'test', html: icon('activity') + '<span>' + U.esc(t('ad.conn.test')) + '</span>' })]
    }));
    els.mode = h('section', { class: 'card ad-conn-mode' });
    els.rt = h('section', { class: 'card ad-conn-rt' });
    els.tables = h('section', { class: 'card ad-conn-tables' });
    els.setup = h('section', { class: 'card ad-conn-setup' });
    els.side = h('div', { class: 'stack ad-conn-side' });
    root.appendChild(h('div', { class: 'ad-grid ad-grid--main ad-conn-top' }, els.mode, els.rt));
    root.appendChild(h('div', { class: 'ad-grid ad-grid--main ad-conn-bottom' }, els.tables, els.side));
    els.side.appendChild(els.setup);
    if (m === 'local') els.side.appendChild(renderLocal());
    els.side.appendChild(renderSecurity());
    renderMode();
    renderRealtime();
    renderTables();
    renderSetup();
  }

  function cardHead(ic, tone, title, sub, extra) {
    return h('div', { class: 'ad-card-head' },
      h('div', { class: 'ad-card-head__title' }, h('span', { class: 'icon-tile icon-tile--' + tone, html: icon(ic) }),
        h('span', null, title, sub ? h('span', { class: 'ad-card-head__sub', style: 'display:block' }, sub) : null)),
      extra || null);
  }

  function renderMode() {
    var m = A.mode();
    var c = cfg();
    var sess = A.session() || {};
    var local = NC.backend && NC.backend.local;
    var st = S.test;
    var status = !st ? NC.ui.badge(t('ad.conn.status_unknown'), 'neutral', 'help-circle') : st.ok ? NC.ui.badge(t('ad.conn.status_ok'), 'success', 'check-circle') : NC.ui.badge(t('ad.conn.status_fail'), 'danger', 'alert-circle');
    els.mode.innerHTML = '';
    els.mode.appendChild(h('div', { class: 'ad-conn-hero' },
      h('span', { class: 'icon-tile icon-tile--xl ' + (m === 'supabase' ? 'icon-tile--success' : 'icon-tile--accent'), html: icon(m === 'supabase' ? 'database' : 'hard-drive') }),
      h('div', { class: 'ad-conn-hero__text' },
        h('p', { class: 'eyebrow' }, t('ad.conn.mode_title')),
        h('h3', { class: 'ad-conn-hero__title' }, t('ad.core.mode.' + m + '_long')),
        h('div', { class: 'cluster' }, NC.ui.badge(t('ad.core.mode.' + m), m === 'supabase' ? 'success' : 'accent'), status),
        h('p', { class: 'ad-conn-hero__desc' }, t(m === 'supabase' ? 'ad.conn.supabase_desc' : 'ad.conn.local_desc')))));
    if (st) {
      els.mode.appendChild(h('p', { class: 'ad-conn-test ad-conn-test--' + (st.ok ? 'ok' : 'fail'), role: 'status', html: icon(st.ok ? 'check-circle' : 'alert-triangle') + '<span>' + U.esc(st.ok ? t('ad.conn.test_ok', { ms: st.ms }) : t('ad.conn.test_fail', { msg: st.msg })) + '</span>' }));
    }
    var fnUrl = c.functionsUrl || (c.supabaseUrl ? c.supabaseUrl.replace(/\/$/, '') + '/functions/v1' : '');
    var rows = [
      [t('ad.conn.k.mode'), t('ad.core.mode.' + m)],
      [t('ad.conn.k.url'), c.supabaseUrl ? h('span', { class: 'ad-mono' }, A.maskUrl(c.supabaseUrl)) : h('span', { class: 'muted' }, t('ad.conn.not_set'))],
      [t('ad.conn.k.key'), c.supabaseAnonKey ? h('span', { class: 'ad-mono' }, maskKey(c.supabaseAnonKey)) : h('span', { class: 'muted' }, t('ad.conn.not_set'))],
      [t('ad.conn.k.functions'), fnUrl ? h('span', { class: 'ad-mono' }, A.maskUrl(fnUrl) + (c.functionsUrl ? '' : ' (' + t('ad.conn.derived') + ')')) : h('span', { class: 'muted' }, t('ad.conn.not_set'))]
    ];
    if (m === 'local') rows.push([t('ad.conn.k.storage'), local && local.storage === 'memory' ? t('ad.conn.storage_mem') : t('ad.conn.storage_idb')]);
    rows.push([t('ad.conn.k.realtime'), m === 'supabase' ? t('ad.conn.rt_supabase') : (typeof BroadcastChannel !== 'undefined' ? t('ad.conn.rt_local') : t('ad.conn.rt_local_fb'))]);
    rows.push([t('ad.conn.k.cron'), t(m === 'supabase' ? 'ad.conn.cron_supabase' : 'ad.conn.cron_local')]);
    rows.push([t('ad.conn.k.user'), (sess.user && sess.user.email) || '—']);
    rows.push([t('ad.conn.k.app'), 'v' + (c.appVersion || '2') + ' · ' + t('ad.conn.k.content') + ' ' + (c.contentVersion || '—')]);
    els.mode.appendChild(A.kv(rows, 'ad-conn-kv'));
    // device tier on this browser
    var ds = NC.data.status ? NC.data.status() : {};
    els.mode.appendChild(h('h4', { class: 'ad-section__title ad-conn-subtitle', html: icon('smartphone') + '<span>' + U.esc(t('ad.conn.device_title')) + '</span>' }));
    els.mode.appendChild(A.kv([
      [t('ad.conn.k.outbox'), t('ad.conn.ops', { n: ds.outboxCount || 0 })],
      [t('ad.conn.k.device'), ds.deviceId ? h('span', { class: 'ad-mono' }, String(ds.deviceId).slice(0, 8) + '…') : '—'],
      [t('ad.conn.k.sync'), ds.lastSyncAt ? U.fmtDateTime(ds.lastSyncAt) : t('common.never')]
    ], 'ad-conn-kv'));
  }

  function renderRealtime() {
    if (!els.rt) return;
    var m = A.mode();
    var state = A.liveState();
    var tables = m === 'supabase' ? REALTIME_SUPABASE : TABLES.filter(function (x) { return ['route_nodes', 'route_edges', 'signal_segments', 'route_accuracy', 'devices'].indexOf(x) < 0; });
    els.rt.innerHTML = '';
    els.rt.appendChild(cardHead('radio', 'info', t('ad.conn.rt_title'), t('ad.conn.rt_sub'),
      h('span', { class: 'ad-live ad-conn-live', 'data-state': state }, h('span', { class: 'ad-live-dot', 'data-live-dot': '', 'data-state': state }), h('span', { class: 'ad-live__label', style: 'display:inline' }, t('ad.core.live.' + state)))));
    els.rt.appendChild(h('div', { class: 'ad-conn-stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat__value tabular' }, String(S.events)), h('span', { class: 'stat__label' }, t('ad.conn.rt_events'))),
      h('div', { class: 'stat' }, h('span', { class: 'stat__value tabular' }, S.log.length ? U.fmtTime(S.log[0].at) : '—'), h('span', { class: 'stat__label' }, t('ad.conn.rt_last')))));
    var chips = h('div', { class: 'chip-group ad-conn-chips' });
    tables.forEach(function (x) { chips.appendChild(h('span', { class: 'badge badge--neutral ad-mono' }, x)); });
    els.rt.appendChild(h('p', { class: 'ad-conn-label' }, t('ad.conn.rt_tables')));
    els.rt.appendChild(chips);
    els.rt.appendChild(h('p', { class: 'ad-conn-label' }, t('ad.conn.rt_log')));
    if (!S.log.length) {
      els.rt.appendChild(h('div', { class: 'ad-conn-empty' },
        h('p', { class: 'ad-muted-note', html: icon('info') + '<span>' + U.esc(t('ad.conn.rt_empty')) + '</span>' }),
        h('a', { class: 'btn btn--soft btn--sm', href: 'index.html?demo=1#/buddy', target: '_blank', rel: 'noopener', html: icon('external-link') + '<span>' + U.esc(t('ad.conn.rt_try')) + '</span>' })));
    } else {
      var ol = h('ol', { class: 'ad-conn-log' });
      S.log.forEach(function (e) {
        ol.appendChild(h('li', null, h('span', { class: 'ad-mono ad-conn-log__time' }, U.fmtTime(e.at) + ':' + ('0' + e.at.getSeconds()).slice(-2)),
          h('span', { class: 'badge ad-conn-log__type ad-conn-log__type--' + String(e.type || '').toLowerCase() }, e.type || '?'),
          h('span', { class: 'ad-mono ad-conn-log__table' }, e.table)));
      });
      els.rt.appendChild(ol);
    }
  }

  function renderTables() {
    els.tables.innerHTML = '';
    els.tables.appendChild(cardHead('database', 'primary', t('ad.conn.tables_title'), t('ad.conn.tables_sub'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-conn': 'count', html: icon('refresh') + '<span>' + U.esc(t('ad.conn.refresh_counts')) + '</span>' })));
    var grid = h('div', { class: 'ad-conn-grid' });
    TABLES.forEach(function (name) {
      var v = S.counts ? S.counts[name] : undefined;
      grid.appendChild(h('div', { class: 'ad-conn-tile' },
        h('span', { class: 'ad-conn-tile__n tabular' }, v === undefined ? h('span', { class: 'skeleton skeleton--text', style: 'width:48px;display:inline-block' }) : v === null ? '—' : U.fmtNumber(v)),
        h('span', { class: 'ad-conn-tile__label' }, t('ad.conn.tbl.' + name)),
        h('span', { class: 'ad-conn-tile__name ad-mono' }, name)));
    });
    els.tables.appendChild(grid);
  }

  function countTables() {
    var k = ++S.countSeq;
    var m = A.mode();
    var jobs = TABLES.map(function (name) {
      if (m === 'local') {
        var dbg = NC.backend && NC.backend.local && NC.backend.local._debug;
        if (!dbg || !dbg.all) return Promise.resolve(null);
        return dbg.all(name).then(function (rows) { return rows.length; }).catch(function () { return null; });
      }
      try {
        var client = NC.backend.supabase.client();
        return Promise.resolve(client.from(name).select('*', { count: 'exact', head: true })).then(function (r) { return r && !r.error ? r.count : null; }).catch(function () { return null; });
      } catch (e) { return Promise.resolve(null); }
    });
    return Promise.all(jobs).then(function (vals) {
      if (k !== S.countSeq) return;
      S.counts = {};
      TABLES.forEach(function (n, i) { S.counts[n] = vals[i]; });
      if (S.visible) renderTables();
    });
  }

  function renderSetup() {
    var m = A.mode();
    var c = cfg();
    var connected = m === 'supabase' && (!S.test || S.test.ok);
    els.setup.innerHTML = '';
    els.setup.appendChild(cardHead('list-checks', 'success', t('ad.conn.setup_title'), t('ad.conn.setup_sub')));
    var ol = h('ol', { class: 'ad-conn-steps' });
    STEPS.forEach(function (s, i) {
      var state;
      if (s === 'connect') state = c.supabaseUrl && c.supabaseAnonKey ? 'done' : 'todo';
      else if (connected && (s === 'project' || s === 'migrations' || s === 'seed' || s === 'admin')) state = 'done';
      else state = m === 'supabase' ? 'check' : 'todo';
      ol.appendChild(h('li', { class: 'ad-conn-step ad-conn-step--' + state },
        h('span', { class: 'ad-conn-step__n', html: state === 'done' ? icon('check') : String(i + 1) }),
        h('span', { class: 'ad-conn-step__text' }, t('ad.conn.step.' + s)),
        h('span', { class: 'ad-conn-step__state' }, t(state === 'done' ? 'ad.conn.step_done' : state === 'check' ? 'ad.conn.step_check' : 'ad.conn.step_todo'))));
    });
    els.setup.appendChild(ol);
    els.setup.appendChild(h('a', { class: 'btn btn--outline btn--sm', href: 'supabase/README.md', target: '_blank', rel: 'noopener', html: icon('book-open') + '<span>' + U.esc(t('ad.conn.setup_open')) + '</span>' + icon('external-link', 'icon--xs') }));
  }

  function renderLocal() {
    return h('section', { class: 'card ad-conn-local' },
      cardHead('rotate-ccw', 'warning', t('ad.conn.local_title')),
      h('p', { class: 'ad-conn-p' }, t('ad.conn.local_text')),
      h('button', { type: 'button', class: 'btn btn--outline ad-btn-danger-ghost', 'data-conn': 'reset', html: icon('rotate-ccw') + '<span>' + U.esc(t('ad.conn.reset')) + '</span>' }));
  }

  function renderSecurity() {
    var ul = h('ul', { class: 'ad-conn-sec' });
    ['sec1', 'sec2', 'sec3', 'sec4'].forEach(function (k, i) {
      ul.appendChild(h('li', { html: icon(['key', 'shield-check', 'lock', 'heart-pulse'][i]) + '<span>' + U.esc(t('ad.conn.' + k)) + '</span>' }));
    });
    return h('section', { class: 'card ad-conn-security' }, cardHead('shield', 'primary', t('ad.conn.sec_title')), ul);
  }

  /* ------------------------------------------------------------------ actions */
  function testConnection(btn, silent) {
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    NC.ui.setLoading(btn, true);
    return NC.data.admin.kpis().then(function () {
      var ms = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);
      S.test = { ok: true, ms: ms, at: new Date() };
    }, function (e) {
      S.test = { ok: false, msg: A.errorText(e), at: new Date() };
    }).then(function () {
      NC.ui.setLoading(btn, false);
      if (S.visible) { renderMode(); renderSetup(); }
      if (!silent || !S.test.ok) NC.ui.toast(S.test.ok ? t('ad.conn.test_ok', { ms: S.test.ms }) : t('ad.conn.test_fail', { msg: S.test.msg }), { type: S.test.ok ? 'success' : 'danger' });
    });
  }

  function resetDemo(btn) {
    if (A.mode() !== 'local') { NC.ui.toast(t('ad.conn.reset_na'), { type: 'warning' }); return; }
    NC.ui.confirm({ title: t('ad.conn.reset_q'), message: t('ad.conn.reset_msg'), confirmLabel: t('ad.conn.reset'), danger: true }).then(function (ok) {
      if (!ok) return;
      NC.ui.setLoading(btn, true);
      NC.data.admin.resetDemo().then(function () {
        NC.ui.setLoading(btn, false);
        NC.ui.toast(t('ad.conn.reset_done'), { type: 'success' });
        A.refreshBadges();
        countTables();
      }, function (e) {
        NC.ui.setLoading(btn, false);
        NC.ui.toast(A.errorText(e), { type: 'danger' });
      });
    });
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-conn]') : null;
    if (!b) return;
    var a = b.getAttribute('data-conn');
    if (a === 'test') testConnection(b);
    else if (a === 'count') { S.counts = null; renderTables(); countTables(); }
    else if (a === 'reset') resetDemo(b);
  }

  var liveTimer = null;
  function show() {
    S.visible = true;
    render();
    countTables();
    if (!S.test) testConnection(root.querySelector('[data-conn="test"]'), true);
    clearInterval(liveTimer);
    liveTimer = setInterval(function () { if (S.visible) renderRealtime(); }, 5000);
  }
  function hide() { S.visible = false; clearInterval(liveTimer); }

  A.register('connection', { titleKey: 'ad.conn.title', navKey: 'ad.conn.nav', icon: 'server', order: 90, group: 'system', mount: mount, show: show, hide: hide });
})(window.NC = window.NC || {});
