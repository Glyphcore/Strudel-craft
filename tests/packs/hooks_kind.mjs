// Unit checks for the site adapter of pack kind `hooks` (#91): site/packs-kinds.js (check, items, code rule) + site/packs-hooks.js (install) against the real hooks runtime.
// Usage: STRUDEL_MODULES=<dir with @strudel/core and @strudel/mini> node tests/packs/hooks_kind.mjs
import assert from 'node:assert/strict';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';
import { KINDS, DEFERRED } from '../../site/packs-kinds.js';
import { install as rawInstall, chainable, validate as rawValidate } from '../../site/packs-hooks.js';
import { resolve, itemIds } from '../../site/engine/packs-core.js';
const RT = await bootRuntime();
if (!RT) { console.log('SKIP @strudel/core/@strudel/mini not installed (set STRUDEL_MODULES)'); process.exit(0); }
import fs from 'node:fs';
const STEPS = JSON.parse(fs.readFileSync(new URL('../../site/data/hooks-steps.json', import.meta.url), 'utf8'));
const H = RT.hooks; const allow = chainable(RT.core.Pattern, STEPS); const install = (h, e, s, i, nf) => rawInstall(h, e, s, i, nf, { allow }); let n = 0; const ok = (m) => { n++; console.log('PASS ' + m); };
const defsOf = () => Object.keys(JSON.parse(H.toJSON()).defs || {}).sort();
const chain = (...c) => ({ chain: c });
const A = { model: 1, defs: { kick: chain(['s', 'sine'], ['gain', 0.8]), pad: chain(['s', 'saw'], ['lpf', 800]) } };
const B = { model: 1, defs: { kick: chain(['s', 'square']), bell: chain(['s', 'triangle']) } };
const CODE = { model: 1, defs: { fine: chain(['gain', 1]), fn: { opaque: true, src: '(p) => p.gain(2)' }, dyn: { chain: [['gain', { $code: 'sine' }]] } } };
const st = () => ({ defs: new Map(), told: new Set(), refused: [] });
const e = (pack, ingredient, data) => ({ pack, ingredient, data });

assert.equal(DEFERRED.has('hooks'), false); assert.ok(KINDS.hooks && KINDS.hooks.formats.includes('hooks@1')); ok('kind hooks has an adapter (no longer deferred)');
assert.equal(KINDS.hooks.check(A), null); assert.ok(KINDS.hooks.check({ model: 2 })); assert.ok(KINDS.hooks.check({ model: 1, bindings: [] })); ok('check: model 1, registry keys only');
assert.deepEqual(KINDS.hooks.items(A).map(([k]) => k), ['kick', 'pad']); ok('items: one per def (precedence resolution)');
assert.throws(() => KINDS.hooks.apply({ code: false }, CODE), (x) => x.code === 'E_PACK_CODE_UNDECLARED'); assert.doesNotThrow(() => KINDS.hooks.apply({ code: true }, CODE)); assert.doesNotThrow(() => KINDS.hooks.apply({ code: false }, A)); ok('code-bearing defs need code: true (E_PACK_CODE_UNDECLARED)');

let s = st(); let r = install(H, [e('a/one', 'racks', A)], s); assert.deepEqual(defsOf(), ['kick', 'pad']); assert.deepEqual(r.refused, []); ok('chain-only ingredient: defs are in the registry');
r = install(H, [e('a/one', 'racks', A)], s); assert.deepEqual(defsOf(), ['kick', 'pad']); ok('re-install is idempotent');
H.reset(); assert.deepEqual(defsOf(), []); install(H, [e('a/one', 'racks', A)], s); assert.deepEqual(defsOf(), ['kick', 'pad']); ok('after hooks.reset() the next install restores the defs');

