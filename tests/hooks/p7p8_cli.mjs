// #53 / #54 boxes that needed the hooks runtime and the CLI: bounce, strudel perf / controls, render hashes, slider shim, completions.
// `node tests/hooks/p7p8_cli.mjs` (needs SUNO_LAB, default /home/user/suno-track-lab, branch with strudel-cli perf/controls)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// -- #54 Completions (before Strudel is booted: engine/index.js must not install hooks here) --
{
  const reg = []; let inval = 0;
  globalThis.strudelCraft = { intellisense: { register: (p) => { reg.push(p); return () => {}; }, invalidate: () => { inval++; } } };
  const { default: sc } = await import(pathToFileURL(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../site/engine/index.js')).href);
  assert.ok(reg.some((p) => p.id === 'controls'), 'provider registered with window.strudelCraft.intellisense');
  sc.controls.registerType({ id: 'knob', value: 'number' }); // Node cannot fetch() the builtin types.json; the browser can
  const c = sc.controls.create({}); c.ctl('cutoff', { type: 'knob', min: 200, max: 8000, default: 800 });
  const items = await reg.find((p) => p.id === 'controls').items();
  const it = items.find((x) => x.label === 'cutoff'); assert.ok(it && it.inside.includes('tap("') && it.inside.includes('hooks.map("'));
  assert.ok(items.some((x) => x.category === 'control-type' && x.label === 'knob')); assert.ok(inval >= 1, 'cache invalidated when a control is declared');
  assert.equal(typeof sc.hooksLib.install, 'function'); assert.equal(typeof sc.hooksLib.protect, 'function');
  const { pass } = await import('./harness.mjs'); pass(`Completions (#54): provider "controls" registered on strudelCraft.intellisense; after ctl("cutoff") it offers cutoff inside tap(" and hooks.map(" (${items.length} items), cache invalidated`);
}

const { boot, cli, sha, tmp, pass, HERE } = await import('./harness.mjs');
const { core } = await boot();
const { bounceCode } = await import(pathToFileURL(path.resolve(HERE, '../../site/engine/pads.js')).href);
const { laneCode } = await import(pathToFileURL(path.resolve(HERE, '../../site/engine/controls.js')).href);
const F = path.join(HERE, 'fixtures'); const J = (f) => JSON.parse(fs.readFileSync(path.join(F, f), 'utf8'));
const evs = (prog, extra = []) => { const r = cli(['events', prog, ...extra, '--cycles', '4']); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout).events; };
const withLines = (head, file) => { const d = tmp('p78-'); const f = path.join(d, 'prog.strudel.js'); fs.writeFileSync(f, head + fs.readFileSync(file, 'utf8')); return f; };

// -- #53 Bounce --
{
  const model = J('model_perf.json'); const perf = model.performances.take1; const pads = { 'A/0,0': model.pads.banks[0].pads[0].target, 'A/0,1': model.pads.banks[0].pads[1].target };
  const played = evs(path.join(F, 'perf_reader.strudel.js'), ['--model', path.join(F, 'model_perf.json'), '--name', 'take1']);
  const exact = withLines(bounceCode(perf, { pads, quant: 'none', name: 'take1' }), path.join(F, 'perf_reader.strudel.js')); const a = evs(exact);
  assert.deepEqual(a, played); assert.equal(played.length, 6); assert.ok(played.some((e) => e.lpf === 400) && played.some((e) => e.lpf === undefined));
  const grid = withLines(bounceCode(perf, { pads, quant: 'grid', grid: 16, name: 'take1' }), path.join(F, 'perf_reader.strudel.js')); const b = evs(grid);
  assert.deepEqual(b.map((e) => [e.cycle, e.lpf]), played.map((e) => [e.cycle, e.lpf]));
  pass(`Bounce (#53): bounced code (exact $events) gives strudel events deep-equal to the take played from the model (${played.length} events, lpf gates incl.); grid bounce matches onsets and gates`);
}

// -- #53 Headless --
{
  const m = path.join(F, 'model_perf.json'); const p1 = cli(['perf', m, '--name', 'take1', '--bars', '4']); const p2 = cli(['perf', m, '--name', 'take1', '--bars', '4']);
  assert.equal(p1.status, 0, p1.stderr); assert.equal(p1.stdout, p2.stdout); const j = JSON.parse(p1.stdout).takes.take1; assert.equal(j.events.length, 6); assert.deepEqual(j.gates['A/0,1'].windows, [[1, 2], [3, 4]]);
  const prog = path.join(F, 'perf_render.strudel.js'); const o1 = tmp('p7r-'); const o2 = tmp('p7r-');
  const r1 = cli(['render', prog, o1, '--bars', '4', '--model', m, '--name', 'take1']); assert.equal(r1.status, 0, r1.stderr); assert.equal(cli(['render', prog, o2, '--bars', '4', '--model', m, '--name', 'take1']).status, 0);
  const o0 = tmp('p7r-'); assert.equal(cli(['render', prog, o0, '--bars', '4']).status, 0);
  assert.equal(sha(path.join(o1, 'mix.wav')), sha(path.join(o2, 'mix.wav'))); assert.notEqual(sha(path.join(o1, 'mix.wav')), sha(path.join(o0, 'mix.wav')), 'the take changes the audio');
  pass(`Headless (#53): strudel perf twice identical (${j.events.length} tap events, 1 gate); render --model twice identical sha256 ${sha(path.join(o1, 'mix.wav')).slice(0, 12)} (differs from the same program without the model)`);
}

// -- #54 Slider shim through the CLI --
{
  const e = evs(path.join(F, 'slider_prog.strudel.js')); assert.equal(e.length, 8); assert.ok(e.every((x) => x.cutoff === 800 && x.lpf === 800));
  pass('Slider shim (#54): strudel events of a program using slider(800, 200, 8000) shows lpf 800 on every event (CLI defines sliderWithID; no Strudel file changed)');
}

// -- #54 Headless: controls listing, --set, lane render hash --
{
  const prog = path.join(F, 'ctl_prog.strudel.js'); const lane = path.join(F, 'model_lane.json'); const ctl = path.join(F, 'model_ctl.json');
  const l = cli(['controls', prog, '--model', lane]); assert.equal(l.status, 0, l.stderr); const c = JSON.parse(l.stdout).controls[0];
  assert.deepEqual([c.name, c.type, c.range, c.value, c.maps, c.lanes], ['cutoff', 'knob', [200, 8000], 800, [], ['l1']]);
  const base = evs(prog, ['--model', ctl]); assert.ok(base.every((x) => x.cutoff === 800)); const set = evs(prog, ['--model', ctl, '--set', 'cutoff=1200']); assert.ok(set.every((x) => x.cutoff === 1200));
  const o1 = tmp('p8r-'); const o2 = tmp('p8r-'); const r1 = cli(['render', prog, o1, '--bars', '2', '--model', lane]); assert.equal(r1.status, 0, r1.stderr); assert.equal(cli(['render', prog, o2, '--bars', '2', '--model', lane]).status, 0);
  assert.equal(sha(path.join(o1, 'mix.wav')), sha(path.join(o2, 'mix.wav')));
  pass(`Headless (#54): strudel controls lists name/type/range/value/maps/lanes; --set cutoff=1200 moves every event 800 -> 1200; render --model with a lane twice identical sha256 ${sha(path.join(o1, 'mix.wav')).slice(0, 12)}`);
}

// -- #54 Bounce --
{
  const model = J('model_lane.json'); const played = evs(path.join(F, 'ctl_prog.strudel.js'), ['--model', path.join(F, 'model_lane.json')]);
  const rd = fs.readFileSync(path.join(F, 'ctl_prog.strudel.js'), 'utf8').replace(/ctl\([^)]*\)\s*\}\s*\)/, 'ctl("x")').replace(/lpf\(ctl\(.*\)\)\s*$/m, 'lpf(lane_cutoff)');
  const d = tmp('p8b-'); const f = path.join(d, 'b.strudel.js'); fs.writeFileSync(f, '// @daw bars=4\n' + laneCode(model.automation.l1, 'lane_cutoff') + rd.replace('// @daw bars=4\n', ''));
  const b = evs(f); assert.deepEqual(b, played); assert.equal(played.length, 16); assert.ok(new Set(played.map((e) => e.cutoff)).size > 4);
  pass(`Bounce (#54): the bounced lane (inline signal, no model) gives strudel events deep-equal to the lane played from the model (${played.length} events, ${new Set(played.map((e) => e.cutoff)).size} distinct cutoffs)`);
}
process.exit(0);
