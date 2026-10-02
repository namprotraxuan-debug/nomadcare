/*
 * shell.test.js — node --test suite for the round-2 shell contract C1 (owner: W2 shell).
 * 1. core/theme-init.js: the 'nc.nav_collapsed' localStorage mirror sets html.nc-nav-collapsed before first paint.
 * 2. core/ui.js: NC.ui.modal/sheet opts.keepOnRoute survive the router's closeAll({route:true}); a plain
 *    closeAll() still closes everything.
 * Both files run in a vm sandbox with a tiny fake DOM (no browser needed).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- theme-init.js ---------- */
function runThemeInit(store, search) {
  const html = { className: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const ctx = {
    document: { documentElement: html },
    window: { location: { search: search || '' }, localStorage: { getItem: (k) => (k in store ? store[k] : null) } }
  };
  vm.createContext(ctx);
  vm.runInContext(read('assets/js/core/theme-init.js'), ctx);
  return html;
}

test('theme-init: nav_collapsed mirror → html.nc-nav-collapsed pre-paint (theme/lang unchanged)', () => {
  const on = runThemeInit({ 'nc.nav_collapsed': '1', 'nc.theme': 'dark', 'nc.lang': 'en' });
  assert.match(on.className, /\bnc-nav-collapsed\b/);
  assert.match(on.className, /\bnc-js\b/);
  assert.equal(on.attrs['data-theme'], 'dark');
  assert.equal(on.attrs.lang, 'en');
  const off = runThemeInit({ 'nc.nav_collapsed': '0' });
  assert.doesNotMatch(off.className, /nc-nav-collapsed/);
  assert.equal(off.attrs['data-theme'], 'auto');
  const none = runThemeInit({});
  assert.doesNotMatch(none.className, /nc-nav-collapsed/);
});

/* ---------- ui.js keepOnRoute ---------- */
function fakeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, style: {}, parentNode: null, listeners: {},
    classList: { set: new Set(), add(...c) { c.forEach((x) => this.set.add(x)); }, remove(...c) { c.forEach((x) => this.set.delete(x)); }, contains(c) { return this.set.has(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); } },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); c.parentNode = null; return c; },
    insertBefore(c) { return el.appendChild(c); },
    setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
    removeAttribute(k) { delete el.attrs[k]; }, hasAttribute(k) { return k in el.attrs; },
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); }, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, contains() { return false; },
    getClientRects() { return []; }, offsetWidth: 0, offsetHeight: 0
  };
  Object.defineProperty(el, 'innerHTML', { set() {}, get() { return ''; } });
  return el;
}
function loadUi() {
  const body = fakeEl('body');
  const htmlEl = fakeEl('html');
  htmlEl.scrollTop = 0; htmlEl.clientWidth = 390;
  const history = { state: null, length: 1, pushState() { this.length++; }, replaceState() {}, back() {}, forward() {} };
  const document = {
    currentScript: null, body, documentElement: htmlEl, activeElement: null,
    addEventListener() {}, removeEventListener() {}, getElementById: () => null, contains: () => true,
    createElement: fakeEl, createElementNS: (ns, t) => fakeEl(t)
  };
  const ctx = {
    console, Date, Math, JSON, Promise, setTimeout, clearTimeout,
    location: { href: 'http://127.0.0.1/index.html#/home', hash: '#/home' }, history, navigator: { maxTouchPoints: 0 },
    addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (fn) => setTimeout(fn, 0),
    matchMedia: () => ({ matches: true }), innerWidth: 390, pageYOffset: 0, scrollTo() {}, document
  };
  ctx.window = ctx;
  const h = (tag, attrs, text) => {
    const el = fakeEl(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.indexOf('on:') === 0) el.addEventListener(k.slice(3), v);
      else if (k === 'class') el.attrs.class = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k !== 'html') el.setAttribute(k, v);
    });
    if (text !== undefined) el.textContent = String(text);
    return el;
  };
  ctx.NC = { util: { h, esc: (s) => String(s), $$: () => [], vibrate() {} } };
  vm.createContext(ctx);
  vm.runInContext(read('assets/js/core/ui.js'), ctx, { filename: 'assets/js/core/ui.js' });
  return ctx.NC.ui;
}

test('ui: keepOnRoute overlays survive closeAll({route:true}); closeAll() closes them', async () => {
  const ui = loadUi();
  const keep = ui.modal({ title: 'Dead zone ahead', body: '', keepOnRoute: true });
  const plain = ui.sheet({ title: 'Plain', body: '' });
  assert.equal(keep.keepOnRoute, true);
  assert.equal(plain.keepOnRoute, false);
  assert.equal(ui.openCount(), 2);
  let plainClosed = false;
  plain.closed.then(() => { plainClosed = true; });
  ui.closeAll({ route: true });
  await sleep(500);
  assert.equal(plainClosed, true, 'the plain sheet closes on a screen change');
  assert.equal(ui.openCount(), 1, 'the keepOnRoute modal stays open');
  ui.closeAll();
  await sleep(500);
  assert.equal(ui.openCount(), 0, 'an explicit closeAll() still closes it');
});
