/*
 * placeholder.js — renders a TEMPORARY on-brand mock screen for one shot (placeholder.html?id=<shot id>), used by
 * `node build-mockup.js placeholders` to develop the boards before the real app exists. Every placeholder carries an
 * orange "PLACEHOLDER" ribbon; `node build-mockup.js shots` overwrites them with real screenshots. ES2017.
 */
(function (MK) {
  'use strict';
  var el = MK.el, I = MK.icon;
  var id = (location.search.match(/[?&]id=([^&]+)/) || [])[1];
  id = id ? decodeURIComponent(id) : '';
  var shot = MK.shot(id) || { id: id || 'unknown', device: 'phone', theme: 'light', caption: { vi: id }, module: '' };
  var dark = shot.theme === 'dark';
  var kind = shot.device;
  document.body.classList.toggle('is-dark', dark);
  document.body.classList.add('ph-' + shot.device);
  var mod = shot.module || '';
  var cap = MK.t(shot.caption);
  var info = MK.modInfo(mod);

  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function lines(n) { var s = ''; var w = ['', 'w80', 'w60', 'w40']; for (var i = 0; i < n; i++) s += '<div class="ph-line ' + w[i % 4] + '"></div>'; return s; }
  function card(title, body) { return '<div class="ph-card">' + (title ? '<h3>' + MK.esc(title) + '</h3>' : '') + body + '</div>'; }
  function tileRow(icon, color, title, n) {
    return '<div class="ph-row"><span class="ph-tile" style="background:' + color + '">' + I(icon) + '</span><div style="flex:1"><b style="font-size:15px">' + MK.esc(title) + '</b>' + lines(n || 1) + '</div></div>';
  }
  function strip() { return '<div class="ph-strip"><i style="width:38%;background:#107A49"></i><i style="width:14%;background:#F2A20C"></i><i style="width:18%;background:#C93338"></i><i style="width:30%;background:#107A49"></i></div>'; }
  function qr() {
    var s = '<div class="ph-qr">', seed = 7;
    for (var i = 0; i < 441; i++) {
      var x = i % 21, y = Math.floor(i / 21);
      seed = (seed * 16807) % 2147483647;
      var finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      var on = finder ? ((x % 20 === 0 || y % 20 === 0 || x === 6 || y === 6 || x === 14 || y === 14) || ((x > 1 && x < 5 || x > 15 && x < 19) && (y > 1 && y < 5 || y > 15 && y < 19))) : seed % 3 === 0;
      s += '<i style="background:' + (on ? '#0F1F1E' : 'transparent') + '"></i>';
    }
    return s + '</div>';
  }

  function content() {
    var m = mod;
    if (id.indexOf('onboarding') >= 0) {
      return '<div class="ph-hero" style="text-align:center;padding:34px 20px"><div style="font-size:60px;line-height:1">' + I('shield', 'x').replace('class="x"', 'style="width:72px;height:72px"') + '</div><h2>NomadCare</h2><p>' + MK.esc(cap) + '</p></div>' +
        card('', tileRow('wifiOff', '#0B7A6E', 'Offline-first', 1) + tileRow('chat', '#1A6FD0', 'Song ngữ VI + EN', 1) + tileRow('lock', '#C98100', 'Mã hoá trên máy', 1)) +
        '<div class="ph-btn">Tiếp tục</div>';
    }
    if (m === 'Khẩn cấp' || /home/.test(id)) return homeBlocks();
    if (m === 'MOD.01') {
      if (/result/.test(id)) {
        var urgent = /dark/.test(id);
        return (urgent ? '<div class="ph-btn is-red">' + I('siren') + ' Gọi 115 ngay</div>' : '') +
          card('Đưa màn hình này cho nhân viên y tế', '<div class="ph-big">Chân tôi bị bỏng pô xe máy, da phồng rộp, rất đau.</div><p style="color:var(--tx2);font-size:17px;margin:14px 0 0">I burned my leg on a motorbike exhaust. It has blistered and is very painful.</p>') +
          '<div class="ph-grid" style="grid-template-columns:1fr 1fr"><div class="ph-btn is-ghost">Đọc to</div><div class="ph-btn is-ghost">Toàn màn hình</div></div>' + card('', lines(2));
      }
      var groups = [['Đầu', 'Head'], ['Ngực', 'Chest'], ['Bụng', 'Abdomen'], ['Tay', 'Arms'], ['Chân', 'Legs & feet'], ['Da', 'Skin']];
      if (/symptom/.test(id)) groups = [['Chấn thương chân', 'Leg injury'], ['Bỏng pô xe máy', 'Exhaust burn'], ['Vết cắt, chảy máu', 'Cut, bleeding'], ['Chuột rút', 'Cramp'], ['Phồng rộp', 'Blisters']];
      if (/severity/.test(id)) {
        return card('Mức độ', '') + ['#107A49|Nhẹ|Mild', '#F2A20C|Vừa|Moderate', '#C93338|Nặng|Severe'].map(function (s) {
          var p = s.split('|'); return '<div class="ph-card"' + (p[2] === 'Moderate' ? ' data-mk-tap' : '') + ' style="border:2px solid ' + p[0] + ';display:flex;justify-content:space-between;align-items:center;padding:22px"><b style="font-size:22px">' + p[2] + '</b><span style="color:' + p[0] + ';font-weight:700;font-size:18px">' + p[1] + '</span></div>';
        }).join('');
      }
      return '<div class="ph-tabs"><span class="is-on">Triệu chứng</span><span>Câu nhanh</span><span>Nhân viên hỏi</span></div>' +
        '<div class="ph-grid" style="grid-template-columns:1fr 1fr">' + groups.map(function (g) {
          return '<div class="ph-card"' + (/body/.test(id) && g[1] === 'Legs & feet' || /symptom/.test(id) && g[1] === 'Exhaust burn' ? ' data-mk-tap' : '') + ' style="text-align:center;padding:20px 10px"><span class="ph-tile" style="margin:0 auto 10px;background:#0B7A6E">' + I('chat') + '</span><b>' + g[1] + '</b><div style="font-size:12px;color:var(--mu)">' + g[0] + '</div></div>';
        }).join('') + '</div>';
    }
    if (m === 'MOD.02') {
      var tabs = /nearest/.test(id) ? 1 : 0;
      return '<div class="ph-map"><svg viewBox="0 0 390 700" preserveAspectRatio="none"><path d="M40 620 C 90 520 60 430 150 380 S 260 300 230 210 S 300 90 350 60" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>' +
        '<path d="M40 620 C 90 520 60 430 150 380" fill="none" stroke="#107A49" stroke-width="7" stroke-linecap="round"/><path d="M150 380 S 260 300 230 210" fill="none" stroke="#C93338" stroke-width="7" stroke-linecap="round"/><path d="M230 210 S 300 90 350 60" fill="none" stroke="#F2A20C" stroke-width="7" stroke-linecap="round"/>' +
        '<circle cx="40" cy="620" r="10" fill="#1A6FD0" stroke="#fff" stroke-width="4"/><circle cx="350" cy="60" r="10" fill="#C2410C" stroke="#fff" stroke-width="4"/></svg>' +
        '<div class="ph-sheet"><div class="ph-sheet__handle"></div><div class="ph-tabs"><span' + (tabs === 0 ? ' class="is-on"' : '') + '>Lộ trình</span><span' + (tabs === 1 ? ' class="is-on"' : '') + '>Y tế gần nhất</span><span>Điểm dừng</span></div>' +
        (tabs === 0 ? '<div class="ph-row" style="justify-content:space-between"><div><b style="font-size:24px">64 km</b><div style="color:var(--mu);font-size:13px">≈ 2 giờ 34 phút · xe máy</div></div><span class="ph-pill is-off"><i></i>Mất sóng sau 18 km</span></div>' + strip() + lines(2)
          : tileRow('cross', '#0B7A6E', 'Trạm y tế xã Lũng Cú', 1) + '<div style="height:10px"></div>' + tileRow('cross', '#0B7A6E', 'TTYT huyện Đồng Văn', 1) + '<div style="height:10px"></div>' + tileRow('cross', '#1A6FD0', 'Nhà thuốc Mèo Vạc', 1)) +
        '</div></div>';
    }
    if (m === 'MOD.03') {
      if (/rescuer/.test(id)) {
        return '<div class="ph-card" style="background:#0F1F1E;color:#fff;border:0"><div style="font-size:14px;opacity:.7">HỒ SƠ Y TẾ · MEDICAL ID</div><div class="ph-big" style="font-size:64px;color:#FF6369">O+</div><b style="font-size:20px">Dị ứng: Penicillin</b><div style="opacity:.75">Allergy: Penicillin</div><div style="margin-top:10px;font-size:18px">Hen suyễn · Ventolin</div></div>' +
          '<div class="ph-btn is-red">' + I('siren') + ' Gọi 115</div><div class="ph-btn is-ghost">' + I('lock') + ' Giữ để xem định danh</div>';
      }
      return card('Lớp công khai', '<div class="ph-row"><span class="ph-tile" style="width:64px;height:64px;background:#C93338;font-weight:800;font-size:22px">O+</span><div style="flex:1">' + lines(3) + '</div></div>') +
        card('Mã QR — quét không cần app', '<div style="width:62%;margin:0 auto">' + qr() + '</div>') + '<div class="ph-btn">Tạo hình nền màn hình khoá</div>';
    }
    if (m === 'MOD.04') {
      if (/sim/.test(id)) {
        return card('Mô phỏng hành trình', '<div class="ph-map" style="margin:0;height:220px;border-radius:14px;flex:none"><svg viewBox="0 0 390 220" preserveAspectRatio="none"><path d="M20 190 C 120 150 140 60 240 90 S 340 60 370 20" fill="none" stroke="#107A49" stroke-width="7" stroke-linecap="round"/><circle cx="240" cy="90" r="11" fill="#C2410C" stroke="#fff" stroke-width="4"/></svg></div>' + strip() +
          '<div class="ph-grid" style="grid-template-columns:repeat(3,1fr);margin-top:10px"><div class="ph-btn">▶</div><div class="ph-btn is-ghost">×60</div><div class="ph-btn is-ghost">↺</div></div>') +
          '<div class="ph-card" style="border:2px solid #F2A20C"><b>Sắp vào vùng mất sóng</b><div style="color:var(--tx2);font-size:14px;margin-top:6px">còn 1,8 km (~4 phút) · dài 6,2 km</div></div>';
      }
      return card('Buddy Check-in', '<div class="ph-ring"><div><div><b>1:52</b><span>tới lần check-in</span></div></div></div><div style="text-align:center"><span class="ph-pill"><i></i>Đang theo dõi</span></div>') +
        '<div class="ph-btn" style="height:64px;font-size:18px">' + I('check') + ' Tôi ổn — Check-in</div><div class="ph-grid" style="grid-template-columns:1fr 1fr"><div class="ph-btn is-ghost">Gửi vị trí</div><div class="ph-btn is-red">SOS</div></div>' + card('Nhật ký', lines(3));
    }
    if (m === 'MOD.05') {
      if (/step|cpr/.test(id)) {
        return '<div class="ph-card" style="border:2px solid #C93338;background:rgba(229,72,77,.08)"><b style="color:#C93338">Gọi 115 ngay nếu…</b>' + lines(1) + '</div>' +
          card('Bước 2 / 5', '<div style="height:210px;border-radius:14px;background:var(--sf2);display:grid;place-items:center;color:var(--pr)">' + I('cross').replace('class="i"', 'style="width:90px;height:90px"') + '</div><div style="font-size:20px;font-weight:700;margin-top:14px">Ấn chặt trực tiếp lên vết thương bằng gạc sạch.</div>') +
          '<div class="ph-grid" style="grid-template-columns:1fr 1fr"><div class="ph-btn is-ghost">Trước</div><div class="ph-btn">Tiếp</div></div>';
      }
      return '<div class="ph-card" style="padding:12px 16px;color:var(--mu)">Tìm: chảy máu, bỏng, rắn cắn…</div><div class="ph-tabs"><span class="is-on">Tất cả</span><span>Chấn thương</span><span>Môi trường</span></div>' +
        '<div class="ph-grid" style="grid-template-columns:1fr 1fr">' + ['Chảy máu', 'Gãy xương', 'Bỏng', 'Rắn cắn', 'CPR', 'Hạ thân nhiệt'].map(function (t, i) {
          return '<div class="ph-card" style="padding:14px"><div style="height:74px;border-radius:12px;background:var(--sf2);margin-bottom:10px"></div><b>' + t + '</b><div style="font-size:12px;color:' + (i < 2 ? '#C93338' : 'var(--mu)') + '">' + (i < 2 ? 'Nguy kịch' : 'Thường gặp') + '</div></div>';
        }).join('') + '</div>';
    }
    if (m === 'Cài đặt') return card('Quyền riêng tư & dữ liệu', lines(4)) + card('Đồng ý', lines(3)) + '<div class="ph-btn is-red">Giữ để xoá toàn bộ dữ liệu</div>';
    if (m === 'Admin') return adminBlocks();
    return homeBlocks();
  }
  function homeBlocks() {
    return '<div class="ph-hero"><div style="font-size:13px;opacity:.85">Thứ Hai, 28/9</div><h2>Xin chào, Minh Anh</h2><p>Hà Giang Loop · Viettel · Xe máy</p>' +
      '<div class="ph-hero__stats"><div><b>3</b><span>Gói offline</span></div><div><b>18</b><span>Điểm y tế</span></div><div><b>1:52</b><span>Check-in</span></div></div></div>' +
      '<div class="ph-grid" style="grid-template-columns:1fr 1fr"><div class="ph-card"' + (/flow/.test(id) ? ' data-mk-tap' : '') + ' style="background:#0B7A6E;color:#fff;border:0">' + I('chat') + '<h3 style="margin-top:8px">Nói với nhân viên y tế</h3><div style="font-size:12px;opacity:.85">1 chạm · không cần mạng</div></div>' +
      '<div class="ph-card" style="background:#12A150;color:#fff;border:0">' + I('cross') + '<h3 style="margin-top:8px">Sơ cứu ngoại tuyến</h3><div style="font-size:12px;opacity:.85">36 hướng dẫn</div></div></div>' +
      card('Tuyến của bạn', strip() + lines(2)) + card('Chuẩn bị trước chuyến đi', lines(3));
  }
  function adminBlocks() {
    var k = ['216|Điểm y tế mục tiêu', '164|Đã xác thực', '12|Chờ duyệt', '2|Buddy QUÁ HẠN'];
    return '<div class="ph-grid" style="grid-template-columns:repeat(4,1fr)">' + k.map(function (x, i) { var p = x.split('|'); return '<div class="ph-card ph-kpi"><b style="color:' + (i === 3 ? '#C93338' : 'inherit') + '">' + p[0] + '</b><span>' + p[1] + '</span></div>'; }).join('') + '</div>' +
      '<div class="ph-grid" style="grid-template-columns:2fr 1fr;flex:1"><div class="ph-card" style="display:flex;flex-direction:column"><h3>' + MK.esc(cap) + '</h3><div class="ph-map" style="margin:0;border-radius:14px"></div></div><div class="ph-card"><h3>Hoạt động</h3>' + lines(9) + '</div></div>';
  }

  var NAV = [['home', 'Trang chủ', ''], ['chat', 'Dịch y tế', 'MOD.01'], ['map', 'Bản đồ', 'MOD.02'], ['qr', 'Hồ sơ QR', 'MOD.03'], ['shield', 'Buddy', 'MOD.04'], ['cross', 'Sơ cứu', 'MOD.05'], ['settings', 'Cài đặt', '']];
  if (mod === 'Admin') NAV = [['dashboard', 'Tổng quan', ''], ['cross', 'Cơ sở y tế', ''], ['signal', 'Lớp sóng', ''], ['shield', 'Buddy', ''], ['layers', 'Gói dữ liệu', ''], ['settings', 'Kết nối', '']];
  function side(rail) {
    var s = '<aside class="ph-side' + (rail ? ' ph-rail' : '') + '" style="width:' + (rail ? 88 : 264) + 'px">';
    if (!rail) s += '<div class="ph-row" style="padding:4px 8px 16px"><span style="width:40px;height:40px;border-radius:12px;overflow:hidden">' + MK.markSvg() + '</span><b style="font-size:19px">NomadCare</b></div>';
    NAV.forEach(function (n) {
      var on = (mod === n[2] && n[2]) || (!n[2] && n[1] === 'Trang chủ' && /Trang chủ|Khẩn cấp|Onboarding/.test(mod)) || (mod === 'Admin' && n[1] === (/buddy/.test(id) ? 'Buddy' : /signal/.test(id) ? 'Lớp sóng' : 'Tổng quan'));
      s += '<div class="ph-side__it' + (on ? ' is-on' : '') + '">' + I(n[0]) + '<span>' + n[1] + '</span><small>' + n[2] + '</small></div>';
    });
    if (!rail && mod !== 'Admin') s += '<div style="flex:1"></div><div class="ph-btn is-red">' + I('siren') + ' Khẩn cấp 115</div>';
    return s + '</aside>';
  }
  var off = !!shot.offline;
  var title = mod === 'Trang chủ' || mod === 'Khẩn cấp' ? 'NomadCare' : (mod === 'Admin' ? 'NomadCare Admin' : cap);
  var top = '<header class="ph-top"><div class="ph-top__bar">' + (kind === 'phone' && mod && !/Trang chủ|Khẩn cấp|Onboarding/.test(mod) ? '<span class="ph-circle">' + I('chevLeft') + '</span>' : '<span style="width:30px;height:30px;border-radius:9px;overflow:hidden;flex:none">' + MK.markSvg() + '</span>') +
    '<div class="ph-top__title">' + MK.esc(title) + '</div><span class="ph-pill' + (off ? ' is-off' : '') + '"><i></i>' + (off ? 'Offline' : 'Online') + '</span><span class="ph-circle" style="font-size:12px;font-weight:700">VI</span></div></header>';
  var tabbar = '<nav class="ph-tabbar"><div class="ph-tabbar__in">' +
    '<span class="ph-tabbar__it' + (/Trang chủ|Khẩn cấp/.test(mod) ? ' is-on' : '') + '">' + I('home') + 'Trang chủ</span>' +
    '<span class="ph-tabbar__it' + (mod === 'MOD.02' ? ' is-on' : '') + '">' + I('map') + 'Bản đồ</span>' +
    '<span class="ph-fab">SOS</span>' +
    '<span class="ph-tabbar__it' + (mod === 'MOD.04' ? ' is-on' : '') + '">' + I('shield') + 'Buddy</span>' +
    '<span class="ph-tabbar__it' + (mod === 'MOD.03' ? ' is-on' : '') + '">' + I('qr') + 'Hồ sơ</span></div></nav>';
  var body = '<div class="ph-view">' + content() + '</div>';
  var onboarding = id.indexOf('onboarding') >= 0;
  var html = '<div class="ph-app">' + (kind === 'phone' || onboarding ? '' : side(kind === 'tablet')) + '<div class="ph-main">' + (onboarding ? '<div style="height:env(safe-area-inset-top)"></div>' : top) + body + (kind === 'phone' && !onboarding ? tabbar : '<div style="height:env(safe-area-inset-bottom)"></div>') + '</div></div>';
  if (mod === 'Khẩn cấp') {
    html += '<div class="ph-dim"></div><div class="ph-sheet" style="position:fixed;padding-bottom:calc(20px + env(safe-area-inset-bottom))"><div class="ph-sheet__handle"></div><h3 style="margin:4px 0 14px;font-size:20px">Khẩn cấp</h3>' +
      '<div class="ph-btn is-red" style="height:76px;font-size:24px">' + I('siren') + ' Gọi 115</div><div style="height:10px"></div><div class="ph-btn" style="background:#C2410C">Gửi SOS + vị trí</div><div style="height:10px"></div>' +
      '<div class="ph-grid" style="grid-template-columns:1fr 1fr"><div class="ph-btn is-ghost">Nói với y tế</div><div class="ph-btn is-ghost">Hồ sơ QR</div></div><div style="height:10px"></div><div class="ph-grid" style="grid-template-columns:repeat(3,1fr)"><div class="ph-btn is-ghost">113</div><div class="ph-btn is-ghost">114</div><div class="ph-btn is-ghost">112</div></div></div>';
  }
  html += '<div class="ph-ribbon">Placeholder · ảnh tạm<small>chạy node build-mockup.js shots để thay bằng ảnh thật · ' + MK.esc(shot.id) + '</small></div>';
  document.getElementById('ph').innerHTML = html;
  if (kind === 'tablet' || kind === 'desktop') {
    var v = document.querySelector('.ph-view');
    if (v && mod !== 'Admin' && mod !== 'MOD.02') { v.style.display = 'grid'; v.style.gridTemplateColumns = kind === 'desktop' ? '1fr 1fr 1fr' : '1fr 1fr'; v.style.alignContent = 'start'; v.style.padding = '24px'; }
    if (v && kind === 'desktop') v.style.padding = '28px 40px';
  }
  var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  fonts.then(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { window.__phReady = true; }); }); });
})(window.MK);
