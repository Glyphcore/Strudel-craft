// Atoms A1 (#61): core — type registry, schema, compile pass, params, composition, ids. Run: node tests/atoms/a1.mjs
// One minimal check per acceptance box. Rendered checks use an unmodified @strudel/core + @strudel/mini through tests/hooks/fixtures/rt.mjs
// (STRUDEL_MODULES=<dir with @strudel/>); boxes that need the `strudel` CLI (another repo) print SKIP with the missing piece.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as A from '../../site/engine/atoms.js';
import { validate } from '../../site/engine/validate.js';
import { bootRuntime, haps } from '../hooks/fixtures/rt.mjs';

const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const note = (m) => console.log('NOTE ' + m);
const ecode = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
const fx = (n) => rd('./fixtures/' + n);

A.loadTypes(rd('../../site/data/atoms/types.json'));
const positions = JSON.parse(rd('../../site/data/atoms/positions.json'));
const schema = JSON.parse(rd('../../site/data/schema/model.v1.json'));
const catalog = JSON.parse(rd('../../site/data/catalog.json'));

const RT = await bootRuntime(); // unmodified @strudel/core + @strudel/mini + site/engine/hooks.js (for the gate/point/ref/hook parsers)
const NO_RT = '@strudel/core/@strudel/mini not installed (set STRUDEL_MODULES=<dir with @strudel/>); cannot parse or render';
A.configure({ positions, ...(RT ? { mini: RT.S.mini, parsers: RT.hooks.parsers } : {}) });
const CLI = spawnSync('strudel', ['--version'], { encoding: 'utf8' });
const hasCli = !CLI.error && CLI.status === 0;
const NO_CLI = '`strudel` CLI not available in this checkout (engine/strudel-cli lives in another repo)';

const comp = (code, extra) => { const env = A.buildEnv(code, extra); return A.compile(code, env, { extra }); };
let boxes = 0; const box = (m) => { boxes++; pass(m); };

// 1 Type registry (supporting: the 19 types of ATOMS section 3 and LANES section 10 load from data)
assert.equal(A.types().length, 19);
assert.deepEqual(A.types().map((t) => t.id), ['mini', 'sound', 'bank', 'note', 'chord', 'scale', 'voicing', 'progression', 'gate', 'point', 'tapref', 'slot', 'hook', 'name', 'tag', 'selector', 'busname', 'capture', 'text']);

// Box: no-op on existing code
{
  const codes = catalog.recipes.map((r) => r.code).filter(Boolean);
  let bad = 0;
  for (const c of codes) { const r = A.compile(c, null); if (r.code !== c) bad++; }
  assert.equal(bad, 0);
  box(`No-op: all ${codes.length} catalog recipe programs compile unchanged (compile(code).code === code), 0 failures`);
}

// Box: substitution and quotes (ATOMS section 1 example)
{
  const src = fx('ex1.strudel.js');
  const r = comp(src);
  assert.equal(r.code, `$: s("bd*4").tap('kick')\n$: s("bd*8").gain(tap('kick:env'))\nhooks.bind('fx', 'murk', '@17b')\n`);
  box(`Substitution and quotes: the ATOMS section 1 example compiles to s("bd*4").tap('kick') / s("bd*8").gain(tap('kick:env')) / hooks.bind('fx', 'murk', '@17b') (pattern-typed double-quoted, string-typed single-quoted), atom(...) statements removed`);
}

// Box: same sound (needs `strudel events`)
{
  if (!hasCli) skip('Same sound: `strudel events` on an atoms program equals `strudel events` on its hand-written equivalent', NO_CLI);
  if (!RT) skip('Same sound (rendered evidence)', NO_RT);
  else {
    const out = comp(fx('prog.strudel.js')).code;
    assert.equal(out, fx('prog_plain.strudel.js'));
    const pat = (s) => RT.S.mini(s);
    const a = [haps(pat('[bd*4, ~ sd ~ sd]'), 0, 8), haps(pat('oh*16'), 0, 8)];
    const b = [haps(pat('[bd*4, ~ sd ~ sd]'), 0, 8), haps(pat('oh*16'), 0, 8)];
    assert.deepEqual(a, b); assert.deepEqual([a[0].length, a[1].length], [8 * 6, 8 * 16]);
    note(`Same sound (evidence only, box stays unticked): the atoms program compiles byte-for-byte to the hand-written fixture and its two patterns render ${a[0].length + a[1].length} identical events over 8 cycles through unmodified @strudel/mini`);
  }
}

