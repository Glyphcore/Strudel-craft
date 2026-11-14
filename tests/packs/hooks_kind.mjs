// Unit checks for the site adapter of pack kind `hooks` (#91): site/packs-kinds.js (check, items, code rule) + site/packs-hooks.js (install) against the real hooks runtime.
// Usage: STRUDEL_MODULES=<dir with @strudel/core and @strudel/mini> node tests/packs/hooks_kind.mjs
import assert from 'node:assert/strict';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';
import { KINDS, DEFERRED } from '../../site/packs-kinds.js';
import { install } from '../../site/packs-hooks.js';
const RT = await bootRuntime();
if (!RT) { console.log('SKIP @strudel/core/@strudel/mini not installed (set STRUDEL_MODULES)'); process.exit(0); }
const H = RT.hooks; let n = 0; const ok = (m) => { n++; console.log('PASS ' + m); };
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
console.log(`${n} checks passed`);
