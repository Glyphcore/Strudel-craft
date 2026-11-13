// Hooks P3 (#49): model schema and code <-> model round trip. Run: node tests/hooks/p3.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validate } from '../../site/engine/validate.js';
import { parse, generate, applyOp, graph, layout, canonical, hash, fromConfig, serialize, load } from '../../site/model.js';

const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const schema = JSON.parse(rd('../../site/data/schema/model.v1.json'));
const catalog = JSON.parse(rd('../../site/data/catalog.json'));
const syntax = rd('../../docs/HOOKS_SYNTAX.md');
const pass = (m) => console.log('PASS ' + m);
const skip = (m, why) => console.log(`SKIP ${m}: ${why}`);
const valid = (m, what) => { const e = validate(schema, m); assert.deepEqual(e, [], `${what}: ${e.slice(0, 3)}`); };

const PROGRAM = `setcpm(30)
hooks.marker("drop", "17b")
hooks.def("murk", { chain: [["lpf", 400]] })
hooks.let("root", 48)
hooks.let("root", 51, "@17b")
hooks.bind("bass/fx", "murk", "<drop", { order: 0 })
// the bass
bass: note("c2 eb2").s("sawtooth").lpf(800).tap("bass").use("fx")
$: s("bd*4").gain(0.8)
`;
const EX4 = `$: s("bd*4").tap("kick").ns("drums")
$: hooks.inst("pad@3", { as: "pad2", args: { cutoff: 900 }, gate: "drop..out", remap: { kick: "drums/kick" } })
$: s("hh*8").gain(tap("pad2/env").range(0.4, 1))
`;
const EX5 = { model: 1, markers: { drop: '17b', out: '49b' },
  tracks: [{ name: 'kick', ns: 'drums', source: ['s', { $mini: 'bd*4' }], chain: [['tap', 'kick']] },
    { name: 'hat', source: ['s', { $mini: 'hh*8' }], chain: [['gain', { $tap: 'pad2/env', range: [0.4, 1] }]] }],
  instances: [{ component: 'pad@3', as: 'pad2', args: { cutoff: 900 }, gate: 'drop..out', remap: { kick: 'drums/kick' } }] };
const OPAQUE = `$: (() => {
  function helper(n) { return n * 2 }
  let p = s("bd")
  for (let i = 0; i < 2; i++) { p = p.fast(helper(i + 1)) }
  return p.gain(tap("kick:env"))
})()`;

// 1 Schema
{
  const cfgText = syntax.split('## 5. Config JSON')[1].match(/```json\n([\s\S]*?)```/)[1];
  const cfg = JSON.parse(cfgText);
  assert.equal(cfg.model, 1); assert.ok(!('hooks' in cfg));
  const rawErrors = validate(schema, cfg).length;
  valid(load(cfgText), 'HOOKS_SYNTAX section 5 config');
  const fixtures = { program: parse(PROGRAM), ex4: parse(EX4), opaque: parse(OPAQUE), ex5: EX5, empty: parse('') };
  for (const [k, m] of Object.entries(fixtures)) valid(m, 'fixture ' + k);
  pass(`Schema: ${Object.keys(fixtures).length} fixture models and the HOOKS_SYNTAX section 5 config validate (version key "model"; raw config has ${rawErrors} errors until fromConfig moves top-level cps/cpb/bpb into settings)`);
}

// 2 No-edit identity
{
  let n = 0; const bad = [];
  for (const r of catalog.recipes) { n++; if (generate(parse(r.code)) !== r.code) bad.push(r.id); }
  assert.deepEqual(bad, []);
  pass(`No-edit identity: ${n} catalog recipes, ${bad.length} failures`);
}

