/*
 * mod05-firstaid.js — MOD.05 Thư viện sơ cứu offline: library (search + voice, red critical block with 115 + CPR
 * metronome, foldable category sections), item view (115 callout, step carousel/list, red flags, don'ts, sources, version, video link),
 * CPR metronome (Web Audio look-ahead scheduler, drift-free), anaphylaxis timer, medical-kit checklist (kv 'fa.kit').
 * Owner: P2 mod05-firstaid. Public API: NC.firstaid.{open(id, opts), openKit(), kitStatus(), items(), metronome}
 * Routes: #/firstaid · #/firstaid?tab=kit · #/firstaid?item=<id>[&step=<n>][&tool=cpr|timer]. Content: window.NC_FIRSTAID.
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var esc = U.esc;
  var FA = window.NC_FIRSTAID || null;

  /* ================================================================== */
  /* i18n (fa.*)                                                         */
  /* ================================================================== */
  NC.i18n.add({
    vi: {
      'fa.hero.offline': 'Hoạt động không cần mạng',
      'fa.hero.title': 'Sơ cứu ngoại tuyến',
      'fa.hero.sub': '{n} tình huống thường gặp khi phượt — từng bước, có hình minh hoạ.',
      'fa.intro.lead': '{n} tình huống thường gặp khi phượt — từng bước, có hình, không cần mạng.',
      'fa.search.label': 'Tìm hướng dẫn sơ cứu',
      'fa.search.placeholder': 'Tìm: rắn cắn, bỏng, ngừng tim…',
      'fa.search.clear': 'Xoá tìm kiếm',
      'fa.search.voice': 'Tìm bằng giọng nói',
      'fa.search.listening': 'Đang nghe… hãy nói tên tình huống',
      'fa.search.voice_error': 'Chưa nghe rõ. Hãy thử lại hoặc gõ từ khoá.',
      'fa.search.voice_network': 'Nhận dạng giọng nói trên trình duyệt này cần mạng — hãy gõ từ khoá (không cần dấu).',
      'fa.search.voice_denied': 'Chưa được cấp quyền micro — hãy gõ từ khoá.',
      'fa.search.results': '{n} kết quả cho “{q}”',
      'fa.search.none_title': 'Không tìm thấy hướng dẫn phù hợp',
      'fa.search.none_text': 'Thử từ khoá khác (gõ không dấu cũng được) hoặc xoá tìm kiếm để xem theo nhóm. Nếu nguy kịch, gọi 115 ngay.',
      'fa.search.none_title2': 'Không có hướng dẫn chính xác cho “{q}”',
      'fa.search.none_urgent': 'Nếu người bệnh bất tỉnh, không thở bình thường, chảy máu nhiều hoặc co giật: gọi 115 ngay (bật loa ngoài hoặc nhờ người khác gọi) và làm ngay các bước dưới đây.',
      'fa.search.none_hint': 'Thử từ khoá khác (gõ không dấu cũng được) hoặc xoá tìm kiếm để xem theo nhóm.',
      'fa.search.go_cpr': 'Ép tim (CPR)',
      'fa.search.go_recovery': 'Tư thế hồi phục',
      'fa.search.related': 'Hướng dẫn có nhắc tới “{q}”',
      'fa.search.related_note': 'Không khớp chính xác — đọc kỹ trước khi làm theo',
      'fa.tabs_aria': 'Thư viện sơ cứu',
      'fa.tab.library': 'Hướng dẫn',
      'fa.tab.kit': 'Túi sơ cứu',
      'fa.crit.title': 'Nguy kịch — hành động ngay',
      'fa.crit.hint': 'Gọi 115 (bật loa) hoặc nhờ người gọi — đồng thời làm ngay các bước',
      'fa.prio.critical': 'Nguy kịch',
      'fa.prio.urgent': 'Khẩn',
      'fa.prio.common': 'Thường gặp',
      'fa.steps_n': '{n} bước',
      'fa.has_metronome': 'Đếm nhịp',
      'fa.has_timer': 'Hẹn giờ',
      'fa.quick.cpr': 'Đếm nhịp ép tim',
      'fa.section_count': '{n} hướng dẫn',
      'fa.section_count_one': '1 hướng dẫn',
      'fa.section_crit': '+{n} nguy kịch ở trên',
      'fa.src.title': 'Nguồn nội dung & kiểm duyệt',
      'fa.src.by': 'Theo',
      'fa.src.more': 'Chi tiết nguồn',
      'fa.src.card_sub': 'Mỗi hướng dẫn ghi rõ tài liệu gốc và năm. Nhóm tự viết lời, tự vẽ hình; duyệt hai vòng trước khi phát hành.',
      'fa.src.sheet_title': 'Nguồn nội dung y tế',
      'fa.src.sheet_sub': 'Mỗi hướng dẫn ghi rõ tài liệu gốc mà nội dung bám theo (PDF mục 8.1, bảng PL.3).',
      'fa.src.used_here': 'Dùng cho mục này',
      'fa.src.publisher': 'Đơn vị ban hành',
      'fa.src.scope': 'Dùng cho',
      'fa.src.year_unknown': 'năm: đang chốt',
      'fa.src.year_tbc': 'năm đang chốt',
      'fa.kit.meta_by': 'Danh mục theo',
      'fa.src.own_words': 'Nhóm viết lại toàn bộ câu chữ và tự vẽ hình minh hoạ; không sao chép văn bản hay hình ảnh gốc. Chỉ gồm thao tác người không có chuyên môn y tế được phép làm.',
      'fa.src.review': 'Kiểm duyệt',
      'fa.src.round1': 'Vòng 1 (biên soạn, đối chiếu nguồn)',
      'fa.src.round2': 'Vòng 2 (cố vấn y tế ký duyệt)',
      'fa.src.pending': 'Chưa ký',
      'fa.version': 'v{v}',
      'fa.review.in_review': 'chờ cố vấn ký duyệt',
      'fa.review.approved': 'đã ký duyệt',
      'fa.review.draft': 'bản nháp',
      'fa.review.retracted': 'đã thu hồi',
      'fa.updated': 'Cập nhật {date}',
      'fa.back_lib': 'Thư viện sơ cứu',
      'fa.call.title': 'Gọi 115 ngay nếu…',
      'fa.call.btn': 'Gọi 115',
      'fa.call.roam': 'Cuộc gọi 115/112 có thể được chuyển qua mạng khác đang có sóng tại chỗ — nhưng không đảm bảo khi hoàn toàn không có sóng. Hãy luôn thử gọi trước.',
      'fa.steps.title': 'Các bước sơ cứu',
      'fa.steps.mode_aria': 'Cách hiển thị các bước',
      'fa.steps.one': 'Từng bước',
      'fa.steps.all': 'Xem tất cả bước',
      'fa.steps.label': 'Bước {i}/{n}',
      'fa.steps.prev': 'Bước trước',
      'fa.steps.next': 'Bước tiếp',
      'fa.steps.next_short': 'Tiếp',
      'fa.steps.restart': 'Về bước 1',
      'fa.steps.goto': 'Tới bước {i}',
      'fa.steps.carousel_aria': 'Các bước sơ cứu, vuốt ngang hoặc dùng phím mũi tên',
      'fa.steps.hint': 'Vuốt ngang hoặc dùng phím ← → để chuyển bước',
      'fa.steps.read': 'Đọc to bước này',
      'fa.steps.stop_read': 'Dừng đọc',
      'fa.tts.none': 'Thiết bị chưa có giọng đọc cho ngôn ngữ này.',
      'fa.flags.title': 'Dấu hiệu nguy hiểm — gọi 115',
      'fa.donts.title': 'Không được làm',
      'fa.related': 'Tình huống liên quan',
      'fa.video.label': 'Video hướng dẫn',
      'fa.video.ext_title': 'Tìm video trên YouTube',
      'fa.video.ext_note': 'nguồn bên ngoài, chưa được NomadCare kiểm duyệt (cần mạng)',
      'fa.video.reviewed': 'Video đã được cố vấn y tế duyệt · cần mạng',
      'fa.video.hint_online': 'Mở YouTube · cần mạng',
      'fa.video.hint_offline': 'Cần mạng — chữ và hình ở trên đã đủ để làm theo',
      'fa.notfound.title': 'Không tìm thấy hướng dẫn này',
      'fa.notfound.text': 'Nội dung có thể đã đổi tên. Hãy quay lại thư viện để tìm.',
      'fa.demo_content': 'Nội dung minh hoạ, chờ cố vấn y tế ký duyệt vòng 2 trước khi phát hành cho người dùng thật.',

      'fa.cpr.title': 'Đếm nhịp ép tim (CPR)',
      'fa.cpr.sub': 'Ép theo tiếng bíp · sâu 5–6 cm · để ngực nảy lên hết',
      'fa.cpr.start': 'Bắt đầu ép tim',
      'fa.cpr.pause': 'Tạm dừng',
      'fa.cpr.resume': 'Tiếp tục',
      'fa.cpr.reset': 'Đặt lại',
      'fa.cpr.mode_aria': 'Cách hồi sinh',
      'fa.cpr.mode_hands': 'Chỉ ép tim',
      'fa.cpr.mode_302': '30:2 thổi ngạt',
      'fa.cpr.hint_hands': 'Khuyến nghị nếu bạn chưa học thổi ngạt: ép liên tục, không dừng.',
      'fa.cpr.hint_302': 'Chỉ khi đã được huấn luyện: 30 lần ép rồi 2 lần thổi ngạt (mỗi lần ~1 giây).',
      'fa.cpr.count': 'lần ép',
      'fa.cpr.set': 'trong lượt 30',
      'fa.cpr.swap_in': 'đổi người',
      'fa.cpr.swap_now': 'Đổi người ép tim!',
      'fa.cpr.swap_hint': 'Đổi nhanh — gián đoạn dưới 10 giây.',
      'fa.cpr.ready': 'Sẵn sàng',
      'fa.cpr.push': 'ÉP',
      'fa.cpr.paused': 'Đã dừng',
      'fa.cpr.breath': 'Thổi ngạt {i}/2',
      'fa.cpr.bpm': 'nhịp/phút',
      'fa.cpr.bpm_aria': 'Tốc độ ép tim',
      'fa.cpr.slower': 'Chậm hơn',
      'fa.cpr.faster': 'Nhanh hơn',
      'fa.cpr.sound': 'Âm thanh',
      'fa.cpr.vibrate': 'Rung',
      'fa.cpr.elapsed': 'Thời gian {t} · chu kỳ {c}',
      'fa.cpr.no_audio': 'Trình duyệt không phát được âm thanh — hãy ép theo nhịp hình và con số.',
      'fa.cpr.ios_hint': 'iPhone: tắt chế độ im lặng để nghe tiếng bíp. Màn hình được giữ sáng khi đang đếm nhịp.',
      'fa.cpr.stage_aria': 'Hình động ép tim theo nhịp',
      'fa.cpr.jump': 'Đếm nhịp ép tim',

      'fa.ana.title': 'Hẹn giờ sau tiêm adrenalin',
      'fa.ana.start': 'Đã tiêm — bắt đầu hẹn giờ',
      'fa.ana.idle_note': 'Bấm ngay khi vừa tiêm để app ghi giờ tiêm và nhắc mốc 5 phút.',
      'fa.ana.injected_at': 'Tiêm liều 1',
      'fa.ana.second_at': 'Tiêm liều 2',
      'fa.ana.since': 'kể từ lần tiêm gần nhất',
      'fa.ana.wait': 'Theo dõi nhịp thở. Mốc 5 phút sau {t}.',
      'fa.ana.due': 'Đã đủ 5 phút',
      'fa.ana.second': 'Đã tiêm liều 2',
      'fa.ana.reset': 'Đặt lại',
      'fa.ana.reset_q': 'Xoá giờ tiêm đã ghi?',
      'fa.ana.note': 'Báo giờ tiêm cho nhân viên y tế và giữ lại bút đã dùng.',
      'fa.ana.after_second': 'Đã tiêm 2 liều: tiếp tục theo dõi, sẵn sàng ép tim nếu người bệnh ngừng thở.',
      'fa.ana.due_toast': 'Đã 5 phút kể từ khi tiêm adrenalin — xem hướng dẫn liều 2.',
      'fa.ana.jump': 'Hẹn giờ 5 phút',

      'fa.kit.title': 'Túi sơ cứu mang theo',
      'fa.kit.sub': 'Vật dụng y tế nên chuẩn bị trước chuyến đi — đánh dấu những gì bạn đã có.',
      'fa.kit.progress': '{done}/{total} đã chuẩn bị',
      'fa.kit.essential_progress': '{done}/{total} vật dụng thiết yếu',
      'fa.kit.ready': 'Túi sơ cứu đã sẵn sàng cho chuyến đi',
      'fa.kit.not_ready': 'Chuẩn bị tối thiểu 80% để hoàn tất checklist chuyến đi',
      'fa.kit.essential': 'Thiết yếu',
      'fa.kit.optional': 'Tuỳ chọn',
      'fa.kit.filter_aria': 'Lọc vật dụng',
      'fa.kit.filter_all': 'Tất cả',
      'fa.kit.filter_essential': 'Thiết yếu',
      'fa.kit.filter_missing': 'Còn thiếu',
      'fa.kit.clear': 'Bỏ đánh dấu tất cả',
      'fa.kit.clear_q': 'Bỏ đánh dấu toàn bộ vật dụng trong túi sơ cứu?',
      'fa.kit.copy': 'Sao chép danh sách còn thiếu',
      'fa.kit.copied': 'Đã sao chép danh sách còn thiếu',
      'fa.kit.all_done': 'Bạn đã có đủ mọi vật dụng.',
      'fa.kit.none_missing': 'Không còn vật dụng nào thiếu.',
      'fa.kit.list_header': 'NomadCare — vật dụng sơ cứu còn thiếu:',
      'fa.kit.saved': 'Lưu trên máy này, không tải lên máy chủ'
    },
    en: {
      'fa.hero.offline': 'Works without internet',
      'fa.hero.title': 'Offline first aid',
      'fa.hero.sub': '{n} common backpacking emergencies — step by step, illustrated.',
      'fa.intro.lead': '{n} common trip emergencies — step by step, illustrated, no internet needed.',
      'fa.search.label': 'Search first-aid guides',
      'fa.search.placeholder': 'Search: snake bite, burn, CPR…',
      'fa.search.clear': 'Clear search',
      'fa.search.voice': 'Voice search',
      'fa.search.listening': 'Listening… say what happened',
      'fa.search.voice_error': 'Didn’t catch that. Try again or type a keyword.',
      'fa.search.voice_network': 'Voice recognition in this browser needs internet — please type a keyword.',
      'fa.search.voice_denied': 'Microphone permission was not granted — please type a keyword.',
      'fa.search.results': '{n} results for “{q}”',
      'fa.search.none_title': 'No matching guide',
      'fa.search.none_text': 'Try another keyword or clear the search to browse by group. If it is life-threatening, call 115 now.',
      'fa.search.none_title2': 'No exact guide for “{q}”',
      'fa.search.none_urgent': 'If the person is unresponsive, not breathing normally, bleeding heavily or having a seizure: call 115 now (on speaker, or have someone call) and start the steps below at once.',
      'fa.search.none_hint': 'Try another keyword (no accents needed) or clear the search to browse by group.',
      'fa.search.go_cpr': 'CPR (chest compressions)',
      'fa.search.go_recovery': 'Recovery position',
      'fa.search.related': 'Guides that mention “{q}”',
      'fa.search.related_note': 'Not an exact match — check before following',
      'fa.tabs_aria': 'First-aid library',
      'fa.tab.library': 'Guides',
      'fa.tab.kit': 'First-aid kit',
      'fa.crit.title': 'Life-threatening — act now',
      'fa.crit.hint': 'Call 115 on speaker or have someone call — and start the steps at once',
      'fa.prio.critical': 'Critical',
      'fa.prio.urgent': 'Urgent',
      'fa.prio.common': 'Common',
      'fa.steps_n': '{n} steps',
      'fa.has_metronome': 'Metronome',
      'fa.has_timer': 'Timer',
      'fa.quick.cpr': 'CPR metronome',
      'fa.section_count': '{n} guides',
      'fa.section_count_one': '1 guide',
      'fa.section_crit': '+{n} life-threatening above',
      'fa.src.title': 'Content sources & review',
      'fa.src.by': 'Based on',
      'fa.src.more': 'Source details',
      'fa.src.card_sub': 'Every guide names its source documents and year. Wording and drawings are the team’s own; two review rounds before release.',
      'fa.src.sheet_title': 'Medical content sources',
      'fa.src.sheet_sub': 'Every guide names the source documents it follows (proposal section 8.1, table PL.3).',
      'fa.src.used_here': 'Used for this guide',
      'fa.src.publisher': 'Publisher',
      'fa.src.scope': 'Used for',
      'fa.src.year_unknown': 'year: TBC',
      'fa.src.year_tbc': 'year TBC',
      'fa.kit.meta_by': 'List based on',
      'fa.src.own_words': 'All wording is the team’s own and every illustration is drawn by the team; no original text or images are copied. Only actions a lay person may perform are included.',
      'fa.src.review': 'Review',
      'fa.src.round1': 'Round 1 (drafting, source check)',
      'fa.src.round2': 'Round 2 (medical adviser sign-off)',
      'fa.src.pending': 'Not signed yet',
      'fa.version': 'v{v}',
      'fa.review.in_review': 'awaiting adviser sign-off',
      'fa.review.approved': 'signed off',
      'fa.review.draft': 'draft',
      'fa.review.retracted': 'retracted',
      'fa.updated': 'Updated {date}',
      'fa.back_lib': 'First-aid library',
      'fa.call.title': 'Call 115 now if…',
      'fa.call.btn': 'Call 115',
      'fa.call.roam': 'Emergency calls to 115/112 may roam onto any network with signal where you are — but this is not guaranteed when there is no signal at all. Always try calling first.',
      'fa.steps.title': 'First-aid steps',
      'fa.steps.mode_aria': 'How to show the steps',
      'fa.steps.one': 'Step by step',
      'fa.steps.all': 'All steps',
      'fa.steps.label': 'Step {i} of {n}',
      'fa.steps.prev': 'Previous step',
      'fa.steps.next': 'Next step',
      'fa.steps.next_short': 'Next',
      'fa.steps.restart': 'Back to step 1',
      'fa.steps.goto': 'Go to step {i}',
      'fa.steps.carousel_aria': 'First-aid steps, swipe or use the arrow keys',
      'fa.steps.hint': 'Swipe or use the ← → keys to change step',
      'fa.steps.read': 'Read this step aloud',
      'fa.steps.stop_read': 'Stop reading',
      'fa.tts.none': 'This device has no voice for this language yet.',
      'fa.flags.title': 'Danger signs — call 115',
      'fa.donts.title': 'Do not',
      'fa.related': 'Related situations',
      'fa.video.label': 'Video guide',
      'fa.video.ext_title': 'Search videos on YouTube',
      'fa.video.ext_note': 'external, not reviewed by NomadCare (online)',
      'fa.video.reviewed': 'Video reviewed by a medical adviser · online',
      'fa.video.hint_online': 'Opens YouTube · needs internet',
      'fa.video.hint_offline': 'Needs internet — the text and pictures above are enough to follow',
      'fa.notfound.title': 'Guide not found',
      'fa.notfound.text': 'It may have been renamed. Go back to the library to search.',
      'fa.demo_content': 'Illustrative content awaiting round-2 sign-off by a medical adviser before release to real users.',

      'fa.cpr.title': 'CPR metronome',
      'fa.cpr.sub': 'Push on every beep · 5–6 cm deep · let the chest rise fully',
      'fa.cpr.start': 'Start CPR',
      'fa.cpr.pause': 'Pause',
      'fa.cpr.resume': 'Resume',
      'fa.cpr.reset': 'Reset',
      'fa.cpr.mode_aria': 'CPR method',
      'fa.cpr.mode_hands': 'Hands-only',
      'fa.cpr.mode_302': '30:2 with breaths',
      'fa.cpr.hint_hands': 'Recommended if you are not trained in rescue breaths: push non-stop.',
      'fa.cpr.hint_302': 'Only if trained: 30 compressions, then 2 rescue breaths (~1 second each).',
      'fa.cpr.count': 'compressions',
      'fa.cpr.set': 'in this set of 30',
      'fa.cpr.swap_in': 'swap',
      'fa.cpr.swap_now': 'Swap rescuers now!',
      'fa.cpr.swap_hint': 'Swap fast — pause for less than 10 seconds.',
      'fa.cpr.ready': 'Ready',
      'fa.cpr.push': 'PUSH',
      'fa.cpr.paused': 'Paused',
      'fa.cpr.breath': 'Breath {i}/2',
      'fa.cpr.bpm': 'per minute',
      'fa.cpr.bpm_aria': 'Compression rate',
      'fa.cpr.slower': 'Slower',
      'fa.cpr.faster': 'Faster',
      'fa.cpr.sound': 'Sound',
      'fa.cpr.vibrate': 'Vibration',
      'fa.cpr.elapsed': 'Time {t} · cycle {c}',
      'fa.cpr.no_audio': 'This browser cannot play sound — follow the moving picture and the counter.',
      'fa.cpr.ios_hint': 'iPhone: turn off silent mode to hear the beep. The screen stays on while the metronome runs.',
      'fa.cpr.stage_aria': 'Animated chest compressions in time with the beat',
      'fa.cpr.jump': 'Open metronome',

      'fa.ana.title': 'Timer after adrenaline injection',
      'fa.ana.start': 'Injected — start timer',
      'fa.ana.idle_note': 'Tap right after the injection so the app records the time and flags the 5-minute mark.',
      'fa.ana.injected_at': 'Dose 1 given',
      'fa.ana.second_at': 'Dose 2 given',
      'fa.ana.since': 'since the latest dose',
      'fa.ana.wait': 'Keep watching breathing. 5-minute mark at {t}.',
      'fa.ana.due': '5 minutes have passed',
      'fa.ana.second': 'Dose 2 given',
      'fa.ana.reset': 'Reset',
      'fa.ana.reset_q': 'Clear the recorded injection times?',
      'fa.ana.note': 'Tell the medical team the injection times and keep the used pen.',
      'fa.ana.after_second': 'Two doses given: keep watching and be ready to start CPR if breathing stops.',
      'fa.ana.due_toast': '5 minutes since the adrenaline injection — see the second-dose guidance.',
      'fa.ana.jump': '5-minute timer',

      'fa.kit.title': 'Your first-aid kit',
      'fa.kit.sub': 'Medical supplies to pack before the trip — tick what you already have.',
      'fa.kit.progress': '{done}/{total} packed',
      'fa.kit.essential_progress': '{done}/{total} essentials',
      'fa.kit.ready': 'Your first-aid kit is ready for the trip',
      'fa.kit.not_ready': 'Pack at least 80% to complete the trip checklist',
      'fa.kit.essential': 'Essential',
      'fa.kit.optional': 'Optional',
      'fa.kit.filter_aria': 'Filter supplies',
      'fa.kit.filter_all': 'All',
      'fa.kit.filter_essential': 'Essential',
      'fa.kit.filter_missing': 'Missing',
      'fa.kit.clear': 'Untick everything',
      'fa.kit.clear_q': 'Untick every item in your first-aid kit?',
      'fa.kit.copy': 'Copy the missing list',
      'fa.kit.copied': 'Missing items copied',
      'fa.kit.all_done': 'You have everything on the list.',
      'fa.kit.none_missing': 'Nothing is missing.',
      'fa.kit.list_header': 'NomadCare — first-aid items still missing:',
      'fa.kit.saved': 'Saved on this device, never uploaded'
    }
  });

  /* ================================================================== */
  /* helpers                                                             */
  /* ================================================================== */
  function t(k, v) { return NC.i18n.t(k, v); }
  function L() { return NC.i18n.lang() === 'en' ? 'en' : 'vi'; }
  /** Pick the current-language string from a {vi, en} pair. */
  function tx(o) {
    if (!o) return '';
    if (typeof o === 'string') return o;
    return o[L()] || o.vi || o.en || '';
  }
  /** Pick the current-language list from a {vi:[], en:[]} pair. */
  function txl(o) {
    if (!o) return [];
    if (Array.isArray(o)) return o;
    var l = o[L()];
    return (l && l.length) ? l : (o.vi || o.en || []);
  }
  function icon(n, c) { return NC.ui.icon(n, c); }
  function $(sel, root) { return U.$(sel, root); }
  function $$(sel, root) { return U.$$(sel, root); }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function kvGet(k) {
    try { return NC.store ? Promise.resolve(NC.store.get(k)).catch(function () { return null; }) : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }
  function kvSet(k, v) {
    try { if (NC.store) return Promise.resolve(NC.store.set(k, v)).catch(function () { return null; }); }
    catch (e) { /* ignore */ }
    return Promise.resolve(null);
  }
  function mmss(sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function online() { return NC.net ? NC.net.online() : navigator.onLine !== false; }

  var CATS = {};
  var ITEMS = {};
  var PRIO_RANK = { critical: 0, urgent: 1, common: 2 };
  var PRIO_BADGE = { critical: 'danger', urgent: 'warning', common: 'neutral' };
  if (FA) {
    (FA.categories || []).forEach(function (c) { CATS[c.id] = c; });
    (FA.items || []).forEach(function (it) { ITEMS[it.id] = it; });
  }
  function toneOf(it) { var c = it && CATS[it.category]; return (c && c.tone) || 'primary'; }
  /** "Ngừng tim – Hồi sinh tim phổi (CPR)" → "Ngừng tim". */
  function shortTitle(it) {
    var s = tx(it.title);
    var i = s.indexOf(' – ');
    if (i > 0) s = s.slice(0, i);
    i = s.indexOf(' (');
    if (i > 0) s = s.slice(0, i);
    return s;
  }
  function prioLabel(p) { return t('fa.prio.' + (PRIO_BADGE[p] ? p : 'common')); }
  function reviewLabel() {
    var st = (FA && FA.review && FA.review.status) || 'in_review';
    var k = 'fa.review.' + st;
    return NC.i18n.has(k) ? t(k) : st;
  }
  function versionLine() {
    return t('fa.version', { v: FA ? FA.version : '?' }) + ' · ' + reviewLabel();
  }
  function srcById(id) {
    var list = (FA && FA.sources) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  /** ' lang="vi"' / ' lang="en"' when a {vi,en} text falls back to the other language than the UI (screen readers). */
  function langAttr(o) {
    if (!o || typeof o === 'string') return '';
    var l = L();
    if (o[l]) return '';
    return o.vi ? ' lang="vi"' : (o.en ? ' lang="en"' : '');
  }
  /** Text with Vietnamese letters (tone marks, ă â đ ê ô ơ ư) — not merely non-ASCII (an en dash is not Vietnamese). */
  var VI_CHARS = /[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
  function isVi(s) { return VI_CHARS.test(String(s || '')); }
  /**
   * Source short name in the UI language + its year, or "year TBC" — PDF 8.1 (document + year). English: short_en,
   * else the English publisher name when the short name is Vietnamese (e.g. "Hội CTĐ Việt Nam" → Viet Nam Red Cross Society).
   */
  function srcNameHtml(s) {
    var en = L() === 'en';
    var name = en ? (s.short_en || (isVi(s.short) && s.publisher && s.publisher.en) || s.short) : (s.short_vi || s.short);
    var viOnly = en && isVi(name);
    var year = s.year ? String(s.year) : '';
    return '<span' + (viOnly ? ' lang="vi"' : '') + '>' + esc(name) + '</span>' +
      (year ? (name.indexOf(year) < 0 ? ' ' + esc(year) : '') : ' <span class="fa-src__tbc">(' + esc(t('fa.src.year_tbc')) + ')</span>');
  }

  /* ================================================================== */
  /* search index — accent-aware, whole-word matching                    */
  /* Vietnamese syllables are compared whole ("bong" ≠ "bỏng" ≠ "bóng"   */
  /* when the query carries diacritics; exact-diacritic hits outrank     */
  /* folded ones, which only count when no guide has the exact word).    */
  /* A query typed with diacritics that finds nothing is retried folded  */
  /* (partly typed accents "dien giật", tone variants "bò cạp").         */
  /* English words match on light stems (babies → baby) and prefixes.    */
  /* Multi-word queries need the whole phrase (adjacent words) outside   */
  /* the title/keywords, in the summary or steps (a phrase found only in */
  /* warning signs / don'ts / when-to-call is a mention); scattered body */
  /* words are never a result. Intensifiers ("nhiều", "a lot") are       */
  /* optional words.                                                     */
  /* ================================================================== */
  var INDEX = null;
  var SEARCH_SEP = /[\s.,;:!?()[\]{}"'“”‘’«»\/\\|+*=<>–—\-_…·•%#&@^~`]+/;
  var STOP = { 'bị': 1, 'bi': 1, 'của': 1, 'và': 1, 'là': 1, 'tôi': 1, 'bạn': 1, 'thì': 1, 'mà': 1, 'ở': 1, 'với': 1, 'khi': 1, 'đang': 1, 'rất': 1,
    'a': 1, 'an': 1, 'the': 1, 'my': 1, 'i': 1, 'is': 1, 'in': 1, 'on': 1, 'of': 1, 'to': 1, 'and': 1, 'for': 1, 'with': 1, 'me': 1, 'it': 1, 'at': 1,
    'has': 1, 'have': 1, 'got': 1, 'get': 1, 'someone': 1, 'somebody': 1, 'what': 1, 'how': 1, 'do': 1 };
  /** Intensifiers: they add to the score where a guide has them, but no guide needs them to match ("chảy máu nhiều"). */
  var SOFT = { 'nhiều': 1, 'nhieu': 1, 'lắm': 1, 'lot': 1, 'lots': 1, 'much': 1, 'very': 1, 'badly': 1, 'heavily': 1, 'really': 1 };
  var FIELD_W = { title: 10, kw: 8, sum: 3, body: 1.5, extra: 1.5 };
  var FIELDS = ['title', 'kw', 'sum', 'body', 'extra'];
  function lowerNFC(s) { var o = String(s === null || s === undefined ? '' : s).toLowerCase(); return o.normalize ? o.normalize('NFC') : o; }
  function foldWord(w) { var o = w.normalize ? w.normalize('NFD') : w; return o.replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
  /** Light English stemming; Vietnamese syllables never end in "s", so they are left untouched. */
  function stemWord(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /[^su]s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function tokens(text) {
    return lowerNFC(text).split(SEARCH_SEP).filter(Boolean).map(function (w) { var f = foldWord(w); return { x: w, f: f, s: stemWord(f) }; });
  }
  function both(o) { return o ? [].concat(o.vi || [], o.en || []) : []; }
  function buildIndex() {
    INDEX = (FA.items || []).map(function (it) {
      var cat = CATS[it.category];
      var body = [];
      (it.steps || []).forEach(function (s) { body = body.concat(both(s.text), both(s.detail)); });
      var extra = [].concat(both(it.red_flags), both(it.donts), both(it.call115), cat ? both(cat.label) : []);
      var toks = function (a) { return a.map(tokens).filter(function (x) { return x.length; }); };
      return {
        item: it,
        title: [tokens(both(it.title).join(' '))],
        kw: both(it.keywords).map(tokens).filter(function (a) { return a.length; }),
        sum: [tokens(both(it.summary).join(' '))],
        body: toks(body),
        extra: toks(extra) // warning signs, don'ts, when to call 115: a phrase found only here is a mention
      };
    });
  }
  /**
   * Quality of one query term against one indexed word: 1 exact · .9 same letters, other accents (query typed without
   * diacritics) · .7 word prefix (≥ 4 letters) · .5 prefix of the word still being typed · .35 accent-folded only · 0.
   * Only ≥ .6 counts towards a real match; lower values can at most make a "mentions" suggestion.
   */
  function rawQ(term, tok, last) {
    if (term.dia) {
      if (tok.x === term.x) return 1;
      if (tok.f === term.f) return 0.35;
      if (tok.x.indexOf(term.x) === 0) return term.f.length >= 4 ? 0.7 : (last ? 0.5 : 0);
      return 0;
    }
    if (tok.x === term.x || (term.s.length >= 3 && tok.s === term.s && tok.x === tok.f)) return 1;
    if (tok.f === term.f || (term.s.length >= 3 && tok.s === term.s)) return 0.9;
    if (tok.f.indexOf(term.f) === 0) return term.f.length >= 4 ? 0.7 : (last && term.f.length >= 2 ? 0.5 : 0);
    // English inflection of an indexed word: "sprained" → sprain, "burning" → burn (Vietnamese syllables never end so).
    if (tok.f.length >= 4 && term.f.indexOf(tok.f) === 0 && /^(ed|d|ing|s|es)$/.test(term.f.slice(tok.f.length))) return 0.8;
    return 0;
  }
  /**
   * term.strict (set by searchAll): some guide contains this word EXACTLY, so accent-folded look-alikes no longer
   * count — for a diacritic term (vắt ≠ vật) and, in a query typed with diacritics, for a plain word too ("chảy máu
   * cam" → "cam" ≠ "cầm"). Look-alikes of a plain word stay a mention (typo tolerance), never a match.
   */
  function wordQ(term, tok, last) {
    var v = rawQ(term, tok, last);
    if (term.strict && v < term.thr) v = term.dia ? 0 : Math.min(v, 0.35);
    return v;
  }
  /**
   * Best quality of each query term inside one field (array of token lists), and for each sequence of term indexes in
   * seqs the best whole-phrase quality (adjacent words) + whether that phrase is the entire list (equal). Every word
   * quality is computed once and reused by the phrase scan.
   * mid (keywords): a single word matching only the MIDDLE of a keyword of 3+ words is a mention, not a match
   * ("răng" ≠ "vết răng nanh"); the first word (Vietnamese head) and the last word (English head) still match.
   */
  function fieldMatch(lists, terms, seqs, mid) {
    var q = terms.map(function () { return 0; });
    var ph = seqs.map(function () { return 0; }), eq = seqs.map(function () { return false; });
    lists.forEach(function (toks) {
      var L = toks.length, vals = [], i, k;
      for (i = 0; i < terms.length; i++) {
        var row = vals[i] = [];
        for (k = 0; k < L; k++) {
          var v = wordQ(terms[i], toks[k], terms[i].last);
          row.push(v);
          if (mid && L >= 3 && k > 0 && k < L - 1) v = Math.min(v, 0.5);
          if (v > q[i]) q[i] = v;
        }
      }
      seqs.forEach(function (seq, si) {
        var n = seq.length;
        if (n > 1) {
          for (var p = 0; p + n <= L; p++) {
            var m = 1;
            for (var j = 0; j < n && m > 0; j++) m = Math.min(m, vals[seq[j]][p + j]);
            if (m > ph[si]) { ph[si] = m; eq[si] = L === n; }
          }
        } else if (L === 1 && vals[seq[0]][0] >= 1) eq[si] = true;
      });
    });
    return { q: q, ph: ph, eq: eq };
  }
  function fieldsMatch(x, terms, seqs) {
    return { title: fieldMatch(x.title, terms, seqs), kw: fieldMatch(x.kw, terms, seqs, true), sum: fieldMatch(x.sum, terms, seqs),
      body: fieldMatch(x.body, terms, seqs), extra: fieldMatch(x.extra, terms, seqs) };
  }
  /**
   * One ranking pass over every guide → [{item, score, tier}] (unsorted, tier 0 = no match). strict: apply the
   * exact-accent rules (see wordQ); otherwise the terms arrive prepared (folded, or strict with their own thr).
   * tiers: 3 strong (title/keywords) · 2.5 title/keywords carry all words but one and the guide really contains that
   * one too · 2 whole phrase in summary/steps · 1 weak (words only mentioned, or a phrase found only among the warning
   * signs / don'ts / when-to-call lines) · .5 partial.
   * Only "core" words count towards a tier: stop words and intensifiers (SOFT) are optional.
   */
  function rankAll(all, strictOn) {
    var ix = function (t0) { return all.indexOf(t0); };
    var req = all.filter(function (t0) { return !t0.stop; });
    if (!req.length) req = all;
    var core = req.filter(function (t0) { return !t0.soft; });
    if (!core.length) core = req;
    req.forEach(function (t0) { t0.core = core.indexOf(t0) >= 0; });
    var ri = req.map(ix);
    // Phrase = the query as typed (stop words included); the core words alone (intensifiers left out) only add to the score.
    var seqs = [all.length > 1 && all.length !== req.length ? all.map(ix) : ri];
    var coreSeq = core.length > 1 && core.length !== req.length;
    if (coreSeq) seqs.push(core.map(ix));
    var match = function () { return INDEX.map(function (x) { return { x: x, f: fieldsMatch(x, all, seqs) }; }); };
    var rows = match();
    if (strictOn) {
      // Exact words win (see wordQ): a diacritic term that some guide contains exactly (vắt ≠ vật, rết ≠ rét); and in a
      // query typed WITH diacritics a plain word is meant as typed (máu cam ≠ cầm máu) — accent folding is only for
      // queries typed without any diacritics. Re-matched so phrases use the same rule.
      var diaQuery = all.some(function (t0) { return t0.dia; });
      var strict = false;
      req.forEach(function (term, i) {
        if (term.dia) {
          if (rows.some(function (r) { return FIELDS.some(function (f) { return r.f[f].q[ri[i]] >= 0.6; }); })) { term.strict = true; term.thr = 0.6; strict = true; }
        } else if (diaQuery) { term.strict = true; term.thr = 1; strict = true; }
      });
      if (strict) rows = match();
    }
    var out = [];
    rows.forEach(function (r) {
      var F = r.f, score = 0, n = 0, matched = 0, real = 0, strongTerms = 0, sumTerms = 0;
      req.forEach(function (term, i) {
        var t1 = ri[i], best = 0, top = 0;
        FIELDS.forEach(function (f) { best = Math.max(best, FIELD_W[f] * F[f].q[t1]); top = Math.max(top, F[f].q[t1]); });
        score += best;
        if (!term.core) return; // an intensifier counts where the guide has it, but is never required
        n++;
        if (best > 0) matched++;
        if (top >= 0.6) real++;
        if (Math.max(F.title.q[t1], F.kw.q[t1]) >= 0.6) strongTerms++;
        if (F.sum.q[t1] >= 0.6) sumTerms++;
      });
      var phrase = all.length > 1 ? { title: F.title.ph[0], kw: F.kw.ph[0], sum: F.sum.ph[0], body: F.body.ph[0] } : null;
      if (phrase) score += 15 * phrase.title + 12 * phrase.kw + 4 * Math.max(phrase.sum, phrase.body, F.extra.ph[0]);
      if (coreSeq) score += 15 * F.title.ph[1] + 12 * F.kw.ph[1] + 4 * Math.max(F.sum.ph[1], F.body.ph[1], F.extra.ph[1]);
      if ((all.length > 1 ? F.kw.eq[0] && F.kw.ph[0] >= 1 : F.kw.eq[0]) || (coreSeq && F.kw.eq[1] && F.kw.ph[1] >= 1)) score += 8;
      score += (2 - (PRIO_RANK[r.x.item.priority] || 0)) * 0.3;
      var tier = 0;
      if (matched === n) {
        if (strongTerms === n || (phrase && Math.max(phrase.title, phrase.kw) >= 0.6)) tier = 3;
        // "vết thương chảy máu" → Severe bleeding: never outranked by a guide that only has the phrase in its text.
        else if (n >= 3 && strongTerms >= n - 1 && real === n) tier = 2.5;
        else if (phrase && (Math.max(phrase.sum, phrase.body) >= 0.6 || sumTerms === n)) tier = 2; // whole phrase in the text
        else tier = 1; // the word(s) only appear somewhere in the text: a mention, never a result
      } else if (n >= 3 && strongTerms >= 1 && matched >= Math.max(2, Math.ceil(n * 0.6))) tier = 0.5;
      out.push({ item: r.x.item, score: score, tier: tier });
    });
    return out;
  }
  function ranked(rows) {
    return rows.filter(function (r) { return r.tier; }).sort(function (a, b) { return b.tier - a.tier || b.score - a.score; });
  }
  function hasResult(rows) { return rows.some(function (r) { return r.tier >= 2; }); }
  /**
   * Ranked search. → {results:[item] (title/keyword or whole-phrase matches), related:[item] (mentions only)}.
   */
  function searchAll(q) {
    if (!INDEX) buildIndex();
    var all = tokens(q);
    if (!all.length) return null;
    var endsOpen = !/\s$/.test(String(q));
    all.forEach(function (t0, i) {
      t0.dia = t0.x !== t0.f; t0.last = endsOpen && i === all.length - 1; t0.stop = !!STOP[t0.x]; t0.soft = !!SOFT[t0.x];
    });
    var out = ranked(rankAll(all, true));
    // Partly typed accents ("dien giật", "bỏng nuoc soi") or a tone variant / typo ("ong đôt", "đột qụy") find no real
    // match as typed: retry once with every word folded EXCEPT the words typed with diacritics that the library does
    // contain exactly — those still match only as typed, so the collisions the exact-accent rules prevent (máu cam ≠
    // cầm máu, vắt ≠ vật, mắt đỏ) cannot come back. The retry only counts when it finds a title/keyword match; a query
    // that matches as typed is never re-ranked.
    if (all.some(function (t0) { return t0.dia; }) && !hasResult(out)) {
      var loose = ranked(rankAll(all.map(function (t0) {
        var keep = t0.dia && t0.strict && t0.thr < 1;
        return { x: keep ? t0.x : t0.f, f: t0.f, s: t0.s, dia: keep, strict: keep, thr: 0.6, last: t0.last, stop: t0.stop, soft: t0.soft };
      }), false));
      if (loose.length && loose[0].tier >= 3) out = loose;
    }
    // Title/keyword matches exist → only those; otherwise guides containing the whole phrase.
    var top = out.length && out[0].tier >= 3 ? 3 : 2;
    var results = out.filter(function (r) { return r.tier >= top; }).map(function (r) { return r.item; });
    var related = results.length ? [] : out.filter(function (r) { return r.tier < 2; }).slice(0, 6).map(function (r) { return r.item; });
    return { results: results, related: related };
  }
  /** Public/compat: ranked guides that really match the query (never "mentions only"). */
  function search(q) { var r = searchAll(q); return r ? r.results : null; }

  /* ================================================================== */
  /* state                                                               */
  /* ================================================================== */
  var S = {
    section: null, root: null, lib: null, itemEl: null,
    active: false, view: 'lib', tab: 'lib', q: '',
    itemId: null, step: 0, stepsMode: lsGet('nc.fa.steps') === 'list' ? 'list' : 'carousel',
    kit: {}, kitFilter: 'all', ana: null, secs: null,
    libScroll: 0, params: {}
  };

  /* ================================================================== */
  /* skeleton (fallback when the integrator has not inserted the partial) */
  /* ================================================================== */
  function ensureSkeleton(section) {
    var root = document.getElementById('fa-root');
    if (root) return root;
    // Minimal equivalent of _partials/screen-firstaid.html (same ids / classes).
    section.innerHTML =
      '<div class="fa" id="fa-root"><div class="fa-lib" id="fa-lib">' +
      '<section class="page-intro fa-intro" id="fa-intro"><div class="page-intro__text"><p class="page-intro__lead fa-intro__lead" id="fa-hero-sub"></p></div>' +
      '<div class="page-intro__actions fa-intro__actions">' +
      '<form class="fa-search" id="fa-search" role="search" autocomplete="off"><label class="visually-hidden" for="fa-q" data-i18n="fa.search.label"></label>' +
      icon('search', 'fa-search__icon') + '<input class="fa-search__input" id="fa-q" type="search" enterkeyhint="search" spellcheck="false" data-i18n-attr="placeholder:fa.search.placeholder">' +
      '<button class="fa-search__btn" type="button" id="fa-q-clear" hidden data-i18n-attr="aria-label:fa.search.clear;title:fa.search.clear">' + icon('x') + '</button>' +
      '<button class="fa-search__btn fa-search__mic" type="button" id="fa-q-mic" hidden data-i18n-attr="aria-label:fa.search.voice;title:fa.search.voice">' + icon('mic') + '</button></form>' +
      '</div></section>' +
      '<div class="segmented segmented--lg fa-tabs" id="fa-tabs" role="tablist" data-i18n-attr="aria-label:fa.tabs_aria">' +
      '<button class="segmented__btn is-selected" type="button" role="tab" id="fa-tab-lib" data-tab="lib" aria-selected="true" aria-controls="fa-panel-lib">' + icon('book-open') + '<span data-i18n="fa.tab.library"></span></button>' +
      '<button class="segmented__btn" type="button" role="tab" id="fa-tab-kit" data-tab="kit" aria-selected="false" aria-controls="fa-panel-kit" tabindex="-1">' + icon('backpack') + '<span data-i18n="fa.tab.kit"></span><span class="fa-tabs__count" id="fa-kit-count"></span></button></div>' +
      '<section class="fa-panel" id="fa-panel-lib" role="tabpanel" aria-labelledby="fa-tab-lib">' +
      '<p class="fa-results" id="fa-results" aria-live="polite"></p>' +
      '<section class="fa-crit" id="fa-crit" aria-labelledby="fa-crit-title"><div class="fa-crit__head"><h2 class="fa-crit__title" id="fa-crit-title"><span class="fa-crit__dot" aria-hidden="true"></span><span data-i18n="fa.crit.title"></span></h2>' +
      '<div class="fa-crit__acts"><a class="btn btn--danger btn--sm fa-crit__call" href="tel:115" data-call="115">' + icon('phone') + '<span data-i18n="fa.call.btn"></span></a>' +
      '<a class="btn btn--outline btn--sm fa-crit__cpr" href="#/firstaid?item=cpr&amp;tool=cpr">' + icon('heart-pulse') + '<span data-i18n="fa.quick.cpr"></span></a></div>' +
      '<p class="fa-crit__hint" data-i18n="fa.crit.hint"></p></div><div class="fa-crit__list" id="fa-crit-list"></div></section>' +
      '<div class="fa-sections" id="fa-sections"></div><div class="fa-foot" id="fa-lib-foot"></div></section>' +
      '<section class="fa-panel" id="fa-panel-kit" role="tabpanel" aria-labelledby="fa-tab-kit" hidden></section></div>' +
      '<article class="fa-item" id="fa-item" hidden></article></div>';
    NC.i18n.apply(section);
    return document.getElementById('fa-root');
  }

  /* ================================================================== */
  /* LIBRARY                                                             */
  /* ================================================================== */
  /** Page intro lead (the count follows the content file). */
  function renderHero() {
    var sub = document.getElementById('fa-hero-sub');
    if (sub) {
      sub.setAttribute('data-i18n', 'fa.intro.lead');
      sub.setAttribute('data-i18n-vars', JSON.stringify({ n: FA.items.length }));
      sub.textContent = t('fa.intro.lead', { n: FA.items.length });
    }
  }

  /**
   * Library row (round-2 declutter): plain glyph + title + one meta line (priority word for critical / urgent guides,
   * steps, tool). No pill badges and no pictures in lists — the step illustrations stay in the item view. Critical
   * guides live in the red block (not in the category sections); their row, in search results, carries a red glyph
   * + the word.
   * opts.cat → also name the category (search results mix groups).
   */
  function cardHtml(it, opts) {
    var o = opts || {};
    var cat = CATS[it.category] || {};
    var prio = PRIO_BADGE[it.priority] ? it.priority : 'common';
    var extra = it.special === 'cpr' ? '<span class="fa-row__tool">' + icon('activity') + esc(t('fa.has_metronome')) + '</span>'
      : it.special === 'anaphylaxis' ? '<span class="fa-row__tool">' + icon('timer') + esc(t('fa.has_timer')) + '</span>' : '';
    return '<a class="fa-row fa-row--' + esc(prio) + ' fa-tone--' + esc(toneOf(it)) + '" href="#/firstaid?item=' + encodeURIComponent(it.id) + '" data-item="' + esc(it.id) + '">' +
      '<span class="fa-row__ic" aria-hidden="true">' + icon(it.icon || cat.icon || 'cross') + '</span>' +
      '<span class="fa-row__body">' +
      '<span class="fa-row__title"' + langAttr(it.title) + '>' + esc(tx(it.title)) + '</span>' +
      '<span class="fa-row__meta">' +
      (prio !== 'common' ? '<span class="fa-row__prio">' + esc(prioLabel(prio)) + '</span>' : '') +
      (o.cat && cat.label ? '<span class="fa-row__cat">' + esc(tx(cat.label)) + '</span>' : '') +
      '<span>' + esc(t('fa.steps_n', { n: it.steps.length })) + '</span>' + extra + '</span>' +
      '</span>' +
      icon('chevron-right', 'fa-row__go') + '</a>';
  }

  function critHtml(it) {
    return '<a class="fa-crit__item" href="#/firstaid?item=' + encodeURIComponent(it.id) + '" data-item="' + esc(it.id) + '">' +
      '<span class="fa-crit__ic" aria-hidden="true">' + icon(it.icon || 'alert-triangle') + '</span>' +
      '<span class="fa-crit__name"' + langAttr(it.title) + '>' + esc(shortTitle(it)) + '</span></a>';
  }

  function renderCrit() {
    var list = document.getElementById('fa-crit-list');
    if (!list) return;
    list.innerHTML = FA.items.filter(function (it) { return it.priority === 'critical'; }).map(critHtml).join('');
  }

  /*
   * Category sections fold (round-2 declutter): the ONE way to browse by group (no category chip row). A heading
   * button with aria-expanded; the folded state shows a one-line preview of the guide names. Default: folded on
   * phones, open from 768px; the reader's own choice is remembered on this device (localStorage 'nc.fa.secs').
   */
  var SEC_KEY = 'nc.fa.secs';
  function secPrefs() {
    if (!S.secs) {
      var v = null;
      try { v = JSON.parse(lsGet(SEC_KEY) || 'null'); } catch (e) { v = null; }
      S.secs = v && typeof v === 'object' ? v : {};
    }
    return S.secs;
  }
  function secOpen(id) {
    var p = secPrefs();
    return p[id] === undefined ? !isPhone() : !!p[id];
  }
  function toggleSec(id) {
    var open = !secOpen(id);
    secPrefs()[id] = open;
    lsSet(SEC_KEY, JSON.stringify(S.secs));
    var sec = document.querySelector('.fa-sec[data-sec="' + id + '"]');
    if (!sec) return;
    sec.classList.toggle('is-open', open);
    var btn = sec.querySelector('button[data-fa-sec]'), body = sec.querySelector('.fa-sec__body'), peek = sec.querySelector('.fa-sec__peek');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.hidden = !open;
    if (peek) peek.hidden = open;
  }

  // nCrit: the category's critical guides, listed once in the red "Nguy kịch" block above (not repeated here) — the
  // count line says where they are.
  function sectionHtml(cat, items, nCrit) {
    var id = String(cat.id);
    var open = secOpen(id);
    var peek = items.map(function (it) { return '<span' + langAttr(it.title) + '>' + esc(shortTitle(it)) + '</span>'; }).join('<span aria-hidden="true"> · </span>');
    var count = items.length === 1 ? t('fa.section_count_one') : t('fa.section_count', { n: items.length });
    if (nCrit) count += ' · ' + t('fa.section_crit', { n: nCrit });
    var head = '<span class="icon-tile icon-tile--sm icon-tile--' + esc(cat.tone || 'primary') + '">' + icon(cat.icon) + '</span>' +
      '<span class="fa-sec__label"><span class="fa-sec__name">' + esc(tx(cat.label)) + '</span>' +
      '<span class="fa-sec__count">' + esc(count) + '</span></span>';
    return '<section class="fa-sec fa-tone--' + esc(cat.tone || 'primary') + (open ? ' is-open' : '') + '" data-sec="' + esc(id) + '" aria-labelledby="fa-sec-' + esc(id) + '">' +
      '<h2 class="fa-sec__title" id="fa-sec-' + esc(id) + '">' +
      '<button type="button" class="fa-sec__toggle" data-fa-sec="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="fa-sec-body-' + esc(id) + '">' +
      head + icon('chevron-down', 'fa-sec__chev') + '</button></h2>' +
      // The preview line also unfolds on tap (pointer convenience; the heading button is the keyboard / screen-reader path).
      '<p class="fa-sec__peek" data-fa-sec="' + esc(id) + '"' + (open ? ' hidden' : '') + '>' + peek + '</p>' +
      '<div class="fa-sec__body fa-rows" id="fa-sec-body-' + esc(id) + '"' + (open ? '' : ' hidden') + '>' + items.map(function (it) { return cardHtml(it); }).join('') + '</div></section>';
  }

  function sortItems(arr) {
    return arr.slice().sort(function (a, b) { return (PRIO_RANK[a.priority] || 0) - (PRIO_RANK[b.priority] || 0); });
  }

  function renderResults() {
    var secBox = document.getElementById('fa-sections');
    var crit = document.getElementById('fa-crit');
    var res = document.getElementById('fa-results');
    if (!secBox) return;
    var q = S.q.trim();
    var found = q ? searchAll(q) : null;
    if (crit) crit.hidden = !!found;
    // Search results and the "no exact guide" state are ONE child: from 768px it must span the full width instead of
    // one track of the side-by-side section grid (responsive.css @module:firstaid).
    secBox.classList.toggle('fa-sections--flat', !!found);
    if (found) {
      var list = found.results;
      res.hidden = false;
      res.textContent = t('fa.search.results', { n: list.length, q: q });
      if (!list.length) {
        secBox.innerHTML = '';
        secBox.appendChild(noneState(q, found.related));
        return;
      }
      secBox.innerHTML = '<div class="fa-rows fa-rows--results">' + list.map(function (it) { return cardHtml(it, { cat: true }); }).join('') + '</div>';
      return;
    }
    res.hidden = true;
    res.textContent = '';
    // Round-2 declutter (UX.0): every critical guide is listed ONCE, in the red block that always comes first; the
    // category sections hold the other guides (search still covers all of them).
    var html = '';
    FA.categories.forEach(function (c) {
      var all = FA.items.filter(function (it) { return it.category === c.id; });
      var items = sortItems(all.filter(function (it) { return it.priority !== 'critical'; }));
      if (items.length) html += sectionHtml(c, items, all.length - items.length);
    });
    secBox.innerHTML = html;
  }
  /**
   * "No exact guide" state: never presents a guide that only mentions the words as a result. Leads with 115 (on
   * speaker / someone else calls) and the two life-saving actions (CPR, recovery position); mentions come last.
   */
  function noneState(q, related) {
    var wrap = U.h('div', { class: 'fa-none' });
    var quick = [];
    if (ITEMS.cpr) quick.push('<a class="btn btn--soft btn--lg fa-none__go fa-tone--danger" href="#/firstaid?item=cpr&amp;tool=cpr">' + icon('heart-pulse') + '<span>' + esc(t('fa.search.go_cpr')) + '</span></a>');
    if (ITEMS.recovery) quick.push('<a class="btn btn--soft btn--lg fa-none__go" href="#/firstaid?item=recovery">' + icon('bed') + '<span>' + esc(t('fa.search.go_recovery')) + '</span></a>');
    var crit = FA.items.filter(function (it) { return it.priority === 'critical' && it.id !== 'cpr'; }).slice(0, 6);
    wrap.innerHTML =
      '<section class="card fa-none__card" aria-labelledby="fa-none-title">' +
      '<div class="fa-none__head"><span class="icon-tile icon-tile--lg icon-tile--solid-danger" aria-hidden="true">' + icon('siren') + '</span>' +
      '<div class="fa-none__heading"><h2 class="fa-none__title" id="fa-none-title">' + esc(t('fa.search.none_title2', { q: q })) + '</h2>' +
      '<p class="fa-none__text">' + esc(t('fa.search.none_urgent')) + '</p></div></div>' +
      '<a class="btn btn--danger btn--xl btn--block fa-empty__call" href="tel:115" data-call="115">' + icon('phone') + '<span>' + esc(t('fa.call.btn')) + '</span></a>' +
      '<p class="fa-none__roam">' + icon('signal', 'icon--xs') + '<span>' + esc(t('fa.call.roam')) + '</span></p>' +
      (quick.length ? '<div class="fa-none__quick">' + quick.join('') + '</div>' : '') +
      '<p class="fa-none__hint">' + icon('search', 'icon--xs') + '<span>' + esc(t('fa.search.none_hint')) + '</span></p>' +
      (crit.length ? '<div class="chip-group fa-empty__sug">' + crit.map(function (it) {
        return '<a class="chip chip--soft" href="#/firstaid?item=' + encodeURIComponent(it.id) + '">' + icon(it.icon) + '<span' + langAttr(it.title) + '>' + esc(shortTitle(it)) + '</span></a>';
      }).join('') + '</div>' : '') +
      '</section>' +
      (related && related.length ? '<section class="fa-none__rel" aria-labelledby="fa-none-rel"><div class="section-head"><h2 class="section-head__title fa-none__reltitle" id="fa-none-rel">' + esc(t('fa.search.related', { q: q })) + '</h2>' +
        '<span class="fa-none__relnote">' + esc(t('fa.search.related_note')) + '</span></div>' +
        '<div class="fa-rows fa-rows--results">' + related.map(function (it) { return cardHtml(it, { cat: true }); }).join('') + '</div></section>' : '');
    return wrap;
  }

  /**
   * Library footer (round-2 declutter): sources + version/review fold into the shared "technical details" disclosure
   * (one row, version + review status as its subtitle; the list, update date and "Source details" sheet inside);
   * compact disclaimer with 115 stays visible.
   */
  function renderLibFoot() {
    var foot = document.getElementById('fa-lib-foot');
    if (!foot) return;
    var prev = foot.querySelector('details.fa-srccard');
    var open = !!(prev && prev.open);
    foot.innerHTML = '';
    var card = U.h('details', { class: 'disclosure disclosure--card fa-srccard' });
    if (open) card.open = true;
    card.innerHTML =
      '<summary class="disclosure__sum">' + icon('book-open') + '<span class="disclosure__txt">' +
      '<span class="disclosure__title" id="fa-srccard-title">' + esc(t('fa.src.title')) + '</span>' +
      '<span class="disclosure__sub">' + esc(versionLine()) + '</span></span>' +
      '<span class="disclosure__chev">' + icon('chevron-down') + '</span></summary>' +
      '<div class="disclosure__body">' +
      '<p class="fa-srccard__list"><span class="fa-srccard__by">' + esc(t('fa.src.by')) + ':</span> ' + FA.sources.map(function (s) {
        return '<span class="fa-srccard__short">' + srcNameHtml(s) + '</span>';
      }).join('<span class="fa-meta__sep" aria-hidden="true">·</span>') + '</p>' +
      // version + review status are the summary's subtitle already (each status once per screen)
      '<div class="fa-srccard__foot"><span class="fa-srccard__upd">' + esc(t('fa.updated', { date: U.fmtDate(FA.updated) })) + '</span>' +
      '<button type="button" class="btn btn--soft btn--sm" data-fa="sources">' + icon('info') + '<span>' + esc(t('fa.src.more')) + '</span></button></div></div>';
    foot.appendChild(card);
    foot.appendChild(NC.ui.disclaimer({ compact: true }));
  }

  function versionBadge() {
    var st = (FA.review && FA.review.status) || 'in_review';
    return '<span class="badge ' + (st === 'approved' ? 'badge--success' : 'badge--warning') + ' fa-version">' + icon(st === 'approved' ? 'check-circle' : 'clock') +
      '<span>' + esc(versionLine()) + '</span></span>';
  }

  function renderTabs() {
    $$('#fa-tabs [data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === S.tab;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.setAttribute('tabindex', on ? '0' : '-1');
    });
    if (S.lib) S.lib.classList.toggle('is-kit', S.tab === 'kit');
    var pl = document.getElementById('fa-panel-lib'), pk = document.getElementById('fa-panel-kit');
    if (pl) pl.hidden = S.tab !== 'lib';
    if (pk) pk.hidden = S.tab !== 'kit';
    updateKitCount();
  }

  function renderLibrary() {
    renderHero();
    renderCrit();
    renderResults();
    renderLibFoot();
    renderTabs();
    if (S.tab === 'kit') renderKit();
    updateSearchButtons();
  }

  /* ---------- search input + voice ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var recog = null;
  var runSearch = U.debounce(function () { renderResults(); }, 120);

  function updateSearchButtons() {
    var clear = document.getElementById('fa-q-clear');
    var mic = document.getElementById('fa-q-mic');
    if (clear) clear.hidden = !S.q;
    if (mic) {
      mic.hidden = !SR;
      mic.classList.toggle('is-offline', !online());
    }
  }
  function startVoice() {
    if (!SR) return;
    if (recog) { try { recog.stop(); } catch (e) { /* ignore */ } return; }
    var input = document.getElementById('fa-q');
    var mic = document.getElementById('fa-q-mic');
    try {
      recog = new SR();
      recog.lang = L() === 'en' ? 'en-US' : 'vi-VN';
      recog.interimResults = true;
      recog.maxAlternatives = 1;
      recog.onresult = function (e) {
        var txt = '';
        for (var i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
        txt = String(txt || '').replace(/[.?!。]+$/, '').trim();
        if (input && txt) { input.value = txt; S.q = txt; updateSearchButtons(); renderResults(); }
      };
      recog.onerror = function (e) {
        var err = e && e.error;
        if (err === 'network') NC.ui.toast(t('fa.search.voice_network'), { type: 'warning' });
        else if (err === 'not-allowed' || err === 'service-not-allowed') NC.ui.toast(t('fa.search.voice_denied'), { type: 'warning' });
        else if (err !== 'aborted') NC.ui.toast(t('fa.search.voice_error'), { type: 'info' });
      };
      recog.onend = function () {
        recog = null;
        if (mic) { mic.classList.remove('is-listening'); mic.setAttribute('aria-pressed', 'false'); }
        if (input) input.setAttribute('placeholder', t('fa.search.placeholder'));
      };
      recog.start();
      if (mic) { mic.classList.add('is-listening'); mic.setAttribute('aria-pressed', 'true'); }
      if (input) input.setAttribute('placeholder', t('fa.search.listening'));
    } catch (err) {
      recog = null;
      NC.ui.toast(t('fa.search.voice_error'), { type: 'info' });
    }
  }
  function stopVoice() { if (recog) { try { recog.abort(); } catch (e) { /* ignore */ } recog = null; } }

  /* ================================================================== */
  /* KIT                                                                  */
  /* ================================================================== */
  function kitStats(map) {
    var m = map || S.kit || {};
    var kit = FA.kit || [];
    var done = 0, ess = 0, essDone = 0;
    kit.forEach(function (k) {
      if (m[k.id]) done++;
      if (k.essential) { ess++; if (m[k.id]) essDone++; }
    });
    return { done: done, total: kit.length, essentialDone: essDone, essentialTotal: ess, pct: kit.length ? done / kit.length : 0 };
  }
  function updateKitCount() {
    var el = document.getElementById('fa-kit-count');
    if (!el) return;
    var st = kitStats();
    el.textContent = st.done + '/' + st.total;
    el.classList.toggle('is-done', st.pct >= 0.8);
  }
  function ringHtml(frac, cls, labelHtml) {
    var size = 120, sw = 12, r = (size - sw) / 2, c = 2 * Math.PI * r;
    var f = Math.max(0, Math.min(1, frac || 0));
    return '<div class="ring ' + (cls || '') + '">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true" focusable="false">' +
      '<circle class="ring__track" cx="60" cy="60" r="' + r + '" stroke-width="' + sw + '"/>' +
      '<circle class="ring__value" cx="60" cy="60" r="' + r + '" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - f)).toFixed(2) + '"/>' +
      '</svg><div class="ring__label">' + labelHtml + '</div></div>';
  }
  function setRing(ringEl, frac) {
    if (!ringEl) return;
    var v = ringEl.querySelector('.ring__value');
    if (!v) return;
    var c = parseFloat(v.getAttribute('stroke-dasharray')) || 0;
    v.setAttribute('stroke-dashoffset', (c * (1 - Math.max(0, Math.min(1, frac)))).toFixed(2));
  }

  function renderKit() {
    var panel = document.getElementById('fa-panel-kit');
    if (!panel) return;
    var st = kitStats();
    var ready = st.pct >= 0.8;
    var kit = FA.kit || [];
    var filters = [['all', kit.length], ['essential', st.essentialTotal], ['missing', st.total - st.done]];
    var shown = kit.filter(function (k) {
      if (S.kitFilter === 'essential') return k.essential;
      if (S.kitFilter === 'missing') return !S.kit[k.id];
      return true;
    }).sort(function (a, b) { return (b.essential ? 1 : 0) - (a.essential ? 1 : 0); });
    var focusId = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.getAttribute('data-kit') || document.activeElement.getAttribute('data-kitf') : null;

    panel.innerHTML =
      '<section class="card fa-kit__summary' + (ready ? ' is-ready' : '') + '" aria-labelledby="fa-kit-title">' +
      ringHtml(st.pct, 'fa-kit__ring' + (ready ? ' ring--success' : ' ring--accent'), '<b>' + Math.round(st.pct * 100) + '%</b><small>' + st.done + '/' + st.total + '</small>') +
      '<div class="fa-kit__info"><h2 class="fa-kit__title" id="fa-kit-title">' + esc(t('fa.kit.title')) + '</h2>' +
      '<p class="fa-kit__sub">' + esc(t('fa.kit.sub')) + '</p>' +
      '<div class="progress progress--lg' + (ready ? '' : ' progress--accent') + '"><div class="progress__bar fa-kit__bar"></div></div>' +
      '<p class="fa-kit__stat">' + esc(t('fa.kit.essential_progress', { done: st.essentialDone, total: st.essentialTotal })) + '</p>' +
      '<p class="fa-kit__status">' + icon(ready ? 'check-circle' : 'info') + '<span>' + esc(t(ready ? 'fa.kit.ready' : 'fa.kit.not_ready')) + '</span></p>' +
      '<p class="fa-kit__saved">' + icon('lock') + '<span>' + esc(t('fa.kit.saved')) + '</span></p></div></section>' +
      '<div class="chip-group fa-kit__filters" role="group" aria-label="' + esc(t('fa.kit.filter_aria')) + '">' + filters.map(function (f) {
        var on = S.kitFilter === f[0];
        return '<button type="button" class="chip' + (on ? ' is-selected' : '') + '" data-kitf="' + f[0] + '" aria-pressed="' + on + '">' + esc(t('fa.kit.filter_' + f[0])) + '<span class="fa-cat__n">' + f[1] + '</span></button>';
      }).join('') + '</div>' +
      (shown.length ? '<ul class="list list--card fa-kit__list">' + shown.map(kitItemHtml).join('') + '</ul>'
        : '<div class="card fa-kit__empty">' + icon('check-circle') + '<span>' + esc(t(S.kitFilter === 'missing' ? 'fa.kit.none_missing' : 'fa.kit.all_done')) + '</span></div>') +
      '<div class="cluster fa-kit__actions">' +
      '<button type="button" class="btn btn--soft" data-fa="kit-copy"' + (st.done === st.total ? ' disabled' : '') + '>' + icon('copy') + '<span>' + esc(t('fa.kit.copy')) + '</span></button>' +
      '<button type="button" class="btn btn--ghost" data-fa="kit-clear"' + (st.done ? '' : ' disabled') + '>' + icon('rotate-ccw') + '<span>' + esc(t('fa.kit.clear')) + '</span></button></div>' +
      kitMetaHtml();
    panel.appendChild(NC.ui.disclaimer({ compact: true }));
    var bar = panel.querySelector('.fa-kit__bar');
    if (bar) bar.style.width = Math.round(st.pct * 100) + '%';
    if (focusId) {
      var again = panel.querySelector('[data-kit="' + focusId + '"], [data-kitf="' + focusId + '"]');
      if (again) try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); }
    }
    updateKitCount();
  }
  /** Kit tab: sources (with year), content version and review status like every other medical screen (PDF 8.1). */
  function kitMetaHtml() {
    var ids = Array.isArray(FA.kit_sources) && FA.kit_sources.length ? FA.kit_sources : null;
    var srcs = (ids ? ids.map(srcById) : (FA.sources || [])).filter(Boolean);
    return '<section class="card fa-meta fa-kit__src" aria-label="' + esc(t('fa.src.title')) + '">' +
      (srcs.length ? '<div class="fa-meta__src"><span class="fa-meta__label">' + icon('book-open') + esc(t('fa.kit.meta_by')) + ':</span> ' +
        srcs.map(function (s) { return '<span class="fa-meta__srcname">' + srcNameHtml(s) + '</span>'; }).join('<span class="fa-meta__sep" aria-hidden="true">·</span>') + '</div>' : '') +
      '<div class="fa-meta__row">' + versionBadge() + '<span class="fa-meta__upd">' + esc(t('fa.updated', { date: U.fmtDate(FA.updated) })) + '</span></div>' +
      '<div class="fa-meta__actions"><button type="button" class="btn btn--soft btn--sm" data-fa="sources">' + icon('info') + '<span>' + esc(t('fa.src.more')) + '</span></button></div></section>';
  }
  function kitItemHtml(k) {
    var on = !!S.kit[k.id];
    var id = 'fa-kit-' + k.id;
    return '<li class="fa-kit__row' + (on ? ' is-on' : '') + '"><label class="check fa-kit__item" for="' + esc(id) + '">' +
      '<input type="checkbox" id="' + esc(id) + '" data-kit="' + esc(k.id) + '"' + (on ? ' checked' : '') + '>' +
      '<span class="fa-kit__body"><span class="fa-kit__label">' + esc(tx(k.label)) + '</span>' +
      '<span class="fa-kit__meta"><span class="badge badge--neutral">' + esc(tx(k.qty)) + '</span>' +
      (k.essential ? '<span class="badge badge--accent">' + icon('star') + esc(t('fa.kit.essential')) + '</span>' : '<span class="badge badge--demo">' + esc(t('fa.kit.optional')) + '</span>') +
      '</span>' + (k.note ? '<span class="fa-kit__note">' + esc(tx(k.note)) + '</span>' : '') + '</span></label></li>';
  }
  function saveKit() {
    var st = kitStats();
    kvSet('fa.kit', S.kit);
    if (NC.bus) NC.bus.emit('fa:kit', st);
  }
  function copyMissing() {
    var miss = (FA.kit || []).filter(function (k) { return !S.kit[k.id]; });
    var txt = t('fa.kit.list_header') + '\n' + miss.map(function (k) { return '☐ ' + tx(k.label) + ' — ' + tx(k.qty); }).join('\n');
    U.copyText(txt).then(function (ok) { NC.ui.toast(ok ? t('fa.kit.copied') : t('common.error'), { type: ok ? 'success' : 'warning' }); });
  }

  /* ================================================================== */
  /* ITEM VIEW                                                            */
  /* ================================================================== */
  function renderItem() {
    var el = S.itemEl;
    var it = ITEMS[S.itemId];
    stopSpeech();
    if (!it) {
      el.innerHTML = '';
      var back = U.h('a', { class: 'btn btn--ghost btn--sm fa-back', href: '#/firstaid', html: icon('chevron-left') + '<span>' + esc(t('fa.back_lib')) + '</span>' });
      el.appendChild(back);
      el.appendChild(NC.ui.emptyState({ icon: 'search', variant: 'neutral', title: t('fa.notfound.title'), text: t('fa.notfound.text'), action: { label: t('fa.back_lib'), href: '#/firstaid' } }));
      el.appendChild(NC.ui.disclaimer({ compact: true }));
      return;
    }
    var cat = CATS[it.category] || {};
    var tone = toneOf(it);
    var srcs = (it.sources || []).map(srcById).filter(Boolean);
    var tool = it.special === 'cpr' ? '<button type="button" class="btn btn--accent btn--sm btn--pill" data-fa="jump-cpr">' + icon('activity') + '<span>' + esc(t('fa.cpr.jump')) + '</span></button>'
      : it.special === 'anaphylaxis' ? '<button type="button" class="btn btn--accent btn--sm btn--pill" data-fa="jump-ana">' + icon('timer') + '<span>' + esc(t('fa.ana.jump')) + '</span></button>' : '';

    var html =
      '<div class="fa-item__top">' +
      '<header class="card fa-head fa-tone--' + esc(tone) + '">' +
      '<a class="fa-back" href="#/firstaid">' + icon('chevron-left') + '<span>' + esc(t('fa.back_lib')) + '</span></a>' +
      '<div class="fa-head__row"><span class="icon-tile icon-tile--lg icon-tile--' + esc(tone) + ' fa-head__ic">' + icon(it.icon || cat.icon || 'cross') + '</span>' +
      '<div class="fa-head__heading"><span class="fa-head__cat">' + esc(tx(cat.label)) + '</span>' +
      '<h1 class="fa-head__title" id="fa-item-title" tabindex="-1"' + langAttr(it.title) + '>' + esc(tx(it.title)) + '</h1></div></div>' +
      '<div class="fa-head__badges"><span class="badge badge--' + PRIO_BADGE[it.priority] + '">' + icon(it.priority === 'critical' ? 'alert-triangle' : it.priority === 'urgent' ? 'alert-circle' : 'info') + esc(prioLabel(it.priority)) + '</span>' +
      '<span class="badge badge--neutral">' + icon('list-checks') + esc(t('fa.steps_n', { n: it.steps.length })) + '</span></div>' +
      '<p class="fa-head__sum"' + langAttr(it.summary) + '>' + esc(tx(it.summary)) + '</p>' +
      (tool ? '<div class="fa-head__tools">' + tool + '</div>' : '') +
      '</header>' +
      '<aside class="fa-callout" aria-labelledby="fa-callout-title">' +
      '<span class="fa-callout__ic" aria-hidden="true">' + icon('siren') + '</span>' +
      '<div class="fa-callout__body"><h2 class="fa-callout__title" id="fa-callout-title">' + esc(t('fa.call.title')) + '</h2>' +
      '<p class="fa-callout__text"' + langAttr(it.call115) + '>' + esc(tx(it.call115)) + '</p>' +
      '<a class="btn btn--danger btn--lg fa-callout__btn" href="tel:115" data-call="115">' + icon('phone') + '<span>' + esc(t('fa.call.btn')) + '</span></a>' +
      '<p class="fa-callout__roam">' + icon('signal') + '<span>' + esc(t('fa.call.roam')) + '</span></p></div></aside>' +
      '</div>' +
      '<div class="fa-cols"><div class="fa-main">' + stepsHtml(it) +
      (it.special === 'cpr' ? '<div id="fa-cpr-slot"></div>' : '') +
      (it.special === 'anaphylaxis' && it.timer ? '<div id="fa-ana-slot"></div>' : '') +
      '</div><div class="fa-side">' +
      listCard('fa-flags card--danger', 'alert-triangle', t('fa.flags.title'), txl(it.red_flags), 'alert-circle', listLang(it.red_flags)) +
      listCard('fa-donts', 'x-circle', t('fa.donts.title'), txl(it.donts), 'x', listLang(it.donts)) +
      relatedHtml(it) +
      '<section class="card fa-meta"><div class="fa-meta__src"><span class="fa-meta__label">' + icon('book-open') + esc(t('fa.src.by')) + ':</span> ' +
      srcs.map(function (s) { return '<span class="fa-meta__srcname">' + srcNameHtml(s) + '</span>'; }).join('<span class="fa-meta__sep" aria-hidden="true">·</span>') + '</div>' +
      '<div class="fa-meta__row">' + versionBadge() + '<span class="fa-meta__upd">' + esc(t('fa.updated', { date: U.fmtDate(it.updated || FA.updated) })) + '</span></div>' +
      '<p class="fa-meta__note">' + esc(t('fa.demo_content')) + '</p>' +
      '<div class="fa-meta__actions"><button type="button" class="btn btn--soft btn--sm" data-fa="sources">' + icon('info') + '<span>' + esc(t('fa.src.more')) + '</span></button></div></section>' +
      videoHtml(it) +
      '<div class="fa-disc-slot"></div>' +
      '</div></div>';
    el.innerHTML = html;
    var slot = el.querySelector('.fa-disc-slot');
    if (slot) slot.appendChild(NC.ui.disclaimer({ compact: true }));
    if (it.special === 'cpr') Metro.mountUI(document.getElementById('fa-cpr-slot'), it.metronome || {});
    if (it.special === 'anaphylaxis' && it.timer) renderAna(it);
    initCarousel(it);
  }

  function listCard(cls, ic, title, items, itemIc, lang) {
    if (!items || !items.length) return '';
    return '<section class="card ' + cls + '"><h2 class="fa-list__title">' + icon(ic) + '<span>' + esc(title) + '</span></h2>' +
      '<ul class="fa-list"' + (lang || '') + '>' + items.map(function (s) { return '<li>' + icon(itemIc, 'fa-list__ic') + '<span>' + esc(s) + '</span></li>'; }).join('') + '</ul></section>';
  }
  /** lang attribute for a {vi:[], en:[]} list that falls back to the other language. */
  function listLang(o) { if (!o || Array.isArray(o)) return ''; var l = o[L()]; return (l && l.length) ? '' : (o.vi && o.vi.length ? ' lang="vi"' : ' lang="en"'); }

  function relatedHtml(it) {
    var rel = (it.related || []).map(function (id) { return ITEMS[id]; }).filter(Boolean);
    if (!rel.length) return '';
    return '<section class="card fa-related"><h2 class="fa-list__title">' + icon('layers') + '<span>' + esc(t('fa.related')) + '</span></h2>' +
      '<div class="chip-group">' + rel.map(function (r) {
        return '<a class="chip chip--lg fa-tone--' + esc(toneOf(r)) + ' fa-related__chip" href="#/firstaid?item=' + encodeURIComponent(r.id) + '"><span class="fa-cat__ic" aria-hidden="true">' + icon(r.icon) + '</span><span' + langAttr(r.title) + '>' + esc(shortTitle(r)) + '</span></a>';
      }).join('') + '</div></section>';
  }

  /**
   * Video card (online only). A reviewed video (it.video = {url, review_status:'approved'}) is linked as such;
   * otherwise only a YouTube SEARCH is offered, labelled as external and not reviewed by NomadCare (FIX_CONTRACT B13).
   */
  function videoHtml(it) {
    var v = it.video && typeof it.video === 'object' ? it.video : null;
    var approved = !!(v && v.review_status === 'approved' && /^https:\/\//.test(String(v.url || '')));
    if (!approved && !it.video_query) return '';
    var on = online();
    var url = approved ? String(v.url) : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(it.video_query);
    var title = approved ? t('fa.video.label') : t('fa.video.ext_title');
    var note = approved ? t('fa.video.reviewed') : t('fa.video.ext_note');
    return '<a class="card fa-video' + (approved ? ' is-reviewed' : ' is-external') + (on ? ' card--interactive' : ' is-disabled') + '"' +
      (on ? ' href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' : ' aria-disabled="true" role="link"') + ' data-fa-video>' +
      '<span class="icon-tile ' + (on ? (approved ? 'icon-tile--danger' : 'icon-tile--neutral') : 'icon-tile--neutral') + '">' + icon(on ? (approved ? 'play' : 'search') : 'wifi-off') + '</span>' +
      '<span class="fa-video__body"><span class="fa-video__title">' + esc(title) + '<span class="fa-video__note"> — ' + esc(note) + '</span></span>' +
      (on ? '' : '<span class="fa-video__hint">' + esc(t('fa.video.hint_offline')) + '</span>') + '</span>' +
      (on ? icon('external-link', 'fa-video__go') : '') + '</a>';
  }
  function refreshVideo() {
    var old = S.itemEl && S.itemEl.querySelector('[data-fa-video]');
    var it = ITEMS[S.itemId];
    if (!old || !it) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = videoHtml(it);
    if (tmp.firstChild) old.parentNode.replaceChild(tmp.firstChild, old);
  }

  /* ---------- steps: carousel + list ---------- */
  function stepsHtml(it) {
    var n = it.steps.length;
    var tone = toneOf(it);
    var tts = ('speechSynthesis' in window) ? '<button type="button" class="btn btn--ghost btn--icon fa-steps__tts" data-fa="tts" aria-pressed="false" aria-label="' + esc(t('fa.steps.read')) + '" title="' + esc(t('fa.steps.read')) + '">' + icon('volume') + '</button>' : '';
    var slides = it.steps.map(function (s, i) {
      // div + role=group (a <li> may not take role=group, and an <ol> may only hold <li>): axe aria-allowed-role / list
      return '<div class="fa-car__slide" data-i="' + i + '" role="group" aria-roledescription="slide" aria-label="' + esc(t('fa.steps.label', { i: i + 1, n: n })) + '">' +
        '<div class="fa-car__ill fa-ill fa-tone--' + esc(tone) + '">' + s.ill + '<span class="fa-car__badge">' + esc(t('fa.steps.label', { i: i + 1, n: n })) + '</span></div>' +
        '<div class="fa-car__text"><p class="fa-car__step"' + langAttr(s.text) + '>' + esc(tx(s.text)) + '</p>' +
        (s.detail ? '<p class="fa-car__detail">' + icon('info') + '<span' + langAttr(s.detail) + '>' + esc(tx(s.detail)) + '</span></p>' : '') + '</div></div>';
    }).join('');
    var dots = it.steps.map(function (s, i) {
      return '<button type="button" class="fa-dot" data-dot="' + i + '" aria-label="' + esc(t('fa.steps.goto', { i: i + 1 })) + '"></button>';
    }).join('');
    var list = it.steps.map(function (s, i) {
      return '<li class="fa-steplist__item"><span class="fa-steplist__num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<div class="fa-steplist__body"><p class="fa-steplist__text"><span class="visually-hidden">' + esc(t('fa.steps.label', { i: i + 1, n: n })) + ': </span><span' + langAttr(s.text) + '>' + esc(tx(s.text)) + '</span></p>' +
        (s.detail ? '<p class="fa-car__detail">' + icon('info') + '<span' + langAttr(s.detail) + '>' + esc(tx(s.detail)) + '</span></p>' : '') + '</div>' +
        '<button type="button" class="fa-steplist__ill fa-ill fa-tone--' + esc(tone) + '" data-open-step="' + i + '" aria-label="' + esc(t('fa.steps.goto', { i: i + 1 })) + '">' + s.ill + '</button></li>';
    }).join('');
    var isList = S.stepsMode === 'list';
    return '<section class="card fa-steps' + (isList ? ' is-list' : '') + '" id="fa-steps" aria-labelledby="fa-steps-title">' +
      '<div class="fa-steps__head"><h2 class="fa-steps__title" id="fa-steps-title">' + icon('list-checks') + '<span>' + esc(t('fa.steps.title')) + '</span></h2>' + tts +
      '<div class="segmented fa-steps__mode" data-fa-mode aria-label="' + esc(t('fa.steps.mode_aria')) + '">' +
      '<button type="button" class="segmented__btn' + (isList ? '' : ' is-selected') + '" data-value="carousel">' + icon('image') + '<span>' + esc(t('fa.steps.one')) + '</span></button>' +
      '<button type="button" class="segmented__btn' + (isList ? ' is-selected' : '') + '" data-value="list">' + icon('list') + '<span>' + esc(t('fa.steps.all')) + '</span></button></div></div>' +
      '<div class="fa-car"' + (isList ? ' hidden' : '') + '>' +
      '<div class="fa-car__viewport" tabindex="0" role="region" aria-roledescription="carousel" aria-label="' + esc(t('fa.steps.carousel_aria')) + '">' +
      '<div class="fa-car__track">' + slides + '</div></div>' +
      '<div class="fa-car__nav">' +
      '<button type="button" class="btn btn--outline btn--lg btn--icon fa-car__prev" data-fa="prev" aria-label="' + esc(t('fa.steps.prev')) + '">' + icon('chevron-left') + '</button>' +
      '<div class="fa-dots">' + dots + '</div>' +
      '<button type="button" class="btn btn--primary btn--lg fa-car__next" data-fa="next"><span class="fa-car__nextlbl">' + esc(t('fa.steps.next_short')) + '</span>' + icon('chevron-right') + '</button></div>' +
      '<p class="fa-car__hint">' + icon('hand') + '<span>' + esc(t('fa.steps.hint')) + '</span></p>' +
      '<p class="visually-hidden fa-car__live" aria-live="polite"></p></div>' +
      '<ol class="fa-steplist"' + (isList ? '' : ' hidden') + '>' + list + '</ol></section>';
  }

  var car = null; // {vp, track, slides, n, drag}
  function initCarousel(it) {
    var root = S.itemEl.querySelector('.fa-car');
    if (!root) { car = null; return; }
    car = {
      root: root, vp: root.querySelector('.fa-car__viewport'), track: root.querySelector('.fa-car__track'),
      slides: $$('.fa-car__slide', root), n: it.steps.length, drag: null
    };
    S.step = U.clamp(S.step, 0, car.n - 1);
    goStep(S.step, { instant: true, silent: true });
    bindSwipe();
    if (window.ResizeObserver) {
      if (car.ro) car.ro.disconnect();
      var ro = new window.ResizeObserver(function () { syncHeight(); });
      car.slides.forEach(function (s) { ro.observe(s); });
      car.ro = ro;
    }
    var mode = S.itemEl.querySelector('[data-fa-mode]');
    if (mode) NC.ui.segmented(mode, { value: S.stepsMode, onChange: setStepsMode });
  }
  function setStepsMode(v) {
    S.stepsMode = v === 'list' ? 'list' : 'carousel';
    lsSet('nc.fa.steps', S.stepsMode);
    var sec = document.getElementById('fa-steps');
    if (!sec) return;
    sec.classList.toggle('is-list', S.stepsMode === 'list');
    var c = sec.querySelector('.fa-car'), l = sec.querySelector('.fa-steplist');
    if (c) c.hidden = S.stepsMode === 'list';
    if (l) l.hidden = S.stepsMode !== 'list';
    stopSpeech();
    if (S.stepsMode === 'carousel') goStep(S.step, { instant: true, silent: true });
  }
  function syncHeight() {
    if (!car || !car.vp || car.root.hidden) return;
    var s = car.slides[S.step];
    if (s) car.vp.style.height = s.offsetHeight + 'px';
  }
  function goStep(i, opts) {
    var o = opts || {};
    if (!car) return;
    var idx = U.clamp(i, 0, car.n - 1);
    var changed = idx !== S.step;
    S.step = idx;
    if (o.instant) car.track.classList.add('is-instant');
    car.track.style.transform = 'translate3d(' + (-idx * 100) + '%,0,0)';
    if (o.instant) { void car.track.offsetWidth; car.track.classList.remove('is-instant'); }
    car.slides.forEach(function (s, k) {
      var on = k === idx;
      s.classList.toggle('is-current', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    $$('.fa-dot', car.root).forEach(function (d, k) {
      d.classList.toggle('is-current', k === idx);
      d.classList.toggle('is-done', k < idx);
      if (k === idx) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
    });
    var prev = car.root.querySelector('.fa-car__prev');
    var next = car.root.querySelector('.fa-car__next');
    if (prev) prev.disabled = idx === 0;
    if (next) {
      var last = idx === car.n - 1;
      next.classList.toggle('btn--primary', !last);
      next.classList.toggle('btn--soft', last);
      next.setAttribute('aria-label', last ? t('fa.steps.restart') : t('fa.steps.next'));
      var lbl = next.querySelector('.fa-car__nextlbl');
      if (lbl) lbl.textContent = last ? t('fa.steps.restart') : t('fa.steps.next_short');
      var ic = next.querySelector('.icon use');
      if (ic) { ic.setAttribute('href', last ? '#i-rotate-ccw' : '#i-chevron-right'); ic.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', last ? '#i-rotate-ccw' : '#i-chevron-right'); }
    }
    syncHeight();
    if (!o.silent) {
      var live = car.root.querySelector('.fa-car__live');
      var it = ITEMS[S.itemId];
      if (live && it) live.textContent = t('fa.steps.label', { i: idx + 1, n: car.n }) + '. ' + tx(it.steps[idx].text);
    }
    if (changed) { stopSpeech(); U.vibrate(8); }
  }
  function bindSwipe() {
    var vp = car.vp;
    var d = null;
    function x(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
    function y(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
    function down(e) {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      d = { x0: x(e), y0: y(e), dx: 0, t0: Date.now(), active: false, id: e.pointerId };
    }
    function move(e) {
      if (!d) return;
      var dx = x(e) - d.x0, dy = y(e) - d.y0;
      if (!d.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { d = null; return; }
        if (Math.abs(dx) > 8) {
          d.active = true;
          car.track.classList.add('is-dragging');
          try { if (e.pointerId !== undefined && vp.setPointerCapture) vp.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
      }
      if (d.active) {
        var edge = (S.step === 0 && dx > 0) || (S.step === car.n - 1 && dx < 0);
        d.dx = edge ? dx * 0.35 : dx;
        car.track.style.transform = 'translate3d(calc(' + (-S.step * 100) + '% + ' + Math.round(d.dx) + 'px),0,0)';
        if (e.cancelable) e.preventDefault();
      }
    }
    function up() {
      if (!d) return;
      var g = d; d = null;
      car.track.classList.remove('is-dragging');
      if (!g.active) return;
      var v = g.dx / Math.max(1, Date.now() - g.t0);
      var w = vp.offsetWidth || 300;
      if (g.dx < -w * 0.18 || v < -0.45) goStep(S.step + 1);
      else if (g.dx > w * 0.18 || v > 0.45) goStep(S.step - 1);
      else goStep(S.step, { silent: true });
    }
    if (window.PointerEvent) {
      vp.addEventListener('pointerdown', down);
      vp.addEventListener('pointermove', move);
      vp.addEventListener('pointerup', up);
      vp.addEventListener('pointercancel', up);
    } else {
      vp.addEventListener('touchstart', down, { passive: true });
      vp.addEventListener('touchmove', move, { passive: false });
      vp.addEventListener('touchend', up);
    }
    vp.addEventListener('dragstart', function (e) { e.preventDefault(); });
    vp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); goStep(S.step + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goStep(S.step - 1); }
      else if (e.key === 'Home') { e.preventDefault(); goStep(0); }
      else if (e.key === 'End') { e.preventDefault(); goStep(car.n - 1); }
    });
  }
  /** Global ← → while an item is open (not while typing, in a control group or a dialog). */
  function onDocKey(e) {
    if (!S.active || S.view !== 'item' || !car || S.stepsMode !== 'carousel') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    var tg = e.target;
    if (tg && tg.closest && (tg.closest('input, textarea, select, [contenteditable="true"], .segmented, [role="radiogroup"], .fa-car__viewport'))) return;
    if (NC.ui.openCount && NC.ui.openCount() > 0) return;
    e.preventDefault();
    goStep(S.step + (e.key === 'ArrowRight' ? 1 : -1));
  }

  /* ---------- text-to-speech of the current step ---------- */
  var speaking = false;
  function speakStep() {
    var it = ITEMS[S.itemId];
    var btn = S.itemEl && S.itemEl.querySelector('[data-fa="tts"]');
    if (!it || !('speechSynthesis' in window)) return;
    if (speaking) { stopSpeech(); return; }
    var s = it.steps[S.step];
    var txt = tx(s.text) + (s.detail ? ' ' + tx(s.detail) : '');
    var lang = L() === 'en' ? 'en' : 'vi';
    var voices = [];
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var voice = voices.filter(function (v) { return String(v.lang || '').toLowerCase().indexOf(lang) === 0; })[0] || null;
    if (voices.length && !voice) { NC.ui.toast(t('fa.tts.none'), { type: 'info' }); return; }
    try {
      var u = new window.SpeechSynthesisUtterance(txt);
      u.lang = lang === 'en' ? 'en-US' : 'vi-VN';
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.onend = u.onerror = function () { speaking = false; setTtsBtn(false); };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      speaking = true;
      setTtsBtn(true);
    } catch (err) { speaking = false; setTtsBtn(false); }
    function setTtsBtn(on) {
      var b = btn || (S.itemEl && S.itemEl.querySelector('[data-fa="tts"]'));
      if (!b) return;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-label', t(on ? 'fa.steps.stop_read' : 'fa.steps.read'));
    }
  }
  function stopSpeech() {
    if (!speaking) return;
    speaking = false;
    try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    var b = S.itemEl && S.itemEl.querySelector('[data-fa="tts"]');
    if (b) { b.setAttribute('aria-pressed', 'false'); b.classList.remove('is-on'); b.setAttribute('aria-label', t('fa.steps.read')); }
  }

  /* ---------- sources sheet ---------- */
  function openSources() {
    var it = S.view === 'item' ? ITEMS[S.itemId] : null;
    var used = it ? (it.sources || []) : [];
    var rv = FA.review || {};
    var body = U.h('div', { class: 'fa-srcsheet' });
    body.innerHTML =
      '<p class="fa-srcsheet__lead">' + esc(t('fa.src.own_words')) + '</p>' +
      '<ul class="fa-srcsheet__list">' + FA.sources.map(function (s) {
        var on = used.indexOf(s.id) >= 0;
        var en = L() === 'en';
        var title = en ? (s.title_en || s.title) : (s.title_vi || s.title);
        // Official titles keep their own language: Vietnamese in the EN UI, English (IFRC, WHO…) in the VI UI.
        var titleLang = en ? (isVi(title) ? ' lang="vi"' : '') : (!isVi(title) && /[a-z]{3}/i.test(title) ? ' lang="en"' : '');
        return '<li class="fa-srcsheet__item' + (on ? ' is-used' : '') + '">' +
          '<div class="fa-srcsheet__top"><span class="fa-srcsheet__short">' + srcNameHtml(s) + '</span>' +
          (on ? '<span class="badge badge--primary">' + icon('check') + esc(t('fa.src.used_here')) + '</span>' : '') + '</div>' +
          '<p class="fa-srcsheet__title"><span' + titleLang + '>' + esc(title) + '</span>' + (s.year ? ' (' + esc(s.year) + ')' : ' — ' + esc(t('fa.src.year_unknown'))) + '</p>' +
          '<dl class="kv"><div class="kv__row"><dt>' + esc(t('fa.src.publisher')) + '</dt><dd' + langAttr(s.publisher) + '>' + esc(tx(s.publisher)) + '</dd></div>' +
          '<div class="kv__row"><dt>' + esc(t('fa.src.scope')) + '</dt><dd' + langAttr(s.scope) + '>' + esc(tx(s.scope)) + '</dd></div></dl>' +
          (s.note ? '<p class="fa-srcsheet__note"' + langAttr(s.note) + '>' + esc(tx(s.note)) + '</p>' : '') + '</li>';
      }).join('') + '</ul>' +
      '<div class="card card--flat fa-srcsheet__review"><p class="fa-srcsheet__rtitle">' + icon('shield-check') + '<span>' + esc(t('fa.src.review')) + '</span> ' + versionBadge() + '</p>' +
      '<dl class="kv"><div class="kv__row"><dt>' + esc(t('fa.src.round1')) + '</dt><dd>' + esc(rv.reviewer_round1 || '–') + '</dd></div>' +
      '<div class="kv__row"><dt>' + esc(t('fa.src.round2')) + '</dt><dd>' + esc(rv.approver || t('fa.src.pending')) + '</dd></div></dl>' +
      '<p class="fa-srcsheet__note">' + esc(L() === 'en' ? (rv.note_en || rv.note || '') : (rv.note || '')) + '</p></div>';
    NC.ui.sheet({ title: t('fa.src.sheet_title'), subtitle: t('fa.src.sheet_sub'), icon: 'book-open', body: body, size: 'md',
      actions: [{ label: t('common.close'), variant: 'primary' }] });
  }

  /* ================================================================== */
  /* CPR METRONOME — Web Audio look-ahead scheduler ("two clocks")        */
  /* Beats are placed at exact AudioContext times (t0 + n·60/bpm), so the */
  /* tempo never drifts; setTimeout only refills the next ~150 ms (1.6 s  */
  /* while the tab is hidden). Visuals read the same clock in rAF.        */
  /* ================================================================== */
  var Metro = (function () {
    var AC = window.AudioContext || window.webkitAudioContext || null;
    var BREATH_S = 2.5;        // one rescue breath slot (≈1 s inflation + exhale); 2 breaths ≈ 5 s pause
    var SWAP_S = 120;          // swap rescuers every 2 minutes
    var ctx = null, master = null, useCtx = false, timer = 0, raf = 0, wake = null;
    var P = { bpm: 110, min: 100, max: 120, mode: 'hands', sound: true, vib: true };
    var st = freshState();
    var ui = null;             // bound DOM of the current metronome card
    var warnedAudio = false;

    function freshState() {
      return {
        running: false, started: false, elapsedBase: 0, runStart: 0, nextTime: 0, nextKind: 'comp', total: 0, set: 0,
        breathIdx: 0, swapIdx: 1, queue: [], lastComp: 0, phase: 'idle', shownTotal: 0, shownSet: 0, shownBreath: 0,
        lastFired: null, swapUntil: 0, lastSec: -1
      };
    }
    function clock() {
      if (useCtx && ctx) return ctx.currentTime;
      return nowMs() / 1000;
    }
    function interval() { return 60 / P.bpm; }

    function ensureCtx() {
      if (!AC) return null;
      if (!ctx) {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; } }
        if (ctx && ctx.addEventListener) {
          ctx.addEventListener('statechange', function () {
            // e.g. iOS interruption (incoming call): keep the beat going on the performance clock.
            if (st.running && useCtx && ctx.state !== 'running') rebase(false);
          });
        }
      }
      return ctx;
    }
    /** Switch clock source mid-run without losing the rhythm. */
    function rebase(toCtx) {
      var oldNow = clock();
      var offsets = st.queue.map(function (ev) { return ev.time - oldNow; });
      var nextOff = st.nextTime - oldNow, lastOff = st.lastComp - oldNow, runOff = st.runStart - oldNow;
      useCtx = !!toCtx && !!ctx;
      var n = clock();
      st.queue.forEach(function (ev, i) { ev.time = n + offsets[i]; });
      st.nextTime = n + nextOff; st.lastComp = n + lastOff; st.runStart = n + runOff;
      if (!useCtx) dropAudio();
    }
    function newMaster() {
      if (!ctx) return;
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    function dropAudio() {
      if (master) { try { master.disconnect(); } catch (e) { /* ignore */ } }
      master = null;
    }
    function tone(time, freq, dur, vol, type) {
      if (!useCtx || !ctx || !master || !P.sound) return;
      try {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, time);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(vol, time + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        o.connect(g); g.connect(master);
        o.start(time); o.stop(time + dur + 0.02);
      } catch (e) { /* ignore */ }
    }
    function playEvent(ev) {
      if (ev.kind === 'comp') {
        var accent = P.mode === '302' ? ev.set === 1 : false;
        tone(ev.time, accent ? 1760 : 1320, 0.07, accent ? 0.7 : 0.55, 'sine');
        tone(ev.time, accent ? 3520 : 2640, 0.025, 0.12, 'triangle');
      } else if (ev.kind === 'breath') {
        tone(ev.time, 523.25, 0.55, 0.32, 'triangle');
        tone(ev.time + 0.12, 659.25, 0.5, 0.2, 'sine');
      } else if (ev.kind === 'swap') {
        tone(ev.time, 988, 0.14, 0.6, 'square');
        tone(ev.time + 0.2, 988, 0.14, 0.6, 'square');
        tone(ev.time + 0.4, 1318, 0.22, 0.6, 'square');
      }
    }
    /** Produce the next event on the timeline and advance the generator. */
    function makeEvent() {
      var ev;
      if (st.nextKind === 'comp') {
        st.total++; st.set++;
        ev = { kind: 'comp', time: st.nextTime, total: st.total, set: st.set };
        if (P.mode === '302' && st.set >= 30) { st.nextKind = 'breath'; st.breathIdx = 0; st.set = 0; }
        st.nextTime += interval();
      } else {
        st.breathIdx++;
        ev = { kind: 'breath', time: st.nextTime, idx: st.breathIdx, total: st.total };
        st.nextTime += BREATH_S;
        if (st.breathIdx >= 2) st.nextKind = 'comp';
      }
      return ev;
    }
    function scheduler() {
      if (!st.running) return;
      var hidden = document.hidden === true;
      var horizon = clock() + (hidden ? 1.6 : 0.15);
      var guard = 0;
      while (st.nextTime < horizon && guard++ < 400) {
        var ev = makeEvent();
        st.queue.push(ev);
        playEvent(ev);
      }
      var swapAt = st.runStart + st.swapIdx * SWAP_S - st.elapsedBase;
      if (swapAt < horizon) {
        var sw = { kind: 'swap', time: swapAt, n: st.swapIdx };
        st.swapIdx++;
        st.queue.push(sw);
        st.queue.sort(function (a, b) { return a.time - b.time; });
        playEvent(sw);
      }
      timer = setTimeout(scheduler, hidden ? 250 : 25);
    }
    function fire(ev, tNow) {
      var fresh = tNow - ev.time < 0.12;
      st.lastFired = ev;
      if (ev.kind === 'comp') {
        st.phase = 'comp'; st.lastComp = ev.time; st.shownTotal = ev.total; st.shownSet = ev.set;
        if (fresh && P.vib) U.vibrate(ev.set === 1 && P.mode === '302' ? 45 : 28);
      } else if (ev.kind === 'breath') {
        st.phase = 'breath'; st.shownBreath = ev.idx; st.shownSet = 30;
        if (fresh && P.vib) U.vibrate(90);
      } else if (ev.kind === 'swap') {
        st.swapUntil = ev.time + 8;
        if (fresh && P.vib) U.vibrate([220, 120, 220, 120, 400]);
      }
      if (ui) ui.onFire(ev);
    }
    function frame() {
      if (!st.running) { raf = 0; return; }
      var n = clock();
      while (st.queue.length && st.queue[0].time <= n) fire(st.queue.shift(), n);
      if (ui) ui.onFrame(n);
      raf = requestAnimationFrame(frame);
    }
    function elapsed(n) { return st.running ? st.elapsedBase + ((n === undefined ? clock() : n) - st.runStart) : st.elapsedBase; }
    /** Roll the generator back to what was actually heard/seen (unplayed events are discarded). */
    function rollback() {
      var ev = st.lastFired;
      st.queue = [];
      if (!ev || ev.kind === 'swap') {
        // find the last beat state from the shown counters
        st.total = st.shownTotal; st.set = st.phase === 'breath' ? 0 : st.shownSet;
        st.nextKind = st.phase === 'breath' && st.shownBreath < 2 ? 'breath' : 'comp';
        st.breathIdx = st.shownBreath;
      } else if (ev.kind === 'comp') {
        st.total = ev.total; st.set = ev.set; st.nextKind = 'comp';
        if (P.mode === '302' && ev.set >= 30) { st.nextKind = 'breath'; st.breathIdx = 0; st.set = 0; }
      } else {
        st.total = ev.total; st.set = 0; st.breathIdx = ev.idx; st.nextKind = ev.idx >= 2 ? 'comp' : 'breath';
      }
      if (P.mode !== '302') { st.nextKind = 'comp'; if (st.set >= 30) st.set = 0; }
      st.swapIdx = Math.floor(st.elapsedBase / SWAP_S) + 1;
    }
    function begin(withCtx) {
      if (st.running) return;
      useCtx = !!withCtx && !!ctx && ctx.state === 'running';
      if (useCtx) newMaster();
      else if (!warnedAudio && P.sound) { warnedAudio = true; NC.ui.toast(t('fa.cpr.no_audio'), { type: 'info', timeout: 4500 }); }
      var n = clock();
      st.running = true; st.started = true;
      st.runStart = n;
      st.nextTime = n + 0.12;
      if (st.phase === 'comp' && st.lastFired && st.lastFired.kind === 'comp') st.nextTime = n + 0.12;
      scheduler();
      if (!raf) raf = requestAnimationFrame(frame);
      requestWake();
      if (ui) ui.onState();
    }
    /** Start / resume. Must be called from a user gesture (unlocks audio on iOS/Chrome). */
    function start() {
      if (st.running) return;
      var c = ensureCtx();
      if (!c || !P.sound) { begin(!!c && c.state === 'running'); return; }
      var done = false;
      var go = function (ok) { if (done) return; done = true; begin(ok && c.state === 'running'); };
      try {
        // Tiny silent buffer inside the gesture = reliable unlock on older iOS.
        var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
      } catch (e) { /* ignore */ }
      if (c.state === 'running') { go(true); return; }
      var p = null;
      try { p = c.resume(); } catch (e) { p = null; }
      if (p && typeof p.then === 'function') p.then(function () { go(true); }, function () { go(false); });
      else go(c.state === 'running');
      setTimeout(function () { go(c.state === 'running'); }, 450);
    }
    function pause() {
      if (!st.running) return;
      var n = clock();
      st.elapsedBase += n - st.runStart;
      st.running = false;
      clearTimeout(timer); timer = 0;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      // fire what is due so counters are exact, then drop the future
      while (st.queue.length && st.queue[0].time <= n) fire(st.queue.shift(), n + 1);
      dropAudio();
      rollback();
      st.phase = st.started ? 'paused' : 'idle';
      releaseWake();
      if (ctx && ctx.state === 'running' && ctx.suspend) { try { ctx.suspend(); } catch (e) { /* ignore */ } }
      if (ui) { ui.onState(); ui.onFrame(n); }
    }
    function reset() {
      var was = st.running;
      if (was) pause();
      st = freshState();
      if (ui) { ui.onState(); ui.onFrame(clock()); }
    }
    /** Apply a setting that changes the timeline (bpm/mode) without losing the count. */
    function retime(fn) {
      var was = st.running;
      if (was) {
        var n = clock();
        st.elapsedBase += n - st.runStart;
        st.running = false;
        clearTimeout(timer);
        while (st.queue.length && st.queue[0].time <= n) fire(st.queue.shift(), n + 1);
        dropAudio();
        fn();
        rollback();
        st.running = true;
        st.runStart = n;
        st.nextTime = st.phase === 'comp' && st.lastComp ? Math.max(n + 0.05, st.lastComp + interval()) : n + 0.12;
        if (useCtx) newMaster();
        scheduler();
      } else {
        fn();
        if (st.started) rollback();
      }
      savePrefs();
      if (ui) ui.onState();
    }
    function setBpm(v) { retime(function () { P.bpm = U.clamp(Math.round(v), P.min, P.max); }); }
    function setMode(m) {
      retime(function () {
        var next = m === '302' ? '302' : 'hands';
        // Entering 30:2 starts a fresh set of 30 (the count so far was continuous compressions).
        if (next === '302' && P.mode !== '302' && st.lastFired && st.lastFired.kind === 'comp') { st.lastFired.set = 0; st.shownSet = 0; }
        P.mode = next;
      });
    }
    function setSound(on) { P.sound = !!on; if (!on) dropAudio(); else if (st.running && useCtx && !master) newMaster(); savePrefs(); if (ui) ui.onState(); }
    function setVib(on) { P.vib = !!on; savePrefs(); if (ui) ui.onState(); }

    function requestWake() {
      try {
        if (navigator.wakeLock && navigator.wakeLock.request && !wake) {
          navigator.wakeLock.request('screen').then(function (s) {
            wake = s;
            if (s && s.addEventListener) s.addEventListener('release', function () { wake = null; });
          }, function () { wake = null; });
        }
      } catch (e) { wake = null; }
    }
    function releaseWake() { if (wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; } }
    document.addEventListener('visibilitychange', function () {
      if (!st.running) return;
      if (!document.hidden) {
        requestWake();
        if (ctx && ctx.state === 'running' && !useCtx) rebase(true);
        clearTimeout(timer); scheduler();
      }
    });

    function savePrefs() { kvSet('fa.cpr', { bpm: P.bpm, mode: P.mode, sound: P.sound, vib: P.vib }); }
    function loadPrefs(meta) {
      if (meta) { P.min = meta.min || 100; P.max = meta.max || 120; if (!st.started) P.bpm = meta.bpm || P.bpm; }
      return kvGet('fa.cpr').then(function (p) {
        if (!p || st.started) return;
        if (p.bpm) P.bpm = U.clamp(p.bpm, P.min, P.max);
        if (p.mode) P.mode = p.mode === '302' ? '302' : 'hands';
        if (p.sound !== undefined) P.sound = !!p.sound;
        if (p.vib !== undefined) P.vib = !!p.vib;
        if (ui) ui.onState();
      });
    }

    /* ---------------- UI ---------------- */
    function stageSvg() {
      // Same flat style/palette as the content illustrations (ill-* classes, viewBox 240×140).
      return '<svg class="fa-cpr__svg" viewBox="0 0 240 140" aria-hidden="true" focusable="false" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect class="ill-muted" x="16" y="113" width="208" height="5" rx="2.5" opacity=".5"/>' +
        '<g class="fa-cpr__helper"><rect class="ill-cloth-2" x="68" y="34" width="28" height="64" rx="13"/><circle class="ill-skin-2" cx="82" cy="24" r="10"/></g>' +
        '<rect class="ill-muted" x="112" y="89" width="66" height="20" rx="10"/><rect class="ill-skin" x="173" y="79" width="9" height="18" rx="4.5"/>' +
        '<g class="fa-cpr__chest"><rect class="ill-cloth" x="58" y="87" width="60" height="24" rx="12"/></g>' +
        '<circle class="ill-skin" cx="48" cy="99" r="11"/>' +
        '<g class="fa-cpr__arms"><polygon class="ill-skin-2" points="69,39 77,39 80,78 87,39 95,39 85,85 75,85"/><ellipse class="ill-skin-2" cx="80" cy="85" rx="9" ry="4.5"/></g>' +
        '<circle class="fa-cpr__pulse" cx="80" cy="88" r="12" fill="none" stroke-width="3"/>' +
        '<g class="fa-cpr__breath"><path class="ill-line" fill="none" stroke-width="3" d="M30 80q-6-6 0-12M22 84q-10-10 0-20"/></g>' +
        '<path class="ill-line fa-cpr__ecg" fill="none" stroke-width="3" d="M150 40h12l5-12 7 24 5-12h12"/>' +
        '<g class="fa-cpr__heart"><path class="ill-danger" d="M214 49C201 40 205 30 214 36C223 30 227 40 214 49Z"/></g>' +
        '</svg>';
    }
    function mountUI(slot, meta) {
      if (!slot) return;
      loadPrefs(meta);
      var html =
        '<section class="card fa-cpr" id="fa-cpr" aria-labelledby="fa-cpr-title">' +
        '<header class="fa-cpr__head"><span class="icon-tile icon-tile--danger">' + icon('heart-pulse') + '</span>' +
        '<div class="fa-cpr__heading"><h2 class="fa-cpr__title" id="fa-cpr-title">' + esc(t('fa.cpr.title')) + '</h2>' +
        '<p class="fa-cpr__sub">' + esc(t('fa.cpr.sub')) + '</p></div>' +
        '<div class="fa-cpr__toggles">' +
        '<button type="button" class="btn btn--ghost btn--icon fa-cpr__tog" data-cpr="sound" aria-label="' + esc(t('fa.cpr.sound')) + '" title="' + esc(t('fa.cpr.sound')) + '">' + icon('volume') + '</button>' +
        '<button type="button" class="btn btn--ghost btn--icon fa-cpr__tog" data-cpr="vib" aria-label="' + esc(t('fa.cpr.vibrate')) + '" title="' + esc(t('fa.cpr.vibrate')) + '">' + icon('smartphone') + '</button>' +
        '</div></header>' +
        '<div class="fa-cpr__grid">' +
        // Start button right under the animation (DOM order = visual order): reachable on phones without scrolling
        // past the counters, also from the #/firstaid?item=cpr&tool=cpr deep link.
        '<div class="fa-cpr__main">' +
        '<div class="fa-cpr__stage fa-ill fa-tone--danger" role="img" aria-label="' + esc(t('fa.cpr.stage_aria')) + '">' + stageSvg() +
        '<span class="fa-cpr__phase" data-phase="idle">' + esc(t('fa.cpr.ready')) + '</span>' +
        '<span class="fa-cpr__bpmtag"><b class="fa-cpr__bpmv">' + P.bpm + '</b>/' + esc(L() === 'en' ? 'min' : 'phút') + '</span></div>' +
        '<div class="fa-cpr__swapbanner" role="alert" hidden>' + icon('users') + '<div><b>' + esc(t('fa.cpr.swap_now')) + '</b><span>' + esc(t('fa.cpr.swap_hint')) + '</span></div></div>' +
        '<div class="fa-cpr__controls">' +
        '<button type="button" class="btn btn--xl btn--accent fa-cpr__go" data-cpr="toggle">' + icon('play') + '<span class="fa-cpr__golbl">' + esc(t('fa.cpr.start')) + '</span></button>' +
        '<button type="button" class="btn btn--lg btn--outline fa-cpr__reset" data-cpr="reset" title="' + esc(t('fa.cpr.reset')) + '">' + icon('rotate-ccw') + '<span>' + esc(t('fa.cpr.reset')) + '</span></button></div>' +
        '</div>' +
        '<div class="fa-cpr__panel">' +
        '<div class="fa-cpr__stats">' +
        '<div class="fa-cpr__stat fa-cpr__stat--count"><b class="fa-cpr__count" aria-live="off">0</b><span>' + esc(t('fa.cpr.count')) + '</span></div>' +
        '<div class="fa-cpr__stat fa-cpr__stat--set"><b class="fa-cpr__set">0/30</b><span>' + esc(t('fa.cpr.set')) + '</span></div>' +
        '<div class="fa-cpr__stat fa-cpr__stat--ring">' + ringHtml(0, 'fa-cpr__ring ring--accent', '<b class="fa-cpr__swap">2:00</b><small>' + esc(t('fa.cpr.swap_in')) + '</small>') + '</div>' +
        '</div>' +
        '<div class="segmented fa-cpr__mode" data-cpr-mode aria-label="' + esc(t('fa.cpr.mode_aria')) + '">' +
        '<button type="button" class="segmented__btn" data-value="hands">' + icon('hand') + '<span>' + esc(t('fa.cpr.mode_hands')) + '</span></button>' +
        '<button type="button" class="segmented__btn" data-value="302">' + icon('wind') + '<span>' + esc(t('fa.cpr.mode_302')) + '</span></button></div>' +
        '<p class="fa-cpr__modehint"></p>' +
        '<div class="fa-cpr__bpm" role="group" aria-label="' + esc(t('fa.cpr.bpm_aria')) + '">' +
        '<button type="button" class="btn btn--outline btn--icon" data-cpr="slower" aria-label="' + esc(t('fa.cpr.slower')) + '">' + icon('minus') + '</button>' +
        '<output class="fa-cpr__bpmout" aria-live="polite"><b class="fa-cpr__bpmv">' + P.bpm + '</b><span>' + esc(t('fa.cpr.bpm')) + '</span></output>' +
        '<button type="button" class="btn btn--outline btn--icon" data-cpr="faster" aria-label="' + esc(t('fa.cpr.faster')) + '">' + icon('plus') + '</button></div>' +
        '</div></div>' +
        '<p class="fa-cpr__foot"><span class="fa-cpr__elapsed">' + esc(t('fa.cpr.elapsed', { t: '00:00', c: 1 })) + '</span>' +
        '<span class="fa-cpr__ios">' + icon('info') + esc(t('fa.cpr.ios_hint')) + '</span></p>' +
        '</section>';
      slot.innerHTML = html;
      var root = slot.querySelector('.fa-cpr');
      var q = function (s) { return root.querySelector(s); };
      var els = {
        root: root, helper: q('.fa-cpr__helper'), arms: q('.fa-cpr__arms'), chest: q('.fa-cpr__chest'), pulse: q('.fa-cpr__pulse'),
        heart: q('.fa-cpr__heart'), breath: q('.fa-cpr__breath'), phase: q('.fa-cpr__phase'), count: q('.fa-cpr__count'), set: q('.fa-cpr__set'),
        setStat: q('.fa-cpr__stat--set'), ring: q('.fa-cpr__ring'), swap: q('.fa-cpr__swap'), go: q('.fa-cpr__go'), golbl: q('.fa-cpr__golbl'),
        reset: q('.fa-cpr__reset'), banner: q('.fa-cpr__swapbanner'), elapsed: q('.fa-cpr__elapsed'), hint: q('.fa-cpr__modehint'),
        bpmv: $$('.fa-cpr__bpmv', root), sound: q('[data-cpr="sound"]'), vib: q('[data-cpr="vib"]'),
        slower: q('[data-cpr="slower"]'), faster: q('[data-cpr="faster"]'), mode: q('[data-cpr-mode]')
      };
      var seg = NC.ui.segmented(els.mode, { value: P.mode, onChange: function (v) { setMode(v); } });
      var rm = reducedMotion();
      var hasVib = !!navigator.vibrate;
      if (!hasVib) els.vib.hidden = true;

      function setPhase(kind, text) {
        els.phase.setAttribute('data-phase', kind);
        els.phase.textContent = text;
      }
      ui = {
        el: root,
        onState: function () {
          if (!document.body.contains(root)) return;
          seg.set(P.mode);
          root.classList.toggle('is-running', st.running);
          root.classList.toggle('is-302', P.mode === '302');
          els.setStat.hidden = P.mode !== '302';
          els.hint.textContent = t(P.mode === '302' ? 'fa.cpr.hint_302' : 'fa.cpr.hint_hands');
          els.bpmv.forEach(function (b) { b.textContent = P.bpm; });
          els.slower.disabled = P.bpm <= P.min;
          els.faster.disabled = P.bpm >= P.max;
          els.sound.setAttribute('aria-pressed', P.sound ? 'true' : 'false');
          els.sound.innerHTML = icon(P.sound ? 'volume' : 'volume-off');
          els.vib.setAttribute('aria-pressed', P.vib ? 'true' : 'false');
          els.go.innerHTML = icon(st.running ? 'pause' : 'play') + '<span class="fa-cpr__golbl">' + esc(t(st.running ? 'fa.cpr.pause' : st.started ? 'fa.cpr.resume' : 'fa.cpr.start')) + '</span>';
          els.go.classList.toggle('btn--accent', !st.running);
          els.go.classList.toggle('btn--outline', st.running);
          els.go.setAttribute('aria-pressed', st.running ? 'true' : 'false');
          els.reset.disabled = st.running || !st.started;
          if (!st.running) setPhase(st.started ? 'paused' : 'idle', t(st.started ? 'fa.cpr.paused' : 'fa.cpr.ready'));
          els.count.textContent = st.shownTotal;
          els.set.textContent = (st.phase === 'breath' ? 30 : st.shownSet) + '/30';
        },
        onFire: function (ev) {
          if (!document.body.contains(root)) return;
          if (ev.kind === 'comp') {
            els.count.textContent = ev.total;
            els.set.textContent = ev.set + '/30';
            setPhase('push', t('fa.cpr.push'));
          } else if (ev.kind === 'breath') {
            setPhase('breath', t('fa.cpr.breath', { i: ev.idx }));
            els.set.textContent = '30/30';
          } else if (ev.kind === 'swap') {
            els.banner.hidden = false;
          }
        },
        onFrame: function (n) {
          if (!document.body.contains(root)) return;
          var iv = interval();
          var d = 0, p = 1;
          if (st.running && st.phase === 'comp' && st.lastComp) {
            p = (n - st.lastComp) / iv;
            if (p >= 0 && p < 1) d = p < 0.32 ? 1 - Math.pow(1 - p / 0.32, 2) : 1 - ((p - 0.32) / 0.68) * ((p - 0.32) / 0.68) * (3 - 2 * ((p - 0.32) / 0.68));
            d = Math.max(0, Math.min(1, d));
          }
          if (rm) d = 0;
          els.helper.setAttribute('transform', 'translate(0 ' + (d * 6).toFixed(2) + ')');
          els.arms.setAttribute('transform', 'translate(0 ' + (d * 6).toFixed(2) + ')');
          var sc = 1 - 0.22 * d;
          els.chest.setAttribute('transform', 'matrix(1 0 0 ' + sc.toFixed(3) + ' 0 ' + (111 * (1 - sc)).toFixed(2) + ')');
          var hs = 1 + 0.16 * d;
          els.heart.setAttribute('transform', 'translate(214 40) scale(' + hs.toFixed(3) + ') translate(-214 -40)');
          var pp = st.running && st.phase === 'comp' ? Math.max(0, Math.min(1, p / 0.7)) : 1;
          els.pulse.setAttribute('r', (rm ? 16 : 12 + 24 * pp).toFixed(1));
          els.pulse.setAttribute('opacity', (st.running && st.phase === 'comp' ? (1 - pp) * 0.85 : 0).toFixed(2));
          els.breath.setAttribute('opacity', st.running && st.phase === 'breath' ? '1' : '0');
          // swap ring + elapsed (text only when the second changes)
          var el = elapsed(n);
          var sec = Math.floor(el);
          var cyc = el % SWAP_S;
          setRing(els.ring, cyc / SWAP_S);
          if (sec !== st.lastSec) {
            st.lastSec = sec;
            els.swap.textContent = mmss(SWAP_S - cyc);
            els.elapsed.textContent = t('fa.cpr.elapsed', { t: mmss(el), c: Math.floor(el / SWAP_S) + 1 });
          }
          if (!els.banner.hidden && n > st.swapUntil) els.banner.hidden = true;
          root.classList.toggle('is-swap', !els.banner.hidden);
        }
      };
      root.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-cpr]') : null;
        if (!b || b.disabled) return;
        var a = b.getAttribute('data-cpr');
        if (a === 'toggle') { if (st.running) pause(); else start(); }
        else if (a === 'reset') reset();
        else if (a === 'slower') setBpm(P.bpm - 5);
        else if (a === 'faster') setBpm(P.bpm + 5);
        else if (a === 'sound') setSound(!P.sound);
        else if (a === 'vib') { setVib(!P.vib); if (P.vib) U.vibrate(30); }
      });
      st.lastSec = -1;
      ui.onState();
      ui.onFrame(clock());
    }

    return {
      mountUI: mountUI, start: start, pause: pause, reset: reset, setBpm: setBpm, setMode: setMode,
      isRunning: function () { return st.running; },
      stats: function () { return { running: st.running, total: st.shownTotal, set: st.shownSet, phase: st.phase, bpm: P.bpm, mode: P.mode, elapsed: elapsed(), clock: useCtx ? 'audio' : 'performance' }; },
      /** Debug/test: scheduled beat times (s) currently queued. */
      _queue: function () { return st.queue.map(function (e) { return { kind: e.kind, time: e.time }; }); },
      unbind: function () { ui = null; }
    };
  })();

  /* ================================================================== */
  /* ANAPHYLAXIS TIMER (kv 'fa.ana' = {injected_at, second_at})           */
  /* ================================================================== */
  var anaTick = 0, anaAlarm = 0;
  function anaMinutes() { var it = ITEMS.anaphylaxis; return (it && it.timer && it.timer.minutes) || 5; }
  function anaLast() { return S.ana ? (S.ana.second_at || S.ana.injected_at) : null; }
  function anaStep(it, re, fallback) {
    for (var i = 0; i < it.steps.length; i++) if (re.test(it.steps[i].text.en)) return it.steps[i];
    return it.steps[fallback] || null;
  }
  function renderAna(it) {
    var slot = document.getElementById('fa-ana-slot');
    if (!slot) return;
    var mins = anaMinutes();
    var second = anaStep(it, /second dose/i, 3);
    var inj = anaStep(it, /auto-injector/i, 1);
    var started = !!(S.ana && S.ana.injected_at);
    var html = '<section class="card fa-ana" id="fa-ana" aria-labelledby="fa-ana-title">' +
      '<header class="fa-cpr__head"><span class="icon-tile icon-tile--warning">' + icon('timer') + '</span>' +
      '<div class="fa-cpr__heading"><h2 class="fa-cpr__title" id="fa-ana-title">' + esc(t('fa.ana.title')) + '</h2>' +
      '<p class="fa-cpr__sub">' + esc(tx(it.timer.label)) + '</p></div></header>';
    if (!started) {
      html += '<div class="fa-ana__idle"><p class="fa-ana__lead">' + esc(t('fa.ana.idle_note')) + '</p>' +
        (inj && inj.detail ? '<p class="fa-car__detail">' + icon('info') + '<span>' + esc(tx(inj.detail)) + '</span></p>' : '') +
        '<button type="button" class="btn btn--xl btn--accent btn--block fa-ana__start" data-ana="start">' + icon('timer') + '<span>' + esc(t('fa.ana.start')) + '</span></button></div>';
    } else {
      html += '<div class="fa-ana__run">' +
        ringHtml(0, 'fa-ana__ring ring--accent', '<b class="fa-ana__clock">00:00</b><small>' + esc(t('fa.ana.since')) + '</small>') +
        '<div class="fa-ana__info"><dl class="kv fa-ana__kv"><div class="kv__row"><dt>' + esc(t('fa.ana.injected_at')) + '</dt><dd>' + esc(U.fmtTime(S.ana.injected_at)) + '</dd></div>' +
        (S.ana.second_at ? '<div class="kv__row"><dt>' + esc(t('fa.ana.second_at')) + '</dt><dd>' + esc(U.fmtTime(S.ana.second_at)) + '</dd></div>' : '') + '</dl>' +
        '<p class="fa-ana__status"></p>' +
        '<p class="fa-ana__note">' + icon('file-text') + '<span>' + esc(t('fa.ana.note')) + '</span></p></div></div>' +
        '<div class="fa-ana__due" hidden>' + icon('alert-triangle') + '<div><b>' + esc(t('fa.ana.due')) + '</b><span>' + esc(second ? tx(second.text) : '') + '</span></div></div>' +
        '<div class="fa-cpr__controls">' +
        (S.ana.second_at ? '' : '<button type="button" class="btn btn--lg btn--outline fa-ana__second" data-ana="second">' + icon('check') + '<span>' + esc(t('fa.ana.second')) + '</span></button>') +
        '<button type="button" class="btn btn--lg btn--outline" data-ana="reset">' + icon('rotate-ccw') + '<span>' + esc(t('fa.ana.reset')) + '</span></button></div>';
    }
    html += '</section>';
    slot.innerHTML = html;
    clearInterval(anaTick); anaTick = 0;
    if (started) { updateAna(); anaTick = setInterval(updateAna, 500); }
  }
  function updateAna() {
    var root = document.getElementById('fa-ana');
    if (!root || !S.ana || !S.ana.injected_at) { clearInterval(anaTick); anaTick = 0; return; }
    var mins = anaMinutes();
    var last = U.toDate(anaLast());
    var el = (Date.now() - last.getTime()) / 1000;
    var due = !S.ana.second_at && el >= mins * 60;
    var clk = root.querySelector('.fa-ana__clock');
    if (clk) clk.textContent = mmss(el);
    setRing(root.querySelector('.fa-ana__ring'), Math.min(1, el / (mins * 60)));
    var ring = root.querySelector('.fa-ana__ring');
    if (ring) { ring.classList.toggle('ring--danger', due); ring.classList.toggle('ring--accent', !due); }
    var box = root.querySelector('.fa-ana__due');
    if (box) box.hidden = !due;
    root.classList.toggle('is-due', due);
    // The second-dose button only becomes the primary action once the 5-minute mark has passed.
    var sec2 = root.querySelector('.fa-ana__second');
    if (sec2) { sec2.classList.toggle('btn--accent', due); sec2.classList.toggle('btn--outline', !due); }
    var stEl = root.querySelector('.fa-ana__status');
    if (stEl) {
      var txt = S.ana.second_at ? t('fa.ana.after_second') : due ? t('fa.ana.due')
        : t('fa.ana.wait', { t: U.fmtTime(new Date(last.getTime() + mins * 60000)) });
      if (stEl.textContent !== txt) stEl.textContent = txt;
    }
  }
  function armAnaAlarm() {
    clearTimeout(anaAlarm); anaAlarm = 0;
    if (!S.ana || !S.ana.injected_at || S.ana.second_at) return;
    var due = U.toDate(S.ana.injected_at).getTime() + anaMinutes() * 60000;
    var ms = due - Date.now();
    if (ms > 0 && ms < 6 * 3600000) anaAlarm = setTimeout(onAnaDue, ms);
  }
  function onAnaDue() {
    anaAlarm = 0;
    U.vibrate([300, 150, 300, 150, 300]);
    beep();
    var here = S.active && S.view === 'item' && S.itemId === 'anaphylaxis';
    NC.ui.toast(t('fa.ana.due_toast'), {
      type: 'danger', timeout: here ? 8000 : 0,
      action: here ? null : { label: t('common.open'), onClick: function () { NC.app.go('firstaid', { item: 'anaphylaxis', tool: 'timer' }); } }
    });
  }
  var beepCtx = null;
  function beep() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!beepCtx) beepCtx = new AC();
      if (beepCtx.state !== 'running' && beepCtx.resume) beepCtx.resume();
      var tt = beepCtx.currentTime + 0.05;
      [0, 0.25, 0.5].forEach(function (off) {
        var o = beepCtx.createOscillator(), g = beepCtx.createGain();
        o.frequency.value = 880; o.type = 'square';
        g.gain.setValueAtTime(0.0001, tt + off);
        g.gain.exponentialRampToValueAtTime(0.35, tt + off + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + off + 0.18);
        o.connect(g); g.connect(beepCtx.destination);
        o.start(tt + off); o.stop(tt + off + 0.2);
      });
    } catch (e) { /* ignore */ }
  }
  function onAnaAction(a) {
    var it = ITEMS.anaphylaxis;
    if (a === 'start') {
      S.ana = { injected_at: new Date().toISOString(), second_at: null };
      kvSet('fa.ana', S.ana); armAnaAlarm(); U.vibrate(40); renderAna(it);
      if (!beepCtx) { try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) beepCtx = new AC(); } catch (e) { beepCtx = null; } }
    } else if (a === 'second') {
      S.ana.second_at = new Date().toISOString();
      kvSet('fa.ana', S.ana); armAnaAlarm(); U.vibrate(40); renderAna(it);
    } else if (a === 'reset') {
      NC.ui.confirm({ title: t('fa.ana.title'), message: t('fa.ana.reset_q'), confirmLabel: t('fa.ana.reset'), danger: true }).then(function (ok) {
        if (!ok) return;
        S.ana = null; kvSet('fa.ana', null); armAnaAlarm(); renderAna(it);
      });
    }
  }

  /* ================================================================== */
  /* routing / lifecycle                                                  */
  /* ================================================================== */
  function showView(params) {
    var p = params || {};
    var wasView = S.view, wasItem = S.itemId;
    if (p.item) {
      if (wasView === 'lib' && S.active) S.libScroll = window.pageYOffset || 0;
      var sameItem = wasView === 'item' && wasItem === p.item;
      S.view = 'item';
      if (!sameItem) {
        if (Metro.isRunning() && wasItem !== p.item) Metro.pause();
        S.itemId = p.item;
        S.step = p.step ? Math.max(0, (parseInt(p.step, 10) || 1) - 1) : 0;
      } else if (p.step) {
        S.step = Math.max(0, (parseInt(p.step, 10) || 1) - 1);
      }
      S.lib.hidden = true;
      S.itemEl.hidden = false;
      renderItem();
      var it = ITEMS[S.itemId];
      if (it) NC.app.setTitle(isPhone() ? shortTitle(it) : tx(it.title));
      if (!sameItem) {
        window.scrollTo(0, 0);
        var h1 = document.getElementById('fa-item-title');
        if (h1) try { h1.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      if (p.tool) setTimeout(function () { jumpTool(p.tool); }, 60);
    } else {
      if (Metro.isRunning()) Metro.pause();
      Metro.unbind();
      car = null;
      stopSpeech();
      clearInterval(anaTick); anaTick = 0;
      var fromItem = wasView === 'item';
      S.view = 'lib';
      S.tab = p.tab === 'kit' ? 'kit' : 'lib';
      S.itemEl.hidden = true;
      S.itemEl.innerHTML = '';
      S.lib.hidden = false;
      renderLibrary();
      if (fromItem && S.libScroll) {
        var y = S.libScroll;
        requestAnimationFrame(function () { window.scrollTo(0, y); });
      }
    }
  }
  /** Bottom edge of the fixed top bar (0 when it scrolls away / is not fixed). */
  function topbarBottom() {
    var tb = document.querySelector('.topbar');
    if (!tb) return 0;
    var pos = window.getComputedStyle(tb).position;
    return (pos === 'fixed' || pos === 'sticky') ? Math.max(0, tb.getBoundingClientRect().bottom) : 0;
  }
  /** Top edge of what is fixed over the bottom of the page on phones (tab bar + its raised emergency FAB). */
  function bottomObstruction() {
    var lim = window.innerHeight || document.documentElement.clientHeight;
    var tab = document.getElementById('tabbar') || document.querySelector('.tabbar');
    if (tab && window.getComputedStyle(tab).display !== 'none') {
      var r = tab.getBoundingClientRect();
      if (r.height > 0 && r.top < lim) lim = r.top;
      var fab = tab.querySelector('.tabbar__fab-btn');
      if (fab) { var fr = fab.getBoundingClientRect(); if (fr.height > 0 && fr.top - 6 < lim) lim = fr.top - 6; }
    }
    return lim;
  }
  /**
   * Jump to the CPR metronome / adrenaline timer (deep link ?tool=, hero shortcut, header button). The card top goes
   * under the top bar — unless that would leave its main button under the tab bar / FAB (short phones, iPhone
   * toolbars): then the page scrolls further so the Start button is fully visible and ready to tap.
   */
  function jumpTool(tool) {
    var target = tool === 'cpr' ? document.getElementById('fa-cpr') : (tool === 'timer' ? document.getElementById('fa-ana') : null);
    if (!target) return;
    var btn = target.querySelector('.fa-cpr__go, .fa-ana__start, .fa-ana__second');
    var y0 = window.pageYOffset || document.documentElement.scrollTop || 0;
    var top = topbarBottom() + 12;
    var cr = target.getBoundingClientRect();
    var shift = cr.top - top;
    var dest = y0 + shift;
    if (btn) {
      var limit = bottomObstruction() - 16;
      var after = btn.getBoundingClientRect().bottom - shift;
      if (after > limit) dest += after - limit;
    }
    var max = Math.max(0, (document.documentElement.scrollHeight || 0) - (window.innerHeight || 0));
    dest = Math.max(0, Math.min(dest, max));
    try { window.scrollTo({ top: dest, left: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { window.scrollTo(0, dest); }
    if (btn) setTimeout(function () { try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 350);
  }

  function onRootClick(e) {
    var tEl = e.target;
    if (!tEl || !tEl.closest) return;
    var tab = tEl.closest('#fa-tabs [data-tab]');
    if (tab) {
      var v = tab.getAttribute('data-tab');
      if (v !== S.tab) NC.app.go('firstaid', v === 'kit' ? { tab: 'kit' } : null);
      return;
    }
    var sec = tEl.closest('[data-fa-sec]');
    if (sec) { toggleSec(sec.getAttribute('data-fa-sec')); return; }
    var kf = tEl.closest('[data-kitf]');
    if (kf) { S.kitFilter = kf.getAttribute('data-kitf'); renderKit(); return; }
    var dot = tEl.closest('[data-dot]');
    if (dot) { goStep(parseInt(dot.getAttribute('data-dot'), 10) || 0); return; }
    var os = tEl.closest('[data-open-step]');
    if (os) {
      S.step = parseInt(os.getAttribute('data-open-step'), 10) || 0;
      var seg = S.itemEl.querySelector('[data-fa-mode] [data-value="carousel"]');
      if (seg) seg.click(); else setStepsMode('carousel');
      var sec = document.getElementById('fa-steps');
      if (sec) try { sec.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (err) { /* ignore */ }
      return;
    }
    var ana = tEl.closest('[data-ana]');
    if (ana) { onAnaAction(ana.getAttribute('data-ana')); return; }
    var video = tEl.closest('[data-fa-video].is-disabled');
    if (video) { e.preventDefault(); NC.ui.toast(t('fa.video.hint_offline'), { type: 'info' }); return; }
    var act = tEl.closest('[data-fa]');
    if (!act) return;
    var a = act.getAttribute('data-fa');
    if (a === 'next') { if (S.step >= (car ? car.n - 1 : 0)) goStep(0); else goStep(S.step + 1); }
    else if (a === 'prev') goStep(S.step - 1);
    else if (a === 'tts') speakStep();
    else if (a === 'sources') openSources();
    else if (a === 'jump-cpr') jumpTool('cpr');
    else if (a === 'jump-ana') jumpTool('timer');
    else if (a === 'kit-copy') copyMissing();
    else if (a === 'kit-clear') {
      NC.ui.confirm({ title: t('fa.kit.title'), message: t('fa.kit.clear_q'), confirmLabel: t('fa.kit.clear'), danger: true }).then(function (ok) {
        if (!ok) return;
        S.kit = {}; saveKit(); renderKit();
      });
    }
  }
  function onRootChange(e) {
    var cb = e.target && e.target.getAttribute && e.target.getAttribute('data-kit');
    if (!cb) return;
    S.kit[cb] = !!e.target.checked;
    if (!S.kit[cb]) delete S.kit[cb];
    U.vibrate(10);
    saveKit();
    renderKit();
  }

  function mount(section) {
    if (!FA || !FA.items) {
      section.appendChild(NC.ui.emptyState({ icon: 'alert-triangle', variant: 'warning', title: t('common.error'), text: t('fa.notfound.text') }));
      section.appendChild(NC.ui.disclaimer());
      return;
    }
    S.section = section;
    S.root = ensureSkeleton(section);
    S.lib = document.getElementById('fa-lib');
    S.itemEl = document.getElementById('fa-item');
    buildIndex();
    S.root.addEventListener('click', onRootClick);
    S.root.addEventListener('change', onRootChange);
    var form = document.getElementById('fa-search');
    var input = document.getElementById('fa-q');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); if (input) input.blur(); renderResults(); });
    if (input) {
      input.addEventListener('input', function () { S.q = input.value; updateSearchButtons(); runSearch(); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; S.q = ''; updateSearchButtons(); renderResults(); } });
    }
    var clear = document.getElementById('fa-q-clear');
    if (clear) clear.addEventListener('click', function () { if (input) { input.value = ''; input.focus(); } S.q = ''; updateSearchButtons(); renderResults(); });
    var mic = document.getElementById('fa-q-mic');
    if (mic) mic.addEventListener('click', startVoice);
    var tabs = document.getElementById('fa-tabs');
    if (tabs) tabs.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var nextTab = S.tab === 'lib' ? 'kit' : 'lib';
      NC.app.go('firstaid', nextTab === 'kit' ? { tab: 'kit' } : null);
      setTimeout(function () { var b = document.getElementById(nextTab === 'kit' ? 'fa-tab-kit' : 'fa-tab-lib'); if (b) b.focus(); }, 30);
    });
    document.addEventListener('keydown', onDocKey);
    window.addEventListener('resize', U.debounce(function () { if (S.active && S.view === 'item') syncHeight(); }, 120));
    if (NC.bus) {
      NC.bus.on('i18n:change', function () {
        if (!S.active) { S.dirty = true; return; }
        rerender();
      });
      NC.bus.on('net:change', function () {
        updateSearchButtons();
        if (S.active && S.view === 'item') refreshVideo();
      });
    }
    // Load persisted state (kit ticks, anaphylaxis timer)
    kvGet('fa.kit').then(function (m) {
      S.kit = (m && typeof m === 'object') ? m : {};
      updateKitCount();
      if (S.active && S.view === 'lib' && S.tab === 'kit') renderKit();
    });
    loadAna();
  }
  function loadAna() {
    return kvGet('fa.ana').then(function (a) {
      if (a && a.injected_at && (Date.now() - U.toDate(a.injected_at).getTime()) < 12 * 3600000) S.ana = a;
      else S.ana = null;
      armAnaAlarm();
      if (S.active && S.view === 'item' && S.itemId === 'anaphylaxis') renderAna(ITEMS.anaphylaxis);
    });
  }
  function rerender() {
    S.dirty = false;
    if (S.view === 'item') {
      renderItem();
      var it = ITEMS[S.itemId];
      if (it) NC.app.setTitle(isPhone() ? shortTitle(it) : tx(it.title));
    } else renderLibrary();
  }

  function show(params) {
    if (!S.root) return;
    S.active = true;
    S.params = params || {};
    if (S.dirty) S.dirty = false;
    showView(S.params);
  }
  function hide() {
    S.active = false;
    // Leaving the screen stops the metronome (contract: sound must not keep running elsewhere in the app).
    if (Metro.isRunning()) Metro.pause();
    stopSpeech();
    stopVoice();
    clearInterval(anaTick); anaTick = 0;
    if (S.view === 'lib') S.libScroll = window.pageYOffset || 0;
  }

  NC.app.register('firstaid', {
    titleKey: 'app.title.firstaid', shortTitleKey: 'app.title_short.firstaid', mod: 'MOD.05', icon: 'cross',
    mount: mount, show: show, hide: hide
  });

  // "Delete my data" (this or another tab): forget the in-memory anaphylaxis timer and stop an armed alarm / CPR sound.
  // The fa.* kv keys themselves are already removed by NC.data.wipePersonal().
  if (NC.bus) {
    NC.bus.on('data:wiped', function () {
      S.ana = null;
      clearTimeout(anaAlarm); anaAlarm = 0;
      clearInterval(anaTick); anaTick = 0;
      if (Metro.isRunning()) Metro.pause();
      if (S.active && S.view === 'item' && S.itemId === 'anaphylaxis' && ITEMS.anaphylaxis) renderAna(ITEMS.anaphylaxis);
    });
  }

  // Arm a pending anaphylaxis alarm even before the screen is first opened.
  if (FA) {
    var armLater = function () { if (!S.section) loadAna(); };
    if (NC.boot && NC.boot.done && NC.boot.done.then) NC.boot.done.then(armLater);
    else setTimeout(armLater, 1500);
  }

  /** Public API for other screens (home checklist, MOD.01, emergency sheet). */
  NC.firstaid = {
    /** Open an item: NC.firstaid.open('cpr', {tool:'cpr'}). */
    open: function (id, opts) {
      var p = { item: id };
      if (opts && opts.tool) p.tool = opts.tool;
      if (opts && opts.step) p.step = opts.step;
      NC.app.go('firstaid', p);
    },
    openKit: function () { NC.app.go('firstaid', { tab: 'kit' }); },
    /** → Promise<{done,total,essentialDone,essentialTotal,pct}> read from kv 'fa.kit'. */
    kitStatus: function () {
      if (!FA) return Promise.resolve({ done: 0, total: 0, essentialDone: 0, essentialTotal: 0, pct: 0 });
      return kvGet('fa.kit').then(function (m) { return kitStats(m || {}); });
    },
    items: function () { return FA ? FA.items.slice() : []; },
    search: function (q) { return FA ? (search(q) || []) : []; },
    /** → {results:[item], related:[item]} — related = guides that only mention the words (shown in the "no exact guide" state). */
    searchDetailed: function (q) { return (FA && searchAll(q)) || { results: [], related: [] }; },
    metronome: Metro
  };
})(window.NC = window.NC || {});
