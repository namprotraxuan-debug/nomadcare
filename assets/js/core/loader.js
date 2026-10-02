/*
 * loader.js — on-demand <script> loader (owner: P1 shell). Used to load large vendor bundles only when a feature
 * needs them (e.g. supabase-js only when a Supabase backend is configured), keeping first load light.
 * Public API: NC.loader.{script(src, {timeout}) → Promise<void>, base}
 *   src: project-relative path ('assets/vendor/…') resolved against this file's own location, so it works from
 *   /index.html, /admin.html, /tools/tests/*.html and file://; absolute URLs are used as-is. Requests are de-duplicated.
 *   Rejects with an Error {code:'load_failed'|'timeout', src}.
 */
(function (NC) {
  'use strict';

  var BASE = (function () {
    try {
      var src = (document.currentScript && document.currentScript.src) || '';
      var i = src.indexOf('assets/js/core/loader.js');
      if (i >= 0) return src.slice(0, i);
    } catch (e) { /* ignore */ }
    return '';
  })();

  var pending = {};

  function resolve(src) {
    var s = String(src || '');
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(s)) return s;
    return BASE + s.replace(/^\.?\//, '');
  }

  function fail(code, url, msg) {
    var e = new Error(msg || ('Could not load ' + url));
    e.code = code; e.src = url;
    return e;
  }

  /**
   * Load a classic script once. Resolves when it has executed.
   * @param {string} src
   * @param {{timeout?:number}} [opts] default 20 s
   * @returns {Promise<void>}
   */
  function script(src, opts) {
    var url = resolve(src);
    if (pending[url]) return pending[url];
    var ms = (opts && opts.timeout) || 20000;
    pending[url] = new Promise(function (ok, ko) {
      var done = false;
      var el = document.createElement('script');
      var timer = setTimeout(function () { finish(fail('timeout', url, 'Timed out loading ' + url)); }, ms);
      function finish(errObj) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        el.onload = el.onerror = null;
        if (errObj) {
          delete pending[url];
          if (el.parentNode) el.parentNode.removeChild(el);
          ko(errObj);
        } else ok();
      }
      el.src = url;
      el.async = true;
      el.onload = function () { finish(null); };
      el.onerror = function () { finish(fail('load_failed', url)); };
      (document.head || document.documentElement).appendChild(el);
    });
    return pending[url];
  }

  NC.loader = { script: script, base: BASE, resolve: resolve };
})(window.NC = window.NC || {});
