/*
 * mod04-buddy.js — MOD.04 Buddy Check-in: (a) warning before a dead zone — the reminders of a started trip come from
 * NC.trip (services/tripwatch.js, round 2 R6: ETA with the routing speed, ONE fix on reopen / check-in, no continuous
 * GPS); this screen shows the trip and the next dead zone of the path, (b) dead-man switch (scheduled check-ins,
 * overdue → the server emails the last location to the recipient by itself, signal or not — only when a recipient
 * e-mail was given; the recipient phone is required for the SMS the traveller sends from this device; the phone's own
 * events made offline are queued and sent at the first signal; the heartbeat of NC.trip lets the server notice an
 * abnormal loss of contact: alert_reason 'contact_lost'), (c) journey simulator for the live demo (folded into the
 * "Chế độ demo" section): its simulated position drives the same NC.trip reminder popup.
 * Local mode (no Supabase key) only SIMULATES e-mails: every text that mentions an e-mail says so (round 2, R7).
 * Owner: P2 mod04-buddy (round 2: W5 R7, W6 R6). Registers screen 'buddy', i18n namespace bd.*.
 * Public API: NC.buddy.{sos(opts) → Promise<event>, open(), checkin(opts) → Promise<event>, state(), openDemo(),
 *             focusSetup(), demoAlert() → Promise, phaseOf(session, nowMs) → 'none'|'active'|'soon'|'grace'|'overdue'|
 *             'alerted' (pure), statusOf(session, nowMs) → {phase, key, text, tone, sos, lost, simulated, noEmail, value,
 *             count, countSub, title} (what this screen shows — Home reuses it), sim.{play, pause, reset, skip, seek(km),
 *             setMode, setSpeed, setPath, state(), log()}}
 *             NC.buddyPhone.norm(raw) → {e164|null, valid, isDemo, empty, landline, display} (contract C3; also
 *             NC.ui.normPhone; a Vietnamese 02x landline: e164 set, landline true, valid false — SMS needs a mobile)
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var h = U.h;
  var esc = U.esc;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }
  function lang() { return NC.i18n ? NC.i18n.lang() : 'vi'; }
  function online() { return NC.net ? NC.net.online() : navigator.onLine !== false; }
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function isDemo() { return U.qs().demo === '1'; }

  /* ================================================================== */
  /* i18n — bd.*                                                          */
  /* ================================================================== */
  if (NC.i18n) NC.i18n.add({
    vi: {
      'bd.title': 'Buddy Check-in',
      'bd.actions.aria': 'Thao tác nhanh của phiên Buddy',
      'bd.act.location': 'Ghi vị trí', 'bd.act.location_hint': 'Lưu lên máy chủ, không báo ai',
      'bd.act.sms': 'SMS dự phòng', 'bd.act.sms_hint': 'Khi sóng yếu',
      'bd.act.sos': 'SOS', 'bd.act.sos_hint': 'Khẩn + vị trí',
      'bd.setup.title': 'Thiết lập Buddy Check-in',
      'bd.setup.sub': 'Một người nhận, một lịch check-in — miễn phí vĩnh viễn.',
      'bd.f.traveler': 'Tên hiển thị của bạn', 'bd.f.traveler_ph': 'VD: Minh Anh',
      'bd.f.traveler_hint': 'Người nhận thấy tên này trong cảnh báo.',
      'bd.f.recipient': 'Người nhận cảnh báo', 'bd.f.rname': 'Họ tên', 'bd.f.remail': 'Email', 'bd.f.remail_ph': 'ten@example.com',
      'bd.f.rphone': 'Số di động', 'bd.f.rphone_ph': '0912 345 678', 'bd.f.optional': '(không bắt buộc)',
      'bd.f.rphone_hint': 'Để bạn gửi SMS cho người nhận từ máy này: số di động 03x, 05x, 07x, 08x, 09x hoặc +mã quốc gia. Không nhận số máy bàn 02x.',
      'bd.f.remail_hint': 'Nên có: máy chủ tự gửi email cảnh báo khi bạn quá hạn hoặc bấm SOS.',
      'bd.f.err_rname': 'Nhập tên người nhận.', 'bd.f.err_email': 'Email chưa đúng định dạng — sửa lại hoặc để trống.',
      'bd.f.err_phone_req': 'Nhập số di động người nhận — cần để gửi SMS từ máy này.',
      'bd.f.err_phone': 'Số di động chưa đúng — VD: 0912 345 678 hoặc +84 912 345 678 (nước ngoài: +mã quốc gia).',
      'bd.f.err_phone_mobile': 'Hãy nhập số di động (03x, 05x, 07x, 08x, 09x) — số máy bàn 02x không nhận được SMS.',
      'bd.f.err_consent': 'Cần đồng ý để bật dead-man switch.',
      'bd.f.interval': 'Check-in định kỳ mỗi', 'bd.f.grace': 'Chờ thêm trước khi báo quá hạn',
      'bd.f.route': 'Tuyến đường', 'bd.f.mode': 'Phương thức di chuyển',
      'bd.f.share': 'Gửi kèm lớp y tế công khai trong cảnh báo',
      'bd.f.share_text': 'Chỉ nhóm máu, dị ứng, bệnh nền và thuốc — đi kèm email cảnh báo, không có họ tên hay giấy tờ. Tắt mặc định.',
      'bd.f.share_na_email': 'Cần email người nhận — lớp y tế chỉ đi kèm email cảnh báo.',
      'bd.f.share_na_consent': 'Cần đồng ý xử lý dữ liệu y tế nhạy cảm (Nghị định 356/2025/NĐ-CP) trong Hồ sơ QR trước khi bật.',
      'bd.f.share_na_profile': 'Chưa có hồ sơ y tế — hãy tạo ở Hồ sơ QR.',
      'bd.f.consent': 'Tôi đồng ý bật dead-man switch: máy chủ NomadCare lưu lịch check-in, vị trí (cả tín hiệu định kỳ 5 phút/lần khi ứng dụng đang mở) và người nhận của phiên này; nếu có email người nhận, máy chủ gửi email kèm vị trí cuối khi tôi quá hạn, bấm SOS hoặc mất liên lạc bất thường.',
      'bd.f.submit': 'Bật Buddy Check-in',
      'bd.f.started': 'Đã bật Buddy. Check-in tiếp theo trước {time}.',
      'bd.f.started_trip': 'Kèm nhắc trước vùng mất sóng trên lộ trình {from} → {to} (từ Bản đồ).',
      'bd.f.started_offline': 'Đã bật Buddy trên máy — phiên sẽ gửi lên máy chủ khi có sóng. Check-in trước {time}.',
      'bd.mode.motorbike': 'Xe máy', 'bd.mode.hiking': 'Đi bộ',
      'bd.int.hours': '{n} giờ', 'bd.int.demo': '2 phút (demo)', 'bd.int.min': '{n} phút',
      'bd.grace.min': '{n} phút', 'bd.grace.demo': '1 phút (demo)',
      'bd.hero.intro_text': 'Hẹn giờ check-in. Lỡ hẹn: email vị trí cuối cho người thân (nếu có), hoặc bạn gửi SMS.',
      'bd.hero.intro_text_local': 'Hẹn giờ check-in. Lỡ hẹn: email cảnh báo (bản cục bộ chỉ mô phỏng) hoặc SMS bạn tự gửi.',
      'bd.status.off': 'Chưa bật',
      'bd.status.active': 'Đang theo dõi', 'bd.status.soon': 'Sắp đến hạn', 'bd.status.grace': 'Đang chờ thêm',
      'bd.status.overdue': 'QUÁ HẠN', 'bd.status.alerted': 'Đã gửi cảnh báo', 'bd.status.alerted_sim': 'Cảnh báo mô phỏng',
      'bd.ring.until': 'đến hạn', 'bd.ring.grace': 'còn chờ', 'bd.ring.overdue': 'quá hạn', 'bd.ring.alerted': 'đã gửi', 'bd.ring.alerted_sim': 'mô phỏng',
      'bd.ring.lost': 'mất liên lạc',
      'bd.sim_email.local': 'Email mô phỏng — bản cục bộ không gửi email thật.',
      'bd.sim_email.demo': 'Email mô phỏng — địa chỉ minh hoạ không được gửi thật.',
      'bd.hero.next': 'Check-in trước {time}',
      'bd.hero.due_passed': 'Đã đến hạn lúc {time}',
      'bd.hero.grace_line': 'Chờ thêm {grace} → tự gửi cảnh báo lúc {time}',
      'bd.hero.grace_line_noalert': 'Chờ thêm {grace} → quá hạn lúc {time} (không có cảnh báo tự động)',
      'bd.hero.grace_line_sim': 'Chờ thêm {grace} → email cảnh báo lúc {time} (mô phỏng)',
      'bd.hero.grace_line_sms': 'Chờ thêm {grace} → quá hạn lúc {time}',
      'bd.hero.overdue_title': 'Quá hạn check-in',
      'bd.hero.overdue_q': 'Cảnh báo cho {name} đang xếp hàng — tự gửi ngay khi có sóng.',
      'bd.hero.overdue_q_sim': 'Quá hạn — bản tin đang xếp hàng, sẽ lên máy chủ khi có sóng. {sim}',
      'bd.hero.overdue_srv': 'Máy chủ tự email cảnh báo cho {name} khi quá hạn ({time}) — không cần máy bạn có sóng. Bản tin trên máy sẽ tự gửi khi có sóng.',
      'bd.hero.overdue_s': 'Cảnh báo đã tới máy chủ — máy chủ đang gửi email cho {name}.',
      'bd.hero.overdue_sim': 'Quá hạn đã được ghi nhận. {sim}',
      'bd.hero.alerted_title': 'Đã gửi email cảnh báo', 'bd.hero.alerted_title_sim': 'Email cảnh báo (mô phỏng)',
      'bd.hero.sos_title': 'SOS đã kích hoạt', 'bd.status.sos': 'SOS', 'bd.status.sos_alerted': 'SOS đã gửi', 'bd.status.sos_alerted_sim': 'SOS mô phỏng',
      'bd.status.lost': 'MẤT LIÊN LẠC', 'bd.status.lost_alerted': 'Đã báo mất liên lạc', 'bd.status.lost_alerted_sim': 'Mất liên lạc (mô phỏng)',
      'bd.hero.lost_title': 'Máy chủ mất liên lạc với bạn',
      'bd.hero.lost_s': 'Ứng dụng mất kết nối bất thường (ngoài vùng mất sóng dự kiến) — máy chủ đang gửi email cho {name}.',
      'bd.hero.lost_sim': 'Máy chủ ghi nhận mất kết nối bất thường (ngoài vùng mất sóng dự kiến). {sim}',
      'bd.hero.lost_noemail': 'Máy chủ ghi nhận mất kết nối bất thường — không có email nên không báo được {name}. Hãy bấm Gửi SMS.',
      'bd.hero.lost_alerted_title': 'Đã email: mất liên lạc', 'bd.hero.lost_alerted_title_sim': 'Email mất liên lạc (mô phỏng)',
      'bd.hero.lost_alerted_line': 'Máy chủ gửi email “mất liên lạc bất thường” cho {name} lúc {time}. Bấm bên dưới để báo bạn an toàn.',
      'bd.lost.toast': 'Máy chủ không nhận được tín hiệu của ứng dụng hơn 15 phút (ngoài vùng mất sóng dự kiến). Bấm “Tôi ổn” để báo bạn an toàn.',
      'bd.lost.toast_sim': 'Máy chủ không nhận được tín hiệu của ứng dụng hơn 15 phút. {sim} Bấm “Tôi ổn” để báo bạn an toàn.',
      'bd.lost.toast_noemail': 'Máy chủ không nhận được tín hiệu của ứng dụng hơn 15 phút — không có email nên không báo được {name}. Hãy bấm Gửi SMS.',
      'bd.hero.sos_q': 'SOS cho {name} đang xếp hàng — tự gửi ngay khi có sóng.',
      'bd.hero.sos_q_sim': 'SOS đang xếp hàng — sẽ lên máy chủ khi có sóng. {sim}',
      'bd.hero.sos_s': 'SOS đã tới máy chủ — máy chủ đang gửi email khẩn cho {name}.',
      'bd.hero.sos_sim': 'SOS kèm vị trí đã được ghi nhận. {sim}',
      'bd.hero.alerted_line': 'Máy chủ gửi email cho {name} lúc {time}. Bấm bên dưới để báo bạn an toàn.',
      'bd.hero.alerted_line_sim': 'Lúc {time}. {sim} Bấm bên dưới để báo bạn an toàn.',
      'bd.hero.sos_alerted_title': 'Đã gửi email SOS', 'bd.hero.sos_alerted_title_sim': 'Email SOS (mô phỏng)',
      'bd.hero.sos_alerted_line': 'Máy chủ gửi email SOS cho {name} lúc {time}. Bấm bên dưới để báo bạn an toàn.',
      'bd.hero.noemail': 'Không có email người nhận nên máy chủ không tự báo cho {name} — hãy bấm Gửi SMS.',
      'bd.hero.sms_now': 'Gửi SMS ngay',
      'bd.hero.sms_only': 'Không có email → máy chủ không tự gửi cảnh báo; khi quá hạn hoặc SOS, bạn cần bấm Gửi SMS.',
      'bd.hero.sms_only_tip': 'Nên thêm email người nhận để có cảnh báo tự động.',
      'bd.hero.add_email': 'Thêm email', 'bd.hero.sms': 'Gửi SMS',
      'bd.add_email.msg': 'Phiên hiện tại sẽ kết thúc; biểu mẫu mở lại với thông tin cũ để bạn thêm email.',
      'bd.hero.recipient': 'Người nhận: {name}',
      'bd.hero.recipient_anon': 'Gửi tới người nhận của bạn', 'bd.your_recipient': 'người nhận của bạn',
      'bd.rcp.name_hidden': 'Đã ẩn (hồ sơ có mã hiện danh tính)',
      'bd.hero.every': 'Mỗi {interval} · chờ thêm {grace}',
      'bd.hero.last': 'Check-in gần nhất {rel}',
      'bd.hero.checkin': 'Tôi ổn — Check-in',
      'bd.hero.checkin_safe': 'Tôi an toàn — Check-in',
      'bd.hero.checked': 'Đã check-in. Hạn mới: {time}.',
      'bd.hero.checked_offline': 'Đã check-in trên máy — sẽ gửi khi có sóng. Hạn mới: {time}.',
      'bd.hero.queue': '{n} chờ gửi', 'bd.hero.synced': 'Đã đồng bộ', 'bd.hero.local': 'Chỉ trên máy',
      'bd.loc.sent': 'Đã ghi vị trí lên máy chủ (Buddy).', 'bd.loc.queued': 'Đang offline — vị trí đã vào hàng đợi, sẽ lên máy chủ khi có sóng.',
      'bd.loc.none': 'Chưa có vị trí — dùng Bản đồ hoặc mô phỏng để có vị trí.',
      'bd.sos.confirm_title': 'Gửi SOS cho người nhận?',
      'bd.sos.confirm_msg': 'Máy chủ sẽ gửi email khẩn kèm vị trí của bạn cho người nhận. Nếu nguy hiểm tính mạng, hãy gọi 115 trước.',
      'bd.sos.confirm_btn': 'Gửi SOS',
      'bd.sos.confirm_title_rec': 'Ghi SOS kèm vị trí?', 'bd.sos.confirm_btn_rec': 'Ghi SOS',
      'bd.sos.confirm_msg_noemail': 'Không có email nên máy chủ không tự báo được cho người nhận. Sau khi ghi SOS, hãy bấm Gửi SMS; nếu nguy hiểm tính mạng, gọi 115 trước.',
      'bd.sos.confirm_msg_noalert': 'Máy chủ không thể gửi cảnh báo tự động cho phiên này. Sau khi ghi SOS, hãy gửi SMS; nếu nguy hiểm tính mạng, gọi 115 trước.',
      'bd.sos.confirm_msg_sim': 'SOS được ghi kèm vị trí. {sim} Sau đó hãy gửi SMS; nếu nguy hiểm tính mạng, gọi 115 trước.',
      'bd.sos.confirm_offline': 'Đang mất sóng: SOS chờ trong hàng đợi tới khi có sóng; SMS thường vẫn có thể đi được.',
      'bd.sos.sent': 'Đã gửi SOS kèm vị trí — máy chủ sẽ email cho {name}.',
      'bd.sos.sent_sim': 'Đã ghi SOS kèm vị trí. {sim} Hãy gửi SMS hoặc gọi 115.',
      'bd.sos.sent_noemail': 'Đã ghi SOS — không có email người nhận nên máy chủ không báo được. Hãy bấm Gửi SMS hoặc gọi 115.',
      'bd.sos.sent_noalert': 'Đã ghi SOS — nhưng máy chủ không thể gửi cảnh báo tự động cho phiên này. Hãy gửi SMS hoặc gọi 115.',
      'bd.sos.queued': 'Đang offline — SOS đã vào hàng đợi và sẽ tự gửi ngay khi có sóng.',
      'bd.sos.queued_sim': 'Đang offline — SOS đã vào hàng đợi, sẽ lên máy chủ khi có sóng. {sim} Hãy gửi SMS hoặc gọi 115.',
      'bd.sos.no_session': 'Chưa bật Buddy Check-in — SOS chưa được gửi. Hãy gọi 115.',
      'bd.sms.title': 'SMS dự phòng', 'bd.sms.sub': 'SMS thường vẫn đi được khi không có dữ liệu di động.',
      'bd.sms.time_unknown': 'chưa rõ thời điểm',
      'bd.sms.body': '[NomadCare] {name} báo vị trí: {coords} ({time}) {map} · {route}. Nếu không liên lạc được, gọi 112/115. / Last location of {name}. If unreachable call 112/115.',
      'bd.sms.open': 'Mở ứng dụng SMS', 'bd.sms.demo': 'Số minh hoạ — bản demo không mở ứng dụng SMS.',
      'bd.sms.opened': 'Đã mở ứng dụng SMS — bấm Gửi trong ứng dụng để gửi.',
      'bd.sms.no_phone': 'Chưa có số điện thoại người nhận — sao chép nội dung để gửi thủ công.',
      'bd.sms.to': 'Gửi tới {phone}',
      'bd.stop': 'Kết thúc theo dõi', 'bd.stop_title': 'Kết thúc Buddy Check-in?',
      'bd.stop_msg': 'Dead-man switch sẽ tắt: phiên này không còn hạn check-in hay cảnh báo quá hạn.',
      'bd.stopped': 'Đã tắt Buddy Check-in.',
      'bd.rcp.title': 'Người nhận', 'bd.rcp.name': 'Người nhận', 'bd.rcp.email': 'Email', 'bd.rcp.phone': 'Điện thoại',
      'bd.rcp.channel_email': 'Cảnh báo tự động qua email', 'bd.rcp.channel_sim': 'Email mô phỏng (không gửi thật)',
      'bd.rcp.channel_sms': 'Chỉ SMS từ máy bạn — không có email tự động', 'bd.rcp.more': 'Chi tiết & đồng bộ',
      'bd.rcp.schedule': 'Lịch check-in', 'bd.rcp.route': 'Tuyến', 'bd.rcp.medical': 'Lớp y tế công khai',
      'bd.rcp.medical_on': 'Gửi kèm khi cảnh báo', 'bd.rcp.medical_off': 'Không gửi', 'bd.rcp.server': 'Máy chủ',
      'bd.rcp.server_local': 'Email mô phỏng — bản cục bộ không gửi email thật', 'bd.rcp.server_supabase': 'Supabase — email qua Resend',
      'bd.rcp.reveal': 'Hiện đầy đủ', 'bd.rcp.hide': 'Ẩn bớt',
      'bd.sync.pending': '{n} sự kiện đang chờ gửi', 'bd.sync.pending_one': '{n} sự kiện đang chờ gửi', 'bd.sync.ok': 'Đã tới máy chủ ✓', 'bd.sync.ok_at': 'Đã tới máy chủ ✓ · {time}',
      'bd.sync.count': 'Máy chủ đã nhận {n}/{total} sự kiện', 'bd.sync.offline': 'Đang offline — sự kiện nằm an toàn trong hàng đợi.',
      'bd.sync.local': 'Chưa có trên máy chủ — phiên này chỉ lưu trên máy',
      'bd.sync.now': 'Đồng bộ ngay', 'bd.sync.done': 'Đã đồng bộ {n} sự kiện lên máy chủ.', 'bd.sync.done_one': 'Đã đồng bộ {n} sự kiện lên máy chủ.',
      'bd.err.recipient_email_required': 'Máy chủ (bản cũ) từ chối phiên Buddy này vì thiếu email người nhận — sẽ không có cảnh báo tự động. Hãy thiết lập lại với email.',
      'bd.err.recipient_phone_required': 'Máy chủ từ chối phiên Buddy này vì thiếu số điện thoại người nhận. Hãy thiết lập lại với số điện thoại.',
      'bd.err.recipient_phone_invalid': 'Máy chủ từ chối phiên Buddy này vì số điện thoại người nhận không hợp lệ. Hãy thiết lập lại.',
      'bd.err.recipient_phone_not_mobile': 'Máy chủ từ chối phiên Buddy này vì số người nhận là máy bàn 02x — không nhận được SMS. Hãy thiết lập lại với số di động (03x, 05x, 07x, 08x, 09x).',
      'bd.err.recipient_email_invalid': 'Máy chủ từ chối phiên Buddy này vì email người nhận không hợp lệ. Hãy thiết lập lại (email có thể để trống).',
      'bd.err.rate_limited_start': 'Máy chủ tạm giới hạn: tối đa 5 phiên Buddy có email mỗi 24 giờ trên một thiết bị. Phiên này chỉ chạy trên máy — không có cảnh báo tự động từ máy chủ.',
      'bd.err.generic': 'Máy chủ chưa nhận phiên Buddy này ({code}) — chưa có cảnh báo tự động. Hãy thử thiết lập lại.',
      'bd.err.restart': 'Thiết lập lại', 'bd.err.sms': 'Soạn SMS',
      'bd.tl.title': 'Nhật ký sự kiện', 'bd.tl.since': 'Phiên bắt đầu {time}', 'bd.tl.closed': 'Phiên gần nhất (đã kết thúc)',
      'bd.tl.empty': 'Chưa có sự kiện. Bật Buddy; muốn xem nhanh, mở Chế độ demo và chạy mô phỏng hành trình.',
      'bd.tl.more': 'Xem thêm {n} sự kiện', 'bd.tl.more_one': 'Xem thêm {n} sự kiện',
      'bd.tl.rate_limited': 'giới hạn 3 email/24 giờ', 'bd.tl.no_email': 'không có email người nhận',
      'bd.tl.queued': 'Đang xếp hàng', 'bd.tl.sending': 'Đang gửi…', 'bd.tl.sent': 'Đã tới máy chủ', 'bd.tl.late': 'Gửi trễ {d}',
      'bd.tl.local': 'Chỉ lưu trên máy', 'bd.tl.server': 'Từ máy chủ',
      'bd.tl.src_device': 'thiết bị phát hiện', 'bd.tl.src_server': 'máy chủ phát hiện', 'bd.tl.src_sim': 'mô phỏng',
      'bd.tl.last_known': 'vị trí đã biết gần nhất', 'bd.tl.to': 'tới {to}',
      'bd.kind.start': 'Bắt đầu theo dõi', 'bd.kind.checkin': 'Check-in: Tôi ổn', 'bd.kind.location': 'Gửi vị trí',
      'bd.kind.pre_deadzone': 'Vị trí trước vùng mất sóng', 'bd.kind.sos': 'SOS khẩn cấp', 'bd.kind.overdue': 'Quá hạn check-in',
      'bd.kind.contact_lost': 'Mất liên lạc bất thường', 'bd.kind.alert_sent_lost': 'Đã gửi email “mất liên lạc” cho người nhận',
      'bd.kind.alert_sent_lost_sim': 'Email “mất liên lạc” (mô phỏng)',
      'bd.kind.alert_sent': 'Đã gửi cảnh báo cho người nhận', 'bd.kind.alert_resolved': 'Đã báo an toàn cho người nhận',
      'bd.kind.alert_sent_sos': 'Đã gửi email SOS cho người nhận',
      'bd.kind.alert_sent_sim': 'Email cảnh báo (mô phỏng)', 'bd.kind.alert_resolved_sim': 'Email “đã an toàn” (mô phỏng)',
      'bd.kind.alert_sent_sos_sim': 'Email SOS (mô phỏng)',
      'bd.kind.alert_failed': 'Gửi cảnh báo thất bại', 'bd.kind.stop': 'Kết thúc theo dõi', 'bd.kind.resolved': 'Đã xác nhận an toàn',
      'bd.ks.location': 'vị trí', 'bd.ks.pre_deadzone': 'vị trí trước vùng mất sóng', 'bd.ks.overdue': 'quá hạn check-in',
      'bd.ks.sos': 'SOS', 'bd.ks.checkin': 'check-in', 'bd.ks.start': 'bắt đầu phiên', 'bd.ks.stop': 'kết thúc phiên', 'bd.ks.resolved': 'xác nhận an toàn',
      'bd.ks.location_many': 'vị trí', 'bd.ks.pre_deadzone_many': 'vị trí trước vùng mất sóng', 'bd.ks.overdue_many': 'quá hạn check-in',
      'bd.ks.sos_many': 'SOS', 'bd.ks.checkin_many': 'check-in', 'bd.ks.start_many': 'bắt đầu phiên', 'bd.ks.stop_many': 'kết thúc phiên', 'bd.ks.resolved_many': 'xác nhận an toàn',
      'bd.warn.title': 'Cảnh báo trước vùng mất sóng',
      'bd.warn.path_route': 'Toàn tuyến {route} · {carrier}', 'bd.warn.path_plan': 'Lộ trình từ Bản đồ: {from} → {to} · {carrier}',
      'bd.warn.next': 'Vùng mất sóng kế tiếp', 'bd.warn.after': 'sau {km}', 'bd.warn.eta': '≈ {t}', 'bd.warn.len': 'dài {km}',
      'bd.warn.next_line': 'Vùng mất sóng đầu tiên phía trước: km {km} (sau {dist} ≈ {t}, dài {len}).',
      'bd.warn.inside_line': 'Vị trí đã lưu nằm trong vùng mất sóng — còn {km} tới khi có sóng lại.',
      'bd.warn.none_line': 'Không còn vùng mất sóng đã biết phía trước.',
      'bd.warn.at_km': 'tại km {km}',
      'bd.warn.inside': 'Đang trong vùng mất sóng', 'bd.warn.inside_left': 'còn {km} tới khi có sóng lại',
      'bd.warn.none': 'Không còn vùng mất sóng phía trước', 'bd.warn.none_sub': 'Lộ trình còn lại nhiều khả năng có sóng hoặc không chắc chắn.',
      'bd.warn.alarm': 'Sắp mất sóng — ghi vị trí và nhắn SMS cho người thân ngay!',
      'bd.warn.threshold': 'Ngưỡng theo phương thức', 'bd.warn.th_time': '≤ {min} phút', 'bd.warn.th_km': '≈ {km}', 'bd.warn.th_fallback': 'dự phòng ≤ {km}',
      'bd.warn.formula': 'Cách tính', 'bd.warn.basis_time': 'Theo thời gian — tốc độ ổn định',
      'bd.warn.basis_distance': 'Theo khoảng cách — tốc độ chưa ổn định / GPS chập chờn',
      'bd.warn.speed': 'tốc độ TB trượt 3 phút', 'bd.warn.basis_idle': 'Chưa di chuyển — ước tính với tốc độ mặc định', 'bd.warn.detected': 'Nhận diện: {mode}', 'bd.warn.default_speed': 'tốc độ mặc định',
      'bd.warn.rule_time': 'cảnh báo khi còn ≤ {min} phút', 'bd.warn.rule_dist': 'cảnh báo khi còn ≤ {km}',
      'bd.warn.far': 'Vị trí hiện tại cách lộ trình {km} — chạy mô phỏng để xem cảnh báo hoạt động.',
      'bd.warn.src_sim': 'Vị trí mô phỏng', 'bd.warn.src_saved': 'Vị trí đã lưu', 'bd.warn.src_start': 'Điểm xuất phát',
      'bd.warn.notify': 'Thông báo hệ thống', 'bd.warn.notify_hint': 'Thông báo của máy kèm lời nhắc trong ứng dụng.',
      'bd.warn.notify_denied': 'Trình duyệt đã chặn thông báo — bật lại trong cài đặt trang.',
      'bd.warn.notify_unsupported': 'Thiết bị này không hỗ trợ thông báo hệ thống.',
      'bd.warn.vibrate': 'Rung khi cảnh báo',
      'bd.trip.on': 'Đang theo dõi chuyến đi {from} → {to}', 'bd.trip.on_plain': 'Đang theo dõi chuyến đi',
      'bd.trip.next': 'Nhắc lần tới khoảng {time}: vùng mất sóng tại km {km} (dài {len}).',
      'bd.trip.next_now': 'Sắp tới vùng mất sóng tại km {km} (dài {len}).',
      'bd.trip.none_left': 'Không còn vùng mất sóng đã biết phía trước.',
      'bd.trip.ends': 'Tự kết thúc khi tới nơi hoặc lúc {time}.',
      'bd.trip.stop': 'Kết thúc chuyến đi', 'bd.trip.open_map': 'Mở Bản đồ',
      'bd.trip.off': 'Chưa có chuyến đi. Ở Bản đồ, chọn điểm đến rồi bấm “Bắt đầu đi” để được nhắc trước mỗi vùng mất sóng.',
      'bd.warn.loading': 'Đang tính lớp sóng dọc lộ trình…', 'bd.warn.error': 'Không tải được gói dữ liệu tuyến.',
      'bd.sim.title': 'Mô phỏng hành trình', 'bd.sim.sub': 'Demo: đi dọc tuyến với lớp sóng thật của nhà mạng bạn chọn.',
      'bd.sim.path': 'Lộ trình', 'bd.sim.speed': 'Tốc độ mô phỏng',
      'bd.sim.path_route': 'Toàn tuyến: {route}', 'bd.sim.path_plan': 'Lộ trình đã lập trên Bản đồ',
      'bd.sim.play': 'Chạy', 'bd.sim.pause': 'Tạm dừng', 'bd.sim.resume': 'Tiếp tục', 'bd.sim.again': 'Chạy lại',
      'bd.sim.skip': 'Tới gần vùng mất sóng', 'bd.sim.skip_title': 'Nhảy tới ngay trước vùng mất sóng kế tiếp',
      'bd.sim.reset': 'Đặt lại mô phỏng', 'bd.sim.map_aria': 'Bản đồ mô phỏng hành trình',
      'bd.sim.strip_title': 'Nhấn để chọn vị trí xuất phát', 'bd.sim.strip_aria': 'Vị trí mô phỏng dọc lộ trình (km)',
      'bd.sim.autonet': 'Tự giả lập mất sóng theo lớp sóng',
      'bd.sim.autonet_hint': 'Vào đoạn “mất sóng” → cả ứng dụng offline; ra khỏi đoạn → hàng đợi tự gửi.',
      'bd.sim.hold': 'Dừng trong vùng mất sóng tới khi quá hạn',
      'bd.sim.hold_hint': 'Mô phỏng người đi gặp nạn, không thể check-in — dùng với “Lịch demo nhanh” ở trên.',
      'bd.sim.hold_na': 'Cần một phiên Buddy đang theo dõi.',
      'bd.sim.no_session': 'Chưa bật Buddy — mô phỏng chỉ hiển thị cảnh báo. Bật Buddy để vị trí, cảnh báo và dead-man switch được xếp hàng và gửi lên máy chủ.',
      'bd.demo.title': 'Chế độ demo', 'bd.demo.sub': 'Lịch demo nhanh, mô phỏng hành trình, cách tính cảnh báo, lộ trình phát triển',
      'bd.demo.sched': 'Lịch demo nhanh',
      'bd.demo.sched_hint': 'Thêm lựa chọn “2 phút” và “chờ thêm 1 phút” vào biểu mẫu thiết lập để trình diễn dead-man switch.',
      'bd.demo.sched_on': 'Đã chọn lịch demo nhanh (2 phút, chờ thêm 1 phút) trong biểu mẫu thiết lập.',
      'bd.demo.alert': 'Mô phỏng: sắp vào vùng mất sóng',
      'bd.demo.alert_hint': 'Hiện ngay cửa sổ “Gửi toạ độ cho người thân?” như khi sắp vào vùng mất sóng — kể cả khi chuyển màn hình.',
      'bd.demo.na': 'Chức năng nhắc trước vùng mất sóng chưa sẵn sàng.',
      'bd.sim.clock_note': 'Hạn check-in chạy theo đồng hồ thật; hành trình chạy nhanh ×{x}. Vị trí tự gửi mỗi 30 phút mô phỏng.',
      'bd.sim.done': 'Đã tới cuối lộ trình.', 'bd.sim.no_zone': 'Không còn vùng mất sóng phía trước.',
      'bd.sim.lead_in': 'Mô phỏng bắt đầu ngay trước vùng mất sóng đầu tiên (km {km}) để cảnh báo, mất sóng và hàng đợi hiện ra trước hạn check-in. Chạm dải km để chọn điểm xuất phát khác.',
      'bd.ro.slow': 'chậm lại trong vùng mất sóng',
      'bd.ro.km': 'Quãng đường', 'bd.ro.level': 'Sóng tại chỗ', 'bd.ro.next': 'Mất sóng kế tiếp', 'bd.ro.clock': 'Thời gian mô phỏng',
      'bd.ro.speed': 'Tốc độ TB', 'bd.ro.queue': 'Hàng đợi Buddy', 'bd.ro.none': 'Không còn', 'bd.ro.inside': 'Đang ở trong',
      'bd.net.online': 'Có sóng', 'bd.net.offline': 'Mất sóng', 'bd.net.sim': 'giả lập', 'bd.net.queue': '{n} chờ gửi',
      'bd.net.paused': 'mô phỏng tạm dừng',
      'bd.sim.net_restored': 'Mô phỏng hành trình đã dừng — đã tắt giả lập mất sóng, ứng dụng dùng lại mạng thật.',
      'bd.hold.waiting': 'Đang dừng trong vùng mất sóng — mô phỏng người gặp nạn, không thể check-in. Dead-man switch quá hạn sau {t}.',
      'bd.hold.checking': 'Hết thời gian chờ thêm — đang kích hoạt dead-man switch…',
      'bd.hold.fired': 'Đã quá hạn: cảnh báo nằm trong hàng đợi. Tiếp tục đi để bắt được sóng…',
      'bd.hold.fired_q_sim': 'Đã quá hạn: bản tin nằm trong hàng đợi, sẽ lên máy chủ khi có sóng. {sim} Tiếp tục đi để bắt được sóng…',
      'bd.hold.fired_srv': 'Đã quá hạn: máy chủ tự email cảnh báo cho người nhận, bản tin của máy đang xếp hàng. Tiếp tục đi để bắt được sóng…',
      'bd.hold.fired_noalert': 'Đã quá hạn — phiên này không có cảnh báo tự động từ máy chủ (xem thông báo ở trên). Tiếp tục đi để bắt được sóng…',
      'bd.hold.fired_sim': 'Đã quá hạn — máy chủ mô phỏng đã ghi nhận. {sim} Tiếp tục đi để bắt được sóng…',
      'bd.hold.release': 'Đi tiếp ngay',
      'bd.deliver.toast': 'Có sóng trở lại — {n} sự kiện trong hàng đợi đã lên máy chủ: {list}.',
      'bd.deliver.toast_one': 'Có sóng trở lại — {n} sự kiện trong hàng đợi đã lên máy chủ: {list}.',
      'bd.deliver.noemail': 'Không có email nên máy chủ không tự báo cho {name} — hãy bấm Gửi SMS.',
      'bd.deliver.noalert': 'Máy chủ không thể gửi cảnh báo tự động cho phiên này — hãy gửi SMS.',
      'bd.alerted.toast': 'Máy chủ đã gửi email cảnh báo tới {to}.',
      'bd.alerted.toast_sos': 'Máy chủ đã gửi email SOS tới {to}.',
      'bd.alerted.toast_sim': 'Cảnh báo tới {to} đã được ghi nhận. {sim}',
      'bd.alerted.toast_sos_sim': 'SOS tới {to} đã được ghi nhận. {sim}',
      'bd.overdue.toast': 'Quá hạn check-in — máy chủ sẽ email cảnh báo cho {name}.',
      'bd.overdue.toast_sim': 'Quá hạn check-in. {sim} Hãy nhắn SMS cho {name}.',
      'bd.overdue.toast_offline': 'Quá hạn check-in — cảnh báo cho {name} đã vào hàng đợi, tự gửi khi có sóng.',
      'bd.overdue.toast_offline_srv': 'Quá hạn check-in — máy chủ vẫn tự email cảnh báo cho {name}, kể cả khi máy bạn mất sóng. Bản tin trên máy sẽ tự gửi khi có sóng.',
      'bd.overdue.toast_noemail': 'Quá hạn check-in — không có email người nhận nên không có cảnh báo tự động. Hãy bấm Gửi SMS cho {name}.',
      'bd.overdue.toast_noalert': 'Quá hạn check-in — máy chủ không thể gửi cảnh báo tự động cho phiên này. Hãy nhắn SMS cho {name}.',
      'bd.overdue.sms': 'SMS',
      'bd.overdue.ok': 'Tôi ổn',
      'bd.group': 'Đồng bộ chéo trong nhóm qua Bluetooth — có trên ứng dụng di động (lộ trình).'
    },
    en: {
      'bd.title': 'Buddy check-in',
      'bd.actions.aria': 'Buddy session quick actions',
      'bd.act.location': 'Save location', 'bd.act.location_hint': 'Stored on server, notifies no one',
      'bd.act.sms': 'Backup SMS', 'bd.act.sms_hint': 'On weak signal',
      'bd.act.sos': 'SOS', 'bd.act.sos_hint': 'Urgent + location',
      'bd.setup.title': 'Set up Buddy check-in',
      'bd.setup.sub': 'One recipient, one check-in schedule — free forever.',
      'bd.f.traveler': 'Your display name', 'bd.f.traveler_ph': 'e.g. Minh Anh',
      'bd.f.traveler_hint': 'Your contact sees this name in the alert.',
      'bd.f.recipient': 'Alert recipient', 'bd.f.rname': 'Full name', 'bd.f.remail': 'Email', 'bd.f.remail_ph': 'contact@example.com',
      'bd.f.rphone': 'Mobile number', 'bd.f.rphone_ph': '+84 912 345 678', 'bd.f.optional': '(optional)',
      'bd.f.rphone_hint': 'For the SMS you send your contact from this phone: a mobile number 03x, 05x, 07x, 08x, 09x or +country code. 02x landlines are not accepted.',
      'bd.f.remail_hint': 'Recommended: the server emails an alert by itself when you miss a check-in or press SOS.',
      'bd.f.err_rname': "Enter the recipient's name.", 'bd.f.err_email': "This email doesn't look right — fix it or leave it empty.",
      'bd.f.err_phone_req': "Enter your contact's mobile number — needed for the SMS from this phone.",
      'bd.f.err_phone': 'Check the mobile number — e.g. 0912 345 678 or +84 912 345 678 (abroad: +country code).',
      'bd.f.err_phone_mobile': "Enter a mobile number (03x, 05x, 07x, 08x, 09x) — 02x landlines can't receive SMS.",
      'bd.f.err_consent': 'Consent is required to turn on the dead-man switch.',
      'bd.f.interval': 'Check in every', 'bd.f.grace': 'Extra wait before overdue',
      'bd.f.route': 'Route', 'bd.f.mode': 'Travel mode',
      'bd.f.share': 'Include my public medical layer in the alert',
      'bd.f.share_text': 'Only blood type, allergies, conditions and medication — sent with the alert email, never your name or ID. Off by default.',
      'bd.f.share_na_email': 'Needs a recipient email — the medical layer only travels with the alert email.',
      'bd.f.share_na_consent': 'First accept processing of sensitive medical data (Decree 356/2025/NĐ-CP) in the QR profile.',
      'bd.f.share_na_profile': 'No medical profile yet — create one in the QR profile.',
      'bd.f.consent': 'I agree to turn on the dead-man switch: the NomadCare server stores this session\'s schedule, locations (including a signal every 5 min while the app is open) and recipient; if a recipient email is given, the server emails my last location when I miss a check-in, press SOS or lose contact unexpectedly.',
      'bd.f.submit': 'Turn on Buddy check-in',
      'bd.f.started': 'Buddy is on. Next check-in before {time}.',
      'bd.f.started_trip': 'Also reminding you before the no-signal areas of {from} → {to} (from the map).',
      'bd.f.started_offline': 'Buddy is on for this device — the session reaches the server at the first signal. Check in before {time}.',
      'bd.mode.motorbike': 'Motorbike', 'bd.mode.hiking': 'Hiking',
      'bd.int.hours': '{n} h', 'bd.int.demo': '2 min (demo)', 'bd.int.min': '{n} min',
      'bd.grace.min': '{n} min', 'bd.grace.demo': '1 min (demo)',
      'bd.hero.intro_text': 'Schedule check-ins. Miss one: your last location is emailed to your contact (if given), or you text them.',
      'bd.hero.intro_text_local': 'Schedule check-ins. Miss one: an alert email (only simulated in the local build) or an SMS you send.',
      'bd.status.off': 'Off',
      'bd.status.active': 'Monitoring', 'bd.status.soon': 'Due soon', 'bd.status.grace': 'Grace period',
      'bd.status.overdue': 'OVERDUE', 'bd.status.alerted': 'Alert sent', 'bd.status.alerted_sim': 'Simulated alert',
      'bd.ring.until': 'until due', 'bd.ring.grace': 'grace left', 'bd.ring.overdue': 'overdue', 'bd.ring.alerted': 'sent', 'bd.ring.alerted_sim': 'simulated',
      'bd.ring.lost': 'contact lost',
      'bd.sim_email.local': 'Simulated email — the local build sends no real email.',
      'bd.sim_email.demo': 'Simulated email — demo addresses are never really emailed.',
      'bd.hero.next': 'Check in before {time}',
      'bd.hero.due_passed': 'Check-in was due at {time}',
      'bd.hero.grace_line': 'Grace {grace} → alert goes out at {time}',
      'bd.hero.grace_line_noalert': 'Grace {grace} → overdue at {time} (no automatic alert)',
      'bd.hero.grace_line_sim': 'Grace {grace} → alert email at {time} (simulated)',
      'bd.hero.grace_line_sms': 'Grace {grace} → overdue at {time}',
      'bd.hero.overdue_title': 'Check-in overdue',
      'bd.hero.overdue_q': 'The alert for {name} is queued — it is sent at the first signal.',
      'bd.hero.overdue_q_sim': 'Overdue — the message is queued and reaches the server at the first signal. {sim}',
      'bd.hero.overdue_srv': 'The server emails {name} by itself at the deadline ({time}) — no signal needed on your phone. Messages queued on this phone go out at the first signal.',
      'bd.hero.overdue_s': 'The alert reached the server — it is emailing {name}.',
      'bd.hero.overdue_sim': 'The missed check-in is recorded. {sim}',
      'bd.hero.alerted_title': 'Alert email sent', 'bd.hero.alerted_title_sim': 'Alert email (simulated)',
      'bd.hero.sos_title': 'SOS triggered', 'bd.status.sos': 'SOS', 'bd.status.sos_alerted': 'SOS sent', 'bd.status.sos_alerted_sim': 'Simulated SOS',
      'bd.status.lost': 'CONTACT LOST', 'bd.status.lost_alerted': 'Contact-lost alert sent', 'bd.status.lost_alerted_sim': 'Contact lost (simulated)',
      'bd.hero.lost_title': 'The server lost contact with you',
      'bd.hero.lost_s': 'The app lost contact unexpectedly (outside a predicted no-signal area) — the server is emailing {name}.',
      'bd.hero.lost_sim': 'The server recorded an unexpected loss of contact (outside a predicted no-signal area). {sim}',
      'bd.hero.lost_noemail': 'The server recorded an unexpected loss of contact — there is no e-mail, so it cannot tell {name}. Tap Send SMS.',
      'bd.hero.lost_alerted_title': 'E-mailed: contact lost', 'bd.hero.lost_alerted_title_sim': 'Contact-lost e-mail (simulated)',
      'bd.hero.lost_alerted_line': 'The server e-mailed {name} about an unexpected loss of contact at {time}. Tap below to tell them you are safe.',
      'bd.lost.toast': "The server heard nothing from the app for more than 15 min (outside a predicted no-signal area). Tap “I'm OK” to tell them you are safe.",
      'bd.lost.toast_sim': "The server heard nothing from the app for more than 15 min. {sim} Tap “I'm OK” to tell them you are safe.",
      'bd.lost.toast_noemail': 'The server heard nothing from the app for more than 15 min — there is no e-mail, so it cannot tell {name}. Tap Send SMS.',
      'bd.hero.sos_q': 'The SOS for {name} is queued — it is sent at the first signal.',
      'bd.hero.sos_q_sim': 'The SOS is queued — it reaches the server at the first signal. {sim}',
      'bd.hero.sos_s': 'The SOS reached the server — it is emailing {name} urgently.',
      'bd.hero.sos_sim': 'The SOS with your location is recorded. {sim}',
      'bd.hero.alerted_line': 'The server emailed {name} at {time}. Tap below to tell them you are safe.',
      'bd.hero.alerted_line_sim': 'At {time}. {sim} Tap below to tell them you are safe.',
      'bd.hero.sos_alerted_title': 'SOS email sent', 'bd.hero.sos_alerted_title_sim': 'SOS email (simulated)',
      'bd.hero.sos_alerted_line': 'The server emailed the SOS to {name} at {time}. Tap below to tell them you are safe.',
      'bd.hero.noemail': 'No recipient email, so the server cannot alert {name} — tap Send SMS.',
      'bd.hero.sms_now': 'Send SMS now',
      'bd.hero.sms_only': 'No email → the server sends no automatic alert; when you are overdue or press SOS, tap Send SMS.',
      'bd.hero.sms_only_tip': 'Add a recipient email to get automatic alerts.',
      'bd.hero.add_email': 'Add an email', 'bd.hero.sms': 'Send SMS',
      'bd.add_email.msg': 'This session ends and the form reopens with its details so you can add an email.',
      'bd.hero.recipient': 'Recipient: {name}',
      'bd.hero.recipient_anon': 'Sending to your recipient', 'bd.your_recipient': 'your recipient',
      'bd.rcp.name_hidden': 'Hidden (profile has a reveal code)',
      'bd.hero.every': 'Every {interval} · grace {grace}',
      'bd.hero.last': 'Last check-in {rel}',
      'bd.hero.checkin': "I'm OK — check in",
      'bd.hero.checkin_safe': "I'm safe — check in",
      'bd.hero.checked': 'Checked in. New deadline: {time}.',
      'bd.hero.checked_offline': 'Checked in on this device — sent at the first signal. New deadline: {time}.',
      'bd.hero.queue': '{n} queued', 'bd.hero.synced': 'Synced', 'bd.hero.local': 'Device only',
      'bd.loc.sent': 'Location saved on the server (Buddy).', 'bd.loc.queued': 'Offline — your location is queued and reaches the server at the first signal.',
      'bd.loc.none': 'No location yet — use the map or the simulator first.',
      'bd.sos.confirm_title': 'Send an SOS to your contact?',
      'bd.sos.confirm_msg': 'The server emails your contact an urgent alert with your location. If a life is at risk, call 115 first.',
      'bd.sos.confirm_btn': 'Send SOS',
      'bd.sos.confirm_title_rec': 'Record an SOS with your location?', 'bd.sos.confirm_btn_rec': 'Record SOS',
      'bd.sos.confirm_msg_noemail': 'There is no email, so the server cannot alert your contact by itself. After recording the SOS, tap Send SMS; if a life is at risk, call 115 first.',
      'bd.sos.confirm_msg_noalert': 'The server cannot send an automatic alert for this session. After recording the SOS, send an SMS; if a life is at risk, call 115 first.',
      'bd.sos.confirm_msg_sim': 'The SOS is recorded with your location. {sim} Then send an SMS; if a life is at risk, call 115 first.',
      'bd.sos.confirm_offline': 'No signal: the SOS waits in the queue until there is signal; a plain SMS may still get through.',
      'bd.sos.sent': 'SOS with your location sent — the server will email {name}.',
      'bd.sos.sent_sim': 'SOS with your location recorded. {sim} Send an SMS or call 115.',
      'bd.sos.sent_noemail': 'SOS recorded — there is no recipient email, so the server cannot alert anyone. Tap Send SMS or call 115.',
      'bd.sos.sent_noalert': 'SOS recorded — but the server cannot send an automatic alert for this session. Send an SMS or call 115.',
      'bd.sos.queued': 'Offline — the SOS is queued and will be sent at the first signal.',
      'bd.sos.queued_sim': 'Offline — the SOS is queued and reaches the server at the first signal. {sim} Send an SMS or call 115.',
      'bd.sos.no_session': 'Buddy check-in is off — no SOS was sent. Call 115.',
      'bd.sms.title': 'Backup SMS', 'bd.sms.sub': 'Plain SMS usually gets through without mobile data.',
      'bd.sms.time_unknown': 'time unknown',
      'bd.sms.body': '[NomadCare] Last location of {name}: {coords} ({time}) {map} · {route}. If unreachable call 112/115. / {name} báo vị trí; nếu không liên lạc được, gọi 112/115.',
      'bd.sms.open': 'Open SMS app', 'bd.sms.demo': 'Illustrative number — the demo does not open the SMS app.',
      'bd.sms.opened': 'SMS app opened — tap Send there to send it.',
      'bd.sms.no_phone': 'No phone number for your contact — copy the text and send it manually.',
      'bd.sms.to': 'To {phone}',
      'bd.stop': 'Stop monitoring', 'bd.stop_title': 'Stop Buddy check-in?',
      'bd.stop_msg': 'The dead-man switch turns off: this session has no more check-in deadlines or overdue alerts.',
      'bd.stopped': 'Buddy check-in is off.',
      'bd.rcp.title': 'Recipient', 'bd.rcp.name': 'Recipient', 'bd.rcp.email': 'Email', 'bd.rcp.phone': 'Phone',
      'bd.rcp.channel_email': 'Automatic alerts by email', 'bd.rcp.channel_sim': 'Simulated email (not really sent)',
      'bd.rcp.channel_sms': 'SMS from your phone only — no automatic email', 'bd.rcp.more': 'Details & sync',
      'bd.rcp.schedule': 'Schedule', 'bd.rcp.route': 'Route', 'bd.rcp.medical': 'Public medical layer',
      'bd.rcp.medical_on': 'Included in alerts', 'bd.rcp.medical_off': 'Not shared', 'bd.rcp.server': 'Server',
      'bd.rcp.server_local': 'Simulated email — the local build sends no real email', 'bd.rcp.server_supabase': 'Supabase — email via Resend',
      'bd.rcp.reveal': 'Show all', 'bd.rcp.hide': 'Mask',
      'bd.sync.pending': '{n} events waiting to sync', 'bd.sync.pending_one': '{n} event waiting to sync', 'bd.sync.ok': 'Reached the server ✓', 'bd.sync.ok_at': 'Reached the server ✓ · {time}',
      'bd.sync.count': 'Server received {n}/{total} events', 'bd.sync.offline': 'Offline — events are safely queued.',
      'bd.sync.local': 'Not on the server — this session is stored on this device only',
      'bd.sync.now': 'Sync now', 'bd.sync.done': '{n} events synced to the server.', 'bd.sync.done_one': '{n} event synced to the server.',
      'bd.err.recipient_email_required': 'An older server rejected this Buddy session because the recipient email is missing — there will be no automatic alert. Set it up again with an email.',
      'bd.err.recipient_phone_required': "The server rejected this Buddy session because the recipient's phone number is missing. Set it up again with a phone number.",
      'bd.err.recipient_phone_invalid': "The server rejected this Buddy session because the recipient's phone number is not valid. Set it up again.",
      'bd.err.recipient_phone_not_mobile': "The server rejected this Buddy session because the recipient's number is a 02x landline, which can't receive SMS. Set it up again with a mobile number (03x, 05x, 07x, 08x, 09x).",
      'bd.err.recipient_email_invalid': "The server rejected this Buddy session because the recipient's email is not valid. Set it up again (the email can stay empty).",
      'bd.err.rate_limited_start': 'Server limit reached: at most 5 Buddy sessions with an email per device per 24 h. This session only runs on this device — no automatic alert from the server.',
      'bd.err.generic': 'The server has not accepted this Buddy session ({code}) — no automatic alert yet. Try setting it up again.',
      'bd.err.restart': 'Set up again', 'bd.err.sms': 'Write SMS',
      'bd.tl.title': 'Event log', 'bd.tl.since': 'Session started {time}', 'bd.tl.closed': 'Latest session (ended)',
      'bd.tl.empty': 'No events yet. Turn on Buddy; for a quick look, open Demo mode and run the journey simulator.',
      'bd.tl.more': 'Show {n} more events', 'bd.tl.more_one': 'Show {n} more event',
      'bd.tl.rate_limited': 'limit of 3 emails per 24 h', 'bd.tl.no_email': 'no recipient email',
      'bd.tl.queued': 'Queued', 'bd.tl.sending': 'Sending…', 'bd.tl.sent': 'On server', 'bd.tl.late': 'Sent {d} late',
      'bd.tl.local': 'Device only', 'bd.tl.server': 'From server',
      'bd.tl.src_device': 'detected on device', 'bd.tl.src_server': 'detected by server', 'bd.tl.src_sim': 'simulated',
      'bd.tl.last_known': 'last known position', 'bd.tl.to': 'to {to}',
      'bd.kind.start': 'Monitoring started', 'bd.kind.checkin': "Check-in: I'm OK", 'bd.kind.location': 'Location sent',
      'bd.kind.pre_deadzone': 'Location before a no-signal area', 'bd.kind.sos': 'SOS', 'bd.kind.overdue': 'Check-in overdue',
      'bd.kind.contact_lost': 'Unexpected loss of contact', 'bd.kind.alert_sent_lost': 'Contact-lost e-mail sent to your contact',
      'bd.kind.alert_sent_lost_sim': 'Contact-lost e-mail (simulated)',
      'bd.kind.alert_sent': 'Alert sent to your contact', 'bd.kind.alert_resolved': 'All-clear sent to your contact',
      'bd.kind.alert_sent_sos': 'SOS email sent to your contact',
      'bd.kind.alert_sent_sim': 'Alert email (simulated)', 'bd.kind.alert_resolved_sim': 'All-clear email (simulated)',
      'bd.kind.alert_sent_sos_sim': 'SOS email (simulated)',
      'bd.kind.alert_failed': 'Alert failed', 'bd.kind.stop': 'Monitoring stopped', 'bd.kind.resolved': 'Confirmed safe',
      'bd.ks.location': 'location', 'bd.ks.pre_deadzone': 'location before a no-signal area', 'bd.ks.overdue': 'missed check-in',
      'bd.ks.sos': 'SOS', 'bd.ks.checkin': 'check-in', 'bd.ks.start': 'session start', 'bd.ks.stop': 'session stop', 'bd.ks.resolved': 'safe confirmation',
      'bd.ks.location_many': 'locations', 'bd.ks.pre_deadzone_many': 'locations before no-signal areas', 'bd.ks.overdue_many': 'missed check-ins',
      'bd.ks.sos_many': 'SOS', 'bd.ks.checkin_many': 'check-ins', 'bd.ks.start_many': 'session starts', 'bd.ks.stop_many': 'session stops', 'bd.ks.resolved_many': 'safe confirmations',
      'bd.warn.title': 'Warning before a no-signal area',
      'bd.warn.path_route': 'Whole route {route} · {carrier}', 'bd.warn.path_plan': 'Route from the map: {from} → {to} · {carrier}',
      'bd.warn.next': 'Next no-signal area', 'bd.warn.after': 'in {km}', 'bd.warn.eta': '≈ {t}', 'bd.warn.len': '{km} long',
      'bd.warn.next_line': 'First no-signal area ahead: km {km} ({dist} ≈ {t} away, {len} long).',
      'bd.warn.inside_line': 'Your saved position is inside a no-signal area — {km} until signal returns.',
      'bd.warn.none_line': 'No known no-signal area ahead.',
      'bd.warn.at_km': 'at km {km}',
      'bd.warn.inside': 'Inside a no-signal area', 'bd.warn.inside_left': '{km} until signal returns',
      'bd.warn.none': 'No known no-signal area ahead', 'bd.warn.none_sub': 'The rest of the way is signal likely or uncertain.',
      'bd.warn.alarm': 'Signal loss ahead — save your location and text your contact now!',
      'bd.warn.threshold': 'Threshold by travel mode', 'bd.warn.th_time': '≤ {min} min', 'bd.warn.th_km': '≈ {km}', 'bd.warn.th_fallback': 'fallback ≤ {km}',
      'bd.warn.formula': 'How it is computed', 'bd.warn.basis_time': 'Time based — steady speed',
      'bd.warn.basis_distance': 'Distance based — speed not steady yet / jittery GPS',
      'bd.warn.speed': '3-min moving average', 'bd.warn.basis_idle': 'Not moving — estimated with the default speed', 'bd.warn.detected': 'Detected: {mode}', 'bd.warn.default_speed': 'default speed',
      'bd.warn.rule_time': 'warns at ≤ {min} min', 'bd.warn.rule_dist': 'warns at ≤ {km}',
      'bd.warn.far': 'Your position is {km} from this route — run the simulator to see the warning in action.',
      'bd.warn.src_sim': 'Simulated position', 'bd.warn.src_saved': 'Saved position', 'bd.warn.src_start': 'Route start',
      'bd.warn.notify': 'System notifications', 'bd.warn.notify_hint': 'A system notification alongside the in-app reminder.',
      'bd.warn.notify_denied': 'Notifications are blocked by the browser — allow them in the site settings.',
      'bd.warn.notify_unsupported': "This device doesn't support system notifications.",
      'bd.warn.vibrate': 'Vibrate on warning',
      'bd.trip.on': 'Trip in progress: {from} → {to}', 'bd.trip.on_plain': 'Trip in progress',
      'bd.trip.next': 'Next reminder around {time}: no-signal area at km {km} ({len} long).',
      'bd.trip.next_now': 'No-signal area coming up at km {km} ({len} long).',
      'bd.trip.none_left': 'No known no-signal area left ahead.',
      'bd.trip.ends': 'Ends by itself on arrival or at {time}.',
      'bd.trip.stop': 'End trip', 'bd.trip.open_map': 'Open the map',
      'bd.trip.off': 'No trip yet. On the map, pick a destination and tap “Start trip” to be reminded before each no-signal area.',
      'bd.warn.loading': 'Computing signal along the route…', 'bd.warn.error': "Couldn't load the route data pack.",
      'bd.sim.title': 'Journey simulator', 'bd.sim.sub': 'Demo: ride the route with the real coverage layer of your carrier.',
      'bd.sim.path': 'Path', 'bd.sim.speed': 'Simulation speed',
      'bd.sim.path_route': 'Whole route: {route}', 'bd.sim.path_plan': 'Route planned on the map',
      'bd.sim.play': 'Play', 'bd.sim.pause': 'Pause', 'bd.sim.resume': 'Resume', 'bd.sim.again': 'Replay',
      'bd.sim.skip': 'Jump to the next no-signal area', 'bd.sim.skip_title': 'Jump to just before the next no-signal area',
      'bd.sim.reset': 'Reset simulation', 'bd.sim.map_aria': 'Journey simulator map',
      'bd.sim.strip_title': 'Tap to choose the start position', 'bd.sim.strip_aria': 'Simulated position along the path (km)',
      'bd.sim.autonet': 'Simulate signal loss from the coverage layer',
      'bd.sim.autonet_hint': 'Entering a “lost” stretch puts the whole app offline; leaving it flushes the queue.',
      'bd.sim.hold': 'Stop inside the no-signal area until overdue',
      'bd.sim.hold_hint': 'Simulates a traveller in trouble who cannot check in — use with the “Quick demo schedule” above.',
      'bd.sim.hold_na': 'Needs an active Buddy session.',
      'bd.sim.no_session': 'Buddy is off — the simulator only shows warnings. Turn Buddy on so locations, alerts and the dead-man switch are queued and sent to the server.',
      'bd.demo.title': 'Demo mode', 'bd.demo.sub': 'Quick demo schedule, journey simulator, how the warning is computed, roadmap',
      'bd.demo.sched': 'Quick demo schedule',
      'bd.demo.sched_hint': 'Adds “2 min” and “1 min extra wait” to the setup form to demo the dead-man switch.',
      'bd.demo.sched_on': 'Quick demo schedule (2 min, 1 min extra wait) selected in the setup form.',
      'bd.demo.alert': 'Simulate: no-signal area ahead',
      'bd.demo.alert_hint': 'Shows the “Send your coordinates?” popup right away, as before a no-signal area — it stays when you change screens.',
      'bd.demo.na': 'Reminders before no-signal areas are not available.',
      'bd.sim.clock_note': 'The check-in deadline runs on the real clock; the journey runs ×{x}. Location is sent every 30 simulated minutes.',
      'bd.sim.done': 'End of the path.', 'bd.sim.no_zone': 'No known no-signal area ahead.',
      'bd.sim.lead_in': 'The simulator starts just before the first no-signal area (km {km}) so the warning, the signal loss and the queue show up before the check-in deadline. Tap the km strip to start elsewhere.',
      'bd.ro.slow': 'slowed down in the no-signal area',
      'bd.ro.km': 'Distance', 'bd.ro.level': 'Signal here', 'bd.ro.next': 'Next no-signal area', 'bd.ro.clock': 'Simulated time',
      'bd.ro.speed': 'Avg speed', 'bd.ro.queue': 'Buddy queue', 'bd.ro.none': 'None', 'bd.ro.inside': 'Inside',
      'bd.net.online': 'Signal', 'bd.net.offline': 'No signal', 'bd.net.sim': 'simulated', 'bd.net.queue': '{n} queued',
      'bd.net.paused': 'simulation paused',
      'bd.sim.net_restored': 'The journey simulator stopped — simulated signal loss is off and the app is back on the real network.',
      'bd.hold.waiting': 'Stopped inside the no-signal area — a traveller in trouble who cannot check in. The dead-man switch fires in {t}.',
      'bd.hold.checking': 'Grace period over — triggering the dead-man switch…',
      'bd.hold.fired': 'Overdue: the alert is queued. Moving on to find signal…',
      'bd.hold.fired_q_sim': 'Overdue: the message is queued and reaches the server at the first signal. {sim} Moving on to find signal…',
      'bd.hold.fired_srv': 'Overdue: the server emails the alert to your contact by itself; this phone’s messages are queued. Moving on to find signal…',
      'bd.hold.fired_noalert': 'Overdue — this session has no automatic alert from the server (see the notice above). Moving on to find signal…',
      'bd.hold.fired_sim': 'Overdue — recorded by the simulated server. {sim} Moving on to find signal…',
      'bd.hold.release': 'Move on now',
      'bd.deliver.toast': 'Signal is back — {n} queued events reached the server: {list}.',
      'bd.deliver.toast_one': 'Signal is back — {n} queued event reached the server: {list}.',
      'bd.deliver.noemail': 'There is no email, so the server does not alert {name} by itself — tap Send SMS.',
      'bd.deliver.noalert': 'The server cannot send an automatic alert for this session — send an SMS.',
      'bd.alerted.toast': 'The server emailed an alert to {to}.',
      'bd.alerted.toast_sos': 'The server emailed the SOS to {to}.',
      'bd.alerted.toast_sim': 'The alert to {to} is recorded. {sim}',
      'bd.alerted.toast_sos_sim': 'The SOS to {to} is recorded. {sim}',
      'bd.overdue.toast': 'Check-in overdue — the server will email an alert to {name}.',
      'bd.overdue.toast_sim': 'Check-in overdue. {sim} Text {name} yourself.',
      'bd.overdue.toast_offline': 'Check-in overdue — the alert for {name} is queued and sent at the first signal.',
      'bd.overdue.toast_offline_srv': 'Check-in overdue — the server still emails the alert to {name} by itself, even without signal here. Messages queued on this phone go out at the first signal.',
      'bd.overdue.toast_noemail': 'Check-in overdue — there is no recipient email, so no automatic alert. Tap Send SMS to text {name}.',
      'bd.overdue.toast_noalert': 'Check-in overdue — the server cannot send an automatic alert for this session. Text {name} yourself.',
      'bd.overdue.sms': 'SMS',
      'bd.overdue.ok': "I'm OK",
      'bd.group': 'Cross-sync within a group over Bluetooth — on the mobile app (roadmap).'
    }
  });

  /* ================================================================== */
  /* CONSTANTS                                                            */
  /* ================================================================== */
  /* Real schedules only; the demo values (2 min / 1 min) join the chips only while "Lịch demo nhanh" (Chế độ demo, on
     by default with ?demo=1) is on — a real traveller never sees them in the setup form (round 2 R1). */
  var INTERVALS = [60, 120, 180, 240, 360];
  var DEMO_INTERVAL = 2;
  var GRACES = [15, 30, 60];
  var DEMO_GRACE = 1;
  var SPEED_X = [30, 60, 120];
  var PING_EVERY_MIN = 30;           // simulated minutes between automatic 'location' pings
  var STEP_MS = 200;                 // simulator tick (real ms)
  var FAR_KM = 30;                   // position farther than this from the path → not on this path
  var HOLD_RELEASE_MS = 2500;        // after the dead-man fired, stay in the zone a moment so judges see the queue
  var HOLD_MAX_WAIT_MS = 15 * 60000; // only hold when the check-in deadline (+grace) is at most this far away
  var MIN_LOST_MS = 7000;            // every lost stretch stays on screen ≥ 7 s real time (300 m flash by in 0.7 s at ×60)
  var LEAD_MAX_MS = 30000;           // "Chạy" from km 0: jump ahead when the first warning is further than this (demo schedule)…
  var LEAD_BUFFER_MS = 20000;        // …or when the check-in deadline would come before the first dead zone (+ this margin)
  /* Server refusals of a start (FIX_CONTRACT A5 + round 2 R7); recipient_email_required = an older server (before
     migration 20260930000100) that still requires the e-mail; recipient_phone_not_mobile = a 02x landline (20261002000100). */
  var RECIPIENT_CODES = ['recipient_phone_required', 'recipient_phone_invalid', 'recipient_phone_not_mobile', 'recipient_email_invalid',
    'recipient_email_required'];
  var REFUSED_KEYS = RECIPIENT_CODES.concat(['rate_limited_start', 'start_rejected']); // syncProblem keys: server refused the start
  var PREFS_KEY = 'bd.prefs';
  var MAP_ROUTE_KEY = 'map.last_route';
  var TRAVELER_MAX = 60, RECIPIENT_MAX = 80;  // FIX_CONTRACT A5: names ≤ 60 chars, no URLs (the server re-checks)
  var NAME_URL_RE = /(?:https?:\/\/|www\.)\S*/gi;
  var NAME_HTTP_RE = /\bhttps?\b:?\/*/gi;
  var NAME_DOMAIN_RE = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|info|biz|io|co|vn|xyz|top|site|online|app|link|me|ru|cn|ly|to|gl|click|live|shop)\b\S*/gi;
  var SIM_NET_FLAG = 'bd_sim_net';   // fallback marker "the simulator set simulated offline" (only without NC.net.simulatedOwner)
  /* Main line of each pilot route (loops need waypoints, otherwise A* start → end = 0 km). */
  var PLANS = {
    'ha-giang-loop': ['hg-ha-giang', 'hg-quan-ba', 'hg-yen-minh', 'hg-dong-van', 'hg-meo-vac', 'hg-du-gia', 'hg-ha-giang'],
    'khanh-le': ['kl-da-lat', 'kl-nha-trang'],
    'ta-nang-phan-dung': ['tn-ta-nang', 'tn-phan-dung']
  };
  var KIND = {
    start: { icon: 'play', tone: 'primary' },
    checkin: { icon: 'check-circle', tone: 'success' },
    location: { icon: 'map-pin', tone: 'info' },
    pre_deadzone: { icon: 'signal-off', tone: 'warning' },
    sos: { icon: 'siren', tone: 'danger' },
    overdue: { icon: 'alert-triangle', tone: 'danger' },
    alert_sent: { icon: 'send', tone: 'accent' },
    alert_failed: { icon: 'x-circle', tone: 'danger' },
    stop: { icon: 'stop', tone: 'neutral' },
    resolved: { icon: 'shield-check', tone: 'success' }
  };

  /* ================================================================== */
  /* STATE                                                                */
  /* ================================================================== */
  var st = {
    mounted: false, visible: false, root: null, el: {},
    session: null, events: [], ops: [], consents: null, profile: null, loaded: false,
    prevStatus: undefined, prevSessionId: null,
    prefs: { vibrate: true, autoNet: true, hold: true, speedX: 60, mode: null, path: null },
    plan: null, tripPlan: null, journey: null, journeyKey: null, journeyErr: null, building: null,
    phase: null, showAll: false, reveal: false, formInit: false, demoSched: isDemo(),
    queued: {}, delivered: [], deliverTimer: null,
    tickTimer: null, lastTickCall: 0, refreshTimer: null, lastSosAt: 0,
    map: null, mapLayer: null, marker: null, mapKey: null,
    opErr: null, errToasted: {}, deliverToast: null, prefill: null
  };
  var sim = {
    playing: false, started: false, finished: false, pos: 0, simMs: 0, speedX: 60, mode: 'motorbike',
    samples: [], noise: 0, speed: 0, warned: {}, warnings: [], inLost: false,
    holding: false, holdKey: null, holdFiredAt: 0, heldKeys: {}, lastPingMs: 0, lastSaveMs: 0,
    lastTs: 0, timer: null, netOwned: false, netWriting: false, resumeAfterModal: false, live: null, log: [],
    lostUntil: 0, lostEnd: null, lostPinged: {}, slowX: null
  };

  /* ================================================================== */
  /* SMALL HELPERS                                                        */
  /* ================================================================== */
  function modeLabel(m) { return t('bd.mode.' + (m === 'hiking' ? 'hiking' : 'motorbike')); }
  /** Plain schedule labels ("2 phút", "1 giờ") for the hero / recipient card: "(demo)" only on the setup chips. */
  function intervalLabel(min) {
    if (min < 60) return t('bd.int.min', { n: min });
    return t('bd.int.hours', { n: U.fmtNumber(min / 60, min % 60 ? 1 : 0) });
  }
  function graceLabel(min) { return t('bd.grace.min', { n: min }); }
  function intervalChip(min) { return min === DEMO_INTERVAL ? t('bd.int.demo') : intervalLabel(min); }
  function graceChip(min) { return min === DEMO_GRACE ? t('bd.grace.demo') : graceLabel(min); }
  /**
   * A position time that can be shown: some engines report GeolocationPosition.timestamp in µs (a date ~50 000 years
   * ahead) → recovered; any other date in the future or unreadable → null (unknown).
   */
  function saneAt(at) {
    var ms = at ? Date.parse(at) : NaN;
    var now = Date.now();
    if (isFinite(ms) && ms > now + 86400000 && Math.abs(ms / 1000 - now) < 2 * 86400000) ms = ms / 1000;
    return isFinite(ms) && ms <= now + 5 * 60000 ? new Date(ms) : null;
  }
  function carrierName(id) { return NC.app && NC.app.carrierName ? NC.app.carrierName(id) : id; }
  function routeName(id) { return NC.app && NC.app.routeName ? NC.app.routeName(id) : id; }
  function seedRoutes() {
    return ((window.NC_SEED && window.NC_SEED.routes) || []).slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  }
  function routeMeta(id) { return seedRoutes().filter(function (r) { return r.id === id; })[0] || null; }
  function setting(k, d) { var v = NC.settings ? NC.settings.get(k) : null; return v === undefined || v === null ? d : v; }
  function curCarrier() { return setting('carrier', 'viettel'); }
  function curRoute() { return setting('route_id', 'ha-giang-loop'); }
  function lastPos() {
    var p = setting('last_position', null);
    return p && isFinite(p.lat) && isFinite(p.lng) ? p : null;
  }
  function coordsText(lat, lng) { return (+lat).toFixed(5) + ', ' + (+lng).toFixed(5); }
  function maskEmail(e) {
    var m = /^([^@]{0,1})[^@]*(@.*)$/.exec(e || '');
    return m ? m[1] + '***' + m[2] : '';
  }
  /** '+84 912 *** 678' / legacy landline '+84 24 *** 444' (the head's trailing space is dropped: one space each side). */
  function maskPhone(p) {
    var s = String(p || '').trim();
    if (s.length < 7) return s ? '***' : '';
    return s.slice(0, Math.min(7, s.length - 3)).replace(/\s+$/, '') + ' *** ' + s.slice(-3).replace(/^\s+/, '');
  }
  /** "1:05:09" or "4:59" countdown. */
  function fmtCountdown(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return hh ? hh + ':' + p2(mm) + ':' + p2(ss) : mm + ':' + p2(ss);
  }
  function fmtClock(iso) {
    var d = U.toDate(iso); if (!d) return '–';
    if (new Date().toDateString() !== d.toDateString()) return U.fmtDateTime(d);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function fmtSpeed(v) { return (v === null || v === undefined || !isFinite(v)) ? '–' : U.fmtNumber(v, 1) + ' km/h'; }
  function kmAt(km) { return U.fmtNumber(km, km >= 100 ? 0 : 1); }
  function vib(p) { if (st.prefs.vibrate) U.vibrate(p); }
  function toast(msg, o) { return NC.ui ? NC.ui.toast(msg, o) : null; }
  function slog(what, extra) {
    var row = Object.assign({ at: new Date().toISOString(), what: what, km: U.round(sim.pos, 2), sim_min: Math.round(sim.simMs / 60000), online: online() }, extra || {});
    sim.log.push(row);
    if (sim.log.length > 400) sim.log.shift();
  }
  /**
   * NOTES §6: a reveal code puts the owner's identity (incl. the emergency contact) behind the MOD.03 gate, so summary
   * text names a neutral "người nhận của bạn"; real values only appear in the owner's own form or after gateIdentity().
   * Before the profile is read, neutral too (no name flash).
   */
  function idProtected() {
    var p = st.loaded ? st.profile : (NC.profile && typeof NC.profile.peek === 'function' ? NC.profile.peek() : undefined);
    if (p === undefined) return true;
    return !!(p && p.identity && p.identity.reveal_code);
  }
  function recipientName(s) {
    var real = (s && (s.recipient_name || s.recipient_email || s.recipient_phone)) || '';
    if (!real) return '—';
    return idProtected() ? t('bd.your_recipient') : real;
  }
  /** "Người nhận: Lê Hà", or "Gửi tới người nhận của bạn" while the identity is protected. */
  function recipientLine(s) { return idProtected() ? t('bd.hero.recipient_anon') : t('bd.hero.recipient', { name: recipientName(s) }); }
  function ucfirst(x) { x = String(x || ''); return x.charAt(0).toUpperCase() + x.slice(1); }
  /** Count-aware string: uses `key_one` when n === 1 and it exists (EN singular), else `key`. */
  function tn(key, n, vars) {
    var k = n === 1 && NC.i18n && NC.i18n.has && NC.i18n.has(key + '_one') ? key + '_one' : key;
    return t(k, Object.assign({ n: n }, vars || {}));
  }
  function ksLabel(kind, n) {
    var k = 'bd.ks.' + kind + (n === 1 ? '' : '_many');
    return NC.i18n && NC.i18n.has && !NC.i18n.has(k) ? t('bd.ks.' + kind) : t(k);
  }
  function okSpeed(v) { return typeof v === 'number' && isFinite(v) && v >= 0.5 && v <= 150; }
  /** Readable form of an E.164 number: '+84 912 345 678' (VN mobile / demo), '+84 24 3826 4444' (VN landline). */
  function prettyPhone(e164) {
    var m = /^\+84(\d{9,10})$/.exec(e164 || '');
    if (!m) return e164 || '';
    var n = m[1];
    return n.length === 9 ? '+84 ' + n.slice(0, 3) + ' ' + n.slice(3, 6) + ' ' + n.slice(6)
      : '+84 ' + n.slice(0, 2) + ' ' + n.slice(2, 6) + ' ' + n.slice(6);
  }
  /**
   * Recipient phone (round 2 R7, contract C3): same rules as the server (NC.backend.shared.normPhone =
   * app_private.norm_phone / valid_phone / phone_is_landline) — Vietnamese mobile 0…/+84…, international +<cc>… /
   * 00<cc>…, demo +84 000 000 0NN → E.164. A Vietnamese 02x landline is normalised (display of a legacy session) but
   * landline: true, valid: false — it cannot receive the SMS (20261002000100: 'recipient_phone_not_mobile').
   * @returns {{e164: string|null, valid: boolean, isDemo: boolean, empty: boolean, landline: boolean, display: string}}
   */
  function normPhone(raw) {
    var sh = NC.backend && NC.backend.shared;
    var r = sh && sh.normPhone ? sh.normPhone(raw) : { e164: null, valid: false, isDemo: false, empty: !String(raw || '').trim() };
    return { e164: r.e164, valid: !!r.valid, isDemo: !!r.isDemo, empty: !!r.empty, landline: !!r.landline, display: r.e164 ? prettyPhone(r.e164) : '' };
  }
  function validEmail(e) {
    var sh = NC.backend && NC.backend.shared;
    return sh && sh.validEmail ? sh.validEmail(e) : /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[a-z]{2,}$/i.test(String(e || ''));
  }
  /** A stored phone for display: E.164 (also a legacy landline) → readable; legacy free-form values as they are. */
  function phoneText(p) { var n = normPhone(p); return n.e164 ? n.display : String(p || ''); }
  /**
   * E-mails of this session are not really sent: local mode (the in-browser server only simulates them) or a reserved
   * demo domain (example.com …, never e-mailed — backend-local / Edge Function provider 'demo').
   * @returns {string|null} the honest note to show, null when a real e-mail goes out
   */
  function emailSimNote(s) {
    if (!s || !s.recipient_email) return null;
    if (!NC.data || NC.data.mode !== 'supabase') return t('bd.sim_email.local');
    var sh = NC.backend && NC.backend.shared;
    return sh && sh.isReservedEmail && sh.isReservedEmail(s.recipient_email) ? t('bd.sim_email.demo') : null;
  }
  /** Display names in alerts: no control characters or links (anti-phishing, FIX_CONTRACT A5), capped length. */
  function cleanName(v, max) {
    var s = String(v || '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
      .replace(NAME_URL_RE, ' ').replace(NAME_HTTP_RE, ' ').replace(NAME_DOMAIN_RE, ' ')
      .replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max).trim() : s;
  }

  /* ================================================================== */
  /* PREFS                                                                */
  /* ================================================================== */
  function loadPrefs() {
    if (!NC.store) return Promise.resolve();
    return NC.store.get(PREFS_KEY).then(function (p) {
      if (p && typeof p === 'object') Object.keys(st.prefs).forEach(function (k) { if (p[k] !== undefined) st.prefs[k] = p[k]; });
      if (SPEED_X.indexOf(+st.prefs.speedX) < 0) st.prefs.speedX = 60;
      sim.speedX = +st.prefs.speedX;
      if (st.prefs.mode === 'hiking' || st.prefs.mode === 'motorbike') sim.mode = st.prefs.mode;
    }).catch(function () { });
  }
  function savePrefs() {
    if (NC.store) NC.store.set(PREFS_KEY, st.prefs).catch(function () { });
  }

  /* ================================================================== */
  /* DATA                                                                 */
  /* ================================================================== */
  function refresh() {
    if (!NC.data || !NC.data.buddy) return Promise.resolve();
    return Promise.all([
      NC.data.buddy.current().catch(function () { return null; }),
      NC.data.buddy.events().catch(function () { return []; }),
      NC.data.outbox().catch(function () { return []; }),
      NC.profile && NC.profile.consents ? NC.profile.consents.get().catch(function () { return null; }) : null,
      NC.profile ? Promise.resolve(NC.profile.get()).catch(function () { return null; }) : null
    ]).then(function (r) {
      var s = r[0];
      // The data layer cleared session.sync_error (a later attempt got through) → drop our copy of the op error too.
      if (st.opErr && s && st.session && st.session.id === s.id && st.session.sync_error && !s.sync_error) st.opErr = null;
      handleTransitions(s);
      st.session = s;
      st.events = r[1] || [];
      // a queued heartbeat (NC.trip) is no event of the session: never "1 chờ gửi" for it
      st.ops = (r[2] || []).filter(function (o) { return o.op && o.op.indexOf('buddy.') === 0 && o.op !== 'buddy.heartbeat'; });
      st.consents = r[3];
      st.profile = r[4];
      st.loaded = true;
      if (st.opErr && (!s || st.opErr.sid !== s.id)) st.opErr = null;
      st.events.forEach(function (e) { if (e.queued && !deliveredAt(e) && e.session_id) st.queued[e.id] = e.kind; });
      ensureTicker();
      if (st.mounted) renderState();
    });
  }
  var refreshSoon = function () {
    clearTimeout(st.refreshTimer);
    st.refreshTimer = setTimeout(function () { refresh().catch(function (e) { console.warn('[buddy] refresh', e); }); }, 120);
  };

  /* Status transitions → toasts that matter wherever the traveller is in the app. */
  function handleTransitions(s) {
    var prev = st.prevStatus, prevId = st.prevSessionId;
    var status = s ? s.status : null;
    st.prevStatus = status; st.prevSessionId = s ? s.id : null;
    if (prev === undefined || !s || prevId !== s.id || prev === status) return;
    if (status === 'overdue' && prev === 'active') {
      slog('overdue', { local: true, sos: sosCaused(s) });
      if (Date.now() - st.lastSosAt < 15000 || s.alert_reason === 'sos') return;
      vib([300, 120, 300, 120, 300]);
      if (s.alert_reason === 'contact_lost') {
        // The server stopped hearing the heartbeat of the live app (round 2 R6): honest per channel, like overdue.
        var simL = s.recipient_email ? emailSimNote(s) : null;
        st.overdueToast = toast(!s.recipient_email ? t('bd.lost.toast_noemail', { name: recipientName(s) }) : simL ? t('bd.lost.toast_sim', { sim: simL }) : t('bd.lost.toast'), {
          type: 'danger', timeout: 12000,
          action: !s.recipient_email ? { label: t('bd.overdue.sms'), onClick: function () { openSms(); } } : { label: t('bd.overdue.ok'), onClick: function () { checkin(); } }
        });
        return;
      }
      var prob = syncProblem(s);
      if (!s.recipient_email || prob) {
        // No automatic channel: never claim an alert is on its way — hand the traveller the SMS fallback instead.
        st.overdueToast = toast(t(!s.recipient_email ? 'bd.overdue.toast_noemail' : 'bd.overdue.toast_noalert', { name: recipientName(s) }), {
          type: 'danger', timeout: 12000, action: { label: t('bd.overdue.sms'), onClick: function () { openSms(); } }
        });
        return;
      }
      var simNote = emailSimNote(s);
      if (simNote) {
        // Local build / demo address: the e-mail is only simulated — never promise that the contact will hear about it.
        st.overdueToast = toast(t('bd.overdue.toast_sim', { sim: simNote, name: recipientName(s) }), {
          type: 'danger', timeout: 12000, action: { label: t('bd.overdue.sms'), onClick: function () { openSms(); } }
        });
        return;
      }
      // Offline: the server's own dead-man switch still emails at due + grace when it knows the session (start
      // acknowledged); only the phone's own events wait for signal. Unknown to the server → the alert really is queued.
      var key = online() ? 'bd.overdue.toast' : (startAckOf(s) ? 'bd.overdue.toast_offline_srv' : 'bd.overdue.toast_offline');
      st.overdueToast = toast(t(key, { name: recipientName(s) }), {
        type: 'danger', timeout: 9000, action: { label: t('bd.overdue.ok'), onClick: function () { checkin(); } }
      });
    } else if (status === 'alerted') {
      slog('alerted', { alerted_at: s.alerted_at });
      var sim = emailSimNote(s);
      var to = maskEmail(s.recipient_email) || recipientName(s);
      var sos = sosCaused(s);
      toast(sim ? t(sos ? 'bd.alerted.toast_sos_sim' : 'bd.alerted.toast_sim', { to: to, sim: sim })
        : t(sos ? 'bd.alerted.toast_sos' : 'bd.alerted.toast', { to: to }), { type: 'warning', timeout: sim ? 9000 : 7000 });
    }
  }

  /* ---------------- server-side problems (op errors, FIX_CONTRACT A5) ---------------- */
  function normCode(c) {
    var s = String(c || '').toLowerCase();
    for (var i = 0; i < RECIPIENT_CODES.length; i++) if (s.indexOf(RECIPIENT_CODES[i]) >= 0) return RECIPIENT_CODES[i];
    if (s.indexOf('rate_limit') >= 0) return 'rate_limited';
    return s.replace(/[^a-z0-9_.-]+/g, '_').slice(0, 40) || 'error';
  }
  /**
   * Why the server cannot (or did not) alert the recipient for this session, from, in order: the latest bus
   * 'data:op_error', session.sync_error, or the last_error of a queued buddy op. null when all is well.
   * @returns {{key:string, text:string, actions:string[]}|null}
   */
  function syncProblem(s) {
    if (!s) return null;
    var code = null, op = null;
    if (st.opErr && st.opErr.sid === s.id) { code = st.opErr.code; op = st.opErr.op; }
    if (!code && s.sync_error) code = normCode(s.sync_error);
    if (!code) {
      st.ops.forEach(function (o) {
        if (!code && o.data && o.data.session_id === s.id && o.last_error && /recipient_(email|phone)_(required|invalid|not_mobile)|rate_limit/i.test(o.last_error)) { code = normCode(o.last_error); op = o.op; }
      });
    }
    if (!code) return null;
    var startAcked = st.events.some(function (e) { return e.session_id === s.id && e.kind === 'start' && !!e.received_at; });
    if (startAcked && op === 'buddy.start') return null; // an earlier attempt failed, a later one got through
    if (RECIPIENT_CODES.indexOf(code) >= 0) return startAcked ? null : { key: code, text: t('bd.err.' + code), actions: ['restart'] };
    // 'rate_limited' only ever comes from buddy.start (the per-device start limit): the alert quota is applied by the
    // server's cron and never reaches the device as an op error, so there is no "alert rate-limited" state here.
    if (code === 'rate_limited') {
      var atStart = op ? op === 'buddy.start' : !startAcked;
      return atStart ? { key: 'rate_limited_start', text: t('bd.err.rate_limited_start'), actions: ['sms'] } : null;
    }
    if (op === 'buddy.start' && !startAcked) return { key: 'start_rejected', text: t('bd.err.generic', { code: code }), actions: ['restart'] };
    return null;
  }
  /** Did the server acknowledge this session's start? true / false, or null when the log has no start event. */
  function startAckOf(s) {
    if (!s) return null;
    var start = null;
    st.events.forEach(function (e) { if (!start && e.session_id === s.id && e.kind === 'start') start = e; });
    return start ? !!start.received_at : null;
  }
  /**
   * Where this session stands with the server, for the hero pill, the recipient card and the timeline:
   * 'refused' (the server refused the start for good), 'local' (never acknowledged and nothing left to send → the
   * session only exists on this device), 'pending' (ops queued) or 'ok'. Never "synced" for a session the server lacks.
   * @returns {{state:string, n:number}}
   */
  function serverView(s) {
    var n = sessionOpCount(s);
    var sp = syncProblem(s);
    if (sp && REFUSED_KEYS.indexOf(sp.key) >= 0) return { state: 'refused', n: n };
    if (n) return { state: 'pending', n: n };
    if (startAckOf(s) === false) return { state: 'local', n: 0 };
    return { state: 'ok', n: 0 };
  }
  function onOpError(p) {
    if (!p || !p.op || String(p.op).indexOf('buddy.') !== 0 || p.op === 'buddy.stop') return;
    var s = st.session;
    var sid = p.session_id || (p.data && p.data.session_id) || (s ? s.id : null);
    if (!s || sid !== s.id) { refreshSoon(); return; }
    st.opErr = { code: normCode(p.code || p.message), op: String(p.op), sid: sid, at: Date.now() };
    slog('op_error', { op: p.op, code: st.opErr.code });
    var pr = syncProblem(s);
    var key = pr ? pr.key + '|' + s.id : null;
    if (pr && !st.errToasted[key]) {
      st.errToasted[key] = true;
      var act = pr.actions[0] === 'restart' ? { label: t('bd.err.restart'), onClick: function () { restartSetup(); } }
        : { label: t('bd.err.sms'), onClick: function () { openSms(); } };
      toast(pr.text, { type: 'danger', timeout: 12000, action: act });
    }
    if (st.mounted) renderHero(true);
    refreshSoon();
  }

  /* Delivered-after-queue summary toast (one per reconnect burst). */
  function onEvent(p) {
    var ev = p && p.event;
    if (!ev) { refreshSoon(); return; }
    if (ev.received_at && st.queued[ev.id]) {
      st.delivered.push(ev.kind);
      delete st.queued[ev.id];
      // A 'resolved' derived from this check-in (no op of its own) went out with it.
      if (ev.kind === 'checkin') {
        st.events.forEach(function (d) { if (st.queued[d.id] && d.kind === 'resolved' && isDerivedFrom(d, ev)) { st.delivered.push('resolved'); delete st.queued[d.id]; } });
      }
      clearTimeout(st.deliverTimer);
      st.deliverTimer = setTimeout(flushDeliveredToast, 1100);
    } else if (ev.queued && !ev.received_at && ev.session_id) {
      st.queued[ev.id] = ev.kind;
    }
    if (ev.kind === 'checkin' && sim.holding) releaseHold('checkin');
    refreshSoon();
  }
  function flushDeliveredToast() {
    var kinds = st.delivered; st.delivered = [];
    if (!kinds.length) return;
    var counts = {}, order = [];
    kinds.forEach(function (k) { if (!counts[k]) { counts[k] = 0; order.push(k); } counts[k]++; });
    var list = order.map(function (k) { return counts[k] + ' ' + ksLabel(k, counts[k]); }).join(', ');
    slog('delivered', { n: kinds.length, list: list });
    // "đã lên máy chủ", never "đã gửi": reaching the server tells nobody by itself. A queued overdue / SOS only becomes
    // an e-mail when the session has a real one (Supabase, non-demo address, start accepted) — otherwise say so and keep
    // the SMS at hand (round 2 R7: phone-only = "máy chủ không tự báo — bấm Gửi SMS"; local mode = "mô phỏng").
    var s = st.session;
    var alertish = kinds.indexOf('overdue') >= 0 || kinds.indexOf('sos') >= 0;
    var msg = tn('bd.deliver.toast', kinds.length, { list: list });
    var o = { type: 'success', timeout: 7000 };
    if (s && alertish) {
      var prob = syncProblem(s);
      var note = !s.recipient_email ? t('bd.deliver.noemail', { name: recipientName(s) }) : prob ? t('bd.deliver.noalert') : emailSimNote(s);
      if (note) {
        msg += ' ' + note;
        // still overdue / alerted: nobody really heard of it → the SMS stays one tap away (replaces the overdue toast)
        if (s.status === 'overdue' || s.status === 'alerted') o = { type: 'warning', timeout: 12000, action: { label: t('bd.overdue.sms'), onClick: function () { openSms(); } } };
      }
    }
    // The "queued" overdue toast is stale once its event reached the server: this toast replaces it (with the SMS action
    // whenever no real e-mail goes out).
    if (st.overdueToast && alertish) { try { st.overdueToast.close(); } catch (e) { /* ignore */ } st.overdueToast = null; }
    // One delivery toast at a time: clustered dead zones reconnect several times within seconds.
    if (st.deliverToast) { try { st.deliverToast.close(); } catch (e) { /* ignore */ } }
    st.deliverToast = toast(msg, o);
  }

  /* ---------------- derived events ---------------- */
  /** The check-in a locally derived 'resolved' event came from (meta.parent_event_id, else the latest earlier check-in). */
  function parentOf(ev) {
    var pid = ev.meta && ev.meta.parent_event_id;
    var best = null;
    st.events.forEach(function (e) {
      if (e === ev || e.session_id !== ev.session_id) return;
      if (pid) { if (e.id === pid) best = e; return; }
      if (e.kind === 'checkin' && String(e.client_ts) <= String(ev.client_ts) && (!best || String(e.client_ts) >= String(best.client_ts))) best = e;
    });
    return best;
  }
  /** 'resolved' created by a check-in (no outbox op of its own): delivered together with that check-in. */
  function isDerived(ev) { return ev.kind === 'resolved' && !!ev.meta && (ev.meta.reason === 'checkin' || !!ev.meta.parent_event_id); }
  function isDerivedFrom(ev, parent) { var p = isDerived(ev) ? parentOf(ev) : null; return !!p && p.id === parent.id; }
  /** When the server acknowledged the event (derived events inherit their parent's acknowledgement). */
  function deliveredAt(ev) {
    if (ev.received_at) return ev.received_at;
    if (isDerived(ev)) { var p = parentOf(ev); if (p && p.received_at) return p.received_at; }
    return null;
  }

  /* ================================================================== */
  /* JOURNEY (path + signal analysis)                                     */
  /* ================================================================== */
  function nodeList(graph) { return Object.keys(graph.nodes).map(function (id) { return graph.nodes[id]; }); }
  function nearestNode(nodes, p) {
    var best = null, bd = Infinity;
    nodes.forEach(function (n) { var d = U.haversineKm(n, p); if (d < bd) { bd = d; best = n; } });
    return best;
  }
  function fallbackWaypoints(graph, routeId) {
    var nodes = nodeList(graph);
    if (nodes.length < 2) return null;
    var r = routeMeta(routeId);
    var geom = r && r.geometry;
    var a, b;
    if (geom && geom.length > 1) {
      a = nearestNode(nodes, { lat: geom[0][0], lng: geom[0][1] });
      b = nearestNode(nodes, { lat: geom[geom.length - 1][0], lng: geom[geom.length - 1][1] });
    } else { a = nodes[0]; b = nodes[nodes.length - 1]; }
    if (a === b) {
      var far = null, fd = -1;
      nodes.forEach(function (n) { var d = U.haversineKm(n, a); if (d > fd) { fd = d; far = n; } });
      return [a.id, far.id, a.id];
    }
    return [a.id, b.id];
  }
  function legs(graph, wps) {
    var steps = [], ids = [];
    for (var i = 0; i < wps.length - 1; i++) {
      var p = NC.routing.astar(graph, wps[i], wps[i + 1], { strategy: 'shortest' });
      if (!p) return null;
      steps = steps.concat(p.steps);
      ids = ids.concat(i ? p.nodeIds.slice(1) : p.nodeIds);
    }
    return { nodeIds: ids, steps: steps };
  }
  function wholeRoutePath(graph, routeId) {
    var wps = PLANS[routeId];
    if (!wps || wps.some(function (id) { return !graph.nodes[id]; })) wps = fallbackWaypoints(graph, routeId);
    return wps ? legs(graph, wps) : null;
  }
  function nodeName(n) { return n ? ((lang() === 'en' && n.name_en) ? n.name_en : n.name) : ''; }

  /* kv 'map.last_route' written by MOD.02: {from, to, strategy, mode, route_id?} — from/to may be node ids,
     facility ids, 'me'/'gps', {lat,lng} or {id|node_id}. Unknown shapes → null (fallback to the whole route). */
  function resolvePoint(graph, x) {
    if (x === null || x === undefined) return null;
    if (typeof x === 'string') {
      if (graph.nodes[x]) return { nodeId: x, pt: { lat: graph.nodes[x].lat, lng: graph.nodes[x].lng }, name: nodeName(graph.nodes[x]) };
      if (/^(me|my|gps|current|here|pos|position|my_location|@me)$/i.test(x)) {
        var p = lastPos();
        return p ? { pt: { lat: p.lat, lng: p.lng }, name: t('bd.warn.src_saved') } : null;
      }
      var f = (graph.facilities || []).filter(function (y) { return y.id === x; })[0] || (graph.services || []).filter(function (y) { return y.id === x; })[0];
      return f ? { pt: { lat: f.lat, lng: f.lng }, name: f.name } : null;
    }
    if (typeof x === 'object') {
      if (isFinite(x.lat) && isFinite(x.lng) && x.lat !== null && x.lng !== null) return { pt: { lat: +x.lat, lng: +x.lng }, name: x.name || x.label || coordsText(x.lat, x.lng) };
      if (x.type === 'me' || x.kind === 'me' || x.type === 'gps') return resolvePoint(graph, 'me');
      var id = x.node_id || x.nodeId || x.facility_id || x.id;
      if (id) return resolvePoint(graph, String(id));
    }
    return null;
  }
  function planPath(graph, plan) {
    var a = resolvePoint(graph, plan.from === null || plan.from === undefined ? 'me' : plan.from), b = resolvePoint(graph, plan.to);
    if (!a || !b) return null;
    if (plan.from_label) a.name = plan.from_label;
    if (plan.to_label) b.name = plan.to_label;
    var strategy = plan.strategy === 'signal' ? 'signal' : 'shortest';
    var path = (a.nodeId && b.nodeId) ? NC.routing.astar(graph, a.nodeId, b.nodeId, { strategy: strategy })
      : NC.routing.routeBetween(graph, a.nodeId || a.pt, b.nodeId || b.pt, { strategy: strategy });
    if (!path || !path.steps || !path.steps.length) return null;
    path._from = a.name; path._to = b.name;
    return path;
  }
  function clustersOf(zones, gapKm) {
    var out = [];
    (zones || []).forEach(function (z) {
      var last = out[out.length - 1];
      if (last && z.start_km - last.end_km < gapKm) { last.end_km = z.end_km; last.zones.push(z); }
      else out.push({ key: 'z' + z.start_km.toFixed(3), start_km: z.start_km, end_km: z.end_km, zones: [z] });
    });
    return out;
  }
  function pathOptions() {
    var opts = [];
    if (st.plan) opts.push({ id: 'plan', label: t('bd.sim.path_plan') });
    seedRoutes().forEach(function (r) { opts.push({ id: 'route:' + r.id, label: t('bd.sim.path_route', { route: routeName(r.id) }) }); });
    return opts;
  }
  function defaultPathId() {
    if (st.prefs.path && (st.prefs.path !== 'plan' || st.plan)) return st.prefs.path;
    return st.plan ? 'plan' : 'route:' + curRoute();
  }

  /** Load pack(s) + build the analysis of the selected path. Cached by path id + carrier. */
  function ensureJourney(force) {
    var pid = defaultPathId();
    var carrier = curCarrier();
    var key = pid + '|' + carrier + (pid === 'plan' ? '|' + JSON.stringify(st.plan) : '');
    if (!force && st.journeyKey === key && (st.journey || st.building)) return st.building || Promise.resolve(st.journey);
    st.journeyKey = key;
    st.journeyErr = null;
    var planned = pid === 'plan' && st.plan;
    var rid = planned ? (st.plan.route_id || curRoute()) : pid.replace(/^route:/, '');
    var p = NC.data.getPack(rid, carrier).then(function (pack) {
      var graph = NC.routing.buildGraph([pack]);
      var path = null, from = null, to = null;
      var extra = Promise.resolve(null);
      if (planned) {
        path = planPath(graph, st.plan);
        if (!path) {
          // The plan may cross routes: try a graph over every available pack of this carrier.
          extra = Promise.all(seedRoutes().map(function (r) { return NC.data.getPack(r.id, carrier).catch(function () { return null; }); }))
            .then(function (packs) { var g2 = NC.routing.buildGraph(packs.filter(Boolean)); var p2 = planPath(g2, st.plan); return p2 ? { graph: g2, path: p2 } : null; });
        }
      }
      return extra.then(function (alt) {
        if (alt) { graph = alt.graph; path = alt.path; }
        if (path) { from = path._from; to = path._to; }
        if (!path) { planned = false; path = wholeRoutePath(graph, rid); }
        if (!path) throw new Error('no-path');
        var an = NC.routing.analyze(graph, path);
        var glen = NC.routing.lineLengthKm(an.geometry);
        var j = {
          key: key, id: planned ? 'plan' : 'route:' + rid, planned: !!planned, route_id: rid, carrier: carrier, from: from, to: to,
          analysis: an, graph: graph, scale: glen > 0 ? an.length_km / glen : 1,
          pack: { source: pack.source, version: pack.version, accuracy: pack.accuracy, model_version: pack.model_version },
          clusters: { motorbike: clustersOf(an.zones, NC.routing.THRESHOLDS.motorbike.km), hiking: clustersOf(an.zones, NC.routing.THRESHOLDS.hiking.km) }
        };
        if (st.journeyKey !== key) return st.journey;
        st.journey = j;
        st.building = null;
        onJourneyChanged();
        return j;
      });
    }).catch(function (e) {
      console.warn('[buddy] journey failed', e && e.message);
      if (st.journeyKey !== key) return st.journey;
      st.building = null;
      st.journeyErr = e;
      if (st.mounted) renderWarn();
      return null;
    });
    st.building = p;
    return p;
  }
  function onJourneyChanged() {
    var J = st.journey;
    if (!J) return;
    if (sim.pos > J.analysis.length_km) simReset(true);
    if (!st.prefs.mode) sim.mode = (routeMeta(J.route_id) || {}).travel_mode === 'hiking' ? 'hiking' : (setting('travel_mode', 'motorbike') === 'hiking' ? 'hiking' : 'motorbike');
    if (st.mounted) { renderWarn(); renderSimStatic(); renderLive(); }
  }

  function levelAt(an, km) {
    var parts = an.parts || [];
    for (var i = 0; i < parts.length; i++) if (km >= parts[i].from_km - 1e-9 && km < parts[i].to_km) return parts[i].level;
    return parts.length ? parts[parts.length - 1].level : 'uncertain';
  }
  function latLngAt(km) {
    var J = st.journey;
    if (!J) return null;
    var p = NC.routing.pointAt(J.analysis.geometry, km / (J.scale || 1));
    return p ? { lat: p[0], lng: p[1] } : null;
  }
  function clusterFor(km, mode) {
    var J = st.journey; if (!J) return null;
    var list = J.clusters[mode === 'hiking' ? 'hiking' : 'motorbike'];
    for (var i = 0; i < list.length; i++) if (km < list[i].end_km) return list[i];
    return null;
  }
  function clusterContaining(zoneStart, mode) {
    var J = st.journey; if (!J) return null;
    var list = J.clusters[mode === 'hiking' ? 'hiking' : 'motorbike'];
    for (var i = 0; i < list.length; i++) if (zoneStart >= list[i].start_km - 1e-6 && zoneStart <= list[i].end_km + 1e-6) return list[i];
    return null;
  }

  /* ================================================================== */
  /* LOOK-AHEAD (journey simulator; real trips: NC.trip)                  */
  /* ================================================================== */
  function speedsIn(samples, winMs) {
    if (!samples.length) return [];
    var last = samples[samples.length - 1].t;
    return samples.filter(function (s) { return s.t >= last - winMs && typeof s.speed_kmh === 'number'; }).map(function (s) { return s.speed_kmh; });
  }
  /**
   * Evaluate the position against the path: signal level + dead-zone look-ahead with the moving-average speed.
   * ctx: {source:'sim', samples, fallbackMode, warned, noWarn}
   */
  function evaluate(posKm, ctx) {
    var J = st.journey;
    if (!J) return null;
    var R = NC.routing;
    var avg = R.movingAverage(ctx.samples, 3);
    var recent = speedsIn(ctx.samples, 3 * 60000);
    var unstable = recent.length ? R.isSpeedUnstable(recent) : true;
    var detected = recent.length ? R.detectMode(recent, ctx.fallbackMode) : ctx.fallbackMode;
    var dz = R.deadzoneAhead(J.analysis, posKm, { speed_kmh: avg, mode: detected, unstable: unstable });
    // One speed for the ETA, the formula and the warning text: the measured moving average whenever it is valid
    // (distance basis only decides WHEN to warn), else the mode's default speed.
    var etaV = okSpeed(avg) ? avg : R.SPEEDS[dz.mode];
    if (dz.basis === 'distance' && dz.next && !dz.in_deadzone && dz.distance_km !== null) dz.minutes = dz.distance_km / etaV * 60;
    dz.speed_kmh = dz.basis === 'time' ? avg : etaV;
    dz.speed_default = dz.basis !== 'time' && !okSpeed(avg);
    var live = { pos: posKm, avg: avg, detected: detected, unstable: unstable, dz: dz, level: levelAt(J.analysis, posKm), source: ctx.source };
    if (!ctx.noWarn && dz.should_warn && dz.next && !dz.in_deadzone) {
      var c = clusterContaining(dz.next.start_km, detected);
      var key = c ? c.key : 'z' + dz.next.start_km.toFixed(3);
      if (!ctx.warned[key]) {
        ctx.warned[key] = true;
        simWarn(dz, live, c);
      }
    }
    return live;
  }

  /* ================================================================== */
  /* PRE-DEAD-ZONE REMINDER (simulator → NC.trip, round 2 R6)             */
  /* ================================================================== */
  /**
   * The simulated ride reached the reminder point of a dead-zone cluster: the same popup as a real trip (NC.trip:
   * SMS / share / later, 'pre_deadzone' check-in with an open session). The ride pauses while it is open.
   */
  function simWarn(dz, live, cluster) {
    var J = st.journey;
    var ll = latLngAt(live.pos);
    var info = {
      start_km: U.round(dz.next.start_km, 3), end_km: U.round((cluster ? cluster.end_km : dz.next.end_km), 3),
      length_km: U.round((cluster ? cluster.end_km - cluster.start_km : dz.next.length_km), 3),
      distance_km: U.round(dz.distance_km, 3), minutes: U.round(dz.minutes, 2), basis: dz.basis, mode: dz.mode,
      threshold: dz.threshold, speed_kmh: okSpeed(dz.speed_kmh) ? U.round(dz.speed_kmh, 1) : null, pos_km: U.round(live.pos, 3),
      lat: ll ? U.round(ll.lat, 6) : null, lng: ll ? U.round(ll.lng, 6) : null,
      route_id: J ? J.route_id : null, carrier: J ? J.carrier : null, source: live.source, at: new Date().toISOString()
    };
    sim.warnings.push(info);
    slog('warn', { distance_km: info.distance_km, minutes: info.minutes, basis: info.basis, mode: info.mode, zone_km: info.start_km });
    if (!NC.trip || typeof NC.trip.simAlert !== 'function') return;
    if (sim.playing) { simPause(true); sim.resumeAfterModal = true; }
    NC.trip.simAlert({
      key: 'sim:' + (cluster ? cluster.key : 'z' + info.start_km.toFixed(3)), zone_km: info.start_km, length_km: info.length_km,
      minutes: info.minutes, lat: info.lat, lng: info.lng, mode: info.mode, speed_kmh: info.speed_kmh || NC.routing.SPEEDS[info.mode],
      route_id: info.route_id
    }).catch(function (e) { console.warn('[buddy] sim reminder', e && e.message); }).then(function () {
      slog('warn_closed');
      if (sim.resumeAfterModal) { sim.resumeAfterModal = false; if (st.visible) simPlay(); }
    });
  }
  /** Next dead zone of the path (simulated position, else the saved one) for the demo reminder; null without one. */
  function demoInfo() {
    var J = st.journey;
    var live = sim.started ? sim.live : staticLive();
    if (!J || !live || !live.dz || !live.dz.next) return null;
    var mode = live.detected === 'hiking' ? 'hiking' : 'motorbike';
    var c = clusterContaining(live.dz.next.start_km, mode);
    var ll = latLngAt(live.pos);
    var th = NC.routing.THRESHOLDS[mode] || NC.routing.THRESHOLDS.motorbike;
    return { zone_km: U.round(live.dz.next.start_km, 3), length_km: U.round(c ? c.end_km - c.start_km : live.dz.next.length_km, 3),
      minutes: th.minutes, lat: ll ? U.round(ll.lat, 6) : null, lng: ll ? U.round(ll.lng, 6) : null, mode: mode, route_id: J.route_id };
  }
  /** "Mô phỏng: sắp vào vùng mất sóng" (Chế độ demo): the reminder popup right now; it survives navigation. */
  function demoAlert() {
    if (!NC.trip || typeof NC.trip.demoAlert !== 'function') { toast(t('bd.demo.na'), { type: 'warning' }); return Promise.resolve(null); }
    slog('demo_alert');
    return NC.trip.demoAlert(demoInfo());
  }
  /**
   * The TripPlan MOD.02 saved with the last route (kv 'map.last_route'.plan, contract C2) when a Buddy start may carry
   * it: same pilot route as the session (or an online route without one) and planned within the last 24 h.
   */
  function usableTripPlan(routeId) {
    var p = st.tripPlan;
    if (!p || !Array.isArray(p.geometry) || p.geometry.length < 2) return null;
    if (p.route_id && routeId && p.route_id !== routeId) return null;
    var at = Date.parse(p.created_at || '');
    if (!isFinite(at) || Date.now() - at > 24 * 3600000) return null;
    return p;
  }

  /* ---------------- the active trip (NC.trip) in the warning card ---------------- */
  function activeTrip() { return NC.trip && NC.trip.current ? NC.trip.current() : null; }
  /** An active trip (simulator idle) replaces the static next-dead-zone estimate: one source of truth on screen. */
  function tripShown() { return !!activeTrip() && !sim.started; }
  function warnPathText(J) {
    var tr = tripShown() ? activeTrip() : null;
    if (tr) return t('bd.warn.path_plan', { from: tr.from_label || '?', to: tr.to_label || '?', carrier: carrierName(tr.carrier || curCarrier()) });
    if (!J) return '';
    return J.planned ? t('bd.warn.path_plan', { from: J.from || '?', to: J.to || '?', carrier: carrierName(J.carrier) })
      : t('bd.warn.path_route', { route: routeName(J.route_id), carrier: carrierName(J.carrier) });
  }
  function renderTrip() {
    var el = st.el.trip;
    if (!el) return;
    var tr = activeTrip();
    if (st.el.warnBody) st.el.warnBody.hidden = tripShown();
    if (st.el.warnPath && (tr || st.journey)) setText(st.el.warnPath, warnPathText(st.journey));
    var html;
    if (!tr) {
      html = '<p class="bd-trip__text">' + icon('route', 'icon--sm') + '<span>' + esc(t('bd.trip.off')) + '</span></p>' +
        '<button type="button" class="btn btn--soft btn--sm" data-bd="open-map">' + icon('map') + '<span>' + esc(t('bd.trip.open_map')) + '</span></button>';
    } else {
      var next = (tr.alerts || []).filter(function (a) { return a.status === 'pending' || a.status === 'due'; })[0];
      // the card subtitle (warnPath) already names from → to while the trip is shown: say each thing once
      var pathShown = !!st.el.warnPath && tripShown();
      var title = !pathShown && tr.from_label && tr.to_label ? t('bd.trip.on', { from: tr.from_label, to: tr.to_label }) : t('bd.trip.on_plain');
      var line = !next ? t('bd.trip.none_left') : next.status === 'due' ? t('bd.trip.next_now', { km: kmAt(next.zone_km), len: U.fmtKm(next.length_km) })
        : t('bd.trip.next', { time: U.fmtTime(next.fire_at), km: kmAt(next.zone_km), len: U.fmtKm(next.length_km) });
      html = '<p class="bd-trip__title">' + icon('route', 'icon--sm') + '<span>' + esc(title) + '</span></p>' +
        '<p class="bd-trip__text"><span>' + esc(line + ' ' + t('bd.trip.ends', { time: U.fmtTime(tr.ends_at) })) + '</span></p>' +
        '<button type="button" class="btn btn--outline btn--sm" data-bd="trip-stop">' + icon('flag') + '<span>' + esc(t('bd.trip.stop')) + '</span></button>';
    }
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.classList.toggle('is-on', !!tr);
  }
  /** "Thông báo hệ thống": the browser permission + NC.trip's own switch (a granted permission cannot be revoked here). */
  function renderNotify() {
    var el = st.el;
    if (!el.pNotify) return;
    var has = 'Notification' in window;
    var tp = NC.trip && NC.trip.prefs ? NC.trip.prefs() : { notify: true };
    el.pNotify.disabled = !has;
    el.pNotify.checked = !!(has && tp.notify !== false && Notification.permission === 'granted');
    setText(el.pNotifyHint, has ? (Notification.permission === 'denied' ? t('bd.warn.notify_denied') : t('bd.warn.notify_hint')) : t('bd.warn.notify_unsupported'));
  }

  function smsAction() { return st.session ? { label: t('bd.hero.sms'), onClick: function () { openSms(); } } : undefined; }

  /* ================================================================== */
  /* ACTIONS                                                              */
  /* ================================================================== */
  function posForEvent() {
    if (sim.started && st.journey) { var ll = latLngAt(sim.pos); if (ll) return ll; }
    return lastPos();
  }
  /** "Tôi ổn" check-in (re-arms the timer; resolves overdue/alerted). */
  function checkin(o) {
    var p = (o && o.position) || posForEvent();
    return NC.data.buddy.checkin({ kind: 'checkin', lat: p ? p.lat : null, lng: p ? p.lng : null, note: o && o.note ? o.note : null }).then(function (ev) {
      vib([40, 60, 40]);
      return NC.data.buddy.current().then(function (s) {
        var due = s ? U.fmtTime(s.next_due_at) : '–';
        toast(t(online() ? 'bd.hero.checked' : 'bd.hero.checked_offline', { time: due }), { type: 'success', timeout: 3500 });
        refreshSoon();
        return ev;
      });
    });
  }
  function sendLocation() {
    var p = posForEvent();
    if (!p) toast(t('bd.loc.none'), { type: 'warning' });
    return NC.data.buddy.checkin({ kind: 'location', lat: p ? p.lat : null, lng: p ? p.lng : null, meta: { source: 'manual' } }).then(function (ev) {
      vib(30);
      // "Đã ghi vị trí lên máy chủ" — never "đã gửi cho người thân": a location check-in notifies nobody by itself.
      toast(online() ? t('bd.loc.sent') : t('bd.loc.queued'), { type: online() ? 'success' : 'warning', timeout: 6000, action: smsAction() });
      return ev;
    });
  }

  /**
   * SOS with location (emergency sheet + this screen). Rejects with Error('no-buddy') without an open session
   * so the emergency sheet shows its "call 115" fallback. opts: {confirmed, position, source}.
   */
  function sos(opts) {
    var o = opts || {};
    return NC.data.buddy.current().then(function (s) {
      if (!s) {
        if (o.source !== 'emergency') toast(t('bd.sos.no_session'), { type: 'danger', timeout: 7000, action: { label: t('common.call_115'), onClick: function () { NC.ui.callNumber('115'); } } });
        var e = new Error('no-buddy'); e.code = 'no_session';
        throw e;
      }
      var ok = o.confirmed ? Promise.resolve(true) : NC.ui.confirm(sosConfirmOpts(s));
      return ok.then(function (yes) {
        if (!yes) return null;
        st.lastSosAt = Date.now();
        var p = o.position || posForEvent();
        return NC.data.buddy.checkin({
          kind: 'sos', lat: p ? p.lat : null, lng: p ? p.lng : null, accuracy_m: p && p.accuracy_m ? p.accuracy_m : null,
          note: 'SOS · ' + (o.source || 'buddy'), meta: { source: o.source || 'buddy' }
        }).then(function (ev) {
          U.vibrate([90, 60, 90, 60, 250]);
          var prob = syncProblem(s);
          var simNote = emailSimNote(s);
          if (!s.recipient_email || prob) {
            toast(t(!s.recipient_email ? 'bd.sos.sent_noemail' : 'bd.sos.sent_noalert'), { type: 'danger', timeout: 12000, action: { label: t('bd.overdue.sms'), onClick: function () { openSms(); } } });
          } else if (simNote) {
            // Local build / demo address, online or queued: the e-mail is only simulated — never "sẽ tự gửi".
            var simT = toast(t(online() ? 'bd.sos.sent_sim' : 'bd.sos.queued_sim', { sim: simNote }), { type: 'warning', timeout: 12000, action: { label: t('bd.overdue.sms'), onClick: function () { openSms(); } } });
            if (!online()) st.overdueToast = simT; // stale once the queued SOS reaches the server (flushDeliveredToast closes it)
          } else if (online()) {
            toast(t('bd.sos.sent', { name: recipientName(s) }), { type: 'success', timeout: 6000 });
          } else {
            // Queued until signal; a plain SMS often still gets through — offer it.
            st.overdueToast = toast(t('bd.sos.queued'), { type: 'warning', timeout: 9000, action: { label: t('bd.overdue.sms'), onClick: function () { openSms(); } } });
          }
          refreshSoon();
          return ev;
        });
      });
    });
  }
  /**
   * The SOS confirm dialog, honest per session: no e-mail / server refusal → the server alerts nobody (the SMS is the
   * channel); local build or demo address → the e-mail is only simulated; otherwise the server e-mails the contact.
   * Offline adds that the SOS waits in the queue.
   */
  function sosConfirmOpts(s) {
    var sim = s && s.recipient_email ? emailSimNote(s) : null;
    var key = !s || !s.recipient_email ? 'bd.sos.confirm_msg_noemail' : syncProblem(s) ? 'bd.sos.confirm_msg_noalert'
      : sim ? 'bd.sos.confirm_msg_sim' : 'bd.sos.confirm_msg';
    var real = key === 'bd.sos.confirm_msg';
    var msg = t(key, { sim: sim || '' });
    if (!online()) msg += ' ' + t('bd.sos.confirm_offline');
    return {
      title: t(real ? 'bd.sos.confirm_title' : 'bd.sos.confirm_title_rec'), message: msg,
      confirmLabel: t(real ? 'bd.sos.confirm_btn' : 'bd.sos.confirm_btn_rec'), danger: true
    };
  }

  function openSms() {
    var s = st.session;
    if (!s) return;
    var p = posForEvent() || (s.last_lat !== null && s.last_lat !== undefined ? { lat: s.last_lat, lng: s.last_lng, at: s.last_location_at } : null);
    var coords = p ? coordsText(p.lat, p.lng) : '?';
    var map = p ? 'https://maps.google.com/?q=' + (+p.lat).toFixed(5) + ',' + (+p.lng).toFixed(5) : '';
    var body = t('bd.sms.body', {
      name: s.traveler_name || 'NomadCare', coords: coords, time: p && saneAt(p.at) ? U.fmtDateTime(saneAt(p.at)) : t('bd.sms.time_unknown'), map: map,
      route: routeName(s.route_id) + ' · ' + modeLabel(s.travel_mode)
    });
    var np = normPhone(s.recipient_phone);
    var phone = np.e164 ? np.display : String(s.recipient_phone || '');
    var f = NC.ui.formatPhoneAction(phone);
    var dial = np.e164 ? np.e164 : phone.replace(/[^\d+]/g, '');
    if (dial.replace(/\D/g, '').length < 8) { phone = ''; dial = ''; } // legacy unvalidated value ('abc') → copy-only
    var wrap = h('div', { class: 'bd-sms' });
    wrap.innerHTML =
      '<p class="bd-sms__sub">' + esc(t('bd.sms.sub')) + '</p>' +
      (phone ? '<p class="bd-sms__to">' + icon('phone', 'icon--sm') + '<span>' + esc(t('bd.sms.to', { phone: phone })) + '</span></p>' : '') +
      '<pre class="bd-sms__body" translate="no">' + esc(body) + '</pre>' +
      (f.isDemo ? '<p class="bd-sms__note">' + icon('info', 'icon--sm') + '<span>' + esc(t('bd.sms.demo')) + '</span></p>' : '') +
      (!phone ? '<p class="bd-sms__note">' + icon('info', 'icon--sm') + '<span>' + esc(t('bd.sms.no_phone')) + '</span></p>' : '');
    var actions = [{ label: t('common.copy'), variant: 'ghost', icon: 'copy', close: false, onClick: function () { U.copyText(body).then(function (ok) { if (ok) toast(t('common.copied'), { type: 'success', timeout: 1800 }); }); return false; } }];
    if (phone && !f.isDemo) {
      actions.push({ label: t('bd.sms.open'), variant: 'primary', icon: 'message-square', onClick: function () {
        var a = document.createElement('a');
        // 'sms:<n>?&body=' prefills the text on iOS and Android alike (same form as emergency.js / settings.js).
        a.href = 'sms:' + dial + '?&body=' + encodeURIComponent(body);
        a.style.display = 'none'; document.body.appendChild(a); a.click();
        setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
        toast(t('bd.sms.opened'), { type: 'info', timeout: 5000 });   // "Đã mở ứng dụng SMS" — never "đã gửi"
      } });
    }
    NC.ui.sheet({ title: t('bd.sms.title'), icon: 'message-square', iconVariant: 'primary', body: wrap, actions: actions, className: 'bd-sms-sheet' });
  }

  /**
   * "Thiết lập lại" (the server cannot alert for this session) / "Thêm email" (phone-only session): end the session,
   * then reopen the setup form prefilled from it (focus on the e-mail field for addEmail).
   */
  function restartSetup(addEmail) {
    var s = st.session;
    if (!s) { focusSection('setup'); return Promise.resolve(null); }
    var ask = addEmail ? { title: t('bd.hero.add_email'), message: t('bd.add_email.msg'), confirmLabel: t('bd.hero.add_email'), danger: false }
      : { title: t('bd.err.restart'), message: t('bd.stop_msg'), confirmLabel: t('bd.err.restart'), danger: true };
    return NC.ui.confirm(ask).then(function (ok) {
      if (!ok) return null;
      st.prefill = s;
      st.prefillFocus = addEmail ? 'email' : null;
      return NC.data.buddy.stop().then(function () {
        if (sim.holding) releaseHold('stopped');
        st.opErr = null;
        return refresh();
      }).then(function () { focusSection('setup'); });
    });
  }

  function stopSession() {
    return NC.ui.confirm({ title: t('bd.stop_title'), message: t('bd.stop_msg'), confirmLabel: t('bd.stop'), danger: true }).then(function (ok) {
      if (!ok) return null;
      return NC.data.buddy.stop().then(function () {
        if (sim.holding) releaseHold('stopped');
        toast(t('bd.stopped'), { type: 'info' });
        refreshSoon();
      });
    });
  }

  /* ================================================================== */
  /* SIMULATOR ENGINE                                                     */
  /* ================================================================== */
  function simEnsureTimer() {
    if (sim.timer) return;
    sim.lastTs = perfNow();
    sim.timer = setInterval(simStep, STEP_MS);
  }
  function simStopTimer() { if (sim.timer) { clearInterval(sim.timer); sim.timer = null; } }

  function simPlay() {
    var J = st.journey;
    if (!J) { ensureJourney().then(function (j) { if (j) simPlay(); }); return; }
    if (sim.finished || sim.pos >= J.analysis.length_km - 1e-6) simReset(true);
    var lead = sim.started ? null : leadInKm(J);
    sim.playing = true; sim.started = true; sim.finished = false;
    slog('play', { speedX: sim.speedX, mode: sim.mode, path: J.id, carrier: J.carrier });
    if (lead !== null) {
      sim.pos = lead;
      slog('lead_in', { to_km: U.round(lead, 2) });
      toast(t('bd.sim.lead_in', { km: kmAt(lead) }), { type: 'info', timeout: 7000 });
    }
    if (!sim.inLost) syncLevel(true);
    simEnsureTimer();
    renderLive();
    if (st.mounted) renderTrip();   // the simulator's estimate is shown again while it runs
  }
  /**
   * Pause. A user pause (not the silent pause behind the warning modal) hands connectivity back: a frozen simulation
   * must never keep the whole app offline. Resume re-applies the coverage at the current km.
   */
  function simPause(silent) {
    if (!sim.playing) return;
    sim.playing = false;
    if (!silent) {
      slog('pause');
      if (sim.netOwned) { releaseNet(true); sim.inLost = false; }
    }
    saveSimPosition();
    renderLive();
  }
  function simReset(keepLog) {
    sim.playing = false; sim.finished = false; sim.pos = 0; sim.simMs = 0; sim.samples = []; sim.noise = 0; sim.speed = 0;
    sim.warned = {}; sim.warnings = []; sim.heldKeys = {}; sim.holding = false; sim.holdKey = null; sim.holdFiredAt = 0;
    sim.lastPingMs = 0; sim.lastSaveMs = 0; sim.started = false; sim.live = null; sim.resumeAfterModal = false;
    sim.lostPinged = {}; sim.lostEnd = null; sim.lostUntil = 0; sim.slowX = null;
    if (sim.inLost) { sim.inLost = false; }
    restoreNet();
    forceReleaseNet();
    if (!keepLog) sim.log = [];
    simStopTimer();
    if (st.mounted) { renderLive(); renderTrip(); }
  }
  function restoreNet() { releaseNet(true); }

  /* ---- Simulated network ownership (FIX_CONTRACT A8) ----
     The simulator only ever switches simulated offline ON when it was off, marks it owner 'simulator' + quiet (its own
     map pill reports the state, so clustered zones do not spam the shell's lost/back toasts), and switches it OFF again
     on zone exit, pause, reset, leaving the screen, page hide — and at the next boot (a reload ends any simulation). */
  function netOwnerApi() { return !!(NC.net && typeof NC.net.simulatedOwner === 'function'); }
  function netSimSet(v) {
    if (!NC.net) return;
    sim.netWriting = true;
    try {
      if (netOwnerApi()) NC.net.setSimulated(v, { owner: 'simulator', quiet: true });
      else {
        NC.net.setSimulated(v, { quiet: true });
        if (NC.settings) NC.settings.set(SIM_NET_FLAG, !!v); // fallback marker so a reload can undo it (see recoverSimNet)
      }
    } finally { sim.netWriting = false; }
  }
  function takeNet() {
    if (!st.prefs.autoNet || !NC.net || sim.netOwned) return;
    if (NC.net.simulated()) return; // the user already simulates offline: theirs to switch off
    sim.netOwned = true;
    netSimSet(true);
  }
  function releaseNet(flush) {
    if (!sim.netOwned) return;
    sim.netOwned = false;
    if (!NC.net) return;
    var ours = !netOwnerApi() || NC.net.simulatedOwner() === 'simulator';
    if (NC.net.simulated() && ours) {
      netSimSet(false);
      if (flush !== false) setTimeout(function () { if (NC.data && online()) NC.data.flush().catch(function () { }); }, 700);
    } else if (!netOwnerApi() && NC.settings && NC.settings.get(SIM_NET_FLAG)) NC.settings.set(SIM_NET_FLAG, false);
  }
  /**
   * "Đặt lại mô phỏng" always hands connectivity back: also a simulator-owned offline this page does not track
   * (left by another tab or an earlier page). A user-owned simulation is never touched.
   */
  function forceReleaseNet() {
    if (!NC.net || !NC.net.simulated()) return;
    var stale = netOwnerApi() ? NC.net.simulatedOwner() === 'simulator' : !!(NC.settings && NC.settings.get(SIM_NET_FLAG));
    if (!stale) return;
    slog('net_force_release', { owner_api: netOwnerApi() });
    netSimSet(false);
    setTimeout(function () { if (NC.data && online()) NC.data.flush().catch(function () { }); }, 700);
  }
  /** Boot: a simulator-owned simulated offline left over from the previous page (reload / crash) is switched off. */
  function recoverSimNet() {
    if (!NC.net || !NC.settings || sim.netOwned) return;
    var flag = !!NC.settings.get(SIM_NET_FLAG);
    if (flag) NC.settings.set(SIM_NET_FLAG, false);
    // Owner-aware NC.net: boot.js runs NC.net.resetStaleSimulation() (it knows whether another live tab still owns the
    // simulation) and toasts once — nothing to do here.
    if (typeof NC.net.resetStaleSimulation === 'function') return;
    var stale = netOwnerApi() ? NC.net.simulated() && NC.net.simulatedOwner() === 'simulator' : flag && NC.net.simulated();
    if (!stale) return;
    slog('net_recovered', { owner_api: netOwnerApi() });
    if (netOwnerApi()) NC.net.setSimulated(false, { owner: 'simulator', quiet: true });
    else NC.net.setSimulated(false, { quiet: true });
    toast(t('bd.sim.net_restored'), { type: 'info', timeout: 5000 });
  }
  function simSeek(km) {
    var J = st.journey; if (!J) return;
    var len = J.analysis.length_km;
    sim.pos = U.clamp(km, 0, Math.max(0, len - 0.001));
    var wasStarted = sim.started;
    sim.started = true; sim.finished = false;
    if (!wasStarted && st.mounted) renderTrip();
    // Warnings/holds for zones ahead of the new position may fire again.
    Object.keys(sim.warned).forEach(function (k) { if (+k.slice(1) > sim.pos) delete sim.warned[k]; });
    Object.keys(sim.heldKeys).forEach(function (k) { if (+k.slice(1) > sim.pos) delete sim.heldKeys[k]; });
    Object.keys(sim.lostPinged).forEach(function (k) { if (+k.slice(1) > sim.pos) delete sim.lostPinged[k]; });
    sim.samples = [];
    slog('seek', { to_km: U.round(sim.pos, 2) });
    syncLevel(false);
    if (sim.inLost) { var z = lostZoneAt(sim.pos); sim.lostEnd = z ? z.end_km : null; sim.lostUntil = perfNow() + MIN_LOST_MS; }
    sim.live = evaluate(sim.pos, simCtx());
    if (sim.holding && levelAt(J.analysis, sim.pos) !== 'lost') releaseHold('seek');
    saveSimPosition();
    renderLive();
  }
  /** Jump to just before the next dead-zone cluster: threshold distance + a margin so the warning fires in a few seconds. */
  function simSkip() {
    var J = st.journey; if (!J) return;
    var mode = sim.mode;
    var th = NC.routing.THRESHOLDS[mode];
    var thKm = Math.max(th.km, th.minutes / 60 * NC.routing.SPEEDS[mode]);
    var margin = mode === 'hiking' ? 0.35 : 1.5;
    var list = J.clusters[mode === 'hiking' ? 'hiking' : 'motorbike'];
    var target = null;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.start_km - thKm - 0.05 > sim.pos) { target = c; break; }
    }
    if (!target) { toast(t('bd.sim.no_zone'), { type: 'info' }); return; }
    delete sim.warned[target.key];
    delete sim.heldKeys[target.key];
    simSeek(Math.max(sim.pos, target.start_km - thKm - margin));
    if (!sim.playing) simPlay();
  }
  function simCtx() { return { source: 'sim', samples: sim.samples, fallbackMode: sim.mode, warned: sim.warned }; }
  /**
   * Where "Chạy" from km 0 starts with an open Buddy session. The ride starts at km 0 unless the first dead zone lies so
   * far ahead that the check-in deadline would pass first (the alert would go out online, before any warning), or —
   * on the 2-min demo schedule — the first warning is more than LEAD_MAX_MS of real time away. Then it starts just
   * before that zone (same spot as "Tới gần vùng mất sóng"). @returns {number|null} km, null = start at km 0
   */
  function leadInKm(J) {
    var s = st.session;
    if (!s || s.status !== 'active' || sim.pos > 0.001) return null;
    var mode = sim.mode === 'hiking' ? 'hiking' : 'motorbike';
    var R = NC.routing, v = R.SPEEDS[mode] || 25;
    var thKm = Math.max(R.THRESHOLDS[mode].km, R.THRESHOLDS[mode].minutes / 60 * v);
    var margin = mode === 'hiking' ? 0.35 : 1.5;
    var first = null;
    (J.clusters[mode] || []).forEach(function (c) { if (!first && c.start_km - thKm - margin > 0.05) first = c; });
    if (!first) return null;
    var etaMs = (first.start_km - thKm) / v * 3600000 / (sim.speedX || 60);
    if (etaMs <= LEAD_MAX_MS) return null;
    var leftMs = s.next_due_at ? Date.parse(s.next_due_at) + (s.grace_min || 0) * 60000 - Date.now() : Infinity;
    var demo = s.interval_min <= DEMO_INTERVAL;
    if (!demo && etaMs + LEAD_BUFFER_MS < leftMs) return null;
    return first.start_km - thKm - margin;
  }
  /** The contiguous lost stretch containing km (analysis.zones), or null. */
  function lostZoneAt(km) {
    var J = st.journey; if (!J) return null;
    var zs = J.analysis.zones || [];
    for (var i = 0; i < zs.length; i++) if (km >= zs[i].start_km - 1e-6 && km < zs[i].end_km) return zs[i];
    return null;
  }

  /* Network follows the coverage layer: entering 'lost' → simulated offline, leaving → online (queue flushes). */
  function syncLevel(initial) {
    var J = st.journey; if (!J) return;
    var lvl = levelAt(J.analysis, sim.pos);
    if (lvl === 'lost' && !sim.inLost) enterLost(initial);
    else if (lvl !== 'lost' && sim.inLost) exitLost();
  }
  function enterLost() {
    sim.inLost = true;
    var c = clusterFor(sim.pos, sim.mode);
    slog('enter_lost', { zone_km: c ? U.round(c.start_km, 2) : null });
    takeNet();
    // Dwell: the stretch stays on screen ≥ MIN_LOST_MS (simStep slows the ride down inside it) so the offline switch,
    // the queue and the flush on exit are visible even for a 300 m stretch at ×60.
    var z = lostZoneAt(sim.pos);
    sim.lostEnd = z ? z.end_km : null;
    sim.lostUntil = perfNow() + MIN_LOST_MS;
    var s = st.session;
    var key = c ? c.key : 'z' + sim.pos.toFixed(3);
    // First lost stretch of each cluster: the position at the signal loss is logged → it waits in the outbox (offline)
    // and goes out with the rest of the queue when signal returns.
    if (s && s.status !== 'closed' && !online() && !sim.lostPinged[key]) {
      sim.lostPinged[key] = true;
      var ll = latLngAt(sim.pos);
      if (ll) {
        sim.lastPingMs = sim.simMs;
        slog('ping', { level: 'lost', trigger: 'signal_lost' });
        NC.data.buddy.checkin({ kind: 'location', lat: U.round(ll.lat, 6), lng: U.round(ll.lng, 6), meta: { source: 'simulator', km: U.round(sim.pos, 2), level: 'lost', trigger: 'signal_lost' } }).catch(function () { });
      }
    }
    var leftMs = s && s.next_due_at ? Date.parse(s.next_due_at) + (s.grace_min || 0) * 60000 - Date.now() : Infinity;
    if (st.prefs.hold && s && s.status === 'active' && !sim.heldKeys[key] && leftMs <= HOLD_MAX_WAIT_MS) {
      sim.holding = true; sim.holdKey = key; sim.heldKeys[key] = true; sim.holdFiredAt = 0;
      slog('hold_start', { due_at: s.next_due_at, grace_min: s.grace_min });
    }
  }
  function exitLost() {
    sim.inLost = false;
    sim.lostEnd = null; sim.lostUntil = 0; sim.slowX = null;
    slog('exit_lost');
    releaseNet(true); // queued events → the delivery toast (bd.deliver.toast) reports the reconnection
  }
  function releaseHold(reason) {
    if (!sim.holding) return;
    sim.holding = false; sim.holdKey = null; sim.holdFiredAt = 0;
    slog('hold_end', { reason: reason });
    renderLive();
  }

  function simStep() {
    var now = perfNow();
    var dt = Math.min(1000, Math.max(0, now - sim.lastTs));
    sim.lastTs = now;
    var J = st.journey;
    if (!sim.playing || !J) { if (!sim.playing && !sim.holding) simStopTimer(); return; }
    var len = J.analysis.length_km;
    var base = NC.routing.SPEEDS[sim.mode] || 25;
    // Inside a lost stretch the journey clock slows down so the stretch lasts ≥ MIN_LOST_MS of real time (dwell).
    var effX = sim.speedX;
    sim.slowX = null;
    if (sim.inLost && !sim.holding && sim.lostEnd !== null) {
      var leftKm = sim.lostEnd - sim.pos, leftReal = sim.lostUntil - now;
      if (leftKm > 0 && leftReal > 0) {
        var needX = leftKm / base * 3600000 / leftReal;
        if (needX < effX) { effX = Math.max(1, needX); sim.slowX = effX; }
      }
    }
    var dtSim = dt * effX;
    sim.simMs += dtSim;
    sim.noise = U.clamp(sim.noise * 0.92 + (Math.random() - 0.5) * 0.05, -0.12, 0.12);
    // Hold: stuck inside the dead zone (speed 0) until the dead-man switch fired, then move on.
    if (sim.holding) {
      var s = st.session;
      if (!s || s.status === 'closed') releaseHold('no_session');
      else if (s.status !== 'active') {
        if (!sim.holdFiredAt) { sim.holdFiredAt = Date.now(); slog('hold_fired', { status: s.status }); }
        else if (Date.now() - sim.holdFiredAt >= HOLD_RELEASE_MS) releaseHold('overdue');
      }
    }
    var v = sim.holding ? 0 : base * (1 + sim.noise);
    sim.speed = v;
    if (!sim.holding) sim.pos = Math.min(len, sim.pos + v * dtSim / 3600000);
    sim.samples.push({ t: sim.simMs, speed_kmh: v });
    while (sim.samples.length && sim.samples[0].t < sim.simMs - 10 * 60000) sim.samples.shift();
    syncLevel(false);
    sim.live = evaluate(sim.pos, simCtx());
    // Automatic location pings every 30 simulated minutes (queued while offline).
    if (st.session && sim.simMs - sim.lastPingMs >= PING_EVERY_MIN * 60000) {
      sim.lastPingMs = sim.simMs;
      var ll = latLngAt(sim.pos);
      if (ll) {
        var lvl = levelAt(J.analysis, sim.pos);
        slog('ping', { level: lvl });
        NC.data.buddy.checkin({ kind: 'location', lat: U.round(ll.lat, 6), lng: U.round(ll.lng, 6), meta: { source: 'simulator', km: U.round(sim.pos, 2), level: lvl } }).catch(function () { });
      }
    }
    if (Date.now() - sim.lastSaveMs > 15000) saveSimPosition();
    if (sim.pos >= len - 1e-6) {
      sim.playing = false; sim.finished = true;
      slog('finish');
      if (sim.inLost) exitLost();
      restoreNet();
      saveSimPosition();
      toast(t('bd.sim.done'), { type: 'info', timeout: 2500 });
    }
    renderLive();
  }
  function saveSimPosition() {
    if (!sim.started || !st.journey || !NC.settings) return;
    var ll = latLngAt(sim.pos);
    if (!ll) return;
    sim.lastSaveMs = Date.now();
    NC.settings.set('last_position', { lat: U.round(ll.lat, 6), lng: U.round(ll.lng, 6), at: new Date().toISOString(), source: 'sim' });
  }

  /* ================================================================== */
  /* TICKER (countdown, local overdue check)                              */
  /* ================================================================== */
  function ensureTicker() {
    var need = !!st.session || sim.holding;
    if (need && !st.tickTimer) st.tickTimer = setInterval(tick, 1000);
    else if (!need && st.tickTimer) { clearInterval(st.tickTimer); st.tickTimer = null; }
  }
  function tick() {
    var s = st.session;
    if (s && s.status === 'active' && s.next_due_at) {
      var end = Date.parse(s.next_due_at) + (s.grace_min || 0) * 60000;
      // The data layer checks every 10 s; nudge it as soon as the grace period is over.
      if (Date.now() > end && Date.now() - st.lastTickCall > 1500) {
        st.lastTickCall = Date.now();
        NC.data.buddy.tick().then(function (r) { if (r) refreshSoon(); }).catch(function () { });
      }
    }
    if (st.visible) { tickHero(); if (sim.holding) renderHold(); }
  }

  /* ================================================================== */
  /* RENDER — root state                                                  */
  /* ================================================================== */
  /** True when the open session left 'active' because of an SOS (not a missed check-in). */
  function sosCaused(s) {
    if (!s) return false;
    if (s.alert_reason === 'sos') return true;      // FIX_CONTRACT A4 (server + data layer)
    if (s.alert_reason === 'overdue' || s.alert_reason === 'contact_lost') return false;
    var last = null;
    st.events.forEach(function (e) {
      if (e.session_id === s.id && ['sos', 'overdue', 'checkin', 'resolved', 'start'].indexOf(e.kind) >= 0 && (!last || String(e.client_ts) >= String(last.client_ts))) last = e;
    });
    return !!(last && last.kind === 'sos') || (Date.now() - st.lastSosAt < 15000);
  }
  /**
   * Phase of a Buddy session at `now` (epoch ms, default Date.now()) — PURE, the single source for the Buddy screen and
   * Home (NC.buddy.phaseOf): 'none' (no open session) · 'active' · 'soon' (≤ min(15 min, interval ÷ 4) before the
   * check-in is due) · 'grace' (due passed, still in the extra wait; status still 'active') · 'overdue' (status
   * 'overdue': missed check-in, SOS or contact_lost — see alert_reason) · 'alerted' (status 'alerted').
   */
  function phaseOf(s, now) {
    if (!s || s.status === 'closed') return 'none';
    if (s.status === 'alerted') return 'alerted';
    if (s.status === 'overdue') return 'overdue';
    if (typeof now !== 'number' || !isFinite(now)) now = Date.now();
    var due = Date.parse(s.next_due_at);
    if (!isFinite(due)) return 'active';
    if (now >= due) return 'grace';
    var soonMs = Math.min(15, (+s.interval_min || 60) / 4) * 60000;
    return due - now <= soonMs ? 'soon' : 'active';
  }
  /** Colour tone of each phase on the Buddy screen (teal = primary, orange = accent, red = danger). */
  var PHASE_TONE = { none: 'neutral', active: 'primary', soon: 'accent', grace: 'accent', overdue: 'danger', alerted: 'danger' };
  /**
   * Ring of the status intro (also NC.buddy.statusOf for Home): value 0..1, the big count, its caption and the title.
   * SOS / contact_lost aware (reads the event log when the session lacks alert_reason).
   */
  function ringModel(s, ph, now) {
    var due = Date.parse(s.next_due_at);
    var graceMs = (s.grace_min || 0) * 60000;
    var sim = s.recipient_email ? emailSimNote(s) : null;
    if (ph === 'active' || ph === 'soon') {
      return { value: U.clamp((due - now) / ((+s.interval_min || 60) * 60000), 0, 1), count: fmtCountdown(due - now), sub: t('bd.ring.until'),
        title: t('bd.hero.next', { time: U.fmtTime(s.next_due_at) }) };
    }
    if (ph === 'grace') {
      return { value: graceMs ? U.clamp((due + graceMs - now) / graceMs, 0, 1) : 0, count: fmtCountdown(due + graceMs - now), sub: t('bd.ring.grace'),
        title: t('bd.hero.due_passed', { time: U.fmtTime(s.next_due_at) }) };
    }
    if (ph === 'overdue') {
      var bySos = sosCaused(s);
      // contact_lost (round 2 R6): the check-in is not due yet — the ring shows when the server noticed the silence
      var lost = !bySos && s.alert_reason === 'contact_lost';
      return { value: 1, sos: bySos, lost: lost,
        count: bySos ? 'SOS' : lost ? U.fmtTime(lostAt(s)) : '+' + fmtCountdown(Math.max(0, now - due - graceMs)),
        sub: bySos ? U.fmtTime(s.last_location_at || new Date()) : t(lost ? 'bd.ring.lost' : 'bd.ring.overdue'),
        title: t(bySos ? 'bd.hero.sos_title' : lost ? 'bd.hero.lost_title' : 'bd.hero.overdue_title') };
    }
    var sosAlert = sosCaused(s);
    var lostA = !sosAlert && s.alert_reason === 'contact_lost';
    return { value: 1, sos: sosAlert, lost: lostA,
      count: sosAlert ? 'SOS' : U.fmtTime(s.alerted_at), sub: sosAlert ? U.fmtTime(s.alerted_at) : t(sim ? 'bd.ring.alerted_sim' : 'bd.ring.alerted'),
      title: t(sosAlert ? (sim ? 'bd.hero.sos_alerted_title_sim' : 'bd.hero.sos_alerted_title')
        : lostA ? (sim ? 'bd.hero.lost_alerted_title_sim' : 'bd.hero.lost_alerted_title') : (sim ? 'bd.hero.alerted_title_sim' : 'bd.hero.alerted_title')) };
  }
  /**
   * NC.buddy.statusOf(session, nowMs): what the Buddy screen shows for this session, for other screens (Home) to show
   * the SAME status, colour, ring and schedule line. See phaseOf() for the phases.
   * @returns {{phase, key, text, tone, sos, lost, simulated, noEmail, value, count, countSub, title}}
   */
  function statusOf(s, now) {
    if (typeof now !== 'number' || !isFinite(now)) now = Date.now();
    var ph = phaseOf(s, now);
    if (ph === 'none') return { phase: 'none', key: 'bd.status.off', text: t('bd.status.off'), tone: 'neutral', sos: false, lost: false, simulated: false, noEmail: false, value: 0, count: '', countSub: '', title: '' };
    var key = statusKey(s, ph);
    var r = ringModel(s, ph, now);
    return { phase: ph, key: key, text: t(key), tone: PHASE_TONE[ph], sos: !!r.sos, lost: !!r.lost,
      simulated: !!(s.recipient_email && emailSimNote(s)), noEmail: !s.recipient_email,
      value: r.value, count: r.count, countSub: r.sub, title: r.title };
  }

  function renderState() {
    var root = st.root;
    if (!root) return;
    var s = st.session;
    root.setAttribute('data-state', !st.loaded ? 'loading' : (s ? s.status : 'none'));
    st.el.actions.hidden = !s;
    st.el.setup.hidden = !!s || !st.loaded;
    st.el.rcp.hidden = !s;
    // Phone-only session: the on-device SMS is the traveller's only channel → its tile stands out.
    var smsTile = st.el.actions.querySelector('[data-bd="sms"]');
    if (smsTile) smsTile.classList.toggle('bd-act--primary', !!(s && !s.recipient_email));
    renderHero(false);
    if (!s) renderSetup();
    renderRcp();
    renderTimeline();
    renderSimNote();
    renderLive();
  }

  /* ---------------- hero: the screen's status intro (.page-intro, round 2 R1) ---------------- */
  var HERO_CLASSES = ['bd-hero--active', 'bd-hero--soon', 'bd-hero--grace', 'bd-hero--overdue', 'bd-hero--alerted', 'bd-hero--intro',
    'bd-hero--sos', 'page-intro--card'];
  /** Status label of an open session (SOS / simulated e-mail aware). */
  function statusKey(s, ph) {
    var danger = ph === 'overdue' || ph === 'alerted';
    var bySos = danger && sosCaused(s);
    var sim = ph === 'alerted' && !!emailSimNote(s);
    if (bySos) return ph === 'alerted' ? (sim ? 'bd.status.sos_alerted_sim' : 'bd.status.sos_alerted') : 'bd.status.sos';
    if (danger && s.alert_reason === 'contact_lost') return ph === 'alerted' ? (sim ? 'bd.status.lost_alerted_sim' : 'bd.status.lost_alerted') : 'bd.status.lost';
    if (ph === 'alerted') return sim ? 'bd.status.alerted_sim' : 'bd.status.alerted';
    return 'bd.status.' + ph;
  }
  function renderHero(force) {
    if (!st.loaded) return; // keep the skeleton until the session is known (no intro → active flicker)
    var s = st.session;
    var ph = phaseOf(s, Date.now());
    if (!force && ph === st.phase) { tickHero(); return; }
    st.phase = ph;
    var el = st.el.hero;
    HERO_CLASSES.forEach(function (c) { el.classList.remove(c); });
    if (!s) {
      // No session: one lead sentence + the status, no icon tile (round 2: calm, same intro in every module) and no
      // CTA — the setup form is open right below. The topbar already shows the title and MOD.04. The lead is honest
      // per mode: e-mail only when one is given; the local build only simulates it.
      el.classList.add('bd-hero--intro');
      if (st.el.live) setText(st.el.live, t('bd.title') + ': ' + t('bd.status.off'));
      el.innerHTML =
        '<h2 class="visually-hidden" id="bd-hero-title">' + esc(t('bd.title')) + '</h2>' +
        '<div class="page-intro__text"><p class="page-intro__lead">' + esc(t(NC.data && NC.data.mode === 'supabase' ? 'bd.hero.intro_text' : 'bd.hero.intro_text_local')) + '</p></div>' +
        '<div class="page-intro__actions">' +
          '<span class="badge badge--neutral bd-off"><span class="bd-status__dot" aria-hidden="true"></span>' + esc(t('bd.status.off')) + '</span>' +
        '</div>';
      return;
    }
    el.classList.add('page-intro--card', 'bd-hero--' + ph);
    var danger = ph === 'overdue' || ph === 'alerted';
    var bySos = danger && sosCaused(s);
    var stKey = statusKey(s, ph);
    el.classList.toggle('bd-hero--sos', bySos);
    if (st.el.live) setText(st.el.live, t('bd.title') + ': ' + t(stKey));
    var ring = NC.viz.ring(1, { size: 132, stroke: 11, label: '', tone: 'primary', ariaLabel: t(stKey) });
    // No automatic channel (no e-mail, refused by the server, or only simulated): the SMS composer sits under
    // "I'm safe" — it is the only thing that really reaches the contact.
    var smsNow = danger && (!s.recipient_email || !!syncProblem(s) || !!emailSimNote(s));
    el.innerHTML =
      '<div class="bd-hero__body">' +
        '<div class="bd-hero__top">' +
          '<span class="bd-status bd-status--' + ph + '"><span class="bd-status__dot" aria-hidden="true"></span><span data-bd-f="status">' + esc(t(stKey)) + '</span></span>' +
          '<span class="bd-hero__sync" data-bd-f="sync"></span>' +
        '</div>' +
        '<div class="bd-hero__main">' +
          '<div class="bd-ring"><span class="bd-ring__svg"></span><span class="bd-ring__label"><b data-bd-f="count">–</b><small data-bd-f="countsub"></small></span></div>' +
          '<div class="bd-hero__info">' +
            '<h2 class="bd-hero__title" id="bd-hero-title" data-bd-f="title"></h2>' +
            '<p class="bd-hero__line" data-bd-f="line1"></p>' +
            '<p class="bd-hero__line bd-hero__line--soft" data-bd-f="line2"></p>' +
          '</div>' +
        '</div>' +
        '<div class="bd-hero__problem" data-bd-f="problem" role="alert" hidden></div>' +
        '<div class="bd-hero__note" data-bd-f="note" hidden></div>' +
        '<button type="button" class="btn btn--primary btn--xl btn--block bd-checkin" data-bd="checkin" id="bd-checkin">' +
          icon(danger ? 'shield-check' : 'check-circle') + '<span>' + esc(t(danger ? 'bd.hero.checkin_safe' : 'bd.hero.checkin')) + '</span></button>' +
        (smsNow ? '<button type="button" class="btn btn--lg btn--block bd-hero__sms" data-bd="sms">' + icon('message-square') + '<span>' + esc(t('bd.hero.sms_now')) + '</span></button>' : '') +
        '<p class="bd-hero__foot" data-bd-f="foot"></p>' +
      '</div>';
    el.querySelector('.bd-ring__svg').appendChild(ring);
    tickHero();
  }
  function heroField(name) { return st.el.hero.querySelector('[data-bd-f="' + name + '"]'); }
  function setText(el, txt) { if (el && el.textContent !== txt) el.textContent = txt; }
  function tickHero() {
    var s = st.session;
    if (!s || !st.el.hero) return;
    var now = Date.now();
    var ph = phaseOf(s, now);
    if (ph !== st.phase) { renderHero(true); return; }
    var due = Date.parse(s.next_due_at);
    var graceMs = (s.grace_min || 0) * 60000;
    var l1 = '', l2 = '';
    // value / count / caption / title: one model shared with NC.buddy.statusOf (Home shows the same ring and line)
    var rm = ringModel(s, ph, now);
    var value = rm.value, count = rm.count, sub = rm.sub, title = rm.title;
    var prob = syncProblem(s);
    var noEmail = !s.recipient_email;
    var sim = noEmail ? null : emailSimNote(s);   // local build / demo address: the e-mail is only simulated
    var graceKey = prob ? 'bd.hero.grace_line_noalert' : noEmail ? 'bd.hero.grace_line_sms' : sim ? 'bd.hero.grace_line_sim' : 'bd.hero.grace_line';
    var graceVars = { grace: graceLabel(s.grace_min), time: U.fmtTime(new Date(due + graceMs)) };
    if (ph === 'active' || ph === 'soon' || ph === 'grace') {
      l1 = t(graceKey, graceVars);
      l2 = recipientLine(s);
    } else if (ph === 'overdue') {
      var bySos = !!rm.sos, lost = !!rm.lost;
      var queued = st.ops.some(function (o) { return o.data && o.data.session_id === s.id && (o.data.kind === 'overdue' || o.data.kind === 'sos'); }) || !online();
      if (noEmail) l1 = t(lost ? 'bd.hero.lost_noemail' : 'bd.hero.noemail', { name: recipientName(s) });
      else if (prob) l1 = recipientLine(s);
      else if (lost) l1 = sim ? t('bd.hero.lost_sim', { sim: sim }) : t('bd.hero.lost_s', { name: recipientName(s) });
      // Local build / demo address: even a queued SOS only reaches the (simulated) server — say so, never "tự gửi".
      else if (bySos) l1 = queued ? (sim ? t('bd.hero.sos_q_sim', { sim: sim }) : t('bd.hero.sos_q', { name: recipientName(s) }))
        : sim ? t('bd.hero.sos_sim', { sim: sim }) : t('bd.hero.sos_s', { name: recipientName(s) });
      // Missed check-in, no signal: a server that knows the session alerts by itself at due + grace (dead-man switch);
      // only a session the server never acknowledged really has its alert waiting in the queue.
      else if (queued) l1 = !startAckOf(s) ? (sim ? t('bd.hero.overdue_q_sim', { sim: sim }) : t('bd.hero.overdue_q', { name: recipientName(s) }))
        : sim ? t('bd.hero.overdue_sim', { sim: sim })
        : t('bd.hero.overdue_srv', { name: recipientName(s), time: U.fmtTime(new Date(due + graceMs)) });
      else l1 = sim ? t('bd.hero.overdue_sim', { sim: sim }) : t('bd.hero.overdue_s', { name: recipientName(s) });
      setText(heroField('status'), t(statusKey(s, ph)));
      st.el.hero.classList.toggle('bd-hero--sos', bySos);
      l2 = t('bd.hero.last', { rel: U.relTime(s.last_checkin_at) });
    } else {
      var sosAlert = !!rm.sos, lostA = !!rm.lost;
      // "sent", never "received": the server only knows that the e-mail went out (and in local mode it did not).
      l1 = sim ? t('bd.hero.alerted_line_sim', { time: U.fmtTime(s.alerted_at), sim: sim })
        : ucfirst(t(sosAlert ? 'bd.hero.sos_alerted_line' : lostA ? 'bd.hero.lost_alerted_line' : 'bd.hero.alerted_line', { name: recipientName(s), time: U.fmtTime(s.alerted_at) }));
      setText(heroField('status'), t(statusKey(s, ph)));
      st.el.hero.classList.toggle('bd-hero--sos', sosAlert);
      l2 = t('bd.hero.last', { rel: U.relTime(s.last_checkin_at) });
    }
    var arc = st.el.hero.querySelector('.vz-ring__arc');
    if (arc) {
      var c = parseFloat(arc.getAttribute('stroke-dasharray')) || 0;
      arc.setAttribute('stroke-dashoffset', (c * (1 - value)).toFixed(2));
    }
    var countEl = heroField('count');
    setText(countEl, count);
    if (countEl) {
      // Long countdowns (h:mm:ss, +hh:mm:ss) step the font down so the digits stay inside the ring (buddy.css).
      var fit = count.length >= 9 ? '9' : count.length >= 6 ? String(count.length) : '';
      if ((countEl.getAttribute('data-fit') || '') !== fit) { if (fit) countEl.setAttribute('data-fit', fit); else countEl.removeAttribute('data-fit'); }
    }
    setText(heroField('countsub'), sub);
    setText(heroField('title'), title);
    setText(heroField('line1'), l1);
    setText(heroField('line2'), l2);
    var every = t('bd.hero.every', { interval: intervalLabel(s.interval_min), grace: graceLabel(s.grace_min).replace(/^\+/, '') });
    setText(heroField('foot'), ph === 'overdue' || ph === 'alerted' ? every : every + ' · ' + t('bd.hero.last', { rel: U.relTime(s.last_checkin_at) }));
    renderProblem(s, ph, prob);
    renderNote(s, ph, prob);
    var sync = heroField('sync');
    if (sync) {
      // A session the server refused / never acknowledged is never "synced" (only on this device).
      var sv = serverView(s);
      var html = sv.state === 'refused' || sv.state === 'local' ? icon('smartphone', 'icon--xs') + '<span>' + esc(t('bd.hero.local')) + '</span>'
        : sv.n ? icon('cloud-off', 'icon--xs') + '<span>' + esc(t('bd.hero.queue', { n: sv.n })) + '</span>' : icon('cloud', 'icon--xs') + '<span>' + esc(t('bd.hero.synced')) + '</span>';
      if (sync._h !== html) { sync.innerHTML = html; sync._h = html; }
      sync.classList.toggle('is-pending', sv.state === 'pending');
      sync.classList.toggle('is-local', sv.state === 'refused' || sv.state === 'local');
    }
  }

  /** When the server flagged the silence: its 'overdue' {reason:'contact_lost'} event, else now. */
  function lostAt(s) {
    var at = null;
    st.events.forEach(function (e) {
      if (e.session_id === s.id && e.kind === 'overdue' && e.meta && e.meta.reason === 'contact_lost' && (!at || String(e.client_ts) > at)) at = String(e.client_ts);
    });
    return at || new Date();
  }

  /** Queued Buddy ops of THIS session (the hero / recipient card describe the session, not the whole device outbox). */
  function sessionOpCount(s) {
    return st.ops.filter(function (o) { return !o.data || !o.data.session_id || !s || o.data.session_id === s.id; }).length;
  }

  /**
   * Hero notice when the server refused this session (op error), with the way out. A phone-only session is NOT a
   * problem (round 2: the e-mail is optional) — it gets the calm note of renderNote() instead.
   */
  function renderProblem(s, ph, prob) {
    var box = heroField('problem');
    if (!box) return;
    var p = prob;
    // Overdue without an e-mail: line 1 already says so and "Send SMS now" sits under "I'm safe" — no second panel.
    if ((ph === 'overdue' || ph === 'alerted') && !s.recipient_email) p = null;
    if (!p) { if (!box.hidden) { box.hidden = true; box.innerHTML = ''; box._h = null; } return; }
    var btns = p.actions.map(function (a) {
      return a === 'restart'
        ? '<button type="button" class="btn btn--sm btn--danger" data-bd="restart">' + icon('rotate-ccw') + '<span>' + esc(t('bd.err.restart')) + '</span></button>'
        : '<button type="button" class="btn btn--sm btn--outline" data-bd="sms">' + icon('message-square') + '<span>' + esc(t('bd.err.sms')) + '</span></button>';
    }).join('');
    var html = '<span class="bd-hero__problem-icon">' + icon('alert-triangle') + '</span>' +
      '<div class="bd-hero__problem-body"><p>' + esc(p.text) + '</p>' + (btns ? '<div class="bd-hero__problem-btns">' + btns + '</div>' : '') + '</div>';
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
    box.setAttribute('data-kind', p.key);
    box.hidden = false;
  }
  /** Phone-only session (no e-mail): say clearly — not alarmingly — that the SMS is the traveller's job, suggest an e-mail. */
  function renderNote(s, ph, prob) {
    var box = heroField('note');
    if (!box) return;
    var show = !s.recipient_email && !prob && ph !== 'overdue' && ph !== 'alerted';
    if (!show) { if (!box.hidden) { box.hidden = true; box.innerHTML = ''; box._h = null; } return; }
    var html = '<span class="bd-hero__note-icon">' + icon('info') + '</span>' +
      '<div class="bd-hero__note-body"><p>' + esc(t('bd.hero.sms_only')) + '</p>' +
      '<p class="bd-hero__note-tip">' + esc(t('bd.hero.sms_only_tip')) + '</p>' +
      '<div class="bd-hero__note-btns">' +
        '<button type="button" class="btn btn--sm btn--soft" data-bd="sms">' + icon('message-square') + '<span>' + esc(t('bd.hero.sms')) + '</span></button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-bd="add-email">' + icon('mail') + '<span>' + esc(t('bd.hero.add_email')) + '</span></button>' +
      '</div></div>';
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
    box.hidden = false;
  }

  /* ---------------- setup form ---------------- */
  function chipsHtml(values, labelFn, selected, demoValue) {
    return values.map(function (v) {
      var on = v === selected;
      var demo = v === demoValue;
      return '<button type="button" class="chip' + (demo ? ' bd-chip--demo' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" tabindex="' + (on ? '0' : '-1') + '" data-value="' + v + '">' +
        (demo ? icon('zap', 'icon--xs') : '') + '<span>' + esc(labelFn(v)) + '</span></button>';
    }).join('');
  }
  function chipValue(group) {
    var b = group.querySelector('[aria-checked="true"]');
    return b ? +b.getAttribute('data-value') : null;
  }
  function wireChips(group) {
    group.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.chip') : null;
      if (!b || !group.contains(b)) return;
      U.$$('.chip', group).forEach(function (c) { var on = c === b; c.setAttribute('aria-checked', on ? 'true' : 'false'); c.setAttribute('tabindex', on ? '0' : '-1'); });
    });
    group.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
      var list = U.$$('.chip', group);
      var i = list.indexOf(group.querySelector('[aria-checked="true"]'));
      var n = list[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length];
      if (n) { e.preventDefault(); n.click(); n.focus(); }
    });
  }
  /**
   * Build chips/options (first time, language change, "Lịch demo nhanh" toggled); prefill from the profile once it is
   * loaded. pick: 'demo' selects the demo schedule (the switch was just turned on).
   */
  function renderSetup(rebuild, pick) {
    var f = st.el;
    if (!f.form) return;
    if (rebuild || !st.formInit) {
      var ints = INTERVALS.concat(st.demoSched ? [DEMO_INTERVAL] : []);
      var graces = GRACES.concat(st.demoSched ? [DEMO_GRACE] : []);
      var curInt = st.formInit ? chipValue(f.fInterval) : (st.demoSched ? DEMO_INTERVAL : 120);
      var curGrace = st.formInit ? chipValue(f.fGrace) : (st.demoSched ? DEMO_GRACE : 15);
      if (pick === 'demo' && st.demoSched) { curInt = DEMO_INTERVAL; curGrace = DEMO_GRACE; }
      if (ints.indexOf(curInt) < 0) curInt = 120;
      if (graces.indexOf(curGrace) < 0) curGrace = 15;
      f.fInterval.innerHTML = chipsHtml(ints, intervalChip, curInt, DEMO_INTERVAL);
      f.fGrace.innerHTML = chipsHtml(graces, graceChip, curGrace, DEMO_GRACE);
      if (f.pDemoSched) f.pDemoSched.checked = !!st.demoSched;
      var curRouteSel = st.formInit ? f.fRoute.value : curRoute();
      f.fRoute.innerHTML = seedRoutes().map(function (r) {
        return '<option value="' + esc(r.id) + '"' + (r.id === curRouteSel ? ' selected' : '') + '>' + esc(routeName(r.id)) + '</option>';
      }).join('');
      if (!st.formInit) st.fMode.set(setting('travel_mode', 'motorbike') === 'hiking' ? 'hiking' : 'motorbike');
      st.formInit = true;
    }
    if (!st.formPrefilled && st.loaded) {
      st.formPrefilled = true;
      f.fRoute.value = curRoute();
      var id = (st.profile && st.profile.identity) || {};
      // A reveal code protects name + emergency contact (MOD.03): never prefill them past that gate.
      if (!id.reveal_code) {
        if (!f.fTraveler.value) f.fTraveler.value = id.full_name || '';
        if (!f.fRname.value) f.fRname.value = id.contact_name || '';
        if (!f.fRphone.value && id.contact_phone) {
          var cp = normPhone(id.contact_phone);
          f.fRphone.value = cp.e164 ? cp.display : id.contact_phone;
          // MOD.03 contact is a 02x landline / unreadable number → say so right away (like "set up again"), not only
          // on blur or submit: the traveller must swap in a mobile before starting.
          var cpErrKey = phoneError(id.contact_phone);
          if (cpErrKey) fieldError(f.fldRphone, true, cpErrKey);
        }
      }
      // No e-mail is ever prefilled — not even in demo mode (2026-10-02): judges walk the real phone-first flow (name +
      // mobile from the profile, the e-mail stays optional and empty).
      st.fMode.set(setting('travel_mode', 'motorbike') === 'hiking' ? 'hiking' : 'motorbike');
    }
    if (st.prefill && st.loaded) {
      // "Set up again" / "Add an email": carry the previous session's choices over.
      var o = st.prefill; st.prefill = null;
      f.fTraveler.value = o.traveler_name || f.fTraveler.value;
      f.fRname.value = o.recipient_name || f.fRname.value;
      f.fRemail.value = o.recipient_email || '';
      var op = normPhone(o.recipient_phone);
      f.fRphone.value = op.e164 ? op.display : '';
      // the previous session ran on the demo schedule → keep it available (and chosen) in the form
      if (!st.demoSched && (o.interval_min === DEMO_INTERVAL || o.grace_min === DEMO_GRACE)) { st.demoSched = true; renderSetup(true); }
      setChip(f.fInterval, o.interval_min); setChip(f.fGrace, o.grace_min);
      if (o.route_id && seedRoutes().some(function (r) { return r.id === o.route_id; })) f.fRoute.value = o.route_id;
      if (o.travel_mode) st.fMode.set(o.travel_mode === 'hiking' ? 'hiking' : 'motorbike');
      // A legacy e-mail-only session has no phone (required now); a legacy 02x landline needs a mobile instead.
      var opErrKey = phoneError(o.recipient_phone);
      if (opErrKey) fieldError(f.fldRphone, true, opErrKey);
    }
    renderEmailHint();
    renderShareNa();
  }
  /** Local build / demo address: the automatic e-mail is only simulated — say so right under the e-mail field. */
  function renderEmailHint() {
    var el = st.el.fRemailHint;
    if (!el) return;
    var v = st.el.fRemail.value.trim();
    var note = !NC.data || NC.data.mode !== 'supabase' ? t('bd.sim_email.local') : (v ? emailSimNote({ recipient_email: v }) : null);
    var html = '<span>' + esc(t('bd.f.remail_hint')) + '</span>' + (note ? ' <span class="bd-simtag">' + esc(note) + '</span>' : '');
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }
  /** Public medical layer: needs a profile + the separate sensitive-data consent + an e-mail (it only travels in it). */
  function renderShareNa() {
    var f = st.el;
    var hasProfile = !!(st.profile && st.profile.public && NC.profile.isComplete && NC.profile.isComplete(st.profile));
    var sensitive = !!(st.consents && st.consents.sensitive);
    var hasEmail = !!f.fRemail.value.trim();
    var na = !hasProfile ? t('bd.f.share_na_profile') : (!sensitive ? t('bd.f.share_na_consent') : (!hasEmail ? t('bd.f.share_na_email') : ''));
    var link = !hasProfile || !sensitive;
    f.fShare.disabled = !!na;
    if (na) f.fShare.checked = false;
    f.fShareNa.hidden = !na;
    var html = na ? icon('info', 'icon--xs') + '<span>' + esc(na) + '</span>' + (link ? ' <a href="#/qr">' + esc(t('app.nav.qr')) + '</a>' : '') : '';
    if (f.fShareNa._h !== html) { f.fShareNa.innerHTML = html; f.fShareNa._h = html; }
  }
  function setChip(group, v) {
    var b = group ? group.querySelector('[data-value="' + (+v) + '"]') : null;
    if (!b) return;
    U.$$('.chip', group).forEach(function (c) { var on = c === b; c.setAttribute('aria-checked', on ? 'true' : 'false'); c.setAttribute('tabindex', on ? '0' : '-1'); });
  }
  /** Toggle a field's error; `msgKey` swaps the message (e.g. "required" vs "invalid" for the phone). */
  function fieldError(fieldEl, on, msgKey) {
    if (!fieldEl) return;
    fieldEl.classList.toggle('is-invalid', !!on);
    var er = fieldEl.querySelector('.field__error');
    if (er) {
      if (on && msgKey) { er.setAttribute('data-i18n', msgKey); er.textContent = t(msgKey); }
      er.hidden = !on;
    }
    var inp = fieldEl.querySelector('input');
    if (inp) {
      if (on) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
      // the error first, then the field hint (both read by screen readers)
      var hint = fieldEl.querySelector('.field__hint');
      var ids = [er && er.id && on ? er.id : null, hint && hint.id ? hint.id : null].filter(Boolean);
      if (ids.length) inp.setAttribute('aria-describedby', ids.join(' ')); else inp.removeAttribute('aria-describedby');
    }
  }
  /**
   * Round 2 (R7): phone required (the traveller's SMS), e-mail optional but valid (the server's automatic alert).
   * 20261002000100: a Vietnamese 02x landline cannot receive the SMS → its own message (= 'recipient_phone_not_mobile').
   */
  function phoneError(v) {
    var n = normPhone(v);
    return n.empty ? 'bd.f.err_phone_req' : n.landline ? 'bd.f.err_phone_mobile' : (!n.valid ? 'bd.f.err_phone' : null);
  }
  var PHONE_ERR_KEYS = { recipient_phone_required: 'bd.f.err_phone_req', recipient_phone_invalid: 'bd.f.err_phone', recipient_phone_not_mobile: 'bd.f.err_phone_mobile' };
  function emailError(v) { var e = String(v || '').trim(); return e && !validEmail(e) ? 'bd.f.err_email' : null; }
  function submitSetup(e) {
    e.preventDefault();
    var f = st.el;
    var traveler = cleanName(f.fTraveler.value, TRAVELER_MAX);
    var rname = cleanName(f.fRname.value, RECIPIENT_MAX), remail = f.fRemail.value.trim();
    var rphone = normPhone(f.fRphone.value);
    if (f.fTraveler.value.trim() !== traveler) f.fTraveler.value = traveler;
    if (f.fRname.value.trim() !== rname) f.fRname.value = rname;
    var errs = [];
    fieldError(f.fldRname, !rname); if (!rname) errs.push(f.fRname);
    var phoneErr = phoneError(f.fRphone.value);
    fieldError(f.fldRphone, !!phoneErr, phoneErr); if (phoneErr) errs.push(f.fRphone);
    if (rphone.valid && f.fRphone.value.trim() !== rphone.display) f.fRphone.value = rphone.display;
    var emailErr = emailError(remail);
    fieldError(f.fldRemail, !!emailErr, emailErr); if (emailErr) errs.push(f.fRemail);
    if (f.fRemail.value !== remail) f.fRemail.value = remail;
    var noConsent = !f.fConsent.checked;
    fieldError(f.fldConsent, noConsent); if (noConsent) errs.push(f.fConsent);
    if (errs.length) { try { errs[0].focus(); } catch (x) { /* ignore */ } return; }
    // Round 2 R6: the route planned on the map (kv 'map.last_route'.plan) rides along → the trip reminders start too.
    // The notification permission is asked HERE, synchronously inside the tap (Firefox / Safari need the gesture).
    var tripPlan = NC.trip && NC.trip.start && !NC.trip.current() ? usableTripPlan(f.fRoute.value || curRoute()) : null;
    // inside the tap; not when the user turned "Thông báo hệ thống" off
    if (tripPlan && NC.trip.askPermission && !(NC.trip.prefs && NC.trip.prefs().notify === false)) NC.trip.askPermission();
    // The medical layer only travels in the alert e-mail: without an e-mail nothing is shared with the server.
    var share = !!f.fShare.checked && !f.fShare.disabled && !!remail;
    var interval = chipValue(f.fInterval) || 120, grace = chipValue(f.fGrace);
    if (grace === null) grace = 15;
    var route = f.fRoute.value || curRoute(), mode = st.fMode.get() || 'motorbike';
    var p = lastPos();
    NC.ui.setLoading(f.fSubmit, true);
    var consentP = NC.profile && NC.profile.consents ? NC.profile.consents.set({ deadman: true, share_medical_in_alert: share }).catch(function () { }) : Promise.resolve();
    consentP.then(function () {
      var patch = {};
      if (route !== curRoute()) patch.route_id = route;
      if (mode !== setting('travel_mode', 'motorbike')) patch.travel_mode = mode;
      return Object.keys(patch).length && NC.settings.patch ? NC.settings.patch(patch) : null;
    }).then(function () {
      return NC.data.buddy.start({
        traveler_name: traveler || null, recipient: { name: rname, email: remail || null, phone: rphone.e164 },
        interval_min: interval, grace_min: grace, route_id: route, travel_mode: mode,
        share_public_medical: share, public_medical: share && st.profile ? st.profile.public : null,
        lat: p ? p.lat : null, lng: p ? p.lng : null
      });
    }).then(function (s) {
      NC.ui.setLoading(f.fSubmit, false);
      f.fConsent.checked = false;
      vib([40, 60, 40]);
      var tripMsg = '';
      if (tripPlan) {
        NC.trip.start(tripPlan, { quiet: true, from: 'buddy' }).catch(function (x) { console.warn('[buddy] trip', x && x.message); });
        tripMsg = ' ' + t('bd.f.started_trip', { from: tripPlan.from_label || '?', to: tripPlan.to_label || '?' });
      }
      toast(t(online() ? 'bd.f.started' : 'bd.f.started_offline', { time: U.fmtTime(s.next_due_at) }) + tripMsg, { type: 'success', timeout: tripMsg ? 7000 : 4500 });
      if (!st.prefs.mode) { sim.mode = mode; }
      return refresh().then(function () { window.scrollTo(0, 0); ensureJourney(); });
    }).catch(function (err) {
      NC.ui.setLoading(f.fSubmit, false);
      console.warn('[buddy] start failed', err && err.message);
      var code = normCode(err && (err.code || err.message));
      if (Object.prototype.hasOwnProperty.call(PHONE_ERR_KEYS, code)) {
        fieldError(f.fldRphone, true, PHONE_ERR_KEYS[code]);
        try { f.fRphone.focus(); } catch (x) { /* ignore */ }
      } else if (code === 'recipient_email_invalid') { fieldError(f.fldRemail, true, 'bd.f.err_email'); try { f.fRemail.focus(); } catch (x) { /* ignore */ } }
      else if (code === 'rate_limited') toast(t('bd.err.rate_limited_start'), { type: 'danger', timeout: 9000 });
      else toast(t('common.error'), { type: 'danger' });
    });
  }

  /* ---------------- recipient + sync ---------------- */
  /**
   * Recipient card (round 2 R1: compact): who + phone + how they are alerted, one line; the sync state only when it
   * needs attention; the full details (e-mail, schedule, route, medical layer, server, reveal) behind a disclosure.
   */
  function renderRcp() {
    var s = st.session;
    var body = st.el.rcpBody;
    if (!s || !body) return;
    var evs = st.events.filter(function (e) { return e.session_id === s.id && !(e.meta && e.meta.no_session); });
    var received = evs.filter(function (e) { return !!deliveredAt(e); });
    var lastRx = received.reduce(function (a, e) { var r = deliveredAt(e); return !a || r > a ? r : a; }, null);
    var sv = serverView(s);
    var n = sv.n;
    // Refused by the server / never acknowledged: "not on the server", no ✓ and no "Sync now" (it cannot help).
    var local = sv.state === 'refused' || sv.state === 'local';
    var mode = NC.data && NC.data.mode === 'supabase' ? 'bd.rcp.server_supabase' : 'bd.rcp.server_local';
    var email = st.reveal ? (s.recipient_email || '—') : (maskEmail(s.recipient_email) || '—');
    var phoneDisp = phoneText(s.recipient_phone);
    var phone = st.reveal ? (phoneDisp || '—') : (maskPhone(phoneDisp) || '—');
    var rname = s.recipient_name && !st.reveal && idProtected() ? t('bd.rcp.name_hidden') : (s.recipient_name || '—');
    var sim = emailSimNote(s);
    var ch = !s.recipient_email ? { icon: 'message-square', tone: 'neutral', key: 'bd.rcp.channel_sms' }
      : sim ? { icon: 'mail', tone: 'warning', key: 'bd.rcp.channel_sim' } : { icon: 'mail', tone: 'success', key: 'bd.rcp.channel_email' };
    var syncCls = local ? 'bd-sync--local' : n ? 'bd-sync--pending' : 'bd-sync--ok';
    var title = local ? t('bd.sync.local') : n ? tn('bd.sync.pending', n) : (lastRx ? t('bd.sync.ok_at', { time: U.fmtTime(lastRx) }) : t('bd.sync.ok'));
    var syncBox =
      '<div class="bd-sync ' + syncCls + '">' +
        '<span class="icon-tile icon-tile--sm icon-tile--' + (local ? 'danger' : n ? 'warning' : 'success') + '">' + icon(local ? 'smartphone' : n ? 'cloud-off' : 'cloud-upload') + '</span>' +
        '<div class="bd-sync__body"><p class="bd-sync__title">' + esc(title) + '</p>' +
        '<p class="bd-sync__meta">' + esc(n && !local && !online() ? t('bd.sync.offline') : t('bd.sync.count', { n: received.length, total: evs.length })) + '</p></div>' +
        (n && !local && online() ? '<button type="button" class="btn btn--sm btn--soft" data-bd="flush">' + icon('refresh') + '<span>' + esc(t('bd.sync.now')) + '</span></button>' : '') +
      '</div>';
    var attention = local || n > 0;   // "Đã tới máy chủ ✓" is already the hero pill: only problems stay in sight
    body.innerHTML =
      '<div class="bd-rcp__sum">' +
        '<span class="icon-tile icon-tile--sm icon-tile--primary" aria-hidden="true">' + icon('user') + '</span>' +
        '<div class="bd-rcp__who"><p class="bd-rcp__name">' + esc(rname) + '</p>' +
          '<p class="bd-rcp__phone">' + icon('phone', 'icon--xs') + '<span translate="no">' + esc(phone) + '</span></p></div>' +
      '</div>' +
      '<p class="bd-rcp__channel bd-rcp__channel--' + ch.tone + '">' + icon(ch.icon, 'icon--xs') + '<span>' + esc(t(ch.key)) + '</span></p>' +
      (attention ? syncBox : '') +
      // shared ".disclosure" (components.css) — the same "Xem thêm" look as every module
      '<details class="disclosure bd-rcp__more"' + (st.rcpOpen ? ' open' : '') + '>' +
        '<summary class="disclosure__sum"><span class="disclosure__txt"><span class="disclosure__title">' + esc(t('bd.rcp.more')) + '</span></span>' +
          '<span class="disclosure__chev">' + icon('chevron-down') + '</span></summary>' +
        '<div class="disclosure__body">' +
        (attention ? '' : syncBox) +
        '<dl class="kv bd-rcp__kv">' +
          kvRow(t('bd.rcp.name'), esc(rname)) +
          kvRow(t('bd.rcp.phone'), '<span translate="no">' + esc(phone) + '</span>') +
          kvRow(t('bd.rcp.email'), s.recipient_email ? '<span translate="no">' + esc(email) + '</span>' : esc(t('bd.tl.no_email'))) +
          kvRow(t('bd.rcp.schedule'), esc(t('bd.hero.every', { interval: intervalLabel(s.interval_min), grace: graceLabel(s.grace_min).replace(/^\+/, '') }))) +
          kvRow(t('bd.rcp.route'), esc(routeName(s.route_id) + ' · ' + modeLabel(s.travel_mode))) +
          kvRow(t('bd.rcp.medical'), esc(t(s.share_public_medical ? 'bd.rcp.medical_on' : 'bd.rcp.medical_off'))) +
          kvRow(t('bd.rcp.server'), esc(t(mode))) +
        '</dl>' +
        '<button type="button" class="btn btn--ghost btn--sm bd-rcp__reveal" data-bd="reveal" aria-pressed="' + (st.reveal ? 'true' : 'false') + '">' + icon(st.reveal ? 'eye-off' : 'eye') + '<span>' + esc(t(st.reveal ? 'bd.rcp.hide' : 'bd.rcp.reveal')) + '</span></button>' +
        '</div>' +
      '</details>' +
      '<div class="bd-rcp__btns">' +
        '<button type="button" class="btn btn--outline btn--sm bd-stop" data-bd="stop">' + icon('stop') + '<span>' + esc(t('bd.stop')) + '</span></button>' +
      '</div>';
    var more = body.querySelector('.bd-rcp__more');
    if (more) more.addEventListener('toggle', function () { st.rcpOpen = more.open; });
  }
  function kvRow(k, vHtml) { return '<div class="kv__row"><dt>' + esc(k) + '</dt><dd>' + vHtml + '</dd></div>'; }

  /* ---------------- timeline ---------------- */
  function evTitle(ev) {
    if (ev.kind === 'alert_sent') {
      // Local build / demo address: the e-mail was only simulated — the log never says "sent".
      var sim = !NC.data || NC.data.mode !== 'supabase' || !!(ev.meta && (ev.meta.provider === 'simulated' || ev.meta.provider === 'demo')) ||
        !!emailSimNote(st.session);
      var k = ev.meta && ev.meta.type === 'resolved' ? 'bd.kind.alert_resolved' : alertWasSos(ev) ? 'bd.kind.alert_sent_sos'
        : alertTrigger(ev) === 'contact_lost' ? 'bd.kind.alert_sent_lost' : 'bd.kind.alert_sent';
      return t(sim ? k + '_sim' : k);
    }
    if (ev.kind === 'overdue' && ev.meta && ev.meta.reason === 'contact_lost') return t('bd.kind.contact_lost');
    return t('bd.kind.' + ev.kind);
  }
  /** Why an alert went out: meta.reason / alert_reason, else the latest 'overdue' event before it (contact_lost?). */
  function alertTrigger(ev) {
    var m = ev.meta || {};
    if (m.reason || m.alert_reason) return m.reason || m.alert_reason;
    var trig = null;
    st.events.forEach(function (e) {
      if (e.session_id !== ev.session_id || ['sos', 'overdue', 'checkin', 'resolved'].indexOf(e.kind) < 0 || String(e.client_ts) > String(ev.client_ts)) return;
      if (!trig || String(e.client_ts) >= String(trig.client_ts)) trig = e;
    });
    return trig && trig.kind === 'overdue' && trig.meta && trig.meta.reason === 'contact_lost' ? 'contact_lost' : null;
  }
  /** alert_sent caused by an SOS: meta.reason (server) or, failing that, the latest trigger before it was an SOS. */
  function alertWasSos(ev) {
    var m = ev.meta || {};
    if (m.reason || m.alert_reason) return (m.reason || m.alert_reason) === 'sos';
    var trig = null;
    st.events.forEach(function (e) {
      if (e.session_id !== ev.session_id || ['sos', 'overdue', 'checkin', 'resolved'].indexOf(e.kind) < 0 || String(e.client_ts) > String(ev.client_ts)) return;
      if (!trig || String(e.client_ts) >= String(trig.client_ts)) trig = e;
    });
    return !!(trig && trig.kind === 'sos');
  }
  function renderTimeline() {
    var list = st.el.tlList;
    if (!list) return;
    var s = st.session;
    // Oldest → newest, then reversed. Same client_ts (a check-in and the 'resolved' derived from it): the derived event
    // is newer, so it is listed above its check-in in every browser.
    var evs = st.events.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
      var ta = String(a.e.client_ts || ''), tb = String(b.e.client_ts || '');
      if (ta !== tb) return ta < tb ? -1 : 1;
      if (isDerivedFrom(a.e, b.e)) return 1;
      if (isDerivedFrom(b.e, a.e)) return -1;
      return a.i - b.i;
    }).map(function (x) { return x.e; }).reverse();
    var start = st.events.filter(function (e) { return e.kind === 'start'; })[0];
    setText(st.el.tlSub, start ? (s ? t('bd.tl.since', { time: U.fmtDateTime(start.client_ts) }) : t('bd.tl.closed')) : '');
    if (!evs.length) {
      list.innerHTML = '<li class="bd-tl__empty">' + icon('history', 'icon--lg') + '<span>' + esc(t('bd.tl.empty')) + '</span></li>';
      return;
    }
    var max = st.showAll ? evs.length : 30;
    // The server refused this session (no e-mail / start limit): its events stay on the device — never "Sending…".
    var sv = s ? serverView(s).state : null;
    var refused = sv === 'refused' || sv === 'local';
    var shown = Math.min(max, evs.length);
    var html = evs.slice(0, max).map(function (ev, idx) {
      var k = KIND[ev.kind] || { icon: 'dot', tone: 'neutral' };
      var meta = ev.meta || {};
      var src = '';
      if (ev.kind === 'overdue') src = t(meta.source === 'server' ? 'bd.tl.src_server' : 'bd.tl.src_device');
      else if (meta.source === 'simulator') src = t('bd.tl.src_sim');
      else if (ev.kind === 'alert_sent' && s && s.recipient_email) src = t('bd.tl.to', { to: maskEmail(s.recipient_email) });
      else if (ev.kind === 'alert_failed' && /rate_limit/.test(String(meta.reason || meta.error || ''))) src = t('bd.tl.rate_limited');
      else if (ev.kind === 'alert_failed' && /email/.test(String(meta.reason || meta.error || ''))) src = t('bd.tl.no_email');
      var parts = ['<time datetime="' + esc(ev.client_ts) + '">' + esc(fmtClock(ev.client_ts)) + '</time>'];
      if (ev.lat !== null && ev.lat !== undefined) parts.push('<span translate="no">' + esc(coordsText(ev.lat, ev.lng)) + '</span>');
      if (meta.km !== undefined && meta.km !== null) parts.push('km ' + esc(kmAt(meta.km)));
      else if (meta.zone_start_km !== undefined) parts.push(esc(t('bd.warn.at_km', { km: kmAt(meta.zone_start_km) })));
      if (meta.position === 'last_known') parts.push(esc(t('bd.tl.last_known')));
      var state, stateCls, stateIcon;
      var rx = deliveredAt(ev); // a derived 'resolved' is acknowledged together with its check-in
      var localOnly = !!meta.no_session || (refused && !rx && !!s && ev.session_id === s.id);
      if (localOnly) { state = t('bd.tl.local'); stateCls = 'neutral'; stateIcon = 'smartphone'; }
      else if (rx && meta.source === 'server') { state = t('bd.tl.server'); stateCls = 'info'; stateIcon = 'server'; }
      else if (rx) {
        var lag = Date.parse(rx) - Date.parse(ev.client_ts);
        if (ev.queued) { state = t('bd.tl.late', { d: U.fmtDuration(Math.max(0, lag) / 60000) }); stateCls = 'success'; stateIcon = 'check'; }
        else { state = t('bd.tl.sent'); stateCls = 'success'; stateIcon = 'check'; }
      } else if (!online() || ev.queued) { state = t('bd.tl.queued'); stateCls = 'warning'; stateIcon = 'cloud-off'; }
      else { state = t('bd.tl.sending'); stateCls = 'neutral'; stateIcon = 'upload'; }
      var pending = !rx && !localOnly;
      return '<li class="bd-tl__item' + (pending ? ' is-pending' : '') + (idx === shown - 1 ? ' is-last' : '') + '" data-kind="' + esc(ev.kind) + '">' +
        '<span class="icon-tile icon-tile--sm icon-tile--' + k.tone + ' bd-tl__icon">' + icon(k.icon) + '</span>' +
        '<div class="bd-tl__body">' +
          '<p class="bd-tl__title">' + esc(evTitle(ev)) + (src ? ' <span class="bd-tl__src">· ' + esc(src) + '</span>' : '') + '</p>' +
          '<p class="bd-tl__meta">' + parts.join('<span aria-hidden="true"> · </span>') + '</p>' +
        '</div>' +
        '<span class="badge badge--' + stateCls + ' bd-tl__state">' + icon(stateIcon) + esc(state) + '</span>' +
      '</li>';
    }).join('');
    if (evs.length > max) html += '<li class="bd-tl__more"><button type="button" class="btn btn--ghost btn--sm" data-bd="more">' + esc(tn('bd.tl.more', evs.length - max)) + '</button></li>';
    list.innerHTML = html;
  }

  /* ---------------- proactive warning card ---------------- */
  function activeLive() { return sim.started ? sim.live : null; }
  function staticLive() {
    // Not simulating: evaluate the saved position against the path (no speed → distance basis).
    var J = st.journey; if (!J) return null;
    var p = lastPos();
    var pos = 0, src = 'start', far = null;
    if (p) {
      var near = NC.routing.nearestOnLine(J.analysis.geometry, p);
      if (near && near.distance_km <= FAR_KM) { pos = near.along_km * J.scale; src = 'saved'; }
      else if (near) far = near.distance_km;
    }
    var mode = setting('travel_mode', 'motorbike') === 'hiking' ? 'hiking' : 'motorbike';
    var dz = NC.routing.deadzoneAhead(J.analysis, pos, { speed_kmh: NC.routing.SPEEDS[mode], mode: mode });
    dz.speed_kmh = NC.routing.SPEEDS[mode]; dz.speed_default = true;
    return { pos: pos, avg: null, detected: mode, unstable: false, dz: dz, level: levelAt(J.analysis, pos), source: src, far: far, defaultSpeed: NC.routing.SPEEDS[mode] };
  }
  function renderWarn() {
    var body = st.el.warnBody;
    if (!body) return;
    var J = st.journey;
    if (!J) {
      setText(st.el.warnPath, '');
      body.innerHTML = st.journeyErr ? '<p class="bd-muted">' + icon('alert-triangle', 'icon--sm') + ' ' + esc(t('bd.warn.error')) + '</p>'
        : '<div class="bd-loading"><span class="spinner"></span><span>' + esc(t('bd.warn.loading')) + '</span></div>';
      return;
    }
    setText(st.el.warnPath, warnPathText(J));
    var TH = NC.routing.THRESHOLDS, SP = NC.routing.SPEEDS;
    var th = function (m) {
      var kmT = TH[m].minutes / 60 * SP[m];
      return '<div class="bd-th__row" data-mode="' + m + '">' +
        '<span class="bd-th__mode">' + icon(m === 'hiking' ? 'footprints' : 'bike', 'icon--sm') + '<span>' + esc(modeLabel(m)) + '</span></span>' +
        '<span class="bd-th__val"><b>' + esc(t('bd.warn.th_time', { min: TH[m].minutes })) + '</b> <span class="bd-muted">' + esc(t('bd.warn.th_km', { km: U.fmtKm(kmT) })) + ' @ ' + esc(fmtSpeed(SP[m])) + '</span></span>' +
        '<span class="bd-th__fb bd-muted">' + esc(t('bd.warn.th_fallback', { km: U.fmtKm(TH[m].km) })) + '</span>' +
      '</div>';
    };
    body.innerHTML =
      '<div class="bd-next" data-bd-w="next"></div>' +
      '<div class="bd-warn__strip" data-bd-w="strip"></div>';
    // How the warning is computed (t = d ÷ v̄ + thresholds per travel mode): technical → the "Chế độ demo" section (R1).
    if (st.el.demoFormula) st.el.demoFormula.innerHTML =
      '<div class="bd-warn__grid">' +
        '<div class="bd-formula"><p class="bd-eyebrow">' + esc(t('bd.warn.formula')) + '</p>' +
          '<p class="bd-formula__eq mono" aria-hidden="true">t = d ÷ v̄</p>' +
          '<p class="bd-formula__num mono" data-bd-w="calc"></p>' +
          '<p class="bd-formula__basis" data-bd-w="basis"></p></div>' +
        '<div class="bd-th"><p class="bd-eyebrow">' + esc(t('bd.warn.threshold')) + '</p>' + th('motorbike') + th('hiking') + '</div>' +
      '</div>';
    var strip = NC.viz.signalStrip(J.analysis, { pos_km: 0, showKm: true, height: 14 });
    body.querySelector('[data-bd-w="strip"]').appendChild(strip);
    renderWarnLive();
  }
  function movePos(svg, km, len) {
    if (!svg || !len) return;
    var g = svg.querySelector('.vz-pos'); if (!g) return;
    var px = (Math.max(0, Math.min(1, km / len)) * 100).toFixed(3) + '%';
    var line = g.querySelector('line'), c = g.querySelector('circle');
    if (line) { line.setAttribute('x1', px); line.setAttribute('x2', px); }
    if (c) c.setAttribute('cx', px);
  }
  function renderWarnLive() {
    var body = st.el.warnBody, J = st.journey;
    if (!body || !J) return;
    var live = activeLive() || staticLive();
    if (!live) return;
    var dz = live.dz;
    var next = body.querySelector('[data-bd-w="next"]');
    var srcKey = live.source === 'sim' ? 'bd.warn.src_sim' : live.source === 'saved' ? 'bd.warn.src_saved' : 'bd.warn.src_start';
    var srcLine = '<span class="bd-next__src">' + icon(live.source === 'sim' ? 'route' : 'map-pin', 'icon--xs') + esc(t(srcKey)) + ' · km ' + esc(kmAt(live.pos)) + '</span>';
    var html, tone;
    // No Buddy session, no trip, simulator idle: nobody is on the road — one small secondary line, never the big
    // number next to "Chưa có chuyến đi" (it would contradict it and compete with the setup form).
    var compact = !st.session && !activeTrip() && !sim.started;
    if (compact) {
      var line = live.far ? t('bd.warn.far', { km: U.fmtKm(live.far) })
        : dz.in_deadzone ? t('bd.warn.inside_line', { km: U.fmtKm(Math.max(0, dz.next.end_km - live.pos)) })
        : dz.next ? t('bd.warn.next_line', { km: kmAt(dz.next.start_km), dist: U.fmtKm(dz.distance_km), t: U.fmtDuration(dz.minutes), len: U.fmtKm(dz.next.length_km) })
        : t('bd.warn.none_line');
      html = '<p class="bd-next__line">' + icon(dz.next || dz.in_deadzone ? 'signal-off' : 'signal', 'icon--xs') + '<span>' + esc(line) + '</span></p>';
      tone = 'compact';
    } else if (live.far) {
      tone = 'muted';
      html = '<p class="bd-next__far">' + icon('info', 'icon--sm') + '<span>' + esc(t('bd.warn.far', { km: U.fmtKm(live.far) })) + '</span></p>';
    }
    if (compact) {
      // the line above says it all
    } else if (dz.in_deadzone) {
      tone = 'lost';
      html = '<p class="bd-eyebrow">' + esc(t('bd.warn.inside')) + '</p>' +
        '<p class="bd-next__big">' + icon('signal-off') + '<span>' + esc(t('bd.warn.inside_left', { km: U.fmtKm(Math.max(0, dz.next.end_km - live.pos)) })) + '</span></p>';
    } else if (dz.next) {
      tone = dz.should_warn ? 'warn' : 'ok';
      html = (html || '') +
        '<p class="bd-eyebrow">' + esc(t('bd.warn.next')) + '</p>' +
        '<p class="bd-next__big"><b>' + esc(t('bd.warn.after', { km: U.fmtKm(dz.distance_km) })) + '</b><span class="bd-next__eta">' + esc(t('bd.warn.eta', { t: U.fmtDuration(dz.minutes) })) + '</span></p>' +
        '<p class="bd-next__len">' + esc(t('bd.warn.at_km', { km: kmAt(dz.next.start_km) })) + ' · ' + esc(t('bd.warn.len', { km: U.fmtKm(dz.next.length_km) })) + '</p>' +
        (dz.should_warn ? '<p class="bd-next__alarm">' + icon('bell-ring', 'icon--sm') + '<span>' + esc(t('bd.warn.alarm')) + '</span></p>' : '');
    } else if (!html) {
      tone = 'ok';
      html = '<p class="bd-eyebrow">' + esc(t('bd.warn.next')) + '</p><p class="bd-next__big"><b>' + esc(t('bd.warn.none')) + '</b></p><p class="bd-next__len">' + esc(t('bd.warn.none_sub')) + '</p>';
    }
    if (!compact) html += srcLine;
    if (next._h !== html) { next.innerHTML = html; next._h = html; }
    next.setAttribute('data-tone', tone);
    movePos(body.querySelector('[data-bd-w="strip"] svg'), live.pos, J.analysis.length_km);
    var fx = st.el.demoFormula || body;
    var calc = fx.querySelector('[data-bd-w="calc"]'), basis = fx.querySelector('[data-bd-w="basis"]');
    var measured = live.avg !== null && live.avg !== undefined;
    // v is the very speed the ETA (and the warning text) was computed with → the equation always adds up.
    var v = okSpeed(dz.speed_kmh) ? dz.speed_kmh : (measured ? live.avg : live.defaultSpeed);
    if (dz.next && !dz.in_deadzone) {
      setText(calc, U.fmtKm(dz.distance_km) + ' ÷ ' + fmtSpeed(v) + ' = ' + U.fmtDuration(dz.minutes));
    } else setText(calc, 'v̄ = ' + fmtSpeed(measured ? live.avg : v));
    var th = dz.threshold || NC.routing.THRESHOLDS[dz.mode] || NC.routing.THRESHOLDS.motorbike;
    var rule = dz.basis === 'time' ? t('bd.warn.rule_time', { min: th.minutes }) : t('bd.warn.rule_dist', { km: U.fmtKm(th.km) });
    var basisTxt = (measured ? t(dz.basis === 'time' ? 'bd.warn.basis_time' : 'bd.warn.basis_distance') : t('bd.warn.basis_idle')) +
      ' · ' + rule + (measured && dz.speed_default ? ' (v̄ = ' + t('bd.warn.default_speed') + ')' : '') +
      ' · ' + t('bd.warn.detected', { mode: modeLabel(live.detected) });
    setText(basis, basisTxt);
    U.$$('.bd-th__row', fx).forEach(function (r) { r.classList.toggle('is-active', r.getAttribute('data-mode') === live.detected); });
  }

  /* ---------------- simulator card ---------------- */
  function renderSimStatic() {
    var J = st.journey, el = st.el;
    if (!el.sPath) return;
    var pid = J ? J.id : defaultPathId();
    el.sPath.innerHTML = pathOptions().map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === pid ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
    st.sMode.set(sim.mode);
    st.sSpeed.set(String(sim.speedX));
    el.pAutonet.checked = !!st.prefs.autoNet;
    el.pHold.checked = !!st.prefs.hold;
    el.pVibrate.checked = !!st.prefs.vibrate;
    renderNotify();
    el.sStrip.innerHTML = '';
    if (!J) return;
    var strip = NC.viz.signalStrip(J.analysis, { pos_km: 0, showKm: true, height: 18 });
    el.sStrip.appendChild(strip);
    el.sStrip.setAttribute('role', 'slider');
    el.sStrip.setAttribute('tabindex', '0');
    el.sStrip.setAttribute('aria-label', t('bd.sim.strip_aria'));
    el.sStrip.setAttribute('aria-valuemin', '0');
    el.sStrip.setAttribute('aria-valuemax', String(U.round(J.analysis.length_km, 1)));
    ensureMap();
  }
  function ensureMap() {
    var J = st.journey, el = st.el.sMap;
    if (!J || !el || !window.L || !NC.mapkit) return;
    // Only when the "Chế độ demo" section is OPEN: Chrome lays out the content of a closed <details> (offsetWidth > 0),
    // and a hidden Leaflet map would still fetch OSM tiles nobody sees (OSM tile policy: normal viewing only, R4/R5).
    if (st.el.demo && !st.el.demo.open) return;
    if (!st.visible || !el.offsetWidth) return;
    try {
      if (!st.map) {
        st.map = NC.mapkit.create(el, { zoom: 8, center: [J.analysis.geometry[0][0], J.analysis.geometry[0][1]], scrollWheelZoom: false });
      }
      if (st.mapKey !== J.key) {
        st.mapKey = J.key;
        if (st.mapLayer) { st.map.removeLayer(st.mapLayer); st.mapLayer = null; }
        st.mapLayer = NC.mapkit.drawRoute(st.map, J.analysis, { weight: 5 });
        var ll = latLngAt(sim.pos) || { lat: J.analysis.geometry[0][0], lng: J.analysis.geometry[0][1] };
        if (!st.marker) st.marker = NC.mapkit.userMarker([ll.lat, ll.lng]).addTo(st.map);
        else st.marker.setLatLng([ll.lat, ll.lng]);
        NC.mapkit.fitTo(st.map, J.analysis.geometry, { padding: [18, 18] });
      }
      NC.mapkit.refresh(st.map);
    } catch (e) { console.warn('[buddy] map', e && e.message); }
  }
  function renderSimNote() {
    var el = st.el.sNote;
    if (!el) return;
    var s = st.session;
    el.innerHTML = s ? icon('clock', 'icon--xs') + '<span>' + esc(t('bd.sim.clock_note', { x: sim.speedX })) + '</span>'
      : icon('info', 'icon--xs') + '<span>' + esc(t('bd.sim.no_session')) + '</span>';
    el.classList.toggle('is-warn', !s);
    var holdOk = !!(s && s.status === 'active');
    st.el.pHold.disabled = !holdOk;
    setText(st.el.pHoldHint, holdOk ? t('bd.sim.hold_hint') : t('bd.sim.hold_na'));
  }
  function renderHold() {
    var el = st.el.sHold;
    if (!el) return;
    el.hidden = !sim.holding;
    if (!sim.holding) return;
    var s = st.session, msg, cls;
    if (s && s.status === 'active') {
      var end = Date.parse(s.next_due_at) + (s.grace_min || 0) * 60000;
      var left = end - Date.now();
      msg = left > 0 ? t('bd.hold.waiting', { t: fmtCountdown(left) }) : t('bd.hold.checking');
      cls = 'wait';
    } else {
      var noAlert = !s || !s.recipient_email || !!syncProblem(s);
      var simNote = noAlert ? null : emailSimNote(s);
      msg = noAlert ? t('bd.hold.fired_noalert')
        : !startAckOf(s) ? (simNote ? t('bd.hold.fired_q_sim', { sim: simNote }) : t('bd.hold.fired'))
        : simNote ? t('bd.hold.fired_sim', { sim: simNote }) : t('bd.hold.fired_srv');
      cls = 'fired';
    }
    var html = '<span class="icon-tile icon-tile--sm icon-tile--' + (cls === 'wait' ? 'warning' : 'danger') + '">' + icon(cls === 'wait' ? 'timer' : 'alert-triangle') + '</span>' +
      '<p class="bd-hold__msg">' + esc(msg) + '</p>' +
      '<button type="button" class="btn btn--sm btn--outline" data-bd="release">' + esc(t('bd.hold.release')) + '</button>';
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.setAttribute('data-tone', cls);
  }
  function renderLive() {
    if (!st.mounted) return;
    var J = st.journey, el = st.el;
    // play button
    var playing = sim.playing;
    var lbl = playing ? t('bd.sim.pause') : (sim.finished ? t('bd.sim.again') : (sim.started ? t('bd.sim.resume') : t('bd.sim.play')));
    var ph = icon(playing ? 'pause' : (sim.finished ? 'rotate-ccw' : 'play')) + '<span>' + esc(lbl) + '</span>';
    if (el.sPlay._h !== ph) { el.sPlay.innerHTML = ph; el.sPlay._h = ph; }
    el.sPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
    el.sPlay.disabled = !J;
    el.sSkip.disabled = !J;
    renderHold();
    renderWarnLive();
    if (!J) { el.sReadouts.innerHTML = ''; return; }
    var len = J.analysis.length_km;
    var live = sim.live || evaluate(sim.pos, { source: 'sim', samples: sim.samples, fallbackMode: sim.mode, warned: {}, noWarn: true });
    movePos(el.sStrip.querySelector('svg'), sim.pos, len);
    el.sStrip.setAttribute('aria-valuenow', String(U.round(sim.pos, 1)));
    el.sStrip.setAttribute('aria-valuetext', 'km ' + kmAt(sim.pos) + ' / ' + kmAt(len));
    if (st.marker) {
      var ll = latLngAt(sim.pos);
      if (ll) {
        st.marker.setLatLng([ll.lat, ll.lng]);
        if (st.map && (sim.playing || sim.holding)) {
          try { if (!st.map.getBounds().pad(-0.12).contains([ll.lat, ll.lng])) st.map.panTo([ll.lat, ll.lng], { animate: true, duration: 0.6 }); } catch (e) { /* ignore */ }
        }
      }
    }
    // network pill over the map
    var on = online();
    var sims = NC.net ? NC.net.simulated() : false;
    var q = st.ops.length;
    // Paused inside a dead zone: connectivity was handed back — say so, the strip still shows "lost" here.
    var pausedLost = on && sim.started && !playing && !sim.finished && live && live.level === 'lost';
    var net = '<span class="bd-net bd-net--' + (on ? 'on' : 'off') + '">' + icon(on ? 'wifi' : 'wifi-off', 'icon--sm') +
      '<span>' + esc(on ? t('bd.net.online') + (pausedLost ? ' · ' + t('bd.net.paused') : '') : t('bd.net.offline') + (sims ? ' · ' + t('bd.net.sim') : '')) + '</span></span>' +
      (q ? '<span class="bd-net bd-net--queue">' + icon('cloud-off', 'icon--sm') + '<span>' + esc(t('bd.net.queue', { n: q })) + '</span></span>' : '');
    if (el.sNet._h !== net) { el.sNet.innerHTML = net; el.sNet._h = net; }
    el.sim.classList.toggle('is-offline', !on);
    el.sim.classList.toggle('is-running', playing);
    // readouts
    var dz = live ? live.dz : null;
    var nextTxt = !dz ? '–' : dz.in_deadzone ? t('bd.ro.inside') : dz.next ? U.fmtKm(dz.distance_km) : t('bd.ro.none');
    var nextSub = dz && dz.next && !dz.in_deadzone ? '≈ ' + U.fmtDuration(dz.minutes) : (dz && dz.in_deadzone ? t('bd.warn.inside_left', { km: U.fmtKm(Math.max(0, dz.next.end_km - sim.pos)) }) : '');
    var lvl = live ? live.level : 'uncertain';
    var ro =
      roItem('km', t('bd.ro.km'), kmAt(sim.pos) + ' <small>/ ' + esc(U.fmtKm(len)) + '</small>', '') +
      roItem('level', t('bd.ro.level'), '<span class="signal-dot signal-dot--' + lvl + '" aria-hidden="true"></span><span class="bd-ro__txt">' + esc(t('common.sig.' + lvl)) + '</span>', '', 'bd-ro__item--' + lvl) +
      roItem('next', t('bd.ro.next'), esc(nextTxt), nextSub, dz && dz.should_warn ? 'bd-ro__item--warn' : '') +
      roItem('speed', t('bd.ro.speed'), esc(fmtSpeed(live && live.avg !== null ? live.avg : null)), live ? t('bd.warn.detected', { mode: modeLabel(live.detected) }) : '') +
      roItem('clock', t('bd.ro.clock'), esc(sim.simMs ? '+' + U.fmtDuration(sim.simMs / 60000) : '0'),
        sim.slowX && playing ? '×' + Math.max(1, Math.round(sim.slowX)) + ' · ' + t('bd.ro.slow') : '×' + sim.speedX) +
      roItem('queue', t('bd.ro.queue'), esc(String(q)), q && !on ? t('bd.tl.queued') : '', q ? 'bd-ro__item--queue' : '');
    if (el.sReadouts._h !== ro) { el.sReadouts.innerHTML = ro; el.sReadouts._h = ro; }
  }
  function roItem(key, label, valueHtml, sub, cls) {
    return '<div class="bd-ro__item ' + (cls || '') + '" data-ro="' + key + '"><dt>' + esc(label) + '</dt><dd>' + valueHtml +
      (sub ? '<small>' + esc(sub) + '</small>' : '') + '</dd></div>';
  }

  /* ================================================================== */
  /* EVENTS / WIRING                                                      */
  /* ================================================================== */
  function focusSection(which) {
    if (which === 'sim' || which === 'demo') openDemo();
    var target = which === 'setup' ? st.el.setup : which === 'sim' || which === 'demo' ? st.el.demo : which === 'timeline' ? st.el.timeline : null;
    if (!target || target.hidden) return;
    setTimeout(function () {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { target.scrollIntoView(); }
      if (which === 'setup') {
        var f = st.el, want = st.prefillFocus; st.prefillFocus = null;
        var i = want === 'email' ? f.fRemail : f.fRname && !f.fRname.value ? f.fRname : f.fRphone && !normPhone(f.fRphone.value).valid ? f.fRphone : f.fConsent;
        if (i) try { i.focus({ preventScroll: true }); } catch (x) { /* ignore */ }
      }
    }, 60);
  }
  /** Open the collapsed "Chế độ demo" section (journey simulator, formula, roadmap); the map needs a size first. */
  function openDemo() {
    var d = st.el.demo;
    if (d && !d.open) d.open = true;
  }
  function onDemoToggle() {
    if (!st.el.demo || !st.el.demo.open) return;
    ensureMap();
    if (st.map) NC.mapkit.refresh(st.map);
  }

  function onRootClick(e) {
    var b = e.target.closest ? e.target.closest('[data-bd]') : null;
    if (!b || !st.root.contains(b) || b.disabled) return;
    var a = b.getAttribute('data-bd');
    if (a === 'checkin') { NC.ui.setLoading(b, true); checkin().then(function () { NC.ui.setLoading(b, false); }, function () { NC.ui.setLoading(b, false); toast(t('common.error'), { type: 'danger' }); }); }
    else if (a === 'location') sendLocation().catch(function () { toast(t('common.error'), { type: 'danger' }); });
    else if (a === 'sos') sos({ source: 'buddy' }).catch(function () { });
    else if (a === 'sms') openSms();
    else if (a === 'stop') stopSession();
    else if (a === 'setup') focusSection('setup');
    else if (a === 'reveal') {
      // With a reveal code, "Show all" goes through the same hold + code gate as MOD.03 (shared lockout).
      if (!st.reveal && idProtected() && NC.qr && typeof NC.qr.gateIdentity === 'function') {
        NC.qr.gateIdentity({ reason: 'show' }).then(function (ok) { if (ok && st.visible) { st.reveal = true; renderRcp(); } });
      } else { st.reveal = !st.reveal; renderRcp(); }
    }
    else if (a === 'more') { st.showAll = true; renderTimeline(); }
    else if (a === 'release') releaseHold('manual');
    else if (a === 'restart') restartSetup().catch(function () { toast(t('common.error'), { type: 'danger' }); });
    else if (a === 'add-email') restartSetup(true).catch(function () { toast(t('common.error'), { type: 'danger' }); });
    else if (a === 'demo-alert') demoAlert().catch(function (x) { console.warn('[buddy] demo reminder', x && x.message); });
    else if (a === 'trip-stop') { if (NC.trip) NC.trip.stop('user'); }
    else if (a === 'open-map') NC.app.go('map');
    else if (a === 'flush') {
      NC.ui.setLoading(b, true);
      NC.data.flush().then(function (r) { toast(tn('bd.sync.done', (r && r.sent) || 0), { type: 'success', timeout: 2200 }); }).catch(function () { })
        .then(function () { refreshSoon(); });
    }
  }

  function wire() {
    var el = st.el;
    st.root.addEventListener('click', onRootClick);
    el.form.addEventListener('submit', submitSetup);
    // Phone (required) / e-mail (optional): validate on blur only once something was typed — no error while the
    // traveller is still filling in the form; submit checks the empty phone.
    el.fRphone.addEventListener('blur', function () {
      if (!el.fRphone.value.trim()) return;
      var v = normPhone(el.fRphone.value);
      var key = phoneError(el.fRphone.value);   // 02x landline → "enter a mobile number"
      fieldError(el.fldRphone, !!key, key || undefined);
      if (v.valid && el.fRphone.value !== v.display) el.fRphone.value = v.display;
    });
    el.fRemail.addEventListener('blur', function () {
      var err = emailError(el.fRemail.value);
      fieldError(el.fldRemail, !!err, err || undefined);
    });
    [el.fRname, el.fRemail, el.fRphone].forEach(function (inp) {
      inp.addEventListener('input', function () { fieldError(inp.closest('.field'), false); });
    });
    el.fRemail.addEventListener('input', function () { renderShareNa(); renderEmailHint(); });
    if (el.demo) el.demo.addEventListener('toggle', onDemoToggle);
    // "Lịch demo nhanh" (Chế độ demo): the 2 min / 1 min chips join the setup form only while it is on.
    if (el.pDemoSched) el.pDemoSched.addEventListener('change', function () {
      st.demoSched = !!el.pDemoSched.checked;
      renderSetup(true, st.demoSched ? 'demo' : null);
      if (st.demoSched && !st.session) toast(t('bd.demo.sched_on'), { type: 'info', timeout: 3500 });
    });
    el.fConsent.addEventListener('change', function () { if (el.fConsent.checked) fieldError(el.fldConsent, false); });
    wireChips(el.fInterval);
    wireChips(el.fGrace);
    st.fMode = NC.ui.segmented(el.fMode, {});
    st.sMode = NC.ui.segmented(el.sModeSeg, { onChange: function (v) {
      sim.mode = v === 'hiking' ? 'hiking' : 'motorbike'; st.prefs.mode = sim.mode; savePrefs();
      sim.samples = [];
      Object.keys(sim.warned).forEach(function (k) { if (+k.slice(1) > sim.pos) delete sim.warned[k]; });
      slog('mode', { mode: sim.mode });
      renderLive();
    } });
    st.sSpeed = NC.ui.segmented(el.sSpeed, { onChange: function (v) {
      sim.speedX = +v || 60; st.prefs.speedX = sim.speedX; savePrefs(); renderSimNote(); renderLive();
    } });
    el.sPath.addEventListener('change', function () {
      st.prefs.path = el.sPath.value; savePrefs();
      simReset();
      ensureJourney(true);
    });
    el.sPlay.addEventListener('click', function () { if (sim.playing) simPause(); else simPlay(); });
    el.sSkip.addEventListener('click', simSkip);
    el.sReset.addEventListener('click', function () { simReset(); });
    el.sStrip.addEventListener('click', function (e) {
      var J = st.journey; if (!J) return;
      var r = el.sStrip.getBoundingClientRect();
      if (!r.width) return;
      simSeek((e.clientX - r.left) / r.width * J.analysis.length_km);
    });
    el.sStrip.addEventListener('keydown', function (e) {
      var J = st.journey; if (!J) return;
      var step = J.analysis.length_km > 60 ? 5 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); simSeek(sim.pos + step); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); simSeek(sim.pos - step); }
      else if (e.key === 'Home') { e.preventDefault(); simSeek(0); }
      else if (e.key === 'End') { e.preventDefault(); simSeek(J.analysis.length_km); }
    });
    el.pAutonet.addEventListener('change', function () {
      st.prefs.autoNet = el.pAutonet.checked; savePrefs();
      if (!st.prefs.autoNet) restoreNet();
      else if (sim.inLost) { sim.inLost = false; syncLevel(false); }
    });
    el.pHold.addEventListener('change', function () { st.prefs.hold = el.pHold.checked; savePrefs(); if (!st.prefs.hold) releaseHold('option_off'); });
    el.pVibrate.addEventListener('change', function () {
      st.prefs.vibrate = el.pVibrate.checked; savePrefs();
      if (NC.trip && NC.trip.setPrefs) NC.trip.setPrefs({ vibrate: st.prefs.vibrate });
      if (st.prefs.vibrate) U.vibrate(30);
    });
    // System notifications of the reminders (NC.trip): off → NC.trip's switch; on → ask the permission (inside the tap).
    el.pNotify.addEventListener('change', function () {
      if (!NC.trip || !NC.trip.setPrefs || !('Notification' in window)) { el.pNotify.checked = false; renderNotify(); return; }
      NC.trip.setPrefs({ notify: !!el.pNotify.checked });
      if (!el.pNotify.checked) { renderNotify(); return; }
      NC.trip.askPermission().then(renderNotify, renderNotify);
    });
  }

  function mount(section) {
    var root = section.querySelector('#bd-root');
    if (!root) {
      // Partial not stitched (e.g. before integration): build a minimal notice instead of failing.
      section.appendChild(NC.ui.emptyState({ icon: 'shield-check', variant: 'primary', title: t('bd.title'), text: t('app.placeholder') }));
      return;
    }
    st.root = root;
    var $ = function (id) { return root.querySelector('#' + id); };
    st.el = {
      hero: $('bd-hero'), actions: $('bd-actions'), setup: $('bd-setup'), rcp: $('bd-rcp'), rcpBody: $('bd-rcp-body'),
      timeline: $('bd-timeline'), tlList: $('bd-tl-list'), tlSub: $('bd-tl-sub'),
      form: $('bd-form'), fTraveler: $('bd-f-traveler'), fRname: $('bd-f-rname'), fRemail: $('bd-f-remail'), fRphone: $('bd-f-rphone'),
      fldRname: $('bd-fld-rname'), fldRemail: $('bd-fld-remail'), fldRphone: $('bd-fld-rphone'), fldConsent: $('bd-fld-consent'),
      fInterval: $('bd-f-interval'), fGrace: $('bd-f-grace'), fRoute: $('bd-f-route'), fMode: $('bd-f-mode'),
      fShare: $('bd-f-share'), fShareNa: $('bd-f-share-na'), fConsent: $('bd-f-consent'), fSubmit: $('bd-f-submit'),
      fRemailHint: $('bd-f-remail-hint'), demo: $('bd-demo'), demoFormula: $('bd-demo-formula'),
      warnBody: $('bd-warn-body'), warnPath: $('bd-warn-path'),
      pNotify: $('bd-p-notify'), pNotifyHint: $('bd-p-notify-hint'), pVibrate: $('bd-p-vibrate'), trip: $('bd-trip'),
      sim: $('bd-sim'), sPath: $('bd-s-path'), sModeSeg: $('bd-s-mode'), sSpeed: $('bd-s-speed'), sPlay: $('bd-s-play'),
      sSkip: $('bd-s-skip'), sReset: $('bd-s-reset'), sMap: $('bd-s-map'), sNet: $('bd-s-net'), sStrip: $('bd-s-strip'),
      sHold: $('bd-s-hold'), sReadouts: $('bd-s-readouts'), sNote: $('bd-s-note'),
      pAutonet: $('bd-p-autonet'), pHold: $('bd-p-hold'), pHoldHint: $('bd-p-hold-hint'), pDemoSched: $('bd-p-demosched'), live: $('bd-live')
    };
    wire();
    if (NC.i18n) NC.i18n.apply(root);
    // No medical disclaimer here (round 2 R1): MOD.04 shows no medical content; the 115 button stays in the shell.
    st.mounted = true;
    renderWarn();
    renderTrip();
    renderSimStatic();
    renderState();
  }

  function show(params) {
    st.visible = true;
    Promise.all([ready(), loadPlan()]).then(function () {
      return refresh();
    }).then(function () {
      return ensureJourney();
    }).then(function () {
      ensureMap();
      renderLive();
      if (params && params.focus) focusSection(params.focus);
      else if (params && params.setup && !st.session) focusSection('setup');
    }).catch(function (e) { console.warn('[buddy] show', e); });
    if (st.map) NC.mapkit.refresh(st.map);
    renderState();
  }
  /* Leaving the screen ends the ride: the simulator never keeps the app offline behind the traveller's back. */
  function hide() {
    st.visible = false;
    sim.resumeAfterModal = false;   // a reminder popup left open over another screen must not restart the ride
    if (st.reveal) { st.reveal = false; if (st.mounted) renderRcp(); }
    if (sim.playing) simPause();
    else releaseNet(true);
  }

  function loadPlan() {
    if (!NC.store) return Promise.resolve();
    return NC.store.get(MAP_ROUTE_KEY).then(function (p) {
      var ok = p && typeof p === 'object' && p.from !== undefined && p.to !== undefined;
      var changed = JSON.stringify(ok ? p : null) !== JSON.stringify(st.plan);
      st.plan = ok ? p : null;
      st.tripPlan = p && typeof p === 'object' && p.plan && typeof p.plan === 'object' ? p.plan : null;   // contract C2
      if (changed && st.prefs.path === 'plan' && !st.plan) st.prefs.path = null;
    }).catch(function () { });
  }

  var readyP = null;
  function ready() {
    if (!readyP) readyP = loadPrefs().then(function () { return NC.data && NC.data.init ? NC.data.init() : null; });
    return readyP;
  }

  /* ================================================================== */
  /* GLOBAL LISTENERS                                                     */
  /* ================================================================== */
  if (NC.bus) {
    NC.bus.on('buddy:update', function () { refreshSoon(); });
    NC.bus.on('buddy:event', onEvent);
    NC.bus.on('data:outbox', function () { refreshSoon(); });
    NC.bus.on('data:sync', function (p) { if (p && (p.sent || p.failed)) slog('sync', { sent: p.sent, failed: p.failed, outbox: p.outboxCount }); refreshSoon(); });
    NC.bus.on('net:change', function (s) {
      // The user switched simulated offline off (banner "Tắt giả lập" / connection sheet) or took it over: not ours any more.
      if (sim.netOwned && !sim.netWriting && NC.net && (!NC.net.simulated() || (netOwnerApi() && NC.net.simulatedOwner() !== 'simulator'))) {
        sim.netOwned = false;
        if (!netOwnerApi() && NC.settings && NC.settings.get(SIM_NET_FLAG)) NC.settings.set(SIM_NET_FLAG, false);
      }
      slog(s && s.online ? 'net_online' : 'net_offline', { simulated: !!(s && s.simulated) });
      if (st.mounted) { renderLive(); renderTimeline(); renderRcp(); tickHero(); }
    });
    NC.bus.on('data:op_error', onOpError);
    // Local ↔ Supabase decides whether e-mails are real or simulated (texts of the hero, form, recipient card, log).
    NC.bus.on('data:mode', function () { if (st.mounted) { renderHero(true); renderSetup(); renderRcp(); renderTimeline(); } });
    NC.bus.on('consents:change', function () { refreshSoon(); });
    NC.bus.on('profile:update', function () { refreshSoon(); });
    NC.bus.on('settings:change', function (p) {
      if (!p) return;
      if (p.key === 'carrier' || (p.key === 'route_id' && !(st.journey && st.journey.planned) && !st.prefs.path)) {
        if (sim.started) simReset();
        if (st.mounted || st.journey) ensureJourney(true);
      } else if (p.key === 'last_position' && st.mounted && !sim.started) renderWarnLive();
    });
    NC.bus.on('trip:update', function () { if (st.mounted) { renderTrip(); renderWarnLive(); } });
    // the notification prompt may be answered long after "Bắt đầu đi" (MOD.02): keep the switch truthful
    NC.bus.on('trip:permission', function () { if (st.mounted) renderNotify(); });
    NC.bus.on('i18n:change', function () {
      if (!st.mounted) return;
      renderHero(true); renderSetup(true); renderRcp(); renderTimeline(); renderWarn(); renderTrip(); renderSimStatic(); renderSimNote();
      st.el.sPlay._h = null; renderLive();
    });
    NC.bus.on('map:route', function () {
      loadPlan().then(function () { if (defaultPathId() === 'plan' && (st.mounted || st.journey)) { if (sim.started) simReset(); ensureJourney(true); } else if (st.mounted) renderSimStatic(); });
    });
    NC.bus.on('data:pack', function (p) { if (st.journey && p && p.route_id === st.journey.route_id && p.carrier === st.journey.carrier) ensureJourney(true); });
  }
  // Toasts on status changes must work from any screen once the app has booted.
  function afterBoot() {
    var p = NC.boot && NC.boot.done && NC.boot.done.then ? NC.boot.done : Promise.resolve();
    p.then(function () {
      // Owner-aware NC.net: boot.js resets a stale simulator-owned offline (A8); older NC.net: our own marker.
      try { recoverSimNet(); } catch (e) { /* ignore */ }
      return ready().then(refresh);
    }).catch(function () { });
  }
  window.addEventListener('pagehide', function () {
    if (sim.playing) simPause();
    releaseNet(false);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', afterBoot);
  else setTimeout(afterBoot, 0);

  /* ================================================================== */
  /* PUBLIC API + SCREEN                                                  */
  /* ================================================================== */
  NC.buddy = {
    sos: sos,
    open: function () { if (NC.emergency && NC.emergency.close) NC.emergency.close(); NC.app.go('buddy'); },
    checkin: checkin,
    sendLocation: sendLocation,
    openDemo: function () { focusSection('demo'); },
    focusSetup: function () { focusSection('setup'); },
    demoAlert: demoAlert,
    /* Contract for Home (F-SHELL): the same phase / status / ring as this screen. phaseOf is pure. */
    phaseOf: phaseOf,
    statusOf: statusOf,
    state: function () {
      return { session: st.session, events: st.events.length, queuedOps: st.ops.length, phase: phaseOf(st.session, Date.now()),
        problem: st.session ? (syncProblem(st.session) || null) : null,
        trip: NC.trip && NC.trip.current ? !!NC.trip.current() : false,
        journey: st.journey ? { id: st.journey.id, route_id: st.journey.route_id, carrier: st.journey.carrier, length_km: st.journey.analysis.length_km, zones: st.journey.analysis.zones.length } : null };
    },
    // Scripted demo (mockups / judges' console): the simulator lives in "Chế độ demo" → open it so its map is shown.
    sim: {
      play: function () { openDemo(); simPlay(); }, pause: function () { simPause(); }, reset: function () { simReset(); },
      skip: function () { openDemo(); simSkip(); }, seek: function (km) { openDemo(); simSeek(km); },
      setMode: function (m) { if (st.sMode) { st.sMode.set(m); } sim.mode = m === 'hiking' ? 'hiking' : 'motorbike'; sim.samples = []; },
      setSpeed: function (x) { sim.speedX = SPEED_X.indexOf(+x) >= 0 ? +x : 60; if (st.sSpeed) st.sSpeed.set(String(sim.speedX)); },
      setPath: function (id) { st.prefs.path = id; simReset(); return ensureJourney(true); },
      state: function () {
        return { playing: sim.playing, holding: sim.holding, pos_km: U.round(sim.pos, 3), sim_min: Math.round(sim.simMs / 60000), mode: sim.mode, speedX: sim.speedX,
          inLost: sim.inLost, slowX: sim.slowX, online: online(), netOwned: sim.netOwned, warnings: sim.warnings.slice(), live: sim.live ? { level: sim.live.level, avg: sim.live.avg, detected: sim.live.detected, basis: sim.live.dz.basis, next: sim.live.dz.next, distance_km: sim.live.dz.distance_km } : null };
      },
      log: function () { return sim.log.slice(); }
    }
  };

  /* Contract C3: the recipient phone normaliser (same rules as the server). NC.ui is the shell's (W2): only filled in
     when it has no normaliser of its own. */
  NC.buddyPhone = { norm: normPhone, pretty: prettyPhone, mask: maskPhone };
  if (NC.ui && !NC.ui.normPhone) NC.ui.normPhone = normPhone;

  if (NC.app && NC.app.register) {
    NC.app.register('buddy', { titleKey: 'app.title.buddy', shortTitleKey: 'app.title_short.buddy', mount: mount, show: show, hide: hide });
  }
})(window.NC = window.NC || {});
