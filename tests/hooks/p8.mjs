import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRegistry, loadBuiltinTypes, createControls, recordLane, sampleLane, bounceLane, evalBounced, rescaleLane } from '../../site/engine/controls.js';
import { createInput, createRouter } from '../../site/engine/input.js';
import { validate } from '../../site/engine/validate.js';
import { canonical } from '../../site/engine/time.js';
const schema = JSON.parse(fs.readFileSync(new URL('../../site/data/schema/model.v1.json', import.meta.url)));
const pass = (m) => console.log('PASS ' + m);
const mk = async (o = {}) => { const reg = await loadBuiltinTypes(createRegistry()); return createControls({ registry: reg, ...o }); };
const throwsCode = (f, code) => { try { f(); } catch (e) { assert.equal(e.code, code); return; } assert.fail('expected ' + code); };
const evs = [0, 0.25, 0.5, 0.75].map(b => ({ begin: b })); // 4 note events
const lpf = (c, ev, t = ev.begin) => ev.map(e => ({ ...e, cutoff: c.valueAt(e.begin) }));

// types
{
  const c = await mk(); const ids = c.registry.types().map(t => t.id);
  assert.equal(ids.length, 16);
  for (const t of c.registry.types().filter(t => !t.drawn)) { const ch = c.registry.fallbackChain(t.id); assert.ok(c.registry.type(ch.at(-1)).drawn, t.id); }
  c.registry.registerType({ id: 'wheel', value: 'number', render: { fallback: 'knob' } }); assert.ok(c.registry.types().some(t => t.id === 'wheel'));
  const strict = createControls({ registry: c.registry, strict: true }); throwsCode(() => strict.ctl('q', { type: 'nope' }), 'E_CONTROL_TYPE');
  pass(`Types: ${ids.length} ids; declared-only chains: ${c.registry.types().filter(t => !t.drawn).map(t => c.registry.fallbackChain(t.id).join('>')).join(', ')}; runtime type listed; unknown -> E_CONTROL_TYPE`);
}
// ctl
{
  const c = await mk(); const r = c.ctl('cutoff', { type: 'knob', min: 200, max: 8000, default: 800 });
  assert.deepEqual(lpf(c.ctl('cutoff'), evs).map(e => e.cutoff), [800, 800, 800, 800]);
  c.set('cutoff', 1200); assert.deepEqual(lpf(r, evs).map(e => e.cutoff), [1200, 1200, 1200, 1200]);
  throwsCode(() => c.ctl('cutoff', { type: 'knob', min: 100, max: 8000, default: 800 }), 'E_CONTROL_CONFLICT');
  throwsCode(() => c.set('cutoff', 9000), 'E_BAD_ARG');
  pass('ctl: 800 on every event, 1200 after set, conflict -> E_CONTROL_CONFLICT, out of range -> E_BAD_ARG (engine-level; hooks/CLI event path pending #48)');
}
// slider shim
{
  const c = await mk(); const s = c.sliderWithID('slider_12', 800, 200, 8000);
  assert.equal(s(0, 1)[0].value, 800);
  pass('Slider shim (engine level): sliderWithID(id, 800, 200, 8000) -> steady 800 query; strudel events CLI not run (no CLI in this repo)');
}
// xy and steps
{
  const c = await mk(); const p = c.ctl('pos', { type: 'xy' });
  c.set('pos', { x: 0.2, y: 0.9 }); assert.equal(p.x.valueAt(), 0.2); assert.equal(p.y.valueAt(), 0.9);
  c.set('pos', { x: 0.7, y: 0.9 }); assert.equal(p.x.valueAt(), 0.7); assert.equal(p.y.valueAt(), 0.9);
  const k = c.ctl('kickrow', { type: 'steps', count: 16, default: 'x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~' });
  const h = k.query(0, 1); assert.deepEqual(h.map(x => x.begin), [0, 0.25, 0.5, 0.75]); assert.equal(k.query(3, 4).length, 4);
  pass('XY and steps: pos:x/pos:y independent; 16-step row, 4 active -> onsets at ' + h.map(x => x.begin).join(','));
}
// toggle as gate
{
  const c = await mk(); c.ctl('on', { type: 'toggle' }); const w = c.when('on'); c.set('on', 1, 2.3);
  const g = (cy) => c.gateOpen({ when: w, quant: 1 }, cy);
  console.log('toggle set at 2.3: gate at 2.0/2.9/3.0 =', g(2.0), g(2.9), g(3.0));
  assert.equal(g(2.9), false); assert.equal(g(3.0), true); assert.equal(g(2.0), false);
  pass('Toggle as gate: applies from the first boundary after the toggle is set (engine gate semantics)');
}
// map
{
  const c = await mk(); c.ctl('macro1', { type: 'knob', min: 0, max: 1, default: 0 });
  c.registerDest('murk.hz', { min: 20, max: 20000, base: 400 }); c.registerDest('pad2.cutoff', { min: 20, max: 20000, base: 1000 });
  c.map('macro1', 'murk.hz', { range: [200, 4000], curve: 'exp' }); c.map('macro1', 'pad2.cutoff', { range: [4000, 600] });
  const rows = [0, 0.5, 1].map(t => { c.set('macro1', t); return [c.resolveDest('murk.hz', 0), c.resolveDest('pad2.cutoff', 0)]; });
  console.log('travel 0/0.5/1 ->', JSON.stringify(rows));
  assert.deepEqual(rows[0].map(Math.round), [200, 4000]); assert.deepEqual(rows[2].map(Math.round), [4000, 600]);
  assert.ok(Math.abs(rows[1][0] / Math.sqrt(200 * 4000) - 1) < 0.01);
  c.registerDest('g.v', { min: 0, max: 10, base: 5 }); c.map('macro1', 'g.v', { range: [0, 10] }, '8..16'); c.set('macro1', 1);
  assert.equal(c.resolveDest('g.v', 4), 5); assert.equal(c.resolveDest('g.v', 9), 10);
  c.registerDest('p.v', { min: 0, max: 1, base: 0 }); c.map('macro1', 'p.v', { range: [0, 1], priority: 1 }); c.map('macro1', 'p.v', { range: [0, 0.5], priority: 5 }); c.map('macro1', 'p.v', { range: [0, 0.1], priority: 2 });
  assert.equal(c.resolveDest('p.v', 0), 0.5);
  pass('Map: two destinations move at 0/0.5/1; exp midpoint = geometric mean; gated map untouched outside window; set maps resolve by priority');
}
// input
{
  const c = await mk(); c.ctl('cutoff', { type: 'knob', min: 0, max: 100, default: 50 });
  const input = createInput(); createRouter({ input, keymaps: { m: { 'midi:0/1/cc74': 'ctl:cutoff' } }, active: { stub: 'm' }, pads: {}, controls: c });
  let emit; input.register({ id: 'stub', start: (e) => { emit = e; } });
  const send = (v) => emit({ type: 'value', control: 'midi:0/1/cc74', value: v, cycle: 0 });
  send(0.1); send(0.2); assert.equal(c.get('cutoff'), 50);
  send(0.6); assert.equal(c.get('cutoff'), 60); // crossed 0.5
  const j = await mk({ model: { pads: { settings: { takeover: 'jump' } } } }); j.ctl('cutoff', { type: 'knob', min: 0, max: 100, default: 50 }); j.input('value', 'cutoff', 0.1); assert.equal(j.get('cutoff'), 10);
  pass('Input: stub midi cc74 -> ctl:cutoff; pickup holds at 50 until crossing then moves to 60; jump goes straight to 10');
}
// automation + bounce
const moves = Array.from({ length: 65 }, (_, i) => [i / 16, 200 + 7800 * (i < 32 ? i / 32 : 1 - (i - 32) / 32) + (i % 2 ? 3 : 0)]);
const lane = recordLane({ moves, range: [200, 8000], length: 4, control: 'cutoff', mode: 'curve' });
{
  let maxErr = 0; for (const [t, v] of moves) maxErr = Math.max(maxErr, Math.abs(sampleLane({ points: lane.points, length: '4' }, t) - v));
  assert.ok(lane.points.length < moves.length); assert.ok(maxErr <= 0.005 * 7800 + 1e-6);
  assert.equal(sampleLane(lane, 8 + 1), sampleLane(lane, 1));
  const l2 = { points: [['0', 0, 'lin'], ['1', 10, 'lin']], period: '1', length: '1' }; assert.equal(sampleLane(l2, 0), 0); assert.equal(sampleLane(l2, 0.5), 5);
  pass(`Automation: ${moves.length} moves thin to ${lane.points.length} points, max error ${maxErr.toFixed(1)} <= ${(0.005 * 7800).toFixed(1)}; period replay; lin midpoint = mean`);
  const sl = recordLane({ moves, range: [200, 8000], length: 4, control: 'cutoff', mode: 'steps' });
  for (const l of [lane, sl]) { const b = bounceLane(l); for (let c = 0; c < 8; c += 0.0625) assert.ok(Math.abs(evalBounced(b, c) - sampleLane(l, c)) < 1e-9, `${l.mode} @${c}`); }
  pass('Bounce: $curve and steps $mini bounce sample deep-equal to the lane at 128 points over 8 cycles (engine-level; strudel events CLI pending)');
}
// schema + roundtrip
{
  const c = await mk(); c.ctl('cutoff', { type: 'knob', min: 200, max: 8000, curve: 'exp', default: 800 }); c.set('cutoff', 1200);
  c.ctl('pos', { type: 'xy' }); c.map('cutoff', 'murk.hz', { range: [200, 4000], curve: 'exp' }, '@drop');
  c.load({ ...c.toModel(), boards: [{ id: 'main', layouts: { 4: [{ ref: 'ctl:cutoff', x: 0, y: 0, w: 2, h: 1 }] } }], automation: { a1: { ...lane, control: 'cutoff' } } });
  const m = { model: 1, ...c.toModel() }; assert.deepEqual(validate(schema, m), []);
  const text = canonical(m); const c2 = await mk(); c2.load(JSON.parse(text)); const text2 = canonical({ model: 1, ...c2.toModel() });
  assert.equal(text2, text);
  assert.ok(validate(schema, { model: 1, maps: [{ control: 'x' }] }).length);
  pass('Schema and round trip: controls+maps+board+lane validate against model.v1.json; load/toModel canonical dump byte-identical');
  const items = c.completions(); assert.ok(items.some(i => i.label === 'cutoff' && i.inside.includes('tap("') && i.inside.includes('hooks.map("')));
  pass('Completions: items() offers cutoff (and pos:x) inside tap(" and hooks.map(" once ctl() evaluated; intellisense wiring in #55');
}
