/*
 * page-admin.js — declares the page role for admin.html (loaded WITHOUT defer in <head>, after theme-init.js).
 * Owner: P1 shell. window.NC_PAGE = 'admin': NC.data never flushes the traveller device outbox and never runs the
 * Buddy tick on this page (the admin API NC.data.admin.* is unaffected).
 */
(function (root) {
  'use strict';
  root.NC_PAGE = 'admin';
})(window);
