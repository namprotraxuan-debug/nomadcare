/*
 * mod01-translate.js — MOD.01 "Dịch y tế 1 chạm": body area → symptom (→ detail) → severity → a large bilingual
 * result for local medical staff (Vietnamese) + the traveler's language; quick phrases; staff questions with
 * answers and a 0–10 pain scale; a multi-sentence list; full-screen view; read-aloud (vi-VN); field-test timer.
 * Owner: P2 mod01-translate. Content: window.NC_PHRASES (assets/js/data/phrases.js). i18n namespace: tr.*
 * Public API: NC.translate.{open(params), addToList(stmt), list(), clearList(), speak(text, bcp47), fullscreen(stmts)}
 * Routing: #/translate?tab=sym|quick|staff&step=<step>. Selections live in memory only (never in the URL);
 * an optional ?code=MOD01-… deep link opens that result and is immediately scrubbed from the address bar.
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var esc = U.esc;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }
  function data() { return window.NC_PHRASES || null; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var TABS = ['sym', 'quick', 'staff'];
  var STEPS = { sym: ['group', 'symptom', 'detail', 'severity', 'result'], quick: ['list', 'result'], staff: ['list', 'question', 'answer'] };
  var TAB_ICON = { sym: 'activity', quick: 'message-square', staff: 'stethoscope' };
  var TONES = { head: 'info', chest: 'danger', abdomen: 'warning', arms: 'accent', legs: 'success', skin: 'primary' };
  var SEV_TONE = { mild: 'success', moderate: 'warning', severe: 'danger' };
  var SEV_LEVEL = { mild: 1, moderate: 2, severe: 3 };
  var SEV_ICON = { mild: 'check-circle', moderate: 'alert-circle', severe: 'siren' };
  var TIMINGS_KEY = 'tr.timings';
  var TIMINGS_MAX = 100;
  var VI_TTS = 'vi-VN';
  /* Localised "none" — only used with older phrasebooks that lack the *_none templates (FIX_CONTRACT C14). */
  var NONE_WORD = { vi: 'không có', en: 'none', zh: '无', ko: '없음', ja: 'なし', ru: 'нет', fr: 'aucun' };
  var NONE_RE = /^(khong|khong co|none|no|nil|n\/a|na|-|—|khong co gi|chua co)$/;
  /*
   * Severity hints used ONLY while phrases.js has no node-level `hints` override for the node (FIX_CONTRACT C14):
   * a non-urgent Severe phrase must not tell the patient to call 115, and an urgent Mild phrase (e.g. snake bite)
   * must never suggest that walking about is fine. The data always wins once it carries `hints`.
   */
  var HINT_FALLBACK = {
    severe_plain: { vi: 'Rất nặng — cần được khám ngay', en: 'Very bad — I need a doctor right away', zh: '非常严重——需要马上看医生',
      ko: '매우 심해요 — 바로 진료가 필요해요', ja: 'とても重い — すぐに診察が必要', ru: 'Очень тяжело — нужен врач прямо сейчас',
      fr: 'Très grave — je dois voir un médecin tout de suite' },
    mild_urgent: { vi: 'Chưa có hoặc mới có ít triệu chứng — vẫn phải đi cấp cứu ngay, không tự đi lại', en: 'No or few symptoms yet — still go to emergency care now, do not walk about',
      zh: '还没有或只有少量症状——仍须马上急救，不要自己走动', ko: '아직 증상이 없거나 적어요 — 그래도 바로 응급 치료, 걷지 마세요',
      ja: 'まだ症状がない・少ない — それでもすぐ救急へ。歩き回らないで', ru: 'Симптомов пока нет или мало — всё равно срочно к врачу, не ходить',
      fr: 'Pas encore ou peu de symptômes — aller aux urgences tout de suite, sans marcher' }
  };

  /* ================================================================== */
  /* i18n — tr.*                                                         */
  /* ================================================================== */
  if (NC.i18n) NC.i18n.add({
    vi: {
      'tr.intro.lead': 'Vài chạm, không cần gõ hay có mạng — nhân viên y tế luôn thấy bản tiếng Việt.',
      'tr.lang.you_speak': 'Bạn nói',
      'tr.lang.staff_note': 'Nhân viên y tế đọc tiếng Việt — mọi câu luôn hiện kèm bản tiếng Việt.',
      'tr.lang.pick': 'Chọn ngôn ngữ của bạn',
      'tr.lang.changed': 'Ngôn ngữ của bạn: {name}',
      'tr.tab.aria': 'Cách giao tiếp',
      'tr.tab.sym': 'Triệu chứng', 'tr.tab.quick': 'Câu nhanh', 'tr.tab.staff': 'Nhân viên hỏi',
      'tr.step.group': 'Bộ phận', 'tr.step.symptom': 'Triệu chứng', 'tr.step.detail': 'Chi tiết', 'tr.step.severity': 'Mức độ',
      'tr.step.aria': 'Các bước chọn triệu chứng',
      'tr.step.jump': 'Quay lại bước “{name}”',
      'tr.back': 'Quay lại', 'tr.restart': 'Làm lại',
      'tr.group.title': 'Bạn bị ở đâu?',
      'tr.body.caption': 'Chạm vào vùng cơ thể trên hình',
      'tr.body.skin': 'Da & toàn thân',
      'tr.sym.title': 'Triệu chứng nào đúng nhất?',
      'tr.sym.hint': 'Chạm một thẻ. Thẻ có nhiều lựa chọn thì chạm thẳng vào lựa chọn.',
      'tr.sym.quick_pick': 'Chọn luôn',
      'tr.sym.options': '{n} lựa chọn',
      'tr.detail.title': 'Cụ thể hơn một chút',
      'tr.detail.hint': 'Chọn mô tả gần đúng nhất.',
      'tr.sev.title': 'Mức độ như thế nào?',
      'tr.sev.hint': 'Chạm một mức — câu cho nhân viên y tế sẽ hiện ngay.',
      'tr.sev.urgent': 'Gọi 115',
      'tr.res.show_staff': 'Đưa màn hình này cho nhân viên y tế',
      'tr.res.translation': 'Bản dịch · {lang}',
      'tr.res.urgent_body': 'Gọi 115 hoặc nhờ người xung quanh gọi giúp. Nếu không gọi được 115, hãy thử 112.',
      'tr.res.urgent_roam': 'Cuộc gọi 115/112 có thể được chuyển qua mạng khác đang có sóng tại chỗ — nhưng không đảm bảo khi hoàn toàn không có sóng. Hãy luôn thử gọi trước.',
      'tr.res.disc': 'Chỉ hỗ trợ giao tiếp, không thay thế chẩn đoán và điều trị y khoa — nếu nguy hiểm, gọi 115.',
      'tr.res.terms': 'Thuật ngữ',
      'tr.res.more': 'Xem thêm',
      'tr.res.year_tbc': 'năm đang chốt',
      'tr.behalf.on': 'Bạn đang nói thay người đi cùng',
      'tr.behalf.off': 'Tắt',
      'tr.behalf.off_aria': 'Tắt chế độ nói thay người đi cùng',
      'tr.mine.behalf': 'Bạn đang nói thay người đi cùng: đây là thông tin của chính bạn. Nhân viên y tế sẽ thấy nhãn “không phải của người bệnh”.',
      'tr.list.owner_tag': 'Thông tin của bạn — không phải của người bệnh',
      'tr.fs.close': 'Thoát',
      'tr.fs.close_aria': 'Thoát chế độ toàn màn hình',
      'tr.fs.more': 'Cuộn để xem hết {n} ý',
      'tr.fs.call_aria': 'Gọi cấp cứu 115',
      'tr.res.speak': 'Đọc to', 'tr.res.stop': 'Dừng đọc',
      'tr.res.speak_tl': 'Nghe bằng {lang}',
      'tr.res.fullscreen': 'Toàn màn hình',
      'tr.res.add': 'Thêm vào danh sách', 'tr.res.added': 'Đã có trong danh sách',
      'tr.res.list': 'Danh sách ({n})',
      'tr.res.open_qr': 'Mở hồ sơ y tế QR',
      'tr.res.code': 'Mã {code}',
      'tr.res.version': 'Nội dung v{v}',
      'tr.res.review.in_review': 'chờ cố vấn y tế ký duyệt',
      'tr.res.review.approved': 'đã được cố vấn y tế duyệt',
      'tr.res.review.draft': 'bản nháp',
      'tr.res.review.retracted': 'đã thu hồi',
      /* Staff-facing lead lines: intentionally Vietnamese in BOTH UI languages (the reader is local staff). */
      'tr.vi.lead': 'Người bệnh muốn nói với anh/chị:',
      'tr.vi.answer_lead': 'Người bệnh trả lời:',
      'tr.vi.urgent': 'CẤP CỨU — cần gọi 115',
      'tr.vi.list_lead': 'Người bệnh muốn nói với anh/chị ({n} ý):',
      'tr.vi.severity': 'Mức độ: {x}',
      'tr.vi.severity_urgent': 'Mức độ: {x} — vẫn cần cấp cứu',
      'tr.vi.lead_behalf': 'Người đi cùng nói thay người bệnh:',
      'tr.vi.answer_lead_behalf': 'Người đi cùng trả lời thay người bệnh:',
      'tr.vi.list_lead_behalf': 'Người đi cùng nói thay người bệnh ({n} ý):',
      'tr.vi.lead_owner': 'Thông tin y tế của người đang cầm máy (chủ điện thoại) — KHÔNG phải của người bệnh:',
      'tr.vi.owner_tag': 'Của người đang cầm máy — không phải của người bệnh',
      'tr.vi.owner_tts': 'Sau đây là thông tin y tế của người đang cầm máy, không phải của người bệnh.',
      'tr.vi.code': 'Mã {code}',
      'tr.vi.version': 'Nội dung v{v}',
      'tr.vi.review.in_review': 'chờ cố vấn y tế ký duyệt',
      'tr.vi.review.approved': 'đã được cố vấn y tế duyệt',
      'tr.vi.review.draft': 'bản nháp',
      'tr.vi.review.retracted': 'đã thu hồi',
      'tr.vi.src_profile': 'Người dùng tự khai trong hồ sơ y tế',
      'tr.vi.fs_disc': 'Câu do người bệnh tự chọn trên ứng dụng hỗ trợ giao tiếp, không phải chẩn đoán. Gọi 115 khi nghi ngờ nguy hiểm.',
      'tr.vi.fs_disc_behalf': 'Câu do người đi cùng chọn thay người bệnh trên ứng dụng hỗ trợ giao tiếp, không phải chẩn đoán. Gọi 115 khi nghi ngờ nguy hiểm.',
      'tr.vi.fs_exit': 'Chạm vào màn hình để thoát',
      'tr.vi.fs_more': 'Cuộn để xem hết {n} ý',
      'tr.tts.unsupported': 'Trình duyệt này không hỗ trợ đọc to. Hãy đưa màn hình cho nhân viên y tế xem.',
      'tr.tts.no_voice': 'Thiết bị chưa có giọng đọc {lang}. Hãy đưa màn hình cho nhân viên xem, hoặc cài giọng đọc trong cài đặt hệ thống.',
      'tr.tts.error': 'Không đọc to được — hãy đưa màn hình cho nhân viên y tế xem.',
      'tr.tts.vi': 'tiếng Việt',
      'tr.fs.exit': 'Chạm vào màn hình để thoát',
      'tr.fs.aria': 'Câu hiển thị toàn màn hình cho nhân viên y tế',
      'tr.list.title': 'Danh sách cho nhân viên y tế',
      'tr.list.sub': 'Gom nhiều câu để nhân viên đọc một lần.',
      'tr.list.count': '{n} câu',
      'tr.list.open': 'Mở',
      'tr.list.added': 'Đã thêm vào danh sách ({n})',
      'tr.list.exists': 'Câu này đã có trong danh sách',
      'tr.list.remove': 'Xoá khỏi danh sách',
      'tr.list.clear': 'Xoá hết', 'tr.list.cleared': 'Đã xoá danh sách',
      'tr.list.empty': 'Danh sách đang trống',
      'tr.list.empty_hint': 'Chạm “Thêm vào danh sách” ở màn hình kết quả hoặc ở câu nhanh.',
      'tr.list.add_profile': 'Thêm thông tin y tế của tôi',
      'tr.list.profile_added': 'Đã thêm {n} câu từ hồ sơ y tế',
      'tr.list.privacy': 'Danh sách chỉ nằm trong bộ nhớ tạm của máy và tự xoá khi đóng ứng dụng.',
      'tr.mine.title': 'Thông tin y tế của tôi',
      'tr.mine.sub': 'Lấy từ hồ sơ QR — mã hoá, chỉ nằm trên máy này',
      'tr.mine.show': 'Hiện to', 'tr.mine.add': 'Thêm vào danh sách',
      'tr.mine.none_title': 'Chưa có hồ sơ y tế',
      'tr.mine.none_text': 'Điền 4 trường (nhóm máu, dị ứng, bệnh nền, thuốc) để nói với nhân viên y tế chỉ bằng 1 chạm.',
      'tr.mine.consent_title': 'Cần đồng ý xử lý dữ liệu y tế',
      'tr.mine.consent_text': 'Bạn chưa đồng ý lưu dữ liệu y tế nhạy cảm trên máy (Nghị định 356/2025/NĐ-CP).',
      'tr.mine.cta': 'Mở hồ sơ QR',
      'tr.quick.title': 'Câu nói nhanh',
      'tr.quick.hint': 'Một chạm là câu hiện to bằng tiếng Việt.',
      'tr.staff.title': 'Nhân viên y tế hỏi',
      'tr.staff.hint': 'Nhân viên chọn câu hỏi bằng tiếng Việt — bạn đọc bằng ngôn ngữ của mình rồi chạm câu trả lời.',
      'tr.staff.asks': 'Nhân viên y tế hỏi bạn',
      'tr.staff.tap_answer': 'Chạm vào câu trả lời của bạn',
      'tr.staff.answers': '{n} câu trả lời',
      'tr.staff.another': 'Câu hỏi khác', 'tr.staff.again': 'Chọn lại',
      'tr.timer.aria': 'Đồng hồ thử nghiệm thực địa',
      'tr.timer.result': '{s} giây · {n} chạm',
      'tr.timer.saved': 'Đã lưu kết quả thử nghiệm: {s} giây, {n} chạm',
      'tr.foot.meta': 'Bộ câu y tế v{v}',
      'tr.foot.count': '{n} câu · {l} ngôn ngữ',
      'tr.empty.title': 'Chưa tải được bộ câu y tế',
      'tr.empty.text': 'Hãy gọi 115, hoặc mở hồ sơ QR để nhân viên y tế đọc thông tin của bạn.'
    },
    en: {
      'tr.intro.lead': 'A few taps, no typing or signal needed — staff always see the Vietnamese text.',
      'tr.lang.you_speak': 'You speak',
      'tr.lang.staff_note': 'Medical staff read Vietnamese — every sentence is also shown in Vietnamese.',
      'tr.lang.pick': 'Choose your language',
      'tr.lang.changed': 'Your language: {name}',
      'tr.tab.aria': 'Ways to communicate',
      'tr.tab.sym': 'Symptoms', 'tr.tab.quick': 'Quick phrases', 'tr.tab.staff': 'Staff asks',
      'tr.step.group': 'Body area', 'tr.step.symptom': 'Symptom', 'tr.step.detail': 'Detail', 'tr.step.severity': 'Severity',
      'tr.step.aria': 'Symptom steps',
      'tr.step.jump': 'Back to step “{name}”',
      'tr.back': 'Back', 'tr.restart': 'Start over',
      'tr.group.title': 'Where is the problem?',
      'tr.body.caption': 'Tap a body area on the figure',
      'tr.body.skin': 'Skin & whole body',
      'tr.sym.title': 'Which symptom fits best?',
      'tr.sym.hint': 'Tap a card. Cards with options: tap the option directly.',
      'tr.sym.quick_pick': 'Pick directly',
      'tr.sym.options': '{n} options',
      'tr.detail.title': 'A little more detail',
      'tr.detail.hint': 'Pick the closest description.',
      'tr.sev.title': 'How bad is it?',
      'tr.sev.hint': 'Tap a level — the sentence for the staff appears right away.',
      'tr.sev.urgent': 'Call 115',
      'tr.res.show_staff': 'Show this screen to the medical staff',
      'tr.res.translation': 'Translation · {lang}',
      'tr.res.urgent_body': 'Call 115 or ask someone nearby to call. If 115 does not connect, try 112.',
      'tr.res.urgent_roam': 'Emergency calls to 115/112 may roam onto any network with signal where you are — but this is not guaranteed when there is no signal at all. Always try calling first.',
      'tr.res.disc': 'A communication aid only, not a medical diagnosis or treatment — if in danger, call 115.',
      'tr.res.terms': 'Terminology',
      'tr.res.more': 'More details',
      'tr.res.year_tbc': 'year TBC',
      'tr.behalf.on': 'You are speaking for your companion',
      'tr.behalf.off': 'Turn off',
      'tr.behalf.off_aria': 'Stop speaking for your companion',
      'tr.mine.behalf': 'You are speaking for your companion: this is your own information. Staff will see it labelled “not the patient’s”.',
      'tr.list.owner_tag': 'Your own info — not the patient’s',
      'tr.fs.close': 'Exit',
      'tr.fs.close_aria': 'Exit full screen',
      'tr.fs.more': 'Scroll to see all {n} items',
      'tr.fs.call_aria': 'Call emergency number 115',
      'tr.res.speak': 'Read aloud', 'tr.res.stop': 'Stop',
      'tr.res.speak_tl': 'Listen in {lang}',
      'tr.res.fullscreen': 'Full screen',
      'tr.res.add': 'Add to list', 'tr.res.added': 'In your list',
      'tr.res.list': 'List ({n})',
      'tr.res.open_qr': 'Open QR medical profile',
      'tr.res.code': 'Code {code}',
      'tr.res.version': 'Content v{v}',
      'tr.res.review.in_review': 'awaiting medical sign-off',
      'tr.res.review.approved': 'approved by a medical advisor',
      'tr.res.review.draft': 'draft',
      'tr.res.review.retracted': 'retracted',
      'tr.vi.lead': 'Người bệnh muốn nói với anh/chị:',
      'tr.vi.answer_lead': 'Người bệnh trả lời:',
      'tr.vi.urgent': 'CẤP CỨU — cần gọi 115',
      'tr.vi.list_lead': 'Người bệnh muốn nói với anh/chị ({n} ý):',
      'tr.vi.severity': 'Mức độ: {x}',
      'tr.vi.severity_urgent': 'Mức độ: {x} — vẫn cần cấp cứu',
      'tr.vi.lead_behalf': 'Người đi cùng nói thay người bệnh:',
      'tr.vi.answer_lead_behalf': 'Người đi cùng trả lời thay người bệnh:',
      'tr.vi.list_lead_behalf': 'Người đi cùng nói thay người bệnh ({n} ý):',
      'tr.vi.lead_owner': 'Thông tin y tế của người đang cầm máy (chủ điện thoại) — KHÔNG phải của người bệnh:',
      'tr.vi.owner_tag': 'Của người đang cầm máy — không phải của người bệnh',
      'tr.vi.owner_tts': 'Sau đây là thông tin y tế của người đang cầm máy, không phải của người bệnh.',
      'tr.vi.code': 'Mã {code}',
      'tr.vi.version': 'Nội dung v{v}',
      'tr.vi.review.in_review': 'chờ cố vấn y tế ký duyệt',
      'tr.vi.review.approved': 'đã được cố vấn y tế duyệt',
      'tr.vi.review.draft': 'bản nháp',
      'tr.vi.review.retracted': 'đã thu hồi',
      'tr.vi.src_profile': 'Người dùng tự khai trong hồ sơ y tế',
      'tr.vi.fs_disc': 'Câu do người bệnh tự chọn trên ứng dụng hỗ trợ giao tiếp, không phải chẩn đoán. Gọi 115 khi nghi ngờ nguy hiểm.',
      'tr.vi.fs_disc_behalf': 'Câu do người đi cùng chọn thay người bệnh trên ứng dụng hỗ trợ giao tiếp, không phải chẩn đoán. Gọi 115 khi nghi ngờ nguy hiểm.',
      'tr.vi.fs_exit': 'Chạm vào màn hình để thoát',
      'tr.vi.fs_more': 'Cuộn để xem hết {n} ý',
      'tr.tts.unsupported': "This browser can't read aloud. Show the screen to the medical staff instead.",
      'tr.tts.no_voice': 'No {lang} voice on this device. Show the screen instead, or install a voice in the system settings.',
      'tr.tts.error': "Couldn't read aloud — show the screen to the medical staff instead.",
      'tr.tts.vi': 'Vietnamese',
      'tr.fs.exit': 'Tap anywhere to exit',
      'tr.fs.aria': 'Full-screen sentence for medical staff',
      'tr.list.title': 'List for medical staff',
      'tr.list.sub': 'Collect several sentences for the staff to read at once.',
      'tr.list.count': '{n} sentences',
      'tr.list.open': 'Open',
      'tr.list.added': 'Added to the list ({n})',
      'tr.list.exists': 'This sentence is already in the list',
      'tr.list.remove': 'Remove from list',
      'tr.list.clear': 'Clear all', 'tr.list.cleared': 'List cleared',
      'tr.list.empty': 'The list is empty',
      'tr.list.empty_hint': 'Tap “Add to list” on a result or a quick phrase.',
      'tr.list.add_profile': 'Add my medical info',
      'tr.list.profile_added': 'Added {n} sentences from your medical profile',
      'tr.list.privacy': 'The list stays in temporary memory on this device and is cleared when you close the app.',
      'tr.mine.title': 'My medical info',
      'tr.mine.sub': 'From your QR profile — encrypted, stays on this device',
      'tr.mine.show': 'Show big', 'tr.mine.add': 'Add to list',
      'tr.mine.none_title': 'No medical profile yet',
      'tr.mine.none_text': 'Fill in 4 fields (blood type, allergies, conditions, medicines) to tell staff in one tap.',
      'tr.mine.consent_title': 'Consent needed for medical data',
      'tr.mine.consent_text': "You haven't agreed to store sensitive medical data on this device (Decree 356/2025/NĐ-CP).",
      'tr.mine.cta': 'Open QR profile',
      'tr.quick.title': 'Quick phrases',
      'tr.quick.hint': 'One tap shows the sentence big, in Vietnamese.',
      'tr.staff.title': 'Questions staff ask',
      'tr.staff.hint': 'Staff pick a question in Vietnamese — you read it in your language and tap an answer.',
      'tr.staff.asks': 'The medical staff asks you',
      'tr.staff.tap_answer': 'Tap your answer',
      'tr.staff.answers': '{n} answers',
      'tr.staff.another': 'Another question', 'tr.staff.again': 'Change answer',
      'tr.timer.aria': 'Field-test stopwatch',
      'tr.timer.result': '{s} s · {n} taps',
      'tr.timer.saved': 'Field-test result saved: {s} s, {n} taps',
      'tr.foot.meta': 'Medical phrasebook v{v}',
      'tr.foot.count': '{n} sentences · {l} languages',
      'tr.empty.title': 'The medical phrasebook could not be loaded',
      'tr.empty.text': 'Call 115, or open your QR profile so medical staff can read your information.'
    }
  });

  /* ================================================================== */
  /* STATE                                                                */
  /* ================================================================== */
  var S = { tab: 'sym', step: 'group', g: null, s: null, c: null, sev: null, q: null, st: null, ans: null };
  var root = null, els = {};
  var visible = false;
  var trail = [];            // keys ("tab:step") of history entries this screen pushed, oldest first
  var pendingPush = null;
  var lastRendered = null;   // "tab:step" rendered last (scroll/focus only when it changes)
  var list = [];             // statement list (memory only — never persisted)
  var mine = { state: 'loading', stmts: [] };
  var timer = null;          // {t0, taps, done, ms}
  var timerInt = 0;
  var hotGroup = null;
  var tts = { key: null };
  var fs = null;             // open full-screen overlay controller
  var behalf = false;        // "I am speaking for my companion" (memory only): staff lead lines say so
  var more = { open: false, key: null }; // result "More details" stays open across re-renders of the same statement

  /* ================================================================== */
  /* CONTENT HELPERS                                                      */
  /* ================================================================== */
  function languages() { var P = data(); return P ? P.languages.filter(function (l) { return l.code !== 'vi'; }) : []; }
  function langInfo(code) { var P = data(); return P ? P.languages.filter(function (l) { return l.code === code; })[0] || null : null; }
  function langName(code) { var li = langInfo(code); return li ? li.name : code; }
  function langTts(code) { var li = langInfo(code); return (li && li.tts) || code; }
  /** i18n string with a {lang} slot → HTML in which the native language name carries its own lang attribute. */
  function langIn(key, code) {
    var mark = '\u0001L\u0001';
    return esc(t(key, { lang: mark })).split(mark).join('<span lang="' + esc(code) + '">' + esc(langName(code)) + '</span>');
  }
  function userLang() {
    var l = NC.settings ? NC.settings.get('user_lang') : 'en';
    return languages().some(function (x) { return x.code === l; }) ? l : 'en';
  }
  /** Pick a language from a {7} text object with fallbacks. */
  function tx(obj, l) { if (!obj) return ''; return obj[l] || obj.en || obj.vi || ''; }
  function byId(arr, id) { return (arr || []).filter(function (x) { return x.id === id; })[0] || null; }
  function group() { var P = data(); return P ? byId(P.groups, S.g) : null; }
  function symptom() { var g = group(); return g ? byId(g.symptoms, S.s) : null; }
  function child() { var s = symptom(); return (s && s.children) ? byId(s.children, S.c) : null; }
  function leaf() { var s = symptom(); if (!s) return null; return s.children ? child() : s; }
  function severity(id) { var P = data(); return P ? byId(P.severities, id) : null; }
  function quick(id) { var P = data(); return P ? byId(P.quick, id) : null; }
  function staffQ(id) { var P = data(); return P ? byId(P.staff, id) : null; }
  function phraseCount() {
    var P = data(), n = 0;
    if (!P) return 0;
    P.groups.forEach(function (g) { g.symptoms.forEach(function (s) { n += (s.children ? s.children.length : 1) * 3; }); });
    return n + P.quick.length;
  }
  function reviewLabel() {
    var P = data(); var st = (P && P.review && P.review.status) || 'in_review';
    var k = 'tr.res.review.' + st;
    return (NC.i18n && NC.i18n.has(k)) ? t(k) : st;
  }
  /** Phrasebook review note (demo content, not yet signed off) in the UI language. */
  function reviewNote() {
    var P = data(); var r = (P && P.review) || {};
    return (uiLang() === 'en' ? r.note_en : r.note) || '';
  }
  /** Review status in Vietnamese (staff-facing full-screen footer), whatever the UI language. */
  function reviewLabelVi() {
    var P = data(); var st = (P && P.review && P.review.status) || 'in_review';
    var k = 'tr.vi.review.' + st;
    return (NC.i18n && NC.i18n.has(k)) ? t(k) : st;
  }
  function uiLang() { return NC.i18n && NC.i18n.lang ? NC.i18n.lang() : 'vi'; }
  /** Severity label for a node: optional node-level `labels` override (e.g. snake bite "No symptoms yet"), else the global one. */
  function sevLabel(node, sevId) {
    var o = node && node.labels && node.labels[sevId];
    if (o && o.vi) return o;
    var sv = severity(sevId);
    return sv ? sv.label : null;
  }
  /** Severity hint: node-level `hints` override (FIX_CONTRACT C14) → global hint, with safe fallbacks for older data. */
  function sevHint(node, sv, ph) {
    var o = node && node.hints && node.hints[sv.id];
    if (o && (o.vi || o.en)) return o;
    var h = sv.hint || {};
    var urgent = !!(ph && ph.urgent);
    if (sv.id === 'severe' && !urgent && /115/.test(String(h.vi || '') + String(h.en || ''))) return HINT_FALLBACK.severe_plain;
    if (sv.id === 'mild' && urgent) return HINT_FALLBACK.mild_urgent;
    return h;
  }
  /** "Mức độ: Nặng" — an urgent phrase never reads as a reassuring low level. */
  function sevChipText(node, sevId, urgent) {
    var lb = sevLabel(node, sevId); if (!lb) return '';
    return t(urgent && sevId !== 'severe' ? 'tr.vi.severity_urgent' : 'tr.vi.severity', { x: lb.vi });
  }
  function isBehalfQuick(q) { return !!(q && (q.behalf === true || q.id === 'q-on-behalf')); }
  function isProf(x) { return !!(x && (x.kind === 'profile' || x.kind === 'profileItem')); }
  /**
   * A statement as staff should read it in the current mode: while the user speaks for a companion, quick phrases that
   * point at "my phone / my QR / my profile" use their companion wording (phrases.js text_behalf).
   */
  function shown(s) {
    var q = s && s.kind === 'quick' ? (s.quick || quick(s.code)) : null;
    if (!q || !q.text_behalf) return s;
    var want = behalf ? q.text_behalf : q.text;
    if (s.text === want) return s;
    var o = {};
    Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    o.text = want;
    return o;
  }
  /**
   * Staff order of a multi-statement view. In behalf mode the phone owner's profile lines are never presented as the
   * patient's: the companion's statements come first, then the owner's lines under their own lead (owner = index of the
   * first owner line, -1 when there is none or when the view holds only owner lines — then the main lead says so).
   */
  function staffOrder(items) {
    items = items.map(shown);
    if (!behalf) return { items: items, owner: -1, patient: items.length };
    var pat = items.filter(function (x) { return !isProf(x); });
    var own = items.filter(isProf);
    if (!own.length || !pat.length) return { items: items, owner: -1, patient: pat.length };
    return { items: pat.concat(own), owner: pat.length, patient: pat.length };
  }
  /** Staff-facing Vietnamese lead line above a statement (or above the list when multi). */
  function leadFor(st, multi, n) {
    if (multi) return t(behalf ? 'tr.vi.list_lead_behalf' : 'tr.vi.list_lead', { n: n });
    if (st.kind === 'quick' && st.quick && st.quick.lead && st.quick.lead.vi) return st.quick.lead.vi;
    if (st.kind === 'quick' && isBehalfQuick(st.quick)) return t('tr.vi.lead_behalf');
    if (st.kind === 'answer') return t(behalf ? 'tr.vi.answer_lead_behalf' : 'tr.vi.answer_lead');
    if (behalf && (st.kind === 'profile' || st.kind === 'profileItem')) return t('tr.vi.lead_owner');
    return t(behalf ? 'tr.vi.lead_behalf' : 'tr.vi.lead');
  }
  /** Terminology source(s) for MOD.01 (PDF bảng PL.3): phrasebook `sources` if present, else the first-aid sources scoped to MOD.01. */
  function termsHtml() {
    var P = data(); var en = uiLang() === 'en';
    var list = (P && Array.isArray(P.sources) && P.sources.length) ? P.sources : [];
    if (!list.length) {
      var FA = window.NC_FIRSTAID;
      list = ((FA && FA.sources) || []).filter(function (s) { return /MOD\.01/.test(String((s.scope && s.scope.vi) || '')); });
    }
    return list.map(function (s) {
      var name = en ? (s.short_en || s.short) : s.short;
      var viOnly = en && !s.short_en;
      var title = en ? (s.title_en || s.title) : s.title;
      // PDF 8.1: document + year — an unknown edition says so instead of silently dropping the year.
      return '<span' + (viOnly ? ' lang="vi"' : '') + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(name) + '</span>' +
        (s.year ? ' ' + esc(s.year) : ' <span class="tr-result__tbc">(' + esc(t('tr.res.year_tbc')) + ')</span>');
    }).join(' · ');
  }

  /* ---------- statements: {key, code, urgent, text:{7}, kind, …context} ---------- */
  function treeStmt() {
    var node = leaf(); if (!node || !S.sev || !node.phrases[S.sev]) return null;
    var ph = node.phrases[S.sev];
    return { key: ph.code, code: ph.code, urgent: !!ph.urgent, text: ph.text, kind: 'tree', g: group(), s: symptom(), c: child(), sev: S.sev, node: node };
  }
  function quickStmt(q) { return q ? { key: q.id, code: q.id, urgent: !!q.urgent, text: behalf && q.text_behalf ? q.text_behalf : q.text, kind: 'quick', quick: q } : null; }
  /** Severity + node for a tree statement that came from outside (NC.translate.addToList with only a code). */
  function treeCtx(s) {
    if (!s || s.kind !== 'tree') return null;
    if (s.sev) return { sev: s.sev, node: s.node || null };
    var P = data(); var f = (P && typeof P.find === 'function' && s.code) ? P.find(s.code) : null;
    return f ? { sev: f.severity, node: f.child || f.symptom || null } : null;
  }
  function joinText(parts, sep) {
    var out = {};
    ['vi', 'en', 'zh', 'ko', 'ja', 'ru', 'fr'].forEach(function (l) { out[l] = parts.map(function (p) { return tx(p, l); }).join(sep); });
    return out;
  }
  function answerStmt() {
    var q = staffQ(S.st); var a = q ? byId(q.answers, S.ans) : null;
    if (!q || !a) return null;
    var at = a.text, n = painLevel(a.id);
    if (n >= 0) { // pain scale: "7/10" (+ label such as "Đau nhất") instead of a bare number
      at = {};
      Object.keys(a.text).forEach(function (l) {
        var lbl = String(a.text[l]).replace(/^\d+\s*[–-]?\s*/, '');
        at[l] = n + '/10' + (lbl ? ' – ' + lbl : '');
      });
    }
    return { key: q.id + ':' + a.id, code: q.id + ':' + a.id, urgent: false, text: joinText([q.text, at], ' → '), kind: 'answer', q: q, a: a, at: at };
  }
  function profileCombined() {
    if (!mine.stmts.length) return null;
    var texts = mine.stmts.map(function (s) { return s.text; });
    return { key: 'profile', code: 'PROFILE', urgent: false, text: joinText(texts, '\n'), kind: 'profile', parts: mine.stmts.slice() };
  }
  /** Statement(s) shown on the current result step. */
  function currentStmt() {
    if (S.tab === 'sym' && S.step === 'result') return treeStmt();
    if (S.tab === 'quick' && S.step === 'result') return S.q === 'profile' ? profileCombined() : quickStmt(quick(S.q));
    if (S.tab === 'staff' && S.step === 'answer') return answerStmt();
    return null;
  }
  function stmtsFor(st) { return st ? (st.kind === 'profile' ? st.parts : [st]) : []; }

  /* ---------- profile statements (MOD.03 → templates) ---------- */
  function fillTemplate(tpl, value, isNone) {
    var out = {};
    Object.keys(tpl).forEach(function (l) { out[l] = String(tpl[l]).replace('{x}', isNone ? (NONE_WORD[l] || NONE_WORD.en) : value); });
    return out;
  }
  /** "Không có / None", "không", "none", "N/A"… → true (every part of a bilingual "a / b" value must be a none word). */
  function isNoneValue(v) {
    var whole = U.normalize(v).replace(/[.!]+$/, '');
    if (NONE_RE.test(whole)) return true;
    var parts = whole.split(/\s*\/\s*/).filter(Boolean);
    return parts.length > 1 && parts.every(function (x) { return NONE_RE.test(x); });
  }
  function buildProfileStmts(p) {
    var P = data(); var T = P && P.templates;
    if (!p || !p.public || !T) return [];
    var pub = p.public, out = [];
    var rows = [['blood', 'blood_type'], ['allergy', 'allergies'], ['condition', 'conditions'], ['medication', 'medications']];
    rows.forEach(function (r) {
      var raw = pub[r[1]];
      var v = raw === undefined || raw === null ? '' : String(raw).trim();
      if (!v) return;
      var none = isNoneValue(v) || (r[1] === 'blood_type' && v === 'unknown');
      var text;
      if (none) {
        // Natural negative sentences ("I have no known allergies.") when the phrasebook provides them (FIX_CONTRACT C14).
        var tn = T[r[1] === 'blood_type' ? 'blood_unknown' : r[0] + '_none'];
        if (tn && tn.vi) text = tn;
        else if (r[1] === 'blood_type') return; // older data: an unknown blood type is simply not stated
        else text = fillTemplate(T[r[0]], v, true);
      } else {
        if (r[1] === 'blood_type') v = v.replace(/-$/, '−'); // display with a true minus sign
        text = fillTemplate(T[r[0]], v, false);
      }
      out.push({ key: 'profile.' + r[0], code: 'PROFILE-' + r[0].toUpperCase(), urgent: false, text: text, kind: 'profileItem' });
    });
    return out;
  }
  function loadMine() {
    if (!NC.profile || typeof NC.profile.get !== 'function') { mine = { state: 'none', stmts: [] }; return Promise.resolve(mine); }
    var cP = (NC.profile.consents && NC.profile.consents.get) ? NC.profile.consents.get() : Promise.resolve({ sensitive: true });
    return Promise.all([Promise.resolve(NC.profile.get()).catch(function () { return null; }), Promise.resolve(cP).catch(function () { return {}; })])
      .then(function (r) {
        var p = r[0], c = r[1] || {};
        var stmts = buildProfileStmts(p);
        if (!c.sensitive && !stmts.length) mine = { state: 'consent', stmts: [] };
        else mine = { state: stmts.length ? 'ok' : 'none', stmts: stmts };
        return mine;
      });
  }

  /* ================================================================== */
  /* BODY SILHOUETTE (original front-view figure, 6 tappable areas)       */
  /* ================================================================== */
  var W = 220;
  function mirror(d) {
    return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, function (m, x, y) { return (Math.round((W - parseFloat(x)) * 10) / 10) + ' ' + y; });
  }
  var ARM = 'M67 97 C58 99 53 107 52 119 C50 137 49 153 47 169 C45 187 41 205 38 223 C35 231 31 241 33 250 C35 258 43 260 47 254 C50 249 52 239 53 229 C56 211 61 191 65 171 C68 155 70 141 71 127 Z';
  var LEG = 'M71 214 C67 246 68 279 73 309 C75 331 73 351 77 379 L75 393 C75 398 78 400 84 400 L99 400 C103 400 104 396 102 392 L100 379 C102 351 105 329 105 309 C106 285 108 265 110 250 Z';
  var CHEST = 'M96 86 C88 90 76 92 68 96 C62 99 60 106 62 114 L70 132 C71 146 72 158 74 169 L146 169 C148 158 149 146 150 132 L158 114 C160 106 158 99 152 96 C144 92 132 90 124 86 C118 90 102 90 96 86 Z';
  var ABD = 'M74 169 L146 169 C147 187 149 203 150 219 C144 233 126 245 110 251 C94 245 76 233 70 219 C71 203 73 187 74 169 Z';
  var NECK = 'M99 68 C99 76 98 82 95 88 C103 92 117 92 125 88 C122 82 121 76 121 68 Z';
  var HEAD_EL = { cx: 110, cy: 45, rx: 25, ry: 30 };
  var DOTS = { head: [[110, 42]], chest: [[110, 124]], abdomen: [[110, 206]], arms: [[55, 176], [165, 176]], legs: [[88, 316], [132, 316]] };

  /*
   * Hotspots: real <button>s laid over the decorative SVG (native focus, Enter/Space, accessible names in the
   * traveler's language + Vietnamese). Geometry lives in translate.css (.tr-hot--<key>, viewBox units); every hotspot
   * is at least var(--tap) × var(--tap). The two arms are one group: the right-hand copy is pointer-only (tabindex -1,
   * aria-hidden) so keyboard and screen-reader users meet "Arms" once. DOM order = top-to-bottom focus order.
   */
  var HOTS = [
    { key: 'head', id: 'head' }, { key: 'chest', id: 'chest' }, { key: 'abdomen', id: 'abdomen' },
    { key: 'arm-l', id: 'arms' }, { key: 'arm-r', id: 'arms', dup: true }, { key: 'legs', id: 'legs' }
  ];
  function bodyPart(g, inner) {
    var tone = TONES[g] || 'primary';
    return '<g class="tr-body__part tr-tone--' + tone + (S.g === g ? ' is-selected' : '') + '" data-tr-g="' + g + '">' + inner + '</g>';
  }
  /** Traveler-language label + Vietnamese, each with its own lang (also the button's accessible name). */
  function regionLabel(g, l, cls) {
    return '<span class="' + cls + '__tl" lang="' + esc(l) + '">' + esc(tx(g.label, l)) + '</span>' +
      '<span class="visually-hidden">, </span><span class="' + cls + '__vi" lang="vi">' + esc(g.label.vi) + '</span>';
  }
  function hotspots(l) {
    var P = data();
    return HOTS.map(function (h) {
      var g = byId(P.groups, h.id); if (!g) return '';
      var tone = TONES[g.id] || 'primary';
      var sel = S.g === g.id;
      // The region chosen last (shown solid after Back) is announced as "current", not only drawn.
      return '<button type="button" class="tr-hot tr-hot--' + h.key + ' tr-tone--' + tone + (sel ? ' is-selected' : '') + '"' +
        ' data-tr-act="group" data-id="' + esc(g.id) + '" data-tr-g="' + esc(g.id) + '"' + (h.dup ? ' tabindex="-1" aria-hidden="true"' : (sel ? ' aria-current="true"' : '')) + '>' +
        '<span class="tr-hot__tip">' + regionLabel(g, l, 'tr-hot') + '</span></button>';
    }).join('');
  }
  function bodySvg() {
    var head = '<ellipse cx="' + HEAD_EL.cx + '" cy="' + HEAD_EL.cy + '" rx="' + HEAD_EL.rx + '" ry="' + HEAD_EL.ry + '"/>';
    var shapes = {
      arms: '<path d="' + ARM + '"/><path d="' + mirror(ARM) + '"/>',
      legs: '<path d="' + LEG + '"/><path d="' + mirror(LEG) + '"/>',
      abdomen: '<path d="' + ABD + '"/>',
      chest: '<path d="' + CHEST + '"/>',
      head: '<path d="' + NECK + '"/>' + head
    };
    var halo = '<g class="tr-body__halo tr-tone--primary' + (S.g === 'skin' ? ' is-selected' : '') + '" data-tr-g="skin">' +
      shapes.arms + shapes.legs + shapes.abdomen + shapes.chest + shapes.head + '</g>';
    var dots = '';
    Object.keys(DOTS).forEach(function (g) {
      DOTS[g].forEach(function (p) {
        dots += '<g class="tr-body__dot tr-tone--' + TONES[g] + (S.g === g ? ' is-selected' : '') + '" data-tr-g="' + g + '">' +
          '<circle class="tr-body__dot-ring" cx="' + p[0] + '" cy="' + p[1] + '" r="9"/><circle class="tr-body__dot-core" cx="' + p[0] + '" cy="' + p[1] + '" r="4.2"/></g>';
      });
    });
    return '<svg class="tr-body" viewBox="0 0 ' + W + ' 416" aria-hidden="true" focusable="false">' +
      '<ellipse class="tr-body__glow" cx="110" cy="190" rx="98" ry="150"/>' +
      '<ellipse class="tr-body__floor" cx="110" cy="404" rx="62" ry="8"/>' +
      halo +
      bodyPart('arms', shapes.arms) + bodyPart('legs', shapes.legs) + bodyPart('abdomen', shapes.abdomen) +
      bodyPart('chest', shapes.chest) + bodyPart('head', shapes.head) +
      '<g class="tr-body__detail"><path d="M84 104 C94 108 102 108 108 104 M112 104 C118 108 126 108 136 104"/><circle cx="110" cy="206" r="1.6"/></g>' +
      dots + '</svg>';
  }
  function setHot(g) {
    if (g === hotGroup || !root) return;
    hotGroup = g;
    U.$$('[data-tr-g]', root).forEach(function (el) {
      var on = !!g && el.getAttribute('data-tr-g') === g;
      if (el.classList) el.classList.toggle('is-hot', on);
      else el.setAttribute('class', (el.getAttribute('class') || '').replace(/\s?is-hot/g, '') + (on ? ' is-hot' : ''));
    });
  }

  /* ================================================================== */
  /* PAIN FACES (original, parametric 0–10)                               */
  /* ================================================================== */
  function painTone(n) { return n <= 2 ? 'success' : n <= 5 ? 'warning' : n <= 7 ? 'accent' : 'danger'; }
  function faceSvg(n, cls) {
    var eyes = n >= 8
      ? '<path class="tr-face__line" d="M14.5 17 L20.5 20 L14.5 23 M33.5 17 L27.5 20 L33.5 23"/>'
      : '<circle class="tr-face__ink" cx="18" cy="20" r="2.5"/><circle class="tr-face__ink" cx="30" cy="20" r="2.5"/>';
    var brows = n >= 4 ? '<path class="tr-face__line" d="M12.5 ' + (15 - (n - 4) * 0.25) + ' L20.5 ' + (12 - (n - 4) * 0.35) + ' M35.5 ' + (15 - (n - 4) * 0.25) + ' L27.5 ' + (12 - (n - 4) * 0.35) + '"/>' : '';
    var mouth;
    if (n >= 9) mouth = '<path class="tr-face__ink" d="M16.5 34.5 Q24 25.5 31.5 34.5 Q24 32.5 16.5 34.5 Z"/>';
    else { var c = 7 - n * 1.6; var y = 31 + (n > 5 ? 2 : 0); mouth = '<path class="tr-face__line" d="M16 ' + y + ' Q24 ' + (y + c) + ' 32 ' + y + '"/>'; }
    var tear = n >= 9 ? '<path class="tr-face__tear" d="M15 25 C13.4 28 13.4 30 15 30.6 C16.6 30 16.6 28 15 25 Z"/>' : '';
    return '<svg class="tr-face tr-tone--' + painTone(n) + (cls ? ' ' + cls : '') + '" viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
      '<circle class="tr-face__bg" cx="24" cy="24" r="21"/>' + brows + eyes + mouth + tear + '</svg>';
  }
  function painLevel(answerId) { var m = /^p(\d+)$/.exec(answerId || ''); return m ? parseInt(m[1], 10) : -1; }

  /* ================================================================== */
  /* RENDER                                                               */
  /* ================================================================== */
  function isRoot() { return S.step === STEPS[S.tab][0]; }
  function isResult() { return (S.tab === 'sym' || S.tab === 'quick') ? S.step === 'result' : S.step === 'answer'; }

  function render() {
    if (!root) return;
    var P = data();
    root.setAttribute('data-tab', S.tab);
    root.setAttribute('data-step', S.step);
    root.classList.toggle('is-deep', !isRoot());
    root.classList.toggle('is-result', isResult());
    renderLang();
    renderTabs();
    renderListbar();
    TABS.forEach(function (tb) {
      var pn = els.panels[tb]; if (!pn) return;
      pn.hidden = tb !== S.tab;
      if (pn.hidden && pn.firstChild) pn.innerHTML = ''; // no stale duplicate ids in hidden panels
    });
    var panel = els.panels[S.tab];
    if (!panel) return;
    if (!P) {
      panel.innerHTML = '';
      panel.appendChild(NC.ui.emptyState({ icon: 'languages', variant: 'warning', title: t('tr.empty.title'), text: t('tr.empty.text'),
        action: { label: t('tr.mine.cta'), icon: 'qr', href: '#/qr?view=rescuer', variant: 'primary' } }));
      return;
    }
    var html = flowHtml();
    if (S.tab === 'sym') {
      if (S.step === 'group') html += viewGroups();
      else if (S.step === 'symptom') html += viewSymptoms();
      else if (S.step === 'detail') html += viewDetails();
      else if (S.step === 'severity') html += viewSeverity();
      else html += viewResult(currentStmt());
    } else if (S.tab === 'quick') {
      html += S.step === 'result' ? viewResult(currentStmt()) : viewQuick();
    } else {
      if (S.step === 'question') html += viewQuestion();
      else if (S.step === 'answer') html += viewResult(currentStmt());
      else html += viewStaffList();
    }
    panel.innerHTML = html;
    hotGroup = null;
    if (isResult()) finishTimer(currentStmt());
    updateTimer();
    renderFoot();
  }

  function renderLang() {
    if (!els.lang) return;
    var cur = userLang();
    els.lang.innerHTML = languages().map(function (l) {
      var on = l.code === cur;
      return '<button type="button" class="chip tr-lchip' + (on ? ' is-selected' : '') + '" role="radio" aria-checked="' + on + '" data-tr-act="lang" data-id="' + esc(l.code) + '" lang="' + esc(l.code) + '" title="' + esc(l.name_en) + '">' +
        (on ? icon('check', 'tr-lchip__check') : '') + '<span>' + esc(l.name) + '</span></button>';
    }).join('');
    if (window.requestAnimationFrame) window.requestAnimationFrame(langFade); else langFade();
  }
  /** Phones: the language row scrolls sideways; its right-edge fade (.scroll-fade-x) goes once the end is reached. */
  function langFade() {
    var r = els.lang; if (!r || !r.clientWidth) return; // hidden screen: measure again on the next render
    r.classList.toggle('is-end', r.scrollLeft + r.clientWidth >= r.scrollWidth - 2);
  }
  function renderTabs() {
    U.$$('[data-tr-tab]', root).forEach(function (b) {
      var on = b.getAttribute('data-tr-tab') === S.tab;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
  }
  function renderListbar() {
    var bar = els.listbar; if (!bar) return;
    bar.hidden = !list.length || isResult();
    // .has-list: the body figure (step 1) subtracts the bar's height so the figure + "Skin" pill stay above the tab bar.
    root.classList.toggle('has-list', !bar.hidden);
    if (bar.hidden) { bar.innerHTML = ''; return; }
    bar.innerHTML = '<button type="button" class="tr-listbar__btn" data-tr-act="list">' +
      '<span class="icon-tile icon-tile--sm icon-tile--solid">' + icon('list-checks') + '</span>' +
      '<span class="tr-listbar__text"><span class="tr-listbar__title">' + esc(t('tr.list.title')) + '</span>' +
      '<span class="tr-listbar__meta">' + esc(t('tr.list.count', { n: list.length })) + '</span></span>' +
      '<span class="btn btn--primary btn--sm tr-listbar__go">' + esc(t('tr.list.open')) + icon('chevron-right') + '</span></button>';
  }
  /**
   * Footer: phrasebook version + review status on one line; count, languages and the review note folded under it.
   * Hidden on result steps, whose own "More details" carries the same facts (each status once per screen).
   */
  function renderFoot() {
    var P = data(); if (!els.footMeta || !P) return;
    var res = isResult();
    els.footMeta.hidden = res;
    if (res) { els.footMeta.innerHTML = ''; return; }
    var note = reviewNote();
    var open = !!(els.footMeta.querySelector('details') && els.footMeta.querySelector('details').open);
    // Shared "technical details" disclosure (components.css .disclosure): version as title, review status as subtitle.
    els.footMeta.innerHTML = '<details class="disclosure tr-foot__more"' + (open ? ' open' : '') + '>' +
      '<summary class="disclosure__sum">' + icon('book-open') + '<span class="disclosure__txt">' +
      '<span class="disclosure__title">' + esc(t('tr.foot.meta', { v: P.version })) + '</span>' +
      '<span class="disclosure__sub">' + esc(reviewLabel()) + '</span></span>' +
      '<span class="disclosure__chev">' + icon('chevron-down') + '</span></summary>' +
      '<div class="disclosure__body"><p class="tr-foot__note">' + esc(t('tr.foot.count', { n: phraseCount(), l: P.languages.length })) + (note ? '. ' + esc(note) : '') + '</p></div></details>';
  }

  /* ---------- flow bar: back · stepper · timer · restart ---------- */
  function flowSteps() {
    var s = symptom();
    return ['group', 'symptom'].concat(s && s.children ? ['detail'] : []).concat(['severity']);
  }
  function flowHtml() {
    var showBack = !isRoot();
    var timerOn = timerEnabled();
    var stepper = S.tab === 'sym';
    if (!showBack && !timerOn && !stepper) return '';
    var compactBack = stepper && !isResult();
    var html = '<div class="tr-flow' + (stepper ? ' tr-flow--stepper' : '') + '">';
    if (showBack) {
      html += '<button type="button" class="btn btn--ghost btn--sm tr-flow__back' + (compactBack ? ' tr-flow__back--icon' : '') + '" data-tr-act="back"' +
        (compactBack ? ' aria-label="' + esc(t('tr.back')) + '" title="' + esc(t('tr.back')) + '"' : '') + '>' +
        icon('arrow-left') + '<span class="tr-flow__back-label">' + esc(S.tab === 'staff' && S.step === 'answer' ? t('tr.staff.again') : t('tr.back')) + '</span></button>';
    }
    if (stepper) {
      var steps = flowSteps();
      var cur = S.step === 'result' ? steps.length : steps.indexOf(S.step);
      html += '<ol class="stepper tr-stepper" aria-label="' + esc(t('tr.step.aria')) + '">' + steps.map(function (st, i) {
        var cls = i < cur ? ' is-done' : (i === cur ? ' is-current' : '');
        var label = esc(t('tr.step.' + st));
        var inner = i < cur
          ? '<button type="button" class="tr-stepper__btn" data-tr-act="jump" data-step="' + st + '" aria-label="' + esc(t('tr.step.jump', { name: t('tr.step.' + st) })) + '">' + label + '</button>'
          : '<span' + (i === cur ? ' aria-current="step"' : '') + '>' + label + '</span>';
        return '<li class="stepper__step' + cls + '">' + inner + '</li>';
      }).join('') + '</ol>';
    }
    if (timerOn || isResult()) {
      html += '<span class="tr-flow__end">';
      if (timerOn) html += '<span class="badge badge--info tr-timer" id="tr-timer" role="timer" aria-label="' + esc(t('tr.timer.aria')) + '">' + icon('timer') + '<span class="tr-timer__val">0,0 s</span></span>';
      if (isResult()) html += '<button type="button" class="btn btn--ghost btn--sm tr-flow__restart" data-tr-act="restart">' + icon(S.tab === 'staff' ? 'list' : 'rotate-ccw') + '<span>' + esc(S.tab === 'staff' ? t('tr.staff.another') : t('tr.restart')) + '</span></button>';
      html += '</span>';
    }
    return html + '</div>';
  }
  function headHtml(title, hint, eyebrow, id) {
    return '<div class="tr-head">' + (eyebrow || '') +
      '<h2 class="tr-head__title"' + (id ? ' id="' + id + '"' : '') + ' tabindex="-1" data-tr-focus>' + esc(title) + '</h2>' +
      (hint ? '<p class="tr-head__hint">' + esc(hint) + '</p>' : '') + '</div>';
  }
  /** Bilingual crumb "icon · traveler label · VI label" used above step titles. */
  function crumb(tone, ic, labelObj, l) {
    return '<p class="tr-crumb tr-tone--' + tone + '"><span class="icon-tile icon-tile--sm icon-tile--' + tone + '">' + icon(ic) + '</span>' +
      '<span class="tr-crumb__tl" lang="' + l + '">' + esc(tx(labelObj, l)) + '</span>' +
      (l !== 'vi' ? '<span class="tr-crumb__vi" lang="vi">' + esc(labelObj.vi) + '</span>' : '') + '</p>';
  }

  /* ---------- step 1: body areas (the figure is the only picker; "Skin & whole body" pill under it) ---------- */
  function viewGroups() {
    var P = data(), l = userLang();
    var skin = byId(P.groups, 'skin');
    var body = '<div class="card tr-bodycard" role="group" aria-labelledby="tr-group-title">' +
      '<div class="tr-bodycard__fig">' + bodySvg() + hotspots(l) + '</div>' +
      (skin ? '<button type="button" class="chip chip--lg tr-skin tr-tone--primary' + (S.g === 'skin' ? ' is-selected' : '') + '" data-tr-act="group" data-id="skin" data-tr-g="skin"' + (S.g === 'skin' ? ' aria-current="true"' : '') + '>' +
        icon(skin.icon) + '<span class="tr-skin__text">' + regionLabel(skin, l, 'tr-skin') + '</span></button>' : '') +
      '</div>';
    return headHtml(t('tr.group.title'), t('tr.body.caption'), '', 'tr-group-title') + body;
  }

  /* ---------- step 2: symptoms (children inline → still ≤ 4 taps) ---------- */
  function symCard(g, s, l) {
    var tone = TONES[g.id] || 'primary';
    var main = '<button type="button" class="tr-sym__main" data-tr-act="symptom" data-id="' + esc(s.id) + '">' +
      '<span class="icon-tile icon-tile--' + tone + '">' + icon(s.icon || g.icon) + '</span>' +
      '<span class="tr-sym__text"><span class="tr-sym__label" lang="' + l + '">' + esc(tx(s.label, l)) + '</span>' +
      '<span class="tr-sym__vi" lang="vi">' + esc(s.label.vi) + '</span></span>' +
      (s.children ? '<span class="badge badge--neutral tr-sym__count">' + esc(t('tr.sym.options', { n: s.children.length })) + '</span>' : '') +
      icon('chevron-right', 'tr-sym__go') + '</button>';
    var kids = '';
    if (s.children) {
      kids = '<div class="tr-sym__kids"><p class="tr-sym__kids-label">' + esc(t('tr.sym.quick_pick')) + '</p>' +
        s.children.map(function (c) {
          return '<button type="button" class="tr-kid" data-tr-act="child" data-sid="' + esc(s.id) + '" data-id="' + esc(c.id) + '">' +
            '<span class="tr-kid__text"><span class="tr-kid__label" lang="' + l + '">' + esc(tx(c.label, l)) + '</span>' +
            '<span class="tr-kid__vi" lang="vi">' + esc(c.label.vi) + '</span></span>' + icon('chevron-right') + '</button>';
        }).join('') + '</div>';
    }
    return '<article class="card card--pad-0 tr-sym tr-tone--' + tone + (s.children ? ' tr-sym--kids' : '') + (S.s === s.id ? ' is-last' : '') + '">' + main + kids + '</article>';
  }
  function viewSymptoms() {
    var g = group(), l = userLang();
    return headHtml(t('tr.sym.title'), t('tr.sym.hint'), crumb(TONES[g.id] || 'primary', g.icon, g.label, l)) +
      '<div class="tr-syms">' + g.symptoms.map(function (s) { return symCard(g, s, l); }).join('') + '</div>';
  }
  function viewDetails() {
    var g = group(), s = symptom(), l = userLang(), tone = TONES[g.id] || 'primary';
    var cards = s.children.map(function (c) {
      return '<article class="card card--pad-0 tr-sym tr-tone--' + tone + '"><button type="button" class="tr-sym__main" data-tr-act="child" data-sid="' + esc(s.id) + '" data-id="' + esc(c.id) + '">' +
        '<span class="icon-tile icon-tile--' + tone + '">' + icon(s.icon || g.icon) + '</span>' +
        '<span class="tr-sym__text"><span class="tr-sym__label" lang="' + l + '">' + esc(tx(c.label, l)) + '</span>' +
        '<span class="tr-sym__vi" lang="vi">' + esc(c.label.vi) + '</span></span>' + icon('chevron-right', 'tr-sym__go') + '</button></article>';
    }).join('');
    return headHtml(t('tr.detail.title'), t('tr.detail.hint'), crumb(tone, s.icon || g.icon, s.label, l)) + '<div class="tr-syms">' + cards + '</div>';
  }

  /* ---------- step 3: severity ---------- */
  function viewSeverity() {
    var P = data(), g = group(), s = symptom(), node = leaf(), l = userLang();
    var tone = TONES[g.id] || 'primary';
    var btns = P.severities.map(function (sv) {
      var ph = node.phrases[sv.id]; var lv = SEV_LEVEL[sv.id] || 1; var st = SEV_TONE[sv.id] || 'primary';
      var urgent = !!(ph && ph.urgent);
      var lab = sevLabel(node, sv.id) || sv.label;
      var hint = sevHint(node, sv, ph);
      var bars = '';
      for (var i = 1; i <= 3; i++) bars += '<i class="' + (i <= lv ? 'is-on' : '') + '" style="height:' + (8 + i * 7) + 'px"></i>';
      return '<button type="button" class="tr-sevbtn tr-tone--' + st + (urgent ? ' tr-sevbtn--urgent' : '') + '" data-tr-act="sev" data-id="' + esc(sv.id) + '">' +
        '<span class="tr-sevbtn__meter" aria-hidden="true">' + bars + '</span>' +
        '<span class="tr-sevbtn__body">' +
          '<span class="tr-sevbtn__top"><span class="tr-sevbtn__label' + (tx(lab, l).length > 16 ? ' is-long' : '') + '" lang="' + l + '">' + esc(tx(lab, l)) + '</span>' +
          (l !== 'vi' ? '<span class="tr-sevbtn__vi" lang="vi">' + esc(lab.vi) + '</span>' : '') +
          (urgent ? '<span class="badge badge--danger tr-sevbtn__urgent">' + icon('siren') + esc(t('tr.sev.urgent')) + '</span>' : '') + '</span>' +
          (tx(hint, l) ? '<span class="tr-sevbtn__hint" lang="' + (hint[l] ? l : (hint.en ? 'en' : 'vi')) + '">' + esc(tx(hint, l)) + '</span>' : '') +
        '</span>' + icon('chevron-right', 'tr-sevbtn__go') + '</button>';
    }).join('');
    var c = child();
    return headHtml(t('tr.sev.title'), t('tr.sev.hint'), crumb(tone, s.icon || g.icon, c ? c.label : s.label, l)) +
      '<div class="tr-sev">' + btns + '</div>';
  }

  /* ---------- result (tree phrase · quick phrase · profile · staff answer) ---------- */
  function ctxViHtml(st) {
    if (st.kind === 'tree') {
      var parts = [st.g.label.vi, st.s.label.vi].concat(st.c ? [st.c.label.vi] : []);
      var chip = sevChipText(st.node, st.sev, st.urgent);
      // An urgent phrase is always shown in the danger tone with the siren (never a green check "Nhẹ").
      var tone = st.urgent ? 'danger' : (SEV_TONE[st.sev] || 'neutral');
      var ic = st.urgent ? 'siren' : (SEV_ICON[st.sev] || 'info');
      return '<p class="tr-result__ctx" lang="vi">' + parts.map(esc).join('<span class="tr-result__sep" aria-hidden="true">›</span>') +
        (chip ? ' <span class="badge badge--' + tone + ' tr-result__sev' + (st.urgent ? ' is-urgent' : '') + '">' + icon(ic) + esc(chip) + '</span>' : '') + '</p>';
    }
    if (st.kind === 'answer') return '<p class="tr-result__ctx tr-result__ctx--q" lang="vi">' + icon('stethoscope', 'icon--sm') + '<span>' + esc(st.q.text.vi) + '</span></p>';
    return '';
  }
  function viewResult(st) {
    if (!st) return '';
    var l = userLang();
    var inList = list.some(function (x) { return x.key === st.key; }) || (st.kind === 'profile' && st.parts.every(function (p) { return list.some(function (x) { return x.key === p.key; }); }));
    var lead = leadFor(st, false);
    var viText = st.kind === 'answer' ? st.at.vi : st.text.vi;
    var tlText = st.kind === 'answer' ? tx(st.at, l) : tx(st.text, l);
    var pain = st.kind === 'answer' ? painLevel(st.a.id) : -1;
    var speaking = tts.key === st.key;
    var html = '<article class="tr-result' + (st.urgent ? ' tr-result--urgent' : '') + (st.kind === 'profile' ? ' tr-result--multi' : '') + '" aria-labelledby="tr-result-vi">';
    if (st.urgent) {
      html += '<div class="tr-result__urgent" role="alert">' +
        '<span class="tr-result__urgent-icon">' + icon('siren') + '</span>' +
        '<span class="tr-result__urgent-text"><b lang="vi">' + esc(t('tr.vi.urgent')) + '</b><span>' + esc(t('tr.res.urgent_body')) + '</span></span>' +
        '<a class="btn btn--white tr-result__call" href="tel:115" data-call="115">' + icon('phone') + '<span>115</span></a></div>';
    }
    html += '<p class="tr-result__show">' + icon('smartphone') + '<span>' + esc(t('tr.res.show_staff')) + '</span></p>';
    if (behalf) {
      html += '<p class="tr-result__behalf">' + icon('users') + '<span>' + esc(t('tr.behalf.on')) + '</span>' +
        '<button type="button" class="btn btn--ghost btn--sm tr-result__behalf-off" data-tr-act="behalf-off" aria-label="' + esc(t('tr.behalf.off_aria')) + '">' + esc(t('tr.behalf.off')) + '</button></p>';
    }
    html += '<div class="tr-result__main"><div class="tr-result__body">' + ctxViHtml(st) +
      '<p class="tr-result__lead" lang="vi">' + esc(lead) + '</p>' +
      '<div class="tr-result__vi-wrap">' + (pain >= 0 ? faceSvg(pain, 'tr-result__face') : '') +
      '<p class="tr-result__vi" id="tr-result-vi" lang="vi">' + esc(viText) + '</p></div>' +
      '<div class="tr-result__tl">' +
        '<div class="tr-result__tl-head"><button type="button" class="badge badge--primary tr-result__lang" data-tr-act="pick-lang" aria-label="' + esc(t('tr.lang.pick')) + '" title="' + esc(t('tr.lang.pick')) + '">' +
          icon('languages') + langIn('tr.res.translation', l) + icon('chevron-down') + '</button>' +
        '<button type="button" class="btn btn--ghost btn--sm btn--icon tr-result__tl-say" data-tr-act="speak-tl" aria-label="' + esc(t('tr.res.speak_tl', { lang: langName(l) })) + '" title="' + esc(t('tr.res.speak_tl', { lang: langName(l) })) + '">' + icon('volume') + '</button></div>' +
        (st.kind === 'answer' ? '<p class="tr-result__tl-q" lang="' + l + '">' + esc(tx(st.q.text, l)) + '</p>' : '') +
        (tlText !== viText || st.kind !== 'answer' ? '<p class="tr-result__tl-text" lang="' + l + '">' + esc(tlText) + '</p>' : '') +
      '</div>' +
      // The medical disclaimer is shown once, in the page footer (compact, with 115); the roaming note only on urgent results.
      (st.urgent ? '<p class="tr-result__disc tr-result__roam">' + icon('signal', 'icon--xs') + '<span>' + esc(t('tr.res.urgent_roam')) + '</span></p>' : '') + '</div>';
    /* actions */
    var acts = '<div class="tr-result__actions">' +
      '<button type="button" class="btn btn--primary btn--lg tr-act-speak' + (speaking ? ' is-speaking' : '') + '" data-tr-act="speak" aria-pressed="' + speaking + '">' +
        icon(speaking ? 'stop' : 'volume') + '<span>' + esc(t(speaking ? 'tr.res.stop' : 'tr.res.speak')) + '</span></button>' +
      '<button type="button" class="btn btn--outline btn--lg" data-tr-act="fullscreen">' + icon('maximize') + '<span>' + esc(t('tr.res.fullscreen')) + '</span></button>' +
      '<button type="button" class="btn btn--soft btn--lg' + (inList ? ' is-added' : '') + '" data-tr-act="add"' + (inList ? ' aria-disabled="true"' : '') + '>' +
        icon(inList ? 'check' : 'plus') + '<span>' + esc(t(inList ? 'tr.res.added' : 'tr.res.add')) + '</span></button>';
    if (list.length) acts += '<button type="button" class="btn btn--soft btn--lg" data-tr-act="list">' + icon('list-checks') + '<span>' + esc(t('tr.res.list', { n: list.length })) + '</span></button>';
    // Never send staff to the phone owner's QR while the user speaks for a companion (it is not the patient's).
    var wantsQr = !behalf && ((st.kind === 'quick' && /^q-(qr-profile|contact-family|drug-allergy)$/.test(st.code)) || (st.kind === 'answer' && st.a.id === 'see-qr'));
    if (wantsQr) acts += '<button type="button" class="btn btn--outline btn--lg" data-tr-act="qr">' + icon('qr') + '<span>' + esc(t('tr.res.open_qr')) + '</span></button>';
    acts += '</div>';
    var P = data();
    var terms = termsHtml();
    var note = reviewNote();
    // Audit details (phrase code, content version, review status, terminology source) folded behind "More details".
    var meta = '<details class="disclosure tr-result__more"' + (more.open && more.key === st.key ? ' open' : '') + '>' +
      '<summary class="disclosure__sum">' + icon('info') + '<span class="disclosure__txt"><span class="disclosure__title">' + esc(t('tr.res.more')) + '</span></span>' +
      '<span class="disclosure__chev">' + icon('chevron-down') + '</span></summary>' +
      '<div class="disclosure__body tr-result__meta"><span class="mono">' + esc(t('tr.res.code', { code: st.code })) + '</span>' +
      '<span>' + esc(t('tr.res.version', { v: P.version })) + '</span><span class="tr-result__review">' + icon('shield-check', 'icon--xs') + esc(reviewLabel()) + '</span>' +
      (terms ? '<span class="tr-result__terms">' + icon('book-open', 'icon--xs') + esc(t('tr.res.terms')) + ': ' + terms + '</span>' : '') +
      (note ? '<span class="tr-result__note">' + esc(note) + '</span>' : '') +
      '</div></details>';
    html += '<aside class="tr-result__side">' + acts + meta + '</aside></div>';
    return html + '</article>';
  }

  /* ---------- quick tab ---------- */
  function mineHtml() {
    var l = userLang();
    if (mine.state === 'loading') return '<section class="card tr-mine"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></section>';
    if (mine.state !== 'ok') {
      var consent = mine.state === 'consent';
      return '<section class="card tr-mine tr-mine--cta"><span class="icon-tile icon-tile--lg icon-tile--' + (consent ? 'warning' : 'info') + '">' + icon(consent ? 'lock' : 'id-card') + '</span>' +
        '<div class="tr-mine__cta-text"><h2 class="tr-mine__title">' + esc(t(consent ? 'tr.mine.consent_title' : 'tr.mine.none_title')) + '</h2>' +
        '<p class="tr-mine__sub">' + esc(t(consent ? 'tr.mine.consent_text' : 'tr.mine.none_text')) + '</p></div>' +
        '<button type="button" class="btn btn--primary" data-tr-act="goqr">' + icon('qr') + '<span>' + esc(t('tr.mine.cta')) + '</span></button></section>';
    }
    var rows = mine.stmts.map(function (s) {
      return '<li class="tr-mine__row"><span class="tr-mine__vi" lang="vi">' + esc(s.text.vi) + '</span><span class="tr-mine__tl" lang="' + l + '">' + esc(tx(s.text, l)) + '</span></li>';
    }).join('');
    var allIn = mine.stmts.every(function (p) { return list.some(function (x) { return x.key === p.key; }); });
    return '<section class="card tr-mine"><div class="tr-mine__head"><span class="icon-tile icon-tile--info">' + icon('id-card') + '</span>' +
      '<div><h2 class="tr-mine__title">' + esc(t('tr.mine.title')) + '</h2><p class="tr-mine__sub">' + icon('lock', 'icon--xs') + esc(t('tr.mine.sub')) + '</p></div></div>' +
      (behalf ? '<p class="tr-mine__behalf">' + icon('users', 'icon--sm') + '<span>' + esc(t('tr.mine.behalf')) + '</span></p>' : '') +
      '<ul class="tr-mine__list">' + rows + '</ul>' +
      '<div class="tr-mine__actions"><button type="button" class="btn btn--primary" data-tr-act="mine-show">' + icon('maximize') + '<span>' + esc(t('tr.mine.show')) + '</span></button>' +
      '<button type="button" class="btn btn--soft' + (allIn ? ' is-added' : '') + '" data-tr-act="mine-add"' + (allIn ? ' aria-disabled="true"' : '') + '>' + icon(allIn ? 'check' : 'plus') +
      '<span>' + esc(t(allIn ? 'tr.res.added' : 'tr.mine.add')) + '</span></button></div></section>';
  }
  function viewQuick() {
    var P = data(), l = userLang();
    var cards = P.quick.map(function (q) {
      var tone = q.urgent ? 'danger' : 'primary';
      var qt = behalf && q.text_behalf ? q.text_behalf : q.text;
      return '<button type="button" class="card card--interactive tr-qcard' + (q.urgent ? ' tr-qcard--urgent' : '') + '" data-tr-act="quick" data-id="' + esc(q.id) + '">' +
        '<span class="icon-tile icon-tile--' + (q.urgent ? 'solid-danger' : tone) + '">' + icon(q.icon) + '</span>' +
        '<span class="tr-qcard__text"><span class="tr-qcard__tl" lang="' + l + '">' + esc(tx(qt, l)) + '</span>' +
        '<span class="tr-qcard__vi" lang="vi">' + esc(qt.vi) + '</span></span></button>';
    }).join('');
    return '<div class="tr-quickwrap">' + mineHtml() + headHtml(t('tr.quick.title'), t('tr.quick.hint')) + '<div class="tr-quick">' + cards + '</div></div>';
  }

  /* ---------- staff tab ---------- */
  function viewStaffList() {
    var P = data(), l = userLang();
    var items = P.staff.map(function (q) {
      var ic = q.id === 'st-pain-scale' ? 'gauge' : 'help-circle';
      return '<li><button type="button" class="list-item tr-staffq" data-tr-act="staffq" data-id="' + esc(q.id) + '">' +
        '<span class="list-item__icon icon-tile icon-tile--sm icon-tile--' + (q.id === 'st-pain-scale' ? 'accent' : 'info') + '">' + icon(ic) + '</span>' +
        '<span class="list-item__body"><span class="list-item__title tr-staffq__vi" lang="vi">' + esc(q.text.vi) + '</span>' +
        '<span class="list-item__meta tr-staffq__tl" lang="' + l + '">' + esc(tx(q.text, l)) + '</span></span>' +
        '<span class="list-item__trail">' + icon('chevron-right') + '</span></button></li>';
    }).join('');
    return headHtml(t('tr.staff.title'), t('tr.staff.hint')) + '<ul class="list list--card tr-staff">' + items + '</ul>';
  }
  function viewQuestion() {
    var q = staffQ(S.st), l = userLang();
    var isPain = q.id === 'st-pain-scale';
    var answers;
    if (isPain) {
      answers = '<div class="tr-pain" role="group" aria-label="0–10">' + q.answers.map(function (a) {
        var n = painLevel(a.id);
        var label = tx(a.text, l).replace(/^\d+\s*[–-]\s*/, '');
        var sub = label && label !== String(n) ? '<span class="tr-pain__lbl" lang="' + l + '">' + esc(label) + '</span>' : '';
        return '<button type="button" class="tr-pain__btn tr-tone--' + painTone(n) + '" data-tr-act="answer" data-id="' + esc(a.id) + '" aria-label="' + esc(tx(a.text, l) + ' / ' + a.text.vi) + '">' +
          faceSvg(n) + '<span class="tr-pain__n">' + n + '</span>' + sub + '</button>';
      }).join('') + '</div>';
    } else {
      answers = '<div class="tr-answers">' + q.answers.map(function (a) {
        return '<button type="button" class="tr-ans' + (a.id === 'see-qr' ? ' tr-ans--qr' : '') + '" data-tr-act="answer" data-id="' + esc(a.id) + '">' +
          '<span class="tr-ans__tl" lang="' + l + '">' + esc(tx(a.text, l)) + '</span>' +
          '<span class="tr-ans__vi" lang="vi">' + esc(a.text.vi) + '</span></button>';
      }).join('') + '</div>';
    }
    return '<article class="card tr-ask">' +
      '<p class="tr-ask__eyebrow">' + icon('stethoscope', 'icon--sm') + '<span>' + esc(t('tr.staff.asks')) + '</span></p>' +
      '<h2 class="tr-ask__vi" lang="vi" tabindex="-1" data-tr-focus>' + esc(q.text.vi) + '</h2>' +
      '<div class="tr-ask__tl"><span class="badge badge--primary">' + icon('languages') + '<span lang="' + l + '">' + esc(langName(l)) + '</span></span>' +
      '<p class="tr-ask__tl-text" lang="' + l + '">' + esc(tx(q.text, l)) + '</p></div>' +
      '<p class="tr-ask__hint">' + icon('hand', 'icon--sm') + '<span>' + esc(t('tr.staff.tap_answer')) + '</span></p>' +
      answers + '</article>';
  }

  /* ================================================================== */
  /* NAVIGATION (hash-driven steps → browser/topbar back steps back)      */
  /* ================================================================== */
  function keyOf(tab, step) { return tab + ':' + step; }
  function hashFor(tab, step) { return '#/translate?tab=' + tab + '&step=' + step; }

  function forward(step) {
    tap();
    if (timer && !timer.done) timer.moves++;
    if (window.location.hash === hashFor(S.tab, step)) { S.step = step; render(); afterStep(); return; }
    pendingPush = keyOf(S.tab, step);
    NC.app.go('translate', { tab: S.tab, step: step });
  }
  /** Go back to an earlier step of the current tab, reusing history entries when we pushed them. */
  function backTo(step) {
    var curKey = keyOf(S.tab, S.step);
    var topOk = trail.length && trail[trail.length - 1] === curKey;
    if (topOk) {
      var n = step === STEPS[S.tab][0] ? trail.length : (function () { var i = trail.lastIndexOf(keyOf(S.tab, step)); return i >= 0 ? trail.length - 1 - i : -1; })();
      if (n > 0) { window.history.go(-n); return; }
    }
    trail = [];
    NC.app.go('translate', { tab: S.tab, step: step }, { replace: true });
  }
  function parentStep() {
    var s = symptom();
    switch (S.tab + ':' + S.step) {
      case 'sym:symptom': return 'group';
      case 'sym:detail': return 'symptom';
      case 'sym:severity': return (s && s.children && S.c && trailHas('sym:detail')) ? 'detail' : 'symptom';
      case 'sym:result': return 'severity';
      case 'quick:result': return 'list';
      case 'staff:question': return 'list';
      case 'staff:answer': return 'question';
      default: return null;
    }
  }
  function trailHas(key) { return trail.indexOf(key) >= 0; }
  function stepBack() {
    var p = parentStep();
    if (!p) return;
    var curKey = keyOf(S.tab, S.step);
    if (trail.length && trail[trail.length - 1] === curKey) { window.history.back(); return; }
    backTo(p);
  }
  function restart() {
    stopSpeak();
    var tab = S.tab;
    if (tab === 'sym') { S.g = S.s = S.c = S.sev = null; }
    else if (tab === 'quick') S.q = null;
    else { S.st = S.ans = null; }
    startTimer(0);
    backTo(STEPS[tab][0]);
  }
  function switchTab(tab) {
    if (TABS.indexOf(tab) < 0) return;
    if (tab === S.tab && isRoot()) return;
    tap();
    stopSpeak();
    trail = [];
    S.tab = tab;
    NC.app.go('translate', { tab: tab }, { replace: true });
  }
  function setUserLang(code) {
    if (!languages().some(function (x) { return x.code === code; }) || code === userLang()) return;
    tap();
    stopSpeak();
    if (NC.settings) NC.settings.set('user_lang', code); // → settings:change → render()
    else render();
  }

  /** Deepest valid step for the requested one (selection lives in memory, may be empty after a reload). */
  function validStep(tab, step) {
    var order = STEPS[tab];
    var want = order.indexOf(step) >= 0 ? step : order[0];
    if (tab === 'sym') {
      var g = group(), s = symptom(), lf = leaf();
      if (want === 'result' && !(lf && S.sev && lf.phrases[S.sev])) want = 'severity';
      if (want === 'severity' && !lf) want = (s && s.children) ? 'detail' : 'symptom';
      if (want === 'detail' && !(s && s.children)) want = 'symptom';
      if (want === 'symptom' && !g) want = 'group';
    } else if (tab === 'quick') {
      if (want === 'result' && !(S.q === 'profile' ? mine.stmts.length : quick(S.q))) want = 'list';
    } else {
      var q = staffQ(S.st);
      if (want === 'answer' && !(q && byId(q.answers, S.ans))) want = 'question';
      if (want === 'question' && !q) want = 'list';
    }
    return want;
  }

  function show(params) {
    var p = params || {};
    if (fs) closeFullscreen(); // the route changed under an open overlay: never leave it over a different step
    var entering = !visible;
    visible = true;
    if (entering) { startTimer(1); loadMine().then(function () { if (visible && S.tab === 'quick') render(); }); }
    if (p.code && data() && typeof data().find === 'function') {
      var f = data().find(p.code);
      if (f) { S.tab = 'sym'; S.g = f.group.id; S.s = f.symptom.id; S.c = f.child ? f.child.id : null; S.sev = f.severity; }
      NC.app.go('translate', { tab: 'sym', step: f ? 'result' : 'group' }, { replace: true }); // scrub the code from the URL
      return;
    }
    var tab = TABS.indexOf(p.tab) >= 0 ? p.tab : 'sym';
    var reqStep = p.step || STEPS[tab][0];
    var step = validStep(tab, reqStep);
    if (step !== reqStep) { S.tab = tab; trail = []; NC.app.go('translate', { tab: tab, step: step }, { replace: true }); return; }
    if (tab !== S.tab) stopSpeak();
    S.tab = tab; S.step = step;
    // history bookkeeping for in-screen back / restart
    var key = keyOf(tab, step);
    if (pendingPush === key) { trail.push(key); }
    else { var i = trail.lastIndexOf(key); if (i >= 0) trail.length = i + 1; else trail = []; }
    pendingPush = null;
    if (!isResult()) stopSpeak();
    render();
    afterStep();
  }
  function afterStep() {
    var key = keyOf(S.tab, S.step);
    if (key === lastRendered) return;
    lastRendered = key;
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
    if (S.tab === 'sym' && S.step === 'severity') requestAnimationFrame(keepSeverityClear);
    setTimeout(function () {
      if (!root || !visible) return;
      var f = root.querySelector('[data-tr-focus]') || root.querySelector('.tr-result__vi');
      if (f && isRealFocusMove()) { if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1'); try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }
      if (S.tab === 'sym' && S.step === 'severity') keepSeverityClear();
    }, 30);
  }
  /** Top edge of whatever is fixed over the bottom of the page on phones (tab bar and its raised emergency FAB). */
  function bottomObstruction() {
    var lim = window.innerHeight || document.documentElement.clientHeight;
    var tab = document.getElementById('tabbar') || document.querySelector('.tabbar');
    if (tab && window.getComputedStyle(tab).display !== 'none') {
      var r = tab.getBoundingClientRect();
      if (r.height > 0 && r.top < lim) lim = r.top;
      var fab = tab.querySelector('.tabbar__fab-btn');
      if (fab) { var fr = fab.getBoundingClientRect(); if (fr.height > 0 && fr.top - 6 < lim) lim = fr.top - 6; } // 6px surface ring
    }
    return lim;
  }
  /**
   * Severity step: make sure the LAST choice ("Nặng / Severe", the most urgent one) sits fully above the tab bar and
   * the emergency FAB — on small phones and when the offline banner pushes the content down. Scrolls just enough;
   * if all three cannot fit between the top bar and the tab bar, Severe wins.
   */
  function keepSeverityClear() {
    if (!root || !visible || S.tab !== 'sym' || S.step !== 'severity') return;
    var btns = root.querySelectorAll('.tr-sevbtn');
    var last = btns.length ? btns[btns.length - 1] : null;
    if (!last) return;
    var limit = bottomObstruction() - 12;
    var r = last.getBoundingClientRect();
    if (r.bottom <= limit) return;
    try { window.scrollBy(0, Math.ceil(r.bottom - limit)); } catch (e) { /* ignore */ }
  }
  /* Move focus only when the user is navigating inside the screen (not on first paint from another route). */
  function isRealFocusMove() { var a = document.activeElement; return !a || a === document.body || (root && root.contains(a)) || a.id === 'view'; }
  function hide() {
    visible = false;
    lastRendered = null;
    stopSpeak();
    closeFullscreen();
    clearInterval(timerInt); timerInt = 0;
    setHot(null);
  }

  /* ================================================================== */
  /* FIELD-TEST TIMER (settings.demo_timer → kv 'tr.timings')             */
  /* ================================================================== */
  function timerEnabled() { return !!(NC.settings && NC.settings.get('demo_timer')); }
  function startTimer(baseTaps) { timer = { t0: now(), taps: baseTaps || 0, moves: 0, done: false, ms: 0 }; }
  function tap() { if (timer && !timer.done) timer.taps++; }
  function fmtSec(ms) { return U.fmtNumber ? U.fmtNumber(ms / 1000, 1) : (ms / 1000).toFixed(1); }
  function updateTimer() {
    clearInterval(timerInt); timerInt = 0;
    var el = root && root.querySelector('#tr-timer .tr-timer__val');
    if (!el || !timer) return;
    var paint = function () {
      var ms = timer.done ? timer.ms : now() - timer.t0;
      el.textContent = timer.skipped ? '—' : timer.done ? t('tr.timer.result', { s: fmtSec(ms), n: timer.taps }) : fmtSec(ms) + ' s';
    };
    paint();
    if (!timer.done && visible) timerInt = setInterval(paint, 100);
    var badge = root.querySelector('#tr-timer');
    if (badge) badge.classList.toggle('is-done', !!timer.done);
  }
  function finishTimer(st) {
    if (!timer || timer.done || !st) return;
    if (!timer.moves) { timer.done = true; timer.ms = 0; timer.skipped = true; return; } // re-entered an old result: not a measurement
    timer.done = true;
    timer.ms = Math.round(now() - timer.t0);
    if (!timerEnabled() || !NC.store) return;
    var rec = { ms: timer.ms, code: st.code, lang: userLang(), at: new Date().toISOString(), taps: timer.taps };
    NC.store.get(TIMINGS_KEY).then(function (arr) {
      var a = Array.isArray(arr) ? arr : [];
      a.push(rec);
      if (a.length > TIMINGS_MAX) a = a.slice(a.length - TIMINGS_MAX);
      return NC.store.set(TIMINGS_KEY, a);
    }).then(function () {
      if (NC.bus) NC.bus.emit('tr:timing', rec);
      if (NC.ui) NC.ui.toast(t('tr.timer.saved', { s: fmtSec(rec.ms), n: rec.taps }), { type: 'success', timeout: 2600 });
    }).catch(function (e) { console.warn('[translate] timing not saved', e && e.message); });
  }

  /* ================================================================== */
  /* READ ALOUD (speechSynthesis; vi-VN for staff, traveler voice optional) */
  /* ================================================================== */
  function hasTTS() { return ('speechSynthesis' in window) && typeof window.SpeechSynthesisUtterance === 'function'; }
  function voices() {
    return new Promise(function (resolve) {
      var v = []; try { v = window.speechSynthesis.getVoices() || []; } catch (e) { v = []; }
      if (v.length) { resolve(v); return; }
      var done = false;
      var fin = function () { if (done) return; done = true; var list2 = []; try { list2 = window.speechSynthesis.getVoices() || []; } catch (e) { list2 = []; } resolve(list2); };
      try { window.speechSynthesis.addEventListener('voiceschanged', fin); } catch (e) { window.speechSynthesis.onvoiceschanged = fin; }
      setTimeout(fin, 1200);
    });
  }
  function pickVoice(vs, bcp) {
    var norm = function (s) { return String(s || '').toLowerCase().replace('_', '-'); };
    var base = norm(bcp).split('-')[0];
    var m = vs.filter(function (v) { return norm(v.lang).split('-')[0] === base; });
    if (!m.length) return null;
    var exact = m.filter(function (v) { return norm(v.lang) === norm(bcp); });
    var pool = exact.length ? exact : m;
    var offline = NC.net ? !NC.net.online() : navigator.onLine === false;
    var local = pool.filter(function (v) { return v.localService; });
    return (offline || local.length) ? (local[0] || pool[0]) : pool[0];
  }
  /**
   * Speak text with a voice for `bcp` (default vi-VN). Resolves true when speech started.
   * Shows a graceful message when no suitable voice exists (never reads Vietnamese with a foreign voice).
   */
  function speak(text, bcp, key) {
    var lang = bcp || VI_TTS;
    if (!hasTTS()) { NC.ui.toast(t('tr.tts.unsupported'), { type: 'warning', timeout: 4500 }); return Promise.resolve(false); }
    return voices().then(function (vs) {
      var v = pickVoice(vs, lang);
      if (!v) {
        var name = lang.indexOf('vi') === 0 ? t('tr.tts.vi') : langName(lang.split('-')[0]);
        NC.ui.toast(t('tr.tts.no_voice', { lang: name }), { type: 'warning', timeout: 5000 });
        return false;
      }
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = v.lang || lang; u.rate = 0.92; u.pitch = 1;
      try { u.voice = v; } catch (e) { /* non-standard voice object: keep lang only */ }
      tts.key = key || null;
      var end = function () { if (tts.key === (key || null)) { tts.key = null; paintSpeak(); } };
      u.onend = end;
      u.onerror = function (ev) { end(); if (ev && ev.error !== 'canceled' && ev.error !== 'interrupted') NC.ui.toast(t('tr.tts.error'), { type: 'warning' }); };
      window.speechSynthesis.speak(u);
      paintSpeak();
      return true;
    });
  }
  function stopSpeak() {
    if (tts.key === null) return;
    tts.key = null;
    try { if (hasTTS()) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    paintSpeak();
  }
  function paintSpeak() {
    if (!root) return;
    U.$$('[data-tr-act="speak"]', root).forEach(function (b) {
      var st = currentStmt(); var on = !!st && tts.key === st.key;
      b.classList.toggle('is-speaking', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.innerHTML = icon(on ? 'stop' : 'volume') + '<span>' + esc(t(on ? 'tr.res.stop' : 'tr.res.speak')) + '</span>';
    });
  }
  /** Sentences for the Vietnamese TTS: every line break / join is one sentence break (no ". ." double pauses). */
  function ttsText(parts) {
    return parts.map(function (p) { return String(p || '').replace(/\s*\n+\s*/g, '. ').replace(/([.!?…])\.(\s|$)/g, '$1$2').trim(); })
      .filter(Boolean).map(function (p) { return /[.!?…:;]$/.test(p) ? p : p + '.'; }).join(' ');
  }
  function toggleSpeak() {
    var st = currentStmt(); if (!st) return;
    if (tts.key === st.key) { stopSpeak(); return; }
    var text = st.kind === 'answer' ? st.at.vi : st.text.vi;
    speak(ttsText(behalf && isProf(st) ? [t('tr.vi.owner_tts'), text] : [text]), VI_TTS, st.key);
  }
  function speakTl() {
    var st = currentStmt(); if (!st) return;
    var l = userLang();
    var text = st.kind === 'answer' ? tx(st.at, l) : tx(st.text, l);
    speak(text.replace(/\n/g, '. '), langTts(l), st.key + ':tl');
  }

  /* ================================================================== */
  /* FULL SCREEN (Fullscreen API + CSS overlay fallback)                   */
  /* Exit: a tap WITHOUT movement, the Exit button, Esc, or browser/Android */
  /* back (NC.ui.onBack). Content scrolls when it cannot fit. A staff-facing */
  /* footer keeps severity, code, content version/review, notice and 115.  */
  /* ================================================================== */
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function exitNativeFs() {
    try {
      if (fsElement()) { var ex = document.exitFullscreen || document.webkitExitFullscreen; if (ex) { var r = ex.call(document); if (r && r.catch) r.catch(function () {}); } }
    } catch (e) { /* ignore */ }
  }
  /** Back button closes the overlay: NC.ui.onBack (FIX_CONTRACT A9) when available, else a minimal same-URL history entry. */
  function bindBack(closeFn) {
    if (NC.ui && typeof NC.ui.onBack === 'function') {
      try { var rel = NC.ui.onBack(closeFn); if (typeof rel === 'function') return rel; } catch (e) { /* fall back below */ }
    }
    var token = 'tr-fs-' + Date.now();
    try { window.history.pushState({ ncOverlay: token }, '', window.location.href); } catch (e) { return function () {}; }
    var live = true;
    var onPop = function (e) {
      if (e && e.state && e.state.ncOverlay === token) return;
      window.removeEventListener('popstate', onPop);
      if (!live) return;
      live = false;
      closeFn();
    };
    window.addEventListener('popstate', onPop);
    return function release() {
      window.removeEventListener('popstate', onPop);
      if (!live) return;
      live = false;
      var st = null; try { st = window.history.state; } catch (e) { st = null; }
      if (st && st.ncOverlay === token) window.history.back();
    };
  }
  /** Staff-facing (Vietnamese) audit parts for one statement: severity + code, or "self-declared" for profile lines. */
  function fsMetaParts(s) {
    var parts = [];
    var ctx = treeCtx(s);
    if (ctx) { var chip = sevChipText(ctx.node, ctx.sev, s.urgent); if (chip) parts.push(chip); }
    if (s.kind === 'profile' || s.kind === 'profileItem') parts.push(t('tr.vi.src_profile'));
    else if (s.code) parts.push(t('tr.vi.code', { code: s.code }));
    return parts;
  }
  function joinParts(parts) { return parts.map(esc).join('<span class="tr-fs__dot" aria-hidden="true"> · </span>'); }
  function pointXY(e) {
    var p = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: p.clientX || 0, y: p.clientY || 0 };
  }
  /**
   * Show statements full screen (large Vietnamese, traveler language below). stmts: [{text:{vi,…}, urgent, kind, code}]
   */
  function openFullscreen(stmts) {
    var order = staffOrder((stmts || []).filter(function (s) { return s && s.text; }));
    var items = order.items;
    if (!items.length) return null;
    closeFullscreen();
    var P = data();
    var l = userLang(), ui = uiLang();
    var urgent = items.some(function (s) { return s.urgent; });
    var multi = items.length > 1;
    var first = items[0];
    // Behalf mode: a list of only the owner's profile lines says whose they are; a mixed list counts the patient's items
    // in its lead and puts the owner's lines last, under their own lead (staffOrder).
    var lead = multi && behalf && !order.patient ? t('tr.vi.lead_owner') : leadFor(first, multi, multi && order.owner >= 0 ? order.patient : items.length);
    var el = U.h('div', { class: 'tr-fs' + (urgent ? ' tr-fs--urgent' : '') + (multi ? ' tr-fs--multi' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': t('tr.fs.aria'), tabindex: '-1' });
    var metaLine = (multi ? [] : fsMetaParts(first)).concat([t('tr.vi.version', { v: P ? P.version : '?' }), reviewLabelVi()]);
    var body = (urgent ? '<div class="tr-fs__band"><span class="tr-fs__band-text" lang="vi">' + icon('siren') + esc(t('tr.vi.urgent')) + '</span>' +
        '<a class="btn btn--white tr-fs__call" href="tel:115" data-call="115" aria-label="' + esc(t('tr.fs.call_aria')) + '">' + icon('phone') + '<span>115</span></a></div>' : '') +
      (!multi && first.kind === 'answer' && first.q ? '<p class="tr-fs__q" lang="vi">' + icon('stethoscope') + '<span>' + esc(first.q.text.vi) + '</span></p>' : '') +
      '<p class="tr-fs__lead" lang="vi">' + esc(lead) + '</p>' +
      '<div class="tr-fs__main"><div class="tr-fs__fit">' + items.map(function (s, idx) {
        var ans = s.kind === 'answer' && !multi && s.at;
        var vi = ans ? s.at.vi : s.text.vi;
        var tl = ans ? tx(s.at, l) : tx(s.text, l);
        var face = ans && s.a && painLevel(s.a.id) >= 0 ? faceSvg(painLevel(s.a.id), 'tr-fs__face') : '';
        // Profile lines: "self-declared" once per run of consecutive profile lines (not on every line).
        var im = multi && !(isProf(s) && isProf(items[idx - 1])) ? fsMetaParts(s) : [];
        var sub = idx === order.owner ? '<p class="tr-fs__sublead" lang="vi">' + icon('users', 'icon--sm') + '<span>' + esc(t('tr.vi.lead_owner')) + '</span></p>' : '';
        return sub + '<div class="tr-fs__item' + (multi && s.urgent ? ' is-urgent' : '') + '">' + face + '<p class="tr-fs__vi" lang="vi">' + esc(vi) + '</p>' +
          (tl && tl !== vi ? '<p class="tr-fs__tl" lang="' + l + '">' + esc(tl) + '</p>' : '') +
          (im.length ? '<p class="tr-fs__imeta" lang="vi">' + (s.urgent ? icon('siren', 'icon--xs') : '') + '<span>' + joinParts(im) + '</span></p>' : '') + '</div>';
      }).join('') + '</div></div>' +
      // A real button: it scrolls the list (never closes the view like a tap on the text does).
      '<button type="button" class="tr-fs__more" data-fs-more hidden>' +
        icon('chevron-down', 'icon--sm') + '<span>' + esc(t('tr.fs.more', { n: items.length })) + '</span>' +
        (ui !== 'vi' ? '<span class="tr-fs__more-vi" lang="vi">' + esc(t('tr.vi.fs_more', { n: items.length })) + '</span>' : '') + '</button>' +
      '<div class="tr-fs__foot">' +
        '<p class="tr-fs__meta" lang="vi">' + icon('shield-check', 'icon--xs') + '<span>' + joinParts(metaLine) + '</span></p>' +
        '<p class="tr-fs__disc" lang="vi">' + icon('info', 'icon--xs') + '<span>' + esc(t(behalf ? 'tr.vi.fs_disc_behalf' : 'tr.vi.fs_disc')) + '</span></p>' +
        '<div class="tr-fs__bar">' +
          (urgent ? '' : '<a class="btn btn--danger tr-fs__call115" href="tel:115" data-call="115" aria-label="' + esc(t('tr.fs.call_aria')) + '">' + icon('phone') + '<span>115</span></a>') +
          '<p class="tr-fs__exit"><span>' + esc(t('tr.fs.exit')) + '</span>' + (ui !== 'vi' ? '<span class="tr-fs__exit-vi" lang="vi">' + esc(t('tr.vi.fs_exit')) + '</span>' : '') + '</p>' +
          '<button type="button" class="btn btn--soft tr-fs__close" data-fs-close aria-label="' + esc(t('tr.fs.close_aria')) + '">' + icon('minimize') + '<span>' + esc(t('tr.fs.close')) + '</span></button>' +
        '</div>' +
      '</div>';
    el.innerHTML = body;
    document.body.appendChild(el);
    var main = el.querySelector('.tr-fs__main');
    var inertSet = false;
    var app = document.getElementById('app');
    if (app && NC.ui && NC.ui.openCount && NC.ui.openCount() === 0) { app.setAttribute('inert', ''); app.setAttribute('aria-hidden', 'true'); inertSet = true; }
    if (NC.ui && NC.ui.lockScroll) NC.ui.lockScroll();
    var wake = null;
    try { if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {}); } catch (e) { /* ignore */ }
    var wasNative = false;
    try {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) { var r = req.call(el); wasNative = true; if (r && r.catch) r.catch(function () { wasNative = false; }); }
    } catch (e) { wasNative = false; }
    var fit = function () { fitText(el); };
    var down = null, lastScroll = 0;
    var focusables = function () {
      return U.$$('a[href], button, [tabindex="0"]', el).filter(function (x) { return !x.hidden && !x.disabled && x.getClientRects().length > 0; });
    };
    var onKey = function (e) {
      var ae = document.activeElement;
      var onCtl = !!(ae && ae !== el && ae.closest && ae.closest('a[href], button'));
      var scrollable = el.classList.contains('tr-fs--scroll');
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        var f = focusables();
        if (!f.length) { el.focus(); return; }
        var i = f.indexOf(ae);
        var n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i >= f.length - 1 ? 0 : i + 1);
        f[n].focus();
        return;
      }
      if (onCtl) return; // Enter / Space activate the focused link or button normally
      if (e.key === 'Enter' || (e.key === ' ' && !scrollable)) { e.preventDefault(); close(); return; }
      if (!scrollable) return;
      var page = Math.max(40, main.clientHeight * 0.85);
      var dy = { ArrowDown: 48, ArrowUp: -48, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
      if (e.key === 'Home') dy = -main.scrollHeight;
      else if (e.key === 'End') dy = main.scrollHeight;
      if (dy) { e.preventDefault(); main.scrollTop += dy; }
    };
    var onFsChange = function () { if (wasNative && !fsElement()) close(); };
    var onDown = function (e) { var p = pointXY(e); down = { x: p.x, y: p.y, st: main.scrollTop }; };
    var pageDown = function () {
      main.scrollTop = Math.min(main.scrollHeight, main.scrollTop + Math.max(40, main.clientHeight * 0.85));
      updateMore(el);
    };
    var onScroll = function () { lastScroll = Date.now(); updateMore(el); };
    var onClick = function (e) {
      var tg = e.target;
      if (!tg || !tg.closest) return;
      if (tg.closest('[data-fs-close]')) { close(); return; }
      if (tg.closest('[data-fs-more]')) { down = null; pageDown(); return; } // "scroll to see all" scrolls, never exits
      if (tg.closest('[data-call], .tr-fs__foot')) return; // the footer (notice, 115) is outside the tap-to-exit area
      var d = down; down = null;
      // Only a clean tap exits: never the end of a scroll / drag (staff scroll long lists).
      if (d && e.detail !== 0) {
        var p = pointXY(e);
        if (Math.abs(p.x - d.x) > 10 || Math.abs(p.y - d.y) > 10 || Math.abs(main.scrollTop - d.st) > 2) return;
      }
      if (Date.now() - lastScroll < 300) return;
      close();
    };
    var release = null;
    function close(o) {
      if (!fs || fs.el !== el) return;
      fs = null;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      window.removeEventListener('resize', fit);
      if (release) { var rel = release; release = null; if (!(o && o.fromBack)) { try { rel(); } catch (e0) { /* ignore */ } } }
      if (wake && wake.release) { try { wake.release(); } catch (e2) { /* ignore */ } }
      exitNativeFs();
      if (inertSet && app) { app.removeAttribute('inert'); app.removeAttribute('aria-hidden'); }
      if (NC.ui && NC.ui.unlockScroll) NC.ui.unlockScroll();
      el.classList.remove('is-open');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
      var back = root && root.querySelector('[data-tr-act="fullscreen"]');
      if (back && visible) { try { back.focus({ preventScroll: true }); } catch (e3) { /* ignore */ } }
    }
    el.addEventListener(window.PointerEvent ? 'pointerdown' : 'touchstart', onDown, { passive: true });
    el.addEventListener('click', onClick);
    main.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    window.addEventListener('resize', fit);
    fs = { el: el, close: close };
    release = bindBack(function () { close({ fromBack: true }); });
    requestAnimationFrame(function () { el.classList.add('is-open'); fit(); try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } });
    setTimeout(fit, 250); // after the native full-screen transition
    return fs;
  }
  function closeFullscreen(o) { if (fs) fs.close(o); }
  function updateMore(el) {
    var main = el.querySelector('.tr-fs__main'), more = el.querySelector('.tr-fs__more');
    if (!main || !more) return;
    var hide = !(el.classList.contains('tr-fs--scroll') && main.scrollTop + main.clientHeight < main.scrollHeight - 8);
    // Reached the end with the button focused (keyboard): keep focus inside the view, on the scrollable list.
    if (hide && !more.hidden && document.activeElement === more) { try { main.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    more.hidden = hide;
  }
  /**
   * Largest font size (binary search) at which every statement fits without scrolling; lists may shrink to 16px.
   * When even the floor does not fit, the list scrolls (from the top) and a "scroll for more" hint is shown.
   */
  function fitText(el) {
    var main = el.querySelector('.tr-fs__main'), box = el.querySelector('.tr-fs__fit');
    if (!main || !box) return;
    var H = main.clientHeight, Wd = main.clientWidth;
    if (!H || !Wd) return;
    var floor = el.classList.contains('tr-fs--multi') ? 16 : 20;
    var lo = floor, hi = Math.min(150, Math.max(28, Math.round(Wd / 5))), best = lo;
    for (var i = 0; i < 12 && lo <= hi; i++) {
      var mid = Math.floor((lo + hi) / 2);
      box.style.setProperty('--tr-fs-size', mid + 'px');
      if (box.scrollHeight <= H && box.scrollWidth <= Wd + 1) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    box.style.setProperty('--tr-fs-size', best + 'px');
    var over = box.scrollHeight > main.clientHeight + 1;
    el.classList.toggle('tr-fs--scroll', over);
    if (over) main.setAttribute('tabindex', '0'); else main.removeAttribute('tabindex');
    updateMore(el);
  }

  /** Sheet with the 6 traveler languages (used on the result screen, where the intro chips are hidden on phones). */
  function openLangPicker() {
    if (!NC.ui) return null;
    var cur = userLang(), ctrl;
    var box = U.h('div', { class: 'list list--card tr-langsheet', role: 'radiogroup', 'aria-label': t('tr.lang.pick') });
    languages().forEach(function (l) {
      var on = l.code === cur;
      var b = U.h('button', { type: 'button', class: 'list-item' + (on ? ' is-selected' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false' });
      b.innerHTML = '<span class="list-item__icon icon-tile icon-tile--sm icon-tile--' + (on ? 'solid' : 'neutral') + '">' + icon('languages') + '</span>' +
        '<span class="list-item__body"><span class="list-item__title" lang="' + esc(l.code) + '">' + esc(l.name) + '</span><span class="list-item__meta">' + esc(l.name_en) + '</span></span>' +
        '<span class="list-item__trail">' + (on ? icon('check-circle', 'text-primary') : icon('circle')) + '</span>';
      b.addEventListener('click', function () { setUserLang(l.code); ctrl.close(); });
      box.appendChild(b);
    });
    ctrl = NC.ui.sheet({ title: t('tr.lang.pick'), subtitle: t('tr.lang.staff_note'), icon: 'languages', size: 'sm', body: box });
    return ctrl;
  }

  /* ================================================================== */
  /* STATEMENT LIST (memory only)                                         */
  /* ================================================================== */
  function addToList(st, silent) {
    var items = stmtsFor(st).filter(function (s) { return !list.some(function (x) { return x.key === s.key; }); });
    if (!items.length) { if (!silent && NC.ui) NC.ui.toast(t('tr.list.exists'), { type: 'info', timeout: 2000 }); return 0; }
    items.forEach(function (s) { list.push(s); });
    if (!silent && NC.ui) NC.ui.toast(t('tr.list.added', { n: list.length }), { type: 'success', timeout: 3200, action: { label: t('tr.list.open'), onClick: openList } });
    render();
    return items.length;
  }
  function addProfileToList() {
    if (!mine.stmts.length) return 0;
    var n = addToList({ kind: 'profile', parts: mine.stmts }, true);
    if (NC.ui) NC.ui.toast(n ? t('tr.list.profile_added', { n: n }) : t('tr.list.exists'), { type: n ? 'success' : 'info', timeout: 3000, action: n ? { label: t('tr.list.open'), onClick: openList } : null });
    return n;
  }
  function openList() {
    if (!NC.ui) return null;
    var body = U.h('div', { class: 'tr-listsheet' });
    var ctrl;
    function paint() {
      var l = userLang(), ui = uiLang();
      // Speaking for a companion: the owner's profile is not offered for the patient's list (already-added lines are tagged).
      var profileMissing = !behalf && mine.stmts.some(function (p) { return !list.some(function (x) { return x.key === p.key; }); });
      var html = '';
      if (!list.length) {
        html += String(NC.ui.emptyState({ icon: 'list-checks', variant: 'primary', title: t('tr.list.empty'), text: t('tr.list.empty_hint'), compact: true }));
      } else {
        html += '<ol class="tr-listsheet__items">' + list.map(function (s0, i) {
          var s = shown(s0), vi = s.text.vi;
          var owner = behalf && isProf(s);
          // Behalf mode: the owner's lines are tinted; the first line of each run says whose they are.
          var own = owner && !isProf(list[i - 1]) ? '<span class="tr-listsheet__owner">' + icon('users', 'icon--xs') + '<span class="tr-listsheet__owner-text"><span lang="vi">' + esc(t('tr.vi.owner_tag')) + '</span>' +
            (ui !== 'vi' ? '<span class="tr-listsheet__owner-ui">' + esc(t('tr.list.owner_tag')) + '</span>' : '') + '</span></span>' : '';
          return '<li class="tr-listsheet__item' + (s.urgent ? ' is-urgent' : '') + (owner ? ' is-owner' : '') + '"><span class="tr-listsheet__n">' + (i + 1) + '</span>' +
            '<span class="tr-listsheet__text">' + own + '<span class="tr-listsheet__vi" lang="vi">' + esc(vi) + '</span><span class="tr-listsheet__tl" lang="' + l + '">' + esc(tx(s.text, l)) + '</span></span>' +
            '<button type="button" class="btn btn--ghost btn--icon btn--sm" data-tr-rm="' + esc(s.key) + '" aria-label="' + esc(t('tr.list.remove')) + '" title="' + esc(t('tr.list.remove')) + '">' + icon('x') + '</button></li>';
        }).join('') + '</ol>';
      }
      if (profileMissing) html += '<button type="button" class="btn btn--outline btn--block tr-listsheet__profile" data-tr-addprofile>' + icon('id-card') + '<span>' + esc(t('tr.list.add_profile')) + '</span></button>';
      html += '<p class="tr-listsheet__privacy">' + icon('lock', 'icon--xs') + '<span>' + esc(t('tr.list.privacy')) + '</span></p>';
      body.innerHTML = html;
      if (ctrl) U.$$('.sheet__footer .btn', ctrl.panel).forEach(function (b) { b.disabled = !list.length; });
    }
    body.addEventListener('click', function (e) {
      var rm = e.target.closest ? e.target.closest('[data-tr-rm]') : null;
      if (rm) { var k = rm.getAttribute('data-tr-rm'); list = list.filter(function (x) { return x.key !== k; }); paint(); render(); return; }
      if (e.target.closest && e.target.closest('[data-tr-addprofile]')) { addToList({ kind: 'profile', parts: mine.stmts }, true); paint(); }
    });
    ctrl = NC.ui.sheet({
      title: t('tr.list.title'), subtitle: t('tr.list.sub'), icon: 'list-checks', size: 'lg', body: body, className: 'tr-list-sheet',
      actions: [
        { label: t('tr.list.clear'), variant: 'ghost', icon: 'trash', onClick: function () { list = []; stopSpeak(); render(); NC.ui.toast(t('tr.list.cleared'), { timeout: 1800 }); } },
        { label: t('tr.res.speak'), variant: 'soft', icon: 'volume', close: false, onClick: function () {
          // Same order and owner announcement as the full-screen view.
          var o = staffOrder(list.slice()), parts = [];
          o.items.forEach(function (s, i) {
            if (behalf && isProf(s) && (i === o.owner || (o.owner < 0 && i === 0))) parts.push(t('tr.vi.owner_tts'));
            parts.push(s.text.vi);
          });
          speak(ttsText(parts), VI_TTS, 'list'); return false;
        } },
        { label: t('tr.res.fullscreen'), variant: 'primary', icon: 'maximize', onClick: function () {
          var items = list.slice();
          // Open once the sheet has closed (and released its back-button entry): the app is then inert under the
          // overlay and browser/Android back closes the full-screen view, not the sheet that is already gone.
          var go = function () { setTimeout(function () { openFullscreen(items); }, 0); };
          if (ctrl && ctrl.closed && typeof ctrl.closed.then === 'function') ctrl.closed.then(go); else go();
        } }
      ],
      onClose: function () { if (tts.key === 'list') stopSpeak(); }
    });
    paint();
    return ctrl;
  }

  /* ================================================================== */
  /* EVENTS                                                               */
  /* ================================================================== */
  function onClick(e) {
    var tgt = e.target;
    if (!tgt || !tgt.closest) return;
    var tabBtn = tgt.closest('[data-tr-tab]');
    if (tabBtn && root.contains(tabBtn)) { switchTab(tabBtn.getAttribute('data-tr-tab')); return; }
    var el = tgt.closest('[data-tr-act]');
    if (!el || !root.contains(el)) return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    var act = el.getAttribute('data-tr-act'), id = el.getAttribute('data-id');
    var g, s;
    switch (act) {
      case 'lang': setUserLang(id); break;
      case 'group':
        if (!byId(data().groups, id)) return;
        if (S.g !== id) { S.s = S.c = S.sev = null; }
        S.g = id; forward('symptom'); break;
      case 'symptom':
        g = group(); s = g ? byId(g.symptoms, id) : null; if (!s) return;
        if (S.s !== id) { S.c = null; S.sev = null; }
        S.s = id; forward(s.children ? 'detail' : 'severity'); break;
      case 'child':
        S.s = el.getAttribute('data-sid'); S.c = id; S.sev = null; forward('severity'); break;
      case 'sev': S.sev = id; forward('result'); break;
      case 'quick': S.q = id; if (isBehalfQuick(quick(id))) behalf = true; forward('result'); break;
      case 'behalf-off': behalf = false; tap(); render(); break;
      case 'mine-show': S.q = 'profile'; forward('result'); break;
      case 'mine-add': tap(); addProfileToList(); break;
      case 'staffq': S.st = id; S.ans = null; forward('question'); break;
      case 'answer': S.ans = id; forward('answer'); break;
      case 'back': tap(); stepBack(); break;
      case 'jump': tap(); backTo(el.getAttribute('data-step')); break;
      case 'restart': restart(); break;
      case 'speak': toggleSpeak(); break;
      case 'speak-tl': speakTl(); break;
      case 'fullscreen': openFullscreen(stmtsFor(currentStmt())); break;
      case 'add': addToList(currentStmt()); break;
      case 'list': openList(); break;
      case 'pick-lang': openLangPicker(); break;
      case 'qr': NC.app.go('qr', { view: 'rescuer' }); break;
      case 'goqr': NC.app.go('qr'); break;
      default: break;
    }
  }
  function onOver(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tr-g]') : null;
    setHot(el && root.contains(el) && S.step === 'group' ? el.getAttribute('data-tr-g') : null);
  }
  /** Focus leaving the screen (or moving off a region) clears the figure highlight. */
  function onFocusOut(e) {
    var to = e.relatedTarget;
    if (!to || !root.contains(to)) setHot(null);
  }
  /** Region whose control has keyboard focus (its highlight outlives a touch that ends elsewhere). */
  function focusedGroup() {
    var a = document.activeElement;
    if (!a || !root.contains(a) || !a.getAttribute || !a.getAttribute('data-tr-g')) return null;
    try { if (!a.matches(':focus-visible')) return null; } catch (err) { return null; }
    return a.getAttribute('data-tr-g');
  }
  /**
   * A touch/pen press ended, or the browser took it over for scrolling (pointercancel): drop the press highlight so
   * a scroll that started on the figure does not leave a region looking chosen. A tap has already navigated.
   */
  function onPressEnd(e) {
    if (e && e.pointerType === 'mouse') return; // mouse: hover keeps driving the highlight
    U.$$('.tr-hot.is-press', root).forEach(function (b) { b.classList.remove('is-press'); });
    if (S.step === 'group') setHot(focusedGroup());
  }
  /**
   * Touch/pen press on a region: highlight it and show the pressed button's own label bubble (.is-press) while the
   * finger is down — :active on touch differs between engines. The tap itself still navigates on release (≤ 4 taps).
   */
  function onPressStart(e) {
    if (e && e.pointerType === 'mouse') return; // mouse: mouseover/:hover already do this
    onOver(e);
    var b = e.target && e.target.closest ? e.target.closest('.tr-hot') : null;
    if (b && root.contains(b) && S.step === 'group') b.classList.add('is-press');
  }
  /** "More details" open state (the toggle event does not bubble: listened to in the capture phase). */
  function onToggle(e) {
    var d = e.target;
    if (!d || !d.classList || !d.classList.contains('tr-result__more')) return;
    var st = currentStmt();
    more.open = !!d.open; more.key = st ? st.key : null;
  }
  function onTabsKey(e) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
    var i = TABS.indexOf(S.tab);
    var n = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + TABS.length) % TABS.length;
    e.preventDefault();
    switchTab(TABS[n]);
    var b = root.querySelector('[data-tr-tab="' + TABS[n] + '"]'); if (b) b.focus();
  }

  /* ---------- skeleton fallback (partial not stitched into index.html yet) ---------- */
  function ensureSkeleton(section) {
    var r = section.querySelector('#tr-root');
    if (r) return r;
    var tabBtn = function (tb) {
      return '<button class="segmented__btn tr-tab" type="button" role="tab" id="tr-tab-' + tb + '" data-tr-tab="' + tb + '" aria-controls="tr-panel-' + tb + '">' +
        icon(TAB_ICON[tb]) + '<span data-i18n="tr.tab.' + tb + '"></span></button>';
    };
    section.innerHTML = '<div class="tr" id="tr-root">' +
      '<section class="page-intro tr-intro" id="tr-intro">' +
      '<div class="page-intro__text"><p class="page-intro__lead" data-i18n="tr.intro.lead"></p></div>' +
      '<div class="page-intro__actions tr-lang"><p class="tr-lang__label" id="tr-lang-label" data-i18n="tr.lang.you_speak"></p>' +
      '<div class="chip-group chip-group--scroll scroll-fade-x tr-lang__chips" id="tr-lang" role="radiogroup" aria-labelledby="tr-lang-label"></div></div></section>' +
      '<div class="segmented segmented--lg tr-tabs" id="tr-tabs" role="tablist" data-i18n-attr="aria-label:tr.tab.aria">' + TABS.map(tabBtn).join('') + '</div>' +
      '<div class="tr-listbar" id="tr-listbar" hidden></div>' +
      TABS.map(function (tb) { return '<section class="tr-panel" id="tr-panel-' + tb + '" role="tabpanel" aria-labelledby="tr-tab-' + tb + '"' + (tb === 'sym' ? '' : ' hidden') + '></section>'; }).join('') +
      '<footer class="tr-foot" id="tr-foot"><div class="tr-foot__disclaimer" id="tr-disclaimer"></div><div class="tr-foot__meta" id="tr-foot-meta"></div></footer></div>';
    if (NC.i18n) NC.i18n.apply(section);
    return section.querySelector('#tr-root');
  }

  function mount(section) {
    root = ensureSkeleton(section);
    els = {
      lang: root.querySelector('#tr-lang'),
      listbar: root.querySelector('#tr-listbar'),
      footMeta: root.querySelector('#tr-foot-meta'),
      panels: { sym: root.querySelector('#tr-panel-sym'), quick: root.querySelector('#tr-panel-quick'), staff: root.querySelector('#tr-panel-staff') }
    };
    var disc = root.querySelector('#tr-disclaimer');
    // Medical screen: the disclaimer + 115 appear once, compact (no roaming paragraph — urgent results carry it).
    if (disc && NC.ui) {
      disc.innerHTML = '';
      var dEl = NC.ui.disclaimer({ compact: true });
      // MOD.01 is a communication aid, not first aid: same component, screen-specific sentence (re-applied on i18n:change).
      var dBody = dEl && dEl.querySelector ? dEl.querySelector('.disclaimer__body') : null;
      if (dBody) { dBody.setAttribute('data-i18n', 'tr.res.disc'); dBody.textContent = t('tr.res.disc'); }
      disc.appendChild(dEl);
    }
    root.addEventListener('click', onClick);
    root.addEventListener('mouseover', onOver);
    root.addEventListener('mouseleave', function () { setHot(null); });
    root.addEventListener('focusin', onOver);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('toggle', onToggle, true);
    // Touch press on a body region: highlight it and show its label bubble before the tap is released.
    // (A touchstart listener is also what lets iOS Safari apply :active.)
    root.addEventListener('touchstart', window.PointerEvent ? function () {} : onPressStart, { passive: true });
    // ...and drop that highlight when the press ends or turns into a scroll.
    ['up', 'cancel'].forEach(function (k) {
      root.addEventListener(window.PointerEvent ? 'pointer' + k : (k === 'up' ? 'touchend' : 'touchcancel'), onPressEnd, { passive: true });
    });
    if (window.PointerEvent) root.addEventListener('pointerdown', onPressStart, { passive: true });
    var tabs = root.querySelector('#tr-tabs');
    if (tabs) tabs.addEventListener('keydown', onTabsKey);
    if (els.lang) els.lang.addEventListener('scroll', langFade, { passive: true });
    window.addEventListener('resize', U.debounce(langFade, 150));
    if (NC.bus) {
      NC.bus.on('i18n:change', function () { if (root) { render(); } });
      NC.bus.on('settings:change', function (p) {
        if (!p) return;
        if (p.key === 'user_lang') { stopSpeak(); render(); }
        if (p.key === 'demo_timer' && visible) render();
      });
      // The offline banner appears/disappears above the screen: keep Severe clear of the tab bar (after its drop-in).
      NC.bus.on('net:change', function () { if (visible && S.tab === 'sym' && S.step === 'severity') setTimeout(keepSeverityClear, 380); });
      var reload = function () { loadMine().then(function () { if (visible) render(); }); };
      NC.bus.on('profile:update', reload);
      NC.bus.on('consents:change', reload);
    }
    loadMine();
  }

  if (NC.app && typeof NC.app.register === 'function') {
    NC.app.register('translate', { titleKey: 'app.title.translate', shortTitleKey: 'app.title_short.translate', mod: 'MOD.01', icon: 'languages', mount: mount, show: show, hide: hide });
  }

  NC.translate = {
    /** Navigate to the translate screen, e.g. open({tab:'staff'}) or open({code:'MOD01-HEAD-01-3'}). */
    open: function (params) { if (NC.app) NC.app.go('translate', params || null); },
    /** Add a statement {key, text:{vi,…}, urgent} (or {kind:'profile', parts}) to the staff list. */
    addToList: function (st) { return addToList(st); },
    list: function () { return list.slice(); },
    clearList: function () { list = []; render(); },
    speak: function (text, bcp) { return speak(text, bcp, 'api'); },
    fullscreen: function (stmts) { return openFullscreen(stmts); }
  };
})(window.NC = window.NC || {});