H.reset(); s = st(); install(H, [e('a/one', 'racks', A), e('b/two', 'racks', B)], s);
let j = JSON.parse(H.toJSON()).defs; assert.deepEqual(j.kick.chain[0], ['s', 'sine']); assert.deepEqual(defsOf(), ['bell', 'kick', 'pad']); ok('lock order / precedence: the first pack wins a shared name, the other adds its own');
H.reset(); s = st(); install(H, [e('b/two', 'racks', B), e('a/one', 'racks', A)], s); j = JSON.parse(H.toJSON()).defs; assert.deepEqual(j.kick.chain[0], ['s', 'square']); ok('reversed order reverses the winner');

H.reset(); s = st(); const told = []; r = install(H, [e('c/code', 'racks', CODE)], s, { 'c/code:racks': { code: true, reason: { code: 'E_PACK_CODE_GRANT' }, codeHash: 'sha256:x' } }, (m) => told.push(m));
assert.deepEqual(defsOf(), ['fine']); assert.deepEqual(r.refused[0].defs, ['fn', 'dyn']); assert.equal(r.refused[0].code, 'E_PACK_CODE_GRANT'); assert.equal(told.length, 1); assert.match(told[0], /E_PACK_CODE_GRANT/); ok('code-bearing defs refused without a grant (E_PACK_CODE_GRANT + notice); chain-only defs of the same ingredient load');
install(H, [e('c/code', 'racks', CODE)], s, { 'c/code:racks': { codeHash: 'sha256:x' } }, (m) => told.push(m)); assert.equal(told.length, 1); ok('the notice shows once per pack + code hash');
assert.ok(!JSON.stringify(JSON.parse(H.toJSON())).includes('p.gain(2)')); ok('no opaque source reached the registry (nothing evaluated)');

H.reset(); s = st(); install(H, [e('a/one', 'racks', A), e('b/two', 'racks', B)], s); H.def('mine', chain(['gain', 3]));
install(H, [e('a/one', 'racks', A)], s); assert.deepEqual(defsOf(), ['kick', 'mine', 'pad']); ok('a pack dropped between evaluations leaves none of its own defs; program defs stay');
install(H, [], s); assert.deepEqual(defsOf(), ['mine']); ok('no hooks pack named any more: all pack defs are gone');
H.def('kick', chain(['gain', 9])); s = st(); install(H, [e('a/one', 'racks', A)], s); H.def('kick', chain(['gain', 9])); install(H, [], s); assert.deepEqual(JSON.parse(H.toJSON()).defs.kick.chain[0], ['gain', 9]); ok('a def the program redefined is not removed with the pack');

// the real loader (site/packs.js) with a stub fetch: a code-bearing hooks ingredient is blocked without a grant, its data part is kept, and the install loads only the chain-only defs
import { createPacks, sha } from '../../site/packs.js';
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const racks = enc(CODE), rh = await sha(racks);
const man = (code) => ({ craftpack: '1.0.0', id: 'glyphcore/hk', version: '1.0.0', license: 'CC0-1.0', ingredients: [{ id: 'racks', kind: 'hooks', format: 'hooks@1', version: '1.0.0', path: 'racks.json', hash: rh, bytes: racks.length, load: 'manual', ...(code ? { code: true } : {}) }] });
const serve = async (code) => { const m = enc(man(code)); const files = { 'craftpack.json': m, 'racks.json': racks };
  const lock = { lock: 1, packs: [{ id: 'glyphcore/hk', version: '1.0.0', source: 'file:.', manifest: await sha(m), priority: 0, allowCode: [], dependencies: {} }] };
  return async (url) => { const f = String(url).replace('http://t/', ''); const b = f === 'packs.lock.json' ? enc(lock) : files[f]; return b ? new Response(b) : new Response('', { status: 404 }); }; };
{ const P = createPacks({ base: 'http://t/', fetch: await serve(true), storage: null, search: '' }); await P.ready; const entries = await P.get('hooks'); const i = P.list()[0].ingredients[0];
  assert.equal(i.state, 'blocked'); assert.equal(i.reason.code, 'E_PACK_CODE_GRANT'); assert.ok(P.report().errors.some((x) => x.code === 'E_PACK_CODE_GRANT')); ok('loader: code: true without a grant -> blocked, E_PACK_CODE_GRANT in the report');
  H.reset(); const toldL = []; const r2 = install(H, entries, st(), { 'glyphcore/hk:racks': i }, (m) => toldL.push(m)); assert.deepEqual(defsOf(), ['fine']); assert.deepEqual(r2.refused[0].defs, ['fn', 'dyn']); assert.equal(toldL.length, 1); ok('loader data part -> install: the chain-only def loads, code defs are refused with a notice'); }
{ const P = createPacks({ base: 'http://t/', fetch: await serve(false), storage: null, search: '' }); await P.ready; await P.get('hooks'); const i = P.list()[0].ingredients[0]; assert.equal(i.state, 'failed'); assert.equal(i.reason.code, 'E_PACK_CODE_UNDECLARED'); ok('loader: code defs without code: true -> failed E_PACK_CODE_UNDECLARED, nothing installed'); }

