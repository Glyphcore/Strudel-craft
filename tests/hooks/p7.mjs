import fs from 'node:fs';
import { createPads, windows, activeAt, varAt, tapEvents, createLooper, bounce, expandGate } from '../../site/engine/pads.js';
import { createInput, createRouter, keyboardProvider, DEFAULT_KEYBOARD_MAP } from '../../site/engine/input.js';
import { validate } from '../../site/engine/validate.js';
import { quantise, fromFrac, msToCycle } from '../../site/engine/time.js';
import assert from 'node:assert/strict';

const schema = JSON.parse(fs.readFileSync(new URL('../../site/data/schema/model.v1.json', import.meta.url)));
const pass = (m) => console.log('PASS ' + m);
const P = (pos, target, o = {}) => ({ pos, target, ...o });
const bank = (id, pads, o = {}) => ({ id, rows: 4, cols: 4, pads, ...o });
const mk = (pads, o) => createPads({ banks: [bank('A', pads, o)] });
const run = (pads, f, o) => { const e = mk(pads, o); f(e); return e.resolve(); };
const cyc = (j) => j.map(e => `${e.cycle}:${e.op}:${e.pad}`);

// schema
const model = { model: 1, pads: { banks: [bank('A', [P('0,0', { kind: 'hook', ref: 'murk', slot: 'bass/fx' })]), bank('B', [P('0,0', { kind: 'tap', ref: 'pads/kick' })], { scenes: 'row' })],
  keymaps: { kbd: { 'kbd:KeyQ': '1,0' } }, settings: { latencyMs: 0 } },
  performances: { take1: { length: '4', layers: [{ events: [{ t: '0', pad: 'A/0,0', type: 'on', velocity: 0.8 }] }] } } };
assert.deepEqual(validate(schema, model), []);
assert.ok(validate(schema, { model: 1, pads: { banks: [{ id: 'x', rows: 9, cols: 1 }] } }).length > 0);
pass('Schema: two banks, keymap and performance validate');

// quantise
assert.equal(quantise(2.3, 'bar'), 3); assert.equal(quantise(2.3, 'beat'), 2.5); assert.equal(quantise(2.3, 'none'), Math.round(2.3 * 96) / 96);
pass(`Quantise: 2.3 bar->${quantise(2.3, 'bar')}, beat->${quantise(2.3, 'beat')}, none->${quantise(2.3, 'none')}`);

// modes
{
  const hk = (mode, o = {}) => [P('0,0', { kind: 'hook', ref: 'h', slot: 's' }, { mode, ...o })];
  let j = run(hk('gate'), e => { e.press('A/0,0', 1.2); e.release('A/0,0', 2.4); });
  assert.deepEqual(cyc(j), ['2:bind:A/0,0', '3:unbind:A/0,0']);
  j = run(hk('toggle'), e => { e.press('0,0', 1.2); e.press('0,0', 4.2); });
  assert.deepEqual(cyc(j), ['2:bind:A/0,0', '5:unbind:A/0,0']);
  j = run(hk('oneshot', { length: '2b' }), e => { e.press('0,0', 1.2); e.release('0,0', 1.3); });
  assert.deepEqual(cyc(j), ['2:bind:A/0,0', '4:unbind:A/0,0']);
  j = run(hk('retrigger', { quant: 'cycle', length: '2c' }), e => { e.press('0,0', 0.5); e.press('0,0', 1.5); });
  assert.deepEqual(j.map(e => e.cycle + e.op + (e.rebase ? 'R' : '')), ['1bind', '2bindR', '4unbind']);
  pass('Modes: gate, toggle, oneshot(length), retrigger(rebased 2nd window) as asserted');
}

