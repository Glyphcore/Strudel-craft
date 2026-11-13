// Lanes L1 (#74): one minimal behavioural check per acceptance box. Run: STRUDEL_MODULES=<dir with @strudel/> node tests/lanes/l1.mjs
// Real unmodified @strudel/core + mini (+ transpiler and repl when installed) with site/engine/hooks.js and site/engine/lanes.js on top.
// Boxes that need the `strudel` CLI (another repo) print SKIP with the exact missing piece; nothing is stubbed to pass.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';
import { install as installLanes, check, compile, graphJSON, parseSelector } from '../../site/engine/lanes.js';
import { protect } from '../../site/engine/hooks.js';
import { createControls } from '../../site/engine/controls.js';

const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const RT = await bootRuntime();
if (!RT) { skip('all lanes L1 boxes', '@strudel/core + @strudel/mini not installed (set STRUDEL_MODULES=<dir containing @strudel/>)'); process.exit(0); }
const { core, hooks, S, tap } = RT; const { Pattern, stack } = core;
const NM = process.env.STRUDEL_MODULES; const s = (x) => core.s(S.mini(x)); const note = (x) => core.note(S.mini(x)); const lanes = installLanes(S, hooks);
const pkg = (n) => { try { return JSON.parse(fs.readFileSync(path.join(NM, n, 'package.json'), 'utf8')); } catch { return null; } };
const loadPkg = async (n) => { const j = pkg(n); if (!j) return null; const ex = typeof j.exports === 'object' && j.exports['.'] ? (j.exports['.'].import || j.exports['.'].default || j.exports['.']) : j.module || j.main; return import(pathToFileURL(path.join(NM, n, ex)).href); };
const transpilerMod = NM ? await loadPkg('@strudel/transpiler') : null;
const fresh = () => { hooks.reset(); hooks.live = false; hooks.horizon = undefined; lanes.reset(); };
const snap = (haps) => haps.map((h) => JSON.stringify([h.whole ? [+h.whole.begin, +h.whole.end] : null, [+h.part.begin, +h.part.end], h.value, h.context?.tags || []])).sort();
const q = (p, a, b, c = { _cps: 1 }) => p.queryArc(a, b, c);
const throwsCode = (f, c) => { try { f(); } catch (e) { assert.equal(e.code, c, e.message); return e; } assert.fail('expected ' + c); };
// the real repl, headless: transpiler, labels ($:), `.p()` ids (state.controls.id) exactly as the site evaluates them
let R = null;
if (transpilerMod) { await core.evalScope(core, RT.mini); R = core.repl({ defaultOutput: () => {}, getTime: () => 0, transpiler: transpilerMod.transpiler }); }
const evalProgram = async (src) => { fresh(); await R.evaluate(protect(lanes.prepare(src).code), false); return R.scheduler.pattern; };
const perCycle = (haps, n, pick = () => true) => Array.from({ length: n }, (_, c) => haps.filter((h) => pick(h) && +h.whole.begin >= c && +h.whole.begin < c + 1).length);
const needRepl = (box) => { if (R) return false; skip(box, '@strudel/transpiler not installed in STRUDEL_MODULES (needed for the repl and labels)'); return true; };

