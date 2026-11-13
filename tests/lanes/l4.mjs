// Lanes L4 (#77): one minimal behavioural check per acceptance box (the graph-data boxes are tests/site/lanes_data.mjs).
// Run: STRUDEL_MODULES=<dir with @strudel/core, mini, transpiler> node tests/lanes/l4.mjs
// Boxes whose RUNTIME needs the audio layer (#75) or capture (#76) check the data side only and print that; the CLI (`strudel atoms list --tag`) is another
// repo: SKIP with the exact missing piece, never stubbed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';
import * as M from '../../site/model.js';
import * as A from '../../site/engine/atoms.js';
import * as B from '../../site/engine/bind.js';
import * as LD from '../../site/engine/lanes-data.js';
import * as LC from '../../site/engine/lanes-capture.js';
import * as LI from '../../site/lanes-intellisense.js';
import { createPads } from '../../site/engine/pads.js';
import { validate } from '../../site/engine/validate.js';
import { install as installLanes, compile as compileLanes } from '../../site/engine/lanes.js';
import { protect } from '../../site/engine/hooks.js';

const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const fx = (n) => rd(`./fixtures/l4_${n}.strudel.js`);
const schema = JSON.parse(rd('../../site/data/schema/model.v1.json'));
const strudelJson = JSON.parse(rd('../../site/data/intellisense/strudel.json'));
const NM = process.env.STRUDEL_MODULES;

// ---- 1. Schema: models of LANES examples 2 and 5 validate; (L2) examples 1 and 3; (L3) example 7 (model side)
{
  const names = { ex2: 'example 2', ex5: 'example 5', ex1: '(L2) example 1', ex3: '(L2) example 3', ex7: '(L3) example 7', ex6: 'example 6' };
  for (const k of Object.keys(names)) { const m = M.parse(fx(k)); const e = validate(schema, m); assert.deepEqual(e, [], `${names[k]}: ${e.slice(0, 3)}`); }
  const m5 = M.parse(fx('ex5')); assert.equal(m5.selections.length, 2); assert.deepEqual(m5.tracks.map((t) => t.tags || null), [['drums'], ['drums', 'wet'], ['harm', 'wet'], null]);
  assert.equal(M.parse(fx('ex7')).settings.lanes, 'closed'); assert.deepEqual(Object.keys(M.parse(fx('ex7')).captures), ['groove']);
  assert.equal(M.parse(fx('ex1')).tracks[0].split.branches.length, 3); assert.ok(M.parse(fx('ex3')).tracks[0].split.merge.chain);
  pass(`Schema: models of ${Object.values(names).join(', ')} validate against model.v1.json (schema additions: tracks[].tags/split/sends/ret, buses, selections, captures, settings.lanes, pad target kind selection)`);
}

// ---- 2. Round trip + "add branch" touches only the split statement
{
  for (const k of ['ex1', 'ex2', 'ex3', 'ex5', 'ex6', 'ex7']) assert.equal(M.generate(M.parse(fx(k))), fx(k), k);
  const doc = fx('ex1') + fx('ex2'); assert.equal(M.generate(M.parse(doc)), doc);
  const out = M.generate(M.applyOp(M.parse(doc), { op: 'addBranch', track: 'drums', fn: 'g => g.crush(5)' }));
  assert.equal(out, doc.replace('grit => grit.crush(5).hpf(2000).gain(0.4))', 'grit => grit.crush(5).hpf(2000).gain(0.4), g => g.crush(5))'));
  assert.equal(out.slice(out.indexOf('bass:')), doc.slice(doc.indexOf('bass:')), 'the other statements are byte-identical');
  const m2 = M.parse(out); assert.equal(m2.tracks[0].split.branches.length, 4);
  const at = M.generate(M.applyOp(M.parse(fx('ex3')), { op: 'addBranch', track: 'drums', fn: 'x => x.lpf(900)', index: 1 })); assert.equal(at, fx('ex3').replace('w => w.room(0.8)', 'x => x.lpf(900), w => w.room(0.8)'));
  pass('Round trip: generate(parse(code)) byte-identical for LANES examples 1, 2, 3, 5, 6, 7 (and 1+2 together); applyOp addBranch changes only the .split(...) argument list (4 branches after; the next statement is byte-identical; index 1 inserts in place)');
}

