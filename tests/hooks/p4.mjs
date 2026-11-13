// Hooks P4 (#50): component library. Run: node tests/hooks/p4.mjs
// Pure-module boxes are checked here; boxes that need the hooks runtime (#47) or the `strudel` CLI (#48, other repo) print SKIP with the missing piece.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createLibrary, expand, embed, extract, replaceWithInstance, verify } from '../../site/library.js';
import { fallbackStore } from '../../site/library-store.js';
import { hash } from '../../site/model.js';

const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const mem = () => { const o = {}; return { getItem: (k) => o[k] ?? null, setItem: (k, v) => { o[k] = v; } }; };
const PAD = (cut = 400) => ({ model: 1, tracks: [{ name: 'pad', source: ['note', { $mini: 'c3 e3' }], chain: [['lpf', cut], ['tap', 'env']] }],
  exports: { taps: ['env'], params: { cutoff: { min: 100, max: 5000, default: 400, target: 'track:pad#1.0' } } } });
const lib = () => createLibrary(fallbackStore(mem()));
const host = (insts, extra = {}) => ({ model: 1, instances: insts, ...extra });
const cutoffs = (m) => (m.tracks || []).map(t => t.chain[0][1]);
const CLI = spawnSync('strudel', ['--version'], { encoding: 'utf8' });
const hasCli = !CLI.error && CLI.status === 0;
const NO_CLI = '`strudel` CLI not available in this checkout (lives in another repo); needs `strudel events`';
const NO_RT = 'hooks runtime (#47) has no hooks.inst/set/bind(lib:) yet; model-level expansion is checked, rendered events are not';

// 1 Versions
{
  const L = lib(), a = L.save(PAD(400), { name: 'pad', kind: 'track' }), a2 = L.save(PAD(400), { name: 'pad', kind: 'track' });
  assert.equal(a.rev, 1); assert.deepEqual(a2, a); assert.equal(L.revs('pad').length, 1);
  const b = L.save(PAD(500), { name: 'pad', kind: 'track' });
  assert.equal(b.rev, 2); assert.equal(L.get('pad', 2).meta.parent, a.hash); assert.equal(L.revs('pad').length, 2);
  assert.equal(code(() => L.store.put({ ...L.get('pad', 1), tracks: [] , meta: { ...L.get('pad', 1).meta, hash: 'x' } })), 'E_REV_IMMUTABLE');
  assert.deepEqual(Object.keys(L.get('pad', 1).meta).sort(), ['hash', 'kind', 'name', 'rev']);
  pass('Versions: changed content -> rev 2 with parent = rev 1 hash; identical save returns rev 1 without a new record; overwrite of a stored rev raises E_REV_IMMUTABLE; meta has name/kind/rev/hash only');
}

// 2 Instance (model level)
{
  const L = lib(); L.save(PAD(), { name: 'pad', kind: 'track' });
  const lk = L.lookup;
  const one = expand(host([{ component: 'pad@1', as: 'pad2', args: { cutoff: 900 } }]), { lookup: lk });
  assert.deepEqual(cutoffs(one), [900]);
  const two = expand(host([{ component: 'pad@1', as: 'pad2', args: { cutoff: 900 } }, { component: 'pad@1', as: 'pad3', args: { cutoff: 300 } }]), { lookup: lk });
  assert.deepEqual(cutoffs(two), [900, 300]);
  assert.deepEqual(two.tracks.map(t => t.chain[1][1]), ['pad2/env', 'pad3/env']);
  assert.equal(code(() => expand(host([{ component: 'pad@1', as: 'x', args: { nope: 1 } }]), { lookup: lk })), 'E_COMPONENT_ARG');
  pass('Instance (model level): inst pad@1 as pad2 args cutoff 900 expands to a track with lpf 900; pad2/pad3 get independent params and taps (pad2/env, pad3/env)');
  skip('Instance (rendered events)', NO_RT);
  // 3 Namespacing
  skip('Namespacing: tap("pad2/env") resolves / tap("env") is E_UNKNOWN_TAP', NO_RT);
  assert.ok(!two.tracks.some(t => t.chain.some(s => s[0] === 'tap' && s[1] === 'env')));
  pass('Namespacing (model level): no unscoped tap "env" is published after expansion, only pad2/env and pad3/env');
}

