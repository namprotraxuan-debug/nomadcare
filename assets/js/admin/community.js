/*
 * community.js — Admin "Đóng góp cộng đồng" page (owner: P2 admin-core). Registers NC.admin page 'community'.
 * Review queue of facility_submissions sent by devices (kinds new / correction / closed / signal_report): status tabs,
 * kind chips, list + detail split (drawer below 1200 px) with payload preview (current → proposed diff for corrections),
 * mini map (submission point, linked facility, distance), approve / reject with a review note, history and reopen.
 * Deep links: #/community?status=pending|approved|rejected|all&kind=&id=<submission id>
 */
(function (NC) {
  'use strict';

  var U = NC.util, h = U.h, $$ = U.$$;
  var A = NC.admin;
  function t(k, v) { return NC.i18n.t(k, v); }
  function icon(n, c) { return NC.ui.icon(n, c); }

  var KINDS = ['new', 'correction', 'closed', 'signal_report'];
  var KIND_ICON = { 'new': ['plus', 'primary'], correction: ['edit', 'info'], closed: ['x-circle', 'danger'], signal_report: ['signal-off', 'warning'] };
  var FIELD_KEYS = ['name', 'type', 'address', 'phone', 'open_hours', 'night_shift', 'trauma_capable', 'lat', 'lng'];

  NC.i18n.add({
    vi: {
      'ad.com.title': 'Đóng góp cộng đồng', 'ad.com.nav': 'Cộng đồng',
      'ad.com.head': 'Hàng đợi đóng góp từ người dùng',
      'ad.com.sub': 'Người dùng báo điểm y tế mới, đề xuất sửa, báo đóng cửa hoặc báo cáo sóng ngay trong ứng dụng — kể cả khi offline (gửi bù khi có sóng). Mọi đóng góp được kiểm duyệt tại đây trước khi nhập vào lớp dữ liệu chính.',
      'ad.com.st.pending': 'Chờ duyệt', 'ad.com.st.approved': 'Đã duyệt', 'ad.com.st.rejected': 'Từ chối', 'ad.com.st.all': 'Tất cả',
      'ad.com.kind_all': 'Mọi loại',
      'ad.com.kind.new': 'Điểm y tế mới', 'ad.com.kind.correction': 'Đề xuất sửa', 'ad.com.kind.closed': 'Báo đóng cửa', 'ad.com.kind.signal_report': 'Báo cáo sóng',
      'ad.com.empty': 'Không còn đóng góp nào chờ duyệt', 'ad.com.empty_text': 'Đóng góp mới từ ứng dụng sẽ hiện ở đây theo thời gian thực.',
      'ad.com.empty_other': 'Không có đóng góp nào ở mục này',
      'ad.com.pick': 'Chọn một đóng góp để xem chi tiết',
      'ad.com.pick_text': 'Xem nội dung, vị trí trên bản đồ rồi duyệt hoặc từ chối kèm ghi chú.',
      'ad.com.device': 'Thiết bị ẩn danh {id}', 'ad.com.no_device': 'Không rõ thiết bị',
      'ad.com.received': 'Nhận lúc {time}',
      'ad.com.sec_payload': 'Nội dung đóng góp', 'ad.com.sec_map': 'Vị trí', 'ad.com.sec_review': 'Kiểm duyệt',
      'ad.com.p.name': 'Tên đề xuất', 'ad.com.p.type': 'Loại hình', 'ad.com.p.note': 'Ghi chú của người dùng', 'ad.com.p.coords': 'Toạ độ gửi kèm',
      'ad.com.content': 'Báo lỗi nội dung y tế', 'ad.com.p.module': 'Phần nội dung', 'ad.com.p.ref': 'Mã câu / mục',
      'ad.com.mod.phrases': 'Dịch y tế (MOD.01)', 'ad.com.mod.firstaid': 'Sơ cứu (MOD.05)', 'ad.com.mod.other': 'Khác',
      'ad.com.p.facility': 'Điểm y tế liên quan', 'ad.com.p.field': 'Trường đề xuất sửa', 'ad.com.p.current': 'Hiện tại', 'ad.com.p.proposed': 'Đề xuất',
      'ad.com.p.carrier': 'Nhà mạng', 'ad.com.p.level': 'Mức sóng người dùng gặp', 'ad.com.p.route': 'Cung đường gần nhất',
      'ad.com.p.status': 'Trạng thái hiện tại', 'ad.com.p.raw': 'Dữ liệu gốc (JSON)',
      'ad.com.dist': 'Cách điểm y tế {d}',
      'ad.com.on_approve': 'Khi duyệt',
      'ad.com.eff.new': 'Tạo một điểm y tế ở trạng thái “Chờ duyệt” (nguồn: cộng đồng) với các trường đã có. Nhóm vẫn phải gọi xác thực đủ 10 trường trước khi phát hành.',
      'ad.com.eff.correction': 'Ghi đề xuất vào ghi chú của điểm y tế để người xác thực kiểm tra lại qua điện thoại. Dữ liệu phát hành không tự thay đổi.',
      'ad.com.eff.closed': 'Điểm y tế đang “Đã xác thực” sẽ chuyển về “Chờ duyệt” và bị rút khỏi lần phát hành gói tiếp theo cho tới khi xác minh lại.',
      'ad.com.eff.signal_report': 'Ghi nhận báo cáo; dùng để ưu tiên đo lại và duyệt mẫu sóng cộng đồng trên trang Lớp phủ sóng.',
      'ad.com.note': 'Ghi chú kiểm duyệt', 'ad.com.note_ph': 'Ví dụ: đã gọi xác minh, trạm đổi giờ trực…',
      'ad.com.note_hint': 'Lưu trong nhật ký kiểm duyệt, không gửi cho người dùng.',
      'ad.com.approve': 'Duyệt', 'ad.com.reject': 'Từ chối', 'ad.com.reopen': 'Mở lại để duyệt',
      'ad.com.reject_need_note': 'Nhập lý do từ chối để nhóm khác nắm được.',
      'ad.com.approved_toast': 'Đã duyệt đóng góp {id}', 'ad.com.rejected_toast': 'Đã từ chối đóng góp {id}', 'ad.com.reopened_toast': 'Đóng góp {id} đã về hàng chờ',
      'ad.com.open_fac': 'Mở điểm y tế', 'ad.com.open_new_fac': 'Xác thực điểm mới', 'ad.com.open_signal': 'Xem lớp sóng',
      'ad.com.republish': 'Phát hành lại gói', 'ad.com.closed_toast': 'Đã duyệt báo đóng cửa {id}: điểm y tế về “Chờ xác thực” — gói offline vẫn còn điểm này cho tới khi phát hành lại.',
      'ad.com.reviewed': 'Đã xử lý {time}', 'ad.com.review_note': 'Ghi chú: {note}',
      'ad.com.new_arrived': 'Có đóng góp mới từ cộng đồng', 'ad.com.show': 'Xem',
      'ad.com.none': '—', 'ad.com.lvl.likely': 'Có sóng', 'ad.com.lvl.uncertain': 'Chập chờn', 'ad.com.lvl.lost': 'Mất sóng',
      'ad.com.privacy': 'Đóng góp không chứa danh tính người gửi — chỉ mã thiết bị ngẫu nhiên và toạ độ tại thời điểm báo.',
      'ad.com.count': '{n} đóng góp', 'ad.com.back': 'Danh sách'
    },
    en: {
      'ad.com.title': 'Community contributions', 'ad.com.nav': 'Community',
      'ad.com.head': 'Traveller contribution queue',
      'ad.com.sub': 'Travellers report new medical points, corrections, closures or signal problems from the app — even offline (sent once signal returns). Every contribution is reviewed here before it enters the main data layer.',
      'ad.com.st.pending': 'Pending', 'ad.com.st.approved': 'Approved', 'ad.com.st.rejected': 'Rejected', 'ad.com.st.all': 'All',
      'ad.com.kind_all': 'All kinds',
      'ad.com.kind.new': 'New facility', 'ad.com.kind.correction': 'Correction', 'ad.com.kind.closed': 'Closure report', 'ad.com.kind.signal_report': 'Signal report',
      'ad.com.empty': 'No contribution waiting for review', 'ad.com.empty_text': 'New contributions from the app appear here in real time.',
      'ad.com.empty_other': 'No contribution in this view',
      'ad.com.pick': 'Select a contribution to see the details',
      'ad.com.pick_text': 'Check the content and its location on the map, then approve or reject with a note.',
      'ad.com.device': 'Anonymous device {id}', 'ad.com.no_device': 'Unknown device',
      'ad.com.received': 'Received {time}',
      'ad.com.sec_payload': 'Contribution', 'ad.com.sec_map': 'Location', 'ad.com.sec_review': 'Review',
      'ad.com.p.name': 'Proposed name', 'ad.com.p.type': 'Type', 'ad.com.p.note': 'Traveller note', 'ad.com.p.coords': 'Reported coordinates',
      'ad.com.content': 'Medical content error', 'ad.com.p.module': 'Content area', 'ad.com.p.ref': 'Phrase code / item',
      'ad.com.mod.phrases': 'Medical phrases (MOD.01)', 'ad.com.mod.firstaid': 'First aid (MOD.05)', 'ad.com.mod.other': 'Other',
      'ad.com.p.facility': 'Related facility', 'ad.com.p.field': 'Field to correct', 'ad.com.p.current': 'Current', 'ad.com.p.proposed': 'Proposed',
      'ad.com.p.carrier': 'Carrier', 'ad.com.p.level': 'Signal experienced', 'ad.com.p.route': 'Nearest route',
      'ad.com.p.status': 'Current status', 'ad.com.p.raw': 'Raw data (JSON)',
      'ad.com.dist': '{d} from the facility',
      'ad.com.on_approve': 'On approval',
      'ad.com.eff.new': 'Creates a “Pending” facility (source: community) with the fields provided. The team still has to verify all 10 fields by phone before it is published.',
      'ad.com.eff.correction': 'Adds the proposal to the facility notes so the verifier re-checks it by phone. Published data does not change automatically.',
      'ad.com.eff.closed': 'A “Verified” facility goes back to “Pending” and is left out of the next pack release until re-verified.',
      'ad.com.eff.signal_report': 'Acknowledges the report; use it to prioritise re-measuring and reviewing community samples on the Signal page.',
      'ad.com.note': 'Review note', 'ad.com.note_ph': 'e.g. called to confirm, station changed its night shift…',
      'ad.com.note_hint': 'Stored in the review log, never sent to the traveller.',
      'ad.com.approve': 'Approve', 'ad.com.reject': 'Reject', 'ad.com.reopen': 'Reopen for review',
      'ad.com.reject_need_note': 'Add a reason so the rest of the team knows why.',
      'ad.com.approved_toast': 'Contribution {id} approved', 'ad.com.rejected_toast': 'Contribution {id} rejected', 'ad.com.reopened_toast': 'Contribution {id} is back in the queue',
      'ad.com.open_fac': 'Open facility', 'ad.com.open_new_fac': 'Verify new facility', 'ad.com.open_signal': 'Open signal layer',
      'ad.com.republish': 'Republish pack', 'ad.com.closed_toast': 'Closure report {id} approved: the facility is back to “pending” — offline packs still list it until you republish.',
      'ad.com.reviewed': 'Reviewed {time}', 'ad.com.review_note': 'Note: {note}',
      'ad.com.new_arrived': 'New community contribution', 'ad.com.show': 'Show',
      'ad.com.none': '—', 'ad.com.lvl.likely': 'Signal', 'ad.com.lvl.uncertain': 'Patchy', 'ad.com.lvl.lost': 'No signal',
      'ad.com.privacy': 'Contributions carry no identity — only a random device ID and the coordinates at the time of the report.',
      'ad.com.count': '{n} contributions', 'ad.com.back': 'List'
    }
  });

  /* ------------------------------------------------------------------ state */
  var root = null, els = {};
  var S = { subs: [], facs: [], status: 'pending', kind: '', selected: null, visible: false, seq: 0, map: null, drawer: null, fresh: {} };

  function blank(v) { return v === null || v === undefined || v === ''; }
  function kindLabel(k) { return NC.i18n.has('ad.com.kind.' + k) ? t('ad.com.kind.' + k) : k; }
  function facById(id) { return S.facs.filter(function (f) { return f.id === id; })[0] || null; }
  function isWide() { return window.matchMedia ? window.matchMedia('(min-width: 1200px)').matches : window.innerWidth >= 1200; }
  function point(s) {
    var p = s.payload || {};
    var lat = !blank(s.lat) ? +s.lat : (!blank(p.lat) ? +p.lat : null);
    var lng = !blank(s.lng) ? +s.lng : (!blank(p.lng) ? +p.lng : null);
    return lat !== null && lng !== null && isFinite(lat) && isFinite(lng) ? { lat: lat, lng: lng } : null;
  }
  function routeFor(s) {
    var f = s.facility_id ? facById(s.facility_id) : null;
    if (f && f.route_id) return f.route_id;
    if (s.payload && s.payload.route_id) return s.payload.route_id;
    var pt = point(s);
    if (!pt) return null;
    var best = null;
    A.routes().forEach(function (r) {
      var b = r.bbox || [];
      var pad = 0.25;
      if (pt.lat >= b[0] - pad && pt.lat <= b[2] + pad && pt.lng >= b[1] - pad && pt.lng <= b[3] + pad) {
        var c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        var d = Math.abs(c[0] - pt.lat) + Math.abs(c[1] - pt.lng);
        if (!best || d < best.d) best = { d: d, id: r.id };
      }
    });
    return best ? best.id : null;
  }
  /** Content-error reports from the traveller app (settings → "Báo lỗi nội dung"): {module, ref} or null. */
  function contentInfo(s) {
    var p = s.payload || {};
    if (p.area === 'content') return { module: p.module || 'other', ref: p.ref || null };
    var m = /^content:([a-z]+)(?::(.+))?$/.exec(p.name || '');
    return m ? { module: m[1], ref: m[2] || null } : null;
  }
  function moduleLabel(m) { return NC.i18n.has('ad.com.mod.' + m) ? t('ad.com.mod.' + m) : m; }
  function titleOf(s) {
    var p = s.payload || {};
    var ci = contentInfo(s);
    if (ci) return t('ad.com.content') + ' · ' + moduleLabel(ci.module);
    if (s.kind === 'new') return p.name || kindLabel('new');
    var f = s.facility_id ? facById(s.facility_id) : null;
    if (s.kind === 'signal_report') return kindLabel('signal_report') + (p.carrier ? ' · ' + A.carrierName(p.carrier) : '');
    return f ? f.name : (p.name || kindLabel(s.kind));
  }
  function fieldLabel(k) { return NC.i18n.has('ad.fac.f.' + k) ? t('ad.fac.f.' + k) : k; }
  function fmtVal(k, v) {
    if (v === true) return t('ad.fac.yes');
    if (v === false) return t('ad.fac.no');
    if (blank(v)) return t('ad.com.none');
    if (k === 'type') return A.facType(v);
    return String(v);
  }

  /* ------------------------------------------------------------------ mount */
  function mount(section) {
    root = section;
    root.classList.add('ad-com');
    els.head = h('div');
    els.tabs = h('div', { class: 'tabs ad-com-tabs', role: 'tablist' });
    els.kinds = h('div', { class: 'chip-group chip-group--scroll ad-com-kinds', role: 'group' });
    els.list = h('div', { class: 'ad-split__list ad-com-list', 'aria-live': 'polite' });
    els.detail = h('aside', { class: 'ad-split__detail ad-com-detail card', 'aria-label': t('ad.com.sec_payload') });
    els.privacy = h('p', { class: 'ad-muted-note ad-com-privacy' });
    root.appendChild(els.head);
    root.appendChild(els.tabs);
    root.appendChild(els.kinds);
    root.appendChild(h('div', { class: 'ad-split ad-com-split' }, els.list, els.detail));
    root.appendChild(els.privacy);
    buildStatic();
    root.addEventListener('click', onClick);
    A.live(function (msg) {
      if (!msg) return;
      if (msg.table === 'facility_submissions') {
        if (msg.type === 'INSERT' && msg.row) {
          S.fresh[msg.row.id] = Date.now();
          if (S.visible) NC.ui.toast(t('ad.com.new_arrived') + ': ' + kindLabel(msg.row.kind), { type: 'info', timeout: 5000, action: { label: t('ad.com.show'), onClick: function () { A.go('community', { status: 'pending', id: msg.row.id }); } } });
        }
        reload();
      } else if (msg.table === 'facilities' || msg.table === '*') reload();
    });
    NC.bus.on('i18n:change', function () { if (!root) return; buildStatic(); render(); });
  }

  function buildStatic() {
    els.head.innerHTML = '';
    els.head.appendChild(A.pageHead({ icon: 'message-square', tone: 'accent', title: t('ad.com.head'), sub: t('ad.com.sub'), meta: [NC.ui.demoBadge()] }));
    els.privacy.innerHTML = icon('lock') + '<span>' + U.esc(t('ad.com.privacy')) + '</span>';
  }

  /* ------------------------------------------------------------------ data */
  function load() {
    var k = ++S.seq;
    return Promise.all([NC.data.admin.listSubmissions({}), NC.data.admin.listFacilities({})]).then(function (r) {
      if (k !== S.seq) return;
      S.subs = r[0] || [];
      S.facs = r[1] || [];
      render();
    }).catch(function (e) {
      if (e && e.sessionLost) return; // the shell is back on the sign-in gate
      console.error('[admin/community] load failed', e);
      NC.ui.toast(A.errorText(e), { type: 'danger' });
    });
  }
  var reload = U.debounce(function () { if (S.visible) load(); }, 400);

  function filtered() {
    return S.subs.filter(function (s) {
      if (S.status !== 'all' && s.status !== S.status) return false;
      if (S.kind && s.kind !== S.kind) return false;
      return true;
    }).sort(function (a, b) {
      // pending queue: oldest first (FIFO); history: newest first
      var d = String(a.created_at).localeCompare(String(b.created_at));
      return S.status === 'pending' ? d : -d;
    });
  }

  /* ------------------------------------------------------------------ render */
  function render() {
    if (!root) return;
    var counts = { pending: 0, approved: 0, rejected: 0, all: S.subs.length };
    S.subs.forEach(function (s) { if (counts[s.status] !== undefined) counts[s.status]++; });
    els.tabs.innerHTML = '';
    ['pending', 'approved', 'rejected', 'all'].forEach(function (st) {
      var on = S.status === st;
      els.tabs.appendChild(h('button', { type: 'button', class: 'tab' + (on ? ' is-active' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', 'data-com-status': st },
        h('span', null, t('ad.com.st.' + st)), h('span', { class: 'ad-pill-count' + (st === 'pending' && counts.pending ? ' ad-pill-count--accent' : '') }, String(counts[st]))));
    });
    var base = S.subs.filter(function (s) { return S.status === 'all' || s.status === S.status; });
    els.kinds.innerHTML = '';
    [''].concat(KINDS).forEach(function (k) {
      var on = S.kind === k;
      var n = k ? base.filter(function (s) { return s.kind === k; }).length : base.length;
      var chip = h('button', { type: 'button', class: 'chip' + (on ? ' is-selected' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-com-kind': k });
      if (k) chip.innerHTML = icon(KIND_ICON[k][0]);
      chip.appendChild(document.createTextNode(k ? kindLabel(k) : t('ad.com.kind_all')));
      chip.appendChild(h('span', { class: 'ad-pill-count' }, String(n)));
      els.kinds.appendChild(chip);
    });
    renderList();
    var sel = S.selected ? S.subs.filter(function (s) { return s.id === S.selected; })[0] : null;
    if (isWide()) renderDetail(els.detail, sel);
    else if (S.drawer && sel) renderDetail(S.drawer.body.firstChild, sel);
  }

  function renderList() {
    var rows = filtered();
    els.list.innerHTML = '';
    if (!rows.length) {
      els.list.appendChild(h('div', { class: 'card ad-empty' }, NC.ui.emptyState({
        icon: S.status === 'pending' ? 'check-circle' : 'users', variant: S.status === 'pending' ? 'success' : 'neutral',
        title: S.status === 'pending' && !S.kind ? t('ad.com.empty') : t('ad.com.empty_other'), text: S.status === 'pending' ? t('ad.com.empty_text') : null
      })));
      return;
    }
    els.list.appendChild(h('p', { class: 'ad-toolbar__count ad-com-count' }, t('ad.com.count', { n: rows.length })));
    var ul = h('ul', { class: 'ad-com-items' });
    rows.forEach(function (s) {
      var ki = KIND_ICON[s.kind] || ['help-circle', 'neutral'];
      var rid = routeFor(s);
      var on = s.id === S.selected;
      var fresh = S.fresh[s.id] && Date.now() - S.fresh[s.id] < 8000;
      var btn = h('button', { type: 'button', class: 'ad-com-item' + (on ? ' is-selected' : '') + (fresh ? ' is-new' : ''), 'data-com-id': s.id, 'aria-pressed': on ? 'true' : 'false' },
        h('span', { class: 'icon-tile icon-tile--' + ki[1], html: icon(ki[0]) }),
        h('span', { class: 'ad-com-item__body' },
          h('span', { class: 'ad-com-item__kind' }, kindLabel(s.kind)),
          h('span', { class: 'ad-com-item__title' }, titleOf(s)),
          h('span', { class: 'ad-com-item__meta' }, [U.relTime(s.created_at), rid ? A.routeName(rid, { short: true }) : null, s.id].filter(Boolean).join(' · '))),
        s.status !== 'pending' ? A.statusBadge(s.status, { icon: false }) : h('span', { class: 'ad-com-item__chev', html: icon('chevron-right') }));
      ul.appendChild(h('li', null, btn));
    });
    els.list.appendChild(ul);
  }

  /* ---- detail ---- */
  function destroyMap() { if (S.map) { try { S.map.remove(); } catch (e) { /* ignore */ } S.map = null; } }

  function renderDetail(target, s) {
    if (!target) return;
    destroyMap();
    target.innerHTML = '';
    if (!s) {
      target.appendChild(NC.ui.emptyState({ icon: 'list-checks', variant: 'primary', title: t('ad.com.pick'), text: t('ad.com.pick_text') }));
      return;
    }
    var p = s.payload || {};
    var ki = KIND_ICON[s.kind] || ['help-circle', 'neutral'];
    var fac = s.facility_id ? facById(s.facility_id) : null;
    var rid = routeFor(s);
    var pt = point(s);
    // header
    target.appendChild(h('div', { class: 'ad-com-dhead' },
      h('span', { class: 'icon-tile icon-tile--lg icon-tile--' + ki[1], html: icon(ki[0]) }),
      h('div', { class: 'ad-com-dhead__text' },
        h('div', { class: 'cluster' }, NC.ui.badge(kindLabel(s.kind), ki[1] === 'danger' ? 'danger' : ki[1] === 'warning' ? 'warning' : ki[1] === 'info' ? 'info' : 'primary'), A.statusBadge(s.status), h('span', { class: 'ad-mono ad-cell-sub' }, s.id)),
        h('h3', { class: 'ad-com-dhead__title' }, titleOf(s)),
        h('p', { class: 'ad-cell-sub' }, [t('ad.com.received', { time: U.fmtDateTime(s.created_at) }), s.device_id ? t('ad.com.device', { id: String(s.device_id).slice(0, 8) }) : t('ad.com.no_device')].join(' · ')))));

    // payload
    var rows = [];
    if (s.kind === 'new') {
      rows.push([t('ad.com.p.name'), p.name]);
      rows.push([t('ad.com.p.type'), p.type ? A.facType(p.type) : null]);
      FIELD_KEYS.forEach(function (k) { if (k !== 'name' && k !== 'type' && k !== 'lat' && k !== 'lng' && !blank(p[k])) rows.push([fieldLabel(k), fmtVal(k, p[k])]); });
    } else if (contentInfo(s)) {
      rows.push([t('ad.com.p.module'), moduleLabel(contentInfo(s).module)]);
      rows.push([t('ad.com.p.ref'), contentInfo(s).ref ? h('span', { class: 'ad-mono' }, contentInfo(s).ref) : null]);
    } else if (s.kind === 'signal_report') {
      rows.push([t('ad.com.p.carrier'), p.carrier ? A.carrierName(p.carrier) : null]);
      rows.push([t('ad.com.p.level'), p.level ? NC.ui.signalBadge(p.level) : null]);
    }
    if (fac || s.facility_id) {
      rows.push([t('ad.com.p.facility'), fac ? h('a', { href: '#/facilities?edit=' + encodeURIComponent(fac.id), class: 'ad-com-faclink' }, fac.name) : s.facility_id]);
      if (fac) rows.push([t('ad.com.p.status'), h('span', { class: 'cluster', style: 'justify-content:flex-end' }, A.statusBadge(fac.status), fac.status === 'verified' && fac.is_stale ? A.statusBadge('stale') : null)]);
    }
    if (rid) rows.push([t('ad.com.p.route'), A.routeName(rid, { short: true })]);
    if (pt) rows.push([t('ad.com.p.coords'), h('span', { class: 'ad-mono' }, pt.lat.toFixed(5) + ', ' + pt.lng.toFixed(5))]);
    var sec = h('section', { class: 'ad-section ad-com-sec' }, h('h4', { class: 'ad-section__title', html: icon('file-text') + '<span>' + U.esc(t('ad.com.sec_payload')) + '</span>' }));
    if (s.kind === 'correction' && p.field) {
      var cur = fac ? fac[p.field] : null;
      sec.appendChild(h('div', { class: 'ad-com-diff' },
        h('p', { class: 'ad-com-diff__field' }, t('ad.com.p.field') + ': ', h('b', null, fieldLabel(p.field))),
        h('div', { class: 'ad-com-diff__row' },
          h('div', { class: 'ad-com-diff__old' }, h('span', null, t('ad.com.p.current')), h('b', null, fmtVal(p.field, cur))),
          h('span', { class: 'ad-com-diff__arrow', html: icon('arrow-right') }),
          h('div', { class: 'ad-com-diff__new' }, h('span', null, t('ad.com.p.proposed')), h('b', null, fmtVal(p.field, p.value))))));
    }
    sec.appendChild(A.kv(rows, 'ad-com-kv'));
    if (p.note) sec.appendChild(h('blockquote', { class: 'ad-com-quote' }, h('span', { class: 'ad-com-quote__label' }, t('ad.com.p.note')), p.note));
    var raw = h('details', { class: 'ad-com-raw' }, h('summary', null, t('ad.com.p.raw')), h('pre', { class: 'ad-mono' }, JSON.stringify(p, null, 2)));
    sec.appendChild(raw);
    target.appendChild(sec);

    // map
    if (pt || (fac && !blank(fac.lat))) {
      var mapEl = h('div', { class: 'ad-map ad-map--sm ad-com-map' });
      var distEl = h('p', { class: 'ad-cell-sub ad-com-dist' });
      target.appendChild(h('section', { class: 'ad-section ad-com-sec' }, h('h4', { class: 'ad-section__title', html: icon('map-pin') + '<span>' + U.esc(t('ad.com.sec_map')) + '</span>' }), mapEl, distEl));
      setTimeout(function () { drawMiniMap(mapEl, distEl, s, pt, fac, rid); }, 60);
    }

    // review
    var rev = h('section', { class: 'ad-section ad-com-sec ad-com-review' }, h('h4', { class: 'ad-section__title', html: icon('shield-check') + '<span>' + U.esc(t('ad.com.sec_review')) + '</span>' }));
    rev.appendChild(h('div', { class: 'ad-com-effect' }, h('span', { class: 'ad-com-effect__label', html: icon('info', 'icon--sm') + '<span>' + U.esc(t('ad.com.on_approve')) + '</span>' }), h('p', null, t('ad.com.eff.' + s.kind))));
    if (s.status === 'pending') {
      var note = h('textarea', { class: 'textarea', id: 'ad-com-note-' + s.id, rows: '2', maxlength: '500', placeholder: t('ad.com.note_ph') });
      rev.appendChild(h('div', { class: 'field' }, h('label', { class: 'field__label', for: note.id }, t('ad.com.note')), note, h('span', { class: 'field__hint' }, t('ad.com.note_hint'))));
      rev.appendChild(h('div', { class: 'ad-com-actions' },
        h('button', { type: 'button', class: 'btn btn--outline ad-com-reject', 'data-com-review': 'rejected', 'data-id': s.id, html: icon('x') + '<span>' + U.esc(t('ad.com.reject')) + '</span>' }),
        h('button', { type: 'button', class: 'btn btn--primary', 'data-com-review': 'approved', 'data-id': s.id, html: icon('check') + '<span>' + U.esc(t('ad.com.approve')) + '</span>' })));
    } else {
      rev.appendChild(h('div', { class: 'ad-com-done' },
        A.statusBadge(s.status),
        h('span', { class: 'ad-cell-sub' }, t('ad.com.reviewed', { time: U.fmtDateTime(s.reviewed_at) })),
        s.review_note ? h('p', { class: 'ad-com-done__note' }, t('ad.com.review_note', { note: s.review_note })) : null));
      var acts = h('div', { class: 'ad-com-actions' },
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-com-review': 'pending', 'data-id': s.id, html: icon('rotate-ccw') + '<span>' + U.esc(t('ad.com.reopen')) + '</span>' }));
      if (s.facility_id) acts.appendChild(h('a', { class: 'btn btn--soft btn--sm', href: '#/facilities?edit=' + encodeURIComponent(s.facility_id), html: icon('hospital') + '<span>' + U.esc(t(s.kind === 'new' ? 'ad.com.open_new_fac' : 'ad.com.open_fac')) + '</span>' }));
      rev.appendChild(acts);
    }
    target.appendChild(rev);
  }

  function drawMiniMap(mapEl, distEl, s, pt, fac, rid) {
    if (!document.contains(mapEl) || !window.L) return;
    destroyMap();
    var Lf = window.L;
    var center = pt ? [pt.lat, pt.lng] : [+fac.lat, +fac.lng];
    S.map = A.miniMap(mapEl, { center: center, zoom: 13, scrollWheelZoom: false });
    if (!S.map) return;
    var route = rid ? A.routes().filter(function (r) { return r.id === rid; })[0] : null;
    if (route && route.geometry) Lf.polyline(route.geometry, { color: route.color, weight: 4, opacity: 0.7, interactive: false }).addTo(S.map);
    var pts = [];
    if (fac && !blank(fac.lat) && !blank(fac.lng)) {
      NC.mapkit.poiMarker(fac, 'facility', { size: 30 }).bindTooltip(U.esc(fac.name), { direction: 'top' }).addTo(S.map);
      pts.push([+fac.lat, +fac.lng]);
    }
    if (pt) {
      var ki = KIND_ICON[s.kind] || ['map-pin', 'primary'];
      Lf.marker([pt.lat, pt.lng], {
        icon: Lf.divIcon({ className: 'ad-ov-pinwrap', html: '<span class="ad-com-pin ad-com-pin--' + U.esc(ki[1]) + '">' + icon(ki[0]) + '</span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: kindLabel(s.kind), zIndexOffset: 800
      }).addTo(S.map);
      pts.push([pt.lat, pt.lng]);
    }
    if (pts.length === 2) {
      Lf.polyline(pts, { color: NC.mapkit.levelColor('uncertain') || undefined, weight: 2, dashArray: '4 6', interactive: false }).addTo(S.map);
      var d = U.haversineKm({ lat: pts[0][0], lng: pts[0][1] }, { lat: pts[1][0], lng: pts[1][1] });
      distEl.textContent = t('ad.com.dist', { d: U.fmtKm(d) });
      NC.mapkit.fitTo(S.map, pts, { padding: [36, 36], maxZoom: 16 });
    } else {
      distEl.textContent = '';
    }
    NC.mapkit.refresh(S.map);
  }

  /* ------------------------------------------------------------------ actions */
  function select(id, fromUser) {
    S.selected = id;
    A.go('community', params(), { silent: true });
    var s = S.subs.filter(function (x) { return x.id === id; })[0];
    $$('.ad-com-item', els.list).forEach(function (b) { var on = b.getAttribute('data-com-id') === id; b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (isWide()) { renderDetail(els.detail, s); return; }
    if (!s) return;
    if (S.drawer) S.drawer.close();
    var body = h('div', { class: 'ad-com-drawerbody' });
    S.drawer = A.drawer({
      title: kindLabel(s.kind), subtitle: s.id, icon: (KIND_ICON[s.kind] || ['users'])[0], iconVariant: (KIND_ICON[s.kind] || [0, 'primary'])[1] === 'neutral' ? 'primary' : (KIND_ICON[s.kind] || [0, 'primary'])[1],
      body: body, className: 'ad-com-drawer',
      onClose: function () { S.drawer = null; destroyMap(); if (fromUser && S.visible) { S.selected = null; A.go('community', params(), { silent: true }); renderList(); } }
    });
    body.addEventListener('click', onClick);
    renderDetail(body, s);
  }

  function params() {
    var p = {};
    if (S.status !== 'pending') p.status = S.status;
    if (S.kind) p.kind = S.kind;
    if (S.selected) p.id = S.selected;
    return p;
  }

  function review(id, status, btn) {
    var s = S.subs.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var scope = btn ? (btn.closest('.ad-com-review') || document) : document;
    var noteEl = scope.querySelector('textarea');
    var note = noteEl ? noteEl.value.trim() : '';
    if (status === 'rejected' && !note) {
      if (noteEl) {
        var f = noteEl.closest('.field');
        f.classList.add('is-invalid');
        var er = f.querySelector('.field__error') || f.appendChild(h('span', { class: 'field__error' }));
        er.textContent = t('ad.com.reject_need_note');
        noteEl.focus();
      }
      return;
    }
    NC.ui.setLoading(btn, true);
    NC.data.admin.reviewSubmission(id, status, note || (status === 'pending' ? s.review_note : null)).then(function (res) {
      NC.ui.setLoading(btn, false);
      var facId = (res && res.facility_id) || s.facility_id;
      var action = null;
      if (status === 'approved') {
        if (s.kind === 'signal_report') { var rid = routeFor(s); action = { label: t('ad.com.open_signal'), onClick: function () { A.go('signal', rid ? { route: rid, carrier: (s.payload && s.payload.carrier) || undefined } : null); } }; }
        else if (s.kind === 'closed') {
          // the closed facility left 'verified' but the published packs still contain it → offer the republish flow
          var prid = routeFor(s);
          action = { label: t('ad.com.republish'), onClick: function () { A.go('packs', prid ? { route: prid, publish: 1 } : {}); } };
        }
        else if (facId) action = { label: t(s.kind === 'new' ? 'ad.com.open_new_fac' : 'ad.com.open_fac'), onClick: function () { A.go('facilities', { edit: facId }); } };
      }
      var msgKey = status === 'approved' ? (s.kind === 'closed' ? 'ad.com.closed_toast' : 'ad.com.approved_toast') : status === 'rejected' ? 'ad.com.rejected_toast' : 'ad.com.reopened_toast';
      NC.ui.toast(t(msgKey, { id: id }), { type: status === 'rejected' ? 'info' : 'success', timeout: s.kind === 'closed' && status === 'approved' ? 9000 : 6000, action: action });
      // move on to the next pending item (queue flow)
      var list = filtered();
      var idx = list.map(function (x) { return x.id; }).indexOf(id);
      var next = status !== 'pending' && S.status === 'pending' ? (list[idx + 1] || list[idx - 1] || null) : s;
      if (S.drawer && status !== 'pending') S.drawer.close();
      S.selected = next ? next.id : null;
      A.refreshBadges();
      return load().then(function () { if (S.selected && isWide()) select(S.selected); });
    }, function (err) {
      NC.ui.setLoading(btn, false);
      NC.ui.toast(A.errorText(err), { type: 'danger' });
    });
  }

  function onClick(e) {
    var tgt = e.target;
    if (!tgt.closest) return;
    var b;
    if ((b = tgt.closest('[data-com-status]'))) { S.status = b.getAttribute('data-com-status'); S.kind = ''; S.selected = null; A.go('community', params(), { silent: true }); render(); return; }
    if ((b = tgt.closest('[data-com-kind]'))) { S.kind = b.getAttribute('data-com-kind'); A.go('community', params(), { silent: true }); render(); return; }
    if ((b = tgt.closest('[data-com-id]'))) { select(b.getAttribute('data-com-id'), true); return; }
    if ((b = tgt.closest('[data-com-review]'))) { review(b.getAttribute('data-id'), b.getAttribute('data-com-review'), b); return; }
    if (tgt.closest('.ad-com-faclink') && S.drawer) S.drawer.close();
  }

  /* ------------------------------------------------------------------ lifecycle */
  function show(p) {
    p = p || {};
    S.visible = true;
    S.status = ['pending', 'approved', 'rejected', 'all'].indexOf(p.status) >= 0 ? p.status : 'pending';
    S.kind = KINDS.indexOf(p.kind) >= 0 ? p.kind : '';
    S.selected = p.id || null;
    render();
    load().then(function () {
      if (!S.selected) {
        var first = filtered()[0];
        if (first && isWide()) { S.selected = first.id; render(); }
        return;
      }
      var s = S.subs.filter(function (x) { return x.id === S.selected; })[0];
      if (s && S.status !== 'all' && s.status !== S.status) { S.status = s.status; render(); }
      if (!isWide() && s) select(s.id, true);
      else render();
    });
  }
  function hide() {
    S.visible = false;
    if (S.drawer) S.drawer.close();
    destroyMap();
  }
  function badge() {
    return NC.data.admin.listSubmissions({ status: 'pending' }).then(function (r) { return { count: r.length, tone: 'accent' }; }).catch(function () { return null; });
  }

  A.register('community', { titleKey: 'ad.com.title', navKey: 'ad.com.nav', icon: 'message-square', order: 20, group: 'data', mount: mount, show: show, hide: hide, badge: badge });
})(window.NC = window.NC || {});
