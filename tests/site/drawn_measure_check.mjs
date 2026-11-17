// The committed rack measurement of the drawn instruments (#182): `node tests/site/drawn_measure_check.mjs` (Node only).
// docs/data/drawn-measure.json is written by `node tools/racks/drawn_measure.mjs` (renders through the site offline recorder, needs a browser); this test checks the file:
// every non-room instrument of glyphcore/drawn-core has a result, none dropped a hap in the render, and the realism rating in the pack agrees with the numbers
// (an instrument whose raw render and hygiene-hook render both miss its class limits may not be rated usable or good). It also shows the rule can fail.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/data/drawn-measure.json'), 'utf8')), byId = new Map(M.results.map((r) => [r.id, r]));
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/drawn-core/craftpack.json'), 'utf8'));
const insts = pack.ingredients.filter((i) => i.kind === 'waveforms').flatMap((i) => JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/drawn-core', i.path), 'utf8')).instruments).filter((i) => !(i.model && i.model.kind === 'room'));
const verdict = (inst, res) => { // returns a problem string or null
  if (!res) return 'no measurement';
  if (res.error) return 'render error: ' + res.error;
  if (!(res.render.haps > 0) || res.render.fails !== 0) return `render dropped haps (${res.render.fails}/${res.render.haps})`;
  const passes = res.pass || (res.with_hygiene && res.with_hygiene.pass);
  if (!passes && ['usable', 'good'].includes(inst.realism)) return `rated ${inst.realism} but the numbers miss its class limits (raw and with hygiene)`;
  return null;
};
for (const inst of insts) { const res = byId.get(inst.id), p = verdict(inst, res); ok(!p, `${inst.id}: ${p || `rated ${inst.realism}; raw ${res.pass ? 'pass' : 'miss'}${res.with_hygiene ? ', with ' + res.with_hygiene.hook + ' ' + (res.with_hygiene.pass ? 'pass' : 'miss') : ''}; class ${res.class}`}`); }
ok(insts.length >= 15, `${insts.length} instruments checked (wavetable instruments, drums, steel guitar, FM percussion)`);
// the rule can fail
const fake = { render: { haps: 4, fails: 0 }, pass: false, with_hygiene: { pass: false } };
ok(verdict({ realism: 'usable' }, fake) !== null && verdict({ realism: 'stand-in' }, fake) === null && verdict({ realism: 'usable' }, { ...fake, render: { haps: 4, fails: 4 } }) !== null && verdict({ realism: 'usable' }, undefined) !== null, 'the rule fails on: a missing result, dropped haps, a usable rating over missed limits; and accepts a stand-in rating');
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