// ---- security regression (#91 rework): data can never reach Function / Object.prototype through a chain, and one bad def installs nothing of its ingredient
const PWN = 'window.__PWNED=(window.__PWNED||0)+1'; globalThis.window = globalThis; delete globalThis.__PWNED;
const flush = () => { try { H.slot('sl', { mode: 'chain' }); } catch (e) { /* already there */ } };
const run = (name) => { flush(); H.bind('sl', name); try { RT.core.s('bd').use('sl').queryArc(0, 1); } catch (e) { /* the site never throws; the test needs only the side effect */ } };
const refuse = (label, data, expectDef) => { H.reset(); const s = st(), told = []; const r = install(H, [e('x/evil', 'racks', data)], s, {}, (m) => told.push(m));
  assert.equal(r.invalid.length, 1, label); assert.equal(r.invalid[0].code, 'E_PACK_HOOKS_INVALID', label); assert.ok(r.invalid[0].errors.length >= 1 && r.invalid[0].errors[0].code === 'E_PACK_HOOKS_INVALID', label);
  assert.deepEqual(r.defs, [], label); assert.deepEqual(defsOf(), [], label); assert.equal(told.length, 1, label); assert.match(told[0], /E_PACK_HOOKS_INVALID/);
  if (expectDef) run(expectDef); assert.equal(globalThis.__PWNED, undefined, label + ': global side effect'); };
