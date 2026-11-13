// Atoms A2 (#62): migration - extract, parse, inline, catalog atoms. Run: STRUDEL_MODULES=<dir with @strudel/> node tests/atoms/a2.mjs
// One minimal check per acceptance box. Boxes that need the `strudel` CLI (another repo) print SKIP with the missing piece.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as acorn from '../../site/vendor/acorn-8.19.0.mjs';
import * as A from '../../site/engine/atoms.js';
import * as M from '../../site/engine/atoms-migrate.js';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';

const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
A.loadTypes(rd('../../site/data/atoms/types.json'));
const positions = JSON.parse(rd('../../site/data/atoms/positions.json'));
const catalog = JSON.parse(rd('../../site/data/catalog.json'));
const RT = await bootRuntime();
if (!RT) { skip('A2 (all boxes need parsers)', '@strudel/core/@strudel/mini not installed (set STRUDEL_MODULES=<dir with @strudel/>)'); process.exit(0); }
const SOUNDS = Array.from({ length: 5000 }, (_, i) => `snd${i}`).concat(['bd', 'sd', 'hh', 'oh', 'cp']);
A.configure({ positions, mini: RT.S.mini, parsers: RT.hooks.parsers, catalog: { snd: new Set(SOUNDS), bank: ['RolandTR909', 'RolandTR808'], scale: ['minor', 'major', 'minor:pentatonic'], chord: ['m7', 'maj7', '7'] } });
const CLI = spawnSync('strudel', ['--version'], { encoding: 'utf8' });
const hasCli = !CLI.error && CLI.status === 0;
const NO_CLI = '`strudel` CLI not available in this checkout (engine/strudel-cli lives in another repo)';
const strings = (code) => { const out = []; const w = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(w); if (n.type === 'Literal' && typeof n.value === 'string') out.push(n.value); Object.values(n).forEach(w); }; w(acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true })); return out.sort(); };
const ecode = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
let boxes = 0; const box = (m) => { boxes++; pass(m); };

const BEFORE = `$: s("bd*4").bank("RolandTR909").tap("kick")
$: note("c2*8").s("sawtooth").wire("gain", "kick:env", { range: [1, 0.3], op: "mul" })
hooks.bind("fx", "murk", "<17b"); hooks.bind("fx", "open", "@17b")
`;
const NAMES = { 'point:17b': 'drop' }; // names are suggestions: nothing in the program says "drop", so the caller supplies it
const ex = M.extract(BEFORE, { names: NAMES });

// Box: example 1
{
  assert.deepEqual(ex.atoms.map((a) => a.name).sort(), ['drop', 'fx', 'kick', 'kickEnv']);
  assert.ok(ex.code.includes('atom("kickEnv", { type: "tapref", from: atoms.kick.facet("env") })'));
  assert.ok(ex.code.includes('.tap(atoms.kick)') && ex.code.includes('.wire("gain", atoms.kickEnv,') && ex.code.includes('hooks.bind(atoms.fx, "murk", atoms.drop.before()); hooks.bind(atoms.fx, "open", atoms.drop.after())'));
  assert.ok(ex.code.includes('s("bd*4").bank("RolandTR909")') && ex.code.includes('note("c2*8")'));
  assert.equal(A.compile(ex.code, null).code, BEFORE.replace(/"(kick|kick:env|fx|<17b|@17b)"/g, "'$1'")); // string-typed atoms compile single-quoted (ATOMS 2.2)
  box('Example: ATOMS section 13 example 1 extracts to declarations kick, kickEnv, fx, drop with references at every use; single-use "bd*4", "RolandTR909", "c2*8", "murk", "open" stay strings; compile(extract) equals the before program with the string-typed names single-quoted');
}

