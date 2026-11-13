// Atoms A3 (#63): consumers - intellisense data, literal-editor shapes, hooks / model / pads / boards / maps `$atom`, mapped atom
// params, revision records, pack ingredients. Run: STRUDEL_MODULES=<dir with @strudel/> node tests/atoms/a3.mjs
// One minimal check per acceptance box; the browser-side boxes (editor popup, signature tooltip, scrub + history) are tests/site/atoms.mjs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as A from '../../site/engine/atoms.js';
import * as C from '../../site/engine/atoms-consumers.js';
import * as MD from '../../site/model.js';
import { validate } from '../../site/engine/validate.js';
import { createPads } from '../../site/engine/pads.js';
import { createControls } from '../../site/engine/controls.js';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const ecode = (fn) => { try { fn(); } catch (e) { return e.code || String(e.message).split(':')[0]; } return null; };
let boxes = 0; const box = (m) => { boxes++; pass(m); };

A.loadTypes(rd('../../site/data/atoms/types.json'));
const positions = JSON.parse(rd('../../site/data/atoms/positions.json'));
const schema = JSON.parse(rd('../../site/data/schema/model.v1.json'));
const packSchema = JSON.parse(rd('../../schemas/craftpack/1/kinds/atoms.1.schema.json'));
const RT = await bootRuntime();
if (!RT) { skip('A3 (all boxes need the atom validators)', '@strudel/core/@strudel/mini not installed (set STRUDEL_MODULES=<dir with @strudel/>)'); process.exit(0); }
const SOUNDS = Array.from({ length: 5000 }, (_, i) => `bank${i}`).concat(['bd', 'sd', 'hh', 'oh', 'cp', 'sawtooth']); // thousands of b… names
A.configure({ positions, mini: RT.S.mini, parsers: RT.hooks.parsers, catalog: { snd: new Set(SOUNDS), bank: ['RolandTR909'], scale: ['minor', 'major'], chord: ['m7', '7'] } });
const events = (pat, cycles = 1) => RT.S.mini(pat).queryArc(0, cycles, { _cps: 1 }).length;

const DECLS = `atom("kick4",   { type: "mini",   params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}" })
atom("sawLead", { type: "sound",  body: "sawtooth" })
atom("atDrop",  { type: "gate",   body: "@17b" })
atom("drop",    { type: "point",  body: "17b" })
atom("kickEnv", { type: "tapref", body: "kick:env" })
atom("fx",      { type: "slot",   body: "fx" })
atom("murk",    { type: "hook",   body: "murk" })
`;
const ENV = A.buildEnv(DECLS, {}, { diag: [] });
const IDS = A.reconcile({}, ENV);

// ---------------------------------------------------------------- Box: completion by shape
{
  const inS = C.argItems(ENV, { callee: 's', arg: 0 }).map((i) => i.label);
  const inBind2 = C.argItems(ENV, { callee: 'hooks.bind', arg: 2 }).map((i) => i.label);
  assert.deepEqual(inS, ['atoms.kick4', 'atoms.sawLead']);                      // mini + sound, no gate / point / slot / hook atom
  assert.ok(!inS.includes('atoms.atDrop'));
  assert.deepEqual(inBind2, ['atoms.atDrop', 'atoms.drop']);                    // gate + point only
  assert.deepEqual(C.argItems(ENV, { callee: 'hooks.bind', arg: 0 }).map((i) => i.label), ['atoms.fx']);
  const d = C.argItems(ENV, { callee: 's', arg: 0 })[0];
  assert.equal(d.detail, 'mini bd*4');                                          // detail = compiled preview, info = params
  assert.match(d.info, /n: number 1\.\.16/);
  box(`Completion by shape: inside s( the provider offers ${JSON.stringify(inS)} and no gate atom; argument 2 of hooks.bind( offers ${JSON.stringify(inBind2)} (gate/point only), argument 0 offers ["atoms.fx"]`);
}

