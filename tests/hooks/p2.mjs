// Hooks P2 (#48): one minimal behavioural check per acceptance box. `node tests/hooks/p2.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, haps, cli, sha, tmp, say, pass, HERE } from './harness.mjs';
const { core, hooks, g } = await boot();
const fresh = () => { hooks.reset(); hooks.live = false; hooks.horizon = undefined; };
const mini = g.mini; const s = (x) => g.s(mini(x)); const note = (x) => g.note(typeof x === 'string' ? mini(x) : x);
const throwsCode = (f, c) => { try { f(); } catch (e) { assert.equal(e.code, c, e.message); return; } assert.fail('expected ' + c); };
const near = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const val = (p, t) => p.queryArc(t, t, { _cps: 1 })[0]?.value;

// 1. pass-through
{ fresh(); const p = s('bd*4'); assert.deepEqual(haps(p.tap('k'), 0, 2), haps(p, 0, 2)); pass('Pass-through: p.tap("k") haps deep-equal p (8 haps)'); }

// 2. order independence
{ fresh(); const rd = g.tap('k:onset'); const p = s('bd*4').tap('k'); const h = haps(rd, 0, 1); assert.equal(h.length, 4); assert.ok(h.every((x) => x.v === 1)); pass('Order independence: tap("k:onset") read before the publish gives 4 onsets per cycle'); }

// 3. env
{ fresh(); s('bd*4').tap('k'); const e = g.tap('k:env', { r: 0.25 }); near(val(e, 0.125), 0.5); assert.equal(val(e, 0.25), 1); assert.equal(val(e, 0), 1); near(val(g.tap('k:env', { r: 0.25, curve: 'exp' }), 0.125), 0.5, 0.5);
  pass(`env: r 0.25 lin -> 0.125: ${val(e, 0.125)}, at onset: ${val(e, 0.25)}`); }

// 4. param facet
{ fresh(); note('c2 e2').s('sawtooth').tap('bass'); const t = g.tap('bass:note', { default: 99 });
  const mid = val(t, 0.75); const early = val(g.tap('bass:note', { lookback: 0.1, default: 99 }), 0.3);
  assert.equal(mid, 'e2'); assert.equal(early, 99); pass(`Param facet: between notes -> earlier note (${mid}); no onset in lookback -> default (${early})`); }

// 5. wire == hand-written
{ fresh(); s('bd*4').tap('k'); const base = () => note('c2*8').s('sawtooth');
  const a = haps(base().wire('gain', 'k:env', { range: [1, 0.3], op: 'mul' }), 0, 2).map((h) => h.v.gain);
  const b = haps(base().gain(g.tap('k:env').range(1, 0.3)), 0, 2).map((h) => h.v.gain);
  assert.equal(a.length, 16); a.forEach((x, i) => near(x, b[i], 1e-9)); assert.ok(a.some((x) => x < 0.99)); pass(`wire: 16 per-event gains equal the hand-written form within 1e-9 (${a.slice(0, 4).map((x) => x.toFixed(3)).join(' ')} ...)`); }

// 6. gated read
{ fresh(); s('bd').tap('k'); const e = g.tap('k:env', { r: 0.25, gate: '<3b', default: 0 }); const live = val(e, 0.1); assert.ok(live > 0.5); assert.ok(val(e, 1.1) > 0.5); assert.equal(val(e, 2.1), 0); assert.equal(val(e, 3.05), 0);
  pass(`Gated read: live in cycles 0-1 (${live.toFixed(2)}, ${val(e, 1.1).toFixed(2)}), 0 from cycle 2`); }

// 7. variable
{ fresh(); hooks.let('root', 48); hooks.let('root', 51, '@3b'); const p = note(g.tap('root')); const h = haps(p, 0, 4).map((x) => x.v.note); assert.deepEqual(h, [48, 48, 51, 51]); assert.deepEqual(haps(p, 2, 3).map((x) => x.v.note), [51]);
  pass('Variable: root 48 in cycles 0-1, 51 from cycle 2; [2,3) alone agrees'); }

// 8. module
{
  fresh(); s('bd*4').tap('k');
  hooks.def('pump', { params: { depth: { min: 0, max: 1, default: 0.7 } }, taps: { env: 'k:env' }, chain: [['wire', 'gain', 'k:env', { range: [1, { $expr: '1-depth' }], op: 'mul' }]] });
  hooks.bind('duck', 'pump'); hooks.set('pump.depth', 0.9, '@3b');
  const p = note('c3*4').use('duck'); const gg = haps(p, 0, 4).map((h) => h.v.gain); near(gg[0], 0.3, 1e-9); near(gg[4], 0.3, 1e-9); near(gg[8], 0.1, 1e-9); near(gg[12], 0.1, 1e-9);
  throwsCode(() => hooks.set('pump.depth', 2), 'E_BAD_ARG'); near(val(g.tap('pump:depth'), 3), 0.9, 1e-9); near(val(g.tap('pump:depth'), 0.5), 0.7, 1e-9);
  pass(`Module: gain at kick onsets 0.3 (depth 0.7) in cycles 0-1, 0.1 (depth 0.9) from cycle 2; set(2) -> E_BAD_ARG; tap("pump:depth") follows the set`);
}

