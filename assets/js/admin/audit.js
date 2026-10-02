/*
 * audit.js — Admin page "audit" (owner: admin-pages): filterable audit log (server triggers on facilities, services,
 * submissions, data packs, content releases, Buddy status). Search, entity/action/actor/period filters, per-action
 * summary chips, 14-day activity sparkline, paged table with readable change summaries, detail dialog (diff + raw JSON),
 * CSV export, realtime prepend. Public API: none (registers NC.admin page 'audit'). Uses NC.adp (signal.js).
 */
(function (NC) {
  'use strict';

  var kit = NC.adp;
  if (!kit) { console.warn('[admin/audit] NC.adp kit missing (signal.js must load first)'); return; }
  var U = NC.util, t = kit.t, esc = kit.esc, h = kit.h, icon = kit.icon;

  NC.i18n.add({
    vi: {
      'ad.audit.nav': 'Nhật ký',
      'ad.audit.title': 'Nhật ký kiểm toán',
      'ad.audit.subtitle': 'Mọi thay đổi trên điểm y tế, dịch vụ, đóng góp cộng đồng, gói dữ liệu, nội dung y tế và trạng thái phiên Buddy — ghi bằng trigger phía máy chủ, không sửa được từ dashboard.',
      'ad.audit.export': 'Xuất CSV',
      'ad.audit.refresh': 'Làm mới',
      'ad.audit.search': 'Tìm theo người, đối tượng, mã, nội dung…',
      'ad.audit.f_entity': 'Đối tượng',
      'ad.audit.f_action': 'Hành động',
      'ad.audit.f_actor': 'Người thực hiện',
      'ad.audit.f_period': 'Khoảng thời gian',
      'ad.audit.f_limit': 'Số bản ghi tải',
      'ad.audit.all_entities': 'Mọi đối tượng',
      'ad.audit.all_actions': 'Mọi hành động',
      'ad.audit.all_actors': 'Mọi người',
      'ad.audit.p_24h': '24 giờ',
      'ad.audit.p_7d': '7 ngày',
      'ad.audit.p_30d': '30 ngày',
      'ad.audit.p_all': 'Tất cả',
      'ad.audit.limit_n': '{n} gần nhất',
      'ad.audit.reset': 'Xoá bộ lọc',
      'ad.audit.activity': 'Hoạt động 14 ngày',
      'ad.audit.activity_sub': '{n} thay đổi · cao nhất {max}/ngày',
      'ad.audit.count': '{from}–{to} / {n} bản ghi',
      'ad.audit.prev': 'Trang trước',
      'ad.audit.next': 'Trang sau',
      'ad.audit.col_time': 'Thời gian',
      'ad.audit.col_actor': 'Người thực hiện',
      'ad.audit.col_action': 'Hành động',
      'ad.audit.col_entity': 'Đối tượng',
      'ad.audit.col_change': 'Thay đổi',
      'ad.audit.details': 'Chi tiết',
      'ad.audit.empty': 'Không có bản ghi phù hợp',
      'ad.audit.empty_t': 'Thử bỏ bớt bộ lọc hoặc mở rộng khoảng thời gian.',
      'ad.audit.a_insert': 'Tạo mới',
      'ad.audit.a_update': 'Cập nhật',
      'ad.audit.a_delete': 'Xoá',
      'ad.audit.a_status': 'Đổi trạng thái',
      'ad.audit.a_publish': 'Phát hành',
      'ad.audit.a_import.samples': 'Nhập mẫu đo',
      'ad.audit.a_model.run': 'Chạy mô hình nội suy',
      'ad.audit.a_facility.verify': 'Xác thực điểm y tế',
      'ad.audit.a_content.submit_review': 'Gửi duyệt nội dung',
      'ad.audit.a_pack.publish': 'Phát hành gói',
      'ad.audit.a_buddy.overdue': 'Quá hạn check-in',
      'ad.audit.a_buddy.alert_sent': 'Gửi email cảnh báo',
      'ad.audit.a_submission.create': 'Đóng góp mới',
      'ad.audit.e_signal_segments': 'Lớp phủ sóng',
      'ad.audit.e_facilities': 'Điểm y tế',
      'ad.audit.e_services': 'Dịch vụ',
      'ad.audit.e_facility_submissions': 'Đóng góp cộng đồng',
      'ad.audit.e_data_packs': 'Gói dữ liệu',
      'ad.audit.e_content_releases': 'Nội dung y tế',
      'ad.audit.e_buddy_sessions': 'Phiên Buddy',
      'ad.audit.e_signal_samples': 'Mẫu sóng',
      'ad.audit.e_devices': 'Thiết bị',
      'ad.audit.system': 'Hệ thống (cron)',
      'ad.audit.community': 'Cộng đồng',
      'ad.audit.created': 'Tạo {name}',
      'ad.audit.deleted': 'Xoá {name}',
      'ad.audit.published': 'Phát hành {name}',
      'ad.audit.more': '+{n} trường',
      'ad.audit.trip': 'đợt đo {trip}',
      'ad.audit.d_title': 'Bản ghi nhật ký #{id}',
      'ad.audit.d_when': 'Thời gian',
      'ad.audit.d_actor': 'Người thực hiện',
      'ad.audit.d_action': 'Hành động',
      'ad.audit.d_entity': 'Đối tượng',
      'ad.audit.d_id': 'Mã đối tượng',
      'ad.audit.d_field': 'Trường',
      'ad.audit.d_from': 'Trước',
      'ad.audit.d_to': 'Sau',
      'ad.audit.d_raw': 'Dữ liệu gốc (JSON)',
      'ad.audit.d_open': 'Mở trang liên quan',
      'ad.audit.copy_json': 'Sao chép JSON',
      'ad.audit.copied': 'Đã sao chép',
      'ad.audit.live_new': '{n} bản ghi mới',
      'ad.audit.exported': 'Đã xuất {n} dòng',
      'ad.audit.empty_val': '(trống)',
      'ad.audit.note': 'Nhật ký chỉ đọc. Trường nhạy cảm (payload gói, secret thiết bị, lớp y tế) không được ghi vào nhật ký.'
    },
    en: {
      'ad.audit.nav': 'Audit log',
      'ad.audit.title': 'Audit log',
      'ad.audit.subtitle': 'Every change to facilities, services, community submissions, data packs, medical content and Buddy session status — written by server-side triggers, read-only from the dashboard.',
      'ad.audit.export': 'Export CSV',
      'ad.audit.refresh': 'Refresh',
      'ad.audit.search': 'Search actor, entity, id, content…',
      'ad.audit.f_entity': 'Entity',
      'ad.audit.f_action': 'Action',
      'ad.audit.f_actor': 'Actor',
      'ad.audit.f_period': 'Period',
      'ad.audit.f_limit': 'Rows loaded',
      'ad.audit.all_entities': 'All entities',
      'ad.audit.all_actions': 'All actions',
      'ad.audit.all_actors': 'Everyone',
      'ad.audit.p_24h': '24 h',
      'ad.audit.p_7d': '7 days',
      'ad.audit.p_30d': '30 days',
      'ad.audit.p_all': 'All',
      'ad.audit.limit_n': 'latest {n}',
      'ad.audit.reset': 'Clear filters',
      'ad.audit.activity': '14-day activity',
      'ad.audit.activity_sub': '{n} changes · peak {max}/day',
      'ad.audit.count': '{from}–{to} of {n} entries',
      'ad.audit.prev': 'Previous page',
      'ad.audit.next': 'Next page',
      'ad.audit.col_time': 'Time',
      'ad.audit.col_actor': 'Actor',
      'ad.audit.col_action': 'Action',
      'ad.audit.col_entity': 'Entity',
      'ad.audit.col_change': 'Change',
      'ad.audit.details': 'Details',
      'ad.audit.empty': 'No matching entries',
      'ad.audit.empty_t': 'Try removing a filter or widening the period.',
      'ad.audit.a_insert': 'Created',
      'ad.audit.a_update': 'Updated',
      'ad.audit.a_delete': 'Deleted',
      'ad.audit.a_status': 'Status change',
      'ad.audit.a_publish': 'Published',
      'ad.audit.a_import.samples': 'Samples imported',
      'ad.audit.a_model.run': 'Interpolation run',
      'ad.audit.a_facility.verify': 'Facilities verified',
      'ad.audit.a_content.submit_review': 'Content sent for review',
      'ad.audit.a_pack.publish': 'Pack published',
      'ad.audit.a_buddy.overdue': 'Check-in overdue',
      'ad.audit.a_buddy.alert_sent': 'Alert e-mail sent',
      'ad.audit.a_submission.create': 'New submission',
      'ad.audit.e_signal_segments': 'Signal layer',
      'ad.audit.e_facilities': 'Facility',
      'ad.audit.e_services': 'Service',
      'ad.audit.e_facility_submissions': 'Community submission',
      'ad.audit.e_data_packs': 'Data pack',
      'ad.audit.e_content_releases': 'Medical content',
      'ad.audit.e_buddy_sessions': 'Buddy session',
      'ad.audit.e_signal_samples': 'Signal samples',
      'ad.audit.e_devices': 'Device',
      'ad.audit.system': 'System (cron)',
      'ad.audit.community': 'Community',
      'ad.audit.created': 'Created {name}',
      'ad.audit.deleted': 'Deleted {name}',
      'ad.audit.published': 'Published {name}',
      'ad.audit.more': '+{n} fields',
      'ad.audit.trip': 'survey {trip}',
      'ad.audit.d_title': 'Audit entry #{id}',
      'ad.audit.d_when': 'Time',
      'ad.audit.d_actor': 'Actor',
      'ad.audit.d_action': 'Action',
      'ad.audit.d_entity': 'Entity',
      'ad.audit.d_id': 'Entity id',
      'ad.audit.d_field': 'Field',
      'ad.audit.d_from': 'Before',
      'ad.audit.d_to': 'After',
      'ad.audit.d_raw': 'Raw data (JSON)',
      'ad.audit.d_open': 'Open related page',
      'ad.audit.copy_json': 'Copy JSON',
      'ad.audit.copied': 'Copied',
      'ad.audit.live_new': '{n} new entries',
      'ad.audit.exported': '{n} rows exported',
      'ad.audit.empty_val': '(empty)',
      'ad.audit.note': 'Read-only log. Sensitive fields (pack payloads, device secrets, medical layer) are never written to it.'
    }
  });

  var ENTITY_ICON = {
    signal_segments: 'layers', facilities: 'hospital', services: 'bed', facility_submissions: 'users', data_packs: 'package',
    content_releases: 'book-open', buddy_sessions: 'shield', signal_samples: 'signal', devices: 'smartphone'
  };
  var ACTION_TONE = {
    insert: 'success', update: 'info', delete: 'danger', status: 'warning', publish: 'primary', 'import.samples': 'accent',
    'model.run': 'accent', 'facility.verify': 'success', 'content.submit_review': 'info', 'pack.publish': 'primary',
    'buddy.overdue': 'danger', 'buddy.alert_sent': 'danger', 'submission.create': 'info'
  };
  function isSystem(r) {
    var a = r.actor_label || r.actor || '';
    return NC.admin && NC.admin.isSystemActor ? NC.admin.isSystemActor(a) : /cron|^system$|hệ thống/i.test(a);
  }
  /** Actor filter key: every system/cron label is one actor (else the select lists "Hệ thống (cron)" twice). */
  function actorKey(r) { return isSystem(r) ? '@system' : (r.actor_label || r.actor || ''); }
  var ENTITY_PAGE = { facilities: 'facilities', services: 'facilities', facility_submissions: 'community', data_packs: 'packs', content_releases: 'packs', buddy_sessions: 'buddy', signal_samples: 'signal' };
  var PAGE = 50;
  var PERIOD_MS = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000, all: 0 };

  var state = { rows: [], q: '', entity: '', action: '', actor: '', period: 'all', limit: 500, page: 0, seen: null, flash: {}, names: {} };
  var el = {};
  var offRealtime = null;

  /* ------------------------------------------------------------ labels */

  function lbl(prefix, key) {
    var k = prefix + key;
    var s = t(k);
    return s === k ? key : s;
  }
  function actionLabel(a) { return lbl('ad.audit.a_', a || '–'); }
  function entityLabel(e) { return lbl('ad.audit.e_', e || '–'); }
  function actorLabel(r) {
    var a = r.actor_label || r.actor || '';
    if (NC.admin && NC.admin.actorLabel) return NC.admin.actorLabel(a); // shared with the overview feed
    if (isSystem(r)) return t('ad.audit.system');
    if (/^cộng đồng$|^community$/i.test(a)) return t('ad.audit.community');
    return a || '–';
  }
  function valText(v) {
    if (v === null || v === undefined || v === '') return t('ad.audit.empty_val');
    if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
    if (typeof v === 'object') { var s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; }
    var str = String(v);
    return str.length > 60 ? str.slice(0, 57) + '…' : str;
  }
  /** Display name of the audited entity (from the row snapshot or a lookup table). */
  function entityName(r) {
    var d = r.details || {};
    var row = d.row || {};
    if (row.name) return row.name;
    if (row.version && r.entity === 'content_releases') return row.version;
    if (r.entity === 'data_packs' && (row.route_id || row.version)) return kit.routeShort(row.route_id) + ' · ' + kit.carrierName(row.carrier) + ' v' + row.version;
    if (r.entity === 'signal_samples' && r.entity_id) return kit.routeShort(r.entity_id);
    var n = state.names[r.entity + ':' + r.entity_id];
    return n || (r.entity_id ? String(r.entity_id).slice(0, 12) : '–');
  }
  /** One-line human summary of the change. */
  function summary(r) {
    var d = r.details || {};
    if (d.changed && typeof d.changed === 'object') {
      var keys = Object.keys(d.changed);
      var parts = keys.slice(0, 2).map(function (k) { return k + ': ' + valText(d.changed[k].from) + ' → ' + valText(d.changed[k].to); });
      return parts.join(' · ') + (keys.length > 2 ? ' · ' + t('ad.audit.more', { n: keys.length - 2 }) : '');
    }
    if (d.from !== undefined || d.to !== undefined) return valText(d.from) + ' → ' + valText(d.to);
    if (r.action === 'insert') return t('ad.audit.created', { name: entityName(r) });
    if (r.action === 'delete') return t('ad.audit.deleted', { name: entityName(r) });
    if (r.action === 'publish') return t('ad.audit.published', { name: entityName(r) });
    if (r.action === 'import.samples') return [d.source, d.trip ? t('ad.audit.trip', { trip: U.fmtDate(d.trip) }) : null].filter(Boolean).join(' · ');
    var keys2 = Object.keys(d).filter(function (k) { return k !== 'seed'; });
    return keys2.length ? keys2.slice(0, 3).map(function (k) { return k + ': ' + valText(d[k]); }).join(' · ') : '–';
  }
  function haystack(r) {
    return U.normalize([actorLabel(r), r.action, actionLabel(r.action), r.entity, entityLabel(r.entity), r.entity_id, entityName(r), summary(r)].join(' '));
  }

  /* ------------------------------------------------------------ mount */

  function mount(section) {
    el.root = h('div', { class: 'ad-pg ad-audit' });
    section.appendChild(el.root);
    var exp = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'export', html: icon('download') + '<span data-i18n="ad.audit.export">' + esc(t('ad.audit.export')) + '</span>' });
    var refresh = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'refresh', html: icon('refresh') + '<span data-i18n="ad.audit.refresh">' + esc(t('ad.audit.refresh')) + '</span>' });
    el.root.appendChild(kit.head({ icon: 'history', tone: 'neutral', titleKey: 'ad.audit.title', subKey: 'ad.audit.subtitle', actions: [refresh, exp] }));

    el.search = h('input', { type: 'search', class: 'input', placeholder: t('ad.audit.search'), 'aria-label': t('ad.audit.search'), 'data-i18n-attr': 'placeholder:ad.audit.search;aria-label:ad.audit.search' });
    el.entity = h('select', { class: 'select', 'aria-label': t('ad.audit.f_entity') });
    el.action = h('select', { class: 'select', 'aria-label': t('ad.audit.f_action') });
    el.actor = h('select', { class: 'select', 'aria-label': t('ad.audit.f_actor') });
    el.limit = h('select', { class: 'select', 'aria-label': t('ad.audit.f_limit') });
    el.period = h('div', { class: 'segmented ad-audit-period', 'aria-label': t('ad.audit.f_period') },
      ['24h', '7d', '30d', 'all'].map(function (p) { return h('button', { type: 'button', class: 'segmented__btn', 'data-value': p, 'data-i18n': 'ad.audit.p_' + p }, t('ad.audit.p_' + p)); }));
    el.reset = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-act': 'reset', hidden: true, html: icon('x') + '<span data-i18n="ad.audit.reset">' + esc(t('ad.audit.reset')) + '</span>' });
    el.spark = h('div', { class: 'ad-audit-spark' });
    el.sparkSub = h('span', { class: 'ad-audit-spark__sub' });
    el.root.appendChild(h('section', { class: 'card ad-audit-filters' },
      h('div', { class: 'ad-audit-filters__row' },
        h('div', { class: 'input-group ad-audit-search' }, NC.ui.iconEl('search'), el.search),
        el.period),
      h('div', { class: 'ad-audit-filters__row ad-audit-filters__selects' }, el.entity, el.action, el.actor, el.limit, el.reset),
      h('div', { class: 'ad-audit-filters__row ad-audit-filters__bottom' },
        el.chips = h('div', { class: 'chip-group ad-audit-chips' }),
        h('div', { class: 'ad-audit-sparkwrap' }, h('div', { class: 'ad-audit-spark__text' }, h('span', { class: 'ad-pg-label', 'data-i18n': 'ad.audit.activity' }, t('ad.audit.activity')), el.sparkSub), el.spark))));

    el.count = h('span', { class: 'ad-audit-count' });
    el.prev = h('button', { type: 'button', class: 'btn btn--outline btn--sm btn--icon', 'data-act': 'prev', 'aria-label': t('ad.audit.prev'), title: t('ad.audit.prev'), html: icon('chevron-left') });
    el.next = h('button', { type: 'button', class: 'btn btn--outline btn--sm btn--icon', 'data-act': 'next', 'aria-label': t('ad.audit.next'), title: t('ad.audit.next'), html: icon('chevron-right') });
    el.table = h('div', { class: 'ad-audit-tablewrap' });
    el.root.appendChild(h('section', { class: 'card ad-audit-card' },
      el.table,
      h('div', { class: 'ad-audit-pager' }, el.count, h('div', { class: 'cluster cluster--nowrap' }, el.prev, el.next))));
    el.root.appendChild(h('p', { class: 'ad-pg-foot', 'data-i18n': 'ad.audit.note' }, t('ad.audit.note')));

    el.periodSeg = NC.ui.segmented(el.period, { value: state.period, onChange: function (v) { state.period = v; state.page = 0; render(); } });
    el.root.addEventListener('click', onClick);
    el.root.addEventListener('change', function (e) {
      var tg = e.target;
      if (tg === el.entity) state.entity = tg.value;
      else if (tg === el.action) state.action = tg.value;
      else if (tg === el.actor) state.actor = tg.value;
      else if (tg === el.limit) { state.limit = +tg.value; reload(); return; }
      else return;
      state.page = 0;
      render();
    });
    el.search.addEventListener('input', U.debounce(function () { state.q = el.search.value; state.page = 0; render(); }, 180));
    NC.bus.on('i18n:change', function () { NC.i18n.apply(el.root); render(); });
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !el.root.contains(b)) return;
    var act = b.getAttribute('data-act');
    if (act === 'refresh') reload();
    else if (act === 'export') exportCsv();
    else if (act === 'prev') { state.page = Math.max(0, state.page - 1); renderTable(filtered()); }
    else if (act === 'next') { state.page++; renderTable(filtered()); }
    else if (act === 'reset') {
      state.q = ''; state.entity = ''; state.action = ''; state.actor = ''; state.period = 'all'; state.page = 0;
      el.search.value = ''; el.periodSeg.set('all');
      render();
    }
    else if (act === 'chip') { var a = b.getAttribute('data-value'); state.action = state.action === a ? '' : a; state.page = 0; render(); }
    else if (act === 'row') openDetail(b.getAttribute('data-id'));
  }

  /* ------------------------------------------------------------ data */

  function reload() {
    var A = NC.data.admin;
    return Promise.all([
      A.audit({ limit: state.limit }),
      A.listFacilities({}).catch(function () { return []; }),
      A.listServices({}).catch(function () { return []; }),
      A.listBuddySessions().catch(function () { return []; }),
      A.listContentReleases().catch(function () { return []; }),
      kit.routes()
    ]).then(function (r) {
      var rows = r[0] || [];
      if (state.seen) rows.forEach(function (x) { if (!state.seen[x.id]) state.flash[x.id] = true; });
      state.seen = {};
      rows.forEach(function (x) { state.seen[x.id] = true; });
      state.rows = rows;
      var names = {};
      (r[1] || []).forEach(function (f) { names['facilities:' + f.id] = f.name; });
      (r[2] || []).forEach(function (s) { names['services:' + s.id] = s.name; });
      (r[3] || []).forEach(function (s) { names['buddy_sessions:' + s.id] = s.traveler_name; });
      (r[4] || []).forEach(function (c) { names['content_releases:' + c.id] = c.version; });
      state.names = names;
      render();
      setTimeout(function () { state.flash = {}; }, 2600);
    }).catch(kit.toastErr);
  }

  function filtered() {
    var q = U.normalize(state.q || '').trim();
    var since = PERIOD_MS[state.period] ? Date.now() - PERIOD_MS[state.period] : 0;
    return state.rows.filter(function (r) {
      if (state.entity && r.entity !== state.entity) return false;
      if (state.action && r.action !== state.action) return false;
      if (state.actor && actorKey(r) !== state.actor) return false;
      if (since && Date.parse(r.created_at) < since) return false;
      if (q && haystack(r).indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------ render */

  function uniq(list) { var s = {}; list.forEach(function (x) { if (x) s[x] = true; }); return Object.keys(s).sort(); }

  function fillSelect(sel, allKey, values, labelFn, cur) {
    sel.innerHTML = '';
    sel.appendChild(h('option', { value: '' }, t(allKey)));
    values.forEach(function (v) { sel.appendChild(h('option', { value: v }, labelFn(v))); });
    if (cur && values.indexOf(cur) < 0) sel.appendChild(h('option', { value: cur }, labelFn(cur)));
    sel.value = cur || '';
  }

  function render() {
    fillSelect(el.entity, 'ad.audit.all_entities', uniq(state.rows.map(function (r) { return r.entity; })), entityLabel, state.entity);
    fillSelect(el.action, 'ad.audit.all_actions', uniq(state.rows.map(function (r) { return r.action; })), actionLabel, state.action);
    fillSelect(el.actor, 'ad.audit.all_actors', uniq(state.rows.map(actorKey)), function (a) { return actorLabel({ actor_label: a === '@system' ? 'cron' : a }); }, state.actor);
    el.limit.innerHTML = '';
    [200, 500, 1000].forEach(function (n) { el.limit.appendChild(h('option', { value: n, selected: n === state.limit }, t('ad.audit.limit_n', { n: n }))); });
    el.limit.value = String(state.limit);
    el.reset.hidden = !(state.q || state.entity || state.action || state.actor || state.period !== 'all');
    var rows = filtered();
    renderChips(rows);
    renderSpark();
    renderTable(rows);
  }

  function renderChips(rows) {
    var by = {};
    rows.forEach(function (r) { by[r.action] = (by[r.action] || 0) + 1; });
    if (state.action && !by[state.action]) by[state.action] = 0;
    el.chips.innerHTML = '';
    Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).forEach(function (a) {
      var on = state.action === a;
      el.chips.appendChild(h('button', {
        type: 'button', class: 'chip chip--soft ad-audit-chip ad-audit-chip--' + (ACTION_TONE[a] || 'neutral') + (on ? ' is-selected' : ''), 'data-act': 'chip', 'data-value': a, 'aria-pressed': on ? 'true' : 'false'
      }, h('span', { class: 'ad-audit-chip__dot', 'aria-hidden': 'true' }), actionLabel(a), h('b', null, U.fmtNumber(by[a]))));
    });
  }

  function renderSpark() {
    var days = 14, now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (days - 1) * 86400000;
    var counts = [];
    for (var i = 0; i < days; i++) counts.push(0);
    state.rows.forEach(function (r) {
      var ts = Date.parse(r.created_at);
      if (!(ts >= start)) return;
      var idx = Math.floor((ts - start) / 86400000);
      if (idx >= 0 && idx < days) counts[idx]++;
    });
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, counts);
    el.sparkSub.textContent = t('ad.audit.activity_sub', { n: U.fmtNumber(total), max: max });
    el.spark.innerHTML = '';
    // Mini column chart (one bar per day) — crisper than a line for sparse admin activity.
    var W = 168, H = 36, gap = 2, bw = (W - gap * (days - 1)) / days;
    var svg = h('svg', { class: 'ad-audit-spark__svg', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': t('ad.audit.activity') + ': ' + total });
    counts.forEach(function (c, j) {
      var hh = max ? Math.max(c ? 3 : 1.5, c / max * (H - 2)) : 1.5;
      var d = new Date(start + j * 86400000);
      svg.appendChild(h('rect', { class: 'ad-audit-spark__bar' + (c ? '' : ' is-zero') + (j === days - 1 ? ' is-today' : ''), x: (j * (bw + gap)).toFixed(1), y: (H - hh).toFixed(1), width: bw.toFixed(1), height: hh.toFixed(1), rx: 1.5 },
        h('title', null, U.fmtDate(d) + ': ' + c)));
    });
    el.spark.appendChild(svg);
  }

  function renderTable(rows) {
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    var from = state.page * PAGE, list = rows.slice(from, from + PAGE);
    el.count.textContent = rows.length ? t('ad.audit.count', { from: from + 1, to: from + list.length, n: U.fmtNumber(rows.length) }) : '';
    el.prev.disabled = state.page <= 0;
    el.next.disabled = state.page >= pages - 1;
    el.table.innerHTML = '';
    if (!list.length) {
      el.table.appendChild(NC.ui.emptyState({ icon: 'history', title: t('ad.audit.empty'), text: t('ad.audit.empty_t'), compact: true }));
      return;
    }
    var table = h('table', { class: 'table ad-audit-table' },
      h('thead', null, h('tr', null,
        h('th', null, t('ad.audit.col_time')), h('th', null, t('ad.audit.col_action')), h('th', null, t('ad.audit.col_entity')),
        h('th', null, t('ad.audit.col_change')), h('th', null, t('ad.audit.col_actor')), h('th', null, h('span', { class: 'visually-hidden' }, t('ad.audit.details'))))),
      h('tbody', null, list.map(function (r) {
        var tone = ACTION_TONE[r.action] || 'neutral';
        return h('tr', { class: state.flash[r.id] ? 'ad-pg-flash' : null, 'data-id': r.id },
          h('td', { 'data-label': t('ad.audit.col_time'), class: 'ad-audit-time' },
            h('span', { class: 'ad-audit-time__abs' }, U.fmtDateTime(r.created_at)),
            h('span', { class: 'ad-audit-time__rel' }, U.relTime(r.created_at))),
          h('td', { 'data-label': t('ad.audit.col_action'), class: 'ad-audit-action' }, h('span', { class: 'badge badge--' + tone }, actionLabel(r.action))),
          h('td', { 'data-label': t('ad.audit.col_entity'), class: 'ad-audit-entity' },
            h('span', { class: 'ad-audit-entity__wrap' },
              h('span', { class: 'icon-tile icon-tile--sm icon-tile--neutral', html: icon(ENTITY_ICON[r.entity] || 'file-text') }),
              h('span', { class: 'ad-audit-entity__text' },
                h('span', { class: 'ad-audit-entity__type' }, entityLabel(r.entity)),
                h('span', { class: 'ad-audit-entity__name', title: r.entity_id || '' }, entityName(r))))),
          h('td', { 'data-label': t('ad.audit.col_change'), class: 'ad-audit-change' }, h('span', { class: 'ad-audit-change__text' }, summary(r))),
          h('td', { 'data-label': t('ad.audit.col_actor'), class: 'ad-audit-actor' }, h('span', { class: 'ad-audit-actor__wrap' },
            h('span', { class: 'ad-audit-avatar' + (isSystem(r) ? ' is-system' : ''), 'aria-hidden': 'true', html: isSystem(r) ? icon('clock', 'icon--xs') : esc(String(actorLabel(r)).charAt(0).toUpperCase()) }),
            h('span', { class: 'truncate' }, actorLabel(r)))),
          h('td', { class: 'ad-audit-go' }, h('button', {
            type: 'button', class: 'btn btn--ghost btn--sm', 'data-act': 'row', 'data-id': r.id, 'aria-label': t('ad.audit.details') + ' #' + r.id,
            html: '<span class="ad-audit-go__lbl">' + esc(t('ad.audit.details')) + '</span>' + icon('chevron-right')
          })));
      })));
    el.table.appendChild(h('div', { class: 'table-wrap' }, table));
  }

  /* ------------------------------------------------------------ detail */

  function openDetail(id) {
    var r = state.rows.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!r) return;
    var d = r.details || {};
    var body = h('div', { class: 'stack ad-audit-detail' });
    body.appendChild(h('dl', { class: 'kv' }, [
      [t('ad.audit.d_when'), U.fmtDateTime(r.created_at) + ' (' + U.relTime(r.created_at) + ')'],
      [t('ad.audit.d_actor'), actorLabel(r)],
      [t('ad.audit.d_action'), actionLabel(r.action)],
      [t('ad.audit.d_entity'), entityLabel(r.entity) + ' · ' + entityName(r)],
      [t('ad.audit.d_id'), r.entity_id || '–']
    ].map(function (kv) { return h('div', { class: 'kv__row' }, h('dt', null, kv[0]), h('dd', null, kv[1])); })));
    var changes = null;
    if (d.changed && typeof d.changed === 'object') changes = Object.keys(d.changed).map(function (k) { return [k, d.changed[k].from, d.changed[k].to]; });
    else if (d.from !== undefined || d.to !== undefined) changes = [['status', d.from, d.to]];
    if (changes && changes.length) {
      body.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'table table--keep ad-audit-diff' },
        h('thead', null, h('tr', null, h('th', null, t('ad.audit.d_field')), h('th', null, t('ad.audit.d_from')), h('th', null, t('ad.audit.d_to')))),
        h('tbody', null, changes.map(function (c) {
          return h('tr', null, h('td', { class: 'mono' }, c[0]),
            h('td', { class: 'ad-audit-diff__from' }, c[1] === null || c[1] === undefined ? t('ad.audit.empty_val') : (typeof c[1] === 'object' ? JSON.stringify(c[1]) : String(c[1]))),
            h('td', { class: 'ad-audit-diff__to' }, c[2] === null || c[2] === undefined ? t('ad.audit.empty_val') : (typeof c[2] === 'object' ? JSON.stringify(c[2]) : String(c[2]))));
        })))));
    }
    var json = JSON.stringify(d, null, 2);
    body.appendChild(h('details', { class: 'ad-audit-raw', open: !changes },
      h('summary', null, t('ad.audit.d_raw')),
      h('pre', { class: 'ad-audit-pre' }, json)));
    var actions = [
      { label: t('ad.audit.copy_json'), variant: 'ghost', icon: 'copy', close: false, onClick: function () { U.copyText(json).then(function (ok) { if (ok) NC.ui.toast(t('ad.audit.copied'), { type: 'success', timeout: 1600 }); }); return false; } }
    ];
    var page = ENTITY_PAGE[r.entity];
    if (page && NC.admin && NC.admin.go) {
      actions.push({
        label: t('ad.audit.d_open'), variant: 'primary', icon: 'arrow-up-right', onClick: function () {
          var params = {};
          if (page === 'buddy' && r.entity_id) params.id = r.entity_id;
          if (page === 'signal' && r.entity_id) params.route = r.entity_id;
          if (page === 'packs' && d.row && d.row.route_id) params.route = d.row.route_id;
          if (page === 'facilities' && r.entity_id && r.entity === 'facilities') params.id = r.entity_id;
          setTimeout(function () { NC.admin.go(page, params); }, 0);
        }
      });
    }
    NC.ui.modal({ title: t('ad.audit.d_title', { id: r.id }), icon: ENTITY_ICON[r.entity] || 'history', iconVariant: 'neutral', size: 'md', body: body, actions: actions });
  }

  /* ------------------------------------------------------------ export */

  /* Shared spreadsheet-safe encoder (formula-injection guard + quoting): a community-submitted facility name such as
     =HYPERLINK(…) must never become a live formula in the exported audit log. */
  function csvCell(v) {
    if (NC.admin && typeof NC.admin.csvCell === 'function') return NC.admin.csvCell(v);
    var s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(?:[.,]\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var rows = filtered();
    var head = ['id', 'created_at', 'actor', 'action', 'entity', 'entity_id', 'entity_name', 'summary', 'details'];
    var lines = [head.map(csvCell).join(',')].concat(rows.map(function (r) {
      return [r.id, r.created_at, actorLabel(r), r.action, r.entity, r.entity_id, entityName(r), summary(r), JSON.stringify(r.details || {})].map(csvCell).join(',');
    }));
    var d = new Date();
    var name = 'nomadcare-audit-' + d.getFullYear() + String(d.getMonth() + 1).replace(/^(\d)$/, '0$1') + String(d.getDate()).replace(/^(\d)$/, '0$1') + '.csv';
    U.downloadBlob(name, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    NC.ui.toast(t('ad.audit.exported', { n: rows.length }), { type: 'success', timeout: 2500 });
  }

  /* ------------------------------------------------------------ lifecycle */

  function show(params) {
    params = params || {};
    if (params.entity) state.entity = params.entity;
    if (params.action) state.action = params.action;
    if (params.q) { state.q = params.q; el.search.value = params.q; }
    reload();
    if (!offRealtime) {
      offRealtime = kit.subscribe(['audit_log', 'facilities', 'services', 'facility_submissions', 'data_packs', 'content_releases', 'buddy_sessions'], function () { reload(); }, 800);
    }
  }
  function hide() { if (offRealtime) { offRealtime(); offRealtime = null; } }

  kit.register('audit', {
    titleKey: 'ad.audit.title',
    navKey: 'ad.audit.nav',
    icon: 'history',
    order: 80,
    group: 'system',
    mount: mount,
    show: show,
    hide: hide
  });
})(window.NC = window.NC || {});
