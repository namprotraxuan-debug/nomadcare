/*
 * util.js — DOM + formatting + misc helpers shared by every module.
 * Owner: P1 shell. Public API: NC.util.{$, $$, h, esc, uuid, haversineKm, fmtKm, fmtDuration, fmtDate,
 * fmtTime, fmtDateTime, relTime, daysSince, debounce, throttle, clamp, normalize, sleep, downloadBlob,
 * copyText, qs, isFileProtocol, vibrate, fmtNumber, fmtBytes, round, pick}
 */
(function (NC) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = /^(svg|g|path|circle|ellipse|rect|line|polyline|polygon|text|tspan|use|defs|symbol|linearGradient|radialGradient|stop|clipPath|mask|pattern|title|desc|foreignObject)$/;

  /** Current UI language ('vi' | 'en'), safe before i18n loads. */
  function lang() {
    return (NC.i18n && typeof NC.i18n.lang === 'function') ? NC.i18n.lang() : 'vi';
  }
  function locale() { return lang() === 'en' ? 'en-GB' : 'vi-VN'; }
  /** Translate with a hard-coded fallback (util loads before i18n). */
  function tt(key, fallbackVi, fallbackEn, vars) {
    if (NC.i18n && typeof NC.i18n.t === 'function') {
      var s = NC.i18n.t(key, vars);
      if (s && s !== key) return s;
    }
    var f = lang() === 'en' ? fallbackEn : fallbackVi;
    return vars ? String(f).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : f;
  }

  /* ------------------------------------------------------------------ */
  /* DOM                                                                  */
  /* ------------------------------------------------------------------ */

  /** querySelector shortcut. */
  function $(sel, root) { return (root || document).querySelector(sel); }
  /** querySelectorAll → Array. */
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /**
   * Hyperscript element builder.
   * attrs: class (string|array), style (string|object), html (trusted innerHTML), 'on:event' handlers,
   * dataset (object), data-* / aria-* / any attribute, boolean attrs (true → present, false/null → absent),
   * value/checked/selected/disabled set as properties too.
   * children: string (text, escaped) | Node | array | null/false (skipped).
   * @returns {Element}
   */
  function h(tag, attrs) {
    var isSvg = SVG_TAGS.test(tag);
    var el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) {
      children.unshift(attrs); attrs = null;
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class' || k === 'className') {
          var cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
          if (isSvg) el.setAttribute('class', cls); else el.className = cls;
        } else if (k === 'style') {
          if (typeof v === 'string') el.setAttribute('style', v);
          else Object.keys(v).forEach(function (p) {
            if (p.indexOf('--') === 0) el.style.setProperty(p, v[p]); else el.style[p] = v[p];
          });
        } else if (k === 'html') {
          el.innerHTML = v;
        } else if (k === 'text') {
          el.textContent = v;
        } else if (k === 'dataset') {
          Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        } else if (k.indexOf('on:') === 0) {
          el.addEventListener(k.slice(3), v);
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) {
          el.setAttribute(k, '');
          if (k in el && typeof el[k] === 'boolean') el[k] = true;
        } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'selected')) {
          el[k] = v;
          if (k !== 'value') el.setAttribute(k, '');
          else el.setAttribute('value', v);
        } else {
          el.setAttribute(k, v);
        }
      });
    }
    appendChildren(el, children);
    return el;
  }
  function appendChildren(el, children) {
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false || c === true) return;
      if (Array.isArray(c)) { appendChildren(el, c); return; }
      if (c.nodeType) { el.appendChild(c); return; }
      el.appendChild(document.createTextNode(String(c)));
    });
  }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  /** Escape a value for safe insertion into HTML (text or attribute). */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"'`]/g, function (c) { return ESC_MAP[c]; });
  }

  /** RFC4122 v4 UUID (crypto.randomUUID when available). */
  function uuid() {
    var c = window.crypto || window.msCrypto;
    if (c && typeof c.randomUUID === 'function') {
      try { return c.randomUUID(); } catch (e) { /* insecure context */ }
    }
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  /* ------------------------------------------------------------------ */
  /* Geo & numbers                                                        */
  /* ------------------------------------------------------------------ */

  /** Great-circle distance in km between {lat,lng} points (also accepts [lat,lng]). */
  function haversineKm(a, b) {
    if (!a || !b) return NaN;
    var lat1 = Array.isArray(a) ? a[0] : a.lat, lng1 = Array.isArray(a) ? a[1] : (a.lng !== undefined ? a.lng : a.lon);
    var lat2 = Array.isArray(b) ? b[0] : b.lat, lng2 = Array.isArray(b) ? b[1] : (b.lng !== undefined ? b.lng : b.lon);
    var R = 6371.0088, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function round(v, d) { var p = Math.pow(10, d || 0); return Math.round(v * p) / p; }

  /** Locale-aware number ("1,2" vi / "1.2" en). */
  function fmtNumber(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    var d = digits === undefined ? 0 : digits;
    try {
      return new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    } catch (e) {
      var s = Number(n).toFixed(d);
      return lang() === 'vi' ? s.replace('.', ',') : s;
    }
  }

  /** Distance: "850 m" under 1 km, "1,2 km", "12 km" from 100 km. */
  function fmtKm(km) {
    if (km === null || km === undefined || isNaN(km)) return '–';
    if (km < 1) {
      var m = km < 0.1 ? Math.round(km * 1000 / 5) * 5 : Math.round(km * 1000 / 10) * 10;
      return fmtNumber(Math.max(0, m)) + ' m';
    }
    return fmtNumber(km, km >= 100 ? 0 : 1) + ' km';
  }

  /** Duration in minutes → "1 giờ 20 phút" / "1 h 20 min". */
  function fmtDuration(minutes) {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return '–';
    var en = lang() === 'en';
    var m = Math.round(minutes);
    if (minutes > 0 && minutes < 1) return en ? '< 1 min' : '< 1 phút';
    if (m < 60) return m + (en ? ' min' : ' phút');
    var hrs = Math.floor(m / 60), rest = m % 60;
    if (hrs >= 24) {
      var days = Math.floor(hrs / 24), hh = hrs % 24;
      return days + (en ? ' d' : ' ngày') + (hh ? ' ' + hh + (en ? ' h' : ' giờ') : '');
    }
    return hrs + (en ? ' h' : ' giờ') + (rest ? ' ' + rest + (en ? ' min' : ' phút') : '');
  }

  /** Human file size: "1,4 MB". */
  function fmtBytes(bytes) {
    if (!bytes && bytes !== 0) return '–';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return fmtNumber(bytes / 1024, 0) + ' KB';
    return fmtNumber(bytes / 1048576, 1) + ' MB';
  }

  /* ------------------------------------------------------------------ */
  /* Dates                                                                */
  /* ------------------------------------------------------------------ */
  function toDate(v) {
    if (v instanceof Date) return v;
    if (v === null || v === undefined || v === '') return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "28/09/2026" (vi) or "28 Sep 2026" (en). */
  function fmtDate(v) {
    var d = toDate(v); if (!d) return '–';
    if (lang() === 'en') return d.getDate() + ' ' + MONTHS_EN[d.getMonth()] + ' ' + d.getFullYear();
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  /** "14:05". */
  function fmtTime(v) {
    var d = toDate(v); if (!d) return '–';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  /** "14:05 · 28/09/2026" (today → "14:05 · Hôm nay"). */
  function fmtDateTime(v) {
    var d = toDate(v); if (!d) return '–';
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return fmtTime(d) + ' · ' + (sameDay ? tt('common.today', 'Hôm nay', 'Today') : fmtDate(d));
  }
  /** Relative time: "vừa xong", "5 phút trước", "trong 10 phút". */
  function relTime(v) {
    var d = toDate(v); if (!d) return '–';
    var diff = (Date.now() - d.getTime()) / 1000; // seconds, >0 = past
    var future = diff < 0; var s = Math.abs(diff);
    if (s < 45) return tt('common.time.now', 'vừa xong', 'just now');
    var n, unitKey, vi, en;
    if (s < 3600) { n = Math.round(s / 60); unitKey = 'min'; vi = 'phút'; en = 'min'; }
    else if (s < 86400) { n = Math.round(s / 3600); unitKey = 'hour'; vi = 'giờ'; en = n === 1 ? 'hour' : 'hours'; }
    else if (s < 86400 * 30) { n = Math.round(s / 86400); unitKey = 'day'; vi = 'ngày'; en = n === 1 ? 'day' : 'days'; }
    else { return fmtDate(d); }
    var unit = lang() === 'en' ? en : vi;
    return future
      ? tt('common.time.in', 'trong {n} {unit}', 'in {n} {unit}', { n: n, unit: unit })
      : tt('common.time.ago', '{n} {unit} trước', '{n} {unit} ago', { n: n, unit: unit });
  }
  /** Whole days elapsed since a date (0 for today / future). */
  function daysSince(v) {
    var d = toDate(v); if (!d) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }

  /* ------------------------------------------------------------------ */
  /* Functions                                                            */
  /* ------------------------------------------------------------------ */
  function debounce(fn, ms) {
    var t = null;
    function d() {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    }
    d.cancel = function () { clearTimeout(t); t = null; };
    return d;
  }
  function throttle(fn, ms) {
    var last = 0, timer = null, pendingArgs = null, self = null;
    return function () {
      var now = Date.now(); self = this; pendingArgs = arguments;
      var wait = ms - (now - last);
      if (wait <= 0) {
        clearTimeout(timer); timer = null; last = now; fn.apply(self, pendingArgs);
      } else if (!timer) {
        timer = setTimeout(function () { last = Date.now(); timer = null; fn.apply(self, pendingArgs); }, wait);
      }
    };
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * Lowercase + strip Vietnamese diacritics (incl. đ→d) + collapse whitespace — for search matching.
   */
  function normalize(s) {
    if (s === null || s === undefined) return '';
    var out = String(s).toLowerCase();
    if (out.normalize) out = out.normalize('NFD');
    return out.replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
  }

  /** Pick a subset of keys. */
  function pick(obj, keys) {
    var o = {}; if (!obj) return o;
    keys.forEach(function (k) { if (k in obj) o[k] = obj[k]; });
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Browser                                                              */
  /* ------------------------------------------------------------------ */

  /** Save a Blob as a file (falls back to opening it). */
  function downloadBlob(filename, blob) {
    try {
      if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, filename); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    } catch (e) {
      console.warn('[util] download failed', e);
    }
  }

  /** Copy text to clipboard → Promise<boolean>. */
  function copyText(s) {
    var text = String(s === undefined || s === null ? '' : s);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy'); ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  /** Parsed location.search as a plain object (last value wins). */
  function qs() {
    var out = {};
    var s = window.location.search || '';
    if (window.URLSearchParams) {
      new URLSearchParams(s).forEach(function (v, k) { out[k] = v; });
    } else {
      s.replace(/^\?/, '').split('&').forEach(function (p) {
        if (!p) return; var kv = p.split('=');
        out[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      });
    }
    return out;
  }

  function isFileProtocol() { return window.location.protocol === 'file:'; }

  /** navigator.vibrate guarded (no-op on iOS / desktop). */
  function vibrate(pattern) {
    try { if (navigator.vibrate) return navigator.vibrate(pattern); } catch (e) { /* ignore */ }
    return false;
  }

  NC.util = {
    $: $, $$: $$, h: h, esc: esc, uuid: uuid,
    haversineKm: haversineKm, fmtKm: fmtKm, fmtDuration: fmtDuration, fmtNumber: fmtNumber, fmtBytes: fmtBytes,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, relTime: relTime, daysSince: daysSince,
    debounce: debounce, throttle: throttle, clamp: clamp, round: round, normalize: normalize, sleep: sleep, pick: pick,
    downloadBlob: downloadBlob, copyText: copyText, qs: qs, isFileProtocol: isFileProtocol, vibrate: vibrate,
    toDate: toDate
  };
})(window.NC = window.NC || {});
