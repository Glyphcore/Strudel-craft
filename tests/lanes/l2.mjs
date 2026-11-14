// Lanes L2 (#75): one minimal behavioural check per acceptance box that does not need the CLI. Run: STRUDEL_MODULES=<dir with @strudel/> node tests/lanes/l2.mjs
// Real unmodified @strudel/core + mini + transpiler with site/engine/hooks.js and lanes.js on top. Rendered audio is in tests/site/lanes.mjs (Playwright).
// Boxes that need the `strudel` CLI (another repo) print SKIP with the exact missing piece; nothing is stubbed to pass.
import { cliUnspecified } from '../hooks/fixtures/cli.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';
import { install as installLanes, check, compile, prepare, graphJSON } from '../../site/engine/lanes.js';
import { protect } from '../../site/engine/hooks.js';

const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const RT = await bootRuntime();
if (!RT) { skip('all lanes L2 boxes', '@strudel/core + @strudel/mini not installed (set STRUDEL_MODULES=<dir containing @strudel/>)'); process.exit(0); }
const { core, hooks, S } = RT; const NM = process.env.STRUDEL_MODULES;
const lanes = installLanes(S, hooks);
const pkg = (n) => { try { return JSON.parse(fs.readFileSync(path.join(NM, n, 'package.json'), 'utf8')); } catch { return null; } };
const loadPkg = async (n) => { const j = pkg(n); if (!j) return null; const ex = typeof j.exports === 'object' && j.exports['.'] ? (j.exports['.'].import || j.exports['.'].default || j.exports['.']) : j.module || j.main; return import(pathToFileURL(path.join(NM, n, ex)).href); };
const transpilerMod = NM ? await loadPkg('@strudel/transpiler') : null;
if (!transpilerMod) { skip('all lanes L2 boxes', '@strudel/transpiler not installed in STRUDEL_MODULES (needed for the repl and labels)'); process.exit(0); }
await core.evalScope(core, RT.mini);
const R = core.repl({ defaultOutput: () => {}, getTime: () => 0, transpiler: transpilerMod.transpiler });
const evalProgram = async (src, host) => { hooks.reset(); hooks.live = false; lanes.reset(); const c = lanes.prepare(src, host ? { host } : {}).code; await R.evaluate(protect(c), false); return R.scheduler.pattern; };
const q = (p, a, b) => p.queryArc(a, b, { _cps: 1 });
const prepareCode = (src) => { try { prepare(src); } catch (e) { return e.code; } return null; };
const norm = (t) => t.replace(/\s+/g, '');
const throwsCode = (f, c) => { try { f(); } catch (e) { assert.equal(e.code, c, e.message); return e; } assert.fail('expected ' + c); };
const bd = (k) => (h) => h.value.bus === k; const rdr = (k) => (h) => h.value.s === 'bus' && h.value.n === k;
const perCycle = (haps, n, pick) => Array.from({ length: n }, (_, c) => haps.filter((h) => pick(h) && +h.whole.begin >= c && +h.whole.begin < c + 1).length);

const EX1 = `drums: s("bd*4, hh*8").lpf(4000)
  .split(dry => dry,
         wet => wet.room(0.9).rsize(6).lpf(900),
         grit => grit.crush(5).hpf(2000).gain(0.4))`;
const EX1_COMPILED = `drums: stack(
  s("bd*4, hh*8").lpf(4000).dry(0).bus(64),
  s("bus").n(64).attack(0.01).release(0.01).gain(1),
  s("bus").n(64).attack(0.01).release(0.01).gain(1).room(0.9).rsize(6).lpf(900),
  s("bus").n(64).attack(0.01).release(0.01).gain(1).crush(5).hpf(2000).gain(0.4))`;

