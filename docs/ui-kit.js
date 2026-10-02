/*
 * ui-kit.js — renders the design-system gallery twice (light + dark panes) on docs/ui-kit.html.
 * Owner: P1 shell. Uses only core modules (NC.util, NC.i18n, NC.icons, NC.ui). Not loaded by the app.
 */
(function (NC) {
  'use strict';

  var U = NC.util, ui = NC.ui, esc = U.esc;
  var I = function (n, c) { return ui.icon(n, c); };
  function t(k, v) { return NC.i18n.t(k, v); }

  var COLOR_TOKENS = [
    '--c-bg', '--c-surface', '--c-surface-2', '--c-surface-3', '--c-border', '--c-text', '--c-text-2', '--c-muted',
    '--c-primary', '--c-primary-strong', '--c-primary-soft', '--c-on-primary', '--c-accent', '--c-accent-soft',
    '--c-danger', '--c-danger-soft', '--c-warning', '--c-warning-soft', '--c-success', '--c-success-soft',
    '--c-info', '--c-info-soft', '--grad-hero', '--grad-accent', '--grad-danger'
  ];

  function section(title, note, body) {
    return '<section class="kit-section"><h2>' + esc(title) + '</h2>' + (note ? '<p class="kit-note">' + esc(note) + '</p>' : '') + body + '</section>';
  }

  function gallery(theme) {
    var id = function (s) { return 'k-' + theme + '-' + s; };
    var h = '';
    h += '<p class="kit-pane__label">' + I(theme === 'dark' ? 'moon' : 'sun', 'icon--sm') + esc(theme) + ' theme</p>';

    /* Brand */
    h += section('Brand', 'logo.svg · favicon.svg · icons/icon-maskable.svg · illustrations/*.svg',
      '<div class="kit-brand">' +
        '<img src="../assets/img/logo.svg" width="72" height="72" alt="Logo">' +
        '<img src="../assets/img/favicon.svg" width="48" height="48" alt="Favicon">' +
        '<img class="kit-brand__maskable" src="../assets/img/icons/icon-maskable.svg" width="72" height="72" alt="Maskable icon (masked preview)">' +
        '<span class="brand"><img class="brand__logo" src="../assets/img/logo.svg" alt=""><span class="brand__text"><span class="brand__name">Nomad<b>Care</b></span><span class="brand__tag">' + esc(t('common.demo_data')) + '</span></span></span>' +
      '</div>' +
      '<div class="kit-illus mt-3">' + ['onboarding-offline-map', 'onboarding-phrase-card', 'onboarding-qr-lock', 'onboarding-buddy', 'empty-state'].map(function (n) {
        return '<img src="../assets/img/illustrations/' + n + '.svg" alt="' + n + '" width="320" height="240">';
      }).join('') + '</div>');

    /* Colors */
    h += section('Color tokens', 'tokens.css — names are part of the contract', '<div class="kit-swatches" data-swatches></div>');

    /* Typography */
    h += section('Typography', 'Be Vietnam Pro 400–800 · --fs-xs … --fs-display',
      '<div class="kit-type">' +
        '<p style="font-size:var(--fs-display);font-weight:800;letter-spacing:-.02em;line-height:1.1">115 · Cấp cứu</p>' +
        '<h1>Chiếc phao sinh tồn kỹ thuật số</h1><h2>Bản đồ & định tuyến offline</h2><h3>Hồ sơ QR sinh tồn</h3>' +
        '<p class="lead">Ứng dụng vận hành được khi mất mạng — tiếng Việt có dấu hiển thị rõ ràng.</p>' +
        '<p>Body 15px/1.55: Đoạn văn mô tả, dễ đọc dưới nắng. <a href="#">Liên kết</a> · <b>đậm</b> · <span class="muted">muted</span> · <code>code</code> · <kbd>Esc</kbd></p>' +
        '<p class="small muted">Small 13.5px — ghi chú phụ, nguồn trích dẫn.</p>' +
        '<span class="eyebrow">Eyebrow · MOD.02</span> <span class="mod-tag">MOD.04</span>' +
      '</div>');

    /* Buttons */
    h += section('Buttons', '.btn + --primary --accent --danger --soft --ghost --outline --white · sizes --sm --lg --xl --block --icon · .is-loading',
      '<div class="kit-row">' +
        '<button class="btn btn--primary" type="button">' + I('navigation') + '<span>Chỉ đường</span></button>' +
        '<button class="btn btn--accent" type="button">' + I('download') + '<span>Tải gói</span></button>' +
        '<button class="btn btn--danger" type="button">' + I('phone') + '<span>Gọi 115</span></button>' +
        '<button class="btn btn--soft" type="button">Soft</button>' +
        '<button class="btn btn--ghost" type="button">Ghost</button>' +
        '<button class="btn btn--outline" type="button">Outline</button>' +
        '<button class="btn" type="button">Default</button>' +
      '</div><div class="kit-row">' +
        '<button class="btn btn--primary btn--sm" type="button">Small</button>' +
        '<button class="btn btn--primary btn--lg" type="button">Large</button>' +
        '<button class="btn btn--primary btn--icon" type="button" aria-label="Locate">' + I('locate') + '</button>' +
        '<button class="btn btn--outline btn--icon btn--pill" type="button" aria-label="Share">' + I('share') + '</button>' +
        '<button class="btn btn--primary is-loading" type="button">Loading</button>' +
        '<button class="btn btn--primary" type="button" disabled>Disabled</button>' +
      '</div>' +
      '<button class="btn btn--danger btn--xl btn--block" type="button" id="' + id('hold') + '">' + I('siren') + '<span>Giữ để gửi SOS</span></button>' +
      '<p class="kit-note mt-2">NC.ui.holdToConfirm(btn, 1200, fn) — nhấn giữ (hoặc Enter hai lần).</p>' +
      '<div class="card card--hero mt-3"><div class="kit-row m-0"><button class="btn btn--white" type="button">White on hero</button><button class="btn btn--glass" type="button">Glass</button></div></div>');

    /* Cards */
    h += section('Cards', '.card + __header __title __subtitle __body __footer · --hero --tinted --danger --warning --flat --interactive',
      '<div class="kit-grid2">' +
        '<article class="card card--hero"><span class="mod-tag">MOD.02</span><h3 class="card__title mt-2">Hà Giang Loop</h3><p class="card__subtitle">318 km · 3 vùng mất sóng phía trước</p>' +
          '<div class="card__footer"><button class="btn btn--white btn--sm" type="button">' + I('map') + '<span>Mở bản đồ</span></button></div></article>' +
        '<article class="card"><div class="card__header"><span class="icon-tile">' + I('hospital') + '</span><div><h3 class="card__title">Trạm y tế xã Lũng Cú</h3><p class="card__subtitle">2,4 km · mở 24/7</p></div>' + ui.demoBadge() + '</div>' +
          '<p class="card__body">Sơ cứu chấn thương, có ca trực đêm.</p><div class="card__footer"><button class="btn btn--soft btn--sm" type="button" data-call="+84 000 000 012">' + I('phone') + '<span>Gọi</span></button><button class="btn btn--ghost btn--sm" type="button">' + I('navigation') + '<span>Chỉ đường</span></button></div></article>' +
        '<article class="card card--tinted"><h3 class="card__title">Tinted</h3><p class="card__body">Nhấn mạnh nhẹ, không đổ bóng.</p></article>' +
        '<article class="card card--warning"><h3 class="card__title">Sắp vào vùng mất sóng</h3><p class="card__body">Còn khoảng 4 phút — gửi vị trí ngay.</p></article>' +
        '<article class="card card--danger"><h3 class="card__title">Quá hạn check-in</h3><p class="card__body">Đã gửi vị trí cuối cho Lê Hà.</p></article>' +
        '<a class="card card--interactive" href="#"><div class="card__header"><span class="icon-tile icon-tile--accent">' + I('book-open') + '</span><div><h3 class="card__title">Interactive</h3><p class="card__subtitle">Hover lift</p></div></div></a>' +
      '</div>');

    /* Chips, badges, pills */
    h += section('Chips · badges · pills · signal', '.chip(.is-selected, --lg) · .badge(--success …) · .pill · .signal-dot · NC.ui.signalBadge / demoBadge',
      '<div class="chip-group mb-3" data-chips><button class="chip is-selected" type="button">' + I('bike') + 'Xe máy</button><button class="chip" type="button">' + I('footprints') + 'Đi bộ</button><button class="chip" type="button">Viettel</button><button class="chip chip--lg" type="button">Chip lớn</button></div>' +
      '<div class="kit-row">' + ['success', 'warning', 'danger', 'info', 'neutral', 'primary', 'accent', 'solid'].map(function (v) { return ui.badge(v, v); }).join('') + ui.badge('3', 'count') + ui.demoBadge() + '</div>' +
      '<div class="kit-row">' + ui.signalBadge('likely') + ui.signalBadge('uncertain') + ui.signalBadge('lost') + '</div>' +
      '<div class="kit-row"><span class="pill pill--online"><span class="pill__dot"></span>Online</span><span class="pill pill--offline"><span class="pill__dot"></span>Offline</span><span class="pill pill--danger"><span class="pill__dot"></span>Quá hạn</span>' +
        '<span class="signal-dot signal-dot--likely"></span><span class="signal-dot signal-dot--uncertain"></span><span class="signal-dot signal-dot--lost"></span></div>');

    /* Forms */
    h += section('Forms', '.field .field__label .field__hint .field__error · .input .select .textarea · .check · .switch · .segmented',
      '<div class="kit-grid2">' +
        '<label class="field"><span class="field__label">Họ và tên <span class="req">*</span></span><input class="input" type="text" placeholder="Minh Anh"><span class="field__hint">Chỉ hiện ở lớp định danh.</span></label>' +
        '<label class="field"><span class="field__label">Nhóm máu</span><select class="select"><option>O+</option><option>A+</option><option>Không rõ</option></select></label>' +
        '<label class="field is-invalid"><span class="field__label">SĐT liên hệ</span><input class="input" type="tel" value="+84"><span class="field__error">Số điện thoại chưa hợp lệ</span></label>' +
        '<div class="field"><span class="field__label">Tìm kiếm</span><div class="input-group">' + I('search') + '<input class="input" type="search" placeholder="Trạm y tế, nhà thuốc…"></div></div>' +
      '</div>' +
      '<label class="field mt-3"><span class="field__label">Ghi chú</span><textarea class="textarea" placeholder="Dị ứng, bệnh nền…"></textarea></label>' +
      '<label class="check"><input type="checkbox" checked><span>Tôi đồng ý xử lý dữ liệu y tế nhạy cảm <small>Theo Nghị định 356/2025/NĐ-CP</small></span></label>' +
      '<label class="check"><input type="radio" name="' + id('r') + '" checked><span>Radio A</span></label>' +
      '<label class="check"><input type="radio" name="' + id('r') + '"><span>Radio B</span></label>' +
      '<div class="kit-row mt-2"><label class="switch"><input type="checkbox" checked><span class="switch__track"></span><span class="switch__label">Nhật ký cộng đồng</span></label>' +
        '<label class="switch switch--danger"><input type="checkbox" checked><span class="switch__track"></span><span class="switch__label">Giả lập mất sóng</span></label></div>' +
      '<div class="segmented mt-2" data-seg><button class="segmented__btn is-selected" type="button" data-value="shortest">' + I('route') + 'Ngắn nhất</button><button class="segmented__btn" type="button" data-value="signal">' + I('signal') + 'Nhiều sóng</button></div>');

    /* Navigation */
    h += section('Tabs · stepper', '.tabs .tab.is-active · .stepper__step.is-done/.is-current',
      '<div class="tabs mb-4" data-tabs><button class="tab is-active" type="button">' + I('hospital') + 'Y tế</button><button class="tab" type="button">' + I('pill') + 'Nhà thuốc</button><button class="tab" type="button">' + I('bed') + 'Chỗ nghỉ</button><button class="tab" type="button">' + I('wrench') + 'Sửa xe</button><button class="tab" type="button">' + I('fuel') + 'Nhiên liệu</button></div>' +
      '<ol class="stepper"><li class="stepper__step is-done">Bộ phận</li><li class="stepper__step is-done">Triệu chứng</li><li class="stepper__step is-current">Mức độ</li><li class="stepper__step">Kết quả</li></ol>');

    /* Lists, kv, stats */
    h += section('Lists · key/value · stats', '.list--card .list-item(__icon __body __title __meta __trail) · .kv · .stat-row',
      '<div class="list list--card mb-4">' +
        '<a class="list-item" href="#"><span class="list-item__icon icon-tile icon-tile--danger">' + I('hospital') + '</span><span class="list-item__body"><span class="list-item__title">Bệnh viện Đa khoa Đồng Văn</span><span class="list-item__meta">' + I('map-pin', 'icon--xs') + U.fmtKm(12.4) + ' · ' + ui.badge('Chấn thương', 'success') + '</span></span><span class="list-item__trail">' + I('chevron-right') + '</span></a>' +
        '<a class="list-item" href="#"><span class="list-item__icon icon-tile icon-tile--accent">' + I('fuel') + '</span><span class="list-item__body"><span class="list-item__title">Cây xăng Yên Minh</span><span class="list-item__meta">' + U.fmtKm(0.85) + ' · Đối tác</span></span><span class="list-item__trail">' + ui.badge('Đối tác', 'accent') + '</span></a>' +
        '<div class="list-item"><span class="list-item__icon icon-tile icon-tile--info">' + I('clock') + '</span><span class="list-item__body"><span class="list-item__title">Check-in tiếp theo</span><span class="list-item__meta">' + U.fmtDuration(80) + '</span></span></div>' +
      '</div>' +
      '<div class="kit-grid2"><div class="card"><dl class="kv"><div class="kv__row"><dt>Nhóm máu</dt><dd>O+</dd></div><div class="kv__row"><dt>Dị ứng</dt><dd>Penicillin</dd></div><div class="kv__row"><dt>Cập nhật</dt><dd>' + U.fmtDateTime(new Date()) + '</dd></div></dl></div>' +
      '<div class="card"><div class="stat-row stat-row--divided"><div class="stat"><span class="stat__value">82%</span><span class="stat__label">Độ chính xác</span><span class="stat__delta">+4%</span></div><div class="stat"><span class="stat__value">216</span><span class="stat__label">Điểm y tế</span></div><div class="stat"><span class="stat__value">3</span><span class="stat__label">Tuyến</span></div></div></div></div>');

    /* Icon tiles */
    h += section('Icon tiles', '.icon-tile (--primary --accent --danger --warning --info --success --neutral --solid) · --sm --lg --xl',
      '<div class="kit-row">' + [['primary', 'languages'], ['accent', 'backpack'], ['danger', 'heart-pulse'], ['warning', 'alert-triangle'], ['info', 'qr'], ['success', 'shield-check'], ['neutral', 'settings'], ['solid', 'map'], ['solid-danger', 'siren']].map(function (p) {
        return '<span class="icon-tile icon-tile--' + p[0] + '">' + I(p[1]) + '</span>';
      }).join('') + '<span class="icon-tile icon-tile--sm">' + I('pill') + '</span><span class="icon-tile icon-tile--lg">' + I('cross') + '</span><span class="icon-tile icon-tile--xl icon-tile--accent">' + I('mountain') + '</span></div>' +
      '<div class="grid grid--tiles">' + [['primary', 'languages', 'Dịch y tế'], ['info', 'map', 'Bản đồ'], ['accent', 'qr', 'Hồ sơ QR'], ['success', 'shield-check', 'Buddy']].map(function (p) {
        return '<a class="card card--interactive text-center" href="#"><span class="icon-tile icon-tile--lg icon-tile--' + p[0] + '">' + I(p[1]) + '</span><p class="fw-700 mt-2 m-0">' + p[2] + '</p></a>';
      }).join('') + '</div>');

    /* Progress */
    h += section('Progress · ring · skeleton · spinner', '.progress .progress__bar · .ring · .skeleton · .spinner',
      '<div class="stack"><div class="progress"><div class="progress__bar" style="width:64%"></div></div><div class="progress progress--accent progress--lg"><div class="progress__bar" style="width:38%"></div></div><div class="progress is-indeterminate progress--sm"><div class="progress__bar"></div></div>' +
      '<div class="kit-row">' + ring(0.72, '72%', '') + ring(0.35, '35%', 'ring--danger') + ring(1, '100%', 'ring--success') + '<span class="spinner"></span></div>' +
      '<div class="card"><div class="cluster cluster--nowrap"><span class="skeleton skeleton--circle"></span><div class="w-full"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span><span class="skeleton skeleton--text" style="width:70%"></span></div></div></div></div>');

    /* Empty + disclaimer */
    h += section('Empty state · medical disclaimer', 'NC.ui.emptyState({…}) · NC.ui.disclaimer() · NC.ui.disclaimer({compact:true})',
      '<div class="card">' + ui.emptyState({ illustration: true, title: 'Chưa tải gói dữ liệu', text: 'Tải gói hành lang tuyến để dùng bản đồ khi mất sóng.', action: { label: 'Tải gói', icon: 'download' } }) + '</div>' +
      '<div class="card mt-3">' + ui.emptyState({ icon: 'history', title: 'Chưa có check-in', text: 'Lịch sử check-in sẽ hiện ở đây.' }) + '</div>' +
      '<div class="stack mt-3">' + ui.disclaimer() + ui.disclaimer({ compact: true }) + '</div>');

    /* Table */
    h += section('Table', '.table in .table-wrap — becomes cards under 768px (add data-label on each <td>)',
      '<div class="card card--pad-0"><div class="table-wrap"><table class="table"><thead><tr><th>Cơ sở</th><th>Loại</th><th class="num">Khoảng cách</th><th>Xác thực</th></tr></thead><tbody>' +
        row('Trạm y tế xã Lũng Cú', 'Trạm y tế', 2.4, ui.badge('12/09/2026', 'success')) +
        row('Nhà thuốc Đồng Văn', 'Nhà thuốc', 0.6, ui.badge('Cũ > 90 ngày', 'warning')) +
        row('Bệnh viện Đa khoa Mèo Vạc', 'Bệnh viện', 18.2, ui.badge('03/08/2026', 'success')) +
      '</tbody></table></div></div>');

    /* Overlays */
    h += section('Overlays · feedback', 'NC.ui.sheet · modal · confirm · toast (opened at page level)',
      '<div class="kit-row">' +
        '<button class="btn btn--primary" type="button" data-kit="sheet">' + I('layers') + '<span>Sheet</span></button>' +
        '<button class="btn btn--outline" type="button" data-kit="modal">Modal</button>' +
        '<button class="btn btn--outline" type="button" data-kit="confirm">Confirm (danger)</button>' +
        '<button class="btn btn--soft" type="button" data-kit="toast-info">Toast info</button>' +
        '<button class="btn btn--soft" type="button" data-kit="toast-success">Toast success</button>' +
        '<button class="btn btn--soft" type="button" data-kit="toast-warning">Toast warning</button>' +
        '<button class="btn btn--soft" type="button" data-kit="toast-danger">Toast danger</button>' +
        '<button class="btn btn--ghost" type="button" data-call="+84 000 000 015">' + I('phone') + '<span>Demo call</span></button>' +
      '</div>');

    /* Icons */
    var names = NC.icons.list();
    h += section('Icons (' + names.length + ')', 'NC.ui.icon(name) — Lucide-style 24×24 sprite, id prefix i-',
      '<div class="kit-icons">' + names.map(function (n) { return '<div class="kit-icon">' + I(n) + '<span>' + esc(n) + '</span></div>'; }).join('') + '</div>');
    return h;
  }

  function ring(v, label, cls) {
    var r = 26, c = 2 * Math.PI * r;
    return '<span class="ring ' + cls + '" style="width:64px;height:64px"><svg width="64" height="64" viewBox="0 0 64 64"><circle class="ring__track" cx="32" cy="32" r="' + r + '" stroke-width="7"/><circle class="ring__value" cx="32" cy="32" r="' + r + '" stroke-width="7" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - v)).toFixed(2) + '"/></svg><span class="ring__label" style="font-size:13px">' + label + '</span></span>';
  }
  function row(name, type, km, badge) {
    return '<tr><td class="table__primary" data-label="Cơ sở">' + esc(name) + '</td><td data-label="Loại">' + esc(type) + '</td><td class="num" data-label="Khoảng cách">' + U.fmtKm(km) + '</td><td data-label="Xác thực">' + badge + '</td></tr>';
  }

  function fillSwatches(pane) {
    var box = pane.querySelector('[data-swatches]');
    if (!box) return;
    var cs = getComputedStyle(pane);
    box.innerHTML = COLOR_TOKENS.map(function (tk) {
      var v = cs.getPropertyValue(tk).trim();
      return '<div class="kit-swatch"><div class="kit-swatch__chip" style="background:var(' + tk + ')"></div><div class="kit-swatch__meta"><b>' + esc(tk) + '</b><span>' + esc(v.length > 26 ? 'gradient' : v) + '</span></div></div>';
    }).join('');
  }

  function render() {
    U.$$('[data-kit-pane]').forEach(function (pane) {
      var theme = pane.getAttribute('data-kit-pane');
      pane.innerHTML = gallery(theme);
      fillSwatches(pane);
      var hold = pane.querySelector('#k-' + theme + '-hold');
      ui.holdToConfirm(hold, 1200, function () { ui.toast('SOS demo — đã xác nhận (không gửi thật)', { type: 'success' }); });
      U.$$('[data-seg]', pane).forEach(function (s) { ui.segmented(s); });
      U.$$('[data-chips], [data-tabs]', pane).forEach(function (g) {
        g.addEventListener('click', function (e) {
          var b = e.target.closest('.chip, .tab'); if (!b) return;
          U.$$('.chip, .tab', g).forEach(function (x) { x.classList.toggle(x.classList.contains('tab') ? 'is-active' : 'is-selected', x === b); });
        });
      });
    });
  }

  function demoSheet() {
    ui.sheet({
      title: 'Bottom sheet', subtitle: 'Vuốt xuống để đóng (mobile) · ESC · chạm nền', icon: 'layers',
      body: '<p>Nội dung sheet. Trên mobile là bottom sheet, từ 768px là hộp thoại giữa màn hình.</p>' + ui.disclaimer({ compact: true }),
      actions: [{ label: t('common.cancel'), variant: 'ghost' }, {
        label: 'Lưu (async)', variant: 'primary', icon: 'check',
        onClick: function () { return U.sleep(900).then(function () { ui.toast('Đã lưu', { type: 'success' }); }); }
      }]
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-kit]') : null;
    if (!b) { if (e.target.closest && e.target.closest('a[href="#"]')) e.preventDefault(); return; }
    var k = b.getAttribute('data-kit');
    if (k === 'sheet') demoSheet();
    else if (k === 'modal') ui.modal({ title: 'Modal', body: '<p>Luôn ở giữa màn hình, mọi kích thước.</p>', size: 'sm', actions: [{ label: t('common.close'), variant: 'primary' }] });
    else if (k === 'confirm') ui.confirm({ title: 'Xoá toàn bộ dữ liệu?', message: 'Hồ sơ y tế, lịch sử Buddy và hàng đợi sẽ bị xoá vĩnh viễn khỏi máy này.', confirmLabel: 'Xoá hết', danger: true }).then(function (ok) { ui.toast(ok ? 'Đã xác nhận' : 'Đã huỷ', { type: ok ? 'danger' : 'info' }); });
    else if (k.indexOf('toast-') === 0) {
      var type = k.slice(6);
      ui.toast({ info: 'Đang tải gói Hà Giang Loop…', success: 'Đã tải gói dữ liệu v3 (1,4 MB)', warning: 'Sắp vào vùng mất sóng trong 4 phút', danger: 'Quá hạn check-in — đã gửi cảnh báo' }[type], {
        type: type, action: type === 'warning' ? { label: 'Gửi vị trí', onClick: function () {} } : null
      });
    }
  });

  function setPageTheme(th) {
    document.documentElement.setAttribute('data-theme', th);
  }

  function init() {
    NC.settings.load().then(function () {
      var l = NC.settings.get('lang') || 'vi';
      NC.i18n.setLang(l, { persist: false, force: true });
      render();
    });
    var seg = document.getElementById('kit-page-theme');
    var initial = U.qs().theme === 'dark' ? 'dark' : 'light';
    setPageTheme(initial);
    ui.segmented(seg, { value: initial, onChange: setPageTheme });
    document.getElementById('kit-lang').addEventListener('click', function () {
      NC.i18n.setLang(NC.i18n.lang() === 'vi' ? 'en' : 'vi', { persist: false });
      document.querySelector('#kit-lang .lang-toggle__code').textContent = NC.i18n.lang().toUpperCase();
      render();
    });
  }
  init();
})(window.NC = window.NC || {});