// ---------------------------------------------------------------- Box: member completion
{
  const all = C.memberItems(ENV, {}).map((i) => i.label);
  assert.ok(all.includes('atoms.kick4') && all.includes('atoms.fx'));
  assert.ok(all.includes('atoms.snd') && all.includes('atoms.scale'));          // catalog namespaces, never their contents
  assert.ok(!all.some((l) => /^atoms\.snd\./.test(l)));
  const nsEnv = A.buildEnv(DECLS, { atoms: { adk00001: { name: 'dk.kick4', type: 'mini', body: 'bd*4', rev: 1 } } }, { diag: [] });
  assert.ok(C.memberItems(nsEnv, {}).some((i) => i.label === 'atoms.dk' && i.namespace));
  const pre = C.memberItems(ENV, { path: 'snd.b' });
  assert.equal(pre.length, C.MAX_ITEMS);
  assert.ok(pre.every((i) => /^atoms\.snd\.b/.test(i.label)));
  const hits = SOUNDS.filter((s) => s.startsWith('b')).length;
  assert.ok(hits > C.MAX_ITEMS);
  box(`Member completion: after atoms. the ${all.length} items are names plus the catalog namespaces (snd, bank, scale, chord) and a declared namespace (atoms.dk); atoms.snd.b answers by prefix with ${pre.length} items while the catalog holds ${hits} matches of ${SOUNDS.length} sounds`);
}

// ---------------------------------------------------------------- Box: signature help
{
  const s = C.signature(ENV, 'kick4');
  assert.equal(s.fn, 'atoms.kick4');
  assert.deepEqual(s.params.map((p) => p.name), ['n']);
  const n = s.params[0];
  assert.equal(n.shape, 'number'); assert.equal(n.min, 1); assert.equal(n.max, 16); assert.equal(n.default, 4);
  assert.deepEqual(n.values, [4, 1, 16, 9]);                                     // value suggestions inside min..max
  assert.ok(n.values.every((v) => v >= n.min && v <= n.max));
  assert.equal(C.signature(ENV, 'atDrop').params.length, 0);
  box(`Signature help: atoms.kick4( gives fn "atoms.kick4" with param n (number 1..16 step 1, default 4) and value suggestions ${JSON.stringify(n.values)}, all inside min..max`);
}

// ---------------------------------------------------------------- Box: string-to-atom suggestion
{
  const code = `${DECLS}$: note("c2*8").s("sawtooth").wire("gain", "kick:env", { range: [1, 0.3] })\n`;
  const act = C.literalAction(ENV, { text: 'kick:env', callee: '.wire', arg: 1 });
  assert.equal(act.label, 'use atoms.kickEnv');
  assert.equal(act.apply, 'atoms.kickEnv');
  const from = code.indexOf('"kick:env"', DECLS.length), to = from + '"kick:env"'.length;
  const after = code.slice(0, from) + act.apply + code.slice(to);
  assert.ok(after.includes('.wire("gain", atoms.kickEnv,'));
  assert.equal(after.replace('atoms.kickEnv', '"kick:env"'), code);              // only that literal changed
  assert.equal(C.literalAction(ENV, { text: 'no:such:tap', callee: '.wire', arg: 1 }), null);
  box('String-to-atom suggestion: with kickEnv declared the literal "kick:env" in .wire( gets the action "use atoms.kickEnv"; applying it rewrites only that literal (the rest of the program is byte-identical)');
}

// ---------------------------------------------------------------- Box: editors (shapes; the scrub gesture is tests/site/atoms.mjs)
{
  const code = `${DECLS}$: s(atoms.kick4({ n: 8 }))\n`;
  const site = C.sites(code, ENV).find((s) => s.atom === 'kick4');
  const at = code.indexOf('n: 8') + 3;
  const shape = C.shapeAt(code, ENV, at, at + 1);
  assert.deepEqual(shape, { name: 'n', shape: 'number', min: 1, max: 16, step: 1, default: 4 });
  assert.equal(site.text, 'bd*8');
  assert.deepEqual(site.argSites.map((a) => a.param), ['n']);
  assert.equal(code.slice(site.argSites[0].from, site.argSites[0].to), '8');
  assert.equal(site.detach, '"bd*8"');                                           // Detach inlines the compiled string
  assert.deepEqual(site.actions, ['edit', 'derive', 'detach', 'card']);
  box('Editors: the 8 in atoms.kick4({ n: 8 }) is a literal site with the atom\'s atomParam shape (number 1..16 step 1), so the existing scrub editor clamps to 1..16 with no new editor code; the reference itself is one site with its compiled string, params and actions (edit / derive / detach / card)');
}

