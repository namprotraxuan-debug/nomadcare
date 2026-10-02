/*
 * ui.js — UI helpers shared by every screen: icons, toasts, sheets/modals (focus trap, ESC, backdrop,
 * scroll lock, swipe-down), confirm, hold-to-confirm, medical disclaimer, empty state, badges, phone actions.
 * Owner: P1 shell. Public API: NC.ui.{icon, iconEl, toast, modal, sheet, confirm, holdToConfirm, disclaimer,
 * emptyState, badge, signalBadge, demoBadge, formatPhoneAction, callNumber, assetUrl, setLoading,
 * segmented, closeAll({route}), lockScroll, unlockScroll, onBack(closeFn, {onNavigate}) → release()}
 * modal/sheet opts.keepOnRoute === true: the overlay survives a screen change (router uses closeAll({route:true})).
 * onBack: browser / Android back closes the topmost overlay instead of changing the route (modal/sheet use it
 * automatically; custom full-screen overlays call it themselves and call release() when they close otherwise).
 * A hash navigation started while an overlay is open (link / NC.app.go / location.hash) keeps the NEW route.
 * Elements returned by badge/signalBadge/demoBadge/disclaimer/emptyState stringify to their outerHTML,
 * so they work both with appendChild() and inside template literals. Global delegation:
 * any [data-call="115"] element dials via callNumber (demo numbers → toast).
 */