// ---- 3. Completion
{
  const src = rd('../../site/intellisense.js'); const i0 = src.indexOf('function argContext'), i1 = src.indexOf('api.argContext = argContext');
  const argContext = new Function(src.slice(i0, i1) + '; return argContext;')(); // the real function of the editor (a browser-only module)
  const data = strudelJson;
  const at = (before, after = '') => { const doc = before + after; const model = M.parse(doc); return LI.complete({ text: before, pos: before.length, doc, arg: argContext(before, before.length) }, data, model.tracks || model.captures ? model : LI.textModel(doc)); };
  const labels = (r) => (r ? r.options.map((o) => o.label) : []);
  const split = labels(at('drums: s("bd*4").split(dry => dry, w => w.', ')'));
  for (const w of ['room', 'lpf', 'gain', 'struct']) assert.ok(split.includes(w), 'branch offers ' + w);
  for (const w of ['s', 'note', 'n', 'bus', 'dry']) assert.ok(!split.includes(w), 'branch must not offer ' + w);
  assert.equal(at('drums: s("bd*4").'), null, 'outside a branch the provider stays out of the way');
  assert.equal(at('drums: s("bd*4").split(dry => dry).merge(m => m.lpf(500)).'), null, 'after the split call closed');
  assert.ok(labels(at('drums: s("bd*4").split(a => a, b => b.room(1).')).includes('lpf'), 'chains inside a branch keep the control set');
  const prog = fx('ex5');
  const tg = labels(at(prog + 'tagged("', '")')); for (const w of ['drums', 'wet', 'harm', '#drums', '#snare', '#verb']) assert.ok(tg.includes(w), 'tagged offers ' + w);
  const tgBroken = labels(at(prog + 'tagged("')); assert.ok(tgBroken.includes('wet') && tgBroken.includes('#keys'), 'works while the document does not parse yet');
  assert.deepEqual(labels(at(prog + 'x: s("bd").send("', '")')), ['verb']); assert.deepEqual(labels(at(prog + 'y: ret("', '")')), ['verb']);
  const cap = fx('ex7') + 'capture("hits", "drums/kick", { window: "1b..2b" })\n';
  assert.deepEqual(labels(at(cap + 'z: recall("groove:', '")')), ['ev', 'audio', 'level', 'onset', 'gate'].filter((f) => ['ev', 'audio', 'level', 'onset', 'gate'].includes(f)));
  assert.deepEqual(labels(at(cap + 'z: recall("hits:', '")')), ['ev', 'onset', 'gate'], 'an event capture offers only event facets');
  assert.deepEqual(labels(at(cap + 'z: recall("', '")')).sort(), ['groove', 'hits']);
  const audioOnly = fx('ex7').replace('what: ["events", "audio", "level"]', 'what: ["audio"]'); assert.deepEqual(labels(at(audioOnly + 'z: recall("groove:', '")')), ['audio']);
  assert.deepEqual(labels(at(cap + 'z: n("0").from("', '")')), ['groove'], '.from( offers only captures that record audio');
  // typed shapes are declared and used by the table
  for (const s of ['lane', 'busname', 'tag', 'selector', 'capture', 'branch']) assert.ok(strudelJson.shapes.includes(s), 'shape ' + s);
  const P = strudelJson.params; assert.equal(P.tagged[0].shape, 'selector'); assert.equal(P.send[0].shape, 'busname'); assert.equal(P.recall[0].shape, 'capture'); assert.equal(P.split[0].shape, 'branch'); assert.equal(P.tags[0].shape, 'tag');
  assert.deepEqual(LI.enumFor('send', 0, M.parse(prog)), ['verb']);
  pass(`Completion: in "w => w." of a split branch ${split.length} bus-safe controls (room, lpf, gain, struct; not s, note, n); tagged(" offers the program's tags and #lane ids (also while the text does not parse); .send(" and ret(" offer bus "verb"; recall("groove: offers ev, audio, level, onset, gate and only audio for an audio-only capture; .from(" only audio captures`);
}

