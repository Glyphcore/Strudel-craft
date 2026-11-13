// #57: word(...).formant(true) resolves to the nearest pre-rendered variant. Usage: STRUDEL_MODULES=<dir with @strudel/> node tests/vocals/formant_helper.mjs
// Builds a tiny synthetic bank map itself (no audio): fetch/samples are stubbed, the real prelude/word.js code path runs.
import assert from 'node:assert/strict';
import { bootRuntime } from '../hooks/fixtures/rt.mjs';
const RT = await bootRuntime();
if (!RT) { console.log('SKIP  @strudel/core/@strudel/mini not installed (set STRUDEL_MODULES=<dir with @strudel/>)'); process.exit(2); }
const withVariants = { vox_x: { c4: ['x.wav'] } }; for (let s = -12; s <= 12; s++) withVariants['vox_x_f' + s] = ['x_f' + s + '.wav'];
const bare = { vox_x: { c4: ['x.wav'] } };
const maps = { 'http://t/demo/pitched/strudel.json': bare, 'http://t/fv/strudel.json': withVariants, 'http://t/bare/strudel.json': bare };
globalThis.fetch = async (u) => ({ ok: !!maps[u], status: maps[u] ? 200 : 404, json: async () => maps[u] });
globalThis.samples = async () => {};
const warns = []; console.warn = (m) => warns.push(String(m));
await import('../../site/prelude/word.js');
const vals = (p) => p.queryArc(0, 1).map((h) => h.value);
const fails = []; const ck = (name, f) => { try { f(); console.log('PASS ', name); } catch (e) { fails.push(name); console.log('FAIL ', name, '-', e.message.split('\n')[0]); } };

await voxBank('http://t/fv/strudel.json'); warns.length = 0;
ck('+7 st (note g4 over base c4) -> vox_x_f7, speed 1', () => { const [v] = vals(word('x').note('g4').formant(true)); console.log('  ', JSON.stringify(v)); assert.equal(v.s, 'vox_x_f7'); assert.equal(v.speed, 1); assert.equal(v.note, undefined); });
ck('+6.4 st -> nearest variant f6, residual 40 cents via speed', () => { const [v] = vals(word('x').note(66.4).formant(true)); console.log('  ', JSON.stringify(v)); assert.equal(v.s, 'vox_x_f6'); const cents = 1200 * Math.log2(v.speed); assert.ok(Math.abs(cents - 40) < 1e-6 && Math.abs(cents) <= 50); });
ck('with variants: no warning', () => assert.equal(warns.length, 0));
await voxBank('http://t/bare/strudel.json'); warns.length = 0;
ck('bank without variants: plain note() retune kept, exactly one warning', () => { const a = vals(word('x').note('g4').formant(true)), b = vals(word('x').note('e4').formant(true)); console.log('  ', JSON.stringify(a[0]), 'warnings:', warns.length); assert.deepEqual(a[0], { s: 'vox_x', note: 'g4' }); assert.equal(b[0].s, 'vox_x'); assert.equal(warns.length, 1); });
process.exit(fails.length ? 1 : 0);
