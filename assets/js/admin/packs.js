/*
 * packs.js — Admin page "packs" (owner: admin-pages): offline data-pack publishing (routes × carriers matrix with current
 * version/date/size/accuracy, unpublished-change detection, publish dialog with preview + notes, history) and medical
 * content releases with the two-round review of PDF §8.1 (round 1 team → round 2 medical advisor sign-off → release).
 * Public API: none (registers NC.admin page 'packs'; nav badge = releases awaiting round 2). Uses NC.adp (signal.js).
 */
(function (NC) {
  'use strict';

  var kit = NC.adp;
  if (!kit) { console.warn('[admin/packs] NC.adp kit missing (signal.js must load first)'); return; }
  var U = NC.util, t = kit.t, esc = kit.esc, h = kit.h, icon = kit.icon;

  NC.i18n.add({
    vi: {
      'ad.pack.nav': 'Gói dữ liệu',
      'ad.pack.title': 'Gói dữ liệu & nội dung y tế',
      'ad.pack.subtitle': 'Phát hành gói offline theo cung × nhà mạng — thiết bị chỉ tải lớp phủ của nhà mạng mình. Nội dung y tế duyệt hai vòng; chưa qua vòng hai thì không phát hành.',
      'ad.pack.publish_new': 'Phát hành gói',
      'ad.pack.refresh': 'Làm mới',
      'ad.pack.k_current': 'Gói đang phát hành',
      'ad.pack.k_current_sub': '{routes} cung × {carriers} nhà mạng',
      'ad.pack.k_size': 'Tổng dung lượng',
      'ad.pack.k_size_sub': 'trung bình {avg}/gói',
      'ad.pack.k_changes': 'Thay đổi chưa phát hành',
      'ad.pack.k_changes_sub': 'điểm y tế / dịch vụ sửa sau lần phát hành',
      'ad.pack.k_changes_none': 'mọi gói đã cập nhật',
      'ad.pack.k_content': 'Nội dung y tế',
      'ad.pack.mx_title': 'Ma trận phát hành',
      'ad.pack.mx_sub': 'Mỗi ô là gói hiện hành. Khi có sóng, thiết bị so phiên bản và tải bản mới; gói cũ vẫn dùng được offline.',
      'ad.pack.route': 'Cung đường',
      'ad.pack.verified_n': '{n} điểm y tế đã xác thực',
      'ad.pack.stale_n': '{n} quá 90 ngày',
      'ad.pack.changes_n': '{n} thay đổi chưa phát hành',
      'ad.pack.no_pack': 'Chưa phát hành',
      'ad.pack.publish_v': 'Phát hành v{v}',
      'ad.pack.acc': 'độ chính xác {v}',
      'ad.pack.current': 'Hiện hành',
      'ad.pack.replaced': 'Đã thay thế',
      'ad.pack.hist_title': 'Lịch sử phát hành',
      'ad.pack.hist_sub': 'Bản cũ vẫn lưu metadata + checksum để truy vết; chỉ bản hiện hành giữ payload.',
      'ad.pack.all_routes': 'Mọi cung',
      'ad.pack.all_carriers': 'Mọi nhà mạng',
      'ad.pack.col_ver': 'Phiên bản',
      'ad.pack.col_route': 'Cung',
      'ad.pack.col_carrier': 'Nhà mạng',
      'ad.pack.col_at': 'Phát hành',
      'ad.pack.col_size': 'Dung lượng',
      'ad.pack.col_sum': 'Checksum',
      'ad.pack.col_notes': 'Ghi chú',
      'ad.pack.col_state': 'Trạng thái',
      'ad.pack.hist_empty': 'Chưa có gói nào',
      'ad.pack.dlg_title': 'Phát hành gói dữ liệu',
      'ad.pack.dlg_carrier': 'Nhà mạng',
      'ad.pack.dlg_all': 'Cả 3 nhà mạng',
      'ad.pack.dlg_notes': 'Ghi chú phát hành',
      'ad.pack.dlg_notes_ph': 'Ví dụ: cập nhật giờ trực Trạm y tế xã Sơn Thái; thêm 3 mẫu sóng cộng đồng',
      'ad.pack.dlg_preview': 'Gói sẽ gồm',
      'ad.pack.dlg_fac': '{n} điểm y tế đã xác thực',
      'ad.pack.dlg_fac_stale': '({n} quá 90 ngày — vẫn phát hành kèm ngày xác thực)',
      'ad.pack.dlg_svc': '{n} điểm dừng thiết yếu',
      'ad.pack.dlg_seg': '{n} đoạn lớp sóng · mô hình {model}',
      'ad.pack.dlg_changes': 'Thay đổi kể từ lần phát hành trước',
      'ad.pack.dlg_nochanges': 'Không có thay đổi điểm y tế/dịch vụ kể từ lần phát hành trước.',
      'ad.pack.dlg_rule': 'Chỉ điểm y tế đủ trường xác thực mới vào gói. Thứ tự hiển thị chỉ theo khoảng cách và năng lực — không theo tài trợ.',
      'ad.pack.dlg_go': 'Phát hành',
      'ad.pack.published': 'Đã phát hành {route} · {carrier} v{v} ({size}).',
      'ad.pack.published_multi': 'Đã phát hành {n} gói cho {route}.',
      'ad.pack.more': '+{n} thay đổi khác',
      'ad.pack.fac_changed': 'Điểm y tế',
      'ad.pack.svc_changed': 'Dịch vụ',
      'ad.pack.cr_title': 'Nội dung y tế — duyệt hai vòng',
      'ad.pack.cr_sub': 'Sơ cứu (MOD.05) và câu dịch y tế (MOD.01). Mỗi lần phát hành có số hiệu và ngày duyệt hiển thị trong ứng dụng để truy vết khi cần thu hồi.',
      'ad.pack.cr_new': 'Tạo phiên bản nội dung',
      'ad.pack.step1': 'Vòng 1 · Biên soạn',
      'ad.pack.step1_d': 'Nhóm biên soạn, đối chiếu 4 tài liệu nguồn, dịch ngược',
      'ad.pack.step2': 'Vòng 2 · Cố vấn y tế',
      'ad.pack.step2_d': 'Bác sĩ/điều dưỡng có chứng chỉ hành nghề cấp cứu rà soát & ký',
      'ad.pack.step3': 'Phát hành',
      'ad.pack.step3_d': 'Số hiệu + ngày duyệt hiện trong app; cập nhật độc lập với bản app',
      'ad.pack.st_draft': 'Bản nháp',
      'ad.pack.st_in_review': 'Chờ vòng 2',
      'ad.pack.st_approved': 'Đã ký duyệt',
      'ad.pack.st_retracted': 'Đã thu hồi',
      'ad.pack.kind_medical': 'Sơ cứu + câu y tế',
      'ad.pack.kind_firstaid': 'Thư viện sơ cứu',
      'ad.pack.kind_phrases': 'Câu dịch y tế',
      'ad.pack.r1_by': 'Vòng 1: {who}',
      'ad.pack.r2_by': 'Vòng 2: {who} · {at}',
      'ad.pack.r2_wait': 'Vòng 2: chưa ký',
      'ad.pack.not_released': 'Chưa được phát hành cho người dùng thật',
      'ad.pack.live': 'Đang phát hành trong ứng dụng',
      'ad.pack.send_r2': 'Gửi duyệt vòng 2',
      'ad.pack.sign': 'Ký duyệt vòng 2',
      'ad.pack.retract': 'Thu hồi',
      'ad.pack.cr_empty': 'Chưa có phiên bản nội dung',
      'ad.pack.f_version': 'Số hiệu phiên bản',
      'ad.pack.f_version_hint': 'Duy nhất, ví dụ 1.0.1 — hiển thị trong app',
      'ad.pack.f_kind': 'Phạm vi',
      'ad.pack.f_notes': 'Nội dung thay đổi',
      'ad.pack.f_notes_ph': 'Ví dụ: sửa bước 3 “Cầm máu”, thêm câu dịch cho say độ cao…',
      'ad.pack.f_r1': 'Người duyệt vòng 1',
      'ad.pack.f_r1_hint': 'Thành viên nhóm đã biên soạn và đối chiếu tài liệu nguồn',
      'ad.pack.f_submit': 'Đã xong vòng 1 — gửi luôn cho cố vấn (vòng 2)',
      'ad.pack.f_create': 'Tạo phiên bản',
      'ad.pack.created': 'Đã tạo phiên bản nội dung {v}.',
      'ad.pack.dup': 'Số hiệu phiên bản đã tồn tại.',
      'ad.pack.need_r1': 'Cần tên người duyệt vòng 1.',
      'ad.pack.sent_r2': 'Đã gửi {v} cho cố vấn y tế duyệt vòng 2.',
      'ad.pack.sign_title': 'Ký duyệt vòng 2 — {v}',
      'ad.pack.sign_intro': 'Chỉ cố vấn y tế có chuyên môn cấp cứu được ký. Sau khi ký, phiên bản này được phát hành cho người dùng.',
      'ad.pack.f_approver': 'Họ tên & chức danh người ký',
      'ad.pack.f_approver_ph': 'Ví dụ: BS. Nguyễn Văn A — Khoa Cấp cứu',
      'ad.pack.chk1': 'Tôi đã rà soát toàn bộ nội dung sơ cứu và câu dịch của phiên bản này, kể cả phần dịch ngược.',
      'ad.pack.chk2': 'Nội dung chỉ gồm thao tác người không chuyên được phép làm (theo TT 51/2017/TT-BYT).',
      'ad.pack.sign_go': 'Ký duyệt & phát hành',
      'ad.pack.sign_need': 'Cần họ tên người ký và xác nhận cả hai mục.',
      'ad.pack.signed': 'Đã ký duyệt {v} — phiên bản đang phát hành trong ứng dụng.',
      'ad.pack.retract_t': 'Thu hồi {v}?',
      'ad.pack.retract_m': 'Ứng dụng sẽ quay về phiên bản đã duyệt gần nhất. Nêu lý do để truy vết.',
      'ad.pack.retract_reason': 'Lý do thu hồi',
      'ad.pack.retracted': 'Đã thu hồi {v}.',
      'ad.pack.demo_note': 'Chế độ cục bộ: gói được dựng lại từ cơ sở dữ liệu mô phỏng (IndexedDB) giống RPC admin_publish_pack trên Supabase.',
      'ad.pack.k_changes_sub2': 'thêm, sửa, đóng cửa hoặc xoá sau lần phát hành',
      'ad.pack.up_to_date': 'Đã cập nhật',
      'ad.pack.publish_check': 'Kiểm tra & phát hành',
      'ad.pack.op_added': 'Thêm vào gói', 'ad.pack.op_removed': 'Gỡ khỏi gói', 'ad.pack.op_updated': 'Sửa',
      'ad.pack.why_deleted': 'đã xoá', 'ad.pack.why_pending': 'về chờ xác thực (vd. báo đóng cửa)', 'ad.pack.why_rejected': 'bị từ chối',
      'ad.pack.why_moved': 'chuyển sang cung khác', 'ad.pack.why_inactive': 'ngừng hoạt động',
      'ad.pack.other_changed': 'Lớp sóng / cung',
      'ad.pack.sec.segments': 'đoạn lớp sóng', 'ad.pack.sec.accuracy': 'độ tin cậy lớp sóng', 'ad.pack.sec.model_version': 'phiên bản mô hình',
      'ad.pack.sec.holdout_n': 'mẫu kiểm định', 'ad.pack.sec.nodes': 'đồ thị cung đường', 'ad.pack.sec.edges': 'đồ thị cung đường',
      'ad.pack.sec.route': 'thông tin cung', 'ad.pack.sec.schema': 'định dạng gói',
      'ad.pack.content_changed': 'Nội dung gói thay đổi',
      'ad.pack.dlg_nochanges2': 'Không có thay đổi kể từ lần phát hành trước — phát hành sẽ giữ nguyên phiên bản hiện tại.',
      'ad.pack.unchanged': 'Không có thay đổi — {route} · {carrier} vẫn là v{v}, không tạo phiên bản mới.',
      'ad.pack.unchanged_multi': 'Không có thay đổi — các gói của {route} giữ nguyên phiên bản hiện tại.',
      'ad.pack.unchanged_n': '{n} gói không có thay đổi, giữ nguyên phiên bản.'
    },
    en: {
      'ad.pack.nav': 'Data packs',
      'ad.pack.title': 'Data packs & medical content',
      'ad.pack.subtitle': 'Publish offline packs per route × carrier — devices only download their own carrier’s layer. Medical content goes through two review rounds; nothing ships before round two.',
      'ad.pack.publish_new': 'Publish pack',
      'ad.pack.refresh': 'Refresh',
      'ad.pack.k_current': 'Packs live',
      'ad.pack.k_current_sub': '{routes} routes × {carriers} carriers',
      'ad.pack.k_size': 'Total size',
      'ad.pack.k_size_sub': 'average {avg}/pack',
      'ad.pack.k_changes': 'Unpublished changes',
      'ad.pack.k_changes_sub': 'facilities / services edited after publishing',
      'ad.pack.k_changes_none': 'every pack is up to date',
      'ad.pack.k_content': 'Medical content',
      'ad.pack.mx_title': 'Release matrix',
      'ad.pack.mx_sub': 'Each cell is the live pack. With signal, devices compare versions and fetch the new one; the old pack keeps working offline.',
      'ad.pack.route': 'Route',
      'ad.pack.verified_n': '{n} verified facilities',
      'ad.pack.stale_n': '{n} over 90 days',
      'ad.pack.changes_n': '{n} unpublished changes',
      'ad.pack.no_pack': 'Not published',
      'ad.pack.publish_v': 'Publish v{v}',
      'ad.pack.acc': 'accuracy {v}',
      'ad.pack.current': 'Live',
      'ad.pack.replaced': 'Replaced',
      'ad.pack.hist_title': 'Release history',
      'ad.pack.hist_sub': 'Old versions keep metadata + checksum for traceability; only the live one keeps the payload.',
      'ad.pack.all_routes': 'All routes',
      'ad.pack.all_carriers': 'All carriers',
      'ad.pack.col_ver': 'Version',
      'ad.pack.col_route': 'Route',
      'ad.pack.col_carrier': 'Carrier',
      'ad.pack.col_at': 'Published',
      'ad.pack.col_size': 'Size',
      'ad.pack.col_sum': 'Checksum',
      'ad.pack.col_notes': 'Notes',
      'ad.pack.col_state': 'State',
      'ad.pack.hist_empty': 'No packs yet',
      'ad.pack.dlg_title': 'Publish a data pack',
      'ad.pack.dlg_carrier': 'Carrier',
      'ad.pack.dlg_all': 'All 3 carriers',
      'ad.pack.dlg_notes': 'Release notes',
      'ad.pack.dlg_notes_ph': 'e.g. updated night-shift hours at Son Thai commune health station; 3 community signal samples',
      'ad.pack.dlg_preview': 'The pack will contain',
      'ad.pack.dlg_fac': '{n} verified medical facilities',
      'ad.pack.dlg_fac_stale': '({n} over 90 days — still shipped with their verification date)',
      'ad.pack.dlg_svc': '{n} essential stops',
      'ad.pack.dlg_seg': '{n} signal segments · model {model}',
      'ad.pack.dlg_changes': 'Changes since the previous release',
      'ad.pack.dlg_nochanges': 'No facility/service changes since the previous release.',
      'ad.pack.dlg_rule': 'Only facilities with every verification field make it into the pack. Display order is distance and capability only — never sponsorship.',
      'ad.pack.dlg_go': 'Publish',
      'ad.pack.published': 'Published {route} · {carrier} v{v} ({size}).',
      'ad.pack.published_multi': 'Published {n} packs for {route}.',
      'ad.pack.more': '+{n} more changes',
      'ad.pack.fac_changed': 'Facility',
      'ad.pack.svc_changed': 'Service',
      'ad.pack.cr_title': 'Medical content — two-round review',
      'ad.pack.cr_sub': 'First aid (MOD.05) and medical phrases (MOD.01). Every release has a version number and approval date shown in the app, so it can be traced and recalled.',
      'ad.pack.cr_new': 'New content version',
      'ad.pack.step1': 'Round 1 · Authoring',
      'ad.pack.step1_d': 'Team writes, checks the 4 source documents, back-translates',
      'ad.pack.step2': 'Round 2 · Medical advisor',
      'ad.pack.step2_d': 'A licensed emergency doctor/nurse reviews & signs',
      'ad.pack.step3': 'Release',
      'ad.pack.step3_d': 'Version + approval date shown in the app; ships independently of app updates',
      'ad.pack.st_draft': 'Draft',
      'ad.pack.st_in_review': 'Awaiting round 2',
      'ad.pack.st_approved': 'Signed off',
      'ad.pack.st_retracted': 'Recalled',
      'ad.pack.kind_medical': 'First aid + phrases',
      'ad.pack.kind_firstaid': 'First-aid library',
      'ad.pack.kind_phrases': 'Medical phrases',
      'ad.pack.r1_by': 'Round 1: {who}',
      'ad.pack.r2_by': 'Round 2: {who} · {at}',
      'ad.pack.r2_wait': 'Round 2: not signed',
      'ad.pack.not_released': 'Not released to real users',
      'ad.pack.live': 'Live in the app',
      'ad.pack.send_r2': 'Send to round 2',
      'ad.pack.sign': 'Sign off round 2',
      'ad.pack.retract': 'Recall',
      'ad.pack.cr_empty': 'No content versions yet',
      'ad.pack.f_version': 'Version number',
      'ad.pack.f_version_hint': 'Unique, e.g. 1.0.1 — shown in the app',
      'ad.pack.f_kind': 'Scope',
      'ad.pack.f_notes': 'What changed',
      'ad.pack.f_notes_ph': 'e.g. fixed step 3 of “Bleeding”, added phrases for altitude sickness…',
      'ad.pack.f_r1': 'Round-1 reviewer',
      'ad.pack.f_r1_hint': 'Team member who wrote and checked the sources',
      'ad.pack.f_submit': 'Round 1 done — send to the advisor now (round 2)',
      'ad.pack.f_create': 'Create version',
      'ad.pack.created': 'Content version {v} created.',
      'ad.pack.dup': 'This version number already exists.',
      'ad.pack.need_r1': 'The round-1 reviewer name is required.',
      'ad.pack.sent_r2': '{v} sent to the medical advisor for round 2.',
      'ad.pack.sign_title': 'Round-2 sign-off — {v}',
      'ad.pack.sign_intro': 'Only a medical advisor with emergency expertise may sign. Once signed, this version is released to users.',
      'ad.pack.f_approver': 'Signer name & title',
      'ad.pack.f_approver_ph': 'e.g. Dr. Nguyen Van A — Emergency department',
      'ad.pack.chk1': 'I reviewed all first-aid content and phrases in this version, including the back-translation.',
      'ad.pack.chk2': 'It only contains actions lay rescuers may perform (per Circular 51/2017/TT-BYT).',
      'ad.pack.sign_go': 'Sign off & release',
      'ad.pack.sign_need': 'Enter the signer name and confirm both statements.',
      'ad.pack.signed': '{v} signed off — now live in the app.',
      'ad.pack.retract_t': 'Recall {v}?',
      'ad.pack.retract_m': 'The app falls back to the latest approved version. Give a reason for traceability.',
      'ad.pack.retract_reason': 'Reason for recall',
      'ad.pack.retracted': '{v} recalled.',
      'ad.pack.demo_note': 'Local mode: packs are rebuilt from the simulated database (IndexedDB), like the admin_publish_pack RPC on Supabase.',
      'ad.pack.k_changes_sub2': 'added, edited, closed or deleted since publishing',
      'ad.pack.up_to_date': 'Up to date',
      'ad.pack.publish_check': 'Check & publish',
      'ad.pack.op_added': 'Added', 'ad.pack.op_removed': 'Removed', 'ad.pack.op_updated': 'Edited',
      'ad.pack.why_deleted': 'deleted', 'ad.pack.why_pending': 'back to pending (e.g. reported closed)', 'ad.pack.why_rejected': 'rejected',
      'ad.pack.why_moved': 'moved to another route', 'ad.pack.why_inactive': 'inactive',
      'ad.pack.other_changed': 'Signal / route',
      'ad.pack.sec.segments': 'signal segments', 'ad.pack.sec.accuracy': 'signal-layer accuracy', 'ad.pack.sec.model_version': 'model version',
      'ad.pack.sec.holdout_n': 'held-out samples', 'ad.pack.sec.nodes': 'route graph', 'ad.pack.sec.edges': 'route graph',
      'ad.pack.sec.route': 'route details', 'ad.pack.sec.schema': 'pack format',
      'ad.pack.content_changed': 'Pack content changed',
      'ad.pack.dlg_nochanges2': 'Nothing changed since the previous release — publishing keeps the current version.',
      'ad.pack.unchanged': 'No changes — {route} · {carrier} stays at v{v}; no new version was created.',
      'ad.pack.unchanged_multi': 'No changes — the packs of {route} keep their current versions.',
      'ad.pack.unchanged_n': '{n} packs had no changes and kept their version.'
    }
  });

  var state = { packs: [], facilities: [], services: [], accuracy: [], releases: [], segments: [], audit: [], changes: null, fRoute: '', fCarrier: '', flash: {}, openPublish: null };
  var el = {};
  var offRealtime = null;

  function mount(section) {
    el.root = h('div', { class: 'ad-pg ad-pack' });
    section.appendChild(el.root);
    var pubBtn = h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-act': 'publish', html: icon('upload') + '<span data-i18n="ad.pack.publish_new">' + esc(t('ad.pack.publish_new')) + '</span>' });
    var refresh = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'refresh', html: icon('refresh') + '<span data-i18n="ad.pack.refresh">' + esc(t('ad.pack.refresh')) + '</span>' });
    el.root.appendChild(kit.head({ icon: 'package', tone: 'accent', titleKey: 'ad.pack.title', subKey: 'ad.pack.subtitle', actions: [refresh, pubBtn] }));

    el.k = {
      current: kit.kpi({ icon: 'package', tone: 'primary' }),
      size: kit.kpi({ icon: 'hard-drive', tone: 'info' }),
      changes: kit.kpi({ icon: 'edit', tone: 'warning' }),
      content: kit.kpi({ icon: 'book-open', tone: 'accent' })
    };
    el.root.appendChild(h('div', { class: 'ad-pg-kpis ad-pack-kpis' }, el.k.current, el.k.size, el.k.changes, el.k.content));

    el.mx = h('div', { class: 'ad-pack-mx' });
    el.root.appendChild(h('section', { class: 'card ad-pack-mxcard' },
      h('div', { class: 'card__header' },
        h('span', { class: 'icon-tile icon-tile--primary', html: icon('grid') }),
        h('div', null, h('h3', { class: 'card__title', 'data-i18n': 'ad.pack.mx_title' }, t('ad.pack.mx_title')),
          h('p', { class: 'card__subtitle', 'data-i18n': 'ad.pack.mx_sub' }, t('ad.pack.mx_sub')))),
      el.mx));

    el.crSteps = h('ol', { class: 'stepper ad-pack-steps' });
    el.cr = h('div', { class: 'ad-pack-cr' });
    el.root.appendChild(h('section', { class: 'card ad-pack-crcard' },
      h('div', { class: 'card__header' },
        h('span', { class: 'icon-tile icon-tile--danger', html: icon('stethoscope') }),
        h('div', null, h('h3', { class: 'card__title', 'data-i18n': 'ad.pack.cr_title' }, t('ad.pack.cr_title')),
          h('p', { class: 'card__subtitle', 'data-i18n': 'ad.pack.cr_sub' }, t('ad.pack.cr_sub'))),
        h('button', { type: 'button', class: 'btn btn--soft btn--sm', 'data-act': 'cr-new', html: icon('plus') + '<span data-i18n="ad.pack.cr_new">' + esc(t('ad.pack.cr_new')) + '</span>' })),
      el.crSteps, el.cr));

    el.fRoute = h('select', { class: 'select ad-pack-filter', 'aria-label': t('ad.pack.col_route') });
    el.fCarrier = h('select', { class: 'select ad-pack-filter', 'aria-label': t('ad.pack.col_carrier') });
    el.hist = h('div', { class: 'ad-pack-hist' });
    el.root.appendChild(h('section', { class: 'card ad-pack-histcard' },
      h('div', { class: 'card__header' },
        h('span', { class: 'icon-tile icon-tile--neutral', html: icon('history') }),
        h('div', null, h('h3', { class: 'card__title', 'data-i18n': 'ad.pack.hist_title' }, t('ad.pack.hist_title')),
          h('p', { class: 'card__subtitle', 'data-i18n': 'ad.pack.hist_sub' }, t('ad.pack.hist_sub'))),
        h('div', { class: 'cluster ad-pack-filters' }, el.fRoute, el.fCarrier)),
      el.hist));
    el.root.appendChild(h('p', { class: 'ad-pg-foot', 'data-i18n': 'ad.pack.demo_note' }, t('ad.pack.demo_note')));

    el.root.addEventListener('click', onClick);
    el.root.addEventListener('change', function (e) {
      if (e.target === el.fRoute) { state.fRoute = el.fRoute.value; renderHistory(); }
      else if (e.target === el.fCarrier) { state.fCarrier = el.fCarrier.value; renderHistory(); }
    });
    NC.bus.on('i18n:change', function () { NC.i18n.apply(el.root); renderAll(); });
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !el.root.contains(b)) return;
    var act = b.getAttribute('data-act');
    if (act === 'refresh') { kit.dropPackCache(); reload(); }
    else if (act === 'publish') openPublish(b.getAttribute('data-route'), b.getAttribute('data-carrier'));
    else if (act === 'cr-new') openCreate();
    else if (act === 'cr-send') sendRound2(b.getAttribute('data-id'));
    else if (act === 'cr-sign') openSign(b.getAttribute('data-id'));
    else if (act === 'cr-retract') openRetract(b.getAttribute('data-id'));
  }

  /* ------------------------------------------------------------ data */

  /**
   * Server-side "what would the next publish change" (admin_pack_changes: additions, edits, closures, deletions and
   * signal-layer updates since the current pack). Feature-detected: NC.data.admin.packChanges, else the active backend's
   * admin.packChanges; null → the local heuristic (changesSince) is used.
   */
  function packChangesFn() {
    var A = NC.data.admin;
    if (A && typeof A.packChanges === 'function') return function () { return A.packChanges(null, null); };
    var be = NC.backend && NC.backend[NC.data.mode || 'local'];
    if (be && be.admin && typeof be.admin.packChanges === 'function') return function () { return be.admin.packChanges(null, null); };
    return null;
  }

  function reload() {
    var A = NC.data.admin;
    var chFn = packChangesFn();
    return Promise.all([A.listPacks(), kit.routes(), A.listFacilities({}), A.listServices({}), A.listAccuracy(), A.listContentReleases(), A.listSegments({}),
      chFn ? chFn().catch(function (e) { if (!(e && e.sessionLost)) console.warn('[admin/packs] packChanges failed', e); return null; }) : null,
      chFn ? null : A.audit({ limit: 300 }).catch(function () { return []; })])
      .then(function (r) {
        state.packs = r[0] || [];
        state.facilities = r[2] || [];
        state.services = r[3] || [];
        state.accuracy = r[4] || [];
        state.releases = r[5] || [];
        state.segments = r[6] || [];
        state.changes = null;
        if (Array.isArray(r[7])) {
          state.changes = {};
          r[7].forEach(function (c) { if (c) state.changes[c.route_id + ':' + c.carrier] = c; });
        }
        state.audit = r[8] || [];
        renderAll();
        kit.refreshBadges();
        if (state.openPublish) { var op = state.openPublish; state.openPublish = null; openPublish(op.route, op.carrier); }
      }).catch(kit.toastErr);
  }

  function current(routeId, carrier) {
    return state.packs.filter(function (p) { return p.route_id === routeId && p.carrier === carrier && p.is_current; })[0] || null;
  }
  function accFor(routeId, carrier) {
    return state.accuracy.filter(function (a) { return a.route_id === routeId && a.carrier === carrier; })[0] || null;
  }
  function isVerified(f) { return f.status === 'verified'; }
  /**
   * Local heuristic (backends without packChanges): facility/service rows changed after `since` — everything that was
   * edited, including rows that LEFT 'verified' (closure report → pending), except new rows that are still pending —
   * plus facilities deleted after `since` (audit log).
   */
  function changesSince(routeId, since) {
    var ts = since ? Date.parse(since) : 0;
    var fac = state.facilities.filter(function (f) {
      return f.route_id === routeId && Date.parse(f.updated_at || f.created_at || 0) > ts && (f.status !== 'pending' || Date.parse(f.created_at || 0) <= ts);
    }).map(function (f) { return { kind: 'fac', op: f.status === 'verified' ? 'updated' : 'removed', reason: f.status, id: f.id, name: f.name, at: f.updated_at, status: f.status }; });
    var svc = state.services.filter(function (s) { return s.route_id === routeId && Date.parse(s.updated_at || s.created_at || 0) > ts; })
      .map(function (s) { return { kind: 'svc', op: 'updated', id: s.id, name: s.name, at: s.updated_at, status: s.status }; });
    var del = state.audit.filter(function (a) {
      var row = (a.details && a.details.row) || {};
      return a.action === 'delete' && a.entity === 'facilities' && Date.parse(a.created_at || 0) > ts && row.route_id === routeId;
    }).map(function (a) { return { kind: 'fac', op: 'removed', reason: 'deleted', id: a.entity_id, name: (a.details.row.name || a.entity_id), at: a.created_at }; });
    return fac.concat(svc, del).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  }
  function rowAt(kind, id) {
    var list = kind === 'svc' ? state.services : state.facilities;
    var r = list.filter(function (x) { return x.id === id; })[0];
    return r ? (r.updated_at || r.created_at || null) : null;
  }
  /** Items of one server change row: [{kind:'fac'|'svc'|'other', op:'added'|'removed'|'updated', id, name, reason?, fields?, at?}]. */
  function serverItems(ch) {
    var out = [];
    [['fac', ch.facilities || {}], ['svc', ch.services || {}]].forEach(function (g) {
      ['added', 'removed', 'updated'].forEach(function (op) {
        (g[1][op] || []).forEach(function (x) { out.push({ kind: g[0], op: op, id: x.id, name: x.name || x.id, reason: x.reason || null, fields: x.fields || null, at: rowAt(g[0], x.id) }); });
      });
    });
    (ch.other || []).forEach(function (sec) { out.push({ kind: 'other', op: 'updated', id: 'sec:' + sec, name: NC.i18n.has('ad.pack.sec.' + sec) ? t('ad.pack.sec.' + sec) : sec }); });
    if (ch.changed && ch.published && !out.length) out.push({ kind: 'other', op: 'updated', id: 'sec:content', name: t('ad.pack.content_changed') });
    return out;
  }
  /**
   * Unpublished changes of a route for the given carriers (default: all), de-duplicated (facilities are shared by the
   * carrier packs; signal sections are per carrier).
   */
  function changesFor(routeId, carrierIds) {
    var cs = carrierIds || kit.carriers().map(function (c) { return c.id; });
    if (!state.changes) {
      var oldest = null;
      cs.forEach(function (c) { var p = current(routeId, c); if (p && (!oldest || p.published_at < oldest)) oldest = p.published_at; });
      return changesSince(routeId, oldest);
    }
    var seen = {}, out = [];
    cs.forEach(function (c) {
      var ch = state.changes[routeId + ':' + c];
      if (!ch || !ch.published) return; // no pack yet: "publish v1", not a diff
      serverItems(ch).forEach(function (x) {
        var k = x.kind + ':' + x.op + ':' + x.id;
        if (seen[k]) return;
        seen[k] = true;
        out.push(x);
      });
    });
    return out;
  }
  function routeFacStats(routeId) {
    var v = state.facilities.filter(function (f) { return f.route_id === routeId && isVerified(f); });
    return { verified: v.length, stale: v.filter(function (f) { return f.is_stale; }).length };
  }
  function latestRelease() {
    var appr = state.releases.filter(function (r) { return r.status === 'approved'; });
    return appr[0] || state.releases[0] || null;
  }

  /* ------------------------------------------------------------ render */

  function renderAll() {
    renderKpis();
    renderMatrix();
    renderReleases();
    renderFilters();
    renderHistory();
  }

  function renderKpis() {
    var list = routeList();
    var carriers = kit.carriers();
    var cur = state.packs.filter(function (p) { return p.is_current; });
    var total = cur.reduce(function (a, p) { return a + (+p.size_bytes || 0); }, 0);
    var changes = 0;
    list.forEach(function (r) { changes += changesFor(r.id).length; });
    el.k.current.querySelector('.ad-pg-kpi__label').textContent = t('ad.pack.k_current');
    kit.setKpi(el.k.current, U.fmtNumber(cur.length), t('ad.pack.k_current_sub', { routes: list.length, carriers: carriers.length }));
    el.k.size.querySelector('.ad-pg-kpi__label').textContent = t('ad.pack.k_size');
    kit.setKpi(el.k.size, U.fmtBytes(total), cur.length ? t('ad.pack.k_size_sub', { avg: U.fmtBytes(total / cur.length) }) : '');
    el.k.changes.querySelector('.ad-pg-kpi__label').textContent = t('ad.pack.k_changes');
    kit.setKpi(el.k.changes, U.fmtNumber(changes), changes ? t('ad.pack.k_changes_sub2') : t('ad.pack.k_changes_none'));
    el.k.changes.classList.toggle('ad-pack-kpi--warn', changes > 0);
    var rel = latestRelease();
    el.k.content.querySelector('.ad-pg-kpi__label').textContent = t('ad.pack.k_content');
    kit.setKpi(el.k.content, rel ? rel.version : '–', rel ? t('ad.pack.st_' + rel.status) : '');
  }

  /** Routes known to the server list plus any route that has packs. */
  function routeList() {
    var list = kit.routeList();
    var seen = {};
    list.forEach(function (r) { seen[r.id] = true; });
    state.packs.forEach(function (p) { if (!seen[p.route_id]) { seen[p.route_id] = true; list.push({ id: p.route_id, name: p.route_id }); } });
    return list;
  }

  function renderMatrix() {
    var carriers = kit.carriers();
    el.mx.innerHTML = '';
    el.mx.appendChild(h('div', { class: 'ad-pack-mx__head', 'aria-hidden': 'true' },
      h('span', { class: 'ad-pg-label' }, t('ad.pack.route')),
      carriers.map(function (c) { return h('span', { class: 'ad-pg-label ad-pack-mx__carrier' }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + c.id }), c.name); })));
    routeList().forEach(function (r) {
      var st = routeFacStats(r.id);
      var ch = changesFor(r.id);
      var row = h('div', { class: 'ad-pack-row' },
        h('div', { class: 'ad-pack-row__route' },
          h('span', { class: 'icon-tile icon-tile--sm icon-tile--primary', html: icon(r.travel_mode === 'hiking' ? 'footprints' : 'bike') }),
          h('div', { class: 'ad-pack-row__text' },
            h('strong', { class: 'ad-pack-row__name', title: kit.routeName(r.id) }, kit.routeShort(r.id)),
            h('span', { class: 'ad-pack-row__meta' }, (r.length_km ? U.fmtKm(+r.length_km) + ' · ' : '') + t('ad.pack.verified_n', { n: st.verified }) + (st.stale ? ' · ' + t('ad.pack.stale_n', { n: st.stale }) : '')),
            ch.length ? h('span', { class: 'badge badge--warning ad-pack-row__changes', title: ch.slice(0, 6).map(function (x) { return x.name; }).join('\n') }, t('ad.pack.changes_n', { n: ch.length })) : null)),
        carriers.map(function (c) { return cell(r, c); }));
      el.mx.appendChild(row);
    });
  }

  function cell(r, c) {
    var p = current(r.id, c.id);
    var acc = accFor(r.id, c.id);
    var chList = p ? changesFor(r.id, [c.id]) : [];
    var ch = chList.length;
    var key = r.id + ':' + c.id;
    var next = (p ? +p.version : 0) + 1;
    return h('div', { class: 'ad-pack-cell' + (ch ? ' ad-pack-cell--stale' : '') + (state.flash[key] ? ' ad-pg-flash' : ''), 'data-cell': key },
      h('span', { class: 'ad-pack-cell__carrier' }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + c.id }), c.name),
      p ? h('div', { class: 'ad-pack-cell__main' },
        h('span', { class: 'ad-pack-cell__ver' }, 'v' + p.version),
        h('span', { class: 'ad-pack-cell__meta' },
          h('span', null, U.fmtDate(p.published_at)),
          h('span', null, U.fmtBytes(p.size_bytes)),
          acc ? h('span', null, t('ad.pack.acc', { v: kit.pct(+acc.accuracy, 0) })) : null))
        : h('div', { class: 'ad-pack-cell__main' }, h('span', { class: 'muted small' }, t('ad.pack.no_pack'))),
      ch ? h('span', { class: 'ad-pack-cell__warn', title: chList.slice(0, 6).map(function (x) { return x.name; }).join('\n'), html: icon('alert-triangle', 'icon--xs') + '<span>' + esc(t('ad.pack.changes_n', { n: ch })) + '</span>' })
        : p ? h('span', { class: 'ad-pack-cell__ok', html: icon('check-circle', 'icon--xs') + '<span>' + esc(t('ad.pack.up_to_date')) + '</span>' }) : null,
      h('button', {
        type: 'button', class: 'btn btn--sm ' + (ch || !p ? 'btn--primary' : 'btn--soft') + ' ad-pack-cell__btn', 'data-act': 'publish', 'data-route': r.id, 'data-carrier': c.id,
        html: icon('upload') + '<span>' + esc(ch || !p ? t('ad.pack.publish_v', { v: next }) : t('ad.pack.publish_check')) + '</span>'
      }));
  }

  function renderFilters() {
    var fr = state.fRoute, fc = state.fCarrier;
    el.fRoute.innerHTML = '';
    el.fRoute.appendChild(h('option', { value: '' }, t('ad.pack.all_routes')));
    routeList().forEach(function (r) { el.fRoute.appendChild(h('option', { value: r.id }, kit.routeShort(r.id))); });
    el.fRoute.value = fr;
    el.fCarrier.innerHTML = '';
    el.fCarrier.appendChild(h('option', { value: '' }, t('ad.pack.all_carriers')));
    kit.carriers().forEach(function (c) { el.fCarrier.appendChild(h('option', { value: c.id }, c.name)); });
    el.fCarrier.value = fc;
  }

  function renderHistory() {
    var rows = state.packs.filter(function (p) { return (!state.fRoute || p.route_id === state.fRoute) && (!state.fCarrier || p.carrier === state.fCarrier); });
    el.hist.innerHTML = '';
    if (!rows.length) { el.hist.appendChild(NC.ui.emptyState({ icon: 'package', title: t('ad.pack.hist_empty'), compact: true })); return; }
    var table = h('table', { class: 'table ad-pack-htable' },
      h('thead', null, h('tr', null,
        h('th', null, t('ad.pack.col_ver')), h('th', null, t('ad.pack.col_route')), h('th', null, t('ad.pack.col_carrier')), h('th', null, t('ad.pack.col_at')),
        h('th', { class: 'num' }, t('ad.pack.col_size')), h('th', null, t('ad.pack.col_sum')), h('th', null, t('ad.pack.col_notes')), h('th', null, t('ad.pack.col_state')))),
      h('tbody', null, rows.slice(0, 200).map(function (p) {
        var key = p.route_id + ':' + p.carrier + ':' + p.version;
        return h('tr', { class: (p.is_current ? 'is-current' : '') + (state.flash[key] ? ' ad-pg-flash' : '') },
          h('td', { 'data-label': t('ad.pack.col_ver'), class: 'table__primary' }, h('span', { class: 'ad-pack-vtag' }, 'v' + p.version)),
          h('td', { 'data-label': t('ad.pack.col_route') }, kit.routeShort(p.route_id)),
          h('td', { 'data-label': t('ad.pack.col_carrier') }, h('span', { class: 'ad-sig-cname' }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + p.carrier }), kit.carrierName(p.carrier))),
          h('td', { 'data-label': t('ad.pack.col_at'), class: 'nowrap' }, U.fmtDateTime(p.published_at)),
          h('td', { 'data-label': t('ad.pack.col_size'), class: 'num' }, U.fmtBytes(p.size_bytes)),
          h('td', { 'data-label': t('ad.pack.col_sum') }, h('code', { class: 'ad-pack-sum', title: p.checksum || '' }, p.checksum ? String(p.checksum).slice(0, 10) : '–')),
          h('td', { 'data-label': t('ad.pack.col_notes'), class: 'ad-pack-notes' }, p.notes || '–'),
          h('td', { 'data-label': t('ad.pack.col_state') }, p.is_current ? NC.ui.badge(t('ad.pack.current'), 'success', 'check') : NC.ui.badge(t('ad.pack.replaced'), 'neutral')));
      })));
    // Scrolls sideways on tablets → keyboard-focusable, named region (axe scrollable-region-focusable).
    el.hist.appendChild(h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': t('ad.pack.hist_title') }, table));
  }

  /* ------------------------------------------------------------ content releases */

  function renderReleases() {
    el.crSteps.innerHTML = '';
    [['1', 'ad.pack.step1', 'ad.pack.step1_d'], ['2', 'ad.pack.step2', 'ad.pack.step2_d'], ['3', 'ad.pack.step3', 'ad.pack.step3_d']].forEach(function (s) {
      el.crSteps.appendChild(h('li', { class: 'stepper__step ad-pack-step' }, h('strong', null, t(s[1])), h('small', null, t(s[2]))));
    });
    el.cr.innerHTML = '';
    if (!state.releases.length) { el.cr.appendChild(NC.ui.emptyState({ icon: 'book-open', title: t('ad.pack.cr_empty'), compact: true })); return; }
    var liveId = (state.releases.filter(function (r) { return r.status === 'approved'; })[0] || {}).id;
    state.releases.forEach(function (r) {
      var steps = h('ol', { class: 'stepper ad-pack-rsteps' });
      var st = r.status;
      var s1 = st === 'draft' ? 'is-current' : 'is-done';
      var s2 = st === 'in_review' ? 'is-current' : (st === 'approved' || (st === 'retracted' && r.approved_at)) ? 'is-done' : '';
      var s3 = st === 'approved' ? 'is-done' : '';
      steps.appendChild(h('li', { class: 'stepper__step ' + s1 }, h('span', null, r.reviewer_round1 ? t('ad.pack.r1_by', { who: r.reviewer_round1 }) : t('ad.pack.step1'))));
      steps.appendChild(h('li', { class: 'stepper__step ' + s2 }, h('span', null, r.approver ? t('ad.pack.r2_by', { who: r.approver, at: U.fmtDate(r.approved_at) }) : t('ad.pack.r2_wait'))));
      steps.appendChild(h('li', { class: 'stepper__step ' + s3 }, h('span', null, st === 'approved' && r.id === liveId ? t('ad.pack.live') : t('ad.pack.step3'))));
      var actions = h('div', { class: 'ad-pack-rel__actions' });
      if (st === 'draft') actions.appendChild(h('button', { type: 'button', class: 'btn btn--soft btn--sm', 'data-act': 'cr-send', 'data-id': r.id, html: icon('send') + '<span>' + esc(t('ad.pack.send_r2')) + '</span>' }));
      if (st === 'in_review') actions.appendChild(h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-act': 'cr-sign', 'data-id': r.id, html: icon('edit') + '<span>' + esc(t('ad.pack.sign')) + '</span>' }));
      if (st === 'approved') actions.appendChild(h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'cr-retract', 'data-id': r.id, html: icon('rotate-ccw') + '<span>' + esc(t('ad.pack.retract')) + '</span>' }));
      var variant = { draft: 'neutral', in_review: 'warning', approved: 'success', retracted: 'danger' }[st] || 'neutral';
      el.cr.appendChild(h('article', { class: 'ad-pack-rel ad-pack-rel--' + st + (state.flash['cr:' + r.id] ? ' ad-pg-flash' : '') },
        h('div', { class: 'ad-pack-rel__head' },
          h('span', { class: 'ad-pack-rel__ver' }, r.version),
          NC.ui.badge(t('ad.pack.st_' + st), variant, st === 'approved' ? 'shield-check' : st === 'in_review' ? 'clock' : st === 'retracted' ? 'x-circle' : 'edit'),
          h('span', { class: 'badge badge--neutral' }, t('ad.pack.kind_' + (r.kind || 'medical')) !== 'ad.pack.kind_' + (r.kind || 'medical') ? t('ad.pack.kind_' + (r.kind || 'medical')) : r.kind),
          h('span', { class: 'ad-pack-rel__date' }, U.fmtDate(r.created_at))),
        r.notes ? h('p', { class: 'ad-pack-rel__notes' }, r.notes) : null,
        steps,
        h('div', { class: 'ad-pack-rel__foot' },
          h('span', { class: 'ad-pack-rel__rule' + (st === 'approved' ? ' is-live' : ''), html: icon(st === 'approved' ? 'check-circle' : 'lock', 'icon--xs') + '<span>' + esc(t(st === 'approved' ? 'ad.pack.live' : 'ad.pack.not_released')) + '</span>' }),
          actions)));
    });
  }

  function relById(id) { return state.releases.filter(function (r) { return String(r.id) === String(id); })[0] || null; }

  function field(label, input, hint, id) {
    return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, label), input, hint ? h('p', { class: 'field__hint' }, hint) : null);
  }
  function suggestVersion() {
    var v = (state.releases[0] && state.releases[0].version) || '1.0.0';
    var m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v);
    return m ? m[1] + '.' + m[2] + '.' + (+m[3] + 1) + (m[4] || '') : v + '.1';
  }

  function openCreate() {
    var ver = h('input', { class: 'input mono', id: 'ad-pack-ver', value: suggestVersion(), maxlength: 32, autocomplete: 'off' });
    var kind = h('select', { class: 'select', id: 'ad-pack-kind' }, ['medical', 'firstaid', 'phrases'].map(function (k) { return h('option', { value: k }, t('ad.pack.kind_' + k)); }));
    var notes = h('textarea', { class: 'textarea', id: 'ad-pack-notes', rows: 3, maxlength: 800, placeholder: t('ad.pack.f_notes_ph') });
    var r1 = h('input', { class: 'input', id: 'ad-pack-r1', value: 'Nhóm Stormbreakers', maxlength: 120 });
    var submit = h('input', { type: 'checkbox', id: 'ad-pack-submit' });
    var err = h('p', { class: 'field__error', role: 'alert', hidden: true });
    var body = h('div', { class: 'stack' },
      h('div', { class: 'ad-pack-form2' }, field(t('ad.pack.f_version'), ver, t('ad.pack.f_version_hint'), 'ad-pack-ver'), field(t('ad.pack.f_kind'), kind, null, 'ad-pack-kind')),
      field(t('ad.pack.f_notes'), notes, null, 'ad-pack-notes'),
      field(t('ad.pack.f_r1'), r1, t('ad.pack.f_r1_hint'), 'ad-pack-r1'),
      h('label', { class: 'check' }, submit, h('span', null, t('ad.pack.f_submit'))),
      err);
    NC.ui.modal({
      title: t('ad.pack.cr_new'), icon: 'book-open', iconVariant: 'accent', size: 'md', body: body,
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('ad.pack.f_create'), variant: 'primary', icon: 'plus', onClick: function () {
            err.hidden = true;
            var row = { version: ver.value.trim(), kind: kind.value, notes: notes.value.trim() || null, reviewer_round1: r1.value.trim() || null, status: submit.checked ? 'in_review' : 'draft' };
            if (!row.version) { err.textContent = t('ad.pack.f_version'); err.hidden = false; ver.focus(); return false; }
            if (row.status === 'in_review' && !row.reviewer_round1) { err.textContent = t('ad.pack.need_r1'); err.hidden = false; r1.focus(); return false; }
            return NC.data.admin.upsertContentRelease(row).then(function (saved) {
              NC.ui.toast(t('ad.pack.created', { v: row.version }), { type: 'success' });
              if (saved && saved.id !== undefined) flash('cr:' + saved.id);
              return reload();
            }, function (e) {
              err.textContent = e && e.code === 'duplicate_version' ? t('ad.pack.dup') : kit.errMsg(e);
              err.hidden = false;
              return false;
            });
          }
        }
      ]
    });
    setTimeout(function () { ver.focus(); ver.select(); }, 60);
  }

  function sendRound2(id) {
    var r = relById(id);
    if (!r) return;
    if (!r.reviewer_round1) { NC.ui.toast(t('ad.pack.need_r1'), { type: 'warning' }); return; }
    NC.data.admin.upsertContentRelease({ id: r.id, version: r.version, status: 'in_review' }).then(function () {
      NC.ui.toast(t('ad.pack.sent_r2', { v: r.version }), { type: 'success' });
      flash('cr:' + r.id);
      return reload();
    }, kit.toastErr);
  }

  function openSign(id) {
    var r = relById(id);
    if (!r) return;
    var who = h('input', { class: 'input', id: 'ad-pack-approver', maxlength: 160, placeholder: t('ad.pack.f_approver_ph'), autocomplete: 'name' });
    var c1 = h('input', { type: 'checkbox' }), c2 = h('input', { type: 'checkbox' });
    var err = h('p', { class: 'field__error', role: 'alert', hidden: true });
    var body = h('div', { class: 'stack' },
      h('div', { class: 'ad-pack-signintro', html: icon('stethoscope') + '<p>' + esc(t('ad.pack.sign_intro')) + '</p>' }),
      r.notes ? h('p', { class: 'ad-pack-rel__notes' }, r.notes) : null,
      field(t('ad.pack.f_approver'), who, null, 'ad-pack-approver'),
      h('label', { class: 'check' }, c1, h('span', null, t('ad.pack.chk1'))),
      h('label', { class: 'check' }, c2, h('span', null, t('ad.pack.chk2'))),
      err);
    NC.ui.modal({
      title: t('ad.pack.sign_title', { v: r.version }), icon: 'shield-check', iconVariant: 'success', size: 'md', body: body,
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('ad.pack.sign_go'), variant: 'primary', icon: 'check', onClick: function () {
            var name = who.value.trim();
            if (!name || !c1.checked || !c2.checked) { err.textContent = t('ad.pack.sign_need'); err.hidden = false; return false; }
            return NC.data.admin.approveContentRelease(r.id, name).then(function () {
              NC.ui.toast(t('ad.pack.signed', { v: r.version }), { type: 'success', timeout: 6000 });
              flash('cr:' + r.id);
              return reload();
            });
          }
        }
      ]
    });
    setTimeout(function () { who.focus(); }, 60);
  }

  function openRetract(id) {
    var r = relById(id);
    if (!r) return;
    var reason = h('textarea', { class: 'textarea', id: 'ad-pack-reason', rows: 3, maxlength: 400 });
    NC.ui.modal({
      title: t('ad.pack.retract_t', { v: r.version }), icon: 'alert-triangle', iconVariant: 'danger', size: 'sm',
      body: h('div', { class: 'stack stack--sm' }, h('p', { class: 'muted small' }, t('ad.pack.retract_m')), field(t('ad.pack.retract_reason'), reason, null, 'ad-pack-reason')),
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('ad.pack.retract'), variant: 'danger', icon: 'rotate-ccw', onClick: function () {
            var why = reason.value.trim();
            var notes = (r.notes ? r.notes + ' · ' : '') + (why ? (NC.i18n.lang() === 'en' ? 'Recalled: ' : 'Thu hồi: ') + why : '');
            return NC.data.admin.upsertContentRelease({ id: r.id, version: r.version, status: 'retracted', notes: notes || r.notes || null }).then(function () {
              NC.ui.toast(t('ad.pack.retracted', { v: r.version }), { type: 'info' });
              return reload();
            });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ publish */

  function openPublish(routeId, carrier) {
    var routes = routeList();
    routeId = routeId || (routes[0] && routes[0].id);
    var sel = { route: routeId, carrier: carrier || 'all' };
    var routeSel = h('select', { class: 'select', id: 'ad-pack-proute' }, routes.map(function (r) { return h('option', { value: r.id, selected: r.id === sel.route }, kit.routeName(r.id)); }));
    var seg = h('div', { class: 'segmented ad-pack-pcarrier' },
      h('button', { type: 'button', class: 'segmented__btn', 'data-value': 'all' }, t('ad.pack.dlg_all')),
      kit.carriers().map(function (c) { return h('button', { type: 'button', class: 'segmented__btn', 'data-value': c.id }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + c.id }), c.name); }));
    var notes = h('textarea', { class: 'textarea', id: 'ad-pack-pnotes', rows: 3, maxlength: 500, placeholder: t('ad.pack.dlg_notes_ph') });
    var preview = h('div', { class: 'ad-pack-preview' });
    var goLabel = h('span');
    function renderPreview() {
      var st = routeFacStats(sel.route);
      var svc = state.services.filter(function (s) { return s.route_id === sel.route && s.status !== 'inactive'; }).length;
      var cs = sel.carrier === 'all' ? kit.carriers().map(function (c) { return c.id; }) : [sel.carrier];
      var segN = state.segments.filter(function (s) { return s.route_id === sel.route && cs.indexOf(s.carrier) >= 0; }).length;
      var acc = accFor(sel.route, cs[0]);
      var ch = changesFor(sel.route, cs);
      var allPublished = cs.every(function (c) { return !!current(sel.route, c); });
      preview.innerHTML = '';
      preview.appendChild(h('p', { class: 'ad-pg-label' }, t('ad.pack.dlg_preview')));
      preview.appendChild(h('ul', { class: 'ad-pack-plist' },
        h('li', { html: icon('cross', 'icon--sm') + '<span>' + esc(t('ad.pack.dlg_fac', { n: st.verified })) + (st.stale ? ' <small>' + esc(t('ad.pack.dlg_fac_stale', { n: st.stale })) + '</small>' : '') + '</span>' }),
        h('li', { html: icon('fuel', 'icon--sm') + '<span>' + esc(t('ad.pack.dlg_svc', { n: svc })) + '</span>' }),
        h('li', { html: icon('signal', 'icon--sm') + '<span>' + esc(t('ad.pack.dlg_seg', { n: segN, model: (acc && acc.model_version) || '–' })) + '</span>' })));
      preview.appendChild(h('p', { class: 'ad-pg-label' }, t('ad.pack.dlg_changes')));
      if (!ch.length) preview.appendChild(h('p', { class: 'muted small ad-pack-nochanges' }, t(allPublished ? 'ad.pack.dlg_nochanges2' : 'ad.pack.dlg_nochanges')));
      else {
        preview.appendChild(h('ul', { class: 'ad-pack-changes' }, ch.slice(0, 8).map(changeLi), ch.length > 8 ? h('li', { class: 'muted small' }, t('ad.pack.more', { n: ch.length - 8 })) : null));
      }
      preview.appendChild(h('p', { class: 'ad-pack-rule', html: icon('shield-check', 'icon--xs') + '<span>' + esc(t('ad.pack.dlg_rule')) + '</span>' }));
      var bump = ch.length || !allPublished;
      var next = sel.carrier === 'all' || !bump ? '' : ' v' + (((current(sel.route, sel.carrier) || {}).version || 0) + 1);
      goLabel.textContent = t('ad.pack.dlg_go') + next;
    }
    var body = h('div', { class: 'stack' },
      field(t('ad.pack.col_route'), routeSel, null, 'ad-pack-proute'),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, t('ad.pack.dlg_carrier')), seg),
      preview,
      field(t('ad.pack.dlg_notes'), notes, null, 'ad-pack-pnotes'));
    NC.ui.segmented(seg, { value: sel.carrier, onChange: function (v) { sel.carrier = v; renderPreview(); } });
    routeSel.addEventListener('change', function () { sel.route = routeSel.value; renderPreview(); });
    renderPreview();
    var ctrl = NC.ui.modal({
      title: t('ad.pack.dlg_title'), icon: 'upload', iconVariant: 'primary', size: 'md', body: body,
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('ad.pack.dlg_go'), variant: 'primary', icon: 'upload', id: 'ad-pack-go', onClick: function () {
            var cs = sel.carrier === 'all' ? kit.carriers().map(function (c) { return c.id; }) : [sel.carrier];
            var note = notes.value.trim() || null;
            var results = [];
            return cs.reduce(function (p, c) {
              return p.then(function () { return NC.data.admin.publishPack(sel.route, c, note).then(function (res) { results.push({ carrier: c, res: res }); }); });
            }, Promise.resolve()).then(function () {
              // {unchanged:true}: the server kept the current version (nothing to publish) — never claim a new release
              var done = results.filter(function (x) { return !(x.res && x.res.unchanged); });
              var same = results.filter(function (x) { return x.res && x.res.unchanged; });
              done.forEach(function (x) { flash(sel.route + ':' + x.carrier); if (x.res) flash(sel.route + ':' + x.carrier + ':' + x.res.version); });
              if (!done.length) {
                var u0 = (same[0] && same[0].res) || {};
                NC.ui.toast(same.length === 1
                  ? t('ad.pack.unchanged', { route: kit.routeShort(sel.route), carrier: kit.carrierName(same[0].carrier), v: u0.version })
                  : t('ad.pack.unchanged_multi', { route: kit.routeShort(sel.route) }), { type: 'info', timeout: 6000 });
              } else if (done.length === 1 && !same.length) {
                var r0 = done[0].res || {};
                NC.ui.toast(t('ad.pack.published', { route: kit.routeShort(sel.route), carrier: kit.carrierName(done[0].carrier), v: r0.version, size: U.fmtBytes(r0.size_bytes) }), { type: 'success', timeout: 6000 });
              } else {
                NC.ui.toast(t('ad.pack.published_multi', { n: done.length, route: kit.routeShort(sel.route) }) + (same.length ? ' ' + t('ad.pack.unchanged_n', { n: same.length }) : ''), { type: 'success', timeout: 7000 });
              }
              kit.dropPackCache();
              return reload();
            });
          }
        }
      ]
    });
    var go = ctrl.panel.querySelector('#ad-pack-go span');
    if (go) { go.parentNode.replaceChild(goLabel, go); }
  }

  /** One change line of the publish preview: what · name · (reason / fields) · when. */
  function changeLi(x) {
    var tone = x.op === 'added' ? 'success' : x.op === 'removed' ? 'danger' : 'warning';
    var what = x.kind === 'fac' ? t('ad.pack.fac_changed') : x.kind === 'svc' ? t('ad.pack.svc_changed') : t('ad.pack.other_changed');
    var detail = '';
    if (x.op === 'removed' && x.reason && NC.i18n.has('ad.pack.why_' + x.reason)) detail = t('ad.pack.why_' + x.reason);
    else if (x.op === 'updated' && x.fields && x.fields.length) {
      detail = x.fields.slice(0, 3).map(function (f) { return NC.i18n.has('ad.fac.f.' + f) ? t('ad.fac.f.' + f) : f; }).join(', ') + (x.fields.length > 3 ? '…' : '');
    }
    return h('li', { class: 'ad-pack-changes__item ad-pack-changes__item--' + x.op },
      h('span', { class: 'badge badge--' + tone }, what + ' · ' + t('ad.pack.op_' + x.op)),
      h('span', { class: 'ad-pack-changes__name' }, x.name, detail ? h('small', { class: 'ad-pack-changes__why' }, ' — ' + detail) : null),
      x.at ? h('small', null, U.relTime(x.at)) : null);
  }

  function flash(key) {
    state.flash[key] = true;
    setTimeout(function () { delete state.flash[key]; }, 2600);
  }

  /* ------------------------------------------------------------ lifecycle */

  function show(params) {
    params = params || {};
    if (params.route) state.fRoute = params.route;
    // deep link from a facility save / closure approval: open the publish dialog for that route once the data is in
    if (params.publish) {
      state.openPublish = { route: params.route || null, carrier: params.carrier || null };
      kit.setHash('packs', params.route ? { route: params.route } : {});
    }
    reload();
    if (!offRealtime) {
      offRealtime = kit.subscribe(['data_packs', 'content_releases', 'facilities', 'services', 'route_accuracy'], function () { reload(); }, 600);
    }
  }
  function hide() { if (offRealtime) { offRealtime(); offRealtime = null; } }

  kit.register('packs', {
    titleKey: 'ad.pack.nav',
    icon: 'package',
    order: 50,
    group: 'data',
    mount: mount,
    show: show,
    hide: hide,
    /** Nav badge: content releases waiting for the round-2 medical sign-off. */
    badge: function () {
      return NC.data.admin.listContentReleases().then(function (rows) {
        var n = (rows || []).filter(function (r) { return r.status === 'in_review'; }).length;
        return n ? { count: n, tone: 'warning' } : null;
      }, function () { return null; });
    }
  });
})(window.NC = window.NC || {});
