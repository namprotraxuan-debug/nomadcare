/*
 * ui-history.test.js — node --test suite for the overlay back-button logic of assets/js/core/ui.js (owner: client-core).
 * Loads the real ui.js in a vm sandbox with a small session-history model (pushState/replaceState, async traversals,
 * fragment navigations that fire popstate synchronously and hashchange asynchronously, like WebKit/Firefox) and a
 * minimal hash router that behaves like NC.app (consumeOverlayHashchange, go() deferred through afterHistory).
 * Covers FIX_CONTRACT A9 (Back closes the top overlay, release() never navigates) and wave3d NOTES §3 (a hash
 * navigation started from inside an open overlay keeps the NEW route).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const UI_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/core/ui.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(30);

function page(startHash) {
  const BASE = 'http://127.0.0.1/index.html';
  const listeners = { popstate: [], hashchange: [] };
  const entries = [{ url: BASE + startHash, state: null }];
  let idx = 0;
  const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const hashOf = (u) => { const i = u.indexOf('#'); return i >= 0 ? u.slice(i) : ''; };
  const resolve = (u) => (!u ? entries[idx].url : (u.indexOf('http') === 0 ? u : (u[0] === '#' ? BASE + u : BASE + hashOf(u))));
  function fire(type, ev) { listeners[type].slice().forEach((fn) => fn(Object.assign({ type }, ev || {}))); }
  function fragmentNavigate(url) {
    if (url === entries[idx].url) return;
    entries.splice(idx + 1);
    entries.push({ url, state: null });
    idx++;
    fire('popstate', { state: null });                 // synchronous, as in the HTML spec
    setTimeout(() => fire('hashchange', {}), 0);        // queued
  }
  function traverse(delta) {
    setTimeout(() => {
      const to = idx + delta;
      if (to < 0 || to >= entries.length) return;
      const old = entries[idx].url;
      idx = to;
      fire('popstate', { state: clone(entries[idx].state) });
      if (hashOf(old) !== hashOf(entries[idx].url)) setTimeout(() => fire('hashchange', {}), 0);
    }, 1);
  }
  const location = {
    get href() { return entries[idx].url; },
    get hash() { return hashOf(entries[idx].url); },
    set hash(v) { fragmentNavigate(BASE + (v[0] === '#' ? v : '#' + v)); },
    get pathname() { return '/index.html'; },
    get search() { return ''; },
    replace(u) { entries[idx] = { url: resolve(u), state: null }; }
  };
  const history = {
    get state() { return clone(entries[idx].state); },
    get length() { return entries.length; },
    pushState(s, _t, u) { entries.splice(idx + 1); entries.push({ url: resolve(u), state: clone(s) }); idx++; },
    replaceState(s, _t, u) { entries[idx] = { url: resolve(u), state: clone(s) }; },
    back() { traverse(-1); },
    forward() { traverse(1); },
    go(d) { traverse(d || 0); }
  };
  const ctx = {
    console, Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    location, history, navigator: { maxTouchPoints: 0 },
    addEventListener: (type, fn) => { if (listeners[type]) listeners[type].push(fn); },
    removeEventListener: (type, fn) => { if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    matchMedia: () => ({ matches: true }),
    document: { currentScript: null, addEventListener() { }, removeEventListener() { }, getElementById: () => null, documentElement: { classList: { toggle() { } } } }
  };
  ctx.window = ctx;
  ctx.NC = { util: { h: () => ({}), esc: (s) => String(s), $$: () => [] } };
  vm.createContext(ctx);
  vm.runInContext(UI_SRC, ctx, { filename: 'assets/js/core/ui.js' });
  const ui = ctx.NC.ui;
  // Minimal NC.app router (same hooks as assets/js/app/app.js).
  const app = { route: location.hash, routes: [location.hash] };
  listeners.hashchange.push(() => {
    if (ui.consumeOverlayHashchange()) return;
    if (location.hash !== app.route) { app.route = location.hash; app.routes.push(app.route); }
  });
  app.go = function go(hash) {
    if (ui.historyBusy()) { ui.afterHistory(() => go(hash)); return; }
    location.hash = hash;
  };
  return { ui, app, location, history, entries: () => entries.map((e) => hashOf(e.url) + (e.state && e.state.ncOverlay ? '*' : '')), index: () => idx };
}

/* An overlay registered like NC.ui.sheet does (closeFn + onNavigate) or like a custom full-screen one (closeFn only). */
function overlay(p, withNav) {
  const o = { back: 0, nav: 0, open: true };
  o.release = p.ui.onBack(() => { o.back++; o.open = false; }, withNav ? { onNavigate: () => { o.nav++; o.open = false; } } : undefined);
  o.close = () => { o.open = false; o.release(); };
  return o;
}

