/*
 * mod03-qr.js — MOD.03 "Hồ sơ QR sinh tồn": two-layer emergency profile. PUBLIC layer (blood type, allergies,
 * conditions, medications) as a plain-text QR readable by any camera offline, a 1170×2532 lock-screen wallpaper PNG
 * and a printable wallet card; IDENTITY layer only in the rescuer view after hold-to-confirm (+ optional 4-digit code).
 * Owner: P2 mod03-qr. Route #/qr (owner view) and #/qr?view=rescuer (full-screen rescuer card).
 * Public API: NC.qr.{matrix(text, opts), svg(text, opts), wallpaper() → Promise<{blob, url}>, openRescuer(), printCard(),
 *   gateIdentity({reason}) → Promise<boolean> (hold + 4-digit code with the shared persisted lockout)}
 */
(function (NC) {
  'use strict';

  var U = NC.util, $ = U.$, $$ = U.$$, h = U.h, esc = U.esc;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function I(n, c) { return NC.ui.icon(n, c); }

  var KV_WALLPAPER = 'qr.wallpaper_at';
  var KV_REVEALS = 'qr.reveals';
  var HOLD_MS = 1500;
  var REVEAL_SECONDS = 60;
  var KV_LOCK = 'qr.rs_lock';          // {attempts, lockUntil, lastFail} — survives exit, re-entry and reload
  var MAX_ATTEMPTS = 5;                // free tries; every further wrong code doubles the lockout
  var LOCKOUT_MS = 30000;              // first lockout 30 s → 60 s → 2 min … (exponential back-off)
  var LOCK_MAX_MS = 60 * 60000;        // back-off cap 1 h
  var LOCK_DECAY_MS = 24 * 3600000;    // failures older than 24 h (and not locked) are forgotten
  var QR_MAX_CHARS = (NC.profile && NC.profile.QR_MAX) || 600;
  var NONE_VALUE = 'Không có / None';

  /* ================================================================== */
  /* i18n — qr.*                                                          */
  /* ================================================================== */
  NC.i18n.add({
    vi: {
      'qr.hero.title': 'Hồ sơ y tế khẩn cấp',
      'qr.intro.lead': 'Mã QR chỉ chứa thông tin y tế để cấp cứu đúng — không lộ bạn là ai.',
      'qr.card.title': 'Mã QR y tế',
      'qr.dg.fold_sub': 'Ai xem được thông tin nào, và khi nào',
      'qr.pv.fold_title': 'Quyền riêng tư & chi tiết kỹ thuật',
      'qr.pv.bytes': '{n} byte',
      'qr.hero.sub': 'Nhóm máu, dị ứng, bệnh nền và thuốc — đủ để cấp cứu đúng mà không lộ bạn là ai.',
      'qr.hero.encrypted': 'Mã hoá trên máy',
      'qr.hero.not_encrypted': 'Chưa mã hoá',
      'qr.hero.empty_title': 'Chưa có hồ sơ y tế',
      'qr.hero.empty_sub': 'Tạo hồ sơ 4 trường để có mã QR quét được ngay cả khi máy khoá.',
      'qr.hero.placeholder': 'Mã QR sẽ hiện ở đây',
      'qr.stat.blood': 'Nhóm máu',
      'qr.stat.fields': 'Trường bắt buộc',
      'qr.stat.uploaded': 'Byte gửi lên máy chủ',
      'qr.caption': 'Quét bằng camera bất kỳ — không cần app, không cần mạng',
      'qr.qr_aria': 'Mã QR lớp y tế công khai',
      'qr.act.aria': 'Thao tác với mã QR',
      'qr.act.wallpaper': 'Hình nền khoá',
      'qr.act.wallpaper_hint': 'Quét được khi máy khoá',
      'qr.act.print': 'In thẻ ví',
      'qr.act.print_hint': 'Thẻ 85,6 × 54 mm gấp đôi',
      'qr.act.rescuer': 'Chế độ cứu hộ',
      'qr.act.rescuer_hint': 'Toàn màn hình, song ngữ',
      'qr.act.wallpaper_done': 'Đã tạo {date}',
      'qr.act.wallpaper_stale': 'Cần tạo lại',
      'qr.act.wallpaper_none': 'Chưa tạo',
      'qr.pub.title': 'Lớp công khai',
      'qr.pub.sub': 'Không định danh · hiện trên QR, hình nền và thẻ ví',
      'qr.pub.complete': 'Đủ 4 trường bắt buộc',
      'qr.pub.incomplete': 'Thiếu {n} trường bắt buộc',
      'qr.pub.updated': 'Cập nhật {when}',
      'qr.pub.empty_title': 'Chưa có thông tin y tế',
      'qr.pub.empty_text': '4 trường ngắn giúp nhân viên y tế xử lý đúng khi bạn không thể nói.',
      'qr.pub.create': 'Tạo hồ sơ y tế',
      'qr.f.blood_type': 'Nhóm máu',
      'qr.f.allergies': 'Dị ứng',
      'qr.f.conditions': 'Bệnh nền',
      'qr.f.medications': 'Thuốc đang dùng',
      'qr.f.notes': 'Ghi chú y tế',
      'qr.f.full_name': 'Họ và tên',
      'qr.f.nationality': 'Quốc tịch',
      'qr.f.contact_name': 'Người liên hệ khẩn cấp',
      'qr.f.contact_phone': 'SĐT người liên hệ',
      'qr.f.reveal_code': 'Mã hiện định danh',
      'qr.f.missing': 'Chưa khai báo',
      'qr.f.empty': 'Chưa thêm',
      'qr.blood.unknown': 'Không rõ',
      'qr.blood.pos': 'Rh dương',
      'qr.blood.neg': 'Rh âm',
      'qr.id.title': 'Lớp định danh',
      'qr.id.sub': 'Chỉ hiện sau khi nhấn giữ xác nhận (+ mã 4 số nếu đã đặt)',
      'qr.id.show': 'Hiện',
      'qr.id.hide': 'Ẩn',
      'qr.id.show_aria': 'Hiện thông tin định danh trên máy của bạn',
      'qr.id.hide_aria': 'Ẩn thông tin định danh',
      'qr.id.code_set': 'Đã đặt',
      'qr.id.code_none': 'Không đặt — chỉ cần nhấn giữ',
      'qr.id.empty': 'Chưa có thông tin định danh — không bắt buộc. Người cứu hộ vẫn thấy lớp y tế.',
      'qr.id.add': 'Thêm thông tin định danh',
      'qr.id.no_id_number': 'Không có trường số CCCD/hộ chiếu — theo thiết kế.',
      'qr.id.last_reveal': 'Mở ở chế độ cứu hộ gần nhất: {when}',
      'qr.id.never_revealed': 'Chưa từng được mở ở chế độ cứu hộ.',
      'qr.dg.title': 'Hai lớp bảo vệ danh tính',
      'qr.dg.sub': 'Ai nhặt được máy chỉ thấy thông tin y tế — không biết bạn là ai.',
      'qr.dg.l1': 'Lớp 1 · Công khai',
      'qr.dg.l1_items': 'Nhóm máu · Dị ứng · Bệnh nền · Thuốc đang dùng',
      'qr.dg.l1_where': 'QR trên màn hình khoá · thẻ ví · chế độ người cứu hộ',
      'qr.dg.gate': 'Nhấn giữ 1,5 giây (+ mã 4 số nếu đã đặt)',
      'qr.dg.l2': 'Lớp 2 · Định danh',
      'qr.dg.l2_items': 'Họ tên · Quốc tịch · Người liên hệ khẩn cấp',
      'qr.dg.l2_where': 'Chỉ trong chế độ người cứu hộ, tự ẩn sau 60 giây',
      'qr.dg.none': 'Không thu thập',
      'qr.dg.none_items': 'Số CCCD / hộ chiếu — giá trị cấp cứu thấp, rủi ro lộ danh tính cao',
      'qr.pv.title': 'Quyền riêng tư',
      'qr.pv.sub': 'Hồ sơ chỉ nằm trên máy này.',
      'qr.pv.enc': 'Mã hoá AES-GCM 256-bit trên máy',
      'qr.pv.enc_on': 'Khoá mã hoá không xuất được, lưu trong trình duyệt của bạn.',
      'qr.pv.enc_off': 'Trình duyệt này không hỗ trợ mã hoá — dữ liệu đang lưu không mã hoá.',
      'qr.pv.on': 'Đang bật',
      'qr.pv.off': 'Không khả dụng',
      'qr.pv.never': 'Không bao giờ tải lên máy chủ',
      'qr.pv.never_hint': 'Lớp y tế chỉ đi kèm cảnh báo Buddy khi bạn tự bật.',
      'qr.pv.noid': 'Không có trường số giấy tờ tuỳ thân',
      'qr.pv.noid_hint': 'Tối thiểu hoá dữ liệu: giá trị cấp cứu thấp, rủi ro cao.',
      'qr.pv.wipe': 'Xoá toàn bộ bằng 1 chạm',
      'qr.pv.wipe_hint': 'Cài đặt › Quyền riêng tư & dữ liệu',
      'qr.pv.payload': 'Xem nội dung mã QR',
      'qr.pv.payload_meta': '{chars}/{max} ký tự · {bytes} byte · phiên bản {ver} · sửa lỗi {ecl}',
      'qr.pv.copy': 'Sao chép nội dung',
      'qr.consent.title': 'Đồng ý xử lý dữ liệu y tế nhạy cảm',
      'qr.consent.lead': 'Theo Nghị định 356/2025/NĐ-CP, NomadCare cần sự đồng ý riêng của bạn trước khi lưu thông tin sức khoẻ.',
      'qr.consent.p1': 'Chỉ lưu trên máy này, mã hoá AES-GCM.',
      'qr.consent.p2': 'Không bao giờ tải lên máy chủ.',
      'qr.consent.p3': 'Xem, sửa hoặc xoá toàn bộ bằng 1 chạm trong Cài đặt.',
      'qr.consent.check': 'Tôi đồng ý cho NomadCare xử lý dữ liệu sức khoẻ của tôi trên thiết bị này.',
      'qr.consent.accept': 'Đồng ý & tiếp tục',
      'qr.consent.later': 'Để sau',
      'qr.consent.need': 'Cần đồng ý xử lý dữ liệu y tế nhạy cảm để tạo hoặc sửa hồ sơ.',
      'qr.consent.card_title': 'Cần sự đồng ý của bạn',
      'qr.consent.card_text': 'Hồ sơ y tế là dữ liệu nhạy cảm. Chúng tôi chỉ lưu khi bạn đồng ý riêng cho mục đích này.',
      'qr.edit.pub_title': 'Sửa lớp công khai',
      'qr.edit.pub_sub': 'Hiện trên QR và màn hình khoá — đừng nhập họ tên hay số giấy tờ ở đây.',
      'qr.edit.id_title': 'Sửa lớp định danh',
      'qr.edit.id_sub': 'Chỉ hiện sau thao tác xác nhận trong chế độ người cứu hộ.',
      'qr.edit.none': 'Không có',
      'qr.edit.required_err': 'Bắt buộc — chọn “Không có” nếu không áp dụng.',
      'qr.edit.blood_err': 'Chọn nhóm máu hoặc “Không rõ”.',
      'qr.edit.code_hint': 'Nếu đặt, người cứu hộ cần mã này sau khi nhấn giữ. Để trống: chỉ cần nhấn giữ 1,5 giây.',
      'qr.edit.code_err': 'Mã gồm đúng 4 chữ số.',
      'qr.edit.phone_err': 'Số điện thoại chưa hợp lệ.',
      'qr.edit.meter': 'Nội dung QR: {n}/{max} ký tự',
      'qr.edit.saved': 'Đã lưu — mã QR đã cập nhật.',
      'qr.edit.saved_id': 'Đã lưu lớp định danh.',
      'qr.edit.regen': 'Tạo lại hình nền',
      'qr.edit.regen_hint': 'Hồ sơ đã đổi — nhớ tạo lại hình nền màn hình khoá.',
      'qr.ph.allergies': 'VD: Penicillin, đậu phộng',
      'qr.ph.conditions': 'VD: Hen suyễn, tiểu đường type 1',
      'qr.ph.medications': 'VD: Ventolin xịt khi khó thở',
      'qr.ph.notes': 'VD: Đang mang thai 5 tháng; đeo kính áp tròng',
      'qr.ph.full_name': 'VD: Minh Anh',
      'qr.ph.nationality': 'VD: Việt Nam',
      'qr.ph.contact_name': 'VD: Lê Hà (chị gái)',
      'qr.ph.contact_phone': '+84 …',
      'qr.ph.reveal_code': '••••',
      'qr.wp.title': 'Hình nền màn hình khoá',
      'qr.wp.sub': 'Ảnh 1170 × 2532 px — phần trên để trống cho đồng hồ.',
      'qr.wp.steps': 'Tải ảnh → Cài đặt › Hình nền → đặt cho Màn hình khoá. Người cứu hộ quét được mà không cần mở khoá máy.',
      'qr.wp.download': 'Tải ảnh PNG',
      'qr.wp.share': 'Lưu vào Ảnh',
      'qr.wp.saved': 'Đã lưu hình nền — đặt làm màn hình khoá trong Cài đặt của máy.',
      'qr.wp.error': 'Không tạo được ảnh trên trình duyệt này.',
      'qr.wp.need_profile': 'Hãy tạo hồ sơ y tế trước.',
      'qr.wp.preview_alt': 'Xem trước hình nền màn hình khoá có mã QR y tế',
      'qr.pr.hint': 'Cắt theo viền ngoài, gấp đôi theo nét đứt, ép plastic và cất cùng giấy tờ.',
      'qr.pr.opening': 'Đang mở hộp thoại in…',
      'qr.rs.exit': 'Thoát',
      'qr.rs.exit_aria': 'Thoát chế độ người cứu hộ',
      'qr.id.autohide': 'Đang hiện — tự ẩn sau 60 giây',
      'qr.gate.title_show': 'Xác nhận để hiện định danh',
      'qr.gate.title_edit': 'Xác nhận để sửa định danh',
      'qr.gate.title_export': 'Xác nhận để xuất bản sao dữ liệu',
      'qr.gate.sub': 'Cùng lớp bảo vệ như chế độ người cứu hộ — lượt sai được tính chung.',
      'qr.gate.hold': 'Nhấn giữ 1,5 giây',
      'qr.gate.hold_code': 'Sau đó nhập mã 4 số',
      'qr.gate.hold_only': 'Chưa đặt mã — chỉ cần nhấn giữ',
      'qr.gate.code_title': 'Nhập mã 4 số',
      'qr.gate.code_wrong': 'Sai mã — còn {n} lần thử',
      'qr.gate.code_locked': 'Tạm khoá — thử lại sau {t}',
      'qr.gate.cancel': 'Huỷ',
      'qr.gate.key_del': 'Xoá',
      'qr.gate.t_s': '{n} giây',
      'qr.gate.t_ms': '{m}:{ss} phút',
      'qr.gate.forgot': 'Quên mã? Xoá lớp định danh',
      'qr.gate.forgot_title': 'Xoá lớp định danh?',
      'qr.gate.forgot_msg': 'Họ tên, quốc tịch, người liên hệ và mã sẽ bị xoá khỏi máy này. Lớp y tế công khai được giữ nguyên. Sau đó bạn có thể nhập lại và đặt mã mới.',
      'qr.gate.forgot_ok': 'Xoá lớp định danh',
      'qr.gate.forgot_done': 'Đã xoá lớp định danh — bạn có thể thêm lại bất cứ lúc nào.',
      'qr.edit.code_hint_set': 'Đã đặt mã (không bao giờ hiển thị). Để trống để giữ mã hiện tại, hoặc nhập 4 số mới để đổi.',
      'qr.edit.code_remove': 'Bỏ mã — người cứu hộ chỉ cần nhấn giữ',
      'qr.edit.meter_compact': 'Nội dung QR: {n}/{max} ký tự · nhãn được viết gọn để vừa mã, không mất thông tin',
      'qr.edit.meter_cut': 'Mã QR sẽ bị cắt bớt: {fields}. Rút gọn khoảng {over} ký tự để giữ đầy đủ.',
      'qr.edit.field_cut': 'Bị cắt bớt trong mã QR — chế độ người cứu hộ vẫn hiện đầy đủ.',
      'qr.edit.cut_title': 'Mã QR sẽ bị cắt bớt',
      'qr.edit.cut_msg': '{fields} không vừa {max} ký tự của mã QR. Hồ sơ trên máy và chế độ người cứu hộ vẫn giữ đầy đủ, nhưng mã QR, hình nền khoá và thẻ ví chỉ chứa bản rút gọn. Nên rút gọn trước khi lưu.',
      'qr.edit.cut_save': 'Vẫn lưu',
      'qr.edit.cut_fix': 'Sửa lại',
      'qr.edit.saved_cut': 'Mã QR đã rút gọn: {fields}.',
      'qr.pub.qr_cut': 'QR rút gọn: {fields}',
    },
    en: {
      'qr.hero.title': 'Emergency medical profile',
      'qr.intro.lead': 'The QR holds only medical facts for correct care — not who you are.',
      'qr.card.title': 'Medical QR code',
      'qr.dg.fold_sub': 'Who can see what, and when',
      'qr.pv.fold_title': 'Privacy & technical details',
      'qr.pv.bytes': '{n} bytes',
      'qr.hero.sub': 'Blood type, allergies, conditions and medications — enough for correct care without revealing who you are.',
      'qr.hero.encrypted': 'Encrypted on device',
      'qr.hero.not_encrypted': 'Not encrypted',
      'qr.hero.empty_title': 'No medical profile yet',
      'qr.hero.empty_sub': 'Fill in 4 short fields to get a QR that can be scanned even when your phone is locked.',
      'qr.hero.placeholder': 'Your QR code will appear here',
      'qr.stat.blood': 'Blood type',
      'qr.stat.fields': 'Required fields',
      'qr.stat.uploaded': 'Bytes sent to server',
      'qr.caption': 'Scan with any camera — no app, no internet needed',
      'qr.qr_aria': 'Public medical layer QR code',
      'qr.act.aria': 'QR code actions',
      'qr.act.wallpaper': 'Lock screen',
      'qr.act.wallpaper_hint': 'Scannable while locked',
      'qr.act.print': 'Wallet card',
      'qr.act.print_hint': 'Folds to 85.6 × 54 mm',
      'qr.act.rescuer': 'Rescuer mode',
      'qr.act.rescuer_hint': 'Full screen, bilingual',
      'qr.act.wallpaper_done': 'Created {date}',
      'qr.act.wallpaper_stale': 'Needs update',
      'qr.act.wallpaper_none': 'Not created',
      'qr.pub.title': 'Public layer',
      'qr.pub.sub': 'Non-identifying · on the QR, wallpaper and wallet card',
      'qr.pub.complete': 'All 4 required fields',
      'qr.pub.incomplete': '{n} required fields missing',
      'qr.pub.updated': 'Updated {when}',
      'qr.pub.empty_title': 'No medical details yet',
      'qr.pub.empty_text': '4 short fields help medical staff treat you correctly when you cannot speak.',
      'qr.pub.create': 'Create medical profile',
      'qr.f.blood_type': 'Blood type',
      'qr.f.allergies': 'Allergies',
      'qr.f.conditions': 'Conditions',
      'qr.f.medications': 'Medications',
      'qr.f.notes': 'Medical notes',
      'qr.f.full_name': 'Full name',
      'qr.f.nationality': 'Nationality',
      'qr.f.contact_name': 'Emergency contact',
      'qr.f.contact_phone': 'Contact phone',
      'qr.f.reveal_code': 'Identity code',
      'qr.f.missing': 'Not provided',
      'qr.f.empty': 'Not added',
      'qr.blood.unknown': 'Unknown',
      'qr.blood.pos': 'Rh positive',
      'qr.blood.neg': 'Rh negative',
      'qr.id.title': 'Identity layer',
      'qr.id.sub': 'Shown only after a press-and-hold confirmation (+ the 4-digit code if set)',
      'qr.id.show': 'Show',
      'qr.id.hide': 'Hide',
      'qr.id.show_aria': 'Show identity details on your device',
      'qr.id.hide_aria': 'Hide identity details',
      'qr.id.code_set': 'Set',
      'qr.id.code_none': 'None — press-and-hold only',
      'qr.id.empty': 'No identity details yet — optional. Rescuers still see the medical layer.',
      'qr.id.add': 'Add identity details',
      'qr.id.no_id_number': 'No ID-card / passport number field — by design.',
      'qr.id.last_reveal': 'Last opened in rescuer mode: {when}',
      'qr.id.never_revealed': 'Never opened in rescuer mode.',
      'qr.dg.title': 'Two layers protect your identity',
      'qr.dg.sub': 'Whoever finds your phone sees medical facts only — not who you are.',
      'qr.dg.l1': 'Layer 1 · Public',
      'qr.dg.l1_items': 'Blood type · Allergies · Conditions · Medications',
      'qr.dg.l1_where': 'Lock-screen QR · wallet card · rescuer mode',
      'qr.dg.gate': 'Hold 1.5 s (+ the 4-digit code if set)',
      'qr.dg.l2': 'Layer 2 · Identity',
      'qr.dg.l2_items': 'Name · Nationality · Emergency contact',
      'qr.dg.l2_where': 'Rescuer mode only, auto-hides after 60 s',
      'qr.dg.none': 'Never collected',
      'qr.dg.none_items': 'ID-card / passport numbers — little emergency value, high identity risk',
      'qr.pv.title': 'Privacy',
      'qr.pv.sub': 'Your profile lives on this device only.',
      'qr.pv.enc': 'AES-GCM 256-bit encryption on device',
      'qr.pv.enc_on': 'Non-extractable key kept in your browser.',
      'qr.pv.enc_off': 'This browser cannot encrypt — data is stored unencrypted.',
      'qr.pv.on': 'On',
      'qr.pv.off': 'Unavailable',
      'qr.pv.never': 'Never uploaded to the server',
      'qr.pv.never_hint': 'The medical layer joins Buddy alerts only if you opt in.',
      'qr.pv.noid': 'No ID-document number field',
      'qr.pv.noid_hint': 'Data minimisation: little emergency value, high risk.',
      'qr.pv.wipe': 'Delete everything in one tap',
      'qr.pv.wipe_hint': 'Settings › Privacy & data',
      'qr.pv.payload': 'View QR content',
      'qr.pv.payload_meta': '{chars}/{max} chars · {bytes} bytes · version {ver} · error correction {ecl}',
      'qr.pv.copy': 'Copy content',
      'qr.consent.title': 'Consent to process sensitive health data',
      'qr.consent.lead': 'Under Decree 356/2025/NĐ-CP, NomadCare needs your separate consent before storing health information.',
      'qr.consent.p1': 'Stored on this device only, AES-GCM encrypted.',
      'qr.consent.p2': 'Never uploaded to the server.',
      'qr.consent.p3': 'View, edit or delete everything in one tap in Settings.',
      'qr.consent.check': 'I agree that NomadCare processes my health data on this device.',
      'qr.consent.accept': 'Agree & continue',
      'qr.consent.later': 'Not now',
      'qr.consent.need': 'Consent to process sensitive health data is needed to create or edit the profile.',
      'qr.consent.card_title': 'Your consent is needed',
      'qr.consent.card_text': 'A medical profile is sensitive data. We only store it with your separate consent for this purpose.',
      'qr.edit.pub_title': 'Edit public layer',
      'qr.edit.pub_sub': 'Shown on the QR and lock screen — never enter your name or ID numbers here.',
      'qr.edit.id_title': 'Edit identity layer',
      'qr.edit.id_sub': 'Shown only after a confirmation in rescuer mode.',
      'qr.edit.none': 'None',
      'qr.edit.required_err': 'Required — tap “None” if it does not apply.',
      'qr.edit.blood_err': 'Pick a blood type or “Unknown”.',
      'qr.edit.code_hint': 'If set, rescuers need this code after holding the button. Leave empty: holding 1.5 s is enough.',
      'qr.edit.code_err': 'The code must be exactly 4 digits.',
      'qr.edit.phone_err': 'This phone number looks invalid.',
      'qr.edit.meter': 'QR content: {n}/{max} characters',
      'qr.edit.saved': 'Saved — QR code updated.',
      'qr.edit.saved_id': 'Identity layer saved.',
      'qr.edit.regen': 'Regenerate',
      'qr.edit.regen_hint': 'Profile changed — remember to regenerate the lock-screen wallpaper.',
      'qr.ph.allergies': 'e.g. Penicillin, peanuts',
      'qr.ph.conditions': 'e.g. Asthma, type 1 diabetes',
      'qr.ph.medications': 'e.g. Ventolin inhaler as needed',
      'qr.ph.notes': 'e.g. 5 months pregnant; wears contact lenses',
      'qr.ph.full_name': 'e.g. Alex Morgan',
      'qr.ph.nationality': 'e.g. Australia',
      'qr.ph.contact_name': 'e.g. Sam Morgan (sister)',
      'qr.ph.contact_phone': '+61 …',
      'qr.ph.reveal_code': '••••',
      'qr.wp.title': 'Lock-screen wallpaper',
      'qr.wp.sub': '1170 × 2532 px image — the top is left clear for the clock.',
      'qr.wp.steps': 'Download → Settings › Wallpaper → set it for the Lock Screen. Rescuers can scan it without unlocking your phone.',
      'qr.wp.download': 'Download PNG',
      'qr.wp.share': 'Save to Photos',
      'qr.wp.saved': 'Wallpaper saved — set it as your lock screen in the phone settings.',
      'qr.wp.error': 'Could not create the image in this browser.',
      'qr.wp.need_profile': 'Create your medical profile first.',
      'qr.wp.preview_alt': 'Preview of the lock-screen wallpaper with the medical QR code',
      'qr.pr.hint': 'Cut along the outer edge, fold on the dashed line, laminate and keep it with your documents.',
      'qr.pr.opening': 'Opening the print dialog…',
      'qr.rs.exit': 'Exit',
      'qr.rs.exit_aria': 'Exit rescuer mode',
      'qr.id.autohide': 'Visible — hides again after 60 s',
      'qr.gate.title_show': 'Confirm to show identity',
      'qr.gate.title_edit': 'Confirm to edit identity',
      'qr.gate.title_export': 'Confirm to export a copy of your data',
      'qr.gate.sub': 'Same protection as rescuer mode — wrong tries count together.',
      'qr.gate.hold': 'Press and hold 1.5 s',
      'qr.gate.hold_code': 'Then enter your 4-digit code',
      'qr.gate.hold_only': 'No code set — holding is enough',
      'qr.gate.code_title': 'Enter your 4-digit code',
      'qr.gate.code_wrong': 'Wrong code — {n} tries left',
      'qr.gate.code_locked': 'Locked — try again in {t}',
      'qr.gate.cancel': 'Cancel',
      'qr.gate.key_del': 'Delete',
      'qr.gate.t_s': '{n} s',
      'qr.gate.t_ms': '{m}:{ss} min',
      'qr.gate.forgot': 'Forgot the code? Delete the identity layer',
      'qr.gate.forgot_title': 'Delete the identity layer?',
      'qr.gate.forgot_msg': 'Name, nationality, emergency contact and code will be removed from this device. The public medical layer stays. You can then enter them again and set a new code.',
      'qr.gate.forgot_ok': 'Delete identity layer',
      'qr.gate.forgot_done': 'Identity layer deleted — you can add it again at any time.',
      'qr.edit.code_hint_set': 'A code is set (never displayed). Leave empty to keep it, or type 4 new digits to change it.',
      'qr.edit.code_remove': 'Remove the code — rescuers only need to hold',
      'qr.edit.meter_compact': 'QR content: {n}/{max} characters · labels shortened to fit, nothing lost',
      'qr.edit.meter_cut': 'The QR will be shortened: {fields}. Remove about {over} characters to keep everything.',
      'qr.edit.field_cut': 'Shortened in the QR — rescuer mode still shows it in full.',
      'qr.edit.cut_title': 'The QR code will be shortened',
      'qr.edit.cut_msg': '{fields} do not fit the {max}-character QR code. Your profile on this device and rescuer mode keep everything, but the QR, lock-screen wallpaper and wallet card only carry a shortened version. Shorten it before saving.',
      'qr.edit.cut_save': 'Save anyway',
      'qr.edit.cut_fix': 'Edit again',
      'qr.edit.saved_cut': 'QR shortened: {fields}.',
      'qr.pub.qr_cut': 'QR shortened: {fields}',
    }
  });

  /*
   * Fixed-language strings for bilingual surfaces (rescuer view, wallpaper, wallet card): these must show
   * Vietnamese for local staff AND English whatever the UI language, so each pair is registered under
   * qr.L.vi.* / qr.L.en.* with the same text in both dictionaries.
   */
  var FIXED = {
    header: ['THÔNG TIN Y TẾ KHẨN CẤP', 'EMERGENCY MEDICAL INFO'],
    mode: ['Chế độ người cứu hộ', 'Rescuer mode'],
    blood: ['Nhóm máu', 'Blood type'],
    allergies: ['Dị ứng', 'Allergies'],
    conditions: ['Bệnh nền', 'Conditions'],
    medications: ['Thuốc đang dùng', 'Medications'],
    notes: ['Ghi chú', 'Notes'],
    missing: ['Chưa khai báo', 'Not provided'],
    unknown: ['Không rõ', 'Unknown'],
    call: ['Gọi 115', 'Call 115'],
    call_short: ['Gọi', 'Call'],
    caption: ['Quét bằng camera bất kỳ — không cần app, không cần mạng', 'Scan with any camera — no app, no internet'],
    updated: ['Cập nhật', 'Updated'],
    id_title: ['Thông tin định danh', 'Identity'],
    id_warn: ['Chỉ mở khi cần liên hệ người thân hoặc xác định người bệnh. Lượt mở được ghi lại trên máy.',
      'Open only to contact family or identify the patient. Each opening is logged on this phone.'],
    hold: ['Nhấn giữ 1,5 giây để xem', 'Hold 1.5 s to view'],
    code_title: ['Nhập mã 4 số của chủ máy', 'Enter the owner’s 4-digit code'],
    code_wrong: ['Sai mã — còn {n} lần thử', 'Wrong code — {n} tries left'],
    code_locked: ['Tạm khoá — thử lại sau {t}', 'Locked — try again in {t}'],
    t_s: ['{n} giây', '{n} s'],
    t_ms: ['{m}:{ss} phút', '{m}:{ss} min'],
    see_qr: ['… quét QR để xem đầy đủ', '… scan the QR for the full list'],
    cancel: ['Huỷ', 'Cancel'],
    autohide: ['Tự ẩn sau {s} giây', 'Auto-hides in {s} s'],
    hide_now: ['Ẩn ngay', 'Hide now'],
    name: ['Họ và tên', 'Name'],
    nationality: ['Quốc tịch', 'Nationality'],
    contact: ['Người liên hệ khẩn cấp', 'Emergency contact'],
    call_contact: ['Gọi người liên hệ', 'Call contact'],
    no_identity: ['Chủ máy chưa thêm thông tin định danh.', 'The owner has not added identity details.'],
    no_profile: ['Máy này chưa có hồ sơ y tế.', 'No medical profile on this phone.'],
    no_profile_hint: ['Hãy gọi 115 và mô tả tình trạng người bệnh.', 'Call 115 and describe the patient’s condition.'],
    key_del: ['Xoá', 'Delete']
  };
  (function registerFixed() {
    var d = {};
    Object.keys(FIXED).forEach(function (k) { d['qr.L.vi.' + k] = FIXED[k][0]; d['qr.L.en.' + k] = FIXED[k][1]; });
    NC.i18n.add({ vi: d, en: d });
  })();
  function fv(k, v) { return t('qr.L.vi.' + k, v); }
  function fe(k, v) { return t('qr.L.en.' + k, v); }

  /* ================================================================== */
  /* QR ENCODING (qrcodejs model, drawn by us as SVG / canvas)            */
  /* ================================================================== */
  var LEVELS = ['H', 'Q', 'M', 'L'];
  var ECL_PCT = { H: 30, Q: 25, M: 15, L: 7 };
  var matrixCache = {};
  var matrixCacheKeys = [];

  /** UTF-8 bytes of a string (TextEncoder, manual fallback incl. surrogate pairs). */
  function utf8Bytes(s) {
    try { if (window.TextEncoder) return Array.prototype.slice.call(new TextEncoder().encode(s)); } catch (e) { /* ignore */ }
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /*
   * Own UTF-8 segment on top of the library's QR model. (The vendored qrcode.min.js UTF-8 encoder bug — one byte
   * array reused across characters — is now fixed in assets/vendor/qrcode; this path is kept because it also
   * handles surrogate pairs and lets us pick the error-correction level per version.) We borrow the library's QR
   * model prototype from a harmless ASCII encode and feed it a UTF-8 byte segment (with the UTF-8 BOM upstream
   * qrcodejs adds, which helps scanners pick UTF-8).
   */
  var modelInfo;
  function qrModelInfo() {
    if (modelInfo !== undefined) return modelInfo;
    modelInfo = null;
    var QR = window.QRCode;
    if (!QR || !QR.prototype || !QR.CorrectLevel) return null;
    try {
      var holder = { _htOption: { correctLevel: QR.CorrectLevel.L }, _el: {}, _oDrawing: { draw: function () {} }, makeImage: function () {} };
      QR.prototype.makeCode.call(holder, 'NC');
      var m = holder._oQRCode;
      if (m && m.dataList && m.dataList[0] && typeof m.make === 'function') {
        modelInfo = { proto: Object.getPrototypeOf(m), mode: m.dataList[0].mode };
      }
    } catch (e) { modelInfo = null; }
    return modelInfo;
  }

  function buildModel(bytes, level) {
    var info = qrModelInfo();
    var QR = window.QRCode;
    if (!info || QR.CorrectLevel[level] === undefined) return null;
    var seg = {
      mode: info.mode,
      getLength: function () { return bytes.length; },
      write: function (buf) { for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8); }
    };
    for (var type = 1; type <= 40; type++) {
      var m = Object.create(info.proto);
      m.typeNumber = type; m.errorCorrectLevel = QR.CorrectLevel[level];
      m.modules = null; m.moduleCount = 0; m.dataCache = null; m.dataList = [seg];
      try { m.make(); return m; }
      catch (e) { if (!/overflow/i.test(String(e && e.message))) return null; }
    }
    return null;
  }

  /**
   * Encode `text` as a QR matrix. Picks the highest error-correction level (H → Q → M → L) whose symbol
   * stays at version ≤ opts.maxVersion (default 20, 97×97 modules) so it remains easy to scan.
   * @param {string} text
   * @param {{maxVersion?:number}} [opts]
   * @returns {{size:number, version:number, level:string, pct:number, chars:number, bytes:number, dark:boolean[][]}|null}
   */
  function matrix(text, opts) {
    var maxV = (opts && opts.maxVersion) || 20;
    var key = maxV + '|' + text;
    if (matrixCache[key]) return matrixCache[key];
    var best = null;
    var bytes = utf8Bytes(text);
    var payload = /[^\x00-\x7F]/.test(text) ? [0xEF, 0xBB, 0xBF].concat(bytes) : bytes;
    for (var i = 0; i < LEVELS.length; i++) {
      var m = buildModel(payload, LEVELS[i]);
      if (!m) continue;
      var n = m.getModuleCount();
      var cand = { model: m, level: LEVELS[i], size: n, version: (n - 17) / 4 };
      if (!best || cand.version < best.version) best = cand;
      if (cand.version <= maxV) { best = cand; break; }
    }
    if (!best) return null;
    var dark = [];
    for (var r = 0; r < best.size; r++) {
      var row = [];
      for (var c = 0; c < best.size; c++) row.push(!!best.model.isDark(r, c));
      dark.push(row);
    }
    var res = { size: best.size, version: best.version, level: best.level, pct: ECL_PCT[best.level], chars: text.length, bytes: payload.length, dark: dark };
    matrixCache[key] = res; matrixCacheKeys.push(key);
    if (matrixCacheKeys.length > 12) delete matrixCache[matrixCacheKeys.shift()];
    return res;
  }

  /**
   * QR as an inline SVG string (dark modules merged into horizontal runs). Colours come from CSS
   * (.qr-code__mod), so place it inside a [data-theme="light"] .qr-code tile for dark-on-white in any theme.
   * @param {string} text
   * @param {{quiet?:number, label?:string}} [opts]
   */
  function svg(text, opts) {
    var o = opts || {};
    var q = matrix(text);
    if (!q) return '';
    var quiet = o.quiet === undefined ? 0 : o.quiet;
    var n = q.size + quiet * 2;
    var d = '';
    for (var r = 0; r < q.size; r++) {
      var c = 0;
      while (c < q.size) {
        if (q.dark[r][c]) {
          var s = c;
          while (c < q.size && q.dark[r][c]) c++;
          d += 'M' + (s + quiet) + ' ' + (r + quiet) + 'h' + (c - s) + 'v1h-' + (c - s) + 'z';
        } else c++;
      }
    }
    return '<svg class="qr-code__svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' +
      esc(o.label || t('qr.qr_aria')) + '" data-version="' + q.version + '" data-level="' + q.level + '">' +
      '<rect class="qr-code__bg" width="' + n + '" height="' + n + '"/><path class="qr-code__mod" d="' + d + '"/></svg>';
  }

  /* ================================================================== */
  /* STATE                                                                */
  /* ================================================================== */
  var S = {
    el: null,
    mounted: false,
    active: false,
    loaded: false,
    view: 'owner',
    profile: null,
    consents: null,
    wallpaperAt: null,
    reveals: [],
    ownerReveal: false,
    ownerTimer: null,
    loadSeq: 0,
    rs: null,
    rsEl: null,          // #qr-rescuer — moved to <body> so the whole app shell can be inert behind it
    rsBack: null,        // NC.ui.onBack release() while the rescuer view owns a history entry
    rsReturn: null,      // 'tile' → focus the rescuer tile again after exit
    rsObserver: null
  };

  function newRescuerState() {
    return { state: 'locked', remaining: REVEAL_SECONDS, timer: null, hold: null, pad: null };
  }

  /* ================================================================== */
  /* REVEAL-CODE LOCK (persisted in kv, shared by rescuer view + owner)   */
  /* ================================================================== */
  var lock = { attempts: 0, lockUntil: 0, lastFail: 0 };

  function readLock(v) {
    var now = Date.now();
    lock.attempts = v && v.attempts > 0 ? Math.min(99, Math.floor(v.attempts)) : 0;
    lock.lockUntil = v && +v.lockUntil > 0 ? +v.lockUntil : 0;
    lock.lastFail = v && +v.lastFail > 0 ? +v.lastFail : 0;
    if (lock.lockUntil <= now && lock.lastFail && now - lock.lastFail > LOCK_DECAY_MS) { lock.attempts = 0; lock.lockUntil = 0; lock.lastFail = 0; }
  }
  function refreshLock() { return kvGet(KV_LOCK).then(readLock); }
  function saveLock() { return kvSet(KV_LOCK, { attempts: lock.attempts, lockUntil: lock.lockUntil, lastFail: lock.lastFail }); }
  function lockLeftMs() {
    var now = Date.now();
    // Device clock moved backwards since the last failure → keep the remaining lock instead of releasing it.
    if (lock.lastFail > now + 60000) {
      var d = Math.max(0, lock.lockUntil - lock.lastFail);
      lock.lastFail = now; lock.lockUntil = d ? now + d : 0; saveLock();
    }
    return Math.max(0, lock.lockUntil - now);
  }
  function lockDuration(n) { return n < MAX_ATTEMPTS ? 0 : Math.min(LOCK_MAX_MS, LOCKOUT_MS * Math.pow(2, n - MAX_ATTEMPTS)); }
  /** Record a wrong code → lockout duration in ms (0 = still free tries). */
  function lockFail() {
    lock.attempts++;
    lock.lastFail = Date.now();
    var d = lockDuration(lock.attempts);
    if (d) lock.lockUntil = lock.lastFail + d;
    saveLock();
    return d;
  }
  function lockReset() { lock.attempts = 0; lock.lockUntil = 0; lock.lastFail = 0; saveLock(); }
  function triesLeft() { return Math.max(0, MAX_ATTEMPTS - lock.attempts); }

  /** "45 giây" / "2:05 phút" in vi, en or the UI language. */
  function durText(which, ms) {
    var s = Math.max(1, Math.ceil(ms / 1000));
    var get = which === 'vi' ? fv : which === 'en' ? fe : function (k, v) { return t('qr.gate.' + k, v); };
    if (s < 60) return get('t_s', { n: s });
    var ss = s % 60;
    return get('t_ms', { m: Math.floor(s / 60), ss: (ss < 10 ? '0' : '') + ss });
  }

  /**
   * 4-digit keypad bound to the persisted lock. bilingual → Vietnamese + English (rescuer view), else UI language.
   * @param {Element} host
   * @param {{bilingual?:boolean, onSuccess:function, onCancel:function}} o
   * @returns {{key:function(KeyboardEvent):boolean, focus:function, destroy:function}}
   */
  function createPad(host, o) {
    var ps = { code: '', msg: '', shake: false, timer: null, dead: false };
    var bil = !!o.bilingual;
    function txt(k, vars, varsEn) {
      if (bil) return esc(fv(k, vars)) + ' · <span lang="en">' + esc(fe(k, varsEn || vars)) + '</span>';
      return esc(t('qr.gate.' + k, vars));
    }
    function lockedMsg(left) {
      return bil ? txt('code_locked', { t: durText('vi', left) }, { t: durText('en', left) }) : txt('code_locked', { t: durText('ui', left) });
    }
    function render() {
      if (ps.dead) return;
      var locked = lockLeftMs() > 0;
      var dots = '';
      for (var d = 0; d < 4; d++) dots += '<span class="qr-kp__dot' + (d < ps.code.length ? ' is-on' : '') + '"></span>';
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'del'].map(function (k) {
        if (k === 'cancel') {
          return '<button class="qr-kp__key qr-kp__key--fn" type="button" data-qr-key="cancel">' +
            (bil ? esc(fv('cancel')) + '<small lang="en">' + esc(fe('cancel')) + '</small>' : esc(t('qr.gate.cancel'))) + '</button>';
        }
        if (k === 'del') {
          return '<button class="qr-kp__key qr-kp__key--fn" type="button" data-qr-key="del"' + (locked ? ' disabled' : '') + ' aria-label="' +
            esc(bil ? fv('key_del') + ' / ' + fe('key_del') : t('qr.gate.key_del')) + '">' + I('arrow-left') + '</button>';
        }
        return '<button class="qr-kp__key" type="button" data-qr-key="' + k + '"' + (locked ? ' disabled' : '') + '>' + k + '</button>';
      }).join('');
      var title = bil ? '<b>' + esc(fv('code_title')) + '</b><span lang="en">' + esc(fe('code_title')) + '</span>' : '<b>' + esc(t('qr.gate.code_title')) + '</b>';
      host.innerHTML = '<div class="qr-kp' + (ps.shake ? ' is-shake' : '') + '">' +
        '<p class="qr-kp__title">' + title + '</p>' +
        '<div class="qr-kp__dots" aria-hidden="true">' + dots + '</div>' +
        '<p class="qr-kp__msg" role="status">' + (ps.msg || '&nbsp;') + '</p>' +
        '<div class="qr-kp__grid">' + keys + '</div></div>';
      ps.shake = false;
    }
    function focusKey(k) {
      var b = $('[data-qr-key="' + k + '"]', host);
      if (!b || b.disabled) b = $('[data-qr-key]:not([disabled])', host);
      if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    }
    function stopTick() { if (ps.timer) { clearInterval(ps.timer); ps.timer = null; } }
    function tick() {
      if (ps.dead) { stopTick(); return; }
      var left = lockLeftMs();
      if (left <= 0) { stopTick(); ps.msg = ''; render(); focusKey('1'); return; }
      ps.msg = lockedMsg(left);
      var m = $('.qr-kp__msg', host);
      if (m) m.innerHTML = ps.msg;
    }
    function startTick() { stopTick(); ps.timer = setInterval(tick, 500); tick(); }
    function press(k) {
      if (ps.dead) return;
      if (k === 'cancel') { destroy(); o.onCancel(); return; }
      if (lockLeftMs() > 0) return;
      if (k === 'del') { ps.code = ps.code.slice(0, -1); render(); focusKey('del'); return; }
      if (!/^\d$/.test(k) || ps.code.length >= 4) return;
      ps.code += k;
      if (ps.code.length < 4) { ps.msg = ''; render(); focusKey(k); return; }
      var ok = ps.code === String(ident().reveal_code || '');
      ps.code = '';
      if (ok) { lockReset(); destroy(); o.onSuccess(); return; }
      ps.shake = true;
      U.vibrate([60, 40, 60]);
      var d = lockFail();
      if (d) { ps.msg = lockedMsg(d); render(); startTick(); focusKey('cancel'); return; }
      ps.msg = txt('code_wrong', { n: triesLeft() });
      render();
      focusKey(k);
    }
    function onPadClick(e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-qr-key]') : null;
      if (!b || !host.contains(b) || b.disabled) return;
      e.preventDefault();
      press(b.getAttribute('data-qr-key'));
    }
    function destroy() {
      if (ps.dead) return;
      ps.dead = true; stopTick();
      host.removeEventListener('click', onPadClick);
    }
    host.addEventListener('click', onPadClick);
    render();
    if (lockLeftMs() > 0) startTick();
    return {
      key: function (e) {
        if (ps.dead || e.ctrlKey || e.metaKey || e.altKey) return false;
        var tg = e.target;
        if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) return false;
        if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); return true; }
        if (e.key === 'Backspace') { e.preventDefault(); press('del'); return true; }
        return false;
      },
      focus: function () { focusKey('1'); },
      destroy: destroy
    };
  }

  function pub() { return (S.profile && S.profile.public) || {}; }
  function ident() { return (S.profile && S.profile.identity) || {}; }
  function hasPublic() {
    var p = pub();
    return !!(p.blood_type || p.allergies || p.conditions || p.medications || p.notes);
  }
  function hasIdentity() {
    var i = ident();
    return !!(i.full_name || i.nationality || i.contact_name || i.contact_phone);
  }
  function qrText() { return S.profile && hasPublic() ? NC.profile.publicText(S.profile) : ''; }
  function kvGet(k) { return NC.store ? NC.store.get(k).catch(function () { return null; }) : Promise.resolve(null); }
  function kvSet(k, v) { return NC.store ? NC.store.set(k, v).catch(function () { return null; }) : Promise.resolve(null); }
  function kvDel(k) { return NC.store ? NC.store.del(k).catch(function () { return null; }) : Promise.resolve(null); }
  /** QR fitting report for the current profile (see NC.profile.publicTextInfo). */
  function qrInfo(p) {
    var prof = p || S.profile;
    if (!prof) return null;
    if (NC.profile.publicTextInfo) return NC.profile.publicTextInfo(prof);
    var tx = NC.profile.publicText(prof);
    return { text: tx, length: tx.length, max: QR_MAX_CHARS, fullLength: tx.length, level: 0, compacted: false, truncated: [], over: 0 };
  }
  var FIELD_ORDER = ['blood_type', 'allergies', 'conditions', 'medications', 'notes'];
  /** Field labels in on-screen order (UI language). */
  function fieldNames(keys) {
    return keys.slice().sort(function (a, b) { return FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b); })
      .map(function (k) { return t('qr.f.' + k); }).join(', ');
  }

  /** Load profile + consents + local QR metadata (all on-device). */
  function load() {
    var seq = ++S.loadSeq;
    return Promise.all([
      NC.profile.get().catch(function () { return null; }),
      NC.profile.consents.get().catch(function () { return null; }),
      kvGet(KV_WALLPAPER),
      kvGet(KV_REVEALS),
      kvGet(KV_LOCK)
    ]).then(function (r) {
      if (seq !== S.loadSeq) return;
      S.profile = r[0];
      S.consents = r[1] || {};
      S.wallpaperAt = r[2] || null;
      S.reveals = Array.isArray(r[3]) ? r[3] : [];
      readLock(r[4]);
      S.loaded = true;
    });
  }

  /* ================================================================== */
  /* FORMAT HELPERS                                                       */
  /* ================================================================== */
  function bloodLabel(bt) {
    if (!bt) return '—';
    return bt === 'unknown' ? t('qr.blood.unknown') : bt.replace('-', '−');
  }
  function bloodShort(bt) {
    if (!bt) return '—';
    return bt === 'unknown' ? '?' : bt.replace('-', '−');
  }
  function rhLabel(bt) {
    if (!bt || bt === 'unknown') return '';
    return bt.indexOf('+') >= 0 ? t('qr.blood.pos') : t('qr.blood.neg');
  }
  function maskWord(w) {
    if (!w) return '';
    var n = Math.min(5, Math.max(2, w.length - 1));
    return w.charAt(0) + new Array(n + 1).join('•');
  }
  function maskText(s) { return String(s || '').split(/\s+/).filter(Boolean).map(maskWord).join(' '); }
  function maskPhone(s) {
    var str = String(s || '');
    var total = (str.match(/\d/g) || []).length;
    var plus = /^\s*\+/.test(str);
    var i = 0;
    return str.replace(/\d/g, function (d) {
      var keep = (plus && i < 2) || i >= total - 2;
      i++;
      return keep ? d : '•';
    });
  }
  /* Vietnamese-only letters (tone marks shared with French/Spanish are left out on purpose). */
  var VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉĩịọỏốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i;
  /** ` lang="vi"` for user/data text written in Vietnamese while the UI is in another language. */
  function viLang(v) { return NC.i18n.lang() !== 'vi' && VI_CHARS.test(String(v || '')) ? ' lang="vi"' : ''; }
  function isNoneValue(v) { return v === NONE_VALUE || /^(không có|none|no|không)$/i.test(String(v || '').trim()); }
  function updatedDate() {
    var at = S.profile && S.profile.updated_at;
    return at ? U.fmtDate(at) : '—';
  }

  /* ================================================================== */
  /* OWNER VIEW                                                           */
  /* ================================================================== */
  function renderOwner() {
    var root = S.el;
    if (!root) return;
    renderHero($('#qr-hero', root));
    renderActions($('#qr-actions', root));
    renderPublic($('#qr-public', root));
    renderIdentity($('#qr-identity', root));
    renderPrivacy($('#qr-privacy-body', root));
    var disc = $('#qr-disclaimer', root);
    if (disc && !disc.firstChild) disc.appendChild(NC.ui.disclaimer({ compact: true }));
  }

  function scanFrame(inner) {
    return '<div class="qr-scan"><span class="qr-scan__c qr-scan__c--tl"></span><span class="qr-scan__c qr-scan__c--tr"></span>' +
      '<span class="qr-scan__c qr-scan__c--bl"></span><span class="qr-scan__c qr-scan__c--br"></span>' + inner + '</div>';
  }

  /*
   * QR card (round-2 declutter: replaces the gradient hero). The QR stays the main content; blood type / field count
   * live in the public-layer card, "0 bytes uploaded" in the privacy fold, and each status is shown once.
   */
  function renderHero(el) {
    if (!el) return;
    var enc = NC.secure && NC.secure.encrypted;
    var text = qrText();
    var badge = '<span class="badge badge--' + (enc ? 'success' : 'warning') + ' qr-hero__enc">' + I(enc ? 'lock' : 'unlock') +
      '<span>' + esc(t(enc ? 'qr.hero.encrypted' : 'qr.hero.not_encrypted')) + '</span></span>';
    function head(key) {
      return '<div class="qr-hero__head"><h2 class="qr-hero__title" id="qr-hero-title">' + esc(t(key)) + '</h2>' + badge + '</div>';
    }
    if (!S.loaded) {
      el.innerHTML = head('qr.card.title') +
        '<div class="qr-hero__qr">' + scanFrame('<div class="qr-code qr-code--skeleton" data-theme="light"><span class="skeleton"></span></div>') + '</div>';
      return;
    }
    if (!text) {
      el.innerHTML = head('qr.hero.empty_title') +
        '<p class="qr-hero__sub">' + esc(t('qr.hero.empty_sub')) + '</p>' +
        '<div class="qr-hero__qr">' + scanFrame('<div class="qr-code qr-code--empty">' + I('qr', 'icon--xl') + '<span>' + esc(t('qr.hero.placeholder')) + '</span></div>') + '</div>' +
        '<button class="btn btn--primary btn--block qr-hero__cta" type="button" data-qr-act="create">' + I('plus') + '<span>' + esc(t('qr.pub.create')) + '</span></button>';
      return;
    }
    el.innerHTML = head('qr.card.title') +
      '<div class="qr-hero__qr">' + scanFrame('<div class="qr-code" data-theme="light">' + svg(text) + '</div>') + '</div>' +
      '<p class="qr-hero__caption">' + esc(t('qr.caption')) + '</p>';
  }

  function wallpaperStatus() {
    if (!S.wallpaperAt) return { cls: 'neutral', text: t('qr.act.wallpaper_none') };
    var upd = S.profile && S.profile.updated_at;
    if (upd && new Date(upd).getTime() > new Date(S.wallpaperAt).getTime() + 1000) return { cls: 'warning', text: t('qr.act.wallpaper_stale') };
    return { cls: 'success', text: t('qr.act.wallpaper_done', { date: U.fmtDate(S.wallpaperAt) }) };
  }

  /** Secondary QR features as compact rows (wallpaper, wallet card, rescuer mode) under the QR. */
  function renderActions(el) {
    if (!el) return;
    var ready = S.loaded && !!qrText();
    var ws = wallpaperStatus();
    function row(act, iconName, tone, title, hint, extra) {
      return '<button class="qr-action" type="button" data-qr-act="' + act + '"' + (ready ? '' : ' disabled') + '>' +
        '<span class="icon-tile icon-tile--sm icon-tile--' + tone + '">' + I(iconName) + '</span>' +
        '<span class="qr-action__text"><span class="qr-action__title">' + esc(title) + '</span>' +
        '<span class="qr-action__hint">' + esc(hint) + (extra || '') + '</span></span>' +
        '<span class="qr-action__go">' + I('chevron-right', 'icon--sm') + '</span></button>';
    }
    el.innerHTML =
      row('wallpaper', 'image', 'primary', t('qr.act.wallpaper'), t('qr.act.wallpaper_hint'),
        ready ? ' <span class="badge badge--' + ws.cls + ' qr-action__status">' + esc(ws.text) + '</span>' : '') +
      row('print', 'printer', 'info', t('qr.act.print'), t('qr.act.print_hint')) +
      row('rescuer', 'siren', 'danger', t('qr.act.rescuer'), t('qr.act.rescuer_hint'));
  }

  function layerHeader(iconName, tone, titleId, title, sub, trail) {
    return '<div class="card__header qr-layer__head"><span class="icon-tile icon-tile--' + tone + '">' + I(iconName) + '</span>' +
      '<div><h3 class="card__title" id="' + titleId + '">' + esc(title) + '</h3><p class="card__subtitle">' + esc(sub) + '</p></div>' +
      (trail || '') + '</div>';
  }

  function renderPublic(el) {
    if (!el) return;
    var consent = S.consents && S.consents.sensitive;
    if (!S.loaded) {
      el.innerHTML = layerHeader('heart-pulse', 'danger', 'qr-public-title', t('qr.pub.title'), t('qr.pub.sub')) +
        '<span class="skeleton skeleton--card"></span>';
      return;
    }
    if (!hasPublic() && !consent) {
      el.classList.add('qr-layer--consent');
      el.innerHTML = layerHeader('lock', 'warning', 'qr-public-title', t('qr.consent.card_title'), t('qr.consent.card_text')) +
        consentBody('inline') +
        '<div class="card__footer card__footer--plain"><button class="btn btn--primary btn--block" type="button" data-qr-act="consent-inline" disabled>' +
        I('check-circle') + '<span>' + esc(t('qr.consent.accept')) + '</span></button></div>';
      return;
    }
    el.classList.remove('qr-layer--consent');
    var editBtn = '<button class="btn btn--soft btn--sm" type="button" data-qr-act="edit-public">' + I('edit') + '<span>' + esc(t('common.edit')) + '</span></button>';
    if (!hasPublic()) {
      el.innerHTML = layerHeader('heart-pulse', 'danger', 'qr-public-title', t('qr.pub.title'), t('qr.pub.sub')) +
        '<div class="qr-layer__empty">' + I('heart-pulse', 'icon--lg') + '<p class="fw-700 m-0">' + esc(t('qr.pub.empty_title')) + '</p>' +
        '<p class="small muted m-0">' + esc(t('qr.pub.empty_text')) + '</p>' +
        '<button class="btn btn--outline" type="button" data-qr-act="edit-public">' + I('plus') + '<span>' + esc(t('qr.pub.create')) + '</span></button></div>';
      return;
    }
    var p = pub();
    var miss = NC.profile.missing(S.profile);
    function field(key, iconName, tone) {
      var v = p[key];
      var isMiss = miss.indexOf(key) >= 0;
      return '<li class="qr-field' + (isMiss ? ' is-missing' : '') + (key === 'allergies' && v && !isNoneValue(v) ? ' qr-field--alert' : '') + '">' +
        '<span class="icon-tile icon-tile--sm icon-tile--' + (isMiss ? 'warning' : tone) + '">' + I(isMiss ? 'alert-circle' : iconName) + '</span>' +
        '<span class="qr-field__body"><span class="qr-field__label">' + esc(t('qr.f.' + key)) + '</span>' +
        '<span class="qr-field__value"' + (v ? viLang(v) : '') + '>' + esc(v || t('qr.f.missing')) + '</span></span>' +
        (isMiss ? '<span class="badge badge--warning">' + esc(t('common.required')) + '</span>' : '') + '</li>';
    }
    var qi = qrInfo();
    var cut = qi && qi.truncated.length ? qi.truncated : [];
    el.innerHTML = layerHeader('heart-pulse', 'danger', 'qr-public-title', t('qr.pub.title'), t('qr.pub.sub'), editBtn) +
      '<div class="qr-blood' + (p.blood_type ? '' : ' is-missing') + '">' +
        '<span class="qr-blood__drop" aria-hidden="true"><span>' + esc(bloodShort(p.blood_type)) + '</span></span>' +
        '<span class="qr-blood__body"><span class="qr-blood__label">' + esc(t('qr.f.blood_type')) + '</span>' +
        '<span class="qr-blood__value">' + esc(p.blood_type ? bloodLabel(p.blood_type) : t('qr.f.missing')) +
        (rhLabel(p.blood_type) ? ' <small>· ' + esc(rhLabel(p.blood_type)) + '</small>' : '') + '</span></span></div>' +
      '<ul class="qr-fields">' +
        field('allergies', 'alert-triangle', 'danger') +
        field('conditions', 'activity', 'warning') +
        field('medications', 'pill', 'info') +
        (p.notes ? field('notes', 'file-text', 'neutral') : '') +
      '</ul>' +
      '<div class="card__footer qr-layer__foot">' +
        (miss.length ? NC.ui.badge(t('qr.pub.incomplete', { n: miss.length }), 'warning', 'alert-circle') : NC.ui.badge(t('qr.pub.complete'), 'success', 'check-circle')) +
        (cut.length ? NC.ui.badge(t('qr.pub.qr_cut', { fields: fieldNames(cut) }), 'warning', 'alert-triangle') : '') +
        '<span class="small muted">' + esc(t('qr.pub.updated', { when: S.profile.updated_at ? U.relTime(S.profile.updated_at) : '—' })) + '</span>' +
      '</div>';
  }

  function renderIdentity(el) {
    if (!el) return;
    if (!S.loaded) {
      el.innerHTML = layerHeader('lock', 'accent', 'qr-identity-title', t('qr.id.title'), t('qr.id.sub')) + '<span class="skeleton skeleton--card"></span>';
      return;
    }
    var i = ident();
    var show = S.ownerReveal;
    var trail = '';
    if (hasIdentity()) {
      trail = '<div class="qr-layer__btns">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-qr-act="toggle-identity" aria-pressed="' + (show ? 'true' : 'false') + '" aria-label="' +
          esc(t(show ? 'qr.id.hide_aria' : 'qr.id.show_aria')) + '">' + I(show ? 'eye-off' : 'eye') + '<span>' + esc(t(show ? 'qr.id.hide' : 'qr.id.show')) + '</span></button>' +
        '<button class="btn btn--soft btn--sm" type="button" data-qr-act="edit-identity">' + I('edit') + '<span>' + esc(t('common.edit')) + '</span></button></div>';
    }
    var body;
    if (!hasIdentity()) {
      body = '<div class="qr-layer__empty qr-layer__empty--soft">' + I('user', 'icon--lg') +
        '<p class="small muted m-0">' + esc(t('qr.id.empty')) + '</p>' +
        '<button class="btn btn--outline" type="button" data-qr-act="edit-identity">' + I('plus') + '<span>' + esc(t('qr.id.add')) + '</span></button></div>';
    } else {
      var row = function (key, value, masked) {
        var v = value ? (show ? '<span' + viLang(value) + '>' + esc(value) + '</span>' : '<span class="qr-mask">' + esc(masked) + '</span>') :
          '<span class="muted">' + esc(t('qr.f.empty')) + '</span>';
        return '<div class="kv__row"><dt>' + esc(t('qr.f.' + key)) + '</dt><dd>' + v + '</dd></div>';
      };
      body = '<dl class="kv qr-id-kv">' +
        row('full_name', i.full_name, maskText(i.full_name)) +
        row('nationality', i.nationality, maskText(i.nationality)) +
        row('contact_name', i.contact_name, maskText(i.contact_name)) +
        row('contact_phone', i.contact_phone, maskPhone(i.contact_phone)) +
        '<div class="kv__row"><dt>' + esc(t('qr.f.reveal_code')) + '</dt><dd>' +
          (i.reveal_code ? NC.ui.badge(t('qr.id.code_set'), 'accent', 'key') : '<span class="muted">' + esc(t('qr.id.code_none')) + '</span>') +
        '</dd></div></dl>';
    }
    var last = S.reveals.length ? S.reveals[S.reveals.length - 1] : null;
    el.innerHTML = layerHeader('lock', 'accent', 'qr-identity-title', t('qr.id.title'), t('qr.id.sub'), trail) + body +
      '<div class="card__footer qr-layer__foot qr-layer__foot--stack">' +
        (show && hasIdentity() ? '<span class="qr-note qr-note--live">' + I('eye', 'icon--xs') + '<span>' + esc(t('qr.id.autohide')) + '</span></span>' : '') +
        (hasIdentity() ? '<span class="qr-note">' + I('history', 'icon--xs') + '<span>' +
          esc(last ? t('qr.id.last_reveal', { when: U.fmtDateTime(last.at) }) : t('qr.id.never_revealed')) + '</span></span>' : '') +
      '</div>';
  }

  function renderPrivacy(el) {
    if (!el) return;
    var enc = !!(NC.secure && NC.secure.encrypted);
    var text = qrText();
    var q = text ? matrix(text) : null;
    var qi = text ? qrInfo() : null;
    function item(iconName, tone, title, hint, trail) {
      return '<li class="list-item"><span class="list-item__icon icon-tile icon-tile--sm icon-tile--' + tone + '">' + I(iconName) + '</span>' +
        '<span class="list-item__body"><span class="list-item__title">' + esc(title) + '</span><span class="list-item__meta">' + esc(hint) + '</span></span>' +
        (trail ? '<span class="list-item__trail">' + trail + '</span>' : '') + '</li>';
    }
    el.innerHTML = '<ul class="list qr-pv-list">' +
      item('lock', enc ? 'success' : 'warning', t('qr.pv.enc'), t(enc ? 'qr.pv.enc_on' : 'qr.pv.enc_off')) +
      item('cloud-off', 'primary', t('qr.pv.never'), t('qr.pv.never_hint'),
        '<span class="qr-pv__bytes" title="' + esc(t('qr.stat.uploaded')) + '">' + esc(t('qr.pv.bytes', { n: 0 })) + '</span>') +
      '<li class="list-item"><span class="list-item__icon icon-tile icon-tile--sm icon-tile--danger">' + I('trash') + '</span>' +
        '<span class="list-item__body"><span class="list-item__title">' + esc(t('qr.pv.wipe')) + '</span>' +
        '<a class="list-item__meta qr-link" href="#/settings">' + esc(t('qr.pv.wipe_hint')) + '</a></span></li>' +
      '</ul>' +
      (q ? '<details class="disclosure qr-payload"><summary class="disclosure__sum">' + I('qr') +
        '<span class="disclosure__txt"><span class="disclosure__title">' + esc(t('qr.pv.payload')) + '</span></span>' +
        '<span class="disclosure__chev">' + I('chevron-down') + '</span></summary><div class="disclosure__body">' +
        '<pre class="qr-payload__text" lang="vi">' + esc(text) + '</pre>' +
        '<p class="qr-payload__meta">' + esc(t('qr.pv.payload_meta', { chars: q.chars, max: QR_MAX_CHARS, bytes: q.bytes, ver: q.version, ecl: q.level + ' (' + q.pct + '%)' })) +
          (qi && qi.truncated.length ? '<br><b class="qr-payload__cut">' + esc(t('qr.pub.qr_cut', { fields: fieldNames(qi.truncated) })) + '</b>' : '') + '</p>' +
        '<button class="btn btn--outline btn--sm" type="button" data-qr-act="copy-payload">' + I('copy') + '<span>' + esc(t('qr.pv.copy')) + '</span></button>' +
        '</div></details>' : '');
  }

  /* ================================================================== */
  /* CONSENT                                                              */
  /* ================================================================== */
  function consentBody(mode) {
    var id = 'qr-consent-check-' + mode;
    return '<div class="qr-consent">' +
      '<p class="qr-consent__lead">' + esc(t('qr.consent.lead')) + '</p>' +
      '<ul class="qr-consent__points">' +
        '<li>' + I('lock', 'icon--sm') + '<span>' + esc(t('qr.consent.p1')) + '</span></li>' +
        '<li>' + I('cloud-off', 'icon--sm') + '<span>' + esc(t('qr.consent.p2')) + '</span></li>' +
        '<li>' + I('trash', 'icon--sm') + '<span>' + esc(t('qr.consent.p3')) + '</span></li>' +
      '</ul>' +
      '<label class="check qr-consent__check"><input type="checkbox" id="' + id + '" data-qr-consent-check><span>' + esc(t('qr.consent.check')) + '</span></label>' +
      '</div>';
  }

  /** Resolve true when sensitive-data consent exists (asks with a sheet otherwise). */
  function ensureConsent() {
    if (S.consents && S.consents.sensitive) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var accepted = false;
      var body = h('div', { html: consentBody('sheet') });
      var ctrl = NC.ui.sheet({
        title: t('qr.consent.title'), icon: 'shield-check', iconVariant: 'warning', size: 'md', body: body,
        className: 'qr-sheet',
        actions: [
          { label: t('qr.consent.later'), variant: 'ghost' },
          {
            label: t('qr.consent.accept'), variant: 'primary', icon: 'check-circle', id: 'qr-consent-accept', disabled: true,
            onClick: function () {
              return acceptConsent().then(function () { accepted = true; });
            }
          }
        ],
        onClose: function () { resolve(accepted); }
      });
      var box = $('[data-qr-consent-check]', ctrl.body);
      if (box) box.addEventListener('change', function () {
        var b = document.getElementById('qr-consent-accept');
        if (b) b.disabled = !box.checked;
      });
    });
  }
  function acceptConsent() {
    return NC.profile.consents.set({ sensitive: true }).then(function (c) {
      S.consents = c;
      return c;
    });
  }

  /* ================================================================== */
  /* EDITORS                                                              */
  /* ================================================================== */
  function draftProfile() {
    var base = S.profile ? JSON.parse(JSON.stringify(S.profile)) : { public: {}, identity: {} };
    base.public = base.public || {};
    base.identity = base.identity || {};
    return base;
  }

  function fieldHtml(key, opts) {
    var o = opts || {};
    var id = 'qr-ed-' + key;
    var inputAttrs = ' id="' + id + '" name="' + key + '" maxlength="' + (o.max || 200) + '" placeholder="' + esc(t('qr.ph.' + key)) + '"' +
      (o.type ? ' type="' + o.type + '"' : ' type="text"') + (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') +
      (o.autocomplete ? ' autocomplete="' + o.autocomplete + '"' : ' autocomplete="off"') + ' value="' + esc(o.value || '') + '"';
    var control = o.textarea
      ? '<textarea class="textarea" id="' + id + '" name="' + key + '" maxlength="' + (o.max || 300) + '" rows="2" placeholder="' + esc(t('qr.ph.' + key)) + '">' + esc(o.value || '') + '</textarea>'
      : '<input class="input"' + inputAttrs + '>';
    return '<div class="field qr-ed-field" data-field="' + key + '">' +
      '<div class="qr-ed-field__row"><label class="field__label" for="' + id + '">' + esc(t('qr.f.' + key)) +
        (o.required ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="qr-optional">· ' + esc(t('common.optional')) + '</span>') + '</label>' +
        (o.none ? '<button class="chip chip--soft qr-none-chip" type="button" data-qr-none="' + key + '" aria-pressed="' + (isNoneValue(o.value) ? 'true' : 'false') + '">' +
          I('x-circle') + esc(t('qr.edit.none')) + '</button>' : '') + '</div>' +
      control +
      (o.hint ? '<span class="field__hint">' + esc(o.hint) + '</span>' : '') +
      '<span class="field__error" hidden></span></div>';
  }

  function setFieldError(form, key, msg) {
    var f = $('[data-field="' + key + '"]', form);
    if (!f) return;
    f.classList.toggle('is-invalid', !!msg);
    var e = $('.field__error', f);
    if (e) { e.hidden = !msg; e.textContent = msg || ''; }
  }

  function openPublicEditor() {
    return ensureConsent().then(function (ok) {
      if (!ok) { NC.ui.toast(t('qr.consent.need'), { type: 'warning' }); return; }
      var draft = draftProfile();
      var p = draft.public;
      var form = h('form', { class: 'qr-ed', novalidate: true });
      var chips = NC.profile.BLOOD_TYPES.map(function (bt) {
        var on = p.blood_type === bt;
        return '<button class="chip chip--lg qr-bt' + (bt === 'unknown' ? ' qr-bt--unknown' : '') + (on ? ' is-selected' : '') + '" type="button" role="radio" aria-checked="' +
          (on ? 'true' : 'false') + '" data-bt="' + esc(bt) + '">' + esc(bloodLabel(bt)) + '</button>';
      }).join('');
      form.innerHTML =
        '<div class="field qr-ed-field" data-field="blood_type"><span class="field__label" id="qr-ed-bt-label">' + esc(t('qr.f.blood_type')) + ' <span class="req" aria-hidden="true">*</span></span>' +
          '<div class="chip-group qr-bt-group" role="radiogroup" aria-labelledby="qr-ed-bt-label">' + chips + '</div>' +
          '<span class="field__error" hidden></span></div>' +
        fieldHtml('allergies', { required: true, none: true, value: p.allergies }) +
        fieldHtml('conditions', { required: true, none: true, value: p.conditions }) +
        fieldHtml('medications', { required: true, none: true, value: p.medications }) +
        fieldHtml('notes', { textarea: true, max: 300, value: p.notes }) +
        '<div class="qr-meter" data-qr-meter><div class="qr-meter__row"><span class="qr-meter__label">' + I('qr', 'icon--xs') + '<span data-qr-meter-text></span></span></div>' +
          '<div class="progress progress--sm"><div class="progress__bar" data-qr-meter-bar></div></div>' +
          '<span class="visually-hidden" role="status" data-qr-meter-status></span></div>';
      var lastInfo = null, lastState = '';

      function collect() {
        var sel = $('.qr-bt.is-selected', form);
        p.blood_type = sel ? sel.getAttribute('data-bt') : '';
        ['allergies', 'conditions', 'medications', 'notes'].forEach(function (k) {
          var inp = form.elements[k];
          p[k] = inp ? inp.value.replace(/\s+/g, ' ').trim() : '';
        });
        return draft;
      }
      /* Live QR meter: never silently truncated — warns (and names the fields) before saving. */
      function meter() {
        collect();
        var info = qrInfo(draft);
        lastInfo = info;
        var n = info.length, cut = info.truncated;
        var box = $('[data-qr-meter]', form), txt = $('[data-qr-meter-text]', form), bar = $('[data-qr-meter-bar]', form);
        var msg = cut.length ? t('qr.edit.meter_cut', { fields: fieldNames(cut), over: info.over }) :
          info.compacted ? t('qr.edit.meter_compact', { n: n, max: QR_MAX_CHARS }) : t('qr.edit.meter', { n: n, max: QR_MAX_CHARS });
        if (txt && txt.textContent !== msg) txt.textContent = msg;
        // Screen readers hear state changes (fits / shortened labels / cut fields), not every keystroke.
        var stateKey = cut.length ? 'cut:' + cut.join(',') : info.compacted ? 'compact' : 'ok';
        var live = $('[data-qr-meter-status]', form);
        if (live && stateKey !== lastState) { live.textContent = lastState || stateKey !== 'ok' ? msg : ''; }
        lastState = stateKey;
        if (box) {
          box.classList.toggle('qr-meter--over', cut.length > 0);
          box.classList.toggle('qr-meter--compact', !cut.length && info.compacted);
        }
        if (bar) bar.style.width = (cut.length ? 100 : Math.min(100, Math.round(n / QR_MAX_CHARS * 100))) + '%';
        ['allergies', 'conditions', 'medications', 'notes'].forEach(function (k) {
          var f = $('[data-field="' + k + '"]', form);
          if (!f) return;
          var on = cut.indexOf(k) >= 0;
          f.classList.toggle('is-qr-cut', on);
          var hint = $('.qr-cut-hint', f);
          if (on && !hint) {
            hint = h('span', { class: 'field__hint qr-cut-hint' });
            hint.innerHTML = I('alert-triangle', 'icon--xs') + '<span>' + esc(t('qr.edit.field_cut')) + '</span>';
            var err = $('.field__error', f);
            f.insertBefore(hint, err || null);
          } else if (!on && hint) hint.parentNode.removeChild(hint);
        });
        $$('[data-qr-none]', form).forEach(function (b) {
          var inp = form.elements[b.getAttribute('data-qr-none')];
          b.setAttribute('aria-pressed', inp && isNoneValue(inp.value) ? 'true' : 'false');
        });
      }
      form.addEventListener('click', function (e) {
        var bt = e.target.closest('.qr-bt');
        if (bt) {
          $$('.qr-bt', form).forEach(function (b) { var on = b === bt; b.classList.toggle('is-selected', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
          setFieldError(form, 'blood_type', '');
          meter();
          return;
        }
        var none = e.target.closest('[data-qr-none]');
        if (none) {
          var k = none.getAttribute('data-qr-none');
          var inp = form.elements[k];
          if (inp) { inp.value = isNoneValue(inp.value) ? '' : NONE_VALUE; setFieldError(form, k, ''); if (!inp.value) inp.focus(); }
          meter();
        }
      });
      form.addEventListener('keydown', function (e) {
        var bt = e.target.closest && e.target.closest('.qr-bt');
        if (!bt || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
        var all = $$('.qr-bt', form);
        var i = all.indexOf(bt) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
        var n = all[(i + all.length) % all.length];
        e.preventDefault(); n.focus(); n.click();
      });
      form.addEventListener('input', function (e) {
        if (e.target && e.target.name) setFieldError(form, e.target.name, '');
        meter();
      });
      form.addEventListener('submit', function (e) { e.preventDefault(); var b = document.getElementById('qr-ed-save'); if (b) b.click(); });
      meter();

      NC.ui.sheet({
        title: t('qr.edit.pub_title'), subtitle: t('qr.edit.pub_sub'), icon: 'heart-pulse', iconVariant: 'danger', size: 'md',
        body: form, className: 'qr-sheet',
        actions: [
          { label: t('common.cancel'), variant: 'ghost' },
          {
            label: t('common.save'), variant: 'primary', icon: 'check', id: 'qr-ed-save',
            onClick: function () {
              collect();
              var bad = false;
              if (!p.blood_type) { setFieldError(form, 'blood_type', t('qr.edit.blood_err')); bad = true; }
              ['allergies', 'conditions', 'medications'].forEach(function (k) {
                if (!p[k]) { setFieldError(form, k, t('qr.edit.required_err')); bad = true; }
              });
              if (bad) {
                var first = $('.is-invalid input, .is-invalid .qr-bt', form);
                if (first) first.focus();
                return false;
              }
              var info = qrInfo(draft) || lastInfo;
              var cut = info ? info.truncated : [];
              var cutRequired = cut.filter(function (k) { return k !== 'notes'; });
              var doSave = function () {
                return saveProfile(draft, t('qr.edit.saved') + (cut.length ? ' ' + t('qr.edit.saved_cut', { fields: fieldNames(cut) }) : ''), false, cut.length ? 'warning' : null);
              };
              if (!cutRequired.length) return doSave();
              // A required field would be cut in the QR → explicit choice before saving.
              return NC.ui.confirm({
                title: t('qr.edit.cut_title'), icon: 'alert-triangle',
                message: t('qr.edit.cut_msg', { fields: fieldNames(cut), max: QR_MAX_CHARS }),
                confirmLabel: t('qr.edit.cut_save'), cancelLabel: t('qr.edit.cut_fix'), danger: true
              }).then(function (yes) {
                if (!yes) {
                  var f = $('.is-qr-cut input, .is-qr-cut textarea', form);
                  if (f) setTimeout(function () { try { f.focus(); } catch (e) { /* ignore */ } }, 60);
                  return false;
                }
                return doSave();
              });
            }
          }
        ]
      });
    });
  }

  function openIdentityEditor() {
    return ensureConsent().then(function (ok) {
      if (!ok) { NC.ui.toast(t('qr.consent.need'), { type: 'warning' }); return; }
      var draft = draftProfile();
      var i = draft.identity;
      var hadCode = !!i.reveal_code;
      var form = h('form', { class: 'qr-ed', novalidate: true });
      // The reveal code is never rendered — not even here: empty field = keep the current code.
      form.innerHTML =
        fieldHtml('full_name', { max: 80, value: i.full_name, autocomplete: 'name' }) +
        fieldHtml('nationality', { max: 60, value: i.nationality, autocomplete: 'country-name' }) +
        '<div class="qr-ed-grid">' +
          fieldHtml('contact_name', { max: 80, value: i.contact_name }) +
          fieldHtml('contact_phone', { max: 32, value: i.contact_phone, type: 'tel', inputmode: 'tel', autocomplete: 'tel' }) +
        '</div>' +
        fieldHtml('reveal_code', { max: 4, value: '', inputmode: 'numeric', hint: t(hadCode ? 'qr.edit.code_hint_set' : 'qr.edit.code_hint') }) +
        (hadCode ? '<label class="check qr-code-remove"><input type="checkbox" name="reveal_code_remove"><span>' + esc(t('qr.edit.code_remove')) + '</span></label>' : '') +
        '<p class="qr-note qr-note--box">' + I('shield-check', 'icon--sm') + '<span>' + esc(t('qr.id.no_id_number')) + '</span></p>';
      var codeInput = form.elements.reveal_code;
      if (codeInput) {
        codeInput.setAttribute('pattern', '[0-9]{4}');
        codeInput.classList.add('qr-code-input');
        codeInput.addEventListener('input', function () {
          codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
          var rm = form.elements.reveal_code_remove;
          if (rm && codeInput.value) rm.checked = false;
        });
      }
      form.addEventListener('input', function (e) { if (e.target && e.target.name) setFieldError(form, e.target.name, ''); });
      form.addEventListener('submit', function (e) { e.preventDefault(); var b = document.getElementById('qr-id-save'); if (b) b.click(); });

      NC.ui.sheet({
        title: t('qr.edit.id_title'), subtitle: t('qr.edit.id_sub'), icon: 'lock', iconVariant: 'accent', size: 'md',
        body: form, className: 'qr-sheet',
        actions: [
          { label: t('common.cancel'), variant: 'ghost' },
          {
            label: t('common.save'), variant: 'primary', icon: 'check', id: 'qr-id-save',
            onClick: function () {
              ['full_name', 'nationality', 'contact_name', 'contact_phone'].forEach(function (k) {
                i[k] = form.elements[k] ? form.elements[k].value.replace(/\s+/g, ' ').trim() : '';
              });
              var code = form.elements.reveal_code ? form.elements.reveal_code.value.replace(/\s+/g, '') : '';
              var removeCode = !!(form.elements.reveal_code_remove && form.elements.reveal_code_remove.checked);
              var bad = false;
              if (code && !/^\d{4}$/.test(code)) { setFieldError(form, 'reveal_code', t('qr.edit.code_err')); bad = true; }
              if (i.contact_phone && ((i.contact_phone.match(/\d/g) || []).length < 6 || /[^\d+\s().-]/.test(i.contact_phone))) {
                setFieldError(form, 'contact_phone', t('qr.edit.phone_err')); bad = true;
              }
              if (bad) return false;
              if (code) i.reveal_code = code;
              else if (removeCode || !hadCode) i.reveal_code = null;
              return saveProfile(draft, t('qr.edit.saved_id'), true);
            }
          }
        ]
      });
    });
  }

  function saveProfile(draft, msg, identityOnly, tone) {
    return NC.profile.save(draft).then(function (saved) {
      S.profile = saved;
      render();
      var stale = !identityOnly && S.wallpaperAt;
      NC.ui.toast(stale ? msg + ' ' + t('qr.edit.regen_hint') : msg, {
        type: tone || 'success', timeout: stale || tone ? 6000 : 2600,
        action: stale ? { label: t('qr.edit.regen'), onClick: function () { openWallpaper(); } } : null
      });
      return saved;
    });
  }

  /* ================================================================== */
  /* IDENTITY GATE (owner view) — same hold + code as the rescuer view    */
  /* ================================================================== */
  /**
   * Ask for the 1.5 s hold (+ the 4-digit code when one is set) before identity is shown or edited in the
   * owner view, so someone holding the unlocked phone cannot bypass the rescuer-view protection.
   * @param {'show'|'edit'|'export'} reason
   * @returns {Promise<boolean>}
   */
  function gateIdentity(reason) {
    return new Promise(function (resolve) {
      var ok = false, pad = null, hold = null;
      var hasCode = !!ident().reveal_code;
      var body = h('div', { class: 'qr-gate' });
      body.innerHTML =
        '<button class="btn btn--outline btn--lg btn--block btn--wrap qr-rs-id__hold qr-gate__hold" type="button" data-qr-gate="hold">' + I('fingerprint') +
          '<span class="qr-rs-id__hold-text"><b>' + esc(t('qr.gate.hold')) + '</b><span class="hold__hint">' +
          esc(t(hasCode ? 'qr.gate.hold_code' : 'qr.gate.hold_only')) + '</span></span></button>' +
        '<div class="qr-gate__pad" hidden></div>' +
        (hasCode ? '<button class="btn btn--ghost btn--sm btn--wrap qr-gate__forgot" type="button" data-qr-gate="forgot">' + I('trash') +
          '<span>' + esc(t('qr.gate.forgot')) + '</span></button>' : '');
      var ctrl = NC.ui.sheet({
        title: t(reason === 'edit' ? 'qr.gate.title_edit' : reason === 'export' ? 'qr.gate.title_export' : 'qr.gate.title_show'), subtitle: t('qr.gate.sub'),
        icon: 'lock', iconVariant: 'accent', size: 'sm', body: body, className: 'qr-sheet qr-gate-sheet',
        actions: [{ label: t('common.cancel'), variant: 'ghost' }],
        onClose: function () {
          if (hold) { try { hold.destroy(); } catch (e) { /* ignore */ } }
          if (pad) pad.destroy();
          resolve(ok);
        }
      });
      var holdBtn = $('[data-qr-gate="hold"]', body);
      hold = NC.ui.holdToConfirm(holdBtn, HOLD_MS, function () {
        if (!hasCode) { ok = true; ctrl.close(); return; }
        refreshLock().then(function () {
          var host = $('.qr-gate__pad', body);
          if (!host) return;
          holdBtn.hidden = true;
          host.hidden = false;
          pad = createPad(host, {
            onSuccess: function () { ok = true; ctrl.close(); },
            onCancel: function () { ctrl.close(); }
          });
          pad.focus();
        });
      });
      ctrl.panel.addEventListener('keydown', function (e) { if (pad) pad.key(e); });
      var forgot = $('[data-qr-gate="forgot"]', body);
      if (forgot) forgot.addEventListener('click', function () {
        NC.ui.confirm({ title: t('qr.gate.forgot_title'), message: t('qr.gate.forgot_msg'), confirmLabel: t('qr.gate.forgot_ok'), danger: true }).then(function (yes) {
          if (!yes) return;
          ctrl.close();
          forgetIdentity();
        });
      });
    });
  }

  /**
   * Public entry (NOTES §6) for other screens (Settings → "Xem dữ liệu" / JSON export): reloads the stored profile and
   * the persisted lock first, so the code check and the shared lockout are current even if MOD.03 was never opened.
   * @param {{reason?:'show'|'edit'|'export'}|string} [opts]
   * @returns {Promise<boolean>} true once the hold (+ the 4-digit code when set) succeeded; false on cancel / lockout
   */
  function gateIdentityPublic(opts) {
    var reason = typeof opts === 'string' ? opts : (opts && opts.reason) || 'show';
    if (!NC.profile || !NC.ui || typeof NC.ui.sheet !== 'function') return Promise.resolve(false);
    return load().then(function () { return gateIdentity(reason); }, function () { return false; });
  }

  /** "Forgot the code": delete the identity layer (reveals nothing, keeps the public medical layer). */
  function forgetIdentity() {
    var draft = draftProfile();
    draft.identity = { full_name: '', nationality: '', contact_name: '', contact_phone: '', reveal_code: null };
    lockReset();
    hideOwnerIdentity(true);
    return saveProfile(draft, t('qr.gate.forgot_done'), true);
  }

  function showOwnerIdentity() {
    S.ownerReveal = true;
    if (S.ownerTimer) clearTimeout(S.ownerTimer);
    S.ownerTimer = setTimeout(function () { hideOwnerIdentity(); }, REVEAL_SECONDS * 1000);
    renderIdentity($('#qr-identity', S.el));
    focusAct('toggle-identity');
  }
  function hideOwnerIdentity(silent) {
    if (S.ownerTimer) { clearTimeout(S.ownerTimer); S.ownerTimer = null; }
    if (!S.ownerReveal) return;
    S.ownerReveal = false;
    if (!silent && S.active && S.view === 'owner') {
      var hadFocus = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-qr-act') === 'toggle-identity';
      renderIdentity($('#qr-identity', S.el));
      if (hadFocus) focusAct('toggle-identity');
    }
  }

  /* ================================================================== */
  /* CANVAS HELPERS (wallpaper)                                           */
  /* ================================================================== */
  /** Read design tokens for a theme from a probe element (tokens switch per [data-theme] wrapper). */
  function tokens(theme) {
    var el = document.createElement('div');
    el.setAttribute('data-theme', theme);
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden';
    document.body.appendChild(el);
    var cs = window.getComputedStyle(el);
    function v(n, fb) { var s = cs.getPropertyValue(n); s = s ? s.trim() : ''; return s || fb; }
    function colors(n) { return (v(n, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []); }
    var tk = {
      surface: v('--c-surface', 'white'), surface2: v('--c-surface-2', 'white'), border: v('--c-border', 'silver'),
      text: v('--c-text', 'black'), text2: v('--c-text-2', 'black'), muted: v('--c-muted', 'gray'),
      primary: v('--c-primary', 'teal'), primaryStrong: v('--c-primary-strong', 'teal'), primarySoft: v('--c-primary-soft', 'white'),
      accent: v('--c-accent', 'orange'), danger: v('--c-danger', 'red'), dangerStrong: v('--c-danger-strong', 'red'),
      dangerSoft: v('--c-danger-soft', 'white'), onDanger: v('--c-on-danger', 'white'), onHero: v('--c-on-hero', 'white'),
      hero: colors('--grad-hero'), gDanger: colors('--grad-danger'), gPrimary: colors('--grad-primary'),
      shadow: colors('--sh-3')[0] || 'rgba(0,0,0,.3)',
      font: v('--font-sans', 'sans-serif')
    };
    document.body.removeChild(el);
    return tk;
  }

  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var sample = 'AaĐđỆệ€ 115';
    var loads = [500, 600, 700, 800].map(function (w) { return document.fonts.load(w + ' 40px "Be Vietnam Pro"', sample).catch(function () {}); });
    return Promise.race([Promise.all(loads), U.sleep(2500)]);
  }

  function rrect(ctx, x, y, w, hh, r) {
    var rr = typeof r === 'number' ? [r, r, r, r] : r;
    ctx.beginPath();
    ctx.moveTo(x + rr[0], y);
    ctx.lineTo(x + w - rr[1], y); ctx.arcTo(x + w, y, x + w, y + rr[1], rr[1]);
    ctx.lineTo(x + w, y + hh - rr[2]); ctx.arcTo(x + w, y + hh, x + w - rr[2], y + hh, rr[2]);
    ctx.lineTo(x + rr[3], y + hh); ctx.arcTo(x, y + hh, x, y + hh - rr[3], rr[3]);
    ctx.lineTo(x, y + rr[0]); ctx.arcTo(x, y, x + rr[0], y, rr[0]);
    ctx.closePath();
  }

  /** Word-wrap `text` into ≤ maxLines lines of width ≤ maxW (last line ellipsised). */
  function wrapLines(ctx, text, maxW, maxLines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [], cur = '', truncated = false;
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (!cur || ctx.measureText(test).width <= maxW) { cur = test; continue; }
      lines.push(cur); cur = words[i];
      if (lines.length === maxLines) { truncated = true; cur = ''; break; }
    }
    if (cur) lines.push(cur);
    for (var j = 0; j < lines.length; j++) {
      var s = lines[j];
      var ell = truncated && j === lines.length - 1;
      if (ell || ctx.measureText(s).width > maxW) {
        while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
        lines[j] = s.replace(/[\s,;·/–-]+$/, '') + '…';
      }
    }
    return lines;
  }

  /** Largest font size (step 1px, ≥ min) at which `text` fits in maxW on one line; sets ctx.font. */
  function fitFont(ctx, text, maxW, weight, size, min, family) {
    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    while (s > min && ctx.measureText(text).width > maxW) { s--; ctx.font = weight + ' ' + s + 'px ' + family; }
    return s;
  }

  /** Word-wrap without any line cap or ellipsis (over-long words are broken by characters). */
  function wrapAll(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { cur = test; return; }
      if (cur) { lines.push(cur); cur = ''; }
      while (w.length > 1 && ctx.measureText(w).width > maxW) {
        var k = w.length - 1;
        while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      cur = w;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /*
   * Wallpaper info column auto-fit. Tries [text scale, card top, QR size] from largest to smallest until allergies
   * (≤ 4 lines), conditions and medications (≤ 3 lines each) fit without any ellipsis. The card may move up to
   * y = 880 (the lock-screen clock + widgets end well above) and the QR may shrink to 440 px (still ≈ 24 mm).
   * Only when nothing fits are lines capped, with a "scan the QR for the full list" hint.
   */
  var WP_COMBOS = [[1, 960, 480], [1, 920, 480], [1, 880, 480], [0.92, 880, 480], [0.85, 880, 480], [0.85, 880, 460],
    [0.78, 880, 460], [0.78, 880, 440], [0.72, 880, 440], [0.66, 880, 440]];
  function wpMetrics(s) {
    var a = Math.round(54 * s), b = Math.max(26, Math.round(36 * s)), g = Math.max(s, 0.8);
    return {
      aSize: a, aFirst: Math.round(a * 1.22), aLH: Math.round(a * 1.19), aGap: Math.round(62 * g),
      tSize: b, tFirst: Math.round(b * 1.28), tLH: Math.round(b * 1.27), tGap: Math.round(58 * g)
    };
  }
  function wpInfoHeight(m, na, nc, nm, hint) {
    return Math.max(336, 30 + m.aFirst + (na - 1) * m.aLH + m.aGap + m.tFirst + (nc - 1) * m.tLH + m.tGap +
      m.tFirst + (nm - 1) * m.tLH + 14 + (hint ? 58 : 0));
  }
  function wpFit(ctx, F, colW, A, C, M, bottomMax, headH) {
    var room = function (cy, qr) { return bottomMax - cy - (headH + 40 + 28 + 58 + qr + 88 + 80 + 46); };
    var aFont = function (m) { return '800 ' + m.aSize + 'px ' + F; };
    var tFont = function (m) { return '600 ' + m.tSize + 'px ' + F; };
    for (var i = 0; i < WP_COMBOS.length; i++) {
      var c = WP_COMBOS[i], m = wpMetrics(c[0]);
      ctx.font = aFont(m); var al = wrapAll(ctx, A, colW);
      ctx.font = tFont(m); var cl = wrapAll(ctx, C, colW), ml = wrapAll(ctx, M, colW);
      if (al.length > 4 || cl.length > 3 || ml.length > 3) continue;
      var hgt = wpInfoHeight(m, al.length, cl.length, ml.length, false);
      if (hgt <= room(c[1], c[2])) return { m: m, cy: c[1], qr: c[2], a: al, c: cl, md: ml, h: hgt, cut: false };
    }
    var last = WP_COMBOS[WP_COMBOS.length - 1], mm = wpMetrics(last[0]), r = room(last[1], last[2]);
    var n = { a: 4, c: 2, m: 3 };
    var wrapN = function () {
      ctx.font = aFont(mm); var fa = wrapLines(ctx, A, colW, n.a);
      ctx.font = tFont(mm); return { a: fa, c: wrapLines(ctx, C, colW, n.c), m: wrapLines(ctx, M, colW, n.m) };
    };
    var w = wrapN();
    // Give room back in this order: conditions, then medications, never allergies below 3 lines.
    while (wpInfoHeight(mm, w.a.length, w.c.length, w.m.length, true) > r && (n.c > 1 || n.m > 2 || n.a > 3)) {
      if (n.c > 1) n.c--; else if (n.m > 2) n.m--; else n.a--;
      w = wrapN();
    }
    return { m: mm, cy: last[1], qr: last[2], a: w.a, c: w.c, md: w.m, h: wpInfoHeight(mm, w.a.length, w.c.length, w.m.length, true), cut: true };
  }

  function setSpacing(ctx, px) { try { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; } catch (e) { /* ignore */ } }

  /** Stroke a sprite icon (Lucide 24×24 geometry) onto the canvas. */
  function drawIcon(ctx, name, x, y, size, color, lw, fill) {
    var sym = document.getElementById('i-' + name);
    if (!sym || typeof window.Path2D !== 'function') return;
    var s = size / 24;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    Array.prototype.forEach.call(sym.children, function (n) {
      var tag = n.tagName.toLowerCase();
      var a = function (k) { return parseFloat(n.getAttribute(k)) || 0; };
      try {
        if (tag === 'path') { var p2 = new Path2D(n.getAttribute('d')); if (fill) ctx.fill(p2); ctx.stroke(p2); }
        else if (tag === 'circle') { ctx.beginPath(); ctx.arc(a('cx'), a('cy'), a('r'), 0, Math.PI * 2); ctx.stroke(); }
        else if (tag === 'rect') { rrect(ctx, a('x'), a('y'), a('width'), a('height'), a('rx')); ctx.stroke(); }
        else if (tag === 'line') { ctx.beginPath(); ctx.moveTo(a('x1'), a('y1')); ctx.lineTo(a('x2'), a('y2')); ctx.stroke(); }
        else if (tag === 'polyline' || tag === 'polygon') {
          var pts = (n.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
          ctx.beginPath();
          for (var i = 0; i + 1 < pts.length; i += 2) { if (i === 0) ctx.moveTo(pts[i], pts[i + 1]); else ctx.lineTo(pts[i], pts[i + 1]); }
          if (tag === 'polygon') ctx.closePath();
          ctx.stroke();
        }
      } catch (e) { /* skip unsupported element */ }
    });
    ctx.restore();
  }

  /**
   * NomadCare mark (pin + lifebuoy + signal arcs): a canvas copy of assets/img/logo.svg — same geometry AND the
   * same brand colours as that file (brand artwork, like the <img src="logo.svg"> used everywhere else, not UI tokens).
   * Deliberate exception to "colours only via tokens.css": tokens.css has no logo tokens and the UI tokens
   * (--c-primary / --c-accent) render a visibly different mark. The hex values below mirror logo.svg's gradients.
   * Keep in sync with logo.svg. `light` is unused (kept for the call signature).
   */
  function drawLogo(ctx, x, y, size, light) {
    if (typeof window.Path2D !== 'function') return;
    var s = size / 64;
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    var arc = ctx.createLinearGradient(34, 4, 54, 24);
    arc.addColorStop(0, '#FF9A3D'); arc.addColorStop(1, '#FF6B2C');
    ctx.lineCap = 'round';
    ctx.strokeStyle = arc; ctx.lineWidth = 4;
    ctx.stroke(new Path2D('M35.35 8.99A23 23 0 0 1 47.61 22.13'));
    ctx.globalAlpha = .55; ctx.stroke(new Path2D('M38 3.05A29.5 29.5 0 0 1 53.72 19.91')); ctx.globalAlpha = 1;
    var g = ctx.createLinearGradient(10, 10, 44, 62);
    g.addColorStop(0, '#1CC6B2'); g.addColorStop(.55, '#0E9384'); g.addColorStop(1, '#0A6B60');
    ctx.fillStyle = g;
    ctx.fill(new Path2D('M26 62C21.8 56.6 11.4 46 9.9 38A18 18 0 1 1 42.1 38C40.6 46 30.2 56.6 26 62Z'));
    ctx.lineWidth = 6; ctx.lineCap = 'butt';
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(26, 30, 8.75, 0, Math.PI * 2); ctx.stroke();
    if (ctx.setLineDash) {
      ctx.setLineDash([6.872, 6.872]); ctx.lineDashOffset = 10.309;
      ctx.strokeStyle = '#FF6B2C';
      ctx.beginPath(); ctx.arc(26, 30, 8.75, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = .18; ctx.lineWidth = .8; ctx.strokeStyle = '#0A6B60';
    ctx.beginPath(); ctx.arc(26, 30, 11.75, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawQR(ctx, q, x, y, size, color) {
    var m = size / q.size;
    ctx.fillStyle = color;
    for (var r = 0; r < q.size; r++) {
      var c = 0;
      while (c < q.size) {
        if (!q.dark[r][c]) { c++; continue; }
        var s = c;
        while (c < q.size && q.dark[r][c]) c++;
        var x0 = Math.round(x + s * m), x1 = Math.round(x + c * m);
        var y0 = Math.round(y + r * m), y1 = Math.round(y + (r + 1) * m);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  /**
   * Render the lock-screen wallpaper (1170×2532, iPhone 12–15 resolution) to a canvas.
   * Top 38 % is left clean for the lock-screen clock; bilingual medical card with a big QR below.
   * @returns {Promise<HTMLCanvasElement>}
   */
  function renderWallpaper(profile) {
    var text = NC.profile.publicText(profile);
    var q = matrix(text);
    if (!q) return Promise.reject(new Error('qr'));
    return ensureFonts().then(function () {
      var W = 1170, H = 2532;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      if (!ctx) throw new Error('canvas');
      var L = tokens('light'), D = tokens('dark');
      var F = L.font;
      var p = (NC.profile.normalize ? NC.profile.normalize(profile) : profile).public || {};

      /* --- background: dark brand gradient + soft glass shapes --- */
      var hero = D.hero.length >= 2 ? D.hero : [D.primaryStrong, D.primary];
      var bg = ctx.createLinearGradient(0, 0, W * 0.55, H);
      hero.forEach(function (c, i) { bg.addColorStop(i / (hero.length - 1), c); });
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = L.surface;
      ctx.globalAlpha = .07; ctx.beginPath(); ctx.arc(W + 40, 250, 560, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .05; ctx.beginPath(); ctx.arc(-120, 900, 380, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .06; ctx.beginPath(); ctx.arc(W - 60, H - 120, 300, 0, Math.PI * 2); ctx.fill();
      // faint contour lines (mountain-route motif) in the clean area
      ctx.globalAlpha = .07; ctx.strokeStyle = L.surface; ctx.lineWidth = 3;
      for (var k = 0; k < 5; k++) {
        ctx.beginPath();
        var yy = 640 + k * 46;
        ctx.moveTo(-20, yy);
        ctx.bezierCurveTo(W * 0.25, yy - 120 + k * 10, W * 0.55, yy + 110 - k * 12, W + 20, yy - 40);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      /* --- card geometry: top ≥ 880 px (≈ 35 %) stays clean for the clock; info column auto-fits (wpFit) --- */
      var cx = 72, cw = W - 144, pad = 60, headH = 140;
      var colX = cx + pad + 230 + 46, colW = cx + cw - pad - colX;
      var innerW = cw - pad * 2;
      var bottomMax = H - 90 - 108 - 36;   // home indicator margin, "Call 115" pill, gap
      var allergy = p.allergies || (fv('missing') + ' · ' + fe('missing'));
      var fit = wpFit(ctx, F, colW, allergy, p.conditions || fv('missing'), p.medications || fv('missing'), bottomMax, headH);
      var M = fit.m, cy = fit.cy;
      var infoTop = cy + headH + 40;
      var aLines = fit.a;
      var divY = infoTop + fit.h + 28;
      var qrSize = fit.qr, qrY = divY + 58, qrX = Math.round((W - qrSize) / 2);
      var capY = qrY + qrSize + 88;
      var footY = capY + 80;
      var cardH = (footY + 46) - cy;

      /* card + shadow */
      ctx.save();
      ctx.shadowColor = D.shadow; ctx.shadowBlur = 70; ctx.shadowOffsetY = 24;
      ctx.fillStyle = L.surface; rrect(ctx, cx, cy, cw, cardH, 64); ctx.fill();
      ctx.restore();

      /* header band (danger gradient) */
      var dstops = L.gDanger.length >= 2 ? L.gDanger : [L.danger, L.danger];
      var grad = function (x0, y0, x1, y1) {
        var gg = ctx.createLinearGradient(x0, y0, x1, y1);
        dstops.forEach(function (c, i) { gg.addColorStop(i / (dstops.length - 1), c); });
        return gg;
      };
      ctx.fillStyle = grad(cx, cy, cx + cw, cy + headH); rrect(ctx, cx, cy, cw, headH, [64, 64, 0, 0]); ctx.fill();
      ctx.fillStyle = L.surface; ctx.globalAlpha = .22;
      ctx.beginPath(); ctx.arc(cx + pad + 46, cy + headH / 2, 46, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      drawIcon(ctx, 'cross', cx + pad + 20, cy + headH / 2 - 26, 52, L.onDanger, 2, true);
      ctx.fillStyle = L.onDanger; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      var hx = cx + pad + 118, hw = cx + cw - pad - hx;
      setSpacing(ctx, 1); fitFont(ctx, fv('header'), hw, '800', 46, 34, F);
      ctx.fillText(fv('header'), hx, cy + 64);
      ctx.globalAlpha = .9; setSpacing(ctx, 5); fitFont(ctx, fe('header'), hw, '700', 30, 22, F);
      ctx.fillText(fe('header'), hx, cy + 106);
      ctx.globalAlpha = 1; setSpacing(ctx, 0);

      /* blood type drop */
      var bx = cx + pad + 115, by = infoTop + 120, br = 104;
      ctx.fillStyle = L.dangerSoft;
      ctx.beginPath(); ctx.arc(bx, by, br + 12, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(bx, by + 10); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = grad(-br, -br, br, br);
      rrect(ctx, -br * 0.82, -br * 0.82, br * 1.64, br * 1.64, [0, br * 0.82, br * 0.82, br * 0.82]);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = L.onDanger; ctx.textAlign = 'center';
      var bt = p.blood_type === 'unknown' ? '?' : (p.blood_type || '—').replace('-', '−');
      ctx.font = '800 ' + (bt.length > 2 ? 70 : 84) + 'px ' + F;
      ctx.fillText(bt, bx, by + 42);
      ctx.fillStyle = L.dangerStrong; ctx.font = '800 26px ' + F; setSpacing(ctx, 3);
      ctx.fillText(fv('blood').toUpperCase(), bx, by + br + 70);
      ctx.fillStyle = L.muted; ctx.font = '700 24px ' + F;
      ctx.fillText(fe('blood').toUpperCase(), bx, by + br + 104);
      setSpacing(ctx, 0);

      /* right column: allergies (prominent), conditions, medications */
      ctx.textAlign = 'left';
      var yy2 = infoTop + 30;
      ctx.fillStyle = L.danger; setSpacing(ctx, 3);
      fitFont(ctx, (fv('allergies') + ' · ' + fe('allergies')).toUpperCase(), colW, '800', 27, 20, F);
      ctx.fillText((fv('allergies') + ' · ' + fe('allergies')).toUpperCase(), colX, yy2);
      setSpacing(ctx, 0);
      ctx.fillStyle = L.text; ctx.font = '800 ' + M.aSize + 'px ' + F;
      aLines.forEach(function (ln, i) { ctx.fillText(ln, colX, yy2 + M.aFirst + i * M.aLH); });
      yy2 += M.aFirst + (aLines.length - 1) * M.aLH + M.aGap;
      [['conditions', fit.c], ['medications', fit.md]].forEach(function (row, ri) {
        var lab = (fv(row[0]) + ' · ' + fe(row[0])).toUpperCase();
        ctx.fillStyle = L.muted; setSpacing(ctx, 3);
        fitFont(ctx, lab, colW, '700', 24, 18, F);
        ctx.fillText(lab, colX, yy2);
        setSpacing(ctx, 0);
        ctx.fillStyle = L.text2; ctx.font = '600 ' + M.tSize + 'px ' + F;
        row[1].forEach(function (ln, i) { ctx.fillText(ln, colX, yy2 + M.tFirst + i * M.tLH); });
        yy2 += M.tFirst + (row[1].length - 1) * M.tLH + (ri === 0 ? M.tGap : 0);
      });
      if (fit.cut) {
        // Something still had to be ellipsised → tell the rescuer where the full list is.
        ctx.fillStyle = L.dangerStrong; ctx.font = '700 ' + Math.max(22, M.tSize - 6) + 'px ' + F;
        var hint = fv('see_qr') + ' · ' + fe('see_qr').replace(/^…\s*/, '');
        fitFont(ctx, hint, colW, '700', Math.max(22, M.tSize - 6), 18, F);
        ctx.fillText(hint, colX, yy2 + 52);
      }

      /* divider */
      ctx.strokeStyle = L.border; ctx.lineWidth = 3;
      if (ctx.setLineDash) ctx.setLineDash([14, 12]);
      ctx.beginPath(); ctx.moveTo(cx + pad, divY); ctx.lineTo(cx + cw - pad, divY); ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);

      /* QR with scan-corner brackets */
      drawQR(ctx, q, qrX, qrY, qrSize, L.text);
      ctx.strokeStyle = L.primary; ctx.lineWidth = 9; ctx.lineCap = 'round';
      var o = 30, len = 58, x0 = qrX - o, y0 = qrY - o, x1 = qrX + qrSize + o, y1 = qrY + qrSize + o;
      [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(function (c) {
        ctx.beginPath();
        ctx.moveTo(c[0], c[1] + c[3] * len); ctx.lineTo(c[0], c[1] + c[3] * 14);
        ctx.quadraticCurveTo(c[0], c[1], c[0] + c[2] * 14, c[1]);
        ctx.lineTo(c[0] + c[2] * len, c[1]);
        ctx.stroke();
      });

      /* caption (bilingual) */
      ctx.textAlign = 'center'; ctx.fillStyle = L.text2;
      fitFont(ctx, fv('caption'), innerW, '700', 30, 22, F);
      ctx.fillText(fv('caption'), W / 2, capY);
      ctx.fillStyle = L.muted;
      fitFont(ctx, fe('caption'), innerW, '500', 27, 20, F);
      ctx.fillText(fe('caption'), W / 2, capY + 40);

      /* card footer: brand mark + updated date */
      var upd = profile.updated_at ? String(profile.updated_at).slice(0, 10) : '';
      ctx.font = '800 26px ' + F;
      var brand = 'NomadCare';
      var bw = ctx.measureText(brand).width;
      var meta = upd ? '  ·  ' + fv('updated') + ' / ' + fe('updated') + ' ' + upd : '';
      ctx.font = '600 23px ' + F;
      var mw = ctx.measureText(meta).width;
      var fx = W / 2 - (40 + bw + mw) / 2;
      drawLogo(ctx, fx, footY - 30, 36, L);
      ctx.textAlign = 'left';
      ctx.fillStyle = L.text; ctx.font = '800 26px ' + F;
      ctx.fillText(brand, fx + 40, footY);
      ctx.fillStyle = L.muted; ctx.font = '600 23px ' + F;
      ctx.fillText(meta, fx + 40 + bw, footY);

      /* "Gọi · Call 115" pill (clear of the flashlight / camera buttons) */
      var pillW = 520, pillH = 108, pillX = (W - pillW) / 2, pillY = cy + cardH + 36;
      ctx.save();
      ctx.shadowColor = D.shadow; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
      ctx.fillStyle = grad(pillX, pillY, pillX + pillW, pillY + pillH); rrect(ctx, pillX, pillY, pillW, pillH, pillH / 2); ctx.fill();
      ctx.restore();
      var label = fv('call_short') + ' · ' + fe('call_short') + ' 115';
      fitFont(ctx, label, pillW - 150, '800', 46, 32, F);
      var lw2 = ctx.measureText(label).width;
      var startX = W / 2 - (lw2 + 66) / 2;
      drawIcon(ctx, 'phone', startX, pillY + pillH / 2 - 25, 50, L.onDanger, 2.4);
      ctx.fillStyle = L.onDanger; ctx.textAlign = 'left';
      ctx.fillText(label, startX + 66, pillY + pillH / 2 + 16);
      return cv;
    });
  }

  function canvasBlob(cv) {
    return new Promise(function (resolve, reject) {
      try {
        if (cv.toBlob) cv.toBlob(function (b) { if (b) resolve(b); else reject(new Error('blob')); }, 'image/png');
        else {
          var bin = atob(cv.toDataURL('image/png').split(',')[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/png' }));
        }
      } catch (e) { reject(e); }
    });
  }

  /** Build the wallpaper PNG for the current profile → {blob, url, canvas}. */
  function wallpaper() {
    var prof = S.profile;
    var ready = prof ? Promise.resolve(prof) : NC.profile.get();
    return ready.then(function (p) {
      if (!p || !NC.profile.publicText(p)) throw new Error('no-profile');
      return renderWallpaper(p);
    }).then(function (cv) {
      return canvasBlob(cv).then(function (blob) { return { blob: blob, url: URL.createObjectURL(blob), canvas: cv }; });
    });
  }

  function markWallpaper() {
    S.wallpaperAt = new Date().toISOString();
    return kvSet(KV_WALLPAPER, S.wallpaperAt).then(function () { if (S.active && S.view === 'owner') renderActions($('#qr-actions', S.el)); });
  }

  function openWallpaper() {
    if (!qrText()) { NC.ui.toast(t('qr.wp.need_profile'), { type: 'warning' }); return; }
    var body = h('div', { class: 'qr-wp' });
    var now = new Date();
    var dateStr = '';
    try { dateStr = new Intl.DateTimeFormat(NC.i18n.lang() === 'en' ? 'en-GB' : 'vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(now); }
    catch (e) { dateStr = U.fmtDate(now); }
    body.innerHTML =
      '<div class="qr-wp__stage"><div class="qr-wp__phone" data-theme="dark">' +
        '<div class="qr-wp__screen"><span class="skeleton qr-wp__skeleton"></span>' +
          '<div class="qr-wp__clock" aria-hidden="true">' + I('lock', 'icon--sm') + '<span class="qr-wp__date">' + esc(dateStr) + '</span>' +
          '<span class="qr-wp__time">' + esc(U.fmtTime(now)) + '</span></div>' +
        '</div><span class="qr-wp__island" aria-hidden="true"></span></div></div>' +
      '<div class="qr-wp__info"><p class="qr-wp__steps">' + I('info', 'icon--sm') + '<span>' + esc(t('qr.wp.steps')) + '</span></p></div>';
    var result = null;
    var shareOk = !!(navigator.share && navigator.canShare && window.File);
    var actions = [];
    if (shareOk) actions.push({ label: t('qr.wp.share'), variant: 'outline', icon: 'share', id: 'qr-wp-share', disabled: true, onClick: function () { return share(); } });
    actions.push({ label: t('qr.wp.download'), variant: 'primary', icon: 'download', id: 'qr-wp-dl', disabled: true, onClick: function () { download(); return false; } });
    var ctrl = NC.ui.modal({
      title: t('qr.wp.title'), subtitle: t('qr.wp.sub'), icon: 'image', size: 'md', body: body, className: 'qr-wp-modal', actions: actions,
      onClose: function () { if (result && result.url) setTimeout(function () { URL.revokeObjectURL(result.url); }, 1000); }
    });
    function download() {
      if (!result) return;
      U.downloadBlob('nomadcare-lock-screen.png', result.blob);
      markWallpaper();
      NC.ui.toast(t('qr.wp.saved'), { type: 'success', timeout: 4200 });
    }
    function share() {
      if (!result) return false;
      var file = new File([result.blob], 'nomadcare-lock-screen.png', { type: 'image/png' });
      if (!navigator.canShare({ files: [file] })) { download(); return false; }
      return navigator.share({ files: [file], title: t('qr.wp.title') }).then(function () {
        markWallpaper();
        return false;
      }, function () { return false; });
    }
    wallpaper().then(function (r) {
      result = r;
      var screen = $('.qr-wp__screen', ctrl.body);
      if (!screen) return;
      var img = h('img', { class: 'qr-wp__img', src: r.url, alt: t('qr.wp.preview_alt'), width: '1170', height: '2532' });
      var sk = $('.qr-wp__skeleton', screen);
      if (sk) screen.replaceChild(img, sk); else screen.insertBefore(img, screen.firstChild);
      ['qr-wp-dl', 'qr-wp-share'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = false; });
    }).catch(function (e) {
      console.warn('[qr] wallpaper failed', e && e.message);
      NC.ui.toast(t('qr.wp.error'), { type: 'danger' });
      ctrl.close();
    });
    return ctrl;
  }

  /* ================================================================== */
  /* WALLET CARD (print)                                                  */
  /* ================================================================== */
  function printCard() {
    var text = qrText();
    if (!text) { NC.ui.toast(t('qr.wp.need_profile'), { type: 'warning' }); return; }
    var box = $('#qr-print', S.el);
    if (!box) return;
    var p = pub();
    function row(k) {
      var v = p[k];
      return '<div class="qr-wc__row' + (k === 'allergies' && v && !isNoneValue(v) ? ' qr-wc__row--alert' : '') + '"><dt><b>' + esc(fv(k)) + '</b> / <span lang="en">' + esc(fe(k)) + '</span></dt>' +
        '<dd>' + (v ? esc(v) : esc(fv('missing')) + ' / <span lang="en">' + esc(fe('missing')) + '</span>') + '</dd></div>';
    }
    box.innerHTML =
      '<p class="qr-wc__hint" lang="' + esc(NC.i18n.lang()) + '">' + esc(t('qr.pr.hint')) + '</p>' +
      '<div class="qr-wc__sheet" lang="vi">' +
        '<section class="qr-wc qr-wc--front">' +
          '<header class="qr-wc__head"><span class="qr-wc__cross">+</span><span><b>' + esc(fv('header')) + '</b><small lang="en">' + esc(fe('header')) + '</small></span></header>' +
          '<div class="qr-wc__body">' +
            '<div class="qr-wc__blood"><span class="qr-wc__bt">' + esc(bloodShort(p.blood_type)) + '</span><small>' + esc(fv('blood')) + '<br><span lang="en">' + esc(fe('blood')) + '</span></small></div>' +
            '<dl class="qr-wc__rows">' + row('allergies') + row('conditions') + row('medications') + (p.notes ? row('notes') : '') + '</dl>' +
          '</div>' +
          '<footer class="qr-wc__foot"><b>' + esc(fv('call')) + ' · <span lang="en">' + esc(fe('call')) + '</span></b><span>' + esc(fv('updated')) + ' ' + esc(updatedDate()) + '</span></footer>' +
        '</section>' +
        '<section class="qr-wc qr-wc--back">' +
          '<div class="qr-wc__qr" data-theme="light">' + svg(text) + '</div>' +
          '<div class="qr-wc__back-text"><b>' + esc(fv('caption')) + '</b><span lang="en">' + esc(fe('caption')) + '</span>' +
          '<span class="qr-wc__brand"><img src="' + esc(NC.ui.assetUrl('assets/img/logo.svg')) + '" alt="" width="14" height="14">NomadCare</span></div>' +
        '</section>' +
      '</div>';
    var body = document.body;
    var cleaned = false;
    var cleanup = function () {
      if (cleaned) return; cleaned = true;
      body.classList.remove('qr-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    body.classList.add('qr-printing');
    window.addEventListener('afterprint', cleanup);
    NC.ui.toast(t('qr.pr.opening'), { timeout: 1800 });
    setTimeout(function () {
      try { window.print(); } catch (e) { cleanup(); return; }
      if (!('onafterprint' in window)) setTimeout(cleanup, 1500);
    }, 60);
  }

  /* ================================================================== */
  /* RESCUER VIEW                                                         */
  /* ================================================================== */
  /* #qr-rescuer carries lang="vi": Vietnamese labels inherit it, English parts carry lang="en", UI-language
     parts (exit button, disclaimer) carry the UI language. */
  function bil(k, tag) {
    var tg = tag || 'span';
    return '<b>' + esc(fv(k)) + '</b><' + tg + ' lang="en">' + esc(fe(k)) + '</' + tg + '>';
  }
  function uiLang() { return NC.i18n.lang(); }

  function renderRescuer() {
    var el = S.rsEl;
    if (!el) return;
    if (!S.rs) S.rs = newRescuerState();
    if (S.rs.pad) { S.rs.pad.destroy(); S.rs.pad = null; }
    var p = pub();
    var text = qrText();
    var bar = '<header class="qr-rs__bar">' +
      '<span class="qr-rs__brand"><span class="icon-tile icon-tile--sm icon-tile--solid-danger">' + I('cross') + '</span>' +
      '<span class="qr-rs__brand-text">' + bil('mode') + '</span></span>' +
      '<button class="btn btn--outline qr-rs__exit" type="button" data-qr-act="rs-exit" lang="' + esc(uiLang()) + '" aria-label="' + esc(t('qr.rs.exit_aria')) + '">' +
        I('x') + '<span>' + esc(t('qr.rs.exit')) + '</span></button>' +
      '</header>';
    var call = '<a class="btn btn--danger btn--xl btn--block qr-rs__call" href="tel:115" data-call="115">' + I('phone-call') +
      '<span>' + esc(fv('call')) + ' <span class="qr-rs__call-en" lang="en">· ' + esc(fe('call')) + '</span></span></a>';
    var content;
    if (!S.loaded) {
      content = '<div class="qr-rs__loading"><span class="spinner"></span></div>';
    } else if (!text) {
      content = '<div class="qr-rs__grid qr-rs__grid--single"><section class="qr-rs__med">' +
        '<div class="qr-rs__banner">' + I('heart-pulse', 'icon--xl') + '<div><h2 id="qr-rs-title">' + esc(fv('header')) + '</h2><p lang="en">' + esc(fe('header')) + '</p></div></div>' +
        '<div class="qr-rs__empty">' + I('user', 'icon--xl') + '<p><b>' + esc(fv('no_profile')) + '</b><span lang="en">' + esc(fe('no_profile')) + '</span></p>' +
        '<p class="muted"><span>' + esc(fv('no_profile_hint')) + '</span><span lang="en">' + esc(fe('no_profile_hint')) + '</span></p></div>' +
        call + '</section></div>';
    } else {
      var miss = function (k) { return !p[k]; };
      var rowH = function (k, alert) {
        return '<div class="qr-rs__row' + (alert ? ' qr-rs__row--alert' : '') + (miss(k) ? ' is-missing' : '') + '"><dt>' + bil(k) + '</dt>' +
          '<dd>' + (p[k] ? esc(p[k]) : esc(fv('missing')) + ' · <span lang="en">' + esc(fe('missing')) + '</span>') + '</dd></div>';
      };
      var allergyAlert = p.allergies && !isNoneValue(p.allergies);
      content = '<div class="qr-rs__grid">' +
        '<section class="qr-rs__med">' +
          '<div class="qr-rs__banner">' + I('heart-pulse', 'icon--xl') + '<div><h2 id="qr-rs-title">' + esc(fv('header')) + '</h2><p lang="en">' + esc(fe('header')) + '</p></div></div>' +
          '<div class="qr-rs__blood"><span class="qr-rs__blood-v">' + esc(bloodShort(p.blood_type)) + '</span>' +
            '<span class="qr-rs__blood-l">' + bil('blood') + (p.blood_type === 'unknown' ? '<em>' + esc(fv('unknown')) + ' · <span lang="en">' + esc(fe('unknown')) + '</span></em>' : '') + '</span></div>' +
          '<dl class="qr-rs__rows">' + rowH('allergies', allergyAlert) + rowH('conditions') + rowH('medications') + (p.notes ? rowH('notes') : '') + '</dl>' +
          call +
        '</section>' +
        '<aside class="qr-rs__side">' +
          '<div class="qr-rs__qr"><div class="qr-code qr-code--lg" data-theme="light">' + svg(text) + '</div>' +
            '<p class="qr-rs__qr-cap"><span>' + esc(fv('caption')) + '</span><span lang="en">' + esc(fe('caption')) + '</span></p></div>' +
          '<section class="qr-rs-id" id="qr-rs-id" aria-live="polite"></section>' +
        '</aside>' +
      '</div>';
    }
    el.innerHTML = bar + '<div class="qr-rs__scroll">' + content +
      '<div class="qr-rs__disc" id="qr-rs-disc" lang="' + esc(uiLang()) + '"></div></div>';
    var disc = $('#qr-rs-disc', el);
    if (disc) disc.appendChild(NC.ui.disclaimer({ compact: true }));
    renderRescuerId();
  }

  function stopRevealTimers() {
    var rs = S.rs;
    if (!rs) return;
    if (rs.timer) { clearInterval(rs.timer); rs.timer = null; }
    if (rs.hold) { try { rs.hold.destroy(); } catch (e) { /* ignore */ } rs.hold = null; }
    if (rs.pad) { rs.pad.destroy(); rs.pad = null; }
  }

  function renderRescuerId() {
    var box = S.rsEl ? $('#qr-rs-id', S.rsEl) : null;
    var rs = S.rs;
    if (!box || !rs) return;
    if (rs.hold) { try { rs.hold.destroy(); } catch (e) { /* ignore */ } rs.hold = null; }
    if (rs.pad) { rs.pad.destroy(); rs.pad = null; }
    var i = ident();
    var head = '<h3 class="qr-rs-id__title">' + I(rs.state === 'revealed' ? 'unlock' : 'lock', 'icon--sm') + '<span>' + bil('id_title') + '</span></h3>';
    if (!hasIdentity()) {
      box.className = 'qr-rs-id qr-rs-id--none';
      box.innerHTML = head + '<p class="qr-rs-id__muted"><span>' + esc(fv('no_identity')) + '</span><span lang="en">' + esc(fe('no_identity')) + '</span></p>';
      return;
    }
    box.className = 'qr-rs-id qr-rs-id--' + rs.state;
    if (rs.state === 'revealed') {
      var ph = i.contact_phone ? NC.ui.formatPhoneAction(i.contact_phone) : null;
      box.innerHTML = head +
        '<dl class="qr-rs-id__data">' +
          (i.full_name ? '<div><dt>' + bil('name') + '</dt><dd class="qr-rs-id__name">' + esc(i.full_name) + '</dd></div>' : '') +
          (i.nationality ? '<div><dt>' + bil('nationality') + '</dt><dd>' + esc(i.nationality) + '</dd></div>' : '') +
          (i.contact_name || i.contact_phone ? '<div><dt>' + bil('contact') + '</dt><dd>' + esc(i.contact_name || '') +
            (i.contact_phone ? '<span class="qr-rs-id__phone">' + esc(ph.display) + '</span>' : '') + '</dd></div>' : '') +
        '</dl>' +
        (i.contact_phone ? '<button class="btn btn--primary btn--lg btn--block" type="button" data-qr-act="rs-call-contact">' + I('phone') +
          '<span>' + esc(fv('call_contact')) + ' · <span lang="en">' + esc(fe('call_contact')) + '</span></span></button>' : '') +
        '<div class="qr-rs-id__timer"><div class="qr-rs-id__timer-row"><span data-qr-countdown>' + countdownText() + '</span>' +
          '<button class="btn btn--ghost btn--sm qr-rs-id__hide" type="button" data-qr-act="rs-hide">' + I('eye-off') + '<span>' + esc(fv('hide_now')) + ' · <span lang="en">' + esc(fe('hide_now')) + '</span></span></button></div>' +
          '<div class="progress progress--sm progress--danger"><div class="progress__bar" data-qr-countdown-bar style="width:' + (rs.remaining / REVEAL_SECONDS * 100) + '%"></div></div></div>';
      return;
    }
    if (rs.state === 'code') {
      box.innerHTML = head + '<div class="qr-kp-host"></div>';
      rs.pad = createPad($('.qr-kp-host', box), {
        bilingual: true,
        onSuccess: function () { rs.pad = null; reveal(); },
        onCancel: function () { rs.pad = null; rs.state = 'locked'; renderRescuerId(); focusRescuer('#qr-rs-hold'); }
      });
      return;
    }
    // locked
    box.innerHTML = head +
      '<p class="qr-rs-id__warn">' + I('alert-triangle', 'icon--sm') + '<span><span>' + esc(fv('id_warn')) + '</span><span lang="en">' + esc(fe('id_warn')) + '</span></span></p>' +
      '<button class="btn btn--outline btn--lg btn--block btn--wrap qr-rs-id__hold" type="button" id="qr-rs-hold">' + I('fingerprint') +
        '<span class="qr-rs-id__hold-text"><b>' + esc(fv('hold')) + '</b><span class="hold__hint" lang="en">' + esc(fe('hold')) + '</span></span></button>';
    var btn = $('#qr-rs-hold', box);
    if (btn) rs.hold = NC.ui.holdToConfirm(btn, HOLD_MS, onHoldDone);
  }

  function focusRescuer(sel) {
    var b = S.rsEl ? $(sel, S.rsEl) : null;
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
  }

  function countdownText() {
    var s = S.rs ? S.rs.remaining : REVEAL_SECONDS;
    return esc(fv('autohide', { s: s })) + ' · <span lang="en">' + esc(fe('autohide', { s: s })) + '</span>';
  }

  function onHoldDone() {
    var rs = S.rs; if (!rs) return;
    if (ident().reveal_code) {
      // Re-read the persisted lock (another tab / a previous visit may have failed attempts).
      refreshLock().then(function () {
        if (S.rs !== rs || rs.state !== 'locked') return;
        rs.state = 'code';
        renderRescuerId();
        if (rs.pad) rs.pad.focus();
      });
    } else {
      setTimeout(reveal, 0);
    }
  }

  function reveal() {
    var rs = S.rs; if (!rs) return;
    stopRevealTimers();
    rs.state = 'revealed'; rs.remaining = REVEAL_SECONDS;
    var started = Date.now();
    rs.timer = setInterval(function () {
      rs.remaining = Math.max(0, REVEAL_SECONDS - Math.floor((Date.now() - started) / 1000));
      var txt = S.rsEl ? $('[data-qr-countdown]', S.rsEl) : null, bar = S.rsEl ? $('[data-qr-countdown-bar]', S.rsEl) : null;
      if (txt) txt.innerHTML = countdownText();
      if (bar) bar.style.width = (rs.remaining / REVEAL_SECONDS * 100) + '%';
      if (rs.remaining <= 0) rehide();
    }, 500);
    logReveal();
    renderRescuerId();
    focusRescuer('[data-qr-act="rs-call-contact"], [data-qr-act="rs-hide"]');
    U.vibrate(20);
  }

  function rehide() {
    var rs = S.rs; if (!rs) return;
    var hadFocus = S.rsEl && S.rsEl.contains(document.activeElement) && document.activeElement !== S.rsEl;
    stopRevealTimers();
    rs.state = 'locked'; rs.remaining = REVEAL_SECONDS;
    if (S.active && S.view === 'rescuer') {
      renderRescuerId();
      if (hadFocus) focusRescuer('#qr-rs-hold');
    }
  }

  function logReveal() {
    var entry = { at: new Date().toISOString() };
    S.reveals = S.reveals.concat([entry]).slice(-20);
    kvSet(KV_REVEALS, S.reveals);
  }

  /* ---- modal behaviour: inert background, focus trap, Escape, back button ---- */
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function rsFocusables() {
    return S.rsEl ? $$(FOCUSABLE, S.rsEl).filter(function (n) { return n.offsetWidth > 0 || n.offsetHeight > 0 || n.getClientRects().length > 0; }) : [];
  }
  function shellNodes() {
    var list = [document.getElementById('app'), document.getElementById('screen-onboarding')];
    return list.concat($$('.skip-link')).filter(Boolean);
  }
  /** Everything behind the rescuer view (whole app shell, skip link, onboarding) becomes inert + aria-hidden. */
  function setShellInert(on) {
    shellNodes().forEach(function (n) {
      if (on) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); n.setAttribute('data-qr-inert', ''); }
      else if (n.hasAttribute('data-qr-inert')) {
        n.removeAttribute('data-qr-inert');
        // A sheet may still be open on top (it manages #app itself) — only undo what the rescuer view added.
        if (!(NC.ui.openCount && NC.ui.openCount() > 0)) { n.removeAttribute('inert'); n.removeAttribute('aria-hidden'); }
      }
    });
    if (S.rsObserver) { S.rsObserver.disconnect(); S.rsObserver = null; }
    // A sheet that was open when the rescuer view opened (e.g. the emergency sheet) clears #app's inert when it
    // finishes closing → put it back while the rescuer view is still open.
    if (on && window.MutationObserver) {
      S.rsObserver = new MutationObserver(function () {
        if (!S.active || S.view !== 'rescuer') return;
        shellNodes().forEach(function (n) {
          if (n.hasAttribute('data-qr-inert') && !n.hasAttribute('inert')) { n.setAttribute('inert', ''); n.setAttribute('aria-hidden', 'true'); }
        });
      });
      shellNodes().forEach(function (n) { S.rsObserver.observe(n, { attributes: true, attributeFilter: ['inert'] }); });
    }
  }

  function setRescuerOpen(on) {
    var rsEl = S.rsEl, owner = $('#qr-owner', S.el);
    var was = !!(rsEl && !rsEl.hidden);
    if (rsEl) rsEl.hidden = !on;
    if (owner) owner.hidden = on;
    if (S.el) S.el.classList.toggle('qr-is-rescuer', on);
    var sec = S.el && S.el.closest ? S.el.closest('.screen') : null;
    if (sec) sec.classList.toggle('qr-screen--rescuer', on);
    document.documentElement.classList.toggle('qr-rs-open', on);
    if (on !== was || on) setShellInert(on);
  }

  function onRescuerKey(e) {
    if (!S.active || S.view !== 'rescuer' || !S.rsEl || S.rsEl.hidden) return;
    if (NC.ui.openCount && NC.ui.openCount() > 0) return;   // a sheet/modal on top traps focus itself
    var rs = S.rs;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      if (rs && rs.state === 'code') { rs.state = 'locked'; renderRescuerId(); focusRescuer('#qr-rs-hold'); return; }
      exitRescuer();
      return;
    }
    if (e.key === 'Tab') {
      var f = rsFocusables();
      if (!f.length) { e.preventDefault(); S.rsEl.focus(); return; }
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!S.rsEl.contains(a) || a === S.rsEl) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (rs && rs.state === 'code' && rs.pad) rs.pad.key(e);
  }
  /** Focus that wandered outside the dialog (click on the page edge, screen reader) is pulled back in. */
  function onRescuerFocusIn(e) {
    if (!S.active || S.view !== 'rescuer' || !S.rsEl || S.rsEl.hidden) return;
    if (NC.ui.openCount && NC.ui.openCount() > 0) return;
    var tg = e.target;
    if (tg && tg !== document && tg !== window && !S.rsEl.contains(tg) && !(tg.closest && tg.closest('#sheet-root, #toast-root'))) {
      var f = rsFocusables();
      var n = f[0] || S.rsEl;
      try { n.focus({ preventScroll: true }); } catch (err) { n.focus(); }
    }
  }

  function armRescuerBack() {
    if (S.rsBack || !NC.ui || typeof NC.ui.onBack !== 'function') return;
    // Back (browser / Android) closes the rescuer view → owner view, even when it was opened by a deep link.
    S.rsBack = NC.ui.onBack(function () { S.rsBack = null; leaveRescuer(); });
  }
  function releaseRescuerBack() {
    var rel = S.rsBack;
    S.rsBack = null;
    if (rel) { try { rel(); } catch (e) { /* ignore */ } }
  }
  function leaveRescuer() {
    NC.app.go('qr', null, { replace: true });
  }

  function exitRescuer() {
    var st = null;
    try { st = window.history.state; } catch (e) { st = null; }
    // Our overlay entry is on top → exit exactly like the back button (the entry is popped, then the route is
    // replaced), which avoids racing an async history.back() with the route change.
    if (S.rsBack && st && st.ncOverlay) { window.history.back(); return; }
    releaseRescuerBack();
    leaveRescuer();
  }

  /**
   * Open the full-screen rescuer card (also reachable via #/qr?view=rescuer).
   * From the owner view the route is replaced when NC.ui.onBack exists: its own history entry makes back close the
   * card, so the owner entry is not duplicated.
   */
  function openRescuer(fromTile) {
    S.rsReturn = fromTile === true ? 'tile' : null;
    var cur = NC.app.current ? NC.app.current() : null;
    var replace = !!(NC.ui && typeof NC.ui.onBack === 'function') && S.active && S.view === 'owner' && cur && cur.name === 'qr';
    NC.app.go('qr', { view: 'rescuer' }, replace ? { replace: true } : undefined);
  }

  /* ================================================================== */
  /* RENDER / EVENTS                                                      */
  /* ================================================================== */
  function render() {
    if (!S.el) return;
    if (S.view === 'rescuer') { setRescuerOpen(true); renderRescuer(); }
    else { setRescuerOpen(false); renderOwner(); }
  }

  function within(n) { return !!n && ((S.el && S.el.contains(n)) || (S.rsEl && S.rsEl.contains(n))); }

  function onClick(e) {
    var tg = e.target;
    if (!tg || !tg.closest) return;
    var btn = tg.closest('[data-qr-act]');
    if (!btn || !within(btn) || btn.disabled) return;
    var act = btn.getAttribute('data-qr-act');
    switch (act) {
      case 'create':
      case 'edit-public': openPublicEditor(); break;
      case 'edit-identity':
        // Editing pre-fills the identity fields → same gate as revealing them (nothing to protect when empty).
        if (hasIdentity() && !S.ownerReveal) gateIdentity('edit').then(function (ok) { if (ok) openIdentityEditor(); });
        else openIdentityEditor();
        break;
      case 'toggle-identity':
        if (S.ownerReveal) { hideOwnerIdentity(); focusAct('toggle-identity'); }
        else gateIdentity('show').then(function (ok) { if (ok) showOwnerIdentity(); });
        break;
      case 'wallpaper': openWallpaper(); break;
      case 'print': printCard(); break;
      case 'rescuer': openRescuer(true); break;
      case 'copy-payload':
        U.copyText(qrText()).then(function (ok) { NC.ui.toast(ok ? t('common.copied') : t('common.error'), { type: ok ? 'success' : 'warning', timeout: 1800 }); });
        break;
      case 'consent-inline':
        acceptConsent().then(function () { render(); openPublicEditor(); });
        break;
      case 'rs-exit': exitRescuer(); break;
      case 'rs-hide': rehide(); break;
      case 'rs-call-contact': NC.ui.callNumber(ident().contact_phone); break;
    }
  }
  function focusAct(act) {
    var b = $('[data-qr-act="' + act + '"]', S.el);
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
  }

  function onChange(e) {
    var box = e.target && e.target.closest ? e.target.closest('[data-qr-consent-check]') : null;
    if (!box || !S.el.contains(box)) return;
    var b = $('[data-qr-act="consent-inline"]', S.el);
    if (b) b.disabled = !box.checked;
  }

  var SKELETON = null;
  function ensureSkeleton(section) {
    var root = $('#qr-root', section);
    if (root) return root;
    // Fallback when the static partial was not stitched into index.html: build the containers.
    console.warn('[qr] #qr-root missing — building a minimal skeleton');
    SKELETON = SKELETON || '<div class="qr" id="qr-root"><div class="qr-owner" id="qr-owner">' +
      '<section class="page-intro qr-intro" id="qr-intro"><div class="page-intro__text"><p class="page-intro__lead" data-i18n="qr.intro.lead"></p></div></section>' +
      '<div class="qr-layout"><section class="card qr-card" id="qr-card" aria-labelledby="qr-hero-title"><div class="qr-hero" id="qr-hero"></div>' +
      '<nav class="qr-actions" id="qr-actions" data-i18n-attr="aria-label:qr.act.aria"></nav></section>' +
      '<div class="qr-main"><div class="qr-layers"><section class="card qr-layer qr-layer--public" id="qr-public"></section>' +
      '<section class="card qr-layer qr-layer--identity" id="qr-identity"></section></div></div>' +
      '<aside class="qr-side"><details class="disclosure disclosure--card qr-fold qr-privacy" id="qr-privacy"><summary class="disclosure__sum">' +
      I('shield-check') + '<span class="disclosure__txt">' +
      '<span class="disclosure__title" data-i18n="qr.pv.fold_title"></span><span class="disclosure__sub" data-i18n="qr.pv.sub"></span></span>' +
      '<span class="disclosure__chev">' + I('chevron-down') + '</span></summary><div class="disclosure__body qr-fold__body qr-privacy__body" id="qr-privacy-body"></div></details>' +
      '<div class="qr-disclaimer" id="qr-disclaimer"></div></aside></div></div>' +
      '<div class="qr-rs" id="qr-rescuer" role="dialog" aria-modal="true" aria-labelledby="qr-rs-title" tabindex="-1" hidden></div>' +
      '<div class="qr-print" id="qr-print" data-theme="light" aria-hidden="true"></div></div>';
    section.insertAdjacentHTML('beforeend', SKELETON);
    return $('#qr-root', section);
  }

  function mount(section) {
    S.el = ensureSkeleton(section);
    S.mounted = true;
    // The rescuer dialog lives directly in <body> so #app (the whole shell) can be made inert behind it.
    S.rsEl = $('#qr-rescuer', S.el) || document.getElementById('qr-rescuer');
    if (S.rsEl) {
      S.rsEl.setAttribute('lang', 'vi');
      if (S.rsEl.parentNode !== document.body) document.body.insertBefore(S.rsEl, document.getElementById('sheet-root'));
      S.rsEl.addEventListener('click', onClick);
    }
    S.el.addEventListener('click', onClick);
    S.el.addEventListener('change', onChange);
    document.addEventListener('keydown', onRescuerKey, true);
    document.addEventListener('focusin', onRescuerFocusIn);
    NC.bus.on('profile:update', function (p) {
      if (p && p.cleared) {
        S.wallpaperAt = null; S.reveals = [];
        readLock(null);
        kvDel(KV_WALLPAPER); kvDel(KV_REVEALS); kvDel(KV_LOCK);
      }
      load().then(function () { if (S.active) render(); });
    });
    NC.bus.on('consents:change', function (c) { S.consents = c || S.consents; if (S.active) render(); });
    NC.bus.on('i18n:change', function () { if (S.active) render(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return;
      if (S.rs && S.rs.state === 'revealed') rehide();
      hideOwnerIdentity();
    });
    NC.i18n.apply(S.el);
  }

  function show(params) {
    var prevView = S.view;
    S.active = true;
    S.view = params && params.view === 'rescuer' ? 'rescuer' : 'owner';
    if (S.view === 'rescuer' && prevView !== 'rescuer') { stopRevealTimers(); S.rs = newRescuerState(); hideOwnerIdentity(true); armRescuerBack(); }
    if (S.view !== 'rescuer') { stopRevealTimers(); S.rs = null; releaseRescuerBack(); }
    render();
    var view = S.view;
    load().then(function () {
      if (!S.active || S.view !== view) return;
      render();
      setTimeout(function () {
        if (!S.active || S.view !== view) return;
        if (view === 'rescuer') { if (S.rsEl && !S.rsEl.contains(document.activeElement)) try { S.rsEl.focus({ preventScroll: true }); } catch (e) { S.rsEl.focus(); } }
        else if (S.rsReturn === 'tile') { S.rsReturn = null; focusAct('rescuer'); }
      }, 60);
    });
  }

  function hide() {
    S.active = false;
    hideOwnerIdentity(true);
    stopRevealTimers();
    S.rs = null;
    S.view = 'owner';
    releaseRescuerBack();
    setRescuerOpen(false);
  }

  NC.app.register('qr', {
    titleKey: 'app.title.qr', shortTitleKey: 'app.title_short.qr', mod: 'MOD.03', icon: 'qr',
    mount: mount, show: show, hide: hide
  });

  NC.qr = {
    matrix: matrix,
    svg: svg,
    wallpaper: wallpaper,
    openRescuer: openRescuer,
    printCard: printCard,
    gateIdentity: gateIdentityPublic
  };
})(window.NC = window.NC || {});
