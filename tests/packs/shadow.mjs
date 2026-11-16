// #143: resolve() reports a shadow once per pack:name, only when the content differs; identical duplicates are info. Usage: node tests/packs/shadow.mjs
import assert from 'node:assert/strict';
import { resolve } from '../../site/engine/packs-core.js';
const atom = (name, x) => ({ name, body: x });
const ing = (id, atoms) => ({ id, kind: 'atoms', data: { atoms: Object.fromEntries(atoms.map((a) => [a.name, a])) } });
const lock = [{ name: 'shipped', packs: ['a/one', 'b/two', 'c/three'].map((id) => ({ id, source: 'file:' + id })) }];
const loaded = {
  'a/one': { version: '1', ingredients: [ing('atoms', [atom('kick', 1), atom('same', 5)]), ing('atoms-v2', [atom('kick', 1)])] }, // same pack, two ingredients, same name
  'b/two': { version: '1', ingredients: [ing('atoms', [atom('kick', 2), atom('same', 5)])] }, // kick differs, same is identical
  'c/three': { version: '1', ingredients: [] },
};
const r = resolve(lock, loaded);
assert.equal(r.warnings.length, 1, 'one real conflict');
assert.deepEqual(r.warnings[0].shadowed, ['b/two:kick']);
assert.equal(r.warnings[0].winner, 'a/one:kick');
assert.deepEqual(r.resolution.atoms.kick.shadowed, ['b/two:kick'], 'a pack never lists itself or repeats');
assert.equal(r.info.length, 1); assert.equal(r.info[0].name, 'same');
console.log('ok #143 shadow: 1 warning (kick, each pack once), 1 info (same, identical), no self/repeat losers');
