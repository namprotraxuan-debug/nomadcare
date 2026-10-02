/*
 * firstaid.js — MOD.05 offline first-aid library content (owner: P1 firstaid). Pure data, no DOM access (one guarded
 * NC.icons.add call, see “Side effect”).
 * Public API: window.NC_FIRSTAID = { version, updated, review, sources[], categories[], items[], kit[], kit_sources[] }
 * (also module.exports in Node for tests). Consumed by assets/js/app/mod05-firstaid.js.
 * All text is written in the team's own words (IFRC/ERC texts are copyrighted); every illustration is an
 * original flat SVG (viewBox 0 0 240 140) coloured ONLY through .ill-* classes so the UI can theme it.
 * Item: { id, category, icon, priority, special?, title, keywords:{vi[],en[]}, summary, call115, steps[{text, ill, detail?}],
 *         red_flags:{vi[],en[]}, donts:{vi[],en[]}, sources[id], related[id], video_query, updated } — {vi,en} texts.
 * Source: { id, short, short_en?, year|null, title, title_en, publisher, scope, note, supplementary? } — year null = the
 *         edition is not fixed yet (UI shows “year TBC”); never invent one.
 * Side effect: registers the 'bottle' glyph (poisoning) via NC.icons.add when the sprite lacks it (same glyph as phrases.js).
 *
 * ─── 1.1.0-demo (2026-09-28) — internal medical review, still round 1 (not signed off) ───
 * New items: asthma, poisoning (methanol / fake alcohol, wild mushrooms, pesticides, charcoal fumes), nosebleed,
 * electric shock & lightning, eye injuries & chemicals, jellyfish & marine stings, high fever & suspected dengue.
 * Fixes: choking call-115 timing + infant chest-thrust technique; tourniquet first-line + second tourniquet + haemostatic
 * gauze; stroke “last known well”; aspirin dose in mg (VN tablet sizes); heatstroke cooling end point + folk-practice
 * don'ts; 4–5 sugar cubes; rabies immunoglobulin, boosters, herpes B, herbal “rabies cures”; krait / folk-practice /
 * rescue-breath snakebite points; drowning → 115 + 114; burn call-115 aligned with MOD.01 (hands → same-day care);
 * sources: short_en + title_en everywhere, supplementary WHO documents; kit_sources; search keywords extended.
 * 2026-09-29 (same version, no guidance change): natural search phrasings (heavy bleeding, road accident, “bò cạp”,
 * “đột quị”, “con vật cắn”, “nghẹt thở”) and a snakebite video search without “immobilise” (it surfaced pressure bandaging).
 */
