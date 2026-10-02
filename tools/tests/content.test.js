/*
 * content.test.js — node --test suite for the medical content (owner: content; MOD.01 phrases.js + MOD.05 firstaid.js).
 * Stable invariants only (no dates): schema completeness in every language, review never self-approved, one content
 * version everywhere the app shows it, MOD.01 ↔ MOD.05 urgency agreement, and the top MOD.05 search result for the
 * emergency queries reviewers typed (runs the real searchAll() extracted from mod05-firstaid.js).
 * Run: node --test tools/tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'assets/js/data/phrases.js'));
const FA = require(path.join(ROOT, 'assets/js/data/firstaid.js'));
const SEED = require(path.join(ROOT, 'assets/js/data/seed-core.js'));
const LANGS = ['vi', 'en', 'zh', 'ko', 'ja', 'ru', 'fr'];
const SEVS = ['mild', 'moderate', 'severe'];

function config() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8'), ctx);
  return ctx.window.NC_CONFIG || ctx.NC_CONFIG;
}
function leaves() {
  const out = [];
  P.groups.forEach((g) => g.symptoms.forEach((s) => { if (s.children) s.children.forEach((c) => out.push({ g, node: c })); else out.push({ g, node: s }); }));
  return out;
}
const seven = (o) => LANGS.every((l) => o && typeof o[l] === 'string' && o[l].trim().length > 0);

test('one content version everywhere it is shown (config, phrases, firstaid, current release)', () => {
  const cfg = config();
  assert.equal(P.version, FA.version, 'phrases.js and firstaid.js ship together');
  assert.equal(cfg.contentVersion, FA.version, 'config.contentVersion (About screen) = firstaid.js version');
  const live = SEED.content_releases.filter((r) => r.status === 'in_review' || r.status === 'approved');
  assert.equal(live.length, 1, 'exactly one current content release in the seed');
  assert.equal(live[0].version, FA.version, 'seed content_releases current version = content files');
});

test('review is never self-approved (PDF 8.1: round-2 sign-off by a medical advisor)', () => {
  assert.notEqual(P.review.status, 'approved');
  assert.equal(FA.review.status === 'approved' ? !!FA.review.approver : true, true);
  SEED.content_releases.forEach((r) => assert.ok(r.status !== 'approved' || (r.approver && r.approved_at), 'approved release ' + r.version + ' is signed'));
});

test('phrases: every leaf has 3 severities × 7 languages, unique stable codes, urgent phrases ask for emergency help', () => {
  const codes = new Set();
  const MARK = { vi: /cấp cứu|bệnh viện ngay/, en: /emergency|hospital/i, zh: /急救|医院/, ko: /응급|병원/, ja: /緊急|病院/, ru: /срочн|больниц/, fr: /urgent|hôpital/ };
  leaves().forEach(({ node }) => {
    assert.deepEqual(Object.keys(node.phrases), SEVS, node.id + ' severities');
    SEVS.forEach((sv) => {
      const p = node.phrases[sv];
      assert.match(p.code, /^MOD01-[A-Z]+-\d{2}-[123]$/, node.id + '.' + sv + ' code');
      assert.ok(!codes.has(p.code), 'duplicate code ' + p.code); codes.add(p.code);
      assert.ok(seven(p.text), p.code + ' text in 7 languages');
      if (p.urgent) LANGS.forEach((l) => assert.match(p.text[l], MARK[l], p.code + '.' + l + ' urgent without emergency ask'));
      else assert.doesNotMatch(p.text.vi, /cấp cứu/, p.code + ' non-urgent asks for cấp cứu');
      assert.equal(P.find(p.code).code, p.code, 'find(' + p.code + ')');
    });
  });
  assert.ok(codes.size >= 120 && codes.size % 3 === 0, 'phrase count ' + codes.size);
  P.severities.forEach((s) => LANGS.forEach((l) => assert.doesNotMatch(s.hint[l], /115/, 'severity hint ' + s.id + '.' + l + ' must not name 115 (C14)')));
  ['allergy_none', 'condition_none', 'medication_none', 'blood_unknown'].forEach((k) => assert.ok(seven(P.templates[k]), 'template ' + k));
});

test('firstaid: items complete in vi/en with sources, 115 guidance, 3–7 illustrated steps; no "you can always call" claim', () => {
  const src = new Set(FA.sources.map((s) => s.id));
  FA.sources.forEach((s) => assert.ok(s.title && s.title_en && s.short && s.short_en, 'source ' + s.id + ' titles (C15)'));
  const ids = new Set();
  FA.items.forEach((it) => {
    assert.ok(!ids.has(it.id), 'duplicate item ' + it.id); ids.add(it.id);
    ['title', 'summary', 'call115'].forEach((k) => assert.ok(it[k] && it[k].vi && it[k].en, it.id + '.' + k));
    assert.ok(it.steps.length >= 3 && it.steps.length <= 7, it.id + ' steps');
    it.steps.forEach((s, i) => { assert.ok(s.text.vi && s.text.en, it.id + ' step ' + i); assert.match(s.ill, /^<svg[\s\S]*<\/svg>$/, it.id + ' step ' + i + ' svg'); });
    assert.ok(it.sources.length && it.sources.every((s) => src.has(s)), it.id + ' sources');
    assert.ok(typeof it.video_query === 'string' && it.video_query, it.id + ' video_query');
    (it.related || []).forEach((r) => assert.ok(FA.items.some((x) => x.id === r), it.id + ' related ' + r));
  });
  ['asthma', 'poisoning', 'nosebleed', 'electric', 'eye', 'cpr', 'choking', 'bleeding', 'anaphylaxis', 'snakebite'].forEach((id) => assert.ok(ids.has(id), 'required item ' + id));
  assert.doesNotMatch(JSON.stringify(FA), /luôn gọi được|you can always call/i, 'B12');
});

test('MOD.01 urgency agrees with the MOD.05 call-115 rules', () => {
  // [MOD.01 code, MOD.05 item that decides it, urgent?]
  const XC = [
    ['MOD01-HEAD-02-2', 'head', true], ['MOD01-CHEST-01-2', 'chestpain', true], ['MOD01-CHEST-01-3', 'chestpain', true], ['MOD01-ABD-07-1', 'poisoning', true],
    ['MOD01-ABD-07-3', 'poisoning', true], ['MOD01-SKIN-03-2', 'anaphylaxis', true], ['MOD01-SKIN-04-2', 'sting', true], ['MOD01-SKIN-05-1', 'snakebite', true],
    ['MOD01-SKIN-10-3', 'hypothermia', true], ['MOD01-ARM-05-3', 'burn', true],
    ['MOD01-ARM-05-1', 'burn', false], ['MOD01-HEAD-06-1', 'nosebleed', false], ['MOD01-ABD-05-2', 'dehydration', false], ['MOD01-ARM-07-2', 'stroke', false],
    ['MOD01-HEAD-04-2', 'stroke', false], ['MOD01-SKIN-06-1', 'dogbite', false], ['MOD01-CHEST-03-1', 'asthma', false],
    ['MOD01-HEAD-05-2', 'eye', false], ['MOD01-HEAD-05-3', 'eye', true]
  ];
  XC.forEach(([code, item, want]) => {
    const r = P.find(code);
    assert.ok(r, 'unknown code ' + code);
    assert.ok(FA.items.some((i) => i.id === item), 'unknown item ' + item);
    assert.equal(r.urgent, want, code + ' urgent vs MOD.05 ' + item);
  });
  // MOD.05 eye: blurred vision ⇒ "call 115 or go to a medical facility at once" — HEAD-05-2 must not read "khám sớm".
  const eye = P.find('MOD01-HEAD-05-2');
  assert.match(FA.items.find((i) => i.id === 'eye').call115.vi, /ngay[^.]*nhìn mờ/, 'MOD.05 eye call115 covers blurred vision');
  assert.match(eye.text.vi, /khám ngay/, 'HEAD-05-2 asks to be seen at once');
  const eyeNode = eye.child || eye.symptom;
  assert.ok(eyeNode.hints && eyeNode.hints.moderate && seven(eyeNode.hints.moderate), 'HEAD-05 moderate hint override');
  assert.match(eyeNode.hints.moderate.vi, /ngay/, 'HEAD-05 moderate hint says now');
  assert.doesNotMatch(eyeNode.hints.moderate.vi, /sớm/, 'HEAD-05 moderate hint is not "soon"');
});

test('quick phrases: companion wording (text_behalf) complete for the phrases that point at the owner\'s phone', () => {
  ['q-qr-profile', 'q-drug-allergy', 'q-contact-family'].forEach((id) => {
    const q = P.quick.find((x) => x.id === id);
    assert.ok(q && seven(q.text_behalf), id + ' text_behalf in 7 languages');
    assert.match(q.text_behalf.vi, /người bệnh/i, id + ' behalf wording names the patient');
  });
  P.quick.forEach((q) => { if (q.text_behalf) assert.ok(seven(q.text_behalf), q.id + ' text_behalf in 7 languages'); });
});

test('MOD.05 search: top result for the emergency queries reviewers typed (real searchAll)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/app/mod05-firstaid.js'), 'utf8');
  const a = src.indexOf('  var INDEX = null;'), b = src.indexOf('  function search(q)');
  assert.ok(a > 0 && b > a, 'search code located in mod05-firstaid.js');
  const code = 'var CATS = {}; FA.categories.forEach(function (c) { CATS[c.id] = c; }); var PRIO_RANK = { critical: 0, urgent: 1, common: 2 };\n' + src.slice(a, b) + '\nthis.searchAll = searchAll;';
  const ctx = { FA, String, Math, JSON };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  // [query, expected top result (id · [acceptable ids] · null = no result, the "no exact guide" state), ids that must not be results]
  // Covers: the earlier diacritic-collision fixes (máu cam ≠ cầm máu, vắt ≠ vật, rết ≠ rét, bỏng mắt ≠ bong gân…), natural
  // phrasing (intensifiers, word order, whole sentences), partial / missing / variant diacritics, and English.
  const T = [
    // collisions fixed earlier: must stay fixed
    ['chảy máu cam', 'nosebleed', ['bleeding']], ['máu cam', 'nosebleed', ['bleeding']], ['cầm máu', 'bleeding', ['nosebleed']], ['vắt', 'leech', ['choking', 'eye']],
    ['rết', 'sting', ['hypothermia']], ['rét run', 'hypothermia', ['sting']], ['bỏng mắt', 'eye', ['sprain']], ['điện giật', 'electric', ['hypoglycemia']],
    ['dien giat', 'electric', ['hypoglycemia']], ['đau đầu', 'head', ['chestpain']], ['nấm độc', 'poisoning', ['snakebite', 'anaphylaxis', 'burn']],
    ['sứa', 'jellyfish', ['chestpain', 'leech', 'fainting']], ['hen', 'asthma', ['cpr', 'choking', 'bleeding']], ['không thở', 'cpr'], ['cháy nắng', 'burn', ['bleeding']],
    ['răng', 'fever', ['snakebite']], ['say xe', null, ['hypoglycemia', 'heatstroke']], ['tai biến', 'stroke', ['fracture']], ['mắt đỏ', null, ['fainting']],
    ['hô hấp nhân tạo', 'cpr'], ['bong', ['burn', 'sprain']], ['bỏng', 'burn', ['sprain']], ['bong gân', 'sprain', ['burn']], ['bong gan', 'sprain'],
    // Vietnamese with diacritics
    ['hóa chất vào mắt', 'eye'], ['hen suyễn', 'asthma'], ['ngộ độc', 'poisoning', ['sting']], ['rượu giả', 'poisoning'], ['sốt xuất huyết', 'fever'],
    ['hóc', 'choking'], ['cạp nia', 'snakebite'], ['đột quỵ', 'stroke'], ['chảy máu', 'bleeding'], ['đau ngực', 'chestpain'], ['rắn cắn', 'snakebite'],
    ['chó cắn', 'dogbite'], ['con vật cắn', 'dogbite', ['leech']], ['đuối nước', 'drowning'], ['sốc phản vệ', 'anaphylaxis'], ['co giật', 'seizure'],
    // natural phrasing: intensifiers, word order, sentences (NOTES §7)
    ['chảy máu nhiều', 'bleeding', ['fever', 'fracture', 'dogbite']], ['chảy nhiều máu', 'bleeding', ['fever']], ['máu chảy nhiều', 'bleeding', ['fever']],
    ['chảy máu rất nhiều', 'bleeding', ['fever']], ['chảy máu không cầm', 'bleeding'], ['máu chảy không cầm', 'bleeding'], ['vết thương chảy máu', 'bleeding'],
    ['mất máu', 'bleeding'], ['mất nhiều máu', 'bleeding'], ['tai nạn giao thông', 'bleeding'], ['bị rắn cắn', 'snakebite'], ['em bé bị hóc', 'choking'],
    ['nghẹt thở', 'choking', ['chestpain']],
    ['mang thai', null, ['electric']],
    // partial, missing or variant diacritics
    ['dien giật', 'electric', ['hypoglycemia']], ['điện giat', 'electric'], ['ngo độc', 'poisoning'], ['ngo doc', 'poisoning'], ['đuối nuoc', 'drowning'],
    ['ran cắn', 'snakebite'], ['ran can', 'snakebite'], ['rắn can', 'snakebite'], ['đau nguc', 'chestpain'], ['bò cạp', 'sting'], ['bọ cạp', 'sting'], ['bo cap', 'sting'],
    ['đột quị', 'stroke'], ['đột qụy', 'stroke', ['jellyfish']], ['dot qui', 'stroke'], ['ong đôt', 'sting'], ['bỏng nuoc soi', 'burn', ['eye', 'electric']],
    ['bong nuoc soi', 'burn'], ['bỏng mat', 'eye', ['sprain']], ['chay mau nhieu', 'bleeding', ['dehydration', 'fever']], ['vet thuong chay mau', 'bleeding'],
    ['chó can', 'dogbite'], ['say nang', 'heatstroke'],
    // English
    ['lightning', 'electric'], ['electric shock', 'electric'], ['inhaler', 'asthma'], ['methanol', 'poisoning'], ['poisoning', 'poisoning'], ['nosebleed', 'nosebleed'],
    ['sea urchin', 'jellyfish'], ['jellyfish', 'jellyfish'], ['baby choking', 'choking'], ['sunburn', 'burn'], ['sprained ankle', 'sprain'], ['chemical in eye', 'eye'],
    ['something in my eye', 'eye'], ['abdominal pain', 'dehydration'], ['dengue', 'fever'], ['scorpion', 'sting'], ['heat stroke', 'heatstroke'],
    ['bleeding a lot', 'bleeding'], ['bleeding heavily', 'bleeding'], ['heavy bleeding', 'bleeding'], ['losing blood', 'bleeding'], ['traffic accident', 'bleeding']
  ];
  assert.ok(T.length >= 40, 'at least 40 queries');
  const bad = [];
  T.forEach(([q, want, never]) => {
    const r = ctx.searchAll(q);
    const ids = r ? r.results.map((i) => i.id) : [];
    const top = ids[0] || null;
    const ok = want === null ? top === null : (Array.isArray(want) ? want.indexOf(top) >= 0 : top === want);
    if (!ok) bad.push(q + ' → ' + (ids.join(',') || '(no result)') + ' (want ' + want + ')');
    (never || []).forEach((id) => { if (ids.indexOf(id) >= 0) bad.push(q + ' → must not list ' + id + ' (got ' + ids.join(',') + ')'); });
  });
  assert.deepEqual(bad, []);
});
