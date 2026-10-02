/*
 * app.js — hash router + app shell wiring (contract §4 NC.app, §5 shell DOM).
 * Owner: P1 shell. Public API: NC.app.{register(name, def), go(name, params, {replace}), current(), back(),
 * setTitle(text), start(), applyTheme(pref), theme() → 'light'|'dark', routes(), isRegistered(name),
 * openConnection(), openCarrier(), readyState() → {ready, onboarding}, nav() → {collapsed, tabbarHidden, drawerOpen},
 * setNavCollapsed(bool), openDrawer(), closeDrawer()}. Registers i18n namespace app.*.
 * C1 events: 'app:ready' {onboarding} once after start; 'nav:change' {collapsed, tabbarHidden, drawerOpen}.
 * Navigation chrome: desktop ≥1200 sidebar ↔ 88px rail (NC.settings 'nav_collapsed', pre-paint mirror in
 * theme-init.js → html.nc-nav-collapsed); tablet 768–1199 rail + ☰ overlay drawer (#nav-scrim, ESC, Back, focus
 * trap, lockScroll); phone <768 tab bar auto-hides on scroll-down (html.nc-tabbar-hidden) — the 115 button never.
 * Degrades gracefully when NC.data / screens are missing (every call guarded).
 * Global delegation: [data-go="map"][data-params="to=fac-1"], [data-action="emergency"|"back"|"connection"|"carrier"].
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var $ = U.$, $$ = U.$$, h = U.h;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }

  var ROUTES = ['home', 'translate', 'map', 'qr', 'buddy', 'firstaid', 'settings', 'onboarding'];
  var TAB_ROOTS = ['home', 'map', 'buddy', 'qr'];
  var ROUTE_ICON = { home: 'home', translate: 'languages', map: 'map', qr: 'qr', buddy: 'shield-check', firstaid: 'cross', settings: 'settings', onboarding: 'sparkles' };
  var ROUTE_MOD = { translate: 'MOD.01', map: 'MOD.02', qr: 'MOD.03', buddy: 'MOD.04', firstaid: 'MOD.05' };
  var THEMES = ['auto', 'light', 'dark'];
  var THEME_COLOR = { light: '#0B7A6E', dark: '#0E1616' };
  var CARRIERS = [
    { id: 'viettel', name: 'Viettel' },
    { id: 'vinaphone', name: 'VinaPhone' },
    { id: 'mobifone', name: 'MobiFone' }
  ];

  var registry = Object.create(null);
  var mounted = Object.create(null);
  var current = null;          // {name, params}
  var customTitle = null;
  var started = false;
  var visited = [];            // hashes, for back()
  var lastOnline = null;
  var readyInfo = { ready: false, onboarding: false };

  /* ================================================================== */
  /* i18n — app.*                                                         */
  /* ================================================================== */
  if (NC.i18n) NC.i18n.add({
    vi: {
      'app.name': 'NomadCare', 'app.tagline': 'Chiếc phao sinh tồn kỹ thuật số', 'app.brand_home': 'NomadCare — Trang chủ',
      'app.skip': 'Bỏ qua, tới nội dung chính', 'app.splash': 'Đang chuẩn bị dữ liệu offline…',
      'app.nav.aria': 'Điều hướng chính',
      'app.nav.home': 'Trang chủ', 'app.nav.translate': 'Dịch y tế', 'app.nav.map': 'Bản đồ', 'app.nav.qr': 'Hồ sơ QR',
      'app.nav.buddy': 'Buddy', 'app.nav.firstaid': 'Sơ cứu', 'app.nav.settings': 'Cài đặt',
      'app.nav_short.home': 'Trang chủ', 'app.nav_short.translate': 'Dịch', 'app.nav_short.map': 'Bản đồ', 'app.nav_short.qr': 'Hồ sơ',
      'app.nav_short.buddy': 'Buddy', 'app.nav_short.firstaid': 'Sơ cứu', 'app.nav_short.settings': 'Cài đặt',
      'app.tab.aria': 'Thanh điều hướng', 'app.tab.home': 'Trang chủ', 'app.tab.map': 'Bản đồ', 'app.tab.emergency': 'Khẩn cấp',
      'app.tab.buddy': 'Buddy', 'app.tab.qr': 'Hồ sơ QR',
      'app.title.home': 'Trang chủ', 'app.title.translate': 'Dịch y tế 1 chạm', 'app.title.map': 'Bản đồ & định tuyến offline',
      'app.title.qr': 'Hồ sơ QR sinh tồn', 'app.title.buddy': 'Buddy Check-in', 'app.title.firstaid': 'Thư viện sơ cứu',
      'app.title.settings': 'Cài đặt', 'app.title.onboarding': 'Bắt đầu',
      'app.title_short.home': 'Trang chủ', 'app.title_short.translate': 'Dịch y tế', 'app.title_short.map': 'Bản đồ offline',
      'app.title_short.qr': 'Hồ sơ QR', 'app.title_short.buddy': 'Buddy Check-in', 'app.title_short.firstaid': 'Sơ cứu',
      'app.title_short.settings': 'Cài đặt', 'app.title_short.onboarding': 'Bắt đầu',
      'app.emergency': 'Khẩn cấp', 'app.emergency_aria': 'Mở màn hình khẩn cấp — gọi 115, gửi SOS',
      'app.back': 'Quay lại',
      'app.nav.collapse': 'Thu gọn thanh điều hướng', 'app.nav.expand': 'Mở rộng thanh điều hướng',
      'app.nav.open': 'Mở menu điều hướng', 'app.nav.close': 'Đóng menu điều hướng',
      'app.net.online': 'Online', 'app.net.offline': 'Offline', 'app.net.offline_sim': 'Offline · giả lập', 'app.net.sim_badge': 'Giả lập',
      'app.net.aria': 'Kết nối: {state}. Nhấn để xem chi tiết và giả lập mất sóng',
      'app.net.aria_pending': 'Kết nối: {state} · {n} thao tác chờ gửi. Nhấn để xem chi tiết',
      'app.net.sim_reset': 'Đã tắt “Giả lập mất sóng” của trình mô phỏng hành trình — tải lại trang sẽ kết thúc mọi mô phỏng.',
      'app.banner.offline': 'Đang offline — mọi tính năng cứu mạng vẫn hoạt động',
      'app.banner.sim': 'Chế độ “Giả lập mất sóng” đang bật',
      'app.banner.real': 'Check-in và báo cáo được xếp hàng, tự gửi khi có sóng.',
      'app.banner.turn_off': 'Tắt giả lập',
      'app.carrier.title': 'Nhà mạng của bạn',
      'app.carrier.sub': 'Lớp phủ sóng trên bản đồ và cảnh báo vùng mất sóng được tính riêng cho từng nhà mạng.',
      'app.carrier.changed': 'Đã chuyển sang {name}', 'app.carrier.more': 'Cài đặt khác',
      'app.carrier.selected': 'Đang dùng',
      'app.theme.auto': 'Tự động', 'app.theme.light': 'Sáng', 'app.theme.dark': 'Tối',
      'app.lang.aria': 'Ngôn ngữ: Tiếng Việt. Nhấn để chuyển sang English', 'app.lang.changed': 'Đã chuyển sang Tiếng Việt',
      'app.status.carrier': 'Nhà mạng',
      'app.backend.supabase': 'Supabase', 'app.backend.local': 'Cục bộ', 'app.backend.none': 'Chưa sẵn sàng',
      'app.backend.supabase_long': 'Supabase · PostgreSQL + PostGIS', 'app.backend.local_long': 'Máy chủ mô phỏng trong trình duyệt',
      'app.conn.title': 'Kết nối & đồng bộ',
      'app.conn.online_title': 'Đang có mạng', 'app.conn.online_desc': 'Các thao tác trong hàng đợi sẽ tự gửi lên máy chủ.',
      'app.conn.offline_title': 'Đang offline',
      'app.conn.offline_desc': 'Bản đồ đã tải, hồ sơ QR, dịch y tế và sơ cứu vẫn hoạt động. Check-in và báo cáo được xếp hàng, tự gửi khi có sóng.',
      'app.conn.sim_label': 'Giả lập mất sóng',
      'app.conn.sim_hint': 'Dùng khi demo: toàn bộ ứng dụng hoạt động như ở vùng lõm sóng, kể cả khi thiết bị vẫn có wifi.',
      'app.conn.real': 'Mạng thật của thiết bị', 'app.conn.real_on': 'Có kết nối', 'app.conn.real_off': 'Không có kết nối',
      'app.conn.outbox': 'Hàng đợi gửi', 'app.conn.outbox_n': '{n} thao tác', 'app.conn.last_sync': 'Đồng bộ gần nhất',
      'app.conn.backend': 'Máy chủ', 'app.conn.device': 'Mã thiết bị', 'app.conn.pack': 'Gói dữ liệu tuyến',
      'app.conn.sync_now': 'Đồng bộ ngay', 'app.conn.synced': 'Đã đồng bộ: gửi {sent}, lỗi {failed}',
      'app.conn.sync_offline': 'Không thể đồng bộ khi đang offline — thao tác vẫn nằm an toàn trong hàng đợi.',
      'app.conn.sync_unavailable': 'Tầng dữ liệu chưa sẵn sàng.',
      'app.conn.privacy': 'Hồ sơ y tế được mã hoá trên máy và không bao giờ đồng bộ lên máy chủ.',
      'app.sw.updated': 'Có phiên bản mới của NomadCare.', 'app.sw.reload': 'Tải lại',
      'app.placeholder': 'Màn hình này đang được hoàn thiện.',
      'app.error.screen': 'Không thể hiển thị màn hình này. Các tính năng khẩn cấp vẫn dùng được.',
      'app.noscript': 'NomadCare cần JavaScript để chạy. Trong trường hợp khẩn cấp, hãy gọi 115.'
    },
    en: {
      'app.name': 'NomadCare', 'app.tagline': 'Your digital survival lifeline', 'app.brand_home': 'NomadCare — Home',
      'app.skip': 'Skip to main content', 'app.splash': 'Preparing offline data…',
      'app.nav.aria': 'Main navigation',
      'app.nav.home': 'Home', 'app.nav.translate': 'Medical phrases', 'app.nav.map': 'Map', 'app.nav.qr': 'QR profile',
      'app.nav.buddy': 'Buddy', 'app.nav.firstaid': 'First aid', 'app.nav.settings': 'Settings',
      'app.nav_short.home': 'Home', 'app.nav_short.translate': 'Phrases', 'app.nav_short.map': 'Map', 'app.nav_short.qr': 'Profile',
      'app.nav_short.buddy': 'Buddy', 'app.nav_short.firstaid': 'First aid', 'app.nav_short.settings': 'Settings',
      'app.tab.aria': 'Tab bar', 'app.tab.home': 'Home', 'app.tab.map': 'Map', 'app.tab.emergency': 'SOS',
      'app.tab.buddy': 'Buddy', 'app.tab.qr': 'QR profile',
      'app.title.home': 'Home', 'app.title.translate': 'One-tap medical phrases', 'app.title.map': 'Offline map & routing',
      'app.title.qr': 'Survival QR profile', 'app.title.buddy': 'Buddy check-in', 'app.title.firstaid': 'First-aid library',
      'app.title.settings': 'Settings', 'app.title.onboarding': 'Get started',
      'app.title_short.home': 'Home', 'app.title_short.translate': 'Medical phrases', 'app.title_short.map': 'Offline map',
      'app.title_short.qr': 'QR profile', 'app.title_short.buddy': 'Buddy check-in', 'app.title_short.firstaid': 'First aid',
      'app.title_short.settings': 'Settings', 'app.title_short.onboarding': 'Get started',
      'app.emergency': 'Emergency', 'app.emergency_aria': 'Open emergency screen — call 115, send SOS',
      'app.back': 'Back',
      'app.nav.collapse': 'Collapse the navigation', 'app.nav.expand': 'Expand the navigation',
      'app.nav.open': 'Open the navigation menu', 'app.nav.close': 'Close the navigation menu',
      'app.net.online': 'Online', 'app.net.offline': 'Offline', 'app.net.offline_sim': 'Offline · simulated', 'app.net.sim_badge': 'Simulated',
      'app.net.aria': 'Connection: {state}. Tap for details and to simulate signal loss',
      'app.net.aria_pending': 'Connection: {state} · {n} actions waiting to sync. Tap for details',
      'app.net.sim_reset': 'The journey simulator’s “Simulate signal loss” was turned off — reloading the page ends any simulation.',
      'app.banner.offline': "You're offline — every life-saving feature still works",
      'app.banner.sim': '“Simulate signal loss” is on',
      'app.banner.real': 'Check-ins and reports are queued and sent at the first signal.',
      'app.banner.turn_off': 'Turn off',
      'app.carrier.title': 'Your mobile carrier',
      'app.carrier.sub': 'Map coverage and dead-zone warnings are computed separately for each carrier.',
      'app.carrier.changed': 'Switched to {name}', 'app.carrier.more': 'More settings',
      'app.carrier.selected': 'In use',
      'app.theme.auto': 'Auto', 'app.theme.light': 'Light', 'app.theme.dark': 'Dark',
      'app.lang.aria': 'Language: English. Tap to switch to Tiếng Việt', 'app.lang.changed': 'Switched to English',
      'app.status.carrier': 'Carrier',
      'app.backend.supabase': 'Supabase', 'app.backend.local': 'Local', 'app.backend.none': 'Not ready',
      'app.backend.supabase_long': 'Supabase · PostgreSQL + PostGIS', 'app.backend.local_long': 'In-browser mock server',
      'app.conn.title': 'Connection & sync',
      'app.conn.online_title': 'You are online', 'app.conn.online_desc': 'Queued actions are sent to the server automatically.',
      'app.conn.offline_title': 'You are offline',
      'app.conn.offline_desc': 'Downloaded maps, the QR profile, medical phrases and first aid keep working. Check-ins and reports are queued and sent at the first signal.',
      'app.conn.sim_label': 'Simulate signal loss',
      'app.conn.sim_hint': 'For demos: the whole app behaves as if in a dead zone, even while the device still has wifi.',
      'app.conn.real': 'Device network', 'app.conn.real_on': 'Connected', 'app.conn.real_off': 'No connection',
      'app.conn.outbox': 'Outbox', 'app.conn.outbox_n': '{n} actions', 'app.conn.last_sync': 'Last sync',
      'app.conn.backend': 'Server', 'app.conn.device': 'Device ID', 'app.conn.pack': 'Route data pack',
      'app.conn.sync_now': 'Sync now', 'app.conn.synced': 'Synced: {sent} sent, {failed} failed',
      'app.conn.sync_offline': "Can't sync while offline — your actions stay safely queued.",
      'app.conn.sync_unavailable': 'The data layer is not ready yet.',
      'app.conn.privacy': 'Your medical profile is encrypted on this device and never synced to the server.',
      'app.sw.updated': 'A new version of NomadCare is available.', 'app.sw.reload': 'Reload',
      'app.placeholder': 'This screen is being prepared.',
      'app.error.screen': "This screen couldn't be displayed. Emergency features still work.",
      'app.noscript': 'NomadCare needs JavaScript. In an emergency, call 115.'
    }
  });

  /* Sidebar toggle glyphs (Lucide-style panel icons) */
  if (NC.icons && NC.icons.add) {
    if (!NC.icons.has('panel-left-close')) NC.icons.add('panel-left-close', '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>');
    if (!NC.icons.has('panel-left-open')) NC.icons.add('panel-left-open', '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>');
  }

  /* ================================================================== */
  /* ROUTER                                                               */
  /* ================================================================== */

  /**
   * Register a screen. def: {titleKey, shortTitleKey (topbar on phones, default 'app.title_short.<name>'),
   * mod:'MOD.02'|null, icon, mount(sectionEl) (once), show(params), hide()}.
   */
  function register(name, def) {
    registry[name] = Object.assign({ titleKey: 'app.title.' + name, mod: ROUTE_MOD[name] || null, icon: ROUTE_ICON[name] || null }, def || {});
    if (started && current && current.name === name) activate(name, current.params, true);
  }
  function isRegistered(name) { return !!registry[name]; }

  function parseHash(hash) {
    var raw = String(hash === undefined ? window.location.hash : hash).replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var path = qi >= 0 ? raw.slice(0, qi) : raw;
    var query = qi >= 0 ? raw.slice(qi + 1) : '';
    var name = '';
    try { name = decodeURIComponent(path.split('/')[0] || ''); } catch (e) { name = ''; }
    var params = {};
    if (query) {
      query.split('&').forEach(function (p) {
        if (!p) return;
        var i = p.indexOf('=');
        var k = i >= 0 ? p.slice(0, i) : p, v = i >= 0 ? p.slice(i + 1) : '';
        try { params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* skip malformed */ }
      });
    }
    return { name: name, params: params };
  }
  function buildHash(name, params) {
    var keys = params ? Object.keys(params).filter(function (k) { return params[k] !== undefined && params[k] !== null; }) : [];
    var q = keys.map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return '#/' + name + (q ? '?' + q : '');
  }
  function sameParams(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }

  function replaceHash(hash) {
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + hash); }
    catch (e) { window.location.replace(hash); }
    if (NC.ui && NC.ui._noteUrl) NC.ui._noteUrl();
  }

  /** Navigate. opts.replace → no new history entry. Same hash → re-show (fresh params). */
  function go(name, params, opts) {
    // An overlay that just closed is popping its history entry (async): navigating now would be undone by it.
    if (NC.ui && NC.ui.historyBusy && NC.ui.historyBusy()) { NC.ui.afterHistory(function () { go(name, params, opts); }); return; }
    var hash = buildHash(name, params);
    if (opts && opts.replace) { replaceHash(hash); handleRoute(true); return; }
    if (window.location.hash === hash) { handleRoute(true); return; }
    window.location.hash = hash;
  }
  function back() {
    if (visited.length > 1) window.history.back();
    else go('home', null, { replace: true });
  }
  function currentRoute() { return current ? { name: current.name, params: Object.assign({}, current.params) } : null; }

  function needsOnboarding() {
    return !!registry.onboarding && !!NC.settings && !NC.settings.get('onboarded') && U.qs().demo !== '1';
  }

  function handleRoute(force) {
    var r = parseHash();
    if (!r.name) { replaceHash('#/home'); r = { name: 'home', params: {} }; }
    if (ROUTES.indexOf(r.name) < 0 && !registry[r.name]) { replaceHash('#/home'); r = { name: 'home', params: {} }; }
    if (r.name !== 'onboarding' && needsOnboarding()) { replaceHash('#/onboarding'); r = { name: 'onboarding', params: {} }; }
    // track history for back()
    var hash = window.location.hash;
    if (visited.length > 1 && visited[visited.length - 2] === hash) visited.pop();
    else if (visited[visited.length - 1] !== hash) visited.push(hash);
    if (visited.length > 50) visited.shift();
    if (!force && current && current.name === r.name && sameParams(current.params, r.params)) return;
    activate(r.name, r.params, force);
  }

  function sectionFor(name) {
    if (name === 'onboarding') return document.getElementById('screen-onboarding');
    var s = document.getElementById('screen-' + name);
    if (!s) {
      var view = document.getElementById('view');
      if (!view) return null;
      s = h('section', { class: 'screen', id: 'screen-' + name, 'data-screen': name });
      view.appendChild(s);
    }
    return s;
  }

  function renderPlaceholder(section, name) {
    if (!section || section.querySelector('.screen__placeholder') || section.children.length) return;
    var ph = h('div', { class: 'screen__placeholder' });
    var es = NC.ui ? NC.ui.emptyState({
      icon: ROUTE_ICON[name] || 'compass', variant: 'primary',
      title: t('app.title.' + name), text: t('app.placeholder')
    }) : h('p', null, t('app.placeholder'));
    ph.appendChild(es);
    section.appendChild(ph);
  }
  function renderError(section) {
    if (!section) return;
    section.innerHTML = '';
    if (NC.ui) section.appendChild(NC.ui.emptyState({ icon: 'alert-triangle', variant: 'warning', title: t('common.error'), text: t('app.error.screen') }));
  }

  function activate(name, params, force) {
    var prev = current;
    var nameChanged = !prev || prev.name !== name;
    // Never leave a sheet/dialog of the previous screen floating over the new one (keepOnRoute overlays excepted).
    if (prev && nameChanged && NC.ui && NC.ui.openCount && NC.ui.openCount() > 0) { try { NC.ui.closeAll({ route: true }); } catch (e) { /* ignore */ } }
    if (prev && nameChanged) {
      var pd = registry[prev.name];
      if (pd && typeof pd.hide === 'function') { try { pd.hide(); } catch (e) { console.error('[app] hide(' + prev.name + ') failed', e); } }
    }
    var section = sectionFor(name);
    var isOb = name === 'onboarding';
    $$('#view > .screen').forEach(function (s) { s.classList.toggle('is-active', !isOb && s === section); });
    var ob = document.getElementById('screen-onboarding');
    if (ob) { ob.hidden = !isOb; ob.classList.toggle('is-active', isOb); }
    document.documentElement.classList.toggle('is-onboarding', isOb);

    current = { name: name, params: params || {} };
    customTitle = null;
    var app = document.getElementById('app');
    if (app) app.setAttribute('data-route', name);
    updateNav(name);

    var def = registry[name];
    if (def) {
      if (!mounted[name]) {
        mounted[name] = true;
        // A screen that registers late (after its placeholder was shown) must start from a clean section.
        $$('.screen__placeholder', section).forEach(function (ph) { if (ph.parentNode) ph.parentNode.removeChild(ph); });
        try { if (typeof def.mount === 'function') def.mount(section); }
        catch (e) { console.error('[app] mount(' + name + ') failed', e); renderError(section); }
      }
      try { if (typeof def.show === 'function') def.show(current.params); }
      catch (e2) { console.error('[app] show(' + name + ') failed', e2); }
    } else {
      renderPlaceholder(section, name);
    }
    updateTopbar();
    syncHeading(section);
    updateSkipLink(isOb);
    if (nameChanged || force) {
      window.scrollTo(0, 0);
      var overlayOpen = !!(NC.ui && NC.ui.openCount && NC.ui.openCount() > 0);
      if (overlayOpen && NC.ui._lockedScrollTo) NC.ui._lockedScrollTo(0);
      var focusTarget = isOb ? ob : document.getElementById('view');
      // A keepOnRoute overlay still open over the new screen keeps the focus.
      if (focusTarget && started && !overlayOpen) {
        if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
        try { focusTarget.focus({ preventScroll: true }); } catch (e3) { /* ignore */ }
      }
    }
    if (NC.bus) NC.bus.emit('route:change', { name: name, params: current.params });
  }

  function updateNav(name) {
    $$('[data-nav]').forEach(function (el) {
      if (el.getAttribute('data-nav') === name) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
    // Short rail (844×390 landscape, 1024×600): the current screen's item may sit below the list's clipped edge →
    // scroll it into the nav list so the rail always shows where the user is (R2.0). Again after layout settles.
    revealCurrentNav();
    if (window.requestAnimationFrame) window.requestAnimationFrame(revealCurrentNav);
  }

  /*
   * Exactly one level-1 heading per screen: the topbar title acts as the h1 (role=heading aria-level=1) unless the
   * active screen renders its own <h1> (e.g. a hero title). Re-checked after the screen had time to render.
   */
  var headingTimers = [];
  function syncHeadingNow(section) {
    var titleEl = document.getElementById('topbar-title');
    if (!titleEl) return;
    var own = section ? section.querySelector('h1, [role="heading"][aria-level="1"]') : null;
    if (own && own !== titleEl) { titleEl.removeAttribute('role'); titleEl.removeAttribute('aria-level'); }
    else { titleEl.setAttribute('role', 'heading'); titleEl.setAttribute('aria-level', '1'); }
  }
  function syncHeading(section) {
    headingTimers.forEach(clearTimeout);
    syncHeadingNow(section);
    headingTimers = [80, 700].map(function (ms) { return setTimeout(function () { syncHeadingNow(sectionFor(current ? current.name : 'home')); }, ms); });
  }
  /* The skip link targets the visible main region and moves focus there WITHOUT touching the hash route. */
  function updateSkipLink(isOb) {
    var sk = document.querySelector('.skip-link');
    if (sk) sk.setAttribute('href', isOb ? '#screen-onboarding' : '#view');
  }

  /** Override the topbar/document title for the current screen (reset on next route change). */
  function setTitle(text) { customTitle = text; updateTopbar(); }

  function titleFor(name) {
    var def = registry[name];
    var key = (def && def.titleKey) || ('app.title.' + name);
    var s = t(key);
    return s === key ? t('app.title.' + name) : s;
  }
  /** Compact title for the phone topbar (falls back to the full title). */
  function shortTitleFor(name) {
    var def = registry[name];
    var key = (def && def.shortTitleKey) || ('app.title_short.' + name);
    return (NC.i18n && NC.i18n.has(key)) ? t(key) : titleFor(name);
  }
  var mqPhone = window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
  function isPhone() { return !!(mqPhone && mqPhone.matches); }
  if (mqPhone) {
    if (mqPhone.addEventListener) mqPhone.addEventListener('change', function () { updateTopbar(); });
    else if (mqPhone.addListener) mqPhone.addListener(function () { updateTopbar(); });
  }

  function updateTopbar() {
    if (!current) return;
    var name = current.name;
    var def = registry[name] || {};
    var title = customTitle || titleFor(name);
    var titleEl = document.getElementById('topbar-title');
    if (titleEl) {
      titleEl.textContent = customTitle || (isPhone() ? shortTitleFor(name) : title);
      titleEl.setAttribute('title', title);
    }
    var modEl = document.getElementById('topbar-mod');
    var mod = def.mod !== undefined ? def.mod : ROUTE_MOD[name];
    if (modEl) { modEl.textContent = mod || ''; modEl.hidden = !mod; }
    var backBtn = document.getElementById('topbar-back');
    if (backBtn) backBtn.hidden = TAB_ROOTS.indexOf(name) >= 0 || name === 'onboarding';
    document.title = name === 'home' ? 'NomadCare — ' + t('app.tagline') : title + ' · NomadCare';
  }

  /* ================================================================== */
  /* THEME / LANGUAGE                                                     */
  /* ================================================================== */
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /** Effective theme ('light'|'dark'), resolving 'auto' against the OS. */
  function resolvedTheme() {
    var pref = document.documentElement.getAttribute('data-theme') || 'auto';
    if (pref === 'auto') return (mqDark && mqDark.matches) ? 'dark' : 'light';
    return pref;
  }
  function updateThemeMeta() {
    var pref = document.documentElement.getAttribute('data-theme') || 'auto';
    $$('meta[name="theme-color"]').forEach(function (m) {
      var media = m.getAttribute('media') || '';
      var forDark = media.indexOf('dark') >= 0;
      m.setAttribute('content', pref === 'auto' ? THEME_COLOR[forDark ? 'dark' : 'light'] : THEME_COLOR[pref]);
    });
  }
  /** Apply a theme preference ('auto'|'light'|'dark') to <html>; emits theme:change unless silent. */
  function applyTheme(pref, silent) {
    var p = THEMES.indexOf(pref) >= 0 ? pref : 'auto';
    document.documentElement.setAttribute('data-theme', p);
    updateThemeMeta();
    if (!silent && NC.bus) NC.bus.emit('theme:change', { theme: p, resolved: resolvedTheme() });
  }
  if (mqDark) {
    var onScheme = function () {
      if ((document.documentElement.getAttribute('data-theme') || 'auto') === 'auto' && NC.bus) {
        NC.bus.emit('theme:change', { theme: 'auto', resolved: resolvedTheme() });
      }
    };
    if (mqDark.addEventListener) mqDark.addEventListener('change', onScheme);
    else if (mqDark.addListener) mqDark.addListener(onScheme);
  }

  function updateLangBtn() {
    var btn = document.getElementById('lang-toggle');
    if (!btn) return;
    var l = NC.i18n ? NC.i18n.lang() : 'vi';
    var code = btn.querySelector('.lang-toggle__code');
    if (code) code.textContent = l.toUpperCase();
    btn.setAttribute('aria-label', t('app.lang.aria'));
    btn.setAttribute('title', t('app.lang.aria'));
  }
  function toggleLang() {
    if (!NC.i18n) return;
    NC.i18n.setLang(NC.i18n.lang() === 'vi' ? 'en' : 'vi');
    if (NC.ui) NC.ui.toast(t('app.lang.changed'), { timeout: 1600 });
  }

  /* ================================================================== */
  /* STATUS (net pill with the pending-sync count, slim offline banner)   */
  /* Carrier, server mode, pack and outbox details live in Settings →      */
  /* "Kết nối & kỹ thuật" and in the connection sheet (net pill).          */
  /* ================================================================== */
  function netStatus() {
    return NC.net ? NC.net.status() : { online: navigator.onLine !== false, simulated: false, real: navigator.onLine !== false };
  }
  function carrierName(id) {
    var seed = window.NC_SEED && window.NC_SEED.carriers;
    if (seed && seed.length) {
      var c = seed.filter(function (x) { return x.id === id; })[0];
      if (c && c.name) return c.name;
    }
    var f = CARRIERS.filter(function (x) { return x.id === id; })[0];
    return f ? f.name : (id || '—');
  }
  function routeName(id) {
    var routes = (window.NC_SEED && window.NC_SEED.routes) || [];
    var r = routes.filter(function (x) { return x.id === id; })[0];
    if (!r) return id || '—';
    return (NC.i18n && NC.i18n.lang() === 'en' && r.name_en) ? r.name_en : r.name;
  }
  function dataStatus() {
    if (!NC.data || typeof NC.data.status !== 'function') return Promise.resolve(null);
    try { return Promise.resolve(NC.data.status()).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }
  function backendMode(st) {
    var m = (st && st.mode) || (NC.data && NC.data.mode);
    return m === 'supabase' || m === 'local' ? m : null;
  }

  var pendingCount = 0;
  function updateNet() {
    var s = netStatus();
    var pill = document.getElementById('net-pill');
    if (pill) {
      pill.classList.toggle('pill--online', s.online);
      pill.classList.toggle('pill--offline', !s.online);
      var label = s.online ? t('app.net.online') : (s.simulated ? t('app.net.offline_sim') : t('app.net.offline'));
      var lab = pill.querySelector('.pill__label');
      if (lab) {
        lab.innerHTML = U.esc(s.online ? t('app.net.online') : t('app.net.offline')) +
          (s.simulated && !s.online ? '<span class="pill__sub"> · ' + U.esc(t('app.net.sim_badge').toLowerCase()) + '</span>' : '');
      }
      var aria = pendingCount > 0 ? t('app.net.aria_pending', { state: label, n: pendingCount }) : t('app.net.aria', { state: label });
      pill.setAttribute('aria-label', aria);
      pill.setAttribute('title', aria);
    }
    var banner = document.getElementById('offline-banner');
    if (banner) {
      banner.hidden = s.online;
      var sub = banner.querySelector('.offline-banner__sub');
      if (sub) sub.textContent = s.simulated ? t('app.banner.sim') : t('app.banner.real');
      var off = banner.querySelector('[data-action="sim-off"]');
      if (off) off.hidden = !s.simulated;
    }
  }

  /** Pending outbox operations → small count inside the net pill (the pill's label announces it). */
  function setSync(count) {
    var n = Math.max(0, parseInt(count, 10) || 0);
    pendingCount = n;
    var b = document.getElementById('sync-badge');
    if (b) {
      b.hidden = n === 0;
      b.textContent = n > 99 ? '99+' : String(n);
    }
    updateNet();
  }

  /** Refresh the outbox count from NC.data (async, guarded). */
  function refreshData() {
    return dataStatus().then(function (st) {
      if (st && st.outboxCount !== undefined) setSync(st.outboxCount);
    });
  }

  function refreshShell() {
    updateNet(); updateLangBtn(); updateTopbar(); updateNavToggle(); updateNavTitles();
    refreshData();
  }

  /* ================================================================== */
  /* NAVIGATION CHROME (C1 / R2)                                          */
  /* ================================================================== */
  var mqDesk = window.matchMedia ? window.matchMedia('(min-width: 1200px)') : null;
  var navState = { collapsed: document.documentElement.classList.contains('nc-nav-collapsed'), tabbarHidden: false, drawerOpen: false };
  var navSig = '';
  var drawerRelease = null;
  var drawerOpener = null;

  function layoutMode() { return isPhone() ? 'phone' : (mqDesk && mqDesk.matches ? 'desktop' : 'tablet'); }
  function navSnapshot() { return { collapsed: navState.collapsed, tabbarHidden: navState.tabbarHidden, drawerOpen: navState.drawerOpen }; }
  /** C1: 'nav:change' on every change of the navigation chrome (collapsed rail, hidden tab bar, drawer). */
  function emitNav() {
    var sig = [navState.collapsed, navState.tabbarHidden, navState.drawerOpen].join('|');
    if (sig === navSig) return;
    navSig = sig;
    if (NC.bus) NC.bus.emit('nav:change', navSnapshot());
  }

  /** Icon + accessible name of the sidebar toggle for the current layout. */
  function updateNavToggle() {
    var btn = document.getElementById('nav-toggle');
    if (!btn) return;
    var mode = layoutMode();
    var ic, label, expanded;
    if (mode === 'tablet') {
      expanded = navState.drawerOpen;
      ic = expanded ? 'x' : 'menu';
      label = t(expanded ? 'app.nav.close' : 'app.nav.open');
    } else {
      expanded = !navState.collapsed;
      ic = expanded ? 'panel-left-close' : 'panel-left-open';
      label = t(expanded ? 'app.nav.collapse' : 'app.nav.expand');
    }
    btn.innerHTML = icon(ic);
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
  /* Icon-only rail states: every item keeps its full name as tooltip / accessible-name fallback. */
  function updateNavTitles() {
    $$('.side-nav__item').forEach(function (a) {
      var lab = a.querySelector('.side-nav__label');
      if (lab && lab.textContent) a.setAttribute('title', lab.textContent);
    });
  }

  /** Desktop: collapse the sidebar to the 88 px rail (remembered per device). */
  function setNavCollapsed(v, persist) {
    var on = !!v;
    navState.collapsed = on;
    document.documentElement.classList.toggle('nc-nav-collapsed', on);
    if (persist !== false && NC.settings && NC.settings.get('nav_collapsed') !== on) NC.settings.set('nav_collapsed', on);
    else if (persist !== false) { try { window.localStorage.setItem('nc.nav_collapsed', on ? '1' : '0'); } catch (e) { /* ignore */ } }
    updateNavToggle();
    revealCurrentNav();
    emitNav();
  }

  /* ---------- tablet drawer ---------- */
  function drawerFocusables() {
    var sb = document.getElementById('sidebar');
    if (!sb) return [];
    return $$('a[href], button:not([disabled])', sb).filter(function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0; });
  }
  function setMainInert(on) {
    var mc = document.getElementById('main-col');
    if (!mc) return;
    if (on) { mc.setAttribute('inert', ''); mc.setAttribute('aria-hidden', 'true'); }
    else { mc.removeAttribute('inert'); mc.removeAttribute('aria-hidden'); }
  }
  function onDrawerKey(e) {
    if (!navState.drawerOpen) return;
    if (NC.ui && NC.ui.openCount && NC.ui.openCount() > 0) return;   // a sheet on top owns the keyboard
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    var f = drawerFocusables();
    if (!f.length) return;
    // The drawer holds only links and buttons: step through them ourselves (wrapping), so the trap also works where
    // the engine leaves links out of the Tab order (WebKit / Safari default) and focus would fall to <body>.
    e.preventDefault();
    var i = f.indexOf(document.activeElement);
    var next = i < 0 ? (e.shiftKey ? f[f.length - 1] : f[0]) : f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length];
    focusInDrawer(next);
  }
  /**
   * Short windows (landscape phones, 1024×600 tablets, collapsed desktop rail): the nav list scrolls on its own
   * between the logo and the 115 button (layout.css), so no item can hide under the button. 'has-more' / 'has-less'
   * fade the clipped edge so a list that continues below (e.g. "Cài đặt") still reads as scrollable.
   */
  function updateNavMore() {
    var nav = document.querySelector('#sidebar .side-nav');
    if (!nav) return;
    var rest = nav.scrollHeight - nav.clientHeight - nav.scrollTop;
    nav.classList.toggle('has-more', rest > 2);
    nav.classList.toggle('has-less', nav.scrollTop > 2);
  }
  /** Focus a drawer control and keep it visible inside the scrolling nav list (never under the 115 button). */
  function focusInDrawer(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    revealNavItem(el);
  }
  /** Scroll a nav item fully into the list, clear of the faded edges (has-less 20 px top, has-more 28 px bottom). */
  function revealNavItem(el) {
    var nav = el && el.closest ? el.closest('.side-nav') : null;
    if (!nav || nav.scrollHeight <= nav.clientHeight) return;
    var r = el.getBoundingClientRect(), n = nav.getBoundingClientRect();
    var top = n.top + 22, bottom = n.bottom - 30;   // the scroll clamps at both ends, where no fade is drawn
    if (r.top < top) nav.scrollTop -= (top - r.top);
    else if (r.bottom > bottom) nav.scrollTop += (r.bottom - bottom);
    updateNavMore();
  }
  /** The current screen's sidebar item, scrolled into the (possibly clipped) nav list. */
  function revealCurrentNav() {
    var cur = document.querySelector('#sidebar .side-nav__item[aria-current="page"]');
    if (cur) revealNavItem(cur);
    else updateNavMore();
  }
  function openDrawer() {
    if (navState.drawerOpen || layoutMode() !== 'tablet') return;
    var app = document.getElementById('app'), scrim = document.getElementById('nav-scrim');
    if (!app) return;
    navState.drawerOpen = true;
    drawerOpener = document.activeElement;
    app.classList.add('is-drawer-open');
    if (scrim) scrim.hidden = false;
    setMainInert(true);
    if (NC.ui) {
      NC.ui.lockScroll();
      // Browser / Android Back closes the drawer; a nav link inside it closes it and keeps the new route.
      drawerRelease = NC.ui.onBack(function () { closeDrawer({ fromHistory: true }); }, { onNavigate: function () { closeDrawer({ fromHistory: true, keepFocus: true }); } });
    }
    document.addEventListener('keydown', onDrawerKey);
    var cur = document.querySelector('#sidebar .side-nav__item[aria-current="page"]') || drawerFocusables()[0];
    focusInDrawer(cur);
    updateNavMore();
    updateNavToggle();
    emitNav();
  }
  /** opts.fromHistory → the Back entry is already gone; opts.keepFocus → a navigation moves focus itself. */
  function closeDrawer(opts) {
    if (!navState.drawerOpen) return;
    var o = opts || {};
    var app = document.getElementById('app'), scrim = document.getElementById('nav-scrim');
    navState.drawerOpen = false;
    if (app) app.classList.remove('is-drawer-open');
    if (scrim) scrim.hidden = true;
    setMainInert(false);
    document.removeEventListener('keydown', onDrawerKey);
    var rel = drawerRelease; drawerRelease = null;
    if (rel && !o.fromHistory) rel();
    if (NC.ui) NC.ui.unlockScroll();
    if (!o.keepFocus) {
      var back = document.getElementById('nav-toggle');
      var target = back && back.offsetParent !== null ? back : drawerOpener;
      if (target && typeof target.focus === 'function' && document.contains(target)) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    drawerOpener = null;
    updateNavMore();
    updateNavToggle();
    emitNav();
  }
  function onNavToggle() {
    var mode = layoutMode();
    if (mode === 'tablet') { if (navState.drawerOpen) closeDrawer(); else openDrawer(); }
    else if (mode === 'desktop') setNavCollapsed(!navState.collapsed);
  }

  /* ---------- phone tab bar: hides on scroll-down, back on scroll-up / near the top / focus / new screen ---------- */
  var scrollY0 = 0, scrollAcc = 0;
  var HIDE_AFTER = 24, SHOW_AFTER = 12, TOP_ZONE = 64;
  function setTabbarHidden(v) {
    var on = !!v && isPhone();
    if (on === navState.tabbarHidden) return;
    navState.tabbarHidden = on;
    document.documentElement.classList.toggle('nc-tabbar-hidden', on);
    emitNav();
  }
  function onScrollNav() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    // An overlay locks the scroll (body fixed → y jumps to 0 and back): ignore those synthetic jumps.
    if (document.documentElement.classList.contains('is-locked')) return;
    var dy = y - scrollY0;
    scrollY0 = y;
    if (!isPhone()) { setTabbarHidden(false); return; }
    var tb = document.getElementById('tabbar');
    var docH = document.documentElement.scrollHeight, winH = window.innerHeight || 0;
    if (y < TOP_ZONE || (tb && tb.contains(document.activeElement)) || y + winH >= docH - 2) { scrollAcc = 0; setTabbarHidden(false); return; }
    if ((dy > 0 && scrollAcc < 0) || (dy < 0 && scrollAcc > 0)) scrollAcc = 0;
    scrollAcc += dy;
    if (scrollAcc > HIDE_AFTER) setTabbarHidden(true);
    else if (scrollAcc < -SHOW_AFTER) setTabbarHidden(false);
  }
  function resetNavForRoute() {
    scrollAcc = 0; scrollY0 = 0;
    setTabbarHidden(false);
  }
  /* A layout change can hide the focused control (no sidebar on phones; drawer-only controls). The browser then
     drops focus to <body>; if the last explicit focus was in the sidebar, move it to the main region instead (as the
     router does). From 1200px the sidebar stays on screen, so focus simply stays where it was. */
  var focusInSidebar = false;
  function trackSidebarFocus(e) {
    var sb = document.getElementById('sidebar');
    focusInSidebar = !!(sb && e.target && sb.contains(e.target));
  }
  function rescueSidebarFocus() {
    if (!focusInSidebar) return;
    if (NC.ui && NC.ui.openCount && NC.ui.openCount() > 0) return;   // an open overlay manages its own focus
    var a = document.activeElement;
    var lost = !a || a === document.body || a === document.documentElement || !a.getClientRects().length;
    if (!lost) return;
    var view = document.getElementById('view');
    if (!view) return;
    if (!view.hasAttribute('tabindex')) view.setAttribute('tabindex', '-1');
    try { view.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function onLayoutChange() {
    if (layoutMode() !== 'tablet') closeDrawer({ keepFocus: true });
    revealCurrentNav();
    if (!isPhone()) setTabbarHidden(false);
    updateNavToggle();
    emitNav();
    rescueSidebarFocus();
    // The browser may only drop the focus of a newly hidden element at its next rendering step → check once more.
    if (window.requestAnimationFrame) window.requestAnimationFrame(function () { setTimeout(rescueSidebarFocus, 0); });
  }

  /* ================================================================== */
  /* CONNECTION SHEET                                                     */
  /* ================================================================== */
  function openConnection() {
    if (!NC.ui) return null;
    var body = h('div', { class: 'app-conn' });
    var unsubs = [];
    var ctrl = NC.ui.sheet({
      title: t('app.conn.title'), size: 'md', body: body, className: 'app-conn-sheet',
      actions: [
        { label: t('common.close'), variant: 'ghost' },
        {
          label: t('app.conn.sync_now'), variant: 'primary', icon: 'refresh', id: 'app-conn-sync',
          onClick: function () {
            if (!NC.data || typeof NC.data.flush !== 'function') { NC.ui.toast(t('app.conn.sync_unavailable'), { type: 'warning' }); return false; }
            if (!netStatus().online) { NC.ui.toast(t('app.conn.sync_offline'), { type: 'warning' }); return false; }
            return Promise.resolve(NC.data.flush()).then(function (r) {
              NC.ui.toast(t('app.conn.synced', { sent: (r && r.sent) || 0, failed: (r && r.failed) || 0 }), { type: (r && r.failed) ? 'warning' : 'success' });
              render();
              return false; // keep the sheet open to show the new state
            });
          }
        }
      ],
      onClose: function () { unsubs.forEach(function (u) { u(); }); }
    });

    function render() {
      var s = netStatus();
      dataStatus().then(function (st) {
        var mode = backendMode(st);
        var outbox = st && st.outboxCount !== undefined ? st.outboxCount : 0;
        var last = st && st.lastSyncAt ? U.relTime(st.lastSyncAt) : t('common.never');
        var dev = st && st.deviceId ? String(st.deviceId).slice(0, 8) + '…' : '—';
        var carrier = carrierName(NC.settings ? NC.settings.get('carrier') : '');
        var stateKey = s.online ? 'online' : 'offline';
        var focusedId = document.activeElement && body.contains(document.activeElement) ? document.activeElement.id : null;
        body.innerHTML =
          '<div class="app-conn__hero app-conn__hero--' + stateKey + '">' +
            '<span class="icon-tile icon-tile--lg icon-tile--' + (s.online ? 'success' : 'warning') + '">' + icon(s.online ? 'wifi' : 'wifi-off') + '</span>' +
            '<div><p class="app-conn__state">' + U.esc(t('app.conn.' + stateKey + '_title')) +
              (s.simulated ? ' <span class="badge badge--warning">' + U.esc(t('app.net.sim_badge')) + '</span>' : '') + '</p>' +
            '<p class="app-conn__desc">' + U.esc(t('app.conn.' + stateKey + '_desc')) + '</p></div>' +
          '</div>' +
          '<div class="app-conn__sim card card--flat">' +
            '<label class="switch switch--end switch--danger"><input type="checkbox" id="app-conn-sim"' + (s.simulated ? ' checked' : '') + '>' +
            '<span class="switch__track"></span><span class="switch__label"><b>' + U.esc(t('app.conn.sim_label')) + '</b>' +
            '<small>' + U.esc(t('app.conn.sim_hint')) + '</small></span></label>' +
          '</div>' +
          '<dl class="kv app-conn__kv">' +
            kvRow(t('app.conn.real'), '<span class="signal-dot signal-dot--' + (s.real ? 'likely' : 'lost') + '"></span> ' + U.esc(s.real ? t('app.conn.real_on') : t('app.conn.real_off'))) +
            kvRow(t('app.conn.backend'), U.esc(mode ? t('app.backend.' + mode + '_long') : t('app.backend.none'))) +
            kvRow(t('app.conn.outbox'), U.esc(t('app.conn.outbox_n', { n: outbox }))) +
            kvRow(t('app.conn.last_sync'), U.esc(last)) +
            kvRow(t('app.status.carrier'), U.esc(carrier)) +
            kvRow(t('app.conn.device'), '<span class="mono">' + U.esc(dev) + '</span>') +
          '</dl>' +
          '<p class="app-conn__privacy">' + icon('lock', 'icon--sm') + '<span>' + U.esc(t('app.conn.privacy')) + '</span></p>';
        var sw = body.querySelector('#app-conn-sim');
        if (sw) sw.addEventListener('change', function () { if (NC.net) NC.net.setSimulated(sw.checked); });
        if (focusedId) { var again = document.getElementById(focusedId); if (again) again.focus(); }
        var syncBtn = document.getElementById('app-conn-sync');
        if (syncBtn && !syncBtn.classList.contains('is-loading')) syncBtn.disabled = !s.online || !NC.data;
      });
    }
    function kvRow(k, vHtml) { return '<div class="kv__row"><dt>' + U.esc(k) + '</dt><dd>' + vHtml + '</dd></div>'; }

    if (NC.bus) ['net:change', 'data:outbox', 'data:sync', 'data:mode', 'settings:change', 'i18n:change'].forEach(function (e) {
      unsubs.push(NC.bus.on(e, render));
    });
    render();
    return ctrl;
  }

  /* ================================================================== */
  /* CARRIER QUICK PICKER                                                 */
  /* ================================================================== */
  function openCarrier() {
    if (!NC.ui) return null;
    var cur = NC.settings ? NC.settings.get('carrier') : 'viettel';
    var list = h('div', { class: 'list list--card app-carrier', role: 'radiogroup', 'aria-label': t('app.carrier.title') });
    var ctrl;
    CARRIERS.forEach(function (c) {
      var on = c.id === cur;
      var item = h('button', {
        type: 'button', class: 'list-item app-carrier__item' + (on ? ' is-selected' : ''),
        role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-carrier': c.id
      });
      item.innerHTML =
        '<span class="list-item__icon icon-tile icon-tile--' + (on ? 'solid' : 'neutral') + '">' + icon('signal') + '</span>' +
        '<span class="list-item__body"><span class="list-item__title">' + U.esc(carrierName(c.id)) + '</span>' +
        (on ? '<span class="list-item__meta">' + U.esc(t('app.carrier.selected')) + '</span>' : '') + '</span>' +
        '<span class="list-item__trail">' + (on ? icon('check-circle', 'text-primary') : icon('circle')) + '</span>';
      item.addEventListener('click', function () {
        if (NC.settings) NC.settings.set('carrier', c.id);
        NC.ui.toast(t('app.carrier.changed', { name: carrierName(c.id) }), { type: 'success', timeout: 2000 });
        ctrl.close();
      });
      list.appendChild(item);
    });
    ctrl = NC.ui.sheet({
      title: t('app.carrier.title'), subtitle: t('app.carrier.sub'), icon: 'signal', size: 'sm', body: list,
      // Close first, then navigate (go() waits for the sheet's history entry to be popped → clean back stack).
      actions: [{ label: t('app.carrier.more'), variant: 'ghost', icon: 'settings', onClick: function (ev, c) { c.close(); go('settings'); } }]
    });
    return ctrl;
  }

  /* ================================================================== */
  /* SERVICE WORKER                                                       */
  /* ================================================================== */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;
    var q = U.qs();
    if (q.nosw === '1') {
      navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
      return;
    }
    var swToastShown = false; // one "new version" toast per page, however many activations/messages arrive
    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e && e.data;
      if (d && d.type === 'nc:sw-updated' && NC.ui && !swToastShown) {
        swToastShown = true;
        NC.ui.toast(t('app.sw.updated'), { type: 'info', timeout: 0, action: { label: t('app.sw.reload'), onClick: function () { window.location.reload(); } } });
      }
    });
    var reg = function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function (err) {
        console.warn('[app] service worker registration failed', err && err.message);
      });
    };
    // Register once the first screen is up and the page is idle, so the precache never competes with first render.
    var idle = function () {
      if (window.requestIdleCallback) window.requestIdleCallback(reg, { timeout: 4000 });
      else setTimeout(reg, 1500);
    };
    if (document.readyState === 'complete') setTimeout(idle, 300);
    else window.addEventListener('load', function () { setTimeout(idle, 300); });
  }

  /* ================================================================== */
  /* SHELL WIRING                                                         */
  /* ================================================================== */
  function onClick(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

  function wireShell() {
    onClick('topbar-back', function () { back(); });
    onClick('lang-toggle', toggleLang);
    onClick('net-pill', function () { openConnection(); });
    onClick('nav-toggle', onNavToggle);
    onClick('nav-scrim', function () { closeDrawer(); });
    var tabbar = document.getElementById('tabbar');
    if (tabbar) tabbar.addEventListener('focusin', function () { setTabbarHidden(false); });
    document.addEventListener('focusin', trackSidebarFocus);
    var sideNav = document.querySelector('#sidebar .side-nav');
    if (sideNav) {
      sideNav.addEventListener('scroll', function () { updateNavMore(); }, { passive: true });
      // Keyboard focus on a rail item that sits under the list's faded edge: scroll it fully into the list.
      sideNav.addEventListener('focusin', function (e) { revealNavItem(e.target); });
    }
    window.addEventListener('resize', U.debounce(revealCurrentNav, 120));
    [mqPhone, mqDesk].forEach(function (mq) {
      if (!mq) return;
      if (mq.addEventListener) mq.addEventListener('change', onLayoutChange);
      else if (mq.addListener) mq.addListener(onLayoutChange);
    });

    // Global delegation
    document.addEventListener('click', function (e) {
      var tEl = e.target;
      if (!tEl || !tEl.closest) return;
      var goEl = tEl.closest('[data-go]');
      if (goEl) {
        e.preventDefault();
        var params = {};
        var raw = goEl.getAttribute('data-params');
        if (raw) params = parseHash('#/x?' + raw).params;
        go(goEl.getAttribute('data-go'), params);
        return;
      }
      var act = tEl.closest('[data-action]');
      if (!act) return;
      var a = act.getAttribute('data-action');
      if (a === 'emergency') {
        e.preventDefault();
        if (NC.emergency && typeof NC.emergency.open === 'function') NC.emergency.open();
        else if (NC.ui) NC.ui.callNumber('115');
      } else if (a === 'back') { e.preventDefault(); back(); }
      else if (a === 'connection') { e.preventDefault(); openConnection(); }
      else if (a === 'carrier') { e.preventDefault(); openCarrier(); }
      else if (a === 'sim-off') { e.preventDefault(); if (NC.net) NC.net.setSimulated(false); }
    });

    window.addEventListener('hashchange', function () {
      // Back pressed to close an overlay (or an overlay released its history entry): the route did not change.
      if (NC.ui && NC.ui.consumeOverlayHashchange && NC.ui.consumeOverlayHashchange()) return;
      handleRoute(false);
    });

    // Skip link: focus the main region instead of navigating to "#view" (which the router would treat as a route).
    var skip = document.querySelector('.skip-link');
    if (skip) skip.addEventListener('click', function (e) {
      var id = (skip.getAttribute('href') || '').replace(/^#/, '');
      var target = id ? document.getElementById(id) : null;
      if (!target) return;
      e.preventDefault();
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: false }); } catch (err) { target.focus(); }
    });

    // Topbar elevation + phone tab bar auto-hide on scroll (one rAF-throttled listener)
    var topbar = document.getElementById('topbar');
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (topbar) topbar.classList.toggle('is-scrolled', (window.pageYOffset || 0) > 4);
        onScrollNav();
      });
    }, { passive: true });

    if (NC.bus) {
      // Offline is signalled by the pill + the slim banner only (no extra toast, no FAB halo, no sidebar row).
      NC.bus.on('net:change', function (s) {
        updateNet();
        lastOnline = s ? s.online : lastOnline;
        refreshData();
      });
      NC.bus.on('data:outbox', function (p) { setSync(p && p.count); });
      NC.bus.on('data:sync', function (p) { if (p && p.outboxCount !== undefined) setSync(p.outboxCount); });
      NC.bus.on('data:mode', function () { refreshData(); });
      NC.bus.on('settings:change', function (p) {
        if (!p) return;
        if (p.key === 'theme') applyTheme(p.value);
        if (p.key === 'nav_collapsed' && !!p.value !== navState.collapsed) setNavCollapsed(!!p.value, false);
      });
      NC.bus.on('route:change', function () { resetNavForRoute(); });
      NC.bus.on('onboarding:done', function () { readyInfo.onboarding = false; });
      NC.bus.on('i18n:change', function () {
        refreshShell();
        if (current) syncHeading(sectionFor(current.name));
        // re-render placeholders in the new language
        $$('.screen__placeholder').forEach(function (ph) {
          var sec = ph.parentNode; var name = sec && sec.getAttribute('data-screen');
          if (sec && name && !registry[name]) { sec.removeChild(ph); renderPlaceholder(sec, name); }
        });
      });
    }
  }

  /** Start the shell (called once by boot.js after settings/data init). */
  function start() {
    if (started) return;
    wireShell();
    if (NC.i18n) NC.i18n.apply(document);
    // Saved desktop rail state (the pre-paint class from theme-init.js already matches in the normal case).
    setNavCollapsed(!!(NC.settings && NC.settings.get('nav_collapsed')), false);
    lastOnline = netStatus().online;
    refreshShell();
    updateNavMore();
    if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') replaceHash('#/home');
    handleRoute(true);
    started = true;
    document.documentElement.classList.add('nc-ready');
    var splash = document.getElementById('boot-splash');
    if (splash) setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 600);
    registerSW();
    // C1: services that show UI at start wait for this (onboarding true → wait for 'onboarding:done').
    // An already-onboarded device opened on #/onboarding is redirected home by onboarding.js and never emits
    // 'onboarding:done' — it must not keep late subscribers waiting for the whole session.
    var onboarded = !!(NC.settings && NC.settings.get('onboarded') === true);
    readyInfo = { ready: true, onboarding: !!(current && current.name === 'onboarding') && !onboarded };
    if (NC.bus) NC.bus.emit('app:ready', { onboarding: readyInfo.onboarding });
  }

  NC.app = {
    register: register, go: go, back: back, current: currentRoute, setTitle: setTitle, start: start,
    applyTheme: applyTheme, theme: resolvedTheme, routes: function () { return ROUTES.slice(); },
    isRegistered: isRegistered, openConnection: openConnection, openCarrier: openCarrier,
    /** {ready, onboarding} — for late subscribers of 'app:ready' (ready:false until start() ran). */
    readyState: function () { return { ready: readyInfo.ready, onboarding: readyInfo.onboarding }; },
    nav: navSnapshot, setNavCollapsed: function (v) { setNavCollapsed(v); },
    openDrawer: openDrawer, closeDrawer: function () { closeDrawer(); },
    carriers: function () { return CARRIERS.map(function (c) { return { id: c.id, name: carrierName(c.id) }; }); },
    carrierName: carrierName, routeName: routeName
  };
})(window.NC = window.NC || {});
