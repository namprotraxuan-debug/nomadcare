/*
 * i18n.js — bilingual UI strings (vi default, en). Each module registers its own namespaced keys.
 * Owner: P1 shell. Public API: NC.i18n.{add(dict), t(key, vars), lang(), setLang(l, {persist}), apply(root),
 * has(key), langs()}. DOM hooks: [data-i18n] (textContent — put it on a text-only element),
 * [data-i18n-html] (trusted innerHTML), [data-i18n-attr="placeholder:key;aria-label:key2"], [data-i18n-vars='{"n":1}'].
 * Registers the common.* namespace.
 */
(function (NC) {
  'use strict';

  var SUPPORTED = ['vi', 'en'];
  var dicts = { vi: {}, en: {} };
  var htmlLang = (document.documentElement.getAttribute('lang') || 'vi').slice(0, 2);
  var current = SUPPORTED.indexOf(htmlLang) >= 0 ? htmlLang : 'vi';

  /** Merge a dictionary { vi: {key: text}, en: {...} }. Later registrations override earlier ones. */
  function add(dict) {
    if (!dict) return;
    Object.keys(dict).forEach(function (l) {
      if (!dicts[l]) dicts[l] = {};
      var src = dict[l] || {};
      Object.keys(src).forEach(function (k) { dicts[l][k] = src[k]; });
    });
  }

  function interpolate(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      return (vars[k] !== undefined && vars[k] !== null) ? vars[k] : m;
    });
  }

  /** Translate `key` in the current language; fallback en → vi → key. */
  function t(key, vars) {
    var s = dicts[current] && dicts[current][key];
    if (s === undefined) s = dicts.en[key];
    if (s === undefined) s = dicts.vi[key];
    if (s === undefined) return key;
    return interpolate(s, vars);
  }
  function has(key) { return !!(dicts[current][key] !== undefined || dicts.en[key] !== undefined || dicts.vi[key] !== undefined); }
  function lang() { return current; }
  function langs() { return SUPPORTED.slice(); }

  function parseVars(el) {
    var raw = el.getAttribute('data-i18n-vars');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /** Fill every [data-i18n*] element under `root` (default: document). */
  function apply(root) {
    var scope = root || document;
    var sel = '[data-i18n],[data-i18n-html],[data-i18n-attr]';
    var nodes = Array.prototype.slice.call(scope.querySelectorAll(sel));
    if (scope.nodeType === 1 && scope.matches && scope.matches(sel)) nodes.unshift(scope);
    nodes.forEach(function (el) {
      var vars = parseVars(el);
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k, vars);
      var kh = el.getAttribute('data-i18n-html');
      if (kh) el.innerHTML = t(kh, vars);
      var ka = el.getAttribute('data-i18n-attr');
      if (ka) {
        ka.split(';').forEach(function (pair) {
          var i = pair.indexOf(':'); if (i < 0) return;
          var attr = pair.slice(0, i).trim(), key = pair.slice(i + 1).trim();
          if (attr && key) el.setAttribute(attr, t(key, vars));
        });
      }
    });
  }

  /**
   * Switch language. Persists via NC.settings (unless {persist:false}), updates html[lang],
   * re-applies the DOM and emits 'i18n:change' {lang}.
   */
  function setLang(l, opts) {
    var o = opts || {};
    if (SUPPORTED.indexOf(l) < 0) return;
    var changed = l !== current;
    current = l;
    document.documentElement.setAttribute('lang', l);
    try { window.localStorage.setItem('nc.lang', l); } catch (e) { /* ignore */ }
    if (o.persist !== false && NC.settings && typeof NC.settings.set === 'function' && NC.settings.get('lang') !== l) {
      NC.settings.set('lang', l);
    }
    if (changed || o.force) {
      apply(document);
      if (NC.bus) NC.bus.emit('i18n:change', { lang: l });
    }
  }

  // Keep in sync when another module writes settings.lang directly.
  if (NC.bus) {
    NC.bus.on('settings:change', function (p) {
      if (p && p.key === 'lang' && p.value !== current) setLang(p.value, { persist: false });
    });
  }

  NC.i18n = { add: add, t: t, has: has, lang: lang, langs: langs, setLang: setLang, apply: apply };

  /* ------------------------------------------------------------------ */
  /* common.* — shared vocabulary                                        */
  /* ------------------------------------------------------------------ */
  add({
    vi: {
      'common.save': 'Lưu', 'common.cancel': 'Huỷ', 'common.close': 'Đóng', 'common.back': 'Quay lại',
      'common.next': 'Tiếp tục', 'common.done': 'Xong', 'common.delete': 'Xoá', 'common.edit': 'Sửa',
      'common.confirm': 'Xác nhận', 'common.retry': 'Thử lại', 'common.search': 'Tìm kiếm',
      'common.loading': 'Đang tải…', 'common.offline': 'Offline', 'common.online': 'Online',
      'common.yes': 'Có', 'common.no': 'Không', 'common.km': 'km', 'common.min': 'phút',
      'common.call': 'Gọi', 'common.share': 'Chia sẻ', 'common.download': 'Tải xuống', 'common.copy': 'Sao chép',
      'common.copied': 'Đã sao chép', 'common.demo_data': 'Dữ liệu minh hoạ', 'common.required': 'Bắt buộc',
      'common.optional': 'Không bắt buộc', 'common.today': 'Hôm nay',
      'common.disclaimer_title': 'Lưu ý y tế',
      'common.disclaimer_body': 'Đây là hỗ trợ sơ cứu ban đầu, không thay thế chẩn đoán và điều trị y khoa. Luôn ưu tiên gọi 115 (hoặc nhờ người khác gọi) — đồng thời làm ngay các bước sơ cứu.',
      'common.call_115': 'Gọi 115', 'common.see_more': 'Xem thêm', 'common.empty': 'Chưa có dữ liệu',
      // extras
      'common.roaming_note': 'Cuộc gọi 115/112 có thể được chuyển qua mạng khác đang có sóng tại chỗ — nhưng không đảm bảo khi hoàn toàn không có sóng. Hãy luôn thử gọi trước.',
      'common.demo_data_hint': 'Cơ sở, số điện thoại và vị trí trong bản demo là dữ liệu minh hoạ, không dùng cho tình huống thật.',
      'common.demo_call': 'Số minh hoạ ({num}) — bản demo không thực hiện cuộc gọi này.',
      'common.calling': 'Đang mở trình gọi {num}…',
      'common.hold_hint': 'Nhấn giữ để xác nhận',
      'common.hold_kbd': 'Nhấn giữ, hoặc nhấn Enter hai lần để xác nhận',
      'common.sig.likely': 'Nhiều khả năng có sóng',
      'common.sig.uncertain': 'Không chắc chắn',
      'common.sig.lost': 'Nhiều khả năng mất sóng',
      'common.error': 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      'common.dismiss': 'Bỏ qua', 'common.open': 'Mở', 'common.settings': 'Cài đặt', 'common.undo': 'Hoàn tác',
      'common.details': 'Chi tiết', 'common.all': 'Tất cả', 'common.on': 'Bật', 'common.off': 'Tắt',
      'common.time.now': 'vừa xong', 'common.time.ago': '{n} {unit} trước', 'common.time.in': 'trong {n} {unit}',
      'common.never': 'Chưa có', 'common.unknown': 'Không rõ'
    },
    en: {
      'common.save': 'Save', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.back': 'Back',
      'common.next': 'Continue', 'common.done': 'Done', 'common.delete': 'Delete', 'common.edit': 'Edit',
      'common.confirm': 'Confirm', 'common.retry': 'Retry', 'common.search': 'Search',
      'common.loading': 'Loading…', 'common.offline': 'Offline', 'common.online': 'Online',
      'common.yes': 'Yes', 'common.no': 'No', 'common.km': 'km', 'common.min': 'min',
      'common.call': 'Call', 'common.share': 'Share', 'common.download': 'Download', 'common.copy': 'Copy',
      'common.copied': 'Copied', 'common.demo_data': 'Illustrative data', 'common.required': 'Required',
      'common.optional': 'Optional', 'common.today': 'Today',
      'common.disclaimer_title': 'Medical notice',
      'common.disclaimer_body': 'First-aid support only; not a substitute for medical diagnosis or treatment. Always call 115 first, or have someone call, while you start first aid.',
      'common.call_115': 'Call 115', 'common.see_more': 'See more', 'common.empty': 'Nothing here yet',
      'common.roaming_note': 'Emergency calls to 115/112 may roam onto any network with signal where you are — but this is not guaranteed when there is no signal at all. Always try calling first.',
      'common.demo_data_hint': 'Facilities, phone numbers and locations in this demo are illustrative and must not be used in a real emergency.',
      'common.demo_call': 'Illustrative number ({num}) — the demo does not place this call.',
      'common.calling': 'Opening the dialer for {num}…',
      'common.hold_hint': 'Press and hold to confirm',
      'common.hold_kbd': 'Press and hold, or press Enter twice to confirm',
      'common.sig.likely': 'Signal likely',
      'common.sig.uncertain': 'Signal uncertain',
      'common.sig.lost': 'Signal likely lost',
      'common.error': 'Something went wrong. Please try again.',
      'common.dismiss': 'Dismiss', 'common.open': 'Open', 'common.settings': 'Settings', 'common.undo': 'Undo',
      'common.details': 'Details', 'common.all': 'All', 'common.on': 'On', 'common.off': 'Off',
      'common.time.now': 'just now', 'common.time.ago': '{n} {unit} ago', 'common.time.in': 'in {n} {unit}',
      'common.never': 'Never', 'common.unknown': 'Unknown'
    }
  });
})(window.NC = window.NC || {});