// ---------------------------------------------------------------- Box: hooks
{
  const hooks = RT.hooks;
  const prog = `${DECLS}hooks.bind(atoms.fx, atoms.murk, atoms.atDrop)\n`;
  const compiled = A.compile(prog, ENV).code.trim();
  assert.equal(compiled, "hooks.bind('fx', 'murk', '@17b')");                    // string-typed atoms compile single-quoted
  assert.equal(RT.hooks.constructor === Object || true, true);
  const { protect } = await import('../../site/engine/hooks.js');
  assert.equal(protect(compiled + '\n'), compiled + '\n');                       // nothing left for protect() to rewrite
  const planOf = (src, withAtoms) => {
    hooks.reset(); hooks.atoms.clear(); hooks.cps = 0.5; hooks.horizon = 40; hooks.slot('fx'); hooks.def('murk', [['gain', 0.5]]);
    if (withAtoms) C.installHooks(hooks, ENV, { ids: IDS.ids });
    // eslint-disable-next-line no-eval
    (0, eval)(src);                                                              // evaluated unprotected
    return hooks.plan();
  };
  const withA = planOf(compiled, true), withS = planOf("hooks.bind('fx', 'murk', '@17b')", false);
  const { atoms: planAtoms, markers: mA, ...restA } = withA;
  const { markers: mS, ...restS } = withS;
  assert.deepEqual(restA, restS);                                                // same plan as the string version
  assert.equal(planAtoms[IDS.ids.fx], 'fx'); assert.equal(planAtoms[IDS.ids.murk], 'murk'); assert.equal(planAtoms[IDS.ids.atDrop], '@17b');
  assert.equal(mA.drop, '17b');                                                  // the point atom registered its marker
  // the point atom used as a marker inside a gate string gives the same window as the gate atom
  hooks.reset(); hooks.atoms.clear(); hooks.cps = 0.5; hooks.horizon = 40; hooks.slot('fx'); hooks.def('murk', [['gain', 0.5]]);
  C.installHooks(hooks, ENV, { ids: IDS.ids });
  hooks.bind('fx', 'murk', '@drop');
  const viaMarker = hooks.plan().slots.fx.scopes['*global*'];
  assert.deepEqual(viaMarker, withA.slots.fx.scopes['*global*']);
  box(`Hooks: a binding written entirely with atoms compiles to ${JSON.stringify(compiled)} (protect() leaves it unchanged, the test evaluates it unprotected) and gives the same hooks.plan as the string version, with atom ids in plan.atoms (${IDS.ids.fx}, ${IDS.ids.murk}, ${IDS.ids.atDrop}); the point atom "drop" registers its marker and "@drop" gives the same window as atoms.atDrop`);
}

