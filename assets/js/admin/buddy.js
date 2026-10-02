/*
 * buddy.js — Admin page "buddy" (owner: admin-pages): live Buddy Check-in monitor. Sessions overdue-first with live
 * countdowns, detail panel (last-location map + signal level per carrier, recipient, consented public medical layer,
 * event timeline), "Gửi cảnh báo ngay" (NC.data.admin.triggerAlert) and "Đánh dấu đã xử lý" (resolveSession),
 * realtime via NC.data.admin.subscribe, optional sound/system notification on new overdue/SOS.
 * Public API: none (registers NC.admin page 'buddy'; nav badge = overdue + alerted sessions). Uses NC.adp (signal.js).
 */
(function (NC) {
  'use strict';

  var kit = NC.adp;
  if (!kit) { console.warn('[admin/buddy] NC.adp kit missing (signal.js must load first)'); return; }
  var U = NC.util, t = kit.t, esc = kit.esc, h = kit.h, icon = kit.icon;

  NC.i18n.add({
    vi: {
      'ad.bud.nav': 'Giám sát Buddy', 'ad.bud.nav_short': 'Buddy',
      'ad.bud.title': 'Giám sát Buddy Check-in',
      'ad.bud.subtitle': 'Dead-man switch: phiên quá hạn được máy chủ phát hiện (cron mỗi phút) và gửi email cho người nhận. Theo dõi trực tiếp, gửi cảnh báo thủ công, đóng phiên khi đã xác nhận an toàn.',
      'ad.bud.refresh': 'Làm mới',
      'ad.bud.alerts_on': 'Âm thanh & thông báo',
      'ad.bud.alerts_hint': 'Phát âm báo và thông báo hệ thống khi có phiên mới quá hạn hoặc SOS',
      'ad.bud.k_overdue': 'Quá hạn',
      'ad.bud.k_overdue_sub': '{a} đã gửi cảnh báo · {b} chờ gửi',
      'ad.bud.k_soon': 'Sắp đến hạn',
      'ad.bud.k_soon_sub': 'trong 15 phút tới',
      'ad.bud.k_active': 'Đang theo dõi',
      'ad.bud.k_active_sub': 'phiên hoạt động',
      'ad.bud.k_closed': 'Đã đóng 24 giờ',
      'ad.bud.k_closed_sub': 'kết thúc / đã xử lý',
      'ad.bud.f_all': 'Tất cả',
      'ad.bud.f_attention': 'Cần xử lý',
      'ad.bud.f_active': 'Đang theo dõi',
      'ad.bud.f_closed': 'Đã đóng',
      'ad.bud.search': 'Tìm người đi hoặc người nhận…',
      'ad.bud.st_overdue': 'QUÁ HẠN',
      'ad.bud.st_alerted': 'Đã gửi cảnh báo',
      'ad.bud.st_late': 'Trễ · trong ân hạn',
      'ad.bud.st_soon': 'Sắp đến hạn',
      'ad.bud.st_active': 'Đang theo dõi',
      'ad.bud.st_closed': 'Đã kết thúc',
      'ad.bud.lbl_overdue': 'quá hạn',
      'ad.bud.lbl_due': 'đến hạn',
      'ad.bud.lbl_grace': 'hết ân hạn',
      'ad.bud.last_checkin': 'Check-in {rel}',
      'ad.bud.no_checkin': 'Chưa check-in',
      'ad.bud.list_empty': 'Không có phiên phù hợp',
      'ad.bud.list_empty_t': 'Phiên Buddy mới từ thiết bị sẽ xuất hiện ở đây theo thời gian thực.',
      'ad.bud.pick': 'Chọn một phiên để xem chi tiết',
      'ad.bud.pick_t': 'Phiên quá hạn luôn nằm đầu danh sách, tô đỏ.',
      'ad.bud.back': 'Danh sách',
      'ad.bud.hero_overdue': 'Quá hạn check-in',
      'ad.bud.hero_alerted': 'Đã gửi cảnh báo',
      'ad.bud.hero_late': 'Đã qua hạn · còn ân hạn',
      'ad.bud.hero_due': 'Đến hạn check-in sau',
      'ad.bud.hero_closed': 'Phiên đã kết thúc',
      'ad.bud.hero_line': 'Check-in cuối {last} · hạn {due} + {grace} ân hạn',
      'ad.bud.hero_alerted_line': 'Email cảnh báo gửi {at} tới {to}. Chờ người nhận/cơ quan xác nhận.',
      'ad.bud.hero_closed_line': 'Đóng lúc {at}.',
      'ad.bud.alert_now': 'Gửi cảnh báo ngay',
      'ad.bud.alert_again': 'Gửi lại cảnh báo',
      'ad.bud.alert_again_t': 'Gửi lại cảnh báo cho người nhận của {name}?',
      'ad.bud.hint_overdue': 'Chưa gửi email cảnh báo. Máy chủ sẽ tự gửi ở lượt cron kế tiếp — hoặc bấm “Gửi cảnh báo ngay”.',
      'ad.bud.hint_alerted_cron': 'Máy chủ đã tự động gửi email (cron). “Gửi lại cảnh báo” gửi thêm một email thủ công tới người nhận.',
      'ad.bud.hint_alerted_manual': 'Email đã được gửi thủ công. “Gửi lại cảnh báo” gửi thêm một email tới người nhận.',
      'ad.bud.hint_alerted_plain': 'Email cảnh báo đã được gửi. “Gửi lại cảnh báo” gửi thêm một email thủ công tới người nhận.',
      'ad.bud.resolve': 'Đánh dấu đã xử lý',
      'ad.bud.alert_t': 'Gửi cảnh báo cho người nhận của {name}?',
      'ad.bud.alert_m': 'Email song ngữ gồm thời gian từ lần check-in cuối, vị trí cuối, cung đường, phương tiện{medical} và hướng dẫn gọi 112/115 sẽ được gửi tới {to}.',
      'ad.bud.alert_m_med': ', lớp y tế công khai (đã được đồng ý)',
      'ad.bud.alert_ok': 'Đã gửi cảnh báo tới {to}{sim}.',
      'ad.bud.alert_sim': ' (mô phỏng — chế độ demo cục bộ)',
      'ad.bud.alert_none': 'Không gửi: phiên đã đóng hoặc thiếu email người nhận.',
      'ad.bud.resolve_t': 'Đóng phiên của {name}',
      'ad.bud.resolve_m': 'Chỉ đóng khi đã xác nhận người đi an toàn. Nếu đã gửi cảnh báo, người nhận sẽ nhận email "đã an toàn".',
      'ad.bud.resolve_note': 'Ghi chú xử lý',
      'ad.bud.resolve_ph': 'Ví dụ: đã gọi được người nhận, người đi đã tới Phan Dũng…',
      'ad.bud.q1': 'Đã liên lạc được người đi',
      'ad.bud.q2': 'Người nhận xác nhận an toàn',
      'ad.bud.q3': 'Cứu hộ địa phương đã tiếp cận',
      'ad.bud.q4': 'Mất sóng, đã có check-in lại',
      'ad.bud.resolved_ok': 'Đã đóng phiên của {name}.',
      'ad.bud.resolved_clear': ' Đã gửi email báo an toàn cho người nhận.',
      'ad.bud.map_title': 'Vị trí cuối',
      'ad.bud.map_none': 'Chưa có toạ độ nào được gửi.',
      'ad.bud.loc_line': '{coords} · ±{acc} m · {rel}',
      'ad.bud.loc_line_noacc': '{coords} · {rel}',
      'ad.bud.sig_at': 'Lớp sóng tại vị trí cuối',
      'ad.bud.sig_hint': 'Mất sóng tại vị trí cuối có thể giải thích việc trễ check-in — nhưng không loại trừ tai nạn. Ưu tiên liên lạc người nhận và cơ quan địa phương.',
      'ad.bud.sig_off': 'cách tuyến {d}',
      'ad.bud.copy_coords': 'Sao chép toạ độ',
      'ad.bud.open_osm': 'Mở OpenStreetMap',
      'ad.bud.copied': 'Đã sao chép toạ độ',
      'ad.bud.info': 'Thông tin phiên',
      'ad.bud.i_recipient': 'Người nhận',
      'ad.bud.i_email': 'Email',
      'ad.bud.i_phone': 'Điện thoại',
      'ad.bud.i_interval': 'Chu kỳ check-in',
      'ad.bud.i_grace': 'Ân hạn',
      'ad.bud.i_route': 'Cung đường',
      'ad.bud.i_mode': 'Phương tiện',
      'ad.bud.i_started': 'Bắt đầu',
      'ad.bud.i_session': 'Mã phiên',
      'ad.bud.reveal': 'Hiện liên hệ',
      'ad.bud.hide': 'Ẩn liên hệ',
      'ad.bud.call': 'Gọi',
      'ad.bud.mode_motorbike': 'Xe máy',
      'ad.bud.mode_hiking': 'Đi bộ / trekking',
      'ad.bud.med_title': 'Lớp y tế công khai',
      'ad.bud.med_consent': 'Người đi đã đồng ý gửi kèm trong cảnh báo',
      'ad.bud.med_none': 'Không chia sẻ (mặc định). Hồ sơ y tế được mã hoá trên máy, không bao giờ tải lên máy chủ.',
      'ad.bud.med_blood': 'Nhóm máu',
      'ad.bud.med_allergies': 'Dị ứng',
      'ad.bud.med_conditions': 'Bệnh nền',
      'ad.bud.med_medications': 'Thuốc đang dùng',
      'ad.bud.timeline': 'Dòng sự kiện',
      'ad.bud.timeline_sub': '{n} sự kiện · mới nhất trên cùng',
      'ad.bud.ev_start': 'Bắt đầu phiên',
      'ad.bud.ev_checkin': 'Check-in “Tôi ổn”',
      'ad.bud.ev_location': 'Gửi vị trí',
      'ad.bud.ev_pre_deadzone': 'Sắp vào vùng mất sóng',
      'ad.bud.ev_sos': 'SOS',
      'ad.bud.ev_overdue': 'Quá hạn check-in',
      'ad.bud.ev_alert_sent': 'Đã gửi email cảnh báo',
      'ad.bud.ev_all_clear': 'Đã gửi email báo an toàn',
      'ad.bud.ev_alert_failed': 'Gửi cảnh báo thất bại',
      'ad.bud.ev_stop': 'Kết thúc phiên',
      'ad.bud.ev_resolved': 'Đã xác nhận an toàn',
      'ad.bud.ev_queued': 'Gửi trễ {d} từ hàng đợi offline',
      'ad.bud.ev_delivered': 'Đã tới máy chủ',
      'ad.bud.ev_server': 'Máy chủ phát hiện',
      'ad.bud.ev_to': 'tới {to}',
      'ad.bud.ev_manual': 'thủ công',
      'ad.bud.ev_cron': 'tự động (cron)',
      'ad.bud.ev_by': 'bởi {who}',
      'ad.bud.ev_reason_sos': 'lý do: SOS',
      'ad.bud.ev_reason_overdue': 'lý do: quá hạn',
      'ad.bud.ev_reason_manual': 'lý do: gửi thủ công',
      'ad.bud.ev_sim': 'mô phỏng',
      'ad.bud.ev_med': 'kèm lớp y tế',
      'ad.bud.ev_last_known': 'vị trí gần nhất đã biết',
      'ad.bud.dz_ahead': 'còn ~{d} tới vùng mất sóng',
      'ad.bud.dz_ahead_eta': 'còn ~{d} (~{m}) tới vùng mất sóng',
      'ad.bud.dz_zone': 'vùng mất sóng km {a}–{b}',
      'ad.bud.dz_sent': 'gửi vị trí trước khi vào vùng mất sóng',
      'ad.bud.ev_none': 'Chưa có sự kiện.',
      'ad.bud.new_overdue': 'QUÁ HẠN: {name} chưa check-in',
      'ad.bud.new_sos': 'SOS từ {name} — cần hỗ trợ ngay',
      'ad.bud.new_session': 'Phiên mới: {name}',
      'ad.bud.notif_denied': 'Trình duyệt chặn thông báo — vẫn phát âm báo trong trang.',
      'ad.bud.medical_badge': 'Có lớp y tế',
      'ad.bud.demo_note': 'Phiên minh hoạ của người đi khác (đã rebase theo thời gian thực). Trong chế độ cục bộ, email được mô phỏng; cron chạy mỗi 15 giây.',
      'ad.bud.st_sos': 'SOS',
      'ad.bud.st_failed': 'Gửi lỗi',
      'ad.bud.k_overdue_sos': 'SOS · Quá hạn',
      'ad.bud.k_overdue_sub_sos': '{s} SOS · {a} đã gửi cảnh báo · {b} chờ gửi',
      'ad.bud.lbl_since_sos': 'từ khi SOS',
      'ad.bud.lbl_since_alert': 'từ khi cảnh báo',
      'ad.bud.hero_sos': 'SOS · cần trợ giúp ngay',
      'ad.bud.hero_sos_line': 'SOS lúc {at}. Chưa gửi email cảnh báo cho người nhận — máy chủ sẽ tự gửi, hoặc gửi ngay bằng nút bên cạnh.',
      'ad.bud.hero_sos_alerted_line': 'SOS lúc {at}. Email báo SOS đã gửi {sent} tới {to}. Liên hệ người nhận và cứu hộ địa phương.',
      'ad.bud.hero_failed': 'Lần gửi cảnh báo gần nhất thất bại ({err}) — người nhận CHƯA được báo.',
      'ad.bud.alert_m_sos': 'Email song ngữ báo SOS (không phải trễ check-in) gồm vị trí cuối, cung đường, phương tiện{medical} và hướng dẫn gọi 112/115 sẽ được gửi tới {to}.',
      'ad.bud.alert_failed_toast': 'Gửi cảnh báo thất bại: {err}. Người nhận CHƯA được báo — hãy gọi trực tiếp.',
      'ad.bud.alert_failed_unknown': 'lỗi không rõ',
      'ad.bud.new_alert_failed': 'Gửi cảnh báo về {name} thất bại — người nhận chưa được báo',
      'ad.bud.ev_reason_send_failed': 'lỗi gửi email',
      'ad.bud.ev_reason_rate_limited': 'vượt giới hạn 3 email/24 giờ cho người nhận này',
      'ad.bud.ev_error': 'lỗi: {e}',
      'ad.bud.st_lost': 'MẤT LIÊN LẠC',
      'ad.bud.hero_lost': 'Mất liên lạc bất thường',
      'ad.bud.hero_lost_line': 'Ứng dụng đang mở nhưng không gửi tín hiệu từ {at} ({rel}) — ngoài vùng mất sóng dự kiến. Check-in tiếp theo: {due}.',
      'ad.bud.lbl_since_signal': 'từ tín hiệu cuối',
      'ad.bud.ev_contact_lost': 'Mất liên lạc bất thường',
      'ad.bud.ev_reason_contact_lost': 'lý do: mất liên lạc bất thường',
      'ad.bud.i_heartbeat': 'Tín hiệu ứng dụng',
      'ad.bud.hb_live': 'Đang mở · {at} ({rel})', 'ad.bud.hb_paused': 'Tạm dừng (ứng dụng ẩn) · {at} ({rel})',
      'ad.bud.hb_none': 'Chưa có tín hiệu (bản ứng dụng cũ hoặc chưa mở)',
      'ad.bud.hb_silence': 'Có thể im lặng tới {at} (vùng mất sóng dự kiến)',
      'ad.bud.ev_last_signal': 'tín hiệu cuối {at} ({rel})'
    },
    en: {
      'ad.bud.nav': 'Buddy monitor', 'ad.bud.nav_short': 'Buddy',
      'ad.bud.title': 'Buddy Check-in monitor',
      'ad.bud.subtitle': 'Dead-man switch: overdue sessions are detected server-side (cron every minute) and the recipient is e-mailed. Watch live, send a manual alert, close a session once the traveller is confirmed safe.',
      'ad.bud.refresh': 'Refresh',
      'ad.bud.alerts_on': 'Sound & notifications',
      'ad.bud.alerts_hint': 'Beep and show a system notification when a session becomes overdue or sends SOS',
      'ad.bud.k_overdue': 'Overdue',
      'ad.bud.k_overdue_sub': '{a} alerted · {b} awaiting alert',
      'ad.bud.k_soon': 'Due soon',
      'ad.bud.k_soon_sub': 'within 15 minutes',
      'ad.bud.k_active': 'Monitoring',
      'ad.bud.k_active_sub': 'active sessions',
      'ad.bud.k_closed': 'Closed 24 h',
      'ad.bud.k_closed_sub': 'stopped / resolved',
      'ad.bud.f_all': 'All',
      'ad.bud.f_attention': 'Needs action',
      'ad.bud.f_active': 'Monitoring',
      'ad.bud.f_closed': 'Closed',
      'ad.bud.search': 'Search traveller or recipient…',
      'ad.bud.st_overdue': 'OVERDUE',
      'ad.bud.st_alerted': 'Alert sent',
      'ad.bud.st_late': 'Late · in grace',
      'ad.bud.st_soon': 'Due soon',
      'ad.bud.st_active': 'Monitoring',
      'ad.bud.st_closed': 'Closed',
      'ad.bud.lbl_overdue': 'overdue',
      'ad.bud.lbl_due': 'due in',
      'ad.bud.lbl_grace': 'grace ends',
      'ad.bud.last_checkin': 'Check-in {rel}',
      'ad.bud.no_checkin': 'No check-in yet',
      'ad.bud.list_empty': 'No matching sessions',
      'ad.bud.list_empty_t': 'New Buddy sessions from devices appear here in real time.',
      'ad.bud.pick': 'Pick a session to see details',
      'ad.bud.pick_t': 'Overdue sessions always sit at the top, in red.',
      'ad.bud.back': 'Sessions',
      'ad.bud.hero_overdue': 'Check-in overdue',
      'ad.bud.hero_alerted': 'Alert sent',
      'ad.bud.hero_late': 'Past due · grace running',
      'ad.bud.hero_due': 'Check-in due in',
      'ad.bud.hero_closed': 'Session closed',
      'ad.bud.hero_line': 'Last check-in {last} · due {due} + {grace} grace',
      'ad.bud.hero_alerted_line': 'Alert e-mail sent {at} to {to}. Waiting for the recipient/authorities to confirm.',
      'ad.bud.hero_closed_line': 'Closed at {at}.',
      'ad.bud.alert_now': 'Send alert now',
      'ad.bud.alert_again': 'Send alert again',
      'ad.bud.alert_again_t': 'Send the alert again to the recipient of {name}?',
      'ad.bud.hint_overdue': 'No alert e-mail yet. The server sends it on the next cron run — or press “Send alert now”.',
      'ad.bud.hint_alerted_cron': 'The server already sent the e-mail automatically (cron). “Send alert again” sends one more e-mail to the recipient manually.',
      'ad.bud.hint_alerted_manual': 'The e-mail was sent manually. “Send alert again” sends one more e-mail to the recipient.',
      'ad.bud.hint_alerted_plain': 'The alert e-mail has been sent. “Send alert again” sends one more e-mail to the recipient manually.',
      'ad.bud.resolve': 'Mark as resolved',
      'ad.bud.alert_t': 'Alert the recipient of {name}?',
      'ad.bud.alert_m': 'A bilingual e-mail with the time since the last check-in, last location, route, travel mode{medical} and guidance to call 112/115 will be sent to {to}.',
      'ad.bud.alert_m_med': ', the consented public medical layer',
      'ad.bud.alert_ok': 'Alert sent to {to}{sim}.',
      'ad.bud.alert_sim': ' (simulated — local demo mode)',
      'ad.bud.alert_none': 'Not sent: the session is closed or has no recipient e-mail.',
      'ad.bud.resolve_t': 'Close the session of {name}',
      'ad.bud.resolve_m': 'Only close once the traveller is confirmed safe. If an alert was sent, the recipient gets an "all clear" e-mail.',
      'ad.bud.resolve_note': 'Resolution note',
      'ad.bud.resolve_ph': 'e.g. reached the recipient, traveller arrived in Phan Dung…',
      'ad.bud.q1': 'Reached the traveller',
      'ad.bud.q2': 'Recipient confirmed safe',
      'ad.bud.q3': 'Local rescue on site',
      'ad.bud.q4': 'No signal, checked in again',
      'ad.bud.resolved_ok': 'Session of {name} closed.',
      'ad.bud.resolved_clear': ' All-clear e-mail sent to the recipient.',
      'ad.bud.map_title': 'Last location',
      'ad.bud.map_none': 'No coordinates received yet.',
      'ad.bud.loc_line': '{coords} · ±{acc} m · {rel}',
      'ad.bud.loc_line_noacc': '{coords} · {rel}',
      'ad.bud.sig_at': 'Signal layer at the last location',
      'ad.bud.sig_hint': 'No signal at the last location may explain a late check-in — it does not rule out an accident. Contact the recipient and local authorities first.',
      'ad.bud.sig_off': '{d} off route',
      'ad.bud.copy_coords': 'Copy coordinates',
      'ad.bud.open_osm': 'Open OpenStreetMap',
      'ad.bud.copied': 'Coordinates copied',
      'ad.bud.info': 'Session details',
      'ad.bud.i_recipient': 'Recipient',
      'ad.bud.i_email': 'E-mail',
      'ad.bud.i_phone': 'Phone',
      'ad.bud.i_interval': 'Check-in interval',
      'ad.bud.i_grace': 'Grace period',
      'ad.bud.i_route': 'Route',
      'ad.bud.i_mode': 'Travel mode',
      'ad.bud.i_started': 'Started',
      'ad.bud.i_session': 'Session id',
      'ad.bud.reveal': 'Show contact',
      'ad.bud.hide': 'Hide contact',
      'ad.bud.call': 'Call',
      'ad.bud.mode_motorbike': 'Motorbike',
      'ad.bud.mode_hiking': 'Hiking / trekking',
      'ad.bud.med_title': 'Public medical layer',
      'ad.bud.med_consent': 'The traveller consented to include it in alerts',
      'ad.bud.med_none': 'Not shared (default). The medical profile is encrypted on the device and never uploaded.',
      'ad.bud.med_blood': 'Blood type',
      'ad.bud.med_allergies': 'Allergies',
      'ad.bud.med_conditions': 'Conditions',
      'ad.bud.med_medications': 'Medications',
      'ad.bud.timeline': 'Event timeline',
      'ad.bud.timeline_sub': '{n} events · newest first',
      'ad.bud.ev_start': 'Session started',
      'ad.bud.ev_checkin': '“I’m OK” check-in',
      'ad.bud.ev_location': 'Location ping',
      'ad.bud.ev_pre_deadzone': 'Entering a no-signal area',
      'ad.bud.ev_sos': 'SOS',
      'ad.bud.ev_overdue': 'Check-in overdue',
      'ad.bud.ev_alert_sent': 'Alert e-mail sent',
      'ad.bud.ev_all_clear': 'All-clear e-mail sent',
      'ad.bud.ev_alert_failed': 'Alert failed',
      'ad.bud.ev_stop': 'Session stopped',
      'ad.bud.ev_resolved': 'Marked safe',
      'ad.bud.ev_queued': 'Delivered {d} late from the offline queue',
      'ad.bud.ev_delivered': 'Reached the server',
      'ad.bud.ev_server': 'Detected by the server',
      'ad.bud.ev_to': 'to {to}',
      'ad.bud.ev_manual': 'manual',
      'ad.bud.ev_cron': 'automatic (cron)',
      'ad.bud.ev_by': 'by {who}',
      'ad.bud.ev_reason_sos': 'reason: SOS',
      'ad.bud.ev_reason_overdue': 'reason: overdue',
      'ad.bud.ev_reason_manual': 'reason: manual',
      'ad.bud.ev_sim': 'simulated',
      'ad.bud.ev_med': 'medical layer included',
      'ad.bud.ev_last_known': 'last known position',
      'ad.bud.dz_ahead': '~{d} before the no-signal area',
      'ad.bud.dz_ahead_eta': '~{d} (~{m}) before the no-signal area',
      'ad.bud.dz_zone': 'no-signal area at km {a}–{b}',
      'ad.bud.dz_sent': 'position sent before entering the no-signal area',
      'ad.bud.ev_none': 'No events yet.',
      'ad.bud.new_overdue': 'OVERDUE: {name} has not checked in',
      'ad.bud.new_sos': 'SOS from {name} — needs help now',
      'ad.bud.new_session': 'New session: {name}',
      'ad.bud.notif_denied': 'Notifications are blocked by the browser — the in-page sound still plays.',
      'ad.bud.medical_badge': 'Medical layer',
      'ad.bud.demo_note': 'Illustrative sessions of other travellers (re-based to the current time). In local mode e-mails are simulated and the cron runs every 15 seconds.',
      'ad.bud.st_sos': 'SOS',
      'ad.bud.st_failed': 'Send failed',
      'ad.bud.k_overdue_sos': 'SOS · Overdue',
      'ad.bud.k_overdue_sub_sos': '{s} SOS · {a} alerted · {b} awaiting alert',
      'ad.bud.lbl_since_sos': 'since SOS',
      'ad.bud.lbl_since_alert': 'since alert',
      'ad.bud.hero_sos': 'SOS · needs help now',
      'ad.bud.hero_sos_line': 'SOS at {at}. The recipient has not been e-mailed yet — the server sends it automatically, or send it now with the button.',
      'ad.bud.hero_sos_alerted_line': 'SOS at {at}. SOS e-mail sent {sent} to {to}. Contact the recipient and local rescue.',
      'ad.bud.hero_failed': 'The last alert failed ({err}) — the recipient has NOT been notified.',
      'ad.bud.alert_m_sos': 'A bilingual SOS e-mail (not a missed check-in) with the last location, route, travel mode{medical} and guidance to call 112/115 will be sent to {to}.',
      'ad.bud.alert_failed_toast': 'Alert failed: {err}. The recipient has NOT been notified — call them directly.',
      'ad.bud.alert_failed_unknown': 'unknown error',
      'ad.bud.new_alert_failed': 'Alert about {name} failed — the recipient was not notified',
      'ad.bud.ev_reason_send_failed': 'e-mail send error',
      'ad.bud.ev_reason_rate_limited': 'over the limit of 3 e-mails / 24 h for this recipient',
      'ad.bud.ev_error': 'error: {e}',
      'ad.bud.st_lost': 'CONTACT LOST',
      'ad.bud.hero_lost': 'Unexpected loss of contact',
      'ad.bud.hero_lost_line': 'The app was open but has sent no signal since {at} ({rel}) — outside a predicted no-signal area. Next check-in: {due}.',
      'ad.bud.lbl_since_signal': 'since last signal',
      'ad.bud.ev_contact_lost': 'Unexpected loss of contact',
      'ad.bud.ev_reason_contact_lost': 'reason: unexpected loss of contact',
      'ad.bud.i_heartbeat': 'App signal',
      'ad.bud.hb_live': 'Open · {at} ({rel})', 'ad.bud.hb_paused': 'Paused (app hidden) · {at} ({rel})',
      'ad.bud.hb_none': 'No signal yet (older app or not opened)',
      'ad.bud.hb_silence': 'May be silent until {at} (predicted no-signal area)',
      'ad.bud.ev_last_signal': 'last signal {at} ({rel})'
    }
  });

  /* Honesty (round 2 R7): a local build (no Supabase key) or a reserved demo address (example.com …) never sends a real
     e-mail — every alert text here says "mô phỏng" then; a phone-only session gets no automatic e-mail at all. */
  NC.i18n.add({
    vi: {
      'ad.bud.subtitle_local': 'Dead-man switch: máy chủ phát hiện phiên quá hạn và gửi email cho người nhận nếu phiên có email — chế độ cục bộ chỉ mô phỏng email. Theo dõi trực tiếp, gửi cảnh báo thủ công, đóng phiên khi đã xác nhận an toàn.',
      'ad.bud.why_local': 'chế độ cục bộ không gửi email thật',
      'ad.bud.why_demo': 'địa chỉ minh hoạ không được gửi thật',
      'ad.bud.k_overdue_sub_local': '{a} cảnh báo (mô phỏng) · {b} chờ',
      'ad.bud.k_overdue_sub_sos_local': '{s} SOS · {a} cảnh báo (mô phỏng) · {b} chờ',
      'ad.bud.st_alerted_sim': 'Cảnh báo mô phỏng',
      'ad.bud.hero_alerted_sim': 'Cảnh báo (mô phỏng)',
      'ad.bud.hero_alerted_line_sim': 'Email cảnh báo mô phỏng lúc {at} tới {to} ({why}). Hãy gọi người nhận nếu cần.',
      'ad.bud.hero_sos_line_sim': 'SOS lúc {at}. Máy chủ sẽ ghi nhận cảnh báo ở lượt cron kế tiếp — email chỉ là mô phỏng ({why}).',
      'ad.bud.hero_sos_line_noemail': 'SOS lúc {at}. Phiên không có email người nhận — máy chủ không tự báo được; hãy gọi người nhận.',
      'ad.bud.hero_sos_alerted_line_sim': 'SOS lúc {at}. Email báo SOS mô phỏng lúc {sent} tới {to} ({why}). Liên hệ người nhận và cứu hộ địa phương.',
      'ad.bud.hint_overdue_sim': 'Chưa có cảnh báo. Máy chủ sẽ tự ghi nhận ở lượt cron kế tiếp — email chỉ là mô phỏng ({why}).',
      'ad.bud.hint_alerted_sim': '“Gửi lại cảnh báo” chỉ mô phỏng thêm một email — không gửi thật.',
      'ad.bud.hint_noemail': 'Phiên không có email người nhận — máy chủ không gửi cảnh báo tự động. Hãy gọi người nhận.',
      'ad.bud.alert_m_sim': ' Email chỉ là mô phỏng ({why}).',
      'ad.bud.alert_ok_sim': 'Đã ghi nhận cảnh báo tới {to} — email mô phỏng ({why}).',
      'ad.bud.resolve_m_sim': 'Chỉ đóng khi đã xác nhận người đi an toàn. Email "đã an toàn" chỉ là mô phỏng ({why}).',
      'ad.bud.resolved_clear_sim': ' Email báo an toàn được mô phỏng (không gửi thật).',
      'ad.bud.ev_alert_sent_sim': 'Email cảnh báo (mô phỏng)',
      'ad.bud.ev_all_clear_sim': 'Email báo an toàn (mô phỏng)'
    },
    en: {
      'ad.bud.subtitle_local': 'Dead-man switch: the server detects overdue sessions and e-mails the recipient when the session has an e-mail — local mode only simulates e-mails. Watch live, send a manual alert, close a session once the traveller is confirmed safe.',
      'ad.bud.why_local': 'local mode sends no real e-mail',
      'ad.bud.why_demo': 'demo addresses are never really e-mailed',
      'ad.bud.k_overdue_sub_local': '{a} alerted (simulated) · {b} waiting',
      'ad.bud.k_overdue_sub_sos_local': '{s} SOS · {a} alerted (simulated) · {b} waiting',
      'ad.bud.st_alerted_sim': 'Simulated alert',
      'ad.bud.hero_alerted_sim': 'Alert (simulated)',
      'ad.bud.hero_alerted_line_sim': 'Simulated alert e-mail at {at} to {to} ({why}). Call the recipient if needed.',
      'ad.bud.hero_sos_line_sim': 'SOS at {at}. The server records the alert at its next cron run — the e-mail is only simulated ({why}).',
      'ad.bud.hero_sos_line_noemail': 'SOS at {at}. This session has no recipient e-mail — the server cannot alert anyone by itself; call the recipient.',
      'ad.bud.hero_sos_alerted_line_sim': 'SOS at {at}. Simulated SOS e-mail at {sent} to {to} ({why}). Contact the recipient and local rescue.',
      'ad.bud.hint_overdue_sim': 'No alert yet. The server records it at its next cron run — the e-mail is only simulated ({why}).',
      'ad.bud.hint_alerted_sim': '“Send alert again” only simulates one more e-mail — nothing is really sent.',
      'ad.bud.hint_noemail': 'This session has no recipient e-mail — the server sends no automatic alert. Call the recipient.',
      'ad.bud.alert_m_sim': ' The e-mail is only simulated ({why}).',
      'ad.bud.alert_ok_sim': 'Alert to {to} recorded — simulated e-mail ({why}).',
      'ad.bud.resolve_m_sim': 'Only close once the traveller is confirmed safe. The "all clear" e-mail is only simulated ({why}).',
      'ad.bud.resolved_clear_sim': ' The all-clear e-mail is simulated (not really sent).',
      'ad.bud.ev_alert_sent_sim': 'Alert e-mail (simulated)',
      'ad.bud.ev_all_clear_sim': 'All-clear e-mail (simulated)'
    }
  });

  var SOON_MS = 15 * 60000;
  var EV_ICON = {
    start: ['play', 'primary'], checkin: ['check-circle', 'success'], location: ['map-pin', 'info'], pre_deadzone: ['signal-off', 'warning'],
    sos: ['siren', 'danger'], overdue: ['alert-triangle', 'danger'], alert_sent: ['mail', 'accent'], alert_failed: ['x-circle', 'danger'],
    stop: ['stop', 'neutral'], resolved: ['shield-check', 'success']
  };

  var state = {
    rows: [], filter: 'all', q: '', selId: null, events: [], prev: null, reveal: false,
    alerts: !!kit.lsGet('nc.admin.bud.alerts', false), flashIds: {}, mapCarrier: 'viettel', loadSeq: 0, evSeq: 0,
    sosSeen: {}, muteFail: {}
  };
  var el = {};
  var map = null, mapLayers = null;
  var ticker = null, poll = null, offRealtime = null, visible = false;
  var audioCtx = null;

  /* ------------------------------------------------------------ derived status */

  function now() { return Date.now(); }
  function localMode() { return !NC.data || NC.data.mode !== 'supabase'; }
  /**
   * Why the e-mails of this session are NOT real (local mode / reserved demo address) as a short text, or null when a
   * real e-mail goes out (Supabase + a real recipient address).
   */
  function simWhy(s) {
    if (localMode()) return t('ad.bud.why_local');
    var sh = NC.backend && NC.backend.shared;
    return s && s.recipient_email && sh && sh.isReservedEmail && sh.isReservedEmail(s.recipient_email) ? t('ad.bud.why_demo') : null;
  }
  function dueMs(s) { return s.next_due_at ? Date.parse(s.next_due_at) : null; }
  function graceEnd(s) { var d = dueMs(s); return d === null ? null : d + (s.grace_min || 0) * 60000; }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  /**
   * SOS since the last check-in = an active emergency, never shown as a missed check-in. Server rows carry
   * alert_reason ('overdue'|'sos'|null) + sos_at (FIX_CONTRACT A4); older backends: remembered from last_event_kind 'sos'
   * (state.sosSeen, kept across the later alert_sent event until a check-in makes the session active again).
   */
  function isSos(s) {
    if (!s || s.status === 'closed') return false;
    if (has(s, 'alert_reason') || has(s, 'sos_at')) return s.alert_reason === 'sos' || !!s.sos_at;
    return s.status !== 'active' && !!state.sosSeen[s.id];
  }
  function lastEventOf(kinds, sessionId) {
    var evs = state.events.filter(function (e) { return e.session_id === sessionId && kinds.indexOf(e.kind) >= 0; });
    return evs.length ? evs[evs.length - 1] : null;
  }
  /** ISO time of the SOS (server sos_at, else remembered / latest 'sos' event of the selected session). */
  function sosAt(s) {
    if (s.sos_at) return s.sos_at;
    var seen = state.sosSeen[s.id];
    if (seen && seen.at) return seen.at;
    var ev = s.id === state.selId ? lastEventOf(['sos'], s.id) : null;
    return ev ? (ev.client_ts || ev.received_at) : null;
  }
  function sosMs(s) { var v = sosAt(s); var ms = v ? Date.parse(v) : NaN; return isFinite(ms) ? ms : null; }
  /** Fallback memory for backends without alert_reason/sos_at. */
  function rememberSos(rows) {
    rows.forEach(function (s) {
      if (has(s, 'alert_reason') || has(s, 'sos_at')) { delete state.sosSeen[s.id]; return; }
      if (s.status === 'active' || s.status === 'closed') { delete state.sosSeen[s.id]; return; }
      var seen = state.sosSeen[s.id];
      if (s.last_event_kind === 'sos' && (!seen || seen.n !== s.event_count)) state.sosSeen[s.id] = { at: s.updated_at || new Date().toISOString(), n: s.event_count };
    });
  }
  /** alert_reason 'contact_lost' (round 2 R6): the live app stopped sending its heartbeat. */
  function isLost(s) { return !!s && s.status !== 'closed' && s.status !== 'active' && s.alert_reason === 'contact_lost'; }
  /** Display status: sos | overdue | alerted | late | soon | active | closed. */
  function dstatus(s) {
    if (s.status === 'closed') return 'closed';
    if (isSos(s)) return 'sos';
    if (s.status === 'alerted') return 'alerted';
    if (s.status === 'overdue') return 'overdue';
    var d = dueMs(s);
    if (d === null) return 'active';
    var n = now();
    if (n > graceEnd(s)) return 'overdue'; // server cron confirms within a tick
    if (n > d) return 'late';
    if (d - n < SOON_MS) return 'soon';
    return 'active';
  }
  var RANK = { sos: 0, overdue: 1, alerted: 2, late: 3, soon: 4, active: 5, closed: 6 };
  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      var ra = RANK[dstatus(a)], rb = RANK[dstatus(b)];
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (sosMs(a) || 0) - (sosMs(b) || 0); // longest-waiting SOS first
      if (ra <= 2) return (dueMs(a) || 0) - (dueMs(b) || 0); // most overdue first
      if (ra <= 5) return (dueMs(a) || Infinity) - (dueMs(b) || Infinity); // soonest due first
      return String(b.closed_at || b.updated_at || '').localeCompare(String(a.closed_at || a.updated_at || ''));
    });
  }
  function tone(ds) { return ds === 'sos' || ds === 'overdue' || ds === 'alerted' ? 'danger' : ds === 'late' || ds === 'soon' ? 'warning' : ds === 'closed' ? 'neutral' : 'success'; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** 3725000 → "1:02:05", 725000 → "12:05". */
  function clock(ms) {
    var s = Math.max(0, Math.floor(Math.abs(ms) / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? hh + ':' + pad(mm) + ':' + pad(ss) : pad(mm) + ':' + pad(ss);
  }
  /** Countdown descriptor for a session at time n (SOS / alert: time elapsed since, never a "due in" countdown). */
  function countdown(s) {
    var ds = dstatus(s), d = dueMs(s), n = now();
    var none = { text: '', label: '', ds: ds };
    if (ds === 'closed') return none;
    if (ds === 'sos') {
      var sa = sosMs(s);
      return sa !== null ? { text: '+' + clock(n - sa), label: t('ad.bud.lbl_since_sos'), ds: ds, ms: n - sa, over: true } : none;
    }
    if (d === null) return none;
    if ((ds === 'overdue' || ds === 'alerted') && isLost(s) && s.last_heartbeat_at && now() <= graceEnd(s)) {
      var hb = Date.parse(s.last_heartbeat_at);
      if (isFinite(hb)) return { text: '+' + clock(n - hb), label: t('ad.bud.lbl_since_signal'), ds: ds, ms: n - hb, over: true };
    }
    var ge = graceEnd(s);
    if (n > ge) return { text: '+' + clock(n - ge), label: t('ad.bud.lbl_overdue'), ds: ds, ms: n - ge, over: true };
    if (ds === 'overdue' || ds === 'alerted') {
      // server-side overdue/alerted before the deadline (e.g. a manual alert): time since the alert
      var al = s.alerted_at ? Date.parse(s.alerted_at) : NaN;
      return isFinite(al) ? { text: '+' + clock(n - al), label: t('ad.bud.lbl_since_alert'), ds: ds, ms: n - al, over: true } : none;
    }
    if (n > d) return { text: clock(ge - n), label: t('ad.bud.lbl_grace'), ds: ds, ms: ge - n };
    return { text: clock(d - n), label: t('ad.bud.lbl_due'), ds: ds, ms: d - n };
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var a = parts[0] ? parts[0].charAt(0) : '?', b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (a + b).toUpperCase();
  }
  function maskEmail(e) {
    var m = /^([^@]{0,2})[^@]*(@.*)$/.exec(e || '');
    return m ? m[1] + '•••' + m[2] : (e || '–');
  }
  function maskPhone(p) {
    var s = String(p || '');
    if (!s) return '–';
    var digits = s.replace(/\D/g, '');
    return s.slice(0, 3) + ' ••• ••• ' + digits.slice(-3);
  }
  function modeLabel(m) { return t(m === 'hiking' ? 'ad.bud.mode_hiking' : 'ad.bud.mode_motorbike'); }
  function modeIcon(m) { return m === 'hiking' ? 'footprints' : 'bike'; }
  function selected() { return state.rows.filter(function (s) { return s.id === state.selId; })[0] || null; }

  /* ------------------------------------------------------------ mount */

  function mount(section) {
    el.root = h('div', { class: 'ad-pg ad-bud' });
    section.appendChild(el.root);

    el.alertSw = h('input', { type: 'checkbox', checked: state.alerts });
    var alertLbl = h('label', { class: 'switch ad-bud-alertsw', title: t('ad.bud.alerts_hint') }, el.alertSw, h('span', { class: 'switch__track' }),
      h('span', { class: 'switch__label', 'data-i18n': 'ad.bud.alerts_on' }, t('ad.bud.alerts_on')));
    var refresh = h('button', { type: 'button', class: 'btn btn--outline btn--sm', 'data-act': 'refresh', html: icon('refresh') + '<span data-i18n="ad.bud.refresh">' + esc(t('ad.bud.refresh')) + '</span>' });
    el.root.appendChild(kit.head({ icon: 'users', tone: 'danger', titleKey: 'ad.bud.title', subKey: localMode() ? 'ad.bud.subtitle_local' : 'ad.bud.subtitle', actions: [alertLbl, refresh] }));

    el.k = {
      overdue: kit.kpi({ id: 'overdue', icon: 'siren', tone: 'danger' }),
      soon: kit.kpi({ id: 'soon', icon: 'timer', tone: 'warning' }),
      active: kit.kpi({ id: 'active', icon: 'activity', tone: 'success' }),
      closed: kit.kpi({ id: 'closed', icon: 'check-circle', tone: 'neutral' })
    };
    el.root.appendChild(h('div', { class: 'ad-pg-kpis ad-bud-kpis' }, el.k.overdue, el.k.soon, el.k.active, el.k.closed));

    el.filters = h('div', { class: 'chip-group chip-group--scroll ad-bud-filters', role: 'radiogroup' });
    el.search = h('input', { type: 'search', class: 'input ad-bud-search', placeholder: t('ad.bud.search'), 'aria-label': t('ad.bud.search'), 'data-i18n-attr': 'placeholder:ad.bud.search;aria-label:ad.bud.search' });
    el.list = h('ul', { class: 'ad-bud-items', role: 'list' });
    el.listCard = h('section', { class: 'card card--pad-0 ad-bud-list' },
      h('div', { class: 'ad-bud-list__head' }, el.filters, h('div', { class: 'input-group' }, NC.ui.iconEl('search'), el.search)),
      el.list);
    el.detail = h('section', { class: 'ad-bud-detail', 'aria-live': 'polite' });
    el.layout = h('div', { class: 'ad-bud-layout' }, el.listCard, el.detail);
    el.root.appendChild(el.layout);
    el.root.appendChild(h('p', { class: 'ad-pg-foot', 'data-i18n': 'ad.bud.demo_note' }, t('ad.bud.demo_note')));

    wire();
    // Audio can only start after a user gesture: unlock on the first interaction when alarms were left on.
    if (state.alerts) document.addEventListener('pointerdown', unlockAudio, { once: true });
    NC.bus.on('i18n:change', function () { NC.i18n.apply(el.root); renderAll(); });
  }

  function wire() {
    el.root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b || !el.root.contains(b)) return;
      var act = b.getAttribute('data-act');
      var s = selected();
      if (act === 'refresh') reload();
      else if (act === 'filter') { state.filter = b.getAttribute('data-value'); renderFilters(); renderList(); }
      else if (act === 'open') select(b.getAttribute('data-id'), true);
      else if (act === 'back') { state.selId = null; el.layout.classList.remove('is-detail'); kit.setHash('buddy', {}); renderList(); renderDetail(); }
      else if (act === 'alert' && s) sendAlert(s, b);
      else if (act === 'resolve' && s) resolve(s);
      else if (act === 'reveal') { state.reveal = !state.reveal; renderInfo(); renderTimeline(); }
      else if (act === 'call' && s) NC.ui.callNumber(s.recipient_phone);
      else if (act === 'copy' && s) {
        U.copyText(U.fmtNumber(s.last_lat, 6).replace(',', '.') + ', ' + U.fmtNumber(s.last_lng, 6).replace(',', '.')).then(function (ok) { if (ok) NC.ui.toast(t('ad.bud.copied'), { type: 'success', timeout: 1800 }); });
      }
      else if (act === 'carrier') { state.mapCarrier = b.getAttribute('data-value'); renderMap(true); }
    });
    el.search.addEventListener('input', U.debounce(function () { state.q = el.search.value; renderList(); }, 150));
    el.alertSw.addEventListener('change', function () {
      state.alerts = el.alertSw.checked;
      kit.lsSet('nc.admin.bud.alerts', state.alerts);
      if (state.alerts) {
        unlockAudio();
        beep(true);
        if (window.Notification && Notification.permission === 'default') {
          try { Notification.requestPermission().then(function (p) { if (p === 'denied') NC.ui.toast(t('ad.bud.notif_denied'), { type: 'warning' }); }); } catch (e) { /* old API */ }
        } else if (window.Notification && Notification.permission === 'denied') {
          NC.ui.toast(t('ad.bud.notif_denied'), { type: 'warning' });
        }
      }
    });
  }

  /* ------------------------------------------------------------ data */

  function reload() {
    var seq = ++state.loadSeq;
    return NC.data.admin.listBuddySessions().then(function (rows) {
      if (seq !== state.loadSeq) return;
      rememberSos(rows || []);
      detectChanges(rows || []);
      state.rows = rows || [];
      renderAll();
      kit.refreshBadges();
      if (state.selId) loadEvents();
    }).catch(kit.toastErr);
  }

  function loadEvents() {
    var id = state.selId;
    if (!id) return Promise.resolve();
    var seq = ++state.evSeq;
    return NC.data.admin.listBuddyEvents(id).then(function (evs) {
      if (seq !== state.evSeq || id !== state.selId) return;
      var before = {};
      state.events.forEach(function (e) { before[e.id] = true; });
      var hadAny = state.events.length > 0 && state.events[0].session_id === id;
      state.events = evs || [];
      if (hadAny) state.events.forEach(function (e) { if (!before[e.id]) state.flashIds[e.id] = true; });
      renderTimeline();
      renderMap(false);
      // SOS note / last failed alert come from the events
      var sel = selected();
      if (sel && el.hero && el.detailId === sel.id) renderHero(sel, dstatus(sel));
    }).catch(kit.toastErr);
  }

  /**
   * Alarm on transitions (not on the first load). SOS is checked first: the server also marks an SOS session 'overdue',
   * which must never read as "has not checked in". Then → overdue, failed alert e-mail, new session.
   */
  function detectChanges(rows) {
    var prev = state.prev;
    var next = {};
    rows.forEach(function (s) { next[s.id] = { status: s.status, last: s.last_event_kind, n: s.event_count, sos: isSos(s), sosAt: sosAt(s) }; });
    state.prev = next;
    var mute = state.muteFail;
    state.muteFail = {};
    if (!prev) return;
    rows.forEach(function (s) {
      var p = prev[s.id];
      var name = s.traveler_name || '?';
      var sos = isSos(s);
      if (!p) {
        if (sos) notify(t('ad.bud.new_sos', { name: name }), 'danger', true, s.id);
        else if (s.status === 'overdue') notify(t('ad.bud.new_overdue', { name: name }), 'danger', true, s.id);
        else if (s.status !== 'closed') notify(t('ad.bud.new_session', { name: name }), 'info', false);
        return;
      }
      var at = sosAt(s);
      if (sos && (!p.sos || (at && at !== p.sosAt) || (s.last_event_kind === 'sos' && s.event_count > p.n))) notify(t('ad.bud.new_sos', { name: name }), 'danger', true, s.id);
      else if (!sos && s.status === 'overdue' && p.status !== 'overdue') notify(t('ad.bud.new_overdue', { name: name }), 'danger', true, s.id);
      if (s.last_event_kind === 'alert_failed' && (p.last !== 'alert_failed' || s.event_count > p.n) && !mute[s.id]) {
        notify(t('ad.bud.new_alert_failed', { name: name }), 'danger', true, s.id);
      }
    });
  }

  function notify(msg, type, loud, id) {
    NC.ui.toast(msg, {
      type: type, timeout: loud ? 9000 : 4000,
      action: id ? { label: t('common.details'), onClick: function () { var cur = NC.admin && NC.admin.current ? NC.admin.current() : null; if (cur && cur.name !== 'buddy' && NC.admin.go) NC.admin.go('buddy', { id: id }); else select(id, true); } } : null
    });
    if (!loud || !state.alerts) return;
    beep(false);
    try {
      if (window.Notification && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        // the same mark as the traveller app's notifications (icon-192.png, round 2 R8)
        new Notification('NomadCare · Buddy', { body: msg, tag: 'nc-buddy-' + (id || 'x'), icon: NC.ui.assetUrl ? NC.ui.assetUrl('assets/img/icons/icon-192.png') : 'assets/img/icons/icon-192.png' }); // eslint-disable-line no-new
      }
    } catch (e) { /* notifications unavailable */ }
    U.vibrate([80, 60, 80]);
  }

  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { audioCtx = null; }
  }
  /** Two-tone alarm (short confirmation blip when `soft`). */
  function beep(soft) {
    if (!audioCtx) return;
    try {
      var t0 = audioCtx.currentTime;
      var tones = soft ? [[880, 0, 0.09]] : [[988, 0, 0.16], [740, 0.2, 0.16], [988, 0.4, 0.16], [740, 0.6, 0.22]];
      tones.forEach(function (tn) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = tn[0];
        g.gain.setValueAtTime(0.0001, t0 + tn[1]);
        g.gain.exponentialRampToValueAtTime(soft ? 0.08 : 0.22, t0 + tn[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + tn[1] + tn[2]);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0 + tn[1]); o.stop(t0 + tn[1] + tn[2] + 0.02);
      });
    } catch (e) { /* audio unavailable */ }
  }

  /* ------------------------------------------------------------ render: KPIs, filters, list */

  function counts() {
    var c = { sos: 0, overdue: 0, alerted: 0, soon: 0, active: 0, closed: 0, attention: 0, all: state.rows.length, closed24: 0 };
    var dayAgo = now() - 86400000;
    state.rows.forEach(function (s) {
      var ds = dstatus(s);
      if (ds === 'sos') c.sos++;
      if (ds === 'overdue') c.overdue++;
      if (ds === 'alerted') c.alerted++;
      if (ds === 'soon' || ds === 'late') c.soon++;
      if (s.status === 'active') c.active++;
      if (s.status === 'closed') { c.closed++; if (s.closed_at && Date.parse(s.closed_at) >= dayAgo) c.closed24++; }
      if (ds === 'sos' || ds === 'overdue' || ds === 'alerted' || ds === 'late') c.attention++;
    });
    return c;
  }

  function renderAll() {
    renderKpis();
    renderFilters();
    renderList();
    renderDetail();
  }

  function renderKpis() {
    var c = counts();
    var od = c.sos + c.overdue + c.alerted;
    var lm = localMode() ? '_local' : '';   // local mode: "cảnh báo (mô phỏng)", never "đã gửi"
    var odSub = c.sos ? t('ad.bud.k_overdue_sub_sos' + lm, { s: c.sos, a: c.alerted, b: c.overdue }) : t('ad.bud.k_overdue_sub' + lm, { a: c.alerted, b: c.overdue });
    [['overdue', od, od > 0, odSub], ['soon', c.soon, false], ['active', c.active, false], ['closed', c.closed24, false]].forEach(function (k) {
      var node = el.k[k[0]];
      node.querySelector('.ad-pg-kpi__label').textContent = k[0] === 'overdue' && c.sos ? t('ad.bud.k_overdue_sos') : t('ad.bud.k_' + k[0]);
      kit.setKpi(node, U.fmtNumber(k[1]), k[3] || t('ad.bud.k_' + k[0] + '_sub'), k[2]);
    });
    el.k.overdue.classList.toggle('ad-bud-kpi--sos', c.sos > 0);
  }

  function renderFilters() {
    var c = counts();
    el.filters.innerHTML = '';
    [['all', c.all], ['attention', c.attention], ['active', c.active], ['closed', c.closed]].forEach(function (f) {
      var on = state.filter === f[0];
      el.filters.appendChild(h('button', {
        type: 'button', class: 'chip chip--soft' + (on ? ' is-selected' : '') + (f[0] === 'attention' && f[1] ? ' ad-bud-filter--hot' : ''),
        'data-act': 'filter', 'data-value': f[0], role: 'radio', 'aria-checked': on ? 'true' : 'false'
      }, t('ad.bud.f_' + f[0]), h('span', { class: 'ad-bud-filter__n' }, String(f[1]))));
    });
  }

  function visibleRows() {
    var q = U.normalize(state.q || '').trim();
    return sortRows(state.rows).filter(function (s) {
      var ds = dstatus(s);
      if (state.filter === 'attention' && !(ds === 'sos' || ds === 'overdue' || ds === 'alerted' || ds === 'late')) return false;
      if (state.filter === 'active' && s.status !== 'active') return false;
      if (state.filter === 'closed' && s.status !== 'closed') return false;
      if (q && U.normalize((s.traveler_name || '') + ' ' + (s.recipient_name || '')).indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderList() {
    var rows = visibleRows();
    el.list.innerHTML = '';
    if (!rows.length) {
      el.list.appendChild(h('li', { class: 'ad-bud-items__empty' }, NC.ui.emptyState({ icon: 'users', title: t('ad.bud.list_empty'), text: t('ad.bud.list_empty_t'), compact: true })));
      return;
    }
    rows.forEach(function (s) {
      var ds = dstatus(s), cd = countdown(s);
      var last = s.last_checkin_at ? t('ad.bud.last_checkin', { rel: U.relTime(s.last_checkin_at) }) : t('ad.bud.no_checkin');
      el.list.appendChild(h('li', null, h('button', {
        type: 'button', class: 'ad-bud-item ad-bud-item--' + ds + (s.id === state.selId ? ' is-selected' : ''),
        'data-act': 'open', 'data-id': s.id, 'aria-current': s.id === state.selId ? 'true' : null
      },
        h('span', { class: 'ad-bud-avatar ad-bud-avatar--' + tone(ds), 'aria-hidden': 'true' }, initials(s.traveler_name)),
        h('span', { class: 'ad-bud-item__body' },
          h('span', { class: 'ad-bud-item__top' },
            h('strong', { class: 'ad-bud-item__name' }, s.traveler_name || '–'),
            statusBadges(s, ds)),
          h('span', { class: 'ad-bud-item__meta', html: icon(modeIcon(s.travel_mode), 'icon--xs') + '<span>' + esc(kit.routeShort(s.route_id)) + '</span><span aria-hidden="true">·</span><span>' + esc(last) + '</span>' +
            (s.share_public_medical ? '<span class="ad-bud-item__med" title="' + esc(t('ad.bud.medical_badge')) + '">' + icon('heart-pulse', 'icon--xs') + '</span>' : '') })),
        cd.text ? h('span', { class: 'ad-bud-item__count' },
          h('span', { class: 'ad-bud-item__clock', 'data-count': s.id }, cd.text),
          h('span', { class: 'ad-bud-item__clbl', 'data-count-lbl': s.id }, cd.label)) : null)));
    });
  }

  /** Status badge(s): SOS (+ "alert sent" when e-mailed), OVERDUE, … and "send failed" after a failed alert e-mail. */
  function statusBadges(s, ds) {
    var out = [];
    var alertedKey = simWhy(s) ? 'ad.bud.st_alerted_sim' : 'ad.bud.st_alerted';   // local / demo address: "mô phỏng"
    if (ds === 'sos') {
      out.push(h('span', { class: 'badge badge--solid ad-bud-badge--sos', html: icon('siren') + '<span>' + esc(t('ad.bud.st_sos')) + '</span>' }));
      if (s.status === 'alerted') out.push(h('span', { class: 'badge badge--danger' }, t(alertedKey)));
    } else if (isLost(s)) {
      // contact_lost: ONE status (the check-in itself may not be due yet — "QUÁ HẠN" would contradict the hero)
      out.push(h('span', { class: 'badge badge--solid ad-bud-badge--overdue', html: icon('signal-off') + '<span>' + esc(t('ad.bud.st_lost')) + '</span>' }));
      if (ds === 'alerted') out.push(h('span', { class: 'badge badge--danger' }, t(alertedKey)));
    } else {
      out.push(h('span', { class: 'badge badge--' + (ds === 'overdue' ? 'solid ad-bud-badge--overdue' : tone(ds)) }, t(ds === 'alerted' ? alertedKey : 'ad.bud.st_' + ds)));
    }
    if (ds !== 'closed' && s.last_event_kind === 'alert_failed') {
      out.push(h('span', { class: 'badge badge--danger ad-bud-badge--failed', html: icon('x-circle') + '<span>' + esc(t('ad.bud.st_failed')) + '</span>' }));
    }
    return out;
  }

  /* ------------------------------------------------------------ render: detail */

  function select(id, userAction) {
    if (state.selId !== id) { state.events = []; state.reveal = false; state.flashIds = {}; }
    state.selId = id;
    el.layout.classList.add('is-detail');
    kit.setHash('buddy', { id: id });
    renderList();
    renderDetail();
    loadEvents();
    if (userAction && window.innerWidth < 768) window.scrollTo(0, 0);
  }

  function renderDetail() {
    var s = selected();
    if (!s) {
      destroyMap();
      el.detail.innerHTML = '';
      el.detail.appendChild(h('div', { class: 'card ad-bud-pick' }, NC.ui.emptyState({ icon: 'users', variant: 'primary', title: t('ad.bud.pick'), text: t('ad.bud.pick_t') })));
      return;
    }
    var keepMap = map && el.detailId === s.id;
    if (!keepMap) destroyMap();
    el.detailId = s.id;
    var ds = dstatus(s);
    if (!keepMap) {
      el.detail.innerHTML = '';
      el.dHead = h('div', { class: 'ad-bud-dhead' });
      el.hero = h('div', { class: 'ad-bud-hero' });
      el.mapEl = h('div', { class: 'ad-bud-map' });
      el.mapInfo = h('div', { class: 'ad-bud-mapinfo' });
      el.sig = h('div', { class: 'ad-bud-sig' });
      el.info = h('div', { class: 'ad-bud-info' });
      el.med = h('div', { class: 'ad-bud-med' });
      el.tl = h('div', { class: 'ad-bud-tl' });
      el.tlSub = h('p', { class: 'card__subtitle' });
      el.detail.appendChild(el.dHead);
      el.detail.appendChild(el.hero);
      el.detail.appendChild(h('div', { class: 'ad-bud-dgrid' },
        h('div', { class: 'ad-bud-dcol' },
          h('section', { class: 'card card--pad-0 ad-bud-mapcard' },
            h('div', { class: 'ad-bud-mapcard__head' },
              h('div', { class: 'ad-bud-mapcard__title' }, h('h3', { class: 'card__title', 'data-i18n': 'ad.bud.map_title' }, t('ad.bud.map_title')), el.mapInfo),
              el.mapTools = h('div', { class: 'cluster cluster--nowrap' })),
            el.mapEl, el.sig),
          h('section', { class: 'card ad-bud-infocard' },
            h('div', { class: 'card__header' }, h('div', null, h('h3', { class: 'card__title', 'data-i18n': 'ad.bud.info' }, t('ad.bud.info')))),
            el.info, el.med)),
        h('section', { class: 'card ad-bud-tlcard' },
          h('div', { class: 'card__header' }, h('div', null, h('h3', { class: 'card__title', 'data-i18n': 'ad.bud.timeline' }, t('ad.bud.timeline')), el.tlSub)),
          el.tl)));
    }
    el.detail.className = 'ad-bud-detail ad-bud-detail--' + ds;
    renderDHead(s, ds);
    renderHero(s, ds);
    renderInfo();
    renderTimeline();
    if (!keepMap) setTimeout(function () { renderMap(true); }, 0);
  }

  function renderDHead(s, ds) {
    el.dHead.innerHTML = '';
    el.dHead.appendChild(h('button', { type: 'button', class: 'btn btn--ghost btn--sm ad-bud-back', 'data-act': 'back', html: icon('chevron-left') + '<span>' + esc(t('ad.bud.back')) + '</span>' }));
    el.dHead.appendChild(h('span', { class: 'ad-bud-avatar ad-bud-avatar--lg ad-bud-avatar--' + tone(ds), 'aria-hidden': 'true' }, initials(s.traveler_name)));
    el.dHead.appendChild(h('div', { class: 'ad-bud-dhead__text' },
      h('h3', { class: 'ad-bud-dhead__name' }, s.traveler_name || '–', statusBadges(s, ds)),
      h('p', { class: 'ad-bud-dhead__meta', html: icon(modeIcon(s.travel_mode), 'icon--xs') + '<span>' + esc(kit.routeName(s.route_id)) + '</span><span aria-hidden="true">·</span><span>' +
        esc(modeLabel(s.travel_mode)) + '</span><span aria-hidden="true">·</span><span>' + esc(t('ad.bud.i_started')) + ' ' + esc(U.relTime(s.started_at)) + '</span>' })));
    el.dHead.appendChild(NC.ui.demoBadge());
  }

  function lastAlert() {
    var a = state.events.filter(function (e) { return e.kind === 'alert_sent' && !(e.meta && e.meta.type === 'resolved'); });
    return a.length ? a[a.length - 1] : null;
  }
  /** Latest alert attempt of the selected session (sent or failed, not the "all clear"). */
  function lastAlertAttempt(sessionId) {
    var a = state.events.filter(function (e) { return e.session_id === sessionId && (e.kind === 'alert_failed' || (e.kind === 'alert_sent' && !(e.meta && e.meta.type === 'resolved'))); });
    return a.length ? a[a.length - 1] : null;
  }
  /** Human reason of a failed alert (event meta or triggerAlert result). */
  function failText(reason, error) {
    if (reason === 'rate_limited' || error === 'rate_limited') return t('ad.bud.ev_reason_rate_limited');
    return error || t('ad.bud.alert_failed_unknown');
  }

  function renderHero(s, ds) {
    var cd = countdown(s);
    el.hero.className = 'ad-bud-hero ad-bud-hero--' + ds;
    el.hero.innerHTML = '';
    var titleKey = { sos: 'ad.bud.hero_sos', overdue: 'ad.bud.hero_overdue', alerted: 'ad.bud.hero_alerted', late: 'ad.bud.hero_late', soon: 'ad.bud.hero_due', active: 'ad.bud.hero_due', closed: 'ad.bud.hero_closed' }[ds];
    var hot = ds === 'overdue' || ds === 'sos';
    var lost = ds !== 'sos' && isLost(s);
    var why = simWhy(s);   // local mode / demo address: every "sent" below becomes "mô phỏng" (round 2 R7)
    if (lost) titleKey = 'ad.bud.hero_lost';
    else if (ds === 'alerted' && why) titleKey = 'ad.bud.hero_alerted_sim';
    var ringWrap = h('div', { class: 'ad-bud-hero__ring' });
    if (ds !== 'closed') {
      var frac = cd.over || hot || ds === 'late' ? 1 : Math.max(0, Math.min(1, (cd.ms || 0) / ((s.interval_min || 60) * 60000)));
      ringWrap.appendChild(NC.viz.ring(frac, { size: 92, stroke: 9, label: ' ', tone: hot || ds === 'alerted' ? 'danger' : ds === 'late' || ds === 'soon' ? 'warning' : 'success' }));
      ringWrap.appendChild(h('span', { class: 'ad-bud-hero__ricon', html: icon(hot ? 'siren' : ds === 'alerted' ? 'mail' : 'timer') }));
    } else {
      ringWrap.appendChild(h('span', { class: 'icon-tile icon-tile--lg icon-tile--neutral', html: icon('check-circle') }));
    }
    var line;
    if (ds === 'sos') {
      var sa = sosAt(s);
      var sosTxt = sa ? U.fmtTime(sa) + ' (' + U.relTime(sa) + ')' : '–';
      line = s.status === 'alerted' && s.alerted_at
        ? t(why ? 'ad.bud.hero_sos_alerted_line_sim' : 'ad.bud.hero_sos_alerted_line', { at: sosTxt, sent: U.fmtTime(s.alerted_at), to: maskEmail(s.recipient_email), why: why })
        : t(!s.recipient_email ? 'ad.bud.hero_sos_line_noemail' : why ? 'ad.bud.hero_sos_line_sim' : 'ad.bud.hero_sos_line', { at: sosTxt, why: why });
    } else if (ds === 'alerted') {
      var la = lastAlert();
      var at = s.alerted_at || (la && la.client_ts);
      line = t(why ? 'ad.bud.hero_alerted_line_sim' : 'ad.bud.hero_alerted_line', { at: U.fmtTime(at) + ' (' + U.relTime(at) + ')', to: maskEmail(s.recipient_email), why: why });
    } else if (ds === 'closed') {
      line = t('ad.bud.hero_closed_line', { at: U.fmtDateTime(s.closed_at) });
    } else if (lost) {
      line = t('ad.bud.hero_lost_line', { at: s.last_heartbeat_at ? U.fmtTime(s.last_heartbeat_at) : '–', rel: s.last_heartbeat_at ? U.relTime(s.last_heartbeat_at) : '–',
        due: s.next_due_at ? U.fmtTime(s.next_due_at) : '–' });
    } else {
      line = t('ad.bud.hero_line', { last: s.last_checkin_at ? U.fmtTime(s.last_checkin_at) : '–', due: U.fmtTime(s.next_due_at), grace: U.fmtDuration(s.grace_min || 0) });
    }
    var sosEv = ds === 'sos' ? lastEventOf(['sos'], s.id) : null;
    var attempt = ds !== 'closed' ? lastAlertAttempt(s.id) : null;
    var failed = attempt && attempt.kind === 'alert_failed' ? attempt : null;
    // Which alert action applies (demo step 5): already alerted → "Gửi lại cảnh báo" + how it was sent; overdue/SOS not
    // alerted yet → "Gửi cảnh báo ngay" + note that the cron would send it next.
    var alerted = s.status === 'alerted';
    var hintKey = null;
    if (ds !== 'closed' && s.recipient_email) {
      if (alerted) {
        var trig = attempt && attempt.kind === 'alert_sent' && attempt.meta ? attempt.meta.trigger : null;
        hintKey = why ? 'ad.bud.hint_alerted_sim' : trig === 'manual' ? 'ad.bud.hint_alerted_manual' : trig ? 'ad.bud.hint_alerted_cron' : 'ad.bud.hint_alerted_plain';
      } else if (hot && !failed) {
        hintKey = why ? 'ad.bud.hint_overdue_sim' : 'ad.bud.hint_overdue';
      }
    } else if (ds !== 'closed' && hot) {
      hintKey = 'ad.bud.hint_noemail';   // phone-only: no automatic e-mail at all (the alert button is disabled)
    }
    var text = h('div', { class: 'ad-bud-hero__text' },
      ds === 'sos' ? h('p', { class: 'ad-bud-hero__eyebrow', html: icon('siren') + '<span>' + esc(t(titleKey)) + '</span>' }) : h('p', { class: 'ad-bud-hero__eyebrow' }, t(titleKey)),
      cd.text ? h('strong', { class: 'ad-bud-hero__count', 'data-count': s.id, 'aria-live': 'off' }, cd.text) : null,
      sosEv && sosEv.note ? h('p', { class: 'ad-bud-hero__note' }, '“' + sosEv.note + '”') : null,
      h('p', { class: 'ad-bud-hero__line' }, line),
      failed ? h('p', { class: 'ad-bud-hero__warn', html: icon('alert-triangle') + '<span>' + esc(t('ad.bud.hero_failed', { err: failText(failed.meta && failed.meta.reason, failed.meta && failed.meta.error) })) + '</span>' }) : null,
      hintKey ? h('p', { class: 'ad-bud-hero__hint', id: 'ad-bud-alert-hint', html: icon(hintKey === 'ad.bud.hint_noemail' ? 'phone' : alerted ? 'mail' : 'send') + '<span>' + esc(t(hintKey, { why: why })) + '</span>' }) : null);
    var actions = h('div', { class: 'ad-bud-hero__actions' });
    if (ds !== 'closed') {
      var canAlert = !!s.recipient_email;
      actions.appendChild(h('button', {
        type: 'button', class: 'btn ' + (hot ? 'btn--white ad-bud-alertbtn' : 'btn--danger') + ' btn--lg', 'data-act': 'alert', disabled: !canAlert,
        'data-alert-mode': alerted ? 'again' : 'now', 'aria-describedby': hintKey ? 'ad-bud-alert-hint' : null,
        html: icon(alerted ? 'refresh' : 'send') + '<span>' + esc(t(alerted ? 'ad.bud.alert_again' : 'ad.bud.alert_now')) + '</span>'
      }));
      actions.appendChild(h('button', {
        type: 'button', class: 'btn ' + (hot ? 'btn--glass' : 'btn--outline') + ' btn--lg', 'data-act': 'resolve',
        html: icon('shield-check') + '<span>' + esc(t('ad.bud.resolve')) + '</span>'
      }));
    }
    el.hero.appendChild(ringWrap);
    el.hero.appendChild(text);
    el.hero.appendChild(actions);
  }

  function renderInfo() {
    var s = selected();
    if (!s || !el.info) return;
    el.info.innerHTML = '';
    var rows = [
      [t('ad.bud.i_recipient'), h('span', null, s.recipient_name || '–')],
      [t('ad.bud.i_email'), h('span', { class: 'mono' }, s.recipient_email ? (state.reveal ? s.recipient_email : maskEmail(s.recipient_email)) : '–')],
      [t('ad.bud.i_phone'), h('span', { class: 'ad-bud-phone' }, h('span', { class: 'mono' }, s.recipient_phone ? (state.reveal ? s.recipient_phone : maskPhone(s.recipient_phone)) : '–'),
        s.recipient_phone ? h('button', { type: 'button', class: 'btn btn--soft btn--sm', 'data-act': 'call', html: icon('phone') + '<span>' + esc(t('ad.bud.call')) + '</span>' }) : null)],
      [t('ad.bud.i_interval'), h('span', null, U.fmtDuration(s.interval_min))],
      [t('ad.bud.i_grace'), h('span', null, U.fmtDuration(s.grace_min || 0))],
      [t('ad.bud.i_route'), h('span', null, kit.routeName(s.route_id))],
      [t('ad.bud.i_mode'), h('span', null, modeLabel(s.travel_mode))],
      [t('ad.bud.i_started'), h('span', null, U.fmtDateTime(s.started_at))],
      [t('ad.bud.i_heartbeat'), heartbeatInfo(s)],
      [t('ad.bud.i_session'), h('span', { class: 'mono ad-bud-sid', title: s.id }, String(s.id).slice(0, 8))]
    ];
    el.info.appendChild(h('dl', { class: 'kv' }, rows.map(function (r) { return h('div', { class: 'kv__row' }, h('dt', null, r[0]), h('dd', null, r[1])); })));
    el.info.appendChild(h('button', {
      type: 'button', class: 'btn btn--ghost btn--sm ad-bud-reveal', 'data-act': 'reveal', 'aria-pressed': state.reveal ? 'true' : 'false',
      html: icon(state.reveal ? 'eye-off' : 'eye') + '<span>' + esc(t(state.reveal ? 'ad.bud.hide' : 'ad.bud.reveal')) + '</span>'
    }));
    el.med.innerHTML = '';
    var pm = s.public_medical;
    if (s.share_public_medical && pm) {
      el.med.appendChild(h('div', { class: 'ad-bud-med__card' },
        h('div', { class: 'ad-bud-med__head' }, h('span', { class: 'icon-tile icon-tile--sm icon-tile--danger', html: icon('heart-pulse') }),
          h('div', null, h('strong', null, t('ad.bud.med_title')), h('small', null, t('ad.bud.med_consent')))),
        h('div', { class: 'ad-bud-med__grid' },
          h('div', { class: 'ad-bud-med__blood' }, h('small', null, t('ad.bud.med_blood')), h('b', null, pm.blood_type && pm.blood_type !== 'unknown' ? pm.blood_type.replace('-', '−') : '?')),
          h('dl', { class: 'ad-bud-med__list' },
            [['allergies', pm.allergies], ['conditions', pm.conditions], ['medications', pm.medications]].map(function (r) {
              return h('div', null, h('dt', null, t('ad.bud.med_' + r[0])), h('dd', null, r[1] || '–'));
            })))));
    } else {
      el.med.appendChild(h('p', { class: 'ad-bud-med__none', html: icon('lock', 'icon--xs') + '<span>' + esc(t('ad.bud.med_none')) + '</span>' }));
    }
  }

  /** Last heartbeat of the app (state + time) and, when set in the future, the predicted silence window. */
  function heartbeatInfo(s) {
    if (!s.last_heartbeat_at) return h('span', { class: 'ad-bud-hb ad-bud-hb--none' }, t('ad.bud.hb_none'));
    var at = U.fmtTime(s.last_heartbeat_at), rel = U.relTime(s.last_heartbeat_at);
    var main = t(s.heartbeat_state === 'paused' ? 'ad.bud.hb_paused' : 'ad.bud.hb_live', { at: at, rel: rel });
    var su = s.silence_until && Date.parse(s.silence_until) > now() ? t('ad.bud.hb_silence', { at: U.fmtTime(s.silence_until) }) : null;
    return h('span', { class: 'ad-bud-hb' + (isLost(s) ? ' ad-bud-hb--lost' : '') }, main + (su ? ' · ' + su : ''));
  }

  /** alert_sent that was only simulated: local mode, provider 'simulated' / 'demo' (reserved address) or a dry run. */
  function evSimulated(e) {
    var m = e.meta || {};
    var s = state.rows.filter(function (r) { return r.id === e.session_id; })[0] || selected();
    return localMode() || m.provider === 'simulated' || m.provider === 'demo' || !!m.dry_run || !!simWhy(s);
  }
  function evTitle(e) {
    if (e.kind === 'alert_sent') {
      var sim = evSimulated(e) ? '_sim' : '';
      return t((e.meta && e.meta.type === 'resolved' ? 'ad.bud.ev_all_clear' : 'ad.bud.ev_alert_sent') + sim);
    }
    if (e.kind === 'overdue' && e.meta && e.meta.reason === 'contact_lost') return t('ad.bud.ev_contact_lost');
    var k = 'ad.bud.ev_' + e.kind;
    var s = t(k);
    return s === k ? e.kind : s;
  }
  function evMeta(e) {
    var parts = [];
    var m = e.meta || {};
    if (e.queued && e.received_at && e.client_ts) {
      var dly = (Date.parse(e.received_at) - Date.parse(e.client_ts)) / 60000;
      parts.push(t('ad.bud.ev_queued', { d: U.fmtDuration(Math.max(0, dly)) }));
    } else if (m.source === 'server') {
      parts.push(t('ad.bud.ev_server'));
    } else if (e.received_at && e.kind !== 'alert_sent' && e.kind !== 'alert_failed' && e.kind !== 'resolved' && e.kind !== 'overdue') {
      parts.push(t('ad.bud.ev_delivered'));
    }
    if (e.kind === 'alert_sent' || e.kind === 'alert_failed') {
      if (m.to) parts.push(t('ad.bud.ev_to', { to: state.reveal || /[*•]/.test(m.to) ? m.to : maskEmail(m.to) }));
      if (m.trigger) parts.push(m.trigger === 'manual' ? t('ad.bud.ev_manual') : t('ad.bud.ev_cron'));
      if (m.reason && m.type !== 'resolved') parts.push(NC.i18n.has('ad.bud.ev_reason_' + m.reason) ? t('ad.bud.ev_reason_' + m.reason) : m.reason);
      if (e.kind === 'alert_failed' && m.alert_reason && m.alert_reason !== m.reason && NC.i18n.has('ad.bud.ev_reason_' + m.alert_reason)) parts.push(t('ad.bud.ev_reason_' + m.alert_reason));
      if (e.kind === 'alert_failed' && m.error && m.error !== m.reason) parts.push(t('ad.bud.ev_error', { e: m.error }));
      // (an alert_sent title already says "mô phỏng" when it was simulated)
      if (m.provider && !(e.kind === 'alert_sent' && evSimulated(e))) parts.push(m.provider === 'simulated' || m.provider === 'demo' ? t('ad.bud.ev_sim') : m.provider);
      if (m.include_medical) parts.push(t('ad.bud.ev_med'));
    }
    if (e.kind === 'overdue' && m.reason === 'contact_lost' && m.last_heartbeat_at) parts.push(t('ad.bud.ev_last_signal', { at: U.fmtTime(m.last_heartbeat_at), rel: U.relTime(m.last_heartbeat_at) }));
    if (e.kind === 'resolved' && (m.admin || m.by)) parts.push(t('ad.bud.ev_by', { who: m.admin || m.by }));
    if (m.position === 'last_known') parts.push(t('ad.bud.ev_last_known'));
    if (e.kind === 'pre_deadzone') parts = parts.concat(deadzoneParts(m, !evNote(e)));
    return parts.join(' · ');
  }

  function num(v) { return v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v; }
  /** Localised description of a pre-dead-zone position (app meta: distance_km, minutes, zone_start_km/zone_end_km; seed: minutes_to_deadzone). */
  function deadzoneParts(m, needGeneric) {
    var out = [];
    var d = num(m.distance_km), mins = num(m.minutes !== undefined && m.minutes !== null ? m.minutes : m.minutes_to_deadzone);
    var a = num(m.zone_start_km), b = num(m.zone_end_km);
    if (d !== null && d > 0) out.push(mins !== null && mins > 0 ? t('ad.bud.dz_ahead_eta', { d: U.fmtKm(d), m: U.fmtDuration(mins) }) : t('ad.bud.dz_ahead', { d: U.fmtKm(d) }));
    if (a !== null && b !== null && b > a) out.push(t('ad.bud.dz_zone', { a: U.fmtNumber(a, 1), b: U.fmtNumber(b, 1) }));
    if (!out.length && needGeneric) out.push(t('ad.bud.dz_sent'));
    return out;
  }
  /**
   * Note to quote under an event, or '' for an internal marker (the app used to send note:'pre-deadzone' = its kind):
   * those read as code in the dashboard, so the meta line describes the event instead.
   */
  function evNote(e) {
    var n = String(e.note || '').trim();
    if (!n) return '';
    if (/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(n) && n.replace(/-/g, '_') === String(e.kind || '')) return '';
    return n;
  }

  function renderTimeline() {
    if (!el.tl) return;
    var s = selected();
    var evs = state.events.filter(function (e) { return s && e.session_id === s.id; }).slice().reverse();
    el.tlSub.textContent = t('ad.bud.timeline_sub', { n: evs.length });
    el.tl.innerHTML = '';
    if (!evs.length) { el.tl.appendChild(h('p', { class: 'muted small' }, t('ad.bud.ev_none'))); return; }
    var ol = h('ol', { class: 'ad-bud-tl__list' });
    evs.forEach(function (e) {
      var ic = EV_ICON[e.kind] || ['circle', 'neutral'];
      if (e.kind === 'alert_sent' && e.meta && e.meta.type === 'resolved') ic = ['shield-check', 'success'];
      var meta = evMeta(e);
      var note = evNote(e);
      var ts = e.client_ts || e.received_at;
      var li = h('li', { class: 'ad-bud-ev ad-bud-ev--' + e.kind + (state.flashIds[e.id] ? ' ad-pg-flash' : ''), 'data-ev': e.id },
        h('span', { class: 'icon-tile icon-tile--sm icon-tile--' + ic[1] + ' ad-bud-ev__icon', html: icon(ic[0]) }),
        h('div', { class: 'ad-bud-ev__body' },
          h('div', { class: 'ad-bud-ev__top' },
            h('strong', null, evTitle(e)),
            h('time', { datetime: ts || '', title: U.fmtDateTime(ts) }, U.fmtTime(ts), h('small', null, ' · ' + U.relTime(ts)))),
          meta ? h('p', { class: 'ad-bud-ev__meta' + (e.queued ? ' ad-bud-ev__meta--queued' : '') }, e.queued ? h('span', { html: icon('cloud-upload', 'icon--xs') }) : null, meta) : null,
          note ? h('p', { class: 'ad-bud-ev__note' }, '“' + note + '”') : null));
      ol.appendChild(li);
    });
    el.tl.appendChild(ol);
    var flashed = Object.keys(state.flashIds);
    if (flashed.length) {
      var first = el.tl.querySelector('.ad-pg-flash');
      if (first && first.scrollIntoView && kit.visible(first)) {
        var r = first.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setTimeout(function () { flashed.forEach(function (k) { delete state.flashIds[k]; }); }, 2600);
    }
  }

  /* ------------------------------------------------------------ map */

  function destroyMap() {
    if (map) { try { map.remove(); } catch (e) { /* ignore */ } }
    map = null; mapLayers = null;
  }

  function renderMap(refit) {
    var s = selected();
    if (!s || !el.mapEl || !window.L) return;
    var L = window.L;
    var has = isFinite(s.last_lat) && isFinite(s.last_lng) && s.last_lat !== null;
    if (!has) {
      el.mapEl.classList.add('is-empty');
      el.mapInfo.textContent = t('ad.bud.map_none');
      el.mapTools.innerHTML = '';
      el.sig.innerHTML = '';
      return;
    }
    el.mapEl.classList.remove('is-empty');
    if (!map) {
      map = NC.mapkit.create(el.mapEl, { zoom: 12, center: [s.last_lat, s.last_lng], scrollWheelZoom: false });
      mapLayers = { route: null, path: null, marker: null, acc: null };
    }
    var ds = dstatus(s);
    var pts = state.events.filter(function (e) { return e.session_id === s.id && isFinite(e.lat) && isFinite(e.lng) && e.lat !== null; }).map(function (e) { return [e.lat, e.lng]; });
    if (mapLayers.path) map.removeLayer(mapLayers.path);
    if (mapLayers.marker) map.removeLayer(mapLayers.marker);
    if (mapLayers.acc) map.removeLayer(mapLayers.acc);
    if (pts.length > 1) {
      mapLayers.path = L.polyline(pts, { className: 'ad-bud-path', weight: 3, dashArray: '2 7', lineCap: 'round', interactive: false }).addTo(map);
    } else mapLayers.path = null;
    var lastEv = state.events.filter(function (e) { return e.session_id === s.id && isFinite(e.lat) && e.lat !== null; }).pop();
    if (lastEv && lastEv.accuracy_m) {
      mapLayers.acc = L.circle([s.last_lat, s.last_lng], { radius: lastEv.accuracy_m, className: 'ad-bud-acc', weight: 1, interactive: false }).addTo(map);
    } else mapLayers.acc = null;
    mapLayers.marker = L.marker([s.last_lat, s.last_lng], {
      icon: L.divIcon({ className: 'ad-bud-pinwrap', html: '<span class="ad-bud-pin ad-bud-pin--' + tone(ds) + '"><span class="ad-bud-pin__pulse"></span><span class="ad-bud-pin__dot">' + esc(initials(s.traveler_name)) + '</span></span>', iconSize: [40, 40], iconAnchor: [20, 20] }),
      keyboard: false, title: s.traveler_name || '', zIndexOffset: 1000
    }).addTo(map);
    var acc = lastEv && lastEv.accuracy_m;
    var coords = U.fmtNumber(s.last_lat, 5) + ', ' + U.fmtNumber(s.last_lng, 5);
    el.mapInfo.textContent = acc ? t('ad.bud.loc_line', { coords: coords, acc: Math.round(acc), rel: U.relTime(s.last_location_at || s.last_checkin_at) }) : t('ad.bud.loc_line_noacc', { coords: coords, rel: U.relTime(s.last_location_at || s.last_checkin_at) });
    el.mapTools.innerHTML = '';
    el.mapTools.appendChild(h('button', { type: 'button', class: 'btn btn--outline btn--sm btn--icon', 'data-act': 'copy', title: t('ad.bud.copy_coords'), 'aria-label': t('ad.bud.copy_coords'), html: icon('copy') }));
    el.mapTools.appendChild(h('a', { class: 'btn btn--outline btn--sm btn--icon', href: 'https://www.openstreetmap.org/#map=15/' + (+s.last_lat).toFixed(5) + '/' + (+s.last_lng).toFixed(5), target: '_blank', rel: 'noopener noreferrer', title: t('ad.bud.open_osm'), 'aria-label': t('ad.bud.open_osm'), html: icon('external-link') }));
    NC.mapkit.refresh(map);
    if (refit) {
      setTimeout(function () {
        if (!map) return;
        if (pts.length > 1) NC.mapkit.fitTo(map, pts.concat([[s.last_lat, s.last_lng]]), { padding: [34, 34], maxZoom: 14 });
        else map.setView([s.last_lat, s.last_lng], 13, { animate: false });
      }, 40);
    }
    renderSignal(s, refit);
  }

  /** Route overlay for the chosen carrier + level at the last location for every carrier. */
  function renderSignal(s, redrawRoute) {
    if (!s.route_id) { el.sig.innerHTML = ''; return; }
    var pt = { lat: +s.last_lat, lng: +s.last_lng };
    var carriers = kit.carriers();
    Promise.all(carriers.map(function (c) { return kit.graph(s.route_id, c.id).catch(function () { return null; }); })).then(function (graphs) {
      if (!map || state.selId !== s.id) return;
      var levels = graphs.map(function (g) { return g ? kit.levelOf(g, pt) : null; });
      el.sig.innerHTML = '';
      var anyLost = levels.some(function (l) { return l && l.level === 'lost'; });
      el.sig.appendChild(h('p', { class: 'ad-pg-label' }, t('ad.bud.sig_at')));
      el.sig.appendChild(h('div', { class: 'ad-bud-sig__chips' }, carriers.map(function (c, i) {
        var lv = levels[i] && levels[i].level;
        var on = state.mapCarrier === c.id;
        return h('button', {
          type: 'button', class: 'ad-bud-sigchip ad-bud-sigchip--' + (lv || 'none') + (on ? ' is-selected' : ''), 'data-act': 'carrier', 'data-value': c.id, 'aria-pressed': on ? 'true' : 'false',
          title: levels[i] && levels[i].distance_km > 0.3 ? t('ad.bud.sig_off', { d: U.fmtKm(levels[i].distance_km) }) : null
        }, h('span', { class: 'ad-sig-cdot ad-sig-cdot--' + c.id, 'aria-hidden': 'true' }), h('b', null, c.name),
          lv ? h('span', { class: 'ad-bud-sigchip__lv' }, h('span', { class: 'signal-dot signal-dot--' + lv, 'aria-hidden': 'true' }), t('common.sig.' + lv)) : h('span', null, '–'));
      })));
      if (anyLost) el.sig.appendChild(h('p', { class: 'ad-bud-sig__hint', html: icon('info', 'icon--xs') + '<span>' + esc(t('ad.bud.sig_hint')) + '</span>' }));
      var gi = carriers.map(function (c) { return c.id; }).indexOf(state.mapCarrier);
      var g = graphs[gi >= 0 ? gi : 0];
      if (g && (redrawRoute || !mapLayers.route)) {
        if (mapLayers.route) map.removeLayer(mapLayers.route);
        mapLayers.route = NC.mapkit.drawRoute(map, g, { weight: 5 });
        if (mapLayers.route.bringToBack) mapLayers.route.eachLayer(function (l) { if (l.bringToBack) l.bringToBack(); });
      }
    });
  }

  /* ------------------------------------------------------------ actions */

  function sendAlert(s, btn) {
    var to = maskEmail(s.recipient_email);
    var again = s.status === 'alerted';
    NC.ui.confirm({
      title: t(again ? 'ad.bud.alert_again_t' : 'ad.bud.alert_t', { name: s.traveler_name || '?' }),
      message: t(isSos(s) ? 'ad.bud.alert_m_sos' : 'ad.bud.alert_m', { to: to, medical: s.share_public_medical ? t('ad.bud.alert_m_med') : '' }) +
        (simWhy(s) ? t('ad.bud.alert_m_sim', { why: simWhy(s) }) : ''),
      confirmLabel: t(again ? 'ad.bud.alert_again' : 'ad.bud.alert_now'), danger: true
    }).then(function (ok) {
      if (!ok) return;
      NC.ui.setLoading(btn, true);
      var before = {};
      state.events.forEach(function (e) { before[e.id] = true; });
      return NC.data.admin.triggerAlert(s.id).then(function (res) {
        NC.ui.setLoading(btn, false);
        var results = (res && res.results) || [];
        var sent = !!res && (res.sent > 0 || results.some(function (r) { return r && r.status === 'sent'; }));
        var fails = results.filter(function (r) { return r && r.status === 'failed'; });
        if (sent) {
          var why = simWhy(s) || (res.dry_run || res.provider === 'simulated' || res.provider === 'demo' ? t('ad.bud.why_local') : null);
          NC.ui.toast(why ? t('ad.bud.alert_ok_sim', { to: to, why: why }) : t('ad.bud.alert_ok', { to: to, sim: '' }), { type: why ? 'info' : 'success', timeout: 6000 });
          beep(true);
        } else if (res && (res.failed > 0 || fails.length || res.ok === false)) {
          // A delivery failure (provider not configured, rate limit, …): the recipient was NOT notified.
          state.muteFail[s.id] = true;
          var f0 = fails[0] || {};
          NC.ui.toast(t('ad.bud.alert_failed_toast', { err: failText(f0.error === 'rate_limited' ? 'rate_limited' : null, f0.error || res.error) }), { type: 'danger', timeout: 12000 });
        } else {
          NC.ui.toast(t('ad.bud.alert_none'), { type: 'warning', timeout: 6000 });
        }
        return NC.data.admin.listBuddyEvents(s.id).then(function (evs) {
          (evs || []).forEach(function (e) { if (!before[e.id]) state.flashIds[e.id] = true; });
          return reload();
        });
      }, function (e) { NC.ui.setLoading(btn, false); kit.toastErr(e); });
    });
  }

  function resolve(s) {
    var note = h('textarea', { class: 'textarea', rows: 3, maxlength: 500, placeholder: t('ad.bud.resolve_ph'), id: 'ad-bud-note' });
    var quick = h('div', { class: 'chip-group ad-bud-quick' }, ['q1', 'q2', 'q3', 'q4'].map(function (k) {
      return h('button', { type: 'button', class: 'chip chip--soft', 'data-q': t('ad.bud.' + k) }, t('ad.bud.' + k));
    }));
    quick.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-q]') : null;
      if (!b) return;
      note.value = b.getAttribute('data-q');
      note.focus();
    });
    var body = h('div', { class: 'stack stack--sm' },
      h('p', { class: 'muted small' }, simWhy(s) ? t('ad.bud.resolve_m_sim', { why: simWhy(s) }) : t('ad.bud.resolve_m')),
      quick,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'ad-bud-note' }, t('ad.bud.resolve_note')), note));
    NC.ui.modal({
      title: t('ad.bud.resolve_t', { name: s.traveler_name || '?' }), icon: 'shield-check', iconVariant: 'success', size: 'sm', body: body,
      actions: [
        { label: t('common.cancel'), variant: 'ghost' },
        {
          label: t('ad.bud.resolve'), variant: 'primary', icon: 'check', onClick: function () {
            return NC.data.admin.resolveSession(s.id, note.value.trim() || null).then(function (res) {
              var clear = res && res.previous_status === 'alerted';
              NC.ui.toast(t('ad.bud.resolved_ok', { name: s.traveler_name || '?' }) + (clear ? t(simWhy(s) ? 'ad.bud.resolved_clear_sim' : 'ad.bud.resolved_clear') : ''), { type: 'success', timeout: 5000 });
              state.flashIds = {};
              return reload();
            });
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------ ticker */

  function tick() {
    if (!visible) return;
    var byId = {};
    state.rows.forEach(function (s) { byId[s.id] = s; });
    var needSort = false;
    U.$$('[data-count]', el.root).forEach(function (node) {
      var s = byId[node.getAttribute('data-count')];
      if (!s) return;
      var cd = countdown(s);
      node.textContent = cd.text;
      var lbl = el.root.querySelector('[data-count-lbl="' + s.id + '"]');
      if (lbl) lbl.textContent = cd.label;
      var item = node.closest('.ad-bud-item');
      if (item && !item.classList.contains('ad-bud-item--' + cd.ds)) needSort = true;
    });
    // Ring progress for the selected session.
    var sel = selected();
    if (sel && el.hero) {
      var ds = dstatus(sel);
      if (!el.hero.classList.contains('ad-bud-hero--' + ds)) { renderHero(sel, ds); el.detail.className = 'ad-bud-detail ad-bud-detail--' + ds; }
      else if (ds === 'active' || ds === 'soon') {
        var arc = el.hero.querySelector('.vz-ring__arc');
        if (arc) {
          var c = parseFloat(arc.getAttribute('stroke-dasharray')) || 0;
          var frac = Math.max(0, Math.min(1, (countdown(sel).ms || 0) / ((sel.interval_min || 60) * 60000)));
          arc.setAttribute('stroke-dashoffset', (c * (1 - frac)).toFixed(2));
        }
      }
    }
    if (needSort) { renderKpis(); renderFilters(); renderList(); kit.refreshBadges(); }
  }

  /* ------------------------------------------------------------ lifecycle */

  function show(params) {
    visible = true;
    params = params || {};
    kit.routes();
    var first = !state.prev;
    reload().then(function () {
      var wantId = params.id && state.rows.some(function (s) { return s.id === params.id; }) ? params.id : null;
      if (wantId) select(wantId, false);
      else if (first && !state.selId && window.innerWidth >= 768) {
        var top = sortRows(state.rows)[0];
        if (top) select(top.id, false);
      } else if (map) NC.mapkit.refresh(map);
    });
    if (!ticker) ticker = setInterval(tick, 1000);
    if (!poll) poll = setInterval(function () { if (visible && document.visibilityState !== 'hidden') reload(); }, 30000);
    if (!offRealtime) {
      offRealtime = kit.subscribe(['buddy_sessions', 'checkin_events'], function () { reload(); }, 300);
    }
  }

  function hide() {
    visible = false;
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (poll) { clearInterval(poll); poll = null; }
    // Keep the realtime subscription alive so the nav badge + alarms work while another page is open.
  }

  kit.register('buddy', {
    titleKey: 'ad.bud.nav',
    shortKey: 'ad.bud.nav_short',
    icon: 'users',
    order: 15,
    group: 'ops',
    mount: mount,
    show: show,
    hide: hide,
    /** Nav badge: sessions needing action (overdue + alert sent, not yet resolved). */
    badge: function () {
      return NC.data.admin.listBuddySessions().then(function (rows) {
        var n = (rows || []).filter(function (s) { return s.status === 'overdue' || s.status === 'alerted'; }).length;
        return n ? { count: n, tone: 'danger' } : null;
      }, function () { return null; });
    }
  });
})(window.NC = window.NC || {});