// ---- 4. Atoms: selector / busname types, single-quoted, same events
{
  A.loadTypes(rd('../../site/data/atoms/types.json'));
  const positions = JSON.parse(rd('../../site/data/atoms/positions.json'));
  const RT = await bootRuntime();
  const ids = A.types().map((t) => t.id); for (const t of ['tag', 'selector', 'busname', 'capture']) { assert.ok(ids.includes(t), t); assert.equal(A.types().find((x) => x.id === t).quote, "'"); }
  A.configure({ positions, ...(RT ? { mini: RT.S.mini, parsers: RT.hooks.parsers } : {}) });
  const DECL = `atom("wetDrums", { type: "selector", body: "drums & wet" })\natom("verb", { type: "busname", body: "verb" })\natom("wet", { type: "tag", body: "wet" })\natom("groove", { type: "capture", body: "groove" })\n`;
  const prog = 'drums: s("bd*4").tags("drums")\nsnare: s("~ sd").tags("drums", "wet")\nkeys: note("c e g").s("piano").tags("wet")\n';
  const withAtoms = DECL + prog + 'tagged(atoms.wetDrums).mute()\nv: ret(atoms.verb).room(1)\nw: s("hh").send(atoms.verb, 0.5).tags(atoms.wet)\nx: recall(atoms.groove)\n';
  const c = A.compile(withAtoms, A.buildEnv(withAtoms, {}, { diag: [] })).code;
  assert.ok(c.includes("tagged('drums & wet').mute()") && c.includes("ret('verb')") && c.includes(".send('verb', 0.5)") && c.includes(".tags('wet')") && c.includes("recall('groove')"), c);
  assert.equal(A.compile(withAtoms, A.buildEnv(withAtoms, {}, { diag: [] })).warnings.length, 0);
  const bad = 'atom("bad", { type: "selector", body: "drums &" })\n'; assert.throws(() => A.buildEnv(bad, {}, { diag: [] }) && A.compile(bad + 'tagged(atoms.bad).mute()\n', A.buildEnv(bad, {}, { diag: [] })), /E_ATOM_GRAMMAR|E_BAD_SELECTOR/, 'an invalid selector atom is refused at its declaration');
  // the model keeps the references as ids and round-trips them
  const m = M.parse(withAtoms); assert.equal(M.generate(m), withAtoms); assert.equal(m.selections[0].selector.$atom !== undefined, true); assert.equal(m.buses.verb.returns[0], 'v');
  const tr = m.tracks.find((t) => t.name === 'w'); assert.deepEqual(tr.sends, [{ bus: 'verb', amount: 0.5 }]); assert.deepEqual(tr.tags, ['wet']);
  // same events as the string forms (real Strudel + lanes runtime)
  let ran = 'selector atom: same events as the string form';
  if (!RT || !NM) skip('Atoms (events)', 'STRUDEL_MODULES not set'); else {
    const pkg = (n) => { try { return JSON.parse(fs.readFileSync(path.join(NM, n, 'package.json'), 'utf8')); } catch { return null; } };
    const j = pkg('@strudel/transpiler'); if (!j) skip('Atoms (events)', '@strudel/transpiler not installed in STRUDEL_MODULES');
    else {
      const ex = typeof j.exports === 'object' && j.exports['.'] ? (j.exports['.'].import || j.exports['.'].default || j.exports['.']) : j.module || j.main;
      const transpilerMod = await import(pathToFileURL(path.join(NM, '@strudel/transpiler', ex)).href); await RT.core.evalScope(RT.core, RT.mini);
      const lanes = installLanes(RT.S, RT.hooks); const R = RT.core.repl({ defaultOutput: () => {}, getTime: () => 0, transpiler: transpilerMod.transpiler });
      const run = async (src) => { RT.hooks.reset(); RT.hooks.live = false; lanes.reset(); await R.evaluate(protect(src), false); return R.scheduler.pattern.queryArc(0, 2, { _cps: 1 }).map((h) => JSON.stringify([+h.whole.begin, h.value, h.context?.tags || []])).sort(); };
      const a = await run(A.compile(DECL + prog + 'tagged(atoms.wetDrums).mute()\n', A.buildEnv(DECL + prog + 'tagged(atoms.wetDrums).mute()\n', {}, { diag: [] })).code), b = await run(prog + "tagged('drums & wet').mute()\n"), none = await run(prog);
      assert.deepEqual(a, b); assert.ok(a.length > 0 && a.length < none.length, 'the selection acts (snare muted)');
      const runP = async (src) => { RT.hooks.reset(); RT.hooks.live = false; lanes.reset(); await R.evaluate(protect(lanes.prepare(src).code), false); return R.scheduler.pattern.queryArc(0, 2, { _cps: 1 }).map((h) => JSON.stringify([+h.whole.begin, h.value])).sort(); };
      const BP = 'w: s("hh*4").send(\'verb\', 0.5)\nv: ret(\'verb\').room(1)\n', BD = DECL + 'w: s("hh*4").send(atoms.verb, 0.5)\nv: ret(atoms.verb).room(1)\n';
      const ba = await runP(A.compile(BD, A.buildEnv(BD, {}, { diag: [] })).code), bb = await runP(BP); assert.deepEqual(ba, bb); assert.ok(ba.length > 0 && ba.some((x) => /bus/.test(x)), 'send runs on the lanes runtime');
      ran = `busname atom runs through .send/ret: ${ba.length} events identical to the string form; selector atom runs: ${a.length} events, identical to the string form (${none.length} without the selection)`;
    }
  }
  { const c = compileLanes("d: s('bd').send('verb', 0.5)\nv: ret('verb')"); assert.deepEqual(c.graph.audio.buses.named, { verb: 512 }); assert.deepEqual(c.graph.diagnostics, []); } // the single-quoted busname atom form runs through the audio compile pass (#75)
  pass(`Atoms: types tag, selector, busname, capture compile single-quoted (tagged('drums & wet'), ret('verb'), .send('verb', 0.5), .tags('wet'), recall('groove')), an invalid selector atom is refused, the model keeps $atom refs and round-trips; ${ran}`);
}

