/*
 * theme-init.js — anti-flash theme/lang/nav bootstrap, loaded WITHOUT defer in <head>.
 * Owner: P1 shell. Reads localStorage 'nc.theme' ('auto'|'light'|'dark') and 'nc.lang', or ?theme=
 * from the URL, and sets html[data-theme] / html[lang] before first paint. 'nc.nav_collapsed' === '1'
 * (mirror of NC.settings 'nav_collapsed') adds html.nc-nav-collapsed (desktop sidebar → icon rail). No globals.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var theme = 'auto';
  var lang = null;
  var navCollapsed = false;
  try {
    var m = /[?&]theme=(auto|light|dark)\b/.exec(window.location.search);
    theme = m ? m[1] : (window.localStorage.getItem('nc.theme') || 'auto');
    var l = /[?&]lang=(vi|en)\b/.exec(window.location.search);
    lang = l ? l[1] : window.localStorage.getItem('nc.lang');
    navCollapsed = window.localStorage.getItem('nc.nav_collapsed') === '1';
  } catch (e) { /* storage blocked (private mode / file://) → defaults */ }
  if (theme !== 'light' && theme !== 'dark') theme = 'auto';
  root.setAttribute('data-theme', theme);
  if (lang === 'vi' || lang === 'en') root.setAttribute('lang', lang);
  root.className += (root.className ? ' ' : '') + 'nc-js' + (navCollapsed ? ' nc-nav-collapsed' : '');
})();