// Box: equivalence over the catalog
{
  const recipes = catalog.recipes.map((r) => r.code).filter(Boolean);
  const mini = (code) => strings(code).filter((v) => { try { RT.S.mini(v); return /[a-zA-Z0-9]/.test(v); } catch { return false; } });
  const hapsOf = (v) => RT.S.mini(v).queryArc(0, 8, { _cps: 1 }).map((h) => ({ b: +h.whole.begin, e: +h.whole.end, v: h.value }));
  let identical = 0, changed = 0, fail = 0, refused = 0, events = 0;
  for (const c of recipes) {
    const r = M.extract(c);
    if (r.report.selfCheck === 'refused') refused++;
    if (r.code === c) { identical++; continue; }
    changed++;
    const back = A.compile(r.code, null).code;
    if (JSON.stringify(strings(back)) !== JSON.stringify(strings(c))) { fail++; continue; }
    const a = mini(back).map(hapsOf), b = mini(c).map(hapsOf);           // the patterns of both programs, queried over 8 cycles
    if (JSON.stringify(a) !== JSON.stringify(b)) fail++; else events += a.flat().length;
  }
  assert.equal(fail, 0);
  const msg = `Equivalence over the catalog: ${recipes.length} recipes, ${identical} byte-identical (nothing to extract), ${changed} extracted and inlined back to the same program (same string literals; ${events} queried haps over 8 cycles deep-equal through unmodified @strudel/mini), ${refused} refused, ${fail} failures`;
  if (!hasCli) skip(msg + ' (evidence only: the box asks for `strudel events` deep-equality)', NO_CLI); else box(msg);
}

// Box: idempotent
{
  let n = 0;
  for (const c of [BEFORE, ...catalog.recipes.map((r) => r.code).filter(Boolean)]) { const a = M.extract(c, { names: NAMES }).code, b = M.extract(a, { names: NAMES }).code; assert.equal(b, a); n++; }
  box(`Idempotent: extract(extract(code).code).code equals extract(code).code for ${n} programs`);
}

// Box: naming
{
  const again = M.extract(BEFORE, { names: NAMES });
  assert.deepEqual(again.atoms.map((a) => [a.id, a.name]), ex.atoms.map((a) => [a.id, a.name]));
  const clash = M.extract(`$: s("bd sd")\n$: s("bd sd")\n$: s("bd sd:1")\n$: s("bd sd:1")\n`);
  const nm = clash.atoms.map((a) => a.name); assert.equal(new Set(nm).size, 2); assert.ok(nm.includes('bdSd2') && nm.some((x) => /^bdSd2\d+$/.test(x)));
  box(`Naming: two runs give identical names and ids (${ex.atoms.map((a) => a.name + '=' + a.id).join(', ')}); a clash gets a numeric suffix (${nm.join(', ')})`);
}

// Box: min-uses and params
{
  const two = `$: s("bd*4 sd")\n$: s("bd*4 sd")\n`;
  assert.equal(M.extract(two, { minUses: 3 }).code, two); assert.equal(M.extract(two).atoms.length, 1);
  const p = `$: s("bd*4")\n$: s("bd*8")\n`;
  const off = M.extract(p); assert.equal(off.code, p); assert.deepEqual(off.report.candidates.map((c) => [c.body, c.values]), [['bd*${n}', [4, 8]]]);
  const on = M.extract(p, { params: true });
  assert.equal(on.atoms.length, 1); assert.deepEqual(Object.keys(on.atoms[0].params), ['n']);
  assert.ok(/s\(atoms\.\w+\(\{ n: 4 \}\)\)/.test(on.code) && /s\(atoms\.\w+\(\{ n: 8 \}\)\)/.test(on.code));
  assert.equal(A.compile(on.code, null).code, p);
  box('--min-uses 3 leaves a twice-used mini string alone; --params unifies "bd*4" + "bd*8" into one atom with param n and two applied references (compiles back identically); without --params the report lists that candidate');
}