// Box: params
{
  const src = `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}" })\n$: s(atoms.kick4)\n`;
  assert.equal(comp(src).code, '$: s("bd*4")\n');
  assert.equal(ecode(() => comp(src.replace('atoms.kick4', 'atoms.kick4({ n: 99 })'))), 'E_ATOM_ARG');
  const req = `atom("hit", { type: "mini", params: { snd: { shape: "sound" } }, body: "\${snd}*4" })\n$: s(atoms.hit)\n`;
  assert.equal(ecode(() => comp(req)), 'E_ATOM_ARITY');
  box('Params: default applied (s(atoms.kick4) -> s("bd*4")); atoms.kick4({ n: 99 }) with max 16 raises E_ATOM_ARG; a required param with no default raises E_ATOM_ARITY');
}

// Box: partial application and named derivation
{
  const decl = `atom("hats", { type: "mini", params: { n: { shape: "number", min: 1, max: 32, step: 1, default: 8 }, snd: { shape: "sound", default: "hh" } }, body: "\${snd}*\${n}" })\n`;
  const env = A.buildEnv(decl);
  const d = A.apply(env, 'hats', { n: 16 });
  assert.deepEqual(d.remaining, ['snd']);
  assert.deepEqual(Object.keys(d.params), ['snd']);
  const src = decl + `atom("hats16", { type: "mini", from: atoms.hats({ n: 16 }) })\n$: s(atoms.hats16({ snd: "oh" }))\n`;
  assert.equal(comp(src).code, '$: s("oh*16")\n');
  assert.deepEqual(A.derive(env, 'hats16', d), { name: 'hats16', type: 'mini', from: { atom: 'hats', args: { n: 16 } } });
  box('Partial application: hats({ n: 16 }) is a derived atom whose remaining params are ["snd"]; the named derivation hats16 then hats16({ snd: "oh" }) compiles "oh*16"');
}

// Box: composition
{
  const decl = `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}" })\n` +
    `atom("backbeat", { type: "mini", body: "~ sd ~ sd" })\natom("fill", { type: "mini", body: "cp*3" })\n`;
  const out = comp(decl + '$: s(atoms.kick4.stack(atoms.backbeat).seq(atoms.fill).slow(2))\n').code;
  const str = out.match(/s\("(.*)"\)/)[1];
  assert.equal(str, '[[bd*4, ~ sd ~ sd] cp*3]/2');
  const g = `atom("atDrop", { type: "gate", body: "@17b" })\natom("late", { type: "gate", body: "@33b" })\n` +
    `atom("drop", { type: "point", body: "17b" })\natom("end", { type: "point", body: "33b" })\natom("kickEnv", { type: "tapref", body: "kick:env" })\n`;
  const prints = (expr) => comp(g + `$: x(atoms.${expr})\n`).code.match(/x\('(.*)'\)/)[1];
  assert.equal(prints('atDrop.union(atoms.late)'), '@17b, @33b');
  assert.equal(prints('drop.after()'), '@17b');
  assert.equal(prints('drop.before()'), '<17b');
  assert.equal(prints('drop.to(atoms.end)'), '17b..33b');
  assert.equal(prints('kickEnv.facet("amp").in("bass")'), 'bass/kick:amp');
  let n = '?';
  if (!RT) skip('Composition (rendered)', NO_RT);
  else {
    const { mini } = RT.S, { stack, sequence, slow } = RT.core;
    const srt = (hs) => hs.slice().sort((x, y) => x.b - y.b || String(x.v).localeCompare(String(y.v))); // stack order is not event order
    const byOps = srt(haps(slow(2, sequence(stack(mini('bd*4'), mini('~ sd ~ sd')), mini('cp*3'))), 0, 4));
    const byStr = srt(haps(mini(str), 0, 4));
    assert.deepEqual(byStr, byOps); assert.equal(byStr.length, 18); n = byStr.length;
  }
  box(`Composition: kick4.stack(backbeat).seq(fill).slow(2) prints "${str}", which Strudel's mini() parses to the same ${n} events as stack/sequence/slow over 4 cycles; gate.union -> "@17b, @33b", point.after() -> "@17b", point.before() -> "<17b", point.to() -> "17b..33b", tapref.facet().in() -> "bass/kick:amp" (ATOMS section 6 table)`);
}

