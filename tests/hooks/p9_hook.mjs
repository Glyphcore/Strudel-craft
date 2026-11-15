// .hook(expr) and the hygiene standard library (#94, docs/RACK_STANDARD.md): one behavioural check per box. `node tests/hooks/p9_hook.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, haps, cli, tmp, pass, HERE } from './harness.mjs';
const { hooks, g } = await boot();
const fresh = () => { hooks.reset(); hooks.live = false; hooks.horizon = undefined; };
const mini = g.mini; const note = (x) => g.note(mini(x));
const v0 = (p) => { const v = { ...haps(p, 0, 1)[0].v }; if (v.hcutoff !== undefined) v.hpf = v.hcutoff; if (v.cutoff !== undefined) v.lpf = v.cutoff; return v; }; // Strudel's canonical names
const { HYGIENE } = await import(path.resolve(HERE, '../../site/engine/hygiene.js'));
const STD = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../tools/racks/standard.json'), 'utf8'));

{ fresh(); const v = v0(note('c4').s('sawtooth').hook('hygiene-pluck')); assert.equal(v.hpf, 120); assert.equal(v.lpf, 7000); assert.equal(v.s, 'sawtooth'); pass('in place: .hook("hygiene-pluck") sets hpf 120 and lpf 7000, keeps the source'); }
{ fresh(); const v = v0(note('c4').s('sawtooth').hook('hygiene-pluck').lpf(2000)); assert.equal(v.lpf, 2000); assert.equal(v.hpf, 120); pass('what comes after the hook wins (lpf 2000), the scope high-pass stays'); }
{ fresh(); hooks.def('pl', { chain: [['hook', 'hygiene-pluck'], ['s', 'triangle'], ['lpf', 2400]] }); hooks.bind('x', 'pl'); const v = v0(note('c4').use('x')); assert.deepEqual([v.hpf, v.lpf, v.s], [120, 2400, 'triangle']); pass('a rack starts with ["hook", "hygiene-pluck"] and narrows it'); }
{ fresh(); hooks.def('hygiene-pluck', { chain: [['hpf', 300]] }); const v = v0(note('c4').s('sawtooth').hook('hygiene-pluck')); assert.equal(v.hpf, 300); assert.equal(v.lpf, undefined); fresh(); assert.equal(v0(note('c4').hook('hygiene-pluck')).hpf, 120); pass('a program def replaces the library def; after reset the library def is back'); }
{ fresh(); const p = note('c4').s('sawtooth').hook('hygiene-lead'); assert.equal(v0(p).hpf, 150); hooks.def('hygiene-lead', { chain: [['hpf', 400]] }); assert.equal(v0(p).hpf, 400); pass('resolved at query time: a later def takes over an existing pattern'); }
{ fresh(); const j = hooks.toJSON(); assert.ok(!/hygiene-/.test(j), j.slice(0, 120)); pass('hooks.toJSON() holds no hygiene def'); }
{ fresh(); hooks.def('murk', { chain: [['lpf', 400]] }); const v = v0(note('c2').s('sawtooth').hook('hygiene-bass | murk')); assert.deepEqual([v.hpf, v.lpf], [40, 400]); pass('a pipe works: .hook("hygiene-bass | murk")'); }
{ fresh(); assert.throws(() => note('c4').hook(42), (e) => e.code === 'E_BAD_ARG'); const before = hooks.diag().length; haps(note('c4').hook('nope'), 0, 1); assert.ok(hooks.diag().slice(before).some((d) => d.code === 'E_UNKNOWN_HOOK')); pass('errors: non-string -> E_BAD_ARG; unknown hook -> E_UNKNOWN_HOOK diagnostic, pattern passes through'); }
{ const want = Object.keys(STD.classes).filter((c) => !['move', 'demo'].includes(c)); for (const c of want) assert.ok(HYGIENE['hygiene-' + c], 'no hygiene rack for class ' + c);
  for (const [k, d] of Object.entries(HYGIENE)) { const cls = STD.classes[k.replace(/^hygiene-/, '')]; assert.ok(cls, k); const hp = d.chain.find((s) => s[0] === 'hpf'); assert.ok(hp && hp[1] >= 20, k + ' has a high-pass'); assert.ok(!JSON.stringify(d).includes('$code')); }
  pass(`every class of tools/racks/standard.json has a chain-only hygiene rack with a high-pass (${want.length})`); }
{ const d = tmp('p9-'); const f = path.join(d, 'a.strudel.js'); fs.writeFileSync(f, 'setcpm(30)\n$: note("c4").s("sawtooth").hook("hygiene-pluck")\n');
  const r = cli(['events', f, '--cycles', '1']); assert.equal(r.status, 0, r.stderr); const e = JSON.parse(r.stdout).events[0]; assert.deepEqual([e.hpf, e.lpf], [120, 7000]); fs.rmSync(d, { recursive: true, force: true });
  pass('CLI: strudel events shows hpf 120 and lpf 7000 for .hook("hygiene-pluck") written with double quotes (protect keeps it out of mini-notation)'); }
