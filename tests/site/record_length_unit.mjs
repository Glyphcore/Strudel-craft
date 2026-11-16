// Record length model, pure (site/record-length.js, docs/CAPTURE.md "Length", #139): `node tests/site/record_length_unit.mjs`. No browser.
import * as RL from '../../site/record-length.js';
let fail = 0; const ok = (n, p, i = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'}  ${n}  ${i}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
for (const [bpm, bpb] of [[128.8, 4], [140, 4], [140, 7], [90, 3]]) {
  const cps = RL.cpsFromBpm(bpm, bpb), barSec = 1 / cps;
  const p = RL.plan({ unit: 'bars', value: 12, cps, cpb: 1, bpb });
  ok(`${bpm} bpm, ${bpb} beats per bar: 12 bars = ${(12 * barSec).toFixed(3)} s, ${12} cycles`, p.ok && near(p.seconds, 12 * barSec, 1e-5) && near(p.cycles, 12) && near(RL.bpmFromCps(cps, bpb), bpm, 1e-9), JSON.stringify(p));
  const s = RL.plan({ unit: 'seconds', value: 12 * barSec, cps, cpb: 1 }), c = RL.plan({ unit: 'cycles', value: 12, cps, cpb: 1 });
  ok(`${bpm} bpm, ${bpb} beats per bar: seconds and cycles units agree with bars`, near(s.bars, 12, 1e-5) && near(c.bars, 12) && near(c.seconds, p.seconds, 1e-5));
}
{ const cps = RL.cpsFromBpm(128.8, 4); const p = RL.plan({ unit: 'bars', value: 2, cps, cpb: 2 }); ok('2 cycles per bar: 2 bars = 4 cycles', near(p.cycles, 4) && near(p.bars, 2) && near(p.startBar, 1)); }
{ const cps = 0.5, p = RL.plan({ unit: 'bars', value: 8, startBar: 5, cps, cpb: 1 }); ok('start bar 5, 8 bars: [4, 12) cycles, bars 5 to 13', p.ok && p.startCycle === 4 && p.stopCycle === 12 && p.startBar === 5 && p.endBar === 13, JSON.stringify(p));
  const d = RL.plan({ unit: 'bars', value: 8, transportStart: 6, cps, cpb: 1 }); ok('start defaults to the transport start (cycle 6 = bar 7)', d.startCycle === 6 && d.startBar === 7); }
// validation
ok('parse "12"', RL.parseLen('12').value === 12); ok('parse "12,5" decimal comma', RL.parseLen('12,5').value === 12.5);
ok('parse "1:30" only in seconds', RL.parseLen('1:30', 'seconds').value === 90 && !RL.parseLen('1:30', 'bars').ok);
for (const bad of ['', 'abc', '0', '-3', '1e3', '12 bars']) ok(`reject "${bad}" with an inline message`, !RL.parseLen(bad).ok && RL.parseLen(bad).error.length > 3, RL.parseLen(bad).error);
ok('start bar 0 rejected', !RL.parseStartBar('0').ok); ok('start bar blank = transport start', RL.parseStartBar('').value === null);
ok('too short rejected', !RL.plan({ unit: 'cycles', value: 0.01, cps: 0.5 }).ok);
// clamp
{ const cps = 0.5; const a = RL.plan({ unit: 'seconds', value: 1200, cps }), b = RL.plan({ unit: 'seconds', value: 1201, cps }), c = RL.plan({ unit: 'bars', value: 601, cps, cpb: 1 });
  ok('20:00 exactly passes, 20:01 is refused with the play-time limit message', a.ok && !b.ok && /20:00 play-time limit/.test(b.error) && !c.ok, b.error);
  ok('+5 min extension raises the clamp', RL.plan({ unit: 'seconds', value: 1500, cps, extra: 300 }).ok && !RL.plan({ unit: 'seconds', value: 1500, cps, maxMin: 20 }).ok); }
// end of track
const gates = (rows) => ({ slots: { fx: { scopes: { '*global*': rows } } } });
{ const plan = gates([{ from: '0', until: '8', bindings: ['else:bypass'] }, { from: '8', until: '16', bindings: ['b1'] }, { from: '16', until: '1024', bindings: ['else:bypass'] }]);
  const e = RL.resolveEnd({ plan, code: 'x', cpb: 1 }); ok('gated "9b..17b": end = bar 17 (cycle 16), rule gates', e.rule === 'gates' && e.cycle === 16 && e.bar === 17, JSON.stringify(e)); }
{ const plan = gates([{ from: '0', until: '16', bindings: ['else:bypass'] }, { from: '16', until: '1024', bindings: ['b1'] }, ]);
  const e = RL.resolveEnd({ plan, cpb: 1 }); ok('open-ended "@17b": the last section is assumed as long as the one before (bar 17 + 16 = bar 33)', e.rule === 'gates' && e.bar === 33, JSON.stringify(e)); }
{ const plan = gates([{ from: '0', until: '8', bindings: ['b1'] }, { from: '8', until: '24', bindings: ['b2'] }, { from: '24', until: '1024', bindings: ['else:bypass'] }]);
  const e = RL.resolveEnd({ plan, markers: { end: '99b' }, cpb: 1 }); ok('the last gate end wins over a marker (rule order)', e.cycle === 24 && e.rule === 'gates'); }
{ const e = RL.resolveEnd({ plan: null, markers: { end: '33b' }, loop: { on: true, end: 8 }, code: '', cpb: 1 }); ok('no gates: marker "end" = bar 33', e.rule === 'marker' && e.bar === 33, JSON.stringify(e)); }
{ const e = RL.resolveEnd({ loop: { on: true, end: 8 }, code: '$: s("bd")', cpb: 1 }); ok('no gates or marker: Loop range end 8 = bar 9', e.rule === 'loop' && e.bar === 9); }
{ const e = RL.resolveEnd({ loop: { on: false, end: 8 }, code: '$: s("bd")\n$: arrange([4, s("hh")], [4, s("cp")])\n$: note("<a b c>")', cpb: 1 }); ok('else the longest lane period (arrange 8 cycles) = bar 9', e.rule === 'period' && e.cycle === 8, JSON.stringify(e)); }
{ const e = RL.resolveEnd({ code: 'note("c e").slow(3)', cpb: 1 }); ok('period of .slow(3) is 3 cycles', e.cycle === 3 && e.rule === 'period'); const f = RL.resolveEnd({ code: 's("bd")' }); ok('plain loop: 1 bar fallback, never prompts', f.cycle === 1); }
{ const cps = 0.5, end = { cycle: 16, bar: 17, rule: 'gates' }, p = RL.plan({ unit: 'bars', value: 4, toEnd: true, end, cps, cpb: 1 }); ok('to end from bar 1 = 16 bars, bars 1 to 17', p.ok && p.bars === 16 && p.endBar === 17, JSON.stringify(p));
  const q = RL.plan({ unit: 'bars', value: 4, toEnd: true, end, startBar: 9, cps, cpb: 1 }); ok('to end from bar 9 = 8 bars', q.bars === 8);
  const r = RL.plan({ unit: 'bars', value: 4, toEnd: true, end, startBar: 20, cps, cpb: 1 }); ok('start after the end is refused', !r.ok && /end of track/.test(r.error), r.error);
  const o = RL.plan({ unit: 'bars', value: 4, toEnd: true, end, endBar: 13, cps, cpb: 1 }); ok('typed end bar 13 overrides the resolved end', o.bars === 12 && o.endBar === 13); }
// recipe compat
const old = { cps: 0.5, start: 17, stop: 21, cycles: 4, loop: true, mode: 'offline', exact: true };
ok('old cycle-only recipe timing passes the compat check', RL.checkTimingMeta(old) === null);
const p4 = RL.plan({ unit: 'bars', value: 4, startBar: 18, cps: 0.5, cpb: 1 });
ok('new timing fields agree with cycles/start', RL.checkTimingMeta({ ...old, ...RL.timingMeta(p4, { unit: 'bars' }) }) === null);
ok('disagreeing bars are refused', /disagrees/.test(RL.checkTimingMeta({ ...old, bars: 5 }) || ''), RL.checkTimingMeta({ ...old, bars: 5 }));
ok('disagreeing startBar are refused', /disagrees/.test(RL.checkTimingMeta({ ...old, startBar: 3 }) || ''));
process.exit(fail ? 1 : 0);
