/*
 * onboarding.js — first-run flow in #screen-onboarding (full-screen overlay, shown while !settings.onboarded):
 * 1 Welcome + UI language · 2 Trip (carrier, route, travel mode) · 3 Consents (terms / sensitive medical data per
 * Nghị định 356/2025/NĐ-CP / anonymous signal logs) · 4 Medical profile (4 required public fields, optional identity
 * layer, traveller language) · 5 Offline pack (bundled status + download latest) → settings.onboarded = true → home.
 * Each step is a history entry (#/onboarding?step=N[&replay=1]) so back returns to the previous step; steps past 3
 * need the terms consent on record. Unticking the medical consent over a stored profile = withdrawal (ask → delete).
 * Owner: P2 core-screens. Public API: NC.onboarding.{go(step), restart()}. Registers screen 'onboarding' + i18n ob.*.
 * Static skeleton: _partials/screen-onboarding.html (identical copy in SKELETON below, used only if missing).
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
  function asset(p) { return NC.ui && NC.ui.assetUrl ? NC.ui.assetUrl(p) : p; }
  var VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
  /** Escaped text; Vietnamese data (place names) shown in the EN UI is tagged lang="vi" for screen readers. */
  function viText(s) { var v = esc(s || ''); return v && lang() !== 'vi' && VI_CHARS.test(s) ? '<span lang="vi">' + v + '</span>' : v; }

  /* ================================================================== */
  /* i18n — ob.*                                                          */
  /* ================================================================== */
  if (NC.i18n) NC.i18n.add({
    vi: {
      'ob.aria': 'Thiết lập NomadCare', 'ob.progress': 'Tiến trình thiết lập', 'ob.step_of': 'Bước {n}/{total}',
      'ob.step.1': 'Chào mừng', 'ob.step.2': 'Chuyến đi', 'ob.step.3': 'Chấp thuận', 'ob.step.4': 'Hồ sơ y tế', 'ob.step.5': 'Gói offline',
      'ob.sos_aria': 'Khẩn cấp — gọi 115', 'ob.next': 'Tiếp tục', 'ob.back': 'Quay lại', 'ob.finish': 'Bắt đầu hành trình',
      'ob.later': 'Để sau', 'ob.skip_profile': 'Bỏ qua, điền sau ở Hồ sơ QR', 'ob.exit': 'Thoát',
      /* 1 */
      'ob.w.eyebrow': 'Chiếc phao sinh tồn kỹ thuật số',
      'ob.w.title': 'Chuẩn bị an toàn y tế cho chuyến đi, kể cả khi mất sóng',
      'ob.w.lead': 'NomadCare chuẩn bị sẵn mọi thứ khi bạn còn sóng. Ở vùng lõm sóng, bạn vẫn nói được với nhân viên y tế bằng câu dịch sẵn, cho họ xem hồ sơ y tế QR và làm theo hướng dẫn sơ cứu ngay trên máy.',
      'ob.w.roam': 'Cuộc gọi 115/112 có thể được chuyển qua mạng khác đang có sóng tại chỗ — nhưng không đảm bảo khi hoàn toàn không có sóng. Hãy luôn thử gọi trước.',
      'ob.w.v1_t': 'Dùng được khi không có mạng', 'ob.w.v1_d': 'Lộ trình và lớp sóng, dịch y tế, hồ sơ QR và sơ cứu hoạt động không cần mạng (ảnh nền bản đồ cần mạng).',
      'ob.w.v2_t': 'Biết trước vùng mất sóng', 'ob.w.v2_d': 'Lớp phủ sóng theo nhà mạng, cảnh báo trước khi bạn vào vùng lõm.',
      'ob.w.v3_t': 'Dữ liệu y tế ở lại trên máy', 'ob.w.v3_d': 'Mã hoá trên thiết bị, chỉ gửi đi khi bạn chọn kèm trong cảnh báo Buddy, xoá bằng một thao tác.',
      'ob.w.lang': 'Ngôn ngữ giao diện', 'ob.w.time': 'Mất khoảng 2 phút · không cần tài khoản',
      /* 2 */
      'ob.t.title': 'Chuyến đi của bạn', 'ob.t.lead': 'Chọn nhà mạng và cung đường để ứng dụng chỉ tải đúng dữ liệu bạn cần.',
      'ob.t.carrier': 'Nhà mạng', 'ob.t.carrier_hint': 'Lớp phủ sóng phụ thuộc nhà mạng — chỉ tải lớp của bạn.',
      'ob.t.route': 'Cung đường', 'ob.t.mode': 'Cách di chuyển',
      'ob.t.mode_hint': 'Dùng để tính thời gian tới vùng mất sóng: xe máy ~25 km/h, đi bộ ~3,5 km/h.',
      'ob.t.fac': '{n} điểm y tế xác thực', 'ob.t.selected': 'Đã chọn',
      /* 3 */
      'ob.c.title': 'Chấp thuận của bạn', 'ob.c.lead': 'Không mục nào được chọn sẵn. Bạn có thể thay đổi bất cứ lúc nào trong Cài đặt.',
      'ob.c.required': 'Bắt buộc', 'ob.c.separate': 'Chấp thuận riêng', 'ob.c.optional': 'Không bắt buộc',
      'ob.c.terms_t': 'Tôi đồng ý Điều khoản sử dụng và hiểu khuyến cáo y tế',
      'ob.c.terms_d': 'NomadCare hỗ trợ sơ cứu ban đầu và định hướng, không thay thế chẩn đoán, điều trị hay lực lượng cứu hộ. Trong mọi tình huống nguy hiểm, hãy gọi 115 trước.',
      'ob.c.terms_x': 'Dữ liệu cơ sở y tế, số điện thoại và lớp sóng trong bản demo là dữ liệu minh hoạ. Thứ tự cơ sở y tế chỉ dựa trên khoảng cách và năng lực đã xác thực, không bao giờ theo tài trợ. Cuộc gọi 115/112 có thể được chuyển qua mạng khác đang có sóng tại chỗ — nhưng không đảm bảo khi hoàn toàn không có sóng. Hãy luôn thử gọi trước.',
      'ob.c.sens_t': 'Tôi đồng ý cho ứng dụng xử lý dữ liệu y tế nhạy cảm của tôi',
      'ob.c.sens_d': 'Nhóm máu, dị ứng, bệnh nền và thuốc đang dùng là dữ liệu cá nhân nhạy cảm theo Nghị định 356/2025/NĐ-CP.',
      'ob.c.sens_x1': 'Lưu mã hoá trên máy này (AES-GCM 256-bit), khoá mã không rời trình duyệt.',
      'ob.c.sens_x2': 'Không tự động tải lên máy chủ. Chỉ lớp công khai (nhóm máu, dị ứng, bệnh nền, thuốc) mà bạn chủ động chọn kèm trong cảnh báo Buddy mới được gửi đi.',
      'ob.c.sens_x3': 'Xem, sửa và xoá toàn bộ bằng một thao tác trong Cài đặt.',
      'ob.c.sens_need': 'Cần cho hồ sơ y tế QR',
      'ob.c.logs_t': 'Đóng góp log sóng ẩn danh',
      'ob.c.logs_d': 'Gửi mức sóng và toạ độ khi di chuyển để cải thiện lớp phủ sóng cho cộng đồng.',
      'ob.c.logs_x': 'Chỉ gồm toạ độ, thời điểm, nhà mạng và mức sóng — không kèm danh tính hay dữ liệu y tế. Quản trị viên duyệt trước khi dùng. Tắt bất cứ lúc nào.',
      'ob.c.need_terms': 'Hãy đồng ý mục bắt buộc để tiếp tục.', 'ob.c.saved': 'Đã lưu chấp thuận lúc {time}',
      'ob.c.location': 'Vị trí: ứng dụng xin quyền khi mở và dùng vị trí ngay trên máy để định tuyến. Vị trí chỉ rời máy khi bạn bật Buddy, gửi SOS/toạ độ, bật đóng góp log sóng, gửi báo cáo điểm y tế hoặc đồng ý tìm đường trực tuyến.',
      'ob.c.has_profile': 'Bạn đã lưu hồ sơ y tế. Bỏ chọn mục này rồi nhấn Tiếp tục sẽ xoá hồ sơ khỏi máy (có hỏi lại).',
      'ob.c.withdraw_title': 'Rút lại đồng ý và xoá hồ sơ y tế?', 'ob.c.withdraw_msg': 'Hồ sơ y tế bạn đã lưu (nhóm máu, dị ứng, bệnh nền, thuốc và lớp định danh) sẽ bị xoá khỏi máy này.',
      'ob.c.withdraw_ok': 'Rút lại & xoá hồ sơ', 'ob.c.withdrawn': 'Đã xoá hồ sơ y tế khỏi máy này.',
      /* 4 */
      'ob.p.title': 'Hồ sơ y tế khẩn cấp', 'ob.p.lead': 'Chỉ 4 trường bắt buộc — đủ để nhân viên y tế xử trí an toàn. Không định danh bạn là ai.',
      'ob.p.public': 'Lớp công khai · quét được khi máy khoá',
      'ob.p.blood': 'Nhóm máu', 'ob.p.blood_unknown': 'Không rõ',
      'ob.p.allergies': 'Dị ứng', 'ob.p.allergies_ph': 'VD: Penicillin, hải sản',
      'ob.p.conditions': 'Bệnh nền', 'ob.p.conditions_ph': 'VD: Hen suyễn, tiểu đường',
      'ob.p.medications': 'Thuốc đang dùng', 'ob.p.medications_ph': 'VD: Ventolin xịt khi khó thở',
      'ob.p.none': 'Không có', 'ob.p.none_value': 'Không có / None',
      'ob.p.identity': 'Lớp định danh (không bắt buộc)',
      'ob.p.identity_d': 'Chỉ hiện sau khi người cứu hộ nhấn giữ xác nhận (hoặc nhập mã 4 số). Ứng dụng không có trường số CCCD/hộ chiếu.',
      'ob.p.full_name': 'Họ tên', 'ob.p.nationality': 'Quốc tịch', 'ob.p.contact_name': 'Người liên hệ khẩn cấp',
      'ob.p.contact_phone': 'SĐT người liên hệ', 'ob.p.reveal_code': 'Mã hiện định danh (4 số, tuỳ chọn)',
      'ob.p.reveal_hint': 'Nếu đặt mã, người cứu hộ cần nhập mã để xem lớp định danh.',
      'ob.p.id_locked': 'Lớp định danh đã lưu và được bảo vệ bằng mã hiện định danh nên không hiện ở đây. Xem hoặc sửa trong Hồ sơ QR.',
      'ob.p.code_err': 'Mã gồm đúng 4 chữ số.', 'ob.p.required_err': 'Vui lòng điền trường này (hoặc chọn “Không có”).',
      'ob.p.blood_err': 'Chọn nhóm máu (hoặc “Không rõ”).', 'ob.p.missing': 'Còn thiếu {n} trường bắt buộc.',
      'ob.p.saved': 'Hồ sơ đã được mã hoá và lưu trên máy.', 'ob.p.save_failed': 'Chưa lưu được hồ sơ. Thử lại.',
      'ob.p.userlang': 'Ngôn ngữ của bạn', 'ob.p.userlang_d': 'Màn hình “Nói với nhân viên y tế” hiện tiếng Việt cho nhân viên và ngôn ngữ này cho bạn.',
      'ob.p.no_consent_t': 'Hồ sơ y tế cần chấp thuận riêng',
      'ob.p.no_consent_d': 'Bạn chưa đồng ý xử lý dữ liệu y tế nhạy cảm, nên ứng dụng không lưu nhóm máu, dị ứng, bệnh nền hay thuốc. Bạn vẫn dùng được bản đồ, dịch y tế, sơ cứu và Buddy.',
      'ob.p.give_consent': 'Quay lại để đồng ý', 'ob.p.encrypted': 'Mã hoá trên máy', 'ob.p.not_encrypted': 'Trình duyệt này không hỗ trợ mã hoá — dữ liệu chỉ được lưu cục bộ, chưa mã hoá.',
      /* 5 */
      'ob.k.title': 'Gói dữ liệu offline', 'ob.k.lead': 'Tải khi còn sóng — khi vào vùng lõm, mọi thứ đã nằm sẵn trong máy.',
      'ob.k.bundled_t': 'Đã cài sẵn gói nhẹ cho {n} tuyến', 'ob.k.bundled_d': 'Bản đồ tuyến, lớp sóng 3 nhà mạng và điểm y tế đã xác thực — dùng được ngay, không cần mạng.',
      'ob.k.latest_t': 'Gói hành lang mới nhất', 'ob.k.latest_d': '{route} · {carrier}',
      'ob.k.download': 'Tải gói mới nhất', 'ob.k.downloading': 'Đang tải gói dữ liệu…', 'ob.k.downloaded': 'Đã lưu offline · {size}',
      'ob.k.redownload': 'Tải lại', 'ob.k.offline': 'Đang offline — bạn vẫn dùng được gói cài kèm. Hãy tải bản mới nhất khi có sóng (Cài đặt → Gói dữ liệu).',
      'ob.k.failed': 'Chưa tải được gói. Gói cài kèm vẫn dùng được.', 'ob.k.done_toast': 'Đã tải gói {route} · {carrier}.',
      'ob.k.summary': 'Tóm tắt thiết lập', 'ob.k.sum_trip': 'Chuyến đi', 'ob.k.sum_consent': 'Chấp thuận', 'ob.k.sum_profile': 'Hồ sơ y tế',
      'ob.k.sum_consent_v': 'Điều khoản ✓ · Dữ liệu y tế {s} · Log sóng {l}',
      'ob.k.sum_profile_ok': 'Đủ 4 trường · đã mã hoá', 'ob.k.sum_profile_no': 'Chưa có — điền sau ở Hồ sơ QR',
      'ob.k.yes': 'có', 'ob.k.no': 'không',
      'ob.k.welcome': 'Sẵn sàng! Chúc bạn thượng lộ bình an.',
      'ob.art.1': 'Nói được với nhân viên y tế bằng một chạm — tiếng Việt lớn cho họ, ngôn ngữ của bạn ngay bên dưới.',
      'ob.art.2': 'Biết đoạn nào sẽ mất sóng trước khi đi, theo đúng nhà mạng của bạn.',
      'ob.art.3': 'Bạn quyết định dữ liệu nào được xử lý. Dữ liệu y tế ở lại trên máy, trừ khi bạn chọn chia sẻ.',
      'ob.art.4': 'Lớp công khai quét được khi máy khoá. Lớp định danh chỉ hiện sau khi xác nhận.',
      'ob.art.5': 'Một lần tải khi còn sóng — cả chuyến đi dùng offline.'
    },
    en: {
      'ob.aria': 'Set up NomadCare', 'ob.progress': 'Setup progress', 'ob.step_of': 'Step {n} of {total}',
      'ob.step.1': 'Welcome', 'ob.step.2': 'Your trip', 'ob.step.3': 'Consent', 'ob.step.4': 'Medical profile', 'ob.step.5': 'Offline pack',
      'ob.sos_aria': 'Emergency — call 115', 'ob.next': 'Continue', 'ob.back': 'Back', 'ob.finish': 'Start your journey',
      'ob.later': 'Later', 'ob.skip_profile': 'Skip — fill it in later under QR profile', 'ob.exit': 'Exit',
      'ob.w.eyebrow': 'Your digital survival lifeline',
      'ob.w.title': 'Medical safety prep for your trip, even without signal',
      'ob.w.lead': 'NomadCare gets everything ready while you still have signal. In a dead zone you can still talk to medical staff with ready-made phrases, show them your QR medical profile and follow first aid right on your phone.',
      'ob.w.roam': 'Emergency calls to 115/112 may roam onto any network with signal where you are — but this is not guaranteed when there is no signal at all. Always try calling first.',
      'ob.w.v1_t': 'Works without a network', 'ob.w.v1_d': 'Routes and signal layers, medical phrases, QR profile and first aid need no network (map background tiles do).',
      'ob.w.v2_t': 'Know the dead zones ahead', 'ob.w.v2_d': 'Coverage per carrier, with a warning before you lose signal.',
      'ob.w.v3_t': 'Medical data stays on your phone', 'ob.w.v3_d': 'Encrypted on the device, only sent if you choose to include it in a Buddy alert, deleted in one step.',
      'ob.w.lang': 'App language', 'ob.w.time': 'Takes about 2 minutes · no account needed',
      'ob.t.title': 'Your trip', 'ob.t.lead': 'Pick your carrier and route so the app downloads only the data you need.',
      'ob.t.carrier': 'Mobile carrier', 'ob.t.carrier_hint': 'Coverage depends on the carrier — only your layer is downloaded.',
      'ob.t.route': 'Route', 'ob.t.mode': 'How you travel',
      'ob.t.mode_hint': 'Used to estimate the time to the next dead zone: motorbike ~25 km/h, hiking ~3.5 km/h.',
      'ob.t.fac': '{n} verified medical points', 'ob.t.selected': 'Selected',
      'ob.c.title': 'Your consent', 'ob.c.lead': 'Nothing is pre-selected. You can change any of this later in Settings.',
      'ob.c.required': 'Required', 'ob.c.separate': 'Separate consent', 'ob.c.optional': 'Optional',
      'ob.c.terms_t': 'I accept the Terms of Use and understand the medical notice',
      'ob.c.terms_d': 'NomadCare supports first aid and orientation; it does not replace diagnosis, treatment or rescue services. In any dangerous situation, call 115 first.',
      'ob.c.terms_x': 'Facilities, phone numbers and signal layers in this demo are illustrative. Medical facilities are ordered only by distance and verified capability, never by sponsorship. Emergency calls to 115/112 may roam onto any network with signal where you are — but this is not guaranteed when there is no signal at all. Always try calling first.',
      'ob.c.sens_t': 'I consent to the app processing my sensitive medical data',
      'ob.c.sens_d': 'Blood type, allergies, conditions and medications are sensitive personal data under Vietnam’s Decree 356/2025/NĐ-CP.',
      'ob.c.sens_x1': 'Stored encrypted on this device (AES-GCM 256-bit); the key never leaves the browser.',
      'ob.c.sens_x2': 'Not uploaded automatically. Only the public layer (blood type, allergies, conditions, medications) that you explicitly include in a Buddy alert is ever sent.',
      'ob.c.sens_x3': 'View, edit and delete everything in one step from Settings.',
      'ob.c.sens_need': 'Needed for the QR medical profile',
      'ob.c.logs_t': 'Contribute anonymous signal logs',
      'ob.c.logs_d': 'Share signal level and location while travelling to improve coverage maps for everyone.',
      'ob.c.logs_x': 'Only coordinates, time, carrier and signal level — no identity and no medical data. Reviewed by an admin before use. Turn it off at any time.',
      'ob.c.need_terms': 'Please accept the required item to continue.', 'ob.c.saved': 'Consent saved at {time}',
      'ob.c.location': 'Location: the app asks for permission when it opens and uses your position on this device for routing. It only leaves the device when you turn on Buddy, send an SOS / your coordinates, turn on signal-log sharing, send a medical-point report, or agree to online route search.',
      'ob.c.has_profile': 'You already saved a medical profile. Unticking this and pressing Continue deletes it from this device (you will be asked first).',
      'ob.c.withdraw_title': 'Withdraw consent and delete the medical profile?', 'ob.c.withdraw_msg': 'The medical profile you saved (blood type, allergies, conditions, medications and identity layer) will be deleted from this device.',
      'ob.c.withdraw_ok': 'Withdraw & delete profile', 'ob.c.withdrawn': 'Medical profile deleted from this device.',
      'ob.p.title': 'Emergency medical profile', 'ob.p.lead': 'Just 4 required fields — enough for medical staff to treat you safely. Nothing identifies who you are.',
      'ob.p.public': 'Public layer · scannable on the lock screen',
      'ob.p.blood': 'Blood type', 'ob.p.blood_unknown': 'Unknown',
      'ob.p.allergies': 'Allergies', 'ob.p.allergies_ph': 'e.g. Penicillin, shellfish',
      'ob.p.conditions': 'Conditions', 'ob.p.conditions_ph': 'e.g. Asthma, diabetes',
      'ob.p.medications': 'Current medications', 'ob.p.medications_ph': 'e.g. Ventolin inhaler when short of breath',
      'ob.p.none': 'None', 'ob.p.none_value': 'Không có / None',
      'ob.p.identity': 'Identity layer (optional)',
      'ob.p.identity_d': 'Shown only after a rescuer press-and-holds to confirm (or enters a 4-digit code). There is no ID or passport number field.',
      'ob.p.full_name': 'Full name', 'ob.p.nationality': 'Nationality', 'ob.p.contact_name': 'Emergency contact',
      'ob.p.contact_phone': 'Contact phone', 'ob.p.reveal_code': 'Reveal code (4 digits, optional)',
      'ob.p.reveal_hint': 'If set, rescuers must enter the code to see the identity layer.',
      'ob.p.id_locked': 'Your identity layer is saved and protected by your identity code, so it is not shown here. View or edit it in the QR profile.',
      'ob.p.code_err': 'The code must be exactly 4 digits.', 'ob.p.required_err': 'Please fill this in (or choose “None”).',
      'ob.p.blood_err': 'Choose a blood type (or “Unknown”).', 'ob.p.missing': '{n} required fields missing.',
      'ob.p.saved': 'Profile encrypted and saved on this device.', 'ob.p.save_failed': "Couldn't save the profile. Try again.",
      'ob.p.userlang': 'Your language', 'ob.p.userlang_d': 'The “Talk to medical staff” screen shows Vietnamese for staff and this language for you.',
      'ob.p.no_consent_t': 'The medical profile needs separate consent',
      'ob.p.no_consent_d': "You haven't consented to sensitive medical data processing, so the app does not store blood type, allergies, conditions or medications. Map, phrases, first aid and Buddy still work.",
      'ob.p.give_consent': 'Go back and consent', 'ob.p.encrypted': 'Encrypted on device', 'ob.p.not_encrypted': 'This browser cannot encrypt — data is stored locally without encryption.',
      'ob.k.title': 'Offline data pack', 'ob.k.lead': 'Download while you have signal — in a dead zone, everything is already on your phone.',
      'ob.k.bundled_t': 'Light pack for {n} routes already installed', 'ob.k.bundled_d': 'Route maps, signal layers for 3 carriers and verified medical points — ready now, no network needed.',
      'ob.k.latest_t': 'Latest corridor pack', 'ob.k.latest_d': '{route} · {carrier}',
      'ob.k.download': 'Download latest pack', 'ob.k.downloading': 'Downloading data pack…', 'ob.k.downloaded': 'Saved offline · {size}',
      'ob.k.redownload': 'Download again', 'ob.k.offline': "You're offline — the bundled pack still works. Download the latest when you have signal (Settings → Data packs).",
      'ob.k.failed': "Couldn't download the pack. The bundled pack still works.", 'ob.k.done_toast': 'Downloaded {route} · {carrier}.',
      'ob.k.summary': 'Setup summary', 'ob.k.sum_trip': 'Trip', 'ob.k.sum_consent': 'Consent', 'ob.k.sum_profile': 'Medical profile',
      'ob.k.sum_consent_v': 'Terms ✓ · Medical data {s} · Signal logs {l}',
      'ob.k.sum_profile_ok': 'All 4 fields · encrypted', 'ob.k.sum_profile_no': 'Not yet — fill it in later under QR profile',
      'ob.k.yes': 'yes', 'ob.k.no': 'no',
      'ob.k.welcome': "All set! Have a safe journey.",
      'ob.art.1': 'Talk to medical staff in one tap — large Vietnamese for them, your language right below.',
      'ob.art.2': 'Know which stretches lose signal before you set off, for your own carrier.',
      'ob.art.3': 'You decide what gets processed. Medical data stays on your phone unless you choose to share it.',
      'ob.art.4': 'The public layer scans on the lock screen. Identity appears only after confirmation.',
      'ob.art.5': 'Download once with signal — use it offline for the whole trip.'
    }
  });

  /* ================================================================== */
  /* Static skeleton (same markup as _partials/screen-onboarding.html)    */
  /* ================================================================== */
  var SKELETON = [
    '<div class="ob" id="ob-root" data-step="1">',
    '  <aside class="ob-art" aria-hidden="true">',
    '    <div class="ob-art__brand"><img src="assets/img/logo.svg" alt="" width="40" height="40"><span>Nomad<b>Care</b></span></div>',
    '    <figure class="ob-art__fig">',
    '      <img class="ob-art__img" id="ob-art-img" src="assets/img/illustrations/onboarding-phrase-card.svg" alt="" width="320" height="240">',
    '      <figcaption class="ob-art__text" id="ob-art-text"></figcaption>',
    '    </figure>',
    '    <ol class="ob-art__steps" id="ob-art-steps"></ol>',
    '  </aside>',
    '  <div class="ob-panel" role="region" data-i18n-attr="aria-label:ob.aria" aria-label="Thiết lập NomadCare">',
    '    <header class="ob-head">',
    '      <span class="ob-head__brand"><img src="assets/img/logo.svg" alt="" width="32" height="32"><span class="ob-head__name">Nomad<b>Care</b></span></span>',
    '      <ol class="ob-dots" id="ob-dots" data-i18n-attr="aria-label:ob.progress" aria-label="Tiến trình thiết lập"></ol>',
    '      <button class="ob-sos" type="button" data-action="emergency" data-i18n-attr="aria-label:ob.sos_aria;title:ob.sos_aria" aria-label="Khẩn cấp — gọi 115">',
    '        <svg class="icon" aria-hidden="true"><use href="#i-siren"></use></svg><span>115</span>',
    '      </button>',
    '    </header>',
    '    <div class="ob-body" id="ob-body" tabindex="-1" aria-live="polite"></div>',
    '    <footer class="ob-nav">',
    '      <button class="btn btn--ghost ob-nav__back" id="ob-back" type="button">',
    '        <svg class="icon" aria-hidden="true"><use href="#i-arrow-left"></use></svg><span data-i18n="ob.back">Quay lại</span>',
    '      </button>',
    '      <span class="ob-nav__step" id="ob-step-label"></span>',
    '      <button class="btn btn--primary btn--lg ob-nav__next" id="ob-next" type="button">',
    '        <span id="ob-next-label" data-i18n="ob.next">Tiếp tục</span><svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg>',
    '      </button>',
    '    </footer>',
    '  </div>',
    '</div>'
  ].join('\n');

  /* ================================================================== */
  /* State                                                                */
  /* ================================================================== */
  var TOTAL = 5;
  var ART = ['onboarding-phrase-card.svg', 'onboarding-offline-map.svg', 'onboarding-buddy.svg', 'onboarding-qr-lock.svg', 'onboarding-offline-map.svg'];
  var CARRIERS = [{ id: 'viettel', name: 'Viettel' }, { id: 'vinaphone', name: 'VinaPhone' }, { id: 'mobifone', name: 'MobiFone' }];
  var FIELDS = ['allergies', 'conditions', 'medications'];
  var ID_FIELDS = ['full_name', 'nationality', 'contact_name', 'contact_phone', 'reveal_code'];

  var root = null, body = null;
  var step = 1;
  var lastToast = null;
  function blankConsents() { return { terms: false, sensitive: false, community_logs: false }; }
  function blankProfile() {
    return { public: { blood_type: '', allergies: '', conditions: '', medications: '', notes: '' },
      identity: { full_name: '', nationality: '', contact_name: '', contact_phone: '', reveal_code: '' } };
  }
  var st = {
    consents: blankConsents(),   // what the step-3 checkboxes show (unsaved until Continue)
    saved: blankConsents(),      // what is persisted (NC.profile.consents)
    profile: blankProfile(),
    identityOpen: false, profileSaved: false, hasProfile: false, errors: {}, showNeed: false,
    idLocked: false,             // stored identity is behind a reveal code → never loaded into this form (NOTES §6)
    routes: null, pack: null, dl: null, dlBusy: false, dlErr: false
  };
  /*
   * History: every step is its own history entry (#/onboarding?step=N, pushed through the router) so browser /
   * Android back returns to the previous step. Each entry is tagged in history.state (key HKEY, other keys kept)
   * with {sid, idx} so we always know how many of our entries sit below the current one — finish() rewinds them
   * and replaces the first with #/home, so back from home leaves the app instead of re-entering onboarding.
   */
  var HKEY = 'ncOb';
  var nav = { session: false, sid: '', idx: 0, steps: {}, replay: false, leaving: false };

  function carrierName(id) {
    if (NC.app && NC.app.carrierName) return NC.app.carrierName(id);
    var c = CARRIERS.filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }
  function routeLabel(r) { return r ? (lang() === 'en' && r.name_en ? r.name_en : r.name) : '—'; }
  function seedRoutes() {
    var S0 = window.NC_SEED;
    return S0 && S0.routes ? S0.routes.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); }) : [];
  }
  function routesList() {
    var base = seedRoutes();
    if (st.routes && st.routes.length) {
      return base.length ? base.map(function (r) {
        var x = st.routes.filter(function (y) { return y.id === r.id; })[0];
        return x ? Object.assign({}, r, x) : r;
      }) : st.routes;
    }
    return base;
  }
  function currentRoute() {
    var id = S('route_id');
    return routesList().filter(function (r) { return r.id === id; })[0] || null;
  }

  /* ================================================================== */
  /* Rendering                                                            */
  /* ================================================================== */
  function renderChrome() {
    root.setAttribute('data-step', String(step));
    var dots = root.querySelector('#ob-dots');
    if (dots) {
      var html = '';
      for (var i = 1; i <= TOTAL; i++) {
        var cls = i < step ? 'is-done' : i === step ? 'is-current' : '';
        html += '<li class="ob-dots__dot ' + cls + '"' + (i === step ? ' aria-current="step"' : '') + '><span class="visually-hidden">' +
          esc(t('ob.step_of', { n: i, total: TOTAL }) + ' — ' + t('ob.step.' + i)) + '</span></li>';
      }
      dots.innerHTML = html;
    }
    var steps = root.querySelector('#ob-art-steps');
    if (steps) {
      var sh = '';
      for (var j = 1; j <= TOTAL; j++) {
        sh += '<li class="' + (j < step ? 'is-done' : j === step ? 'is-current' : '') + '" title="' + esc(t('ob.step.' + j)) + '"><span class="ob-art__num">' + (j < step ? icon('check', 'icon--xs') : j) + '</span><span class="ob-art__label">' + esc(t('ob.step.' + j)) + '</span></li>';
      }
      steps.innerHTML = sh;
    }
    var img = root.querySelector('#ob-art-img');
    if (img) { var src = asset('assets/img/illustrations/' + ART[step - 1]); if (img.getAttribute('src') !== src) img.setAttribute('src', src); }
    var at = root.querySelector('#ob-art-text');
    if (at) at.textContent = t('ob.art.' + step);
    var label = root.querySelector('#ob-step-label');
    if (label) label.textContent = t('ob.step_of', { n: step, total: TOTAL });
    var back = root.querySelector('#ob-back');
    if (back) {
      // Step 1 has no previous step; a replay (from Settings) can still be left from there.
      back.hidden = step === 1 && !nav.replay;
      var bl = back.querySelector('span');
      if (bl) { bl.removeAttribute('data-i18n'); bl.textContent = t(step === 1 ? 'ob.exit' : 'ob.back'); }
    }
    updateNext();
  }

  function updateNext() {
    var next = root.querySelector('#ob-next'), lab = root.querySelector('#ob-next-label');
    if (!next) return;
    if (lab) { lab.removeAttribute('data-i18n'); lab.textContent = step === TOTAL ? t('ob.finish') : t('ob.next'); }
    var blocked = step === 3 && !st.consents.terms;
    next.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    next.classList.toggle('is-blocked', blocked);
    next.classList.toggle('ob-nav__next--finish', step === TOTAL);
  }

  function render(focus) {
    if (!root) return;
    renderChrome();
    var html = '';
    if (step === 1) html = stepWelcome();
    else if (step === 2) html = stepTrip();
    else if (step === 3) html = stepConsent();
    else if (step === 4) html = stepProfile();
    else html = stepPack();
    body.innerHTML = '<div class="ob-step ob-step--' + step + '">' + html + '</div>';
    wireStep();
    if (focus) {
      var hd = body.querySelector('.ob-step__title');
      if (hd) { hd.setAttribute('tabindex', '-1'); try { hd.focus({ preventScroll: true }); } catch (e) { hd.focus(); } }
      body.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }

  function artImg(i, cls) {
    return '<img class="ob-step__art ' + (cls || '') + '" src="' + esc(asset('assets/img/illustrations/' + ART[i - 1])) + '" alt="" width="320" height="240">';
  }
  function head(eyebrow, title, lead) {
    return '<p class="ob-step__eyebrow">' + esc(eyebrow) + '</p>' +
      '<h1 class="ob-step__title">' + esc(title) + '</h1>' +
      (lead ? '<p class="ob-step__lead">' + esc(lead) + '</p>' : '');
  }

  /* ---------- 1 · welcome ---------- */
  function stepWelcome() {
    var l = lang();
    var props = [['wifi-off', 'v1', 'primary'], ['signal', 'v2', 'info'], ['lock', 'v3', 'accent']];
    return artImg(1, 'ob-step__art--hero') +
      '<div class="ob-field ob-field--lang">' +
        '<p class="visually-hidden" id="ob-lang-label">' + esc(t('ob.w.lang')) + '</p>' +
        '<div class="segmented ob-lang" role="radiogroup" aria-labelledby="ob-lang-label" data-ob="lang">' +
          '<button type="button" class="segmented__btn' + (l === 'vi' ? ' is-selected' : '') + '" data-value="vi" lang="vi">' + icon('languages') + '<span>Tiếng Việt</span></button>' +
          '<button type="button" class="segmented__btn' + (l === 'en' ? ' is-selected' : '') + '" data-value="en" lang="en"><span>English</span></button>' +
        '</div>' +
      '</div>' +
      head(t('ob.w.eyebrow'), t('ob.w.title'), t('ob.w.lead')) +
      '<ul class="ob-props">' + props.map(function (p) {
        return '<li class="ob-prop"><span class="icon-tile icon-tile--' + p[2] + '">' + icon(p[0]) + '</span>' +
          '<span class="ob-prop__text"><b>' + esc(t('ob.w.' + p[1] + '_t')) + '</b><span>' + esc(t('ob.w.' + p[1] + '_d')) + '</span></span></li>';
      }).join('') + '</ul>' +
      '<p class="ob-hint ob-roam">' + icon('phone-call', 'icon--xs') + '<span>' + esc(t('ob.w.roam')) + '</span></p>' +
      '<p class="ob-step__note">' + icon('clock', 'icon--xs') + esc(t('ob.w.time')) + '</p>';
  }

  /* ---------- 2 · trip ---------- */
  function stepTrip() {
    var car = S('carrier'), rid = S('route_id'), mode = S('travel_mode');
    var cards = CARRIERS.map(function (c) {
      var on = c.id === car;
      return '<button type="button" class="ob-choice ob-carrier ob-carrier--' + c.id + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-ob="carrier" data-value="' + c.id + '">' +
        '<span class="ob-carrier__dot" aria-hidden="true"></span><span class="ob-carrier__name">' + esc(carrierName(c.id)) + '</span>' +
        '<span class="ob-choice__check" aria-hidden="true">' + icon('check') + '</span></button>';
    }).join('');
    var routes = routesList().map(function (r) {
      var on = r.id === rid;
      var fac = r.verified_facilities !== undefined ? r.verified_facilities :
        ((window.NC_SEED && window.NC_SEED.facilities) || []).filter(function (f) { return f.route_id === r.id && f.status === 'verified'; }).length;
      return '<button type="button" class="ob-choice ob-route' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-ob="route" data-value="' + esc(r.id) + '" data-mode="' + esc(r.travel_mode || '') + '">' +
        '<span class="icon-tile icon-tile--' + (r.travel_mode === 'hiking' ? 'success' : 'info') + '">' + icon(r.travel_mode === 'hiking' ? 'footprints' : 'bike') + '</span>' +
        '<span class="ob-route__body"><span class="ob-route__name">' + esc(routeLabel(r)) + '</span>' +
        '<span class="ob-route__meta">' + (lang() === 'en' && r.region_en && r.region_en !== r.region ? esc(r.region_en) : viText(r.region)) + '</span>' +
        '<span class="ob-route__tags"><span>' + icon('route', 'icon--xs') + esc(U.fmtKm(+r.length_km)) + '</span>' +
        '<span>' + icon('hospital', 'icon--xs') + esc(t('ob.t.fac', { n: fac })) + '</span></span></span>' +
        '<span class="ob-choice__check" aria-hidden="true">' + icon('check') + '</span></button>';
    }).join('');
    return artImg(2) + head(t('ob.step_of', { n: 2, total: TOTAL }), t('ob.t.title'), t('ob.t.lead')) +
      '<div class="ob-field"><p class="ob-field__label" id="ob-car-label">' + icon('signal', 'icon--sm') + esc(t('ob.t.carrier')) + '</p>' +
        '<div class="ob-carriers" role="radiogroup" aria-labelledby="ob-car-label">' + cards + '</div>' +
        '<p class="ob-hint">' + icon('info', 'icon--xs') + esc(t('ob.t.carrier_hint')) + '</p></div>' +
      '<div class="ob-field"><p class="ob-field__label" id="ob-route-label">' + icon('route', 'icon--sm') + esc(t('ob.t.route')) + '</p>' +
        '<div class="ob-routes" role="radiogroup" aria-labelledby="ob-route-label">' + routes + '</div></div>' +
      '<div class="ob-field"><p class="ob-field__label" id="ob-mode-label">' + icon('navigation', 'icon--sm') + esc(t('ob.t.mode')) + '</p>' +
        '<div class="segmented segmented--lg" role="radiogroup" aria-labelledby="ob-mode-label" data-ob="mode">' +
          '<button type="button" class="segmented__btn' + (mode !== 'hiking' ? ' is-selected' : '') + '" data-value="motorbike">' + icon('bike') + '<span>' + esc(t('home.mode.motorbike')) + '</span></button>' +
          '<button type="button" class="segmented__btn' + (mode === 'hiking' ? ' is-selected' : '') + '" data-value="hiking">' + icon('footprints') + '<span>' + esc(t('home.mode.hiking')) + '</span></button>' +
        '</div><p class="ob-hint">' + icon('clock', 'icon--xs') + esc(t('ob.t.mode_hint')) + '</p></div>';
  }

  /* ---------- 3 · consent ---------- */
  function consentCard(key, tag, tagVariant, title, desc, details) {
    var on = !!st.consents[key];
    var id = 'ob-c-' + key;
    return '<div class="ob-consent ob-consent--' + key + (on ? ' is-checked' : '') + '">' +
      '<label class="ob-consent__main" for="' + id + '">' +
        '<input type="checkbox" id="' + id + '" data-ob="consent" data-key="' + key + '"' + (on ? ' checked' : '') + ' aria-describedby="' + id + '-d">' +
        '<span class="ob-consent__box" aria-hidden="true">' + icon('check') + '</span>' +
        '<span class="ob-consent__text"><span class="badge badge--' + tagVariant + '">' + esc(tag) + '</span>' +
        '<b>' + esc(title) + '</b><span id="' + id + '-d">' + esc(desc) + '</span></span>' +
      '</label>' +
      // "Chi tiết": the shared .disclosure (components.css) — same look as every other "Xem thêm" in the app.
      '<details class="disclosure ob-consent__more"><summary class="disclosure__sum"><span class="disclosure__txt"><span class="disclosure__title">' + esc(t('common.details')) + '</span></span>' +
        '<span class="disclosure__chev" aria-hidden="true">' + icon('chevron-down', 'icon--sm') + '</span></summary><div class="disclosure__body">' + details + '</div></details>' +
    '</div>';
  }
  function stepConsent() {
    var sensList = '<ul class="ob-bullets">' + ['sens_x1', 'sens_x2', 'sens_x3'].map(function (k, i) {
      return '<li>' + icon(['lock', 'cloud-off', 'trash'][i], 'icon--sm') + '<span>' + esc(t('ob.c.' + k)) + '</span></li>';
    }).join('') + '</ul>';
    return artImg(3) + head(t('ob.step_of', { n: 3, total: TOTAL }), t('ob.c.title'), t('ob.c.lead')) +
      '<p class="ob-need" id="ob-need" role="alert"' + (st.showNeed ? '' : ' hidden') + '>' + icon('alert-circle', 'icon--sm') + esc(t('ob.c.need_terms')) + '</p>' +
      '<div class="ob-consents">' +
        consentCard('terms', t('ob.c.required'), 'danger', t('ob.c.terms_t'), t('ob.c.terms_d'), '<p>' + esc(t('ob.c.terms_x')) + '</p>') +
        consentCard('sensitive', t('ob.c.separate'), 'primary', t('ob.c.sens_t'), t('ob.c.sens_d'), sensList + '<p class="ob-consent__need">' + icon('qr', 'icon--xs') + esc(t('ob.c.sens_need')) + '</p>') +
        '<p class="ob-hint ob-hint--warn ob-sens-warn" id="ob-sens-warn" role="status"' + (st.hasProfile && !st.consents.sensitive ? '' : ' hidden') + '>' +
          icon('alert-triangle', 'icon--xs') + '<span>' + esc(t('ob.c.has_profile')) + '</span></p>' +
        consentCard('community_logs', t('ob.c.optional'), 'neutral', t('ob.c.logs_t'), t('ob.c.logs_d'), '<p>' + esc(t('ob.c.logs_x')) + '</p>') +
      '</div>' +
      '<p class="ob-hint ob-loc-note">' + icon('map-pin', 'icon--xs') + '<span>' + esc(t('ob.c.location')) + '</span></p>';
  }

  /* ---------- 4 · profile ---------- */
  function userLangField() {
    var ul = S('user_lang') || 'en';
    var L = ((window.NC_PHRASES && window.NC_PHRASES.languages) || [{ code: 'en', name: 'English', name_en: 'English' }]).filter(function (x) { return x.code !== 'vi'; });
    return '<div class="ob-field"><p class="ob-field__label" id="ob-ul-label">' + icon('languages', 'icon--sm') + esc(t('ob.p.userlang')) + '</p>' +
      '<div class="chip-group ob-ul" role="radiogroup" aria-labelledby="ob-ul-label">' + L.map(function (x) {
        var on = x.code === ul;
        return '<button type="button" class="chip chip--lg' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-ob="ulang" data-value="' + esc(x.code) + '" lang="' + esc(x.code) + '">' +
          esc(x.name) + (x.name !== x.name_en && lang() === 'en' ? ' <small>· ' + esc(x.name_en) + '</small>' : '') + '</button>';
      }).join('') + '</div><p class="ob-hint">' + icon('info', 'icon--xs') + esc(t('ob.p.userlang_d')) + '</p></div>';
  }
  function textField(k) {
    var v = st.profile.public[k] || '';
    var none = t('ob.p.none_value');
    var err = st.errors[k];
    return '<div class="field ob-pfield' + (err ? ' is-invalid' : '') + '">' +
      '<label class="field__label" for="ob-p-' + k + '">' + esc(t('ob.p.' + k)) + '<span class="req" aria-hidden="true">*</span></label>' +
      '<div class="ob-pfield__row"><input class="input" id="ob-p-' + k + '" type="text" autocomplete="off" maxlength="200" data-ob="pub" data-key="' + k + '" value="' + esc(v) + '" placeholder="' + esc(t('ob.p.' + k + '_ph')) + '" aria-required="true"' + (err ? ' aria-invalid="true" aria-describedby="ob-p-' + k + '-e"' : '') + '>' +
      '<button type="button" class="chip ob-none' + (v === none ? ' is-selected' : '') + '" aria-pressed="' + (v === none) + '" data-ob="none" data-key="' + k + '">' + esc(t('ob.p.none')) + '</button></div>' +
      (err ? '<span class="field__error" id="ob-p-' + k + '-e">' + esc(t('ob.p.required_err')) + '</span>' : '') + '</div>';
  }
  function stepProfile() {
    var enc = !(NC.secure && NC.secure.encrypted === false);
    var headHtml = artImg(4) + head(t('ob.step_of', { n: 4, total: TOTAL }), t('ob.p.title'), t('ob.p.lead'));
    if (!st.consents.sensitive) {
      return headHtml +
        '<div class="ob-noconsent card card--warning"><span class="icon-tile icon-tile--warning">' + icon('lock') + '</span>' +
          '<div><p class="ob-noconsent__t">' + esc(t('ob.p.no_consent_t')) + '</p><p class="ob-noconsent__d">' + esc(t('ob.p.no_consent_d')) + '</p>' +
          '<div class="cluster"><button type="button" class="btn btn--soft btn--sm" data-ob="goconsent">' + icon('arrow-left') + '<span>' + esc(t('ob.p.give_consent')) + '</span></button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-ob="later">' + esc(t('ob.later')) + '</button></div></div></div>' +
        userLangField();
    }
    var bt = st.profile.public.blood_type;
    var types = (NC.profile && NC.profile.BLOOD_TYPES) || ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];
    var id = st.profile.identity;
    var codeErr = st.errors.reveal_code;
    return headHtml +
      '<section class="ob-layer ob-layer--public" aria-labelledby="ob-pub-title">' +
        '<p class="ob-layer__title" id="ob-pub-title">' + icon('eye', 'icon--sm') + '<span>' + esc(t('ob.p.public')) + '</span>' +
          '<span class="badge badge--' + (enc ? 'success' : 'warning') + '">' + icon(enc ? 'lock' : 'alert-triangle') + esc(enc ? t('ob.p.encrypted') : t('ob.p.not_encrypted')) + '</span></p>' +
        '<div class="field' + (st.errors.blood_type ? ' is-invalid' : '') + '"><p class="field__label" id="ob-bt-label">' + esc(t('ob.p.blood')) + '<span class="req" aria-hidden="true">*</span></p>' +
          '<div class="ob-blood" role="radiogroup" aria-labelledby="ob-bt-label" aria-required="true">' + types.map(function (b) {
            var on = b === bt;
            var label = b === 'unknown' ? t('ob.p.blood_unknown') : b.replace('-', '−');
            return '<button type="button" class="ob-blood__btn' + (on ? ' is-selected' : '') + (b === 'unknown' ? ' ob-blood__btn--unknown' : '') + '" role="radio" aria-checked="' + on + '" data-ob="blood" data-value="' + esc(b) + '">' + esc(label) + '</button>';
          }).join('') + '</div>' +
          (st.errors.blood_type ? '<span class="field__error">' + esc(t('ob.p.blood_err')) + '</span>' : '') + '</div>' +
        FIELDS.map(textField).join('') +
      '</section>' +
      '<details class="ob-layer ob-layer--identity"' + (st.identityOpen || codeErr ? ' open' : '') + ' data-ob="idlayer">' +
        '<summary class="ob-layer__title">' + icon('id-card', 'icon--sm') + '<span>' + esc(t('ob.p.identity')) + '</span>' + icon('chevron-down', 'icon--sm ob-layer__chev') + '</summary>' +
        '<p class="ob-hint">' + icon('shield', 'icon--xs') + esc(t('ob.p.identity_d')) + '</p>' +
        (st.idLocked ? '<p class="ob-idlock">' + icon('lock', 'icon--sm') + '<span>' + esc(t('ob.p.id_locked')) + '</span></p>' :
        '<div class="ob-idgrid">' + ID_FIELDS.map(function (k) {
          var attrs = k === 'contact_phone' ? ' type="tel" inputmode="tel" autocomplete="off"' : k === 'reveal_code' ? ' type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"' : ' type="text" autocomplete="off"';
          var err = k === 'reveal_code' && codeErr;
          return '<div class="field' + (err ? ' is-invalid' : '') + (k === 'reveal_code' ? ' ob-idgrid__code' : '') + '"><label class="field__label" for="ob-i-' + k + '">' + esc(t('ob.p.' + k)) + '</label>' +
            '<input class="input" id="ob-i-' + k + '"' + attrs + ' data-ob="id" data-key="' + k + '" value="' + esc(id[k] || '') + '"' + (err ? ' aria-invalid="true"' : '') + '>' +
            (k === 'reveal_code' ? '<span class="field__hint">' + esc(t('ob.p.reveal_hint')) + '</span>' : '') +
            (err ? '<span class="field__error">' + esc(t('ob.p.code_err')) + '</span>' : '') + '</div>';
        }).join('') + '</div>') +
      '</details>' +
      userLangField() +
      '<button type="button" class="btn btn--ghost btn--sm ob-skip" data-ob="later">' + esc(t('ob.skip_profile')) + '</button>';
  }

  /* ---------- 5 · pack ---------- */
  function stepPack() {
    var r = currentRoute();
    var car = S('carrier');
    var n = seedRoutes().length || 3;
    var online = !!(NC.net && NC.net.online());
    var srv = r && r.packs ? r.packs[car] : null;
    var p = st.pack;
    // Pack version and signal-layer confidence live in Settings → Kết nối & kỹ thuật (R1); the size stays on the button.
    var size = srv && srv.size_bytes ? srv.size_bytes : (p ? p.size_bytes : null);
    var dl = st.dl;
    var action;
    if (st.dlBusy) {
      action = '<div class="ob-dl__progress"><div class="progress is-indeterminate"><div class="progress__bar"></div></div><span>' + esc(t('ob.k.downloading')) + '</span></div>';
    } else if (dl) {
      action = '<p class="ob-dl__done">' + icon('check-circle') + '<span>' + esc(t('ob.k.downloaded', { size: U.fmtBytes(dl.size_bytes) })) + '</span></p>';
    } else {
      action = '<button type="button" class="btn btn--primary btn--block" data-ob="download"' + (online ? '' : ' disabled') + '>' + icon('download') + '<span>' + esc(t('ob.k.download')) + (size ? ' · ' + esc(U.fmtBytes(size)) : '') + '</span></button>' +
        (!online ? '<p class="ob-hint ob-hint--warn">' + icon('wifi-off', 'icon--xs') + esc(t('ob.k.offline')) + '</p>' : '') +
        (st.dlErr ? '<p class="ob-hint ob-hint--warn">' + icon('alert-triangle', 'icon--xs') + esc(t('ob.k.failed')) + '</p>' : '');
    }
    var c = st.consents;
    var complete = st.profileSaved;
    return artImg(5) + head(t('ob.step_of', { n: 5, total: TOTAL }), t('ob.k.title'), t('ob.k.lead')) +
      '<div class="ob-pack ob-pack--bundled"><span class="icon-tile icon-tile--success">' + icon('package') + '</span>' +
        '<div><p class="ob-pack__t">' + esc(t('ob.k.bundled_t', { n: n })) + '</p><p class="ob-pack__d">' + esc(t('ob.k.bundled_d')) + '</p>' +
        '<ul class="ob-pack__routes">' + seedRoutes().map(function (x) { return '<li>' + icon('check', 'icon--xs') + esc(routeLabel(x)) + '</li>'; }).join('') + '</ul></div></div>' +
      '<div class="ob-pack ob-pack--latest ob-dl">' +
        '<div class="ob-pack__head"><span class="icon-tile icon-tile--primary">' + icon('cloud-upload') + '</span>' +
        '<div><p class="ob-pack__t">' + esc(t('ob.k.latest_t')) + '</p><p class="ob-pack__d">' + esc(t('ob.k.latest_d', { route: routeLabel(r), carrier: carrierName(car) })) + '</p></div></div>' +
        action + '</div>' +
      '<div class="ob-summary"><p class="ob-summary__title">' + esc(t('ob.k.summary')) + '</p><dl class="kv">' +
        '<div class="kv__row"><dt>' + esc(t('ob.k.sum_trip')) + '</dt><dd>' + esc(routeLabel(r) + ' · ' + carrierName(car) + ' · ' + t('home.mode.' + (S('travel_mode') === 'hiking' ? 'hiking' : 'motorbike'))) + '</dd></div>' +
        '<div class="kv__row"><dt>' + esc(t('ob.k.sum_consent')) + '</dt><dd>' + esc(t('ob.k.sum_consent_v', { s: t(c.sensitive ? 'ob.k.yes' : 'ob.k.no'), l: t(c.community_logs ? 'ob.k.yes' : 'ob.k.no') })) + '</dd></div>' +
        '<div class="kv__row"><dt>' + esc(t('ob.k.sum_profile')) + '</dt><dd>' + (complete ? icon('lock', 'icon--xs text-success') + ' ' : '') + esc(t(complete ? 'ob.k.sum_profile_ok' : 'ob.k.sum_profile_no')) + '</dd></div>' +
        (st.consentAt ? '<div class="kv__row"><dt></dt><dd class="ob-summary__at">' + esc(t('ob.c.saved', { time: U.fmtDateTime(st.consentAt) })) + '</dd></div>' : '') +
      '</dl></div>';
  }

  /* ================================================================== */
  /* Interaction                                                          */
  /* ================================================================== */
  function wireStep() {
    $$('[data-ob="lang"], [data-ob="mode"]', body).forEach(function (seg) {
      if (NC.ui && NC.ui.segmented) NC.ui.segmented(seg, {
        onChange: function (v) {
          if (seg.getAttribute('data-ob') === 'lang') { if (NC.i18n) NC.i18n.setLang(v); }
          else setS('travel_mode', v);
        }
      });
    });
  }

  function selectRadio(btn) {
    var group = btn.parentNode;
    $$('[role="radio"]', group).forEach(function (b) {
      var on = b === btn;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function onClick(e) {
    var b = e.target.closest ? e.target.closest('[data-ob]') : null;
    if (!b || !root.contains(b) || b.tagName === 'INPUT' || b.tagName === 'DETAILS') return;
    var a = b.getAttribute('data-ob'), v = b.getAttribute('data-value');
    if (a === 'carrier') { selectRadio(b); setS('carrier', v); st.pack = null; }
    else if (a === 'route') {
      selectRadio(b); setS('route_id', v); st.pack = null;
      var m = b.getAttribute('data-mode');
      if (m === 'motorbike' || m === 'hiking') {
        setS('travel_mode', m);
        var seg = body.querySelector('[data-ob="mode"]');
        if (seg) $$('.segmented__btn', seg).forEach(function (x) {
          var on = x.getAttribute('data-value') === m;
          x.classList.toggle('is-selected', on); x.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      }
    }
    else if (a === 'ulang') { selectRadio(b); setS('user_lang', v); }
    else if (a === 'blood') { selectRadio(b); st.profile.public.blood_type = v; delete st.errors.blood_type; b.closest('.field').classList.remove('is-invalid'); }
    else if (a === 'none') {
      var k = b.getAttribute('data-key'), none = t('ob.p.none_value');
      var inp = body.querySelector('#ob-p-' + k);
      var on = st.profile.public[k] !== none;
      st.profile.public[k] = on ? none : '';
      if (inp) inp.value = st.profile.public[k];
      b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) clearFieldError(k);
      else if (inp) inp.focus();
    }
    else if (a === 'goconsent') { if (step === 4) goBack(); else go(3); }
    else if (a === 'later') { go(5); }   // skipping never touches a profile that is already stored
    else if (a === 'download') { download(); }
  }

  function clearFieldError(k) {
    delete st.errors[k];
    if (!Object.keys(st.errors).length && lastToast && lastToast.close) { lastToast.close(); lastToast = null; }
    var inp = body.querySelector('#ob-p-' + k);
    var f = inp && inp.closest('.field');
    if (f) { f.classList.remove('is-invalid'); var er = f.querySelector('.field__error'); if (er) er.parentNode.removeChild(er); inp.removeAttribute('aria-invalid'); }
  }

  function onInput(e) {
    var el = e.target;
    var a = el.getAttribute && el.getAttribute('data-ob');
    if (!a) return;
    var k = el.getAttribute('data-key');
    if (a === 'pub') {
      st.profile.public[k] = el.value;
      var chip = body.querySelector('[data-ob="none"][data-key="' + k + '"]');
      if (chip) { var on = el.value === t('ob.p.none_value'); chip.classList.toggle('is-selected', on); chip.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      if (el.value.trim()) clearFieldError(k);
    } else if (a === 'id') {
      st.profile.identity[k] = k === 'reveal_code' ? el.value.replace(/\D/g, '').slice(0, 4) : el.value;
      if (k === 'reveal_code' && el.value !== st.profile.identity[k]) el.value = st.profile.identity[k];
    }
  }

  function onChange(e) {
    var el = e.target;
    if (el.getAttribute && el.getAttribute('data-ob') === 'consent') {
      var k = el.getAttribute('data-key');
      st.consents[k] = !!el.checked;
      var card = el.closest('.ob-consent');
      if (card) card.classList.toggle('is-checked', !!el.checked);
      var need = body.querySelector('#ob-need');
      if (need && st.consents.terms) { need.hidden = true; st.showNeed = false; }
      if (card && k === 'terms') card.classList.remove('is-attention');
      var warn = body.querySelector('#ob-sens-warn');
      if (warn && k === 'sensitive') warn.hidden = !(st.hasProfile && !st.consents.sensitive);
      updateNext();
    }
  }
  function onToggle(e) {
    var d = e.target;
    if (d && d.getAttribute && d.getAttribute('data-ob') === 'idlayer') st.identityOpen = d.open;
  }

  /* ---------- step transitions ---------- */
  function validateProfile() {
    var errs = {};
    var pub = st.profile.public;
    if (!pub.blood_type) errs.blood_type = true;
    FIELDS.forEach(function (k) { if (!String(pub[k] || '').trim()) errs[k] = true; });
    var code = st.profile.identity.reveal_code;
    if (code && !/^\d{4}$/.test(code)) errs.reveal_code = true;
    return errs;
  }

  function next() {
    var btn = root.querySelector('#ob-next');
    if (btn && btn.classList.contains('is-loading')) return;
    if (step === 3) {
      if (!st.consents.terms) {
        var need = body.querySelector('#ob-need');
        if (need) need.hidden = false;
        var tc = body.querySelector('.ob-consent--terms');
        if (tc) { tc.classList.remove('is-attention'); void tc.offsetWidth; tc.classList.add('is-attention'); }
        if (need && need.scrollIntoView) { try { need.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { need.scrollIntoView(); } }
        var first = body.querySelector('#ob-c-terms');
        if (first) { try { first.focus({ preventScroll: true }); } catch (e2) { first.focus(); } }
        return;
      }
      busy(btn, true);
      var c = st.consents;
      // Unticking the sensitive-data consent while a profile is stored = withdrawal: ask, then delete (as Settings does).
      var pre = c.sensitive ? Promise.resolve(true) : storedProfile().then(function (has) { return has ? withdraw() : true; });
      pre.then(function (ok) {
        if (!ok) {
          busy(btn, false);
          st.consents.sensitive = true;   // cancelled → the box goes back on, the profile stays
          render(false);
          var box = body.querySelector('#ob-c-sensitive');
          if (box) { try { box.focus({ preventScroll: true }); } catch (e0) { box.focus(); } }
          return;
        }
        var patch = { terms: true, sensitive: !!c.sensitive, community_logs: !!c.community_logs };
        if (!c.sensitive) patch.share_medical_in_alert = false;
        var job = NC.profile && NC.profile.consents ? NC.profile.consents.set(patch) : Promise.resolve(null);
        return Promise.resolve(job).then(function (saved) {
          busy(btn, false);
          st.saved = { terms: true, sensitive: !!c.sensitive, community_logs: !!c.community_logs };
          st.consentAt = saved && saved.at ? saved.at : null;
          if (!c.sensitive) { st.profile = blankProfile(); st.profileSaved = false; st.hasProfile = false; st.errors = {}; st.idLocked = false; }
          go(4);
        });
      }).then(null, function () { busy(btn, false); if (NC.ui) NC.ui.toast(t('common.error'), { type: 'danger' }); });
      return;
    }
    if (step === 4) {
      if (!st.consents.sensitive) { go(5); return; }
      var errs = validateProfile();
      st.errors = errs;
      var n = Object.keys(errs).filter(function (k) { return k !== 'reveal_code'; }).length;
      if (Object.keys(errs).length) {
        if (errs.reveal_code) st.identityOpen = true;
        render(false);
        if (NC.ui) lastToast = NC.ui.toast(errs.reveal_code && !n ? t('ob.p.code_err') : t('ob.p.missing', { n: n }), { type: 'warning', timeout: 2600 });
        var bad = body.querySelector('.is-invalid input, .is-invalid .ob-blood__btn');
        if (bad) {
          try { bad.focus({ preventScroll: true }); } catch (e3) { bad.focus(); }
          if (bad.scrollIntoView) { try { bad.scrollIntoView({ block: 'center' }); } catch (e4) { bad.scrollIntoView(); } }
        }
        return;
      }
      if (!NC.profile) { go(5); return; }
      busy(btn, true);
      // A code-protected identity layer is kept exactly as stored (re-read now, it never entered this form).
      var keep = st.idLocked ? Promise.resolve(NC.profile.get()).then(function (cur) { return cur && cur.identity ? cur.identity : null; }, function () { return null; }) : Promise.resolve(null);
      keep.then(function (stored) {
        var prof = { public: Object.assign({}, st.profile.public), identity: Object.assign({}, stored || st.profile.identity) };
        if (!prof.identity.reveal_code) prof.identity.reveal_code = null;
        return NC.profile.save(prof);
      }).then(function () {
        busy(btn, false);
        st.profileSaved = true; st.hasProfile = true;
        go(5);
      }, function () { busy(btn, false); if (NC.ui) NC.ui.toast(t('ob.p.save_failed'), { type: 'danger' }); });
      return;
    }
    if (step === TOTAL) { finish(btn); return; }
    go(step + 1);
  }

  function busy(btn, on) { if (btn && NC.ui) NC.ui.setLoading(btn, on); }

  function finish(btn) {
    busy(btn, true);
    // The required terms consent must be on record, whatever URL brought the user here.
    var check = NC.profile && NC.profile.consents ? Promise.resolve(NC.profile.consents.get()).then(null, function () { return null; })
      : Promise.resolve({ terms: st.saved.terms });
    check.then(function (c) {
      if (!c || !c.terms) {
        busy(btn, false);
        st.saved.terms = false; st.consents.terms = false; st.showNeed = true;
        go(3, { replace: true });
        return;
      }
      return Promise.resolve(setS('onboarded', true)).then(function () {
        busy(btn, false);
        if (NC.ui) NC.ui.toast(t('ob.k.welcome'), { type: 'success' });
        donePending = { replay: !!nav.replay };
        leave();
        // Safety net: announce completion even if the router never leaves the screen (no NC.app).
        setTimeout(emitDone, 1500);
      });
    }).then(null, function () { busy(btn, false); });
  }

  /* ---------- step navigation (history-aware) ---------- */
  /** Furthest step reachable now: nothing past the consent step until the required terms are on record. */
  function maxStep() { return st.saved.terms ? TOTAL : 3; }
  function clampStep(n) { var v = parseInt(n, 10); if (!(v >= 1)) v = 1; return Math.max(1, Math.min(v, maxStep(), TOTAL)); }
  function stepParams(n) { var p = { step: String(n) }; if (nav.replay) p.replay = '1'; return p; }
  function histState() { try { return window.history.state; } catch (e) { return null; } }
  function tagEntry(idx) {
    try {
      var s0 = histState();
      var s1 = Object.assign({}, s0 && typeof s0 === 'object' ? s0 : {});
      s1[HKEY] = { sid: nav.sid, idx: idx };
      window.history.replaceState(s1, '', window.location.href);
    } catch (e) { /* history unavailable → in-memory steps only */ }
  }
  function entryIdx() { var s0 = histState(); var tg = s0 && s0[HKEY]; return tg && tg.sid === nav.sid ? tg.idx : null; }
  /** Router available and onboarding on screen → steps go through the URL (#/onboarding?step=N). */
  function routed() { return !!(NC.app && typeof NC.app.go === 'function' && nav.session); }
  function later(fn) { setTimeout(fn, 0); }   // never re-enter the router from inside its own show()

  /**
   * Go to step n: pushes a history entry (opts.replace → replaces the current one). The router then calls show(),
   * which renders the (clamped) step.
   */
  function go(n, opts) {
    var target = clampStep(n);
    if (!routed()) { renderStep(target); return; }
    NC.app.go('onboarding', stepParams(target), opts && opts.replace ? { replace: true } : undefined);
  }
  /** Previous step: a real history back when the entry below is that step, otherwise replace in place. */
  function goBack() {
    if (step <= 1) {
      // Replay from Settings: leave to wherever it was opened from (the entry below our first one).
      if (nav.replay && NC.app) { if (routed() && nav.idx > 0) window.history.go(-(nav.idx + 1)); else NC.app.back(); }
      return;
    }
    if (routed() && nav.idx > 0 && nav.steps[nav.idx - 1] === step - 1) { window.history.back(); return; }
    go(step - 1, { replace: true });
  }
  /** Finished: rewind our own entries and replace the first one with #/home (back from home then leaves the app). */
  function leave() {
    nav.leaving = true;
    var home = function () { if (nav.leaving && NC.app) NC.app.go('home', null, { replace: true }); };
    if (routed() && nav.idx > 0) {
      window.history.go(-nav.idx);
      setTimeout(home, 800);   // safety net if the traversal does not land (show() normally does it first)
    } else if (NC.app) home();
  }

  function renderStep(n) {
    if (lastToast && lastToast.close) { lastToast.close(); lastToast = null; }
    step = n;
    st.errors = step === 4 ? st.errors : {};
    if (step !== 3) st.showNeed = false;
    if (step === 5) preparePack();
    render(true);
  }

  function preparePack() {
    if (!NC.data) return;
    var rid = S('route_id'), car = S('carrier');
    Promise.all([
      Promise.resolve().then(function () { return NC.data.listRoutes(); }).catch(function () { return null; }),
      Promise.resolve().then(function () { return NC.data.getPack(rid, car); }).catch(function () { return null; }),
      Promise.resolve().then(function () { return NC.data.listDownloadedPacks(); }).catch(function () { return []; })
    ]).then(function (r) {
      if (r[0]) st.routes = r[0];
      st.pack = r[1];
      var d = (r[2] || []).filter(function (x) { return x.route_id === rid && x.carrier === car; })[0];
      if (d && !st.dl) st.dl = d;
      if (step === 5) render(false);
    });
  }

  function download() {
    if (!NC.data || st.dlBusy) return;
    var rid = S('route_id'), car = S('carrier');
    st.dlBusy = true; st.dlErr = false;
    render(false);
    var started = Date.now();
    NC.data.downloadPack(rid, car).then(function (meta) {
      // Keep the progress visible briefly so the action is perceivable.
      return U.sleep(Math.max(0, 700 - (Date.now() - started))).then(function () { return meta; });
    }).then(function (meta) {
      st.dlBusy = false; st.dl = meta;
      if (NC.ui) NC.ui.toast(t('ob.k.done_toast', { route: routeLabel(currentRoute()), carrier: carrierName(car) }), { type: 'success' });
      if (step === 5) render(false);
    }, function () {
      st.dlBusy = false; st.dlErr = true;
      if (step === 5) render(false);
    });
  }

  /* ================================================================== */
  /* Lifecycle                                                            */
  /* ================================================================== */
  function loadExisting() {
    var jobs = [];
    if (NC.profile && NC.profile.consents) jobs.push(NC.profile.consents.get().then(function (c) {
      st.saved = { terms: !!c.terms, sensitive: !!c.sensitive, community_logs: !!c.community_logs };
      st.consents = Object.assign({}, st.saved);
    }).catch(function () {}));
    if (NC.profile) jobs.push(NC.profile.get().then(function (p) {
      st.hasProfile = !!p;
      if (!p) return;
      st.idLocked = !!(p.identity && p.identity.reveal_code);
      st.profile = { public: Object.assign({}, st.profile.public, p.public), identity: st.idLocked ? blankProfile().identity : Object.assign({}, st.profile.identity, p.identity) };
      if (!st.profile.identity.reveal_code) st.profile.identity.reveal_code = '';
      st.profileSaved = NC.profile.isComplete(p);
    }).catch(function () {}));
    return Promise.all(jobs);
  }
  /** Is a medical profile stored on this device right now? */
  function storedProfile() {
    if (!NC.profile || typeof NC.profile.get !== 'function') return Promise.resolve(st.hasProfile);
    return Promise.resolve(NC.profile.get()).then(function (p) { st.hasProfile = !!p; return !!p; }, function () { return st.hasProfile; });
  }
  /**
   * Withdraw the sensitive-data consent for a stored profile: same flow as Settings (confirm → consents off → delete
   * profile → remove the medical layer from a running Buddy session). @returns {Promise<boolean>} confirmed
   */
  function withdraw() {
    var done = function (ok) {
      if (ok && NC.ui) NC.ui.toast(t('ob.c.withdrawn'), { type: 'success', timeout: 2600 });
      return ok;
    };
    if (NC.settingsScreen && typeof NC.settingsScreen.withdrawMedical === 'function') {
      return NC.settingsScreen.withdrawMedical().then(function (r) { return done(!!(r && r.ok)); });
    }
    if (!NC.ui || !NC.profile) return Promise.resolve(false);
    return NC.ui.confirm({ title: t('ob.c.withdraw_title'), message: t('ob.c.withdraw_msg'), confirmLabel: t('ob.c.withdraw_ok'), danger: true }).then(function (ok) {
      if (!ok) return false;
      var c = NC.profile.consents ? NC.profile.consents.set({ sensitive: false, share_medical_in_alert: false }) : Promise.resolve();
      return Promise.resolve(c).then(function () { return NC.profile.clear(); }).then(function () { return done(true); });
    });
  }

  function mount(section) {
    if (!section.querySelector('#ob-root')) section.innerHTML = SKELETON;
    root = section.querySelector('#ob-root');
    body = root.querySelector('#ob-body');
    if (NC.i18n) NC.i18n.apply(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('toggle', onToggle, true);
    root.querySelector('#ob-next').addEventListener('click', next);
    root.querySelector('#ob-back').addEventListener('click', goBack);
    body.addEventListener('keydown', function (e) {
      var tg = e.target;
      if (e.key === 'Enter' && tg && tg.tagName === 'INPUT' && (tg.type === 'text' || tg.type === 'tel')) { e.preventDefault(); next(); }
    });
    if (NC.bus) {
      NC.bus.on('i18n:change', function () { if (isActive()) { NC.i18n.apply(root); render(false); } });
      NC.bus.on('net:change', function () { if (isActive() && step === 5) render(false); });
    }
  }
  function isActive() { return !!root && !!document.documentElement.classList.contains('is-onboarding'); }

  function newSid() { return (U.uuid ? U.uuid() : String(Math.random()).slice(2)).slice(0, 12); }

  /**
   * Router entry point, called for every #/onboarding URL (first visit and each step change / back / forward).
   * A new visit starts a session (loads saved consents + profile); later calls only move between steps.
   */
  function show(params) {
    var p = params || {};
    if (nav.leaving) {
      // finish() rewound history to our first entry → replace it with home (outside this router callback).
      later(function () { if (nav.leaving && NC.app) NC.app.go('home', null, { replace: true }); });
      return;
    }
    if (!nav.session) {
      nav = { session: true, sid: newSid(), idx: 0, steps: {}, replay: p.replay === '1', leaving: false };
      tagEntry(0);
      step = 1;
      st.errors = {}; st.dl = null; st.dlErr = false; st.pack = null; st.showNeed = false;
      st.consents = blankConsents(); st.saved = blankConsents(); st.profile = blankProfile();
      st.profileSaved = false; st.hasProfile = false; st.identityOpen = false; st.idLocked = false;
      if (!p.step || p.step === '1') render(false);
      loadExisting().then(function () {
        // A finished user landing here through history (not an explicit replay) goes home instead of redoing setup.
        if (S('onboarded') === true && !nav.replay && NC.app) { later(function () { NC.app.go('home', null, { replace: true }); }); return; }
        land(p.step, 0);
      });
      return;
    }
    // Moving inside the session: back/forward land on a tagged entry, a push or a redirect on a new one.
    var idx = entryIdx();
    var requested = p.step;
    if (idx === null) {
      idx = nav.idx + 1; tagEntry(idx);
      // A new entry without ?step is a bounce (e.g. the onboarding gate redirected another route) → stay on this step.
      if (!requested) requested = String(step);
    }
    st.consents = Object.assign({}, st.saved);   // unsaved step-3 ticks never survive leaving that step
    land(requested, idx);
  }
  /** Render the requested step (clamped to what the consents allow) and fix the URL if it asked for more. */
  function land(requested, idx) {
    var target = clampStep(requested);
    nav.idx = idx;
    nav.steps[idx] = target;
    renderStep(target);
    var asked = parseInt(requested, 10) || 1;
    if (target !== asked && NC.app) later(function () { NC.app.go('onboarding', stepParams(target), { replace: true }); });
  }
  function hide() {
    nav.session = false; nav.leaving = false;
    // C1: 'onboarding:done' once the next screen is on (listeners may open UI right away).
    if (donePending) setTimeout(emitDone, 0);
  }
  /** C1 contract: NC.bus 'onboarding:done' {replay} once per completed run (after onboarded = true). */
  var donePending = null;
  function emitDone() {
    if (!donePending) return;
    var p = donePending; donePending = null;
    if (NC.bus) NC.bus.emit('onboarding:done', p);
  }

  if (NC.app && NC.app.register) {
    NC.app.register('onboarding', { titleKey: 'app.title.onboarding', mod: null, mount: mount, show: show, hide: hide });
  }

  NC.onboarding = {
    go: function (n) { if (root) go(n); },
    restart: function () { if (NC.settings) NC.settings.set('onboarded', false); if (NC.app) NC.app.go('onboarding'); }
  };
})(window.NC = window.NC || {});