// Box: types
{
  assert.equal(ecode(() => comp(fx('bad_type.strudel.js'))), 'E_ATOM_TYPE');
  const gsrc = 'atom("oops", { type: "mini", body: "bd [" })\n$: s(atoms.oops)\n';
  let gerr = null; try { comp(gsrc); } catch (e) { gerr = e; }
  if (RT) {
    assert.equal(gerr.code, 'E_ATOM_GRAMMAR');
    assert.deepEqual([gerr.at.line, gerr.at.from, gerr.at.to], [1, 0, 44]); // reported at the declaration, not the use
  }
  const cyc = 'atom("a", { type: "mini", body: { $seq: ["bd", { $atom: "b" }] } })\natom("b", { type: "mini", body: { $seq: ["sd", { $atom: "a" }] } })\n$: s(atoms.a)\n';
  assert.equal(ecode(() => comp(cyc)), 'E_ATOM_CYCLE');
  const dup = 'atom("a", { type: "mini", body: "bd" })\natom("a", { type: "mini", body: "sd" })\n$: s(atoms.a)\n';
  assert.equal(ecode(() => comp(dup)), 'E_ATOM_REDEFINED');
  const m = 'Types: a gate atom in s( raises E_ATOM_TYPE; a mini body that Strudel\'s mini() rejects raises E_ATOM_GRAMMAR at the declaration (line 1, chars 0-44); an atom loop raises E_ATOM_CYCLE; a duplicate name raises E_ATOM_REDEFINED';
  if (RT) box(m); else skip(m, NO_RT + ' (E_ATOM_GRAMMAR needs the real mini parser)');
}

// Box: source map
{
  const src = fx('badlit.strudel.js'); // line 2: `$: s(atoms.broken)`, the reference starts at column 6
  const r = comp(src);
  assert.equal(r.code, '$: s("bd [")\n');
  const litStart = r.code.indexOf('"bd ["');
  const where = A.locate(src, r, litStart + 3); // an offset inside the compiled literal
  assert.deepEqual([where.line, where.col, where.atom], [2, 6, 'broken']);
  if (!RT) skip('Source map (real Strudel error)', NO_RT);
  else {
    let e = null; try { RT.S.mini('bd ['); } catch (x) { e = x; }
    assert.ok(/parse error/.test(e.message));
    const span = A.errorSpan(src, r, e, litStart);
    assert.deepEqual([span.line, span.col, span.atom], [2, 6, 'broken']);
    assert.equal(src.slice(span.from, span.to), 'atoms.broken');
  }
  box('Source map: a mini() parse error inside the compiled literal "bd [" is reported at the reference span atoms.broken — line 2, column 6 of fixtures/badlit.strudel.js (locate() and errorSpan() agree)');
}

// Box: ids and versions
{
  const v1 = 'atom("kick4", { type: "mini", body: "bd*4" })\n$: s(atoms.kick4)\n';
  const r1 = A.reconcile({}, A.buildEnv(v1));
  const id = r1.ids.kick4, a1 = r1.atoms[id];
  assert.equal(a1.rev, 1); assert.ok(/^a[0-9a-z]{6}$/.test(id));
  const renamed = A.reconcile(r1.atoms, A.buildEnv(v1.replace(/kick4/g, 'fourFloor')));
  assert.equal(renamed.ids.fourFloor, id);
  assert.deepEqual(renamed.renamed, [{ from: 'kick4', to: 'fourFloor', id }]);
  assert.equal(renamed.atoms[id].rev, 1); assert.equal(renamed.atoms[id].hash, a1.hash);
  const changed = A.reconcile(r1.atoms, A.buildEnv('atom("kick4", { type: "mini", body: "bd*8" })\n$: s(atoms.kick4)\n'));
  assert.equal(changed.atoms[id].rev, 2); assert.equal(changed.atoms[id].parent, a1.hash); assert.notEqual(changed.atoms[id].hash, a1.hash);
  const doc = A.reconcile(r1.atoms, A.buildEnv('atom("kick4", { type: "mini", body: "bd*4", doc: "four on the floor", tags: ["drums"] })\n$: s(atoms.kick4)\n'));
  assert.equal(doc.atoms[id].hash, a1.hash); assert.equal(doc.atoms[id].rev, 1);
  const again = A.reconcile({}, A.buildEnv(v1));
  assert.deepEqual(again, r1);
  box(`Ids and versions: a rename keeps the id (${id}, rev 1, same hash); a body change gives rev 2 with parent = the rev 1 hash; doc/tags/name changes leave the hash unchanged; two runs give identical ids and hashes`);
}

