// Hooks P1 (#47): one minimal behavioural check per acceptance box. `node tests/hooks/p1.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { boot, haps, cli, sha, tmp, say, pass, HERE, CLI_DIR } from './harness.mjs';
const { S, core, hooks, g } = await boot();
const { install, protect } = await import(pathToFileURL(path.resolve(HERE, '../../site/engine/hooks.js')).href);
const fresh = () => { hooks.reset(); hooks.live = false; hooks.horizon = undefined; hooks.position = undefined; };
const gains = (p, a, b) => haps(p, a, b).map((h) => `${h.b}:${h.v.gain ?? '-'}`);
const throwsCode = (f, c) => { try { f(); } catch (e) { assert.equal(e.code, c, e.message); return; } assert.fail('expected ' + c); };
const bd = () => g.s(g.mini('bd*4')).use('fx');

// 1. API presence on the site's pinned @strudel/web 1.3.0 and the CLI's @strudel/core
{
  const coreVer = JSON.parse(fs.readFileSync(path.join(CLI_DIR, 'node_modules/@strudel/core/package.json'))).version;
  let dir = process.env.STRUDEL_WEB_DIR;
  if (!dir) { dir = tmp('strudel-web-'); const r = spawnSync('npm', ['pack', '@strudel/web@1.3.0', '--silent'], { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); spawnSync('tar', ['xzf', fs.readdirSync(dir).find((f) => f.endsWith('.tgz'))], { cwd: dir }); dir = path.join(dir, 'package'); }
  const webVer = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version;
  const W = await import(pathToFileURL(path.join(dir, 'dist/index.mjs')).href);
  for (const [name, X] of [['@strudel/web ' + webVer, W], ['@strudel/core ' + coreVer, core]]) {
    let seen = null;
    const p = new X.Pattern((st) => { seen = st.setControls({ ...st.controls, probe: 1 }).setSpan(st.span).controls; return []; });
    p.queryArc(0, 1, { _cps: 0.5 });
    assert.equal(seen.probe, 1); const cps = (() => { let c; new X.Pattern((st) => { c = st.controls._cps; return []; }).queryArc(0, 1, { _cps: 0.5 }); return c; })(); assert.equal(cps, 0.5);
    // core: the CLI already installed on it at load (would have thrown E_NAME_COLLISION); web: a fresh install here
    const r = X === core ? { hooks, tap: g.tap } : install({ Pattern: X.Pattern, stack: X.stack, silence: X.silence, reify: X.reify, signal: X.signal, Fraction: X.Fraction }, { global: false });
    assert.ok(r.hooks && r.tap);
    say(`  ${name}: new Pattern(query), State.setSpan, State.setControls, controls._cps ok; install without E_NAME_COLLISION`);
  }
  class Foo { } Foo.prototype.use = () => 1; throwsCode(() => install({ Pattern: Foo, stack() {}, silence: 1, reify() {}, signal() {}, Fraction() {} }, { global: false }), 'E_NAME_COLLISION');
  pass(`API presence: web ${webVer} and core ${coreVer}; collision detected on a foreign .use`);
}

// 2. drop-in
fresh(); hooks.bind('fx', [['gain', 0.5]], '@3b');
{ const l = gains(bd(), 0, 4); assert.deepEqual(l.filter((x) => +x.split(':')[0] < 2).map((x) => x.split(':')[1]), Array(8).fill('-')); assert.deepEqual(l.filter((x) => +x.split(':')[0] >= 2).map((x) => x.split(':')[1]), Array(8).fill('0.5')); pass('Drop-in: "@3b" -> cycles 0-1 no gain, 2-3 gain 0.5 (' + l.join(' ') + ')'); }

// 3. before / range / else
{
  fresh(); hooks.bind('fx', [['gain', 0.5]], '<3b'); let l = gains(bd(), 0, 4); assert.deepEqual([l[0], l[7], l[8], l[15]], ['0:0.5', '1.75:0.5', '2:-', '3.75:-']);
  fresh(); hooks.bind('fx', [['gain', 0.5]], '2b..4b', { else: [['gain', 0.2]] }); l = gains(bd(), 0, 4);
  assert.deepEqual([l[0], l[4], l[8], l[11], l[12]], ['0:0.2', '1:0.5', '2:0.5', '2.75:0.5', '3:0.2']);
  pass('Before and range: "<3b" mirrored, "2b..4b" = cycles [1,3), else hook outside the window');
}

// 4. random access
{ fresh(); hooks.bind('fx', [['gain', 0.5]], '2b..4b', { else: [['gain', 0.2]] }); const p = bd(); const slice = haps(p, 0, 4).filter((h) => h.pb >= 2 && h.pb < 3); assert.deepEqual(haps(p, 2, 3), slice); pass(`Random access: [2,3) alone == slice of [0,4) (${slice.length} haps, deep-equal)`); }

// 5. modes and order
{
  fresh(); hooks.scope('bass', { stem: 'low' });
  hooks.bind('track:bass/fx', [['gain', 4]], '*', { order: 0 }); hooks.bind('bass/fx', [['gain', 5]], '*', { order: 1 }); hooks.bind('stem:low/fx', [['gain', 2]]); hooks.bind('fx', [['gain', 1]]);
  assert.equal(haps(g.s('bd').use('fx').ns('bass'), 0, 1)[0].v.gain, 5);
  fresh(); hooks.scope('bass', { stem: 'low' }); hooks.bind('fx', [['gain', 1]]); hooks.bind('stem:low/fx', [['gain', 2]]); hooks.bind('bass/fx', [['gain', 3]]);
  assert.equal(haps(g.s('bd').use('fx').ns('bass'), 0, 1)[0].v.gain, 3);
  fresh(); hooks.slot('voice', { mode: 'swap' }); hooks.bind('voice', [['gain', 0.1]], '*', { priority: 0 }); hooks.bind('voice', [['gain', 0.9]], '@3b', { priority: 10 }); hooks.bind('voice', [['gain', 0.5]], '@3b', { priority: 5 });
  const v = g.s('bd').use('voice'); const gg = haps(v, 0, 4).map((h) => h.v.gain); assert.deepEqual(gg, [0.1, 0.1, 0.9, 0.9]);
  assert.ok(hooks.diag().some((d) => d.code === 'W_SHADOWED'));
  pass('Modes and order: chain global->stem->track then order (final gain 3 / 5), swap picks priority 10, W_SHADOWED raised');
}

// 6. scope
{
  fresh(); hooks.scope('bass', { stem: 'low' }); hooks.bind('bass/fx', [['gain', 0.3]]); hooks.bind('stem:low/fx', [['pan', 0.2]]);
  const a = haps(g.s('bd').use('fx').ns('bass'), 0, 1)[0].v; const b = haps(g.s('bd').use('fx'), 0, 1)[0].v;
  assert.deepEqual([a.gain, a.pan], [0.3, 0.2]); assert.deepEqual([b.gain, b.pan], [undefined, undefined]);
  pass('Scope: .ns("bass") receives bass/fx and stem:low/fx; a chain without .ns receives neither');
}

// 7. never reached
{
  fresh(); hooks.horizon = 8; hooks.bind('fx', [['gain', 0.5]], '@40b'); assert.ok(gains(bd(), 0, 2).every((x) => x.endsWith('-'))); assert.ok(hooks.diag().some((d) => d.code === 'W_GATE_UNREACHED'));
  fresh(); hooks.horizon = 8; hooks.bind('fx', [['gain', 0.5]], { from: '40b', unreached: 'error' }); throwsCode(() => bd().query(new core.State(new core.TimeSpan(0, 1), { _cps: 1 })), 'E_GATE_UNREACHED'); assert.ok(hooks.diag().some((d) => d.code === 'E_GATE_UNREACHED')); // queryArc itself swallows and logs errors (Strudel behaviour), a direct query shows the throw
  fresh(); hooks.horizon = 8; hooks.bind('fx', [['gain', 0.5]], { from: '40b', unreached: 'open' }); assert.ok(gains(bd(), 0, 8).every((x) => x.endsWith('0.5')));
  pass('Never reached: "@40b" horizon 8 -> W_GATE_UNREACHED + closed; error -> E_GATE_UNREACHED; open -> applied throughout');
}

// 8. condition and latch
{
  fresh(); hooks.bind('fx', [['gain', 0.5]], { when: '<0 1>' }); const l = gains(bd(), 0, 4); assert.deepEqual([l[0], l[4], l[8], l[12]], ['0:-', '1:0.5', '2:-', '3:0.5']);
  fresh(); hooks.bind('fx', [['gain', 0.5]], { when: '<0 0 1 0>', latch: true }); const m = gains(bd(), 0, 5); assert.deepEqual([m[0], m[4], m[8], m[12], m[16]], ['0:-', '1:-', '2:0.5', '3:0.5', '4:0.5']);
  pass('Condition and latch: { when: "<0 1>" } opens on odd cycles only; latch stays open after cycle 2');
}

// 9. journal
{
  fresh(); hooks.def('open', [['gain', 0.9]]); hooks.def('murk', [['gain', 0.2]]); hooks.bind('fx', 'murk');
  hooks.live = true; hooks.position = () => 2.3; hooks.replace('fx', 'open', 'next');
  assert.equal(hooks.journal[0].cycle, '3'); const p = bd(); const before = haps(p, 0, 6); const json = hooks.toJSON();
  assert.deepEqual([before[0].v.gain, before[8].v.gain, before[12].v.gain], [0.2, 0.2, 0.9]);
  hooks.reset(); hooks.load(json); hooks.live = false; assert.deepEqual(haps(p, 0, 6), before);
  throwsCode(() => hooks.replace('fx', 'open', 'next'), 'E_LIVE_ONLY');
  pass('Journal: "next" at 2.3 records cycle "3"; reload in a fresh registry gives the same ' + before.length + ' haps; headless "next" -> E_LIVE_ONLY');
}

// 10. JSON round trip
{
  fresh(); hooks.marker('drop', '17b'); hooks.scope('bass', { stem: 'low', bus: 2 }); hooks.slot('voice', { mode: 'swap' });
  hooks.def('murk', { params: { hz: { min: 20, max: 20000, default: 400 } }, chain: [['lpf', { $param: 'hz' }]] });
  hooks.bind('bass/fx', 'murk(300)', { until: 'drop' }); hooks.bind('fx', [['gain', 0.5]], '9b..17b, 25b..33b', { else: 'murk', order: 1 }); hooks.bind('voice', 'murk', { when: '<0 1>', latch: true, quant: 2 });
  const a = hooks.toJSON(); hooks.reset(); hooks.load(a); assert.equal(hooks.toJSON(), a);
  hooks.reset(); hooks.bind('fx', (p) => p.gain(0.5)); const o = hooks.toJSON(); assert.ok(o.includes('"opaque": true')); hooks.reset(); throwsCode(() => hooks.load(o), 'E_OPAQUE');
  pass(`JSON round trip: toJSON -> load -> toJSON byte-identical (${a.length} bytes); opaque hook refused with E_OPAQUE`);
}

// 11. CLI
{
  const F = path.join(HERE, 'fixtures'); const H = path.join(F, 'h.json');
  const r1 = cli(['hooks', path.join(F, 'plan_prog.strudel.js'), '--hooks', H, '--bars', '8']); const r2 = cli(['hooks', path.join(F, 'plan_prog.strudel.js'), '--hooks', H, '--bars', '8']);
  assert.equal(r1.status, 0, r1.stderr); assert.equal(r1.stdout, r2.stdout); assert.ok(JSON.parse(r1.stdout).slots.fx.scopes['*global*'].some((x) => x.bindings.includes('b1')));
  const c = cli(['check', '--strict', path.join(F, 'unknown_hook.strudel.js')]); assert.equal(c.status, 1); assert.ok(c.stdout.includes('E_UNKNOWN_HOOK'));
  const o1 = tmp('p1r-'); const o2 = tmp('p1r-'); const rp = path.join(F, 'render_prog.strudel.js');
  assert.equal(cli(['render', rp, o1, '--bars', '3', '--hooks', H]).status, 0); assert.equal(cli(['render', rp, o2, '--bars', '3', '--hooks', H]).status, 0);
  assert.equal(sha(path.join(o1, 'mix.wav')), sha(path.join(o2, 'mix.wav')));
  pass(`CLI: hooks plan identical twice; check --strict exit 1 (E_UNKNOWN_HOOK); render mix.wav sha256 identical ${sha(path.join(o1, 'mix.wav')).slice(0, 12)}`);
}

// 12. per layer (registry pass)
{
  const F = path.join(HERE, 'fixtures'); const f = path.join(F, 'two_layers.strudel.js'); const out = tmp('p1s-');
  const ev = JSON.parse(cli(['events', f, '--cycles', '4']).stdout); const st = cli(['stems', f, out, '--bars', '4']); assert.equal(st.status, 0, st.stderr);
  const rj = JSON.parse(fs.readFileSync(path.join(out, 'render.json'))); const per = {}; ev.layers.forEach((l) => { per[l.name] = l.events; });
  for (const [name, n] of Object.entries(per)) assert.equal(rj.stems[name].events, n, `layer ${name}`);
  assert.equal(per.t01, 12); // bd*2 over 4 cycles = 8, "dbl" (ply 2) from bar 3 adds 4
  pass(`Per-layer: stems event counts equal the mix's per-layer events (${JSON.stringify(per)}), header bind applied in every worker`);
}

// 13. protect + site README
{
  const t = protect('hooks.bind("fx", [["gain", 0.5]], "@3b")\n$: s("bd*4").use("fx").wrap("a", p => p.s("hh*2"))'); assert.ok(t.includes("'@3b'") && t.includes('s("bd*4")') && t.includes('s("hh*2")') && t.includes("use('fx')"));
  assert.ok(/Hooks/.test(fs.readFileSync(path.join(HERE, '../../site/README.md'), 'utf8')));
  pass('protect() keeps mini strings in s("..."), rewrites hooks call arguments; site/README.md has a Hooks paragraph');
}
process.exit(0);
