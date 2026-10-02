/*
 * emergency.js — the emergency sheet opened by the tab-bar FAB (#fab-emergency), the sidebar button
 * (#sb-emergency) and any [data-action="emergency"] element (delegation lives in app.js).
 * Big calm layout: 115 dominant (initial focus) → SOS + location (hold 1 s, only while a Buddy session is open;
 * otherwise "text my location" SMS + a Buddy set-up CTA) → talk to medical staff → QR profile → first aid
 * → 113 / 114 / 112 → last known coordinates to read to the operator. Owner: onboarding-settings-emergency.
 * Public API: NC.emergency.{open() → sheet ctrl, close(), sendSOS() → Promise, locate() → Promise<pos|null>}
 * Registers i18n namespace em.*.
 * Honesty (round 2 R7): the SOS tile and its toasts only say "gửi … tới {name}" when a real e-mail goes out
 * (NC.ui.alertChannel(s) === 'email'). Local build / demo address → "ghi SOS (email mô phỏng)"; phone-only session →
 * "máy chủ không tự báo — nhắn SMS" (MOD.04's SOS toast then offers the SMS composer).
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var h = U.h;
  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }
  function icon(n, c) { return NC.ui ? NC.ui.icon(n, c) : ''; }

  if (NC.i18n) NC.i18n.add({
    vi: {
      'em.title': 'Khẩn cấp',
      'em.subtitle': 'Giữ bình tĩnh. Làm theo thứ tự từ trên xuống.',
      'em.call_label': 'Gọi cấp cứu y tế', 'em.call_hint': 'Miễn phí · 24/7 · kể cả khi hết tiền',
      'em.call_aria': 'Gọi 115 — cấp cứu y tế',
      'em.sos': 'Gửi SOS + vị trí', 'em.sos_hint': 'Nhấn giữ 1 giây',
      'em.sos_log': 'Ghi SOS + vị trí',
      'em.sos_sending': 'Đang lấy vị trí và gửi SOS…',
      'em.sos_logging': 'Đang lấy vị trí và ghi SOS…',
      'em.sos_sent': 'Đã ghi SOS kèm vị trí lên máy chủ — máy chủ email cho người nhận.',
      'em.sos_logged': 'Đã ghi SOS kèm vị trí. Người nhận chưa được báo tự động — hãy nhắn SMS cho họ.',
      'em.sos_queued': 'Đang offline — SOS đã vào hàng đợi, sẽ lên máy chủ ngay khi có sóng.',
      'em.sos_failed': 'Chưa gửi được SOS (cần bật Buddy Check-in). Hãy gọi 115.',
      'em.sos_open_buddy': 'Mở Buddy',
      'em.sos_hint_to': 'Nhấn giữ 1 giây · email tới {name}', 'em.your_recipient': 'người nhận của bạn',
      'em.sos_hint_sim': 'Nhấn giữ 1 giây · email chỉ mô phỏng, không ai được báo thật',
      'em.sos_hint_phone': 'Nhấn giữ 1 giây · máy chủ không tự báo — nhắn SMS sau đó',
      'em.sos_no_buddy': 'Chưa bật Buddy Check-in nên không có ai nhận SOS. Hãy gọi 115 hoặc nhắn SMS vị trí.',
      'em.roaming': 'Cuộc gọi 115/112 có thể được chuyển qua mạng khác đang có sóng tại chỗ — nhưng không đảm bảo khi hoàn toàn không có sóng. Hãy luôn thử gọi trước.',
      'em.sms': 'Nhắn SMS vị trí', 'em.sms_hint_to': 'Tới {name} · kèm toạ độ', 'em.sms_hint': 'Kèm toạ độ · bạn chọn người nhận',
      'em.sms_hint_saved': 'Tới liên hệ khẩn cấp đã lưu · kèm toạ độ',
      'em.sms_hint_noloc': 'Chưa có toạ độ — nhấn “Định vị” bên dưới',
      'em.sms_body': 'Tôi cần giúp đỡ khẩn cấp. Vị trí của tôi: {coords} (lúc {time}). {map} — gửi từ NomadCare',
      'em.sms_body_noloc': 'Tôi cần giúp đỡ khẩn cấp, hãy gọi lại cho tôi. (Chưa lấy được vị trí GPS) — gửi từ NomadCare',
      'em.buddy_cta': 'Bật Buddy để dùng SOS',
      'em.buddy_cta_d': 'Ghi SOS kèm vị trí; có email người nhận thì máy chủ tự báo khi bạn nhấn SOS hoặc lỡ check-in.',
      'em.buddy_cta_d_local': 'Ghi SOS kèm vị trí và nhắc bạn nhắn SMS cho người nhận. Bản cục bộ này chỉ mô phỏng email.',
      'em.talk': 'Nói với nhân viên y tế', 'em.talk_hint': 'Câu song ngữ, chữ lớn',
      'em.qr': 'Hồ sơ y tế QR', 'em.qr_hint': 'Nhóm máu, dị ứng, thuốc',
      'em.firstaid': 'Sơ cứu', 'em.firstaid_hint': 'Từng bước, không cần mạng',
      'em.others': 'Số khẩn cấp khác',
      'em.n113': 'Công an', 'em.n114': 'Cứu hoả, cứu nạn', 'em.n112': 'Tìm kiếm cứu nạn',
      'em.loc_title': 'Vị trí gần nhất — đọc cho tổng đài viên',
      'em.loc_none': 'Chưa có vị trí. Nhấn “Định vị” để lấy toạ độ GPS.',
      'em.loc_update': 'Định vị', 'em.loc_copy': 'Sao chép toạ độ',
      'em.loc_copied': 'Đã sao chép toạ độ', 'em.loc_failed': 'Không lấy được GPS — đang dùng vị trí đã lưu gần nhất.',
      'em.locating': 'Đang định vị…',
      'em.src.gps': 'GPS', 'em.src.sim': 'mô phỏng', 'em.src.manual': 'nhập tay'
    },
    en: {
      'em.title': 'Emergency',
      'em.subtitle': 'Stay calm. Work from the top down.',
      'em.call_label': 'Call medical emergency', 'em.call_hint': 'Free · 24/7 · even without credit',
      'em.call_aria': 'Call 115 — medical emergency',
      'em.sos': 'Send SOS + location', 'em.sos_hint': 'Press and hold 1 s',
      'em.sos_log': 'Log SOS + location',
      'em.sos_sending': 'Getting your location and sending SOS…',
      'em.sos_logging': 'Getting your location and logging SOS…',
      'em.sos_sent': 'SOS with your location is on the server — it emails your recipient.',
      'em.sos_logged': 'SOS with your location logged. Nobody is told automatically — text your recipient.',
      'em.sos_queued': 'Offline — SOS is queued and goes to the server at the first signal.',
      'em.sos_failed': 'SOS not sent (Buddy check-in must be on). Call 115.',
      'em.sos_open_buddy': 'Open Buddy',
      'em.sos_hint_to': 'Press and hold 1 s · emails {name}', 'em.your_recipient': 'your recipient',
      'em.sos_hint_sim': 'Press and hold 1 s · the email is only simulated, nobody is really told',
      'em.sos_hint_phone': 'Press and hold 1 s · the server cannot alert anyone — text them next',
      'em.sos_no_buddy': 'Buddy check-in is off, so nobody would receive an SOS. Call 115 or text your location.',
      'em.roaming': 'Emergency calls to 115/112 may roam onto any network with signal where you are — but this is not guaranteed when there is no signal at all. Always try calling first.',
      'em.sms': 'Text my location', 'em.sms_hint_to': 'To {name} · with coordinates', 'em.sms_hint': 'With coordinates · you pick who',
      'em.sms_hint_saved': 'To your saved emergency contact · with coordinates',
      'em.sms_hint_noloc': 'No coordinates yet — tap “Locate” below',
      'em.sms_body': 'I need urgent help. My location: {coords} (at {time}). {map} — sent from NomadCare',
      'em.sms_body_noloc': 'I need urgent help, please call me back. (No GPS position yet) — sent from NomadCare',
      'em.buddy_cta': 'Turn on Buddy to use SOS',
      'em.buddy_cta_d': 'Logs SOS with your location; with a recipient email the server alerts them when you press SOS or miss a check-in.',
      'em.buddy_cta_d_local': 'Logs SOS with your location and reminds you to text your recipient. This local build only simulates e-mail.',
      'em.talk': 'Talk to medical staff', 'em.talk_hint': 'Bilingual phrases, big text',
      'em.qr': 'Medical QR profile', 'em.qr_hint': 'Blood type, allergies, meds',
      'em.firstaid': 'First aid', 'em.firstaid_hint': 'Step by step, works offline',
      'em.others': 'Other emergency numbers',
      'em.n113': 'Police', 'em.n114': 'Fire & rescue', 'em.n112': 'Search & rescue',
      'em.loc_title': 'Last known location — read it to the operator',
      'em.loc_none': 'No location yet. Tap “Locate” to get GPS coordinates.',
      'em.loc_update': 'Locate', 'em.loc_copy': 'Copy coordinates',
      'em.loc_copied': 'Coordinates copied', 'em.loc_failed': "Couldn't get GPS — using the last saved position.",
      'em.locating': 'Locating…',
      'em.src.gps': 'GPS', 'em.src.sim': 'simulated', 'em.src.manual': 'manual'
    }
  });

  var ctrl = null;

  /* ---------- location ---------- */
  function lastPosition() {
    var p = NC.settings ? NC.settings.get('last_position') : null;
    return (p && typeof p.lat === 'number' && typeof p.lng === 'number') ? p : null;
  }
  /** Try GPS (≤ 6 s), persist it in settings.last_position; fall back to the last saved position. */
  function locate() {
    return new Promise(function (resolve) {
      var fallback = lastPosition();
      if (!navigator.geolocation) { resolve(fallback); return; }
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(fallback); } }, 6500);
      try {
        navigator.geolocation.getCurrentPosition(function (p) {
          if (done) return; done = true; clearTimeout(timer);
          var pos = {
            lat: U.round(p.coords.latitude, 6), lng: U.round(p.coords.longitude, 6),
            accuracy_m: Math.round(p.coords.accuracy || 0), at: new Date().toISOString(), source: 'gps'
          };
          if (NC.settings) NC.settings.set('last_position', { lat: pos.lat, lng: pos.lng, at: pos.at, source: 'gps' });
          resolve(pos);
        }, function () {
          if (done) return; done = true; clearTimeout(timer); resolve(fallback);
        }, { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 });
      } catch (e) { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } }
    });
  }
  function coordsText(p) { return p ? U.round(p.lat, 5).toFixed(5) + ', ' + U.round(p.lng, 5).toFixed(5) : ''; }

  /* ---------- Buddy session (SOS needs an open session) ---------- */
  var sessionCache;   // undefined = not known yet · null = none · object = open session (active/overdue/alerted)
  function openSession(s) { return s && s.status && s.status !== 'closed' ? s : null; }
  /** Current open Buddy session (also refreshes the cache used to render the sheet synchronously). */
  function currentSession() {
    if (!NC.data || !NC.data.buddy || typeof NC.data.buddy.current !== 'function') { sessionCache = null; return Promise.resolve(null); }
    return Promise.resolve().then(function () { return NC.data.buddy.current(); })
      .then(function (s) { sessionCache = openSession(s); return sessionCache; }, function () { return sessionCache || null; });
  }
  /**
   * Recipient shown on the SOS tile. NOTES §6: with a reveal code set (identity behind the MOD.03 gate) → neutral
   * "người nhận của bạn"; while the profile is not read yet, neutral too (no name flash before loadContact()).
   */
  function recipientLabel(s) {
    var real = (s && (s.recipient_name || s.recipient_email)) || '';
    return real && idProtected() ? t('em.your_recipient') : real;
  }
  function idProtected() {
    var p = NC.profile && typeof NC.profile.peek === 'function' ? NC.profile.peek() : undefined;
    if (p === undefined) return contact ? !!contact.protected : true;
    return !!(p && p.identity && p.identity.reveal_code);
  }

  function channelOf(s) { return NC.ui && NC.ui.alertChannel ? NC.ui.alertChannel(s) : (s && s.recipient_email ? 'sim' : 'phone'); }

  /* ---------- SOS ---------- */
  /**
   * Send SOS + location via MOD.04 when present, else via the data layer outbox. The session is checked FIRST, so a
   * user without Buddy gets the answer at once (no hold + GPS wait for a guaranteed failure).
   */
  function sendSOS() {
    var ui = NC.ui;
    return currentSession().then(function (s) {
      if (!s) {
        if (ui) ui.toast(t('em.sos_no_buddy'), {
          type: 'warning', timeout: 7000,
          action: { label: t('common.call_115'), onClick: function () { ui.callNumber('115'); } }
        });
        refreshSlot();
        return null;
      }
      var real = channelOf(s) === 'email';
      if (ui) ui.toast(t(real ? 'em.sos_sending' : 'em.sos_logging'), { type: 'info', timeout: 2500 });
      return locate().then(function (pos) {
        if (NC.buddy && typeof NC.buddy.sos === 'function') {
          return Promise.resolve(NC.buddy.sos({ source: 'emergency', confirmed: true, position: pos }));
        }
        if (NC.data && NC.data.buddy && typeof NC.data.buddy.checkin === 'function') {
          return Promise.resolve(NC.data.buddy.checkin({
            kind: 'sos', lat: pos ? pos.lat : null, lng: pos ? pos.lng : null,
            accuracy_m: pos ? (pos.accuracy_m || null) : null, note: 'SOS · emergency sheet'
          })).then(function () {
            var online = NC.net ? NC.net.online() : navigator.onLine;
            if (ui) ui.toast(!online ? t('em.sos_queued') : real ? t('em.sos_sent') : t('em.sos_logged'), { type: online && real ? 'success' : 'warning', timeout: 6000 });
          });
        }
        throw new Error('no-buddy');
      });
    }).catch(function (err) {
      if (err && err.message !== 'no-buddy') console.warn('[emergency] SOS failed', err && err.message);
      if (ui) ui.toast(err && (err.code === 'no_session' || err.message === 'no-buddy') ? t('em.sos_no_buddy') : t('em.sos_failed'), {
        type: 'danger', timeout: 8000,
        action: { label: t('common.call_115'), onClick: function () { ui.callNumber('115'); } }
      });
      refreshSlot();
    });
  }

  /* ---------- SMS fallback (no Buddy session) ---------- */
  var contact = null;   // {name, phone, protected} from the identity layer of the (consented) medical profile; memory only
  function loadContact() {
    if (!NC.profile || typeof NC.profile.get !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return NC.profile.get(); }).then(function (p) {
      var id = p && p.identity;
      // With a reveal code set, the contact stays usable for the sms: link but its name/number are never displayed.
      contact = id && id.contact_phone ? { name: id.contact_name || '', phone: id.contact_phone, protected: !!id.reveal_code } : null;
      return contact;
    }, function () { contact = null; return null; });
  }
  /** sms: URI with the last known coordinates; the profile contact is pre-filled unless it is a demo number. */
  function smsInfo() {
    var p = lastPosition();
    var c = contact;
    var f = c && NC.ui && NC.ui.formatPhoneAction ? NC.ui.formatPhoneAction(c.phone) : null;
    var to = f && !f.isDemo && f.href ? f.href.replace(/^tel:/, '') : '';
    var body = p ? t('em.sms_body', {
      coords: coordsText(p), time: U.fmtTime ? U.fmtTime(p.at || new Date()) : '',
      map: 'https://maps.google.com/?q=' + U.round(p.lat, 5).toFixed(5) + ',' + U.round(p.lng, 5).toFixed(5)
    }) : t('em.sms_body_noloc');
    return {
      href: 'sms:' + to + '?&body=' + encodeURIComponent(body),
      hint: !p ? t('em.sms_hint_noloc') : (to ? (c.protected ? t('em.sms_hint_saved') : t('em.sms_hint_to', { name: c.name || c.phone })) : t('em.sms_hint'))
    };
  }

  /* ---------- sheet ---------- */
  var slotHold = null;  // holdToConfirm controller of the SOS tile
  var sheetBody = null;
  function sosTile(s) {
    var name = recipientLabel(s);
    var ch = channelOf(s);
    var hint = ch === 'phone' ? t('em.sos_hint_phone') : ch === 'sim' ? t('em.sos_hint_sim')
      : name ? t('em.sos_hint_to', { name: name }) : t('em.sos_hint');
    return '<button type="button" class="em-action em-action--sos" id="em-sos" data-em-slot="sos">' +
      '<span class="icon-tile icon-tile--solid-danger">' + icon('siren') + '</span>' +
      '<span class="em-action__title">' + U.esc(t(ch === 'email' ? 'em.sos' : 'em.sos_log')) + '</span>' +
      '<span class="em-action__hint">' + U.esc(hint) + '</span>' +
    '</button>';
  }
  function smsTile() {
    var m = smsInfo();
    return '<button type="button" class="em-action em-action--sos" id="em-sms" data-em-slot="sms" data-em="sms">' +
      '<span class="icon-tile icon-tile--solid-danger">' + icon('message-square') + '</span>' +
      '<span class="em-action__title">' + U.esc(t('em.sms')) + '</span>' +
      '<span class="em-action__hint">' + U.esc(m.hint) + '</span>' +
    '</button>';
  }
  /** Open the SMS app with a pre-filled message (built at tap time → freshest coordinates). */
  function openSms() {
    var a = document.createElement('a');
    a.href = smsInfo().href;
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
  }
  function buddyCta() {
    return '<div class="list list--card em-buddy" id="em-buddy">' +
      '<button type="button" class="list-item" data-em="buddy">' +
        '<span class="list-item__icon icon-tile icon-tile--primary">' + icon('shield-check') + '</span>' +
        '<span class="list-item__body"><span class="list-item__title">' + U.esc(t('em.buddy_cta')) + '</span>' +
        '<span class="list-item__meta">' + U.esc(t(NC.data && NC.data.mode === 'supabase' ? 'em.buddy_cta_d' : 'em.buddy_cta_d_local')) + '</span></span>' +
        '<span class="list-item__trail">' + icon('chevron-right') + '</span>' +
      '</button></div>';
  }
  /** Render / swap the first action tile (SOS while a session is open, otherwise SMS) and the Buddy CTA. */
  function renderSlot(root) {
    if (!root) return;
    var s = sessionCache || null;
    var old = root.querySelector('[data-em-slot]');
    var want = s ? 'sos' : 'sms';
    var holder = document.createElement('div');
    holder.innerHTML = s ? sosTile(s) : smsTile();
    var tile = holder.firstChild;
    if (old && old.getAttribute('data-em-slot') === want) {
      // Same kind: only refresh the title + hint in place (keeps focus and any hold in progress).
      ['.em-action__title', '.em-action__hint'].forEach(function (sel) {
        var oh = old.querySelector(sel), nh = tile.querySelector(sel);
        if (oh && nh && oh.textContent !== nh.textContent) oh.textContent = nh.textContent;
      });
    } else {
      var hadFocus = old && old === document.activeElement;
      if (slotHold && slotHold.destroy) { slotHold.destroy(); slotHold = null; }
      var grid = root.querySelector('.em-actions');
      if (old && old.parentNode) old.parentNode.replaceChild(tile, old);
      else if (grid) grid.insertBefore(tile, grid.firstChild);
      if (want === 'sos' && NC.ui && NC.ui.holdToConfirm) slotHold = NC.ui.holdToConfirm(tile, 1000, sendSOS);
      if (hadFocus) { try { tile.focus({ preventScroll: true }); } catch (e) { tile.focus(); } }
    }
    var cta = root.querySelector('#em-buddy');
    // The CTA only makes sense once the app is set up (the onboarding gate would bounce the Buddy route).
    var showCta = !s && !(NC.settings && NC.settings.get('onboarded') === false);
    if (showCta && !cta) {
      var box = document.createElement('div');
      box.innerHTML = buddyCta();
      var actions = root.querySelector('.em-actions');
      if (actions && actions.parentNode) actions.parentNode.insertBefore(box.firstChild, actions.nextSibling);
    } else if (!showCta && cta && cta.parentNode) cta.parentNode.removeChild(cta);
  }
  function refreshSlot() {
    return currentSession().then(function () { if (sheetBody) renderSlot(sheetBody); });
  }

  function renderLocation(box) {
    var p = lastPosition();
    var src = p && p.source ? t('em.src.' + p.source) : '';
    box.innerHTML =
      '<span class="icon-tile icon-tile--info">' + icon('map-pin') + '</span>' +
      '<div class="em-loc__body"><p class="em-loc__title">' + U.esc(t('em.loc_title')) + '</p>' +
      (p ? '<p class="em-loc__coords" translate="no">' + U.esc(coordsText(p)) + '</p>' +
           '<p class="em-loc__meta">' + U.esc(U.relTime(p.at) + (src && src !== 'em.src.' + p.source ? ' · ' + src : '')) + '</p>'
         : '<p class="em-loc__meta">' + U.esc(t('em.loc_none')) + '</p>') +
      '</div>' +
      '<div class="em-loc__btns">' +
        (p ? '<button type="button" class="btn btn--outline btn--sm" data-em="copy" title="' + U.esc(t('em.loc_copy')) + '">' + icon('copy') + '<span>' + U.esc(t('common.copy')) + '</span></button>' : '') +
        '<button type="button" class="btn btn--soft btn--sm" data-em="locate">' + icon('locate') + '<span>' + U.esc(t('em.loc_update')) + '</span></button>' +
      '</div>';
  }

  function build() {
    var root = h('div', { class: 'em' });
    root.innerHTML =
      // Initial focus lands on 115 (the one action that always matters most), not on the sheet's close button.
      '<a class="em-call" href="tel:115" data-call="115" data-autofocus aria-label="' + U.esc(t('em.call_aria')) + '">' +
        '<span class="em-call__icon">' + icon('phone-call') + '</span>' +
        '<span class="em-call__text"><span class="em-call__num">115</span>' +
        '<span class="em-call__label">' + U.esc(t('em.call_label')) + '</span>' +
        '<span class="em-call__hint">' + U.esc(t('em.call_hint')) + '</span></span>' +
        '<span class="em-call__go">' + icon('chevron-right') + '</span>' +
      '</a>' +
      '<p class="em-roam">' + icon('signal', 'icon--sm') + '<span>' + U.esc(t('em.roaming')) + '</span></p>' +
      '<div class="em-actions">' +
        (sessionCache ? sosTile(sessionCache) : smsTile()) +
        action('translate', 'languages', 'primary', 'em.talk', 'em.talk_hint') +
        action('qr', 'qr', 'info', 'em.qr', 'em.qr_hint') +
        action('firstaid', 'cross', 'success', 'em.firstaid', 'em.firstaid_hint') +
      '</div>' +
      '<div class="em-others"><p class="em-others__title">' + U.esc(t('em.others')) + '</p>' +
        '<div class="em-others__row">' + num('113', 'em.n113') + num('114', 'em.n114') + num('112', 'em.n112') + '</div>' +
      '</div>' +
      '<div class="em-loc" id="em-loc"></div>';
    return root;
  }
  function action(route, ic, variant, titleKey, hintKey) {
    return '<button type="button" class="em-action" data-em="' + route + '">' +
      '<span class="icon-tile icon-tile--' + variant + '">' + icon(ic) + '</span>' +
      '<span class="em-action__title">' + U.esc(t(titleKey)) + '</span>' +
      '<span class="em-action__hint">' + U.esc(t(hintKey)) + '</span>' +
      '</button>';
  }
  function num(n, labelKey) {
    return '<a class="em-num" href="tel:' + n + '" data-call="' + n + '"><b>' + n + '</b><span>' + U.esc(t(labelKey)) + '</span></a>';
  }

  function goTo(name, params) {
    close();
    if (NC.app && typeof NC.app.go === 'function') NC.app.go(name, params);
    else window.location.hash = '#/' + name;
  }

  /** Open the emergency sheet (idempotent while open). */
  function open() {
    if (!NC.ui) { window.location.href = 'tel:115'; return null; }
    if (ctrl) return ctrl;
    var body = build();
    var unsubs = [];
    sheetBody = body;
    ctrl = NC.ui.sheet({
      title: t('em.title'), subtitle: t('em.subtitle'), icon: 'siren', iconVariant: 'danger',
      size: 'md', className: 'em-sheet', body: body,
      onClose: function () {
        ctrl = null; sheetBody = null;
        if (slotHold && slotHold.destroy) slotHold.destroy();
        slotHold = null;
        unsubs.forEach(function (u) { if (typeof u === 'function') u(); });
      }
    });
    var loc = body.querySelector('#em-loc');
    renderLocation(loc);
    var first = body.querySelector('#em-sos');
    if (first && NC.ui.holdToConfirm) slotHold = NC.ui.holdToConfirm(first, 1000, sendSOS);
    renderSlot(body);
    // Confirm the Buddy state and the profile contact (both async, usually a few ms).
    Promise.all([currentSession(), loadContact()]).then(function () { if (sheetBody === body) renderSlot(body); });

    body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-em]') : null;
      if (!b) return;
      var what = b.getAttribute('data-em');
      if (what === 'translate') goTo('translate');
      else if (what === 'qr') goTo('qr', { view: 'rescuer' });
      else if (what === 'firstaid') goTo('firstaid');
      else if (what === 'buddy') goTo('buddy');
      else if (what === 'sms') openSms();
      else if (what === 'copy') {
        U.copyText(coordsText(lastPosition())).then(function (ok) { if (ok) NC.ui.toast(t('em.loc_copied'), { type: 'success', timeout: 2000 }); });
      } else if (what === 'locate') {
        NC.ui.setLoading(b, true);
        var before = lastPosition();
        locate().then(function (p) {
          NC.ui.setLoading(b, false);
          if (!p || (before && p.at === before.at)) NC.ui.toast(t('em.loc_failed'), { type: 'warning' });
          renderLocation(loc);
          renderSlot(body);
        });
      }
    });
    if (NC.bus) {
      unsubs.push(NC.bus.on('settings:change', function (p) {
        if (p && p.key === 'last_position') { renderLocation(loc); renderSlot(body); }
      }));
      unsubs.push(NC.bus.on('buddy:update', function (p) {
        sessionCache = openSession(p && p.session);
        renderSlot(body);
      }));
      // A reveal code set / removed (or the identity layer changed) while the sheet is open → refresh the tile hint.
      unsubs.push(NC.bus.on('profile:update', function () {
        loadContact().then(function () { if (sheetBody === body) renderSlot(body); });
      }));
    }
    return ctrl;
  }
  function close() { if (ctrl) ctrl.close(); }

  // Keep the Buddy state warm so the sheet opens with the right first tile (no SMS → SOS flash).
  if (NC.bus) NC.bus.on('buddy:update', function (p) { if (p && 'session' in p) sessionCache = openSession(p.session); });
  function warm() {
    // Wait for boot (it may wipe/reload on ?reset=1 or pick the backend) before touching the data layer.
    var b = NC.boot && NC.boot.done;
    if (b && typeof b.then === 'function') b.then(function () { currentSession(); }, function () { });
    else setTimeout(function () { currentSession(); }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', warm);
  else warm();

  NC.emergency = { open: open, close: close, sendSOS: sendSOS, locate: locate };
})(window.NC = window.NC || {});