// 9. decorators
{
  fresh(); hooks.def('h', [['gain', 0.5]]); hooks.bind('fx', 'every(4)[h]'); const bd = () => s('bd*4').use('fx');
  const e4 = haps(bd(), 0, 8); const cyc = (c) => e4.filter((x) => x.pb >= c && x.pb < c + 1).map((x) => x.v.gain ?? '-'); assert.deepEqual([cyc(0)[0], cyc(1)[0], cyc(3)[0], cyc(4)[0], cyc(5)[0]], [0.5, '-', '-', 0.5, '-']);
  fresh(); hooks.def('h', [['lpf', 800]]); hooks.bind('fx', 'mix(0.3)[h]'); const m = haps(bd(), 0, 1); assert.equal(m.length, 8); assert.equal(m.filter((x) => x.v.gain === 0.3 && x.v.cutoff === 800).length, 4); assert.equal(m.filter((x) => x.v.cutoff === undefined).length, 4);
  fresh(); hooks.def('a', [['gain', 0.5]]); hooks.def('b', [['pan', 0.2]]); hooks.bind('fx', 'a | b'); const one = haps(bd(), 0, 2);
  fresh(); hooks.def('a', [['gain', 0.5]]); hooks.def('b', [['pan', 0.2]]); hooks.bind('fx', 'a', '*', { order: 0 }); hooks.bind('fx', 'b', '*', { order: 1 }); assert.deepEqual(haps(bd(), 0, 2), one);
  fresh(); hooks.def('plain', [['gain', 0.5]]); throwsCode(() => hooks.bind('fx', 'plain[plain]'), 'E_NOT_DECORATOR');
  fresh(); hooks.def('h', [['gain', 0.5]]); hooks.def('twice', { decorator: true, chain: [['superimpose', { $hook: 'inner' }]] }); hooks.bind('fx', 'twice[h]'); assert.equal(haps(bd(), 0, 1).length, 8);
  pass('Decorators: every(4)[h] only in cycles 0 and 4; mix(0.3)[h] doubles events (wet copy gain 0.3); "a | b" == chain a then b; plain[x] -> E_NOT_DECORATOR; user decorator via $hook inner');
}

// 10. cycle guard
{ fresh(); const A = s('x').gain(g.tap('b:gain')).tap('a'); const B = s('y').gain(g.tap('a:gain')).tap('b'); const r = g.tap('a:gain'); const v = val(r, 0.1); assert.ok(v !== undefined);
  haps(A, 0, 1); haps(B, 0, 1); const c = hooks.diag().filter((d) => d.code === 'E_TAP_CYCLE'); assert.equal(c.length, 1); pass(`Cycle guard: E_TAP_CYCLE raised once (${c[0].msg}), queries returned (value ${v})`); }

// 11. cross-layer headless
{
  const F = path.join(HERE, 'fixtures', 'xlayer.strudel.js'); const ev = JSON.parse(cli(['events', F, '--cycles', '2']).stdout);
  const rd = ev.events.filter((e) => e.layer === 't02'); assert.equal(rd.length, 8); assert.ok(rd.some((e) => e.gain < 0.5));
  const gq = (k) => rd.slice(k * 4, k * 4 + 4).map((e) => e.gain).join(' ');
  const LF = path.join(tmp('p2x-'), 'lit.strudel.js'); // same layers, the wired gains written out literally (no hooks)
  fs.writeFileSync(LF, `// @daw bars=2\n$: note("c1*2").s("sine")\n$: note("c3*4").s("sawtooth").gain("<[${gq(0)}] [${gq(1)}]>")\n`);
  const o1 = tmp('p2s-'); const o2 = tmp('p2s-'); const r1 = cli(['stems', F, o1, '--bars', '2']); assert.equal(r1.status, 0, r1.stderr); const r2 = cli(['stems', LF, o2, '--bars', '2']); assert.equal(r2.status, 0, r2.stderr + fs.readFileSync(LF, 'utf8'));
  assert.equal(sha(path.join(o1, 'stems/t02.wav')), sha(path.join(o2, 'stems/t02.wav')));
  pass(`Cross-layer headless: stem of the reading layer is byte-identical to a render with the wired gains written literally (gains ${rd.slice(0, 4).map((e) => e.gain.toFixed(3)).join(' ')}...)`);
}

// 12. JSON
{
  fresh(); hooks.let('root', 48); hooks.let('root', 51, '@3b', { priority: 2 }); hooks.let('seq', { $mini: 'c3 e3' });
  hooks.def('pump', { params: { depth: { min: 0, max: 1, default: 0.7 } }, taps: { env: 'k:env' }, chain: [['wire', 'gain', 'k:env', { range: [1, { $expr: '1-depth' }], op: 'mul' }]] });
  hooks.def('h', [['gain', 0.5]]); hooks.bind('fx', 'every(4)[h]'); hooks.bind('fx', 'pump(0.5) | h', '@3b'); hooks.set('pump.depth', 0.9, '@3b'); hooks.wire('lead.cutoff', 'bass:note', { range: [400, 4000], curve: 'exp', gate: '@3b' });
  hooks.decorate('b2', 'sometimes(0.5)'); const a = hooks.toJSON(); assert.ok(a.includes('sometimes(0.5)[pump(0.5) | h]'));
  hooks.reset(); hooks.load(a); assert.equal(hooks.toJSON(), a); hooks.undecorate('b2'); assert.ok(hooks.toJSON().includes('"hook": "pump(0.5) | h"'));
  pass(`JSON: vars, module params/taps, wires and decorated hook strings survive toJSON -> load -> toJSON (${a.length} bytes)`);
}
process.exit(0);
