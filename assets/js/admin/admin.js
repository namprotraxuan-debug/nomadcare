/*
 * admin.js — NomadCare Admin shell + router (owner: P2 admin-core). Loaded first among assets/js/admin/*.js.
 * Public API (contract): NC.admin.{register(name, def), go(name, params, opts), current(), setTitle(text), refreshBadges()}
 *   def = {titleKey, navKey?, shortKey?, icon, order, group?:'main'|'data'|'ops'|'system', mount(sectionEl) once,
 *          show(params), hide(), badge?() → number|null|{count, tone}|Promise}
 * Shared helpers for every admin page: NC.admin.{live(fn), session(), mode(), drawer(opts), table(opts), pageHead(opts),
 *   select(opts), statusBadge(status), facType(t), svcType(t), routes(), routeName(id,{short}), routeRegion(route|id),
 *   carriers(), carrierName(id), actorLabel(label), isSystemActor(label),
 *   errorText(e), csv(filename, rows, cols), kv(rows), miniMap(el, opts), mask{Email,Phone}(s), refreshKey()}
 * Starts itself on DOMContentLoaded (pages register synchronously before that): settings → theme/lang → NC.data.init()
 * → auth gate (Supabase login | local demo) → nav + hash routing (#/NAME?query) + one realtime subscription.
 * Session loss (signOut/reset in another tab, expired/revoked token, a 'forbidden' admin call) → back to the gate once.
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var h = U.h;
  var $ = U.$, $$ = U.$$;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }
  function noop() { }

  /* ================================================================== */
  /* i18n — ad.core.*                                                    */
  /* ================================================================== */
  NC.i18n.add({
    vi: {
      'ad.core.skip': 'Bỏ qua, tới nội dung chính',
      'ad.core.console': 'Bảng điều khiển máy chủ',
      'ad.core.brand': 'NomadCare Admin',
      'ad.core.menu_open': 'Mở menu', 'ad.core.menu_close': 'Đóng menu', 'ad.core.nav_aria': 'Điều hướng quản trị',
      'ad.core.backend': 'Máy chủ', 'ad.core.open_app': 'Mở ứng dụng người dùng',
      'ad.core.group.main': 'Tổng quan', 'ad.core.group.data': 'Dữ liệu', 'ad.core.group.ops': 'Vận hành', 'ad.core.group.system': 'Hệ thống',
      'ad.core.mode.local': 'Cục bộ – demo', 'ad.core.mode.supabase': 'Supabase',
      'ad.core.mode.local_long': 'Máy chủ mô phỏng trong trình duyệt',
      'ad.core.mode.supabase_long': 'Supabase · PostgreSQL + PostGIS',
      'ad.core.live.live': 'Trực tiếp', 'ad.core.live.connecting': 'Đang kết nối', 'ad.core.live.off': 'Tạm ngắt',
      'ad.core.live.aria': 'Realtime: {s}', 'ad.core.live.last': 'Sự kiện gần nhất {time}',
      'ad.core.lang.aria': 'Đổi ngôn ngữ giao diện (VI/EN)', 'ad.core.lang.changed': 'Đã chuyển sang tiếng Việt',
      'ad.core.theme.auto': 'Tự động', 'ad.core.theme.light': 'Sáng', 'ad.core.theme.dark': 'Tối',
      'ad.core.theme.aria': 'Giao diện: {mode}. Nhấn để đổi', 'ad.core.theme.changed': 'Giao diện: {mode}',
      'ad.core.user.menu': 'Tài khoản', 'ad.core.user.role_admin': 'Quản trị viên', 'ad.core.user.role_reviewer': 'Kiểm duyệt viên',
      'ad.core.user.signout': 'Đăng xuất', 'ad.core.user.signed_out': 'Đã đăng xuất khỏi bảng điều khiển',
      'ad.core.user.setup': 'Kết nối & cấu hình máy chủ', 'ad.core.user.demo_note': 'Phiên demo cục bộ — dữ liệu minh hoạ, không cần mật khẩu',
      'ad.core.auth.eyebrow': 'Tầng máy chủ · AISC 2026',
      'ad.core.auth.title': 'Bảng điều khiển NomadCare',
      'ad.core.auth.lead': 'Nơi đội vận hành duyệt dữ liệu trước khi nó tới tay phượt thủ — mọi thay đổi ghi thẳng vào cơ sở dữ liệu và phát hành thành gói offline.',
      'ad.core.auth.f1': 'Xác thực điểm y tế đủ 10 trường, chu kỳ 90 ngày',
      'ad.core.auth.f2': 'Duyệt đóng góp cộng đồng trước khi nhập lớp chính',
      'ad.core.auth.f3': 'Bản đồ nhiệt vùng lõm sóng theo từng nhà mạng',
      'ad.core.auth.f4': 'Giám sát Buddy Check-in và cảnh báo quá hạn theo thời gian thực',
      'ad.core.auth.form_title': 'Đăng nhập quản trị',
      'ad.core.auth.local_sub': 'Đang chạy máy chủ mô phỏng cục bộ (IndexedDB trong trình duyệt).',
      'ad.core.auth.supabase_sub': 'Kết nối Supabase: {url}',
      'ad.core.auth.demo_btn': 'Vào chế độ demo cục bộ',
      'ad.core.auth.demo_hint': 'Không cần mật khẩu. Dữ liệu minh hoạ nằm trong trình duyệt này và dùng chung với ứng dụng ở tab khác.',
      'ad.core.auth.or_email': 'hoặc đăng nhập bằng email',
      'ad.core.auth.email': 'Email', 'ad.core.auth.password': 'Mật khẩu',
      'ad.core.auth.email_ph': 'ban@vidu.vn', 'ad.core.auth.signin': 'Đăng nhập', 'ad.core.auth.signing': 'Đang đăng nhập…',
      'ad.core.auth.need_both': 'Nhập email và mật khẩu.',
      'ad.core.auth.err_auth': 'Email hoặc mật khẩu không đúng.',
      'ad.core.auth.err_role': 'Tài khoản này chưa được cấp quyền quản trị (bảng admin_users).',
      'ad.core.auth.err_network': 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
      'ad.core.auth.sup_note': 'Tài khoản do nhóm tạo trong Supabase Auth và gán quyền trong bảng admin_users. Đăng ký tự do đã tắt.',
      'ad.core.auth.local_note': 'Ở chế độ cục bộ, email bất kỳ đều vào được phiên demo.',
      'ad.core.auth.back_app': 'Về ứng dụng người dùng',
      'ad.core.auth.footer': 'Nhóm Stormbreakers · Digital Business Ideas · Dữ liệu minh hoạ',
      'ad.core.auth.session_lost': 'Phiên quản trị đã kết thúc (đăng xuất ở tab khác, dữ liệu được đặt lại hoặc phiên hết hạn). Đăng nhập lại để tiếp tục.',
      'ad.core.actor.system': 'Hệ thống (cron)', 'ad.core.actor.community': 'Cộng đồng',
      'ad.core.actor.device': 'Thiết bị người dùng', 'ad.core.actor.team_seed': 'Nhóm Stormbreakers (dữ liệu mẫu)',
      'ad.core.banner.offline': 'Mất kết nối mạng — dữ liệu trên bảng điều khiển có thể đã cũ.',
      'ad.core.banner.sim': 'Ứng dụng đang giả lập mất sóng. Máy chủ cục bộ vẫn phản hồi trang quản trị; thiết bị sẽ đồng bộ khi có sóng lại.',
      'ad.core.banner.sim_off': 'Tắt giả lập',
      'ad.core.page_missing': 'Trang này chưa sẵn sàng',
      'ad.core.page_missing_text': 'Mô-đun của trang chưa được nạp. Tải lại trang hoặc chọn mục khác.',
      'ad.core.page_error': 'Không hiển thị được trang này. Thử làm mới.',
      'ad.core.refresh': 'Làm mới', 'ad.core.updated': 'Cập nhật {time}', 'ad.core.export_csv': 'Xuất CSV',
      'ad.core.search': 'Tìm kiếm', 'ad.core.all': 'Tất cả', 'ad.core.none': '—', 'ad.core.yes': 'Có', 'ad.core.no': 'Không',
      'ad.core.unknown': 'Chưa rõ', 'ad.core.saved': 'Đã lưu', 'ad.core.deleted': 'Đã xoá',
      'ad.core.table.showing': '{from}–{to} / {total}', 'ad.core.table.prev': 'Trang trước', 'ad.core.table.next': 'Trang sau',
      'ad.core.table.sort': 'Sắp xếp theo {col}', 'ad.core.table.empty': 'Không có dòng nào khớp bộ lọc',
      'ad.core.table.empty_hint': 'Thử bỏ bớt bộ lọc hoặc từ khoá tìm kiếm.',
      'ad.core.err.incomplete': 'Thiếu trường bắt buộc: {fields}',
      'ad.core.err.forbidden': 'Tài khoản không có quyền thực hiện thao tác này.',
      'ad.core.err.network': 'Không kết nối được máy chủ. Thử lại khi có mạng.',
      'ad.core.err.not_supported': 'Chức năng này không có ở chế độ máy chủ hiện tại.',
      'ad.core.err.not_found': 'Không tìm thấy bản ghi (có thể đã bị xoá).',
      'ad.core.err.duplicate': 'Giá trị đã tồn tại.',
      'ad.core.err.generic': 'Thao tác thất bại: {msg}',
      'ad.core.err.invalid_date': 'Ngày không hợp lệ (không được ở tương lai).',
      'ad.core.err.invalid_coordinates': 'Toạ độ không hợp lệ.',
      'ad.core.err.outside_vietnam': 'Toạ độ phải nằm trong Việt Nam (vĩ độ 8,1–23,5 · kinh độ 102,1–109,6).',
      'ad.core.err.rate_limited': 'Vượt giới hạn tần suất của máy chủ — thử lại sau.',
      'ad.core.err.recipient_email_required': 'Thiếu email người nhận.',
      'ad.core.new_event': 'Có thay đổi mới từ máy chủ',
      'ad.core.fac_type.tram_y_te': 'Trạm y tế xã', 'ad.core.fac_type.phong_kham': 'Phòng khám',
      'ad.core.fac_type.benh_vien': 'Bệnh viện', 'ad.core.fac_type.nha_thuoc': 'Nhà thuốc',
      'ad.core.svc_type.lodging': 'Lưu trú', 'ad.core.svc_type.repair': 'Sửa xe', 'ad.core.svc_type.fuel': 'Xăng dầu', 'ad.core.svc_type.rental': 'Thuê xe',
      'ad.core.status.verified': 'Đã xác thực', 'ad.core.status.pending': 'Chờ duyệt', 'ad.core.status.rejected': 'Từ chối',
      'ad.core.status.approved': 'Đã duyệt', 'ad.core.status.active': 'Đang theo dõi', 'ad.core.status.inactive': 'Ngừng hoạt động',
      'ad.core.status.overdue': 'QUÁ HẠN', 'ad.core.status.alerted': 'Đã gửi cảnh báo', 'ad.core.status.closed': 'Đã đóng',
      'ad.core.status.draft': 'Bản nháp', 'ad.core.status.in_review': 'Đang duyệt', 'ad.core.status.retracted': 'Đã thu hồi',
      'ad.core.status.stale': 'Quá hạn xác thực',
      'ad.core.mode_t.motorbike': 'Xe máy', 'ad.core.mode_t.hiking': 'Đi bộ', 'ad.core.mode_t.mixed': 'Kết hợp'
    },
    en: {
      'ad.core.skip': 'Skip to main content',
      'ad.core.console': 'Server console',
      'ad.core.brand': 'NomadCare Admin',
      'ad.core.menu_open': 'Open menu', 'ad.core.menu_close': 'Close menu', 'ad.core.nav_aria': 'Admin navigation',
      'ad.core.backend': 'Server', 'ad.core.open_app': 'Open the traveller app',
      'ad.core.group.main': 'Overview', 'ad.core.group.data': 'Data', 'ad.core.group.ops': 'Operations', 'ad.core.group.system': 'System',
      'ad.core.mode.local': 'Local – demo', 'ad.core.mode.supabase': 'Supabase',
      'ad.core.mode.local_long': 'In-browser simulated server',
      'ad.core.mode.supabase_long': 'Supabase · PostgreSQL + PostGIS',
      'ad.core.live.live': 'Live', 'ad.core.live.connecting': 'Connecting', 'ad.core.live.off': 'Paused',
      'ad.core.live.aria': 'Realtime: {s}', 'ad.core.live.last': 'Last event {time}',
      'ad.core.lang.aria': 'Switch interface language (VI/EN)', 'ad.core.lang.changed': 'Switched to English',
      'ad.core.theme.auto': 'Auto', 'ad.core.theme.light': 'Light', 'ad.core.theme.dark': 'Dark',
      'ad.core.theme.aria': 'Theme: {mode}. Click to change', 'ad.core.theme.changed': 'Theme: {mode}',
      'ad.core.user.menu': 'Account', 'ad.core.user.role_admin': 'Administrator', 'ad.core.user.role_reviewer': 'Reviewer',
      'ad.core.user.signout': 'Sign out', 'ad.core.user.signed_out': 'Signed out of the dashboard',
      'ad.core.user.setup': 'Server connection & setup', 'ad.core.user.demo_note': 'Local demo session — illustrative data, no password',
      'ad.core.auth.eyebrow': 'Server tier · AISC 2026',
      'ad.core.auth.title': 'NomadCare dashboard',
      'ad.core.auth.lead': 'Where the operations team reviews data before it reaches travellers — every change is written straight to the database and published as offline packs.',
      'ad.core.auth.f1': 'Verify medical facilities with all 10 fields, 90-day cycle',
      'ad.core.auth.f2': 'Review community contributions before they enter the main layer',
      'ad.core.auth.f3': 'Dead-zone heat map per mobile carrier',
      'ad.core.auth.f4': 'Monitor Buddy check-ins and overdue alerts in real time',
      'ad.core.auth.form_title': 'Admin sign-in',
      'ad.core.auth.local_sub': 'Running the local simulated server (IndexedDB in this browser).',
      'ad.core.auth.supabase_sub': 'Supabase connection: {url}',
      'ad.core.auth.demo_btn': 'Enter local demo mode',
      'ad.core.auth.demo_hint': 'No password needed. Illustrative data lives in this browser and is shared with the app in other tabs.',
      'ad.core.auth.or_email': 'or sign in with e-mail',
      'ad.core.auth.email': 'E-mail', 'ad.core.auth.password': 'Password',
      'ad.core.auth.email_ph': 'you@example.com', 'ad.core.auth.signin': 'Sign in', 'ad.core.auth.signing': 'Signing in…',
      'ad.core.auth.need_both': 'Enter your e-mail and password.',
      'ad.core.auth.err_auth': 'Wrong e-mail or password.',
      'ad.core.auth.err_role': 'This account has no admin rights yet (admin_users table).',
      'ad.core.auth.err_network': 'Cannot reach the server. Check the connection and retry.',
      'ad.core.auth.sup_note': 'Accounts are created by the team in Supabase Auth and granted in admin_users. Public sign-up is disabled.',
      'ad.core.auth.local_note': 'In local mode any e-mail opens the demo session.',
      'ad.core.auth.back_app': 'Back to the traveller app',
      'ad.core.auth.footer': 'Team Stormbreakers · Digital Business Ideas · Illustrative data',
      'ad.core.auth.session_lost': 'Your admin session has ended (signed out in another tab, data reset or session expired). Sign in again to continue.',
      'ad.core.actor.system': 'System (cron)', 'ad.core.actor.community': 'Community',
      'ad.core.actor.device': 'Traveller device', 'ad.core.actor.team_seed': 'Team Stormbreakers (seed data)',
      'ad.core.banner.offline': 'No network connection — dashboard data may be out of date.',
      'ad.core.banner.sim': 'The app is simulating a dead zone. The local server still answers the dashboard; devices sync when signal returns.',
      'ad.core.banner.sim_off': 'Stop simulation',
      'ad.core.page_missing': 'This page is not ready',
      'ad.core.page_missing_text': 'The page module has not loaded. Reload or pick another section.',
      'ad.core.page_error': 'This page could not be displayed. Try refreshing.',
      'ad.core.refresh': 'Refresh', 'ad.core.updated': 'Updated {time}', 'ad.core.export_csv': 'Export CSV',
      'ad.core.search': 'Search', 'ad.core.all': 'All', 'ad.core.none': '—', 'ad.core.yes': 'Yes', 'ad.core.no': 'No',
      'ad.core.unknown': 'Unknown', 'ad.core.saved': 'Saved', 'ad.core.deleted': 'Deleted',
      'ad.core.table.showing': '{from}–{to} of {total}', 'ad.core.table.prev': 'Previous page', 'ad.core.table.next': 'Next page',
      'ad.core.table.sort': 'Sort by {col}', 'ad.core.table.empty': 'No rows match the filters',
      'ad.core.table.empty_hint': 'Try removing a filter or the search term.',
      'ad.core.err.incomplete': 'Missing required fields: {fields}',
      'ad.core.err.forbidden': 'Your account is not allowed to do this.',
      'ad.core.err.network': 'Cannot reach the server. Retry when online.',
      'ad.core.err.not_supported': 'Not available with the current server mode.',
      'ad.core.err.not_found': 'Record not found (it may have been deleted).',
      'ad.core.err.duplicate': 'This value already exists.',
      'ad.core.err.generic': 'Action failed: {msg}',
      'ad.core.err.invalid_date': 'Invalid date (it cannot be in the future).',
      'ad.core.err.invalid_coordinates': 'Invalid coordinates.',
      'ad.core.err.outside_vietnam': 'Coordinates must be inside Vietnam (latitude 8.1–23.5 · longitude 102.1–109.6).',
      'ad.core.err.rate_limited': 'Server rate limit reached — try again later.',
      'ad.core.err.recipient_email_required': 'The recipient e-mail is missing.',
      'ad.core.new_event': 'New change from the server',
      'ad.core.fac_type.tram_y_te': 'Commune health station', 'ad.core.fac_type.phong_kham': 'Clinic',
      'ad.core.fac_type.benh_vien': 'Hospital', 'ad.core.fac_type.nha_thuoc': 'Pharmacy',
      'ad.core.svc_type.lodging': 'Lodging', 'ad.core.svc_type.repair': 'Bike repair', 'ad.core.svc_type.fuel': 'Fuel', 'ad.core.svc_type.rental': 'Rental',
      'ad.core.status.verified': 'Verified', 'ad.core.status.pending': 'Pending', 'ad.core.status.rejected': 'Rejected',
      'ad.core.status.approved': 'Approved', 'ad.core.status.active': 'Monitoring', 'ad.core.status.inactive': 'Inactive',
      'ad.core.status.overdue': 'OVERDUE', 'ad.core.status.alerted': 'Alert sent', 'ad.core.status.closed': 'Closed',
      'ad.core.status.draft': 'Draft', 'ad.core.status.in_review': 'In review', 'ad.core.status.retracted': 'Retracted',
      'ad.core.status.stale': 'Re-verification due',
      'ad.core.mode_t.motorbike': 'Motorbike', 'ad.core.mode_t.hiking': 'Hiking', 'ad.core.mode_t.mixed': 'Mixed'
    }
  });

  /* ================================================================== */
  /* STATE                                                                */
  /* ================================================================== */
  var registry = {};          // name → def
  var sections = {};          // name → <section>
  var mounted = {};
  var current = null;         // {name, params}
  var customTitle = null;
  var started = false;
  var entered = false;
  var sessionInfo = null;
  var authNotice = null;      // i18n key shown on the auth gate after the session disappeared (cleared on enter)
  var signingOut = false;     // our own signOut() is running (ignore the SIGNED_OUT echo)
  var lostCheck = null;       // in-flight session re-check (one at a time)
  var liveListeners = [];
  var liveOff = null;
  var liveState = 'off';
  var liveLastAt = null;
  var refreshSeq = 0;
  var GROUPS = ['main', 'data', 'ops', 'system'];
  var THEMES = ['auto', 'light', 'dark'];
  var THEME_ICON = { auto: 'sun-moon', light: 'sun', dark: 'moon' };
  var THEME_COLOR = { light: '#0E9384', dark: '#0E1616' };
  var mqPhone = window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;

  /* ================================================================== */
  /* REGISTRY + ROUTER                                                    */
  /* ================================================================== */

  /**
   * Register an admin page. Safe before or after start (late pages appear in the nav immediately).
   * @param {string} name route name (#/name)
   * @param {{titleKey:string, navKey?:string, shortKey?:string, icon?:string, order?:number, group?:string,
   *          mount?:function(HTMLElement), show?:function(Object), hide?:function(), badge?:function()}} def
   */
  function register(name, def) {
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('[admin] invalid page name: ' + name);
    registry[name] = Object.assign({ titleKey: 'ad.' + name + '.title', icon: 'grid', order: 100, group: 'data' }, def || {});
    if (GROUPS.indexOf(registry[name].group) < 0) registry[name].group = 'data';
    ensureSection(name);
    if (started) {
      buildNav();
      if (entered && current && current.name === name && !mounted[name]) activate(name, current.params, true);
    }
  }

  function ordered() {
    return Object.keys(registry).sort(function (a, b) {
      var A = registry[a], B = registry[b];
      return (GROUPS.indexOf(A.group) - GROUPS.indexOf(B.group)) || ((A.order || 0) - (B.order || 0)) || a.localeCompare(b);
    });
  }
  function defaultPage() {
    if (registry.overview) return 'overview';
    var list = ordered();
    return list.length ? list[0] : 'overview';
  }

  function ensureSection(name) {
    if (sections[name]) return sections[name];
    var view = document.getElementById('ad-view');
    var s = document.getElementById('ad-page-' + name);
    if (!s) {
      s = h('section', { class: 'ad-page', id: 'ad-page-' + name, 'data-page': name, hidden: true, 'aria-labelledby': 'ad-title' });
      if (view) view.appendChild(s);
    }
    sections[name] = s;
    return s;
  }

  function parseQuery(query) {
    var params = {};
    String(query || '').split('&').forEach(function (p) {
      if (!p) return;
      var i = p.indexOf('=');
      var k = i >= 0 ? p.slice(0, i) : p, v = i >= 0 ? p.slice(i + 1) : '';
      try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* skip malformed */ }
    });
    return params;
  }
  function parseHash(hash) {
    var raw = String(hash === undefined ? window.location.hash : hash).replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var name = '';
    try { name = decodeURIComponent(path.split('/')[0] || ''); } catch (e) { name = ''; }
    return { name: name, params: qi >= 0 ? parseQuery(raw.slice(qi + 1)) : {} };
  }
  function buildHash(name, params) {
    var keys = params ? Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; }) : [];
    var q = keys.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return '#/' + name + (q ? '?' + q : '');
  }
  function replaceHash(hash) {
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + hash); }
    catch (e) { window.location.replace(hash); }
  }

  /**
   * Navigate to an admin page. opts.replace → no new history entry (use for filter changes).
   * @param {string} name
   * @param {Object} [params]
   * @param {{replace?:boolean, silent?:boolean}} [opts] silent → update the URL only (page keeps its state)
   */
  function go(name, params, opts) {
    var o = opts || {};
    var hash = buildHash(name, params);
    if (o.silent) {
      replaceHash(hash);
      if (current && current.name === name) current.params = Object.assign({}, params || {});
      return;
    }
    if (o.replace) { replaceHash(hash); handleRoute(true); return; }
    if (window.location.hash === hash) { handleRoute(true); return; }
    window.location.hash = hash;
  }

  function currentRoute() { return current ? { name: current.name, params: Object.assign({}, current.params) } : null; }

  function handleRoute(force) {
    if (!entered) return;
    var r = parseHash();
    if (!r.name || !registry[r.name]) {
      var def = defaultPage();
      if (r.name && !registry[r.name] && r.name !== def) {
        // Known-but-missing page (module failed to load) → friendly placeholder instead of a silent redirect.
        if (/^[a-z][a-z0-9-]*$/.test(r.name) && ['signal', 'buddy', 'packs', 'audit'].indexOf(r.name) >= 0) {
          showMissing(r.name, r.params);
          return;
        }
      }
      replaceHash(buildHash(def, r.name === def ? r.params : null));
      r = { name: def, params: r.name === def ? r.params : {} };
      if (!registry[def]) { showMissing(def, r.params); return; }
    }
    if (!force && current && current.name === r.name && JSON.stringify(current.params) === JSON.stringify(r.params)) return;
    activate(r.name, r.params, force);
  }

  function hideCurrent(nextName) {
    if (!current) return;
    var pd = registry[current.name];
    if (current.name !== nextName && pd && typeof pd.hide === 'function') {
      try { pd.hide(); } catch (e) { console.error('[admin] hide(' + current.name + ') failed', e); }
    }
  }

  function showSection(name) {
    Object.keys(sections).forEach(function (n) {
      var on = n === name;
      sections[n].hidden = !on;
      sections[n].classList.toggle('is-active', on);
    });
  }

  function showMissing(name, params) {
    hideCurrent(name);
    var s = ensureSection(name);
    s.innerHTML = '';
    s.appendChild(h('div', { class: 'card ad-empty' }, NC.ui.emptyState({
      icon: 'alert-triangle', variant: 'warning', title: t('ad.core.page_missing'), text: t('ad.core.page_missing_text'),
      action: { label: t('ad.core.refresh'), icon: 'refresh', onClick: function () { window.location.reload(); } }
    })));
    showSection(name);
    current = { name: name, params: params || {} };
    customTitle = t('ad.core.page_missing');
    updateNav(name);
    updateTitle();
  }

  function activate(name, params, force) {
    var prevName = current ? current.name : null;
    var nameChanged = prevName !== name;
    hideCurrent(name);
    var section = ensureSection(name);
    current = { name: name, params: params || {} };
    customTitle = null;
    document.body.setAttribute('data-page', name);
    var def = registry[name];
    if (!mounted[name]) {
      mounted[name] = true;
      section.innerHTML = '';
      try { if (typeof def.mount === 'function') def.mount(section); }
      catch (e) {
        console.error('[admin] mount(' + name + ') failed', e);
        section.innerHTML = '';
        section.appendChild(h('div', { class: 'card ad-empty' }, NC.ui.emptyState({ icon: 'alert-triangle', variant: 'warning', title: t('common.error'), text: t('ad.core.page_error') })));
      }
    }
    showSection(name);
    updateNav(name);
    updateTitle();
    closeDrawer();
    try { if (typeof def.show === 'function') def.show(current.params); }
    catch (e2) { console.error('[admin] show(' + name + ') failed', e2); }
    if (nameChanged || force) {
      if (nameChanged) window.scrollTo(0, 0);
      var view = document.getElementById('ad-view');
      if (view && nameChanged && prevName) { try { view.focus({ preventScroll: true }); } catch (e3) { /* ignore */ } }
    }
    if (NC.bus) NC.bus.emit('admin:route', { name: name, params: current.params });
  }

  function titleFor(name) {
    var def = registry[name];
    return def ? t(def.titleKey) : t('ad.core.brand');
  }
  /** Override the topbar title of the current page (reset on navigation). */
  function setTitle(text) { customTitle = text || null; updateTitle(); }

  function updateTitle() {
    var el = document.getElementById('ad-title');
    var name = current ? current.name : null;
    var def0 = name ? registry[name] : null;
    // Phones: the shorter nav label fits the compact topbar better than the full page title.
    var title = customTitle || (def0 ? (isPhone() && def0.navKey ? t(def0.navKey) : titleFor(name)) : t('ad.core.brand'));
    if (el) el.textContent = title;
    var crumb = document.getElementById('ad-crumb');
    if (crumb) {
      var def = name ? registry[name] : null;
      crumb.textContent = t('ad.core.brand') + (def ? ' · ' + t('ad.core.group.' + def.group) : '');
    }
    document.title = title + ' · NomadCare Admin';
  }

  /* ================================================================== */
  /* NAVIGATION                                                           */
  /* ================================================================== */
  function buildNav() {
    var nav = document.getElementById('ad-nav');
    if (!nav) return;
    var frag = document.createDocumentFragment();
    var lastGroup = null;
    ordered().forEach(function (name) {
      var def = registry[name];
      if (def.group !== lastGroup) {
        lastGroup = def.group;
        frag.appendChild(h('span', { class: 'ad-nav__group', 'data-i18n': 'ad.core.group.' + def.group }, t('ad.core.group.' + def.group)));
      }
      var navKey = def.navKey || def.titleKey;
      var a = h('a', { class: 'ad-nav__item', href: '#/' + name, 'data-nav': name, title: t(navKey) });
      a.appendChild(h('span', { class: 'ad-nav__icon', html: icon(def.icon || 'grid') }));
      a.appendChild(h('span', { class: 'ad-nav__label', 'data-i18n': navKey }, t(navKey)));
      a.appendChild(h('span', { class: 'ad-nav__short', 'data-i18n': def.shortKey || navKey }, t(def.shortKey || navKey)));
      var b = h('span', { class: 'ad-nav__badge', hidden: true, 'aria-hidden': 'true' }, '0');
      a.appendChild(b);
      frag.appendChild(a);
    });
    nav.innerHTML = '';
    nav.appendChild(frag);
    if (current) updateNav(current.name);
    refreshBadges();
  }

  function updateNav(name) {
    $$('#ad-nav [data-nav]').forEach(function (el) {
      if (el.getAttribute('data-nav') === name) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  var badgeTimer = null;
  /** Recompute every nav badge (debounced 250 ms). Pages call this after a write that changes their count. */
  function refreshBadges() {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(doRefreshBadges, 250);
  }
  function doRefreshBadges() {
    if (!entered) return;
    Object.keys(registry).forEach(function (name) {
      var def = registry[name];
      if (typeof def.badge !== 'function') return;
      var el = document.querySelector('#ad-nav [data-nav="' + name + '"] .ad-nav__badge');
      if (!el) return;
      var r;
      try { r = def.badge(); } catch (e) { r = null; }
      Promise.resolve(r).then(function (v) {
        var n = v && typeof v === 'object' ? v.count : v;
        var tone = v && typeof v === 'object' ? v.tone : null;
        n = +n || 0;
        el.hidden = n <= 0;
        el.textContent = n > 99 ? '99+' : String(n);
        el.className = 'ad-nav__badge' + (tone ? ' ad-nav__badge--' + tone : '');
        var item = el.parentNode;
        if (item) item.setAttribute('aria-label', t((def.navKey || def.titleKey)) + (n > 0 ? ' (' + n + ')' : ''));
      }).catch(noop);
    });
  }

  /* ---- mobile drawer ---- */
  function isPhone() { return !!(mqPhone && mqPhone.matches); }
  var drawerOpen = false;
  function openDrawer() {
    if (drawerOpen || !isPhone()) return;
    drawerOpen = true;
    var shell = document.getElementById('app');
    shell.classList.add('is-drawer-open');
    var scrim = document.getElementById('ad-scrim'); if (scrim) scrim.hidden = false;
    var btn = document.getElementById('ad-menu'); if (btn) btn.setAttribute('aria-expanded', 'true');
    NC.ui.lockScroll();
    var first = document.querySelector('#ad-nav [aria-current="page"]') || document.querySelector('#ad-nav .ad-nav__item');
    if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 60);
  }
  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    var shell = document.getElementById('app');
    shell.classList.remove('is-drawer-open');
    var scrim = document.getElementById('ad-scrim'); if (scrim) scrim.hidden = true;
    var btn = document.getElementById('ad-menu'); if (btn) btn.setAttribute('aria-expanded', 'false');
    NC.ui.unlockScroll();
  }

  /* ================================================================== */
  /* THEME / LANGUAGE                                                     */
  /* ================================================================== */
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolvedTheme() {
    var pref = document.documentElement.getAttribute('data-theme') || 'auto';
    if (pref === 'auto') return (mqDark && mqDark.matches) ? 'dark' : 'light';
    return pref;
  }
  function applyTheme(pref, silent) {
    var p = THEMES.indexOf(pref) >= 0 ? pref : 'auto';
    document.documentElement.setAttribute('data-theme', p);
    $$('meta[name="theme-color"]').forEach(function (m) {
      var forDark = (m.getAttribute('media') || '').indexOf('dark') >= 0;
      m.setAttribute('content', p === 'auto' ? THEME_COLOR[forDark ? 'dark' : 'light'] : THEME_COLOR[p]);
    });
    var btn = document.getElementById('ad-theme');
    if (btn) {
      btn.innerHTML = icon(THEME_ICON[p] || 'sun-moon');
      var label = t('ad.core.theme.aria', { mode: t('ad.core.theme.' + p) });
      btn.setAttribute('aria-label', label); btn.setAttribute('title', label);
    }
    if (!silent && NC.bus) NC.bus.emit('theme:change', { theme: p, resolved: resolvedTheme() });
  }
  if (mqDark) {
    var onScheme = function () {
      if ((document.documentElement.getAttribute('data-theme') || 'auto') === 'auto' && NC.bus) NC.bus.emit('theme:change', { theme: 'auto', resolved: resolvedTheme() });
    };
    if (mqDark.addEventListener) mqDark.addEventListener('change', onScheme); else if (mqDark.addListener) mqDark.addListener(onScheme);
  }
  function cycleTheme() {
    var pref = document.documentElement.getAttribute('data-theme') || 'auto';
    var next = THEMES[(THEMES.indexOf(pref) + 1) % THEMES.length];
    NC.settings.set('theme', next);
    applyTheme(next);
    NC.ui.toast(t('ad.core.theme.changed', { mode: t('ad.core.theme.' + next) }), { timeout: 1600 });
  }
  function updateLangBtns() {
    $$('[data-ad-lang]').concat($$('#ad-lang')).forEach(function (btn) {
      var code = btn.querySelector('.ad-lang-code');
      if (code) code.textContent = NC.i18n.lang().toUpperCase();
      btn.setAttribute('aria-label', t('ad.core.lang.aria'));
      btn.setAttribute('title', t('ad.core.lang.aria'));
    });
  }
  function toggleLang() {
    NC.i18n.setLang(NC.i18n.lang() === 'vi' ? 'en' : 'vi');
    NC.ui.toast(t('ad.core.lang.changed'), { timeout: 1600 });
  }

  /* ================================================================== */
  /* MODE / LIVE / BANNER / USER                                          */
  /* ================================================================== */
  function mode() { return (NC.data && NC.data.mode) || 'local'; }

  function updateMode() {
    var m = mode();
    var badge = document.getElementById('ad-mode');
    if (badge) {
      badge.className = 'badge ad-mode ' + (m === 'supabase' ? 'badge--success' : 'badge--accent');
      badge.innerHTML = icon(m === 'supabase' ? 'database' : 'hard-drive') + '<span>' + U.esc(t('ad.core.mode.' + m)) + '</span>';
      badge.setAttribute('title', t('ad.core.mode.' + m + '_long'));
    }
    var sb = document.getElementById('ad-sb-mode-value');
    if (sb) sb.textContent = t('ad.core.mode.' + m);
    var sbBtn = document.getElementById('ad-sb-mode');
    if (sbBtn) sbBtn.setAttribute('data-mode', m);
  }

  function setLive(state) {
    liveState = state;
    var wrap = document.getElementById('ad-live');
    var label = t('ad.core.live.' + state);
    if (wrap) {
      wrap.setAttribute('data-state', state);
      var sub = liveLastAt ? ' · ' + t('ad.core.live.last', { time: U.fmtTime(liveLastAt) }) : '';
      wrap.setAttribute('title', t('ad.core.live.aria', { s: label }) + sub);
      wrap.setAttribute('aria-label', t('ad.core.live.aria', { s: label }));
    }
    var lb = document.getElementById('ad-live-label');
    if (lb) lb.textContent = label;
    $$('[data-live-dot]').forEach(function (d) { d.setAttribute('data-state', state); });
  }
  function pingLive() {
    liveLastAt = new Date();
    var wrap = document.getElementById('ad-live');
    if (!wrap) return;
    wrap.classList.remove('is-ping');
    void wrap.offsetWidth; // restart the animation
    wrap.classList.add('is-ping');
    setLive(liveState === 'off' ? 'live' : liveState);
  }

  var badgeTables = { facilities: 1, facility_submissions: 1, buddy_sessions: 1, signal_samples: 1, data_packs: 1, content_releases: 1, '*': 1 };
  function onServerChange(msg) {
    if (!msg) return;
    pingLive();
    if (badgeTables[msg.table]) refreshBadges();
    liveListeners.slice().forEach(function (fn) {
      try { fn(msg); } catch (e) { console.error('[admin] live listener failed', e); }
    });
  }
  function startLive() {
    if (liveOff) return;
    setLive('connecting');
    try {
      liveOff = NC.data.admin.subscribe(onServerChange);
    } catch (e) { console.warn('[admin] realtime unavailable', e); setLive('off'); return; }
    if (mode() === 'local') setTimeout(function () { setLive('live'); }, 250);
    else pollSupabaseLive();
  }
  var livePoll = null;
  function pollSupabaseLive() {
    clearInterval(livePoll);
    var check = function () {
      var st = 'connecting';
      try {
        var client = NC.backend.supabase.client();
        var chans = client.getChannels ? client.getChannels() : [];
        var ch = chans.filter(function (c) { return String(c.topic || '').indexOf('nc-admin-realtime') >= 0; })[0];
        if (ch && (ch.state === 'joined' || ch.state === 'SUBSCRIBED')) st = 'live';
        else if (ch && (ch.state === 'errored' || ch.state === 'closed')) st = 'off';
      } catch (e) { st = 'off'; }
      if (!navigator.onLine) st = 'off';
      setLive(st);
    };
    check();
    livePoll = setInterval(check, 4000);
  }
  function stopLive() {
    if (liveOff) { try { liveOff(); } catch (e) { /* ignore */ } }
    liveOff = null;
    clearInterval(livePoll);
    setLive('off');
  }
  /**
   * Listen to realtime server changes ({table, type:'INSERT'|'UPDATE'|'DELETE'|'RESET', row}) through the shell's single
   * subscription. Returns off().
   */
  function live(fn) {
    if (typeof fn !== 'function') return noop;
    liveListeners.push(fn);
    return function () { var i = liveListeners.indexOf(fn); if (i >= 0) liveListeners.splice(i, 1); };
  }

  function updateBanner() {
    var b = document.getElementById('ad-banner');
    if (!b) return;
    var real = navigator.onLine !== false;
    var sim = !!(NC.net && NC.net.simulated && NC.net.simulated());
    b.innerHTML = '';
    if (!real) {
      b.className = 'ad-banner ad-banner--warning';
      b.appendChild(h('span', { class: 'ad-banner__icon', html: icon('wifi-off') }));
      b.appendChild(h('span', { class: 'ad-banner__text' }, t('ad.core.banner.offline')));
      b.hidden = false;
    } else if (sim && entered) {
      b.className = 'ad-banner ad-banner--info';
      b.appendChild(h('span', { class: 'ad-banner__icon', html: icon('signal-off') }));
      b.appendChild(h('span', { class: 'ad-banner__text' }, t('ad.core.banner.sim')));
      b.appendChild(h('button', { type: 'button', class: 'btn btn--sm btn--outline', 'data-ad-action': 'sim-off' }, t('ad.core.banner.sim_off')));
      b.hidden = false;
    } else {
      b.hidden = true;
    }
  }

  function initials(s) {
    var base = String(s || 'A').split('@')[0].replace(/[._-]+/g, ' ').trim();
    var parts = base.split(/\s+/).filter(Boolean);
    var out = parts.length > 1 ? parts[0].charAt(0) + parts[1].charAt(0) : base.slice(0, 2);
    return (out || 'A').toUpperCase();
  }
  function updateUser() {
    var s = sessionInfo;
    var email = s && s.user ? (s.user.display_name || s.user.email || 'admin') : 'admin';
    var av = document.getElementById('ad-user-avatar'); if (av) av.textContent = initials(email);
    var nm = document.getElementById('ad-user-name'); if (nm) nm.textContent = email;
    var btn = document.getElementById('ad-user-btn');
    if (btn) { btn.setAttribute('aria-label', t('ad.core.user.menu') + ': ' + email); btn.setAttribute('title', email); }
  }
  function buildUserMenu() {
    var menu = document.getElementById('ad-user-menu');
    if (!menu) return;
    var s = sessionInfo || {};
    var email = s.user ? s.user.email : '';
    var role = s.role === 'reviewer' ? 'role_reviewer' : 'role_admin';
    menu.innerHTML = '';
    var head = h('div', { class: 'ad-usermenu__head' },
      h('span', { class: 'ad-user__avatar ad-user__avatar--lg' }, initials(email)),
      h('span', { class: 'ad-usermenu__who' },
        h('b', { class: 'truncate' }, (s.user && s.user.display_name) || email || 'admin'),
        h('small', { class: 'truncate' }, email)));
    menu.appendChild(head);
    var chips = h('div', { class: 'ad-usermenu__chips' });
    chips.appendChild(NC.ui.badge(t('ad.core.user.' + role), 'primary', 'shield-check'));
    chips.appendChild(NC.ui.badge(t('ad.core.mode.' + mode()), mode() === 'supabase' ? 'success' : 'accent'));
    menu.appendChild(chips);
    if (s.demo || mode() === 'local') menu.appendChild(h('p', { class: 'ad-usermenu__note' }, t('ad.core.user.demo_note')));
    function item(ic, label, attrs) {
      var tag = attrs && attrs.href ? 'a' : 'button';
      var el = h(tag, Object.assign({ class: 'ad-usermenu__item', role: 'menuitem', type: tag === 'button' ? 'button' : null }, attrs || {}));
      el.innerHTML = icon(ic) + '<span>' + U.esc(label) + '</span>';
      return el;
    }
    menu.appendChild(item('server', t('ad.core.user.setup'), { 'data-ad-go': 'connection' }));
    menu.appendChild(item('smartphone', t('ad.core.open_app'), { href: 'index.html' }));
    menu.appendChild(h('div', { class: 'ad-usermenu__sep', role: 'separator' }));
    menu.appendChild(item('log-out', t('ad.core.user.signout'), { 'data-ad-action': 'signout', class: 'ad-usermenu__item ad-usermenu__item--danger' }));
  }
  var menuOpen = false;
  function openUserMenu() {
    var menu = document.getElementById('ad-user-menu');
    var btn = document.getElementById('ad-user-btn');
    if (!menu || !btn) return;
    buildUserMenu();
    menu.hidden = false; menuOpen = true;
    btn.setAttribute('aria-expanded', 'true');
    var first = menu.querySelector('.ad-usermenu__item');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeUserMenu(focusBtn) {
    var menu = document.getElementById('ad-user-menu');
    var btn = document.getElementById('ad-user-btn');
    if (!menuOpen) return;
    menuOpen = false;
    if (menu) menu.hidden = true;
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); }
  }

  /* ================================================================== */
  /* AUTH GATE                                                            */
  /* ================================================================== */
  function maskUrl(url) {
    var m = /^(https?:\/\/)([^./]+)(.*)$/.exec(String(url || ''));
    if (!m) return url || '—';
    var id = m[2];
    return m[1] + (id.length > 6 ? id.slice(0, 4) + '••••' + id.slice(-2) : id) + m[3];
  }

  function renderAuth(errorKey) {
    var root = document.getElementById('ad-auth');
    if (!root) return;
    var isLocal = mode() === 'local';
    var cfg = window.NC_CONFIG || {};
    root.innerHTML = '';

    var tools = h('div', { class: 'ad-auth__tools' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--icon ad-topbar__btn', 'data-ad-lang': '', 'data-ad-action': 'lang', html: '<span class="ad-lang-code">' + NC.i18n.lang().toUpperCase() + '</span>' }),
      h('button', { type: 'button', class: 'btn btn--ghost btn--icon ad-topbar__btn', 'data-ad-action': 'theme', 'aria-label': t('ad.core.theme.aria', { mode: t('ad.core.theme.' + (document.documentElement.getAttribute('data-theme') || 'auto')) }), html: icon(THEME_ICON[document.documentElement.getAttribute('data-theme') || 'auto']) }));

    var feats = h('ul', { class: 'ad-auth__feats' });
    [['shield-check', 'f1'], ['users', 'f2'], ['signal', 'f3'], ['bell-ring', 'f4']].forEach(function (f) {
      feats.appendChild(h('li', null, h('span', { class: 'icon-tile icon-tile--glass icon-tile--sm', html: icon(f[0]) }), h('span', null, t('ad.core.auth.' + f[1]))));
    });
    var hero = h('section', { class: 'ad-auth__hero' },
      h('div', { class: 'ad-auth__brand' },
        h('img', { src: 'assets/img/logo.svg', alt: '', width: '48', height: '48' }),
        h('span', { class: 'ad-auth__brandname', html: 'Nomad<b>Care</b> <span>Admin</span>' })),
      h('p', { class: 'ad-auth__eyebrow' }, t('ad.core.auth.eyebrow')),
      h('h1', { class: 'ad-auth__title' }, t('ad.core.auth.title')),
      h('p', { class: 'ad-auth__lead' }, t('ad.core.auth.lead')),
      feats,
      h('p', { class: 'ad-auth__foot' }, t('ad.core.auth.footer')));

    var form = h('form', { class: 'ad-auth__login stack', id: 'ad-login', novalidate: true, autocomplete: 'on' });
    var emailId = 'ad-login-email', pwId = 'ad-login-pw';
    form.appendChild(h('div', { class: 'field' },
      h('label', { class: 'field__label', for: emailId }, t('ad.core.auth.email')),
      h('input', { class: 'input', id: emailId, name: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', placeholder: t('ad.core.auth.email_ph'), required: !isLocal })));
    form.appendChild(h('div', { class: 'field' },
      h('label', { class: 'field__label', for: pwId }, t('ad.core.auth.password')),
      h('input', { class: 'input', id: pwId, name: 'password', type: 'password', autocomplete: 'current-password', required: !isLocal })));
    var errEl = h('p', { class: 'field__error ad-auth__error', id: 'ad-login-error', role: 'alert', hidden: !errorKey }, errorKey ? t(errorKey) : '');
    form.appendChild(errEl);
    form.appendChild(h('button', { type: 'submit', class: 'btn ' + (isLocal ? 'btn--outline' : 'btn--primary btn--lg') + ' btn--block', id: 'ad-login-submit', html: icon('log-in') + '<span>' + U.esc(t('ad.core.auth.signin')) + '</span>' }));
    form.appendChild(h('p', { class: 'field__hint' }, t(isLocal ? 'ad.core.auth.local_note' : 'ad.core.auth.sup_note')));

    var panel = h('section', { class: 'ad-auth__panel' },
      h('div', { class: 'ad-auth__panel-head' },
        h('span', { class: 'icon-tile icon-tile--lg ' + (isLocal ? 'icon-tile--accent' : 'icon-tile--primary'), html: icon(isLocal ? 'hard-drive' : 'database') }),
        h('div', null,
          h('h2', { class: 'ad-auth__form-title' }, t('ad.core.auth.form_title')),
          h('p', { class: 'ad-auth__sub' }, isLocal ? t('ad.core.auth.local_sub') : t('ad.core.auth.supabase_sub', { url: maskUrl(cfg.supabaseUrl) })))));
    if (authNotice) {
      panel.appendChild(h('p', { class: 'ad-auth__notice', id: 'ad-auth-notice', role: 'status' },
        h('span', { class: 'ad-auth__notice-icon', html: icon('log-out') }), h('span', null, t(authNotice))));
    }
    if (isLocal) {
      panel.appendChild(h('div', { class: 'ad-auth__demo' },
        h('button', { type: 'button', class: 'btn btn--primary btn--lg btn--block', id: 'ad-demo', 'data-action': 'demo', html: icon('play') + '<span>' + U.esc(t('ad.core.auth.demo_btn')) + '</span>' }),
        h('p', { class: 'field__hint' }, t('ad.core.auth.demo_hint'))));
      panel.appendChild(h('div', { class: 'divider divider--label' }, t('ad.core.auth.or_email')));
    }
    panel.appendChild(form);
    panel.appendChild(h('a', { class: 'ad-auth__back', href: 'index.html', html: icon('arrow-left', 'icon--sm') + '<span>' + U.esc(t('ad.core.auth.back_app')) + '</span>' }));

    root.appendChild(h('div', { class: 'ad-auth__wrap' }, tools, h('div', { class: 'ad-auth__card' }, hero, panel)));

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.email.value.trim(), pw = form.password.value;
      var btn = document.getElementById('ad-login-submit');
      if (!isLocal && (!email || !pw)) { showAuthError('ad.core.auth.need_both'); return; }
      NC.ui.setLoading(btn, true);
      NC.data.admin.signIn(email || undefined, pw).then(function (sess) {
        NC.ui.setLoading(btn, false);
        if (!sess) { showAuthError('ad.core.auth.err_auth'); return; }
        if (mode() === 'supabase' && !sess.role) {
          NC.data.admin.signOut().catch(noop);
          showAuthError('ad.core.auth.err_role');
          return;
        }
        enter(sess);
      }, function (err) {
        NC.ui.setLoading(btn, false);
        var code = err && err.code;
        showAuthError(code === 'auth' ? 'ad.core.auth.err_auth' : (code === 'network' || code === 'timeout' || !navigator.onLine) ? 'ad.core.auth.err_network' : 'ad.core.auth.err_auth');
      });
    });
    var demo = document.getElementById('ad-demo');
    if (demo) demo.addEventListener('click', function () {
      NC.ui.setLoading(demo, true);
      NC.data.admin.enterDemo().then(function (sess) { NC.ui.setLoading(demo, false); enter(sess); }, function (err) {
        NC.ui.setLoading(demo, false);
        NC.ui.toast(errorText(err), { type: 'danger' });
      });
    });
  }
  function showAuthError(key) {
    var el = document.getElementById('ad-login-error');
    if (!el) return;
    el.textContent = t(key);
    el.hidden = false;
  }

  /** The skip link targets whichever <main> is visible (dashboard #ad-view or the auth gate #ad-auth). */
  function setSkipTarget(id) {
    var sk = document.querySelector('.skip-link');
    if (sk) sk.setAttribute('href', '#' + id);
  }

  /**
   * Show the auth gate. errorKey → inline form error; noticeKey → status line on top of the panel (e.g. the session
   * ended elsewhere). A plain showAuth() keeps no notice.
   */
  function showAuth(errorKey, noticeKey) {
    entered = false;
    authNotice = noticeKey || null;
    document.documentElement.classList.add('ad-gated');
    var app = document.getElementById('app'); if (app) app.hidden = true;
    var auth = document.getElementById('ad-auth'); if (auth) auth.hidden = false;
    setSkipTarget('ad-auth');
    renderAuth(errorKey);
    document.title = t('ad.core.auth.form_title') + ' · NomadCare Admin';
    var target = mode() === 'supabase' ? document.getElementById('ad-login-email') : (authNotice ? document.getElementById('ad-demo') : null);
    if (target) setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }

  function enter(sess) {
    sessionInfo = sess || { user: { email: 'admin' }, role: 'admin' };
    entered = true;
    authNotice = null;
    document.documentElement.classList.remove('ad-gated');
    var auth = document.getElementById('ad-auth'); if (auth) { auth.hidden = true; auth.innerHTML = ''; }
    var app = document.getElementById('app'); if (app) app.hidden = false;
    setSkipTarget('ad-view');
    updateUser();
    updateMode();
    updateBanner();
    buildNav();
    startLive();
    handleRoute(true);
    refreshBadges();
  }

  /** Tear the dashboard down (pages hidden → their timers/polls stop) and show the gate. */
  function leaveDashboard(errorKey, noticeKey) {
    closeUserMenu();
    closeDrawer();
    NC.ui.closeAll();
    stopLive();
    hideCurrent(null);
    current = null;
    sessionInfo = null;
    showAuth(errorKey, noticeKey);
  }

  function signOut() {
    closeUserMenu();
    NC.ui.closeAll();
    signingOut = true;
    Promise.resolve(NC.data.admin.signOut()).catch(noop).then(function () {
      signingOut = false;
      leaveDashboard();
      NC.ui.toast(t('ad.core.user.signed_out'), { type: 'info', timeout: 2400 });
    });
  }

  /**
   * The admin session disappeared while the dashboard is open (signOut in another tab, ?reset / cleared site data,
   * expired or revoked token): return to the gate ONCE instead of rendering stale data and failing on every refresh.
   */
  function sessionLost(errorKey) {
    if (!entered || signingOut) return;
    console.info('[admin] admin session ended — back to the sign-in screen');
    leaveDashboard(errorKey || null, 'ad.core.auth.session_lost');
  }

  /**
   * Re-read the session (after a 'forbidden' error or a storage change). Resolves true when it is gone (→ gate shown).
   * A network failure while checking keeps the dashboard (the banner already says offline).
   */
  function verifySession() {
    if (!entered) return Promise.resolve(false);
    if (lostCheck) return lostCheck;
    lostCheck = Promise.resolve().then(function () { return NC.data.admin.session(); }).then(function (sess) { return sess; }, function (e) {
      var c = e && e.code;
      return c === 'network' || c === 'timeout' || navigator.onLine === false ? undefined : null;
    }).then(function (sess) {
      lostCheck = null;
      if (sess === undefined || !entered || signingOut) return false;
      var ok = !!sess && (mode() === 'local' || !!sess.role);
      if (ok) return false;
      sessionLost(sess && !sess.role ? 'ad.core.auth.err_role' : null);
      return true;
    });
    return lostCheck;
  }

  /*
   * Every NC.data.admin.* call made by the pages goes through this guard: a 'forbidden'/'auth' failure re-checks the
   * session first, so a vanished session lands on the gate before the page's own error handling runs. The error is
   * still re-thrown (flagged e.sessionLost) so callers reset their busy state; pages skip their toast for it.
   */
  var GUARD_SKIP = { signIn: 1, signOut: 1, session: 1, enterDemo: 1, subscribe: 1 };
  function guardAdminApi() {
    var api = NC.data && NC.data.admin;
    if (!api || api._ncGuarded) return;
    Object.keys(api).forEach(function (name) {
      var fn = api[name];
      if (GUARD_SKIP[name] || typeof fn !== 'function') return;
      api[name] = function () {
        if (!entered) {
          // Signed out (gate showing): background leftovers (realtime-triggered reloads of hidden pages) must not hit the
          // server nor toast/log errors on the sign-in screen.
          var gone = new Error('Admin session ended');
          gone.code = 'forbidden'; gone.sessionLost = true;
          return Promise.reject(gone);
        }
        var p;
        try { p = Promise.resolve(fn.apply(api, arguments)); } catch (e0) { p = Promise.reject(e0); }
        return p.catch(function (e) {
          var c = e && e.code;
          if (c !== 'forbidden' && c !== 'auth') throw e;
          var flag = function () { try { e.sessionLost = true; } catch (e1) { /* frozen error */ } };
          if (!entered) { flag(); throw e; } // answered after the gate was shown
          return verifySession().then(function (lost) { if (lost) flag(); throw e; });
        });
      };
    });
    try { Object.defineProperty(api, '_ncGuarded', { value: true }); } catch (e2) { api._ncGuarded = true; }
  }

  /* Cross-tab / provider signals that the admin session is gone. */
  function watchSession() {
    // Local mode: the demo session lives in localStorage (nc.admin.demo) → another tab's signOut / reset fires 'storage'.
    window.addEventListener('storage', function (ev) {
      if (!entered) return;
      if (ev.key === null || /^nc\.admin\./.test(ev.key || '')) {
        if (mode() === 'local' && ev.key === 'nc.admin.demo' && !ev.newValue) sessionLost();
        else verifySession();
      }
    });
    // Supabase mode: supabase-js broadcasts SIGNED_OUT across tabs and on a failed token refresh.
    if (mode() === 'supabase') {
      try {
        var client = NC.backend && NC.backend.supabase && NC.backend.supabase.client && NC.backend.supabase.client();
        if (client && client.auth && client.auth.onAuthStateChange) {
          client.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT' && entered && !signingOut) setTimeout(function () { sessionLost(); }, 0); });
        }
      } catch (e) { /* the forbidden guard still covers it */ }
    }
  }

  /* ================================================================== */
  /* SHARED HELPERS FOR PAGES                                             */
  /* ================================================================== */
  function session() { return sessionInfo; }

  /** Human text for a data-layer error ({code, missing, message}). */
  function errorText(e) {
    var code = e && e.code;
    if (e && e.sessionLost) return t('ad.core.auth.session_lost');
    if (code === 'incomplete') {
      var list = (e.missing || []).map(function (f) { return NC.i18n.has('ad.fac.f.' + f) ? t('ad.fac.f.' + f) : f; });
      return t('ad.core.err.incomplete', { fields: list.join(', ') });
    }
    if (code === 'forbidden' || code === 'auth') return t('ad.core.err.forbidden');
    if (code === 'network' || code === 'timeout') return t('ad.core.err.network');
    if (code === 'not_supported') return t('ad.core.err.not_supported');
    if (code && /not_found$/.test(code)) return t('ad.core.err.not_found');
    if (code && /^duplicate/.test(code)) return t('ad.core.err.duplicate');
    if (code === 'invalid_coordinates') return t(e.reason === 'outside_vietnam' || /outside_vietnam/.test(String(e.details || '')) ? 'ad.core.err.outside_vietnam' : 'ad.core.err.invalid_coordinates');
    if (code === 'invalid_date' || code === 'rate_limited' || code === 'recipient_email_required') return t('ad.core.err.' + code);
    return t('ad.core.err.generic', { msg: (e && (e.message || code)) || '?' });
  }

  var STATUS_TONE = {
    verified: 'success', approved: 'success', active: 'info', pending: 'warning', in_review: 'warning', draft: 'neutral',
    rejected: 'danger', overdue: 'danger', alerted: 'accent', closed: 'neutral', retracted: 'neutral', inactive: 'neutral', stale: 'warning'
  };
  var STATUS_ICON = { verified: 'check-circle', approved: 'check-circle', pending: 'clock', rejected: 'x-circle', overdue: 'alert-triangle', alerted: 'bell-ring', active: 'activity', closed: 'check', stale: 'history', in_review: 'clock', draft: 'edit' };
  /** Status badge Element with a colour per status (verified/pending/rejected/active/overdue/alerted/closed/…). */
  function statusBadge(status, opts) {
    var s = String(status || 'pending');
    var label = NC.i18n.has('ad.core.status.' + s) ? t('ad.core.status.' + s) : s;
    var el = NC.ui.badge(label, (opts && opts.tone) || STATUS_TONE[s] || 'neutral', (opts && opts.icon === false) ? null : STATUS_ICON[s]);
    el.classList.add('ad-status', 'ad-status--' + s);
    return el;
  }
  function facType(type) { return NC.i18n.has('ad.core.fac_type.' + type) ? t('ad.core.fac_type.' + type) : (type || t('ad.core.unknown')); }
  function svcType(type) { return NC.i18n.has('ad.core.svc_type.' + type) ? t('ad.core.svc_type.' + type) : (type || t('ad.core.unknown')); }
  function travelMode(m) { return NC.i18n.has('ad.core.mode_t.' + m) ? t('ad.core.mode_t.' + m) : (m || ''); }

  /** Pilot routes from the bundled seed (sync, sorted). */
  function routes() {
    var S = window.NC_SEED || {};
    return (S.routes || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  }
  /** Route display name in the UI language; {short:true} drops the parenthesised detail. */
  function routeName(id, opts) {
    var r = routes().filter(function (x) { return x.id === id; })[0];
    if (!r) return id || t('ad.core.none');
    var n = (NC.i18n.lang() === 'en' && r.name_en) ? r.name_en : r.name;
    if (opts && opts.short) n = n.replace(/\s*\(.*\)\s*$/, '');
    return n;
  }
  /** Route region in the UI language (route.region_en in EN when the pack/seed has it). Accepts a route or its id. */
  function routeRegion(r) {
    if (typeof r === 'string') r = routes().filter(function (x) { return x.id === r; })[0];
    if (!r) return '';
    return (NC.i18n.lang() === 'en' && r.region_en) ? r.region_en : (r.region || '');
  }

  /** Audit actor_label that stands for the cron/system (not a person). */
  function isSystemActor(label) { return /cron|^system$|hệ thống/i.test(String(label || '')); }
  /**
   * Localised audit actor: system/cron, community, anonymous device and the seed team label follow the UI language;
   * real admin names/e-mails are shown as stored.
   */
  function actorLabel(label) {
    var a = String(label || '').trim();
    if (!a) return '–';
    if (isSystemActor(a)) return t('ad.core.actor.system');
    if (/^cộng đồng$|^community$/i.test(a)) return t('ad.core.actor.community');
    if (/^(device|anon)$/i.test(a)) return t('ad.core.actor.device');
    if (/^(nhóm|team) stormbreakers \((seed|dữ liệu mẫu|seed data)\)$/i.test(a)) return t('ad.core.actor.team_seed');
    return a;
  }

  function carriers() {
    var S = window.NC_SEED || {};
    var list = (S.carriers || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    return list.length ? list : [{ id: 'viettel', name: 'Viettel' }, { id: 'vinaphone', name: 'VinaPhone' }, { id: 'mobifone', name: 'MobiFone' }];
  }
  function carrierName(id) {
    var c = carriers().filter(function (x) { return x.id === id; })[0];
    return c ? c.name : (id || '');
  }

  /**
   * Page header. opts: {eyebrow, title, sub, icon, actions:[Node], meta:[Node]} → Element (.ad-page-head).
   */
  function pageHead(opts) {
    var o = opts || {};
    var text = h('div', { class: 'ad-page-head__text' });
    if (o.eyebrow) text.appendChild(h('span', { class: 'eyebrow' }, o.eyebrow));
    text.appendChild(h('h2', { class: 'ad-page-head__title' }, o.title || ''));
    if (o.sub) text.appendChild(h('p', { class: 'ad-page-head__sub' }, o.sub));
    if (o.meta && o.meta.length) text.appendChild(h('div', { class: 'ad-page-head__meta cluster' }, o.meta));
    var head = h('div', { class: 'ad-page-head' });
    if (o.icon) head.appendChild(h('span', { class: 'icon-tile icon-tile--lg ad-page-head__icon icon-tile--' + (o.tone || 'primary'), html: icon(o.icon) }));
    head.appendChild(text);
    if (o.actions && o.actions.length) head.appendChild(h('div', { class: 'ad-page-head__actions' }, o.actions));
    return head;
  }

  /**
   * <select class="select">. opts: {id, name, value, options:[{value,label}], all:'label for empty option', label (aria), cls}
   */
  function select(opts) {
    var o = opts || {};
    var sel = h('select', { class: 'select' + (o.cls ? ' ' + o.cls : ''), id: o.id || null, name: o.name || null, 'aria-label': o.label || null });
    if (o.all !== undefined && o.all !== null) sel.appendChild(h('option', { value: '' }, o.all));
    (o.options || []).forEach(function (op) {
      var el = h('option', { value: op.value }, op.label);
      if (String(op.value) === String(o.value === undefined || o.value === null ? '' : o.value)) el.selected = true;
      sel.appendChild(el);
    });
    return sel;
  }

  /** <dl class="kv"> from [[key, value(Node|string)], …]. */
  function kv(rows, cls) {
    var dl = h('dl', { class: 'kv' + (cls ? ' ' + cls : '') });
    rows.forEach(function (r) {
      if (!r) return;
      dl.appendChild(h('div', { class: 'kv__row' }, h('dt', null, r[0]), h('dd', null, r[1] === null || r[1] === undefined || r[1] === '' ? t('ad.core.none') : r[1])));
    });
    return dl;
  }

  function maskEmail(e) {
    var s = String(e || '');
    var i = s.indexOf('@');
    if (i < 1) return s ? s.charAt(0) + '•••' : '';
    return s.charAt(0) + '•••' + (i > 1 ? s.charAt(i - 1) : '') + s.slice(i);
  }
  function maskPhone(p) {
    var s = String(p || '').replace(/\s+/g, ' ').trim();
    if (s.length < 5) return s;
    return s.slice(0, 4) + ' ••• ' + s.slice(-3);
  }

  /**
   * One CSV cell, safe for spreadsheets (OWASP CSV injection): a text starting with = + - @ TAB or CR gets a leading
   * apostrophe so Excel/Sheets/LibreOffice never evaluate it (plain numbers such as -12.5 stay numbers), then RFC 4180 quoting.
   */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (/^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(s) && !/^-?\d+(?:[.,]\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  /** Download rows as CSV (UTF-8 BOM for Excel). cols: [{key, label, value?(row)}]. */
  function csv(filename, rows, cols) {
    var q = csvCell;
    var lines = [cols.map(function (c) { return q(c.label || c.key); }).join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return q(c.value ? c.value(r) : r[c.key]); }).join(',')); });
    U.downloadBlob(filename, new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  }

  /**
   * Right-hand drawer (desktop/tablet) / full-screen panel (phone) built on NC.ui.modal (focus trap, ESC, backdrop).
   * opts = NC.ui.modal opts + actions[i].align:'start' (push to the left, e.g. Delete). Returns the modal controller.
   */
  function drawer(opts) {
    var o = Object.assign({}, opts || {});
    var acts = o.actions || [];
    o.className = 'ad-drawer' + (o.className ? ' ' + o.className : '');
    o.size = o.size || 'lg';
    var ctrl = NC.ui.modal(o);
    var btns = $$('.sheet__footer > .btn', ctrl.panel);
    acts.forEach(function (a, i) { if (a.align === 'start' && btns[i]) btns[i].classList.add('ad-drawer__start'); });
    return ctrl;
  }

  /* ---------------- sortable, paginated table (→ cards on phones) ---------------- */
  function cmp(a, b) {
    var an = a === null || a === undefined || a === '', bn = b === null || b === undefined || b === '';
    if (an && bn) return 0; if (an) return 1; if (bn) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return String(a).localeCompare(String(b), NC.i18n.lang() === 'en' ? 'en' : 'vi', { numeric: true, sensitivity: 'base' });
  }

  /**
   * Build a sortable data table.
   * opts: {columns:[{key, label, sort?:true|fn(row), render?:fn(row)→Node|string (text; trusted HTML only with html:true),
   *        cls?, thCls? ('ad-hide-tab' hides the column on tablets), num?, primary?, mobileLabel?, html?}], rows, rowKey='id', sortKey, sortDir='asc'|'desc', pageSize=0 (no paging), onRow(row, ev),
   *        rowClass(row)→string, selected, empty:{icon,title,text}, caption, dense, keep (no card mode on phones), cls}
   * Returns {el, update(rows, {keepPage}), select(key), sort(key, dir), rows() → visible sorted rows, state}.
   */
  function table(opts) {
    var o = Object.assign({ rowKey: 'id', sortDir: 'asc', pageSize: 0 }, opts || {});
    var state = { rows: o.rows || [], key: o.sortKey || null, dir: o.sortDir === 'desc' ? 'desc' : 'asc', page: 0, selected: o.selected || null };
    var wrap = h('div', { class: 'ad-table-wrap' + (o.cls ? ' ' + o.cls : '') });
    var scroller = h('div', { class: 'table-wrap ad-table-scroll' });
    var tbl = h('table', { class: 'table ad-table' + (o.keep ? ' table--keep' : '') + (o.dense ? ' ad-table--dense' : '') });
    if (o.caption) tbl.appendChild(h('caption', { class: 'visually-hidden' }, o.caption));
    var thead = h('thead');
    var hr = h('tr');
    o.columns.forEach(function (c) {
      var th = h('th', { scope: 'col', class: [c.num ? 'num' : null, c.thCls || null].filter(Boolean).join(' ') || null, 'data-key': c.key });
      if (c.sort) {
        var b = h('button', { type: 'button', class: 'ad-th-sort', 'data-sort': c.key, 'aria-label': t('ad.core.table.sort', { col: c.label }) },
          h('span', null, c.label), h('span', { class: 'ad-th-sort__icon', html: icon('chevron-down', 'icon--xs') }));
        th.appendChild(b);
      } else {
        th.appendChild(document.createTextNode(c.label || ''));
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    var tbody = h('tbody');
    tbl.appendChild(thead); tbl.appendChild(tbody);
    scroller.appendChild(tbl);
    var foot = h('div', { class: 'ad-table__foot', hidden: true });
    wrap.appendChild(scroller);
    wrap.appendChild(foot);

    function sortValue(c, row) {
      if (typeof c.sort === 'function') return c.sort(row);
      return row[c.key];
    }
    function sorted() {
      var rows = state.rows.slice();
      var col = o.columns.filter(function (c) { return c.key === state.key && c.sort; })[0];
      if (col) {
        var dir = state.dir === 'desc' ? -1 : 1;
        rows.sort(function (a, b) {
          var va = sortValue(col, a), vb = sortValue(col, b);
          var an = va === null || va === undefined || va === '', bn = vb === null || vb === undefined || vb === '';
          if (an !== bn) return an ? 1 : -1; // empty values always last
          return cmp(va, vb) * dir;
        });
      }
      return rows;
    }
    function renderHead() {
      $$('th', thead).forEach(function (th) {
        var k = th.getAttribute('data-key');
        var col = o.columns.filter(function (c) { return c.key === k; })[0];
        if (!col || !col.sort) { th.removeAttribute('aria-sort'); return; }
        if (k === state.key) { th.setAttribute('aria-sort', state.dir === 'desc' ? 'descending' : 'ascending'); th.classList.add('is-sorted'); }
        else { th.setAttribute('aria-sort', 'none'); th.classList.remove('is-sorted'); }
      });
    }
    var visible = [];
    function renderBody() {
      var all = sorted();
      var total = all.length;
      var size = o.pageSize > 0 ? o.pageSize : total || 1;
      var pages = Math.max(1, Math.ceil(total / size));
      if (state.page >= pages) state.page = pages - 1;
      var from = state.page * size;
      visible = o.pageSize > 0 ? all.slice(from, from + size) : all;
      tbody.innerHTML = '';
      if (!total) {
        var e = o.empty || {};
        var td = h('td', { colspan: String(o.columns.length), class: 'ad-table__empty-cell' });
        td.appendChild(NC.ui.emptyState({ icon: e.icon || 'search', title: e.title || t('ad.core.table.empty'), text: e.text || t('ad.core.table.empty_hint'), compact: true }));
        tbody.appendChild(h('tr', { class: 'ad-table__empty' }, td));
      }
      visible.forEach(function (row) {
        var key = row[o.rowKey];
        var tr = h('tr', { class: 'ad-table__row' + (o.onRow ? ' is-clickable' : '') + (o.rowClass ? ' ' + (o.rowClass(row) || '') : ''), 'data-key': key === undefined ? null : String(key) });
        if (o.onRow) tr.setAttribute('tabindex', '0');
        if (state.selected !== null && String(state.selected) === String(key)) tr.classList.add('is-selected');
        o.columns.forEach(function (c) {
          var td = h('td', { 'data-label': c.mobileLabel !== undefined ? c.mobileLabel : (c.label || ''), class: [c.num ? 'num' : null, c.primary ? 'table__primary' : null, c.cls || null].filter(Boolean).join(' ') || null });
          var v = c.render ? c.render(row) : row[c.key];
          if (v && v.nodeType) td.appendChild(v);
          else if (c.html && typeof v === 'string') td.innerHTML = v; // trusted markup only (col.html = true)
          else td.textContent = v === null || v === undefined || v === '' ? '—' : String(v);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      if (o.pageSize > 0 && total > o.pageSize) {
        foot.hidden = false;
        foot.innerHTML = '';
        foot.appendChild(h('span', { class: 'ad-table__count tabular' }, t('ad.core.table.showing', { from: U.fmtNumber(from + 1), to: U.fmtNumber(Math.min(total, from + size)), total: U.fmtNumber(total) })));
        var pager = h('div', { class: 'ad-table__pager' });
        pager.appendChild(h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'data-page': 'prev', 'aria-label': t('ad.core.table.prev'), disabled: state.page <= 0, html: icon('chevron-left') }));
        pager.appendChild(h('span', { class: 'ad-table__pageno tabular' }, (state.page + 1) + ' / ' + pages));
        pager.appendChild(h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'data-page': 'next', 'aria-label': t('ad.core.table.next'), disabled: state.page >= pages - 1, html: icon('chevron-right') }));
        foot.appendChild(pager);
      } else {
        foot.hidden = true;
      }
    }
    function render() { renderHead(); renderBody(); }

    thead.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-sort]') : null;
      if (!b) return;
      var k = b.getAttribute('data-sort');
      if (state.key === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.key = k; state.dir = 'asc'; }
      state.page = 0;
      render();
      if (o.onSort) o.onSort(state.key, state.dir);
    });
    foot.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-page]') : null;
      if (!b || b.disabled) return;
      state.page += b.getAttribute('data-page') === 'next' ? 1 : -1;
      renderBody();
      if (wrap.getBoundingClientRect().top < 0) wrap.scrollIntoView({ block: 'start' });
    });
    function rowFor(tr) {
      var k = tr.getAttribute('data-key');
      return visible.filter(function (r) { return String(r[o.rowKey]) === k; })[0] || null;
    }
    tbody.addEventListener('click', function (e) {
      if (!o.onRow) return;
      if (e.target.closest && e.target.closest('a, button, input, select, textarea, label')) return;
      var tr = e.target.closest ? e.target.closest('tr[data-key]') : null;
      if (!tr) return;
      var row = rowFor(tr);
      if (row) o.onRow(row, e);
    });
    tbody.addEventListener('keydown', function (e) {
      if (!o.onRow || (e.key !== 'Enter' && e.key !== ' ')) return;
      var tr = e.target.closest ? e.target.closest('tr[data-key]') : null;
      if (!tr || e.target !== tr) return;
      e.preventDefault();
      var row = rowFor(tr);
      if (row) o.onRow(row, e);
    });
    render();

    return {
      el: wrap, state: state,
      update: function (rows, uo) { state.rows = rows || []; if (!(uo && uo.keepPage)) state.page = 0; renderBody(); },
      select: function (key) {
        state.selected = key === undefined ? null : key;
        $$('tr[data-key]', tbody).forEach(function (tr) { tr.classList.toggle('is-selected', key !== null && key !== undefined && tr.getAttribute('data-key') === String(key)); });
      },
      sort: function (key, dir) { state.key = key; state.dir = dir === 'desc' ? 'desc' : 'asc'; render(); },
      rows: function () { return visible.slice(); },
      all: function () { return sorted(); }
    };
  }

  /**
   * Small Leaflet map for admin cards/drawers (NC.mapkit.create + sensible defaults). Returns the map or null.
   * opts: {center:[lat,lng], zoom, interactive, scrollWheelZoom:false}
   */
  function miniMap(el, opts) {
    if (!window.L || !NC.mapkit) return null;
    var o = Object.assign({ zoom: 12, scrollWheelZoom: false }, opts || {});
    try {
      var map = NC.mapkit.create(el, o);
      NC.mapkit.refresh(map);
      return map;
    } catch (e) { console.warn('[admin] map failed', e); return null; }
  }

  /** Monotonic token to drop stale async renders: var k = NC.admin.refreshKey(); … if (k !== lastKey) return. */
  function refreshKey() { return ++refreshSeq; }

  /* ================================================================== */
  /* GLOBAL WIRING                                                        */
  /* ================================================================== */
  function wire() {
    document.addEventListener('click', function (e) {
      var tgt = e.target;
      if (!tgt || !tgt.closest) return;
      var go1 = tgt.closest('[data-ad-go]');
      if (go1) {
        e.preventDefault();
        closeUserMenu();
        go(go1.getAttribute('data-ad-go'), parseQuery(go1.getAttribute('data-params') || ''));
        return;
      }
      var act = tgt.closest('[data-ad-action]');
      if (act) {
        var a = act.getAttribute('data-ad-action');
        if (a === 'signout') { e.preventDefault(); signOut(); return; }
        if (a === 'lang') { toggleLang(); return; }
        if (a === 'theme') { cycleTheme(); var bt = act; setTimeout(function () { bt.innerHTML = icon(THEME_ICON[document.documentElement.getAttribute('data-theme') || 'auto']); }, 0); return; }
        if (a === 'sim-off') { if (NC.net) NC.net.setSimulated(false); return; }
      }
      if (menuOpen && !tgt.closest('#ad-user')) closeUserMenu();
      if (tgt.closest('#ad-nav .ad-nav__item')) closeDrawer();
    });
    var byId = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    byId('ad-menu', function () { if (drawerOpen) closeDrawer(); else openDrawer(); });
    byId('ad-drawer-close', closeDrawer);
    byId('ad-scrim', closeDrawer);
    byId('ad-theme', cycleTheme);
    byId('ad-lang', toggleLang);
    byId('ad-user-btn', function (e) { e.stopPropagation(); if (menuOpen) closeUserMenu(); else openUserMenu(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (menuOpen) { closeUserMenu(true); return; }
      if (drawerOpen) { closeDrawer(); var mb = document.getElementById('ad-menu'); if (mb) mb.focus(); }
    });
    var menu = document.getElementById('ad-user-menu');
    if (menu) menu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var items = $$('.ad-usermenu__item', menu);
      var i = items.indexOf(document.activeElement);
      var n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (n) { e.preventDefault(); n.focus(); }
    });
    if (mqPhone) {
      var onMq = function () { if (!isPhone()) closeDrawer(); updateTitle(); };
      if (mqPhone.addEventListener) mqPhone.addEventListener('change', onMq); else if (mqPhone.addListener) mqPhone.addListener(onMq);
    }
    window.addEventListener('hashchange', function () { handleRoute(false); });
    window.addEventListener('online', updateBanner);
    window.addEventListener('offline', updateBanner);
    var topbar = document.getElementById('ad-topbar');
    var onScroll = U.throttle(function () { if (topbar) topbar.classList.toggle('is-scrolled', window.pageYOffset > 4); }, 100);
    window.addEventListener('scroll', onScroll, { passive: true });

    NC.bus.on('i18n:change', function () {
      updateLangBtns();
      applyTheme(document.documentElement.getAttribute('data-theme') || 'auto', true);
      updateMode();
      setLive(liveState);
      updateTitle();
      updateBanner();
      updateUser();
      if (!entered) renderAuth();
      else if (menuOpen) buildUserMenu();
    });
    NC.bus.on('settings:change', function (p) {
      if (p && p.key === 'theme' && p.value !== document.documentElement.getAttribute('data-theme')) applyTheme(p.value);
    });
    NC.bus.on('net:change', updateBanner);
    NC.bus.on('data:mode', function () { updateMode(); });
  }

  /* ================================================================== */
  /* START                                                                */
  /* ================================================================== */
  function timeBox(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(); } }, ms);
      Promise.resolve(p).then(function () { if (!done) { done = true; clearTimeout(timer); resolve(); } },
        function (e) { console.warn('[admin] data init failed', e); if (!done) { done = true; clearTimeout(timer); resolve(); } });
    });
  }

  function hideSplash() {
    document.documentElement.classList.add('ad-ready');
    var sp = document.getElementById('ad-splash');
    if (sp) setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 400);
  }

  function start() {
    if (started) return;
    started = true;
    var q = U.qs();
    if (q.backend === 'local' && window.NC_CONFIG) window.NC_CONFIG.forceLocal = true;
    Object.keys(registry).forEach(ensureSection);
    wire();
    guardAdminApi();
    Promise.resolve().then(function () { return NC.settings.load(); }).catch(noop).then(function () {
      var jobs = [];
      if (THEMES.indexOf(q.theme) >= 0) jobs.push(NC.settings.set('theme', q.theme));
      if (q.lang === 'vi' || q.lang === 'en') jobs.push(NC.settings.set('lang', q.lang));
      if ((q.offline === '1' || q.offline === '0') && NC.net) jobs.push(NC.net.setSimulated(q.offline === '1'));
      return Promise.all(jobs).catch(noop);
    }).then(function () {
      applyTheme(NC.settings.get('theme'), true);
      NC.i18n.setLang(NC.settings.get('lang') || 'vi', { persist: false, force: true });
      updateLangBtns();
      return timeBox(NC.data.init(), 8000);
    }).then(function () {
      updateMode();
      watchSession();
      return Promise.resolve(NC.data.admin.session()).catch(function () { return null; });
    }).then(function (sess) {
      hideSplash();
      if (sess && (mode() === 'local' || sess.role)) enter(sess);
      else showAuth(sess && !sess.role ? 'ad.core.auth.err_role' : null);
    }).catch(function (e) {
      console.error('[admin] start failed', e);
      hideSplash();
      showAuth();
    });
  }

  NC.admin = {
    register: register, go: go, current: currentRoute, setTitle: setTitle, refreshBadges: refreshBadges,
    // shared helpers
    live: live, session: session, mode: mode, drawer: drawer, table: table, pageHead: pageHead, select: select, kv: kv,
    statusBadge: statusBadge, facType: facType, svcType: svcType, travelMode: travelMode,
    routes: routes, routeName: routeName, routeRegion: routeRegion, carriers: carriers, carrierName: carrierName,
    actorLabel: actorLabel, isSystemActor: isSystemActor,
    errorText: errorText, csv: csv, csvCell: csvCell, miniMap: miniMap, maskEmail: maskEmail, maskPhone: maskPhone, maskUrl: maskUrl,
    refreshKey: refreshKey, isPhone: isPhone, liveState: function () { return liveState; }, pages: function () { return ordered(); }
  };

  if (document.readyState === 'complete') setTimeout(start, 0);
  else document.addEventListener('DOMContentLoaded', start);
})(window.NC = window.NC || {});
