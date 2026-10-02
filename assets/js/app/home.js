/*
 * home.js — Trang chủ (round-2 declutter): one greeting line + trip chip (→ Settings; the ONLY place the route name
 * is shown), ONE row with the 5 modules, ONE Buddy status card, a slim signal card (strip, dead-zone count/length,
 * "Mở bản đồ"), the pre-trip checklist and the route weather folded into the shared .disclosure, footer (content
 * review status + demo-data note; versions live in Settings). Each status is shown once: the pack status only in the
 * folded checklist (no version — Settings has it), Buddy only in its card — with the Buddy screen's own phase,
 * labels and colours (NC.buddy.phaseOf when present) and honest wording about who really gets told (R7).
 * Emergency path: the global 115 button (tab bar / sidebar).
 * Owner: P2 core-screens. Public API: NC.home.{refresh()}. Registers screen 'home' + i18n namespace home.*.
 * Markup: index.html #hm-root (single source; the old JS SKELETON copy was removed — only index.html loads home.js).
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var $ = U.$, $$ = U.$$, h = U.h, esc = U.esc;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }
  function S(k) { return NC.settings ? NC.settings.get(k) : null; }
  function lang() { return NC.i18n ? NC.i18n.lang() : 'vi'; }

  /* ================================================================== */
  /* i18n — home.*                                                        */
  /* ================================================================== */
  if (NC.i18n) NC.i18n.add({
    vi: {
      'home.hello': 'Xin chào, {name}', 'home.hello_anon': 'Xin chào, bạn',
      'home.trip_aria': 'Chuyến đi: {route}, {carrier}, {mode}. Nhấn để đổi',
      'home.mode.motorbike': 'Xe máy', 'home.mode.hiking': 'Đi bộ',
      'home.stat.checkin': 'Check-in kế tiếp', 'home.stat.off': 'Chưa bật',
      'home.h1': 'NomadCare — Trang chủ',
      'home.route.title': 'Sóng dọc tuyến', 'home.route.loading': 'Đang đọc gói dữ liệu tuyến…',
      'home.route.error': 'Chưa đọc được gói dữ liệu tuyến. Bản đồ và sơ cứu vẫn dùng được.',
      'home.route.no_dead': 'Không có đoạn “nhiều khả năng mất sóng”',
      'home.route.dz_sum': '{n} vùng mất sóng · tổng {len}', 'home.route.dz_sum_one': '1 vùng mất sóng · {len}',
      'home.route.open_map': 'Mở bản đồ',
      'home.mods.aria': 'Các module',
      'home.mod.translate': 'Dịch y tế', 'home.mod.map': 'Bản đồ', 'home.mod.qr': 'Hồ sơ QR', 'home.mod.buddy': 'Buddy', 'home.mod.firstaid': 'Sơ cứu',
      'home.buddy.title': 'Buddy Check-in',
      'home.buddy.off_title': 'Bật Buddy trước khi vào vùng mất sóng',
      'home.buddy.setup': 'Thiết lập Buddy', 'home.buddy.checkin': 'Tôi ổn — Check-in', 'home.buddy.details': 'Chi tiết',
      /* Fallbacks only: Home shows the Buddy screen's own labels (bd.status.* / bd.ring.* / bd.hero.*) when present. */
      'home.buddy.status.active': 'Đang theo dõi', 'home.buddy.status.soon': 'Sắp đến hạn',
      'home.buddy.status.grace': 'Đang ân hạn', 'home.buddy.status.overdue': 'QUÁ HẠN', 'home.buddy.status.alerted': 'Đã gửi cảnh báo', 'home.buddy.status.alerted_sim': 'Cảnh báo mô phỏng',
      'home.buddy.ring.until': 'đến hạn', 'home.buddy.ring.grace': 'ân hạn còn', 'home.buddy.ring.overdue': 'quá hạn',
      'home.buddy.ring.alerted': 'đã gửi', 'home.buddy.ring.alerted_sim': 'mô phỏng', 'home.buddy.ring.lost': 'mất liên lạc',
      'home.buddy.next': 'Check-in trước {time}', 'home.buddy.due_passed': 'Đã đến hạn lúc {time}',
      'home.buddy.every': 'Mỗi {interval} · ân hạn {grace}',
      'home.buddy.to': 'Người nhận: {name}', 'home.buddy.to_anon': 'Người nhận: đã ẩn tên',
      'home.buddy.done': 'Đã check-in lúc {time}.', 'home.buddy.queued': 'Đã check-in lúc {time} — đang offline, sẽ tự gửi khi có sóng.',
      'home.buddy.failed': 'Chưa check-in được. Hãy thử lại hoặc gọi 115 nếu khẩn cấp.',
      /* Overdue / alerted note — honest about the channel (R7): only a real e-mail "reaches" the recipient. */
      'home.buddy.warn_email': 'Máy chủ sẽ email vị trí cuối cho người nhận. Check-in ngay nếu bạn ổn.',
      'home.buddy.warn_email_off': 'Đang offline — nếu máy chủ đã nhận phiên này, nó vẫn tự email người nhận. Check-in ngay nếu bạn ổn.',
      'home.buddy.warn_email_sent': 'Máy chủ đã gửi email cảnh báo lúc {time}. Check-in ngay nếu bạn ổn.',
      'home.buddy.warn_sim_local': 'Email chỉ là mô phỏng — bản cục bộ không gửi email thật, người nhận chưa được báo. Bấm Gửi SMS, hoặc check-in nếu bạn ổn.',
      'home.buddy.warn_sim_demo': 'Email chỉ là mô phỏng — địa chỉ minh hoạ không được gửi thật. Bấm Gửi SMS, hoặc check-in nếu bạn ổn.',
      'home.buddy.warn_phone': 'Không có email người nhận nên máy chủ không tự báo — bấm Gửi SMS.',
      'home.buddy.sms': 'Gửi SMS', 'home.buddy.sms_opened': 'Đã mở ứng dụng SMS — hãy bấm gửi trong ứng dụng.',
      'home.buddy.sms_body': '{name} chưa check-in đúng hạn (NomadCare Buddy). Vị trí cuối: {coords} lúc {time}. {map}',
      'home.buddy.sms_body_noloc': '{name} chưa check-in đúng hạn (NomadCare Buddy). Chưa có vị trí GPS — hãy gọi lại.',
      'home.buddy.sms_body_sos': '{name} đã bấm SOS và cần giúp đỡ (NomadCare Buddy). Vị trí: {coords} lúc {time}. {map} Hãy gọi lại ngay; nếu không liên lạc được, gọi 112/115.',
      'home.buddy.sms_body_sos_noloc': '{name} đã bấm SOS và cần giúp đỡ (NomadCare Buddy). Chưa có vị trí GPS — hãy gọi lại ngay; nếu không liên lạc được, gọi 112/115.',
      'home.buddy.sms_body_lost': '{name} bị mất kết nối dữ liệu nên NomadCare Buddy mất liên lạc. Vị trí cuối: {coords} lúc {time}. {map}',
      'home.buddy.sms_body_lost_noloc': '{name} bị mất kết nối dữ liệu nên NomadCare Buddy mất liên lạc. Chưa có vị trí GPS — hãy gọi lại.',
      'home.buddy.sms_title': 'SMS cho người nhận', 'home.buddy.sms_to': 'Tới {phone}',
      'home.buddy.sms_demo': 'Số minh hoạ — bản demo không mở ứng dụng SMS. Sao chép nội dung để gửi thủ công.',
      'home.buddy.sms_nophone': 'Chưa có số điện thoại hợp lệ của người nhận — sao chép nội dung để gửi thủ công.',
      'home.check.title': 'Chuẩn bị trước chuyến đi', 'home.check.progress': '{done}/{total} đã xong',
      'home.check.pack': 'Gói dữ liệu tuyến & nhà mạng', 'home.check.pack_done': 'Đã lưu offline — bản mới nhất',
      'home.check.pack_partial': 'Gói nhẹ cài kèm — tải bản mới nhất khi còn sóng',
      'home.check.pack_update': 'Có bản mới — cập nhật khi còn sóng',
      'home.check.pack_server': 'Đọc trực tuyến, chưa lưu offline — tải gói khi còn sóng',
      'home.check.profile': 'Hồ sơ y tế 4 trường', 'home.check.profile_done': 'Nhóm máu, dị ứng, bệnh nền, thuốc',
      'home.check.profile_todo': 'Còn thiếu {n}/4 trường bắt buộc',
      'home.check.qr': 'Hình nền QR màn hình khoá', 'home.check.qr_done': 'Đã tạo {date}',
      'home.check.qr_todo': 'Người cứu hộ quét được cả khi máy khoá',
      'home.check.kit': 'Túi sơ cứu ≥ 80%', 'home.check.kit_val': '{done}/{total} vật dụng đã chuẩn bị',
      'home.check.all_done': 'Bạn đã sẵn sàng. Đi an toàn!',
      'home.check.state.done': 'Đã xong', 'home.check.state.partial': 'Một phần', 'home.check.state.todo': 'Chưa làm',
      'home.weather.title': 'Thời tiết trên tuyến',
      'home.weather.need_net_text': 'Thời tiết cập nhật khi có sóng. Mọi tính năng cứu mạng vẫn chạy offline.',
      'home.weather.last': 'Lần cuối {time}: {temp}',
      'home.weather.wind': 'Gió', 'home.weather.rain_now': 'Mưa lúc này', 'home.weather.rain_prob': 'Khả năng mưa hôm nay',
      'home.weather.tip_rain': 'Khả năng mưa cao — đường đèo trơn, giảm tốc và check-in trước khi vào đèo.',
      'home.weather.tip_ok': 'Thời tiết khá thuận lợi — vẫn nên check-in trước khi vào vùng mất sóng.',
      'home.weather.loading': 'Đang lấy thời tiết…', 'home.weather.error': 'Chưa lấy được thời tiết. Thử lại sau.',
      'home.weather.source': 'Nguồn: Open-Meteo · tâm tuyến', 'home.weather.updated': 'Cập nhật {time}',
      'home.weather.sum_off': 'Cần mạng',
      'home.foot.content': 'Nội dung y tế: {status}', 'home.foot.demo': 'Cơ sở y tế, số điện thoại và lớp sóng trong bản demo là dữ liệu minh hoạ.',
      'home.review.in_review': 'chờ cố vấn y tế ký duyệt', 'home.review.approved': 'đã được cố vấn y tế duyệt',
      'home.review.draft': 'bản nháp', 'home.review.bundled': 'bản cài kèm', 'home.review.retracted': 'đã thu hồi'
    },
    en: {
      'home.hello': 'Hello, {name}', 'home.hello_anon': 'Hello there',
      'home.trip_aria': 'Trip: {route}, {carrier}, {mode}. Tap to change',
      'home.mode.motorbike': 'Motorbike', 'home.mode.hiking': 'Hiking',
      'home.stat.checkin': 'Next check-in', 'home.stat.off': 'Off',
      'home.h1': 'NomadCare — Home',
      'home.route.title': 'Signal along your route', 'home.route.loading': 'Reading the route data pack…',
      'home.route.error': "Couldn't read the route data pack. Map and first aid still work.",
      'home.route.no_dead': 'No “signal likely lost” stretches',
      'home.route.dz_sum': '{n} dead zones · {len} in total', 'home.route.dz_sum_one': '1 dead zone · {len}',
      'home.route.open_map': 'Open map',
      'home.mods.aria': 'Modules',
      'home.mod.translate': 'Phrases', 'home.mod.map': 'Map', 'home.mod.qr': 'QR profile', 'home.mod.buddy': 'Buddy', 'home.mod.firstaid': 'First aid',
      'home.buddy.title': 'Buddy check-in',
      'home.buddy.off_title': 'Turn on Buddy before you enter a dead zone',
      'home.buddy.setup': 'Set up Buddy', 'home.buddy.checkin': "I'm OK — check in", 'home.buddy.details': 'Details',
      'home.buddy.status.active': 'Monitoring', 'home.buddy.status.soon': 'Due soon',
      'home.buddy.status.grace': 'Grace period', 'home.buddy.status.overdue': 'OVERDUE', 'home.buddy.status.alerted': 'Alert sent', 'home.buddy.status.alerted_sim': 'Simulated alert',
      'home.buddy.ring.until': 'until due', 'home.buddy.ring.grace': 'grace left', 'home.buddy.ring.overdue': 'overdue',
      'home.buddy.ring.alerted': 'sent', 'home.buddy.ring.alerted_sim': 'simulated', 'home.buddy.ring.lost': 'contact lost',
      'home.buddy.next': 'Check in before {time}', 'home.buddy.due_passed': 'Check-in was due at {time}',
      'home.buddy.every': 'Every {interval} · grace {grace}',
      'home.buddy.to': 'Recipient: {name}', 'home.buddy.to_anon': 'Recipient: name hidden',
      'home.buddy.done': 'Checked in at {time}.', 'home.buddy.queued': 'Checked in at {time} — offline, it will be sent at the first signal.',
      'home.buddy.failed': "Couldn't check in. Try again, or call 115 in an emergency.",
      'home.buddy.warn_email': 'The server will email your last location to your recipient. Check in now if you are OK.',
      'home.buddy.warn_email_off': 'Offline — if the server has this session, it still emails your recipient by itself. Check in now if you are OK.',
      'home.buddy.warn_email_sent': 'The server sent the alert email at {time}. Check in now if you are OK.',
      'home.buddy.warn_sim_local': 'The email is only simulated — the local build sends no real email, so your recipient has not been told. Tap Send SMS, or check in if you are OK.',
      'home.buddy.warn_sim_demo': 'The email is only simulated — demo addresses are never really emailed. Tap Send SMS, or check in if you are OK.',
      'home.buddy.warn_phone': 'No recipient email, so the server cannot alert anyone — tap Send SMS.',
      'home.buddy.sms': 'Send SMS', 'home.buddy.sms_opened': 'SMS app opened — tap send there.',
      'home.buddy.sms_body': '{name} missed a check-in (NomadCare Buddy). Last location: {coords} at {time}. {map}',
      'home.buddy.sms_body_noloc': '{name} missed a check-in (NomadCare Buddy). No GPS position yet — please call back.',
      'home.buddy.sms_body_sos': '{name} pressed SOS and needs help (NomadCare Buddy). Location: {coords} at {time}. {map} Call back now; if unreachable, call 112/115.',
      'home.buddy.sms_body_sos_noloc': '{name} pressed SOS and needs help (NomadCare Buddy). No GPS position yet — call back now; if unreachable, call 112/115.',
      'home.buddy.sms_body_lost': '{name} has no mobile data, so NomadCare Buddy lost contact. Last location: {coords} at {time}. {map}',
      'home.buddy.sms_body_lost_noloc': '{name} has no mobile data, so NomadCare Buddy lost contact. No GPS position yet — please call back.',
      'home.buddy.sms_title': 'SMS to your recipient', 'home.buddy.sms_to': 'To {phone}',
      'home.buddy.sms_demo': 'Illustrative number — the demo does not open the SMS app. Copy the text to send it yourself.',
      'home.buddy.sms_nophone': 'No valid phone number for your recipient — copy the text to send it yourself.',
      'home.check.title': 'Before you go', 'home.check.progress': '{done}/{total} done',
      'home.check.pack': 'Route & carrier data pack', 'home.check.pack_done': 'Saved offline — latest version',
      'home.check.pack_partial': 'Light bundled pack — download the latest while you have signal',
      'home.check.pack_update': 'New version available — update while you have signal',
      'home.check.pack_server': 'Read online, not saved offline — download the pack while you have signal',
      'home.check.profile': '4-field medical profile', 'home.check.profile_done': 'Blood type, allergies, conditions, medications',
      'home.check.profile_todo': '{n}/4 required fields missing',
      'home.check.qr': 'Lock-screen QR wallpaper', 'home.check.qr_done': 'Created {date}',
      'home.check.qr_todo': 'Rescuers can scan it even when your phone is locked',
      'home.check.kit': 'First-aid kit ≥ 80%', 'home.check.kit_val': '{done}/{total} items packed',
      'home.check.all_done': "You're ready. Travel safe!",
      'home.check.state.done': 'Done', 'home.check.state.partial': 'Partly done', 'home.check.state.todo': 'To do',
      'home.weather.title': 'Weather on your route',
      'home.weather.need_net_text': 'Weather updates when you have signal. Every life-saving feature still works offline.',
      'home.weather.last': 'Last at {time}: {temp}',
      'home.weather.wind': 'Wind', 'home.weather.rain_now': 'Rain now', 'home.weather.rain_prob': 'Chance of rain today',
      'home.weather.tip_rain': 'High chance of rain — mountain passes get slippery; slow down and check in before the pass.',
      'home.weather.tip_ok': 'Fair weather — still check in before you enter a dead zone.',
      'home.weather.loading': 'Getting the weather…', 'home.weather.error': "Couldn't get the weather. Try again later.",
      'home.weather.source': 'Source: Open-Meteo · route centre', 'home.weather.updated': 'Updated {time}',
      'home.weather.sum_off': 'Needs network',
      'home.foot.content': 'Medical content: {status}', 'home.foot.demo': 'Facilities, phone numbers and signal layers in this demo are illustrative.',
      'home.review.in_review': 'awaiting medical adviser sign-off', 'home.review.approved': 'signed off by the medical adviser',
      'home.review.draft': 'draft', 'home.review.bundled': 'bundled edition', 'home.review.retracted': 'retracted'
    }
  });

  /* ================================================================== */
  /* State                                                                */
  /* ================================================================== */
  var root = null;
  var visible = false;
  var tickTimer = null;
  var loadSeq = 0;
  var st = {
    pack: null, packKey: null, graph: null, analysis: null, stops: [], posKm: null,
    downloaded: [], routes: null, profile: null, session: null, consents: null,
    qrAt: null, kit: null, release: null, weather: null, weatherErr: false, weatherBusy: false, loaded: false
  };
  var WEATHER_KEY = 'home.weather';
  var WEATHER_TTL = 30 * 60000;

  /* ================================================================== */
  /* Helpers                                                              */
  /* ================================================================== */
  function modeLabel(m) { return t('home.mode.' + (m === 'hiking' ? 'hiking' : 'motorbike')); }
  function modeIcon(m) { return m === 'hiking' ? 'footprints' : 'bike'; }
  function carrierName(id) { return NC.app && NC.app.carrierName ? NC.app.carrierName(id) : (id || '—'); }
  function routeName(r) {
    if (!r) return '—';
    return lang() === 'en' && r.name_en ? r.name_en : r.name;
  }
  function locale() { return lang() === 'en' ? 'en-GB' : 'vi-VN'; }

  function fullDate(d) {
    try {
      var s = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
      return s.charAt(0).toUpperCase() + s.slice(1);
    } catch (e) { return U.fmtDate(d); }
  }

  /* The name belongs to the identity layer: with a reveal code set, the owner asked for it to stay behind the
     hold + code gate (MOD.03) → home greets without it. */
  function nameShown(p) { return !!(p && p.identity && p.identity.full_name && !p.identity.reveal_code); }
  /** NOTES §6: with a reveal code set, no contact / recipient name on the home screen either (neutral wording). */
  function idProtected() { return !!(st.profile && st.profile.identity && st.profile.identity.reveal_code); }

  /** Friendly first name: Vietnamese names → given name(s), others → first word. */
  function firstName(p) {
    var n = nameShown(p) ? String(p.identity.full_name).trim() : '';
    if (!n) return '';
    var w = n.split(/\s+/);
    var nat = U.normalize(p.identity.nationality || '');
    var vn = /viet|vn/.test(nat) || (!nat && lang() === 'vi');
    if (w.length <= 2) return n;
    return vn ? w.slice(-2).join(' ') : w[0];
  }
  /** "42:10" / "2:05:30"; negative → same format of the absolute value. */
  function clock(ms) {
    var s = Math.max(0, Math.round(Math.abs(ms) / 1000));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return hh ? hh + ':' + p2(mm) + ':' + p2(ss) : mm + ':' + p2(ss);
  }
  var VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉĩịọỏốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i;
  /** ` lang="vi"` for Vietnamese data text shown while the UI is in another language. */
  function viLang(v) { return lang() !== 'vi' && VI_CHARS.test(String(v || '')) ? ' lang="vi"' : ''; }

  function setHTML(el, html) { if (el) el.innerHTML = html; }
  function el(id) { return root ? root.querySelector('#' + id) : document.getElementById(id); }

  /* ================================================================== */
  /* Route analysis — main line = chain of non-connector edges            */
  /* ================================================================== */
  /**
   * Walk the main line of a pack: start at the 'from' node of the lowest-id edge, follow unvisited
   * non-connector edges (lowest id first) until the line closes (loop) or ends. Order-independent
   * (server/local packs list nodes differently).
   */
  function mainPath(pack) {
    var edges = (pack.edges || []).filter(function (e) { return !e.is_connector; })
      .slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    if (!edges.length) return null;
    var byNode = {};
    edges.forEach(function (e) {
      (byNode[e.from] = byNode[e.from] || []).push({ e: e, reversed: false, to: e.to });
      (byNode[e.to] = byNode[e.to] || []).push({ e: e, reversed: true, to: e.from });
    });
    var start = edges[0].from, cur = start, used = {}, steps = [], nodeIds = [start];
    for (var guard = 0; guard < edges.length + 2; guard++) {
      var opts = (byNode[cur] || []).filter(function (o) { return !used[o.e.id]; });
      if (!opts.length) break;
      // Prefer forward edges, then lowest id (seed/builder number the main line in travel order).
      opts.sort(function (a, b) { return (a.reversed - b.reversed) || String(a.e.id).localeCompare(String(b.e.id)); });
      var o = opts[0];
      used[o.e.id] = 1;
      steps.push({ edgeId: o.e.id, reversed: o.reversed });
      nodeIds.push(o.to);
      cur = o.to;
      if (cur === start) break;
    }
    return { nodeIds: nodeIds, steps: steps, length_km: 0, cost: 0 };
  }

  function computeAnalysis(pack) {
    if (!NC.routing || !pack) return null;
    try {
      var g = NC.routing.buildGraph([pack]);
      var path = mainPath(pack);
      var a = path ? NC.routing.analyze(g, path) : null;
      return { graph: g, analysis: a };
    } catch (e) { console.warn('[home] route analysis failed', e); return null; }
  }

  /* ================================================================== */
  /* Data loading                                                         */
  /* ================================================================== */
  function safe(p, def) { return Promise.resolve(p).then(null, function () { return def; }); }
  function call(fn, def) {
    try { return safe(fn(), def); } catch (e) { return Promise.resolve(def); }
  }

  function load() {
    var seq = ++loadSeq;
    var routeId = S('route_id'), carrier = S('carrier');
    var D = NC.data;
    var jobs = [
      D ? call(function () { return D.getPack(routeId, carrier); }, null) : Promise.resolve(null),
      D ? call(function () { return D.listDownloadedPacks(); }, []) : Promise.resolve([]),
      NC.profile ? call(function () { return NC.profile.get(); }, null) : Promise.resolve(null),
      D && D.buddy ? call(function () { return D.buddy.current(); }, null) : Promise.resolve(null),
      NC.store ? call(function () { return NC.store.get('qr.wallpaper_at'); }, null) : Promise.resolve(null),
      NC.store ? call(function () { return NC.store.get('fa.kit'); }, null) : Promise.resolve(null),
      D ? call(function () { return D.contentRelease(); }, null) : Promise.resolve(null)
    ];
    return Promise.all(jobs).then(function (r) {
      if (seq !== loadSeq) return;
      st.pack = r[0]; st.downloaded = r[1] || []; st.profile = r[2]; st.session = r[3];
      st.qrAt = r[4]; st.kit = r[5]; st.release = r[6]; st.loaded = true;
      var key = st.pack ? st.pack.route.id + ':' + st.pack.carrier + ':' + st.pack.version + ':' + st.pack.source : null;
      if (key !== st.packKey) {
        st.packKey = key;
        var res = st.pack ? computeAnalysis(st.pack) : null;
        st.graph = res ? res.graph : null;
        st.analysis = res ? res.analysis : null;
        st.stops = [];
        if (st.analysis && st.analysis.geometry.length && NC.routing.stopsAlong) {
          try { st.stops = NC.routing.stopsAlong(st.analysis, st.pack.facilities || [], { buffer_km: 3 }); } catch (e) { st.stops = []; }
        }
      }
      st.posKm = positionKm();
      renderAll();
      // listRoutes (server roundtrip when online) only feeds the "update available" hint — never block the first paint.
      if (D) call(function () { return D.listRoutes(); }, null).then(function (rows) {
        if (seq !== loadSeq) return;
        st.routes = rows;
        renderRoute(); renderChecklist();
      });
      loadWeather(false);
    });
  }

  function positionKm() {
    var p = S('last_position');
    var a = st.analysis;
    if (!p || !a || !a.geometry || a.geometry.length < 2 || !NC.routing.nearestOnLine) return null;
    try {
      var r = NC.routing.nearestOnLine(a.geometry, p);
      if (!r || r.distance_km > 5) return null;
      var total = NC.routing.lineLengthKm(a.geometry) || a.length_km;
      return total > 0 ? r.along_km * (a.length_km / total) : r.along_km;
    } catch (e) { return null; }
  }

  function routeRow() {
    if (!st.routes || !st.pack) return null;
    return st.routes.filter(function (r) { return r.id === st.pack.route.id; })[0] || null;
  }
  /** {state:'done'|'partial'|'todo', version, latest} for the current route/carrier pack. */
  function packState() {
    var routeId = S('route_id'), carrier = S('carrier');
    var dl = st.downloaded.filter(function (p) { return p.route_id === routeId && p.carrier === carrier; })[0];
    var row = routeRow();
    var srv = row && row.packs ? row.packs[carrier] : null;
    var latest = srv ? srv.version : null;
    if (dl) {
      var upd = !!(row && row.downloaded && row.downloaded[carrier] && row.downloaded[carrier].update_available);
      return { state: upd ? 'partial' : 'done', version: dl.version, latest: latest, update: upd };
    }
    return { state: st.pack ? 'partial' : 'todo', version: st.pack ? st.pack.version : null, latest: latest, update: false };
  }

  /* ================================================================== */
  /* Rendering                                                            */
  /* ================================================================== */
  function renderAll() {
    if (!root) return;
    renderTop();
    renderRoute();
    renderBuddy();
    renderChecklist();
    renderWeather();
    renderFoot();
  }

  /* ---------- greeting line + trip chip ---------- */
  function renderTop() {
    var p = st.profile;
    var name = firstName(p);
    var hello = el('hm-hello');
    if (hello) {
      hello.removeAttribute('data-i18n');
      hello.textContent = name ? t('home.hello', { name: name }) : t('home.hello_anon');
    }
    var d = el('hm-date');
    if (d) d.textContent = fullDate(new Date());

    var route = st.pack ? st.pack.route : null;
    var carrier = S('carrier'), mode = S('travel_mode');
    var rn = route ? routeName(route) : (NC.app && NC.app.routeName ? NC.app.routeName(S('route_id')) : S('route_id'));
    var trip = el('hm-trip');
    if (trip) {
      trip.innerHTML =
        '<span class="hm-trip__route">' + icon('route', 'icon--sm') + '<span class="truncate">' + esc(rn) + '</span></span>' +
        '<span class="hm-trip__sep" aria-hidden="true"></span>' +
        '<span class="hm-trip__item">' + icon('signal', 'icon--sm') + esc(carrierName(carrier)) + '</span>' +
        '<span class="hm-trip__sep" aria-hidden="true"></span>' +
        '<span class="hm-trip__item">' + icon(modeIcon(mode), 'icon--sm') + '<span class="hm-trip__mode">' + esc(modeLabel(mode)) + '</span></span>' +
        icon('chevron-right', 'icon--sm hm-trip__chev');
      trip.setAttribute('aria-label', t('home.trip_aria', { route: rn, carrier: carrierName(carrier), mode: modeLabel(mode) }));
      trip.setAttribute('title', t('home.trip_aria', { route: rn, carrier: carrierName(carrier), mode: modeLabel(mode) }));
    }
  }

  /* ---------- signal card: strip · dead zones · "Mở bản đồ" (the route name is in the trip chip) ---------- */
  function renderRoute() {
    var body = el('hm-route-body');
    if (!body) return;
    if (!st.pack) {
      body.innerHTML = st.loaded
        ? '<p class="hm-muted">' + esc(t('home.route.error')) + '</p>'
        : '<div class="hm-route__skel" aria-label="' + esc(t('home.route.loading')) + '"><span class="skeleton skeleton--text"></span><span class="skeleton hm-route__skel-bar"></span></div>';
      return;
    }
    var a = st.analysis, route = st.pack.route;
    // The route length is the strip's last axis label (no extra meta line).
    if (!a || !a.length_km) { body.innerHTML = '<p class="hm-muted">' + esc(U.fmtKm(route.length_km)) + '</p>'; return; }

    var zones = a.zones || [];
    var lostKm = a.lost_km || zones.reduce(function (sum, z) { return sum + (z.length_km || 0); }, 0);
    var dz = zones.length
      ? '<p class="hm-route__dz">' + icon('signal-off', 'icon--sm') + '<span>' +
          esc(zones.length === 1 ? t('home.route.dz_sum_one', { len: U.fmtKm(lostKm) }) : t('home.route.dz_sum', { n: zones.length, len: U.fmtKm(lostKm) })) + '</span></p>'
      : '<p class="hm-route__dz hm-route__dz--none">' + icon('signal', 'icon--sm') + '<span>' + esc(t('home.route.no_dead')) + '</span></p>';

    body.innerHTML = '<div class="hm-route__strip" id="hm-route-strip"></div>' + dz;
    var holder = el('hm-route-strip');
    if (holder && NC.viz) {
      try {
        // No facility dots on this slim card (they had no legend and their red read as more dead zones — R1.9);
        // the map shows them with a legend.
        holder.appendChild(NC.viz.signalStrip(a, { pos_km: st.posKm === null ? undefined : st.posKm, height: 14, showKm: true }));
      } catch (e) { console.warn('[home] strip failed', e); }
    }
  }

  /* ---------- buddy card — same phase, labels and colours as the Buddy screen (UX.2) ---------- */
  var PHASES = ['active', 'soon', 'grace', 'overdue', 'alerted'];
  /** Phase of an open session: NC.buddy.phaseOf (MOD.04, the one source of truth) or the same rule as fallback. */
  function buddyPhase(s) {
    if (!s) return null;
    var now = Date.now();
    if (NC.buddy && typeof NC.buddy.phaseOf === 'function') {
      try { var ph = NC.buddy.phaseOf(s, now); if (PHASES.indexOf(ph) >= 0) return ph; } catch (e) { /* fall back */ }
    }
    if (s.status === 'alerted') return 'alerted';
    if (s.status === 'overdue') return 'overdue';
    var due = Date.parse(s.next_due_at);
    if (now >= due) return 'grace';
    var soonMs = Math.min(15, (s.interval_min || 60) / 4) * 60000;
    return due - now <= soonMs ? 'soon' : 'active';
  }
  var PHASE_TONE = { active: 'primary', soon: 'accent', grace: 'accent', overdue: 'danger', alerted: 'danger' };
  var PHASE_BADGE = { active: 'badge--primary', soon: 'badge--accent', grace: 'badge--accent', overdue: 'hm-badge--danger', alerted: 'hm-badge--danger' };
  function has(k) { return !!(NC.i18n && NC.i18n.has && NC.i18n.has(k)); }
  /** The Buddy screen's string when it exists (one wording on both screens), else Home's fallback. */
  function tb(bdKey, homeKey, vars) { return t(has(bdKey) ? bdKey : homeKey, vars); }
  /** What triggered an overdue / alerted session: 'sos' | 'lost' (contact lost) | '' (missed check-in). */
  function cause(s, ph) {
    if (ph !== 'overdue' && ph !== 'alerted') return '';
    return s.alert_reason === 'sos' ? 'sos' : s.alert_reason === 'contact_lost' ? 'lost' : '';
  }
  function channel(s) { return NC.ui && NC.ui.alertChannel ? NC.ui.alertChannel(s) : (s && s.recipient_email ? 'sim' : 'phone'); }
  function statusText(s, ph) {
    var c = cause(s, ph), sim = ph === 'alerted' && channel(s) !== 'email';
    var key = c === 'sos' ? (ph === 'alerted' ? (sim ? 'bd.status.sos_alerted_sim' : 'bd.status.sos_alerted') : 'bd.status.sos')
      : c === 'lost' ? (ph === 'alerted' ? (sim ? 'bd.status.lost_alerted_sim' : 'bd.status.lost_alerted') : 'bd.status.lost')
      : ph === 'alerted' ? (sim ? 'bd.status.alerted_sim' : 'bd.status.alerted') : 'bd.status.' + ph;
    if (has(key)) return t(key);
    return t('home.buddy.status.' + (ph === 'alerted' && sim ? 'alerted_sim' : ph));
  }
  /** Overdue / alerted note: says exactly who gets told (R7 honesty), with the on-device SMS when nothing is sent. */
  function warnHtml(s, ph) {
    if (ph !== 'overdue' && ph !== 'alerted') return '';
    var ch = channel(s), txt;
    if (ch === 'phone') txt = t('home.buddy.warn_phone');
    else if (ch === 'sim') txt = t(NC.data && NC.data.mode === 'supabase' ? 'home.buddy.warn_sim_demo' : 'home.buddy.warn_sim_local');
    else if (ph === 'alerted') txt = t('home.buddy.warn_email_sent', { time: U.fmtTime(s.alerted_at || new Date()) });
    else txt = t(NC.net && !NC.net.online() ? 'home.buddy.warn_email_off' : 'home.buddy.warn_email');
    return '<div class="hm-buddy__warn"><p>' + icon('alert-triangle', 'icon--sm') + '<span>' + esc(txt) + '</span></p>' +
      (ch !== 'email' ? '<button class="btn btn--sm btn--outline hm-buddy__sms" type="button" data-hm="sms">' + icon('message-square') + '<span>' + esc(t('home.buddy.sms')) + '</span></button>' : '') +
      '</div>';
  }

  function renderBuddy() {
    var body = el('hm-buddy-body'), status = el('hm-buddy-status'), card = el('hm-buddy');
    if (!body) return;
    var s = st.session;
    if (!s) {
      if (card) card.className = 'hm-buddy card is-off';
      setHTML(status, '<span class="badge badge--neutral">' + esc(t('home.stat.off')) + '</span>');
      // Same teal primary action as the Buddy screen (the orange accent competed with the red 115 button — UX.5).
      body.innerHTML =
        '<p class="hm-buddy__off-title">' + esc(t('home.buddy.off_title')) + '</p>' +
        '<a class="btn btn--primary hm-buddy__setup" href="#/buddy">' + icon('shield-check') + '<span>' + esc(t('home.buddy.setup')) + '</span></a>';
      return;
    }
    var phase = buddyPhase(s);
    var key = phase + '|' + channel(s) + '|' + cause(s, phase);
    if (card) { card.className = 'hm-buddy card is-on is-' + phase; card.setAttribute('data-phase-key', key); }
    setHTML(status, '<span class="badge ' + PHASE_BADGE[phase] + '">' + esc(statusText(s, phase)) + '</span>');
    var rname = s.recipient_name ? String(s.recipient_name) : '';
    var rline = rname || s.recipient_email ? (idProtected() ? t('home.buddy.to_anon') : rname ? t('home.buddy.to', { name: rname }) : '') : '';
    var every = tb('bd.hero.every', 'home.buddy.every', { interval: U.fmtDuration(s.interval_min), grace: U.fmtDuration(s.grace_min) });
    body.innerHTML =
      '<div class="hm-buddy__row">' +
        '<div class="hm-buddy__ring" id="hm-buddy-ring"></div>' +
        '<div class="hm-buddy__info">' +
          '<p class="hm-buddy__due" id="hm-buddy-due"></p>' +
          '<p class="hm-buddy__meta">' + icon('clock', 'icon--xs') + esc(every) + '</p>' +
          (rline ? '<p class="hm-buddy__meta">' + icon('user', 'icon--xs') + esc(rline) + '</p>' : '') +
        '</div>' +
      '</div>' +
      warnHtml(s, phase) +
      '<div class="hm-buddy__actions">' +
        '<button class="btn btn--primary hm-buddy__checkin" type="button" data-hm="checkin">' + icon('check-circle') + '<span>' + esc(t('home.buddy.checkin')) + '</span></button>' +
        '<a class="btn btn--ghost btn--icon" href="#/buddy" aria-label="' + esc(t('home.buddy.details')) + '" title="' + esc(t('home.buddy.details')) + '">' + icon('chevron-right') + '</a>' +
      '</div>';
    tickBuddy();
  }

  /** 1-second update of the countdown ring (no full re-render). Same numbers and captions as the Buddy screen. */
  function tickBuddy() {
    var s = st.session;
    if (!s) return;
    var ringBox = el('hm-buddy-ring'), dueEl = el('hm-buddy-due');
    var phase = buddyPhase(s);
    var card = el('hm-buddy');
    if (card && card.getAttribute('data-phase-key') !== phase + '|' + channel(s) + '|' + cause(s, phase)) { renderBuddy(); return; }
    var now = Date.now(), due = Date.parse(s.next_due_at), graceMs = (s.grace_min || 0) * 60000;
    var interval = Math.max(1, (s.interval_min || 60) * 60000);
    var c = cause(s, phase), sim = channel(s) !== 'email';
    var frac = 1, label = '!', sub = '';
    // The Buddy screen's own ring model (NC.buddy.statusOf) when present: the same big count and caption on both
    // screens, e.g. the time the server noticed the silence on a contact_lost session. Fallback: the same rules here.
    var bs = null;
    if (NC.buddy && typeof NC.buddy.statusOf === 'function') {
      try { bs = NC.buddy.statusOf(s, now); } catch (e) { bs = null; }
      if (bs && bs.phase !== phase) bs = null;
    }
    if (bs && bs.count) {
      frac = typeof bs.value === 'number' && isFinite(bs.value) ? bs.value : 1;
      label = String(bs.count);
      // Honest caption: an alerted phone-only session was not e-mailed either (no "đã gửi" — R7).
      sub = phase === 'alerted' && sim && c !== 'sos' ? tb('bd.ring.alerted_sim', 'home.buddy.ring.alerted_sim') : String(bs.countSub || '');
    } else if (phase === 'active' || phase === 'soon') {
      frac = U.clamp((due - now) / interval, 0, 1); label = clock(due - now); sub = tb('bd.ring.until', 'home.buddy.ring.until');
    } else if (phase === 'grace') {
      frac = graceMs ? U.clamp((due + graceMs - now) / graceMs, 0, 1) : 0; label = clock(due + graceMs - now); sub = tb('bd.ring.grace', 'home.buddy.ring.grace');
    } else if (phase === 'overdue') {
      label = c === 'sos' ? 'SOS' : c === 'lost' ? '!' : '+' + clock(Math.max(0, now - due - graceMs));
      sub = c === 'sos' ? U.fmtTime(s.last_location_at || new Date()) : c === 'lost' ? tb('bd.ring.lost', 'home.buddy.ring.lost') : tb('bd.ring.overdue', 'home.buddy.ring.overdue');
    } else {
      label = c === 'sos' ? 'SOS' : U.fmtTime(s.alerted_at || new Date());
      sub = c === 'sos' ? U.fmtTime(s.alerted_at || new Date()) : sim ? tb('bd.ring.alerted_sim', 'home.buddy.ring.alerted_sim') : tb('bd.ring.alerted', 'home.buddy.ring.alerted');
    }
    var dueText = now < due ? tb('bd.hero.next', 'home.buddy.next', { time: U.fmtTime(s.next_due_at) }) : tb('bd.hero.due_passed', 'home.buddy.due_passed', { time: U.fmtTime(s.next_due_at) });
    if (ringBox && NC.viz) {
      ringBox.innerHTML = '';
      ringBox.appendChild(NC.viz.ring(frac, { size: 88, stroke: 8, tone: PHASE_TONE[phase], label: label, sublabel: sub, ariaLabel: statusText(s, phase) + ' · ' + dueText }));
    }
    if (dueEl && dueEl.textContent !== dueText) dueEl.textContent = dueText;
  }

  /** Prefilled SMS text for this session, by what triggered the alert: SOS · contact lost · missed check-in. */
  function smsBody(s) {
    var p = S('last_position');
    if (!(p && typeof p.lat === 'number')) p = s.last_lat !== null && s.last_lat !== undefined ? { lat: +s.last_lat, lng: +s.last_lng, at: s.last_location_at } : null;
    var name = s.traveler_name || 'NomadCare';
    var c = cause(s, buddyPhase(s));
    var base = c === 'sos' ? 'home.buddy.sms_body_sos' : c === 'lost' ? 'home.buddy.sms_body_lost' : 'home.buddy.sms_body';
    if (!p) return t(base + '_noloc', { name: name });
    var lat = (+p.lat).toFixed(5), lng = (+p.lng).toFixed(5);
    return t(base, {
      name: name, coords: lat + ', ' + lng, time: U.fmtDateTime(p.at || new Date()),
      map: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=15/' + lat + '/' + lng
    });
  }
  /**
   * Demo / missing / unusable recipient number: a sheet with the text to copy, right here (one tap from the warning;
   * a demo number is never dialled and the SMS app is not opened).
   */
  function smsSheet(s, body, norm) {
    if (!NC.ui || !NC.ui.sheet) return;
    var demo = !!(norm && norm.isDemo);
    var phone = norm && norm.valid ? (norm.display || norm.e164) : '';
    var wrap = h('div', { class: 'hm-sms' });
    wrap.innerHTML =
      (phone ? '<p class="hm-sms__to">' + icon('phone', 'icon--sm') + '<span>' + esc(t('home.buddy.sms_to', { phone: phone })) + '</span></p>' : '') +
      '<pre class="hm-sms__body" translate="no">' + esc(body) + '</pre>' +
      '<p class="hm-sms__note">' + icon('info', 'icon--sm') + '<span>' + esc(t(demo ? 'home.buddy.sms_demo' : 'home.buddy.sms_nophone')) + '</span></p>';
    NC.ui.sheet({
      title: t('home.buddy.sms_title'), icon: 'message-square', iconVariant: 'primary', body: wrap, className: 'hm-sms-sheet',
      actions: [{ label: t('common.copy'), variant: 'primary', icon: 'copy', close: false, onClick: function () {
        U.copyText(body).then(function (ok) { if (ok && NC.ui) NC.ui.toast(t('common.copied'), { type: 'success', timeout: 1800 }); });
        return false;
      } }]
    });
  }
  /** On-device SMS to the Buddy recipient (the only channel that reaches them for phone-only / simulated sessions). */
  function openSms() {
    var s = st.session;
    if (!s) return;
    if (NC.buddy && typeof NC.buddy.openSms === 'function') { NC.buddy.openSms(); return; }
    var norm = NC.buddyPhone && NC.buddyPhone.norm ? NC.buddyPhone.norm(s.recipient_phone) : (NC.ui && NC.ui.normPhone ? NC.ui.normPhone(s.recipient_phone) : null);
    var body = smsBody(s);
    if (!norm || !norm.valid || norm.isDemo || !norm.e164) { smsSheet(s, body, norm); return; }
    var a = document.createElement('a');
    a.href = 'sms:' + norm.e164 + '?&body=' + encodeURIComponent(body);   // '?&body=' works on iOS and Android
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
    if (NC.ui) NC.ui.toast(t('home.buddy.sms_opened'), { type: 'info', timeout: 5000 });
  }

  function doCheckin(btn) {
    if (!NC.data || !NC.data.buddy) return;
    if (NC.ui) NC.ui.setLoading(btn, true);
    U.vibrate(30);
    NC.data.buddy.checkin({ kind: 'checkin' }).then(function (ev) {
      if (NC.ui) NC.ui.setLoading(btn, false);
      var time = U.fmtTime(new Date());
      var queued = !(NC.net && NC.net.online());
      if (NC.ui) NC.ui.toast(t(queued ? 'home.buddy.queued' : 'home.buddy.done', { time: time }), { type: 'success' });
      return call(function () { return NC.data.buddy.current(); }, null).then(function (s) { st.session = s; renderBuddy(); renderChecklist(); });
    }, function () {
      if (NC.ui) { NC.ui.setLoading(btn, false); NC.ui.toast(t('home.buddy.failed'), { type: 'danger' }); }
    });
  }

  /* ---------- checklist ---------- */
  function checklistItems() {
    var items = [];
    var ps = packState();
    items.push({
      id: 'pack', icon: 'package', title: t('home.check.pack'), state: ps.state,
      sub: ps.state === 'done' ? t('home.check.pack_done') :
        ps.update ? t('home.check.pack_update') :
        (st.pack && st.pack.source === 'server' ? t('home.check.pack_server') : t('home.check.pack_partial')),
      go: 'settings', params: 'section=packs'
    });
    var p = st.profile;
    var miss = NC.profile && NC.profile.missing ? NC.profile.missing(p).length : (p ? 0 : 4);
    var complete = !!p && miss === 0;
    items.push({
      id: 'profile', icon: 'heart-pulse', title: t('home.check.profile'), state: complete ? 'done' : (p && miss < 4 ? 'partial' : 'todo'),
      sub: complete ? t('home.check.profile_done') : t('home.check.profile_todo', { n: miss }), go: 'qr'
    });
    items.push({
      id: 'qr', icon: 'smartphone', title: t('home.check.qr'), state: st.qrAt ? 'done' : 'todo',
      sub: st.qrAt ? t('home.check.qr_done', { date: U.fmtDate(st.qrAt) }) : t('home.check.qr_todo'), go: 'qr'
    });
    var kitList = (window.NC_FIRSTAID && window.NC_FIRSTAID.kit) || [];
    var kit = st.kit || {};
    var have = kitList.filter(function (k) { return !!kit[k.id]; }).length;
    var ratio = kitList.length ? have / kitList.length : 0;
    items.push({
      id: 'kit', icon: 'backpack', title: t('home.check.kit'), state: ratio >= 0.8 ? 'done' : have > 0 ? 'partial' : 'todo',
      sub: t('home.check.kit_val', { done: have, total: kitList.length || 20 }), go: 'firstaid', params: 'tab=kit', ratio: ratio
    });
    return items;
  }

  var STATE_ICON = { done: 'check-circle', partial: 'clock', todo: 'circle' };
  function renderChecklist() {
    var list = el('hm-check-list');
    if (!list) return;
    var items = checklistItems();
    var done = items.filter(function (i) { return i.state === 'done'; }).length;
    var partial = items.filter(function (i) { return i.state === 'partial'; }).length;
    var prog = el('hm-check-progress');
    var progText = done === items.length ? t('home.check.all_done') : t('home.check.progress', { done: done, total: items.length });
    if (prog) prog.textContent = progText;
    var ring = el('hm-check-ring');
    if (ring && NC.viz) {
      ring.innerHTML = '';
      ring.appendChild(NC.viz.ring((done + partial * 0.5) / items.length, {
        size: 32, stroke: 4, tone: done === items.length ? 'success' : 'primary', label: '',
        ariaLabel: progText
      }));
    }
    list.innerHTML = items.map(function (it) {
      return '<li><a class="hm-check__item is-' + it.state + '" href="#/' + it.go + (it.params ? '?' + esc(it.params) : '') + '">' +
        '<span class="hm-check__state" title="' + esc(t('home.check.state.' + it.state)) + '">' + icon(STATE_ICON[it.state]) +
        '<span class="visually-hidden">' + esc(t('home.check.state.' + it.state)) + '</span></span>' +
        '<span class="hm-check__body"><span class="hm-check__title">' + esc(it.title) + '</span>' +
        '<span class="hm-check__sub">' + esc(it.sub) + '</span>' +
        (it.id === 'kit' ? '<span class="progress progress--sm hm-check__bar" aria-hidden="true"><span class="progress__bar" style="width:' + Math.round((it.ratio || 0) * 100) + '%"></span></span>' : '') +
        '</span>' + icon('chevron-right', 'icon--sm hm-check__chev') + '</a></li>';
    }).join('');
  }

  /* ---------- weather ---------- */
  function bboxCenter() {
    var bb = st.pack && st.pack.route && st.pack.route.bbox;
    if (bb && bb.length === 4) return { lat: (bb[0] + bb[2]) / 2, lng: (bb[1] + bb[3]) / 2 };
    return null;
  }
  function loadWeather(force) {
    var c = bboxCenter();
    if (!c) { renderWeather(); return; }
    var routeId = st.pack.route.id;
    var fresh = st.weather && st.weather.route_id === routeId && Date.now() - Date.parse(st.weather.at) < WEATHER_TTL;
    var start = st.weather ? Promise.resolve(st.weather) : call(function () { return NC.store.get(WEATHER_KEY); }, null);
    start.then(function (cached) {
      if (cached && cached.route_id === routeId) st.weather = cached;
      fresh = st.weather && st.weather.route_id === routeId && Date.now() - Date.parse(st.weather.at) < WEATHER_TTL;
      renderWeather();
      if ((fresh && !force) || st.weatherBusy || !(NC.net && NC.net.online()) || !window.fetch) return;
      st.weatherBusy = true; st.weatherErr = false;
      renderWeather();
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) +
        '&current=temperature_2m,wind_speed_10m,precipitation&daily=precipitation_probability_max&timezone=Asia%2FBangkok&forecast_days=1';
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
      fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        clearTimeout(timer);
        var cur = j.current || {};
        var prob = j.daily && j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[0] : null;
        st.weather = {
          route_id: routeId, at: new Date().toISOString(),
          temp: cur.temperature_2m, wind: cur.wind_speed_10m, precip: cur.precipitation, prob: prob
        };
        st.weatherBusy = false;
        if (NC.store) NC.store.set(WEATHER_KEY, st.weather).catch(function () {});
        renderWeather();
      }).catch(function () {
        clearTimeout(timer);
        st.weatherBusy = false; st.weatherErr = true;
        renderWeather();
      });
    });
  }

  function fmtTemp(v) { return v === null || v === undefined || isNaN(v) ? '–' : Math.round(v) + '°C'; }

  function renderWeather() {
    var body = el('hm-weather-body'), card = el('hm-weather'), ic = el('hm-weather-icon'), place = el('hm-weather-place');
    if (!body) return;
    var online = !!(NC.net && NC.net.online());
    var w = st.weather && st.pack && st.weather.route_id === st.pack.route.id ? st.weather : null;
    // Folded header: "24°C", or "Cần mạng" offline. No route name — the trip chip is the only place it is shown
    // (UX.11); the body does not repeat "Cần mạng" either.
    if (place) place.textContent = !online ? t('home.weather.sum_off') : w ? fmtTemp(w.temp) : '';
    if (card) card.classList.toggle('is-offline', !online);
    if (!online) {
      if (ic) ic.innerHTML = icon('cloud-off');
      body.innerHTML = '<p class="hm-muted">' + esc(t('home.weather.need_net_text')) + '</p>' +
        (w ? '<p class="hm-weather__last">' + esc(t('home.weather.last', { time: U.fmtDateTime(w.at), temp: fmtTemp(w.temp) })) + '</p>' : '');
      return;
    }
    if (!w) {
      if (ic) ic.innerHTML = icon('cloud');
      body.innerHTML = st.weatherErr
        ? '<p class="hm-muted">' + esc(t('home.weather.error')) + '</p><button class="btn btn--soft btn--sm" type="button" data-hm="weather">' + icon('refresh') + '<span>' + esc(t('common.retry')) + '</span></button>'
        : '<div class="hm-weather__skel"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></div>';
      return;
    }
    var rainy = (w.prob !== null && w.prob >= 60) || (w.precip > 0.2);
    var iconName = rainy ? 'cloud-rain' : (w.prob !== null && w.prob >= 30 ? 'cloud' : 'sun');
    if (ic) ic.innerHTML = icon(iconName);
    body.innerHTML =
      '<div class="hm-weather__now"><span class="hm-weather__temp">' + esc(fmtTemp(w.temp)) + '</span>' +
      '<dl class="hm-weather__kv">' +
        '<div><dt>' + icon('wind', 'icon--xs') + esc(t('home.weather.wind')) + '</dt><dd>' + esc(w.wind === null || w.wind === undefined ? '–' : Math.round(w.wind) + ' km/h') + '</dd></div>' +
        '<div><dt>' + icon('droplet', 'icon--xs') + esc(t('home.weather.rain_now')) + '</dt><dd>' + esc(w.precip === null || w.precip === undefined ? '–' : U.fmtNumber(w.precip, 1) + ' mm') + '</dd></div>' +
        '<div><dt>' + icon('cloud-rain', 'icon--xs') + esc(t('home.weather.rain_prob')) + '</dt><dd>' + esc(w.prob === null || w.prob === undefined ? '–' : w.prob + '%') + '</dd></div>' +
      '</dl></div>' +
      '<p class="hm-weather__tip hm-weather__tip--' + (rainy ? 'rain' : 'ok') + '">' + icon(rainy ? 'alert-triangle' : 'info', 'icon--sm') + '<span>' + esc(t(rainy ? 'home.weather.tip_rain' : 'home.weather.tip_ok')) + '</span></p>' +
      '<p class="hm-weather__src">' + esc(t('home.weather.source')) + ' · ' + esc(t('home.weather.updated', { time: U.fmtTime(w.at) })) + '</p>';
  }

  /* ---------- footer ---------- */
  /* Home is not a medical screen: no medical disclaimer here (PLAN R1). The medical modules keep theirs and the
     115 button is global (sidebar / tab bar). */
  /* The content version lives in Settings → Nội dung y tế (UX.11); Home keeps the honest review status + demo note. */
  function renderFoot() {
    var m = el('hm-foot-meta');
    if (!m) return;
    var r = st.release || {};
    var status = r.status || (window.NC_FIRSTAID && window.NC_FIRSTAID.review && window.NC_FIRSTAID.review.status) || 'in_review';
    var sk = 'home.review.' + status;
    m.innerHTML = '<span>' + icon('book-open', 'icon--xs') + esc(t('home.foot.content', { status: has(sk) ? t(sk) : status })) + '</span>' +
      '<span>' + icon('info', 'icon--xs') + esc(t('home.foot.demo')) + '</span>';
  }

  /* ================================================================== */
  /* Lifecycle                                                            */
  /* ================================================================== */
  function startTick() {
    stopTick();
    tickTimer = setInterval(function () { if (visible && st.session) tickBuddy(); }, 1000);
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  var refreshSoon = U.debounce(function () { if (visible) load(); }, 150);

  /** Disclosure (accordion) header button → toggles its panel (checklist, weather). */
  function toggleFold(btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel || !root.contains(panel)) return;
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
    var card = btn.closest('.hm-fold');
    if (card) card.classList.toggle('is-open', open);   // shared .disclosure heading variant (components.css)
  }

  function mount(section) {
    root = section.querySelector('#hm-root');
    if (!root) { root = h('div', { class: 'hm', id: 'hm-root' }); section.appendChild(root); }   // markup lives in index.html
    if (NC.i18n) NC.i18n.apply(root);
    root.addEventListener('click', function (e) {
      var f = e.target.closest ? e.target.closest('.hm-fold__btn') : null;
      if (f && root.contains(f)) { toggleFold(f); return; }
      var b = e.target.closest ? e.target.closest('[data-hm]') : null;
      if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-hm');
      if (a === 'checkin') { e.preventDefault(); doCheckin(b); }
      else if (a === 'sms') { e.preventDefault(); openSms(); }
      else if (a === 'weather') { e.preventDefault(); st.weatherErr = false; loadWeather(true); }
    });
    if (NC.bus) {
      NC.bus.on('settings:change', function (p) {
        if (!p) return;
        if (['route_id', 'carrier', 'travel_mode', 'user_lang', 'last_position'].indexOf(p.key) >= 0) refreshSoon();
      });
      ['data:pack', 'profile:update', 'consents:change', 'data:mode', 'fa:kit'].forEach(function (ev) { NC.bus.on(ev, refreshSoon); });
      NC.bus.on('buddy:update', function (p) {
        if (p && p.session !== undefined) { st.session = p.session && p.session.status !== 'closed' ? p.session : null; if (visible) { renderBuddy(); renderChecklist(); } }
        else refreshSoon();
      });
      NC.bus.on('net:change', function () { if (visible) { renderWeather(); loadWeather(false); } });
      NC.bus.on('i18n:change', function () { if (root && visible) renderAll(); });
    }
    // qr.wallpaper_at has no event → every show() re-reads the kv keys.
  }

  function show() {
    visible = true;
    // Latest stored profile from the NC.profile cache (sync): a reveal code set on another screen applies to the first
    // paint too, so neither the greeting nor the Buddy recipient flashes before load() resolves.
    var pk = NC.profile && typeof NC.profile.peek === 'function' ? NC.profile.peek() : undefined;
    if (pk !== undefined) st.profile = pk;
    renderAll();
    load();
    startTick();
  }
  function hide() { visible = false; stopTick(); }

  if (NC.app && NC.app.register) {
    NC.app.register('home', { titleKey: 'app.title.home', mount: mount, show: show, hide: hide });
  }

  NC.home = { refresh: function () { return load(); }, _mainPath: mainPath };
})(window.NC = window.NC || {});