// 3 Fixed point
{
  const t0 = generate({ ...EX5, header: 'setcpm(30)', vars: { root: [{ value: 48 }, { value: 51, gate: '@17b' }] },
    bindings: [{ slot: 'hat/fx', hook: 'murk', gate: { until: 'drop' }, order: 1 }], defs: { murk: { chain: [['lpf', 400]] } } });
  const m1 = parse(t0), t1 = generate(m1), m2 = parse(t1);
  assert.deepEqual(m2, m1); assert.equal(t1, t0);
  assert.deepEqual(parse(generate(parse(PROGRAM))), parse(PROGRAM));
  pass(`Fixed point: parse -> generate -> parse deep-equal (${t0.split('\n').length - 1} line program, identical text)`);
}

// 4 Opaque code
{
  const m = parse(OPAQUE);
  assert.equal(m.tracks.length, 1); assert.equal(m.tracks[0].chain, undefined); assert.equal(m.tracks[0].src, OPAQUE);
  assert.equal(generate(m), OPAQUE);
  const g = graph(m), code = g.nodes.find(n => n.kind === 'code');
  assert.ok(code.ports.in.includes('kick:env')); assert.ok(g.wires.some(w => w.to.node === code.id && w.to.port === 'kick:env'));
  pass('Opaque code: for-loop + helper layer kept byte for byte as a code node; tap("kick:env") is input port of ' + code.id);
}

// 5 Local edits
const lineDiff = (a, b) => {
  const x = a.split('\n'), y = b.split('\n'); let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return { removed: x.length - i - j, added: y.length - i - j, line: y[i] };
};
const base = parse(PROGRAM), baseText = generate(base);
{
  const ops = {
    bind: { op: 'bind', slot: 'bass/fx', hook: 'murk', gate: '@17b' },
    'add wire': { op: 'addWire', track: 'bass', param: 'cutoff', tap: 'kick:env', opts: { range: [400, 4000] } },
    'insert step': { op: 'insertStep', track: 'bass', index: 2, step: ['room', 0.3] },
    'literal update': { op: 'literal', track: 'bass', step: 1, arg: 0, value: 1200 },
  };
  const msg = [];
  for (const [k, op] of Object.entries(ops)) {
    const t = generate(applyOp(base, op)), d = lineDiff(baseText, t);
    assert.ok(d.removed + d.added >= 1 && d.removed <= 1 && d.added === 1, `${k}: -${d.removed} +${d.added}`);
    valid(applyOp(base, op), 'after ' + k);
    msg.push(`${k}: -${d.removed}/+${d.added} line`);
  }
  assert.ok(generate(applyOp(base, ops['literal update'])).includes('// the bass\nbass: note("c2 eb2").s("sawtooth").lpf(1200)'));
  pass('Local edits: ' + msg.join('; ') + '; all other lines identical');
}

// 6 Mini-notation safety
{
  const m = applyOp(parse('$: s("bd*4").gain(0.8)\n'), { op: 'insertStep', track: '$1', index: 1, step: ['lpf', 800] });
  assert.equal(generate(m), '$: s("bd*4").gain(0.8).lpf(800)\n');
  const fresh = JSON.parse(JSON.stringify(m)); delete fresh.tracks[0].src;
  assert.equal(generate(applyOp(fresh, { op: 'insertStep', track: '$1', index: 0, step: ['fast', 2] })), '$: s("bd*4").fast(2).gain(0.8).lpf(800)\n');
  const single = applyOp(parse("$: s(\"bd\").vowel('a')\n"), { op: 'literal', track: '$1', step: 0, arg: 0, value: 'e' });
  assert.equal(generate(single), "$: s(\"bd\").vowel('e')\n");
  pass('Mini-notation safety: s("bd*4") stays double-quoted after edit (spliced and regenerated); single quotes stay single');
}