(function (NC) {
  'use strict';

  var U = NC.util;
  var h = U.h;
  var XLINK = 'http://www.w3.org/1999/xlink';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function t(k, v) { return NC.i18n ? NC.i18n.t(k, v) : k; }

  /* ---------- asset base (works from /index.html, /admin.html and /docs/*.html) ---------- */
  var BASE = (function () {
    try {
      var src = (document.currentScript && document.currentScript.src) || '';
      var i = src.indexOf('assets/js/core/ui.js');
      if (i >= 0) return src.slice(0, i);
    } catch (e) { /* ignore */ }
    return '';
  })();
  /** Resolve a project-relative asset path ('assets/img/…') from any page. */
  function assetUrl(path) { return BASE + String(path || '').replace(/^\.?\//, ''); }

  function stringable(el) {
    el.toString = function () { return this.outerHTML; };
    return el;
  }

  /* ================================================================== */
  /* ICONS                                                                */
  /* ================================================================== */
  /** SVG sprite reference as an HTML string. */
  function icon(name, cls) {
    var n = U.esc(name);
    return '<svg class="icon' + (cls ? ' ' + U.esc(cls) : '') + '" aria-hidden="true" focusable="false">' +
      '<use href="#i-' + n + '" xlink:href="#i-' + n + '"></use></svg>';
  }
  /** SVG sprite reference as an element. */
  function iconEl(name, cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    try { use.setAttributeNS(XLINK, 'xlink:href', '#i-' + name); } catch (e) { /* ignore */ }
    svg.appendChild(use);
    return svg;
  }

  /* ================================================================== */
  /* TOASTS                                                               */
  /* ================================================================== */
  var TOAST_ICON = { info: 'info', success: 'check-circle', warning: 'alert-triangle', danger: 'alert-circle' };
  var MAX_TOASTS = 4;

  function toastRoot() {
    var r = document.getElementById('toast-root');
    if (!r) {
      r = h('div', { id: 'toast-root', class: 'toast-root', 'aria-live': 'polite' });
      document.body.appendChild(r);
    }
    return r;
  }

  /**
   * Show a toast. opts: {type:'info'|'success'|'warning'|'danger', timeout=3500 (0 = sticky),
   * action:{label, onClick}, html:false}. Returns {close, el}.
   */
  function toast(msg, opts) {
    var o = opts || {};
    var type = TOAST_ICON[o.type] ? o.type : 'info';
    var timeout = o.timeout === undefined ? (o.action ? 6000 : 3500) : o.timeout;
    var root = toastRoot();
    var text = String(msg === undefined || msg === null ? '' : msg);

    // De-duplicate identical visible toasts: restart their timer instead of stacking.
    var dup = U.$$('.toast', root).filter(function (el) { return el._ncMsg === text && !el.classList.contains('is-out'); })[0];
    if (dup && dup._ncCtrl) { dup._ncCtrl.restart(); return dup._ncCtrl; }

    var el = h('div', { class: 'toast toast--' + type, role: type === 'danger' ? 'alert' : 'status' });
    el._ncMsg = text;
    el.appendChild(h('span', { class: 'toast__icon', html: icon(TOAST_ICON[type]) }));
    var msgEl = h('div', { class: 'toast__msg' });
    if (o.html) msgEl.innerHTML = text; else msgEl.textContent = text;
    el.appendChild(msgEl);
    var timer = null, closed = false;
    function close() {
      if (closed) return; closed = true;
      clearTimeout(timer);
      el.classList.remove('is-in'); el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
    function arm() { clearTimeout(timer); if (timeout > 0) timer = setTimeout(close, timeout); }
    if (o.action && o.action.label) {
      el.appendChild(h('button', {
        type: 'button', class: 'toast__action',
        'on:click': function () { try { if (o.action.onClick) o.action.onClick(); } finally { close(); } }
      }, o.action.label));
    }
    el.appendChild(h('button', {
      type: 'button', class: 'toast__close', 'aria-label': t('common.close'), html: icon('x'),
      'on:click': close
    }));
    el.addEventListener('mouseenter', function () { clearTimeout(timer); });
    el.addEventListener('mouseleave', arm);
    el.addEventListener('focusin', function () { clearTimeout(timer); });
    el.addEventListener('focusout', arm);

    root.appendChild(el);
    var all = U.$$('.toast:not(.is-out)', root);
    if (all.length > MAX_TOASTS && all[0]._ncCtrl) all[0]._ncCtrl.close();
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('is-in'); }); });
    arm();
    var ctrl = { el: el, close: close, restart: arm };
    el._ncCtrl = ctrl;
    return ctrl;
  }

  /* ================================================================== */
  /* SCROLL LOCK + INERT                                                  */
  /* ================================================================== */
  var lockCount = 0, savedY = 0;
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  function lockScroll() {
    if (lockCount++ > 0) return;
    var html = document.documentElement, body = document.body;
    savedY = window.pageYOffset || html.scrollTop || 0;
    var sbw = window.innerWidth - html.clientWidth;
    html.classList.add('is-locked');
    if (sbw > 0) body.style.paddingRight = sbw + 'px';
    if (isTouch) {
      body.style.position = 'fixed'; body.style.top = (-savedY) + 'px';
      body.style.left = '0'; body.style.right = '0'; body.style.width = '100%';
    }
  }
  function unlockScroll() {
    if (lockCount === 0) return;
    if (--lockCount > 0) return;
    var html = document.documentElement, body = document.body;
    html.classList.remove('is-locked');
    body.style.paddingRight = '';
    if (isTouch) {
      body.style.position = ''; body.style.top = ''; body.style.left = ''; body.style.right = ''; body.style.width = '';
      window.scrollTo(0, savedY);
    }
  }
  function setBackgroundInert(on) {
    ['app', 'screen-onboarding'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    });
  }

  /* ================================================================== */
  /* BACK BUTTON FOR OVERLAYS                                             */
  /* ================================================================== */
  /*
   * Each open overlay owns one history entry {ncOverlay:id} with the SAME URL as the page, so popping it never
   * fires hashchange → the router stays put. Before pushing it, the entry below is tagged {ncUnder:id}, so a popstate
   * can tell Back (landed below / on a live overlay's entry) from a NEW entry (a hash navigation or link started from
   * inside the overlay: its entry carries no tag). Back (browser / Android) closes the overlays above the landed entry;
   * a new route closes (NC.ui sheets/modals) or buries (custom overlays: their screen's hide() cleans up) every live
   * overlay and is left to the router (NOTES §3). release() pops the entry silently when the overlay closed another
   * way. Traversals we trigger ourselves are tracked in `pops`; new entries (and NC.app.go navigations) requested
   * while one is in flight wait until it has landed (history.back() is async — navigating before it lands would be
   * undone by it).
   * A stale overlay entry (its overlay closed by a route change, so it stayed buried under the new route) is skipped
   * in the direction the user was going: Forward from the entry tagged {ncUnder:id} right below it → skip forward
   * ('skipfwd'), anything else (Back from the newer route) → skip back. `curState` remembers the state of the entry
   * we were on, because a popstate only reports the state of the entry it landed on.
   */
  var backStack = [];          // [{id, fn, nav, pushed, done, queued}]
  var backSeq = 0;
  var pops = [];               // our own in-flight traversals: [{reason:'release'|'skip'|'skipfwd'|'forward', from:id|null, foreign?:href}]
  var popTimer = null;
  var afterPop = [];           // callbacks waiting for our traversals to land (NC.app.go defers through this)
  var lastHref = window.location.href;
  var ignoreHashAt = 0;        // a hashchange caused by an overlay traversal is expected until this time

  function histState() { try { return window.history.state; } catch (e) { return null; } }
  var curState = histState();  // state of the entry we are on (a popstate only tells where it landed)
  function noteState() { curState = histState(); }
  function isActiveEntry(id) {
    for (var i = 0; i < backStack.length; i++) { if (backStack[i].id === id && backStack[i].pushed && !backStack[i].done) return true; }
    return false;
  }
  function isObj(v) { return !!v && typeof v === 'object'; }
  /** Our tags on a history state (null when the entry carries none → an entry the page never tagged, e.g. a new one). */
  function tags(st) { return isObj(st) && (st.ncOverlay || st.ncUnder) ? st : null; }
  function pushEntry(entry) {
    // Tag the entry below (keeping its own state, e.g. onboarding steps): landing on it again means "Back".
    try {
      var cur = histState(), below = {};
      if (isObj(cur)) Object.keys(cur).forEach(function (k) { below[k] = cur[k]; });
      below.ncUnder = entry.id;
      window.history.replaceState(below, '', window.location.href);
    } catch (e) { /* the tag is a hint only: without it Back falls back to "close the top overlay" */ }
    try {
      window.history.pushState({ ncOverlay: entry.id }, '', window.location.href);
      entry.pushed = true;
      lastHref = window.location.href;
    } catch (e) { entry.pushed = false; }
    noteState();
  }
  function settle() {
    clearTimeout(popTimer);
    pops = [];
    backStack.forEach(function (en) { if (!en.done && !en.pushed && en.queued) { en.queued = false; pushEntry(en); } });
    var fns = afterPop; afterPop = [];
    fns.forEach(function (fn) { try { fn(); } catch (e) { console.error('[ui] deferred navigation failed', e); } });
  }
  function traverse(reason, from) {
    pops.push({ reason: reason, from: from || null });
    clearTimeout(popTimer);
    // Safety net: if a traversal never reports back (blocked / bfcache quirks), stop waiting after 1 s. A forward skip
    // with nothing ahead (the stale entry was the newest one) leaves us on that entry → step back below it instead.
    popTimer = setTimeout(function () {
      var stuck = reason === 'skipfwd' && pops.length === 1 && pops[0].reason === 'skipfwd';
      settle();
      if (stuck) { var cs = histState(); if (cs && cs.ncOverlay === from && !isActiveEntry(from)) traverse('skip', from); }
    }, 1000);
    try { if (reason === 'forward' || reason === 'skipfwd') window.history.forward(); else window.history.back(); }
    catch (e) { pops.pop(); if (!pops.length) settle(); }
  }
  /** Landed on the stale overlay entry `st`: skip it in the direction the user was travelling (prev = entry we left). */
  function skipStale(st, prev) {
    traverse(isObj(prev) && prev.ncUnder === st.ncOverlay ? 'skipfwd' : 'skip', st.ncOverlay);
  }
  function expectHashchange() { ignoreHashAt = Date.now() + 800; }

  /**
   * Make the browser/Android back button close an overlay.
   * @param {function} closeFn called (once) when the user presses back while this overlay is the topmost one
   * @param {{onNavigate?: function}} [opts] onNavigate: called (once, instead of closeFn) when a hash navigation to a
   *        new entry happens while the overlay is open (e.g. a link inside it); it must close WITHOUT navigating. Without
   *        it the overlay is only detached from the back button (its screen's hide() closes it on the route change).
   * @returns {function} release() — call when the overlay closes by other means (idempotent, never navigates)
   */
  function onBack(closeFn, opts) {
    if (!window.history || typeof window.history.pushState !== 'function') return function () {};
    var entry = {
      id: 'ov-' + (++backSeq) + '-' + Date.now().toString(36), fn: closeFn, nav: opts && typeof opts.onNavigate === 'function' ? opts.onNavigate : null,
      pushed: false, done: false, queued: false
    };
    backStack.push(entry);
    if (pops.length) entry.queued = true; else pushEntry(entry);
    return function release() {
      if (entry.done) return;
      entry.done = true;
      var i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      if (!entry.pushed) return;
      var st = histState();
      if (st && st.ncOverlay === entry.id && !pops.length) traverse('release', entry.id);
      // Otherwise the entry is buried under a route change or a pop is in flight: it is skipped when reached.
    };
  }

  /** Run fn once our own history traversals have landed (immediately when none is in flight). */
  function afterHistory(fn) {
    if (pops.length) afterPop.push(fn); else fn();
  }

  function liveEntries() { return backStack.filter(function (en) { return en.pushed && !en.done; }); }
  function liveIndex(live, id) {
    if (!id) return -1;
    for (var i = 0; i < live.length; i++) { if (live[i].id === id) return i; }
    return -1;
  }
  /* Close overlays whose history entries are gone: 'back' → their close handler; 'navigate' → onNavigate or bury. */
  function closeEntries(list, how) {
    list.slice().reverse().forEach(function (en) {
      if (en.done) return;
      en.done = true;
      var i = backStack.indexOf(en);
      if (i >= 0) backStack.splice(i, 1);
      var fn = how === 'back' ? en.fn : en.nav;
      if (!fn) return;
      try { fn(); } catch (err) { console.error('[ui] overlay ' + how + ' handler failed', err); }
    });
  }
  /* A hash navigation / link from inside an overlay landed on a NEW entry: the route change wins (router handles it). */
  function onForeignEntry(st, prev) {
    closeEntries(liveEntries(), 'navigate');
    if (st && st.ncOverlay && !isActiveEntry(st.ncOverlay)) skipStale(st, prev);
  }

  window.addEventListener('popstate', function (e) {
    var st = (e && e.state) || histState();
    var prev = curState;
    curState = st;
    var left = lastHref;
    var landed = window.location.href;
    lastHref = landed;
    var urlChanged = left !== landed;
    var keepUrl = function () {
      // The route on screen did not change → keep its URL on the entry we landed on (router ignores the hashchange).
      if (!urlChanged) return;
      expectHashchange();
      try { window.history.replaceState(st, '', left); lastHref = left; } catch (err) { /* ignore */ }
      noteState();
    };
    if (pops.length) {
      // A new, untagged entry at another URL is not where our own traversal lands (release/skip land on a tagged
      // entry): a hash navigation happened before our history.back() ran. Our traversal is still pending.
      if (pops[0].reason !== 'forward' && pops[0].reason !== 'skipfwd' && urlChanged && !tags(st)) {
        pops[0].foreign = landed;
        onForeignEntry(null);
        return;
      }
      var p = pops.shift();
      if (p.reason === 'release' && st && st.ncOverlay && st.ncOverlay === p.from) {
        // A navigation was pushed on top of the entry we were releasing before our back() ran: go forward to it.
        if (urlChanged) expectHashchange();
        traverse('forward', null);
        return;
      }
      if (p.foreign && p.reason !== 'forward') {
        // Our back() landed below a navigation that happened meanwhile (some browsers drop that entry, others keep
        // it forward of the released one): put the new route back on top — the router already shows it.
        if (p.foreign !== landed) {
          try { window.history.pushState(null, '', p.foreign); lastHref = p.foreign; noteState(); } catch (err) { /* ignore */ }
        }
      }
      else if (p.reason === 'forward') { if (urlChanged) expectHashchange(); }
      else if (p.reason === 'release') keepUrl();
      if (st && st.ncOverlay && !isActiveEntry(st.ncOverlay)) { traverse(p.reason === 'skip' || p.reason === 'skipfwd' ? p.reason : 'release', st.ncOverlay); return; }
      if (!pops.length) settle();
      return;
    }
    var live = liveEntries();
    if (live.length) {
      // Where did we land? k = index of the lowest live overlay to close (Back), -1 = a new entry / somewhere else.
      var k = -1;
      var on = isObj(st) ? liveIndex(live, st.ncOverlay) : -1;
      if (on >= 0) k = on + 1;                                                    // a live overlay's own entry
      else if (isObj(st) && liveIndex(live, st.ncUnder) >= 0) k = liveIndex(live, st.ncUnder);   // right below one
      else if (!urlChanged) k = live.length - 1;                                  // untagged, same URL: Back (as before)
      if (k >= 0) {
        if (k >= live.length) return;   // on the top overlay's own entry: nothing to close
        // User pressed back: close the overlay(s) whose entries were just left.
        keepUrl();
        closeEntries(live.slice(k), 'back');
        return;
      }
      onForeignEntry(st, prev);
      return;
    }
    // Landed on a stale overlay entry (overlay long gone) → skip it in the travel direction; the route change it
    // carried is real (Back from a newer route → below it; Forward from the entry below it → on to the newer route).
    if (st && st.ncOverlay && !isActiveEntry(st.ncOverlay)) skipStale(st, prev);
  });
  window.addEventListener('hashchange', function () { lastHref = window.location.href; noteState(); });

  /** Router hook: true (once) for a hashchange produced by an overlay traversal → do not navigate. */
  function consumeOverlayHashchange() {
    if (ignoreHashAt && Date.now() <= ignoreHashAt) { ignoreHashAt = 0; return true; }
    ignoreHashAt = 0;
    return false;
  }
  /** Router hook: keep our URL bookkeeping in sync after a history.replaceState done by the router. */
  function noteUrl() { lastHref = window.location.href; noteState(); }

  /* ================================================================== */
  /* SHEET / MODAL                                                        */
  /* ================================================================== */
  var stack = [];
  var seq = 0;
  var FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

  function focusables(root) {
    return U.$$(FOCUSABLE, root).filter(function (el) {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  }
  function isSheetMode() {
    return window.matchMedia ? window.matchMedia('(max-width: 767px)').matches : window.innerWidth < 768;
  }

  /**
   * Generic overlay. kind 'sheet' (bottom sheet on mobile, centered dialog ≥768px) or 'modal' (always centered).
   * opts: {title, subtitle, icon, iconVariant, body: Node|string(html)|fn(ctrl)→Node, actions:[{label, variant, icon,
   *        onClick(ev, ctrl) → false|Promise to keep open / show loading, close:true, value, autofocus}],
   *        size:'sm'|'md'|'lg', dismissible:true, className, onClose(value), ariaLabel, flush,
   *        keepOnRoute:false (true → stays open when the router changes screen; Back still closes it)}
   * Returns {el, panel, body, close(value), closed: Promise<value>}.
   */
  function overlay(kind, opts) {
    var o = opts || {};
    var dismissible = o.dismissible !== false;
    // keepOnRoute: survives a screen change (router closeAll({route:true}) and in-overlay hash links skip it).
    var keep = o.keepOnRoute === true;
    var id = 'nc-dlg-' + (++seq);
    var opener = document.activeElement;
    var resolveClosed;
    var closedP = new Promise(function (r) { resolveClosed = r; });
    var isClosed = false;

    var wrap = h('div', { class: [kind, kind + '--' + (o.size || 'md'), o.className] });
    var backdrop = h('div', { class: 'sheet__backdrop' });
    var panel = h('div', {
      class: ['sheet__panel', o.flush ? 'sheet__panel--flush' : null],
      role: o.role || 'dialog', 'aria-modal': 'true', tabindex: '-1'
    });
    if (o.title) panel.setAttribute('aria-labelledby', id + '-title');
    else if (o.ariaLabel) panel.setAttribute('aria-label', o.ariaLabel);

    if (kind === 'sheet') panel.appendChild(h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }));

    var ctrl = { el: wrap, panel: panel, body: null, closed: closedP, close: close, kind: kind, keepOnRoute: keep };

    if (o.title || dismissible) {
      var header = h('div', { class: 'sheet__header' });
      if (o.icon) header.appendChild(h('span', { class: 'icon-tile icon-tile--' + (o.iconVariant || 'primary'), html: icon(o.icon) }));
      var heading = h('div', { class: 'sheet__heading' });
      if (o.title) heading.appendChild(h('h2', { class: 'sheet__title', id: id + '-title' }, o.title));
      if (o.subtitle) heading.appendChild(h('p', { class: 'sheet__subtitle' }, o.subtitle));
      header.appendChild(heading);
      if (dismissible) {
        header.appendChild(h('button', {
          type: 'button', class: 'btn btn--ghost btn--icon sheet__close', 'aria-label': t('common.close'),
          html: icon('x'), 'on:click': function () { close(); }
        }));
      }
      panel.appendChild(header);
    }

    var body = h('div', { class: 'sheet__body' });
    ctrl.body = body;
    var content = typeof o.body === 'function' ? o.body(ctrl) : o.body;
    if (typeof content === 'string') body.innerHTML = content;
    else if (content && content.nodeType) body.appendChild(content);
    panel.appendChild(body);

    if (o.actions && o.actions.length) {
      var footer = h('div', { class: 'sheet__footer' });
      o.actions.forEach(function (a) {
        var btn = h('button', {
          type: 'button', class: 'btn btn--' + (a.variant || 'ghost'),
          'data-autofocus': a.autofocus ? '' : null, id: a.id || null, disabled: !!a.disabled
        });
        btn.innerHTML = (a.icon ? icon(a.icon) : '') + '<span>' + U.esc(a.label) + '</span>';
        btn.addEventListener('click', function (ev) {
          var r = a.onClick ? a.onClick(ev, ctrl) : undefined;
          if (r === false) return;
          if (r && typeof r.then === 'function') {
            setLoading(btn, true);
            r.then(function (res) {
              setLoading(btn, false);
              if (res !== false && a.close !== false) close(a.value);
            }, function (err) {
              setLoading(btn, false);
              console.error('[ui] action failed', err);
              toast((err && err.message) || t('common.error'), { type: 'danger' });
            });
            return;
          }
          if (a.close !== false) close(a.value);
        });
        footer.appendChild(btn);
      });
      panel.appendChild(footer);
    }

    wrap.appendChild(backdrop);
    wrap.appendChild(panel);
    (document.getElementById('sheet-root') || document.body).appendChild(wrap);

    /* ---- interactions ---- */
    backdrop.addEventListener('click', function () { if (dismissible) close(); });
    var onKey = function (e) {
      if (stack[stack.length - 1] !== ctrl) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (dismissible) { e.preventDefault(); e.stopPropagation(); close(); }
      } else if (e.key === 'Tab') {
        var f = focusables(panel);
        if (!f.length) { e.preventDefault(); panel.focus(); return; }
        var first = f[0], last = f[f.length - 1], from = document.activeElement, back = e.shiftKey;
        if (back && (from === first || from === panel)) { e.preventDefault(); last.focus(); }
        else if (!back && from === last) { e.preventDefault(); first.focus(); }
        else if (!panel.contains(from)) { e.preventDefault(); first.focus(); }
        else {
          // Native move (keeps radio groups etc.). Engines that leave links out of the Tab order (WebKit / Safari
          // default) can step out of the panel to <body>: put focus back on the neighbour in our own list.
          setTimeout(function () {
            if (stack[stack.length - 1] !== ctrl || panel.contains(document.activeElement)) return;
            var list = focusables(panel), i = list.indexOf(from);
            var to = list.length ? list[((i < 0 ? 0 : i) + (back ? list.length - 1 : 1)) % list.length] : panel;
            try { to.focus(); } catch (err) { /* ignore */ }
          }, 0);
        }
      }
    };
    // Listen on document: focus may sit on <body> after a re-render inside the panel.
    document.addEventListener('keydown', onKey, true);

    // Swipe down to close (mobile bottom sheet only).
    if (kind === 'sheet' && dismissible) {
      var drag = null;
      panel.addEventListener('touchstart', function (e) {
        if (!isSheetMode() || e.touches.length !== 1) return;
        var fromHandle = !!(e.target.closest && e.target.closest('.sheet__handle, .sheet__header'));
        if (!fromHandle && body.scrollTop > 0) return;
        if (e.target.closest && e.target.closest('input, textarea, select, [data-no-swipe], .leaflet-container')) return;
        drag = { y0: e.touches[0].clientY, dy: 0, t0: Date.now(), active: false };
      }, { passive: true });
      panel.addEventListener('touchmove', function (e) {
        if (!drag) return;
        var dy = e.touches[0].clientY - drag.y0;
        if (!drag.active) {
          if (dy < -4) { drag = null; return; }
          if (dy > 8) { drag.active = true; wrap.classList.add('is-dragging'); }
        }
        if (drag.active) {
          drag.dy = Math.max(0, dy);
          panel.style.transform = 'translateY(' + drag.dy + 'px)';
          if (e.cancelable) e.preventDefault();
        }
      }, { passive: false });
      var endDrag = function () {
        if (!drag) return;
        var d = drag; drag = null;
        if (!d.active) return;
        wrap.classList.remove('is-dragging');
        var velocity = d.dy / Math.max(1, Date.now() - d.t0);
        if (d.dy > 110 || velocity > 0.7) close();
        else panel.style.transform = '';
      };
      panel.addEventListener('touchend', endDrag);
      panel.addEventListener('touchcancel', endDrag);
    }

    /* ---- open ---- */
    if (!stack.length) setBackgroundInert(true);
    stack.push(ctrl);
    lockScroll();
    // Browser / Android back closes this overlay (non-dismissible ones stay and re-arm their entry).
    var releaseBack = function () {};
    var armBack = function () {
      releaseBack = onBack(function () {
        if (isClosed) return;
        if (dismissible) close();
        else armBack();
      }, {
        // A route opened from inside the overlay (link, "Settings" action, toast action…) closes it, like closeAll().
        // keepOnRoute overlays stay open over the new screen and re-arm Back on the new entry (after the popstate
        // bookkeeping of the navigation has finished).
        onNavigate: function () {
          if (isClosed) return;
          if (keep) { setTimeout(function () { if (!isClosed) armBack(); }, 0); return; }
          close();
        }
      });
    };
    if (o.back !== false) armBack();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wrap.classList.add('is-open');
        var target = panel.querySelector('[data-autofocus], [autofocus]');
        try { (target || panel).focus({ preventScroll: true }); } catch (e) { (target || panel).focus(); }
      });
    });

    function close(value) {
      if (isClosed) return closedP;
      isClosed = true;
      releaseBack();
      panel.style.transform = '';
      wrap.classList.remove('is-open');
      wrap.classList.add('is-closing');
      var i = stack.indexOf(ctrl);
      if (i >= 0) stack.splice(i, 1);
      var done = false;
      document.removeEventListener('keydown', onKey, true);
      var finish = function () {
        if (done) return; done = true;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        unlockScroll();
        if (!stack.length) setBackgroundInert(false);
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
          try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        try { if (o.onClose) o.onClose(value); } catch (e) { console.error(e); }
        resolveClosed(value);
      };
      panel.addEventListener('transitionend', function (e) { if (e.target === panel) finish(); });
      setTimeout(finish, 450);
      return closedP;
    }

    return ctrl;
  }

  function sheet(opts) { return overlay('sheet', opts); }
  function modal(opts) { return overlay('modal', opts); }
  /** Close every open sheet/modal. opts.route → router screen change: overlays opened with keepOnRoute stay. */
  function closeAll(opts) {
    var route = !!(opts && opts.route);
    stack.slice().reverse().forEach(function (c) { if (!(route && c.keepOnRoute)) c.close(); });
  }
  /** Router hook: a screen change while the scroll is locked (an overlay stays open) restores to y on unlock. */
  function lockedScrollTo(y) {
    if (!lockCount) return;
    savedY = Math.max(0, y || 0);
    if (isTouch) document.body.style.top = (-savedY) + 'px';
  }

  /**
   * Confirmation dialog → Promise<boolean>.
   * opts: {title, message (text), html (trusted), confirmLabel, cancelLabel, danger, icon}
   */
  function confirmDialog(opts) {
    var o = opts || {};
    var body = h('div', { class: 'confirm__body' });
    if (o.html) body.innerHTML = o.html;
    else if (o.message) body.appendChild(h('p', { class: 'confirm__msg' }, o.message));
    var ctrl = modal({
      title: o.title || t('common.confirm'),
      icon: o.icon || (o.danger ? 'alert-triangle' : null),
      iconVariant: o.danger ? 'danger' : 'primary',
      size: 'sm', body: body, className: 'confirm',
      actions: [
        { label: o.cancelLabel || t('common.cancel'), variant: 'ghost', value: false },
        { label: o.confirmLabel || t('common.confirm'), variant: o.danger ? 'danger' : 'primary', value: true, autofocus: !o.danger }
      ]
    });
    return ctrl.closed.then(function (v) { return v === true; });
  }

  /* ================================================================== */
  /* HOLD TO CONFIRM                                                      */
  /* ================================================================== */
  /**
   * Press-and-hold interaction with an animated fill (CSS var --hold 0..1).
   * Keyboard: hold Enter/Space for `ms`, or press Enter twice quickly. Returns {reset, destroy}.
   */
  function holdToConfirm(btn, ms, onDone) {
    if (!btn) return { reset: function () {}, destroy: function () {} };
    var dur = ms || 1200;
    var fill = btn.querySelector('.hold__fill');
    if (!fill) { fill = h('span', { class: 'hold__fill', 'aria-hidden': 'true' }); btn.insertBefore(fill, btn.firstChild); }
    btn.classList.add('hold');
    if (!btn.getAttribute('title')) btn.setAttribute('title', t('common.hold_kbd'));
    if (!btn.querySelector('.visually-hidden.hold__sr')) btn.appendChild(h('span', { class: 'visually-hidden hold__sr' }, ' — ' + t('common.hold_kbd')));

    var raf = 0, start = 0, holding = false, done = false, downAt = 0, lastKeyUp = 0, keyHeld = false;
    var now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };
    function setP(p) { btn.style.setProperty('--hold', String(p)); }
    function tick() {
      raf = requestAnimationFrame(function () {
        if (!holding) return;
        var p = Math.min(1, (now() - start) / dur);
        setP(p);
        if (p >= 1) finish(); else tick();
      });
    }
    function begin() {
      if (btn.disabled || done || holding) return;
      holding = true; start = now(); downAt = Date.now();
      btn.classList.add('is-holding');
      U.vibrate(8);
      tick();
    }
    function cancel(showHint) {
      if (!holding) return;
      holding = false; cancelAnimationFrame(raf);
      btn.classList.remove('is-holding');
      setP(0);
      if (showHint && Date.now() - downAt < 350) toast(t('common.hold_hint'), { type: 'info', timeout: 2200 });
    }
    function finish() {
      holding = false; done = true; cancelAnimationFrame(raf);
      btn.classList.remove('is-holding'); btn.classList.add('is-done');
      setP(1);
      U.vibrate([30, 40, 30]);
      try { if (onDone) onDone(); }
      catch (e) { console.error('[ui] holdToConfirm handler failed', e); }
      setTimeout(reset, 900);
    }
    function reset() { done = false; holding = false; btn.classList.remove('is-done', 'is-holding'); setP(0); }

    var onDown = function (e) { if (e.button !== undefined && e.button !== 0) return; begin(); };
    var onUp = function () { cancel(true); };
    var onLeave = function () { cancel(false); };
    var onCtx = function (e) { e.preventDefault(); };
    var onClick = function (e) { e.preventDefault(); };
    var onKeyDown = function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      if (e.repeat || keyHeld) return;
      keyHeld = true;
      if (e.key === 'Enter' && Date.now() - lastKeyUp < 450 && !done) { finish(); return; }
      begin();
    };
    var onKeyUp = function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      keyHeld = false; lastKeyUp = Date.now();
      cancel(false);
    };
    var usePointer = !!window.PointerEvent;
    if (usePointer) {
      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointerleave', onLeave);
      btn.addEventListener('pointercancel', onLeave);
    } else {
      btn.addEventListener('touchstart', onDown, { passive: true });
      btn.addEventListener('touchend', onUp);
      btn.addEventListener('mousedown', onDown);
      btn.addEventListener('mouseup', onUp);
      btn.addEventListener('mouseleave', onLeave);
    }
    btn.addEventListener('contextmenu', onCtx);
    btn.addEventListener('click', onClick);
    btn.addEventListener('keydown', onKeyDown);
    btn.addEventListener('keyup', onKeyUp);
    btn.addEventListener('blur', onLeave);

    return {
      reset: reset,
      destroy: function () {
        cancel(false);
        ['pointerdown', 'mousedown', 'touchstart'].forEach(function (ev) { btn.removeEventListener(ev, onDown); });
        ['pointerup', 'mouseup', 'touchend'].forEach(function (ev) { btn.removeEventListener(ev, onUp); });
        ['pointerleave', 'pointercancel', 'mouseleave', 'blur'].forEach(function (ev) { btn.removeEventListener(ev, onLeave); });
        btn.removeEventListener('contextmenu', onCtx); btn.removeEventListener('click', onClick);
        btn.removeEventListener('keydown', onKeyDown); btn.removeEventListener('keyup', onKeyUp);
        btn.classList.remove('hold');
      }
    };
  }

  /* ================================================================== */
  /* MEDICAL DISCLAIMER / EMPTY STATE / BADGES                            */
  /* ================================================================== */
  /** Standard medical disclaimer + 115 button (contract §0). Text auto-updates on language change. */
  function disclaimer(opts) {
    var o = opts || {};
    var compact = !!o.compact;
    var el = h('aside', { class: 'disclaimer' + (compact ? ' disclaimer--compact' : ''), role: 'note' });
    el.appendChild(h('span', { class: 'disclaimer__icon', html: icon(compact ? 'info' : 'alert-circle') }));
    if (!compact) el.appendChild(h('p', { class: 'disclaimer__title', 'data-i18n': 'common.disclaimer_title' }, t('common.disclaimer_title')));
    el.appendChild(h('p', { class: 'disclaimer__body', 'data-i18n': 'common.disclaimer_body' }, t('common.disclaimer_body')));
    if (!compact) {
      el.appendChild(h('p', { class: 'disclaimer__roam', html: icon('signal') + '<span data-i18n="common.roaming_note">' + U.esc(t('common.roaming_note')) + '</span>' }));
    }
    var actions = h('div', { class: 'disclaimer__actions' });
    actions.appendChild(h('a', {
      class: 'btn btn--danger btn--sm', href: 'tel:115', 'data-call': '115',
      html: icon('phone') + '<span data-i18n="common.call_115">' + U.esc(t('common.call_115')) + '</span>'
    }));
    el.appendChild(actions);
    return stringable(el);
  }

  /**
   * Empty state. opts: {icon, title, text, illustration:true|'assets/img/illustrations/x.svg',
   * action:{label, onClick, href, variant, icon}, compact}
   */
  function emptyState(opts) {
    var o = opts || {};
    var el = h('div', { class: 'empty-state' + (o.compact ? ' empty-state--compact' : '') });
    if (o.illustration) {
      var src = typeof o.illustration === 'string' ? o.illustration : 'assets/img/illustrations/empty-state.svg';
      el.appendChild(h('img', { class: 'empty-state__art', src: assetUrl(src), alt: '', width: '220', height: '113', loading: 'lazy' }));
    } else {
      el.appendChild(h('span', { class: 'icon-tile icon-tile--lg icon-tile--' + (o.variant || 'neutral'), html: icon(o.icon || 'compass') }));
    }
    if (o.title) el.appendChild(h('p', { class: 'empty-state__title' }, o.title));
    if (o.text) el.appendChild(h('p', { class: 'empty-state__text' }, o.text));
    if (o.action && o.action.label) {
      var a = o.action;
      var tag = a.href ? 'a' : 'button';
      var btn = h(tag, {
        class: 'btn btn--' + (a.variant || 'primary') + ' empty-state__action',
        type: a.href ? null : 'button', href: a.href || null,
        html: (a.icon ? icon(a.icon) : '') + '<span>' + U.esc(a.label) + '</span>'
      });
      if (a.onClick) btn.addEventListener('click', a.onClick);
      el.appendChild(btn);
    }
    return stringable(el);
  }

  /** Small status badge. variant: success|warning|danger|info|neutral|primary|accent|demo|solid. */
  function badge(text, variant, iconName) {
    var el = h('span', { class: 'badge' + (variant ? ' badge--' + variant : '') });
    if (iconName) el.innerHTML = icon(iconName);
    el.appendChild(document.createTextNode(String(text === undefined || text === null ? '' : text)));
    return stringable(el);
  }

  var SIG_LEVELS = ['likely', 'uncertain', 'lost'];
  /** 3-level signal badge with dot + bilingual label. level: likely|uncertain|lost. */
  function signalBadge(level, opts) {
    var lv = SIG_LEVELS.indexOf(level) >= 0 ? level : 'uncertain';
    var el = h('span', { class: 'badge badge--sig badge--sig-' + lv, 'data-level': lv });
    el.appendChild(h('span', { class: 'signal-dot signal-dot--' + lv, 'aria-hidden': 'true' }));
    el.appendChild(h('span', { 'data-i18n': 'common.sig.' + lv }, t('common.sig.' + lv)));
    if (opts && opts.title) el.setAttribute('title', opts.title);
    return stringable(el);
  }

  /** "Dữ liệu minh hoạ" badge for illustrative (is_demo) records. */
  function demoBadge() {
    var el = h('span', {
      class: 'badge badge--demo', title: t('common.demo_data_hint'),
      'data-i18n-attr': 'title:common.demo_data_hint'
    });
    el.innerHTML = icon('info') + '<span data-i18n="common.demo_data">' + U.esc(t('common.demo_data')) + '</span>';
    return stringable(el);
  }

  /* ================================================================== */
  /* PHONE                                                                */
  /* ================================================================== */
  var DEMO_PHONE = /\+84\s?000\s?000/;
  /** → {href: 'tel:…'|null, isDemo, display}. Demo numbers use the invalid pattern +84 000 000 0NN. */
  function formatPhoneAction(phone) {
    var raw = String(phone === undefined || phone === null ? '' : phone).replace(/\s+/g, ' ').trim();
    var isDemo = DEMO_PHONE.test(raw);
    var digits = raw.replace(/[^\d+]/g, '');
    return { href: (!isDemo && digits) ? 'tel:' + digits : null, isDemo: isDemo, display: raw };
  }
  /** Dial a number (tel:). Demo numbers never dial — a toast explains instead. */
  function callNumber(phone) {
    var f = formatPhoneAction(phone);
    if (!f.display) return false;
    if (f.isDemo) {
      toast(t('common.demo_call', { num: f.display }), { type: 'warning', timeout: 4000 });
      return false;
    }
    if (!f.href) return false;
    var a = document.createElement('a');
    a.href = f.href; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
    toast(t('common.calling', { num: f.display }), { type: 'info', timeout: 2400 });
    return true;
  }

  /* ================================================================== */
  /* SMALL HELPERS                                                        */
  /* ================================================================== */
  /** Toggle the loading state of a button (keeps its width, shows a spinner). */
  function setLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!on);
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    btn.disabled = !!on;
  }

  /**
   * Wire a .segmented (or any [role=radiogroup]) container: click selects one .segmented__btn/[data-value].
   * opts: {onChange(value, btn), value}. Returns {set(value), get()}.
   */
  function segmented(container, opts) {
    var o = opts || {};
    var sel = '.segmented__btn, [data-value]';
    function set(v) {
      U.$$(sel, container).forEach(function (b) {
        var on = b.getAttribute('data-value') === String(v);
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.setAttribute('role', 'radio');
        b.setAttribute('tabindex', on ? '0' : '-1');
      });
    }
    function get() { var b = container.querySelector('.is-selected'); return b ? b.getAttribute('data-value') : null; }
    container.setAttribute('role', 'radiogroup');
    container.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest(sel) : null;
      if (!b || !container.contains(b) || b.disabled) return;
      var v = b.getAttribute('data-value');
      if (v === get()) return;
      set(v);
      if (o.onChange) o.onChange(v, b);
    });
    container.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
      var btns = U.$$(sel, container).filter(function (b) { return !b.disabled; });
      var i = btns.indexOf(container.querySelector('.is-selected'));
      var n = btns[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length];
      if (n) { e.preventDefault(); n.click(); n.focus(); }
    });
    if (o.value !== undefined) set(o.value);
    else { var cur = get(); if (cur !== null) set(cur); }
    return { set: set, get: get };
  }

  /* ---------- global delegation: [data-call] ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-call]') : null;
    if (!el || el.disabled) return;
    e.preventDefault();
    callNumber(el.getAttribute('data-call'));
  });

  /**
   * How a Buddy alert for session s reaches its recipient (round 2 honesty rule):
   * 'email' — a real e-mail goes out (Supabase mode + recipient_email + not a reserved demo domain);
   * 'sim'   — e-mail present but only simulated (local build, or a reserved demo address);
   * 'phone' — no e-mail: the server cannot alert anyone, only the on-device SMS reaches the contact.
   * Copy may say "đã gửi" / "người nhận sẽ được báo" only for 'email'.
   */
  function alertChannel(s) {
    if (!s || !s.recipient_email) return 'phone';
    if (!NC.data || NC.data.mode !== 'supabase') return 'sim';
    var sh = NC.backend && NC.backend.shared;
    return sh && sh.isReservedEmail && sh.isReservedEmail(s.recipient_email) ? 'sim' : 'email';
  }

  NC.ui = {
    icon: icon, iconEl: iconEl, toast: toast, alertChannel: alertChannel,
    modal: modal, sheet: sheet, confirm: confirmDialog, closeAll: closeAll,
    holdToConfirm: holdToConfirm, disclaimer: disclaimer, emptyState: emptyState,
    badge: badge, signalBadge: signalBadge, demoBadge: demoBadge,
    formatPhoneAction: formatPhoneAction, callNumber: callNumber,
    assetUrl: assetUrl, setLoading: setLoading, segmented: segmented,
    lockScroll: lockScroll, unlockScroll: unlockScroll, onBack: onBack, _lockedScrollTo: lockedScrollTo,
    openCount: function () { return stack.length; },
    /** Router hook: true while handling a popstate/hashchange that only closed an overlay (do not navigate). */
    afterHistory: afterHistory, historyBusy: function () { return pops.length > 0; },
    consumeOverlayHashchange: consumeOverlayHashchange, _noteUrl: noteUrl
  };
})(window.NC = window.NC || {});