// Box: parse and reuse
{
  const src = `atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*\${n}" })\n$: s(atoms.kick4)\n`;
  const env = A.buildEnv(src);
  const hit = M.parse('mini', 'bd*8', env); assert.equal(hit.atom.name, 'kick4'); assert.deepEqual(hit.args, { n: 8 });
  assert.equal(M.parse('mini', 'hh*3', env), null);
  const next = ex.code + `$: s("x").gain(tap("kick:env"))\n`;
  const r2 = M.extract(next, { names: NAMES });
  assert.ok(r2.code.includes('tap(atoms.kickEnv)')); assert.equal((r2.code.match(/^atom\(/gm) || []).length, 4); assert.equal(r2.atoms.length, 0);
  box('parse("mini", "bd*8", env) returns { atom: kick4, args: { n: 8 } }, "hh*3" returns null; a second extract with a new "kick:env" literal reuses kickEnv and declares nothing new (4 declarations before and after)');
}

// Box: catalog atoms
{
  const code = `$: s(atoms.snd.bd).bank(atoms.bank.RolandTR909)\n$: s(atoms.snd.bd.n(3))\n`;
  const r = A.compile(code, null); assert.equal(r.code, `$: s("bd").bank("RolandTR909")\n$: s("bd:3")\n`);
  const env = A.buildEnv(code); assert.equal(env.byName.size, 0);
  const l = M.list(code); assert.deepEqual(l.map((x) => x.name).sort(), ['bank.RolandTR909', 'snd.bd']); assert.ok(l.length < SOUNDS.length);
  const unk = A.compile(`$: s(atoms.snd.nope)\n`, null); assert.equal(unk.code, `$: s("nope")\n`); assert.deepEqual(unk.warnings.map((w) => w.code), ['W_ATOM_UNKNOWN_SOUND']);
  const cx = M.extract(`$: s("bd").bank("RolandTR909")\n`, { catalog: true }); assert.equal(cx.code, `$: s(atoms.snd.bd).bank(atoms.bank.RolandTR909)\n`); assert.equal(cx.atoms.length, 0);
  assert.equal(M.extract(`$: s("bd").bank("RolandTR909")\n`).code, `$: s("bd").bank("RolandTR909")\n`);
  box(`Catalog: atoms.snd.bd compiles to "bd" with no declaration; with ${SOUNDS.length} catalog sounds loaded the environment holds ${env.byName.size} atoms and list shows only the ${l.length} referenced; atoms.snd.nope gives W_ATOM_UNKNOWN_SOUND, not an error; --catalog turns s("bd") into atoms.snd.bd, default leaves it`);
}

// Box: nothing added
{
  const fixtures = [BEFORE, `$: s("bd*4 sd")\n$: s("bd*4 sd")\n.gain("0.5")`, ...catalog.recipes.map((r) => r.code).filter(Boolean)];
  let n = 0;
  for (const c of fixtures) { const r = M.extract(c, { names: NAMES, params: true }); assert.deepEqual(strings(M.inline(r.code)), strings(c)); n += strings(c).length; }
  box(`Nothing added: the multiset of string literal values in inline(extract(code).code) equals that of code for ${fixtures.length} fixtures (${n} string literals compared)`);
}

// Box: self-check refusal
{
  const bad = `$: note("c3").s("saw").ns("c3")\n$: note("c3").ns("c3")\n`;
  const r = M.extract(bad); assert.equal(r.code, bad); assert.equal(r.report.refused.length, 1);
  assert.match(r.report.refused[0].why, /pattern string.*plain string/);
  box(`Refusal: "c3" used as a note pattern and as a name string is not rewritten; report says: ${r.report.refused[0].why.slice(0, 90)}...`);
}

// CLI
if (!hasCli) skip('CLI: strudel atoms extract IN [--write] [--min-uses N] [--params] [--catalog] [--text] [--report R.json]', NO_CLI);
// Box: inline (site)
note();
function note() { console.log('NOTE inline: see tests/site/atoms_inline.mjs (Playwright, strudel.cc link decode)'); }
console.log(`\n${boxes} boxes checked.`);