// 1. install
{
  const ver = (n) => pkg(n)?.version || 'absent'; const site = /STRUDEL_WEB\s*=\s*'[^']*@strudel\/web@([\d.]+)/.exec(fs.readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8'))?.[1];
  assert.ok(typeof Pattern.prototype.tags === 'function' && typeof globalThis.tagged === 'function' && typeof globalThis.lanes?.closed === 'function');
  assert.equal(installLanes(S, hooks), lanes, 'install is idempotent');
  const fakeProto = { tags() {} }; const fakeHooks = { ext: {}, gateAt() {} };
  throwsCode(() => installLanes({ Pattern: { prototype: fakeProto } }, fakeHooks, { global: false }), 'E_NAME_COLLISION');
  const web = path.join(NM, '@strudel/web/dist/index.mjs'); let webNote = `web ${ver('@strudel/web')} not installed here`;
  if (fs.existsSync(web)) { const t = fs.readFileSync(web, 'utf8'); assert.equal(/(?:prototype\.|register\(\s*["'])(?:tags|tagged|lanes)\b|(?:globalThis|window)\.(?:tagged|lanes)\b/.test(t), false, 'site bundle defines tags/tagged/lanes'); webNote = `no tags/tagged/lanes in the site bundle @strudel/web ${ver('@strudel/web')}`; }
  pass(`Install: tags, tagged, lanes added, no E_NAME_COLLISION (core ${ver('@strudel/core')}, mini ${ver('@strudel/mini')}, ${webNote}; site pins web ${site})`);
}

// 2. memo: three readers, one upstream query
{
  fresh(); let n = 0; const base = s('bd*4'); const up = new Pattern((st) => { n++; return base.query(st); });
  up.tap('x'); const readers = () => stack(tap('x'), tap('x').gain(0.5), tap('x:onset'));
  const cached = snap(q(readers(), 0, 1)); const count = n;
  n = 0; const raw = snap(q(stack(up, up.gain(0.5), up.withValue(() => 1)), 0, 1)); const uncachedCount = n;
  assert.equal(count, 1); assert.equal(uncachedCount, 3); assert.deepEqual(cached, raw);
  pass(`Memo: upstream query ran ${count} time (was ${uncachedCount} without the cache); ${cached.length} haps deep-equal the uncached run`);
}

// 3. memo safety: bind, reset, late
{
  fresh(); let n = 0; const base = s('bd*4'); const up = new Pattern((st) => { n++; return base.query(st); }); up.tap('x'); const rd = tap('x');
  q(rd, 0, 1); q(rd, 0, 1); const hit = n; assert.equal(hit, 1);
  hooks.bind('zz/fx', 'bypass'); q(rd, 0, 1); const afterBind = n; assert.equal(afterBind, 2);
  hooks.reset(); hooks.publish('x', up); q(tap('x'), 0, 1); const afterReset = n; assert.equal(afterReset, 3);
  q(tap('x'), 0, 1); assert.equal(n, 3, 'cache hit again after reset');
  const lateCached = snap(q(tap('x').late(0.25), 0, 1)); const lateRaw = snap(q(up.late(0.25), 0, 1)); assert.deepEqual(lateCached, lateRaw); assert.ok(lateCached.length >= 4);
  hooks.invalidate(); const before = n; q(tap('x'), 0, 1); assert.equal(n, before + 1, 'hooks.invalidate() (control change) recomputes');
  // a control moving behind the tap (site/engine/controls.js onChange -> hooks.invalidate) is never served stale
  const ctl = createControls({ onChange: () => hooks.invalidate() }); ctl.declare('lv', { type: 'slider', min: 0, max: 1, default: 1 });
  new Pattern((st) => s('hh*2').query(st).map((h) => h.withValue((v) => ({ ...v, gain: ctl.get('lv', 0) })))).tap('lv'); const g0 = q(tap('lv'), 0, 1)[0].value.gain; ctl.set('lv', 0.2); const g1 = q(tap('lv'), 0, 1)[0].value.gain;
  assert.equal(g0, 1); assert.equal(g1, 0.2);
  pass(`Memo safety: repeat span hits (count ${hit}); recomputes after hooks.bind (${afterBind}), hooks.reset (${afterReset}) and hooks.invalidate; .late(0.25) reader equals the uncached run; a control set() through the controls engine is served fresh (gain ${g0} -> ${g1})`);
}

// 4. different span, other controls, a new evaluation: never stale
{
  fresh(); let n = 0; const base = s('bd*4'); const mk = (tag) => new Pattern((st) => { n++; return base.query(st).map((h) => h.withValue((v) => ({ ...v, tag }))); });
  mk('a').tap('x'); const rd = tap('x'); assert.equal(q(rd, 0, 1)[0].value.tag, 'a'); const c0 = n; q(rd, 1, 2); assert.equal(n, c0 + 1, 'another span recomputes');
  q(rd, 0, 1, { _cps: 2 }); assert.equal(n, c0 + 2, 'another controls signature recomputes');
  mk('b').tap('x'); assert.equal(q(tap('x'), 0, 1)[0].value.tag, 'b', 'a code edit (republished tap) is not served from the old cache');
  pass('Memo keys: a different span, a different controls signature and an edited (republished) tap each recompute; no stale events');
}

// 5. random access
{
  fresh(); s('bd*8').degradeBy(0.5).tap('x'); const rd = tap('x');
  const all = q(rd, 0, 4).filter((h) => +h.whole.begin >= 2 && +h.whole.begin < 3); const alone = q(rd, 2, 3);
  assert.deepEqual(snap(alone), snap(all)); assert.ok(alone.length > 0 && alone.length < 8);
  pass(`Random access: [2,3) alone equals that slice of [0,4) with the cache on (${alone.length} haps)`);
}

if (!needRepl('Lane scope')) {
  // 6. lane scope
  const p = await evalProgram(`drums: stack(s("bd*2").tap("x", { export: true }), tap("x").s("hh").gain(0.3))
keys: stack(note("c e g").tap("x", { export: true }), tap("x").s("piano"))
mix: stack(tap("drums/x").s("cp"), tap("keys/x").s("cb"))`);
  const h = q(p, 0, 1); const count = (s) => h.filter((x) => x.value.s === s).length;
  assert.equal(count('hh'), 2); assert.equal(count('piano'), 3); assert.equal(count('cp'), 2); assert.equal(count('cb'), 3);
  assert.deepEqual(hooks.diag().filter((d) => d.level !== 'info'), []);
  pass(`Lane scope: tap("x") in drums reads drums/x (${count('hh')} haps) while keys also publishes x (${count('piano')}); tap("drums/x") = ${count('cp')}, tap("keys/x") = ${count('cb')}; no diagnostics`);

  // 7. open vs closed
  const prog = (closed, exp) => `${closed ? 'lanes.closed()\n' : ''}a: s("bd*2").tap("x"${exp ? ', { export: true }' : ''})\nb: tap("x").s("hh")`;
  const run = async (closed, exp) => { const pat = await evalProgram(prog(closed, exp)); try { return { haps: q(pat, 0, 1), diag: hooks.diag() }; } catch (e) { return { err: e.code, diag: hooks.diag() }; } };
  const open = await run(false, false); assert.equal(open.haps.filter((x) => x.value.s === 'hh').length, 2); assert.ok(open.diag.some((d) => d.code === 'W_LANE_IMPLICIT_EXPORT'));
  const closed = await run(true, false); assert.ok(closed.diag.some((d) => d.code === 'E_LANE_PRIVATE' && d.level === 'error'), 'the repl catches the throw; the code is in diag'); assert.equal((closed.haps || []).filter((x) => x.value.s === 'hh').length, 0);

  const eo = await run(false, true); const ec = await run(true, true);
  assert.deepEqual([eo.diag.length, ec.diag.length], [0, 0]); assert.equal(eo.haps.length, 4); assert.equal(ec.haps.length, 4);
  // no repl: Strudel's own queryArc catches what the query throws (logs [query] error); the code is in hooks.diag()
  { fresh(); const inLane = (id, pat) => pat.withState((st) => st.setControls({ ...st.controls, id })); hooks.laneMode('closed');
    const pa = inLane('a', s('bd*2').tap('x')); const pb = inLane('b', tap('x')); q(stack(pa, pb), 0, 1); assert.ok(hooks.diag().some((d) => d.code === 'E_LANE_PRIVATE')); hooks.laneMode('open'); }
  pass('Open vs closed: unexported cross-lane read works with W_LANE_IMPLICIT_EXPORT (open); E_LANE_PRIVATE raised (hooks.diag error; the Strudel queryArc logs it) under lanes.closed(); clean with { export: true } in both modes');
}

// 8. tags
{
  const a = s('bd*2').tags('drums', 'wet'); const b = s('bd*2').tag('drums').tag('wet');
  const sa = snap(q(a, 0, 1)); assert.deepEqual(sa, snap(q(b, 0, 1))); assert.ok(q(a, 0, 1).every((h) => h.hasTag('drums') && h.hasTag('wet')));
  const g = compile('drums: s("bd*4").tags("drums", "wet")\nkeys: note("c").tag("harm")').graph;
  assert.deepEqual(g.lanes.map((l) => [l.id, l.tags]), [['drums', ['drums', 'wet']], ['keys', ['harm']]]); assert.deepEqual(g.tags, ['drums', 'harm', 'wet']);
  pass(`Tags: .tags("drums","wet") haps (${q(a, 0, 1).length}) identical to .tag().tag(); the lane graph lists the lane tags ${JSON.stringify(g.lanes.map((l) => l.tags))} (CLI listing: see the CLI box)`);
}

if (!needRepl('Selection / mute / solo / serialise')) {
  const base = `drums1: s("bd*4").tags("drums")
drums2: s("hh*8").tags("drums", "wet")
drums3: s("cp*2").tags("drums")
keys: note("c e").s("piano").tags("keys")
`;
  // 9. selection
  {
    const p = await evalProgram(base + 'tagged("drums & !wet").fx(x => x.hpf(40))\n'); const h = q(p, 0, 1);
    const hp = h.filter((x) => x.value.hcutoff === 40); assert.equal(h.length, 16); assert.equal(hp.length, 6); assert.ok(hp.every((x) => x.hasTag('drums') && !x.hasTag('wet')));
    const p2 = await evalProgram(base + 'tagged("#keys | wet").fx(x => x.lpf(500))\n'); const h2 = q(p2, 0, 1); const lp = h2.filter((x) => x.value.cutoff === 500);
    assert.equal(lp.length, 10); assert.ok(lp.every((x) => x.hasTag('wet') || x.value.s === 'piano')); assert.equal(h2.length, 16);
    const p0 = await evalProgram(base); assert.equal(q(p0, 0, 1).filter((x) => x.value.hcutoff !== undefined || x.value.cutoff !== undefined).length, 0);
    pass(`Selection: tagged("drums & !wet").fx(hpf 40) hit ${hp.length} of ${h.length} haps (drums1 4 + drums3 2); tagged("#keys | wet") hit ${lp.length} (keys 2 + wet 8); without selections 0 haps touched`);
  }
  // 10. mute and solo
  {
    const p = await evalProgram(base + 'tagged("drums").mute("3b..5b")\n'); const h = q(p, 0, 6);
    const dr = perCycle(h, 6, (x) => x.hasTag('drums')); const kc = perCycle(h, 6, (x) => x.hasTag('keys'));
    assert.deepEqual(dr, [14, 14, 0, 0, 14, 14]); assert.deepEqual(kc, [2, 2, 2, 2, 2, 2]);
    const ps = await evalProgram(base + 'bass: note("c2").s("sawtooth")\ntagged("#drums1").solo()\ntagged("keys").solo()\n'); const hs = q(ps, 0, 1);
    const lanesPlayed = new Set(hs.map((x) => x.value.s)); assert.deepEqual([...lanesPlayed].sort(), ['bd', 'piano']); assert.equal(hs.length, 6);
    const pn = await evalProgram(base + 'bass: note("c2").s("sawtooth")\n'); assert.equal(q(pn, 0, 1).length, 17);
    pass(`Mute and solo: drums per cycle ${JSON.stringify(dr)} with mute("3b..5b") (keys ${JSON.stringify(kc)} untouched); two solo() selections play the union (${hs.length} haps from ${[...lanesPlayed].sort().join(' + ')}, bass dropped)`);
  }
  // 11. serialise and journal
  {
    const prog = base + 'tagged("drums & !wet").fx(x => x.hpf(40)).gain(0.5).mute("3b..5b")\ntagged("keys").solo(false)\n';
    const pa = await evalProgram(prog); const j1 = hooks.toJSON(); assert.ok(j1.includes('"selections"')); const before = snap(q(pa, 0, 5));
    hooks.reset(); hooks.load(j1, { allowCode: true }); const j2 = hooks.toJSON(); assert.equal(j2, j1, 'toJSON -> load -> toJSON byte-identical');
    assert.deepEqual(snap(q(pa, 0, 5)), before, 'loaded selections act like the evaluated ones');
    throwsCode(() => { hooks.reset(); hooks.load(j1); }, 'E_OPAQUE');
    // journal: a live toggle at cycle 3 replays headless
    const pj = await evalProgram(base + 'tagged("drums").mute(false)\n');
    hooks.live = true; hooks.position = () => 3; lanes.set('s1', 'mute', true, 'now'); hooks.live = false;
    const liveHaps = snap(q(pj, 0, 6)); const dr = perCycle(q(pj, 0, 6), 6, (x) => x.hasTag('drums'));
    assert.deepEqual(dr, [14, 14, 14, 0, 0, 0]);
    const jj = hooks.toJSON(); assert.ok(jj.includes('"sel"')); hooks.reset(); hooks.load(jj);
    assert.deepEqual(snap(q(pj, 0, 6)), liveHaps); assert.equal(hooks.toJSON(), jj);
    pass(`Serialise: toJSON -> load -> toJSON byte-identical (${j1.length} bytes, opaque fx refused without allowCode); live mute toggled at cycle 3 journals and the headless replay gives the same haps (drums per cycle ${JSON.stringify(dr)})`);
  }
}

// 12. checks
{
  const orb = check('a: s("bd").orbit(1).roomsize(2).room(0.5)\nb: s("hh").orbit(1).roomsize(6).room(0.3)\nc: s("cp").orbit(2).roomsize(9)\n');
  assert.equal(orb.warnings.length, 1); const w = orb.warnings[0]; assert.equal(w.code, 'W_LANE_ORBIT_FX'); assert.deepEqual(w.lanes, ['a', 'b']); assert.ok(/a=2, b=6/.test(w.msg));
  assert.equal(check('a: s("bd").orbit(1).roomsize(4)\nb: s("hh").orbit(1).roomsize(4)\n').warnings.length, 0);
  const dup = check(fs.readFileSync(new URL('./fixtures/dup.strudel.js', import.meta.url), 'utf8')); assert.deepEqual(dup.errors.map((e) => e.code), ['E_LANE_DUP']);
  assert.equal(check('x: s("bd")\nx: s("bd")\n').errors.length, 0, 'identical duplicate is not an error');
  pass(`Checks: ${w.code} names lanes ${w.lanes.join(' and ')} (${w.msg}); a duplicated label gives ${dup.errors[0].code}`);
}

// 13. CLI (library half only; the command lives in another repo)
{
  const open = fs.readFileSync(new URL('./fixtures/open.strudel.js', import.meta.url), 'utf8'); const closed = fs.readFileSync(new URL('./fixtures/closed.strudel.js', import.meta.url), 'utf8');
  const a = graphJSON(open); const b = graphJSON(open); assert.equal(a, b); const g = JSON.parse(a);
  assert.deepEqual(g.lanes.map((l) => l.id), ['drums', 'keys', 'bass']); assert.equal(g.selections.length, 2); assert.deepEqual(g.lanes[1].taps, [{ name: 'x', export: true }]);
  assert.equal(check(closed, { strict: true }).fail, true); assert.equal(check(closed).errors[0].code, 'E_LANE_PRIVATE'); assert.equal(check(open, { strict: true }).fail, true, 'open fixture has warnings: strict fails'); assert.equal(check(open).fail, false);
  skip('CLI: `strudel lanes FIXTURE` twice identical JSON; `strudel check --strict` exits 1 on the closed fixture', `the strudel CLI (another repo, engine/strudel-cli) has no "lanes" command and "check" does not call site/engine/lanes.js yet; the library half is verified: graphJSON(open fixture) twice = ${a.length} identical bytes, check(closed, { strict: true }).fail = true`);
}
// 14. syntax.json
if (!needRepl('syntax.json examples')) {
  const sx = JSON.parse(fs.readFileSync(new URL('../../site/data/syntax.json', import.meta.url), 'utf8')); const sec = sx.sections.find((x) => x.id === 'lanes'); assert.ok(sec && sec.needs === 'lanes');
  const built = sec.examples.filter((e) => !e.coming); const coming = sec.examples.filter((e) => e.coming); assert.ok(built.length >= 5 && coming.length >= 1);
  assert.ok(built.some((e) => /\.tags\(/.test(e.code)) && built.some((e) => /tagged\(/.test(e.code)) && built.some((e) => /export: true/.test(e.code)));
  let total = 0; for (const e of built) { const p = await evalProgram(e.code); const h = q(p, 0, 4); assert.ok(h.length > 0, e.title); total += h.length; assert.deepEqual(hooks.diag().filter((d) => d.level === 'error'), [], e.title); }
  assert.ok(coming.every((e) => /capture/.test(e.code)));
  pass(`syntax.json: section "lanes" has ${built.length} runnable examples (.tags, tagged, exported taps, closed mode: ${total} haps over 4 cycles, no diag errors) and ${coming.length} marked coming (capture/recall; the audio layer is built in L2)`);
}
console.log('lanes L1 done');