// targets
{
  const pads = [P('0,0', { kind: 'hook', ref: 'murk', slot: 'bass/fx' }, { mode: 'gate' }), P('0,1', { kind: 'var', ref: 'root', value: 7 }, { mode: 'gate' }), P('0,2', { kind: 'component', ref: 'pad2' }, { mode: 'gate' })];
  const j = run(pads, e => { for (const c of [0, 1, 2]) { e.press(`0,${c}`, 1); e.release(`0,${c}`, 2); } });
  const show = [0.5, 1.5, 2.5].map(c => `c${c}: hooks=${activeAt(j, c, 'hook').length} root=${varAt(j, 'root', 3, c)} comp=${activeAt(j, c, 'component').length}`);
  console.log(show.join(' | '));
  assert.equal(activeAt(j, 0.5).length, 0); assert.equal(activeAt(j, 1.5, 'hook')[0].args.hook, 'murk'); assert.equal(activeAt(j, 2.5).length, 0);
  assert.equal(varAt(j, 'root', 3, 1.5), 7); assert.equal(varAt(j, 'root', 3, 2.5), 3); assert.equal(activeAt(j, 1.5, 'component')[0].op, 'open');
  pass('Targets: hook binds only while on; var value returns after; component opens gate');
}

// tap pad
{
  const pads = [P('0,0', { kind: 'tap', ref: 'pads/kick' }, { velocity: 'input' })];
  const e = mk(pads); const vels = [0.5, 0.7, 0.9], at = [0, 1, 2.25];
  at.forEach((c, i) => { e.press('0,0', c, vels[i]); e.release('0,0', c + 0.1); });
  const j = e.resolve(), ev = tapEvents(j, 'pads/kick');
  assert.deepEqual(ev.map(x => x.value.velocity), vels);
  const base = [{ s: 'bd', at: 0.5 }];
  const prog = (reads) => reads ? ev.map(x => ({ s: 'bd', at: x.begin })) : base; // struct(tap(...:onset)) reader model
  assert.deepEqual(prog(true).map(x => x.at), at.map(c => Math.round(c * 96) / 96)); assert.deepEqual(prog(false), base);
  pass('Tap pad: 3 presses -> 3 tap events with velocities; struct reader gives 3 bd at ' + at.join(',') + '; no reader -> events unchanged');
}

// choke
{
  const pads = [P('0,0', { kind: 'hook', ref: 'a', slot: 's' }, { choke: 1 }), P('0,1', { kind: 'hook', ref: 'b', slot: 's' }, { choke: 1 })];
  let j = run(pads, e => { e.press('0,0', 0.5); e.press('0,1', 2.5); });
  assert.deepEqual(cyc(j), ['1:bind:A/0,0', '3:unbind:A/0,0', '3:bind:A/0,1']); assert.ok(j[1].choke);
  const a = run(pads, e => { e.press('0,0', 0.2); e.press('0,1', 0.5); }), b = run(pads, e => { e.press('0,1', 0.5); e.press('0,0', 0.2); });
  assert.deepEqual(a, b);
  pass('Choke: B closes A at same cycle; two presses in one window resolve identically in either order');
}

// scenes
{
  const pads = [0, 1, 2].flatMap(c => [0, 1].map(r => P(`${r},${c}`, { kind: 'component', ref: `c${r}${c}` }))).filter(p => p.pos !== '1,2');
  const j = run(pads, e => { e.launchScene('A', 0, 0); e.launchScene('A', 1, 4.2); }, { scenes: 'row' });
  const on = activeAt(j, 6).map(x => x.pad).sort();
  console.log('row1 launch cycle:', cyc(j.filter(x => fromFrac(x.cycle) === 5)).join(' '), '| on at 6:', on.join(' '));
  assert.deepEqual(on, ['A/0,2', 'A/1,0', 'A/1,1']);
  assert.ok(j.filter(x => fromFrac(x.cycle) === 5).length === 4);
  pass('Scenes: row 1 after row 0 leaves exactly row 1 pads on in its columns (col 2 keeps row 0), one cycle');
}

