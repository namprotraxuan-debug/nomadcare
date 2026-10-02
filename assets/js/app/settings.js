/*
 * settings.js — Cài đặt: Chuyến đi (route, carrier, travel mode) · Giao diện & ngôn ngữ (language, theme, traveller
 * language) · Gói dữ liệu offline · Quyền riêng tư & dữ liệu (consents, "Xem dữ liệu của tôi", encryption status,
 * hold-to-delete everything) — always open; then folded by default (accordion h2 > button[aria-expanded]):
 * Kết nối & kỹ thuật (network, server mode, carrier, pack source/version, signal-model accuracy, outbox, device, sync,
 * simulated signal loss — what the old sidebar "Trạng thái" box showed) · Nội dung y tế (versions, review status,
 * sources, content error report) · Thử nghiệm thực địa (MOD.01 timings, CSV) · Giới thiệu. Non-medical screen → no
 * medical disclaimer here (round 2). A jump chip / ?section= opens a folded section.
 * Owner: P2 core-screens. Public API: NC.settingsScreen.{refresh(), scrollTo(section), withdrawMedical() → Promise<{ok, buddy}>}
 * (consent withdrawal stops dependent processing: profile delete, Buddy redaction/stop). Registers screen 'settings' +
 * i18n namespace st.*. Route params: #/settings?section=trip|look|packs|privacy|sync|content|field|about.
 * Markup: index.html #st-root (single source; the old JS SKELETON copy was removed — only index.html loads settings.js).
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var $$ = U.$$, esc = U.esc;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }
  function S(k) { return NC.settings ? NC.settings.get(k) : null; }
  function setS(k, v) { return NC.settings ? NC.settings.set(k, v) : Promise.resolve(); }
  function lang() { return NC.i18n ? NC.i18n.lang() : 'vi'; }
  function toast(m, o) { return NC.ui ? NC.ui.toast(m, o) : null; }
  var VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  /** Escaped text; Vietnamese data (place names, org abbreviations) shown in the EN UI is tagged lang="vi" for screen readers. */
  function viText(s) { var v = esc(s || ''); return v && lang() !== 'vi' && VI_CHARS.test(s) ? '<span lang="vi">' + v + '</span>' : v; }

  /* ================================================================== */
  /* i18n — st.*                                                          */
  /* ================================================================== */
  if (NC.i18n) NC.i18n.add({
    vi: {
      'st.jump': 'Mục cài đặt',
      'st.trip.title': 'Chuyến đi', 'st.trip.sub': 'Cung đường, nhà mạng và cách di chuyển',
      'st.trip.route': 'Cung đường', 'st.trip.carrier': 'Nhà mạng', 'st.trip.mode': 'Cách di chuyển',
      'st.trip.note': 'Lớp phủ sóng và cảnh báo vùng mất sóng được tính riêng cho từng nhà mạng.',
      'st.trip.changed_route': 'Đã chọn tuyến {name}', 'st.trip.changed_carrier': 'Đã chuyển sang {name}',
      'st.look.title': 'Giao diện & ngôn ngữ', 'st.look.sub': 'Ngôn ngữ ứng dụng, chế độ sáng/tối',
      'st.look.lang': 'Ngôn ngữ ứng dụng', 'st.look.theme': 'Giao diện',
      'st.look.ulang': 'Ngôn ngữ bạn nói (dịch y tế)', 'st.look.ulang_hint': 'Nhân viên y tế luôn đọc tiếng Việt; câu dành cho bạn hiện bằng ngôn ngữ này.',
      'st.packs.title': 'Gói dữ liệu offline', 'st.packs.sub': 'Bản đồ tuyến, lớp sóng theo nhà mạng, điểm y tế đã xác thực',
      'st.packs.current': 'Đang dùng cho {route} · {carrier}', 'st.packs.src.bundled': 'Gói nhẹ cài kèm · v{v}',
      'st.packs.src.downloaded': 'Đã lưu offline · v{v}', 'st.packs.src.server': 'Đọc trực tuyến, chưa lưu offline · v{v}',
      'st.packs.latest': 'Bản mới nhất trên máy chủ: v{v} · {size}',
      'st.packs.download': 'Tải gói cho tuyến hiện tại', 'st.packs.update': 'Cập nhật', 'st.packs.remove': 'Xoá',
      'st.packs.redownload': 'Tải lại', 'st.packs.need_net': 'Cần mạng để tải — gói cài kèm vẫn dùng được offline.',
      'st.packs.none': 'Chưa lưu gói nào trên máy này. Khi mất sóng, ứng dụng dùng gói nhẹ cài kèm cho 3 tuyến.',
      'st.packs.col.route': 'Tuyến', 'st.packs.col.carrier': 'Nhà mạng', 'st.packs.col.version': 'Phiên bản',
      'st.packs.col.size': 'Dung lượng', 'st.packs.col.date': 'Ngày tải', 'st.packs.col.actions': 'Thao tác',
      'st.packs.update_badge': 'Có v{v}', 'st.packs.downloaded_toast': 'Đã tải gói {route} · {carrier} v{v}.',
      'st.packs.removed_toast': 'Đã xoá gói. Gói cài kèm vẫn dùng được.', 'st.packs.failed': 'Chưa tải được gói. Thử lại khi có sóng.',
      'st.packs.remove_confirm': 'Xoá gói {route} · {carrier}? Ứng dụng sẽ quay về gói cài kèm cho tuyến này.',
      'st.storage.title': 'Bộ nhớ trình duyệt', 'st.storage.used': 'Đã dùng {used} / {quota}',
      'st.storage.na': 'Trình duyệt không cho biết dung lượng.',
      'st.storage.persist': 'Giữ dữ liệu offline khi máy thiếu bộ nhớ', 'st.storage.persisted': 'Dữ liệu offline được giữ bền vững',
      'st.storage.persist_denied': 'Trình duyệt chưa cho phép lưu bền vững — hãy cài ứng dụng ra màn hình chính.',
      'st.privacy.title': 'Quyền riêng tư & dữ liệu', 'st.privacy.sub': 'Theo Nghị định 356/2025/NĐ-CP · dữ liệu y tế chỉ rời máy khi bạn chọn chia sẻ',
      'st.privacy.enc_on': 'Hồ sơ y tế mã hoá AES-GCM 256-bit trên máy', 'st.privacy.enc_off': 'Trình duyệt này không mã hoá được — hồ sơ lưu cục bộ, chưa mã hoá',
      'st.c.geo_online': 'Tìm đường trực tuyến (OpenStreetMap)',
      'st.c.geo_online_d': 'Gửi vị trí và điểm đến tới Nominatim/OSRM khi bạn tìm nơi ngoài 3 tuyến thí điểm. Tắt để chỉ dùng dữ liệu offline.',
      'st.c.geo_online_on': 'Đã bật tìm đường trực tuyến.', 'st.c.geo_online_off': 'Đã tắt tìm đường trực tuyến. Chỉ dùng dữ liệu offline.',
      'st.privacy.consents': 'Chấp thuận', 'st.privacy.updated': 'Cập nhật lần cuối {time}', 'st.privacy.never': 'Chưa ghi nhận chấp thuận',
      'st.c.terms': 'Điều khoản & khuyến cáo y tế', 'st.c.terms_d': 'Bắt buộc để dùng ứng dụng. Muốn rút lại, hãy xoá toàn bộ dữ liệu.',
      'st.c.sensitive': 'Xử lý dữ liệu y tế nhạy cảm', 'st.c.sensitive_d': 'Nhóm máu, dị ứng, bệnh nền, thuốc — lưu mã hoá trên máy; chỉ được gửi đi nếu bạn chọn kèm trong cảnh báo Buddy.',
      'st.c.deadman': 'Buddy Check-in (công tắc an toàn)', 'st.c.deadman_d': 'Khi bạn quá hạn check-in, máy chủ email vị trí cuối cho người nhận nếu phiên có email thật; chỉ có số điện thoại thì máy chủ không tự báo — bạn bấm Gửi SMS.',
      'st.c.deadman_d_local': 'Khi bạn quá hạn check-in, ứng dụng ghi cảnh báo kèm vị trí cuối. Bản cục bộ này chỉ mô phỏng email — người nhận chỉ biết khi bạn bấm Gửi SMS.',
      'st.c.share_medical_in_alert': 'Kèm lớp y tế công khai trong cảnh báo Buddy', 'st.c.share_medical_in_alert_d': 'Chỉ nhóm máu, dị ứng, bệnh nền, thuốc — không kèm danh tính.',
      'st.c.community_logs': 'Đóng góp log sóng ẩn danh', 'st.c.community_logs_d': 'Toạ độ, thời điểm, nhà mạng và mức sóng — không kèm danh tính.',
      'st.c.locked': 'Bắt buộc',
      'st.c.withdraw_title': 'Rút lại đồng ý dữ liệu y tế?', 'st.c.withdraw_msg': 'Hồ sơ y tế (nhóm máu, dị ứng, bệnh nền, thuốc và lớp định danh) sẽ bị xoá khỏi máy này, và mã QR trong ứng dụng sẽ không còn thông tin y tế.',
      'st.c.withdraw_saved_qr': 'Hình nền màn hình khoá hoặc ảnh QR bạn đã lưu vẫn chứa mã cũ — hãy thay hoặc xoá chúng.',
      'st.c.withdraw_buddy_update': 'Lớp y tế cũng được gỡ khỏi phiên Buddy đang chạy: máy chủ xoá bản sao ngay khi nhận được thay đổi (khi có mạng), các cảnh báo sau đó không còn dữ liệu y tế.',
      'st.c.withdraw_buddy_stop': 'Phiên Buddy đang chạy có kèm lớp y tế sẽ được dừng, để không cảnh báo nào còn gửi dữ liệu y tế. Bạn có thể bật lại Buddy mà không kèm lớp y tế.',
      'st.c.withdraw_ok': 'Rút lại & xoá hồ sơ', 'st.c.withdrawn': 'Đã rút lại đồng ý và xoá hồ sơ y tế.', 'st.c.saved': 'Đã cập nhật chấp thuận.',
      'st.c.share_title': 'Gỡ lớp y tế khỏi Buddy?', 'st.c.share_ok': 'Dừng phiên Buddy',
      'st.c.buddy_redacted': 'Đã gỡ lớp y tế khỏi phiên Buddy đang chạy.',
      'st.c.buddy_redacted_offline': 'Đã gỡ lớp y tế khỏi phiên Buddy — máy chủ sẽ cập nhật khi có mạng.',
      'st.c.buddy_stopped': 'Đã dừng phiên Buddy có kèm lớp y tế.',
      'st.c.deadman_title': 'Tắt Buddy Check-in?', 'st.c.deadman_ok': 'Tắt & dừng phiên',
      'st.c.deadman_msg': 'Phiên Buddy đang chạy sẽ dừng ngay: check-in, vị trí và SOS không còn được theo dõi cho {name}.',
      'st.c.deadman_stopped': 'Đã tắt Buddy Check-in và dừng phiên đang chạy.',
      'st.c.deadman_stopped_offline': 'Đã tắt Buddy Check-in. Lệnh dừng phiên sẽ gửi lên máy chủ khi có mạng.',
      'st.c.your_buddy': 'người nhận',
      'st.privacy.view': 'Xem dữ liệu của tôi', 'st.privacy.wipe': 'Xoá toàn bộ dữ liệu cá nhân', 'st.privacy.wipe_hint': 'Nhấn giữ 1,5 giây',
      'st.privacy.wipe_note': 'Xoá hồ sơ y tế, chấp thuận, phiên Buddy, hàng đợi gửi, khoá thiết bị và vị trí trên máy này, đồng thời yêu cầu máy chủ dừng phiên Buddy và xoá dữ liệu của thiết bị (gửi ngay nếu có mạng, nếu không thì khi có sóng). Gói bản đồ đã tải được giữ lại.',
      'st.privacy.wipe_note_local': 'Xoá hồ sơ y tế, chấp thuận, phiên Buddy, hàng đợi gửi, khoá thiết bị và vị trí trên máy này. Gói bản đồ đã tải được giữ lại. Khi có mạng, phiên Buddy đang chạy được dừng trước khi xoá.',
      'st.privacy.wipe_offline': 'Đang offline và Buddy đang bật: nếu xoá bây giờ, máy chủ chỉ nhận lệnh dừng phiên khi có sóng — {name} có thể nhận cảnh báo quá hạn nếu máy chưa có sóng trước {time}.',
      'st.privacy.wipe_offline_local': 'Đang offline và Buddy đang bật: nếu xoá bây giờ, máy chủ sẽ không nhận được lệnh dừng phiên — {name} có thể nhận cảnh báo quá hạn lúc {time}. Hãy chờ có sóng rồi xoá.',
      'st.privacy.wiping': 'Đang xoá dữ liệu cá nhân…', 'st.privacy.wiped': 'Đã xoá toàn bộ dữ liệu cá nhân trên máy này.',
      'st.privacy.wiped_srv': 'Máy chủ đã nhận yêu cầu dừng Buddy và xoá dữ liệu của thiết bị.',
      'st.wipe.pending_title': 'Đã xoá dữ liệu trên máy này',
      'st.wipe.pending_srv': 'Máy chủ chưa nhận được yêu cầu xoá vì bạn đang offline. Yêu cầu này (không chứa dữ liệu cá nhân) được giữ trên máy và tự gửi khi có mạng — hãy mở NomadCare khi có sóng.',
      'st.wipe.pending_buddy': 'Cho tới lúc đó, phiên Buddy trên máy chủ vẫn chạy: nếu máy chưa có sóng trước {time}, {name} có thể nhận cảnh báo quá hạn. Hãy báo cho {name} rằng bạn vẫn an toàn.',
      'st.wipe.pending_buddy_overdue': 'Phiên Buddy trên máy chủ đang quá hạn — {name} có thể đã hoặc sắp nhận cảnh báo. Hãy báo cho {name} rằng bạn vẫn an toàn.',
      'st.wipe.legacy_buddy': 'Máy chủ chưa nhận được lệnh dừng phiên Buddy và sẽ không nhận được nữa: {name} có thể nhận cảnh báo quá hạn lúc {time}. Hãy báo cho {name} rằng bạn vẫn an toàn.',
      'st.wipe.pre_title': 'Buddy vẫn đang chạy trên máy chủ',
      'st.wipe.pre_msg': 'Bạn đang offline nên máy chủ chưa thể dừng phiên Buddy. Nếu xoá bây giờ, {name} có thể nhận cảnh báo quá hạn lúc {time}. Hãy chờ có sóng rồi xoá, hoặc báo trước cho {name}.',
      'st.wipe.pre_ok': 'Vẫn xoá', 'st.wipe.continue': 'Tiếp tục', 'st.wipe.sms_copy': 'Sao chép tin nhắn', 'st.wipe.sms_open': 'Nhắn cho {name}',
      'st.wipe.sms_body': 'Mình vẫn an toàn. Mình đã tắt NomadCare Buddy trên điện thoại — nếu bạn nhận được cảnh báo quá hạn từ NomadCare trong vài giờ tới, xin hãy bỏ qua.',
      'st.data.title': 'Dữ liệu của tôi trên máy này', 'st.data.sub': 'Mọi thứ dưới đây chỉ nằm trên thiết bị. Giá trị cá nhân được che — nhấn “Hiện” để xem.',
      'st.data.reveal': 'Hiện', 'st.data.hide': 'Ẩn', 'st.data.export': 'Xuất bản sao (JSON)',
      'st.data.profile': 'Hồ sơ y tế (mã hoá)', 'st.data.identity': 'Lớp định danh', 'st.data.none': 'Chưa có',
      'st.data.buddy': 'Phiên Buddy', 'st.data.buddy_none': 'Không có phiên đang chạy', 'st.data.events': '{n} sự kiện trên máy',
      'st.data.outbox': 'Hàng đợi gửi lên máy chủ', 'st.data.outbox_none': 'Trống', 'st.data.packs': 'Gói dữ liệu đã tải',
      'st.data.position': 'Vị trí gần nhất', 'st.data.settings': 'Cài đặt', 'st.data.consents': 'Chấp thuận',
      'st.data.server': 'Máy chủ chỉ nhận: check-in Buddy (và lớp y tế nếu bạn đồng ý), báo cáo điểm y tế, log sóng nếu bạn bật.',
      'st.data.code_set': 'Đã đặt', 'st.data.protected': 'Được bảo vệ bằng mã hiện định danh — cần nhấn giữ và nhập mã',
      'st.data.gate_na': 'Không mở được bước xác nhận — hãy xem lớp định danh trong Hồ sơ QR.',
      'st.sync.title': 'Kết nối & kỹ thuật', 'st.sync.sub': 'Mạng, máy chủ, gói dữ liệu, hàng đợi offline, giả lập mất sóng',
      'st.sync.carrier': 'Nhà mạng', 'st.sync.pack': 'Gói dữ liệu tuyến', 'st.sync.model': 'Mô hình lớp sóng',
      'st.sync.model_v': '{m} · độ tin cậy {x}% ({n} điểm kiểm tra)', 'st.sync.model_none': 'Chưa có số đo độ tin cậy cho nhà mạng này',
      'st.packs.more': 'Gói đã tải & bộ nhớ trình duyệt', 'st.content.sources_n': 'Nguồn tham khảo ({n})',
      'st.sync.net': 'Mạng', 'st.sync.backend': 'Máy chủ', 'st.sync.device': 'Mã thiết bị', 'st.sync.last': 'Đồng bộ gần nhất',
      'st.sync.outbox': 'Hàng đợi', 'st.sync.outbox_n': '{n} thao tác', 'st.sync.empty': 'Không có thao tác nào đang chờ.',
      'st.sync.attempts': '{n} lần thử', 'st.sync.flush': 'Đồng bộ ngay', 'st.sync.flushed': 'Đã gửi {sent}, lỗi {failed}.',
      'st.sync.offline': 'Đang offline — thao tác được giữ an toàn và tự gửi khi có sóng.',
      'st.sync.sim': 'Giả lập mất sóng', 'st.sync.sim_d': 'Dùng khi demo: cả ứng dụng hoạt động như ở vùng lõm sóng.',
      'st.sync.not_registered': 'Chưa đăng ký', 'st.sync.more': '+{n} thao tác khác',
      'st.op.device.register': 'Đăng ký thiết bị', 'st.op.buddy.start': 'Bắt đầu Buddy', 'st.op.buddy.checkin': 'Check-in Buddy',
      'st.op.buddy.stop': 'Dừng Buddy', 'st.op.buddy.resolve': 'Buddy: tôi an toàn', 'st.op.report.submit': 'Báo cáo điểm y tế / nội dung',
      'st.op.signal.log': 'Log sóng ẩn danh', 'st.op.buddy.update': 'Cập nhật phiên Buddy', 'st.op.device.erase': 'Xoá dữ liệu thiết bị trên máy chủ',
      'st.content.title': 'Nội dung y tế', 'st.content.sub': 'Phiên bản, duyệt hai vòng, nguồn tham khảo',
      'st.content.phrases': 'Dịch y tế', 'st.content.firstaid': 'Sơ cứu', 'st.content.release': 'Bản phát hành trên máy chủ',
      'st.content.round1': 'Vòng 1: {who}', 'st.content.approver': 'Duyệt: {who}', 'st.content.pending': 'chưa ký duyệt',
      'st.content.sources': 'Nguồn tham khảo', 'st.content.report': 'Báo lỗi nội dung',
      'st.review.in_review': 'Chờ cố vấn y tế ký duyệt', 'st.review.approved': 'Đã duyệt', 'st.review.draft': 'Bản nháp',
      'st.review.bundled': 'Bản cài kèm', 'st.review.retracted': 'Đã thu hồi',
      'st.report.title': 'Báo lỗi nội dung y tế', 'st.report.sub': 'Gửi ẩn danh cho nhóm biên soạn. Không kèm hồ sơ y tế của bạn.',
      'st.report.area': 'Khu vực', 'st.report.area.phrases': 'Dịch y tế', 'st.report.area.firstaid': 'Sơ cứu',
      'st.report.area.other': 'Khác', 'st.report.ref': 'Mã câu / mục (không bắt buộc)', 'st.report.ref_ph': 'VD: MOD01-HEAD-03-2 hoặc cpr',
      'st.report.note': 'Mô tả lỗi', 'st.report.note_ph': 'Câu nào sai, nên sửa thế nào…', 'st.report.send': 'Gửi báo lỗi',
      'st.report.need_note': 'Hãy mô tả lỗi.', 'st.report.sent': 'Đã ghi nhận báo lỗi — cảm ơn bạn!',
      'st.report.queued': 'Đã lưu báo lỗi — sẽ tự gửi khi có sóng.',
      'st.field.title': 'Thử nghiệm thực địa', 'st.field.sub': 'KPI dịch y tế: đưa được câu cho nhân viên y tế dưới 15 giây',
      'st.field.timer': 'Bấm giờ Dịch y tế', 'st.field.timer_d': 'Đo thời gian từ khi mở Dịch y tế tới lúc hiện câu cho nhân viên y tế.',
      'st.field.n': 'Số lần đo', 'st.field.median': 'Trung vị', 'st.field.best': 'Nhanh nhất', 'st.field.under': 'Dưới 15 giây',
      'st.field.empty': 'Chưa có số đo. Bật bấm giờ rồi mở “Dịch y tế” để thử.', 'st.field.export': 'Xuất CSV', 'st.field.clear': 'Xoá số đo',
      'st.field.clear_confirm': 'Xoá toàn bộ {n} số đo bấm giờ?', 'st.field.cleared': 'Đã xoá số đo.',
      'st.field.col.at': 'Thời điểm', 'st.field.col.code': 'Mã câu', 'st.field.col.lang': 'Ngôn ngữ', 'st.field.col.time': 'Thời gian',
      'st.field.recent': '{n} lần đo gần nhất',
      'st.about.title': 'Giới thiệu', 'st.about.sub': 'Phiên bản, nhóm phát triển, giấy phép',
      'st.about.version': 'Phiên bản ứng dụng', 'st.about.content': 'Nội dung y tế', 'st.about.team': 'Nhóm',
      'st.about.team_v': 'Stormbreakers — AISC’26 · Digital Business Ideas',
      'st.about.licenses': 'Giấy phép mã nguồn mở & dữ liệu', 'st.about.onboarding': 'Xem lại màn hình bắt đầu',
      'st.about.free': 'Mọi tính năng cứu mạng miễn phí, không cần tài khoản.'
    },
    en: {
      'st.jump': 'Settings sections',
      'st.trip.title': 'Trip', 'st.trip.sub': 'Route, carrier and how you travel',
      'st.trip.route': 'Route', 'st.trip.carrier': 'Mobile carrier', 'st.trip.mode': 'How you travel',
      'st.trip.note': 'Coverage layers and dead-zone warnings are computed separately for each carrier.',
      'st.trip.changed_route': 'Route set to {name}', 'st.trip.changed_carrier': 'Switched to {name}',
      'st.look.title': 'Appearance & language', 'st.look.sub': 'App language, light/dark mode',
      'st.look.lang': 'App language', 'st.look.theme': 'Theme',
      'st.look.ulang': 'Language you speak (medical phrases)', 'st.look.ulang_hint': 'Medical staff always read Vietnamese; your lines appear in this language.',
      'st.packs.title': 'Offline data packs', 'st.packs.sub': 'Route map, per-carrier signal layer, verified medical points',
      'st.packs.current': 'In use for {route} · {carrier}', 'st.packs.src.bundled': 'Light bundled pack · v{v}',
      'st.packs.src.downloaded': 'Saved offline · v{v}', 'st.packs.src.server': 'Read online, not saved offline · v{v}',
      'st.packs.latest': 'Latest on the server: v{v} · {size}',
      'st.packs.download': 'Download pack for current route', 'st.packs.update': 'Update', 'st.packs.remove': 'Remove',
      'st.packs.redownload': 'Download again', 'st.packs.need_net': 'Network needed to download — the bundled pack keeps working offline.',
      'st.packs.none': 'No pack saved on this device yet. Without signal, the app uses the light bundled pack for all 3 routes.',
      'st.packs.col.route': 'Route', 'st.packs.col.carrier': 'Carrier', 'st.packs.col.version': 'Version',
      'st.packs.col.size': 'Size', 'st.packs.col.date': 'Downloaded', 'st.packs.col.actions': 'Actions',
      'st.packs.update_badge': 'v{v} available', 'st.packs.downloaded_toast': 'Downloaded {route} · {carrier} v{v}.',
      'st.packs.removed_toast': 'Pack removed. The bundled pack still works.', 'st.packs.failed': "Couldn't download the pack. Try again with signal.",
      'st.packs.remove_confirm': 'Remove the {route} · {carrier} pack? The app falls back to the bundled pack for this route.',
      'st.storage.title': 'Browser storage', 'st.storage.used': '{used} used of {quota}',
      'st.storage.na': 'This browser does not report storage usage.',
      'st.storage.persist': 'Keep offline data when the device is low on space', 'st.storage.persisted': 'Offline data is stored persistently',
      'st.storage.persist_denied': 'The browser did not allow persistent storage — install the app to your home screen.',
      'st.privacy.title': 'Privacy & data', 'st.privacy.sub': 'Per Decree 356/2025/NĐ-CP · medical data leaves your device only if you choose to share it',
      'st.privacy.enc_on': 'Medical profile encrypted on device (AES-GCM 256-bit)', 'st.privacy.enc_off': 'This browser cannot encrypt — the profile is stored locally without encryption',
      'st.c.geo_online': 'Online route search (OpenStreetMap)',
      'st.c.geo_online_d': 'Sends your position and destination to Nominatim/OSRM when you search beyond the 3 pilot routes. Turn off to use offline data only.',
      'st.c.geo_online_on': 'Online route search is on.', 'st.c.geo_online_off': 'Online route search is off. Offline data only.',
      'st.privacy.consents': 'Consent', 'st.privacy.updated': 'Last updated {time}', 'st.privacy.never': 'No consent recorded yet',
      'st.c.terms': 'Terms & medical notice', 'st.c.terms_d': 'Required to use the app. To withdraw, delete all your data.',
      'st.c.sensitive': 'Sensitive medical data processing', 'st.c.sensitive_d': 'Blood type, allergies, conditions, medications — encrypted on device; only sent if you choose to include them in Buddy alerts.',
      'st.c.deadman': 'Buddy check-in (dead-man switch)', 'st.c.deadman_d': 'When you miss a check-in, the server emails your last location to your recipient if the session has a real email; with only a phone number nobody is alerted automatically — tap Send SMS.',
      'st.c.deadman_d_local': 'When you miss a check-in, the app records an alert with your last location. This local build only simulates the email — your recipient knows only when you tap Send SMS.',
      'st.c.share_medical_in_alert': 'Include the public medical layer in Buddy alerts', 'st.c.share_medical_in_alert_d': 'Only blood type, allergies, conditions, medications — no identity.',
      'st.c.community_logs': 'Contribute anonymous signal logs', 'st.c.community_logs_d': 'Coordinates, time, carrier and signal level — no identity.',
      'st.c.locked': 'Required',
      'st.c.withdraw_title': 'Withdraw medical data consent?', 'st.c.withdraw_msg': 'Your medical profile (blood type, allergies, conditions, medications and identity layer) will be deleted from this device, and the in-app QR code will no longer carry medical information.',
      'st.c.withdraw_saved_qr': 'Lock-screen wallpapers or QR images you already saved still contain the old code — replace or delete them.',
      'st.c.withdraw_buddy_update': 'The medical layer is also removed from your running Buddy session: the server deletes its copy as soon as it receives the change (when online), and later alerts carry no medical data.',
      'st.c.withdraw_buddy_stop': 'Your running Buddy session includes the medical layer and will be stopped, so no alert can send medical data any more. You can turn Buddy back on without the medical layer.',
      'st.c.withdraw_ok': 'Withdraw & delete profile', 'st.c.withdrawn': 'Consent withdrawn and medical profile deleted.', 'st.c.saved': 'Consent updated.',
      'st.c.share_title': 'Remove the medical layer from Buddy?', 'st.c.share_ok': 'Stop Buddy session',
      'st.c.buddy_redacted': 'Medical layer removed from your running Buddy session.',
      'st.c.buddy_redacted_offline': 'Medical layer removed from your Buddy session — the server is updated when you are back online.',
      'st.c.buddy_stopped': 'The Buddy session that included the medical layer was stopped.',
      'st.c.deadman_title': 'Turn off Buddy check-in?', 'st.c.deadman_ok': 'Turn off & stop session',
      'st.c.deadman_msg': 'Your running Buddy session stops now: check-ins, location and SOS are no longer tracked for {name}.',
      'st.c.deadman_stopped': 'Buddy check-in turned off and the running session stopped.',
      'st.c.deadman_stopped_offline': 'Buddy check-in turned off. The stop reaches the server when you are back online.',
      'st.c.your_buddy': 'your recipient',
      'st.privacy.view': 'View my data', 'st.privacy.wipe': 'Delete all personal data', 'st.privacy.wipe_hint': 'Press and hold 1.5 s',
      'st.privacy.wipe_note': 'Deletes the medical profile, consents, Buddy session, outbox, device key and location on this device, and asks the server to stop your Buddy session and erase this device’s data (sent now when online, otherwise at the first signal). Downloaded map packs are kept.',
      'st.privacy.wipe_note_local': 'Deletes the medical profile, consents, Buddy session, outbox, device key and location on this device. Downloaded map packs are kept. When online, a running Buddy session is stopped first.',
      'st.privacy.wipe_offline': 'Offline with Buddy on: if you delete now, the server only gets the stop once you have signal — {name} may get an overdue alert if your phone has no signal before {time}.',
      'st.privacy.wipe_offline_local': 'Offline with Buddy on: if you delete now, the server never gets the stop — {name} may get an overdue alert at {time}. Wait for signal before deleting.',
      'st.privacy.wiping': 'Deleting personal data…', 'st.privacy.wiped': 'All personal data on this device was deleted.',
      'st.privacy.wiped_srv': 'The server received the request to stop Buddy and erase this device’s data.',
      'st.wipe.pending_title': 'Data deleted on this device',
      'st.wipe.pending_srv': 'The server has not received the erase request because you are offline. The request (no personal data in it) is kept on this device and sent automatically when you are online — open NomadCare once you have signal.',
      'st.wipe.pending_buddy': 'Until then your Buddy session keeps running on the server: if your phone has no signal before {time}, {name} may get an overdue alert. Let {name} know you are safe.',
      'st.wipe.pending_buddy_overdue': 'Your Buddy session on the server is overdue — {name} may already have been, or will soon be, alerted. Let {name} know you are safe.',
      'st.wipe.legacy_buddy': 'The server never received the stop for your Buddy session and cannot receive it any more: {name} may get an overdue alert at {time}. Let {name} know you are safe.',
      'st.wipe.pre_title': 'Buddy is still running on the server',
      'st.wipe.pre_msg': 'You are offline, so the server cannot stop your Buddy session yet. If you delete now, {name} may get an overdue alert at {time}. Wait for signal before deleting, or tell {name} first.',
      'st.wipe.pre_ok': 'Delete anyway', 'st.wipe.continue': 'Continue', 'st.wipe.sms_copy': 'Copy message', 'st.wipe.sms_open': 'Text {name}',
      'st.wipe.sms_body': 'I am safe. I turned off NomadCare Buddy on my phone — if you get an overdue alert from NomadCare in the next few hours, please ignore it.',
      'st.data.title': 'My data on this device', 'st.data.sub': 'Everything below lives only on this device. Personal values are masked — tap “Show” to view.',
      'st.data.reveal': 'Show', 'st.data.hide': 'Hide', 'st.data.export': 'Export a copy (JSON)',
      'st.data.profile': 'Medical profile (encrypted)', 'st.data.identity': 'Identity layer', 'st.data.none': 'None',
      'st.data.buddy': 'Buddy session', 'st.data.buddy_none': 'No active session', 'st.data.events': '{n} events on device',
      'st.data.outbox': 'Outbox to the server', 'st.data.outbox_none': 'Empty', 'st.data.packs': 'Downloaded data packs',
      'st.data.position': 'Last known position', 'st.data.settings': 'Settings', 'st.data.consents': 'Consent',
      'st.data.server': 'The server only receives: Buddy check-ins (plus the medical layer if you agreed), facility reports, and signal logs if enabled.',
      'st.data.code_set': 'Set', 'st.data.protected': 'Protected by your identity code — press and hold, then enter the code',
      'st.data.gate_na': "Couldn't open the confirmation — view the identity layer in the QR profile.",
      'st.sync.title': 'Connection & technical', 'st.sync.sub': 'Network, server, data pack, offline outbox, simulated signal loss',
      'st.sync.carrier': 'Carrier', 'st.sync.pack': 'Route data pack', 'st.sync.model': 'Signal-layer model',
      'st.sync.model_v': '{m} · confidence {x}% ({n} check points)', 'st.sync.model_none': 'No confidence score for this carrier yet',
      'st.packs.more': 'Downloaded packs & browser storage', 'st.content.sources_n': 'Sources ({n})',
      'st.sync.net': 'Network', 'st.sync.backend': 'Server', 'st.sync.device': 'Device ID', 'st.sync.last': 'Last sync',
      'st.sync.outbox': 'Outbox', 'st.sync.outbox_n': '{n} actions', 'st.sync.empty': 'Nothing waiting to be sent.',
      'st.sync.attempts': '{n} attempts', 'st.sync.flush': 'Sync now', 'st.sync.flushed': '{sent} sent, {failed} failed.',
      'st.sync.offline': "You're offline — actions are kept safely and sent at the first signal.",
      'st.sync.sim': 'Simulate signal loss', 'st.sync.sim_d': 'For demos: the whole app behaves as in a dead zone.',
      'st.sync.not_registered': 'Not registered', 'st.sync.more': '+{n} more',
      'st.op.device.register': 'Register device', 'st.op.buddy.start': 'Start Buddy', 'st.op.buddy.checkin': 'Buddy check-in',
      'st.op.buddy.stop': 'Stop Buddy', 'st.op.buddy.resolve': "Buddy: I'm safe", 'st.op.report.submit': 'Facility / content report',
      'st.op.signal.log': 'Anonymous signal log', 'st.op.buddy.update': 'Update Buddy session', 'st.op.device.erase': 'Erase device data on the server',
      'st.content.title': 'Medical content', 'st.content.sub': 'Versions, two-round review, sources',
      'st.content.phrases': 'Medical phrases', 'st.content.firstaid': 'First aid', 'st.content.release': 'Server release',
      'st.content.round1': 'Round 1: {who}', 'st.content.approver': 'Signed off: {who}', 'st.content.pending': 'not signed off yet',
      'st.content.sources': 'Sources', 'st.content.report': 'Report a content error',
      'st.review.in_review': 'Awaiting medical adviser sign-off', 'st.review.approved': 'Approved', 'st.review.draft': 'Draft',
      'st.review.bundled': 'Bundled edition', 'st.review.retracted': 'Retracted',
      'st.report.title': 'Report a medical content error', 'st.report.sub': 'Sent anonymously to the editors. Your medical profile is not included.',
      'st.report.area': 'Area', 'st.report.area.phrases': 'Medical phrases', 'st.report.area.firstaid': 'First aid',
      'st.report.area.other': 'Other', 'st.report.ref': 'Phrase code / item (optional)', 'st.report.ref_ph': 'e.g. MOD01-HEAD-03-2 or cpr',
      'st.report.note': 'What is wrong', 'st.report.note_ph': 'Which line is wrong and how it should read…', 'st.report.send': 'Send report',
      'st.report.need_note': 'Please describe the error.', 'st.report.sent': 'Report received — thank you!',
      'st.report.queued': 'Report saved — it will be sent at the first signal.',
      'st.field.title': 'Field test', 'st.field.sub': 'Medical-phrases KPI: phrase shown to medical staff in under 15 seconds',
      'st.field.timer': 'Time Medical phrases', 'st.field.timer_d': 'Measures the time from opening Medical phrases to showing a phrase to staff.',
      'st.field.n': 'Runs', 'st.field.median': 'Median', 'st.field.best': 'Fastest', 'st.field.under': 'Under 15 s',
      'st.field.empty': 'No runs yet. Turn the timer on, then open “Medical phrases”.', 'st.field.export': 'Export CSV', 'st.field.clear': 'Clear runs',
      'st.field.clear_confirm': 'Delete all {n} timed runs?', 'st.field.cleared': 'Runs cleared.',
      'st.field.col.at': 'Time', 'st.field.col.code': 'Phrase code', 'st.field.col.lang': 'Language', 'st.field.col.time': 'Duration',
      'st.field.recent': 'Last {n} runs',
      'st.about.title': 'About', 'st.about.sub': 'Version, team, licences',
      'st.about.version': 'App version', 'st.about.content': 'Medical content', 'st.about.team': 'Team',
      'st.about.team_v': 'Stormbreakers — AISC’26 · Digital Business Ideas',
      'st.about.licenses': 'Open-source & data licences', 'st.about.onboarding': 'Replay the welcome screens',
      'st.about.free': 'Every life-saving feature is free, no account needed.'
    }
  });

  /* ================================================================== */
  /* Sections [id, icon, tone, folded by default] — markup in index.html  */
  /* ================================================================== */
  var SECTIONS = [
    ['trip', 'route', 'info', false], ['look', 'sun-moon', 'accent', false], ['packs', 'package', 'success', false], ['privacy', 'lock', 'primary', false],
    ['sync', 'server', 'info', true], ['content', 'book-open', 'success', true], ['field', 'timer', 'warning', true], ['about', 'info', 'neutral', true]
  ];

  /* ================================================================== */
  /* State                                                                */
  /* ================================================================== */
  var root = null, visible = false;
  var CARRIERS = [{ id: 'viettel' }, { id: 'vinaphone' }, { id: 'mobifone' }];
  var CONSENT_KEYS = ['terms', 'sensitive', 'deadman', 'share_medical_in_alert', 'community_logs'];
  var st = { consents: null, packs: [], routes: null, pack: null, busy: {}, estimate: null, persisted: null, timings: [], release: null, outbox: [], status: null, session: null, idProtected: true };
  var SECTION_IDS = SECTIONS.map(function (x) { return x[0]; });

  function carrierName(id) { return NC.app && NC.app.carrierName ? NC.app.carrierName(id) : id; }
  function routeName(id) { return NC.app && NC.app.routeName ? NC.app.routeName(id) : id; }
  function seedRoutes() {
    var r = window.NC_SEED && window.NC_SEED.routes;
    return r ? r.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }) : [];
  }
  /** Section card element for a known section id (route params are untrusted → whitelist, no selector building). */
  function sectionEl(id) {
    if (!root || SECTION_IDS.indexOf(String(id)) < 0) return null;
    var el = document.getElementById('st-' + id);
    return el && root.contains(el) ? el : null;
  }
  function body(id) {
    if (!root || SECTION_IDS.indexOf(String(id)) < 0) return null;
    var el = document.getElementById('st-' + id + '-body');
    return el && root.contains(el) ? el : null;
  }
  function call(fn, def) {
    try { return Promise.resolve(fn()).then(null, function () { return def; }); } catch (e) { return Promise.resolve(def); }
  }
  function online() { return !!(NC.net && NC.net.online()); }

  function seg(name, value, options) {
    return '<div class="segmented st-seg" role="radiogroup" data-st-seg="' + name + '">' + options.map(function (o) {
      var on = o.value === value;
      return '<button type="button" class="segmented__btn' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-value="' + esc(o.value) + '"' + (o.lang ? ' lang="' + o.lang + '"' : '') + '>' +
        (o.icon ? icon(o.icon) : '') + '<span>' + esc(o.label) + '</span></button>';
    }).join('') + '</div>';
  }
  function row(label, control, hint, id) {
    return '<div class="st-row"' + (id ? ' id="' + id + '"' : '') + '><p class="st-row__label">' + esc(label) + '</p>' + control +
      (hint ? '<p class="st-hint">' + icon('info', 'icon--xs') + '<span>' + esc(hint) + '</span></p>' : '') + '</div>';
  }
  function kv(k, v) { return '<div class="kv__row"><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; }
  function switchRow(id, on, title, desc, opts) {
    var o = opts || {};
    return '<label class="switch switch--end st-switch' + (o.disabled ? ' is-locked' : '') + '">' +
      '<input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + (o.disabled ? ' disabled' : '') + (o.data ? ' ' + o.data : '') + '>' +
      '<span class="switch__track"></span><span class="switch__label"><b>' + esc(title) + (o.badge ? ' <span class="badge badge--neutral">' + esc(o.badge) + '</span>' : '') + '</b>' +
      (desc ? '<small>' + esc(desc) + '</small>' : '') + '</span></label>';
  }

  /* ================================================================== */
  /* Cards                                                                */
  /* ================================================================== */
  function renderTrip() {
    var b = body('trip'); if (!b) return;
    var rid = S('route_id'), car = S('carrier'), mode = S('travel_mode');
    var routes = seedRoutes().map(function (r) {
      var on = r.id === rid;
      return '<button type="button" class="st-route' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-st="route" data-value="' + esc(r.id) + '">' +
        '<span class="icon-tile icon-tile--sm icon-tile--' + (r.travel_mode === 'hiking' ? 'success' : 'info') + '">' + icon(r.travel_mode === 'hiking' ? 'footprints' : 'bike') + '</span>' +
        '<span class="st-route__body"><span class="st-route__name">' + esc(lang() === 'en' && r.name_en ? r.name_en : r.name) + '</span>' +
        '<span class="st-route__meta">' + (lang() === 'en' && r.region_en && r.region_en !== r.region ? esc(r.region_en) : viText(r.region)) + ' · ' + esc(U.fmtKm(+r.length_km)) + '</span></span>' +
        '<span class="st-route__radio" aria-hidden="true">' + icon(on ? 'check-circle' : 'circle') + '</span></button>';
    }).join('');
    b.innerHTML =
      row(t('st.trip.route'), '<div class="st-routes" role="radiogroup">' + routes + '</div>') +
      row(t('st.trip.carrier'), seg('carrier', car, CARRIERS.map(function (c) { return { value: c.id, label: carrierName(c.id) }; })), t('st.trip.note')) +
      row(t('st.trip.mode'), seg('travel_mode', mode === 'hiking' ? 'hiking' : 'motorbike', [
        { value: 'motorbike', label: t('home.mode.motorbike'), icon: 'bike' }, { value: 'hiking', label: t('home.mode.hiking'), icon: 'footprints' }
      ]));
  }

  function renderLook() {
    var b = body('look'); if (!b) return;
    var L = ((window.NC_PHRASES && window.NC_PHRASES.languages) || [{ code: 'en', name: 'English', name_en: 'English' }]).filter(function (x) { return x.code !== 'vi'; });
    var ul = S('user_lang') || 'en';
    b.innerHTML =
      row(t('st.look.lang'), seg('lang', lang(), [{ value: 'vi', label: 'Tiếng Việt', lang: 'vi' }, { value: 'en', label: 'English', lang: 'en' }])) +
      row(t('st.look.theme'), seg('theme', S('theme') || 'auto', [
        { value: 'auto', label: t('app.theme.auto'), icon: 'sun-moon' }, { value: 'light', label: t('app.theme.light'), icon: 'sun' }, { value: 'dark', label: t('app.theme.dark'), icon: 'moon' }
      ])) +
      '<div class="st-row"><label class="st-row__label" for="st-ulang">' + esc(t('st.look.ulang')) + '</label>' +
        '<select class="select" id="st-ulang" data-st="ulang">' + L.map(function (x) {
          return '<option value="' + esc(x.code) + '"' + (x.code === ul ? ' selected' : '') + '>' + esc(x.name + (x.name !== x.name_en ? ' — ' + x.name_en : '')) + '</option>';
        }).join('') + '</select>' +
        '<p class="st-hint">' + icon('info', 'icon--xs') + '<span>' + esc(t('st.look.ulang_hint')) + '</span></p></div>';
  }

  /** "Xem thêm"-style fold inside a card: the shared .disclosure (components.css); st-more keeps the card divider. */
  function more(title, inner, open) {
    return '<details class="disclosure st-more"' + (open ? ' open' : '') + '><summary class="disclosure__sum">' +
      '<span class="disclosure__txt"><span class="disclosure__title">' + esc(title) + '</span></span>' +
      '<span class="disclosure__chev" aria-hidden="true">' + icon('chevron-down', 'icon--sm') + '</span></summary>' +
      '<div class="disclosure__body">' + inner + '</div></details>';
  }

  /* ---------- packs ---------- */
  function renderPacks() {
    var b = body('packs'); if (!b) return;
    var rid = S('route_id'), car = S('carrier');
    var p = st.pack;
    var row0 = st.routes ? st.routes.filter(function (r) { return r.id === rid; })[0] : null;
    var srv = row0 && row0.packs ? row0.packs[car] : null;
    var dlCur = st.packs.filter(function (x) { return x.route_id === rid && x.carrier === car; })[0];
    var upd = !!(row0 && row0.downloaded && row0.downloaded[car] && row0.downloaded[car].update_available);
    var srcKey = p ? 'st.packs.src.' + (p.source || 'bundled') : null;
    var busyCur = !!st.busy[rid + ':' + car];
    var on = online();
    var cur =
      '<div class="st-pack-cur">' +
        '<span class="icon-tile icon-tile--' + (p && p.source === 'downloaded' ? 'success' : 'neutral') + '">' + icon(p && p.source === 'downloaded' ? 'check-circle' : 'package') + '</span>' +
        '<div class="st-pack-cur__body"><p class="st-pack-cur__t">' + esc(t('st.packs.current', { route: routeName(rid), carrier: carrierName(car) })) + '</p>' +
          '<p class="st-pack-cur__d">' + (p ? esc(t(srcKey, { v: p.version })) : '—') +
          (p && p.size_bytes ? ' · ' + esc(U.fmtBytes(p.size_bytes)) : '') + (upd ? ' · <span class="badge badge--warning">' + esc(t('st.packs.update_badge', { v: srv.version })) + '</span>' : '') + '</p>' +
          (srv ? '<p class="st-pack-cur__d st-muted">' + esc(t('st.packs.latest', { v: srv.version, size: U.fmtBytes(srv.size_bytes) })) + '</p>' : '') +
        '</div>' +
        '<button type="button" class="btn btn--' + (dlCur && !upd ? 'soft' : 'primary') + ' btn--sm st-pack-cur__btn' + (busyCur ? ' is-loading' : '') + '" data-st="download" data-route="' + esc(rid) + '" data-carrier="' + esc(car) + '"' + (on && !busyCur ? '' : ' disabled') + '>' +
          icon(dlCur ? 'refresh' : 'download') + '<span>' + esc(dlCur ? (upd ? t('st.packs.update') : t('st.packs.redownload')) : t('st.packs.download')) + '</span></button>' +
      '</div>' +
      (!on ? '<p class="st-hint st-hint--warn">' + icon('wifi-off', 'icon--xs') + '<span>' + esc(t('st.packs.need_net')) + '</span></p>' : '');

    var table;
    if (!st.packs.length) {
      table = '<p class="st-empty">' + icon('package', 'icon--sm') + '<span>' + esc(t('st.packs.none')) + '</span></p>';
    } else {
      table = '<div class="table-wrap"><table class="table st-table"><thead><tr>' +
        ['route', 'carrier', 'version', 'size', 'date', 'actions'].map(function (c) { return '<th scope="col"' + (c === 'size' || c === 'version' ? ' class="num"' : '') + '>' + esc(t('st.packs.col.' + c)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + st.packs.map(function (x) {
          var r = st.routes ? st.routes.filter(function (y) { return y.id === x.route_id; })[0] : null;
          var u = !!(r && r.downloaded && r.downloaded[x.carrier] && r.downloaded[x.carrier].update_available);
          var key = x.route_id + ':' + x.carrier;
          return '<tr><td class="table__primary" data-label="' + esc(t('st.packs.col.route')) + '">' + esc(routeName(x.route_id)) + '</td>' +
            '<td data-label="' + esc(t('st.packs.col.carrier')) + '">' + esc(carrierName(x.carrier)) + '</td>' +
            '<td class="num" data-label="' + esc(t('st.packs.col.version')) + '">v' + esc(x.version) + (u ? ' <span class="badge badge--warning">' + esc(t('st.packs.update_badge', { v: r.packs[x.carrier].version })) + '</span>' : '') + '</td>' +
            '<td class="num" data-label="' + esc(t('st.packs.col.size')) + '">' + esc(U.fmtBytes(x.size_bytes)) + '</td>' +
            '<td data-label="' + esc(t('st.packs.col.date')) + '">' + esc(U.fmtDateTime(x.downloaded_at)) + '</td>' +
            '<td data-label="' + esc(t('st.packs.col.actions')) + '"><span class="st-actions">' +
              (u ? '<button type="button" class="btn btn--soft btn--sm' + (st.busy[key] ? ' is-loading' : '') + '" data-st="download" data-route="' + esc(x.route_id) + '" data-carrier="' + esc(x.carrier) + '"' + (on ? '' : ' disabled') + '>' + icon('refresh') + '<span>' + esc(t('st.packs.update')) + '</span></button>' : '') +
              '<button type="button" class="btn btn--ghost btn--sm st-danger-text" data-st="remove" data-route="' + esc(x.route_id) + '" data-carrier="' + esc(x.carrier) + '">' + icon('trash') + '<span>' + esc(t('st.packs.remove')) + '</span></button>' +
            '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    var e = st.estimate;
    var storage = '<div class="st-storage"><p class="st-row__label">' + icon('hard-drive', 'icon--sm') + esc(t('st.storage.title')) + '</p>';
    if (e && e.quota) {
      var pc = Math.max(0.01, Math.min(1, (e.usage || 0) / e.quota));
      storage += '<div class="progress progress--sm" aria-hidden="true"><div class="progress__bar" style="width:' + (pc * 100).toFixed(2) + '%"></div></div>' +
        '<p class="st-muted">' + esc(t('st.storage.used', { used: U.fmtBytes(e.usage || 0), quota: U.fmtBytes(e.quota) })) + '</p>';
    } else {
      storage += '<p class="st-muted">' + esc(t('st.storage.na')) + '</p>';
    }
    if (navigator.storage && navigator.storage.persist) {
      storage += st.persisted
        ? '<p class="st-ok">' + icon('shield-check', 'icon--sm') + '<span>' + esc(t('st.storage.persisted')) + '</span></p>'
        : '<button type="button" class="btn btn--outline btn--sm btn--wrap st-persist" data-st="persist">' + icon('shield') + '<span>' + esc(t('st.storage.persist')) + '</span></button>';
    }
    storage += '</div>';
    var wasOpen = !!(b.querySelector('.st-more') && b.querySelector('.st-more').open);
    b.innerHTML = cur + more(t('st.packs.more') + (st.packs.length ? ' · ' + st.packs.length : ''), table + storage, wasOpen);
  }

  /* ---------- privacy ---------- */
  function renderPrivacy() {
    var b = body('privacy'); if (!b) return;
    var enc = !(NC.secure && NC.secure.encrypted === false);
    var c = st.consents || {};
    var list = CONSENT_KEYS.map(function (k) {
      var locked = k === 'terms';
      // Honest per mode (R7): the local build only simulates the overdue e-mail.
      var dKey = k === 'deadman' && !(NC.data && NC.data.mode === 'supabase') ? 'st.c.deadman_d_local' : 'st.c.' + k + '_d';
      return switchRow('st-c-' + k, !!c[k], t('st.c.' + k), t(dKey),
        { disabled: locked && !!c[k], badge: locked ? t('st.c.locked') : null, data: 'data-st="consent" data-key="' + k + '"' });
    }).join('');
    // MOD.02 online search/routing consent (asked once in MOD.02) — withdrawable here.
    if (NC.geoOnline && NC.geoOnline.consented) {
      list += switchRow('st-c-geo-online', NC.geoOnline.consented(), t('st.c.geo_online'), t('st.c.geo_online_d'), { data: 'data-st="geo-online"' });
    }
    b.innerHTML =
      '<p class="st-enc st-enc--' + (enc ? 'on' : 'off') + '">' + icon(enc ? 'lock' : 'alert-triangle', 'icon--sm') + '<span>' + esc(t(enc ? 'st.privacy.enc_on' : 'st.privacy.enc_off')) + '</span></p>' +
      '<div class="st-row"><p class="st-row__label">' + esc(t('st.privacy.consents')) + '</p><div class="st-switches">' + list + '</div>' +
        '<p class="st-hint">' + icon('clock', 'icon--xs') + '<span>' + esc(c.at ? t('st.privacy.updated', { time: U.fmtDateTime(c.at) }) : t('st.privacy.never')) + '</span></p></div>' +
      '<div class="st-privacy__actions">' +
        '<button type="button" class="btn btn--outline btn--block" data-st="view">' + icon('eye') + '<span>' + esc(t('st.privacy.view')) + '</span></button>' +
        '<button type="button" class="btn btn--danger btn--block btn--wrap st-wipe" id="st-wipe">' + icon('trash') +
          '<span>' + esc(t('st.privacy.wipe')) + '<span class="hold__hint">' + esc(t('st.privacy.wipe_hint')) + '</span></span></button>' +
        '<p class="st-hint">' + icon('info', 'icon--xs') + '<span>' + esc(t(hasServerErase() ? 'st.privacy.wipe_note' : 'st.privacy.wipe_note_local')) + '</span></p>' +
        (st.session && !online() ? '<p class="st-hint st-hint--warn" role="note">' + icon('wifi-off', 'icon--xs') + '<span>' +
          esc(t(hasServerErase() ? 'st.privacy.wipe_offline' : 'st.privacy.wipe_offline_local', { name: buddyName(st.session), time: alertTime(st.session) })) + '</span></p>' : '') +
      '</div>';
    var wipe = b.querySelector('#st-wipe');
    if (wipe && NC.ui && NC.ui.holdToConfirm) NC.ui.holdToConfirm(wipe, 1500, doWipe);
  }

  /* ---------- sync ---------- */
  function renderSync() {
    var b = body('sync'); if (!b) return;
    var ns = NC.net ? NC.net.status() : { online: true, simulated: false, real: true };
    var s = NC.data && NC.data.status ? NC.data.status() : {};
    var mode = s.mode || (NC.data && NC.data.mode);
    var ops = st.outbox || [];
    var netV = '<span class="signal-dot signal-dot--' + (ns.online ? 'likely' : 'uncertain') + '"></span> ' +
      esc(ns.online ? t('app.net.online') : (ns.simulated ? t('app.net.offline_sim') : t('app.net.offline')));
    var opsHtml = !ops.length ? '<p class="st-empty">' + icon('check-circle', 'icon--sm') + '<span>' + esc(t('st.sync.empty')) + '</span></p>' :
      '<ul class="st-ops">' + ops.slice(0, 8).map(function (o) {
        var lk = 'st.op.' + o.op;
        return '<li class="st-op"><span class="st-op__icon">' + icon(o.last_error ? 'alert-triangle' : 'cloud-upload', 'icon--sm') + '</span>' +
          '<span class="st-op__body"><b>' + esc(NC.i18n && NC.i18n.has(lk) ? t(lk) : o.op) + '</b>' +
          '<small>' + esc(U.relTime(o.created_at)) + (o.attempts ? ' · ' + esc(t('st.sync.attempts', { n: o.attempts })) : '') +
          (o.last_error ? ' · ' + esc(String(o.last_error).slice(0, 60)) : '') + '</small></span></li>';
      }).join('') + (ops.length > 8 ? '<li class="st-op st-op--more">' + esc(t('st.sync.more', { n: ops.length - 8 })) + '</li>' : '') + '</ul>';
    var p = st.pack;
    var packV = p ? esc(routeName(p.route && p.route.id ? p.route.id : S('route_id'))) + ' · ' + esc(t('st.packs.src.' + (p.source || 'bundled'), { v: p.version })) : '—';
    var modelV = p && p.accuracy !== null && p.accuracy !== undefined
      ? esc(t('st.sync.model_v', { m: p.model_version || '—', x: Math.round(p.accuracy * 100), n: p.holdout_n || 0 }))
      : esc(p && p.model_version ? p.model_version + ' · ' + t('st.sync.model_none') : t('st.sync.model_none'));
    b.innerHTML =
      '<dl class="kv st-kv">' +
        kv(t('st.sync.net'), netV) +
        kv(t('st.sync.backend'), esc(mode ? t('app.backend.' + mode + '_long') : t('app.backend.none'))) +
        kv(t('st.sync.carrier'), esc(carrierName(S('carrier')))) +
        kv(t('st.sync.pack'), packV) +
        kv(t('st.sync.model'), '<span class="st-kv__long">' + modelV + '</span>') +
        kv(t('st.sync.outbox'), esc(t('st.sync.outbox_n', { n: ops.length }))) +
        kv(t('st.sync.last'), esc(s.lastSyncAt ? U.relTime(s.lastSyncAt) : t('common.never'))) +
        kv(t('st.sync.device'), s.deviceId ? '<span class="mono">' + esc(String(s.deviceId).slice(0, 8)) + '…</span>' : esc(t('st.sync.not_registered'))) +
      '</dl>' + opsHtml +
      '<div class="st-sync__actions"><button type="button" class="btn btn--primary btn--sm' + (st.busy.flush ? ' is-loading' : '') + '" data-st="flush"' + (ns.online ? '' : ' disabled') + '>' + icon('refresh') + '<span>' + esc(t('st.sync.flush')) + '</span></button>' +
        (!ns.online ? '<p class="st-hint st-hint--warn">' + icon('wifi-off', 'icon--xs') + '<span>' + esc(t('st.sync.offline')) + '</span></p>' : '') + '</div>' +
      '<div class="st-sim card card--flat">' + switchRow('st-sim', !!ns.simulated, t('st.sync.sim'), t('st.sync.sim_d'), { data: 'data-st="sim"' }) + '</div>';
  }

  /* ---------- content ---------- */
  function reviewBadge(status) {
    var key = 'st.review.' + (status || 'in_review');
    var v = status === 'approved' ? 'success' : status === 'retracted' ? 'danger' : status === 'bundled' ? 'neutral' : 'warning';
    return '<span class="badge badge--' + v + '">' + esc(NC.i18n && NC.i18n.has(key) ? t(key) : status) + '</span>';
  }
  function renderContent() {
    var b = body('content'); if (!b) return;
    var P = window.NC_PHRASES, F = window.NC_FIRSTAID, R = st.release;
    var en = lang() === 'en';
    function item(title, ver, rev, extra, extraVi) {
      return '<li class="st-ver"><div class="st-ver__head"><b>' + esc(title) + '</b><span class="mono st-ver__v">v' + esc(ver || '—') + '</span></div>' +
        '<div class="st-ver__meta">' + reviewBadge(rev && rev.status) +
        (rev && (rev.round1 || rev.reviewer_round1) ? '<span>' + esc(t('st.content.round1', { who: rev.round1 || rev.reviewer_round1 })) + '</span>' : '') +
        '<span>' + esc(rev && rev.approver ? t('st.content.approver', { who: rev.approver }) : t('st.content.pending')) + '</span></div>' +
        (extra ? '<p class="st-ver__note"' + (extraVi ? ' lang="vi"' : '') + '>' + esc(extra) + '</p>' : '') + '</li>';
    }
    var list = '<ul class="st-vers">' +
      (P ? item(t('st.content.phrases'), P.version, P.review, P.review ? (en ? P.review.note_en : P.review.note) : '') : '') +
      (F ? item(t('st.content.firstaid'), F.version, F.review, F.review ? (en ? F.review.note_en : F.review.note) : '') : '') +
      (R ? item(t('st.content.release'), R.version, R, R.notes || '', en) : '') +
      '</ul>';
    var sources = F && F.sources ? more(t('st.content.sources_n', { n: F.sources.length }), '<ol class="st-sources">' + F.sources.map(function (s) {
      return '<li><b>' + viText(s.short) + (s.year ? ' · ' + esc(s.year) : '') + '</b><span' + (en && !s.title_en ? ' lang="vi"' : '') + '>' + esc(en && s.title_en ? s.title_en : s.title) + '</span>' +
        '<small>' + esc(s.publisher ? (en ? s.publisher.en : s.publisher.vi) : '') + '</small></li>';
    }).join('') + '</ol>') : '';
    // Settings is not a medical screen → no medical disclaimer (round 2); the medical screens carry it + 115.
    b.innerHTML = list + sources +
      '<button type="button" class="btn btn--outline btn--sm" data-st="report">' + icon('message-square') + '<span>' + esc(t('st.content.report')) + '</span></button>';
  }

  /* ---------- field test ---------- */
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function secs(ms) { return U.fmtNumber((ms || 0) / 1000, 1) + ' s'; }
  function renderField() {
    var b = body('field'); if (!b) return;
    var tm = (st.timings || []).filter(function (x) { return x && isFinite(x.ms); });
    var ms = tm.map(function (x) { return +x.ms; });
    var med = median(ms);
    var under = ms.filter(function (v) { return v < 15000; }).length;
    var html = '<div class="st-field-switch">' + switchRow('st-timer', !!S('demo_timer'), t('st.field.timer'), t('st.field.timer_d'), { data: 'data-st="timer"' }) + '</div>';
    if (!tm.length) {
      html += '<p class="st-empty">' + icon('timer', 'icon--sm') + '<span>' + esc(t('st.field.empty')) + '</span></p>';
    } else {
      html += '<div class="st-stats">' +
        '<div class="st-stat"><span class="st-stat__v">' + tm.length + '</span><span class="st-stat__l">' + esc(t('st.field.n')) + '</span></div>' +
        '<div class="st-stat' + (med !== null && med < 15000 ? ' is-ok' : ' is-bad') + '"><span class="st-stat__v">' + esc(secs(med)) + '</span><span class="st-stat__l">' + esc(t('st.field.median')) + '</span></div>' +
        '<div class="st-stat"><span class="st-stat__v">' + esc(secs(Math.min.apply(null, ms))) + '</span><span class="st-stat__l">' + esc(t('st.field.best')) + '</span></div>' +
        '<div class="st-stat"><span class="st-stat__v">' + Math.round(under / tm.length * 100) + '%</span><span class="st-stat__l">' + esc(t('st.field.under')) + '</span></div>' +
        '</div>';
      var recent = tm.slice(-10).reverse();
      html += '<p class="st-row__label">' + esc(t('st.field.recent', { n: recent.length })) + '</p>' +
        '<div class="table-wrap"><table class="table st-table"><thead><tr>' +
        ['at', 'code', 'lang', 'time'].map(function (c) { return '<th scope="col"' + (c === 'time' ? ' class="num"' : '') + '>' + esc(t('st.field.col.' + c)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + recent.map(function (x) {
          return '<tr><td data-label="' + esc(t('st.field.col.at')) + '">' + esc(U.fmtDateTime(x.at)) + '</td>' +
            '<td data-label="' + esc(t('st.field.col.code')) + '"><span class="mono">' + esc(x.code || '—') + '</span></td>' +
            '<td data-label="' + esc(t('st.field.col.lang')) + '">' + esc(String(x.lang || '—').toUpperCase()) + '</td>' +
            '<td class="num" data-label="' + esc(t('st.field.col.time')) + '"><span class="' + (x.ms < 15000 ? 'text-success' : 'text-danger') + ' fw-700">' + esc(secs(x.ms)) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="cluster"><button type="button" class="btn btn--soft btn--sm" data-st="csv">' + icon('download') + '<span>' + esc(t('st.field.export')) + '</span></button>' +
        '<button type="button" class="btn btn--ghost btn--sm st-danger-text" data-st="clear-timings">' + icon('trash') + '<span>' + esc(t('st.field.clear')) + '</span></button></div>';
    }
    b.innerHTML = html;
  }

  /* ---------- about ---------- */
  var LICENSES = [
    ['Leaflet', 'BSD-2-Clause'], ['qrcodejs', 'MIT'], ['supabase-js', 'MIT'], ['Be Vietnam Pro', 'SIL OFL-1.1'],
    ['Lucide (icon style)', 'ISC'], ['Map data', '© OpenStreetMap contributors (ODbL)'], ['Map tiles', '© CARTO · © OpenStreetMap'],
    ['Weather', 'Open-Meteo (CC BY 4.0)']
  ];
  function renderAbout() {
    var b = body('about'); if (!b) return;
    var cfg = window.NC_CONFIG || {};
    b.innerHTML =
      '<div class="st-about__brand"><img src="' + esc(NC.ui && NC.ui.assetUrl ? NC.ui.assetUrl('assets/img/logo.svg') : 'assets/img/logo.svg') + '" alt="" width="48" height="48">' +
        '<div><p class="st-about__name">Nomad<b>Care</b></p><p class="st-muted">' + esc(t('app.tagline')) + '</p></div></div>' +
      '<dl class="kv st-kv">' +
        kv(t('st.about.version'), '<span class="mono">v' + esc(cfg.appVersion || '2.0.0') + '</span>') +
        kv(t('st.about.content'), '<span class="mono">v' + esc(cfg.contentVersion || (window.NC_FIRSTAID && window.NC_FIRSTAID.version) || '—') + '</span>') +
        kv(t('st.about.team'), esc(t('st.about.team_v'))) +
      '</dl>' +
      '<p class="st-ok">' + icon('heart', 'icon--sm') + '<span>' + esc(t('st.about.free')) + '</span></p>' +
      more(t('st.about.licenses'), '<ul class="st-licenses">' + LICENSES.map(function (l) { return '<li><b>' + esc(l[0]) + '</b><span>' + esc(l[1]) + '</span></li>'; }).join('') + '</ul>') +
      '<button type="button" class="btn btn--ghost btn--sm" data-st="onboarding">' + icon('sparkles') + '<span>' + esc(t('st.about.onboarding')) + '</span></button>';
  }

  function renderAll() {
    if (!root) return;
    renderTrip(); renderLook(); renderPacks(); renderPrivacy(); renderSync(); renderContent(); renderField(); renderAbout();
  }

  /* ================================================================== */
  /* Data                                                                 */
  /* ================================================================== */
  function loadPacks() {
    if (!NC.data) return Promise.resolve();
    var rid = S('route_id'), car = S('carrier');
    return Promise.all([
      call(function () { return NC.data.listDownloadedPacks(); }, []),
      call(function () { return NC.data.getPack(rid, car); }, null)
    ]).then(function (r) {
      st.packs = r[0] || []; st.pack = r[1];
      renderPacks(); renderSync();
      return call(function () { return NC.data.listRoutes(); }, null);
    }).then(function (rows) { if (rows) { st.routes = rows; renderPacks(); } });
  }
  function loadStorage() {
    var jobs = [];
    if (navigator.storage && navigator.storage.estimate) jobs.push(call(function () { return navigator.storage.estimate(); }, null).then(function (e) { st.estimate = e; }));
    if (navigator.storage && navigator.storage.persisted) jobs.push(call(function () { return navigator.storage.persisted(); }, null).then(function (p) { st.persisted = p; }));
    return Promise.all(jobs).then(renderPacks);
  }
  function loadConsents() {
    if (!NC.profile || !NC.profile.consents) return Promise.resolve();
    return call(function () { return NC.profile.consents.get(); }, null).then(function (c) { st.consents = c; renderPrivacy(); });
  }
  /** The privacy card only shows the Buddy session in the offline wipe warning → re-render only when that changes. */
  function sessionKey(x) { return x && !online() ? [x.status, x.next_due_at, x.grace_min, buddyName(x)].join('|') : ''; }
  function setSession(x) {
    var before = sessionKey(st.session);
    st.session = x;
    if (sessionKey(x) !== before) renderPrivacy();
  }
  function loadBuddy() { return buddyState().then(setSession); }
  function peekProtected() {
    var p = NC.profile && typeof NC.profile.peek === 'function' ? NC.profile.peek() : undefined;
    return p === undefined ? true : hasRevealCode(p);   // unknown yet → neutral until the profile is read
  }
  function loadIdFlag() {
    if (!NC.profile || typeof NC.profile.get !== 'function') { st.idProtected = false; return Promise.resolve(); }
    return call(function () { return NC.profile.get(); }, null).then(function (p) {
      var v = hasRevealCode(p);
      if (v !== st.idProtected) { st.idProtected = v; renderPrivacy(); }
    });
  }
  function loadSync() {
    if (!NC.data || !NC.data.outbox) { renderSync(); return Promise.resolve(); }
    return call(function () { return NC.data.outbox(); }, []).then(function (ops) { st.outbox = ops || []; renderSync(); });
  }
  function loadContent() {
    if (!NC.data) { renderContent(); return Promise.resolve(); }
    return call(function () { return NC.data.contentRelease(); }, null).then(function (r) { st.release = r; renderContent(); });
  }
  function loadTimings() {
    if (!NC.store) { renderField(); return Promise.resolve(); }
    return call(function () { return NC.store.get('tr.timings'); }, []).then(function (v) { st.timings = Array.isArray(v) ? v : []; renderField(); });
  }
  function loadAll() { return Promise.all([loadPacks(), loadStorage(), loadConsents(), loadIdFlag(), loadBuddy(), loadSync(), loadContent(), loadTimings()]); }

  /* ================================================================== */
  /* Actions                                                              */
  /* ================================================================== */
  function download(rid, car) {
    var key = rid + ':' + car;
    if (st.busy[key] || !NC.data) return;
    st.busy[key] = true; renderPacks();
    NC.data.downloadPack(rid, car).then(function (m) {
      st.busy[key] = false;
      toast(t('st.packs.downloaded_toast', { route: routeName(rid), carrier: carrierName(car), v: m.version }), { type: 'success' });
      return Promise.all([loadPacks(), loadStorage()]);
    }, function (e) {
      st.busy[key] = false; renderPacks();
      toast(e && e.code === 'offline' ? t('st.packs.need_net') : t('st.packs.failed'), { type: 'warning' });
    });
  }
  function removePack(rid, car) {
    var ask = NC.ui ? NC.ui.confirm({ title: t('st.packs.remove'), message: t('st.packs.remove_confirm', { route: routeName(rid), carrier: carrierName(car) }), confirmLabel: t('st.packs.remove'), danger: true }) : Promise.resolve(true);
    ask.then(function (ok) {
      if (!ok) return;
      return NC.data.removePack(rid, car).then(function () {
        toast(t('st.packs.removed_toast'), { type: 'success' });
        return Promise.all([loadPacks(), loadStorage()]);
      });
    });
  }
  function persist() {
    navigator.storage.persist().then(function (ok) {
      st.persisted = !!ok;
      if (!ok) toast(t('st.storage.persist_denied'), { type: 'warning', timeout: 5000 });
      renderPacks();
    }, function () { toast(t('st.storage.persist_denied'), { type: 'warning' }); });
  }

  /* ---------- consent withdrawal must stop the processing that depends on it ---------- */
  /** Open Buddy session (active/overdue/alerted) or null. */
  function buddyState() {
    if (!NC.data || !NC.data.buddy || typeof NC.data.buddy.current !== 'function') return Promise.resolve(null);
    return call(function () { return NC.data.buddy.current(); }, null).then(function (s) { return s && s.status !== 'closed' ? s : null; });
  }
  /** FIX_CONTRACT A1: NC.data.buddy.update(patch) redacts the running session (local + server via outbox). */
  function canRedact() { return !!(NC.data && NC.data.buddy && typeof NC.data.buddy.update === 'function'); }
  /** FIX_CONTRACT A2/A3: wipePersonal() also erases server data (tombstone flushed when back online). */
  function hasServerErase() { return !!(NC.data && typeof NC.data.eraseServerData === 'function'); }
  /** True when the identity layer is protected by a 4-digit reveal code (MOD.03). */
  function hasRevealCode(p) { return !!(p && p.identity && p.identity.reveal_code); }
  /**
   * Buddy recipient as shown in Settings copy. NOTES §6: with a reveal code set, names stay behind the MOD.03 gate →
   * neutral "người nhận" / "your recipient". prot overrides the current flag (wipe notices after the profile is gone).
   */
  function buddyName(s, prot) {
    var hide = prot === undefined ? st.idProtected : prot;
    return (!hide && s && (s.recipient_name || s.recipient_email)) || t('st.c.your_buddy');
  }
  /** Earliest time the server may alert the recipient (next_due_at + grace). */
  function alertTime(s) {
    var due = s && s.next_due_at ? Date.parse(s.next_due_at) : NaN;
    if (!isFinite(due)) return '—';
    return U.fmtTime(new Date(due + (s.grace_min || 0) * 60000));
  }
  function isLate(s) { return !!s && (s.status === 'overdue' || s.status === 'alerted'); }
  /**
   * Remove the public medical layer from the running session. Without the buddy.update API the only way to guarantee
   * no further alert carries medical data is to stop the session (the caller has told the user so).
   * @returns {Promise<'updated'|'stopped'|null>}
   */
  function redactBuddy(s) {
    if (!s || !s.share_public_medical) return Promise.resolve(null);
    if (canRedact()) return Promise.resolve(NC.data.buddy.update({ share_public_medical: false, public_medical: null })).then(function () { return 'updated'; });
    return Promise.resolve(NC.data.buddy.stop()).then(function () { return 'stopped'; });
  }
  function buddyToast(how) {
    if (how === 'updated') return t(online() ? 'st.c.buddy_redacted' : 'st.c.buddy_redacted_offline');
    if (how === 'stopped') return t('st.c.buddy_stopped');
    return '';
  }
  function para(text) { return '<p class="confirm__msg">' + esc(text) + '</p>'; }

  /**
   * Withdraw the sensitive-data consent: confirm → consents {sensitive:false, share_medical_in_alert:false} → delete
   * the profile → redact the running Buddy session. Shared with onboarding (NC.settingsScreen.withdrawMedical).
   * @returns {Promise<{ok:boolean, buddy?:string|null}>}
   */
  function withdrawMedical() {
    if (!NC.profile || !NC.profile.consents || !NC.ui) return Promise.resolve({ ok: false });
    return buddyState().then(function (s) {
      var sharing = !!(s && s.share_public_medical);
      var html = para(t('st.c.withdraw_msg')) + para(t('st.c.withdraw_saved_qr')) +
        (sharing ? para(t(canRedact() ? 'st.c.withdraw_buddy_update' : 'st.c.withdraw_buddy_stop')) : '');
      return NC.ui.confirm({ title: t('st.c.withdraw_title'), html: html, confirmLabel: t('st.c.withdraw_ok'), danger: true }).then(function (ok) {
        if (!ok) return { ok: false };
        return NC.profile.consents.set({ sensitive: false, share_medical_in_alert: false })
          .then(function () { return NC.profile.clear(); })
          .then(function () { return redactBuddy(sharing ? s : null); })
          .then(function (how) { return { ok: true, buddy: how }; });
      });
    });
  }

  function setConsent(key, on, input) {
    if (!NC.profile || !NC.profile.consents) return;
    var revert = function () { if (input) input.checked = !on; };
    var fail = function () { toast(t('common.error'), { type: 'danger' }); loadConsents(); };
    if (key === 'sensitive' && !on) {
      withdrawMedical().then(function (r) {
        if (!r.ok) { revert(); return; }
        var extra = buddyToast(r.buddy);
        toast(t('st.c.withdrawn') + (extra ? ' ' + extra : ''), { type: 'success', timeout: extra ? 5000 : 3500 });
        loadConsents(); loadBuddy();
      }, fail);
      return;
    }
    if (key === 'share_medical_in_alert' && !on) {
      buddyState().then(function (s) {
        var sharing = !!(s && s.share_public_medical);
        var ask = sharing && !canRedact()
          ? NC.ui.confirm({ title: t('st.c.share_title'), message: t('st.c.withdraw_buddy_stop'), confirmLabel: t('st.c.share_ok'), danger: true })
          : Promise.resolve(true);
        return ask.then(function (ok) {
          if (!ok) { revert(); return; }
          return NC.profile.consents.set({ share_medical_in_alert: false }).then(function () {
            return redactBuddy(sharing ? s : null);
          }).then(function (how) {
            var extra = buddyToast(how);
            toast(extra || t('st.c.saved'), { type: 'success', timeout: extra ? 4500 : 1800 });
            loadConsents(); loadBuddy();
          });
        });
      }).then(null, fail);
      return;
    }
    if (key === 'deadman' && !on) {
      buddyState().then(function (s) {
        if (!s) return NC.profile.consents.set({ deadman: false }).then(function () { toast(t('st.c.saved'), { type: 'success', timeout: 1800 }); loadConsents(); });
        return NC.ui.confirm({ title: t('st.c.deadman_title'), message: t('st.c.deadman_msg', { name: buddyName(s) }), confirmLabel: t('st.c.deadman_ok'), danger: true }).then(function (ok) {
          if (!ok) { revert(); return; }
          // Stop first (queued when offline), then record the withdrawal.
          return Promise.resolve(NC.data.buddy.stop()).then(function () {
            return NC.profile.consents.set({ deadman: false });
          }).then(function () {
            toast(t(online() ? 'st.c.deadman_stopped' : 'st.c.deadman_stopped_offline'), { type: 'success', timeout: 4500 });
            loadConsents(); loadBuddy(); loadSync();
          });
        });
      }).then(null, fail);
      return;
    }
    var patch = {}; patch[key] = on;
    NC.profile.consents.set(patch).then(function () { toast(t('st.c.saved'), { type: 'success', timeout: 1800 }); loadConsents(); }, fail);
  }

  /* ---------- delete all personal data ---------- */
  function reloadToOnboarding() {
    // Reload without URL flags (?demo=1 would re-seed) straight into onboarding.
    var target = window.location.pathname + '#/onboarding';
    var hasQuery = !!window.location.search;
    window.location.replace(target);          // new query → full navigation
    if (!hasQuery) window.location.reload();  // same document (hash only) → force a clean boot
  }
  /** Tell the user honestly what still happens server-side; offer to text the Buddy recipient (info kept in memory only). */
  function wipeNotice(s, legacy, prot) {
    var name = s ? buddyName(s, prot) : '';
    var html = legacy ? '' : para(t('st.wipe.pending_srv'));
    if (s) html += para(legacy ? t('st.wipe.legacy_buddy', { name: name, time: alertTime(s) })
      : t(isLate(s) ? 'st.wipe.pending_buddy_overdue' : 'st.wipe.pending_buddy', { name: name, time: alertTime(s) }));
    var msg = t('st.wipe.sms_body');
    if (s) html += '<p class="st-wipe-notice__msg">' + esc(msg) + '</p>';
    var actions = [];
    if (s) {
      actions.push({ label: t('st.wipe.sms_copy'), variant: 'ghost', icon: 'copy', close: false, onClick: function () {
        U.copyText(msg).then(function (ok) { if (ok) toast(t('common.copied'), { type: 'success', timeout: 1800 }); });
        return false;
      } });
      var f = s.recipient_phone && NC.ui.formatPhoneAction ? NC.ui.formatPhoneAction(s.recipient_phone) : null;
      if (f && f.href && !f.isDemo) {
        actions.push({ label: t('st.wipe.sms_open', { name: name }), variant: 'soft', icon: 'message-square', close: false, onClick: function () {
          var a = document.createElement('a');
          a.href = 'sms:' + f.href.replace(/^tel:/, '') + '?&body=' + encodeURIComponent(msg);
          a.hidden = true; document.body.appendChild(a); a.click();
          setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
          return false;
        } });
      }
    }
    actions.push({ label: t('st.wipe.continue'), variant: 'primary', autofocus: true });
    NC.ui.modal({
      title: t('st.wipe.pending_title'), icon: 'cloud-off', iconVariant: 'warning', size: 'sm', className: 'st-wipe-notice',
      body: html, actions: actions, onClose: function () { reloadToOnboarding(); }
    });
  }
  function doWipe() {
    if (!NC.data || !NC.data.wipePersonal) return;
    var info = { session: null, online: online(), prot: st.idProtected };
    var tombstone = hasServerErase();
    buddyState().then(function (s) {
      info.session = s;
      // Old data layer (no erase tombstone): an offline wipe can never stop the server session → warn first.
      if (!s || info.online || tombstone || !NC.ui) return true;
      return NC.ui.confirm({ title: t('st.wipe.pre_title'), message: t('st.wipe.pre_msg', { name: buddyName(s), time: alertTime(s) }), confirmLabel: t('st.wipe.pre_ok'), danger: true });
    }).then(function (ok) {
      if (!ok) return;
      var tt = toast(t('st.privacy.wiping'), { type: 'info', timeout: 0 });
      return Promise.resolve(NC.data.wipePersonal()).then(function (r) {
        if (tt) tt.close();
        var pending = r && typeof r === 'object' && 'pendingServerErase' in r ? !!r.pendingServerErase : null;
        if (pending === null) pending = tombstone ? !info.online : false;
        var legacyOffline = !tombstone && !!info.session && !info.online;
        if ((pending || legacyOffline) && NC.ui) { wipeNotice(info.session, legacyOffline, info.prot); return; }
        toast(t('st.privacy.wiped') + (tombstone ? ' ' + t('st.privacy.wiped_srv') : ''), { type: 'success' });
        setTimeout(reloadToOnboarding, 900);
      }, function () { if (tt) tt.close(); toast(t('common.error'), { type: 'danger' }); });
    });
  }

  function flush() {
    if (!NC.data || st.busy.flush) return;
    st.busy.flush = true; renderSync();
    NC.data.flush().then(function (r) {
      st.busy.flush = false;
      toast(r && r.offline ? t('st.sync.offline') : t('st.sync.flushed', { sent: (r && r.sent) || 0, failed: (r && r.failed) || 0 }), { type: r && r.failed ? 'warning' : 'success' });
      loadSync();
    }, function () { st.busy.flush = false; loadSync(); toast(t('common.error'), { type: 'danger' }); });
  }

  function exportCsv() {
    var rows = [['at', 'code', 'lang', 'ms', 'seconds', 'under_15s']];
    (st.timings || []).forEach(function (x) { rows.push([x.at || '', x.code || '', x.lang || '', x.ms, ((x.ms || 0) / 1000).toFixed(2), x.ms < 15000 ? 'yes' : 'no']); });
    var csv = rows.map(function (r) { return r.map(function (c) { var s = String(c === undefined || c === null ? '' : c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\n');
    U.downloadBlob('nomadcare-mod01-timings-' + new Date().toISOString().slice(0, 10) + '.csv', new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  }
  function clearTimings() {
    NC.ui.confirm({ title: t('st.field.clear'), message: t('st.field.clear_confirm', { n: st.timings.length }), confirmLabel: t('common.delete'), danger: true }).then(function (ok) {
      if (!ok) return;
      NC.store.del('tr.timings').then(function () { toast(t('st.field.cleared'), { type: 'success' }); loadTimings(); });
    });
  }

  /* ---------- content error report ---------- */
  function openReport() {
    if (!NC.ui) return;
    var form = U.h('form', { class: 'st-report', novalidate: true });
    form.innerHTML =
      '<p class="st-muted">' + esc(t('st.report.sub')) + '</p>' +
      '<div class="field"><label class="field__label" for="st-r-area">' + esc(t('st.report.area')) + '</label>' +
        '<select class="select" id="st-r-area">' + ['phrases', 'firstaid', 'other'].map(function (a) { return '<option value="' + a + '">' + esc(t('st.report.area.' + a)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="field__label" for="st-r-ref">' + esc(t('st.report.ref')) + '</label>' +
        '<input class="input" id="st-r-ref" type="text" maxlength="60" autocomplete="off" placeholder="' + esc(t('st.report.ref_ph')) + '"></div>' +
      '<div class="field" id="st-r-note-f"><label class="field__label" for="st-r-note">' + esc(t('st.report.note')) + '<span class="req" aria-hidden="true">*</span></label>' +
        '<textarea class="textarea" id="st-r-note" maxlength="600" placeholder="' + esc(t('st.report.note_ph')) + '" aria-required="true"></textarea></div>';
    function submit() {
      var area = form.querySelector('#st-r-area').value;
      var ref = form.querySelector('#st-r-ref').value.trim();
      var note = form.querySelector('#st-r-note').value.trim();
      if (!note) {
        var f = form.querySelector('#st-r-note-f');
        f.classList.add('is-invalid');
        if (!f.querySelector('.field__error')) f.appendChild(U.h('span', { class: 'field__error' }, t('st.report.need_note')));
        form.querySelector('#st-r-note').focus();
        return false;
      }
      if (!NC.data || !NC.data.submitReport) return false;
      // payload {area, module, ref} is merged flat into the submission; name/note also carry the tag for older servers.
      return NC.data.submitReport({
        kind: 'correction', facility_id: null, name: 'content:' + area + (ref ? ':' + ref : ''),
        note: '[content:' + area + (ref ? ' ' + ref : '') + '] ' + note, area: 'content', payload: { area: 'content', module: area, ref: ref || null }
      }).then(function () {
        toast(online() ? t('st.report.sent') : t('st.report.queued'), { type: 'success' });
        loadSync();
      });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'st-r-note' || !e.target.value.trim()) return;
      var f = form.querySelector('#st-r-note-f'), er = f.querySelector('.field__error');
      f.classList.remove('is-invalid'); if (er) er.parentNode.removeChild(er);
    });
    NC.ui.sheet({
      title: t('st.report.title'), icon: 'message-square', body: form, size: 'md',
      actions: [{ label: t('common.cancel'), variant: 'ghost' }, { label: t('st.report.send'), variant: 'primary', icon: 'send', onClick: submit }]
    });
  }

  /* ---------- "Xem dữ liệu của tôi" ---------- */
  function dots(s) { return '•'.repeat(Math.min(10, Math.max(4, String(s).length))); }
  /** Copy of the profile for the JSON export: the reveal code is never exported in clear (only whether one is set). */
  function exportProfile(p) {
    if (!p) return p;
    var c = JSON.parse(JSON.stringify(p));
    if (c.identity) { var set = !!c.identity.reveal_code; delete c.identity.reveal_code; c.identity.reveal_code_set = set; }
    return c;
  }
  /**
   * NOTES §6: with a reveal code set, identity-bearing values (identity layer, Buddy recipient) and the JSON export go
   * through MOD.03's hold + 4-digit code gate (shared persisted lockout). Fails closed when the gate is unavailable.
   * @returns {Promise<boolean>}
   */
  function passGate(reason) {
    if (NC.qr && typeof NC.qr.gateIdentity === 'function') {
      return call(function () { return NC.qr.gateIdentity({ reason: reason }); }, false).then(function (ok) { return ok === true; });
    }
    toast(t('st.data.gate_na'), { type: 'warning' });
    return Promise.resolve(false);
  }
  function openMyData() {
    if (!NC.ui) return;
    var wrap = U.h('div', { class: 'st-mydata' });
    wrap.innerHTML = '<div class="st-mydata__loading"><span class="spinner"></span></div>';
    var snapshot = null;
    var vals = [];            // masked values live in memory only — never in the DOM until revealed
    var locked = false;       // a reveal code is set → protected sections + export need the gate
    var unlocked = false;     // gate passed for this dialog (cleared when the app goes to the background)
    var gating = false, closed = false, seq = 0;
    var unsub = null;
    function onVis() { if (document.hidden) { unlocked = false; hideAll(); } }
    var ctrl = NC.ui.modal({
      title: t('st.data.title'), subtitle: t('st.data.sub'), icon: 'database', size: 'lg', body: wrap,
      actions: [
        { label: t('st.data.export'), variant: 'ghost', icon: 'download', onClick: function () { doExport(); return false; } },
        { label: t('common.close'), variant: 'primary' }
      ],
      onClose: function () {
        closed = true; vals = []; snapshot = null;
        if (unsub) unsub();
        document.removeEventListener('visibilitychange', onVis);
      }
    });
    document.addEventListener('visibilitychange', onVis);
    if (NC.bus) unsub = NC.bus.on('profile:update', function () { if (!closed) load(); });

    function mask(v) {
      var s = String(v === null || v === undefined ? '' : v);
      if (!s) return '<span class="st-muted">' + esc(t('st.data.none')) + '</span>';
      vals.push(s);
      return '<span class="st-mask" data-mask="' + (vals.length - 1) + '">' + dots(s) + '</span>';
    }
    function guarded(sec) { return locked && !unlocked && sec.hasAttribute('data-st-protected'); }
    function btnHtml(on, lockIcon) {
      return icon(on ? 'eye-off' : lockIcon ? 'lock' : 'eye') + '<span>' + esc(t(on ? 'st.data.hide' : 'st.data.reveal')) + '</span>';
    }
    function setRevealed(sec, on) {
      var btn = sec.querySelector('[data-st-reveal]');
      if (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.innerHTML = btnHtml(on, guarded(sec));
        if (guarded(sec)) btn.setAttribute('title', t('st.data.protected')); else btn.removeAttribute('title');
      }
      $$('.st-mask', sec).forEach(function (m) {
        var v = vals[+m.getAttribute('data-mask')] || '';
        m.textContent = on ? v : dots(v);
        m.classList.toggle('is-revealed', on);
      });
    }
    function hideAll() { $$('.st-mydata__sec', wrap).forEach(function (sec) { if (sec.querySelector('[data-st-reveal]')) setRevealed(sec, false); }); }
    function syncButtons() {
      $$('.st-mydata__sec[data-st-protected]', wrap).forEach(function (sec) {
        var b = sec.querySelector('[data-st-reveal]');
        if (b) setRevealed(sec, b.getAttribute('aria-pressed') === 'true');
      });
    }
    /** Run fn now, or after the MOD.03 gate when a reveal code protects the data. */
    function withGate(reason, fn) {
      if (!locked || unlocked) { fn(); return; }
      if (gating) return;
      gating = true;
      passGate(reason).then(function (ok) {
        gating = false;
        if (!ok || closed) return;
        unlocked = true;
        syncButtons();
        fn();
      });
    }
    function doExport() {
      if (!snapshot) return;
      withGate('export', function () {
        if (!snapshot) return;
        U.downloadBlob('nomadcare-my-data-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
      });
    }

    function load() {
      var my = ++seq;
      return Promise.all([
        NC.profile ? call(function () { return NC.profile.get(); }, null) : null,
        NC.profile && NC.profile.consents ? call(function () { return NC.profile.consents.get(); }, null) : null,
        NC.data && NC.data.buddy ? call(function () { return NC.data.buddy.current(); }, null) : null,
        NC.data && NC.data.buddy ? call(function () { return NC.data.buddy.events(); }, []) : [],
        NC.data ? call(function () { return NC.data.outbox(); }, []) : [],
        NC.data ? call(function () { return NC.data.listDownloadedPacks(); }, []) : []
      ]).then(function (r) {
        if (closed || my !== seq) return;
        render(r);
      });
    }
    function render(r) {
      var p = r[0], c = r[1] || {}, s = r[2], evs = r[3] || [], ops = r[4] || [], packs = r[5] || [];
      var set = NC.settings ? NC.settings.all() : {};
      var wasLocked = locked;
      locked = hasRevealCode(p);
      if (!locked || !wasLocked) unlocked = false;
      vals = [];
      snapshot = {
        exported_at: new Date().toISOString(), app: 'NomadCare', profile: exportProfile(p), consents: c, buddy_session: s, buddy_events: evs.length,
        outbox: ops.map(function (o) { return { op: o.op, created_at: o.created_at, attempts: o.attempts }; }), packs: packs, settings: set
      };
      var pub = (p && p.public) || {}, id = (p && p.identity) || {};
      var bt = pub.blood_type === 'unknown' ? t('ob.p.blood_unknown') : pub.blood_type;
      var opCount = {};
      ops.forEach(function (o) { opCount[o.op] = (opCount[o.op] || 0) + 1; });
      var pos = set.last_position;
      function section(title, ic, inner, revealable, prot) {
        var lockIcon = revealable && prot && locked;
        return '<section class="st-mydata__sec"' + (prot ? ' data-st-protected' : '') + '><header><span class="st-mydata__h">' + icon(ic, 'icon--sm') + esc(title) + '</span>' +
          (revealable ? '<button type="button" class="btn btn--ghost btn--sm" data-st-reveal aria-pressed="false"' + (lockIcon ? ' title="' + esc(t('st.data.protected')) + '"' : '') + '>' +
            btnHtml(false, lockIcon) + '</button>' : '') +
          '</header>' + inner + '</section>';
      }
      var codeRow = id.reveal_code ? '<span class="badge badge--accent">' + icon('key') + esc(t('st.data.code_set')) + '</span>' : '<span class="st-muted">' + esc(t('st.data.none')) + '</span>';
      wrap.innerHTML = '<div class="st-mydata__grid">' +
        section(t('st.data.profile'), 'heart-pulse', p ? '<dl class="kv">' +
          kv(t('ob.p.blood'), mask(bt)) + kv(t('ob.p.allergies'), mask(pub.allergies)) + kv(t('ob.p.conditions'), mask(pub.conditions)) + kv(t('ob.p.medications'), mask(pub.medications)) +
          '</dl>' : '<p class="st-muted">' + esc(t('st.data.none')) + '</p>', !!p) +
        section(t('st.data.identity'), 'id-card', p ? '<dl class="kv">' +
          kv(t('ob.p.full_name'), mask(id.full_name)) + kv(t('ob.p.nationality'), mask(id.nationality)) + kv(t('ob.p.contact_name'), mask(id.contact_name)) +
          kv(t('ob.p.contact_phone'), mask(id.contact_phone)) + kv(t('ob.p.reveal_code'), codeRow) + '</dl>' : '<p class="st-muted">' + esc(t('st.data.none')) + '</p>', !!p, true) +
        section(t('st.data.consents'), 'check-circle', '<dl class="kv">' + CONSENT_KEYS.map(function (k) {
          return kv(t('st.c.' + k), c[k] ? '<span class="text-success">' + esc(t('common.yes')) + '</span>' : '<span class="st-muted">' + esc(t('common.no')) + '</span>');
        }).join('') + (c.at ? kv('', '<small class="st-muted">' + esc(t('st.privacy.updated', { time: U.fmtDateTime(c.at) })) + '</small>') : '') + '</dl>') +
        section(t('st.data.buddy'), 'shield-check', s ? '<dl class="kv">' +
          kv(t('home.buddy.title'), esc(t('home.buddy.status.' + (s.status === 'alerted' && NC.ui && NC.ui.alertChannel && NC.ui.alertChannel(s) !== 'email' ? 'alerted_sim' : s.status)))) +
          kv(t('st.data.buddy'), mask(s.recipient_name)) + kv('Email', mask(s.recipient_email)) +
          kv(t('home.stat.checkin'), esc(U.fmtDateTime(s.next_due_at))) + kv('', esc(t('st.data.events', { n: evs.length }))) + '</dl>'
          : '<p class="st-muted">' + esc(t('st.data.buddy_none')) + (evs.length ? ' · ' + esc(t('st.data.events', { n: evs.length })) : '') + '</p>', !!s, true) +
        section(t('st.data.outbox'), 'cloud-upload', ops.length ? '<ul class="st-mydata__list">' + Object.keys(opCount).map(function (k) {
          var lk = 'st.op.' + k;
          return '<li><span>' + esc(NC.i18n.has(lk) ? t(lk) : k) + '</span><b>' + opCount[k] + '</b></li>';
        }).join('') + '</ul>' : '<p class="st-muted">' + esc(t('st.data.outbox_none')) + '</p>') +
        section(t('st.data.packs'), 'package', packs.length ? '<ul class="st-mydata__list">' + packs.map(function (x) {
          return '<li><span>' + esc(routeName(x.route_id) + ' · ' + carrierName(x.carrier)) + '</span><b>v' + esc(x.version) + ' · ' + esc(U.fmtBytes(x.size_bytes)) + '</b></li>';
        }).join('') + '</ul>' : '<p class="st-muted">' + esc(t('st.packs.none')) + '</p>') +
        section(t('st.data.position'), 'map-pin', pos ? '<dl class="kv">' + kv('lat, lng', mask(pos.lat.toFixed(5) + ', ' + pos.lng.toFixed(5))) + kv('', esc(U.fmtDateTime(pos.at))) + '</dl>' : '<p class="st-muted">' + esc(t('st.data.none')) + '</p>', !!pos) +
        section(t('st.data.settings'), 'sliders', '<dl class="kv">' +
          kv(t('st.trip.route'), esc(routeName(set.route_id))) + kv(t('st.trip.carrier'), esc(carrierName(set.carrier))) +
          kv(t('st.look.lang'), esc(String(set.lang || '').toUpperCase())) + kv(t('st.look.theme'), esc(t('app.theme.' + (set.theme || 'auto')))) +
          kv(t('st.look.ulang'), esc(String(set.user_lang || '').toUpperCase())) + '</dl>') +
        '</div>' +
        '<p class="st-mydata__foot">' + icon('server', 'icon--sm') + '<span>' + esc(t('st.data.server')) + '</span></p>';
    }
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-st-reveal]') : null;
      if (!btn || !wrap.contains(btn)) return;
      var sec = btn.closest('.st-mydata__sec');
      if (btn.getAttribute('aria-pressed') === 'true') { setRevealed(sec, false); return; }
      if (guarded(sec)) withGate('show', function () { if (wrap.contains(sec)) setRevealed(sec, true); });
      else setRevealed(sec, true);
    });
    load();
    return ctrl;
  }

  /* ================================================================== */
  /* Wiring                                                               */
  /* ================================================================== */
  /** Folded section card (accordion): open/close its body. */
  function setFold(id, open) {
    var btn = root ? root.querySelector('[data-st-fold="' + id + '"]') : null;
    var bd = body(id), card = sectionEl(id);
    if (!btn || !bd) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    bd.hidden = !open;
    if (card) card.classList.toggle('is-open', !!open);
  }
  function onClick(e) {
    var fb = e.target.closest ? e.target.closest('[data-st-fold]') : null;
    if (fb && root.contains(fb)) {
      var fid = fb.getAttribute('data-st-fold');
      if (SECTION_IDS.indexOf(fid) >= 0) setFold(fid, fb.getAttribute('aria-expanded') !== 'true');
      return;
    }
    var j = e.target.closest ? e.target.closest('[data-st-jump]') : null;
    if (j && root.contains(j)) { e.preventDefault(); scrollTo(j.getAttribute('data-st-jump'), true); return; }
    var sg = e.target.closest ? e.target.closest('[data-st-seg] .segmented__btn') : null;
    if (sg && root.contains(sg)) {
      var name = sg.closest('[data-st-seg]').getAttribute('data-st-seg'), v = sg.getAttribute('data-value');
      $$('.segmented__btn', sg.parentNode).forEach(function (x) {
        var on = x === sg; x.classList.toggle('is-selected', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); x.setAttribute('tabindex', on ? '0' : '-1');
      });
      if (name === 'lang') { if (NC.i18n) NC.i18n.setLang(v); }
      else if (name === 'carrier') { if (S('carrier') !== v) { setS('carrier', v); toast(t('st.trip.changed_carrier', { name: carrierName(v) }), { type: 'success', timeout: 1800 }); } }
      else setS(name, v);
      return;
    }
    var b = e.target.closest ? e.target.closest('[data-st]') : null;
    if (!b || !root.contains(b) || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    var a = b.getAttribute('data-st');
    if (a === 'route') {
      var rid = b.getAttribute('data-value');
      if (S('route_id') !== rid) { setS('route_id', rid); toast(t('st.trip.changed_route', { name: routeName(rid) }), { type: 'success', timeout: 1800 }); }
    }
    else if (a === 'download') download(b.getAttribute('data-route'), b.getAttribute('data-carrier'));
    else if (a === 'remove') removePack(b.getAttribute('data-route'), b.getAttribute('data-carrier'));
    else if (a === 'persist') persist();
    else if (a === 'view') openMyData();
    else if (a === 'flush') flush();
    else if (a === 'report') openReport();
    else if (a === 'csv') exportCsv();
    else if (a === 'clear-timings') clearTimings();
    else if (a === 'onboarding') { if (NC.app) NC.app.go('onboarding', { replay: '1' }); }
  }
  function onChange(e) {
    var el = e.target, a = el.getAttribute && el.getAttribute('data-st');
    if (!a) return;
    if (a === 'ulang') setS('user_lang', el.value);
    else if (a === 'consent') setConsent(el.getAttribute('data-key'), !!el.checked, el);
    else if (a === 'sim') { if (NC.net) NC.net.setSimulated(!!el.checked); }
    else if (a === 'geo-online' && NC.geoOnline) {
      (el.checked ? NC.geoOnline.accept() : NC.geoOnline.revoke());
      toast(t(el.checked ? 'st.c.geo_online_on' : 'st.c.geo_online_off'), { type: 'success' });
    }
    else if (a === 'timer') setS('demo_timer', !!el.checked);
  }
  function onKey(e) {
    var sg = e.target.closest ? e.target.closest('[data-st-seg]') : null;
    if (!sg || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
    var btns = $$('.segmented__btn', sg);
    var i = btns.indexOf(sg.querySelector('.is-selected'));
    var n = btns[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length];
    if (n) { e.preventDefault(); n.click(); n.focus(); }
  }

  /** Scroll a section card into view (below the sticky topbar) and flash it. */
  function scrollTo(section, smooth) {
    var card = sectionEl(section);
    if (!card) return;
    if (card.classList.contains('st-card--fold')) setFold(section, true);
    // Clear the sticky topbar and (phones/tablets) the sticky section chips above the card.
    var off = 12, tb = document.getElementById('topbar'), jb = root.querySelector('#st-jump');
    if (tb && tb.offsetParent !== null) off += tb.getBoundingClientRect().height;
    if (jb && window.getComputedStyle && window.getComputedStyle(jb).flexDirection !== 'column') off += jb.getBoundingClientRect().height;
    var top = card.getBoundingClientRect().top + (window.pageYOffset || 0) - off;
    try { window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { window.scrollTo(0, top); }
    card.classList.remove('is-flash'); void card.offsetWidth; card.classList.add('is-flash');
    $$('[data-st-jump]', root).forEach(function (j) { j.classList.toggle('is-current', j.getAttribute('data-st-jump') === section); });
  }

  var refreshPacksSoon = U.debounce(function () { if (visible) loadPacks(); }, 120);
  var refreshSyncSoon = U.debounce(function () { if (visible) loadSync(); }, 200);

  function mount(section) {
    root = section.querySelector('#st-root');
    if (!root) { root = U.h('div', { class: 'st', id: 'st-root' }); section.appendChild(root); }   // markup lives in index.html
    if (NC.i18n) NC.i18n.apply(root);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKey);
    // Section chips scroll sideways on phones: drop the end fade once the last chip is fully visible (or nothing scrolls).
    var jump = root.querySelector('#st-jump');
    if (jump) {
      var fadeEnd = function () { jump.classList.toggle('is-end', jump.scrollLeft + jump.clientWidth >= jump.scrollWidth - 2); };
      jump.addEventListener('scroll', fadeEnd, { passive: true });
      window.addEventListener('resize', U.debounce(fadeEnd, 120));
      if (NC.bus) NC.bus.on('i18n:change', function () { setTimeout(fadeEnd, 0); });
      st.fadeEnd = fadeEnd;
    }
    if (NC.bus) {
      NC.bus.on('settings:change', function (p) {
        if (!visible || !p) return;
        if (p.key === 'route_id' || p.key === 'carrier') { renderTrip(); refreshPacksSoon(); }
        else if (p.key === 'travel_mode') renderTrip();
        else if (p.key === 'theme' || p.key === 'user_lang') renderLook();
        else if (p.key === 'demo_timer') renderField();
        else if (p.key === 'simulated_offline') { renderSync(); renderPacks(); }
        else if (p.key === 'online_geo_ok') renderPrivacy();
      });
      NC.bus.on('data:pack', refreshPacksSoon);
      NC.bus.on('tr:timing', function () { if (visible) loadTimings(); });
      NC.bus.on('consents:change', function (c) { if (visible) { st.consents = c; renderPrivacy(); } });
      NC.bus.on('profile:update', function () { if (visible) loadIdFlag(); });
      NC.bus.on('buddy:update', function (p) {
        if (!visible || !p || !('session' in p)) return;
        setSession(p.session && p.session.status !== 'closed' ? p.session : null);
      });
      ['data:outbox', 'data:sync', 'data:mode'].forEach(function (ev) { NC.bus.on(ev, refreshSyncSoon); });
      NC.bus.on('net:change', function () { if (visible) { renderSync(); renderPacks(); renderPrivacy(); } });
      NC.bus.on('i18n:change', function () { if (visible) { NC.i18n.apply(root); renderAll(); } });
    }
  }
  function show(params) {
    visible = true;
    st.idProtected = peekProtected();
    renderAll();
    if (st.fadeEnd) setTimeout(st.fadeEnd, 0);
    loadAll().then(function () {
      if (params && params.section) scrollTo(params.section, false);
    });
  }
  function hide() { visible = false; }

  if (NC.app && NC.app.register) {
    NC.app.register('settings', { titleKey: 'app.title.settings', mount: mount, show: show, hide: hide });
  }

  NC.settingsScreen = { refresh: function () { return loadAll(); }, scrollTo: function (s) { scrollTo(s, true); }, withdrawMedical: withdrawMedical };
})(window.NC = window.NC || {});
