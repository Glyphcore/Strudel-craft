// #118 / #114 follow-up: a bare tap("x") with no publisher reads the Perform pad "x": value 1 while held, no haps while idle.
// `STRUDEL_CRAFT=$PWD node tests/hooks/pad_reader.mjs` (needs SUNO_LAB like the other hooks tests; STRUDEL_CRAFT picks the hooks.js under test)
import assert from 'node:assert/strict';
import { boot, pass } from './harness.mjs';
import { fileURLToPath } from 'node:url';
process.env.STRUDEL_CRAFT ||= fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, ''); // the hooks.js under test = this checkout unless overridden
const { g } = await boot(); const hooks = g.hooks; const w = (s) => process.stderr.write(s + '\n');
const bd = () => g.s(g.mini('bd*4')); // 4 events per cycle
const ev = (p, a, b) => p.queryArc(a, b, { _cps: 1 }).filter((h) => h.hasOnset());
const J = (c, op) => ({ cycle: String(c), op, args: ['kick'] });
hooks.reset(); hooks.padRefs = new Set(['kick']);
// idle: silent reader, no E_UNKNOWN_TAP
{
  assert.equal(ev(bd().gain(g.tap('kick')), 0, 4).length, 0, 'gain form idle');
  assert.equal(ev(bd().mask(g.tap('kick')), 0, 4).length, 0, 'mask form idle');
  assert.equal(ev(g.tap('kick').s('bd'), 0, 4).length, 0, 'trigger form idle');
  assert.ok(!hooks.diag().some((d) => d.code === 'E_UNKNOWN_TAP'), 'no unknown-tap error for a known pad');
}
// held cycles 1..3
hooks.journal.push(J(1, 'pad:tap'), J(3, 'pad:tap-end'));
const inRange = (es, lo, hi) => es.every((h) => +h.whole.begin >= lo && +h.whole.begin < hi);
{
  const gn = ev(bd().gain(g.tap('kick')), 0, 4); assert.equal(gn.length, 8); assert.ok(inRange(gn, 1, 3)); assert.ok(gn.every((h) => h.value.gain === 1));
  const mk = ev(bd().mask(g.tap('kick')), 0, 4); assert.equal(mk.length, 8); assert.ok(inRange(mk, 1, 3));
  const tr = ev(g.tap('kick').s('bd'), 0, 4); assert.equal(tr.length, 1, 'one onset on press'); assert.equal(+tr[0].whole.begin, 1);
  const gate = g.tap('kick:gate').queryArc(2, 2, { _cps: 1 }); assert.equal(gate[0].value, 1); assert.equal(g.tap('kick:gate').queryArc(3.5, 3.5, { _cps: 1 })[0].value, 0);
}
// the pad reader marks its haps (context.padTap = ref) in every form: the site's live catch-up fires exactly the haps a press caused (#119)
{
  const mark = (p) => ev(p, 0, 4).every((h) => h.context && h.context.padTap === 'kick');
  assert.ok(mark(bd().gain(g.tap('kick'))) && mark(bd().mask(g.tap('kick'))) && mark(g.tap('kick').s('bd')), 'padTap marker survives gain / mask / trigger forms');
  assert.ok(ev(bd(), 0, 4).every((h) => !(h.context && h.context.padTap)), 'unrelated haps carry no marker');
}
// still held (no release yet): open-ended window; then a second hit
{
  hooks.journal.length = 0; hooks.journal.push(J(1, 'pad:tap'));
  assert.equal(ev(bd().mask(g.tap('kick')), 0, 4).length, 12, 'held without release = open window');
  hooks.journal.push(J(2, 'pad:tap-end'), J(5, 'pad:tap'));
  assert.equal(ev(g.tap('kick').s('bd'), 0, 8).length, 2, 'two presses = two onsets');
}
// a published tap of the same name wins over the pad
{
  hooks.journal.length = 0; hooks.journal.push(J(1, 'pad:tap'), J(3, 'pad:tap-end'));
  bd().tap('kick'); // publisher: bd*4 every cycle
  assert.equal(ev(g.tap('kick').s('hh'), 0, 2).length, 8, 'publisher wins');
}
pass('Pad reader (#118): bare tap("x") = pad held window; gain/mask forms silent idle and 8 events over a 2-cycle hold, trigger form 1 onset on press, 2 presses 2 onsets, gate facet 1/0, publisher of the same name wins, idle known pad raises no E_UNKNOWN_TAP');