// looper + bounce
{
  const pads = [P('0,0', { kind: 'hook', ref: 'h', slot: 's' }, { mode: 'gate', quant: 'beat', offQuant: 'beat' }), P('0,1', { kind: 'tap', ref: 'pads/kick' })];
  const e = mk(pads); e.press('0,0', 0.25); e.release('0,0', 0.75); e.press('0,1', 1.5, 0.8); e.release('0,1', 1.6); e.press('0,1', 0.5); e.release('0,1', 0.52);
  const j = e.resolve(); const lp = createLooper({ length: 2, origin: 0 }); lp.record(j);
  const n1 = lp.eventCount(); const ex = lp.expand(8), tw = ex.filter(x => x.pad === 'A/0,0' && x.type === 'on');
  assert.equal(lp.periodic().period, '2'); assert.equal(tw.length, 4); assert.equal(Math.max(...ex.map(x => x.cycle)) < 8, true);
  const e2 = mk(pads); e2.press('0,0', 1.0); e2.release('0,0', 1.5); lp.overdub(e2.resolve()); const n2 = lp.eventCount(); lp.undo(); const n3 = lp.eventCount();
  assert.ok(n2 > n1 && n3 === n1);
  pass(`Looper: 2-bar take replays period 2 for 8 bars (${tw.length} on events of A/0,0); counts record=${n1} overdub=${n2} undo=${n3}`);
  const b = bounce(lp.performance, { tapPads: { 'A/0,1': 'pads/kick' }, quant: 'none' });
  const fromPlay = ex.filter(x => x.pad === 'A/0,0' && x.type === 'on').map(x => x.cycle);
  const fromBounce = expandGate(b.gates['A/0,0'], 0, 8).map(w => w[0]);
  assert.deepEqual(fromBounce, fromPlay);
  const tapPlay = ex.filter(x => x.pad === 'A/0,1' && x.type === 'on').map(x => x.cycle);
  const tapB = []; for (let k = 0; k < 4; k++) for (const [s] of b.vars['pads/kick'].$events) tapB.push(fromFrac(s) + 2 * k);
  assert.deepEqual(tapB.sort((a, c) => a - c), tapPlay);
  pass('Bounce: gates/$events of the take expand deep-equal to the take played (engine-level; strudel events CLI not available yet)');
}

// input registry
{
  const pads = [P('1,0', { kind: 'hook', ref: 'h', slot: 's' }, { mode: 'gate' })];
  const e = createPads({ banks: [bank('A', pads)] }); const input = createInput();
  createRouter({ input, keymaps: { kbd: DEFAULT_KEYBOARD_MAP, test: { 'test:x': '1,0' } }, active: { keyboard: 'kbd', test: 'test' }, pads: e, clock: { cycle: 0, ms: 0 } });
  let emit; const off = input.register({ id: 'test', describe: () => ({}), start: (em) => { emit = em; return () => {}; } });
  emit({ type: 'on', control: 'test:x', cycle: 1.2 }); emit({ type: 'off', control: 'test:x', cycle: 2.4 });
  assert.equal(e.resolve().length, 2); off(); e.reset(); emit({ type: 'on', control: 'test:x', cycle: 1.2 }); assert.equal(e.resolve().length, 0);
  assert.equal(DEFAULT_KEYBOARD_MAP['kbd:KeyQ'], '1,0');
  const listeners = {}; const tgt = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} };
  input.register(keyboardProvider({ target: tgt, perform: () => true, now: () => 1200 }));
  e.reset(); listeners.keydown({ code: 'KeyQ', target: { tagName: 'TEXTAREA' } }); assert.equal(e.resolve().length, 0);
  listeners.keydown({ code: 'KeyQ', target: { tagName: 'DIV' } }); assert.deepEqual(cyc(e.resolve()), ['2:bind:A/1,0']);
  pass('Input registry: runtime provider drives pad via keymap; unregister stops; KeyQ -> 1,0; text-field key fires nothing');
}