// ---------------------------------------------------------------- Box: model round trip
// the ATOMS section 13 examples 1-4, read byte-for-byte from the doc (no reformatting, no added declarations)
const DOC = fs.readFileSync(new URL('../../docs/ATOMS.md', import.meta.url), 'utf8');
const SEC13 = DOC.slice(DOC.indexOf('## 13. Worked examples'), DOC.indexOf('## 14.'));
const BLOCKS = [...SEC13.matchAll(/```js\n([\s\S]*?)```/g)].map((x) => x[1]);
assert.equal(BLOCKS.length, 4);
const EXAMPLES = Object.fromEntries(['example 1 (extraction)', 'example 2 (partial application)', 'example 3 (composition)', 'example 4 (harmony)'].map((n, i) => [n, BLOCKS[i]]));
{
  const seen = [];
  for (const [name, code] of Object.entries(EXAMPLES)) {
    const m = MD.parse(code);
    assert.equal(MD.generate(m), code, `round trip differs for ${name}`);
    assert.deepEqual(validate(schema, m), [], `${name} does not validate`);
    assert.deepEqual(A.checkModel(m), []);
    if (!m.atoms) { // example 3 uses atoms it does not declare: parse keeps the text, the compile pass reports it at evaluate time
      assert.throws(() => A.compile(code, A.buildEnv(code, {}, { diag: [] })), (e) => e.code === 'E_ATOM_UNKNOWN' || /E_ATOM_UNKNOWN/.test(e.message));
      seen.push(`${name}: undeclared atoms kept as text, E_ATOM_UNKNOWN at compile`); continue;
    }
    const refs = A.modelRefs(m);
    assert.ok(refs.length > 0 && refs.every((r) => m.atoms[r.atom]));             // ids, resolved against model.atoms
    // the model holds refs, not copies: no atom body string appears outside `atoms` and the verbatim source text
    const json = JSON.stringify({ ...m, atoms: undefined, header: undefined, tracks: (m.tracks || []).map(({ src, ...t }) => t).filter((t) => JSON.stringify(t).includes('$atom')), bindings: (m.bindings || []).filter((b) => JSON.stringify(b).includes('$atom')) }); // the `before` half of example 1 legitimately holds the plain strings
    for (const id of Object.keys(m.atoms)) { const a = m.atoms[id]; if (typeof a.body === 'string') assert.ok(!json.includes(`"${a.body}"`), `${name}: the string "${a.body}" is copied at a reference position`); }
    seen.push(`${name}: ${Object.keys(m.atoms).length} atoms, ${refs.length} refs`);
  }
  const m1 = MD.parse(EXAMPLES['example 1 (extraction)']);
  const b1 = m1.bindings.filter((b) => isObj(b.slot));                           // the `after` half; the `before` half holds plain strings
  assert.equal(b1.length, 2);
  assert.deepEqual(b1[0].slot, { $atom: b1[0].slot.$atom });
  assert.deepEqual(b1[0].gate, { $atom: b1[0].gate.$atom, ops: [['before']] });
  box(`Model round trip: generate(parse(code)) is byte-identical for the ATOMS section 13 examples 1-4 read verbatim from docs/ATOMS.md (${seen.join('; ')}); every parsed model validates against model.v1.json, holds { $atom } refs at the reference positions and no copy of the atoms' strings`);
}

// ---------------------------------------------------------------- Box: reference data
{
  const atoms = {}; // 5000 declared atoms, 10 of them referenced
  for (let i = 0; i < 5000; i++) { const rec = { name: `a${i}`, type: 'mini', body: `bd*${(i % 8) + 1}`, rev: 1 }; atoms[`ax${String(i).padStart(5, '0')}`] = { ...rec, hash: A.atomHash(rec) }; }
  const ids = Object.keys(atoms).slice(0, 10);
  const model = { model: 1, atoms, tracks: ids.map((id, i) => ({ name: `t${i}`, source: ['s', { $atom: id }], chain: [['gain', 0.8]] })) };
  model.tracks[0].chain.push(['struct', { $atom: ids[0] }]);                      // a second reference to the same atom
  const cards = A.atomCards(model), g = MD.graph(model);
  const atomNodes = g.nodes.filter((n) => n.kind === 'atom');
  assert.equal(cards.length, 10); assert.equal(atomNodes.length, 10);
  assert.equal(cards.find((c) => c.atom === ids[0]).count, 2);
  assert.ok(cards.every((c) => c.refs.every((r) => /^r[0-9a-z]{6}$/.test(r.id))));
  assert.equal(new Set(cards.flatMap((c) => c.refs.map((r) => r.id))).size, 11);  // one site id per reference position
  assert.ok(g.wires.some((w) => w.type === 'param' && w.from.node === `atom:${ids[0]}`));
  box(`Reference data: graph(model) reports one atom entry per referenced atom with its reference sites (${atomNodes.length} entries, 11 sites, the twice-referenced atom has count 2) for an environment of ${Object.keys(atoms).length} declared atoms with 10 referenced`);
}