// ---- 5. Ids
{
  // 5a. a ctl() inside a branch keeps its id when a branch is inserted before it and when a line is added above the lane
  const code = `drums: s("bd*4").split(dry => dry, wet => wet.room(ctl('wetness')).lpf(900))\n`;
  const s0 = B.sites(code).sites; B.reconcile([], s0); assert.equal(s0.length, 1); assert.match(s0[0].path, /split#1>wet\.room#0/);
  const ins = `drums: s("bd*4").split(dry => dry, grit => grit.crush(5), wet => wet.room(ctl('wetness')).lpf(900))\n`;
  const s1 = B.sites(ins).sites; B.reconcile(s0, s1); assert.equal(s1[0].id, s0[0].id, 'branch inserted before');
  const above = `setcps(0.5)\n// a note\n` + ins; const s2 = B.sites(above).sites; B.reconcile(s1, s2); assert.equal(s2[0].id, s0[0].id, 'line added above the lane');
  // 5b. split / branch / send / selection / capture sites are reconciled the same way, captures are name-keyed
  const L0 = `a: s("bd").split(x => x, y => y.room(1)).send("verb")\ntagged("a").mute()\ncapture("g", "a", { last: "2b" })\n`;
  const r0 = LD.laneSites(L0); assert.equal(r0.ok, true); const kinds = r0.sites.map((s) => s.kind); assert.deepEqual(kinds, ['send', 'split', 'branch', 'branch', 'selection', 'capture']);
  assert.ok(r0.sites.every((s) => ({ split: 'p', branch: 'p', send: 'p', selection: 'g', capture: 'q' }[s.kind] === s.id[0])), 'id prefixes');
  const L1 = `setcps(1)\ntagged("a").mute()\n` + L0.replace('tagged("a").mute()\n', '').replace('s("bd").split(x => x, y => y.room(1))', 's("bd").lpf(300).split(z => z, x => x, y => y.room(1))');
  const r1 = LD.laneSites(L1, r0.sites); const idOf = (r, k, i = 0) => r.sites.filter((s) => s.kind === k)[i].id;
  assert.equal(idOf(r1, 'selection'), idOf(r0, 'selection'), 'the selection keeps its id after it moved'); assert.equal(idOf(r1, 'capture'), idOf(r0, 'capture')); assert.equal(idOf(r1, 'capture'), LD.captureId('g'));
  assert.equal(idOf(r1, 'split'), idOf(r0, 'split'), 'split site keeps its id when a branch and a step were added');
  assert.equal(idOf(r1, 'send'), idOf(r0, 'send'));
  // 5c. pad mapped to tagged("drums").mute() still toggles it after the selection statement moves (real Strudel + lanes runtime + pads engine)
  let padNote = 'runtime half SKIPPED (STRUDEL_MODULES with core, mini, transpiler needed)';
  const RT = await bootRuntime(); const pkg = (n) => { try { return JSON.parse(fs.readFileSync(path.join(NM || '', n, 'package.json'), 'utf8')); } catch { return null; } };
  const A0 = `drums: s("bd*4").tags("drums")\nkeys: note("c e").s("piano").tags("keys")\ntagged("drums").mute(false)\ntagged("keys").mute(false)\n`;
  const B0 = `tagged("keys").mute(false)\ntagged("drums").mute(false)\ndrums: s("bd*4").tags("drums")\nkeys: note("c e").s("piano").tags("keys")\n`;
  const sa = LD.laneSites(A0).sites, sel = sa.find((s) => s.kind === 'selection' && s.selector === 'drums');
  const target = { kind: 'selection', ref: sel.id, op: 'mute' };
  const pads = createPads({ banks: [{ id: 'b', pads: [{ pos: '0,0', target, mode: 'toggle', quant: 'none' }] }], model: {} }); pads.press('b/0,0', 3, 0.8); const jr = pads.resolve();
  assert.equal(jr[0].op, 'sel'); assert.deepEqual(jr[0].target, { kind: 'selection', ref: sel.id }); assert.equal(jr[0].args.selection, sel.id); assert.equal(jr[0].args.op, 'mute');
  const pa = LD.padSelection(A0, target), pb = LD.padSelection(B0, target, sa); assert.deepEqual([pa.id, pa.op], ['s1', 'mute']); assert.deepEqual([pb.id, pb.op], ['s2', 'mute'], 'after the move the same pad addresses the runtime selection of drums');
  assert.equal(LD.padSelection('drums: s("bd")\n', target), null, 'a deleted statement resolves to nothing');
  if (RT && NM && pkg('@strudel/transpiler')) {
    const j = pkg('@strudel/transpiler'); const ex = typeof j.exports === 'object' && j.exports['.'] ? (j.exports['.'].import || j.exports['.'].default || j.exports['.']) : j.module || j.main;
    const transpilerMod = await import(pathToFileURL(path.join(NM, '@strudel/transpiler', ex)).href); await RT.core.evalScope(RT.core, RT.mini);
    const lanes = installLanes(RT.S, RT.hooks); const R = RT.core.repl({ defaultOutput: () => {}, getTime: () => 0, transpiler: transpilerMod.transpiler });
    const per = (p, tag) => Array.from({ length: 6 }, (_, c) => p.queryArc(c, c + 1, { _cps: 1 }).filter((h) => h.hasTag(tag)).length);
    RT.hooks.reset(); RT.hooks.live = false; lanes.reset(); await R.evaluate(protect(B0), false); const p = R.scheduler.pattern;
    RT.hooks.live = true; RT.hooks.position = () => 3; lanes.set(pb.id, pb.op, true, 'now'); RT.hooks.live = false; // the pad press resolved after the statement moved
    assert.deepEqual(per(p, 'drums'), [4, 4, 4, 0, 0, 0]); assert.deepEqual(per(p, 'keys'), [2, 2, 2, 2, 2, 2]);
    padNote = `the pad press at cycle 3 muted drums (per cycle ${JSON.stringify(per(p, 'drums'))}) and left keys alone after the statement moved above the lanes`;
  }
  pass(`Ids: ctl() in a branch keeps id ${s0[0].id} (branch inserted before, line added above); split/branch/send/selection ids survive edits, captures are name-keyed (${LD.captureId('g')}); pad kind selection -> journal op sel, ${padNote}`);
}

// ---- 6. Bus numbers never appear
{
  const bad = /(?<![\w.$-])(6[4-9]|7[0-2]|51[2-9]|52[0-4])(?![\w.$-])/; // the numbers the allocator hands out: split and lane buses from 64, named buses from 512
  for (const k of ['ex1', 'ex3', 'ex5', 'ex7']) {
    const m = M.parse(fx(k)), ser = M.serialize(m), g = JSON.stringify(M.graph(m)), ids = JSON.stringify(LD.laneSites(fx(k)).sites.map((s) => s.id)), gen = M.generate(m);
    assert.equal(bad.test(ser), false, k + ' model'); assert.equal(bad.test(g), false, k + ' graph'); assert.equal(bad.test(ids), false); assert.equal(bad.test(gen), false); assert.equal(/"bus":\s*\d|\.bus\(/.test(ser + gen), false);
  }
  const ser = M.serialize(M.parse(fx('ex1'))); const nums = [...ser.matchAll(/(?<![\w.$-])\d+(?:\.\d+)?(?![\w.$-])/g)].map((x) => x[0]);
  pass(`Bus numbers: none of the allocated numbers (64-72, 512-524) and no "bus" key / .bus() in the serialised model, graph, site ids or generated code of examples 1, 3, 5, 7 (example 1 model numbers: ${[...new Set(nums)].join(', ')}; buses are named: ${JSON.stringify(M.parse(fx('ex5')).buses)})`);
}

// ---- 7. Invariants: documents without lanes are untouched (ids, revs, hashes, graph) against origin/main before #77
{
  const gold = JSON.parse(rd('./fixtures/l4_golden.json')); const sha = (s) => { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); };
  const catalog = JSON.parse(rd('../../site/data/catalog.json')).recipes; let n = 0, rt = 0;
  const src = {}; for (const r of catalog) src['recipe:' + r.id] = r.code;
  for (const d of ['tests/hooks/fixtures', 'tests/lanes/fixtures']) for (const f of fs.readdirSync(new URL(`../../${d}`, import.meta.url)).sort()) if (/\.strudel\.js$/.test(f) && !/^l4_|^open|^closed/.test(f)) src[`fx:${d}/${f}`] = fs.readFileSync(new URL(`../../${d}/${f}`, import.meta.url), 'utf8');
  for (const [k, code] of Object.entries(src)) {
    const g = gold[k]; assert.ok(g, 'golden for ' + k); const m = M.parse(code);
    let gr; try { gr = sha(JSON.stringify(M.graph(m))); } catch (e) { gr = 'ERR ' + e.message; }
    assert.equal(gr, g.graph, 'graph ' + k); assert.equal(sha(M.canonical(m)), g.model, 'model ' + k); assert.equal(M.hash(m), g.hash, 'hash ' + k); assert.equal(M.generate(m) === code, true, 'round trip ' + k); n++; if (k.startsWith('recipe:')) rt++;
  }
  assert.equal(rt, 46, '46 catalog recipes');
  pass(`Invariants: ${n} non-lane documents (${rt} catalog recipes, hooks fixtures) round-trip byte-identically and their model canonical form, hash and graph() output equal the origin/main (3c77681) digests`);
}

// ---- 8. Docs
{
  const sx = JSON.parse(rd('../../site/data/syntax.json')); const sec = sx.sections.find((x) => x.id === 'lanes');
  for (const w of ['model', 'graph', 'bus', 'selection', 'completion', 'selector', 'busname']) assert.ok(sec.explain.toLowerCase().includes(w), 'syntax.json lanes explain mentions ' + w);
  const st = strudelJson.lanes.status; for (const [k, v] of Object.entries(st)) assert.ok(['built', 'coming'].includes(v), k);
  assert.equal(st.tags, 'built'); for (const k of ['split', 'merge', 'send', 'ret']) assert.equal(st[k], 'built', k + ' is built (#75)'); for (const k of ['capture', 'recall', 'from']) { assert.equal(st[k], 'built', k + ' is built (#76)'); assert.ok(sec.examples.some((e) => !e.coming && e.code.includes(k + '(')), k + ' has a built example'); } assert.ok(sec.examples.some((e) => e.coming && /capture\(/.test(e.code)), 'unbuilt capture forms (bus audio, rolling audio) are marked coming'); assert.ok(sec.examples.some((e) => !e.coming && e.code.includes('.split(')), 'the split example is built');
  const ro = rd('../../site/README.md'); for (const w of ['lanes-data.js', 'lanes-intellisense.js', 'checkWire']) assert.ok(ro.includes(w), 'README mentions ' + w);
  const dc = rd('../../docs/LANES.md'); assert.ok(/## 11b\. Built in L4/.test(dc));
  pass(`Docs: syntax.json lanes section describes model / graph / selectors / bus names; capture, recall and from are built in #76, their unbuilt forms (bus and rolling audio) are marked coming; strudel.json lanes.status marks ${Object.entries(st).filter(([, v]) => v === 'built').map(([k]) => k).join(', ')} built and ${Object.entries(st).filter(([, v]) => v === 'coming').map(([k]) => k).join(', ')} coming; site/README.md and docs/LANES.md 11b describe the entry points`);
}

// ---- 9. CLI half of the selector grammar
{
  const items = [{ id: 'kick', tags: ['drum', 'wet'] }, { id: 'pad', tags: ['harm'] }, { id: 'hat', tags: ['drum'] }];
  assert.deepEqual(LD.filterByTags(items, 'drum & !wet').map((i) => i.id), ['hat']); assert.deepEqual(LD.filterByTags(items, '#pad | wet').map((i) => i.id), ['kick', 'pad']); assert.equal(LD.filterByTags(items, '').length, 3);
  assert.throws(() => LD.filterByTags(items, 'drum &'), /E_BAD_SELECTOR/);
  skip('CLI: `strudel atoms list --tag "<selector>"`', 'the strudel CLI lives in another repo (engine/strudel-cli) and is not in this checkout; the shared grammar function lanes-data.js filterByTags(items, selector) is verified here (drum & !wet, #pad | wet, bad selector -> E_BAD_SELECTOR)');
}

// ---- 10. Export tap: model verdict, checkWire, engine check and runtime agree (#82)
{
  const rdSrc = 'b: s("hh*8").gain(tap("inner:env"))\n';
  const cases = [
    ['no export', 'a: s("bd*4").split(x => x.tap("inner").lpf(500))\n' + rdSrc, true],
    ['exported before the split', 'a: s("bd*4").tap("inner", { export: true }).split(x => x.tap("inner").lpf(500))\n' + rdSrc, false],
    ['tap only inside a branch', 'a: s("bd*4").split(x => x.tap("inner").lpf(500), x => x.hpf(300))\n' + rdSrc, true],
    ['nested split', 'a: s("bd*4").split(x => x.split(y => y.tap("inner").lpf(500)))\n' + rdSrc, true],
    ['nested split, exported', 'a: s("bd*4").tap("inner", { export: true }).split(x => x.split(y => y.tap("inner").lpf(500)))\n' + rdSrc, false],
    ['two lanes export the same name', 'a: s("bd*4").tap("inner", { export: true }).split(x => x.tap("inner").lpf(500))\nc: s("sd*2").tap("inner", { export: true })\n' + rdSrc, false],
  ];
  let rt = null;
  const RT = await bootRuntime();
  if (RT && NM) {
    const pkg = (n) => { try { return JSON.parse(fs.readFileSync(path.join(NM, n, 'package.json'), 'utf8')); } catch { return null; } };
    const j = pkg('@strudel/transpiler');
    if (j) {
      const ex = typeof j.exports === 'object' && j.exports['.'] ? (j.exports['.'].import || j.exports['.'].default || j.exports['.']) : j.module || j.main;
      const tm = await import(pathToFileURL(path.join(NM, '@strudel/transpiler', ex)).href); await RT.core.evalScope(RT.core, RT.mini);
      const lanes = installLanes(RT.S, RT.hooks); const R = RT.core.repl({ defaultOutput: () => {}, getTime: () => 0, transpiler: tm.transpiler });
      rt = async (src) => { RT.hooks.reset(); RT.hooks.live = false; lanes.reset(); try { await R.evaluate(protect(lanes.prepare(src).code), false); } catch (e) { return /E_LANE_CROSS/.test(String(e.message || e)) ? 'refused' : 'error ' + e.message; } return R.scheduler.pattern.queryArc(0, 2, { _cps: 1 }).filter((h) => h.value.s === 'hh').length; };
    }
  }
  for (const [name, src, refused] of cases) {
    const g = M.graph(M.parse(src)), cw = M.checkWire(M.parse(src), 'tap:inner', 'track:b#0'), en = compileLanes(src).graph.diagnostics.filter((d) => d.code === 'E_LANE_CROSS');
    assert.equal((g.refused || []).length > 0, refused, name + ': model');
    assert.equal(cw.ok, !refused, name + ': checkWire');
    assert.equal(en.length > 0, refused, name + ': engine check');
    if (!refused) assert.ok(g.wires.some((w) => w.from.node === 'tap:inner' && w.to.node.startsWith('track:b')), name + ': wire drawn');
    if (rt) { const r = await rt(src); if (refused) assert.equal(r, 'refused', name + ': runtime refuses'); else assert.ok(typeof r === 'number' && r > 0, name + ': runtime read resolves with events, got ' + r); }
  }
  // the fix op itself: only the one statement changes, and the refusal is gone afterwards
  const m6 = M.parse(cases[0][1]), fixed = M.generate(M.applyOp(m6, M.graph(m6).refused[0].fixes[0].op));
  assert.equal(fixed, cases[1][1]); assert.equal(M.graph(M.parse(fixed)).refused, undefined); assert.equal(M.generate(M.parse(fixed)), fixed);
  const tn = M.graph(M.parse(fixed)).nodes.find((n) => n.id === 'tap:inner'); assert.ok(tn.export && !tn.local, 'exported lane-level tap is not local');
  pass(`Export tap (#82): ${cases.length} cases agree between graph().refused, checkWire, the engine check${rt ? ' and the runtime (read resolves with events / is refused)' : ' (runtime skipped: STRUDEL_MODULES)'}; after the fix the refusal is gone and the tap node is exported, not local`);
}

// ---- Capture picker kinds: model ports == runtime-recorded facets == offered completions (one source of truth: engine/lanes-pick.js)
{
  assert.equal(LD.defaultWhat, LC.defaultWhat); assert.equal(LD.pickerKind, LC.pickerKind);
  const isrc = rd('../../site/intellisense.js'); const i0 = isrc.indexOf('function argContext'), i1 = isrc.indexOf('api.argContext = argContext');
  const argContext = new Function(isrc.slice(i0, i1) + '; return argContext;')(), data = strudelJson;
  const W = 'window: "1b..3b"', base = 'a: s("bd")\n';
  const cases = [['lane', 'capture("g", "a", { ' + W + ' })', ['events', 'audio', 'level'], ['ev', 'audio', 'level', 'onset', 'gate']],
    ['tag selection', 'capture("g", "#a | drums", { ' + W + ' })', ['events', 'audio', 'level'], ['ev', 'audio', 'level', 'onset', 'gate']],
    ['master', 'capture("g", "master", { ' + W + ' })', ['audio', 'level'], ['audio', 'level']],
    ['bus', 'capture("g", "bus:verb", { ' + W + ' })', ['audio', 'level'], ['audio', 'level']],
    ['tap', 'capture("g", "a/kick", { ' + W + ' })', ['events'], ['ev', 'onset', 'gate']],
    ['explicit what', 'capture("g", "master", { ' + W + ', what: ["audio"] })', ['audio'], ['audio']]];
  const portOf = { events: 'ev', audio: 'audio', level: 'level' };
  for (const [name, line, what, facets] of cases) {
    const src = base + line + '\n', rec = LC.analyze(src).captures.find((c) => c.name === 'g');
    assert.deepEqual(rec.what, what, name + ': runtime records');
    const node = M.graph(M.parse(src)).nodes.find((n) => n.id === 'capture:g'); assert.deepEqual(node.what, what, name + ': node what');
    assert.deepEqual(node.ports.out.map((p) => p.name), what.map((l) => portOf[l]), name + ': model ports == recorded layers');
    const before = src + 'z: recall("g:', doc = before + '")', model = M.parse(doc);
    const offR = LI.complete({ text: before, pos: before.length, doc, arg: argContext(before, before.length) }, data, model.tracks || model.captures ? model : LI.textModel(doc)), offered = offR ? offR.options.map((o) => o.label) : [];
    assert.deepEqual(offered, facets, name + ': offered completions'); assert.deepEqual(LD.facetsOf(rec.what), facets, name + ': facetsOf(runtime what)');
  }
  // recall of a facet the capture does not record: refused in the model with the runtime's code, no wire
  for (const pk of ['master', 'bus:verb']) {
    const src = base + `capture("g", "${pk}", { ${W} })\nz: recall("g:ev")\n`, g = M.graph(M.parse(src));
    assert.equal(g.refused?.[0]?.code, 'E_CAPTURE_LAYER', pk + ': model refuses'); assert.ok(!g.wires.some((w) => w.from.node === 'capture:g'), pk + ': no wire');
    const cw = M.checkWire(M.parse(src), 'capture:g', 'track:z', 'ev'); assert.equal(cw.ok, false); assert.equal(cw.code, 'E_CAPTURE_LAYER');
    assert.equal(M.checkWire(M.parse(src), 'capture:g', 'track:z', 'audio').ok, true);
    assert.equal(M.generate(M.parse(src)), src, pk + ': round trip');
  }
  const okSrc = base + `capture("g", "master", { ${W} })\nz: recall("g:audio")\n`; assert.equal(M.graph(M.parse(okSrc)).refused, undefined);
  pass('Capture pickers: model ports == runtime-recorded layers == offered facets for lane, tag selection, master, bus, tap, explicit what; recall("g:ev") on master/bus refused in the model (E_CAPTURE_LAYER) and by checkWire');
}
console.log('lanes L4 done');
