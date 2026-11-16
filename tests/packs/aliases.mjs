// Aliases and the migration of orphans (docs/PACKAGES.md section 5): an older id keeps resolving. Run: node tests/packs/aliases.mjs
//  1 packs-core: a bare alias of a recipe, atom and hooks def resolves to the qualified item; a real id beats an alias; two packs: precedence decides
//  2 library: a component saved with aliases answers get(oldName); lib: refs keep resolving after a rename
//  3 migration: every ingredient id of glyphcore/phonk before the change is still there (atoms.import("pack:glyphcore/phonk:<id>") unchanged);
//    the groove presets shipped as pack content equal the engine standard library def for def (folder and tags aside); every catalog recipe id is still a catalog id
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, itemAliases } from '../../site/engine/packs-core.js';
import { createLibrary } from '../../site/library.js';
import { fallbackStore } from '../../site/library-store.js';
import { GROOVES } from '../../site/engine/groove.js';
const rd = (f) => JSON.parse(readFileSync(new URL('../../' + f, import.meta.url), 'utf8'));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok   ' + name); };

const layers = [{ name: 'shipped', packs: [{ id: 'a/one', source: 'file:.' }, { id: 'b/two', source: 'file:.' }] }];
const loaded = {
  'a/one': { ingredients: [{ id: 'r', kind: 'recipes', data: { recipes: [{ id: 'new-name', aliases: ['old-name', 'shared'] }, { id: 'real' }] } },
    { id: 'at', kind: 'atoms', data: { atoms: { a1: { name: 'hh.kickNew', aliases: ['hh.kickOld'] } } } },
    { id: 'hk', kind: 'hooks', data: { defs: { bbKick2: { aliases: ['bbKick'], chain: [] } } } }] },
  'b/two': { ingredients: [{ id: 'r', kind: 'recipes', data: { recipes: [{ id: 'old-name' }, { id: 'other', aliases: ['real', 'shared'] }] } }] },
};
ok('itemAliases lists [alias, id] pairs per kind', () => assert.deepEqual(itemAliases('recipes', loaded['a/one'].ingredients[0].data), [['old-name', 'new-name'], ['shared', 'new-name']]));
const { resolution: R, errors } = resolve(layers, loaded);
ok('no errors', () => assert.deepEqual(errors, []));
ok('a bare alias of a recipe resolves to the qualified item when nobody owns that id', () => assert.equal(R.recipes.shared.winner, 'a/one:new-name'));
ok('the second claimant of an alias is listed as shadowed', () => assert.deepEqual(R.recipes.shared.shadowed, ['b/two:other']));
ok('a real item id beats an alias of the same name (b/two defines old-name)', () => { assert.equal(R.recipes['old-name'].winner, 'b/two:old-name'); assert.ok(!R.recipes['old-name'].alias); });
ok('a real id of one pack beats an alias of another (real)', () => assert.equal(R.recipes.real.winner, 'a/one:real'));
ok('an atom alias resolves', () => assert.equal(R.atoms['hh.kickOld'].winner, 'a/one:hh.kickNew'));
ok('a hooks def alias resolves', () => assert.equal(R.hooks.bbKick.winner, 'a/one:bbKick2'));
ok('alias entries are marked', () => assert.equal(R.hooks.bbKick.alias, true));

ok('library: get(oldName) answers through meta.aliases, rev and hash intact', () => {
  const lib = createLibrary(fallbackStore(null));
  const model = { model: 1, tracks: [] };
  const a = lib.save(model, { name: 'kick-v2', kind: 'track', aliases: ['kick'], folder: 'drums/kick', tags: ['kick'] });
  const rec = lib.get('kick'); assert.ok(rec); assert.equal(rec.meta.name, 'kick-v2'); assert.equal(rec.meta.folder, 'drums/kick'); assert.deepEqual(rec.meta.aliases, ['kick']);
  assert.equal(lib.lookup('kick', a.rev).meta.hash, a.hash); assert.equal(lib.get('missing'), undefined);
});

const BEFORE = { 'glyphcore/phonk': ['atoms', 'racks', 'atoms-v2', 'racks-v2', 'presets', 'racks-hiphop', 'atoms-hiphop', 'atoms-dovetail', 'feel-boombap', 'feel-lazy', 'feel-trap', 'feel-hyphy', 'feel-cloud'] };
ok('every pre-existing ingredient id of glyphcore/phonk is still there (atoms.import and lib: refs unchanged)', () => {
  const have = rd('site/data/phonk/craftpack.json').ingredients.map((i) => i.id); for (const id of BEFORE['glyphcore/phonk']) assert.ok(have.includes(id), id);
});
ok('glyphcore/phonk:grooves equals the engine standard library def for def', () => {
  const g = rd('site/data/phonk/grooves.json').defs; assert.deepEqual(Object.keys(g).sort(), Object.keys(GROOVES).sort());
  for (const [k, d] of Object.entries(g)) { const { folder, tags, ...rest } = d; assert.deepEqual(rest, JSON.parse(JSON.stringify(GROOVES[k])), k); assert.ok(folder && tags.length, k + ' has folder and tags'); }
});
ok('every catalog recipe id from origin/main is still a catalog id', () => {
  const before = JSON.parse(execSync('git show origin/main:site/data/catalog.json', { cwd: new URL('../../', import.meta.url).pathname, maxBuffer: 1 << 26 }).toString()).recipes.map((r) => r.id);
  const now = new Set(rd('site/data/catalog.json').recipes.map((r) => r.id)); for (const id of before) assert.ok(now.has(id), id);
});
{ const H = await import('../../site/packs-hooks.js'); const allow = new Set(['hpf']); const good = H.validate({ model: 1, defs: { a: { chain: [['hpf', 40]], folder: 'racks/drums', tags: ['drums', 'rack'], aliases: ['old-a'] } } }, allow); const bad = H.validate({ model: 1, defs: { a: { chain: [['hpf', 40]], folder: 'Bad Path' } } }, allow);
  assert.ok(!(good && (good.errors || good).length), JSON.stringify(good)); assert.ok(bad && (bad.errors || bad).length, 'bad folder must be reported'); n++; console.log('ok   packs-hooks validate: folder/tags/aliases accepted, bad folder refused'); }
console.log(`${n} checks passed`);
