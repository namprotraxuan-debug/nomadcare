/*
 * facilities.js — Admin "Điểm y tế" page (owner: P2 admin-core). Registers NC.admin page 'facilities'.
 * Medical facilities: status chips, filters (route/type/status/stale/search), sortable table or map view, edit drawer with
 * the 10-field verification checklist (PDF 8.1), mini-map coordinate picker, "Xác thực hôm nay", create/delete, handling of
 * {code:'incomplete', missing}. Tab 2: non-medical services & partners (lodging/repair/fuel/rental).
 * Deep links: #/facilities?status=pending|verified|rejected&stale=1&route=&type=&q=&view=map&edit=<id>&new=1&tab=services
 * Also exposes NC.admin.facilities = {edit(id), create(prefill)} for other admin pages (e.g. community approvals).
 */
(function (NC) {
  'use strict';

  var U = NC.util, h = U.h, $ = U.$, $$ = U.$$;
  var A = NC.admin;
  function t(k, v) { return NC.i18n.t(k, v); }
  function icon(n, c) { return NC.ui.icon(n, c); }

  var TYPES = ['tram_y_te', 'phong_kham', 'benh_vien', 'nha_thuoc'];
  var SVC_TYPES = ['lodging', 'repair', 'fuel', 'rental'];
  var TYPE_ICON = { tram_y_te: 'cross', phong_kham: 'stethoscope', benh_vien: 'hospital', nha_thuoc: 'pill', lodging: 'bed', repair: 'wrench', fuel: 'fuel', rental: 'bike' };
  /** The 10 verification items of PDF 8.1 (coordinates = lat + lng). */
  var CHECK = [
    { key: 'name', fields: ['name'] }, { key: 'address', fields: ['address'] }, { key: 'coords', fields: ['lat', 'lng'] },
    { key: 'type', fields: ['type'] }, { key: 'open_hours', fields: ['open_hours'] }, { key: 'night_shift', fields: ['night_shift'] },
    { key: 'trauma_capable', fields: ['trauma_capable'] }, { key: 'phone', fields: ['phone'] }, { key: 'verified_by', fields: ['verified_by'] },
    { key: 'verified_at', fields: ['verified_at'] }
  ];

  NC.i18n.add({
    vi: {
      'ad.fac.title': 'Điểm y tế', 'ad.fac.nav': 'Điểm y tế',
      'ad.fac.head': 'Điểm y tế & dịch vụ dọc tuyến',
      'ad.fac.sub': 'Một điểm y tế chỉ được phát hành cho người dùng khi đủ 10 trường xác thực (mục 8.1). Chu kỳ tái xác thực 90 ngày — điểm quá hạn vẫn hiển thị kèm ngày xác thực gần nhất.',
      'ad.fac.tab_fac': 'Điểm y tế', 'ad.fac.tab_svc': 'Dịch vụ & đối tác',
      'ad.fac.add': 'Thêm điểm y tế', 'ad.fac.add_svc': 'Thêm dịch vụ',
      'ad.fac.chip_all': 'Tất cả', 'ad.fac.chip_stale': 'Quá hạn > 90 ngày',
      'ad.fac.search_ph': 'Tìm tên, địa chỉ hoặc mã…', 'ad.fac.all_routes': 'Mọi cung đường', 'ad.fac.all_types': 'Mọi loại hình',
      'ad.fac.view_table': 'Bảng', 'ad.fac.view_map': 'Bản đồ', 'ad.fac.view': 'Kiểu xem',
      'ad.fac.count': '{n} điểm', 'ad.fac.count_svc': '{n} dịch vụ',
      'ad.fac.col_name': 'Cơ sở', 'ad.fac.col_type': 'Loại hình', 'ad.fac.col_route': 'Cung đường', 'ad.fac.col_status': 'Trạng thái',
      'ad.fac.col_verified': 'Xác thực', 'ad.fac.col_caps': 'Năng lực', 'ad.fac.col_complete': 'Hồ sơ', 'ad.fac.col_actions': 'Thao tác',
      'ad.fac.col_type_route': 'Loại · tuyến', 'ad.fac.col_partner': 'Đối tác', 'ad.fac.col_phone': 'Điện thoại', 'ad.fac.col_hours': 'Giờ mở cửa',
      'ad.fac.days_ago': '{n} ngày trước', 'ad.fac.never_verified': 'Chưa xác thực',
      'ad.fac.edit': 'Sửa', 'ad.fac.edit_title': 'Sửa điểm y tế', 'ad.fac.new_title': 'Thêm điểm y tế',
      'ad.fac.new_sub': 'Điểm mới ở trạng thái chờ cho tới khi đủ 10 trường xác thực.',
      'ad.fac.complete_n': '{n}/10 trường',
      'ad.fac.sec_info': 'Thông tin cơ sở', 'ad.fac.sec_contact': 'Liên hệ & năng lực', 'ad.fac.sec_loc': 'Vị trí', 'ad.fac.sec_verify': 'Xác thực & trạng thái',
      'ad.fac.f.name': 'Tên cơ sở', 'ad.fac.f.type': 'Loại hình', 'ad.fac.f.address': 'Địa chỉ', 'ad.fac.f.lat': 'Vĩ độ', 'ad.fac.f.lng': 'Kinh độ',
      'ad.fac.f.coords': 'Toạ độ', 'ad.fac.f.phone': 'Số điện thoại gọi thông', 'ad.fac.f.open_hours': 'Giờ mở cửa', 'ad.fac.f.night_shift': 'Có trực đêm',
      'ad.fac.f.trauma_capable': 'Xử lý được chấn thương chảy máu', 'ad.fac.f.verified_by': 'Tên người trả lời', 'ad.fac.f.verified_at': 'Ngày xác thực',
      'ad.fac.f.route_id': 'Cung đường', 'ad.fac.f.status': 'Trạng thái', 'ad.fac.f.notes': 'Ghi chú nội bộ', 'ad.fac.f.source': 'Nguồn',
      'ad.fac.f.is_partner': 'Đối tác phi y tế', 'ad.fac.f.commission_rate': 'Tỷ lệ chi kênh (%)',
      'ad.fac.h.name': 'Tên chính thức, ví dụ “Trạm y tế xã Lũng Cú”.',
      'ad.fac.h.phone': 'Số đã gọi thử và có người nghe máy.',
      'ad.fac.h.verified_by': 'Người đã trả lời cuộc gọi xác thực (chức danh + tên).',
      'ad.fac.h.route': 'Bắt buộc khi tạo mới — quyết định gói dữ liệu nào chứa điểm này.',
      'ad.fac.h.map': 'Nhấn lên bản đồ hoặc kéo ghim để đặt toạ độ.',
      'ad.fac.h.notes': 'Không hiển thị cho người dùng.',
      'ad.fac.unknown': 'Chưa rõ', 'ad.fac.yes': 'Có', 'ad.fac.no': 'Không',
      'ad.fac.hours_247': '24/7', 'ad.fac.hours_day': '07:00–17:00',
      'ad.fac.verify_today': 'Xác thực hôm nay', 'ad.fac.verify_today_done': 'Đã điền ngày hôm nay — kiểm tra đủ 10 trường rồi lưu.',
      'ad.fac.check_title': 'Điều kiện xác thực', 'ad.fac.check_ok': 'Đủ 10 trường — có thể đặt “Đã xác thực” và phát hành.',
      'ad.fac.check_missing': 'Còn thiếu {n} trường — bản ghi sẽ ở trạng thái chờ, không phát hành cho người dùng.',
      'ad.fac.c.name': 'Tên', 'ad.fac.c.address': 'Địa chỉ', 'ad.fac.c.coords': 'Toạ độ', 'ad.fac.c.type': 'Loại hình', 'ad.fac.c.open_hours': 'Giờ mở cửa',
      'ad.fac.c.night_shift': 'Trực đêm', 'ad.fac.c.trauma_capable': 'Chấn thương', 'ad.fac.c.phone': 'Điện thoại', 'ad.fac.c.verified_by': 'Người trả lời', 'ad.fac.c.verified_at': 'Ngày xác thực',
      'ad.fac.err_incomplete': 'Chưa thể đặt “Đã xác thực”: thiếu {fields}.',
      'ad.fac.err_required': 'Nhập {fields} trước khi lưu.',
      'ad.fac.err_coords': 'Toạ độ không hợp lệ (vĩ độ −90…90, kinh độ −180…180).',
      'ad.fac.err_outside_vn': 'Toạ độ phải nằm trong Việt Nam (vĩ độ 8,1–23,5 · kinh độ 102,1–109,6). Kiểm tra xem có đảo vĩ độ/kinh độ không.',
      'ad.fac.err_future': 'Ngày xác thực không được ở tương lai.',
      'ad.fac.err_date': 'Ngày xác thực không hợp lệ.',
      'ad.fac.err_route': 'Chọn cung đường — điểm y tế không có cung sẽ không bao giờ vào gói offline.',
      'ad.fac.saved': 'Đã lưu “{name}”', 'ad.fac.republish': 'Phát hành lại gói',
      'ad.fac.saved_hint': 'Gói offline đã phát hành là bản chụp — phát hành lại để thiết bị nhận thay đổi.',
      'ad.fac.delete_q': 'Xoá “{name}”?', 'ad.fac.delete_msg': 'Bản ghi bị xoá khỏi cơ sở dữ liệu (ghi vào nhật ký). Gói đã phát hành vẫn chứa điểm này cho tới lần phát hành sau.',
      'ad.fac.deleted': 'Đã xoá “{name}”',
      'ad.fac.source_team': 'Nhóm thu thập', 'ad.fac.source_community': 'Cộng đồng',
      'ad.fac.created': 'Tạo {date}', 'ad.fac.updated': 'Sửa {date}',
      'ad.fac.not_found': 'Không tìm thấy điểm y tế {id}.',
      'ad.fac.map_hint': 'Nhấn một điểm để mở hồ sơ. Viền vàng = quá hạn xác thực.',
      'ad.fac.no_coords': '{n} điểm chưa có toạ độ không hiện trên bản đồ.',
      'ad.fac.order_note': 'Người dùng luôn thấy điểm y tế theo khoảng cách và năng lực đã xác thực — không có thứ hạng tài trợ. Chỉ dịch vụ phi y tế mới có nhãn “Đối tác”.',
      'ad.fac.svc_sub': 'Lưu trú, sửa xe, xăng dầu, thuê xe dọc tuyến. Nhãn “Đối tác” chỉ áp dụng cho dịch vụ phi y tế.',
      'ad.fac.svc_edit': 'Sửa dịch vụ', 'ad.fac.svc_new': 'Thêm dịch vụ',
      'ad.fac.svc_active': 'Đang hoạt động', 'ad.fac.svc_inactive': 'Ngừng',
      'ad.fac.partner': 'Đối tác', 'ad.fac.csv_name': 'nomadcare-diem-y-te.csv', 'ad.fac.csv_svc': 'nomadcare-dich-vu.csv',
      'ad.fac.unsaved': 'Bỏ các thay đổi chưa lưu?'
    },
    en: {
      'ad.fac.title': 'Medical facilities', 'ad.fac.nav': 'Facilities',
      'ad.fac.head': 'Medical facilities & roadside services',
      'ad.fac.sub': 'A facility is published to travellers only when all 10 verification fields are complete (section 8.1). Re-verification every 90 days — overdue facilities stay visible with their last verification date.',
      'ad.fac.tab_fac': 'Medical facilities', 'ad.fac.tab_svc': 'Services & partners',
      'ad.fac.add': 'Add facility', 'ad.fac.add_svc': 'Add service',
      'ad.fac.chip_all': 'All', 'ad.fac.chip_stale': 'Overdue > 90 days',
      'ad.fac.search_ph': 'Search name, address or ID…', 'ad.fac.all_routes': 'All routes', 'ad.fac.all_types': 'All types',
      'ad.fac.view_table': 'Table', 'ad.fac.view_map': 'Map', 'ad.fac.view': 'View',
      'ad.fac.count': '{n} facilities', 'ad.fac.count_svc': '{n} services',
      'ad.fac.col_name': 'Facility', 'ad.fac.col_type': 'Type', 'ad.fac.col_route': 'Route', 'ad.fac.col_status': 'Status',
      'ad.fac.col_verified': 'Verified', 'ad.fac.col_caps': 'Capability', 'ad.fac.col_complete': 'Record', 'ad.fac.col_actions': 'Actions',
      'ad.fac.col_type_route': 'Type · route', 'ad.fac.col_partner': 'Partner', 'ad.fac.col_phone': 'Phone', 'ad.fac.col_hours': 'Opening hours',
      'ad.fac.days_ago': '{n} days ago', 'ad.fac.never_verified': 'Not verified',
      'ad.fac.edit': 'Edit', 'ad.fac.edit_title': 'Edit facility', 'ad.fac.new_title': 'Add facility',
      'ad.fac.new_sub': 'New facilities stay pending until all 10 verification fields are complete.',
      'ad.fac.complete_n': '{n}/10 fields',
      'ad.fac.sec_info': 'Facility', 'ad.fac.sec_contact': 'Contact & capability', 'ad.fac.sec_loc': 'Location', 'ad.fac.sec_verify': 'Verification & status',
      'ad.fac.f.name': 'Facility name', 'ad.fac.f.type': 'Type', 'ad.fac.f.address': 'Address', 'ad.fac.f.lat': 'Latitude', 'ad.fac.f.lng': 'Longitude',
      'ad.fac.f.coords': 'Coordinates', 'ad.fac.f.phone': 'Working phone number', 'ad.fac.f.open_hours': 'Opening hours', 'ad.fac.f.night_shift': 'Night shift',
      'ad.fac.f.trauma_capable': 'Treats bleeding trauma', 'ad.fac.f.verified_by': 'Person who answered', 'ad.fac.f.verified_at': 'Verification date',
      'ad.fac.f.route_id': 'Route', 'ad.fac.f.status': 'Status', 'ad.fac.f.notes': 'Internal notes', 'ad.fac.f.source': 'Source',
      'ad.fac.f.is_partner': 'Non-medical partner', 'ad.fac.f.commission_rate': 'Channel fee (%)',
      'ad.fac.h.name': 'Official name, e.g. “Lung Cu commune health station”.',
      'ad.fac.h.phone': 'A number that was called and answered.',
      'ad.fac.h.verified_by': 'Who answered the verification call (role + name).',
      'ad.fac.h.route': 'Required for new records — decides which data pack contains it.',
      'ad.fac.h.map': 'Click the map or drag the pin to set the coordinates.',
      'ad.fac.h.notes': 'Never shown to travellers.',
      'ad.fac.unknown': 'Unknown', 'ad.fac.yes': 'Yes', 'ad.fac.no': 'No',
      'ad.fac.hours_247': '24/7', 'ad.fac.hours_day': '07:00–17:00',
      'ad.fac.verify_today': 'Verified today', 'ad.fac.verify_today_done': 'Today’s date filled in — check all 10 fields, then save.',
      'ad.fac.check_title': 'Verification requirements', 'ad.fac.check_ok': 'All 10 fields complete — can be set to “Verified” and published.',
      'ad.fac.check_missing': '{n} fields missing — the record stays pending and is not published to travellers.',
      'ad.fac.c.name': 'Name', 'ad.fac.c.address': 'Address', 'ad.fac.c.coords': 'Coordinates', 'ad.fac.c.type': 'Type', 'ad.fac.c.open_hours': 'Hours',
      'ad.fac.c.night_shift': 'Night shift', 'ad.fac.c.trauma_capable': 'Trauma', 'ad.fac.c.phone': 'Phone', 'ad.fac.c.verified_by': 'Answered by', 'ad.fac.c.verified_at': 'Date',
      'ad.fac.err_incomplete': 'Cannot set “Verified” yet: missing {fields}.',
      'ad.fac.err_required': 'Fill in {fields} before saving.',
      'ad.fac.err_coords': 'Invalid coordinates (latitude −90…90, longitude −180…180).',
      'ad.fac.err_outside_vn': 'Coordinates must be inside Vietnam (latitude 8.1–23.5 · longitude 102.1–109.6). Check that latitude and longitude are not swapped.',
      'ad.fac.err_future': 'The verification date cannot be in the future.',
      'ad.fac.err_date': 'Invalid verification date.',
      'ad.fac.err_route': 'Pick a route — a facility without a route never reaches an offline pack.',
      'ad.fac.saved': 'Saved “{name}”', 'ad.fac.republish': 'Republish pack',
      'ad.fac.saved_hint': 'Published offline packs are snapshots — republish so devices get the change.',
      'ad.fac.delete_q': 'Delete “{name}”?', 'ad.fac.delete_msg': 'The record is removed from the database (logged in the audit trail). Published packs keep it until the next release.',
      'ad.fac.deleted': 'Deleted “{name}”',
      'ad.fac.source_team': 'Team survey', 'ad.fac.source_community': 'Community',
      'ad.fac.created': 'Created {date}', 'ad.fac.updated': 'Edited {date}',
      'ad.fac.not_found': 'Facility {id} was not found.',
      'ad.fac.map_hint': 'Click a marker to open the record. Amber ring = re-verification due.',
      'ad.fac.no_coords': '{n} facilities without coordinates are not on the map.',
      'ad.fac.order_note': 'Travellers always see facilities by distance and verified capability — there is no sponsored ranking. Only non-medical services can carry a “Partner” badge.',
      'ad.fac.svc_sub': 'Lodging, bike repair, fuel and rentals along the routes. The “Partner” badge applies to non-medical services only.',
      'ad.fac.svc_edit': 'Edit service', 'ad.fac.svc_new': 'Add service',
      'ad.fac.svc_active': 'Active', 'ad.fac.svc_inactive': 'Inactive',
      'ad.fac.partner': 'Partner', 'ad.fac.csv_name': 'nomadcare-facilities.csv', 'ad.fac.csv_svc': 'nomadcare-services.csv',
      'ad.fac.unsaved': 'Discard unsaved changes?'
    }
  });

  /* ------------------------------------------------------------------ helpers */
  function blank(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !isFinite(v)); }
  function missingFields(f) {
    var sh = NC.backend && NC.backend.shared;
    if (sh && typeof sh.facilityMissing === 'function') return sh.facilityMissing(f);
    return ['name', 'address', 'lat', 'lng', 'type', 'open_hours', 'night_shift', 'trauma_capable', 'phone', 'verified_by', 'verified_at'].filter(function (k) { return blank(f[k]); });
  }
  function checkState(f) {
    var miss = missingFields(f);
    return CHECK.map(function (c) { return { key: c.key, ok: c.fields.every(function (k) { return miss.indexOf(k) < 0; }) }; });
  }
  function completeCount(f) { return checkState(f).filter(function (c) { return c.ok; }).length; }
  function todayIso() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  /* Same box as the server (backend-local VN_BBOX / admin_upsert_facility 'invalid_coordinates' detail outside_vietnam). */
  var VN_BBOX = { south: 8.1, north: 23.5, west: 102.1, east: 109.6 };
  function inVietnam(lat, lng) { return lat >= VN_BBOX.south && lat <= VN_BBOX.north && lng >= VN_BBOX.west && lng <= VN_BBOX.east; }
  /** '' when the verification date is acceptable, else an error text (server: 'invalid_date'). */
  function dateError(v) {
    if (!v) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')) || v < '2000-01-01') return t('ad.fac.err_date');
    return v > todayIso() ? t('ad.fac.err_future') : '';
  }
  function daysSince(f) { return f.days_since_verified !== undefined && f.days_since_verified !== null ? f.days_since_verified : (f.verified_at ? U.daysSince(f.verified_at) : null); }
  function fieldLabels(list) {
    var seen = {};
    return list.map(function (k) { var key = (k === 'lat' || k === 'lng') ? 'coords' : k; if (seen[key]) return null; seen[key] = 1; return t('ad.fac.c.' + key); }).filter(Boolean).join(', ');
  }
  function routeOptions() { return A.routes().map(function (r) { return { value: r.id, label: A.routeName(r.id, { short: true }) }; }); }

  /* ------------------------------------------------------------------ state */
  var root = null, els = {};
  var S = {
    tab: 'fac', rows: [], svcs: [], filters: { status: '', stale: false, route: '', type: '', q: '' }, view: 'table',
    visible: false, seq: 0, map: null, mapLayer: null, openId: null, drawer: null, loaded: false, loading: false, pendingEdit: null
  };

  /* ------------------------------------------------------------------ mount */
  function mount(section) {
    root = section;
    root.classList.add('ad-fac');
    els.head = h('div');
    els.tabs = h('div', { class: 'tabs ad-fac-tabs', role: 'tablist' });
    els.chips = h('div', { class: 'chip-group chip-group--scroll ad-fac-chips', role: 'group' });
    els.filter = h('div', { class: 'ad-filter ad-fac-filter' });
    els.toolbar = h('div', { class: 'ad-toolbar' });
    els.body = h('div', { class: 'ad-fac-body' });
    els.note = h('p', { class: 'ad-muted-note ad-fac-note' });
    root.appendChild(els.head);
    root.appendChild(els.tabs);
    root.appendChild(els.chips);
    root.appendChild(els.filter);
    root.appendChild(els.toolbar);
    root.appendChild(els.body);
    root.appendChild(els.note);
    buildStatic();

    els.table = A.table({
      columns: facColumns(), rows: [], sortKey: 'name', pageSize: 20, onRow: function (row) { openEditor(row.id); },
      rowClass: function (r) { return r.is_stale && r.status === 'verified' ? 'ad-fac-row--stale' : ''; },
      caption: t('ad.fac.title')
    });
    els.svcTable = A.table({ columns: svcColumns(), rows: [], sortKey: 'name', pageSize: 20, onRow: function (row) { openService(row.id); }, caption: t('ad.fac.tab_svc') });

    root.addEventListener('click', onClick);
    A.live(function (msg) {
      if (!msg) return;
      if (msg.table === 'facilities' || msg.table === 'services' || msg.table === '*') reload();
    });
    NC.bus.on('i18n:change', function () {
      if (!root) return;
      buildStatic();
      els.table = rebuildTable(els.table, facColumns(), function (row) { openEditor(row.id); }, 'fac');
      els.svcTable = rebuildTable(els.svcTable, svcColumns(), function (row) { openService(row.id); }, 'svc');
      render();
    });
  }

  function rebuildTable(old, cols, onRow, kind) {
    var tb = A.table({
      columns: cols, rows: [], sortKey: old.state.key, sortDir: old.state.dir, pageSize: 20, onRow: onRow,
      rowClass: kind === 'fac' ? function (r) { return r.is_stale && r.status === 'verified' ? 'ad-fac-row--stale' : ''; } : null
    });
    return tb;
  }

  function buildStatic() {
    els.head.innerHTML = '';
    var exportBtn = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-fac-action': 'csv', html: icon('download') + '<span>' + U.esc(t('ad.core.export_csv')) + '</span>' });
    var addBtn = h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-fac-action': 'add', html: icon('plus') + '<span>' + U.esc(t(S.tab === 'svc' ? 'ad.fac.add_svc' : 'ad.fac.add')) + '</span>' });
    els.head.appendChild(A.pageHead({
      icon: 'hospital', title: t('ad.fac.head'), sub: t(S.tab === 'svc' ? 'ad.fac.svc_sub' : 'ad.fac.sub'),
      meta: [NC.ui.demoBadge()], actions: [exportBtn, addBtn]
    }));
    els.tabs.innerHTML = '';
    [['fac', 'hospital', 'ad.fac.tab_fac'], ['svc', 'bed', 'ad.fac.tab_svc']].forEach(function (tb) {
      els.tabs.appendChild(h('button', { type: 'button', class: 'tab' + (S.tab === tb[0] ? ' is-active' : ''), role: 'tab', 'aria-selected': S.tab === tb[0] ? 'true' : 'false', 'data-fac-tab': tb[0], html: icon(tb[1]) + '<span>' + U.esc(t(tb[2])) + '</span>' }));
    });
    buildFilter();
    els.note.innerHTML = icon('info') + '<span>' + U.esc(t('ad.fac.order_note')) + '</span>';
  }

  function buildFilter() {
    var f = S.filters;
    els.filter.innerHTML = '';
    var search = h('label', { class: 'input-group ad-filter__search' },
      h('span', { class: 'visually-hidden' }, t('ad.core.search')),
      NC.ui.iconEl('search'),
      h('input', { class: 'input', type: 'search', 'data-filter': 'q', value: f.q || '', placeholder: t('ad.fac.search_ph'), autocomplete: 'off', enterkeyhint: 'search' }));
    els.filter.appendChild(search);
    var rs = A.select({ label: t('ad.fac.col_route'), value: f.route, all: t('ad.fac.all_routes'), options: routeOptions() });
    rs.setAttribute('data-filter', 'route');
    els.filter.appendChild(rs);
    var types = S.tab === 'svc' ? SVC_TYPES : TYPES;
    var ts = A.select({ label: t('ad.fac.col_type'), value: f.type, all: t('ad.fac.all_types'), options: types.map(function (ty) { return { value: ty, label: S.tab === 'svc' ? A.svcType(ty) : A.facType(ty) }; }) });
    ts.setAttribute('data-filter', 'type');
    els.filter.appendChild(ts);
    var seg = h('div', { class: 'segmented ad-fac-view', 'aria-label': t('ad.fac.view') },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'table', html: icon('list') + '<span>' + U.esc(t('ad.fac.view_table')) + '</span>' }),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'map', html: icon('map') + '<span>' + U.esc(t('ad.fac.view_map')) + '</span>' }));
    els.filter.appendChild(seg);
    NC.ui.segmented(seg, { value: S.view, onChange: function (v) { S.view = v; syncUrl(); render(); } });
    var qIn = els.filter.querySelector('[data-filter="q"]');
    qIn.addEventListener('input', U.debounce(function () { S.filters.q = qIn.value.trim(); syncUrl(); render(); }, 200));
    [rs, ts].forEach(function (sel) {
      sel.addEventListener('change', function () { S.filters[sel.getAttribute('data-filter')] = sel.value; syncUrl(); render(); });
    });
  }

  /* ------------------------------------------------------------------ columns */
  function capIcons(f) {
    var wrap = h('span', { class: 'ad-cell-icons' });
    [['night_shift', 'moon'], ['trauma_capable', 'bandage']].forEach(function (c) {
      var v = f[c[0]];
      var cls = v === true ? 'ad-cap ad-cap--yes' : v === false ? 'ad-cap ad-cap--no' : 'ad-cap ad-cap--unknown';
      var label = t('ad.fac.f.' + c[0]) + ': ' + (v === true ? t('ad.fac.yes') : v === false ? t('ad.fac.no') : t('ad.fac.unknown'));
      wrap.appendChild(h('span', { class: cls, title: label, 'aria-label': label, role: 'img', html: icon(c[1]) }));
    });
    return wrap;
  }
  function facColumns() {
    return [
      {
        key: 'name', label: t('ad.fac.col_name'), sort: true, primary: true, mobileLabel: '',
        render: function (f) {
          return h('span', { class: 'ad-cell-flex ad-fac-namecell' },
            h('span', { class: 'icon-tile icon-tile--sm ad-fac-typeicon ad-fac-typeicon--' + (f.type || 'none'), html: icon(TYPE_ICON[f.type] || 'map-pin') }),
            h('span', { class: 'ad-fac-namebody' }, h('span', { class: 'ad-cell-title' }, f.name || '—'), h('span', { class: 'ad-cell-sub ad-fac-addr', title: f.address || null }, f.address || f.id)));
        }
      },
      {
        key: 'type', label: t('ad.fac.col_type_route'), mobileLabel: t('ad.fac.col_type'), sort: function (f) { return A.facType(f.type); },
        render: function (f) {
          return h('span', null, h('span', { class: 'ad-cell-title nowrap' + (f.type ? '' : ' muted') }, f.type ? A.facType(f.type) : '—'),
            h('span', { class: 'ad-cell-sub nowrap' }, A.routeName(f.route_id, { short: true })));
        }
      },
      {
        key: 'status', label: t('ad.fac.col_status'), sort: function (f) { return ({ verified: 0, pending: 1, rejected: 2 })[f.status]; },
        render: function (f) {
          var w = h('span', { class: 'ad-cell-icons ad-fac-status' }, A.statusBadge(f.status));
          if (f.status === 'verified' && f.is_stale) w.appendChild(A.statusBadge('stale'));
          return w;
        }
      },
      {
        key: 'verified_at', label: t('ad.fac.col_verified'), sort: true,
        render: function (f) {
          if (!f.verified_at) return h('span', { class: 'muted' }, t('ad.fac.never_verified'));
          var d = daysSince(f);
          return h('span', { title: f.verified_by || null }, h('span', { class: 'ad-cell-title tabular nowrap' + (f.is_stale ? ' ad-warn' : '') }, U.fmtDate(f.verified_at)),
            h('span', { class: 'ad-cell-sub nowrap' }, d !== null ? t('ad.fac.days_ago', { n: d }) : ''));
        }
      },
      { key: 'caps', label: t('ad.fac.col_caps'), render: capIcons, cls: 'ad-hide-tab', thCls: 'ad-hide-tab' },
      {
        key: 'complete', label: t('ad.fac.col_complete'), sort: function (f) { return completeCount(f); }, cls: 'ad-hide-tab', thCls: 'ad-hide-tab',
        render: function (f) {
          var n = completeCount(f);
          return h('span', { class: 'ad-fac-complete' + (n === 10 ? ' is-done' : '') },
            h('span', { class: 'progress progress--sm' + (n < 10 ? ' progress--accent' : ''), role: 'img', 'aria-label': t('ad.fac.complete_n', { n: n }) }, h('span', { class: 'progress__bar', style: 'width:' + (n * 10) + '%' })),
            h('span', { class: 'tabular' }, n + '/10'));
        }
      }
    ];
  }
  function svcColumns() {
    return [
      {
        key: 'name', label: t('ad.fac.col_name'), sort: true, primary: true, mobileLabel: '',
        render: function (s) {
          return h('span', { class: 'ad-cell-flex' },
            h('span', { class: 'icon-tile icon-tile--sm icon-tile--accent', html: icon(TYPE_ICON[s.type] || 'map-pin') }),
            h('span', { style: 'min-width:0' }, h('span', { class: 'ad-cell-title' }, s.name || '—'), h('span', { class: 'ad-cell-sub' }, s.notes ? String(s.notes).slice(0, 90) + (String(s.notes).length > 90 ? '…' : '') : s.id)));
        }
      },
      { key: 'type', label: t('ad.fac.col_type'), sort: function (s) { return A.svcType(s.type); }, render: function (s) { return A.svcType(s.type); } },
      { key: 'route_id', label: t('ad.fac.col_route'), sort: function (s) { return A.routeName(s.route_id, { short: true }); }, render: function (s) { return A.routeName(s.route_id, { short: true }); } },
      { key: 'is_partner', label: t('ad.fac.col_partner'), sort: true, render: function (s) { return s.is_partner ? NC.ui.badge(t('ad.fac.partner'), 'accent', 'star') : h('span', { class: 'muted' }, '—'); } },
      { key: 'status', label: t('ad.fac.col_status'), sort: true, render: function (s) { return A.statusBadge(s.status || 'active', { tone: s.status === 'inactive' ? 'neutral' : 'success', icon: false }); } },
      { key: 'phone', label: t('ad.fac.col_phone'), cls: 'ad-hide-tab', thCls: 'ad-hide-tab', render: function (s) { return h('span', { class: 'tabular nowrap' }, s.phone || '—'); } },
      { key: 'open_hours', label: t('ad.fac.col_hours'), render: function (s) { return s.open_hours || '—'; } }
    ];
  }

  /* ------------------------------------------------------------------ data */
  function load() {
    var k = ++S.seq;
    S.loading = true;
    return Promise.all([NC.data.admin.listFacilities({}), NC.data.admin.listServices({})]).then(function (r) {
      if (k !== S.seq) return;
      S.loading = false;
      S.rows = r[0] || [];
      S.svcs = r[1] || [];
      S.loaded = true;
      render();
      if (S.pendingEdit) { var pe = S.pendingEdit; S.pendingEdit = null; pe(); }
    }).catch(function (e) {
      if (k === S.seq) { S.loading = false; S.pendingEdit = null; }
      if (e && e.sessionLost) return; // the shell is back on the sign-in gate
      console.error('[admin/facilities] load failed', e);
      NC.ui.toast(A.errorText(e), { type: 'danger' });
    });
  }
  var reload = U.debounce(function () { if (S.visible) load(); }, 500);

  function filtered(kind) {
    var f = S.filters;
    var q = f.q ? U.normalize(f.q) : '';
    var rows = kind === 'svc' ? S.svcs : S.rows;
    return rows.filter(function (r) {
      if (f.route && r.route_id !== f.route) return false;
      if (f.type && r.type !== f.type) return false;
      if (q && U.normalize([r.name, r.address, r.id, r.notes].join(' ')).indexOf(q) < 0) return false;
      if (kind === 'svc') return true;
      if (f.stale && !(r.status === 'verified' && r.is_stale)) return false;
      if (f.status && r.status !== f.status) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    if (!root) return;
    $$('[data-fac-tab]', els.tabs).forEach(function (b) {
      var on = b.getAttribute('data-fac-tab') === S.tab;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    els.chips.hidden = S.tab === 'svc';
    els.note.hidden = S.tab === 'svc' ? false : false;
    var view = els.filter.querySelector('.ad-fac-view');
    if (view) view.hidden = S.tab === 'svc';
    if (S.tab === 'svc') { renderServices(); return; }
    renderChips();
    var rows = filtered('fac');
    els.toolbar.innerHTML = '';
    els.toolbar.appendChild(h('span', { class: 'ad-toolbar__count' }, t('ad.fac.count', { n: U.fmtNumber(rows.length) })));
    var legend = h('div', { class: 'ad-legend' },
      h('span', { class: 'ad-legend__item', html: '<span class="ad-cap ad-cap--yes ad-cap--mini">' + icon('moon') + '</span>' + U.esc(t('ad.fac.c.night_shift')) }),
      h('span', { class: 'ad-legend__item', html: '<span class="ad-cap ad-cap--yes ad-cap--mini">' + icon('bandage') + '</span>' + U.esc(t('ad.fac.f.trauma_capable')) }));
    els.toolbar.appendChild(legend);
    els.body.innerHTML = '';
    if (S.view === 'map') { renderMap(rows); return; }
    els.table.update(rows, { keepPage: true });
    if (S.openId) els.table.select(S.openId);
    els.body.appendChild(els.table.el);
  }

  function renderChips() {
    var base = S.rows.filter(function (r) {
      var f = S.filters, q = f.q ? U.normalize(f.q) : '';
      if (f.route && r.route_id !== f.route) return false;
      if (f.type && r.type !== f.type) return false;
      if (q && U.normalize([r.name, r.address, r.id, r.notes].join(' ')).indexOf(q) < 0) return false;
      return true;
    });
    var count = function (fn) { return base.filter(fn).length; };
    var chips = [
      { id: 'all', label: t('ad.fac.chip_all'), n: base.length },
      { id: 'verified', label: t('ad.core.status.verified'), n: count(function (r) { return r.status === 'verified'; }) },
      { id: 'pending', label: t('ad.core.status.pending'), n: count(function (r) { return r.status === 'pending'; }) },
      { id: 'rejected', label: t('ad.core.status.rejected'), n: count(function (r) { return r.status === 'rejected'; }) },
      { id: 'stale', label: t('ad.fac.chip_stale'), n: count(function (r) { return r.status === 'verified' && r.is_stale; }), warn: true }
    ];
    var cur = S.filters.stale ? 'stale' : (S.filters.status || 'all');
    els.chips.innerHTML = '';
    chips.forEach(function (c) {
      var on = c.id === cur;
      els.chips.appendChild(h('button', {
        type: 'button', class: 'chip' + (on ? ' is-selected' : '') + (c.warn ? ' ad-fac-chip--warn' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-fac-chip': c.id
      }, c.label, h('span', { class: 'ad-pill-count' }, String(c.n))));
    });
  }

  function renderServices() {
    var rows = filtered('svc');
    els.toolbar.innerHTML = '';
    els.toolbar.appendChild(h('span', { class: 'ad-toolbar__count' }, t('ad.fac.count_svc', { n: U.fmtNumber(rows.length) })));
    els.body.innerHTML = '';
    els.svcTable.update(rows, { keepPage: true });
    els.body.appendChild(els.svcTable.el);
  }

  function renderMap(rows) {
    var wrap = h('div', { class: 'card card--pad-0 ad-fac-mapcard' });
    var mapEl = h('div', { class: 'ad-map ad-map--lg ad-map--flush' });
    var foot = h('div', { class: 'ad-fac-mapfoot' });
    wrap.appendChild(mapEl);
    wrap.appendChild(foot);
    els.body.appendChild(wrap);
    if (S.map) { try { S.map.remove(); } catch (e) { /* ignore */ } S.map = null; }
    S.map = A.miniMap(mapEl, { zoom: 6, scrollWheelZoom: true, center: [16.5, 106.5] });
    if (!S.map) return;
    var Lf = window.L;
    var layer = Lf.layerGroup().addTo(S.map);
    var decl = NC.mapkit.declutter ? NC.mapkit.declutter(S.map, function () { return [layer]; }) : null; // no overlapping 44 px targets
    var pts = [];
    A.routes().forEach(function (r) {
      if (S.filters.route && S.filters.route !== r.id) return;
      if (r.geometry) Lf.polyline(r.geometry, { color: r.color, weight: 4, opacity: 0.55, interactive: false }).addTo(layer);
    });
    var noCoords = 0;
    rows.forEach(function (f) {
      if (blank(f.lat) || blank(f.lng)) { noCoords++; return; }
      var m = NC.mapkit.poiMarker(f, 'facility', { size: 28 });
      m.bindTooltip('<b>' + U.esc(f.name) + '</b><br>' + U.esc(A.facType(f.type)) + ' · ' + U.esc(t('ad.core.status.' + f.status)) + (f.status === 'verified' && f.is_stale ? ' · ' + U.esc(t('ad.core.status.stale')) : ''), { direction: 'top' });
      m.on('click', function () { openEditor(f.id); });
      if (f.status !== 'verified') m.setOpacity(f.status === 'rejected' ? 0.45 : 0.8);
      m.addTo(layer);
      pts.push([f.lat, f.lng]);
    });
    foot.appendChild(h('span', { class: 'ad-muted-note', html: icon('info') + '<span>' + U.esc(t('ad.fac.map_hint')) + (noCoords ? ' ' + U.esc(t('ad.fac.no_coords', { n: noCoords })) : '') + '</span>' }));
    NC.mapkit.refresh(S.map);
    setTimeout(function () {
      if (S.map && pts.length) NC.mapkit.fitTo(S.map, pts, { padding: [30, 30], maxZoom: 13 });
      if (decl) decl.update();
    }, 40);
  }

  /* ------------------------------------------------------------------ URL sync */
  function syncUrl() {
    var f = S.filters;
    var p = {};
    if (S.tab === 'svc') p.tab = 'services';
    if (f.status) p.status = f.status;
    if (f.stale) p.stale = '1';
    if (f.route) p.route = f.route;
    if (f.type) p.type = f.type;
    if (f.q) p.q = f.q;
    if (S.view === 'map' && S.tab !== 'svc') p.view = 'map';
    if (S.openId) p.edit = S.openId;
    A.go('facilities', p, { silent: true });
  }

  /* ------------------------------------------------------------------ editor (facility) */
  function fld(labelKey, input, o) {
    o = o || {};
    var id = input.id || ('ad-fac-' + labelKey.replace(/\W+/g, '-'));
    if (!input.id && input.tagName && /INPUT|SELECT|TEXTAREA/.test(input.tagName)) input.id = id;
    var lab = h(input.tagName && /INPUT|SELECT|TEXTAREA/.test(input.tagName) ? 'label' : 'span', { class: 'field__label', for: /INPUT|SELECT|TEXTAREA/.test(input.tagName || '') ? id : null, id: id + '-label' },
      t(labelKey), o.req ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null);
    var f = h('div', { class: 'field' + (o.span ? ' ad-span' : ''), 'data-field': o.key || null }, lab, input);
    if (!/INPUT|SELECT|TEXTAREA/.test(input.tagName || '')) input.setAttribute('aria-labelledby', id + '-label');
    if (o.hint) f.appendChild(h('span', { class: 'field__hint' }, t(o.hint)));
    f.appendChild(h('span', { class: 'field__error', hidden: true }));
    return f;
  }
  function triState(name, value) {
    var seg = h('div', { class: 'segmented ad-fac-tri', 'data-name': name },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'true', html: icon('check') + '<span>' + U.esc(t('ad.fac.yes')) + '</span>' }),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'false', html: icon('x') + '<span>' + U.esc(t('ad.fac.no')) + '</span>' }),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': '', html: '<span>' + U.esc(t('ad.fac.unknown')) + '</span>' }));
    seg._ctl = NC.ui.segmented(seg, { value: value === true ? 'true' : value === false ? 'false' : '' });
    return seg;
  }
  function triValue(seg) { var v = seg._ctl.get(); return v === 'true' ? true : v === 'false' ? false : null; }

  function findRow(id) { return S.rows.filter(function (r) { return r.id === id; })[0] || null; }

  /**
   * Open the edit drawer for an existing facility (loads the list first when needed). A miss in the cached rows (e.g. a
   * facility just created by a community approval while this page was hidden) waits for a fresh list before giving up.
   */
  function openEditor(id, fresh) {
    if (!S.loaded) { S.pendingEdit = function () { if (S.visible) openEditor(id, true); }; return; }
    var f = findRow(id);
    if (!f && !fresh) {
      S.pendingEdit = function () { if (S.visible) openEditor(id, true); };
      if (!S.loading) load();
      return;
    }
    if (!f) { NC.ui.toast(t('ad.fac.not_found', { id: id }), { type: 'warning' }); return; }
    editor(Object.assign({}, f), false);
  }
  /** Open the drawer for a new facility, optionally prefilled ({route_id, lat, lng, name, type, …}). */
  function create(prefill) {
    if (!S.loaded) { S.pendingEdit = function () { create(prefill); }; return; }
    editor(Object.assign({ status: 'pending', source: 'team', is_demo: true, route_id: S.filters.route || '', type: null, night_shift: null, trauma_capable: null }, prefill || {}), true);
  }

  function editor(f, isNew) {
    if (S.drawer) S.drawer.close();
    S.openId = isNew ? null : f.id;
    if (!isNew) { syncUrl(); if (els.table) els.table.select(f.id); }
    var form = h('form', { class: 'ad-fac-form', novalidate: true });
    var inp = {};
    function input(name, attrs) {
      var el = h('input', Object.assign({ class: 'input', name: name, id: 'ad-fac-in-' + name, value: f[name] === null || f[name] === undefined ? '' : String(f[name]) }, attrs || {}));
      inp[name] = el;
      return el;
    }

    // checklist summary
    var checkBox = h('section', { class: 'ad-fac-check', 'aria-live': 'polite' });

    // info
    var typeGroup = h('div', { class: 'chip-group ad-fac-types', role: 'radiogroup' });
    TYPES.forEach(function (ty) {
      typeGroup.appendChild(h('button', { type: 'button', class: 'chip' + (f.type === ty ? ' is-selected' : ''), role: 'radio', 'aria-checked': f.type === ty ? 'true' : 'false', 'data-type': ty, html: icon(TYPE_ICON[ty]) + '<span>' + U.esc(A.facType(ty)) + '</span>' }));
    });
    var routeSel = A.select({ id: 'ad-fac-in-route', value: f.route_id || '', all: '—', options: routeOptions() });
    inp.route_id = routeSel;
    var secInfo = h('section', { class: 'ad-section' },
      h('h3', { class: 'ad-section__title', html: icon('hospital') + '<span>' + U.esc(t('ad.fac.sec_info')) + '</span>' }),
      h('div', { class: 'ad-fields ad-fields--2' },
        fld('ad.fac.f.name', input('name', { autocomplete: 'off', maxlength: '160' }), { req: true, span: true, key: 'name', hint: 'ad.fac.h.name' }),
        fld('ad.fac.f.type', typeGroup, { req: true, span: true, key: 'type' }),
        fld('ad.fac.f.route_id', routeSel, { req: true, key: 'route_id', hint: isNew ? 'ad.fac.h.route' : null }),
        fld('ad.fac.f.address', input('address', { autocomplete: 'off', maxlength: '300' }), { req: true, key: 'address' })));

    // contact & capability
    var hoursIn = input('open_hours', { autocomplete: 'off', maxlength: '120', list: 'ad-fac-hours' });
    var hoursQuick = h('div', { class: 'chip-group ad-fac-quick' },
      h('button', { type: 'button', class: 'chip chip--soft', 'data-hours': '24/7' }, t('ad.fac.hours_247')),
      h('button', { type: 'button', class: 'chip chip--soft', 'data-hours': '07:00–17:00' }, t('ad.fac.hours_day')),
      h('button', { type: 'button', class: 'chip chip--soft', 'data-hours': '07:00–11:30, 13:30–17:00' }, '07:00–11:30, 13:30–17:00'));
    var night = triState('night_shift', f.night_shift);
    var trauma = triState('trauma_capable', f.trauma_capable);
    var hoursField = fld('ad.fac.f.open_hours', hoursIn, { req: true, key: 'open_hours' });
    hoursField.insertBefore(hoursQuick, hoursField.querySelector('.field__error'));
    var secContact = h('section', { class: 'ad-section' },
      h('h3', { class: 'ad-section__title', html: icon('phone') + '<span>' + U.esc(t('ad.fac.sec_contact')) + '</span>' }),
      h('div', { class: 'ad-fields ad-fields--2' },
        fld('ad.fac.f.phone', input('phone', { type: 'tel', autocomplete: 'off', inputmode: 'tel', maxlength: '32', placeholder: '+84 000 000 0NN' }), { req: true, key: 'phone', hint: 'ad.fac.h.phone' }),
        hoursField,
        fld('ad.fac.f.night_shift', night, { req: true, key: 'night_shift' }),
        fld('ad.fac.f.trauma_capable', trauma, { req: true, key: 'trauma_capable' })));

    // location
    var latIn = input('lat', { type: 'number', step: 'any', inputmode: 'decimal', min: '-90', max: '90' });
    var lngIn = input('lng', { type: 'number', step: 'any', inputmode: 'decimal', min: '-180', max: '180' });
    var mapEl = h('div', { class: 'ad-map ad-map--sm ad-fac-picker' });
    var secLoc = h('section', { class: 'ad-section' },
      h('h3', { class: 'ad-section__title', html: icon('map-pin') + '<span>' + U.esc(t('ad.fac.sec_loc')) + '</span>' }),
      h('div', { class: 'ad-fields ad-fields--2', 'data-field': 'coords' },
        fld('ad.fac.f.lat', latIn, { req: true, key: 'lat' }),
        fld('ad.fac.f.lng', lngIn, { req: true, key: 'lng' })),
      mapEl,
      h('p', { class: 'field__hint' }, t('ad.fac.h.map')));

    // verification
    var dateIn = input('verified_at', { type: 'date', min: '2000-01-01', max: todayIso() });
    var todayBtn = h('button', { type: 'button', class: 'btn btn--soft btn--sm ad-fac-today', html: icon('check-circle') + '<span>' + U.esc(t('ad.fac.verify_today')) + '</span>' });
    var dateField = fld('ad.fac.f.verified_at', dateIn, { req: true, key: 'verified_at' });
    dateField.insertBefore(todayBtn, dateField.querySelector('.field__error'));
    var statusSeg = h('div', { class: 'segmented ad-fac-statusseg' },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'pending', html: icon('clock') + '<span>' + U.esc(t('ad.core.status.pending')) + '</span>' }),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'verified', html: icon('check-circle') + '<span>' + U.esc(t('ad.core.status.verified')) + '</span>' }),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'rejected', html: icon('x-circle') + '<span>' + U.esc(t('ad.core.status.rejected')) + '</span>' }));
    var statusCtl = NC.ui.segmented(statusSeg, { value: f.status || 'pending', onChange: function () { refreshCheck(); } });
    var notes = h('textarea', { class: 'textarea', name: 'notes', id: 'ad-fac-in-notes', rows: '3', maxlength: '2000' });
    notes.value = f.notes || '';
    inp.notes = notes;
    var meta = h('div', { class: 'cluster ad-fac-meta' },
      NC.ui.badge(t(f.source === 'community' ? 'ad.fac.source_community' : 'ad.fac.source_team'), f.source === 'community' ? 'accent' : 'primary', f.source === 'community' ? 'users' : 'shield-check'),
      f.is_demo !== false ? NC.ui.demoBadge() : null,
      f.created_at ? h('span', { class: 'ad-cell-sub' }, t('ad.fac.created', { date: U.fmtDate(f.created_at) })) : null,
      f.updated_at ? h('span', { class: 'ad-cell-sub' }, t('ad.fac.updated', { date: U.fmtDateTime(f.updated_at) })) : null);
    var secVerify = h('section', { class: 'ad-section' },
      h('h3', { class: 'ad-section__title', html: icon('shield-check') + '<span>' + U.esc(t('ad.fac.sec_verify')) + '</span>' }),
      h('div', { class: 'ad-fields ad-fields--2' },
        fld('ad.fac.f.verified_by', input('verified_by', { autocomplete: 'off', maxlength: '160' }), { req: true, key: 'verified_by', hint: 'ad.fac.h.verified_by' }),
        dateField,
        fld('ad.fac.f.status', statusSeg, { span: true, key: 'status' }),
        fld('ad.fac.f.notes', notes, { span: true, key: 'notes', hint: 'ad.fac.h.notes' })),
      meta);

    form.appendChild(checkBox);
    form.appendChild(secInfo);
    form.appendChild(secContact);
    form.appendChild(secLoc);
    form.appendChild(secVerify);

    /* ---- live model ---- */
    function current() {
      var sel = typeGroup.querySelector('.is-selected');
      var lat = latIn.value === '' ? null : +latIn.value, lng = lngIn.value === '' ? null : +lngIn.value;
      return {
        id: isNew ? undefined : f.id,
        name: inp.name.value.trim(), type: sel ? sel.getAttribute('data-type') : null, route_id: routeSel.value || null,
        address: inp.address.value.trim(), phone: inp.phone.value.trim(), open_hours: hoursIn.value.trim(),
        night_shift: triValue(night), trauma_capable: triValue(trauma), lat: lat, lng: lng,
        verified_by: inp.verified_by.value.trim(), verified_at: dateIn.value || null, status: statusCtl.get() || 'pending',
        notes: notes.value.trim() || null
      };
    }
    function refreshCheck() {
      var c = current();
      var st = checkState(c);
      var ok = st.filter(function (x) { return x.ok; }).length;
      checkBox.innerHTML = '';
      checkBox.className = 'ad-fac-check' + (ok === 10 ? ' is-ok' : '');
      var head = h('div', { class: 'ad-fac-check__head' },
        h('span', { class: 'ad-fac-check__title', html: icon(ok === 10 ? 'check-circle' : 'list-checks') + '<span>' + U.esc(t('ad.fac.check_title')) + '</span>' }),
        h('b', { class: 'ad-fac-check__n tabular' }, ok + '/10'));
      checkBox.appendChild(head);
      checkBox.appendChild(h('div', { class: 'progress progress--sm' + (ok < 10 ? ' progress--accent' : '') }, h('span', { class: 'progress__bar', style: 'width:' + ok * 10 + '%' })));
      var list = h('ul', { class: 'ad-fac-check__list' });
      st.forEach(function (x) {
        list.appendChild(h('li', { class: x.ok ? 'is-ok' : 'is-miss', html: icon(x.ok ? 'check' : 'minus', 'icon--xs') + '<span>' + U.esc(t('ad.fac.c.' + x.key)) + '</span>' }));
      });
      checkBox.appendChild(list);
      checkBox.appendChild(h('p', { class: 'ad-fac-check__msg' }, ok === 10 ? t('ad.fac.check_ok') : t('ad.fac.check_missing', { n: 10 - ok })));
      // clear field errors that are now satisfied
      $$('.field.is-invalid', form).forEach(function (fe) {
        var k = fe.getAttribute('data-field');
        if (k && !blank(c[k])) { fe.classList.remove('is-invalid'); var er = fe.querySelector('.field__error'); if (er) er.hidden = true; }
      });
      return c;
    }
    function markInvalid(keys, msg) {
      $$('.field', form).forEach(function (fe) { fe.classList.remove('is-invalid'); var er = fe.querySelector('.field__error'); if (er) er.hidden = true; });
      var first = null;
      keys.forEach(function (k) {
        var fe = form.querySelector('.field[data-field="' + k + '"]');
        if (!fe) return;
        fe.classList.add('is-invalid');
        var er = fe.querySelector('.field__error');
        if (er && msg) { er.textContent = msg; er.hidden = false; }
        if (!first) first = fe;
      });
      if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var focusable = first.querySelector('input, select, textarea, button');
        if (focusable) setTimeout(function () { try { focusable.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 250);
      }
    }

    form.addEventListener('input', function () { dirty = true; refreshCheck(); });
    form.addEventListener('change', function () { dirty = true; refreshCheck(); });
    form.addEventListener('click', function (e) {
      var tb = e.target.closest ? e.target.closest('[data-type]') : null;
      if (tb) {
        $$('[data-type]', typeGroup).forEach(function (b) { var on = b === tb; b.classList.toggle('is-selected', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
        dirty = true; refreshCheck(); return;
      }
      var hb = e.target.closest ? e.target.closest('[data-hours]') : null;
      if (hb) { hoursIn.value = hb.getAttribute('data-hours'); dirty = true; refreshCheck(); return; }
      if (e.target.closest && e.target.closest('.segmented__btn')) { dirty = true; setTimeout(refreshCheck, 0); }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    todayBtn.addEventListener('click', function () {
      dateIn.value = todayIso();
      statusCtl.set('verified');
      dirty = true;
      var c = refreshCheck();
      NC.ui.toast(t('ad.fac.verify_today_done'), { type: 'info', timeout: 2600 });
      if (blank(c.verified_by)) setTimeout(function () { inp.verified_by.focus(); }, 50);
    });
    var dirty = false;

    function save() {
      var c = refreshCheck();
      var req = [];
      if (blank(c.name)) req.push('name');
      if (!c.type && c.status === 'verified') req.push('type');
      // every facility belongs to a pilot route (packs are built per route); only a pending row that never had one may stay without
      if (!c.route_id && (isNew || c.status === 'verified' || f.route_id)) req.push('route_id');
      if (req.length) {
        markInvalid(req, req.length === 1 && req[0] === 'route_id' ? t('ad.fac.err_route') : t('common.required'));
        NC.ui.toast(t('ad.fac.err_required', { fields: req.map(function (k) { return t('ad.fac.f.' + k); }).join(', ') }), { type: 'warning' });
        return false;
      }
      if ((c.lat !== null && (Math.abs(c.lat) > 90 || !isFinite(c.lat))) || (c.lng !== null && (Math.abs(c.lng) > 180 || !isFinite(c.lng))) || ((c.lat === null) !== (c.lng === null))) {
        // latitude/longitude typed the wrong way round → say so (the Vietnam message mentions swapping)
        markInvalid(['lat', 'lng'], t(c.lat !== null && c.lng !== null && inVietnam(c.lng, c.lat) ? 'ad.fac.err_outside_vn' : 'ad.fac.err_coords'));
        return false;
      }
      if (c.lat !== null && c.lng !== null && !inVietnam(c.lat, c.lng)) {
        markInvalid(['lat', 'lng'], t('ad.fac.err_outside_vn'));
        NC.ui.toast(t('ad.fac.err_outside_vn'), { type: 'warning', timeout: 6000 });
        return false;
      }
      var dErr = dateError(c.verified_at);
      if (dErr) {
        markInvalid(['verified_at'], dErr);
        NC.ui.toast(dErr, { type: 'warning' });
        return false;
      }
      if (c.status === 'verified') {
        var miss = missingFields(c);
        if (miss.length) {
          markInvalid(miss, t('common.required'));
          NC.ui.toast(t('ad.fac.err_incomplete', { fields: fieldLabels(miss) }), { type: 'danger', timeout: 5000 });
          return false;
        }
      }
      var payload = Object.assign({}, c);
      if (isNew) delete payload.id;
      return NC.data.admin.upsertFacility(payload).then(function (saved) {
        dirty = false;
        var route = saved.route_id || c.route_id;
        NC.ui.toast(t('ad.fac.saved', { name: saved.name || c.name }) + ' — ' + t('ad.fac.saved_hint'), {
          type: 'success', timeout: 7000,
          action: route ? { label: t('ad.fac.republish'), onClick: function () { A.go('packs', { route: route, publish: 1 }); } } : null
        });
        upsertLocal(saved);
        A.refreshBadges();
        return true;
      }, function (err) {
        if (err && err.code === 'incomplete') {
          markInvalid(err.missing || [], t('common.required'));
          NC.ui.toast(t('ad.fac.err_incomplete', { fields: fieldLabels(err.missing || []) }), { type: 'danger', timeout: 5000 });
          return false;
        }
        if (err && err.code === 'invalid_coordinates') {
          var outside = err.reason === 'outside_vietnam' || /outside_vietnam/.test(String(err.details || ''));
          markInvalid(['lat', 'lng'], t(outside ? 'ad.fac.err_outside_vn' : 'ad.fac.err_coords'));
          return false;
        }
        if (err && err.code === 'invalid_date') { markInvalid(['verified_at'], t('ad.fac.err_future')); NC.ui.toast(t('ad.fac.err_future'), { type: 'warning' }); return false; }
        NC.ui.toast(A.errorText(err), { type: 'danger' });
        return false;
      });
    }

    var actions = [];
    if (!isNew) actions.push({ label: t('common.delete'), variant: 'ghost', icon: 'trash', align: 'start', close: false, onClick: function () { remove(f); return false; } });
    actions.push({ label: t('common.cancel'), variant: 'ghost' });
    actions.push({ label: t('common.save'), variant: 'primary', icon: 'check', close: true, onClick: function () { return save(); } });

    var ctrl = A.drawer({
      title: isNew ? t('ad.fac.new_title') : (f.name || t('ad.fac.edit_title')),
      subtitle: isNew ? t('ad.fac.new_sub') : [f.id, A.routeName(f.route_id, { short: true }), A.facType(f.type)].filter(Boolean).join(' · '),
      icon: TYPE_ICON[f.type] || 'hospital', iconVariant: 'primary', body: form, actions: actions, className: 'ad-fac-drawer',
      onClose: function () {
        S.drawer = null; S.openId = null;
        if (els.table) els.table.select(null);
        if (S.visible) syncUrl();
        if (picker.map) { try { picker.map.remove(); } catch (e) { /* ignore */ } }
      }
    });
    var delBtn = ctrl.panel.querySelector('.ad-drawer__start');
    if (delBtn) delBtn.classList.add('ad-btn-danger-ghost');
    S.drawer = ctrl;
    refreshCheck();

    /* ---- coordinate picker ---- */
    var picker = { map: null, marker: null };
    setTimeout(function () {
      if (!window.L || !document.contains(mapEl)) return;
      var Lf = window.L;
      var route = A.routes().filter(function (r) { return r.id === (routeSel.value || f.route_id); })[0];
      var has = !blank(f.lat) && !blank(f.lng);
      var center = has ? [+f.lat, +f.lng] : route ? [(route.bbox[0] + route.bbox[2]) / 2, (route.bbox[1] + route.bbox[3]) / 2] : [16.5, 106.5];
      picker.map = A.miniMap(mapEl, { center: center, zoom: has ? 14 : route ? 9 : 5, scrollWheelZoom: false });
      if (!picker.map) return;
      A.routes().forEach(function (r) { if (r.geometry) Lf.polyline(r.geometry, { color: r.color, weight: 3, opacity: 0.6, interactive: false }).addTo(picker.map); });
      function place(lat, lng, pan) {
        if (!picker.marker) {
          picker.marker = Lf.marker([lat, lng], { draggable: true, keyboard: true, title: t('ad.fac.f.coords'),
            icon: Lf.divIcon({ className: 'ad-fac-pinwrap', html: '<span class="ad-fac-pin">' + icon('map-pin') + '</span>', iconSize: [34, 34], iconAnchor: [17, 34] })
          }).addTo(picker.map);
          picker.marker.on('dragend', function () {
            var ll = picker.marker.getLatLng();
            latIn.value = ll.lat.toFixed(6); lngIn.value = ll.lng.toFixed(6);
            dirty = true; refreshCheck();
          });
        } else picker.marker.setLatLng([lat, lng]);
        if (pan) picker.map.panTo([lat, lng]);
      }
      if (has) place(+f.lat, +f.lng, false);
      picker.map.on('click', function (ev) {
        latIn.value = ev.latlng.lat.toFixed(6); lngIn.value = ev.latlng.lng.toFixed(6);
        place(ev.latlng.lat, ev.latlng.lng, false);
        dirty = true; refreshCheck();
      });
      var onCoord = function () {
        var la = parseFloat(latIn.value), ln = parseFloat(lngIn.value);
        if (isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) place(la, ln, true);
      };
      latIn.addEventListener('change', onCoord); lngIn.addEventListener('change', onCoord);
      routeSel.addEventListener('change', function () {
        if (picker.marker) return;
        var r = A.routes().filter(function (x) { return x.id === routeSel.value; })[0];
        if (r) NC.mapkit.fitTo(picker.map, r.bbox, { padding: [10, 10] });
      });
      NC.mapkit.refresh(picker.map);
      setTimeout(function () { NC.mapkit.refresh(picker.map); }, 350);
    }, 120);
  }

  function upsertLocal(saved) {
    var i = -1;
    S.rows.forEach(function (r, j) { if (r.id === saved.id) i = j; });
    if (i >= 0) S.rows[i] = saved; else S.rows.push(saved);
    render();
  }

  function remove(f) {
    NC.ui.confirm({ title: t('ad.fac.delete_q', { name: f.name || f.id }), message: t('ad.fac.delete_msg'), confirmLabel: t('common.delete'), danger: true }).then(function (ok) {
      if (!ok) return;
      NC.data.admin.deleteFacility(f.id).then(function () {
        S.rows = S.rows.filter(function (r) { return r.id !== f.id; });
        if (S.drawer) S.drawer.close();
        render();
        A.refreshBadges();
        NC.ui.toast(t('ad.fac.deleted', { name: f.name || f.id }), {
          type: 'success', timeout: 6000,
          action: f.route_id ? { label: t('ad.fac.republish'), onClick: function () { A.go('packs', { route: f.route_id, publish: 1 }); } } : null
        });
      }, function (err) { NC.ui.toast(A.errorText(err), { type: 'danger' }); });
    });
  }

  /* ------------------------------------------------------------------ editor (service) */
  function openService(id) {
    var s = id ? S.svcs.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !s) return;
    var isNew = !s;
    s = Object.assign({ type: 'lodging', status: 'active', is_partner: false, commission_rate: 0, route_id: S.filters.route || '' }, s || {});
    var form = h('form', { class: 'ad-fac-form', novalidate: true });
    var name = h('input', { class: 'input', id: 'ad-svc-name', value: s.name || '', maxlength: '160', autocomplete: 'off' });
    var typeSel = A.select({ id: 'ad-svc-type', value: s.type, options: SVC_TYPES.map(function (ty) { return { value: ty, label: A.svcType(ty) }; }) });
    var routeSel = A.select({ id: 'ad-svc-route', value: s.route_id || '', all: '—', options: routeOptions() });
    var phone = h('input', { class: 'input', id: 'ad-svc-phone', type: 'tel', value: s.phone || '', maxlength: '32', autocomplete: 'off' });
    var hours = h('input', { class: 'input', id: 'ad-svc-hours', value: s.open_hours || '', maxlength: '120', autocomplete: 'off' });
    var lat = h('input', { class: 'input', id: 'ad-svc-lat', type: 'number', step: 'any', value: blank(s.lat) ? '' : String(s.lat) });
    var lng = h('input', { class: 'input', id: 'ad-svc-lng', type: 'number', step: 'any', value: blank(s.lng) ? '' : String(s.lng) });
    var partner = h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'ad-svc-partner', checked: !!s.is_partner }), h('span', { class: 'switch__track' }), h('span', { class: 'switch__label' }, t('ad.fac.f.is_partner')));
    var rate = h('input', { class: 'input', id: 'ad-svc-rate', type: 'number', min: '0', max: '100', step: '0.5', value: String(Math.round((+s.commission_rate || 0) * 1000) / 10) });
    var status = h('div', { class: 'segmented' },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'active' }, t('ad.fac.svc_active')),
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'inactive' }, t('ad.fac.svc_inactive')));
    var stCtl = NC.ui.segmented(status, { value: s.status || 'active' });
    var notes = h('textarea', { class: 'textarea', id: 'ad-svc-notes', rows: '3', maxlength: '2000' });
    notes.value = s.notes || '';
    form.appendChild(h('section', { class: 'ad-section' },
      h('div', { class: 'ad-fields ad-fields--2' },
        fld('ad.fac.f.name', name, { req: true, span: true, key: 'name' }),
        fld('ad.fac.f.type', typeSel, { req: true, key: 'type' }),
        fld('ad.fac.f.route_id', routeSel, { key: 'route_id' }),
        fld('ad.fac.f.phone', phone, { key: 'phone' }),
        fld('ad.fac.f.open_hours', hours, { key: 'open_hours' }),
        fld('ad.fac.f.lat', lat, { key: 'lat' }),
        fld('ad.fac.f.lng', lng, { key: 'lng' }),
        h('div', { class: 'field ad-span ad-svc-partner' }, partner, h('span', { class: 'field__hint' }, t('ad.fac.order_note'))),
        fld('ad.fac.f.commission_rate', rate, { key: 'commission_rate' }),
        fld('ad.fac.f.status', status, { key: 'status' }),
        fld('ad.fac.f.notes', notes, { span: true, key: 'notes', hint: 'ad.fac.h.notes' }))));
    function save() {
      if (!name.value.trim()) { NC.ui.toast(t('ad.fac.err_required', { fields: t('ad.fac.f.name') }), { type: 'warning' }); name.focus(); return false; }
      var row = {
        id: isNew ? undefined : s.id, name: name.value.trim(), type: typeSel.value, route_id: routeSel.value || null,
        phone: phone.value.trim() || null, open_hours: hours.value.trim() || null,
        lat: lat.value === '' ? null : +lat.value, lng: lng.value === '' ? null : +lng.value,
        is_partner: form.querySelector('#ad-svc-partner').checked, commission_rate: (+rate.value || 0) / 100,
        status: stCtl.get() || 'active', notes: notes.value.trim() || null
      };
      if (isNew) delete row.id;
      return NC.data.admin.upsertService(row).then(function (saved) {
        var i = -1; S.svcs.forEach(function (x, j) { if (x.id === saved.id) i = j; });
        if (i >= 0) S.svcs[i] = saved; else S.svcs.push(saved);
        render();
        NC.ui.toast(t('ad.fac.saved', { name: saved.name }), { type: 'success', timeout: 6000, action: saved.route_id ? { label: t('ad.fac.republish'), onClick: function () { A.go('packs', { route: saved.route_id }); } } : null });
        return true;
      }, function (err) { NC.ui.toast(A.errorText(err), { type: 'danger' }); return false; });
    }
    A.drawer({
      title: isNew ? t('ad.fac.svc_new') : (s.name || t('ad.fac.svc_edit')), subtitle: isNew ? null : [s.id, A.svcType(s.type)].join(' · '),
      icon: TYPE_ICON[s.type] || 'bed', iconVariant: 'accent', body: form,
      actions: [{ label: t('common.cancel'), variant: 'ghost' }, { label: t('common.save'), variant: 'primary', icon: 'check', onClick: function () { return save(); } }]
    });
  }

  /* ------------------------------------------------------------------ events */
  function onClick(e) {
    var tgt = e.target;
    if (!tgt.closest) return;
    var b;
    if ((b = tgt.closest('[data-fac-chip]'))) {
      var id = b.getAttribute('data-fac-chip');
      S.filters.stale = id === 'stale';
      S.filters.status = (id === 'all' || id === 'stale') ? '' : id;
      syncUrl(); render(); return;
    }
    if ((b = tgt.closest('[data-fac-tab]'))) {
      var tab = b.getAttribute('data-fac-tab');
      if (tab === S.tab) return;
      S.tab = tab;
      S.filters.type = '';
      buildStatic(); syncUrl(); render(); return;
    }
    if ((b = tgt.closest('[data-fac-edit]'))) { openEditor(b.getAttribute('data-fac-edit')); return; }
    if ((b = tgt.closest('[data-svc-edit]'))) { openService(b.getAttribute('data-svc-edit')); return; }
    if ((b = tgt.closest('[data-fac-action]'))) {
      var a = b.getAttribute('data-fac-action');
      if (a === 'add') { if (S.tab === 'svc') openService(null); else create(); }
      if (a === 'csv') exportCsv();
    }
  }

  function exportCsv() {
    if (S.tab === 'svc') {
      A.csv(t('ad.fac.csv_svc'), filtered('svc'), ['id', 'route_id', 'name', 'type', 'lat', 'lng', 'phone', 'open_hours', 'is_partner', 'commission_rate', 'status', 'is_demo'].map(function (k) { return { key: k }; }));
      return;
    }
    A.csv(t('ad.fac.csv_name'), filtered('fac'), ['id', 'route_id', 'name', 'type', 'address', 'lat', 'lng', 'phone', 'open_hours', 'night_shift', 'trauma_capable', 'verified_by', 'verified_at', 'status', 'is_stale', 'days_since_verified', 'source', 'is_demo'].map(function (k) { return { key: k }; }));
  }

  /* ------------------------------------------------------------------ lifecycle */
  function applyParams(p) {
    p = p || {};
    var tab = p.tab === 'services' ? 'svc' : 'fac';
    var tabChanged = tab !== S.tab;
    S.tab = tab;
    S.filters = {
      status: ['verified', 'pending', 'rejected'].indexOf(p.status) >= 0 ? p.status : '',
      stale: p.stale === '1' || p.stale === 'true', route: p.route || '', type: p.type || '', q: p.q || ''
    };
    S.view = p.view === 'map' ? 'map' : 'table';
    buildStatic();
    if (tabChanged) buildStatic();
  }

  function show(params) {
    S.visible = true;
    var p = params || {};
    if (S.drawer && !p.edit) { /* keep the open drawer */ }
    applyParams(p);
    render();
    load();
    if (p.edit && (!S.drawer || S.openId !== p.edit)) openEditor(p.edit);
    else if (p['new'] === '1') create({ route_id: p.route || '' });
    if (S.map) NC.mapkit.refresh(S.map);
  }
  function hide() {
    S.visible = false;
    if (S.drawer) S.drawer.close();
  }

  function badge() {
    return NC.data.admin.listFacilities({ status: 'pending' }).then(function (rows) { return { count: rows.length, tone: 'warning' }; }).catch(function () { return null; });
  }

  A.facilities = { edit: function (id) { A.go('facilities', { edit: id }); }, create: function (prefill) { if (!S.visible) A.go('facilities'); setTimeout(function () { create(prefill); }, 60); } };
  A.register('facilities', { titleKey: 'ad.fac.title', navKey: 'ad.fac.nav', icon: 'hospital', order: 10, group: 'data', mount: mount, show: show, hide: hide, badge: badge });
})(window.NC = window.NC || {});
