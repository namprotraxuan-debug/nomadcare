/*
 * page-app.js — declares the page role before any other script runs (loaded WITHOUT defer in <head> of index.html).
 * Owner: P1 shell. Sets window.NC_PAGE = 'app': only 'app' pages flush the device outbox and run the Buddy
 * dead-man tick (NC.data elects one flusher among several app tabs). admin.html loads page-admin.js instead.
 * Kept as an external file (no inline script) so a strict Content-Security-Policy can stay script-src 'self'.
 */
(function (root) {
  'use strict';
  root.NC_PAGE = 'app';
})(window);
