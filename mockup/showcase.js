/*
 * showcase.js — NomadCare mockup showcase page (index.html): device galleries built from real screenshots
 * (NC_MOCKUP in data.js), MOD.01 flow, module legend, PNG downloads, lightbox, VI/EN captions and a "live" mode that swaps
 * screenshots for scaled iframes of the running app (http only; actions from shots.json are replayed best-effort). ES2017.
 */
(function (MK) {
  'use strict';
  var el = MK.el, D = MK.data, $ = function (s, r) { return (r || document).querySelector(s); };
  var HTTP = /^https?:$/.test(location.protocol);

  var S = {
    vi: {
      skip: 'Bỏ qua điều hướng', live: 'Xem trực tiếp', liveOff: 'Cần mở trang qua http:// (từ thư mục gốc dự án) để xem trực tiếp',
      nav: { mobile: 'Di động', tablet: 'Máy tính bảng', web: 'Web & Admin', flow: 'Luồng MOD.01', modules: 'Module', downloads: 'Tải về' },
      kicker: 'AISC 2026 · Vòng 2 · Team Stormbreakers', h1: 'Bản phác thảo giao diện sản phẩm demo',
      sub: 'NomadCare — chiếc phao sinh tồn kỹ thuật số cho phượt thủ tại Việt Nam. Mọi màn hình dưới đây là ảnh chụp thật của bản demo đang chạy (PWA offline-first) trên điện thoại, máy tính bảng, web và dashboard quản trị.',
      ctaFlow: 'Xem luồng MOD.01', ctaDl: 'Tải board PNG',
      stats: [['5', 'module an toàn'], ['100%', 'luồng khẩn cấp chạy offline'], ['< 15 giây', 'tới câu y tế song ngữ'], ['3', 'tuyến thí điểm']],
      mobileT: 'Giao diện di động', mobileL: 'iPhone 390 × 844. Nhấn vào một màn hình để phóng to. Lọc theo module để đối chiếu với thuyết minh.',
      all: 'Tất cả', other: 'Khác', darkSub: 'Chế độ tối',
      tabletT: 'Máy tính bảng', tabletL: 'iPad 834 × 1194 — bố cục 2 cột, thanh điều hướng dạng rail, bản đồ kèm bảng lộ trình.',
      webT: 'Web & Dashboard quản trị', webL: 'Cùng mã nguồn PWA trên máy tính 1440 × 900, và dashboard quản trị dữ liệu (Supabase: PostgreSQL + PostGIS).',
      appSub: 'Ứng dụng web (PWA)', adminSub: 'Dashboard quản trị',
      flowT: 'Luồng MOD.01 dưới 15 giây', flowL: 'Năm bước, chỉ chạm: không gõ chữ, không cần mạng. Vòng cam đánh dấu chỗ người dùng chạm ở mỗi bước.',
      step: 'Bước', done: 'Xong', sec: 'giây', target: 'Mục tiêu < 15 giây',
      pills: ['≤ 5 chạm', 'Không cần mạng', 'VI + 6 ngôn ngữ'],
      modT: '5 module chức năng', modL: 'Đúng đánh số trong thuyết minh (Bảng 4).', seeScreens: 'Xem màn hình →',
      dlT: 'Tải bộ board PNG', dlL: 'Ảnh độ phân giải cao cho slide và poster. Tạo lại bằng: node build-mockup.js all',
      liveNote: 'Chế độ trực tiếp nhúng app thật vào từng khung. Trạng thái chỉ gần đúng: các bước chụp được phát lại tối giản, dữ liệu demo dùng chung giữa các khung, luồng ?reset=1 và ?offline=1 được bỏ qua.',
      ph: 'Ảnh tạm', open: 'Mở PNG gốc', openApp: 'Mở trong app', close: 'Đóng', prev: 'Trước', next: 'Tiếp',
      foot1: 'Dữ liệu trong ảnh là dữ liệu minh hoạ, không phải thông tin y tế thật.', foot2: 'Sinh bởi build-mockup.js'
    },
    en: {
      skip: 'Skip navigation', live: 'Live view', liveOff: 'Open this page over http:// (from the project root) to use live view',
      nav: { mobile: 'Mobile', tablet: 'Tablet', web: 'Web & Admin', flow: 'MOD.01 flow', modules: 'Modules', downloads: 'Downloads' },
      kicker: 'AISC 2026 · Round 2 · Team Stormbreakers', h1: 'Demo product interface mockup',
      sub: 'NomadCare — your digital survival lifeline for backpackers in Vietnam. Every screen below is a real screenshot of the running demo (offline-first PWA) on phone, tablet, web and the admin dashboard.',
      ctaFlow: 'See the MOD.01 flow', ctaDl: 'Download PNG boards',
      stats: [['5', 'safety modules'], ['100%', 'emergency flows offline'], ['< 15 s', 'to a bilingual phrase'], ['3', 'pilot routes']],
      mobileT: 'Mobile interface', mobileL: 'iPhone 390 × 844. Click a screen to enlarge. Filter by module to match the proposal.',
      all: 'All', other: 'Other', darkSub: 'Dark mode',
      tabletT: 'Tablet', tabletL: 'iPad 834 × 1194 — two-column layout, navigation rail, map with route panel.',
      webT: 'Web & admin dashboard', webL: 'The same PWA codebase on a 1440 × 900 desktop, plus the data admin dashboard (Supabase: PostgreSQL + PostGIS).',
      appSub: 'Web app (PWA)', adminSub: 'Admin dashboard',
      flowT: 'MOD.01 flow in under 15 seconds', flowL: 'Five steps, taps only: no typing, no network. Orange rings mark where the user taps at each step.',
      step: 'Step', done: 'Done', sec: 's', target: 'Target < 15 s',
      pills: ['≤ 5 taps', 'Works offline', 'VI + 6 languages'],
      modT: 'The 5 modules', modL: 'Numbered exactly as in the proposal (Table 4).', seeScreens: 'See screens →',
      dlT: 'Download the PNG boards', dlL: 'High-resolution images for slides and the poster. Regenerate with: node build-mockup.js all',
      liveNote: 'Live view embeds the real app in every frame. States are approximate: capture steps are replayed minimally, demo data is shared between frames, ?reset=1 and ?offline=1 flows are skipped.',
      ph: 'Placeholder', open: 'Open original PNG', openApp: 'Open in app', close: 'Close', prev: 'Previous', next: 'Next',
      foot1: 'Data shown is illustrative sample data, not real medical information.', foot2: 'Generated by build-mockup.js'
    }
  };
  var state = { lang: 'vi', live: false, filter: 'all' };
  try { var sl = localStorage.getItem('nc.mockup.lang'); if (sl === 'en' || sl === 'vi') state.lang = sl; } catch (e) { /* storage blocked */ }
  var qm = location.search.match(/[?&]lang=(vi|en)/);
  if (qm) state.lang = qm[1];
  function T() { return S[state.lang]; }

  var shots = (D.shots || []);
  function byDevice(d, dark) { return shots.filter(function (s) { return s.device === d && (dark == null || (s.theme === 'dark') === dark); }); }
  function isAdmin(s) { return s.module === 'Admin'; }

  /* ---------- live iframes ---------- */
  function liveUrl(shot, override) {
    var u = override || shot.live || shot.url || '/index.html';
    var hi = u.indexOf('#'), hash = hi >= 0 ? u.slice(hi) : '', base = hi >= 0 ? u.slice(0, hi) : u;
    var qi = base.indexOf('?'), p = qi >= 0 ? base.slice(0, qi) : base;
    var params = new URLSearchParams(qi >= 0 ? base.slice(qi + 1) : '');
    params.delete('reset'); params.delete('offline');
    if (!params.has('theme')) params.set('theme', shot.theme || 'light');
    if (!params.has('lang')) params.set('lang', shot.lang || 'vi');
    return '..' + (p.charAt(0) === '/' ? p : '/' + p) + '?' + params.toString() + hash;
  }
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); startLive(en.target); } });
  }, { rootMargin: '300px 0px' }) : null;
  var ro = ('ResizeObserver' in window) ? new ResizeObserver(function (entries) { entries.forEach(function (en) { fitLive(en.target); }); }) : null;
  window.addEventListener('resize', function () { Array.prototype.forEach.call(document.querySelectorAll('.dv-screen.has-live'), fitLive); });
  function fitLive(scr) {
    var fr = scr.querySelector('.dv-live');
    if (!fr) return;
    var s = scr.clientWidth / (+fr.getAttribute('data-w') || 390);
    fr.style.transform = 'scale(' + s + ')';
    var top = +fr.getAttribute('data-top') || 0;
    if (top) fr.style.top = (top * s) + 'px';
  }
  MK.liveFactory = function (shot, dev, scr) {
    if (!state.live || !HTTP) return null;
    var kind = shot.device;
    var top = kind === 'phone' ? 47 : (kind === 'tablet' ? 24 : 0);
    var h = dev.height - top;
    var fr = el('iframe', { class: 'dv-live', title: MK.t(shot.caption), loading: 'lazy', 'data-w': dev.width, 'data-top': top, width: dev.width, height: h, tabindex: '-1' });
    fr.style.width = dev.width + 'px';
    fr.style.height = h + 'px';
    fr.__shot = shot;
    scr.classList.add('has-live');
    scr.style.background = shot.theme === 'dark' ? '#0D1515' : '#FFFFFF';
    if (ro) ro.observe(scr);
    setTimeout(function () { fitLive(scr); }, 0);
    if (io) io.observe(fr); else startLive(fr);
    return fr;
  };
  function startLive(fr) {
    var shot = fr.__shot;
    var onload = function () {
      fr.removeEventListener('load', onload);
      replay(fr, shot).catch(function () { /* best effort */ });
    };
    fr.addEventListener('load', onload);
    fr.src = liveUrl(shot);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function helper(win) {
    if (win.__mk) return win.__mk;
    var doc = win.document;
    var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); };
    var vis = function (e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]'); };
    function find(q) {
      if (typeof q === 'string') q = { text: q };
      var roots = q.within ? Array.prototype.slice.call(doc.querySelectorAll(q.within)).filter(vis) : [doc.body];
      for (var i = 0; i < roots.length; i++) {
        var root = roots[i];
        if (q.sel) { var m = Array.prototype.slice.call(root.querySelectorAll(q.sel)).filter(vis); if (m.length) return m[0]; }
        if (!q.text) continue;
        var alts = String(q.text).split('|').map(norm);
        for (var a = 0; a < alts.length; a++) {
          var c = Array.prototype.slice.call(root.querySelectorAll(q.selector || 'button,a,[role=button],[role=tab],[role=radio],label,.chip,.card,li,[data-action],[tabindex]'))
            .filter(function (e) { return vis(e) && norm(e.textContent).indexOf(alts[a]) >= 0; })
            .sort(function (x, y) { return norm(x.textContent).length - norm(y.textContent).length; });
          if (c.length) return c[0];
        }
      }
      return null;
    }
    win.__mk = {
      find: find, norm: norm, visible: vis, sleep: sleep,
      click: function (q) { var e = find(q); if (!e) throw new Error('not found'); e.click(); return true; },
      go: function (n, p) {
        if (win.NC && win.NC.app && win.NC.app.go) { win.NC.app.go(n, p || undefined); return n; }
        var hh = '#/' + n; if (p) hh += '?' + new URLSearchParams(p).toString(); win.location.hash = hh; return hh;
      },
      waitFor: function (fn, ms) {
        var t0 = Date.now();
        return new Promise(function (res, rej) {
          (function tick() {
            var v = null;
            try { v = typeof fn === 'function' ? fn() : (typeof fn === 'string' ? doc.querySelector(fn) : find(fn)); } catch (e) { v = null; }
            if (v) res(v); else if (Date.now() - t0 > (ms || 6000)) rej(new Error('timeout')); else setTimeout(tick, 150);
          })();
        });
      },
      ready: function () { return Promise.resolve(true); }, settle: function () { return Promise.resolve(true); },
      scrollTo: function (q) { var e = find(q); if (e) e.scrollIntoView({ block: 'start' }); return !!e; },
      scroll: function () { return 0; }
    };
    return win.__mk;
  }
  function replay(fr, shot) {
    var acts = shot.actions || [];
    var win = fr.contentWindow;
    if (!win) return Promise.resolve();
    var waitApp = function () { return helper(fr.contentWindow).waitFor(function () { return fr.contentWindow.NC && fr.contentWindow.NC.app; }, 5000).catch(function () {}); };
    var chain = waitApp().then(function () { return sleep(700); });
    acts.forEach(function (a) {
      chain = chain.then(function () {
        var w = fr.contentWindow, mk = helper(w);
        if (a.goto) {
          if (/reset=1/.test(a.goto)) return null;
          return new Promise(function (res) { fr.addEventListener('load', function h() { fr.removeEventListener('load', h); res(); }); fr.src = liveUrl(shot, a.goto); }).then(waitApp);
        }
        if (a.hash) { w.location.hash = a.hash; return sleep(600); }
        if (a.go) { mk.go(a.go, a.params); return sleep(700); }
        if (a.click) { var e = w.document.querySelector(a.click); if (e) e.click(); return sleep(500); }
        if (a.clickText) { try { mk.click({ text: a.clickText, sel: a.sel, within: a.within, selector: a.selector }); } catch (err) { /* optional */ } return sleep(500); }
        if (a.scrollTo) { mk.scrollTo(typeof a.scrollTo === 'object' ? a.scrollTo : { text: a.scrollTo, within: a.within }); return sleep(300); }
        if (a.eval) { try { return Promise.resolve(new w.Function('return (async function(){ return (' + a.eval + '); })()')()).catch(function () {}).then(function () { return sleep(400); }); } catch (err) { return null; } }
        if (a.wait) return sleep(Math.min(a.wait, 2500));
        if (a.waitFor) return mk.waitFor(a.waitFor, a.timeout || 5000).catch(function () {});
        if (a.css) { var st = w.document.createElement('style'); st.textContent = a.css; w.document.head.appendChild(st); }
        return null;
      }).catch(function () { /* keep going */ });
    });
    return chain;
  }

  /* ---------- building blocks ---------- */
  function item(shot, kind, opts) {
    opts = opts || {};
    if (state.live && HTTP && shot.offline) shot = Object.assign({}, shot, { offline: false });
    var fig = el('figure', { class: 'sc-item', 'data-mod': shot.module || '', 'data-id': shot.id });
    var frame = MK.frame(shot, { kind: kind, thumb: true, lazy: !window.__mkNoLazy, live: state.live && HTTP, taps: !!opts.taps });
    if (state.live && HTTP) fig.appendChild(el('div', { class: 'sc-open' }, [frame]));
    else fig.appendChild(el('button', { class: 'sc-open', type: 'button', 'data-open': shot.id, 'aria-label': MK.t(shot.caption) }, [frame]));
    if (opts.caption !== false) fig.appendChild(MK.caption(shot));
    return fig;
  }
  function head(eyebrowIcon, eyebrow, title, lead, extra) {
    var h = el('div', { class: 'sc-sec__head' });
    var l = el('div');
    l.appendChild(el('span', { class: 'sc-eyebrow', html: MK.icon(eyebrowIcon) + MK.esc(eyebrow) }));
    l.appendChild(el('h2', { text: title }));
    if (lead) l.appendChild(el('p', { class: 'sc-sec__lead', text: lead }));
    h.appendChild(l);
    if (extra) h.appendChild(extra);
    return h;
  }
  function liveNote() { return el('p', { class: 'sc-live-note', text: T().liveNote }); }

  /* ---------- sections ---------- */
  function renderNav() {
    var b = $('#nav-brand');
    b.innerHTML = '';
    b.appendChild(MK.brand({ tagline: false }));
    b.appendChild(el('em', { text: 'Mockup' }));
    var links = $('#nav-links');
    links.innerHTML = '';
    ['mobile', 'tablet', 'web', 'flow', 'modules', 'downloads'].forEach(function (k) { links.appendChild(el('a', { href: '#' + k, text: T().nav[k] })); });
    $('[data-t="live"]').textContent = T().live;
    $('[data-t="skip"]').textContent = T().skip;
    var lb = $('#btn-live');
    lb.setAttribute('aria-pressed', state.live ? 'true' : 'false');
    if (!HTTP) { lb.disabled = true; lb.title = T().liveOff; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-lang') === state.lang ? 'true' : 'false'); });
    document.documentElement.lang = state.lang;
  }
  function renderHero() {
    var sec = $('#hero');
    sec.innerHTML = '';
    sec.appendChild(MK.topo(1600, 900, { seed: 3, opacity: 0.08 }));
    var w = el('div', { class: 'sc-wrap sc-hero__in' });
    var txt = el('div');
    txt.appendChild(el('span', { class: 'sc-kicker', html: '<i></i>' + MK.esc(T().kicker) }));
    txt.appendChild(el('h1', { text: T().h1 }));
    txt.appendChild(el('p', { class: 'sc-hero__sub', text: T().sub }));
    var cta = el('div', { class: 'sc-cta' });
    cta.appendChild(el('a', { class: 'sc-btn sc-btn--light', href: '#flow', html: MK.icon('route') + MK.esc(T().ctaFlow) }));
    cta.appendChild(el('a', { class: 'sc-btn sc-btn--ghost', href: '#downloads', html: MK.icon('download') + MK.esc(T().ctaDl) }));
    txt.appendChild(cta);
    var st = el('div', { class: 'sc-stats' });
    T().stats.forEach(function (s) { st.appendChild(el('div', { class: 'sc-stat' }, [el('b', { text: s[0] }), el('span', { text: s[1] })])); });
    txt.appendChild(st);
    w.appendChild(txt);
    var art = el('div', { class: 'sc-hero__art', 'aria-hidden': 'true' });
    var h0 = MK.shotOrStub('d-home', 'desktop'), h1 = MK.shotOrStub('p-tr-result', 'phone'), h2 = MK.shotOrStub('p-home', 'phone');
    art.appendChild(MK.laptop(h0, { thumb: true }));
    art.appendChild(MK.phone(h1, { thumb: true }));
    art.appendChild(MK.phone(h2, { thumb: true }));
    w.appendChild(art);
    sec.appendChild(w);
  }
  function renderMobile() {
    var sec = $('#mobile');
    sec.innerHTML = '';
    var w = el('div', { class: 'sc-wrap' });
    var chips = el('div', { class: 'sc-filters', role: 'group', 'aria-label': 'Filter' });
    var mods = [['all', T().all, '#0F1F1E'], ['MOD.01'], ['MOD.02'], ['MOD.03'], ['MOD.04'], ['MOD.05'], ['other', T().other, '#4B5F6D']];
    mods.forEach(function (m) {
      var c = m[2] || MK.modInfo(m[0]).c;
      var b = el('button', { class: 'sc-chip', type: 'button', 'data-filter': m[0], 'aria-pressed': state.filter === m[0] ? 'true' : 'false', style: { '--c': c } }, [el('i'), m[1] || m[0]]);
      chips.appendChild(b);
    });
    w.appendChild(head('phone', T().nav.mobile, T().mobileT, T().mobileL, chips));
    w.appendChild(liveNote());
    var g = el('div', { class: 'sc-grid sc-grid--phone', id: 'grid-phone' });
    byDevice('phone', false).forEach(function (s) { g.appendChild(item(s, 'phone')); });
    w.appendChild(g);
    var dark = byDevice('phone', true);
    if (dark.length) {
      w.appendChild(el('div', { class: 'sc-sub', text: T().darkSub }));
      var g2 = el('div', { class: 'sc-grid sc-grid--phone', id: 'grid-phone-dark' });
      dark.forEach(function (s) { g2.appendChild(item(s, 'phone')); });
      w.appendChild(g2);
    }
    sec.appendChild(w);
    applyFilter();
  }
  function applyFilter() {
    Array.prototype.forEach.call(document.querySelectorAll('#mobile .sc-item'), function (it) {
      var m = it.getAttribute('data-mod');
      var show = state.filter === 'all' || m === state.filter || (state.filter === 'other' && !/^MOD\.0/.test(m));
      it.hidden = !show;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filter') === state.filter ? 'true' : 'false'); });
  }
  function renderTablet() {
    var sec = $('#tablet');
    sec.innerHTML = '';
    var w = el('div', { class: 'sc-wrap' });
    w.appendChild(head('tablet', T().nav.tablet, T().tabletT, T().tabletL));
    w.appendChild(liveNote());
    var g = el('div', { class: 'sc-grid sc-grid--tablet' });
    byDevice('tablet').forEach(function (s) { g.appendChild(item(s, 'tablet')); });
    w.appendChild(g);
    sec.appendChild(w);
  }
  function renderWeb() {
    var sec = $('#web');
    sec.innerHTML = '';
    var w = el('div', { class: 'sc-wrap' });
    w.appendChild(head('monitor', T().nav.web, T().webT, T().webL));
    w.appendChild(liveNote());
    var desk = byDevice('desktop');
    var app = desk.filter(function (s) { return !isAdmin(s); }), adm = desk.filter(isAdmin);
    if (app.length) {
      w.appendChild(el('div', { class: 'sc-sub', text: T().appSub }));
      var hero = el('div', { class: 'sc-web-hero' });
      hero.appendChild(item(app[0], 'laptop'));
      w.appendChild(hero);
      var g = el('div', { class: 'sc-grid sc-grid--browser' });
      app.slice(1).forEach(function (s) { g.appendChild(item(s, 'browser')); });
      w.appendChild(g);
    }
    if (adm.length) {
      w.appendChild(el('div', { class: 'sc-sub', text: T().adminSub }));
      var g2 = el('div', { class: 'sc-grid sc-grid--browser' });
      adm.forEach(function (s) { g2.appendChild(item(s, 'browser')); });
      w.appendChild(g2);
    }
    sec.appendChild(w);
  }
  function renderFlow() {
    var sec = $('#flow');
    sec.innerHTML = '';
    var b = (D.boards || {})['flow-mod01'] || { shots: [], steps: [] };
    var w = el('div', { class: 'sc-wrap' });
    w.appendChild(head('timer', 'MOD.01', T().flowT, T().flowL));
    w.appendChild(liveNote());
    var grid = el('div', { class: 'sc-flow' });
    var total = 0;
    (b.steps || []).forEach(function (s) { total += s.sec || 0; });
    (b.shots || []).forEach(function (id, i) {
      var s = MK.shotOrStub(id, 'phone'), st = (b.steps || [])[i] || {};
      var col = el('div', { class: 'sc-flow__step' });
      col.appendChild(el('span', { class: 'sc-flow__no', html: MK.esc(T().step) + '<b>' + (i + 1) + '</b>' }));
      col.appendChild(el('div', { class: 'sc-flow__t', text: MK.t(st.title) }));
      col.appendChild(el('div', { class: 'sc-flow__s', text: MK.t(st.sub) }));
      var it = item(s, 'phone', { caption: false, taps: true });
      col.appendChild(it);
      var last = i === b.shots.length - 1;
      col.appendChild(el('span', { class: 'sc-flow__time' + (last ? ' is-final' : ''), html: MK.icon(last ? 'check' : 'timer') + MK.esc(last ? T().done + ' ≈ ' + total + ' ' + T().sec : '≈ ' + (st.sec || 0) + ' ' + T().sec) }));
      grid.appendChild(col);
    });
    w.appendChild(grid);
    var bar = el('div', { class: 'sc-bar', role: 'img', 'aria-label': (T().target) });
    var shades = ['#08665C', '#0B7A6E', '#0E8C82', '#12A08F'];
    (b.steps || []).forEach(function (s, i) {
      if (!s.sec) return;
      var seg = el('span', { text: T().step + ' ' + (i + 1) + ' · ' + s.sec + (state.lang === 'en' ? ' s' : 's') });
      seg.style.width = (s.sec / 15 * 100) + '%';
      seg.style.background = shades[i % 4];
      bar.appendChild(seg);
    });
    bar.appendChild(el('span', { class: 'sc-bar__target', html: '<em>' + MK.esc(T().target) + '</em>' }));
    w.appendChild(bar);
    var goal = el('div', { class: 'sc-flow__goal' });
    goal.appendChild(el('b', { text: MK.t(b.target) }));
    var pills = el('div', { class: 'sc-pills' });
    ['hand', 'wifiOff', 'globe'].forEach(function (ic, i) { pills.appendChild(el('span', { class: 'sc-pill', html: MK.icon(ic) + MK.esc(T().pills[i]) })); });
    goal.appendChild(pills);
    w.appendChild(goal);
    if (b.note) w.appendChild(el('p', { class: 'sc-note', text: MK.t(b.note) }));
    sec.appendChild(w);
  }
  function renderModules() {
    var sec = $('#modules');
    sec.innerHTML = '';
    var w = el('div', { class: 'sc-wrap' });
    w.appendChild(head('layers', T().nav.modules, T().modT, T().modL));
    var g = el('div', { class: 'sc-mods' });
    Object.keys(D.modules || {}).forEach(function (k) {
      var m = D.modules[k], info = MK.modInfo(k);
      var c = el('article', { class: 'sc-mod', style: { '--tag-c': info.c } });
      c.appendChild(el('span', { class: 'sc-mod__icon', html: MK.icon(info.icon) }));
      c.appendChild(el('h3', { html: '<em>' + MK.esc(k) + '</em>' + MK.esc(MK.t(m.name)) }));
      c.appendChild(el('p', { text: MK.t(m.desc) }));
      c.appendChild(el('a', { href: '#mobile', 'data-filter-link': k, text: T().seeScreens }));
      g.appendChild(c);
    });
    w.appendChild(g);
    sec.appendChild(w);
  }
  function renderDownloads() {
    var sec = $('#downloads');
    sec.innerHTML = '';
    var w = el('div', { class: 'sc-wrap' });
    w.appendChild(head('download', T().nav.downloads, T().dlT, T().dlL));
    var g = el('div', { class: 'sc-dl' });
    Object.keys(D.boards || {}).forEach(function (k) {
      var b = D.boards[k];
      var a = el('a', { class: 'sc-dl__card', href: 'export/' + b.file, download: b.file });
      var th = el('div', { class: 'sc-dl__thumb' });
      var img = el('img', { src: 'export/thumb/' + b.file.replace(/\.png$/, '.webp'), alt: '', loading: 'lazy' });
      img.addEventListener('error', function () { if (img.getAttribute('data-fb')) { img.remove(); return; } img.setAttribute('data-fb', '1'); img.src = 'export/' + b.file; });
      th.appendChild(img);
      a.appendChild(th);
      var body = el('div', { class: 'sc-dl__body' });
      body.appendChild(el('div', {}, [el('b', { text: MK.t(b.name || b.title) }), el('span', { text: b.file + ' · ' + b.width + ' × ' + b.height + ' px' })]));
      body.appendChild(MK.iconEl('download'));
      a.appendChild(body);
      g.appendChild(a);
    });
    w.appendChild(g);
    sec.appendChild(w);
  }
  function renderFoot() {
    var f = $('#foot');
    f.innerHTML = '';
    var w = el('div', { class: 'sc-wrap' });
    w.appendChild(el('div', { html: '<b>NomadCare</b> · Team Stormbreakers · AISC 2026 · Digital Business Ideas<br>' + MK.esc(T().foot1) }));
    w.appendChild(el('div', { text: T().foot2 + (D.generated_at ? ' · ' + D.generated_at.slice(0, 16).replace('T', ' ') : '') }));
    f.appendChild(w);
  }
  function renderAll() {
    MK.lang = state.lang;
    MK.pending = [];
    document.body.classList.toggle('sc-live-on', state.live && HTTP);
    renderNav(); renderHero(); renderMobile(); renderTablet(); renderWeb(); renderFlow(); renderModules(); renderDownloads(); renderFoot();
    var lbx = $('#lightbox');
    $('.sc-lb__close', lbx).innerHTML = MK.icon('x'); $('.sc-lb__close', lbx).setAttribute('aria-label', T().close);
    $('.sc-lb__prev', lbx).innerHTML = MK.icon('chevLeft'); $('.sc-lb__prev', lbx).setAttribute('aria-label', T().prev);
    $('.sc-lb__next', lbx).innerHTML = MK.icon('chevRight'); $('.sc-lb__next', lbx).setAttribute('aria-label', T().next);
  }

  /* ---------- lightbox ---------- */
  var lb = { order: [], idx: -1, lastFocus: null };
  function visibleOrder() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-open]')).filter(function (b) { return !b.closest('[hidden]'); }).map(function (b) { return b.getAttribute('data-open'); })
      .filter(function (id, i, arr) { return arr.indexOf(id) === i; });
  }
  function openLb(id) {
    lb.order = visibleOrder();
    lb.idx = Math.max(0, lb.order.indexOf(id));
    lb.lastFocus = document.activeElement;
    showLb();
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    $('.sc-lb__close').focus();
  }
  function showLb() {
    var s = MK.shot(lb.order[lb.idx]);
    if (!s) return;
    var media = $('#lb-media');
    media.innerHTML = '';
    media.className = 'sc-lb__media' + (s.device === 'phone' ? ' is-phone' : '');
    if (s.exists) media.appendChild(el('img', { src: MK.src(s, false), alt: MK.t(s.caption) }));
    else media.appendChild(MK.frame(s, { w: 300 }));
    var tag = $('#lb-tag');
    tag.innerHTML = '';
    if (s.module) tag.appendChild(MK.tag(s.module));
    $('#lb-title').textContent = MK.t(s.caption);
    var mod = (D.modules || {})[s.module];
    $('#lb-desc').textContent = mod ? MK.t(mod.name) + ' — ' + MK.t(mod.desc) : '';
    var dev = MK.dev(s.device);
    $('#lb-meta').textContent = (dev.label || s.device) + ' · ' + s.url + (s.placeholder ? ' · ' + T().ph : '') + ' · ' + (lb.idx + 1) + '/' + lb.order.length;
    var act = $('#lb-actions');
    act.innerHTML = '';
    if (s.exists) act.appendChild(el('a', { href: MK.src(s, false), target: '_blank', rel: 'noopener', html: MK.icon('expand') + MK.esc(T().open) }));
    if (HTTP) act.appendChild(el('a', { href: liveUrl(s), target: '_blank', rel: 'noopener', html: MK.icon('eye') + MK.esc(T().openApp) }));
  }
  function closeLb() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
    if (lb.lastFocus && lb.lastFocus.focus) lb.lastFocus.focus();
  }
  function stepLb(d) { if (!lb.order.length) return; lb.idx = (lb.idx + d + lb.order.length) % lb.order.length; showLb(); }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var op = t.closest && t.closest('[data-open]');
    if (op) { e.preventDefault(); openLb(op.getAttribute('data-open')); return; }
    var lbBtn = t.closest && t.closest('[data-lb]');
    if (lbBtn) { var a = lbBtn.getAttribute('data-lb'); if (a === 'close') closeLb(); else stepLb(a === 'next' ? 1 : -1); return; }
    var f = t.closest && t.closest('[data-filter]');
    if (f) { state.filter = f.getAttribute('data-filter'); applyFilter(); return; }
    var fl = t.closest && t.closest('[data-filter-link]');
    if (fl) { state.filter = fl.getAttribute('data-filter-link'); applyFilter(); return; }
    var lg = t.closest && t.closest('[data-lang]');
    if (lg) {
      state.lang = lg.getAttribute('data-lang');
      try { localStorage.setItem('nc.mockup.lang', state.lang); } catch (err) { /* ignore */ }
      renderAll();
      return;
    }
    if (t.closest && t.closest('#btn-live')) {
      if (!HTTP) return;
      state.live = !state.live;
      renderAll();
    }
  });
  document.addEventListener('keydown', function (e) {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowRight') stepLb(1);
    else if (e.key === 'ArrowLeft') stepLb(-1);
    else if (e.key === 'Tab') {
      var f = Array.prototype.slice.call(document.querySelectorAll('#lightbox button, #lightbox a'));
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  renderAll();
})(window.MK);