// 7 Same sound (needs the strudel CLI)
{
  const cli = spawnSync('strudel', ['--version'], { encoding: 'utf8' });
  if (cli.error || cli.status !== 0) skip('Same sound', '`strudel` CLI not available in this checkout (lives in another repo); needs `strudel events`');
  else {
    const f = (c) => { const p = new URL('./.p3-tmp.strudel.js', import.meta.url).pathname; fs.writeFileSync(p, c); const r = spawnSync('strudel', ['events', p], { encoding: 'utf8' }); fs.unlinkSync(p); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    const src = '$: s("bd*4").gain(0.8)\n';
    const m = parse(src), step = ['lpf', 800];
    const there = applyOp(m, { op: 'insertStep', track: '$1', index: 1, step });
    const back = applyOp(there, { op: 'removeStep', track: '$1', index: 1 });
    assert.equal(f(generate(back)), f(src));
    pass('Same sound: strudel events identical after insert step + inverse');
  }
}

// 8 Graph projection
{
  const g5 = graph(EX5), ids5 = g5.nodes.map(n => n.id);
  for (const id of ['track:kick', 'tap:kick', 'inst:pad2', 'marker:drop', 'marker:out']) assert.ok(ids5.includes(id), 'missing ' + id);
  const sig = g5.wires.filter(w => w.type === 'signal' && w.to.port === 'gain');
  assert.equal(sig.length, 1); assert.equal(g5.wires.filter(w => w.type === 'signal').length, 1);
  assert.equal(sig[0].from.node, 'inst:pad2'); assert.ok(sig[0].to.node.startsWith('track:hat#'));
  // the same program as code (layers anonymous there): same tracks, same ids for the rest
  const mc = parse('hooks.marker("drop", "17b")\nhooks.marker("out", "49b")\n' + EX4);
  assert.deepEqual(mc.tracks.map(({ name, src, ...r }) => r), EX5.tracks.map(({ name, ...r }) => r));
  assert.deepEqual(mc.instances, EX5.instances);
  const gc = graph(mc), idc = gc.nodes.map(n => n.id);
  for (const id of ['tap:kick', 'inst:pad2', 'marker:drop', 'marker:out']) assert.ok(idc.includes(id));
  assert.equal(gc.wires.filter(w => w.type === 'signal' && w.to.port === 'gain').length, 1);
  assert.equal(gc.wires.filter(w => w.type === 'gate').length, 2);
  pass(`Graph projection: example 4 -> ${ids5.length} nodes, ${g5.wires.length} wires; track:kick tap:kick inst:pad2 marker:drop marker:out, 1 signal wire ${sig[0].from.node}:${sig[0].from.port} -> ${sig[0].to.node}:${sig[0].to.port}`);
}

// 9 Layout
{
  const l1 = layout(EX5), l2 = layout(EX5);
  assert.deepEqual(l1, l2);
  assert.ok(l1['inst:pad2'].x > l1['marker:drop'].x);
  const withLayout = { ...EX5, layout: { 'track:kick': { x: 7, y: 9, collapsed: false }, 'inst:pad2': { x: 500, y: 40 } } };
  const viaCode = parse(generate(withLayout)), viaFile = load(serialize(withLayout));
  assert.deepEqual(viaCode.layout, withLayout.layout); assert.deepEqual(viaFile.layout, withLayout.layout);
  assert.deepEqual(layout(viaCode)['track:kick'], withLayout.layout['track:kick']);
  assert.deepEqual(parse(generate(viaCode)).layout, withLayout.layout);
  pass('Layout: deterministic (two calls deep-equal); stored entries survive code and model-file cycles and override computed positions');
}

// 10 Hash
{
  const a = { model: 1, meta: { name: 'x', rev: 3, hash: 'old' }, markers: { b: 1, a: 2 }, layout: { 'track:a': { x: 1, y: 2 } } };
  const b = { markers: { a: 2, b: 1 }, meta: { name: 'x' }, model: 1 };
  assert.equal(hash(a), hash(b)); assert.equal(canonical(a), canonical({ ...a, markers: { a: 2, b: 1 } }));
  assert.notEqual(hash(a), hash({ ...b, markers: { a: 3, b: 1 } }));
  assert.equal(hash(a), crypto.createHash('sha256').update(canonical({ model: 1, meta: { name: 'x' }, markers: { b: 1, a: 2 } })).digest('hex'));
  pass('hash(): stable across key order, ignores layout / meta.rev / meta.hash, equals SHA-256 of canonical text');
}