// 1. host
{
  const ver = (n) => pkg(n)?.version || 'absent';
  assert.equal(typeof core.Pattern.prototype.bus, 'function'); assert.equal(typeof core.Pattern.prototype.busgain, 'function'); assert.equal(typeof core.Pattern.prototype.bmod, 'function');
  const e = throwsCode(() => prepare(EX1, { host: { busSound: false, busControl: true } }), 'E_LANE_HOST'); assert.ok(/never replaced by \.layer/.test(e.message));
  assert.equal(compile(EX1, { host: { busSound: false } }).graph.diagnostics.some((d) => d.code === 'E_LANE_HOST'), true);
  throwsCode(() => prepare(EX1, { host: { busSound: true, busControl: false } }), 'E_LANE_HOST');
  assert.equal(compile(EX1, { host: { busSound: true, busControl: true } }).graph.diagnostics.length, 0, 'a full host raises nothing');
  assert.equal(compile('a: s("bd")', { host: { busSound: false } }).graph.diagnostics.length, 0, 'no audio feature: no host requirement');
  // lanes.prepare asks the real host: here only the controls are known (no superdough in Node)
  assert.deepEqual(lanes.host().busControl, true);
  const site = /STRUDEL_WEB\s*=\s*'[^']*@strudel\/web@([\d.]+)/.exec(fs.readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8'))?.[1];
  const web = path.join(os.tmpdir(), `strudel-web-${site}.js`); const sound = fs.existsSync(web) ? /[\w$]+\("bus",\([\w$]+,[\w$]+,[\w$]+\)=>/.test(fs.readFileSync(web, 'utf8')) : null; // the unpkg bundle tests/site/lanes.mjs downloads (superdough is inside it)
  pass(`Host (Node half): core ${ver('@strudel/core')} has the bus, busgain, bmod controls; @strudel/web ${ver('@strudel/web')} (site pins ${site}) registers the "bus" sound (${sound === null ? 'bundle not downloaded yet: run tests/site/lanes.mjs first' : sound}); with the sound removed in a stub host a split raises E_LANE_HOST ("never replaced by .layer"), a missing control too, a program without audio features is not asked (the site half and the render are in tests/site/lanes.mjs; the CLI's superdough version cannot be read here)`);
}

// 2. compile + no-op on the catalog
{
  const c1 = compile(EX1); const c2 = compile(EX1);
  assert.equal(norm(c1.code), norm(EX1_COMPILED)); assert.equal(c1.code, c2.code); assert.equal(c1.graph.diagnostics.length, 0); assert.deepEqual(c1.graph.audio.splits.map((s) => [s.lane, s.bus, s.branches]), [['drums', 64, 3]]);
  const cat = JSON.parse(fs.readFileSync(new URL('../../site/data/catalog.json', import.meta.url), 'utf8')); let n = 0; const bad = [];
  for (const r of cat.recipes) { n++; const o = compile(r.code); if (o.code !== r.code || prepare(r.code).code !== r.code || o.graph.audio) bad.push(r.id); }
  assert.deepEqual(bad, []); assert.equal(n, 46);
  pass(`Compile: the LANES 5.1 program compiles to the plain text of the doc (bus 64, 10 ms attack/release, gain(1); whitespace-insensitive equal); compile and prepare are a no-op on all ${n} catalog recipe codes (${bad.length} failures)`);
}

// 3. no re-synthesis (event counts through the library; `strudel events` is the CLI form)
{
  const split = await evalProgram(EX1); const h = q(split, 0, 4); const src = perCycle(h, 4, bd(64)); const rd = perCycle(h, 4, rdr(64));
  const layer = await evalProgram('drums: s("bd*4, hh*8").lpf(4000).layer(d => d, w => w.room(0.9).rsize(6).lpf(900), g => g.crush(5).hpf(2000).gain(0.4))'); const lh = q(layer, 0, 4);
  assert.deepEqual(src, [12, 12, 12, 12]); assert.deepEqual(rd, [3, 3, 3, 3]); assert.equal(lh.length, 36 * 4); assert.equal(h.filter((x) => x.value.s !== 'bus').length, 12 * 4);
  pass(`No re-synthesis (library query): per cycle ${src[0]} source haps and ${rd[0]} reader haps with .split, ${lh.length / 4} haps with .layer`);
  cliUnspecified('No re-synthesis via `strudel events` (12 source / 3 reader haps per cycle; layer 36)', 'the output format of `strudel events` (how to count source vs reader haps per cycle) and its cycle-range flag are not documented in the #75 comments; the counts are queried from the same compiled program through the library above');
  cliUnspecified('Same sound as the hand-written bus program (`strudel render` mix.wav SHA-256)', '`strudel render` arguments (where mix.wav is written, cycles, cps) are not documented, only `--no-lanes` for the compiled text; library half: compiled text equals the hand-written text (Compile box), site offline renders are in tests/site/lanes.mjs');
}

// 4. merge, gate, wire, nesting
{
  const m = await evalProgram('a: s("bd*4").split(x => x, y => y.lpf(300)).merge(m => m.shape(0.5))'); const h = q(m, 0, 4);
  const mr = perCycle(h, 4, (x) => x.value.s === 'bus' && x.value.n === 65); assert.deepEqual(mr, [1, 1, 1, 1]); assert.ok(h.filter((x) => x.value.n === 65).every((x) => x.value.shape === 0.5));
  assert.deepEqual(perCycle(h, 4, rdr(64)), [2, 2, 2, 2]);
  const post = compile('a: s("bd*4").split(x => x, y => y.lpf(300)).shape(0.5)'); assert.deepEqual(post.graph.diagnostics.map((d) => d.code), ['W_LANE_POST_SPLIT']); assert.equal(compile('a: s("bd*4").split(x => x, y => y.lpf(300)).merge(m => m.shape(0.5))').graph.diagnostics.length, 0);
  pass(`Merge (events): ${mr[0]} merge reader per cycle carrying shape 0.5 (bus 65), 2 branch readers feed it; the same effect after the split without merge raises ${post.graph.diagnostics[0].code} (renders differ: tests/site/lanes.mjs)`);
  const g = await evalProgram('a: s("bd*4").split(g => g.struct("x*16"))'); const gh = q(g, 0, 2);
  assert.deepEqual(perCycle(gh, 2, rdr(64)), [16, 16]); assert.deepEqual(perCycle(gh, 2, bd(64)), [4, 4]); assert.equal(gh.filter((x) => x.value.s !== 'bus').length, 8);
  pass('Gate branch: g => g.struct("x*16") gives 16 reader haps per cycle and no extra source haps (4 bd per cycle)');
  const sx = await evalProgram('a: s("bd*2").split(x => x, y => y.split(p => p, q => q.room(1)))'); const sh = q(sx, 0, 1); assert.equal(sh.filter(rdr(64)).length, 2); assert.equal(sh.filter(rdr(65)).length, 2); assert.equal(sh.filter((x) => x.value.s !== 'bus').length, 2);
  const w = await evalProgram('a: s("bd*2").lpf(200).wire("lpf", "bus:lfo", { depth: 800 })\nb: s("sine").note("c1").send("lfo")'); const wh = q(w, 0, 1).filter((x) => x.value.bmod);
  assert.equal(wh.length, 2); assert.equal(wh[0].value.bmod[0].bus, 512); assert.equal(wh[0].value.bmod[0].control, 'cutoff'); assert.equal(wh[0].value.bmod[0].depth, 800);
  const gs = compile('d: s("bd*4").tags("drums")\nk: note("c").tags("keys")\nverb: ret("verb")\ntagged("drums").send("verb", 0.5)'); assert.equal(gs.graph.audio.sends.length, 1); assert.equal(gs.graph.audio.sends[0].lane, 'd'); assert.ok(!/tagged/.test(gs.code));
  const gp = await evalProgram('d: s("bd*4").tags("drums")\nverb: ret("verb").room(1)\ntagged("drums").send("verb", 0.5)\ntagged("drums").gain(0.5)'); const gq = q(gp, 0, 1);
  assert.equal(gq.filter((x) => x.value.bus === 64).length, 4); assert.equal(gq.filter((x) => x.value.busgain === 0.5 && x.value.bus === 512).length, 1); assert.ok(gq.filter((x) => x.value.s === 'bd').every((x) => x.value.gain === 0.5), 'other ops on the same selection keep working');
  pass('Nesting, wire and group send: a split inside a branch allocates buses 64 and 65 (2 + 2 readers, 2 sources); .wire("lpf", "bus:lfo", { depth: 800 }) becomes .bmod on named bus 512; tagged("drums").send("verb", 0.5) adds a send to the lanes whose literal tags match, other tagged ops stay runtime');
}

// 5. sends and checks
{
  const prog = 'drums: s("bd*4").send("verb", 0.3)\nkeys: note("c e g").s("piano").send("verb", 0.6)\nverb: ret("verb").room(1).rsize(8).lpf(3000)';
  const sp = await evalProgram(prog); const h = q(sp, 0, 1); const rd = h.filter(rdr(512)); assert.equal(rd.length, 1); assert.equal(h.filter((x) => x.value.bus === 512).length, 2);
  assert.deepEqual(compile(prog).graph.diagnostics, []); assert.deepEqual(compile(prog).graph.audio.buses.named, { verb: 512 });
  const nr = compile('drums: s("bd*4").send("verb", 0.3)'); assert.deepEqual(nr.graph.diagnostics.map((d) => d.code), ['W_BUS_NO_RETURN']);
  pass('Sends (events): two lanes sending to "verb" give one return reader on named bus 512 and two forwarding readers; a send with no return gives W_BUS_NO_RETURN (silent, not fatal). The rendered return stem is silent at sends 0 and sounds at 0.3 in tests/site/lanes.mjs; `strudel stems` is open (CLI)');
}
{
  const ex6 = 'a: s("bd*4").split(x => x.tap("inner").lpf(500))\nb: s("hh*8").gain(tap("inner:env"))\nv: ret("v").send("v")';
  const d = compile(ex6).graph.diagnostics; const cross = d.find((x) => x.code === 'E_LANE_CROSS'); const cyc = d.find((x) => x.code === 'E_LANE_CYCLE');
  assert.equal(cross.line, 2); assert.equal(cyc.line, 3); assert.equal(check(ex6).errors.length >= 2, true); assert.ok(['E_LANE_CROSS', 'E_LANE_CYCLE'].includes(throwsCode(() => prepare(ex6), prepareCode(ex6)).code));
  const src = compile('a: s("bd").split(x => x.s("sawtooth"))'); assert.equal(src.graph.diagnostics[0].code, 'E_LANE_SOURCE'); assert.equal(src.graph.diagnostics[0].line, 1); throwsCode(() => prepare('a: s("bd").split(x => x.s("sawtooth"))'), 'E_LANE_SOURCE');
  for (const c of ['n(3)', 'note("c")', 'bus(1)', 'dry(0)', 'sound("x")']) assert.equal(compile(`a: s("bd").split(x => x.${c})`).graph.diagnostics[0].code, 'E_LANE_SOURCE', c);
  const br = compile('a: s("bd").bus(64)'); assert.equal(br.graph.diagnostics[0].code, 'E_BUS_RANGE'); throwsCode(() => prepare('a: s("bd").bus(64)'), 'E_BUS_RANGE'); assert.equal(compile('a: s("bd").bus(3)').graph.diagnostics.length, 0, 'user buses below 64 are left alone');
  assert.equal(compile('a: s("bd").split(x => x.add(x))').graph.diagnostics[0].code, 'E_LANE_SOURCE', 'a branch must be written x => x.fx()');
  assert.equal(compile('a: s("bd").split(x => x, y => y.ret("v"))').graph.diagnostics.some((x) => x.code === 'E_LANE_CROSS'), true);
  const cy2 = compile('a: ret("p").send("q")\nb: ret("q").send("p")').graph.diagnostics; assert.ok(cy2.some((x) => x.code === 'E_LANE_CYCLE'));
  const gc = compile('v: ret("verb").tags("wet")\ntagged("wet").send("verb", 0.5)').graph.diagnostics; assert.ok(gc.some((x) => x.code === 'E_LANE_CYCLE'), 'a group send that reaches its own return is a cycle');
  pass(`Closed lanes: LANES example 6 raises E_LANE_CROSS at line ${cross.line} (the tap "inner" is private to a's branch) and E_LANE_CYCLE at line ${cyc.line} (v -> v; also a two-lane cycle and a group send that reaches its own return); .s("sawtooth") in a branch raises E_LANE_SOURCE (also n, note, bus, dry, sound); user .bus(64) raises E_BUS_RANGE (.bus(3) is left alone)`);
}

// 6. deterministic allocation
{
  const a = 'u: note("c2").s("sine").split(d => d)\nv: s("hh*4").split(d => d, w => w.lpf(300))'; const b = 'v: s("hh*4").split(d => d, w => w.lpf(300))\nu: note("c2").s("sine").split(d => d)';
  const ga = graphJSON(a); assert.equal(ga, graphJSON(a)); assert.equal(compile(a).code, compile(a).code);
  const na = compile(a).graph.audio.splits.map((s) => [s.lane, s.bus]); const nb = compile(b).graph.audio.splits.map((s) => [s.lane, s.bus]);
  assert.notDeepEqual(na, nb); assert.deepEqual(na, [['u', 64], ['v', 65]]); assert.deepEqual(nb, [['v', 64], ['u', 65]]);
  assert.deepEqual(compile('x: s("a").send("zz")\ny: ret("zz")\nw: ret("aa")').graph.audio.buses.named, { aa: 512, zz: 513 }, 'named buses by name order');
  pass(`Deterministic allocation: two compiles give identical code and graph (${ga.length} bytes); moving a lane changes the numbers ${JSON.stringify(na)} -> ${JSON.stringify(nb)}; named buses are numbered from 512 in name order (the render hash half is in tests/site/lanes.mjs)`);
}

// 7. runtime checks on queried haps (E_LANE_SOURCE, W_LANE_REFRAIN) and the diagnostics surface
{
  await evalProgram('a: s("bd*4").split(g => g.struct("x ~"), d => d)'); q(R.scheduler.pattern, 0, 2); const dg = lanes.diagnostics();
  const rf = dg.find((d) => d.code === 'W_LANE_REFRAIN'); assert.ok(rf && /50%/.test(rf.msg), JSON.stringify(dg));
  await evalProgram('a: s("bd*4").split(g => g.struct("x*16"))'); q(R.scheduler.pattern, 0, 2); assert.equal(lanes.diagnostics().some((d) => d.code === 'W_LANE_REFRAIN'), false, 'a full reader leaves no gap');
  await evalProgram('a: s("bd*4").split(d => d)'); const p = R.scheduler.pattern; q(core.stack(p, core.s('bus').n(64).note(40)), 0, 1); assert.ok(lanes.diagnostics().some((d) => d.code === 'E_LANE_SOURCE'));
  pass('Runtime checks: a gated reader (struct "x ~") reports W_LANE_REFRAIN with the silent fraction (50%), a full reader does not; a reader that sets note raises E_LANE_SOURCE on the queried haps');
}

// 8. a program without audio features is not touched
{
  const plain = 'drums: s("bd*4, hh*8").lpf(800)\n$: note("c e g").s("piano").tags("keys")\ntagged("keys").gain(0.5)'; const r = prepare(plain); assert.equal(r.code, plain); assert.equal(compile(plain).code, plain);
  const sp = 'const w = "a b c".split(" ")\n$: s("bd").gain(0.5)'; assert.equal(compile(sp).code, sp, 'a JS string .split is not a lane split');
  pass('Untouched: a program with tags and tagged() but no .split/.merge/.send/ret comes back byte for byte (and a JS string .split(" ") is not a lane split)');
}

// 9. syntax.json
{
  const sx = JSON.parse(fs.readFileSync(new URL('../../site/data/syntax.json', import.meta.url), 'utf8')); const sec = sx.sections.find((x) => x.id === 'lanes');
  const aud = sec.examples.filter((e) => !/capture\(/.test(e.code) && /\.split\(|\.send\(|ret\(|\.merge\(|bus:/.test(e.code)); assert.ok(aud.length >= 4 && aud.every((e) => !e.coming), 'split/merge/send/ret/wire examples are built, not coming');
  let total = 0; for (const e of aud) { const p = await evalProgram(e.code); total += q(p, 0, 2).length; assert.deepEqual(compile(e.code).graph.diagnostics.filter((d) => d.level === 'error'), [], e.title); }
  assert.ok(sec.examples.some((e) => e.coming && /capture/.test(e.code)));
  pass(`syntax.json: ${aud.length} audio-layer examples (split, merge, send/ret, wire) are runnable and compile without errors (${total} haps over 2 cycles); the unbuilt capture forms (bus and rolling audio) stay "coming"`);
}
cliUnspecified('Stems: `strudel stems` one stem per output-carrying lane, stems sum to mix.wav within -60 dB', '`strudel stems` arguments and output layout (output directory flag, stem file names) are not documented in the #75 comments; lane groups come from graph.audio here');
cliUnspecified('`strudel lanes IN` shows buses and edges', 'the JSON field names `strudel lanes` uses for buses, splits, sends, returns and wires are not documented; the data it should print is graph.audio of compile()');
console.log('lanes L2 done');
