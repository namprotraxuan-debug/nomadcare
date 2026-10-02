/*
 * profile.js — NC.profile: two-layer emergency medical profile (MOD.03) + consents (owner: P1 data).
 * Public API: get, peek, save, clear, isComplete, missing, publicText, publicTextInfo, QR_MAX, BLOOD_TYPES,
 *             REQUIRED, normalize, consents.get / consents.set / consents.clear.
 * Stored ONLY on the device, encrypted via NC.secure (AES-GCM). Never synced; never logged.
 */
(function (NC) {
  'use strict';

  var KEY = 'profile';
  var CONSENT_KEY = 'consents';
  /** Accepted blood types (ASCII minus; U+2212 "−" input is normalised). */
  var BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'];
  /** The 4 required fields of the short profile (PDF 4.5): the public, non-identifying medical layer. */
  var REQUIRED = ['blood_type', 'allergies', 'conditions', 'medications'];
  var MAX_LEN = { allergies: 200, conditions: 200, medications: 200, notes: 300, full_name: 80, nationality: 60, contact_name: 80, contact_phone: 32 };
  var QR_MAX = 600;
  var CONSENT_DEFAULTS = { terms: false, sensitive: false, deadman: false, share_medical_in_alert: false, community_logs: false, at: null };

  var cache;          // undefined = not loaded yet, null = no profile
  var memFallback = {}; // used only when NC.secure and NC.store are both missing

  /* ---------------------------------------------------------------- storage shims */

  function secureApi() {
    if (NC.secure && NC.secure.save && NC.secure.load) return NC.secure;
    // Guarded shim: NC.secure missing at runtime → NC.store kv (unencrypted) or memory. Reported in integration notes.
    return {
      save: function (name, obj) { return NC.store ? NC.store.set('secure.' + name, obj) : Promise.resolve(memFallback[name] = obj); },
      load: function (name) { return NC.store ? NC.store.get('secure.' + name).then(function (v) { return v || null; }) : Promise.resolve(memFallback[name] || null); },
      remove: function (name) { return NC.store ? NC.store.del('secure.' + name) : Promise.resolve(delete memFallback[name]); }
    };
  }

  function kvGet(key) { return NC.store ? NC.store.get(key) : Promise.resolve(memFallback[key]); }
  function kvSet(key, v) { return NC.store ? NC.store.set(key, v) : Promise.resolve(memFallback[key] = v); }
  function kvDel(key) { return NC.store ? NC.store.del(key) : Promise.resolve(delete memFallback[key]); }

  function emit(evt, payload) { if (NC.bus && NC.bus.emit) NC.bus.emit(evt, payload); }

  /* ---------------------------------------------------------------- normalisation */

  function str(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, ' ').trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }

  function normBlood(v) {
    var s = str(v).toUpperCase().replace(/[−–—]/g, '-').replace(/\s/g, '');
    if (s === 'UNKNOWN' || s === '?' || s === 'KHONGRO' || s === 'KHÔNGRÕ') return 'unknown';
    return BLOOD_TYPES.indexOf(s) >= 0 ? s : '';
  }

  function normalize(p) {
    p = p || {};
    var pub = p.public || {};
    var id = p.identity || {};
    var code = str(id.reveal_code);
    return {
      public: {
        blood_type: normBlood(pub.blood_type),
        allergies: str(pub.allergies, MAX_LEN.allergies),
        conditions: str(pub.conditions, MAX_LEN.conditions),
        medications: str(pub.medications, MAX_LEN.medications),
        notes: str(pub.notes, MAX_LEN.notes)
      },
      identity: {
        full_name: str(id.full_name, MAX_LEN.full_name),
        nationality: str(id.nationality, MAX_LEN.nationality),
        contact_name: str(id.contact_name, MAX_LEN.contact_name),
        contact_phone: str(id.contact_phone, MAX_LEN.contact_phone),
        reveal_code: /^\d{4}$/.test(code) ? code : null
      },
      updated_at: p.updated_at || null
    };
  }

  /* ---------------------------------------------------------------- profile */

  /**
   * Load the profile from the encrypted store.
   * @returns {Promise<Object|null>}
   */
  function get() {
    return secureApi().load(KEY).then(function (p) {
      cache = p ? normalize(p) : null;
      return cache ? JSON.parse(JSON.stringify(cache)) : null;
    }).catch(function () { cache = null; return null; });
  }

  /** Last loaded profile (sync; undefined before the first get/save). */
  function peek() { return cache === undefined ? undefined : (cache ? JSON.parse(JSON.stringify(cache)) : null); }

  /**
   * Validate + encrypt + persist. Emits 'profile:update' {complete, updated_at} (no medical data on the bus).
   * @param {Object} profile
   * @returns {Promise<Object>} the normalised profile
   */
  function save(profile) {
    var p = normalize(profile);
    p.updated_at = new Date().toISOString();
    return secureApi().save(KEY, p).then(function () {
      cache = p;
      emit('profile:update', { complete: isComplete(p), updated_at: p.updated_at });
      return JSON.parse(JSON.stringify(p));
    });
  }

  /** Delete the profile (Settings → "Xoá toàn bộ dữ liệu" also goes through NC.data.wipePersonal). */
  function clear() {
    var api = secureApi();
    return Promise.resolve(api.remove ? api.remove(KEY) : null).then(function () {
      cache = null;
      emit('profile:update', { complete: false, updated_at: null, cleared: true });
    });
  }

  /**
   * Missing required fields (blood_type, allergies, conditions, medications). 'unknown' is a valid blood type.
   * @returns {string[]}
   */
  function missing(p) {
    var pub = (p && p.public) || {};
    return REQUIRED.filter(function (k) {
      if (k === 'blood_type') return !normBlood(pub.blood_type);
      return !str(pub[k]);
    });
  }

  /** True when the 4 required fields are filled. */
  function isComplete(p) { return !!p && missing(p).length === 0; }

  /* ---------------------------------------------------------------- QR text */

  var LABELS = {
    header: { vi: 'THÔNG TIN Y TẾ KHẨN CẤP', en: 'EMERGENCY MEDICAL INFO' },
    blood_type: { vi: 'Nhóm máu', en: 'Blood type' },
    allergies: { vi: 'Dị ứng', en: 'Allergies' },
    conditions: { vi: 'Bệnh nền', en: 'Conditions' },
    medications: { vi: 'Thuốc đang dùng', en: 'Medications' },
    notes: { vi: 'Ghi chú', en: 'Notes' },
    updated: { vi: 'Cập nhật', en: 'Updated' },
    unknown: { vi: 'Không rõ', en: 'Unknown' },
    none: { vi: 'Chưa khai báo', en: 'Not provided' },
    call: { vi: 'Gọi', en: 'Call' }
  };

  /** Compact labels used only when the full text would exceed QR_MAX (shorten labels before touching values). */
  var LABELS_SHORT = {
    header: { vi: 'Y TẾ KHẨN CẤP', en: 'EMERGENCY MEDICAL' },
    blood_type: { vi: 'Nhóm máu', en: 'Blood' },
    allergies: { vi: 'Dị ứng', en: 'Allergy' },
    conditions: { vi: 'Bệnh nền', en: 'Conditions' },
    medications: { vi: 'Thuốc', en: 'Meds' },
    notes: { vi: 'Ghi chú', en: 'Notes' }
  };
  /** Truncation order when even the compact text is too long: optional notes first, allergies last. */
  var CUT_ORDER = [{ key: 'notes', min: 0 }, { key: 'conditions', min: 40 }, { key: 'medications', min: 60 }, { key: 'allergies', min: 80 }, { key: 'conditions', min: 16 }, { key: 'medications', min: 16 }, { key: 'allergies', min: 24 }];

  function lbl(key, langs, short) {
    var set = short && LABELS_SHORT[key] ? LABELS_SHORT : LABELS;
    return langs.map(function (l) { return set[key][l]; }).join('/');
  }

  /** Loss-free value compaction: drop spaces around dashes and after , ; (keeps every word). */
  function compactValue(s) {
    return String(s || '').replace(/\s*[—–]\s*/g, '–').replace(/\s+([,;:.)\]])/g, '$1').replace(/([(\[])\s+/g, '$1').replace(/([,;])\s+/g, '$1');
  }

  /** Cut `s` to ≤ keep chars (+ '…'), preferring a word / list boundary close to the limit. */
  function cutValue(s, keep) {
    if (s.length <= keep) return s;
    if (keep <= 0) return '';
    var head = s.slice(0, keep);
    var b = Math.max(head.lastIndexOf(' '), head.lastIndexOf(','), head.lastIndexOf(';'));
    if (b >= keep - 14 && b > 8) head = head.slice(0, b);
    return head.replace(/[\s,;·/–-]+$/, '') + '…';
  }

  /** ISO timestamp → local calendar date 'YYYY-MM-DD' (the device's time zone, not UTC). */
  function localDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /**
   * Bilingual QR text plus a report of how it was fitted into QR_MAX chars. Never truncates silently:
   * 1) full labels; 2) compact header/labels; 3) + drop the "updated" line; 4) + loss-free value compaction;
   * 5) only then cut values — notes → conditions → medications → allergies (last, and never below 24 chars).
   * Identity fields are NEVER included.
   * @param {Object} p profile
   * @param {{langs?:Array<'vi'|'en'>}} [opts]
   * @returns {{text:string, length:number, max:number, fullLength:number, level:number, compacted:boolean,
   *            truncated:string[], over:number}}  level 0 = untouched … 4 = values cut; `truncated` lists cut
   *            fields; `over` = chars to remove from the values so nothing has to be cut.
   */
  function publicTextInfo(p, opts) {
    var langs = ((opts && opts.langs) || ['vi', 'en']).filter(function (l) { return l === 'vi' || l === 'en'; });
    if (!langs.length) langs = ['vi', 'en'];
    var pub = normalize(p).public;
    var fields = [
      { key: 'blood_type', value: pub.blood_type === 'unknown' ? lbl('unknown', langs) : pub.blood_type, fixed: true },
      { key: 'allergies', value: pub.allergies },
      { key: 'conditions', value: pub.conditions },
      { key: 'medications', value: pub.medications },
      { key: 'notes', value: pub.notes, optional: true }
    ];
    fields.forEach(function (f) { if (!f.value && !f.optional) { f.value = lbl('none', langs); f.fixed = true; } });
    var updated = p && p.updated_at ? localDate(p.updated_at) : null;
    var tail = lbl('call', langs) + ' 115';

    function render(level) {
      var short = level >= 1;
      var head = 'NOMADCARE – ' + langs.map(function (l) { return (short ? LABELS_SHORT : LABELS).header[l]; }).join(' / ');
      var lines = [head];
      fields.forEach(function (f) {
        var v = f.cut !== undefined ? f.cut : (level >= 3 && !f.fixed ? compactValue(f.value) : f.value);
        if (v) lines.push(lbl(f.key, langs, short) + ': ' + v);
      });
      if (updated && level < 2) lines.push(lbl('updated', langs) + ': ' + updated);
      lines.push(tail);
      return lines.join('\n');
    }

    var full = render(0);
    var info = { text: full, length: full.length, max: QR_MAX, fullLength: full.length, level: 0, compacted: false, truncated: [], over: 0 };
    if (full.length <= QR_MAX) return info;
    for (var level = 1; level <= 3; level++) {
      var t1 = render(level);
      info.text = t1; info.length = t1.length; info.level = level; info.compacted = true;
      if (t1.length <= QR_MAX) return info;
    }
    // Level 4: cut values in priority order (on compacted values) until the text fits.
    info.over = info.length - QR_MAX;
    info.level = 4;
    var byKey = {};
    fields.forEach(function (f) { byKey[f.key] = f; if (!f.fixed) f.cut = compactValue(f.value); });
    var text = render(3);
    for (var i = 0; i < CUT_ORDER.length && text.length > QR_MAX; i++) {
      var f = byKey[CUT_ORDER[i].key];
      if (!f || f.fixed || !f.cut || f.cut.length <= CUT_ORDER[i].min) continue;
      var excess = text.length - QR_MAX;
      var keep = Math.max(CUT_ORDER[i].min, f.cut.length - excess - 1);
      // Dropping the optional notes line entirely also saves its label.
      f.cut = f.optional && keep <= 0 ? '' : cutValue(f.cut, keep);
      if (info.truncated.indexOf(f.key) < 0) info.truncated.push(f.key);
      text = render(3);
    }
    info.text = text; info.length = text.length;
    return info;
  }

  /**
   * Plain-text bilingual block for the PUBLIC QR layer (readable by any camera app, offline, ≤ 600 chars).
   * See publicTextInfo() for how long profiles are fitted (and which fields had to be shortened).
   * @param {Object} p profile
   * @param {{langs?:Array<'vi'|'en'>}} [opts]
   * @returns {string}
   */
  function publicText(p, opts) { return publicTextInfo(p, opts).text; }

  /* ---------------------------------------------------------------- consents */

  var consents = {
    /**
     * @returns {Promise<{terms:boolean, sensitive:boolean, deadman:boolean, share_medical_in_alert:boolean, community_logs:boolean, at:string|null}>}
     */
    get: function () {
      return kvGet(CONSENT_KEY).then(function (v) { return Object.assign({}, CONSENT_DEFAULTS, v || {}); })
        .catch(function () { return Object.assign({}, CONSENT_DEFAULTS); });
    },
    /**
     * Merge a patch, stamp `at`, persist. `community_logs` is mirrored to NC.settings. Emits 'consents:change'.
     * @param {Object} patch
     */
    set: function (patch) {
      return consents.get().then(function (cur) {
        var next = Object.assign({}, cur);
        Object.keys(patch || {}).forEach(function (k) { if (k in CONSENT_DEFAULTS && k !== 'at') next[k] = !!patch[k]; });
        next.at = new Date().toISOString();
        return kvSet(CONSENT_KEY, next).then(function () {
          if (patch && 'community_logs' in patch && NC.settings && NC.settings.set) NC.settings.set('community_logs', !!patch.community_logs);
          emit('consents:change', next);
          return next;
        });
      });
    },
    /** Remove all consents (used by NC.data.wipePersonal). */
    clear: function () {
      return kvDel(CONSENT_KEY).then(function () { emit('consents:change', Object.assign({}, CONSENT_DEFAULTS)); });
    }
  };

  NC.profile = {
    BLOOD_TYPES: BLOOD_TYPES,
    REQUIRED: REQUIRED,
    get: get,
    peek: peek,
    save: save,
    clear: clear,
    isComplete: isComplete,
    missing: missing,
    publicText: publicText,
    publicTextInfo: publicTextInfo,
    QR_MAX: QR_MAX,
    normalize: normalize,
    consents: consents
  };
})(window.NC = window.NC || {});
