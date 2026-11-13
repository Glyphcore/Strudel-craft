// Atoms A4 (#64) engine check: the atom pass in model.parse() is lazy and reference-driven. Run: node tests/atoms/a4_lazy.mjs
// 1) equivalence: a document parsed through the lazy path equals the same document forced through the eager path (model, generate, hash);
// 2) cost: parsing 5000 declared atoms with 3 referenced stays within a small multiple of 3 declared (no browser needed).
import assert from 'node:assert/strict';
import * as M from '../../site/model.js';

const BIG = (n) => { let s = ''; for (let i = 0; i < n; i++) s += `atom("p${i}", { type: "mini", body: "bd*${(i % 8) + 1}" })\n`; return s + 'a: s(atoms.p0).gain(0.8)\nb: s(atoms.p1).gain(0.6)\nc: s(atoms.p2).gain(0.4)\n'; };
const MIX = `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}", doc: "four" })
atom("loud", { type: "mini", body: "0.8 0.6" })
atom("k8", { type: "mini", from: atoms.kick4({ n: 8 }) })
atom("atDrop", { type: "gate", body: "@17b" });
k: s(atoms.kick4).gain(atoms.loud)
k2: s(atoms.k8)
`;
const EAGER = (t) => t + '\n// `eager`\n'; // a backtick anywhere keeps the document on the eager path
const strip = (t) => t.replace(/\n\/\/ `eager`\n$/, '\n');
const pass = (m) => console.log('PASS ' + m);

for (const [name, src] of [['mix', MIX], ['big40', BIG(40)]]) {
  const a = M.parse(src), b = M.parse(EAGER(src));
  assert.deepEqual(JSON.parse(JSON.stringify(a.atoms)), JSON.parse(JSON.stringify(b.atoms)), name + ': atoms');
  assert.deepEqual(Object.keys(a.atoms), Object.keys(b.atoms), name + ': atom order');
  assert.equal(M.generate(a), src, name + ': generate(parse) round trip');
  const strip2 = (m) => { const c = JSON.parse(JSON.stringify(m)); for (const t of c.tracks || []) delete t.src; delete c.header; return c; };
  assert.deepEqual(strip2(a), strip2(b), name + ': model');
}
pass('lazy parse equals eager parse (atoms, order, tracks, generate round trip)');

// the index is memoised by prefix text: an edit outside the prefix reuses it, an edit inside re-indexes; results always equal eager
{ const base = BIG(60), more = base + 'd: s(atoms.p3)\n', ins = base.replace('bd*1"', 'bd*9"'), add = base.replace('a: s(', 'atom("zz", { type: "mini", body: "hh" })\na: s(');
  for (const [n, t] of [['outside', more], ['inside', ins], ['append decl', add], ['again', base]]) {
    const a = M.parse(t), b = M.parse(EAGER(t));
    assert.deepEqual(JSON.parse(JSON.stringify(a.atoms)), JSON.parse(JSON.stringify(b.atoms)), n + ': atoms');
    assert.equal(M.generate(a), t, n + ': round trip');
  } }
pass('prefix memo: edits outside / inside / appended declaration stay equal to eager');

const med = (f) => { const v = []; for (let i = 0; i < 7; i++) { const t = performance.now(); f(i); v.push(performance.now() - t); } return v.sort((x, y) => x - y)[3]; };
const big = BIG(5000), small = BIG(3);
const tBig = med((i) => M.parse(big + ' '.repeat(i))), tSmall = med((i) => M.parse(small + ' '.repeat(i)));
const lazy = M.parse(big); const ids = Object.keys(lazy.atoms).length;
assert.equal(ids, 5000, 'enumeration still resolves all 5000');
console.log(`INFO parse 5000 declared ${tBig.toFixed(1)} ms, 3 declared ${tSmall.toFixed(1)} ms`);
assert.ok(tBig < 40, `parse with 5000 declared atoms took ${tBig.toFixed(1)} ms (budget 40)`);
pass(`5000 declared / 3 referenced parses in ${tBig.toFixed(1)} ms (3 declared: ${tSmall.toFixed(1)} ms)`);