refuse('critic exploit', { model: 1, defs: { pwn: chain(['__lookupGetter__', '_steps'], ['constructor', PWN], ['apply', null, []]) } }, 'pwn'); ok('critic exploit (__lookupGetter__ -> constructor -> apply): rejected, structured, no side effect');
refuse('__proto__ step', { model: 1, defs: { a: chain(['__proto__', 'x']) } }); refuse('constructor.constructor', { model: 1, defs: { a: chain(['constructor.constructor', PWN]) } });
refuse('computed-looking', { model: 1, defs: { a: chain(['["constructor"]', PWN]) } }); refuse('computed-looking 2', { model: 1, defs: { a: chain(['gain.constructor', PWN]) } });
refuse('apply step', { model: 1, defs: { a: chain(['apply', null, []]) } }); refuse('call/bind/toString', { model: 1, defs: { a: chain(['call', null]), b: chain(['bind', null]), c: chain(['toString']) } });
refuse('unknown method', { model: 1, defs: { a: chain(['noSuchMethod', 1]) } });
ok('variants rejected: __proto__, constructor.constructor, computed-looking names, apply/call/bind/toString, unknown methods');
refuse('__proto__ key in args', { model: 1, defs: { a: JSON.parse('{"chain":[["gain",{"__proto__":{"x":1}}]]}') } }); refuse('constructor key in args', { model: 1, defs: { a: chain(['gain', { constructor: { prototype: 1 } }]) } });
refuse('function object arg', { model: 1, defs: { a: chain(['gain', () => 1]) } }); refuse('too deep', { model: 1, defs: { a: chain(['gain', [[[[[[[[[[1]]]]]]]]]]]) } });
ok('arguments are JSON data only: __proto__/constructor keys, functions, deep nesting rejected');
refuse('reserved def names', { model: 1, defs: { constructor: chain(['gain', 1]) } }); refuse('__proto__ def', { model: 1, defs: JSON.parse('{"__proto__":{"chain":[["gain",1]]}}') });
refuse('toString def', { model: 1, defs: { toString: chain(['gain', 1]) } }); refuse('bad slot name', { model: 1, slots: { constructor: {} }, defs: { a: chain(['gain', 1]) } });
ok('def / slot names: reserved Object.prototype / Function.prototype members and non-identifiers rejected');
{ H.reset(); const s = st(), r = install(H, [e('x/f', 'racks', { model: 1, defs: { fl: chain(['s', 'function(){window.__PWNED=1}()'], ['gain', '${window.__PWNED=2}']) } })], s);
  assert.deepEqual(r.invalid, []); assert.deepEqual(r.defs, ['fl']); run('fl'); assert.equal(globalThis.__PWNED, undefined); ok('function-like / template strings are inert string data (mini-notation), no side effect'); }
{ H.reset(); const s = st(), told = []; const good = chain(['gain', 1]); const r = install(H, [e('x/mix', 'racks', { model: 1, defs: { pre: good, bad: chain(['noSuchMethod', 1]), post: good } }), e('y/ok', 'racks', { model: 1, defs: { fine2: good } })], s, {}, (m) => told.push(m));
  assert.deepEqual(defsOf(), ['fine2', 'post', 'pre']); assert.equal(r.invalid.length, 1); assert.equal(r.invalid[0].ingredient, 'x/mix:racks'); assert.deepEqual(r.invalid[0].skipped, ['bad']); assert.equal(told.length, 1); assert.match(told[0], /1 hook def skipped.*bad/); ok('granular: one bad def is skipped and named in one notice; the other defs of its ingredient and other ingredients load');
  { H.reset(); const t2 = [], r2 = install(H, [e('x/mix', 'racks', { model: 1, defs: { pre: good }, slots: { 'bad name!': 1 } })], st(), {}, (m) => t2.push(m)); assert.deepEqual(defsOf(), []); assert.match(t2[0], /ingredient not loaded/); ok('an ingredient-level error (bad slots) still refuses the whole ingredient'); }
  H.reset(); const s2 = st(); install(H, [e('x/mix', 'racks', { model: 1, defs: { pre: good, post: good } })], s2); assert.deepEqual(defsOf(), ['post', 'pre']);
  install(H, [e('x/mix', 'racks', { model: 1, defs: { pre: good, bad: chain(['noSuchMethod', 1]), post: good } })], s2); assert.deepEqual(defsOf(), ['post', 'pre']);
  install(H, [e('x/mix', 'racks', { model: 1, defs: { pre: good, post: chain(['noSuchMethod', 1]) } })], s2); assert.deepEqual(defsOf(), ['pre']); ok('a new version where a def turned bad removes that def\'s stale copy and keeps the valid ones'); }
{ const data = { model: 1, defs: JSON.parse('{"constructor":{"chain":[["gain",1]]},"ok":{"chain":[["gain",1]]}}') }; assert.deepEqual(itemIds('hooks', data), ['ok']);
  const man = { craftpack: '1.0.0', id: 'x/c', version: '1.0.0', license: 'CC0-1.0', ingredients: [] }; const r = resolve([{ name: 'shipped', packs: [{ id: 'x/c', source: 's' }] }], { 'x/c': { manifest: man, ingredients: [{ id: 'racks', kind: 'hooks', data }] } });
  assert.deepEqual(Object.keys(r.resolution.hooks), ['ok']); ok('a def named constructor cannot crash the resolution / report (no claim, null-prototype claims)'); }