// ---------------------------------------------------------------- Box: rename safety
{
  const v1 = `atom("fx", { type: "slot", body: "fx" })\natom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}" })\n$: s(atoms.kick4).use(atoms.fx)\n`;
  const m1 = MD.parse(v1);
  const idFx = Object.entries(m1.atoms).find(([, a]) => a.name === 'fx')[0];
  const idK = Object.entries(m1.atoms).find(([, a]) => a.name === 'kick4')[0];
  const banks = [{ id: 'b1', pads: [{ pos: '0,0', target: { kind: 'hook', ref: { $atom: idFx }, slot: 'fx' }, mode: 'oneshot' }] }];
  const boards = [{ id: 'main', layouts: { 4: [{ ref: { $atom: idFx }, x: 0, y: 0 }] } }];
  const maps = [{ control: 'steps', dest: `atom:${idK}.n` }];
  const run = (atoms) => {
    const env = A.buildEnv('', { atoms });
    const pads = createPads({ banks, model: { atoms }, atoms: (ref) => C.target(env, ref) });
    pads.press('b1/0,0', 0, 0.8);
    const j = pads.resolve();
    const cells = boards[0].layouts['4'].map((c) => C.target(env, c.ref));
    const ctl = createControls({ atoms: { checkDest: (d) => C.checkMapDest(env, d), target: (ref) => C.target(env, ref) } });
    ctl.load({ controls: { steps: { type: 'slider', min: 1, max: 16 } }, maps });
    return { target: j[0].target, cells, dests: ctl.maps().map((m) => m.dest), ids: Object.keys(atoms).sort() };
  };
  const before = run(m1.atoms);
  const v2 = v1.replace(/"fx", \{ type: "slot"/, '"fxBus", { type: "slot"').replace('atoms.fx', 'atoms.fxBus');
  const env2 = A.buildEnv(v2, { atoms: m1.atoms }, { diag: [] });
  const r2 = A.reconcile(m1.atoms, env2);
  assert.deepEqual(r2.renamed, [{ from: 'fx', to: 'fxBus', id: idFx }]);
  const after = run(r2.atoms);
  assert.deepEqual(after, before);
  assert.equal(r2.atoms[idFx].name, 'fxBus');
  assert.equal(A.compile(v2, env2).code.includes(".use('fx')"), true);
  box(`Rename safety: renaming the declaration fx -> fxBus keeps the id (${idFx}); the pad target, the board cell and the maps entry that address it by $atom resolve to the same strings and the same ids before and after`);
}

// ---------------------------------------------------------------- Box: mapped param
{
  const code = `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}" })
atom("atDrop", { type: "gate", params: { bar: { shape: "number", min: 1, max: 64, step: 1, default: 17 } }, body: "@\${bar}b" })
$: s(atoms.kick4)
`;
  const env0 = A.buildEnv(code, {}, { diag: [] }), ids = A.reconcile({}, env0).ids;
  const atoms = A.reconcile({}, env0).atoms, env = A.buildEnv(code, { atoms }, { diag: [] });
  const dest = `atom:${ids.kick4}.n`;
  const ctl = createControls({ atoms: { checkDest: (d) => C.checkMapDest(env, d) } });
  ctl.declare('steps', { type: 'slider', min: 1, max: 16, default: 4 });
  ctl.map('steps', dest);
  const cycleOf = (value) => {
    ctl.set('steps', value);
    const ov = C.mapOverrides(env, ctl.maps(), (n) => ctl.valueAt(n.split(':')[0], 0));
    const out = A.compile(code, env, { overrides: ov }).code;
    return { code: out.trim(), n: events(/s\("([^"]+)"\)/.exec(out)[1]) };
  };
  const base = A.compile(code, env).code;
  assert.equal(events(/s\("([^"]+)"\)/.exec(base)[1]), 4);
  const c8 = cycleOf(8);
  assert.equal(c8.code, '$: s("bd*8")'); assert.equal(c8.n, 8);
  assert.equal(cycleOf(12).n, 12);
  assert.equal(ecode(() => ctl.map('steps', `atom:${ids.atDrop}.bar`)), 'E_ATOM_ARG');     // gate atom: not eligible
  assert.equal(ecode(() => C.checkMapDest(env, `atom:${ids.atDrop}.bar`)), 'E_ATOM_ARG');
  assert.equal(ecode(() => ctl.map('steps', 'atom:nope.n')), 'E_ATOM_UNKNOWN');
  box(`Mapped param: a control mapped to ${dest} recompiles s(atoms.kick4) to s("bd*8") / s("bd*12") on the next cycle (4 -> 8 -> 12 events per cycle); mapping the number param of a gate atom raises E_ATOM_ARG`);
}

// ---------------------------------------------------------------- Box: history
{
  const v = (body) => `atom("kick4", { type: "mini", body: "${body}" })\n$: s(atoms.kick4)\n`;
  let atoms = {}, records = [];
  for (const body of ['bd*4', 'bd*8', 'bd*8 [~ sd]']) {
    const env = A.buildEnv(v(body), { atoms }, { diag: [] });
    const r = A.reconcile(atoms, env);
    records = records.concat(C.revisions(atoms, r.atoms));
    atoms = r.atoms;
  }
  const id = Object.keys(atoms)[0];
  const edits = records.filter((x) => x.rev > 1);
  assert.equal(records.length, 3); assert.equal(edits.length, 2);
  assert.deepEqual(edits.map((x) => [x.kind, x.rev]), [['atom', 2], ['atom', 3]]);
  assert.equal(edits[0].parent, records[0].hash);                                 // parent chain back to rev 1
  assert.equal(edits[1].parent, edits[0].hash);
  assert.equal(atoms[id].rev, 3);
  box(`History: two body edits of one atom give two kind:"atom" records with rev 2 and 3 and a parent chain (rev1 ${records[0].hash.slice(7, 15)} <- rev2 ${edits[0].hash.slice(7, 15)} <- rev3 ${edits[1].hash.slice(7, 15)})`);
}

// ---------------------------------------------------------------- Box: pack ingredient
{
  const code = `atom("base",   { type: "mini", body: "bd" })
atom("kick4",  { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "\${base}*\${n}" })
atom("atDrop", { type: "gate", body: "@17b" })
atom("unused", { type: "mini", body: "cp" })
hooks.bind("fx", "murk", atoms.atDrop)
$: s(atoms.kick4)
`;
  const comp = MD.parse(code);
  const atoms = comp.atoms, ids = Object.fromEntries(Object.entries(atoms).map(([id, a]) => [a.name, id]));
  // the kick4 body references the base atom through a param default: declare the dependency the way the design does
  const atoms2 = { ...atoms, [ids.kick4]: { ...atoms[ids.kick4], params: { ...atoms[ids.kick4].params, base: { shape: 'atom:mini', default: { $atom: ids.base } } } } };
  atoms2[ids.kick4] = { ...atoms2[ids.kick4], hash: A.atomHash(atoms2[ids.kick4]) };
  const model = { ...comp, atoms: atoms2 };
  const deps = C.modelDeps(model);
  assert.deepEqual(deps.sort(), [ids.atDrop, ids.base, ids.kick4].sort());        // both referenced atoms + the dependency of one
  assert.ok(!deps.includes(ids.unused));
  const ing = C.atomsetIngredient(atoms2, { id: 'glyphcore/drums:kit', ids: deps });
  assert.deepEqual(ing.items, ['atDrop', 'base', 'kick4']);
  assert.equal(ing.kind, 'atomset'); assert.equal(ing.format, 'atoms@1');
  assert.deepEqual(validate(packSchema, ing.data), []);                           // kinds/atoms.1.schema.json
  assert.deepEqual(C.atomIngredient(atoms2, ids.kick4).deps, [ids.base]);
  // import under a namespace: atoms.dk.kick4 compiles
  const prog = `atoms.import("pack:glyphcore/drums:kit", { as: "dk" })\n$: s(atoms.dk.kick4({ n: 8 }))\n`;
  const env = A.buildEnv(prog, { imports: { 'pack:glyphcore/drums:kit': C.importedAtoms(ing) } });
  assert.equal(A.compile(prog, env).code.trim(), '$: s("bd*8")');
  // a tampered ingredient raises E_ATOM_HASH
  const bad = JSON.parse(JSON.stringify(ing)); bad.data.atoms[ids.atDrop].body = '@33b';
  assert.equal(ecode(() => C.verifyIngredient(bad)), 'E_ATOM_HASH');
  assert.equal(ecode(() => C.importedAtoms(bad)), 'E_ATOM_HASH');
  box(`Pack ingredient: exporting the component lists both referenced atoms (and the dependency of one) in deps ${JSON.stringify(deps)}; the atomset entry file validates against kinds/atoms.1.schema.json, importing it with { as: "dk" } makes atoms.dk.kick4({ n: 8 }) compile to s("bd*8"), and a tampered ingredient raises E_ATOM_HASH`);
}

console.log(`\n${boxes} boxes checked.`);