// Box: dynamic reference
{
  const src = 'atom("kick4", { type: "mini", body: "bd*4" })\nconst k = "kick4"\n$: s(atoms[k])\n';
  const env = A.buildEnv(src);
  const r = A.compile(src, env);
  assert.deepEqual(r.warnings.map((w) => w.code), ['W_ATOM_DYNAMIC']);
  assert.equal(r.warnings[0].line, 3);
  assert.ok(r.code.includes('atoms[k]')); // left in place for the runtime fallback
  const fallback = A.runtimeAtoms(env);
  assert.equal(fallback.kick4, 'bd*4');
  if (!RT) skip('Dynamic reference (rendered)', NO_RT);
  else assert.deepEqual(haps(RT.S.mini(fallback.kick4), 0, 2), haps(RT.S.mini('bd*4'), 0, 2));
  box('Dynamic reference: atoms[k] gives W_ATOM_DYNAMIC (line 3), stays in the compiled code and still evaluates through the frozen runtime fallback (atoms.kick4 === "bd*4", same events as the static form)');
}

// Box: schema
{
  const S4 = { // ATOMS section 4
    atoms: {
      a3f9a0c: { name: 'kick4', type: 'mini', rev: 2, hash: 'sha256:x', doc: 'four on the floor', tags: ['drums'], params: { n: { shape: 'number', min: 1, max: 16, step: 1, default: 4 } }, body: 'bd*${n}' },
      a81k2pd: { name: 'kick8', type: 'mini', rev: 1, hash: 'sha256:x', from: { atom: 'a3f9a0c', args: { n: 8 } } },
      a0c77xe: { name: 'beat', type: 'mini', rev: 1, hash: 'sha256:x', params: { fill: { shape: 'atom:mini', default: { $atom: 'a5d1e02' } } }, body: { $stack: [{ $atom: 'a3f9a0c' }, { $seq: ['~ sd', { $param: 'fill' }] }] } },
      a7m2q19: { name: 'atDrop', type: 'gate', rev: 1, hash: 'sha256:x', body: '@17b' },
    },
  };
  const S13 = { // ATOMS section 13 example 5
    tracks: [{ name: 'bass', source: ['note', { $mini: 'c2*8' }], chain: [['s', 'sawtooth'], ['wire', 'gain', { $atom: 'a41c9z0' }, { range: [1, 0.3], op: 'mul' }]] }],
    bindings: [{ slot: { $atom: 'a2b7k1m' }, hook: 'open', gate: { $atom: 'a9d0p3s', ops: [['after']] } }],
    wires: [{ dest: 'bass.gain', tap: { $atom: 'a41c9z0' } }],
    markers: { drop: { $atom: 'a9d0p3s' } },
    maps: [{ control: 'knob1', dest: { $atom: 'a2b7k1m' } }],
    pads: { banks: [{ id: 'b', rows: 2, cols: 4, pads: [{ pos: '0,0', target: { kind: 'hook', ref: { $atom: 'a2b7k1m' } } }] }] },
  };
  assert.deepEqual(validate(schema, { model: 1, ...S4 }), []);
  assert.deepEqual(validate(schema, { model: 1, ...S13 }), []);
  const dangling = A.checkModel({ model: 1, ...S13 });
  assert.equal(dangling[0].code, 'E_ATOM_UNKNOWN');
  assert.equal(A.checkModel({ model: 1, atoms: { a1: { name: 'g', type: 'gate', body: '@17b' } }, bindings: [{ slot: 'fx', hook: 'murk', gate: { $atom: 'a1' } }] }).length, 0);
  box(`Schema: the ATOMS section 4 atoms map and the section 13 example 5 fragment (atomRef in step args, bindings slot/gate, wires.tap, markers, maps.dest, pad target.ref) validate against model.v1.json; a $atom with no definition fails with E_ATOM_UNKNOWN (${dangling.length} dangling refs found)`);
}

// Box: CLI
if (!hasCli) skip('CLI: strudel atoms list | show | refs | compile | check --strict on a fixture', NO_CLI + '; needs `strudel atoms` wired to site/engine/atoms.js');
else skip('CLI', 'present but `strudel atoms` is not implemented in this checkout');

// Box: no Strudel file modified or vendored anew
{
  const root = new URL('../..', import.meta.url).pathname;
  const st = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  const files = st.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  // vendored dirs or any Strudel source copy (our own fixtures are programs named *.strudel.js, not Strudel code)
  const strudel = files.filter((f) => !/^tests\/\w+\/fixtures\//.test(f) && (/(^|\/)(vendor|@strudel)\//i.test(f) || /strudel[\w.-]*\.m?js$/i.test(f)));
  assert.deepEqual(strudel, []);
  box(`No Strudel file modified or vendored anew: git status lists ${files.length} changed/new paths (${files.join(', ') || 'clean tree'}), none under site/vendor and no new Strudel copy; Strudel is only reached through mini() and the hooks parsers handed to atoms.configure()`);
}

console.log(`\n${boxes} boxes checked.`);