assert.equal(allow.has('constructor'), false); assert.equal(allow.has('apply'), false); assert.equal(allow.has('lpf'), true); assert.equal(allow.has('hook'), true); ok('allowlist: controls and hooks methods in, constructor / apply out');
// --- #91 rework 2: positive allowlist (site/data/hooks-steps.json) ---
const FORBIDDEN = ['bbexpr', 'byteBeatExpression', 'bbst', 'byteBeatStartTime', 'workletSrc', 'workletInputs', 'kabel', 'speak', 'pianoroll', 'punchcard', 'scope', 'spectrum', 'spiral', 'wordfall', 'pitchwheel', 'draw', 'drawLine', 'onPaint', 'markcss', 'samples', 'soundAlias', 'registerSound', 'register', 'log', 'logger', 'midi', 'midichan', 'midicmd', 'osc', 'oschost', 'serial', 'eval', 'Function', 'constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'apply', 'call', 'bind', 'fmap', 'withValue', 'every', 'off', 'jux', 'sometimes', 'hush', 'defineProperty', 'hasOwnProperty'];
{ const bad = FORBIDDEN.filter((k) => Object.prototype.hasOwnProperty.call(STEPS.methods, k)); assert.deepEqual(bad, []); ok(`the data file lists none of the ${FORBIDDEN.length} forbidden names (string-compiling, speech, visual, loader, storage / MIDI / OSC, prototype members); ${Object.keys(STEPS.methods).length} methods listed`); }
{ for (const [k, m] of Object.entries(STEPS.methods)) { assert.ok(/^[A-Za-z][A-Za-z0-9]*$/.test(k)); assert.ok(m.args.every((a) => ['scalar', 'param', 'mini', 'wire-opts', 'groove-opts'].includes(a)), k); } ok('every entry declares known argument shapes only'); }
{ // parity guard: every step of every shipped hooks ingredient (and the tests/hooks fixtures that carry defs) passes validation with the real allowlist; report non-scalars
  // every content pack under site/data (glyphcore/phonk, glyphcore/edm, ...): a directory with a craftpack.json
  const packDirs = fs.readdirSync(new URL('../../site/data/', import.meta.url)).filter((d) => fs.existsSync(new URL(`../../site/data/${d}/craftpack.json`, import.meta.url)));
  const files = packDirs.flatMap((d) => fs.readdirSync(new URL(`../../site/data/${d}/`, import.meta.url)).filter((f) => /^(racks.*|grooves)\.json$/.test(f)).map((f) => new URL(`../../site/data/${d}/` + f, import.meta.url)));
  files.push(new URL('../hooks/fixtures/h.json', import.meta.url));
  const used = new Set(), nonscalar = {}; let steps = 0;
  for (const u of files) { const d = JSON.parse(fs.readFileSync(u, 'utf8')); assert.deepEqual(rawValidate(d, allow), [], u.pathname);
    for (const v of Object.values(d.defs || {})) for (const st of v.chain || []) { steps++; assert.ok(allow.has(st[0]), 'shipped step not allowlisted: ' + st[0]); used.add(st[0]); for (const a of st.slice(1)) if (a && typeof a === 'object') (nonscalar[st[0]] ||= new Set()).add(Array.isArray(a) ? 'array' : Object.keys(a).join('+')); } }
  console.log('INFO shipped steps ' + steps + ', distinct methods ' + used.size + '; non-scalar args by method: ' + JSON.stringify(Object.fromEntries(Object.entries(nonscalar).map(([k, v]) => [k, [...v]]))));
  for (const k of Object.keys(nonscalar)) assert.ok(STEPS.methods[k].args.length > 1, k + ' needs a declared structured shape');
  ok('every step of every shipped hooks ingredient and fixture is in the allowlist and validates (parity guard)'); }
{ const mk = (...c) => ({ model: 1, defs: { evil: { chain: c } } }); const rej = (c, re) => { const r = rawValidate(mk(...c), allow); assert.ok(r.length && r.every((x) => x.code === 'E_PACK_HOOKS_INVALID'), JSON.stringify(c)); assert.match(r[0].message, re); };
  rej([['bbexpr', 't*(t>>8)']], /bbexpr/); rej([['bbexpr', ['t*(t>>8)']]], /bbexpr/); rej([['byteBeatExpression', ['1']]], /byteBeatExpression/); rej([['speak', 'en', 'x']], /speak/); rej([['pianoroll']], /pianoroll/); rej([['_scope']], /_scope/); rej([['samples', 'https://x.test/a.json']], /samples/);
  rej([['gain', [1]]], /arrays are not accepted/); rej([['gain', { a: 1 }]], /object arguments/); rej([['gain', { $param: 'x' }]], /object arguments/); rej([['s', 'x'.repeat(300)]], /not an accepted/); rej([['gain', NaN]], /not an accepted/); rej([['gain', 1, 2, 3, 4, 5, 6, 7]], /more than/);
  rej([['s', { $mini: 'a', extra: 1 }]], /object arguments/); rej([['lpf', { $param: 'nope' }]], /\$param/); rej([['wire', 'gain', 'k', { range: [1, { $expr: 'constructor' }] }]], /range/);
  rej([['groove', { swing: 60, bogus: 1 }]], /not accepted/); rej([['groove', { swing: 'x' }]], /finite number/); rej([['groove', { seed: { $param: 'nope' } }]], /finite number/); rej([['groove', [1]]], /arrays/);
  assert.deepEqual(rawValidate({ model: 1, defs: { g: { params: { seed: { default: 0 } }, chain: [['groove', { swing: 57, seed: { $param: 'seed' } }]] } } }, allow), []); ok('groove step: object of the 7 named numbers / $param accepted, anything else rejected');
  assert.deepEqual(rawValidate({ model: 1, defs: { ok: { params: { d: { default: 1 } }, chain: [['lpf', { $param: 'd' }], ['s', { $mini: 'a b' }], ['gain', 0.5]] } } }, allow), []); ok('rejected with a structured E_PACK_HOOKS_INVALID naming the method: bbexpr (string and array), byteBeatExpression, speak, a visual, samples; non-scalar and over-limit args; shaped args accepted'); }
// --- #91 rework 4: wire targets are a closed set (a control flagged "wire" in hooks-steps.json), and the engine resolves them from Strudel's registry ---
{ const mk = (...c) => ({ model: 1, defs: { evil: { chain: c } } });
  const rej = (target, re = new RegExp(String(target).replace(/\W/g, '.'))) => { const r = rawValidate(mk(['s', 'bd'], ['wire', target, 't:ev']), allow); assert.ok(r.length && r.every((x) => x.code === 'E_PACK_HOOKS_INVALID'), 'wire ' + String(target)); assert.match(r[0].message, /wire target/); assert.match(r[0].message, re); };
  for (const t of ['animate', 'pianoroll', 'bbexpr', 'byteBeatExpression', 'speak', 'constructor', '__lookupGetter__', 'toString', 'apply', 'fast', 'slow', 's', 'sound', 'bank', 'vowel', 'hook', 'wire', 'hasOwnProperty', 'nope']) rej(t);
  for (const t of [1, null, ['gain'], { a: 1 }, undefined]) { const r = rawValidate(mk(['s', 'bd'], ['wire', t, 't:ev']), allow); assert.ok(r.length && r[0].code === 'E_PACK_HOOKS_INVALID', 'wire target ' + JSON.stringify(t)); }
  for (const t of ['gain', 'lpf', 'cutoff', 'pan', 'room']) assert.deepEqual(rawValidate(mk(['s', 'bd'], ['wire', t, 't:ev', { range: [0, 1] }]), allow), [], t);
  for (const [k, m] of Object.entries(STEPS.methods)) if (m.wire) { assert.ok(RT.core.isControlName(k), k + ' flagged wire but is not a Strudel control'); assert.equal(allow.wireTarget(k), true); }
  assert.equal(allow.wireTarget('animate'), false); assert.equal(allow.wireTarget('constructor'), false);
  ok('data-only def with wire to animate / visual / bbexpr / speak / prototype member / non-control method / string control / non-string: E_PACK_HOOKS_INVALID naming the target; valid controls pass; every flag is a registered control');
  H.reset(); const s5 = st(); const r5 = install(H, [e('evil/w', 'x', { model: 1, defs: { anim: chain(['s', 'bd'], ['wire', 'animate', 't:ev']), fine: chain(['gain', 1]) } })], s5);
  assert.deepEqual(defsOf(), []); assert.equal(r5.invalid.length, 1); assert.equal(r5.invalid[0].errors[0].code, 'E_PACK_HOOKS_INVALID'); ok('installer: the ingredient with a bad wire target installs nothing (atomic)'); }
{ // engine: user-written wire on a non-control is a structured error, nothing is called (spy on animate); no probing
  const P = RT.core.Pattern.prototype; let called = 0; const orig = P.animate; P.animate = function () { called++; return this; };
  try { assert.throws(() => RT.core.s('x').wire('animate', 'k:env'), (x) => x.code === 'E_BAD_ARG' && /animate/.test(x.message)); assert.throws(() => RT.core.s('x').wire('constructor', 'k:env'), (x) => x.code === 'E_BAD_ARG'); assert.throws(() => RT.core.s('x').wire('__proto__', 'k:env'), (x) => x.code === 'E_BAD_ARG'); } finally { if (orig) P.animate = orig; else delete P.animate; }
  assert.equal(called, 0); ok('engine: wire to a non-control (animate, constructor, __proto__) throws E_BAD_ARG and calls no Pattern method'); }
{ // old (probing) versus new (registry) resolution for every registered control; the old approach lives only here, in Node, with no DOM
  const C = RT.core, names = Object.keys(C.controls).filter((k) => C.isControlName(k)); assert.ok(names.length > 400);
  const oldKey = (p) => { try { const h = C.reify({})[p](1).queryArc(0, 0)[0]; const k = h && h.value && typeof h.value === 'object' && Object.keys(h.value)[0]; return k || p; } catch { return p; } };
  H.reset(); C.s('bd*4').tap('k'); const bad = [];
  for (const nm of names) { const hp = C.s('x').wire(nm, 'k:env', { range: [7, 7] }).queryArc(0.25, 0.25)[0]; const nk = Object.keys(hp.value).find((k) => hp.value[k] === 7); if (nk !== oldKey(nm)) bad.push(`${nm}: old ${oldKey(nm)} new ${nk}`); }
  assert.deepEqual(bad, []); ok(`wire resolves the same key as the old probing for all ${names.length} registered controls (aliases included)`);
  const used = new Set(); for (const f of fs.readdirSync(new URL('../../site/data/phonk/', import.meta.url)).filter((f) => /^racks.*\.json$/.test(f))) for (const v of Object.values(JSON.parse(fs.readFileSync(new URL('../../site/data/phonk/' + f, import.meta.url), 'utf8')).defs || {})) for (const st2 of v.chain || []) if (st2[0] === 'wire') used.add(st2[1]);
  for (const t of ['gain', 'lpf', 'hpf', 'cutoff', 'pan', 'room', 'delay', ...used]) assert.ok(C.isControlName(t) && allow.wireTarget(t) , 'wire target in racks/examples: ' + t); ok('every wire target used by shipped racks and the documented examples (' + [...used].join(', ') + ') is a registered control and a flagged target'); }
console.log(`${n} checks passed`);
