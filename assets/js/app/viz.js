/*
 * viz.js — NC.viz: tiny dependency-free SVG charts, theme-aware through tokens.css variables (owner: P1 data).
 * Public API: signalStrip(analysis, opts), ring(value, opts), bars(data, opts), sparkline(values, opts), donut(parts, opts).
 * Every helper returns an SVGElement (role="img" + aria-label; decorative role="presentation" aria-hidden when the
 * label is empty — pass opts.ariaLabel e.g. "3/5 check-ins" when the chart is the only carrier of a value). Colours: token names (likely|uncertain|lost|primary|accent|
 * danger|warning|success|info|muted) map to vz-c--* classes; any other string is used as a raw CSS colour.
 * Signal levels: likely|uncertain|lost plus 'unknown' (no signal data → grey, drawn with the 'muted' token).
 * Every text defaults to ≥ 12px (--fs-xs, round-2 rule): callers no longer need a font-size override.
 */
(function (NC) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var TOKENS = ['likely', 'uncertain', 'lost', 'primary', 'accent', 'danger', 'warning', 'success', 'info', 'muted', 'text'];
  var uid = 0;

  var CSS = [
    '.vz{display:block;overflow:visible;font-family:var(--font-sans);}',
    '.vz text{fill:var(--c-text-2);font-size:12px;font-weight:600;}',
    '.vz .vz-strong{fill:var(--c-text);font-weight:700;}',
    '.vz-track{fill:var(--c-surface-3);}',
    '.vz-ring__track{fill:none;stroke:var(--c-surface-3);}',
    '.vz-ring__arc{fill:none;stroke-linecap:round;transition:stroke-dashoffset var(--dur-3) var(--ease);}',
    '.vz-ring__label{fill:var(--c-text);font-weight:800;}',
    '.vz-ring__sub{fill:var(--c-muted);font-weight:600;}',
    '.vz-pos line{stroke:var(--c-text);stroke-width:2;}',
    '.vz-pos circle{fill:var(--c-surface);stroke:var(--c-text);stroke-width:2.5;}',
    '.vz-poi{stroke:var(--c-surface);stroke-width:1.5;}',
    '.vz-poi--benh_vien,.vz-poi--tram_y_te,.vz-poi--phong_kham{fill:var(--c-danger);}',
    '.vz-poi--nha_thuoc{fill:var(--c-success);}',
    '.vz-poi--lodging{fill:var(--c-accent);}',
    '.vz-poi--repair,.vz-poi--fuel,.vz-poi--rental{fill:var(--c-text-2);}',
    '.vz-poi--default{fill:var(--c-primary);}',
    '.vz-spark__line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;}',
    '.vz-spark__area{opacity:.16;}',
    '.vz-donut__seg{fill:none;}',
    '.vz-lvl--lost{opacity:1;}'
  ];
  TOKENS.forEach(function (n) {
    var v = n === 'likely' || n === 'uncertain' || n === 'lost' ? 'var(--sig-' + n + ')' : n === 'muted' ? 'var(--c-muted)' : n === 'text' ? 'var(--c-text)' : 'var(--c-' + n + ')';
    CSS.push('.vz-fill.vz-c--' + n + '{fill:' + v + ';}');
    CSS.push('.vz-stroke.vz-c--' + n + '{stroke:' + v + ';}');
  });
  CSS.push('@media (prefers-reduced-motion: reduce){.vz-ring__arc{transition:none;}}');

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById('nc-viz-style')) return;
    var st = document.createElement('style');
    st.id = 'nc-viz-style';
    st.textContent = CSS.join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------------------------------------------------------- helpers */

  function s(tag, attrs, children) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      el.setAttribute(k, String(v));
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function title(text) { return s('title', {}, [String(text)]); }

  function root(cls, attrs, label) {
    injectStyle();
    // A chart without a text alternative is decorative (its numbers are shown as text next to it): hide it from AT
    // instead of announcing an unnamed image (axe svg-img-alt).
    var txt = label === null || label === undefined ? '' : String(label).replace(/\s+/g, ' ').trim();
    var a11y = txt ? { role: 'img', 'aria-label': txt } : { role: 'presentation', 'aria-hidden': 'true' };
    return s('svg', Object.assign({ class: 'vz ' + cls, focusable: 'false' }, a11y, attrs || {}));
  }

  /* Colour → {cls, style} for fill or stroke. */
  function paint(color, kind, fallback) {
    var c = color || fallback || 'primary';
    if (TOKENS.indexOf(c) >= 0) return { cls: 'vz-' + kind + ' vz-c--' + c, style: null };
    return { cls: 'vz-' + kind, style: kind + ':' + c };
  }

  function pct(v) { return (Math.round(v * 10000) / 100) + '%'; }

  function t(key, fallback, vars) {
    try {
      if (NC.i18n && NC.i18n.t) {
        var r = NC.i18n.t(key, vars);
        if (r && r !== key) return r;
      }
    } catch (e) { /* ignore */ }
    return fallback.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }

  /* Locale-aware number (≤ 1 decimal, trailing ",0" dropped) for default labels: 130,9 (vi) / 130.9 (en). */
  function num(v) {
    var r = Math.round((+v || 0) * 10) / 10;
    if (NC.util && NC.util.fmtNumber) return NC.util.fmtNumber(r, r % 1 === 0 ? 0 : 1);
    return String(r);
  }

  function km(v) {
    if (NC.util && NC.util.fmtKm) return NC.util.fmtKm(v);
    return v < 1 ? Math.round(v * 1000) + ' m' : (Math.round(v * 10) / 10) + ' km';
  }

  if (NC.i18n && NC.i18n.add) {
    NC.i18n.add({
      vi: {
        'vz.strip_label': 'Dải sóng dọc tuyến: có sóng {likely}, không chắc chắn {uncertain}, mất sóng {lost}',
        'vz.strip_unknown': ', chưa có dữ liệu sóng {unknown}',
        'vz.you': 'Bạn đang ở km {km}',
        'vz.level.likely': 'Có sóng', 'vz.level.uncertain': 'Sóng không chắc chắn', 'vz.level.lost': 'Mất sóng',
        'vz.level.unknown': 'Chưa có dữ liệu sóng'
      },
      en: {
        'vz.strip_label': 'Signal along the route: likely {likely}, uncertain {uncertain}, lost {lost}',
        'vz.strip_unknown': ', no signal data {unknown}',
        'vz.you': 'You are at km {km}',
        'vz.level.likely': 'Signal likely', 'vz.level.uncertain': 'Signal uncertain', 'vz.level.lost': 'Signal lost',
        'vz.level.unknown': 'No signal data'
      }
    });
  }

  /* ---------------------------------------------------------------- signal strip */

  var LEVEL_FALLBACK = { likely: 'Signal likely', uncertain: 'Signal uncertain', lost: 'Signal lost', unknown: 'No signal data' };
  /** Colour token of a strip part: 'unknown' (no data) is drawn grey; callers may already pass 'muted'. */
  function levelColor(level) { return level === 'unknown' ? 'muted' : level; }
  /** Human label of a level for tooltips (p.label wins; 'muted' = the grey "no data" stretch). */
  function levelLabel(p) {
    if (p && p.label) return String(p.label);
    var lv = p && p.level === 'muted' ? 'unknown' : (p && p.level);
    return LEVEL_FALLBACK[lv] ? t('vz.level.' + lv, LEVEL_FALLBACK[lv]) : String(lv || '');
  }

  /**
   * Horizontal bar of the route coloured by signal level, with POI dots above and the user position marker.
   * @param {Object} analysis NC.routing.analyze() result
   * @param {{pos_km?:number, pois?:Array<{along_km:number, poi?:Object, type?:string, name?:string}>, height?:number, showKm?:boolean}} [opts]
   * @returns {SVGElement}
   */
  function signalStrip(analysis, opts) {
    opts = opts || {};
    var h = opts.height || 14;
    var len = (analysis && analysis.length_km) || 0;
    var hasPois = !!(opts.pois && opts.pois.length);
    var top = hasPois ? 14 : (opts.pos_km !== undefined && opts.pos_km !== null ? 6 : 0);
    var total = top + h + (opts.showKm ? 18 : 0) + (opts.pos_km !== undefined && opts.pos_km !== null ? 4 : 0);
    var label = t('vz.strip_label', 'Signal: likely {likely}, uncertain {uncertain}, lost {lost}', {
      likely: km((analysis && analysis.likely_km) || 0), uncertain: km((analysis && analysis.uncertain_km) || 0), lost: km((analysis && analysis.lost_km) || 0)
    });
    if (analysis && analysis.unknown_km > 0) label += t('vz.strip_unknown', ', no signal data {unknown}', { unknown: km(analysis.unknown_km) });
    var svg = root('vz-strip', { width: '100%', height: total }, label);
    var clipId = 'vz-clip-' + (++uid);
    svg.appendChild(s('defs', {}, [s('clipPath', { id: clipId }, [s('rect', { x: 0, y: top, width: '100%', height: h, rx: h / 2, ry: h / 2 })])]));
    var bar = s('g', { 'clip-path': 'url(#' + clipId + ')' });
    bar.appendChild(s('rect', { class: 'vz-track', x: 0, y: top, width: '100%', height: h }));
    if (len > 0) {
      (analysis.parts || []).forEach(function (p) {
        var x = p.from_km / len, w = (p.to_km - p.from_km) / len;
        if (w <= 0) return;
        var pt = paint(levelColor(p.level), 'fill', 'uncertain');
        bar.appendChild(s('rect', { class: pt.cls + ' vz-lvl vz-lvl--' + p.level, style: pt.style, x: pct(x), y: top, width: pct(Math.min(1 - x, w + 0.002)), height: h },
          [title(levelLabel(p) + ': ' + km(p.from_km) + ' – ' + km(p.to_km))]));
      });
    }
    svg.appendChild(bar);
    if (hasPois && len > 0) {
      opts.pois.forEach(function (it) {
        var a = it.along_km;
        if (!(a >= 0) || a > len) return;
        var poi = it.poi || it;
        var type = poi.type || 'default';
        svg.appendChild(s('circle', { class: 'vz-poi vz-poi--' + type, cx: pct(a / len), cy: 6, r: 4.5 }, [title((poi.name || type) + ' · km ' + num(a))]));
      });
    }
    if (opts.pos_km !== undefined && opts.pos_km !== null && len > 0) {
      var px = pct(Math.max(0, Math.min(1, opts.pos_km / len)));
      svg.appendChild(s('g', { class: 'vz-pos' }, [
        title(t('vz.you', 'You are at km {km}', { km: num(opts.pos_km) })),
        s('line', { x1: px, x2: px, y1: top - 4, y2: top + h + 4 }),
        s('circle', { cx: px, cy: top + h / 2, r: h / 2 - 1 })
      ]));
    }
    if (opts.showKm) {
      var y = top + h + 16;
      svg.appendChild(s('text', { x: 0, y: y, 'text-anchor': 'start' }, ['0']));
      if (len >= 2) svg.appendChild(s('text', { x: '50%', y: y, 'text-anchor': 'middle' }, [km(len / 2)]));
      svg.appendChild(s('text', { x: '100%', y: y, 'text-anchor': 'end' }, [km(len)]));
    }
    return svg;
  }

  /* ---------------------------------------------------------------- ring */

  /**
   * Circular progress ring.
   * @param {number} value 0..1
   * @param {{size?:number, stroke?:number, label?:string, sublabel?:string, tone?:string}} [opts]
   * @returns {SVGElement}
   */
  function ring(value, opts) {
    opts = opts || {};
    var size = opts.size || 72;
    var sw = opts.stroke || 8;
    var v = Math.max(0, Math.min(1, +value || 0));
    var r = (size - sw) / 2;
    var c = 2 * Math.PI * r;
    var label = opts.label !== undefined ? String(opts.label) : Math.round(v * 100) + '%';
    var svg = root('vz-ring', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size }, opts.ariaLabel || (label + (opts.sublabel ? ' ' + opts.sublabel : '')));
    var pt = paint(opts.tone, 'stroke', 'primary');
    svg.appendChild(s('circle', { class: 'vz-ring__track', cx: size / 2, cy: size / 2, r: r, 'stroke-width': sw }));
    svg.appendChild(s('circle', {
      class: 'vz-ring__arc ' + pt.cls, style: pt.style, cx: size / 2, cy: size / 2, r: r, 'stroke-width': sw,
      'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': (c * (1 - v)).toFixed(2), transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'
    }));
    var fs = Math.max(12, Math.round(size * (label.length > 4 ? 0.2 : 0.26)));
    svg.appendChild(s('text', { class: 'vz-ring__label', x: '50%', y: opts.sublabel ? size / 2 + fs * 0.1 : size / 2 + fs * 0.35, 'text-anchor': 'middle', style: 'font-size:' + fs + 'px' }, [label]));
    if (opts.sublabel) {
      var sfs = Math.max(12, Math.round(size * 0.12));
      var sub = String(opts.sublabel);
      // Never spill outside the ring: a sublabel wider than the inner circle is condensed to fit (callers should still
      // pass a short word — e.g. "mô phỏng", not the full status).
      var inner = (size - 2 * sw) * 0.92;
      var fit = sub.length * sfs * 0.56 > inner ? { textLength: inner.toFixed(1), lengthAdjust: 'spacingAndGlyphs' } : {};
      svg.appendChild(s('text', Object.assign({ class: 'vz-ring__sub', x: '50%', y: size / 2 + fs * 0.1 + Math.max(12, size * 0.14), 'text-anchor': 'middle', style: 'font-size:' + sfs + 'px' }, fit), [sub]));
    }
    return svg;
  }

  /* ---------------------------------------------------------------- bars */

  /**
   * Horizontal bar list (label left, value right, bar below) — fluid width.
   * @param {Array<{label:string, value:number, color?:string, max?:number}>} data
   * @param {{height?:number, rowHeight?:number, max?:number, fmt?:function(number):string, unit?:string}} [opts]
   * @returns {SVGElement}
   */
  function bars(data, opts) {
    opts = opts || {};
    data = data || [];
    var rowH = opts.rowHeight || (opts.height && data.length ? Math.max(26, Math.floor(opts.height / data.length)) : 32);
    var max = opts.max || data.reduce(function (m, d) { return Math.max(m, +d.value || 0); }, 0) || 1;
    var fmt = opts.fmt || function (v) { return num(v) + (opts.unit || ''); };
    var height = opts.height || rowH * data.length;
    var svg = root('vz-bars', { width: '100%', height: height }, data.map(function (d) { return d.label + ': ' + fmt(+d.value || 0); }).join('; '));
    data.forEach(function (d, i) {
      var y0 = i * rowH;
      var v = Math.max(0, +d.value || 0);
      var f = Math.min(1, v / (d.max || max));
      var pt = paint(d.color, 'fill', 'primary');
      var barY = y0 + 17;
      var bh = Math.max(6, Math.min(10, rowH - 20));
      svg.appendChild(s('g', { class: 'vz-bar' }, [
        title(d.label + ': ' + fmt(v)),
        s('text', { x: 0, y: y0 + 11 }, [String(d.label)]),
        s('text', { class: 'vz-strong', x: '100%', y: y0 + 11, 'text-anchor': 'end' }, [fmt(v)]),
        s('rect', { class: 'vz-track', x: 0, y: barY, width: '100%', height: bh, rx: bh / 2 }),
        f > 0 ? s('rect', { class: pt.cls, style: pt.style, x: 0, y: barY, width: pct(Math.max(f, 0.012)), height: bh, rx: bh / 2 }) : null
      ]));
    });
    return svg;
  }

  /* ---------------------------------------------------------------- sparkline */

  /**
   * Small trend line.
   * @param {number[]} values
   * @param {{width?:number, height?:number, tone?:string, fill?:boolean, fluid?:boolean}} [opts]
   * @returns {SVGElement}
   */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 120, h = opts.height || 32, pad = 3;
    var vals = (values || []).map(Number).filter(function (v) { return isFinite(v); });
    var svg = root('vz-spark', { width: opts.fluid ? '100%' : w, height: h, viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: opts.fluid ? 'none' : null },
      opts.ariaLabel || (vals.length ? vals[0] + ' → ' + vals[vals.length - 1] : ''));
    if (!vals.length) return svg;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var pts = vals.map(function (v, i) {
      var x = vals.length === 1 ? w / 2 : pad + (i / (vals.length - 1)) * (w - 2 * pad);
      var y = h - pad - ((v - min) / span) * (h - 2 * pad);
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    var stroke = paint(opts.tone, 'stroke', 'primary');
    var fill = paint(opts.tone, 'fill', 'primary');
    if (opts.fill !== false && pts.length > 1) {
      var d = 'M' + pts[0][0] + ' ' + (h - pad) + ' L' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L') + ' L' + pts[pts.length - 1][0] + ' ' + (h - pad) + ' Z';
      svg.appendChild(s('path', { class: 'vz-spark__area ' + fill.cls, style: fill.style, d: d }));
    }
    svg.appendChild(s('polyline', { class: 'vz-spark__line ' + stroke.cls, style: stroke.style, points: pts.map(function (p) { return p.join(','); }).join(' '), 'vector-effect': 'non-scaling-stroke' }));
    if (!opts.fluid) {
      var last = pts[pts.length - 1];
      svg.appendChild(s('circle', { class: fill.cls, style: fill.style, cx: last[0], cy: last[1], r: 2.8 }));
    }
    return svg;
  }

  /* ---------------------------------------------------------------- donut */

  /**
   * Donut chart.
   * @param {Array<{label:string, value:number, color?:string}>} parts
   * @param {{size?:number, stroke?:number, label?:string, sublabel?:string}} [opts]
   * @returns {SVGElement}
   */
  function donut(parts, opts) {
    opts = opts || {};
    parts = (parts || []).filter(function (p) { return (+p.value || 0) > 0; });
    var size = opts.size || 120;
    var sw = opts.stroke || 16;
    var r = (size - sw) / 2;
    var c = 2 * Math.PI * r;
    var total = parts.reduce(function (a, p) { return a + (+p.value); }, 0);
    var svg = root('vz-donut', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size },
      parts.map(function (p) { return p.label + ': ' + num(p.value); }).join('; '));
    svg.appendChild(s('circle', { class: 'vz-ring__track', cx: size / 2, cy: size / 2, r: r, 'stroke-width': sw }));
    var acc = 0;
    var gap = parts.length > 1 ? Math.min(2, c * 0.01) : 0;
    parts.forEach(function (p, i) {
      var len = total ? (+p.value / total) * c : 0;
      var pt = paint(p.color, 'stroke', TOKENS[i % 6 + 3]);
      svg.appendChild(s('circle', {
        class: 'vz-donut__seg ' + pt.cls, style: pt.style, cx: size / 2, cy: size / 2, r: r, 'stroke-width': sw,
        'stroke-dasharray': Math.max(0, len - gap).toFixed(2) + ' ' + (c - Math.max(0, len - gap)).toFixed(2),
        'stroke-dashoffset': (-acc).toFixed(2), transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'
      }, [title(p.label + ': ' + num(p.value) + (total ? ' (' + Math.round(p.value / total * 100) + '%)' : ''))]));
      acc += len;
    });
    var label = opts.label !== undefined ? String(opts.label) : num(total);
    var fs = Math.max(12, Math.round(size * 0.2));
    svg.appendChild(s('text', { class: 'vz-ring__label', x: '50%', y: opts.sublabel ? size / 2 + fs * 0.15 : size / 2 + fs * 0.35, 'text-anchor': 'middle', style: 'font-size:' + fs + 'px' }, [label]));
    if (opts.sublabel) svg.appendChild(s('text', { class: 'vz-ring__sub', x: '50%', y: size / 2 + fs * 0.15 + Math.max(12, size * 0.12), 'text-anchor': 'middle', style: 'font-size:' + Math.max(12, Math.round(size * 0.1)) + 'px' }, [opts.sublabel]));
    return svg;
  }

  NC.viz = { signalStrip: signalStrip, ring: ring, bars: bars, sparkline: sparkline, donut: donut };
})(window.NC = window.NC || {});