test('Back closes the top overlay only; the route and its URL stay', async () => {
  const p = page('#/home');
  const a = overlay(p, true);
  const b = overlay(p, true);
  assert.equal(p.history.length, 3);
  p.history.back(); await settle();
  assert.deepEqual([a.back, b.back, a.nav, b.nav], [0, 1, 0, 0]);
  assert.equal(p.location.hash, '#/home');
  p.history.back(); await settle();
  assert.deepEqual([a.back, b.back], [1, 1]);
  assert.equal(p.app.route, '#/home');
  assert.deepEqual(p.app.routes, ['#/home'], 'router never navigated');
});

test('release() pops the overlay entry silently; the next Back leaves the route', async () => {
  const p = page('#/map');
  p.app.go('#/home'); await settle();
  const a = overlay(p, true);
  a.close(); await settle();
  assert.equal(p.index(), 1, 'overlay entry popped');
  assert.equal(p.app.route, '#/home');
  p.history.back(); await settle();
  assert.equal(p.app.route, '#/map');
  assert.equal(a.back + a.nav, 0);
});

test('hash navigation from inside an open sheet keeps the NEW route (link / NC.app.go / location.hash)', async () => {
  const p = page('#/map');
  const s = overlay(p, true);
  p.location.hash = '#/settings';          // e.g. "Cài đặt khác" calling go() before the sheet closes
  await settle();
  assert.equal(s.nav, 1, 'sheet closed through onNavigate');
  assert.equal(s.back, 0, 'not treated as Back');
  assert.equal(p.location.hash, '#/settings');
  assert.equal(p.app.route, '#/settings');
  // Back from the new route: the buried overlay entry is skipped → previous route
  p.history.back(); await settle(); await settle();
  assert.equal(p.app.route, '#/map');
  assert.equal(p.location.hash, '#/map');
  s.release(); await settle();
  assert.equal(p.location.hash, '#/map', 'a late release() never navigates');
});

test('a custom overlay without onNavigate is buried (no handler runs); a toast action while a sheet is open wins', async () => {
  const p = page('#/qr?view=rescuer');
  const rescuer = overlay(p, false);
  const sheet = overlay(p, true);
  p.app.go('#/firstaid?item=anaphylaxis'); await settle();
  assert.equal(p.app.route, '#/firstaid?item=anaphylaxis');
  assert.deepEqual([sheet.nav, sheet.back, rescuer.nav, rescuer.back], [1, 0, 0, 0]);
  const len = p.history.length;
  rescuer.release(); await settle();   // its screen's hide() releases it later
  assert.equal(p.history.length, len);
  assert.equal(p.location.hash, '#/firstaid?item=anaphylaxis');
});

test('close then navigate (release in flight + fragment navigation / deferred NC.app.go)', async () => {
  const p = page('#/home');
  const a = overlay(p, true);
  a.close();                               // history.back() queued
  p.location.hash = '#/map';               // a link's default action right after its click handler closed the sheet
  await settle(); await settle();
  assert.equal(p.location.hash, '#/map');
  assert.equal(p.app.route, '#/map');
  p.history.back(); await settle(); await settle();
  assert.equal(p.app.route, '#/home', 'back returns to the screen the sheet was opened on');
  const b = overlay(p, true);
  b.close();
  p.app.go('#/settings');                  // deferred until the overlay entry is popped
  await settle(); await settle();
  assert.equal(p.app.route, '#/settings');
  assert.deepEqual(p.entries().slice(-2), ['#/home', '#/settings'], 'clean back stack: ' + p.entries().join(' '));
});

test('a multi-step traversal (history.go(-2)) from an open sheet lands on the older route and closes the sheet', async () => {
  const p = page('#/map');
  p.app.go('#/buddy'); await settle();
  const s = overlay(p, true);
  p.history.go(-2); await settle(); await settle();
  assert.equal(p.app.route, '#/map');
  assert.equal(s.open, false);
  assert.equal(s.back + s.nav, 1);
});

test('entry state of the page below is kept (onboarding step tags) and a non-overlay popstate at the same URL still means Back', async () => {
  const p = page('#/onboarding?step=2');
  p.history.replaceState({ ncOb: { sid: 'x', idx: 1 } }, '', p.location.href);
  const a = overlay(p, true);
  p.history.back(); await settle();
  assert.equal(a.back, 1);
  assert.deepEqual(p.history.state.ncOb, { sid: 'x', idx: 1 }, 'onboarding tag preserved');
  assert.equal(p.app.route, '#/onboarding?step=2');
});
