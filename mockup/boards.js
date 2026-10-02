/*
 * boards.js — NomadCare mockup kit: fixed-size artboards rendered to PNG by `node build-mockup.js boards`.
 * boards.html?board=<name>#<name> (or just #<name>) renders one board from NC_MOCKUP.boards (shots.json → data.js).
 * Layouts: banner (row of phones, ref style 1/2), tablet, desktop (laptop + browsers), flow (MOD.01 5 steps), overview.
 * Sets window.__boardReady = true when every image is decoded; window.__boardInfo = {missing, placeholders}. ES2017.
 */
(function (MK) {
  'use strict';
  var el = MK.el;
  var D = MK.data;
  var qs = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (p) { if (!p) return; var kv = p.split('='); qs[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
  MK.lang = qs.lang === 'en' ? 'en' : 'vi';
  document.documentElement.lang = MK.lang;

  function abs(node, x, y, w, h) {
    node.style.position = 'absolute';
    node.style.left = Math.round(x) + 'px';
    node.style.top = Math.round(y) + 'px';
    if (w != null) node.style.width = Math.round(w) + 'px';
    if (h != null) node.style.height = Math.round(h) + 'px';
    return node;
  }
  function shots(b, device) { return (b.shots || []).map(function (id) { return MK.shotOrStub(id, device); }); }
  function css(node, props) { Object.keys(props).forEach(function (k) { node.style.setProperty(k, props[k]); }); return node; }

  /* ---------- background & headers ---------- */
  function decorate(root, b) {
    var W = b.width, H = b.height;
    if (b.variant === 'light') {
      root.appendChild(MK.topo(W, H, { seed: 11, opacity: 0.07, centers: [[0.06, 0.1, 0.55], [0.95, 0.95, 0.6], [0.62, -0.05, 0.3]] }));
    } else {
      root.appendChild(MK.topo(W, H, { seed: b.variant === 'dark' ? 5 : 3, opacity: b.variant === 'dark' ? 0.055 : 0.075 }));
      if (b.layout !== 'overview' && b.decorRoute !== false) {
        var k = 1250 / H;
        root.appendChild(MK.routeDecor(W, H, { width: Math.max(8, Math.round(H / 140)), opacity: b.variant === 'dark' ? 0.5 : 0.6, pin: true,
          points: [[-0.03, 0.2 * k], [0.08, 0.155 * k], [0.17, 0.1 * k], [0.26, 0.14 * k], [0.35, 0.08 * k], [0.43, 0.105 * k]] }));
      }
    }
  }
  function headDark(root, b) {
    root.style.setProperty('--hs', Math.max(1, Math.min(1.22, b.height / 1250)).toFixed(3));
    var hang = el('div', { class: 'bd-hang' });
    hang.appendChild(MK.brand());
    root.appendChild(hang);
    var t = el('div', { class: 'bd-title' });
    t.appendChild(el('h1', { text: MK.t(b.title) }));
    if (b.subtitle) t.appendChild(el('p', { text: MK.t(b.subtitle) }));
    root.appendChild(t);
    return { hang: hang, title: t };
  }
  function headLight(root, b, opts) {
    opts = opts || {};
    var head = el('div', { class: 'bd-lhead' });
    var tab = el('div', { class: 'bd-tab' }, [el('i', { class: 'bd-tab__dot' }), el('h1', { text: MK.t(b.title) })]);
    if (opts.fs) tab.querySelector('h1').style.fontSize = opts.fs + 'px';
    head.appendChild(tab);
    if (b.subtitle && opts.subtitle !== false) head.appendChild(el('div', { class: 'bd-lhead__sub', text: MK.t(b.subtitle) }));
    abs(head, opts.x || 56, opts.y || 48);
    root.appendChild(head);
    var corner = el('div', { class: 'bd-corner' }, [MK.brand()]);
    corner.style.right = '72px';
    corner.style.top = (opts.brandY || 46) + 'px';
    if (opts.brandFs) corner.style.fontSize = opts.brandFs + 'px';
    root.appendChild(corner);
    return { tab: tab, corner: corner, head: head };
  }
  function capStyle(node, w, dark) {
    css(node, { '--tag-fs': (w * 0.05).toFixed(1) + 'px', '--cap-fs': (w * 0.062).toFixed(1) + 'px', '--cap-mt': (w * 0.07).toFixed(1) + 'px', '--cap-gap': (w * 0.03).toFixed(1) + 'px', '--cap-max': (w * 1.05).toFixed(0) + 'px' });
    if (dark != null) node.style.setProperty('--cap-color', dark ? '#fff' : 'var(--mk-ink)');
    return node;
  }

  /* ---------- layout: banner (row of phones) ---------- */
  function banner(root, b) {
    var W = b.width, H = b.height, light = b.variant === 'light';
    var list = shots(b, 'phone');
    var panel;
    if (light) {
      headLight(root, b);
      panel = { x: 44, y: 168, w: W - 88, h: H - 168 - 40 };
    } else {
      headDark(root, b);
      panel = { x: 48, y: 244, w: W - 96, h: H - 244 - 44 };
    }
    var pn = el('div', { class: 'bd-panel' });
    abs(pn, panel.x, panel.y, panel.w, panel.h);
    root.insertBefore(pn, root.querySelector('.bd-lhead') || null);
    var n = list.length, padX = 56, padTop = light ? 104 : 48, gapMin = 30;
    var capH = 104, innerW = panel.w - 2 * padX, innerH = panel.h - padTop - capH - 30;
    var wByH = innerH / (879 / 390), wByW = (innerW - (n - 1) * gapMin) / (n * (425 / 390));
    var w = Math.floor(Math.min(wByH, wByW));
    var row = el('div', { class: 'bd-row' });
    abs(row, panel.x + padX, panel.y + padTop, innerW);
    list.forEach(function (s) {
      var item = el('div', { class: 'bd-item' });
      item.appendChild(MK.phone(s, { w: w }));
      item.appendChild(capStyle(MK.caption(s), w));
      row.appendChild(item);
    });
    root.appendChild(row);
  }

  /* ---------- layout: tablet ---------- */
  function tablet(root, b) {
    var W = b.width, H = b.height;
    headDark(root, b);
    var list = shots(b, 'tablet');
    var panel = { x: 60, y: 300, w: W - 120, h: H - 300 - 60 };
    var pn = el('div', { class: 'bd-panel' });
    abs(pn, panel.x, panel.y, panel.w, panel.h);
    root.appendChild(pn);
    var n = list.length, capH = 120, padTop = 70;
    var innerH = panel.h - padTop - capH - 40;
    var wByH = innerH / (1259 / 834);
    var wByW = (panel.w - 240 - (n - 1) * 120) / (n * (899 / 834));
    var w = Math.floor(Math.min(wByH, wByW));
    var row = el('div', { class: 'bd-row' });
    row.style.justifyContent = 'space-evenly';
    abs(row, panel.x, panel.y + padTop, panel.w);
    list.forEach(function (s) {
      var item = el('div', { class: 'bd-item' });
      item.appendChild(MK.tablet(s, { w: w }));
      item.appendChild(capStyle(MK.caption(s), w * 0.62));
      row.appendChild(item);
    });
    root.appendChild(row);
  }

  /* ---------- layout: desktop (laptop + browser windows) ---------- */
  function capRow(s, fs) {
    var c = MK.caption(s);
    c.style.flexDirection = 'row';
    c.style.justifyContent = 'center';
    css(c, { '--tag-fs': fs * 0.8 + 'px', '--cap-fs': fs + 'px', '--cap-mt': '0px', '--cap-gap': fs * 0.7 + 'px', '--cap-color': 'var(--mk-ink)' });
    return c;
  }
  function desktop(root, b) {
    var W = b.width;
    headLight(root, b, { brandFs: 60 });
    var list = shots(b, 'desktop');
    var g = b.groups || {};
    var colL = { x: 110, w: 1780 }, colR = { x: 1990, w: W - 1990 - 110 };
    var ga = el('div', { class: 'bd-group' }, [el('i'), el('span', { text: MK.t(g.app) || 'App' })]);
    var gb = el('div', { class: 'bd-group is-admin' }, [el('i'), el('span', { text: MK.t(g.admin) || 'Admin' })]);
    abs(ga, colL.x, 262); abs(gb, colR.x, 262);
    root.appendChild(ga); root.appendChild(gb);
    var div = el('div', { class: 'bd-divider' });
    abs(div, 1940, 270, 2, 1840);
    root.appendChild(div);
    var top = 330;
    // laptop (app home)
    var lw = 1400, ls = MK.frameSize('laptop', lw);
    var lap = MK.laptop(list[0], { w: lw });
    abs(lap, colL.x + (colL.w - ls.w) / 2, top);
    root.appendChild(lap);
    // big browser (admin overview)
    var bw = 1560, bs = MK.frameSize('browser', bw);
    var br = MK.browser(list[1], { w: bw });
    abs(br, colR.x + (colR.w - bw) / 2, top + (ls.h - bs.h) / 2 - 16);
    root.appendChild(br);
    var capY = top + Math.max(ls.h, bs.h) + 26;
    var c0 = capRow(list[0], 30); abs(c0, colL.x, capY, colL.w); root.appendChild(c0);
    var c1 = capRow(list[1], 30); abs(c1, colR.x, capY, colR.w); root.appendChild(c1);
    // bottom row: 2 app + 2 admin
    var y2 = capY + 100, gap = 70;
    var sw = (colL.w - gap) / 2, ss = MK.frameSize('browser', sw);
    [2, 3, 4, 5].forEach(function (idx, k) {
      var s = list[idx];
      if (!s) return;
      var baseX = k < 2 ? colL.x : colR.x;
      var cw = k < 2 ? colL.w : colR.w;
      var ww = (cw - gap) / 2;
      var x = baseX + (k % 2) * (ww + gap);
      var f = MK.browser(s, { w: ww });
      abs(f, x, y2);
      root.appendChild(f);
      var c = capRow(s, 24);
      abs(c, x, y2 + MK.frameSize('browser', ww).h + 22, ww);
      root.appendChild(c);
    });
    void ss; void sw;
  }

  /* ---------- layout: MOD.01 flow ---------- */
  function flow(root, b) {
    var W = b.width, H = b.height;
    var h = headLight(root, b, { fs: 84 });
    h.corner.style.display = 'none';
    var list = shots(b, 'phone');
    var steps = b.steps || [];
    var total = steps.reduce(function (a, s) { return a + (s.sec || 0); }, 0);
    // badge (top right)
    var badge = el('div', { class: 'fl-badge' });
    badge.innerHTML = '<b>&lt; 15' + (MK.lang === 'en' ? ' s' : ' giây') + '</b><span>' +
      MK.esc(MK.lang === 'en' ? 'no typing' : 'không gõ chữ') + '<br>' + MK.esc(MK.lang === 'en' ? 'no network needed' : 'không cần mạng') + '</span>';
    badge.style.right = '72px'; badge.style.top = '40px';
    root.appendChild(badge);
    var n = list.length, marginX = 130;
    var colW = (W - 2 * marginX) / n;
    var headY = 262, phoneY = 500;
    var bottomTop = H - 380;
    var phoneH = bottomTop - phoneY - 150;
    var w = Math.floor(Math.min(phoneH / (879 / 390), colW - 150));
    var fs = MK.frameSize('phone', w);
    list.forEach(function (s, i) {
      var st = steps[i] || {};
      var cx = marginX + colW * (i + 0.5);
      var col = el('div', { class: 'fl-step' });
      var head = el('div', { class: 'fl-step__head' });
      head.appendChild(el('span', { class: 'fl-step__no', html: MK.esc(MK.lang === 'en' ? 'Step' : 'Bước') + '<b>' + (i + 1) + '</b>' }));
      head.appendChild(el('div', { class: 'fl-step__title', text: MK.t(st.title) || MK.t(s.caption) }));
      head.appendChild(el('div', { class: 'fl-step__sub', text: MK.t(st.sub) }));
      col.appendChild(head);
      abs(col, cx - colW / 2, headY, colW);
      root.appendChild(col);
      var ph = MK.phone(s, { w: w, taps: true });
      abs(ph, cx - fs.w / 2, phoneY);
      root.appendChild(ph);
      var isLast = i === n - 1;
      var pill = el('div', { class: 'fl-time' + (isLast ? ' is-final' : '') });
      pill.innerHTML = MK.icon(isLast ? 'check' : 'timer') + '<span>' + (isLast ? MK.esc(MK.lang === 'en' ? 'Done ≈ ' + total + ' s' : 'Xong ≈ ' + total + ' giây') : '≈ ' + (st.sec || 0) + (MK.lang === 'en' ? ' s' : ' giây')) + '</span>';
      var wrap = el('div', { class: 'fl-step' }, [pill]);
      abs(wrap, cx - colW / 2, phoneY + fs.h - 6, colW);
      root.appendChild(wrap);
      if (!isLast) {
        var ar = el('div', { class: 'fl-arrow', html: MK.icon('arrowRight') });
        abs(ar, marginX + colW * (i + 1), phoneY + fs.h * 0.46);
        root.appendChild(ar);
      }
    });
    // timeline 0..15 s
    var bottom = el('div', { class: 'fl-bottom' });
    var bar = el('div', { class: 'fl-bar' });
    var maxS = 15, t = 0;
    var shades = ['#08665C', '#0B7A6E', '#0E8C82', '#12A08F'];
    steps.forEach(function (s, i) {
      if (!s.sec) return;
      var seg = el('div', { class: 'fl-seg', text: (MK.lang === 'en' ? 'Step ' : 'Bước ') + (i + 1) + ' · ' + s.sec + (MK.lang === 'en' ? ' s' : 's') });
      seg.style.left = 'calc(8px + (100% - 16px) * ' + (t / maxS) + ')';
      seg.style.width = 'calc((100% - 16px) * ' + (s.sec / maxS) + ' - 4px)';
      seg.style.background = shades[i % shades.length];
      if (i === 0) seg.style.borderRadius = '99px 0 0 99px';
      bar.appendChild(seg);
      t += s.sec;
    });
    var end = el('span', { class: 'fl-bar__end', text: '≈ ' + total + (MK.lang === 'en' ? ' s' : ' giây') });
    end.style.left = 'calc(8px + (100% - 16px) * ' + (total / maxS) + ')';
    bar.appendChild(end);
    var tg = el('div', { class: 'fl-target' }, [el('span', { text: MK.lang === 'en' ? 'Target < 15 s' : 'Mục tiêu < 15 giây' })]);
    tg.style.left = 'calc(100% - 8px)';
    bar.appendChild(tg);
    bottom.appendChild(bar);
    var scale = el('div', { class: 'fl-scale' });
    [0, 5, 10, 15].forEach(function (v) { var sp = el('span', { text: v + 's' }); sp.style.left = 'calc(8px + (100% - 16px) * ' + (v / maxS) + ')'; scale.appendChild(sp); });
    bottom.appendChild(scale);
    var goals = el('div', { class: 'fl-goals' });
    goals.appendChild(el('div', { class: 'fl-target-text', text: MK.t(b.target) }));
    var pills = el('div', { class: 'fl-pills' });
    [['hand', MK.lang === 'en' ? '≤ 5 taps' : '≤ 5 chạm'], ['wifiOff', MK.lang === 'en' ? 'Offline' : 'Không cần mạng'], ['globe', MK.lang === 'en' ? 'VI + 6 languages' : 'VI + 6 ngôn ngữ']].forEach(function (p) {
      pills.appendChild(el('span', { class: 'fl-pill', html: MK.icon(p[0]) + MK.esc(p[1]) }));
    });
    goals.appendChild(pills);
    bottom.appendChild(goals);
    if (b.note) bottom.appendChild(el('div', { class: 'fl-note', text: MK.t(b.note) }));
    root.appendChild(bottom);
  }

  /* ---------- layout: overview (master board) ---------- */
  function overview(root, b) {
    var W = b.width, H = b.height;
    var ids = b.shots || [];
    var get = function (i, dev) { return MK.shotOrStub(ids[i], dev); };
    var left = el('div', { class: 'ov-left' });
    abs(left, 130, 110, 1180);
    var br = MK.brand();
    br.style.fontSize = '64px';
    left.appendChild(br);
    left.appendChild(el('h2', { class: 'ov-h1', text: MK.t(b.title) }));
    left.appendChild(el('p', { class: 'ov-sub', text: MK.t(b.subtitle) }));
    var stats = el('div', { class: 'ov-stats' });
    [['5', MK.lang === 'en' ? 'safety modules' : 'module an toàn'], ['100%', MK.lang === 'en' ? 'emergency flows offline' : 'luồng khẩn cấp offline'], ['< 15s', MK.lang === 'en' ? 'to a bilingual phrase' : 'tới câu y tế song ngữ'], ['3', MK.lang === 'en' ? 'pilot routes' : 'tuyến thí điểm']].forEach(function (s) {
      stats.appendChild(el('div', { class: 'ov-stat' }, [el('b', { text: s[0] }), el('span', { text: s[1] })]));
    });
    left.appendChild(stats);
    var mods = el('div', { class: 'ov-mods' });
    Object.keys(D.modules || {}).forEach(function (k) {
      var m = D.modules[k], info = MK.modInfo(k);
      var row = el('div', { class: 'ov-mod', style: { '--tag-c': info.c } });
      row.appendChild(el('span', { class: 'ov-mod__icon', html: MK.icon(info.icon) }));
      var tx = el('div', { class: 'ov-mod__txt' });
      tx.appendChild(el('b', { html: '<em>' + MK.esc(k) + '</em>' + MK.esc(MK.t(m.name)) }));
      tx.appendChild(el('span', { text: MK.t(m.desc) }));
      row.appendChild(tx);
      mods.appendChild(row);
    });
    left.appendChild(mods);
    var tech = el('div', { class: 'ov-tech' });
    (MK.lang === 'en' ? ['Offline-first PWA', 'AES-GCM on device', 'A* routing', '3-level signal layer', 'Supabase · PostgreSQL + PostGIS', 'VI + EN UI']
      : ['PWA offline-first', 'Mã hoá AES-GCM trên máy', 'Định tuyến A*', 'Lớp sóng 3 mức', 'Supabase · PostgreSQL + PostGIS', 'Giao diện VI + EN']).forEach(function (t) { tech.appendChild(el('span', { text: t })); });
    left.appendChild(tech);
    var rts = el('div', { class: 'ov-routes' }, [el('b', { text: MK.lang === 'en' ? 'Pilot routes' : 'Tuyến thí điểm' })]);
    [['#107A49', 'Hà Giang Loop'], ['#F2A20C', MK.lang === 'en' ? 'Khánh Lê pass' : 'Đèo Khánh Lê'], ['#C2410C', 'Tà Năng – Phan Dũng']].forEach(function (r) {
      rts.appendChild(el('span', { style: { '--c': r[0] } }, [el('i'), r[1]]));
    });
    left.appendChild(rts);
    root.appendChild(left);
    var foot = el('div', { class: 'ov-foot', text: 'Team Stormbreakers · AISC 2026 · Digital Business Ideas' });
    abs(foot, 130, H - 84);
    root.appendChild(foot);
    // devices
    var lw = 1720, ls = MK.frameSize('laptop', lw);
    var lap = MK.laptop(get(0, 'desktop'), { w: lw });
    var lx = W - 110 - ls.w, ly = 150;
    abs(lap, lx, ly);
    root.appendChild(lap);
    var tw = 600, ts = MK.frameSize('tablet', tw);
    var tab = MK.tablet(get(1, 'tablet'), { w: tw });
    abs(tab, lx - 150, H - 90 - ts.h);
    root.appendChild(tab);
    var pw = 372, ps = MK.frameSize('phone', pw);
    var px = [lx + ts.w + 10, lx + ts.w + 10 + ps.w + 60, lx + ts.w + 10 + 2 * (ps.w + 60)];
    var py = [H - 70 - ps.h, H - 130 - ps.h, H - 190 - ps.h];
    [2, 3, 4].forEach(function (idx, k) {
      var s = get(idx, 'phone');
      var p = MK.phone(s, { w: pw });
      abs(p, px[k], py[k]);
      root.appendChild(p);
    });
  }

  var LAYOUTS = { banner: banner, tablet: tablet, desktop: desktop, flow: flow, overview: overview };

  function index() {
    document.documentElement.classList.remove('is-board');
    document.body.style.cssText = 'margin:0;padding:40px;font-family:var(--mk-font);background:#F3F7F7;color:#0F1F1E;overflow:auto';
    var box = el('div');
    box.appendChild(el('h1', { text: 'NomadCare — mockup boards' }));
    Object.keys(D.boards || {}).forEach(function (k) {
      var bb = D.boards[k];
      box.appendChild(el('p', {}, [el('a', { href: '?board=' + k + '#' + k, text: k }), ' — ' + bb.width + '×' + bb.height + ' → export/' + bb.file]));
    });
    document.body.appendChild(box);
    window.__boardReady = true;
  }

  function render() {
    var name = (location.hash || '').replace(/^#/, '') || qs.board;
    var b = name && D.boards ? D.boards[name] : null;
    if (!b) { index(); return; }
    var root = el('div', { class: 'bd bd--' + (b.variant || 'brand'), id: 'board-' + name });
    root.style.width = b.width + 'px';
    root.style.height = b.height + 'px';
    document.body.style.width = b.width + 'px';
    document.body.style.height = b.height + 'px';
    document.getElementById('board').appendChild(root);
    var errors = [];
    try {
      decorate(root, b);
      (LAYOUTS[b.layout] || banner)(root, b);
    } catch (e) {
      errors.push(String(e && e.message || e));
      if (window.console) console.error(e);
    }
    window.__boardInfo = { name: name, missing: MK.missing, placeholders: MK.placeholders, errors: errors };
    MK.whenReady().then(function () {
      return new Promise(function (r) { setTimeout(r, 120); });
    }).then(function () { window.__boardReady = true; });
  }
  window.addEventListener('hashchange', function () { location.reload(); });
  render();
})(window.MK);