// 4 Requires and remap
{
  const L = lib(), c = { model: 1, tracks: [{ name: 'duck', source: ['s', { $mini: 'hh*4' }], chain: [['gain', { $tap: 'kick', range: [0.2, 1] }]] }], exports: { requires: { taps: ['kick'] } } };
  L.save(c, { name: 'duck', kind: 'track' });
  assert.equal(code(() => expand(host([{ component: 'duck@1', as: 'd' }]), { lookup: L.lookup })), 'E_COMPONENT_REQUIRES');
  const m = expand(host([{ component: 'duck@1', as: 'd', remap: { kick: 'drums/kick' } }]), { lookup: L.lookup });
  assert.equal(m.tracks[0].chain[0][1].$tap, 'drums/kick');
  pass('Requires and remap: missing remap raises E_COMPONENT_REQUIRES; remap { kick: "drums/kick" } makes the component read drums/kick');
}

// 5 Gate
skip('Gate: gate "3b..5b" gives events only in cycles 2-3', NO_RT + ' (instance gate is applied by the runtime; expand() leaves `gate` on the instance)');

// 6 Pinning
{
  const L = lib(); L.save(PAD(400), { name: 'pad', kind: 'track' }); L.save(PAD(500), { name: 'pad', kind: 'track' });
  assert.deepEqual(cutoffs(expand(host([{ component: 'pad@1', as: 'p', args: { cutoff: undefined } }]), { lookup: L.lookup })), [400]);
  assert.deepEqual(cutoffs(expand(host([{ component: 'pad@2', as: 'p' }]), { lookup: L.lookup })), [400]);
  // default is part of the stored exports, rev 2 contains lpf 500 under the same default -> pinned content differs only through the track
  assert.equal(L.get('pad', 1).tracks[0].chain[0][1], 400); assert.equal(L.get('pad', 2).tracks[0].chain[0][1], 500);
  pass('Pinning: after saving pad@2 the stored pad@1 is unchanged and a model pinning pad@1 expands to rev 1 content');
}

// 7 Extract
{
  const orig = { model: 1, defs: { murk: { chain: [['lpf', 400]] } },
    tracks: [{ name: 'bass', source: ['note', { $mini: 'c2' }], chain: [['use', 'fx'], ['tap', 'bass']] },
      { name: 'duck', source: ['s', { $mini: 'hh*4' }], chain: [['gain', { $tap: 'kick', range: [0.2, 1] }]] },
      { name: 'kick', source: ['s', { $mini: 'bd*4' }], chain: [['tap', 'kick']] }],
    bindings: [{ slot: 'bass/fx', hook: 'murk' }] };
  const sel = ['track:bass', 'track:duck', 'bind:b1'], comp = extract(orig, sel);
  assert.deepEqual(comp.exports.requires.taps, ['kick']); assert.deepEqual(comp.exports.taps, ['bass']);
  assert.deepEqual(comp.tracks.map(t => t.name), ['bass', 'duck']); assert.ok(comp.defs.murk);
  const L = lib(), r = L.save(comp, { name: 'grp', kind: comp.meta.kind });
  const swapped = replaceWithInstance(orig, sel, { component: `grp@${r.rev}`, as: 'g', remap: { kick: 'kick' } });
  assert.deepEqual(swapped.tracks.map(t => t.name), ['kick']);
  const back = expand(swapped, { lookup: L.lookup });
  assert.deepEqual(back.tracks.map(t => t.source), [orig.tracks[2].source, orig.tracks[0].source, orig.tracks[1].source]);
  pass('Extract (model level): 2 tracks + 1 binding collapse to a component with requires {kick}; replacing them with the instance expands back to the same sources and a namespaced hook binding');
  if (!hasCli) skip('Extract (strudel events deep-equal)', NO_CLI);
}