(function (root) {
  'use strict';

  /* ======================================================================================
   * 1. ILLUSTRATION KIT
   * Colour classes (fills): ill-bg ill-skin (casualty) ill-skin-2 (helper) ill-cloth (casualty)
   *   ill-cloth-2 (helper) ill-accent ill-primary ill-danger ill-water ill-muted ill-white.
   * Stroke class: ill-line (fill:none, ink colour). Stroke widths are set per element by attribute,
   * so the stylesheet must NOT set stroke-width on .ill-line. Unclassed shapes inside a classed <g>
   * inherit its fill, so never colour "svg *" generically. Suggested theme (light | dark), e.g. in
   * modules/firstaid.css:  .ill-bg var(--c-surface-2) · .ill-skin #F2C3A0|#E0AF8C · .ill-skin-2 #D39A74|#B9825E
   *   · .ill-cloth #6E8FD6|#5877B8 · .ill-cloth-2 #2F7F75|#2A8D80 · .ill-line {fill:none; stroke:#23403D|#CFE3E0}
   *   · .ill-accent var(--c-accent) · .ill-primary var(--c-primary) · .ill-danger var(--c-danger)
   *   · .ill-water #5AB4F0|#4AA3E0 · .ill-muted #9DB0AE|#5E7573 · .ill-white #FFFFFF|#E8F0EF
   * Item/category `icon` values are names from the NC.icons sprite (assets/js/core/icons.js).
   * ==================================================================================== */

  /** Round to one decimal and stringify (keeps the SVG strings short). */
  function n(v) { return String(Math.round(v * 10) / 10); }
  function cl(c) { return c ? ' class="' + c + '"' : ''; }

  /** Attribute helper that skips zero coordinates (SVG default) to keep strings short. */
  function xy(a, b, v1, v2) { return (v1 ? ' ' + a + '="' + n(v1) + '"' : '') + (v2 ? ' ' + b + '="' + n(v2) + '"' : ''); }
  function rect(c, x, y, w, h, rx, ex) {
    return '<rect' + cl(c) + xy('x', 'y', x, y) + ' width="' + n(w) + '" height="' + n(h) + '"' + (rx ? ' rx="' + n(rx) + '"' : '') + (ex || '') + '/>';
  }
  function circle(c, cx, cy, r, ex) { return '<circle' + cl(c) + xy('cx', 'cy', cx, cy) + ' r="' + n(r) + '"' + (ex || '') + '/>'; }
  function ellipse(c, cx, cy, rx, ry, ex) {
    return '<ellipse' + cl(c) + xy('cx', 'cy', cx, cy) + ' rx="' + n(rx) + '" ry="' + n(ry) + '"' + (ex || '') + '/>';
  }
  function path(c, d, ex) { return '<path' + cl(c) + ' d="' + d + '"' + (ex || '') + '/>'; }
  /** Filled polygon from a flat [x1, y1, x2, y2, ...] list. */
  function polygon(c, pts) {
    var out = [];
    for (var i = 0; i < pts.length; i += 2) out.push(n(pts[i]) + ',' + n(pts[i + 1]));
    return '<polygon' + cl(c) + ' points="' + out.join(' ') + '"/>';
  }
  /** Ink stroke (class ill-line). */
  function line(d, w, ex) { return '<path class="ill-line" fill="none" stroke-width="' + (w || 3) + '" d="' + d + '"' + (ex || '') + '/>'; }
  /** Ink outline group: children inherit fill:none + stroke. */
  function outline(inner, w) { return '<g class="ill-line" fill="none" stroke-width="' + (w || 2) + '">' + inner + '</g>'; }
  function group(inner, t, c) { return '<g' + cl(c) + (t ? ' transform="' + t + '"' : '') + '>' + inner + '</g>'; }
  function move(x, y, inner) { return group(inner, 'translate(' + n(x) + ' ' + n(y) + ')'); }

  /** Capsule ("thick limb") from (x1,y1) to (x2,y2), width w — a rotated rounded rect (fill only). */
  function cap(c, x1, y1, x2, y2, w) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.round(Math.sqrt(dx * dx + dy * dy));
    var ang = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
    var h = w / 2;
    // Axis-aligned capsules are emitted as plain rects (shorter strings, no transform).
    if (ang === 0 || ang === 180) return rect(c, Math.min(x1, x2) - h, y1 - h, len + w, w, h);
    if (ang === 90 || ang === -90) return rect(c, x1 - h, Math.min(y1, y2) - h, w, len + w, h);
    return rect(c, x1 - h, y1 - h, len + w, w, h, ' transform="rotate(' + ang + ' ' + n(x1) + ' ' + n(y1) + ')"');
  }

  /** Filled arrow from (x1,y1) to (x2,y2); w = shaft width. */
  function arrow(x1, y1, x2, y2, w, c) {
    w = w || 6;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len, px = -uy, py = ux;
    var hl = w * 2, hw = w * 1.35, s = w / 2;
    var bx = x2 - ux * hl, by = y2 - uy * hl;
    return polygon(c || 'ill-accent', [x1 + px * s, y1 + py * s, bx + px * s, by + py * s, bx + px * hw, by + py * hw, x2, y2,
      bx - px * hw, by - py * hw, bx - px * s, by - py * s, x1 - px * s, y1 - py * s]);
  }

  /** Root element + rounded background. */
  function svg(inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">' +
      rect('ill-bg', 0, 0, 240, 140, 18) + inner + '</svg>';
  }

  var GROUND = rect('ill-muted', 16, 113, 208, 5, 2.5, ' opacity=".5"');

  /* Item icon the shell sprite (core/icons.js) does not ship — Lucide-style 24×24 stroke glyph, identical to the one in
     phrases.js (whichever data file loads first registers it; an existing name is never overridden). */
  var EXTRA_ICONS = {
    'bottle': '<path d="M10 2h4"/><path d="M10.5 2v4.2L8.3 8.6A3 3 0 0 0 7.5 10.7V20a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-9.3a3 3 0 0 0-.8-2.1l-2.2-2.4V2"/><path d="M7.5 12h9"/><path d="M12 14.5V17"/><path d="M12 19.5h.01"/>'
  };

  /* ---------- 1a. Icons (absolute coordinates) ---------- */

  /** Red call badge with a phone; waves = sound arcs to the right. */
  function phone(cx, cy, noWaves) {
    return circle('ill-danger', cx, cy, 17) + rect('ill-white', cx - 6, cy - 10, 12, 20, 3) + rect('ill-danger', cx - 3, cy + 5, 6, 2, 1) +
      (noWaves ? '' : line('M' + (cx + 23) + ' ' + (cy - 7) + 'a10 10 0 0 1 0 14M' + (cx + 29) + ' ' + (cy - 13) + 'a18 18 0 0 1 0 26', 3));
  }
  /** Clock dial; frac (0..1) paints an accent wedge for the elapsed time (1 = full turn). */
  function clock(cx, cy, r, frac) {
    var out = circle('ill-white', cx, cy, r);
    if (frac) {
      var rr = r - 4, a = Math.min(frac, 0.999) * 2 * Math.PI;
      out += path('ill-accent', 'M' + n(cx) + ' ' + n(cy) + 'V' + n(cy - rr) + 'A' + rr + ' ' + rr + ' 0 ' + (frac > 0.5 ? 1 : 0) +
        ' 1 ' + n(cx + rr * Math.sin(a)) + ' ' + n(cy - rr * Math.cos(a)) + 'Z', ' opacity=".55"');
    }
    return out + outline(circle(0, cx, cy, r) + path(0, 'M' + n(cx) + ' ' + n(cy - r * 0.55) + 'V' + n(cy) + 'l' + n(r * 0.4) + ' ' + n(r * 0.25)), 3);
  }
  /** "Do not" badge: red disc with a white cross. */
  function noBadge(cx, cy, r) {
    r = r || 13;
    var a = r * 0.55;
    return circle('ill-danger', cx, cy, r) +
      group(rect(0, -a, -1.8, 2 * a, 3.6, 1.8) + rect(0, -1.8, -a, 3.6, 2 * a, 1.8), 'translate(' + n(cx) + ' ' + n(cy) + ')rotate(45)', 'ill-white');
  }
  /** "OK" badge: teal disc with a white check mark. */
  function okBadge(cx, cy, r) {
    r = r || 13;
    return circle('ill-primary', cx, cy, r) +
      group(polygon(0, [-8.1, 0.1, -2, 6.1, 8.1, -3.9, 5.9, -6.1, -2, 1.9, -5.9, -2.1]),
        'translate(' + n(cx) + ' ' + n(cy) + ')scale(' + n(r / 13 * 0.95) + ')', 'ill-white');
  }
  /** Teardrop, tip up; c = ill-water / ill-danger / ill-accent. */
  function drop(c, cx, cy, s) {
    return path(c, 'M' + n(cx) + ' ' + n(cy - s) + 'C' + n(cx + s * 0.9) + ' ' + n(cy + s * 0.05) + ' ' + n(cx + s * 0.75) + ' ' + n(cy + s * 0.9) + ' ' +
      n(cx) + ' ' + n(cy + s * 0.9) + 'S' + n(cx - s * 0.9) + ' ' + n(cy + s * 0.05) + ' ' + n(cx) + ' ' + n(cy - s) + 'Z');
  }
  function heart(c, cx, cy, s) {
    return path(c, 'M' + n(cx) + ' ' + n(cy + s * 0.9) + 'C' + n(cx - s * 1.3) + ' ' + n(cy) + ' ' + n(cx - s * 0.9) + ' ' + n(cy - s) + ' ' +
      n(cx) + ' ' + n(cy - s * 0.4) + 'C' + n(cx + s * 0.9) + ' ' + n(cy - s) + ' ' + n(cx + s * 1.3) + ' ' + n(cy) + ' ' + n(cx) + ' ' + n(cy + s * 0.9) + 'Z');
  }
  /** Small medical building with a red cross; (x, y) = top-left of the wall, 56 × 42. */
  function hospital(x, y) {
    return rect('ill-primary', x - 5, y - 9, 66, 12, 4) + rect('ill-white', x, y, 56, 42, 3) +
      rect('ill-danger', x + 24, y + 6, 8, 20, 1.5) + rect('ill-danger', x + 18, y + 12, 20, 8, 1.5) + rect('ill-muted', x + 22, y + 30, 12, 12, 2);
  }
  /** Automated external defibrillator: teal case, white heart, orange bolt; (x, y) top-left, 50 × 40. */
  function aed(x, y, noHandle) {
    return (noHandle ? '' : rect('ill-primary', x + 16, y - 6, 18, 9, 4)) + rect('ill-primary', x, y, 50, 40, 8) + heart('ill-white', x + 25, y + 21, 12) +
      polygon('ill-accent', [x + 27, y + 11, x + 20, y + 23, x + 25, y + 23, x + 23, y + 31, x + 30, y + 19, x + 25, y + 19]);
  }
  /** Water tap; (x, y) = spout mouth; stream ends at y + len. */
  function tap(x, y, len) {
    return rect('ill-muted', x - 34, y - 16, 38, 11, 5) + rect('ill-muted', x - 6, y - 16, 12, 18, 4) + rect('ill-muted', x - 24, y - 26, 10, 12, 3) +
      rect('ill-water', x - 4, y + 2, 8, len, 4, ' opacity=".85"');
  }
  /** Cold pack wrapped in cloth. */
  function ice(x, y, w, h) {
    return rect('ill-white', x - 3, y - 3, w + 6, h + 6, 8) + rect('ill-water', x, y, w, h, 6) + rect('ill-white', x + 5, y + 4, w * 0.35, 3.5, 1.75);
  }
  /** Plain water cup (white glass, blue water). */
  function cup(x, y) {
    return polygon('ill-white', [x, y, x + 34, y, x + 29, y + 44, x + 5, y + 44]) + polygon('ill-water', [x + 3, y + 15, x + 31, y + 15, x + 28.5, y + 41, x + 5.5, y + 41]);
  }
  /** Sugar cubes (three). */
  function cubes(x, y, s) {
    s = s || 22;
    var r = rect(0, x, y + s + 4, s, s, 3) + rect(0, x + s + 4, y + s + 4, s, s, 3) + rect(0, x + s / 2 + 2, y, s, s, 3);
    return group(r, '', 'ill-white') + outline(r, 2);
  }
  function thermometer(x, y) {
    return rect('ill-white', x - 6, y, 12, 50, 6) + outline(rect(0, x - 6, y, 12, 50, 6), 2) + circle('ill-danger', x, y + 52, 9) + rect('ill-danger', x - 2.5, y + 16, 5, 36, 2.5);
  }
  function eye(cx, cy, s) {
    var d = 'M' + n(cx - 30 * s) + ' ' + cy + 'Q' + cx + ' ' + n(cy - 26 * s) + ' ' + n(cx + 30 * s) + ' ' + cy + 'Q' + cx + ' ' + n(cy + 26 * s) + ' ' + n(cx - 30 * s) + ' ' + cy + 'Z';
    return path('ill-white', d) + line(d, 3) + circle('ill-primary', cx, cy, 10 * s) + line('M' + cx + ' ' + cy + 'h0', n(8 * s));
  }
  /** Speech bubble with a squiggle (speech); zig = true for a broken/slurred line. */
  function bubble(x, y, w, h, zig) {
    var sq = zig ? 'M' + (x + 12) + ' ' + (y + h / 2) + 'l8-8 6 14 7-12 5 8 8-10 6 14' : 'M' + (x + 12) + ' ' + (y + h / 2) + 'q6-8 12 0t12 0t12 0';
    return rect('ill-white', x, y, w, h, 12) + polygon('ill-white', [x + 12, y + h - 2, x + 4, y + h + 12, x + 26, y + h - 2]) + line(sq, 3);
  }
  function sun(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 16; i++) {
      var a = i * Math.PI / 8, rr = i % 2 ? r + 2 : r + 9;
      pts.push(cx + rr * Math.sin(a), cy - rr * Math.cos(a));
    }
    return polygon('ill-accent', pts) + circle('ill-accent', cx, cy, r);
  }
  function snow(cx, cy, r) {
    var bar = rect(0, -r, -2, 2 * r, 4, 2);
    return group(bar + group(bar, 'rotate(60)') + group(bar, 'rotate(120)'), 'translate(' + cx + ' ' + cy + ')', 'ill-water');
  }
  /** Adrenaline auto-injector (vertical): (x, y) = top-left, 14 × 58, orange tip at the bottom. */
  function pen(x, y) {
    return rect('ill-primary', x, y, 14, 48, 5) + rect('ill-white', x + 4, y + 8, 6, 18, 2) + rect('ill-accent', x + 2, y + 46, 10, 10, 3);
  }
  function bee(cx, cy) {
    return ellipse('ill-white', cx, cy - 9, 10, 5) + ellipse('ill-accent', cx, cy, 11, 7) +
      line('M' + (cx - 3) + ' ' + (cy - 6) + 'v12M' + (cx + 3) + ' ' + (cy - 6) + 'v12', 2.5);
  }
  function gauze(x, y, w, h) { return rect('ill-white', x, y, w, h, 3); }
  /** Adhesive plaster with a pad. */
  function plaster(x, y, w, h) { return rect('ill-white', x, y, w, h, h / 2) + rect('ill-muted', x + w / 2 - 10, y + 4, 20, h - 8, 3, ' opacity=".6"'); }
  /** Red wound mark. */
  function wound(cx, cy, rx) { return ellipse('ill-danger', cx, cy, rx || 11, 4); }
  function bite(cx, cy) { return circle('ill-danger', cx - 5, cy, 2.6) + circle('ill-danger', cx + 5, cy, 2.6); }
  /** Reliever inhaler ("puffer"): (x, y) = top-left of the grey canister; blue boot, mouthpiece pointing left. */
  function inhaler(x, y) {
    return rect('ill-muted', x + 4, y, 12, 22, 4) + rect('ill-water', x, y + 16, 20, 34, 7) + rect('ill-water', x - 12, y + 36, 16, 14, 5);
  }
  /** Wild mushroom (red cap, white spots); (cx, cy) = centre of the cap's rim; s = scale. */
  function mushroom(cx, cy, s) {
    s = s || 1;
    return rect('ill-white', cx - 6 * s, cy - 2, 12 * s, 22 * s, 5 * s) +
      path('ill-danger', 'M' + n(cx - 20 * s) + ' ' + n(cy) + 'a' + n(20 * s) + ' ' + n(17 * s) + ' 0 0 1 ' + n(40 * s) + ' 0z') +
      circle('ill-white', cx - 8 * s, cy - 8 * s, 3 * s) + circle('ill-white', cx + 7 * s, cy - 11 * s, 2.5 * s) + circle('ill-white', cx + 4 * s, cy - 3 * s, 2 * s);
  }
  /** Liquor bottle (clear glass, orange label); (x, y) = top-left of the neck, 24 × 61. */
  function bottle(x, y) {
    var d = 'M' + (x + 8) + ' ' + (y + 6) + 'h8v10l7 8v32a5 5 0 0 1-5 5H' + (x + 6) + 'a5 5 0 0 1-5-5V' + (y + 24) + 'l7-8z';
    return rect('ill-muted', x + 8, y, 8, 8, 2) + path('ill-white', d) + rect('ill-accent', x + 1, y + 32, 22, 14) + line(d, 1.5);
  }
  /** Jellyfish: translucent bell over three wavy tentacles; (cx, cy) = centre of the bell's rim. */
  function jelly(cx, cy) {
    return line('M' + (cx - 11) + ' ' + cy + 'q-6 10 0 20t0 20M' + cx + ' ' + cy + 'q6 10 0 20t0 20M' + (cx + 11) + ' ' + cy + 'q-6 10 0 20t0 20', 2.5) +
      path('ill-cloth', 'M' + (cx - 20) + ' ' + (cy + 2) + 'a20 18 0 0 1 40 0z', ' opacity=".85"');
  }
  /** Storm cloud with a lightning bolt; (cx, cy) = centre of the cloud. */
  function storm(cx, cy) {
    return group(circle(0, cx - 16, cy + 4, 14) + circle(0, cx + 4, cy - 6, 19) + circle(0, cx + 24, cy + 4, 13) + rect(0, cx - 30, cy + 4, 67, 14, 7), '', 'ill-muted') +
      polygon('ill-accent', [cx + 2, cy + 18, cx - 10, cy + 42, cx - 1, cy + 42, cx - 8, cy + 66, cx + 12, cy + 34, cx + 3, cy + 34, cx + 10, cy + 18]);
  }
  /** Small lightning bolt (danger: electricity); (x, y) = top point, 16 × 34. */
  function bolt(x, y) { return polygon('ill-accent', [x, y, x - 10, y + 18, x - 3, y + 18, x - 9, y + 34, x + 6, y + 12, x - 1, y + 12, x + 5, y]); }
  /** Wall socket (white plate, round face, two slots); (x, y) = top-left, 46 × 58. */
  function socket(x, y) {
    return rect('ill-white', x, y, 46, 58, 8) + line('M' + x + ' ' + (y + 8) + 'a8 8 0 0 1 8-8h30a8 8 0 0 1 8 8v42a8 8 0 0 1-8 8H' + (x + 8) + 'a8 8 0 0 1-8-8z', 1.5) +
      circle('ill-muted', x + 23, y + 29, 14) + rect('ill-white', x + 15, y + 23, 4, 12, 2) + rect('ill-white', x + 27, y + 23, 4, 12, 2);
  }
  /** Mosquito in side view (ink body and legs, pale wings). */
  function mosquito(cx, cy) {
    return ellipse('ill-white', cx - 3, cy - 8, 9, 4, ' opacity=".9"') + ellipse('ill-white', cx + 5, cy - 9, 8, 3.5, ' opacity=".9"') +
      line('M' + (cx - 12) + ' ' + cy + 'h20l8-3', 3.5) + line('M' + (cx - 7) + ' ' + cy + 'l-6 9M' + (cx - 1) + ' ' + cy + 'l-2 10M' + (cx + 5) + ' ' + cy + 'l4 9', 1.5);
  }

  /* ---------- 1b. People & body parts ---------- */

  /**
   * Casualty lying on the back (side view, head left); origin = head centre.
   * o.legsUp (legs on a backpack), o.blanket, o.noArm.
   */
  function supine(x, y, o) {
    o = o || {};
    var legs = o.legsUp
      ? rect('ill-accent', 92, -16, 30, 28, 7) + cap('ill-muted', 64, -2, 120, -22, 18) + cap('ill-skin', 122, -24, 126, -40, 8)
      : rect('ill-muted', 64, -10, 66, 20, 10) + rect('ill-skin', 125, -20, 9, 18, 4.5);
    return move(x, y, legs + rect('ill-cloth', 10, -12, 60, 24, 12) + (o.noArm ? '' : rect('ill-skin', 18, 3, 46, 7, 3.5)) +
      (o.blanket ? rect('ill-accent', 14, -15, 118, 27, 13) : '') + circle('ill-skin', 0, 0, 11));
  }
  /** Helper kneeling on the far side: torso + head (drawn BEFORE the casualty). */
  function helperBack(hx, hy) { return rect('ill-cloth-2', hx - 14, hy + 10, 28, 64, 13) + circle('ill-skin-2', hx, hy, 10); }
  /** Helper's two arms (one V-shaped polygon) from the shoulders to a target point + hands (drawn AFTER the casualty). */
  function helperArms(hx, hy, tx, ty) {
    return polygon('ill-skin-2', [hx - 13, hy + 15, hx - 5, hy + 15, tx, ty - 7, hx + 5, hy + 15, hx + 13, hy + 15, tx + 5, ty, tx - 5, ty]) +
      ellipse('ill-skin-2', tx, ty, 9, 4.5);
  }
  /** Standard CPR scene: helper with straight arms on the casualty's chest. */
  function cprBase() { return GROUND + helperBack(82, 24) + supine(48, 99, { noArm: 1 }) + helperArms(82, 24, 80, 85); }

  /**
   * Standing person, front view; (x, y) = head centre, feet at y + 78.
   * o.alt (helper colours), o.la / o.ra = [x, y] left/right hand (false = hidden arm), o.le / o.re = elbow,
   * o.lean = degrees (bend forward at the hips).
   */
  function stand(x, y, o) {
    o = o || {};
    var sk = o.alt ? 'ill-skin-2' : 'ill-skin', cc = o.alt ? 'ill-cloth-2' : 'ill-cloth';
    function arm(sx, e, hnd) {
      if (hnd === false) return '';
      return e ? cap(0, sx, y + 17, e[0], e[1], 7) + cap(0, e[0], e[1], hnd[0], hnd[1], 7) : cap(0, sx, y + 17, hnd[0], hnd[1], 7);
    }
    var legs = path('ill-muted', 'M' + n(x - 11) + ' ' + n(y + 44) + 'h9.5v29.3a4.75 4.75 0 0 1-9.5 0zm12.5 0h9.5v29.3a4.75 4.75 0 0 1-9.5 0z');
    var top = rect(cc, x - 12, y + 12, 24, 36, 10) + group(circle(0, x, y, 10) +
      arm(x - 15, o.le, o.la === undefined ? [x - 15, y + 46] : o.la) + arm(x + 15, o.re, o.ra === undefined ? [x + 15, y + 46] : o.ra), '', sk);
    return legs + (o.lean ? group(top, 'rotate(' + o.lean + ' ' + x + ' ' + (y + 46) + ')') : top);
  }
  /** Seated person (side view, facing right); origin = head centre. o.pack = backrest, o.hand = [x, y] local hand. */
  function sit(x, y, o) {
    o = o || {};
    var hand = o.hand || [26, 34];
    return move(x, y, (o.pack ? rect('ill-accent', -30, 20, 24, 42, 8) : '') +
      group(cap(0, 0, 51, 31, 51, 13) + cap(0, 32, 51, 32, 78, 11), '', 'ill-muted') + cap('ill-cloth', -1, 16, -1, 48, 22) +
      group(circle(0, 0, 0, 10) + cap(0, 3, 20, 13, 38, 7) + cap(0, 13, 38, hand[0], hand[1], 7), '', 'ill-skin') + (o.extra || ''));
  }
  /** Seated person leaning forward with a hand on the thigh (asthma / nosebleed posture), facing right; origin as sit(). */
  function leanSit(x, y) {
    return move(x, y, group(cap(0, 0, 51, 31, 51, 13) + cap(0, 32, 51, 32, 78, 11), '', 'ill-muted') +
      group(cap('ill-cloth', -1, 16, -1, 48, 22) + group(circle(0, 0, 0, 10) + cap(0, 3, 20, 18, 34, 7) + cap(0, 18, 34, 28, 44, 7), '', 'ill-skin'), 'rotate(20 0 50)'));
  }
  /** Recovery position seen from above (lying on the side); origin = head centre. */
  function recov(x, y) {
    return move(x, y,
      group(cap(0, 60, -4, 122, -4, 15) + cap(0, 60, 5, 88, 26, 15) + cap(0, 88, 26, 120, 26, 13), '', 'ill-muted') +
      cap('ill-skin', 22, -8, 22, -34, 7) + rect('ill-cloth', 8, -13, 58, 26, 13) +
      group(cap(0, 17, 8, 8, 25, 7) + cap(0, 8, 25, -8, 13, 7) + ellipse(0, -10, 10, 7, 5) + circle(0, 0, 0, 11), '', 'ill-skin'));
  }
  /** Casualty on the back seen from above (recovery-position steps 1–3); v = 1 | 2 | 3. */
  function topView(x, y, v) {
    var farLeg = v >= 3 ? cap(0, 62, -8, 92, -30, 15) + cap(0, 92, -30, 118, -12, 13) : cap(0, 62, -8, 128, -8, 15);
    var farArm = v >= 2 ? cap(0, 18, -15, 38, 2, 7) + cap(0, 38, 2, 8, 10, 7) : cap(0, 18, -18, 58, -18, 7);
    return move(x, y, group(farLeg + cap(0, 62, 8, 128, 8, 15), '', 'ill-muted') + group(cap(0, 18, 17, 18, 40, 7) + cap(0, 18, 40, -4, 40, 7), '', 'ill-skin') +
      rect('ill-cloth', 10, -16, 56, 32, 14) + group(farArm + circle(0, 0, 0, 11), '', 'ill-skin'));
  }
  /** Forearm lying flat (elbow left, hand right); y = top edge, 22 high. */
  function forearm(y) {
    return rect('ill-cloth', 14, y - 4, 44, 30, 13) + rect('ill-skin', 48, y, 124, 22, 11) + ellipse('ill-skin', 180, y + 11, 18, 13) + ellipse('ill-skin', 175, y - 3, 9, 5);
  }
  /** Lower leg lying flat (knee left, foot pointing up at right); y = top edge, 24 high. */
  function shin(y) {
    return rect('ill-muted', 14, y - 4, 48, 32, 14) + rect('ill-skin', 50, y, 124, 24, 12) + rect('ill-skin', 162, y - 22, 20, 46, 10);
  }
  /** Foot seen from the side (heel left); (x, y) = ankle. */
  function foot(x, y) { return rect('ill-skin', x - 12, y - 58, 24, 62, 12) + rect('ill-skin', x - 16, y - 10, 82, 24, 12) + rect('ill-muted', x - 16, y - 70, 32, 26, 10); }
  /** Two stacked helper hands pressing down at (x, y), arm reaching in from the top-left. */
  function press(x, y) {
    return cap('ill-cloth-2', x - 12, y - 32, x - 28, -12, 18) + cap('ill-skin-2', x - 4, y - 8, x - 14, y - 34, 11) +
      ellipse('ill-skin-2', x, y, 17, 8) + ellipse('ill-skin-2', x + 2, y - 7, 15, 7) + ellipse('ill-line', x + 2, y - 7, 15, 7, ' fill="none" stroke-width="1.5"');
  }
  /** Big face, front view; droop = one-sided facial droop. */
  function face(cx, cy, droop) {
    return circle('ill-skin', cx - 32, cy + 2, 6) + circle('ill-skin', cx + 32, cy + 2, 6) + circle('ill-skin', cx, cy, 32) +
      path('ill-cloth-2', 'M' + (cx - 32) + ' ' + (cy - 2) + 'A32 32 0 0 1 ' + (cx + 32) + ' ' + (cy - 2) + 'Q' + (cx + 16) + ' ' + (cy - 18) + ' ' + cx + ' ' + (cy - 16) + 'T' + (cx - 32) + ' ' + (cy - 2) + 'Z') +
      line('M' + (cx - 12) + ' ' + cy + 'h0M' + (cx + 12) + ' ' + (cy + (droop ? 3 : 0)) + 'h0', 6) +
      line(droop ? 'M' + (cx - 13) + ' ' + (cy + 13) + 'q12 6 24 11' : 'M' + (cx - 13) + ' ' + (cy + 14) + 'q13 10 26 0', 3);
  }
  /** Head in profile facing right with shoulders; mouth optional. */
  function profile(cx, cy) {
    return rect('ill-cloth', cx - 44, cy + 28, 90, 60, 26) + rect('ill-skin', cx - 12, cy + 12, 24, 24, 8) + circle('ill-skin', cx, cy, 30) +
      circle('ill-skin', cx + 29, cy - 2, 6) + path('ill-cloth-2', 'M' + (cx - 30) + ' ' + (cy + 4) + 'A30 30 0 0 1 ' + (cx + 22) + ' ' + (cy - 20) + 'Q' + (cx - 4) + ' ' + (cy - 12) + ' ' + (cx - 30) + ' ' + (cy + 4) + 'Z') +
      line('M' + (cx + 10) + ' ' + (cy - 6) + 'h6', 3);
  }
  /** Patient's tilted head (close-up, lying face up, body to the right) with helper hands on forehead & chin. */
  function airway() {
    return rect('ill-cloth', 124, 78, 130, 70, 30) + circle('ill-skin', 98, 90, 30) + circle('ill-skin', 84, 60, 6) + circle('ill-skin', 118, 68, 10) +
      line('M72 74q5 3 10 0M100 62l7 3', 2.5) +
      group(cap(0, 71, 70, 42, 6, 11) + cap(0, 63, 92, 74, 66, 13) + cap(0, 126, 76, 150, 18, 10) + cap(0, 121, 70, 131, 56, 6), '', 'ill-skin-2');
  }

  /* ---------- 1c. Scenes: one SVG string per illustrated step ---------- */
  var HOSP = GROUND + arrow(26, 94, 74, 94, 7) + hospital(92, 71);
  var V = {
    // CPR / resuscitation
    cprCheck: svg(GROUND + helperBack(96, 22) + supine(48, 99) + helperArms(96, 22, 64, 88) + line('M112 14l9-4M114 22h10M112 30l9 4', 3)),
    airway: svg(airway() + line('M104 48q5-5 0-10t0-10', 2.5) + clock(204, 36, 17, 0.17)),
    callAed: svg(phone(70, 70) + aed(140, 50)),
    cprHands: svg(cprBase() + line('M82 36V78', 2, ' stroke-dasharray="3 5"') + arrow(126, 46, 96, 78, 5)),
    cprPush: svg(cprBase() + arrow(118, 34, 118, 74, 6) + line('M150 34h10l5-12 7 24 5-12h12', 3) + heart('ill-danger', 210, 32, 9)),
    cprBreaths: svg(airway() + circle('ill-skin-2', 128, 22, 15) + circle('ill-water', 116, 42, 3.5) +
      path('ill-accent', 'M168 108h4v16h-4zm8 0h4v16h-4zm8 0h4v16h-4zm8 0h4v16h-4z') +
      circle('ill-water', 210, 116, 5) + circle('ill-water', 224, 116, 5)),
    aedPads: svg(GROUND + supine(48, 99) + rect('ill-white', 64, 82, 13, 9, 2) + rect('ill-white', 96, 84, 13, 9, 2) +
      line('M70 82C76 52 140 76 162 64M102 84C112 64 140 84 162 72', 2) + aed(162, 46)),
    cprPhone: svg(cprBase() + phone(188, 36, true)),

    // Choking
    chokeCough: svg(GROUND + stand(96, 32, { le: [74, 64], la: [92, 44] }) + line('M112 30l8-4M113 38h9', 3) + bubble(132, 12, 70, 32)),
    backBlows: svg(GROUND + stand(56, 30, { alt: 1, ra: [102, 42] }) + stand(106, 32, { lean: 40 }) + line('M94 14l5 9M105 10l5 9', 3)),
    abdoThrust: svg(GROUND + stand(86, 30, { alt: 1, ra: false }) + stand(116, 32) + cap('ill-skin-2', 98, 60, 121, 63, 9) + arrow(166, 86, 138, 68, 6)),
    objectOut: svg(profile(84, 66) + line('M112 72h6', 3) + line('M132 60h10M132 70h10', 3) + circle('ill-muted', 154, 66, 7) + arrow(170, 66, 214, 58, 6)),
    hospOk: svg(HOSP + okBadge(184, 60, 17)),

    // Bleeding & wounds
    gloves: svg(group(rect(0, 64, 52, 40, 44, 14) + cap(0, 70, 56, 66, 26, 9) + cap(0, 80, 54, 80, 20, 9) + cap(0, 90, 54, 94, 22, 9) + cap(0, 100, 58, 106, 34, 9) +
      cap(0, 66, 82, 50, 66, 10) + rect(0, 66, 92, 36, 22, 5), '', 'ill-water') + line('M68 100h32', 2) + phone(172, 66)),
    pressWound: svg(forearm(84) + wound(116, 95) + gauze(94, 78, 46, 30) + press(116, 76) + arrow(150, 42, 144, 66, 5)),
    packGauze: svg(forearm(84) + gauze(90, 80, 52, 28) + gauze(96, 68, 42, 24) + outline(rect(0, 96, 68, 42, 24, 3), 1.5) + press(118, 64)),
    pressureBandage: svg(forearm(84) + rect('ill-white', 90, 80, 56, 30, 4) + group(rect(0, 100, 78, 9, 34, 3) + rect(0, 116, 78, 9, 34, 3) + rect(0, 132, 78, 9, 34, 3), '', 'ill-white') +
      outline(rect(0, 100, 78, 9, 34, 3) + rect(0, 116, 78, 9, 34, 3) + rect(0, 132, 78, 9, 34, 3), 1.5) +
      clock(204, 38, 18, 0.17)),
    tourniquet: svg(forearm(84) + wound(146, 95, 12) + drop('ill-danger', 146, 116, 5) + rect('ill-accent', 90, 78, 14, 34, 4) +
      cap('ill-muted', 84, 70, 110, 66, 6) + line('M106 70h32', 2, ' stroke-dasharray="3 4"') + clock(204, 38, 18)),
    restBlanket: svg(GROUND + supine(48, 99, { blanket: 1 }) + line('M92 86v24M124 86v24', 1.5) + okBadge(200, 44, 15)),
    rinse: svg(tap(118, 32, 50) + forearm(84) + drop('ill-water', 104, 76, 4) + drop('ill-water', 134, 74, 4) + wound(118, 97, 14)),
    antiseptic: svg(forearm(88) + wound(120, 99, 12) + rect('ill-white', 106, 14, 28, 40, 8) + rect('ill-accent', 106, 26, 28, 12) + rect('ill-accent', 114, 52, 12, 10, 3) +
      drop('ill-accent', 120, 74, 5)),
    plaster: svg(forearm(84) + plaster(94, 80, 52, 30) + okBadge(200, 46, 15)),
    clinic24: svg(HOSP + clock(190, 50, 20, 1)),

    // Burns & blisters
    flameNo: svg(GROUND + path('ill-accent', 'M120 113C92 113 84 86 100 66C102 80 110 82 110 82C106 60 118 40 136 28C132 48 152 60 152 86C152 104 140 113 120 113Z') +
      path('ill-danger', 'M122 113C108 113 104 100 112 88C114 96 120 96 120 96C118 84 124 74 132 68C132 80 140 86 140 98C140 108 132 113 122 113Z') + noBadge(180, 42, 16)),
    coolBurn: svg(tap(118, 32, 50) + forearm(84) + ellipse('ill-danger', 118, 96, 16, 7, ' opacity=".7"') + clock(204, 38, 18, 0.33)),
    rings: svg(rect('ill-cloth', 10, 58, 50, 48, 16) + group(ellipse(0, 78, 82, 30, 25) + cap(0, 100, 64, 158, 52, 12) + cap(0, 104, 77, 168, 73, 12) +
      cap(0, 102, 90, 162, 95, 12) + cap(0, 96, 102, 144, 112, 11) + cap(0, 70, 62, 84, 40, 11), '', 'ill-skin') + rect('ill-accent', 138, 66, 7, 16, 2) + arrow(178, 73, 222, 71, 6)),
    clingFilm: svg(forearm(84) + ellipse('ill-danger', 116, 96, 18, 7, ' opacity=".7"') + rect('ill-white', 84, 76, 82, 36, 4, ' opacity=".7"') + outline(rect(0, 84, 76, 82, 36, 4), 1.5)),
    exhaust: svg(shin(66) + ellipse('ill-danger', 112, 86, 16, 6, ' opacity=".75"') + cap('ill-muted', 40, 120, 150, 112, 13) + outline(circle(0, 154, 112, 6), 2.5) +
      line('M92 104q4-4 0-8M108 104q4-4 0-8M124 104q4-4 0-8', 2.5)),
    bootOff: svg(foot(76, 96) + circle('ill-danger', 66, 100, 7, ' opacity=".75"') + path('ill-muted', 'M162 60h24v30h22c6 0 8 4 8 8v12h-54z') + arrow(160, 40, 196, 40, 6)),
    tapeHeel: svg(foot(76, 96) + rect('ill-white', 58, 88, 28, 20, 4) + outline(rect(0, 58, 88, 28, 20, 4), 1.5) + okBadge(184, 50, 17)),
    blisterPad: svg(foot(76, 96) + circle('ill-accent', 68, 99, 12) + circle('ill-skin', 68, 99, 6.5) + circle('ill-white', 68, 99, 4.5) + okBadge(184, 50, 17)),
    blisterBurst: svg(foot(76, 96) + plaster(56, 90, 32, 18) + drop('ill-water', 140, 50, 10) + drop('ill-water', 164, 62, 6)),
    socks: svg(path('ill-cloth', 'M92 22h34v56c0 5 3 8 8 10l24 9c12 5 9 24-4 22l-48-8c-9-2-14-9-14-18z') + rect('ill-white', 90, 22, 38, 10, 4) + okBadge(186, 44, 17)),

    // Bones, joints, head
    support: svg(forearm(78) + line('M112 80l6 6-6 6 6 6', 2.5) + ellipse('ill-skin-2', 72, 106, 20, 8) + ellipse('ill-skin-2', 160, 106, 20, 8) +
      cap('ill-skin-2', 60, 112, 40, 138, 12) + cap('ill-skin-2', 172, 112, 190, 138, 12)),
    openFracture: svg(shin(82) + wound(112, 94, 12) + gauze(96, 80, 32, 22) + arrow(80, 50, 92, 74, 5) + arrow(146, 50, 134, 74, 5)),
    splint: svg(shin(78) + rect('ill-accent', 30, 100, 156, 8, 4) + group(rect(0, 64, 74, 8, 38, 3) + rect(0, 104, 74, 8, 38, 3) + rect(0, 144, 74, 8, 38, 3), '', 'ill-white')),
    sling: svg(rect('ill-cloth', 66, 36, 108, 120, 40) + group(cap(0, 168, 54, 176, 126, 14) + cap(0, 76, 56, 76, 102, 18) + cap(0, 76, 106, 146, 92, 16) + ellipse(0, 152, 90, 10, 8), '', 'ill-skin') +
      polygon('ill-white', [60, 114, 156, 100, 130, 40]) + group(cap(0, 130, 42, 110, 30, 7) + cap(0, 110, 30, 88, 44, 7), '', 'ill-white') + circle('ill-skin', 120, 18, 18)),
    checkCirc: svg(forearm(84) + outline(circle(0, 182, 95, 24), 2.5) + okBadge(208, 58, 14) + line('M150 60q6-6 0-12M162 60q6-6 0-12', 2.5)),
    coldLimb: svg(forearm(84) + ice(98, 66, 46, 22) + clock(204, 38, 18, 0.3)),
    ankleRest: svg(foot(76, 96) + ellipse('ill-danger', 76, 92, 17, 11, ' opacity=".45"') + circle('ill-white', 180, 50, 20) + rect('ill-muted', 172, 40, 5, 20, 2) + rect('ill-muted', 183, 40, 5, 20, 2)),
    ankleIce: svg(foot(76, 96) + ice(56, 72, 40, 22) + clock(184, 44, 20, 0.3)),
    elevate: svg(GROUND + supine(40, 99, { legsUp: 1 }) + group(cap(0, 132, 82, 140, 64, 7) + cap(0, 148, 76, 156, 58, 7), '', 'ill-white') + arrow(200, 100, 200, 56, 6)),
    boneCrack: svg(group(rect(0, 70, 62, 100, 16, 8) + circle(0, 66, 58, 10) + circle(0, 66, 82, 10) + circle(0, 174, 58, 10) + circle(0, 174, 82, 10), '', 'ill-white') +
      line('M116 62l6 6-5 5 6 6', 2.5) + rect('ill-accent', 56, 104, 128, 8, 4)),
    holdHead: svg(rect('ill-cloth', 70, 100, 100, 60, 26) + circle('ill-cloth-2', 120, 70, 27) + circle('ill-skin', 120, 77, 24) + line('M109 74h6M125 74h6', 2.5) + line('M114 88h12', 2.5) +
      cap('ill-cloth-2', 80, 22, 72, -12, 18) + cap('ill-cloth-2', 160, 22, 168, -12, 18) +
      group(cap(0, 90, 60, 78, 8, 12) + cap(0, 150, 60, 162, 8, 12) + ellipse(0, 92, 74, 9, 16) + ellipse(0, 148, 74, 9, 16), '', 'ill-skin-2')),
    helmet: svg(face(110, 80) + path('ill-accent', 'M74 70a36 36 0 0 1 72 0v4H74z') + line('M80 62h60', 2.5) + arrow(160, 56, 196, 22, 6) + noBadge(206, 62, 14)),
    scalpPress: svg(face(100, 78) + gauze(118, 40, 30, 24) + ellipse('ill-skin-2', 138, 46, 15, 8) + cap('ill-skin-2', 148, 42, 196, 6, 11)),
    headIce: svg(face(110, 78) + ice(84, 44, 52, 16)),
    watch24: svg(clock(80, 70, 32, 1) + eye(172, 70, 1)),

    // Heat, cold, water
    shade: svg(GROUND + ellipse('ill-muted', 70, 112, 60, 5, ' opacity=".5"') + rect('ill-muted', 54, 50, 12, 64, 4) + circle('ill-primary', 60, 44, 30) + circle('ill-primary', 34, 60, 18) +
      circle('ill-primary', 88, 58, 20) + supine(84, 101) + sun(210, 28, 11)),
    immersion: svg(path('ill-white', 'M30 68h180v22a24 24 0 0 1-24 24H54a24 24 0 0 1-24-24z') + rect('ill-water', 38, 74, 164, 34, 12) + rect('ill-skin', 114, 62, 12, 14, 4) +
      circle('ill-skin', 120, 56, 12) + cap('ill-skin', 98, 76, 80, 70, 7) + cap('ill-skin', 142, 76, 160, 70, 7) + snow(204, 34, 12) + okBadge(40, 40, 13)),
    douse: svg(GROUND + supine(48, 99) + group(rect('ill-white', 0, 0, 30, 26, 4) + rect('ill-water', 2, 2, 26, 8, 3), 'translate(96 14)rotate(40)') +
      drop('ill-water', 88, 56, 5) + drop('ill-water', 98, 68, 5) + drop('ill-water', 84, 76, 4) + line('M176 54q12 12 0 24M190 46q18 20 0 40', 3)),
    sip: svg(GROUND + sit(100, 32, { pack: 1, hand: [16, 10], extra: polygon('ill-white', [12, -2, 28, -2, 26, 16, 14, 16]) + rect('ill-water', 14, 4, 12, 10, 2) })),
    recovWatch: svg(recov(56, 86) + eye(200, 36, 0.6)),
    shelter: svg(GROUND + polygon('ill-accent', [70, 113, 124, 36, 178, 113]) + polygon('ill-cloth-2', [110, 113, 124, 72, 138, 113]) +
      drop('ill-water', 30, 40, 5) + drop('ill-water', 46, 62, 5) + drop('ill-water', 28, 84, 5) + line('M188 50h32M196 62h26M188 74h32', 3)),
    mat: svg(supine(48, 97) + rect('ill-accent', 26, 108, 170, 8, 4) + okBadge(206, 40, 14)),
    wrapped: svg(GROUND + supine(48, 99) + rect('ill-accent', 32, 84, 156, 30, 15) + circle('ill-skin', 48, 99, 9) + line('M84 88v22M120 88v22M156 88v22', 1.5)),
    warmDrink: svg(polygon('ill-white', [74, 58, 116, 58, 110, 108, 80, 108]) + rect('ill-accent', 78, 64, 34, 8, 3) + line('M116 70c14 0 14 24-3 24', 5) +
      line('M86 50q-6-8 0-16M100 48q-6-8 0-16', 3) + cubes(146, 60, 18)),
    reach: svg(rect('ill-muted', 0, 100, 112, 40) + path('ill-water', 'M110 82q10-6 20 0t20 0t20 0t20 0t20 0t20 0v58H110z') + circle('ill-skin', 188, 80, 10) +
      cap('ill-skin', 198, 76, 208, 52, 7) + stand(52, 24, { alt: 1, re: [70, 50], ra: [80, 56] }) + line('M78 56L184 70', 4)),
    recovBlanket: svg(recov(56, 86) + rect('ill-accent', 104, 70, 84, 38, 14, ' opacity=".9"')),

    // Medical
    ors: svg(rect('ill-white', 52, 36, 44, 62, 6) + rect('ill-primary', 52, 50, 44, 16) + drop('ill-white', 74, 58, 5) + arrow(104, 66, 126, 66, 5) +
      path('ill-white', 'M134 48h50l-5 62h-40z') + polygon('ill-water', [137, 70, 181, 70, 177, 106, 141, 106]) + line('M184 58c10 0 10 26-3 26', 4)),
    sips: svg(cup(90, 54) + drop('ill-water', 107, 36, 6) + clock(184, 50, 20, 0.12)),
    food: svg(path('ill-primary', 'M60 72h92a46 46 0 0 1-92 0z') + ellipse('ill-white', 106, 71, 44, 9) + line('M90 52q-6-8 0-16M110 50q-6-8 0-16', 3) +
      line('M198 28l-54 40M208 34l-58 38', 3)),
    washHands: svg(tap(118, 32, 44) + ellipse('ill-skin', 104, 92, 22, 12) + ellipse('ill-skin', 134, 92, 22, 12) + outline(circle(0, 96, 76, 5) + circle(0, 146, 74, 4), 2) +
      rect('ill-white', 172, 98, 34, 16, 8)),
    clinicFever: svg(HOSP + thermometer(196, 34)),
    snakeAway: svg(GROUND + stand(44, 32) + arrow(86, 42, 34, 12, 6) + line('M212 104c-14 0-14-16-28-16s-14 16-28 16-14-16-28-16', 7) + line('M126 88l-8-3', 13) +
      polygon('ill-danger', [110, 84, 100, 80, 104, 86, 100, 91])),
    snakeSplint: svg(shin(78) + bite(118, 90) + ellipse('ill-danger', 118, 90, 20, 9, ' opacity=".25"') + rect('ill-accent', 30, 100, 156, 8, 4) +
      group(rect(0, 64, 74, 8, 38, 3) + rect(0, 150, 74, 8, 38, 3), '', 'ill-white')),
    biteTime: svg(shin(84) + bite(110, 96) + line('M128 98l8-3 4 3 6-4', 2) + cap('ill-primary', 170, 66, 150, 92, 6) + clock(204, 36, 18)),
    beesAway: svg(GROUND + stand(40, 32) + arrow(130, 60, 72, 44, 6) + bee(172, 46) + bee(196, 78)),
    scrape: svg(forearm(84) + ellipse('ill-danger', 118, 88, 9, 4, ' opacity=".6"') + line('M118 84l-3-9', 2) + rect('ill-white', 128, 62, 36, 22, 4, ' transform="rotate(-12 146 73)"') +
      rect('ill-primary', 128, 66, 36, 5, 0, ' transform="rotate(-12 146 73)"') + arrow(178, 60, 150, 60, 5)),
    pills: svg(rect('ill-white', 66, 40, 108, 60, 10) + outline(rect(0, 66, 40, 108, 60, 10), 2) +
      group(circle(0, 90, 58, 8) + circle(0, 120, 58, 8) + circle(0, 150, 58, 8) + circle(0, 90, 82, 8) + circle(0, 120, 82, 8), '', 'ill-accent')),
    watchPhone: svg(clock(84, 70, 32, 0.75) + phone(166, 70)),
    leechFind: svg(shin(84) + line('M100 82c6-12 24-12 30-2', 8) + eye(196, 40, 0.6)),
    leechCard: svg(shin(84) + line('M110 82c6-12 24-12 30-2', 8) + rect('ill-white', 74, 64, 30, 20, 4, ' transform="rotate(20 89 74)"') + arrow(64, 104, 104, 104, 5)),
    leechPress: svg(shin(84) + drop('ill-danger', 118, 72, 4) + gauze(100, 80, 38, 24) + press(120, 76)),
    leechPlaster: svg(shin(84) + plaster(98, 82, 42, 20) + okBadge(206, 40, 14)),
    leechSock: svg(path('ill-cloth', 'M72 22h34v56c0 5 3 8 8 10l24 9c12 5 9 24-4 22l-48-8c-9-2-14-9-14-18z') + rect('ill-white', 70, 22, 38, 10, 4) +
      rect('ill-accent', 170, 52, 28, 54, 7) + rect('ill-muted', 176, 40, 16, 14, 3) + line('M160 42h0M152 38h0M152 50h0', 4)),
    washBite: svg(tap(118, 32, 50) + forearm(84) + bite(118, 97) + clock(204, 38, 18, 0.25)),
    looseCover: svg(forearm(84) + gauze(98, 78, 46, 32) + cap('ill-white', 90, 70, 154, 116, 8) + outline(rect(0, 98, 78, 46, 32, 3), 1.5)),
    clinicToday: svg(HOSP + sun(192, 46, 14)),
    dogNote: svg(GROUND + group(ellipse(0, 0, 0, 30, 14) + circle(0, 30, -14, 12) + ellipse(0, 42, -10, 8, 6) + polygon(0, [22, -22, 28, -36, 34, -24]) +
      rect(0, -24, 6, 7, 26, 3) + rect(0, -12, 6, 7, 26, 3) + rect(0, 10, 6, 7, 26, 3) + rect(0, 20, 6, 7, 26, 3) + cap(0, -28, -4, -40, -20, 6), 'translate(74 80)', 'ill-muted') +
      rect('ill-white', 152, 30, 52, 66, 6) + line('M162 50h32M162 62h32M162 74h20', 2.5)),
    stopTrigger: svg(ellipse('ill-white', 88, 90, 46, 14) + circle('ill-accent', 76, 80, 9) + ellipse('ill-accent', 100, 82, 12, 6) + noBadge(120, 50, 16) + phone(180, 66)),
    inject: svg(circle('ill-skin', 46, 18, 14) + rect('ill-cloth', 26, 32, 42, 66, 18) + cap('ill-muted', 50, 92, 168, 92, 34) + cap('ill-muted', 168, 92, 174, 140, 30) +
      cap('ill-skin', 58, 44, 104, 36, 9) + pen(104, 17) + ellipse('ill-skin', 111, 36, 12, 9) + arrow(140, 24, 140, 64, 6)),
    legsUp: svg(GROUND + supine(44, 99, { legsUp: 1 }) + arrow(196, 96, 196, 58, 6)),
    secondDose: svg(clock(80, 70, 30, 0.083) + pen(148, 38) + pen(176, 38)),
    watchBreath: svg(GROUND + supine(48, 99) + line('M40 80q5-5 0-10t0-10M54 80q5-5 0-10t0-10', 2.5) + eye(190, 44, 0.7)),
    topV1: svg(topView(50, 66, 1) + arrow(24, 122, 40, 108, 5)),
    topV2: svg(topView(50, 66, 2) + arrow(104, 26, 92, 50, 5)),
    topV3: svg(topView(50, 66, 3) + arrow(170, 22, 146, 32, 5)),
    recovRoll: svg(recov(56, 86) + line('M156 22a44 44 0 0 1 44 44', 3) + polygon('ill-accent', [190, 62, 210, 62, 200, 78])),
    recovHead: svg(rect('ill-cloth', 132, 36, 130, 72, 30) + circle('ill-skin', 106, 64, 30) + cap('ill-skin', 80, 102, 34, 112, 12) + ellipse('ill-skin', 94, 98, 28, 10) +
      line('M92 58q6 3 12 0', 2.5) + line('M84 80l8 4', 2.5) + drop('ill-water', 82, 112, 5) + rect('ill-accent', 20, 118, 200, 6, 3)),
    recovClock: svg(recov(56, 86) + clock(204, 36, 18, 0.5)),
    balance: svg(GROUND + group(stand(120, 30), 'rotate(12 120 108)') + line('M86 26q-10 10 0 20M166 34q10 10 0 20', 3)),
    eyes: svg(eye(120, 70, 1.5) + line('M40 42l16 8M40 98l16-8M200 42l-16 8M200 98l-16-8', 3)),
    faceDroop: svg(face(112, 72, true) + arrow(186, 118, 144, 98, 6)),
    armDrift: svg(GROUND + stand(120, 32, { la: [72, 48], ra: [164, 66] }) + arrow(182, 50, 182, 86, 6)),
    speech: svg(face(78, 78) + bubble(126, 22, 92, 44, true)),
    timeCall: svg(clock(84, 70, 32) + phone(164, 70)),
    sitRest: svg(GROUND + sit(104, 32, { pack: 1, hand: [8, 26] }) + line('M128 50l9-4M130 58h10M128 66l9 4', 2.5)),
    aspirin: svg(group(cap(0, 58, 84, 44, 60, 12) + ellipse(0, 86, 88, 36, 24) + rect(0, 104, 64, 50, 30, 15), '', 'ill-skin') + circle('ill-white', 90, 84, 10) + outline(circle(0, 90, 84, 10), 2) + phone(184, 66)),
    sitAed: svg(GROUND + sit(84, 32, { pack: 1 }) + aed(160, 64, true)),
    sugar: svg(cubes(50, 50, 22) + rect('ill-accent', 140, 58, 38, 52, 5) + rect('ill-white', 146, 72, 26, 18, 3) + line('M168 58l6-20h10', 3)),
    sugarClock: svg(clock(74, 70, 30, 0.25) + cubes(140, 46, 20)),
    bread: svg(path('ill-accent', 'M52 104V78c0-18 20-28 44-28s44 10 44 28v26z') + line('M78 64l-6 14M100 60l-6 14M122 64l-6 14', 3) + okBadge(186, 52, 17)),
    recovPhone: svg(recov(52, 86) + phone(186, 34)),
    sitDown: svg(GROUND + sit(104, 32) + arrow(160, 30, 160, 78, 6) + line('M84 10q6-6 12 0t12 0', 2.5)),
    seizureClock: svg(clock(80, 70, 32) + line('M136 70l8-16 8 32 8-32 8 32 8-16h14', 3)),
    cushion: svg(GROUND + ellipse('ill-cloth-2', 52, 108, 22, 7) + supine(56, 99) + line('M104 76l4-7M126 76l4-7M150 76l4-7', 3) + ellipse('ill-muted', 208, 104, 14, 9) + arrow(206, 86, 226, 62, 5)),
    noMouth: svg(profile(84, 66) + line('M178 56l-58 16M178 66l-58 12', 3) + noBadge(190, 32, 16)),

    // 1.1.0 — asthma
    astSit: svg(GROUND + rect('ill-accent', 78, 88, 32, 25, 6) + leanSit(96, 34) + line('M131 30q5 4 10 0t10 0M131 41q5 4 10 0t10 0', 2.5) + okBadge(206, 40, 15)),
    inhalerUse: svg(profile(70, 66) + rect('ill-muted', 96, 66, 12, 12, 3) + rect('ill-white', 106, 62, 50, 20, 10) + outline(rect(0, 106, 62, 50, 20, 10), 1.5) +
      inhaler(162, 36) + line('M120 72h4M132 72h4', 3) + clock(212, 30, 16, 0.12)),
    inhalerCall: svg(inhaler(62, 34) + clock(66, 108, 14, 0.25) + arrow(100, 70, 138, 70, 6) + phone(174, 70)),
    // poisoning
    fumesAway: svg(GROUND + stand(52, 32) + arrow(128, 56, 88, 56, 6) + rect('ill-accent', 156, 70, 46, 43, 8) + rect('ill-muted', 166, 60, 14, 12, 3) +
      rect('ill-white', 164, 84, 30, 14, 3) + line('M166 50q6-8 0-16M184 48q6-8 0-16', 3) + noBadge(214, 36, 13)),
    keepBottle: svg(phone(56, 70) + bottle(110, 40) + mushroom(186, 92, 1.1)),
    noVomit: svg(profile(84, 66) + cap('ill-skin-2', 178, 118, 126, 76, 10) + ellipse('ill-skin-2', 122, 74, 7, 4) + noBadge(190, 32, 16)),
    methanol: svg(bottle(30, 40) + eye(134, 70, 0.9) + line('M100 42q8-5 16 0t16 0t16 0t16 0M100 98q8-5 16 0t16 0t16 0t16 0', 2) + clock(210, 42, 18, 0.5)),
    mushroomHosp: svg(GROUND + mushroom(50, 92, 1.2) + arrow(86, 94, 120, 94, 7) + hospital(134, 71)),
    // nosebleed
    noseLean: svg(GROUND + rect('ill-accent', 78, 88, 32, 25, 6) + leanSit(96, 34) + drop('ill-danger', 127, 52, 4) + drop('ill-danger', 129, 65, 3.5) + okBadge(206, 40, 15)),
    nosePinch: svg(profile(84, 66) + cap('ill-skin-2', 172, 118, 132, 74, 12) + ellipse('ill-skin-2', 128, 66, 9, 9) + ellipse('ill-skin-2', 117, 57, 8, 4.5) +
      ellipse('ill-skin-2', 120, 71, 8, 4.5) + clock(204, 36, 18, 0.25)),
    noseClock: svg(GROUND + clock(52, 58, 26, 0.4) + arrow(88, 94, 124, 94, 7) + hospital(140, 71)),
    noseRest: svg(GROUND + sit(76, 32, { pack: 1, hand: [22, 40] }) + polygon('ill-white', [150, 72, 180, 72, 176, 108, 154, 108]) +
      line('M159 62q-5-7 0-14M171 60q-5-7 0-14', 3) + noBadge(198, 46, 13)),
    // electric shock & lightning
    unplug: svg(socket(30, 40) + rect('ill-muted', 98, 62, 12, 4, 2) + rect('ill-muted', 98, 74, 12, 4, 2) + rect('ill-primary', 108, 58, 30, 24, 6) +
      line('M138 70c28 0 30 32 70 32', 4) + arrow(110, 36, 152, 36, 6) + bolt(202, 50)),
    pushWire: svg(GROUND + rect('ill-accent', 26, 108, 64, 7, 3) + stand(58, 28, { alt: 1, le: [70, 52], la: [86, 58], ra: [90, 58] }) +
      cap('ill-muted', 86, 58, 176, 102, 5) + line('M136 113C166 102 198 108 232 96', 3) + bolt(212, 62)),
    lightning: svg(GROUND + storm(56, 26) + supine(100, 99) + okBadge(212, 40, 14)),
    shockBurn: svg(tap(118, 32, 50) + forearm(84) + ellipse('ill-danger', 180, 95, 8, 6, ' opacity=".8"') + circle('ill-danger', 64, 94, 5, ' opacity=".8"') + bolt(214, 38)),
    heartCheck: svg(HOSP + heart('ill-danger', 198, 44, 12) + line('M168 80h8l4-10 6 20 4-10h12', 3)),
    // eye
    eyeRinse: svg(tap(96, 28, 30) + eye(124, 82, 1.3) + drop('ill-water', 168, 106, 5) + drop('ill-water', 180, 120, 4) + clock(210, 34, 16, 0.33)),
    eyeNoRub: svg(eye(96, 72, 1.1) + drop('ill-water', 72, 104, 4) + cap('ill-skin-2', 166, 72, 206, 120, 12) + ellipse('ill-skin-2', 156, 66, 16, 11) + noBadge(198, 34, 15)),
    eyeCloth: svg(eye(92, 70, 1.2) + circle('ill-muted', 100, 90, 3) + polygon('ill-white', [108, 96, 168, 60, 190, 92]) + outline(polygon(0, [108, 96, 168, 60, 190, 92]), 1.5) +
      cap('ill-skin-2', 184, 80, 222, 118, 11)),
    eyeShield: svg(face(88, 78) + ellipse('ill-white', 100, 78, 15, 17) + outline(ellipse(0, 100, 78, 15, 17), 2) + phone(188, 70)),
    eyeCold: svg(face(96, 80) + ice(96, 70, 26, 16) + clock(196, 38, 18, 0.25)),
    // jellyfish & marine stings
    jellyOut: svg(rect('ill-muted', 0, 100, 112, 40) + path('ill-water', 'M110 82q10-6 20 0t20 0t20 0t20 0t20 0t20 0v58H110z') + jelly(182, 106) +
      stand(52, 22) + arrow(154, 56, 96, 56, 6)),
    vinegar: svg(forearm(84) + group(cap(0, 92, 90, 150, 97, 2.5) + cap(0, 100, 101, 158, 91, 2.5) + cap(0, 110, 96, 164, 101, 2.5), '', 'ill-danger') +
      group(bottle(0, 0), 'translate(146 60)rotate(-140)') + drop('ill-water', 140, 70, 3.5) + drop('ill-water', 134, 79, 3)),
    tentacle: svg(forearm(84) + line('M86 92q8-7 16 0t16 0t16 0', 2.5) + rect('ill-white', 150, 70, 30, 20, 4, ' transform="rotate(-20 165 80)"') +
      arrow(206, 60, 170, 74, 5) + group(cap(0, 182, 112, 214, 132, 10) + ellipse(0, 180, 110, 10, 7), '', 'ill-water')),
    hotWater: svg(path('ill-white', 'M36 70h124l-10 42a8 8 0 0 1-8 6H54a8 8 0 0 1-8-6z') + cap('ill-cloth', 6, 46, 38, 60, 24) + cap('ill-skin', 38, 62, 104, 90, 20) +
      rect('ill-water', 46, 80, 104, 30, 6, ' opacity=".85"') + line('M76 62q-6-8 0-16M100 60q-6-8 0-16M124 62q-6-8 0-16', 3) + clock(204, 40, 18, 0.33)),
    urchin: svg(foot(64, 96) + line('M54 110l-5 10M64 111v11M74 110l4 10M86 110l6 9', 2.5) + arrow(138, 94, 162, 94, 6) + hospital(172, 70)),
    // fever & dengue
    dengueClinic: svg(HOSP + thermometer(206, 34) + mosquito(178, 34)),
    paraOnly: svg(rect('ill-white', 28, 46, 84, 54, 10) + outline(rect(0, 28, 46, 84, 54, 10) + circle(0, 52, 64, 8) + circle(0, 88, 64, 8) + circle(0, 52, 84, 8) + circle(0, 88, 84, 8), 2) +
      okBadge(112, 44, 15) + cap('ill-accent', 152, 78, 188, 78, 18) + noBadge(206, 50, 15)),
    fluidsOk: svg(cup(38, 52) + drop('ill-water', 55, 36, 6) + rect('ill-white', 90, 46, 36, 50, 5) + rect('ill-primary', 90, 58, 36, 12) + drop('ill-white', 108, 64, 4) +
      path('ill-primary', 'M144 78h64a32 32 0 0 1-64 0z') + ellipse('ill-white', 176, 78, 30, 6) + line('M166 64q-5-7 0-14M184 62q-5-7 0-14', 3)),
    warnDays: svg(rect('ill-white', 24, 34, 128, 76, 10) + rect('ill-primary', 24, 34, 128, 18, 9) +
      group(rect(0, 32, 64, 14, 22, 3) + rect(0, 49, 64, 14, 22, 3), '', 'ill-muted') +
      group(rect(0, 66, 64, 14, 22, 3) + rect(0, 83, 64, 14, 22, 3) + rect(0, 100, 64, 14, 22, 3) + rect(0, 117, 64, 14, 22, 3) + rect(0, 134, 64, 14, 22, 3), '', 'ill-danger') +
      drop('ill-danger', 188, 50, 10) + phone(194, 100)),
    mosquitoNet: svg(GROUND + supine(56, 99) + path('ill-white', 'M30 113L56 42H176L200 113z', ' opacity=".5"') + line('M30 113L56 42H176L200 113M116 42v71', 1.5) +
      mosquito(216, 40) + noBadge(218, 72, 11))
  };

  /* ======================================================================================
   * 2. CONTENT HELPERS
   * ==================================================================================== */
  function T(vi, en) { return { vi: vi, en: en }; }
  /** One illustrated step; optional detail (sub-note shown under the step). */
  function S(vi, en, ill, dvi, den) {
    var s = { text: T(vi, en), ill: ill };
    if (dvi) s.detail = T(dvi, den);
    return s;
  }
  var UPDATED = '2026-09-01';     // items untouched since 1.0.0-demo
  var UPDATED_110 = '2026-09-28'; // items added or changed in 1.1.0-demo
  var UPDATED_RC = '2026-09-29';  // 1.1.0-demo refresh: search keywords / video query only (no guidance change)

  /* ======================================================================================
   * 3. SOURCES (PDF bảng PL.3) & CATEGORIES
   * ==================================================================================== */
  var SOURCES = [
    {
      id: 'tt51', short: 'TT 51/2017/TT-BYT', short_en: 'Circular 51/2017/TT-BYT', year: 2017,
      title: 'Thông tư 51/2017/TT-BYT – Hướng dẫn phòng, chẩn đoán và xử trí phản vệ',
      title_en: 'Circular 51/2017/TT-BYT – Prevention, diagnosis and management of anaphylaxis (Vietnam Ministry of Health)',
      publisher: T('Bộ Y tế Việt Nam', 'Vietnam Ministry of Health'),
      scope: T('Toàn bộ nội dung về phản vệ, kể cả quy định người có tiền sử phản vệ được kê adrenalin tự tiêm bắp khi không có nhân viên y tế.',
        'All anaphylaxis content, including the rule that people with a history of anaphylaxis who are prescribed adrenaline may inject it into the muscle when no health worker is present.'),
      note: T('Ban hành 29/12/2017, hiệu lực từ 15/02/2018, kèm 10 phụ lục. Văn bản pháp quy nên được trích dẫn trực tiếp.',
        'Issued 29 Dec 2017, in force since 15 Feb 2018, with 10 appendices. A legal text, so it may be cited directly.')
    },
    {
      id: 'ifrc2025', short: 'IFRC 2025', short_en: 'IFRC 2025', year: 2025,
      title: 'IFRC International First Aid, Resuscitation and Education Guidelines 2025',
      title_en: 'IFRC International First Aid, Resuscitation and Education Guidelines 2025',
      publisher: T('Hiệp hội Chữ thập đỏ và Trăng lưỡi liềm đỏ quốc tế (IFRC)', 'International Federation of Red Cross and Red Crescent Societies (IFRC)'),
      scope: T('Khung khuyến cáo sơ cứu chung: cầm máu, bất động, xử trí bỏng, hạ thân nhiệt, đuối nước, tư thế hồi phục.',
        'General first-aid framework: bleeding control, immobilisation, burns, hypothermia, drowning, recovery position.'),
      note: T('Nội dung được viết lại bằng lời của nhóm; không sao chép văn bản hay hình ảnh gốc.', 'Rewritten in the team’s own words; no original text or images are reproduced.')
    },
    {
      id: 'erc2025', short: 'ERC 2025', short_en: 'ERC 2025', year: 2025,
      title: 'European Resuscitation Council Guidelines 2025 – First Aid',
      title_en: 'European Resuscitation Council Guidelines 2025 – First Aid',
      publisher: T('Hội đồng Hồi sức châu Âu (ERC), dựa trên đồng thuận ILCOR 2025', 'European Resuscitation Council (ERC), based on the ILCOR 2025 consensus'),
      scope: T('Các tình huống nội khoa cấp: phản vệ, hóc dị vật, đau ngực, hạ đường huyết, nhận biết đột quỵ.',
        'Acute medical emergencies: anaphylaxis, choking, chest pain, low blood sugar, stroke recognition.'),
      note: T('Nội dung được viết lại bằng lời của nhóm; không sao chép văn bản hay hình ảnh gốc.', 'Rewritten in the team’s own words; no original text or images are reproduced.')
    },
    {
      id: 'vrc', short: 'Hội CTĐ Việt Nam', short_en: 'Viet Nam Red Cross', year: null, // edition not fixed yet (PDF Bảng PL.3) — UI shows “year TBC”
      title: 'Tài liệu huấn luyện sơ cấp cứu – Hội Chữ thập đỏ Việt Nam',
      title_en: 'First-aid training materials – Viet Nam Red Cross Society',
      publisher: T('Hội Chữ thập đỏ Việt Nam', 'Viet Nam Red Cross Society'),
      scope: T('Chuẩn hoá thuật ngữ tiếng Việt cho MOD.01 và bản Việt hoá của thư viện sơ cứu.',
        'Standard Vietnamese terminology for MOD.01 and the Vietnamese edition of the first-aid library.'),
      note: T('Nhóm chốt bản in và năm xuất bản khi bắt đầu biên soạn (Bảng PL.3); đến lúc đó ứng dụng ghi “năm: đang chốt”.',
        'The team fixes the exact edition and year when drafting starts (Table PL.3); until then the app shows “year TBC”.')
    },
    /* Supplementary sources (not one of the four core documents of PDF Bảng PL.3): each backs one topic only and is
       listed so every screen names the document and year it follows. Confirmed or replaced by the adviser in round 2. */
    {
      id: 'who_snake', short: 'WHO SEARO 2016', short_en: 'WHO SEARO 2016', year: 2016, supplementary: true,
      title: 'Guidelines for the management of snakebites, 2nd edition',
      title_en: 'Guidelines for the management of snakebites, 2nd edition',
      publisher: T('Văn phòng khu vực Đông Nam Á của Tổ chức Y tế Thế giới (WHO SEARO)', 'World Health Organization, Regional Office for South-East Asia (WHO SEARO)'),
      scope: T('Bổ sung cho mục rắn cắn: rắn cạp nia, cạp nong cắn gần như không đau; bất động chi; không garô, rạch, hút, nặn máu; không trì hoãn vì thuốc nam.',
        'Supplementary for snakebite: near-painless krait bites; immobilising the limb; no tourniquets, cutting, suction or squeezing; no delay for herbal remedies.'),
      note: T('Tài liệu bổ sung ngoài bốn tài liệu chính; cố vấn y tế xác nhận ở vòng 2.', 'Supplementary to the four core sources; to be confirmed by the medical adviser in round 2.')
    },
    {
      id: 'who_rabies', short: 'WHO 2018', short_en: 'WHO 2018', year: 2018, supplementary: true,
      title: 'Rabies vaccines: WHO position paper – April 2018 (Weekly Epidemiological Record)',
      title_en: 'Rabies vaccines: WHO position paper – April 2018 (Weekly Epidemiological Record)',
      publisher: T('Tổ chức Y tế Thế giới (WHO)', 'World Health Organization (WHO)'),
      scope: T('Bổ sung cho mục chó, mèo, khỉ cắn: rửa vết thương, huyết thanh kháng dại, tiêm nhắc cho người đã tiêm phòng trước chuyến đi.',
        'Supplementary for animal bites: wound washing, rabies immunoglobulin, boosters for travellers vaccinated before the trip.'),
      note: T('Tài liệu bổ sung ngoài bốn tài liệu chính; cố vấn y tế xác nhận ở vòng 2.', 'Supplementary to the four core sources; to be confirmed by the medical adviser in round 2.')
    },
    {
      id: 'who_dengue', short: 'WHO 2009', short_en: 'WHO 2009', year: 2009, supplementary: true,
      title: 'Dengue: guidelines for diagnosis, treatment, prevention and control – new edition',
      title_en: 'Dengue: guidelines for diagnosis, treatment, prevention and control – new edition',
      publisher: T('Tổ chức Y tế Thế giới (WHO) và Chương trình TDR', 'World Health Organization (WHO) and the TDR programme'),
      scope: T('Bổ sung cho mục sốt cao, nghi sốt xuất huyết: dấu hiệu cảnh báo, chỉ dùng paracetamol, uống đủ nước.',
        'Supplementary for high fever and suspected dengue: warning signs, paracetamol only, oral fluids.'),
      note: T('Tài liệu bổ sung ngoài bốn tài liệu chính; cố vấn y tế đối chiếu thêm hướng dẫn hiện hành của Bộ Y tế ở vòng 2.',
        'Supplementary to the four core sources; the adviser also checks the current Vietnam Ministry of Health guidance in round 2.')
    }
  ];

  /** tone = suggested .icon-tile variant for the category chip. */
  var CATEGORIES = [
    { id: 'critical', icon: 'heart-pulse', tone: 'danger', label: T('Cấp cứu sinh tồn', 'Life-threatening') },
    { id: 'wounds', icon: 'bandage', tone: 'accent', label: T('Vết thương & bỏng', 'Wounds & burns') },
    { id: 'bones', icon: 'bone', tone: 'warning', label: T('Té ngã & xương khớp', 'Falls, bones & joints') },
    { id: 'environment', icon: 'sun', tone: 'info', label: T('Nắng, lạnh & nước', 'Heat, cold & water') },
    { id: 'bites', icon: 'bug', tone: 'success', label: T('Động vật cắn & côn trùng', 'Bites & stings') },
    { id: 'medical', icon: 'stethoscope', tone: 'primary', label: T('Bệnh cấp tính', 'Sudden illness') }
  ];

  /* ======================================================================================
   * 4. ITEMS — only actions a lay rescuer is allowed to perform (PDF 8.1).
   * ==================================================================================== */
  var ITEMS = [
    /* ---------------------------------------------------------------- critical */
    {
      id: 'cpr', category: 'critical', icon: 'heart-pulse', priority: 'critical', special: 'cpr',
      title: T('Ngừng tim – Hồi sinh tim phổi (CPR)', 'Cardiac arrest – CPR'),
      keywords: {
        vi: ['ngừng tim', 'ngưng tim', 'ngừng thở', 'bất tỉnh', 'không thở', 'thở ngáp', 'hồi sinh tim phổi', 'ép tim', 'hô hấp nhân tạo', 'thổi ngạt', 'đột tử', 'gục ngã',
          'cpr', 'aed', 'máy khử rung', 'điện giật ngừng thở', 'sét đánh bất tỉnh'],
        en: ['cardiac arrest', 'cpr', 'not breathing', 'unresponsive', 'unconscious', 'chest compressions', 'rescue breaths', 'mouth to mouth', 'collapse', 'heart stopped',
          'gasping', 'aed', 'defibrillator', 'resuscitation', 'electric shock not breathing', 'lightning strike unconscious']
      },
      summary: T('Người bệnh đột ngột gục ngã, gọi và lay không đáp ứng, không thở hoặc chỉ thở ngáp từng cơn. Mỗi phút chậm ép tim, cơ hội sống giảm rõ rệt — hãy bắt đầu ngay.',
        'The person suddenly collapses, does not respond when you shout or tap them, and is not breathing or only gasping. Every minute without compressions sharply lowers the chance of survival — start now.'),
      call115: T('Gọi 115 ngay khi người bệnh bất tỉnh và không thở bình thường. Bật loa ngoài để vừa nghe điều phối viên hướng dẫn vừa ép tim.',
        'Call 115 as soon as the person is unresponsive and not breathing normally. Use speakerphone so you can follow the dispatcher while you do compressions.'),
      steps: [
        S('Kiểm tra an toàn xung quanh (xe cộ, vực, dòng nước), rồi vỗ mạnh vào vai và gọi to xem người bệnh có đáp ứng không.',
          'Check that the scene is safe (traffic, drop-offs, water), then tap the shoulders firmly and shout to see if the person responds.', V.cprCheck),
        S('Ngửa nhẹ đầu, nâng cằm và nhìn ngực tối đa 10 giây. Thở ngáp, thở hắt từng cơn KHÔNG phải là thở bình thường.',
          'Tilt the head back, lift the chin and watch the chest for up to 10 seconds. Occasional gasps are NOT normal breathing.', V.airway),
        S('Gọi 115 (bật loa ngoài) và nhờ người khác tìm máy khử rung tự động (AED) nếu gần đó có.',
          'Call 115 on speaker and send someone to fetch an automated external defibrillator (AED) if one is nearby.', V.callAed),
        S('Đặt gót một bàn tay vào giữa ngực (nửa dưới xương ức), đặt tay kia chồng lên và đan các ngón. Giữ thẳng tay, vai ở ngay trên hai bàn tay.',
          'Place the heel of one hand in the centre of the chest (lower half of the breastbone), put the other hand on top and interlock your fingers. Keep your arms straight with your shoulders directly above your hands.', V.cprHands,
          'Đặt người bệnh nằm ngửa trên nền cứng; nệm, võng hay yên xe làm giảm hiệu quả ép tim.', 'Lay the person on their back on a firm surface; a mattress, hammock or motorbike seat makes compressions less effective.'),
        S('Ép mạnh và nhanh: sâu 5–6 cm, nhịp 100–120 lần/phút (bật máy nhịp bên dưới). Để ngực nảy lên hết sau mỗi lần ép và hạn chế tối đa gián đoạn.',
          'Push hard and fast: 5–6 cm deep at 100–120 compressions per minute (use the metronome below). Let the chest come fully back up after each push and keep pauses to a minimum.', V.cprPush),
        S('Chưa từng học thổi ngạt: chỉ ép tim liên tục. Đã được huấn luyện: 30 lần ép tim xen 2 lần thổi ngạt (mỗi lần khoảng 1 giây, thấy ngực phồng lên).',
          'Never trained in rescue breaths? Give continuous compressions only. If you are trained, give 30 compressions followed by 2 rescue breaths (about 1 second each, watching the chest rise).', V.cprBreaths,
          'Trẻ em và người đuối nước: nếu đã được huấn luyện, nên thổi ngạt kèm ép tim. Ở trẻ em, ép sâu khoảng 1/3 bề dày lồng ngực.',
          'Children and drowning victims: if you are trained, give rescue breaths as well as compressions. For children, push down about one third of the chest depth.'),
        S('Khi có AED: bật máy và làm theo lời máy. Tiếp tục đến khi người bệnh thở lại bình thường, đội cấp cứu tiếp nhận hoặc bạn kiệt sức; nếu có người thay, đổi người ép sau mỗi 2 phút.',
          'When an AED arrives, switch it on and follow its voice prompts. Keep going until the person breathes normally, the ambulance team takes over or you are exhausted; if someone can help, swap every 2 minutes.', V.aedPads)
      ],
      red_flags: {
        vi: ['Không đáp ứng khi gọi và lay', 'Không thở hoặc chỉ thở ngáp từng cơn', 'Môi và da tím tái hoặc xám', 'Co giật ngắn rồi nằm bất động, không thở'],
        en: ['No response to voice or touch', 'Not breathing, or only occasional gasps', 'Lips and skin blue or grey', 'A brief seizure followed by stillness and no breathing']
      },
      donts: {
        vi: ['Không mất thời gian bắt mạch — chỉ cần nhìn nhịp thở', 'Không ép trên nệm mềm, võng; đưa người bệnh xuống nền cứng', 'Không dừng ép quá 10 giây, kể cả khi đổi người',
          'Không sợ làm gãy xương sườn — không ép tim thì người bệnh gần như chắc chắn tử vong', 'Không cho ăn uống, không đổ dầu gió hay nước vào miệng'],
        en: ['Do not waste time feeling for a pulse — just look for breathing', 'Do not do compressions on a soft mattress or hammock; move the person to firm ground', 'Do not pause compressions for more than 10 seconds, even when swapping',
          'Do not fear breaking ribs — without compressions the person will almost certainly die', 'Do not give food or drink, or pour oil or water into the mouth']
      },
      sources: ['erc2025', 'ifrc2025', 'vrc'], related: ['recovery', 'drowning', 'choking'],
      metronome: { bpm: 110, min: 100, max: 120, ratio: '30:2', swap_min: 2 },
      video_query: 'hands-only CPR adult first aid', updated: UPDATED
    },
    {
      id: 'choking', category: 'critical', icon: 'wind', priority: 'critical',
      title: T('Hóc dị vật đường thở', 'Choking'),
      keywords: {
        vi: ['hóc', 'hóc xương', 'mắc nghẹn', 'nghẹn', 'nghẹt thở', 'sặc', 'dị vật đường thở', 'không thở được', 'ôm cổ', 'vỗ lưng', 'ép bụng', 'heimlich',
          'trẻ bị hóc', 'trẻ hóc', 'em bé bị hóc', 'trẻ sơ sinh bị hóc', 'trẻ nhũ nhi', 'em bé', 'trẻ nhỏ'],
        en: ['choking', 'something stuck in throat', 'cannot breathe', 'airway obstruction', 'back blows', 'abdominal thrusts', 'heimlich', 'food stuck',
          'baby choking', 'infant choking', 'child choking', 'baby', 'infant']
      },
      summary: T('Người bệnh đột ngột ôm cổ, không nói được, ho yếu hoặc không ho được, thở rít hay tím tái sau khi ăn uống.',
        'The person suddenly clutches their throat, cannot speak, has a weak or no cough, makes high-pitched noises or turns blue after eating or drinking.'),
      call115: T('Người bệnh không nói, không ho, không thở được: nhờ người bên cạnh gọi 115 ngay (bật loa ngoài) trong khi bạn vỗ lưng – ép bụng. Nếu chỉ có một mình: làm lượt 5 vỗ lưng – 5 ép bụng đầu tiên rồi bật loa gọi 115. Gọi ngay khi người bệnh lịm đi.',
        'If the person cannot speak, cough or breathe, have someone call 115 on speaker right now while you give back blows and abdominal thrusts. If you are alone, give the first round of 5 back blows and 5 thrusts, then call 115 on speaker. Call at once if they become unresponsive.'),
      steps: [
        S('Hỏi: “Bạn bị hóc phải không?”. Nếu người bệnh còn ho được, nói được: khuyến khích ho thật mạnh, không vỗ lưng và ở bên theo dõi.',
          'Ask: “Are you choking?” If they can still cough or speak, encourage them to keep coughing hard, do not hit their back, and stay with them.', V.chokeCough),
        S('Nếu ho không hiệu quả: nhờ người bên cạnh gọi 115. Đứng chếch phía sau, một tay đỡ ngực và cho người bệnh cúi hẳn ra trước. Vỗ mạnh tối đa 5 lần vào giữa hai bả vai bằng gót bàn tay.',
          'If coughing is not working, ask someone to call 115. Stand slightly behind the person, support the chest with one hand and lean them well forward. Give up to 5 sharp blows between the shoulder blades with the heel of your hand.', V.backBlows,
          'Trẻ dưới 1 tuổi: đặt trẻ nằm sấp dọc cẳng tay, đầu thấp, vỗ lưng 5 lần; sau đó lật ngửa và ép 5 lần ở nửa dưới xương ức bằng hai ngón cái (hai bàn tay ôm quanh ngực) hoặc gót một bàn tay. Không ép bụng trẻ nhũ nhi.',
          'Babies under 1: lay the baby face down along your forearm with the head low and give 5 back blows; then turn them face up and give 5 chest thrusts on the lower half of the breastbone with two thumbs (hands encircling the chest) or the heel of one hand. Never give abdominal thrusts to a baby.'),
        S('Nếu dị vật chưa ra: đứng sau, vòng hai tay qua bụng, đặt nắm tay ở giữa rốn và mũi ức, tay kia nắm lấy. Giật mạnh vào trong và lên trên, tối đa 5 lần.',
          'If it is still stuck, stand behind them, wrap your arms around the upper belly, make a fist between the navel and the bottom of the breastbone and grasp it with your other hand. Pull sharply inwards and upwards, up to 5 times.', V.abdoThrust,
          'Phụ nữ có thai hoặc người quá to béo: ép vào nửa dưới xương ức thay vì ép bụng.', 'Pregnant or very large person: give chest thrusts on the lower breastbone instead of abdominal thrusts.'),
        S('Luân phiên 5 lần vỗ lưng và 5 lần ép bụng cho đến khi dị vật bật ra hoặc người bệnh lịm đi.',
          'Keep alternating 5 back blows and 5 abdominal thrusts until the object comes out or the person becomes unresponsive.', V.objectOut),
        S('Nếu người bệnh bất tỉnh: đặt nằm ngửa trên nền cứng, gọi 115 và bắt đầu ép tim ngay (xem CPR). Mỗi lần mở đường thở, chỉ lấy dị vật khi nhìn thấy rõ.',
          'If they become unresponsive, lower them onto firm ground, call 115 and start CPR straight away. Each time you open the airway, remove the object only if you can clearly see it.', V.cprPhone),
        S('Sau khi đã được ép bụng, người bệnh vẫn cần nhân viên y tế kiểm tra vì có thể bị tổn thương bên trong.',
          'Anyone who has had abdominal thrusts should still be checked by a health worker because of possible internal injury.', V.hospOk)
      ],
      red_flags: {
        vi: ['Không nói, không ho, không thở được', 'Thở rít, môi tím tái', 'Lịm đi hoặc bất tỉnh', 'Vẫn ho kéo dài, khó nuốt hoặc đau ngực sau khi dị vật đã ra'],
        en: ['Cannot speak, cough or breathe', 'High-pitched breathing, blue lips', 'Becoming limp or unresponsive', 'Persistent cough, trouble swallowing or chest pain after the object is out']
      },
      donts: {
        vi: ['Không dùng ngón tay móc mù trong miệng', 'Không cho uống nước hay nuốt cơm để “đẩy” dị vật xuống', 'Không vỗ lưng khi người bệnh vẫn đang ho hiệu quả', 'Không ép bụng trẻ dưới 1 tuổi', 'Không dốc ngược người lớn lên để lắc'],
        en: ['Do not sweep blindly inside the mouth with your fingers', 'Do not give water or rice to “push the object down”', 'Do not hit the back while the person is still coughing effectively', 'Do not give abdominal thrusts to a baby under 1', 'Do not hold an adult upside down and shake them']
      },
      sources: ['erc2025', 'ifrc2025', 'vrc'], related: ['cpr'],
      video_query: 'choking first aid back blows abdominal thrusts adult', updated: UPDATED_RC
    },
    {
      id: 'bleeding', category: 'critical', icon: 'droplet', priority: 'critical',
      title: T('Chảy máu nặng', 'Severe bleeding'),
      keywords: {
        vi: ['chảy máu', 'chảy máu nhiều', 'chảy nhiều máu', 'máu chảy nhiều', 'chảy máu không cầm', 'máu chảy không cầm', 'vết thương chảy máu', 'mất máu', 'mất nhiều máu',
          'máu phun', 'đứt động mạch', 'vết thương sâu', 'cầm máu', 'garô', 'băng ép', 'tai nạn xe máy', 'tai nạn giao thông', 'đứt lìa', 'cụt chi'],
        en: ['severe bleeding', 'heavy bleeding', 'bleeding a lot', 'bleeding heavily', 'losing blood', 'blood loss', 'bleeding wound', 'haemorrhage', 'hemorrhage', 'blood spurting',
          'tourniquet', 'direct pressure', 'deep cut', 'amputation', 'motorbike crash', 'road accident', 'traffic accident']
      },
      summary: T('Máu chảy thành dòng, phun thành tia hoặc nhanh chóng thấm ướt băng gạc. Mất máu nguy hiểm có thể xảy ra chỉ trong vài phút.',
        'Blood is flowing steadily, spurting or quickly soaking through dressings. Life-threatening blood loss can happen within minutes.'),
      call115: T('Gọi 115 ngay (hoặc nhờ người khác gọi) trong khi bạn ép cầm máu.', 'Call 115 straight away — or have someone else call — while you apply pressure.'),
      steps: [
        S('Đeo găng tay hoặc lót túi ni-lông sạch để tự bảo vệ. Nhờ người khác gọi 115.',
          'Put on gloves or use a clean plastic bag to protect yourself. Ask someone to call 115.', V.gloves),
        S('Đặt gạc vô trùng hoặc vải sạch lên vết thương và ép thật mạnh, liên tục bằng cả hai bàn tay.',
          'Place sterile gauze or a clean cloth over the wound and press hard and continuously with both hands.', V.pressWound),
        S('Máu thấm qua: không bỏ lớp gạc cũ, đặt thêm gạc lên trên và ép mạnh hơn. Vết thương sâu có thể nhét chặt gạc vào lòng vết thương (có gạc cầm máu chuyên dụng thì dùng) rồi ép.',
          'If blood soaks through, do not remove the first layer — add more on top and press harder. A deep wound can be packed firmly with gauze (haemostatic gauze if you have it) and then pressed.', V.packGauze),
        S('Ép liên tục ít nhất 10 phút, không mở ra xem. Khi máu đã cầm, quấn băng ép chặt lên lớp gạc.',
          'Keep pressing for at least 10 minutes without lifting to check. Once the bleeding is controlled, wrap a firm pressure bandage over the dressing.', V.pressureBandage),
        S('Máu ở tay hoặc chân chảy ồ ạt đe doạ tính mạng (phun thành tia, đứt lìa chi) mà ép trực tiếp không cầm được hoặc không thể ép (nhiều người bị thương, phải di chuyển): đặt garô ngay, cách vết thương 5–7 cm về phía thân, siết đến khi ngừng chảy máu, ghi giờ siết và không nới ra. Vẫn chảy: siết thêm hoặc đặt garô thứ hai ngay phía trên garô thứ nhất.',
          'For life-threatening bleeding from an arm or leg (spurting, an amputation) when direct pressure fails or is not possible (several casualties, you have to move), apply a tourniquet straight away: 5–7 cm above the wound (towards the body), tighten until the bleeding stops, note the time and never loosen it. Still bleeding: tighten it further or add a second tourniquet just above the first.', V.tourniquet,
          'Ưu tiên garô chuyên dụng. Garô tự chế (dải vải bản rộng ít nhất 4 cm và que xoắn) chỉ khi không có garô và bạn đã được hướng dẫn. Không đặt garô lên khớp.',
          'Use a purpose-made tourniquet if you have one. An improvised one (a strip of cloth at least 4 cm wide plus a twisting stick) only if none is available and you have been trained. Never place it over a joint.'),
        S('Cho người bệnh nằm, giữ ấm bằng áo hoặc chăn, trấn an và theo dõi nhịp thở đến khi cấp cứu tới.',
          'Lay the person down, keep them warm with a jacket or blanket, reassure them and watch their breathing until help arrives.', V.restBlanket,
          'Nếu bị đứt lìa chi: bọc phần bị đứt trong gạc sạch, cho vào túi ni-lông kín, đặt túi vào nước có đá (không để đá chạm trực tiếp) và mang theo đến viện.',
          'If a body part has been cut off, wrap it in clean gauze, seal it in a plastic bag, place the bag in iced water (ice must not touch it directly) and take it to hospital.')
      ],
      red_flags: {
        vi: ['Máu phun thành tia hoặc chảy không ngừng', 'Da tái, lạnh, vã mồ hôi; thở nhanh', 'Lơ mơ, lú lẫn, khát nước dữ dội (dấu hiệu sốc)', 'Vết thương ở cổ, ngực, bụng hoặc bị đứt lìa chi', 'Có vật đâm xuyên còn cắm trong người'],
        en: ['Blood spurting or not stopping', 'Pale, cold, sweaty skin; fast breathing', 'Drowsiness, confusion, extreme thirst (signs of shock)', 'Wounds to the neck, chest or belly, or an amputation', 'An object still stuck in the body']
      },
      donts: {
        vi: ['Không rút vật đang cắm trong vết thương — cố định nó và ép xung quanh', 'Không nhấc gạc lên xem máu đã cầm chưa', 'Không dùng garô cho chảy máu nhẹ, ở cổ hoặc thân mình', 'Không nới garô sau khi đã siết',
          'Không đắp lá cây, thuốc lào, bã cà phê hay tro bếp lên vết thương'],
        en: ['Do not pull out an embedded object — secure it and press around it', 'Do not lift the gauze to check whether bleeding has stopped', 'Do not use a tourniquet for minor bleeding or on the neck or trunk', 'Do not loosen a tourniquet once applied',
          'Do not put leaves, tobacco, coffee grounds or ash on the wound']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['wound'],
      video_query: 'severe bleeding first aid direct pressure tourniquet', updated: UPDATED_RC
    },
    {
      id: 'anaphylaxis', category: 'critical', icon: 'alert-circle', priority: 'critical', special: 'anaphylaxis',
      title: T('Phản vệ (dị ứng nặng)', 'Anaphylaxis (severe allergic reaction)'),
      keywords: {
        vi: ['phản vệ', 'sốc phản vệ', 'dị ứng nặng', 'sưng môi', 'sưng họng', 'khó thở', 'nổi mề đay', 'mẩn ngứa', 'dị ứng thuốc', 'dị ứng thức ăn', 'dị ứng hải sản', 'adrenalin', 'bút tiêm', 'epipen'],
        en: ['anaphylaxis', 'anaphylactic shock', 'severe allergy', 'allergic reaction', 'adrenaline', 'epinephrine', 'epipen', 'auto-injector', 'swollen lips', 'throat swelling', 'hives', 'food allergy']
      },
      summary: T('Vài phút đến vài giờ sau khi tiếp xúc dị nguyên (thức ăn, thuốc, ong đốt…), người bệnh nổi mẩn ngứa, sưng môi – mắt – lưỡi, khó thở, khò khè, khàn tiếng, choáng váng, nôn hoặc đau bụng. Phản vệ có thể gây tử vong rất nhanh.',
        'Minutes to hours after contact with a trigger (food, medicine, insect sting…), the person develops an itchy rash, swelling of the lips, eyes or tongue, difficulty breathing, wheeze, a hoarse voice, dizziness, vomiting or belly pain. Anaphylaxis can kill very quickly.'),
      call115: T('Gọi 115 ngay khi nghi phản vệ và nói rõ “phản vệ”, kể cả khi đã tiêm adrenalin và thấy đỡ.',
        'Call 115 immediately if you suspect anaphylaxis and say “anaphylaxis”, even if adrenaline has been given and the person seems better.'),
      steps: [
        S('Ngừng ngay tiếp xúc với tác nhân nghi ngờ (bỏ dở món ăn, lấy ngòi ong ra) và gọi 115.',
          'Stop contact with the suspected trigger right away (stop eating, remove a bee sting) and call 115.', V.stopTrigger),
        S('Nếu người bệnh có bút tiêm adrenalin do bác sĩ kê đơn: dùng ngay, tiêm bắp vào mặt trước ngoài đùi (có thể qua lớp quần) và giữ bút đúng thời gian ghi trên bút. Người bệnh tự tiêm, hoặc người đi cùng hỗ trợ theo hướng dẫn in trên bút.',
          'If the person carries an adrenaline auto-injector prescribed by their doctor, use it now: inject into the muscle of the outer front thigh (through clothing if needed) and hold it for the time printed on the device. They inject themselves, or a companion helps by following the instructions on the pen.', V.inject,
          'Theo Thông tư 51/2017/TT-BYT, người có tiền sử phản vệ được bác sĩ kê adrenalin mang theo để tự tiêm bắp khi không có nhân viên y tế. Ứng dụng không hướng dẫn tiêm bất kỳ thuốc nào khác. Ghi lại giờ tiêm để báo cho nhân viên y tế.',
          'Under Circular 51/2017/TT-BYT (Vietnam Ministry of Health), people with a history of anaphylaxis who are prescribed adrenaline carry it to inject into the muscle when no health worker is present. This app does not guide any other injection. Note the time of the injection for the medical team.'),
        S('Cho người bệnh nằm ngửa, kê cao chân (đầu thấp, chân cao). Nếu khó thở, để họ ngồi dậy; nếu nôn hoặc lơ mơ, đặt nằm nghiêng. Không để người bệnh đột ngột đứng dậy hay đi lại.',
          'Lay the person flat with the legs raised. If breathing is difficult, let them sit up; if they vomit or are drowsy, place them on their side. Do not let them suddenly stand up or walk.', V.legsUp,
          'Phụ nữ có thai: cho nằm nghiêng bên trái.', 'Pregnant women: lay them on their left side.'),
        S('Nếu sau 5 phút chưa đỡ hoặc nặng lên và còn bút thứ hai: tiêm liều thứ hai vào đùi bên kia.',
          'If there is no improvement after 5 minutes, or symptoms get worse, and a second pen is available, give a second dose in the other thigh.', V.secondDose),
        S('Ở bên người bệnh và theo dõi nhịp thở liên tục. Nếu ngừng thở bình thường, bắt đầu ép tim ngay (xem CPR).',
          'Stay with the person and keep watching their breathing. If they stop breathing normally, start CPR immediately.', V.watchBreath),
        S('Mọi trường hợp phản vệ đều phải được theo dõi tại bệnh viện, kể cả khi đã đỡ, vì triệu chứng có thể tái phát sau vài giờ.',
          'Everyone who has had anaphylaxis must be observed in hospital, even if they feel better, because symptoms can come back hours later.', V.hospOk)
      ],
      red_flags: {
        vi: ['Khó thở, thở rít, khò khè', 'Sưng lưỡi, sưng họng, khàn tiếng, khó nuốt', 'Choáng váng, ngất, da lạnh tái', 'Mẩn ngứa lan nhanh kèm nôn hoặc đau bụng', 'Bị ong đốt vào miệng, họng hoặc bị đốt nhiều nốt'],
        en: ['Difficulty breathing, noisy breathing, wheeze', 'Swollen tongue or throat, hoarse voice, trouble swallowing', 'Dizziness, fainting, cold pale skin', 'A rash that spreads fast with vomiting or belly pain', 'A sting in the mouth or throat, or many stings']
      },
      donts: {
        vi: ['Không dùng thuốc kháng histamin hay thuốc xịt hen thay cho adrenalin', 'Không chờ xem triệu chứng có tự hết hay không', 'Không để người bệnh đứng dậy, đi lại hay tự chạy xe đến viện',
          'Không tiêm vào mông, bàn tay hay tĩnh mạch — chỉ tiêm bắp mặt trước ngoài đùi', 'Không cho ăn uống khi người bệnh khó thở hoặc lơ mơ'],
        en: ['Do not use antihistamines or an asthma inhaler instead of adrenaline', 'Do not wait to see if the symptoms go away', 'Do not let the person stand up, walk or ride to hospital themselves',
          'Do not inject into the buttock, hand or a vein — only into the muscle of the outer front thigh', 'Do not give food or drink if breathing is difficult or the person is drowsy']
      },
      sources: ['tt51', 'erc2025', 'vrc'], related: ['sting', 'cpr'],
      timer: { minutes: 5, label: T('Hẹn giờ 5 phút trước khi cân nhắc liều thứ hai', '5-minute timer before considering a second dose') },
      video_query: 'how to use adrenaline auto-injector anaphylaxis', updated: UPDATED
    },
    {
      id: 'recovery', category: 'critical', icon: 'bed', priority: 'urgent',
      title: T('Tư thế nằm nghiêng an toàn', 'Recovery position'),
      keywords: {
        vi: ['tư thế hồi phục', 'nằm nghiêng an toàn', 'bất tỉnh còn thở', 'hôn mê', 'ngất lâu', 'nôn khi bất tỉnh', 'say rượu bất tỉnh', 'giữ đường thở'],
        en: ['recovery position', 'unconscious but breathing', 'unresponsive breathing', 'side position', 'vomiting while unconscious', 'drunk unconscious', 'airway']
      },
      summary: T('Dùng cho người không tỉnh nhưng vẫn thở bình thường: giữ đường thở thông và giúp chất nôn chảy ra ngoài, tránh sặc.',
        'For someone who is unresponsive but breathing normally: it keeps the airway open and lets vomit drain out instead of being inhaled.'),
      call115: T('Gọi 115 cho mọi người bất tỉnh, kể cả khi còn thở.', 'Call 115 for anyone who is unresponsive, even if they are breathing.'),
      steps: [
        S('Quỳ bên cạnh người bệnh. Đặt cánh tay phía gần bạn vuông góc với thân, khuỷu gập, lòng bàn tay ngửa lên.',
          'Kneel beside the person. Place the arm nearest you at a right angle to the body, elbow bent, palm facing up.', V.topV1,
          'Nghi chấn thương cột sống (té xe, ngã cao, đau cổ): chỉ lật khi cần giữ đường thở, giữ đầu – cổ – thân thẳng một khối.',
          'Suspected spinal injury (motorbike crash, fall from height, neck pain): only roll them if needed to keep the airway clear, keeping head, neck and body in line.'),
        S('Đưa cánh tay phía xa vắt qua ngực, áp mu bàn tay đó vào má phía gần bạn và giữ yên.',
          'Bring the far arm across the chest and hold the back of that hand against the cheek nearest you.', V.topV2),
        S('Tay còn lại co gối chân phía xa lên, bàn chân đặt trên mặt đất.',
          'With your other hand, bend the far knee up so the foot is flat on the ground.', V.topV3),
        S('Kéo gối về phía bạn để lật người bệnh nằm nghiêng quay mặt về phía bạn. Chỉnh chân trên để hông và gối tạo thành góc vuông.',
          'Pull the knee towards you to roll the person onto their side, facing you. Adjust the upper leg so the hip and knee are at right angles.', V.recovRoll),
        S('Ngửa nhẹ đầu ra sau để giữ đường thở thông, bàn tay dưới má giữ đầu ổn định. Để miệng hướng xuống cho chất nôn chảy ra.',
          'Tilt the head back slightly to keep the airway open, with the hand under the cheek keeping it steady. Keep the mouth angled down so vomit can drain.', V.recovHead),
        S('Kiểm tra nhịp thở mỗi phút. Nếu ngừng thở bình thường, lật ngửa và ép tim ngay. Sau 30 phút nên chuyển sang nằm nghiêng bên kia.',
          'Check breathing every minute. If normal breathing stops, roll them onto their back and start CPR. After 30 minutes, turn them onto the other side.', V.recovClock,
          'Phụ nữ có thai: ưu tiên nằm nghiêng bên trái.', 'Pregnant women: preferably lay them on their left side.')
      ],
      red_flags: {
        vi: ['Không tỉnh lại sau 1–2 phút', 'Thở chậm, thở rít, ngáy bất thường hoặc ngừng thở', 'Nghi chấn thương đầu, cổ, cột sống', 'Co giật, nôn ra máu'],
        en: ['Not waking up after 1–2 minutes', 'Slow, noisy or snoring breathing, or breathing stops', 'Suspected head, neck or spinal injury', 'Seizures or vomiting blood']
      },
      donts: {
        vi: ['Không để người bất tỉnh nằm ngửa một mình không ai theo dõi', 'Không kê gối cao dưới đầu khi nằm ngửa', 'Không cho ăn uống', 'Không vặn xoắn cổ khi nghi chấn thương cột sống'],
        en: ['Do not leave an unresponsive person lying on their back unattended', 'Do not put a thick pillow under the head while they are on their back', 'Do not give food or drink', 'Do not twist the neck if a spinal injury is possible']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['cpr', 'seizure', 'fainting'],
      video_query: 'recovery position first aid step by step', updated: UPDATED
    },

    /* ---------------------------------------------------------------- wounds */
    {
      id: 'burn', category: 'wounds', icon: 'flame', priority: 'urgent',
      title: T('Bỏng (kể cả bỏng pô xe máy)', 'Burns (incl. motorbike exhaust burns)'),
      keywords: {
        vi: ['bỏng', 'phỏng', 'bỏng pô', 'bỏng ống xả', 'bỏng nước sôi', 'bỏng lửa', 'bỏng dầu', 'bỏng hoá chất', 'bỏng hóa chất', 'bỏng điện', 'bỏng do điện giật',
          'bọng nước', 'phồng da', 'cháy nắng', 'bỏng nắng'],
        en: ['burn', 'scald', 'exhaust burn', 'motorbike exhaust', 'muffler burn', 'fire burn', 'hot oil', 'chemical burn', 'electrical burn', 'blister', 'sunburn']
      },
      summary: T('Da nóng rát, đỏ, đau hoặc phồng rộp sau khi chạm lửa, nước sôi, dầu nóng, hoá chất hoặc ống pô xe máy. Làm mát sớm bằng nước giúp vết bỏng bớt sâu.',
        'Skin is burning, red, painful or blistered after contact with fire, boiling water, hot oil, chemicals or a motorbike exhaust pipe. Cooling early with water keeps the burn from getting deeper.'),
      /* Aligned with MOD.01 (ARM-05, LEG-04): 115 for large / face / airway / electrical burns; hands, feet, deep or
         palm-sized burns go to a clinic the same day (their MOD.01 phrases are not “urgent”). Adviser to confirm. */
      call115: T('Gọi 115 nếu bỏng rộng (cỡ cả cánh tay, cẳng chân hoặc lưng; ở trẻ nhỏ chỉ cần bằng vài lòng bàn tay), bỏng ở mặt, cổ, hít phải khói hoặc khó thở, bỏng điện, bỏng hoá chất diện rộng, hoặc người bệnh lơ mơ, da tái lạnh. Bỏng sâu, phồng rộp lớn hơn lòng bàn tay, hoặc ở bàn tay, bàn chân, khớp, bộ phận sinh dục: làm mát rồi đến cơ sở y tế ngay trong ngày.',
        'Call 115 for a large burn (the size of a whole arm, lower leg or the back; in a small child, a few palms), burns to the face or neck, smoke inhalation or any breathing difficulty, electrical burns, large chemical burns, or if the person is drowsy, pale or cold. Deep burns, blisters larger than the person’s palm, or burns to the hands, feet, joints or genitals: cool them, then go to a medical facility the same day.'),
      steps: [
        S('Tách người bệnh khỏi nguồn nhiệt. Quần áo bắt lửa: nằm xuống lăn tròn hoặc trùm chăn dập lửa. Bỏng điện: ngắt nguồn điện trước khi chạm vào người bệnh.',
          'Get the person away from the heat source. If clothing is on fire: stop, drop and roll, or smother the flames with a blanket. For electrical burns, switch off the power before touching them.', V.flameNo),
        S('Làm mát ngay dưới vòi nước sạch, mát (không dùng nước đá) trong 20 phút. Vẫn có ích nếu bắt đầu trong vòng 3 giờ sau khi bỏng.',
          'Cool the burn under clean, cool running water (not ice) for 20 minutes straight away. It still helps if started up to 3 hours after the burn.', V.coolBurn,
          'Bỏng hoá chất: phủi hoá chất dạng bột trước, rồi xả nước liên tục ít nhất 20 phút.', 'Chemical burns: brush off any powder first, then rinse with running water for at least 20 minutes.'),
        S('Tháo nhẫn, đồng hồ, trang sức và nới quần áo quanh vùng bỏng trước khi sưng; không gỡ phần vải đã dính vào da.',
          'Remove rings, watches and jewellery and loosen clothing near the burn before swelling starts; do not pull off fabric stuck to the skin.', V.rings),
        S('Che lỏng bằng màng bọc thực phẩm (đặt dọc theo vết bỏng, không quấn vòng chặt) hoặc gạc sạch không dính.',
          'Cover loosely with cling film (laid along the burn, not wrapped tightly around) or a clean non-stick dressing.', V.clingFilm),
        S('Bỏng pô xe máy dù nhìn nhỏ vẫn thường là bỏng sâu: làm mát 20 phút, che sạch, không chọc vỡ bọng nước và đi khám trong ngày.',
          'Motorbike exhaust burns often look small but are usually deep: cool for 20 minutes, cover cleanly, do not pop blisters and see a clinic the same day.', V.exhaust),
        S('Giữ ấm phần cơ thể không bị bỏng, nhất là trẻ em và khi làm mát vùng rộng, để tránh hạ thân nhiệt.',
          'Keep the rest of the body warm, especially children and when cooling a large area, to prevent hypothermia.', V.restBlanket)
      ],
      red_flags: {
        vi: ['Vùng bỏng lớn hơn lòng bàn tay người bệnh, hoặc ở mặt, cổ, bàn tay, bàn chân, khớp, bộ phận sinh dục', 'Da trắng bệch, nâu, cháy đen hoặc không còn cảm giác đau (bỏng sâu)',
          'Bỏng điện, bỏng hoá chất', 'Ho, khàn tiếng, muội than quanh mũi miệng (bỏng đường thở)', 'Trẻ nhỏ, người già hoặc người có bệnh nền'],
        en: ['A burn larger than the person’s palm, or on the face, neck, hands, feet, joints or genitals', 'Skin that is white, brown, charred or no longer painful (deep burn)',
          'Electrical or chemical burns', 'Coughing, hoarse voice, soot around the nose or mouth (airway burn)', 'Young children, older people or people with chronic illness']
      },
      donts: {
        vi: ['Không bôi kem đánh răng, nước mắm, mỡ, dầu, lòng trắng trứng lên vết bỏng', 'Không chườm đá hoặc ngâm nước đá', 'Không chọc vỡ bọng nước', 'Không bóc phần quần áo dính vào vết bỏng', 'Không phủ bông gòn trực tiếp lên vết bỏng'],
        en: ['Do not apply toothpaste, fish sauce, grease, oil or egg white', 'Do not use ice or iced water', 'Do not pop blisters', 'Do not peel off clothing stuck to the burn', 'Do not put cotton wool directly on the burn']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['wound', 'electric', 'eye'],
      video_query: 'burn first aid cool running water 20 minutes', updated: UPDATED_110
    },
    {
      id: 'wound', category: 'wounds', icon: 'bandage', priority: 'common',
      title: T('Vết thương hở, trầy xước', 'Cuts, grazes & road rash'),
      keywords: {
        vi: ['vết thương', 'trầy xước', 'trầy da', 'xây xát', 'đứt tay', 'rách da', 'vết cắt', 'té xe', 'ngã xe', 'tai nạn giao thông', 'sạn trong vết thương', 'nhiễm trùng', 'uốn ván'],
        en: ['cut', 'wound', 'graze', 'scrape', 'road rash', 'abrasion', 'laceration', 'fell off motorbike', 'road accident', 'traffic accident', 'grit in wound', 'infection', 'tetanus']
      },
      summary: T('Vết cắt, rách da, trầy xước do té ngã hoặc trượt xe, chảy máu ít đến vừa. Mục tiêu: cầm máu, rửa sạch, che chắn và phòng nhiễm trùng.',
        'Cuts, tears and grazes from falls or motorbike slides, with light to moderate bleeding. Goals: stop the bleeding, clean, cover and prevent infection.'),
      call115: T('Nếu máu chảy ồ ạt không cầm được, chuyển sang mục “Chảy máu nặng” và gọi 115.', 'If bleeding is heavy and will not stop, switch to “Severe bleeding” and call 115.'),
      steps: [
        S('Rửa tay hoặc đeo găng. Ép nhẹ bằng gạc sạch vài phút để cầm máu.', 'Wash your hands or put on gloves. Press gently with clean gauze for a few minutes to stop the bleeding.', V.pressWound),
        S('Rửa vết thương dưới vòi nước sạch (loại uống được) trong vài phút cho trôi đất cát. Trầy do té xe: rửa thật kỹ và gắp bỏ sạn còn dính.',
          'Rinse the wound under clean running water (drinkable quality) for a few minutes to wash out dirt. For road rash, rinse thoroughly and pick out any remaining grit.', V.rinse),
        S('Có thể bôi dung dịch sát khuẩn quanh vết thương theo hướng dẫn trên bao bì.', 'You may apply an antiseptic around the wound as directed on the label.', V.antiseptic),
        S('Che bằng gạc không dính hoặc băng cá nhân; thay mỗi ngày hoặc khi bị ướt, bẩn.', 'Cover with a non-stick dressing or a plaster; change it daily or whenever it gets wet or dirty.', V.plaster),
        S('Theo dõi dấu hiệu nhiễm trùng trong vài ngày. Vết thương sâu, bẩn, hoặc bạn không nhớ lần tiêm phòng uốn ván gần nhất: đến cơ sở y tế trong 24 giờ.',
          'Watch for signs of infection over the next few days. For deep or dirty wounds, or if you are not sure when you last had a tetanus shot, see a clinic within 24 hours.', V.clinic24)
      ],
      red_flags: {
        vi: ['Vết thương sâu, há miệng, dài hoặc ở mặt, bàn tay, khớp (có thể cần khâu)', 'Có dị vật cắm sâu, bẩn nhiều hoặc do vật gỉ sét', 'Sưng, nóng, đỏ lan rộng, có mủ, vệt đỏ chạy dọc chi hoặc sốt', 'Tê, yếu hoặc không cử động được ngón tay, ngón chân'],
        en: ['A deep, gaping or long wound, or one on the face, hand or a joint (may need stitches)', 'An embedded object, heavy dirt or a rusty object', 'Spreading redness, heat, swelling, pus, red streaks along the limb, or fever', 'Numbness, weakness or inability to move fingers or toes']
      },
      donts: {
        vi: ['Không đắp lá cây, kem đánh răng, dầu gió, thuốc lào lên vết thương', 'Không phủ bông gòn trực tiếp (xơ bông dính vào vết thương)', 'Không thổi vào vết thương', 'Không tự khâu vết thương', 'Không bóc vảy khi vết thương đang lành'],
        en: ['Do not put leaves, toothpaste, medicated oil or tobacco on the wound', 'Do not put cotton wool directly on it (fibres stick)', 'Do not blow on the wound', 'Do not try to stitch it yourself', 'Do not pick at scabs while it heals']
      },
      sources: ['ifrc2025', 'vrc'], related: ['bleeding'],
      video_query: 'how to clean a wound first aid graze', updated: UPDATED_RC
    },
    {
      id: 'blister', category: 'wounds', icon: 'footprints', priority: 'common',
      title: T('Phồng rộp chân khi đi bộ', 'Foot blisters'),
      keywords: {
        vi: ['phồng rộp', 'phồng chân', 'bọng nước ở chân', 'rộp da', 'trầy gót chân', 'giày cọ', 'đau chân khi trekking', 'điểm nóng'],
        en: ['blister', 'foot blister', 'hot spot', 'heel blister', 'boots rubbing', 'hiking blister', 'sore feet']
      },
      summary: T('Giày cọ xát khi đi bộ đường dài làm da nóng rát (điểm nóng) rồi phồng lên thành bọng nước. Xử lý sớm để đi tiếp an toàn.',
        'Boots rubbing on long walks make the skin burn (a hot spot) and then form a fluid-filled blister. Deal with it early so you can keep going safely.'),
      call115: T('Hiếm khi cần gọi 115. Đến cơ sở y tế nếu có dấu hiệu nhiễm trùng hoặc người bệnh bị tiểu đường.', 'Rarely needs 115. See a clinic if there are signs of infection or if the person has diabetes.'),
      steps: [
        S('Dừng lại ngay khi thấy điểm nóng rát. Tháo giày, để chân khô ráo.', 'Stop as soon as you feel a hot spot. Take off the boot and let the foot dry.', V.bootOff),
        S('Điểm nóng chưa phồng: dán băng dính y tế hoặc miếng dán chống phồng phẳng, không nhăn.', 'Hot spot without a blister: cover it with smooth, wrinkle-free medical tape or a blister patch.', V.tapeHeel),
        S('Bọng nước còn nguyên: không chọc vỡ. Che bằng miếng dán hydrocolloid hoặc miếng đệm khoét lỗ ôm quanh bọng để giảm áp lực.',
          'Intact blister: do not pop it. Cover it with a hydrocolloid blister plaster or a ring-shaped pad around it to take off the pressure.', V.blisterPad),
        S('Bọng đã vỡ: rửa bằng nước sạch, giữ lại lớp da phía trên và che bằng gạc hoặc miếng dán sạch.', 'Burst blister: rinse with clean water, leave the loose skin in place and cover it with clean gauze or a plaster.', V.blisterBurst),
        S('Mang tất khô, vừa chân; thay tất khi ướt và kiểm tra chân mỗi lần nghỉ.', 'Wear dry, well-fitting socks; change them when wet and check your feet at every break.', V.socks)
      ],
      red_flags: {
        vi: ['Sưng đỏ lan rộng, nóng, có mủ hoặc vệt đỏ dọc chân', 'Sốt, đau tăng dần', 'Người bị tiểu đường hoặc tê bì bàn chân', 'Vết loét sâu, không lành sau vài ngày'],
        en: ['Spreading redness, heat, pus or red streaks up the leg', 'Fever or increasing pain', 'The person has diabetes or numb feet', 'A deep sore that does not heal after a few days']
      },
      donts: {
        vi: ['Không chọc vỡ bọng nước bằng kim bẩn', 'Không bóc bỏ lớp da phồng', 'Không đi tiếp khi giày vẫn cọ vào chỗ đau mà chưa che chắn', 'Không bôi dầu gió, kem đánh răng'],
        en: ['Do not pop blisters with a dirty needle', 'Do not peel off the blister roof', 'Do not keep walking with the boot rubbing an unprotected sore', 'Do not apply medicated oil or toothpaste']
      },
      sources: ['ifrc2025', 'vrc'], related: ['wound'],
      video_query: 'foot blister first aid hiking', updated: UPDATED
    },
    {
      id: 'eye', category: 'wounds', icon: 'eye', priority: 'urgent',
      title: T('Dị vật, hoá chất vào mắt', 'Eye injuries & chemicals in the eye'),
      keywords: {
        vi: ['mắt', 'dị vật mắt', 'bụi vào mắt', 'cát vào mắt', 'côn trùng vào mắt', 'hoá chất vào mắt', 'hóa chất vào mắt', 'hoá chất bắn vào mắt', 'hóa chất bắn vào mắt',
          'bỏng mắt', 'vôi vào mắt', 'xi măng vào mắt', 'chấn thương mắt', 'đau mắt', 'rửa mắt', 'vật đâm vào mắt', 'nọc rắn phun vào mắt', 'bầm mắt'],
        en: ['eye', 'eye injury', 'something in my eye', 'something in eye', 'dust in eye', 'sand in eye', 'chemical in eye', 'chemical eye splash', 'eye burn', 'black eye',
          'eye wash', 'contact lens', 'venom in eye']
      },
      summary: T('Bụi, cát, côn trùng bay vào mắt; hoá chất (vôi, xi măng, thuốc tẩy, thuốc trừ sâu, nọc rắn phun) bắn vào; hoặc bị vật đâm, va đập vào mắt. Hoá chất vào mắt là cấp cứu: rửa nước ngay, từng giây đều quan trọng.',
        'Dust, sand or an insect in the eye; a chemical splash (lime, cement, bleach, pesticide, spitting-cobra venom); or an object or blow hitting the eye. A chemical in the eye is an emergency: start rinsing at once — every second counts.'),
      call115: T('Gọi 115 hoặc đến cơ sở y tế ngay nếu hoá chất bắn vào mắt (rửa đủ 15–20 phút rồi đi, hoặc vừa đi vừa rửa), có vật cắm vào mắt, mắt chảy máu, nhìn mờ, nhìn đôi hoặc mất thị lực, hay đau dữ dội.',
        'Call 115 or go to a medical facility at once for a chemical splash (rinse for the full 15–20 minutes first, or keep rinsing on the way), an object stuck in the eye, bleeding in the eye, blurred or double vision or loss of sight, or severe pain.'),
      steps: [
        S('Hoá chất bắn vào mắt: xả ngay dưới vòi nước sạch chảy nhẹ (hoặc nước đóng chai) ít nhất 15–20 phút, banh rộng mi mắt, nghiêng đầu để nước chảy ra phía ngoài, không chảy sang mắt lành.',
          'Chemical splash: rinse at once under gently running clean water (or bottled water) for at least 15–20 minutes, holding the eyelids wide open and tilting the head so the water runs away from the other eye.', V.eyeRinse,
          'Tháo kính áp tròng nếu tháo dễ. Vôi, xi măng dạng bột: phủi nhẹ bớt quanh mắt rồi rửa. Nọc rắn hổ mang phun vào mắt: rửa như với hoá chất.',
          'Remove contact lenses if they come out easily. Lime or cement powder: gently brush it away from around the eye, then rinse. Spitting-cobra venom: rinse as for a chemical.'),
        S('Bụi, cát, côn trùng: không dụi mắt. Chớp mắt nhiều lần để nước mắt cuốn ra, hoặc rửa bằng nước sạch hay nước muối sinh lý.',
          'Dust, sand or an insect: do not rub. Blink several times to let tears wash it out, or rinse with clean water or saline.', V.eyeNoRub),
        S('Dị vật nằm trên lòng trắng hoặc mi dưới: lấy nhẹ bằng góc khăn sạch thấm ướt. Không cố lấy dị vật nằm trên tròng đen hoặc đã dính chặt.',
          'A speck on the white of the eye or inside the lower lid: lift it off gently with the corner of a clean, damp cloth. Never try to remove anything on the coloured part of the eye or anything stuck in it.', V.eyeCloth),
        S('Có vật cắm vào mắt hoặc mắt bị đâm thủng: không rút ra, không ấn lên mắt. Che mắt bằng một chiếc cốc giấy hoặc tấm che, giữ người bệnh nằm yên và gọi 115.',
          'Object stuck in the eye or a penetrating injury: do not pull it out or press on the eye. Cover the eye with a paper cup or a shield, keep the person still and call 115.', V.eyeShield,
          'Nhờ người bệnh nhắm cả mắt lành để hạn chế đảo mắt.', 'Ask them to keep the uninjured eye closed too, to limit eye movement.'),
        S('Bị va đập vào mắt, vẫn nhìn rõ: chườm lạnh bọc vải nhẹ nhàng 10–15 phút, không ấn mạnh. Nhìn mờ, nhìn đôi, thấy chớp sáng hoặc có máu trong mắt: đi khám ngay.',
          'A blow to the eye but vision still clear: hold a cloth-wrapped cold pack on it gently for 10–15 minutes without pressing. Blurred or double vision, flashes of light or blood inside the eye: see a doctor now.', V.eyeCold)
      ],
      red_flags: {
        vi: ['Hoá chất bắn vào mắt, nhất là vôi, xi măng, thuốc tẩy, chất thông cống', 'Có vật cắm vào mắt hoặc vết thương xuyên vào mắt', 'Nhìn mờ, nhìn đôi, mất thị lực',
          'Đau dữ dội, không mở được mắt, rất sợ ánh sáng', 'Có máu trong mắt hoặc trên tròng đen'],
        en: ['A chemical in the eye, especially lime, cement, bleach or drain cleaner', 'An object stuck in the eye or a penetrating wound', 'Blurred or double vision, or loss of sight',
          'Severe pain, cannot open the eye, strong sensitivity to light', 'Blood inside the eye or over the coloured part']
      },
      donts: {
        vi: ['Không dụi mắt', 'Không dùng tay, tăm bông hay nhíp gắp dị vật trên tròng đen hoặc vật đang cắm', 'Không rút vật đang cắm vào mắt',
          'Không nhỏ sữa, nước lá, nước tiểu hay thuốc nhỏ mắt không rõ loại vào mắt', 'Không trung hoà hoá chất bằng giấm, chanh — chỉ dùng thật nhiều nước sạch', 'Không băng ép chặt lên mắt bị thương'],
        en: ['Do not rub the eye', 'Do not use fingers, cotton buds or tweezers on anything on the coloured part or stuck in the eye', 'Do not pull out an object stuck in the eye',
          'Do not put milk, leaf juice, urine or unknown eye drops in the eye', 'Do not try to neutralise a chemical with vinegar or lemon — use plenty of clean water only', 'Do not bandage an injured eye tightly']
      },
      sources: ['erc2025', 'ifrc2025', 'vrc'], related: ['burn', 'head'],
      video_query: 'chemical in eye first aid rinse', updated: UPDATED_110
    },
    {
      id: 'nosebleed', category: 'wounds', icon: 'droplet', priority: 'common',
      title: T('Chảy máu mũi (chảy máu cam)', 'Nosebleed'),
      keywords: {
        vi: ['chảy máu mũi', 'chảy máu cam', 'máu cam', 'máu mũi', 'chảy máu ở mũi', 'bị đập vào mũi', 'bóp mũi'],
        en: ['nosebleed', 'nose bleed', 'bleeding nose', 'nose bleeding', 'bloody nose', 'epistaxis']
      },
      summary: T('Máu chảy ra từ một hoặc hai lỗ mũi, hay gặp khi trời khô nóng, ngoáy mũi, xì mũi mạnh hoặc bị va vào mũi. Hầu hết tự cầm nếu ngồi cúi ra trước và bóp mũi đúng cách.',
        'Blood runs from one or both nostrils, often in hot dry weather, after nose-picking, hard nose-blowing or a knock to the nose. Most nosebleeds stop if the person sits leaning forward and pinches the nose the right way.'),
      call115: T('Gọi 115 nếu máu chảy rất nhiều hoặc chảy xuống họng liên tục, người bệnh choáng, ngất, khó thở, hoặc chảy máu sau va đập mạnh vào đầu, mặt. Bóp mũi đúng cách hơn 20 phút vẫn chảy: đến cơ sở y tế ngay.',
        'Call 115 if the bleeding is very heavy or keeps running down the throat, if the person feels faint, collapses or struggles to breathe, or if it follows a hard blow to the head or face. Still bleeding after 20 minutes of proper pinching: go to a medical facility now.'),
      steps: [
        S('Cho người bệnh ngồi xuống, đầu hơi cúi ra trước (không ngửa ra sau) để máu chảy ra ngoài; nhổ máu ra, không nuốt.',
          'Sit the person down with the head tilted slightly forward (not back) so the blood runs out; spit blood out rather than swallowing it.', V.noseLean),
        S('Bóp chặt phần mềm của mũi (ngay dưới sống mũi cứng) liên tục 10–15 phút, không buông ra để kiểm tra. Thở bằng miệng.',
          'Pinch the soft part of the nose (just below the bony bridge) firmly and continuously for 10–15 minutes without letting go to check. Breathe through the mouth.', V.nosePinch,
          'Ngậm một viên đá hoặc chườm lạnh bọc vải lên sống mũi có thể giúp máu cầm nhanh hơn.', 'Sucking an ice cube or holding a cloth-wrapped cold pack on the bridge of the nose may help.'),
        S('Sau 10–15 phút, thả tay từ từ. Vẫn chảy: bóp tiếp thêm 10–15 phút. Tổng cộng hơn 20 phút vẫn chưa cầm: đến cơ sở y tế.',
          'After 10–15 minutes, let go slowly. Still bleeding? Pinch for another 10–15 minutes. Not stopped after more than 20 minutes in total: go to a medical facility.', V.noseClock),
        S('Khi máu đã cầm: nghỉ ngơi; trong 24 giờ tránh xì mũi, ngoáy mũi, cúi gập người, mang vác nặng, đồ uống nóng và rượu bia.',
          'Once it has stopped, rest; for 24 hours avoid blowing or picking the nose, bending over, heavy lifting, hot drinks and alcohol.', V.noseRest)
      ],
      red_flags: {
        vi: ['Chảy máu hơn 20 phút dù đã bóp mũi đúng cách', 'Máu chảy rất nhiều, chảy xuống họng liên tục hoặc nôn ra máu', 'Sau va đập mạnh vào đầu, mặt; mũi lệch hoặc chảy dịch trong',
          'Choáng, tái, vã mồ hôi, ngất', 'Đang dùng thuốc chống đông, hoặc kèm sốt cao, chảy máu chân răng, nổi chấm đỏ trên da (nghi sốt xuất huyết)'],
        en: ['Bleeding for more than 20 minutes despite proper pinching', 'Very heavy bleeding, blood running down the throat, or vomiting blood', 'After a hard blow to the head or face; a crooked nose or clear fluid',
          'Feeling faint, pale or sweaty, or fainting', 'On blood thinners, or with a high fever, bleeding gums or red spots on the skin (possible dengue)']
      },
      donts: {
        vi: ['Không ngửa đầu ra sau hay nằm ngửa — máu chảy xuống họng gây nôn, sặc', 'Không nhét giấy, bông hay lá cây sâu vào mũi', 'Không bóp vào sống mũi cứng — phải bóp phần mềm phía dưới',
          'Không buông tay kiểm tra trước 10 phút', 'Không vỗ nước lạnh lên trán, gáy thay cho việc bóp mũi'],
        en: ['Do not tilt the head back or lie flat — blood runs down the throat and causes vomiting or choking', 'Do not stuff paper, cotton wool or leaves deep into the nose', 'Do not squeeze the bony bridge — pinch the soft part below it',
          'Do not let go to check before 10 minutes', 'Do not splash cold water on the forehead or neck instead of pinching']
      },
      sources: ['ifrc2025', 'vrc'], related: ['bleeding', 'head', 'fever'],
      video_query: 'nosebleed first aid lean forward pinch', updated: UPDATED_110
    },
    {
      id: 'electric', category: 'wounds', icon: 'zap', priority: 'critical',
      title: T('Điện giật, sét đánh', 'Electric shock & lightning'),
      keywords: {
        vi: ['điện giật', 'giật điện', 'bị điện giật', 'chạm điện', 'rò điện', 'dây điện', 'dây điện đứt', 'ổ cắm', 'điện cao thế', 'sét đánh', 'bị sét đánh', 'sét', 'dông sét', 'bỏng điện'],
        en: ['electric shock', 'electrocution', 'electrocuted', 'electrical injury', 'electrical burn', 'live wire', 'power line', 'high voltage', 'lightning', 'lightning strike', 'struck by lightning']
      },
      summary: T('Chạm vào dây điện hở, ổ cắm, máy bơm rò điện, dây điện đứt sau bão, hoặc bị sét đánh. Dòng điện có thể làm tim ngừng đập, gây bỏng sâu ở chỗ điện vào và ra, co giật hoặc ngã. Tổn thương bên trong thường nặng hơn vẻ bên ngoài.',
        'Touching a bare wire, a socket, a leaking water pump or a power line down after a storm, or being struck by lightning. The current can stop the heart, cause deep burns where it goes in and out, seizures or a fall. Damage inside is often worse than it looks.'),
      call115: T('Gọi 115 cho mọi trường hợp bị điện lưới giật hoặc sét đánh, kể cả khi người bệnh có vẻ ổn. Người bệnh bất tỉnh, không thở bình thường: bật loa gọi 115 và ép tim ngay khi đã an toàn. Dây điện đứt, điện cao thế: báo thêm điện lực, không tự tiếp cận.',
        'Call 115 for every mains electric shock or lightning strike, even if the person seems fine. If they are unresponsive and not breathing normally, call 115 on speaker and start CPR as soon as it is safe. For fallen or high-voltage lines, also alert the power company and do not go near.'),
      steps: [
        S('Không chạm vào người bệnh khi nguồn điện chưa ngắt. Tắt cầu dao, aptomat hoặc rút phích cắm trước.',
          'Do not touch the person until the power is off. Switch off at the main switch or circuit breaker, or pull the plug, first.', V.unplug,
          'Dây điện cao thế, dây đứt rơi xuống đất: đứng cách xa ít nhất 18 m (khoảng 20 bước chân) và không để ai lại gần cho đến khi điện lực cắt điện.',
          'High-voltage or fallen power lines: stay at least 18 m away (about 20 steps) and keep others back until the power company cuts the supply.'),
        S('Không ngắt được điện (chỉ với điện dân dụng): đứng trên vật khô không dẫn điện (tấm gỗ, thảm cao su, xấp giấy khô), dùng gậy gỗ hoặc cán chổi khô gạt dây điện ra khỏi người bệnh.',
          'If you cannot switch it off (household current only), stand on something dry that does not conduct (a wooden board, a rubber mat, a pile of dry newspaper) and push the wire away with a dry wooden stick or broom handle.', V.pushWire),
        S('Người bị sét đánh không tích điện — chạm vào và cấp cứu ngay được. Nếu dông còn tiếp diễn, đưa người bệnh vào nơi trú an toàn (nhà kiên cố, ô tô đóng kín cửa).',
          'People struck by lightning carry no charge — you can touch and help them at once. If the storm continues, move them to a safe shelter (a solid building or a closed car).', V.lightning,
          'Nhiều người bị sét đánh: ưu tiên người đang bất tỉnh, không thở — người còn kêu, cử động được thường chờ được.',
          'Several people struck: help first those who are unresponsive and not breathing — those who can call out or move can usually wait.'),
        S('Kiểm tra đáp ứng và nhịp thở. Bất tỉnh và không thở bình thường: ép tim ngay và nhờ người tìm máy AED (xem CPR). Còn thở: đặt nằm nghiêng an toàn.',
          'Check for response and breathing. Unresponsive and not breathing normally: start CPR at once and send someone for an AED. Breathing: place them in the recovery position.', V.cprPush),
        S('Làm mát vết bỏng ở chỗ điện vào và ra dưới vòi nước mát 20 phút, che lỏng bằng gạc sạch. Vết bỏng nhỏ ngoài da vẫn có thể kèm tổn thương sâu bên trong.',
          'Cool the burns where the current went in and out under cool running water for 20 minutes and cover them loosely with clean gauze. A small burn on the skin can hide deep damage inside.', V.shockBurn),
        S('Mọi người bị điện lưới giật hoặc sét đánh đều cần đến bệnh viện kiểm tra tim (đo điện tim), kể cả khi thấy khoẻ.',
          'Everyone who has had a mains electric shock or a lightning strike needs a hospital check of their heart (ECG), even if they feel well.', V.heartCheck)
      ],
      red_flags: {
        vi: ['Bất tỉnh, không thở hoặc thở ngáp', 'Hồi hộp, tim đập không đều, đau ngực, khó thở', 'Vết bỏng ở chỗ điện vào và ra, dù nhỏ', 'Lú lẫn, co giật, tê yếu tay chân',
          'Bị điện cao thế hoặc sét đánh, bị ngã từ trên cao, hoặc đang mang thai'],
        en: ['Unresponsive, not breathing or gasping', 'Palpitations, an irregular heartbeat, chest pain or breathlessness', 'Burns where the current went in and out, however small', 'Confusion, seizures, numb or weak limbs',
          'High voltage or lightning, a fall from height, or pregnancy']
      },
      donts: {
        vi: ['Không chạm tay trần vào người bệnh khi nguồn điện chưa ngắt', 'Không dùng vật kim loại hay vật ẩm ướt để gạt dây điện', 'Không đến gần dây điện cao thế hoặc dây đứt rơi xuống đất',
          'Không vùi người bị sét đánh, điện giật xuống đất, bùn hay cát — làm mất thời gian cấp cứu', 'Không trú dông dưới cây cao đứng một mình, trên đỉnh đồi hay dưới nước'],
        en: ['Do not touch the person with bare hands before the power is off', 'Do not use anything metal or wet to move the wire', 'Do not go near high-voltage or fallen power lines',
          'Do not bury a lightning or shock victim in earth, mud or sand — it wastes time needed for resuscitation', 'Do not shelter from a storm under a lone tall tree, on a hilltop or in water']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['cpr', 'burn'],
      video_query: 'electric shock first aid', updated: UPDATED_110
    },

    /* ---------------------------------------------------------------- bones */
    {
      id: 'head', category: 'bones', icon: 'brain', priority: 'urgent',
      title: T('Chấn thương đầu, té xe', 'Head injury'),
      keywords: {
        vi: ['chấn thương đầu', 'va đập đầu', 'đập đầu', 'té xe', 'ngã xe máy', 'tai nạn giao thông', 'chấn động não', 'bất tỉnh sau té', 'mũ bảo hiểm', 'chảy máu đầu', 'đau cổ', 'chấn thương cột sống',
          'đau đầu sau va đập', 'đau đầu sau ngã'],
        en: ['head injury', 'concussion', 'hit head', 'motorbike crash', 'road accident', 'traffic accident', 'helmet', 'scalp wound', 'knocked out', 'neck injury', 'spinal injury', 'headache after a fall', 'headache after head injury']
      },
      summary: T('Sau té xe, ngã hoặc bị vật rơi trúng đầu, người bệnh có thể đau đầu, chóng mặt, buồn nôn, lú lẫn hoặc ngất. Dấu hiệu nguy hiểm có thể xuất hiện muộn sau vài giờ.',
        'After a crash, fall or blow to the head, the person may have a headache, dizziness, nausea, confusion or a brief blackout. Danger signs can appear hours later.'),
      call115: T('Gọi 115 ngay nếu người bệnh từng bất tỉnh, lơ mơ, nôn nhiều lần, co giật, yếu liệt hoặc đau cổ sau tai nạn.',
        'Call 115 immediately if the person was knocked out, is drowsy, vomits repeatedly, has a seizure or weakness, or has neck pain after the accident.'),
      steps: [
        S('Nếu đau cổ, tê yếu tay chân hoặc tai nạn tốc độ cao: giữ người bệnh nằm yên, dùng hai tay giữ đầu thẳng hàng với thân. Chỉ di chuyển khi tại chỗ có nguy hiểm.',
          'If there is neck pain, numbness or weakness, or it was a high-speed crash, keep the person still and hold the head in line with the body with both hands. Move them only if the spot is dangerous.', V.holdHead),
        S('Không tháo mũ bảo hiểm, trừ khi mũ cản trở thở hoặc người bệnh nôn — khi đó cần hai người, một người giữ cổ thẳng.',
          'Do not remove the helmet unless it blocks breathing or the person is vomiting — then use two people, one keeping the neck steady.', V.helmet),
        S('Vết thương da đầu chảy máu: ép bằng gạc sạch. Nếu thấy lõm sọ, chỉ ép nhẹ quanh mép vết thương.',
          'For a bleeding scalp wound, press with clean gauze. If the skull looks dented, press only gently around the edges.', V.scalpPress),
        S('Chườm lạnh bọc vải lên chỗ sưng 10–20 phút.', 'Apply a cloth-wrapped cold pack to any bump for 10–20 minutes.', V.headIce),
        S('Theo dõi sát trong 24 giờ: không để người bệnh ở một mình, không lái xe, không uống rượu; gọi 115 ngay nếu xuất hiện dấu hiệu nguy hiểm.',
          'Watch closely for 24 hours: do not leave them alone, no riding or driving, no alcohol; call 115 at once if any danger sign appears.', V.watch24)
      ],
      red_flags: {
        vi: ['Bất tỉnh dù chỉ trong thời gian ngắn, hoặc không nhớ chuyện vừa xảy ra', 'Lơ mơ, ngủ gà, lú lẫn, kích động', 'Nôn nhiều lần, đau đầu ngày càng tăng', 'Co giật, yếu hoặc tê một bên người, nói khó',
          'Chảy máu hoặc dịch trong ở tai, mũi; hai đồng tử không đều', 'Đau cổ, tê bì tay chân'],
        en: ['Any loss of consciousness, or no memory of what happened', 'Drowsiness, confusion or agitation', 'Repeated vomiting or a worsening headache', 'Seizure, weakness or numbness on one side, trouble speaking',
          'Blood or clear fluid from the ears or nose; unequal pupils', 'Neck pain, numb or tingling limbs']
      },
      donts: {
        vi: ['Không tự ý di chuyển, xốc người nghi chấn thương cổ', 'Không vội tháo mũ bảo hiểm', 'Không để người bệnh tiếp tục lái xe máy', 'Không cho uống rượu bia hay thuốc ngủ', 'Không bịt chặn dịch đang chảy ra từ tai hoặc mũi'],
        en: ['Do not move or lift someone with a possible neck injury unless necessary', 'Do not rush to remove the helmet', 'Do not let the person ride on', 'Do not give alcohol or sleeping pills', 'Do not plug fluid draining from the ears or nose']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['recovery', 'fracture'],
      video_query: 'head injury first aid concussion signs', updated: UPDATED_RC
    },
    {
      id: 'fracture', category: 'bones', icon: 'bone', priority: 'urgent',
      title: T('Gãy xương, nghi gãy xương', 'Broken bones (fractures)'),
      keywords: {
        vi: ['gãy xương', 'gãy tay', 'gãy chân', 'gãy xương đòn', 'nứt xương', 'biến dạng', 'bất động', 'nẹp', 'té xe', 'ngã', 'gãy hở', 'xương lòi'],
        en: ['fracture', 'broken bone', 'broken arm', 'broken leg', 'collarbone', 'splint', 'sling', 'open fracture', 'deformity', 'motorbike crash', 'road accident', 'traffic accident']
      },
      summary: T('Sau té ngã hoặc va chạm, vùng bị thương đau dữ dội, sưng, bầm, biến dạng hoặc không cử động được; có thể có xương lòi qua da (gãy hở).',
        'After a fall or crash, the injured area is very painful, swollen, bruised, misshapen or cannot be moved; bone may break through the skin (open fracture).'),
      call115: T('Gọi 115 nếu nghi gãy xương đùi, xương chậu, cột sống; gãy hở; chi biến dạng kèm lạnh, tím; hoặc có dấu hiệu sốc.',
        'Call 115 for a suspected broken thigh, pelvis or spine; an open fracture; a deformed limb that is cold or blue; or signs of shock.'),
      steps: [
        S('Giữ người bệnh nằm yên ở tư thế đang có; chỉ di chuyển khi chỗ đó nguy hiểm (giữa đường, sát vực, nước chảy xiết). Đỡ nhẹ phía trên và dưới chỗ đau.',
          'Keep the person still in the position found; only move them if the spot is dangerous (middle of the road, cliff edge, fast water). Gently support above and below the painful area.', V.support),
        S('Gãy hở: che vết thương bằng gạc sạch, ép xung quanh để cầm máu và không ấn đầu xương vào trong.',
          'Open fracture: cover the wound with clean gauze, press around it to control bleeding and do not push the bone back in.', V.openFracture),
        S('Cố định chi ở đúng tư thế phát hiện bằng nẹp có lót đệm (nẹp SAM, que, gậy trekking, tấm xốp cuộn); nẹp phải dài qua cả khớp trên và khớp dưới chỗ gãy.',
          'Immobilise the limb in the position found with a padded splint (SAM splint, stick, trekking pole, rolled foam mat) long enough to cover the joint above and below the break.', V.splint),
        S('Gãy tay hoặc xương đòn: đỡ tay bằng khăn tam giác treo trước ngực.', 'Arm or collarbone: support the arm in a triangular-bandage sling across the chest.', V.sling),
        S('Kiểm tra phần chi phía dưới (màu da, độ ấm, cảm giác) trước và sau khi nẹp; nới dây buộc nếu thấy tê, tím, lạnh.',
          'Check below the injury (skin colour, warmth, feeling) before and after splinting; loosen the ties if it becomes numb, blue or cold.', V.checkCirc),
        S('Chườm lạnh bọc vải 15–20 phút để giảm đau và sưng. Giữ ấm cơ thể và theo dõi dấu hiệu sốc.',
          'Apply a cloth-wrapped cold pack for 15–20 minutes to ease pain and swelling. Keep the person warm and watch for signs of shock.', V.coldLimb)
      ],
      red_flags: {
        vi: ['Nghi gãy xương đùi, xương chậu, cột sống cổ hoặc lưng', 'Xương lòi ra ngoài hoặc chảy máu nhiều', 'Chi lạnh, tím, tê hoặc mất cảm giác', 'Da tái lạnh, vã mồ hôi, lơ mơ (sốc)', 'Đau cổ, tê yếu tay chân sau té xe'],
        en: ['Suspected broken thigh, pelvis, neck or back', 'Bone sticking out or heavy bleeding', 'A limb that is cold, blue, numb or without feeling', 'Pale, cold, sweaty skin, drowsiness (shock)', 'Neck pain or numb, weak limbs after a crash']
      },
      donts: {
        vi: ['Không nắn chỉnh hay kéo thẳng chi bị gãy', 'Không bắt người bệnh cử động để “thử” xem có gãy không', 'Không buộc nẹp đè lên chỗ gãy hoặc quá chặt', 'Không xoa bóp, đắp thuốc nam, bó lá lên chỗ gãy',
          'Không di chuyển người nghi chấn thương cột sống khi không thật cần thiết'],
        en: ['Do not straighten or pull on a broken limb', 'Do not ask the person to move it to “test” for a break', 'Do not tie the splint over the break or too tightly', 'Do not massage or apply herbal remedies or leaf wraps',
          'Do not move a person with a possible spinal injury unless it is truly necessary']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['sprain', 'head'],
      video_query: 'fracture first aid splint sling', updated: UPDATED_RC
    },
    {
      id: 'sprain', category: 'bones', icon: 'activity', priority: 'common',
      title: T('Bong gân, trật khớp', 'Sprains & dislocations'),
      keywords: {
        vi: ['bong gân', 'trật khớp', 'lật cổ chân', 'trẹo chân', 'trẹo cổ chân', 'trẹo cổ tay', 'sái chân', 'cổ chân', 'cổ tay', 'sưng mắt cá', 'trật vai', 'sai khớp', 'đau khớp', 'chấn thương đầu gối'],
        en: ['sprain', 'sprained ankle', 'sprained wrist', 'twisted ankle', 'rolled ankle', 'ankle', 'wrist', 'knee injury', 'dislocation', 'dislocated shoulder', 'joint injury', 'swollen ankle']
      },
      summary: T('Khớp bị lật, vặn (thường là cổ chân, cổ tay, gối) gây đau, sưng, bầm. Trật khớp làm khớp biến dạng rõ và gần như không cử động được.',
        'A joint is twisted (often the ankle, wrist or knee), causing pain, swelling and bruising. A dislocation makes the joint look clearly deformed and almost impossible to move.'),
      call115: T('Gọi 115 nếu khớp biến dạng kèm chi lạnh, tím, tê; khớp gối hoặc khớp háng lệch hẳn; hoặc không thể đưa người bệnh ra khỏi khu vực một cách an toàn.',
        'Call 115 if the joint is deformed and the limb is cold, blue or numb; if the knee or hip is clearly out of place; or if you cannot safely get the person out of the area.'),
      steps: [
        S('Dừng vận động, cho khớp bị thương nghỉ hoàn toàn.', 'Stop the activity and rest the injured joint completely.', V.ankleRest),
        S('Chườm lạnh (đá hoặc nước lạnh bọc khăn) 15–20 phút, lặp lại vài lần mỗi ngày trong 1–2 ngày đầu.',
          'Apply cold (ice or cold water wrapped in a cloth) for 15–20 minutes, several times a day for the first 1–2 days.', V.ankleIce),
        S('Quấn băng thun vừa phải để hạn chế sưng và kê cao chi lên ba lô hoặc gối.', 'Wrap with an elastic bandage (snug, not tight) to limit swelling and raise the limb on a backpack or pillow.', V.elevate),
        S('Nghi trật khớp (biến dạng rõ, không cử động được): giữ nguyên tư thế, cố định bằng nẹp hoặc khăn treo tay và đưa đến cơ sở y tế.',
          'Suspected dislocation (obvious deformity, cannot move it): keep it in the position found, immobilise it with a splint or sling and get to a medical facility.', V.sling),
        S('Nếu không đứng hoặc chịu lực được, hay ấn vào xương rất đau: xử trí như gãy xương.', 'If the person cannot bear weight or the bone itself is very tender, treat it as a fracture.', V.boneCrack)
      ],
      red_flags: {
        vi: ['Khớp biến dạng hoặc lệch hẳn so với bên lành', 'Không thể đứng hay bước nổi 4 bước', 'Tê, lạnh, tím phần chi phía dưới', 'Đau tăng dần, sưng to nhanh'],
        en: ['The joint looks deformed compared with the other side', 'Unable to stand or take 4 steps', 'Numb, cold or blue below the injury', 'Increasing pain or rapid swelling']
      },
      donts: {
        vi: ['Không tự nắn khớp trật vào lại', 'Không xoa bóp, dầu nóng, rượu thuốc trong 48 giờ đầu', 'Không chườm đá trực tiếp lên da', 'Không quấn băng thun quá chặt hoặc để nguyên khi ngủ', 'Không cố đi tiếp khi còn đau nhiều'],
        en: ['Do not try to put a dislocated joint back', 'No massage, heat rubs or medicinal liquor in the first 48 hours', 'Do not put ice directly on the skin', 'Do not wrap the bandage too tight or leave it on overnight', 'Do not force yourself to keep walking while in a lot of pain']
      },
      sources: ['ifrc2025', 'vrc'], related: ['fracture'],
      video_query: 'ankle sprain first aid ice compression elevation', updated: UPDATED_110
    },

    /* ---------------------------------------------------------------- environment */
    {
      id: 'heatstroke', category: 'environment', icon: 'sun', priority: 'critical',
      title: T('Say nắng, sốc nhiệt', 'Heatstroke'),
      keywords: {
        vi: ['say nắng', 'sốc nhiệt', 'cảm nắng', 'trúng nắng', 'kiệt sức vì nóng', 'nóng quá', 'sốt cao khi leo núi', 'lả đi', 'nắng nóng'],
        en: ['heatstroke', 'heat stroke', 'heat exhaustion', 'sunstroke', 'overheating', 'too hot', 'collapse in heat']
      },
      summary: T('Sau khi vận động dưới trời nóng, người bệnh mệt lả, đau đầu, buồn nôn, da nóng; nặng hơn là lú lẫn, nói lảm nhảm, co giật hoặc ngất. Sốc nhiệt là cấp cứu — phải làm mát ngay.',
        'After activity in hot weather the person is exhausted, with a headache, nausea and hot skin; in severe cases they become confused, act strangely, have a seizure or collapse. Heatstroke is an emergency — cool them immediately.'),
      call115: T('Gọi 115 ngay nếu người bệnh lú lẫn, nói khó, co giật, ngất, hoặc không đỡ sau 30 phút làm mát.',
        'Call 115 immediately if the person is confused, has trouble speaking, has a seizure, faints, or is not better after 30 minutes of cooling.'),
      steps: [
        S('Đưa người bệnh vào bóng râm hoặc nơi thoáng mát, cho nằm nghỉ, nới lỏng hoặc cởi bớt quần áo.', 'Move the person into shade or a cool, airy place, lay them down and loosen or remove extra clothing.', V.shade),
        S('Làm mát ngay: tốt nhất là ngâm người đến ngang cổ trong nước mát hoặc lạnh (suối, chậu lớn), thường khoảng 10–15 phút. Dừng khi người bệnh tỉnh táo, nói năng bình thường trở lại hoặc bắt đầu run; đưa lên, lau khô và tiếp tục theo dõi. Luôn giữ đầu trên mặt nước và có người bên cạnh.',
          'Cool them straight away: the best method is to immerse the body up to the neck in cool or cold water (a stream, a large tub), usually for about 10–15 minutes. Stop when they are alert and talking normally again or start to shiver; lift them out, dry them and keep watching. Always keep the head above water with someone beside them.', V.immersion,
          'Có nhiệt kế: ngừng làm mát khi thân nhiệt xuống khoảng 39 °C. Sau khi dừng, thân nhiệt có thể tăng lại — kiểm tra lại sau 10–15 phút.',
          'If you have a thermometer, stop cooling once the body temperature is down to about 39 °C. It can rise again after you stop — check again after 10–15 minutes.'),
        S('Nếu không ngâm được: dội hoặc xịt nước mát liên tục khắp người kết hợp quạt mạnh; chườm khăn lạnh, túi đá bọc vải ở cổ, nách, bẹn.',
          'If immersion is not possible, keep pouring or spraying cool water over the whole body while fanning hard; add cold wet towels or wrapped ice packs to the neck, armpits and groin.', V.douse),
        S('Nếu người bệnh tỉnh táo và nuốt được: cho uống từng ngụm nước mát hoặc oresol.', 'If the person is fully alert and can swallow, give sips of cool water or oral rehydration solution.', V.sip),
        S('Theo dõi sát ý thức và nhịp thở. Nếu lơ mơ nhưng còn thở, đặt nằm nghiêng an toàn; nếu ngừng thở, ép tim ngay.',
          'Keep checking alertness and breathing. If drowsy but breathing, use the recovery position; if breathing stops, start CPR.', V.recovWatch)
      ],
      red_flags: {
        vi: ['Lú lẫn, nói lảm nhảm, hành vi bất thường', 'Co giật, ngất, bất tỉnh', 'Da rất nóng (khô hoặc đẫm mồ hôi), sốt cao', 'Nôn liên tục, không uống được'],
        en: ['Confusion, rambling speech, strange behaviour', 'Seizure, fainting or unresponsiveness', 'Very hot skin (dry or soaked with sweat), high temperature', 'Repeated vomiting, unable to drink']
      },
      donts: {
        vi: ['Không trì hoãn làm mát để chờ xe cấp cứu', 'Không cho uống rượu bia, cà phê hay nước tăng lực', 'Không cho uống khi người bệnh lơ mơ hoặc không nuốt được', 'Không dùng thuốc hạ sốt thay cho làm mát — thuốc không có tác dụng với sốc nhiệt',
          'Không tiếp tục leo núi hay chạy xe ngay sau khi vừa đỡ', 'Không cạo gió, đánh gió, xoa dầu gió, bấm huyệt hay đắp chăn ủ cho ra mồ hôi — phải làm mát ngay'],
        en: ['Do not delay cooling while waiting for the ambulance', 'Do not give alcohol, coffee or energy drinks', 'Do not give drinks if the person is drowsy or cannot swallow', 'Do not rely on fever tablets — they do not work for heatstroke',
          'Do not continue hiking or riding right after they feel better', 'Do not coin-rub (cạo gió), apply medicated oil, use acupressure or wrap the person up to make them sweat — cool them now']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['dehydration', 'recovery'],
      video_query: 'heat stroke first aid cold water immersion', updated: UPDATED_110
    },
    {
      id: 'drowning', category: 'environment', icon: 'waves', priority: 'critical',
      title: T('Đuối nước', 'Drowning'),
      keywords: {
        vi: ['đuối nước', 'chết đuối', 'ngạt nước', 'sặc nước', 'suối', 'thác', 'lũ', 'tắm suối', 'lật thuyền', 'nước cuốn'],
        en: ['drowning', 'near drowning', 'water rescue', 'stream', 'waterfall', 'flood', 'swept away', 'swimming accident']
      },
      summary: T('Người gặp nạn dưới nước (suối, thác, hồ, lũ) không tự thoát ra được, hoặc đã được đưa lên nhưng lơ mơ, ho sặc, khó thở hay bất tỉnh.',
        'Someone in trouble in water (stream, waterfall, lake, flood) cannot get out, or has been pulled out but is drowsy, coughing, breathless or unresponsive.'),
      call115: T('Gọi 115 và 114 (cứu nạn, cứu hộ) ngay khi thấy người gặp nạn dưới nước.', 'Call 115 and 114 (fire & rescue) as soon as you see someone in trouble in the water.'),
      steps: [
        S('Đừng nhảy xuống cứu nếu chưa được huấn luyện. Đưa sào, cành cây, dây, hoặc ném vật nổi (can nhựa, áo phao) cho người gặp nạn bám vào.',
          'Do not jump in unless you are trained. Reach out with a pole, branch or rope, or throw something that floats (a plastic jerrycan, a life jacket).', V.reach),
        S('Khi đã đưa lên bờ: đặt nằm ngửa trên nền cứng, kiểm tra đáp ứng và nhịp thở.', 'Once on land, lay them on their back on firm ground and check for response and breathing.', V.airway),
        S('Nếu không thở bình thường: gọi 115 và bắt đầu cấp cứu. Đã được huấn luyện: thổi ngạt 5 lần trước, sau đó 30 lần ép tim xen 2 lần thổi ngạt; chưa học: ép tim liên tục.',
          'If they are not breathing normally, call 115 and start resuscitation. If trained, give 5 rescue breaths first, then 30 compressions to 2 breaths; if not, give continuous compressions.', V.cprBreaths),
        S('Nếu còn thở: đặt nằm nghiêng an toàn, cởi đồ ướt, lau khô và ủ ấm bằng chăn giữ nhiệt.', 'If they are breathing, place them in the recovery position, remove wet clothes, dry them and keep them warm with a thermal blanket.', V.recovBlanket),
        S('Mọi người đã bị đuối nước cần được đưa đến cơ sở y tế, kể cả khi đã tỉnh táo, vì biến chứng ở phổi có thể xuất hiện muộn.',
          'Everyone who has been through a drowning needs to go to a medical facility, even if they seem fine, because lung problems can appear hours later.', V.hospOk)
      ],
      red_flags: {
        vi: ['Bất tỉnh, không thở hoặc thở ngáp', 'Ho kéo dài, khó thở, thở nhanh, đau ngực', 'Lơ mơ, lú lẫn, môi tím', 'Nghi chấn thương cổ do nhảy hoặc lao xuống nước nông'],
        en: ['Unresponsive, not breathing or gasping', 'Persistent cough, breathlessness, fast breathing, chest pain', 'Drowsiness, confusion, blue lips', 'Possible neck injury from diving into shallow water']
      },
      donts: {
        vi: ['Không dốc ngược hay xốc nước ra khỏi bụng — mất thời gian và dễ gây sặc', 'Không ấn bụng để ép nước ra', 'Không bơi ra cứu ở dòng nước chảy xiết nếu chưa được huấn luyện', 'Không để người vừa được cứu ở một mình'],
        en: ['Do not hold them upside down or try to shake water out — it wastes time and causes choking', 'Do not press on the belly to force water out', 'Do not swim into fast-flowing water to rescue unless trained', 'Do not leave the rescued person alone']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['cpr', 'hypothermia'],
      video_query: 'drowning first aid rescue breaths', updated: UPDATED_110
    },
    {
      id: 'hypothermia', category: 'environment', icon: 'snowflake', priority: 'urgent',
      title: T('Hạ thân nhiệt', 'Hypothermia'),
      keywords: {
        vi: ['hạ thân nhiệt', 'nhiễm lạnh', 'rét run', 'lạnh cóng', 'mưa lạnh', 'ướt lạnh', 'sương muối', 'đèo lạnh', 'run lập cập'],
        en: ['hypothermia', 'too cold', 'shivering', 'cold and wet', 'freezing', 'cold exposure', 'frostnip']
      },
      summary: T('Bị lạnh lâu (mưa, gió đèo, ngâm nước, quần áo ướt), người bệnh run lập cập, da lạnh tái, nói líu, vụng về, lơ mơ. Khi ngừng run mà người vẫn lạnh là dấu hiệu rất nặng.',
        'After long exposure to cold (rain, wind on a mountain pass, immersion, wet clothes) the person shivers hard, has cold pale skin, slurred speech, clumsiness and drowsiness. Stopping shivering while still cold is a very serious sign.'),
      call115: T('Gọi 115 nếu người bệnh lơ mơ, lú lẫn, ngừng run hoặc bất tỉnh.', 'Call 115 if the person is drowsy, confused, has stopped shivering or is unresponsive.'),
      steps: [
        S('Đưa người bệnh vào nơi kín gió, khô ráo (lều, nhà dân, sau tảng đá). Di chuyển nhẹ nhàng, hạn chế để họ tự đi lại.',
          'Get the person out of the wind and rain into shelter (a tent, a house, behind a rock). Handle them gently and limit their walking.', V.shelter),
        S('Thay quần áo ướt bằng đồ khô. Lót cách nhiệt dưới người (tấm xốp, ba lô) vì mặt đất lấy nhiệt rất nhanh.',
          'Replace wet clothes with dry ones. Insulate them from the ground (foam mat, backpack) because the ground drains heat fast.', V.mat),
        S('Quấn kín bằng chăn, túi ngủ và chăn giữ nhiệt, che cả đầu và cổ, chừa mặt để thở.', 'Wrap them in blankets, a sleeping bag and a thermal blanket, covering the head and neck but leaving the face clear.', V.wrapped),
        S('Nếu tỉnh táo và nuốt được: cho uống nước ấm có đường, ăn đồ ngọt. Có thể đặt túi chườm ấm bọc vải ở nách và ngực.',
          'If fully alert and able to swallow, give warm sweet drinks and sugary food. Cloth-wrapped warm packs can be placed in the armpits and on the chest.', V.warmDrink),
        S('Theo dõi nhịp thở. Nếu bất tỉnh và không thở bình thường: gọi 115 và ép tim ngay.', 'Keep checking breathing. If they become unresponsive and are not breathing normally, call 115 and start CPR.', V.cprPhone)
      ],
      red_flags: {
        vi: ['Lơ mơ, lú lẫn, nói líu, đi loạng choạng', 'Ngừng run dù người vẫn lạnh', 'Thở chậm, yếu; bất tỉnh', 'Ngón tay, ngón chân trắng bệch, cứng và tê (cóng)'],
        en: ['Drowsiness, confusion, slurred speech, stumbling', 'Shivering stops although the person is still cold', 'Slow, weak breathing; unresponsiveness', 'White, hard, numb fingers or toes (frostbite)']
      },
      donts: {
        vi: ['Không chà xát mạnh tay chân hay xoa rượu, dầu', 'Không cho uống rượu bia', 'Không ngâm nước nóng hoặc hơ lửa trực tiếp', 'Không để người bệnh tự đi bộ, vận động mạnh', 'Không đặt túi chườm nóng trực tiếp lên da'],
        en: ['Do not rub the limbs hard or massage with alcohol or oil', 'Do not give alcohol', 'Do not put them in hot water or hold them close to a fire', 'Do not let the person walk or exert themselves', 'Do not put hot packs directly on the skin']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['drowning'],
      video_query: 'hypothermia first aid outdoors', updated: UPDATED
    },

    /* ---------------------------------------------------------------- bites & stings */
    {
      id: 'snakebite', category: 'bites', icon: 'alert-triangle', priority: 'critical',
      title: T('Rắn cắn', 'Snakebite'),
      keywords: {
        vi: ['rắn cắn', 'rắn độc', 'rắn lục', 'rắn lục đuôi đỏ', 'rắn hổ', 'hổ mang', 'hổ chúa', 'cạp nia', 'cạp nong', 'rắn cắn ban đêm', 'vết răng nanh', 'nọc độc', 'huyết thanh kháng nọc'],
        en: ['snake bite', 'snakebite', 'venomous snake', 'viper', 'pit viper', 'cobra', 'spitting cobra', 'king cobra', 'krait', 'fang marks', 'antivenom']
      },
      summary: T('Có vết răng (thường 1–2 vết nanh), thường kèm đau, sưng, bầm hoặc rỉ máu tại chỗ; có thể buồn nôn, sụp mi, nói khó, khó thở. Rắn cạp nia, cạp nong hay cắn ban đêm khi ngủ dưới đất: vết cắn có thể rất nhỏ, gần như không đau, không sưng, nhưng vài giờ sau mới gây sụp mi, yếu cơ, khó thở — vẫn phải đi viện ngay. Coi mọi vết rắn cắn là có độc cho đến khi bác sĩ đánh giá.',
        'Bite marks (often 1–2 fang punctures), usually with pain, swelling, bruising or oozing at the site; there may be nausea, drooping eyelids, slurred speech or difficulty breathing. Kraits often bite at night while people sleep on the floor: the bite can be tiny, almost painless and without swelling, yet drooping eyelids, weakness and breathing trouble can start hours later — still go to hospital now. Treat every snakebite as venomous until a doctor says otherwise.'),
      call115: T('Gọi 115 ngay với mọi trường hợp rắn cắn và hỏi bệnh viện gần nhất có huyết thanh kháng nọc rắn.', 'Call 115 for every snakebite and ask for the nearest hospital that stocks antivenom.'),
      steps: [
        S('Đưa người bệnh ra xa con rắn. Không cố bắt hay đập rắn; nếu an toàn, chụp ảnh từ xa để bác sĩ nhận dạng.',
          'Move the person away from the snake. Do not try to catch or kill it; if it is safe, take a photo from a distance to help doctors identify it.', V.snakeAway),
        S('Trấn an, cho người bệnh nằm yên và bất động chi bị cắn bằng nẹp hoặc khăn — càng ít cử động, nọc độc lan càng chậm.',
          'Reassure them, keep them lying still and immobilise the bitten limb with a splint or sling — the less they move, the slower the venom spreads.', V.snakeSplint),
        S('Tháo nhẫn, vòng, đồng hồ, giày và nới quần áo chật ở chi bị cắn trước khi sưng.', 'Remove rings, bracelets, watches and shoes and loosen tight clothing on the bitten limb before it swells.', V.rings),
        S('Ghi lại giờ bị cắn và theo dõi triệu chứng (có thể viết giờ lên da, cạnh vết cắn).', 'Note the time of the bite and track the symptoms (you can write the time on the skin next to the bite).', V.biteTime),
        S('Khiêng hoặc chở người bệnh đến bệnh viện có huyết thanh kháng nọc càng sớm càng tốt, không để họ tự đi bộ. Nếu thở yếu dần hoặc ngừng thở: đã được huấn luyện thì thổi ngạt kèm ép tim; chưa học thì ép tim liên tục.',
          'Carry or drive the person to a hospital with antivenom as soon as possible — do not let them walk. If breathing becomes weak or stops: if you are trained, give rescue breaths with compressions; if not, give continuous compressions.', V.hospOk,
          'Nọc rắn hổ mang phun vào mắt: rửa mắt ngay bằng thật nhiều nước sạch ít nhất 15 phút, không dụi mắt, rồi đi khám.',
          'Cobra venom sprayed into the eyes: rinse right away with plenty of clean water for at least 15 minutes, do not rub, then see a doctor.')
      ],
      red_flags: {
        vi: ['Sưng lan nhanh, bầm tím, rỉ máu không cầm tại vết cắn', 'Sụp mi, nhìn đôi, nói khó, nuốt khó', 'Khó thở, yếu cơ, lơ mơ', 'Chảy máu chân răng, tiểu ra máu', 'Nôn, đau bụng, choáng váng'],
        en: ['Fast-spreading swelling, bruising or oozing that does not stop', 'Drooping eyelids, double vision, slurred speech, trouble swallowing', 'Difficulty breathing, muscle weakness, drowsiness', 'Bleeding gums or blood in the urine', 'Vomiting, belly pain, dizziness']
      },
      donts: {
        vi: ['Không garô, không buộc dây chặt; không băng ép chặt trừ khi nhân viên y tế hướng dẫn', 'Không rạch, chích lể, nặn máu, nặn nọc, hút nọc hay đốt vết cắn', 'Không chườm đá, không đắp lá',
          'Không đến thầy lang, không uống hay đắp thuốc nam thay cho việc đến bệnh viện — mỗi giờ chậm trễ đều nguy hiểm', 'Không uống rượu, không tự dùng aspirin hay thuốc giảm đau chống viêm', 'Không để người bệnh chạy hoặc tự đi bộ'],
        en: ['Do not apply a tourniquet or tie anything tight; no tight pressure bandage unless a health worker tells you to', 'Do not cut, prick, squeeze out blood or venom, suck or burn the bite', 'Do not use ice or leaves',
          'Do not go to a traditional healer or use herbal remedies instead of going to hospital — every hour of delay is dangerous', 'No alcohol, and no aspirin or anti-inflammatory painkillers', 'Do not let the person run or walk']
      },
      sources: ['ifrc2025', 'erc2025', 'who_snake', 'vrc'], related: ['cpr', 'eye'],
      video_query: 'snake bite first aid what to do', updated: UPDATED_RC
    },
    {
      id: 'dogbite', category: 'bites', icon: 'shield-check', priority: 'urgent',
      title: T('Chó, mèo, khỉ cắn (phòng dại)', 'Dog, cat & monkey bites (rabies)'),
      keywords: {
        vi: ['chó cắn', 'mèo cắn', 'khỉ cắn', 'bị cào', 'mèo cào', 'khỉ cào', 'dại', 'bệnh dại', 'tiêm phòng dại', 'huyết thanh kháng dại', 'dơi cắn', 'động vật cắn', 'con vật cắn'],
        en: ['dog bite', 'cat bite', 'monkey bite', 'scratch', 'cat scratch', 'rabies', 'rabies vaccine', 'rabies immunoglobulin', 'animal bite', 'bat bite', 'herpes b']
      },
      summary: T('Bị chó, mèo, khỉ hoặc dơi cắn, cào, hay liếm vào chỗ da trầy xước. Bệnh dại khi đã phát thì gần như luôn tử vong, nhưng có thể phòng được hoàn toàn nếu rửa vết thương và tiêm phòng kịp thời.',
        'Bitten, scratched or licked on broken skin by a dog, cat, monkey or bat. Once symptoms start, rabies is almost always fatal, but it can be fully prevented with prompt wound washing and vaccination.'),
      call115: T('Gọi 115 nếu chảy máu nhiều không cầm hoặc bị cắn sâu ở mặt, cổ. Mọi trường hợp khác: đến cơ sở tiêm phòng dại trong ngày.',
        'Call 115 for heavy bleeding that will not stop or deep bites to the face or neck. In every other case, go to a rabies vaccination clinic the same day.'),
      steps: [
        S('Rửa ngay vết thương dưới vòi nước chảy với xà phòng liên tục trong 15 phút.', 'Immediately wash the wound under running water with soap for a full 15 minutes.', V.washBite),
        S('Sau khi rửa, bôi dung dịch sát khuẩn (povidone-iodine hoặc cồn 70%) nếu có.', 'After washing, apply an antiseptic (povidone-iodine or 70% alcohol) if you have one.', V.antiseptic),
        S('Cầm máu bằng gạc sạch và băng lỏng; không băng kín, không băng chặt.', 'Stop any bleeding with clean gauze and cover loosely; do not seal or bind the wound tightly.', V.looseCover),
        S('Đến cơ sở y tế hoặc điểm tiêm phòng dại càng sớm càng tốt, tốt nhất ngay trong ngày, để được đánh giá tiêm vắc-xin dại, huyết thanh kháng dại (vết cắn, vết cào làm chảy máu hoặc ở đầu, mặt, cổ, bàn tay) và phòng uốn ván.',
          'Go to a clinic or rabies vaccination centre as soon as possible, ideally the same day, to be assessed for rabies vaccine, rabies immunoglobulin (bites or scratches that draw blood, or any on the head, face, neck or hands) and tetanus protection.', V.clinicToday,
          'Đã tiêm phòng dại đủ liều trước chuyến đi vẫn cần tiêm nhắc (thường 2 mũi) nhưng không cần huyết thanh. Nơi khám không có huyết thanh: hỏi chuyển đến Viện Pasteur hoặc trung tâm tiêm chủng lớn. Bị khỉ cắn: báo rõ là khỉ (nguy cơ virus herpes B).',
          'Even with a full pre-trip rabies vaccination you still need booster doses (usually 2), but no immunoglobulin. If the clinic has no immunoglobulin, ask to be referred to a Pasteur Institute or a large vaccination centre. For a monkey bite, tell staff it was a monkey (herpes B risk).'),
        S('Ghi lại thời gian, địa điểm và đặc điểm con vật (có chủ không, đã tiêm phòng chưa) — nhưng không trì hoãn việc đi tiêm để chờ theo dõi con vật.',
          'Note the time, place and details of the animal (owned? vaccinated?) — but do not delay vaccination to wait and watch the animal.', V.dogNote)
      ],
      red_flags: {
        vi: ['Vết cắn sâu, nhiều vết hoặc ở mặt, cổ, bàn tay', 'Chảy máu không cầm', 'Bị dơi cắn, hoặc con vật có biểu hiện bất thường (hung dữ, chảy dãi)', 'Sưng nóng đỏ, có mủ, sốt sau vài ngày'],
        en: ['Deep or multiple bites, or bites to the face, neck or hands', 'Bleeding that will not stop', 'A bat bite, or an animal behaving strangely (aggressive, drooling)', 'Redness, heat, pus or fever in the following days']
      },
      donts: {
        vi: ['Không nặn máu, không đắp lá, tỏi hay thuốc nam lên vết cắn', 'Không băng kín, không tự khâu vết cắn', 'Không chờ xem con vật có chết không rồi mới đi tiêm', 'Không bỏ dở lịch tiêm phòng dại',
          'Không uống thuốc nam, thuốc “chữa dại” hay đến thầy lang thay cho tiêm vắc-xin'],
        en: ['Do not squeeze the wound or put leaves, garlic or herbal remedies on it', 'Do not seal or stitch the bite yourself', 'Do not wait to see whether the animal dies before getting vaccinated', 'Do not skip any dose of the rabies vaccine schedule',
          'Never take herbal “rabies cures” or see a traditional healer instead of getting the vaccine']
      },
      sources: ['ifrc2025', 'who_rabies', 'vrc'], related: ['wound'],
      video_query: 'animal bite first aid rabies wound washing', updated: UPDATED_RC
    },
    {
      id: 'sting', category: 'bites', icon: 'bug', priority: 'common',
      title: T('Ong đốt, côn trùng cắn', 'Bee, wasp & insect stings'),
      keywords: {
        vi: ['ong đốt', 'ong vò vẽ', 'ong bắp cày', 'ong mật', 'kiến cắn', 'côn trùng cắn', 'bọ cạp', 'bò cạp', 'bọ cạp đốt', 'rết cắn', 'sâu róm', 'sưng ngứa'],
        en: ['bee sting', 'wasp sting', 'hornet', 'insect bite', 'ant bite', 'scorpion', 'scorpion sting', 'centipede', 'caterpillar', 'itchy swelling']
      },
      summary: T('Đau buốt, sưng đỏ, ngứa tại chỗ bị đốt. Bị ong vò vẽ, ong bắp cày đốt nhiều nốt có thể gây ngộ độc nặng; người dị ứng có thể bị phản vệ chỉ sau một vết đốt.',
        'Sharp pain, red swelling and itching where stung. Many stings from hornets or wasps can cause serious poisoning; allergic people can develop anaphylaxis after a single sting.'),
      call115: T('Gọi 115 nếu khó thở, sưng môi họng, choáng váng (xem “Phản vệ”), bị đốt vào miệng họng, hoặc bị nhiều ong đốt.',
        'Call 115 for difficulty breathing, swollen lips or throat, dizziness (see “Anaphylaxis”), a sting inside the mouth or throat, or multiple stings.'),
      steps: [
        S('Rời xa tổ ong ngay, đi thật nhanh về phía có mái che hoặc lùm cây rậm; không đập ong.', 'Get away from the nest right away, moving quickly towards shelter or dense bushes; do not swat at the insects.', V.beesAway),
        S('Nếu còn ngòi ong: lấy ra càng sớm càng tốt bằng cách gạt ngang bằng móng tay hoặc thẻ cứng.', 'If a stinger is left in the skin, remove it as soon as possible by scraping sideways with a fingernail or a card.', V.scrape),
        S('Rửa bằng xà phòng và nước sạch, sau đó chườm lạnh bọc vải 10–20 phút để giảm đau, sưng.', 'Wash with soap and clean water, then apply a cloth-wrapped cold pack for 10–20 minutes to ease pain and swelling.', V.coldLimb),
        S('Ngứa nhiều: có thể dùng thuốc kháng histamin theo hướng dẫn trên hộp hoặc hỏi dược sĩ.', 'For strong itching, an antihistamine can be taken as directed on the pack or by a pharmacist.', V.pills),
        S('Theo dõi ít nhất 30–60 phút. Nếu khó thở, sưng môi họng, nổi mẩn toàn thân hoặc choáng: xử trí như phản vệ và gọi 115.',
          'Watch the person for at least 30–60 minutes. If breathing trouble, swollen lips or throat, a widespread rash or dizziness develops, treat it as anaphylaxis and call 115.', V.watchPhone)
      ],
      red_flags: {
        vi: ['Khó thở, khò khè, sưng môi, lưỡi, họng', 'Choáng váng, ngất, nổi mẩn toàn thân', 'Bị đốt vào miệng, họng hoặc mắt', 'Bị ong vò vẽ, ong bắp cày đốt nhiều nốt (kể cả khi chưa có triệu chứng)', 'Tiểu ít, nước tiểu sẫm màu trong 1–2 ngày sau'],
        en: ['Difficulty breathing, wheeze, swollen lips, tongue or throat', 'Dizziness, fainting, a rash all over the body', 'A sting in the mouth, throat or eye', 'Many stings from hornets or wasps (even without symptoms yet)', 'Passing little or dark urine in the next 1–2 days']
      },
      donts: {
        vi: ['Không chần chừ đi tìm dụng cụ — lấy ngòi ngay bằng móng tay', 'Không đắp bùn, lá cây, vôi hay nước tiểu', 'Không gãi mạnh làm trầy da', 'Không chủ quan khi bị nhiều nốt đốt dù thấy vẫn khoẻ'],
        en: ['Do not waste time looking for tools — scrape the stinger out with a fingernail now', 'Do not apply mud, leaves, lime paste or urine', 'Do not scratch hard and break the skin', 'Do not dismiss many stings even if the person feels fine']
      },
      sources: ['ifrc2025', 'erc2025', 'tt51', 'vrc'], related: ['anaphylaxis', 'jellyfish'],
      video_query: 'bee sting first aid remove stinger', updated: UPDATED_RC
    },
    {
      id: 'leech', category: 'bites', icon: 'leaf', priority: 'common',
      title: T('Đỉa, vắt cắn', 'Leech bites'),
      keywords: {
        vi: ['đỉa', 'vắt', 'đỉa cắn', 'vắt cắn', 'bị đỉa bám', 'chảy máu không cầm', 'rừng mùa mưa', 'tất chống đỉa'],
        en: ['leech', 'leech bite', 'land leech', 'bleeding bite', 'jungle', 'rainy season trek', 'leech socks']
      },
      summary: T('Đỉa, vắt bám hút máu khi đi rừng mùa mưa. Thường không nguy hiểm, nhưng vết cắn có thể rỉ máu nhiều giờ vì chất chống đông của đỉa.',
        'Leeches latch on to feed during rainy-season treks. Usually harmless, but the bite can ooze for hours because of the leech’s anticoagulant.'),
      call115: T('Hiếm khi cần gọi 115. Đến cơ sở y tế nếu đỉa chui vào mũi, tai, mắt, họng hoặc bộ phận sinh dục.', 'Rarely needs 115. Go to a medical facility if a leech is inside the nose, ear, eye, throat or genitals.'),
      steps: [
        S('Bình tĩnh, không giật mạnh con đỉa. Tìm đầu nhỏ (miệng hút) của nó.', 'Stay calm and do not yank the leech off. Find its narrow end (the mouth sucker).', V.leechFind),
        S('Luồn móng tay hoặc mép thẻ cứng sát da, gạt ngang dưới miệng hút để tách ra, làm tương tự với đầu còn lại rồi búng con đỉa đi.',
          'Slide a fingernail or the edge of a card along the skin under the mouth sucker to break the seal, do the same at the other end, then flick the leech away.', V.leechCard),
        S('Rửa vết cắn bằng xà phòng và nước sạch, ép gạc lên cho đến khi máu cầm — có thể mất khá lâu.', 'Wash the bite with soap and clean water and press gauze on it until the bleeding stops — this can take a while.', V.leechPress),
        S('Dán băng cá nhân và theo dõi dấu hiệu nhiễm trùng trong vài ngày sau.', 'Put on a plaster and watch for signs of infection over the next few days.', V.leechPlaster),
        S('Phòng đỉa: mang tất chống đỉa, bỏ ống quần vào trong tất, xịt thuốc chống côn trùng lên giày và kiểm tra chân mỗi lần nghỉ.',
          'Prevention: wear leech socks, tuck your trousers into your socks, spray repellent on your shoes and check your legs at every stop.', V.leechSock)
      ],
      red_flags: {
        vi: ['Đỉa chui vào mũi, tai, mắt, họng hoặc bộ phận sinh dục', 'Chảy máu không cầm sau nhiều giờ', 'Sưng nóng đỏ lan rộng, có mủ, sốt', 'Khó thở, sưng mặt (dị ứng — hiếm gặp)'],
        en: ['A leech inside the nose, ear, eye, throat or genitals', 'Bleeding that has not stopped after several hours', 'Spreading redness, heat, pus or fever', 'Difficulty breathing or facial swelling (allergy — rare)']
      },
      donts: {
        vi: ['Không giật mạnh khi đỉa đang bám', 'Không dí thuốc lá, rắc muối hay bôi hoá chất khi đỉa đang bám — đỉa có thể nôn vào vết cắn gây nhiễm trùng', 'Không gãi làm vỡ vết cắn'],
        en: ['Do not yank a leech while it is attached', 'Do not burn it with a cigarette or apply salt or chemicals while it is attached — it may regurgitate into the bite and cause infection', 'Do not scratch the bite open']
      },
      sources: ['ifrc2025', 'vrc'], related: ['wound'],
      video_query: 'how to remove a leech safely', updated: UPDATED
    },
    {
      id: 'jellyfish', category: 'bites', icon: 'waves', priority: 'urgent',
      title: T('Sứa đốt, cầu gai, cá đuối', 'Jellyfish, sea urchins & stingrays'),
      keywords: {
        vi: ['sứa', 'sứa đốt', 'bị sứa đốt', 'sứa lửa', 'sứa hộp', 'cầu gai', 'nhím biển', 'giẫm cầu gai', 'gai cầu gai', 'cá đuối', 'cá đuối đâm', 'cá mao tiên', 'cá mặt quỷ',
          'san hô cắt', 'tắm biển bị đốt'],
        en: ['jellyfish', 'jellyfish sting', 'box jellyfish', 'sea urchin', 'urchin spines', 'stingray', 'lionfish', 'stonefish', 'coral cut', 'marine sting', 'sea sting']
      },
      summary: T('Tắm biển có thể bị sứa đốt: đau rát dữ dội, vệt đỏ như bị roi quất, có khi còn dính xúc tu. Sứa hộp có thể gây khó thở, ngừng tim chỉ sau vài phút. Giẫm phải cầu gai, bị cá đuối hay cá mặt quỷ đâm gây đau dữ dội tại chỗ.',
        'Swimming in the sea can bring jellyfish stings: intense burning pain and red, whip-like lines, sometimes with tentacles still stuck on. Box jellyfish can cause breathing trouble or cardiac arrest within minutes. Stepping on a sea urchin or being stung by a stingray or stonefish causes severe local pain.'),
      call115: T('Gọi 115 nếu khó thở, đau ngực, choáng, lơ mơ, co giật hoặc bất tỉnh; vết sứa đốt dài, rộng (hơn nửa cánh tay, cẳng chân) hoặc ở mặt, cổ; người bị đốt là trẻ nhỏ; hoặc bị cá đuối đâm vào ngực, bụng, cổ.',
        'Call 115 for breathing trouble, chest pain, faintness, drowsiness, seizures or unresponsiveness; long or large jellyfish stings (more than half an arm or leg) or stings on the face or neck; a sting in a young child; or a stingray wound to the chest, belly or neck.'),
      steps: [
        S('Đưa người bệnh ra khỏi nước an toàn, cho ngồi hoặc nằm yên. Theo dõi nhịp thở; nếu bất tỉnh và không thở bình thường: gọi 115 và ép tim ngay.',
          'Get the person safely out of the water and keep them sitting or lying still. Watch their breathing; if they become unresponsive and are not breathing normally, call 115 and start CPR.', V.jellyOut),
        S('Sứa đốt: dội giấm ăn lên vết đốt ít nhất 30 giây để các nang độc còn bám không phóng thêm. Không có giấm: dội nước biển.',
          'Jellyfish sting: pour household vinegar over it for at least 30 seconds so the stinging cells still on the skin do not fire. No vinegar: rinse with seawater.', V.vinegar),
        S('Gỡ các xúc tu còn bám bằng nhíp, mép thẻ cứng hoặc tay đeo găng — không dùng tay trần.',
          'Lift off any tentacles still stuck on with tweezers, the edge of a card or gloved hands — never with bare hands.', V.tentacle),
        S('Giảm đau: ngâm vùng bị đốt vào nước nóng mà tay người giúp chịu được (khoảng 40–45 °C, không gây bỏng) trong 20 phút. Không có nước nóng: chườm lạnh bọc vải.',
          'Ease the pain by soaking the area in water as hot as the helper’s hand can comfortably stand (about 40–45 °C, never scalding) for 20 minutes. No hot water: use a cloth-wrapped cold pack.', V.hotWater,
          'Giẫm cầu gai, bị cá đuối hoặc cá mặt quỷ đâm: ngâm nước nóng như trên trong 30–90 phút cũng giảm đau rõ.',
          'Sea urchin, stingray or stonefish wounds: soaking in hot water in the same way for 30–90 minutes also eases the pain a lot.'),
        S('Gai cầu gai cắm sâu, vết cá đuối đâm: rửa sạch, không cố moi gai sâu, đến cơ sở y tế để lấy gai, làm sạch vết thương và phòng uốn ván.',
          'Deep sea-urchin spines or a stingray wound: rinse it, do not dig out deep spines, and go to a medical facility to have them removed, the wound cleaned and tetanus covered.', V.urchin),
        S('Theo dõi ít nhất 30–60 phút. Nổi mẩn toàn thân, sưng môi, khó thở, đau lưng hoặc đau bụng dữ dội, vã mồ hôi: gọi 115 (xem “Phản vệ”).',
          'Watch the person for at least 30–60 minutes. A rash all over, swollen lips, breathing trouble, severe back or belly pain or heavy sweating: call 115 (see “Anaphylaxis”).', V.watchPhone)
      ],
      red_flags: {
        vi: ['Khó thở, đau ngực, tim đập nhanh', 'Choáng, lơ mơ, co giật, bất tỉnh', 'Vết đốt dài, rộng hoặc ở mặt, cổ; người bị đốt là trẻ nhỏ',
          'Đau lưng, đau bụng dữ dội, vã mồ hôi, buồn nôn tăng dần sau 30–60 phút', 'Cá đuối đâm vào ngực, bụng, cổ; gai cắm sâu gần khớp'],
        en: ['Breathing trouble, chest pain, a racing heart', 'Faintness, drowsiness, seizures or unresponsiveness', 'Long or large stings, stings on the face or neck, or a young child stung',
          'Severe back or belly pain, sweating and nausea building up over 30–60 minutes', 'A stingray wound to the chest, belly or neck; spines deep near a joint']
      },
      donts: {
        vi: ['Không dội nước ngọt, không xoa cát hay chà xát vết sứa đốt', 'Không đi tiểu lên vết đốt, không bôi rượu, cồn', 'Không gỡ xúc tu bằng tay trần', 'Không băng ép chặt vết sứa đốt',
          'Không rút gai cá đuối đang cắm ở ngực, bụng, cổ'],
        en: ['Do not rinse with fresh water or rub the sting with sand', 'Do not urinate on the sting or apply alcohol', 'Do not remove tentacles with bare hands', 'Do not put a tight pressure bandage on a jellyfish sting',
          'Do not pull out a stingray barb stuck in the chest, belly or neck']
      },
      sources: ['ifrc2025', 'vrc'], related: ['anaphylaxis', 'sting', 'cpr'],
      video_query: 'jellyfish sting first aid vinegar hot water', updated: UPDATED_110
    },

    /* ---------------------------------------------------------------- medical */
    {
      id: 'stroke', category: 'medical', icon: 'brain', priority: 'critical',
      title: T('Đột quỵ (BE-FAST)', 'Stroke (BE-FAST)'),
      keywords: {
        vi: ['đột quỵ', 'đột quị', 'tai biến', 'tai biến mạch máu não', 'méo miệng', 'yếu nửa người', 'liệt nửa người', 'tê nửa người', 'nói ngọng', 'nói khó', 'mất thăng bằng', 'mờ mắt',
          'đau đầu dữ dội đột ngột', 'be fast'],
        en: ['stroke', 'be fast', 'fast test', 'face drooping', 'arm weakness', 'one-sided weakness', 'slurred speech', 'loss of balance', 'vision loss', 'brain attack', 'sudden severe headache']
      },
      summary: T('Triệu chứng xuất hiện đột ngột: mất thăng bằng, mờ mắt, méo miệng, yếu tay chân một bên, nói khó. Được điều trị càng sớm, não càng được cứu nhiều.',
        'Symptoms start suddenly: loss of balance, blurred vision, facial droop, one-sided weakness, trouble speaking. The sooner treatment starts, the more brain is saved.'),
      call115: T('Gọi 115 ngay khi có bất kỳ dấu hiệu BE-FAST nào, kể cả khi triệu chứng tự hết.', 'Call 115 immediately for any BE-FAST sign, even if the symptoms go away.'),
      steps: [
        S('B – Balance (Thăng bằng): đột ngột chóng mặt, đi loạng choạng, mất thăng bằng?', 'B – Balance: sudden dizziness, staggering or loss of balance?', V.balance),
        S('E – Eyes (Mắt): đột ngột nhìn mờ, nhìn đôi hoặc mất thị lực một bên?', 'E – Eyes: sudden blurred or double vision, or loss of sight in one eye?', V.eyes),
        S('F – Face (Mặt): nhờ người bệnh cười — một bên miệng có bị méo, xệ xuống không?', 'F – Face: ask them to smile — does one side of the mouth droop?', V.faceDroop),
        S('A – Arm (Tay): nhờ giơ hai tay ra trước trong 10 giây — có một tay yếu, rơi xuống không?', 'A – Arm: ask them to hold both arms out for 10 seconds — does one arm drift down?', V.armDrift),
        S('S – Speech (Lời nói): nhờ nhắc lại một câu đơn giản — nói ngọng, khó nói hoặc nói sai từ?', 'S – Speech: ask them to repeat a simple sentence — is the speech slurred, difficult or muddled?', V.speech),
        S('T – Time (Thời gian): gọi 115 ngay và ghi lại lần cuối cùng thấy người bệnh còn hoàn toàn bình thường (nếu ngủ dậy mới thấy triệu chứng thì tính từ lúc đi ngủ) — bác sĩ cần mốc này để chọn cách điều trị. Cho nằm nghỉ, đầu hơi cao; nếu lơ mơ hoặc nôn thì nằm nghiêng. Không cho ăn, uống hay dùng thuốc.',
          'T – Time: call 115 now and write down the last time the person was seen completely normal (if they woke up with symptoms, use the time they went to sleep) — doctors need this to choose treatment. Let them rest with the head slightly raised, or on their side if drowsy or vomiting. Give nothing to eat, drink or any medicine.', V.timeCall)
      ],
      red_flags: {
        vi: ['Bất kỳ dấu hiệu BE-FAST nào xuất hiện đột ngột', 'Đau đầu dữ dội đột ngột, chưa từng bị như vậy', 'Co giật, lơ mơ, bất tỉnh', 'Nôn liên tục'],
        en: ['Any BE-FAST sign that appears suddenly', 'A sudden, severe headache unlike any before', 'Seizure, drowsiness or unresponsiveness', 'Repeated vomiting']
      },
      donts: {
        vi: ['Không chờ xem triệu chứng có tự hết không', 'Không cho ăn uống, không cho uống thuốc hạ huyết áp hay aspirin khi chưa có chỉ định', 'Không chích máu đầu ngón tay, cạo gió, bấm huyệt', 'Không để người bệnh tự chạy xe đến viện'],
        en: ['Do not wait to see if the symptoms pass', 'Do not give food, drink, blood-pressure pills or aspirin unless a doctor says so', 'Do not prick the fingertips, scrape the skin or use acupressure', 'Do not let the person ride or drive to hospital']
      },
      sources: ['erc2025', 'vrc'], related: ['recovery'],
      video_query: 'BE FAST stroke signs', updated: UPDATED_RC
    },
    {
      id: 'chestpain', category: 'medical', icon: 'heart', priority: 'critical',
      title: T('Đau ngực nghi nhồi máu cơ tim', 'Chest pain (possible heart attack)'),
      keywords: {
        vi: ['đau ngực', 'tức ngực', 'nhồi máu cơ tim', 'đau tim', 'đau lan tay trái', 'đau lan hàm', 'khó thở', 'vã mồ hôi', 'aspirin'],
        en: ['chest pain', 'heart attack', 'chest tightness', 'chest pressure', 'myocardial infarction', 'pain spreading to arm', 'aspirin', 'cardiac']
      },
      summary: T('Đau, đè nặng hoặc bóp nghẹt giữa ngực kéo dài vài phút, có thể lan ra tay, cổ, hàm, lưng; kèm khó thở, vã mồ hôi, buồn nôn hoặc choáng.',
        'Pain, pressure or squeezing in the centre of the chest lasting several minutes, possibly spreading to the arm, neck, jaw or back, with breathlessness, sweating, nausea or light-headedness.'),
      call115: T('Gọi 115 ngay — không tự chạy xe máy đến viện.', 'Call 115 immediately — do not ride or drive to hospital yourself.'),
      steps: [
        S('Cho người bệnh ngừng mọi hoạt động, ngồi nghỉ ở tư thế dễ chịu nhất (thường là nửa ngồi, tựa lưng) và nới lỏng quần áo.',
          'Stop all activity and let the person rest in the most comfortable position (usually half-sitting with the back supported); loosen tight clothing.', V.sitRest),
        S('Gọi 115 và mô tả rõ: đau ngực, bắt đầu lúc mấy giờ, tuổi, bệnh tim sẵn có.', 'Call 115 and describe clearly: chest pain, when it started, the person’s age and any known heart disease.', V.timeCall),
        S('Aspirin chỉ dùng khi người bệnh là người lớn, tỉnh táo, không dị ứng aspirin, không đang chảy máu và điều phối viên 115 hoặc bác sĩ đồng ý: nhai (không nuốt nguyên viên) 150–300 mg — ví dụ 2–3 viên loại 81 mg hoặc 100 mg.',
          'Aspirin only if the person is an adult, fully alert, not allergic to aspirin, not bleeding, and the 115 dispatcher or a doctor agrees: chew (do not swallow whole) 150–300 mg — for example 2–3 tablets of 81 mg or 100 mg.', V.aspirin,
          'Liều 150–300 mg dạng nhai theo ERC 2025. Chỉ có viên 500 mg hoặc viên bao tan trong ruột (như “Aspirin pH8”): hỏi điều phối viên nên dùng thế nào. Nếu người bệnh có thuốc tim được bác sĩ kê (ví dụ viên ngậm dưới lưỡi), giúp họ dùng đúng theo đơn.',
          'The 150–300 mg chewed dose follows ERC 2025. If you only have 500 mg or enteric-coated tablets (e.g. “Aspirin pH8”), ask the dispatcher what to give. If the person has heart medicine prescribed by their doctor (e.g. a tablet under the tongue), help them take it exactly as prescribed.'),
        S('Ở cạnh người bệnh, theo dõi ý thức và nhịp thở; nhờ người tìm máy AED nếu có.', 'Stay with the person, watch their alertness and breathing, and send someone for an AED if one is available.', V.sitAed),
        S('Nếu người bệnh bất tỉnh và không thở bình thường: bắt đầu ép tim ngay (xem CPR).', 'If they become unresponsive and are not breathing normally, start CPR immediately.', V.cprPush)
      ],
      red_flags: {
        vi: ['Đau ngực kéo dài trên 5 phút hoặc tái đi tái lại', 'Đau lan ra tay, cổ, hàm, lưng', 'Khó thở, vã mồ hôi lạnh, buồn nôn, choáng', 'Ngất, bất tỉnh', 'Tim đập rất nhanh, rất chậm hoặc không đều'],
        en: ['Chest pain lasting more than 5 minutes or coming back', 'Pain spreading to the arm, neck, jaw or back', 'Breathlessness, cold sweat, nausea, light-headedness', 'Fainting or unresponsiveness', 'A very fast, very slow or irregular heartbeat']
      },
      donts: {
        vi: ['Không để người bệnh đi lại, leo dốc hay tự chạy xe', 'Không cho aspirin nếu dị ứng, đang chảy máu, đau do chấn thương hoặc là trẻ em', 'Không chờ cơn đau tự hết mới gọi 115', 'Không cho ăn uống no'],
        en: ['Do not let the person walk, climb or ride', 'No aspirin if allergic, bleeding, the pain is from an injury, or for children', 'Do not wait for the pain to pass before calling 115', 'Do not give a heavy meal or drink']
      },
      sources: ['erc2025', 'vrc'], related: ['cpr'],
      video_query: 'heart attack symptoms first aid', updated: UPDATED_110
    },
    {
      id: 'asthma', category: 'medical', icon: 'wind', priority: 'urgent',
      title: T('Cơn hen suyễn', 'Asthma attack'),
      keywords: {
        vi: ['hen', 'hen suyễn', 'suyễn', 'cơn hen', 'lên cơn hen', 'hen phế quản', 'khò khè', 'thở rít', 'khó thở', 'thuốc xịt hen', 'bình xịt hen', 'bình hít', 'ventolin', 'salbutamol'],
        en: ['asthma', 'asthma attack', 'inhaler', 'puffer', 'reliever', 'wheeze', 'wheezing', 'shortness of breath', 'short of breath', 'breathless', 'tight chest', 'ventolin', 'salbutamol', 'albuterol']
      },
      summary: T('Người có bệnh hen đột ngột khó thở, khò khè, ho, tức ngực, chỉ nói được từng câu ngắn. Khói, bụi, không khí lạnh, gắng sức hoặc cảm cúm có thể khởi phát cơn. Cơn hen nặng có thể đe doạ tính mạng.',
        'A person with asthma suddenly becomes breathless, wheezes, coughs, feels a tight chest and can only speak in short phrases. Smoke, dust, cold air, exertion or a cold can set it off. A severe attack can be life-threatening.'),
      call115: T('Gọi 115 nếu xịt 10 nhát thuốc cắt cơn vẫn không đỡ, người bệnh không nói được thành câu, môi tím tái, mệt lả, lơ mơ, hoặc đang khó thở nhiều mà không có thuốc xịt.',
        'Call 115 if 10 puffs of the reliever inhaler have not helped, or the person cannot finish a sentence, has blue lips, is exhausted or drowsy, or is badly short of breath with no inhaler.'),
      steps: [
        S('Giữ bình tĩnh, cho người bệnh ngồi thẳng, hơi cúi ra trước, tay tì lên đùi hoặc bàn; nới lỏng quần áo. Đưa ra xa khói, bụi, bếp than.',
          'Stay calm and sit the person upright, leaning slightly forward with their hands on their knees or a table; loosen tight clothing. Move them away from smoke, dust or a charcoal stove.', V.astSit),
        S('Giúp người bệnh dùng thuốc xịt cắt cơn của chính họ (thường là bình màu xanh): lắc bình, xịt 1 nhát và hít vào chậm, sâu — qua buồng đệm nếu có. Cứ 30–60 giây xịt thêm 1 nhát, tối đa 10 nhát.',
          'Help them use their own reliever inhaler (usually blue): shake it, give 1 puff and breathe in slowly and deeply — through a spacer if they have one. Give 1 more puff every 30–60 seconds, up to 10 puffs.', V.inhalerUse,
          'Nếu người bệnh có kế hoạch xử trí hen do bác sĩ lập, làm đúng theo kế hoạch đó. Chỉ dùng thuốc được kê cho chính người bệnh.',
          'If they have a written asthma action plan from their doctor, follow it exactly. Only use medicine prescribed for that person.'),
        S('Sau 10 nhát vẫn không đỡ, hoặc có bất kỳ dấu hiệu nguy hiểm nào: gọi 115. Nếu sau 10 phút xe cấp cứu chưa tới mà vẫn khó thở, lặp lại tối đa 10 nhát như trên.',
          'If there is no improvement after 10 puffs, or any danger sign appears, call 115. If the ambulance has not arrived after 10 minutes and they are still struggling, repeat up to 10 puffs as above.', V.inhalerCall,
          'Đã đỡ nhưng phải xịt lại trong vòng 4 giờ, hoặc cơn nặng hơn mọi khi: vẫn đi khám ngay trong ngày.',
          'Better now but needing the inhaler again within 4 hours, or worse than their usual attacks? Still see a doctor the same day.'),
        S('Không có thuốc xịt: gọi 115, giữ người bệnh ngồi thẳng, trấn an và hướng dẫn thở chậm; ở bên cạnh đến khi có người hỗ trợ.',
          'No inhaler: call 115, keep the person sitting upright, reassure them and coach slow breathing; stay with them until help arrives.', V.sitRest),
        S('Nếu người bệnh lả đi, bất tỉnh và không thở bình thường: bắt đầu ép tim ngay (xem CPR).',
          'If they collapse, become unresponsive and are not breathing normally, start CPR straight away.', V.cprPhone)
      ],
      red_flags: {
        vi: ['Không nói được thành câu, phải dừng lại để thở', 'Môi, đầu ngón tay tím tái hoặc xám', 'Xịt 10 nhát thuốc cắt cơn không đỡ', 'Mệt lả, lơ mơ, lú lẫn',
          'Tiếng khò khè nhỏ dần nhưng người bệnh mệt hơn (không phải đang đỡ)', 'Hõm cổ, khe sườn lõm sâu mỗi lần hít vào'],
        en: ['Cannot finish a sentence, stops to breathe', 'Blue or grey lips or fingertips', 'No relief after 10 puffs of the reliever', 'Exhaustion, drowsiness or confusion',
          'The wheeze gets quieter while the person gets more tired (this is not improvement)', 'Skin sucking in at the base of the neck and between the ribs with each breath']
      },
      donts: {
        vi: ['Không để người bệnh nằm ngửa — để ngồi thẳng, hơi cúi ra trước', 'Không để người bệnh ở một mình hay tự đi bộ, leo dốc tìm trợ giúp', 'Không cho uống thuốc ngủ, thuốc an thần',
          'Không xông lá, cạo gió, xoa dầu gió thay cho thuốc xịt cắt cơn', 'Không chờ quá lâu: xịt 10 nhát chưa đỡ là phải gọi 115'],
        en: ['Do not lay the person flat — keep them sitting upright, leaning slightly forward', 'Do not leave them alone or let them walk or climb to get help', 'Do not give sleeping pills or sedatives',
          'Do not use herbal steam, coin-rubbing or medicated oil instead of the reliever inhaler', 'Do not wait too long: no relief after 10 puffs means call 115']
      },
      sources: ['erc2025', 'ifrc2025', 'vrc'], related: ['anaphylaxis', 'cpr'],
      video_query: 'asthma attack first aid inhaler spacer', updated: UPDATED_110
    },
    {
      id: 'seizure', category: 'medical', icon: 'zap', priority: 'urgent',
      title: T('Co giật, động kinh', 'Seizures'),
      keywords: {
        vi: ['co giật', 'động kinh', 'lên cơn', 'giật tay chân', 'sùi bọt mép', 'cắn lưỡi', 'sốt cao co giật', 'lên cơn động kinh'],
        en: ['seizure', 'epilepsy', 'convulsion', 'fit', 'shaking', 'foaming at mouth', 'febrile seizure']
      },
      summary: T('Người bệnh đột ngột co cứng, giật tay chân, có thể mất ý thức, sùi bọt mép, cắn lưỡi hoặc tiểu không tự chủ. Đa số cơn tự hết trong vài phút.',
        'The person suddenly stiffens and jerks, may lose consciousness, foam at the mouth, bite their tongue or wet themselves. Most seizures stop on their own within a few minutes.'),
      call115: T('Gọi 115 nếu cơn kéo dài trên 5 phút, lên cơn liên tiếp không tỉnh, co giật lần đầu, bị thương, xảy ra dưới nước, hoặc khó thở sau cơn.',
        'Call 115 if the seizure lasts more than 5 minutes, repeats without waking, is a first seizure, causes an injury, happens in water, or breathing is difficult afterwards.'),
      steps: [
        S('Bình tĩnh, ghi lại giờ bắt đầu cơn.', 'Stay calm and note the time the seizure starts.', V.seizureClock),
        S('Dẹp vật cứng, sắc nhọn xung quanh; kê áo hoặc vật mềm dưới đầu. Không ghì giữ tay chân.', 'Move hard or sharp objects away and put something soft (a jacket) under the head. Do not hold the limbs down.', V.cushion),
        S('Không nhét bất cứ thứ gì vào miệng (đũa, khăn, ngón tay).', 'Do not put anything in their mouth (chopsticks, cloth, fingers).', V.noMouth),
        S('Khi hết giật: đặt nằm nghiêng an toàn, kiểm tra nhịp thở và ở bên cạnh đến khi người bệnh tỉnh hẳn.', 'When the jerking stops, place them in the recovery position, check breathing and stay until they are fully awake.', V.recovClock),
        S('Nếu cơn kéo dài trên 5 phút hoặc có dấu hiệu nguy hiểm: gọi 115.', 'If the seizure lasts more than 5 minutes or there are danger signs, call 115.', V.timeCall)
      ],
      red_flags: {
        vi: ['Cơn kéo dài trên 5 phút', 'Lên cơn liên tiếp mà không tỉnh lại giữa các cơn', 'Co giật lần đầu, hoặc kèm sốt cao, chấn thương đầu', 'Khó thở, tím tái sau cơn', 'Xảy ra dưới nước hoặc ở phụ nữ có thai'],
        en: ['A seizure lasting more than 5 minutes', 'Repeated seizures without waking in between', 'A first-ever seizure, or one with high fever or a head injury', 'Difficulty breathing or blue lips afterwards', 'A seizure in water or during pregnancy']
      },
      donts: {
        vi: ['Không nhét vật vào miệng, không cố cạy miệng', 'Không ghì giữ tay chân', 'Không đổ nước hay thuốc vào miệng khi chưa tỉnh', 'Không bấm huyệt, cạo gió, chích máu', 'Không để người bệnh ở một mình ngay sau cơn'],
        en: ['Do not put anything in the mouth or force it open', 'Do not restrain the limbs', 'Do not give water or medicine until fully awake', 'No acupressure, skin scraping or finger pricking', 'Do not leave the person alone right after the seizure']
      },
      sources: ['erc2025', 'ifrc2025', 'vrc'], related: ['recovery'],
      video_query: 'seizure first aid what to do', updated: UPDATED
    },
    {
      id: 'hypoglycemia', category: 'medical', icon: 'gauge', priority: 'urgent',
      title: T('Hạ đường huyết', 'Low blood sugar (hypoglycaemia)'),
      keywords: {
        vi: ['hạ đường huyết', 'tụt đường', 'hạ đường', 'tiểu đường', 'đái tháo đường', 'run tay', 'vã mồ hôi', 'đói lả', 'insulin', 'choáng khi leo núi'],
        en: ['hypoglycemia', 'hypoglycaemia', 'low blood sugar', 'diabetes', 'diabetic', 'insulin', 'shaky', 'sweaty', 'hungry and weak']
      },
      summary: T('Hay gặp ở người tiểu đường đang dùng thuốc hoặc insulin, hoặc khi vận động lâu mà ăn ít: run tay, vã mồ hôi, đói cồn cào, tái, cáu gắt, lú lẫn, hành vi như say rượu.',
        'Common in people with diabetes on tablets or insulin, or after long exertion with little food: shakiness, sweating, strong hunger, pallor, irritability, confusion, acting drunk.'),
      call115: T('Gọi 115 nếu người bệnh lơ mơ, co giật, không nuốt được hoặc không đỡ sau 2 lần cho đường.', 'Call 115 if the person is drowsy, has a seizure, cannot swallow, or is not better after two doses of sugar.'),
      steps: [
        S('Nếu tỉnh táo và nuốt được: cho ngồi nghỉ và cho ngay 15–20 g đường — viên glucose, 4–5 viên đường, 1 thìa canh mật ong, hoặc 150–200 ml nước ngọt, nước trái cây (không dùng loại ăn kiêng).',
          'If alert and able to swallow, sit them down and give 15–20 g of sugar straight away — glucose tablets, 4–5 sugar cubes, a tablespoon of honey, or 150–200 ml of fruit juice or a regular soft drink (not diet).', V.sugar),
        S('Chờ 10–15 phút. Nếu chưa đỡ, cho thêm 15–20 g đường một lần nữa.', 'Wait 10–15 minutes. If there is no improvement, give another 15–20 g of sugar.', V.sugarClock),
        S('Khi đã đỡ, cho ăn thêm đồ có tinh bột (bánh mì, bánh quy, cơm) để đường huyết không tụt lại.', 'Once better, give a starchy snack (bread, biscuits, rice) so the sugar level does not drop again.', V.bread),
        S('Nếu lơ mơ, không nuốt được hoặc bất tỉnh: không cho gì vào miệng, đặt nằm nghiêng an toàn và gọi 115.', 'If drowsy, unable to swallow or unresponsive, put nothing in the mouth, place them in the recovery position and call 115.', V.recovPhone)
      ],
      red_flags: {
        vi: ['Lơ mơ, lú lẫn nặng, không làm theo lời nói', 'Co giật hoặc bất tỉnh', 'Không đỡ sau 2 lần cho đường', 'Tái diễn nhiều lần trong ngày'],
        en: ['Drowsiness or severe confusion, not following instructions', 'Seizure or unresponsiveness', 'No improvement after two doses of sugar', 'Repeated episodes in one day']
      },
      donts: {
        vi: ['Không đổ nước đường hay thức ăn vào miệng người lơ mơ, bất tỉnh', 'Không dùng đồ uống ăn kiêng, không đường', 'Không để người bệnh lái xe ngay khi vừa đỡ', 'Không tiêm thêm insulin'],
        en: ['Do not pour sugary drinks or food into the mouth of a drowsy or unresponsive person', 'Do not use diet or sugar-free drinks', 'Do not let the person ride or drive right after recovering', 'Do not give extra insulin']
      },
      sources: ['erc2025', 'vrc'], related: ['recovery', 'fainting'],
      video_query: 'low blood sugar hypoglycemia first aid', updated: UPDATED_110
    },
    {
      id: 'fainting', category: 'medical', icon: 'user', priority: 'common',
      title: T('Ngất, xỉu', 'Fainting'),
      keywords: {
        vi: ['ngất', 'xỉu', 'choáng', 'tối sầm mắt', 'hoa mắt', 'mất ý thức ngắn', 'đứng lâu', 'say nắng nhẹ'],
        en: ['faint', 'fainting', 'syncope', 'passed out', 'light-headed', 'dizzy', 'blackout', 'collapse']
      },
      summary: T('Mất ý thức ngắn (thường dưới 1 phút) do não tạm thời thiếu máu, hay gặp khi đứng lâu, trời nóng, đói, mất nước, sợ hãi. Trước khi ngất thường thấy choáng, vã mồ hôi, tối sầm mắt.',
        'A brief loss of consciousness (usually under a minute) caused by a temporary drop in blood flow to the brain — often from standing a long time, heat, hunger, dehydration or fright. It is usually preceded by light-headedness, sweating and dimming vision.'),
      call115: T('Gọi 115 nếu không tỉnh lại sau 1 phút, ngất khi đang gắng sức, kèm đau ngực, khó thở, co giật, hoặc bị thương khi ngã.',
        'Call 115 if they do not wake within a minute, fainted during exertion, or have chest pain, breathlessness, a seizure or an injury from the fall.'),
      steps: [
        S('Khi thấy choáng, tối sầm mắt: ngồi xổm hoặc nằm xuống ngay. Có thể bắt chéo chân và gồng chặt cơ đùi, hoặc móc hai tay vào nhau kéo căng để chống ngất.',
          'At the first light-headedness or dimming vision, squat or lie down straight away. Crossing the legs while tensing the thigh muscles, or hooking the hands together and pulling, can help prevent fainting.', V.sitDown),
        S('Nếu đã ngất: đặt nằm ngửa, kê hai chân cao khoảng 30 cm (lên ba lô), nới lỏng quần áo, giữ nơi thoáng mát.',
          'If they have fainted, lay them on their back, raise the legs about 30 cm (on a backpack), loosen tight clothing and keep the area cool and airy.', V.legsUp),
        S('Kiểm tra nhịp thở. Không tỉnh sau 1 phút nhưng còn thở: đặt nằm nghiêng an toàn và gọi 115; nếu không thở: ép tim ngay.',
          'Check breathing. If they have not woken after a minute but are breathing, place them in the recovery position and call 115; if not breathing, start CPR.', V.recovPhone),
        S('Khi đã tỉnh: cho ngồi dậy từ từ, nghỉ vài phút rồi mới đứng; cho uống nước hoặc đồ uống ngọt khi hoàn toàn tỉnh táo.',
          'Once awake, help them sit up slowly and rest for a few minutes before standing; give water or a sweet drink once fully alert.', V.sip)
      ],
      red_flags: {
        vi: ['Không tỉnh lại sau 1 phút', 'Ngất khi đang gắng sức (leo dốc, chạy)', 'Kèm đau ngực, hồi hộp, khó thở', 'Bị va đập đầu khi ngã', 'Người lớn tuổi, phụ nữ có thai hoặc ngất nhiều lần'],
        en: ['Not waking up within a minute', 'Fainting during exertion (climbing, running)', 'Chest pain, palpitations or breathlessness', 'A head injury from the fall', 'Older people, pregnancy or repeated fainting']
      },
      donts: {
        vi: ['Không đỡ người bệnh ngồi hoặc đứng dậy ngay', 'Không tát, không dội nước lạnh vào mặt', 'Không cạo gió, bấm huyệt nhân trung thay cho việc kiểm tra nhịp thở', 'Không cho ăn uống khi chưa tỉnh hẳn'],
        en: ['Do not sit or stand the person up straight away', 'Do not slap them or throw cold water on their face', 'Do not rely on coin-rubbing (cạo gió) or acupressure instead of checking breathing', 'Do not give food or drink until fully awake']
      },
      sources: ['erc2025', 'ifrc2025', 'vrc'], related: ['recovery', 'hypoglycemia'],
      video_query: 'fainting first aid legs raised', updated: UPDATED_110
    },
    {
      id: 'dehydration', category: 'medical', icon: 'droplet', priority: 'common',
      title: T('Mất nước, tiêu chảy', 'Dehydration & diarrhoea'),
      keywords: {
        vi: ['mất nước', 'tiêu chảy', 'đi ngoài', 'ngộ độc thực phẩm', 'nôn', 'ói', 'đau bụng', 'oresol', 'ors', 'khát nước', 'tiểu ít'],
        en: ['dehydration', 'diarrhea', 'diarrhoea', 'food poisoning', 'vomiting', 'ors', 'oral rehydration', 'travellers diarrhoea', 'upset stomach', 'stomach ache', 'belly pain', 'abdominal pain']
      },
      summary: T('Tiêu chảy, nôn hoặc ra nhiều mồ hôi làm cơ thể mất nước: khát, môi khô, tiểu ít và sẫm màu, mệt, chóng mặt khi đứng dậy.',
        'Diarrhoea, vomiting or heavy sweating drain the body of fluid: thirst, dry lips, little dark urine, tiredness and dizziness when standing up.'),
      call115: T('Gọi 115 hoặc đến cơ sở y tế ngay nếu người bệnh lơ mơ, không uống được, không đi tiểu hơn 8 giờ, hoặc đi ngoài ra máu.',
        'Call 115 or go to a medical facility at once if the person is drowsy, cannot drink, has not passed urine for more than 8 hours, or has bloody stools.'),
      steps: [
        S('Pha oresol với đúng lượng nước ghi trên gói, dùng nước sạch đã đun sôi để nguội; dùng hết trong 24 giờ.',
          'Mix oral rehydration salts (ORS) with exactly the amount of clean, boiled and cooled water printed on the packet; use it within 24 hours.', V.ors),
        S('Uống từng ngụm nhỏ, đều đặn. Nếu nôn, chờ 5–10 phút rồi uống tiếp chậm hơn. Mỗi lần đi ngoài phải uống bù thêm.',
          'Drink small sips often. If vomiting, wait 5–10 minutes, then continue more slowly. Drink extra after every loose stool.', V.sips),
        S('Tiếp tục ăn nhẹ, dễ tiêu (cháo, cơm, chuối, bánh quy) và nghỉ ở nơi mát.', 'Keep eating light, easy food (rice porridge, rice, bananas, crackers) and rest somewhere cool.', V.food),
        S('Rửa tay bằng xà phòng sau khi đi vệ sinh và trước khi ăn; chỉ uống nước đóng chai hoặc đã đun sôi.', 'Wash your hands with soap after the toilet and before eating; drink only bottled or boiled water.', V.washHands),
        S('Đến cơ sở y tế nếu không đỡ sau 2 ngày, sốt cao, đau bụng dữ dội, hoặc người bệnh là trẻ nhỏ, người già, phụ nữ có thai.',
          'See a doctor if there is no improvement after 2 days, a high fever or severe belly pain, or if the person is a young child, elderly or pregnant.', V.clinicFever)
      ],
      red_flags: {
        vi: ['Lơ mơ, lừ đừ, mắt trũng, môi rất khô', 'Không uống được hoặc nôn ra hết', 'Không đi tiểu hơn 8 giờ', 'Đi ngoài ra máu hoặc phân đen', 'Sốt cao, đau bụng dữ dội'],
        en: ['Drowsiness, sunken eyes, very dry lips', 'Unable to drink or vomiting everything', 'No urine for more than 8 hours', 'Bloody or black stools', 'High fever or severe belly pain']
      },
      donts: {
        vi: ['Không pha oresol đặc hơn hay loãng hơn hướng dẫn', 'Không thay oresol bằng nước ngọt có ga hay nước tăng lực', 'Không tự dùng thuốc cầm tiêu chảy khi đi ngoài ra máu hoặc sốt cao', 'Không nhịn ăn kéo dài'],
        en: ['Do not make ORS stronger or weaker than directed', 'Do not replace ORS with fizzy or energy drinks', 'Do not take anti-diarrhoea tablets if there is blood in the stool or a high fever', 'Do not stop eating for long periods']
      },
      sources: ['ifrc2025', 'vrc'], related: ['heatstroke', 'poisoning', 'fever'],
      video_query: 'oral rehydration solution how to prepare', updated: UPDATED_110
    },
    {
      id: 'poisoning', category: 'medical', icon: 'bottle', priority: 'critical',
      title: T('Ngộ độc: rượu giả, nấm rừng, thuốc trừ sâu', 'Poisoning: fake alcohol, wild mushrooms, pesticides'),
      keywords: {
        vi: ['ngộ độc', 'trúng độc', 'ngộ độc rượu', 'rượu giả', 'rượu tự nấu', 'rượu không nhãn', 'rượu không rõ nguồn gốc', 'methanol', 'cồn công nghiệp', 'nấm độc', 'nấm rừng', 'ăn nấm',
          'thuốc trừ sâu', 'thuốc diệt cỏ', 'thuốc chuột', 'uống nhầm', 'quá liều', 'uống thuốc quá liều', 'ngộ độc khí than', 'khí than', 'bếp than', 'hoá chất', 'hóa chất', 'nuốt phải hoá chất', 'nuốt phải hóa chất'],
        en: ['poisoning', 'poison', 'poisoned', 'methanol', 'fake alcohol', 'bootleg alcohol', 'home-made liquor', 'rice wine', 'moonshine', 'wild mushrooms', 'poisonous mushroom', 'pesticide',
          'insecticide', 'weed killer', 'rat poison', 'overdose', 'swallowed chemical', 'carbon monoxide', 'charcoal fumes']
      },
      summary: T('Nuốt, hít hoặc dính phải chất độc: rượu tự nấu, rượu không rõ nguồn gốc (có thể chứa methanol), nấm hái trong rừng, thuốc trừ sâu, thuốc uống quá liều, khói bếp than trong phòng kín. Có thể nôn, đau bụng, chóng mặt, nhìn mờ, khó thở, co giật, lơ mơ — với methanol và nấm độc, triệu chứng thường xuất hiện muộn sau nhiều giờ.',
        'Something toxic has been swallowed, breathed in or got on the skin: home-made or unlabelled liquor (it may contain methanol), mushrooms picked in the wild, pesticides, an overdose of medicine, or fumes from a charcoal stove in a closed room. There may be vomiting, belly pain, dizziness, blurred vision, breathing trouble, seizures or drowsiness — with methanol and poisonous mushrooms, symptoms often start many hours later.'),
      call115: T('Gọi 115 ngay khi nghi ngộ độc, kể cả khi người bệnh chưa có triệu chứng — methanol và nấm độc thường phát muộn 6–24 giờ. Người bệnh bất tỉnh, khó thở hoặc co giật: gọi 115 và làm ngay các bước dưới đây.',
        'Call 115 as soon as you suspect poisoning, even if the person has no symptoms yet — methanol and poisonous mushrooms often act 6–24 hours later. If the person is unresponsive, struggling to breathe or having a seizure, call 115 and start the steps below at once.'),
      steps: [
        S('Tự bảo vệ trước: đưa người bệnh ra nơi thoáng khí nếu có khói bếp than, khí gas hay mùi hoá chất (mở cửa trước khi vào). Dính thuốc trừ sâu: đeo găng, cởi bỏ quần áo dính thuốc và xả nước với xà phòng lên da ít nhất 15 phút.',
          'Protect yourself first: get the person into fresh air if there are charcoal-stove fumes, gas or chemical smells (open the doors before you go in). Pesticide on the body: wear gloves, remove contaminated clothing and wash the skin with soap and running water for at least 15 minutes.', V.fumesAway,
          'Hoá chất bắn vào mắt: xả nước sạch liên tục 15–20 phút (xem “Dị vật, hoá chất vào mắt”).', 'Chemical in the eyes: rinse with clean running water for 15–20 minutes (see “Eye injuries & chemicals in the eye”).'),
        S('Gọi 115 và giữ lại chai rượu, vỏ thuốc, bao bì hoá chất hoặc phần nấm còn lại (hay chụp ảnh). Ghi lại đã dùng gì, bao nhiêu, lúc mấy giờ, rồi mang theo đến viện.',
          'Call 115 and keep the bottle, medicine packets, chemical container or leftover mushrooms (or take photos). Note what was taken, how much and when, and bring it all to hospital.', V.keepBottle),
        S('Không gây nôn và không cho ăn uống gì (kể cả sữa, nước muối, nước dừa, than hoạt tính) trừ khi nhân viên y tế hướng dẫn. Nuốt phải chất tẩy rửa, axit: chỉ súc miệng rồi nhổ ra.',
          'Do not make them vomit and give nothing to eat or drink (not even milk, salt water, coconut water or charcoal) unless a health worker tells you to. If a cleaning product or acid was swallowed, only rinse the mouth and spit.', V.noVomit),
        S('Rượu tự nấu, rượu không nhãn: nhìn mờ, nhìn như có sương mù, khó thở, đau bụng dữ dội, nôn hoặc lơ mơ (thường 12–24 giờ sau khi uống) là dấu hiệu ngộ độc methanol. Đến viện ngay kể cả khi thấy đỡ, và báo mọi người đã uống cùng loại rượu đi khám.',
          'Home-made or unlabelled liquor: blurred or “foggy” vision, breathlessness, severe belly pain, vomiting or drowsiness (often 12–24 hours after drinking) are signs of methanol poisoning. Go to hospital now even if they feel better, and tell everyone who drank the same liquor to get checked too.', V.methanol),
        S('Nấm hái trong rừng: nôn, tiêu chảy 6–24 giờ sau khi ăn có thể tạm đỡ rồi mới gây tổn thương gan nặng. Người bệnh và tất cả những ai đã ăn cùng phải đến viện ngay, mang theo phần nấm còn lại.',
          'Wild mushrooms: vomiting and diarrhoea 6–24 hours after eating can ease for a while before serious liver damage sets in. The person and everyone who ate them must go to hospital now, taking any leftover mushrooms.', V.mushroomHosp),
        S('Lơ mơ, bất tỉnh nhưng còn thở: đặt nằm nghiêng an toàn và theo dõi nhịp thở. Không thở bình thường: ép tim ngay (xem CPR).',
          'Drowsy or unresponsive but breathing: place them in the recovery position and keep checking breathing. Not breathing normally: start CPR straight away.', V.recovPhone,
          'Ngộ độc thuốc trừ sâu, khí độc hoặc miệng còn dính chất độc: chỉ ép tim, không thổi ngạt miệng – miệng.', 'Pesticide or gas poisoning, or poison still around the mouth: give compressions only, no mouth-to-mouth breaths.')
      ],
      red_flags: {
        vi: ['Nhìn mờ, nhìn như có sương mù hoặc sợ ánh sáng sau khi uống rượu', 'Khó thở, thở nhanh sâu, môi tím', 'Co giật, lơ mơ, bất tỉnh', 'Nôn, tiêu chảy nhiều sau khi ăn nấm rừng — kể cả khi đã tạm đỡ',
          'Đồng tử co nhỏ, chảy nhiều nước bọt, vã mồ hôi, giật cơ (ngộ độc thuốc trừ sâu)', 'Nhiều người cùng ăn, cùng uống hoặc ngủ chung phòng cùng có triệu chứng'],
        en: ['Blurred or foggy vision, or pain from light, after drinking alcohol', 'Difficulty breathing, fast deep breathing, blue lips', 'Seizures, drowsiness or unresponsiveness', 'Heavy vomiting or diarrhoea after eating wild mushrooms — even if it has eased',
          'Tiny pupils, drooling, heavy sweating, muscle twitching (pesticide poisoning)', 'Several people who ate or drank the same thing, or slept in the same room, have symptoms']
      },
      donts: {
        vi: ['Không móc họng, không cho uống nước muối để gây nôn', 'Không “giải độc” bằng sữa, nước chanh, cà phê, thuốc nam hay cho uống thêm rượu', 'Không chờ có triệu chứng mới đi viện khi đã uống rượu lạ hoặc ăn nấm rừng',
          'Không vào phòng kín có khói bếp than, khí gas khi chưa mở cửa thông gió', 'Không để người say rượu nặng, lơ mơ nằm ngửa một mình — đặt nằm nghiêng và theo dõi'],
        en: ['Do not put fingers down the throat or give salt water to cause vomiting', 'Do not try to “detox” with milk, lemon juice, coffee, herbal remedies or more alcohol', 'Do not wait for symptoms before going to hospital after suspect liquor or wild mushrooms',
          'Do not enter a closed room with charcoal-stove fumes or gas before opening it up', 'Do not leave a very drunk or drowsy person alone on their back — put them on their side and watch them']
      },
      sources: ['ifrc2025', 'erc2025', 'vrc'], related: ['recovery', 'cpr', 'eye'],
      video_query: 'poisoning first aid what to do', updated: UPDATED_110
    },
    {
      id: 'fever', category: 'medical', icon: 'thermometer', priority: 'urgent',
      title: T('Sốt cao, nghi sốt xuất huyết', 'High fever & suspected dengue'),
      keywords: {
        vi: ['sốt', 'sốt cao', 'lên cơn sốt', 'sốt xuất huyết', 'sốt dengue', 'sxh', 'muỗi vằn', 'muỗi đốt', 'sốt rét', 'phát ban', 'đau nhức người', 'đau sau hốc mắt', 'chảy máu chân răng',
          'hạ sốt', 'paracetamol'],
        en: ['fever', 'high fever', 'temperature', 'dengue', 'dengue fever', 'mosquito', 'malaria', 'rash', 'body aches', 'bleeding gums', 'paracetamol', 'ibuprofen']
      },
      summary: T('Sốt xuất huyết có quanh năm ở Việt Nam, nhiều nhất vào mùa mưa: sốt cao đột ngột 2–7 ngày, đau đầu, đau sau hốc mắt, đau cơ khớp, có thể nổi ban. Giai đoạn nguy hiểm thường là ngày 3–7, ngay lúc hết sốt — có thể bị sốc hoặc chảy máu.',
        'Dengue occurs all year in Vietnam, most of all in the rainy season: sudden high fever for 2–7 days, headache, pain behind the eyes, muscle and joint aches, sometimes a rash. The dangerous phase is usually days 3–7, just as the fever goes down — shock or bleeding can develop.'),
      call115: T('Gọi 115 hoặc đến bệnh viện ngay nếu có dấu hiệu cảnh báo: đau bụng nhiều, nôn liên tục, chảy máu chân răng, chảy máu mũi, nôn hoặc đi ngoài ra máu, lơ mơ, vật vã, tay chân lạnh, tiểu ít — nhất là khi vừa hết sốt. Sốt kèm cứng cổ, co giật, lú lẫn hoặc khó thở: gọi 115.',
        'Call 115 or go to hospital now for any warning sign: bad belly pain, repeated vomiting, bleeding gums or nose, vomiting blood or bloody stools, drowsiness or restlessness, cold hands and feet, passing little urine — especially just as the fever settles. Fever with a stiff neck, seizures, confusion or breathing trouble: call 115.'),
      steps: [
        S('Sốt cao đột ngột khi đang ở Việt Nam: đến cơ sở y tế trong ngày để xét nghiệm và được hẹn khám lại. Báo bác sĩ những nơi bạn đã đi.',
          'Sudden high fever while in Vietnam: see a doctor the same day for a blood test and a follow-up appointment. Tell them where you have travelled.', V.dengueClinic,
          'Sốt sau khi đi rừng, vùng núi hoặc biên giới cũng có thể là sốt rét — cần xét nghiệm ngay.', 'Fever after trips to forests, mountains or border areas can also be malaria — get tested straight away.'),
        S('Hạ sốt chỉ bằng paracetamol, đúng liều và khoảng cách ghi trên hộp, không vượt tổng liều tối đa mỗi ngày; lau người bằng nước ấm. Không dùng ibuprofen, aspirin hay thuốc giảm đau chống viêm khác vì dễ gây chảy máu.',
          'Bring the fever down with paracetamol only, at the dose and interval on the pack and never above the daily maximum; sponge with lukewarm water. Do not take ibuprofen, aspirin or other anti-inflammatory painkillers: they raise the risk of bleeding.', V.paraOnly),
        S('Uống nhiều nước: nước lọc, oresol, nước trái cây, cháo loãng, sữa; nghỉ ngơi hoàn toàn.',
          'Drink plenty: water, oral rehydration solution, fruit juice, thin rice porridge, milk; rest completely.', V.fluidsOk),
        S('Theo dõi sát mỗi ngày, nhất là ngày 3–7 và lúc vừa hết sốt. Có bất kỳ dấu hiệu cảnh báo nào: đến bệnh viện ngay hoặc gọi 115.',
          'Keep a close eye every day, especially on days 3–7 and just as the fever settles. Any warning sign: go to hospital now or call 115.', V.warnDays),
        S('Ngủ màn, mặc quần áo dài và bôi thuốc chống muỗi cả ban ngày (muỗi vằn đốt ban ngày) để không lây bệnh cho người khác.',
          'Sleep under a net, wear long clothing and use insect repellent during the day too (dengue mosquitoes bite in daytime) so the illness does not spread to others.', V.mosquitoNet)
      ],
      red_flags: {
        vi: ['Đau bụng nhiều, nôn liên tục', 'Chảy máu chân răng, chảy máu mũi, nôn hoặc đi ngoài ra máu, kinh nguyệt nhiều bất thường', 'Lơ mơ, li bì hoặc vật vã, bứt rứt',
          'Tay chân lạnh, vã mồ hôi, tiểu ít — nhất là lúc vừa hết sốt', 'Sốt kèm cứng cổ, co giật, lú lẫn hoặc khó thở'],
        en: ['Bad belly pain or repeated vomiting', 'Bleeding gums or nose, vomiting blood, bloody stools, unusually heavy periods', 'Drowsiness, lethargy, restlessness or agitation',
          'Cold hands and feet, sweating, little urine — especially just as the fever settles', 'Fever with a stiff neck, seizures, confusion or breathing trouble']
      },
      donts: {
        vi: ['Không dùng ibuprofen, aspirin, diclofenac hay thuốc giảm đau chống viêm khác', 'Không cạo gió, chích lể, giác hơi — dễ gây bầm tím, chảy máu', 'Không tự truyền dịch (“truyền nước biển”) hay tiêm thuốc tại nhà',
          'Không tự dùng kháng sinh hay thuốc corticoid', 'Không chủ quan khi vừa hết sốt — đây có thể là lúc nguy hiểm nhất'],
        en: ['Do not take ibuprofen, aspirin, diclofenac or other anti-inflammatory painkillers', 'Do not do coin-rubbing (cạo gió), skin pricking or cupping — they cause bruising and bleeding', 'Do not have a drip (IV fluids) or injections at home',
          'Do not take antibiotics or steroids on your own', 'Do not relax when the fever goes — this can be the most dangerous time']
      },
      sources: ['who_dengue', 'ifrc2025', 'vrc'], related: ['dehydration', 'nosebleed'],
      video_query: 'dengue fever warning signs', updated: UPDATED_110
    }
  ];

  /* ======================================================================================
   * 5. MEDICAL KIT (motorbike loop / trekking in Vietnam)
   * ==================================================================================== */
  function K(id, vi, en, qvi, qen, essential, nvi, nen) {
    var k = { id: id, label: T(vi, en), qty: T(qvi, qen), essential: essential };
    if (nvi) k.note = T(nvi, nen);
    return k;
  }
  var KIT = [
    K('gloves', 'Găng tay y tế (nitrile)', 'Medical gloves (nitrile)', '4 đôi', '4 pairs', true),
    K('gauze', 'Gạc vô trùng 10 × 10 cm', 'Sterile gauze pads 10 × 10 cm', '10 miếng', '10 pads', true),
    K('roller', 'Băng cuộn', 'Roller bandages', '3 cuộn (5 và 10 cm)', '3 rolls (5 and 10 cm)', true),
    K('elastic', 'Băng thun', 'Elastic bandage', '1 cuộn', '1 roll', true, 'Cho bong gân; quấn vừa phải, không quá chặt.', 'For sprains; wrap snugly, never tight.'),
    K('tape', 'Băng dính y tế & băng cá nhân', 'Medical tape & plasters', '1 cuộn + 20 miếng', '1 roll + 20 plasters', true, 'Dán sớm lên điểm nóng rát ở chân khi trekking.', 'Put it on hot spots on your feet early when trekking.'),
    K('triangle', 'Băng tam giác', 'Triangular bandages', '2 cái', '2', true, 'Treo tay, cố định nẹp.', 'For slings and securing splints.'),
    K('splint', 'Nẹp SAM (nẹp nhôm dẻo)', 'SAM splint (mouldable)', '1 cái', '1', true, 'Uốn theo chi, lót đệm trước khi nẹp.', 'Mould it to the limb and pad it before use.'),
    K('tourniquet', 'Garô chuyên dụng', 'Purpose-made tourniquet', '1 cái', '1', false, 'Nên được hướng dẫn cách dùng trước chuyến đi; khi máu ở tay chân chảy ồ ạt đe doạ tính mạng, dùng ngay theo hướng dẫn in trên garô.', 'Learn how to use it before the trip; for life-threatening limb bleeding, use it straight away following the instructions printed on it.'),
    K('antiseptic', 'Dung dịch sát khuẩn (povidone-iodine hoặc chlorhexidin)', 'Antiseptic (povidone-iodine or chlorhexidine)', '1 lọ nhỏ', '1 small bottle', true),
    K('saline', 'Nước muối sinh lý 0,9%', 'Saline solution 0.9%', '2 lọ', '2 bottles', true, 'Rửa vết thương, rửa mắt.', 'For rinsing wounds and eyes.'),
    K('ors', 'Oresol (ORS)', 'Oral rehydration salts (ORS)', '6 gói', '6 sachets', true, 'Pha đúng lượng nước ghi trên gói.', 'Mix with exactly the amount of water on the sachet.'),
    K('paracetamol', 'Thuốc hạ sốt, giảm đau paracetamol', 'Paracetamol (fever & pain)', '1 vỉ', '1 strip', true, 'Dùng theo liều ghi trên hộp; hỏi dược sĩ nếu đang dùng thuốc khác. Nghi sốt xuất huyết: chỉ dùng paracetamol, không dùng ibuprofen hay aspirin.', 'Follow the dose on the pack; ask a pharmacist if you take other medicines. If dengue is possible, use paracetamol only — no ibuprofen or aspirin.'),
    K('antihistamine', 'Thuốc kháng histamin (dị ứng nhẹ)', 'Antihistamine tablets (mild allergy)', '1 vỉ', '1 strip', false, 'Chỉ cho ngứa, mẩn nhẹ — không thay thế adrenalin khi phản vệ.', 'For itching and mild rashes only — never a substitute for adrenaline in anaphylaxis.'),
    K('adrenaline', 'Bút tiêm adrenalin (nếu được bác sĩ kê đơn)', 'Adrenaline auto-injector (if prescribed)', '2 bút', '2 pens', false, 'Theo Thông tư 51/2017/TT-BYT. Kiểm tra hạn dùng, tránh để nơi quá nóng như cốp xe.', 'Per Circular 51/2017/TT-BYT. Check the expiry date and keep it out of hot places such as a motorbike seat box.'),
    K('blanket', 'Chăn giữ nhiệt (chăn bạc)', 'Emergency thermal blanket', '2 tấm', '2', true),
    K('whistle', 'Còi cứu hộ', 'Rescue whistle', '1 cái', '1', true, 'Tiếng còi đi xa hơn tiếng hét và đỡ tốn sức hơn.', 'A whistle carries further than shouting and uses less energy.'),
    K('torch', 'Đèn pin hoặc đèn đội đầu + pin dự phòng', 'Torch or headlamp + spare batteries', '1 bộ', '1 set', true),
    K('repellent', 'Kem hoặc xịt chống côn trùng (DEET hoặc picaridin)', 'Insect repellent (DEET or picaridin)', '1 lọ', '1 bottle', true),
    K('leech', 'Tất chống đỉa & thuốc xịt hoặc muối chống đỉa', 'Leech socks & leech repellent or salt', '1 đôi + 1 lọ', '1 pair + 1 bottle', false, 'Để phòng: bôi lên giày, tất trước khi vào rừng mùa mưa; không dùng khi đỉa đang bám.', 'For prevention: apply to shoes and socks before rainy-season treks; do not use on an attached leech.'),
    K('tools', 'Kéo cắt băng đầu tù & nhíp', 'Blunt-tip scissors & tweezers', '1 bộ', '1 set', true)
  ];

  /* ======================================================================================
   * 6. EXPORT
   * ==================================================================================== */
  var DATA = {
    version: '1.1.0-demo',
    updated: UPDATED_RC,
    review: {
      status: 'in_review',
      approver: null,
      approved_at: null,
      reviewer_round1: 'Nhóm Stormbreakers',
      note: 'Bản 1.1.0: đã rà soát nội bộ (vòng 1) và bổ sung 7 tình huống; chờ cố vấn y tế ký duyệt vòng 2 (mục 8.1)',
      note_en: 'Version 1.1.0: internally reviewed (round 1), 7 situations added; awaiting round-2 sign-off by the medical adviser (section 8.1)'
    },
    sources: SOURCES,
    categories: CATEGORIES,
    items: ITEMS,
    kit: KIT,
    kit_sources: ['ifrc2025', 'erc2025', 'tt51', 'vrc'] // sources shown on the kit tab (PDF 8.1)
  };

  var NC = root.NC;
  if (NC && NC.icons && typeof NC.icons.add === 'function' && typeof NC.icons.has === 'function') {
    Object.keys(EXTRA_ICONS).forEach(function (name) { if (!NC.icons.has(name)) NC.icons.add(name, EXTRA_ICONS[name]); });
  }

  root.NC_FIRSTAID = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