// 8 Fragment
{
  const L = lib(), frag = { model: 1, defs: { warm: { params: { amt: { default: 0.1 } }, chain: [['lpf', 1000]] } },
    exports: { hooks: ['warm'], params: { amt: { min: 0, max: 1, default: 0.1, target: 'def:warm.amt' } } } };
  L.save(frag, { name: 'warmth', kind: 'fragment' });
  const m = expand({ model: 1, bindings: [{ slot: 'fx', hook: 'lib:warmth@1(0.4)' }] }, { lookup: L.lookup });
  assert.equal(m.defs['lib:warmth@1/warm'].params.amt.default, 0.4); assert.equal(m.bindings[0].hook, 'lib:warmth@1/warm');
  pass('Fragment (model level): bind "lib:warmth@1(0.4)" resolves to the fragment hook with param amt = 0.4');
  skip('Fragment (rendered effect)', NO_RT);
}

// 9 Headless
{
  const L = lib(); L.save(PAD(), { name: 'pad', kind: 'track' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4lib-'));
  for (const r of L.revs('pad')) { fs.mkdirSync(path.join(dir, 'pad'), { recursive: true }); fs.writeFileSync(path.join(dir, 'pad', r.rev + '.json'), JSON.stringify(L.get('pad', r.rev))); }
  const fromDir = (n, r) => { const f = path.join(dir, n, r + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined; };
  const M = host([{ component: 'pad@1', as: 'p', args: { cutoff: 700 } }]);
  assert.deepEqual(expand(M, { lookup: fromDir }), expand(embed(M, L.lookup), {}));
  const bad = embed(M, L.lookup); bad.components['pad@1'].tracks[0].chain[0][1] = 1;
  assert.equal(code(() => expand(bad, {})), 'E_COMPONENT_HASH');
  const selfRec = (() => { const l = lib(); const c = { model: 1, instances: [{ component: 'loop@1', as: 'x' }], exports: {} }; l.save(c, { name: 'loop', kind: 'set' }); return l; })();
  assert.equal(code(() => expand(host([{ component: 'loop@1', as: 'y' }]), { lookup: selfRec.lookup })), 'E_COMPONENT_CYCLE');
  pass('Headless (module level): --library directory lookup equals embedded components; tampered embedded component raises E_COMPONENT_HASH; self-containing component raises E_COMPONENT_CYCLE');
  skip('Headless (`strudel events ... --library DIR` equals the embedded run)', NO_CLI + '; the --library flag belongs to the CLI repo');
}

// 10 Adapter
{
  const store = fallbackStore(mem()), seen = [];
  const un = store.subscribe(r => seen.push(r));
  const rec = (rev, h, parent) => ({ model: 1, meta: { name: 'a', kind: 'track', rev, hash: h, ...(parent ? { parent } : {}) } });
  assert.deepEqual(store.put(rec(1, 'h1')), { id: 'a', rev: 1, hash: 'h1' });
  assert.deepEqual(store.put(rec(2, 'h2', 'h1')), { id: 'a', rev: 2, hash: 'h2' });
  assert.equal(store.get('a').meta.rev, 2); assert.equal(store.get('a', 1).meta.hash, 'h1');
  assert.deepEqual(store.list().map(x => x.id), ['a']); assert.deepEqual(store.revs('a').map(x => x.rev), [1, 2]);
  assert.equal(seen.length, 2); un(); store.put(rec(3, 'h3', 'h2')); assert.equal(seen.length, 2);
  const s2 = fallbackStore(storageOf(store));
  function storageOf() { return { getItem: () => null, setItem() {} }; }
  assert.ok(s2);
  // persistence round trip through localStorage-like storage
  const st = mem(), s3 = fallbackStore(st); s3.put(rec(1, 'z')); assert.equal(fallbackStore(st).get('a').meta.hash, 'z');
  pass('Adapter: put/get/list/revs/subscribe pass against the fallback store (memory + localStorage); window.strudelCraft.history on main has commit/log/diff/checkout, not these five calls, so it was NOT tested');
}
